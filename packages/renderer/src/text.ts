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
  FontCollection,
  Paint,
  Paragraph,
} from "canvaskit-wasm"
import { parseColor } from "./color"
import type { CkFontProvider } from "./fonts"
import type { TextCharBox } from "./types"

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

/**
 * Drawable paragraphs kept (one per text node, least recently drawn first out). A paragraph is
 * only read while its root's picture is recorded; kept without a bound, a 300k-node document
 * filled the wasm heap and aborted the renderer.
 */
const DRAW_CACHE_MAX = 20_000

export class TextEngine {
  private readonly measureCache = new Map<string, TextMetrics>()
  private readonly drawCache = new Map<string, { key: string; para: Paragraph }>()
  /** Paragraphs queried for character positions (live text carets), per node. */
  private readonly geometryCache = new Map<string, { key: string; geometry: ParagraphGeometry }>()
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

  /** Node ids by family (lower case) that asked for a face of it that was not there. */
  private readonly waiting = new Map<string, Set<string>>()

  private ensureFonts(input: TextMeasureInput): void {
    for (const r of input.runs) {
      const { fontFamily, fontWeight, italic } = r.style
      const st = italic ? "italic" : "normal"
      if (this.fonts.has(fontFamily, fontWeight, st)) continue
      const fam = fontFamily.toLowerCase()
      let ids = this.waiting.get(fam)
      if (!ids) {
        ids = new Set()
        this.waiting.set(fam, ids)
      }
      ids.add(input.nodeId)
      if (!this.fonts.isMissing(fontFamily)) void this.fonts.ensureFont(fontFamily, fontWeight, st)
    }
  }

  /** The nodes that waited for a face of `family`, handed over once (see `Renderer`). */
  takeWaiting(family: string): string[] {
    const fam = family.toLowerCase()
    const ids = this.waiting.get(fam)
    if (!ids) return []
    this.waiting.delete(fam)
    return [...ids]
  }

  private collection: FontCollection | null = null
  private collectionGen = -1
  /**
   * One font collection for every paragraph, replaced when a font registers (its typeface
   * cache would not see the new face). A collection per paragraph, which is what
   * `MakeFromFontProvider` makes, clones the variable font for each text: 27 KB of wasm heap
   * kept by the recorded picture and 13 times the build time.
   */
  private fontCollection(): FontCollection {
    if (!this.collection || this.collectionGen !== this.fonts.generation) {
      this.collection?.delete()
      const fc = this.ck.FontCollection.Make()
      fc.setDefaultFontManager(this.fonts.provider)
      fc.enableFontFallback()
      this.collection = fc
      this.collectionGen = this.fonts.generation
    }
    return this.collection
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
    const builder = ck.ParagraphBuilder.MakeFromFontCollection(
      new ck.ParagraphStyle(pstyle),
      this.fontCollection(),
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
    if (hit) {
      // A cached measure skips `build`: this node still waits for the faces it lacks.
      this.ensureFonts(input)
      return hit
    }
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
    if (cached) this.drawCache.delete(input.nodeId)
    if (cached?.key === key) {
      // Back in as the most recently used.
      this.drawCache.set(input.nodeId, cached)
      return cached.para
    }
    cached?.para.delete()
    const para = this.build(input, fill, width)
    this.drawCache.set(input.nodeId, { key, para })
    if (this.drawCache.size > DRAW_CACHE_MAX) {
      // The least recently drawn goes: its picture is recorded and no longer reads it.
      const [oldest, entry] = this.drawCache.entries().next().value as [
        string,
        { key: string; para: Paragraph },
      ]
      entry.para.delete()
      this.drawCache.delete(oldest)
    }
    return para
  }

  /**
   * Character positions of a node's text laid out at `width` (as drawn), in paragraph
   * coordinates; cached per node until its text, width or fonts change.
   */
  geometry(input: TextMeasureInput, width: number | undefined): ParagraphGeometry {
    const key = `${this.fonts.generation}|${width ?? "-"}|${JSON.stringify(input.runs)}|${input.style.align}`
    const cached = this.geometryCache.get(input.nodeId)
    if (cached?.key === key) return cached.geometry
    cached?.geometry.dispose()
    const geometry = new ParagraphGeometry(input, this.build(input, null, width))
    this.geometryCache.set(input.nodeId, { key, geometry })
    return geometry
  }

  /** Drops cached paragraphs (all, or for the given node ids). */
  invalidate(nodeIds?: Iterable<string>): void {
    if (!nodeIds) {
      for (const c of this.drawCache.values()) c.para.delete()
      this.drawCache.clear()
      this.measureCache.clear()
      for (const c of this.geometryCache.values()) c.geometry.dispose()
      this.geometryCache.clear()
      return
    }
    for (const id of nodeIds) {
      const c = this.drawCache.get(id)
      if (c) {
        c.para.delete()
        this.drawCache.delete(id)
      }
      const g = this.geometryCache.get(id)
      if (g) {
        g.geometry.dispose()
        this.geometryCache.delete(id)
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
    this.collection?.delete()
    this.collection = null
    this.bg?.delete()
    this.bg = null
  }
}

/**
 * A laid-out paragraph queried by UTF-16 offset (live text carets): each character's advance
 * and the box of its line (paragraph coordinates), read once per character and kept.
 */
export class ParagraphGeometry {
  readonly text: string
  /** Paragraph height (vertical alignment inside a taller box). */
  readonly height: number
  private readonly lines: { top: number; height: number; left: number }[]
  private readonly sizes: { end: number; size: number }[] = []
  private readonly chars: (TextCharBox | null | undefined)[] = []
  private para: Paragraph | null

  constructor(input: TextMeasureInput, para: Paragraph) {
    this.para = para
    let end = 0
    let text = ""
    for (const r of input.runs) {
      const t = applyCase(r.text, r.style.case)
      text += t
      end += t.length
      this.sizes.push({ end, size: r.style.fontSize })
    }
    this.text = text
    this.height = para.getHeight()
    this.lines = para.getLineMetrics().map((m) => ({
      top: m.baseline - m.ascent,
      height: m.ascent + m.descent,
      left: m.left,
    }))
  }

  private sizeAt(i: number): number {
    for (const s of this.sizes) if (i < s.end) return s.size
    return this.sizes[this.sizes.length - 1]?.size ?? 16
  }

  char(i: number): TextCharBox | null {
    if (i < 0 || i >= this.text.length || this.text[i] === "\n") return null
    const known = this.chars[i]
    if (known !== undefined) return known
    let box: TextCharBox | null = null
    const para = this.para
    if (para) {
      const info = para.getGlyphInfoAt(i)
      const line = para.getLineNumberAt(i)
      const l = this.lines[line]
      if (info && l) {
        const r = info.graphemeLayoutBounds
        box = {
          x0: r[0] as number,
          x1: r[2] as number,
          top: l.top,
          height: l.height,
          fontSize: this.sizeAt(i),
          line,
        }
      }
    }
    this.chars[i] = box
    return box
  }

  lineStart(line: number): TextCharBox | null {
    const l = this.lines[line]
    if (!l) return null
    // The size of the text before the line (an empty line takes the newline's run).
    let at = 0
    for (let n = 0, i = 0; i < this.text.length && n < line; i++)
      if (this.text[i] === "\n") {
        n++
        at = i
      }
    return { x0: l.left, x1: l.left, top: l.top, height: l.height, fontSize: this.sizeAt(at), line }
  }

  dispose(): void {
    this.para?.delete()
    this.para = null
  }
}
