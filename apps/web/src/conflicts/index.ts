/**
 * Board 18 "Merge conflicts" for the editor (ADR 0012 builder 3). Mount points are listed in
 * `INTEGRATION.md` next to this file.
 */
export { CanvasConflictOverlay } from "./CanvasConflictOverlay"
export { ConflictsPanel, conflictsTabLabel } from "./ConflictsPanel"
export { useOpenConflictNodes } from "./layers"
export { diffOps } from "./ops"
export {
  conflictSessionFactory,
  createConflictSession,
  type EditorConflictSession,
} from "./session"
export { useNextConflictShortcut } from "./shortcut"
