/**
 * Shortcut hints in editor menus, Kbds and copy (E12): the design's macOS glyphs on macOS,
 * spelled modifiers elsewhere ("⌘K" → "Ctrl+K", "⌥⌘B" → "Ctrl+Alt+B"), from SHORTCUTS.
 */
import { type Combo, currentPlatform, formatCombo, shortcutLabel } from "../shortcuts/shortcuts"

/** Shortcut `id`'s hint; on macOS `mac` (the design's glyphs) when given. */
export function keyHint(id: string, mac?: string): string {
  return mac !== undefined && currentPlatform() === "mac" ? mac : shortcutLabel(id)
}

/** A combo with no SHORTCUTS row (⌘↵ in the page switcher), formatted for this OS. */
export function comboHint(combo: Combo): string {
  return formatCombo(combo, currentPlatform())
}
