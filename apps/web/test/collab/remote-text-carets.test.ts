/**
 * Remote text carets: where an offset lands in a text layout (from a fake monospace layout, 10 px
 * per character, 28 px lines) and where an agent's caret sits after a write.
 */
import { describe, expect, test } from "bun:test"
import { type ClaimView, createEmptyDocument, YjsDocStore } from "@kimo/editor-state"
import type { TextCharBox, TextGeometry } from "@kimo/renderer"
import {
  AGENT_CARET_MS,
  type AgentCaretTimers,
  caretSpot,
  createAgentTextCarets,
  rangeRows,
} from "../../src/multiplayer/text-caret-view"
import { agentOfTextChange } from "../../src/multiplayer-canvas/MultiplayerCanvas"

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

  test("soft wrap: the end of the upper line (upstream affinity)", () => {
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
})

describe("rangeRows: one box per line", () => {
  const g = mono("Plan less. Ship more together, on one canvas", [0, 31])
  test("across a wrap, backwards selections too", () => {
    const rows = rangeRows(g, 35, 25)
    expect(rows).toEqual([
      { x: 250, y: 0, w: 60, h: 28 },
      { x: 0, y: 28, w: 40, h: 28 },
    ])
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
