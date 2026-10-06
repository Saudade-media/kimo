import { describe, expect, test } from "bun:test"
import { ProviderError } from "../src/errors"
import { MODEL_CATALOG } from "../src/models"
import { AnthropicProvider, buildAnthropicParams } from "../src/providers/anthropic"
import { createProvider } from "../src/providers/factory"
import { GeminiProvider } from "../src/providers/gemini"
import { OpenAICompatibleProvider } from "../src/providers/openai"
import { availableOn, complete } from "../src/providers/provider"
import type { ProviderRequest, StreamEvent } from "../src/types"
import {
  anthropicConfig,
  anthropicTextStream,
  anthropicToolStream,
  mockFetch,
  runtime,
  sse,
  streamResponse,
} from "./helpers"

const req = (extra: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model: "claude-opus-5-5",
  system: { stable: "You are Kimo.", volatile: "Selection: Hero" },
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  tools: [
    {
      name: "kimo_query",
      description: "q",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ],
  thinking: "high",
  ...extra,
})

const collect = async (it: AsyncIterable<StreamEvent>) => {
  const out: StreamEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

describe("Anthropic adapter", () => {
  test("streams text and reports usage incl. cache reads", async () => {
    const { fetch, calls } = mockFetch([
      () => streamResponse(anthropicTextStream("Warmed the palette")),
    ])
    const p = new AnthropicProvider(anthropicConfig(), runtime(fetch))
    const events = await collect(p.stream(req()))
    expect(
      events
        .filter((e) => e.type === "text_delta")
        .map((e) => (e as { text: string }).text)
        .join(""),
    ).toBe("Warmed the palette")
    const end = events.at(-1)
    expect(end?.type).toBe("message_end")
    if (end?.type !== "message_end") throw new Error()
    expect(end.stopReason).toBe("end_turn")
    expect(end.usage.cacheReadTokens).toBe(3)
    expect(end.usage.outputTokens).toBe(5)
    expect(end.message.native?.provider).toBe("anthropic")
    expect(calls[0]?.headers["x-api-key"]).toBe("sk-ant-test")
    expect(calls[0]?.url).toContain("/v1/messages")
  })

  test("request: cache breakpoints, adaptive thinking + effort, eager tool streaming, no forced tool_choice", () => {
    const info = MODEL_CATALOG.anthropic[0] as (typeof MODEL_CATALOG.anthropic)[number]
    const p = buildAnthropicParams(req(), info, "anthropic", {
      fallback: true,
    }) as unknown as Record<string, unknown>
    const system = p.system as { text: string; cache_control?: unknown }[]
    expect(system[0]?.cache_control).toEqual({ type: "ephemeral" })
    expect(system[1]?.cache_control).toBeUndefined()
    expect(p.thinking).toEqual({ type: "adaptive", display: "summarized" })
    expect(p.output_config).toEqual({ effort: "high" })
    expect((p.tools as { eager_input_streaming: boolean }[])[0]?.eager_input_streaming).toBe(true)
    expect(p.tool_choice).toBeUndefined()
    expect(p.fallbacks).toBe("default")
    const msgs = p.messages as { content: { cache_control?: unknown }[] }[]
    expect(msgs.at(-1)?.content.at(-1)?.cache_control).toEqual({ type: "ephemeral" })
  })

  test("thinking Off/Max on Opus 5.5 maps to effort low/max; Haiku uses budget tokens", () => {
    const opus = MODEL_CATALOG.anthropic[0] as (typeof MODEL_CATALOG.anthropic)[number]
    const haiku = MODEL_CATALOG.anthropic.find((m) => m.id === "claude-haiku-4-5-20251001")
    if (!haiku) throw new Error()
    const off = buildAnthropicParams(req({ thinking: "low" }), opus, "a", {
      fallback: false,
    }) as unknown as Record<string, unknown>
    expect(off.output_config).toEqual({ effort: "low" })
    const max = buildAnthropicParams(req({ thinking: "max" }), opus, "a", {
      fallback: false,
    }) as unknown as Record<string, unknown>
    expect(max.output_config).toEqual({ effort: "max" })
    const h = buildAnthropicParams(req({ model: haiku.id, thinking: "max" }), haiku, "a", {
      fallback: false,
    }) as unknown as Record<string, unknown>
    expect(h.thinking).toEqual({ type: "enabled", budget_tokens: 16000 })
    expect(h.max_tokens as number).toBeGreaterThan(16000)
    const hoff = buildAnthropicParams(req({ model: haiku.id, thinking: "low" }), haiku, "a", {
      fallback: false,
    }) as unknown as Record<string, unknown>
    expect(hoff.thinking).toBeUndefined()
  })

  test("streams a tool call", async () => {
    const { fetch } = mockFetch([
      () => streamResponse(anthropicToolStream("toolu_1", "kimo_query", { docId: "d_1" })),
    ])
    const p = new AnthropicProvider(anthropicConfig(), runtime(fetch))
    const events = await collect(p.stream(req()))
    expect(events.find((e) => e.type === "tool_call_start")).toEqual({
      type: "tool_call_start",
      id: "toolu_1",
      name: "kimo_query",
    })
    const end = events.at(-1)
    if (end?.type !== "message_end") throw new Error()
    expect(end.stopReason).toBe("tool_use")
    expect(end.message.content[0]).toEqual({
      type: "tool_call",
      id: "toolu_1",
      name: "kimo_query",
      input: { docId: "d_1" },
    })
  })

  test("401 → auth, 429 → rate_limit with retry-after", async () => {
    const err =
      (status: number, type: string, headers: Record<string, string> = {}) =>
      () =>
        new Response(JSON.stringify({ type: "error", error: { type, message: type } }), {
          status,
          headers: { "content-type": "application/json", ...headers },
        })
    const { fetch } = mockFetch([
      err(401, "authentication_error"),
      err(429, "rate_limit_error", { "retry-after": "12" }),
    ])
    const p = new AnthropicProvider(anthropicConfig(), runtime(fetch))
    const e1 = await collect(p.stream(req())).catch((e) => e)
    expect(e1).toBeInstanceOf(ProviderError)
    expect((e1 as ProviderError).kind).toBe("auth")
    const e2 = (await collect(p.stream(req())).catch((e) => e)) as ProviderError
    expect(e2.kind).toBe("rate_limit")
    expect(e2.retryable).toBe(true)
    expect(e2.retryAfterMs).toBe(12000)
  })

  test("web without the browser opt-in is unavailable; with it, allowed", () => {
    expect(availableOn({ kind: "anthropic" }, "web").ok).toBe(false)
    expect(availableOn({ kind: "anthropic", allowBrowser: true }, "web").ok).toBe(true)
    expect(availableOn({ kind: "bedrock" }, "web").ok).toBe(false)
    expect(availableOn({ kind: "bedrock" }, "desktop").ok).toBe(true)
    expect(() =>
      createProvider({ ...anthropicConfig(), id: "b", kind: "bedrock" }, runtime(fetch, "web")),
    ).toThrow(ProviderError)
  })

  test("same provider+model replays native content; another model drops thinking", () => {
    const opus = MODEL_CATALOG.anthropic[0] as (typeof MODEL_CATALOG.anthropic)[number]
    const native = [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "ok" },
    ]
    const history: ProviderRequest["messages"] = [
      { role: "user", content: [{ type: "text", text: "a" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        native: { provider: "anthropic", model: "claude-opus-5-5", content: native },
      },
      { role: "user", content: [{ type: "text", text: "b" }] },
    ]
    const same = buildAnthropicParams(req({ messages: history }), opus, "anthropic", {
      fallback: false,
    }) as unknown as { messages: { content: unknown[] }[] }
    expect(same.messages[1]?.content).toEqual(native)
    const other = buildAnthropicParams(
      req({ model: "claude-sonnet-5-5", messages: history }),
      opus,
      "anthropic",
      { fallback: false },
    ) as unknown as { messages: { content: unknown[] }[] }
    expect(other.messages[1]?.content).toEqual([{ type: "text", text: "ok" }])
  })
})

describe("OpenAI-compatible adapter", () => {
  const cfg = {
    id: "openai",
    kind: "openai" as const,
    label: "OpenAI",
    models: { agent: "gpt-4.1", fast: "gpt-4.1-mini" },
    apiKey: "sk-o",
  }

  test("Chat Completions: text + tool call deltas + usage", async () => {
    const chunks = [
      { model: "gpt-4.1", choices: [{ delta: { content: "Adding " } }] },
      { choices: [{ delta: { content: "a card" } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: { name: "kimo_apply_ops", arguments: '{"docId":' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: '"d_1"}' } }] },
            finish_reason: "tool_calls",
          },
        ],
      },
      {
        choices: [],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          prompt_tokens_details: { cached_tokens: 20 },
        },
      },
    ]
    const { fetch, calls } = mockFetch([
      () => streamResponse(sse([...chunks.map((d) => ({ data: d })), { data: "[DONE]" }])),
    ])
    const p = new OpenAICompatibleProvider(cfg, runtime(fetch))
    const r = await complete(p, req({ model: "gpt-4.1" }))
    expect(r.text).toBe("Adding a card")
    expect(r.stopReason).toBe("tool_use")
    expect(r.message.content[1]).toEqual({
      type: "tool_call",
      id: "call_1",
      name: "kimo_apply_ops",
      input: { docId: "d_1" },
    })
    expect(r.usage).toEqual({
      inputTokens: 100,
      outputTokens: 30,
      cacheReadTokens: 20,
      cacheWriteTokens: 0,
    })
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions")
    expect(calls[0]?.headers.authorization).toBe("Bearer sk-o")
    const body = calls[0]?.body as {
      messages: { role: string }[]
      tools: unknown[]
      stream_options: unknown
    }
    expect(body.messages[0]?.role).toBe("system")
    expect(body.tools).toHaveLength(1)
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  test("Responses API: function call items and completed usage", async () => {
    const events = [
      {
        type: "response.output_item.added",
        item: { type: "function_call", id: "fc_1", call_id: "call_9", name: "kimo_query" },
      },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"docId":"d_1"}' },
      { type: "response.output_text.delta", delta: "Reading" },
      {
        type: "response.completed",
        response: { model: "gpt-4.1", usage: { input_tokens: 50, output_tokens: 5 }, output: [] },
      },
    ]
    const { fetch, calls } = mockFetch([
      () => streamResponse(sse(events.map((d) => ({ event: d.type, data: d })))),
    ])
    const p = new OpenAICompatibleProvider({ ...cfg, api: "responses" }, runtime(fetch))
    const r = await complete(p, req({ model: "gpt-4.1" }))
    expect(r.text).toBe("Reading")
    expect(r.message.content.find((c) => c.type === "tool_call")).toEqual({
      type: "tool_call",
      id: "call_9",
      name: "kimo_query",
      input: { docId: "d_1" },
    })
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/responses")
    expect((calls[0]?.body as { instructions?: string } | undefined)?.instructions).toContain(
      "You are Kimo.",
    )
  })

  test("OpenRouter and Ollama defaults", () => {
    const or = new OpenAICompatibleProvider(
      { ...cfg, id: "openrouter", kind: "openrouter" },
      runtime(fetch),
    )
    expect(or.baseURL).toBe("https://openrouter.ai/api/v1")
    expect(or.headers()["X-Title"]).toBe("Kimo")
    const ollama = new OpenAICompatibleProvider(
      {
        id: "custom:ollama",
        kind: "custom",
        label: "Ollama",
        models: { agent: "llama3.3:70b", fast: "llama3.3:70b" },
        free: true,
      },
      runtime(fetch),
    )
    expect(ollama.baseURL).toBe("http://localhost:11434/v1")
    expect(ollama.headers().authorization).toBeUndefined()
  })

  test("network failure on web while online → cors; offline → offline", async () => {
    const boom = (async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof fetch
    const web = new OpenAICompatibleProvider(cfg, runtime(boom, "web", true))
    expect(((await collect(web.stream(req())).catch((e) => e)) as ProviderError).kind).toBe("cors")
    const off = new OpenAICompatibleProvider(cfg, runtime(boom, "web", false))
    expect(((await collect(off.stream(req())).catch((e) => e)) as ProviderError).kind).toBe(
      "offline",
    )
  })
})

describe("Gemini adapter", () => {
  test("streams text and function calls; body uses parametersJsonSchema and thinking budget", async () => {
    const chunks = [
      { candidates: [{ content: { parts: [{ text: "Sure" }] } }] },
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: { name: "kimo_query", args: { docId: "d_1" } },
                  thoughtSignature: "s1",
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 8 },
      },
    ]
    const { fetch, calls } = mockFetch([
      () => streamResponse(sse(chunks.map((d) => ({ data: d })))),
    ])
    const p = new GeminiProvider(
      {
        id: "gemini",
        kind: "gemini",
        label: "Gemini",
        models: { agent: "gemini-2.5-pro", fast: "gemini-2.5-flash" },
        apiKey: "g",
      },
      runtime(fetch),
    )
    const r = await complete(p, req({ model: "gemini-2.5-pro", thinking: "low" }))
    expect(r.text).toBe("Sure")
    expect(r.stopReason).toBe("tool_use")
    expect(r.usage.inputTokens).toBe(40)
    expect(calls[0]?.url).toContain("/models/gemini-2.5-pro:streamGenerateContent?alt=sse")
    expect(calls[0]?.headers["x-goog-api-key"]).toBe("g")
    const body = calls[0]?.body as {
      tools: { functionDeclarations: { parametersJsonSchema: unknown }[] }[]
      generationConfig: { thinkingConfig: { thinkingBudget: number } }
    }
    expect(body.tools[0]?.functionDeclarations[0]?.parametersJsonSchema).toBeDefined()
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(1024)
    // Native parts (with thoughtSignature) are kept for replay.
    expect(JSON.stringify(r.message.native?.content)).toContain("s1")
  })
})
