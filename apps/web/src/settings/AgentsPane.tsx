/**
 * Settings › Agents & MCP (board 21, rule "Placement"): the agents module's `AgentsMcpPane` over
 * `platform.mcp`, with the server lifecycle controls built from `McpHostApi.server` (start /
 * stop / restart, start on launch, HTTP port + "is free", the HTTP bearer, the server log, the
 * last start error). Without an MCP host (the browser) the pane explains where agents connect.
 */
import type { KimoPlatform, McpServerStatus } from "@kimo/platform"
import { EmptyState } from "@kimo/ui"
import { Bot } from "lucide-react"
import { useCallback, useContext, useEffect, useMemo, useState } from "react"
import { AgentsMcpPane, type AgentsServerControls } from "../agents"
import { SettingsBannerContext, SettingsFailContext } from "./panes"

/** The generic HTTP bearer shown in the server card (per-host bearers live in host configs). */
export const HTTP_TOKEN_CLIENT = "http"

/** `~/.kimo/mcp/server.log` → `~/.kimo/activity`. */
function activityDirOf(serverLog: string): string | null {
  const sep = serverLog.includes("\\") && !serverLog.includes("/") ? "\\" : "/"
  const parts = serverLog.split(sep)
  if (parts.length < 3) return null
  return [...parts.slice(0, -2), "activity"].join(sep)
}

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
  const fail = useContext(SettingsFailContext)
  const banner = useContext(SettingsBannerContext)
  const [status, setStatus] = useState<McpServerStatus | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [log, setLog] = useState<{ path: string; lastError?: string } | null>(null)
  const refreshLog = useCallback(() => {
    if (host) void host.server.log().then(setLog, () => {})
  }, [host])
  /** Re-reads the real server state after a failed action (the controls show what is true). */
  const refreshStatus = useCallback(() => {
    if (host) void host.status().then(setStatus, () => {})
  }, [host])
  useEffect(() => {
    if (!host) return
    let live = true
    void host.status().then(
      (s) => live && setStatus(s),
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
  // The HTTP bearer is minted when HTTP turns on: read it on that edge, and again on every status
  // update while it reads as missing (D9: a read that raced the mint shows "No token").
  const httpOn = status?.http.enabled ?? false
  const retryKey = token === null ? status : null
  useEffect(() => {
    if (!host || !httpOn) return
    void retryKey
    let live = true
    void host.server.token(HTTP_TOKEN_CLIENT).then(
      (t) => live && setToken(t),
      (e: unknown) => live && fail("read the HTTP token", e),
    )
    return () => {
      live = false
    }
  }, [host, httpOn, retryKey, fail])

  const server = useMemo((): AgentsServerControls | undefined => {
    if (!host) return undefined
    // Audit A5: every server action reports "Couldn't …" in the pane banner, then re-reads.
    const run = (what: string, action: () => Promise<McpServerStatus>) => {
      const go = (): Promise<void> =>
        action().then(setStatus, (e: unknown) => {
          fail(what, e, () => void go())
          refreshStatus()
        })
      return go()
    }
    const port = status?.httpPort ?? status?.http.port
    return {
      ...(status?.version ? { version: `kimo-mcp ${status.version}` } : {}),
      start: () => run("start the MCP server", () => host.server.start()),
      stop: () => run("stop the MCP server", () => host.server.stop()),
      restart: () => run("restart the MCP server", () => host.server.restart()),
      askBeforeDestructive: {
        value: status?.askBeforeDestructive ?? true,
        set: (v) =>
          void host.server.setAskBeforeDestructive(v).then(refreshStatus, (e: unknown) => {
            fail("save Ask before destructive or out-of-scope ops", e)
            refreshStatus()
          }),
      },
      startOnLaunch: {
        value: status?.startOnLaunch ?? true,
        set: (v) =>
          void host.server.setStartOnLaunch(v).then(refreshStatus, (e: unknown) => {
            fail("save Start server when Kimo opens", e)
            refreshStatus()
          }),
      },
      ...(port
        ? {
            port: {
              value: port,
              set: async (p: number) => {
                try {
                  await host.server.setPort(p)
                } catch (e) {
                  fail(`use port ${p}`, e)
                }
                refreshStatus()
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
                try {
                  const t = await host.http.rotateToken(HTTP_TOKEN_CLIENT)
                  setToken(t)
                  return t
                } catch (e) {
                  fail("generate a new HTTP token", e)
                  return token ?? ""
                }
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
              reveal: () =>
                void host.server
                  .revealLog()
                  .catch((e: unknown) => fail("reveal the server log", e)),
            },
          }
        : {}),
    }
  }, [host, status, token, log, fail, refreshStatus])

  // D7: "Open log" outside an editor window (the desktop Settings window) reveals the activity
  // logs on disk (`~/.kimo/activity/<file>.jsonl`, next to `mcp/server.log`).
  const activityDir = log ? activityDirOf(log.path) : null
  const openActivity =
    onOpenActivity ??
    (activityDir && platform.capabilities.reveal
      ? () =>
          void platform.files
            .reveal(activityDir)
            .catch((e: unknown) => fail("reveal the activity log", e))
      : undefined)

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
      {...(openActivity ? { onOpenActivity: openActivity } : {})}
      banner={banner}
      onError={fail}
    />
  )
}
