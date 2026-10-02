import { describe, expect, test } from "bun:test"
import {
  FORMAT_VERSION,
  formatStatus,
  type JsonObject,
  MIGRATIONS,
  type Migration,
  migrate,
  openDocument,
  parse,
  SCHEMA_URL,
  serialize,
} from "../src/index"
import { type Loose, readFixture } from "./helpers"

describe("format version", () => {
  test("FORMAT_VERSION is 0.1.0 and the registry is empty", () => {
    expect(FORMAT_VERSION).toBe("0.1.0")
    expect(SCHEMA_URL).toBe("https://kimo.design/schema/kimo-0.1.json")
    expect(MIGRATIONS).toEqual([])
  })
  test("formatStatus compares major.minor only", () => {
    expect(formatStatus("0.1.0")).toBe("current")
    expect(formatStatus("0.1.9")).toBe("current")
    expect(formatStatus("0.0.3")).toBe("older")
    expect(formatStatus("0.2.0")).toBe("newer")
    expect(formatStatus("1.0.0")).toBe("newer")
    expect(formatStatus("1.0")).toBe("invalid")
    expect(formatStatus("01.0.0")).toBe("invalid")
    expect(formatStatus(1)).toBe("invalid")
  })
})

/** A synthetic history 0.0 → 0.1 → 0.2 used to exercise the runner. */
const history: Migration[] = [
  {
    from: "0.0",
    to: "0.1",
    description: "rename layout.spacing to layout.gap",
    migrate(doc) {
      for (const n of Object.values(doc.nodes as Record<string, JsonObject>)) {
        const l = n.layout as JsonObject | undefined
        if (l && "spacing" in l) {
          l.gap = l.spacing as number
          delete l.spacing
        }
      }
      return doc
    },
  },
  {
    from: "0.1",
    to: "0.2",
    description: "no-op",
    migrate: (doc) => doc,
  },
]

const old: JsonObject = {
  $schema: "https://kimo.design/schema/kimo-0.0.json",
  format: "0.0.4",
  vendorThing: { keep: true },
  nodes: {
    Frame00001: {
      type: "frame",
      parent: null,
      order: "a0",
      layout: { dir: "row", spacing: 8 },
      future: 1,
    },
  },
}

describe("migrate", () => {
  test("applies the chain, sets format and $schema, preserves unknown fields", () => {
    const r = migrate(old, { migrations: history })
    expect(r.status).toBe("migrated")
    expect(r.from).toBe("0.0.4")
    expect(r.to).toBe("0.1.0")
    expect(r.applied).toEqual(["0.0→0.1: rename layout.spacing to layout.gap"])
    expect(r.doc.format).toBe("0.1.0")
    expect(r.doc.$schema).toBe(SCHEMA_URL)
    expect(r.doc.vendorThing).toEqual({ keep: true })
    expect((r.doc.nodes as Loose).Frame00001).toEqual({
      type: "frame",
      parent: null,
      order: "a0",
      layout: { dir: "row", gap: 8 },
      future: 1,
    })
  })
  test("is pure", () => {
    const snapshot = structuredClone(old)
    migrate(old, { migrations: history })
    expect(old).toEqual(snapshot)
  })
  test("multi-step to an explicit target", () => {
    const r = migrate(old, { migrations: history, target: "0.2.0" })
    expect(r.applied).toHaveLength(2)
    expect(r.doc.format).toBe("0.2.0")
    expect(r.doc.$schema).toBe("https://kimo.design/schema/kimo-0.2.json")
  })
  test("current, newer, invalid and missing paths leave the document unchanged", () => {
    const cur = { format: "0.1.3", nodes: {} }
    expect(migrate(cur).status).toBe("current")
    expect(migrate(cur).doc).toBe(cur)
    expect(migrate({ format: "0.2.0", nodes: {} }).status).toBe("newer")
    expect(migrate({ format: "x", nodes: {} }).status).toBe("invalid")
    expect(migrate(old).status).toBe("no-path")
  })
  test("only the format/$schema header lines and migrated lines change in the file", () => {
    const before = serialize(old as never, { stripDefaults: false })
    const after = serialize(migrate(old, { migrations: history }).doc as never, {
      stripDefaults: false,
    })
    const a = before.split("\n")
    const b = after.split("\n")
    expect(a.length).toBe(b.length)
    const changed = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null)
    expect(changed.map((i) => b[i as number]?.slice(0, 14))).toEqual([
      `"$schema": "ht`,
      `"format": "0.1`,
      `"Frame00001": `,
    ])
  })
})

describe("openDocument", () => {
  test("older documents are migrated in memory and need upgrade consent", () => {
    const r = openDocument(serialize(old as never), { migrations: history, lints: false })
    expect(r.needsUpgradeConsent).toBe(true)
    expect(r.sourceFormat).toBe("0.0.4")
    expect(r.doc.format).toBe("0.1.0")
    // vendorThing / future are unknown in 0.1: preserved, but the document is invalid → read-only.
    expect(r.readOnly).toBe(true)
    expect(r.readOnlyReasons.map((x) => x.code)).toEqual(["INVALID"])
  })
  test("allowInvalid opens invalid documents for editing", () => {
    const r = openDocument(serialize(old as never), { migrations: history, allowInvalid: true })
    expect(r.readOnly).toBe(false)
    expect(r.validation?.ok).toBe(false)
  })
  test("current valid documents open writable", () => {
    const r = openDocument(readFixture("valid/components-local.kimo"))
    expect(r.readOnly).toBe(false)
    expect(r.needsUpgradeConsent).toBe(false)
    expect(r.validation?.ok).toBe(true)
  })
  test("no migration path opens read-only", () => {
    const r = openDocument(serialize(old as never))
    expect(r.readOnlyReasons.map((x) => x.code)).toEqual(["NO_MIGRATION_PATH"])
  })
})

describe("forward compatibility conformance (10.2 rule 7)", () => {
  const text = readFixture("forward/newer-minor.kimo")

  test("a newer file is byte-identical after open and save", () => {
    const r = openDocument(text)
    expect(r.readOnly).toBe(true)
    expect(serialize(r.doc)).toBe(text)
  })

  test("an edit elsewhere changes only that node's line; unknown fields, nodes and members survive", () => {
    const d = parse(text) as Loose
    d.nodes.Text000001.content = "Hello"
    const out = serialize(d)
    const a = text.split("\n")
    const b = out.split("\n")
    expect(b.length).toBe(a.length)
    const changed = a.flatMap((l, i) => (l === b[i] ? [] : [b[i]]))
    expect(changed).toEqual([
      `, "Text000001": {"type":"text","parent":"Frame00001","order":"a1","content":"Hello","style":{"size":12,"textWrap":"balance"}}`,
    ])
    expect(out).toContain(`"cornerSmoothing":0.6`)
    expect(out).toContain(`"type":"sticker"`)
    expect(out).toContain(`"pages": {"Page000001":{"name":"Home","order":"a0"}}`)
  })
})
