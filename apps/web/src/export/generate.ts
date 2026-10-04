/**
 * Runs `@kimo/exporters` for the Export dialog. The exporters package (and pdf-lib behind it)
 * is loaded lazily, so it never lands in the editor's main chunk.
 */

import type { KimoDocument, Libraries } from "@kimo/core-schema"
import type { ExportFile, IconLoader, IRDocument, IRNode, RasterSource } from "@kimo/exporters"
import type { LayoutResult, TextMeasurer } from "@kimo/layout"
import { type ExportFormat, type ExportToggles, PNG_SCALES, targetsOf } from "./model"

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
  /** Binary files (PNG) — only when generated with `binary: true`. */
  binary: ExportFile[]
  /** Files the export will write (text + PNG, PNG counted before it is rendered). */
  count: number
  summary: ExportSummary
  /** Messages for targets that could not run (e.g. SVG before the renderer is ready). */
  errors: string[]
}

const loadExporters = () => import("@kimo/exporters")

function countNodes(nodes: readonly IRNode[]): number {
  let n = 0
  for (const node of nodes) n += 1 + countNodes(node.children)
  return n
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
  options: { binary?: boolean } = {},
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
  const targets = targetsOf(format)
  const files: ExportFile[] = []
  const errors: string[] = []
  let ir: IRDocument | null = null
  for (const target of targets.text) {
    try {
      const result = await ex.exportDocument(doc, target, {
        ...base,
        ...(target === "svg" && layout ? { layout } : {}),
        ...(target === "svg" && renderer ? { measureText: renderer.textMeasurer() } : {}),
      })
      ir ??= result.ir
      files.push(...result.files)
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  ir ??= ex.buildIR(doc, {
    ...(libraries ? { libraries } : {}),
    ...(selection.length ? { ids: selection } : {}),
  })
  const binary: ExportFile[] = []
  if (targets.png && options.binary) {
    if (!renderer) errors.push("png export needs a renderer (raster)")
    else
      for (const scale of PNG_SCALES)
        binary.push(...(await ex.emitPng(ir, { raster: renderer, scale })))
  }
  const count = files.length + (targets.png ? ir.roots.length * PNG_SCALES.length : 0)
  return { files, binary, count, summary: summaryOf(ir, source.fileName), errors }
}
