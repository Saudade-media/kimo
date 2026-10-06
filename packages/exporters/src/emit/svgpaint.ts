/**
 * SVG painting of IR shapes: fills (solid, linear/radial gradients, image patterns), strokes
 * (inside/outside via clip/mask, dashes, caps, joins) and icon glyphs. Used for the vector
 * shapes inlined in HTML/React and by the standalone SVG emitter.
 */
import { fmt, rgbaCss } from "../ir/color"
import type {
  ExportIssueCode,
  IRColor,
  IRIcon,
  IRNum,
  IRPaint,
  IRSides,
  IRStroke,
} from "../ir/types"
import { type El, el } from "./el"

/** A normalized icon glyph (structurally `@kimo/renderer` `IconGlyph`). */
export interface IconGlyphLike {
  viewBox: readonly [number, number, number, number]
  paths: readonly {
    d: string
    paint: "fill" | "stroke"
    fillRule?: "nonzero" | "evenodd"
    opacity?: number
  }[]
  strokeWidth?: number
}

/** Glyph lookup for emitters (a loaded `@kimo/renderer` `IconProvider` satisfies it). */
export interface IconLookup {
  get(set: string, name: string, weight?: number): IconGlyphLike | null
}

const n = (v: number) => fmt(v, 3)

export interface SvgPaintOptions {
  /** Prefix of generated `id`s (unique per document). */
  idPrefix: string
  /**
   * Color of a single solid fill written as `currentColor` (the host element sets CSS
   * `color`, so CSS variables keep working); null = literal sRGB everywhere.
   */
  currentColor?: IRColor | null
  onIssue?: (code: ExportIssueCode, message: string) => void
}

/** Collects `<defs>` and writes paint attributes. One instance per SVG document/element. */
export class SvgPainter {
  readonly defs: El[] = []
  private counter = 0
  constructor(private readonly o: SvgPaintOptions) {}

  private id(kind: string): string {
    return `${this.o.idPrefix}-${kind}${++this.counter}`
  }

  /** Literal color attributes (`fill`/`fill-opacity`). */
  colorAttrs(c: IRColor, prop: "fill" | "stroke"): [string, string][] {
    if (this.o.currentColor && c === this.o.currentColor) return [[prop, "currentColor"]]
    const [r, g, b, a] = c.rgba
    const out: [string, string][] = [[prop, rgbaCss([r, g, b, 1])]]
    if (a < 1) out.push([`${prop}-opacity`, fmt(a, 3)])
    return out
  }

  /** Paint server or color for one paint in a `w`×`h` box. */
  paint(p: IRPaint, prop: "fill" | "stroke", w: number, h: number): [string, string][] | null {
    switch (p.kind) {
      case "solid":
        return this.colorAttrs(p.color, prop)
      case "linear": {
        const [cx, cy] = p.center
        const r = (p.rotation * Math.PI) / 180
        const dx = -Math.sin(r) * (p.size[1] / 2)
        const dy = -Math.cos(r) * (p.size[1] / 2)
        const id = this.id("lg")
        // The canvas gradient lives in the normalized node box scaled to w×h (not the
        // geometry's bounding box): user space with a box transform.
        this.defs.push(
          el(
            "linearGradient",
            [
              ["id", id],
              ["gradientUnits", "userSpaceOnUse"],
              ["gradientTransform", `scale(${n(w)} ${n(h)})`],
              ["x1", n(cx - dx)],
              ["y1", n(cy - dy)],
              ["x2", n(cx + dx)],
              ["y2", n(cy + dy)],
            ],
            this.stops(p.stops),
          ),
        )
        if (p.interpolation === "oklab")
          this.o.onIssue?.("GRADIENT_APPROXIMATED", "SVG gradients interpolate in sRGB")
        return [[prop, `url(#${id})`]]
      }
      case "radial": {
        const id = this.id("rg")
        const [cx, cy] = p.center
        const [sx, sy] = p.size
        this.defs.push(
          el(
            "radialGradient",
            [
              ["id", id],
              ["gradientUnits", "userSpaceOnUse"],
              ["cx", "0"],
              ["cy", "0"],
              ["r", "1"],
              [
                "gradientTransform",
                `scale(${n(w)} ${n(h)}) translate(${n(cx)} ${n(cy)}) rotate(${n(-p.rotation)}) scale(${n(sx / 2)} ${n(sy / 2)})`,
              ],
            ],
            this.stops(p.stops),
          ),
        )
        return [[prop, `url(#${id})`]]
      }
      case "angular": {
        this.o.onIssue?.(
          "GRADIENT_APPROXIMATED",
          "SVG has no conic gradient; the angular gradient's mean color is used",
        )
        const m = mean(p.stops.map((s) => s.color.rgba))
        return this.colorAttrs({ css: "", rgba: m }, prop)
      }
      case "image": {
        const id = this.id("img")
        const fit = p.fit
        const par =
          fit === "stretch" ? "none" : fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"
        const image = el("image", [
          ["href", p.src],
          ["width", n(w)],
          ["height", n(h)],
          ["preserveAspectRatio", par],
        ])
        if (p.opacity < 1) image.attrs.push(["opacity", fmt(p.opacity, 3)])
        if (fit === "tile" || p.crop)
          this.o.onIssue?.("PAINT_UNSUPPORTED", "image tile/crop is exported as cover")
        this.defs.push(
          el(
            "pattern",
            [
              ["id", id],
              ["patternUnits", "userSpaceOnUse"],
              ["width", n(w)],
              ["height", n(h)],
            ],
            [image],
          ),
        )
        return [[prop, `url(#${id})`]]
      }
      // Mesh and shader issues are reported per node by `paintIssues` (export.ts).
      case "mesh":
        return this.colorAttrs({ css: "", rgba: mean(p.colors.map((c) => c.rgba)) }, prop)
      case "shader":
        return null
    }
  }

  private stops(stops: { at: number; color: IRColor }[]): El[] {
    return stops.map((s) => {
      const [r, g, b, a] = s.color.rgba
      const attrs: [string, string][] = [
        ["offset", n(s.at)],
        ["stop-color", rgbaCss([r, g, b, 1])],
      ]
      if (a < 1) attrs.push(["stop-opacity", fmt(a, 3)])
      return el("stop", attrs)
    })
  }

  /** One `<path>` per visible fill paint, bottom to top. */
  fills(
    paints: IRPaint[],
    d: string,
    fillRule: string,
    w: number,
    h: number,
    transform: string | null,
  ): El[] {
    const out: El[] = []
    for (const p of paints) {
      const attrs = this.paint(p, "fill", w, h)
      if (!attrs) continue
      const a: [string, string][] = [["d", d]]
      if (fillRule === "evenodd") a.push(["fill-rule", "evenodd"])
      if (transform) a.push(["transform", transform])
      a.push(...attrs)
      if (p.blend !== "normal") a.push(["style", `mix-blend-mode:${p.blend}`])
      out.push(el("path", a))
    }
    return out
  }

  /**
   * The stroke of a closed (or open) shape. SVG strokes are centered: inside/outside strokes
   * are drawn twice as wide and clipped to (or masked out of) the shape, as the renderer does.
   */
  stroke(
    s: IRStroke,
    d: string,
    fillRule: string,
    w: number,
    h: number,
    transform: string | null,
    open = false,
  ): El[] {
    if ("t" in s.width) return this.sideStroke(s, w, h)
    const width = (s.width as IRNum).v
    if (width <= 0) return []
    const out: El[] = []
    const align = open ? "center" : s.align
    for (const p of s.paints) {
      const paint = this.paint(p, "stroke", w, h)
      if (!paint) continue
      const a: [string, string][] = [
        ["d", d],
        ["fill", "none"],
        ["stroke-width", n(align === "center" ? width : width * 2)],
        ...paint,
      ]
      if (transform) a.push(["transform", transform])
      if (s.cap !== "butt") a.push(["stroke-linecap", s.cap])
      if (s.join !== "miter") a.push(["stroke-linejoin", s.join])
      if (s.miterLimit !== 4) a.push(["stroke-miterlimit", n(s.miterLimit)])
      if (s.dash) a.push(["stroke-dasharray", s.dash.map(n).join(" ")])
      if (transform) a.push(["vector-effect", "non-scaling-stroke"])
      if (align === "inside") {
        const id = this.id("clip")
        const cp: [string, string][] = [["d", d]]
        if (fillRule === "evenodd") cp.push(["clip-rule", "evenodd"])
        if (transform) cp.push(["transform", transform])
        this.defs.push(el("clipPath", [["id", id]], [el("path", cp)]))
        a.push(["clip-path", `url(#${id})`])
      } else if (align === "outside") {
        const id = this.id("mask")
        const big = Math.max(w, h) + width * 4
        const mp: [string, string][] = [
          ["d", d],
          ["fill", "#000"],
        ]
        if (fillRule === "evenodd") mp.push(["fill-rule", "evenodd"])
        if (transform) mp.push(["transform", transform])
        this.defs.push(
          el(
            "mask",
            [
              ["id", id],
              ["maskUnits", "userSpaceOnUse"],
              ["x", n(-big)],
              ["y", n(-big)],
              ["width", n(w + big * 2)],
              ["height", n(h + big * 2)],
            ],
            [
              el("rect", [
                ["x", n(-big)],
                ["y", n(-big)],
                ["width", n(w + big * 2)],
                ["height", n(h + big * 2)],
                ["fill", "#fff"],
              ]),
              el("path", mp),
            ],
          ),
        )
        a.push(["mask", `url(#${id})`])
      }
      out.push(el("path", a))
    }
    return out
  }

  /** Per-side widths (spec §7.2): each side its own segment with the stroke's align. */
  private sideStroke(s: IRStroke, w: number, h: number): El[] {
    const sides = s.width as IRSides<IRNum>
    const k = s.align === "inside" ? 0.5 : s.align === "center" ? 0 : -0.5
    const paint = s.paints.length
      ? this.paint(s.paints[s.paints.length - 1] as IRPaint, "stroke", w, h)
      : null
    if (!paint) return []
    const seg = (x1: number, y1: number, x2: number, y2: number, sw: number): El => {
      const a: [string, string][] = [
        ["d", `M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`],
        ["fill", "none"],
        ["stroke-width", n(sw)],
        ...paint,
      ]
      if (s.cap !== "butt") a.push(["stroke-linecap", s.cap])
      if (s.dash) a.push(["stroke-dasharray", s.dash.map(n).join(" ")])
      return el("path", a)
    }
    const out: El[] = []
    const { t, r, b, l } = { t: sides.t.v, r: sides.r.v, b: sides.b.v, l: sides.l.v }
    if (t > 0) out.push(seg(0, t * k, w, t * k, t))
    if (r > 0) out.push(seg(w - r * k, 0, w - r * k, h, r))
    if (b > 0) out.push(seg(0, h - b * k, w, h - b * k, b))
    if (l > 0) out.push(seg(l * k, 0, l * k, h, l))
    return out
  }

  /** An icon glyph scaled to `w`×`h` in the icon color (or `currentColor`). */
  icon(icon: IRIcon, glyph: IconGlyphLike | null, w: number, h: number): El[] {
    if (!glyph) {
      this.o.onIssue?.("ICON_MISSING", `icon ${icon.set}/${icon.name} is not loaded`)
      return []
    }
    const [vx, vy, vw, vh] = glyph.viewBox
    if (!(vw > 0 && vh > 0)) return []
    const sw = icon.strokeWidth ?? glyph.strokeWidth ?? 2
    const kids = glyph.paths.map((gp) => {
      const a: [string, string][] = [["d", gp.d]]
      if (gp.paint === "stroke") {
        a.push(["fill", "none"], ...this.colorAttrs(icon.color, "stroke"))
        a.push(["stroke-width", n(sw)], ["stroke-linecap", "round"], ["stroke-linejoin", "round"])
      } else {
        a.push(...this.colorAttrs(icon.color, "fill"))
        if (gp.fillRule === "evenodd") a.push(["fill-rule", "evenodd"])
      }
      if (gp.opacity !== undefined && gp.opacity < 1) a.push(["opacity", fmt(gp.opacity, 3)])
      return el("path", a)
    })
    return [
      el(
        "g",
        [
          [
            "transform",
            `matrix(${n(w / vw)} 0 0 ${n(h / vh)} ${n((-vx * w) / vw)} ${n((-vy * h) / vh)})`,
          ],
        ],
        kids,
      ),
    ]
  }

  /** `<defs>` element, or null when empty. */
  defsEl(): El | null {
    return this.defs.length ? el("defs", [], this.defs) : null
  }
}

function mean(
  cs: readonly (readonly [number, number, number, number])[],
): [number, number, number, number] {
  const s = [0, 0, 0, 0]
  for (const c of cs)
    for (let i = 0; i < 4; i++) s[i] = (s[i] as number) + (c[i] as number) / cs.length
  return s as [number, number, number, number]
}
