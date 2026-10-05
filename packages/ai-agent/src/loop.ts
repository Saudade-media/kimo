/**
 * The agent loop (ADR 0014 §5–6): one user turn = model calls and M5 tool calls until the model
 * ends its turn, the user stops it, an error ends it or the budget pauses it.
 *
 *   provider.stream ─► text/thinking deltas, tool calls
 *        │ retryable error → backoff (≤ 5 attempts) · offline → pause until online
 *        ▼
 *   toolHost.call per tool call (M5 dispatch: validate → authorize → approval → handler)
 *        │ envelope → step end; undoToken → the turn's op groups (regenerate / undo turn)
 *        ▼
 *   tool results appended → next model call
 *
 * Every turn ends by clearing the placeholders it owns. Errors never roll back applied ops.
 */
import { failure, modelText, type ToolResult } from "@kimo/mcp-server"
import { backoffDelay, DEFAULT_RETRY, type RetryPolicy, sleep } from "./backoff"
import { type ErrorCard, errorCard } from "./cards"
import { isAbort, isProviderError, ProviderError } from "./errors"
import type { ModelInfo } from "./models"
import { PlaceholderTracker } from "./placeholder"
import { type CostEstimate, estimateCost } from "./pricing"
import { type StepNames, stepLabel } from "./progress"
import type { Provider } from "./providers/provider"
import type { ToolCallRequest, ToolHost, ToolOutcome } from "./toolhost"
import {
  type AssistantMessage,
  addUsage,
  type ChatMessage,
  type ModelSelection,
  type StopReason,
  type SystemPrompt,
  type ThinkingMode,
  type ToolCallPart,
  type ToolResultPart,
  type ToolResultsMessage,
  type Usage,
  type UserMessage,
  ZERO_USAGE,
} from "./types"

/** One op group applied by the turn (an M5 `kimo_apply_ops` / `kimo_import` success). */
export interface OpGroup {
  docId: string
  undoToken: string
  summary: string
  changed: string[]
  tool: string
}

export type TurnStatus = "done" | "stopped" | "error" | "budget" | "refusal" | "max_steps"

export interface TurnRecord {
  id: string
  model: ModelSelection
  thinking: ThinkingMode
  startedAt: number
  endedAt: number
  /** Messages this turn appended (user message first). Append-only. */
  messages: ChatMessage[]
  usage: Usage
  cost: CostEstimate
  /** In application order; regenerate / "Undo turn" undo them newest first. */
  opGroups: OpGroup[]
  /** Number of ops applied (sum over op groups). */
  opsApplied: number
  status: TurnStatus
  error?: ErrorCard
  /** Model that actually served the last call (server-side fallback may differ). */
  servedBy: string
  skillsUsed: string[]
  /** How the turn is billed. API turns: estimated dollars; subscription CLIs: tokens/turns only. */
  billing?: "api" | "subscription" | "cli-api-key" | "local"
  /** Local CLI turns: the CLI's own session id (resume) and the cost it reported, if any. */
  cli?: { id: string; sessionId?: string; reportedCostUsd?: number; turns?: number }
  /** Board 34: the thread lines of requests auto-approve let through ("Approved automatically: …"). */
  autoApproved?: string[]
}

/** Events for the agent panel (board 22 A: streaming text, AgentStep rows, live meta). */
export type AgentEvent =
  | { type: "turn_start"; turnId: string }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  /** The streamed partial assistant output is void (a retry will resend). */
  | { type: "discard_partial" }
  | {
      type: "step_start"
      callId: string
      tool: string
      label: string
      input: Record<string, unknown>
    }
  | {
      type: "step_end"
      callId: string
      tool: string
      ok: boolean
      summary: string
      changed: string[]
      undoToken?: string
      errorCode?: string
    }
  | { type: "usage"; usage: Usage; cost: CostEstimate }
  | { type: "message_end"; message: AssistantMessage; stopReason: StopReason }
  | { type: "retry"; card: ErrorCard }
  | { type: "paused"; card: ErrorCard }
  | { type: "resumed" }
  | { type: "turn_end"; record: TurnRecord }

export interface BudgetGuard {
  /** Called before each model call with the turn's cost so far; return a message to pause. */
  check(turnCostUsd: number): string | null
}

export interface RunTurnOptions {
  turnId: string
  provider: Provider
  model: ModelSelection
  info: ModelInfo
  thinking: ThinkingMode
  system: SystemPrompt
  history: readonly ChatMessage[]
  user: UserMessage
  tools: ToolHost
  /** Agent origin (`agent:kimo.<session>.<n>`) for placeholder ownership. */
  origin: string
  signal: AbortSignal
  onEvent(e: AgentEvent): void
  maxSteps?: number
  maxTokens?: number
  retry?: RetryPolicy
  budget?: BudgetGuard
  /** Resolves when the platform is online again (offline pause). Default: poll `online()` every 2 s. */
  waitForOnline?: (signal: AbortSignal) => Promise<void>
  online?: () => boolean
  skillsUsed?: string[]
  now?: () => number
  random?: () => number
  /** Free local runtimes estimate at $0. */
  free?: boolean
  /** Label for cards ("Anthropic"). */
  providerLabel?: string
  /** Layer names for step labels ("Editing 6 layers in Pricing"). */
  names?: StepNames
}

export async function runTurn(o: RunTurnOptions): Promise<TurnRecord> {
  const now = o.now ?? Date.now
  const startedAt = now()
  const retry = o.retry ?? DEFAULT_RETRY
  const maxSteps = o.maxSteps ?? 60
  const online = o.online ?? (() => true)
  const waitForOnline = o.waitForOnline ?? ((s: AbortSignal) => pollOnline(online, s))
  const label = o.providerLabel ?? o.provider.config.label
  const placeholders = new PlaceholderTracker(o.origin)
  const appended: ChatMessage[] = [o.user]
  const opGroups: OpGroup[] = []
  let usage: Usage = { ...ZERO_USAGE }
  let opsApplied = 0
  let servedBy = o.model.model
  let status: TurnStatus = "done"
  let card: ErrorCard | undefined
  const cost = () =>
    estimateCost(o.provider.config.kind, o.model.model, usage, o.free ? { free: true } : {})

  o.onEvent({ type: "turn_start", turnId: o.turnId })

  try {
    for (let step = 0; ; step++) {
      if (step >= maxSteps) {
        status = "max_steps"
        break
      }
      if (o.signal.aborted) throw abortError(o.provider.id)
      const over = o.budget?.check(cost().usd ?? 0)
      if (over) {
        status = "budget"
        card = errorCard(new ProviderError("budget", over, { provider: o.provider.id }), {
          providerLabel: label,
          opsApplied,
        })
        break
      }

      // --- One model call, with retries ------------------------------------------------------
      let end: Extract<import("./types").StreamEvent, { type: "message_end" }> | undefined
      for (let attempt = 1; !end; ) {
        try {
          for await (const ev of o.provider.stream({
            model: o.model.model,
            system: o.system,
            messages: [...o.history, ...appended],
            tools: o.tools.tools(),
            thinking: o.thinking,
            ...(o.maxTokens ? { maxTokens: o.maxTokens } : {}),
            signal: o.signal,
          })) {
            if (ev.type === "text_delta" || ev.type === "thinking_delta") o.onEvent(ev)
            else if (ev.type === "usage") {
              o.onEvent({ type: "usage", usage: addUsage(usage, ev.usage), cost: cost() })
            } else if (ev.type === "message_end") end = ev
          }
          if (!end)
            throw new ProviderError("server", "The stream ended early.", {
              provider: o.provider.id,
            })
        } catch (e) {
          const err = toProviderError(e, o.provider.id)
          if (err.kind === "aborted") throw err
          if (err.kind === "offline") {
            o.onEvent({ type: "discard_partial" })
            o.onEvent({
              type: "paused",
              card: errorCard(err, { providerLabel: label, opsApplied }),
            })
            await waitForOnline(o.signal)
            o.onEvent({ type: "resumed" })
            continue
          }
          if (err.retryable && attempt < retry.maxAttempts) {
            const inMs = backoffDelay(attempt, retry, err.retryAfterMs, o.random)
            attempt++
            o.onEvent({ type: "discard_partial" })
            o.onEvent({
              type: "retry",
              card: errorCard(err, {
                providerLabel: label,
                opsApplied,
                retry: { attempt, maxAttempts: retry.maxAttempts, inMs },
              }),
            })
            await sleep(inMs, o.signal)
            continue
          }
          throw err
        }
      }

      usage = addUsage(usage, end.usage)
      servedBy = end.servedBy
      appended.push(end.message)
      o.onEvent({ type: "message_end", message: end.message, stopReason: end.stopReason })
      o.onEvent({ type: "usage", usage, cost: cost() })

      if (end.stopReason === "refusal") {
        status = "refusal"
        card = errorCard(new ProviderError("refusal", "Declined.", { provider: o.provider.id }), {
          providerLabel: label,
          opsApplied,
        })
        break
      }
      const calls = end.message.content.filter((p): p is ToolCallPart => p.type === "tool_call")
      if (calls.length === 0) {
        if (end.stopReason === "pause_turn") continue
        break
      }
      if (end.stopReason === "max_tokens") {
        // A truncated tool input may still parse; never run it.
        appended.push(
          errorResults(calls, "The tool input was cut off (max_tokens). Send a smaller call."),
        )
        continue
      }

      // --- Tool calls (sequential: op order matters) --------------------------------------------
      const results: ToolResultPart[] = []
      for (const call of calls) {
        if (o.signal.aborted) {
          results.push(
            resultPart(
              call,
              failure({ code: "PERMISSION_DENIED", message: "Stopped by the user." }),
            ),
          )
          continue
        }
        const req: ToolCallRequest = { id: call.id, name: call.name, input: call.input }
        o.onEvent({
          type: "step_start",
          callId: call.id,
          tool: call.name,
          label: stepLabel(req, o.names),
          input: call.input,
        })
        let out: ToolOutcome
        try {
          out = await o.tools.call(req, o.signal)
        } catch (e) {
          out = {
            result: failure({
              code: "INTERNAL",
              message: e instanceof Error ? e.message : String(e),
            }),
          }
        }
        const r = out.result
        if (r.ok && !r.dryRun && r.undoToken) {
          const n = r.ops?.length ?? 0
          opsApplied += n
          opGroups.push({
            docId: r.doc?.id ?? String(call.input.docId ?? ""),
            undoToken: r.undoToken,
            summary: r.summary,
            changed: r.changed ?? [],
            tool: call.name,
          })
          if (call.name === "kimo_apply_ops") placeholders.observe(call.input, r.created ?? [])
        }
        o.onEvent({
          type: "step_end",
          callId: call.id,
          tool: call.name,
          ok: r.ok,
          summary: r.summary,
          changed: r.ok ? (r.changed ?? []) : [],
          ...(r.ok && r.undoToken ? { undoToken: r.undoToken } : {}),
          ...(!r.ok && r.errors[0] ? { errorCode: r.errors[0].code } : {}),
        })
        results.push(resultPart(call, r, out.images))
      }
      appended.push({ role: "tool", results })
      if (o.signal.aborted) throw abortError(o.provider.id)
    }
  } catch (e) {
    const err = toProviderError(e, o.provider.id)
    status = err.kind === "aborted" ? "stopped" : "error"
    card = errorCard(err, { providerLabel: label, opsApplied })
  }

  // --- Turn end: clear owned placeholders (done, stopped, error alike) -------------------------
  for (const c of placeholders.clearingCalls()) {
    const out = await o.tools.call(
      {
        id: `clear-${o.turnId}-${c.docId}`,
        name: "kimo_apply_ops",
        input: { docId: c.docId, ops: c.ops, label: c.label },
      },
      new AbortController().signal,
    )
    if (out.result.ok && out.result.undoToken)
      opGroups.push({
        docId: c.docId,
        undoToken: out.result.undoToken,
        summary: out.result.summary,
        changed: out.result.changed ?? [],
        tool: "kimo_apply_ops",
      })
  }

  const record: TurnRecord = {
    id: o.turnId,
    model: o.model,
    thinking: o.thinking,
    startedAt,
    endedAt: now(),
    messages: appended,
    usage,
    cost: cost(),
    opGroups,
    opsApplied,
    status,
    ...(card ? { error: card } : {}),
    servedBy,
    skillsUsed: o.skillsUsed ?? [],
  }
  o.onEvent({ type: "turn_end", record })
  return record
}

function resultPart(
  call: ToolCallPart,
  r: ToolResult,
  images?: ToolOutcome["images"],
): ToolResultPart {
  const imgs = (images ?? [])
    .filter((i) => i.mimeType === "image/png")
    .map((i) => ({ type: "image" as const, mimeType: "image/png" as const, data: i.data }))
  return {
    type: "tool_result",
    callId: call.id,
    name: call.name,
    content: modelText(r),
    isError: !r.ok,
    ...(imgs.length ? { images: imgs } : {}),
  }
}

function errorResults(calls: ToolCallPart[], message: string): ToolResultsMessage {
  return {
    role: "tool",
    results: calls.map((c) => resultPart(c, failure({ code: "INVALID_INPUT", message }))),
  }
}

function abortError(provider: string): ProviderError {
  return new ProviderError("aborted", "Stopped.", { provider })
}

function toProviderError(e: unknown, provider: string): ProviderError {
  if (isProviderError(e)) return e
  if (isAbort(e)) return abortError(provider)
  return new ProviderError("unknown", e instanceof Error ? e.message : String(e), {
    provider,
    cause: e,
  })
}

async function pollOnline(online: () => boolean, signal: AbortSignal): Promise<void> {
  while (!online()) await sleep(2_000, signal)
}
