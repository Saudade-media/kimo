/**
 * Test doubles for Settings › AI providers and the Home composer (unit tests and the e2e
 * harness): a scripted CLI host (which / --version / auth status answers per command) and a
 * routed fetch that answers the Anthropic / OpenAI-compatible / Gemini endpoints the adapters'
 * `test()` and the fast-model namer call. Never used by the app bundle.
 */
import {
  createMemorySecrets,
  createWebSecrets,
  type KeyValueStorage,
  providerAccount,
} from "@kimo/platform"
import { type AiSettingsController, type CliHost, createAiSettingsController } from "./controller"
import type { StoredProvider } from "./model"
import { relayAuthFor } from "./runtime"

export interface FakeCli {
  /** Resolved path; null = not on PATH. */
  path: string | null
  version?: string
  /** `claude auth status --json` / `codex login status` stdout and exit code. */
  auth?: { stdout: string; code: number }
}

/** Board 23 state: Claude Code signed in (Max), Codex installed not signed in, Gemini missing. */
export const BOARD_23_CLIS: Record<string, FakeCli> = {
  claude: {
    path: "/Users/me/.local/bin/claude",
    version: "2.1.4 (Claude Code)",
    auth: {
      code: 0,
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: "claude.ai",
        email: "me@example.com",
        subscriptionType: "max",
      }),
    },
  },
  codex: {
    path: "/opt/homebrew/bin/codex",
    version: "codex-cli 0.46.0",
    auth: { code: 1, stdout: "Not logged in" },
  },
  gemini: { path: null },
}

export function createFakeCliHost(
  clis: Record<string, FakeCli>,
  calls: string[] = [],
): CliHost & { calls: string[]; set(command: string, cli: FakeCli): void } {
  const table = { ...clis }
  const byPath = () =>
    new Map(Object.values(table).flatMap((c) => (c.path ? [[c.path, c] as const] : [])))
  return {
    calls,
    set(command, cli) {
      table[command] = cli
    },
    async which(command) {
      calls.push(`which ${command}`)
      return table[command]?.path ?? null
    },
    async exec(path, args) {
      calls.push(`exec ${path} ${args.join(" ")}`)
      const c = byPath().get(path)
      if (!c) return { code: 127, stdout: "", stderr: "not found" }
      if (args[0] === "--version") return { code: 0, stdout: c.version ?? "", stderr: "" }
      return { code: c.auth?.code ?? 1, stdout: c.auth?.stdout ?? "", stderr: "" }
    },
    async homeFileExists() {
      return false
    },
    async hasEnv() {
      return false
    },
    async prepareWorkspace(session) {
      return `/Users/me/.kimo/cli-workspaces/${session}`
    },
    async spawn() {
      throw new Error("fake CLI host: spawn is not scripted")
    },
  }
}

const sse = (events: { event?: string; data: unknown }[]) =>
  events
    .map((e) => `${e.event ? `event: ${e.event}\n` : ""}data: ${JSON.stringify(e.data)}\n\n`)
    .join("")

/** A complete Anthropic Messages stream with one text block. */
export function anthropicStream(text: string, model = "claude-opus-5-5"): string {
  return sse([
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      },
    },
    {
      event: "content_block_start",
      data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    },
    {
      event: "content_block_delta",
      data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 5 },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ])
}

export interface MockFetchOptions {
  /** Keys that authenticate (anything else → 401). */
  validKeys?: string[]
  /** Text of every Messages response (the namer's JSON title). */
  reply?: string
  /** Latency per response, ms. */
  delayMs?: number
}

/** Routed fetch for the Anthropic endpoints (`/v1/models`, `/v1/messages`). */
export function createMockFetch(options: MockFetchOptions = {}): typeof fetch & {
  calls: { url: string; method: string; key: string | null }[]
} {
  const calls: { url: string; method: string; key: string | null }[] = []
  const valid = new Set(options.validKeys ?? ["sk-ant-api03-test-3f9a"])
  const f = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    const key =
      req.headers.get("x-api-key") ??
      req.headers.get("authorization")?.replace(/^Bearer /, "") ??
      null
    calls.push({ url: req.url, method: req.method, key })
    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs))
    if (req.url.includes("localhost:11434")) {
      if (req.url.endsWith("/models"))
        return Response.json({ object: "list", data: [{ id: "llama3.3:70b", object: "model" }] })
      return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
    }
    if (!key || !valid.has(key))
      return Response.json(
        { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
        { status: 401 },
      )
    if (req.url.includes("/v1/models"))
      return Response.json({
        data: [{ id: "claude-opus-5-5", type: "model", display_name: "Claude Opus 5.5" }],
        has_more: false,
        first_id: "claude-opus-5-5",
        last_id: "claude-opus-5-5",
      })
    return new Response(anthropicStream(options.reply ?? "OK"), {
      headers: { "content-type": "text/event-stream" },
    })
  }
  return Object.assign(f as typeof fetch, { calls })
}

export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  data: Map<string, string>
} {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v)
    },
    removeItem: (k) => {
      data.delete(k)
    },
  }
}

/** A controller over memory secrets, a fake CLI host and the mock fetch. */
export function createTestAiSettings(
  options: {
    platform?: "desktop" | "web"
    clis?: Record<string, FakeCli> | null
    keys?: Record<string, string>
    fetch?: typeof fetch
    storage?: KeyValueStorage
    now?: () => number
  } = {},
): AiSettingsController {
  const platform = options.platform ?? "desktop"
  const f = options.fetch ?? createMockFetch()
  // Web: the real localStorage-backed store (over memory); desktop: memory stands in for the
  // keychain.
  const secrets =
    platform === "web" ? createWebSecrets(memoryStorage()) : createMemorySecrets(options.keys ?? {})
  if (platform === "web")
    for (const [k, v] of Object.entries(options.keys ?? {})) void secrets.set(k, v)
  // Desktop: stands in for the Rust relay — the SDK's placeholder key is replaced by the stored
  // one in the provider's auth header (keys never pass through JS in the real app).
  const relay = (p: StoredProvider): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const auth = relayAuthFor(p)
      const headers = new Headers(req.headers)
      for (const h of ["authorization", "x-api-key", "x-goog-api-key"]) headers.delete(h)
      if (auth.kind === "header") {
        const key = await secrets.get(providerAccount(p.id))
        if (key) headers.set(auth.header, auth.scheme ? `${auth.scheme} ${key}` : key)
      }
      return f(new Request(req, { headers }))
    }) as typeof fetch
  return createAiSettingsController({
    platform,
    os: platform === "web" ? "web" : "macos",
    secrets,
    cliHost:
      platform === "desktop" && options.clis !== null
        ? createFakeCliHost(options.clis ?? BOARD_23_CLIS)
        : null,
    storage: options.storage ?? memoryStorage(),
    fetchFor: (p) => (platform === "desktop" ? relay(p) : f),
    home: "/Users/me",
    ...(options.now ? { now: options.now } : {}),
  })
}
