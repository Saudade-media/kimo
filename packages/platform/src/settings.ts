/**
 * Typed app settings (board 19 "Settings"). One key per SettingRow. On desktop they live in
 * the app config dir (`settings.json`, owned by Rust) and change events are broadcast to every
 * window (the Settings window is separate, ⌘,); on the web they live in `localStorage` and the
 * Settings UI is an in-app dialog. Changes apply immediately: there is no Save button.
 */

export type UpdateChannel = "stable" | "beta"
export type Appearance = "system" | "light" | "dark"
/**
 * Settings › Canvas › Nudge (board 27 Lwg6P): arrow-key step / ⇧ step in px, as
 * `"<step>/<big step>"`.
 */
export type NudgePreset = "1/10" | "0.5/5" | "8/16"

export type ExternalChangePolicy =
  /** Merge with local edits and show a toast (board 19 "Merge & tell me"). */
  | "merge-and-tell"
  /** Ask before merging (toast with Review). */
  | "ask"

/** One Recent row of the agent's model chooser (board 39): a provider + model pick. */
export interface RecentModel {
  provider: string
  model: string
}

/** Board 39: Recent shows two rows. */
export const RECENT_MODELS_MAX = 2

/** Every setting with its value type. */
/** `multiplayer.relaySetup` (read leniently by the web app's relay setup store). */
export interface RelaySetupSetting {
  path?: "local" | "docker" | "fly" | "railway" | "existing" | null
  secretMode?: "auto" | "custom" | "none"
  extraOrigins?: string[]
  local?: { port?: number; reach?: "lan" | "quick" | "named"; hostname?: string | null } | null
  fly?: { app?: string; region?: string; byKimo?: boolean } | null
  restartPending?: boolean
}

export interface SettingsSchema {
  /** Files & autosave › Autosave. */
  "files.autosave": boolean
  /** Files & autosave › Autosave interval: idle ms before a write. */
  "files.autosaveIntervalMs": number
  /** Files & autosave › Recovery snapshots: ms between snapshots (kept even with autosave off). */
  "files.recoverySnapshotMs": number
  /** Files & autosave › When a file changes on disk (applies only with local edits). */
  "files.onExternalChange": ExternalChangePolicy
  /** Files & autosave › Pause autosave during git operations. */
  "files.pauseAutosaveDuringGit": boolean
  /** Files & autosave › New files go to. `null` = the host default (`~/Documents/Kimo`). */
  "files.newFilesDir": string | null
  /** Fonts & privacy › No third-party fetch (blocks Google Fonts and remote image URLs). */
  "privacy.noThirdPartyFetch": boolean
  /**
   * AI providers › Allow web access: the agent may search the web and read pages (board 38).
   * New agent sessions start from it; off while No third-party fetch is on.
   */
  "ai.webAccess": boolean
  /**
   * Agent model chooser › Recent (board 39): the last two distinct provider + model picks,
   * newest first. Not a SettingRow; kept here so every window shares it.
   */
  "ai.recentModels": RecentModel[]
  /**
   * Multiplayer › Relay URL: the user's own `kimo-mp/1` relay (self-hosted, Docker, Fly, Railway).
   * There is no default relay: null until the user enters one (docs/adr/0016).
   */
  "multiplayer.relayUrl": string | null
  /**
   * Multiplayer › Display name: how this person shows to others in shared files, kept on the
   * device. Empty: they show as "Guest N" (board 41, no prompt on join).
   */
  "multiplayer.displayName": string
  /** Multiplayer › Show other people's cursors on the canvas. */
  "multiplayer.showCursors": boolean
  /** Multiplayer › Fetch images and fonts of shared files on demand. */
  "multiplayer.fetchAssets": boolean
  /**
   * Multiplayer › Set up a relay (board 42 "What Kimo stores"): where the relay runs, the create
   * secret's mode, extra allowed origins and, for This computer, port, tunnel and hostname. The
   * secret itself is in the keychain (desktop) or browser storage (web), never here.
   */
  "multiplayer.relaySetup": RelaySetupSetting | null
  /** Fonts & privacy › Google Fonts (off while No third-party fetch is on). */
  "fonts.google": boolean
  /** Fonts & privacy › Extra font folders (absolute paths). */
  "fonts.extraFolders": string[]
  /** Fonts & privacy › Embed fonts in .kimoz packages (only fonts whose OS/2 fsType allows it). */
  "fonts.embedInKimoz": boolean
  /** General › Appearance. */
  "general.appearance": Appearance
  /** General › On launch. */
  "general.onLaunch": "last-files" | "home"
  /** General › Canvas zoom. */
  "general.canvasZoom": "trackpad" | "mouse"
  /**
   * General › Duplicating a main component (board 27 §8 d: ⌘D / ⌥-drag / Edit › Duplicate on a
   * main): ask, or the remembered choice (an instance, or a new component).
   */
  "general.duplicateMain": "ask" | "instance" | "component"
  /** Canvas › Snap to objects (board 27 §4: edges, centres, equal gaps; ⌘ suspends). */
  "canvas.snapToObjects": boolean
  /** Canvas › Snap to pixel grid: x/y/w/h rounded to whole px on move/resize/draw/nudge. */
  "canvas.snapToPixelGrid": boolean
  /** Canvas › Pixel grid: drawn at ≥ 800 % zoom. */
  "canvas.pixelGrid": boolean
  /** Canvas › Rulers (⇧R): 20 px top/left strips. */
  "canvas.rulers": boolean
  /** Canvas › Nudge: arrow-key step and ⇧ big step. */
  "canvas.nudge": NudgePreset
  /** View › Show layer names on canvas (root frame labels). */
  "canvas.layerNames": boolean
  /** Updates › Download updates. */
  "updates.download": boolean
  /** Updates › Channel. */
  "updates.channel": UpdateChannel
}

export type SettingKey = keyof SettingsSchema
export type Settings = { [K in SettingKey]: SettingsSchema[K] }

/** Defaults. Board 19 shows "No third-party fetch" on to illustrate Google Fonts off; the
 * default is off (teardown 9.2: Google Fonts are fetched on first use unless the user opts out). */
export const SETTINGS_DEFAULTS: Readonly<Settings> = Object.freeze({
  "files.autosave": true,
  "files.autosaveIntervalMs": 2000,
  "files.recoverySnapshotMs": 30_000,
  "files.onExternalChange": "merge-and-tell",
  "files.pauseAutosaveDuringGit": true,
  "files.newFilesDir": null,
  "privacy.noThirdPartyFetch": false,
  "ai.webAccess": true,
  "ai.recentModels": [],
  "multiplayer.relayUrl": null,
  "multiplayer.displayName": "",
  "multiplayer.showCursors": true,
  "multiplayer.fetchAssets": true,
  "multiplayer.relaySetup": null,
  "fonts.google": true,
  "fonts.extraFolders": [],
  "fonts.embedInKimoz": true,
  "general.appearance": "system",
  "general.onLaunch": "last-files",
  "general.canvasZoom": "trackpad",
  "general.duplicateMain": "ask",
  "canvas.snapToObjects": true,
  "canvas.snapToPixelGrid": true,
  "canvas.pixelGrid": true,
  "canvas.rulers": false,
  "canvas.nudge": "1/10",
  "canvas.layerNames": true,
  "updates.download": true,
  "updates.channel": "stable",
} satisfies Settings)

/** Choices offered by the Select controls (values in ms where numeric). */
export const SETTING_CHOICES = {
  "files.autosaveIntervalMs": [1000, 2000, 5000, 10_000, 30_000],
  "files.recoverySnapshotMs": [15_000, 30_000, 60_000, 300_000],
} as const

export const SETTING_KEYS = Object.keys(SETTINGS_DEFAULTS) as SettingKey[]

const oneOf =
  <T extends string>(...values: T[]) =>
  (v: unknown): v is T =>
    typeof v === "string" && (values as string[]).includes(v)
const positiveMs = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 250 && v <= 3_600_000

const VALIDATORS: { [K in SettingKey]: (v: unknown) => v is SettingsSchema[K] } = {
  "files.autosave": (v): v is boolean => typeof v === "boolean",
  "files.autosaveIntervalMs": positiveMs,
  "files.recoverySnapshotMs": positiveMs,
  "files.onExternalChange": oneOf("merge-and-tell", "ask"),
  "files.pauseAutosaveDuringGit": (v): v is boolean => typeof v === "boolean",
  "files.newFilesDir": (v): v is string | null => v === null || (typeof v === "string" && v !== ""),
  "privacy.noThirdPartyFetch": (v): v is boolean => typeof v === "boolean",
  "ai.webAccess": (v): v is boolean => typeof v === "boolean",
  "ai.recentModels": (v): v is RecentModel[] =>
    Array.isArray(v) &&
    v.length <= RECENT_MODELS_MAX &&
    v.every(
      (x) =>
        x !== null &&
        typeof x === "object" &&
        typeof (x as RecentModel).provider === "string" &&
        typeof (x as RecentModel).model === "string" &&
        (x as RecentModel).provider !== "" &&
        (x as RecentModel).model !== "",
    ),
  "multiplayer.relayUrl": (v): v is string | null =>
    v === null || (typeof v === "string" && v !== "" && v.length <= 2048),
  "multiplayer.displayName": (v): v is string => typeof v === "string" && v.length <= 80,
  "multiplayer.showCursors": (v): v is boolean => typeof v === "boolean",
  "multiplayer.fetchAssets": (v): v is boolean => typeof v === "boolean",
  "multiplayer.relaySetup": (v): v is RelaySetupSetting | null =>
    v === null || (typeof v === "object" && !Array.isArray(v) && JSON.stringify(v).length <= 8192),
  "fonts.google": (v): v is boolean => typeof v === "boolean",
  "fonts.extraFolders": (v): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string" && x !== ""),
  "fonts.embedInKimoz": (v): v is boolean => typeof v === "boolean",
  "general.appearance": oneOf("system", "light", "dark"),
  "general.onLaunch": oneOf("last-files", "home"),
  "general.canvasZoom": oneOf("trackpad", "mouse"),
  "general.duplicateMain": oneOf("ask", "instance", "component"),
  "canvas.snapToObjects": (v): v is boolean => typeof v === "boolean",
  "canvas.snapToPixelGrid": (v): v is boolean => typeof v === "boolean",
  "canvas.pixelGrid": (v): v is boolean => typeof v === "boolean",
  "canvas.rulers": (v): v is boolean => typeof v === "boolean",
  "canvas.nudge": oneOf("1/10", "0.5/5", "8/16"),
  "canvas.layerNames": (v): v is boolean => typeof v === "boolean",
  "updates.download": (v): v is boolean => typeof v === "boolean",
  "updates.channel": oneOf("stable", "beta"),
}

/** True when `key` is a known setting. */
export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS_DEFAULTS, key)
}

/** True when `value` is valid for `key`. */
export function isValidSetting<K extends SettingKey>(
  key: K,
  value: unknown,
): value is SettingsSchema[K] {
  return VALIDATORS[key](value)
}

/**
 * Reads persisted settings leniently: unknown keys are dropped, invalid values fall back to
 * the default, missing keys get the default. Never throws.
 */
export function normalizeSettings(raw: unknown): Settings {
  const out = { ...SETTINGS_DEFAULTS } as Record<SettingKey, unknown>
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of SETTING_KEYS) {
      const v = (raw as Record<string, unknown>)[key]
      if (v !== undefined && isValidSetting(key, v)) out[key] = v
    }
  }
  return out as Settings
}

/** Whether Google Fonts may be fetched under these settings. */
export function googleFontsAllowed(
  s: Pick<Settings, "privacy.noThirdPartyFetch" | "fonts.google">,
) {
  return s["fonts.google"] && !s["privacy.noThirdPartyFetch"]
}

/**
 * Whether the agent may use the web under these settings (board 38): Allow web access on and
 * No third-party fetch off. A session can still turn it off for itself.
 */
export function webAccessAllowed(s: Pick<Settings, "privacy.noThirdPartyFetch" | "ai.webAccess">) {
  return s["ai.webAccess"] && !s["privacy.noThirdPartyFetch"]
}

/** `"1/10"` → `{ step: 1, big: 10 }` (arrow / ⇧ arrow nudge in px). */
export function nudgeSteps(preset: NudgePreset): { step: number; big: number } {
  const [a, b] = preset.split("/").map(Number)
  return { step: a ?? 1, big: b ?? 10 }
}
