/** The multiplayer view model (board 41) over a fake backend and a fake clock. */
import { describe, expect, test } from "bun:test"
import { claimsFor, YjsDocStore } from "@kimo/editor-state"
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
import { AGENT_RESUME_MS, AgentPauses } from "../src/multiplayer/agent-pause"
import {
  emptySnapshot,
  type PeerSnapshot,
  type ShareBackend,
  type ShareSnapshot,
} from "../src/multiplayer/backend"
import {
  createMultiplayerModel,
  IDLE_AFTER_MS,
  JOIN_CARD_DELAY_MS,
  type ModelTimers,
  OFFLINE_AFTER_MS,
  RELAY_TEST_TIMEOUT_MS,
  resetConfirmCopy,
  SYNCING_DELAY_MS,
} from "../src/multiplayer/model"
import {
  JoinOrder,
  PRESENCE_COLORS,
  personLabel,
  pickPresenceColor,
  presenceColorAt,
} from "../src/multiplayer/presence"
import type { IssuedLink } from "../src/multiplayer/registry"
import type { SharedSession } from "../src/multiplayer/share"

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

describe("presence colors and Guest numbering", () => {
  test("six tokens in board order; the seventh person reuses clay", () => {
    expect(PRESENCE_COLORS).toEqual([
      "presence-clay",
      "presence-pine",
      "presence-ochre",
      "presence-plum",
      "presence-slate",
      "presence-graphite",
    ])
    expect(presenceColorAt(0)).toBe("presence-clay")
    expect(presenceColorAt(6)).toBe("presence-clay")
    expect(presenceColorAt(8)).toBe("presence-ochre")
  })

  test("a client keeps its color unless an earlier joiner has it; never a meaning color", () => {
    expect(pickPresenceColor(null, [])).toBe("presence-clay")
    expect(pickPresenceColor(null, ["presence-clay"])).toBe("presence-pine")
    expect(pickPresenceColor("presence-plum", ["presence-clay"])).toBe("presence-plum")
    expect(pickPresenceColor("presence-clay", ["presence-clay", "presence-pine"])).toBe(
      "presence-ochre",
    )
    // Not a presence token (a hex, a selection or warning color): replaced.
    expect(pickPresenceColor("#3366ff", [])).toBe("presence-clay")
    expect(pickPresenceColor("warning", ["presence-clay"])).toBe("presence-pine")
    // All six taken by earlier joiners: the seventh reuses clay.
    expect(pickPresenceColor(null, [...PRESENCE_COLORS])).toBe("presence-clay")
  })

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
  test("people: owner first, then join order; names or Guest N; colors from presence", () => {
    const clock = fakeClock()
    const f = fakeBackend()
    const model = createMultiplayerModel({
      backend: f.backend,
      timers: clock.timers,
      storage: memoryStorage(),
    })
    const doc = model.document(f.key)
    doc.subscribe(() => {})
    f.set(
      live(clock, {
        owner: false,
        role: "edit",
        self: 4,
        selfState: person("me", "", { user: { id: "me", name: "", color: "presence-ochre" } }),
        peers: [
          peer(
            2,
            person("ana", "", { user: { id: "ana", name: "", color: "presence-pine" } }),
            clock.now,
          ),
          peer(
            3,
            person("maya", "Maya", {
              user: { id: "maya", name: "Maya", color: "presence-clay" },
              owner: true,
            }),
            clock.now,
          ),
          // A color that is not a presence token falls back to the join-order color.
          peer(
            5,
            person("tom", "Tom", { user: { id: "tom", name: "Tom", color: "#ff0000" } }),
            clock.now,
          ),
        ],
      }),
    )
    const people = doc.getState().people
    expect(people.map((p) => p.label)).toEqual(["Maya", "Guest 1", "Guest 2", "Tom"])
    expect(people[0]?.owner).toBe(true)
    expect(people.find((p) => p.isYou)?.label).toBe("Guest 2")
    expect(people.map((p) => p.color)).toEqual([
      "presence-clay",
      "presence-pine",
      "presence-ochre",
      "presence-plum",
    ])
    expect(doc.getState().share.othersOnline).toBe(3)
    // Stable identity while nothing changed.
    expect(doc.getState().people).toBe(people)
  })

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
    expect(doc.resetImpact()).toEqual({ people: ["Maya"], more: 0, agents: 1 })
  })

  test("relay status: Synced, Syncing after 600 ms, Sharing images, Reconnecting, Offline after 30 s", () => {
    const clock = fakeClock()
    const f = fakeBackend()
    const model = createMultiplayerModel({
      backend: f.backend,
      timers: clock.timers,
      storage: memoryStorage(),
    })
    const doc = model.document(f.key)
    let notified = 0
    doc.subscribe(() => notified++)
    // Before the first catch-up: syncing.
    f.set(live(clock, { status: "connecting" }))
    expect(doc.getState().share.relay).toBe("syncing")
    f.set({ status: "synced" })
    expect(doc.getState().share.relay).toBe("synced")
    // Edits in flight: still Synced for 600 ms so quick round trips never flicker.
    f.set({ status: "saving" })
    expect(doc.getState().share.relay).toBe("synced")
    const before = notified
    clock.advance(SYNCING_DELAY_MS - 1)
    expect(doc.getState().share.relay).toBe("synced")
    clock.advance(1)
    expect(notified).toBeGreaterThan(before)
    expect(doc.getState().share.relay).toBe("syncing")
    // No pending edits, images uploading.
    f.set({
      status: "synced",
      assets: { uploading: ["a.png", "b.png"], fetching: [], unavailable: [], failed: [] },
    })
    expect(doc.getState().share.relay).toBe("saving")
    expect(doc.getState().share.uploading).toBe(2)
    // The relay drops: reconnecting, then offline after 30 s.
    f.set({
      status: "connecting",
      downSince: clock.now,
      assets: { uploading: [], fetching: [], unavailable: [], failed: [] },
    })
    expect(doc.getState().share.relay).toBe("reconnecting")
    clock.advance(OFFLINE_AFTER_MS)
    expect(doc.getState().share.relay).toBe("offline")
    // A view link, caught up.
    f.set({ status: "read-only", role: "view", downSince: null })
    expect(doc.getState().share.relay).toBe("view-only")
  })

  test("a person with no input for 60 s is idle; activity wakes them", () => {
    const clock = fakeClock()
    const f = fakeBackend()
    const model = createMultiplayerModel({
      backend: f.backend,
      timers: clock.timers,
      storage: memoryStorage(),
    })
    const doc = model.document(f.key)
    doc.subscribe(() => {})
    f.set(live(clock, { peers: [peer(2, person("jonas", "Jonas"), clock.now)] }))
    const jonas = () => doc.getState().people.find((p) => p.label === "Jonas")
    expect(jonas()?.idle).toBe(false)
    clock.advance(IDLE_AFTER_MS - 1)
    expect(jonas()?.idle).toBe(false)
    clock.advance(1)
    expect(jonas()?.idle).toBe(true)
    f.set({ peers: [peer(2, person("jonas", "Jonas", { cursor: { x: 1, y: 2 } }), clock.now)] })
    expect(jonas()?.idle).toBe(false)
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

  test("follow tracks a person and stops when they leave", () => {
    const clock = fakeClock()
    const f = fakeBackend()
    const model = createMultiplayerModel({
      backend: f.backend,
      timers: clock.timers,
      storage: memoryStorage(),
    })
    const doc = model.document(f.key)
    doc.subscribe(() => {})
    const viewport = { x: 10, y: 20, w: 800, h: 600, zoom: 2 }
    f.set(
      live(clock, {
        peers: [
          peer(
            2,
            person("maya", "Maya", {
              user: { id: "maya", name: "Maya", color: "presence-pine" },
              viewport,
              page: "p1",
            }),
            clock.now,
          ),
        ],
      }),
    )
    doc.follow(2)
    expect(doc.getState().follow).toEqual({
      peer: 2,
      label: "Maya",
      color: "presence-pine",
      page: "p1",
      viewport,
      cursor: null,
    })
    f.set({ peers: [] })
    expect(doc.getState().follow).toBeNull()
  })

  test("links: expiry remembered per file, newest first, revoke and reset", async () => {
    const clock = fakeClock()
    const f = fakeBackend()
    const storage = memoryStorage()
    const model = createMultiplayerModel({ backend: f.backend, timers: clock.timers, storage })
    const doc = model.document(f.key)
    doc.subscribe(() => {})
    f.set(
      live(clock, {
        peers: [
          peer(2, person("maya", "Maya"), clock.now),
          peer(3, person("a", ""), clock.now),
          peer(4, person("b", "Ana"), clock.now),
          peer(5, person("c", "Jonas"), clock.now),
        ],
      }),
    )
    expect(doc.getState().expiry).toBe("7d")
    await doc.createLink("view")
    expect(f.calls).toContain(`mint:view:${7 * 86_400}`)
    await doc.createLink("edit", "never")
    expect(f.calls).toContain("mint:edit:null")
    expect(doc.getState().expiry).toBe("never")
    // Remembered for this file in a new model.
    const again = createMultiplayerModel({ backend: f.backend, timers: clock.timers, storage })
    expect(again.document(f.key).getState().expiry).toBe("never")
    await doc.refreshLinks()
    expect(doc.getState().links.items.map((l) => l.role)).toEqual(["edit", "view"])
    expect(doc.getState().links.items[0]?.expiresAt).toBeNull()
    await doc.revokeLink("j0")
    expect(doc.getState().links.items.map((l) => l.jti)).toEqual(["j1"])
    const impact = doc.resetImpact()
    expect(impact).toEqual({ people: ["Maya", "Guest 1", "Ana"], more: 1, agents: 0 })
    expect(resetConfirmCopy(impact)).toBe(
      "Disconnects 4 people now (Maya, Guest 1, Ana and 1 more) using these links.",
    )
    const reset = await doc.resetAllLinks()
    expect(reset.kid).toBe(2)
    expect(reset.disconnected).toEqual(impact)
    expect(doc.getState().links.items).toEqual([])
    expect(resetConfirmCopy({ people: ["Maya"], more: 0, agents: 1 })).toBe(
      "Disconnects 1 person now (Maya) and 1 agent using these links.",
    )
  })
})

// --- Relay test ----------------------------------------------------------------------------------

const relayInfo: RelayInfo = {
  relayUrl: "https://relay.test",
  name: "kimo-relay",
  version: "1.2.0",
  protocol: "kimo-mp/1",
  limits: {} as RelayInfo["limits"],
  createSecretRequired: false,
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
  test("parsing, reached relay, link valid, decrypting, joined; a quick join shows no card", async () => {
    const clock = fakeClock()
    const { link, room } = await makeLink({ role: "edit" })
    const fake = fakeSession(room, true)
    const model = createMultiplayerModel({
      backend: fakeBackend().backend,
      timers: clock.timers,
      probe: async () => relayInfo,
      join: async () => fake.session,
    })
    const phases: string[] = []
    model.join.subscribe(() => phases.push(model.join.getState().phase))
    const state = await model.join.join(link)
    expect(state.phase).toBe("joined")
    expect(state.key).toBe(`kimo-room:${room}`)
    expect(state.relayHost).toBe("relay.maya.studio")
    expect(state.steps).toEqual({ reachedRelay: true, linkValid: true, decrypted: true })
    expect(state.showCard).toBe(false)
    expect(phases).toContain("connecting")
    expect(phases).toContain("decrypting")
    clock.advance(JOIN_CARD_DELAY_MS)
    expect(model.join.getState().showCard).toBe(false)
  })

  test("a slow join shows the card after 400 ms and waits for the catch-up", async () => {
    const clock = fakeClock()
    const { link, room } = await makeLink()
    const fake = fakeSession(room, false)
    const model = createMultiplayerModel({
      backend: fakeBackend().backend,
      timers: clock.timers,
      probe: async () => relayInfo,
      join: async () => fake.session,
    })
    const done = model.join.join(link)
    await Bun.sleep(0)
    await Bun.sleep(0)
    expect(model.join.getState().phase).toBe("decrypting")
    clock.advance(JOIN_CARD_DELAY_MS)
    expect(model.join.getState().showCard).toBe(true)
    fake.emit({ type: "welcome", role: "view" })
    expect(model.join.getState().steps.linkValid).toBe(true)
    fake.emit({ type: "caught-up", since: 1 })
    const state = await done
    expect(state.phase).toBe("joined")
    expect(state.role).toBe("edit")
  })

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

// --- Agent pauses --------------------------------------------------------------------------------

describe("paused agents", () => {
  const setup = () => {
    const store = new YjsDocStore()
    store.apply(
      [
        { op: "insert", id: "Hero000001", node: { type: "frame", name: "Hero", w: 100, h: 100 } },
        {
          op: "insert",
          id: "Rect000001",
          parent: "Hero000001",
          node: { type: "rect", name: "R", w: 5, h: 5 },
        },
        { op: "insert", id: "Else000001", node: { type: "rect", name: "E", w: 5, h: 5 } },
      ],
      { origin: "user" },
    )
    const registry = claimsFor(store)
    const clock = fakeClock()
    const stopped: string[] = []
    const pauses = new AgentPauses(registry, {
      timers: clock.timers,
      onStop: (h) => stopped.push(h),
    })
    const holder = "agent:kimo.ab.1"
    registry.claim(holder, ["Hero000001"], { label: "Kimo" })
    const human = (id: string, name: string) =>
      store.apply({ op: "update", id, set: { name } }, { origin: "user" })
    return { store, registry, clock, pauses, holder, human, stopped }
  }

  test("a person editing inside the claim pauses the agent; it resumes after 10 s quiet", async () => {
    const { pauses, holder, human, clock } = setup()
    expect(pauses.isPaused(holder)).toBe(false)
    human("Else000001", "outside")
    expect(pauses.isPaused(holder)).toBe(false)
    human("Rect000001", "inside")
    expect(pauses.isPaused(holder)).toBe(true)
    expect(pauses.list()[0]).toMatchObject({
      holder,
      label: "Kimo",
      ids: ["Rect000001"],
      by: "local",
    })
    let resumed = false
    void pauses.waitUntilResumed(holder).then(() => {
      resumed = true
    })
    // Another edit 6 s later restarts the 10 s.
    clock.advance(6_000)
    human("Rect000001", "again")
    clock.advance(AGENT_RESUME_MS - 1)
    expect(pauses.isPaused(holder)).toBe(true)
    clock.advance(1)
    expect(pauses.isPaused(holder)).toBe(false)
    await Bun.sleep(0)
    expect(resumed).toBe(true)
    expect(pauses.list()).toEqual([])
  })

  test("Resume now and Stop", () => {
    const { pauses, holder, human, registry, stopped } = setup()
    human("Rect000001", "inside")
    pauses.resumeNow(holder)
    expect(pauses.isPaused(holder)).toBe(false)
    // The same edit does not pause again; a new one does.
    human("Rect000001", "inside 2")
    expect(pauses.isPaused(holder)).toBe(true)
    pauses.stop(holder)
    expect(pauses.isPaused(holder)).toBe(false)
    expect(registry.list().filter((c) => c.holder === holder)).toEqual([])
    expect(stopped).toEqual([holder])
  })
})
