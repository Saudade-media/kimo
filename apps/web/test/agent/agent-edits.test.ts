/**
 * Built-in agent turns through the Agent tab controller (real `@kimo/ai-agent` loop, mocked
 * provider, in-window tool host over a real DocStore): edits land on the right layers and each
 * turn is undoable as a unit.
 */
import { describe, expect, test } from "bun:test"
import { lastUserText, nameOf, setupPanel, until } from "./helpers"

describe("a turn's edits", () => {
  test("an op batch lands, and regenerate undoes the turn's group before resending", async () => {
    const holder = { docId: "" }
    const { c, store, docId } = setupPanel((req, i) => {
      if (req.responseSchema) return { text: '{"title":"Warm up the hero"}' }
      return i === 0
        ? {
            text: "Warming the hero. ",
            tools: [
              {
                name: "kimo_apply_ops",
                input: {
                  docId: holder.docId,
                  label: "Warm Hero",
                  ops: [{ op: "update", id: "Hero000001", set: { name: "Hero warm" } }],
                },
              },
            ],
          }
        : { text: "Warmed the palette." }
    })
    holder.docId = docId
    await c.refresh()
    await c.send("Make the hero warmer")
    expect(nameOf(store, "Hero000001")).toBe("Hero warm")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error("no agent message")
    expect(a.steps).toHaveLength(1)
    expect(a.steps[0]?.state).toBe("done")
    await until(() => c.state.header.title === "Warm up the hero")
    let undoneSeen = false
    const off = c.subscribe(() => {
      if (nameOf(store, "Hero000001") === "Hero") undoneSeen = true
    })
    await c.regenerate(a.turnId)
    off()
    expect(undoneSeen).toBe(true)
    expect(c.state.messages.filter((m) => m.kind === "agent")).toHaveLength(1)
    expect(nameOf(store, "Hero000001")).toBe("Hero warm")
  })

  test("undo turn restores the layers the turn changed", async () => {
    const holder = { docId: "" }
    const { c, store, docId } = setupPanel((req, i) =>
      req.responseSchema
        ? { text: '{"title":"Rename"}' }
        : i % 2 === 0
          ? {
              tools: [
                {
                  name: "kimo_apply_ops",
                  input: {
                    docId: holder.docId,
                    ops: [{ op: "update", id: "Card000001", set: { name: `Card v${i}` } }],
                  },
                },
              ],
            }
          : { text: "Done." },
    )
    holder.docId = docId
    await c.refresh()
    await c.send("Rename the card")
    expect(nameOf(store, "Card000001")).toBe("Card v0")
    const turn = c.state.messages.find((m) => m.kind === "agent")
    if (turn?.kind !== "agent") throw new Error("no agent message")
    const r = await c.undoTurn(turn.turnId)
    expect(r).toEqual({ ok: true, stale: false })
    expect(nameOf(store, "Card000001")).toBe("Card")
    expect(c.state.undoneTurns).toContain(turn.turnId)
  })

  test("a later turn on top makes undoing the earlier one stale: nothing is undone", async () => {
    const holder = { docId: "" }
    let v = 0
    const { c, store, docId } = setupPanel((req) =>
      req.responseSchema
        ? { text: '{"title":"Rename"}' }
        : req.messages.slice(-1)[0]?.role !== "tool"
          ? {
              tools: [
                {
                  name: "kimo_apply_ops",
                  input: {
                    docId: holder.docId,
                    ops: [{ op: "update", id: "Card000001", set: { name: `Card v${++v}` } }],
                  },
                },
              ],
            }
          : { text: "Done." },
    )
    holder.docId = docId
    await c.refresh()
    await c.send("Rename the card")
    const turn = c.state.messages.find((m) => m.kind === "agent")
    if (turn?.kind !== "agent") throw new Error("no agent message")
    await c.send("Rename it again")
    const after = nameOf(store, "Card000001")
    expect(after).toBe("Card v2")
    const r = await c.undoTurn(turn.turnId)
    expect(r.ok && !r.stale).toBe(false)
    expect(c.state.undoneTurns).not.toContain(turn.turnId)
    expect(c.state.turnIssues[turn.turnId]).toBeDefined()
    expect(nameOf(store, "Card000001")).toBe(after)
  })

  test("regenerate after undo turn resends the prompt without undoing again", async () => {
    const holder = { docId: "" }
    let v = 0
    const { c, store, docId } = setupPanel((req) =>
      req.responseSchema
        ? { text: '{"title":"Rename"}' }
        : req.messages.slice(-1)[0]?.role !== "tool"
          ? {
              tools: [
                {
                  name: "kimo_apply_ops",
                  input: {
                    docId: holder.docId,
                    ops: [{ op: "update", id: "Card000001", set: { name: `Card v${++v}` } }],
                  },
                },
              ],
            }
          : { text: "Done." },
    )
    holder.docId = docId
    await c.refresh()
    await c.send("Rename the card")
    const turn = c.state.messages.find((m) => m.kind === "agent")
    if (turn?.kind !== "agent") throw new Error("no agent message")
    expect(await c.undoTurn(turn.turnId)).toEqual({ ok: true, stale: false })
    expect(nameOf(store, "Card000001")).toBe("Card")
    await c.regenerate(turn.turnId)
    expect(c.state.turnIssues[turn.turnId]).toBeUndefined()
    expect(nameOf(store, "Card000001")).toBe("Card v2")
  })

  test("an oversize batch is refused whole and does not count as a step; the smaller one lands", async () => {
    const holder = { docId: "" }
    const rects = (parent: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        op: "insert",
        parent,
        node: { type: "rect", name: `Bar ${i}`, x: 0, y: i * 4, w: 10, h: 2 },
      }))
    const { c, store, docId } = setupPanel((_req, i) => {
      const tool = (ops: unknown[]) => [
        { name: "kimo_apply_ops", input: { docId: holder.docId, ops } },
      ]
      // Over the streamed limit (the built-in agent streams tool input: 150).
      if (i === 0)
        return { text: "Building the pricing section\n", tools: tool(rects("Hero000001", 151)) }
      if (i === 1) return { text: "", tools: tool(rects("Hero000001", 20)) }
      if (i === 2)
        return {
          text: "Tightening the card",
          tools: tool([{ op: "update", id: "Card000001", set: { name: "Card tight" } }]),
        }
      return { text: "Added 20 bars to Hero and tightened the card." }
    })
    holder.docId = docId
    await c.refresh()
    await c.send("Add bars")
    const a = c.state.messages[1]
    if (a?.kind !== "agent") throw new Error("no agent message")
    expect(a.steps.map((s) => s.state)).toEqual(["done", "done"])
    expect(a.card).toBeUndefined()
    expect(store.children("Hero000001")).toHaveLength(20)
    expect(nameOf(store, "Card000001")).toBe("Card tight")
  })

  test("Stop aborts the stream and drops queued messages", async () => {
    const { c } = setupPanel((req) =>
      lastUserText(req).includes("second")
        ? { text: "Second." }
        : { text: "a b c d e f g h i j k l m n o p", delayMs: 15 },
    )
    await c.refresh()
    const running = c.send("first")
    await until(() => c.state.busy && (c.state.live?.tokensOut ?? 0) > 0)
    await c.send("second")
    expect(c.state.composer.queued).toEqual(["second"])
    c.stop()
    await running
    const first = c.state.messages[1]
    if (first?.kind !== "agent") throw new Error("no agent message")
    expect(first.card?.kind).toBe("stopped")
    expect(c.state.composer.queued).toEqual([])
  })
})
