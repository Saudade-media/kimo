/**
 * Lazily builds the "Outline strokes" outliner over the renderer's CanvasKit (same bundled wasm
 * URL as the canvas, so the instance is already loaded and shared). Browser only.
 */
import type { StrokeOutliner } from "./convert"
import { createStrokeOutliner } from "./outline"

let pending: Promise<StrokeOutliner> | null = null

export function loadStrokeOutliner(): Promise<StrokeOutliner> {
  pending ??= (async () => {
    const { CANVASKIT_WASM_URL, loadCanvasKit } = await import("@kimo/renderer/browser")
    return createStrokeOutliner(await loadCanvasKit(CANVASKIT_WASM_URL))
  })().catch((e: unknown) => {
    pending = null
    throw e
  })
  return pending
}
