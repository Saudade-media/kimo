/**
 * The app's view of @kimo/i18n. The package holds the language packs and the lookups, with no
 * framework dependency; the React binding lives here because only apps may depend on React.
 */
import { DEFAULT_LANGUAGE, getLanguage, subscribe } from "@kimo/i18n"
import { useSyncExternalStore } from "react"

export { getLanguage, LANGUAGES, type MessageKey, setLanguage, t, tn } from "@kimo/i18n"

/** Subscribes the calling component to language changes; one call at the root is enough. */
export function useLanguage() {
  return useSyncExternalStore(subscribe, getLanguage, () => DEFAULT_LANGUAGE)
}
