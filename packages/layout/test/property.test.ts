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
            // Yoga computes in float32: far from the origin a step is many px (32 px near 4.6e8),
            // so the tolerance grows with the magnitude.
            expect(start).toBeGreaterThanOrEqual(end - Math.max(1e-3, Math.abs(end) * 2 ** -20))
            end = start + (row ? b.w : b.h)
          }
        }
      }),
      { numRuns: 300 },
    )
  })
})

describe("incremental update", () => {
  test("compute on a live engine (a refresh) equals a rebuild, then updates still agree", async () => {
    // A live engine refreshes on compute (diffs every node, keeps Yoga state); its result and
    // every following update must equal a fresh engine's full compute.
    const inc = createLayoutEngine()
    await inc.init()
    const fresh = async (t: Table) => {
      const f = createLayoutEngine()
      await f.init()
      const r = snapshot(f.compute(inputFor(t)))
      f.dispose()
      return r
    }
    await fc.assert(
      fc.asyncProperty(
        docs({ negativeGap: true, wrap: true }),
        fc.array(fc.array(mutation, { minLength: 1, maxLength: 3 }), { maxLength: 4 }),
        async (start, batches) => {
          let table = start
          expect(snapshot(inc.compute(inputFor(table)))).toEqual(await fresh(table))
          for (const batch of batches) {
            const dirty = new Set<string>()
            for (const m of batch) {
              const r = apply(table, m)
              table = r.table
              for (const id of r.dirty) dirty.add(id)
            }
            expect(snapshot(inc.update(inputFor(table), { nodes: dirty }))).toEqual(
              await fresh(table),
            )
          }
        },
      ),
      { numRuns: 300 },
    )
    inc.dispose()
  }, 60_000)

  test("a parent and its child swapped in one change (two moves) re-parent both", async () => {
    const e = createLayoutEngine()
    await e.init()
    const r0 = { type: "frame", parent: null, order: "a2", x: 0, y: 0, w: 200, h: 200 } as const
    const a: Table = {
      r: r0,
      g: { type: "group", parent: null, order: "a0", x: 70, y: 120 },
      f: { type: "frame", parent: "g", order: "a1", x: 0, y: 0, w: 50, h: 40 },
    }
    const b: Table = {
      r: r0,
      f: { type: "frame", parent: "r", order: "a1", x: 0, y: 0, w: 50, h: 40 },
      g: { type: "group", parent: "f", order: "a0", x: 5, y: 5 },
    }
    e.compute(inputFor(a))
    // f's child list is rebuilt before f is re-attached under r: its entry still says g.
    const r = e.update(inputFor(b), { nodes: ["g", "f"] })
    expect(r.order).toEqual(["r", "f", "g"])
    expect(r.issues).toEqual([])
    e.dispose()
  })

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
