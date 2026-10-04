/**
 * One entry point per export target (the `kimo_export` targets of `@kimo/mcp-server`), plus
 * the seams to the rest of the engine: a layout pass (`@kimo/layout`, Yoga) for SVG/PDF,
 * icon glyph loading, and PNG through the renderer's `exportRaster` (the renderer does the
 * pixels; this package only names the files).
 */
import type { KimoDocument, Libraries } from "@kimo/core-schema"
import {
  createInstanceView,
  createLayoutEngine,
  createResolver,
  type LayoutResult,
  nodeSourceFromDocument,
  type TextMeasurer,
} from "@kimo/layout"
import { emitHtml } from "./emit/html"
import { emitPdf } from "./emit/pdf"
import { emitReact } from "./emit/react"
import { emitSvg } from "./emit/svg"
import type { IconGlyphLike, IconLookup } from "./emit/svgpaint"
import { emitDtcg, emitTailwindTheme, emitTokensCss } from "./emit/tokens"
import type { ExportFile } from "./emit/types"
import { buildIR } from "./ir/build"
import { kebab } from "./ir/names"
import type { ExportIssue, IRDocument } from "./ir/types"

export const EXPORT_TARGETS = [
  "react-tailwind",
  "html-css",
  "tokens-dtcg",
  "tokens-css",
  "tailwind-theme",
  "svg",
  "pdf",
  "png",
] as const
export type ExportTarget = (typeof EXPORT_TARGETS)[number]

/** Structurally `@kimo/renderer` `Renderer.exportRaster`. */
export interface RasterSource {
  exportRaster(
    nodeId: string,
    options?: { scale?: number; background?: string },
  ): Promise<Uint8Array>
}

/** Structurally `@kimo/renderer` `IconProvider.load`. */
export interface IconLoader {
  load(set: string, name: string, weight?: number): Promise<IconGlyphLike | null>
}

/** Options of {@link exportDocument} (board 07 options plus engine seams). */
export interface ExportOptions {
  libraries?: Libraries
  /** Nodes to export (default: top-level frames). */
  ids?: readonly string[]
  /** "Variables as CSS custom properties" (default true). */
  variables?: boolean
  /** "Split instances into components" (React; default true). */
  components?: boolean
  /** "Keep layer names as data attributes" (default true for HTML, false for React). */
  layerNames?: boolean
  /** Icon glyphs (a renderer `IconProvider`). */
  icons?: IconLoader
  /** Text measurer for the layout pass of SVG/PDF (the renderer's `textMeasurer()`). */
  measureText?: TextMeasurer
  /** Precomputed layout (same document); otherwise computed with `measureText`. */
  layout?: LayoutResult
  /** PNG: the renderer. */
  raster?: RasterSource
  /** PNG pixel ratio (default 2). */
  scale?: number
  /** PDF font bytes. */
  fonts?: (family: string, weight: number, italic: boolean) => Uint8Array | null
  /** PDF asset bytes. */
  assets?: (src: string) => Uint8Array | null
}

export interface ExportResult {
  files: ExportFile[]
  issues: ExportIssue[]
  ir: IRDocument
}

/** Loads every glyph the IR uses into a synchronous lookup. */
export async function loadIcons(ir: IRDocument, loader: IconLoader): Promise<IconLookup> {
  const map = new Map<string, IconGlyphLike | null>()
  const key = (s: string, n: string, w?: number) => `${s}\u0000${n}\u0000${w ?? ""}`
  for (const i of ir.icons) {
    const w = i.weight ?? undefined
    map.set(key(i.set, i.name, w), await loader.load(i.set, i.name, w))
  }
  return { get: (s, n, w) => map.get(key(s, n, w)) ?? null }
}

/** A layout pass of the whole document with the same expanded ids as the IR. */
export async function layoutDocument(
  doc: KimoDocument,
  options: { libraries?: Libraries; measureText: TextMeasurer; roots?: readonly string[] },
): Promise<LayoutResult> {
  const engine = createLayoutEngine(options.libraries ? { libraries: options.libraries } : {})
  await engine.init()
  const header = { variables: doc.variables, themes: doc.themes, imports: doc.imports }
  const view = createInstanceView(nodeSourceFromDocument(doc), {
    ...(options.libraries ? { libraries: options.libraries } : {}),
    header: () => doc,
  })
  const resolve = createResolver(
    header,
    view,
    options.libraries ? { libraries: options.libraries } : {},
  )
  const result = engine.compute({
    nodes: view,
    expanded: view,
    resolve,
    measureText: options.measureText,
    ...(options.roots ? { roots: options.roots } : {}),
  })
  engine.dispose()
  return result
}

/** Exports `doc` to one target. Deterministic for a given document, options and engine. */
export async function exportDocument(
  doc: KimoDocument,
  target: ExportTarget,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const variables = options.variables !== false
  const ir = buildIR(doc, {
    ...(options.libraries ? { libraries: options.libraries } : {}),
    ...(options.ids ? { ids: options.ids } : {}),
    ...(options.layout ? { layout: options.layout } : {}),
    components: target === "react-tailwind" && options.components !== false,
    cssVariables: variables,
  })
  const icons = options.icons ? await loadIcons(ir, options.icons) : undefined
  const needLayout = async (): Promise<LayoutResult> => {
    if (options.layout) return options.layout
    if (!options.measureText) throw new Error(`${target} export needs a layout or a text measurer`)
    return layoutDocument(doc, {
      measureText: options.measureText,
      ...(options.libraries ? { libraries: options.libraries } : {}),
    })
  }
  let files: ExportFile[] = []
  switch (target) {
    case "html-css":
      files = emitHtml(ir, {
        variables,
        layerNames: options.layerNames !== false,
        ...(icons ? { icons } : {}),
      })
      break
    case "react-tailwind":
      files = emitReact(ir, {
        variables,
        components: options.components !== false,
        layerNames: options.layerNames === true,
        ...(icons ? { icons } : {}),
      })
      break
    case "tokens-dtcg":
      files = [{ path: "tokens.json", contents: emitDtcg(ir) }]
      break
    case "tokens-css":
      files = [{ path: "tokens.css", contents: emitTokensCss(ir) }]
      break
    case "tailwind-theme":
      files = [{ path: "theme.css", contents: emitTailwindTheme(ir) }]
      break
    case "svg":
      files = emitSvg(ir, {
        layout: await needLayout(),
        ...(options.measureText ? { measureText: options.measureText } : {}),
        ...(icons ? { icons } : {}),
      })
      break
    case "pdf":
      files = [
        await emitPdf(ir, {
          layout: await needLayout(),
          ...(options.measureText ? { measureText: options.measureText } : {}),
          ...(icons ? { icons } : {}),
          ...(options.fonts ? { fonts: options.fonts } : {}),
          ...(options.assets ? { assets: options.assets } : {}),
        }),
      ]
      break
    case "png":
      files = await emitPng(ir, options)
      break
  }
  return { files, issues: ir.issues, ir }
}

/** PNG per exported root through the renderer (`<name>@<scale>x.png`). */
export async function emitPng(
  ir: IRDocument,
  options: Pick<ExportOptions, "raster" | "scale">,
): Promise<ExportFile[]> {
  if (!options.raster) throw new Error("png export needs a renderer (raster)")
  const scale = options.scale ?? 2
  const out: ExportFile[] = []
  const used = new Set<string>()
  for (const r of ir.roots) {
    let name = kebab(r.name ?? r.key, "root")
    for (let i = 2; used.has(name); i++) name = `${kebab(r.name ?? r.key, "root")}-${i}`
    used.add(name)
    out.push({
      path: `${name}@${scale}x.png`,
      contents: await options.raster.exportRaster(r.id, { scale }),
    })
  }
  return out
}
