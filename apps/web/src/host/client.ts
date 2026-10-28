/**
 * The editor window's side of the document host (ADR 0002 §2): RPC to the host, the window's
 * Yjs sync transport, and {@link HostedDocumentSession} — a `FileDocumentSession` whose store is
 * a replica of the host's (via `WindowSyncProvider`) and whose state, saves and banner actions
 * live in the host. Untitled documents stay local to the window (they have no path, so no agent
 * can target them).
 */
import type { DocStore } from "@kimo/editor-state"
import type { FileRef, McpHistoryResult } from "@kimo/platform"
import { type HostSyncMessage, type HostSyncTransport, WindowSyncProvider } from "@kimo/sync"
import type { OpenOptions, SessionState } from "../platform/contract"
import { FileDocumentSession, type FileSessionManager } from "../platform/session"
import { HOST_EVENTS, HOST_LABEL, type HostBridge } from "./bridge"

type Reply = { id: string; ok: boolean; value?: unknown; error?: string }

/** An approval the document host forwards for one of this window's in-app agents. */
export interface HostAgentApproval {
  id: string
  origin: string
  request: unknown
}

/** A `kimo_focus` request for this window. */
export interface HostFocusRequest {
  ref: string
  ids: string[]
  select: boolean
  zoom: "fit" | "keep" | "100"
}

let rpcSeq = 0

/** {@link HostClient.connect} re-pings this often until the host answers. */
const PING_RETRY_MS = 150

export class HostClient {
  private readonly pending = new Map<
    string,
    { resolve(v: unknown): void; reject(e: Error): void; untimed?: boolean }
  >()
  private readonly agentApprovalHandlers = new Map<
    string,
    (a: HostAgentApproval) => Promise<string>
  >()
  private readonly stateListeners = new Map<string, Set<(s: SessionState) => void>>()
  private readonly focusListeners = new Set<(f: HostFocusRequest) => void>()
  private readonly readyListeners = new Set<() => void>()
  private readonly syncListeners = new Set<(m: HostSyncMessage) => void>()
  private readonly shareListeners = new Map<string, Set<(snapshot: unknown) => void>>()
  private readonly agentStopListeners = new Set<(origin: string) => void>()
  private readonly offs: (() => void)[] = []

  private constructor(readonly bridge: HostBridge) {}

  /**
   * Connects to the host; null when no host answers within `timeoutMs` (old shell, web).
   *
   * The host webview starts in parallel with the editor windows, and an event emitted before the
   * host listens is dropped (Tauri events are not queued). So the ping is repeated every
   * {@link PING_RETRY_MS} and again as soon as the host announces `kimo://host-ready`, instead of
   * one ping that would wait out the whole timeout when it raced the host's startup.
   */
  static async connect(bridge: HostBridge, timeoutMs = 3000): Promise<HostClient | null> {
    const c = new HostClient(bridge)
    await c.install()
    const deadline = Date.now() + timeoutMs
    const answered = await new Promise<boolean>((resolve) => {
      let done = false
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        clearInterval(retry)
        clearTimeout(expire)
        offReady()
        resolve(ok)
      }
      const ping = () => {
        if (done) return
        const left = Math.max(1, deadline - Date.now())
        void c.call("ping", {}, left).then(
          () => finish(true),
          () => {},
        )
      }
      const offReady = c.onReady(ping)
      const retry = setInterval(ping, PING_RETRY_MS)
      const expire = setTimeout(() => finish(false), timeoutMs)
      ping()
    })
    if (answered) return c
    c.dispose()
    return null
  }

  private async install(): Promise<void> {
    const b = this.bridge
    this.offs.push(
      await b.listen<Reply>(HOST_EVENTS.rpcReply, (r) => {
        const p = this.pending.get(r.id)
        if (!p) return
        this.pending.delete(r.id)
        if (r.ok) p.resolve(r.value)
        else p.reject(new Error(r.error ?? "host error"))
      }),
      await b.listen<{ ref: string; state: SessionState }>(
        HOST_EVENTS.sessionState,
        ({ ref, state }) => {
          for (const l of [...(this.stateListeners.get(ref) ?? [])]) l(state)
        },
      ),
      await b.listen<HostFocusRequest>(HOST_EVENTS.focus, (f) => {
        for (const l of [...this.focusListeners]) l(f)
      }),
      await b.listen<{ ref: string; snapshot: unknown }>(HOST_EVENTS.share, ({ ref, snapshot }) => {
        for (const l of [...(this.shareListeners.get(ref) ?? [])]) l(snapshot)
      }),
      await b.listen<{ origin: string }>(HOST_EVENTS.agentStop, ({ origin }) => {
        for (const l of [...this.agentStopListeners]) l(origin)
      }),
      await b.listen<{ from: string; msg: HostSyncMessage }>(HOST_EVENTS.sync, ({ msg }) => {
        for (const l of [...this.syncListeners]) l(msg)
      }),
      await b.listen(HOST_EVENTS.ready, () => {
        // Calls without a timeout (agent calls waiting on an approval) died with the old host.
        for (const [id, p] of [...this.pending])
          if (p.untimed) {
            this.pending.delete(id)
            p.reject(new Error("the document host restarted"))
          }
        for (const l of [...this.readyListeners]) l()
      }),
      await b.listen<HostAgentApproval>(HOST_EVENTS.agentApproval, (a) => {
        const h = this.agentApprovalHandlers.get(a.origin)
        const answer = h ? h(a).catch(() => "deny") : Promise.resolve("deny")
        void answer.then((outcome) =>
          this.call("agentApproval", { id: a.id, outcome }).catch(() => {}),
        )
      }),
    )
  }

  /** `timeoutMs` = Infinity: no timeout (rejected only when the host restarts or on dispose). */
  call<T = unknown>(method: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    const id = `${this.bridge.label}:${++rpcSeq}`
    return new Promise<T>((resolve, reject) => {
      const untimed = !Number.isFinite(timeoutMs)
      const timer = untimed
        ? undefined
        : setTimeout(() => {
            this.pending.delete(id)
            reject(new Error(`document host did not answer ${method}`))
          }, timeoutMs)
      this.pending.set(id, {
        ...(untimed ? { untimed } : {}),
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v as T)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      void this.bridge
        .emitTo(HOST_LABEL, HOST_EVENTS.rpc, { from: this.bridge.label, id, method, args })
        .catch((e: unknown) => {
          this.pending.delete(id)
          clearTimeout(timer)
          reject(e instanceof Error ? e : new Error(String(e)))
        })
    })
  }

  /** The window's sync transport to the host. */
  syncTransport(): HostSyncTransport {
    return {
      send: (msg) =>
        void this.bridge.emitTo(HOST_LABEL, HOST_EVENTS.sync, { from: this.bridge.label, msg }),
      onMessage: (l) => {
        this.syncListeners.add(l)
        return () => this.syncListeners.delete(l)
      },
    }
  }

  onSessionState(ref: string, l: (s: SessionState) => void): () => void {
    let set = this.stateListeners.get(ref)
    if (!set) {
      set = new Set()
      this.stateListeners.set(ref, set)
    }
    set.add(l)
    return () => set.delete(l)
  }

  /** Multiplayer share snapshots of `ref` the host pushes (after `mp.watch`). */
  onShare(ref: string, l: (snapshot: unknown) => void): () => void {
    let set = this.shareListeners.get(ref)
    if (!set) {
      set = new Set()
      this.shareListeners.set(ref, set)
    }
    set.add(l)
    return () => {
      set.delete(l)
      if (set.size === 0) this.shareListeners.delete(ref)
    }
  }

  /** A person chose Stop on one of this window's paused agents (`origin`): end its turn. */
  onAgentStop(l: (origin: string) => void): () => void {
    this.agentStopListeners.add(l)
    return () => this.agentStopListeners.delete(l)
  }

  /** `kimo_focus` requests for documents this window shows (the editor selects / zooms). */
  onFocus(l: (f: HostFocusRequest) => void): () => void {
    this.focusListeners.add(l)
    return () => this.focusListeners.delete(l)
  }

  /** The host (re)started. */
  onReady(l: () => void): () => void {
    this.readyListeners.add(l)
    return () => this.readyListeners.delete(l)
  }

  /** Reports the window's selection (kimo_get_state `selection`). */
  reportSelection(ref: string, selection: readonly string[]): void {
    void this.bridge.emitTo(HOST_LABEL, HOST_EVENTS.windowState, {
      from: this.bridge.label,
      ref,
      selection: [...selection],
    })
  }

  /**
   * Answers approvals the host forwards for the in-app agent `origin` (its in-thread card).
   * The handler resolves with the outcome (`deny`, `once`, `session`).
   */
  onAgentApproval(origin: string, handler: (a: HostAgentApproval) => Promise<string>): () => void {
    this.agentApprovalHandlers.set(origin, handler)
    return () => {
      if (this.agentApprovalHandlers.get(origin) === handler)
        this.agentApprovalHandlers.delete(origin)
    }
  }

  /** Undo an agent's op group (AgentsController.undoEntry). */
  agentUndo(ref: string, origin: string, undoToken?: string): Promise<McpHistoryResult> {
    return this.call("agentUndo", { ref, origin, ...(undoToken ? { undoToken } : {}) })
  }

  /** Redo an agent's undone op group (AgentsController.redoEntry); `undoToken`: that group. */
  agentRedo(ref: string, origin: string, undoToken?: string): Promise<McpHistoryResult> {
    return this.call("agentRedo", { ref, origin, ...(undoToken ? { undoToken } : {}) })
  }

  dispose(): void {
    for (const o of this.offs.splice(0)) o()
    for (const p of this.pending.values()) p.reject(new Error("disposed"))
    this.pending.clear()
  }
}

type Listener = (state: SessionState) => void

/** A session whose authority is the document host. */
export class HostedDocumentSession extends FileDocumentSession {
  hostSync: WindowSyncProvider | null = null
  private mirrored: SessionState | null = null
  private readonly hostListeners = new Set<Listener>()
  private hostOffs: (() => void)[] = []
  private local = false

  constructor(
    ref: FileRef,
    manager: FileSessionManager,
    store: DocStore,
    readonly client: HostClient,
  ) {
    super(ref, manager, store)
  }

  /** True when the document host is this session's authority (not untitled, attached). */
  get hosted(): boolean {
    return !this.local && this.hostSync !== null
  }

  override async init(options: OpenOptions = {}): Promise<void> {
    if (this.untitled) {
      this.local = true
      return super.init(options)
    }
    try {
      const r = await this.client.call<{ state: SessionState }>("open", { ref: this.ref, options })
      this.hostOffs.push(
        this.client.onSessionState(this.ref, (s) => this.mirror(s)),
        this.client.onReady(() => void this.reattach()),
      )
      this.mirror(r.state, false)
      if (r.state.phase !== "failed-load") await this.attachSync()
    } catch (e) {
      this.mirror({
        ref: this.ref,
        fileName: this.fileName,
        phase: "failed-load",
        saveStatus: { kind: "read-only", cause: "failed-load" },
        banner: null,
        toasts: [],
        consent: null,
        branchLabel: null,
        git: null,
        conflicts: null,
        unsavedEdits: 0,
      })
      console.warn("Kimo: the document host could not open", this.ref, e)
    }
    this.emitHosted()
  }

  private async attachSync(): Promise<void> {
    await this.hostSync?.detach()
    const p = new WindowSyncProvider({ transport: this.client.syncTransport(), doc: this.ref })
    this.hostSync = p
    await p.attach(this.store)
    // The initial state is not an undoable edit of this window.
    this.store.clearHistory("user")
  }

  /** After a host reload: open again and resync (the replica keeps unsent edits). */
  private async reattach(): Promise<void> {
    if (this.local) return
    try {
      const r = await this.client.call<{ state: SessionState }>("open", { ref: this.ref })
      this.mirror(r.state)
      if (r.state.phase !== "failed-load") await this.attachSync()
    } catch {
      // The next host-ready retries.
    }
  }

  private mirror(state: SessionState, emit = true): void {
    this.mirrored = state
    const ro = state.phase === "read-only" || state.phase === "failed-load"
    this.store.setReadOnly(ro ? "Read-only" : null)
    const mgr = this.manager
    if (state.conflicts && !this.conflicts && mgr.createConflictSession)
      this.conflicts = mgr.createConflictSession(this)
    else if (!state.conflicts && this.conflicts) {
      ;(this.conflicts as { destroy?: () => void }).destroy?.()
      this.conflicts = null
    }
    if (emit) this.emitHosted()
  }

  private emitHosted(): void {
    const s = this.state()
    for (const l of [...this.hostListeners]) l(s)
  }

  override state(): SessionState {
    if (this.local || !this.mirrored) return super.state()
    return this.mirrored
  }

  override subscribe(listener: Listener): () => void {
    if (this.local) return super.subscribe(listener)
    this.hostListeners.add(listener)
    return () => {
      this.hostListeners.delete(listener)
    }
  }

  private async command(method: string, ...args: unknown[]): Promise<unknown> {
    const r = await this.client.call<{ value: unknown; state: SessionState }>("command", {
      ref: this.ref,
      method,
      args,
    })
    this.mirror(r.state)
    return r.value
  }

  override async save(): Promise<void> {
    if (this.local) return super.save()
    await this.command("save")
  }
  override async saveAs(): Promise<FileRef | null> {
    if (this.local) return super.saveAs()
    return (await this.command("saveAs")) as FileRef | null
  }
  override async flush(): Promise<void> {
    if (this.local) return super.flush()
    await this.command("flush").catch(() => {})
  }
  override async respondToConsent(
    choice: Parameters<FileDocumentSession["respondToConsent"]>[0],
  ): Promise<void> {
    if (this.local) return super.respondToConsent(choice)
    await this.command("respondToConsent", choice)
  }
  override async respondToGit(
    choice: Parameters<FileDocumentSession["respondToGit"]>[0],
  ): Promise<void> {
    if (this.local) return super.respondToGit(choice)
    await this.command("respondToGit", choice)
  }
  override async runAction(id: Parameters<FileDocumentSession["runAction"]>[0]): Promise<void> {
    if (this.local) return super.runAction(id)
    await this.command("runAction", id)
  }
  override async undoExternal(
    token: Parameters<FileDocumentSession["undoExternal"]>[0],
  ): Promise<void> {
    if (this.local) return super.undoExternal(token)
    await this.command("undoExternal", token)
  }
  override dismissToast(index: number): void {
    if (this.local) {
      super.dismissToast(index)
      return
    }
    void this.command("dismissToast", index)
  }
  override showMergeReady(show = true): void {
    if (this.local) {
      super.showMergeReady(show)
      return
    }
    void this.command("showMergeReady", show)
  }
  override addToast(toast: Parameters<FileDocumentSession["addToast"]>[0]): void {
    if (this.local) {
      super.addToast(toast)
      return
    }
    void this.command("addToast", toast)
  }
  override reconcile(): Promise<void> {
    if (this.local) return super.reconcile()
    return this.command("reconcile").then(() => {})
  }
  override get saveFailed(): boolean {
    if (this.local) return super.saveFailed
    return this.mirrored?.saveStatus.kind === "failed"
  }

  override async close(): Promise<boolean> {
    if (this.local) return super.close()
    await this.flush()
    if (this.saveFailed) return false
    await this.dispose()
    return true
  }

  override async dispose(): Promise<void> {
    if (this.local) return super.dispose()
    for (const o of this.hostOffs.splice(0)) o()
    await this.hostSync?.detach()
    this.hostSync = null
    await this.client.call("release", { ref: this.ref }).catch(() => {})
    this.mirrored = this.mirrored ? { ...this.mirrored, phase: "closed" } : null
    this.manager.forget(this)
    this.emitHosted()
  }
}

/** The `createSession` factory for a window's session manager. */
export function hostedSessionFactory(client: HostClient) {
  return (ref: FileRef, manager: FileSessionManager, store: DocStore): FileDocumentSession =>
    new HostedDocumentSession(ref, manager, store, client)
}
