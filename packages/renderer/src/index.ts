/**
 * @kimo/renderer — the `Renderer` contract and its CanvasKit implementation (ADR 0004,
 * ADR 0009). Contracts live in ./types; viewport math below is pure and shared with hosts.
 */
import { createGoogleFontsSource } from "./fonts"
import { CanvasKitRenderer } from "./renderer"
import type { CreateRendererOptions, FontSource, Renderer } from "./types"

/** CanvasKit types for app code that runs on the shared instance (SVG import outliner). */
export type { CanvasKit, Path as CkPath } from "canvaskit-wasm"
export {
  agentCanvasTheme,
  connectorPoints,
  hasAgentOverlays,
  shimmerDirection,
  shimmerSpan,
  skeletonBars,
} from "./agent-overlay"
/** Shared CanvasKit loader (SVG import's stroke outliner reuses the renderer's instance). */
export { loadCanvasKit } from "./ck"
export { parseColor, type RGBA, toHex } from "./color"
export {
  type FontFileInfo,
  fontAssetName,
  fontExtension,
  fontFamilyKey,
  fontFormat,
  fsEmbeddable,
  parseFontFileName,
  readFontInfo,
} from "./font-info"
export {
  collectFontUsage,
  createPlatformFontSources,
  type DocumentFontFace,
  detectMissingFonts,
  type FontAvailability,
  type FontHost,
  type FontHostCacheEntry,
  type FontHostLocalFamily,
  type FontHostLocalStyle,
  type FontPolicy,
  type FontUsage,
  googleCssUrl,
  type MissingFont,
  type PlatformFontSources,
  type PlatformFontSourcesOptions,
} from "./font-sources"
export { BUNDLED_FAMILIES, FALLBACK_FAMILY, type NetworkFontSource } from "./fonts"
export { DEFAULT_OVERLAY_THEME } from "./overlay"
export { CanvasKitRenderer, RASTER_MAX_SCALE } from "./renderer"
export * from "./types"

/**
 * Creates the CanvasKit renderer (interactive when attached, headless otherwise).
 * Call `init()` before use. In browsers import `@kimo/renderer/browser` (bundled wasm URL) or
 * pass `canvaskitWasmUrl` to `init`.
 */
export function createRenderer(options: CreateRendererOptions = {}): Renderer {
  return new CanvasKitRenderer(options)
}

/**
 * Font source that fetches static TTFs from the Google Fonts CSS2 API on demand (ADR 0009).
 * Hosts wrap it with a persistent cache source placed before it in `fontSources`.
 */
export function googleFontsSource(options: { fetch?: typeof fetch } = {}): FontSource {
  return createGoogleFontsSource(options)
}
