/**
 * Language lookups over data packs. The package knows one pack, `en`, which is the fallback and
 * the source of `MessageKey`. Every other language is data the host registers at startup, so
 * adding one does not touch this package, the settings schema or a component.
 */
import en from "./locales/en.json"

export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>

/** A language id (BCP 47). The package never enumerates languages. */
export type Language = string

export interface LanguagePack {
  /** The `<html lang>` value; also what a screen reader announces. */
  tag: string
  messages: Messages
}

/** The fallback pack; its keys are the ids `t()` accepts. */
export const DEFAULT_LANGUAGE: Language = "en"

const packs = new Map<string, LanguagePack>([[DEFAULT_LANGUAGE, { tag: "en", messages: en }]])
let current: Language = DEFAULT_LANGUAGE
let messages: Messages = en
const listeners = new Set<() => void>()

/** Adds or replaces a pack. `default` makes it the fallback and the active language. */
export function registerLanguage(
  id: Language,
  pack: LanguagePack,
  opts?: { default?: boolean },
): void {
  packs.set(id, pack)
  if (!opts?.default) return
  current = id
  messages = pack.messages
  if (typeof document !== "undefined") document.documentElement.lang = pack.tag
  for (const l of listeners) l()
}

/** Registered ids, in registration order (the default first). */
export function listLanguages(): Language[] {
  return [...packs.keys()]
}

export function getLanguage(): Language {
  return current
}

/** Applies a registered pack; an unknown id is ignored, so a stale setting keeps the fallback. */
export function setLanguage(next: Language): void {
  const pack = packs.get(next)
  if (!pack || next === current) return
  current = next
  messages = pack.messages
  if (typeof document !== "undefined") document.documentElement.lang = pack.tag
  for (const l of listeners) l()
}

/**
 * The string for `key` in the current language. A missing key falls back to `en`; `{name}` in a
 * message is replaced by `vars.name`, so a translation can put the value where its word order
 * needs it.
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

/** Calls `listener` after every `setLanguage` or default registration. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
