/**
 * A page switch to an empty page: the engine's next pass must lay out nothing. Before the fix,
 * an empty root list kept the previous page's layout (an empty page showed the last page's
 * boards in the editor).
 */
import { describe, expect, test } from "bun:test"
import {
  createLayoutEngine,
  createResolver,
  type LayoutNodeData,
  nodeSourceFromDocument,
} from "../src/index"
import { fakeMeasurer } from "./helpers"

describe("roots that go away", () => {
  test("switching to an empty page lays out nothing; switching back lays them out again", async () => {
    const table = {
      a: { type: "frame", parent: null, order: "a0", w: 100, h: 100, page: "p1" },
      b: { type: "frame", parent: null, order: "a1", w: 50, h: 50, page: "p2" },
    } as unknown as Record<string, LayoutNodeData>
    const base = nodeSourceFromDocument({ nodes: table as never })
    let page = "p1"
    const src = {
      ...base,
      getNode: (id: string) => base.getNode(id),
      children: (parent: string | null, at?: string | null) =>
        parent === null && (at === undefined || at === null)
          ? base.children(null).filter((id) => (table[id] as { page?: string }).page === page)
          : base.children(parent, at),
    }
    const e = createLayoutEngine()
    await e.init()
    const run = () =>
      e.compute({
        nodes: src as never,
        resolve: createResolver({}, src as never),
        measureText: fakeMeasurer,
      })
    expect([...run().nodes.keys()]).toEqual(["a"])
    page = "p2"
    expect([...run().nodes.keys()]).toEqual(["b"])
    page = "p3"
    expect([...run().nodes.keys()]).toEqual([])
    page = "p1"
    expect([...run().nodes.keys()]).toEqual(["a"])
    e.dispose()
  })
})
