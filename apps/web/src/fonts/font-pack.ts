/**
 * Offline font pack (board 28 "Offline font pack", teardown 9.2 "Fonts"): a small curated set of
 * Google families downloaded once, on request, into `platform.fonts.pack` (desktop: the app data
 * dir `font-pack/`; browser: Cache Storage `kimo-font-pack`), so they render with no network.
 *
 * - Curated list {@link FONT_PACK_FAMILIES} (documented in docs/guide/editor/fonts.md): 16
 *   popular families, upright weights {@link FONT_PACK_WEIGHTS}, the `latin` subset where Google
 *   splits by subset (browsers get WOFF2 subsets, the desktop full TTFs).
 * - Downloads go through `platform.fonts.fetchRemote` only, so "No third-party fetch" (or Google
 *   Fonts off) blocks them; a pack already downloaded keeps working.
 * - Cancel keeps the faces that arrived (Download resumes: faces already in the pack are
 *   skipped). Remove deletes the pack only, never the font cache.
 *
 * One controller per platform ({@link fontPackController}): the Settings pane and every font
 * system share its state; other windows hear changes through a BroadcastChannel.
 */
import { type FontsApi, googleFontsAllowed, type KimoPlatform } from "@kimo/platform"
import { googleCssUrl } from "@kimo/renderer"

/** The curated families (kept small; Inter and JetBrains Mono are bundled with Kimo). */
export const FONT_PACK_FAMILIES: readonly string[] = [
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Raleway",
  "Nunito",
  "Work Sans",
  "DM Sans",
  "IBM Plex Sans",
  "Space Grotesk",
  "Fira Sans",
  "Playfair Display",
  "Lora",
  "Source Serif 4",
  "Roboto Mono",
]

/** Upright weights per family (nearest-weight matching covers the others). */
export const FONT_PACK_WEIGHTS: readonly number[] = [400, 500, 600, 700]

/**
 * Measured pack size before downloading (2026-10, all 62 faces): desktop TTFs 8.3 MB, browser
 * latin WOFF2 subsets 2.1 MB. Shown as the row's value until the pack exists.
 */
export const FONT_PACK_ESTIMATE_BYTES = { desktop: 8_300_000, web: 2_100_000 } as const

export type FontPackState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "downloading"; done: number; total: number; bytes: number }
  | { status: "ready"; faces: number; families: number; bytes: number; dir: string | null }
  | { status: "error"; message: string; faces: number; bytes: number }

export interface FontPackController {
  state(): FontPackState
  subscribe(listener: (s: FontPackState) => void): () => void
  /** Estimated full size on this host (bytes). */
  estimate(): number
  /** Downloading is allowed by the settings (Google on, No third-party fetch off). */
  allowed(): boolean
  download(): Promise<void>
  cancel(): void
  remove(): Promise<void>
  /** Re-reads the pack (another window changed it). */
  refresh(): Promise<void>
}

/** One face of the pack plan. */
export interface PackFace {
  family: string
  weight: number
  url: string
}

const ALLOW = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//

/** Parses a CSS2 response into the pack's faces of one family (upright, latin preferred). */
export function packFacesFromCss(family: string, css: string): PackFace[] {
  const blocks = [...css.matchAll(/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g)]
  const byWeight = new Map<number, { url: string; subset: string | null }>()
  for (const m of blocks) {
    const body = m[2] ?? ""
    if (/font-style:\s*italic/.test(body)) continue
    const weight = Number(/font-weight:\s*(\d+)/.exec(body)?.[1] ?? 400)
    if (!FONT_PACK_WEIGHTS.includes(weight)) continue
    const url = /src:\s*url\(([^)]+)\)/.exec(body)?.[1]?.replace(/^['"]|['"]$/g, "")
    if (!url || !ALLOW.test(url)) continue
    const subset = m[1] ?? null
    const prev = byWeight.get(weight)
    // The latin subset wins; without subsets (desktop TTF) the single file is the face.
    if (!prev || (subset === "latin" && prev.subset !== "latin"))
      byWeight.set(weight, { url, subset })
  }
  return [...byWeight.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weight, f]) => ({ family, weight, url: f.url }))
}

const CHANNEL = "kimo-font-pack"
const controllers = new WeakMap<KimoPlatform, FontPackController>()

/** The pack controller of `platform` (created once). */
export function fontPackController(platform: KimoPlatform): FontPackController {
  let c = controllers.get(platform)
  if (!c) {
    c = createController(platform)
    controllers.set(platform, c)
  }
  return c
}

function createController(platform: KimoPlatform): FontPackController {
  let state: FontPackState = { status: "loading" }
  const listeners = new Set<(s: FontPackState) => void>()
  let abort: AbortController | null = null
  const set = (s: FontPackState) => {
    state = s
    for (const l of [...listeners]) l(s)
  }
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL)
  const announce = () => channel?.postMessage("changed")

  // Hosts (and test fakes) without a pack read as empty.
  const store = (): FontsApi["pack"] | undefined => (platform.fonts as Partial<FontsApi>).pack
  const read = async (): Promise<FontPackState> => {
    const list =
      (await store()
        ?.list()
        .catch(() => [])) ?? []
    if (!list.length) return { status: "empty" }
    const stats =
      (await store()
        ?.stats()
        .catch(() => null)) ?? null
    return {
      status: "ready",
      faces: list.length,
      families: new Set(list.map((e) => e.family.toLowerCase())).size,
      bytes: list.reduce((s, e) => s + e.bytes, 0),
      dir: stats?.dir ?? null,
    }
  }
  const refresh = async () => {
    if (state.status === "downloading") return
    set(await read())
  }
  if (channel) channel.onmessage = () => void refresh()
  void refresh()

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    estimate: () =>
      platform.os === "web" ? FONT_PACK_ESTIMATE_BYTES.web : FONT_PACK_ESTIMATE_BYTES.desktop,
    allowed: () => platform.capabilities.remoteFonts && googleFontsAllowed(platform.settings.all()),
    refresh,
    cancel() {
      abort?.abort()
    },
    async remove() {
      abort?.abort()
      // A failed clear keeps the "ready" state and rethrows, so the row can say why.
      await store()?.clear()
      set({ status: "empty" })
      announce()
    },
    async download() {
      if (state.status === "downloading") return
      const ctl = new AbortController()
      abort = ctl
      const pack = store()
      if (!pack) return
      const have = new Set(
        (await pack.list().catch(() => [])).map((e) => `${e.family.toLowerCase()}/${e.weight}`),
      )
      // total 0 = still reading the families' CSS ("Preparing…").
      set({ status: "downloading", done: 0, total: 0, bytes: 0 })
      let bytes = 0
      let failure: string | null = null
      try {
        // 1. The plan: one CSS request per family.
        const plan: PackFace[] = []
        for (const family of FONT_PACK_FAMILIES) {
          if (ctl.signal.aborted) break
          const css = new TextDecoder().decode(
            await platform.fonts.fetchRemote(googleCssUrl(family)),
          )
          plan.push(...packFacesFromCss(family, css))
        }
        const todo = plan.filter((f) => !have.has(`${f.family.toLowerCase()}/${f.weight}`))
        let done = plan.length - todo.length
        set({ status: "downloading", done, total: plan.length, bytes })
        // 2. The faces, one at a time (progress per face).
        for (const f of todo) {
          if (ctl.signal.aborted) break
          const data = await platform.fonts.fetchRemote(f.url)
          await pack.put(
            { family: f.family, weight: f.weight, italic: false, source: "pack" },
            data,
          )
          bytes += data.byteLength
          done++
          set({ status: "downloading", done, total: plan.length, bytes })
        }
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e)
      } finally {
        if (abort === ctl) abort = null
      }
      const after = await read()
      if (failure && !ctl.signal.aborted)
        set({
          status: "error",
          message: failure,
          faces: after.status === "ready" ? after.faces : 0,
          bytes: after.status === "ready" ? after.bytes : 0,
        })
      else set(after)
      announce()
    },
  }
}
