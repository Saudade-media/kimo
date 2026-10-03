/**
 * Updater flow (board 19 "Updater · toast after background download"): the update downloads in
 * the background (signed Tauri updater), then ONE toast per session: "Kimo 0.5 is ready ·
 * Restart". Restart first flushes autosave and waits for every open file to reach "Saved to
 * disk" (`SessionManager.flushAll`); if a file can't save, the second toast ("Restart after
 * saving 2 files? · Save & restart") appears instead of restarting. Never auto-restarts, and
 * `updater.restart()` is only ever called after a successful `flushAll`.
 */
import type { FileRef, KimoPlatform, UpdaterStatus } from "@kimo/platform"
import type { Toast } from "../platform/contract"

export type UpdateToast = Extract<Toast, { kind: "update-ready" | "update-save-first" }>

export interface UpdaterControllerOptions {
  platform: KimoPlatform
  /** `SessionManager.flushAll`: flush every session and wait for "Saved to disk". */
  flushAll: () => Promise<{ ok: boolean; failed: FileRef[] }>
  /** Check for updates on start (default true when the host has an updater). */
  checkOnStart?: boolean
}

export interface UpdaterController {
  /** The update toast to show, or null. */
  toast(): UpdateToast | null
  subscribe(listener: () => void): () => void
  /** Subscribes to the updater, downloads when allowed, checks once. */
  start(): void
  /**
   * "Restart" / "Save & restart": flush every file; restart only when all saved. Resolves
   * `"restarting"` or `"blocked"` (a file could not save: the save-first toast is shown).
   */
  restart(): Promise<"restarting" | "blocked">
  /** Dismiss the toast (it does not come back this session). */
  dismiss(): void
  dispose(): void
}

export function createUpdaterController(opts: UpdaterControllerOptions): UpdaterController {
  const { platform } = opts
  const listeners = new Set<() => void>()
  let current: UpdateToast | null = null
  let shownThisSession = false
  let restarting = false
  let off: (() => void) | null = null
  const emit = () => {
    for (const l of [...listeners]) l()
  }
  const set = (t: UpdateToast | null) => {
    current = t
    emit()
  }
  const onStatus = (s: UpdaterStatus) => {
    if (s.state === "available" && platform.settings.get("updates.download"))
      void platform.updater.download().catch(() => {})
    if (s.state === "ready" && !shownThisSession) {
      shownThisSession = true
      set({ kind: "update-ready", info: s.info })
    }
  }
  return {
    toast: () => current,
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    start() {
      if (!platform.capabilities.updater || off) return
      off = platform.updater.onStatus(onStatus)
      onStatus(platform.updater.status())
      if (opts.checkOnStart ?? true) void platform.updater.check().catch(() => {})
    },
    async restart() {
      if (restarting) return "blocked"
      restarting = true
      try {
        let result: { ok: boolean; failed: FileRef[] }
        try {
          result = await opts.flushAll()
        } catch {
          result = { ok: false, failed: [] }
        }
        if (!result.ok) {
          set({ kind: "update-save-first", unsavedFiles: Math.max(1, result.failed.length) })
          return "blocked"
        }
        set(null)
        await platform.updater.restart()
        return "restarting"
      } finally {
        restarting = false
      }
    },
    dismiss() {
      set(null)
    },
    dispose() {
      off?.()
      off = null
      listeners.clear()
    },
  }
}
