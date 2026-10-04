/**
 * IR node → CSS declarations (ADR 0015 "CSS model"). Shared by the HTML/CSS emitter (a class
 * per node) and the React+Tailwind emitter (declarations → utilities), so both lay out alike.
 *
 * The model restates the canvas (Yoga) layout: `box-sizing: border-box` everywhere; frames
 * with layout are flex containers; non-fill flow items never shrink; fill items grow with
 * `min-width/height: 0` (Yoga has no automatic minimum); out-of-flow children are absolutely
 * positioned (or stacked in one grid cell when the parent's size fits its content); strokes
 * never take space (outline, or an overlay for per-side widths); transforms rotate about the
 * top-left corner.
 */
import { withAlphaCss } from "../ir/build"
import { fmt } from "../ir/color"
import { cssVarName } from "../ir/names"
import type {
  ExportIssueCode,
  IRColor,
  IRGradientPaint,
  IRNode,
  IRNum,
  IRPaint,
  IRShadow,
  IRSize,
  IRTextStyle,
} from "../ir/types"

/** A tokenized value: Tailwind can write `bg-surface` instead of an arbitrary value. */
export interface DeclToken {
  /** Tailwind theme namespace: `color`, `spacing`, `radius`, `text`, `font`, … */
  ns: string
  /** Consumer-qualified variable name. */
  ref: string
}

export interface Decl {
  prop: string
  value: string
  token?: DeclToken
}

export interface CssOptions {
  /** Write bound values as `var(--x)` (default true); false = resolved literals. */
  variables?: boolean
  /** Approximations the CSS model makes (see ExportIssueCode). */
  onIssue?: (code: ExportIssueCode, message: string, nodeId?: string) => void
}

export interface NodeCss {
  /** Context-dependent declarations (where the node sits in its parent; flex item sizing). */
  placement: Decl[]
  /** Intrinsic declarations (size, container, paint, text). */
  own: Decl[]
  /** `::after` overlay (per-side strokes), or null. */
  after: Decl[] | null
}

const JUSTIFY: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
}
const ALIGN: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  baseline: "baseline",
}

/** Spec blend → CSS `mix-blend-mode`. */
export function cssBlend(b: string): string {
  if (b === "linear-burn") return "plus-darker"
  if (b === "linear-dodge") return "plus-lighter"
  return b
}

export class CssWriter {
  readonly vars: boolean
  readonly onIssue: CssOptions["onIssue"]
  constructor(options: CssOptions = {}) {
    this.vars = options.variables !== false
    this.onIssue = options.onIssue
  }

  /** Length in px of a value; bound values: `calc(var(--x) * 1px)` (number variables are unitless). */
  px(n: IRNum, extra = 0): string {
    if (this.vars && n.ref) {
      const v = `var(${cssVarName(n.ref)})`
      return extra === 0 ? `calc(${v} * 1px)` : `calc(${v} * 1px + ${fmt(extra)}px)`
    }
    return `${fmt(n.v + extra)}px`
  }

  plain(n: IRNum): string {
    return this.vars && n.ref ? `var(${cssVarName(n.ref)})` : fmt(n.v)
  }

  color(c: IRColor): string {
    if (!(this.vars && c.ref)) return c.css
    const v = `var(${cssVarName(c.ref)})`
    return c.alpha !== undefined && c.alpha < 1 ? withAlphaCss(v, c.alpha) : v
  }

  private tok(ns: string, ref: string | undefined): DeclToken | undefined {
    return this.vars && ref ? { ns, ref } : undefined
  }

  private d(prop: string, value: string, token?: DeclToken): Decl {
    return token ? { prop, value, token } : { prop, value }
  }

  // --- Node ---------------------------------------------------------------------------------

  node(n: IRNode): NodeCss {
    const placement: Decl[] = []
    const own: Decl[] = []
    const p = n.placement
    const d = this.d.bind(this)

    // Placement.
    switch (p.mode) {
      case "root":
        placement.push(d("position", "relative"))
        break
      case "flow":
        placement.push(d("position", "relative"))
        if (p.lead !== 0)
          placement.push(d(p.dir === "row" ? "margin-left" : "margin-top", `${fmt(p.lead)}px`))
        break
      case "absolute":
        placement.push(d("position", "absolute"))
        placement.push(d("left", `${fmt(p.x)}px`))
        placement.push(d("top", `${fmt(p.y)}px`))
        break
      case "stack":
        placement.push(d("position", "relative"))
        placement.push(d("grid-area", "1 / 1"))
        placement.push(d("justify-self", "start"))
        placement.push(d("align-self", "start"))
        if (p.x !== 0) placement.push(d("margin-left", `${fmt(p.x)}px`))
        if (p.y !== 0) placement.push(d("margin-top", `${fmt(p.y)}px`))
        if (p.reach?.[0]) placement.push(d("margin-right", `${fmt(p.reach[0])}px`))
        if (p.reach?.[1]) placement.push(d("margin-bottom", `${fmt(p.reach[1])}px`))
        break
    }

    // Sizing (flex item properties are placement: they depend on the parent's direction).
    const flow = p.mode === "flow"
    const fillMain = (s: IRSize) => s.kind === "fill" && s.axis === "main"
    const mainSize = flow ? (p.dir === "row" ? n.w : n.h) : null
    if (flow) {
      if (mainSize && fillMain(mainSize)) {
        const s = mainSize as Extract<IRSize, { kind: "fill" }>
        placement.push(d("flex-grow", fmt(s.weight)))
        placement.push(d("flex-shrink", "1"))
        placement.push(d("flex-basis", "auto"))
        if (s.min === undefined)
          placement.push(d(p.dir === "row" ? "min-width" : "min-height", "0"))
      } else placement.push(d("flex-shrink", "0"))
      const cross = p.dir === "row" ? n.h : n.w
      if (cross.kind === "fill") placement.push(d("align-self", "stretch"))
    }
    const outOfFlow = p.mode !== "flow"
    for (const axis of ["w", "h"] as const) {
      const s = n[axis]
      const prop = axis === "w" ? "width" : "height"
      if (s.kind === "fixed") own.push(d(prop, this.px(s.px), this.tok("spacing", s.px.ref)))
      else if (s.kind === "fit") {
        // Absolutely positioned / stacked / root boxes are laid out unconstrained on the canvas.
        if (axis === "w" && (outOfFlow || n.text?.grow === "auto")) own.push(d(prop, "max-content"))
      }
      if (s.kind !== "fixed") {
        if (s.min !== undefined) own.push(d(`min-${prop}`, `${fmt(s.min)}px`))
        if (s.max !== undefined) own.push(d(`max-${prop}`, `${fmt(s.max)}px`))
      }
    }

    // Container.
    if (n.flex) {
      const f = n.flex
      own.push(d("display", "flex"))
      own.push(d("flex-direction", f.dir))
      if (f.wrap) {
        own.push(d("flex-wrap", "wrap"))
        own.push(d("align-content", "flex-start"))
      }
      if (f.justify !== "start") own.push(d("justify-content", JUSTIFY[f.justify] as string))
      own.push(d("align-items", ALIGN[f.align] as string))
      const main = f.gap
      const cross = f.crossGap
      const rowGap = f.dir === "row" ? cross : main
      const colGap = f.dir === "row" ? main : cross
      if (rowGap.v !== 0 || rowGap.ref)
        own.push(d("row-gap", this.px(rowGap), this.tok("spacing", rowGap.ref)))
      if (colGap.v !== 0 || colGap.ref)
        own.push(d("column-gap", this.px(colGap), this.tok("spacing", colGap.ref)))
      const pads = f.pad.map((x, i) => ({ x, e: f.padExtra[i] as number }))
      const names = ["padding-top", "padding-right", "padding-bottom", "padding-left"]
      pads.forEach(({ x, e }, i) => {
        if (x.v === 0 && e === 0 && !x.ref) return
        own.push(
          d(names[i] as string, this.px(x, e), e === 0 ? this.tok("spacing", x.ref) : undefined),
        )
      })
    } else if (n.childMode === "stack") {
      own.push(d("display", "grid"))
    }

    if (!n.visible) own.push(d("display", "none"))

    // Transform: rotation counter-clockwise about the top-left corner; flips about the center.
    if (n.transform) {
      const t = n.transform
      const parts: string[] = []
      if (t.rotation !== 0) parts.push(`rotate(${fmt(-t.rotation)}deg)`)
      if (t.flipX || t.flipY) {
        const w = n.w.kind === "fixed" ? n.w.px.v : null
        const h = n.h.kind === "fixed" ? n.h.px.v : null
        // translate(w, 0) scaleX(-1) == flip about the vertical center line.
        const tx = t.flipX ? (w !== null ? `${fmt(w)}px` : "100%") : "0"
        const ty = t.flipY ? (h !== null ? `${fmt(h)}px` : "100%") : "0"
        parts.push(`translate(${tx}, ${ty})`, `scale(${t.flipX ? -1 : 1}, ${t.flipY ? -1 : 1})`)
      }
      own.push(d("transform-origin", "0 0"))
      own.push(d("transform", parts.join(" ")))
    }

    // Paint.
    const v = n.visual
    const svgShape = n.tag === "svg"
    const bw = n.w.kind === "fixed" ? n.w.px.v : undefined
    const bh = n.h.kind === "fixed" ? n.h.px.v : undefined
    if (!svgShape) this.background(v.fills, own, bw, bh, n.id)
    if (v.radius && !svgShape) {
      const r = v.radius
      const same = r.every((x) => x.v === r[0].v && x.ref === r[0].ref)
      if (same) own.push(d("border-radius", this.px(r[0]), this.tok("radius", r[0].ref)))
      else own.push(d("border-radius", r.map((x) => this.px(x)).join(" ")))
    } else if (n.shape?.kind === "ellipse" && !svgShape) own.push(d("border-radius", "50%"))
    // Inline SVG paints its single solid color as `currentColor` (markup.ts svgCurrentColor).
    if (svgShape) {
      const c = n.icon
        ? n.icon.color
        : v.fills.length === 1 && v.fills[0]?.kind === "solid" && v.fills[0].blend === "normal"
          ? v.fills[0].color
          : null
      if (c) own.push(this.d("color", this.color(c), this.tok("color", c.ref)))
    }
    let after: Decl[] | null = null
    if (v.stroke && !svgShape) after = this.stroke(n, own)
    if (v.opacity) own.push(d("opacity", this.plain(v.opacity), this.tok("opacity", v.opacity.ref)))
    if (v.blend) own.push(d("mix-blend-mode", cssBlend(v.blend)))
    if (v.isolate) own.push(d("isolation", "isolate"))
    if (v.clip) own.push(d("overflow", "hidden"))
    this.effects(n, own)

    // Text.
    if (n.text) this.text(n, own)
    return { placement, own, after }
  }

  // --- Paints -------------------------------------------------------------------------------

  /** CSS image of a paint (`linear-gradient(…)`, `url(…)`), plus size/position/repeat. */
  paintImage(
    p: IRPaint,
    w?: number,
    h?: number,
  ): { image: string; size: string; repeat: string; position: string } {
    switch (p.kind) {
      case "solid": {
        const c = this.color(p.color)
        return {
          image: `linear-gradient(${c}, ${c})`,
          size: "auto",
          repeat: "repeat",
          position: "0% 0%",
        }
      }
      case "image": {
        const fit = p.fit
        return {
          image: `url("${p.src}")`,
          size:
            fit === "cover"
              ? "cover"
              : fit === "contain"
                ? "contain"
                : fit === "stretch"
                  ? "100% 100%"
                  : "auto",
          repeat: fit === "tile" ? "repeat" : "no-repeat",
          position: fit === "tile" ? "0% 0%" : "50% 50%",
        }
      }
      default:
        return { image: this.gradient(p, w, h), size: "auto", repeat: "repeat", position: "0% 0%" }
    }
  }

  /**
   * A gradient paint as a CSS gradient. Linear gradients are exact for any box: the canvas
   * gradient lives in the normalized box (renderer `paint.ts`), so its isolines are mapped to
   * px and the CSS angle is the normal of those isolines; stop positions are the projections
   * of the gradient's end points onto the CSS gradient line. Radial: exact without rotation.
   * Angular: exact for square boxes.
   */
  gradient(g: IRGradientPaint, w = 100, h = 100): string {
    const space = g.interpolation === "oklab" ? "in oklab, " : ""
    const stops = (pos: (at: number) => string) =>
      g.stops.map((s) => `${this.color(s.color)} ${pos(s.at)}`).join(", ")
    const [cx, cy] = g.center
    const [sx, sy] = g.size
    if (g.kind === "linear") {
      const r = (g.rotation * Math.PI) / 180
      const dx = -Math.sin(r) * (sy / 2)
      const dy = -Math.cos(r) * (sy / 2)
      // End points in px.
      const p0 = [(cx - dx) * w, (cy - dy) * h]
      const p1 = [(cx + dx) * w, (cy + dy) * h]
      // Gradient direction perpendicular to the scaled isolines.
      let ux = dx * h
      let uy = dy * w
      const len = Math.hypot(ux, uy) || 1
      ux /= len
      uy /= len
      const angle = (Math.atan2(ux, -uy) * 180) / Math.PI
      const L = Math.abs(w * ux) + Math.abs(h * uy)
      const sxp = w / 2 - (L / 2) * ux
      const syp = h / 2 - (L / 2) * uy
      const t = (p: number[]) =>
        (((p[0] as number) - sxp) * ux + ((p[1] as number) - syp) * uy) / (L || 1)
      const t0 = t(p0)
      const t1 = t(p1)
      return `linear-gradient(${space}${fmt(norm(angle), 3)}deg, ${stops((at) => `${fmt((t0 + at * (t1 - t0)) * 100, 3)}%`)})`
    }
    if (g.kind === "radial") {
      const rx = (sx / 2) * w
      const ry = (sy / 2) * h
      return `radial-gradient(${space}${fmt(rx, 3)}px ${fmt(ry, 3)}px at ${fmt(cx * w, 3)}px ${fmt(cy * h, 3)}px, ${stops((at) => `${fmt(at * 100, 3)}%`)})`
    }
    return `conic-gradient(${space}from ${fmt(norm(-g.rotation), 3)}deg at ${fmt(cx * 100, 3)}% ${fmt(cy * 100, 3)}%, ${stops((at) => `${fmt(at * 360, 3)}deg`)})`
  }

  private background(fills: IRPaint[], own: Decl[], w?: number, h?: number, id?: string) {
    if (fills.length === 0) return
    const only = fills[0]
    if (fills.length === 1 && only?.kind === "solid" && only.blend === "normal") {
      own.push(
        this.d("background-color", this.color(only.color), this.tok("color", only.color.ref)),
      )
      return
    }
    // CSS background layers paint first-on-top; the spec paints last-on-top.
    const layers = [...fills].reverse().map((p) => this.paintImage(p, w, h))
    if (
      fills.some((p) => p.kind !== "solid" && p.kind !== "image") &&
      (w === undefined || h === undefined)
    )
      this.onIssue?.(
        "GRADIENT_APPROXIMATED",
        "gradient on a content-sized box is mapped as if square",
        id,
      )
    own.push(this.d("background-image", layers.map((l) => l.image).join(", ")))
    if (layers.some((l) => l.size !== "auto"))
      own.push(this.d("background-size", layers.map((l) => l.size).join(", ")))
    if (layers.some((l) => l.repeat !== "repeat"))
      own.push(this.d("background-repeat", layers.map((l) => l.repeat).join(", ")))
    if (layers.some((l) => l.position !== "0% 0%"))
      own.push(this.d("background-position", layers.map((l) => l.position).join(", ")))
    const blends = [...fills].reverse().map((p) => cssBlend(p.blend))
    if (blends.some((b) => b !== "normal"))
      own.push(this.d("background-blend-mode", blends.join(", ")))
  }

  /** First solid color of a paint list (strokes and text use one color). */
  solid(paints: IRPaint[]): IRColor | null {
    for (let i = paints.length - 1; i >= 0; i--) {
      const p = paints[i] as IRPaint
      if (p.kind === "solid") return p.color
      if (p.kind !== "image") return (p.stops[p.stops.length - 1] as { color: IRColor }).color
    }
    return null
  }

  /**
   * Strokes never take space on the canvas. Uniform widths → `outline` (drawn above the
   * content and not clipped by the node's own `overflow`, like the canvas stroke); per-side
   * widths → an absolutely positioned `::after` overlay with borders.
   */
  private stroke(n: IRNode, own: Decl[]): Decl[] | null {
    const s = n.visual.stroke
    if (!s) return null
    const color = this.solid(s.paints)
    if (!color) return null
    const style = s.dash ? "dashed" : "solid"
    const c = this.color(color)
    if (!("t" in s.width)) {
      const w = s.width
      if (w.v === 0 && !w.ref) return null
      const offset = s.align === "inside" ? -w.v : s.align === "center" ? -w.v / 2 : 0
      own.push(this.d("outline", `${this.px(w)} ${style} ${c}`))
      own.push(this.d("outline-offset", `${fmt(offset)}px`))
      return null
    }
    const side = s.width
    const k = s.align === "inside" ? 0 : s.align === "center" ? 0.5 : 1
    const inset = [side.t, side.r, side.b, side.l].map((x) => `${fmt(-x.v * k)}px`).join(" ")
    const radius = n.visual.radius
    const after: Decl[] = [
      this.d("content", '""'),
      this.d("position", "absolute"),
      this.d("inset", inset),
      this.d("border-style", style),
      this.d("border-color", c),
      this.d("border-width", [side.t, side.r, side.b, side.l].map((x) => this.px(x)).join(" ")),
      this.d("pointer-events", "none"),
    ]
    if (radius) {
      const grow = Math.max(side.t.v, side.r.v, side.b.v, side.l.v) * k
      after.push(this.d("border-radius", radius.map((x) => `${fmt(x.v + grow)}px`).join(" ")))
    }
    return after
  }

  private shadow(s: IRShadow, filter: boolean): string {
    const c = this.color(s.color)
    if (filter) return `drop-shadow(${this.px(s.x)} ${this.px(s.y)} ${this.px(s.blur)} ${c})`
    const spread = s.spread.v !== 0 || s.spread.ref ? ` ${this.px(s.spread)}` : " 0px"
    return `${s.inner ? "inset " : ""}${this.px(s.x)} ${this.px(s.y)} ${this.px(s.blur)}${spread} ${c}`
  }

  private effects(n: IRNode, own: Decl[]) {
    const v = n.visual
    const filters: string[] = []
    // CSS draws the first shadow on top; effects apply in list order (last on top).
    const shadows = [...v.shadows].reverse()
    const glyphs = n.text !== null || n.tag === "svg"
    if (shadows.length > 0) {
      if (n.text) {
        const drop = shadows.filter((s) => !s.inner)
        if (drop.length)
          own.push(
            this.d(
              "text-shadow",
              drop
                .map(
                  (s) =>
                    `${this.px(s.x)} ${this.px(s.y)} ${this.px(s.blur)} ${this.color(s.color)}`,
                )
                .join(", "),
            ),
          )
      } else if (glyphs) {
        for (const s of shadows) if (!s.inner) filters.push(this.shadow(s, true))
      } else own.push(this.d("box-shadow", shadows.map((s) => this.shadow(s, false)).join(", ")))
    }
    // Spec §7.3: the blur radius r has standard deviation r / 2; CSS blur() takes the deviation.
    if (v.blur && (v.blur.v > 0 || v.blur.ref)) filters.push(`blur(${this.half(v.blur)})`)
    if (filters.length) own.push(this.d("filter", filters.join(" ")))
    if (v.backdropBlur && (v.backdropBlur.v > 0 || v.backdropBlur.ref))
      own.push(this.d("backdrop-filter", `blur(${this.half(v.backdropBlur)})`))
  }

  private half(n: IRNum): string {
    if (this.vars && n.ref) return `calc(var(${cssVarName(n.ref)}) * 0.5px)`
    return `${fmt(n.v / 2)}px`
  }

  // --- Text ---------------------------------------------------------------------------------

  /** Font/line declarations of a text style (paragraph or run). */
  textStyle(s: IRTextStyle, base: IRTextStyle | null): Decl[] {
    const out: Decl[] = []
    const d = this.d.bind(this)
    const diff = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b)
    if (!base || diff(s.family, base.family)) {
      const fam =
        this.vars && s.family.ref ? `var(${cssVarName(s.family.ref)})` : quoteFamily(s.family.v)
      out.push(d("font-family", `${fam}, sans-serif`, this.tok("font", s.family.ref)))
    }
    if (!base || diff(s.size, base.size))
      out.push(d("font-size", this.px(s.size), this.tok("text", s.size.ref)))
    if (!base || diff(s.weight, base.weight))
      out.push(d("font-weight", this.plain(s.weight), this.tok("font-weight", s.weight.ref)))
    if ((!base && s.italic) || (base && s.italic !== base.italic))
      out.push(d("font-style", s.italic ? "italic" : "normal"))
    if (!base || diff(s.lineHeight, base.lineHeight) || diff(s.size, base.size))
      out.push(d("line-height", this.lineHeight(s)))
    if (
      (!base && (s.letterSpacing.v !== 0 || s.letterSpacing.ref)) ||
      (base && diff(s.letterSpacing, base.letterSpacing))
    )
      out.push(
        d("letter-spacing", this.px(s.letterSpacing), this.tok("tracking", s.letterSpacing.ref)),
      )
    if ((!base && s.decoration.length) || (base && diff(s.decoration, base.decoration)))
      out.push(
        d(
          "text-decoration-line",
          s.decoration.length
            ? s.decoration.map((x) => (x === "strike" ? "line-through" : x)).join(" ")
            : "none",
        ),
      )
    if ((!base && s.case) || (base && s.case !== base.case))
      out.push(
        d(
          "text-transform",
          s.case === "upper"
            ? "uppercase"
            : s.case === "lower"
              ? "lowercase"
              : s.case === "title"
                ? "capitalize"
                : "none",
        ),
      )
    if ((!base && Object.keys(s.features).length) || (base && diff(s.features, base.features)))
      out.push(d("font-feature-settings", featureSettings(s.features)))
    return out
  }

  /** Explicit line height: px for multipliers (`calc` when bound), `normal` = the font's default. */
  lineHeight(s: IRTextStyle): string {
    const lh = s.lineHeight
    if (lh.kind === "normal") return "normal"
    if (lh.kind === "px") return `${fmt(lh.v)}px`
    if (this.vars && (lh.v.ref || s.size.ref))
      return `calc(${this.plain(lh.v)} * ${this.px(s.size)})`
    return `${fmt(lh.v.v * s.size.v)}px`
  }

  private text(n: IRNode, own: Decl[]) {
    const t = n.text
    if (!t) return
    const d = this.d.bind(this)
    own.push(...this.textStyle(t.style, null))
    if (t.style.align !== "left") own.push(d("text-align", t.style.align))
    // Wrap hints: auto text never wraps (explicit line breaks only); other modes wrap at words.
    if (t.grow === "auto") own.push(d("white-space", "pre"))
    else {
      own.push(d("white-space", "pre-wrap"))
      own.push(d("overflow-wrap", "break-word"))
    }
    if (t.grow === "fixed" && t.style.valign !== "top")
      own.push(d("align-content", t.style.valign === "middle" ? "center" : "end"))
    const c = this.solid(t.fills)
    const onlySolid = t.fills.length === 1 && t.fills[0]?.kind === "solid"
    if (c && onlySolid) own.push(d("color", this.color(c), this.tok("color", c.ref)))
    else if (t.fills.length > 0) {
      const layers = [...t.fills].reverse().map((p) => this.paintImage(p))
      own.push(d("background-image", layers.map((l) => l.image).join(", ")))
      own.push(d("-webkit-background-clip", "text"))
      own.push(d("background-clip", "text"))
      own.push(d("color", "transparent"))
    } else own.push(d("color", "transparent"))
  }
}

/** `"liga" 0, "ss01" 1` — booleans as 0/1, sorted by tag. */
export function featureSettings(f: Record<string, boolean | number>): string {
  const keys = Object.keys(f).sort()
  if (keys.length === 0) return "normal"
  return keys
    .map((k) => {
      const v = f[k]
      return `"${k}" ${v === true ? 1 : v === false ? 0 : fmt(v as number)}`
    })
    .join(", ")
}

export function quoteFamily(f: string): string {
  return `"${f.replace(/["\\]/g, "\\$&")}"`
}

function norm(deg: number): number {
  const r = ((deg % 360) + 360) % 360
  return Math.abs(r - 360) < 1e-9 ? 0 : r
}
