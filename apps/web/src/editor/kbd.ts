/**
 * Shortcut hints in editor menus, Kbds and copy (E12): the design's macOS glyphs on macOS,
 * spelled modifiers elsewhere ("⌘K" → "Ctrl+K", "⌥⌘B" → "Ctrl+Alt+B"), from SHORTCUTS.
 */
import {
  type Combo,
  currentPlatform,
  formatCombo,
  SHORTCUTS,
  shortcutLabel,
} from "../shortcuts/shortcuts"

/** Shortcut `id`'s hint; on macOS `mac` (the design's glyphs) when given. */
export function keyHint(id: string, mac?: string): string {
  return mac !== undefined && currentPlatform() === "mac" ? mac : shortcutLabel(id)
}

/** A combo with no SHORTCUTS row (⌘↵ in the page switcher), formatted for this OS. */
export function comboHint(combo: Combo): string {
  return formatCombo(combo, currentPlatform())
}

/** The SHORTCUTS row of each floating-toolbar tool whose id isn't `tool.<id>`. */
const TOOL_SHORTCUT_IDS: Readonly<Record<string, string>> = { component: "createComponent" }

/**
 * A floating-toolbar tool's tooltip / flyout hint (`spec.shortcut` is the design's macOS
 * glyphs: "⇧⌘K" → "Ctrl+Shift+K" off macOS). Empty when the tool has no shortcut.
 */
export function toolHint(spec: { id: string; shortcut: string }): string {
  if (!spec.shortcut) return ""
  const id = TOOL_SHORTCUT_IDS[spec.id] ?? `tool.${spec.id}`
  return SHORTCUTS[id] ? keyHint(id, spec.shortcut) : spec.shortcut
}

/** The command modifier in hint copy: "⌘" on macOS, "Ctrl" elsewhere. */
export function modKeyHint(): string {
  return currentPlatform() === "mac" ? "⌘" : "Ctrl"
}
