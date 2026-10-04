/**
 * Resume the agent session that owned an orphaned placeholder (board 25 §3 kTwwU, rule jMJaL).
 *
 * A placeholder's owner is the origin `agent:kimo.<session>.<n>` of the turn that set it
 * (`placeholderFor`, `agentOrigin`). "Resume agent" reopens that session in the Agent tab and
 * sends a continuation: the new turn runs under the same session origin, so the frame's owner is
 * live again (tag back to "building", shimmer on) and the turn's tracker clears the flag when it
 * ends. If the session is gone (deleted, or the owner was another client), the menu offers
 * "Ask Kimo to finish" instead: a fresh composer prefilled with the request.
 *
 * Built only on the controller's public API (`openSession`, `send`, `newSession`, `setText`,
 * `setFocused`, `state.sessions`), so it works with any {@link AgentPanelControllerExt}.
 */
import { parseAgentOrigin } from "@kimo/ai-agent"
import type { AgentPanelControllerExt } from "./controller"

/** The owning Kimo session of a placeholder, as the context menu shows it. */
export interface PlaceholderSession {
  sessionId: string
  /**
   * "session N": 1-based position of the session among this file's sessions, oldest first
   * (Meta qScPD). Null when the session is not in this file's list (deleted / another file).
   */
  ordinal: number | null
}

/** The Kimo session behind a placeholder owner origin, or null (an MCP client / no owner). */
export function placeholderSession(
  controller: Pick<AgentPanelControllerExt, "state">,
  owner: string | undefined,
): PlaceholderSession | null {
  const parsed = owner ? parseAgentOrigin(owner) : null
  if (!parsed) return null
  const list = [...controller.state.sessions.thisFile].sort((a, b) => a.createdAt - b.createdAt)
  const i = list.findIndex((s) => s.id === parsed.session)
  return { sessionId: parsed.session, ordinal: i < 0 ? null : i + 1 }
}

/** The continuation sent to a resumed session. */
export function resumeMessage(frameName: string): string {
  return `Continue building ${frameName} — the previous run stopped before it finished.`
}

/** The composer text of "Ask Kimo to finish". */
export function finishMessage(frameName: string): string {
  return `Finish building ${frameName}.`
}

/**
 * Reopens `sessionId` and continues it. False when the session could not be opened (deleted
 * since the menu opened); the caller then falls back to {@link askKimoToFinish}.
 */
export async function resumeAgentSession(
  controller: AgentPanelControllerExt,
  sessionId: string,
  frameName: string,
): Promise<boolean> {
  if (controller.state.session?.id !== sessionId) await controller.openSession(sessionId)
  if (controller.state.session?.id !== sessionId) return false
  await controller.send(resumeMessage(frameName))
  return true
}

/** "Ask Kimo to finish": a new session, composer prefilled and focused (not sent). */
export function askKimoToFinish(controller: AgentPanelControllerExt, frameName: string): void {
  controller.newSession()
  controller.setText(finishMessage(frameName))
  controller.setFocused(true)
}
