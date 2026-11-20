import { describe, expect, test } from "bun:test"
import { jsonEqual, type KimoDocument, serialize, validate } from "@kimo/core-schema"
import {
  bindUiToDocument,
  COMMENT_ENTRY_SLOTS,
  type CommentRecord,
  CommentStore,
  createDocStore,
  createEmptyDocument,
  createUiStore,
  DocumentInvalidError,
  documentText,
  exportDocument,
  importDocument,
  type NormalizedOp,
  parseCommentRecordBody,
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
    const newer = { ...createEmptyDocument(), format: "1.2.0" } as KimoDocument
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

test("documentText writes what serialize(toDocument()) writes, without the copy", () => {
  for (const name of ["components-local.kimo", "themes-multi-axis.kimo", "pages.kimo"]) {
    const store = createDocStore(fixture(name), { jitter: 0 })
    store.apply(
      { op: "insert", id: "Added00001", node: { type: "rect", parent: null, w: 4, h: 4 } },
      { origin: "user" },
    )
    expect(documentText(store)).toBe(serialize(store.toDocument()))
    // A prepared header is written; the view it gets reads every node.
    const assets = { "0123456789abcdef.png": { mime: "image/png", bytes: 3 } }
    let seen = 0
    const prepare = (d: KimoDocument) => {
      seen = Object.keys(d.nodes).length
      return { ...d, assets } as KimoDocument
    }
    expect(documentText(store, prepare)).toBe(serialize(prepare(store.toDocument())))
    expect(seen).toBe(store.nodeIds().length)
  }
})

describe("comments (docs/spec/comments.md)", () => {
  const ana = { id: "dev:ana", name: "Ana", kind: "person" } as const
  const bo = { id: "acct:bo", name: "Bo", kind: "person" } as const
  const base = () => {
    const s = new YjsDocStore()
    s.loadDocument({
      ...createEmptyDocument(),
      nodes: { Frame00001: { type: "frame", parent: null, order: "a0", w: 100, h: 100 } },
    } as KimoDocument)
    return s
  }

  test("a thread makes the file 1.1, deleting it returns to 1.0, and undo never touches it", () => {
    const s = base()
    const { threadId } = s.comments.createThread(
      {
        anchor: { node: "Frame00001", x: 1, y: 2, fallback: { x: 1, y: 2 } },
        message: { author: ana, text: "Hi" },
      },
      "user",
    )
    const doc = s.toDocument() as unknown as Record<string, unknown>
    expect(doc.format).toBe("1.1.0")
    expect(doc.features).toEqual(["doc/comments"])
    expect(validate(doc).errors).toEqual([])
    expect(s.undo("user").ok).toBe(false)
    expect(s.comments.thread(threadId)).toBeDefined()
    s.comments.deleteThread(threadId, ana.id, "user")
    const after = s.toDocument() as unknown as Record<string, unknown>
    expect(after.format).toBe("1.0.0")
    expect(after.comments).toBeUndefined()
    expect(after.features).toBeUndefined()
  })

  test("a file with comments round-trips byte for byte, and the design header stays 1.0", () => {
    const s = base()
    const { threadId } = s.comments.createThread(
      { anchor: { x: 5, y: 5 }, message: { author: ana, text: "**Bold** @[Bo](acct:bo)" } },
      "user",
    )
    s.comments.reply(threadId, { author: bo, text: "Reply" }, "user")
    s.comments.toggleReaction(
      threadId,
      s.comments.thread(threadId)?.first as string,
      "👍",
      bo.id,
      "user",
    )
    const text = serialize(s.toDocument())
    const t = new YjsDocStore()
    t.loadDocument(JSON.parse(text))
    expect(serialize(t.toDocument())).toBe(text)
    // A peer that only receives the design document never sees format 1.1.
    const designOnly = new YjsDocStore()
    designOnly.applyUpdate(t.encodeStateAsUpdate(), "remote:a")
    expect((designOnly.toDocument() as unknown as Record<string, unknown>).format).toBe("1.0.0")
  })

  test("authors edit and delete their own messages only", () => {
    const s = base()
    const { threadId } = s.comments.createThread(
      { anchor: { x: 0, y: 0 }, message: { author: ana, text: "Hi" } },
      "user",
    )
    const reply = s.comments.reply(threadId, { author: bo, text: "Yo" }, "user")
    expect(() => s.comments.editMessage(threadId, reply, "Changed", ana.id, "user")).toThrow(
      /author/,
    )
    expect(() => s.comments.deleteMessage(threadId, reply, ana.id, "user")).toThrow(/author/)
    expect(s.comments.deleteMessage(threadId, reply, ana.id, "user", { moderator: true })).toBe(
      "message",
    )
  })

  // A relay stand-in: orders appended changes into entries (spec §4.3 positions).
  const relay = () => {
    let seq = 0
    const log: CommentRecord[] = []
    const clients: CommentStore[] = []
    const outbox = new Map<CommentStore, CommentRecord[]>()
    const join = (key: string, opts: { root?: string; moderator?: boolean } = {}) => {
      const c = new CommentStore()
      c.enterRoom({ key, root: opts.root ?? "ROOT", moderator: opts.moderator ?? false }, log)
      outbox.set(c, [])
      c.onRecord((r) => outbox.get(c)?.push(r))
      clients.push(c)
      return c
    }
    /** Appends raw records (any key: a modified client) as one entry and fans it out. */
    const append = (records: CommentRecord[], from?: CommentStore) => {
      if (records.length === 0) return
      seq++
      const placed = records.map((r, i) => ({ ...r, pos: seq * COMMENT_ENTRY_SLOTS + i }))
      log.push(...placed)
      for (const c of clients) if (c !== from) c.receive(placed)
      for (const p of placed) from?.acknowledge(p.body.id, p.pos)
    }
    const flush = (c: CommentStore) => {
      const out = outbox.get(c) ?? []
      outbox.set(c, [])
      append(out, c)
    }
    return { join, append, flush, log }
  }
  const forged = (key: string, body: Record<string, unknown>, base = 0): CommentRecord => ({
    key,
    pos: null,
    body: {
      v: 1,
      id: Math.random().toString(36).slice(2, 12),
      n: 1,
      base,
      at: "2026-11-19T10:00:00.000Z",
      ...body,
    } as unknown as CommentRecord["body"],
  })

  test("concurrent replies, edits and reactions converge in a room", () => {
    const r = relay()
    const a = r.join("KA")
    const b = r.join("KB")
    const anaA = { id: "dev:KA", name: "Ana", kind: "person" } as const
    const { threadId, messageId } = a.createThread(
      { anchor: { x: 0, y: 0 }, message: { author: anaA, text: "Hello world" } },
      "user",
    )
    r.flush(a)
    a.reply(threadId, { author: anaA, text: "From A" }, "user")
    b.reply(threadId, { author: bo, text: "From B" }, "user")
    a.editMessage(threadId, messageId, "Hello brave world", anaA.id, "user")
    a.toggleReaction(threadId, messageId, "🎉", anaA.id, "user")
    b.toggleReaction(threadId, messageId, "🎉", bo.id, "user")
    a.setResolved(threadId, anaA, "user")
    b.setResolved(threadId, null, "user")
    r.flush(b)
    r.flush(a)
    expect(a.toJSON()).toEqual(b.toJSON())
    const t = a.thread(threadId)
    expect(Object.keys(t?.messages ?? {}).length).toBe(3)
    expect(t?.messages[messageId]?.text).toBe("Hello brave world")
    expect(t?.messages[messageId]?.reactions).toEqual({ "🎉": ["acct:bo", "dev:KA"] })
    // Concurrent resolve and unresolve: the first in the log stays (B's unresolve).
    expect(t?.resolved).toBeUndefined()
  })

  test("a reply to a thread deleted elsewhere is dropped (deletion wins)", () => {
    const r = relay()
    const a = r.join("KA")
    const b = r.join("KB")
    const { threadId } = a.createThread(
      { anchor: { x: 0, y: 0 }, message: { author: { ...ana, id: "dev:KA" }, text: "Hi" } },
      "user",
    )
    r.flush(a)
    a.deleteThread(threadId, "dev:KA", "user")
    b.reply(threadId, { author: bo, text: "Late" }, "user")
    r.flush(a)
    r.flush(b)
    expect(a.toJSON()).toBeUndefined()
    expect(b.toJSON()).toBeUndefined()
  })

  test("a modified client cannot edit or delete someone else's message (spec comments §4.1)", () => {
    const r = relay()
    const a = r.join("KA")
    const b = r.join("KB")
    const { threadId, messageId } = a.createThread(
      { anchor: { x: 0, y: 0 }, message: { author: { ...ana, id: "dev:KA" }, text: "Mine" } },
      "user",
    )
    r.flush(a)
    // B's own API refuses; a modified B appends the changes anyway.
    expect(() => b.editMessage(threadId, messageId, "Hacked", "dev:KA", "user")).toThrow(/author/)
    r.append([
      forged("KB", { op: "edit", thread: threadId, message: messageId, text: "Hacked" }),
      forged("KB", { op: "delete", thread: threadId }),
      forged("KB", { op: "delete", thread: threadId, message: messageId }),
      // Posing as A: a dev: author must be its signing key.
      forged("KB", {
        op: "reply",
        thread: threadId,
        message: "Fake000001",
        author: { id: "dev:KA", name: "Ana", kind: "person" },
        text: "I agree",
      }),
      // An import needs the root key.
      forged("KB", {
        op: "import",
        thread: "Thread0009",
        data: {
          anchor: { x: 0, y: 0 },
          first: "Msg0000009",
          messages: { Msg0000009: { author: ana, at: "2026-11-19T10:00:00.000Z", text: "x" } },
        },
      }),
    ])
    for (const c of [a, b]) {
      expect(c.thread(threadId)?.messages[messageId]?.text).toBe("Mine")
      expect(Object.keys(c.thread(threadId)?.messages ?? {})).toEqual([messageId])
      expect(c.size).toBe(1)
    }
    // The room root key (the owner) may delete any thread.
    r.append([forged("ROOT", { op: "delete", thread: threadId })])
    expect(a.toJSON()).toBeUndefined()
    expect(b.toJSON()).toBeUndefined()
  })

  test("a delete naming ids its key does not hold freezes nothing (spec comments §4.3)", () => {
    const r = relay()
    const a = r.join("KA")
    const b = r.join("KB")
    const anaA = { ...ana, id: "dev:KA" }
    const { threadId, messageId } = a.createThread(
      { anchor: { x: 0, y: 0 }, message: { author: anaA, text: "Mine" } },
      "user",
    )
    const reply = a.reply(threadId, { author: anaA, text: "Also mine" }, "user")
    r.flush(a)
    // B names A's ids under a thread that does not hold them, or as a message of no thread.
    r.append([
      forged("KB", { op: "delete", thread: "Nothing001", message: threadId }),
      forged("KB", { op: "delete", thread: "Nothing002", message: messageId }),
      forged("KB", { op: "delete", thread: threadId, message: "Nothing003" }),
      forged("KB", { op: "delete", thread: "Nothing004", message: reply }),
    ])
    const more = a.reply(threadId, { author: anaA, text: "Still here" }, "user")
    a.setResolved(threadId, anaA, "user")
    r.flush(a)
    for (const c of [a, b]) {
      expect(Object.keys(c.thread(threadId)?.messages ?? {}).sort()).toEqual(
        [messageId, reply, more].sort(),
      )
      expect(c.thread(threadId)?.resolved?.by.id).toBe("dev:KA")
    }
    // A's own delete still holds for a joiner from the compacted log, whoever replays it.
    const created = r.log.find((c) => c.body.op === "thread") as CommentRecord
    a.deleteThread(threadId, anaA.id, "user")
    r.flush(a)
    const c = new CommentStore()
    c.enterRoom({ key: "KC", root: "ROOT", moderator: false }, a.kept())
    const top = Math.max(...a.kept().map((k) => k.pos as number))
    c.receive([{ ...created, pos: top + COMMENT_ENTRY_SLOTS }])
    // A deleted id is single use for every key: a new key cannot take it over.
    const again = forged("KZ", {
      op: "thread",
      thread: threadId,
      message: "Again00001",
      anchor: { x: 0, y: 0 },
      author: { id: "dev:KZ", name: "Zed", kind: "person" },
      text: "Pay invoice 4411",
    })
    r.append([again])
    c.receive([{ ...again, pos: top + 2 * COMMENT_ENTRY_SLOTS }])
    expect(c.toJSON()).toBeUndefined()
    expect(a.toJSON()).toBeUndefined()
  })

  test("a reaction named after an Object property folds like any other", () => {
    const r = relay()
    const a = r.join("KA")
    const { threadId, messageId } = a.createThread(
      { anchor: { x: 0, y: 0 }, message: { author: { ...ana, id: "dev:KA" }, text: "Hi" } },
      "user",
    )
    r.flush(a)
    r.append(
      ["constructor", "toString", "__proto__"].map((emoji) =>
        forged("KB", {
          op: "react",
          thread: threadId,
          message: messageId,
          emoji,
          author: "dev:KB",
          on: true,
        }),
      ),
    )
    const reactions = a.toJSON()?.[threadId]?.messages[messageId]?.reactions ?? {}
    expect(Object.keys(reactions).sort()).toEqual(["__proto__", "constructor", "toString"])
    expect(a.reply(threadId, { author: { ...ana, id: "dev:KA" }, text: "Ok" }, "user")).toBeString()
  })

  test("a room thread or message that takes a node id never reaches the saved file", () => {
    const s = base()
    s.comments.enterRoom({ key: "KA", root: "ROOT", moderator: false }, [])
    const author = { id: "dev:KB", name: "Bo", kind: "person" } as const
    const at = (i: number) => (i + 1) * COMMENT_ENTRY_SLOTS
    s.comments.receive(
      [
        forged("KB", {
          op: "thread",
          thread: "Frame00001",
          message: "Msg0000001",
          anchor: { x: 0, y: 0 },
          author,
          text: "x",
        }),
        forged("KB", {
          op: "thread",
          thread: "Thread0002",
          message: "Msg0000002",
          anchor: { x: 0, y: 0 },
          author,
          text: "ok",
        }),
        forged("KB", {
          op: "reply",
          thread: "Thread0002",
          message: "Frame00001",
          author,
          text: "y",
        }),
      ].map((x, i) => ({ ...x, pos: at(i) })),
    )
    const doc = s.toDocument() as unknown as Record<string, unknown>
    expect(validate(doc).errors).toEqual([])
    expect(Object.keys(doc.comments as object)).toEqual(["Thread0002"])
    // What autosave writes (the header path) drops it too.
    expect(validate(JSON.parse(documentText(s))).errors).toEqual([])
  })

  test("after a relay loses its log, a guest's delete of ids nobody holds yet binds no one", () => {
    const r = relay()
    const a = r.join("KA")
    const { threadId, messageId } = a.createThread(
      { anchor: { x: 0, y: 0 }, message: { author: { ...ana, id: "dev:KA" }, text: "Keep" } },
      "user",
    )
    r.flush(a)
    const created = r.log.find((c) => c.body.op === "thread") as CommentRecord
    // A fresh log: the guest who noted the ids deletes them before anyone re-appends.
    const fresh = relay()
    const b = fresh.join("KB")
    fresh.append([forged("KZ", { op: "delete", thread: threadId, message: messageId })])
    fresh.append([{ ...created, pos: null }])
    expect(b.thread(threadId)?.messages[messageId]?.text).toBe("Keep")
  })

  test("a refused change replayed later is judged alike by online peers and joiners", () => {
    const r = relay()
    const a = r.join("KA")
    const author = { id: "dev:KB", name: "Bo", kind: "person" } as const
    const hidden = forged("KB", {
      op: "reply",
      thread: "Thread0001",
      message: "Msg0000002",
      author,
      text: "hidden",
    })
    r.append([hidden])
    r.append([
      forged("KB", {
        op: "thread",
        thread: "Thread0001",
        message: "Msg0000001",
        anchor: { x: 0, y: 0 },
        author,
        text: "q",
      }),
    ])
    r.append([{ ...hidden, pos: null }])
    const c = new CommentStore()
    c.enterRoom({ key: "KC", root: "ROOT", moderator: false }, a.kept())
    expect(Object.keys(a.thread("Thread0001")?.messages ?? {})).toHaveLength(2)
    expect(c.toJSON()).toEqual(a.toJSON())
  })

  test("creations re-appended into one entry keep their old bases and all apply", () => {
    const r = relay()
    const a = r.join("KA")
    const author = { id: "dev:KB", name: "Bo", kind: "person" } as const
    r.append([
      forged("KB", {
        op: "thread",
        thread: "Thread0001",
        message: "Msg0000001",
        anchor: { x: 0, y: 0 },
        author,
        text: "a",
      }),
      forged(
        "KB",
        { op: "reply", thread: "Thread0001", message: "Msg0000002", author, text: "b" },
        256,
      ),
      forged(
        "KB",
        { op: "reply", thread: "Thread0001", message: "Msg0000003", author, text: "c" },
        512,
      ),
    ])
    expect(Object.keys(a.thread("Thread0001")?.messages ?? {})).toHaveLength(3)
  })

  test("the change parser refuses what the file schema refuses", () => {
    const author = { id: "dev:KB", name: "Bo", kind: "person" }
    const ok = {
      v: 1,
      id: "Change0001",
      n: 1,
      base: 0,
      at: "2026-11-20T10:00:00.000Z",
      op: "thread",
      thread: "Thread0001",
      message: "Msg0000001",
      anchor: { x: 0, y: 0 },
      author,
      text: "hi",
    }
    const image = { mime: "image/png", sha256: "a".repeat(64) }
    expect(parseCommentRecordBody(ok)).not.toBeNull()
    for (const bad of [
      { at: "2026-11-20T10:00:00Z" },
      { anchor: { x: 0, y: 0, zz: 1 } },
      { anchor: { x: 0, y: 0, fallback: { x: 0, y: 0, q: 1 } } },
      { author: { ...author, role: "owner" } },
      { attachments: [{ ...image, file: "../../../../etc/passwd" }] },
      { attachments: [{ ...image, file: "./assets/0123456789abcdef.png", extra: 1 }] },
      { pad: "x".repeat(1000) },
    ])
      expect(parseCommentRecordBody({ ...ok, ...bad })).toBeNull()
  })

  test("replayed changes never bring back a deleted message or an old value", () => {
    const r = relay()
    const a = r.join("KA")
    const anaA = { ...ana, id: "dev:KA" }
    const { threadId } = a.createThread(
      { anchor: { x: 0, y: 0 }, message: { author: anaA, text: "Keep" } },
      "user",
    )
    const reply = a.reply(threadId, { author: anaA, text: "Gone" }, "user")
    a.setResolved(threadId, anaA, "user")
    r.flush(a)
    const replyChange = r.log.find((c) => c.body.op === "reply") as CommentRecord
    const resolveChange = r.log.find((c) => c.body.op === "resolve") as CommentRecord
    a.deleteMessage(threadId, reply, anaA.id, "user")
    a.setResolved(threadId, null, "user")
    r.flush(a)
    // Compaction keeps the tombstone and the latest resolve only.
    const kept = a.kept()
    expect(kept.some((c) => c.body.id === replyChange.body.id)).toBe(false)
    expect(kept.some((c) => c.body.id === resolveChange.body.id)).toBe(false)
    // A joiner from the compacted snapshot, then the old changes replayed by anyone.
    const c = new CommentStore()
    c.enterRoom({ key: "KC", root: "ROOT", moderator: false }, kept)
    const top = Math.max(...kept.map((k) => k.pos as number))
    const replayed = [replyChange, resolveChange].map((x, i) => ({
      ...x,
      pos: top + COMMENT_ENTRY_SLOTS + i,
    }))
    c.receive(replayed)
    a.receive(replayed)
    for (const s of [a, c]) {
      expect(Object.keys(s.thread(threadId)?.messages ?? {}).length).toBe(1)
      expect(s.thread(threadId)?.resolved).toBeUndefined()
    }
    expect(c.toJSON()).toEqual(a.toJSON())
  })

  test("a change claiming a base at or past its own position is dropped", () => {
    const r = relay()
    const a = r.join("KA")
    const { threadId } = a.createThread(
      { anchor: { x: 0, y: 0 }, message: { author: { ...ana, id: "dev:KA" }, text: "Hi" } },
      "user",
    )
    a.setResolved(threadId, null, "user")
    r.flush(a)
    // B resolves with a forged huge base to win every later race: invalid.
    r.append([forged("KB", { op: "resolve", thread: threadId, by: bo }, Number.MAX_SAFE_INTEGER)])
    expect(a.thread(threadId)?.resolved).toBeUndefined()
  })

  test("loading with mode add keeps the comments held and adds the file's other threads", () => {
    const s = base()
    const { threadId } = s.comments.createThread(
      { anchor: { x: 0, y: 0 }, message: { author: ana, text: "Room" } },
      "user",
    )
    const file = s.toDocument() as unknown as Record<string, unknown>
    s.comments.deleteThread(threadId, ana.id, "user")
    s.comments.createThread(
      { anchor: { x: 1, y: 1 }, message: { author: bo, text: "New" } },
      "user",
    )
    // An older client saved the file without comments: nothing is deleted.
    const { comments: _c, ...stripped } = file
    s.loadDocument(stripped as unknown as KimoDocument, { comments: "add" })
    expect(s.comments.size).toBe(1)
    // A thread deleted here stays deleted; one only the file has is added.
    s.loadDocument(file as unknown as KimoDocument, { comments: "add" })
    expect(s.comments.size).toBe(1)
    const other = base()
    other.comments.createThread(
      { anchor: { x: 2, y: 2 }, message: { author: ana, text: "Elsewhere" } },
      "user",
    )
    s.loadDocument(other.toDocument(), { comments: "add" })
    expect(s.comments.size).toBe(2)
  })
})
