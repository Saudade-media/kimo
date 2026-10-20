/**
 * The multiplayer wiring of one window (ADR 0016): its share layer, the hooks that reconnect
 * shared files as they open, the share backend and the view model the UI reads.
 *
 * - Web: everything runs in the window; the owner's registry is IndexedDB. Browser library files
 *   (`kimo-lib:<id>`) share like files on disk (`./library`).
 * - Desktop editor windows: shared files belong to the document host (it owns their stores and
 *   the file-backed registry); the window's backend switches to the host's `mp.*` RPC once the
 *   host answers. Rooms joined from a link (no file) stay in the window, kept in IndexedDB.
 */
import type { KimoPlatform } from "@kimo/platform"
import { onFileDeleted } from "../lib/file-events"
import type { FileSessionManager } from "../platform/session"
import { createPlatformShare, type PlatformShare } from "../platform/share"
import { createLocalShareBackend, type ShareBackend, switchingShareBackend } from "./backend"
import { createLibraryShare, type LibraryShare } from "./library"
import { createMultiplayerModel, type MultiplayerModel } from "./model"
import { relaySetupFor } from "./relay-setup/services"
import { createSharedFileHooks } from "./room-session"

export interface WindowMultiplayer {
  share: PlatformShare
  backend: ShareBackend
  model: MultiplayerModel
  /** Browser library files: the editor registers them here (Share, reconnect on open). */
  library: LibraryShare
}

export interface WindowMultiplayerOptions {
  platform: KimoPlatform
  manager: FileSessionManager
  /**
   * Desktop editor windows: resolves with the document host's backend (given the window's own
   * one for joined rooms), or null when no host answered (sessions stay local, shared here).
   */
  hostBackend?: (local: ShareBackend) => Promise<ShareBackend | null>
}

export function createWindowMultiplayer(options: WindowMultiplayerOptions): WindowMultiplayer {
  const { platform, manager } = options
  const share = createPlatformShare({
    platform,
    // Desktop windows hold guests' rooms only; the document host owns the file registry.
    ...(platform.kind === "desktop" && options.hostBackend
      ? { registry: "indexeddb" as const }
      : {}),
  })
  const library = createLibraryShare(share, {
    onError: (fileId, error) => console.warn("Kimo: a shared library file", fileId, error),
  })
  const local = createLocalShareBackend({
    share,
    storeFor: (ref) => manager.get(ref)?.store ?? library.get(ref)?.store ?? null,
    sessionFor: (ref) => {
      const s = manager.get(ref)
      return s ? { ref: s.ref, store: s.store } : library.get(ref)
    },
  })
  manager.subscribe(() => local.refresh())
  library.subscribe(() => local.refresh())
  // Deleting a library file for good stops sharing it.
  onFileDeleted((fileId) => library.deleted(fileId))
  let backend: ShareBackend = local
  if (options.hostBackend) {
    const next = options.hostBackend(local).then((host) => {
      // No host: this window's sessions are local, so it shares and reconnects them itself.
      if (!host) manager.shared = createSharedFileHooks(share)
      return host
    })
    backend = switchingShareBackend(local, next)
  } else manager.shared = createSharedFileHooks(share)
  const model = createMultiplayerModel({
    backend,
    settings: platform.settings,
    platformKind: platform.kind,
    join: (link) => share.joinLink(link),
  })
  if (platform.kind === "desktop") guardLocalRelay(platform, manager, model)
  return { share, backend, model, library }
}

/**
 * Board 42: quitting stops the relay on this computer (Rust ends it); when people are connected
 * through it from this window's files, ask first.
 */
function guardLocalRelay(
  platform: KimoPlatform,
  manager: FileSessionManager,
  model: MultiplayerModel,
) {
  manager.addCloseGuard(async ({ quitting }) => {
    if (!quitting) return true
    const local = relaySetupFor(platform).local?.getState()
    if (local?.status !== "running") return true
    const hosts = new Set(
      [local.lanUrl, local.publicUrl].flatMap((u) => {
        try {
          return u ? [new URL(u).host] : []
        } catch {
          return []
        }
      }),
    )
    const people: string[] = []
    for (const s of manager.sessions()) {
      const view = model.document(s.ref).getState()
      if (!view.share.relayHost || !hosts.has(view.share.relayHost)) continue
      for (const p of view.people) if (!p.isYou && !people.includes(p.label)) people.push(p.label)
    }
    if (people.length === 0) return true
    const { confirmStopRelay } = await import("./ui/StopRelayConfirm")
    return confirmStopRelay({ people: people.slice(0, 3), more: Math.max(0, people.length - 3) })
  })
}
