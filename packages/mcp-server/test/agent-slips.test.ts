/**
 * Board 31 token pass: an agent edit that fails costs a whole model round trip, so
 * kimo_apply_ops (1) declares every feature a value it writes needs (spec §13), (2) accepts the
 * two common `update` slips as what they mean, (3) answers unknown fields with a one-line fix,
 * (4) addresses nodes inside a fresh copy (`@key/<id>`, `created[]`), and (5) keeps the
 * model-facing JSON free of the normalized ops it would otherwise echo back.
 */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { featuresWrittenBy } from "../src/handlers/tools"
import { schemaFix } from "../src/handlers/util"
import {
  createMemoryDocumentHost,
  modelText,
  modelView,
  success,
  toCallToolResult,
} from "../src/index"
import { validateInput } from "../src/server"
import { expectFail, expectOk, testClient } from "./conformance"

function setup() {
  const platform = createMemoryPlatform({ pid: 3200, files: {} })
  const host = createMemoryDocumentHost({ platform, autosaveMs: 0, validate: validateInput })
  const h = {
    host,
    handlers: host.runtime.handlers,
    writeFile: async (p: string, t: string) => platform.control.writeExternal(p, t),
    readFile: async (p: string) => platform.control.readFile(p),
    dispose: () => host.dispose(),
  }
  return {
    platform,
    c: testClient(h, { policy: { level: "edit+delete", confirmDestructive: false } }),
  }
}

async function newDoc(s: ReturnType<typeof setup>, path: string) {
  const r = expectOk(
    await s.c.call<{ doc: { id: string } }>("kimo_create", { path, template: "web" }),
  )
  return r.data.doc.id
}

type Created = { created: { key: string; id: string }[] }
const idOf = (r: unknown, key: string) =>
  (r as Created).created.find((c) => c.key === key)?.id as string

async function saved(s: ReturnType<typeof setup>, docId: string, path: string) {
  expectOk(await s.c.call("kimo_save", { docId }))
  return JSON.parse(s.platform.control.readFile(path) as string) as {
    features?: string[]
    nodes: Record<string, Record<string, unknown>>
  }
}

describe("feature auto-declare", () => {
  test("featuresWrittenBy reads node bodies, update fields and variables", () => {
    expect(
      [
        ...featuresWrittenBy([
          { op: "insert", node: { type: "frame", layout: { dir: "row", align: "stretch" } } },
          { op: "update", id: "x", set: { w: { mode: "fill", min: 10 } } },
          { op: "update", id: "y", set: { layout: { dir: "row", wrap: true } } },
          { op: "setVariables", set: { t: { type: "typography", value: {} } } },
        ]),
      ].sort(),
    ).toEqual(["layout/stretch-baseline", "layout/wrap", "size/min-max", "tokens/composite"])
    // Defaults need nothing.
    expect(
      featuresWrittenBy([
        { op: "insert", node: { type: "frame", layout: { dir: "row", wrap: false, crossGap: 0 } } },
      ]).size,
    ).toBe(0)
  })

  test("layout.align stretch and size min/max commit with their features", async () => {
    const s = setup()
    const path = "/w/features.kimo"
    const docId = await newDoc(s, path)
    const r = expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "insert",
            key: "row",
            parent: "DesktopFrm1",
            node: { type: "frame", layout: { dir: "row", align: "stretch" } },
          },
          { op: "update", id: "@row", set: { w: { mode: "fill", min: 200 } } },
        ],
      }),
    )
    const doc = await saved(s, docId, path)
    expect(doc.features).toEqual(
      expect.arrayContaining(["layout/stretch-baseline", "size/min-max"]),
    )
    expect((doc.nodes[idOf(r, "row")]?.layout as { align?: string } | undefined)?.align).toBe(
      "stretch",
    )
  })
})

describe("lenient update", () => {
  test("set.unset is the op's unset and null in set removes the field", async () => {
    const s = setup()
    const path = "/w/lenient.kimo"
    const docId = await newDoc(s, path)
    const r = expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "insert",
            key: "card",
            parent: "DesktopFrm1",
            node: { type: "frame", name: "Card", radius: 8, opacity: 0.5, fill: "#FFFFFF" },
          },
        ],
      }),
    )
    const id = idOf(r, "card")
    expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [{ op: "update", id, set: { unset: ["radius"], opacity: null, name: "Card 2" } }],
      }),
    )
    const node = (await saved(s, docId, path)).nodes[id] as Record<string, unknown>
    expect(node.radius).toBeUndefined()
    expect(node.opacity).toBeUndefined()
    expect(node.name).toBe("Card 2")
    expect(node.fill).toBe("#FFFFFF")
  })

  test("a text node's text string is its content (insert and update)", async () => {
    const s = setup()
    const path = "/w/text.kimo"
    const docId = await newDoc(s, path)
    const r = expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          { op: "insert", key: "t", parent: "DesktopFrm1", node: { type: "text", text: "Hi" } },
        ],
      }),
    )
    const id = idOf(r, "t")
    expect((await saved(s, docId, path)).nodes[id]?.content).toBe("Hi")
    expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [{ op: "update", id, set: { text: "Bye" } }],
      }),
    )
    const n = (await saved(s, docId, path)).nodes[id] as Record<string, unknown>
    expect(n.content).toBe("Bye")
    expect(n.text).toBeUndefined()
  })

  test("a failed commit lists at most 5 issues and counts the rest", async () => {
    const s = setup()
    const docId = await newDoc(s, "/w/many.kimo")
    const r = await s.c.call("kimo_apply_ops", {
      docId,
      ops: Array.from({ length: 8 }, () => ({
        op: "insert",
        parent: "DesktopFrm1",
        node: { type: "frame", padding: 4 },
      })),
    })
    const f = expectFail(r, "SCHEMA_VIOLATION")
    expect(f.errors).toHaveLength(5)
    expect(f.summary).toContain("(+3 more issue(s))")
  })

  test("width / height are w / h; an unknown tool key is named", async () => {
    const s = setup()
    const path = "/w/size.kimo"
    const docId = await newDoc(s, path)
    const r = expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "insert",
            key: "a",
            parent: "root",
            node: { type: "frame", width: 300, height: 200 },
          },
          { op: "copy", id: "@a", key: "b", parent: "root", set: { x: 400, height: 50 } },
          { op: "update", id: "@a", set: { width: 320 } },
        ],
      }),
    )
    const doc = await saved(s, docId, path)
    expect(doc.nodes[idOf(r, "a")]).toMatchObject({ w: 320, h: 200 })
    expect(doc.nodes[idOf(r, "b")]).toMatchObject({ w: 300, h: 50 })
    expect(doc.nodes[idOf(r, "a")]?.width).toBeUndefined()
    const bad = expectFail(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [{ op: "update", id: idOf(r, "a"), set: { w: 10 } }],
        scale: 0.5,
      }),
      "INVALID_INPUT",
    )
    expect(bad.errors[0]?.message).toContain('"scale"')
  })

  test("layout strings, padding / padX / padY, CSS names, bare fill / fit sizes, color strokes", async () => {
    const s = setup()
    const path = "/w/layout-slips.kimo"
    const docId = await newDoc(s, path)
    const r = expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "insert",
            key: "a",
            parent: "root",
            node: { type: "frame", w: 600, layout: "vertical", gap: 12, padding: [8, 16] },
          },
          {
            op: "insert",
            key: "b",
            parent: "@a",
            node: { type: "frame", w: "fill", h: "fit", layout: "horizontal", padX: 24, padY: 10 },
          },
          {
            op: "insert",
            key: "c",
            parent: "@a",
            node: { type: "frame", layout: { dir: "row", padding: 4 } },
          },
          { op: "update", id: "@c", set: { layout: "column" } },
          {
            op: "insert",
            key: "d",
            parent: "@a",
            node: {
              type: "frame",
              layout: "row",
              alignItems: "center",
              justifyContent: "space-between",
              stroke: "#E5E7EB",
            },
          },
          {
            op: "insert",
            key: "e",
            parent: "@a",
            node: {
              type: "frame",
              layout: { dir: "row", justify: "flex-end" },
              stroke: { color: "#000000", width: 2 },
              cornerRadius: 12,
            },
          },
        ],
      }),
    )
    const doc = await saved(s, docId, path)
    expect(doc.nodes[idOf(r, "a")]?.layout).toEqual({ dir: "column", gap: 12, pad: [8, 16] })
    // h: {mode: "fit"} is the frame default, so the file leaves it out.
    expect(doc.nodes[idOf(r, "b")]).toMatchObject({
      w: { mode: "fill" },
      layout: { dir: "row", pad: [10, 24] },
    })
    expect(doc.nodes[idOf(r, "b")]?.h).toBeUndefined()
    expect(doc.nodes[idOf(r, "c")]?.layout).toEqual({ dir: "column" })
    expect(doc.nodes[idOf(r, "d")]).toMatchObject({
      layout: { dir: "row", align: "center", justify: "between" },
      stroke: { paint: "#E5E7EB" }, // width 1 is the default
    })
    expect(doc.nodes[idOf(r, "e")]).toMatchObject({
      layout: { dir: "row", justify: "end" },
      stroke: { paint: "#000000", width: 2 },
      radius: 12,
    })
  })

  test("null fields of a new node are dropped", async () => {
    const s = setup()
    const docId = await newDoc(s, "/w/nulls.kimo")
    expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [{ op: "insert", parent: "DesktopFrm1", node: { type: "frame", effects: null } }],
      }),
    )
  })

  test("an unknown field gets a one-line fix", async () => {
    const s = setup()
    const docId = await newDoc(s, "/w/fix.kimo")
    const r = await s.c.call("kimo_apply_ops", {
      docId,
      ops: [{ op: "insert", parent: "DesktopFrm1", node: { type: "frame", padding: 12 } }],
    })
    const e = expectFail(r, "SCHEMA_VIOLATION").errors[0]
    expect(e?.suggestion).toContain('"pad"')
    expect(schemaFix("UNKNOWN_PROPERTY", "/nodes/abc123/unset")).toContain('"unset": ["field"]')
    expect(schemaFix("UNKNOWN_PROPERTY", "/nodes/abc123/zorp")).toContain('"zorp" is not a field')
    expect(schemaFix("SCHEMA", "/nodes/abc123/w")).toBeUndefined()
    expect(
      schemaFix("SCHEMA", "/nodes/abc123/content", 'Missing required property "content"'),
    ).toContain('"content":"Hello"')
  })
})

describe("copies", () => {
  test("@key/<id> addresses the copy of a node in the same call; created lists the top levels", async () => {
    const s = setup()
    const path = "/w/copy.kimo"
    const docId = await newDoc(s, path)
    const base = expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          { op: "insert", key: "page", parent: "root", node: { type: "frame", name: "Page" } },
          { op: "insert", key: "nav", parent: "@page", node: { type: "frame", name: "Nav" } },
          { op: "insert", key: "foot", parent: "@page", node: { type: "frame", name: "Footer" } },
          { op: "insert", key: "logo", parent: "@nav", node: { type: "text", content: "L" } },
        ],
      }),
    )
    const [page, nav, foot, logo] = ["page", "nav", "foot", "logo"].map((k) => idOf(base, k))
    const r = expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          { op: "copy", id: page, key: "v2", parent: "root", set: { name: "Page · v2", x: 2000 } },
          {
            op: "insert",
            key: "pricing",
            parent: "@v2",
            index: 1,
            node: { type: "frame", name: "Pricing" },
          },
          { op: "update", id: `@v2/${logo}`, set: { content: "Lumen" } },
        ],
      }),
    )
    const v2 = idOf(r, "v2")
    const copiedNav = idOf(r, `v2/${nav}`)
    const copiedFoot = idOf(r, `v2/${foot}`)
    expect(idOf(r, `v2/${logo}`)).toBeDefined()
    const doc = await saved(s, docId, path)
    const kids = Object.entries(doc.nodes)
      .filter(([, n]) => n.parent === v2)
      .sort(([, a], [, b]) => (String(a.order) < String(b.order) ? -1 : 1))
      .map(([id]) => id)
    expect(kids).toEqual([copiedNav, idOf(r, "pricing"), copiedFoot])
    expect(doc.nodes[idOf(r, `v2/${logo}`)]?.content).toBe("Lumen")
    expect(doc.nodes[logo as string]?.content).toBe("L")
    expectFail(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [{ op: "update", id: `@v2/${logo}`, set: { name: "x" } }],
      }),
      "INVALID_INPUT",
    )
  })
})

describe("model-facing results", () => {
  test("MCP results drop ops/inverse (text and structuredContent) and keep opCount", () => {
    const r = success({ applied: 1 }, "Applied", {
      ops: [{ op: "insert", id: "a", node: { type: "frame" } }],
      inverse: [{ op: "delete", id: "a" }],
      created: [{ key: "a", id: "a" }],
      changed: ["a"],
      undoToken: "u1",
    })
    const v = modelView(r) as unknown as Record<string, unknown>
    expect(v.ops).toBeUndefined()
    expect(v.inverse).toBeUndefined()
    expect(v.opCount).toBe(1)
    expect(v.undoToken).toBe("u1")
    const out = toCallToolResult(r)
    expect(JSON.parse((out.content[1] as { text: string }).text)).toEqual(v)
    expect(out.structuredContent).toEqual(v as never)
    // A dry run keeps its would-be ops.
    const dry = modelView({ ...r, dryRun: true }) as unknown as Record<string, unknown>
    expect(dry.ops).toHaveLength(1)
    expect(dry.inverse).toBeUndefined()
    expect(modelText(r).length).toBeLessThan(JSON.stringify(r).length)
  })

  test("apply_ops results carry opCount", async () => {
    const s = setup()
    const docId = await newDoc(s, "/w/count.kimo")
    const r = expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [{ op: "insert", parent: "DesktopFrm1", node: { type: "frame" } }],
      }),
    ) as unknown as { opCount: number; ops: unknown[] }
    expect(r.opCount).toBe(r.ops.length)
  })
})

describe("lenient node bodies (measured Claude Code slips)", () => {
  test("a text color in style is the node fill; frame layout fields beside layout go inside it", async () => {
    const s = setup()
    const path = "/w/slips.kimo"
    const docId = await newDoc(s, path)
    const r = expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "insert",
            key: "row",
            parent: "DesktopFrm1",
            node: { type: "frame", name: "Row", layout: { dir: "row" }, gap: 12, padding: 8 },
          },
          {
            op: "insert",
            key: "col",
            parent: "@row",
            node: { type: "frame", name: "Col", dir: "column", gap: 4 },
          },
          {
            op: "insert",
            key: "t",
            parent: "@col",
            node: { type: "text", content: "Hi", style: { size: 14, fill: "#222222" } },
          },
        ],
      }),
    )
    const doc = await saved(s, docId, path)
    expect(doc.nodes[idOf(r, "row")]?.layout).toEqual({ dir: "row", gap: 12, pad: 8 })
    expect(doc.nodes[idOf(r, "col")]?.layout).toEqual({ dir: "column", gap: 4 })
    const t = doc.nodes[idOf(r, "t")] as Record<string, unknown>
    expect(t.fill).toBe("#222222")
    expect(t.style).toEqual({ size: 14 })
  })
})
