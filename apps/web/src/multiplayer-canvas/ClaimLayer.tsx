/**
 * Board 41 › 7 "Agent area claims" (desing.pen Ztma9): one outline and one tab per agent. The
 * claim outline replaces board 36's section outline (never both for one agent): 1 px inside the
 * claimed area in the persona hue (`fUxlN`), with the flush tab "<agent> is editing <frame>" in
 * its top-left corner (`bVPYz`: hue fill, radius 0 0 6 0, gap 5, padding [3, 8, 3, 4] ›
 * AgentMark 12 · label sans 11 / 500 on-accent); other people's agents add their owner ("Sol ·
 * Maya's agent is editing Pricing", `dI39E`) and get their cursor on the area's center (board
 * 36 cursor, `tATIY`). A paused agent hides its cursor; outline (`c9cvS`) and tab (`Vt30y`) turn
 * warning and the note docks to the right of the outline (`gnEkC`) with Resume now and Stop.
 */
import { useSyncExternalStore } from "react"
import { cursorFlip, SectionCursor } from "../canvas/AgentSectionCursor"
import { CanvasAgentMark } from "../canvas/agent-mark"
import type { UiStore } from "../canvas/contract"
import {
  type ClaimOutlineView,
  PAUSED_NOTE_GAP,
  PAUSED_NOTE_W,
  pausedNoteText,
} from "../multiplayer/canvas-model"

type Box = { x: number; y: number; w: number; h: number }

export interface ClaimLayerProps {
  outlines: readonly ClaimOutlineView[]
  ui: UiStore
  onResume(holder: string): void
  onStop(holder: string): void
  /** Section 11 D: agents whose text caret shows (their one cursor is that caret). */
  hideCursors?: ReadonlySet<string>
}

export function ClaimLayer({ outlines, ui, onResume, onStop, hideCursors }: ClaimLayerProps) {
  const getViewport = () => ui.getState().viewport
  const v = useSyncExternalStore(ui.subscribe, getViewport, getViewport)
  if (!outlines.length) return null
  const toScreen = (b: Box): Box => ({
    x: (b.x - v.x) * v.zoom,
    y: (b.y - v.y) * v.zoom,
    w: b.w * v.zoom,
    h: b.h * v.zoom,
  })
  return (
    <div className="mp-claims" data-testid="mp-claim-layer">
      {outlines.map((o) => {
        const b = toScreen(o.box)
        const tone = o.paused ? "warning" : o.persona
        return (
          <div key={o.holder} className="mp-claim-group" data-holder={o.holder}>
            <div
              className={`mp-claim__outline mp-claim--${tone}`}
              data-testid="mp-claim-outline"
              data-holder={o.holder}
              data-state={o.state}
              data-paused={o.paused ? "" : undefined}
              style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
            />
            <div
              className={`mp-claim__tag mp-claim--${tone}${o.paused ? " mp-claim__tag--paused" : ""}`}
              data-testid="mp-claim-tag"
              data-holder={o.holder}
              style={{ left: b.x, top: b.y }}
            >
              <CanvasAgentMark
                state={o.local && !o.paused ? "working" : "idle"}
                persona={o.persona}
                size={12}
              />
              <span className="mp-claim__tag-label">{o.tag}</span>
            </div>
            {o.paused && (
              <div
                className="mp-claim__note"
                data-testid="mp-paused-note"
                data-holder={o.holder}
                data-canvas-overlay=""
                style={{ left: b.x + b.w + PAUSED_NOTE_GAP, top: b.y, width: PAUSED_NOTE_W }}
              >
                <div className="mp-claim__note-head">
                  <CanvasAgentMark state="idle" persona={o.persona} size={12} />
                  <span className="mp-claim__note-title">{o.label} paused</span>
                </div>
                <span className="mp-claim__note-desc">{pausedNoteText(o.paused, o.frame)}</span>
                <div className="mp-claim__note-actions">
                  <button
                    type="button"
                    className="mp-claim__note-resume"
                    data-testid="mp-resume-now"
                    onClick={() => onResume(o.holder)}
                  >
                    Resume now
                  </button>
                  <button
                    type="button"
                    className="mp-claim__note-stop"
                    data-testid="mp-stop-agent"
                    onClick={() => onStop(o.holder)}
                  >
                    Stop
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
      {/* Other people's agents: their one cursor on their area's center (board 36 cursor). */}
      {outlines
        .filter((o) => !o.local && !o.paused && !hideCursors?.has(o.holder))
        .map((o) => {
          const b = toScreen(o.box)
          const tip = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
          return (
            <SectionCursor
              key={`c:${o.holder}`}
              view={{
                origin: o.holder,
                kind: o.holder.startsWith("mcp:") ? "mcp" : "builtin",
                persona: o.persona,
                label: o.label,
                state: "idle",
                section: b,
                tip,
                stack: 0,
                ...cursorFlip(tip, { w: 0, h: 0 }),
              }}
            />
          )
        })}
    </div>
  )
}
