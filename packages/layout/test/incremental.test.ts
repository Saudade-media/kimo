import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import {
  createLayoutEngine,
  createResolver,
  type LayoutNodeData,
  nodeSourceFromDocument,
  paintOnlyHeaderChange,
  type ResolveHeader,
} from "../src/index"
import { apply, docs, mutation, type Table } from "./gen"
import { engine, fakeMeasurer, inputFor, lay, nodes, snapshot, wrap } from "./helpers"

describe("layout properties", () => {
  test("no NaN/Infinity and no negative sizes, for any document", async () => {
    const e = await engine()
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
      { numRuns: 100 },
    )
  })

  test("flowing children never overlap along the main axis (gap >= 0, no wrap)", async () => {
    const e = await engine()
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
          const isRow = (table[pid]?.layout as { dir: string } | undefined)?.dir === "row"
          let end = Number.NEGATIVE_INFINITY
          for (const id of ids) {
            const b = r.nodes.get(id)?.local
            if (!b) throw new Error(`missing ${id}`)
            const start = isRow ? b.x : b.y
            // Yoga computes in float32: far from the origin a step is many px (32 px near 4.6e8),
            // so the tolerance grows with the magnitude.
            expect(start).toBeGreaterThanOrEqual(end - Math.max(1e-3, Math.abs(end) * 2 ** -20))
            end = start + (isRow ? b.w : b.h)
          }
        }
      }),
      { numRuns: 100 },
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
      { numRuns: 100 },
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
    expect([...r1.changed].sort()).toEqual(["a", "b", "f", "other"])
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

  test("roots that go away: an empty page lays out nothing, switching back restores it", async () => {
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

describe("incremental re-layout follows the parent's size mode, wrap and min/max", () => {
  const FILL = { mode: "fill" }
  const text = (parent: string, content: string) => ({
    type: "text",
    parent,
    content,
    grow: "fixed-width",
    w: FILL,
    style: { size: 10 },
  })
  const box = (parent: string, w: unknown, extra: Record<string, unknown> = {}) => ({
    type: "frame",
    parent,
    w,
    h: 10,
    ...extra,
  })
  const parentRow = (w: unknown, extra: Record<string, unknown> = {}) => ({
    type: "frame",
    parent: null,
    w,
    h: 100,
    layout: { dir: "row" },
    ...extra,
  })

  test("fit, fixed and wrapping parents switch the children's basis", async () => {
    const table = (w: unknown, wrapLines = false) =>
      nodes({
        r: parentRow(w, { layout: { dir: "row", wrap: wrapLines } }),
        a: text("r", "aaaa"),
        b: text("r", "bbbbbbbbbb"),
      })
    const e = createLayoutEngine()
    await e.init()
    const hug = wrap(e.compute(inputFor(table({ mode: "fit" }))))
    expect(hug.box("b")[2]).toBe(50)
    const fixed = wrap(e.update(inputFor(table(300)), { nodes: ["r"] }))
    expect(fixed.box("a")[2]).toBe(150)
    expect(fixed.box("b")).toEqual([150, 0, 150, 12.5])
    // wrap: content + half of the free 230 each.
    const wrapped = wrap(e.update(inputFor(table(300, true)), { nodes: ["r"] }))
    expect(wrapped.box("a")[2]).toBe(135)
    expect(wrapped.box("b")[2]).toBe(165)
    const back = wrap(e.update(inputFor(table({ mode: "fit" })), { nodes: ["r"] }))
    expect(back.box("a")[2]).toBe(20)
    expect(back.box("b")).toEqual([20, 0, 50, 12.5])
    e.dispose()
  })

  test("a sibling's padding change re-balances the others", async () => {
    const t = (pad: number) =>
      nodes({
        r: parentRow(300),
        a: box("r", FILL, { layout: { dir: "row", pad: [0, pad] } }),
        b: box("r", FILL),
      })
    const e = createLayoutEngine()
    await e.init()
    expect(wrap(e.compute(inputFor(t(0)))).box("b")[2]).toBe(150)
    const p = wrap(e.update(inputFor(t(60)), { nodes: ["a"] }))
    expect(p.box("a")[2]).toBe(150)
    expect(p.box("b")).toEqual([150, 0, 150, 10])
    e.dispose()
  })

  test("a grandparent switching to fit re-styles the grandchildren", async () => {
    const spec = (w: unknown) => ({
      r: parentRow(w),
      f: { type: "frame", parent: "r", w: FILL, h: 20, layout: { dir: "row" } },
      a: text("f", "aaaa"),
      b: text("f", "bbbbbbbbbb"),
    })
    const e = createLayoutEngine()
    await e.init()
    expect(wrap(e.compute(inputFor(nodes(spec(300))))).box("b")[2]).toBe(150)
    const hug = wrap(e.update(inputFor(nodes(spec({ mode: "fit" }))), { nodes: ["r"] }))
    expect(hug.box("f")[2]).toBe(70)
    expect(hug.box("b")[2]).toBe(50)
    const fresh = await lay(spec({ mode: "fit" }))
    expect(hug.box("b")).toEqual(fresh.box("b"))
    e.dispose()
  })

  test("resizing a container re-resolves min/max (frozen items thaw)", async () => {
    const e = createLayoutEngine()
    await e.init()
    const table = (w: number) =>
      nodes({
        g: { type: "frame", parent: null, w, layout: { dir: "row", gap: 8 } },
        a: box("g", { mode: "fill", weight: 2, min: 100 }, { h: 100 }),
        b: box("g", FILL, { h: 100 }),
        c: box("g", 200, { h: 100 }),
      } as never)
    const first = e.compute(inputFor(table(320)))
    expect(first.nodes.get("a")?.local.w).toBe(100)
    // 616 - 216 = 400 gives 266.7 / 133.3: no violation any more.
    const wide = e.update(inputFor(table(616)), { nodes: ["g"] })
    expect(wide.nodes.get("a")?.local.w).toBeCloseTo(266.6667, 3)
    expect(wide.nodes.get("b")?.local.w).toBeCloseTo(133.3333, 3)
    const narrow = e.update(inputFor(table(320)), { nodes: ["g"] })
    expect(narrow.nodes.get("a")?.local.w).toBe(100)
    expect(narrow.nodes.get("b")?.local.w).toBe(4)
    // An unrelated edit keeps the resolved sizes.
    const t = table(320)
    ;(t.c as { name?: string }).name = "renamed"
    const same = e.update(inputFor(t), { nodes: ["c"] })
    expect(same.nodes.get("a")?.local.w).toBe(100)
    expect(same.nodes.get("b")?.local.w).toBe(4)
    e.dispose()
  })
})

describe("paintOnlyHeaderChange", () => {
  // A header change that only repaints keeps the layout: the host skips the layout pass and
  // re-records bound pictures only. A false positive would leave a stale layout on screen.
  const header = (accent: unknown, extra: Record<string, unknown> = {}): ResolveHeader =>
    ({
      themes: { mode: ["light", "dark"] },
      variables: {
        accent: { type: "color", value: accent },
        pad: {
          type: "number",
          value: [
            { value: 8, when: { mode: "light" } },
            { value: 10, when: { mode: "dark" } },
          ],
        },
        ink: { type: "color", value: { $ref: "accent" } },
        ...extra,
      },
    }) as ResolveHeader

  const themed = (light: unknown, dark: unknown = "#A78BFA") => [
    { value: light, when: { mode: "light" } },
    { value: dark, when: { mode: "dark" } },
  ]

  test("a color value edited (same entries, no bindings moved) only repaints", () => {
    expect(paintOnlyHeaderChange(header(themed("#7C3AED")), header(themed("#7C20ED")))).toBe(true)
    expect(paintOnlyHeaderChange(header("#111111"), header("#222222"))).toBe(true)
  })

  test("anything a layout can read is a full change", () => {
    const h = header(themed("#7C3AED"))
    // A number variable.
    const pad = structuredClone(h)
    ;(pad.variables as Record<string, { value: unknown }>).pad = {
      type: "number",
      value: 4,
    } as never
    expect(paintOnlyHeaderChange(h, pad)).toBe(false)
    // Entry structure: a `when` changed, an entry added, plain to themed.
    expect(
      paintOnlyHeaderChange(
        h,
        header([
          { value: "#000000", when: { mode: "dark" } },
          { value: "#A78BFA", when: { mode: "dark" } },
        ]),
      ),
    ).toBe(false)
    expect(paintOnlyHeaderChange(h, header([...themed("#7C3AED"), { value: "#000000" }]))).toBe(
      false,
    )
    expect(paintOnlyHeaderChange(h, header("#7C3AED"))).toBe(false)
    // A binding added or retargeted.
    expect(paintOnlyHeaderChange(h, header(themed({ $ref: "ink" })))).toBe(false)
    expect(
      paintOnlyHeaderChange(
        header({ $ref: "a" }, { a: { type: "color", value: "#000" } }),
        header({ $ref: "b" }, { a: { type: "color", value: "#000" } }),
      ),
    ).toBe(false)
    // Variables added, themes or imports changed.
    expect(
      paintOnlyHeaderChange(h, {
        ...h,
        variables: { ...(h.variables as object), extra: { type: "color", value: "#000" } },
      } as ResolveHeader),
    ).toBe(false)
    expect(paintOnlyHeaderChange(h, { ...h, themes: { mode: ["dark", "light"] } })).toBe(false)
    expect(paintOnlyHeaderChange(h, { ...h, imports: { ui: "./ui.kimo" } })).toBe(false)
    // A non-color variable aliasing the changed one.
    const alias = (v: unknown) =>
      header(v, { weird: { type: "number", value: { $ref: "accent" } } })
    expect(paintOnlyHeaderChange(alias("#111111"), alias("#222222"))).toBe(false)
  })

  test("the layout of a document bound to both is the same before and after", async () => {
    const table = nodes({
      card: {
        type: "frame",
        parent: null,
        fill: { $ref: "accent" },
        layout: { dir: "column", pad: { $ref: "pad" }, gap: { $ref: "pad" } },
        stroke: { color: { $ref: "ink" }, width: 2 },
      },
      t: { type: "text", parent: "card", content: "Hello", fill: { $ref: "ink" } },
      r: { type: "rect", parent: "card", w: 20, h: 10, fill: { $ref: "accent" } },
    } as unknown as Record<string, LayoutNodeData>)
    const e = createLayoutEngine()
    await e.init()
    const run = (h: ResolveHeader) => {
      const src = nodeSourceFromDocument({ nodes: table as never })
      return snapshot(
        e.compute({ nodes: src, resolve: createResolver(h, src), measureText: fakeMeasurer }),
      )
    }
    const a = header(themed("#7C3AED"))
    const b = header(themed("#000000", "#FFFFFF"))
    expect(paintOnlyHeaderChange(a, b)).toBe(true)
    expect(run(b)).toEqual(run(a))
    e.dispose()
  })
})
