/**
 * Text through CanvasKit Paragraph. One builder serves measuring (layout's `TextMeasurer`)
 * and drawing, from the same `resolveText()` input (ADR 0009: measure and draw agree).
 */
import type { ResolvedTextStyle, TextMeasureInput, TextMeasurer, TextMetrics } from "@kimo/layout"
import type {
  CanvasKit,
  FontWeight as CkFontWeight,
  ParagraphStyle as CkParagraphStyle,
  TextStyle as CkTextStyle,
  Paint,
  Paragraph,
} from "canvaskit-wasm"
import { parseColor } from "./color"
import type { CkFontProvider } from "./fonts"

/** How the glyphs are painted: a color, or a CanvasKit paint (gradient/image shader). */
export type TextFill = { color: Float32Array } | { paint: Paint; key: string }

/** Upper/lower/title case transform (spec §8.2 `case`). */
export function applyCase(text: string, c: ResolvedTextStyle["case"]): string {
  switch (c) {
    case "upper":
      return text.toUpperCase()
    case "lower":
      return text.toLowerCase()
    case "title":
      return text.replace(
        /(^|[\s\-_/([{"'])(\p{L})/gu,
        (_, p: string, l: string) => p + l.toUpperCase(),
      )
    default:
      return text
  }
}

const NO_WRAP_WIDTH = 1e7

export class TextEngine {
  private readonly measureCache = new Map<string, TextMetrics>()
  private readonly drawCache = new Map<string, { key: string; para: Paragraph }>()
  private readonly black: Float32Array

  constructor(
    private readonly ck: CanvasKit,
    private readonly fonts: CkFontProvider,
  ) {
    this.black = ck.Color4f(0, 0, 0, 1)
  }

  private ckStyle(s: ResolvedTextStyle, color: Float32Array | null): CkTextStyle {
    const ck = this.ck
    const lh = s.lineHeight
    const heightMultiplier =
      lh === null ? undefined : "px" in lh ? lh.px / s.fontSize : lh.multiplier
    let decoration = 0
    if (s.decoration.includes("underline")) decoration |= ck.UnderlineDecoration
    if (s.decoration.includes("strike")) decoration |= ck.LineThroughDecoration
    const fontFamilies =
      s.fontFamily === this.fonts.fallbackFamily
        ? [s.fontFamily]
        : [s.fontFamily, this.fonts.fallbackFamily]
    const style: CkTextStyle = {
      fontFamilies,
      fontSize: s.fontSize,
      fontStyle: {
        weight: { value: Math.round(s.fontWeight) } as CkFontWeight,
        slant: s.italic ? ck.FontSlant.Italic : ck.FontSlant.Upright,
      },
      letterSpacing: s.letterSpacing,
      // Variable fonts (Fraunces, Inter 4) render at their default instance unless the axes
      // are set: match CSS (`font-weight`, `font-optical-sizing: auto` → opsz = size in px).
      // Static fonts ignore unknown axes.
      fontVariations: [
        { axis: "wght", value: Math.round(s.fontWeight) },
        { axis: "opsz", value: s.fontSize },
      ],
      color: color ?? this.black,
      decoration,
      decorationColor: color ?? this.black,
      fontFeatures: Object.entries(s.features).map(([name, v]) => ({
        name,
        value: typeof v === "boolean" ? (v ? 1 : 0) : v,
      })),
    }
    if (heightMultiplier !== undefined && heightMultiplier > 0) {
      style.heightMultiplier = heightMultiplier
      style.halfLeading = true
    }
    return style
  }

  private ensureFonts(input: TextMeasureInput): void {
    for (const r of input.runs) {
      const { fontFamily, fontWeight, italic } = r.style
      const st = italic ? "italic" : "normal"
      if (!this.fonts.has(fontFamily, fontWeight, st) && !this.fonts.isMissing(fontFamily))
        void this.fonts.ensureFont(fontFamily, fontWeight, st)
    }
  }

  /** Builds a laid-out paragraph. Caller owns (and must delete) it. */
  build(input: TextMeasureInput, fill: TextFill | null, width: number | undefined): Paragraph {
    const ck = this.ck
    this.ensureFonts(input)
    const align = input.style.align
    const pstyle: CkParagraphStyle = {
      textAlign:
        align === "center"
          ? ck.TextAlign.Center
          : align === "right"
            ? ck.TextAlign.Right
            : align === "justify"
              ? ck.TextAlign.Justify
              : ck.TextAlign.Left,
      textStyle: this.ckStyle(input.style, null),
      applyRoundingHack: false,
      replaceTabCharacters: true,
    }
    const builder = ck.ParagraphBuilder.MakeFromFontProvider(
      new ck.ParagraphStyle(pstyle),
      this.fonts.provider,
    )
    const color = fill && "color" in fill ? fill.color : null
    for (const run of input.runs) {
      // A span's own fill (feature "text/runs") paints that run instead of the node's fill.
      const own = run.fill === undefined || !fill ? null : parseColor(run.fill)
      const ts = new ck.TextStyle(this.ckStyle(run.style, own ? ck.Color4f(...own) : color))
      if (!own && fill && "paint" in fill)
        builder.pushPaintStyle(ts, fill.paint, this.noBackground())
      else builder.pushStyle(ts)
      builder.addText(applyCase(run.text, run.style.case))
      builder.pop()
    }
    const para = builder.build()
    builder.delete()
    para.layout(width ?? NO_WRAP_WIDTH)
    return para
  }

  private metricsOf(para: Paragraph, wrapped: boolean): TextMetrics {
    return {
      w: wrapped ? para.getLongestLine() : para.getMaxIntrinsicWidth(),
      h: para.getHeight(),
      lines: para.getLineMetrics().length,
      baseline: para.getAlphabeticBaseline(),
    }
  }

  measure(input: TextMeasureInput, maxWidth: number | undefined): TextMetrics {
    const key = `${this.fonts.generation}|${maxWidth ?? "-"}|${JSON.stringify(input.runs)}|${input.style.align}`
    const hit = this.measureCache.get(key)
    if (hit) return hit
    const para = this.build(input, null, maxWidth)
    const m = this.metricsOf(para, maxWidth !== undefined)
    para.delete()
    if (this.measureCache.size > 20_000) this.measureCache.clear()
    this.measureCache.set(key, m)
    return m
  }

  /**
   * Cached drawable paragraph for a node, laid out at `width` (undefined = no wrapping, then
   * re-laid-out at its intrinsic width so alignment has a finite box).
   */
  paragraph(input: TextMeasureInput, fill: TextFill | null, width: number | undefined): Paragraph {
    const fillKey = !fill ? "-" : "color" in fill ? Array.from(fill.color).join(",") : fill.key
    const key = `${this.fonts.generation}|${width ?? "-"}|${fillKey}|${JSON.stringify(input.runs)}|${input.style.align}`
    const cached = this.drawCache.get(input.nodeId)
    if (cached?.key === key) return cached.para
    cached?.para.delete()
    const para = this.build(input, fill, width)
    this.drawCache.set(input.nodeId, { key, para })
    return para
  }

  /** Drops cached paragraphs (all, or for the given node ids). */
  invalidate(nodeIds?: Iterable<string>): void {
    if (!nodeIds) {
      for (const c of this.drawCache.values()) c.para.delete()
      this.drawCache.clear()
      this.measureCache.clear()
      return
    }
    for (const id of nodeIds) {
      const c = this.drawCache.get(id)
      if (c) {
        c.para.delete()
        this.drawCache.delete(id)
      }
    }
  }

  private bg: Paint | null = null
  private noBackground(): Paint {
    if (!this.bg) {
      this.bg = new this.ck.Paint()
      this.bg.setColor(this.ck.TRANSPARENT)
    }
    return this.bg
  }

  measurer(): TextMeasurer {
    const fonts = this.fonts
    return {
      measure: (input, maxWidth) => this.measure(input, maxWidth),
      // Layout re-measures every text node on a full pass only when a font arrived.
      get generation() {
        return fonts.generation
      },
    }
  }

  dispose(): void {
    this.invalidate()
    this.bg?.delete()
    this.bg = null
  }
}
