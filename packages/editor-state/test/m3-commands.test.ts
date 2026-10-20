/**
 * M3 commands through a real store (ADR 0011): every command applies as ONE validated op
 * group, records an inverse that restores the previous document byte for byte, and is one undo
 * step (undo → previous bytes, redo → same bytes again). Refusals apply nothing.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  createExpandedView,
  type KimoDocument,
  type Libraries,
  parse,
  serialize,
  validate,
} from "@kimo/core-schema"
import {
  applyCommand,
  type CommandResult,
  type M3Command,
  type NormalizedOp,
  YjsDocStore,
} from "../src/index"
import { fixture, rng, VALID_FIXTURES } from "./helpers"

const HEADER = { $schema: "https://getkimo.design/schema/kimo-1.0.json", format: "1.0.0" }

const baseDoc = (): KimoDocument =>
  ({
    ...HEADER,
    themes: { mode: ["light", "dark"], density: ["comfortable", "compact"] },
    nodes: {
      page000001: { type: "frame", parent: null, order: "a0", name: "Page" },
      card000001: {
        type: "frame",
        parent: "page000001",
        order: "a0",
        name: "Card",
        layout: { dir: "column" },
      },
      title00001: { type: "text", parent: "card000001", order: "a0", content: "Plan name" },
      price00001: { type: "text", parent: "card000001", order: "a1", content: "$0" },
      actions001: { type: "frame", parent: "card000001", order: "a2", layout: { dir: "column" } },
      cta0000001: { type: "text", parent: "actions001", order: "a0", content: "Call to action" },
      other00001: { type: "rect", parent: "page000001", order: "a1", w: 10, h: 10 },
    },
  }) as unknown as KimoDocument

function storeOf(doc: KimoDocument, libraries: Libraries = {}): YjsDocStore {
  const s = new YjsDocStore({ random: rng(3), validateOptions: { libraries } })
  s.loadDocument(doc)
  return s
}

const bytes = (s: YjsDocStore) => serialize(s.toDocument())

/** Runs commands one by one, checking validation, inverse, undo and redo for each. */
class Runner {
  readonly store: YjsDocStore
  private seq = 0
  constructor(
    doc: KimoDocument,
    readonly libraries: Libraries = {},
  ) {
    this.store = storeOf(doc, libraries)
  }

  run(command: M3Command): Extract<CommandResult, { ok: true }> {
    const s = this.store
    const before = bytes(s)
    const r = applyCommand(s, command, {
      origin: "user",
      label: command.cmd,
      libraries: this.libraries,
      newId: () => `New${String(this.seq++).padStart(7, "0")}`,
    })
    if (!r.ok) throw new Error(`${command.cmd}: ${JSON.stringify(r, null, 1)}`)
    const after = bytes(s)
    const doc = s.toDocument()
    expect({
      cmd: command.cmd,
      errors: validate(doc, { libraries: this.libraries }).errors,
    }).toEqual({ cmd: command.cmd, errors: [] })
    expect({ cmd: command.cmd, changed: after !== before }).toEqual({
      cmd: command.cmd,
      changed: true,
    })
    // Serialized bytes parse back to the same bytes (every new field round-trips).
    expect(serialize(parse(after))).toBe(after)

    // The recorded inverse, applied to the result, restores the previous document.
    const inv = storeOf(doc, this.libraries)
    const ir = inv.apply(r.applied.inverse as NormalizedOp[], { origin: "user" })
    if (!ir.ok) throw new Error(`${command.cmd} inverse: ${JSON.stringify(ir.errors, null, 1)}`)
    expect({ cmd: command.cmd, inverse: bytes(inv) }).toEqual({ cmd: command.cmd, inverse: before })

    // One undo step: undo → before, redo → after (byte-identical).
    expect(s.undo("user").ok).toBe(true)
    expect({ cmd: command.cmd, undo: bytes(s) }).toEqual({ cmd: command.cmd, undo: before })
    expect(s.redo("user").ok).toBe(true)
    expect({ cmd: command.cmd, redo: bytes(s) }).toEqual({ cmd: command.cmd, redo: after })
    // The log holds exactly one group for the command, labelled.
    const last = s.log().at(-1) as { kind: string; label?: string }
    expect(last.kind).toBe("redo")
    return r
  }

  refuse(command: M3Command, code: string) {
    const before = bytes(this.store)
    const r = applyCommand(this.store, command, {
      origin: "user",
      libraries: this.libraries,
      newId: () => `Bad${String(this.seq++).padStart(7, "0")}`,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const got = "refused" in r ? r.refused.code : (r.rejected[0]?.code ?? "")
      expect({ cmd: command.cmd, code: got }).toEqual({ cmd: command.cmd, code })
    }
    expect(bytes(this.store)).toBe(before)
  }

  get doc(): KimoDocument {
    return this.store.toDocument()
  }
}

describe("component, instance, prop and slot commands (boards 11, 12, 13, 15)", () => {
  test("every command is one validated, invertible, undoable group", () => {
    const t = new Runner(baseDoc())
    t.run({ cmd: "createComponent", ids: ["card000001"] })
    t.run({ cmd: "createComponent", ids: ["other00001"] })
    t.run({
      cmd: "createComponent",
      ids: ["title00001", "price00001"],
      options: { wrap: { x: 0, y: 0, w: 100, h: 40, name: "Header" } },
    })
    // Undo that wrap through the store so the card keeps title/price as direct children.
    expect(t.store.undo("user").ok).toBe(true)
    t.run({ cmd: "setSlot", frame: "actions001", slot: { suggested: ["other00001"] } })
    t.run({
      cmd: "createInstance",
      of: "other00001",
      placement: { parent: "card000001", id: "icon000001" },
    })
    t.run({
      cmd: "declareProp",
      component: "card000001",
      name: "label",
      def: { type: "text", target: "title00001", field: "content" },
    })
    t.run({
      cmd: "declareProp",
      component: "card000001",
      name: "dim",
      def: { type: "enum", target: "card000001", field: "opacity", options: { half: 0.5 } },
    })
    t.run({
      cmd: "declareProp",
      component: "card000001",
      name: "actions",
      def: { type: "slot", target: "actions001" },
    })
    t.run({
      cmd: "declareProp",
      component: "card000001",
      name: "icon",
      def: { type: "instance", target: "icon000001" },
    })
    t.run({ cmd: "reorderProp", component: "card000001", name: "actions", before: "label" })
    t.run({ cmd: "updateProp", component: "card000001", name: "label", patch: { default: "Plan" } })
    t.run({ cmd: "setComponentDescription", component: "card000001", text: "Pricing tier card" })

    t.run({
      cmd: "createInstance",
      of: "card000001",
      placement: { parent: "page000001", id: "inst000001", x: 300 },
    })
    t.run({ cmd: "setArgs", instance: "inst000001", args: { label: "Pro", dim: "half" } })
    t.run({
      cmd: "setOverride",
      instance: "inst000001",
      path: "",
      change: { kind: "set", set: { fill: "#FFFFFF" } },
    })
    t.run({
      cmd: "setOverride",
      instance: "inst000001",
      path: "price00001",
      change: { kind: "replace", id: "rep0000001", node: { type: "text", content: "$49" } },
    })
    t.run({
      cmd: "setOverride",
      instance: "inst000001",
      path: "actions001",
      change: {
        kind: "slot",
        content: [{ id: "slot000001", node: { type: "text", content: "Buy" } }],
      },
    })
    // Drop an instance into the slot (board 13): slot content that is itself an instance.
    t.run({
      cmd: "createInstance",
      of: "other00001",
      placement: { parent: "inst000001", at: "actions001", id: "slotinst01" },
    })
    t.run({ cmd: "hideInInstance", instance: "inst000001", path: "icon000001" })
    t.run({
      cmd: "setOverride",
      instance: "inst000001",
      path: "title00001",
      change: { kind: "set", set: { theme: { mode: "dark" } } },
    })

    // The expanded view agrees with what the commands wrote.
    const d = t.doc
    const v = createExpandedView(t.store, { header: () => d })
    expect(v.getNode("inst000001")).toMatchObject({ fill: "#FFFFFF", opacity: 0.5, x: 300 })
    expect(v.getNode("inst000001/title00001")?.content).toBe("Pro")
    expect(v.getNode("inst000001/icon000001")?.visible).toBe(false)
    expect(v.children("inst000001/actions001")).toEqual(["slot000001", "slotinst01"])
    expect(v.theme("inst000001/title00001").mode).toBe("dark")

    t.run({ cmd: "updateProp", component: "card000001", name: "label", patch: { rename: "title" } })
    expect((t.doc.nodes.inst000001 as { args?: unknown }).args).toEqual({
      title: "Pro",
      dim: "half",
    })
    t.run({ cmd: "resetOverride", instance: "inst000001", path: "price00001" })
    t.run({ cmd: "resetOverride", instance: "inst000001", path: "", options: { fields: ["fill"] } })
    t.run({ cmd: "removeProp", component: "card000001", name: "dim" })

    // Second instance: swap, nested swap, then detach.
    t.run({
      cmd: "createInstance",
      of: "card000001",
      placement: { parent: null, id: "inst000002" },
    })
    t.run({
      cmd: "setOverride",
      instance: "inst000002",
      path: "title00001",
      change: { kind: "set", set: { content: "Team" } },
    })
    t.run({ cmd: "createComponent", ids: ["page000001"], options: { name: "Page main" } })
    t.refuse({ cmd: "swapInstance", instance: "inst000002", of: "nothing001" }, "NOT_FOUND")
    t.run({ cmd: "detachInstance", id: "inst000002" })

    t.refuse({ cmd: "setSlot", frame: "actions001", slot: null }, "IN_USE")
    t.run({ cmd: "setSlot", frame: "actions001", slot: null, deleteContent: true })
    t.run({ cmd: "resetAllOverrides", instance: "inst000001" })
    t.run({
      cmd: "createInstance",
      of: "other00001",
      placement: { parent: null, id: "inst000003" },
    })
    t.run({ cmd: "swapInstance", instance: "inst000003", of: "card000001" })
    t.run({ cmd: "setComponentDescription", component: "card000001", text: null })
  })

  test("refusals apply nothing", () => {
    const t = new Runner(baseDoc())
    t.refuse(
      { cmd: "createInstance", of: "card000001", placement: { parent: null } },
      "NOT_A_COMPONENT",
    )
    t.refuse({ cmd: "detachInstance", id: "card000001" }, "NOT_AN_INSTANCE")
    t.refuse({ cmd: "createComponent", ids: [] }, "INVALID")
    t.refuse({ cmd: "nope" } as unknown as M3Command, "INVALID")
  })
})

describe("variable, axis and theme-pin commands (board 14)", () => {
  test("every command is one validated, invertible, undoable group", () => {
    const t = new Runner(baseDoc())
    t.run({ cmd: "createVariable", name: "ink-900", variable: { type: "color", value: "#2A1E14" } })
    t.run({
      cmd: "createVariable",
      name: "surface/card",
      variable: { type: "color", value: "#FFFFFF" },
    })
    t.run({
      cmd: "setCell",
      name: "surface/card",
      axis: "mode",
      value: "dark",
      cell: { $ref: "ink-900" },
    })
    t.run({
      cmd: "setCell",
      name: "surface/card",
      axis: "density",
      value: "compact",
      cell: { space: "oklch", l: 0.9, c: 0.02, h: 80 },
    })
    t.run({
      cmd: "updateVariable",
      name: "surface/card",
      patch: { group: "color.surface", description: "Cards" },
    })
    t.run({
      cmd: "createVariable",
      name: "accent",
      variable: { type: "color", value: { space: "display-p3", r: 0.49, g: 0.23, b: 0.93 } },
    })
    t.run({ cmd: "setVariableValue", name: "accent", value: { $ref: "ink-900" } })
    t.refuse(
      { cmd: "updateVariable", name: "ink-900", patch: { value: { $ref: "accent" } } },
      "CYCLE",
    )
    t.run({ cmd: "detachAlias", name: "accent", entry: null })
    t.run({ cmd: "renameVariable", from: "ink-900", to: "ink/900" })
    t.run({ cmd: "duplicateVariable", from: "surface/card", to: "surface/card-2" })
    t.refuse({ cmd: "deleteVariable", name: "ink/900" }, "IN_USE")
    t.run({ cmd: "deleteVariable", name: "ink/900", detach: true })

    t.run({ cmd: "setThemePin", node: "page000001", axis: "mode", value: "dark" })
    t.run({ cmd: "renameAxisValue", axis: "mode", from: "dark", to: "night" })
    t.run({ cmd: "addAxisValue", axis: "mode", value: "dim" })
    t.run({ cmd: "moveAxisValue", axis: "mode", value: "dim", index: 0 })
    t.run({ cmd: "duplicateAxisValue", axis: "mode", from: "night", to: "night-hc" })
    t.refuse({ cmd: "removeAxisValue", axis: "mode", value: "night" }, "IN_USE")
    t.run({ cmd: "removeAxisValue", axis: "mode", value: "night", force: true })
    t.run({ cmd: "createAxis", axis: "brand", values: ["kimo", "acme"] })
    t.run({ cmd: "renameAxis", from: "brand", to: "brand-2" })
    t.run({ cmd: "setThemePin", node: "card000001", axis: "brand-2", value: "acme" })
    t.run({ cmd: "setThemePin", node: "card000001", axis: "brand-2", value: null })
    t.run({ cmd: "deleteAxis", axis: "density" })
    expect(t.doc.themes).toEqual({
      "brand-2": ["kimo", "acme"],
      mode: ["dim", "light", "night-hc"],
    })
    expect((t.doc.meta as Record<string, unknown>)["kimo.themes.order"]).toEqual([
      "mode",
      "brand-2",
    ])
  })
})

describe("library commands (boards 13, 15)", () => {
  const ui = (): KimoDocument =>
    parse(readFileSync(join(VALID_FIXTURES, "libs/kimo-ui.lib.kimo"), "utf8"))

  test("link, relink, insert a library instance, detach, unlink", () => {
    const libraries = { ui: ui() }
    const t = new Runner(fixture("example-10-5.kimo"), libraries)
    t.run({ cmd: "linkLibrary", alias: "mkt", path: "../brand/marketing.kimo" })
    t.run({ cmd: "relinkLibrary", alias: "mkt", path: "../brand/marketing-v2.kimo" })
    t.refuse({ cmd: "linkLibrary", alias: "mkt", path: "/abs.kimo" }, "INVALID")
    t.run({
      cmd: "createInstance",
      of: "ui:BtnGhost01",
      placement: { parent: "C3row00001", id: "ghost00001" },
    })
    t.run({ cmd: "setArgs", instance: "ghost00001", args: { label: "Docs" } })
    t.run({
      cmd: "createInstance",
      of: "ui:BtnPrimary",
      placement: { parent: "E5card0001", at: "ui:CardActns1", id: "slotbtn001" },
    })
    t.run({ cmd: "detachInstance", id: "D4cta00001" })
    t.run({ cmd: "unlinkLibrary", alias: "ui" })
    expect(serialize(t.doc)).not.toContain('"ui:')
  })

  test("unlink without the library (or a cached copy) is refused", () => {
    const t = new Runner(fixture("example-10-5.kimo"))
    t.refuse({ cmd: "unlinkLibrary", alias: "ui" }, "LIBRARY_NOT_LOADED")
  })
})

describe("round-trip of the M3 format additions", () => {
  test("components-m3.kimo loads into a store and serializes byte-identically", () => {
    const text = readFileSync(join(VALID_FIXTURES, "components-m3.kimo"), "utf8")
    const s = storeOf(parse(text))
    expect(serialize(s.toDocument())).toBe(text)
    // Through the CRDT: a replica fed only Yjs updates serializes the same bytes.
    const b = new YjsDocStore({ random: rng(9) })
    b.applyUpdate(s.encodeStateAsUpdate(), "remote:a")
    expect(serialize(b.toDocument())).toBe(text)
  })

  test("prop order, root targets, description and theme order survive edits and sync", () => {
    const t = new Runner(baseDoc())
    t.run({ cmd: "createComponent", ids: ["card000001"] })
    t.run({
      cmd: "declareProp",
      component: "card000001",
      name: "dim",
      def: { type: "enum", target: "card000001", field: "opacity", options: { half: 0.5 } },
    })
    t.run({ cmd: "setComponentDescription", component: "card000001", text: "Card" })
    t.run({ cmd: "createAxis", axis: "brand", values: ["kimo", "acme"] })
    const text = bytes(t.store)
    expect(text).toContain('"order":')
    expect(text).toContain('"target":"card000001"')
    expect(text).toContain('"kimo.component.description":"Card"')
    expect(text).toContain('"kimo.themes.order":')
    const b = new YjsDocStore({ random: rng(9) })
    b.applyUpdate(t.store.encodeStateAsUpdate(), "remote:a")
    expect(serialize(b.toDocument())).toBe(text)
    expect(serialize(parse(text))).toBe(text)
  })
})

describe("instance cycles are refused before the store sees them (§9.1)", () => {
  test("insert, swap, nested swap and instance-prop args", () => {
    const t = new Runner(baseDoc())
    t.run({ cmd: "createComponent", ids: ["card000001"] })
    t.run({ cmd: "createComponent", ids: ["other00001"] })
    t.run({
      cmd: "createInstance",
      of: "other00001",
      placement: { parent: "card000001", id: "icon000001" },
    })
    t.run({
      cmd: "declareProp",
      component: "card000001",
      name: "icon",
      def: { type: "instance", target: "icon000001" },
    })
    t.refuse(
      { cmd: "createInstance", of: "card000001", placement: { parent: "actions001" } },
      "CYCLE",
    )
    t.refuse({ cmd: "swapInstance", instance: "icon000001", of: "card000001" }, "CYCLE")
    // A derived component of the card, then an instance of it inside the card.
    t.run({
      cmd: "createInstance",
      of: "card000001",
      placement: { parent: null, id: "inst000001" },
    })
    t.run({ cmd: "createComponent", ids: ["inst000001"] })
    t.refuse(
      { cmd: "createInstance", of: "inst000001", placement: { parent: "title00001" } },
      "CYCLE",
    )
    t.run({
      cmd: "createInstance",
      of: "card000001",
      placement: { parent: null, id: "inst000002" },
    })
    t.refuse(
      { cmd: "setArgs", instance: "inst000002", args: { icon: "inst000002" } },
      "NOT_A_COMPONENT",
    )
    // A nested swap to a component enclosing the instance is a cycle too. A swap placing the
    // page main in a card is fine while the page holds no card instance (it holds the card
    // main itself, not an instance); once it does, the same swap would nest the card in
    // itself through the page (the expansion's INSTANCE_CYCLE), so it is refused.
    t.run({ cmd: "createComponent", ids: ["page000001"] })
    t.run({
      cmd: "setOverride",
      instance: "inst000002",
      path: "icon000001",
      change: { kind: "set", set: { of: "page000001" } },
    })
    t.refuse(
      { cmd: "createInstance", of: "card000001", placement: { parent: "page000001" } },
      "CYCLE",
    )
    t.run({
      cmd: "setOverride",
      instance: "inst000002",
      path: "icon000001",
      change: { kind: "set", set: { of: undefined } },
    })
    t.run({
      cmd: "createInstance",
      of: "card000001",
      placement: { parent: "page000001", id: "inst000003" },
    })
    t.refuse(
      {
        cmd: "setOverride",
        instance: "inst000002",
        path: "icon000001",
        change: { kind: "set", set: { of: "page000001" } },
      },
      "CYCLE",
    )
    t.refuse(
      {
        cmd: "setOverride",
        instance: "inst000003",
        path: "icon000001",
        change: { kind: "set", set: { of: "page000001" } },
      },
      "CYCLE",
    )
  })
})
