/**
 * Preview (board 27 §9 j52y5f, rules PTmL2): the pure state behind the in-place presentation
 * overlay — which frame opens, stepping through the page's top-level frames, the preview-only
 * theme overrides and the zoom presets. No DOM, no renderer: `PreviewOverlay` and `render.ts`
 * consume it, `test/board27-preview.test.ts` covers it.
 */
import type { KimoDocument, Libraries, Theme } from "@kimo/core-schema"
import { effectiveTheme } from "@kimo/core-schema"

/** The node reads the preview needs (a `DocStore` satisfies it). */
export interface PreviewDoc {
  getNode(id: string): { type?: unknown; parent?: unknown; name?: unknown } | undefined
  children(parent: string | null): readonly string[]
}

/** Node types that count as a page's top-level frame (a screen). */
const FRAME_TYPES: ReadonlySet<unknown> = new Set(["frame", "instance"])

/** Rule "Navigate": the page's top-level frames in layer order (sibling order). */
export function topLevelFrames(doc: PreviewDoc, roots?: readonly string[]): string[] {
  return (roots ?? doc.children(null)).filter((id) => FRAME_TYPES.has(doc.getNode(id)?.type))
}

/** The top-level frame that holds `id` (itself when it is one), or null. */
export function topLevelFrameOf(
  doc: PreviewDoc,
  id: string,
  frames: readonly string[],
): string | null {
  const set = new Set(frames)
  const seen = new Set<string>()
  let cur: unknown = id
  while (typeof cur === "string" && !seen.has(cur)) {
    if (set.has(cur)) return cur
    seen.add(cur)
    cur = doc.getNode(cur)?.parent
  }
  return null
}

/**
 * Rule "What": the selected top-level frame, else the top-level frame containing the selection,
 * else the page's first frame; null when the page has no top-level frame (button disabled).
 */
export function pickPreviewFrame(
  doc: PreviewDoc,
  selection: readonly string[],
  roots?: readonly string[],
): string | null {
  const frames = topLevelFrames(doc, roots)
  for (const id of selection) if (frames.includes(id)) return id
  for (const id of selection) {
    const f = topLevelFrameOf(doc, id, frames)
    if (f) return f
  }
  return frames[0] ?? null
}

/** Display name of a node (`name`, else its id). */
export function frameName(doc: PreviewDoc, id: string): string {
  const n = doc.getNode(id)?.name
  return typeof n === "string" && n.trim() ? n : id
}

/** Rule "Navigate": ‹ › / ← → step through the frames, clamped (pages are not crossed). */
export function stepFrame(frames: readonly string[], current: string, delta: -1 | 1): string {
  const i = frames.indexOf(current)
  if (i < 0) return frames[0] ?? current
  return frames[Math.max(0, Math.min(frames.length - 1, i + delta))] ?? current
}

/** "2 / 5" (1-based); "– / n" when the frame is gone. */
export function countLabel(frames: readonly string[], current: string): string {
  const i = frames.indexOf(current)
  return `${i < 0 ? "–" : i + 1} / ${frames.length}`
}

// --- Theme (rule "Theme") ---------------------------------------------------------------------

export type ThemeAxes = Readonly<Record<string, readonly string[]>>

/** The file's theme axes (`themes` header: axis → values; the first value is the default). */
export function themeAxes(themes: unknown): ThemeAxes {
  const out: Record<string, readonly string[]> = {}
  if (!themes || typeof themes !== "object") return out
  for (const [axis, values] of Object.entries(themes as Record<string, unknown>)) {
    if (Array.isArray(values)) {
      const vs = values.filter((v): v is string => typeof v === "string")
      if (vs.length) out[axis] = vs
    }
  }
  return out
}

/**
 * The axis the sun/moon toggle drives: the first axis whose values include both `light` and
 * `dark` (case-insensitive), with those two values; null when the file has none.
 */
export function lightDarkAxis(
  axes: ThemeAxes,
): { axis: string; light: string; dark: string } | null {
  for (const [axis, values] of Object.entries(axes)) {
    const light = values.find((v) => v.toLowerCase() === "light")
    const dark = values.find((v) => v.toLowerCase() === "dark")
    if (light && dark) return { axis, light, dark }
  }
  return null
}

/** Axes that get a select in the bar: every axis except the light/dark one. */
export function selectAxes(axes: ThemeAxes): string[] {
  const ld = lightDarkAxis(axes)?.axis
  return Object.keys(axes).filter((a) => a !== ld)
}

/**
 * Initial overrides = the frame's pinned (effective) themes, limited to the file's own axes.
 * Overrides live only in the preview: they are applied to the preview's render source and never
 * written to the document (rule "Theme": preview-only, never written).
 */
export function initialThemes(
  doc: KimoDocument,
  frameId: string,
  libraries: Libraries = {},
): Theme {
  const axes = themeAxes(doc.themes)
  const eff = effectiveTheme(doc, frameId, libraries)
  const out: Theme = {}
  for (const axis of Object.keys(axes)) {
    const v = eff[axis]
    if (typeof v === "string") out[axis] = v
  }
  return out
}

/** The light/dark toggle (T): flips the light/dark axis; unchanged when the file has none. */
export function toggleLightDark(axes: ThemeAxes, themes: Theme): Theme {
  const ld = lightDarkAxis(axes)
  if (!ld) return themes
  const cur = themes[ld.axis] ?? axes[ld.axis]?.[0]
  return { ...themes, [ld.axis]: cur === ld.dark ? ld.light : ld.dark }
}

/** True when the light/dark axis currently reads dark. */
export function isDark(axes: ThemeAxes, themes: Theme): boolean {
  const ld = lightDarkAxis(axes)
  if (!ld) return false
  return (themes[ld.axis] ?? axes[ld.axis]?.[0]) === ld.dark
}

// --- Zoom (rule "Zoom") -------------------------------------------------------------------------

/** Fit (0) · 50 · 100 (1) · 200 %. */
export type ZoomPreset = "fit" | 0.5 | 1 | 2
export const ZOOM_PRESETS: readonly ZoomPreset[] = ["fit", 0.5, 1, 2]

/** Stage margin around the fitted frame (decision Co3jD: "zoomed to fit with 24 px margin"). */
export const FIT_MARGIN = 24
export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 64

export interface Box {
  x: number
  y: number
  w: number
  h: number
}
export interface View {
  x: number
  y: number
  zoom: number
}

/** The zoom that fits `box` inside a `w × h` stage with {@link FIT_MARGIN} on every side. */
export function fitZoom(box: Box, w: number, h: number): number {
  if (box.w <= 0 || box.h <= 0) return 1
  const z = Math.min((w - 2 * FIT_MARGIN) / box.w, (h - 2 * FIT_MARGIN) / box.h)
  return clampZoom(z > 0 ? z : MIN_ZOOM)
}

export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}

/** Viewport (world origin at the stage's top-left, renderer convention) centring `box`. */
export function centeredView(box: Box, w: number, h: number, zoom: number): View {
  return {
    x: box.x + box.w / 2 - w / 2 / zoom,
    y: box.y + box.h / 2 - h / 2 / zoom,
    zoom,
  }
}

/** Zoom about a stage point (⌘-scroll / pinch): that world point stays under the pointer. */
export function zoomAbout(v: View, sx: number, sy: number, zoom: number): View {
  const z = clampZoom(zoom)
  const wx = v.x + sx / v.zoom
  const wy = v.y + sy / v.zoom
  return { x: wx - sx / z, y: wy - sy / z, zoom: z }
}

/** Zoom pill text: "Fit · 62 %" at fit, else "50 %" (rounded percent, thin space before %). */
export function zoomLabel(preset: ZoomPreset | null, zoom: number): string {
  const pct = `${Math.round(zoom * 100)} %`
  return preset === "fit" ? `Fit · ${pct}` : pct
}

export function presetLabel(p: ZoomPreset): string {
  return p === "fit" ? "Fit" : `${p * 100} %`
}

// --- Keys (rules "Navigate" / "Theme" / "Zoom" / "Exit") ----------------------------------------

export type PreviewKeyAction =
  | { kind: "exit" }
  | { kind: "step"; delta: -1 | 1 }
  | { kind: "zoom"; preset: ZoomPreset }
  | { kind: "toggleTheme" }

/**
 * The overlay's own keys (matched before every editor binding while Preview is open): Esc and
 * ⇧Space exit, ← → step, 0 fit, 1 100 %, T light/dark. Null = not a preview key.
 */
export function previewKey(e: {
  key: string
  code?: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}): PreviewKeyAction | null {
  const mod = e.metaKey || e.ctrlKey || e.altKey
  if (e.key === "Escape") return { kind: "exit" }
  if (mod) return null
  if (e.code === "Space" && e.shiftKey) return { kind: "exit" }
  if (e.shiftKey) return null
  switch (e.key) {
    case "ArrowLeft":
      return { kind: "step", delta: -1 }
    case "ArrowRight":
      return { kind: "step", delta: 1 }
    case "0":
      return { kind: "zoom", preset: "fit" }
    case "1":
      return { kind: "zoom", preset: 1 }
    case "t":
    case "T":
      return { kind: "toggleTheme" }
    default:
      return null
  }
}

/**
 * Rule "Exit": the selection to restore. Unchanged when no navigation happened; otherwise the
 * last previewed frame becomes the selection.
 */
export function exitSelection(
  before: readonly string[],
  last: string,
  navigated: boolean,
): readonly string[] {
  return navigated ? [last] : before
}
