/**
 * Board 41 › 11 "Live text" (desing.pen ExORz, rules pCwkf): where remote carets, ranges and
 * flags go and when flags show, from a fake monospace layout (10 px per character, 28 px lines,
 * 20 px type) and a real store for agents' write carets.
 */
import { describe, expect, test } from "bun:test"
import { type ClaimView, createEmptyDocument, YjsDocStore } from "@kimo/editor-state"
import type { TextCharBox, TextGeometry } from "@kimo/renderer"
import { selectionOutlines } from "../src/multiplayer/canvas-model"
import type { PersonView } from "../src/multiplayer/model"
import {
  AGENT_CARET_MS,
  type AgentCaretTimers,
  CaretActivity,
  caretBar,
  caretGroups,
  caretSpot,
  createAgentTextCarets,
  FLAG_FADE_AFTER_MS,
  flagLabel,
  flagRadius,
  flagState,
  flagTop,
  nextFade,
  rangeRows,
  typists,
} from "../src/multiplayer/text-caret-view"
import { agentOfTextChange } from "../src/multiplayer-canvas/MultiplayerCanvas"

/**
 * A monospace layout: `lines` are the start offsets of each line (soft wraps and the line after
 * each newline), 10 px per character, line i at top 28 i, left aligned.
 */
function mono(text: string, lines: number[]): TextGeometry {
  const lineOf = (i: number) => {
    let l = 0
    for (let n = 0; n < lines.length; n++) if ((lines[n] as number) <= i) l = n
    return l
  }
  return {
    text,
    char(i): TextCharBox | null {
      if (i < 0 || i >= text.length || text[i] === "\n") return null
      const line = lineOf(i)
      const col = i - (lines[line] as number)
      return { x0: col * 10, x1: col * 10 + 10, top: line * 28, height: 28, fontSize: 20, line }
    },
    lineStart(line) {
      if (line < 0 || line >= lines.length) return null
      return { x0: 0, x1: 0, top: line * 28, height: 28, fontSize: 20, line }
    },
  }
}

describe("caretSpot: offset to caret", () => {
  // "Plan less. Ship more together, " wraps after the space (31); line 2 starts at 31.
  const text = "Plan less. Ship more together, on one canvas"
  const g = mono(text, [0, 31])

  test("mid line: the right edge of the character before", () => {
    expect(caretSpot(g, 4)).toEqual({ x: 40, top: 0, height: 28, fontSize: 20, firstLine: true })
    expect(caretSpot(g, 35)).toEqual({
      x: 40,
      top: 28,
      height: 28,
      fontSize: 20,
      firstLine: false,
    })
  })

  test("soft wrap: the end of the upper line (upstream affinity, board E)", () => {
    const s = caretSpot(g, 31)
    expect(s?.top).toBe(0)
    expect(s?.x).toBe(310)
    expect(s?.firstLine).toBe(true)
  })

  test("offset 0 and after a newline: the start of the line", () => {
    expect(caretSpot(g, 0)).toMatchObject({ x: 0, top: 0, firstLine: true })
    const h = mono("ab\ncd", [0, 3])
    expect(caretSpot(h, 3)).toMatchObject({ x: 0, top: 28, firstLine: false })
    expect(caretSpot(h, 2)).toMatchObject({ x: 20, top: 0 })
  })

  test("empty lines: an empty text, a trailing newline, two newlines", () => {
    expect(caretSpot(mono("", [0]), 0)).toMatchObject({ x: 0, top: 0, firstLine: true })
    expect(caretSpot(mono("ab\n", [0, 3]), 3)).toMatchObject({ x: 0, top: 28, firstLine: false })
    expect(caretSpot(mono("ab\n\ncd", [0, 3, 4]), 3)).toMatchObject({ x: 0, top: 28 })
    expect(caretSpot(mono("ab\n\ncd", [0, 3, 4]), 4)).toMatchObject({ x: 0, top: 56 })
  })

  test("out of range offsets clamp", () => {
    expect(caretSpot(g, -5)).toMatchObject({ x: 0, top: 0 })
    expect(caretSpot(g, 999)?.top).toBe(28)
  })
})

describe("rangeRows: full line height, one box per line", () => {
  const g = mono("Plan less. Ship more together, on one canvas", [0, 31])
  test("one line", () => {
    expect(rangeRows(g, 21, 29)).toEqual([{ x: 210, y: 0, w: 80, h: 28 }])
  })
  test("across a wrap, backwards selections too", () => {
    const rows = rangeRows(g, 35, 25)
    expect(rows).toEqual([
      { x: 250, y: 0, w: 60, h: 28 },
      { x: 0, y: 28, w: 40, h: 28 },
    ])
  })
  test("a caret has no range", () => {
    expect(rangeRows(g, 5, 5)).toEqual([])
  })
})

describe("bar and flags", () => {
  test("bar: 24 on a 28 line at 20 px (y 2), 9.6 at 40 %", () => {
    expect(caretBar({ height: 28, fontSize: 20 }, 1)).toEqual({ top: 2, height: 24 })
    const z = caretBar({ height: 28, fontSize: 20 }, 0.4)
    expect(z.height).toBeCloseTo(9.6, 5)
    expect(z.top).toBeCloseTo(0.8, 5)
    // Never taller than the line.
    expect(caretBar({ height: 20, fontSize: 20 }, 1)).toEqual({ top: 0, height: 20 })
  })

  test("flag above (y -13, radius 3 3 3 0), below on the first line (y 26, radius 0 3 3 3)", () => {
    const bar = { top: 2, height: 24 }
    expect(flagTop(bar, false, 0)).toBe(-13)
    expect(flagTop(bar, true, 0)).toBe(26)
    expect(flagRadius(false)).toBe("3px 3px 3px 0")
    expect(flagRadius(true)).toBe("0 3px 3px 3px")
  })

  test("stacked flags: 2 apart (board F: Jonas -13, Maya -30)", () => {
    const bar = { top: 2, height: 24 }
    expect(flagTop(bar, false, 1)).toBe(-30)
    expect(flagTop(bar, true, 1)).toBe(43)
  })

  test("idle label", () => {
    expect(flagLabel("Maya", false)).toBe("Maya")
    expect(flagLabel("Maya", true)).toBe("Maya · idle")
  })
})

describe("caretGroups: two carets at one spot", () => {
  test("same node and offset share a group, most recent first", () => {
    const groups = caretGroups([
      { key: "peer:2", node: "T", focus: 17, activeAt: 100 },
      { key: "peer:3", node: "T", focus: 17, activeAt: 200 },
      { key: "peer:4", node: "T", focus: 3, activeAt: 300 },
      { key: "peer:5", node: "U", focus: 17, activeAt: 300 },
    ])
    expect(groups.map((g) => g.map((c) => c.key))).toEqual([
      ["peer:3", "peer:2"],
      ["peer:4"],
      ["peer:5"],
    ])
  })
})

describe("flagState: fade, hover, zoom, drag", () => {
  const base = { now: 10_000, activeAt: 10_000, zoom: 1, hovered: false, dragging: false }
  test("shown for 3 s after the last keystroke, then faded", () => {
    expect(flagState(base)).toBe("shown")
    expect(flagState({ ...base, now: 10_000 + FLAG_FADE_AFTER_MS - 1 })).toBe("shown")
    expect(flagState({ ...base, now: 10_000 + FLAG_FADE_AFTER_MS })).toBe("faded")
    expect(nextFade(10_000, 10_000)).toBe(FLAG_FADE_AFTER_MS)
    expect(nextFade(13_000, 10_000)).toBeNull()
  })
  test("hover shows a faded flag", () => {
    expect(flagState({ ...base, now: 20_000, hovered: true })).toBe("shown")
  })
  test("below 50 % zoom: hidden, a Tooltip on hover; 50 % still shows", () => {
    expect(flagState({ ...base, zoom: 0.49 })).toBe("hidden")
    expect(flagState({ ...base, zoom: 0.4, hovered: true })).toBe("tooltip")
    expect(flagState({ ...base, zoom: 0.5 })).toBe("shown")
  })
  test("hidden while you drag a selection", () => {
    expect(flagState({ ...base, dragging: true })).toBe("hidden")
    expect(flagState({ ...base, dragging: true, hovered: true })).toBe("hidden")
  })
  test("activity: a caret that moves (new positions) is active again", () => {
    const a = new CaretActivity()
    expect(a.touch("peer:2", "x", 100)).toBe(100)
    expect(a.touch("peer:2", "x", 5000)).toBe(100)
    expect(a.touch("peer:2", "y", 6000)).toBe(6000)
    a.keep([])
    expect(a.at("peer:2")).toBe(0)
  })
})

// --- Agents ---------------------------------------------------------------------------------

const TEXT = "Headline01"
const HERO = "Hero000001"
const AGENT = "agent:kimo.s1abc.0"

function heroStore() {
  const s = new YjsDocStore()
  s.loadDocument(createEmptyDocument("Live"))
  const r = s.apply(
    [
      {
        op: "insert",
        id: HERO,
        node: { type: "frame", name: "Hero", x: 0, y: 0, w: 360, h: 120 } as never,
      },
      {
        op: "insert",
        id: TEXT,
        parent: HERO,
        node: { type: "text", content: "Plan less.", style: { font: "Inter", size: 20 } } as never,
      },
    ],
    { origin: "user" },
  )
  if (!r.ok) throw new Error(JSON.stringify(r))
  return s
}

function fakeTimers() {
  let now = 1_000
  let seq = 0
  const pending = new Map<number, { at: number; fn: () => void }>()
  const timers: AgentCaretTimers = {
    now: () => now,
    setTimeout(fn, ms) {
      seq++
      pending.set(seq, { at: now + ms, fn })
      return seq
    },
    clearTimeout(h) {
      pending.delete(h as number)
    },
  }
  const advance = (ms: number) => {
    now += ms
    for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at))
      if (t.at <= now) {
        pending.delete(id)
        t.fn()
      }
  }
  return { timers, advance }
}

const claim = (holder: string, local: boolean, since = 1): ClaimView =>
  ({
    holder,
    ids: [HERO],
    since,
    renewed: since,
    local,
    expiresAt: Number.MAX_SAFE_INTEGER,
    state: "live",
    ...(local ? {} : { peer: 7 }),
  }) as ClaimView

describe("agent carets (no live caret: the end of their latest write)", () => {
  test("a write puts the caret at the end of what changed, for 3 s", () => {
    const store = heroStore()
    const { timers, advance } = fakeTimers()
    const env = { claims: [claim(AGENT, true)], people: [], store }
    const carets = createAgentTextCarets(store, (o, n) => agentOfTextChange(o, n, env), timers)
    let notified = 0
    carets.subscribe(() => notified++)
    // A whole-content write lands as a minimal diff: " Ship more tog" appended.
    store.apply(
      { op: "update", id: TEXT, set: { content: "Plan less. Ship more tog" } },
      { origin: AGENT },
    )
    const [c] = carets.list()
    expect(c?.holder).toBe(AGENT)
    expect(c?.node).toBe(TEXT)
    expect(store.resolveTextPosition(TEXT, c?.position ?? "")).toBe(24)
    expect(notified).toBe(1)
    advance(AGENT_CARET_MS - 1)
    expect(carets.list()).toHaveLength(1)
    advance(1)
    expect(carets.list()).toHaveLength(0)
    carets.dispose()
  })

  test("a later write moves it and restarts the 3 s; an edit in the middle ends there", () => {
    const store = heroStore()
    const { timers, advance } = fakeTimers()
    const env = { claims: [claim(AGENT, true)], people: [], store }
    const carets = createAgentTextCarets(store, (o, n) => agentOfTextChange(o, n, env), timers)
    store.apply({ op: "update", id: TEXT, set: { content: "Plan less. Ship" } }, { origin: AGENT })
    advance(2000)
    store.apply(
      { op: "update", id: TEXT, set: { content: "Plan much less. Ship" } },
      { origin: AGENT },
    )
    const [c] = carets.list()
    expect(store.resolveTextPosition(TEXT, c?.position ?? "")).toBe(10)
    advance(2000)
    expect(carets.list()).toHaveLength(1)
    advance(1000)
    expect(carets.list()).toHaveLength(0)
    carets.dispose()
  })

  test("the caret follows other people's typing before it", () => {
    const store = heroStore()
    const { timers } = fakeTimers()
    const env = { claims: [claim(AGENT, true)], people: [], store }
    const carets = createAgentTextCarets(store, (o, n) => agentOfTextChange(o, n, env), timers)
    store.apply({ op: "update", id: TEXT, set: { content: "Plan less. Ship" } }, { origin: AGENT })
    store.editText(TEXT, [{ op: "insert", at: 0, text: ">> " }], { origin: "user" })
    const [c] = carets.list()
    expect(store.resolveTextPosition(TEXT, c?.position ?? "")).toBe(18)
    carets.dispose()
  })

  test("attribution: inside the agent's claim only; people's own typing is not an agent", () => {
    const store = heroStore()
    const people = [] as { isYou: boolean; text?: { node: string } | null }[]
    const env = {
      claims: [claim(AGENT, true), claim("agent:kimo.m9x2.3", false, 5)],
      people,
      store,
    }
    expect(agentOfTextChange(AGENT, TEXT, env)).toBe(AGENT)
    expect(agentOfTextChange(`remote:${AGENT}`, TEXT, env)).toBe(AGENT)
    expect(agentOfTextChange("agent:other", TEXT, env)).toBeNull()
    expect(agentOfTextChange("user", TEXT, env)).toBeNull()
    // From the room into another client's claim: their agent, unless a person types there.
    expect(agentOfTextChange("remote:mp:room1", TEXT, env)).toBe("agent:kimo.m9x2.3")
    people.push({ isYou: false, text: { node: TEXT } })
    expect(agentOfTextChange("remote:mp:room1", TEXT, env)).toBeNull()
    expect(agentOfTextChange("remote:mp:room1", HERO, { ...env, claims: [] })).toBeNull()
  })
})

describe("outline (section 11 C)", () => {
  const person = (peer: number, label: string, o: Partial<PersonView>): PersonView =>
    ({
      id: label,
      peer,
      label,
      name: label,
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
      ...o,
    }) as PersonView
  const box = () => ({ x: 0, y: 0, w: 10, h: 10 })

  test("a person editing a layer you are not: their outline, no corner tag", () => {
    const maya = person(2, "Maya", {
      selection: [TEXT],
      text: { node: TEXT, anchor: "a", focus: "b" },
    })
    const [o] = selectionOutlines([maya], { page: null, box })
    expect(o?.id).toBe(TEXT)
    expect(o?.color).toBe("presence-clay")
    expect(o?.tags).toEqual([])
  })

  test("the layer you edit keeps your own outline only", () => {
    const maya = person(2, "Maya", {
      selection: [TEXT],
      text: { node: TEXT, anchor: "a", focus: "b" },
    })
    expect(selectionOutlines([maya], { page: null, box, editing: TEXT })).toEqual([])
  })

  test("a plain selection keeps its tag", () => {
    const maya = person(2, "Maya", { selection: [HERO] })
    expect(selectionOutlines([maya], { page: null, box })[0]?.tags).toHaveLength(1)
  })
})

describe("typists: a person's keystrokes", () => {
  test("the person whose caret ends the inserted text typed it", () => {
    const carets = [
      { key: "peer:2", node: "T", focus: 45, kind: "person" },
      { key: "peer:3", node: "T", focus: 10, kind: "person" },
      { key: "agent:x", node: "T", focus: 45, kind: "agent" },
    ]
    expect(typists("T", [{ retain: 44 }, { insert: "s" }], carets)).toEqual(["peer:2"])
    expect(typists("U", [{ retain: 44 }, { insert: "s" }], carets)).toEqual([])
    // A deletion before their caret (backspace): the caret is where it ended.
    expect(typists("T", [{ retain: 10 }, { delete: 1 }], carets)).toEqual(["peer:3"])
  })
  test("bump makes a caret active again without a new signature", () => {
    const a = new CaretActivity()
    a.touch("peer:2", "x", 100)
    a.bump("peer:2", 9000)
    expect(a.at("peer:2")).toBe(9000)
    expect(a.touch("peer:2", "x", 9500)).toBe(9000)
  })
})
