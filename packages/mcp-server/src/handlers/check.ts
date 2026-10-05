/**
 * Design check (board 31 "Check"): clear structural and layout problems in what an agent just
 * built, from the layout the tools already compute. kimo_apply_ops lists them for the layers a
 * call changed so the agent can fix them before moving on; kimo_validate {check: true} lists
 * them for the whole document (plus placeholders still set) so it can finish with none.
 *
 * Only clear problems are reported, never taste: a frame with no layers that paints nothing, a
 * zero-size layer, text that does not fit its box or is cut by a clipping parent, a layer hidden
 * by or outside its parent, content overflowing a fixed-size auto-layout frame, text stacked on
 * text without auto layout, a binding to a missing variable and a shape that paints nothing.
 */
import { isObject, isRef, splitQualified } from "@kimo/core-schema"
import type { LayoutResult, NodeLayout, Rect } from "@kimo/layout"

export type CheckKind =
  | "empty"
  | "zero-size"
  | "text-overflow"
  | "clipped"
  | "outside"
  | "overflow"
  | "overlap"
  | "missing-variable"
  | "invisible"
  | "placeholder"

export interface CheckProblem {
  id: string
  kind: CheckKind
  /** What is wrong and how to fix it, one short clause. */
  fix: string
}

/** What the check reads: the committed store (structurally a `DocStore`). */
export interface CheckSource {
  getNode(id: string): Readonly<Record<string, unknown>> | undefined
  children(parent: string | null): readonly string[]
  toHeader(): { variables?: unknown; imports?: unknown }
}

export interface CheckOptions {
  /** Only these nodes (default: every node). */
  ids?: Iterable<string>
  /** Also report frames whose `placeholder` is still set (the end-of-work check). */
  placeholders?: boolean
}

/** Lines in a kimo_apply_ops result (the rest is summed up in one line). */
export const CHECK_MAX_LINES = 8
/** Lines in a kimo_validate {check: true} result. */
export const CHECK_MAX_LIST = 40

/** Node types the check never looks at (human notes, prompts, embedded content). */
const SKIP_TYPES = new Set(["note", "prompt", "script", "browser"])
/** Shapes that render only their own paints. */
const SHAPES = new Set(["rect", "ellipse", "polygon", "path"])
const EPS = 1

const round = (v: number) => Math.round(v)

function label(n: Readonly<Record<string, unknown>>): string {
  const name = typeof n.name === "string" && n.name ? n.name : String(n.type)
  return name.length > 40 ? `${name.slice(0, 39)}…` : name
}

/** False for a paint that draws nothing: hidden, opacity 0 or a fully transparent color. */
function paintShows(p: unknown): boolean {
  if (p === null || p === undefined) return false
  if (isRef(p)) return true
  if (typeof p === "string") {
    const s = p.trim().toLowerCase()
    if (s === "transparent" || s === "none") return false
    if (/^#[0-9a-f]{4}$/.test(s)) return s[4] !== "0"
    if (/^#[0-9a-f]{8}$/.test(s)) return s.slice(7) !== "00"
    return true
  }
  if (!isObject(p)) return true
  if (p.visible === false || p.opacity === 0 || p.alpha === 0) return false
  if (isObject(p.color)) return paintShows(p.color)
  if (typeof p.color === "string") return paintShows(p.color)
  return true
}

function paintsShow(v: unknown): boolean {
  if (v === undefined || v === null) return false
  return Array.isArray(v) ? v.some(paintShows) : paintShows(v)
}

function strokeShows(s: unknown): boolean {
  if (!isObject(s) || !paintsShow(s.paint)) return false
  const w = s.width
  if (typeof w === "number") return w > 0
  if (isObject(w) && !isRef(w)) return Object.values(w).some((x) => typeof x === "number" && x > 0)
  return true
}

/** True when the node itself paints something (fill, stroke or effects). */
function paints(n: Readonly<Record<string, unknown>>): boolean {
  return (
    paintsShow(n.fill) ||
    strokeShows(n.stroke) ||
    (Array.isArray(n.effects) && n.effects.some((e) => isObject(e) && e.visible !== false))
  )
}

/** Variable names a node binds (`{$ref}` anywhere in its fields), unqualified ones only. */
function refsOf(v: unknown, out: Set<string>, depth = 0): void {
  if (depth > 8) return
  if (isRef(v)) {
    const { alias, name } = splitQualified(v.$ref)
    if (alias === null) out.add(name)
    return
  }
  if (Array.isArray(v)) for (const x of v) refsOf(x, out, depth + 1)
  else if (isObject(v)) for (const x of Object.values(v)) refsOf(x, out, depth + 1)
}

function intersect(a: Rect, b: Rect): { w: number; h: number } {
  return {
    w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
    h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
  }
}

/**
 * Problems of the nodes in `options.ids` (default: all), in document order, at most one per
 * node (the first that applies). Nodes the layout did not reach, hidden nodes and the inside of
 * instances are skipped.
 */
export function checkDesign(
  src: CheckSource,
  layout: LayoutResult | null,
  options: CheckOptions = {},
): CheckProblem[] {
  if (!layout) return []
  const scope = options.ids ? new Set(options.ids) : null
  const variables = (src.toHeader().variables ?? {}) as Record<string, unknown>
  const order = scope
    ? layout.order.filter((id) => scope.has(id))
    : layout.order.filter((id) => !id.includes("/"))
  const out: CheckProblem[] = []
  const add = (id: string, kind: CheckKind, fix: string) => out.push({ id, kind, fix })
  const lay = (id: string): NodeLayout | undefined => layout.nodes.get(id)

  for (const id of order) {
    const n = src.getNode(id)
    const l = lay(id)
    // Slot frames are empty on purpose (instances fill them).
    if (n && isObject(n.slot)) continue
    if (!n || !l?.visible || SKIP_TYPES.has(String(n.type)) || n.type === "instance") {
      if (n && l?.visible && n.type === "instance") checkRefs(id, n)
      continue
    }
    const parentId = typeof n.parent === "string" ? n.parent : null
    const parent = parentId ? src.getNode(parentId) : undefined
    const pl = parentId ? lay(parentId) : undefined
    const kids = src.children(id).filter((c) => {
      const cn = src.getNode(c)
      return cn && cn.visible !== false
    })
    const w = l.local.w
    const h = l.local.h
    const name = label(n)
    const before = out.length

    // A frame with nothing in it that paints nothing (a skeleton or placeholder-only box).
    if (n.type === "frame" && kids.length === 0 && !paints(n))
      add(
        id,
        "empty",
        `frame "${name}" has no layers and paints nothing: build its content or delete it`,
      )
    else if (n.type === "group" && kids.length === 0)
      add(id, "empty", `group "${name}" is empty: delete it`)
    // Zero or negative size (a line drawn as a stroked path may be flat on one axis).
    else if (
      (w <= 0 || h <= 0) &&
      !(n.type === "path" && strokeShows(n.stroke) && (w > 0 || h > 0))
    )
      add(
        id,
        "zero-size",
        n.type === "text"
          ? `text "${name}" is ${round(w)}×${round(h)}: give it content or delete it`
          : `"${name}" is ${round(w)}×${round(h)}: give it a size, or children if it fits its content`,
      )
    // A shape with no visible fill, stroke or effect renders nothing.
    else if (SHAPES.has(String(n.type)) && !paints(n))
      add(
        id,
        "invisible",
        `${n.type} "${name}" has no visible fill or stroke: add a fill or delete it`,
      )
    else if (n.type === "text" && l.text) {
      const t = l.text
      if (t.h > h + EPS)
        add(
          id,
          "text-overflow",
          `text "${name}" needs ${round(t.h)} px of height but its box is ${round(h)}: use grow "fixed-width" (height from content) or a taller box`,
        )
      else if (t.w > w + EPS && n.grow !== undefined && n.grow !== "auto")
        add(
          id,
          "text-overflow",
          `text "${name}" needs ${round(t.w)} px of width but its box is ${round(w)}: widen it or shorten the text`,
        )
    }

    if (out.length === before && parent && pl?.visible) {
      const a = l.world
      const b = pl.world
      const i = intersect(a, b)
      const pname = label(parent)
      if (parent.clip === true && (i.w <= 0 || i.h <= 0))
        add(
          id,
          "clipped",
          `"${name}" is fully hidden by "${pname}" (clip): move it inside or turn clip off`,
        )
      else if (parent.clip === true && n.type === "text" && (i.w < a.w - EPS || i.h < a.h - EPS))
        add(
          id,
          "clipped",
          `text "${name}" is cut off by "${pname}" (clip): give "${pname}" fit height or room for it`,
        )
      else if (
        parent.type === "frame" &&
        parent.clip !== true &&
        (i.w <= 0 || i.h <= 0) &&
        a.w > 0 &&
        a.h > 0
      )
        add(id, "outside", `"${name}" lies outside its parent "${pname}": fix its x/y or parent`)
    }

    // Content spilling out of an auto-layout frame (a fixed size too small for it).
    if (out.length === before && n.type === "frame" && n.layout !== undefined && n.clip !== true) {
      const need = { w: 0, h: 0, over: false }
      for (const c of kids) {
        const cl = lay(c)
        if (!cl?.visible || cl.inFlow === false) continue
        const a = cl.world
        const b = l.world
        if (a.x + a.w > b.x + b.w + EPS || a.y + a.h > b.y + b.h + EPS) {
          need.over = true
          need.w = Math.max(need.w, a.x + a.w - b.x)
          need.h = Math.max(need.h, a.y + a.h - b.y)
        }
      }
      if (need.over) {
        const axis =
          need.h > h + EPS
            ? `${round(need.h)} px tall, box ${round(h)}`
            : `${round(need.w)} px wide, box ${round(w)}`
        add(
          id,
          "overflow",
          `content of "${name}" overflows it (${axis}): use fit size or make it larger`,
        )
      }
    }

    // Text stacked on text without auto layout.
    if (out.length === before && n.type === "text" && parent && parentId && l.inFlow !== true) {
      for (const s of src.children(parentId)) {
        if (s === id) break
        const sn = src.getNode(s)
        const sl = lay(s)
        if (sn?.type !== "text" || !sl?.visible || sl.inFlow === true) continue
        const i = intersect(l.world, sl.world)
        const small = Math.min(l.world.w * l.world.h, sl.world.w * sl.world.h)
        if (i.w > 0 && i.h > 0 && small > 0 && (i.w * i.h) / small > 0.3) {
          add(
            id,
            "overlap",
            `text "${name}" overlaps text "${label(sn)}" in "${label(parent)}": use auto layout or move it`,
          )
          break
        }
      }
    }

    if (out.length === before) checkRefs(id, n)
    if (
      out.length === before &&
      options.placeholders &&
      n.placeholder !== undefined &&
      n.placeholder !== false
    )
      add(
        id,
        "placeholder",
        `"${name}" is still marked placeholder: unset placeholder when it is finished`,
      )
  }
  return out

  function checkRefs(id: string, n: Readonly<Record<string, unknown>>) {
    const refs = new Set<string>()
    refsOf(n, refs)
    for (const r of refs)
      if (!Object.hasOwn(variables, r)) {
        add(
          id,
          "missing-variable",
          `"${label(n)}" binds variable "${r}", which does not exist: create it or bind an existing one`,
        )
        return
      }
  }
}

/** One compact line per problem (`<id> <kind>: <fix>`), at most `max`, then a count line. */
export function formatProblems(list: readonly CheckProblem[], max = CHECK_MAX_LINES): string[] {
  const lines = list.slice(0, max).map((p) => `${p.id} ${p.kind}: ${p.fix}`)
  if (list.length > max) lines.push(`+${list.length - max} more`)
  return lines
}
