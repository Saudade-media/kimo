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
import { emitReact, reactPageNames, type TailwindThemeOutput } from "./emit/react"
import { emitSvg } from "./emit/svg"
import type { IconGlyphLike, IconLookup } from "./emit/svgpaint"
import { emitDtcg, emitTailwindTheme, emitTokensCss } from "./emit/tokens"
import type { ExportFile } from "./emit/types"
import { buildIR } from "./ir/build"
import { kebab } from "./ir/names"
import type { ExportIssue, IRDocument, IRNode, IRPaint } from "./ir/types"

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
  /** PDF bleed in points on every side (default 0). */
  bleed?: number
  /** React + Tailwind: theme output (default `v4`, the `@theme` block in `tokens.css`). */
  tailwindTheme?: TailwindThemeOutput
  /** React + Tailwind: "Map variables to theme tokens" (default true). */
  themeTokens?: boolean
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
        ...(options.tailwindTheme ? { theme: options.tailwindTheme } : {}),
        ...(options.themeTokens === false ? { themeTokens: false } : {}),
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
          ...(options.bleed ? { bleed: options.bleed } : {}),
        }),
      ]
      break
    case "png":
      files = await emitPng(ir, options)
      break
  }
  ir.issues.push(...paintIssues(ir, target))
  return { files, issues: attributeIssues(ir, target, files), ir }
}

/**
 * What `target` does with the mesh and shader paints of the exported nodes (spec §7.1): HTML /
 * CSS / React approximate a mesh with radial gradients, SVG and PDF use its mean vertex color;
 * shaders are drawn by PNG only. One issue per node and message; none for PNG and token
 * targets. `exportDocument` adds them; hosts that only build the IR (an Export dialog's PNG /
 * PDF preflight) call it themselves.
 */
export function paintIssues(ir: IRDocument, target: ExportTarget): ExportIssue[] {
  if (target === "png" || target.startsWith("tokens") || target === "tailwind-theme") return []
  const out: ExportIssue[] = []
  const seen = new Set<string>()
  const add = (code: ExportIssue["code"], message: string, nodeId: string) => {
    const k = `${code}|${message}|${nodeId}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ code, message, nodeId })
  }
  const mesh =
    target === "svg"
      ? "SVG has no mesh gradient; the mesh's mean vertex color is used"
      : target === "pdf"
        ? "PDF mesh gradients use the mean vertex color"
        : "mesh gradient approximated with radial gradients from its vertex colors"
  const check = (paints: readonly IRPaint[], id: string) => {
    for (const p of paints) {
      if (p.kind === "mesh") add("GRADIENT_APPROXIMATED", mesh, id)
      else if (p.kind === "shader")
        add(
          "PAINT_UNSUPPORTED",
          `shader ${p.src} is not exported (the canvas and PNG export render it)`,
          id,
        )
    }
  }
  const walk = (n: IRNode) => {
    check(n.visual.fills, n.id)
    if (n.visual.stroke) check(n.visual.stroke.paints, n.id)
    if (n.text) check(n.text.fills, n.id)
    for (const c of n.children) walk(c)
    for (const list of Object.values(n.instance?.slots ?? {})) for (const c of list) walk(c)
  }
  for (const r of ir.roots) walk(r)
  for (const c of ir.components) walk(c.root)
  return out
}

/**
 * The issues of an export, each with the output `file` it belongs to: the file emitted for the
 * root (or component) whose tree holds the node; node-less issues go to the tokens file when
 * there is one, else the first file.
 */
export function attributeIssues(
  ir: IRDocument,
  target: ExportTarget,
  files: readonly { path: string }[],
): ExportIssue[] {
  const owner = new Map<string, string>()
  const walk = (n: IRNode, path: string) => {
    if (!owner.has(n.id)) owner.set(n.id, path)
    for (const c of n.children) walk(c, path)
    for (const list of Object.values(n.instance?.slots ?? {})) for (const c of list) walk(c, path)
  }
  const single = (path: string) => {
    for (const r of ir.roots) walk(r, path)
  }
  const perRoot = (name: (r: IRNode) => string | undefined) => {
    for (const r of ir.roots) {
      const path = name(r)
      if (path) walk(r, path)
    }
  }
  const kebabPaths = (ext: string) => {
    const used = new Set<string>()
    const out = new Map<string, string>()
    for (const r of ir.roots) {
      let name = kebab(r.name ?? r.key, "root")
      for (let i = 2; used.has(name); i++) name = `${kebab(r.name ?? r.key, "root")}-${i}`
      used.add(name)
      out.set(r.id, `${name}${ext}`)
    }
    return out
  }
  const paths = new Set(files.map((f) => f.path))
  switch (target) {
    case "react-tailwind": {
      for (const c of ir.components) if (c) walk(c.root, `${c.ident}.tsx`)
      const names = reactPageNames(ir)
      perRoot((r) => `${names.get(r.id)}.tsx`)
      break
    }
    case "html-css":
      single("index.html")
      break
    case "svg": {
      const names = kebabPaths(".svg")
      perRoot((r) => names.get(r.id))
      break
    }
    case "pdf":
      single(files[0]?.path ?? "export.pdf")
      break
    case "png": {
      const names = kebabPaths(`@${files[0]?.path.match(/@(\d+)x\.png$/)?.[1] ?? 2}x.png`)
      perRoot((r) => names.get(r.id))
      break
    }
    default:
      if (files[0]) single(files[0].path)
  }
  const fallback =
    ["tokens.css", "theme.css", "tokens.json"].find((p) => paths.has(p)) ?? files[0]?.path
  return ir.issues.map((i) => {
    const file = (i.nodeId !== undefined ? owner.get(i.nodeId) : undefined) ?? fallback
    return file ? { ...i, file } : { ...i }
  })
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
