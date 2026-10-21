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
  type SettingsApi,
  type SettingsPane,
  type SettingsSchema,
  type UpdateInfo,
  type UpdaterStatus,
} from "@kimo/platform"
import { formatBytes } from "../assets-gc/logic"

export interface PaneInfo {
  id: SettingsPane
  label: string
  /** Lucide icon name (Nav · … Icon). */
  icon:
    | "settings"
    | "ruler"
    | "hard-drive"
    | "shield"
    | "bot"
    | "key-round"
    | "users"
    | "refresh-cw"
    | "info"
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
  // Board 41 section 4 shows the pane, not its nav item: placed after AI providers, with the
  // Share button's lucide `users` (house choice).
  { id: "multiplayer", label: "Multiplayer", icon: "users" },
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
  const m = SETTINGS_ROUTE.exec(hash.replace(/^#/, ""))
  if (!m) return null
  const pane = m[1] ?? ""
  return isSettingsPane(pane) ? pane : DEFAULT_PANE
}

/** `#/settings/<pane>/<focus>`: an MCP client to expand, or `usage`; null when absent. */
export function parseSettingsFocus(hash: string): string | null {
  return SETTINGS_ROUTE.exec(hash.replace(/^#/, ""))?.[2] ?? null
}

const SETTINGS_ROUTE = /^\/settings(?:\/([a-z-]*))?(?:\/([a-z0-9._-]{1,64}))?\/?$/

export function settingsHash(pane: SettingsPane, focus?: string | null): string {
  return focus ? `#/settings/${pane}/${focus}` : `#/settings/${pane}`
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

/** Each setting's row label, as the panes show it ("Couldn't save Canvas zoom"). */
export const SETTING_LABELS: Record<SettingKey, string> = {
  "files.autosave": "Autosave",
  "files.autosaveIntervalMs": "Autosave interval",
  "files.recoverySnapshotMs": "Recovery snapshots",
  "files.onExternalChange": "When a file changes on disk",
  "files.pauseAutosaveDuringGit": "Pause autosave during git operations",
  "files.newFilesDir": "New files go to",
  "privacy.noThirdPartyFetch": "No third-party fetch",
  "ai.webAccess": "Allow web access",
  "ai.recentModels": "Recent models",
  "multiplayer.relayUrl": "Relay URL",
  "multiplayer.displayName": "Display name",
  "multiplayer.showCursors": "Show other people's cursors",
  "multiplayer.fetchAssets": "Fetch images and fonts",
  "multiplayer.relaySetup": "Relay setup",
  "multiplayer.cloudApiUrl": "Kimo Cloud address",
  "fonts.google": "Google Fonts",
  "fonts.extraFolders": "Extra font folders",
  "fonts.embedInKimoz": "Embed fonts in .kimoz packages",
  "general.appearance": "Appearance",
  "general.onLaunch": "On launch",
  "general.canvasZoom": "Canvas zoom",
  "general.duplicateMain": "Duplicating a main component",
  "canvas.snapToObjects": "Snap to objects",
  "canvas.snapToPixelGrid": "Snap to pixel grid",
  "canvas.pixelGrid": "Pixel grid",
  "canvas.rulers": "Rulers",
  "canvas.nudge": "Nudge",
  "canvas.layerNames": "Layer names",
  "updates.download": "Download updates",
  "updates.channel": "Channel",
}

/**
 * Board 37 D13 (CT1wv): the banner a refused settings write shows, "Couldn't save Canvas zoom" /
 * "~/.kimo/settings.json is read-only.". The body is the host's reason as one sentence.
 */
export function settingsWriteErrorCopy(
  key: SettingKey,
  error: unknown,
): { title: string; body: string } {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  const text = raw.trim().replace(/^[A-Z_]+:\s*/, "")
  const body = text
    ? /[.!?]$/.test(text)
      ? text
      : `${text}.`
    : "The settings file couldn't be written."
  return {
    title: `Couldn't save ${SETTING_LABELS[key]}`,
    body: body.charAt(0).toUpperCase() + body.slice(1),
  }
}

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

/**
 * Files & autosave › New files go to: `files.newFilesDir`, else `~/Documents/Kimo` (board 19).
 * Used by Home's New file and by the first Save as of an untitled file.
 */
export function defaultNewFilesDir(platform: {
  settings: Pick<SettingsApi, "get">
  recovery: { dir: string | null }
}): string {
  const set = platform.settings.get("files.newFilesDir")
  if (set) return set
  const home = homeOf(platform.recovery.dir)
  const sep = home?.includes("\\") ? "\\" : "/"
  return home ? `${home}${sep}Documents${sep}Kimo` : "/Kimo"
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

/** What the Updates pane last ran: the error banner names it. */
export type UpdateAction = "check" | "download"

/** The Updates pane's version row (board 37 D10: Y5w77Y / je8J6 / fSIIa / C60dt0). */
export interface UpdateRowView {
  kind: "check" | "available" | "downloading" | "ready"
  label: string
  description: string
  /** Downloading: 0–100, null while the size is unknown. */
  percent: number | null
  /** The update the row is about (available, downloading, ready, or the one an error kept). */
  info: UpdateInfo | null
  /** What failed when the status is `error`. */
  action: UpdateAction
}

/** "18 MB" style sizes for the update download (the same SI units as Finder). */
const mb = (bytes: number) => formatBytes(bytes)

export function updateRowView(
  s: UpdaterStatus,
  appVersion: string,
  seen: { info: UpdateInfo | null; total: number | null; action: UpdateAction },
): UpdateRowView {
  const base = { percent: null, info: null, action: seen.action }
  const available = (info: UpdateInfo): UpdateRowView => ({
    ...base,
    kind: "available",
    label: `Kimo ${info.version} is available`,
    description: `You have ${info.currentVersion}${seen.total ? ` · ${mb(seen.total)}` : ""}`,
    info,
  })
  switch (s.state) {
    case "available":
      return available(s.info)
    case "downloading": {
      const percent = s.total ? Math.min(100, Math.round((s.received / s.total) * 100)) : null
      return {
        ...base,
        kind: "downloading",
        label: `Downloading Kimo ${s.info.version}`,
        description: s.total
          ? fontPackProgressLabel(s.received, s.total)
          : `${mb(s.received)} so far`,
        percent,
        info: s.info,
      }
    }
    case "ready":
      return {
        ...base,
        kind: "ready",
        label: `Kimo ${s.info.version} is ready`,
        description: "Restart Kimo to finish. Open files are saved first.",
        info: s.info,
      }
    case "error":
      // Board 37 C60dt0: a failed download keeps the Available row under the banner.
      if (seen.action === "download" && seen.info) return available(seen.info)
      return {
        ...base,
        kind: "check",
        label: `Kimo ${appVersion}`,
        description: "Not checked yet",
      }
    default:
      return {
        ...base,
        kind: "check",
        label: `Kimo ${appVersion}`,
        description: updaterDescription(s, shortTime),
      }
  }
}

/** `9:14` (24 h, no leading zero), as the design shows. */
export function shortTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`
}

// --- Offline font pack (board 28 xW7Mh / rCcF5 / TEciq / UN6YR) ----------------------------------

/** "3.1 of 8.3 MB" (the total is the estimate until the received bytes pass it). */
export function fontPackProgressLabel(bytes: number, estimate: number): string {
  const total = Math.max(bytes, estimate)
  const unit = total >= 1_000_000 ? 1_000_000 : 1000
  const n = (v: number) => (v / unit).toFixed(1).replace(/\.0$/, "")
  return `${n(bytes)} of ${n(total)} ${unit === 1_000_000 ? "MB" : "KB"}`
}

/** The pack row's description per state. */
export function fontPackDescription(
  s:
    | { status: "loading" | "empty" }
    | { status: "downloading"; done: number; total: number }
    | { status: "ready"; faces: number; families: number; dir: string | null }
    | { status: "error"; message: string },
  blocked: "ntpf" | "google-off" | null,
  dir: (d: string) => string,
): string {
  if (s.status === "downloading")
    return s.total === 0
      ? "Preparing the download…"
      : `Downloading ${s.done} of ${s.total} faces… You can keep working; the fonts apply when it finishes.`
  if (s.status === "ready")
    return `${s.families} families · ${s.faces} faces · ${s.dir ? dir(s.dir) : "stored in this browser"}`
  if (blocked === "ntpf")
    return "Off while No third-party fetch is on. A pack already downloaded keeps working."
  if (blocked === "google-off")
    return "Off while Google Fonts is off. A pack already downloaded keeps working."
  if (s.status === "error") return `The download stopped (${s.message}). Download resumes it.`
  return "16 popular Google families, regular to bold, kept on this device so they render with no network."
}
