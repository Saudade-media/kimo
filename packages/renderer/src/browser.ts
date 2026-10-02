/**
 * Browser entry (ADR 0009, ADR 0010): same API as `@kimo/renderer`, with the CanvasKit wasm
 * URL taken from a Vite `?url` import so it is emitted as a hashed asset and lazy-loaded on
 * `init()`, and the icon packs (`assets/icons/<pack>/<n>.json`, built by
 * `bun run --filter @kimo/renderer icons`) emitted as assets fetched one shard at a time.
 * Only the URL table is in the bundle; without built packs every icon draws as missing.
 */
import wasmUrl from "canvaskit-wasm/bin/canvaskit.wasm?url"
import { packIconSource, SourceIconProvider } from "./icons/provider"
import { CanvasKitRenderer } from "./renderer"
import type { CreateRendererOptions, IconProvider, Renderer } from "./types"

export * from "./index"

/** URL of the bundled `canvaskit.wasm`. */
export const CANVASKIT_WASM_URL: string = wasmUrl

const PACK_PREFIX = "../assets/icons/"
const packUrls: Record<string, string> = Object.fromEntries(
  Object.entries(
    // The licence files ride along with the shards (same map), so they are always emitted.
    import.meta.glob<string>(["../assets/icons/*/*.json", "../assets/icons/*/LICENSE.txt"], {
      query: "?url",
      import: "default",
      eager: true,
    }),
  ).map(([path, url]) => [path.slice(PACK_PREFIX.length), url]),
)

/**
 * The icon sets' licence files (`<pack>/LICENSE.txt`), emitted next to the shards they cover
 * (ISC/MIT require the notice in copies; Apache-2.0 §4 a copy of the licence). Keyed by pack.
 */
export const ICON_LICENSE_URLS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(packUrls)
    .filter(([rel]) => rel.endsWith("/LICENSE.txt"))
    .map(([rel, url]) => [rel.split("/")[0] as string, url]),
)

/** The browser icon provider over the bundled packs (shared by every renderer). */
let shared: IconProvider | null = null
export function browserIconProvider(): IconProvider {
  shared ??= new SourceIconProvider(packIconSource(packUrls))
  return shared
}

/** Creates the CanvasKit renderer with the bundled wasm URL and icon packs as defaults. */
export function createRenderer(options: CreateRendererOptions = {}): Renderer {
  return new CanvasKitRenderer(options, wasmUrl, browserIconProvider)
}
