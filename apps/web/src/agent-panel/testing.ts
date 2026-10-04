/**
 * Test doubles for the agent panel (unit tests, the m6 e2e harness): a scripted `Provider`
 * (mocked API: streams text, tool calls, usage; can fail with a typed `ProviderError`) and a
 * fake CLI process host (stream-json lines like Claude Code's). Never shipped in the app bundle.
 */
import {
  type AssistantMessage,
  type CliDetection,
  type CliProcess,
  type CliProcessHost,
  catalogInfo,
  createMemorySessionStore,
  genericModelInfo,
  type ModelSelection,
  type Provider,
  type ProviderConfig,
  ProviderError,
  type ProviderErrorKind,
  type ProviderRequest,
  type StreamEvent,
  type Usage,
} from "@kimo/ai-agent"
import type { AgentPanelRuntime } from "./runtime"
import type { ToolHostFactory } from "./tools"

/** One model call of a script. */
export type ScriptStep =
  | {
      text?: string
      thinking?: string
      tools?: { name: string; input: Record<string, unknown> }[]
      usage?: Partial<Usage>
      /** ms between streamed chunks (default 0). */
      delayMs?: number
      stop?: "end_turn" | "refusal" | "max_tokens"
    }
  | { error: ProviderErrorKind; message?: string; status?: number; retryAfterMs?: number }

/** A scripted reply per request: return the steps for the call (by its last user text). */
export type Script = (req: ProviderRequest, callIndex: number) => ScriptStep

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted)
      return reject(new ProviderError("aborted", "Stopped.", { provider: "mock" }))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t)
        reject(new ProviderError("aborted", "Stopped.", { provider: "mock" }))
      },
      { once: true },
    )
  })

/** A mocked provider that follows `script`. Records every request in `calls`. */
export function createMockProvider(
  config: ProviderConfig,
  script: Script,
): Provider & { calls: ProviderRequest[] } {
  const calls: ProviderRequest[] = []
  return {
    id: config.id,
    kind: config.kind,
    config,
    calls,
    async *stream(req): AsyncIterable<StreamEvent> {
      const i = calls.length
      calls.push(req)
      const step = script(req, i)
      if ("error" in step)
        throw new ProviderError(step.error, step.message ?? step.error, {
          provider: config.id,
          ...(step.status ? { status: step.status } : {}),
          ...(step.retryAfterMs !== undefined ? { retryAfterMs: step.retryAfterMs } : {}),
        })
      const delay = step.delayMs ?? 0
      const usage: Usage = {
        inputTokens: step.usage?.inputTokens ?? 1200,
        outputTokens: step.usage?.outputTokens ?? 300,
        cacheReadTokens: step.usage?.cacheReadTokens ?? 0,
        cacheWriteTokens: step.usage?.cacheWriteTokens ?? 0,
      }
      if (step.thinking) yield { type: "thinking_delta", text: step.thinking }
      const words = (step.text ?? "").split(/(?<= )/)
      for (const w of words) {
        if (!w) continue
        if (delay) await sleep(delay, req.signal)
        if (req.signal?.aborted)
          throw new ProviderError("aborted", "Stopped.", { provider: config.id })
        yield { type: "text_delta", text: w }
        yield {
          type: "usage",
          usage: { ...usage, outputTokens: Math.ceil(usage.outputTokens / 2) },
        }
      }
      const content: AssistantMessage["content"] = []
      if (step.text) content.push({ type: "text", text: step.text })
      for (const [k, t] of (step.tools ?? []).entries()) {
        const id = `call_${i}_${k}`
        yield { type: "tool_call_start", id, name: t.name }
        content.push({ type: "tool_call", id, name: t.name, input: t.input })
      }
      if (delay) await sleep(delay, req.signal)
      yield {
        type: "message_end",
        message: { role: "assistant", content },
        stopReason: step.stop ?? (step.tools?.length ? "tool_use" : "end_turn"),
        usage,
        servedBy: req.model,
      }
    },
    async listModels() {
      return [config.models.agent, config.models.fast]
    },
    async test() {
      return { ok: true, latencyMs: 1, detail: "mock" }
    },
    modelInfo(model) {
      return catalogInfo(config.kind, model) ?? genericModelInfo(model)
    },
  }
}

export const MOCK_ANTHROPIC: ProviderConfig = {
  id: "anthropic",
  kind: "anthropic",
  label: "Anthropic",
  models: { agent: "claude-opus-5-5", fast: "claude-haiku-4-5-20251001" },
  apiKey: "sk-ant-test",
}

/**
 * A fake local CLI host: `which` finds `claude`, `exec` answers `--version` / `auth status`,
 * `spawn` replays stream-json lines (Claude Code's `--output-format stream-json`).
 */
export function createFakeCliHost(lines: (prompt: string) => string[]): CliProcessHost & {
  spawned: { args: string[]; cwd: string; stdin: string }[]
} {
  const spawned: { args: string[]; cwd: string; stdin: string }[] = []
  return {
    spawned,
    async which(command) {
      return command === "claude" ? "/usr/local/bin/claude" : null
    },
    async exec(_path, args) {
      if (args.includes("--version"))
        return { code: 0, stdout: "2.1.289 (Claude Code)", stderr: "" }
      return {
        code: 0,
        stdout: JSON.stringify({
          loggedIn: true,
          authMethod: "claude.ai",
          subscriptionType: "max",
          email: "me@example.com",
        }),
        stderr: "",
      }
    },
    async homeFileExists() {
      return false
    },
    async hasEnv() {
      return false
    },
    async prepareWorkspace(session) {
      return `/home/me/.kimo/cli-workspaces/${session}`
    },
    async spawn(spec): Promise<CliProcess> {
      const out = new Set<(c: string) => void>()
      const rec = { args: spec.args, cwd: spec.cwd, stdin: "" }
      spawned.push(rec)
      let resolveExit: (v: { code: number | null; signal: string | null }) => void = () => {}
      const exited = new Promise<{ code: number | null; signal: string | null }>((r) => {
        resolveExit = r
      })
      return {
        pid: 4242,
        async write(d) {
          rec.stdin += d
        },
        async closeStdin() {
          let prompt = ""
          try {
            prompt =
              JSON.parse(rec.stdin.trim().split("\n")[0] ?? "{}")?.message?.content?.[0]?.text ?? ""
          } catch {}
          setTimeout(() => {
            for (const l of lines(prompt)) for (const f of out) f(`${l}\n`)
            resolveExit({ code: 0, signal: null })
          }, 5)
        },
        async kill() {
          resolveExit({ code: null, signal: "SIGINT" })
        },
        onStdout(l) {
          out.add(l)
          return () => out.delete(l)
        },
        onStderr() {
          return () => {}
        },
        exited,
      }
    },
  }
}

/** Deterministic random (session ids, backoff jitter). */
export function seeded(seed: number): () => number {
  let x = seed >>> 0 || 1
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 2 ** 32
  }
}

/** A runtime with mocked providers (tests / e2e harness). */
export function createTestRuntime(o: {
  tools: ToolHostFactory
  script: Script
  providers?: ProviderConfig[]
  clis?: CliDetection[]
  cliHost?: CliProcessHost | null
  defaultSelection?: ModelSelection | null
  platform?: "desktop" | "web"
  usage?: AgentPanelRuntime["usage"]
  now?: () => number
}): AgentPanelRuntime & { providersMade: ReturnType<typeof createMockProvider>[] } {
  const providers = o.providers ?? [MOCK_ANTHROPIC]
  const made: ReturnType<typeof createMockProvider>[] = []
  return {
    providersMade: made,
    platform: o.platform ?? "web",
    providers: async () => providers,
    unavailable: () => [{ id: "gemini", label: "Google Gemini", tag: "no key" }],
    clis: () => o.clis ?? [],
    defaultSelection: () =>
      o.defaultSelection === undefined
        ? {
            provider: providers[0]?.id ?? "anthropic",
            model: providers[0]?.models.agent ?? "claude-opus-5-5",
          }
        : o.defaultSelection,
    labelOf: (p) =>
      p.startsWith("cli:")
        ? (o.clis?.find((c) => `cli:${c.id}` === p)?.label ?? p)
        : (providers.find((x) => x.id === p)?.label ?? p),
    createProvider: (config) => {
      const p = createMockProvider(config, o.script)
      made.push(p)
      return p
    },
    cliHost: o.cliHost ?? null,
    tools: o.tools,
    sessions: createMemorySessionStore(),
    ...(o.usage ? { usage: o.usage } : {}),
    online: () => true,
    random: seeded(7),
    ...(o.now ? { now: o.now } : {}),
  }
}
