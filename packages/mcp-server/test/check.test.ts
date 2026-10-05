/** Board 31 "Check": kimo_apply_ops lists clear problems in the layers it changed. */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { CHECK_MAX_LINES, checkDesign, createMemoryDocumentHost, type WireOp } from "../src/index"
import { validateInput } from "../src/server"
import { expectOk, testClient } from "./conformance"

const REPO = resolve(import.meta.dir, "../../..")

function setup(files: Record<string, string> = {}) {
  const platform = createMemoryPlatform({ pid: 3200, files })
  const host = createMemoryDocumentHost({ platform, autosaveMs: 0, validate: validateInput })
  return testClient(
    {
      host,
      handlers: host.runtime.handlers,
      writeFile: async (p: string, t: string) => platform.control.writeExternal(p, t),
      readFile: async (p: string) => platform.control.readFile(p),
      dispose: () => host.dispose(),
    },
    { policy: { level: "edit+delete", confirmDestructive: false } },
  )
}

type Client = ReturnType<typeof setup>
type Applied = { problems?: string[] }

async function newDoc(c: Client): Promise<string> {
  const path = `/w/${Math.random().toString(36).slice(2)}.kimo`
  const r = expectOk(
    await c.call<{ doc: { id: string } }>("kimo_create", { path, template: "blank" }),
  )
  return r.data.doc.id
}

const FILL = "#E5E7EB"
const frame = (key: string, node: Record<string, unknown>, parent = "root"): WireOp =>
  ({ op: "insert", key, parent, node: { type: "frame", name: key, ...node } }) as WireOp
const rect = (key: string, parent: string, node: Record<string, unknown> = {}): WireOp =>
  ({
    op: "insert",
    key,
    parent,
    node: { type: "rect", name: key, w: 40, h: 40, fill: FILL, ...node },
  }) as WireOp
const text = (key: string, parent: string, node: Record<string, unknown>): WireOp =>
  ({ op: "insert", key, parent, node: { type: "text", name: key, ...node } }) as WireOp

async function apply(c: Client, docId: string, ops: WireOp[]) {
  const r = expectOk(await c.call<Applied>("kimo_apply_ops", { docId, ops }))
  return { problems: r.data.problems ?? [], summary: r.summary }
}

const kinds = (lines: string[]) => lines.map((l) => l.split(" ")[1]?.replace(/:$/, ""))

describe("kimo_apply_ops reports problems in what it changed", () => {
  test("a finished card has none", async () => {
    const c = setup()
    const docId = await newDoc(c)
    const r = await apply(c, docId, [
      frame("card", {
        x: 0,
        y: 0,
        w: 320,
        fill: "#FFFFFF",
        layout: { dir: "column", gap: 12, pad: 24 },
      }),
      text("title", "@card", { content: "Pro", style: { size: 24, weight: 700 } }),
      text("body", "@card", {
        content: "Everything in Free, plus unlimited projects and priority support.",
        grow: "fixed-width",
        w: { mode: "fill" },
      }),
      rect("divider", "@card", { w: { mode: "fill" }, h: 1 }),
    ])
    expect(r.problems).toEqual([])
    expect(r.summary).not.toContain("problem")
  })

  test("an empty frame that paints nothing (a skeleton box)", async () => {
    const c = setup()
    const docId = await newDoc(c)
    const r = await apply(c, docId, [
      frame("page", { x: 0, y: 0, w: 800, fill: "#FFFFFF", layout: { dir: "column" } }),
      frame("Pricing", { w: { mode: "fill" }, h: 200 }, "@page"),
    ])
    expect(kinds(r.problems)).toEqual(["empty"])
    expect(r.problems[0]).toContain('frame "Pricing" has no layers')
    expect(r.summary).toContain("1 problem(s) to fix before moving on")
  })

  test("zero size and invisible shape", async () => {
    const c = setup()
    const docId = await newDoc(c)
    const r = await apply(c, docId, [
      frame("box", { x: 0, y: 0, w: 400, h: 400, fill: "#FFFFFF" }),
      rect("flat", "@box", { x: 0, y: 0, w: 120, h: 0 }),
      rect("ghost", "@box", { x: 0, y: 100, fill: undefined }),
    ])
    expect(kinds(r.problems).sort()).toEqual(["invisible", "zero-size"])
  })

  test("a binding to a variable that no longer exists (the store refuses new ones)", () => {
    const nodes: Record<string, Record<string, unknown>> = {
      a: { type: "rect", name: "Badge", parent: null, w: 10, h: 10, fill: { $ref: "brand/gone" } },
      b: { type: "rect", name: "Lib", parent: null, w: 10, h: 10, fill: { $ref: "ds:brand" } },
    }
    const box = { x: 0, y: 0, w: 10, h: 10 }
    const node = (id: string) => ({ id, local: box, world: box, visible: true }) as never
    const layout = {
      nodes: new Map([
        ["a", node("a")],
        ["b", node("b")],
      ]),
      order: ["a", "b"],
    } as never
    const src = {
      getNode: (id: string) => nodes[id],
      children: () => [],
      toHeader: () => ({ variables: { "brand/primary": {} } }),
    }
    const out = checkDesign(src, layout)
    expect(out.map((p) => `${p.id} ${p.kind}`)).toEqual(["a missing-variable"])
    expect(out[0]?.fix).toContain('"brand/gone"')
  })

  test("text overflowing its fixed box, and text cut by a clipping parent", async () => {
    const c = setup()
    const docId = await newDoc(c)
    const long = "A long sentence that cannot fit in a tiny fixed box at this size at all."
    const r = await apply(c, docId, [
      frame("box", { x: 0, y: 0, w: 400, h: 400, fill: "#FFFFFF" }),
      text("tight", "@box", { x: 0, y: 0, w: 80, h: 16, grow: "fixed", content: long }),
      frame("clipper", { x: 0, y: 200, w: 100, h: 20, fill: "#FFFFFF", clip: true }, "@box"),
      text("cut", "@clipper", { x: 0, y: 0, w: 100, grow: "fixed-width", content: long }),
    ])
    expect(kinds(r.problems)).toEqual(["text-overflow", "clipped"])
  })

  test("a layer outside its parent, a hidden one, overflow and stacked text", async () => {
    const c = setup()
    const docId = await newDoc(c)
    const r = await apply(c, docId, [
      frame("free", { x: 0, y: 0, w: 100, h: 100, fill: "#FFFFFF" }),
      rect("away", "@free", { x: 300, y: 300 }),
      frame("clip", { x: 200, y: 0, w: 100, h: 100, fill: "#FFFFFF", clip: true }),
      rect("hidden", "@clip", { x: 300, y: 0 }),
      frame("stack", {
        x: 400,
        y: 0,
        w: 100,
        h: 50,
        fill: "#FFFFFF",
        layout: { dir: "column", gap: 8 },
      }),
      rect("a", "@stack"),
      rect("b", "@stack"),
      frame("notes", { x: 600, y: 0, w: 200, h: 100, fill: "#FFFFFF" }),
      text("t1", "@notes", { x: 0, y: 0, content: "Overlapping" }),
      text("t2", "@notes", { x: 2, y: 2, content: "Overlapping" }),
    ])
    expect(kinds(r.problems)).toEqual(["outside", "clipped", "overflow", "overlap"])
  })

  test("only the changed layers and their parents are checked", async () => {
    const c = setup()
    const docId = await newDoc(c)
    const first = await apply(c, docId, [frame("lonely", { x: 0, y: 0, w: 50, h: 50 })])
    expect(kinds(first.problems)).toEqual(["empty"])
    const later = await apply(c, docId, [
      frame("other", { x: 200, y: 0, w: 50, h: 50, fill: "#FFFFFF" }),
    ])
    expect(later.problems).toEqual([])
  })

  test("deleting the last child reports the emptied parent", async () => {
    const c = setup()
    const docId = await newDoc(c)
    const r = expectOk(
      await c.call<Applied>("kimo_apply_ops", {
        docId,
        ops: [frame("holder", { x: 0, y: 0, w: 50, h: 50 }), rect("only", "@holder")],
      }),
    )
    expect(r.data.problems ?? []).toEqual([])
    const only = (r.created ?? []).find((x) => x.key === "only")?.id as string
    const after = await apply(c, docId, [{ op: "delete", id: only } as WireOp])
    expect(kinds(after.problems)).toEqual(["empty"])
  })

  test("at most CHECK_MAX_LINES lines, then a count", async () => {
    const c = setup()
    const docId = await newDoc(c)
    const ops: WireOp[] = [frame("box", { x: 0, y: 0, w: 800, h: 100, fill: "#FFFFFF" })]
    for (let i = 0; i < 12; i++) ops.push(rect(`r${i}`, "@box", { x: i * 50, fill: undefined }))
    const r = await apply(c, docId, ops)
    expect(r.problems.length).toBe(CHECK_MAX_LINES + 1)
    expect(r.problems.at(-1)).toBe(`+${12 - CHECK_MAX_LINES} more`)
    expect(r.summary).toContain("12 problem(s)")
  })

  test("a dry run reports nothing", async () => {
    const c = setup()
    const docId = await newDoc(c)
    const r = expectOk(
      await c.call<Applied>("kimo_apply_ops", {
        docId,
        dryRun: true,
        ops: [frame("x", { x: 0, y: 0, w: 50, h: 50 })],
      }),
    )
    expect(r.data.problems).toBeUndefined()
  })
})

describe("kimo_validate {check: true}", () => {
  test("lists placeholders still set and the whole page's problems", async () => {
    const c = setup()
    const docId = await newDoc(c)
    await apply(c, docId, [
      frame("page", { x: 0, y: 0, w: 400, fill: "#FFFFFF", placeholder: true }),
      rect("hero", "@page"),
    ])
    const v = expectOk(
      await c.call<{ problems?: string[] }>("kimo_validate", { docId, check: true }),
    )
    expect(kinds(v.data.problems ?? [])).toEqual(["placeholder"])
    const plain = expectOk(await c.call<{ problems?: string[] }>("kimo_validate", { docId }))
    expect(plain.data.problems).toBeUndefined()
  })
})

/**
 * No false positives: every example is clean. The schema fixtures are synthetic (one construct
 * each, no design); the problems they have are real (they would render nothing) and listed here.
 */
describe("no false positives on the examples and fixtures", () => {
  const files: Record<string, string> = {}
  const examples = join(REPO, "examples")
  for (const d of readdirSync(examples, { withFileTypes: true }))
    if (d.isDirectory())
      for (const f of readdirSync(join(examples, d.name)))
        if (f.endsWith(".kimo"))
          files[`/x/examples/${d.name}/${f}`] = readFileSync(join(examples, d.name, f), "utf8")
  const fixtures = join(REPO, "packages/core-schema/fixtures/valid")
  for (const f of readdirSync(fixtures))
    if (f.endsWith(".kimo")) files[`/x/fixtures/${f}`] = readFileSync(join(fixtures, f), "utf8")

  /** Synthetic fixtures: an empty stub component, empty page roots, hidden or absent paints. */
  const EXPECTED: Record<string, string[]> = {
    "/x/fixtures/components-m3.kimo": ["Arrow00001 empty"],
    "/x/fixtures/agent-nodes-m6.kimo": ["Frame00001 empty"],
    "/x/fixtures/shapes-and-paints.kimo": ["GrpRect002 invisible"],
    "/x/fixtures/pages.kimo": ["Unpaged001 empty", "CartFrame1 empty"],
    "/x/fixtures/polygon-star-image-crop.kimo": ["Star000002 invisible"],
    "/x/fixtures/merge-conflicts-resolved.kimo": ["Footer0001 empty"],
  }

  test("examples: zero problems; fixtures: only the synthetic ones", async () => {
    const c = setup(files)
    expect(Object.keys(files).filter((p) => p.startsWith("/x/examples/")).length).toBeGreaterThan(5)
    for (const path of Object.keys(files)) {
      const o = expectOk(await c.call<{ doc: { id: string } }>("kimo_open", { path }))
      const v = expectOk(
        await c.call<{ problems?: string[] }>("kimo_validate", {
          docId: o.data.doc.id,
          check: true,
        }),
      )
      const got = (v.data.problems ?? []).map((l) => l.split(":")[0])
      expect({ path, got }).toEqual({ path, got: EXPECTED[path] ?? [] })
    }
  }, 60_000)
})
