/**
 * Multiplayer in the desktop document host (docs/spec/multiplayer.md §16.8, ADR 0002): the
 * owner's authoritative store lives here, so sharing runs here too. This module
 *
 * - builds the host's share layer (owner registry in `${kimoHome}/multiplayer/rooms.json`),
 * - hooks it into the host's session manager, so a shared file reconnects to its room as it
 *   opens and records what each save wrote (§16.3),
 * - serves the `mp.*` host RPC methods to editor windows, and pushes each document's share
 *   snapshot to the windows showing it (`kimo://host-share`),
 * - holds agents a person interrupted (paused agents) until they resume,
 * - with Kimo Cloud, holds workspace files too (`cloud-host.ts`): bound files reopen in their
 *   rooms here, and `mp.cloud.*` shares files into workspaces and runs the re-share.
 *
 * Editor windows keep receiving room changes through the existing window sync. Guests join in
 * the window (their documents have no file).
 */
import { claimsFor } from "@kimo/editor-state"
import type { KimoPlatform } from "@kimo/platform"
import { normalizeRelayUrl, RelayHttpClient, type Role } from "@kimo/sync/mp"
import { type AgentPausesOptions, pausesFor } from "../multiplayer/agent-pause"
import { createLocalShareBackend, type ShareSnapshot } from "../multiplayer/backend"
import type { CloudStore } from "../multiplayer/cloud/store"
import { createSharedFileHooks } from "../multiplayer/room-session"
import type { FileSessionManager } from "../platform/session"
import { createPlatformShare, type LocalPresence, type PlatformShare } from "../platform/share"
import { HOST_EVENTS, type HostBridge } from "./bridge"
import { createHostWorkspaces, type HostWorkspaces } from "./cloud-host"

export interface HostMultiplayerOptions {
  platform: KimoPlatform
  bridge: HostBridge
  manager: FileSessionManager
  /** Labels of the windows showing `ref`. */
  viewers(ref: string): readonly string[]
  /** Stop on a paused agent: end its turn (the host closes its connection). */
  stopAgent(origin: string): void
  /** Test seam: the share layer. Default: one over `platform`. */
  share?: PlatformShare
  /** Kimo Cloud for workspace files; null: none. */
  cloud?: CloudStore | null
  /** Sends `ref`'s session state to its windows again (its store's read-only reason changed). */
  pushState?(ref: string): void
}

export interface HostMultiplayer {
  readonly share: PlatformShare
  /** Kimo Cloud workspace files (null without Kimo Cloud). */
  readonly workspaces: HostWorkspaces | null
  /** The `mp.*` RPC handlers (merged into the host's RPC table). */
  readonly rpc: Record<string, (args: Record<string, unknown>, from: string) => Promise<unknown>>
  /** Resolves once `origin` is not paused on any open document (agent calls wait here). */
  waitForAgent(origin: string): Promise<void>
  /** A window started or stopped showing `ref`: push its snapshot from now on. */
  watch(ref: string): void
  dispose(): void
}

const str = (v: unknown) => String(v ?? "")

export function createHostMultiplayer(options: HostMultiplayerOptions): HostMultiplayer {
  const { platform, bridge, manager } = options
  const share = options.share ?? createPlatformShare({ platform })
  const pauses: AgentPausesOptions = { onStop: (holder) => options.stopAgent(holder) }
  manager.shared = createSharedFileHooks(share, {
    onError: (ref, error) => console.warn("Kimo: a shared file could not reconnect", ref, error),
  })
  const backend = createLocalShareBackend({
    share,
    storeFor: (ref) => manager.get(ref)?.store ?? null,
    sessionFor: (ref) => {
      const s = manager.get(ref)
      return s ? { ref: s.ref, store: s.store } : null
    },
    pauses,
  })
  const watched = new Map<string, () => void>()
  const push = (ref: string) => {
    const snapshot: ShareSnapshot = backend.snapshot(ref)
    for (const label of options.viewers(ref))
      void bridge.emitTo(label, HOST_EVENTS.share, { ref, snapshot }).catch(() => undefined)
  }
  const watch = (ref: string) => {
    if (options.viewers(ref).length === 0) {
      watched.get(ref)?.()
      watched.delete(ref)
      return
    }
    if (!watched.has(ref))
      watched.set(
        ref,
        backend.subscribe(ref, () => push(ref)),
      )
    push(ref)
  }
  const offManager = manager.subscribe(() => backend.refresh())

  const workspaces = options.cloud
    ? createHostWorkspaces({ platform, bridge, manager, share, cloud: options.cloud })
    : null
  // A store's read-only reason is not a session state change: a room that went view-only, or a
  // workspace copy whose workspace was deleted, is sent to its windows when it changes.
  const reasons = new Map<string, string | null>()
  const checkReadOnly = () => {
    for (const s of manager.sessions()) {
      const reason = s.store.readOnly?.reason ?? null
      if ((reasons.get(s.ref) ?? null) === reason) continue
      reasons.set(s.ref, reason)
      options.pushState?.(s.ref)
    }
  }
  const offReadOnly = [
    share.onSessionsChange(checkReadOnly),
    share.onStatus(checkReadOnly),
    workspaces?.store.subscribe(checkReadOnly) ?? (() => {}),
  ]

  const rpc: HostMultiplayer["rpc"] = {
    ...workspaces?.rpc,
    "mp.probe": async (args) =>
      new RelayHttpClient({ relayUrl: normalizeRelayUrl(str(args.relayUrl)) }).probe(),
    "mp.status": async (args) => backend.snapshot(str(args.ref)),
    "mp.startSharing": async (args) => {
      await backend.start(str(args.ref), {
        ...(typeof args.relayUrl === "string" ? { relayUrl: args.relayUrl } : {}),
      })
      return backend.snapshot(str(args.ref))
    },
    "mp.mintLink": async (args) =>
      backend.mintLink(str(args.ref), {
        role: (args.role === "edit" ? "edit" : "view") as Role,
        ttlSeconds: typeof args.ttlSeconds === "number" ? args.ttlSeconds : null,
        ...(typeof args.label === "string" ? { label: args.label } : {}),
      }),
    "mp.listLinks": async (args) => backend.links(str(args.ref)),
    "mp.revokeLink": async (args) => {
      await backend.revokeLink(str(args.ref), str(args.jti))
      return { ok: true }
    },
    "mp.resetAllLinks": async (args) => backend.resetAllLinks(str(args.ref)),
    "mp.sweepBlobs": async (args) => {
      const room = share.roomOfFile(str(args.ref))
      if (!room) throw new Error("this document is not shared")
      return share.sweepBlobs(
        room,
        typeof args.graceDays === "number" ? { graceDays: args.graceDays } : undefined,
      )
    },
    "mp.stopSharing": async (args) => backend.stop(str(args.ref)),
    "mp.setPresence": async (args) => {
      backend.setPresence(str(args.ref), (args.fields ?? {}) as LocalPresence)
      return { ok: true }
    },
    "mp.ensureAsset": async (args) => ({
      ok: await backend.ensureAsset(str(args.ref), str(args.key)),
    }),
    "mp.resumeAgent": async (args) => {
      backend.resumeAgent(str(args.ref), str(args.holder))
      return { ok: true }
    },
    "mp.stopAgent": async (args) => {
      backend.stopAgent(str(args.ref), str(args.holder))
      return { ok: true }
    },
    /** A window wants (or stops wanting) a document's share snapshots. */
    "mp.watch": async (args) => {
      watch(str(args.ref))
      return backend.snapshot(str(args.ref))
    },
  }

  return {
    share,
    workspaces,
    rpc,
    async waitForAgent(origin) {
      for (const s of manager.sessions())
        await pausesFor(claimsFor(s.store), pauses).waitUntilResumed(origin)
    },
    watch,
    dispose() {
      offManager()
      for (const off of offReadOnly) off()
      workspaces?.dispose()
      for (const off of watched.values()) off()
      watched.clear()
      backend.dispose()
      manager.shared = null
    },
  }
}
