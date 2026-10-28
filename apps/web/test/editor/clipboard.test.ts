import { describe, expect, test } from "bun:test"
import { type KimoDocument, validate } from "@kimo/core-schema"
import { createDocStore, type DocStore } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"
import {
  buildPayload,
  decodePayload,
  encodePayload,
  KIMO_MIME,
  libraryAliasFor,
  pasteOps,
} from "../../src/editor/clipboard/payload"
import { ids, SCHEMA, setup } from "./doc-fixture"

const src = (store: DocStore, layout: LayoutResult | null, docId = "file-a") => ({
  doc: store.toDocument(),
  docId,
  page: null,
  getNode: (id: string) => store.getNode(id),
  children: (id: string | null, at?: string | null) => store.children(id, at),
  layout,
})

const target = (
  store: DocStore,
  docId?: string,
  libraryAlias?: (src: string, id: string) => string | null,
) => ({
  getNode: (id: string) => store.getNode(id),
  children: (id: string | null, at?: string | null) => store.children(id, at),
  header: store.toHeader(),
  doc: () => store.toDocument(),
  docId,
  libraryAlias,
})

describe("clipboard payload", () => {
  test("round-trips through the custom type and the text/html embedding; text/plain is the text", () => {
    const { store, layout } = setup()
    const p = buildPayload(src(store, layout), ["CardOne001"])
    expect(p?.roots).toEqual(["CardOne001"])
    expect(Object.keys(p?.nodes ?? {}).sort()).toEqual(["CardOne001", "CardTitle1"])
    expect(p?.variables).toEqual({ brand: { type: "color", value: "#2F6BFF" } })
    expect(p?.boxes.CardOne001).toEqual({ x: 20, y: 24, w: 136, h: 132 })
    const enc = encodePayload(p as never)
    expect(enc["text/plain"]).toBe("Starter")
    expect(decodePayload((t) => enc[t] ?? "")?.id).toBe(p?.id)
    // WebKit drops custom types: the html embedding alone is enough.
    expect(decodePayload((t) => (t === KIMO_MIME ? "" : (enc[t] ?? "")))?.id).toBe(p?.id)
    expect(decodePayload(() => "")).toBeNull()
  })
})

describe("paste", () => {
  test("into the selected frame: new ids, same offset nudged +16 off the identical original", () => {
    const { store, layout } = setup()
    const p = buildPayload(src(store, layout), ["CardOne001"]) as never
    const r = pasteOps(
      p,
      target(store),
      { mode: "smart", parent: "HeroFrame1", center: { x: 0, y: 0 } },
      ids,
    )
    expect(store.apply(r.ops, { origin: "user" }).ok).toBe(true)
    const copy = store.getNode(r.roots[0] as string)
    expect(copy?.parent).toBe("HeroFrame1")
    expect([copy?.x, copy?.y]).toEqual([36, 40])
    expect(store.children(r.roots[0] as string)).toHaveLength(1)
    expect(validate(store.toDocument()).ok).toBe(true)
  })

  test("at the pointer centres the block on it; in place keeps the source parent and x/y", () => {
    const { store, layout } = setup()
    const p = buildPayload(src(store, layout), ["CardOne001"]) as never
    const a = pasteOps(
      p,
      target(store),
      { mode: "smart", parent: null, center: { x: 1000, y: 1000 } },
      ids,
    )
    store.apply(a.ops, { origin: "user" })
    const at = store.getNode(a.roots[0] as string)
    expect([at?.parent, at?.x, at?.y]).toEqual([null, 932, 934])
    const b = pasteOps(
      p,
      target(store),
      { mode: "inPlace", parent: null, center: { x: 0, y: 0 } },
      ids,
    )
    store.apply(b.ops, { origin: "user" })
    const inPlace = store.getNode(b.roots[0] as string)
    expect([inPlace?.parent, inPlace?.x, inPlace?.y]).toEqual(["HeroFrame1", 20, 24])
  })

  test("into another file: the instance pastes detached (main missing) and the variable is added", () => {
    const a = setup()
    const p = buildPayload(src(a.store, a.layout), ["BtnInst001", "CardOne001"]) as never
    const other = createDocStore({ $schema: SCHEMA, format: "1.0.0", nodes: {} })
    const r = pasteOps(
      p,
      target(other),
      { mode: "smart", parent: null, center: { x: 0, y: 0 } },
      ids,
    )
    const applied = other.apply(r.ops, { origin: "user" })
    if (!applied.ok) throw new Error(JSON.stringify(applied.errors))
    expect(r.detached).toBe(1)
    const doc = other.toDocument()
    expect(Object.values(doc.nodes).some((x) => x.type === "instance")).toBe(false)
    expect(Object.values(doc.nodes).some((x) => x.type === "text" && x.content === "Buy")).toBe(
      true,
    )
    expect(doc.variables?.brand).toBeDefined()
    expect(validate(doc).ok).toBe(true)
    // Same file: the instance stays an instance of the main.
    const same = pasteOps(
      p,
      target(a.store),
      { mode: "smart", parent: null, center: { x: 0, y: 0 } },
      ids,
    )
    a.store.apply(same.ops, { origin: "user" })
    expect(same.detached).toBe(0)
    expect(a.store.getNode(same.roots[0] as string)?.of).toBe("BtnMain001")
  })
})

describe("paste of a component main", () => {
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
      src(s, layout({ Button0001: [10, 20, 80, 32], Plain00001: [200, 0, 10, 10] }), docId),
      roots,
    )

  test("same file: an instance of the main (children not copied)", () => {
    const s = createDocStore(doc())
    const p = payloadOf(s, "/w/ui.kimo", ["Button0001", "Plain00001"])
    const r = pasteOps(
      p as never,
      target(s, "/w/ui.kimo"),
      { mode: "smart", parent: null, center: { x: 500, y: 500 } },
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
      target(s, "/w/ui.kimo"),
      { mode: "inPlace", parent: null, center: { x: 0, y: 0 } },
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
      target(app, "/w/app.kimo", (s, id) =>
        libraryAliasFor("/w/app.kimo", header, libraries, s, id),
      ),
      { mode: "smart", parent: null, center: { x: 0, y: 0 } },
      ids,
    )
    expect(r.instanced).toBe(1)
    const applied = app.apply(r.ops, { origin: "user" })
    if (!applied.ok) throw new Error(JSON.stringify(applied.errors))
    expect(app.getNode(r.roots[0] as string)?.of).toBe("ui:Button0001")
  })
})
