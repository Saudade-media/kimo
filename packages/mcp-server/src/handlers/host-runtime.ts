/**
 * The MCP host runtime (ADR 0013 §6): one per document host. It turns a client connection
 * into a per-call {@link ToolContext} — identity, origin `mcp:<client>.<session>`, policy,
 * session allowances, approvals, activity — and resolves call targets for `authorize`
 * (canonical paths, open-document check, node scope). Used by the desktop document host (one
 * connection per relayed socket/HTTP client) and by headless `kimo mcp` (one stdio client).
 */
import type { NodeData } from "@kimo/editor-state"
import type { WireOp } from "../ops"
import {
  type ActivityEntry,
  type AgentPresence,
  type ApprovalPreview,
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
import type { ToolDef } from "../tools/define"
import { ActivityLog, type ActivityStore, ApprovalBroker, PresenceTracker } from "./activity"
import { createToolHandlers } from "./create"
import type { ToolHandlerOptions } from "./tools"
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

/** One connected client. */
export interface McpConnection {
  readonly identity: ClientIdentity
  readonly origin: `mcp:${string}`
  readonly policy: ClientPolicy
  readonly allowances: SessionAllowances
  /** A fresh per-call context (createKimoMcpServer calls it once per tool call). */
  context(): ToolContext
  /** Target resolution for `authorize` (canonical paths, open docs, node scope). */
  targets: DispatchOptions["targets"]
  /** Validates, authorizes, asks and runs one call (in-process callers and tests). */
  call(name: string, input: unknown): Promise<HandlerOutput>
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
    options?: { policy?: ClientPolicy; cwd?: string },
  ): McpConnection
  connections(): McpConnection[]
  /**
   * Pauses a client (all its connections): new calls wait before authorization until
   * {@link resume} or disconnect; a call already running finishes.
   */
  pause(client: string): void
  resume(client: string): void
  paused(): string[]
  onPausedChange(listener: (clients: string[]) => void): () => void
  dispose(): void
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
    opts: { policy?: ClientPolicy; cwd?: string } = {},
  ): McpConnection {
    const identity: ClientIdentity = { ...idIn, session: idIn.session ?? randomId(6) }
    const origin = originOf(identity)
    const policy = opts.policy ?? basePolicy(identity)
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
      const ctx: ToolContext & { __call: typeof call } = {
        __call: call,
        identity,
        origin,
        policy,
        allowances,
        host,
        requestApproval: async (req) => {
          presence.update(origin, { state: "waiting-approval" })
          const o = await approvals.request(req)
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
            const out = outOfScope(def, input, r.value.store, policy.nodes)
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
      get(target, name: string) {
        const h = target[name as keyof ToolHandlers]
        return async (input: Record<string, unknown>, ctx: ToolContext) => {
          const p = presence.get(origin)
          const docs = p?.docs ?? []
          presence.update(origin, {
            state: STATE_OF[name] ?? "reading",
            call: { tool: name, label: callLabel(name, input), startedAt: now() },
            lastActivityAt: now(),
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
      // Untracked handlers and no activity: a dry run only feeds the prompt.
      const quiet: ToolContext = { ...ctx, recordActivity: () => {} }
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
    const conn: McpConnection = {
      identity,
      origin,
      policy,
      allowances,
      context,
      targets,
      preview,
      beforeCall,
      closed: false,
      call: (name, input) =>
        dispatch(name, input, context(), tracked, {
          validate: options.validate ?? (() => []),
          targets,
          preview,
          beforeCall,
        }),
      close() {
        if (conn.closed) return
        ;(conn as { closed: boolean }).closed = true
        abort.abort()
        approvals.cancelSession(identity.session)
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
