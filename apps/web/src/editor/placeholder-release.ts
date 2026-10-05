/**
 * An agent flag never outlives its agent (ADR 0014 §9): this editor-window binding releases every
 * `placeholder` no live turn or MCP connection owns, at these moments:
 * 1. the file opens (nothing survives a restart or reload, so a flag found on open is stale;
 *    the only exception is the turn a Home hand-off is about to start),
 * 2. an MCP client that was connected goes away (a flag with no owner, `true`, goes with the
 *    last agent),
 * 3. a built-in turn ends (done, stopped, failed; API or local CLI), which also covers flags a
 *    local CLI wrote through MCP that no tool loop tracks,
 * 4. the window closes: the running turn stops, then its flags are released before the clean
 *    save (`FileSessionManager.addCloseHook`),
 * 5. the editor unmounts (leaving for Home, switching file) with a turn still running.
 */
import { useEffect, useRef } from "react"
import type { AgentPanelControllerExt } from "../agent-panel"
import { releaseStalePlaceholders } from "../agent-panel/release"
import type { AgentsControllerExt } from "../agents"
import type { FileSessionManager } from "../platform/session"
import type { FileSession } from "./session"

/** How long closing waits for a stopped turn to wind down before releasing the flags itself. */
const STOP_WAIT_MS = 1500

/** Stops the running turn (if any) and resolves when it settled or after `ms`. */
export function stopAgentTurn(c: AgentPanelControllerExt | null, ms = STOP_WAIT_MS): Promise<void> {
  if (!c?.state.busy) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let off = () => {}
    const done = () => {
      clearTimeout(timer)
      off()
      resolve()
    }
    const timer = setTimeout(done, ms)
    off = c.subscribe(() => {
      if (!c.state.busy) done()
    })
    c.stop()
  })
}

/** Origins of the MCP clients connected right now. */
const connectedOrigins = (a: AgentsControllerExt | null): Set<string> =>
  new Set(a?.state.connections.map((c) => c.origin) ?? [])

type Session = Pick<FileSession, "store" | "apply">
type Panel = Pick<AgentPanelControllerExt, "state" | "subscribe" | "stop">
type Agents = Pick<AgentsControllerExt, "state" | "subscribe">

/** Rule 1: on open, only the turn a Home hand-off is about to start keeps its flag. */
export function releaseOnOpen(session: Session, keepOwner: string | null = null): string[] {
  return releaseStalePlaceholders(session, (owner) => owner !== undefined && owner === keepOwner)
}

/** Rule 2: an MCP client that was connected goes away. Returns the unsubscribe. */
export function watchMcpClients(
  session: Session,
  agents: Agents,
  panel: () => Pick<AgentPanelControllerExt, "state"> | null = () => null,
): () => void {
  const seen = new Set<string>()
  const sync = () => {
    const now = connectedOrigins(agents as AgentsControllerExt)
    const gone = new Set([...seen].filter((x) => !now.has(x)))
    for (const x of now) seen.add(x)
    if (gone.size === 0) return
    for (const x of gone) seen.delete(x)
    const idle = now.size === 0 && !panel()?.state.busy
    releaseStalePlaceholders(session, (owner) => (owner === undefined ? !idle : !gone.has(owner)))
  }
  sync()
  return agents.subscribe(sync)
}

/** Rule 3: a built-in turn ends (API or local CLI). Returns the unsubscribe. */
export function watchTurns(
  session: Session,
  panel: Panel,
  agents: () => Agents | null = () => null,
): () => void {
  const turn = new Set<string>()
  let busy = panel.state.busy
  return panel.subscribe((s) => {
    if (s.busy) for (const x of s.canvas.live) turn.add(x)
    if (busy && !s.busy) {
      const connected = connectedOrigins(agents() as AgentsControllerExt | null)
      const mine = new Set(turn)
      turn.clear()
      releaseStalePlaceholders(session, (owner) =>
        owner === undefined ? connected.size > 0 : !mine.has(owner),
      )
    }
    busy = s.busy
  })
}

/** Rule 4: window close, after "Save changes?" and before the final flush. */
export async function releaseOnClose(
  session: Session,
  panel: Panel | null,
  agents: Agents | null,
): Promise<void> {
  await stopAgentTurn(panel as AgentPanelControllerExt | null)
  const connected = connectedOrigins(agents as AgentsControllerExt | null)
  releaseStalePlaceholders(session, (owner) => owner !== undefined && connected.has(owner))
}

/** Rule 5: the editor unmounts; the controller aborts its own turn, its flags go now. */
export function releaseOnUnmount(
  session: Session,
  agents: Agents | null,
  pendingOwner: string | null = null,
): string[] {
  const connected = connectedOrigins(agents as AgentsControllerExt | null)
  return releaseStalePlaceholders(
    session,
    (owner) => owner !== undefined && (connected.has(owner) || owner === pendingOwner),
  )
}

export function useReleaseStalePlaceholders(o: {
  session: FileSession
  manager: Pick<FileSessionManager, "addCloseHook">
  panel: AgentPanelControllerExt | null
  agents: AgentsControllerExt | null
  keepOwner: string | null
  pendingOwner?: () => string | null
}): void {
  const { session, manager, panel, agents } = o
  const latest = useRef(o)
  latest.current = o
  // Per opened file: open sweep, close hook, unmount sweep. A controller that is re-created
  // mid-session must not re-run these (that would release a live turn's flags).
  useEffect(() => {
    releaseOnOpen(session, latest.current.keepOwner)
    const off = manager.addCloseHook(() =>
      releaseOnClose(session, latest.current.panel, latest.current.agents),
    )
    return () => {
      off()
      releaseOnUnmount(session, latest.current.agents, latest.current.pendingOwner?.() ?? null)
    }
  }, [session, manager])
  useEffect(
    () => (agents ? watchMcpClients(session, agents, () => latest.current.panel) : undefined),
    [session, agents],
  )
  useEffect(
    () => (panel ? watchTurns(session, panel, () => latest.current.agents) : undefined),
    [session, panel],
  )
}
