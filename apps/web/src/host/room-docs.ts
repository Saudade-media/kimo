/**
 * Rooms joined from a share link as MCP documents (#79). The window that joined a room holds it:
 * the link, the room key, the relay connection and the assets never leave that window. The
 * document host keeps a replica of the room's store, synced over `kimo://room-sync` with the
 * window's store as the hub, so MCP lists, reads and edits the room like any open document (path
 * `kimo-room:<room>`): an agent's edit lands on the replica, reaches the window's store and goes
 * to the relay from there. Only the room id, the relay host and the role cross the bridge.
 *
 * - Host ({@link createHostRooms}): `room.attach`, `room.detach` and `room.asset`; the replicas as
 *   backend documents. A view link's replica is read-only, so edits fail with READ_ONLY.
 * - Window ({@link serveRoomsToHost}): attaches each room the window keeps joined (again after a
 *   host restart), detaches it when the room is left, and answers asset reads for renders. It
 *   never takes an update from the host while the room is read-only.
 */
import { createDocStore, type DocStore } from "@kimo/editor-state"
import { type BackendDocument, isRoomPath } from "@kimo/mcp-server"
import {
  base64ToBytes,
  bytesToBase64,
  HostSyncHub,
  type HostSyncMessage,
  type HostSyncTransport,
  VIEW_ONLY_REASON,
  WindowSyncProvider,
} from "@kimo/sync"
import { isRoomId } from "@kimo/sync/mp"
import { roomKeyOf } from "../multiplayer/backend"
import type { JoinedRoom } from "../multiplayer/model"
import { HOST_EVENTS, HOST_LABEL, type HostBridge } from "./bridge"
import type { HostClient } from "./client"

type Rpc = Record<string, (args: Record<string, unknown>, from: string) => Promise<unknown>>

/** What a window tells the host about a room it holds: never the link, its token or the key. */
export interface RoomAttach {
  /** `kimo-room:<room>`. */
  ref: string
  /** The relay's host. */
  relay: string | null
  role: "edit" | "view"
  /** Why the window's store refuses edits, null when it takes them. */
  readOnly: string | null
}

/** Why a room whose connection ended for good takes no edits (READ_ONLY). */
const ENDED_REASON = "the room's connection ended"

/** A room asset read waits this long for the window, then the render goes without it. */
const ASSET_TIMEOUT_MS = 5000
const ASSET_SRC = /^\.\/assets\/([^\\/]+)$/

/** The attach payload, checked: a room ref, a host name, a role (a bad role reads as view). */
function attachOf(args: Record<string, unknown>): RoomAttach {
  const ref = String(args.ref ?? "")
  if (!isRoomPath(ref) || !isRoomId(ref.slice(ref.indexOf(":") + 1)))
    throw new Error("room.attach: not a room")
  const relay =
    typeof args.relay === "string" && /^[\w.:[\]-]{1,260}$/.test(args.relay) ? args.relay : null
  const readOnly = typeof args.readOnly === "string" ? args.readOnly.slice(0, 200) : null
  return { ref, relay, role: args.role === "edit" ? "edit" : "view", readOnly }
}

// --- Host --------------------------------------------------------------------------------------

export interface HostRoomsOptions {
  bridge: HostBridge
  /**
   * The host's window labels per document ref: a room's windows show it there (kimo_focus, the
   * window count).
   */
  viewers: Map<string, Set<string>>
  /** Window `from` stopped holding room `ref` (its selection goes). */
  onDetach?(ref: string, from: string): void
}

export interface HostRooms {
  /** The rooms windows hold, as backend documents. */
  list(): BackendDocument[]
  readonly rpc: Rpc
  /** Window `from` (re)loaded: the rooms its old page held went with it. */
  dropWindow(from: string): Promise<void>
  dispose(): Promise<void>
}

interface Holder {
  from: string
  info: RoomAttach
}

interface RoomEntry {
  readonly ref: string
  readonly store: DocStore
  /** Windows holding the room; the replica syncs with the first. */
  readonly holders: Holder[]
  provider: WindowSyncProvider | null
  /** Listed for MCP once the replica caught up with the window's store. */
  synced: boolean
  doc: BackendDocument | null
}

export function createHostRooms(options: HostRoomsOptions): HostRooms {
  const { bridge, viewers } = options
  const rooms = new Map<string, RoomEntry>()
  const listeners = new Set<{ from: string; l: (m: HostSyncMessage) => void }>()
  const offs: Promise<() => void>[] = [
    bridge.listen<{ from: string; msg: HostSyncMessage }>(HOST_EVENTS.roomSync, ({ from, msg }) => {
      for (const e of [...listeners]) if (e.from === from) e.l(msg)
    }),
  ]
  const transportTo = (label: string): HostSyncTransport => ({
    send: (msg) =>
      void bridge.emitTo(label, HOST_EVENTS.roomSync, { from: HOST_LABEL, msg }).catch(() => {}),
    onMessage(l) {
      const e = { from: label, l }
      listeners.add(e)
      return () => listeners.delete(e)
    },
  })

  // Asset reads for renders: the window that holds the room answers with `room.asset`.
  const pending = new Map<string, { from: string; resolve(b: Uint8Array | null): void }>()
  let seq = 0
  const readAsset = (e: RoomEntry, src: string) =>
    new Promise<Uint8Array | null>((resolve) => {
      const from = e.holders[0]?.from
      if (!from || !ASSET_SRC.test(src)) return resolve(null)
      const id = `ra${(++seq).toString(36)}`
      const timer = setTimeout(() => finish(null), ASSET_TIMEOUT_MS)
      const finish = (bytes: Uint8Array | null) => {
        clearTimeout(timer)
        pending.delete(id)
        resolve(bytes)
      }
      pending.set(id, { from, resolve: finish })
      bridge.emitTo(from, HOST_EVENTS.roomAsset, { id, ref: e.ref, src }).catch(() => finish(null))
    })

  /** Per room, one change at a time (an attach and a detach may arrive together). */
  const queues = new Map<string, Promise<unknown>>()
  const serial = <T>(ref: string, fn: () => Promise<T>): Promise<T> => {
    const next = (queues.get(ref) ?? Promise.resolve()).then(fn, fn)
    const tail = next.catch(() => undefined)
    queues.set(ref, tail)
    void tail.then(() => {
      if (queues.get(ref) === tail) queues.delete(ref)
    })
    return next
  }

  /** The first holder's role and read-only reason, on the replica. */
  const applyInfo = (e: RoomEntry) => {
    const info = e.holders[0]?.info
    if (!info) return
    const reason = info.readOnly ?? (info.role === "view" ? VIEW_ONLY_REASON : null)
    if ((e.store.readOnly?.reason ?? null) !== reason) e.store.setReadOnly(reason)
  }

  /** (Re)syncs the replica with the first holder's store. */
  const connect = async (e: RoomEntry) => {
    const old = e.provider
    e.provider = null
    await old?.detach()
    const from = e.holders[0]?.from
    if (!from) return
    const p = new WindowSyncProvider({ transport: transportTo(from), doc: e.ref })
    e.provider = p
    // The window's state arrives as `remote:host`: no agent's undo stack holds it.
    await p.attach(e.store)
    e.synced = true
  }

  const backendDocument = (e: RoomEntry): BackendDocument => ({
    path: e.ref,
    store: e.store,
    readOnlyReason: () => e.store.readOnly?.reason ?? null,
    format: () => e.store.toHeader().format,
    dirty: () => false,
    lastSavedRevision: () => undefined,
    shownInWindow: () => e.holders.length > 0,
    async save() {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED",
          message: "A shared room has no file. Edits sync live to everyone in it.",
          suggestion: "Save a copy with kimo_export target=kimo.",
        },
      }
    },
    // A window shows it: kimo_close only drops the agent's reference.
    async close() {},
    shared() {
      const info = e.holders[0]?.info
      return info ? { relay: info.relay, role: info.role } : null
    },
    readAsset: (src) => readAsset(e, src),
  })

  const addViewer = (ref: string, from: string) => {
    let set = viewers.get(ref)
    if (!set) {
      set = new Set()
      viewers.set(ref, set)
    }
    set.add(from)
  }

  const attach = (info: RoomAttach, from: string) =>
    serial(info.ref, async () => {
      let e = rooms.get(info.ref)
      if (!e) {
        // No tree repairs here: the room's own clients elect the one that repairs.
        e = {
          ref: info.ref,
          store: createDocStore(undefined, { autoRepair: false }),
          holders: [],
          provider: null,
          synced: false,
          doc: null,
        }
        e.doc = backendDocument(e)
        rooms.set(info.ref, e)
      }
      const held = e.holders.find((h) => h.from === from)
      if (held) held.info = info
      else e.holders.push({ from, info })
      addViewer(info.ref, from)
      applyInfo(e)
      // The window asks again after a host restart or when its hub restarted: sync from scratch.
      if (e.holders[0]?.from === from) await connect(e)
    })

  const detach = (ref: string, from: string) =>
    serial(ref, async () => {
      const e = rooms.get(ref)
      const i = e ? e.holders.findIndex((h) => h.from === from) : -1
      if (!e || i < 0) return
      e.holders.splice(i, 1)
      const set = viewers.get(ref)
      set?.delete(from)
      if (set?.size === 0) viewers.delete(ref)
      options.onDetach?.(ref, from)
      if (e.holders.length > 0) {
        if (i === 0) {
          applyInfo(e)
          await connect(e)
        }
        return
      }
      rooms.delete(ref)
      await e.provider?.detach()
      e.provider = null
      e.store.destroy()
    })

  const rpc: Rpc = {
    async "room.attach"(args, from) {
      await attach(attachOf(args), from)
      return { ok: true }
    },
    /** The role or read-only reason of a room changed (no resync). */
    async "room.info"(args, from) {
      const info = attachOf(args)
      const held = rooms.get(info.ref)?.holders.find((h) => h.from === from)
      if (!held) return { ok: false }
      held.info = info
      applyInfo(rooms.get(info.ref) as RoomEntry)
      return { ok: true }
    },
    async "room.detach"(args, from) {
      await detach(String(args.ref ?? ""), from)
      return { ok: true }
    },
    async "room.asset"(args, from) {
      const p = pending.get(String(args.id ?? ""))
      if (!p || p.from !== from) return { ok: false }
      p.resolve(typeof args.data === "string" ? base64ToBytes(args.data) : null)
      return { ok: true }
    },
  }

  return {
    list: () => [...rooms.values()].flatMap((e) => (e.doc && e.synced ? [e.doc] : [])),
    rpc,
    async dropWindow(from) {
      const held = [...rooms.values()].filter((e) => e.holders.some((h) => h.from === from))
      await Promise.all(held.map((e) => detach(e.ref, from)))
    },
    async dispose() {
      for (const off of offs) void off.then((o) => o())
      for (const p of [...pending.values()]) p.resolve(null)
      for (const e of [...rooms.values()]) {
        await e.provider?.detach()
        e.store.destroy()
      }
      rooms.clear()
    },
  }
}

// --- Window ------------------------------------------------------------------------------------

/** The rooms a window keeps joined (the multiplayer join model). */
export interface WindowRooms {
  rooms(): readonly JoinedRoom[]
  subscribe(listener: () => void): () => void
}

export interface ServedRooms {
  /** The window is closing: the host lets go of its rooms (they go with the page). */
  detachAll(): Promise<void>
  dispose(): void
}

/**
 * Serves the rooms this window keeps joined to the document host, so MCP clients see them. Only
 * the room id, the relay host and the role go to the host.
 */
export function serveRoomsToHost(client: HostClient, source: WindowRooms): ServedRooms {
  const bridge = client.bridge
  const listeners = new Set<(m: HostSyncMessage) => void>()
  /** `ended`: the room's connection ended for good (a revoked link, a closed room). */
  const served = new Map<
    string,
    { room: JoinedRoom; info: string; ended: boolean; off: () => void }
  >()
  const offs: (() => void)[] = []
  let disposed = false
  const listen = <T>(event: string, h: (p: T) => void) =>
    bridge.listen<T>(event, h).then((off) => (disposed ? off() : void offs.push(off)))

  const installed = Promise.all([
    listen<{ from: string; msg: HostSyncMessage }>(HOST_EVENTS.roomSync, ({ from, msg }) => {
      if (from !== HOST_LABEL) return
      // A read-only room (a view link) never takes an edit, from an agent or anyone.
      if (msg.t === "update" && served.get(msg.doc)?.room.session.store.readOnly) return
      for (const l of [...listeners]) l(msg)
    }),
    listen<{ id: string; ref: string; src: string }>(HOST_EVENTS.roomAsset, ({ id, ref, src }) => {
      const key = ASSET_SRC.exec(src)?.[1]
      const room = served.get(ref)?.room
      const read = room && key ? room.session.assets.bytes(key).catch(() => null) : null
      void Promise.resolve(read).then((bytes) =>
        client
          .call("room.asset", { id, data: bytes ? bytesToBase64(bytes) : null })
          .catch(() => undefined),
      )
    }),
  ])
  const hub = new HostSyncHub({
    send: (msg) =>
      void bridge
        .emitTo(HOST_LABEL, HOST_EVENTS.roomSync, { from: bridge.label, msg })
        .catch(() => {}),
    onMessage(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  })

  const infoOf = (room: JoinedRoom, ended = false): RoomAttach => ({
    ref: roomKeyOf(room.session.room),
    relay: room.relayHost,
    role: room.session.role,
    // Edits to a room whose connection ended would never reach anyone.
    readOnly: ended ? ENDED_REASON : (room.session.store.readOnly?.reason ?? null),
  })
  const attach = async (ref: string) => {
    await installed
    const s = served.get(ref)
    if (!disposed && s)
      await client
        .call("room.attach", { ...infoOf(s.room, s.ended) })
        .catch((e: unknown) => console.warn("Kimo: agents cannot see a shared room", e))
  }
  /** The role or the read-only reason changed (a view link, a revoked link). */
  const recheck = (ref: string) => {
    const s = served.get(ref)
    if (!s) return
    const info = infoOf(s.room, s.ended)
    const key = JSON.stringify(info)
    if (key === s.info) return
    s.info = key
    void client.call("room.info", { ...info }).catch(() => undefined)
  }

  const sync = () => {
    if (disposed) return
    const live = new Map(source.rooms().map((r) => [roomKeyOf(r.session.room), r]))
    for (const [ref, s] of served)
      if (live.get(ref) !== s.room) {
        s.off()
        served.delete(ref)
        hub.unregister(ref)
        void client.call("room.detach", { ref }).catch(() => undefined)
      }
    for (const [ref, room] of live) {
      if (served.has(ref)) continue
      hub.register(ref, room.session.store)
      const offs = [
        room.session.onStatus(() => recheck(ref)),
        room.session.onEvent((event) => {
          const entry = served.get(ref)
          if (!entry) return
          if (event.type === "denied" || (event.type === "closed" && !event.willRetry))
            entry.ended = true
          recheck(ref)
        }),
      ]
      served.set(ref, {
        room,
        info: JSON.stringify(infoOf(room)),
        ended: false,
        off: () => {
          for (const o of offs) o()
        },
      })
      void attach(ref)
    }
  }
  offs.push(source.subscribe(sync))
  // After a host restart the new host has no replicas: attach them all again.
  offs.push(client.onReady(() => void Promise.all([...served.keys()].map(attach))))
  sync()

  return {
    async detachAll() {
      const refs = [...served.keys()]
      for (const s of served.values()) s.off()
      served.clear()
      for (const ref of refs) hub.unregister(ref)
      await Promise.all(refs.map((ref) => client.call("room.detach", { ref }).catch(() => {})))
    },
    dispose() {
      disposed = true
      for (const s of served.values()) s.off()
      served.clear()
      hub.dispose()
      for (const off of offs.splice(0)) off()
    },
  }
}
