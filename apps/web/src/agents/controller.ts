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
  McpHistoryResult,
  McpHostApi,
  McpHostConfigStatus,
  McpHostId,
  McpServerStatus,
} from "@kimo/platform"
import { workAreaIds } from "../canvas/agent-area"
import { failureText } from "../editor/errors"
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
  hostedSessionOps,
  presenceLabel,
  presenceMeta,
  type SessionOps,
  sessionOps,
} from "./model"

/** Why an agent's edits are paused (rule "Paused"). */
interface PausedInfo {
  code: "READ_ONLY" | "DOCUMENT_LOCKED" | "USER"
  summary: string
  time: number
}

/** One chip with everything the chip, popover and canvas need. */
export interface AgentChipView extends AgentChip {
  client: string
  presence: "editing" | "paused" | "waiting"
  /** Board 48 §1 E: the avatar's Tooltip, "Claude Code is editing Hero". */
  text: string
  /** Board 48 §2: the people popover row's status, "Editing Hero · 3 changes". */
  meta: string
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
  /**
   * Undone entries that Redo can bring back now: the last one undone of each agent (the top of
   * its redo stack). An agent's new edit clears its redo stack.
   */
  redoable: ReadonlySet<number>
  /** Dry-run ghosts: the oldest pending approval of this file, or the last dryRun call. */
  dryRun: (DryRunView & { source: "approval" | "call"; origin: string }) | null
  dryRunHidden: boolean
  /** Activity row hover: every target of the entry, outlined in $agent on the canvas layer. */
  highlight: readonly string[]
  now: number
}

/** Per-origin undo for agent groups (the document host's `kimo_history`; default: the store). */
interface AgentHistory {
  undo(origin: string, undoToken?: string): Promise<McpHistoryResult>
  /**
   * Redo the origin's last undone group (board 24 h "Redo"); absent: no Redo action. With
   * `undoToken`, only that group (`conflict` when it is not the last one undone).
   */
  redo?(origin: string, undoToken?: string): Promise<McpHistoryResult>
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
  /**
   * A user action failed (pause, resume, undo, approval answer, disconnect): the editor shows it
   * as Toast/Danger ("Couldn't …" + the cause). The state is re-read before this is called.
   */
  onError?: (notice: AgentsNotice) => void
}

/** A failed agent action, for Toast/Danger (board 37 A5 `ra5wy`). */
export interface AgentsNotice {
  text: string
  action?: { label: string; run: () => void }
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
  undoTop(origin: string): Promise<McpHistoryResult>
  /** Undo session: every undoable entry of a session in the activity log. */
  undoSession(origin: string): Promise<{ undone: number; stale: number }>
  /** Redo an undone entry (board 24 h); null when the history cannot redo. */
  redoEntry: ((entry: McpActivityEntry) => Promise<McpHistoryResult>) | null
  /** Pause: the client's calls wait until Resume (a host flag, before authorization). */
  pause(client: string): Promise<void>
  resume(client: string): Promise<void>
  /** Clears a READ_ONLY / DOCUMENT_LOCKED pause (Resume when the lock clears). */
  clearPause(origin: string): void
  setDryRunHidden(hidden: boolean): void
  /** Outline these nodes on the canvas layer (activity row hover); null clears. */
  setHighlight(nodeIds: readonly string[] | null): void
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
      ? {
          undo: (origin, token) => opts.host.history.undo(filePath, origin, token),
          // Desktop: the host's agentRedo (kimo_history redo as that origin), when it has one.
          ...(opts.host.history.redo
            ? {
                redo: (origin: string, token?: string) =>
                  (opts.host.history.redo as NonNullable<McpHostApi["history"]["redo"]>)(
                    filePath,
                    origin,
                    token,
                  ),
              }
            : {}),
        }
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
  /** Hosted windows: the activity seq of the last Keep per origin (rows after it are listed). */
  const keepActivitySeq = new Map<string, number>()
  const paused: Record<string, PausedInfo> = {}
  const userPaused = new Set<string>()
  const stale = new Set<number>()
  const undone = new Set<number>()
  const undoneAt = new Map<number, number>()
  /** Per origin: the seqs undone here, in undo order (its redo stack; last = next Redo). */
  const redoStacks = new Map<string, number[]>()
  const redoableNow = () => new Set([...redoStacks.values()].flatMap((st) => st.slice(-1)))
  let dryRunCall: { origin: string; view: DryRunView; seq: number } | null = null
  let dryRunHidden = false
  let highlight: readonly string[] = []
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
  const labelOf = (originOrClient: string): string => {
    const c = connections.find(
      (x) => x.origin === originOrClient || x.identity.client === originOrClient,
    )
    return c?.identity.label ?? "The agent"
  }
  function report(text: string, action?: AgentsNotice["action"]) {
    if (opts.onError) opts.onError(action ? { text, action } : { text })
    else console.error(text)
  }
  /** Undo all / Undo session: the edits that could not be undone (stale or refused). */
  function reportUndo(origin: string, ok: number, failed: number) {
    if (failed === 0) return
    const total = ok + failed
    report(
      `Couldn't undo ${failed === total ? (total === 1 ? "the change" : `${total} changes`) : `${failed} of ${total} changes`}. The layers changed after the agent's edit, or ${labelOf(origin)} disconnected.`,
    )
  }
  // Undo through the document host: the agent's groups are not in this window's op log.
  const hostedHistory = !opts.history && !!filePath && opts.hostHistory !== false

  /**
   * The origin's session since the last Keep: its groups in this window's op log, or (a hosted
   * window, whose replica only sees `remote:mcp:…` changes) its undoable activity entries.
   */
  function sessionOf(origin: string): SessionOps {
    const local = sessionOps(store?.log() ?? [], origin, keepSeq.get(origin) ?? -1, store)
    if (local.groups.length > 0 || !(hostedHistory || remote.has(origin))) return local
    return hostedSessionOps(
      activity,
      origin,
      keepActivitySeq.get(origin) ?? -1,
      (seq) => undone.has(seq) || stale.has(seq),
      store,
    )
  }
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

  /** A layer's name for the status lines ("editing Hero"); null when unnamed or gone. */
  function nameOf(id: string | undefined): string | null {
    if (id === undefined || !store) return null
    const name = (store.getNode(id) as { name?: unknown } | undefined)?.name
    return typeof name === "string" && name.trim() ? name : null
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
      const session = sessionOf(c.origin)
      const pause =
        paused[c.origin] ??
        (userPaused.has(client) || c.paused
          ? { code: "USER" as const, summary: "", time: t }
          : null)
      const fresh = t - wrote < ttl
      if (fresh) nextExpiry = Math.min(nextExpiry, wrote + ttl)
      const active =
        pending.length > 0 ||
        fresh ||
        busy ||
        session.groups.length > 0 ||
        session.entries.length > 0 ||
        pause !== null
      if (!active) continue
      for (const id of session.touched) touched.add(id)
      if (seen) for (const id of seen.nodes) if (!store || store.hasNode(id)) touched.add(id)
      const presence = pending.length > 0 ? "waiting" : pause ? "paused" : "editing"
      // The work area: a resized page frame never wins over the section inside it.
      const focus = areaOf(
        c.focus?.length ? c.focus : seen?.last.length ? seen.last : lastFocus(c.origin),
      )
      const focusName = nameOf(focus[0])
      chips.push({
        connectionId: c.connectionId,
        origin: c.origin,
        label: c.identity.label,
        icon: chipIcon(c),
        state: c.state,
        focus,
        // Board 31 "Agent cursor": the last layer its latest landed edit added.
        ...(c.pointer && (!store || store.hasNode(c.pointer)) ? { pointer: c.pointer } : {}),
        lastActivityAt: Math.max(c.lastActivityAt, wrote === -Infinity ? 0 : wrote),
        client,
        presence,
        text: presenceLabel(c.identity.label, presence, c, focusName),
        meta: presenceMeta(presence, c, focusName, session.rows.length),
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
      redoable: redoableNow(),
      dryRun,
      dryRunHidden,
      highlight,
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
    // A new edit clears the agent's redo stack (the history drops it too).
    if (e.kind === "edit") redoStacks.delete(e.origin)
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

  // Board 34: a policy changed in Settings (any window): presence shows auto-approve at once.
  unsubs.push(
    opts.host.policies.onChange?.((client, policy) => {
      if (policy) policies = { ...policies, [client]: policy }
      else {
        const { [client]: _gone, ...rest } = policies
        policies = rest
      }
      emit()
    }) ?? (() => {}),
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

  /** Guarded undo of one logged edit; `quiet` leaves the report to a batch caller. */
  async function undoEntryImpl(entry: McpActivityEntry, quiet = false) {
    if (!entry.undoToken) return { ok: false, stale: false }
    const what = entry.label ? `“${entry.label}”` : "the change"
    let r: McpHistoryResult
    try {
      r = await history.undo(entry.origin, entry.undoToken)
    } catch (e) {
      emit()
      if (!quiet) report(failureText(`undo ${what}`, e))
      return { ok: false, stale: false }
    }
    // Not on top: newer edits of the same agent come first. The entry stays undoable.
    if (r.conflict) {
      emit()
      if (!quiet)
        report(`Couldn't undo ${what}. Undo the newer edits from ${labelOf(entry.origin)} first.`)
      return r
    }
    // Refused or stale: the entry has nothing left to undo here (its row's Undo is disabled).
    if (r.stale || !r.ok) stale.add(entry.seq)
    else {
      undone.add(entry.seq)
      undoneAt.set(entry.seq, now())
      redoStacks.set(entry.origin, [...(redoStacks.get(entry.origin) ?? []), entry.seq])
    }
    emit()
    if (quiet || (r.ok && !r.stale)) return r
    // A hosted window's refusal without an answer means the host had no live connection for it.
    report(
      r.stale
        ? `Couldn't undo ${what}. The layers changed after this edit.`
        : hostedHistory && r.message === undefined
          ? `Couldn't undo ${what}. ${labelOf(entry.origin)} is no longer connected to this file.`
          : `Couldn't undo ${what}. The undo history no longer has this edit.`,
    )
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
      try {
        await opts.host.approvals.respond(id, choice)
      } catch (e) {
        // The request may have expired or been answered elsewhere: the host's queue is the truth.
        queue = opts.host.approvals.pending()
        emit()
        report(failureText("send your answer", e))
        return
      }
      queue = queue.filter((q) => q.id !== id)
      emit()
    },
    async disconnect(connectionId) {
      try {
        await opts.host.disconnect(connectionId)
      } catch (e) {
        const c = connections.find((x) => x.connectionId === connectionId)
        report(failureText(`disconnect ${c?.identity.label ?? "the agent"}`, e))
      }
    },
    undoEntry: (entry) => undoEntryImpl(entry),
    redoEntry: history.redo
      ? async (entry) => {
          const what = entry.label ? `“${entry.label}”` : "the change"
          // Redo replays the agent's last undone group: only that entry can redo.
          const st = redoStacks.get(entry.origin) ?? []
          if (st[st.length - 1] !== entry.seq) {
            report(
              st.length
                ? `Couldn't redo ${what}. Redo the edit you undid last from ${labelOf(entry.origin)} first.`
                : `Couldn't redo ${what}. ${labelOf(entry.origin)} edited the file after the undo.`,
            )
            return { ok: false, stale: false, conflict: true }
          }
          let r: McpHistoryResult
          try {
            r = await (history.redo as NonNullable<AgentHistory["redo"]>)(
              entry.origin,
              entry.undoToken,
            )
          } catch (e) {
            emit()
            report(failureText(`redo ${what}`, e))
            return { ok: false, stale: false }
          }
          if (r.ok || r.stale) redoStacks.set(entry.origin, st.slice(0, -1))
          if (r.ok && !r.stale) {
            undone.delete(entry.seq)
            undoneAt.delete(entry.seq)
          } else
            report(
              r.stale
                ? `Couldn't redo ${what}. The layers changed after the undo.`
                : r.conflict
                  ? `Couldn't redo ${what}. Redo the edit you undid last from ${labelOf(entry.origin)} first.`
                  : hostedHistory && r.message === undefined
                    ? `Couldn't redo ${what}. ${labelOf(entry.origin)} is no longer connected to this file.`
                    : `Couldn't redo ${what}. The undo history no longer has this edit.`,
            )
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
      const seqs = activity.filter((e) => e.origin === origin).map((e) => e.seq)
      if (seqs.length > 0) keepActivitySeq.set(origin, Math.max(...seqs))
      emit()
    },
    async undoAll(origin) {
      const s = sessionOf(origin)
      // A hosted window: undo the session's logged calls, newest first (guarded replay).
      if (s.groups.length === 0) {
        let ok = 0
        let staleCount = 0
        for (const e of [...s.entries].reverse()) {
          const r = await undoEntryImpl(e, true)
          if (r.ok && !r.stale) ok++
          else staleCount++
        }
        if (ok > 0) remote.delete(origin)
        emit()
        reportUndo(origin, ok, staleCount)
        return { undone: ok, stale: staleCount }
      }
      let ok = 0
      let staleCount = 0
      try {
        for (let i = 0; i < s.groups.length; i++) {
          const r = await history.undo(origin)
          if (r.ok) ok++
          else if (r.stale) staleCount++
          else break
        }
      } catch (e) {
        emit()
        report(failureText("undo the agent's changes", e))
        return { undone: ok, stale: staleCount }
      }
      if (ok > 0) remote.delete(origin)
      emit()
      reportUndo(origin, ok, s.groups.length - ok)
      return { undone: ok, stale: staleCount }
    },
    async undoTop(origin) {
      const s = sessionOf(origin)
      const top = s.groups.length === 0 ? s.entries[s.entries.length - 1] : undefined
      if (top) return undoEntryImpl(top)
      let r: { ok: boolean; stale: boolean }
      try {
        r = await history.undo(origin)
      } catch (e) {
        emit()
        report(failureText("revert the change", e))
        return { ok: false, stale: false }
      }
      emit()
      if (!r.ok) report("Couldn't revert the change. The layers changed after the agent's edit.")
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
        const r = await undoEntryImpl(e, true)
        if (r.ok && !r.stale) ok++
        else staleCount++
      }
      reportUndo(origin, ok, staleCount)
      return { undone: ok, stale: staleCount }
    },
    // A real pause in the host runtime: the client's calls wait until resumed. Optimistic:
    // rolled back (and reported) when the host refuses or is down.
    async pause(client) {
      if (userPaused.has(client)) return
      userPaused.add(client)
      emit()
      try {
        await opts.host.clients.pause(client)
      } catch (e) {
        userPaused.delete(client)
        emit()
        report(failureText(`pause ${labelOf(client)}`, e), {
          label: "Retry",
          run: () => void controller.pause(client),
        })
      }
    },
    async resume(client) {
      const wasUser = userPaused.has(client)
      const cleared: Record<string, PausedInfo> = {}
      userPaused.delete(client)
      for (const o of Object.keys(paused))
        if (clientOf(o) === client) {
          cleared[o] = paused[o] as PausedInfo
          delete paused[o]
        }
      emit()
      try {
        await opts.host.clients.resume(client)
      } catch (e) {
        if (wasUser) userPaused.add(client)
        Object.assign(paused, cleared)
        emit()
        report(failureText(`resume ${labelOf(client)}`, e), {
          label: "Retry",
          run: () => void controller.resume(client),
        })
      }
    },
    clearPause(origin) {
      delete paused[origin]
      emit()
    },
    setDryRunHidden(hidden) {
      dryRunHidden = hidden
      emit()
    },
    setHighlight(nodeIds) {
      const next = nodeIds ?? []
      if (next.length === 0 && highlight.length === 0) return
      highlight = next
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
