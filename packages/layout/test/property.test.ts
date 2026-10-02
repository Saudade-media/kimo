import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { createLayoutEngine, type LayoutEngine, type LayoutNodeData } from "../src/index"
import { apply, docs, mutation, type Table } from "./gen"
import { inputFor, snapshot } from "./helpers"

let shared: LayoutEngine | null = null
async function eng() {
  if (!shared) {
    shared = createLayoutEngine()
    await shared.init()
  }
  return shared
}

// --- Properties ------------------------------------------------------------------------------

describe("layout properties", () => {
  test("no NaN/Infinity and no negative sizes, for any document", async () => {
    const e = await eng()
    fc.assert(
      fc.property(docs({ negativeGap: true, wrap: true }), (table) => {
        const r = e.compute(inputFor(table))
        expect(r.nodes.size).toBe(Object.keys(table).length)
        for (const n of r.nodes.values()) {
          for (const v of [...Object.values(n.local), ...Object.values(n.world), ...n.transform])
            expect(Number.isFinite(v)).toBe(true)
          expect(n.local.w).toBeGreaterThanOrEqual(0)
          expect(n.local.h).toBeGreaterThanOrEqual(0)
        }
      }),
      { numRuns: 300 },
    )
  })

  test("flowing children never overlap along the main axis (gap ≥ 0, no wrap)", async () => {
    const e = await eng()
    fc.assert(
      fc.property(docs({ negativeGap: false, wrap: false }), (table) => {
        const r = e.compute(inputFor(table))
        const kids = new Map<string, string[]>()
        for (const id of r.order) {
          const n = table[id] as LayoutNodeData
          if (n.parent === null || n.visible === false || n.position === "absolute") continue
          const p = table[n.parent] as LayoutNodeData
          if (!p.layout) continue
          const l = kids.get(n.parent)
          if (l) l.push(id)
          else kids.set(n.parent, [id])
        }
        for (const [pid, ids] of kids) {
          const row = (table[pid]?.layout as { dir: string } | undefined)?.dir === "row"
          let end = Number.NEGATIVE_INFINITY
          for (const id of ids) {
            const b = r.nodes.get(id)?.local
            if (!b) throw new Error(`missing ${id}`)
            const start = row ? b.x : b.y
            expect(start).toBeGreaterThanOrEqual(end - 1e-3)
            end = start + (row ? b.w : b.h)
          }
        }
      }),
      { numRuns: 300 },
    )
  })
})

describe("incremental update", () => {
  test("update(dirty) yields the same layout as a full compute", async () => {
    const full = await eng()
    const inc = createLayoutEngine()
    await inc.init()
    fc.assert(
      fc.property(
        docs({ negativeGap: true, wrap: true }),
        fc.array(fc.array(mutation, { minLength: 1, maxLength: 3 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (start, batches) => {
          let table = start
          inc.compute(inputFor(table))
          for (const batch of batches) {
            const dirty = new Set<string>()
            for (const m of batch) {
              const r = apply(table, m)
              table = r.table
              for (const id of r.dirty) dirty.add(id)
            }
            const a = inc.update(inputFor(table), { nodes: dirty })
            const b = full.compute(inputFor(table))
            expect(snapshot(a)).toEqual(snapshot(b))
          }
        },
      ),
      { numRuns: 400 },
    )
    inc.dispose()
  })

  test("changed lists only the moved nodes; untouched layouts keep their identity", async () => {
    const e = createLayoutEngine()
    await e.init()
    const table: Table = {
      f: { type: "frame", parent: null, order: "a", layout: { dir: "row" } } as LayoutNodeData,
      a: { type: "rect", parent: "f", order: "a", w: 10, h: 10 } as LayoutNodeData,
      b: { type: "rect", parent: "f", order: "b", w: 10, h: 10 } as LayoutNodeData,
      other: { type: "rect", parent: null, order: "b", x: 100, w: 5, h: 5 } as LayoutNodeData,
    }
    const r1 = e.compute(inputFor(table))
    const next = { ...table, a: { ...table.a, w: 20 } as LayoutNodeData }
    const r2 = e.update(inputFor(next), { nodes: ["a"] })
    expect([...r2.changed].sort()).toEqual(["a", "b", "f"])
    expect(r2.nodes.get("other")).toBe(r1.nodes.get("other") as never)
    expect(r2.version).toBe(r1.version + 1)
    expect(r2.nodes.get("b")?.local.x).toBe(20)
    // A no-op update returns the current result.
    expect(e.update(inputFor(next), { nodes: [] })).toBe(r2)
    e.dispose()
  })
})
