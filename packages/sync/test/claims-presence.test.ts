import { describe, expect, test } from "bun:test"
import {
  ClaimRegistry,
  createEmptyDocument,
  type LocalOrigin,
  YjsDocStore,
} from "@kimo/editor-state"
import { type Awareness, bindClaimsToPresence, type PresenceState, parseClaims } from "../src/index"

type Change = { added: number[]; updated: number[]; removed: number[] }

/** A bounded in-memory presence room: every awareness sees the others' states synchronously. */
class FakeRoom {
  readonly members = new Map<number, FakeAwareness>()
  join(peer: number): FakeAwareness {
    const a = new FakeAwareness(this, peer)
    this.members.set(peer, a)
    for (const other of this.members.values())
      if (other !== a && other.local) a.emit({ added: [other.clientId], updated: [], removed: [] })
    return a
  }
  broadcast(from: FakeAwareness, change: Change): void {
    for (const m of this.members.values()) if (m !== from) m.emit(change)
  }
  leave(a: FakeAwareness): void {
    this.members.delete(a.clientId)
    for (const m of this.members.values()) m.emit({ added: [], updated: [], removed: [a.clientId] })
  }
}

class FakeAwareness implements Awareness {
  local: PresenceState | null = null
  private readonly listeners = new Set<(c: Change) => void>()
  sets = 0
  constructor(
    private readonly room: FakeRoom,
    readonly clientId: number,
  ) {}
  getLocalState() {
    return this.local
  }
  setLocalState(state: Omit<PresenceState, "origin"> | null) {
    const had = this.local !== null
    this.sets++
    // Round trip through JSON like the sealed envelope.
    this.local = state
      ? { ...(JSON.parse(JSON.stringify(state)) as PresenceState), origin: "user" as LocalOrigin }
      : null
    const change: Change = this.local
      ? { added: had ? [] : [this.clientId], updated: had ? [this.clientId] : [], removed: [] }
      : { added: [], updated: [], removed: [this.clientId] }
    this.emit(change)
    this.room.broadcast(this, change)
  }
  getStates() {
    const out = new Map<number, PresenceState>()
    for (const m of this.room.members.values()) if (m.local) out.set(m.clientId, m.local)
    return out
  }
  onChange(l: (c: Change) => void) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  emit(c: Change) {
    for (const l of [...this.listeners]) l(c)
  }
}

function store(): YjsDocStore {
  const s = new YjsDocStore()
  s.loadDocument(createEmptyDocument("Claims"))
  const r = s.apply(
    [
      { op: "insert", id: "Frame00001", node: { type: "frame", name: "One" } },
      { op: "insert", id: "Frame00002", node: { type: "frame", name: "Two" } },
    ],
    { origin: "user" },
  )
  if (!r.ok) throw new Error(JSON.stringify(r))
  return s
}

const user = (name: string) => ({ id: name, name, color: "#3366ff" })

describe("claims over presence", () => {
  test("local claims are published, remote ones feed the registry, leaving drops them", () => {
    const room = new FakeRoom()
    const pa = room.join(1)
    const pb = room.join(2)
    const ra = new ClaimRegistry(store(), { timers: false })
    const rb = new ClaimRegistry(store(), { timers: false })
    const offA = bindClaimsToPresence(ra, pa, { user: user("a") })
    const offB = bindClaimsToPresence(rb, pb, { user: user("b") })
    // Nothing claimed and no app presence: nothing is published.
    expect(pa.local).toBeNull()

    ra.claim("agent:kimo.a.1", ["Frame00001"], { label: "Kimo", turn: "t1" })
    expect(pa.local?.claims?.[0]).toMatchObject({
      holder: "agent:kimo.a.1",
      ids: ["Frame00001"],
      label: "Kimo",
      turn: "t1",
    })
    expect(pa.local?.working).toEqual(["Frame00001"])
    expect(rb.check("agent:kimo.b.1", ["Frame00001"])).toMatchObject({
      holder: "agent:kimo.a.1",
      peer: 1,
    })
    expect(rb.check("agent:kimo.b.1", ["Frame00002"])).toBeNull()

    // The app replaces its presence (a cursor move): the claims stay published.
    pa.setLocalState({ user: user("a"), cursor: { x: 1, y: 2 } })
    expect(pa.local?.claims).toHaveLength(1)
    expect(pa.local?.cursor).toEqual({ x: 1, y: 2 })

    // Released at turn end: withdrawn from presence, `working` too.
    ra.release("agent:kimo.a.1")
    expect(pa.local?.claims).toBeUndefined()
    expect(pa.local?.working).toBeUndefined()
    expect(rb.list()).toEqual([])

    // A peer that leaves takes its claims with it.
    rb.claim("agent:kimo.b.1", ["Frame00002"])
    expect(ra.check("agent:kimo.a.1", ["Frame00002"])?.peer).toBe(2)
    room.leave(pb)
    expect(ra.check("agent:kimo.a.1", ["Frame00002"])).toBeNull()
    offA()
    offB()
  })

  test("simultaneous claims: the later one lets go after the next presence update", () => {
    const room = new FakeRoom()
    const pa = room.join(1)
    const pb = room.join(2)
    let t = 1000
    const now = () => t
    const ra = new ClaimRegistry(store(), { now, timers: false })
    const rb = new ClaimRegistry(store(), { now, timers: false })
    // Both claim the same frame before either published (presence not bound yet).
    ra.claim("agent:kimo.a.1", ["Frame00001"])
    t = 1001
    rb.claim("agent:kimo.b.1", ["Frame00001"])
    bindClaimsToPresence(ra, pa, { user: user("a") })
    bindClaimsToPresence(rb, pb, { user: user("b") })
    expect(ra.covers("agent:kimo.a.1", "Frame00001")).toBe(true)
    expect(rb.covers("agent:kimo.b.1", "Frame00001")).toBe(false)
    expect(rb.check("agent:kimo.b.1", ["Frame00001"])?.holder).toBe("agent:kimo.a.1")
    // The loser withdrew its record.
    expect(pb.local?.claims).toBeUndefined()
  })

  test("published claims are validated on receipt", () => {
    expect(
      parseClaims([
        { holder: "agent:x", ids: ["A"], since: 1, renewed: 2, label: "L", turn: "t" },
        { holder: "user", ids: ["A"], since: 1, renewed: 1 },
        { holder: "mcp:c", ids: [], since: 1, renewed: 1 },
        { holder: "mcp:c", ids: ["A"], since: "1", renewed: 1 },
        { holder: "mcp:c", ids: [1], since: 1, renewed: 1 },
        null,
      ]),
    ).toEqual([{ holder: "agent:x", ids: ["A"], since: 1, renewed: 2, label: "L", turn: "t" }])
    expect(parseClaims("nope")).toEqual([])
  })
})
