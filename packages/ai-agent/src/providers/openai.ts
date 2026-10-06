/**
 * OpenAI-compatible adapter (ADR 0006 §3): Chat Completions and Responses, raw fetch + SSE so
 * no SDK churn reaches the agent. Also serves OpenRouter (Chat Completions at
 * openrouter.ai/api/v1 with attribution headers) and custom endpoints such as Ollama
 * (`http://localhost:11434/v1`, no key).
 */
import { ProviderError } from "../errors"
import { catalogInfo, genericModelInfo, type ModelInfo, openaiReasoningEffort } from "../models"
import type {
  AssistantMessage,
  AssistantPart,
  ChatMessage,
  ProviderRequest,
  StopReason,
  StreamEvent,
  ToolCallPart,
  Usage,
} from "../types"
import type { WebTool } from "../web"
import { getJson, parseArgs, postStream, trimSlash } from "./http"
import {
  availableOn,
  type ConnectionTest,
  type Provider,
  type ProviderConfig,
  type ProviderRuntime,
} from "./provider"
import { readSse } from "./sse"

export const OPENAI_BASE_URL = "https://api.openai.com/v1"
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
export const OLLAMA_BASE_URL = "http://localhost:11434/v1"

type Api = "chat" | "responses"

export class OpenAICompatibleProvider implements Provider {
  readonly id: string
  readonly kind: ProviderConfig["kind"]

  constructor(
    readonly config: ProviderConfig,
    private readonly runtime: ProviderRuntime,
  ) {
    this.id = config.id
    this.kind = config.kind
  }

  get api(): Api {
    if (this.config.kind === "custom")
      return this.config.wire === "openai-responses" ? "responses" : "chat"
    if (this.config.kind === "openai") return this.config.api ?? "chat"
    return "chat"
  }

  get baseURL(): string {
    if (this.config.baseURL) return trimSlash(this.config.baseURL)
    if (this.config.kind === "openrouter") return OPENROUTER_BASE_URL
    if (this.config.kind === "custom") return OLLAMA_BASE_URL
    return OPENAI_BASE_URL
  }

  modelInfo(model: string): ModelInfo {
    return catalogInfo(this.config.kind, model) ?? genericModelInfo(model)
  }

  headers(): Record<string, string> {
    const h: Record<string, string> = { ...(this.config.headers ?? {}) }
    if (this.config.apiKey) h.authorization = `Bearer ${this.config.apiKey}`
    if (this.config.kind === "openrouter") {
      h["HTTP-Referer"] ??= "https://kimo.design"
      h["X-Title"] ??= "Kimo"
    }
    return h
  }

  private check(): void {
    const reach = availableOn(this.config, this.runtime.platform)
    if (!reach.ok)
      throw new ProviderError("unsupported_platform", reach.reason, { provider: this.id })
  }

  /** Request body for the configured API (exported shape for tests). */
  body(req: ProviderRequest): Record<string, unknown> {
    const info = this.modelInfo(req.model)
    return this.api === "responses"
      ? buildResponsesBody(req, info, {
          webSearch: !!req.webAccess && this.config.kind === "openai",
        })
      : buildChatBody(req, info, { modernTokens: this.config.kind === "openai" })
  }

  async *stream(req: ProviderRequest): AsyncIterable<StreamEvent> {
    this.check()
    const path = this.api === "responses" ? "/responses" : "/chat/completions"
    const res = await postStream(
      this.runtime,
      this.id,
      `${this.baseURL}${path}`,
      this.body(req),
      this.headers(),
      req.signal,
    )
    const body = res.body as ReadableStream<Uint8Array>
    if (this.api === "responses") yield* this.readResponses(body, req)
    else yield* this.readChat(body, req)
  }

  private async *readChat(
    body: ReadableStream<Uint8Array>,
    req: ProviderRequest,
  ): AsyncIterable<StreamEvent> {
    let text = ""
    let stop: StopReason = "end_turn"
    let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    let servedBy = req.model
    const calls = new Map<number, { id: string; name: string; args: string }>()
    for await (const ev of readSse(body, req.signal)) {
      if (ev.data === "[DONE]") break
      const chunk = JSON.parse(ev.data) as ChatChunk
      if (chunk.error)
        throw new ProviderError("server", chunk.error.message ?? "Stream error.", {
          provider: this.id,
        })
      if (chunk.model) servedBy = chunk.model
      if (chunk.usage) usage = chatUsage(chunk.usage)
      const choice = chunk.choices?.[0]
      if (!choice) continue
      const d = choice.delta ?? {}
      if (d.content) {
        text += d.content
        yield { type: "text_delta", text: d.content }
      }
      const reasoning = d.reasoning ?? d.reasoning_content
      if (reasoning) yield { type: "thinking_delta", text: reasoning }
      for (const tc of d.tool_calls ?? []) {
        let c = calls.get(tc.index)
        if (!c) {
          c = { id: tc.id ?? `call_${tc.index}`, name: tc.function?.name ?? "", args: "" }
          calls.set(tc.index, c)
          yield { type: "tool_call_start", id: c.id, name: c.name }
        }
        if (tc.function?.name && !c.name) c.name = tc.function.name
        if (tc.function?.arguments) {
          c.args += tc.function.arguments
          yield { type: "tool_call_delta", id: c.id, partialJson: tc.function.arguments }
        }
      }
      if (choice.finish_reason) stop = finishOf(choice.finish_reason)
    }
    const content: AssistantPart[] = []
    if (text) content.push({ type: "text", text })
    for (const c of [...calls.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]))
      content.push({ type: "tool_call", id: c.id, name: c.name, input: parseArgs(c.args).input })
    if (calls.size && stop === "end_turn") stop = "tool_use"
    const message: AssistantMessage = { role: "assistant", content }
    yield { type: "message_end", message, stopReason: stop, usage, servedBy }
  }

  private async *readResponses(
    body: ReadableStream<Uint8Array>,
    req: ProviderRequest,
  ): AsyncIterable<StreamEvent> {
    const byItem = new Map<string, { callId: string; name: string; args: string }>()
    let text = ""
    let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    let stop: StopReason = "end_turn"
    let servedBy = req.model
    for await (const ev of readSse(body, req.signal)) {
      if (ev.data === "[DONE]") break
      const e = JSON.parse(ev.data) as ResponsesEvent
      switch (e.type) {
        case "response.output_text.delta":
          text += e.delta ?? ""
          yield { type: "text_delta", text: e.delta ?? "" }
          break
        case "response.reasoning_summary_text.delta":
          yield { type: "thinking_delta", text: e.delta ?? "" }
          break
        case "response.output_item.done":
          // Board 38: a hosted web search (its action is known once it ran).
          if (e.item?.type === "web_search_call" && e.item.id) {
            const w = webCallOf({ ...e.item, id: e.item.id })
            yield {
              type: "web_end",
              id: e.item.id,
              tool: w.tool,
              ok: e.item.status !== "failed",
              input: w.input,
            }
          }
          break
        case "response.output_item.added":
          if (e.item?.type === "web_search_call" && e.item.id) {
            yield { type: "web_start", id: e.item.id, tool: "web_search", input: {} }
            break
          }
          if (e.item?.type === "function_call") {
            const c = {
              callId: e.item.call_id ?? e.item.id ?? "",
              name: e.item.name ?? "",
              args: "",
            }
            byItem.set(e.item.id ?? c.callId, c)
            yield { type: "tool_call_start", id: c.callId, name: c.name }
          }
          break
        case "response.function_call_arguments.delta": {
          const c = byItem.get(e.item_id ?? "")
          if (c) {
            c.args += e.delta ?? ""
            yield { type: "tool_call_delta", id: c.callId, partialJson: e.delta ?? "" }
          }
          break
        }
        case "response.completed":
        case "response.incomplete": {
          const r = e.response
          if (r?.model) servedBy = r.model
          if (r?.usage) usage = responsesUsage(r.usage)
          if (e.type === "response.incomplete") stop = "max_tokens"
          for (const item of r?.output ?? []) {
            if (item.type === "function_call" && item.id && !byItem.has(item.id))
              byItem.set(item.id, {
                callId: item.call_id ?? item.id,
                name: item.name ?? "",
                args: item.arguments ?? "",
              })
            else if (item.type === "function_call" && item.id && item.arguments) {
              const c = byItem.get(item.id)
              if (c) c.args = item.arguments
            }
          }
          break
        }
        case "response.failed":
        case "error":
          throw new ProviderError(
            "server",
            e.response?.error?.message ?? e.message ?? "Response failed.",
            {
              provider: this.id,
            },
          )
      }
    }
    const content: AssistantPart[] = []
    if (text) content.push({ type: "text", text })
    for (const c of byItem.values())
      content.push({
        type: "tool_call",
        id: c.callId,
        name: c.name,
        input: parseArgs(c.args).input,
      })
    if (byItem.size && stop === "end_turn") stop = "tool_use"
    yield {
      type: "message_end",
      message: { role: "assistant", content },
      stopReason: stop,
      usage,
      servedBy,
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    this.check()
    const j = (await getJson(
      this.runtime,
      this.id,
      `${this.baseURL}/models`,
      this.headers(),
      signal,
    )) as {
      data?: { id: string }[]
    }
    return (j.data ?? []).map((m) => m.id)
  }

  async test(signal?: AbortSignal): Promise<ConnectionTest> {
    const t0 = Date.now()
    try {
      await this.listModels(signal)
      const req: ProviderRequest = {
        model: this.config.models.agent,
        system: { stable: "Connection test. Reply with OK." },
        messages: [{ role: "user", content: [{ type: "text", text: "OK?" }] }],
        tools: [
          {
            name: "kimo_ping",
            description: "Connectivity probe; never needs calling.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          },
        ],
        thinking: "low",
        maxTokens: 16,
        ...(signal ? { signal } : {}),
      }
      for await (const _ of this.stream(req)) {
        // drain
      }
      return {
        ok: true,
        latencyMs: Date.now() - t0,
        detail: `${req.model} reachable · tools + streaming`,
      }
    } catch (e) {
      const error =
        e instanceof ProviderError
          ? e
          : new ProviderError("unknown", String(e), { provider: this.id })
      return { ok: false, latencyMs: Date.now() - t0, detail: error.message, error }
    }
  }
}

// --- Chat Completions ---------------------------------------------------------------------------

interface ChatChunk {
  model?: string
  error?: { message?: string }
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
  choices?: {
    finish_reason?: string | null
    delta?: {
      content?: string | null
      reasoning?: string
      reasoning_content?: string
      tool_calls?: {
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }[]
    }
  }[]
}

function chatUsage(u: NonNullable<ChatChunk["usage"]>): Usage {
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0
  return {
    inputTokens: Math.max(0, (u.prompt_tokens ?? 0) - cached),
    outputTokens: u.completion_tokens ?? 0,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  }
}

function finishOf(f: string): StopReason {
  if (f === "stop") return "end_turn"
  if (f === "tool_calls" || f === "function_call") return "tool_use"
  if (f === "length") return "max_tokens"
  if (f === "content_filter") return "refusal"
  return "other"
}

const systemText = (req: ProviderRequest) =>
  req.system.volatile ? `${req.system.stable}\n\n${req.system.volatile}` : req.system.stable

export function buildChatBody(
  req: ProviderRequest,
  info: ModelInfo,
  opts: { modernTokens: boolean },
): Record<string, unknown> {
  const messages: Record<string, unknown>[] = [{ role: "system", content: systemText(req) }]
  for (const m of req.messages) messages.push(...chatMessages(m))
  const effort = openaiReasoningEffort(info, req.thinking)
  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  }
  if (req.tools.length)
    body.tools = req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }))
  if (req.maxTokens)
    body[opts.modernTokens ? "max_completion_tokens" : "max_tokens"] = req.maxTokens
  if (effort) body.reasoning_effort = effort
  if (req.responseSchema)
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: req.responseSchema.name,
        schema: req.responseSchema.schema,
        strict: false,
      },
    }
  return body
}

function chatMessages(m: ChatMessage): Record<string, unknown>[] {
  if (m.role === "user")
    return [
      {
        role: "user",
        content: m.content.map((p) =>
          p.type === "text"
            ? { type: "text", text: p.text }
            : { type: "image_url", image_url: { url: `data:${p.mimeType};base64,${p.data}` } },
        ),
      },
    ]
  if (m.role === "assistant") {
    const text = m.content
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("")
    const calls = m.content.filter((p): p is ToolCallPart => p.type === "tool_call")
    return [
      {
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      },
    ]
  }
  const out: Record<string, unknown>[] = m.results.map((r) => ({
    role: "tool",
    tool_call_id: r.callId,
    content: r.content,
  }))
  // Tool messages cannot carry images: render images follow as one user message.
  const images = m.results.flatMap((r) => r.images ?? [])
  if (images.length)
    out.push({
      role: "user",
      content: [
        { type: "text", text: "Rendered images from the tool results above." },
        ...images.map((i) => ({
          type: "image_url",
          image_url: { url: `data:${i.mimeType};base64,${i.data}` },
        })),
      ],
    })
  return out
}

// --- Responses ---------------------------------------------------------------------------------

interface ResponsesItem {
  type: string
  id?: string
  call_id?: string
  name?: string
  arguments?: string
  status?: string
  action?: { type?: string; query?: string; url?: string }
}

interface ResponsesEvent {
  type: string
  delta?: string
  item_id?: string
  message?: string
  item?: ResponsesItem
  response?: {
    model?: string
    output?: ResponsesItem[]
    error?: { message?: string }
    usage?: {
      input_tokens?: number
      output_tokens?: number
      input_tokens_details?: { cached_tokens?: number }
    }
  }
}

function responsesUsage(u: NonNullable<NonNullable<ResponsesEvent["response"]>["usage"]>): Usage {
  const cached = u.input_tokens_details?.cached_tokens ?? 0
  return {
    inputTokens: Math.max(0, (u.input_tokens ?? 0) - cached),
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  }
}

/** An OpenAI `web_search_call` output item (board 38). */
interface WebSearchCall {
  id: string
  status?: string
  action?: { type?: string; query?: string; url?: string }
}

/** A web_search_call's action as a web step: a search, or a page it opened. */
export function webCallOf(item: WebSearchCall): {
  tool: WebTool
  input: Record<string, unknown>
} {
  const a = item.action ?? {}
  if (a.type === "open_page" || a.type === "find" || (a.url && !a.query))
    return { tool: "web_fetch", input: { url: a.url ?? "" } }
  return { tool: "web_search", input: { query: a.query ?? "" } }
}

export function buildResponsesBody(
  req: ProviderRequest,
  info: ModelInfo,
  opts: { webSearch?: boolean } = {},
): Record<string, unknown> {
  const input: Record<string, unknown>[] = []
  for (const m of req.messages) {
    if (m.role === "user")
      input.push({
        role: "user",
        content: m.content.map((p) =>
          p.type === "text"
            ? { type: "input_text", text: p.text }
            : { type: "input_image", image_url: `data:${p.mimeType};base64,${p.data}` },
        ),
      })
    else if (m.role === "assistant") {
      for (const p of m.content) {
        if (p.type === "text" && p.text)
          input.push({ role: "assistant", content: [{ type: "output_text", text: p.text }] })
        else if (p.type === "tool_call")
          input.push({
            type: "function_call",
            call_id: p.id,
            name: p.name,
            arguments: JSON.stringify(p.input),
          })
      }
    } else {
      for (const r of m.results)
        input.push({ type: "function_call_output", call_id: r.callId, output: r.content })
      const images = m.results.flatMap((r) => r.images ?? [])
      if (images.length)
        input.push({
          role: "user",
          content: images.map((i) => ({
            type: "input_image",
            image_url: `data:${i.mimeType};base64,${i.data}`,
          })),
        })
    }
  }
  const effort = openaiReasoningEffort(info, req.thinking)
  const body: Record<string, unknown> = {
    model: req.model,
    instructions: systemText(req),
    input,
    stream: true,
    store: false,
  }
  const tools: Record<string, unknown>[] = req.tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
    strict: false,
  }))
  // Board 38: OpenAI's hosted web search (Responses API only).
  if (opts.webSearch) tools.push({ type: "web_search" })
  if (tools.length) body.tools = tools
  if (req.maxTokens) body.max_output_tokens = req.maxTokens
  if (effort) body.reasoning = { effort, summary: "auto" }
  if (req.responseSchema)
    body.text = {
      format: {
        type: "json_schema",
        name: req.responseSchema.name,
        schema: req.responseSchema.schema,
        strict: false,
      },
    }
  return body
}
