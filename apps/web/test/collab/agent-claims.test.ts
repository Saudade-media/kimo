/**
 * Agents editing next to people: a person's edit inside an agent's claim pauses it, and an agent
 * that hits another agent's claim (AREA_BUSY) waits until the area is free.
 */
import { describe, expect, test } from "bun:test"
import type { ToolHost } from "@kimo/ai-agent"
import {
  type ClaimView,
  claimsFor,
  createEmptyDocument,
  importDocument,
  YjsDocStore,
} from "@kimo/editor-state"
import { AGENT_RESUME_MS, AgentPauses } from "../../src/multiplayer/agent-pause"
import { areaWaitsFor, parseAreaBusy } from "../../src/multiplayer/area-busy"
import { claimAwareToolHost } from "../../src/multiplayer/claim-tools"

/** A manual clock: timers run only when the test advances time. */
function fakeTimers() {
  let t = 0
  const q: { at: number; fn: () => void; id: number }[] = []
  let n = 0
  return {
    now: () => t,
    setTimeout: (fn: () => void, ms: number) => {
      const id = ++n
      q.push({ at: t + ms, fn, id })
      return id
    },
    clearTimeout: (h: unknown) => {
      const i = q.findIndex((x) => x.id === h)
      if (i >= 0) q.splice(i, 1)
    },
    advance(ms: number) {
      t += ms
      for (const x of [...q].sort((a, b) => a.at - b.at))
        if (x.at <= t) {
          q.splice(q.indexOf(x), 1)
          x.fn()
        }
    },
  }
}

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
    const clock = fakeTimers()
    const stopped: string[] = []
    const pauses = new AgentPauses(registry, {
      timers: clock,
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

describe("AREA_BUSY", () => {
  const envelope = {
    ok: false,
    rolledBack: true,
    errors: [
      {
        code: "AREA_BUSY",
        message: "Sol is working on this area (1 claimed layer).",
        retryable: true,
        detail: {
          kind: "area",
          holder: "agent:kimo.m9.3",
          holderLabel: "Sol",
          ids: ["Hero"],
          touched: ["Hero"],
          since: new Date(60_000).toISOString(),
        },
      },
    ],
  }

  const claim = (c: Pick<ClaimView, "holder" | "ids">): ClaimView => ({
    since: 1000,
    renewed: 1000,
    local: false,
    expiresAt: 999_999,
    state: "live",
    ...c,
  })

  test("the tool error envelope parses into the busy area", () => {
    expect(parseAreaBusy(envelope)).toEqual({
      holder: "agent:kimo.m9.3",
      holderLabel: "Sol",
      ids: ["Hero"],
      touched: ["Hero"],
      since: 60_000,
    })
    expect(parseAreaBusy({ ok: true })).toBeNull()
  })

  test("writes of a waiting agent wait until the area is free; AREA_BUSY answers are recorded", async () => {
    const store = importDocument(createEmptyDocument("t"))
    const calls: string[] = []
    const host: ToolHost = {
      tools: () => [],
      call: async (c) => {
        calls.push(c.name)
        return {
          result: (c.name === "kimo_apply_ops" ? envelope : { ok: true }) as never,
        }
      },
    }
    const origin = "agent:kimo.s1.0"
    const wrapped = claimAwareToolHost(host, { origin, store })
    const signal = new AbortController().signal
    await wrapped.call({ id: "x1", name: "kimo_apply_ops", input: {} }, signal)
    const waits = areaWaitsFor(store)
    expect(waits.busy("x1")?.detail.holderLabel).toBe("Sol")

    // Wait on an area another agent holds: the next write is held until it is free.
    claimsFor(store).add("agent:kimo.m9.3", ["Hero"], { label: "Sol" })
    waits.setClaims([claim({ holder: "agent:kimo.m9.3", ids: ["Hero"] })])
    waits.wait("x1", origin, { holder: "agent:kimo.m9.3", ids: ["Hero"] })
    let done = false
    const write = wrapped.call({ id: "x2", name: "kimo_apply_ops", input: {} }, signal).then(() => {
      done = true
    })
    // Reads go through; the write does not.
    await wrapped.call({ id: "r1", name: "kimo_query", input: {} }, signal)
    await Promise.resolve()
    expect(done).toBe(false)
    expect(calls).toEqual(["kimo_apply_ops", "kimo_query"])
    waits.setClaims([])
    await write
    expect(calls).toEqual(["kimo_apply_ops", "kimo_query", "kimo_apply_ops"])
  })
})
