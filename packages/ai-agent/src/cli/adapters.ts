/**
 * The three built-in CLI adapters plus a generic one (ADR 0014 §11). Flags were checked against
 * the installed CLIs' `--help` on 2026-10-04 (Claude Code 2.1.289, codex-cli 0.146.0); Gemini CLI
 * flags follow its docs (google-gemini/gemini-cli `docs/cli/headless.md`) and are marked for
 * re-verification in the ADR's open questions.
 */
import type { Usage } from "../types"
import {
  type CliAdapter,
  type CliAgentDef,
  type CliEvent,
  type CliStreamParser,
  type CliTurnInput,
  kimoToolName,
} from "./types"

const HOME_BINS = [
  "~/.local/bin",
  "~/.npm-global/bin",
  "~/.bun/bin",
  "~/.volta/bin",
  "/opt/homebrew/bin",
  "/usr/local/bin",
]

const usage = (u: Record<string, unknown> | undefined): Usage => ({
  inputTokens: Number(u?.input_tokens ?? 0),
  outputTokens: Number(u?.output_tokens ?? 0),
  cacheReadTokens: Number(u?.cache_read_input_tokens ?? u?.cached_input_tokens ?? 0),
  cacheWriteTokens: Number(u?.cache_creation_input_tokens ?? 0),
})

const parseJson = (line: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(line)
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content
  if (Array.isArray(content))
    return content
      .map((c) =>
        c && typeof c === "object" && (c as { type?: string }).type === "text"
          ? String((c as { text?: unknown }).text ?? "")
          : "",
      )
      .join("\n")
  return ""
}

// --- Claude Code ---------------------------------------------------------------------------------

export const CLAUDE_CODE: CliAgentDef = {
  id: "claude-code",
  label: "Claude Code",
  command: "claude",
  searchPaths: ["~/.claude/local", ...HOME_BINS],
  probe: {
    versionArgs: ["--version"],
    parseVersion: (s) => /(\d+\.\d+\.\d+)/.exec(s)?.[1],
    authArgs: ["auth", "status", "--json"],
    parseAuth: (r) => {
      const j = parseJson(r.stdout.trim())
      if (!j) return { signedIn: r.code === 0 ? null : false, billing: null }
      const method = typeof j.authMethod === "string" ? j.authMethod : undefined
      return {
        signedIn: j.loggedIn === true,
        ...(typeof j.email === "string" ? { account: j.email } : {}),
        ...(method ? { authMethod: method } : {}),
        billing:
          j.loggedIn !== true ? null : method === "claude.ai" ? "subscription" : "cli-api-key",
        ...(typeof j.subscriptionType === "string" ? { plan: j.subscriptionType } : {}),
      }
    },
  },
  models: [
    { id: "default", label: "Claude Code default" },
    { id: "opus", label: "Opus (latest)" },
    { id: "sonnet", label: "Sonnet (latest)" },
    { id: "haiku", label: "Haiku (latest)" },
  ],
  docs: "https://code.claude.com/docs/en/cli-reference",
}

/**
 * `claude -p` with stream-json in and out. Built-in tools are disabled (`--tools ""`), only the
 * Kimo MCP server is loaded (`--strict-mcp-config`) and allowed (`--allowedTools mcp__kimo`),
 * and anything else is denied without prompting (`--permission-mode dontAsk`), so it cannot
 * write the .kimo file directly; Kimo's own approvals apply inside the MCP server.
 */
export function claudeInvocation(i: CliTurnInput) {
  const mcp = { mcpServers: { kimo: { type: "stdio", command: i.mcp.command, args: i.mcp.args } } }
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--mcp-config",
    JSON.stringify(mcp),
    "--strict-mcp-config",
    "--tools",
    "",
    "--allowedTools",
    "mcp__kimo",
    "--permission-mode",
    "dontAsk",
    "--append-system-prompt",
    i.systemPrompt,
  ]
  if (i.model !== "default") args.push("--model", i.model)
  if (i.thinking !== "auto") args.push("--effort", i.thinking === "off" ? "low" : "max")
  if (i.cliSessionId) args.push("--resume", i.cliSessionId)
  const content: unknown[] = [
    ...(i.images ?? []).map((im) => ({
      type: "image",
      source: { type: "base64", media_type: im.mimeType, data: im.data },
    })),
    { type: "text", text: i.prompt },
  ]
  const stdin = `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`
  return { args, stdin }
}

export function claudeParser(): CliStreamParser {
  const started = new Set<string>()
  const blockTool = new Map<number, { id: string; name: string }>()
  let sawPartialText = false
  return {
    push(line) {
      const j = parseJson(line)
      if (!j) return []
      const out: CliEvent[] = []
      switch (j.type) {
        case "system":
          if (j.subtype === "init") {
            const servers = Array.isArray(j.mcp_servers)
              ? (j.mcp_servers as { name?: string; status?: string }[])
              : []
            const kimo = servers.find((s) => s.name === "kimo")
            out.push({
              type: "session",
              id: String(j.session_id ?? ""),
              ...(typeof j.model === "string" ? { model: j.model } : {}),
              ...(kimo ? { mcpConnected: kimo.status === "connected" } : {}),
            })
          }
          break
        case "stream_event": {
          if (j.parent_tool_use_id) break
          const ev = j.event as Record<string, unknown> | undefined
          if (!ev) break
          if (ev.type === "content_block_start") {
            const b = ev.content_block as { type?: string; id?: string; name?: string } | undefined
            if (b?.type === "tool_use" && b.id)
              blockTool.set(Number(ev.index), { id: b.id, name: b.name ?? "" })
          } else if (ev.type === "content_block_delta") {
            const d = ev.delta as { type?: string; text?: string; thinking?: string } | undefined
            if (d?.type === "text_delta" && d.text) {
              sawPartialText = true
              out.push({ type: "text_delta", text: d.text })
            } else if (d?.type === "thinking_delta" && d.thinking)
              out.push({ type: "thinking_delta", text: d.thinking })
          } else if (ev.type === "message_delta" && ev.usage) {
            out.push({ type: "usage", usage: usage(ev.usage as Record<string, unknown>) })
          }
          break
        }
        case "assistant": {
          if (j.parent_tool_use_id) break
          const msg = j.message as { content?: unknown[] } | undefined
          for (const b of (msg?.content ?? []) as {
            type?: string
            id?: string
            name?: string
            input?: unknown
            text?: string
          }[]) {
            if (b.type === "tool_use" && b.id && !started.has(b.id)) {
              started.add(b.id)
              out.push({
                type: "step_start",
                callId: b.id,
                tool: kimoToolName(b.name ?? ""),
                input: (b.input ?? {}) as Record<string, unknown>,
              })
            } else if (b.type === "text" && b.text && !sawPartialText)
              out.push({ type: "text", text: b.text })
          }
          sawPartialText = false
          break
        }
        case "user": {
          const msg = j.message as { content?: unknown } | undefined
          if (!Array.isArray(msg?.content)) break
          for (const b of msg.content as {
            type?: string
            tool_use_id?: string
            content?: unknown
            is_error?: boolean
          }[]) {
            if (b.type !== "tool_result" || !b.tool_use_id) continue
            const name = [...blockTool.values()].find((t) => t.id === b.tool_use_id)?.name ?? ""
            out.push({
              type: "step_end",
              callId: b.tool_use_id,
              tool: kimoToolName(name),
              ok: b.is_error !== true,
              output: textOf(b.content),
            })
          }
          break
        }
        case "result":
          out.push({
            type: "result",
            ok: j.is_error !== true && j.subtype === "success",
            ...(typeof j.result === "string" ? { message: j.result } : {}),
            ...(typeof j.session_id === "string" ? { sessionId: j.session_id } : {}),
            ...(j.usage ? { usage: usage(j.usage as Record<string, unknown>) } : {}),
            ...(typeof j.total_cost_usd === "number" ? { costUsd: j.total_cost_usd } : {}),
            ...(typeof j.num_turns === "number" ? { turns: j.num_turns } : {}),
          })
          break
      }
      return out
    },
  }
}

export const claudeCodeAdapter: CliAdapter = {
  def: CLAUDE_CODE,
  invocation: claudeInvocation,
  parser: claudeParser,
}

// --- Codex ---------------------------------------------------------------------------------------

export const CODEX: CliAgentDef = {
  id: "codex",
  label: "Codex",
  command: "codex",
  searchPaths: HOME_BINS,
  probe: {
    versionArgs: ["--version"],
    parseVersion: (s) => /(\d+\.\d+\.\d+)/.exec(s)?.[1],
    authArgs: ["login", "status"],
    parseAuth: (r) => {
      const text = `${r.stdout}\n${r.stderr}`
      if (/not logged in/i.test(text) || (r.code !== 0 && !/logged in/i.test(text)))
        return { signedIn: false, billing: null }
      if (/chatgpt/i.test(text))
        return { signedIn: true, authMethod: "chatgpt", billing: "subscription" }
      if (/api key/i.test(text))
        return { signedIn: true, authMethod: "api-key", billing: "cli-api-key" }
      return { signedIn: /logged in/i.test(text) ? true : null, billing: null }
    },
  },
  models: [{ id: "default", label: "Codex default" }],
  docs: "https://developers.openai.com/codex/cli/reference",
}

/** TOML string literal for `-c key=value` overrides. */
const toml = (s: string) => JSON.stringify(s)

/**
 * `codex exec --json` (resume: `codex exec resume <thread> --json`). Kimo's MCP server via
 * `-c mcp_servers.kimo.*` (tools approved on Codex's side: `default_tools_approval_mode`); the
 * shell sandbox is read-only so it cannot write files.
 */
export function codexInvocation(i: CliTurnInput) {
  const args = ["exec"]
  if (i.cliSessionId) args.push("resume", i.cliSessionId)
  args.push(
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--cd",
    i.workspace,
    "-c",
    `mcp_servers.kimo.command=${toml(i.mcp.command)}`,
    "-c",
    `mcp_servers.kimo.args=[${i.mcp.args.map(toml).join(",")}]`,
    // `codex exec` cannot answer Codex's own MCP approval prompt, and under its default `auto`
    // mode (with the read-only sandbox) every non-read-only Kimo tool would ask and fail. Kimo's
    // policy, scopes and approvals (ADR 0013 §6) guard the edits instead.
    "-c",
    'mcp_servers.kimo.default_tools_approval_mode="approve"',
  )
  if (i.model !== "default") args.push("--model", i.model)
  args.push(
    "-c",
    `model_reasoning_effort=${toml(i.thinking === "off" ? "low" : i.thinking === "max" ? "high" : "medium")}`,
  )
  args.push("-")
  const prompt = i.cliSessionId ? i.prompt : `${i.systemPrompt}\n\n---\n\n${i.prompt}`
  return { args, stdin: prompt }
}

export function codexParser(): CliStreamParser {
  return {
    push(line) {
      const j = parseJson(line)
      if (!j) return []
      const item = j.item as Record<string, unknown> | undefined
      switch (j.type) {
        case "thread.started":
          return [{ type: "session", id: String(j.thread_id ?? "") }]
        case "item.started":
          if (item?.type === "mcp_tool_call")
            return [
              {
                type: "step_start",
                callId: String(item.id),
                tool: kimoToolName(String(item.tool ?? "")),
                input: argsOf(item.arguments),
              },
            ]
          if (item?.type === "command_execution")
            return [
              {
                type: "step_start",
                callId: String(item.id),
                tool: "shell",
                input: { command: item.command },
              },
            ]
          return []
        case "item.completed":
          if (item?.type === "agent_message")
            return [{ type: "text", text: String(item.text ?? "") }]
          if (item?.type === "reasoning")
            return [{ type: "thinking_delta", text: String(item.text ?? "") }]
          if (item?.type === "mcp_tool_call") {
            const result = item.result as { content?: unknown } | undefined
            const err = item.error as { message?: string } | null | undefined
            return [
              {
                type: "step_end",
                callId: String(item.id),
                tool: kimoToolName(String(item.tool ?? "")),
                ok: !err && item.status !== "failed",
                output: err?.message ?? textOf(result?.content),
              },
            ]
          }
          if (item?.type === "command_execution")
            return [
              {
                type: "step_end",
                callId: String(item.id),
                tool: "shell",
                ok: item.status === "completed",
                output: String(item.aggregated_output ?? ""),
              },
            ]
          return []
        case "turn.completed":
          return [{ type: "result", ok: true, usage: usage(j.usage as Record<string, unknown>) }]
        case "turn.failed":
          return [
            {
              type: "result",
              ok: false,
              message: String((j.error as { message?: string })?.message ?? "Turn failed"),
            },
          ]
        case "error":
          return [{ type: "error", message: String(j.message ?? "Codex error") }]
        default:
          return []
      }
    },
  }
}

function argsOf(a: unknown): Record<string, unknown> {
  if (a && typeof a === "object") return a as Record<string, unknown>
  if (typeof a === "string")
    try {
      return JSON.parse(a) as Record<string, unknown>
    } catch {
      return {}
    }
  return {}
}

export const codexAdapter: CliAdapter = {
  def: CODEX,
  invocation: codexInvocation,
  parser: codexParser,
}

// --- Gemini CLI ----------------------------------------------------------------------------------

export const GEMINI_CLI: CliAgentDef = {
  id: "gemini-cli",
  label: "Gemini CLI",
  command: "gemini",
  searchPaths: HOME_BINS,
  probe: {
    versionArgs: ["--version"],
    parseVersion: (s) => /(\d+\.\d+\.\d+)/.exec(s)?.[1],
    authFiles: [
      { path: ".gemini/oauth_creds.json", billing: "subscription", method: "google-login" },
    ],
    authEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  },
  models: [
    { id: "default", label: "Gemini CLI default" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  docs: "https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md",
}

/**
 * `gemini --output-format stream-json` in the session workspace. The workspace
 * `.gemini/settings.json` adds the Kimo MCP server (trusted: Kimo's own approvals apply) and
 * excludes the built-in file-writing and shell tools.
 */
export function geminiInvocation(i: CliTurnInput) {
  const settings = {
    mcpServers: { kimo: { command: i.mcp.command, args: i.mcp.args, trust: true } },
    tools: { exclude: ["write_file", "replace", "run_shell_command", "web_fetch"] },
  }
  const args = ["--output-format", "stream-json", "--allowed-mcp-server-names", "kimo"]
  if (i.model !== "default") args.push("--model", i.model)
  if (i.cliSessionId) args.push("--resume", i.cliSessionId)
  args.push("--prompt", i.cliSessionId ? i.prompt : `${i.systemPrompt}\n\n---\n\n${i.prompt}`)
  return {
    args,
    workspaceFiles: [
      { path: ".gemini/settings.json", text: `${JSON.stringify(settings, null, 2)}\n` },
    ],
  }
}

export function geminiParser(): CliStreamParser {
  return {
    push(line) {
      const j = parseJson(line)
      if (!j) return []
      switch (j.type) {
        case "init":
          return [
            {
              type: "session",
              id: String(j.session_id ?? ""),
              ...(typeof j.model === "string" ? { model: j.model } : {}),
            },
          ]
        case "message":
          if (j.role !== "assistant") return []
          return j.delta === true
            ? [{ type: "text_delta", text: String(j.content ?? "") }]
            : [{ type: "text", text: String(j.content ?? "") }]
        case "tool_use":
          return [
            {
              type: "step_start",
              callId: String(j.tool_id),
              tool: kimoToolName(String(j.tool_name ?? "")),
              input: (j.parameters ?? {}) as Record<string, unknown>,
            },
          ]
        case "tool_result":
          return [
            {
              type: "step_end",
              callId: String(j.tool_id),
              tool: "",
              ok: j.status === "success",
              output:
                typeof j.output === "string"
                  ? j.output
                  : String((j.error as { message?: string })?.message ?? ""),
            },
          ]
        case "error":
          return [{ type: "error", message: String(j.message ?? "Gemini CLI error") }]
        case "result": {
          const s = (j.stats ?? {}) as Record<string, unknown>
          return [
            {
              type: "result",
              ok: j.status === "success",
              usage: {
                inputTokens: Number(s.input_tokens ?? 0),
                outputTokens: Number(s.output_tokens ?? 0),
                cacheReadTokens: Number(s.cached ?? 0),
                cacheWriteTokens: 0,
              },
            },
          ]
        }
        default:
          return []
      }
    },
  }
}

export const geminiCliAdapter: CliAdapter = {
  def: GEMINI_CLI,
  invocation: geminiInvocation,
  parser: geminiParser,
}

// --- Generic -------------------------------------------------------------------------------------

/** Settings › AI providers › "Add CLI agent": any CLI speaking one of the known stream formats. */
export interface GenericCliConfig {
  id: string
  label: string
  command: string
  /**
   * Args template. Placeholders: `{prompt}`, `{model}`, `{system}`, `{mcpConfigJson}`,
   * `{mcpCommand}`, `{workspace}`, `{resume}` (an arg containing `{resume}` or `{model}` is
   * dropped when the value is empty / "default").
   */
  args: string[]
  /** Send the prompt on stdin instead of `{prompt}`. */
  stdinPrompt?: boolean
  output: "claude-stream-json" | "codex-jsonl" | "gemini-stream-json"
  versionArgs?: string[]
}

export function genericAdapter(c: GenericCliConfig): CliAdapter {
  const def: CliAgentDef = {
    id: c.id,
    label: c.label,
    command: c.command,
    searchPaths: HOME_BINS,
    probe: {
      versionArgs: c.versionArgs ?? ["--version"],
      parseVersion: (s) => /(\d+\.\d+\.\d+)/.exec(s)?.[1],
    },
    models: [{ id: "default", label: `${c.label} default` }],
    docs: "",
  }
  return {
    def,
    invocation(i) {
      const mcpConfigJson = JSON.stringify({
        mcpServers: { kimo: { command: i.mcp.command, args: i.mcp.args } },
      })
      const vals: Record<string, string> = {
        prompt: i.prompt,
        model: i.model === "default" ? "" : i.model,
        system: i.systemPrompt,
        mcpConfigJson,
        mcpCommand: [i.mcp.command, ...i.mcp.args].join(" "),
        workspace: i.workspace,
        resume: i.cliSessionId ?? "",
      }
      const args: string[] = []
      for (const a of c.args) {
        if ((a.includes("{resume}") && !vals.resume) || (a.includes("{model}") && !vals.model)) {
          // Also drop a preceding flag ("--model {model}" written as two args).
          if (args.length && args[args.length - 1]?.startsWith("-")) args.pop()
          continue
        }
        args.push(a.replace(/\{(\w+)\}/g, (_, k: string) => vals[k] ?? ""))
      }
      return c.stdinPrompt ? { args, stdin: i.prompt } : { args }
    },
    parser: () =>
      c.output === "codex-jsonl"
        ? codexParser()
        : c.output === "gemini-stream-json"
          ? geminiParser()
          : claudeParser(),
  }
}

export const BUILTIN_CLI_ADAPTERS: readonly CliAdapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  geminiCliAdapter,
]
