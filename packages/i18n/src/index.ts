/**
 * Language packs as data plus the lookups over them. No framework here: `t()` works anywhere
 * (menus, model helpers, tests, the CLI). The host app owns the React binding, because only apps
 * may depend on React.
 */
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  type Language,
  type MessageKey,
  type Messages,
} from "./locales"
import en from "./locales/en.json"

let messages: Messages = en
let language: Language = DEFAULT_LANGUAGE
const listeners = new Set<() => void>()

/** The language applied right now; `DEFAULT_LANGUAGE` until the host loads a pack. */
export function getLanguage(): Language {
  return language
}

/** Loads `next`'s pack and notifies subscribers. The value itself is kept by the host app. */
export async function setLanguage(next: Language): Promise<void> {
  if (next === language) return
  const pack = LANGUAGES[next]
  messages = next === DEFAULT_LANGUAGE ? en : (await pack.load()).default
  language = next
  if (typeof document !== "undefined") document.documentElement.lang = pack.tag
  for (const l of listeners) l()
}

/**
 * The string for `key` in the current language. `{name}` is replaced by `vars.name`, so a
 * translation can put the value where its own word order needs it.
 */
export function t(key: MessageKey, vars?: Record<string, string>): string {
  const text = messages[key] ?? en[key]
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole)
}

/** `one` for a count of 1, else `other` (English needs the pair; Chinese repeats the text). */
export function tn(
  one: MessageKey,
  other: MessageKey,
  n: number,
  vars?: Record<string, string>,
): string {
  return t(n === 1 ? one : other, { ...vars, n: String(n) })
}

/** Calls `listener` after every `setLanguage`; returns an unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export type { Language, MessageKey } from "./locales"
export { DEFAULT_LANGUAGE, LANGUAGES }
