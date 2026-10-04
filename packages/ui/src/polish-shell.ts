/** Board 25 "v1 Polish" shell components (§3 context menu, §6 small states, §7 About / Help / shortcuts); re-exported from index.ts. */
export {
  CANVAS_CONTEXT_MENU_WIDTH,
  CanvasContextMenu,
  type CanvasContextMenuItem,
  type CanvasContextMenuProps,
} from "./canvas-context-menu/CanvasContextMenu"
// §6 small states (fork C)
export { CLOSE_PROMPT_MAX_NAME, closePromptName } from "./close-prompt/ClosePrompt"
export { CUSTOM_TAG_FORMAT_HINT, customTagHint } from "./custom-tag-field/CustomTagField"
export { DIALOG_WIDTH, type DialogSize } from "./dialog/Dialog"
export {
  LINK_ERROR,
  LINK_HINT,
  LINK_VALIDATE_DELAY_MS,
} from "./link-popover/LinkPopover"
export {
  OpenTypeFeatureRow,
  type OpenTypeFeatureRowProps,
} from "./opentype-feature-row/OpenTypeFeatureRow"
export {
  SHORTCUTS_SHEET_WIDTH,
  ShortcutsSheet,
  type ShortcutsSheetGroup,
  type ShortcutsSheetProps,
  type ShortcutsSheetRow,
} from "./shortcuts-sheet/ShortcutsSheet"
