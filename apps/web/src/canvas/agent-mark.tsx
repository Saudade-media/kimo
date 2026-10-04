/**
 * AgentMark on the canvas (board 24 iLW1l "AgentMark component" QofdJ, `@kimo/ui`). The canvas
 * speaks `{state, persona, size}` with persona `agent` for the lead (the canvas / renderer
 * name of the teal hue); `@kimo/ui` calls it `teal`.
 */
import { AgentMark, type Persona } from "@kimo/ui"
import type { CanvasAgentMarkState, CanvasAgentPersona } from "./contract"

export interface CanvasAgentMarkProps {
  state: CanvasAgentMarkState
  persona: CanvasAgentPersona
  size: 12 | 16 | 24 | 32
  className?: string
}

const toUi = (p: CanvasAgentPersona): Persona => (p === "agent" ? "teal" : p)

export function CanvasAgentMark({ state, persona, size, className }: CanvasAgentMarkProps) {
  return <AgentMark state={state} persona={toUi(persona)} size={size} className={className} />
}
