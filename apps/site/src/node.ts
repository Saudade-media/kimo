/**
 * Design node → element translator. Each call mirrors one node of the Pencil tree with that
 * node's own values (layout, gap, padding, justify/align, size, fill, stroke, radius, effect,
 * type), so the emitted DOM is isomorphic to the design. Sizing follows Pencil's model:
 *
 *   number            fixed px (shrinks below the design width only when the viewport forces it)
 *   "fill"            fill_container: flex 1 along the parent's axis, stretch across it
 *   undefined         fit content
 *
 * Strokes are drawn the way Pencil draws them: a full stroke is centered on the edge
 * (outline, offset −w/2) and never moves layout; a per-side stroke is painted inside the edge
 * (inset box-shadow), so the content keeps the node's padding exactly.
 */
import { esc, Raw, raw } from "./html"

export type Size = number | "fill" | undefined
export type Pad = number | [number, number] | [number, number, number, number]
type Dir = "row" | "column" | "none"

/** A color token name ("text-primary" → var(--kimo-text-primary)) or a literal (#…, rgba…). */
export type Paint = string

export interface Box {
  /** Design node name, emitted as data-node for the measured pass. */
  node?: string
  tag?: string
  cls?: string
  attrs?: Record<string, string | undefined>
  layout?: Dir
  gap?: number
  p?: Pad
  jc?: "start" | "center" | "end" | "space_between"
  ai?: "start" | "center" | "end"
  w?: Size
  h?: Size
  bg?: Paint
  /** Full CSS background (gradients). */
  bgImage?: string
  st?: Paint
  /** Stroke width: number (all sides) or per side. */
  sw?: number | { top?: number; right?: number; bottom?: number; left?: number }
  r?: number | string
  shadow?: { x: number; y: number; blur: number; color: Paint }
  clip?: boolean
  theme?: "light" | "dark"
  /** Extra inline CSS. */
  css?: string
}

export interface Text {
  node?: string
  tag?: string
  cls?: string
  attrs?: Record<string, string | undefined>
  font?: "sans" | "mono"
  fs: number
  fw?: number
  lh?: number
  ls?: number
  color: Paint
  ta?: "left" | "center" | "right"
  /** Width: fixed / fill makes the text wrap (Pencil fixed-width growth); undefined = auto. */
  w?: Size
  /** Wraps at the parent's width (fixed-width growth with a fill width). */
  css?: string
}

export type Child = Raw | string | null | undefined | false | Child[]

export const paint = (p: Paint) =>
  p.startsWith("#") || p.startsWith("rgb") || p.startsWith("var(") || p === "transparent"
    ? p
    : `var(--kimo-${p})`

const px = (n: number) => `${+n.toFixed(3)}px`

function padCss(p: Pad): string {
  if (typeof p === "number") return px(p)
  return p.map(px).join(" ")
}

const JC = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  space_between: "space-between",
}
const AI = { start: "flex-start", center: "center", end: "flex-end" }

/** Size along/against the parent's axis. */
function sizeCss(prop: "width" | "height", v: Size, parent: Dir): string[] {
  const main = (parent === "row" && prop === "width") || (parent === "column" && prop === "height")
  if (v === "fill") {
    if (parent === "none") return [`${prop}:100%`]
    return main ? ["flex:1 1 0", `min-${prop}:0`] : ["align-self:stretch"]
  }
  if (typeof v === "number") {
    // Fixed sizes keep their design value. A fixed width along a row may give way when the
    // viewport is narrower than the frame (never at the design widths); heights never do.
    if (!main) return [`${prop}:${px(v)}`]
    return prop === "width"
      ? [`${prop}:${px(v)}`, "flex-shrink:1", "min-width:0"]
      : [`${prop}:${px(v)}`, "flex-shrink:0"]
  }
  return main ? ["flex-shrink:0"] : []
}

function attrString(a: Record<string, string | undefined> | undefined): string {
  if (!a) return ""
  return Object.entries(a)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(v as string)}"`)
    .join("")
}

function renderChildren(children: Child[], dir: Dir): string {
  const out: string[] = []
  const walk = (c: Child) => {
    if (c === null || c === undefined || c === false) return
    if (Array.isArray(c)) return c.forEach(walk)
    if (typeof c === "string") return out.push(esc(c))
    out.push(c.lazy ? c.lazy(dir) : c.value)
  }
  children.forEach(walk)
  return out.join("")
}

/** Nodes render lazily: their fill/fixed sizing depends on the parent's direction. */
function defer(fn: (parent: Dir) => string): Raw {
  return new Raw("", fn)
}

/** Renders a node against an explicit parent direction (a root has a column parent). */
export function root(n: Raw, parent: Dir = "column"): Raw {
  return raw(n.lazy ? n.lazy(parent) : n.value)
}

export function frame(b: Box, ...children: Child[]): Raw {
  return defer((parent) => {
    const dir: Dir = b.layout ?? "row"
    const css: string[] = []
    if (dir === "none") css.push("position:relative")
    else css.push("display:flex", `flex-direction:${dir}`)
    if (b.gap) css.push(`gap:${px(b.gap)}`)
    if (b.p !== undefined) css.push(`padding:${padCss(b.p)}`)
    if (b.jc && b.jc !== "start") css.push(`justify-content:${JC[b.jc]}`)
    if (dir !== "none") css.push(`align-items:${b.ai ? AI[b.ai] : "flex-start"}`)
    css.push(...sizeCss("width", b.w, parent), ...sizeCss("height", b.h, parent))
    if (b.bg) css.push(`background:${paint(b.bg)}`)
    if (b.bgImage) css.push(`background:${b.bgImage}`)
    if (b.r !== undefined)
      css.push(`border-radius:${typeof b.r === "number" ? px(b.r) : `var(--kimo-${b.r})`}`)
    const shadows: string[] = []
    if (b.st) {
      const c = paint(b.st)
      const sw = b.sw ?? 1
      if (typeof sw === "number")
        css.push(`outline:${px(sw)} solid ${c}`, `outline-offset:${px(-sw / 2)}`)
      else {
        if (sw.top) shadows.push(`inset 0 ${px(sw.top)} 0 0 ${c}`)
        if (sw.bottom) shadows.push(`inset 0 ${px(-sw.bottom)} 0 0 ${c}`)
        if (sw.left) shadows.push(`inset ${px(sw.left)} 0 0 0 ${c}`)
        if (sw.right) shadows.push(`inset ${px(-sw.right)} 0 0 0 ${c}`)
      }
    }
    if (b.shadow)
      shadows.unshift(
        `${px(b.shadow.x)} ${px(b.shadow.y)} ${px(b.shadow.blur)} 0 ${paint(b.shadow.color)}`,
      )
    if (shadows.length) css.push(`box-shadow:${shadows.join(",")}`)
    if (b.clip) css.push("overflow:hidden")
    if (b.css) css.push(b.css)
    const tag = b.tag ?? "div"
    const attrs = {
      ...(b.cls ? { class: b.cls } : {}),
      ...(b.node ? { "data-node": b.node } : {}),
      ...(b.theme ? { "data-theme": b.theme } : {}),
      ...b.attrs,
      style: css.join(";"),
    }
    return `<${tag}${attrString(attrs)}>${renderChildren(children, dir)}</${tag}>`
  })
}

/**
 * Pencil lays text out on whole-pixel lines: a multiplier gives round(size × multiplier), and
 * "normal" is the font's own ascent + descent rounded the same way (Inter 1.2109375 · JetBrains
 * Mono 1.32), where a browser would leave it fractional.
 */
export function lineHeight(fs: number, lh: number | undefined, font: "sans" | "mono"): number {
  return Math.round(fs * (lh ?? (font === "mono" ? 1.32 : 1.2109375)))
}

export function text(t: Text, content: Child): Raw {
  return defer((parent) => {
    const css: string[] = [
      `font-family:var(--kimo-font-${t.font ?? "sans"})`,
      `font-size:${px(t.fs)}`,
      `font-weight:${t.fw ?? 400}`,
      `line-height:${lineHeight(t.fs, t.lh, t.font ?? "sans")}px`,
      `color:${paint(t.color)}`,
    ]
    if (t.ls) css.push(`letter-spacing:${px(t.ls)}`)
    if (t.ta && t.ta !== "left") css.push(`text-align:${t.ta}`)
    if (t.w === undefined) css.push("white-space:pre", ...sizeCss("width", undefined, parent))
    else css.push("white-space:pre-line", ...sizeCss("width", t.w, parent))
    if (t.css) css.push(t.css)
    const tag = t.tag ?? "div"
    const attrs = {
      ...(t.cls ? { class: t.cls } : {}),
      ...(t.node ? { "data-node": t.node } : {}),
      ...t.attrs,
      style: css.join(";"),
    }
    return `<${tag}${attrString(attrs)}>${renderChildren([content], "row")}</${tag}>`
  })
}

/** A fixed-size leaf (spacer, divider, ellipse). */
export function leaf(b: Box): Raw {
  return frame({ ...b, layout: b.layout ?? "row" })
}

/** An icon node (exact design icon name), sized and colored as the node. */
export function iconNode(
  name: string,
  size: number,
  color: Paint,
  svg: (name: string, size: number) => Raw,
  node?: string,
): Raw {
  return defer(
    () =>
      `<span class="ic"${node ? ` data-node="${esc(node)}"` : ""} style="display:flex;flex-shrink:0;width:${px(size)};height:${px(size)};color:${paint(color)}">${svg(name, size).value}</span>`,
  )
}
