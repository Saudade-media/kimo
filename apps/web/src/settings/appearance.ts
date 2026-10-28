/**
 * General › Appearance → the `[data-theme]` the editor chrome reads (lib/theme). `system`
 * follows `prefers-color-scheme` live.
 */
import type { Appearance, SettingsApi } from "@kimo/platform"

export type ThemeSetter = (mode: "light" | "dark") => void

/** The concrete mode for an appearance setting. */
function resolveAppearance(a: Appearance, prefersDark: boolean): "light" | "dark" {
  return a === "system" ? (prefersDark ? "dark" : "light") : a
}

/** Applies the setting now and on every change; returns an unsubscribe function. */
export function bindAppearance(settings: SettingsApi, setTheme: ThemeSetter): () => void {
  const mq =
    typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined
  const apply = () =>
    setTheme(resolveAppearance(settings.get("general.appearance"), mq?.matches ?? false))
  apply()
  const off = settings.onChange((key) => {
    if (key === "general.appearance") apply()
  })
  const onMq = () => {
    if (settings.get("general.appearance") === "system") apply()
  }
  mq?.addEventListener("change", onMq)
  return () => {
    off()
    mq?.removeEventListener("change", onMq)
  }
}
