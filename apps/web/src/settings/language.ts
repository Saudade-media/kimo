/**
 * General › Language. The pack is applied before the first render (main.tsx), so no window opens
 * in the previous language; a change loads the pack and redraws every open window.
 */
import type { Language, SettingsApi } from "@kimo/platform"

/** Applies the setting on every change; returns an unsubscribe function. */
export function watchLanguage(
  settings: SettingsApi,
  setLanguage: (v: Language) => Promise<void>,
): () => void {
  return settings.onChange((key) => {
    if (key === "general.language") void setLanguage(settings.get("general.language"))
  })
}
