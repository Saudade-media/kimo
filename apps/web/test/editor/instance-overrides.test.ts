/**
 * Editing inside component instances: ops on composite ids become overrides, slots take content,
 * everything else is refused. The views come from `@kimo/core-schema` `createExpandedView` over a
 * plain document (the same view the editor uses).
 */
import { describe, expect, test } from "bun:test"
import {
  createExpandedView,
  documentLookup,
  type KimoDocument,
  SCHEMA_URL,
} from "@kimo/core-schema"
import { createDocStore, createUiStore } from "@kimo/editor-state"
import { addSlotProp, componentOfSelection } from "../../src/editor/m3/actions"
import { M3Controller } from "../../src/editor/m3/controller"
import { resolveComponentDrop } from "../../src/editor/m3/drop"
import { routeOps } from "../../src/editor/m3/route"

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

  test("insert into a composite slot frame becomes instance-owned content", () => {
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

  test("refuses inserts into non-slot instance content, moves of instance content, and sets on a slot path", () => {
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
    expect(
      routeOps(viewOf(d), realOf(d), [
        { op: "update", id: "inst000001/actions001", set: { fill: "#000000" } },
      ]).ok,
    ).toBe(false)
  })

  test("routed ops apply to a real store as one undo step", () => {
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

describe("dropping a component", () => {
  test("lands in a slot, replaces an instance's layer, or goes to a frame (option-drop always frames)", () => {
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

describe("component actions on the selection", () => {
  function slotDoc(): KimoDocument {
    return {
      $schema: SCHEMA_URL,
      format: "1.0.0",
      nodes: {
        Card000001: {
          type: "frame",
          parent: null,
          order: "a0",
          name: "Card",
          x: 0,
          y: 0,
          w: 200,
          h: 120,
          component: {},
        },
        Body000001: {
          type: "frame",
          parent: "Card000001",
          order: "a0",
          name: "Body",
          w: 100,
          h: 40,
        },
        Title00001: { type: "text", parent: "Card000001", order: "a1", content: "Title" },
        Inst000001: { type: "instance", parent: null, order: "a1", of: "Card000001", x: 300, y: 0 },
        Plain00001: { type: "rect", parent: null, order: "a2", x: 0, y: 300, w: 10, h: 10 },
      },
    } as unknown as KimoDocument
  }

  function controller(d: KimoDocument) {
    const store = createDocStore(d)
    const session = {
      id: "t",
      store,
      ui: createUiStore(),
      route: undefined,
      onReject: new Set(),
    } as never
    return { store, m3: new M3Controller(session, () => null) }
  }

  test("replace-with-selection resolves a main, or an instance's main, never the layer being replaced", () => {
    const { m3 } = controller(slotDoc())
    expect(componentOfSelection(m3, ["Card000001"], "Inst000001/Body000001")).toBe("Card000001")
    expect(componentOfSelection(m3, ["Inst000001"], "X/Y")).toBe("Card000001")
    expect(componentOfSelection(m3, ["Plain00001"], "X/Y")).toBeNull()
    expect(componentOfSelection(m3, ["Card000001", "Inst000001"], "X/Y")).toBeNull()
    expect(componentOfSelection(m3, ["Card000001"], "Card000001")).toBeNull()
  })

  test("adding a slot prop marks the frame a slot and declares the prop in one undo step", () => {
    const { store, m3 } = controller(slotDoc())
    expect(addSlotProp(m3, "Card000001", "Body000001", "body")).toBe(true)
    expect(store.getNode("Body000001")?.slot).toEqual({})
    const props = (store.getNode("Card000001")?.component as { props?: Record<string, unknown> })
      ?.props
    expect(props?.body).toMatchObject({ type: "slot", target: "Body000001" })
    store.undo("user")
    expect(store.getNode("Body000001")?.slot).toBeUndefined()
    expect(
      (store.getNode("Card000001")?.component as { props?: Record<string, unknown> })?.props?.body,
    ).toBeUndefined()
  })

  test("a taken prop name is refused and nothing changes", () => {
    const { store, m3 } = controller(slotDoc())
    expect(addSlotProp(m3, "Card000001", "Body000001", "body")).toBe(true)
    const before = store.toDocument()
    expect(addSlotProp(m3, "Card000001", "Body000001", "body")).toBe(false)
    expect(store.toDocument()).toEqual(before)
  })
})
