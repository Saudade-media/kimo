/**
 * The app's language packs: one JSON per language in `src/locales`, registered here. The React
 * binding lives in this file because only apps may depend on React.
 */
import {
  getLanguage,
  type Language,
  listLanguages,
  type MessageKey,
  registerLanguage,
  setLanguage,
  subscribe,
  t,
  tn,
} from "@kimo/i18n"
import { useSyncExternalStore } from "react"
import zhHans from "../locales/zh-Hans.json"

registerLanguage("zh-Hans", { tag: "zh-Hans", messages: zhHans })

export { getLanguage, type Language, listLanguages, type MessageKey, setLanguage, t, tn }

/** Subscribes the calling component to language changes; one call at the root is enough. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, getLanguage, () => "en")
}
