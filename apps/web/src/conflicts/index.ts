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
  type CanvasConflictMarkerLayout,
  type CanvasConflictMarkerSpec,
  type CanvasConflictMoreSpec,
  canvasConflictMarkers,
  estimateMarkerWidth,
  MARKER_GAP,
  MARKER_HEIGHT,
  type MarkerLayout,
  type MarkerMeasure,
  markerLabel,
  moreLabel,
  STACK_GAP,
  stackMarkers,
} from "./markers"
export { diffOps } from "./ops"
export {
  type ConflictSource,
  conflictRows,
  DOCUMENT_GROUP,
  displayName,
  formatValue,
  groupRows,
  placementLabel,
  resolvedLabel,
  shortLabel,
  sideView,
  sourceLine,
  VARIABLES_GROUP,
} from "./rows"
export {
  type ConflictHost,
  type ConflictView,
  conflictSessionFactory,
  createConflictSession,
  type DocumentSessionLike,
  type EditorConflictSession,
  reopenConflict,
} from "./session"
export { isNextConflictKey, stepConflict, useNextConflictShortcut } from "./shortcut"
