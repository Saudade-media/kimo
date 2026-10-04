/**
 * Settings › Agents & MCP (board 21, rule "Placement"): the agents module's `AgentsMcpPane` over
 * `platform.mcp`, with the server lifecycle controls built from `McpHostApi.server` (start /
 * stop / restart, start on launch, HTTP port + "is free", the HTTP bearer, the server log, the
 * last start error). Without an MCP host (the browser) the pane explains where agents connect.
 */
import type { KimoPlatform, McpServerStatus } from "@kimo/platform"
import { EmptyState } from "@kimo/ui"
import { Bot } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AgentsMcpPane, type AgentsServerControls } from "../agents"

/** The generic HTTP bearer shown in the server card (per-host bearers live in host configs). */
export const HTTP_TOKEN_CLIENT = "http"

export function AgentsPane({
  platform,
  expandedClient,
  onOpenActivity,
}: {
  platform: KimoPlatform
  expandedClient?: string | null
  onOpenActivity?: () => void
}) {
  const host = platform.mcp ?? null
  const [status, setStatus] = useState<McpServerStatus | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [log, setLog] = useState<{ path: string; lastError?: string } | null>(null)
  const refreshLog = useCallback(() => {
    if (host) void host.server.log().then(setLog, () => {})
  }, [host])
  useEffect(() => {
    if (!host) return
    let live = true
    void host.status().then(
      (s) => live && setStatus(s),
      () => {},
    )
    void host.server.token(HTTP_TOKEN_CLIENT).then(
      (t) => live && setToken(t),
      () => {},
    )
    refreshLog()
    const off = host.onStatus((s) => {
      setStatus(s)
      refreshLog()
    })
    return () => {
      live = false
      off()
    }
  }, [host, refreshLog])

  const server = useMemo((): AgentsServerControls | undefined => {
    if (!host) return undefined
    const run = (p: Promise<McpServerStatus>) =>
      void p.then(setStatus, (e: unknown) => console.warn("Kimo: MCP server", e))
    const port = status?.httpPort ?? status?.http.port
    return {
      ...(status?.version ? { version: `kimo-mcp ${status.version}` } : {}),
      start: () => run(host.server.start()),
      stop: () => run(host.server.stop()),
      restart: () => run(host.server.restart()),
      startOnLaunch: {
        value: status?.startOnLaunch ?? true,
        set: (v) => void host.server.setStartOnLaunch(v).catch(() => {}),
      },
      ...(port
        ? {
            port: {
              value: port,
              set: async (p: number) => {
                await host.server.setPort(p)
              },
              isFree: (p: number) => host.server.isPortFree(p),
            },
          }
        : {}),
      ...(status?.http.enabled
        ? {
            token: {
              value: token ?? "",
              regenerate: async () => {
                const t = await host.http.rotateToken(HTTP_TOKEN_CLIENT)
                setToken(t)
                return t
              },
            },
          }
        : {}),
      error: status?.error
        ? {
            code: status.error.code,
            message: status.error.message,
            ...(status.error.port ? { port: status.error.port } : {}),
            ...(status.error.suggestedPort ? { suggestedPort: status.error.suggestedPort } : {}),
          }
        : null,
      ...(log
        ? {
            log: {
              path: log.path,
              ...(log.lastError ? { lastError: log.lastError } : {}),
              reveal: () => void host.server.revealLog().catch(() => {}),
            },
          }
        : {}),
    }
  }, [host, status, token, log])

  if (!host)
    return (
      <div className="settings-agents-empty">
        <EmptyState
          icon={<Bot size={18} aria-hidden="true" />}
          title="Agents connect to the desktop app"
          description="Run Kimo on your computer, or use `kimo mcp` from a terminal, to let Claude Code, Codex or Gemini CLI edit your files."
        />
      </div>
    )
  return (
    <AgentsMcpPane
      host={host}
      {...(server ? { server } : {})}
      home={status?.home ?? null}
      machine={platform.os === "macos" ? "this Mac" : "this computer"}
      expandedClient={expandedClient ?? null}
      {...(onOpenActivity ? { onOpenActivity } : {})}
    />
  )
}
