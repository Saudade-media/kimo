/**
 * The message bridge between editor windows, the hidden document host and Rust (ADR 0002,
 * ADR 0013 §7). In the desktop app it is Tauri IPC (commands + events), reached through the
 * webview's `__TAURI_INTERNALS__` so the web bundle never imports `@tauri-apps/api`; tests, the
 * browser e2e harness and in-page hosts use {@link createMemoryBridgeNetwork}.
 */

/** IPC as seen from one webview (label). */
export interface HostBridge {
  /** This webview's label (`document-host`, `main`, `editor-2`, …). */
  readonly label: string
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>
  /** Listens to events targeted at this webview or broadcast. */
  listen<T = unknown>(event: string, handler: (payload: T) => void): Promise<() => void>
  /** Broadcast to every webview. */
  emit(event: string, payload: unknown): Promise<void>
  /** To one webview. */
  emitTo(label: string, event: string, payload: unknown): Promise<void>
}

/** The hidden document host's webview label (apps/desktop `mcp::HOST_LABEL`). */
export const HOST_LABEL = "document-host"

/** Events between windows and the document host (JS emits; Rust only routes them). */
export const HOST_EVENTS = {
  /** `{from, msg: HostSyncMessage}` both directions (window ↔ host Yjs sync). */
  sync: "kimo://host-sync",
  /** Window → host `{from, id, method, args}`. */
  rpc: "kimo://host-rpc",
  /** Host → window `{id, ok, value?, error?}`. */
  rpcReply: "kimo://host-rpc-reply",
  /** Host → windows showing a file: `{ref, state: SessionState}`. */
  sessionState: "kimo://host-session-state",
  /** Host → windows showing a file: `{ref, ids, select, zoom}` (kimo_focus). */
  focus: "kimo://host-focus",
  /** Window → host: `{from, ref, selection}`. */
  windowState: "kimo://host-window-state",
  /** Host → every window: the host (re)started; windows re-attach. */
  ready: "kimo://host-ready",
} as const

interface TauriInternals {
  invoke(cmd: string, args?: unknown, options?: unknown): Promise<unknown>
  transformCallback(cb: (payload: unknown) => void, once?: boolean): number
  metadata?: { currentWindow?: { label: string }; currentWebview?: { label: string } }
}

function internals(): TauriInternals {
  const t = (globalThis as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
  if (!t) throw new Error("Kimo: not running inside the Tauri webview")
  return t
}

/** The Tauri bridge of the current webview (same calls `@tauri-apps/api` makes). */
export function tauriBridge(): HostBridge {
  const t = internals()
  const label = t.metadata?.currentWebview?.label ?? t.metadata?.currentWindow?.label ?? "main"
  return {
    label,
    invoke: <T>(command: string, args: Record<string, unknown> = {}) =>
      t.invoke(command, args) as Promise<T>,
    async listen<T>(event: string, handler: (payload: T) => void) {
      const id = (await t.invoke("plugin:event|listen", {
        event,
        target: { kind: "WebviewWindow", label },
        handler: t.transformCallback((e) => handler((e as { payload: T }).payload)),
      })) as number
      return () => {
        void t.invoke("plugin:event|unlisten", { event, eventId: id }).catch(() => {})
      }
    },
    emit: async (event, payload) => {
      await t.invoke("plugin:event|emit", { event, payload })
    },
    emitTo: async (to, event, payload) => {
      await t.invoke("plugin:event|emit_to", {
        target: { kind: "AnyLabel", label: to },
        event,
        payload,
      })
    },
  }
}

/** Commands answered in-page by a memory network (stands in for Rust in tests). */
export type CommandHandler = (args: Record<string, unknown>, from: string) => unknown

/**
 * An in-memory IPC network: one bridge per label, events delivered asynchronously
 * (microtask) and JSON-cloned like Tauri payloads.
 */
export function createMemoryBridgeNetwork() {
  const listeners = new Map<string, Set<{ label: string; handler: (p: unknown) => void }>>()
  const commands = new Map<string, CommandHandler>()
  const deliver = (event: string, payload: unknown, to: string | null) => {
    const copy = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload))
    queueMicrotask(() => {
      for (const l of [...(listeners.get(event) ?? [])])
        if (to === null || l.label === to) l.handler(copy)
    })
  }
  return {
    commands,
    /** Emits as Rust would (to the host, or broadcast). */
    rustEmit(event: string, payload: unknown, to: string | null = null) {
      deliver(event, payload, to)
    },
    bridge(label: string): HostBridge {
      return {
        label,
        async invoke<T>(command: string, args: Record<string, unknown> = {}) {
          const h = commands.get(command)
          if (!h)
            throw Object.assign(new Error(`unknown command ${command}`), { code: "UNSUPPORTED" })
          return (await h(JSON.parse(JSON.stringify(args)), label)) as T
        },
        async listen<T>(event: string, handler: (payload: T) => void) {
          const entry = { label, handler: handler as (p: unknown) => void }
          let set = listeners.get(event)
          if (!set) {
            set = new Set()
            listeners.set(event, set)
          }
          set.add(entry)
          return () => {
            listeners.get(event)?.delete(entry)
          }
        },
        emit: async (event, payload) => deliver(event, payload, null),
        emitTo: async (to, event, payload) => deliver(event, payload, to),
      }
    },
  }
}

export type MemoryBridgeNetwork = ReturnType<typeof createMemoryBridgeNetwork>
