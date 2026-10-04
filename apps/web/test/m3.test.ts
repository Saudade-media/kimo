/**
 * M3 pure helpers: op routing for instances, layer kinds / override entries, drop resolution,
 * variable cells / colors / DTCG, library diff and aliases. The views come from
 * `@kimo/core-schema` `createExpandedView` over a plain document (the same view the editor uses).
 */
import { describe, expect, test } from "bun:test"
import {
  createExpandedView,
  documentLookup,
  type KimoDocument,
  SCHEMA_URL,
} from "@kimo/core-schema"
import { createDocStore } from "@kimo/editor-state"
import { resolveComponentDrop } from "../src/editor/m3/drop"
import { aliasFor, diffLibraries, parseLibrary, relativePath } from "../src/editor/m3/libraries"
import {
  groupByPath,
  isOverridden,
  layerKind,
  overrideEntries,
  replacedName,
  summaryText,
} from "../src/editor/m3/model"
import { needsRouting, routeOps } from "../src/editor/m3/route"
import { optionText, parseOption } from "../src/editor/m3/sections"
import {
  cellOf,
  colorText,
  cssColor,
  type Entry,
  entryStates,
  exportDtcg,
  hexToOklch,
  importDtcg,
  outsideSrgb,
  parseOklch,
  toHexApprox,
} from "../src/editor/m3/variables"

const doc = (nodes: Record<string, Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  ({ $schema: SCHEMA_URL, format: "1.0.0", nodes, ...extra }) as unknown as KimoDocument

const card = () =>
  doc({
    main000001: {
      type: "frame",
      name: "Card/Pricing",
      parent: null,
      order: "a0",
      component: true,
      fill: "#FFFFFF",
    },
    title00001: { type: "text", name: "Title", parent: "main000001", order: "a0", content: "Plan" },
    actions001: { type: "frame", name: "Actions", parent: "main000001", order: "a1", slot: {} },
    inst000001: {
      type: "instance",
      name: "Card · Pro",
      parent: null,
      order: "a1",
      of: "main000001",
      overrides: { actions001: { slot: true } },
    },
    owned00001: {
      type: "rect",
      name: "Button",
      parent: "inst000001",
      at: "actions001",
      order: "a0",
      w: 80,
      h: 28,
    },
  })

const viewOf = (d: KimoDocument) => createExpandedView(documentLookup(d), { header: () => d })
const realOf = (d: KimoDocument) => (id: string) =>
  (d.nodes as Record<string, Record<string, unknown>>)[id]

describe("routeOps", () => {
  test("plain ops pass through untouched", () => {
    const d = card()
    const ops = [{ op: "update" as const, id: "title00001", set: { content: "X" } }]
    expect(needsRouting(viewOf(d), realOf(d), ops)).toBe(false)
    const r = routeOps(viewOf(d), realOf(d), ops)
    expect(r.ok && r.ops).toEqual(ops)
  })

  test("an update of a composite id becomes an override set (merged)", () => {
    const d = card()
    const r = routeOps(viewOf(d), realOf(d), [
      { op: "update", id: "inst000001/title00001", set: { content: "Pro" } },
      { op: "update", id: "inst000001/title00001", set: { fill: "#000000" } },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.ops).toEqual([
      {
        op: "update",
        id: "inst000001",
        set: {
          overrides: {
            actions001: { slot: true },
            title00001: { set: { content: "Pro", fill: "#000000" } },
          },
        },
      },
    ])
  })

  test("unset on a composite id removes the field (and the entry when empty)", () => {
    const d = card()
    const inst = (d.nodes as Record<string, Record<string, unknown>>).inst000001 as Record<
      string,
      unknown
    >
    inst.overrides = {
      title00001: { set: { content: "Pro" } },
    }
    const r = routeOps(viewOf(d), realOf(d), [
      { op: "update", id: "inst000001/title00001", unset: ["content"] },
    ])
    expect(r.ok && r.ops).toEqual([{ op: "update", id: "inst000001", unset: ["overrides"] }])
  })

  test("instance root: placement stays on the node, visuals go to props", () => {
    const d = card()
    const r = routeOps(viewOf(d), realOf(d), [
      { op: "update", id: "inst000001", set: { x: 10, fill: "#111111", name: "Pro" } },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.ops).toEqual([
      { op: "update", id: "inst000001", set: { props: { fill: "#111111" } } },
      { op: "update", id: "inst000001", set: { x: 10, name: "Pro" } },
    ])
  })

  test("delete inside an instance hides it with a notice", () => {
    const d = card()
    const r = routeOps(viewOf(d), realOf(d), [{ op: "delete", id: "inst000001/title00001" }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.notices).toEqual([
      { code: "HIDDEN_INSTEAD", id: "inst000001/title00001", name: "Title" },
    ])
    const set = (r.ops[0] as unknown as { set: { overrides: Record<string, unknown> } }).set
    expect(set.overrides.title00001).toEqual({ set: { visible: false } })
  })

  test("insert into a composite slot frame → instance-owned content", () => {
    const d = card()
    const r = routeOps(viewOf(d), realOf(d), [
      { op: "insert", id: "new0000001", parent: "inst000001/actions001", node: { type: "rect" } },
    ])
    expect(r.ok && r.ops).toEqual([
      {
        op: "insert",
        id: "new0000001",
        parent: "inst000001",
        at: "actions001",
        node: { type: "rect" },
      },
    ])
  })

  test("refuses inserts into non-slot instance content and moves of instance content", () => {
    const d = card()
    expect(
      routeOps(viewOf(d), realOf(d), [
        { op: "insert", parent: "inst000001/title00001", node: { type: "rect" } },
      ]).ok,
    ).toBe(false)
    expect(
      routeOps(viewOf(d), realOf(d), [{ op: "move", id: "inst000001/title00001", parent: null }])
        .ok,
    ).toBe(false)
  })

  test("a set on a slot/replace override path is refused", () => {
    const d = card()
    const r = routeOps(viewOf(d), realOf(d), [
      { op: "update", id: "inst000001/actions001", set: { fill: "#000000" } },
    ])
    expect(r.ok).toBe(false)
  })

  test("routed ops apply to a real store (one transaction)", () => {
    const d = card()
    const store = createDocStore(d)
    const view = createExpandedView(store as never, { header: () => d })
    const r = routeOps(view, (id) => store.getNode(id), [
      { op: "update", id: "inst000001/title00001", set: { content: "Pro" } },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(store.apply(r.ops, { origin: "user" }).ok).toBe(true)
    expect(store.canUndo("user")).toBe(true)
  })
})

describe("model", () => {
  test("layer kinds from provenance", () => {
    const view = viewOf(card())
    expect(layerKind(view, "main000001")).toBe("component")
    expect(layerKind(view, "inst000001")).toBe("instance")
    expect(layerKind(view, "inst000001/actions001")).toBe("slot")
    expect(layerKind(view, "inst000001/title00001")).toBe(null)
    expect(isOverridden(view, "owned00001")).toBe(true)
  })

  test("a derived component (instance + component) is 'derived', not 'instance'", () => {
    const d = card()
    ;(d.nodes as Record<string, Record<string, unknown>>).inst000001 = {
      ...(d.nodes as Record<string, Record<string, unknown>>).inst000001,
      component: true,
    }
    expect(layerKind(viewOf(d), "inst000001")).toBe("derived")
  })

  test("a replacement row keeps the replaced layer's name", () => {
    const d = doc({
      main000001: { type: "frame", name: "Card", parent: null, order: "a0", component: true },
      price00001: { type: "text", name: "Price", parent: "main000001", order: "a0", content: "$" },
      inst000001: {
        type: "instance",
        parent: null,
        order: "a1",
        of: "main000001",
        overrides: { price00001: { replace: true } },
      },
      repl000001: {
        type: "text",
        name: "Price · Annual",
        parent: "inst000001",
        at: "price00001",
        order: "a0",
        content: "$$",
      },
    })
    const view = viewOf(d)
    expect(layerKind(view, "repl000001")).toBe("replaced")
    expect(replacedName(view, d, {}, "repl000001")).toBe("Price")
  })

  test("override entries and the summary breakdown", () => {
    const entries = overrideEntries(
      {
        props: { fill: "#2A1E14" },
        args: { label: "Start", showBadge: true },
        overrides: {
          actions001: { slot: true },
          price0001: { replace: true },
          t0000001: { set: { content: "x" } },
        },
      },
      (p) => p,
      () => 2,
      () => "Price · Annual",
    )
    expect(entries.map((e) => e.kind)).toEqual(["props", "args", "args", "slot", "replace", "set"])
    expect(entries.find((e) => e.kind === "slot")?.value).toBe("2 children")
    expect(summaryText(entries)).toBe("props 1 · args 2 · overrides 3")
  })

  test("asset groups come from name segments before the last /", () => {
    const g = groupByPath([
      { name: "Card/Pricing" },
      { name: "Card/Feature" },
      { name: "Logo" },
      { name: "Button/Primary" },
    ])
    expect(g.map(([k, l]) => [k, l.length])).toEqual([
      ["Button", 1],
      ["Card", 2],
      ["", 1],
    ])
  })

  test("enum option values round-trip", () => {
    expect(parseOption("8 16")).toEqual([8, 16])
    expect(parseOption("12")).toBe(12)
    expect(parseOption("auto")).toBe("auto")
    expect(optionText([8, 16])).toBe("8 16")
  })
})

describe("resolveComponentDrop", () => {
  test("slot, replace, alt, frame and page targets", () => {
    const view = viewOf(card())
    expect(
      resolveComponentDrop(view as never, ["inst000001/actions001", "inst000001"], false),
    ).toMatchObject({
      kind: "slot",
      instance: "inst000001",
      path: "actions001",
    })
    expect(
      resolveComponentDrop(view as never, ["inst000001/title00001", "inst000001"], false),
    ).toMatchObject({
      kind: "replace",
      path: "title00001",
      label: "Replace Title in Card · Pro",
    })
    expect(
      resolveComponentDrop(view as never, ["inst000001/title00001", "inst000001"], true),
    ).toMatchObject({
      kind: "frame",
      parent: null,
    })
    expect(resolveComponentDrop(view as never, ["title00001", "main000001"], false)).toMatchObject({
      kind: "frame",
      parent: "main000001",
    })
  })
})

describe("variables", () => {
  const themed: Entry[] = [
    { value: 16 },
    { value: 12, when: { density: "compact" } },
    { value: 16, when: { density: "comfortable" } },
    { value: 20, when: { mode: "dark", density: "comfortable" } },
  ]
  test("grid cells: single-axis entries, multi-axis ≡, empty", () => {
    expect(cellOf(themed, "density", "compact")).toEqual({
      kind: "value",
      value: 12,
      multi: false,
      entry: 1,
    })
    expect(cellOf(themed, "mode", "dark")).toEqual({
      kind: "value",
      value: 20,
      multi: true,
      entry: 3,
    })
    expect(cellOf(themed, "mode", "light")).toEqual({ kind: "empty" })
    expect(cellOf(5, "mode", "light")).toEqual({ kind: "empty" })
  })

  test("entry states under a preview theme (last match wins)", () => {
    expect(entryStates(themed, { mode: "light", density: "comfortable" })).toEqual([
      "used only if nothing matches",
      "",
      "wins in preview",
      "",
    ])
    expect(entryStates(themed, { mode: "dark", density: "comfortable" })[2]).toBe("shadowed")
  })

  test("colors keep their space; display helpers", () => {
    const ok = { space: "oklch", l: 0.7, c: 0.17, h: 45 }
    expect(cssColor(ok)).toBe("oklch(0.7 0.17 45)")
    expect(colorText(ok)).toBe("0.70 0.17 45")
    expect(colorText("#2a1e14")).toBe("2A1E14")
    expect(outsideSrgb({ space: "display-p3", r: 1, g: 0, b: 0 })).toBe(true)
    expect(outsideSrgb({ space: "display-p3", r: 0.5, g: 0.5, b: 0.5 })).toBe(false)
    expect(outsideSrgb({ space: "oklch", l: 0.7, c: 0.3, h: 145 })).toBe(true)
    expect(toHexApprox({ space: "oklch", l: 1, c: 0, h: 0 })).toBe("#FFFFFF")
    const back = hexToOklch("#E2683A")
    expect(back?.space).toBe("oklch")
    expect(toHexApprox(back)).toBe("#E2683A")
    expect(parseOklch("0.70 0.17 45")).toEqual({ space: "oklch", l: 0.7, c: 0.17, h: 45 })
  })

  test("DTCG export / import", () => {
    const out = exportDtcg({
      "surface/page": { type: "color", group: "color", value: "#FFF7EE" },
      "text/default": { type: "color", value: { $ref: "ink-900" } },
    })
    expect(out).toEqual({
      color: { surface: { page: { $type: "color", $value: "#FFF7EE" } } },
      text: { default: { $type: "color", $value: "{ink-900}" } },
    })
    expect(
      importDtcg({
        color: {
          $type: "color",
          accent: { $value: "#E2683A" },
          link: { $value: "{color.accent}" },
        },
      }),
    ).toEqual({
      "color/accent": { type: "color", value: "#E2683A" },
      "color/link": { type: "color", value: { $ref: "color/accent" } },
    })
  })
})

describe("libraries", () => {
  test("untrusted library text: invalid or newer documents are refused", () => {
    expect(() =>
      parseLibrary(
        JSON.stringify({
          $schema: SCHEMA_URL,
          format: "9.0.0",
          nodes: { x: { type: "bogus", parent: "y", order: 5 } },
        }),
      ),
    ).toThrow()
    expect(() =>
      parseLibrary(
        JSON.stringify({ $schema: SCHEMA_URL, format: "1.0.0", nodes: { x: { type: "bogus" } } }),
      ),
    ).toThrow()
    expect(
      parseLibrary(JSON.stringify({ $schema: SCHEMA_URL, format: "1.0.0", nodes: {} })).nodes,
    ).toEqual({})
  })

  test("aliases and paths", () => {
    expect(aliasFor("Kimo UI", [])).toBe("kimo-ui")
    expect(aliasFor("Kimo UI", ["kimo-ui"])).toBe("kimo-ui2")
    expect(aliasFor("123", [])).toBe("lib")
    expect(relativePath("My Lib.kimo")).toBe("./My%20Lib.kimo")
  })

  test("changed since last open: components and variables", () => {
    const before = doc(
      {
        btn0000001: {
          type: "frame",
          name: "Button",
          parent: null,
          order: "a0",
          component: true,
          fill: "#000000",
        },
        old0000001: { type: "frame", name: "Old", parent: null, order: "a1", component: true },
      },
      { variables: { ink: { type: "color", value: "#000000" } } },
    )
    const after = doc(
      {
        btn0000001: {
          type: "frame",
          name: "Button",
          parent: null,
          order: "a0",
          component: true,
          fill: "#111111",
        },
        new0000001: { type: "frame", name: "New", parent: null, order: "a1", component: true },
      },
      {
        variables: {
          ink: { type: "color", value: "#111111" },
          paper: { type: "color", value: "#FFFFFF" },
        },
      },
    )
    const d = diffLibraries(before, after)
    expect(d.map((c) => `${c.kind}:${c.name}:${c.change}`).sort()).toEqual([
      "component:Button:modified",
      "component:New:added",
      "component:Old:removed",
      "variable:ink:modified",
      "variable:paper:added",
    ])
  })
})

describe("layer tree revision (perf: fill / geometry edits inside a main keep the rows)", () => {
  test("sameRow ignores visual fields and changes with structure", async () => {
    const { sameRow } = await import("../src/editor/m3/controller")
    const base = card().nodes as Record<string, Record<string, unknown>>
    const title = base.title00001 as Record<string, unknown>
    const inst = base.inst000001 as Record<string, unknown>
    expect(sameRow(title, { ...title, fill: "#FF0000", w: 12, h: 30, x: 4, visible: false })).toBe(
      true,
    )
    expect(sameRow(title, { ...title, name: "Heading" })).toBe(false)
    expect(sameRow(title, { ...title, parent: "actions001" })).toBe(false)
    expect(sameRow(title, { ...title, order: "b0" })).toBe(false)
    expect(sameRow(inst, { ...inst, overrides: { title00001: { set: { content: "Max" } } } })).toBe(
      false,
    )
    expect(sameRow(inst, { ...inst, of: "other00001" })).toBe(false)
    // Re-read (not identical) but equal object fields keep the rows.
    expect(sameRow(inst, structuredClone(inst))).toBe(true)
    expect(sameRow(title, { ...title, at: null })).toBe(sameRow(title, { ...title }))
    expect(sameRow(undefined, title)).toBe(false)
    expect(sameRow(undefined, undefined)).toBe(true)
  })
})
