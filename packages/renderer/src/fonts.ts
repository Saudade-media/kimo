/**
 * Fonts (ADR 0009 "Fonts"): bundled Inter + JetBrains Mono, then `FontSource`s in order
 * (persistent cache, Google Fonts), with nearest-weight matching and a load event so hosts
 * re-lay-out text measured with the fallback.
 */
import type { CanvasKit, TypefaceFontProvider } from "canvaskit-wasm"
import type { FontFaceKey, FontLoadResult, FontProvider, FontSource, FontStyle } from "./types"

export const FALLBACK_FAMILY = "Inter"

/** Bundled faces (OFL-1.1, see assets/fonts/README.md). Literal URLs so Vite emits assets. */
function bundledFaces(): { url: URL; key: FontFaceKey }[] {
  const inter = (weight: number, style: FontStyle, url: URL) => ({
    url,
    key: { family: "Inter", weight, style },
  })
  const mono = (weight: number, url: URL) => ({
    url,
    key: { family: "JetBrains Mono", weight, style: "normal" as const },
  })
  return [
    inter(400, "normal", new URL("../assets/fonts/Inter-Regular.ttf", import.meta.url)),
    inter(500, "normal", new URL("../assets/fonts/Inter-Medium.ttf", import.meta.url)),
    inter(600, "normal", new URL("../assets/fonts/Inter-SemiBold.ttf", import.meta.url)),
    inter(700, "normal", new URL("../assets/fonts/Inter-Bold.ttf", import.meta.url)),
    inter(400, "italic", new URL("../assets/fonts/Inter-Italic.ttf", import.meta.url)),
    mono(400, new URL("../assets/fonts/JetBrainsMono-Regular.ttf", import.meta.url)),
    mono(500, new URL("../assets/fonts/JetBrainsMono-Medium.ttf", import.meta.url)),
  ]
}

export const BUNDLED_FAMILIES: ReadonlySet<string> = new Set(["inter", "jetbrains mono"])

/** Reads a URL: `file:` through node:fs (Bun/Node), anything else through fetch. */
export async function readUrl(url: URL): Promise<Uint8Array> {
  if (url.protocol === "file:") {
    const spec = "node:fs/promises"
    const fs = (await import(/* @vite-ignore */ spec)) as typeof import("node:fs/promises")
    return new Uint8Array(await fs.readFile(decodeURIComponent(url.pathname)))
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url.href}: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Nearest face by CSS-ish matching: same style first, then smallest weight distance. */
export function nearestFace<T extends { weight: number; style: FontStyle }>(
  faces: readonly T[],
  weight: number,
  style: FontStyle,
): T | undefined {
  let best: T | undefined
  let bestScore = Number.POSITIVE_INFINITY
  for (const f of faces) {
    const score = (f.style === style ? 0 : 10_000) + Math.abs(f.weight - weight)
    if (score < bestScore) {
      best = f
      bestScore = score
    }
  }
  return best
}

/** Sources that hit the network are skipped when `offlineFonts` is set. */
export interface NetworkFontSource extends FontSource {
  readonly network?: boolean
}

const faceId = (k: FontFaceKey) => `${k.family.toLowerCase()}|${k.weight}|${k.style}`

/** CanvasKit `TypefaceFontProvider`-backed {@link FontProvider}. */
export class CkFontProvider implements FontProvider {
  readonly fallbackFamily = FALLBACK_FAMILY
  readonly provider: TypefaceFontProvider
  /** Bumped on every registration (paragraph caches key on it). */
  generation = 0
  private readonly faces = new Map<string, { weight: number; style: FontStyle }[]>()
  private readonly pending = new Map<string, Promise<FontLoadResult>>()
  private readonly missing = new Set<string>()
  private readonly served = new Set<string>()
  private readonly listeners = new Set<(key: FontFaceKey) => void>()
  sources: readonly NetworkFontSource[] = []
  offline = false

  constructor(ck: CanvasKit) {
    this.provider = ck.TypefaceFontProvider.Make()
  }

  /** Loads every bundled face (called by `Renderer.init`). */
  async loadBundled(): Promise<void> {
    const faces = bundledFaces()
    const bytes = await Promise.all(faces.map((f) => readUrl(f.url)))
    for (const [i, f] of faces.entries()) this.register(bytes[i] as Uint8Array, f.key, false)
  }

  register(bytes: Uint8Array, key: FontFaceKey, notify = true): void {
    // Copy into a standalone ArrayBuffer (registerFont copies into wasm memory).
    const buf = bytes.slice().buffer
    this.provider.registerFont(buf, key.family)
    const fam = key.family.toLowerCase()
    const list = this.faces.get(fam) ?? []
    if (!list.some((f) => f.weight === key.weight && f.style === key.style))
      list.push({ weight: key.weight, style: key.style })
    this.faces.set(fam, list)
    this.missing.delete(fam)
    this.generation++
    if (notify) for (const l of this.listeners) l(key)
  }

  has(family: string, weight: number, style: FontStyle): boolean {
    const list = this.faces.get(family.toLowerCase())
    if (!list?.length) return false
    // Bundled families never fetch more faces: nearest registered weight is "available".
    if (BUNDLED_FAMILIES.has(family.toLowerCase())) return true
    return (
      list.some((f) => f.weight === weight && f.style === style) ||
      this.served.has(faceId({ family, weight, style }))
    )
  }

  /** Families/faces known missing (no source had them): don't retry. */
  isMissing(family: string): boolean {
    return this.missing.has(family.toLowerCase())
  }

  private resolvedFace(family: string, weight: number, style: FontStyle): FontFaceKey {
    const list = this.faces.get(family.toLowerCase())
    const f = list && nearestFace(list, weight, style)
    if (f) return { family, weight: f.weight, style: f.style }
    const fb = nearestFace(this.faces.get(FALLBACK_FAMILY.toLowerCase()) ?? [], weight, style)
    return { family: FALLBACK_FAMILY, weight: fb?.weight ?? 400, style: fb?.style ?? "normal" }
  }

  ensureFont(family: string, weight: number, style: FontStyle): Promise<FontLoadResult> {
    const key: FontFaceKey = { family, weight, style }
    if (this.has(family, weight, style))
      return Promise.resolve({
        key,
        loaded: true,
        resolved: this.resolvedFace(family, weight, style),
      })
    if (this.missing.has(family.toLowerCase()))
      return Promise.resolve({
        key,
        loaded: false,
        resolved: this.resolvedFace(family, weight, style),
      })
    const id = faceId(key)
    let p = this.pending.get(id)
    if (!p) {
      p = this.fetchFace(key).finally(() => this.pending.delete(id))
      this.pending.set(id, p)
    }
    return p
  }

  private async fetchFace(key: FontFaceKey): Promise<FontLoadResult> {
    for (const src of this.sources) {
      if (this.offline && src.network) continue
      try {
        const r = await src.fetch(key)
        if (!r) continue
        const got: FontFaceKey = { family: key.family, weight: r.weight, style: r.style }
        // Another request may have registered the same nearest face meanwhile.
        if (
          !this.faces
            .get(key.family.toLowerCase())
            ?.some((f) => f.weight === r.weight && f.style === r.style)
        )
          this.register(r.bytes, got)
        // The nearest face serves the requested one: `has()` stops refetching it.
        this.served.add(faceId(key))
        return { key, loaded: true, resolved: got, source: src.name }
      } catch {
        // A failing source is skipped; the next one is tried.
      }
    }
    if (!this.faces.has(key.family.toLowerCase())) this.missing.add(key.family.toLowerCase())
    return { key, loaded: false, resolved: this.resolvedFace(key.family, key.weight, key.style) }
  }

  onFontLoaded(listener: (key: FontFaceKey) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.listeners.clear()
    this.provider.delete()
  }
}

// --- Google Fonts -------------------------------------------------------------------------

const ALL_FACES =
  "ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900"

interface CssFace {
  weight: number
  style: FontStyle
  url: string
  subset: string | null
}

/** Parses the `@font-face` blocks of a CSS2 API response. */
export function parseFontFaceCss(css: string): CssFace[] {
  const out: CssFace[] = []
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const body = m[2] ?? ""
    const weight = Number(/font-weight:\s*(\d+)/.exec(body)?.[1] ?? 400)
    const style: FontStyle = /font-style:\s*italic/.test(body) ? "italic" : "normal"
    const url = /src:\s*url\(([^)]+)\)/.exec(body)?.[1]
    if (url) out.push({ weight, style, url: url.replace(/^['"]|['"]$/g, ""), subset: m[1] ?? null })
  }
  return out
}

/**
 * Font source that fetches static TTFs from the Google Fonts CSS2 API (ADR 0009). Outside
 * browsers the API returns one full TTF per face; in browsers it returns `unicode-range`
 * WOFF2 subsets, of which the `latin` subset is used (M1 limitation).
 */
export function createGoogleFontsSource(options: { fetch?: typeof fetch } = {}): NetworkFontSource {
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const cssCache = new Map<string, Promise<CssFace[]>>()
  const css = (family: string) => {
    let p = cssCache.get(family)
    if (!p) {
      p = (async () => {
        const fam = encodeURIComponent(family).replace(/%20/g, "+")
        const base = "https://fonts.googleapis.com/css2?family="
        let res = await doFetch(`${base}${fam}:${ALL_FACES}`)
        if (!res.ok) res = await doFetch(`${base}${fam}`)
        if (!res.ok) return []
        return parseFontFaceCss(await res.text())
      })().catch(() => {
        cssCache.delete(family)
        return [] as CssFace[]
      })
      cssCache.set(family, p)
    }
    return p
  }
  return {
    name: "google-fonts",
    network: true,
    async fetch(key) {
      const faces = await css(key.family)
      if (!faces.length) return null
      const same = (f: CssFace) => (a: CssFace) => a.weight === f.weight && a.style === f.style
      const best = nearestFace(faces, key.weight, key.style)
      if (!best) return null
      const variants = faces.filter(same(best))
      const pick =
        variants.find((f) => f.subset === "latin") ?? variants[variants.length - 1] ?? best
      const res = await doFetch(pick.url)
      if (!res.ok) return null
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        weight: pick.weight,
        style: pick.style,
      }
    },
  }
}
