/**
 * Agent modes through the Agent tab controller: side by side variants, split sections whose
 * children are held to their scope, and iterate passes with Before / After and Revert.
 */
import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { lastUserText, nameOf, setupPanel } from "./helpers"

describe("side by side", () => {
  test("variants land in their own frames; an empty one is removed; no placeholder flag is left", async () => {
    const holder = { docId: "" }
    const { c, store, docId } = setupPanel((req) => {
      const frame = /your frame is (\w+)/i.exec(lastUserText(req))?.[1]
      const variant = /You are variant (\d+)/.exec(lastUserText(req))?.[1]
      // Variant 1 builds into its frame; variant 2 answers without touching the canvas.
      if (frame && variant === "1" && !req.messages.some((m) => m.role === "tool"))
        return {
          tools: [
            {
              name: "kimo_apply_ops",
              input: {
                docId: holder.docId,
                ops: [
                  {
                    op: "insert",
                    parent: frame,
                    node: { type: "rect", name: "Tier", x: 0, y: 0, w: 10, h: 10 },
                  },
                ],
              },
            },
          ],
        }
      return { text: "Variant done." }
    })
    holder.docId = docId
    await c.refresh()
    c.setMode({ ...c.state.composer.mode, mode: "side-by-side", agents: 2 })
    c.setSelection([{ id: "Pricing0001", name: "Pricing", type: "frame" }])
    await c.send("Pricing section, 3 tiers")
    const run = c.state.modeRun
    const [v1, v2] = (run?.agents ?? []).map((a) => a.scopeId as string)
    const built = store.getNode(v1 as string) as
      | { parent?: string | null; placeholder?: unknown }
      | undefined
    expect(built).toBeDefined()
    expect(built?.parent ?? null).toBeNull()
    expect(built?.placeholder).toBeUndefined()
    // The variant that built nothing is removed and reads as discarded.
    expect(store.hasNode(v2 as string)).toBe(false)
    expect(run?.agents[1]?.discarded).toBe(true)
    expect(run?.agents[0]?.discarded).toBeFalsy()
    const flagged = store
      .nodeIds()
      .filter((id) => (store.getNode(id) as { placeholder?: unknown }).placeholder !== undefined)
    expect(flagged).toEqual([])
  })

  test("Discard removes the variant's frame, and keeps it when the undo is refused", async () => {
    let refuse = false
    const holder = { docId: "" }
    const { c, store, docId } = setupPanel(
      (req) => {
        const frame = /your frame is (\w+)/i.exec(lastUserText(req))?.[1]
        if (frame && !req.messages.some((m) => m.role === "tool"))
          return {
            tools: [
              {
                name: "kimo_apply_ops",
                input: {
                  docId: holder.docId,
                  ops: [
                    {
                      op: "insert",
                      key: "t",
                      parent: frame,
                      node: { type: "rect", name: "Tier", x: 0, y: 0, w: 10, h: 10 },
                    },
                  ],
                },
              },
            ],
          }
        return { text: "Variant done." }
      },
      {},
      {},
      () => refuse,
    )
    holder.docId = docId
    await c.refresh()
    c.setMode({ ...c.state.composer.mode, mode: "side-by-side", agents: 2 })
    c.setSelection([{ id: "Pricing0001", name: "Pricing", type: "frame" }])
    await c.send("Pricing section, 3 tiers")
    const row = c.state.modeRun?.agents[1]
    refuse = true
    await c.discardVariant(row?.origin as string)
    expect(c.state.modeRun?.agents[1]?.discarded).toBeFalsy()
    expect(store.hasNode(row?.scopeId as string)).toBe(true)
    expect(c.state.modeRun?.issue).toBeDefined()
    refuse = false
    await c.discardVariant(row?.origin as string)
    expect(c.state.modeRun?.agents[1]?.discarded).toBe(true)
    expect(store.hasNode(row?.scopeId as string)).toBe(false)
    expect(c.state.modeRun?.issue).toBeUndefined()
  })
})

describe("split", () => {
  test("a child cannot edit outside its section: each attempt is rejected, nothing reaches the document", async () => {
    const holder = { docId: "" }
    const heroTries = [
      // A plain edit outside the child's section.
      [{ op: "update", id: "Navbar0001", set: { name: "Hacked" } }],
      // Globals: a child has no `globals` grant.
      [
        {
          op: "set_variables",
          set: [{ name: "brand", variable: { type: "color", value: "#f00" } }],
        },
      ],
      // Move across the scope edge: Card000001 is outside the Hero child's scope.
      [{ op: "move", id: "Card000001", parent: "Hero000001" }],
      // Moving the scope root itself out.
      [{ op: "move", id: "Hero000001", parent: "Navbar0001" }],
      // Component origins: make_component is never allowed for a scoped agent.
      [{ op: "make_component", ids: ["Hero000001"] }],
      [{ op: "declare_prop", component: "Navbar0001", name: "label", prop: { type: "text" } }],
    ]
    const { c, store, docId } = setupPanel((req, i) => {
      const brief = /Your brief: (.*)/.exec(req.system.volatile ?? "")?.[1] ?? ""
      const toolTurns = req.messages.filter((m) => m.role === "tool").length
      if (brief.includes("Hero")) {
        const ops = heroTries[toolTurns]
        return ops
          ? { tools: [{ name: "kimo_apply_ops", input: { docId: holder.docId, ops } }] }
          : { text: "done" }
      }
      if (brief.includes("Card"))
        return toolTurns === 0
          ? {
              tools: [
                {
                  name: "kimo_apply_ops",
                  input: {
                    docId: holder.docId,
                    ops: [{ op: "update", id: "Card000001", set: { name: "Card ✓" } }],
                  },
                },
              ],
            }
          : { text: "done" }
      if (i === 0)
        return {
          tools: [
            {
              name: "kimo_spawn_agents",
              input: {
                docId: holder.docId,
                agents: [
                  { frameId: "Hero000001", brief: "Build the Hero" },
                  { frameId: "Card000001", brief: "Build the Card" },
                ],
              },
            },
          ],
        }
      return { text: "Sections are in." }
    })
    holder.docId = docId
    const before = store.toDocument() as KimoDocument & { variables?: unknown }
    await c.refresh()
    c.setMode({ ...c.state.composer.mode, mode: "split", agents: 3 })
    await c.send("Landing page")
    const after = store.toDocument() as KimoDocument & { variables?: unknown }
    // Every Hero attempt was rejected; nothing it tried reached the document.
    expect(c.state.modeRun?.agents[1]?.rejected).toBe(heroTries.length)
    const heroRejects = (c.state.modeRun?.log ?? []).filter(
      (r) => r.op === "reject" && r.persona === "iris",
    )
    expect(heroRejects.map((r) => r.detail.includes("OUT_OF_SCOPE") || r.detail)).toEqual(
      heroTries.map(() => true),
    )
    expect(nameOf(store, "Navbar0001")).toBe("Navbar")
    expect(after.variables).toEqual(before.variables)
    expect((store.getNode("Card000001") as { parent?: string }).parent).toBe("Pricing0001")
    expect((store.getNode("Hero000001") as { parent?: string }).parent).toBe("Pricing0001")
    expect(
      Object.values(after.nodes).some((n) => (n as { type?: string }).type === "component"),
    ).toBe(false)
    expect((store.getNode("Hero000001") as { reusable?: unknown }).reusable).toBeUndefined()
    // The in-scope child still works.
    expect(nameOf(store, "Card000001")).toBe("Card ✓")
  })
})

describe("iterate", () => {
  /** One iterate pass renames the card ("Card p1", "Card p2", ...). */
  async function iterate(passes = 2, refuseHistory?: () => boolean) {
    const holder = { docId: "" }
    let n = 0
    const p = setupPanel(
      (req) => {
        const toolsDone = req.messages.slice(-1)[0]?.role === "tool"
        if (!toolsDone && lastUserText(req).startsWith("Iterate pass"))
          return {
            tools: [
              {
                name: "kimo_apply_ops",
                input: {
                  docId: holder.docId,
                  ops: [{ op: "update", id: "Card000001", set: { name: `Card p${++n}` } }],
                },
              },
            ],
          }
        return { text: `Pass ${n} done.` }
      },
      {},
      {},
      refuseHistory,
    )
    holder.docId = p.docId
    await p.c.refresh()
    p.c.setMode({ ...p.c.state.composer.mode, mode: "iterate", passes })
    p.c.setSelection([{ id: "Card000001", name: "Card" }])
    await p.c.send("Make it premium")
    return p
  }

  test("one pass per turn; next with a steer runs another; revert goes back to the original", async () => {
    const { c, store } = await iterate(3)
    expect(c.state.modeRun?.iterate).toMatchObject({ pass: 1, of: 3, reviewing: true, changes: 1 })
    await c.review({ action: "next", steer: "less contrast" })
    expect(c.state.modeRun?.iterate).toMatchObject({ pass: 2, steer: "less contrast" })
    expect(nameOf(store, "Card000001")).toBe("Card p2")
    await c.review({ action: "revert", toPass: 0 })
    expect(nameOf(store, "Card000001")).toBe("Card")
    expect(c.state.modeRun?.iterate?.pass).toBe(0)
  })

  test("Before and After switch the canvas any number of times; next after Before returns to the result", async () => {
    const { c, store } = await iterate()
    expect(nameOf(store, "Card000001")).toBe("Card p1")
    for (let i = 0; i < 3; i++) {
      await c.setIterateView("before")
      expect(c.state.modeRun?.iterate?.view).toBe("before")
      expect(nameOf(store, "Card000001")).toBe("Card")
      await c.setIterateView("after")
      expect(c.state.modeRun?.iterate?.view).toBe("after")
      expect(nameOf(store, "Card000001")).toBe("Card p1")
    }
    expect(c.state.modeRun?.iterate?.issue).toBeUndefined()
    await c.setIterateView("before")
    await c.review({ action: "next" })
    expect(nameOf(store, "Card000001")).toBe("Card p2")
  })

  test("Revert after a Before / After toggle puts the original back", async () => {
    const { c, store } = await iterate()
    await c.setIterateView("before")
    await c.setIterateView("after")
    await c.review({ action: "revert", toPass: 0 })
    expect(nameOf(store, "Card000001")).toBe("Card")
    expect(c.state.modeRun?.iterate?.pass).toBe(0)
    expect(c.state.modeRun?.iterate?.issue).toBeUndefined()
  })

  test("a refused Revert says so and keeps the pass", async () => {
    let refuse = false
    const { c, store } = await iterate(2, () => refuse)
    refuse = true
    await c.review({ action: "revert", toPass: 0 })
    const it = c.state.modeRun?.iterate
    expect(it?.pass).toBe(1)
    expect(it?.passes.length).toBe(1)
    expect(it?.issue).toBeDefined()
    expect(nameOf(store, "Card000001")).toBe("Card p1")
  })

  test("a review row reverts its op group; Before / After skip the reverted group", async () => {
    const { c, store } = await iterate()
    const row = c.state.modeRun?.iterate?.rows[0]
    expect(row?.undoToken).toBeString()
    await c.revertOp(row?.key as string)
    expect(nameOf(store, "Card000001")).toBe("Card")
    expect(c.state.modeRun?.iterate?.rows[0]?.reverted).toBe(true)
    await c.setIterateView("before")
    await c.setIterateView("after")
    expect(nameOf(store, "Card000001")).toBe("Card")
    expect(c.state.modeRun?.iterate?.issue).toBeUndefined()
  })
})
