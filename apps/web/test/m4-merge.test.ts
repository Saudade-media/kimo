/**
 * Board 18 (merge conflicts): rows and labels from the board-18 fixture, the ConflictSession over
 * a real DocStore (each pick = one undo step, take-all on open rows only, ⌘' navigation, Mark
 * resolved & save), the canvas marker positions, and diffOps reproducing core-schema's
 * reference results through store.apply.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  applyConflictSide,
  type KimoDocument,
  listConflicts,
  MERGE_FEATURE,
  mergeDocuments,
  parse,
  serialize,
} from "@kimo/core-schema"
import { createDocStore, type DocStore } from "@kimo/editor-state"
import {
  canvasConflictMarkers,
  createConflictSession,
  diffOps,
  estimateMarkerWidth,
  groupRows,
  isNextConflictKey,
  type MarkerLayout,
  markerLabel,
  moreLabel,
  sourceLine,
  stackMarkers,
} from "../src/conflicts"
import type { Toast } from "../src/platform/contract"

const FIXTURE = join(
  import.meta.dir,
  "../../../packages/core-schema/fixtures/lint/CONFLICT_OPEN--board-18.kimo",
)
// biome-ignore lint/suspicious/noExplicitAny: tests poke at JSON
type Loose = any

const board18 = () => parse(readFileSync(FIXTURE, "utf8"))

function setup(doc: KimoDocument = board18()) {
  const store = createDocStore()
  store.loadDocument(doc)
  const saves: string[] = []
  const toasts: Toast[] = []
  let ready = false
  const rejects: string[] = []
  const session = createConflictSession({
    store,
    fileName: "marketing.kimo",
    save: async () => {
      saves.push(serialize(store.toDocument()))
    },
    addToast: (t) => toasts.push(t),
    showMergeReady: (v = true) => {
      ready = v
    },
    gitMerging: async () => true,
    onReject: (m) => rejects.push(m),
  })
  return { store, session, saves, toasts, rejects, ready: () => ready }
}

const conflicts = (store: DocStore) =>
  (store.toHeader() as { conflicts?: Record<string, { applied: string; resolved?: boolean }> })
    .conflicts

describe("board 18 rows", () => {
  test("labels, layer order and resolved labels match the board", () => {
    const { session } = setup()
    const rows = session.rows()
    expect(
      rows.map((r) => [r.group, r.property, r.kindLabel, r.resolved, r.resolvedLabel]),
    ).toEqual([
      ["Hero", "fill", "both changed", false, null],
      ["Headline", "content", "both changed", false, null],
      ["CTA Row", "gap", "both changed", true, "kept ours · 12"],
      ["Button / Primary", "label", "both changed", true, "took theirs"],
      ["Footer › Legal", "node", "deleted vs edited", true, "took theirs · deleted"],
    ])
    const hero = rows[0]
    expect(hero?.ours).toEqual({
      side: "ours",
      caption: "ours",
      display: "#FFF4E8",
      swatch: "#FFF4E8",
      absent: false,
    })
    expect(hero?.theirs.display).toBe("#FFFFFF")
    expect(rows[1]?.ours.swatch).toBeNull()
    expect(rows[4]?.ours.display).toBe("Edited · 2 props")
    expect(rows[4]?.theirs.display).toBe("Deleted")
    expect(session.counts()).toEqual({ total: 5, open: 2, resolved: 3 })
    expect(sourceLine(session.info)).toBe("main ← feat/pricing-v2 · base 4e1a9c2")
  })

  test("move and variable rows", () => {
    const base = parse(
      serialize({
        $schema: "https://kimo.design/schema/kimo-0.1.json",
        format: "0.1.0",
        themes: { mode: ["light", "dark"] },
        variables: {
          brand: {
            type: "color",
            value: [
              { value: "#E8590C", when: { mode: "light" } },
              { value: "#FF8A3D", when: { mode: "dark" } },
            ],
          },
        },
        nodes: {
          Page000001: { type: "frame", parent: null, order: "a0", name: "Home" },
          Hero000001: { type: "frame", parent: "Page000001", order: "a0", name: "Hero" },
          CtaRow0001: { type: "frame", parent: "Hero000001", order: "a0", name: "CTA Row" },
          Footer0001: { type: "frame", parent: "Page000001", order: "a1", name: "Footer" },
          Button0001: { type: "rect", parent: "Page000001", order: "a2", w: 1, h: 1 },
        },
      } as unknown as KimoDocument),
    ) as Loose
    const ours = structuredClone(base)
    ours.nodes.Button0001.parent = "CtaRow0001"
    ours.variables.brand.value[0].value = "#D9480F"
    const theirs = structuredClone(base)
    theirs.nodes.Button0001.parent = "Footer0001"
    theirs.variables.brand.value[0].value = "#E8590D"
    const { doc } = mergeDocuments({ base, ours, theirs })
    const { session } = setup(doc)
    const rows = session.rows()
    expect(rows.map((r) => [r.group, r.property, r.kindLabel])).toEqual([
      ["Variables", "$brand · light", "both changed"],
      ["Rectangle", "parent", "moved twice"],
    ])
    expect(rows[1]?.ours.display).toBe("Hero › CTA Row")
    expect(rows[1]?.theirs.display).toBe("Footer")
    expect(rows[0]?.ours.swatch).toBe("#D9480F")
    expect(groupRows(rows).map((g) => g.key)).toEqual(["variables", "Button0001"])
  })
})

describe("ConflictSession over a DocStore", () => {
  test("a pick applies live, resolves the row, and is one undo step", () => {
    const { store, session } = setup()
    const before = serialize(store.toDocument())
    let notified = 0
    session.subscribe(() => notified++)
    session.choose("CfHeroFil1", "theirs")
    expect(store.getNode("Hero000001")?.fill).toBe("#FFFFFF")
    expect(conflicts(store)?.CfHeroFil1).toMatchObject({ applied: "theirs", resolved: true })
    expect(session.counts()).toEqual({ total: 5, open: 1, resolved: 4 })
    expect(notified).toBeGreaterThan(0)
    store.undo("user")
    expect(serialize(store.toDocument())).toBe(before)
    expect(session.counts().open).toBe(2)
  })

  test("re-picking a resolved node conflict restores the deleted subtree exactly", () => {
    const { store, session } = setup()
    expect(store.hasNode("Legal00001")).toBe(false)
    session.choose("CfLegal001", "ours")
    expect(store.getNode("Legal00001")).toMatchObject({ fill: "#F4F4F2", w: 640 })
    session.choose("CfLegal001", "theirs")
    expect(store.hasNode("Legal00001")).toBe(false)
  })

  test("Take all theirs applies to open rows only, in one undo step", () => {
    const { store, session } = setup()
    session.chooseAll("theirs")
    expect(store.getNode("Hero000001")?.fill).toBe("#FFFFFF")
    expect(store.getNode("Headline01")?.content).toBe("Plan less, ship more.")
    // Resolved rows keep their choice (CTA Row kept ours: gap 12).
    expect((store.getNode("CtaRow0001")?.layout as { gap: number } | undefined)?.gap).toBe(12)
    expect(session.counts().open).toBe(0)
    store.undo("user")
    expect(session.counts().open).toBe(2)
  })

  test("next / previous walk open rows in layer order and wrap", () => {
    const { session } = setup()
    expect(session.next()).toBe("CfHeroFil1")
    expect(session.next("CfHeroFil1")).toBe("CfHeadlin1")
    expect(session.next("CfHeadlin1")).toBe("CfHeroFil1")
    expect(session.previous("CfHeroFil1")).toBe("CfHeadlin1")
    expect(session.next("CfCtaGap01")).toBe("CfHeroFil1")
    const picked: string[] = []
    session.bindView({
      select: (id) => picked.push(`select ${id}`),
      reveal: (id) => picked.push(`reveal ${id}`),
    })
    session.focus("CfHeadlin1")
    expect(session.focused()).toBe("CfHeadlin1")
    expect(picked).toEqual(["select Headline01", "reveal Headline01"])
    session.chooseAll("ours")
    expect(session.next()).toBeNull()
  })

  test("Mark resolved & save: refused while open, then finishes, saves, toasts", async () => {
    const t = setup()
    await expect(t.session.markResolvedAndSave()).rejects.toThrow("still open")
    expect(t.saves).toHaveLength(0)
    t.session.chooseAll("ours")
    await t.session.markResolvedAndSave()
    expect(t.saves).toHaveLength(1)
    const saved = parse(t.saves[0] as string) as Loose
    expect(saved.conflicts).toBeUndefined()
    expect(saved.merge).toBeUndefined()
    expect(saved.features ?? []).not.toContain(MERGE_FEATURE)
    expect(t.toasts).toEqual([{ kind: "merge-saved", resolved: 5, fileName: "marketing.kimo" }])
    expect(t.ready()).toBe(true)
    // Finishing is itself one undo step.
    t.store.undo("user")
    expect(conflicts(t.store)).toBeDefined()
  })

  test("⌘' key matcher", () => {
    const k = (o: Partial<KeyboardEvent>) =>
      isNextConflictKey({ metaKey: false, ctrlKey: false, altKey: false, key: "", code: "", ...o })
    expect(k({ metaKey: true, code: "Quote", key: "'" })).toBe(true)
    expect(k({ ctrlKey: true, key: "'" })).toBe(true)
    expect(k({ key: "'" })).toBe(false)
  })
})

describe("canvas markers", () => {
  const layout: MarkerLayout = {
    nodes: new Map([
      ["Hero000001", { world: { x: 0, y: 68, w: 720, h: 366 }, visible: true }],
      ["Headline01", { world: { x: 40, y: 157, w: 472, h: 106 }, visible: true }],
    ]),
  }
  test("one pill per open node, 4px above its top-left; selected nodes get no outline", () => {
    const { session } = setup()
    const { markers: m, more } = canvasConflictMarkers(
      session.rows(),
      layout,
      { x: -56, y: -62, zoom: 1 },
      ["Hero000001"],
      () => 80,
    )
    expect(more).toEqual([])
    expect(m).toEqual([
      {
        nodeId: "Hero000001",
        conflictId: "CfHeroFil1",
        label: "Hero · fill",
        left: 56,
        top: 106,
        width: 80,
        outline: null,
        hidden: false,
      },
      {
        nodeId: "Headline01",
        conflictId: "CfHeadlin1",
        label: "Headline · content",
        left: 96,
        top: 195,
        width: 80,
        outline: { left: 96, top: 219, width: 472, height: 106 },
        hidden: false,
      },
    ])
  })
  test("zoom scales positions; several conflicts read 'N conflicts'", () => {
    const { session } = setup()
    const { markers: m } = canvasConflictMarkers(session.rows(), layout, { x: 0, y: 0, zoom: 2 })
    expect(m[1]?.outline).toEqual({ left: 80, top: 314, width: 944, height: 212 })
    const rows = session.rows()
    expect(markerLabel([rows[0], rows[1]] as never)).toBe("2 conflicts")
  })
})

describe("canvas pill stacking (board 20 T7TxIQ)", () => {
  const pill = (nodeId: string, left: number, top: number, width = 74) => ({
    nodeId,
    conflictId: `c-${nodeId}`,
    label: nodeId,
    left,
    top,
    width,
    outline: null,
    hidden: false,
  })

  test("two overlapping pills: the later one moves up by pill height + 4", () => {
    // Vignette: Pill A at (16, 76), Pill B default (28, 84) → stacked at (28, 52).
    const r = stackMarkers([pill("A", 16, 76), pill("B", 28, 84)])
    expect(r.markers.map((m) => [m.nodeId, m.left, m.top, m.hidden])).toEqual([
      ["A", 16, 76, false],
      ["B", 28, 52, false],
    ])
    expect(r.more).toEqual([])
  })

  test("three or more: the first pill plus a +N pill 4px to its right", () => {
    const r = stackMarkers([
      pill("C", 190, 76),
      pill("D", 200, 80),
      pill("E", 210, 84),
      pill("F", 600, 10),
    ])
    expect(r.markers.map((m) => [m.nodeId, m.hidden])).toEqual([
      ["C", false],
      ["D", true],
      ["E", true],
      ["F", false],
    ])
    expect(r.more).toHaveLength(1)
    expect(r.more[0]).toMatchObject({ label: "+2", left: 190 + 74 + 4, top: 76 })
    expect(r.more[0]?.hidden.map((m) => m.nodeId)).toEqual(["D", "E"])
    expect(moreLabel(5)).toBe("+5")
  })

  test("pills that do not touch keep their places", () => {
    const r = stackMarkers([pill("A", 0, 0), pill("B", 80, 0)])
    expect(r.markers.map((m) => m.top)).toEqual([0, 0])
  })

  test("estimateMarkerWidth hugs the content (ar36v / mvPXI paddings)", () => {
    expect(estimateMarkerWidth("", "default")).toBe(30)
    expect(estimateMarkerWidth("", "more")).toBe(16)
  })
})

describe("board 20 conflicts polish", () => {
  test("base values: the stored base, a node as name · size", () => {
    const { session } = setup()
    const rows = session.rows()
    expect(rows.find((r) => r.id === "CfHeroFil1")?.base).toMatchObject({
      display: "#FFF7EE",
      swatch: "#FFF7EE",
    })
    // Footer › Legal: the node exists at base (delete vs edit) → "Legal · 600×24"-style label.
    expect(rows.find((r) => r.id === "CfLegal001")?.base.display).toMatch(/^Legal · \d+×\d+$/)
  })

  test("Reopen marks a resolved conflict open again (one undo step), body unchanged", () => {
    const { store, session } = setup()
    const before = serialize(store.toDocument())
    const body = store.getNode("CtaRow0001")
    session.reopen("CfCtaGap01")
    expect(conflicts(store)?.CfCtaGap01?.resolved).toBeUndefined()
    expect(store.getNode("CtaRow0001")).toEqual(body)
    expect(session.counts()).toEqual({ total: 5, open: 3, resolved: 2 })
    store.undo("user")
    expect(serialize(store.toDocument())).toBe(before)
  })
})

describe("diffOps", () => {
  test("reproduces every reference side application through store.apply", () => {
    const doc = board18()
    for (const { id } of listConflicts(doc))
      for (const side of ["ours", "theirs", "base"] as const) {
        const store = createDocStore()
        store.loadDocument(doc)
        let target: KimoDocument
        try {
          target = applyConflictSide(store.toDocument(), id, side)
        } catch {
          continue
        }
        const r = store.apply(
          { op: "batch", ops: diffOps(store.toDocument(), target) },
          {
            origin: "user",
          },
        )
        expect(r.ok).toBe(true)
        expect(serialize(store.toDocument())).toBe(serialize(target))
      }
  })
})
