/**
 * Settings model (board 19 "Settings", ADR 0012): panes, the `#/settings/<pane>` route, the
 * Select choices with their designed labels, and copy helpers. Values are validated by
 * `@kimo/platform` (`isValidSetting`) on write; {@link parseChoice} maps a Select value back to
 * a typed setting and refuses anything else.
 */
import {
  type HostOS,
  isValidSetting,
  type SettingKey,
  type SettingsPane,
  type SettingsSchema,
  type UpdaterStatus,
} from "@kimo/platform"
import { formatBytes } from "../assets-gc/logic"

export interface PaneInfo {
  id: SettingsPane
  label: string
  /** Lucide icon name (Nav · … Icon). */
  icon: "settings" | "ruler" | "hard-drive" | "shield" | "bot" | "key-round" | "refresh-cw" | "info"
}

/** Sidebar order (XmeDB > Sidebar h7qQD). */
export const SETTINGS_PANES: readonly PaneInfo[] = [
  { id: "general", label: "General", icon: "settings" },
  // Board 27 §4 n9EfHf: "New 'Canvas' sidebar item … after General". The nav icon is not in the
  // design (house choice: lucide `ruler`).
  { id: "canvas", label: "Canvas", icon: "ruler" },
  { id: "files", label: "Files & autosave", icon: "hard-drive" },
  { id: "fonts", label: "Fonts & privacy", icon: "shield" },
  { id: "agents-mcp", label: "Agents & MCP", icon: "bot" },
  // Board 22 pane rule "Placement": right after Agents & MCP; key-round in $agent (b13pOm).
  { id: "ai-providers", label: "AI providers", icon: "key-round" },
  { id: "updates", label: "Updates", icon: "refresh-cw" },
  { id: "about", label: "About & licenses", icon: "info" },
]

export const DEFAULT_PANE: SettingsPane = "general"

export function isSettingsPane(v: string): v is SettingsPane {
  return SETTINGS_PANES.some((p) => p.id === v)
}

/**
 * `#/settings` → general, `#/settings/fonts` → fonts; null when the hash is not a settings route.
 * An unknown pane falls back to {@link DEFAULT_PANE}.
 */
export function parseSettingsHash(hash: string): SettingsPane | null {
  const path = hash.replace(/^#/, "")
  const m = /^\/settings(?:\/([a-z-]*))?\/?$/.exec(path)
  if (!m) return null
  const pane = m[1] ?? ""
  return isSettingsPane(pane) ? pane : DEFAULT_PANE
}

export function settingsHash(pane: SettingsPane): string {
  return `#/settings/${pane}`
}

// --- Select choices (labels as designed) ------------------------------------------------------

export interface Choice<V> {
  value: V
  label: string
}

/** The settings edited through a Select, with every choice it offers. */
export const CHOICES = {
  "files.autosaveIntervalMs": [
    { value: 1000, label: "1 second" },
    { value: 2000, label: "2 seconds" },
    { value: 5000, label: "5 seconds" },
    { value: 10_000, label: "10 seconds" },
    { value: 30_000, label: "30 seconds" },
  ],
  "files.recoverySnapshotMs": [
    { value: 15_000, label: "Every 15 s" },
    { value: 30_000, label: "Every 30 s" },
    { value: 60_000, label: "Every minute" },
    { value: 300_000, label: "Every 5 min" },
  ],
  "files.onExternalChange": [
    { value: "merge-and-tell", label: "Merge & tell me" },
    { value: "ask", label: "Ask first" },
  ],
  "general.appearance": [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ],
  "general.onLaunch": [
    { value: "last-files", label: "Last files" },
    { value: "home", label: "Home" },
  ],
  "general.canvasZoom": [
    { value: "trackpad", label: "Trackpad" },
    { value: "mouse", label: "Mouse" },
  ],
  // Board 27 §8 (d) WYOjQ "Duplicate a main": ask, or the remembered choice.
  "general.duplicateMain": [
    { value: "ask", label: "Ask" },
    { value: "instance", label: "Instance" },
    { value: "component", label: "New component" },
  ],
  // Board 27 Lwg6P › Setting · Nudge (uFQFU) Select iv6cR "1 px · ⇧ 10 px".
  "canvas.nudge": [
    { value: "0.5/5", label: "0.5 px · ⇧ 5 px" },
    { value: "1/10", label: "1 px · ⇧ 10 px" },
    { value: "8/16", label: "8 px · ⇧ 16 px" },
  ],
  "updates.channel": [
    { value: "stable", label: "Stable" },
    { value: "beta", label: "Beta" },
  ],
} as const satisfies { [K in SettingKey]?: readonly Choice<SettingsSchema[K]>[] }

export type ChoiceKey = keyof typeof CHOICES

/** Select width per setting (the instances' `width`). */
export const SELECT_WIDTH: Record<ChoiceKey, number> = {
  "files.autosaveIntervalMs": 120,
  "files.recoverySnapshotMs": 120,
  "files.onExternalChange": 148,
  "general.appearance": 104,
  "general.onLaunch": 104,
  "general.canvasZoom": 104,
  "general.duplicateMain": 136,
  "canvas.nudge": 136,
  "updates.channel": 96,
}

/** Select options (string values) for a choice setting; a stored value outside the list is
 * shown as its own option so the control never lies about the current value. */
export function selectOptions(
  key: ChoiceKey,
  current: unknown,
): { value: string; label: string }[] {
  const list: readonly Choice<unknown>[] = CHOICES[key]
  const out = list.map((c) => ({ value: String(c.value), label: c.label }))
  if (current !== undefined && !list.some((c) => c.value === current))
    out.push({ value: String(current), label: customLabel(key, current) })
  return out
}

function customLabel(key: ChoiceKey, v: unknown): string {
  if (typeof v === "number" && key === "files.autosaveIntervalMs") return `${v / 1000} seconds`
  if (typeof v === "number" && key === "files.recoverySnapshotMs") return `Every ${v / 1000} s`
  return String(v)
}

/**
 * Maps a Select value (string) back to a typed setting value; null when it is not valid for
 * `key` (unknown choice, wrong type, out of range).
 */
export function parseChoice<K extends ChoiceKey>(key: K, raw: string): SettingsSchema[K] | null {
  const list: readonly Choice<unknown>[] = CHOICES[key]
  const sample = list[0]?.value
  const value: unknown = typeof sample === "number" ? Number(raw) : raw
  if (typeof sample === "number" && (!Number.isFinite(value as number) || raw.trim() === ""))
    return null
  return isValidSetting(key, value) ? (value as SettingsSchema[K]) : null
}

// --- Copy -------------------------------------------------------------------------------------

/** Files & autosave › Autosave description ("Writes 2 s after you stop editing. …"). */
export function autosaveDescription(intervalMs: number): string {
  const s = intervalMs / 1000
  return `Writes ${Number.isInteger(s) ? s : s.toFixed(1)} s after you stop editing. Every write is atomic (temp file → rename) and read back.`
}

/** `/Users/me/Documents/Kimo` → `~/Documents/Kimo`. */
export function displayPath(path: string, home: string | null): string {
  if (home && (path === home || path.startsWith(`${home}/`) || path.startsWith(`${home}\\`)))
    return `~${path.slice(home.length)}`
  return path
}

/** Home directory guessed from an absolute path under it (`/Users/<me>/…`, `/home/<me>/…`). */
export function homeOf(path: string | null | undefined): string | null {
  const m = path ? /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/.exec(path) : null
  return m ? (m[1] as string) : null
}

/** "38 fonts · 21 MB". */
export function fontCacheLabel(count: number, bytes: number): string {
  return `${count} font${count === 1 ? "" : "s"} · ${formatSize(bytes)}`
}

/** SI sizes as Finder shows them: `48 KB`, `6.2 MB`, `21 MB` (shared with Clean up assets). */
export const formatSize = formatBytes

/** Extra font folders description: the folders the OS fonts come from, plus added ones. */
export function extraFoldersDescription(os: HostOS, extra: readonly string[], home: string | null) {
  const base =
    os === "macos"
      ? ["~/Library/Fonts", "/Library/Fonts"]
      : os === "windows"
        ? ["C:\\Windows\\Fonts"]
        : os === "linux"
          ? ["~/.local/share/fonts", "/usr/share/fonts"]
          : []
  const all = [...base, ...extra.map((p) => displayPath(p, home))]
  if (!all.length) return "Fonts installed on this computer."
  const list =
    all.length === 1 ? all[0] : `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`
  return `Also scanned: ${list}.`
}

/** Git merge driver description ("kimo merge is set up in 2 of 4 watched repositories …"). */
export function mergeDriverDescription(configured: number, total: number): string {
  if (total === 0) return "Add a watched folder on Home to set up kimo merge in its repository."
  return `kimo merge is set up in ${configured} of ${total} watched repositor${total === 1 ? "y" : "ies"} (.gitattributes + git config).`
}

/** Updates › "Kimo 0.4.2" row description from the updater status. */
export function updaterDescription(s: UpdaterStatus, formatTime: (ms: number) => string): string {
  switch (s.state) {
    case "idle":
      return "Not checked yet"
    case "checking":
      return "Checking…"
    case "up-to-date":
      return `Up to date · checked ${formatTime(s.checkedAt)}`
    case "available":
      return `Kimo ${s.info.version} is available`
    case "downloading": {
      const pct = s.total ? Math.round((s.received / s.total) * 100) : null
      return `Downloading Kimo ${s.info.version}${pct === null ? "…" : ` · ${pct}%`}`
    }
    case "ready":
      return `Kimo ${s.info.version} is ready · restart to update`
    case "error":
      return `Couldn't check: ${s.message}`
  }
}

/** `9:14` (24 h, no leading zero), as the design shows. */
export function shortTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`
}
