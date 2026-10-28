import { describe, expect, test } from "bun:test"
import { jsonEqual, type KimoDocument, serialize, validate } from "@kimo/core-schema"
import {
  bindUiToDocument,
  createDocStore,
  createEmptyDocument,
  createUiStore,
  DocumentInvalidError,
  exportDocument,
  importDocument,
  type NormalizedOp,
  type StoreChange,
  YjsDocStore,
} from "../src/index"
import { emptyStore, failed, fixture, frame, ok, rect, validFixtures } from "./helpers"

describe("import / export", () => {
  test("every valid fixture round-trips byte for byte, validates and replicates", () => {
    for (const [name, text] of validFixtures()) {
      const doc = JSON.parse(text) as KimoDocument
      const out = exportDocument(importDocument(doc))
      expect({ name, same: jsonEqual(out, doc) }).toEqual({ name, same: true })
      expect({ name, bytes: serialize(out) }).toEqual({ name, bytes: serialize(doc) })
      expect({ name, errors: validate(out).errors }).toEqual({ name, errors: [] })
      // A replica built only from the binary Yjs state reads the same bytes.
      const replica = new YjsDocStore()
      replica.applyUpdate(createDocStore(doc).encodeStateAsUpdate(), "remote:a")
      expect({ name, bytes: serialize(replica.toDocument()) }).toEqual({
        name,
        bytes: serialize(doc),
      })
    }
  })

  test("empty variables/themes objects survive the round trip", () => {
    const doc = { ...createEmptyDocument(), variables: {}, themes: {} }
    expect(jsonEqual(importDocument(doc).toDocument(), doc)).toBe(true)
  })

  test("toDocument returns fresh, mutable copies", () => {
    const store = importDocument(fixture("example-10-5.kimo"))
    const a = store.toDocument()
    ;(a.nodes.A1hero0001 as { name?: string }).name = "mutated"
    expect(store.getNode("A1hero0001")?.name).toBe("Hero")
    expect(Object.isFrozen(store.getNode("A1hero0001"))).toBe(true)
  })

  test("invalid documents are refused unless validation is off", () => {
    const bad = {
      ...createEmptyDocument(),
      nodes: { Abcdef0001: { type: "frame", parent: "Missing001", order: "a0" } },
    }
    expect(() => importDocument(bad as unknown as KimoDocument)).toThrow(DocumentInvalidError)
    const s = importDocument(bad as unknown as KimoDocument, { load: { validate: false } })
    expect(s.hasNode("Abcdef0001")).toBe(true)
  })

  test("newer formats are refused for editing", () => {
    const newer = { ...createEmptyDocument(), format: "1.1.0" } as KimoDocument
    expect(() => importDocument(newer)).toThrow(/FORMAT_NEWER/)
  })

  test("loadDocument diffs: unchanged nodes are not rewritten", () => {
    const doc = fixture("example-10-5.kimo")
    const store = importDocument(doc)
    const changes: StoreChange[] = []
    store.onChange((c) => changes.push(c))
    const next = structuredClone(doc)
    ;(next.nodes.B2title001 as { content: string }).content = "Changed"
    delete next.nodes.G7img00001
    store.loadDocument(next, { newEpoch: false })
    expect(changes.length).toBe(1)
    expect([...(changes[0] as StoreChange).nodes].sort()).toEqual(["B2title001", "G7img00001"])
    expect(jsonEqual(store.toDocument(), next)).toBe(true)
  })

  test("reloading an identical document emits no update", () => {
    const store = emptyStore()
    const updates: Uint8Array[] = []
    store.onUpdate((u) => updates.push(u))
    store.loadDocument(store.toDocument(), { origin: "file", newEpoch: false })
    expect(updates).toEqual([])
  })

  test("children are in sibling order and respect `at` groups", () => {
    const store = importDocument(fixture("example-10-5.kimo"))
    expect(store.children(null)).toEqual(["A1hero0001"])
    expect(store.children("A1hero0001")).toEqual([
      "B2title001",
      "C3row00001",
      "E5card0001",
      "G7img00001",
    ])
    expect(store.children("E5card0001")).toEqual([])
    expect(store.children("E5card0001", "ui:CardActns1")).toEqual(["F6btn00001"])
  })
})

describe("ops", () => {
  test("insert generates ids and appends in order", () => {
    const s = emptyStore()
    const r = ok(
      s.apply(
        [
          { op: "insert", id: "Root000001", node: frame("Root") },
          { op: "insert", node: rect("A"), parent: "Root000001" },
          { op: "insert", node: rect("B"), parent: "Root000001" },
          { op: "insert", node: rect("Front"), parent: "Root000001", index: 0 },
        ],
        { origin: "user" },
      ),
    )
    expect(r.created.length).toBe(4)
    expect(r.created[0]).toBe("Root000001")
    const names = s.children("Root000001").map((id) => s.getNode(id)?.name)
    expect(names).toEqual(["Front", "A", "B"])
    expect(r.ops.every((o) => o.op === "insert" && typeof o.node.order === "string")).toBe(true)
    expect(validate(s.toDocument()).ok).toBe(true)
  })

  test("update sets and unsets fields; tree keys are refused", () => {
    const s = emptyStore()
    ok(
      s.apply(
        { op: "insert", id: "Rect000001", node: rect("R", { opacity: 0.5 }) },
        { origin: "user" },
      ),
    )
    const r = ok(
      s.apply(
        { op: "update", id: "Rect000001", set: { name: "Renamed" }, unset: ["opacity"] },
        { origin: "user" },
      ),
    )
    expect(s.getNode("Rect000001")?.name).toBe("Renamed")
    expect(s.getNode("Rect000001")?.opacity).toBeUndefined()
    expect(r.inverse).toEqual([
      { op: "update", id: "Rect000001", set: { name: "R", opacity: 0.5 }, unset: [] },
    ])
    const bad = failed(
      s.apply({ op: "update", id: "Rect000001", set: { parent: null } }, { origin: "user" }),
    )
    expect(bad.errors[0]?.code).toBe("INVALID_OP")
    expect(
      failed(s.apply({ op: "update", id: "Nope000001", set: {} }, { origin: "user" })).errors[0]
        ?.code,
    ).toBe("NODE_NOT_FOUND")
  })

  test("schema violations are rejected atomically with the op path", () => {
    const s = emptyStore()
    const before = s.revision
    const r = failed(
      s.apply(
        [
          { op: "insert", id: "Good000001", node: rect("ok") },
          {
            op: "batch",
            ops: [{ op: "insert", id: "Bad0000001", node: rect("bad", { opacity: 7 }) }],
          },
        ],
        { origin: "user" },
      ),
    )
    expect(r.errors[0]?.code).toBe("SCHEMA_VIOLATION")
    expect(r.errors[0]?.nodeId).toBe("Bad0000001")
    expect(r.errors[0]?.path).toBe("ops[1].ops[0]")
    expect(s.hasNode("Good000001")).toBe(false)
    expect(s.revision).toEqual(before)
  })

  test("pre-existing errors do not block unrelated edits", () => {
    const bad = {
      ...createEmptyDocument(),
      nodes: {
        Orphan0001: { type: "rect", parent: "Missing001", order: "a0" },
        Frame00001: { type: "frame", parent: null, order: "a0" },
      },
    } as unknown as KimoDocument
    const s = importDocument(bad, { load: { validate: false } })
    ok(s.apply({ op: "update", id: "Frame00001", set: { name: "fine" } }, { origin: "user" }))
  })

  test("move rejects local cycles and re-keys ties", () => {
    const s = emptyStore()
    ok(
      s.apply(
        [
          { op: "insert", id: "Outer00001", node: frame("Outer") },
          { op: "insert", id: "Inner00001", node: frame("Inner"), parent: "Outer00001" },
        ],
        { origin: "user" },
      ),
    )
    const cyc = failed(
      s.apply({ op: "move", id: "Outer00001", parent: "Inner00001" }, { origin: "user" }),
    )
    expect(cyc.errors[0]?.code).toBe("CYCLE")
    const self = failed(
      s.apply({ op: "move", id: "Outer00001", parent: "Outer00001" }, { origin: "user" }),
    )
    expect(self.errors[0]?.code).toBe("CYCLE")

    // Two siblings with the same key (as after concurrent inserts); move a third between them.
    ok(
      s.apply(
        [
          { op: "insert", id: "TieA000001", node: rect("A"), parent: "Outer00001", order: "a5" },
          { op: "insert", id: "TieB000001", node: rect("B"), parent: "Outer00001", order: "a5" },
        ],
        { origin: "user" },
      ),
    )
    const before = s.children("Outer00001")
    expect(before).toEqual(["Inner00001", "TieA000001", "TieB000001"])
    const r = ok(
      s.apply({ op: "move", id: "Inner00001", parent: "Outer00001", index: 1 }, { origin: "user" }),
    )
    expect(s.children("Outer00001")).toEqual(["TieA000001", "Inner00001", "TieB000001"])
    expect(r.ops.length).toBe(2) // the move + one sibling re-key
  })

  test("delete removes the subtree; inverse re-inserts it", () => {
    const s = importDocument(fixture("example-10-5.kimo"))
    const snapshot = s.toDocument()
    const r = ok(s.apply({ op: "delete", id: "A1hero0001" }, { origin: "user" }))
    expect(r.deleted.length).toBe(7)
    expect(s.size).toBe(0)
    ok(s.apply(r.inverse as NormalizedOp[], { origin: "user" }))
    expect(jsonEqual(s.toDocument(), snapshot)).toBe(true)
  })

  test("inverse ops restore the exact previous document (mixed batch)", () => {
    const s = importDocument(fixture("example-10-5.kimo"))
    const before = s.toDocument()
    const r = ok(
      s.apply(
        [
          { op: "update", id: "B2title001", set: { content: "New" } },
          { op: "move", id: "G7img00001", parent: "C3row00001", index: 0 },
          { op: "insert", id: "Extra00001", node: rect("x"), parent: "A1hero0001", index: 0 },
          { op: "delete", id: "C3row00001" },
          { op: "setVariables", set: { "space-m": { type: "number", value: 20 } } },
        ],
        { origin: "agent:a1" },
      ),
    )
    ok(s.apply(r.inverse, { origin: "agent:a1" }))
    expect(jsonEqual(s.toDocument(), before)).toBe(true)
  })

  test("revisions, baseRevision and dry runs", () => {
    const s = emptyStore()
    const r0 = s.revision
    const dry = ok(
      s.apply(
        { op: "insert", id: "Dry0000001", node: rect("d") },
        { origin: "user", dryRun: true },
      ),
    )
    expect(dry.dryRun).toBe(true)
    expect(s.hasNode("Dry0000001")).toBe(false)
    expect(s.revision).toEqual(r0)
    const r1 = ok(
      s.apply(
        { op: "insert", id: "Real000001", node: rect("r") },
        { origin: "user", baseRevision: r0 },
      ),
    )
    expect(r1.before).toEqual(r0)
    expect(r1.revision.seq).toBe(r0.seq + 1)
    expect(r1.revision.epoch).toBe(r0.epoch)
    const stale = failed(
      s.apply({ op: "delete", id: "Real000001" }, { origin: "user", baseRevision: r0 }),
    )
    expect(stale.errors[0]?.code).toBe("REVISION_CONFLICT")
    const otherEpoch = failed(
      s.apply(
        { op: "delete", id: "Real000001" },
        { origin: "user", baseRevision: { epoch: "x", seq: r1.revision.seq } },
      ),
    )
    expect(otherEpoch.errors[0]?.code).toBe("REVISION_CONFLICT")
    s.loadDocument(s.toDocument())
    expect(s.revision.epoch).not.toBe(r0.epoch)
    expect(s.revision.seq).toBe(0)
  })

  test("read-only stores refuse ops", () => {
    const s = emptyStore()
    s.setReadOnly("newer format")
    const r = failed(s.apply({ op: "insert", node: rect("x") }, { origin: "user" }))
    expect(r.errors[0]).toMatchObject({ code: "READ_ONLY", message: "newer format" })
    s.setReadOnly(null)
    ok(s.apply({ op: "insert", node: rect("x") }, { origin: "user" }))
  })

  test("malformed op shapes from untyped JSON are INVALID_OP, never partial edits", () => {
    for (const validation of ["full", "none"] as const) {
      const s = emptyStore({ validation })
      ok(s.apply({ op: "insert", id: "Rect000001", node: rect("R", { x: 5 }) }, { origin: "user" }))
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed agent JSON
      const bad: any[] = [
        { op: "update", id: "Rect000001", unset: "fill x" },
        { op: "update", id: "Rect000001", unset: [1] },
        { op: "update", id: "Rect000001", set: "abc" },
        { op: "update", id: "Rect000001", set: [1] },
        { op: "move", id: "Rect000001", parent: null, index: "foo" },
        { op: "move", id: "Rect000001", parent: null, index: 0.5 },
        { op: "insert", node: rect("y"), index: "1" },
        { op: "setVariables", set: "abc" },
        { op: "setThemes", set: ["light"] },
        { op: "setThemes", unset: [null] },
      ]
      for (const op of bad) {
        const r = failed(s.apply(op, { origin: "user" }))
        expect({ op, code: r.errors[0]?.code }).toEqual({ op, code: "INVALID_OP" })
      }
      expect(s.getNode("Rect000001")?.x).toBe(5)
      expect(s.size).toBe(1)
    }
  })

  test("non-JSON values and bad ids are rejected", () => {
    const s = emptyStore()
    expect(
      failed(s.apply({ op: "insert", node: rect("x", { w: Number.NaN }) }, { origin: "user" }))
        .errors[0]?.code,
    ).toBe("INVALID_OP")
    expect(
      failed(s.apply({ op: "insert", id: "no/slash", node: rect("x") }, { origin: "user" }))
        .errors[0]?.code,
    ).toBe("INVALID_ID")
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid origin
    expect(failed(s.apply([], { origin: "remote" as any })).errors[0]?.code).toBe("INVALID_OP")
  })

  test("change events carry origin, cause and touched nodes", () => {
    const s = emptyStore()
    const seen: StoreChange[] = []
    s.onChange((c) => seen.push(c))
    ok(s.apply({ op: "insert", id: "Evt0000001", node: rect("e") }, { origin: "agent:x" }))
    expect(seen[0]?.origin).toBe("agent:x")
    expect(seen[0]?.cause).toBe("ops")
    expect([...(seen[0]?.nodes ?? [])]).toEqual(["Evt0000001"])
    s.undo("agent:x")
    expect(seen[1]?.cause).toBe("undo")
    expect(seen[1]?.origin).toBe("agent:x")
  })
})

describe("UI store", () => {
  test("selection and hover are separate from the document and pruned when a node is deleted", () => {
    const doc = emptyStore()
    const ui = createUiStore()
    const off = bindUiToDocument(ui, doc)
    ok(doc.apply({ op: "insert", id: "Keep000001", node: rect("k") }, { origin: "user" }))
    ok(doc.apply({ op: "insert", id: "Drop000001", node: rect("d") }, { origin: "user" }))
    const rev = doc.revision
    ui.getState().select(["Keep000001", "Drop000001"])
    ui.getState().setHovered("Drop000001")
    expect(doc.revision).toEqual(rev) // selection never touches the document
    ok(doc.apply({ op: "delete", id: "Drop000001" }, { origin: "user" }))
    expect(ui.getState().selection).toEqual(["Keep000001"])
    expect(ui.getState().hovered).toBeNull()
    off()
  })
})
