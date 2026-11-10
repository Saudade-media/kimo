import { type MessageKey, t } from "../lib/i18n"
/**
 * Every keyboard binding in Kimo — one table (board 25 §7 rules GJYcL "Single source": SHORTCUTS[]).
 * The handlers (Editor.tsx, canvas/controller.ts, CanvasHost.tsx, LeftPanel.tsx,
 * sections/TextSection.tsx, conflicts/shortcut.ts, settings/SettingsDialog.tsx) match key events
 * through {@link matches} / {@link matchCombo}, and the Keyboard shortcuts sheet (WcWPY) renders
 * the same rows, so the sheet can't drift from the code.
 *
 * A combo's modifiers are `true` (held), `false` (not held) or absent (either). "Mod" is ⌘ on
 * macOS and Ctrl elsewhere (both are accepted everywhere, as the handlers always did).
 */

export type ShortcutPlatform = "mac" | "other"

/** Where a binding is live; two combos in one scope may never match the same event. */
export type ShortcutScope =
  | "global" // the editor window (Editor.tsx, SettingsDialog, conflicts)
  | "canvas" // canvas commands (CanvasController; single keys need canvas focus)
  | "layers" // the focused Layers tree
  | "text-selected" // text nodes selected, focus outside fields (TextSection)
  | "text-edit" // the on-canvas text editor
  | "pointer" // modifier + click / drag on the canvas
  | "pen" // the Pen mode
  | "placement" // an armed image placement
  | "path-edit" // editing a path's anchors
  | "crop" // board 27 image crop mode
  | "gesture" // mid-drag

type ShortcutGroup =
  | "tools"
  | "file"
  | "edit"
  | "selection"
  | "components"
  | "view"
  | "agent-text"
  | "conflicts"
  | "help"

export interface Combo {
  /** `e.key` values (lowercase) that match. */
  keys?: readonly string[]
  /** `e.code` values that match (layout-independent, and stable under ⌥ on macOS). */
  codes?: readonly string[]
  mod?: boolean
  shift?: boolean
  alt?: boolean
  /** The key glyph shown on the sheet (after the modifier glyphs). */
  label: string
  /** Pointer gesture (`⇧ click`): never matched against key events. */
  pointer?: boolean
}

export interface Shortcut {
  id: string
  /** Action name on the sheet. */
  label: MessageKey
  scope: ShortcutScope
  /** Sheet group; absent → a mode-local binding the sheet doesn't list. */
  group?: ShortcutGroup
  /** Alternates, joined by "or" on the sheet. */
  combos: readonly Combo[]
  /** "new" badge (board 25: ⌘/ is the only binding added for v1). */
  isNew?: boolean
}

const ARROWS = ["arrowleft", "arrowright", "arrowup", "arrowdown"] as const

// Single-key tools: no ⌘/Ctrl, no ⌥, no ⇧ (Editor.tsx: `mod || e.altKey` return first).
const tool = (id: string, label: MessageKey, key: string): Shortcut => ({
  id,
  label,
  scope: "global",
  group: "tools",
  combos: [{ keys: [key], mod: false, alt: false, shift: false, label: key.toUpperCase() }],
})

// ⇧ + single key tools (board 27 shape slot).
const shiftTool = (id: string, label: MessageKey, key: string): Shortcut => ({
  id,
  label,
  scope: "global",
  group: "tools",
  combos: [{ keys: [key], mod: false, alt: false, shift: true, label: key.toUpperCase() }],
})

/** The table, in sheet order within each group. */
export const SHORTCUT_LIST: readonly Shortcut[] = [
  // --- Tools (CANVAS_TOOLS + Editor.tsx / controller.ts) -----------------------------------
  tool("tool.move", "ui.shortcuts.move", "v"),
  tool("tool.frame", "ui.shortcuts.frame", "f"),
  tool("tool.rectangle", "ui.shortcuts.rectangle", "r"),
  tool("tool.ellipse", "ui.shortcuts.ellipse", "o"),
  // Board 27 §5 shape slot (rule ZsJgx): Line L · Arrow ⇧L · Star ⇧S. The design's Polygon ⇧P
  // stays the Prompt tool's (board 22, lead decision): Polygon has no key, it is reached from
  // the shape slot flyout.
  tool("tool.line", "ui.shortcuts.line", "l"),
  shiftTool("tool.arrow", "ui.shortcuts.arrow", "l"),
  shiftTool("tool.star", "ui.shortcuts.star", "s"),
  tool("tool.text", "ui.shortcuts.text", "t"),
  tool("tool.pen", "ui.shortcuts.pen", "p"),
  tool("tool.note", "ui.shortcuts.note", "n"),
  shiftTool("tool.prompt", "ui.shortcuts.prompt", "p"),
  {
    id: "tool.image",
    label: "ui.shortcuts.image",
    scope: "global",
    group: "tools",
    combos: [{ keys: ["k"], mod: true, shift: true, label: "K" }],
  },
  {
    id: "iconPicker",
    label: "ui.shortcuts.icon-picker",
    scope: "canvas",
    group: "tools",
    combos: [{ keys: ["i"], mod: false, alt: false, shift: false, label: "I" }],
  },
  {
    id: "tool.hand",
    label: "ui.shortcuts.hand",
    scope: "global",
    group: "tools",
    combos: [{ keys: ["h"], mod: false, alt: false, shift: false, label: "H" }],
  },

  // --- File (Editor.tsx, SettingsDialog.tsx) ------------------------------------------------
  {
    id: "newFile",
    label: "ui.shortcuts.new-file",
    scope: "global",
    group: "file",
    combos: [{ keys: ["n"], mod: true, shift: false, label: "N" }],
  },
  {
    id: "openFile",
    label: "ui.shortcuts.open",
    scope: "global",
    group: "file",
    combos: [{ keys: ["o"], mod: true, label: "O" }],
  },
  {
    id: "save",
    label: "ui.shortcuts.save",
    scope: "global",
    group: "file",
    combos: [{ keys: ["s"], mod: true, shift: false, label: "S" }],
  },
  {
    id: "saveAs",
    label: "ui.shortcuts.save-as",
    scope: "global",
    group: "file",
    combos: [{ keys: ["s"], mod: true, shift: true, label: "S" }],
  },
  {
    id: "exportDialog",
    label: "ui.shortcuts.export",
    scope: "global",
    group: "file",
    combos: [{ keys: ["e"], codes: ["KeyE"], mod: true, shift: true, alt: false, label: "E" }],
  },
  {
    id: "copyAsPng",
    label: "ui.shortcuts.copy-selection-as-png",
    scope: "global",
    group: "file",
    combos: [{ keys: ["c"], codes: ["KeyC"], mod: true, shift: true, alt: false, label: "C" }],
  },
  {
    id: "settings",
    label: "ui.shortcuts.settings",
    scope: "global",
    group: "file",
    combos: [{ keys: [","], mod: true, shift: false, alt: false, label: "," }],
  },
  // Board 44 §5 "Home tab" / "Close" / "Switch" (tabs/model.ts `tabCommandFor`). Codes, not
  // keys: ⇧ turns ] into }. ⌘] / ⌘[ (Bring forward / Send backward) need no ⇧.
  {
    id: "newTab",
    label: "ui.shortcuts.new-tab",
    scope: "global",
    group: "file",
    combos: [{ keys: ["t"], codes: ["KeyT"], mod: true, shift: false, alt: false, label: "T" }],
  },
  {
    id: "closeTab",
    label: "ui.shortcuts.close-tab",
    scope: "global",
    group: "file",
    combos: [{ keys: ["w"], codes: ["KeyW"], mod: true, shift: false, alt: false, label: "W" }],
  },
  {
    id: "nextTab",
    label: "ui.shortcuts.next-tab",
    scope: "global",
    group: "file",
    combos: [{ codes: ["BracketRight"], mod: true, shift: true, alt: false, label: "]" }],
  },
  {
    id: "previousTab",
    label: "ui.shortcuts.previous-tab",
    scope: "global",
    group: "file",
    combos: [{ codes: ["BracketLeft"], mod: true, shift: true, alt: false, label: "[" }],
  },
  {
    id: "goToTab",
    label: "ui.shortcuts.go-to-tab-1-to-8",
    scope: "global",
    group: "file",
    combos: [
      {
        codes: ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8"],
        mod: true,
        shift: false,
        alt: false,
        label: "1…8",
      },
    ],
  },
  {
    id: "lastTab",
    label: "ui.shortcuts.last-tab",
    scope: "global",
    group: "file",
    combos: [{ codes: ["Digit9"], mod: true, shift: false, alt: false, label: "9" }],
  },

  // --- Edit -----------------------------------------------------------------------------------
  {
    id: "undo",
    label: "ui.shortcuts.undo",
    scope: "global",
    group: "edit",
    combos: [{ keys: ["z"], mod: true, shift: false, label: "Z" }],
  },
  {
    id: "redo",
    label: "ui.shortcuts.redo",
    scope: "global",
    group: "edit",
    combos: [
      { keys: ["z"], mod: true, shift: true, label: "Z" },
      { keys: ["y"], mod: true, label: "Y" },
    ],
  },
  // Board 27 §2 (g1jiG Edit menu, rules F1FPb): clipboard and structure commands
  // (editor/clipboard/useEditorCommands.ts).
  {
    id: "cut",
    label: "ui.shortcuts.cut",
    scope: "canvas",
    group: "edit",
    combos: [{ keys: ["x"], mod: true, shift: false, alt: false, label: "X" }],
  },
  {
    id: "copy",
    label: "ui.shortcuts.copy",
    scope: "canvas",
    group: "edit",
    combos: [{ keys: ["c"], mod: true, shift: false, alt: false, label: "C" }],
  },
  {
    id: "copyProperties",
    label: "ui.shortcuts.copy-properties",
    scope: "canvas",
    group: "edit",
    combos: [{ codes: ["KeyC"], mod: true, shift: false, alt: true, label: "C" }],
  },
  {
    id: "paste",
    label: "ui.shortcuts.paste",
    scope: "canvas",
    group: "edit",
    combos: [{ keys: ["v"], mod: true, shift: false, alt: false, label: "V" }],
  },
  {
    id: "pasteInPlace",
    label: "ui.shortcuts.paste-in-place",
    scope: "canvas",
    group: "edit",
    combos: [{ codes: ["KeyV"], mod: true, shift: true, alt: false, label: "V" }],
  },
  {
    id: "pasteProperties",
    label: "ui.shortcuts.paste-properties",
    scope: "canvas",
    group: "edit",
    combos: [{ codes: ["KeyV"], mod: true, shift: false, alt: true, label: "V" }],
  },
  {
    id: "duplicate",
    label: "ui.shortcuts.duplicate",
    scope: "canvas",
    group: "edit",
    combos: [{ keys: ["d"], mod: true, shift: false, alt: false, label: "D" }],
  },
  {
    id: "group",
    label: "ui.shortcuts.group",
    scope: "canvas",
    group: "edit",
    combos: [{ keys: ["g"], mod: true, shift: false, alt: false, label: "G" }],
  },
  {
    id: "ungroup",
    label: "ui.shortcuts.ungroup",
    scope: "canvas",
    group: "edit",
    combos: [{ codes: ["KeyG"], mod: true, shift: true, alt: false, label: "G" }],
  },
  {
    id: "wrapInFrame",
    label: "ui.shortcuts.wrap-in-frame",
    scope: "canvas",
    group: "edit",
    combos: [{ codes: ["KeyG"], mod: true, shift: false, alt: true, label: "G" }],
  },
  {
    id: "addAutoLayout",
    label: "ui.shortcuts.add-auto-layout",
    scope: "canvas",
    group: "edit",
    combos: [{ codes: ["KeyA"], mod: false, shift: true, alt: false, label: "A" }],
  },
  {
    id: "removeAutoLayout",
    label: "ui.shortcuts.remove-auto-layout",
    scope: "canvas",
    group: "edit",
    combos: [{ codes: ["KeyA"], mod: false, shift: true, alt: true, label: "A" }],
  },
  {
    id: "bringToFront",
    label: "ui.shortcuts.bring-to-front",
    scope: "canvas",
    group: "edit",
    combos: [{ codes: ["BracketRight"], mod: true, shift: false, alt: false, label: "]" }],
  },
  {
    id: "sendToBack",
    label: "ui.shortcuts.send-to-back",
    scope: "canvas",
    group: "edit",
    combos: [{ codes: ["BracketLeft"], mod: true, shift: false, alt: false, label: "[" }],
  },
  {
    id: "delete",
    label: "ui.shortcuts.delete",
    scope: "canvas",
    group: "edit",
    combos: [{ keys: ["backspace", "delete"], mod: false, alt: false, label: "⌫" }],
  },
  {
    id: "nudge",
    label: "ui.shortcuts.nudge-1-px-10-px",
    scope: "canvas",
    group: "edit",
    combos: [
      { keys: ARROWS, mod: false, alt: false, shift: false, label: "←↑→↓" },
      { keys: ARROWS, mod: false, alt: false, shift: true, label: "←" },
    ],
  },
  {
    // Board 27 §4 rule bFozp "Nudge … Applies to arrow-key moves and Alt-arrow resize".
    id: "nudgeResize",
    label: "ui.shortcuts.resize-by-nudge",
    scope: "canvas",
    group: "edit",
    combos: [{ keys: ARROWS, mod: false, alt: true, label: "←↑→↓" }],
  },
  {
    // Board 27 §6 rule K0t6s: ⇧H / ⇧V.
    id: "flipHorizontal",
    label: "ui.shortcuts.flip-horizontal",
    scope: "canvas",
    group: "edit",
    combos: [{ keys: ["h"], mod: false, alt: false, shift: true, label: "H" }],
  },
  {
    id: "flipVertical",
    label: "ui.shortcuts.flip-vertical",
    scope: "canvas",
    group: "edit",
    combos: [{ keys: ["v"], mod: false, alt: false, shift: true, label: "V" }],
  },
  {
    id: "renameLayer",
    label: "ui.shortcuts.rename-layer",
    scope: "layers",
    group: "edit",
    combos: [{ keys: ["f2"], label: "F2" }],
  },

  // --- Selection & layers ------------------------------------------------------------------------
  {
    id: "selectAll",
    label: "ui.shortcuts.select-all",
    scope: "canvas",
    group: "selection",
    combos: [{ keys: ["a"], mod: true, shift: false, alt: false, label: "A" }],
  },
  {
    id: "selectInverse",
    label: "ui.shortcuts.select-inverse",
    scope: "canvas",
    group: "selection",
    combos: [{ codes: ["KeyA"], mod: true, shift: true, alt: false, label: "A" }],
  },
  {
    id: "selectChildren",
    label: "ui.shortcuts.select-children",
    scope: "canvas",
    group: "selection",
    combos: [{ keys: ["enter"], mod: false, alt: false, shift: false, label: "↵" }],
  },
  {
    id: "selectParent",
    label: "ui.shortcuts.select-parent-deselect",
    scope: "canvas",
    group: "selection",
    combos: [{ keys: ["escape"], mod: false, alt: false, label: "Esc" }],
  },
  {
    id: "addToSelection",
    label: "ui.shortcuts.add-to-selection",
    scope: "pointer",
    group: "selection",
    combos: [{ pointer: true, shift: true, label: "click" }],
  },
  {
    id: "selectInside",
    label: "ui.shortcuts.select-inside-group",
    scope: "pointer",
    group: "selection",
    combos: [{ pointer: true, mod: true, label: "click" }],
  },
  {
    id: "toggleHidden",
    label: "ui.shortcuts.hide-show",
    scope: "layers",
    group: "selection",
    combos: [{ keys: ["h"], mod: true, shift: true, label: "H" }],
  },
  {
    id: "toggleLocked",
    label: "ui.shortcuts.toggle-lock",
    scope: "layers",
    group: "selection",
    combos: [{ keys: ["l"], mod: true, shift: true, label: "L" }],
  },

  // --- Components & variables (M3) ---------------------------------------------------------------
  {
    id: "createComponent",
    label: "ui.shortcuts.create-component",
    scope: "global",
    group: "components",
    // ⌥⇧⌘K is Image (checked first, as it always was).
    combos: [{ codes: ["KeyK"], mod: true, alt: true, shift: false, label: "K" }],
  },
  {
    id: "detachInstance",
    label: "ui.shortcuts.detach-instance",
    scope: "global",
    group: "components",
    combos: [{ codes: ["KeyB"], mod: true, alt: true, label: "B" }],
  },
  {
    id: "goToMain",
    label: "ui.shortcuts.go-to-main-component",
    scope: "global",
    group: "components",
    combos: [{ keys: ["enter"], mod: false, alt: true, label: "↵" }],
  },
  {
    id: "variables",
    label: "ui.shortcuts.variables",
    scope: "global",
    group: "components",
    // Board 27 §2 gives ⇧⌘V to Paste in place; the Variables dialog moves to ⌥⇧⌘V.
    combos: [{ codes: ["KeyV"], mod: true, shift: true, alt: true, label: "V" }],
  },

  // --- View ------------------------------------------------------------------------------------
  {
    id: "zoomIn",
    label: "ui.shortcuts.zoom-in",
    scope: "canvas",
    group: "view",
    combos: [
      { keys: ["=", "+"], mod: true, label: "=" },
      { keys: ["=", "+"], mod: false, alt: false, label: "=" },
    ],
  },
  {
    id: "zoomOut",
    label: "ui.shortcuts.zoom-out",
    scope: "canvas",
    group: "view",
    combos: [
      { keys: ["-"], mod: true, label: "−" },
      { keys: ["-", "_"], mod: false, alt: false, label: "−" },
    ],
  },
  {
    id: "zoom100",
    label: "ui.shortcuts.zoom-to-100",
    scope: "canvas",
    group: "view",
    combos: [
      // Editor.tsx (works without a mounted canvas too).
      { keys: ["0"], mod: true, label: "0" },
      { codes: ["Digit0"], mod: false, alt: false, shift: true, label: "0" },
    ],
  },
  {
    // Board 27 §1 (c) C1rd4: the ⌘P page switcher.
    id: "pageSwitcher",
    label: "ui.shortcuts.go-to-page",
    scope: "global",
    group: "view",
    combos: [{ keys: ["p"], mod: true, shift: false, alt: false, label: "P" }],
  },
  {
    id: "zoomToFit",
    label: "ui.shortcuts.zoom-to-fit",
    scope: "canvas",
    group: "view",
    combos: [{ codes: ["Digit1"], mod: false, alt: false, shift: true, label: "1" }],
  },
  {
    id: "zoomToSelection",
    label: "ui.shortcuts.zoom-to-selection",
    scope: "canvas",
    group: "view",
    combos: [{ codes: ["Digit2"], mod: false, alt: false, shift: true, label: "2" }],
  },
  {
    // Board 27 §4 View menu (rmQMe): Pixel grid ⇧'.
    id: "view.pixelGrid",
    label: "ui.shortcuts.pixel-grid",
    scope: "global",
    group: "view",
    combos: [{ codes: ["Quote"], mod: false, alt: false, shift: true, label: "'" }],
  },
  {
    // Board 27 §4 rule YwZyP "Rulers ⇧R".
    id: "view.rulers",
    label: "ui.shortcuts.rulers",
    scope: "global",
    group: "view",
    combos: [{ keys: ["r"], mod: false, alt: false, shift: true, label: "R" }],
  },
  {
    id: "pan",
    label: "ui.shortcuts.pan",
    scope: "canvas",
    group: "view",
    // shift: false — ⇧Space is Preview (board 27 §9).
    combos: [{ codes: ["Space"], mod: false, shift: false, label: "Space drag" }],
  },
  {
    // Board 27 §9 (j52y5f): Preview — topbar Play button, View › Preview, ⇧Space (Editor.tsx).
    id: "preview",
    label: "ui.shortcuts.preview",
    scope: "global",
    group: "view",
    combos: [{ codes: ["Space"], mod: false, alt: false, shift: true, label: "Space" }],
  },
  {
    // Board 44 §5 rule "Collapse": ⌘\ collapses both floating cards (or opens both again).
    id: "togglePanels",
    label: "ui.shortcuts.show-hide-panels",
    scope: "global",
    group: "view",
    combos: [{ codes: ["Backslash"], mod: true, alt: false, shift: false, label: "\\" }],
  },
  {
    // Desktop (tabs/useWindowTabs.ts): reloads the window; its tabs come back. The web build
    // leaves ⌘R to the browser.
    id: "reloadWindow",
    label: "ui.shortcuts.reload-window",
    scope: "global",
    group: "view",
    combos: [{ keys: ["r"], codes: ["KeyR"], mod: true, alt: false, shift: false, label: "R" }],
  },

  // --- Agent & text ------------------------------------------------------------------------------
  {
    id: "askKimo",
    label: "ui.shortcuts.ask-kimo",
    scope: "global",
    group: "agent-text",
    combos: [{ keys: ["k"], mod: true, shift: false, alt: false, label: "K" }],
  },
  {
    id: "link",
    label: "ui.shortcuts.link-text-selected",
    scope: "text-selected",
    group: "agent-text",
    combos: [{ codes: ["KeyK"], mod: true, shift: false, alt: false, label: "K" }],
  },
  {
    id: "italic",
    label: "ui.shortcuts.italic-text-selected",
    scope: "text-selected",
    group: "agent-text",
    combos: [{ codes: ["KeyI"], mod: true, shift: false, alt: false, label: "I" }],
  },
  {
    // Board 30 "Rich text": while editing a text, style the selected characters (or the next
    // typed ones at a collapsed caret). ⌘I and ⌘K also apply to the range while editing.
    id: "bold",
    label: "ui.shortcuts.bold-editing-text",
    scope: "text-edit",
    group: "agent-text",
    combos: [{ codes: ["KeyB"], mod: true, shift: false, alt: false, label: "B" }],
  },
  {
    id: "underline",
    label: "ui.shortcuts.underline-editing-text",
    scope: "text-edit",
    group: "agent-text",
    combos: [{ codes: ["KeyU"], mod: true, shift: false, alt: false, label: "U" }],
  },
  {
    id: "strikethrough",
    label: "ui.shortcuts.strikethrough-editing-text",
    scope: "text-edit",
    group: "agent-text",
    combos: [{ codes: ["KeyX"], mod: true, shift: true, alt: false, label: "X" }],
  },
  {
    id: "finishText",
    label: "ui.shortcuts.finish-editing-text",
    scope: "text-edit",
    group: "agent-text",
    combos: [
      { keys: ["enter"], mod: true, label: "↵" },
      { keys: ["escape"], label: "Esc" },
    ],
  },

  // --- Conflicts (board 18) -----------------------------------------------------------------------
  {
    id: "nextConflict",
    label: "ui.shortcuts.next-conflict",
    scope: "global",
    group: "conflicts",
    combos: [{ keys: ["'"], codes: ["Quote"], mod: true, alt: false, shift: false, label: "'" }],
  },
  {
    id: "previousConflict",
    label: "ui.shortcuts.previous-conflict",
    scope: "global",
    group: "conflicts",
    combos: [
      { keys: ["'", '"'], codes: ["Quote"], mod: true, alt: false, shift: true, label: "'" },
    ],
  },

  // --- Help ---------------------------------------------------------------------------------------
  {
    id: "shortcuts",
    label: "ui.shortcuts.keyboard-shortcuts",
    scope: "global",
    group: "help",
    isNew: true,
    combos: [{ keys: ["/"], mod: true, shift: false, alt: false, label: "/" }],
  },

  // --- Mode-local bindings (matched by the canvas, not listed on the sheet) -----------------------
  {
    id: "gesture.cancel",
    label: "ui.shortcuts.cancel-drag",
    scope: "gesture",
    combos: [{ keys: ["escape"], label: "Esc" }],
  },
  {
    id: "pen.finish",
    label: "ui.shortcuts.finish-path",
    scope: "pen",
    combos: [{ keys: ["enter", "escape"], mod: false, label: "↵" }],
  },
  {
    id: "pen.removePoint",
    label: "ui.shortcuts.remove-last-point",
    scope: "pen",
    combos: [{ keys: ["backspace", "delete"], mod: false, label: "⌫" }],
  },
  {
    id: "placement.cancel",
    label: "ui.shortcuts.cancel-placement",
    scope: "placement",
    combos: [{ keys: ["escape"], label: "Esc" }],
  },
  {
    id: "pathEdit.exit",
    label: "ui.shortcuts.exit-path-editing",
    scope: "path-edit",
    combos: [{ keys: ["enter", "escape"], mod: false, label: "↵" }],
  },
  {
    id: "pathEdit.deletePoints",
    label: "ui.shortcuts.delete-points",
    scope: "path-edit",
    combos: [{ keys: ["backspace", "delete"], mod: false, label: "⌫" }],
  },
  // Board 27 §6 (d) rules R6uRRw: Enter / Apply commits, Esc reverts.
  {
    id: "crop.apply",
    label: "ui.shortcuts.apply-crop",
    scope: "crop",
    combos: [{ keys: ["enter"], mod: false, label: "↵" }],
  },
  {
    id: "crop.cancel",
    label: "ui.shortcuts.cancel-crop",
    scope: "crop",
    combos: [{ keys: ["escape"], label: "Esc" }],
  },
]

/** The table by id. */
export const SHORTCUTS: Readonly<Record<string, Shortcut>> = Object.fromEntries(
  SHORTCUT_LIST.map((s) => [s.id, s]),
)

/** A table row by id (throws on a typo, so a handler can't silently match nothing). */
export function shortcut(id: string): Shortcut {
  const s = SHORTCUTS[id]
  if (!s) throw new Error(`Unknown shortcut "${id}"`)
  return s
}

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">

/** True when `e` is `combo` (pointer combos never match key events). */
export function matchCombo(combo: Combo, e: KeyLike): boolean {
  if (combo.pointer) return false
  const mod = e.metaKey || e.ctrlKey
  if (combo.mod !== undefined && combo.mod !== mod) return false
  if (combo.shift !== undefined && combo.shift !== e.shiftKey) return false
  if (combo.alt !== undefined && combo.alt !== e.altKey) return false
  const key = (e.key ?? "").toLowerCase()
  return !!(combo.keys?.includes(key) || combo.codes?.includes(e.code))
}

/** True when `e` matches any combo of the shortcut `id`. */
export function matches(id: string, e: KeyLike): boolean {
  return shortcut(id).combos.some((c) => matchCombo(c, e))
}

/** True while a pointer event holds the modifiers of the pointer shortcut `id` (`⇧ click`). */
export function pointerHeld(
  id: string,
  e: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): boolean {
  const c = shortcut(id).combos[0]
  if (!c?.pointer) return false
  if (c.mod && !(e.metaKey || e.ctrlKey)) return false
  if (c.shift && !e.shiftKey) return false
  if (c.alt && !e.altKey) return false
  return true
}

// --- Display ---------------------------------------------------------------------------------

/** The current OS (the sheet's platform switch default). */
export function currentPlatform(
  nav: { platform?: string; userAgent?: string } | undefined = globalThis.navigator,
): ShortcutPlatform {
  const p = `${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`
  return /Mac|iPhone|iPad|iPod/i.test(p) ? "mac" : "other"
}

/**
 * One combo as shown in a Kbd: macOS glyphs in Apple order (⌃⌥⇧⌘ then the key: "⇧⌘K", "⌥↵");
 * Windows · Linux spells the modifiers (footer QTqnj: ⌘ → Ctrl, ⌥ → Alt) joined with "+"
 * ("Ctrl+Shift+K"). Pointer combos read "⇧ click" / "Shift click".
 */
export function formatCombo(c: Combo, platform: ShortcutPlatform): string {
  const mac = platform === "mac"
  const mods: string[] = []
  if (mac) {
    if (c.alt) mods.push("⌥")
    if (c.shift) mods.push("⇧")
    if (c.mod) mods.push("⌘")
  } else {
    if (c.mod) mods.push("Ctrl")
    if (c.alt) mods.push("Alt")
    if (c.shift) mods.push("Shift")
  }
  if (c.pointer) return `${mods.join(mac ? "" : "+")} ${c.label}`
  if (mods.length === 0) return c.label
  return mac ? `${mods.join("")}${c.label}` : `${mods.join("+")}+${c.label}`
}

/** A shortcut's visible combos, formatted (the sheet's Kbds, "or" between them). */
export function formatShortcut(s: Shortcut, platform: ShortcutPlatform): string[] {
  return s.combos.map((c) => formatCombo(c, platform))
}

/** Sheet groups (rules GrX3H), with their column (WcWPY Body › Column 1–3). */
export const SHORTCUT_GROUPS: readonly {
  id: ShortcutGroup
  title: MessageKey
  column: 1 | 2 | 3
}[] = [
  { id: "tools", title: "ui.shortcuts.tools", column: 1 },
  { id: "file", title: "ui.shortcuts.file", column: 1 },
  { id: "edit", title: "ui.shortcuts.edit", column: 2 },
  { id: "selection", title: "ui.shortcuts.selection-layers", column: 2 },
  { id: "components", title: "ui.shortcuts.components-variables", column: 2 },
  { id: "view", title: "ui.shortcuts.view", column: 3 },
  { id: "agent-text", title: "ui.shortcuts.agent-text", column: 3 },
  { id: "conflicts", title: "ui.shortcuts.conflicts", column: 3 },
  { id: "help", title: "ui.shortcuts.help", column: 3 },
]

interface SheetRow {
  id: string
  label: string
  combos: string[]
  isNew: boolean
}

interface SheetGroup {
  id: ShortcutGroup
  title: string
  column: 1 | 2 | 3
  rows: SheetRow[]
}

/**
 * The sheet's groups for `platform`, filtered by `query` (matches action names and the formatted
 * keys, case-insensitive; rules KEypW "Filter matches action names and keys"). Empty groups drop.
 */
export function sheetGroups(platform: ShortcutPlatform, query = ""): SheetGroup[] {
  const q = query.trim().toLowerCase()
  return SHORTCUT_GROUPS.map((g) => ({
    ...g,
    title: t(g.title),
    rows: SHORTCUT_LIST.filter((s) => s.group === g.id)
      .map((s) => ({
        id: s.id,
        label: t(s.label),
        combos: formatShortcut(s, platform),
        isNew: !!s.isNew,
      }))
      .filter(
        (r) =>
          !q ||
          r.label.toLowerCase().includes(q) ||
          r.combos.some((c) => c.toLowerCase().includes(q)),
      ),
  })).filter((g) => g.rows.length > 0)
}

/**
 * The first (primary) combo of shortcut `id`, formatted for `platform` (default: the current OS)
 * — for menu metas and tooltips ("⌘D", "Ctrl+D", "⌫").
 */
export function shortcutLabel(id: string, platform: ShortcutPlatform = currentPlatform()): string {
  const c = shortcut(id).combos[0]
  return c ? formatCombo(c, platform) : ""
}
