import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { validate } from "@kimo/core-schema"
import { createDocStore, createUiStore, type DocStore } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"
import {
  buildPayload,
  decodePayload,
  encodePayload,
  KIMO_MIME,
  pasteOps,
} from "../src/editor/clipboard/payload"
import {
  addAutoLayoutOps,
  canUngroup,
  duplicateNodesOps,
  groupNodesOps,
  removeAutoLayoutOps,
  repeatDelta,
  selectInverseIds,
  ungroupOps,
  wrapInFrameOps,
} from "../src/editor/clipboard/structure"
import { computeTreeDrop, treeDropOps } from "../src/editor/clipboard/tree-drop"
import { canvasMenuModel } from "../src/editor/context-menu"
import { withActivePage } from "../src/editor/pages/model"
import { fuzzyScore } from "../src/editor/pages/PageSwitcher"

const SCHEMA = "https://getkimo.design/schema/kimo-1.0.json"

/** A frame "Hero" (0,0 336×180) with two cards and a free text; a component "Btn" with an instance. */
function fixture(): KimoDocument {
  return {
    $schema: SCHEMA,
    format: "1.0.0",
    variables: { brand: { type: "color", value: "#2F6BFF" } },
    nodes: {
      HeroFrame1: {
        type: "frame",
        parent: null,
        order: "a0",
        name: "Hero",
        x: 0,
        y: 0,
        w: 336,
        h: 180,
      },
      CardOne001: {
        type: "frame",
        parent: "HeroFrame1",
        order: "a0",
        name: "Card",
        x: 20,
        y: 24,
        w: 136,
        h: 132,
        fill: { $ref: "brand" },
      },
      CardTitle1: { type: "text", parent: "CardOne001", order: "a0", content: "Starter" },
      BtnMain001: {
        type: "frame",
        parent: null,
        order: "a1",
        name: "Btn",
        x: 500,
        y: 0,
        w: 80,
        h: 32,
        component: true,
      },
      BtnLabel01: { type: "text", parent: "BtnMain001", order: "a0", content: "Buy" },
      BtnInst001: {
        type: "instance",
        parent: "HeroFrame1",
        order: "a1",
        of: "BtnMain001",
        x: 200,
        y: 40,
      },
      Row0000001: {
        type: "frame",
        parent: null,
        order: "a2",
        name: "Row",
        x: 0,
        y: 300,
        w: 196,
        h: 112,
        layout: { dir: "row", gap: 12, pad: 12 },
      },
      RowA000001: { type: "rect", parent: "Row0000001", order: "a0", w: 80, h: 88 },
      RowB000001: { type: "rect", parent: "Row0000001", order: "a1", w: 80, h: { mode: "fill" } },
    },
  }
}

/** A hand-made layout of the fixture (world boxes; frames have no rotation). */
function layoutOf(store: DocStore): LayoutResult {
  const boxes: Record<string, [number, number, number, number]> = {
    HeroFrame1: [0, 0, 336, 180],
    CardOne001: [20, 24, 136, 132],
    CardTitle1: [20, 24, 60, 20],
    BtnMain001: [500, 0, 80, 32],
    BtnLabel01: [500, 0, 30, 20],
    BtnInst001: [200, 40, 80, 32],
    Row0000001: [0, 300, 196, 112],
    RowA000001: [12, 312, 80, 88],
    RowB000001: [104, 312, 80, 88],
  }
  const nodes = new Map<string, unknown>()
  for (const [id, [x, y, w, h]] of Object.entries(boxes)) {
    if (!store.hasNode(id)) continue
    const p = store.getNode(id)?.parent
    const pb = typeof p === "string" ? boxes[p] : undefined
    const px = pb ? pb[0] : 0
    const py = pb ? pb[1] : 0
    nodes.set(id, {
      world: { x, y, w, h },
      local: { x: x - px, y: y - py, w, h },
      transform: [1, 0, 0, 1, x, y],
      visible: true,
    })
  }
  return { nodes } as unknown as LayoutResult
}

function setup(doc = fixture()) {
  const store = createDocStore(doc)
  return { store, layout: layoutOf(store) }
}

const src = (store: DocStore, layout: LayoutResult | null) => ({
  doc: store.toDocument(),
  docId: "file-a",
  page: null,
  getNode: (id: string) => store.getNode(id),
  children: (id: string | null, at?: string | null) => store.children(id, at),
  layout,
})

const target = (store: DocStore) => ({
  getNode: (id: string) => store.getNode(id),
  children: (id: string | null, at?: string | null) => store.children(id, at),
  header: store.toHeader(),
  doc: () => store.toDocument(),
})

let n = 0
const ids = () => `New${String(++n).padStart(7, "0")}`

describe("clipboard payload (board 27 §2 rules F1FPb)", () => {
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

  test("paste into the selected frame: new ids, same offset nudged +16 off the identical original", () => {
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

  test("paste at the pointer centres the block on it; in place keeps the source parent and x/y", () => {
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

  test("another file: the instance pastes detached (main missing) and the variable is added", () => {
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

describe("structure commands (board 27 §2 g1jiG notes)", () => {
  test("⌘D: free nodes +16/+16, flow children next sibling; a repeat after a move keeps the delta", () => {
    const { store } = setup()
    const r = duplicateNodesOps(store, ["CardOne001", "RowA000001"], undefined, ids)
    store.apply(r.ops, { origin: "user" })
    const [card, flow] = r.created
    expect([store.getNode(card as string)?.x, store.getNode(card as string)?.y]).toEqual([36, 40])
    expect(store.children("Row0000001").indexOf(flow as string)).toBe(1)
    store.apply({ op: "update", id: card as string, set: { x: 60, y: 24 } }, { origin: "user" })
    expect(
      repeatDelta(store, { pairs: [["CardOne001", card as string]] }, [card as string]),
    ).toEqual({
      x: 40,
      y: 0,
    })
    expect(repeatDelta(store, null, [card as string])).toEqual({ x: 16, y: 16 })
  })

  test("⌘G makes a real group; ⇧⌘G releases it keeping canvas positions", () => {
    const { store, layout } = setup()
    const ops = groupNodesOps(store, layout, ["CardOne001", "BtnInst001"], "GroupNode1")
    expect(store.apply(ops ?? [], { origin: "user" }).ok).toBe(true)
    const g = store.getNode("GroupNode1")
    expect(g?.type).toBe("group")
    expect(g?.w).toBeUndefined()
    expect([g?.x, g?.y]).toEqual([20, 24])
    expect(store.getNode("CardOne001")?.x).toBe(0)
    expect(canUngroup(store, "GroupNode1")).toBe(true)
    const l2 = layoutOf(store)
    ;(l2.nodes as Map<string, unknown>).set("GroupNode1", {
      world: { x: 20, y: 24, w: 260, h: 132 },
      local: { x: 20, y: 24, w: 260, h: 132 },
      transform: [1, 0, 0, 1, 20, 24],
      visible: true,
    })
    const u = ungroupOps(store, l2, ["GroupNode1"])
    expect(u?.freed.sort()).toEqual(["BtnInst001", "CardOne001"])
    expect(store.apply(u?.ops ?? [], { origin: "user" }).ok).toBe(true)
    expect(store.hasNode("GroupNode1")).toBe(false)
    expect(store.getNode("CardOne001")?.parent).toBe("HeroFrame1")
    expect(validate(store.toDocument()).ok).toBe(true)
  })

  test("⌥⌘G wraps in a frame at the first selected node's slot; mains and painted frames don't ungroup", () => {
    const { store, layout } = setup()
    const ops = wrapInFrameOps(store, layout, ["RowB000001"], "WrapFrame1")
    store.apply(ops ?? [], { origin: "user" })
    expect(store.children("Row0000001")).toEqual(["RowA000001", "WrapFrame1"])
    expect(store.getNode("WrapFrame1")?.type).toBe("frame")
    expect(canUngroup(store, "BtnMain001")).toBe(false)
    expect(canUngroup(store, "CardOne001")).toBe(false)
  })

  test("⌥⇧A freezes children at their x/y and keeps the frame size; ⇧A infers row, gap and padding", () => {
    const { store, layout } = setup()
    store.apply(removeAutoLayoutOps(store, layout, "Row0000001"), { origin: "user" })
    const row = store.getNode("Row0000001")
    expect(row?.layout).toBeUndefined()
    expect([store.getNode("RowA000001")?.x, store.getNode("RowA000001")?.y]).toEqual([12, 12])
    expect(store.getNode("RowB000001")?.h).toBe(88)
    store.apply(addAutoLayoutOps(store, layoutOf(store), "Row0000001"), { origin: "user" })
    expect(store.getNode("Row0000001")?.layout).toEqual({ dir: "row", gap: 12, pad: 12 })
  })

  test("⇧⌘A selects the unselected siblings", () => {
    const { store } = setup()
    expect(selectInverseIds(store, ["CardOne001"], [])).toEqual(["BtnInst001"])
  })

  test("the context menu follows board 27 when the structure state is given", () => {
    const { store } = setup()
    const m = canvasMenuModel({
      doc: store,
      selection: ["Row0000001"],
      live: new Set(),
      agent: false,
      structure: {
        canPaste: true,
        canGroup: true,
        canUngroup: false,
        layout: "remove",
        canCreateComponent: true,
      },
    })
    expect(m?.standard.map((r) => [r.label, r.meta])).toEqual([
      ["Copy", "⌘C"],
      ["Paste here", "⌘V"],
      ["Duplicate", "⌘D"],
    ])
    expect(m?.structure.map((g) => g.map((r) => (r.disabled ? `(${r.label})` : r.label)))).toEqual([
      ["Group selection", "(Ungroup)", "Wrap in frame"],
      ["Remove auto layout"],
      ["Create component", "Bring to front", "Send to back", "Lock"],
    ])
    expect(m?.danger.map((r) => r.label)).toEqual(["Delete"])
  })
})

describe("layer drag (board 27 §2 h0cqV3)", () => {
  const rows = [
    { id: "HeroFrame1", depth: 0, parent: null },
    { id: "CardOne001", depth: 1, parent: "HeroFrame1" },
    { id: "BtnInst001", depth: 1, parent: "HeroFrame1" },
    { id: "Row0000001", depth: 0, parent: null },
  ]
  const reader = (store: DocStore) => ({
    getNode: (id: string) => store.getNode(id),
    children: (p: string | null, at?: string | null) => store.children(p, at),
    isVirtual: (id: string) => id.includes("/"),
  })
  test("top quarter = between, middle half of a container = into, instances and descendants refuse", () => {
    const { store } = setup()
    const open = () => true
    const before = computeTreeDrop(rows, 2, 0.1, 1, ["RowA000001"], reader(store), open)
    expect(before).toMatchObject({ kind: "between", parent: "HeroFrame1", index: 1, slot: 2 })
    const into = computeTreeDrop(rows, 1, 0.5, 1, ["RowA000001"], reader(store), open)
    expect(into).toMatchObject({ kind: "into", target: "CardOne001" })
    const inst = computeTreeDrop(rows, 2, 0.5, 1, ["RowA000001"], reader(store), open)
    expect(inst).toMatchObject({ kind: "between" }) // an instance is no container: nearest gap
    const self = computeTreeDrop(rows, 1, 0.5, 1, ["HeroFrame1"], reader(store), open)
    expect(self).toMatchObject({ kind: "invalid", reason: "Can't drop a layer into itself" })
    // After the last child of an open group, the pointer's x picks the level.
    const up = computeTreeDrop(rows, 2, 0.9, 0, ["RowA000001"], reader(store), open)
    expect(up).toMatchObject({ kind: "between", parent: null, index: 1, depth: 0 })
  })
  test("dropping into a free frame keeps the canvas position (one undo step)", () => {
    const { store, layout } = setup()
    const drop = computeTreeDrop(rows, 0, 0.5, 0, ["RowA000001"], reader(store), () => true)
    const ops = treeDropOps(reader(store), ["RowA000001"], drop as never, {
      worldOf: (id) => layout.nodes.get(id)?.world ?? null,
      originOf: (p) => (p ? (layout.nodes.get(p)?.world ?? null) : { x: 0, y: 0 }),
    })
    expect(store.apply(ops, { origin: "user" }).ok).toBe(true)
    expect(store.getNode("RowA000001")?.parent).toBe("HeroFrame1")
    expect([store.getNode("RowA000001")?.x, store.getNode("RowA000001")?.y]).toEqual([12, 312])
  })
})

describe("pages in the editor (board 27 §1)", () => {
  test("new roots get the active page; moves into a container drop it", () => {
    const store = createDocStore({
      $schema: SCHEMA,
      format: "1.0.0",
      pages: { PageAaaaa1: { order: "a0", name: "A" }, PageBbbbb1: { order: "a1", name: "B" } },
      nodes: { Frame00001: { type: "frame", parent: null, order: "a0", page: "PageBbbbb1" } },
    })
    const ui = createUiStore({ page: "PageBbbbb1" })
    const ops = withActivePage(store, ui, [
      { op: "insert", id: "NewFrame01", parent: null, node: { type: "frame" } },
    ])
    expect((ops[0] as { node: { page?: string } }).node.page).toBe("PageBbbbb1")
    store.apply(ops, { origin: "user" })
    const moved = withActivePage(store, ui, [
      { op: "move", id: "NewFrame01", parent: "Frame00001" },
    ])
    store.apply(moved, { origin: "user" })
    expect(store.getNode("NewFrame01")?.page).toBeUndefined()
    expect(validate(store.toDocument()).warnings).toEqual([])
  })
  test("⌘P fuzzy match: substring first, then subsequence; no match is null", () => {
    expect(fuzzyScore("Pricing", "pr")).toBe(0)
    expect(fuzzyScore("Product tour", "pr")).toBe(0)
    expect(fuzzyScore("Components · Primitives", "pr")).toBe(13)
    expect(fuzzyScore("Docs", "pr")).toBeNull()
    expect(fuzzyScore("Pricing", "pcg")).toBeGreaterThan(100)
  })
  test("ui.setPage remembers each page's viewport and selection", () => {
    const ui = createUiStore()
    ui.getState().select(["a"])
    ui.getState().setViewport({ x: 10, zoom: 2 })
    expect(ui.getState().setPage("P2")).toBe(false)
    expect(ui.getState().selection).toEqual([])
    ui.getState().setViewport({ x: 99 })
    expect(ui.getState().setPage(null)).toBe(true)
    expect(ui.getState().selection).toEqual(["a"])
    expect(ui.getState().viewport).toMatchObject({ x: 10, zoom: 2 })
  })
})

describe("the built-in agent and pages (board 27 §1)", () => {
  test("top-level inserts, copies, moves and instances default to the active page", async () => {
    const { withPageDefaults, pageAwareToolHost } = await import("../src/editor/pages/agent")
    const ops = withPageDefaults(
      [
        { op: "insert", parent: "root", node: { type: "frame" } },
        { op: "insert", parent: "root", node: { type: "frame", page: "Other00001" } },
        { op: "insert", parent: "Frame00001", node: { type: "rect", w: 1, h: 1 } },
        { op: "copy", id: "Frame00001", parent: "root" },
        { op: "move", id: "Rect000001", parent: "root" },
        { op: "instantiate", of: "Btn0000001", parent: "root" },
      ],
      "PageB00001",
    ) as Record<string, unknown>[]
    expect(((ops[0] as Record<string, unknown>).node as { page?: string }).page).toBe("PageB00001")
    expect(((ops[1] as Record<string, unknown>).node as { page?: string }).page).toBe("Other00001")
    expect(((ops[2] as Record<string, unknown>).node as { page?: string }).page).toBeUndefined()
    expect(((ops[3] as Record<string, unknown>).set as { page?: string }).page).toBe("PageB00001")
    expect(ops[5]).toEqual({ op: "update", id: "Rect000001", set: { page: "PageB00001" } })
    expect(ops[6]?.key).toBe("kimo_page_1")
    expect(ops[7]).toEqual({ op: "update", id: "@kimo_page_1", set: { page: "PageB00001" } })
    const seen: unknown[] = []
    const host = pageAwareToolHost(
      {
        tools: () => [],
        call: async (c) => {
          seen.push(c.input)
          return {} as never
        },
      },
      () => "PageB00001",
    )
    await host.call(
      {
        id: "1",
        name: "kimo_apply_ops",
        input: { ops: [{ op: "insert", parent: "root", node: {} }] },
      },
      new AbortController().signal,
    )
    expect(seen[0]).toEqual({
      ops: [{ op: "insert", parent: "root", node: { page: "PageB00001" } }],
    })
  })
  test("a streamed call gets the same page defaults op by op (ADR 0013 §4.7)", async () => {
    const { withPageDefaults, pageAwareToolHost } = await import("../src/editor/pages/agent")
    const input = {
      docId: "d1",
      ops: [
        { op: "insert", parent: "root", node: { type: "frame" } },
        { op: "move", id: "Rect000001", parent: "root" },
        { op: "instantiate", of: "Btn0000001", parent: "root" },
        { op: "instantiate", of: "Btn0000001", parent: "root" },
      ],
    }
    const events: { kind: string; index?: number; value?: unknown }[] = []
    const host = pageAwareToolHost(
      {
        tools: () => [],
        call: async () => ({}) as never,
        stream: () => ({
          push: () => {},
          event: (e) => {
            events.push(e as never)
          },
          abort: () => {},
          onProgress: () => () => {},
        }),
      },
      () => "PageB00001",
    )
    const s = host.stream?.({ id: "c1", name: "kimo_apply_ops" })
    const json = JSON.stringify(input)
    for (let i = 0; i < json.length; i += 5) s?.push(json.slice(i, i + 5))
    const streamed = events.filter((e) => e.kind === "item")
    expect(streamed.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(streamed.map((e) => e.value)).toEqual(withPageDefaults(input.ops, "PageB00001"))
  })
  test("the system context names the active page", async () => {
    const { buildSystemPrompt } = await import("@kimo/ai-agent")
    const p = buildSystemPrompt({
      mode: "single",
      skills: [],
      page: { id: "PageB00001", name: "Checkout", count: 3 },
    })
    expect(p.volatile).toContain("Active page: Checkout (PageB00001), one of 3 pages")
    expect(p.volatile).toContain('set "page": "PageB00001" on top-level inserts')
  })
})
