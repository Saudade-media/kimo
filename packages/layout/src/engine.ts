/**
 * The Yoga layout engine (ADR 0004, ADR 0009; spec §6, §8.1).
 *
 * Model: every reachable node gets an {@link Entry} and a persistent Yoga node. Only the
 * *flowing* children of a frame with `layout` (visible, not `position: "absolute"`) are Yoga
 * children; every other node is the root of its own Yoga tree, placed by `x`/`y`. Frames
 * without layout and groups are Yoga leaves whose measure function returns the bounding box
 * of their (already laid-out) children, so a `fit` frame can sit in a flex row. Text is a leaf
 * measured through the {@link TextMeasurer}.
 *
 * A pass computes the Yoga roots in post-order (children first, so a container's content box
 * is known before its own tree is laid out), then walks the entries to produce `local`,
 * `transform` and `world` in double precision. `update` re-reads only dirty nodes, re-syncs the
 * child lists of their parents, lets Yoga's own dirty flags limit the recomputation, and
 * re-emits only the subtrees whose inputs or Yoga layout changed.
 */
import {
  type ExpandedView,
  type ExpansionIssue,
  isObject,
  isRef,
  parseVirtualId,
} from "@kimo/core-schema"
import {
  Align,
  Direction,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  loadYoga,
  MeasureMode,
  Wrap,
  type Config as YConfig,
  type Node as YNode,
  type Yoga,
} from "yoga-layout/load"
import { createInstanceView, type InstanceView, isExpandedView, isInstanceView } from "./expand"
import {
  fromF32,
  IDENTITY,
  localMatrix,
  matrixEquals,
  multiply,
  pathBounds,
  rectEquals,
  transformedBounds,
} from "./geometry"
import { resolveText } from "./resolve"
import type {
  AppliedSizing,
  DirtySet,
  LayoutEngine,
  LayoutEngineOptions,
  LayoutInput,
  LayoutIssue,
  LayoutIssueCode,
  LayoutNodeData,
  LayoutResult,
  Matrix,
  NodeLayout,
  Rect,
  Resolver,
  TextMeasureInput,
  TextMetrics,
} from "./types"
import { INSTANCE_PLACEHOLDER_SIZE } from "./types"

// --- Entries ------------------------------------------------------------------------------

type Kind = "layout" | "box" | "group" | "text" | "leaf"
type Axis = "w" | "h"

type SizeSpec =
  | { mode: "fixed"; v: number }
  | { mode: "fit"; fallback?: number; min?: number; max?: number }
  | { mode: "fill"; weight: number; fallback?: number; min?: number; max?: number }

interface Content {
  empty: boolean
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const EMPTY: Content = { empty: true, minX: 0, minY: 0, maxX: 0, maxY: 0 }

interface Entry {
  id: string
  data: LayoutNodeData
  parent: Entry | null
  children: Entry[]
  y: YNode
  alive: boolean
  // read from data (readFlags)
  kind: Kind
  dir: "row" | "column" | null
  /** Main-axis gap as written (negative gaps are emulated with margins). */
  gap: number
  visibleSelf: boolean
  absolute: boolean
  // set by the parent's attach()
  flow: boolean
  flowIndex: number
  attached: Entry[]
  // set by applyStyle()
  measured: boolean
  /** Kind whose measure function is installed (text or box). */
  measureKind: Kind | null
  style: Record<string, unknown>
  emptyW: number | undefined
  emptyH: number | undefined
  text: TextMeasureInput | null
  autoText: boolean
  textCache: Map<number | undefined, TextMetrics>
  issues: LayoutIssue[]
  // set by a pass
  content: Content
  /** Group content origin the children were last emitted against. */
  originX: number
  originY: number
  layout: NodeLayout | null
  // M2 (ADR 0010): inputs of NodeLayout.sizing/content, set by applyStyle()
  /** Sizing mode written per axis, after the text/path rules (`fixed` when a size is set). */
  specW: SpecMode
  specH: SpecMode
  /** Padding (with `includeStroke`) of a frame with layout, t/r/b/l. */
  pad: [number, number, number, number]
  /** Set by emit(): applied sizing, and the FIT_ALL_FILL flags its children were emitted with. */
  applied: Sizing | null
  kidsAllFill: string
}

type Sizing = { readonly w: AppliedSizing; readonly h: AppliedSizing }
const MODES: readonly AppliedSizing[] = ["fixed", "fit", "fill"]
/** Shared, frozen `NodeLayout.sizing` values (no allocation per emitted node). */
const SIZING = Object.fromEntries(
  MODES.map((w) => [w, Object.fromEntries(MODES.map((h) => [h, Object.freeze({ w, h })]))]),
) as Record<AppliedSizing, Record<AppliedSizing, Sizing>>

/** What applyStyle() saw on one axis: `fill+` = fill with a fallback. */
type SpecMode = "fixed" | "fit" | "fill" | "fill+"

const TEXT_TYPES = new Set(["text", "note", "prompt"])
/** Data keys whose bound values the engine resolves (see `isBound`). */
const BOUND_LAYOUT_KEYS = ["w", "h", "visible", "layout", "stroke", "content", "style", "props"]
const LEAF_TYPES = new Set(["rect", "ellipse", "polygon", "path", "icon", "script", "browser"])
const FIT_BY_DEFAULT = new Set(["frame", "group", "text", "note", "prompt", "instance"])

const JUSTIFY: Record<string, Justify> = {
  start: Justify.FlexStart,
  center: Justify.Center,
  end: Justify.FlexEnd,
  between: Justify.SpaceBetween,
  around: Justify.SpaceAround,
  evenly: Justify.SpaceEvenly,
}
const ALIGN: Record<string, Align> = {
  start: Align.FlexStart,
  center: Align.Center,
  end: Align.FlexEnd,
  stretch: Align.Stretch,
  baseline: Align.Baseline,
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined

/** Creates the Yoga layout engine. Call `init()` before use. */
export function createLayoutEngine(options: LayoutEngineOptions = {}): LayoutEngine {
  let Y: Yoga | null = null
  let config: YConfig | null = null
  let initPromise: Promise<void> | null = null

  let entries = new Map<string, Entry>()
  let roots: Entry[] = []
  let current: LayoutResult | null = null
  let version = 0
  /** The engine's own view when the host passes neither `expanded` nor a view as `nodes`. */
  let own: { base: unknown; view: InstanceView } | null = null
  /**
   * Dependency index of the last expansion of every top-level instance (M3): the real ids its
   * expansion read (its own real subtree, every authored source node, every component in its
   * chains). An edit of any of them, or of a node below one, re-expands that instance.
   */
  const topDeps = new Map<string, string[]>()
  const depTops = new Map<string, Set<string>>()
  /** Tops whose dependency entries must be rebuilt at the end of the pass. */
  let reindex = new Set<string>()
  /** `InstanceView.stamp` of each indexed top when it was indexed (kept expansion = same). */
  const topStamp = new Map<string, number>()
  /**
   * False while a pass runs (and after one threw): the next `compute` rebuilds from scratch
   * instead of refreshing entries that may be half-updated.
   */
  let healthy = false
  /** `TextMeasurer.generation` of the last pass (undefined: unknown, re-measure all text). */
  let textGeneration: number | undefined
  /** Node data objects that hold a `{ $ref }` binding anywhere (perf: one deep scan each). */
  const boundCache = new WeakMap<object, boolean>()

  // Per-pass state.
  let src!: ExpandedView
  let resolve!: Resolver
  let input!: LayoutInput
  let fresh = new Set<Entry>()

  // --- Issues & resolution ----------------------------------------------------------------

  const issue = (
    e: Entry,
    code: LayoutIssueCode,
    message: string,
    path?: string,
    severity: LayoutIssue["severity"] = "warning",
  ) => {
    const i: LayoutIssue = { code, severity, nodeId: e.id, message }
    if (path !== undefined) i.path = path
    e.issues.push(i)
    options.onIssue?.(i)
  }

  /** Resolves a possibly bound value for `e`, recording unresolved bindings. */
  const value = (e: Entry, v: unknown, path?: string): unknown => {
    if (!isRef(v)) return v
    const r = resolve.value(e.id, v)
    if (r === undefined) issue(e, "VARIABLE_UNRESOLVED", `unresolved binding ${v.$ref}`, path)
    return r
  }

  /** A resolver that records unresolved bindings on `e` (for `resolveText`). */
  const recording = (e: Entry): Resolver => ({
    theme: (id) => resolve.theme(id),
    value: (_id, v) => value(e, v, "/style"),
    invalidate: (ids) => resolve.invalidate(ids),
  })

  /** Maps a core-schema expansion issue onto a layout issue of `e` (§9.8). */
  const expansionIssue = (e: Entry, x: ExpansionIssue) => {
    switch (x.code) {
      case "INSTANCE_CYCLE":
        issue(e, "CYCLE", x.message, "/of", "error")
        return
      case "COMPONENT_MISSING":
      case "NOT_A_COMPONENT":
      case "ALIAS_UNKNOWN":
      case "LIBRARY_NOT_LOADED":
        issue(e, "INSTANCE_UNRESOLVED", x.message, "/of")
        return
      default:
        // OVERRIDE_PATH_UNRESOLVED: the validator reports it; layout is unaffected.
        return
    }
  }

  // --- Building -----------------------------------------------------------------------------

  const readFlags = (e: Entry) => {
    const n = e.data
    const t = n.type
    const layout = n.layout
    const dir =
      t === "frame" && isObject(layout) && (layout.dir === "row" || layout.dir === "column")
        ? layout.dir
        : null
    e.dir = dir
    e.kind =
      dir !== null
        ? "layout"
        : t === "frame"
          ? "box"
          : t === "group"
            ? "group"
            : TEXT_TYPES.has(t)
              ? "text"
              : "leaf"
    e.gap = 0
    if (dir !== null && isObject(layout)) {
      // Resolved without recording; applyStyle records issues for the same value.
      const g = isRef(layout.gap) ? resolve.value(e.id, layout.gap) : layout.gap
      e.gap = num(g) ?? 0
    }
    const vis = isRef(n.visible) ? resolve.value(e.id, n.visible) : n.visible
    e.visibleSelf = vis !== false
    e.absolute = n.position === "absolute"
  }

  const newEntry = (id: string, data: LayoutNodeData, parent: Entry | null): Entry => {
    const e: Entry = {
      id,
      data,
      parent,
      children: [],
      y: (Y as Yoga).Node.create(config as YConfig),
      alive: true,
      kind: "leaf",
      dir: null,
      gap: 0,
      visibleSelf: true,
      absolute: false,
      flow: false,
      flowIndex: -1,
      attached: [],
      measured: false,
      measureKind: null,
      style: {},
      emptyW: undefined,
      emptyH: undefined,
      text: null,
      autoText: false,
      textCache: new Map(),
      issues: [],
      content: EMPTY,
      originX: 0,
      originY: 0,
      layout: null,
      specW: "fixed",
      specH: "fixed",
      pad: [0, 0, 0, 0],
      applied: null,
      kidsAllFill: "",
    }
    readFlags(e)
    return e
  }

  /** True when `a` is `from` or one of its ancestors in the current node data. */
  const dataAncestor = (a: string, from: string): boolean => {
    const seen = new Set<string>()
    for (let p: unknown = from; typeof p === "string" && !seen.has(p); ) {
      if (p === a) return true
      seen.add(p)
      p = src.getNode(p)?.parent
    }
    return false
  }

  /**
   * Creates entries for `id` and its subtree. With `reuse`, an existing entry (a node moved in
   * this change) is adopted instead; otherwise a second visit of an id is a cycle.
   */
  const build = (id: string, parent: Entry | null, reuse: boolean): Entry | null => {
    const existing = entries.get(id)
    if (existing) {
      // Moved nodes are adopted; a cycle is judged on the new parent chain, not on entry
      // parent pointers that may still be stale in this pass (a parent and child swapped in
      // one change, or a refresh across documents).
      if (!reuse || (parent && dataAncestor(id, parent.id))) {
        if (parent)
          issue(parent, "CYCLE", `node ${id} is reachable twice (cycle)`, undefined, "error")
        return null
      }
      existing.parent = parent
      return existing
    }
    const n = src.getNode(id)
    if (!n || typeof n !== "object") return null
    const e = newEntry(id, n, parent)
    entries.set(id, e)
    fresh.add(e)
    for (const c of src.children(id)) {
      const ce = build(c, e, reuse)
      if (ce) e.children.push(ce)
    }
    return e
  }

  // --- Yoga configuration -----------------------------------------------------------------

  const setMeasure = (e: Entry, on: boolean) => {
    // A kind change (box ⇄ text, e.g. an id re-inserted with another type) swaps the function.
    if (on === e.measured && (!on || e.measureKind === e.kind)) return
    e.measureKind = on ? e.kind : null
    if (on) {
      if (e.kind === "text") e.y.setMeasureFunc((w, wm, h, hm) => measureTextFn(e, w, wm, h, hm))
      else e.y.setMeasureFunc((w, wm, h, hm) => measureBoxFn(e, w, wm, h, hm))
    } else e.y.unsetMeasureFunc()
    e.measured = on
  }

  /** Re-attaches the flowing children of `e` as its Yoga children (after detach()). */
  const attach = (e: Entry) => {
    if (e.kind === "layout") setMeasure(e, false)
    let i = 0
    for (const c of e.children) {
      c.flow = e.kind === "layout" && c.visibleSelf && !c.absolute
      c.flowIndex = c.flow ? i : -1
      if (c.flow) e.y.insertChild(c.y, i++)
    }
    e.attached = e.children.filter((c) => c.flow)
  }

  const detach = (e: Entry) => {
    for (const c of e.attached) e.y.removeChild(c.y)
    e.attached = []
  }

  /** Calls a Yoga setter only when the value changed since the last call. */
  const put = <T>(e: Entry, key: string, v: T, apply: (v: T) => void) => {
    if (e.style[key] === v && Object.hasOwn(e.style, key)) return
    e.style[key] = v
    apply(v)
  }

  const sizeSpec = (e: Entry, axis: Axis): SizeSpec => {
    const n = e.data
    let raw = n[axis]
    if (n.type === "instance") {
      // Only an unresolved instance still reads as `instance` (a placeholder, §9.8).
      raw = isObject(n.props) ? n.props[axis] : undefined
      if (raw === undefined) return { mode: "fixed", v: INSTANCE_PLACEHOLDER_SIZE[axis] }
    }
    if (raw === undefined) {
      if (n.type === "path") return { mode: "fixed", v: pathSize(e, axis) }
      if (FIT_BY_DEFAULT.has(n.type)) return { mode: "fit" }
      if (LEAF_TYPES.has(n.type)) issue(e, "INVALID_SIZE", `${n.type} requires ${axis}`, `/${axis}`)
      return { mode: "fixed", v: 0 }
    }
    const v = value(e, raw, `/${axis}`)
    if (typeof v === "number") {
      if (Number.isFinite(v) && v >= 0) return { mode: "fixed", v }
      issue(e, "INVALID_SIZE", `invalid ${axis}: ${v}`, `/${axis}`)
      return { mode: "fixed", v: 0 }
    }
    if (isObject(v) && (v.mode === "fit" || v.mode === "fill")) {
      const s: SizeSpec =
        v.mode === "fit" ? { mode: "fit" } : { mode: "fill", weight: num(v.weight) ?? 1 }
      if (s.mode === "fill" && !(s.weight > 0)) s.weight = 1
      const fallback = num(v.fallback)
      const min = num(v.min)
      const max = num(v.max)
      if (fallback !== undefined && fallback >= 0) s.fallback = fallback
      if (min !== undefined && min >= 0) s.min = min
      if (max !== undefined && max >= 0) s.max = max
      return s
    }
    if (v !== undefined) issue(e, "INVALID_SIZE", `invalid ${axis}`, `/${axis}`)
    return FIT_BY_DEFAULT.has(n.type) ? { mode: "fit" } : { mode: "fixed", v: 0 }
  }

  /** Natural size of a path: its viewBox, else the bounds of its geometry. */
  const pathSize = (e: Entry, axis: Axis): number => {
    const vb = e.data.viewBox
    if (Array.isArray(vb) && vb.length === 4) {
      const v = num(vb[axis === "w" ? 2 : 3])
      if (v !== undefined && v >= 0) return v
    }
    const d = e.data.d
    const b = typeof d === "string" ? pathBounds(d) : null
    if (!b) return 0
    return axis === "w" ? b.w : b.h
  }

  const padding = (e: Entry, layout: Record<string, unknown>): [number, number, number, number] => {
    const p = value(e, layout.pad, "/layout/pad")
    let out: [number, number, number, number] = [0, 0, 0, 0]
    if (typeof p === "number") out = [p, p, p, p]
    else if (Array.isArray(p) && p.length === 2) {
      const [v, h] = p.map((x) => num(x) ?? 0) as [number, number]
      out = [v, h, v, h]
    } else if (Array.isArray(p) && p.length === 4)
      out = p.map((x) => num(x) ?? 0) as [number, number, number, number]
    out = out.map((x) => (Number.isFinite(x) && x > 0 ? x : 0)) as typeof out
    if (layout.includeStroke === true && isObject(e.data.stroke)) {
      const w = value(e, e.data.stroke.width, "/stroke/width")
      if (w === undefined || typeof w === "number") {
        const s = w === undefined ? 1 : Math.max(0, w)
        out = [out[0] + s, out[1] + s, out[2] + s, out[3] + s]
      } else if (isObject(w)) {
        const s = (k: string) => Math.max(0, num(w[k]) ?? 0)
        out = [out[0] + s("t"), out[1] + s("r"), out[2] + s("b"), out[3] + s("l")]
      }
    }
    return out
  }

  /** Configures `e`'s Yoga node from its data. Idempotent; only changed values reach Yoga. */
  const applyStyle = (e: Entry) => {
    const n = e.data
    const y = e.y
    e.issues = []
    for (const x of src.issues(e.id)) expansionIssue(e, x)
    e.textCache.clear()
    if (isRef(n.visible)) value(e, n.visible, "/visible") // records an unresolved binding
    if (e.kind === "leaf" && !LEAF_TYPES.has(n.type) && n.type !== "instance")
      issue(e, "UNSUPPORTED_NODE", `unknown node type "${n.type}"`, "/type")

    const pdir = e.parent?.kind === "layout" ? e.parent.dir : null
    const flow = e.flow

    // Negative main-axis gaps: Yoga clamps gaps to ≥ 0, so pull each later child back instead.
    const lead = flow && e.parent && e.parent.gap < 0 && e.flowIndex > 0 ? e.parent.gap : 0
    put(e, "mL", pdir === "row" ? lead : 0, (v) => y.setMargin(Edge.Left, v))
    put(e, "mT", pdir === "column" ? lead : 0, (v) => y.setMargin(Edge.Top, v))

    // Text content.
    let textGrow: "auto" | "fixed-width" | "fixed" = "fixed"
    if (e.kind === "text") {
      e.text = resolveText(e.id, n, recording(e))
      if (n.type === "text")
        textGrow = n.grow === "fixed-width" || n.grow === "fixed" ? n.grow : "auto"
    } else e.text = null
    e.autoText = e.kind === "text" && textGrow === "auto"

    let grow = 0
    let shrink = 0
    let alignSelf = Align.Auto
    let needsMeasure = e.kind === "box"
    e.emptyW = undefined
    e.emptyH = undefined

    const axis = (a: Axis) => {
      const isMain = flow && (pdir === "row") === (a === "w")
      let size: number | "auto" = "auto"
      let min: number | undefined
      let max: number | undefined
      let mode: SpecMode = "fit"
      if (e.kind === "group") {
        // Groups have no size: updateContent() sets their children's bounds.
        size = (a === "w" ? e.style.w : e.style.h) as number | "auto"
      } else if (e.autoText) {
        const m = measure(e, undefined)
        size = a === "w" ? m.w : m.h
      } else {
        let spec = sizeSpec(e, a)
        // fixed-width text: the height always comes from the content.
        if (e.kind === "text" && textGrow === "fixed-width" && a === "h") spec = { mode: "fit" }
        if (spec.mode !== "fixed") {
          min = spec.min
          max = spec.max
        }
        mode =
          spec.mode === "fill" && spec.fallback !== undefined
            ? "fill+"
            : (spec.mode as "fixed" | "fit" | "fill")
        if (spec.mode === "fixed") size = spec.v
        else if (spec.mode === "fill" && flow) {
          if (isMain) {
            grow = spec.weight
            shrink = 1
          } else alignSelf = Align.Stretch
        } else if (spec.mode === "fill" && spec.fallback !== undefined) {
          size = spec.fallback // no layout parent, or absolute (§6.1)
        } else {
          // fit (or fill outside a flex flow without fallback): the content size.
          const fallback = spec.mode === "fit" ? spec.fallback : undefined
          if (e.kind === "leaf") size = n.type === "path" ? pathSize(e, a) : (fallback ?? 0)
          else if (e.kind === "layout") {
            if (fallback !== undefined && e.attached.length === 0) size = fallback
          } else if (e.kind === "box") {
            if (a === "w") e.emptyW = fallback
            else e.emptyH = fallback
          } else if (e.kind === "text") needsMeasure = true
        }
      }
      if (a === "w") e.specW = mode
      else e.specH = mode
      if (a === "w") {
        put(e, "w", size, (v) => y.setWidth(v))
        put(e, "minW", min, (v) => y.setMinWidth(v))
        put(e, "maxW", max, (v) => y.setMaxWidth(v))
      } else {
        put(e, "h", size, (v) => y.setHeight(v))
        put(e, "minH", min, (v) => y.setMinHeight(v))
        put(e, "maxH", max, (v) => y.setMaxHeight(v))
      }
    }
    axis("w")
    axis("h")
    put(e, "grow", grow, (v) => y.setFlexGrow(v))
    put(e, "shrink", shrink, (v) => y.setFlexShrink(v))
    put(e, "alignSelf", alignSelf, (v) => y.setAlignSelf(v))

    // Container properties (zero for non-layout kinds, so a kind change resets them).
    let fd = FlexDirection.Column
    let justify = Justify.FlexStart
    let align = Align.FlexStart
    let wrap = Wrap.NoWrap
    let mainGap = 0
    let crossGap = 0
    let pad: [number, number, number, number] = [0, 0, 0, 0]
    e.pad = pad
    if (e.kind === "layout" && isObject(n.layout)) {
      const L = n.layout
      fd = e.dir === "row" ? FlexDirection.Row : FlexDirection.Column
      const g = num(value(e, L.gap, "/layout/gap")) ?? 0
      mainGap = Math.max(0, g)
      const cg = num(value(e, L.crossGap, "/layout/crossGap")) ?? 0
      if (cg < 0)
        issue(e, "UNSUPPORTED_FEATURE", "negative crossGap is treated as 0", "/layout/crossGap")
      crossGap = Math.max(0, cg)
      pad = padding(e, L)
      e.pad = pad
      if (typeof L.justify === "string" && L.justify in JUSTIFY)
        justify = JUSTIFY[L.justify] as Justify
      if (typeof L.align === "string" && L.align in ALIGN) align = ALIGN[L.align] as Align
      if (L.wrap === true) wrap = Wrap.Wrap
    }
    put(e, "fd", fd, (v) => y.setFlexDirection(v))
    put(e, "justify", justify, (v) => y.setJustifyContent(v))
    put(e, "align", align, (v) => y.setAlignItems(v))
    put(e, "wrap", wrap, (v) => y.setFlexWrap(v))
    // Gutter.Column separates columns (horizontal spacing), Gutter.Row separates rows.
    const row = fd === FlexDirection.Row
    put(e, "gapCol", row ? mainGap : crossGap, (v) => y.setGap(Gutter.Column, v))
    put(e, "gapRow", row ? crossGap : mainGap, (v) => y.setGap(Gutter.Row, v))
    put(e, "pT", pad[0], (v) => y.setPadding(Edge.Top, v))
    put(e, "pR", pad[1], (v) => y.setPadding(Edge.Right, v))
    put(e, "pB", pad[2], (v) => y.setPadding(Edge.Bottom, v))
    put(e, "pL", pad[3], (v) => y.setPadding(Edge.Left, v))

    setMeasure(e, needsMeasure && e.kind !== "layout")
    if (e.measured) y.markDirty()
  }

  // --- Measurement --------------------------------------------------------------------------

  const measure = (e: Entry, maxWidth: number | undefined): TextMetrics => {
    const cached = e.textCache.get(maxWidth)
    if (cached) return cached
    let m: TextMetrics = { w: 0, h: 0 }
    if (e.text) {
      try {
        const r = input.measureText.measure(e.text, maxWidth)
        if (Number.isFinite(r.w) && Number.isFinite(r.h)) m = r
        else issue(e, "TEXT_MEASURE_FAILED", "measurer returned a non-finite size")
      } catch (err) {
        issue(e, "TEXT_MEASURE_FAILED", err instanceof Error ? err.message : String(err))
      }
    }
    e.textCache.set(maxWidth, m)
    return m
  }

  const measureTextFn = (e: Entry, w: number, wm: MeasureMode, h: number, hm: MeasureMode) => {
    const maxW = wm === MeasureMode.Undefined || Number.isNaN(w) ? undefined : w
    const m = measure(e, maxW)
    return {
      width: wm === MeasureMode.Exactly ? w : m.w,
      height: hm === MeasureMode.Exactly ? h : m.h,
    }
  }

  const measureBoxFn = (e: Entry, w: number, wm: MeasureMode, h: number, hm: MeasureMode) => {
    const c = e.content
    // Only frames without layout are measured (groups get explicit sizes in updateContent).
    const cw = c.empty ? (e.emptyW ?? 0) : Math.max(0, c.maxX)
    const ch = c.empty ? (e.emptyH ?? 0) : Math.max(0, c.maxY)
    return {
      width: wm === MeasureMode.Exactly ? w : cw,
      height: hm === MeasureMode.Exactly ? h : ch,
    }
  }

  // --- Pass ---------------------------------------------------------------------------------

  /** Position of a free (non-flowing) child in its parent's space, before group offsets. */
  const freeXY = (e: Entry): [number, number] => {
    let x = num(e.data.x) ?? 0
    let y = num(e.data.y) ?? 0
    if (e.kind === "group" && !e.content.empty) {
      x += e.content.minX
      y += e.content.minY
    }
    return [x, y]
  }

  const rotationOf = (e: Entry) => num(e.data.rotation) ?? 0

  /** Bounding box of the visible children of a frame without layout / group. */
  const updateContent = (e: Entry) => {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const c of e.children) {
      if (!c.visibleSelf) continue
      const w = fromF32(c.y.getComputedWidth())
      const h = fromF32(c.y.getComputedHeight())
      const [x, y] = freeXY(c)
      const b = transformedBounds(
        localMatrix(x, y, w, h, rotationOf(c), c.data.flipX === true, c.data.flipY === true),
        w,
        h,
      )
      if (b.x < minX) minX = b.x
      if (b.y < minY) minY = b.y
      if (b.x + b.w > maxX) maxX = b.x + b.w
      if (b.y + b.h > maxY) maxY = b.y + b.h
    }
    const next: Content = minX > maxX ? EMPTY : { empty: false, minX, minY, maxX, maxY }
    const prev = e.content
    if (
      prev.empty !== next.empty ||
      prev.minX !== next.minX ||
      prev.minY !== next.minY ||
      prev.maxX !== next.maxX ||
      prev.maxY !== next.maxY
    ) {
      e.content = next
      if (e.measured) e.y.markDirty()
    }
    if (e.kind === "group") {
      put(e, "w", next.maxX - next.minX, (v) => e.y.setWidth(v))
      put(e, "h", next.maxY - next.minY, (v) => e.y.setHeight(v))
    }
  }

  const calc = (e: Entry, only: Set<Entry> | null) => {
    if (only && !only.has(e)) return
    for (const c of e.children) calc(c, only)
    if (e.kind === "box" || e.kind === "group") updateContent(e)
    if (!e.flow) e.y.calculateLayout(undefined, undefined, Direction.LTR)
  }

  interface Emit {
    nodes: Map<string, NodeLayout>
    changed: Set<string>
    only: Set<Entry> | null
  }

  /**
   * FIT_ALL_FILL (spec §6): `e` is `fit` on `axis` and every flowing child fills it, so the
   * children are sized as `fit` there (Yoga gives them no free space; the result is the same).
   */
  const allFill = (e: Entry, axis: Axis): boolean => {
    if (e.kind !== "layout" || e.attached.length === 0 || e.applied?.[axis] !== "fit") return false
    for (const c of e.attached) {
      const m = axis === "w" ? c.specW : c.specH
      if (m !== "fill" && m !== "fill+") return false
    }
    return true
  }

  /** NodeLayout.sizing: the mode applied per axis after the fallbacks (ADR 0010). */
  const appliedSizing = (e: Entry): Sizing => {
    const one = (axis: Axis): AppliedSizing => {
      const m = axis === "w" ? e.specW : e.specH
      if (m === "fixed" || m === "fit") return m
      // fill: only inside a flex flow; outside, the fallback is a fixed size, else content.
      if (!e.flow) return m === "fill+" ? "fixed" : "fit"
      // The parent was emitted first: its kidsAllFill flags are current ("wh").
      return e.parent?.kidsAllFill[axis === "w" ? 0 : 1] === "1" ? "fit" : "fill"
    }
    return SIZING[one("w")][one("h")]
  }

  /** NodeLayout.content: the box inside the padding of a frame with layout (local). */
  const contentBox = (e: Entry, w: number, h: number): Rect | undefined => {
    if (e.kind !== "layout") return undefined
    const [t, r, b, l] = e.pad
    return { x: l, y: t, w: Math.max(0, w - l - r), h: Math.max(0, h - t - b) }
  }

  const emit = (e: Entry, parentT: Matrix, parentVisible: boolean, force: boolean, out: Emit) => {
    const prev = e.layout
    if (!force && prev && out.only && !out.only.has(e) && !e.y.hasNewLayout()) return
    let x: number
    let y: number
    const L = e.y.getComputedLayout()
    const w = fromF32(L.width)
    const h = fromF32(L.height)
    if (e.flow) {
      x = fromF32(L.left)
      y = fromF32(L.top)
    } else [x, y] = freeXY(e)
    const p = e.parent
    if (p?.kind === "group" && !p.content.empty) {
      x -= p.content.minX
      y -= p.content.minY
    }
    e.y.markLayoutSeen()
    const T = multiply(
      parentT,
      localMatrix(x, y, w, h, rotationOf(e), e.data.flipX === true, e.data.flipY === true),
    )
    const local: Rect = { x, y, w, h }
    const world = transformedBounds(T, w, h)
    const visible = parentVisible && e.visibleSelf
    let text: TextMetrics | undefined
    if (e.kind === "text") text = measure(e, e.autoText ? undefined : w)
    const sizing = appliedSizing(e)
    e.applied = sizing
    const inFlow = e.flow
    const content = contentBox(e, w, h)
    let next: NodeLayout
    if (
      prev &&
      prev.visible === visible &&
      rectEquals(prev.local, local) &&
      rectEquals(prev.world, world) &&
      matrixEquals(prev.transform, T) &&
      textEquals(prev.text, text) &&
      prev.inFlow === inFlow &&
      prev.sizing === sizing &&
      (prev.content && content ? rectEquals(prev.content, content) : prev.content === content)
    )
      next = prev
    else {
      next = { id: e.id, local, world, transform: T, visible, sizing, inFlow }
      if (text) next.text = text
      if (content) next.content = content
      out.changed.add(e.id)
    }
    e.layout = next
    out.nodes.set(e.id, next)
    // A group's children are relative to its content box, which can move without the group's
    // own box changing (e.g. a hidden child sets no bounds).
    const ox = e.kind === "group" ? e.content.minX : 0
    const oy = e.kind === "group" ? e.content.minY : 0
    // Children's applied sizing depends on their siblings (FIT_ALL_FILL), not only on their box.
    const kidsAllFill =
      e.kind === "layout" ? `${allFill(e, "w") ? 1 : 0}${allFill(e, "h") ? 1 : 0}` : ""
    const childForce =
      force ||
      next !== prev ||
      ox !== e.originX ||
      oy !== e.originY ||
      kidsAllFill !== e.kidsAllFill
    e.originX = ox
    e.originY = oy
    e.kidsAllFill = kidsAllFill
    for (const c of e.children) emit(c, T, visible, childForce, out)
  }

  const paintOrder = (): string[] => {
    const order: string[] = []
    const walk = (e: Entry) => {
      order.push(e.id)
      for (const c of e.children) walk(c)
    }
    for (const r of roots) walk(r)
    return order
  }

  const finish = (nodes: Map<string, NodeLayout>, order: string[], changed: Set<string>) => {
    let bounds: Rect | null = null
    for (const r of roots) {
      const l = r.layout
      if (!l?.visible) continue
      const b = l.world
      if (!bounds) bounds = { ...b }
      else {
        const x = Math.min(bounds.x, b.x)
        const y = Math.min(bounds.y, b.y)
        bounds = {
          x,
          y,
          w: Math.max(bounds.x + bounds.w, b.x + b.w) - x,
          h: Math.max(bounds.y + bounds.h, b.y + b.h) - y,
        }
      }
    }
    const issues: LayoutIssue[] = []
    for (const id of order) {
      const e = entries.get(id)
      if (e) for (const i of e.issues) issues.push(i)
    }
    for (const t of reindex) indexTop(t)
    reindex = new Set()
    componentDeps = new Map()
    current = { version: ++version, nodes, order, bounds, issues, changed }
    textGeneration = input.measureText.generation
    healthy = true
    return current
  }

  const freeEntry = (e: Entry) => {
    e.alive = false
    if (e.measured) e.y.unsetMeasureFunc()
    e.y.free()
  }

  const begin = (inp: LayoutInput) => {
    if (!Y || !config) throw new Error("@kimo/layout: call init() before compute()/update()")
    input = inp
    resolve = inp.resolve
    if (inp.expanded) src = inp.expanded
    else if (isExpandedView(inp.nodes)) src = inp.nodes
    else {
      if (!own || own.base !== inp.nodes)
        own = {
          base: inp.nodes,
          view: createInstanceView(
            inp.nodes,
            options.libraries ? { libraries: options.libraries } : {},
          ),
        }
      src = own.view
    }
    fresh = new Set()
  }

  // --- Instance dependencies (M3) -------------------------------------------------------------

  const isTop = (id: string): boolean => {
    if (id.includes("/")) return false
    const o = src.origin(id)
    return !!o && o.top === id && !!o.instance
  }

  const unindex = (t: string) => {
    for (const d of topDeps.get(t) ?? []) {
      const s = depTops.get(d)
      if (!s) continue
      s.delete(t)
      if (s.size === 0) depTops.delete(d)
    }
    topDeps.delete(t)
    topStamp.delete(t)
  }

  /**
   * Dependencies shared by every plain instance of one component in this pass (see
   * {@link indexTop}); keyed by `of`, cleared at the end of each pass.
   */
  let componentDeps = new Map<string, string[]>()

  /** What the current expansion of top-level instance `t` read (real ids). */
  const depsOf = (e: Entry): string[] => {
    const deps = new Set<string>()
    const local = (q: string) => {
      if (q && !q.includes(":")) deps.add(q)
    }
    const walk = (c: Entry) => {
      if (!parseVirtualId(c.id)) deps.add(c.id)
      const o = src.origin(c.id)
      if (o?.source && o.source.alias === null) deps.add(o.source.id)
      if (o?.instance) {
        local(o.instance.of)
        for (const q of o.instance.chain) local(q)
      }
      if (o?.owned) deps.add(o.owned.instance)
      for (const k of c.children) walk(k)
    }
    walk(e)
    return [...deps]
  }

  /**
   * Records what the current expansion of top-level instance `t` read. A plain instance (no
   * overrides, args or owned content: its expansion reads only its component) shares one
   * walk per component per pass (perf: a main edit re-indexes 1k instances).
   */
  const indexTop = (t: string) => {
    const e = entries.get(t)
    if (!e?.alive || !isTop(t)) {
      unindex(t)
      return
    }
    const real = src.base.getNode(t)
    const plain =
      !!real &&
      real.type === "instance" &&
      typeof real.of === "string" &&
      real.overrides === undefined &&
      real.args === undefined &&
      !e.children.some((c) => !parseVirtualId(c.id))
    let list: string[]
    if (plain) {
      const of = real.of as string
      let shared = componentDeps.get(of)
      if (!shared) {
        shared = depsOf(e).filter((d) => d !== t)
        componentDeps.set(of, shared)
      }
      list = [t, ...shared]
    } else list = depsOf(e)
    if (isInstanceView(src)) topStamp.set(t, src.stamp(t))
    const old = topDeps.get(t)
    if (old && old.length === list.length && old.every((d, i) => d === list[i])) return
    unindex(t)
    topDeps.set(t, list)
    for (const d of list) {
      let s = depTops.get(d)
      if (!s) {
        s = new Set()
        depTops.set(d, s)
      }
      s.add(t)
    }
  }

  /** Top-level instances whose expansion an edit of `ids` may change (old and new state). */
  const affectedTops = (ids: readonly string[]): Set<string> => {
    const out = new Set<string>()
    if (depTops.size === 0) return out
    const hit = (id: string) => {
      const s = depTops.get(id)
      if (s) for (const t of s) out.add(t)
    }
    const base = src.base
    for (const id of ids) {
      const v = parseVirtualId(id)
      if (v) {
        hit(v.instance)
        continue
      }
      hit(id)
      const seen = new Set<string>([id])
      for (let p = base.getNode(id)?.parent; typeof p === "string" && !seen.has(p); ) {
        seen.add(p)
        hit(p)
        p = base.getNode(p)?.parent
      }
      for (let e = entries.get(id)?.parent ?? null; e; e = e.parent)
        if (!parseVirtualId(e.id)) hit(e.id)
    }
    return out
  }

  const rootIds = (): readonly string[] => input.roots ?? src.children(null)

  /** True when `v` holds a `{ $ref }` binding at any depth. */
  const hasRef = (v: unknown, depth = 0): boolean => {
    if (v === null || typeof v !== "object" || depth > 32) return false
    if (isRef(v)) return true
    if (Array.isArray(v)) {
      for (const x of v) if (hasRef(x, depth + 1)) return true
      return false
    }
    for (const k in v as Record<string, unknown>)
      if (hasRef((v as Record<string, unknown>)[k], depth + 1)) return true
    return false
  }
  /**
   * Node data whose layout reads a binding (sizes, visibility, layout gaps / padding, stroke
   * width, text content and style, placeholder props). Paint-only bindings (fills, effects)
   * never change a box, so a color variable or a pin over painted nodes restyles nothing.
   */
  const isBound = (n: LayoutNodeData): boolean => {
    let b = boundCache.get(n)
    if (b === undefined) {
      b = false
      for (const k of BOUND_LAYOUT_KEYS)
        if (hasRef(n[k])) {
          b = true
          break
        }
      boundCache.set(n, b)
    }
    return b
  }

  /** Configures fresh entries top-down: attach children, then style. */
  const configure = (e: Entry) => {
    attach(e)
    applyStyle(e)
    for (const c of e.children)
      if (fresh.has(c)) configure(c)
      else applyStyle(c) // an existing node moved into this new parent
  }

  // --- Public -------------------------------------------------------------------------------

  /**
   * A full pass re-reads everything. With a healthy previous pass it is done as a refresh:
   * every node is re-read and diffed (unchanged nodes keep their Yoga state), bound nodes are
   * re-resolved and text re-measured when fonts changed — the result equals a rebuild, at the
   * cost of what changed (a variable mode switch over 36k nodes re-styles the bound ones only).
   */
  const compute = (inp: LayoutInput): LayoutResult => {
    if (healthy && current && entries.size > 0) return refresh(inp)
    return rebuild(inp)
  }

  const rebuild = (inp: LayoutInput): LayoutResult => {
    healthy = false
    begin(inp)
    // A full pass re-reads everything: the view's caches may predate the change.
    src.invalidate()
    topDeps.clear()
    depTops.clear()
    reindex = new Set()
    const prevNodes = current?.nodes
    for (const e of entries.values()) freeEntry(e)
    entries = new Map()
    roots = []
    for (const id of rootIds()) {
      const e = build(id, null, false)
      if (e) roots.push(e)
    }
    for (const r of roots) configure(r)
    for (const e of entries.values()) if (isTop(e.id)) reindex.add(e.id)
    for (const r of roots) calc(r, null)
    const out: Emit = { nodes: new Map(), changed: new Set(), only: null }
    for (const r of roots) emit(r, IDENTITY, true, true, out)
    // `changed` relative to the previous pass (everything on the first one).
    const changed = new Set<string>()
    for (const [id, l] of out.nodes) {
      const p = prevNodes?.get(id)
      if (!p || !rectEquals(p.world, l.world) || !matrixEquals(p.transform, l.transform))
        changed.add(id)
    }
    if (prevNodes) for (const id of prevNodes.keys()) if (!out.nodes.has(id)) changed.add(id)
    return finish(out.nodes, paintOrder(), changed)
  }

  /**
   * Variable values or theme axes changed, nothing else (DirtySet `valuesOnly`): every entry's
   * data and every expansion are as they were, so only bound entries re-resolve (a full
   * {@link refresh} would re-verify every expansion and re-walk the document).
   */
  const rebind = (inp: LayoutInput): LayoutResult => {
    const gen = inp.measureText.generation
    // Fonts changed too (text must re-measure): the full path handles it.
    if (gen === undefined || gen !== textGeneration) return compute(inp)
    healthy = false
    begin(inp)
    const ids: string[] = []
    for (const e of entries.values()) if (e.alive && isBound(e.data)) ids.push(e.id)
    return pass(ids, new Set(), (_e, n) => isBound(n), null)
  }

  /** Re-reads every node through a freshly invalidated view and diffs it (see compute). */
  const refresh = (inp: LayoutInput): LayoutResult => {
    healthy = false
    begin(inp)
    // The view's caches may predate the change (header, libraries, load).
    src.invalidate()
    const gen = inp.measureText.generation
    const remeasure = gen === undefined || gen !== textGeneration
    const force = (e: Entry, n: LayoutNodeData) => isBound(n) || (remeasure && e.kind === "text")
    // Instances whose expansion the view kept (everything it read still holds): their subtree
    // is the same nodes, so only their bound / text entries are re-read (perf: a variable mode
    // switch over 1k instances walks none of their 31k view nodes).
    const kept = new Set<string>()
    const forcedKept: string[] = []
    if (isInstanceView(src)) {
      const view = src
      const mark = (e: Entry) => {
        kept.add(e.id)
        if (force(e, e.data)) forcedKept.push(e.id)
        for (const c of e.children) mark(c)
      }
      for (const [t, st] of topStamp) {
        const e = entries.get(t)
        if (e?.alive && !kept.has(t) && view.stamp(t) === st) mark(e)
      }
    }
    const ids: string[] = []
    const listed = new Set<string>()
    for (const id of entries.keys())
      if (!kept.has(id)) {
        listed.add(id)
        ids.push(id)
      }
    let added = 0
    const seen = new Set<string>()
    const walk = (id: string) => {
      if (seen.has(id) || kept.has(id)) return
      seen.add(id)
      if (!listed.has(id)) {
        listed.add(id)
        ids.push(id)
        added++
      }
      for (const c of src.children(id)) walk(c)
    }
    for (const r of rootIds()) walk(r)
    // Mostly new content (a document load, a large paste with a header change): building it
    // fresh beats adopting it entry by entry.
    if (added > entries.size) return rebuild(inp)
    for (const id of forcedKept) ids.push(id)
    // Re-index every top-level instance whose expansion may have been rebuilt (an unchanged
    // dependency list is kept as is).
    reindex = new Set()
    return pass(ids, new Set(), force, kept)
  }

  /** Edits larger than this re-expand what they touch instead of patching (see update). */
  const PATCH_MAX = 64

  const update = (inp: LayoutInput, dirty: DirtySet): LayoutResult => {
    if (!current) return compute(inp)
    const dirtyIds = [...dirty.nodes]
    if (dirty.header) {
      if (dirty.valuesOnly && dirtyIds.length === 0 && healthy && entries.size > 0)
        return rebind(inp)
      return compute(inp)
    }
    healthy = false
    begin(inp)
    if (dirtyIds.length === 0) {
      if (isInstanceView(src)) src.invalidateInstances([], [])
      healthy = true
      return current
    }

    // M3: an edit inside a main that does not shape the expansions (a fill, a size) patches
    // the view nodes made from the edited nodes in every cached expansion (InstanceView
    // `patchNodes`); those view nodes are diffed, nothing is re-expanded.
    const ids = [...dirtyIds]
    const explicit = new Set(dirtyIds)
    const listed = new Set(dirtyIds)
    const add = (id: string) => {
      if (listed.has(id)) return
      listed.add(id)
      ids.push(id)
    }
    let rest = dirtyIds
    if (isInstanceView(src) && depTops.size > 0 && dirtyIds.length <= PATCH_MAX) {
      const read = dirtyIds.filter((id) => depTops.has(id))
      const patched = read.length > 0 ? src.patchNodes(read) : null
      if (patched && patched.size > 0) {
        rest = []
        for (const id of dirtyIds) {
          const p = patched.get(id)
          const keys = p ? new Set(p.keys) : null
          // Every top whose expansion read `id` must have been patched (else re-expand).
          let all = !!keys
          if (keys) for (const t of depTops.get(id) ?? []) if (!keys.has(t)) all = false
          if (!p || !all) {
            rest.push(id)
            continue
          }
          for (const v of p.ids) add(v)
          for (const k of p.keys) if (topStamp.has(k)) topStamp.set(k, src.stamp(k))
        }
      }
    }
    // Every other top-level instance the edit may change is re-expanded and diffed node by
    // node (its old and new subtrees join the dirty set).
    const tops = affectedTops(rest)
    if (isInstanceView(src)) src.invalidateInstances(tops, rest)
    for (const t of tops) {
      const old = entries.get(t)
      if (old) {
        const walk = (e: Entry) => {
          add(e.id)
          for (const c of e.children) walk(c)
        }
        walk(old)
      }
      if (src.getNode(t)) {
        const seen = new Set<string>()
        const walk = (id: string) => {
          if (seen.has(id)) return
          seen.add(id)
          add(id)
          for (const c of src.children(id)) walk(c)
        }
        walk(t)
      }
      reindex.add(t)
    }
    return pass(ids, explicit, null, null)
  }

  /**
   * Diffs `ids` (explicitly dirty ones always restyle; others only when their data changed or
   * `force` says so), re-syncs child lists, restyles, re-calculates the path-dirty Yoga trees
   * and re-emits. `all` (refresh): every node is in `ids` except these (kept expansions) —
   * every other top is re-indexed.
   */
  const pass = (
    ids: readonly string[],
    explicit: ReadonlySet<string>,
    force: ((e: Entry, n: LayoutNodeData) => boolean) | null,
    all: ReadonlySet<string> | null,
  ): LayoutResult => {
    const prevResult = current as LayoutResult
    const resync = new Set<Entry | null>()
    const restyle = new Set<Entry>()
    const seeds = new Set<Entry>()
    const parentEntry = (pid: unknown): Entry | null | undefined =>
      pid === null ? null : typeof pid === "string" ? entries.get(pid) : undefined

    // Bound nodes below a changed theme pin are queued as changed (see below).
    const queue = [...ids]
    const rethemed = new Set<string>()
    for (let qi = 0; qi < queue.length; qi++) {
      const id = queue[qi] as string
      const old = entries.get(id)
      const n = src.getNode(id)
      if (!old) {
        if (!n) continue
        const p = parentEntry(n.parent)
        if (p !== undefined) resync.add(p)
        continue
      }
      if (!n) {
        resync.add(old.parent)
        continue
      }
      const prev = old.data
      // Re-expanded instance nodes whose data did not change keep their layout state.
      if (!explicit.has(id) && !rethemed.has(id) && shallowEqual(prev, n) && !force?.(old, n)) {
        old.data = n
        continue
      }
      old.data = n
      const { kind, visibleSelf, absolute, gap, dir } = old
      readFlags(old)
      if (prev.parent !== n.parent || prev.order !== n.order) {
        resync.add(old.parent)
        const p = parentEntry(n.parent)
        if (p !== undefined) resync.add(p)
      }
      if (old.kind !== kind || old.visibleSelf !== visibleSelf || old.absolute !== absolute)
        resync.add(old.parent)
      if (old.kind !== kind) resync.add(old)
      restyle.add(old)
      seeds.add(old)
      if (old.kind !== kind || old.gap !== gap || old.dir !== dir)
        for (const c of old.children) restyle.add(c)
      // A theme pin changes every bound value below (§10.4 rule 1): re-read the bound nodes
      // of the subtree as changed (unbound ones read nothing from the theme).
      if (!jsonEqualShallow(prev.theme, n.theme)) {
        const all = (e: Entry) => {
          for (const c of e.children) {
            if (!rethemed.has(c.id) && isBound(c.data)) {
              rethemed.add(c.id)
              queue.push(c.id)
            }
            all(c)
          }
        }
        all(old)
      }
    }

    // Re-sync child lists: detach every affected Yoga child first, then rebuild and attach.
    const removed: Entry[] = []
    for (const p of resync) if (p) detach(p)
    for (const p of resync) {
      if (p && !p.alive) continue
      const before = p ? p.children : roots
      const list: Entry[] = []
      for (const id of p ? src.children(p.id) : rootIds()) {
        const e = build(id, p, true)
        if (e && !list.includes(e)) list.push(e)
      }
      for (const c of before) if (!list.includes(c)) removed.push(c)
      if (p) p.children = list
      else roots = list
      for (const c of list) {
        c.parent = p
        if (!p) {
          c.flow = false
          c.flowIndex = -1
        }
        if (!fresh.has(c)) restyle.add(c)
        seeds.add(c)
      }
      if (p) {
        restyle.add(p)
        seeds.add(p)
      }
    }
    for (const p of resync) if (p?.alive) attach(p)
    for (const e of fresh) if (!e.parent || !fresh.has(e.parent)) configure(e)
    for (const e of fresh) if (isTop(e.id)) reindex.add(e.id)
    if (all)
      for (const e of entries.values())
        if (e.alive && !all.has(e.id) && isTop(e.id)) reindex.add(e.id)

    // Dispose entries no longer attached anywhere.
    const removedIds: string[] = []
    const attachedTo = (e: Entry) =>
      e.parent ? e.parent.alive && e.parent.children.includes(e) : roots.includes(e)
    const dispose = (e: Entry, owner: Entry | null) => {
      if (!e.alive || e.parent !== owner) return
      for (const c of e.children) dispose(c, e)
      entries.delete(e.id)
      removedIds.push(e.id)
      freeEntry(e)
    }
    for (const e of removed) if (e.alive && !attachedTo(e)) dispose(e, e.parent)

    for (const e of restyle) if (e.alive) applyStyle(e)

    // Path-dirty set: seeds, fresh entries and all their ancestors.
    const only = new Set<Entry>()
    const mark = (e: Entry | null) => {
      for (let p = e; p && !only.has(p); p = p.parent) only.add(p)
    }
    for (const e of seeds) if (e.alive) mark(e)
    for (const e of fresh) mark(e)

    for (const r of roots) calc(r, only)
    const out: Emit = { nodes: new Map(prevResult.nodes), changed: new Set(), only }
    for (const id of removedIds) {
      if (topDeps.has(id)) unindex(id)
      out.nodes.delete(id)
      out.changed.add(id)
    }
    for (const r of roots) emit(r, IDENTITY, true, false, out)
    const order = resync.size > 0 ? paintOrder() : (prevResult.order as string[])
    return finish(out.nodes, order, out.changed)
  }

  return {
    init() {
      initPromise ??= loadYoga().then((y) => {
        Y = y
        config = y.Config.create()
        // No pixel-grid rounding: boxes keep the document's fractional values.
        config.setPointScaleFactor(0)
      })
      return initPromise
    },
    compute,
    update,
    get current() {
      return current
    },
    dispose() {
      for (const e of entries.values()) freeEntry(e)
      entries = new Map()
      roots = []
      current = null
      healthy = false
      own = null
      topDeps.clear()
      depTops.clear()
      config?.free()
      config = null
      Y = null
      initPromise = null
    },
  }
}

const textEquals = (a: TextMetrics | undefined, b: TextMetrics | undefined): boolean =>
  a === b ||
  (!!a && !!b && a.w === b.w && a.h === b.h && a.lines === b.lines && a.baseline === b.baseline)

/** Same own keys with identical (===) values. */
function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (a === b) return true
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (!Object.hasOwn(b, k) || a[k] !== b[k]) return false
  return true
}

/** Equality of two theme pin maps (flat string records) or absent values. */
function jsonEqualShallow(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!isObject(a) || !isObject(b)) return false
  return shallowEqual(a, b)
}
