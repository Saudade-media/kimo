/**
 * Layout over the core-schema expanded view: instances, slots, nested and derived components,
 * placeholders, per-instance incremental updates, effective themes (multi-axis) through
 * instances, library namespacing.
 */
import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import {
  createInstanceView,
  createLayoutEngine,
  createResolver,
  INSTANCE_PLACEHOLDER_SIZE,
  type LayoutEngine,
  type LayoutInput,
  type LayoutNodeData,
  nodeSourceFromDocument,
  type ResolveHeader,
  type TextMeasurer,
} from "../src/index"
import { fakeMeasurer, lay, nodes, snapshot } from "./helpers"

type Table = Record<string, LayoutNodeData>

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

/** A card component with a slot, a nested button instance and a derived component. */
const base = () =>
  nodes({
    btn: {
      type: "frame",
      parent: null,
      x: 400,
      component: { props: { text: { type: "text", target: "lbl", field: "content" } } },
      layout: { dir: "row", gap: 4, pad: [2, 6] },
    },
    ico: { type: "rect", parent: "btn", w: 10, h: 10 },
    lbl: label("btn", "OK"),
    card: {
      type: "frame",
      parent: null,
      x: 600,
      component: true,
      layout: { dir: "column", gap: 2, pad: 4 },
    },
    title: label("card", "Title"),
    body: { type: "frame", parent: "card", slot: {}, layout: { dir: "column" } },
    ph: { type: "rect", parent: "body", w: 30, h: 8 },
    cta: { type: "instance", parent: "card", of: "btn" },
    ghost: {
      type: "instance",
      parent: null,
      x: 800,
      of: "btn",
      component: true,
      overrides: { lbl: { set: { content: "Ghost" } } },
    },
    page: { type: "frame", parent: null, y: 300, layout: { dir: "row", gap: 8 } },
    i1: { type: "instance", parent: "page", of: "card" },
    i2: {
      type: "instance",
      parent: "page",
      of: "card",
      overrides: { body: { slot: true }, "cta/lbl": { set: { content: "Buy now" } } },
    },
    s1: { type: "rect", parent: "i2", at: "body", w: 50, h: 5 },
    g1: { type: "instance", parent: "page", of: "ghost", args: { text: "Hi" } },
    plain: { type: "rect", parent: null, y: 600, w: 5, h: 5 },
  })

function input(table: Table, header: ResolveHeader = {}): LayoutInput {
  const src = nodeSourceFromDocument({ nodes: table as never })
  return { nodes: src, resolve: createResolver(header, src), measureText: fakeMeasurer }
}

/** A store-like mutable source + shared view, as the web host wires it. */
function liveInput(start: Table, header: ResolveHeader = {}) {
  let table = start
  let src = nodeSourceFromDocument({ nodes: table as never })
  const store = {
    getNode: (id: string) => src.getNode(id),
    children: (p: string | null, at?: string | null) => src.children(p, at),
  }
  const view = createInstanceView(store, { header: () => header as never })
  const resolve = createResolver(header, view)
  const inp: LayoutInput = { nodes: store, expanded: view, resolve, measureText: fakeMeasurer }
  return {
    view,
    input: inp,
    get table() {
      return table
    },
    set(next: Table) {
      table = next
      src = nodeSourceFromDocument({ nodes: table as never })
      resolve.invalidate()
    },
  }
}

let fullEngine: LayoutEngine | null = null
async function full() {
  if (!fullEngine) {
    fullEngine = createLayoutEngine()
    await fullEngine.init()
  }
  return fullEngine
}

const patch = (table: Table, id: string, p: Record<string, unknown> | null): Table => {
  const next = { ...table }
  if (p === null) delete next[id]
  else next[id] = { ...(table[id] ?? {}), ...p } as LayoutNodeData
  return next
}

describe("instances", () => {
  test("an instance lays out its component tree at its own position", async () => {
    const l = await lay({
      ...button,
      i1: { type: "instance", parent: null, of: "btn", x: 10, y: 20 },
    })
    // component: 6 + 10 + 4 + 10 (OK = 2 x 5) + 6 = 36 wide, 2 + 12.5 + 2 tall
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

  test("slots, nested and derived instances lay out through the shared view", async () => {
    const e = await full()
    const r = e.compute(input(base()))
    const box = (id: string) => {
      const l = r.nodes.get(id)
      if (!l) throw new Error(`no ${id}`)
      return [l.local.x, l.local.y, l.local.w, l.local.h]
    }
    // btn: 6 + 10 + 4 + 10 + 6 = 36 x 16.5; card: 4 + max(25 title, 30 body, 36 cta) + 4
    expect(box("i1")).toEqual([0, 0, 44, 4 + 12.5 + 2 + 8 + 2 + 16.5 + 4])
    expect(box("i1/cta")).toEqual([4, 4 + 12.5 + 2 + 8 + 2, 36, 16.5])
    expect(box("i2/body")).toEqual([4, 18.5, 50, 5])
    expect(box("s1")).toEqual([0, 0, 50, 5])
    // "Buy now" = 7 x 5; an outer override reaches the nested instance's label
    expect(box("i2/cta/lbl")[2]).toBe(35)
    expect(r.nodes.has("i2/ph")).toBe(false)
    // derived: args beat the derived component's override (Hi = 10)
    expect(box("g1/lbl")[2]).toBe(10)
    expect(r.issues).toEqual([])
  })

  test("missing components and cycles are reported; the instance stays a placeholder", async () => {
    const l = await lay({
      a: { type: "instance", parent: null, of: "nothere" },
      b: { type: "instance", parent: null, of: "ui:card", props: { w: 30 } },
      loop: { type: "frame", parent: null, component: true },
      self: { type: "instance", parent: "loop", of: "loop" },
    })
    expect(l.box("a")).toEqual([0, 0, INSTANCE_PLACEHOLDER_SIZE.w, INSTANCE_PLACEHOLDER_SIZE.h])
    expect(l.box("b")).toEqual([0, 0, 30, INSTANCE_PLACEHOLDER_SIZE.h])
    const codes = l.result.issues.map((i) => `${i.nodeId}:${i.code}`)
    expect(codes).toContain("a:INSTANCE_UNRESOLVED")
    expect(codes).toContain("b:INSTANCE_UNRESOLVED")
    expect(codes).toContain("self/self:CYCLE")
  })
})

describe("incremental instance updates", () => {
  test("adding the missing component resolves the placeholder", async () => {
    const inc = createLayoutEngine()
    await inc.init()
    let t = nodes({ a: { type: "instance", parent: null, of: "late" } })
    inc.compute(input(t))
    t = {
      ...t,
      late: { type: "rect", parent: null, order: "b", x: 50, w: 7, h: 3, component: true } as never,
    }
    const r = inc.update(input(t), { nodes: ["late"] })
    expect(snapshot(r)).toEqual(snapshot((await full()).compute(input(t))))
    expect(r.nodes.get("a")?.local).toEqual({ x: 0, y: 0, w: 7, h: 3 })
    inc.dispose()
  })

  const steps: [string, (t: Table) => [Table, string[]]][] = [
    ["main text", (t) => [patch(t, "lbl", { content: "longer" }), ["lbl"]]],
    [
      "main child added",
      (t) => [
        patch(t, "new1", { type: "rect", parent: "card", order: "z", w: 60, h: 2 }),
        ["new1"],
      ],
    ],
    ["main child deleted", (t) => [patch(t, "ph", null), ["ph"]]],
    ["main layout", (t) => [patch(t, "card", { layout: { dir: "row", gap: 3 } }), ["card"]]],
    ["main child reordered", (t) => [patch(t, "cta", { order: "0" }), ["cta"]]],
    [
      "override",
      (t) => [patch(t, "i1", { overrides: { title: { set: { content: "X" } } } }), ["i1"]],
    ],
    [
      "slot content added",
      (t) => [
        patch(t, "s2", { type: "rect", parent: "i2", at: "body", order: "z", w: 70, h: 9 }),
        ["s2"],
      ],
    ],
    ["slot content edited", (t) => [patch(t, "s1", { w: 3 }), ["s1"]]],
    [
      "replace",
      (t) => [
        patch(patch(t, "i1", { overrides: { title: { replace: true } } }), "r1", {
          type: "ellipse",
          parent: "i1",
          at: "title",
          w: 4,
          h: 4,
        }),
        ["i1", "r1"],
      ],
    ],
    ["swap", (t) => [patch(t, "i1", { of: "btn" }), ["i1"]]],
    [
      "derived base override",
      (t) => [patch(t, "ghost", { overrides: { ico: { set: { w: 30 } } } }), ["ghost"]],
    ],
    [
      "instance moved into slot",
      (t) => [patch(t, "g1", { parent: "i2", at: "body", order: "zz" }), ["g1"]],
    ],
    ["instance deleted", (t) => [patch(t, "i2", null), ["i2", "s1"]]],
    ["plain node", (t) => [patch(t, "plain", { w: 8 }), ["plain"]]],
  ]

  /** Edits inside mains that do not shape the expansions (patched in place, see patchNodes). */
  const visualSteps: [string, (t: Table) => [Table, string[]]][] = [
    ["main fill", (t) => [patch(t, "ico", { fill: "#FF0000" }), ["ico"]]],
    ["main size", (t) => [patch(t, "ico", { w: 17 }), ["ico"]]],
    ["main text style", (t) => [patch(t, "title", { style: { size: 14 } }), ["title"]]],
    ["slot placeholder size", (t) => [patch(t, "ph", { h: 12 }), ["ph"]]],
    ["hidden in main", (t) => [patch(t, "ph", { visible: false }), ["ph"]]],
    ["shown again", (t) => [patch(t, "ph", { visible: true }), ["ph"]]],
    ["slot frame gap", (t) => [patch(t, "body", { layout: { dir: "row", gap: 5 } }), ["body"]]],
    ["main pin", (t) => [patch(t, "title", { theme: { mode: "dark" } }), ["title"]]],
    ["text overridden in i2", (t) => [patch(t, "lbl", { content: "Go" }), ["lbl"]]],
  ]

  test("each instance edit matches a full compute (and the next step still does)", async () => {
    const f = await full()
    // Standalone: the engine builds its own view. Shared: a host-owned view the engine patches.
    for (const shared of [false, true]) {
      const inc = createLayoutEngine()
      await inc.init()
      const live = liveInput(base())
      inc.compute(shared ? live.input : input(live.table))
      for (const [name, step] of shared ? [...visualSteps, ...steps] : steps) {
        const [next, dirty] = step(live.table)
        live.set(next)
        const a = inc.update(shared ? live.input : input(next), { nodes: dirty })
        expect({ shared, name, snap: snapshot(a) }).toEqual({
          shared,
          name,
          snap: snapshot(f.compute(input(next))),
        })
      }
      inc.dispose()
    }
  })

  test("only affected instances re-expand: other instances keep their node objects", async () => {
    const e = createLayoutEngine()
    await e.init()
    const live = liveInput(base())
    e.compute(live.input)
    const i1lbl = live.view.getNode("i1/cta/lbl")
    const g1 = live.view.getNode("g1/lbl")
    // A plain edit re-expands nothing.
    live.set(patch(live.table, "plain", { w: 9 }))
    const r2 = e.update(live.input, { nodes: ["plain"] })
    expect(live.view.getNode("i1/cta/lbl")).toBe(i1lbl)
    expect([...r2.changed]).toEqual(["plain"])
    // An override on i2 re-expands i2 only.
    live.set(patch(live.table, "i2", { overrides: { body: { slot: true } } }))
    const r3 = e.update(live.input, { nodes: ["i2"] })
    expect(live.view.getNode("i1/cta/lbl")).toBe(i1lbl)
    expect(live.view.getNode("g1/lbl")).toBe(g1)
    expect(r3.nodes.get("i2/cta/lbl")?.local.w).toBe(10)
    // Editing the button main re-lays out every instance that contains a button.
    live.set(patch(live.table, "lbl", { content: "Okay!" }))
    const r4 = e.update(live.input, { nodes: ["lbl"] })
    expect(live.view.getNode("i1/cta/lbl")).not.toBe(i1lbl)
    expect(r4.nodes.get("i1/cta/lbl")?.local.w).toBe(25)
    expect(r4.nodes.get("i2/cta/lbl")?.local.w).toBe(25)
    // g1 has args (Hi) so its label is unchanged: it was re-expanded (it uses btn), but an
    // equal re-expanded node keeps its previous object (identity-stable re-expansion).
    expect(live.view.getNode("g1/lbl")).toBe(g1)
    expect(r4.nodes.get("g1/lbl")?.local.w).toBe(10)
    expect(snapshot(r4)).toEqual(snapshot((await full()).compute(input(live.table))))
    e.dispose()
  })

  test("a visual edit inside a main patches every instance without re-expanding", async () => {
    const e = createLayoutEngine()
    await e.init()
    const live = liveInput(base())
    e.compute(live.input)
    const count = live.view.instanceCount
    const title = live.view.getNode("i1/title")
    const cta = live.view.getNode("i1/cta/lbl")
    live.set(patch(live.table, "ico", { fill: "#00FF00" }))
    const r = e.update(live.input, { nodes: ["ico"] })
    // No expansion ran again; untouched view nodes keep their objects.
    expect(live.view.instanceCount).toBe(count)
    expect(live.view.getNode("i1/title")).toBe(title)
    expect(live.view.getNode("i1/cta/lbl")).toBe(cta)
    expect(live.view.getNode("i1/cta/ico")?.fill).toBe("#00FF00")
    expect(live.view.getNode("g1/ico")?.fill).toBe("#00FF00")
    expect(snapshot(r)).toEqual(snapshot((await full()).compute(input(live.table))))
    // A structural edit still re-expands (and still matches a full compute).
    live.set(patch(live.table, "ico", { order: "zz" }))
    const r2 = e.update(live.input, { nodes: ["ico"] })
    expect(live.view.children("i1/cta")).toEqual(["i1/cta/lbl", "i1/cta/ico"])
    expect(snapshot(r2)).toEqual(snapshot((await full()).compute(input(live.table))))
    e.dispose()
  })
})

describe("InstanceView invalidation", () => {
  /** `liveInput` plus a count of base reads (re-expansion reads the base again). */
  function counted(start: Table) {
    let table = start
    let src = nodeSourceFromDocument({ nodes: table as never })
    let reads = 0
    const store = {
      getNode: (id: string) => {
        reads++
        return src.getNode(id)
      },
      children: (p: string | null, at?: string | null) => src.children(p, at),
    }
    const view = createInstanceView(store, { header: (() => ({})) as never })
    const walk = () => {
      const out: Record<string, unknown> = {}
      const go = (id: string) => {
        out[id] = view.getNode(id)
        for (const c of view.children(id)) go(c)
      }
      for (const r of view.children(null)) go(r)
      return out
    }
    return {
      view,
      walk,
      reads: () => reads,
      set(next: Table) {
        table = next
        src = nodeSourceFromDocument({ nodes: table as never })
      },
      get table() {
        return table
      },
    }
  }

  test("nothing changed: same node objects, no re-expansion", () => {
    const c = counted(base())
    const a = c.walk()
    const expand = c.reads() // a first walk expands every instance
    c.view.invalidate()
    c.set({ ...c.table }) // a new source holding the same node objects
    const before = c.reads()
    const b = c.walk()
    for (const [id, n] of Object.entries(a)) expect(b[id]).toBe(n)
    // Verifying re-reads each node an expansion read once; re-expanding reads them again too.
    expect(c.reads() - before).toBeLessThan(expand)
  })

  test("a change the expansion read is picked up after invalidate()", () => {
    const c = counted(base())
    c.walk()
    c.set(patch(c.table, "lbl", { content: "Okay!" }))
    c.view.invalidate()
    const w = c.walk()
    expect((w["i1/cta/lbl"] as { content: string }).content).toBe("Okay!")
    // Same answer as a fresh view.
    const fresh = counted(c.table)
    expect(fresh.walk()).toEqual(w)
  })
})

describe("effective themes through instances", () => {
  const header: ResolveHeader = {
    themes: { mode: ["light", "dark"], density: ["comfortable", "compact"] },
    variables: {
      pad: {
        type: "number",
        value: [
          { value: 10 },
          { value: 4, when: { density: "compact" } },
          { value: 20, when: { density: "compact", mode: "dark" } },
        ],
      },
    } as never,
  }
  const doc = () =>
    nodes({
      chip: {
        type: "frame",
        parent: null,
        component: true,
        theme: { density: "compact" },
        layout: { dir: "row", pad: { $ref: "pad" } },
      },
      dot: { type: "rect", parent: "chip", w: 2, h: 2 },
      a: { type: "instance", parent: null, of: "chip" },
      b: { type: "instance", parent: null, of: "chip", theme: { mode: "dark" } },
      c: { type: "instance", parent: null, of: "chip", theme: { density: "comfortable" } },
      dark: { type: "frame", parent: null, theme: { mode: "dark" } },
      d: { type: "instance", parent: "dark", of: "chip" },
    })

  test("component root pins carry into instances; instance pins win axis by axis", async () => {
    const live = liveInput(doc(), header)
    const e = createLayoutEngine()
    await e.init()
    const r = e.compute(live.input)
    const w = (id: string) => r.nodes.get(id)?.local.w
    expect(w("chip")).toBe(2 + 2 * 4) // compact, light
    expect(w("a")).toBe(2 + 2 * 4)
    expect(w("b")).toBe(2 + 2 * 20) // compact (component) + dark (instance)
    expect(w("c")).toBe(2 + 2 * 10) // instance overrides density
    expect(w("d")).toBe(2 + 2 * 20) // dark from the placement path
    expect(live.view.theme("d/dot")).toEqual({ mode: "dark", density: "compact" })
    e.dispose()
  })

  test("changing an instance theme pin re-resolves its whole subtree incrementally", async () => {
    const live = liveInput(doc(), header)
    const e = createLayoutEngine()
    await e.init()
    e.compute(live.input)
    live.set(patch(live.table, "a", { theme: { mode: "dark" } }))
    const r = e.update(live.input, { nodes: ["a"] })
    expect(r.nodes.get("a")?.local.w).toBe(42)
    const f = createLayoutEngine()
    await f.init()
    expect(snapshot(r)).toEqual(snapshot(f.compute(liveInput(live.table, header).input)))
    e.dispose()
    f.dispose()
  })

  test("toggling a pin on a plain parent re-resolves the bound nodes below it", async () => {
    // Only bound descendants are re-read (a pin over 500 instances); unbound ones keep their
    // state. Both directions must equal a full compute.
    const live = liveInput(doc(), header)
    const e = createLayoutEngine()
    await e.init()
    const f = createLayoutEngine()
    await f.init()
    e.compute(live.input)
    for (const pin of [{ mode: "light" }, undefined, { density: "comfortable" }]) {
      const next = { ...live.table }
      const { theme: _, ...rest } = next.dark as Record<string, unknown>
      next.dark = (pin ? { ...rest, theme: pin } : rest) as never
      live.set(next)
      const r = e.update(live.input, { nodes: ["dark"] })
      expect(snapshot(r)).toEqual(snapshot(f.compute(liveInput(live.table, header).input)))
    }
    // The component root's own density pin wins over the parent's: compact, light.
    expect(e.current?.nodes.get("d")?.local.w).toBe(2 + 2 * 4)
    e.dispose()
    f.dispose()
  })

  test("library content: bindings and pins are namespaced (alias:name)", async () => {
    const lib = {
      format: "1.0.0",
      themes: { size: ["md", "lg"] },
      variables: {
        gap: { type: "number", value: [{ value: 3 }, { value: 9, when: { size: "lg" } }] },
      },
      nodes: nodes({
        pill: {
          type: "frame",
          parent: null,
          component: true,
          theme: { size: "lg" },
          layout: { dir: "row", gap: { $ref: "gap" } },
        },
        x1: { type: "rect", parent: "pill", w: 1, h: 1 },
        x2: { type: "rect", parent: "pill", w: 1, h: 1 },
      }),
    } as unknown as KimoDocument
    const libraries = { ui: lib }
    const t = nodes({
      p: { type: "instance", parent: null, of: "ui:pill" },
      q: { type: "instance", parent: null, of: "ui:pill", theme: { "ui:size": "md" } },
    })
    const src = nodeSourceFromDocument({ nodes: t as never })
    const hdr: ResolveHeader = { imports: { ui: "./ui.kimo" } }
    const view = createInstanceView(src, { libraries, header: () => hdr as never })
    const e = createLayoutEngine({ libraries })
    await e.init()
    const r = e.compute({
      nodes: src,
      expanded: view,
      resolve: createResolver(hdr, view, { libraries }),
      measureText: fakeMeasurer,
    })
    expect(r.nodes.get("p")?.local.w).toBe(11)
    expect(r.nodes.get("q")?.local.w).toBe(5)
    expect(r.issues).toEqual([])
    e.dispose()
  })
})

describe("refresh (compute on a live engine) over a shared view", () => {
  test("header and node changes since the last pass equal a fresh compute", async () => {
    const themed = (light: number, dark: number) => ({
      type: "number",
      value: [
        { value: light, when: { mode: "light" } },
        { value: dark, when: { mode: "dark" } },
      ],
    })
    let header: ResolveHeader = {
      themes: { mode: ["light", "dark"] },
      variables: { pad: themed(4, 8), gap: themed(2, 6) } as never,
    }
    let table: Table = nodes({
      card: {
        type: "frame",
        parent: null,
        component: true,
        layout: { dir: "column", gap: { $ref: "gap" }, pad: { $ref: "pad" } },
      },
      a1: { type: "rect", parent: "card", w: 10, h: 4 },
      a2: { type: "rect", parent: "card", w: 12, h: 4 },
      i1: { type: "instance", parent: null, of: "card", x: 40 },
      i2: { type: "instance", parent: null, of: "card", x: 80, theme: { mode: "dark" } },
      box: { type: "frame", parent: null, x: 120, w: 30, h: 30 },
      i3: { type: "instance", parent: "box", of: "card" },
    })
    let src = nodeSourceFromDocument({ nodes: table as never })
    const store = {
      getNode: (id: string) => src.getNode(id),
      children: (p: string | null, at?: string | null) => src.children(p, at),
    }
    const view = createInstanceView(store, { header: () => header as never })
    const resolve = createResolver(() => header, view)
    // A measurer with a font generation (as the renderer's): refreshes skip re-measuring.
    const measureText: TextMeasurer = {
      generation: 0,
      measure: (t, w) => fakeMeasurer.measure(t, w),
    }
    const inp: LayoutInput = { nodes: store, expanded: view, resolve, measureText }
    const e = createLayoutEngine()
    await e.init()
    const f = createLayoutEngine()
    await f.init()
    const fresh = () => {
      const s2 = nodeSourceFromDocument({ nodes: table as never })
      const v2 = createInstanceView(s2, { header: () => header as never })
      return snapshot(
        f.compute({
          nodes: s2,
          expanded: v2,
          resolve: createResolver(() => header, v2),
          measureText: fakeMeasurer,
        }),
      )
    }
    e.compute(inp)
    const step = (h: ResolveHeader, t: Table) => {
      header = h
      table = t
      src = nodeSourceFromDocument({ nodes: table as never })
      resolve.invalidate()
      view.invalidate() // the host's full invalidation before a compute
      expect(snapshot(e.compute(inp))).toEqual(fresh())
    }
    // Default mode switch (variables dialog "make default"): expansions kept, bound re-read.
    step({ ...header, themes: { mode: ["dark", "light"] } }, table)
    // A variable value edit.
    step({ ...header, variables: { pad: themed(1, 2), gap: themed(3, 3) } as never }, table)
    // A main edit and a pin made without an update in between (expansions must not be kept).
    step(header, patch(patch(table, "a2", { w: 40 }), "box", { theme: { mode: "dark" } }))
    // A new instance and a deleted one.
    step(
      header,
      patch(patch(table, "i4", { type: "instance", parent: null, of: "card" }), "i1", null),
    )
    // Values-only header changes (DirtySet `valuesOnly`): no view invalidation, bound entries
    // re-resolve, interleaved with node updates (patched main edits included).
    const values = (h: ResolveHeader) => {
      header = h
      resolve.invalidate()
      expect(snapshot(e.update(inp, { nodes: [], header: true, valuesOnly: true }))).toEqual(
        fresh(),
      )
    }
    const edit = (t: Table, ids: string[]) => {
      table = t
      src = nodeSourceFromDocument({ nodes: table as never })
      resolve.invalidate()
      expect(snapshot(e.update(inp, { nodes: ids }))).toEqual(fresh())
    }
    values({ ...header, themes: { mode: ["light", "dark"] } })
    values({ ...header, variables: { pad: themed(9, 1), gap: themed(0, 12) } as never })
    edit(patch(table, "a1", { h: 9 }), ["a1"])
    values({ ...header, themes: { mode: ["dark", "light"] } })
    edit(patch(table, "box", { theme: { mode: "light" } }), ["box"])
    values({ ...header, variables: { pad: themed(3, 3), gap: themed(5, 7) } as never })
    values({ ...header, themes: { mode: ["light", "dark"] } })
    e.dispose()
    f.dispose()
  })
})
