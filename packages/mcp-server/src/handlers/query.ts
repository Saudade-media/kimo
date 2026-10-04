/**
 * The `kimo_query` engine (ADR 0013 §2): selectors, depth with `"…"` elision, variable and
 * instance resolution, bounds and layout problems, field projection and cursor pagination.
 * Never dumps the whole document: at least one selector is required and pages are capped.
 */
import {
  type ExpandedView,
  isObject,
  isRef,
  type KimoDocument,
  pageOfRoot,
  resolveVariable,
} from "@kimo/core-schema"
import type { DocStore, NodeData } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"
import type { ToolError } from "../envelope"

export interface QueryInput {
  select: {
    ids?: string[]
    under?: string
    topLevel?: boolean
    name?: string
    type?: string[]
    text?: string
    component?: string
    /** Board 27 / spec §5.6: only nodes on this page (a page id from kimo_get_state). */
    page?: string
  }
  depth?: number
  resolveVariables?: boolean
  theme?: { axis: string; value: string }[]
  resolveInstances?: boolean
  include?: ("bounds" | "problems" | "geometry" | "origin" | "overrides")[]
  fields?: string[]
  limit?: number
  cursor?: string
}

export type Problem =
  | "partially-clipped"
  | "fully-clipped"
  | "collapsed"
  | "overflow"
  | "missing-font"
  | "missing-asset"

export interface QueryOutput {
  nodes: Record<string, unknown>[]
  matched: number
  nextCursor?: string
}

type Source = {
  getNode(id: string): Readonly<Record<string, unknown>> | undefined
  children(parent: string | null, at?: string | null): readonly string[]
}

const GEOMETRY_FIELDS = ["d", "geometry", "points"]

/** Text of a text node (string, runs, or a binding name). */
export function textOf(n: Readonly<Record<string, unknown>>): string {
  const c = n.content
  if (typeof c === "string") return c
  if (Array.isArray(c))
    return c.map((r) => (isObject(r) && typeof r.text === "string" ? r.text : "")).join("")
  return ""
}

/** All children of a real node (regular, then instance-owned groups). */
function realChildren(store: DocStore, owned: Map<string, string[]>, id: string): string[] {
  return [...store.children(id), ...(owned.get(id) ?? [])]
}

function ownedIndex(store: DocStore): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const id of store.nodeIds()) {
    const n = store.getNode(id) as NodeData
    if (typeof n.at !== "string" || typeof n.parent !== "string") continue
    let l = out.get(n.parent)
    if (!l) {
      l = []
      out.set(n.parent, l)
    }
    l.push(id)
  }
  for (const [p, l] of out) {
    const groups = new Set(l.map((c) => (store.getNode(c) as NodeData).at as string))
    out.set(
      p,
      [...groups].sort().flatMap((g) => store.children(p, g)),
    )
  }
  return out
}

/** Runs a query. `view` is the expanded instance view (needed for resolveInstances/origin). */
export function runQuery(
  store: DocStore,
  input: QueryInput,
  ctx: { view: ExpandedView | null; layout: LayoutResult | null },
): { ok: true; value: QueryOutput } | { ok: false; error: ToolError } {
  const sel = input.select
  const hasSelector =
    (sel.ids && sel.ids.length > 0) ||
    sel.under !== undefined ||
    sel.topLevel === true ||
    sel.name !== undefined ||
    (sel.type && sel.type.length > 0) ||
    sel.text !== undefined ||
    sel.component !== undefined ||
    sel.page !== undefined
  if (!hasSelector)
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message:
          "Give at least one selector (ids, under, topLevel, name, type, text, component, page).",
        path: "select",
        suggestion: "Use select: {topLevel: true} for the canvas's top-level nodes.",
      },
    }
  const view = input.resolveInstances ? ctx.view : null
  const src: Source = view ?? store
  const owned = ownedIndex(store)
  const kids = (id: string): readonly string[] => {
    if (view) return view.children(id)
    return realChildren(store, owned, id)
  }
  if (sel.under !== undefined && !src.getNode(sel.under))
    return {
      ok: false,
      error: {
        code: "NODE_NOT_FOUND",
        message: `Node ${sel.under} does not exist.`,
        nodeId: sel.under,
        path: "select.under",
      },
    }

  // Candidates in document order.
  let candidates: string[]
  if (sel.ids && sel.ids.length > 0) {
    const missing = sel.ids.find((id) => !src.getNode(id))
    if (missing)
      return {
        ok: false,
        error: {
          code: "NODE_NOT_FOUND",
          message: `Node ${missing} does not exist${missing.includes("/") && !view ? " (pass resolveInstances for instance content)" : ""}.`,
          nodeId: missing,
          path: "select.ids",
        },
      }
    candidates = [...new Set(sel.ids)]
  } else if (sel.under !== undefined) {
    candidates = []
    const walk = (id: string) => {
      for (const c of kids(id)) {
        candidates.push(c)
        walk(c)
      }
    }
    walk(sel.under)
  } else if (sel.topLevel) {
    candidates = [...store.children(null)]
  } else {
    candidates = []
    const walk = (id: string) => {
      candidates.push(id)
      for (const c of kids(id)) walk(c)
    }
    for (const r of store.children(null)) walk(r)
  }
  const inUnder = (id: string): boolean => {
    if (sel.under === undefined) return true
    let cur: unknown = src.getNode(id)?.parent
    const seen = new Set<string>()
    while (typeof cur === "string" && !seen.has(cur)) {
      if (cur === sel.under) return true
      seen.add(cur)
      cur = src.getNode(cur)?.parent
    }
    // Virtual ids: `inst/child` lies under `inst`.
    return id.startsWith(`${sel.under}/`)
  }
  const name = sel.name?.toLowerCase()
  const text = sel.text?.toLowerCase()
  const pageDoc = { pages: store.toHeader().pages }
  const onPage = (id: string): boolean => {
    if (sel.page === undefined) return true
    // The root of the (real part of the) id decides the page.
    let cur = store.getNode(id.split("/")[0] as string)
    const seen = new Set<string>()
    while (cur && typeof cur.parent === "string" && !seen.has(cur.parent)) {
      seen.add(cur.parent)
      cur = store.getNode(cur.parent)
    }
    return !!cur && pageOfRoot(pageDoc, cur) === sel.page
  }
  const matches = candidates.filter((id) => {
    const n = src.getNode(id)
    if (!n) return false
    if (!onPage(id)) return false
    if (sel.topLevel && n.parent !== null) return false
    if (!inUnder(id)) return false
    if (
      name !== undefined &&
      !String(n.name ?? "")
        .toLowerCase()
        .includes(name)
    )
      return false
    if (sel.type && sel.type.length > 0 && !sel.type.includes(String(n.type))) return false
    if (text !== undefined && !textOf(n).toLowerCase().includes(text)) return false
    if (sel.component !== undefined && !(n.type === "instance" && n.of === sel.component))
      return false
    return true
  })

  const depth = Math.min(10, Math.max(0, input.depth ?? 1))
  const limit = Math.min(1000, Math.max(1, input.limit ?? 200))
  const start = parseCursor(input.cursor)
  const include = new Set(input.include ?? [])
  const header = store.toHeader() as unknown as KimoDocument
  const themeOverride = input.theme?.length
    ? Object.fromEntries(input.theme.map((t) => [t.axis, t.value]))
    : null
  const problems = include.has("problems") ? computeProblems(store, src, ctx.layout) : null

  const out: Record<string, unknown>[] = []
  const emitted = new Set<string>()
  let i = start
  for (; i < matches.length; i++) {
    if (out.length >= limit && i > start) break
    const root = matches[i] as string
    const visit = (id: string, d: number) => {
      if (emitted.has(id)) return
      emitted.add(id)
      const n = src.getNode(id)
      if (!n) return
      const children = kids(id)
      out.push(
        shape(id, n, d, children, d < depth, {
          include,
          fields: input.fields,
          resolve: input.resolveVariables
            ? (v) => resolveDeep(header, v, themeOverride ?? themeFor(view ?? ctx.view, store, id))
            : null,
          layout: ctx.layout,
          problems,
          view: ctx.view,
        }),
      )
      if (d < depth) for (const c of children) visit(c, d + 1)
    }
    visit(root, 0)
  }
  const value: QueryOutput = { nodes: out, matched: matches.length }
  if (i < matches.length) value.nextCursor = `o${i}`
  return { ok: true, value }
}

function parseCursor(c: string | undefined): number {
  const m = c ? /^o(\d+)$/.exec(c) : null
  return m ? Number(m[1]) : 0
}

function themeFor(view: ExpandedView | null, store: DocStore, id: string): Record<string, string> {
  if (view) return view.theme(id)
  // Real nodes: defaults + pins up the parent chain.
  const header = store.toHeader()
  const theme: Record<string, string> = {}
  for (const [axis, values] of Object.entries(header.themes ?? {}))
    if (Array.isArray(values) && typeof values[0] === "string") theme[axis] = values[0]
  const chain: Readonly<Record<string, unknown>>[] = []
  let cur: unknown = id
  const seen = new Set<string>()
  while (typeof cur === "string" && !seen.has(cur)) {
    seen.add(cur)
    const n = store.getNode(cur)
    if (!n) break
    chain.push(n)
    cur = n.parent
  }
  for (let k = chain.length - 1; k >= 0; k--) {
    const pins = chain[k]?.theme
    if (isObject(pins))
      for (const [a, v] of Object.entries(pins)) if (typeof v === "string") theme[a] = v
  }
  return theme
}

function resolveDeep(doc: KimoDocument, v: unknown, theme: Record<string, string>): unknown {
  if (isRef(v)) {
    const r = resolveVariable(doc, v.$ref, theme)
    return r.ok ? r.value : v
  }
  if (Array.isArray(v)) return v.map((x) => resolveDeep(doc, x, theme))
  if (isObject(v)) {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) o[k] = resolveDeep(doc, x, theme)
    return o
  }
  return v
}

function shape(
  id: string,
  n: Readonly<Record<string, unknown>>,
  depth: number,
  children: readonly string[],
  expand: boolean,
  o: {
    include: Set<string>
    fields: string[] | undefined
    resolve: ((v: unknown) => unknown) | null
    layout: LayoutResult | null
    problems: Map<string, Problem[]> | null
    view: ExpandedView | null
  },
): Record<string, unknown> {
  const out: Record<string, unknown> = { id, type: n.type }
  if (typeof n.parent === "string") out.parent = n.parent
  out.depth = depth
  const wanted = o.fields ? new Set(o.fields) : null
  for (const [k, v] of Object.entries(n)) {
    if (k === "parent" || k === "order" || k === "type") continue
    if (wanted && !wanted.has(k)) continue
    if (!o.include.has("geometry") && GEOMETRY_FIELDS.includes(k)) continue
    if (!o.include.has("overrides") && k === "overrides" && !wanted?.has(k)) continue
    out[k] = o.resolve && k !== "of" && k !== "at" ? o.resolve(v) : v
  }
  if (children.length) out.children = expand ? [...children] : ["…"]
  if (o.include.has("bounds")) {
    const w = o.layout?.nodes.get(id)?.world
    if (w) out.bounds = { x: w.x, y: w.y, w: w.w, h: w.h }
  }
  if (o.problems) out.problems = o.problems.get(id) ?? []
  if (o.include.has("origin") && o.view) {
    const org = o.view.origin(id)
    if (org)
      out.origin = {
        virtual: org.virtual,
        top: org.top,
        path: org.path,
        source: org.source,
        overrides: org.overrides.map((x) => ({
          layer: x.layer,
          holder: x.holder,
          key: x.key,
          fields: x.fields,
        })),
      }
  }
  if (o.include.has("overrides") && n.overrides !== undefined) out.overrides = n.overrides
  return out
}

/** Layout problems per node: clipping, collapse, overflow, missing fonts/assets. */
export function computeProblems(
  store: DocStore,
  src: Source,
  layout: LayoutResult | null,
): Map<string, Problem[]> {
  const out = new Map<string, Problem[]>()
  const add = (id: string, p: Problem) => {
    const l = out.get(id) ?? []
    if (!l.includes(p)) l.push(p)
    out.set(id, l)
  }
  if (!layout) return out
  const assets = (store.toHeader().assets ?? {}) as Record<string, unknown>
  for (const issue of layout.issues)
    if (issue.code === "TEXT_MEASURE_FAILED") add(issue.nodeId, "missing-font")
  for (const [id, l] of layout.nodes) {
    if (!l.visible) continue
    const n = src.getNode(id)
    if (!n) continue
    if (l.world.w <= 0 || l.world.h <= 0) add(id, "collapsed")
    // Clipping by the nearest clipping ancestor.
    let cur: unknown = n.parent
    const seen = new Set<string>()
    while (typeof cur === "string" && !seen.has(cur)) {
      seen.add(cur)
      const p = src.getNode(cur)
      const pl = layout.nodes.get(cur)
      if (!p || !pl) break
      if (p.clip === true) {
        const a = l.world
        const b = pl.world
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (ix <= 0 || iy <= 0) add(id, "fully-clipped")
        else if (ix < a.w - 0.5 || iy < a.h - 0.5) add(id, "partially-clipped")
        break
      }
      cur = p.parent
    }
    // Overflow: children outside a non-clipping frame with auto layout.
    if (n.type === "frame" && n.clip !== true && n.layout !== undefined) {
      for (const c of src.children(id)) {
        const cl = layout.nodes.get(c)
        if (!cl?.visible) continue
        const a = cl.world
        const b = l.world
        if (
          a.x < b.x - 0.5 ||
          a.y < b.y - 0.5 ||
          a.x + a.w > b.x + b.w + 0.5 ||
          a.y + a.h > b.y + b.h + 0.5
        ) {
          add(id, "overflow")
          break
        }
      }
    }
    // Missing assets: image references absent from the manifest.
    const fill = JSON.stringify(n.fill ?? null)
    for (const m of fill.matchAll(/\.\/assets\/([^"]+)/g))
      if (Object.keys(assets).length > 0 && !Object.hasOwn(assets, m[1] as string))
        add(id, "missing-asset")
  }
  return out
}
