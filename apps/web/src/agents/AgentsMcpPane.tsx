/**
 * Settings › Agents & MCP (board 21 YhAnC, window qDh6g content Yr0Ck; empty hgZHV; server failed
 * bxqQH). Content: column, padding [0, 32, 24, 32]. Bound to `McpHostApi`: server status,
 * endpoints, HTTP toggle, one-click host install (diff preview first), connected clients with
 * per-client permissions, activity log link. Server lifecycle controls the host API lacks
 * (restart / stop / start on launch / port / token / log) come in through `server`.
 */
import type {
  McpClientPolicy,
  McpConnectionInfo,
  McpHostApi,
  McpHostConfigStatus,
  McpHostId,
  McpServerStatus,
} from "@kimo/platform"
import {
  AgentClientRow,
  AgentHostRow,
  AgentTonePill,
  Banner,
  Button,
  EmptyState,
  IconButton,
  PropField,
  SegmentedText,
  SettingRow,
  Toggle,
} from "@kimo/ui"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import { ConfigDiffDialog } from "./ConfigDiffDialog"
import { AgentIcon } from "./icons"
import {
  clientMeta,
  configSnippet,
  DEFAULT_POLICY,
  FILES_OPTIONS,
  type FilesScope,
  filesForScope,
  filesScopeOf,
  HOST_ORDER,
  type HostRowView,
  hostRowView,
  LEVEL_OPTIONS,
  maskToken,
  type ServerError,
  scopeLabel,
  serverPill,
  tildePath,
} from "./model"

/** Server lifecycle and settings the `McpHostApi` doesn't cover (desktop shell provides them). */
export interface AgentsServerControls {
  /** "kimo-mcp 0.5.0" (Head Version). */
  version?: string
  restart?: () => Promise<void> | void
  stop?: () => Promise<void> | void
  start?: () => Promise<void> | void
  startOnLaunch?: { value: boolean; set: (v: boolean) => void }
  askBeforeDestructive?: { value: boolean; set: (v: boolean) => void }
  port?: {
    value: number
    set: (port: number) => Promise<void> | void
    isFree?: (port: number) => Promise<boolean>
  }
  /** The HTTP bearer shown masked (Copy copies the full value). */
  token?: { value: string; regenerate: () => Promise<string> | string }
  /** Server failed to start (bxqQH). */
  error?: ServerError | null
  log?: { path: string; lastError?: string; reveal: () => void }
}

export interface AgentsMcpPaneProps {
  host: McpHostApi
  server?: AgentsServerControls
  /** Installer scope (default user) and project folder for project scope. */
  scope?: "user" | "project"
  project?: string
  home?: string | null
  /** "this Mac" (macOS) / "this computer". */
  machine?: string
  /** Client expanded to its permissions on open (Settings deep link from the session popover). */
  expandedClient?: string | null
  onOpenActivity?: () => void
  /** Clipboard writer (default navigator.clipboard). */
  onCopy?: (text: string) => void
}

interface PaneData {
  status: McpServerStatus | null
  connections: McpConnectionInfo[]
  policies: Record<string, McpClientPolicy>
  hosts: McpHostConfigStatus[]
}

function usePaneData(host: McpHostApi, scope: "user" | "project", project?: string) {
  const [data, setData] = useState<PaneData>({
    status: null,
    connections: [],
    policies: {},
    hosts: [],
  })
  const loadHosts = useCallback(async () => {
    const hosts = await host.installer
      .status(scope, project)
      .catch(() => [] as McpHostConfigStatus[])
    setData((d) => ({ ...d, hosts }))
  }, [host, scope, project])
  useEffect(() => {
    let live = true
    void Promise.all([
      host.status().catch(() => null),
      host.connections().catch(() => [] as McpConnectionInfo[]),
      host.policies.list().catch(() => ({}) as Record<string, McpClientPolicy>),
      host.installer.status(scope, project).catch(() => [] as McpHostConfigStatus[]),
    ]).then(([status, connections, policies, hosts]) => {
      if (live) setData({ status, connections, policies, hosts })
    })
    const a = host.onStatus((status) => setData((d) => ({ ...d, status })))
    const b = host.onConnections((connections) => setData((d) => ({ ...d, connections })))
    return () => {
      live = false
      a()
      b()
    }
  }, [host, scope, project])
  return { data, setData, loadHosts }
}

const copyText = (text: string) => {
  void navigator.clipboard?.writeText(text).catch(() => {})
}

export function AgentsMcpPane(props: AgentsMcpPaneProps) {
  const { host, server = {}, scope = "user", project, home, machine = "this computer" } = props
  const { data, setData, loadHosts } = usePaneData(host, scope, project)
  const [expanded, setExpanded] = useState<string | null>(props.expandedClient ?? null)
  const [preview, setPreview] = useState<{
    host: McpHostId
    label: string
    action: "install" | "remove"
    path: string
    before: string | null
    after: string | null
    error?: string
  } | null>(null)
  const copy = props.onCopy ?? copyText
  const pill = serverPill(data.status, data.connections.length, server.error)
  const hosts = HOST_ORDER.map((h) => data.hosts.find((x) => x.host === h)).filter(
    (h): h is McpHostConfigStatus => !!h,
  )
  const views = hosts.map((h) => hostRowView(h, { home, machine }))
  const shim = data.status?.shimPath ?? "kimo-mcp"

  const setPolicy = async (client: string, policy: McpClientPolicy) => {
    await host.policies.set(client, policy)
    setData((d) => ({ ...d, policies: { ...d.policies, [client]: policy } }))
  }
  const openPreview = async (h: HostRowView, action: "install" | "remove") => {
    const p = await host.installer.preview(h.host, action, scope, project)
    setPreview({ host: h.host, label: h.name, action, ...p })
  }
  const hostActions = (h: HostRowView): ReactNode => {
    const copyBtn = (
      <Button
        key="copy"
        size="sm"
        variant="ghost"
        className="agents-button agents-button--ghost-primary"
        icon={<AgentIcon name="copy" size={14} />}
        onClick={() => copy(configSnippet(h.host, shim))}
      >
        Copy config
      </Button>
    )
    switch (h.state) {
      case "installed":
        return [
          copyBtn,
          <Button
            key="remove"
            size="sm"
            variant="secondary"
            className="agents-button"
            onClick={() => void openPreview(h, "remove")}
          >
            Remove
          </Button>,
        ]
      case "outdated":
        return [
          <Button
            key="remove"
            size="sm"
            variant="ghost"
            className="agents-button agents-button--ghost-primary"
            onClick={() => void openPreview(h, "remove")}
          >
            Remove
          </Button>,
          <Button
            key="update"
            size="sm"
            variant="primary"
            className="agents-button"
            icon={<AgentIcon name="arrow-up" size={14} />}
            onClick={() => void openPreview(h, "install")}
          >
            Update
          </Button>,
        ]
      case "not-installed":
        return [
          copyBtn,
          <Button
            key="install"
            size="sm"
            variant="primary"
            className="agents-button"
            icon={<AgentIcon name="plus" size={14} />}
            onClick={() => void openPreview(h, "install")}
          >
            Install
          </Button>,
        ]
      default:
        return [copyBtn]
    }
  }
  const hostRow = (h: HostRowView) => (
    <AgentHostRow
      key={h.host}
      data-host={h.host}
      data-state={h.state}
      icon={<AgentIcon name={h.icon} />}
      name={h.name}
      status={h.status}
      path={h.path}
      muted={h.muted}
      actions={hostActions(h)}
    />
  )
  const titleBar = (
    <div className="settings-title-bar agents-pane__title-bar">
      <h2 className="settings-title">Agents &amp; MCP</h2>
      <span className="agents-spacer" />
      <AgentTonePill tone={pill.tone} label={pill.label} data-testid="agents-server-status" />
    </div>
  )
  // Board 24 (c) KdEak: the config diff preview before any host config write.
  const dialog = preview && (
    <ConfigDiffDialog
      label={preview.label}
      action={
        preview.action === "remove"
          ? "remove"
          : views.find((x) => x.host === preview.host)?.state === "outdated"
            ? "update"
            : "install"
      }
      path={tildePath(preview.path, home)}
      before={preview.before}
      after={preview.after}
      {...(preview.error ? { error: preview.error } : {})}
      onCopy={copy}
      onCancel={() => setPreview(null)}
      onConfirm={() => {
        const p = preview
        setPreview(null)
        if (p.error) return
        void (
          p.action === "remove"
            ? host.installer.remove(p.host, scope, project)
            : host.installer.install(p.host, scope, project)
        ).then((row) =>
          setData((d) => ({ ...d, hosts: d.hosts.map((x) => (x.host === row.host ? row : x)) })),
        )
      }}
    />
  )

  // --- Server failed to start (bxqQH) ------------------------------------------------------------
  if (server.error) {
    const err = server.error
    return (
      <div className="agents-pane agents-pane--error" data-testid="agents-pane" data-state="error">
        <Banner
          tone="danger"
          icon={<AgentIcon name="circle-x" />}
          title="MCP server failed to start"
          body={err.message}
          actions={[
            { id: "change-port", label: "Change port", variant: "ghost" },
            { id: "retry", label: "Retry", variant: "primary" },
          ]}
          onAction={(id) => {
            if (id === "retry") void server.restart?.()
            else document.getElementById("agents-port-fix")?.querySelector("input")?.focus()
          }}
        />
        <div className="agents-pane__content">
          {titleBar}
          <ErrorServerCard status={data.status} server={server} />
          {server.startOnLaunch && (
            <SettingRow
              label="Start server when Kimo opens"
              description={`On next launch Kimo retries ${err.port ?? data.status?.http.port ?? ""} once, then shows this state again.`}
              control={(ids) => (
                <Toggle
                  checked={server.startOnLaunch?.value ?? false}
                  onChange={server.startOnLaunch?.set}
                  label="Start server when Kimo opens"
                  aria-describedby={ids.descriptionId}
                />
              )}
            />
          )}
          {server.log && (
            <SettingRow
              last
              label="Server log"
              description={`${tildePath(server.log.path, home)}${server.log.lastError ? ` · last error ${server.log.lastError}` : ""}`}
              control={
                <Button
                  size="sm"
                  variant="ghost"
                  className="agents-button agents-button--ghost-primary"
                  icon={<AgentIcon name="folder-open" size={14} />}
                  onClick={server.log.reveal}
                >
                  Reveal in Finder
                </Button>
              }
            />
          )}
        </div>
      </div>
    )
  }

  // --- No agents connected (hgZHV) ---------------------------------------------------------------
  if (data.connections.length === 0) {
    const order: McpHostId[] = ["claude-code", "codex", "cursor", "gemini-cli"]
    const prompt = "Open design/app.kimo in Kimo and list its top-level frames"
    return (
      <div className="agents-pane" data-testid="agents-pane" data-state="empty">
        <div className="agents-pane__content">
          {titleBar}
          <EmptyState
            className="agents-pane__empty"
            icon={<AgentIcon name="bot" />}
            title="No agents connected"
            description="Connect Claude Code, Codex or another MCP client and it can read and edit your .kimo files. Its edits stay teal and undoable until you keep them."
          />
          <div className="agents-pane__howto">
            <span className="agents-pane__group-title">How to connect</span>
            {[
              "Install Kimo in your agent below. It adds one entry and keeps a backup.",
              "Restart the agent (or run /mcp) so it picks up the kimo server.",
              "Ask it to open a file:",
            ].map((text, i) => (
              <div key={text} className="agents-pane__step">
                <span className="agents-pane__step-num">
                  <span className="agents-pane__step-n">{i + 1}</span>
                </span>
                <span className="agents-pane__step-text">{text}</span>
              </div>
            ))}
            <div className="agents-pane__prompt">
              <span className="agents-pane__prompt-text">{prompt}</span>
              <IconButton
                size="sm"
                tone="ghost"
                className="agents-icon-button agents-icon-button--13"
                label="Copy prompt"
                icon={<AgentIcon name="copy" size={13} />}
                onClick={() => copy(prompt)}
              />
            </div>
          </div>
          <div className="agents-pane__hosts-title">
            <span className="agents-pane__group-title">Connect an agent</span>
          </div>
          {order
            .map((h) => views.find((v) => v.host === h))
            .filter((v): v is HostRowView => !!v)
            .map(hostRow)}
          <span className="agents-pane__more">
            VS Code, Claude Desktop, opencode → “Copy config” or `kimo mcp install --host …`
          </span>
        </div>
        {dialog}
      </div>
    )
  }

  // --- Running with clients (qDh6g) --------------------------------------------------------------
  const status = data.status
  return (
    <div className="agents-pane" data-testid="agents-pane" data-state="running">
      <div className="agents-pane__content">
        {titleBar}
        <ServerCard status={status} server={server} copy={copy} />
        {server.startOnLaunch && (
          <SettingRow
            label="Start server when Kimo opens"
            description="Off: agents get “Kimo isn’t running” until you start it here or run `kimo mcp --headless`."
            control={(ids) => (
              <Toggle
                checked={server.startOnLaunch?.value ?? false}
                onChange={server.startOnLaunch?.set}
                label="Start server when Kimo opens"
                aria-describedby={ids.descriptionId}
              />
            )}
          />
        )}
        <SettingRow
          label="Streamable HTTP on localhost"
          description="For hosts that can’t spawn a process. Port is tried first; Kimo never picks a random one silently."
          control={
            <span className="agents-pane__control">
              {server.port && (
                <PropField
                  className="agents-pane__port"
                  prefix="PORT"
                  value={server.port.value}
                  min={1}
                  max={65535}
                  precision={0}
                  inputLabel="HTTP port"
                  onChange={(v) => void server.port?.set(Math.round(v))}
                />
              )}
              <Toggle
                checked={status?.http.enabled ?? false}
                label="Streamable HTTP on localhost"
                onChange={(on) =>
                  void host.http.setEnabled(on).then((s) => setData((d) => ({ ...d, status: s })))
                }
              />
            </span>
          }
        />
        {server.askBeforeDestructive && (
          <SettingRow
            label="Ask before destructive or out-of-scope ops"
            description="Deletes of 2+ frames, edits outside a client’s files, and global changes (variables, themes) wait for approval."
            control={
              <Toggle
                checked={server.askBeforeDestructive.value}
                onChange={server.askBeforeDestructive.set}
                label="Ask before destructive or out-of-scope ops"
              />
            }
          />
        )}
        <div className="agents-pane__group">
          <div className="agents-pane__group-row agents-pane__group-row--28">
            <span className="agents-pane__group-title">Connect an agent</span>
            <span className="agents-spacer" />
            <Button
              size="sm"
              variant="ghost"
              className="agents-button agents-button--ghost-primary"
              icon={<AgentIcon name="refresh-cw" size={14} />}
              onClick={() => void loadHosts()}
            >
              Rescan
            </Button>
          </div>
          <span className="agents-pane__group-desc">
            Adds one `kimo` entry to the host’s MCP config, with a backup and a diff preview. Other
            entries are never rewritten.
          </span>
        </div>
        {views.map(hostRow)}
        <div className="agents-pane__group">
          <div className="agents-pane__group-row">
            <span className="agents-pane__group-title">Connected clients</span>
            <span className="agents-spacer" />
            <span className="agents-pane__count">{data.connections.length} connected</span>
          </div>
          <span className="agents-pane__group-desc">
            Each connection is one origin (`mcp:&lt;client&gt;`) with its own undo stack.
            Permissions apply to new calls immediately.
          </span>
        </div>
        {data.connections.map((c) => {
          const policy = data.policies[c.identity.client] ?? DEFAULT_POLICY
          const open = expanded === c.connectionId || expanded === c.identity.client
          return (
            <div
              key={c.connectionId}
              className="agents-pane__client"
              data-client={c.identity.client}
            >
              <AgentClientRow
                name={c.identity.label}
                version={c.identity.version}
                meta={clientMeta(c, status)}
                scope={scopeLabel(policy, c.cwd)}
                writable={policy.level !== "read"}
                expanded={open}
                onClick={() => setExpanded(open ? null : c.connectionId)}
              />
              {open && (
                <Permissions
                  connection={c}
                  policy={policy}
                  token={server.token?.value}
                  onPolicy={(p) => void setPolicy(c.identity.client, p)}
                  onDisconnect={() => void host.disconnect(c.connectionId)}
                />
              )}
            </div>
          )
        })}
        <div className="agents-pane__log-link">
          <AgentIcon name="history" size={16} className="agents-pane__log-icon" />
          <span className="agents-pane__log-text">
            <span className="agents-pane__log-label">Activity log</span>
            <span className="agents-pane__log-desc">
              Every agent call, per file, with revision and undo. Also in the editor’s Activity tab.
            </span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="agents-button"
            icon={<AgentIcon name="arrow-up-right" size={14} />}
            onClick={props.onOpenActivity}
          >
            Open log
          </Button>
        </div>
      </div>
      {dialog}
    </div>
  )
}

/** Server Card (CV3Ow). */
function ServerCard({
  status,
  server,
  copy,
}: {
  status: McpServerStatus | null
  server: AgentsServerControls
  copy: (t: string) => void
}) {
  const running = !!status?.socket.listening
  const version = [server.version, status ? `protocol ${status.protocol}` : null]
    .filter(Boolean)
    .join(" · ")
  return (
    <div className="agents-card" data-testid="agents-server-card">
      <div className="agents-card__head">
        <AgentIcon name="server" size={16} className="agents-card__icon" />
        <span className="agents-card__title">MCP server</span>
        <span className="agents-card__version">{version}</span>
        <span className="agents-spacer" />
        {server.restart && (
          <Button
            size="sm"
            variant="secondary"
            className="agents-button"
            icon={<AgentIcon name="rotate-cw" size={14} />}
            onClick={() => void server.restart?.()}
          >
            Restart
          </Button>
        )}
        {running && server.stop && (
          <Button
            size="sm"
            variant="secondary"
            className="agents-button"
            icon={<AgentIcon name="square" size={14} />}
            onClick={() => void server.stop?.()}
          >
            Stop
          </Button>
        )}
        {!running && server.start && (
          <Button
            size="sm"
            variant="secondary"
            className="agents-button"
            icon={<AgentIcon name="play" size={14} />}
            onClick={() => void server.start?.()}
          >
            Start
          </Button>
        )}
      </div>
      <div className="agents-card__endpoints">
        <Endpoint
          label="Local socket"
          value={status ? tildePath(status.socket.path) : "—"}
          onCopy={() => status && copy(status.socket.path)}
        />
        <Endpoint
          label="HTTP"
          value={status?.http.enabled && status.http.url ? status.http.url : "Off"}
          onCopy={status?.http.url ? () => copy(status.http.url as string) : undefined}
        />
        {server.token && (
          <Endpoint
            label="Token"
            value={maskToken(server.token.value)}
            onCopy={() => copy(server.token?.value ?? "")}
          >
            <Button
              size="sm"
              variant="ghost"
              className="agents-button agents-button--ghost-primary"
              icon={<AgentIcon name="refresh-cw" size={14} />}
              onClick={() => void server.token?.regenerate()}
            >
              Regenerate
            </Button>
          </Endpoint>
        )}
      </div>
      <span className="agents-card__note">
        Stdio hosts launch `kimo mcp`, which bridges to the socket. HTTP binds 127.0.0.1 only and
        every request needs the token.
      </span>
    </div>
  )
}

function Endpoint({
  label,
  value,
  onCopy,
  state,
  children,
}: {
  label: string
  value: string
  onCopy?: () => void
  state?: "ok" | "error"
  children?: ReactNode
}) {
  return (
    <div className="agents-endpoint">
      <span className="agents-endpoint__label">{label}</span>
      <span
        className={`agents-endpoint__field${state === "error" ? " agents-endpoint__field--error" : ""}${state ? " agents-endpoint__field--state" : ""}`}
      >
        <span className="agents-endpoint__value">{value}</span>
        {onCopy && !state && (
          <IconButton
            size="sm"
            tone="ghost"
            className="agents-icon-button agents-icon-button--22"
            label={`Copy ${label}`}
            icon={<AgentIcon name="copy" size={13} />}
            onClick={onCopy}
          />
        )}
        {state && (
          <AgentIcon
            name={state === "ok" ? "circle-check" : "circle-x"}
            size={13}
            className={`agents-endpoint__state agents-endpoint__state--${state}`}
          />
        )}
      </span>
      {children}
    </div>
  )
}

/** Server Card in the failed state (e9il2): code, socket ok, HTTP down, Port Fix. */
function ErrorServerCard({
  status,
  server,
}: {
  status: McpServerStatus | null
  server: AgentsServerControls
}) {
  const err = server.error as ServerError
  const [port, setPort] = useState(err.suggestedPort ?? (err.port ? err.port + 1 : 7342))
  const [free, setFree] = useState<boolean | null>(err.suggestedPort ? true : null)
  useEffect(() => {
    let live = true
    if (server.port?.isFree) void server.port.isFree(port).then((f) => live && setFree(f))
    return () => {
      live = false
    }
  }, [port, server.port])
  return (
    <div className="agents-card agents-card--error" data-testid="agents-server-card">
      <div className="agents-card__head">
        <AgentIcon name="server" size={16} className="agents-card__icon" />
        <span className="agents-card__title">MCP server</span>
        <span className="agents-card__code">{err.code}</span>
        <span className="agents-spacer" />
        <Button
          size="sm"
          variant="secondary"
          className="agents-button"
          icon={<AgentIcon name="rotate-cw" size={14} />}
          onClick={() => void server.restart?.()}
        >
          Retry
        </Button>
      </div>
      <Endpoint
        label="Local socket"
        value={status ? tildePath(status.socket.path) : "—"}
        state={status?.socket.listening ? "ok" : "error"}
      />
      <Endpoint
        label="HTTP"
        value={status?.http.url ?? `http://127.0.0.1:${err.port ?? ""}/mcp`}
        state="error"
      />
      <div className="agents-card__port-fix" id="agents-port-fix">
        <PropField
          className="agents-pane__port agents-pane__port--fix"
          prefix="PORT"
          value={port}
          min={1}
          max={65535}
          precision={0}
          inputLabel="New HTTP port"
          onChange={(v) => setPort(Math.round(v))}
        />
        {free !== null && (
          <span className={`agents-card__hint${free ? "" : " agents-card__hint--taken"}`}>
            {free ? `${port} is free` : `${port} is in use`}
          </span>
        )}
        <span className="agents-spacer" />
        <Button
          size="sm"
          variant="primary"
          className="agents-button"
          disabled={free === false}
          onClick={() => void server.port?.set(port)}
        >
          {`Use ${port} and restart`}
        </Button>
      </div>
      <span className="agents-card__note">
        Agents configured for HTTP keep the old URL until you Update them below; Kimo offers that
        after the port changes. It never picks a port silently.
      </span>
    </div>
  )
}

/** Permissions (mCEsz) under an expanded client. */
function Permissions({
  connection,
  policy,
  token,
  onPolicy,
  onDisconnect,
}: {
  connection: McpConnectionInfo
  policy: McpClientPolicy
  token?: string
  onPolicy: (p: McpClientPolicy) => void
  onDisconnect: () => void
}) {
  const scope = filesScopeOf(policy, connection.cwd)
  const pid = connection.identity.pid
  const note = [
    pid ? `pid ${pid}` : null,
    token ? `token ${token.slice(0, 9)}…${token.slice(-4)}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <div className="agents-perms" data-testid="agents-permissions">
      <div className="agents-perms__row">
        <span className="agents-perms__label">Can</span>
        <SegmentedText
          label="Can"
          options={LEVEL_OPTIONS}
          value={policy.level}
          onChange={(level) => onPolicy({ ...policy, level })}
        />
      </div>
      <div className="agents-perms__row">
        <span className="agents-perms__label">Files</span>
        <SegmentedText<FilesScope>
          label="Files"
          options={FILES_OPTIONS}
          value={scope}
          onChange={(s) => onPolicy({ ...policy, files: filesForScope(s, connection.cwd) })}
        />
        {connection.cwd && (
          <span className="agents-perms__folder">{tildePath(connection.cwd)}/</span>
        )}
      </div>
      <div className="agents-perms__footer">
        <span className="agents-perms__note">{note}</span>
        <span className="agents-spacer" />
        <Button
          size="sm"
          variant="ghost"
          className="agents-button agents-button--danger"
          icon={<AgentIcon name="unplug" size={14} />}
          onClick={onDisconnect}
        >
          Disconnect
        </Button>
      </div>
    </div>
  )
}

/** Minimal line diff for the preview (removed "- ", added "+ "). */
export function diffLines(before: string | null, after: string | null): string {
  const a = (before ?? "").split("\n")
  const b = (after ?? "").split("\n")
  const out: string[] = []
  const inA = new Set(a)
  const inB = new Set(b)
  for (const line of a) if (!inB.has(line) && line) out.push(`- ${line}`)
  for (const line of b) out.push(`${inA.has(line) ? "  " : "+ "}${line}`)
  return out.join("\n").trimEnd()
}
