import { failure, success, type ToolResult } from "@kimo/mcp-server"
import type { Provider, ProviderConfig, ProviderRuntime } from "../src/providers/provider"
import type { ToolCallRequest, ToolHost, ToolOutcome } from "../src/toolhost"
import type { AssistantMessage, ProviderRequest, StreamEvent, ToolSpec, Usage } from "../src/types"

export const sse = (events: { event?: string; data: unknown }[]): string =>
  events
    .map(
      (e) =>
        `${e.event ? `event: ${e.event}\n` : ""}data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`,
    )
    .join("")

export function streamResponse(
  text: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const bytes = new TextEncoder().encode(text)
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      // Split in two chunks to exercise the line buffer.
      const mid = Math.floor(bytes.length / 2)
      c.enqueue(bytes.slice(0, mid))
      c.enqueue(bytes.slice(mid))
      c.close()
    },
  })
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream", ...headers },
  })
}

export interface Captured {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

/** A fetch that answers from a queue of responders and records requests. */
export function mockFetch(responders: ((req: Captured) => Response | Promise<Response>)[]): {
  fetch: typeof fetch
  calls: Captured[]
} {
  const calls: Captured[] = []
  const f = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    const headers: Record<string, string> = {}
    req.headers.forEach((v, k) => {
      headers[k] = v
    })
    const text = req.method === "GET" ? "" : await req.text()
    const cap: Captured = {
      url: req.url,
      method: req.method,
      headers,
      body: text ? JSON.parse(text) : undefined,
    }
    calls.push(cap)
    const r = responders.shift()
    if (!r) throw new Error(`Unexpected request ${req.url}`)
    return r(cap)
  }
  return { fetch: f as typeof fetch, calls }
}

export const runtime = (
  f: typeof fetch,
  platform: ProviderRuntime["platform"] = "node",
  online = true,
): ProviderRuntime => ({
  platform,
  fetch: f,
  online: () => online,
})

export const anthropicConfig = (extra: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: "anthropic",
  kind: "anthropic",
  label: "Anthropic",
  models: { agent: "claude-opus-5-5", fast: "claude-haiku-4-5-20251001" },
  apiKey: "sk-ant-test",
  ...extra,
})

export const anthropicTextStream = (text: string, usage = { input_tokens: 10, output_tokens: 5 }) =>
  sse([
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: usage.input_tokens,
            output_tokens: 1,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 0,
          },
        },
      },
    },
    {
      event: "content_block_start",
      data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    },
    ...text.split(" ").map((w, i) => ({
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: i ? ` ${w}` : w },
      },
    })),
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: usage.output_tokens },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ])

export const anthropicToolStream = (id: string, name: string, input: unknown) =>
  sse([
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_2",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 20, output_tokens: 1 },
        },
      },
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id, name, input: {} },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
      },
    },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: { output_tokens: 12 },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ])

// --- Scripted provider ------------------------------------------------------------------------

export type Script = (
  req: ProviderRequest,
  call: number,
) => StreamEvent[] | Error | Promise<StreamEvent[] | Error>

export const U = (i: number, o: number): Usage => ({
  inputTokens: i,
  outputTokens: o,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

export function textTurn(text: string, usage = U(100, 20)): StreamEvent[] {
  const message: AssistantMessage = { role: "assistant", content: [{ type: "text", text }] }
  return [
    { type: "text_delta", text },
    { type: "message_end", message, stopReason: "end_turn", usage, servedBy: "m" },
  ]
}

export function toolTurn(
  calls: { id: string; name: string; input: Record<string, unknown> }[],
  usage = U(100, 20),
): StreamEvent[] {
  const message: AssistantMessage = {
    role: "assistant",
    content: calls.map((c) => ({ type: "tool_call", ...c })),
  }
  return [
    ...calls.map((c) => ({ type: "tool_call_start" as const, id: c.id, name: c.name })),
    { type: "message_end", message, stopReason: "tool_use", usage, servedBy: "m" },
  ]
}

export function scriptedProvider(
  script: Script,
  config: Partial<ProviderConfig> = {},
): Provider & { requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = []
  const cfg = anthropicConfig(config)
  return {
    id: cfg.id,
    kind: cfg.kind,
    config: cfg,
    requests,
    modelInfo: (m) => ({
      id: m,
      label: m,
      thinking: "none",
      vision: true,
      contextWindow: 1e6,
      maxOutput: 1e5,
    }),
    listModels: async () => [],
    test: async () => ({ ok: true, latencyMs: 0, detail: "" }),
    async *stream(req) {
      requests.push(structuredClone({ ...req, signal: undefined }))
      const r = await script(req, requests.length - 1)
      if (r instanceof Error) throw r
      for (const e of r) {
        if (req.signal?.aborted) throw new DOMException("Aborted", "AbortError")
        yield e
      }
    },
  }
}

// --- Fake tool host ---------------------------------------------------------------------------

export function fakeToolHost(
  handler: (call: ToolCallRequest) => ToolResult | Promise<ToolResult>,
  specs: ToolSpec[] = [
    { name: "kimo_apply_ops", description: "ops", inputSchema: { type: "object", properties: {} } },
  ],
): ToolHost & { calls: ToolCallRequest[] } {
  const calls: ToolCallRequest[] = []
  return {
    calls,
    tools: () => specs,
    async call(c): Promise<ToolOutcome> {
      calls.push(structuredClone(c))
      return { result: await handler(c) }
    },
  }
}

let tok = 0
export function applied(
  summary: string,
  opsCount: number,
  created: { key: string; id: string }[] = [],
): ToolResult {
  return success({}, summary, {
    doc: { id: "d_1", path: "/x.kimo", dirty: true, readOnly: false },
    ops: Array.from({ length: opsCount }, () => ({ op: "insert" })),
    changed: created.map((c) => c.id),
    created,
    undoToken: `u${++tok}`,
  })
}

export { failure, success }
