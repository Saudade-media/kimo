/**
 * Board 30 "Rich text": the inline editor's model (runs with effective attributes, canonical
 * write-back), its session (typing attributes, toggles, local undo) and the Design tab bridge
 * (virtual selections, "Mixed", range edits → spans).
 */
import { describe, expect, test } from "bun:test"
import type { NodeData, Op } from "@kimo/editor-state"
import {
  applyAttrs,
  groupsIn,
  plainText,
  replaceText,
  runsOf,
  toNodePatch,
  virtualNode,
} from "../src/canvas/rich-text/model"
import {
  parseVirtualId,
  richSelection,
  translateOps,
  virtualId,
} from "../src/canvas/rich-text/panel-bridge"
import { RichTextSession } from "../src/canvas/rich-text/session"
import { MIXED } from "../src/editor/props"
import { fontOf, sharedText, sizeOf, styleOps, weightOf } from "../src/editor/text"

type N = Record<string, unknown>
const text = (o: N = {}): NodeData =>
  ({
    type: "text",
    content: "Hello world",
    style: { font: "Inter", size: 16 },
    ...o,
  }) as unknown as NodeData

describe("model: node ↔ runs", () => {
  test("a plain string is one run with the node attributes", () => {
    const runs = runsOf(text({ fill: "#111111" }))
    expect(runs).toEqual([
      { text: "Hello world", attrs: { font: "Inter", size: 16, fill: "#111111" } },
    ])
  })
  test("spans layer over the node style; span href and fill", () => {
    const runs = runsOf(
      text({
        content: [
          { text: "Save " },
          { text: "40%", style: { weight: 700 }, fill: "#E5484D" },
          { text: " now", href: "https://kimo.design" },
        ],
      }),
    )
    expect(runs.map((r) => r.text)).toEqual(["Save ", "40%", " now"])
    expect(runs[1]?.attrs).toEqual({ font: "Inter", size: 16, weight: 700, fill: "#E5484D" })
    expect(runs[2]?.attrs.href).toBe("https://kimo.design")
  })
  test("equal adjacent spans merge", () => {
    const runs = runsOf(text({ content: [{ text: "a" }, { text: "b" }, { text: "c", style: {} }] }))
    expect(runs).toEqual([{ text: "abc", attrs: { font: "Inter", size: 16 } }])
  })
})

describe("model: canonical write-back", () => {
  test("uniform runs write a plain string, no spans", () => {
    const node = text()
    const runs = applyAttrs(runsOf(node), 0, 11, { weight: 700 })
    const p = toNodePatch(runs, node)
    expect(p).toEqual({
      content: "Hello world",
      style: { font: "Inter", size: 16, weight: 700 },
      fill: undefined,
      runs: false,
    })
  })
  test("a styled range splits into spans carrying only what differs", () => {
    const node = text()
    const runs = applyAttrs(runsOf(node), 6, 11, { weight: 700, fill: "#E5484D" })
    const p = toNodePatch(runs, node)
    expect(p.runs).toBe(true)
    expect(p.style).toEqual({ font: "Inter", size: 16 })
    expect(p.content).toEqual([
      { text: "Hello " },
      { text: "world", style: { weight: 700 }, fill: "#E5484D" },
    ])
  })
  test("undoing the range style merges back to a plain string", () => {
    const node = text()
    let runs = applyAttrs(runsOf(node), 6, 11, { italic: true })
    runs = applyAttrs(runs, 0, 11, { italic: undefined })
    expect(toNodePatch(runs, node).content).toBe("Hello world")
  })
  test("an attribute some runs lack is removed from the node (absent = default)", () => {
    const node = text({ style: { font: "Inter", size: 16, weight: 600 } })
    const runs = applyAttrs(runsOf(node), 0, 5, { weight: undefined })
    const p = toNodePatch(runs, node)
    expect(p.style).toEqual({ font: "Inter", size: 16 })
    expect(p.content).toEqual([{ text: "Hello" }, { text: " world", style: { weight: 600 } }])
  })
  test("paragraph fields stay on the node; a gradient fill stays on the node", () => {
    const grad = {
      kind: "linear",
      stops: [
        { color: "#000", at: 0 },
        { color: "#fff", at: 1 },
      ],
    }
    const node = text({ style: { size: 16, align: "center" }, fill: grad })
    const runs = applyAttrs(runsOf(node), 0, 5, { fill: "#E5484D" })
    const p = toNodePatch(runs, node)
    expect(p.style).toEqual({ size: 16, align: "center" })
    expect(p.fill).toEqual(grad)
    expect(p.content).toEqual([{ text: "Hello", fill: "#E5484D" }, { text: " world" }])
  })
  test("replaceText types with the attributes before the caret", () => {
    const node = text()
    let runs = applyAttrs(runsOf(node), 0, 5, { weight: 700 })
    runs = replaceText(runs, 5, 5, "!!")
    expect(plainText(runs)).toBe("Hello!! world")
    expect(groupsIn(runs, 0, 7).length).toBe(1)
  })
})

describe("session", () => {
  const make = (node: NodeData = text()) => new RichTextSession("T1", node, runsOf(node), true)

  test("⌘B on a range toggles bold on, then off when all of it is bold", () => {
    const s = make()
    s.select({ anchor: 6, focus: 11 })
    s.toggle("bold")
    expect(s.result().content).toEqual([
      { text: "Hello " },
      { text: "world", style: { weight: 700 } },
    ])
    s.toggle("bold")
    expect(s.result().content).toBe("Hello world")
  })
  test("⌘B at a collapsed caret styles the next typed characters only", () => {
    const s = make()
    s.select({ anchor: 5, focus: 5 })
    s.toggle("bold")
    s.insert(" big")
    expect(s.result().content).toEqual([
      { text: "Hello" },
      { text: " big", style: { weight: 700 } },
      { text: " world" },
    ])
  })
  test("underline and strike combine", () => {
    const s = make()
    s.select({ anchor: 0, focus: 5 })
    s.toggle("underline")
    s.toggle("strike")
    expect(s.result().content).toEqual([
      { text: "Hello", style: { decoration: ["underline", "strike"] } },
      { text: " world" },
    ])
  })
  test("undo steps: a typing burst, then a style change", () => {
    const s = make()
    s.select({ anchor: 11, focus: 11 })
    s.insert("!")
    s.insert("!")
    s.select({ anchor: 0, focus: 5 })
    s.toggle("italic")
    expect(s.undo()).toBe(true)
    expect(s.result().content).toBe("Hello world!!")
    expect(s.undo()).toBe(true)
    expect(s.text).toBe("Hello world")
    expect(s.undo()).toBe(false)
    expect(s.redo()).toBe(true)
    expect(s.text).toBe("Hello world!!")
  })
  test("notes and prompts stay plain", () => {
    const s = new RichTextSession(
      "N1",
      { type: "note", content: "x" },
      runsOf({ content: "x" }),
      false,
    )
    s.select({ anchor: 0, focus: 1 })
    s.toggle("bold")
    expect(s.groups()[0]?.attrs.weight).toBeUndefined()
  })
})

describe("panel bridge", () => {
  test("virtual ids round-trip", () => {
    const id = virtualId("Abc123", [
      [0, 3],
      [7, 9],
    ])
    expect(parseVirtualId(id)).toEqual({
      nodeId: "Abc123",
      ranges: [
        [0, 3],
        [7, 9],
      ],
    })
    expect(parseVirtualId("Abc123")).toBeNull()
  })

  test("editing: the selection's groups show Mixed where they differ", () => {
    const node = text({
      content: [{ text: "Hello " }, { text: "world", style: { weight: 700, font: "Fraunces" } }],
    })
    const s = new RichTextSession("T1", node, runsOf(node), true)
    s.select({ anchor: 3, focus: 9 })
    const view = richSelection([{ id: "T1", node }], s) as { id: string; node: NodeData }[]
    expect(view).toHaveLength(2)
    expect(
      sharedText(
        view.map((v) => v.node),
        fontOf,
      ),
    ).toBe(MIXED)
    expect(
      sharedText(
        view.map((v) => v.node),
        weightOf,
      ),
    ).toBe(MIXED)
    expect(
      sharedText(
        view.map((v) => v.node),
        sizeOf,
      ),
    ).toBe(16)
    // A caret inside "world" shows its values.
    s.select({ anchor: 8, focus: 8 })
    const caret = richSelection([{ id: "T1", node }], s) as { id: string; node: NodeData }[]
    expect(caret).toHaveLength(1)
    expect(fontOf(caret[0]?.node as NodeData)).toBe("Fraunces")
  })

  test("editing: a Size edit goes to the session's range, not the document", () => {
    const node = text()
    const s = new RichTextSession("T1", node, runsOf(node), true)
    s.select({ anchor: 0, focus: 5 })
    const view = richSelection([{ id: "T1", node }], s) as { id: string; node: NodeData }[]
    const ops = styleOps(view, "size", () => 32)
    const out = translateOps(ops, view, () => node, s, [])
    expect(out).toEqual([])
    expect(s.result().content).toEqual([{ text: "Hello", style: { size: 32 } }, { text: " world" }])
  })

  test("not editing: a text with runs shows Mixed and an edit applies to every run", () => {
    const node = text({
      content: [{ text: "Hello " }, { text: "world", style: { size: 24 } }],
    })
    const view = richSelection([{ id: "T1", node }], null) as { id: string; node: NodeData }[]
    expect(
      sharedText(
        view.map((v) => v.node),
        sizeOf,
      ),
    ).toBe(MIXED)
    const ops = styleOps(view, "size", () => 20)
    const out = translateOps(ops, view, () => node, null, ["text/runs"]) as (Op & N)[]
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      op: "update",
      id: "T1",
      set: { content: "Hello world", style: { font: "Inter", size: 20 } },
    })
  })

  test("not editing: a range color declares text/runs in the same edit", () => {
    const node = text({ content: [{ text: "a", fill: "#E5484D" }, { text: "b" }] })
    const view = richSelection([{ id: "T1", node }], null) as { id: string; node: NodeData }[]
    // Bold on everything keeps the per-span colors.
    const ops = styleOps(view, "weight", () => 700)
    const out = translateOps(ops, view, () => node, null, []) as (Op & N)[]
    expect(out[0]).toEqual({ op: "setHeader", set: { features: ["text/runs"] } })
    expect(out[1]).toMatchObject({
      set: { content: [{ text: "a", fill: "#E5484D" }, { text: "b" }], style: { weight: 700 } },
    })
  })

  test("plain texts are not bridged", () => {
    expect(richSelection([{ id: "T1", node: text() }], null)).toBeNull()
  })

  test("virtualNode keeps paragraph fields and takes the group's attributes", () => {
    const v = virtualNode(text({ style: { size: 16, align: "center" } }), {
      size: 30,
      fill: "#000",
    })
    expect(v.style).toEqual({ align: "center", size: 30 })
    expect(v.fill).toBe("#000")
  })
})
