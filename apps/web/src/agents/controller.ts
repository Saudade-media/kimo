/**
 * The window's agents state (ADR 0013 §11, contract `AgentsController`), built over
 * `@kimo/platform`'s `McpHostApi` and, when the window has a document, its `DocStore` (op log →
 * session ops, layer dots, node names). One controller per editor window.
 */
import type { DocStore, LocalOrigin } from "@kimo/editor-state"
import type {
  McpActivityEntry,
  McpApprovalChoice,
  McpApprovalRequest,
  McpClientPolicy,
  McpConnectionInfo,
  McpHostApi,
  McpHostConfigStatus,
  McpHostId,
  McpServerStatus,
} from "@kimo/platform"
import { workAreaIds } from "../canvas/agent-area"
import {
  AGENT_ACTIVITY_LIMIT,
  type AgentChip,
  type AgentsController,
  type AgentsState,
  approvalChoices,
} from "../platform/contract"
import {
  chipIcon,
  clientOf,
  DEFAULT_POLICY,
  type DryRunView,
  dryRunFromApproval,
  presenceLabel,
  type SessionOps,
  sessionOps,
} from "./model"

/** Why an agent's edits are paused (rule "Paused"). */
export interface PausedInfo {
  code: "READ_ONLY" | "DOCUMENT_LOCKED" | "USER"
  summary: string
  time: number
}

/** One chip with everything the chip, popover and canvas need. */
export interface AgentChipView extends AgentChip {
  client: string
  presence: "editing" | "paused" | "waiting"
  text: string
  meta?: string
  connection: McpConnectionInfo
  session: SessionOps
  policy: McpClientPolicy
  pending: number
  paused: PausedInfo | null
}

export interface AgentsViewState extends AgentsState {
  chips: AgentChipView[]
  connections: McpConnectionInfo[]
  policies: Record<string, McpClientPolicy>
  /** Every pending approval, oldest first. */
  queue: McpApprovalRequest[]
  /** Nodes with an agent dot (uncommitted groups of every active client). */
  touched: ReadonlySet<string>
  /** Paused agents by origin. */
  paused: Readonly<Record<string, PausedInfo>>
  /** Activity entries whose undo replay was stale / that were undone here. */
  stale: ReadonlySet<number>
  undone: ReadonlySet<number>
  /** seq → time it was undone here (board 24 h). */
  undoneAt: ReadonlyMap<number, number>
  /** Dry-run ghosts: the oldest pending approval of this file, or the last dryRun call. */
  dryRun: (DryRunView & { source: "approval" | "call"; origin: string }) | null
  dryRunHidden: boolean
  now: number
}

/** Per-origin undo for agent groups (the document host's `kimo_history`; default: the store). */
export interface AgentHistory {
  undo(origin: string, undoToken?: string): Promise<{ ok: boolean; stale: boolean }>
  /** Redo the origin's last undone group (board 24 h "Redo"); absent: no Redo action. */
  redo?(origin: string): Promise<{ ok: boolean; stale: boolean }>
}

export interface AgentsOptions {
  host: McpHostApi
  /** Activity key of the window's file (`sha256(path)[:16]` on desktop). */
  fileId: string
  /** The file's path: approvals naming another path don't draw a dry run here. */
  filePath?: string
  /** The window's docId (connection.docs) for presence. */
  docId?: string
  store?: DocStore | null
  history?: AgentHistory
  /**
   * Undo through `host.history` for `filePath` (default when `filePath` is set). False: undo on
   * `store` (the window's store owns the agents' undo stacks: in-process host, tests).
   */
  hostHistory?: boolean
  /** Select + scroll to nodes (kimo_focus semantics). */
  onFocus?: (nodeIds: string[]) => void
  now?: () => number
  /** Hidden when no client has written in this file for this long (rule: 60 s). */
  presenceTtlMs?: number
}

const PAUSE_CODES = new Set(["READ_ONLY", "DOCUMENT_LOCKED"])

export interface AgentsControllerExt extends AgentsController {
  readonly state: AgentsViewState
  /** The window's store (names, op log), when it has a document. */
  readonly store: DocStore | null
  subscribe(listener: (s: AgentsViewState) => void): () => void
  /** Keep: the current groups of `origin` become committed (dots and op list clear). */
  keep(origin: string): void
  /** Undo all: this origin's groups since the last Keep (guarded replay). */
  undoAll(origin: string): Promise<{ undone: number; stale: number }>
  /** Revert: undo only the top group of `origin` (guarded). */
  undoTop(origin: string): Promise<{ ok: boolean; stale: boolean }>
  /** Undo session: every undoable entry of a session in the activity log. */
  undoSession(origin: string): Promise<{ undone: number; stale: number }>
  /** Redo an undone entry (board 24 h); null when the history cannot redo. */
  redoEntry: ((entry: McpActivityEntry) => Promise<{ ok: boolean; stale: boolean }>) | null
  /** Pause: the client becomes read-only until Resume (policy level `read`). */
  pause(client: string): Promise<void>
  resume(client: string): Promise<void>
  /** Clears a READ_ONLY / DOCUMENT_LOCKED pause (Resume when the lock clears). */
  clearPause(origin: string): void
  setDryRunHidden(hidden: boolean): void
  loadHosts(scope?: "user" | "project"): Promise<McpHostConfigStatus[]>
  refresh(): void
  dispose(): void
}

export function createAgentsController(opts: AgentsOptions): AgentsControllerExt {
  const now = opts.now ?? Date.now
  const ttl = opts.presenceTtlMs ?? 60_000
  const store = opts.store ?? null
  // Per-call undo: the document host's `kimo_history` for this file when the window has one
  // (desktop), else the window's store (in-process host, tests).
  const filePath = opts.filePath
  const history: AgentHistory =
    opts.history ??
    (filePath && opts.hostHistory !== false
      ? { undo: (origin, token) => opts.host.history.undo(filePath, origin, token) }
      : {
          async undo(origin) {
            if (!store) return { ok: false, stale: false }
            const r = store.undo(origin as LocalOrigin)
            return { ok: r.ok, stale: r.stale }
          },
          async redo(origin) {
            if (!store) return { ok: false, stale: false }
            const r = store.redo(origin as LocalOrigin)
            return { ok: r.ok, stale: r.stale }
          },
        })

  let server: McpServerStatus | null = null
  let connections: McpConnectionInfo[] = []
  let policies: Record<string, McpClientPolicy> = {}
  let queue: McpApprovalRequest[] = opts.host.approvals.pending()
  let activity: McpActivityEntry[] = []
  let hosts: McpHostConfigStatus[] = []
  const keepSeq = new Map<string, number>()
  const paused: Record<string, PausedInfo> = {}
  const userPaused = new Set<string>()
  const stale = new Set<number>()
  const undone = new Set<number>()
  const undoneAt = new Map<number, number>()
  let dryRunCall: { origin: string; view: DryRunView; seq: number } | null = null
  let dryRunHidden = false
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<(s: AgentsViewState) => void>()
  /**
   * Agent edits seen on this window's replica (origin `remote:mcp:<client>.<session>`): the
   * replica's op log only has local groups, so the canvas tint, layer dots and presence of a
   * hosted window come from these (cleared by Keep / Undo all).
   */
  const remote = new Map<string, { nodes: Set<string>; last: string[]; at: number }>()

  const policyOf = (client: string): McpClientPolicy => policies[client] ?? DEFAULT_POLICY
  const forThisFile = (r: McpApprovalRequest) =>
    !r.path || !opts.filePath || r.path === opts.filePath

  function lastWrite(origin: string): number {
    for (let i = activity.length - 1; i >= 0; i--) {
      const e = activity[i] as McpActivityEntry
      if (e.origin === origin && (e.kind === "edit" || e.kind === "undo" || e.kind === "redo"))
        return e.time
    }
    return -Infinity
  }

  /** The work area of `ids` (cursor / outline at their union box; see `workAreaIds`). */
  function areaOf(ids: readonly string[]): string[] {
    if (!store) return [...ids]
    return workAreaIds(
      ids.filter((id) => store.hasNode(id)),
      (id) => (store.getNode(id) as { parent?: string | null } | undefined)?.parent ?? null,
    )
  }

  function lastFocus(origin: string): string[] {
    for (let i = activity.length - 1; i >= 0; i--) {
      const e = activity[i] as McpActivityEntry
      if (e.origin === origin && e.nodeIds && e.nodeIds.length > 0 && e.kind !== "denied")
        return [...e.nodeIds]
    }
    return []
  }

  function compute(): AgentsViewState {
    const t = now()
    const log = store?.log() ?? []
    const chips: AgentChipView[] = []
    const touched = new Set<string>()
    let nextExpiry = Infinity
    for (const c of connections) {
      const client = c.identity.client
      const pending = queue.filter(
        (r) => r.client.session === c.identity.session && r.client.client === client,
      )
      const seen = remote.get(c.origin)
      const wrote = Math.max(lastWrite(c.origin), seen?.at ?? -Infinity)
      // docId = d_<fileId>_<epoch> (ADR 0013 §8): any epoch of this file counts.
      const inDoc = c.docs.some(
        (d) => d === opts.docId || (!!opts.fileId && d.startsWith(`d_${opts.fileId}_`)),
      )
      const busy = inDoc && (c.state === "editing" || c.state === "waiting-approval")
      const session = sessionOps(log, c.origin, keepSeq.get(c.origin) ?? -1, store)
      const pause =
        paused[c.origin] ??
        (userPaused.has(client) || c.paused
          ? { code: "USER" as const, summary: "", time: t }
          : null)
      const fresh = t - wrote < ttl
      if (fresh) nextExpiry = Math.min(nextExpiry, wrote + ttl)
      const active =
        pending.length > 0 || fresh || busy || session.groups.length > 0 || pause !== null
      if (!active) continue
      for (const id of session.touched) touched.add(id)
      if (seen) for (const id of seen.nodes) if (!store || store.hasNode(id)) touched.add(id)
      const presence = pending.length > 0 ? "waiting" : pause ? "paused" : "editing"
      const meta =
        presence === "waiting"
          ? String(pending.length)
          : presence === "paused"
            ? pause?.code === "DOCUMENT_LOCKED"
              ? "locked"
              : "read-only"
            : session.rows.length > 0
              ? `${session.rows.length} ${session.rows.length === 1 ? "op" : "ops"}`
              : undefined
      chips.push({
        connectionId: c.connectionId,
        origin: c.origin,
        label: c.identity.label,
        icon: chipIcon(c),
        state: c.state,
        // The work area: a resized page frame never wins over the section inside it.
        focus: areaOf(
          c.focus?.length ? c.focus : seen?.last.length ? seen.last : lastFocus(c.origin),
        ),
        lastActivityAt: Math.max(c.lastActivityAt, wrote === -Infinity ? 0 : wrote),
        client,
        presence,
        text: presenceLabel(c.identity.label, presence, c),
        meta,
        connection: c,
        session,
        policy: policyOf(client),
        pending: pending.length,
        paused: pause,
      })
    }
    clearTimeout(timer)
    if (!disposed && nextExpiry !== Infinity)
      timer = setTimeout(() => emit(), Math.max(50, nextExpiry - t + 10))

    const first = queue[0]
    const prompt = first
      ? {
          request: first,
          queued: queue.length,
          choices: approvalChoices(first),
          remainingMs: Math.max(0, first.expiresAt - t),
        }
      : null
    const approvalForFile = queue.find(forThisFile)
    const dryRun = approvalForFile
      ? {
          ...dryRunFromApproval(approvalForFile, store),
          source: "approval" as const,
          origin: `mcp:${approvalForFile.client.client}.${approvalForFile.client.session}`,
        }
      : dryRunCall
        ? { ...dryRunCall.view, source: "call" as const, origin: dryRunCall.origin }
        : null
    // Keep the set's identity while its content holds (layer rows re-render on identity).
    const prevTouched = (state as AgentsViewState | undefined)?.touched
    const stableTouched =
      prevTouched &&
      prevTouched.size === touched.size &&
      [...touched].every((id) => prevTouched.has(id))
        ? prevTouched
        : touched
    return {
      server,
      chips,
      prompt,
      activity: activity.slice(-AGENT_ACTIVITY_LIMIT),
      hosts,
      connections,
      policies,
      queue,
      touched: stableTouched,
      paused: { ...paused },
      stale: new Set(stale),
      undone: new Set(undone),
      undoneAt: new Map(undoneAt),
      dryRun,
      dryRunHidden,
      now: t,
    }
  }

  let state: AgentsViewState = undefined as unknown as AgentsViewState
  state = compute()
  function emit() {
    if (disposed) return
    state = compute()
    for (const l of listeners) l(state)
  }

  function onEntry(e: McpActivityEntry) {
    activity = [...activity, e].slice(-AGENT_ACTIVITY_LIMIT)
    if ((e.kind === "error" || e.kind === "denied") && e.code && PAUSE_CODES.has(e.code))
      paused[e.origin] = {
        code: e.code as "READ_ONLY" | "DOCUMENT_LOCKED",
        summary: e.summary,
        time: e.time,
      }
    else if (e.kind === "edit" && paused[e.origin]) delete paused[e.origin]
    if (e.kind === "dry-run")
      dryRunCall = {
        origin: e.origin,
        seq: e.seq,
        view: {
          ghosts: (e.nodeIds ?? []).map((id) => ({
            id,
            kind: store && !store.hasNode(id) ? ("insert" as const) : ("update" as const),
            name: (store?.getNode(id) as { name?: string } | undefined)?.name ?? id,
          })),
          counts: { delete: 0, insert: 0, update: e.nodeIds?.length ?? 0 },
        },
      }
    else if (dryRunCall && e.origin === dryRunCall.origin) dryRunCall = null
    if (e.kind === "dry-run") dryRunHidden = false
  }

  const unsubs: (() => void)[] = [
    opts.host.onStatus((s) => {
      server = s
      emit()
    }),
    opts.host.onConnections((c) => {
      connections = c
      // The host is the source of truth for pauses (another window may have resumed).
      for (const client of [...userPaused])
        if (c.some((x) => x.identity.client === client && x.paused === false))
          userPaused.delete(client)
      emit()
    }),
    opts.host.approvals.onRequest((r) => {
      if (!queue.some((q) => q.id === r.id))
        queue = [...queue, r].sort((a, b) => a.requestedAt - b.requestedAt)
      dryRunHidden = false
      emit()
    }),
    opts.host.approvals.onResolved((id) => {
      queue = queue.filter((q) => q.id !== id)
      emit()
    }),
    opts.host.activity.onEntry((fileId, e) => {
      if (fileId !== opts.fileId) return
      onEntry(e)
      emit()
    }),
  ]
  if (store)
    unsubs.push(
      store.onChange((change) => {
        const o = String(change.origin)
        if (o.startsWith("remote:mcp:") && change.nodes.size > 0) {
          const origin = o.slice("remote:".length)
          const r = remote.get(origin) ?? { nodes: new Set<string>(), last: [], at: 0 }
          for (const id of change.nodes) r.nodes.add(id)
          r.last = [...change.nodes].slice(0, 50)
          r.at = now()
          remote.set(origin, r)
        }
        emit()
      }),
    )

  void Promise.all([
    opts.host.status().then(
      (s) => {
        server = s
      },
      () => {},
    ),
    opts.host.connections().then(
      (c) => {
        connections = c
      },
      () => {},
    ),
    opts.host.policies.list().then(
      (p) => {
        policies = p
      },
      () => {},
    ),
    opts.host.activity.list(opts.fileId, AGENT_ACTIVITY_LIMIT).then(
      (list) => {
        const known = new Set(activity.map((e) => e.seq))
        const merged = [...list.filter((e) => !known.has(e.seq)), ...activity].sort(
          (a, b) => a.seq - b.seq,
        )
        activity = []
        for (const e of merged) onEntry(e)
      },
      () => {},
    ),
  ]).then(() => emit())

  async function undoEntryImpl(entry: McpActivityEntry) {
    if (!entry.undoToken) return { ok: false, stale: false }
    const r = await history.undo(entry.origin, entry.undoToken)
    if (r.stale || !r.ok) stale.add(entry.seq)
    else {
      undone.add(entry.seq)
      undoneAt.set(entry.seq, now())
    }
    emit()
    return r
  }

  const controller: AgentsControllerExt = {
    get state() {
      return state
    },
    store,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async answer(id: string, choice: McpApprovalChoice) {
      await opts.host.approvals.respond(id, choice)
      queue = queue.filter((q) => q.id !== id)
      emit()
    },
    async disconnect(connectionId) {
      await opts.host.disconnect(connectionId)
    },
    undoEntry: undoEntryImpl,
    redoEntry: history.redo
      ? async (entry) => {
          const r = await (history.redo as NonNullable<AgentHistory["redo"]>)(entry.origin)
          if (r.ok) {
            undone.delete(entry.seq)
            undoneAt.delete(entry.seq)
          }
          emit()
          return r
        }
      : null,
    focusEntry(entry) {
      if (entry.nodeIds && entry.nodeIds.length > 0) opts.onFocus?.([...entry.nodeIds])
    },
    async setPolicy(client, policy) {
      await opts.host.policies.set(client, policy)
      if (policy) policies = { ...policies, [client]: policy }
      else {
        const { [client]: _gone, ...rest } = policies
        policies = rest
      }
      emit()
    },
    async installHost(host: McpHostId, scope) {
      const row = await opts.host.installer.install(host, scope)
      hosts = hosts.map((h) => (h.host === host ? row : h))
      emit()
      return row
    },
    async removeHost(host: McpHostId, scope) {
      const row = await opts.host.installer.remove(host, scope)
      hosts = hosts.map((h) => (h.host === host ? row : h))
      emit()
      return row
    },
    keep(origin) {
      remote.delete(origin)
      const s = sessionOps(store?.log() ?? [], origin, keepSeq.get(origin) ?? -1, store)
      keepSeq.set(origin, s.after?.seq ?? store?.revision.seq ?? -1)
      emit()
    },
    async undoAll(origin) {
      const s = sessionOps(store?.log() ?? [], origin, keepSeq.get(origin) ?? -1, store)
      // A hosted window's replica has no local groups for the agent: undo its logged calls.
      if (s.groups.length === 0 && remote.has(origin)) {
        const r = await controller.undoSession(origin)
        remote.delete(origin)
        emit()
        return r
      }
      let ok = 0
      let staleCount = 0
      for (let i = 0; i < s.groups.length; i++) {
        const r = await history.undo(origin)
        if (r.ok) ok++
        else if (r.stale) staleCount++
        else break
      }
      if (ok > 0) remote.delete(origin)
      emit()
      return { undone: ok, stale: staleCount }
    },
    async undoTop(origin) {
      const r = await history.undo(origin)
      emit()
      return r
    },
    async undoSession(origin) {
      let ok = 0
      let staleCount = 0
      const entries = activity
        .filter(
          (e) => e.origin === origin && e.undoToken && !undone.has(e.seq) && !stale.has(e.seq),
        )
        .filter((e) => e.kind === "edit" || e.kind === "redo" || e.kind === "undo")
        .sort((a, b) => b.seq - a.seq)
      for (const e of entries) {
        const r = await undoEntryImpl(e)
        if (r.ok && !r.stale) ok++
        else staleCount++
      }
      return { undone: ok, stale: staleCount }
    },
    // A real pause in the host runtime: the client's calls wait until resumed.
    async pause(client) {
      if (userPaused.has(client)) return
      userPaused.add(client)
      emit()
      await opts.host.clients.pause(client)
    },
    async resume(client) {
      userPaused.delete(client)
      for (const o of Object.keys(paused)) if (clientOf(o) === client) delete paused[o]
      emit()
      await opts.host.clients.resume(client)
    },
    clearPause(origin) {
      delete paused[origin]
      emit()
    },
    setDryRunHidden(hidden) {
      dryRunHidden = hidden
      emit()
    },
    async loadHosts(scope = "user") {
      hosts = await opts.host.installer.status(scope)
      emit()
      return hosts
    },
    refresh: emit,
    dispose() {
      disposed = true
      clearTimeout(timer)
      for (const u of unsubs) u()
      listeners.clear()
    },
  }
  return controller
}
