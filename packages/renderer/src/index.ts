/**
 * @kimo/renderer — the `Renderer` contract and its CanvasKit implementation (ADR 0004,
 * ADR 0009). Contracts live in ./types; viewport math below is pure and shared with hosts.
 */
import { createGoogleFontsSource } from "./fonts"
import { CanvasKitRenderer } from "./renderer"
import type { CreateRendererOptions, FontSource, Point, Rect, Renderer, Viewport } from "./types"

export {
  agentCanvasTheme,
  connectorPoints,
  hasAgentOverlays,
  shimmerDirection,
  shimmerSpan,
  skeletonBars,
} from "./agent-overlay"
export { parseColor, type RGBA, toHex } from "./color"
export { type FontFileInfo, fontFormat, fsEmbeddable, readFontInfo } from "./font-info"
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

// --- Viewport math (pure; same convention as @kimo/editor-state `Viewport`) ---------------

/** `world = screen / zoom + {x, y}` */
export function screenToWorld(v: Viewport, p: Point): Point {
  return { x: p.x / v.zoom + v.x, y: p.y / v.zoom + v.y }
}

/** `screen = (world - {x, y}) * zoom` */
export function worldToScreen(v: Viewport, p: Point): Point {
  return { x: (p.x - v.x) * v.zoom, y: (p.y - v.y) * v.zoom }
}

/** Maps a world rect to screen space. */
export function worldRectToScreen(v: Viewport, r: Rect): Rect {
  return { x: (r.x - v.x) * v.zoom, y: (r.y - v.y) * v.zoom, w: r.w * v.zoom, h: r.h * v.zoom }
}

/** Maps a screen rect to world space. */
export function screenRectToWorld(v: Viewport, r: Rect): Rect {
  return { x: r.x / v.zoom + v.x, y: r.y / v.zoom + v.y, w: r.w / v.zoom, h: r.h / v.zoom }
}

/** World rect currently visible in a `width × height` CSS-px canvas (for culling). */
export function visibleWorldRect(v: Viewport, width: number, height: number): Rect {
  return { x: v.x, y: v.y, w: width / v.zoom, h: height / v.zoom }
}
