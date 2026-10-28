/**
 * Agents UI test helpers. The scripted `McpHostApi` is the memory platform's
 * (`createMemoryMcpHost` in `@kimo/platform`); the names below are kept for the tests.
 */
import { createMemoryMcpHost, type McpConnectionInfo } from "@kimo/platform"

export const createScriptedMcpHost = createMemoryMcpHost

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
