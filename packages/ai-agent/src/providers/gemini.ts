/**
 * Google Gemini adapter (ADR 0006 §3): `models/{model}:streamGenerateContent?alt=sse` with the
 * key in `x-goog-api-key`. Tool schemas go in `parametersJsonSchema` (full JSON Schema, so the
 * portable profile passes unchanged). Model turns are replayed from `native` on the same model
 * so `thoughtSignature`s survive multi-turn tool use.
 */
import { ProviderError } from "../errors"
import { catalogInfo, geminiThinkingBudget, genericModelInfo, type ModelInfo } from "../models"
import type {
  AssistantMessage,
  AssistantPart,
  ChatMessage,
  ProviderRequest,
  StopReason,
  StreamEvent,
  Usage,
} from "../types"
import { getJson, postStream, trimSlash } from "./http"
import {
  availableOn,
  type ConnectionTest,
  type Provider,
  type ProviderConfig,
  type ProviderRuntime,
} from "./provider"
import { readSse } from "./sse"

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

interface GeminiPart {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  inlineData?: { mimeType: string; data: string }
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> }
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> }
}

interface GeminiChunk {
  modelVersion?: string
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    cachedContentTokenCount?: number
    thoughtsTokenCount?: number
  }
  promptFeedback?: { blockReason?: string }
}

export class GeminiProvider implements Provider {
  readonly id: string
  readonly kind = "gemini" as const

  constructor(
    readonly config: ProviderConfig,
    private readonly runtime: ProviderRuntime,
  ) {
    this.id = config.id
  }

  get baseURL(): string {
    return trimSlash(this.config.baseURL ?? GEMINI_BASE_URL)
  }

  modelInfo(model: string): ModelInfo {
    return catalogInfo("gemini", model) ?? genericModelInfo(model)
  }

  private headers(): Record<string, string> {
    return {
      ...(this.config.headers ?? {}),
      ...(this.config.apiKey ? { "x-goog-api-key": this.config.apiKey } : {}),
    }
  }

  body(req: ProviderRequest): Record<string, unknown> {
    return buildGeminiBody(req, this.modelInfo(req.model), this.id)
  }

  async *stream(req: ProviderRequest): AsyncIterable<StreamEvent> {
    const reach = availableOn(this.config, this.runtime.platform)
    if (!reach.ok)
      throw new ProviderError("unsupported_platform", reach.reason, { provider: this.id })
    const url = `${this.baseURL}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`
    const res = await postStream(
      this.runtime,
      this.id,
      url,
      this.body(req),
      this.headers(),
      req.signal,
    )
    const parts: GeminiPart[] = []
    let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    let stop: StopReason = "end_turn"
    let servedBy = req.model
    let n = 0
    for await (const ev of readSse(res.body as ReadableStream<Uint8Array>, req.signal)) {
      const c = JSON.parse(ev.data) as GeminiChunk
      if (c.promptFeedback?.blockReason) stop = "refusal"
      if (c.modelVersion) servedBy = c.modelVersion
      if (c.usageMetadata) {
        const cached = c.usageMetadata.cachedContentTokenCount ?? 0
        usage = {
          inputTokens: Math.max(0, (c.usageMetadata.promptTokenCount ?? 0) - cached),
          outputTokens:
            (c.usageMetadata.candidatesTokenCount ?? 0) + (c.usageMetadata.thoughtsTokenCount ?? 0),
          cacheReadTokens: cached,
          cacheWriteTokens: 0,
        }
      }
      const cand = c.candidates?.[0]
      for (const p of cand?.content?.parts ?? []) {
        if (p.functionCall) {
          const id = p.functionCall.id ?? `gem_${n++}`
          p.functionCall.id = id
          yield { type: "tool_call_start", id, name: p.functionCall.name }
          yield {
            type: "tool_call_delta",
            id,
            partialJson: JSON.stringify(p.functionCall.args ?? {}),
          }
        } else if (p.text && p.thought) yield { type: "thinking_delta", text: p.text }
        else if (p.text) yield { type: "text_delta", text: p.text }
        parts.push(p)
      }
      if (cand?.finishReason) stop = finishOf(cand.finishReason)
    }
    const content: AssistantPart[] = []
    let text = ""
    for (const p of parts) {
      if (p.functionCall)
        content.push({
          type: "tool_call",
          id: p.functionCall.id ?? "",
          name: p.functionCall.name,
          input: p.functionCall.args ?? {},
        })
      else if (p.text && p.thought) content.push({ type: "thinking", text: p.text })
      else if (p.text) text += p.text
    }
    if (text) content.unshift({ type: "text", text })
    if (content.some((p) => p.type === "tool_call") && stop === "end_turn") stop = "tool_use"
    const message: AssistantMessage = {
      role: "assistant",
      content,
      native: { provider: this.id, model: req.model, content: parts },
    }
    yield { type: "message_end", message, stopReason: stop, usage, servedBy }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const j = (await getJson(
      this.runtime,
      this.id,
      `${this.baseURL}/models`,
      this.headers(),
      signal,
    )) as {
      models?: { name: string }[]
    }
    return (j.models ?? []).map((m) => m.name.replace(/^models\//, ""))
  }

  async test(signal?: AbortSignal): Promise<ConnectionTest> {
    const t0 = Date.now()
    try {
      await this.listModels(signal)
      for await (const _ of this.stream({
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
      })) {
        // drain
      }
      return {
        ok: true,
        latencyMs: Date.now() - t0,
        detail: `${this.config.models.agent} reachable · tools + streaming`,
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

function finishOf(f: string): StopReason {
  if (f === "STOP") return "end_turn"
  if (f === "MAX_TOKENS") return "max_tokens"
  if (f === "SAFETY" || f === "RECITATION" || f === "PROHIBITED_CONTENT" || f === "BLOCKLIST")
    return "refusal"
  return "other"
}

export function buildGeminiBody(
  req: ProviderRequest,
  info: ModelInfo,
  providerId: string,
): Record<string, unknown> {
  const contents: { role: "user" | "model"; parts: GeminiPart[] }[] = []
  for (const m of req.messages) contents.push(...geminiContents(m, providerId, req.model))
  const budget = geminiThinkingBudget(info, req.thinking)
  const generationConfig: Record<string, unknown> = {}
  if (req.maxTokens) generationConfig.maxOutputTokens = req.maxTokens
  if (budget !== undefined)
    generationConfig.thinkingConfig = { thinkingBudget: budget, includeThoughts: budget !== 0 }
  if (req.responseSchema) {
    generationConfig.responseMimeType = "application/json"
    generationConfig.responseJsonSchema = req.responseSchema.schema
  }
  const system = req.system.volatile
    ? `${req.system.stable}\n\n${req.system.volatile}`
    : req.system.stable
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    ...(req.tools.length
      ? {
          tools: [
            {
              functionDeclarations: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parametersJsonSchema: t.inputSchema,
              })),
            },
          ],
        }
      : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
  }
}

function geminiContents(
  m: ChatMessage,
  providerId: string,
  model: string,
): { role: "user" | "model"; parts: GeminiPart[] }[] {
  if (m.role === "user")
    return [
      {
        role: "user",
        parts: m.content.map((p) =>
          p.type === "text"
            ? { text: p.text }
            : { inlineData: { mimeType: p.mimeType, data: p.data } },
        ),
      },
    ]
  if (m.role === "assistant") {
    if (m.native && m.native.provider === providerId && m.native.model === model)
      return [{ role: "model", parts: structuredClone(m.native.content) as GeminiPart[] }]
    const parts: GeminiPart[] = []
    for (const p of m.content) {
      if (p.type === "text" && p.text) parts.push({ text: p.text })
      else if (p.type === "tool_call")
        parts.push({ functionCall: { id: p.id, name: p.name, args: p.input } })
    }
    return parts.length ? [{ role: "model", parts }] : []
  }
  const parts: GeminiPart[] = []
  for (const r of m.results) {
    let response: Record<string, unknown>
    try {
      const v = JSON.parse(r.content)
      response =
        v && typeof v === "object" && !Array.isArray(v)
          ? (v as Record<string, unknown>)
          : { result: v }
    } catch {
      response = { result: r.content }
    }
    parts.push({ functionResponse: { id: r.callId, name: r.name, response } })
    for (const i of r.images ?? [])
      parts.push({ inlineData: { mimeType: i.mimeType, data: i.data } })
  }
  return [{ role: "user", parts }]
}
