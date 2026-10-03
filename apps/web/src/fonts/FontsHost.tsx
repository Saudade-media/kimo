/**
 * Mountable font flows for the editor (see INTEGRATION.md):
 * - {@link MissingFontsHost}: on open, detects missing fonts once per file per session and shows
 *   the Missing fonts dialog; "Replace N fonts" applies one undoable edit.
 * - {@link useFontPickerEntries}: the picker's Document / Local / Google lists.
 * - {@link pickFontFile}: "Install <family>…" / "Choose font file…".
 */

import type { Op } from "@kimo/editor-state"
import type { KimoPlatform } from "@kimo/platform"
import type { FontAvailability, MissingFont } from "@kimo/renderer"
import { readFontInfo } from "@kimo/renderer"
import { DialogScrim } from "@kimo/ui"
import { useEffect, useState } from "react"
import { FONT_MIME } from "./document-fonts"
import type { FontPickerEntry, GoogleFontsState } from "./FontPicker"
import type { FontSystem } from "./font-system"
import { MissingFontsDialog } from "./MissingFontsDialog"
import type { ReplaceChoice } from "./ReplaceWithMenu"
import { replaceFontOps } from "./replace-fonts"
import { claimMissingFontsDialog } from "./session-once"

type Doc = Parameters<FontSystem["usage"]>[0]

/** Bundled families, shown as installed ("local"). */
const BUNDLED = ["Inter", "JetBrains Mono"]

/** Most families offered by "Replace with…" (the picker lists everything). */
export const REPLACE_CHOICES_MAX = 12

/** "Replace with…" candidates: bundled, local, then cached Google families. */
export async function replaceChoices(
  platform: KimoPlatform,
  max = REPLACE_CHOICES_MAX,
): Promise<ReplaceChoice[]> {
  const out: ReplaceChoice[] = BUNDLED.map((family) => ({ family, meta: "local" }))
  const seen = new Set(out.map((c) => c.family.toLowerCase()))
  const local = await platform.fonts.listLocal().catch(() => [])
  for (const f of [...local].sort((a, b) => a.family.localeCompare(b.family))) {
    if (seen.has(f.family.toLowerCase())) continue
    seen.add(f.family.toLowerCase())
    out.push({ family: f.family, meta: "local" })
  }
  const cached = await platform.fonts.cache.list().catch(() => [])
  for (const e of cached) {
    if (seen.has(e.family.toLowerCase())) continue
    seen.add(e.family.toLowerCase())
    out.push({ family: e.family, meta: e.source === "google" ? "google" : "local" })
  }
  return out.slice(0, max)
}

/** The picker's Google state: blocked by "No third-party fetch", Google Fonts off, offline. */
export function googleState(platform: KimoPlatform, system: FontSystem): GoogleFontsState {
  const s = platform.settings.all()
  if (s["privacy.noThirdPartyFetch"]) return "blocked"
  if (!s["fonts.google"] || !platform.capabilities.remoteFonts) return "off"
  return system.online() ? "online" : "offline"
}

/** Picker entries: IN THIS DOCUMENT (with style counts), ON THIS MAC, GOOGLE FONTS (cached). */
export async function fontPickerEntries(
  platform: KimoPlatform,
  system: FontSystem,
  doc: Doc,
): Promise<FontPickerEntry[]> {
  const local = await platform.fonts.listLocal().catch(() => [])
  const cached = await platform.fonts.cache.list().catch(() => [])
  const allowed = system.googleAllowed() && system.online()
  const styles = (family: string) => {
    const k = family.toLowerCase()
    const l = local.find((f) => f.family.toLowerCase() === k)?.styles.length ?? 0
    const c = cached.filter((e) => e.family.toLowerCase() === k).length
    const b = k === "inter" ? 5 : k === "jetbrains mono" ? 2 : 0
    return Math.max(l, c, b)
  }
  const out: FontPickerEntry[] = []
  for (const u of system.usage(doc)) {
    const avail: FontAvailability = await system.availability({
      family: u.family,
      weight: u.weights[0] ?? 400,
      style: "normal",
    })
    const n = styles(u.family)
    const ok = avail !== "missing" && avail !== "offline"
    const count = n || u.weights.length
    const meta = ok
      ? `${count} style${count === 1 ? "" : "s"}`
      : avail === "offline"
        ? "not cached"
        : "missing"
    out.push({ family: u.family, group: "document", meta, available: ok })
  }
  for (const f of [...local].sort((a, b) => a.family.localeCompare(b.family)))
    out.push({ family: f.family, group: "local", meta: "local", available: true })
  const google = new Set<string>()
  for (const e of cached)
    if (e.source === "google" && !google.has(e.family.toLowerCase())) {
      google.add(e.family.toLowerCase())
      out.push({ family: e.family, group: "google", meta: "cached", available: true })
    }
  for (const k of await system.knownGoogleFamilies())
    if (!google.has(k)) {
      const fam = out.find((e) => e.family.toLowerCase() === k)?.family ?? k
      out.push({ family: fam, group: "google", meta: "not cached", available: allowed })
    }
  return out
}

/** Keeps picker entries current with settings / online changes. */
export function useFontPickerEntries(
  platform: KimoPlatform,
  system: FontSystem,
  doc: Doc,
): { entries: FontPickerEntry[]; google: GoogleFontsState } {
  const [state, setState] = useState<{ entries: FontPickerEntry[]; google: GoogleFontsState }>(
    () => ({ entries: [], google: googleState(platform, system) }),
  )
  useEffect(() => {
    let live = true
    const load = () =>
      void fontPickerEntries(platform, system, doc).then((entries) => {
        if (live) setState({ entries, google: googleState(platform, system) })
      })
    load()
    const off = system.subscribe(load)
    return () => {
      live = false
      off()
    }
  }, [platform, system, doc])
  return state
}

/** A font file the user picked, with what its tables say. */
export interface PickedFont {
  bytes: Uint8Array
  name: string
  family: string
  weight: number
  italic: boolean
  ext: string
  mime: string
}

/** Opens the native/browser picker for one font file; null when cancelled or unreadable. */
export async function pickFontFile(platform: KimoPlatform): Promise<PickedFont | null> {
  const [ref] = await platform.dialogs.openFile({
    title: "Choose font file",
    filters: [{ name: "Fonts", extensions: Object.keys(FONT_MIME) }],
  })
  if (!ref) return null
  const bytes = await platform.files.readBytes(ref)
  const name = ref.replace(/^.*[\\/]/, "")
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "ttf"
  const info = await readFontInfo(bytes)
  if (!info) return null
  return {
    bytes,
    name,
    family: info.family,
    weight: info.weight,
    italic: info.italic,
    ext,
    mime: FONT_MIME[ext] ?? "font/ttf",
  }
}

export interface MissingFontsHostProps {
  platform: KimoPlatform
  system: FontSystem
  /** Once-per-session key: the file ref (desktop) or file id (web). */
  fileKey: string
  fileName: string
  /** Current document (read when detection runs). */
  doc: () => Doc
  /** Applies ops as one undoable edit (`store.apply(ops, { origin: "user", label })`). */
  apply: (ops: Op[], label: string) => void
  /** Stores a picked font file as a document asset ("Choose font file…"). */
  addDocumentFont?: (font: PickedFont) => Promise<void>
}

/** Detects missing fonts once per file per session and shows the dialog. */
export function MissingFontsHost(props: MissingFontsHostProps) {
  const { platform, system, fileKey, fileName, doc, apply, addDocumentFont } = props
  const [fonts, setFonts] = useState<MissingFont[] | null>(null)
  const [choices, setChoices] = useState<ReplaceChoice[]>([])
  const [, bump] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per file key
  useEffect(() => {
    let live = true
    void (async () => {
      const missing = await system.missingFonts(doc())
      if (!live || !missing.length || !claimMissingFontsDialog(fileKey)) return
      setChoices(await replaceChoices(platform))
      if (live) setFonts(missing)
    })()
    return () => {
      live = false
    }
  }, [fileKey])

  useEffect(() => system.subscribe(() => bump((n) => n + 1)), [system])

  if (!fonts?.length) return null
  const close = () => setFonts(null)
  const refresh = async () => {
    const missing = await system.missingFonts(doc())
    setChoices(await replaceChoices(platform))
    setFonts(missing.length ? missing : null)
  }
  return (
    <DialogScrim>
      <MissingFontsDialog
        fileName={fileName}
        fonts={fonts}
        choices={choices}
        canFetch={system.googleAllowed() && system.online()}
        onKeep={close}
        onReplace={(mapping) => {
          const ops = replaceFontOps(doc(), mapping)
          if (ops.length) apply(ops, `Replace ${Object.keys(mapping).length} fonts`)
          close()
        }}
        {...(platform.capabilities.reveal
          ? { onOpenFontsFolder: () => void platform.fonts.openCacheFolder().catch(() => {}) }
          : {})}
        onFetch={async (f) => {
          const ok = await system.fetchFamily(f.family, f.weights)
          if (ok) await refresh()
          return ok
        }}
        onInstall={async () => {
          const picked = await pickFontFile(platform).catch(() => null)
          if (!picked) return
          await platform.fonts.cache.put(
            { family: picked.family, weight: picked.weight, italic: picked.italic, source: "file" },
            picked.bytes,
          )
          system.invalidate()
          await refresh()
        }}
        {...(addDocumentFont
          ? {
              onChooseFile: async () => {
                const picked = await pickFontFile(platform).catch(() => null)
                if (!picked) return
                await addDocumentFont(picked)
                system.invalidate()
                await refresh()
              },
            }
          : {})}
      />
    </DialogScrim>
  )
}
