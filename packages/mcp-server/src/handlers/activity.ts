/**
 * Activity log, approvals broker and presence (ADR 0013 §6). Runtime-neutral pieces the host
 * runtime composes; the desktop host persists activity through Tauri
 * (`kimo_mcp_activity_append`), the web host through IndexedDB, headless keeps memory only.
 */
import {
  ACTIVITY_LIMIT,
  type ActivityEntry,
  type AgentPresence,
  APPROVAL_TIMEOUT_MS,
  type ApprovalChoice,
  type ApprovalOutcome,
  type ApprovalRequest,
} from "../policy"

// --- Activity ----------------------------------------------------------------------------------

/** Where entries go. `append` may persist asynchronously; failures never fail a tool call. */
export interface ActivityStore {
  append(fileId: string, entry: ActivityEntry): void | Promise<void>
  list(fileId: string, limit?: number): Promise<ActivityEntry[]>
}

/** In-memory store: last {@link ACTIVITY_LIMIT} per file, seq monotonic per file. */
export function createMemoryActivityStore(): ActivityStore & { files(): string[] } {
  const byFile = new Map<string, ActivityEntry[]>()
  return {
    append(fileId, entry) {
      const l = byFile.get(fileId) ?? []
      l.push(entry)
      if (l.length > ACTIVITY_LIMIT) l.splice(0, l.length - ACTIVITY_LIMIT)
      byFile.set(fileId, l)
    },
    async list(fileId, limit = ACTIVITY_LIMIT) {
      const l = byFile.get(fileId) ?? []
      return l.slice(Math.max(0, l.length - limit))
    },
    files: () => [...byFile.keys()],
  }
}

/** Assigns per-file seq numbers and fans entries out to a store and listeners. */
export class ActivityLog {
  private readonly seqs = new Map<string, number>()
  private readonly listeners = new Set<(fileId: string, e: ActivityEntry) => void>()

  constructor(readonly store: ActivityStore = createMemoryActivityStore()) {}

  record(fileId: string, entry: Omit<ActivityEntry, "seq">): ActivityEntry {
    const seq = (this.seqs.get(fileId) ?? 0) + 1
    this.seqs.set(fileId, seq)
    const full = { seq, ...entry } as ActivityEntry
    try {
      void Promise.resolve(this.store.append(fileId, full)).catch(() => {})
    } catch {
      // Persisting is best effort.
    }
    for (const l of [...this.listeners]) l(fileId, full)
    return full
  }

  /** Continues seq numbering after entries loaded from disk. */
  seed(fileId: string, lastSeq: number): void {
    if ((this.seqs.get(fileId) ?? 0) < lastSeq) this.seqs.set(fileId, lastSeq)
  }

  list(fileId: string, limit?: number): Promise<ActivityEntry[]> {
    return this.store.list(fileId, limit)
  }

  onEntry(listener: (fileId: string, e: ActivityEntry) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

// --- Approvals ---------------------------------------------------------------------------------

interface Pending {
  request: ApprovalRequest
  resolve: (o: ApprovalOutcome) => void
  timer: ReturnType<typeof setTimeout>
  session: string
}

/**
 * The approval prompt queue shown in every window (oldest first). No answer within
 * {@link APPROVAL_TIMEOUT_MS} → `timeout` (PERMISSION_DENIED). Mode `deny` (headless) answers
 * every request `deny` immediately without queueing.
 */
export class ApprovalBroker {
  private readonly queue = new Map<string, Pending>()
  private readonly reqListeners = new Set<(r: ApprovalRequest) => void>()
  private readonly resListeners = new Set<(id: string, o: ApprovalOutcome) => void>()

  constructor(
    readonly mode: "ask" | "deny" = "ask",
    private readonly timeoutMs = APPROVAL_TIMEOUT_MS,
  ) {}

  request(request: ApprovalRequest): Promise<ApprovalOutcome> {
    if (this.mode === "deny") return Promise.resolve("deny")
    return new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => this.finish(request.id, "timeout"), this.timeoutMs)
      this.queue.set(request.id, { request, resolve, timer, session: request.client.session })
      for (const l of [...this.reqListeners]) l(request)
    })
  }

  respond(id: string, choice: ApprovalChoice): boolean {
    if (!this.queue.has(id)) return false
    // "Allow for this session" is never offered for file access or node scope.
    const p = this.queue.get(id) as Pending
    const k = p.request.reason.kind
    const outcome: ApprovalOutcome =
      choice === "session" && (k === "file" || k === "scope") ? "once" : choice
    this.finish(id, outcome)
    return true
  }

  /**
   * Auto-approve turned on (board 34): resolves the matching pending prompts as `auto`, oldest
   * first. Returns how many it approved.
   */
  approveWhere(match: (r: ApprovalRequest) => boolean): number {
    const ids = this.pending()
      .filter(match)
      .map((r) => r.id)
    for (const id of ids) this.finish(id, "auto")
    return ids.length
  }

  /** Resolves every prompt of a connection as `disconnected`. */
  cancelSession(session: string): void {
    for (const [id, p] of this.queue) if (p.session === session) this.finish(id, "disconnected")
  }

  pending(): ApprovalRequest[] {
    return [...this.queue.values()]
      .map((p) => p.request)
      .sort((a, b) => a.requestedAt - b.requestedAt)
  }

  onRequest(l: (r: ApprovalRequest) => void): () => void {
    this.reqListeners.add(l)
    return () => this.reqListeners.delete(l)
  }

  onResolved(l: (id: string, o: ApprovalOutcome) => void): () => void {
    this.resListeners.add(l)
    return () => this.resListeners.delete(l)
  }

  private finish(id: string, outcome: ApprovalOutcome): void {
    const p = this.queue.get(id)
    if (!p) return
    this.queue.delete(id)
    clearTimeout(p.timer)
    p.resolve(outcome)
    for (const l of [...this.resListeners]) l(id, outcome)
  }

  dispose(): void {
    for (const id of [...this.queue.keys()]) this.finish(id, "disconnected")
  }
}

// --- Presence ----------------------------------------------------------------------------------

/** Connected clients for agent chips and the canvas tint. */
export class PresenceTracker {
  private readonly agents = new Map<string, AgentPresence>()
  private readonly listeners = new Set<(list: AgentPresence[]) => void>()

  set(p: AgentPresence): void {
    this.agents.set(p.origin, p)
    this.emit()
  }

  update(origin: string, patch: Partial<AgentPresence>): void {
    const cur = this.agents.get(origin)
    if (!cur) return
    this.agents.set(origin, { ...cur, ...patch })
    this.emit()
  }

  remove(origin: string): void {
    if (this.agents.delete(origin)) this.emit()
  }

  get(origin: string): AgentPresence | undefined {
    return this.agents.get(origin)
  }

  list(): AgentPresence[] {
    return [...this.agents.values()]
  }

  onChange(l: (list: AgentPresence[]) => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private emit(): void {
    const list = this.list()
    for (const l of [...this.listeners]) l(list)
  }
}
