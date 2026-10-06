/**
 * How the agent reaches the document (ADR 0014 §5): the same M5 tool registry, policy,
 * approvals, activity and presence as external MCP agents (ADR 0013), called **in process** —
 * no socket. The document host builder supplies the M5 `ToolContext` (origin
 * `agent:kimo.<session>.<n>`), the `ToolHandlers` and the `DispatchOptions`; this module turns
 * them into a {@link ToolHost} the loop can drive, plus agent-only tools (`kimo_spawn_agents`).
 */
import {
  type ApplyStream,
  type DispatchOptions,
  dispatch,
  failure,
  listTools,
  type PartialEvent,
  type StreamProgress,
  streamEngineOf,
  type ToolContext,
  type ToolHandlers,
  type ToolImage,
  type ToolResult,
  toMcpDescriptor,
} from "@kimo/mcp-server"
import type { ToolSpec } from "./types"
import type { WebNote } from "./web"

/** Result of one tool call as the loop sees it. */
export interface ToolOutcome {
  result: ToolResult
  images?: ToolImage[]
}

export interface ToolCallRequest {
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * A tool call the model is still writing (ADR 0013 §4.7). The loop pushes the streamed partial
 * input; the host applies complete ops provisionally and reports progress. The call itself
 * (`ToolHost.call` with the same id) commits or rolls back; `abort` rolls back a call that will
 * never run (stop, retry, a truncated input).
 */
export interface ToolStream {
  push(partialJson: string): void
  /** Already-parsed input events (a wrapper that maps ops parses once and forwards these). */
  event?(e: PartialEvent): void
  abort(reason: string): void
  onProgress(listener: (p: StreamProgress) => void): () => void
}

/** What the agent loop needs from the document side. */
export interface ToolHost {
  /** Tools offered to the model (stable order: prompt caching depends on it). */
  tools(): ToolSpec[]
  /**
   * Optional: starts streaming a tool call (`kimo_apply_ops` and `kimo_script` stream;
   * undefined for the rest and for hosts without streamed edits).
   */
  stream?(call: { id: string; name: string }): ToolStream | undefined
  /**
   * Runs one call. Never throws: failures are envelopes. `signal` is only for abandoning a
   * call that has not started; an in-flight op batch always commits or rolls back atomically.
   */
  call(call: ToolCallRequest, signal: AbortSignal): Promise<ToolOutcome>
  /**
   * Optional (board 38): a web search or page read the provider ran itself. The document host
   * writes it to the Activity log under the agent's origin.
   */
  note?(entry: WebNote): void
}

/** A tool implemented by the agent package itself (not in the M5 registry). */
export interface AgentTool {
  spec: ToolSpec
  run(input: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutcome>
}

/**
 * In-app approvals wait indefinitely (lead decision; external MCP keeps 2 minutes). The host's
 * `ToolContext.requestApproval` for `agent:*` origins must not time out; the panel shows the
 * prompt inline and Stop resolves it as `deny`.
 */
export const IN_APP_APPROVAL_TIMEOUT_MS = Number.POSITIVE_INFINITY

export interface RegistryToolHostOptions {
  /** The in-process M5 context for this agent (origin `agent:kimo.<session>.<n>`). */
  context: Omit<ToolContext, "signal">
  handlers: ToolHandlers
  dispatch: DispatchOptions
  /** Which registry availability column applies. */
  host: "desktop" | "web" | "headless"
  /** Tools the model must not see (e.g. children never get kimo_save / kimo_export / kimo_create). */
  exclude?: readonly string[]
  /** Agent-only tools appended after the registry tools. */
  extra?: readonly AgentTool[]
}

/** Converts the M5 registry into model-facing tool specs (portable-profile schemas, unchanged). */
export function registryToolSpecs(
  host: "desktop" | "web" | "headless",
  exclude: readonly string[] = [],
): ToolSpec[] {
  return listTools({ host })
    .filter((d) => !exclude.includes(d.name))
    .map((d) => {
      const m = toMcpDescriptor(d)
      return { name: m.name, description: m.description, inputSchema: m.inputSchema }
    })
}

export function createRegistryToolHost(opts: RegistryToolHostOptions): ToolHost {
  const specs = [
    ...registryToolSpecs(opts.host, opts.exclude),
    ...(opts.extra ?? []).map((t) => t.spec),
  ]
  const extra = new Map((opts.extra ?? []).map((t) => [t.spec.name, t]))
  const allowed = new Set(specs.map((s) => s.name))
  const engine = streamEngineOf(opts.handlers)
  const streams = new Map<string, ApplyStream>()
  let streamed = false
  return {
    tools: () => specs,
    stream(call) {
      if (!allowed.has(call.name) || !engine?.streams(call.name)) return undefined
      streamed = true
      const s = engine.open({
        callId: call.id,
        ctx: { ...opts.context, signal: new AbortController().signal, streamed: true },
        dispatch: opts.dispatch,
        tool: call.name,
      })
      streams.set(call.id, s)
      return {
        push: (chunk) => s.feed(chunk),
        event: (e) => s.event(e),
        abort: (reason) => {
          s.close(reason)
          streams.delete(call.id)
        },
        onProgress: (l) => s.onProgress(l),
      }
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
      // A fresh, never-aborted signal: Stop must not tear an op batch in half (board 22).
      const stream = streams.get(call.id)
      streams.delete(call.id)
      const ctx: ToolContext = {
        ...opts.context,
        signal: new AbortController().signal,
        ...(streamed ? { streamed: true } : {}),
        ...(stream ? { stream } : {}),
      }
      try {
        const out = await dispatch(call.name, call.input, ctx, opts.handlers, opts.dispatch)
        return out.images ? { result: out.result, images: out.images } : { result: out.result }
      } finally {
        stream?.close("The call did not commit the streamed ops.")
      }
    },
  }
}

/** Tools a spawned child never sees (coordinator-only; ADR 0014 §8). */
export const CHILD_EXCLUDED_TOOLS: readonly string[] = [
  "kimo_save",
  "kimo_export",
  "kimo_create",
  "kimo_open",
  "kimo_close",
]
