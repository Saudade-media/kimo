import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import {
  applyTextEdits,
  contentOf,
  createEmptyDocument,
  diffTextRuns,
  liveRepresentable,
  type TextChangeEvent,
  type TextRun,
  textOfRuns,
  textRunsOf,
  transformOffset,
  YjsDocStore,
} from "../src/index"
import { emptyStore, ok, rng, syncPair } from "./helpers"

const TEXT = "Text00001"

/** A store holding one text layer with `content`. */
function textStore(content: unknown = "Hello world", options = {}): YjsDocStore {
  const s = emptyStore(options)
  ok(
    s.apply(
      [
        { op: "setHeader", set: { features: ["text/runs"] } },
        { op: "insert", id: TEXT, node: { type: "text", content } as never },
      ],
      { origin: "user" },
    ),
  )
  return s
}

/** A second replica of `a`, synced. */
function replica(a: YjsDocStore, options = {}): YjsDocStore {
  const b = new YjsDocStore({ random: rng(9), ...options })
  b.applyUpdate(a.encodeStateAsUpdate(), "remote:a")
  return b
}

const plain = (s: YjsDocStore) => textOfRuns(s.textRuns(TEXT) ?? [])
const insert = (s: YjsDocStore, at: number, text: string, attrs?: Record<string, unknown>) =>
  ok(
    s.editText(TEXT, [{ op: "insert", at, text, ...(attrs ? { attrs } : {}) }], { origin: "user" }),
  )

describe("live text model", () => {
  test("canonical content round trips; other shapes are not live", () => {
    expect(liveRepresentable("abc")).toBe(true)
    expect(liveRepresentable("")).toBe(true)
    expect(liveRepresentable([{ text: "a", style: { weight: 700 } }, { text: "b" }])).toBe(true)
    // A single bare span reads back as a string, adjacent equal spans as one: kept plain.
    expect(liveRepresentable([{ text: "ab" }])).toBe(false)
    expect(liveRepresentable([{ text: "a" }, { text: "b" }])).toBe(false)
    expect(liveRepresentable([{ text: "" }, { text: "b", fill: "#ff0000" }])).toBe(false)
    expect(liveRepresentable({ $ref: "title" })).toBe(false)
    const runs = textRunsOf([{ text: "a", style: { weight: 700 }, href: "x" }]) as TextRun[]
    expect(runs[0]?.attrs).toEqual({ "style.weight": 700, href: "x" })
    expect(contentOf(runs)).toEqual([{ text: "a", style: { weight: 700 }, href: "x" }])
  })

  test("diff then apply gives the target (property)", () => {
    const attrs = fc.constantFrom<Record<string, unknown>>(
      {},
      { "style.weight": 700 },
      { "style.italic": true },
      { fill: "#ff0000", "style.weight": 700 },
    )
    const runs = fc.array(
      fc.record({
        text: fc.string({ unit: fc.constantFrom("a", "b", "\n", "é"), maxLength: 6 }),
        attrs,
      }),
      { maxLength: 6 },
    )
    fc.assert(
      fc.property(runs, runs, fc.nat(40), (from, to, caret) => {
        const out = applyTextEdits(from, diffTextRuns(from, to, caret))
        expect(contentOf(out)).toEqual(contentOf(to))
      }),
      { numRuns: 300 },
    )
  })

  test("the caret places an insertion among repeated characters", () => {
    const edits = diffTextRuns([{ text: "aa", attrs: {} }], [{ text: "aaa", attrs: {} }], 1)
    expect(edits).toEqual([{ op: "insert", at: 0, text: "a", attrs: {} }])
    const end = diffTextRuns([{ text: "aa", attrs: {} }], [{ text: "aaa", attrs: {} }])
    expect(end).toEqual([{ op: "insert", at: 2, text: "a", attrs: {} }])
  })

  test("offsets follow deltas", () => {
    expect(transformOffset(5, [{ retain: 2 }, { insert: "xyz" }])).toBe(8)
    expect(transformOffset(1, [{ retain: 2 }, { insert: "xyz" }])).toBe(1)
    expect(transformOffset(5, [{ retain: 1 }, { delete: 2 }])).toBe(3)
    expect(transformOffset(2, [{ retain: 1 }, { delete: 4 }])).toBe(1)
    expect(transformOffset(2, [{ retain: 2 }, { insert: "x" }], -1)).toBe(2)
    expect(transformOffset(2, [{ retain: 2 }, { insert: "x" }])).toBe(3)
  })
})

describe("live text in the store", () => {
  test("concurrent inserts at the same offset converge with nobody's typing lost", () => {
    const a = textStore("Hello world")
    const b = replica(a)
    insert(a, 5, ", dear")
    insert(b, 5, " there")
    syncPair(a, b)
    expect(plain(a)).toBe(plain(b))
    expect(plain(a)).toContain(", dear")
    expect(plain(a)).toContain(" there")
    expect(plain(a).length).toBe("Hello world".length + 12)
    expect(a.toDocument()).toEqual(b.toDocument())
  })

  test("formatting by two people merges", () => {
    const a = textStore("Hello world")
    const b = replica(a)
    ok(
      a.editText(TEXT, [{ op: "format", at: 0, length: 5, attrs: { "style.weight": 700 } }], {
        origin: "user",
      }),
    )
    ok(
      b.editText(TEXT, [{ op: "format", at: 3, length: 5, attrs: { "style.italic": true } }], {
        origin: "user",
      }),
    )
    syncPair(a, b)
    const want = [
      { text: "Hel", style: { weight: 700 } },
      { text: "lo", style: { italic: true, weight: 700 } },
      { text: " wo", style: { italic: true } },
      { text: "rld" },
    ]
    expect(a.getNode(TEXT)?.content).toEqual(want)
    expect(b.getNode(TEXT)?.content).toEqual(want)
  })

  test("a whole-content update (an agent) lands as a diff and keeps concurrent typing", () => {
    const a = textStore("The quick fox")
    const b = replica(a)
    // A person types at the start while an agent rewrites the last word.
    insert(a, 0, ">> ")
    ok(
      b.apply({ op: "update", id: TEXT, set: { content: "The quick dog" } }, { origin: "agent:x" }),
    )
    syncPair(a, b)
    expect(plain(a)).toBe(">> The quick dog")
    expect(plain(b)).toBe(">> The quick dog")
  })

  test("an agent's span rewrite keeps the person's typing and applies its formats", () => {
    const a = textStore("Hello world")
    const b = replica(a)
    insert(a, 11, "!")
    ok(
      b.apply(
        {
          op: "update",
          id: TEXT,
          set: { content: [{ text: "Hello", style: { weight: 700 } }, { text: " world" }] },
        },
        { origin: "agent:x" },
      ),
    )
    syncPair(a, b)
    const want = [{ text: "Hello", style: { weight: 700 } }, { text: " world!" }]
    expect(a.getNode(TEXT)?.content).toEqual(want)
    expect(b.getNode(TEXT)?.content).toEqual(want)
  })

  test("undo only undoes the origin's own typing", () => {
    const a = textStore("Hello")
    const b = replica(a)
    insert(a, 5, " A")
    insert(b, 0, "B ")
    syncPair(a, b)
    expect(plain(a)).toBe("B Hello A")
    expect(a.undo("user").ok).toBe(true)
    expect(plain(a)).toBe("B Hello")
    syncPair(a, b)
    expect(plain(b)).toBe("B Hello")
  })

  test("an inline edit: steps undo inside, one step after, never the other person's", () => {
    const a = textStore("Hello")
    const b = replica(a)
    ok(a.apply({ op: "update", id: TEXT, set: { name: "Title" } }, { origin: "user" }))
    const h = a.beginTextEdit(TEXT, "user")
    insert(a, 5, " wor")
    insert(a, 9, "ld")
    h.breakStep()
    ok(
      a.editText(TEXT, [{ op: "format", at: 0, length: 5, attrs: { "style.weight": 700 } }], {
        origin: "user",
      }),
    )
    insert(b, 0, "> ")
    syncPair(a, b)
    expect(plain(a)).toBe("> Hello world")
    // Inside the edit: the format step, then the typing burst.
    expect(h.undo()).toBe(true)
    expect(a.getNode(TEXT)?.content).toBe("> Hello world")
    expect(h.undo()).toBe(true)
    expect(plain(a)).toBe("> Hello")
    expect(h.canUndo).toBe(false)
    expect(h.redo()).toBe(true)
    expect(plain(a)).toBe("> Hello world")
    h.end()
    // After the edit: one step undoes all of it (the other person's text stays).
    expect(a.undo("user").ok).toBe(true)
    expect(plain(a)).toBe("> Hello")
    expect(a.getNode(TEXT)?.name).toBe("Title")
    expect(a.undo("user").ok).toBe(true)
    expect(a.getNode(TEXT)?.name).toBeUndefined()
  })

  test("canonical content reads back as strings and spans, not runs", () => {
    const s = textStore([{ text: "a", style: { weight: 700 } }, { text: "b" }])
    insert(s, 2, "c")
    expect(s.getNode(TEXT)?.content).toEqual([
      { text: "a", style: { weight: 700 } },
      { text: "bc" },
    ])
    ok(
      s.editText(TEXT, [{ op: "format", at: 0, length: 1, attrs: { "style.weight": null } }], {
        origin: "user",
      }),
    )
    expect(s.getNode(TEXT)?.content).toBe("abc")
  })

  test("non-canonical content keeps its exact shape (plain value)", () => {
    const s = textStore([{ text: "ab" }])
    expect(s.getNode(TEXT)?.content).toEqual([{ text: "ab" }])
    expect(replica(s).getNode(TEXT)?.content).toEqual([{ text: "ab" }])
    // Its first live edit makes it canonical live text.
    insert(s, 2, "c")
    expect(s.getNode(TEXT)?.content).toBe("abc")
  })

  test("legacy content (an older client's room) converts on first touch, once", () => {
    const old = textStore("Hello", { liveText: false })
    const a = replica(old)
    const b = replica(old)
    expect(a.getNode(TEXT)?.content).toBe("Hello")
    insert(a, 5, "!")
    syncPair(a, b)
    expect(plain(b)).toBe("Hello!")
    insert(b, 0, "> ")
    syncPair(a, b)
    expect(plain(a)).toBe("> Hello!")
    expect(plain(b)).toBe("> Hello!")
  })

  test("two replicas converting the same legacy text at once lose nothing and double nothing", () => {
    const old = textStore("Hello world", { liveText: false })
    const a = replica(old)
    const b = replica(old)
    insert(a, 0, "A ")
    insert(b, 11, " B")
    syncPair(a, b)
    // Whichever conversion won, the loser's typing was replayed onto it.
    syncPair(a, b)
    expect(plain(a)).toBe("A Hello world B")
    expect(plain(b)).toBe("A Hello world B")
  })

  test("text positions follow edits by others", () => {
    const a = textStore("Hello world")
    const b = replica(a)
    const pos = a.encodeTextPosition(TEXT, 6) as string
    expect(typeof pos).toBe("string")
    expect(b.resolveTextPosition(TEXT, pos)).toBe(6)
    insert(b, 0, "Oh, ")
    syncPair(a, b)
    expect(a.resolveTextPosition(TEXT, pos)).toBe(10)
    expect(b.resolveTextPosition(TEXT, pos)).toBe(10)
    expect(a.resolveTextPosition(TEXT, "garbage")).toBeNull()
    expect(a.resolveTextPosition("Nope00001", pos)).toBeNull()
  })

  test("text changes carry the delta and the origin; the hook runs before other changes", () => {
    const a = textStore("Hello")
    const b = replica(a)
    const seen: TextChangeEvent[] = []
    b.onTextChange((e) => seen.push(e))
    let before = 0
    b.onBeforeChange(() => {
      before++
    })
    insert(a, 5, "!")
    b.applyUpdate(a.encodeStateAsUpdate(b.encodeStateVector()), "remote:a")
    expect(before).toBe(1)
    expect(seen).toEqual([
      { id: TEXT, delta: [{ retain: 5 }, { insert: "!" }], origin: "remote:a", cause: "update" },
    ])
  })

  test("edits outside the text and texts without content fail", () => {
    const s = textStore("abc")
    expect(s.editText(TEXT, [{ op: "insert", at: 9, text: "x" }], { origin: "user" }).ok).toBe(
      false,
    )
    expect(s.editText("Nope00001", [], { origin: "user" }).ok).toBe(false)
    const e = new YjsDocStore()
    e.loadDocument(createEmptyDocument())
    expect(e.textRuns(TEXT)).toBeNull()
  })
})
