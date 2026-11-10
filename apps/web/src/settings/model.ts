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
import { type MessageKey, t } from "../lib/i18n"

export interface PaneInfo {
  id: SettingsPane
  /** The nav label and the pane's title. */
  label: MessageKey
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
  { id: "general", label: "settings.nav.general", icon: "settings" },
  // Board 27 §4 n9EfHf: "New 'Canvas' sidebar item … after General". The nav icon is not in the
  // design (house choice: lucide `ruler`).
  { id: "canvas", label: "settings.nav.canvas", icon: "ruler" },
  { id: "files", label: "settings.nav.files", icon: "hard-drive" },
  { id: "fonts", label: "settings.nav.fonts", icon: "shield" },
  { id: "agents-mcp", label: "settings.nav.agents", icon: "bot" },
  // Board 22 pane rule "Placement": right after Agents & MCP; key-round in $agent (b13pOm).
  { id: "ai-providers", label: "settings.nav.ai", icon: "key-round" },
  // Board 41 section 4 shows the pane, not its nav item: placed after AI providers, with the
  // Share button's lucide `users` (house choice).
  { id: "multiplayer", label: "settings.nav.multiplayer", icon: "users" },
  // Board 46 2A shows the pane, not its nav item: right after Multiplayer, with the workspace
  // rows' lucide `users` (house choice). Listed only while Kimo Cloud is on.
  { id: "workspace", label: "settings.nav.workspace", icon: "users" },
  { id: "updates", label: "settings.nav.updates", icon: "refresh-cw" },
  { id: "about", label: "settings.nav.about", icon: "info" },
]

export const DEFAULT_PANE: SettingsPane = "general"

function isSettingsPane(v: string): v is SettingsPane {
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

/**
 * `#/settings/<pane>/<focus>`: an MCP client to expand, `usage`, or a workspace id (board 46);
 * null when absent.
 */
export function parseSettingsFocus(hash: string): string | null {
  return SETTINGS_ROUTE.exec(hash.replace(/^#/, ""))?.[2] ?? null
}

const SETTINGS_ROUTE = /^\/settings(?:\/([a-z-]*))?(?:\/([A-Za-z0-9._-]{1,64}))?\/?$/

export function settingsHash(pane: SettingsPane, focus?: string | null): string {
  return focus ? `#/settings/${pane}/${focus}` : `#/settings/${pane}`
}

// --- Select choices (labels as designed) ------------------------------------------------------

interface Choice<V> {
  value: V
  label: MessageKey
}

/** The settings edited through a Select, with every choice it offers. */
const CHOICES = {
  "files.autosaveIntervalMs": [
    { value: 1000, label: "choice.seconds.1" },
    { value: 2000, label: "choice.seconds.2" },
    { value: 5000, label: "choice.seconds.5" },
    { value: 10_000, label: "choice.seconds.10" },
    { value: 30_000, label: "choice.seconds.30" },
  ],
  "files.recoverySnapshotMs": [
    { value: 15_000, label: "choice.every15" },
    { value: 30_000, label: "choice.every30" },
    { value: 60_000, label: "choice.everyMinute" },
    { value: 300_000, label: "choice.every5Min" },
  ],
  "files.onExternalChange": [
    { value: "merge-and-tell", label: "choice.mergeTell" },
    { value: "ask", label: "choice.askFirst" },
  ],
  "general.appearance": [
    { value: "system", label: "choice.system" },
    { value: "light", label: "choice.light" },
    { value: "dark", label: "choice.dark" },
  ],
  "general.onLaunch": [
    { value: "last-files", label: "choice.lastFiles" },
    { value: "home", label: "choice.home" },
  ],
  "general.canvasZoom": [
    { value: "trackpad", label: "choice.trackpad" },
    { value: "mouse", label: "choice.mouse" },
  ],
  // Board 27 §8 (d) WYOjQ "Duplicate a main": ask, or the remembered choice.
  "general.duplicateMain": [
    { value: "ask", label: "choice.ask" },
    { value: "instance", label: "choice.instance" },
    { value: "component", label: "choice.newComponent" },
  ],
  // Board 27 Lwg6P › Setting · Nudge (uFQFU) Select iv6cR "1 px · ⇧ 10 px".
  "canvas.nudge": [
    { value: "0.5/5", label: "choice.nudge.0_5" },
    { value: "1/10", label: "choice.nudge.1" },
    { value: "8/16", label: "choice.nudge.8" },
  ],
  "updates.channel": [
    { value: "stable", label: "choice.stable" },
    { value: "beta", label: "choice.beta" },
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
  const out = list.map((c) => ({ value: String(c.value), label: t(c.label) }))
  if (current !== undefined && !list.some((c) => c.value === current))
    out.push({ value: String(current), label: customLabel(key, current) })
  return out
}

function customLabel(key: ChoiceKey, v: unknown): string {
  if (typeof v === "number" && key === "files.autosaveIntervalMs")
    return t("choice.secondsN", { n: String(v / 1000) })
  if (typeof v === "number" && key === "files.recoverySnapshotMs")
    return t("choice.everyN", { n: String(v / 1000) })
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
export const SETTING_LABELS: Record<SettingKey, MessageKey> = {
  "files.autosave": "setting.files.autosave",
  "files.autosaveIntervalMs": "setting.files.autosaveIntervalMs",
  "files.recoverySnapshotMs": "setting.files.recoverySnapshotMs",
  "files.onExternalChange": "setting.files.onExternalChange",
  "files.pauseAutosaveDuringGit": "setting.files.pauseAutosaveDuringGit",
  "files.newFilesDir": "setting.files.newFilesDir",
  "privacy.noThirdPartyFetch": "setting.privacy.noThirdPartyFetch",
  "ai.webAccess": "setting.ai.webAccess",
  "ai.recentModels": "setting.ai.recentModels",
  "multiplayer.relayUrl": "setting.multiplayer.relayUrl",
  "multiplayer.displayName": "setting.multiplayer.displayName",
  "multiplayer.showCursors": "setting.multiplayer.showCursors",
  "multiplayer.fetchAssets": "setting.multiplayer.fetchAssets",
  "multiplayer.relaySetup": "setting.multiplayer.relaySetup",
  "multiplayer.cloudApiUrl": "setting.multiplayer.cloudApiUrl",
  "fonts.google": "setting.fonts.google",
  "fonts.extraFolders": "setting.fonts.extraFolders",
  "fonts.embedInKimoz": "setting.fonts.embedInKimoz",
  "general.appearance": "setting.general.appearance",
  "general.language": "setting.general.language",
  "general.onLaunch": "setting.general.onLaunch",
  "general.canvasZoom": "setting.general.canvasZoom",
  "general.duplicateMain": "setting.general.duplicateMain",
  "canvas.snapToObjects": "setting.canvas.snapToObjects",
  "canvas.snapToPixelGrid": "setting.canvas.snapToPixelGrid",
  "canvas.pixelGrid": "setting.canvas.pixelGrid",
  "canvas.rulers": "setting.canvas.rulers",
  "canvas.nudge": "setting.canvas.nudge",
  "canvas.layerNames": "setting.canvas.layerNames",
  "updates.download": "setting.updates.download",
  "updates.channel": "setting.updates.channel",
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
  const body = text ? (/[.!?]$/.test(text) ? text : `${text}.`) : t("settings.writeFailed")
  return {
    title: t("settings.saveFailed", { setting: t(SETTING_LABELS[key]) }),
    body: body.charAt(0).toUpperCase() + body.slice(1),
  }
}

/** Files & autosave › Autosave description ("Writes 2 s after you stop editing. …"). */
export function autosaveDescription(intervalMs: number): string {
  const s = intervalMs / 1000
  return t("settings.files.autosaveWrites", {
    s: String(Number.isInteger(s) ? s : s.toFixed(1)),
  })
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
  return t(count === 1 ? "settings.fonts.cacheLabelOne" : "settings.fonts.cacheLabel", {
    count: String(count),
    size: formatSize(bytes),
  })
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
  if (!all.length) return t("settings.fonts.extraNone")
  // i18n-boundary-allow: a list of folders joined by a localised separator and conjunction,
  // not a sentence — the pieces are "、" / " 和 " style punctuation, and the count is arbitrary.
  const list =
    all.length === 1
      ? (all[0] ?? "")
      : `${all.slice(0, -1).join(t("settings.fonts.listSep"))}${t("settings.fonts.listLast")}${all.at(-1) ?? ""}`
  return t("settings.fonts.extraList", { list })
}

/** Git merge driver description ("kimo merge is set up in 2 of 4 watched repositories …"). */
export function mergeDriverDescription(configured: number, total: number): string {
  if (total === 0) return t("settings.files.mergeDriverNone")
  return t(total === 1 ? "settings.files.mergeDriverCountOne" : "settings.files.mergeDriverCount", {
    configured: String(configured),
    total: String(total),
  })
}

/** Updates › "Kimo 0.4.2" row description from the updater status. */
function updaterDescription(s: UpdaterStatus, formatTime: (ms: number) => string): string {
  switch (s.state) {
    case "idle":
      return t("settings.updates.notChecked")
    case "checking":
      return t("settings.files.checking")
    case "up-to-date":
      return t("settings.updates.upToDate", { time: formatTime(s.checkedAt) })
    case "available":
      return t("settings.updates.available", { version: s.info.version })
    case "downloading": {
      const pct = s.total ? Math.round((s.received / s.total) * 100) : null
      const label = t("settings.updates.downloading", { version: s.info.version })
      return pct === null ? `${label}…` : `${label} · ${pct}%`
    }
    case "ready":
      return t("settings.updates.readyRestart", { version: s.info.version })
    case "error":
      return t("settings.updates.checkFailed", { message: s.message })
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
    label: t("settings.updates.available", { version: info.version }),
    description:
      t("settings.updates.youHave", { version: info.currentVersion }) +
      (seen.total ? ` · ${mb(seen.total)}` : ""),
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
        label: t("settings.updates.downloading", { version: s.info.version }),
        description: s.total
          ? fontPackProgressLabel(s.received, s.total)
          : t("settings.updates.progress", { size: mb(s.received) }),
        percent,
        info: s.info,
      }
    }
    case "ready":
      return {
        ...base,
        kind: "ready",
        label: t("settings.updates.ready", { version: s.info.version }),
        description: t("settings.updates.readyDesc"),
        info: s.info,
      }
    case "error":
      // Board 37 C60dt0: a failed download keeps the Available row under the banner.
      if (seen.action === "download" && seen.info) return available(seen.info)
      return {
        ...base,
        kind: "check",
        label: `Kimo ${appVersion}`,
        description: t("settings.updates.notChecked"),
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
  return t("settings.fonts.packSize", {
    n: n(bytes),
    total: n(total),
    unit: unit === 1_000_000 ? "MB" : "KB",
  })
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
      ? t("settings.fonts.packPreparing")
      : t("settings.fonts.packDownloading", { done: String(s.done), total: String(s.total) })
  if (s.status === "ready")
    return t("settings.fonts.packReady", {
      families: String(s.families),
      faces: String(s.faces),
      where: s.dir ? dir(s.dir) : t("settings.fonts.packInBrowser"),
    })
  if (blocked === "ntpf") return t("settings.fonts.packNtpf")
  if (blocked === "google-off") return t("settings.fonts.packGoogleOff")
  if (s.status === "error") return t("settings.fonts.packError", { message: s.message })
  return t("settings.fonts.packDesc")
}
