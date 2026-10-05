/** Board 31 "Agent cursor": the pointer follows the last layer an agent's landed edit added. */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createMemoryDocumentHost, modelView, pointerTarget } from "../src/index"
import { validateInput } from "../src/server"
import { expectOk } from "./conformance"

describe("pointerTarget", () => {
  test("the last insert in op order (a copy counts as its last copied layer)", () => {
    expect(
      pointerTarget([
        { op: "update", id: "page", set: { h: 2000 }, unset: [] },
        { op: "insert", id: "card", node: {} },
        { op: "insert", id: "title", node: {} },
        { op: "insert", id: "price", node: {} },
        { op: "update", id: "card", set: { name: "Pro" }, unset: [] },
      ]),
    ).toBe("price")
  })

  test("updates only: the last changed layer; placeholder flags and deletes never count", () => {
    expect(
      pointerTarget([
        { op: "update", id: "a", set: { fill: "#000" }, unset: [] },
        { op: "move", id: "b", parent: "p", order: "a1" },
        { op: "update", id: "page", set: {}, unset: ["placeholder"] },
      ]),
    ).toBe("b")
    expect(pointerTarget([{ op: "update", id: "page", set: {}, unset: ["placeholder"] }])).toBe(
      undefined,
    )
    expect(
      pointerTarget([
        { op: "insert", id: "x", node: {} },
        { op: "insert", id: "y", node: {} },
        { op: "delete", id: "y" },
      ]),
    ).toBe("x")
    expect(pointerTarget([{ op: "setHeader", set: {}, unset: [] }])).toBe(undefined)
    expect(pointerTarget(undefined)).toBe(undefined)
  })
})

describe("MCP presence", () => {
  test("a landed edit sets the pointer to its last added layer; reads leave it", async () => {
    const platform = createMemoryPlatform({ pid: 4100 })
    const host = createMemoryDocumentHost({
      platform,
      autosaveMs: 0,
      validate: validateInput,
      clientPolicy: {
        level: "edit+delete",
        files: ["/w/**"],
        nodes: [],
        grants: ["files.create"],
        onExceed: "deny",
        confirmDestructive: false,
      },
    })
    const rt = host.runtime
    const conn = rt.connect({
      client: "claude-code",
      label: "Claude Code",
      transport: "stdio-headless",
    })
    const cr = expectOk((await conn.call("kimo_create", { path: "/w/p.kimo" })).result)
    const docId = (cr.data as { doc: { id: string } }).doc.id
    const presence = () => rt.presence.list().find((p) => p.origin === conn.origin)
    expect(presence()?.pointer).toBeUndefined()

    const r = expectOk(
      (
        await conn.call("kimo_apply_ops", {
          docId,
          ops: [
            {
              op: "insert",
              key: "card",
              parent: "root",
              node: { type: "frame", name: "Card", w: 200, layout: { dir: "column" } },
            },
            { op: "insert", key: "t", parent: "@card", node: { type: "text", content: "Pro" } },
            { op: "insert", key: "p", parent: "@card", node: { type: "text", content: "$12" } },
          ],
        })
      ).result,
    )
    const price = r.created?.find((c) => c.key === "p")?.id as string
    // The envelope names it (the model-facing view too, so CLI agents get it) and presence follows.
    expect(r.pointer).toBe(price)
    expect(modelView(r).ok && (modelView(r) as { pointer?: string }).pointer).toBe(price)
    expect(presence()?.pointer).toBe(price)

    await conn.call("kimo_query", { docId, select: { topLevel: true } })
    expect(presence()?.pointer).toBe(price)

    const card = r.created?.find((c) => c.key === "card")?.id as string
    expectOk(
      (
        await conn.call("kimo_apply_ops", {
          docId,
          ops: [{ op: "update", id: card, set: { name: "Plan" } }],
        })
      ).result,
    )
    expect(presence()?.pointer).toBe(card)
    host.dispose()
  })
})
