/** React bindings for `platform.settings` / `platform.updater` (changes apply immediately). */
import type {
  KimoPlatform,
  SettingKey,
  Settings,
  SettingsApi,
  SettingsSchema,
  UpdaterStatus,
} from "@kimo/platform"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"

/** Every setting, re-rendering on any change (local or broadcast from another window). */
export function useSettings(settings: SettingsApi): Settings {
  const cache = useRef<Settings | null>(null)
  const subscribe = useCallback(
    (cb: () => void) =>
      settings.onChange(() => {
        cache.current = null
        cb()
      }),
    [settings],
  )
  const get = useCallback(() => {
    cache.current ??= settings.all()
    return cache.current
  }, [settings])
  return useSyncExternalStore(subscribe, get, get)
}

/**
 * Writes a setting; reports a rejected write (INVALID / IO) through `onError` with the key and
 * value that were refused. The store has already rolled the value back, so every control shows
 * what is really stored. Resolves to whether the write was saved.
 */
export function useSetSetting(
  settings: SettingsApi,
  onError?: (e: unknown, key: SettingKey, value: unknown) => void,
) {
  return useCallback(
    <K extends SettingKey>(key: K, value: SettingsSchema[K]): Promise<boolean> =>
      settings.set(key, value).then(
        () => true,
        (e: unknown) => {
          onError?.(e, key, value)
          return false
        },
      ),
    [settings, onError],
  )
}

/** The updater status, live. */
export function useUpdaterStatus(platform: KimoPlatform): UpdaterStatus {
  const [status, setStatus] = useState<UpdaterStatus>(() => platform.updater.status())
  useEffect(() => {
    setStatus(platform.updater.status())
    return platform.updater.onStatus(setStatus)
  }, [platform])
  return status
}

/** Resolves an async value and re-runs it when `deps` change; `reload()` forces a refresh. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [value, setValue] = useState<T | null>(null)
  const [tick, setTick] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are the caller's
  useEffect(() => {
    let live = true
    load().then(
      (v) => live && setValue(v),
      () => live && setValue(null),
    )
    return () => {
      live = false
    }
  }, [...deps, tick])
  return { value, reload: () => setTick((t) => t + 1) }
}
