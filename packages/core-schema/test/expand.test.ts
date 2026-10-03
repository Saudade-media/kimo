import { describe, expect, test } from "bun:test"
import {
  createExpandedView,
  declaredProps,
  documentLookup,
  type KimoDocument,
  locate,
  parseVirtualId,
  resolveIdPath,
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

const button = {
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

const view = (d: KimoDocument, libraries = {}) =>
  createExpandedView(documentLookup(d), { libraries, header: () => d })

describe("expanded view: ids and precedence (spec §9)", () => {
  const d = doc(
    nodes({
      ...button,
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
  })

  test("precedence: props < args (root enum) ; args < overrides", () => {
    // `size` targets the component itself (ADR 0011): applies at the root after props.
    expect(v.getNode("ins0000001")?.opacity).toBe(0.5)
    const o = v.origin("ins0000001/lbl0000001")
    expect(o?.overrides.map((a) => `${a.layer}:${a.key}`)).toEqual([
      "args:text",
      "overrides:lbl0000001",
    ])
    expect(v.origin("ins0000001")?.overrides.map((a) => a.layer)).toEqual(["props", "args"])
  })

  test("component root pins merge under the instance's own pins (ADR 0011)", () => {
    expect(v.getNode("ins0000001")?.theme).toEqual({ mode: "dark" })
    expect(v.theme("ins0000001/lbl0000001")).toEqual({ mode: "dark" })
  })

  test("reverse mapping: composite id → top instance + override path", () => {
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

  test("the document validates (root prop target, order keys)", () => {
    expect(validate(d).errors).toEqual([])
  })
})

describe("slots, replace, nested and derived", () => {
  const d = doc(
    nodes({
      ...button,
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
  })

  test("a real node asked first still reads with its expanded parent", () => {
    const fresh = view(d)
    expect(fresh.getNode("s100000001")?.parent).toBe("inst000001/body000001")
  })

  test("outer overrides reach nested instances by path", () => {
    expect(v.getNode("inst000001/cta0000001/lbl0000001")?.content).toBe("Deep")
    expect(v.origin("inst000001/cta0000001")?.instance?.of).toBe("btn0000001")
    expect(v.locate("inst000001/cta0000001/lbl0000001")?.path).toBe("cta0000001/lbl0000001")
  })

  test("owned instances expand as their own top; derived layers sit below", () => {
    expect(v.getNode("s200000001/lbl0000001")?.content).toBe("Ghost")
    const o = v.origin("s200000001")
    expect(o?.instance?.chain).toEqual(["ghost00001", "btn0000001"])
    expect(v.origin("s200000001/lbl0000001")?.overrides[0]?.layer).toBe("derived")
  })

  test("override keys that match nothing are reported", () => {
    expect(v.issues("inst000001").map((i) => `${i.code}:${i.key}`)).toEqual([
      "OVERRIDE_PATH_UNRESOLVED:gone000001",
    ])
  })

  test("resolveIdPath crosses instance boundaries", () => {
    const c = locate({ doc: d }, "card000001")
    if (!("node" in c)) throw new Error("not found")
    const r = resolveIdPath({ doc: d }, c, "cta0000001/lbl0000001")
    expect(r.ok && r.target.id).toBe("lbl0000001")
    expect(r.ok && r.through.map((t) => t.id)).toEqual(["cta0000001"])
  })
})

describe("library content is rewritten into the consumer's namespace", () => {
  const d = loadFixture("valid/example-10-5.kimo")
  const v = view(d, { ui: uiLibrary() })

  test("10.5 example: library ids are alias-qualified path segments", () => {
    expect(v.children("D4cta00001").length).toBeGreaterThan(0)
    const label = v.children("D4cta00001").find((id) => id.endsWith("ui:BtnLabel01"))
    expect(label).toBe("D4cta00001/ui:BtnLabel01")
    expect(v.getNode(label as string)?.content).toBe("Get Kimo — $49/mo")
    expect(v.issues()).toEqual([])
  })

  test("slot content inside a library card; theme along the expanded path", () => {
    const slot = "E5card0001/ui:CardActns1"
    expect(v.children(slot)).toEqual(["F6btn00001"])
    expect(v.getNode("F6btn00001/ui:BtnLabel01")?.content).toBe("Learn more")
    expect(v.theme("F6btn00001")).toMatchObject({ mode: "dark", "ui:mode": "light" })
  })

  test("bindings inside library content point into the library", () => {
    const refs: string[] = []
    const walk = (id: string) => {
      const n = v.getNode(id) as Record<string, unknown>
      const s = JSON.stringify(n)
      for (const m of s.matchAll(/"\$ref":"([^"]+)"/g)) refs.push(m[1] as string)
      for (const c of v.children(id)) walk(c)
    }
    walk("E5card0001")
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.every((r) => r.startsWith("ui:"))).toBe(true)
  })
})

describe("missing components and cycles", () => {
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
})
