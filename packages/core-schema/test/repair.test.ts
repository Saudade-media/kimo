import { describe, expect, test } from "bun:test"
import { type JsonObject, openDocument, repairDocument, serialize, validate } from "../src/index"
import { codes, doc, type Loose } from "./helpers"

const frame = (extra: Record<string, unknown> = {}) => ({
  type: "frame",
  parent: null,
  order: "a0",
  w: 10,
  h: 10,
  ...extra,
})
const rect = (parent: string, extra: Record<string, unknown> = {}) => ({
  type: "rect",
  parent,
  order: "a1",
  w: 5,
  h: 5,
  ...extra,
})

const repair = (d: unknown) => repairDocument(d as JsonObject)

describe("repairDocument", () => {
  test("a node whose parent is missing moves to the page root, keeping everything else", () => {
    const input = doc({ Rect000001: rect("Gone000001", { name: "Keep me" }) })
    const { doc: out, repairs } = repair(input)
    const n = (out as Loose).nodes.Rect000001
    expect(n.parent).toBeNull()
    expect(n.name).toBe("Keep me")
    expect(codes(repairs)).toEqual(["PARENT_MISSING"])
    expect(validate(out).ok).toBe(true)
    // Pure: the input is untouched.
    expect((input as Loose).nodes.Rect000001.parent).toBe("Gone000001")
  })

  test("a child of a non-container moves to the root of its former page", () => {
    const { doc: out, repairs } = repair(
      doc(
        {
          Frame00001: frame({ page: "Page000001" }),
          Rect000001: rect("Frame00001"),
          Rect000002: rect("Rect000001"),
        },
        { pages: { Page000001: { order: "a0", name: "One" } } },
      ),
    )
    expect(codes(repairs)).toEqual(["PARENT_NOT_CONTAINER"])
    expect((out as Loose).nodes.Rect000002).toMatchObject({ parent: null, page: "Page000001" })
    expect(validate(out).ok).toBe(true)
  })

  test("a parent cycle is broken by moving one member to the root", () => {
    const { doc: out, repairs } = repair(
      doc({
        Frame00001: frame({ parent: "Frame00002" }),
        Frame00002: frame({ parent: "Frame00001" }),
      }),
    )
    expect(codes(repairs)).toEqual(["PARENT_CYCLE"])
    expect(validate(out).ok).toBe(true)
    expect(Object.keys((out as Loose).nodes)).toHaveLength(2)
  })

  test("a stray at and a contradicting sha256 are dropped", () => {
    const { doc: out, repairs } = repair(
      doc(
        { Frame00001: frame({ at: "x" }) },
        { assets: { "0011223344556677.png": { mime: "image/png", sha256: "f".repeat(64) } } },
      ),
    )
    expect(codes(repairs).sort()).toEqual(["ASSET_HASH_MISMATCH", "AT_WITHOUT_INSTANCE"])
    expect(validate(out, { lints: false }).ok).toBe(true)
  })

  test("a valid document comes back as is", () => {
    const input = doc({ Frame00001: frame() })
    const r = repair(input)
    expect(r.doc).toBe(input as unknown as JsonObject)
    expect(r.repairs).toEqual([])
  })
})

describe("openDocument never locks an invalid file", () => {
  test("validation errors open writable, repaired in memory", () => {
    const text = serialize(doc({ Rect000001: rect("Gone000001") }))
    const r = openDocument(text)
    expect(r.readOnly).toBe(false)
    expect(codes(r.repairs)).toEqual(["PARENT_MISSING"])
    expect(r.validation?.ok).toBe(true)
    // `kimo validate` reports the file as written.
    const raw = openDocument(text, { repair: false })
    expect(codes(raw.validation?.errors ?? [])).toEqual(["PARENT_MISSING"])
    expect(raw.readOnly).toBe(false)
  })

  test("an image missing from the manifest is a warning, not an error", () => {
    const r = openDocument(
      serialize(
        doc(
          { Frame00001: frame({ fill: { kind: "image", src: "./assets/00112233445566aa.png" } }) },
          { assets: { "88e17be075f1be50.woff2": { mime: "font/woff2" } } },
        ),
      ),
    )
    expect(r.readOnly).toBe(false)
    expect(r.validation?.ok).toBe(true)
    expect(codes(r.validation?.warnings ?? [])).toContain("ASSET_MISSING")
  })
})
