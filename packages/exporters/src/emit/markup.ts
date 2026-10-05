/**
 * IR node → element tree, shared by the HTML/CSS and React+Tailwind emitters. The emitter
 * decides how declarations become attributes (a class rule, or utilities) through hooks.
 */
import type { CssWriter, Decl, NodeCss } from "../css/style"
import type { IRColor, IRNode } from "../ir/types"
import { type AttrValue, type Child, type El, el, text } from "./el"
import { shapePath } from "./geometry"
import { type IconLookup, SvgPainter } from "./svgpaint"
import { THEME_MARKER } from "./tokens"

export interface MarkupHooks {
  writer: CssWriter
  icons?: IconLookup
  /** Keep layer names as `data-layer` attributes. */
  layerNames: boolean
  /** Add `data-kimo-id` (verification harness). */
  ids: boolean
  /** Attributes carrying the node's styles (class / className). */
  styleAttrs(node: IRNode, css: NodeCss): [string, AttrValue][]
  /** Attributes carrying a text run's styles (relative to the paragraph). */
  runAttrs(node: IRNode, index: number, decls: Decl[]): [string, AttrValue][]
  /** Builds a child (React overrides it for instances and props). */
  child?(node: IRNode, build: (n: IRNode) => Child | null): Child | null
  onIssue?: (
    code: Parameters<NonNullable<CssWriter["onIssue"]>>[0],
    message: string,
    id?: string,
  ) => void
}

/** Theme attributes of a node (`data-kimo-theme`, `data-<axis>`), sorted by axis. */
export function themeAttrs(node: IRNode, attrOf: (axis: string) => string): [string, string][] {
  if (!node.themeAttrs) return []
  const out: [string, string][] = [[THEME_MARKER, ""]]
  for (const k of Object.keys(node.themeAttrs).sort())
    out.push([attrOf(k), node.themeAttrs[k] as string])
  return out
}

/** The color an inline SVG paints with `currentColor` (its CSS `color`), if any. */
export function svgCurrentColor(node: IRNode): IRColor | null {
  if (node.icon) return node.icon.color
  const f = node.visual.fills
  if (f.length === 1 && f[0]?.kind === "solid" && f[0].blend === "normal") return f[0].color
  return null
}

export class Markup {
  private svgCount = 0
  /** Elements built so far, by view id (emitters patch prop targets). */
  readonly built = new Map<string, El>()
  constructor(
    private readonly h: MarkupHooks,
    private readonly attrOf: (axis: string) => string,
  ) {}

  build(node: IRNode): El {
    const h = this.h
    const css = h.writer.node(node)
    const attrs: [string, AttrValue][] = []
    let tag = node.tag
    if (node.text?.href && tag === "p") tag = "a"
    const current = node.tag === "svg" ? svgCurrentColor(node) : null // CSS `color` (CssWriter)
    attrs.push(...h.styleAttrs(node, css))
    if (h.ids) attrs.push(["data-kimo-id", node.id])
    if (h.layerNames && node.name !== null) attrs.push(["data-layer", node.name])
    attrs.push(...themeAttrs(node, this.attrOf))
    if (tag === "a" && node.text?.href) attrs.push(["href", node.text.href])
    const out = el(tag, attrs)
    this.built.set(node.id, out)

    if (node.tag === "svg") {
      this.svg(node, out, current)
      return out
    }
    if (node.text) {
      const t = node.text
      const r0 = t.runs[0]
      const plain =
        t.runs.length === 1 &&
        r0 !== undefined &&
        !r0.color &&
        !r0.href &&
        h.writer.textStyle(r0.style, t.style).length === 0
      if (plain || t.runs.length === 0) out.children.push(text(r0?.text ?? ""))
      else
        t.runs.forEach((r, i) => {
          const decls = [...h.writer.textStyle(r.style, t.style), ...h.writer.runColor(r.color)]
          const ra: [string, AttrValue][] = decls.length ? h.runAttrs(node, i, decls) : []
          if (r.href) ra.push(["href", r.href])
          out.children.push(el(r.href ? "a" : "span", ra, [text(r.text)]))
        })
      return out
    }
    for (const c of node.children) {
      const built = h.child ? h.child(c, (n) => this.build(n)) : this.build(c)
      if (built) out.children.push(built)
    }
    return out
  }

  /** Vector shapes and icons as inline SVG sized by CSS (`viewBox` = the node box). */
  private svg(node: IRNode, out: El, current: IRColor | null) {
    const w = node.w.kind === "fixed" ? node.w.px.v : 24
    const h = node.h.kind === "fixed" ? node.h.px.v : 24
    const painter = new SvgPainter({
      idPrefix: `${node.key}-${++this.svgCount}`,
      currentColor: current,
      onIssue: (code, message) => this.h.onIssue?.(code, message, node.id),
    })
    out.attrs.push(["viewBox", `0 0 ${w} ${h}`], ["overflow", "visible"])
    if (node.w.kind !== "fixed" || node.h.kind !== "fixed")
      out.attrs.push(["preserveAspectRatio", "none"])
    out.attrs.push(["aria-hidden", "true"])
    const kids: El[] = []
    if (node.icon) {
      kids.push(
        ...painter.icon(
          node.icon,
          this.h.icons?.get(node.icon.set, node.icon.name, node.icon.weight ?? undefined) ?? null,
          w,
          h,
        ),
      )
    } else if (node.shape) {
      const radii = node.visual.radius?.map((r) => r.v) ?? null
      const g = shapePath(node.shape, w, h, radii)
      kids.push(...painter.fills(node.visual.fills, g.d, g.fillRule, w, h, g.transform))
      if (node.visual.stroke) {
        const open = node.shape.kind === "path" && !/[zZ]\s*$/.test(g.d)
        kids.push(...painter.stroke(node.visual.stroke, g.d, g.fillRule, w, h, g.transform, open))
      }
    }
    const defs = painter.defsEl()
    out.children.push(...(defs ? [defs] : []), ...kids)
  }
}
