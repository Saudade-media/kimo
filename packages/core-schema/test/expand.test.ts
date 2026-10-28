/**
 * Instance expansion (spec §9, §9.8, §10.4, §11; ADR 0011): composite ids, precedence of props /
 * args / overrides, slots and replacements, nested and derived components, theme along the
 * placement path, library namespacing, budget and incremental re-expansion.
 */
import { describe, expect, test } from "bun:test"
import {
  createExpandedView,
  declaredProps,
  documentLookup,
  type KimoDocument,
  locate,
  type NodeLookup,
  parseVirtualId,
  validate,
  virtualId,
} from "../src/index"
import { doc, loadFixture, uiLibrary } from "./helpers"

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

/** A button whose enum prop targets the component root itself (ADR 0011). */
const rootEnumButton = {
  btn0000001: {
    type: "frame",
    parent: null,
    x: 500,
    component: {
      props: {
        text: { type: "text", target: "lbl0000001", field: "content", order: "a1" },
        showIcon: { type: "boolean", target: "ico0000001", field: "visible", order: "a0" },
        size: { type: "enum", target: "btn0000001", field: "opacity", options: { dim: 0.5 } },
      },
    },
    layout: { dir: "row", gap: 4 },
    theme: { mode: "dark" },
  },
  ico0000001: { type: "rect", parent: "btn0000001", w: 10, h: 10 },
  lbl0000001: { type: "text", parent: "btn0000001", content: "OK" },
}

const icons = {
  icoA000001: { type: "frame", parent: null, component: true, w: 16, h: 16, name: "Icon/A" },
  icoAglyph1: { type: "rect", parent: "icoA000001", w: 8, h: 8, fill: "#000000" },
  icoB000001: { type: "frame", parent: null, component: true, w: 24, h: 24, name: "Icon/B" },
  icoBglyph1: { type: "rect", parent: "icoB000001", w: 12, h: 12, fill: "#FF0000" },
}

/** A button with every prop kind: instance swap, text, boolean, root enum. */
const iconButton = {
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

describe("ids and precedence", () => {
  const d = doc(
    nodes({
      ...rootEnumButton,
      ins0000001: {
        type: "instance",
        parent: null,
        of: "btn0000001",
        x: 3,
        name: "Primary",
        props: { opacity: 0.9 },
        args: { text: "Go", size: "dim" },
        overrides: { lbl0000001: { set: { content: "Wins" } } },
      },
    }),
    { themes: { mode: ["light", "dark"] } },
  )
  const v = view(d)

  test("an instance reads as its component root with composite child ids", () => {
    expect(validate(d).errors).toEqual([])
    expect(v.getNode("ins0000001")).toMatchObject({
      type: "frame",
      x: 3,
      parent: null,
      name: "Primary",
    })
    expect(v.getNode("ins0000001")?.component).toBeUndefined()
    expect(v.children("ins0000001")).toEqual(["ins0000001/ico0000001", "ins0000001/lbl0000001"])
    expect(v.getNode("ins0000001/lbl0000001")).toMatchObject({
      parent: "ins0000001",
      content: "Wins",
    })
    expect(v.isVirtual("ins0000001/lbl0000001")).toBe(true)
    expect(v.isVirtual("ins0000001")).toBe(false)
    // The component root's own theme pin reaches its layers.
    expect(v.getNode("ins0000001")?.theme).toEqual({ mode: "dark" })
    expect(v.theme("ins0000001/lbl0000001")).toEqual({ mode: "dark" })
  })

  test("precedence: props < args (root enum) < overrides", () => {
    // `size` targets the component itself (ADR 0011): applies at the root after props.
    expect(v.getNode("ins0000001")?.opacity).toBe(0.5)
    const o = v.origin("ins0000001/lbl0000001")
    expect(o?.overrides.map((a) => `${a.layer}:${a.key}`)).toEqual([
      "args:text",
      "overrides:lbl0000001",
    ])
    expect(v.origin("ins0000001")?.overrides.map((a) => a.layer)).toEqual(["props", "args"])
  })

  test("reverse mapping: composite id to top instance + override path", () => {
    expect(v.locate("ins0000001/lbl0000001")).toEqual({
      real: "ins0000001",
      instance: "ins0000001",
      path: "lbl0000001",
    })
    expect(v.locate("ins0000001")).toEqual({ real: "ins0000001" })
    expect(v.locate("ins0000001/nope")).toBeNull()
    expect(parseVirtualId(virtualId("a1b2c3", "x1y2z3/q1w2e3"))).toEqual({
      instance: "a1b2c3",
      path: "x1y2z3/q1w2e3",
    })
  })

  test("declared props list in declaration order", () => {
    const c = locate({ doc: d }, "btn0000001")
    if (!("node" in c)) throw new Error("not found")
    expect(declaredProps({ doc: d }, c).map((p) => [p.name, p.path])).toEqual([
      ["size", ""],
      ["showIcon", "ico0000001"],
      ["text", "lbl0000001"],
    ])
  })
})

describe("args: text, boolean, enum at the root, instance swap; slot props take none", () => {
  const d = doc(
    nodes({
      ...icons,
      ...iconButton,
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

  test("each arg lands on its target with the args layer", () => {
    expect(validate(d).errors).toEqual([])
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

describe("slots and replacements", () => {
  const d = doc(
    nodes({
      ...rootEnumButton,
      card000001: { type: "frame", parent: null, component: true, layout: { dir: "column" } },
      title00001: { type: "text", parent: "card000001", content: "Title" },
      body000001: { type: "frame", parent: "card000001", slot: {}, layout: { dir: "column" } },
      ph00000001: { type: "rect", parent: "body000001", w: 1, h: 1 },
      cta0000001: { type: "instance", parent: "card000001", of: "btn0000001" },
      ghost00001: {
        type: "instance",
        parent: null,
        of: "btn0000001",
        component: true,
        overrides: { lbl0000001: { set: { content: "Ghost" } } },
      },
      inst000001: {
        type: "instance",
        parent: null,
        of: "card000001",
        overrides: {
          body000001: { slot: true },
          title00001: { replace: true },
          "cta0000001/lbl0000001": { set: { content: "Deep" } },
          gone000001: { set: { visible: false } },
        },
      },
      s100000001: { type: "rect", parent: "inst000001", at: "body000001", w: 4, h: 4 },
      s200000001: { type: "instance", parent: "inst000001", at: "body000001", of: "ghost00001" },
      rep0000001: { type: "rect", parent: "inst000001", at: "title00001", w: 7, h: 7 },
    }),
  )
  const v = view(d)

  test("slot content and replacements keep real ids and attach where they fill", () => {
    expect(v.children("inst000001")).toEqual([
      "rep0000001",
      "inst000001/body000001",
      "inst000001/cta0000001",
    ])
    expect(v.children("inst000001/body000001")).toEqual(["s100000001", "s200000001"])
    expect(v.getNode("s100000001")?.parent).toBe("inst000001/body000001")
    expect(v.origin("s100000001")?.owned).toEqual({
      instance: "inst000001",
      at: "body000001",
      mode: "slot",
    })
    expect(v.origin("rep0000001")?.owned?.mode).toBe("replace")
    expect(v.origin("inst000001/body000001")?.slot).toEqual({ overridden: true, empty: false })
    // Slot content that is itself an instance expands as its own top, derived layers below.
    expect(v.getNode("s200000001/lbl0000001")?.content).toBe("Ghost")
    expect(v.origin("s200000001")?.instance?.chain).toEqual(["ghost00001", "btn0000001"])
  })

  test("a real node asked first still reads with its expanded parent", () => {
    const fresh = view(d)
    expect(fresh.getNode("s100000001")?.parent).toBe("inst000001/body000001")
  })

  test("override keys that match nothing are reported", () => {
    expect(v.issues("inst000001").map((i) => `${i.code}:${i.key}`)).toEqual([
      "OVERRIDE_PATH_UNRESOLVED:gone000001",
    ])
  })

  test("an outer slot on a deep path wins over the nested instance's own replace", () => {
    const deep = doc(
      nodes({
        btn0000001: { type: "frame", parent: null, component: true },
        slotframe1: { type: "frame", parent: "btn0000001", slot: {} },
        card000001: { type: "frame", parent: null, component: true },
        nested0001: {
          type: "instance",
          parent: "card000001",
          of: "btn0000001",
          overrides: { slotframe1: { replace: true } },
        },
        innerrep01: { type: "text", parent: "nested0001", at: "slotframe1", content: "inner" },
        inst000001: {
          type: "instance",
          parent: null,
          of: "card000001",
          overrides: { "nested0001/slotframe1": { slot: true } },
        },
        outerslt01: {
          type: "text",
          parent: "inst000001",
          at: "nested0001/slotframe1",
          content: "outer",
        },
      }),
    )
    expect(validate(deep).errors).toEqual([])
    const dv = view(deep)
    const nested = "inst000001/nested0001"
    expect(dv.children(nested)).toEqual([`${nested}/slotframe1`])
    expect(dv.children(`${nested}/slotframe1`)).toEqual(["outerslt01"])
    expect(dv.issues("inst000001")).toEqual([])
  })
})

describe("overrides on nested instances", () => {
  const d = doc(
    nodes({
      ...icons,
      ...iconButton,
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

  test("an outer override of a deep path wins over the nested instance's own", () => {
    expect(validate(d).errors).toEqual([])
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

describe("derived components", () => {
  const d = doc(
    nodes({
      ...icons,
      ...iconButton,
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

  test("precedence: authored < derived (base first) < instance props < args", () => {
    expect(validate(d).errors).toEqual([])
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

describe("theme along the expanded placement path", () => {
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

  test("instances inherit from where they sit; pins in content reach slot content", () => {
    expect(validate(d).errors).toEqual([])
    const v = view(d)
    expect(v.theme("inst000002")).toEqual({ mode: "dark", density: "comfortable" })
    expect(v.theme("fill000002")).toEqual({ mode: "dark", density: "compact" })
  })

  test("an override of a content node's pins applies to the slot content below it", () => {
    const v = view(d)
    expect(v.theme("fill000001")).toEqual({ mode: "light", density: "comfortable" })
  })
})

describe("libraries", () => {
  test("library content is rewritten into the consumer's namespace", () => {
    const d = loadFixture("valid/example-10-5.kimo")
    const v = view(d, { ui: uiLibrary() })
    // Library ids are alias-qualified path segments.
    const label = v.children("D4cta00001").find((id) => id.endsWith("ui:BtnLabel01"))
    expect(label).toBe("D4cta00001/ui:BtnLabel01")
    expect(v.getNode(label as string)?.content).toContain("Get Kimo")
    expect(v.issues()).toEqual([])

    // Slot content inside a library card; theme along the expanded path.
    expect(v.children("E5card0001/ui:CardActns1")).toEqual(["F6btn00001"])
    expect(v.getNode("F6btn00001/ui:BtnLabel01")?.content).toBe("Learn more")
    expect(v.theme("F6btn00001")).toMatchObject({ mode: "dark", "ui:mode": "light" })

    // Bindings inside library content point into the library.
    const refs: string[] = []
    for (const id of walk(v, "E5card0001")) {
      for (const m of JSON.stringify(v.getNode(id)).matchAll(/"\$ref":"([^"]+)"/g))
        refs.push(m[1] as string)
    }
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.every((r) => r.startsWith("ui:"))).toBe(true)
  })

  describe("swaps are read in the consumer's namespace", () => {
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

    test("a swap written inside the library names a library component", () => {
      expect(validate(lib).errors).toEqual([])
      expect(validate(d, { libraries }).errors).toEqual([])
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
})

describe("missing components, cycles and the expansion budget", () => {
  test("placeholders keep the instance; issues name the cause", () => {
    const d = doc(
      nodes({
        a00000001x: { type: "instance", parent: null, of: "nothere01", props: { w: 30 } },
        loop000001: { type: "frame", parent: null, component: true },
        self000001: { type: "instance", parent: "loop000001", of: "loop000001" },
        lib0000001: { type: "instance", parent: null, of: "ui:Missing01" },
      }),
      { imports: { ui: "./x.kimo" } },
    )
    const v = view(d)
    expect(v.getNode("a00000001x")?.type).toBe("instance")
    expect(v.issues("a00000001x")[0]?.code).toBe("COMPONENT_MISSING")
    expect(v.issues("self000001/self000001")[0]?.code).toBe("INSTANCE_CYCLE")
    expect(v.issues("lib0000001")[0]?.code).toBe("LIBRARY_NOT_LOADED")
    expect(v.origin("lib0000001")?.instance?.resolved).toBe(false)
  })

  test("exponential fan-out is cut at the budget with INSTANCE_TOO_LARGE", () => {
    // Component i nests two instances of component i-1: the top expands to 2^17 nodes.
    const table: Record<string, unknown> = {}
    const N = 17
    for (let i = 0; i < N; i++) {
      const id = `comp${String(i).padStart(6, "0")}`
      table[id] = { type: "frame", parent: null, order: `a${i}`, component: true }
      if (i > 0)
        for (const k of [0, 1])
          table[`in${i}x${k}`.padEnd(10, "0")] = {
            type: "instance",
            parent: id,
            order: `a${k}`,
            of: `comp${String(i - 1).padStart(6, "0")}`,
          }
    }
    table.top0000001 = { type: "instance", parent: null, order: "b0", of: "comp000016" }
    const d = doc(table)
    expect(validate(d).errors).toEqual([])
    const v = view(d)
    expect(walk(v, "top0000001").length).toBeLessThan(60_000)
    expect(v.issues("top0000001").map((i) => i.code)).toContain("INSTANCE_TOO_LARGE")
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
