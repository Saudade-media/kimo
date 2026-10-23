/**
 * View only (board 41 section 9, PdEZA): what a View link may do, enforced from
 * `useCapabilities` (`viewOnly`, `canDuplicate`, `canShare`) at every entry point, not by
 * hiding buttons only:
 *
 * - Keyboard: a capture listener drops every shortcut that writes (or duplicates / saves a copy);
 *   select, inspect, pan, zoom, Preview, Export, Copy and the shortcut sheet stay.
 * - Tools: only Select (and Hand, which only pans) can be active; any other tool snaps back.
 * - File menu: Save and Save as… (a copy) are removed.
 * - Context menu: Copy only (`canvasMenuModel({ viewOnly })`).
 * - Right panel: dimmed and inert (`.editor--view-only`).
 * The document is also read-only (`store.setReadOnly`), so a write that slipped through is
 * rejected by the store.
 */
import { createContext } from "react"
import type { UiStore } from "../canvas/contract"
import type { Capabilities } from "../multiplayer/model"
import { matchCombo, SHORTCUT_LIST } from "../shortcuts/shortcuts"
import type { FileMenuActions } from "./FileMenu"

/** Shortcut ids a viewer keeps (everything else with a binding is dropped). */
export const VIEW_ONLY_SHORTCUTS: ReadonlySet<string> = new Set([
  "tool.move",
  "tool.hand",
  "openFile",
  "newFile",
  "exportDialog",
  "copyAsPng",
  "settings",
  "copy",
  "selectAll",
  "selectInverse",
  "selectChildren",
  "selectParent",
  "addToSelection",
  "selectInside",
  "variables",
  "zoomIn",
  "zoomOut",
  "zoom100",
  "pageSwitcher",
  "zoomToFit",
  "zoomToSelection",
  "view.pixelGrid",
  "view.rulers",
  "pan",
  "preview",
  "askKimo",
  "nextConflict",
  "previousConflict",
  "shortcuts",
  "gesture.cancel",
  "placement.cancel",
])

/** True inside a View link's editor: the right panel dims and goes inert. */
export const ViewOnlyContext = createContext(false)

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">

/**
 * True when `e` is a shortcut a viewer must not run: it matches the table, and none of the rows
 * it matches is in {@link VIEW_ONLY_SHORTCUTS}. Keys with no binding are never blocked.
 */
export function viewerKeyBlocked(e: KeyLike): boolean {
  let bound = false
  for (const s of SHORTCUT_LIST) {
    if (!s.combos.some((c) => matchCombo(c, e))) continue
    if (VIEW_ONLY_SHORTCUTS.has(s.id)) return false
    bound = true
  }
  return bound
}

/** Tools a viewer can use: Select, and Hand (it only pans). */
export function viewerToolAllowed(tool: string): boolean {
  return tool === "select" || tool === "hand"
}

/** The File menu a viewer sees: no Save, no Save as… (nothing duplicates the file). */
export function fileMenuFor(
  actions: FileMenuActions,
  caps: Pick<Capabilities, "canDuplicate">,
): FileMenuActions {
  if (caps.canDuplicate) return actions
  const { onSave: _save, onSaveAs: _saveAs, ...rest } = actions
  return rest
}

/**
 * Keeps the active tool on Select for a viewer: any other tool snaps back to Select at once
 * (the toolbar, the keys and the controller all go through `ui.setTool`). Returns the cleanup.
 */
export function guardViewerTool(ui: UiStore): () => void {
  const fix = () => {
    if (!viewerToolAllowed(ui.getState().tool)) ui.getState().setTool("select")
  }
  fix()
  return ui.subscribe(fix)
}
