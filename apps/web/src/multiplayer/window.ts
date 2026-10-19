/**
 * The multiplayer wiring of one window (ADR 0016): its share layer, the hooks that reconnect
 * shared files as they open, the share backend and the view model the UI reads.
 *
 * - Web: everything runs in the window; the owner's registry is IndexedDB.
 * - Desktop editor windows: shared files belong to the document host (it owns their stores and
 *   the file-backed registry); the window's backend switches to the host's `mp.*` RPC once the
 *   host answers. Rooms joined from a link (no file) stay in the window, kept in IndexedDB.
 */
import type { KimoPlatform } from "@kimo/platform"
import type { FileSessionManager } from "../platform/session"
import { createPlatformShare, type PlatformShare } from "../platform/share"
import { createLocalShareBackend, type ShareBackend, switchingShareBackend } from "./backend"
import { createMultiplayerModel, type MultiplayerModel } from "./model"
import { createSharedFileHooks } from "./room-session"

export interface WindowMultiplayer {
  share: PlatformShare
  backend: ShareBackend
  model: MultiplayerModel
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
  const local = createLocalShareBackend({
    share,
    storeFor: (ref) => manager.get(ref)?.store ?? null,
    sessionFor: (ref) => {
      const s = manager.get(ref)
      return s ? { ref: s.ref, store: s.store } : null
    },
  })
  manager.subscribe(() => local.refresh())
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
  return { share, backend, model }
}
