/**
 * The desktop document host (ADR 0002 Option A, ADR 0012 §2, ADR 0013 §7): one hidden webview
 * (`#/host`) holds the authoritative store of every open document in the M4 session manager
 * (lease, autosave, recovery, git, conflicts: the `FileDocumentSession` code, unchanged). Editor
 * windows are clients: they open through RPC and keep a replica in sync with
 * `@kimo/sync`'s `HostSyncHub` / `WindowSyncProvider`. MCP connections relayed by Rust are
 * served here with `@kimo/mcp-server` (one SDK server per connection), over the same stores.
 *
 * Everything goes through a {@link HostBridge}, so the same code runs in the Tauri host and,
 * with a memory network, in tests and the browser e2e harness.
 */
import { threeWayMerge } from "@kimo/core-schema"
import type { Revision } from "@kimo/editor-state"
import {
  type ActivityEntry,
  type ActivityStore,
  type ApprovalOutcome,
  type ApprovalRequest,
  type BackendDocument,
  type ClientIdentity,
  type ClientPolicy,
  type CoreDocumentHost,
  clientSlug,
  createDocumentHost,
  createMcpHostRuntime,
  createMemoryActivityStore,
  createSceneService,
  DEFAULT_POLICY,
  type DocumentBackend,
  decideOpen,
  type HostFiles,
  type McpConnection,
  type McpHostRuntime,
  type SceneService,
  type SceneServiceOptions,
  type SvgImporter,
} from "@kimo/mcp-server"
import type {
  KimoPlatform,
  McpApprovalChoice,
  McpConnectionInfo,
  McpHttpRequest,
  TauriMcpEventMap,
} from "@kimo/platform"
import { HostSyncHub, type HostSyncMessage, type HostSyncTransport } from "@kimo/sync"
import { scopeViolations } from "../agent-panel/tools"
import { isUntitledRef, type SessionState } from "../platform/contract"
import {
  createSessionManager,
  type FileDocumentSession,
  type FileSessionManager,
} from "../platform/session"
import { HOST_EVENTS, HOST_LABEL, type HostBridge } from "./bridge"

/** Display names of the known agent hosts (generic labels; never logos). */
const CLIENT_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
  cursor: "Cursor",
  vscode: "VS Code",
}

export interface DocumentHostServiceOptions {
  platform: KimoPlatform
  bridge: HostBridge
  /** App version (kimo_get_state, `kimo_mcp_host_ready`). */
  version: string
  /** Serve relayed MCP connections (Tauri events from Rust). Default true. */
  relay?: boolean
  /** Session manager (default: one over `platform` with the core-schema merge). */
  manager?: FileSessionManager
  scene?: SceneService | SceneServiceOptions
  svgImport?: SvgImporter
  /** Activity persistence (default: Tauri `kimo_mcp_activity_*`, memory when unavailable). */
  activity?: ActivityStore
  /** Input validation for in-process calls (tests pass `validateInput`). */
  validate?: (def: never, input: unknown) => never[]
  approvalTimeoutMs?: number
}

/** A relayed MCP connection (socket or HTTP session). */
interface Relay {
  connectionId: string
  /** Null until the identity is known (hello client, else initialize.clientInfo.name). */
  conn: McpConnection | null
  cwd?: string
  close(): Promise<void>
  receive?(line: string): void
}

/** What a window sends with `agentCall`: the agent's identity and policy (ADR 0014 §5). */
export interface AgentCallSpec {
  /** `agent:kimo.<session>.<n>`. */
  origin: `agent:${string}`
  /** "Kimo", "Agent 2". */
  label: string
  session: string
  /** The window's policy for this agent: `nodes` = its scope (checkScope runs in the host). */
  policy: ClientPolicy
}

export interface DocumentHostService {
  readonly host: CoreDocumentHost
  readonly runtime: McpHostRuntime
  readonly hub: HostSyncHub
  readonly manager: FileSessionManager
  /** Open relayed connections by id. */
  readonly relays: ReadonlyMap<string, Relay>
  /** Labels of the windows showing `ref`. */
  viewers(ref: string): string[]
  dispose(): Promise<void>
}

/** Read-only reason of a host session (null when writable). */
function readOnlyReasonOf(s: FileDocumentSession): string | null {
  if (s.store.readOnly) return s.store.readOnly.reason
  const st = s.state()
  if (st.phase === "read-only" || st.phase === "failed-load") {
    const k = st.saveStatus
    if (k.kind === "locked") return `locked by ${k.holder.appLabel}`
    if (k.kind === "read-only") return k.cause
    return "read-only"
  }
  return null
}

/** Activity store over the Tauri commands, falling back to memory (browser, tests). */
export function bridgeActivityStore(bridge: HostBridge): ActivityStore {
  const mem = createMemoryActivityStore()
  let tauri = true
  return {
    async append(fileId, entry) {
      mem.append(fileId, entry)
      if (!tauri) return
      await bridge.invoke("kimo_mcp_activity_append", { fileId, entry }).catch(() => {
        tauri = false
      })
    },
    async list(fileId, limit = 500) {
      if (tauri) {
        try {
          return await bridge.invoke<ActivityEntry[]>("kimo_mcp_activity_read", { fileId, limit })
        } catch {
          tauri = false
        }
      }
      return mem.list(fileId, limit)
    },
  }
}

/** Starts the document host in this webview. */
export async function startDocumentHostService(
  options: DocumentHostServiceOptions,
): Promise<DocumentHostService> {
  const { platform, bridge } = options
  await platform.settings.ready.catch(() => undefined)
  const manager =
    options.manager ??
    createSessionManager({ platform, merge: threeWayMerge, hideOwnRecovery: true })
  const offs: (() => void)[] = []
  const listen = async <T>(event: string, h: (p: T) => void) => {
    offs.push(await bridge.listen<T>(event, h))
  }

  // --- Window ↔ host sync ----------------------------------------------------------------------
  const peerLabel = new Map<string, string>()
  const syncListeners = new Set<(m: HostSyncMessage) => void>()
  const transport: HostSyncTransport = {
    send(msg) {
      const label = peerLabel.get(msg.peer)
      if (label) void bridge.emitTo(label, HOST_EVENTS.sync, { from: HOST_LABEL, msg })
    },
    onMessage(l) {
      syncListeners.add(l)
      return () => syncListeners.delete(l)
    },
  }
  await listen<{ from: string; msg: HostSyncMessage }>(HOST_EVENTS.sync, ({ from, msg }) => {
    peerLabel.set(msg.peer, from)
    for (const l of [...syncListeners]) l(msg)
  })
  const usable = (s: FileDocumentSession | undefined) =>
    !!s &&
    !isUntitledRef(s.ref) &&
    s.state().phase !== "failed-load" &&
    s.state().phase !== "closed"
  const hub = new HostSyncHub(transport, (ref) => {
    const s = manager.get(ref)
    return usable(s) ? (s as FileDocumentSession).store : null
  })

  // --- Viewers, session state, selection -------------------------------------------------------
  const viewers = new Map<string, Set<string>>()
  const selections = new Map<string, Map<string, string[]>>()
  const stateSubs = new Map<string, () => void>()
  const lastSaved = new Map<FileDocumentSession, Revision>()
  const pushState = (s: FileDocumentSession, state: SessionState) => {
    for (const label of viewers.get(s.ref) ?? [])
      void bridge.emitTo(label, HOST_EVENTS.sessionState, { ref: s.ref, state })
  }
  const track = () => {
    const live = new Set(manager.sessions())
    for (const s of live) {
      if (!stateSubs.has(s.ref) && !isUntitledRef(s.ref)) {
        stateSubs.set(
          s.ref,
          s.subscribe((st) => {
            if (!s.provider?.dirty) lastSaved.set(s, s.store.revision)
            pushState(s, st)
          }),
        )
        lastSaved.set(s, s.store.revision)
      }
      if (usable(s)) hub.register(s.ref, s.store)
    }
    for (const [ref, off] of stateSubs)
      if (![...live].some((s) => s.ref === ref)) {
        off()
        stateSubs.delete(ref)
        hub.unregister(ref)
      }
  }
  offs.push(manager.subscribe(track))

  // --- DocumentHost backend over the session manager --------------------------------------------
  const adapt = (s: FileDocumentSession): BackendDocument => ({
    path: s.ref,
    store: s.store,
    readOnlyReason: () => readOnlyReasonOf(s),
    format: () => s.provider?.openResult?.sourceFormat ?? s.store.toHeader().format,
    dirty: () => s.provider?.dirty ?? false,
    lastSavedRevision: () => lastSaved.get(s),
    shownInWindow: () => (viewers.get(s.ref)?.size ?? 0) > 0,
    async save() {
      const p = s.provider
      if (!p?.canSave)
        return {
          ok: false,
          error: { code: "READ_ONLY", message: "This document cannot be saved." },
        }
      try {
        const r = await p.saveFile({ force: true })
        if (!r) return { ok: false, error: { code: "INTERNAL", message: "Nothing was written." } }
        lastSaved.set(s, r.revision)
        return { ok: true, value: { bytes: r.bytes, sha256: r.hash, revision: r.revision } }
      } catch (e) {
        return {
          ok: false,
          error: {
            code: "INTERNAL",
            message: `Save failed: ${e instanceof Error ? e.message : String(e)}`,
            retryable: true,
          },
        }
      }
    },
    async close({ discard }) {
      if (discard) await s.dispose()
      else await s.close()
    },
  })
  // MCP calls reach these only after `authorize` (file allow-list or the user's approval), so
  // the host widens Rust's deny-by-default fs scope to each path first (no-op off Tauri).
  let scopeCommand = true
  const allowPath = async (path: string) => {
    if (!scopeCommand) return
    await bridge.invoke("kimo_mcp_scope_allow", { path }).catch((e: unknown) => {
      if ((e as { code?: string })?.code === "UNSUPPORTED") scopeCommand = false
    })
  }
  const pf = platform.files as unknown as HostFiles
  const files: HostFiles = {
    async readText(p) {
      await allowPath(p)
      return pf.readText(p)
    },
    async readBytes(p) {
      await allowPath(p)
      return pf.readBytes(p)
    },
    async writeTextAtomic(p, t, o) {
      await allowPath(p)
      return pf.writeTextAtomic(p, t, o)
    },
    async writeBytesAtomic(p, b, o) {
      await allowPath(p)
      return pf.writeBytesAtomic(p, b, o)
    },
    async stat(p) {
      await allowPath(p)
      return pf.stat(p)
    },
  }
  const backend: DocumentBackend = {
    kind: "desktop",
    files,
    list: () => manager.sessions().filter(usable).map(adapt),
    async open(path, { readOnly }) {
      await allowPath(path)
      const s = await manager.open(path, { readOnly })
      const st = s.state()
      if (st.phase === "failed-load") {
        const detail = st.banner?.kind === "failed-load" ? st.banner.detail : null
        await s.dispose()
        return {
          ok: false,
          error: {
            code: "LOAD_FAILED",
            message: `${detail?.headline ?? "Cannot open"}: ${detail?.error ?? detail?.explanation ?? path}`,
            suggestion: "The file was not changed. Fix it in a text editor, then kimo_open again.",
          },
        }
      }
      if (!readOnly && st.saveStatus.kind === "locked") {
        const h = st.saveStatus.holder
        const decision = decideOpen({
          host: "desktop",
          alreadyOpen: false,
          readOnly: false,
          holder: { pid: h.pid, app: h.app, appLabel: h.appLabel, alive: h.alive, self: h.self },
        })
        if ((viewers.get(path)?.size ?? 0) === 0) await s.dispose()
        return {
          ok: false,
          error: {
            code: "DOCUMENT_LOCKED",
            message: `${path} is open in ${h.appLabel} (pid ${h.pid}).`,
            detail: {
              kind: "lock",
              holder: {
                pid: h.pid,
                app: h.app,
                appLabel: h.appLabel,
                alive: h.alive,
                host: h.host,
                sinceIso: h.sinceIso,
              },
            },
            suggestion: decision.action === "refuse" ? decision.suggestion : "Pass readOnly: true.",
          },
        }
      }
      track()
      return { ok: true, value: adapt(s) }
    },
    async focus(path, ids, opts) {
      const labels = [...(viewers.get(path) ?? [])]
      for (const label of labels)
        void bridge.emitTo(label, HOST_EVENTS.focus, { ref: path, ids, ...opts })
      return labels.length > 0
    },
    selection(path) {
      const m = selections.get(path)
      if (!m) return []
      const last = [...m.values()].at(-1)
      return last ?? []
    },
  }
  const scene =
    options.scene && "render" in options.scene
      ? options.scene
      : createSceneService(options.scene as SceneServiceOptions | undefined)
  const host = createDocumentHost({ backend, scene })

  // --- MCP runtime ------------------------------------------------------------------------------
  let policies: Record<string, ClientPolicy> = {}
  const refreshPolicies = async () => {
    policies = await bridge
      .invoke<Record<string, ClientPolicy>>("kimo_mcp_policies_get", {})
      .catch(() => policies)
  }
  await refreshPolicies()
  const runtime = createMcpHostRuntime({
    host,
    approvals: "ask",
    ...(options.approvalTimeoutMs ? { approvalTimeoutMs: options.approvalTimeoutMs } : {}),
    policyFor: (id) => policies[id.client] ?? DEFAULT_POLICY,
    activity: options.activity ?? bridgeActivityStore(bridge),
    onActivity: (fileId, entry) => void bridge.emit("kimo://mcp-activity", { fileId, entry }),
    handlerOptions: {
      version: options.version,
      windows: () => new Set([...viewers.values()].flatMap((s) => [...s])).size,
      ...(options.svgImport ? { svgImport: options.svgImport } : {}),
    },
    ...(options.validate ? { validate: options.validate as never } : {}),
  })
  const relays = new Map<string, Relay>()
  const connectionInfos = (): McpConnectionInfo[] =>
    runtime.presence.list().map((p) => {
      const relay = [...relays.values()].find((r) => r.conn?.origin === p.origin)
      return {
        connectionId: relay?.connectionId ?? p.origin,
        identity: p.identity,
        origin: p.origin,
        ...(relay?.cwd ? { cwd: relay.cwd } : {}),
        connectedAt: p.connectedAt,
        lastActivityAt: p.lastActivityAt,
        state: p.state,
        docs: p.docs,
        ...(p.call ? { call: p.call } : {}),
        ...(p.focus.length ? { focus: p.focus } : {}),
        ...(p.paused ? { paused: true } : {}),
      }
    })
  offs.push(
    runtime.presence.onChange(() => void bridge.emit("kimo://mcp-connections", connectionInfos())),
  )
  offs.push(runtime.approvals.onRequest((r) => void bridge.emit("kimo://mcp-approval-request", r)))
  offs.push(
    runtime.approvals.onResolved(
      (id, outcome) => void bridge.emit("kimo://mcp-approval-resolved", { id, outcome }),
    ),
  )
  await listen<{ id: string; choice: McpApprovalChoice }>(
    "kimo://mcp-approval-answer",
    ({ id, choice }) => {
      runtime.approvals.respond(id, choice)
    },
  )

  const identityOf = (
    client: string | undefined,
    transportKind: ClientIdentity["transport"],
    pid?: number,
  ) => {
    const slug = clientSlug(client ?? "client")
    return {
      client: slug,
      label: CLIENT_LABELS[slug] ?? client ?? "MCP client",
      transport: transportKind,
      ...(pid ? { pid } : {}),
    }
  }

  if (options.relay !== false) {
    const sdk = await import("@kimo/mcp-server/host")
    /**
     * Opens a relayed connection. The session is the connectionId without `c_`; when the hello
     * names no client (or "unknown"), the identity waits for `initialize.clientInfo.name`.
     */
    const open = async (p: TauriMcpEventMap["kimo://mcp-connection"]) => {
      if (relays.has(p.connectionId)) return
      const session =
        p.connectionId
          .replace(/^c_/, "")
          .replace(/[^a-z0-9]/gi, "")
          .toLowerCase()
          .slice(0, 16) || undefined
      const known = p.hello?.client && p.hello.client !== "unknown" ? p.hello.client : undefined
      const queue: string[] = []
      let started: Promise<void> | null = null
      let t: InstanceType<typeof sdk.RelayTransport> | null = null
      let conn = null as McpConnection | null
      let server = null as { close(): Promise<void> } | null
      const start = (client: string | undefined) => {
        started = (async () => {
          await refreshPolicies()
          const c = runtime.connect(
            {
              ...identityOf(client ?? "unknown", p.transport, p.hello?.pid),
              ...(session ? { session } : {}),
            },
            p.hello?.cwd ? { cwd: p.hello.cwd } : {},
          )
          conn = c
          relay.conn = c
          const tr = new sdk.RelayTransport((message) =>
            bridge.invoke("kimo_mcp_send", { connectionId: p.connectionId, message }).then(
              () => {},
              (e: unknown) => {
                if ((e as { code?: string })?.code === "NOT_FOUND") void relay.close()
              },
            ),
          )
          const srv = sdk.createConnectionServer(c, { version: options.version, host: "desktop" })
          server = srv
          await srv.connect(tr)
          t = tr
          for (const l of queue.splice(0)) tr.receive(l)
        })()
      }
      const relay: Relay = {
        connectionId: p.connectionId,
        conn: null,
        ...(p.hello?.cwd ? { cwd: p.hello.cwd } : {}),
        receive: (line) => {
          if (t) return t.receive(line)
          queue.push(line)
          if (started) return
          let client = known
          try {
            const m = JSON.parse(line) as {
              method?: string
              params?: { clientInfo?: { name?: string } }
            }
            if (!client && m.method === "initialize") client = m.params?.clientInfo?.name
          } catch {
            // Not JSON: the SDK reports it.
          }
          start(client)
        },
        async close() {
          relays.delete(p.connectionId)
          await started?.catch(() => {})
          conn?.close()
          await server?.close().catch(() => {})
        },
      }
      relays.set(p.connectionId, relay)
      if (known) start(known)
    }
    await listen<TauriMcpEventMap["kimo://mcp-connection"]>("kimo://mcp-connection", (p) => {
      if (p.state === "open") void open(p)
      else void relays.get(p.connectionId)?.close()
    })
    await listen<TauriMcpEventMap["kimo://mcp-in"]>("kimo://mcp-in", async (p) => {
      if (!relays.has(p.connectionId))
        await open({ connectionId: p.connectionId, state: "open", transport: "socket" })
      relays.get(p.connectionId)?.receive?.(p.message)
    })
    // Streamable HTTP, relayed whole (one SDK transport per MCP session).
    const http = new Map<
      string,
      { t: InstanceType<typeof sdk.WebStandardStreamableHTTPServerTransport>; relay: Relay }
    >()
    await listen<McpHttpRequest>("kimo://mcp-http-request", async (req) => {
      const sid = Object.entries(req.headers).find(
        ([k]) => k.toLowerCase() === "mcp-session-id",
      )?.[1]
      let entry = sid ? http.get(sid) : undefined
      if (!entry) {
        const clientHeader = Object.entries(req.headers).find(
          ([k]) => k.toLowerCase() === "x-kimo-client",
        )?.[1]
        const conn = runtime.connect(identityOf(clientHeader ?? "http-client", "http"))
        const t = new sdk.WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => globalThis.crypto.randomUUID(),
          onsessioninitialized: (id) => {
            if (entry) http.set(id, entry)
          },
          onsessionclosed: (id) => {
            void http.get(id)?.relay.close()
            http.delete(id)
          },
        })
        const server = sdk.createConnectionServer(conn, {
          version: options.version,
          host: "desktop",
        })
        const relay: Relay = {
          connectionId: `http:${conn.identity.session}`,
          conn,
          async close() {
            relays.delete(relay.connectionId)
            conn.close()
            await server.close().catch(() => {})
          },
        }
        relays.set(relay.connectionId, relay)
        entry = { t, relay }
        await server.connect(t)
      }
      const body = req.bodyBase64
        ? Uint8Array.from(atob(req.bodyBase64), (c) => c.charCodeAt(0))
        : undefined
      const res = await entry.t.handleRequest(
        new Request(req.url, {
          method: req.method,
          headers: req.headers,
          ...(body && req.method !== "GET" && req.method !== "HEAD" ? { body } : {}),
        }),
      )
      const headers: Record<string, string> = {}
      res.headers.forEach((v, k) => {
        headers[k] = v
      })
      await bridge.invoke("kimo_mcp_http_respond", {
        requestId: req.requestId,
        status: res.status,
        headers,
        end: !res.body,
      })
      if (!res.body) return
      const reader = res.body.getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        let bin = ""
        for (const b of value) bin += String.fromCharCode(b)
        await bridge.invoke("kimo_mcp_http_respond", {
          requestId: req.requestId,
          chunkBase64: btoa(bin),
          end: false,
        })
      }
      await bridge.invoke("kimo_mcp_http_respond", { requestId: req.requestId, end: true })
    })
  }

  // --- In-app agents (agentCall, ADR 0014 §5) ----------------------------------------------------
  // One runtime connection per (window, agent origin): presence, activity, pause and agentUndo
  // see the agent next to MCP clients; edits carry `agent:kimo.<session>.<n>` on the host store,
  // so its undo stack and attribution are the agent's own (the window's replica receives them
  // as `remote:agent:…` and its ⌘Z never undoes them). Approvals go back to the window's
  // in-thread card and wait until answered.
  const agentConns = new Map<string, { conn: McpConnection; from: string }>()
  const agentPrompts = new Map<
    string,
    { from: string; origin: string; resolve(o: ApprovalOutcome): void }
  >()
  let promptSeq = 0
  const agentKey = (from: string, origin: string) => `${from}\u0000${origin}`
  const closeAgent = (key: string) => {
    const a = agentConns.get(key)
    if (!a) return
    agentConns.delete(key)
    for (const [id, p] of agentPrompts)
      if (p.from === a.from && p.origin === a.conn.origin) {
        agentPrompts.delete(id)
        p.resolve("deny")
      }
    a.conn.close()
  }
  const closeAgentsOf = (from: string, origins?: readonly string[]) => {
    for (const [key, a] of [...agentConns])
      if (a.from === from && (!origins || origins.includes(a.conn.origin))) closeAgent(key)
  }
  const agentConnection = (spec: AgentCallSpec, from: string): McpConnection => {
    if (!/^agent:[a-z0-9-]+\.[a-z0-9]+\.\d+$/i.test(spec.origin))
      throw new Error(`Invalid agent origin ${String(spec.origin)}`)
    const key = agentKey(from, spec.origin)
    const live = agentConns.get(key)
    if (live && !live.conn.closed) {
      if (JSON.stringify(live.conn.policy) !== JSON.stringify(spec.policy))
        live.conn.setPolicy(spec.policy)
      return live.conn
    }
    const conn = runtime.connect(
      {
        client: "kimo",
        label: spec.label,
        session: spec.session,
        transport: "in-process",
      },
      {
        policy: spec.policy,
        origin: spec.origin,
        scope: (def, input, store, policy) => scopeViolations(store, policy, def.name, input),
        requestApproval: (request: ApprovalRequest) =>
          new Promise<ApprovalOutcome>((resolve) => {
            const id = `ap${(++promptSeq).toString(36)}`
            agentPrompts.set(id, { from, origin: spec.origin, resolve })
            void bridge
              .emitTo(from, HOST_EVENTS.agentApproval, { id, origin: spec.origin, request })
              .catch(() => {
                agentPrompts.delete(id)
                resolve("deny")
              })
          }),
      },
    )
    agentConns.set(key, { conn, from })
    return conn
  }

  // --- Window RPC -------------------------------------------------------------------------------
  type Rpc = { from: string; id: string; method: string; args: Record<string, unknown> }
  const rpc: Record<string, (args: Record<string, unknown>, from: string) => Promise<unknown>> = {
    ping: async () => ({ version: options.version }),
    async open(args, from) {
      const ref = String(args.ref)
      const s = await manager.open(ref, (args.options as never) ?? {})
      track()
      let set = viewers.get(ref)
      if (!set) {
        set = new Set()
        viewers.set(ref, set)
      }
      set.add(from)
      return { state: s.state() }
    },
    async release(args, from) {
      const ref = String(args.ref)
      viewers.get(ref)?.delete(from)
      // The window's in-app agents end with it (pending prompts answer deny).
      if (![...viewers.values()].some((s) => s.has(from))) closeAgentsOf(from)
      selections.get(ref)?.delete(from)
      const s = manager.get(ref)
      const usedByAgent = runtime.presence.list().some((p) => {
        const id = host.docIdForPath(ref)
        return id !== undefined && p.docs.includes(id)
      })
      if (s && (viewers.get(ref)?.size ?? 0) === 0 && !usedByAgent) await s.close()
      return { ok: true }
    },
    async command(args) {
      const s = manager.get(String(args.ref))
      if (!s) throw new Error(`${String(args.ref)} is not open in the document host`)
      const method = String(args.method)
      const allowed = [
        "save",
        "saveAs",
        "flush",
        "respondToConsent",
        "respondToGit",
        "runAction",
        "undoExternal",
        "dismissToast",
        "showMergeReady",
        "addToast",
        "reconcile",
      ]
      if (!allowed.includes(method)) throw new Error(`Unknown session command ${method}`)
      const fn = (s as unknown as Record<string, (...a: unknown[]) => unknown>)[method] as (
        ...a: unknown[]
      ) => unknown
      const value = await fn.apply(s, (args.args as unknown[]) ?? [])
      if (method === "saveAs" && typeof value === "string") {
        track()
        const old = String(args.ref)
        const labels = viewers.get(old)
        if (labels) {
          viewers.delete(old)
          viewers.set(value, labels)
        }
      }
      return { value: value ?? null, state: s.state() }
    },
    /** Everything a window's `McpHostApi` needs on open (events only carry changes). */
    mcpState: async () => ({
      connections: connectionInfos(),
      pending: runtime.approvals.pending(),
      paused: runtime.paused(),
    }),
    /** `McpHostApi.clients.pause/resume`: a real pause (calls wait in the runtime). */
    async mcpPause(args) {
      const client = String(args.client)
      if (args.paused === false) runtime.resume(client)
      else runtime.pause(client)
      return { paused: runtime.paused() }
    },
    /**
     * One tool call of an in-app agent (ADR 0014 §5): the same dispatch as MCP clients
     * (validate → authorize with the window's scope → approval → handler → activity) under the
     * agent's own origin. Never throws for tool failures: the envelope comes back.
     */
    async agentCall(args, from) {
      const conn = agentConnection(args.spec as AgentCallSpec, from)
      const out = await conn.call(String(args.name), args.input ?? {})
      return {
        result: out.result,
        ...(out.images ? { images: out.images } : {}),
      }
    },
    /** The window's answer to a forwarded approval (Stop answers deny). */
    async agentApproval(args, from) {
      const p = agentPrompts.get(String(args.id))
      if (!p || p.from !== from) return { ok: false }
      agentPrompts.delete(String(args.id))
      const o = String(args.outcome)
      p.resolve(o === "once" || o === "session" ? (o as ApprovalOutcome) : "deny")
      return { ok: true }
    },
    /** Ends the window's agent connections (all, or `origins`): presence drops them. */
    async agentRelease(args, from) {
      closeAgentsOf(from, Array.isArray(args.origins) ? (args.origins as string[]) : undefined)
      return { ok: true }
    },
    /** The host's docId of `ref` (the agent's `docId` in tool calls), null when not open. */
    agentDocId: async (args) => ({ docId: host.docIdForPath(String(args.ref)) ?? null }),
    /** Undo an agent's op group from the activity log (AgentsController.undoEntry). */
    async agentUndo(args) {
      // Any live connection of that origin: relayed socket/HTTP clients and in-process ones.
      const conn = runtime.connections().find((c) => c.origin === args.origin && !c.closed)
      const docId = host.docIdForPath(String(args.ref))
      if (!conn || !docId) return { ok: false, stale: false }
      const out = await conn.call("kimo_history", {
        docId,
        action: "undo",
        ...(typeof args.undoToken === "string" ? { token: args.undoToken } : {}),
      })
      const r = out.result
      return { ok: r.ok, stale: r.ok ? (r.data as { stale?: boolean }).stale === true : false }
    },
  }
  await listen<Rpc>(HOST_EVENTS.rpc, async ({ from, id, method, args }) => {
    try {
      const h = rpc[method]
      if (!h) throw new Error(`Unknown host method ${method}`)
      const value = await h(args ?? {}, from)
      await bridge.emitTo(from, HOST_EVENTS.rpcReply, { id, ok: true, value })
    } catch (e) {
      await bridge.emitTo(from, HOST_EVENTS.rpcReply, {
        id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  })
  await listen<{ from: string; ref: string; selection: string[] }>(
    HOST_EVENTS.windowState,
    ({ from, ref, selection }) => {
      let m = selections.get(ref)
      if (!m) {
        m = new Map()
        selections.set(ref, m)
      }
      m.delete(from)
      m.set(from, selection)
    },
  )

  // Ready: windows re-attach after a host reload; Rust stops queueing MCP lines.
  await bridge.emit(HOST_EVENTS.ready, { version: options.version })
  if (options.relay !== false)
    await bridge.invoke("kimo_mcp_host_ready", { version: options.version }).catch(() => {})

  return {
    host,
    runtime,
    hub,
    manager,
    relays,
    viewers: (ref) => [...(viewers.get(ref) ?? [])],
    async dispose() {
      for (const key of [...agentConns.keys()]) closeAgent(key)
      for (const r of [...relays.values()]) await r.close()
      runtime.dispose()
      hub.dispose()
      for (const o of offs.splice(0)) o()
      for (const off of stateSubs.values()) off()
      await manager.dispose()
      scene.dispose()
    },
  }
}
