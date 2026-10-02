import { describe, expect, test } from "bun:test"
import { expandInstances, nodeSourceFromDocument } from "../src/index"
import { lay, nodes } from "./helpers"

const label = (parent: string, content: string, extra: Record<string, unknown> = {}) => ({
  type: "text",
  parent,
  content,
  style: { size: 10 },
  ...extra,
})

/** A "Button" component: a padded row with an icon square and a label. */
const button = {
  btn: {
    type: "frame",
    parent: null,
    x: 500,
    y: 500,
    component: {
      props: {
        text: { type: "text", target: "lbl", field: "content" },
        showIcon: { type: "boolean", target: "ico", field: "visible" },
        size: { type: "enum", target: "lbl", field: "style", options: { big: { size: 20 } } },
      },
    },
    layout: { dir: "row", gap: 4, pad: [2, 6] },
  },
  ico: { type: "rect", parent: "btn", w: 10, h: 10 },
  lbl: label("btn", "OK"),
}

describe("instances (spec §9)", () => {
  test("an instance lays out its component tree at its own position", async () => {
    const l = await lay({
      ...button,
      i1: { type: "instance", parent: null, of: "btn", x: 10, y: 20 },
    })
    // component: 6 + 10 + 4 + 10 (OK = 2 × 5) + 6 = 36 wide, 2 + 12.5 + 2 tall
    expect(l.box("btn")).toEqual([500, 500, 36, 16.5])
    expect(l.box("i1")).toEqual([10, 20, 36, 16.5])
    expect(l.box("i1/lbl")).toEqual([20, 2, 10, 12.5])
    expect(l.world("i1/lbl")).toEqual([30, 22, 10, 12.5])
    expect(l.result.order).toEqual(["btn", "ico", "lbl", "i1", "i1/ico", "i1/lbl"])
  })
  test("props override the root; set overrides descendants; args map to declared props", async () => {
    const l = await lay({
      ...button,
      a: { type: "instance", parent: null, of: "btn", props: { w: 100 } },
      b: {
        type: "instance",
        parent: null,
        of: "btn",
        overrides: { lbl: { set: { content: "Cancel" } } },
      },
      c: { type: "instance", parent: null, of: "btn", args: { text: "Go!", showIcon: false } },
      d: { type: "instance", parent: null, of: "btn", args: { size: "big" } },
    })
    expect(l.box("a")[2]).toBe(100)
    expect(l.box("b/lbl")[2]).toBe(30)
    expect(l.box("c")[2]).toBe(27) // no icon: 6 + 15 + 6
    expect(l.get("c/ico").visible).toBe(false)
    expect(l.box("d/lbl")).toEqual([20, 2, 20, 25])
  })
  test("precedence: overrides beat args beat props", async () => {
    const l = await lay({
      ...button,
      a: {
        type: "instance",
        parent: null,
        of: "btn",
        args: { text: "aaaa" },
        overrides: { lbl: { set: { content: "a" } } },
      },
    })
    expect(l.box("a/lbl")[2]).toBe(5)
  })
  test("slots take the instance-owned nodes; replace swaps one node", async () => {
    const l = await lay({
      card: { type: "frame", parent: null, component: true, layout: { dir: "column" } },
      title: label("card", "Title"),
      body: { type: "frame", parent: "card", slot: {}, layout: { dir: "column" } },
      ph: { type: "rect", parent: "body", w: 1, h: 1 },
      inst: {
        type: "instance",
        parent: null,
        of: "card",
        y: 100,
        overrides: { body: { slot: true }, title: { replace: true } },
      },
      s1: { type: "rect", parent: "inst", at: "body", w: 40, h: 10 },
      s2: { type: "rect", parent: "inst", at: "body", w: 20, h: 10 },
      rep: { type: "rect", parent: "inst", at: "title", w: 7, h: 7 },
    })
    expect(l.box("inst")).toEqual([0, 100, 40, 27])
    expect(l.box("rep")).toEqual([0, 0, 7, 7])
    expect(l.box("inst/body")).toEqual([0, 7, 40, 20])
    expect(l.box("s2")).toEqual([0, 10, 20, 10])
    expect(l.result.nodes.has("inst/title")).toBe(false)
    expect(l.result.nodes.has("inst/ph")).toBe(false)
  })
  test("nested instances: paths cross instance boundaries; outer overrides win", async () => {
    const l = await lay({
      ...button,
      bar: { type: "frame", parent: null, component: true, layout: { dir: "row", gap: 1 } },
      ok: {
        type: "instance",
        parent: "bar",
        of: "btn",
        overrides: { lbl: { set: { content: "inner" } } },
      },
      i: {
        type: "instance",
        parent: null,
        of: "bar",
        overrides: { "ok/lbl": { set: { content: "outer!" } } },
      },
    })
    expect(l.box("i/ok/lbl")[2]).toBe(30)
    expect(l.box("ok/lbl")[2]).toBe(25) // the master's own nested instance
    expect(l.box("i/ok")[2]).toBe(56)
  })
  test("derived components resolve through to their base", async () => {
    const l = await lay({
      ...button,
      ghost: {
        type: "instance",
        parent: null,
        of: "btn",
        component: true,
        overrides: { lbl: { set: { content: "Ghost" } } },
      },
      g: { type: "instance", parent: null, of: "ghost", args: { showIcon: false } },
      h: {
        type: "instance",
        parent: null,
        of: "ghost",
        overrides: { lbl: { set: { content: "x" } } },
      },
    })
    expect(l.box("g/lbl")[2]).toBe(25)
    expect(l.get("g/ico").visible).toBe(false)
    expect(l.box("h/lbl")[2]).toBe(5)
  })
  test("library components (alias:id)", async () => {
    const lib = {
      nodes: nodes({
        pill: { type: "frame", parent: null, component: true, layout: { dir: "row", pad: 3 } },
        txt: label("pill", "abc"),
      }),
    }
    const l = await lay(
      {
        p: {
          type: "instance",
          parent: null,
          of: "ui:pill",
          overrides: { "ui:txt": { set: { content: "abcdef" } } },
        },
      },
      {},
      { libraries: { ui: lib as never } },
    )
    expect(l.box("p")).toEqual([0, 0, 36, 18.5])
    expect(l.box("p/ui:txt")).toEqual([3, 3, 30, 12.5])
  })
  test("missing components and cycles are reported; the instance stays a placeholder", async () => {
    const l = await lay({
      a: { type: "instance", parent: null, of: "nothere", props: { w: 30, h: 20 } },
      loop: { type: "frame", parent: null, component: true },
      self: { type: "instance", parent: "loop", of: "loop" },
    })
    expect(l.box("a")).toEqual([0, 0, 30, 20])
    const codes = l.result.issues.map((i) => `${i.nodeId}:${i.code}`)
    expect(codes).toContain("a:UNSUPPORTED_NODE")
    expect(codes).toContain("self/self:CYCLE")
  })
  test("the expanded source is usable on its own (renderer/host)", () => {
    const src = expandInstances(
      nodeSourceFromDocument({
        nodes: nodes({
          ...button,
          i: { type: "instance", parent: null, of: "btn", x: 3 },
        }) as never,
      }),
    )
    expect(src.getNode("i")).toMatchObject({ type: "frame", x: 3, parent: null })
    expect(src.getNode("i")?.component).toBeUndefined()
    expect(src.children("i")).toEqual(["i/ico", "i/lbl"])
    expect(src.getNode("i/lbl")).toMatchObject({ type: "text", parent: "i", content: "OK" })
    expect(src.isSynthetic("i/lbl")).toBe(true)
    expect(src.isSynthetic("lbl")).toBe(false)
  })
})

describe("instances and incremental update", () => {
  test("editing a component or an override re-expands every instance", async () => {
    const { createLayoutEngine } = await import("../src/index")
    const { inputFor, snapshot } = await import("./helpers")
    const inc = createLayoutEngine()
    const full = createLayoutEngine()
    await inc.init()
    await full.init()
    let table = nodes({
      ...button,
      i1: { type: "instance", parent: null, of: "btn" },
      i2: {
        type: "instance",
        parent: null,
        of: "btn",
        overrides: { lbl: { set: { content: "x" } } },
      },
      plain: { type: "rect", parent: null, w: 5, h: 5 },
    })
    inc.compute(inputFor(table))
    const step = (patch: Record<string, Record<string, unknown>>) => {
      const dirty: string[] = []
      for (const [id, p] of Object.entries(patch)) {
        table = { ...table, [id]: { ...table[id], ...p } as never }
        dirty.push(id)
      }
      const a = inc.update(inputFor(table), { nodes: dirty })
      expect(snapshot(a)).toEqual(snapshot(full.compute(inputFor(table))))
      return a
    }
    expect(step({ lbl: { content: "longer label" } }).nodes.get("i1/lbl")?.local.w).toBe(60)
    expect(
      step({ i2: { overrides: { lbl: { set: { content: "abc" } } } } }).nodes.get("i2/lbl")?.local
        .w,
    ).toBe(15)
    expect(step({ plain: { w: 9 } }).nodes.get("plain")?.local.w).toBe(9)
    inc.dispose()
    full.dispose()
  })
})
