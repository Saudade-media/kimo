/**
 * Browser entry (ADR 0009): same API as `@kimo/renderer`, with the CanvasKit wasm URL taken
 * from a Vite `?url` import so it is emitted as a hashed asset and lazy-loaded on `init()`.
 */
import wasmUrl from "canvaskit-wasm/bin/canvaskit.wasm?url"
import { CanvasKitRenderer } from "./renderer"
import type { CreateRendererOptions, Renderer } from "./types"

export * from "./index"

/** URL of the bundled `canvaskit.wasm`. */
export const CANVASKIT_WASM_URL: string = wasmUrl

/** Creates the CanvasKit renderer with the bundled wasm URL as the default. */
export function createRenderer(options: CreateRendererOptions = {}): Renderer {
  return new CanvasKitRenderer(options, wasmUrl)
}
