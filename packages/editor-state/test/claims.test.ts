import { describe, expect, test } from "bun:test"
import {
  CLAIM_EXPIRING_MS,
  CLAIM_TTL_MS,
  type ClaimRecord,
  ClaimRegistry,
  claimsFor,
  claimTeam,
  releaseClaims,
  YjsDocStore,
} from "../src/index"
import { emptyStore, frame, ok, rect } from "./helpers"

const A = "agent:kimo.aaaaaa.1"
const B = "agent:kimo.bbbbbb.1"

/**
 * Page00001
 *   Card00001
 *     Title0001
 *     Price0001
 *   Card00002
 * Other0001
 */
function tree(): YjsDocStore {
  const s = emptyStore()
  ok(
    s.apply(
      [
        { op: "insert", id: "Page00001", node: frame("Page") },
        { op: "insert", id: "Card00001", parent: "Page00001", node: frame("Card 1") },
        { op: "insert", id: "Title0001", parent: "Card00001", node: rect("Title") },
        { op: "insert", id: "Price0001", parent: "Card00001", node: rect("Price") },
        { op: "insert", id: "Card00002", parent: "Page00001", node: frame("Card 2") },
        { op: "insert", id: "Other0001", node: frame("Other") },
      ],
      { origin: "user" },
    ),
  )
  return s
}

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

function registry(store: YjsDocStore, now: () => number) {
  return new ClaimRegistry(store, { now, timers: false })
}

const record = (holder: string, ids: string[], since: number, extra: Partial<ClaimRecord> = {}) =>
  ({ holder, ids, since, renewed: since, ...extra }) as ClaimRecord

describe("overlap", () => {
  test("a claim covers its subtree, its ancestors conflict, siblings and other branches do not", () => {
    const c = clock()
    const r = registry(tree(), c.now)
    expect(r.claim(A, ["Card00001"], { label: "Kimo" })).toBeNull()
    // Descendant of the claim.
    expect(r.check(B, ["Title0001"])).toMatchObject({
      holder: A,
      holderLabel: "Kimo",
      ids: ["Card00001"],
      touched: ["Title0001"],
    })
    // Ancestor of the claim (editing the page touches the card's area).
    expect(r.check(B, ["Page00001"])?.touched).toEqual(["Page00001"])
    // The node itself.
    expect(r.check(B, ["Card00001"])).not.toBeNull()
    // A sibling and another top-level frame are free.
    expect(r.check(B, ["Card00002"])).toBeNull()
    expect(r.check(B, ["Other0001", "Card00002"])).toBeNull()
    // The holder is never blocked by its own claim.
    expect(r.check(A, ["Title0001", "Page00001"])).toBeNull()
  })

  test("claim refuses on conflict and changes nothing; covered ids are not claimed twice", () => {
    const c = clock()
    const r = registry(tree(), c.now)
    expect(r.claim(A, ["Card00001"])).toBeNull()
    expect(r.claim(B, ["Title0001", "Other0001"])?.holder).toBe(A)
    expect(r.list().filter((v) => v.holder === B)).toEqual([])
    r.claim(A, ["Title0001"])
    expect(r.localRecords()).toHaveLength(1)
    expect(r.covers(A, "Price0001")).toBe(true)
    expect(r.covers(A, "Card00002")).toBe(false)
  })

  test("agents of one session (a lead and its children) never block each other", () => {
    const r = registry(tree(), clock().now)
    r.claim("agent:kimo.aaaaaa.0", ["Page00001"])
    expect(claimTeam("agent:kimo.aaaaaa.2")).toBe("agent:kimo.aaaaaa")
    expect(r.check("agent:kimo.aaaaaa.2", ["Title0001"])).toBeNull()
    expect(r.claim("agent:kimo.aaaaaa.2", ["Card00001"])).toBeNull()
    expect(r.check(B, ["Title0001"])?.holder).toBe("agent:kimo.aaaaaa.0")
    expect(claimTeam("mcp:codex.x1")).toBe("mcp:codex.x1")
  })

  test("remote claims conflict like local ones and name the peer", () => {
    const c = clock()
    const r = registry(tree(), c.now)
    r.setRemote(7, [record(B, ["Card00002"], c.now(), { label: "Agent 2" })])
    expect(r.check(A, ["Card00002"])).toMatchObject({ holder: B, peer: 7, holderLabel: "Agent 2" })
    // The same origin on another client is another holder.
    expect(r.check(B, ["Card00002"])?.peer).toBe(7)
    expect(r.claimAt("Card00002")?.holder).toBe(B)
    expect(r.claimAt("Title0001")).toBeUndefined()
  })
})

describe("simultaneous claims", () => {
  test("the earlier claim wins; the local loser lets go of the overlapping ids", () => {
    const c = clock()
    const r = registry(tree(), c.now)
    r.claim(A, ["Card00001", "Other0001"])
    // Both took Card00001 before seeing each other; the remote one is older.
    r.setRemote(3, [record(B, ["Card00001"], c.now() - 5)])
    expect(r.covers(A, "Card00001")).toBe(false)
    expect(r.covers(A, "Other0001")).toBe(true)
    expect(r.check(A, ["Title0001"])?.holder).toBe(B)
  })

  test("same time: the lower holder id wins, on both sides", () => {
    const c = clock()
    const t = c.now()
    // Client of A (lower id): keeps its claim.
    const ra = registry(tree(), c.now)
    ra.claim(A, ["Card00001"])
    ra.setRemote(2, [record(B, ["Card00001"], t)])
    expect(ra.covers(A, "Card00001")).toBe(true)
    // Client of B: lets go.
    const rb = registry(tree(), c.now)
    rb.claim(B, ["Card00001"])
    rb.setRemote(1, [record(A, ["Card00001"], t)])
    expect(rb.covers(B, "Card00001")).toBe(false)
    expect(rb.check(B, ["Card00001"])?.holder).toBe(A)
  })
})

describe("expiry and release", () => {
  test("a claim lapses after the TTL without renewal; activity renews it", () => {
    const c = clock()
    const r = registry(tree(), c.now)
    r.claim(A, ["Card00001"])
    c.advance(CLAIM_TTL_MS - CLAIM_EXPIRING_MS + 1)
    expect(r.list()[0]?.state).toBe("expiring")
    r.renew(A)
    expect(r.list()[0]?.state).toBe("live")
    c.advance(CLAIM_TTL_MS - 1)
    expect(r.check(B, ["Card00001"])).not.toBeNull()
    c.advance(2)
    expect(r.check(B, ["Card00001"])).toBeNull()
    expect(r.list()).toEqual([])
  })

  test("remote claims lapse on the local clock unless the peer renews them", () => {
    const c = clock()
    const r = registry(tree(), c.now)
    // The peer's clock is far behind: expiry uses the receipt time, not the peer's timestamps.
    r.setRemote(4, [record(B, ["Card00001"], 5)])
    c.advance(CLAIM_TTL_MS - 10)
    r.setRemote(4, [record(B, ["Card00001"], 5, { renewed: 6 })])
    c.advance(CLAIM_TTL_MS - 10)
    expect(r.check(A, ["Card00001"])?.holder).toBe(B)
    c.advance(20)
    expect(r.check(A, ["Card00001"])).toBeNull()
  })

  test("release, a peer leaving and a disconnect end claims", () => {
    const c = clock()
    const r = registry(tree(), c.now)
    r.claim(A, ["Card00001"])
    r.setRemote(5, [record(B, ["Card00002"], c.now())])
    r.setRemote(6, [record("mcp:codex.x", ["Other0001"], c.now())])
    expect(r.release(A)).toBe(true)
    expect(r.release(A)).toBe(false)
    r.removePeer(5)
    expect(r.check(A, ["Card00002"])).toBeNull()
    r.clearRemote()
    expect(r.list()).toEqual([])
  })

  test("releaseClaims reaches every document and can be limited to a turn", () => {
    const s1 = tree()
    const s2 = tree()
    claimsFor(s1).claim(A, ["Card00001"], { turn: "t1" })
    claimsFor(s2).claim(A, ["Card00002"], { turn: "t1" })
    claimsFor(s2).claim(B, ["Other0001"], { turn: "t9" })
    expect(releaseClaims(A, "t0")).toBe(false)
    expect(releaseClaims(A, "t1")).toBe(true)
    expect(claimsFor(s1).list()).toEqual([])
    expect(
      claimsFor(s2)
        .list()
        .map((v) => v.holder),
    ).toEqual([B])
    releaseClaims(B)
    expect(claimsFor(s2).list()).toEqual([])
  })

  test("the snapshot is stable until something changes, and listeners hear changes", () => {
    const c = clock()
    const r = registry(tree(), c.now)
    let calls = 0
    const off = r.subscribe(() => calls++)
    r.claim(A, ["Card00001"])
    const first = r.list()
    expect(r.list()).toBe(first)
    r.release(A)
    expect(r.list()).not.toBe(first)
    expect(calls).toBe(2)
    off()
  })
})

describe("human edits inside a claim", () => {
  test("a person's edit inside the claim is noted once for that agent", () => {
    const s = tree()
    const r = claimsFor(s)
    r.claim(A, ["Card00001"])
    r.claim(B, ["Other0001"])
    ok(s.apply({ op: "update", id: "Title0001", set: { name: "Edited" } }, { origin: "user" }))
    expect(r.humanEdit(A)).toMatchObject({ ids: ["Title0001"], by: "local" })
    expect(r.humanEdit(B)).toBeUndefined()
    expect(r.takeHumanEdit(A)?.ids).toEqual(["Title0001"])
    expect(r.humanEdit(A)).toBeUndefined()
    releaseClaims(A)
    releaseClaims(B)
  })

  test("agent edits, edits outside the claim and file loads are not human edits", () => {
    const s = tree()
    const r = claimsFor(s)
    r.claim(A, ["Card00001"])
    ok(s.apply({ op: "update", id: "Title0001", set: { name: "x" } }, { origin: A }))
    ok(s.apply({ op: "update", id: "Title0001", set: { name: "y" } }, { origin: "mcp:codex.z" }))
    ok(s.apply({ op: "update", id: "Other0001", set: { name: "z" } }, { origin: "user" }))
    expect(r.humanEdit(A)).toBeUndefined()
    releaseClaims(A)
  })

  test("a window's relayed user edit counts; a network change counts unless a remote claim covers it", () => {
    const s = tree()
    const peer = new YjsDocStore()
    peer.applyUpdate(s.encodeStateAsUpdate(), "remote:seed")
    const r = claimsFor(s)
    r.claim(A, ["Card00001"])
    // A later remote claim inside A's area (it lost the tie-break there but has not let go yet).
    r.setRemote(9, [record(B, ["Price0001"], Date.now() + 60_000)])
    // `remote:user`: a person in a window of the document host.
    r.noteChange({
      origin: "remote:user",
      cause: "update",
      revision: s.revision,
      nodes: new Set(["Title0001"]),
      header: false,
    })
    expect(r.takeHumanEdit(A)?.by).toBe("local")
    // From the relay: the peer's own agent area is not a human edit…
    r.noteChange({
      origin: "remote:mp:room",
      cause: "update",
      revision: s.revision,
      nodes: new Set(["Price0001"]),
      header: false,
    })
    expect(r.humanEdit(A)).toBeUndefined()
    // …anything else inside the claim is.
    ok(peer.apply({ op: "update", id: "Title0001", set: { name: "remote" } }, { origin: "user" }))
    s.applyUpdate(peer.encodeStateAsUpdate(s.encodeStateVector()), "remote:mp:room")
    expect(r.humanEdit(A)).toMatchObject({ by: "remote", ids: ["Title0001"] })
    releaseClaims(A)
    expect(r.humanEdit(A)).toBeUndefined()
  })
})
