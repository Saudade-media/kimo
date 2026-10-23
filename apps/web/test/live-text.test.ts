/**
 * Live text (ADR 0016 item 17): an inline text edit of a document text layer reaches the
 * document as it happens (typing batched, style at once), takes other people's changes while
 * the person types (caret moved through them, held back during an IME composition), and undoes
 * only the person's own steps, the whole edit being one undo step once it ends.
 */
import { describe, expect, test } from "bun:test"
import { createEmptyDocument, type NodeData, YjsDocStore } from "@kimo/editor-state"
import { createLiveText } from "../src/canvas/rich-text/live"
import { runsOf } from "../src/canvas/rich-text/model"
import { LIVE_BATCH_MS, RichTextSession } from "../src/canvas/rich-text/session"
import type { PersonView } from "../src/multiplayer/model"
import { localTextPresence, remoteTextCarets } from "../src/multiplayer/text-carets"

const ID = "Text000001"

function stores(content = "Hello world") {
  const a = new YjsDocStore()
  a.loadDocument(createEmptyDocument("Live"))
  const r = a.apply(
    {
      op: "insert",
      id: ID,
      node: { type: "text", content, style: { font: "Inter", size: 16 } } as never,
    },
    { origin: "user" },
  )
  if (!r.ok) throw new Error(JSON.stringify(r))
  const b = new YjsDocStore()
  b.applyUpdate(a.encodeStateAsUpdate(), "remote:a")
  return { a, b }
}

/** Sends `from`'s news to `to` as a network update would arrive. */
const send = (from: YjsDocStore, to: YjsDocStore) =>
  to.applyUpdate(from.encodeStateAsUpdate(to.encodeStateVector()), "remote:peer")

function session(store: YjsDocStore) {
  const node = store.getNode(ID) as NodeData
  const s = new RichTextSession(ID, node, runsOf(node), true)
  const link = createLiveText(store, ID, "user")
  if (!link) throw new Error("not live")
  s.attach(link)
  return s
}

const content = (s: YjsDocStore) => s.getNode(ID)?.content

describe("live text session", () => {
  test("typing reaches the document within the batch; a style change at once", async () => {
    const { a } = stores()
    const s = session(a)
    expect(s.live).toBe(true)
    s.select({ anchor: 11, focus: 11 })
    s.insert("!")
    s.insert("!")
    expect(content(a)).toBe("Hello world")
    await Bun.sleep(LIVE_BATCH_MS + 30)
    expect(content(a)).toBe("Hello world!!")
    s.select({ anchor: 0, focus: 5 })
    s.toggle("bold")
    expect(content(a)).toEqual([{ text: "Hello", style: { weight: 700 } }, { text: " world!!" }])
    expect(a.toHeader().features).toContain("text/runs")
    s.dispose()
  })

  test("a remote change while typing: pending typing goes first, the caret moves with it", () => {
    const { a, b } = stores()
    const s = session(a)
    s.select({ anchor: 11, focus: 11 })
    s.insert("?")
    // Someone types at the start; their update arrives before our batch was written.
    b.editText(ID, [{ op: "insert", at: 0, text: ">> " }], { origin: "user" })
    send(b, a)
    expect(s.text).toBe(">> Hello world?")
    expect(s.sel).toEqual({ anchor: 15, focus: 15 })
    s.insert("!")
    s.flush()
    send(a, b)
    expect(content(a)).toBe(">> Hello world?!")
    expect(content(b)).toBe(">> Hello world?!")
    s.dispose()
  })

  test("text typed by someone else at the caret lands after it", () => {
    const { a, b } = stores("ab")
    const s = session(a)
    s.select({ anchor: 1, focus: 1 })
    b.editText(ID, [{ op: "insert", at: 1, text: "XY" }], { origin: "user" })
    send(b, a)
    expect(s.text).toBe("aXYb")
    expect(s.sel).toEqual({ anchor: 1, focus: 1 })
    s.insert("1")
    s.flush()
    expect(content(a)).toBe("a1XYb")
    s.dispose()
  })

  test("an IME composition holds remote changes until it ends", () => {
    const { a, b } = stores("Hello world")
    const s = session(a)
    s.select({ anchor: 5, focus: 5 })
    let renders = 0
    s.onRender(() => renders++)
    s.compositionStart()
    b.editText(ID, [{ op: "insert", at: 0, text: "Oh " }], { origin: "user" })
    send(b, a)
    // The composing DOM is not touched.
    expect(s.text).toBe("Hello world")
    expect(renders).toBe(0)
    // The composition put "ん" at the caret.
    const runs = runsOf({ ...(a.getNode(ID) as object), content: "Helloん world" })
    s.compositionEnd(runs, { anchor: 6, focus: 6 })
    expect(s.text).toBe("Oh Helloん world")
    expect(s.sel).toEqual({ anchor: 9, focus: 9 })
    s.flush()
    expect(content(a)).toBe("Oh Helloん world")
    s.dispose()
  })

  test("undo inside the edit walks only the person's own steps; after, one step", () => {
    const { a, b } = stores("Hello")
    const s = session(a)
    s.select({ anchor: 5, focus: 5 })
    s.insert(" wor")
    s.insert("ld")
    s.select({ anchor: 0, focus: 5 })
    s.toggle("italic")
    b.editText(ID, [{ op: "insert", at: 0, text: "> " }], { origin: "user" })
    send(b, a)
    expect(s.text).toBe("> Hello world")
    expect(s.undo()).toBe(true)
    expect(content(a)).toBe("> Hello world")
    expect(s.undo()).toBe(true)
    expect(content(a)).toBe("> Hello")
    expect(s.sel).toEqual({ anchor: 7, focus: 7 })
    expect(s.undo()).toBe(false)
    expect(s.redo()).toBe(true)
    expect(s.text).toBe("> Hello world")
    s.dispose()
    // After the edit: one "Edit text" step; the other person's text stays.
    expect(a.undo("user").ok).toBe(true)
    expect(content(a)).toBe("> Hello")
    expect(a.canUndo("user")).toBe(true) // the insert of the text itself
  })

  test("a remote node change (fill) re-reads the runs, keeping the selection", () => {
    const { a, b } = stores()
    const s = session(a)
    s.select({ anchor: 2, focus: 4 })
    b.apply({ op: "update", id: ID, set: { fill: "#ff0000" } }, { origin: "user" })
    send(b, a)
    expect(s.runs[0]?.attrs.fill).toBe("#ff0000")
    expect(s.sel).toEqual({ anchor: 2, focus: 4 })
    s.dispose()
  })

  test("remote carets: published as positions that follow edits, read back as offsets", () => {
    const { a, b } = stores("Hello world")
    const s = session(a)
    s.select({ anchor: 6, focus: 11 })
    s.insert("there", "other")
    const text = localTextPresence(s, a)
    expect(text?.node).toBe(ID)
    send(a, b)
    const ana: PersonView = {
      id: "u1",
      peer: 7,
      label: "Ana",
      name: "Ana",
      guest: null,
      role: "edit",
      owner: false,
      color: "presence-pine",
      idle: false,
      isYou: false,
      cursor: null,
      selection: [ID],
      page: null,
      viewport: null,
      text,
      agents: [],
    }
    const view = { people: [ana], agents: [] }
    expect(remoteTextCarets(view, b, ID)).toEqual([
      {
        key: "peer:7",
        kind: "person",
        peer: 7,
        label: "Ana",
        color: "presence-pine",
        idle: false,
        anchor: 11,
        focus: 11,
      },
    ])
    // Someone types before the caret: it moves with the text.
    b.editText(ID, [{ op: "insert", at: 0, text: "Oh, " }], { origin: "user" })
    expect(remoteTextCarets(view, b, ID)[0]?.focus).toBe(15)
    expect(remoteTextCarets(view, b, "Other00001")).toEqual([])
    expect(remoteTextCarets({ people: [{ ...ana, isYou: true }], agents: [] }, b, ID)).toEqual([])
    s.dispose()
    expect(localTextPresence(s, a)).toBeNull()
  })
})
