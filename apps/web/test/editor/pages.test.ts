import { describe, expect, test } from "bun:test"
import { validate } from "@kimo/core-schema"
import { createDocStore, createUiStore } from "@kimo/editor-state"
import { pageAwareToolHost, withPageDefaults } from "../../src/editor/pages/agent"
import { withActivePage } from "../../src/editor/pages/model"
import { SCHEMA } from "./doc-fixture"

describe("active page", () => {
  test("new roots get the active page; moves into a container drop it", () => {
    const store = createDocStore({
      $schema: SCHEMA,
      format: "1.0.0",
      pages: { PageAaaaa1: { order: "a0", name: "A" }, PageBbbbb1: { order: "a1", name: "B" } },
      nodes: { Frame00001: { type: "frame", parent: null, order: "a0", page: "PageBbbbb1" } },
    })
    const ui = createUiStore({ page: "PageBbbbb1" })
    const ops = withActivePage(store, ui, [
      { op: "insert", id: "NewFrame01", parent: null, node: { type: "frame" } },
    ])
    expect((ops[0] as { node: { page?: string } }).node.page).toBe("PageBbbbb1")
    store.apply(ops, { origin: "user" })
    const moved = withActivePage(store, ui, [
      { op: "move", id: "NewFrame01", parent: "Frame00001" },
    ])
    store.apply(moved, { origin: "user" })
    expect(store.getNode("NewFrame01")?.page).toBeUndefined()
    expect(validate(store.toDocument()).warnings).toEqual([])
  })

  test("agent ops: top-level inserts, copies, moves and instances default to the active page", () => {
    const ops = withPageDefaults(
      [
        { op: "insert", parent: "root", node: { type: "frame" } },
        { op: "insert", parent: "root", node: { type: "frame", page: "Other00001" } },
        { op: "insert", parent: "Frame00001", node: { type: "rect", w: 1, h: 1 } },
        { op: "copy", id: "Frame00001", parent: "root" },
        { op: "move", id: "Rect000001", parent: "root" },
        { op: "instantiate", of: "Btn0000001", parent: "root" },
      ],
      "PageB00001",
    ) as Record<string, unknown>[]
    expect(((ops[0] as Record<string, unknown>).node as { page?: string }).page).toBe("PageB00001")
    expect(((ops[1] as Record<string, unknown>).node as { page?: string }).page).toBe("Other00001")
    expect(((ops[2] as Record<string, unknown>).node as { page?: string }).page).toBeUndefined()
    expect(((ops[3] as Record<string, unknown>).set as { page?: string }).page).toBe("PageB00001")
    expect(ops[5]).toEqual({ op: "update", id: "Rect000001", set: { page: "PageB00001" } })
    expect(ops[6]?.key).toBe("kimo_page_1")
    expect(ops[7]).toEqual({ op: "update", id: "@kimo_page_1", set: { page: "PageB00001" } })
  })

  test("a streamed agent call gets the same page defaults op by op", () => {
    const input = {
      docId: "d1",
      ops: [
        { op: "insert", parent: "root", node: { type: "frame" } },
        { op: "move", id: "Rect000001", parent: "root" },
        { op: "instantiate", of: "Btn0000001", parent: "root" },
        { op: "instantiate", of: "Btn0000001", parent: "root" },
      ],
    }
    const events: { kind: string; index?: number; value?: unknown }[] = []
    const host = pageAwareToolHost(
      {
        tools: () => [],
        call: async () => ({}) as never,
        stream: () => ({
          push: () => {},
          event: (e) => {
            events.push(e as never)
          },
          abort: () => {},
          onProgress: () => () => {},
        }),
      },
      () => "PageB00001",
    )
    const s = host.stream?.({ id: "c1", name: "kimo_apply_ops" })
    const json = JSON.stringify(input)
    for (let i = 0; i < json.length; i += 5) s?.push(json.slice(i, i + 5))
    const streamed = events.filter((e) => e.kind === "item")
    expect(streamed.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(streamed.map((e) => e.value)).toEqual(withPageDefaults(input.ops, "PageB00001"))
  })
})
