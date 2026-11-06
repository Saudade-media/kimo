/**
 * The language packs. A new language is a JSON file with the same keys as `en.json` plus one
 * entry in {@link LANGUAGES}; nothing else changes. `en` is imported eagerly because it is also
 * the fallback for a key the active pack is missing.
 */
import en from "./en.json"

export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>

export interface LocalePack {
  /** The `<html lang>` value; also what a screen reader announces. */
  tag: string
  /** The language's own name, as General › Language lists it. */
  label: string
  load: () => Promise<{ default: Messages }>
}

export const LANGUAGES = {
  en: { tag: "en", label: "English", load: async () => ({ default: en }) },
  "zh-Hans": { tag: "zh-Hans", label: "简体中文", load: () => import("./zh-Hans.json") },
} as const satisfies Record<string, LocalePack>

export type Language = keyof typeof LANGUAGES

export const DEFAULT_LANGUAGE: Language = "en"
