/**
 * "Restart to update" from the desktop Settings window (board 37 D10 fSIIa): every editor window
 * flushes its open files first ("Open files are saved first"), then the app restarts. The
 * Settings window has no sessions of its own, so it asks the other windows over a
 * BroadcastChannel (one origin, every webview of the app):
 *
 *   Settings → { type: "flush", id }      every editor window → { type: "ack", id, label }
 *   then, once its files are saved →      { type: "flushed", id, label, ok, failed }
 *
 * The restart only happens when every window that answered saved all its files.
 */

const CHANNEL = "kimo-updater"
/** How long windows have to say they are there. */
const ACK_MS = 400
/** How long a window may take to save its files. */
const FLUSH_MS = 20_000

type Message =
  | { type: "flush"; id: string }
  | { type: "ack"; id: string; label: string }
  | { type: "flushed"; id: string; label: string; ok: boolean; failed: number }

function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null
  } catch {
    return null
  }
}

/** Editor windows: answer flush requests with this window's `flushAll`. */
export function serveFlushRequests(
  label: string,
  flushAll: () => Promise<{ ok: boolean; failed: readonly unknown[] }>,
): () => void {
  const ch = channel()
  if (!ch) return () => {}
  ch.onmessage = (e: MessageEvent<Message>) => {
    const m = e.data
    if (m?.type !== "flush") return
    ch.postMessage({ type: "ack", id: m.id, label } satisfies Message)
    void flushAll().then(
      (r) =>
        ch.postMessage({
          type: "flushed",
          id: m.id,
          label,
          ok: r.ok,
          failed: r.failed.length,
        } satisfies Message),
      () => ch.postMessage({ type: "flushed", id: m.id, label, ok: false, failed: 1 }),
    )
  }
  return () => ch.close()
}

/**
 * Asks every editor window to save its files. Resolves the number of files that could not be
 * saved (0: all saved, or no editor window is open).
 */
export function flushAllWindows(): Promise<number> {
  const ch = channel()
  if (!ch) return Promise.resolve(0)
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const waiting = new Set<string>()
  let failed = 0
  return new Promise<number>((resolve) => {
    let acking = true
    let timer: ReturnType<typeof setTimeout>
    const done = () => {
      clearTimeout(timer)
      ch.close()
      resolve(failed)
    }
    ch.onmessage = (e: MessageEvent<Message>) => {
      const m = e.data
      if (!m || m.id !== id) return
      if (m.type === "ack" && acking) waiting.add(m.label)
      if (m.type === "flushed") {
        waiting.delete(m.label)
        if (!m.ok) failed += Math.max(1, m.failed)
        if (!acking && waiting.size === 0) done()
      }
    }
    ch.postMessage({ type: "flush", id } satisfies Message)
    timer = setTimeout(() => {
      acking = false
      if (waiting.size === 0) return done()
      timer = setTimeout(() => {
        // A window that never answered keeps its files unsaved: don't restart over them.
        failed += waiting.size
        done()
      }, FLUSH_MS)
    }, ACK_MS)
  })
}
