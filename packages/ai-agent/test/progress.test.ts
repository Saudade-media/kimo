/** Status line derivation and the reply of a turn. */
import { describe, expect, test } from "bun:test"
import {
  type ChatMessage,
  ProgressTracker,
  replyOf,
  START_STATUS,
  WRITING_REPLY,
} from "../src/index"

describe("ProgressTracker", () => {
  test("note before a tool call wins; no note falls back to the tool label; never thinking", () => {
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

  test("a reply being written shows as a generic status, never its words", () => {
    const t = new ProgressTracker()
    t.text("Built the landing page in four sections. It has a nav, ")
    expect(t.status.text).toBe("Built the landing page in four sections.")
    t.text("a hero and pricing. The footer links ")
    expect(t.status.text).toBe(WRITING_REPLY)
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
