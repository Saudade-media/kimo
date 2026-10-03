/**
 * Board 18 "Merge conflicts" for the editor (ADR 0012 builder 3). Mount points are listed in
 * `INTEGRATION.md` next to this file.
 */
export { CanvasConflictOverlay, type CanvasConflictOverlayProps } from "./CanvasConflictOverlay"
export {
  ConflictsPanel,
  type ConflictsPanelProps,
  conflictsTabLabel,
  useConflictRows,
} from "./ConflictsPanel"
export { hasOpenConflict, useOpenConflictNodes } from "./layers"
export {
  type CanvasConflictMarkerSpec,
  canvasConflictMarkers,
  MARKER_GAP,
  MARKER_HEIGHT,
  type MarkerLayout,
  markerLabel,
} from "./markers"
export { diffOps } from "./ops"
export {
  type ConflictSource,
  conflictRows,
  displayName,
  formatValue,
  groupRows,
  placementLabel,
  resolvedLabel,
  shortLabel,
  sideView,
  sourceLine,
} from "./rows"
export {
  type ConflictHost,
  type ConflictView,
  conflictSessionFactory,
  createConflictSession,
  type DocumentSessionLike,
  type EditorConflictSession,
} from "./session"
export { isNextConflictKey, stepConflict, useNextConflictShortcut } from "./shortcut"
