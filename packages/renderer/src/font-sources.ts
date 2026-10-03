/**
 * Platform-backed font resolution (ADR 0012 "Fonts", board 19): **document assets → local
 * (installed) fonts → content-addressed cache → Google Fonts**, in that order. Google Fonts are
 * fetched only through the host (`platform.fonts.fetchRemote`, allowlisted to
 * `fonts.googleapis.com` / `fonts.gstatic.com`) and only while the policy allows it ("No
 * third-party fetch" off, Google Fonts on, online). Every fetched face is put in the cache, so the
 * next open renders with no network ("refetch-free offline rendering").
 *
 * The renderer does not depend on `@kimo/platform` (ADR 0012 §3 dependency rule): {@link FontHost}
 * is the structural subset of its `FontsApi` this module needs, and `platform.fonts` satisfies it.
 *
 * Also the missing-font detection used by the "Missing fonts" dialog: {@link collectFontUsage}
 * lists the families/weights a document uses and {@link detectMissingFonts} returns those no
 * source can provide (never fetching font files to decide).
 */
import { BUNDLED_FAMILIES, type NetworkFontSource, nearestFace, parseFontFaceCss } from "./fonts"
import type { FontFaceKey, FontSource, FontStyle } from "./types"

// --- Host contract (structural subset of @kimo/platform FontsApi) ----------------------------

export interface FontHostLocalStyle {
  postscriptName: string
  weight: number
  italic: boolean
}

export interface FontHostLocalFamily {
  family: string
  styles: readonly FontHostLocalStyle[]
}

export interface FontHostCacheEntry {
  key: string
  family: string
  weight: number
  italic: boolean
  source: "google" | "document" | "file"
}

export interface FontHost {
  listLocal(): Promise<readonly FontHostLocalFamily[]>
  loadLocal(postscriptName: string): Promise<Uint8Array>
  readonly cache: {
    get(key: string): Promise<Uint8Array | null>
    put(
      entry: {
        family: string
        weight: number
        italic: boolean
        source: FontHostCacheEntry["source"]
      },
      bytes: Uint8Array,
    ): Promise<FontHostCacheEntry>
    list(): Promise<readonly FontHostCacheEntry[]>
  }
  fetchRemote(url: string): Promise<Uint8Array>
}

/** When network font fetches are allowed. Read on every fetch, so settings apply live. */
export interface FontPolicy {
  /** `googleFontsAllowed(settings)`: Google Fonts on and "No third-party fetch" off. */
  googleAllowed(): boolean
  /** `navigator.onLine` in browsers; true when unknown. */
  online(): boolean
}

/** A face shipped with the document (`assets/<hash>.ttf`, …). */
export interface DocumentFontFace {
  family: string
  weight: number
  style: FontStyle
  /** Bytes of the asset, or null when it cannot be read. */
  load(): Promise<Uint8Array | null>
}

/** Where a face can come from, best first. */
export type FontAvailability =
  /** Shipped with the document. */
  | "document"
  /** Installed on this machine (or an extra font folder). */
  | "local"
  /** In the font cache (renders offline). */
  | "cached"
  /** Not cached, but Google Fonts serves it and may be fetched now. */
  | "google"
  /** A Google family that is not cached while fetching is blocked or offline ("Not cached"). */
  | "offline"
  /** No source has it: the canvas renders the fallback (Inter). */
  | "missing"
  /** Bundled with Kimo (Inter, JetBrains Mono). */
  | "bundled"

export interface PlatformFontSourcesOptions {
  host: FontHost
  policy: FontPolicy
  /** Document font assets, read on every lookup (the document can change). */
  documentFaces?: () => readonly DocumentFontFace[]
  /** Called after a Google face was fetched and cached (hosts store it as a document asset,
   * spec §12 rule 3). */
  onRemoteFetched?: (face: FontFaceKey, bytes: Uint8Array) => void
}

export interface PlatformFontSources {
  /** Ordered sources for `RendererInitOptions.fontSources`: document, local, cache, google. */
  readonly sources: readonly NetworkFontSource[]
  /** Best available source for a face without fetching font files. */
  availability(key: FontFaceKey): Promise<FontAvailability>
  /** Families (lowercase) known to be Google families (cached from Google, or listed by its CSS). */
  knownGoogleFamilies(): Promise<Set<string>>
  /** Drops memoized lists (local fonts after "Extra font folders" changes, cache after Clear). */
  invalidate(): void
}

const styleOf = (italic: boolean): FontStyle => (italic ? "italic" : "normal")
const lc = (s: string) => s.toLowerCase()

/** Google Fonts CSS2 URL for every face of a family. */
export function googleCssUrl(family: string): string {
  const fam = encodeURIComponent(family).replace(/%20/g, "+")
  return `https://fonts.googleapis.com/css2?family=${fam}:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900`
}

/** Builds the four sources and the availability probe over a platform font host. */
export function createPlatformFontSources(opts: PlatformFontSourcesOptions): PlatformFontSources {
  const { host, policy } = opts
  let local: Promise<readonly FontHostLocalFamily[]> | null = null
  let cache: Promise<readonly FontHostCacheEntry[]> | null = null
  const cssFaces = new Map<string, Promise<ReturnType<typeof parseFontFaceCss> | null>>()
  const googleKnown = new Set<string>()

  const localFamilies = () =>
    (local ??= host.listLocal().catch(() => [] as readonly FontHostLocalFamily[]))
  const cacheEntries = () =>
    (cache ??= host.cache.list().catch(() => [] as readonly FontHostCacheEntry[]))
  const networkAllowed = () => policy.googleAllowed() && policy.online()

  const docFace = (key: FontFaceKey) => {
    const faces = (opts.documentFaces?.() ?? []).filter((f) => lc(f.family) === lc(key.family))
    return nearestFace(faces, key.weight, key.style)
  }
  const localFace = async (key: FontFaceKey) => {
    const fam = (await localFamilies()).find((f) => lc(f.family) === lc(key.family))
    if (!fam) return undefined
    const faces = fam.styles.map((s) => ({ ...s, style: styleOf(s.italic) }))
    return nearestFace(faces, key.weight, key.style)
  }
  const cachedFace = async (key: FontFaceKey) => {
    const faces = (await cacheEntries())
      .filter((e) => lc(e.family) === lc(key.family))
      .map((e) => ({ ...e, style: styleOf(e.italic) }))
    return nearestFace(faces, key.weight, key.style)
  }
  /** The family's Google CSS faces; null when Google does not serve it (or the fetch failed). */
  const googleFaces = (family: string) => {
    const k = lc(family)
    let p = cssFaces.get(k)
    if (!p) {
      p = host.fetchRemote(googleCssUrl(family)).then(
        (bytes) => {
          const faces = parseFontFaceCss(new TextDecoder().decode(bytes))
          if (faces.length) googleKnown.add(k)
          return faces.length ? faces : null
        },
        () => {
          // BLOCKED / offline / unknown family: retried after invalidate() or a later call.
          cssFaces.delete(k)
          return null
        },
      )
      cssFaces.set(k, p)
    }
    return p
  }

  const documentSource: NetworkFontSource = {
    name: "document",
    async fetch(key) {
      const f = docFace(key)
      if (!f) return null
      const bytes = await f.load()
      return bytes ? { bytes, weight: f.weight, style: f.style } : null
    },
  }
  const localSource: NetworkFontSource = {
    name: "local",
    async fetch(key) {
      const f = await localFace(key)
      if (!f) return null
      return { bytes: await host.loadLocal(f.postscriptName), weight: f.weight, style: f.style }
    },
  }
  const cacheSource: NetworkFontSource = {
    name: "cache",
    async fetch(key) {
      const f = await cachedFace(key)
      if (!f) return null
      const bytes = await host.cache.get(f.key)
      return bytes ? { bytes, weight: f.weight, style: f.style } : null
    },
  }
  const googleSource: NetworkFontSource = {
    name: "google-fonts",
    network: true,
    async fetch(key) {
      if (!networkAllowed()) return null
      const faces = await googleFaces(key.family)
      if (!faces) return null
      const best = nearestFace(faces, key.weight, key.style)
      if (!best) return null
      const same = faces.filter((f) => f.weight === best.weight && f.style === best.style)
      const pick = same.find((f) => f.subset === "latin") ?? same[same.length - 1] ?? best
      // Allowlist enforced here too (the host enforces it again).
      if (!/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(pick.url)) return null
      const bytes = await host.fetchRemote(pick.url)
      const face: FontFaceKey = { family: key.family, weight: pick.weight, style: pick.style }
      try {
        await host.cache.put(
          {
            family: key.family,
            weight: pick.weight,
            italic: pick.style === "italic",
            source: "google",
          },
          bytes,
        )
        cache = null
      } catch {
        // A full or unavailable cache only costs a refetch next time.
      }
      opts.onRemoteFetched?.(face, bytes)
      return { bytes, weight: pick.weight, style: pick.style }
    },
  }

  return {
    sources: [documentSource, localSource, cacheSource, googleSource],
    async availability(key) {
      if (BUNDLED_FAMILIES.has(lc(key.family))) return "bundled"
      if (docFace(key)) return "document"
      if (await localFace(key)) return "local"
      if (await cachedFace(key)) return "cached"
      if (networkAllowed()) return (await googleFaces(key.family)) ? "google" : "missing"
      return (await this.knownGoogleFamilies()).has(lc(key.family)) ? "offline" : "missing"
    },
    async knownGoogleFamilies() {
      const out = new Set(googleKnown)
      for (const e of await cacheEntries()) if (e.source === "google") out.add(lc(e.family))
      return out
    },
    invalidate() {
      local = null
      cache = null
      cssFaces.clear()
    },
  }
}

// --- Missing-font detection --------------------------------------------------------------------

/** One family used by a document. */
export interface FontUsage {
  family: string
  /** Distinct weights used, ascending. */
  weights: number[]
  italic: boolean
  /** Layers (node ids) using the family. */
  nodeIds: string[]
}

export interface MissingFont extends FontUsage {
  /** `missing` (FontRow/Missing) or `offline` (FontRow/Offline: a Google family not cached). */
  status: "missing" | "offline"
  /** Weights no source provides (subset of `weights`). */
  missingWeights: number[]
}

type Json = unknown
interface Ref {
  $ref: string
}
const isRef = (v: Json): v is Ref =>
  !!v && typeof v === "object" && typeof (v as Ref).$ref === "string"

/** A plain string variable value (first themed entry), else undefined. */
function resolveString(v: Json, vars: Record<string, Json>, depth = 0): string | undefined {
  if (typeof v === "string") return v
  if (!isRef(v) || depth > 8) return undefined
  const variable = vars[v.$ref] as { value?: Json } | undefined
  let value = variable?.value
  if (Array.isArray(value)) value = (value[0] as { value?: Json } | undefined)?.value
  return resolveString(value, vars, depth + 1)
}

function resolveNumber(v: Json, vars: Record<string, Json>, depth = 0): number | undefined {
  if (typeof v === "number") return v
  if (!isRef(v) || depth > 8) return undefined
  let value = (vars[v.$ref] as { value?: Json } | undefined)?.value
  if (Array.isArray(value)) value = (value[0] as { value?: Json } | undefined)?.value
  return resolveNumber(value, vars, depth + 1)
}

/**
 * Families, weights and layers a document uses: every TextStyle-like object (node `style`, text
 * spans, instance overrides, typography variables bound through `style.typography`) with a
 * `font`. A style without `font` uses the reader default (Inter, bundled) and is not listed.
 * `doc` is a `.kimo` document (`{ nodes, variables }`); unknown shapes are ignored.
 */
export function collectFontUsage(doc: {
  nodes?: Record<string, Json>
  variables?: Record<string, Json>
}): FontUsage[] {
  const vars = (doc.variables ?? {}) as Record<string, Json>
  const byFamily = new Map<
    string,
    { family: string; weights: Set<number>; italic: boolean; ids: Set<string> }
  >()
  const visitStyle = (s: Record<string, Json>, nodeId: string) => {
    let font = s.font !== undefined ? resolveString(s.font, vars) : undefined
    let weight = s.weight !== undefined ? resolveNumber(s.weight, vars) : undefined
    if (isRef(s.typography)) {
      let t = (vars[s.typography.$ref] as { value?: Json } | undefined)?.value
      if (Array.isArray(t)) t = (t[0] as { value?: Json } | undefined)?.value
      if (t && typeof t === "object" && !isRef(t)) {
        const tv = t as Record<string, Json>
        font ??= resolveString(tv.font ?? tv.fontFamily, vars)
        weight ??= resolveNumber(tv.weight ?? tv.fontWeight, vars)
      }
    }
    if (!font) return
    const k = lc(font)
    const e = byFamily.get(k) ?? { family: font, weights: new Set(), italic: false, ids: new Set() }
    e.weights.add(Math.round(weight ?? 400))
    if (s.italic === true) e.italic = true
    e.ids.add(nodeId)
    byFamily.set(k, e)
  }
  const walk = (v: Json, nodeId: string, depth: number) => {
    if (depth > 12 || !v || typeof v !== "object") return
    if (Array.isArray(v)) {
      for (const x of v) walk(x, nodeId, depth + 1)
      return
    }
    const o = v as Record<string, Json>
    if ("font" in o || "typography" in o) visitStyle(o, nodeId)
    for (const [k, x] of Object.entries(o)) if (k !== "font") walk(x, nodeId, depth + 1)
  }
  for (const [id, node] of Object.entries(doc.nodes ?? {})) walk(node, id, 0)
  return [...byFamily.values()]
    .map((e) => ({
      family: e.family,
      weights: [...e.weights].sort((a, b) => a - b),
      italic: e.italic,
      nodeIds: [...e.ids].sort(),
    }))
    .sort((a, b) => b.nodeIds.length - a.nodeIds.length || a.family.localeCompare(b.family))
}

/**
 * Families used by the document that no source can provide, most-used first. A family counts
 * as missing when at least one used weight resolves to `missing` / `offline` (nearest-weight
 * matching inside a family counts as available, as on the canvas).
 */
export async function detectMissingFonts(
  usage: readonly FontUsage[],
  availability: (key: FontFaceKey) => Promise<FontAvailability>,
): Promise<MissingFont[]> {
  const out: MissingFont[] = []
  for (const u of usage) {
    const missingWeights: number[] = []
    let status: MissingFont["status"] | null = null
    for (const weight of u.weights) {
      const a = await availability({ family: u.family, weight, style: "normal" })
      if (a === "missing" || a === "offline") {
        missingWeights.push(weight)
        if (status !== "missing") status = a
      }
    }
    if (status) out.push({ ...u, status, missingWeights })
  }
  return out
}

export type { FontSource }
