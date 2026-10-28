/** The multiplayer view model over a fake backend and a fake clock. */
import { describe, expect, test } from "bun:test"
import type { PresenceState } from "@kimo/sync"
import {
  deriveRoomId,
  exportPublicKey,
  formatJoinLink,
  generateRoomKey,
  generateSigningKeyPair,
  MultiplayerError,
  mintToken,
  type RelayInfo,
  randomBytes,
} from "@kimo/sync/mp"
import {
  emptySnapshot,
  type PeerSnapshot,
  type ShareBackend,
  type ShareSnapshot,
} from "../../src/multiplayer/backend"
import {
  createMultiplayerModel,
  type ModelTimers,
  OFFLINE_AFTER_MS,
  RELAY_TEST_TIMEOUT_MS,
  SYNCING_DELAY_MS,
} from "../../src/multiplayer/model"
import { JoinOrder, personLabel } from "../../src/multiplayer/presence"
import type { IssuedLink } from "../../src/multiplayer/registry"
import type { SharedSession } from "../../src/multiplayer/share"

// --- Fakes ---------------------------------------------------------------------------------------

/** A manual clock: timers run only when the test advances time. */
function fakeClock(start = 1_800_000_000_000) {
  let now = start
  let seq = 0
  const queue = new Map<number, { at: number; fn: () => void }>()
  const timers: ModelTimers = {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++seq
      queue.set(id, { at: now + Math.max(0, ms), fn })
      return id
    },
    clearTimeout(handle) {
      queue.delete(handle as number)
    },
  }
  const advance = (ms: number) => {
    const end = now + ms
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null
      for (const entry of queue)
        if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry
      if (!next) break
      queue.delete(next[0])
      now = next[1].at
      next[1].fn()
    }
    now = end
  }
  return {
    timers,
    advance,
    get now() {
      return now
    },
  }
}

function fakeBackend(initial: Partial<ShareSnapshot> = {}) {
  const key = "/work/site.kimo"
  let snap: ShareSnapshot = { ...emptySnapshot(key), ...initial }
  const listeners = new Set<() => void>()
  const calls: string[] = []
  let links: IssuedLink[] = []
  const backend: ShareBackend = {
    snapshot: () => snap,
    subscribe(_k, l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    async start() {
      calls.push("start")
    },
    async stop() {
      calls.push("stop")
      return { relayNotified: true }
    },
    links: async () => links,
    async mintLink(_k, options) {
      calls.push(`mint:${options.role}:${options.ttlSeconds}`)
      const link: IssuedLink = {
        jti: `j${links.length}`,
        role: options.role,
        exp: options.ttlSeconds === null ? 0 : 1_800_000_000 + options.ttlSeconds,
        iat: 1_800_000_000 + links.length,
        kid: 1,
        origin: "user",
        revoked: false,
        link: `https://kimo.test/join#${links.length}`,
      }
      links = [...links, link]
      return link
    },
    async revokeLink(_k, jti) {
      links = links.map((l) => (l.jti === jti ? { ...l, revoked: true } : l))
    },
    async resetAllLinks() {
      links = links.map((l) => ({ ...l, revoked: true }))
      return { kid: 2 }
    },
    setPresence: (_k, fields) => calls.push(`presence:${JSON.stringify(fields)}`),
    ensureAsset: async () => true,
    resumeAgent: (_k, holder) => calls.push(`resume:${holder}`),
    stopAgent: (_k, holder) => calls.push(`stop:${holder}`),
  }
  return {
    key,
    backend,
    calls,
    set(patch: Partial<ShareSnapshot>) {
      snap = { ...snap, ...patch }
      for (const l of [...listeners]) l()
    },
  }
}

const memoryStorage = () => {
  const m = new Map<string, string>()
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) }
}

const person = (id: string, name: string, extra: Partial<PresenceState> = {}): PresenceState => ({
  user: { id, name, color: extra.user?.color ?? "" },
  origin: "user",
  ...extra,
})

const peer = (
  n: number,
  state: PresenceState | null,
  changedAt: number,
  origin = "user",
): PeerSnapshot => ({
  peer: n,
  role: "edit",
  origin,
  state,
  changedAt,
})

const live = (
  clock: { now: number },
  patch: Partial<ShareSnapshot> = {},
): Partial<ShareSnapshot> => ({
  room: "room1",
  relayUrl: "https://relay.maya.studio",
  owner: true,
  role: "edit",
  status: "synced",
  self: 1,
  selfState: person("me", "Gui", { user: { id: "me", name: "Gui", color: "presence-clay" } }),
  downSince: null,
  peers: [],
  ...patch,
  ...(patch.downSince === undefined ? {} : { downSince: patch.downSince ?? clock.now }),
})

// --- Presence rules ------------------------------------------------------------------------------

describe("Guest numbering", () => {
  test("Guest N in join order per file, numbers never reused; people seen together by peer id", () => {
    const order = new JoinOrder()
    order.see([
      { id: "b", peer: 7, named: false },
      { id: "a", peer: 3, named: false },
      { id: "m", peer: 5, named: true },
    ])
    expect(order.guest("a")).toBe(1)
    expect(order.guest("b")).toBe(2)
    expect(order.guest("m")).toBe(0)
    expect(order.index("a")).toBe(0)
    expect(order.index("m")).toBe(1)
    order.see([{ id: "c", peer: 9, named: false }])
    expect(order.guest("c")).toBe(3)
    // "a" leaves and comes back with a new peer id: still Guest 1.
    order.see([{ id: "a", peer: 12, named: false }])
    expect(order.guest("a")).toBe(1)
    expect(personLabel("  ", 3)).toBe("Guest 3")
    expect(personLabel(" Maya ", 3)).toBe("Maya")
  })
})

// --- Document view -------------------------------------------------------------------------------

describe("document share view", () => {
  test("agents are grouped under their owner; agents with their own link stand alone", () => {
    const clock = fakeClock()
    const f = fakeBackend()
    const model = createMultiplayerModel({
      backend: f.backend,
      timers: clock.timers,
      storage: memoryStorage(),
    })
    const doc = model.document(f.key)
    doc.subscribe(() => {})
    const claim = { holder: "agent:sol.x1.1", ids: ["Hero"], since: 1, renewed: 2, label: "Sol" }
    f.set(
      live(clock, {
        peers: [
          peer(2, person("maya", "Maya", { claims: [claim] }), clock.now),
          peer(3, person("cc", "Claude Code"), clock.now, "mcp:claude-code"),
        ],
        claims: [
          {
            holder: "agent:kimo.ab.1",
            ids: ["Footer"],
            since: 1,
            renewed: 1,
            label: "Kimo",
            local: true,
            expiresAt: 0,
            state: "live",
          },
        ],
      }),
    )
    const state = doc.getState()
    const maya = state.people.find((p) => p.label === "Maya")
    expect(maya?.agents.map((a) => [a.label, a.ownerLabel, a.editing])).toEqual([
      ["Sol", "Maya", ["Hero"]],
    ])
    const you = state.people.find((p) => p.isYou)
    expect(you?.agents.map((a) => [a.label, a.isYours])).toEqual([["Kimo", true]])
    expect(state.agents.map((a) => a.label)).toEqual(["Kimo", "Sol", "Claude Code"])
    // The MCP client is not a person.
    expect(state.people.map((p) => p.label)).toEqual(["Gui", "Maya"])
  })

  test("relay status: quick round trips never flicker to Syncing; a dropped relay goes offline after 30 s", () => {
    const clock = fakeClock()
    const f = fakeBackend()
    const model = createMultiplayerModel({
      backend: f.backend,
      timers: clock.timers,
      storage: memoryStorage(),
    })
    const doc = model.document(f.key)
    doc.subscribe(() => {})
    // Before the first catch-up: syncing.
    f.set(live(clock, { status: "connecting" }))
    expect(doc.getState().share.relay).toBe("syncing")
    f.set({ status: "synced" })
    expect(doc.getState().share.relay).toBe("synced")
    // Edits in flight: still Synced for 600 ms.
    f.set({ status: "saving" })
    expect(doc.getState().share.relay).toBe("synced")
    clock.advance(SYNCING_DELAY_MS - 1)
    expect(doc.getState().share.relay).toBe("synced")
    clock.advance(1)
    expect(doc.getState().share.relay).toBe("syncing")
    // The relay drops: reconnecting, then offline.
    f.set({ status: "connecting", downSince: clock.now })
    expect(doc.getState().share.relay).toBe("reconnecting")
    clock.advance(OFFLINE_AFTER_MS)
    expect(doc.getState().share.relay).toBe("offline")
    f.set({ status: "read-only", role: "view", downSince: null })
    expect(doc.getState().share.relay).toBe("view-only")
  })

  test("view links: read-only, Export kept, no duplicate, no Share", () => {
    const clock = fakeClock()
    const f = fakeBackend()
    const model = createMultiplayerModel({
      backend: f.backend,
      timers: clock.timers,
      storage: memoryStorage(),
    })
    const doc = model.document(f.key)
    expect(doc.getState().capabilities).toEqual({
      canEdit: true,
      canExport: true,
      canDuplicate: true,
      canShare: true,
      viewOnly: false,
    })
    f.set(live(clock, { owner: false, role: "view", status: "read-only" }))
    expect(doc.getState().capabilities).toEqual({
      canEdit: false,
      canExport: true,
      canDuplicate: false,
      canShare: false,
      viewOnly: true,
    })
    // An edit guest edits and duplicates, but does not share.
    f.set({ role: "edit", status: "synced" })
    expect(doc.getState().capabilities).toMatchObject({
      canEdit: true,
      canDuplicate: true,
      canShare: false,
    })
    // A joined room is never shareable by its guest.
    const joined = model.document("kimo-room:abc")
    expect(joined.getState().capabilities.canShare).toBe(false)
  })

  test("links: the expiry becomes the link's lifetime; revoke and reset reach the backend", async () => {
    const clock = fakeClock()
    const f = fakeBackend()
    const model = createMultiplayerModel({
      backend: f.backend,
      timers: clock.timers,
      storage: memoryStorage(),
    })
    const doc = model.document(f.key)
    doc.subscribe(() => {})
    f.set(live(clock))
    expect(doc.getState().expiry).toBe("7d")
    await doc.createLink("view")
    expect(f.calls).toContain(`mint:view:${7 * 86_400}`)
    await doc.createLink("edit", "never")
    expect(f.calls).toContain("mint:edit:null")
    await doc.refreshLinks()
    expect(doc.getState().links.items.map((l) => l.role)).toEqual(["edit", "view"])
    await doc.revokeLink("j0")
    expect(doc.getState().links.items.map((l) => l.jti)).toEqual(["j1"])
    const reset = await doc.resetAllLinks()
    expect(reset.kid).toBe(2)
    expect(doc.getState().links.items).toEqual([])
  })
})

// --- Relay test ----------------------------------------------------------------------------------

const relayInfo: RelayInfo = {
  relayUrl: "https://relay.test",
  name: "kimo-relay",
  version: "1.2.0",
  protocol: "kimo-mp/1",
  limits: {} as RelayInfo["limits"],
  relayId: new Uint8Array(16),
  owner: "claimed",
}

describe("relay test", () => {
  test("ok, not a relay, too old, unreachable and the 5 s timeout", async () => {
    const clock = fakeClock()
    let answer: () => Promise<RelayInfo> = async () => relayInfo
    const model = createMultiplayerModel({
      backend: fakeBackend().backend,
      timers: clock.timers,
      probe: () => answer(),
    })
    expect(await model.relayTest.test("https://relay.test/")).toMatchObject({
      kind: "ok",
      version: "1.2.0",
    })
    answer = async () => {
      throw new MultiplayerError("NOT_A_RELAY", "https://x is not a Kimo relay (not JSON)")
    }
    expect((await model.relayTest.test("https://x")).kind).toBe("not-a-relay")
    answer = async () => {
      throw new MultiplayerError("NOT_A_RELAY", "https://x is not a Kimo relay (protocol 0)")
    }
    expect(await model.relayTest.test("https://x")).toMatchObject({
      kind: "too-old",
      protocol: "0",
    })
    answer = async () => {
      throw new MultiplayerError("RELAY_UNREACHABLE", "ECONNREFUSED")
    }
    expect((await model.relayTest.test("https://x")).kind).toBe("unreachable")
    expect((await model.relayTest.test("ftp://x")).kind).toBe("invalid")
    // No answer at all: unreachable after 5 s.
    answer = () => new Promise<RelayInfo>(() => {})
    const pending = model.relayTest.test("https://slow.test")
    expect(model.relayTest.getState().kind).toBe("testing")
    clock.advance(RELAY_TEST_TIMEOUT_MS)
    expect((await pending).kind).toBe("unreachable")
  })

  test("ownership: unclaimed from /version, yours or other from the device check, else null", async () => {
    let info: RelayInfo = { ...relayInfo, owner: "unclaimed" }
    let mine: "yours" | "other" = "yours"
    const asked: string[] = []
    const withCheck = createMultiplayerModel({
      backend: fakeBackend().backend,
      probe: async () => info,
      ownership: async (url) => {
        asked.push(url)
        return mine
      },
    })
    expect(await withCheck.relayTest.test("https://relay.test")).toMatchObject({
      kind: "ok",
      owner: "unclaimed",
    })
    // An unclaimed relay needs no device check.
    expect(asked).toEqual([])
    info = relayInfo
    expect(await withCheck.relayTest.test("https://relay.test")).toMatchObject({ owner: "yours" })
    mine = "other"
    expect(await withCheck.relayTest.test("https://relay.test")).toMatchObject({ owner: "other" })
    const without = createMultiplayerModel({
      backend: fakeBackend().backend,
      probe: async () => relayInfo,
    })
    expect(await without.relayTest.test("https://relay.test")).toMatchObject({ owner: null })
  })

  test("Start sharing reads the relay's ownership again (it claims an unclaimed relay)", async () => {
    let info: RelayInfo = { ...relayInfo, owner: "unclaimed" }
    let probes = 0
    const model = createMultiplayerModel({
      backend: fakeBackend().backend,
      probe: async () => {
        probes++
        return info
      },
      ownership: async () => "yours",
    })
    expect(await model.relayTest.test("https://relay.test")).toMatchObject({ owner: "unclaimed" })
    // The share service claims it while starting.
    info = relayInfo
    await model.document("/work/site.kimo").startSharing({ relayUrl: "https://relay.test" })
    for (let i = 0; i < 50 && probes < 2; i++) await new Promise((r) => setTimeout(r, 5))
    await new Promise((r) => setTimeout(r, 5))
    expect(model.relayTest.getState()).toMatchObject({ kind: "ok", owner: "yours" })
    // A check about another relay is left alone.
    await model.relayTest.recheck("https://other.test")
    expect(probes).toBe(2)
    await model.relayTest.recheck("wss://relay.test/")
    expect(probes).toBe(3)
  })
})

// --- Join ----------------------------------------------------------------------------------------

async function makeLink(options: { role?: "view" | "edit"; exp?: number } = {}) {
  const root = await generateSigningKeyPair(true)
  const room = await deriveRoomId(await exportPublicKey(root.publicKey))
  const linkKeys = await generateSigningKeyPair(true)
  const token = await mintToken(linkKeys.privateKey, {
    room,
    role: options.role ?? "edit",
    kid: 1,
    iat: 1_700_000_000,
    exp: options.exp ?? 0,
    jti: randomBytes(16),
    origin: "user",
  })
  return {
    room: room.id,
    link: formatJoinLink({
      webOrigin: "https://kimo.test",
      relayUrl: "https://relay.maya.studio",
      room: room.id,
      token,
      roomKey: generateRoomKey(),
    }),
  }
}

/** A minimal joined session whose provider events the test drives. */
function fakeSession(room: string, connected: boolean) {
  const listeners = new Set<(e: never) => void>()
  const session = {
    room,
    role: "edit",
    provider: { role: null, connected },
    onEvent(l: (e: never) => void) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  return {
    session: session as unknown as SharedSession,
    emit: (event: unknown) => {
      for (const l of [...listeners]) l(event as never)
    },
  }
}

describe("join flow", () => {
  test("errors: bad link, expired, revoked, unreachable, not a relay, too old, decrypt failed", async () => {
    const clock = fakeClock()
    const { link, room } = await makeLink()
    let probe: () => Promise<RelayInfo> = async () => relayInfo
    let join: () => Promise<SharedSession> = async () => fakeSession(room, true).session
    const model = createMultiplayerModel({
      backend: fakeBackend().backend,
      timers: clock.timers,
      probe: () => probe(),
      join: () => join(),
    })
    const kind = async (text = link) => (await model.join.join(text)).error?.kind
    expect(await kind("https://kimo.test/join#garbage")).toBe("bad-link")
    const expired = await makeLink({ exp: Math.floor(clock.now / 1000) - 10 })
    expect(await kind(expired.link)).toBe("expired")
    expect(model.join.getState().showCard).toBe(true)
    join = async () => {
      throw new MultiplayerError("TOKEN_REVOKED", "revoked")
    }
    expect(await kind()).toBe("revoked")
    join = async () => {
      throw new MultiplayerError("KEY_ROTATED", "reset")
    }
    expect(await kind()).toBe("revoked")
    join = async () => {
      throw new MultiplayerError("DECRYPT_FAILED", "AEAD tag mismatch")
    }
    expect(await kind()).toBe("decrypt-failed")
    probe = async () => {
      throw new MultiplayerError("RELAY_UNREACHABLE", "ECONNREFUSED")
    }
    expect(await kind()).toBe("unreachable")
    probe = async () => {
      throw new MultiplayerError("NOT_A_RELAY", "x is not a Kimo relay (404)")
    }
    expect(await kind()).toBe("not-a-relay")
    probe = async () => {
      throw new MultiplayerError("NOT_A_RELAY", "x is not a Kimo relay (protocol 0)")
    }
    expect(await kind()).toBe("relay-too-old")
    // A relay that never answers: unreachable after 5 s.
    probe = () => new Promise<RelayInfo>(() => {})
    const pending = model.join.join(link)
    await Bun.sleep(0)
    clock.advance(RELAY_TEST_TIMEOUT_MS)
    expect((await pending).error?.kind).toBe("unreachable")
  })
})
