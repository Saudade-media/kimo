/**
 * The app's font system (board 19 "Fonts"): one {@link FontSystem} per editor window, built on
 * `platform.fonts` + `platform.settings`. It feeds the canvas renderer (`fontSources`,
 * `offlineFonts`), the Missing fonts dialog and the font picker, in the resolution order
 * **Document → Local → Pack → Cache → Google** (`@kimo/renderer` `createPlatformFontSources`).
 *
 * Privacy (teardown 9.2, ADR 0012): Google Fonts are fetched only while
 * `googleFontsAllowed(settings)` and the browser is online; `fetchRemote` itself rejects with
 * `BLOCKED` otherwise. Fetched faces go to the content-addressed cache, so later opens render
 * offline with no request.
 */

import { googleFontsAllowed, type KimoPlatform, type SettingKey } from "@kimo/platform"
import {
  BUNDLED_FAMILIES,
  collectFontUsage,
  createPlatformFontSources,
  type DocumentFontFace,
  detectMissingFonts,
  type FontAvailability,
  type FontFaceKey,
  type FontUsage,
  fontFamilyKey,
  type MissingFont,
  type NetworkFontSource,
  type PlatformFontSources,
} from "@kimo/renderer"
import { fontFeatureTags } from "./font-features"
import { fontPackController } from "./font-pack"

/** Settings that change what fonts resolve to. */
const FONT_SETTING_KEYS: readonly SettingKey[] = [
  "privacy.noThirdPartyFetch",
  "fonts.google",
  "fonts.extraFolders",
]

/** Every window's font systems hear "the font cache was cleared" on this channel. */
const FONT_CHANNEL = "kimo-fonts"

/**
 * Settings › Fonts & privacy › Clear: tells every open editor (this window and the others,
 * including from the desktop Settings window) to re-resolve its fonts.
 */
export function announceFontCacheCleared(): void {
  try {
    const ch = new BroadcastChannel(FONT_CHANNEL)
    ch.postMessage("cache-cleared")
    ch.close()
  } catch {
    // No BroadcastChannel: open editors pick the change up on their next font lookup.
  }
}

interface FontSystemOptions {
  platform: KimoPlatform
  /** Document font assets (read on every lookup). */
  documentFaces?: () => readonly DocumentFontFace[]
  /** A Google face was fetched and cached (store it as a document asset, spec §12 rule 3). */
  onRemoteFetched?: (face: FontFaceKey, bytes: Uint8Array) => void
  /** `navigator.onLine` by default. */
  online?: () => boolean
  /**
   * Board 25 §6 (d): the font file the canvas renders (family, weight, style) with — the
   * renderer's `FontProvider.faceBytes` — or null when it is not registered (fallback used).
   */
  faceBytes?: (key: FontFaceKey) => Uint8Array | null
}

export interface FontSystem {
  /** Pass to the canvas as `fontSources` (stable array for the system's life). */
  readonly sources: readonly NetworkFontSource[]
  /** Pass to the canvas as `offlineFonts`: true while Google may not be fetched. */
  offline(): boolean
  googleAllowed(): boolean
  online(): boolean
  availability(key: FontFaceKey): Promise<FontAvailability>
  /**
   * Board 24 (k): the upright weights a family really ships (document → local → cache), or null
   * when every weight is available (bundled families, or Google reachable for a Google family).
   * `availability` matches the nearest face, so it cannot tell a missing weight apart.
   */
  shippedWeights(family: string): Promise<Set<number> | null>
  /** Families a document uses that no source provides (`collectFontUsage` + availability). */
  missingFonts(doc: Parameters<typeof collectFontUsage>[0]): Promise<MissingFont[]>
  usage(doc: Parameters<typeof collectFontUsage>[0]): FontUsage[]
  /** Fetches every weight of a Google family now (the Missing dialog's Fetch button). Resolves
   * false when fetching is not allowed or Google has no such family. */
  fetchFamily(family: string, weights: readonly number[]): Promise<boolean>
  knownGoogleFamilies(): Promise<Set<string>>
  /**
   * Board 25 §6 (d) rule v0gB4 `font.features.has(tag)`: the OpenType feature tags (GSUB ∪
   * GPOS) of the resolved face, or null when it can't be inspected (not loaded yet, fallback
   * font, WOFF 2) — the UI then shows no font-support hint.
   */
  features(key: FontFaceKey): Promise<ReadonlySet<string> | null>
  /** Forget memoized lists (after Clear cache, Add folder…, a new document font). */
  invalidate(): void
  /** Fires when fonts may resolve differently (font settings, a fetch, invalidate). Not on
   * reconnect: no reflow until reload (02d Font rules). */
  subscribe(listener: () => void): () => void
  dispose(): void
}

const defaultOnline = () =>
  typeof navigator === "undefined" || typeof navigator.onLine !== "boolean"
    ? true
    : navigator.onLine

export function createFontSystem(options: FontSystemOptions): FontSystem {
  const { platform } = options
  const online = options.online ?? defaultOnline
  const googleAllowed = () =>
    platform.capabilities.remoteFonts && googleFontsAllowed(platform.settings.all())
  const inner: PlatformFontSources = createPlatformFontSources({
    host: platform.fonts,
    policy: { googleAllowed, online },
    ...(options.documentFaces ? { documentFaces: options.documentFaces } : {}),
    ...(options.onRemoteFetched ? { onRemoteFetched: options.onRemoteFetched } : {}),
  })
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const l of [...listeners]) l()
  }
  const offSettings = platform.settings.onChange((key) => {
    if (!FONT_SETTING_KEYS.includes(key)) return
    inner.invalidate()
    emit()
  })
  // Board 28: the offline font pack finished downloading or was removed (the first read of
  // the pack is not a change).
  const pack = fontPackController(platform)
  const packFaces = (st: ReturnType<typeof pack.state>) =>
    st.status === "ready" ? st.faces : st.status === "error" ? st.faces : 0
  let lastPack: number | null = pack.state().status === "loading" ? null : packFaces(pack.state())
  const offPack = pack.subscribe((st) => {
    if (st.status === "downloading" || st.status === "loading") return
    const n = packFaces(st)
    const first = lastPack === null
    if (n === lastPack) return
    lastPack = n
    if (first) return
    inner.invalidate()
    emit()
  })
  // The font cache was cleared (Settings, any window): faces resolve again.
  let channel: BroadcastChannel | null = null
  try {
    channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(FONT_CHANNEL) : null
    if (channel)
      channel.onmessage = (e: MessageEvent) => {
        if (e.data !== "cache-cleared") return
        inner.invalidate()
        emit()
      }
  } catch {
    channel = null
  }
  // Network changes do not emit: "Not cached + offline renders the fallback … no layout
  // reflow on reconnect until the user reloads" (02d Font rules). Fetch / settings do.
  const google = inner.sources.find((s) => s.network) as NetworkFontSource

  return {
    sources: inner.sources,
    offline: () => !(googleAllowed() && online()),
    googleAllowed,
    online,
    availability: (key) => inner.availability(key),
    async shippedWeights(family) {
      const f = family.toLowerCase()
      if (BUNDLED_FAMILIES.has(f)) return null
      const out = new Set<number>()
      const k = fontFamilyKey(family)
      for (const d of options.documentFaces?.() ?? [])
        if (fontFamilyKey(d.family) === k && d.style !== "italic") out.add(d.weight)
      const local = await platform.fonts.listLocal().catch(() => [])
      for (const fam of local)
        if (fam.family.toLowerCase() === f)
          for (const st of fam.styles) if (!st.italic) out.add(st.weight)
      const cached = await platform.fonts.cache.list().catch(() => [])
      for (const e of cached) if (e.family.toLowerCase() === f && !e.italic) out.add(e.weight)
      const packed = await (platform.fonts.pack?.list() ?? Promise.resolve([])).catch(() => [])
      for (const e of packed) if (e.family.toLowerCase() === f && !e.italic) out.add(e.weight)
      if (
        googleAllowed() &&
        online() &&
        (await inner.availability({ family, weight: 400, style: "normal" })) === "google"
      )
        return null
      return out.size > 0 ? out : null
    },
    usage: (doc) => collectFontUsage(doc),
    missingFonts: (doc) => detectMissingFonts(collectFontUsage(doc), (k) => inner.availability(k)),
    async fetchFamily(family, weights) {
      if (!(googleAllowed() && online())) return false
      let any = false
      for (const weight of weights.length ? weights : [400]) {
        try {
          if (await google.fetch({ family, weight, style: "normal" })) any = true
        } catch {
          // A failing face does not stop the others.
        }
      }
      if (any) {
        inner.invalidate()
        emit()
      }
      return any
    },
    knownGoogleFamilies: () => inner.knownGoogleFamilies(),
    async features(key) {
      const bytes = options.faceBytes?.(key) ?? null
      return bytes ? fontFeatureTags(bytes) : null
    },
    invalidate() {
      inner.invalidate()
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      offSettings()
      offPack()
      channel?.close()
      listeners.clear()
    },
  }
}
