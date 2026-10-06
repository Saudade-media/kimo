/**
 * Board 38 "Web access": CLI flags on/off, CLI stream parsing of web steps, the Anthropic
 * server tools (request, streamed blocks, per-search cost), OpenAI Responses web_search, and
 * the loop's web steps (status labels, transcript, Activity note).
 */
import { describe, expect, test } from "bun:test"
import {
  claudeCodeAdapter,
  claudeInvocation,
  claudeParser,
  codexInvocation,
  codexParser,
  geminiInvocation,
} from "../src/cli/adapters"
import { runCliTurn, shimLaunch } from "../src/cli/engine"
import type { CliDetection, CliProcess, CliProcessHost, CliTurnInput } from "../src/cli/types"
import { type AgentEvent, runTurn } from "../src/loop"
import { MODEL_CATALOG } from "../src/models"
import { estimateCost } from "../src/pricing"
import { stepLabel } from "../src/progress"
import { buildSystemPrompt } from "../src/prompt"
import { AnthropicProvider, buildAnthropicParams } from "../src/providers/anthropic"
import { buildResponsesBody, OpenAICompatibleProvider } from "../src/providers/openai"
import type { ProviderRequest, StreamEvent } from "../src/types"
import { anthropicWebTools, type WebNote, webLabel, webSupported } from "../src/web"
import {
  anthropicConfig,
  fakeToolHost,
  mockFetch,
  runtime,
  scriptedProvider,
  sse,
  streamResponse,
  textTurn,
  U,
} from "./helpers"

const input = (extra: Partial<CliTurnInput> = {}): CliTurnInput => ({
  session: "abc123",
  model: "default",
  thinking: "high",
  prompt: "Find the current Tailwind v4 default font stack and use it",
  systemPrompt: "You are Kimo.",
  mcp: shimLaunch("/kimo-mcp", "claude-code"),
  workspace: "/w",
  ...extra,
})

const flag = (args: string[], f: string) => args[args.indexOf(f) + 1]

describe("CLI flags", () => {
  test("Claude Code: off keeps every built-in tool off; on adds only WebSearch and WebFetch", () => {
    const off = claudeInvocation(input()).args
    expect(flag(off, "--tools")).toBe("")
    expect(flag(off, "--allowedTools")).toBe("mcp__kimo")
    const on = claudeInvocation(input({ webAccess: true })).args
    expect(flag(on, "--tools")).toBe("WebSearch,WebFetch")
    expect(flag(on, "--allowedTools")).toBe("mcp__kimo,WebSearch,WebFetch")
    // The rest of the lockdown stays.
    expect(on).toContain("--strict-mcp-config")
    expect(flag(on, "--permission-mode")).toBe("dontAsk")
    expect(on).toContain("--disable-slash-commands")
  })

  test("Codex: live web search when on, explicitly disabled when off (its default is cached)", () => {
    expect(codexInvocation(input({ webAccess: true })).args).toContain('web_search="live"')
    expect(codexInvocation(input()).args).toContain('web_search="disabled"')
    // ChatGPT apps carry their own web tool: off in every turn.
    const args = codexInvocation(input({ webAccess: true })).args
    expect(args[args.indexOf("--disable") + 1]).toBe("apps")
  })

  test("Gemini CLI: web_fetch and google_web_search excluded only while off", () => {
    const settings = (i: CliTurnInput) =>
      JSON.parse(
        geminiInvocation(i).workspaceFiles?.find((f) => f.path === ".gemini/settings.json")?.text ??
          "{}",
      ) as { tools: { exclude: string[] } }
    expect(settings(input()).tools.exclude).toEqual([
      "write_file",
      "replace",
      "run_shell_command",
      "web_fetch",
      "google_web_search",
    ])
    expect(settings(input({ webAccess: true })).tools.exclude).toEqual([
      "write_file",
      "replace",
      "run_shell_command",
    ])
  })
})

describe("labels", () => {
  test("running and done labels name the query or the host", () => {
    expect(webLabel("web_search", { query: "tailwind v4 fonts" }, "running")).toBe(
      "Searching the web for “tailwind v4 fonts”",
    )
    expect(webLabel("web_search", { query: "tailwind v4 fonts" }, "done")).toBe(
      "Searched the web for “tailwind v4 fonts”",
    )
    expect(webLabel("web_fetch", { url: "https://www.tailwindcss.com/docs/x" }, "running")).toBe(
      "Reading tailwindcss.com",
    )
    expect(webLabel("web_fetch", { url: "https://tailwindcss.com/docs/x" }, "done")).toBe(
      "Read tailwindcss.com",
    )
    // Gemini CLI's web_fetch takes a prompt with the URL in it.
    expect(
      webLabel("web_fetch", { prompt: "Summarize https://example.com/a please" }, "done"),
    ).toBe("Read example.com")
    // CLI spellings go through stepLabel.
    expect(stepLabel({ id: "1", name: "WebSearch", input: { query: "q" } })).toBe(
      "Searching the web for “q”",
    )
    expect(stepLabel({ id: "1", name: "google_web_search", input: { query: "q" } })).toBe(
      "Searching the web for “q”",
    )
  })

  test("which models can use the web", () => {
    const opus = { provider: "anthropic", model: "claude-opus-5-5" }
    expect(webSupported(opus, { kind: "anthropic" })).toBe(true)
    expect(webSupported(opus, { kind: "anthropic", baseURL: "https://proxy.example" })).toBe(false)
    expect(webSupported({ provider: "bedrock", model: "x" }, { kind: "bedrock" })).toBe(false)
    expect(webSupported({ provider: "vertex", model: "x" }, { kind: "vertex" })).toBe(true)
    expect(webSupported({ provider: "openai", model: "o3" }, { kind: "openai" })).toBe(false)
    expect(
      webSupported({ provider: "openai", model: "o3" }, { kind: "openai", api: "responses" }),
    ).toBe(true)
    expect(webSupported({ provider: "gemini", model: "g" }, { kind: "gemini" })).toBe(false)
    expect(webSupported({ provider: "cli:claude-code", model: "default" })).toBe(true)
    expect(webSupported({ provider: "cli:my-cli", model: "default" })).toBe(false)
  })
})

// --- CLI streams -------------------------------------------------------------------------------

/** A CLI host whose one process prints `lines` and exits 0. */
function scriptedCliHost(lines: string[]): CliProcessHost {
  return {
    which: async () => "/bin/fake",
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    homeFileExists: async () => false,
    hasEnv: async () => false,
    prepareWorkspace: async (s) => `/ws/${s}`,
    async spawn(): Promise<CliProcess> {
      let out: (c: string) => void = () => {}
      let done: (v: { code: number | null; signal: string | null }) => void = () => {}
      const exited = new Promise<{ code: number | null; signal: string | null }>((r) => {
        done = r
      })
      return {
        pid: 1,
        write: async () => {},
        closeStdin: async () => {
          setTimeout(() => {
            out(`${lines.join("\n")}\n`)
            done({ code: 0, signal: null })
          }, 0)
        },
        kill: async () => {},
        onStdout: (l) => {
          out = l
          return () => {}
        },
        onStderr: () => () => {},
        exited,
      }
    },
  }
}

const detection: CliDetection = {
  id: "claude-code",
  label: "Claude Code",
  installed: true,
  path: "/bin/fake",
  signedIn: true,
  billing: "subscription",
}

/** Claude Code 2.1.290 stream-json shape of a WebSearch + WebFetch turn (recorded, trimmed). */
const CLAUDE_WEB = [
  { type: "system", subtype: "init", session_id: "s1", mcp_servers: [] },
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "WebSearch",
          input: { query: "Tailwind v4 default sans font stack" },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "Links: [...]" }],
    },
  },
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_2",
          name: "WebFetch",
          input: { url: "https://tailwindcss.com/docs/font-family", prompt: "Default stack?" },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "ui-sans-serif, …" }],
    },
  },
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "text",
          text: "Body uses the stack.\n\nSources:\nhttps://tailwindcss.com/docs/font-family",
        },
      ],
    },
  },
  { type: "result", subtype: "success", is_error: false, session_id: "s1" },
].map((j) => JSON.stringify(j))

describe("CLI web steps", () => {
  test("Claude Code: WebSearch / WebFetch become labelled steps, transcript and Activity notes", async () => {
    const events: AgentEvent[] = []
    const notes: (WebNote & { workspace: string })[] = []
    const rec = await runCliTurn({
      turnId: "t1",
      adapter: claudeCodeAdapter,
      detection,
      host: scriptedCliHost(CLAUDE_WEB),
      session: "abc123",
      model: { provider: "cli:claude-code", model: "default" },
      thinking: "high",
      user: { role: "user", content: [{ type: "text", text: "x" }] },
      systemPrompt: "You are Kimo.",
      mcp: shimLaunch("/kimo-mcp", "claude-code"),
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
      webAccess: true,
      webNote: (n) => notes.push(n),
    })
    expect(rec.status).toBe("done")
    const starts = events.flatMap((e) => (e.type === "step_start" ? [e.label] : []))
    expect(starts).toEqual([
      "Searching the web for “Tailwind v4 default sans font stack”",
      "Reading tailwindcss.com",
    ])
    const ends = events.flatMap((e) => (e.type === "step_end" ? [[e.tool, e.summary]] : []))
    expect(ends).toEqual([
      ["web_search", "Searched the web for “Tailwind v4 default sans font stack”"],
      ["web_fetch", "Read tailwindcss.com"],
    ])
    expect(rec.web?.map((w) => [w.tool, w.detail, w.ok])).toEqual([
      ["web_search", "Tailwind v4 default sans font stack", true],
      ["web_fetch", "https://tailwindcss.com/docs/font-family", true],
    ])
    expect(notes.map((n) => [n.tool, n.workspace])).toEqual([
      ["web_search", "/ws/abc123"],
      ["web_fetch", "/ws/abc123"],
    ])
    // The parser alone: the steps keep Claude Code's tool names until the engine maps them.
    const p = claudeParser()
    expect(p.push(CLAUDE_WEB[1] as string)[0]).toMatchObject({
      type: "step_start",
      tool: "WebSearch",
    })
  })

  test("Codex: web_search items (a search, then a page it opened)", () => {
    const p = codexParser()
    const ev = (item: Record<string, unknown>, type: string) =>
      p.push(JSON.stringify({ type, item }))
    expect(
      ev(
        { id: "item_0", type: "web_search", query: "", action: { type: "other" } },
        "item.started",
      ),
    ).toEqual([{ type: "step_start", callId: "item_0", tool: "web_search", input: {} }])
    expect(
      ev(
        {
          id: "item_0",
          type: "web_search",
          query: "Tailwind CSS v4 default sans font stack",
          action: { type: "search", query: "Tailwind CSS v4 default sans font stack" },
        },
        "item.completed",
      ),
    ).toEqual([
      {
        type: "step_end",
        callId: "item_0",
        tool: "web_search",
        ok: true,
        output: "",
        input: { query: "Tailwind CSS v4 default sans font stack" },
      },
    ])
    expect(
      ev(
        {
          id: "item_1",
          type: "web_search",
          query: "https://tailwindcss.com/docs/font-family",
          action: { type: "other" },
        },
        "item.completed",
      )[0],
    ).toMatchObject({
      tool: "web_fetch",
      input: { url: "https://tailwindcss.com/docs/font-family" },
    })
  })
})

// --- Anthropic server tools --------------------------------------------------------------------

const req = (extra: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model: "claude-opus-5-5",
  system: { stable: "You are Kimo." },
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  tools: [],
  thinking: "high",
  ...extra,
})

/** A streamed turn: web_search, its result, web_fetch (failed), then text. */
const anthropicWebStream = () =>
  sse([
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_w",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 1 },
        },
      },
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"query":"tailwind v4 fonts"}' },
      },
    },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_1",
          content: [
            {
              type: "web_search_result",
              url: "https://tailwindcss.com/docs/font-family",
              title: "font-family",
              encrypted_content: "x",
              page_age: null,
            },
          ],
        },
      },
    },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 2,
        content_block: { type: "server_tool_use", id: "srvtoolu_2", name: "web_fetch", input: {} },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 2,
        delta: {
          type: "input_json_delta",
          partial_json: '{"url":"https://tailwindcss.com/docs/font-family"}',
        },
      },
    },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 2 } },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 3,
        content_block: {
          type: "web_fetch_tool_result",
          tool_use_id: "srvtoolu_2",
          content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" },
        },
      },
    },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 3 } },
    {
      event: "content_block_start",
      data: { type: "content_block_start", index: 4, content_block: { type: "text", text: "" } },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 4,
        delta: { type: "text_delta", text: "Done." },
      },
    },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 4 } },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 40, server_tool_use: { web_search_requests: 1 } },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ])

describe("Anthropic web tools", () => {
  test("request: server tools only when web access is on, versions per model and platform", () => {
    const opus = MODEL_CATALOG.anthropic[0] as (typeof MODEL_CATALOG.anthropic)[number]
    const none = buildAnthropicParams(req(), opus, "anthropic", { fallback: false })
    expect(none.tools).toBeUndefined()
    const p = buildAnthropicParams(req({ webAccess: true }), opus, "anthropic", {
      fallback: false,
      web: anthropicWebTools("anthropic", "claude-opus-5-5", true),
    })
    expect(p.tools).toEqual([
      { type: "web_search_20260209", name: "web_search", max_uses: 5 },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5, max_content_tokens: 20_000 },
    ] as never)
    expect(anthropicWebTools("anthropic", "claude-haiku-4-5", true)).toEqual({
      search: "web_search_20250305",
      fetch: "web_fetch_20250910",
    })
    expect(anthropicWebTools("vertex", "claude-opus-5-5", false)).toEqual({
      search: "web_search_20250305",
    })
    expect(anthropicWebTools("bedrock", "claude-opus-5-5", false)).toEqual({})
    expect(anthropicWebTools("anthropic", "claude-opus-5-5", false)).toEqual({})
  })

  test("stream: server_tool_use and its result blocks become web_start / web_end; searches billed", async () => {
    const { fetch, calls } = mockFetch([() => streamResponse(anthropicWebStream())])
    const p = new AnthropicProvider(anthropicConfig(), runtime(fetch))
    const events: StreamEvent[] = []
    for await (const e of p.stream(req({ webAccess: true }))) events.push(e)
    const body = calls[0]?.body as { tools: { name: string }[] }
    expect(body.tools.map((t) => t.name)).toEqual(["web_search", "web_fetch"])
    const web = events.filter((e) => e.type === "web_start" || e.type === "web_end")
    expect(web).toEqual([
      {
        type: "web_start",
        id: "srvtoolu_1",
        tool: "web_search",
        input: { query: "tailwind v4 fonts" },
      },
      { type: "web_end", id: "srvtoolu_1", tool: "web_search", ok: true },
      {
        type: "web_start",
        id: "srvtoolu_2",
        tool: "web_fetch",
        input: { url: "https://tailwindcss.com/docs/font-family" },
      },
      { type: "web_end", id: "srvtoolu_2", tool: "web_fetch", ok: false },
    ])
    // No client tool deltas leak from the server tool input.
    expect(events.some((e) => e.type === "tool_call_delta")).toBe(false)
    const end = events.at(-1)
    if (end?.type !== "message_end") throw new Error()
    expect(end.usage.webSearches).toBe(1)
    // The neutral message carries only the text; the server blocks stay in `native` for replay.
    expect(end.message.content).toEqual([{ type: "text", text: "Done." }])
    expect(
      ((end.message.native?.content ?? []) as { type: string }[]).map((b) => b.type),
    ).toContain("web_search_tool_result")
    // $10 per 1,000 searches on top of tokens.
    const tokensOnly = estimateCost("anthropic", "claude-opus-5-5", {
      ...end.usage,
      webSearches: 0,
    })
    const withSearch = estimateCost("anthropic", "claude-opus-5-5", end.usage)
    expect((withSearch.usd ?? 0) - (tokensOnly.usd ?? 0)).toBeCloseTo(0.01, 6)
  })
})

describe("OpenAI web search", () => {
  test("Responses API only, mapped to web steps", async () => {
    const info = {
      id: "o3",
      label: "o3",
      thinking: "none",
      vision: true,
      contextWindow: 1,
      maxOutput: 1,
    } as const
    expect(buildResponsesBody(req(), info).tools).toBeUndefined()
    expect(buildResponsesBody(req(), info, { webSearch: true }).tools).toEqual([
      { type: "web_search" },
    ])
    const { fetch, calls } = mockFetch([
      () =>
        streamResponse(
          sse([
            {
              data: {
                type: "response.output_item.added",
                item: { type: "web_search_call", id: "ws_1", status: "in_progress" },
              },
            },
            {
              data: {
                type: "response.output_item.done",
                item: {
                  type: "web_search_call",
                  id: "ws_1",
                  status: "completed",
                  action: { type: "search", query: "tailwind v4 fonts" },
                },
              },
            },
            { data: { type: "response.output_text.delta", delta: "Done." } },
            {
              data: {
                type: "response.completed",
                response: { model: "o3", output: [], usage: { input_tokens: 1, output_tokens: 1 } },
              },
            },
          ]),
        ),
    ])
    const p = new OpenAICompatibleProvider(
      {
        id: "openai",
        kind: "openai",
        label: "OpenAI",
        api: "responses",
        apiKey: "k",
        models: { agent: "o3", fast: "o3" },
      },
      runtime(fetch),
    )
    const events: StreamEvent[] = []
    for await (const e of p.stream(req({ model: "o3", webAccess: true }))) events.push(e)
    expect((calls[0]?.body as { tools?: unknown } | undefined)?.tools).toEqual([
      { type: "web_search" },
    ])
    expect(events.filter((e) => e.type === "web_start" || e.type === "web_end")).toEqual([
      { type: "web_start", id: "ws_1", tool: "web_search", input: {} },
      {
        type: "web_end",
        id: "ws_1",
        tool: "web_search",
        ok: true,
        input: { query: "tailwind v4 fonts" },
      },
    ])
  })
})

describe("loop", () => {
  test("web events become steps, land in the transcript and the Activity note; webAccess reaches the provider", async () => {
    const provider = scriptedProvider(() => [
      { type: "web_start", id: "s1", tool: "web_search", input: { query: "tailwind v4 fonts" } },
      { type: "web_end", id: "s1", tool: "web_search", ok: true },
      ...textTurn("Done.", { ...U(10, 5), webSearches: 1 }),
    ])
    const notes: WebNote[] = []
    const tools = { ...fakeToolHost(() => ({}) as never), note: (n: WebNote) => notes.push(n) }
    const events: AgentEvent[] = []
    const rec = await runTurn({
      turnId: "t",
      provider,
      model: { provider: "anthropic", model: "claude-opus-5-5" },
      info: MODEL_CATALOG.anthropic[0] as never,
      thinking: "high",
      system: { stable: "s" },
      history: [],
      user: { role: "user", content: [{ type: "text", text: "x" }] },
      tools,
      origin: "agent:kimo.s.1",
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
      webAccess: true,
    })
    expect(provider.requests[0]?.webAccess).toBe(true)
    expect(events.find((e) => e.type === "step_start")).toMatchObject({
      callId: "s1",
      tool: "web_search",
      label: "Searching the web for “tailwind v4 fonts”",
    })
    expect(events.find((e) => e.type === "step_end")).toMatchObject({
      ok: true,
      summary: "Searched the web for “tailwind v4 fonts”",
    })
    expect(rec.web).toEqual([
      {
        callId: "s1",
        tool: "web_search",
        label: "Searched the web for “tailwind v4 fonts”",
        detail: "tailwind v4 fonts",
        ok: true,
      },
    ])
    expect(notes).toEqual([
      {
        tool: "web_search",
        summary: "Searched the web for “tailwind v4 fonts”",
        detail: "tailwind v4 fonts",
        ok: true,
      },
    ])
    expect(rec.usage.webSearches).toBe(1)
    // A turn without web access sends no flag.
    const quiet = scriptedProvider(() => textTurn("Hi"))
    await runTurn({
      turnId: "t2",
      provider: quiet,
      model: { provider: "anthropic", model: "claude-opus-5-5" },
      info: MODEL_CATALOG.anthropic[0] as never,
      thinking: "high",
      system: { stable: "s" },
      history: [],
      user: { role: "user", content: [{ type: "text", text: "x" }] },
      tools: fakeToolHost(() => ({}) as never),
      origin: "agent:kimo.s.1",
      signal: new AbortController().signal,
      onEvent: () => {},
    })
    expect(quiet.requests[0]?.webAccess).toBeUndefined()
  })

  test("prompt guidance only when web access is on", () => {
    const on = buildSystemPrompt({ mode: "single", skills: [], webAccess: true })
    const off = buildSystemPrompt({ mode: "single", skills: [] })
    expect(on.stable).toContain("End your reply with “Sources:”")
    expect(off.stable).not.toContain("Sources:")
  })
})
