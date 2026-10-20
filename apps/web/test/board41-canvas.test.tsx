/**
 * Board 41 on the canvas (sections 6, 7, 8): presence throttling, following and docking math,
 * one claim outline per agent, pause / resume / stop actions, the AREA_BUSY card from a tool
 * envelope, the write gate of agents whose tools run in the window.
 */
import { describe, expect, test } from "bun:test"
import type { ToolHost } from "@kimo/ai-agent"
import type { ClaimView } from "@kimo/editor-state"
import { claimsFor, createEmptyDocument, importDocument } from "@kimo/editor-state"
import { renderToStaticMarkup } from "react-dom/server"
import { AreaBusyCard, type AreaBusyEnv } from "../src/agent-panel/AreaBusyCard"
import { pausesFor } from "../src/multiplayer/agent-pause"
import { AreaWaits, agoText, areaBusyCopy, parseAreaBusy } from "../src/multiplayer/area-busy"
import {
  assetState,
  assetSyncStatus,
  claimOutlines,
  createThrottle,
  cursorLabel,
  dockOffscreen,
  followViewport,
  personaOfHolder,
  selectionOutlines,
} from "../src/multiplayer/canvas-model"
import { claimAwareToolHost } from "../src/multiplayer/claim-tools"
import type { PersonView } from "../src/multiplayer/model"
import { ClaimLayer } from "../src/multiplayer-canvas/ClaimLayer"

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

const claim = (c: Partial<ClaimView> & Pick<ClaimView, "holder" | "ids">): ClaimView => ({
  since: 1000,
  renewed: 1000,
  local: false,
  expiresAt: 999_999,
  state: "live",
  ...c,
})

const person = (p: Partial<PersonView> & Pick<PersonView, "peer" | "label">): PersonView => ({
  id: `u${p.peer}`,
  name: p.label,
  guest: null,
  role: "edit",
  owner: false,
  color: "presence-clay",
  idle: false,
  isYou: false,
  cursor: null,
  selection: [],
  page: null,
  viewport: null,
  text: null,
  agents: [],
  ...p,
})

describe("presence (section 6)", () => {
  test("the throttle sends the first value at once and the last one after 50 ms", () => {
    const timers = fakeTimers()
    const sent: number[] = []
    const t = createThrottle<number>((v) => sent.push(v), 50, timers)
    t.push(1)
    t.push(2)
    t.push(3)
    expect(sent).toEqual([1])
    timers.advance(49)
    expect(sent).toEqual([1])
    timers.advance(1)
    expect(sent).toEqual([1, 3])
    timers.advance(100)
    t.push(4)
    expect(sent).toEqual([1, 3, 4])
    t.push(5)
    t.cancel()
    timers.advance(100)
    expect(sent).toEqual([1, 3, 4])
  })

  test("following fits and centers the followed rectangle", () => {
    const v = followViewport({ x: 100, y: 50, w: 800, h: 400 }, { w: 400, h: 400 })
    expect(v).toEqual({ x: 100, y: -150, zoom: 0.5 })
    expect(followViewport({ x: 0, y: 0, w: 0, h: 10 }, { w: 10, h: 10 })).toBeNull()
  })

  test("off-screen people dock 8 px inside the nearest edge with the matching arrow", () => {
    const view = { w: 458, h: 260 }
    const pill = { w: 50, h: 19 }
    expect(dockOffscreen({ x: 10, y: 10 }, view, pill)).toBeNull()
    expect(dockOffscreen({ x: 900, y: 900 }, view, pill)).toEqual({
      x: 400,
      y: 233,
      arrow: "arrow-down-right",
    })
    expect(dockOffscreen({ x: -40, y: 100 }, view, pill)).toEqual({
      x: 8,
      y: 100,
      arrow: "arrow-left",
    })
    expect(dockOffscreen({ x: 200, y: -5 }, view, pill)?.arrow).toBe("arrow-up")
  })

  test("idle label and remote selections: first person's outline, tags side by side", () => {
    expect(cursorLabel({ label: "Jonas", idle: true })).toBe("Jonas · idle")
    const people = [
      person({ peer: 1, label: "You", isYou: true, selection: ["A"] }),
      person({ peer: 2, label: "Jonas", color: "presence-pine", selection: ["C"] }),
      person({ peer: 3, label: "Ana", color: "presence-ochre", selection: ["C", "Gone"] }),
      person({ peer: 4, label: "Off", selection: ["B"], page: "p2" }),
    ]
    const out = selectionOutlines(people, {
      page: "p1",
      box: (id) => (id === "Gone" ? null : { x: 0, y: 0, w: 1, h: 1 }),
    })
    expect(out.map((s) => s.id)).toEqual(["C"])
    expect(out[0]?.color).toBe("presence-pine")
    expect(out[0]?.tags.map((t) => t.label)).toEqual(["Jonas", "Ana"])
  })
})

describe("agent claims (section 7)", () => {
  const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {
    Hero: { x: 150, y: 84, w: 560, h: 170 },
    Features: { x: 150, y: 254, w: 560, h: 110 },
    Pricing: { x: 150, y: 364, w: 560, h: 120 },
    Badge: { x: 160, y: 90, w: 20, h: 10 },
  }
  const o = {
    box: (id: string) => boxes[id] ?? null,
    name: (id: string) => id,
  }

  test("one outline per agent: several records of one holder are one union box", () => {
    const out = claimOutlines(
      [
        claim({ holder: "agent:kimo.s1.0", ids: ["Hero"], local: true, label: "Kimo" }),
        claim({ holder: "agent:kimo.s1.0", ids: ["Badge", "Off"], local: true, since: 2000 }),
        claim({ holder: "agent:kimo.m9.3", ids: ["Pricing"], peer: 7, label: "Sol" }),
      ],
      {
        ...o,
        people: [person({ peer: 7, label: "Maya" })],
      },
    )
    expect(out).toHaveLength(2)
    const kimo = out.find((x) => x.holder === "agent:kimo.s1.0")
    expect(kimo?.box).toEqual(boxes.Hero)
    expect(kimo?.ids).toEqual(["Hero", "Badge"])
    expect(kimo?.tag).toBe("Kimo is editing Hero")
    expect(kimo?.persona).toBe("agent")
    const sol = out.find((x) => x.label === "Sol")
    expect(sol?.tag).toBe("Sol · Maya's agent is editing Pricing")
    expect(sol?.persona).toBe("rose")
  })

  test("a page frame the agent also resized gives way to the section it works in", () => {
    const parents: Record<string, string | null> = { Page: null, Card: "Page", Badge: "Card" }
    const out = claimOutlines(
      [
        claim({
          holder: "agent:kimo.s1.0",
          ids: ["Page", "Card", "Badge"],
          local: true,
          label: "Kimo",
        }),
      ],
      {
        box: (id) =>
          ({
            Page: { x: 0, y: 0, w: 1200, h: 1300 },
            Card: { x: 800, y: 400, w: 320, h: 200 },
            Badge: { x: 810, y: 410, w: 40, h: 20 },
          })[id] ?? null,
        name: (id) => id,
        parentOf: (id) => parents[id] ?? null,
      },
    )
    expect(out[0]?.box).toEqual({ x: 800, y: 400, w: 320, h: 200 })
    expect(out[0]?.tag).toBe("Kimo is editing Card")
  })

  test("a paused local agent: warning tag text, its pause attached", () => {
    const out = claimOutlines(
      [claim({ holder: "agent:kimo.s1.1", ids: ["Features"], local: true, label: "Agent 2" })],
      {
        ...o,
        paused: [
          {
            holder: "agent:kimo.s1.1",
            ids: ["Features"],
            by: "local",
            pausedAt: 0,
            resumesAt: 10_000,
          },
        ],
      },
    )
    expect(out[0]?.tag).toBe("Agent 2 paused")
    expect(out[0]?.paused?.resumesAt).toBe(10_000)
    expect(personaOfHolder("agent:kimo.s1.1")).toBe("iris")
    expect(personaOfHolder("mcp:claude-code")).toBe("agent")
  })

  test("the paused note renders Resume now and Stop; the cursor of a remote agent shows", () => {
    const ui = {
      subscribe: () => () => {},
      getState: () => ({ viewport: { x: 0, y: 0, zoom: 1 } }),
    }
    const outlines = claimOutlines(
      [
        claim({ holder: "agent:kimo.s1.1", ids: ["Features"], local: true, label: "Agent 2" }),
        claim({ holder: "agent:kimo.m9.3", ids: ["Pricing"], label: "Sol" }),
      ],
      {
        ...o,
        paused: [
          {
            holder: "agent:kimo.s1.1",
            ids: ["Features"],
            by: "local",
            pausedAt: 0,
            resumesAt: 10_000,
          },
        ],
      },
    )
    const html = renderToStaticMarkup(
      <ClaimLayer outlines={outlines} ui={ui as never} onResume={() => {}} onStop={() => {}} />,
    )
    expect(html).toContain("Resume now")
    expect(html).toContain(">Stop<")
    expect(html).toContain("You edited inside Features. Resumes on its own after 10 s")
    expect(html).toContain('data-testid="agent-cursor"')
    expect(html.match(/data-testid="mp-claim-outline"/g)).toHaveLength(2)
    expect(html).toContain("mp-claim--warning")
  })

  test("Resume now and Stop act on the pause tracker; Stop notifies the agent panel", () => {
    const store = importDocument(createEmptyDocument("t"))
    const registry = claimsFor(store)
    const timers = fakeTimers()
    const pauses = pausesFor(registry, { timers })
    const stopped: string[] = []
    pauses.onStopped((h) => stopped.push(h))
    pauses.stop("agent:kimo.s1.0")
    expect(stopped).toEqual(["agent:kimo.s1.0"])
    pauses.resumeNow("agent:kimo.s1.0")
    expect(pauses.isPaused("agent:kimo.s1.0")).toBe(false)
  })
})

describe("AREA_BUSY (section 7 C)", () => {
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

  test("the envelope parses, the copy reads as on the board", () => {
    const d = parseAreaBusy(envelope)
    expect(d).toEqual({
      holder: "agent:kimo.m9.3",
      holderLabel: "Sol",
      ids: ["Hero"],
      touched: ["Hero"],
      since: 60_000,
    })
    expect(parseAreaBusy({ ok: true })).toBeNull()
    expect(agoText(60_000, 180_000)).toBe("2 min ago")
    expect(
      areaBusyCopy({
        holderLabel: "Sol",
        owner: "Maya",
        frame: "Hero",
        agent: "Kimo",
        since: 60_000,
        now: 180_000,
      }),
    ).toEqual({
      title: "Waiting: Sol is editing Hero",
      desc: "Sol is Maya's agent and claimed Hero 2 min ago. Kimo can work on another frame now, or wait until Hero is free.",
    })
  })

  test("the card renders from the envelope and resolves: wait, work elsewhere, free", () => {
    let claims: ClaimView[] = [claim({ holder: "agent:kimo.m9.3", ids: ["Hero"], label: "Sol" })]
    const listeners = new Set<() => void>()
    const waits = new AreaWaits({
      list: () => claims,
      subscribe: (l) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
    })
    const d = parseAreaBusy(envelope)
    if (!d) throw new Error("no detail")
    waits.noteBusy("c1", "agent:kimo.s1.0", d)
    const env: AreaBusyEnv = {
      waits,
      nodeName: (id) => id,
      ownerOf: () => "Maya",
      now: () => 180_000,
      workingOn: () => "Features",
    }
    const card = () => renderToStaticMarkup(<AreaBusyCard env={env} callId="c1" />)
    expect(card()).toContain("Waiting: Sol is editing Hero")
    expect(card()).toContain("Work elsewhere")
    expect(card()).toContain(">Wait<")
    expect(card()).toContain("AREA_BUSY")

    waits.wait("c1", "agent:kimo.s1.0", d)
    expect(card()).toContain("Stop waiting")
    expect(waits.isWaiting("agent:kimo.s1.0")).toBe(true)
    let passed = false
    void waits.gate("agent:kimo.s1.0").then(() => {
      passed = true
    })

    waits.workElsewhere("c1")
    expect(card()).toContain("Work elsewhere · working on Features instead")

    claims = []
    for (const l of listeners) l()
    expect(card()).toContain("Hero is free · continuing")
    return Promise.resolve().then(() => expect(passed).toBe(true))
  })

  test("writes of a waiting or paused agent wait; AREA_BUSY answers are recorded", async () => {
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
    const { areaWaitsFor } = await import("../src/multiplayer/area-busy")
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
    await wrapped.call({ id: "r1", name: "kimo_query", input: {} }, signal)
    await Promise.resolve()
    expect(done).toBe(false)
    expect(calls).toEqual(["kimo_apply_ops", "kimo_query"])
    waits.setClaims([])
    await write
    expect(calls).toEqual(["kimo_apply_ops", "kimo_query", "kimo_apply_ops"])
  })
})

describe("asset sync (section 8)", () => {
  test("placeholder states and the topbar status while assets move", () => {
    const t = {
      local: new Set(["a"]),
      uploading: ["u"],
      fetching: [{ key: "f", bytes: 3_400_000 }],
      unavailable: ["n"],
      failed: [] as string[],
    }
    expect(assetState("a", t)).toBeNull()
    expect(assetState("u", t)).toBe("uploading")
    expect(assetState("f", t)).toBe("fetching")
    expect(assetState("n", t)).toBe("unavailable")
    expect(assetState("z", t)).toBe("missing")
    expect(assetSyncStatus({ uploading: ["a", "b"], fetching: [] })).toEqual({
      icon: "arrow-up",
      text: "Sharing 2 images",
    })
    expect(assetSyncStatus({ uploading: [], fetching: [1, 2, 3, 4, 5] })?.text).toBe(
      "Fetching 5 images",
    )
  })
})
