/**
 * The share backend of a desktop editor window (docs/spec/multiplayer.md §16.8): files are shared
 * by the document host, which owns their stores, so file keys go to its `mp.*` RPC and its pushed
 * snapshots (`kimo://host-share`). Rooms joined from a link live in the window (they have no
 * file) and go to the window's own backend.
 */
import {
  emptySnapshot,
  roomOfKey,
  type ShareBackend,
  type ShareSnapshot,
} from "../multiplayer/backend"
import type { IssuedLink } from "../multiplayer/registry"
import type { LocalPresence } from "../platform/share"
import type { HostClient } from "./client"

/** Presence updates (pointer moves) are sent to the host at most this often per document. */
export const PRESENCE_SEND_MS = 50

export function createHostShareBackend(
  client: HostClient,
  options: { local?: ShareBackend | null } = {},
): ShareBackend {
  const local = options.local ?? null
  const snapshots = new Map<string, ShareSnapshot>()
  const listeners = new Map<string, Set<() => void>>()
  const offs = new Map<string, () => void>()
  const pending = new Map<string, LocalPresence>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const forLocal = (key: string) => roomOfKey(key) !== null && local !== null
  const set = (key: string, snapshot: ShareSnapshot) => {
    snapshots.set(key, snapshot)
    for (const l of [...(listeners.get(key) ?? [])]) l()
  }
  const refresh = (key: string) =>
    client.call<ShareSnapshot>("mp.watch", { ref: key }).then(
      (snapshot) => set(key, snapshot),
      () => undefined,
    )

  return {
    snapshot(key) {
      if (forLocal(key)) return (local as ShareBackend).snapshot(key)
      let snap = snapshots.get(key)
      if (!snap) {
        snap = emptySnapshot(key)
        snapshots.set(key, snap)
      }
      return snap
    },
    subscribe(key, listener) {
      if (forLocal(key)) return (local as ShareBackend).subscribe(key, listener)
      let set_ = listeners.get(key)
      if (!set_) {
        set_ = new Set()
        listeners.set(key, set_)
        const offShare = client.onShare(key, (snapshot) => set(key, snapshot as ShareSnapshot))
        // After a host restart the window asks again.
        const offReady = client.onReady(() => void refresh(key))
        offs.set(key, () => {
          offShare()
          offReady()
        })
        void refresh(key)
      }
      set_.add(listener)
      return () => {
        set_.delete(listener)
        if (set_.size === 0) {
          listeners.delete(key)
          offs.get(key)?.()
          offs.delete(key)
        }
      }
    },
    async start(key, start = {}) {
      if (forLocal(key)) return (local as ShareBackend).start(key, start)
      set(key, await client.call<ShareSnapshot>("mp.startSharing", { ref: key, ...start }, 120_000))
    },
    async stop(key) {
      if (forLocal(key)) return (local as ShareBackend).stop(key)
      const r = await client.call<{ relayNotified: boolean }>("mp.stopSharing", { ref: key })
      void refresh(key)
      return { relayNotified: r.relayNotified }
    },
    links(key) {
      if (forLocal(key)) return (local as ShareBackend).links(key)
      return client.call<IssuedLink[]>("mp.listLinks", { ref: key })
    },
    mintLink(key, mint) {
      if (forLocal(key)) return (local as ShareBackend).mintLink(key, mint)
      return client.call<IssuedLink>("mp.mintLink", { ref: key, ...mint })
    },
    async revokeLink(key, jti) {
      if (forLocal(key)) return (local as ShareBackend).revokeLink(key, jti)
      await client.call("mp.revokeLink", { ref: key, jti })
    },
    resetAllLinks(key) {
      if (forLocal(key)) return (local as ShareBackend).resetAllLinks(key)
      return client.call<{ kid: number }>("mp.resetAllLinks", { ref: key }, 60_000)
    },
    setPresence(key, fields) {
      if (forLocal(key)) return (local as ShareBackend).setPresence(key, fields)
      // Coalesced: only the latest fields of a burst reach the host.
      pending.set(key, fields)
      if (timers.has(key)) return
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key)
          const latest = pending.get(key)
          pending.delete(key)
          if (latest)
            void client.call("mp.setPresence", { ref: key, fields: latest }).catch(() => undefined)
        }, PRESENCE_SEND_MS),
      )
    },
    async ensureAsset(key, asset) {
      if (forLocal(key)) return (local as ShareBackend).ensureAsset(key, asset)
      const r = await client.call<{ ok: boolean }>("mp.ensureAsset", { ref: key, key: asset })
      return r.ok
    },
    resumeAgent(key, holder) {
      if (forLocal(key)) return (local as ShareBackend).resumeAgent(key, holder)
      void client.call("mp.resumeAgent", { ref: key, holder }).catch(() => undefined)
    },
    stopAgent(key, holder) {
      if (forLocal(key)) return (local as ShareBackend).stopAgent(key, holder)
      void client.call("mp.stopAgent", { ref: key, holder }).catch(() => undefined)
    },
  }
}
