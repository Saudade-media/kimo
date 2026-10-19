/**
 * The MCP host runtime (ADR 0013 §6): one per document host. It turns a client connection
 * into a per-call {@link ToolContext} — identity, origin `mcp:<client>.<session>`, policy,
 * session allowances, approvals, activity — and resolves call targets for `authorize`
 * (canonical paths, open-document check, node scope). Used by the desktop document host (one
 * connection per relayed socket/HTTP client) and by headless `kimo mcp` (one stdio client).
 */
import { type DocStore, type NodeData, releaseClaims } from "@kimo/editor-state"
import type { WireOp } from "../ops"
import {
  type ActivityEntry,
  type AgentPresence,
  type ApprovalOutcome,
  type ApprovalPreview,
  type ApprovalRequest,
  autoApproves,
  type ClientIdentity,
  type ClientPolicy,
  DEFAULT_POLICY,
  emptyAllowances,
  HEADLESS_POLICY,
  originOf,
  type SessionAllowances,
} from "../policy"
import {
  type CallTargets,
  type DispatchOptions,
  type DocumentHost,
  dispatch,
  type HandlerOutput,
  type ToolContext,
  type ToolHandlers,
} from "../runtime"
import { ScriptStream } from "../script/stream"
import type { ApplyStream } from "../stream"
import type { ToolDef } from "../tools/define"
import { ActivityLog, type ActivityStore, ApprovalBroker, PresenceTracker } from "./activity"
import { createToolHandlers } from "./create"
import { streamEngineOf, type ToolHandlerOptions } from "./tools"
import { fileIdOf, randomId } from "./util"

export interface McpHostRuntimeOptions {
  host: DocumentHost
  /** Handlers (default `createToolHandlers(host, handlerOptions)` with presence wired in). */
  handlers?: ToolHandlers
  handlerOptions?: ToolHandlerOptions
  /** Policy per client (Settings › Agents). Default: `clientPolicy`, else DEFAULT/HEADLESS. */
  policyFor?: (identity: ClientIdentity) => ClientPolicy
  clientPolicy?: ClientPolicy
  /** `deny` never prompts (headless). Default: `deny` for headless hosts, else `ask`. */
  approvals?: "ask" | "deny"
  approvalTimeoutMs?: number
  activity?: ActivityStore
  /** Fires for every activity entry (UI feed, desktop persistence). */
  onActivity?: (fileId: string, entry: ActivityEntry) => void
  /** Input validation (pass `validateInput` from `@kimo/mcp-server/server`). Default: none. */
  validate?: DispatchOptions["validate"]
  now?: () => number
}

/** Options of {@link McpHostRuntime.connect}. */
export interface ConnectOptions {
  policy?: ClientPolicy
  cwd?: string
  /**
   * In-app agents (ADR 0014 §5, host RPC `agentCall`): the connection's origin is
   * `agent:kimo.<session>.<n>` instead of `mcp:<client>.<session>`, so undo stacks and
   * attribution stay the agent's own.
   */
  origin?: `agent:${string}`
  /**
   * Replaces the approval broker for this connection: in-app agents forward the request to the
   * window's in-thread card, which waits until answered (no 2-minute timeout).
   */
  requestApproval?: (request: ApprovalRequest) => Promise<ApprovalOutcome>
  /**
   * Replaces the built-in node-scope check for `policy.nodes` (the M6 `checkScope`: moves across
   * the scope edge, scope roots, globals, component origins). Returns out-of-scope ids.
   */
  scope?: (
    def: ToolDef,
    input: Record<string, unknown>,
    store: DocStore,
    policy: ClientPolicy,
  ) => string[]
}

/** One connected client. */
export interface McpConnection {
  readonly identity: ClientIdentity
  readonly origin: `mcp:${string}` | `agent:${string}`
  /** The current policy (in-app agents change it per turn with {@link setPolicy}). */
  readonly policy: ClientPolicy
  /** Replaces the policy for later calls (scope of the next turn); session allowances stay. */
  setPolicy(policy: ClientPolicy): void
  /** The agent's current turn id (null between turns and for MCP clients). */
  readonly turn: string | null
  /**
   * A turn starts (`turn`) or ends (null). Ending one releases the connection's area claims on
   * every document (ADR 0016 item 16); closing the connection does too.
   */
  setTurn(turn: string | null): void
  readonly allowances: SessionAllowances
  /** A fresh per-call context (createKimoMcpServer calls it once per tool call). */
  context(): ToolContext
  /** Target resolution for `authorize` (canonical paths, open docs, node scope). */
  targets: DispatchOptions["targets"]
  /**
   * Validates, authorizes, asks and runs one call (in-process callers and tests). `callId`
   * names the model's tool-use id: a streamed `kimo_apply_ops` commits its provisional group.
   */
  call(name: string, input: unknown, options?: { callId?: string }): Promise<HandlerOutput>
  /**
   * Streamed edits (ADR 0013 §4.7): the provisional stream of a tool-use id, opened on first
   * use (the editor window forwards the model's partial input before the call arrives). Null
   * when the connection is closed. From then on the connection's calls get the streamed limit.
   * `tool`: kimo_apply_ops (default) or kimo_script (raw input through `feed`).
   */
  openStream(callId: string, tool?: string): ApplyStream | null
  /**
   * The stream a call commits: by tool-use id (`_meta["claudecode/toolUseId"]`), else the
   * newest open stream on the same document whose applied ops start the call's ops.
   */
  streamFor(
    callId: string | undefined,
    input: Record<string, unknown>,
    tool?: string,
  ): ApplyStream | undefined
  /** Rolls back and forgets the stream of a call that will never run (stop, retry). */
  closeStream(callId: string, reason?: string): void
  /** True once the caller streamed a call (its calls use STREAM_MAX_NEW_LAYERS). */
  readonly streamed: boolean
  /** Dry-run preview for approval prompts (op kind per node). */
  preview: NonNullable<DispatchOptions["preview"]>
  /** Waits while the client is paused (every call, before authorization). */
  beforeCall: NonNullable<DispatchOptions["beforeCall"]>
  close(): void
  readonly closed: boolean
}

export interface McpHostRuntime {
  readonly host: DocumentHost
  readonly handlers: ToolHandlers
  readonly approvals: ApprovalBroker
  readonly activity: ActivityLog
  readonly presence: PresenceTracker
  /** Opens a connection. `session` defaults to 6 random base-36 chars. */
  connect(
    identity: Omit<ClientIdentity, "session"> & { session?: string },
    options?: ConnectOptions,
  ): McpConnection
  connections(): McpConnection[]
  /**
   * Pauses a client (all its connections): new calls wait before authorization until
   * {@link resume} or disconnect; a call already running finishes.
   */
  pause(client: string): void
  resume(client: string): void
  /**
   * Settings › Agents & MCP changed a client's policy: its live MCP connections (not in-app
   * agents) use it from the next call, and with auto-approve on their pending prompts are
   * approved at once (board 34).
   */
  setClientPolicy(client: string, policy: ClientPolicy): void
  paused(): string[]
  onPausedChange(listener: (clients: string[]) => void): () => void
  dispose(): void
}

/**
 * The existing layers a call reads or edits, from its input alone (the agent cursor's area while
 * the call runs). `ids`: nodes the call edits or reads (update / replace / move / delete …, query
 * `select.ids` / `under`, render `ids`); `parents`: where inserts, copies and instances land.
 * `@key` refs (nodes created in the same call), "root" and IdPaths' instance children are left
 * out: they have no box yet.
 */
export function callTargets(
  name: string,
  input: Record<string, unknown>,
): { ids: string[]; parents: string[] } {
  const ids: string[] = []
  const parents: string[] = []
  const real = (v: unknown): v is string =>
    typeof v === "string" && v !== "" && v !== "root" && !v.startsWith("@") && !v.includes("/")
  const add = (to: string[], v: unknown) => {
    if (real(v) && !to.includes(v) && to.length < 50) to.push(v)
  }
  if (name === "kimo_apply_ops") {
    for (const raw of Array.isArray(input.ops) ? input.ops : []) {
      if (!raw || typeof raw !== "object") continue
      const op = raw as Record<string, unknown>
      if (op.op === "insert" || op.op === "instantiate") add(parents, op.parent)
      else if (op.op === "copy") {
        add(ids, op.id)
        add(parents, op.parent)
      } else {
        for (const k of ["id", "instance", "frame", "node", "component"]) add(ids, op[k])
        if (Array.isArray(op.ids)) for (const v of op.ids) add(ids, v)
        if (op.op === "move") add(parents, op.parent)
      }
    }
    return { ids, parents }
  }
  const sel = input.select
  if (sel && typeof sel === "object") {
    const s = sel as Record<string, unknown>
    if (Array.isArray(s.ids)) for (const v of s.ids) add(ids, v)
    add(ids, s.under)
  }
  if (Array.isArray(input.ids)) for (const v of input.ids) add(ids, v)
  add(ids, input.id)
  if (name === "kimo_find_space") add(parents, input.parent)
  return { ids, parents }
}

/** Short present-tense label of a running call ("Applying 4 ops", "Rendering"). */
export function callLabel(name: string, input: Record<string, unknown>): string {
  if (typeof input.label === "string" && input.label.trim()) return input.label.trim()
  const n = Array.isArray(input.ops) ? input.ops.length : 0
  const file = typeof input.path === "string" ? input.path.split(/[\\/]/).pop() : undefined
  switch (name) {
    case "kimo_apply_ops":
      return input.dryRun === true
        ? `Dry run of ${n} op${n === 1 ? "" : "s"}`
        : `Applying ${n} op${n === 1 ? "" : "s"}`
    case "kimo_render":
      return "Rendering"
    case "kimo_export":
      return "Exporting"
    case "kimo_query":
      return "Reading nodes"
    case "kimo_open":
      return file ? `Opening ${file}` : "Opening a file"
    case "kimo_create":
      return file ? `Creating ${file}` : "Creating a file"
    case "kimo_save":
      return "Saving"
    case "kimo_import":
      return `Importing ${typeof input.kind === "string" ? input.kind : "assets"}`
    case "kimo_history":
      return `${typeof input.action === "string" ? input.action[0]?.toUpperCase() + input.action.slice(1) : "History"}`
    default: {
      const t = name.replace(/^kimo_/, "").replace(/_/g, " ")
      return t ? t[0]?.toUpperCase() + t.slice(1) : name
    }
  }
}

/** Op kind per node of a dry-run result. */
function previewOf(r: {
  data?: unknown
  ops?: Record<string, unknown>[]
  changed?: string[]
}): ApprovalPreview {
  const kinds: Record<string, "insert" | "update" | "delete"> = {}
  for (const o of r.ops ?? []) {
    const id = typeof o.id === "string" ? o.id : null
    if (!id) continue
    const k = o.op === "insert" ? "insert" : o.op === "delete" ? "delete" : "update"
    const cur = kinds[id]
    if (cur === "insert" || cur === "delete") {
      if (k === "delete" && cur === "insert") delete kinds[id]
      else if (k === "delete") kinds[id] = "delete"
      continue
    }
    kinds[id] = k
  }
  const ids = Object.keys(kinds)
  const count = (k: string) => ids.filter((id) => kinds[id] === k).length
  const nodeIds = ids.slice(0, 200)
  return {
    inserted: count("insert"),
    updated: count("update"),
    deleted: count("delete"),
    nodeIds,
    kinds: Object.fromEntries(nodeIds.map((id) => [id, kinds[id] as "insert"])),
  }
}

const STATE_OF: Record<string, AgentPresence["state"]> = {
  kimo_apply_ops: "editing",
  kimo_import: "editing",
  kimo_history: "editing",
  kimo_styles: "editing",
  kimo_save: "editing",
  kimo_render: "rendering",
  kimo_export: "rendering",
}

export function createMcpHostRuntime(options: McpHostRuntimeOptions): McpHostRuntime {
  const { host } = options
  const now = options.now ?? Date.now
  const presence = new PresenceTracker()
  const approvals = new ApprovalBroker(
    options.approvals ?? (host.kind === "headless" ? "deny" : "ask"),
    options.approvalTimeoutMs,
  )
  const activity = new ActivityLog(options.activity)
  if (options.onActivity) activity.onEntry(options.onActivity)
  const handlers =
    options.handlers ??
    createToolHandlers(host, {
      agents: () =>
        presence.list().map((p) => ({
          origin: p.origin,
          label: p.identity.label,
          state: p.state,
          docs: p.docs,
        })),
      ...(options.validate ? { validate: options.validate } : {}),
      ...options.handlerOptions,
    })
  const conns = new Set<McpConnection>()
  const pausedClients = new Set<string>()
  const pauseWaiters = new Set<() => void>()
  const pausedListeners = new Set<(clients: string[]) => void>()
  const setPaused = (client: string, paused: boolean) => {
    if (pausedClients.has(client) === paused) return
    if (paused) pausedClients.add(client)
    else pausedClients.delete(client)
    for (const p of presence.list())
      if (p.identity.client === client) presence.update(p.origin, { paused })
    if (!paused) for (const w of [...pauseWaiters]) w()
    const list = [...pausedClients]
    for (const l of [...pausedListeners]) l(list)
  }
  const basePolicy = (id: ClientIdentity): ClientPolicy =>
    options.policyFor?.(id) ??
    options.clientPolicy ??
    (host.kind === "headless" ? HEADLESS_POLICY : DEFAULT_POLICY)

  const fileOf = (hint: { docId?: string; path?: string }): string => {
    if (hint.docId) {
      const r = host.get(hint.docId)
      if (r.ok) return fileIdOf(r.value.ref.path, r.value.ref.id)
      const known = host.list().find((d) => d.ref.id === hint.docId)
      if (known) return fileIdOf(known.ref.path, known.ref.id)
    }
    if (hint.path) return fileIdOf(hint.path)
    return "global"
  }

  function connect(
    idIn: Omit<ClientIdentity, "session"> & { session?: string },
    opts: ConnectOptions = {},
  ): McpConnection {
    const identity: ClientIdentity = { ...idIn, session: idIn.session ?? randomId(6) }
    const origin = opts.origin ?? originOf(identity)
    let policy = opts.policy ?? basePolicy(identity)
    let turn: string | null = null
    const allowances = emptyAllowances()
    const abort = new AbortController()
    const at = now()
    presence.set({
      identity,
      origin,
      docs: [],
      focus: [],
      state: "idle",
      connectedAt: at,
      lastActivityAt: at,
      policy,
      ...(pausedClients.has(identity.client) ? { paused: true } : {}),
    })
    activity.record("global", {
      time: at,
      origin,
      actor: identity.label,
      kind: "connected",
      summary: `${identity.label} connected${opts.cwd ? ` from ${opts.cwd}` : ""}.`,
    })

    const context = (): ToolContext => {
      const call: { docId?: string; path?: string } = {}
      const streamedNow = streams.size > 0 || everStreamed
      const ctx: ToolContext & { __call: typeof call } = {
        __call: call,
        identity,
        origin,
        policy,
        allowances,
        host,
        requestApproval: async (req) => {
          presence.update(origin, { state: "waiting-approval" })
          const o = opts.requestApproval
            ? await opts.requestApproval(req).catch((): ApprovalOutcome => "deny")
            : await approvals.request(req)
          presence.update(origin, { state: "idle" })
          return o
        },
        recordActivity: (entry) => {
          const hint = entry as Partial<{ docId: string; path: string }>
          const fileId = fileOf({
            docId: hint.docId ?? call.docId,
            path: hint.path ?? call.path,
          })
          const { docId: _d, path: _p, ...clean } = entry as Record<string, unknown>
          activity.record(fileId, clean as Omit<ActivityEntry, "seq">)
          presence.update(origin, { lastActivityAt: now() })
        },
        signal: abort.signal,
        now,
        newId: () => randomId(10),
        ...(streamedNow ? { streamed: true } : {}),
        ...(turn ? { turn } : {}),
      }
      return ctx
    }

    const targets: DispatchOptions["targets"] = async (def, input, ctx) => {
      const call = (ctx as ToolContext & { __call?: { docId?: string; path?: string } }).__call
      const t: CallTargets = {}
      if (typeof input.docId === "string") {
        if (call) call.docId = input.docId
        const r = host.get(input.docId)
        if (r.ok) {
          t.path = r.value.ref.path
          t.pathAlreadyOpen = true
          if (policy.nodes.length) {
            const out = opts.scope
              ? opts.scope(def, input, r.value.store, policy)
              : outOfScope(def, input, r.value.store, policy.nodes)
            if (out.length) t.outOfScope = out
          }
        }
      }
      const fileField =
        def.name === "kimo_export"
          ? input.outDir
          : def.name === "kimo_open" ||
              def.name === "kimo_create" ||
              def.name === "kimo_import" ||
              def.name === "kimo_assets"
            ? input.path
            : undefined
      if (typeof fileField === "string") {
        const path = await host.canonicalPath(fileField)
        if (call) call.path = path
        t.path = def.name === "kimo_export" ? `${path.replace(/\/+$/, "")}/` : path
        t.pathAlreadyOpen = host.list().some((d) => d.ref.path === path)
        if (def.name === "kimo_export") t.pathAlreadyOpen = false
      }
      return t
    }

    const tracked: ToolHandlers = new Proxy(handlers, {
      get(target, name: string | symbol) {
        if (typeof name !== "string") return (target as never)[name]
        const h = target[name as keyof ToolHandlers]
        return async (input: Record<string, unknown>, ctx: ToolContext) => {
          const p = presence.get(origin)
          const docs = p?.docs ?? []
          // The agent cursor moves to the layers this call edits or reads; a batch that only
          // inserts keeps the last area (its new nodes have no box until it lands) unless there
          // is none yet, then it uses the insert parents.
          const tg = callTargets(name, input)
          const focus = tg.ids.length ? tg.ids : p?.focus?.length ? undefined : tg.parents
          presence.update(origin, {
            state: STATE_OF[name] ?? "reading",
            call: { tool: name, label: callLabel(name, input), startedAt: now() },
            lastActivityAt: now(),
            ...(focus?.length ? { focus } : {}),
            ...(typeof input.docId === "string" && !docs.includes(input.docId)
              ? { docs: [...docs, input.docId] }
              : {}),
          })
          try {
            const out = await h(input, ctx)
            const r = out.result
            const patch: Partial<AgentPresence> = {
              state: "idle",
              call: undefined,
              lastActivityAt: now(),
            }
            if (r.ok && r.changed?.length) patch.focus = r.changed.slice(0, 50)
            // Board 31 "Agent cursor": a landed edit moves the pointer to its last added layer.
            if (r.ok && r.pointer) patch.pointer = r.pointer
            if (r.ok && r.doc && !(presence.get(origin)?.docs ?? []).includes(r.doc.id))
              patch.docs = [...(presence.get(origin)?.docs ?? []), r.doc.id]
            presence.update(origin, patch)
            return out
          } catch (e) {
            presence.update(origin, { state: "idle", call: undefined })
            throw e
          }
        }
      },
    })

    const preview: McpConnection["preview"] = async (def, input, ctx) => {
      if (def.name !== "kimo_apply_ops" || typeof input.docId !== "string") return undefined
      // Untracked handlers and no activity: a dry run only feeds the prompt (never a stream's).
      const { stream: _s, ...rest } = ctx
      const quiet: ToolContext = { ...rest, recordActivity: () => {} }
      const out = await handlers.kimo_apply_ops({ ...input, dryRun: true }, quiet)
      if (!out.result.ok) return undefined
      return previewOf(out.result as never)
    }
    const beforeCall: McpConnection["beforeCall"] = async () => {
      while (pausedClients.has(identity.client) && !abort.signal.aborted) {
        await new Promise<void>((resolve) => {
          const done = () => {
            pauseWaiters.delete(done)
            abort.signal.removeEventListener("abort", done)
            resolve()
          }
          pauseWaiters.add(done)
          abort.signal.addEventListener("abort", done)
        })
      }
    }
    // --- Streamed edits (ADR 0013 §4.7) ----------------------------------------------------
    const engine = streamEngineOf(handlers)
    const streams = new Map<string, ApplyStream>()
    let everStreamed = false
    const dispatchOptions = (): DispatchOptions => ({
      validate: options.validate ?? (() => []),
      targets,
      preview,
      beforeCall,
    })
    const openStream = (callId: string, tool = "kimo_apply_ops"): ApplyStream | null => {
      if (conn.closed || !engine || !engine.streams(tool)) return null
      const live = streams.get(callId)
      if (live) return live
      // Bounded: the oldest stream whose call never came is rolled back.
      if (streams.size >= 8) {
        const [oldId, old] = streams.entries().next().value as [string, ApplyStream]
        old.close()
        streams.delete(oldId)
      }
      everStreamed = true
      const s = engine.open({ callId, ctx: context(), dispatch: dispatchOptions(), tool })
      s.onProgress((p) => {
        if (p.state === "open" && p.applied > 0) {
          presence.update(origin, {
            state: "editing",
            lastActivityAt: now(),
            ...(p.pointer ? { pointer: p.pointer } : {}),
            ...(p.changed.length ? { focus: p.changed.slice(0, 50) } : {}),
            call: {
              tool,
              label: p.name ? `Adding ${p.name}` : `Applying ${p.applied} ops`,
              startedAt: presence.get(origin)?.call?.startedAt ?? now(),
            },
          })
        }
      })
      streams.set(callId, s)
      return s
    }
    const streamFor = (
      callId: string | undefined,
      input: Record<string, unknown>,
      tool = "kimo_apply_ops",
    ): ApplyStream | undefined => {
      if (callId) return streams.get(callId)
      // Without the tool-use id only a kimo_apply_ops call can be matched (by its ops prefix).
      if (tool !== "kimo_apply_ops") return undefined
      const ops = Array.isArray(input.ops) ? input.ops : []
      const open = [...streams.values()].reverse().filter((s) => !(s instanceof ScriptStream))
      return open.find((s) => {
        const p = s.progress()
        return p.state !== "rolled-back" && p.state !== "committed" && p.applied <= ops.length
      })
    }
    /** Runs a call with its stream, then closes the stream (rollback unless committed). */
    const runWith = async (
      stream: ApplyStream | undefined,
      run: (ctx: ToolContext) => Promise<HandlerOutput>,
    ): Promise<HandlerOutput> => {
      const ctx = context()
      if (stream) ctx.stream = stream
      try {
        return await run(ctx)
      } finally {
        if (stream) {
          stream.close("The call did not commit the streamed ops.")
          for (const [id, s] of streams) if (s === stream) streams.delete(id)
        }
      }
    }

    const conn: McpConnection = {
      identity,
      origin,
      get policy() {
        return policy
      },
      setPolicy(next) {
        policy = next
        presence.update(origin, { policy: next })
        if (autoApproves(next)) approvals.approveWhere((r) => r.client.session === identity.session)
      },
      get turn() {
        return turn
      },
      setTurn(next) {
        if (next === null || (turn && turn !== next)) releaseClaims(origin)
        turn = next
      },
      allowances,
      context,
      targets,
      preview,
      beforeCall,
      closed: false,
      call: (name, input, o) =>
        runWith(
          name === "kimo_apply_ops" || name === "kimo_script"
            ? streamFor(o?.callId, (input ?? {}) as Record<string, unknown>, name)
            : undefined,
          (ctx) => dispatch(name, input, ctx, tracked, dispatchOptions()),
        ),
      openStream,
      streamFor,
      closeStream(callId, reason) {
        const st = streams.get(callId)
        if (!st) return
        st.close(reason)
        streams.delete(callId)
      },
      get streamed() {
        return everStreamed
      },
      close() {
        if (conn.closed) return
        ;(conn as { closed: boolean }).closed = true
        for (const s of streams.values()) s.close("The connection closed.")
        streams.clear()
        abort.abort()
        approvals.cancelSession(identity.session)
        releaseClaims(origin)
        presence.remove(origin)
        conns.delete(conn)
        activity.record("global", {
          time: now(),
          origin,
          actor: identity.label,
          kind: "disconnected",
          summary: `${identity.label} disconnected.`,
        })
      },
    }
    // MCP servers built per connection should use these presence-tracking handlers.
    ;(conn as McpConnection & { handlers: ToolHandlers }).handlers = tracked
    ;(conn as McpConnection & { runWith: typeof runWith }).runWith = runWith
    conns.add(conn)
    return conn
  }

  return {
    host,
    handlers,
    approvals,
    activity,
    presence,
    connect,
    connections: () => [...conns],
    setClientPolicy(client, next) {
      for (const c of conns)
        if (!c.closed && c.identity.client === client && c.origin.startsWith("mcp:"))
          c.setPolicy(next)
    },
    pause: (client) => setPaused(client, true),
    resume: (client) => setPaused(client, false),
    paused: () => [...pausedClients],
    onPausedChange(l) {
      pausedListeners.add(l)
      return () => pausedListeners.delete(l)
    },
    dispose() {
      for (const w of [...pauseWaiters]) w()
      for (const c of [...conns]) c.close()
      approvals.dispose()
    },
  }
}

/**
 * Runs an MCP `tools/call` of a connection with the stream it commits (for
 * `createKimoMcpServer`): by `_meta["claudecode/toolUseId"]`, else the prefix match.
 */
export function connectionCall(
  conn: McpConnection,
  name: string,
  input: Record<string, unknown>,
  toolUseId: string | undefined,
  run: (ctx: ToolContext) => Promise<HandlerOutput>,
): Promise<HandlerOutput> {
  const runWith = (
    conn as McpConnection & {
      runWith?: (
        s: ApplyStream | undefined,
        r: (ctx: ToolContext) => Promise<HandlerOutput>,
      ) => Promise<HandlerOutput>
    }
  ).runWith
  if (!runWith) return run(conn.context())
  return runWith(
    name === "kimo_apply_ops" || name === "kimo_script"
      ? conn.streamFor(toolUseId, input, name)
      : undefined,
    run,
  )
}

/** Handlers of a connection with presence tracking (for `createKimoMcpServer`). */
export function connectionHandlers(conn: McpConnection): ToolHandlers {
  return (conn as McpConnection & { handlers: ToolHandlers }).handlers
}

/** Node ids an apply/query call touches outside the scope subtrees (M6 spawned agents). */
function outOfScope(
  def: ToolDef,
  input: Record<string, unknown>,
  store: { getNode(id: string): NodeData | undefined },
  scope: readonly string[],
): string[] {
  if (def.name !== "kimo_apply_ops") return []
  const inScope = (id: string): boolean => {
    let cur: string | null | undefined = id.split("/")[0]
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      if (scope.includes(cur)) return true
      seen.add(cur)
      cur = store.getNode(cur)?.parent ?? null
    }
    return false
  }
  const refs: string[] = []
  for (const op of input.ops as WireOp[]) {
    const o = op as Record<string, unknown>
    for (const k of ["id", "instance", "component", "frame", "node"])
      if (typeof o[k] === "string") refs.push(o[k] as string)
    if (typeof o.parent === "string" && o.parent !== "root") refs.push(o.parent)
    if (op.op === "insert" && o.parent === "root") refs.push("root")
    if (Array.isArray(o.ids)) refs.push(...(o.ids as string[]))
  }
  return [...new Set(refs.filter((r) => !r.startsWith("@") && (r === "root" || !inScope(r))))]
}
