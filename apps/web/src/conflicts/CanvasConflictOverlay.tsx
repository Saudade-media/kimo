/**
 * Canvas conflict markers as a DOM overlay over the canvas (board 18): a `CanvasMarker/Conflict`
 * pill above every node that owns an open conflict and a 1.5px `$danger` outline around it
 * (selected nodes keep the selection outline). Positions come from {@link canvasConflictMarkers}
 * (layout + viewport). Board 20 stacking: two overlapping pills stack (the later one moves up by
 * pill height + 4); three or more show the first pill plus a "+N" `CanvasMarker/Conflict/More`
 * that opens a Menu/Dense of the hidden ones. Mount it inside the canvas container
 * (`position: relative`).
 */
import type { LayoutResult } from "@kimo/layout"
import { CanvasConflictMarker, MenuDense, MenuItemDense } from "@kimo/ui"
import { useMemo, useState, useSyncExternalStore } from "react"
import type { UiStore } from "../canvas/contract"
import type { Bus } from "../lib/hooks"
import { useConflictRows } from "./ConflictsPanel"
import {
  type CanvasConflictMoreSpec,
  canvasConflictMarkers,
  estimateMarkerWidth,
  type MarkerMeasure,
} from "./markers"
import type { EditorConflictSession } from "./session"
import "./conflicts.css"

export interface CanvasConflictOverlayProps {
  session: EditorConflictSession
  ui: UiStore
  /** The editor's layout bus (`Editor.tsx` `layout`). */
  layout: Bus<LayoutResult | null>
}

/**
 * Pill widths from the label font (sans 11 / 600, ar36v) through a 2D canvas, so stacking is
 * decided before the pills render. Falls back to {@link estimateMarkerWidth} without a canvas.
 */
function useMarkerMeasure(): MarkerMeasure {
  return useMemo(() => {
    const ctx =
      typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null
    if (!ctx) return estimateMarkerWidth
    const family =
      getComputedStyle(document.documentElement).getPropertyValue("--kimo-font-sans").trim() ||
      "Inter, sans-serif"
    ctx.font = `600 11px ${family}`
    const cache = new Map<string, number>()
    return (label, variant) => {
      const key = `${variant}\u0000${label}`
      let w = cache.get(key)
      if (w === undefined) {
        const text = ctx.measureText(label).width
        w = Math.ceil(variant === "more" ? 8 + text + 8 : 6 + 12 + 4 + text + 8)
        cache.set(key, w)
      }
      return w
    }
  }, [])
}

export function CanvasConflictOverlay({ session, ui, layout }: CanvasConflictOverlayProps) {
  const rows = useConflictRows(session)
  const viewport = useSyncExternalStore(ui.subscribe, () => ui.getState().viewport)
  const selection = useSyncExternalStore(ui.subscribe, () => ui.getState().selection)
  const result = useSyncExternalStore(layout.subscribe, layout.get)
  const measure = useMarkerMeasure()
  const { markers, more } = canvasConflictMarkers(rows, result, viewport, selection, measure)
  const [menu, setMenu] = useState<{ el: HTMLElement; spec: CanvasConflictMoreSpec } | null>(null)
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
      {markers.map((m) =>
        m.hidden ? null : (
          <CanvasConflictMarker
            key={`m-${m.nodeId}`}
            className="conflict-overlay__marker"
            data-node-id={m.nodeId}
            label={m.label}
            style={{ left: m.left, top: m.top }}
            onClick={() => session.focus(m.conflictId)}
          />
        ),
      )}
      {more.map((s) => (
        <CanvasConflictMarker
          key={`more-${s.hidden[0]?.nodeId ?? s.left}`}
          className="conflict-overlay__marker"
          variant="more"
          label={s.label}
          aria-label={`${s.hidden.length} more conflicts`}
          aria-haspopup="menu"
          aria-expanded={menu?.spec.label === s.label && menu.spec.left === s.left}
          style={{ left: s.left, top: s.top }}
          onClick={(e) => {
            const el = e.currentTarget
            setMenu((cur) => (cur?.el === el ? null : { el, spec: s }))
          }}
        />
      ))}
      {menu && (
        <MenuDense
          anchor={menu.el}
          label="Hidden conflicts"
          width={208}
          autoFocus
          onClose={() => setMenu(null)}
          className="conflict-overlay__menu"
        >
          {menu.spec.hidden.map((m) => (
            <MenuItemDense
              key={m.nodeId}
              label={m.label}
              onSelect={() => {
                setMenu(null)
                session.focus(m.conflictId)
              }}
            />
          ))}
        </MenuDense>
      )}
    </div>
  )
}
