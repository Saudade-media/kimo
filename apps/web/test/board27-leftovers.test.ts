/**
 * Board 27 §8 Components (desing.pen d7gkR) / §2 Clipboard (AJmT8) leftovers:
 * - rule WYOjQ "Duplicate a main": ⌥-drag follows ⌘D (instance · new component · ask);
 * - copy/paste of a main pastes an instance (same file; `alias:id` across files when the target
 *   links the source as a library);
 * - rule Kpf1o: instances with broken overrides (layer-row warning dot), memoized.
 */
import { describe, expect, test } from "bun:test"
import { type KimoDocument, validate } from "@kimo/core-schema"
import { createDocStore, createUiStore, type DocStore } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"
import { buildPayload, libraryAliasFor, pasteOps } from "../src/editor/clipboard/payload"
import { altDragCloneOps } from "../src/editor/m3/component-actions"
import { M3Controller } from "../src/editor/m3/controller"

const SCHEMA = "https://kimo.design/schema/kimo-1.0.json"

function doc(): KimoDocument {
  return {
    $schema: SCHEMA,
    format: "1.0.0",
    nodes: {
      Button0001: {
        type: "frame",
        parent: null,
        order: "a0",
        name: "Button",
        x: 10,
        y: 20,
        w: 80,
        h: 32,
        component: { props: { label: { type: "text", target: "BtnLabel01", field: "content" } } },
      },
      BtnLabel01: { type: "text", parent: "Button0001", order: "a0", content: "Go" },
      Plain00001: { type: "rect", parent: null, order: "a1", x: 200, y: 0, w: 10, h: 10 },
    },
  } as unknown as KimoDocument
}

let n = 0
const ids = () => `Id${String(++n).padStart(8, "0")}`
const names = (s: DocStore) => () =>
  new Set(s.nodeIds().map((id) => String(s.getNode(id)?.name ?? "")))

describe("⌥-drag of a main (WYOjQ)", () => {
  test("no main selected: null (the plain clone applies)", () => {
    const s = createDocStore(doc())
    expect(altDragCloneOps(s, ["Plain00001"], "ask", names(s), ids)).toBeNull()
  })

  test("instance: an instance of the main on top of it (the drag moves it)", () => {
    const s = createDocStore(doc())
    const r = altDragCloneOps(s, ["Button0001"], "instance", names(s), ids)
    expect(r?.component).toBeUndefined()
    expect(s.apply(r?.ops ?? [], { origin: "user" }).ok).toBe(true)
    const copy = s.getNode(r?.pairs.get("Button0001") as string)
    expect([copy?.type, copy?.of, copy?.x, copy?.y]).toEqual(["instance", "Button0001", 10, 20])
  })

  test("component: “Button 2” with its own layers", () => {
    const s = createDocStore(doc())
    const r = altDragCloneOps(s, ["Button0001"], "component", names(s), ids)
    s.apply(r?.ops ?? [], { origin: "user" })
    const copy = s.getNode(r?.pairs.get("Button0001") as string)
    expect([copy?.name, copy?.x, copy?.y]).toEqual(["Button 2", 10, 20])
    expect(validate(s.toDocument()).errors).toEqual([])
  })

  test("ask: previews instances; the component answer reuses the same copy root ids", () => {
    const s = createDocStore(doc())
    const r = altDragCloneOps(s, ["Button0001", "Plain00001"], "ask", names(s), ids)
    expect(r?.main).toBe("Button0001")
    const root = r?.pairs.get("Button0001") as string
    const plain = r?.pairs.get("Plain00001") as string
    // A drag step on the copies, replayed on top of the "As a new component" clone.
    const move = [
      { op: "update", id: root, set: { x: 300, y: 300 } },
      { op: "update", id: plain, set: { x: 400 } },
    ] as const
    const a = createDocStore(doc())
    expect(a.apply([...(r?.ops ?? []), ...move], { origin: "user" }).ok).toBe(true)
    expect(a.getNode(root)?.type).toBe("instance")
    const b = createDocStore(doc())
    expect(b.apply([...(r?.component ?? []), ...move], { origin: "user" }).ok).toBe(true)
    const c = b.getNode(root) as Record<string, unknown>
    expect([c.type, c.name, c.x, c.y]).toEqual(["frame", "Button 2", 300, 300])
    const target = (c.component as { props: { label: { target: string } } }).props.label.target
    expect(b.getNode(target)?.parent).toBe(root)
    expect(b.getNode(plain)?.x).toBe(400)
    expect(validate(b.toDocument()).errors).toEqual([])
  })
})

const layout = (boxes: Record<string, [number, number, number, number]>) =>
  ({
    nodes: new Map(
      Object.entries(boxes).map(([id, [x, y, w, h]]) => [
        id,
        { world: { x, y, w, h }, local: { x, y, w, h }, visible: true },
      ]),
    ),
  }) as unknown as LayoutResult

const payloadOf = (s: DocStore, docId: string, roots: string[]) =>
  buildPayload(
    {
      doc: s.toDocument(),
      docId,
      page: null,
      getNode: (id) => s.getNode(id),
      children: (id, at) => s.children(id, at),
      layout: layout({ Button0001: [10, 20, 80, 32], Plain00001: [200, 0, 10, 10] }),
    },
    roots,
  )

const targetOf = (
  s: DocStore,
  docId: string,
  alias?: (src: string, id: string) => string | null,
) => ({
  getNode: (id: string) => s.getNode(id),
  children: (id: string | null, at?: string | null) => s.children(id, at),
  header: s.toHeader(),
  doc: () => s.toDocument(),
  docId,
  libraryAlias: alias,
})

describe("copy / paste of a main (§8 d · §2 F1FPb)", () => {
  test("same file: an instance of the main (children not copied)", () => {
    const s = createDocStore(doc())
    const p = payloadOf(s, "/w/ui.kimo", ["Button0001", "Plain00001"])
    const r = pasteOps(
      p as never,
      targetOf(s, "/w/ui.kimo"),
      {
        mode: "smart",
        parent: null,
        center: { x: 500, y: 500 },
      },
      ids,
    )
    expect(r.instanced).toBe(1)
    expect(s.apply(r.ops, { origin: "user" }).ok).toBe(true)
    const inst = s.getNode(r.roots[0] as string)
    expect([inst?.type, inst?.of]).toEqual(["instance", "Button0001"])
    expect(s.children(r.roots[0] as string)).toEqual([])
    expect(s.getNode(r.roots[1] as string)?.type).toBe("rect")
    expect(validate(s.toDocument()).errors).toEqual([])
  })

  test("same file after a cut (main gone): the main itself is pasted", () => {
    const s = createDocStore(doc())
    const p = payloadOf(s, "/w/ui.kimo", ["Button0001"])
    s.apply([{ op: "delete", id: "Button0001" }], { origin: "user" })
    const r = pasteOps(
      p as never,
      targetOf(s, "/w/ui.kimo"),
      {
        mode: "inPlace",
        parent: null,
        center: { x: 0, y: 0 },
      },
      ids,
    )
    expect(r.instanced).toBe(0)
    s.apply(r.ops, { origin: "user" })
    expect(s.getNode(r.roots[0] as string)?.component).toBeDefined()
  })

  test("another file linking the source as a library: an `alias:id` instance", () => {
    const lib = createDocStore(doc())
    const p = payloadOf(lib, "/w/lib/ui.kimo", ["Button0001"])
    const libraries = { ui: lib.toDocument() }
    const app = createDocStore(
      { $schema: SCHEMA, format: "1.0.0", imports: { ui: "./lib/ui.kimo" }, nodes: {} } as never,
      { validateOptions: { libraries } },
    )
    const header = app.toHeader()
    expect(libraryAliasFor("/w/app.kimo", header, libraries, "/w/lib/ui.kimo", "Button0001")).toBe(
      "ui",
    )
    expect(libraryAliasFor("/w/app.kimo", header, libraries, "/w/other.kimo", "Button0001")).toBe(
      null,
    )
    expect(libraryAliasFor("/w/app.kimo", header, libraries, "/w/lib/ui.kimo", "BtnLabel01")).toBe(
      null,
    )
    const r = pasteOps(
      p as never,
      targetOf(app, "/w/app.kimo", (src, id) =>
        libraryAliasFor("/w/app.kimo", header, libraries, src, id),
      ),
      { mode: "smart", parent: null, center: { x: 0, y: 0 } },
      ids,
    )
    expect(r.instanced).toBe(1)
    const applied = app.apply(r.ops, { origin: "user" })
    if (!applied.ok) throw new Error(JSON.stringify(applied.errors))
    expect(app.getNode(r.roots[0] as string)?.of).toBe("ui:Button0001")
  })

  test("another file without the library: existing behaviour (the main is pasted)", () => {
    const s = createDocStore(doc())
    const p = payloadOf(s, "/w/ui.kimo", ["Button0001"])
    const other = createDocStore({ $schema: SCHEMA, format: "1.0.0", nodes: {} })
    const r = pasteOps(
      p as never,
      targetOf(other, "/w/b.kimo", () => null),
      {
        mode: "smart",
        parent: null,
        center: { x: 0, y: 0 },
      },
      ids,
    )
    expect(r.instanced).toBe(0)
    other.apply(r.ops, { origin: "user" })
    expect(other.getNode(r.roots[0] as string)?.component).toBeDefined()
    expect(other.children(r.roots[0] as string)).toHaveLength(1)
  })
})

describe("broken overrides on layer rows (Kpf1o)", () => {
  const brokenDoc = () =>
    ({
      $schema: SCHEMA,
      format: "1.0.0",
      nodes: {
        ...doc().nodes,
        Inst000001: {
          type: "instance",
          parent: null,
          order: "a2",
          of: "Button0001",
          x: 0,
          y: 100,
          // Replace with selection's stash (unmatched overrides wait for review).
          meta: {
            "kimo.overrides.broken": [
              { key: "Gone000001", override: { set: { content: "x" } }, path: "Badge/Label" },
            ],
          },
        },
        Inst000002: { type: "instance", parent: null, order: "a3", of: "Button0001", x: 0, y: 200 },
      },
    }) as unknown as KimoDocument

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

  test("only instances holding broken overrides", () => {
    const { m3 } = controller(brokenDoc())
    expect([...m3.brokenInstances()]).toEqual(["Inst000001"])
  })

  test("memoized per tree revision: geometry edits keep the set, override edits recompute", () => {
    const { store, m3 } = controller(brokenDoc())
    const detach = m3.attach()
    const first = m3.brokenInstances()
    store.apply({ op: "update", id: "Inst000001", set: { x: 40 } }, { origin: "user" })
    expect(m3.brokenInstances()).toBe(first)
    store.apply({ op: "update", id: "Inst000001", unset: ["meta"] }, { origin: "user" })
    expect(m3.brokenInstances().size).toBe(0)
    detach()
  })
})
