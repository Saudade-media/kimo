/**
 * Builds the export IR (./types) from a document (ADR 0015). Pure and deterministic: the same
 * document and options always give the same IR (sibling order is §5.1 order, names are handed
 * out in document order, records are sorted by code unit).
 *
 * Sizing and placement restate `@kimo/layout`'s Yoga model (engine.ts `sizeSpec` /
 * `applyStyle`) so a browser laying out the emitted CSS reproduces the canvas boxes.
 */
import {
  createExpandedView,
  declaredProps,
  defaultTextFill,
  defaultTheme,
  documentLookup,
  type ExpandedView,
  isLocated,
  isObject,
  isRef,
  type KimoDocument,
  type Libraries,
  locate,
  type NodeRecord,
  qualifyNodeData,
  resolveVariable,
  selectThemedValue,
  splitQualified,
  type Theme,
} from "@kimo/core-schema"
import { type LayoutResult, pathBounds, TEXT_STYLE_DEFAULTS } from "@kimo/layout"
import { cssColor, parseColor, toHex } from "./color"
import { axisAttr, cssVarName, kebab, NameRegistry, pascal, propIdent } from "./names"
import type {
  ExportIssue,
  ExportIssueCode,
  IRArgValue,
  IRAxis,
  IRColor,
  IRComponent,
  IRComponentProp,
  IRDocument,
  IRFlex,
  IRIcon,
  IRInstanceRef,
  IRLineHeight,
  IRNode,
  IRNum,
  IRPaint,
  IRPlacement,
  IRShadow,
  IRShape,
  IRSides,
  IRSize,
  IRStroke,
  IRText,
  IRTextRun,
  IRTextStyle,
  IRVariable,
  IRVisual,
} from "./types"

/** Options for {@link buildIR}. */
export interface BuildIROptions {
  /** Imported libraries by alias. */
  libraries?: Libraries
  /**
   * Root node ids to export (real ids). Default: every top-level node that is not a note or a
   * prompt and not a component (components are exported through instances).
   */
  ids?: readonly string[]
  /**
   * Describe instances as component references and build {@link IRDocument.components}
   * (React "split instances into components"). Default false: instances are only expanded.
   */
  components?: boolean
  /**
   * Whether emitters will write variables as CSS custom properties. When false and
   * `components` is on, an instance whose effective theme differs from the component's is
   * inlined (a literal component cannot follow the theme). Default true.
   */
  cssVariables?: boolean
  /** Keep hidden nodes in the tree (`visible: false`). Default false (they take no space). */
  keepHidden?: boolean
  /**
   * A layout of the same document (same expanded ids), used only where CSS cannot express a
   * canvas size: the bounds of groups whose children are not fixed-size (text, fit frames).
   */
  layout?: LayoutResult
}

const FIT_BY_DEFAULT = new Set(["frame", "group", "text", "instance"])
const SKIPPED = new Set(["note", "prompt"])
const NORMAL_BLENDS = new Set(["normal", "pass-through"])
const SYNTHETIC_PREFIX = "KimoExport"
const EXPORT_TAG_META = "kimo.export.tag"

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined

interface Ctx {
  view: ExpandedView
  doc: KimoDocument
  libs: Libraries
}

/** Builds the IR of `doc` (see {@link BuildIROptions}). */
export function buildIR(doc: KimoDocument, options: BuildIROptions = {}): IRDocument {
  return new Builder(doc, options).build()
}

class Builder {
  private readonly libs: Libraries
  private readonly issues: ExportIssue[] = []
  private readonly issueKeys = new Set<string>()
  private readonly usage = new Map<string, Set<string>>()
  private readonly assets = new Set<string>()
  private readonly fonts = new Map<string, { family: string; weight: number; italic: boolean }>()
  private readonly icons = new Map<string, { set: string; name: string; weight: number | null }>()
  private readonly components: IRComponent[] = []
  private readonly componentIndex = new Map<string, number>()
  private readonly componentIdents = new NameRegistry("")
  private ctx: Ctx
  private keys = new NameRegistry()
  /** Synthetic instance id → [component qid, args]. */
  private synthetic = new Map<string, { of: string; args: Record<string, unknown> }>()
  private syntheticCounter = 0

  constructor(
    private readonly doc: KimoDocument,
    private readonly options: BuildIROptions,
  ) {
    this.libs = options.libraries ?? {}
    this.ctx = this.makeCtx()
  }

  // --- Context ------------------------------------------------------------------------------

  /** A view over the document plus the synthetic component instances requested so far. */
  private makeCtx(): Ctx {
    const nodes: Record<string, unknown> = { ...(this.doc.nodes as Record<string, unknown>) }
    let order = 0
    for (const [id, s] of this.synthetic) {
      const n: Record<string, unknown> = {
        type: "instance",
        parent: null,
        order: `~${String(order++).padStart(6, "0")}`,
        of: s.of,
      }
      if (Object.keys(s.args).length > 0) n.args = s.args
      nodes[id] = n
    }
    const docX = { ...this.doc, nodes } as KimoDocument
    const view = createExpandedView(documentLookup(docX), {
      libraries: this.libs,
      header: () => docX,
    })
    return { view, doc: docX, libs: this.libs }
  }

  private syntheticId(): string {
    for (;;) {
      const id = `${SYNTHETIC_PREFIX}${String(++this.syntheticCounter).padStart(6, "0")}`
      if (!Object.hasOwn(this.doc.nodes as object, id)) return id
    }
  }

  // --- Issues / resolution ------------------------------------------------------------------

  private issue(code: ExportIssueCode, message: string, nodeId?: string) {
    const k = `${code}\u0000${nodeId ?? ""}\u0000${message}`
    if (this.issueKeys.has(k)) return
    this.issueKeys.add(k)
    const i: ExportIssue = { code, message }
    if (nodeId !== undefined) i.nodeId = nodeId
    this.issues.push(i)
  }

  private theme(id: string): Theme {
    return this.ctx.view.theme(id)
  }

  private use(ref: string, usage: string) {
    let s = this.usage.get(ref)
    if (!s) {
      s = new Set()
      this.usage.set(ref, s)
    }
    s.add(usage)
  }

  /** Resolves a possibly bound value as seen by `id`; records the usage of the binding. */
  private value(id: string, v: unknown, usage: string): { v: unknown; ref?: string } {
    if (!isRef(v)) return { v }
    this.use(v.$ref, usage)
    const r = resolveVariable(this.ctx.doc, v.$ref, this.theme(id), this.libs)
    if (!r.ok) {
      this.issue("VARIABLE_UNRESOLVED", `${r.reason}: ${v.$ref}`, id)
      return { v: undefined, ref: v.$ref }
    }
    // `dimension` tokens ({ value, unit: "px" }) read as px numbers wherever a Num is expected.
    const val =
      r.type === "dimension" && isObject(r.value) && typeof r.value.value === "number"
        ? r.value.value
        : r.value
    return { v: val, ref: v.$ref }
  }

  private num(id: string, v: unknown, usage: string, d: number): IRNum {
    const r = this.value(id, v, usage)
    const n = num(r.v) ?? d
    return r.ref ? { v: n, ref: r.ref } : { v: n }
  }

  private color(id: string, v: unknown, alpha = 1): IRColor | null {
    const r = this.value(id, v, "color")
    const rgba = parseColor(r.v)
    const css = cssColor(r.v)
    if (!rgba || !css) return null
    const out: IRColor = {
      css:
        alpha >= 1
          ? css
          : css.startsWith("#")
            ? toHex([rgba[0], rgba[1], rgba[2], rgba[3] * alpha]).toUpperCase()
            : withAlphaCss(css, alpha),
      rgba: [rgba[0], rgba[1], rgba[2], rgba[3] * alpha],
    }
    if (r.ref) out.ref = r.ref
    if (alpha < 1) out.alpha = alpha
    return out
  }

  // --- Build --------------------------------------------------------------------------------

  build(): IRDocument {
    const roots = this.rootIds()
    const out: IRNode[] = []
    for (const id of roots) {
      const n = this.buildNode(id, { mode: "root" }, null)
      if (n) out.push(n)
    }
    if (this.options.components) this.buildComponents(out)
    const variables = this.variables()
    return {
      name: typeof this.doc.meta?.name === "string" ? this.doc.meta.name : "Export",
      roots: out,
      components: this.components,
      variables,
      axes: this.axes(),
      assets: [...this.assets].sort(),
      fonts: [...this.fonts.values()].sort(
        (a, b) =>
          cmp(a.family, b.family) || a.weight - b.weight || Number(a.italic) - Number(b.italic),
      ),
      icons: [...this.icons.values()].sort(
        (a, b) => cmp(a.set, b.set) || cmp(a.name, b.name) || (a.weight ?? 0) - (b.weight ?? 0),
      ),
      issues: this.issues,
    }
  }

  private rootIds(): string[] {
    if (this.options.ids) {
      const out: string[] = []
      for (const id of this.options.ids) {
        const n = this.ctx.view.getNode(id)
        if (!n) this.issue("NODE_NOT_FOUND", `node ${id} not found`, id)
        else if (SKIPPED.has(n.type))
          this.issue("NOT_EXPORTABLE", `${n.type} nodes are not part of the design`, id)
        else out.push(id)
      }
      return out
    }
    return this.ctx.view
      .children(null)
      .filter((id) => {
        if (id.startsWith(SYNTHETIC_PREFIX) && this.synthetic.has(id)) return false
        const n = this.ctx.view.getNode(id)
        const real = (this.doc.nodes as Record<string, Record<string, unknown>>)[id]
        return n && !SKIPPED.has(n.type) && !real?.component
      })
      .slice()
  }

  /** The node's data as the view reads it. */
  private node(id: string): NodeRecord | undefined {
    return this.ctx.view.getNode(id)
  }

  private isVisible(id: string, n: NodeRecord): boolean {
    if (n.type === "instance") return true
    return this.value(id, n.visible, "visible").v !== false
  }

  private buildNode(
    id: string,
    placement: IRPlacement,
    parentFlex: IRFlex | null,
    parentDefinite: readonly [boolean, boolean] = [false, false],
  ): IRNode | null {
    const n = this.node(id)
    if (!n || SKIPPED.has(n.type)) return null
    const visible = this.isVisible(id, n)
    if (!visible && !this.options.keepHidden && !this.keepHidden.has(id)) return null
    const type = n.type
    const theme = this.theme(id)
    const synthetic = this.synthetic.has(id)
    const pins = isObject(n.theme) && Object.keys(n.theme).length > 0
    const flex = this.flex(id, n)

    const node: IRNode = {
      id,
      type,
      name: typeof n.name === "string" ? n.name : null,
      key: this.keys.take(kebab(typeof n.name === "string" ? n.name : type, type)),
      tag: this.tag(n, synthetic ? { mode: "flow", dir: "row", index: 0, lead: 0 } : placement),
      visible,
      // Exported roots carry their full theme; a component root only its own pins (it
      // inherits the theme of wherever it is used).
      themeAttrs: pins || (placement.mode === "root" && !synthetic) ? { ...theme } : null,
      theme: { ...theme },
      placement,
      w: { kind: "fit" },
      h: { kind: "fit" },
      transform: this.transform(id, n),
      flex,
      childMode: null,
      visual: this.visual(id, n),
      text: null,
      shape: this.shape(id, n),
      icon: this.icon(id, n),
      slot: type === "frame" && isObject(n.slot),
      instance: null,
      children: [],
    }
    if (type === "text") node.text = this.text(id, n)
    if (type === "instance") {
      this.issue("INSTANCE_UNRESOLVED", `instance of ${String(n.of)} could not be expanded`, id)
    }
    const flow = placement.mode === "flow"
    node.w = this.size(id, n, "w", flow ? placement.dir : null)
    node.h = this.size(id, n, "h", flow ? placement.dir : null)
    // §6.1 (engine.ts `basisKey`): a definite size is fixed, or a fill in a definite parent.
    const definite = (["w", "h"] as const).map(
      (a, i) => node[a].kind === "fixed" || (node[a].kind === "fill" && parentDefinite[i]),
    ) as [boolean, boolean]
    if (flow) {
      const row = placement.dir === "row"
      const main = node[row ? "w" : "h"]
      if (main.kind === "fill" && main.axis === "main")
        main.zero = parentDefinite[row ? 0 : 1] && parentFlex?.wrap !== true
    }

    // Children.
    const kids = this.ctx.view.children(id)
    if (type === "frame" || type === "group") {
      const childNodes: { id: string; n: NodeRecord }[] = []
      for (const c of kids) {
        const cn = this.node(c)
        if (cn && !SKIPPED.has(cn.type)) childNodes.push({ id: c, n: cn })
      }
      if (flex) {
        let index = 0
        const lead = flex.negativeGap
        const hasFlowing = childNodes.some(
          (c) => this.isVisible(c.id, c.n) && c.n.position !== "absolute",
        )
        // Fit with a fallback and nothing to fit (§6.1): the fallback is the size.
        for (const a of ["w", "h"] as const) {
          const s = node[a]
          const fb = this.fitFallback(id, n, a)
          if (s.kind === "fit" && fb !== undefined && !hasFlowing)
            node[a] = { kind: "fixed", px: { v: fb } }
        }
        for (const c of childNodes) {
          const absolute = c.n.position === "absolute"
          // Hidden children kept for a boolean prop are flow items when shown.
          const p: IRPlacement = absolute
            ? { mode: "absolute", ...this.xy(c.n) }
            : { mode: "flow", dir: flex.dir, index, lead: index > 0 ? lead : 0 }
          if (!absolute && this.isVisible(c.id, c.n)) index++
          const cnode = this.buildNode(c.id, p, flex, definite)
          if (cnode) node.children.push(cnode)
        }
        this.zeroBases(node.children, flex.dir)
      } else if (type === "frame") {
        const anyVisible = childNodes.some((c) => this.isVisible(c.id, c.n))
        for (const a of ["w", "h"] as const) {
          const fb = this.fitFallback(id, n, a)
          if (node[a].kind === "fit" && fb !== undefined && !anyVisible)
            node[a] = { kind: "fixed", px: { v: fb } }
        }
        const stack = node.w.kind !== "fixed" || node.h.kind !== "fixed"
        node.childMode = stack ? "stack" : "absolute"
        for (const c of childNodes) {
          const xy = this.xy(c.n)
          const cnode = this.buildNode(
            c.id,
            stack ? { mode: "stack", ...xy } : { mode: "absolute", ...xy },
            null,
          )
          if (cnode) {
            // The canvas fits a frame to its children's rotated bounds; CSS grid items
            // contribute their unrotated margin box, so the difference becomes margin.
            if (cnode.placement.mode === "stack" && cnode.transform?.rotation) {
              const sz = this.staticSize(cnode)
              if (sz) {
                const b = bounds(xy.x, xy.y, sz.w, sz.h, cnode.transform)
                const r = b.x + b.w - (xy.x + sz.w)
                const btm = b.y + b.h - (xy.y + sz.h)
                if (r !== 0 || btm !== 0) cnode.placement.reach = [r, btm]
              } else
                this.issue(
                  "SIZE_UNRESOLVED",
                  "rotated content-sized child of a fitting frame",
                  c.id,
                )
            }
            node.children.push(cnode)
          }
        }
      } else this.group(node, childNodes)
    }
    node.visual.isolate = this.needsIsolation(node)
    if (this.options.components) node.instance = this.instanceRef(id, n, node)
    return node
  }

  /** Bases of zero-basis fill items: weight × the largest main padding / weight (§6.1). */
  private zeroBases(kids: IRNode[], dir: "row" | "column") {
    const items: Extract<IRSize, { kind: "fill" }>[] = []
    let k = 0
    for (const c of kids) {
      const s = c[dir === "row" ? "w" : "h"]
      if (!c.visible || c.placement.mode !== "flow" || s.kind !== "fill" || !s.zero) continue
      items.push(s)
      const f = c.flex
      const [a, b] = dir === "row" ? [1, 3] : [0, 2]
      const pad = f
        ? (f.pad[a] as IRNum).v +
          (f.padExtra[a] as number) +
          (f.pad[b] as IRNum).v +
          (f.padExtra[b] as number)
        : 0
      k = Math.max(k, pad / s.weight)
    }
    if (k > 0) for (const s of items) s.basis = s.weight * k
  }

  /** Ids kept although hidden (boolean prop targets inside component files). */
  private keepHidden = new Set<string>()

  private xy(n: NodeRecord): { x: number; y: number } {
    return { x: num(n.x) ?? 0, y: num(n.y) ?? 0 }
  }

  private tag(n: NodeRecord, placement: IRPlacement): string {
    const meta = n.meta
    if (isObject(meta)) {
      const t = meta[EXPORT_TAG_META]
      if (typeof t === "string" && /^[a-z][a-z0-9-]*$/.test(t)) return t
    }
    switch (n.type) {
      case "text":
        return isObject(n.style) && typeof n.style.href === "string" ? "a" : "p"
      case "path":
      case "polygon":
      case "icon":
        return "svg"
      case "ellipse": {
        const inner = num(n.innerRadius) ?? 0
        const sweep = num(n.sweepAngle) ?? 360
        return inner > 0 || Math.abs(sweep) < 360 ? "svg" : "div"
      }
      case "frame":
        return placement.mode === "root" ? "section" : "div"
      default:
        return "div"
    }
  }

  // --- Sizing (engine.ts sizeSpec / applyStyle) ---------------------------------------------

  private pathSize(n: NodeRecord, axis: "w" | "h"): number {
    const vb = n.viewBox
    if (Array.isArray(vb) && vb.length === 4) {
      const v = num(vb[axis === "w" ? 2 : 3])
      if (v !== undefined && v >= 0) return v
    }
    const b = typeof n.d === "string" ? pathBounds(n.d) : null
    if (!b) return 0
    return axis === "w" ? b.w : b.h
  }

  private fitFallback(id: string, n: NodeRecord, axis: "w" | "h"): number | undefined {
    const v = this.value(id, n[axis], "spacing").v
    if (isObject(v) && v.mode === "fit") {
      const fb = num(v.fallback)
      return fb !== undefined && fb >= 0 ? fb : undefined
    }
    return undefined
  }

  private size(id: string, n: NodeRecord, axis: "w" | "h", parentDir: string | null): IRSize {
    const t = n.type
    if (t === "group") return { kind: "fit" }
    if (t === "text") {
      const grow = n.grow === "fixed-width" || n.grow === "fixed" ? n.grow : "auto"
      if (grow === "auto") return { kind: "fit" }
      if (grow === "fixed-width" && axis === "h") return { kind: "fit" }
    }
    let raw = n[axis]
    if (t === "instance") {
      raw = isObject(n.props) ? n.props[axis] : undefined
      if (raw === undefined) return { kind: "fixed", px: { v: 100 } }
    }
    if (raw === undefined) {
      if (t === "path") return { kind: "fixed", px: { v: this.pathSize(n, axis) } }
      if (FIT_BY_DEFAULT.has(t)) return { kind: "fit" }
      return { kind: "fixed", px: { v: 0 } }
    }
    const r = this.value(id, raw, "spacing")
    if (typeof r.v === "number") {
      const v = Number.isFinite(r.v) && r.v >= 0 ? r.v : 0
      return { kind: "fixed", px: r.ref ? { v, ref: r.ref } : { v } }
    }
    if (isObject(r.v) && (r.v.mode === "fit" || r.v.mode === "fill")) {
      const min = num(r.v.min)
      const max = num(r.v.max)
      const fallback = num(r.v.fallback)
      const clamp = (s: IRSize): IRSize => {
        if (s.kind === "fixed") return s
        const o = { ...s }
        if (min !== undefined && min >= 0) o.min = min
        if (max !== undefined && max >= 0) o.max = max
        return o
      }
      if (r.v.mode === "fill") {
        if (parentDir !== null) {
          const main = (parentDir === "row") === (axis === "w")
          const w = num(r.v.weight) ?? 1
          return clamp({ kind: "fill", axis: main ? "main" : "cross", weight: w > 0 ? w : 1 })
        }
        if (fallback !== undefined && fallback >= 0) return { kind: "fixed", px: { v: fallback } }
      }
      // fit, or fill outside a flex flow without a fallback: the content size.
      if (t !== "frame" && t !== "text" && t !== "instance") {
        if (t === "path") return { kind: "fixed", px: { v: this.pathSize(n, axis) } }
        const fb = r.v.mode === "fit" && fallback !== undefined && fallback >= 0 ? fallback : 0
        return { kind: "fixed", px: { v: fb } }
      }
      return clamp({ kind: "fit" })
    }
    return FIT_BY_DEFAULT.has(t) ? { kind: "fit" } : { kind: "fixed", px: { v: 0 } }
  }

  /**
   * Groups (§5.5): no size of their own, bounds = their visible children's. The group box sits
   * at its x/y plus the children's minimum; children are placed relative to that box.
   */
  private group(node: IRNode, kids: { id: string; n: NodeRecord }[]) {
    const built: IRNode[] = []
    for (const c of kids) {
      const cnode = this.buildNode(c.id, { mode: "absolute", ...this.xy(c.n) }, null)
      if (cnode) built.push(cnode)
    }
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let known = true
    for (const c of built) {
      if (!c.visible) continue
      const s = this.staticSize(c)
      if (!s) {
        known = false
        break
      }
      const p = c.placement as { x: number; y: number }
      const b = bounds(p.x, p.y, s.w, s.h, c.transform)
      minX = Math.min(minX, b.x)
      minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.w)
      maxY = Math.max(maxY, b.y + b.h)
    }
    node.children = built
    if (!known) {
      this.issue(
        "SIZE_UNRESOLVED",
        "group bounds depend on text or fit content; children are stacked from the group origin",
        node.id,
      )
      node.childMode = "stack"
      for (const c of built) {
        const p = c.placement as { x: number; y: number }
        c.placement = { mode: "stack", x: p.x, y: p.y }
      }
      return
    }
    if (minX > maxX) {
      minX = 0
      minY = 0
      maxX = 0
      maxY = 0
    }
    node.childMode = "absolute"
    node.w = { kind: "fixed", px: { v: maxX - minX } }
    node.h = { kind: "fixed", px: { v: maxY - minY } }
    if (node.placement.mode === "absolute" || node.placement.mode === "stack")
      node.placement = {
        ...node.placement,
        x: node.placement.x + minX,
        y: node.placement.y + minY,
      }
    for (const c of built) {
      const p = c.placement as { mode: "absolute"; x: number; y: number }
      c.placement = { mode: "absolute", x: p.x - minX, y: p.y - minY }
    }
  }

  /** Size known without a layout pass (fixed sizes, groups of those), or from `layout`. */
  private staticSize(c: IRNode): { w: number; h: number } | null {
    if (c.w.kind === "fixed" && c.h.kind === "fixed") return { w: c.w.px.v, h: c.h.px.v }
    const l = this.options.layout?.nodes.get(c.id)
    return l ? { w: l.local.w, h: l.local.h } : null
  }

  private transform(id: string, n: NodeRecord) {
    const rotation = this.num(id, n.rotation, "rotation", 0).v
    const flipX = n.flipX === true
    const flipY = n.flipY === true
    if (rotation === 0 && !flipX && !flipY) return null
    return { rotation, flipX, flipY }
  }

  // --- Layout ------------------------------------------------------------------------------

  private flex(id: string, n: NodeRecord): IRFlex | null {
    if (n.type !== "frame" || !isObject(n.layout)) return null
    const L = n.layout
    if (L.dir !== "row" && L.dir !== "column") return null
    const gap = this.num(id, L.gap, "spacing", 0)
    const cross = this.num(id, L.crossGap, "spacing", 0)
    if (cross.v < 0) cross.v = 0
    const pad = this.padding(id, L.pad)
    const extra: [number, number, number, number] = [0, 0, 0, 0]
    if (L.includeStroke === true && isObject(n.stroke)) {
      const w = this.value(id, n.stroke.width, "spacing").v
      if (w === undefined || typeof w === "number") {
        const s = w === undefined ? 1 : Math.max(0, w)
        extra.fill(s)
      } else if (isObject(w))
        (["t", "r", "b", "l"] as const).forEach((k, i) => {
          extra[i] = Math.max(0, num(this.value(id, w[k], "spacing").v) ?? 0)
        })
    }
    const justify = ["start", "center", "end", "between", "around", "evenly"].includes(
      L.justify as string,
    )
      ? (L.justify as IRFlex["justify"])
      : "start"
    const align = ["start", "center", "end", "stretch", "baseline"].includes(L.align as string)
      ? (L.align as IRFlex["align"])
      : "start"
    return {
      dir: L.dir,
      gap: gap.v < 0 ? { v: 0 } : gap,
      negativeGap: gap.v < 0 ? gap.v : 0,
      crossGap: cross,
      pad,
      padExtra: extra,
      justify,
      align,
      wrap: L.wrap === true,
    }
  }

  private padding(id: string, raw: unknown): [IRNum, IRNum, IRNum, IRNum] {
    const r = this.value(id, raw, "spacing")
    const one = (v: unknown, ref?: string): IRNum => {
      const x = this.num(id, v, "spacing", 0)
      const o = { ...x, v: Math.max(0, x.v) }
      if (ref && !o.ref) o.ref = ref
      return o
    }
    if (typeof r.v === "number") {
      const p = one(r.v, r.ref)
      return [p, { ...p }, { ...p }, { ...p }]
    }
    if (Array.isArray(r.v) && r.v.length === 2) {
      const v = one(r.v[0])
      const h = one(r.v[1])
      return [v, h, { ...v }, { ...h }]
    }
    if (Array.isArray(r.v) && r.v.length === 4)
      return [one(r.v[0]), one(r.v[1]), one(r.v[2]), one(r.v[3])]
    return [{ v: 0 }, { v: 0 }, { v: 0 }, { v: 0 }]
  }

  // --- Visual ------------------------------------------------------------------------------

  private paints(id: string, raw: unknown): IRPaint[] {
    const r = isRef(raw) ? raw : raw
    const list = Array.isArray(r) ? r : r === undefined ? [] : [r]
    const out: IRPaint[] = []
    for (const p of list) {
      const paint = this.paint(id, p)
      if (paint) out.push(paint)
    }
    return out
  }

  private paint(id: string, p: unknown): IRPaint | null {
    if (typeof p === "string" || isRef(p) || (isObject(p) && typeof p.space === "string")) {
      const c = this.color(id, p)
      return c ? { kind: "solid", color: c, blend: "normal" } : null
    }
    if (!isObject(p) || p.visible === false) return null
    const blend = typeof p.blend === "string" ? p.blend : "normal"
    switch (p.kind) {
      case "solid": {
        const c = this.color(id, p.color)
        return c ? { kind: "solid", color: c, blend } : null
      }
      case "linear":
      case "radial":
      case "angular": {
        const opacity = clamp01(this.num(id, p.opacity, "opacity", 1).v)
        const stops = []
        if (Array.isArray(p.stops))
          for (const s of p.stops) {
            if (!isObject(s)) continue
            const c = this.color(id, s.color, opacity)
            if (c) stops.push({ at: clamp01(num(s.at) ?? 0), color: c })
          }
        if (stops.length < 2) return null
        stops.sort((a, b) => a.at - b.at)
        const c = Array.isArray(p.center) ? p.center : []
        const s = Array.isArray(p.size) ? p.size : []
        return {
          kind: p.kind,
          stops,
          center: [num(c[0]) ?? 0.5, num(c[1]) ?? 0.5],
          size: [num(s[0]) ?? 1, num(s[1]) ?? 1],
          rotation: num(p.rotation) ?? 0,
          interpolation: p.interpolation === "oklab" ? "oklab" : "srgb",
          opacity,
          blend,
        }
      }
      case "image": {
        if (typeof p.src !== "string") return null
        this.assets.add(p.src)
        const crop =
          Array.isArray(p.crop) && p.crop.length === 6 && p.crop.every((x) => num(x) !== undefined)
            ? (p.crop as unknown as [number, number, number, number, number, number])
            : null
        return {
          kind: "image",
          src: p.src,
          // Fit "crop" (board 27): the `crop` region stretched to the box.
          fit: ["cover", "contain", "stretch", "tile"].includes(p.fit as string)
            ? (p.fit as "cover")
            : p.fit === "crop"
              ? "stretch"
              : "cover",
          crop,
          opacity: clamp01(this.num(id, p.opacity, "opacity", 1).v),
          blend,
        }
      }
      case "mesh": {
        const cols = num(p.cols)
        const rows = num(p.rows)
        if (cols === undefined || rows === undefined || cols < 1 || rows < 1) return null
        const n = Math.floor(cols) * Math.floor(rows)
        if (!Array.isArray(p.colors) || p.colors.length < n) return null
        const colors: IRColor[] = []
        for (let i = 0; i < n; i++) {
          const c = this.color(id, p.colors[i])
          if (!c) return null
          colors.push(c)
        }
        const pts = Array.isArray(p.points) ? p.points : []
        const points: [number, number][] = []
        for (let i = 0; i < n; i++) {
          // `[x, y]` or `{ position: [x, y], …handles }` (pen.dev mesh points).
          const raw = pts[i]
          const at = Array.isArray(raw) ? raw : isObject(raw) ? raw.position : undefined
          const xy = Array.isArray(at) ? [num(at[0]), num(at[1])] : []
          const c = i % Math.floor(cols)
          const r = Math.floor(i / Math.floor(cols))
          points.push([
            xy[0] ?? (cols > 1 ? c / (Math.floor(cols) - 1) : 0.5),
            xy[1] ?? (rows > 1 ? r / (Math.floor(rows) - 1) : 0.5),
          ])
        }
        return {
          kind: "mesh",
          cols: Math.floor(cols),
          rows: Math.floor(rows),
          colors,
          points,
          blend,
        }
      }
      case "shader":
        return typeof p.src === "string" ? { kind: "shader", src: p.src, blend } : null
      default:
        this.issue("PAINT_UNSUPPORTED", `paint kind ${String(p.kind)} is not exported`, id)
        return null
    }
  }

  private visual(id: string, n: NodeRecord): IRVisual {
    const t = n.type
    const v: IRVisual = {
      fills: [],
      stroke: null,
      radius: null,
      opacity: null,
      blend: null,
      isolate: false,
      clip: false,
      shadows: [],
      blur: null,
      backdropBlur: null,
    }
    if (t !== "text" && t !== "icon" && t !== "group") v.fills = this.paints(id, n.fill)
    if (t !== "text" && t !== "icon" && t !== "group" && isObject(n.stroke))
      v.stroke = this.stroke(id, n.stroke)
    if (t === "frame" || t === "rect" || t === "browser") {
      const r = this.value(id, n.radius, "radius")
      if (Array.isArray(r.v) && r.v.length === 4) {
        const rs = r.v.map((x) => this.num(id, x, "radius", 0)) as [IRNum, IRNum, IRNum, IRNum]
        if (rs.some((x) => x.v !== 0 || x.ref)) v.radius = rs
      } else if (typeof r.v === "number" && (r.v !== 0 || r.ref)) {
        const one: IRNum = r.ref ? { v: r.v, ref: r.ref } : { v: r.v }
        v.radius = [one, { ...one }, { ...one }, { ...one }]
      }
    }
    if (t !== "instance") {
      const o = this.num(id, n.opacity, "opacity", 1)
      if (o.v !== 1 || o.ref) v.opacity = { ...o, v: clamp01(o.v) }
      if (typeof n.blend === "string" && !NORMAL_BLENDS.has(n.blend)) v.blend = n.blend
      if (t === "frame") v.clip = this.value(id, n.clip, "visible").v === true
    }
    let effects = n.effects
    if (isRef(effects)) {
      const r = this.value(id, effects, "shadow").v
      effects = Array.isArray(r) ? r : r === undefined ? [] : [r]
    }
    if (Array.isArray(effects))
      for (const e of effects) {
        if (!isObject(e) || e.visible === false) continue
        if (e.kind === "shadow") {
          const color = this.color(id, e.color)
          if (!color) continue
          const s: IRShadow = {
            inner: e.inner === true,
            x: this.num(id, e.x, "spacing", 0),
            y: this.num(id, e.y, "spacing", 0),
            blur: this.num(id, e.blur, "blur", 0),
            spread: this.num(id, e.spread, "spacing", 0),
            color,
            blend: typeof e.blend === "string" ? e.blend : "normal",
          }
          v.shadows.push(s)
        } else if (e.kind === "blur") v.blur = this.num(id, e.radius, "blur", 0)
        else if (e.kind === "backdrop-blur") v.backdropBlur = this.num(id, e.radius, "blur", 0)
      }
    return v
  }

  private stroke(id: string, s: Record<string, unknown>): IRStroke | null {
    const paints = this.paints(id, s.paint)
    if (paints.length === 0) return null
    const wr = this.value(id, s.width, "spacing")
    let width: IRStroke["width"]
    if (isObject(wr.v) && !isRef(wr.v)) {
      const w = wr.v
      const side = (k: string) => {
        const x = this.num(id, w[k], "spacing", 0)
        return { ...x, v: Math.max(0, x.v) }
      }
      width = { t: side("t"), r: side("r"), b: side("b"), l: side("l") } as IRSides<IRNum>
    } else {
      const v = Math.max(0, num(wr.v) ?? 1)
      width = wr.ref ? { v, ref: wr.ref } : { v }
    }
    const dash =
      Array.isArray(s.dash) && s.dash.length > 0 && s.dash.every((x) => num(x) !== undefined)
        ? (s.dash as number[])
        : null
    return {
      paints,
      width,
      align: s.align === "center" || s.align === "outside" ? s.align : "inside",
      cap: s.cap === "round" || s.cap === "square" ? s.cap : "butt",
      join: s.join === "bevel" || s.join === "round" ? s.join : "miter",
      miterLimit: num(s.miterLimit) ?? 4,
      dash,
    }
  }

  /** A frame/group whose descendants blend non-normally composites as an isolated group. */
  private needsIsolation(node: IRNode): boolean {
    if (node.type !== "frame" && node.type !== "group") return false
    if (node.visual.blend !== null) return false
    const blends = (c: IRNode): boolean =>
      c.visual.blend !== null ||
      c.visual.fills.some((p) => p.blend !== "normal") ||
      (c.visual.stroke?.paints.some((p) => p.blend !== "normal") ?? false) ||
      c.visual.shadows.some((s) => s.blend !== "normal") ||
      c.children.some(blends)
    return node.children.some(blends)
  }

  // --- Shapes, icons -----------------------------------------------------------------------

  private shape(id: string, n: NodeRecord): IRShape | null {
    switch (n.type) {
      case "rect":
        return { kind: "rect" }
      case "ellipse":
        return {
          kind: "ellipse",
          innerRadius: num(n.innerRadius) ?? 0,
          startAngle: num(n.startAngle) ?? 0,
          sweepAngle: num(n.sweepAngle) ?? 360,
        }
      case "polygon":
        return {
          kind: "polygon",
          sides: Math.max(3, Math.floor(num(n.sides) ?? 3)),
          cornerRadius: this.num(id, n.radius, "radius", 0).v,
          ...(isObject(n.star)
            ? { starRatio: Math.max(0.01, Math.min(1, num(n.star.ratio) ?? 0.38)) }
            : {}),
        }
      case "path": {
        const vb = n.viewBox
        return {
          kind: "path",
          d: typeof n.d === "string" ? n.d : "",
          fillRule: n.fillRule === "evenodd" ? "evenodd" : "nonzero",
          viewBox:
            Array.isArray(vb) && vb.length === 4 && vb.every((x) => num(x) !== undefined)
              ? (vb as [number, number, number, number])
              : null,
        }
      }
      default:
        return null
    }
  }

  private icon(id: string, n: NodeRecord): IRIcon | null {
    if (n.type !== "icon") return null
    const name = this.value(id, n.icon, "icon").v
    const set = typeof n.set === "string" ? n.set : ""
    const weight = n.weight === undefined ? null : this.num(id, n.weight, "font-weight", 400).v
    const sw = n.strokeWidth === undefined ? null : this.num(id, n.strokeWidth, "spacing", 2).v
    const color = this.color(id, n.color ?? "#000000") ?? {
      css: "#000000",
      rgba: [0, 0, 0, 1] as const,
    }
    const icon: IRIcon = {
      set,
      name: typeof name === "string" ? name : "",
      weight,
      strokeWidth: sw,
      color,
    }
    this.icons.set(`${set}\u0000${icon.name}\u0000${weight ?? ""}`, {
      set,
      name: icon.name,
      weight,
    })
    return icon
  }

  // --- Text --------------------------------------------------------------------------------

  private textStyle(id: string, style: unknown, base: IRTextStyle): IRTextStyle {
    if (!isObject(style)) return base
    const out: IRTextStyle = { ...base, features: { ...base.features } }
    const layers: Record<string, unknown>[] = []
    const typo = this.value(id, style.typography, "typography").v
    if (isObject(typo)) layers.push(typo)
    layers.push(style)
    for (const s of layers) {
      if (s.font !== undefined) {
        const f = this.value(id, s.font, "font")
        if (typeof f.v === "string" && f.v) out.family = f.ref ? { v: f.v, ref: f.ref } : { v: f.v }
      }
      if (s.size !== undefined) {
        const x = this.num(id, s.size, "text", out.size.v)
        if (x.v > 0) out.size = x
      }
      if (s.weight !== undefined) out.weight = this.num(id, s.weight, "font-weight", out.weight.v)
      if (typeof s.italic === "boolean") out.italic = s.italic
      const lh = s.lineHeight
      if (isObject(lh) && !isRef(lh)) {
        const px = num(lh.px)
        if (px !== undefined) out.lineHeight = { kind: "px", v: px }
      } else if (lh !== undefined) {
        const m = this.num(id, lh, "leading", Number.NaN)
        if (Number.isFinite(m.v)) out.lineHeight = { kind: "multiplier", v: m }
      }
      if (s.letterSpacing !== undefined)
        out.letterSpacing = this.num(id, s.letterSpacing, "tracking", out.letterSpacing.v)
      if (typeof s.align === "string") out.align = s.align as IRTextStyle["align"]
      if (typeof s.valign === "string") out.valign = s.valign as IRTextStyle["valign"]
      if (Array.isArray(s.decoration))
        out.decoration = (s.decoration as IRTextStyle["decoration"]).slice()
      if (typeof s.case === "string") out.case = s.case as IRTextStyle["case"]
      if (isObject(s.features))
        for (const [k, v] of Object.entries(s.features))
          if (typeof v === "boolean" || typeof v === "number") out.features[k] = v
    }
    return out
  }

  private baseStyle(): IRTextStyle {
    const d = TEXT_STYLE_DEFAULTS
    return {
      family: { v: d.fontFamily },
      size: { v: d.fontSize },
      weight: { v: d.fontWeight },
      italic: d.italic,
      lineHeight: { kind: "normal" } as IRLineHeight,
      letterSpacing: { v: d.letterSpacing },
      align: d.align,
      valign: d.valign,
      decoration: [],
      case: d.case,
      features: {},
    }
  }

  private text(id: string, n: NodeRecord): IRText {
    const style = this.textStyle(id, n.style, this.baseStyle())
    const content = n.content
    const runs: IRTextRun[] = []
    if (Array.isArray(content)) {
      for (const span of content) {
        if (!isObject(span)) continue
        const run: IRTextRun = {
          text: typeof span.text === "string" ? span.text : "",
          style: this.textStyle(id, span.style, style),
        }
        if (typeof span.href === "string") run.href = span.href
        if (span.fill !== undefined) {
          const c = this.color(id, span.fill)
          if (c) run.color = c
        }
        runs.push(run)
      }
    } else {
      const v = this.value(id, content, "content").v
      runs.push({ text: typeof v === "string" ? v : "", style })
    }
    for (const r of runs) {
      const k = `${r.style.family.v}\u0000${r.style.weight.v}\u0000${r.style.italic}`
      this.fonts.set(k, {
        family: r.style.family.v,
        weight: r.style.weight.v,
        italic: r.style.italic,
      })
    }
    const fillRaw = n.fill === undefined ? defaultTextFill(this.ctx.doc) : n.fill
    const out: IRText = {
      grow: n.grow === "fixed-width" || n.grow === "fixed" ? n.grow : "auto",
      style,
      runs,
      fills: this.paints(id, fillRaw),
    }
    if (isObject(n.style) && typeof n.style.href === "string") out.href = n.style.href
    return out
  }

  // --- Components ------------------------------------------------------------------------------

  /** Describes an expanded instance as a component reference (see {@link IRInstanceRef}). */
  private instanceRef(id: string, n: NodeRecord, node: IRNode): IRInstanceRef | null {
    const origin = this.ctx.view.origin(id)
    const info = origin?.instance
    if (!origin || !info?.resolved) return null
    if (id.startsWith(SYNTHETIC_PREFIX) && this.synthetic.has(id)) return null
    const of = info.of
    const located = locate({ doc: this.ctx.doc, libraries: this.libs }, of)
    if (!isLocated(located)) return null
    const props = declaredProps({ doc: this.ctx.doc, libraries: this.libs }, located)
    const reasons = new Set<string>()
    const args: Record<string, IRArgValue> = {}
    const slots: Record<string, IRNode[]> = {}
    const prefix = `${id}/`
    const own = (h: string) => h === id
    const inside = (h: string) => h === id || h.startsWith(prefix)

    // Every override applied in the expansion must come from this instance (expressible), from
    // the component itself (derived layers, nested instances inside the content), else inline.
    const visit = (c: IRNode) => {
      const o = this.ctx.view.origin(c.id)
      for (const a of o?.overrides ?? []) {
        if (a.layer === "derived" || (inside(a.holder) && !own(a.holder))) continue
        if (!own(a.holder)) {
          reasons.add(`outer:${a.holder}`)
          continue
        }
        if (a.layer === "args") continue
        if (a.layer === "props") {
          if (c.id === id && a.fields.every((f) => f === "w" || f === "h")) continue
          reasons.add(`props:${a.fields.join(",")}`)
          continue
        }
        if (a.kind === "slot") {
          const p = props.find((d) => d.def.type === "slot" && d.path === a.key)
          if (p) slots[p.name] = c.children
          else reasons.add(`slot:${a.key}`)
          continue
        }
        if (a.kind === "replace") {
          reasons.add(`replace:${a.key}`)
          continue
        }
        const arg = this.overrideAsArg(id, a.key, a.fields, props)
        if (arg) args[arg.name] = arg.value
        else reasons.add(`set:${a.key}:${a.fields.join(",")}`)
      }
      for (const k of c.children) if (!k.instance || k.id.startsWith(prefix)) visit(k)
    }
    visit(node)

    // The instance's own args (consumer data for real instances).
    const real = this.authored(id)
    const rawArgs = real?.type === "instance" && isObject(real.args) ? real.args : {}
    for (const [name, raw] of Object.entries(rawArgs)) {
      const p = props.find((d) => d.name === name)
      if (!p) continue
      const t = (p.def as { type: string }).type
      const v = this.value(id, raw, t === "boolean" ? "visible" : "content").v
      if (t === "text" && typeof v === "string") args[name] = { type: "text", value: v }
      else if (t === "boolean" && typeof v === "boolean") args[name] = { type: "boolean", value: v }
      else if (t === "enum" && typeof v === "string") args[name] = { type: "enum", value: v }
      else if (t === "instance" && typeof v === "string")
        args[name] = { type: "instance", component: v }
    }
    if (this.options.cssVariables === false && real?.type === "instance" && isObject(real.theme))
      reasons.add("theme")
    if (n.type !== "instance" && real?.type !== "instance" && !id.includes("/")) return null // a real node that merely is a component main, not an instance
    const index = this.requestComponent(of)
    return {
      of,
      component: index,
      args: sortRecord(args),
      slots: sortRecord(slots),
      needsInline: reasons.size > 0,
      inlineReasons: [...reasons].sort(),
    }
  }

  /**
   * The authored instance node behind a view id: the document node for a real id, else the
   * node the expansion cloned (component content, read in the consumer namespace).
   */
  private authored(id: string): Record<string, unknown> | undefined {
    const nodes = this.ctx.doc.nodes as Record<string, Record<string, unknown> | undefined>
    if (Object.hasOwn(nodes, id)) return nodes[id]
    // A composite id ends with the nested instance's own (qualified) id (§9.8).
    const { alias, name } = splitQualified(id.slice(id.lastIndexOf("/") + 1))
    const src = alias === null ? nodes : (this.libs[alias]?.nodes as typeof nodes | undefined)
    const raw = src?.[name]
    return raw ? qualifyNodeData(raw, alias) : undefined
  }

  /** A `set` override expressible as a declared prop arg, or null. */
  private overrideAsArg(
    id: string,
    key: string,
    fields: readonly string[],
    props: ReturnType<typeof declaredProps>,
  ): { name: string; value: IRArgValue } | null {
    if (fields.length !== 1) return null
    const field = fields[0] as string
    const real = this.authored(id)
    const ov = real && isObject(real.overrides) ? real.overrides[key] : undefined
    const set = isObject(ov) && isObject(ov.set) ? ov.set : null
    if (!set) return null
    const raw = set[field]
    for (const p of props) {
      if (p.path !== key) continue
      const def = p.def as unknown as Record<string, unknown>
      if (def.type === "text" && field === "content") {
        const v = this.value(id, raw, "content").v
        if (typeof v === "string") return { name: p.name, value: { type: "text", value: v } }
      }
      if (def.type === "boolean" && field === "visible") {
        const v = this.value(id, raw, "visible").v
        if (typeof v === "boolean") return { name: p.name, value: { type: "boolean", value: v } }
      }
      if (def.type === "instance" && field === "of" && typeof raw === "string")
        return { name: p.name, value: { type: "instance", component: raw } }
      if (def.type === "enum" && def.field === field && isObject(def.options)) {
        for (const [opt, v] of Object.entries(def.options))
          if (JSON.stringify(v) === JSON.stringify(raw))
            return { name: p.name, value: { type: "enum", value: opt } }
      }
    }
    return null
  }

  private requestComponent(qid: string): number {
    const known = this.componentIndex.get(qid)
    if (known !== undefined) return known
    const index = this.components.length
    this.componentIndex.set(qid, index)
    // Placeholder, filled by buildComponents().
    this.components.push(null as unknown as IRComponent)
    this.pending.push(qid)
    return index
  }

  private pending: string[] = []

  /** Builds every requested component (and those their content requests) in rounds. */
  private buildComponents(_roots: IRNode[]) {
    while (this.pending.length > 0) {
      const batch = this.pending
      this.pending = []
      const plan: { qid: string; id: string; enums: Map<string, Map<string, string>> }[] = []
      for (const qid of batch) {
        const id = this.syntheticId()
        this.synthetic.set(id, { of: qid, args: {} })
        const enums = new Map<string, Map<string, string>>()
        const located = locate({ doc: this.doc, libraries: this.libs }, qid)
        if (isLocated(located))
          for (const p of declaredProps({ doc: this.doc, libraries: this.libs }, located)) {
            const def = p.def as unknown as Record<string, unknown>
            if (def.type !== "enum" || !isObject(def.options)) continue
            const m = new Map<string, string>()
            for (const opt of Object.keys(def.options).sort()) {
              const oid = this.syntheticId()
              this.synthetic.set(oid, { of: qid, args: { [p.name]: opt } })
              m.set(opt, oid)
            }
            enums.set(p.name, m)
          }
        plan.push({ qid, id, enums })
      }
      this.ctx = this.makeCtx()
      for (const { qid, id, enums } of plan) {
        const index = this.componentIndex.get(qid) as number
        this.components[index] = this.buildComponent(qid, id, enums)
      }
    }
  }

  private buildComponent(
    qid: string,
    id: string,
    enums: Map<string, Map<string, string>>,
  ): IRComponent {
    const located = locate({ doc: this.ctx.doc, libraries: this.libs }, qid)
    const decl = isLocated(located)
      ? declaredProps({ doc: this.ctx.doc, libraries: this.libs }, located)
      : []
    const targetOf = (path: string) => (path === "" ? id : `${id}/${path}`)
    // Boolean prop targets render conditionally: keep them although hidden.
    for (const p of decl)
      if ((p.def as { type: string }).type === "boolean") this.keepHidden.add(targetOf(p.path))
    const keys = this.keys
    this.keys = new NameRegistry()
    const root = this.buildNode(id, { mode: "root" }, null) as IRNode
    const props: IRComponentProp[] = []
    const idents = new NameRegistry("")
    for (const p of decl) {
      const def = p.def as unknown as Record<string, unknown>
      const ident = idents.take(propIdent(p.name))
      const targetId = targetOf(p.path)
      switch (def.type) {
        case "text":
          props.push({
            name: p.name,
            ident,
            type: "text",
            targetId,
            default: typeof def.default === "string" ? def.default : null,
          })
          break
        case "boolean":
          props.push({
            name: p.name,
            ident,
            type: "boolean",
            targetId,
            default: typeof def.default === "boolean" ? def.default : null,
          })
          break
        case "instance":
          props.push({
            name: p.name,
            ident,
            type: "instance",
            targetId,
            default: typeof def.default === "string" ? def.default : null,
          })
          break
        case "slot":
          props.push({ name: p.name, ident, type: "slot", targetId })
          break
        case "enum": {
          const options: Record<string, IRNode> = {}
          for (const [opt, oid] of enums.get(p.name) ?? []) {
            this.keys = new NameRegistry()
            const optRoot = this.buildNode(oid, { mode: "root" }, null)
            const target = optRoot && findNode(optRoot, p.path === "" ? oid : `${oid}/${p.path}`)
            if (target) options[opt] = target
          }
          props.push({
            name: p.name,
            ident,
            type: "enum",
            targetId,
            field: String(def.field),
            options,
          })
          break
        }
      }
    }
    this.keys = keys
    const node = located && isLocated(located) ? located.node : {}
    const name = typeof node.name === "string" ? node.name : splitQualified(qid).name
    const meta = isObject(node.meta) ? node.meta : {}
    const description = meta["kimo.component.description"]
    return {
      qid,
      name,
      ident: this.componentIdents.take(pascal(name)),
      description: typeof description === "string" ? description : null,
      root,
      props,
    }
  }

  // --- Tokens ------------------------------------------------------------------------------

  private axes(): IRAxis[] {
    const out: IRAxis[] = []
    const add = (key: string, values: unknown) => {
      if (!Array.isArray(values) || typeof values[0] !== "string") return
      out.push({ key, attr: axisAttr(key), values: values as string[], default: values[0] })
    }
    for (const [axis, values] of Object.entries(this.doc.themes ?? {})) add(axis, values)
    for (const alias of Object.keys(this.doc.imports ?? {}).sort()) {
      const lib = this.libs[alias]
      if (!lib) continue
      for (const [axis, values] of Object.entries(lib.themes ?? {})) add(`${alias}:${axis}`, values)
    }
    return out
  }

  private variables(): IRVariable[] {
    const base = defaultTheme(this.doc, this.libs)
    const out: IRVariable[] = []
    const seen = new Set<string>()
    const add = (name: string, raw: Record<string, unknown>, alias: string | null) => {
      if (seen.has(name)) return
      seen.add(name)
      const q = (v: unknown): unknown =>
        alias !== null && isRef(v) && !v.$ref.includes(":") ? { $ref: `${alias}:${v.$ref}` } : v
      const qWhen = (w: unknown): Record<string, string> | undefined => {
        if (!isObject(w) || Object.keys(w).length === 0) return undefined
        const o: Record<string, string> = {}
        for (const k of Object.keys(w).sort())
          o[alias !== null && !k.includes(":") ? `${alias}:${k}` : k] = String(w[k])
        return o
      }
      const themed = Array.isArray(raw.value) && raw.value.every((e) => isObject(e) && "value" in e)
      const r = resolveVariable(this.ctx.doc, name, base, this.libs)
      const v: IRVariable = {
        name,
        type: String(raw.type),
        css: cssVarName(name),
        value: themed ? null : q(raw.value),
        entries: themed
          ? (raw.value as Record<string, unknown>[]).map((e) => {
              const entry: { value: unknown; when?: Record<string, string> } = {
                value: q(e.value),
              }
              const w = qWhen(e.when)
              if (w) entry.when = w
              return entry
            })
          : null,
        resolved: r.ok ? r.value : null,
        usage: [],
      }
      if (typeof raw.description === "string") v.description = raw.description
      if (typeof raw.group === "string") v.group = raw.group
      out.push(v)
      // Aliases pull their targets in (library variables are only listed when used).
      for (const e of themed ? (raw.value as Record<string, unknown>[]) : [{ value: raw.value }]) {
        const t = q(e.value)
        if (isRef(t)) addRef(t.$ref)
      }
    }
    const addRef = (ref: string) => {
      const { alias, name } = splitQualified(ref)
      const src = alias === null ? this.doc : this.libs[alias]
      const raw = (src?.variables as Record<string, unknown> | undefined)?.[name]
      if (isObject(raw)) add(ref, raw, alias)
    }
    for (const [name, raw] of Object.entries(this.doc.variables ?? {}))
      if (isObject(raw)) add(name, raw, null)
    for (const ref of [...this.usage.keys()].sort()) addRef(ref)
    // Usage propagates along aliases (a color alias of a spacing token is still spacing).
    const byName = new Map(out.map((v) => [v.name, v]))
    const usage = new Map<string, Set<string>>()
    for (const [ref, s] of this.usage) usage.set(ref, new Set(s))
    let changed = true
    while (changed) {
      changed = false
      for (const v of out) {
        const mine = usage.get(v.name)
        if (!mine) continue
        const targets = (v.entries ?? [{ value: v.value }])
          .map((e) => e.value)
          .filter(isRef)
          .map((r) => r.$ref)
        for (const t of targets) {
          if (!byName.has(t)) continue
          let s = usage.get(t)
          if (!s) {
            s = new Set()
            usage.set(t, s)
          }
          for (const u of mine)
            if (!s.has(u)) {
              s.add(u)
              changed = true
            }
        }
      }
    }
    for (const v of out) v.usage = [...(usage.get(v.name) ?? [])].sort()
    // Local first (by name), then library variables (by name).
    out.sort((a, b) => {
      const la = a.name.includes(":") ? 1 : 0
      const lb = b.name.includes(":") ? 1 : 0
      return la - lb || cmp(a.name, b.name)
    })
    void selectThemedValue
    return out
  }
}

// --- Helpers --------------------------------------------------------------------------------

/** A CSS color with its alpha multiplied (gradient `opacity`). */
export function withAlphaCss(css: string, alpha: number): string {
  return `color-mix(in srgb, ${css} ${Number((alpha * 100).toFixed(3))}%, transparent)`
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function sortRecord<T>(r: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const k of Object.keys(r).sort()) out[k] = r[k] as T
  return out
}

export function findNode(root: IRNode, id: string): IRNode | null {
  if (root.id === id) return root
  for (const c of root.children) {
    const f = findNode(c, id)
    if (f) return f
  }
  return null
}

/** Axis-aligned bounds of a box at x/y under rotation (CCW about top-left) and flips. */
export function bounds(
  x: number,
  y: number,
  w: number,
  h: number,
  t: { rotation: number; flipX: boolean; flipY: boolean } | null,
): { x: number; y: number; w: number; h: number } {
  if (!t || t.rotation === 0) return { x, y, w, h }
  const r = (t.rotation * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const pts = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ].map(([px = 0, py = 0]) => [x + c * px + s * py, y - s * px + c * py] as const)
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }
}
