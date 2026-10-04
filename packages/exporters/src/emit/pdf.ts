/**
 * PDF emitter (teardown §12 M7: "PDF via a JS library, pdf-lib (MIT)"): one page per exported
 * root, vector where PDF allows — paths, solid fills and strokes, clipping, text with embedded
 * fonts (the caller supplies TTF/OTF bytes; standard Helvetica otherwise), images, icons.
 * Gradients become their mean color and effects are dropped (reported as issues).
 *
 * Deterministic: no metadata dates, no random resource names (pdf-lib's `addRandomSuffix` is
 * replaced by a counter), no object streams.
 */

import type { Matrix } from "@kimo/layout"
import fontkit from "@pdf-lib/fontkit"
import {
  clip,
  concatTransformationMatrix,
  endPath,
  LineCapStyle,
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
  setCharacterSpacing,
} from "pdf-lib"
import { svgPathToOperators } from "pdf-lib/cjs/api/svgPath"
import type { ExportIssueCode, IRDocument, IRPaint, IRStroke } from "../ir/types"
import { rrectPath, shapePath } from "./geometry"
import { applyCase, buildScene, multiply, type SceneNode, type SceneOptions } from "./scene"
import type { IconLookup } from "./svgpaint"
import type { ExportFile } from "./types"

export interface PdfOptions extends SceneOptions {
  icons?: IconLookup
  /** Font file bytes for a face, or null (Helvetica is used and FONT_MISSING reported). */
  fonts?: (family: string, weight: number, italic: boolean) => Uint8Array | null
  /** Asset bytes (`./assets/…` references), or null. */
  assets?: (src: string) => Uint8Array | null
  /** Output file name. Default `export.pdf`. */
  path?: string
}

const S: Matrix = [1, 0, 0, -1, 0, 0]

/** Writes one PDF with a page per exported root. */
export async function emitPdf(ir: IRDocument, options: PdfOptions): Promise<ExportFile> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  let counter = 0
  ;(doc.context as unknown as { addRandomSuffix: (p: string) => string }).addRandomSuffix = (p) =>
    `${p}-${++counter}`
  doc.registerFontkit(fontkit)
  const issue = (code: ExportIssueCode, message: string, nodeId?: string) =>
    ir.issues.push({ code, message, ...(nodeId ? { nodeId } : {}) })

  const fontCache = new Map<string, PDFFont>()
  const font = async (family: string, weight: number, italic: boolean): Promise<PDFFont> => {
    const key = `${family}\u0000${weight}\u0000${italic}`
    const hit = fontCache.get(key)
    if (hit) return hit
    const bytes = options.fonts?.(family, weight, italic) ?? null
    let f: PDFFont
    if (bytes) f = await doc.embedFont(bytes, { subset: false })
    else {
      issue(
        "FONT_MISSING",
        `no font file for ${family} ${weight}${italic ? " italic" : ""}; Helvetica used`,
      )
      const std =
        weight >= 600
          ? italic
            ? StandardFonts.HelveticaBoldOblique
            : StandardFonts.HelveticaBold
          : italic
            ? StandardFonts.HelveticaOblique
            : StandardFonts.Helvetica
      f = await doc.embedFont(std)
    }
    fontCache.set(key, f)
    return f
  }
  const images = new Map<string, PDFImage | null>()
  const image = async (src: string): Promise<PDFImage | null> => {
    if (images.has(src)) return images.get(src) ?? null
    const bytes = options.assets?.(src) ?? null
    let img: PDFImage | null = null
    if (bytes) {
      try {
        img = /\.png$/i.test(src) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
      } catch {
        img = null
      }
    }
    if (!img) issue("PAINT_UNSUPPORTED", `image ${src} could not be embedded`)
    images.set(src, img)
    return img
  }

  for (const root of ir.roots) {
    const scene = buildScene(root, options)
    if (!scene) continue
    const page = doc.addPage([scene.w, scene.h])
    const F: Matrix = [1, 0, 0, -1, 0, scene.h]
    await drawNode(page, scene, F, 1)
  }

  async function drawNode(page: PDFPage, s: SceneNode, F: Matrix, alpha: number) {
    const node = s.node
    const v = node.visual
    const a = alpha * (v.opacity?.v ?? 1)
    if (v.shadows.length || v.blur || v.backdropBlur)
      issue("EFFECT_APPROXIMATED", "effects are not exported to PDF", node.id)
    if (v.blend) issue("EFFECT_APPROXIMATED", "blend modes are not exported to PDF", node.id)
    const yDown = multiply(F, s.world)
    const yUp = multiply(yDown, S)
    const radii = v.radius?.map((r) => r.v) ?? null
    let geom: { d: string; transform: string | null } | null = null
    if (node.shape) geom = shapePath(node.shape, s.w, s.h, radii)
    else if (node.type === "frame" || node.type === "instance")
      geom = { d: rrectPath(s.w, s.h, radii), transform: null }
    const pathD = geom ? transformPath(geom.d, geom.transform) : null

    const withMatrix = (m: Matrix, fn: () => void) => {
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m))
      fn()
      page.pushOperators(popGraphicsState())
    }

    if (pathD) {
      for (const p of v.fills) {
        if (p.kind === "image") {
          const img = await image(p.src)
          if (!img) continue
          withMatrix(yDown, () => {
            page.pushOperators(...svgPathToOperators(pathD), clip(), endPath())
            const scale =
              p.fit === "contain"
                ? Math.min(s.w / img.width, s.h / img.height)
                : Math.max(s.w / img.width, s.h / img.height)
            const iw = p.fit === "stretch" ? s.w : img.width * scale
            const ih = p.fit === "stretch" ? s.h : img.height * scale
            // Images draw y-up: flip around the box.
            page.pushOperators(concatTransformationMatrix(1, 0, 0, -1, 0, s.h))
            page.drawImage(img, {
              x: (s.w - iw) / 2,
              y: (s.h - ih) / 2,
              width: iw,
              height: ih,
              opacity: a * p.opacity,
            })
          })
          continue
        }
        const c = color(p)
        if (!c) continue
        if (p.kind !== "solid")
          issue("GRADIENT_APPROXIMATED", "PDF gradients use the mean color", node.id)
        withMatrix(yUp, () =>
          page.drawSvgPath(pathD, { x: 0, y: 0, color: c.rgb, opacity: a * c.a, borderWidth: 0 }),
        )
      }
    }
    if (node.icon) {
      const glyph =
        options.icons?.get(node.icon.set, node.icon.name, node.icon.weight ?? undefined) ?? null
      if (!glyph)
        issue("ICON_MISSING", `icon ${node.icon.set}/${node.icon.name} is not loaded`, node.id)
      else {
        const [vx, vy, vw, vh] = glyph.viewBox
        const m = multiply(yDown, [s.w / vw, 0, 0, s.h / vh, (-vx * s.w) / vw, (-vy * s.h) / vh])
        const [r, g, b, ca] = node.icon.color.rgba
        const sw = node.icon.strokeWidth ?? glyph.strokeWidth ?? 2
        for (const gp of glyph.paths)
          withMatrix(multiply(m, S), () =>
            gp.paint === "stroke"
              ? page.drawSvgPath(gp.d, {
                  x: 0,
                  y: 0,
                  borderColor: rgb(r, g, b),
                  borderWidth: sw,
                  borderOpacity: a * ca * (gp.opacity ?? 1),
                  borderLineCap: LineCapStyle.Round,
                })
              : page.drawSvgPath(gp.d, {
                  x: 0,
                  y: 0,
                  color: rgb(r, g, b),
                  opacity: a * ca * (gp.opacity ?? 1),
                }),
          )
      }
    }
    if (node.text && s.lines) {
      const t = node.text
      const fill = t.fills[t.fills.length - 1]
      const c = fill ? color(fill) : null
      if (c) {
        for (const line of s.lines) {
          let x = line.x
          for (const seg of line.segments) {
            const st = seg.style
            const f = await font(st.family.v, st.weight.v, st.italic)
            const str = encodable(f, applyCase(seg.text, null))
            const ls = st.letterSpacing.v
            withMatrix(yUp, () => {
              if (ls !== 0) page.pushOperators(setCharacterSpacing(ls))
              page.drawText(str, {
                x,
                y: -line.baseline,
                size: st.size.v,
                font: f,
                color: c.rgb,
                opacity: a * c.a,
              })
            })
            x += f.widthOfTextAtSize(str, st.size.v) + ls * [...str].length
          }
        }
      }
    }
    const kids = async () => {
      for (const c of s.children) await drawNode(page, c, F, a)
    }
    if (s.children.length) {
      if (v.clip) {
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...yDown))
        page.pushOperators(...svgPathToOperators(rrectPath(s.w, s.h, radii)), clip(), endPath())
        page.pushOperators(concatTransformationMatrix(...inverse(yDown)))
        await kids()
        page.pushOperators(popGraphicsState())
      } else await kids()
    }
    if (pathD && v.stroke) strokePath(page, v.stroke, pathD, yDown, yUp, a, node.id)
  }

  function strokePath(
    page: PDFPage,
    st: IRStroke,
    d: string,
    yDown: Matrix,
    yUp: Matrix,
    a: number,
    id: string,
  ) {
    if ("t" in st.width) {
      issue("STROKE_APPROXIMATED", "per-side strokes are exported as a uniform stroke", id)
    }
    const w =
      "t" in st.width
        ? Math.max(st.width.t.v, st.width.r.v, st.width.b.v, st.width.l.v)
        : st.width.v
    const p = st.paints[st.paints.length - 1]
    const c = p ? color(p) : null
    if (!c || w <= 0) return
    if (st.align === "outside")
      issue("STROKE_APPROXIMATED", "outside strokes are exported centered", id)
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...yDown))
    if (st.align === "inside") page.pushOperators(...svgPathToOperators(d), clip(), endPath())
    page.pushOperators(concatTransformationMatrix(...S))
    page.drawSvgPath(d, {
      x: 0,
      y: 0,
      borderColor: c.rgb,
      borderWidth: st.align === "inside" ? w * 2 : w,
      borderOpacity: a * c.a,
      ...(st.dash ? { borderDashArray: st.dash } : {}),
      borderLineCap:
        st.cap === "round"
          ? LineCapStyle.Round
          : st.cap === "square"
            ? LineCapStyle.Projecting
            : LineCapStyle.Butt,
    })
    page.pushOperators(popGraphicsState())
    void yUp
  }

  const bytes = await doc.save({ useObjectStreams: false })
  return { path: options.path ?? "export.pdf", contents: bytes }
}

function color(p: IRPaint): { rgb: ReturnType<typeof rgb>; a: number } | null {
  if (p.kind === "solid") {
    const [r, g, b, a] = p.color.rgba
    return { rgb: rgb(r, g, b), a }
  }
  if (p.kind === "image") return null
  const m = [0, 0, 0, 0]
  for (const s of p.stops)
    for (let i = 0; i < 4; i++)
      m[i] = (m[i] as number) + (s.color.rgba[i] as number) / p.stops.length
  return { rgb: rgb(m[0] as number, m[1] as number, m[2] as number), a: m[3] as number }
}

/** Characters the font cannot encode become `?` (standard fonts are WinAnsi only). */
function encodable(f: PDFFont, s: string): string {
  let out = ""
  for (const ch of s) {
    try {
      f.encodeText(ch)
      out += ch
    } catch {
      out += "?"
    }
  }
  return out
}

function inverse(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2] || 1
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

/** Applies an SVG `matrix(…)` transform (path viewBox mapping) to absolute path data. */
function transformPath(d: string, transform: string | null): string {
  if (!transform) return d
  const m = /matrix\(([^)]+)\)/.exec(transform)
  if (!m) return d
  const [sx, , , sy, tx, ty] = (m[1] as string).split(/\s+/).map(Number) as number[]
  // Scale + translate only (pathTransform never rotates): rewrite every coordinate pair.
  return scalePath(d, sx as number, sy as number, tx as number, ty as number)
}

function scalePath(d: string, sx: number, sy: number, tx: number, ty: number): string {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []
  const out: string[] = []
  let cmd = ""
  let i = 0
  let idx = 0
  const params: Record<string, number> = {
    M: 2,
    L: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    T: 2,
    A: 7,
    Z: 0,
  }
  while (i < tokens.length) {
    const t = tokens[i] as string
    if (/[a-zA-Z]/.test(t)) {
      cmd = t
      out.push(t)
      idx = 0
      i++
      continue
    }
    const up = cmd.toUpperCase()
    const rel = cmd !== up
    const k = params[up] ?? 2
    const pos = idx % (k || 1)
    let v = Number(t)
    if (up === "H") v = v * sx + (rel ? 0 : tx)
    else if (up === "V") v = v * sy + (rel ? 0 : ty)
    else if (up === "A") {
      if (pos === 0) v *= Math.abs(sx)
      else if (pos === 1) v *= Math.abs(sy)
      else if (pos === 5) v = v * sx + (rel ? 0 : tx)
      else if (pos === 6) v = v * sy + (rel ? 0 : ty)
    } else v = pos % 2 === 0 ? v * sx + (rel ? 0 : tx) : v * sy + (rel ? 0 : ty)
    out.push(String(Number(v.toFixed(4))))
    idx++
    i++
  }
  return out.join(" ")
}
