/** A {@link SettingsApi} over any load/persist pair (memory, localStorage, Tauri commands). */
import { PlatformError } from "./errors"
import {
  isSettingKey,
  isValidSetting,
  normalizeSettings,
  SETTINGS_DEFAULTS,
  type SettingKey,
  type Settings,
  type SettingsSchema,
} from "./settings"
import type { SettingsApi } from "./types"
import { Emitter } from "./util"

export interface SettingsBackend {
  load(): Promise<unknown>
  persist(key: SettingKey, value: unknown, all: Settings): Promise<void>
  /** Changes made elsewhere (another window / tab). Returns an unsubscribe function. */
  subscribe?(onRemote: (key: string, value: unknown) => void): () => void
}

export function createSettingsStore(backend: SettingsBackend): SettingsApi & { dispose(): void } {
  let values: Settings = { ...SETTINGS_DEFAULTS }
  const changes = new Emitter<[SettingKey, unknown]>()
  const apply = (key: SettingKey, value: unknown) => {
    values = { ...values, [key]: value }
    changes.emit(key, value)
  }
  const ready = backend.load().then(
    (raw) => {
      const loaded = normalizeSettings(raw)
      for (const k of Object.keys(loaded) as SettingKey[]) {
        if (JSON.stringify(loaded[k]) !== JSON.stringify(values[k])) apply(k, loaded[k])
      }
    },
    () => {
      // Unreadable settings: keep the defaults (never block the editor on settings).
    },
  )
  const off = backend.subscribe?.((key, value) => {
    if (isSettingKey(key) && isValidSetting(key, value)) apply(key, value)
  })
  return {
    ready,
    get: <K extends SettingKey>(key: K) => values[key] as SettingsSchema[K],
    all: () => ({ ...values }),
    async set<K extends SettingKey>(key: K, value: SettingsSchema[K]) {
      if (!isSettingKey(key)) throw new PlatformError("INVALID", `Unknown setting "${key}"`)
      if (!isValidSetting(key, value))
        throw new PlatformError("INVALID", `Invalid value for "${key}": ${JSON.stringify(value)}`)
      apply(key, value)
      await backend.persist(key, value, values)
    },
    async reset(key?: SettingKey) {
      const keys = key ? [key] : (Object.keys(SETTINGS_DEFAULTS) as SettingKey[])
      for (const k of keys) {
        apply(k, SETTINGS_DEFAULTS[k])
        await backend.persist(k, SETTINGS_DEFAULTS[k], values)
      }
    },
    onChange(listener) {
      return changes.on((k, v) => listener(k, v as never))
    },
    dispose() {
      off?.()
      changes.clear()
    },
  }
}
