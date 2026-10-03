/**
 * Canvas conflict markers as a DOM overlay over the canvas (board 18): a `CanvasMarker/Conflict`
 * pill above every node that owns an open conflict and a 1.5px `$danger` outline around it
 * (selected nodes keep the selection outline). Positions come from {@link canvasConflictMarkers}
 * (layout + viewport). Mount it inside the canvas container (`position: relative`).
 */
import type { LayoutResult } from "@kimo/layout"
import { CanvasConflictMarker } from "@kimo/ui"
import { useSyncExternalStore } from "react"
import type { UiStore } from "../canvas/contract"
import type { Bus } from "../lib/hooks"
import { useConflictRows } from "./ConflictsPanel"
import { canvasConflictMarkers } from "./markers"
import type { EditorConflictSession } from "./session"
import "./conflicts.css"

export interface CanvasConflictOverlayProps {
  session: EditorConflictSession
  ui: UiStore
  /** The editor's layout bus (`Editor.tsx` `layout`). */
  layout: Bus<LayoutResult | null>
}

export function CanvasConflictOverlay({ session, ui, layout }: CanvasConflictOverlayProps) {
  const rows = useConflictRows(session)
  const viewport = useSyncExternalStore(ui.subscribe, () => ui.getState().viewport)
  const selection = useSyncExternalStore(ui.subscribe, () => ui.getState().selection)
  const result = useSyncExternalStore(layout.subscribe, layout.get)
  const markers = canvasConflictMarkers(rows, result, viewport, selection)
  if (markers.length === 0) return null
  return (
    <div className="conflict-overlay" data-testid="conflict-overlay">
      {markers.map((m) =>
        m.outline ? (
          <div
            key={`o-${m.nodeId}`}
            className="conflict-overlay__outline"
            data-node-id={m.nodeId}
            style={{
              left: m.outline.left,
              top: m.outline.top,
              width: m.outline.width,
              height: m.outline.height,
            }}
          />
        ) : null,
      )}
      {markers.map((m) => (
        <CanvasConflictMarker
          key={`m-${m.nodeId}`}
          className="conflict-overlay__marker"
          data-node-id={m.nodeId}
          label={m.label}
          style={{ left: m.left, top: m.top }}
          onClick={() => session.focus(m.conflictId)}
        />
      ))}
    </div>
  )
}
