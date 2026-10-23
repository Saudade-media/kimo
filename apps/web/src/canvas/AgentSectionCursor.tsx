/**
 * Board 36 "Agent on canvas" (desing.pen XDVdg): what an agent shows on the canvas while it
 * works, the same for the built-in agent and MCP clients: one cursor (pointer + name pill) on
 * the center of the section it works in, a 1 px outline on that section and, per landed edit,
 * one ring that fades on the section. Positions are screen px projected from world space by the
 * caller in the frame the canvas draws (board 31 "Position lock"); the float is a CSS offset on
 * an inner element, so it never moves the anchor.
 */
import { Icon } from "../lib/icons"
import { CURSOR_STACK, CURSOR_TIP } from "./agent-area"
import { CanvasAgentMark } from "./agent-mark"
import type { CanvasAgentMarkState, CanvasAgentPersona } from "./contract"
import "./agent-section.css"

export interface SectionBox {
  x: number
  y: number
  w: number
  h: number
  radius?: number
}

export interface SectionCursorView {
  /** Agent origin (stable key). */
  origin: string
  persona: CanvasAgentPersona
  /** One label per agent: the persona name, or the MCP client's name. */
  label: string
  /** AgentMark 12 face in the pill. */
  state: CanvasAgentMarkState
  /** The section box (screen), or null when it is not laid out. */
  section: SectionBox | null
  sectionId?: string
  /** The pointer tip (screen): the section center, gliding in world space. */
  tip: { x: number; y: number } | null
  /** Stack index among cursors in the same section (pills 26 px apart, lead on top). */
  stack: number
  flipX: boolean
  flipY: boolean
  /** "builtin" (agent panel) or "mcp" (an external client). */
  kind: "builtin" | "mcp"
  /**
   * False when the agent's area claim draws its outline instead (board 41 › 7: one outline per
   * agent). Default true.
   */
  outline?: boolean
}

export interface SectionFlashView {
  key: string
  persona: CanvasAgentPersona
  box: SectionBox
}

/** Pill flip thresholds (board 24 g rule 2, kept by board 36): within 8 px of a viewport edge. */
export function cursorFlip(
  tip: { x: number; y: number },
  view: { w: number; h: number },
  pill: { w: number; h: number } = { w: 180, h: 22 },
): { flipX: boolean; flipY: boolean } {
  const left = tip.x - CURSOR_TIP
  const top = tip.y - CURSOR_TIP
  return {
    flipX: view.w > 0 && left + pill.w > view.w - 8,
    flipY: view.h > 0 && top + 18 + 2 + pill.h > view.h - 8,
  }
}

export function SectionOutline({ view }: { view: SectionCursorView }) {
  const b = view.section
  if (!b || view.outline === false) return null
  return (
    <div
      className={`agent-section__outline agent-section--${view.persona}`}
      data-testid="agent-section-outline"
      data-origin={view.origin}
      data-kind={view.kind}
      {...(view.sectionId ? { "data-node-id": view.sectionId } : {})}
      style={{ left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: b.radius ?? 0 }}
    />
  )
}

export function SectionCursor({ view }: { view: SectionCursorView }) {
  const tip = view.tip
  if (!tip) return null
  return (
    <div
      className={`agent-section__cursor agent-section--${view.persona}${view.flipX ? " agent-section__cursor--flip-x" : ""}${view.flipY ? " agent-section__cursor--flip-y" : ""}`}
      data-testid="agent-cursor"
      data-origin={view.origin}
      data-kind={view.kind}
      style={{ left: tip.x - CURSOR_TIP, top: tip.y - CURSOR_TIP + view.stack * CURSOR_STACK }}
    >
      <div className="agent-section__float">
        <span className="agent-section__pointer">
          <Icon name="mouse-pointer-2" size={18} />
        </span>
        <div className="agent-section__pill">
          <CanvasAgentMark state={view.state} persona={view.persona} size={12} />
          <span className="agent-section__label">{view.label}</span>
        </div>
      </div>
    </div>
  )
}

export function SectionFlash({ flash }: { flash: SectionFlashView }) {
  const b = flash.box
  return (
    <div
      className={`agent-section__flash agent-section--${flash.persona}`}
      data-testid="agent-section-flash"
      style={{ left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: b.radius ?? 0 }}
    />
  )
}

/** Outlines under cursors; flashes under both. */
export function AgentSectionLayer({
  cursors,
  flashes,
}: {
  cursors: readonly SectionCursorView[]
  flashes: readonly SectionFlashView[]
}) {
  return (
    <>
      {flashes.map((f) => (
        <SectionFlash key={f.key} flash={f} />
      ))}
      {cursors.map((c) => (
        <SectionOutline key={`o:${c.origin}`} view={c} />
      ))}
      {cursors.map((c) => (
        <SectionCursor key={`c:${c.origin}`} view={c} />
      ))}
    </>
  )
}
