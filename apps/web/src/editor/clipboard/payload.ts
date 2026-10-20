/**
 * Board 27 §2 clipboard payload (rules F1FPb "clipboard: kimo/nodes+json"): a node subtree plus
 * everything it references (local mains it instantiates, variables and theme axes it binds,
 * library imports, asset manifest entries), so a paste in another file or window resolves:
 * instances stay instances when the main exists in the target, else they paste detached; local
 * variables are added when the target lacks them; library references keep their import.
 *
 * Pure: building reads a document snapshot; pasting returns ops for one undo step.
 */
import {
  applyPlan,
  type KimoDocument,
  type Libraries,
  type PlanOp,
  planDetachInstance,
  referencedAssets,
} from "@kimo/core-schema"
import { generateId, type NodeData, type Op } from "@kimo/editor-state"
import type { LayoutResult, Rect } from "@kimo/layout"
import { resolveRelativeRef } from "@kimo/platform"
import type { Point } from "@kimo/renderer"
import { unionRects } from "../../canvas/math"
import { remapComponentTargets } from "../m3/component-actions"

/** The payload's custom clipboard type (also embedded in text/html for WebKit). */
export const KIMO_MIME = "application/x-kimo-nodes+json"
/** Marker of the payload embedded in text/html. */
const HTML_ATTR = "data-kimo-clipboard"

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

export interface ClipboardPayload {
  kimo: "kimo/nodes+json"
  v: 1
  /** Copy identifier (asset bytes cached in this window are looked up by it). */
  id: string
  source: { doc: string; page: string | null }
  /** Top-level copied ids, in sibling order. */
  roots: string[]
  /** Copied nodes (subtrees), keyed by their source id; `parent` / `order` / `at` as in the source. */
  nodes: Record<string, Record<string, unknown>>
  /** World boxes of the roots in the source. */
  boxes: Record<string, Rect>
  /** Local components the copy instantiates (main subtrees), by source id, for detaching. */
  mains: Record<string, Record<string, unknown>>
  variables?: Record<string, unknown>
  themes?: Record<string, string[]>
  imports?: Record<string, string>
  features?: string[]
  /** Manifest entries of referenced assets (`<hash>.<ext>` → entry). */
  assets?: Record<string, Record<string, unknown>>
  /** Plain-text fallback (text nodes' content). */
  text: string
}

export interface PayloadSource {
  doc: KimoDocument
  docId: string
  page: string | null
  /** Node reader (the store or the expanded view for ids inside instances). */
  getNode(id: string): NodeData | undefined
  children(id: string | null, at?: string | null): readonly string[]
  layout: LayoutResult | null
}

/** Child groups of a node: regular children plus an instance's slot / replace groups. */
function childGroups(
  src: PayloadSource,
  id: string,
): { at: string | null; ids: readonly string[] }[] {
  const n = src.getNode(id)
  const out = [{ at: null as string | null, ids: src.children(id) }]
  if (n?.type === "instance" && isObj(n.overrides))
    for (const [k, v] of Object.entries(n.overrides))
      if (isObj(v) && (v.slot === true || v.replace === true))
        out.push({ at: k, ids: src.children(id, k) })
  return out
}

/** Every `$ref` binding name in a JSON value (meta subtrees skipped). */
export function bindingNames(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) bindingNames(x, out)
  else if (isObj(v)) {
    const keys = Object.keys(v)
    if (keys.length === 1 && keys[0] === "$ref" && typeof v.$ref === "string") out.add(v.$ref)
    else for (const [k, x] of Object.entries(v)) if (k !== "meta") bindingNames(x, out)
  }
  return out
}

/** Builds the payload of `ids` (top-level, in sibling order). */
export function buildPayload(src: PayloadSource, ids: readonly string[]): ClipboardPayload | null {
  if (!ids.length) return null
  const nodes: Record<string, Record<string, unknown>> = {}
  const walk = (id: string) => {
    const n = src.getNode(id)
    if (!n || Object.hasOwn(nodes, id)) return
    nodes[id] = structuredClone(n) as Record<string, unknown>
    for (const g of childGroups(src, id)) for (const c of g.ids) walk(c)
  }
  for (const id of ids) walk(id)
  const roots = ids.filter((id) => Object.hasOwn(nodes, id))
  const boxes: Record<string, Rect> = {}
  for (const id of roots) {
    const b = src.layout?.nodes.get(id)?.world
    if (b) boxes[id] = { x: b.x, y: b.y, w: b.w, h: b.h }
  }
  // Local mains referenced (transitively) but not copied.
  const all = src.doc.nodes as Record<string, Record<string, unknown>>
  const mains: Record<string, Record<string, unknown>> = {}
  const pending = Object.values(nodes)
  const addMain = (of: unknown) => {
    if (typeof of !== "string" || of.includes(":") || Object.hasOwn(nodes, of)) return
    if (Object.hasOwn(mains, of) || !all[of]) return
    // The main's whole subtree.
    const stack = [of]
    while (stack.length) {
      const id = stack.pop() as string
      if (Object.hasOwn(mains, id) || !all[id]) continue
      mains[id] = structuredClone(all[id]) as Record<string, unknown>
      pending.push(mains[id] as Record<string, unknown>)
      for (const [cid, c] of Object.entries(all)) if (c.parent === id) stack.push(cid)
    }
  }
  for (let i = 0; i < pending.length; i++) {
    const n = pending[i] as Record<string, unknown>
    if (n.type === "instance") addMain(n.of)
    if (isObj(n.overrides))
      for (const ov of Object.values(n.overrides))
        if (isObj(ov) && isObj(ov.set)) addMain(ov.set.of)
  }
  const payload: ClipboardPayload = {
    kimo: "kimo/nodes+json",
    v: 1,
    id: generateId(12),
    source: { doc: src.docId, page: src.page },
    roots,
    nodes,
    boxes,
    mains,
    text: plainText(nodes, roots),
  }
  // Variables bound by the copy (aliases followed).
  const vars = (src.doc.variables ?? {}) as Record<string, unknown>
  const names = bindingNames({ nodes, mains })
  const used: Record<string, unknown> = {}
  const queue = [...names]
  while (queue.length) {
    const name = queue.pop() as string
    if (name.includes(":") || Object.hasOwn(used, name) || !Object.hasOwn(vars, name)) continue
    used[name] = structuredClone(vars[name])
    for (const n of bindingNames(vars[name])) queue.push(n)
  }
  if (Object.keys(used).length) payload.variables = used
  if (src.doc.themes) payload.themes = structuredClone(src.doc.themes) as Record<string, string[]>
  if (src.doc.imports) payload.imports = { ...(src.doc.imports as Record<string, string>) }
  if (src.doc.features?.length) payload.features = [...src.doc.features]
  const refs = referencedAssets({ nodes, mains })
  const manifest = (src.doc.assets ?? {}) as Record<string, Record<string, unknown>>
  if (refs.size) {
    payload.assets = {}
    for (const r of refs) payload.assets[r] = structuredClone(manifest[r] ?? {})
  }
  return payload
}

/** Plain-text fallback: the content of the copied text nodes, one per line, in tree order. */
function plainText(
  nodes: Record<string, Record<string, unknown>>,
  roots: readonly string[],
): string {
  const lines: string[] = []
  const kids = new Map<string, string[]>()
  for (const [id, n] of Object.entries(nodes))
    if (typeof n.parent === "string") kids.set(n.parent, [...(kids.get(n.parent) ?? []), id])
  const sortKids = (list: string[]) =>
    list.sort((a, b) => {
      const oa = String(nodes[a]?.order ?? "")
      const ob = String(nodes[b]?.order ?? "")
      return oa < ob ? -1 : oa > ob ? 1 : a < b ? -1 : a > b ? 1 : 0
    })
  const visit = (id: string) => {
    const n = nodes[id]
    if (!n) return
    if (n.type === "text") {
      const c = n.content
      if (typeof c === "string") lines.push(c)
      else if (Array.isArray(c))
        lines.push(c.map((s) => (isObj(s) && typeof s.text === "string" ? s.text : "")).join(""))
    }
    for (const k of sortKids(kids.get(id) ?? [])) visit(k)
  }
  for (const r of roots) visit(r)
  return lines.join("\n")
}

// --- Encoding ---------------------------------------------------------------------------------

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function fromBase64(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** The payload as clipboard items: the custom type, text/html (embedded) and text/plain. */
export function encodePayload(p: ClipboardPayload): Record<string, string> {
  const json = JSON.stringify(p)
  const html = `<meta charset="utf-8"><span ${HTML_ATTR}="${toBase64(json)}"></span>`
  return { [KIMO_MIME]: json, "text/html": html, "text/plain": p.text }
}

/** Reads a payload from clipboard data (`getData` by type), or null. */
export function decodePayload(get: (type: string) => string): ClipboardPayload | null {
  const tryParse = (s: string): ClipboardPayload | null => {
    try {
      const v = JSON.parse(s) as unknown
      return isObj(v) && v.kimo === "kimo/nodes+json" && v.v === 1 && isObj(v.nodes)
        ? (v as unknown as ClipboardPayload)
        : null
    } catch {
      return null
    }
  }
  const raw = get(KIMO_MIME)
  if (raw) {
    const p = tryParse(raw)
    if (p) return p
  }
  const html = get("text/html")
  const m = html ? new RegExp(`${HTML_ATTR}="([A-Za-z0-9+/=]+)"`).exec(html) : null
  if (m?.[1]) {
    try {
      return tryParse(fromBase64(m[1]))
    } catch {
      return null
    }
  }
  return null
}

// --- Paste ------------------------------------------------------------------------------------

export interface PasteTargetDoc {
  getNode(id: string): NodeData | undefined
  children(id: string | null, at?: string | null): readonly string[]
  header: Omit<KimoDocument, "nodes">
  /** The target document as plain data (detaching instances whose main is missing). */
  doc(): KimoDocument
  /** The target document's id (a copied main pastes as an instance in the same file). */
  docId?: string
  /**
   * Board 27 §8 (d): the import alias under which the target links the copy's source file as a
   * library and holds main `id` (a copied main then pastes as an `alias:id` instance), or null.
   */
  libraryAlias?(sourceDoc: string, id: string): string | null
}

export interface PastePlacement {
  /** "smart": into `parent` (or the page root centred on `center`); "inPlace": source x/y. */
  mode: "smart" | "inPlace"
  parent: string | null
  center: Point
  /** World box of `parent` (free parent: local offsets), when known. */
  parentBox?: Rect | null
  /** World origin of `parent` (for converting world boxes to its local space). */
  parentOrigin?: Point
  /** True when `parent` lays its children out (auto layout). */
  parentFlows?: boolean
}

export interface PasteResult {
  ops: Op[]
  /** New top-level ids (selected afterwards). */
  roots: string[]
  /** The parent the roots went into (null = page root). */
  parent: string | null
  /** Instances pasted detached because their main is not in the target. */
  detached: number
  /** Copied main components pasted as instances of them (§8 d). */
  instanced: number
  /** Asset references the target must have bytes for. */
  assets: string[]
}

const NUDGE = 16

/**
 * Ops pasting `p` into the target. New ids for every node; instances whose main is missing are
 * detached; missing local variables / theme values / imports / features are added to the header.
 */
export function pasteOps(
  copied: ClipboardPayload,
  target: PasteTargetDoc,
  place: PastePlacement,
  newId: () => string = () => generateId(),
): PasteResult {
  const ops: Op[] = []
  let detached = 0
  // 0. Board 27 §8 (d) rule WYOjQ: a copied main pastes as an instance of it — in the same file
  // when the main still exists there, across files as `alias:id` when the target links the
  // source as a library. Otherwise (cut main, unrelated file) the main itself is pasted.
  const mainSwap = mainsAsInstances(copied, target)
  const p = mainSwap.payload
  // 1. Detach instances whose (local) main is not in the target. Detaching re-creates the
  // instance under a new id: copied roots and their boxes follow it.
  let nodes = p.nodes
  const copyRoots = [...p.roots]
  const copyBoxes: Record<string, Rect> = { ...p.boxes }
  const missingMain = (n: Record<string, unknown>) =>
    n.type === "instance" &&
    typeof n.of === "string" &&
    !n.of.includes(":") &&
    !Object.hasOwn(p.nodes, n.of) &&
    !isMainIn(target, n.of)
  const toDetach = Object.entries(nodes)
    .filter(([, n]) => missingMain(n))
    .map(([id]) => id)
  if (toDetach.length) {
    let scratch: KimoDocument = {
      $schema: "https://getkimo.design/schema/kimo-1.0.json",
      format: "1.0.0",
      ...(p.variables ? { variables: p.variables as KimoDocument["variables"] } : {}),
      ...(p.themes ? { themes: p.themes } : {}),
      ...(p.imports ? { imports: p.imports } : {}),
      nodes: { ...structuredClone(p.mains), ...structuredClone(nodes) } as KimoDocument["nodes"],
    }
    // Copied roots become scratch roots.
    for (const id of p.roots) {
      const n = scratch.nodes[id] as Record<string, unknown> | undefined
      if (n) n.parent = null
    }
    // Outer instances first: detaching one re-creates its nested instances as plain nodes.
    const order = toDetach.sort((a, b) => depth(scratch, a) - depth(scratch, b))
    for (const id of order) {
      if (scratch.nodes[id]?.type !== "instance") continue
      const plan = planDetachInstance({ doc: scratch }, id)
      if (!plan.ok) continue
      scratch = applyPlan(scratch, plan.ops as PlanOp[])
      detached++
      const replaced = plan.select?.[0]
      const at = copyRoots.indexOf(id)
      if (replaced && at >= 0) {
        copyRoots[at] = replaced
        const box = copyBoxes[id]
        if (box) copyBoxes[replaced] = box
        const orig = p.nodes[id]
        const rn = scratch.nodes[replaced] as Record<string, unknown> | undefined
        // Keep the copied root's original parent (paste in place reads it).
        if (rn && orig) rn.parent = orig.parent ?? null
      }
    }
    const kept: Record<string, Record<string, unknown>> = {}
    const inCopy = (id: string): boolean => {
      let cur: string | null = id
      for (let g = 0; cur && g < 4096; g++) {
        if (copyRoots.includes(cur)) return true
        const n = scratch.nodes[cur] as Record<string, unknown> | undefined
        cur = n && typeof n.parent === "string" ? n.parent : null
      }
      return false
    }
    for (const [id, n] of Object.entries(scratch.nodes))
      if (inCopy(id)) kept[id] = n as Record<string, unknown>
    // Roots were made scratch roots: give them their source parent back.
    for (const id of copyRoots) {
      const k = kept[id]
      const orig = p.nodes[id]
      if (k && orig) k.parent = orig.parent ?? null
    }
    nodes = kept
  }

  // 2. New ids.
  const ids = new Map<string, string>()
  for (const id of Object.keys(nodes)) ids.set(id, newId())
  const remap = (id: unknown) => (typeof id === "string" ? (ids.get(id) ?? id) : id)

  // 3. Header: variables, themes, imports, features the copy needs.
  const header = target.header
  const vars = { ...((header.variables ?? {}) as Record<string, unknown>) }
  let varsChanged = false
  for (const [name, v] of Object.entries(p.variables ?? {})) {
    if (Object.hasOwn(vars, name)) continue
    vars[name] = v
    varsChanged = true
  }
  if (varsChanged) {
    const add: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(vars))
      if (!Object.hasOwn((header.variables ?? {}) as object, k)) add[k] = v
    ops.push({ op: "setVariables", set: add as never })
  }
  if (p.themes) {
    const cur = (header.themes ?? {}) as Record<string, string[]>
    const set: Record<string, string[]> = {}
    for (const [axis, values] of Object.entries(p.themes)) {
      const have = cur[axis]
      if (!have) set[axis] = [...values]
      else {
        const extra = values.filter((v) => !have.includes(v))
        if (extra.length) set[axis] = [...have, ...extra]
      }
    }
    if (Object.keys(set).length) ops.unshift({ op: "setThemes", set })
  }
  const headerSet: Record<string, unknown> = {}
  if (p.imports) {
    const cur = (header.imports ?? {}) as Record<string, string>
    const usedAliases = new Set<string>()
    const scan = (v: unknown) => {
      const s = JSON.stringify(v)
      for (const m of s.matchAll(/"([A-Za-z][A-Za-z0-9_-]{0,31}):[A-Za-z0-9]/g))
        usedAliases.add(m[1] as string)
    }
    scan(nodes)
    const next = { ...cur }
    let changed = false
    for (const a of usedAliases)
      if (!Object.hasOwn(cur, a) && p.imports[a]) {
        next[a] = p.imports[a] as string
        changed = true
      }
    if (changed) headerSet.imports = next
  }
  if (p.features?.length) {
    const cur = new Set(header.features ?? [])
    const add = p.features.filter((f) => !cur.has(f))
    if (add.length) headerSet.features = [...cur, ...add].sort()
  }
  if (Object.keys(headerSet).length) ops.unshift({ op: "setHeader", set: headerSet })

  // 4. Placement.
  const roots = copyRoots.filter((id) => Object.hasOwn(nodes, id))
  const boxes = roots.map((id) => copyBoxes[id]).filter((b): b is Rect => !!b)
  const block = unionRects(boxes)
  let parent = place.parent
  if (place.mode === "inPlace") {
    // Original parent when it exists here (and can hold children); else the page root.
    const first = nodes[roots[0] as string]
    const orig = typeof first?.parent === "string" ? first.parent : null
    const on = orig ? target.getNode(orig) : undefined
    parent = on && (on.type === "frame" || on.type === "group") ? orig : null
  }
  const newRoots: string[] = []
  const siblings = parent ? target.children(parent).map((id) => target.getNode(id)) : []
  for (const id of roots) {
    const n = nodes[id] as Record<string, unknown>
    const body = structuredClone(n)
    const box = copyBoxes[id]
    const sameParentInPlace = place.mode === "inPlace" && parent !== null
    delete body.order
    delete body.at
    delete body.page
    body.parent = parent
    if (sameParentInPlace) {
      // Keep the source x/y in the original parent.
    } else if (parent === null) {
      if (place.mode === "inPlace") {
        if (box) {
          body.x = round(box.x)
          body.y = round(box.y)
        }
      } else if (box && block) {
        body.x = round(place.center.x - block.w / 2 + (box.x - block.x))
        body.y = round(place.center.y - block.h / 2 + (box.y - block.y))
      }
    } else if (!place.parentFlows) {
      // Free parent: same offset as copied, nudged +16 until it covers no identical sibling.
      let x = typeof n.x === "number" ? n.x : 0
      let y = typeof n.y === "number" ? n.y : 0
      const covers = () =>
        siblings.some(
          (s) =>
            s &&
            s.type === n.type &&
            s.x === x &&
            s.y === y &&
            JSON.stringify(s.w) === JSON.stringify(n.w) &&
            JSON.stringify(s.h) === JSON.stringify(n.h),
        )
      for (let g = 0; covers() && g < 64; g++) {
        x += NUDGE
        y += NUDGE
      }
      body.x = round(x)
      body.y = round(y)
    }
    const nid = ids.get(id) as string
    newRoots.push(nid)
    ops.push({ op: "insert", id: nid, parent, node: rewrite(body, remap) })
  }
  // Descendants, parents before children (copied order keys kept).
  const ordered = Object.keys(nodes)
    .filter((id) => !roots.includes(id))
    .sort((a, b) => depthIn(nodes, a) - depthIn(nodes, b))
  for (const id of ordered) {
    const n = nodes[id] as Record<string, unknown>
    const body = rewrite(structuredClone(n), remap)
    body.parent = remap(n.parent)
    delete body.page
    ops.push({ op: "insert", id: ids.get(id) as string, node: body })
  }
  return {
    ops,
    roots: newRoots,
    parent,
    detached,
    instanced: mainSwap.count,
    assets: [...referencedAssets({ nodes })],
  }
}

const round = (v: number) => Math.round(v * 100) / 100

/** Copied root mains → instances of them (see {@link pasteOps} step 0). */
function mainsAsInstances(
  p: ClipboardPayload,
  target: PasteTargetDoc,
): { payload: ClipboardPayload; count: number } {
  const sameFile = target.docId !== undefined && target.docId === p.source.doc
  const swap = new Map<string, string>()
  for (const id of p.roots) {
    const n = p.nodes[id]
    if (!n || n.component === undefined || n.component === false) continue
    if (sameFile && isMainIn(target, id)) swap.set(id, id)
    else if (!sameFile) {
      const alias = target.libraryAlias?.(p.source.doc, id) ?? null
      if (alias) swap.set(id, `${alias}:${id}`)
    }
  }
  if (!swap.size) return { payload: p, count: 0 }
  const nodes: Record<string, Record<string, unknown>> = {}
  const dropped = (id: string): boolean => {
    let cur = p.nodes[id]
    for (let g = 0; cur && typeof cur.parent === "string" && g < 4096; g++) {
      if (swap.has(cur.parent)) return true
      cur = p.nodes[cur.parent]
    }
    return false
  }
  const key = (id: string) => (swap.has(id) ? `${id}~instance` : id)
  for (const [id, n] of Object.entries(p.nodes)) {
    if (dropped(id)) continue
    const of = swap.get(id)
    if (of === undefined) {
      nodes[id] = n
      continue
    }
    const inst: Record<string, unknown> = { type: "instance", of }
    for (const k of ["parent", "order", "at", "page", "x", "y", "position", "rotation"])
      if (n[k] !== undefined) inst[k] = n[k]
    nodes[key(id)] = inst
  }
  const boxes: Record<string, Rect> = {}
  for (const [id, b] of Object.entries(p.boxes)) boxes[key(id)] = b
  return {
    payload: { ...p, nodes, roots: p.roots.map(key), boxes },
    count: swap.size,
  }
}

/** Rewrites id references inside a copied node (prompt `target`). */
function rewrite(
  n: Record<string, unknown>,
  remap: (id: unknown) => unknown,
): Record<string, unknown> {
  if (n.type === "prompt" && typeof n.target === "string") n.target = remap(n.target)
  if (n.type === "instance" && typeof n.of === "string") n.of = remap(n.of)
  // A pasted main's prop targets name its own (re-id'd) layers.
  if (isObj(n.component))
    n.component = remapComponentTargets(n.component, (id) => {
      const to = remap(id)
      return typeof to === "string" && to !== id ? to : undefined
    })
  return n
}

function isMainIn(target: PasteTargetDoc, id: string): boolean {
  const n = target.getNode(id)
  return !!n && n.component !== undefined && n.component !== false
}

function depth(doc: KimoDocument, id: string): number {
  let d = 0
  let cur = doc.nodes[id] as Record<string, unknown> | undefined
  while (cur && typeof cur.parent === "string" && d < 4096) {
    d++
    cur = doc.nodes[cur.parent] as Record<string, unknown> | undefined
  }
  return d
}

function depthIn(nodes: Record<string, Record<string, unknown>>, id: string): number {
  let d = 0
  let cur = nodes[id]
  while (cur && typeof cur.parent === "string" && nodes[cur.parent] && d < 4096) {
    d++
    cur = nodes[cur.parent]
  }
  return d
}

/**
 * The import alias under which `targetDoc` links `sourceDoc` as a library (paths resolved
 * relative to the target file) and whose loaded copy holds main `id`; null otherwise.
 */
export function libraryAliasFor(
  targetDoc: string,
  header: Omit<KimoDocument, "nodes">,
  libraries: Libraries,
  sourceDoc: string,
  id: string,
): string | null {
  for (const [alias, rel] of Object.entries((header.imports ?? {}) as Record<string, string>)) {
    let abs: string
    try {
      abs = resolveRelativeRef(targetDoc, rel)
    } catch {
      continue
    }
    if (abs !== sourceDoc) continue
    const main = libraries[alias]?.nodes?.[id] as Record<string, unknown> | undefined
    if (main && main.component !== undefined && main.component !== false) return alias
  }
  return null
}
