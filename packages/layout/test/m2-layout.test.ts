/**
 * M2 layout (ADR 0010): `NodeLayout.sizing` / `inFlow` / `content`, and the "Layout and
 * styling" cases the right panel edits (wrap, per-side padding, between/around, min/max, the
 * absolute toggle). Box goldens live in `test/golden/*.json` (regenerate with
 * `UPDATE_GOLDENS=1 bun test`).
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { openDocument } from "@kimo/core-schema"
import {
  createResolver,
  type LayoutNodeData,
  type LayoutResult,
  nodeSourceFromDocument,
} from "../src/index"
import { engine, fakeMeasurer, inputFor, lay, type NodeSpec, nodes, wrap } from "./helpers"

const root = { parent: null }
const rect = (parent: string, w: unknown, h: unknown, extra: Record<string, unknown> = {}) => ({
  type: "rect",
  parent,
  w,
  h,
  ...extra,
})
const fill = { mode: "fill" }
const row = (extra: Record<string, unknown> = {}) => ({ dir: "row", ...extra })
const col = (extra: Record<string, unknown> = {}) => ({ dir: "column", ...extra })

const GOLDEN_DIR = join(import.meta.dir, "golden")

/** Box golden: local/world boxes, sizing, inFlow and content of every node, in paint order. */
function boxGolden(name: string, r: LayoutResult) {
  const rows = r.order.map((id) => {
    const n = r.nodes.get(id)
    if (!n) return { id }
    const box = (b: { x: number; y: number; w: number; h: number }) => [b.x, b.y, b.w, b.h]
    return {
      id,
      local: box(n.local),
      world: box(n.world),
      sizing: n.sizing,
      inFlow: n.inFlow,
      ...(n.content ? { content: box(n.content) } : {}),
      ...(n.visible ? {} : { visible: false }),
    }
  })
  const file = join(GOLDEN_DIR, `${name}.json`)
  const text = `${JSON.stringify(rows, null, 1)}\n`
  if (process.env.UPDATE_GOLDENS || !existsSync(file)) {
    mkdirSync(GOLDEN_DIR, { recursive: true })
    writeFileSync(file, text)
  }
  expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(file, "utf8")))
}

describe("NodeLayout.sizing / inFlow / content", () => {
  test("fixed, fit (Hug) and fill per axis; inFlow for flowing children only", async () => {
    const l = await lay({
      f: { type: "frame", ...root, w: 300, layout: row({ pad: [10, 20], gap: 8 }) },
      a: rect("f", 48, 48),
      b: rect("f", fill, fill),
      c: { type: "frame", parent: "f", layout: col({ pad: 4 }) },
      cc: rect("c", 20, 30),
      abs: rect("f", fill, 10, { position: "absolute", x: 5, y: 5 }),
      absF: rect("f", { mode: "fill", fallback: 40 }, 10, { position: "absolute" }),
      hid: rect("f", 10, 10, { visible: false }),
    })
    expect(l.get("f").sizing).toEqual({ w: "fixed", h: "fit" })
    expect(l.get("a").sizing).toEqual({ w: "fixed", h: "fixed" })
    expect(l.get("b").sizing).toEqual({ w: "fill", h: "fill" })
    expect(l.get("c").sizing).toEqual({ w: "fit", h: "fit" })
    // fill outside the flow: fallback → fixed, none → content (fit)
    expect(l.get("abs").sizing).toEqual({ w: "fit", h: "fixed" })
    expect(l.get("absF").sizing).toEqual({ w: "fixed", h: "fixed" })
    expect(l.get("f").inFlow).toBe(false)
    expect(l.get("a").inFlow).toBe(true)
    expect(l.get("c").inFlow).toBe(true)
    expect(l.get("cc").inFlow).toBe(true)
    expect(l.get("abs").inFlow).toBe(false)
    expect(l.get("hid").inFlow).toBe(false)
    // content = inside the padding [10, 20, 10, 20] of the 300 × 68 frame
    expect(l.box("f")).toEqual([0, 0, 300, 68])
    expect(l.get("f").content).toEqual({ x: 20, y: 10, w: 260, h: 48 })
    expect(l.get("c").content).toEqual({ x: 4, y: 4, w: 20, h: 30 })
    expect(l.get("a").content).toBeUndefined()
  })

  test("FIT_ALL_FILL: children of a fit axis that all fill report fit", async () => {
    const l = await lay({
      f: { type: "frame", ...root, layout: row({ gap: 5 }) },
      a: { type: "frame", parent: "f", w: fill, h: fill, layout: row() },
      ar: rect("a", 30, 10),
      b: { type: "frame", parent: "f", w: { mode: "fill", fallback: 999 }, layout: row() },
      br: rect("b", 20, 25),
    })
    expect(l.get("a").sizing).toEqual({ w: "fit", h: "fill" })
    expect(l.get("b").sizing).toEqual({ w: "fit", h: "fit" })
    // One fixed sibling breaks the cycle: the fills are fills again.
    const m = await lay({
      f: { type: "frame", ...root, w: 200, layout: row() },
      a: rect("f", fill, 10),
      b: rect("f", fill, 10),
    })
    expect(m.get("a").sizing?.w).toBe("fill")
    expect(m.box("b")).toEqual([100, 0, 100, 10])
  })

  test("a frame without layout or a group has no content box; children are not in flow", async () => {
    const l = await lay({
      f: { type: "frame", ...root, w: 100, h: 100 },
      a: rect("f", 10, 10, { x: 5, y: 5 }),
      g: { type: "group", parent: "f" },
      gc: rect("g", 10, 10, { x: 40, y: 40 }),
    })
    expect(l.get("f").content).toBeUndefined()
    expect(l.get("a").inFlow).toBe(false)
    expect(l.get("g").sizing).toEqual({ w: "fit", h: "fit" })
    expect(l.get("gc").inFlow).toBe(false)
  })

  test("includeStroke per side shrinks the content box", async () => {
    const l = await lay({
      f: {
        type: "frame",
        ...root,
        w: 100,
        h: 50,
        stroke: { paint: "#000", width: { t: 1, b: 3 } },
        layout: row({ pad: [4, 6, 8, 10], includeStroke: true }),
      },
      a: rect("f", 10, 10),
    })
    expect(l.get("f").content).toEqual({ x: 10, y: 5, w: 84, h: 34 })
    expect(l.box("a")).toEqual([10, 5, 10, 10])
  })
})

describe("M2 right-panel cases", () => {
  test("individual padding [t, r, b, l] with justify end / align end", async () => {
    const l = await lay({
      f: {
        type: "frame",
        ...root,
        w: 200,
        h: 100,
        layout: row({ pad: [1, 2, 3, 4], justify: "end", align: "end" }),
      },
      a: rect("f", 20, 10),
    })
    expect(l.box("a")).toEqual([178, 87, 20, 10])
  })

  test("space between / around in a column with padding", async () => {
    const mk = (justify: string) =>
      lay({
        f: { type: "frame", ...root, w: 50, h: 140, layout: col({ pad: 10, justify }) },
        a: rect("f", 10, 20),
        b: rect("f", 10, 20),
        c: rect("f", 10, 20),
      })
    const between = await mk("between")
    expect([between.box("a")[1], between.box("b")[1], between.box("c")[1]]).toEqual([10, 60, 110])
    const around = await mk("around")
    // free 60 / 3 = 20 per child, 10 on each side
    expect([around.box("a")[1], around.box("b")[1], around.box("c")[1]]).toEqual([20, 60, 100])
  })

  test("wrap: fit height grows with the rows; fill children share each line", async () => {
    const l = await lay({
      f: {
        type: "frame",
        ...root,
        w: 120,
        layout: row({ wrap: true, gap: 10, crossGap: 4, pad: 10 }),
      },
      a: rect("f", 40, 10),
      b: rect("f", 40, 10),
      c: rect("f", 60, 20),
    })
    expect(l.box("c")).toEqual([10, 24, 60, 20])
    expect(l.box("f")).toEqual([0, 0, 120, 54])
    expect(l.get("f").content).toEqual({ x: 10, y: 10, w: 100, h: 34 })
  })

  test("min/max: fill clamps at max and the rest goes to the other fill", async () => {
    const l = await lay({
      f: { type: "frame", ...root, w: 300, h: 10, layout: row() },
      a: rect("f", { mode: "fill", max: 80 }, 10),
      b: rect("f", { mode: "fill", min: 10 }, 10),
    })
    expect(l.box("a")[2]).toBe(80)
    expect(l.box("b")).toEqual([80, 0, 220, 10])
    expect(l.get("a").sizing?.w).toBe("fill")
  })

  test("absolute toggle: the node leaves the flow, keeps its x/y, siblings close the gap", async () => {
    const spec: Record<string, NodeSpec> = {
      f: { type: "frame", ...root, layout: row({ gap: 10 }) },
      a: rect("f", 20, 20, { x: 7, y: 9 }),
      b: rect("f", 30, 20),
    }
    const e = await engine()
    const table = nodes(spec)
    const r1 = wrap(e.compute(inputFor(table)))
    expect(r1.box("a")).toEqual([0, 0, 20, 20]) // in flow: x/y ignored
    expect(r1.box("b")).toEqual([30, 0, 30, 20])
    expect(r1.get("a").inFlow).toBe(true)
    table.a = { ...(table.a as LayoutNodeData), position: "absolute" }
    const r2 = wrap(e.update(inputFor(table), { nodes: ["a"] }))
    expect(r2.box("a")).toEqual([7, 9, 20, 20])
    expect(r2.box("b")).toEqual([0, 0, 30, 20])
    expect(r2.box("f")).toEqual([0, 0, 30, 20])
    expect(r2.get("a").inFlow).toBe(false)
    // and back
    table.a = { ...(table.a as LayoutNodeData), position: undefined }
    const r3 = wrap(e.update(inputFor(table), { nodes: ["a"] }))
    expect(r3.box("b")).toEqual([30, 0, 30, 20])
    expect(r3.get("a").inFlow).toBe(true)
  })

  test("incremental: a sibling leaving fill updates the others' sizing", async () => {
    const e = await engine()
    const table = nodes({
      f: { type: "frame", ...root, layout: row() },
      a: rect("f", fill, 10),
      b: rect("f", fill, 10),
    })
    const r1 = wrap(e.compute(inputFor(table)))
    expect(r1.get("a").sizing?.w).toBe("fit")
    table.b = { ...(table.b as LayoutNodeData), w: 40 }
    const r2 = wrap(e.update(inputFor(table), { nodes: ["b"] }))
    expect(r2.get("a").sizing?.w).toBe("fill")
    expect(r2.get("b").sizing?.w).toBe("fixed")
  })
})

describe("box goldens", () => {
  test("m2-panel: board 08-like stack (wrap, per-side padding, between, absolute, min/max)", async () => {
    const l = await lay({
      panel: { type: "frame", ...root, x: 0, y: 0, w: 280, layout: col({ pad: [0, 0, 16, 0] }) },
      head: {
        type: "frame",
        parent: "panel",
        w: fill,
        layout: row({ pad: [12, 16, 8, 16], justify: "between", align: "center" }),
      },
      title: { type: "text", parent: "head", content: "Layout", fontSize: 12 },
      add: rect("head", 16, 16),
      body: {
        type: "frame",
        parent: "panel",
        w: fill,
        layout: row({ wrap: true, gap: 8, crossGap: 8, pad: [0, 16] }),
      },
      w1: rect("body", { mode: "fill", min: 100 }, 28),
      w2: rect("body", { mode: "fill", min: 100 }, 28),
      w3: rect("body", { mode: "fill", min: 100, max: 120 }, 28),
      badge: rect("body", 30, 14, { position: "absolute", x: 230, y: -7 }),
      foot: {
        type: "frame",
        parent: "panel",
        w: fill,
        h: { mode: "fit", min: 40 },
        layout: row({ pad: 16, justify: "around", align: "center" }),
      },
      f1: rect("foot", 24, 24),
      f2: rect("foot", 24, 24),
    })
    expect(l.result.issues).toEqual([])
    boxGolden("m2-panel", l.result)
  })

  test("styling-m2.kimo (core-schema fixture)", async () => {
    const text = readFileSync(
      join(import.meta.dir, "../../core-schema/fixtures/valid/styling-m2.kimo"),
      "utf8",
    )
    const doc = openDocument(text).doc
    const src = nodeSourceFromDocument(doc)
    const e = await engine()
    const r = e.compute({
      nodes: src,
      resolve: createResolver(doc, src),
      measureText: fakeMeasurer,
    })
    expect(r.issues).toEqual([])
    const l = wrap(r)
    // 720 wide, pad 40 → 640 content. A fill child's flex basis is 0, so everything fits one
    // line and the hero gets what is left: 640 − (24 · 3 + 260) − 4 gaps · 12 = 260.
    expect(l.box("HeroImg002")).toEqual([40, 40, 260, 220])
    expect(l.get("HeroImg002").sizing).toEqual({ w: "fill", h: "fixed" })
    expect(l.get("Mult000002").inFlow).toBe(false)
    expect(l.box("Mult000002")).toEqual([560, 20, 120, 120])
    expect(l.get("Board00002").content?.w).toBe(640)
    boxGolden("m2-styling", r)
  })
})
