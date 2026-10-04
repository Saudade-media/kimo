/**
 * Agents UI test helpers. The scripted `McpHostApi` is the memory platform's
 * (`createMemoryMcpHost` in `@kimo/platform`); the names below are kept for the tests and the
 * e2e harness.
 */
import {
  createMemoryMcpHost,
  type McpConnectionInfo,
  type McpHostConfigStatus,
  type McpHostId,
  type MemoryMcpHost,
  SAMPLE_MCP_STATUS,
} from "@kimo/platform"

export type ScriptedMcpHost = MemoryMcpHost
export const createScriptedMcpHost = createMemoryMcpHost
export const SAMPLE_STATUS = SAMPLE_MCP_STATUS

/** A connection fixture (board 21 "Claude Code 2.1.4 · stdio"). */
export function sampleConnection(
  over: Partial<McpConnectionInfo> & { client?: string; label?: string; session?: string } = {},
): McpConnectionInfo {
  const client = over.client ?? "claude-code"
  const session = over.session ?? "k3x9qa"
  const { client: _c, label: _l, session: _s, ...rest } = over
  return {
    connectionId: `conn-${client}-${session}`,
    identity: {
      client,
      label: over.label ?? "Claude Code",
      version: "2.1.4",
      session,
      transport: "socket",
      pid: 48113,
    },
    origin: `mcp:${client}.${session}`,
    cwd: "/Users/me/repo/design",
    connectedAt: new Date(2026, 9, 4, 10, 42).getTime(),
    lastActivityAt: Date.now(),
    state: "editing",
    docs: ["doc-1", "doc-2"],
    ...rest,
  }
}

/** The five installer rows of board 21 (Claude Code installed, Codex outdated, …). */
export function sampleHosts(home = "/Users/me"): McpHostConfigStatus[] {
  const row = (
    host: McpHostId,
    label: string,
    icon: "terminal" | "editor",
    path: string,
    s: Pick<McpHostConfigStatus, "configExists" | "installed" | "current">,
  ): McpHostConfigStatus => ({ host, label, icon, scope: "user", path: `${home}/${path}`, ...s })
  return [
    row("claude-code", "Claude Code", "terminal", ".claude.json", {
      configExists: true,
      installed: true,
      current: true,
    }),
    row("codex", "Codex", "terminal", ".codex/config.toml", {
      configExists: true,
      installed: true,
      current: false,
    }),
    row("gemini-cli", "Gemini CLI", "terminal", ".gemini/settings.json", {
      configExists: true,
      installed: false,
      current: false,
    }),
    row("cursor", "Cursor", "editor", ".cursor/mcp.json", {
      configExists: true,
      installed: true,
      current: true,
    }),
    row("vscode", "VS Code", "editor", "Library/Application Support/Code/User/mcp.json", {
      configExists: false,
      installed: false,
      current: false,
    }),
  ]
}
