/**
 * Instance expansion, M3 coverage (spec §9, §9.8, §10.4; ADR 0011): every override kind,
 * nested instances, args (text / boolean / enum / instance swap; slot props take none),
 * derived components, theme per placement, library namespacing of swaps, incremental
 * re-expansion and the performance budget.
 */
import { describe, expect, test } from "bun:test"
import {
  createExpandedView,
  documentLookup,
  type KimoDocument,
  type NodeLookup,
  validate,
} from "../src/index"
import { doc } from "./helpers"

/** Fills in `order` (a0, a1, … by insertion) for terse node tables. */
function nodes(table: Record<string, Record<string, unknown>>) {
  const n: Record<string, Record<string, unknown>> = {}
  let i = 0
  for (const [id, v] of Object.entries(table)) n[id] = { order: `a${i++}`, ...v }
  return n
}

const view = (d: KimoDocument, libraries = {}) =>
  createExpandedView(documentLookup(d), { libraries, header: () => d })

/** Every view id under `id` (pre-order, including `id`). */
function walk(v: NodeLookup, id: string, out: string[] = []): string[] {
  out.push(id)
  for (const c of v.children(id)) walk(v, c, out)
  return out
}

const icons = {
  icoA000001: { type: "frame", parent: null, component: true, w: 16, h: 16, name: "Icon/A" },
  icoAglyph1: { type: "rect", parent: "icoA000001", w: 8, h: 8, fill: "#000000" },
  icoB000001: { type: "frame", parent: null, component: true, w: 24, h: 24, name: "Icon/B" },
  icoBglyph1: { type: "rect", parent: "icoB000001", w: 12, h: 12, fill: "#FF0000" },
}

const button = {
  btn0000001: {
    type: "frame",
    parent: null,
    name: "Button",
    component: {
      props: {
        icon: { type: "instance", target: "btnIcon001", default: "icoA000001", order: "a0" },
        label: { type: "text", target: "btnLabel01", field: "content", order: "a1" },
        showLabel: { type: "boolean", target: "btnLabel01", field: "visible", order: "a2" },
        tone: {
          type: "enum",
          target: "btn0000001",
          field: "fill",
          options: { brand: "#7C3AED", plain: "#FFFFFF" },
          order: "a3",
        },
      },
    },
    fill: "#000000",
    layout: { dir: "row", gap: 4 },
  },
  btnIcon001: { type: "instance", parent: "btn0000001", of: "icoA000001" },
  btnLabel01: { type: "text", parent: "btn0000001", content: "Button" },
}

describe("args: text, boolean, enum at the root, instance swap; slot props take none", () => {
  const d = doc(
    nodes({
      ...icons,
      ...button,
      card000001: {
        type: "frame",
        parent: null,
        component: { props: { body: { type: "slot", target: "slot000001" } } },
      },
      slot000001: { type: "frame", parent: "card000001", slot: {} },
      i100000001: {
        type: "instance",
        parent: null,
        of: "btn0000001",
        args: { icon: "icoB000001", label: "Save", showLabel: false, tone: "brand" },
      },
      i200000001: { type: "instance", parent: null, of: "card000001" },
    }),
  )

  test("the document validates", () => {
    expect(validate(d).errors).toEqual([])
  })

  test("each arg lands on its target with the args layer", () => {
    const v = view(d)
    expect(v.getNode("i100000001")?.fill).toBe("#7C3AED")
    expect(v.getNode("i100000001/btnLabel01")).toMatchObject({ content: "Save", visible: false })
    expect(v.origin("i100000001/btnLabel01")?.overrides.map((o) => o.key)).toEqual([
      "label",
      "showLabel",
    ])
  })

  test("an instance-prop arg swaps the nested instance; its content follows", () => {
    const v = view(d)
    expect(v.origin("i100000001/btnIcon001")?.instance?.chain).toEqual(["icoB000001"])
    expect(v.getNode("i100000001/btnIcon001")).toMatchObject({ w: 24, h: 24 })
    expect(v.children("i100000001/btnIcon001")).toEqual(["i100000001/btnIcon001/icoBglyph1"])
    expect(v.issues("i100000001")).toEqual([])
  })

  test("an instance without content in a slot reads the slot's authored children", () => {
    const v = view(d)
    expect(v.children("i200000001")).toEqual(["i200000001/slot000001"])
    expect(v.origin("i200000001/slot000001")?.slot).toEqual({ overridden: false, empty: true })
  })
})

describe("overrides on nested instances (§9.3, §9.8)", () => {
  const d = doc(
    nodes({
      ...icons,
      ...button,
      bar0000001: { type: "frame", parent: null, component: true, layout: { dir: "row" } },
      barBtn0001: {
        type: "instance",
        parent: "bar0000001",
        of: "btn0000001",
        args: { label: "Inner" },
        overrides: { btnLabel01: { set: { content: "Own" } } },
      },
      top0000001: {
        type: "instance",
        parent: null,
        of: "bar0000001",
        overrides: {
          "barBtn0001/btnLabel01": { set: { content: "Outer" } },
          barBtn0001: { set: { of: "btn0000001", args: { icon: "icoB000001" }, props: { w: 99 } } },
        },
      },
      top0000002: {
        type: "instance",
        parent: null,
        of: "bar0000001",
        overrides: { "barBtn0001/btnIcon001": { set: { of: "icoB000001" } } },
      },
      top0000003: {
        type: "instance",
        parent: null,
        of: "bar0000001",
        overrides: { "barBtn0001/btnIcon001": { replace: true } },
      },
      rep0000001: {
        type: "instance",
        parent: "top0000003",
        at: "barBtn0001/btnIcon001",
        of: "icoB000001",
      },
    }),
  )

  test("the document validates", () => {
    expect(validate(d).errors).toEqual([])
  })

  test("an outer override of a deep path wins over the nested instance's own", () => {
    const v = view(d)
    expect(v.getNode("top0000001/barBtn0001/btnLabel01")?.content).toBe("Outer")
    expect(
      v.origin("top0000001/barBtn0001/btnLabel01")?.overrides.map((o) => `${o.holder}:${o.key}`),
    ).toEqual([
      // The nested instance's own `label` arg is gone: the outer set.args replaced its args.
      "top0000001/barBtn0001:btnLabel01",
      "top0000001:barBtn0001/btnLabel01",
    ])
  })

  test("set.args and set.props on a nested instance replace its own wholesale", () => {
    const v = view(d)
    expect(v.getNode("top0000001/barBtn0001")?.w).toBe(99)
    // set.args replaced { label: "Inner" } with { icon }: the icon swaps, the label arg is gone.
    expect(v.origin("top0000001/barBtn0001/btnIcon001")?.instance?.of).toBe("icoB000001")
    const labelLayers = v.origin("top0000001/barBtn0001/btnLabel01")?.overrides.map((o) => o.key)
    expect(labelLayers).not.toContain("label")
  })

  test("a deep set.of swaps a nested-nested instance", () => {
    const v = view(d)
    expect(v.children("top0000002/barBtn0001/btnIcon001")).toEqual([
      "top0000002/barBtn0001/btnIcon001/icoBglyph1",
    ])
  })

  test("a replacement that is an instance expands as its own top", () => {
    const v = view(d)
    expect(v.children("top0000003/barBtn0001")).toEqual([
      "rep0000001",
      "top0000003/barBtn0001/btnLabel01",
    ])
    expect(v.getNode("rep0000001")?.parent).toBe("top0000003/barBtn0001")
    expect(v.origin("rep0000001")?.owned).toEqual({
      instance: "top0000003",
      at: "barBtn0001/btnIcon001",
      mode: "replace",
    })
    expect(v.children("rep0000001")).toEqual(["rep0000001/icoBglyph1"])
  })
})

describe("derived components (§9.1, §9.6)", () => {
  const d = doc(
    nodes({
      ...icons,
      ...button,
      ghost00001: {
        type: "instance",
        parent: null,
        of: "btn0000001",
        component: { props: { label: { type: "text", target: "btnLabel01", field: "content" } } },
        props: { fill: "#EEEEEE", opacity: 0.8 },
        args: { label: "Ghost", tone: "plain" },
        overrides: { btnLabel01: { set: { fill: "#7C3AED" } } },
        theme: { mode: "dark" },
      },
      ghostSm001: {
        type: "instance",
        parent: null,
        of: "ghost00001",
        component: true,
        props: { opacity: 0.6 },
      },
      use0000001: {
        type: "instance",
        parent: null,
        of: "ghostSm001",
        args: { icon: "icoB000001", tone: "brand" },
        theme: { density: "compact" },
      },
    }),
    { themes: { mode: ["light", "dark"], density: ["comfortable", "compact"] } },
  )

  test("the document validates", () => {
    expect(validate(d).errors).toEqual([])
  })

  test("precedence: authored < derived (base first) < instance props < args", () => {
    const v = view(d)
    const root = v.getNode("use0000001")
    // tone "plain" (ghost's args) is overwritten by the instance's "brand".
    expect(root?.fill).toBe("#7C3AED")
    expect(root?.opacity).toBe(0.6)
    expect(v.origin("use0000001")?.overrides.map((o) => `${o.layer}:${o.key}`)).toEqual([
      "derived:",
      "derived:tone",
      "derived:",
      "args:tone",
    ])
    expect(v.getNode("use0000001/btnLabel01")).toMatchObject({
      content: "Ghost",
      fill: "#7C3AED",
    })
  })

  test("inherited instance prop through two derived links", () => {
    const v = view(d)
    expect(v.origin("use0000001")?.instance?.chain).toEqual([
      "ghostSm001",
      "ghost00001",
      "btn0000001",
    ])
    expect(v.origin("use0000001/btnIcon001")?.instance?.of).toBe("icoB000001")
  })

  test("theme: derived root pins sit under the instance's own (axis by axis)", () => {
    const v = view(d)
    expect(v.getNode("use0000001")?.theme).toEqual({ mode: "dark", density: "compact" })
    expect(v.theme("use0000001/btnIcon001/icoBglyph1")).toEqual({
      mode: "dark",
      density: "compact",
    })
  })
})

describe("theme along the expanded placement path (§10.4 rule 1, §9.8 rule 4)", () => {
  const d = doc(
    nodes({
      page000001: { type: "frame", parent: null, theme: { mode: "dark" } },
      card000001: { type: "frame", parent: null, component: true },
      inner00001: { type: "frame", parent: "card000001", theme: { density: "compact" } },
      slot000001: { type: "frame", parent: "inner00001", slot: {} },
      inst000001: {
        type: "instance",
        parent: "page000001",
        of: "card000001",
        overrides: {
          slot000001: { slot: true },
          inner00001: { set: { theme: { density: "comfortable", mode: "light" } } },
        },
      },
      inst000002: {
        type: "instance",
        parent: "page000001",
        of: "card000001",
        overrides: { slot000001: { slot: true } },
      },
      fill000001: { type: "rect", parent: "inst000001", at: "slot000001", w: 1, h: 1 },
      fill000002: { type: "rect", parent: "inst000002", at: "slot000001", w: 1, h: 1 },
    }),
    { themes: { mode: ["light", "dark"], density: ["comfortable", "compact"] } },
  )

  test("the document validates", () => {
    expect(validate(d).errors).toEqual([])
  })

  test("instances inherit from where they sit; pins in content reach slot content", () => {
    const v = view(d)
    expect(v.theme("inst000002")).toEqual({ mode: "dark", density: "comfortable" })
    expect(v.theme("fill000002")).toEqual({ mode: "dark", density: "compact" })
  })

  test("an override of a content node's pins applies to the slot content below it", () => {
    const v = view(d)
    expect(v.theme("fill000001")).toEqual({ mode: "light", density: "comfortable" })
  })
})

describe("library swaps are read in the consumer's namespace (§11)", () => {
  const lib = doc(
    nodes({
      Ico0000001: { type: "frame", parent: null, component: true, w: 10, h: 10 },
      Ico0000002: { type: "frame", parent: null, component: true, w: 20, h: 20 },
      Chip000001: {
        type: "frame",
        parent: null,
        component: { props: { icon: { type: "instance", target: "ChipIco001" } } },
      },
      ChipIco001: { type: "instance", parent: "Chip000001", of: "Ico0000001" },
      ChipAlt001: {
        type: "instance",
        parent: null,
        of: "Chip000001",
        component: true,
        args: { icon: "Ico0000002" },
      },
      ChipAlt002: {
        type: "instance",
        parent: null,
        of: "Chip000001",
        component: true,
        overrides: { ChipIco001: { set: { of: "Ico0000002" } } },
      },
    }),
    { meta: { library: true } },
  )
  const d = doc(
    nodes({
      mine000001: { type: "frame", parent: null, component: true, w: 33, h: 33 },
      a000000001: { type: "instance", parent: null, of: "ui:ChipAlt001" },
      b000000001: { type: "instance", parent: null, of: "ui:ChipAlt002" },
      c000000001: {
        type: "instance",
        parent: null,
        of: "ui:Chip000001",
        args: { icon: "mine000001" },
      },
      e000000001: {
        type: "instance",
        parent: null,
        of: "ui:Chip000001",
        overrides: { "ui:ChipIco001": { set: { of: "mine000001" } } },
      },
    }),
    { imports: { ui: "./ui.kimo" } },
  )
  const libraries = { ui: lib }

  test("the documents validate", () => {
    expect(validate(lib).errors).toEqual([])
    expect(validate(d, { libraries }).errors).toEqual([])
  })

  test("a swap written inside the library names a library component", () => {
    const v = view(d, libraries)
    expect(v.getNode("a000000001/ui:ChipIco001")?.w).toBe(20)
    expect(v.getNode("b000000001/ui:ChipIco001")?.w).toBe(20)
    expect(v.origin("b000000001/ui:ChipIco001")?.instance?.chain).toEqual(["ui:Ico0000002"])
  })

  test("a consumer swap of a library slot names a consumer component", () => {
    const v = view(d, libraries)
    expect(v.getNode("c000000001/ui:ChipIco001")?.w).toBe(33)
    expect(v.getNode("e000000001/ui:ChipIco001")?.w).toBe(33)
    expect(v.issues()).toEqual([])
  })
})

/** A component of `n` nodes (frames of 5) and `count` instances with args and overrides. */
function big(count: number, n: number, components = 1): KimoDocument {
  const table: Record<string, unknown> = {}
  for (let c = 0; c < components; c++) {
    const comp = `comp${String(c).padStart(6, "0")}`
    table[comp] = {
      type: "frame",
      parent: null,
      order: `a${c}`,
      component: {
        props: { t: { type: "text", target: `${comp.slice(0, 4)}n${c}00001`, field: "content" } },
      },
      layout: { dir: "column" },
    }
    let parent = comp
    for (let i = 1; i < n; i++) {
      const id = `${comp.slice(0, 4)}n${c}${String(i).padStart(5, "0")}`
      const frame = i % 6 === 0
      table[id] = frame
        ? { type: "frame", parent: comp, order: `a${i}`, layout: { dir: "row" } }
        : { type: "text", parent, order: `a${i}`, content: "x" }
      if (frame) parent = id
    }
  }
  for (let i = 0; i < count; i++) {
    const c = i % components
    table[`inst${String(i).padStart(6, "0")}`] = {
      type: "instance",
      parent: null,
      order: `b${i}`,
      of: `comp${String(c).padStart(6, "0")}`,
      args: { t: `v${i}` },
      overrides: { [`compn${c}00002`]: { set: { content: "o" } } },
    }
  }
  return doc(table)
}

const instancesOf = (d: KimoDocument) => Object.keys(d.nodes).filter((k) => k.startsWith("inst"))

describe("incremental re-expansion (main-component edits)", () => {
  test("only instances of the edited component re-expand; the rest stay cached", () => {
    const d = big(20, 12, 2)
    const nodesTable = d.nodes as Record<string, Record<string, unknown>>
    const v = view(d)
    for (const id of instancesOf(d)) walk(v, id)
    const before = v.instanceCount
    expect(before).toBe(20)
    const keep = v.getNode("inst000001/compn100001")
    // Edit a content node of comp000000 (instances 0, 2, 4, …).
    nodesTable.compn000003 = { ...nodesTable.compn000003, content: "edited" } as never
    v.invalidate(["compn000003"])
    for (const id of instancesOf(d)) walk(v, id)
    expect(v.instanceCount - before).toBe(10)
    expect(v.getNode("inst000000/compn000003")?.content).toBe("edited")
    expect(v.getNode("inst000001/compn100001")).toBe(keep as never)
  })

  test("over a live lookup: insert, slot content, delete and instance edits", () => {
    const d = doc(
      nodes({
        card000001: { type: "frame", parent: null, component: true },
        title00001: { type: "text", parent: "card000001", content: "T" },
        slot000001: { type: "frame", parent: "card000001", slot: {} },
        other00001: { type: "frame", parent: null, component: true },
        inst000001: {
          type: "instance",
          parent: null,
          of: "card000001",
          overrides: { slot000001: { slot: true } },
        },
        inst000002: { type: "instance", parent: null, of: "other00001" },
      }),
    )
    const table = d.nodes as Record<string, Record<string, unknown>>
    const live: NodeLookup = {
      getNode: (id) => documentLookup(d).getNode(id),
      children: (p, at) => documentLookup(d).children(p, at),
    }
    const v = createExpandedView(live, { header: () => d })
    walk(v, "inst000001")
    walk(v, "inst000002")
    const otherRoot = v.getNode("inst000002")
    const count = v.instanceCount

    // Slot content inserted (parent = the instance).
    table.fill000001 = { type: "rect", parent: "inst000001", at: "slot000001", order: "a0", w: 1 }
    v.invalidate(["fill000001"])
    expect(v.children("inst000001/slot000001")).toEqual(["fill000001"])
    expect(v.getNode("fill000001")?.parent).toBe("inst000001/slot000001")

    // A node added to the main.
    table.sub0000001 = { type: "text", parent: "card000001", order: "a9", content: "S" }
    v.invalidate(["sub0000001"])
    expect(v.children("inst000001")).toContain("inst000001/sub0000001")

    // An override edited on the instance.
    table.inst000001 = {
      ...table.inst000001,
      overrides: { slot000001: { slot: true }, title00001: { set: { content: "Over" } } },
    } as never
    v.invalidate(["inst000001"])
    expect(v.getNode("inst000001/title00001")?.content).toBe("Over")

    // A main node deleted.
    delete table.title00001
    v.invalidate(["title00001"])
    expect(v.children("inst000001")).not.toContain("inst000001/title00001")

    // inst000002 (another component) was never re-expanded.
    expect(v.getNode("inst000002")).toBe(otherRoot as never)
    // One re-expansion of inst000001 per invalidation.
    expect(v.instanceCount - count).toBe(4)
  })
})

describe("performance", () => {
  const median = (f: () => void, runs = 25) => {
    for (let i = 0; i < 10; i++) f()
    const ts: number[] = []
    for (let i = 0; i < runs; i++) {
      const t = performance.now()
      f()
      ts.push(performance.now() - t)
    }
    ts.sort((a, b) => a - b)
    return ts[Math.floor(runs / 2)] as number
  }

  test("expanding 200 instances of a 30-node component stays fast (target 10 ms)", () => {
    const d = big(200, 30)
    const lookup = documentLookup(d)
    const ids = instancesOf(d)
    let total = 0
    const ms = median(() => {
      const v = createExpandedView(lookup, { header: () => d })
      total = 0
      for (const id of ids) total += walk(v, id).length
    })
    expect(total).toBe(200 * 30)
    console.log(`expand 200×30 (${total} view nodes, read in full): median ${ms.toFixed(2)} ms`)
    // Target is 10 ms (≈4–6 ms on an idle M-series laptop). The assertion is a regression guard
    // with headroom for loaded CI machines; the perf gate (apps/web e2e:perf) holds the target.
    expect(ms).toBeLessThan(25)
  })

  test("re-expansion after a main edit redoes only that component's instances", () => {
    const d = big(200, 30, 4)
    const lookup = documentLookup(d)
    const ids = instancesOf(d)
    const v = createExpandedView(lookup, { header: () => d })
    for (const id of ids) walk(v, id)
    const ms = median(() => {
      v.invalidate(["compn000003"])
      for (const id of ids) walk(v, id)
    })
    console.log(`re-expand after a main edit (50 of 200 instances): median ${ms.toFixed(2)} ms`)
    expect(ms).toBeLessThan(10)
  })
})
