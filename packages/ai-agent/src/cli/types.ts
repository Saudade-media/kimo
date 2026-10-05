/**
 * Local agent CLIs as a provider family (ADR 0014 §11): the user's installed Claude Code,
 * Codex or Gemini CLI runs the turn with their existing subscription/login, and edits the open
 * document only through Kimo's MCP server (the M5 tool registry with per-op policy, approvals,
 * activity and presence). Desktop only: the process is spawned by the Rust shell through
 * `@kimo/platform`'s `CliAgentsApi` (or by Node in tests and the `kimo` CLI).
 */
import type { AgentEvent } from "../loop"
import type { ThinkingMode, Usage } from "../types"

export const CLI_AGENT_IDS = ["claude-code", "codex", "gemini-cli"] as const
export type KnownCliId = (typeof CLI_AGENT_IDS)[number]

/** Provider id prefix in a ModelSelection: `{provider: "cli:claude-code", model: "default"}`. */
export const CLI_PROVIDER_PREFIX = "cli:"

export const cliProviderId = (cli: string): string => `${CLI_PROVIDER_PREFIX}${cli}`
export const isCliProvider = (provider: string): boolean => provider.startsWith(CLI_PROVIDER_PREFIX)
export const cliIdOf = (provider: string): string => provider.slice(CLI_PROVIDER_PREFIX.length)

/**
 * How usage is billed. `subscription`: shown as tokens/turns labelled "subscription", never
 * dollars. `cli-api-key`: the CLI bills an API key (its reported cost is shown as reported).
 */
export type CliBilling = "subscription" | "cli-api-key" | "local"

export interface CliDetection {
  id: string
  label: string
  installed: boolean
  /** Resolved executable path (the only path the shell will spawn for this CLI). */
  path?: string
  version?: string
  /** null = could not be determined without prompting. */
  signedIn: boolean | null
  account?: string
  authMethod?: string
  billing: CliBilling | null
  /** e.g. "max" for Claude subscriptions. */
  plan?: string
  error?: string
}

/** Primitive process services (desktop: Tauri commands; node: child_process). */
export interface CliProcessHost {
  /** Resolves `command` on PATH, then in `extraDirs` (`~` expanded by the host). */
  which(command: string, extraDirs: readonly string[]): Promise<string | null>
  /** Short probe (version / auth status). Never interactive: stdin is closed. */
  exec(
    path: string,
    args: readonly string[],
    opts?: { timeoutMs?: number; env?: Record<string, string> },
  ): Promise<{ code: number | null; stdout: string; stderr: string }>
  /** Existence of a file under the home directory (auth-file probes). */
  homeFileExists(relPath: string): Promise<boolean>
  /** Env var presence (never the value). */
  hasEnv(name: string): Promise<boolean>
  /** Creates/updates `~/.kimo/cli-workspaces/<session>/` with files; returns its absolute path. */
  prepareWorkspace(
    session: string,
    files: readonly { path: string; text: string }[],
  ): Promise<string>
  spawn(spec: CliSpawnSpec): Promise<CliProcess>
}

export interface CliSpawnSpec {
  path: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}

export interface CliProcess {
  pid: number
  write(data: string): Promise<void>
  closeStdin(): Promise<void>
  kill(signal?: "SIGINT" | "SIGTERM" | "SIGKILL"): Promise<void>
  onStdout(listener: (chunk: string) => void): () => void
  onStderr(listener: (chunk: string) => void): () => void
  exited: Promise<{ code: number | null; signal: string | null }>
}

/** How the CLI reaches Kimo's MCP server (ADR 0013 §7/§8). */
export interface KimoMcpLaunch {
  /** Bundled shim (`…/kimo-mcp`) or `kimo`. */
  command: string
  /** Shim: `["--client", <id>]`; kimo: `["mcp", "--attach", "--client", <id>]`. */
  args: string[]
}

export interface CliTurnInput {
  /** Kimo agent session id; also names the workspace dir the CLI (and the shim) run in. */
  session: string
  /** The CLI's own session/thread id from an earlier turn (resume). */
  cliSessionId?: string
  /** "default" = the CLI's configured model. */
  model: string
  thinking: ThinkingMode
  prompt: string
  images?: { mimeType: string; data: string }[]
  /**
   * Kimo's stable instructions + skills. They replace the CLI's own system prompt where the CLI
   * allows it (Claude Code `--system-prompt`, Codex `model_instructions_file`, Gemini CLI
   * `GEMINI_SYSTEM_MD`), so a turn carries no coding-agent prompt (board 31 token pass).
   */
  systemPrompt: string
  /**
   * This turn's volatile context (document, selection, page outline, scope): sent at the top of
   * the user message, never in the system prompt, because CLIs record the system prompt once per
   * session (Claude Code `--system-prompt-snapshot`) and a resumed turn would see stale context.
   */
  context?: string
  mcp: KimoMcpLaunch
  workspace: string
}

/** The user message text of a turn: the volatile context first, then the request. */
export function promptWithContext(i: Pick<CliTurnInput, "prompt" | "context">): string {
  return i.context ? `<kimo-context>\n${i.context}\n</kimo-context>\n\n${i.prompt}` : i.prompt
}

export interface CliInvocation {
  args: string[]
  env?: Record<string, string>
  /** Written to stdin, then stdin is closed. */
  stdin?: string
  /** Files placed in the workspace before spawning (e.g. `.gemini/settings.json`). */
  workspaceFiles?: { path: string; text: string }[]
}

/** Normalized CLI stream events. */
export type CliEvent =
  | { type: "session"; id: string; model?: string; mcpConnected?: boolean }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  /** A whole assistant text block (CLIs without partial streaming). */
  | { type: "text"; text: string }
  /**
   * A tool call's input as the model writes it (Claude Code `input_json_delta`, ADR 0013 §4.7):
   * the first fragment opens the stream (`tool` is the Kimo tool name).
   */
  | { type: "tool_input_delta"; callId: string; tool: string; partialJson: string }
  | { type: "step_start"; callId: string; tool: string; input: Record<string, unknown> }
  | { type: "step_end"; callId: string; tool: string; ok: boolean; output: string }
  | { type: "usage"; usage: Usage }
  | {
      type: "result"
      ok: boolean
      message?: string
      sessionId?: string
      usage?: Usage
      costUsd?: number
      turns?: number
    }
  | { type: "error"; message: string }

export interface CliStreamParser {
  /** One output line → zero or more events. Unknown lines are ignored. */
  push(line: string): CliEvent[]
}

export interface CliProbeSpec {
  versionArgs: string[]
  /** Parses the version line ("2.1.289 (Claude Code)" → "2.1.289"). */
  parseVersion(stdout: string): string | undefined
  /** Non-interactive auth status command, if the CLI has one. */
  authArgs?: string[]
  parseAuth?(r: {
    code: number | null
    stdout: string
    stderr: string
  }): Pick<CliDetection, "signedIn" | "account" | "authMethod" | "billing" | "plan">
  /** Fallback: files under $HOME whose presence means signed in (OAuth caches). */
  authFiles?: { path: string; billing: CliBilling; method: string }[]
  /** Env vars that mean an API key is configured. */
  authEnv?: string[]
}

export interface CliAgentDef {
  id: string
  label: string
  /** Executable name on PATH. */
  command: string
  /** Common install dirs probed after PATH. */
  searchPaths: string[]
  probe: CliProbeSpec
  /** Model choices for the picker ("default" first). Other ids pass through to the CLI. */
  models: { id: string; label: string }[]
  /** Docs URL the flags were verified against. */
  docs: string
}

export interface CliAdapter {
  def: CliAgentDef
  invocation(input: CliTurnInput): CliInvocation
  parser(): CliStreamParser
}

/** Strips the CLI's MCP prefix: `mcp__kimo__kimo_apply_ops` / `kimo__kimo_query` → `kimo_*`. */
export function kimoToolName(tool: string): string {
  return tool.replace(/^mcp__kimo__/, "").replace(/^kimo__/, "")
}

export type { AgentEvent }
