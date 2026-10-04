/**
 * Runs `@kimo/exporters` for the Export dialog. The exporters package (and pdf-lib behind it)
 * is loaded lazily, so it never lands in the editor's main chunk.
 */

import type { KimoDocument, Libraries } from "@kimo/core-schema"
import type {
  ExportFile,
  ExportIssue,
  IconLoader,
  IRDocument,
  IRNode,
  RasterSource,
} from "@kimo/exporters"
import type { LayoutResult, TextMeasurer } from "@kimo/layout"
import { fontFormat } from "@kimo/renderer"
import { groupIssues, type IssueGroup } from "./issues"
import {
  DEFAULT_PDF_TOGGLES,
  DEFAULT_PNG_SCALE,
  DEFAULT_TAILWIND,
  type ExportFormat,
  type ExportToggles,
  type ImageKind,
  PDF_BLEED_PT,
  type PdfToggles,
  type PngScale,
  type TailwindChoices,
  targetsOf,
} from "./model"

/** What the dialog exports: the open document, the canvas selection and the engine seams. */
export interface ExportSource {
  /** File name without extension ("Marketing site"): header fallback and zip name. */
  fileName: string
  document(): KimoDocument
  libraries?(): Libraries | undefined
  /** Selected node ids (view ids); empty → every top-level frame. */
  selection(): readonly string[]
  /** The renderer (text measurer for SVG, `exportRaster` for PNG); null before it is ready. */
  renderer?(): (RasterSource & { textMeasurer(): TextMeasurer }) | null
  /** The canvas's latest layout (same expanded ids as the IR); avoids a second layout pass. */
  layout?(): LayoutResult | null
  /** Icon glyphs (the renderer's `IconProvider`). */
  icons?: IconLoader | null
  /** PDF "Embed fonts": font file bytes for a face (null: Helvetica is used). */
  fonts?: (family: string, weight: number, italic: boolean) => Uint8Array | null
}

/**
 * `ExportSource.fonts` over the canvas's font provider (`FontProvider.faceBytes`): the exact face
 * the canvas renders a run with, so the PDF embeds the same glyphs. Only TrueType / OpenType
 * files are handed to pdf-lib (a WOFF/WOFF 2 or unknown file → null, and the exporter falls back
 * to Helvetica with a FONT_MISSING issue instead of failing the whole PDF).
 */
export function pdfFontsFrom(
  faceBytes: () =>
    | ((family: string, weight: number, style: "normal" | "italic") => Uint8Array | null)
    | null
    | undefined,
): (family: string, weight: number, italic: boolean) => Uint8Array | null {
  return (family, weight, italic) => {
    const bytes = faceBytes()?.(family, weight, italic ? "italic" : "normal") ?? null
    if (!bytes) return null
    const format = fontFormat(bytes)
    return format === "truetype" || format === "opentype" ? bytes : null
  }
}

/** Per-format choices beyond board 07's three toggles (board 25 § 2). */
export interface ExportChoices {
  /** SVG / PNG row: what the preview bar's toggle selects (default svg). */
  image?: ImageKind
  /** PNG scale (default 2×). */
  scale?: PngScale
  /** PDF options. */
  pdf?: PdfToggles
  /** React + Tailwind: theme output and token mapping (board 27 §10 rule jmMl8). */
  tailwind?: TailwindChoices
}

export interface ExportSummary {
  /** Header name: the single exported root's layer name, else the file name. */
  name: string
  frames: number
  layers: number
  variables: number
}

export interface GeneratedExport {
  /** Text files, shown as file tabs in the preview. */
  files: ExportFile[]
  /** Binary files (PNG, PDF) — only when generated with `binary: true`. */
  binary: ExportFile[]
  /** Files the export will write (text + binary, binary counted before it is rendered). */
  count: number
  summary: ExportSummary
  /** Messages for targets that could not run (e.g. SVG before the renderer is ready). */
  errors: string[]
  /** The exported roots (PNG / PDF preview renders the first). */
  roots: { id: string; name: string }[]
  /** Exporter issues grouped per output file (board 27 §10 Issues tab), `errors` included. */
  issues: IssueGroup[]
}

const loadExporters = () => import("@kimo/exporters")

function countNodes(nodes: readonly IRNode[]): number {
  let n = 0
  for (const node of nodes) n += 1 + countNodes(node.children)
  return n
}

/** Layer-name chain (export root → node) per IR node id, roots and components. */
function namesOf(ir: IRDocument): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const walk = (n: IRNode, chain: string[]) => {
    // Unnamed layers read as their type ("Frame"), as the Layers panel shows them.
    const names = [...chain, n.name ?? `${n.type.charAt(0).toUpperCase()}${n.type.slice(1)}`]
    if (!out.has(n.id)) out.set(n.id, names)
    for (const c of n.children) walk(c, names)
  }
  for (const r of ir.roots) walk(r, [])
  for (const c of ir.components) if (c) walk(c.root, [c.name])
  return out
}

function summaryOf(ir: IRDocument, fileName: string): ExportSummary {
  const only = ir.roots.length === 1 ? ir.roots[0] : undefined
  return {
    name: only?.name ?? fileName,
    frames: ir.roots.length,
    layers: countNodes(ir.roots),
    variables: ir.variables.length,
  }
}

/** Generates the files of `format` for the current selection. */
export async function generateExport(
  source: ExportSource,
  format: ExportFormat,
  toggles: ExportToggles,
  options: { binary?: boolean } & ExportChoices = {},
): Promise<GeneratedExport> {
  const ex = await loadExporters()
  const doc = source.document()
  const libraries = source.libraries?.()
  const selection = source.selection()
  const renderer = source.renderer?.() ?? null
  const layout = source.layout?.() ?? null
  const base = {
    ...(libraries ? { libraries } : {}),
    ...(selection.length ? { ids: selection } : {}),
    variables: toggles.variables,
    components: toggles.components,
    layerNames: toggles.layerNames,
    ...(source.icons ? { icons: source.icons } : {}),
  }
  const targets = targetsOf(format, options.image ?? "svg")
  const scale = options.scale ?? DEFAULT_PNG_SCALE
  const pdf = options.pdf ?? DEFAULT_PDF_TOGGLES
  const files: ExportFile[] = []
  const errors: string[] = []
  const issues: ExportIssue[] = []
  const names = new Map<string, string[]>()
  const tailwind = options.tailwind ?? DEFAULT_TAILWIND
  let ir: IRDocument | null = null
  const engine = {
    ...(layout ? { layout } : {}),
    ...(renderer ? { measureText: renderer.textMeasurer() } : {}),
  }
  for (const target of targets.text) {
    try {
      const result = await ex.exportDocument(doc, target, {
        ...base,
        ...(target === "svg" ? engine : {}),
        ...(target === "react-tailwind"
          ? { tailwindTheme: tailwind.theme, themeTokens: tailwind.mapTokens }
          : {}),
      })
      ir ??= result.ir
      files.push(...result.files)
      issues.push(...result.issues)
      for (const [id, n] of namesOf(result.ir)) if (!names.has(id)) names.set(id, n)
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  if (!ir) {
    // PNG / PDF: no text target ran — the IR's own issues (unresolved variables, instances…).
    ir = ex.buildIR(doc, {
      ...(libraries ? { libraries } : {}),
      ...(selection.length ? { ids: selection } : {}),
    })
    const planned = targets.pdf
      ? [{ path: "export.pdf" }]
      : ir.roots.map(() => ({ path: `x@${scale}x.png` }))
    issues.push(...ex.attributeIssues(ir, targets.pdf ? "pdf" : "png", planned))
    for (const [id, n] of namesOf(ir)) names.set(id, n)
  }
  const binary: ExportFile[] = []
  if (targets.png && options.binary) {
    if (!renderer) errors.push("png export needs a renderer (raster)")
    else binary.push(...(await ex.emitPng(ir, { raster: renderer, scale })))
  }
  if (targets.pdf && options.binary) {
    try {
      const result = await ex.exportDocument(doc, "pdf", {
        ...base,
        ...engine,
        ...(pdf.embedFonts && source.fonts ? { fonts: source.fonts } : {}),
        ...(pdf.bleed ? { bleed: PDF_BLEED_PT } : {}),
      })
      binary.push(...result.files)
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  const count = files.length + (targets.png ? ir.roots.length : 0) + (targets.pdf ? 1 : 0)
  return {
    files,
    binary,
    count,
    summary: summaryOf(ir, source.fileName),
    errors,
    roots: ir.roots.map((r) => ({ id: r.id, name: r.name ?? r.key })),
    issues: groupIssues(issues, {
      files: files.map((f) => f.path),
      names: (id) => names.get(id) ?? null,
      failures: errors,
    }),
  }
}

/**
 * PNG / PDF preview (rule "PNG preview"): the first exported root rendered at `scale` through
 * the exporter's `emitPng` (same file name as the export), with its canvas size.
 */
export async function previewRaster(
  source: ExportSource,
  scale: number,
): Promise<{ file: ExportFile; w: number; h: number } | { error: string } | null> {
  const ex = await loadExporters()
  const doc = source.document()
  const libraries = source.libraries?.()
  const selection = source.selection()
  const ir = ex.buildIR(doc, {
    ...(libraries ? { libraries } : {}),
    ...(selection.length ? { ids: selection } : {}),
  })
  const root = ir.roots[0]
  if (!root) return null
  const renderer = source.renderer?.() ?? null
  if (!renderer) return { error: "The preview needs the canvas renderer" }
  try {
    const [file] = await ex.emitPng({ ...ir, roots: [root] }, { raster: renderer, scale })
    if (!file) return null
    // Canvas size = the PNG's own size (IHDR) ÷ scale; the layout box when it is not a PNG.
    const bytes = file.contents as Uint8Array
    const png = bytes.byteLength > 24 && bytes[0] === 0x89 && bytes[1] === 0x50
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const box = source.layout?.()?.nodes.get(root.id)
    const w = png ? view.getUint32(16) / scale : (box?.local.w ?? 0)
    const h = png ? view.getUint32(20) / scale : (box?.local.h ?? 0)
    return { file, w, h }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
