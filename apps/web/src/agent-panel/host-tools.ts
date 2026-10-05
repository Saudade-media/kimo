/**
 * The document host's tool host (ADR 0014 §5, host RPC `agentCall`): on desktop, when the
 * window is a client of the document host, the built-in agent's tool calls run in the host —
 * the same M5 dispatch as MCP clients, under the agent's own `agent:kimo.<session>.<n>`
 * identity. So the agent shows in the host's presence list and activity log next to MCP
 * clients, MCP clients see its edits attributed to it, and its undo stack lives on the host
 * store (the window's replica receives its edits as `remote:agent:…`, never on the user's ⌘Z).
 *
 * What stays the window's: the agent's scope (the policy's `nodes`, checked by `checkScope` in
 * the host against the authoritative tree), approvals (forwarded back to the agent's in-thread
 * card, which waits until answered; Stop answers deny) and agent-only tools
 * (`kimo_spawn_agents`), which run here.
 *
 * Falls back to {@link createInWindowTools} when no host is connected or the document is
 * untitled (local to the window) — see `editor/agent-panel.tsx`.
 */
import { registryToolSpecs, type ToolHost, type ToolStream } from "@kimo/ai-agent"
import {
  type ApprovalOutcome,
  type ApprovalRequest,
  failure,
  type PartialEvent,
  PartialJsonObject,
  type StreamProgress,
  type ToolImage,
  type ToolResult,
} from "@kimo/mcp-server"
import type { HostClient } from "../host/client"
import type { ToolHostFactory } from "./tools"

export interface HostToolsOptions {
  client: HostClient
  /** The document's FileRef (the host session's ref). */
  ref: string
}

export interface HostTools {
  factory: ToolHostFactory
  /** The host's docId of `ref` ("" until known). */
  docId(): string
  /** Re-reads the docId (after a host restart). */
  refresh(): Promise<void>
  /**
   * Ends this window's agent connections (presence drops them; pending prompts answer deny).
   * Not terminal: a later call reconnects (React StrictMode re-runs effects).
   */
  dispose(): void
}

const OUTCOMES = new Set<ApprovalOutcome>(["deny", "once", "session", "auto", "timeout"])

export function createHostTools(o: HostToolsOptions): HostTools {
  let docId = ""
  const refresh = async () => {
    try {
      const r = await o.client.call<{ docId: string | null }>("agentDocId", { ref: o.ref })
      if (r.docId) docId = r.docId
    } catch {
      // The next call retries.
    }
  }
  void refresh()
  // After a host restart the window re-opens the file under a new epoch (new docId).
  o.client.onReady(() => {
    docId = ""
    setTimeout(() => void refresh(), 0)
  })
  const approvalOffs = new Map<string, () => void>()

  const factory: ToolHostFactory = (spec) => {
    const specs = [
      ...registryToolSpecs("desktop", spec.exclude),
      ...(spec.extra ?? []).map((t) => t.spec),
    ]
    const extra = new Map((spec.extra ?? []).map((t) => [t.spec.name, t]))
    const allowed = new Set(specs.map((s) => s.name))
    // Forwarded approvals for this origin go to this agent's card (Stop answers deny).
    approvalOffs.get(spec.origin)?.()
    approvalOffs.set(
      spec.origin,
      o.client.onAgentApproval(spec.origin, async (a) => {
        const outcome = await spec.requestApproval(a.request as ApprovalRequest)
        return OUTCOMES.has(outcome) ? outcome : "deny"
      }),
    )
    const wire = {
      origin: spec.origin,
      label: spec.label,
      session: spec.session,
      policy: spec.policy,
    }
    /** Streamed calls: the RPC chain of each (the call waits for it, so order holds). */
    const sends = new Map<string, { sent: () => Promise<void>; ran: () => void }>()
    const host: ToolHost = {
      tools: () => specs,
      stream(call) {
        if (call.name !== "kimo_apply_ops" || !allowed.has(call.name)) return undefined
        const s = rpcToolStream(o.client, "agentStream", "agentStreamClose", {
          spec: wire,
          callId: call.id,
        })
        sends.set(call.id, { sent: s.sent, ran: s.ran })
        return s.stream
      },
      async call(call, signal) {
        if (!allowed.has(call.name))
          return {
            result: failure({
              code: "PERMISSION_DENIED",
              message: `${call.name} is not available to this agent.`,
            }),
          }
        const own = extra.get(call.name)
        if (own) return own.run(call.input, signal)
        if (!docId) await refresh()
        // Every streamed op reached the host before the call that commits them; the call closes
        // the host's stream itself, so a later abort needs no RPC.
        const streamed = sends.get(call.id)
        sends.delete(call.id)
        await streamed?.sent()
        streamed?.ran()
        try {
          // No timeout: an approval waits until the person answers (ADR 0014 §5). Like the
          // in-window host, the signal never tears a running batch: the host commits or rolls
          // it back atomically.
          const r = await o.client.call<{ result: ToolResult; images?: ToolImage[] }>(
            "agentCall",
            { spec: wire, name: call.name, input: call.input, callId: call.id },
            Number.POSITIVE_INFINITY,
          )
          return r.images?.length ? { result: r.result, images: r.images } : { result: r.result }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          return {
            result: failure({
              code: /restarted|did not answer|disposed/.test(message) ? "TIMEOUT" : "INTERNAL",
              message: `The document host could not run ${call.name}: ${message}`,
              retryable: true,
            }),
          }
        }
      },
    }
    return host
  }

  return {
    factory,
    docId: () => docId,
    refresh,
    dispose() {
      const origins = [...approvalOffs.keys()]
      for (const off of approvalOffs.values()) off()
      approvalOffs.clear()
      if (origins.length) void o.client.call("agentRelease", { origins }).catch(() => {})
    },
  }
}

/**
 * A {@link ToolStream} that forwards a streamed call to the document host (ADR 0013 §4.7): the
 * window parses the partial input and sends each complete op (and field) as it closes, in
 * order, over host RPC `method`; the reply carries the host's progress (pointer, last layer).
 * `abort` rolls the host's provisional ops back (`closeMethod`).
 */
export function rpcToolStream(
  client: Pick<HostClient, "call">,
  method: string,
  closeMethod: string,
  args: Record<string, unknown>,
): { stream: ToolStream; sent: () => Promise<void>; ran: () => void } {
  const parser = new PartialJsonObject("ops")
  const listeners = new Set<(p: StreamProgress) => void>()
  let chain: Promise<void> = Promise.resolve()
  let closed = false
  let failed = false
  /** Events not sent yet: they go in one RPC when the one in flight answers. */
  let queue: PartialEvent[] = []
  let inFlight = false
  const send = (events: PartialEvent[]) => {
    queue.push(...events)
    if (inFlight) return
    inFlight = true
    chain = chain.then(async () => {
      while (queue.length && !closed && !failed) {
        const batch = queue
        queue = []
        try {
          const r = await client.call<{ progress: StreamProgress | null }>(method, {
            ...args,
            events: batch,
          })
          if (!r.progress) {
            // The host has no stream for this call: the call applies when it arrives.
            failed = true
            break
          }
          for (const l of [...listeners]) l(r.progress)
        } catch {
          failed = true
        }
      }
      inFlight = false
    })
  }
  const stream: ToolStream = {
    push(chunk) {
      const events = parser
        .push(chunk)
        .filter((e) => e.kind === "field" || e.kind === "item" || e.kind === "end")
      if (events.length) send(events)
    },
    event(e) {
      send([e])
    },
    abort(reason) {
      if (closed) return
      closed = true
      chain = chain.then(() =>
        client.call(closeMethod, { ...args, reason }).then(
          () => {},
          () => {},
        ),
      )
    },
    onProgress(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  return {
    stream,
    sent: () => chain,
    ran: () => {
      closed = true
    },
  }
}
