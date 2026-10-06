/**
 * @kimo/exporters — deterministic export (teardown §3.5, §9.2, §12 M7; ADR 0015):
 * document subtree → IR → React+Tailwind v4, HTML/CSS, design tokens (DTCG JSON, CSS
 * variables, Tailwind `@theme`), SVG and PDF; PNG through the renderer's `exportRaster`.
 * Runtime-neutral: no DOM, no Node APIs; emitters return files, the host writes them.
 */

export { type CssOptions, CssWriter, type Decl, type NodeCss } from "./css/style"
export { BASE_CSS, emitHtml, type HtmlOptions } from "./emit/html"
export { emitPdf, type PdfOptions } from "./emit/pdf"
export { emitReact, type ReactOptions, type TailwindThemeOutput } from "./emit/react"
export { buildScene, type SceneNode, type SceneOptions, textLines } from "./emit/scene"
export { emitSvg, type SvgOptions, svgOf } from "./emit/svg"
export type { IconGlyphLike, IconLookup } from "./emit/svgpaint"
export {
  emitDtcg,
  emitTailwindConfig,
  emitTailwindTheme,
  emitTokensCss,
  THEME_MARKER,
  tokenPath,
} from "./emit/tokens"
export type { ExportFile } from "./emit/types"
export {
  attributeIssues,
  EXPORT_TARGETS,
  type ExportOptions,
  type ExportResult,
  type ExportTarget,
  emitPng,
  exportDocument,
  type IconLoader,
  layoutDocument,
  loadIcons,
  paintIssues,
  type RasterSource,
} from "./export"
export { type BuildIROptions, buildIR, findNode } from "./ir/build"
export { cssColor, parseColor, type RGBA } from "./ir/color"
export * from "./ir/types"
