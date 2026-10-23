/**
 * The agent's writes wait while it is paused or waiting for an area (board 41 › 7, ADR 0016
 * item 16). The document host already holds `agentCall` / `agentStream` of a paused agent
 * (`multiplayer-host.ts` `waitForAgent`); agents whose tools run in the window (web, untitled
 * documents) wrap their tool host here, so their loop calls
 * `pausesFor(claimsFor(store)).waitUntilResumed(origin)` before each write, and also waits for
 * an area the person chose to Wait for (`areaWaitsFor(store).gate`).
 *
 * AREA_BUSY answers are recorded by call id (`areaWaitsFor(store).busy(callId)`) for the
 * thread's card. Reads, undo and the rest go on. A streamed call does not stream while the agent is held: its
 * ops apply when the call itself runs.
 */
import type { ToolHost } from "@kimo/ai-agent"
import { claimsFor, type DocStore } from "@kimo/editor-state"
import { pausesFor } from "./agent-pause"
import { areaWaitsFor, parseAreaBusy } from "./area-busy"

/** Tools that write to the document (the ones a pause holds). */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(["kimo_apply_ops", "kimo_script"])

const aborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve()
    else signal.addEventListener("abort", () => resolve(), { once: true })
  })

/** `host` with writes held while `origin` is paused or waiting for an area of `store`. */
export function claimAwareToolHost(
  host: ToolHost,
  o: { origin: string; store: DocStore },
): ToolHost {
  const pauses = () => pausesFor(claimsFor(o.store))
  const waits = () => areaWaitsFor(o.store)
  const held = () => pauses().isPaused(o.origin) || waits().isWaiting(o.origin)
  const wrapped: ToolHost = {
    tools: () => host.tools(),
    async call(call, signal) {
      if (WRITE_TOOLS.has(call.name)) {
        await Promise.race([pauses().waitUntilResumed(o.origin), aborted(signal)])
        await waits().gate(o.origin, signal)
      }
      const out = await host.call(call, signal)
      // AREA_BUSY: the thread's card reads the holder and area by call id.
      if (!out.result.ok) {
        const busy = parseAreaBusy(out.result)
        if (busy) waits().noteBusy(call.id, o.origin, busy)
      }
      return out
    },
  }
  if (host.stream) {
    const stream = host.stream.bind(host)
    wrapped.stream = (call) => (WRITE_TOOLS.has(call.name) && held() ? undefined : stream(call))
  }
  if (host.note) wrapped.note = host.note.bind(host)
  if (host.turn) {
    const turn = host.turn.bind(host)
    wrapped.turn = (phase, turnId) => {
      // A turn that ends takes its area waits with it.
      if (phase === "end") waits().endTurn(o.origin)
      return turn(phase, turnId)
    }
  } else
    wrapped.turn = (phase) => {
      if (phase === "end") waits().endTurn(o.origin)
    }
  return wrapped
}
