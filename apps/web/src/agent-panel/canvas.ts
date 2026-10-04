/**
 * Agent panel → canvas (`CanvasProps.agentCanvas`, canvas/contract.ts M6): live origins, persona
 * and label per origin, enforced scopes, persona cursors and rejected-op flashes. The canvas
 * builder draws them (board 22 Modes, board 24 GmEAl); this file only maps the panel state.
 */
import type { AgentCanvasProps, CanvasAgentPersona } from "../canvas/contract"
import type { AgentPanelControllerExt, AgentPanelViewState } from "./controller"

const persona = (p: string): CanvasAgentPersona =>
  p === "teal" ? "agent" : (p as CanvasAgentPersona)

/** Maps the panel's canvas state to `AgentCanvasProps` (pass the result to the canvas). */
export function agentCanvasProps(
  state: AgentPanelViewState,
  controller: AgentPanelControllerExt,
  extra: Partial<AgentCanvasProps> = {},
): AgentCanvasProps {
  const c = state.canvas
  return {
    liveOrigins: new Set(c.live),
    agent(origin) {
      const i = c.info[origin]
      return i
        ? { label: i.label, persona: persona(i.persona), ops: i.ops, paused: i.paused }
        : null
    },
    scopes: c.scopes,
    cursors: c.cursors.map((x) => ({
      ...x,
      state:
        x.state === "waiting" || x.state === "paused" || x.state === "disconnected"
          ? "idle"
          : x.state,
    })),
    rejections: c.rejections,
    onPauseAgent: () => controller.stop(),
    ...extra,
  }
}
