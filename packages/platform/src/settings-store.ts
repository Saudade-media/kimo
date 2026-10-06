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
  // Keys written (set / reset / remote) before the initial load finished: the load must not
  // overwrite them with the persisted values, and their persist waits for the load so a backend
  // that writes the whole map (`all`) never replaces the persisted values with the defaults.
  const early = new Set<SettingKey>()
  let loaded = false
  const ready = backend
    .load()
    .then(
      (raw) => {
        const persisted = normalizeSettings(raw)
        for (const k of Object.keys(persisted) as SettingKey[]) {
          if (early.has(k)) continue
          if (JSON.stringify(persisted[k]) !== JSON.stringify(values[k])) apply(k, persisted[k])
        }
      },
      () => {
        // Unreadable settings: keep the defaults (never block the editor on settings).
      },
    )
    .finally(() => {
      loaded = true
      early.clear()
    })
  const write = async (key: SettingKey, value: unknown) => {
    const previous = values[key]
    apply(key, value)
    if (!loaded) {
      early.add(key)
      await ready
    }
    try {
      await backend.persist(key, value, values)
    } catch (e) {
      // The write was refused (read-only settings.json, IO): every control re-reads the stored
      // value instead of showing one that was never saved. A newer write of the same key wins.
      if (values[key] === value) apply(key, previous)
      throw e
    }
  }
  const off = backend.subscribe?.((key, value) => {
    if (!isSettingKey(key) || !isValidSetting(key, value)) return
    if (!loaded) early.add(key)
    apply(key, value)
  })
  return {
    ready,
    get: <K extends SettingKey>(key: K) => values[key] as SettingsSchema[K],
    all: () => ({ ...values }),
    async set<K extends SettingKey>(key: K, value: SettingsSchema[K]) {
      if (!isSettingKey(key)) throw new PlatformError("INVALID", `Unknown setting "${key}"`)
      if (!isValidSetting(key, value))
        throw new PlatformError("INVALID", `Invalid value for "${key}": ${JSON.stringify(value)}`)
      await write(key, value)
    },
    async reset(key?: SettingKey) {
      const keys = key ? [key] : (Object.keys(SETTINGS_DEFAULTS) as SettingKey[])
      for (const k of keys) await write(k, SETTINGS_DEFAULTS[k])
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
