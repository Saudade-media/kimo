/**
 * The app's font system (board 19 "Fonts"): one {@link FontSystem} per editor window, built on
 * `platform.fonts` + `platform.settings`. It feeds the canvas renderer (`fontSources`,
 * `offlineFonts`), the Missing fonts dialog and the font picker, in the resolution order
 * **Document → Local → Cache → Google** (`@kimo/renderer` `createPlatformFontSources`).
 *
 * Privacy (teardown 9.2, ADR 0012): Google Fonts are fetched only while
 * `googleFontsAllowed(settings)` and the browser is online; `fetchRemote` itself rejects with
 * `BLOCKED` otherwise. Fetched faces go to the content-addressed cache, so later opens render
 * offline with no request.
 */
import { googleFontsAllowed, type KimoPlatform, type SettingKey } from "@kimo/platform"
import {
  collectFontUsage,
  createPlatformFontSources,
  type DocumentFontFace,
  detectMissingFonts,
  type FontAvailability,
  type FontFaceKey,
  type FontUsage,
  type MissingFont,
  type NetworkFontSource,
  type PlatformFontSources,
} from "@kimo/renderer"

/** Settings that change what fonts resolve to. */
export const FONT_SETTING_KEYS: readonly SettingKey[] = [
  "privacy.noThirdPartyFetch",
  "fonts.google",
  "fonts.extraFolders",
]

export interface FontSystemOptions {
  platform: KimoPlatform
  /** Document font assets (read on every lookup). */
  documentFaces?: () => readonly DocumentFontFace[]
  /** A Google face was fetched and cached (store it as a document asset, spec §12 rule 3). */
  onRemoteFetched?: (face: FontFaceKey, bytes: Uint8Array) => void
  /** `navigator.onLine` by default. */
  online?: () => boolean
}

export interface FontSystem {
  /** Pass to the canvas as `fontSources` (stable array for the system's life). */
  readonly sources: readonly NetworkFontSource[]
  /** Pass to the canvas as `offlineFonts`: true while Google may not be fetched. */
  offline(): boolean
  googleAllowed(): boolean
  online(): boolean
  availability(key: FontFaceKey): Promise<FontAvailability>
  /** Families a document uses that no source provides (`collectFontUsage` + availability). */
  missingFonts(doc: Parameters<typeof collectFontUsage>[0]): Promise<MissingFont[]>
  usage(doc: Parameters<typeof collectFontUsage>[0]): FontUsage[]
  /** Fetches every weight of a Google family now (the Missing dialog's Fetch button). Resolves
   * false when fetching is not allowed or Google has no such family. */
  fetchFamily(family: string, weights: readonly number[]): Promise<boolean>
  knownGoogleFamilies(): Promise<Set<string>>
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
  // Network changes do not emit: "Not cached + offline renders the fallback … no layout
  // reflow on reconnect until the user reloads" (02d Font rules). Fetch / settings do.
  const google = inner.sources.find((s) => s.network) as NetworkFontSource

  return {
    sources: inner.sources,
    offline: () => !(googleAllowed() && online()),
    googleAllowed,
    online,
    availability: (key) => inner.availability(key),
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
      listeners.clear()
    },
  }
}
