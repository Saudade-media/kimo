/**
 * Anthropic adapter (default provider; ADR 0006 §2, ADR 0014 §2) on `@anthropic-ai/sdk`.
 *
 * - Streaming via `client.beta.messages.stream` (+ `finalMessage()`), tools with
 *   `eager_input_streaming`, every parsed tool input re-validated by the M5 dispatcher.
 * - Prompt caching: one breakpoint after the stable system prompt (covers tools + system) and
 *   one on the newest message (incremental conversation caching). Volatile system text sits
 *   after the first breakpoint.
 * - Thinking: Off / Auto / Max per {@link anthropicThinking} (Opus 5.5: effort only; Haiku 4.5:
 *   budget tokens). Thinking blocks are replayed unchanged on the same model via `native`.
 * - No forced `tool_choice` (400 on Opus 5.5); structured output uses `output_config.format`.
 * - Server-side refusal fallback (`fallbacks: "default"`) on first-party endpoints when enabled.
 * - SDK retries are off (`maxRetries: 0`): the agent loop owns retries so the UI can show
 *   "attempt 2 of 5".
 */
import Anthropic from "@anthropic-ai/sdk"
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaRawMessageStreamEvent,
  BetaToolResultBlockParam,
  BetaToolUnion,
  MessageCreateParamsStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages"
import {
  classifyFetchFailure,
  isAbort,
  kindForStatus,
  ProviderError,
  retryAfterFrom,
} from "../errors"
import { anthropicThinking, catalogInfo, genericModelInfo, type ModelInfo } from "../models"
import type {
  AssistantMessage,
  AssistantPart,
  ChatMessage,
  ProviderRequest,
  StopReason,
  StreamEvent,
  Usage,
} from "../types"
import {
  availableOn,
  type ConnectionTest,
  type Provider,
  type ProviderConfig,
  type ProviderRuntime,
} from "./provider"

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com"
const FALLBACK_BETA = "server-side-fallback-2026-07-01"

export class AnthropicProvider implements Provider {
  readonly id: string
  readonly kind = "anthropic" as const
  private client: Anthropic | undefined

  constructor(
    readonly config: ProviderConfig,
    private readonly runtime: ProviderRuntime,
  ) {
    this.id = config.id
  }

  modelInfo(model: string): ModelInfo {
    return catalogInfo(this.config.kind, model) ?? genericModelInfo(model)
  }

  private sdk(): Anthropic {
    const reach = availableOn(this.config, this.runtime.platform)
    if (!reach.ok)
      throw new ProviderError("unsupported_platform", reach.reason, { provider: this.id })
    this.client ??= new Anthropic({
      // Desktop: the relay injects x-api-key from the keychain; a placeholder satisfies the SDK.
      apiKey: this.config.apiKey ?? "kimo-relay",
      baseURL: this.config.baseURL ?? ANTHROPIC_BASE_URL,
      fetch: this.runtime.fetch,
      maxRetries: 0,
      // Desktop runs the SDK inside the Tauri webview (browser-like), but its key is the relay
      // placeholder and Rust injects the real one, so the browser guard does not apply there.
      dangerouslyAllowBrowser:
        this.runtime.platform === "desktop" ||
        (this.runtime.platform === "web" && this.config.allowBrowser === true),
      ...(this.config.headers ? { defaultHeaders: this.config.headers } : {}),
    })
    return this.client
  }

  private firstParty(): boolean {
    return (this.config.baseURL ?? ANTHROPIC_BASE_URL) === ANTHROPIC_BASE_URL
  }

  /** Builds the request body (exported for tests through {@link buildAnthropicParams}). */
  params(req: ProviderRequest): MessageCreateParamsStreaming {
    return buildAnthropicParams(req, this.modelInfo(req.model), this.id, {
      fallback: this.config.refusalFallback === true && this.firstParty(),
    })
  }

  async *stream(req: ProviderRequest): AsyncIterable<StreamEvent> {
    const client = this.sdk()
    const params = this.params(req)
    let stream: ReturnType<typeof client.beta.messages.stream>
    try {
      stream = client.beta.messages.stream(params, req.signal ? { signal: req.signal } : {})
    } catch (e) {
      throw this.mapError(e)
    }
    const toolIds = new Map<number, string>()
    try {
      for await (const ev of stream as AsyncIterable<BetaRawMessageStreamEvent>) {
        const out = mapEvent(ev, toolIds)
        if (out) yield out
      }
      const final: BetaMessage = await stream.finalMessage()
      const message: AssistantMessage = {
        role: "assistant",
        content: final.content.flatMap((b: BetaContentBlock): AssistantPart[] => {
          if (b.type === "text") return [{ type: "text", text: b.text }]
          if (b.type === "tool_use")
            return [
              {
                type: "tool_call",
                id: b.id,
                name: b.name,
                input: (b.input ?? {}) as Record<string, unknown>,
              },
            ]
          if (b.type === "thinking" && b.thinking) return [{ type: "thinking", text: b.thinking }]
          return []
        }),
        native: { provider: this.id, model: req.model, content: final.content },
      }
      const usage = usageOf(final.usage)
      yield {
        type: "message_end",
        message,
        stopReason: stopOf(final.stop_reason),
        usage,
        servedBy: final.model ?? req.model,
      }
    } catch (e) {
      throw this.mapError(e)
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    try {
      const page = await this.sdk().models.list({ limit: 100 }, signal ? { signal } : {})
      return page.data.map((m) => m.id)
    } catch (e) {
      throw this.mapError(e)
    }
  }

  async test(signal?: AbortSignal): Promise<ConnectionTest> {
    const t0 = Date.now()
    const model = this.config.models.agent
    try {
      await this.listModels(signal)
      // A 1-token-ish tool round: proves key, model access, tools and streaming.
      const params = this.params({
        model,
        system: { stable: "Connection test. Reply with OK." },
        messages: [{ role: "user", content: [{ type: "text", text: "OK?" }] }],
        tools: [
          {
            name: "kimo_ping",
            description: "Connectivity probe; never needs calling.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          },
        ],
        thinking: "off",
        maxTokens: 16,
      })
      await this.sdk()
        .beta.messages.stream(params, signal ? { signal } : {})
        .finalMessage()
      return {
        ok: true,
        latencyMs: Date.now() - t0,
        detail: `${model} reachable · tools + streaming`,
      }
    } catch (e) {
      const error = e instanceof ProviderError ? e : this.mapError(e)
      return { ok: false, latencyMs: Date.now() - t0, detail: error.message, error }
    }
  }

  mapError(e: unknown): ProviderError {
    if (e instanceof ProviderError) return e
    if (e instanceof Anthropic.APIUserAbortError || isAbort(e))
      return new ProviderError("aborted", "Stopped.", { provider: this.id })
    if (e instanceof Anthropic.APIConnectionError)
      return classifyFetchFailure(e.cause ?? e, {
        provider: this.id,
        online: this.runtime.online(),
        web: this.runtime.platform === "web",
      })
    if (e instanceof Anthropic.APIError && typeof e.status === "number") {
      const body = e.error as { error?: { type?: string; message?: string } } | undefined
      const code = body?.error?.type
      const retryAfterMs = retryAfterFrom(e.headers as Headers | undefined)
      return new ProviderError(kindForStatus(e.status, code ?? e.message), e.message, {
        provider: this.id,
        status: e.status,
        ...(code ? { providerCode: code } : {}),
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        cause: e,
      })
    }
    return new ProviderError("unknown", e instanceof Error ? e.message : String(e), {
      provider: this.id,
      cause: e,
    })
  }
}

// --- Request building --------------------------------------------------------------------------

export function buildAnthropicParams(
  req: ProviderRequest,
  info: ModelInfo,
  providerId: string,
  opts: { fallback: boolean },
): MessageCreateParamsStreaming {
  const t = anthropicThinking(info, req.thinking)
  const budget = t.thinking?.budget_tokens ?? 0
  const maxTokens = Math.min(info.maxOutput, Math.max(req.maxTokens ?? 32_000, budget + 8_192))
  const tools: BetaToolUnion[] = req.tools.map((s) => ({
    name: s.name,
    description: s.description,
    input_schema: s.inputSchema as { type: "object"; [k: string]: unknown },
    eager_input_streaming: true,
  }))
  const system: { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[] = [
    { type: "text", text: req.system.stable, cache_control: { type: "ephemeral" } },
  ]
  if (req.system.volatile) system.push({ type: "text", text: req.system.volatile })

  const messages = toAnthropicMessages(req.messages, providerId, req.model)
  // Second breakpoint on the newest block (append-only history keeps the prefix stable).
  const last = messages[messages.length - 1]
  if (last && Array.isArray(last.content) && last.content.length) {
    const block = last.content[last.content.length - 1] as { cache_control?: unknown }
    block.cache_control = { type: "ephemeral" }
  }
  const output: {
    effort?: "low" | "medium" | "high" | "max"
    format?: { type: "json_schema"; schema: Record<string, unknown> }
  } = {}
  if (t.effort) output.effort = t.effort
  if (req.responseSchema) output.format = { type: "json_schema", schema: req.responseSchema.schema }

  const params: MessageCreateParamsStreaming = {
    model: req.model,
    max_tokens: maxTokens,
    system,
    messages,
    ...(tools.length ? { tools } : {}),
    ...(t.thinking ? { thinking: t.thinking } : {}),
    ...(info.thinking === "effort"
      ? { thinking: { type: "adaptive", display: "summarized" } }
      : {}),
    ...(output.effort || output.format ? { output_config: output } : {}),
    ...(opts.fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    stream: true,
  }
  return params
}

/** Neutral → Anthropic messages. Same provider+model assistant turns replay `native` verbatim. */
export function toAnthropicMessages(
  history: readonly ChatMessage[],
  providerId: string,
  model: string,
): BetaMessageParam[] {
  const out: BetaMessageParam[] = []
  for (const m of history) {
    if (m.role === "user") {
      out.push({
        role: "user",
        content: m.content.map(
          (p): BetaContentBlockParam =>
            p.type === "text"
              ? { type: "text", text: p.text }
              : { type: "image", source: { type: "base64", media_type: p.mimeType, data: p.data } },
        ),
      })
    } else if (m.role === "assistant") {
      if (m.native && m.native.provider === providerId && m.native.model === model) {
        out.push({
          role: "assistant",
          content: structuredClone(m.native.content) as BetaContentBlockParam[],
        })
        continue
      }
      const content: BetaContentBlockParam[] = []
      for (const p of m.content) {
        if (p.type === "text" && p.text) content.push({ type: "text", text: p.text })
        else if (p.type === "tool_call")
          content.push({ type: "tool_use", id: p.id, name: p.name, input: p.input })
      }
      if (content.length) out.push({ role: "assistant", content })
    } else {
      out.push({
        role: "user",
        content: m.results.map(
          (r): BetaToolResultBlockParam => ({
            type: "tool_result",
            tool_use_id: r.callId,
            is_error: r.isError,
            content: [
              { type: "text", text: r.content },
              ...(r.images ?? []).map((i) => ({
                type: "image" as const,
                source: { type: "base64" as const, media_type: i.mimeType, data: i.data },
              })),
            ],
          }),
        ),
      })
    }
  }
  return out
}

function mapEvent(ev: BetaRawMessageStreamEvent, toolIds: Map<number, string>): StreamEvent | null {
  switch (ev.type) {
    case "content_block_start":
      if (ev.content_block.type === "tool_use") {
        toolIds.set(ev.index, ev.content_block.id)
        return { type: "tool_call_start", id: ev.content_block.id, name: ev.content_block.name }
      }
      return null
    case "content_block_delta":
      if (ev.delta.type === "text_delta") return { type: "text_delta", text: ev.delta.text }
      if (ev.delta.type === "thinking_delta")
        return { type: "thinking_delta", text: ev.delta.thinking }
      if (ev.delta.type === "input_json_delta")
        return {
          type: "tool_call_delta",
          id: toolIds.get(ev.index) ?? "",
          partialJson: ev.delta.partial_json,
        }
      return null
    case "message_delta":
      return ev.usage ? { type: "usage", usage: usageOf(ev.usage as UsageLike) } : null
    default:
      return null
  }
}

interface UsageLike {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

function usageOf(u: UsageLike): Usage {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  }
}

function stopOf(s: string | null | undefined): StopReason {
  switch (s) {
    case "end_turn":
    case "tool_use":
    case "max_tokens":
    case "refusal":
    case "stop_sequence":
    case "pause_turn":
      return s
    default:
      return "other"
  }
}
