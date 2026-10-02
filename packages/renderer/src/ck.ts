/**
 * Lazy CanvasKit loader (ADR 0009 "Where wasm comes from"). The browser entry passes a Vite
 * `?url` of `canvaskit.wasm`; headless (Bun/Node) resolves `bin/canvaskit.wasm` next to the
 * package's `canvaskit.js`. One instance per wasm URL is shared by every renderer.
 */
import type { CanvasKit } from "canvaskit-wasm"
import { RendererError } from "./types"

const cache = new Map<string, Promise<CanvasKit>>()

export const isBrowser = (): boolean =>
  typeof window !== "undefined" && typeof document !== "undefined"

/** File path of the headless wasm (Bun/Node). */
function headlessWasmPath(): string {
  const meta = import.meta as { resolve?: (s: string) => string }
  if (typeof meta.resolve !== "function")
    throw new RendererError(
      "WASM_LOAD_FAILED",
      "canvaskit-wasm: no wasm URL given and import.meta.resolve is unavailable",
    )
  const url = meta.resolve("canvaskit-wasm/bin/canvaskit.wasm")
  return url.startsWith("file:") ? decodeURIComponent(new URL(url).pathname) : url
}

async function readWasm(location: string): Promise<ArrayBuffer> {
  if (!isBrowser() && !/^[a-z]+:\/\//i.test(location)) {
    const spec = "node:fs/promises"
    const fs = (await import(/* @vite-ignore */ spec)) as typeof import("node:fs/promises")
    const buf = await fs.readFile(location)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }
  const res = await fetch(location)
  if (!res.ok) throw new Error(`GET ${location}: ${res.status}`)
  return await res.arrayBuffer()
}

/** Loads (once per URL) and returns CanvasKit. */
export function loadCanvasKit(wasmUrl?: string): Promise<CanvasKit> {
  const key = wasmUrl ?? "<headless>"
  let p = cache.get(key)
  if (!p) {
    p = (async () => {
      try {
        const location = wasmUrl ?? (isBrowser() ? undefined : headlessWasmPath())
        if (!location)
          throw new RendererError(
            "WASM_LOAD_FAILED",
            "canvaskit-wasm: in a browser pass `canvaskitWasmUrl` or import `@kimo/renderer/browser`",
          )
        // Fetch the bytes ourselves: a bad URL then fails cleanly here instead of aborting
        // inside the emscripten loader (which also leaves an unhandled rejection behind).
        const wasmBinary = await readWasm(location)
        const mod = (await import("canvaskit-wasm")) as unknown as {
          default: (opts: {
            locateFile: (file: string) => string
            wasmBinary: ArrayBuffer
          }) => Promise<CanvasKit>
        }
        return await mod.default({ locateFile: () => location, wasmBinary })
      } catch (e) {
        cache.delete(key)
        if (e instanceof RendererError) throw e
        throw new RendererError("WASM_LOAD_FAILED", `canvaskit-wasm failed to load: ${String(e)}`)
      }
    })()
    cache.set(key, p)
  }
  return p
}
