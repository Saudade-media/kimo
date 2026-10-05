/** Board 31: status line derivation, step labels with counts and names, the reply of a turn. */
import { describe, expect, test } from "bun:test"
import {
  type ChatMessage,
  describeOps,
  noteOf,
  ProgressTracker,
  replyOf,
  START_STATUS,
  stepLabel,
  WRITING_REPLY,
} from "../src/index"

const names = {
  name: (id: string) => ({ P1: "Pricing", H1: "Hero", T1: "Title", HOME: "Home" })[id],
  parentName: (id: string) => ({ T1: "Hero", C1: "Pricing", C2: "Pricing" })[id],
}

describe("stepLabel", () => {
  test("apply_ops: verb, layer count and where", () => {
    const ins = (parent: string, name?: string, key?: string) => ({
      op: "insert",
      parent,
      ...(key ? { key } : {}),
      node: { type: "frame", ...(name ? { name } : {}) },
    })
    const call = (ops: unknown[]) => ({ id: "c", name: "kimo_apply_ops", input: { ops } })
    expect(stepLabel(call([ins("P1"), ins("P1"), ins("P1")]), names)).toBe(
      "Adding 3 layers in Pricing",
    )
    // New top-level frame + children under its @key → named after the new frame.
    expect(stepLabel(call([ins("root", "Landing", "l"), ins("@l"), ins("@l")]), names)).toBe(
      "Adding 3 layers in Landing",
    )
    expect(
      stepLabel(
        call([
          { op: "update", id: "C1", set: {} },
          { op: "update", id: "C2", set: {} },
        ]),
        names,
      ),
    ).toBe("Editing 2 layers in Pricing")
    expect(stepLabel(call([{ op: "update", id: "T1", set: {} }]), names)).toBe("Editing Title")
    expect(stepLabel(call([{ op: "copy", id: "HOME", parent: "root" }]), names)).toBe(
      "Copying Home",
    )
    expect(
      stepLabel(
        call([
          { op: "delete", id: "x" },
          { op: "delete", id: "y" },
        ]),
      ),
    ).toBe("Deleting 2 layers")
    expect(stepLabel(call([ins("root")]))).toBe("Adding 1 layer")
  })

  test("other tools", () => {
    const c = (name: string, input: Record<string, unknown> = {}) =>
      stepLabel({ id: "c", name, input }, names)
    expect(c("kimo_query", { select: { under: "HOME" } })).toBe("Reading Home")
    expect(c("kimo_query", { select: { type: "text" } })).toBe("Reading the document")
    expect(c("kimo_render", { ids: ["P1"] })).toBe("Rendering Pricing")
    expect(c("kimo_export", { format: "png" })).toBe("Exporting PNG")
    expect(c("kimo_get_state")).toBe("Reading the document")
    expect(c("kimo_read_docs", { path: "ops" })).toBe("Reading the ops guide")
    expect(c("kimo_something_new")).toBe("something new")
  })

  test("describeOps: empty → null", () => {
    expect(describeOps([])).toBeNull()
  })
})

describe("ProgressTracker", () => {
  test("note before a tool call wins; no note → tool label; never thinking", () => {
    const t = new ProgressTracker()
    expect(t.status).toEqual(START_STATUS)
    t.text("Laying out the ")
    // Incomplete text never shows word by word.
    expect(t.status).toEqual(START_STATUS)
    t.text("page skeleton\n")
    expect(t.status).toEqual({ text: "Laying out the page skeleton", source: "note" })
    t.messageEnd()
    t.step("Adding 6 layers in Home")
    expect(t.status.text).toBe("Laying out the page skeleton")
    // Next step without a note: the tool's label.
    t.step("Adding 18 layers in Hero")
    expect(t.status).toEqual({ text: "Adding 18 layers in Hero", source: "tool" })
    // A retry discards the partial note back to the committed text.
    t.text("**Building** the pricing section. Then")
    expect(t.status.text).toBe("Building the pricing section.")
    t.discard()
    expect(t.status.text).toBe("Building the pricing section.")
    // An unterminated note shows when its tool call starts.
    const u = new ProgressTracker()
    u.text("Rendering the hero")
    expect(u.status).toEqual(START_STATUS)
    u.step("Rendering Hero")
    expect(u.status).toEqual({ text: "Rendering the hero", source: "note" })
  })

  test("a reply being written shows as 'Writing the reply…', never its words", () => {
    const t = new ProgressTracker()
    t.text("Built the landing page in four sections. It has a nav, ")
    expect(t.status.text).toBe("Built the landing page in four sections.")
    t.text("a hero and pricing. The footer links ")
    expect(t.status.text).toBe(WRITING_REPLY)
  })

  test("noteOf: last non-empty line, markdown stripped, capped", () => {
    expect(noteOf("First.\n\n- Second line  \n")).toBe("Second line")
    expect(noteOf("   ")).toBe("")
    expect(noteOf("x".repeat(200)).length).toBe(120)
  })
})

describe("stepLabel of a patch-retry", () => {
  test("a retry call says it fixes the last edit", () => {
    expect(
      stepLabel({
        id: "c",
        name: "kimo_apply_ops",
        input: { docId: "d", retryId: "r_1", edits: [] },
      }),
    ).toBe("Fixing the last edit")
  })
})

describe("ProgressTracker while a call streams", () => {
  test("'Adding <layer>…' replaces the note and stays when the call's step starts", () => {
    const t = new ProgressTracker()
    t.text("Building the pricing section\n")
    expect(t.status.text).toBe("Building the pricing section")
    t.streaming("Adding Pro card…")
    expect(t.status).toEqual({ text: "Adding Pro card…", source: "tool" })
    t.step("Adding 5 layers in Pricing")
    expect(t.status.text).toBe("Adding Pro card…")
    // The next step without streaming falls back to its own label.
    t.step("Rendering")
    expect(t.status.text).toBe("Rendering")
  })
})

describe("replyOf", () => {
  test("the last assistant text: notes before tool calls are not the reply", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Laying out the skeleton" },
          { type: "tool_call", id: "a", name: "kimo_apply_ops", input: {} },
        ],
      },
      { role: "tool", results: [] },
      { role: "assistant", content: [{ type: "text", text: "Built the page." }] },
    ]
    expect(replyOf(msgs)).toBe("Built the page.")
    expect(replyOf(msgs.slice(0, 3))).toBe("Laying out the skeleton")
    expect(replyOf([])).toBe("")
  })
})
