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

/** Writes a setting; reports a rejected write (INVALID / IO) through `onError`. */
export function useSetSetting(settings: SettingsApi, onError?: (e: unknown) => void) {
  return useCallback(
    <K extends SettingKey>(key: K, value: SettingsSchema[K]) => {
      settings.set(key, value).catch((e: unknown) => onError?.(e))
    },
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
