/** Board 31 "Batch limit": kimo_apply_ops authors at most AGENT_MAX_NEW_LAYERS new layers per call. */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  AGENT_MAX_NEW_LAYERS,
  batchTooLarge,
  createMemoryDocumentHost,
  newLayerCount,
  type WireOp,
} from "../src/index"
import { validateInput } from "../src/server"
import { expectFail, expectOk, testClient } from "./conformance"

function setup() {
  const platform = createMemoryPlatform({ pid: 3100, files: {} })
  const host = createMemoryDocumentHost({ platform, autosaveMs: 0, validate: validateInput })
  const h = {
    host,
    handlers: host.runtime.handlers,
    writeFile: async (p: string, t: string) => platform.control.writeExternal(p, t),
    readFile: async (p: string) => platform.control.readFile(p),
    dispose: () => host.dispose(),
  }
  return testClient(h, { policy: { level: "edit+delete", confirmDestructive: false } })
}

type Client = ReturnType<typeof setup>

async function newDoc(c: Client) {
  const path = `/w/${Math.random().toString(36).slice(2)}.kimo`
  const r = expectOk(
    await c.call<{ doc: { id: string } }>("kimo_create", { path, template: "blank" }),
  )
  return r.data.doc.id
}

const rect = (parent: string, i: number): WireOp =>
  ({
    op: "insert",
    parent,
    node: { type: "rect", name: `R${i}`, x: i, y: 0, w: 4, h: 4 },
  }) as WireOp

/** A top-level page frame with `n` layers inside, built in ≤ 40-insert calls. */
async function bigPage(c: Client, docId: string, n: number): Promise<string> {
  const r = expectOk(
    await c.call<unknown>("kimo_apply_ops", {
      docId,
      ops: [
        {
          op: "insert",
          key: "page",
          parent: "root",
          node: { type: "frame", name: "Page", x: 0, y: 0, w: 1440, h: 900 },
        },
      ],
    }),
  )
  const page = (r.created ?? [])[0]?.id as string
  for (let made = 0; made < n; made += AGENT_MAX_NEW_LAYERS) {
    const count = Math.min(AGENT_MAX_NEW_LAYERS, n - made)
    expectOk(
      await c.call("kimo_apply_ops", {
        docId,
        ops: Array.from({ length: count }, (_, i) => rect(page, made + i)),
      }),
    )
  }
  return page
}

describe("newLayerCount", () => {
  test("counts insert ops only: copy, instantiate, replace and edits are free", () => {
    const ops = [
      rect("p", 0),
      rect("p", 1),
      { op: "copy", id: "a", parent: "root" },
      { op: "instantiate", of: "c", parent: "p" },
      { op: "replace", id: "x", node: { type: "rect" } },
      { op: "update", id: "x", set: { name: "y" } },
      { op: "page", action: "duplicate", id: "pg" },
    ] as unknown as WireOp[]
    expect(newLayerCount(ops)).toBe(2)
  })

  test("batchTooLarge: null at the limit, an actionable error above it", () => {
    const at = Array.from({ length: AGENT_MAX_NEW_LAYERS }, (_, i) => rect("p", i))
    expect(AGENT_MAX_NEW_LAYERS).toBe(40)
    expect(batchTooLarge(at)).toBeNull()
    const err = batchTooLarge([...at, rect("p", 99)])
    expect(err?.code).toBe("BATCH_TOO_LARGE")
    expect(err?.detail).toEqual({ kind: "batch", limit: 40, newLayers: 41 })
    expect(err?.suggestion).toContain("one complete section")
    expect(err?.suggestion).toContain("≤ 40")
  })
})

describe("kimo_apply_ops batch limit", () => {
  test("41 freshly authored layers are refused with the split hint; nothing is applied", async () => {
    const c = setup()
    const docId = await newDoc(c)
    const before = expectOk(await c.call<unknown>("kimo_get_state", { docId })).revision
    const ops: WireOp[] = [
      {
        op: "insert",
        key: "f",
        parent: "root",
        node: { type: "frame", name: "F", x: 0, y: 0, w: 100, h: 100 },
      } as WireOp,
      ...Array.from({ length: AGENT_MAX_NEW_LAYERS }, (_, i) => rect("@f", i)),
    ]
    const r = expectFail(await c.call("kimo_apply_ops", { docId, ops }), "BATCH_TOO_LARGE")
    expect(r.errors[0]?.detail).toEqual({ kind: "batch", limit: 40, newLayers: 41 })
    expect(r.errors[0]?.suggestion).toMatch(/Split into finished parts of ≤ 40 new layers/)
    const after = expectOk(await c.call<unknown>("kimo_get_state", { docId })).revision
    expect(after).toEqual(before)
    // dryRun is refused the same way.
    expectFail(await c.call("kimo_apply_ops", { docId, ops, dryRun: true }), "BATCH_TOO_LARGE")
    // Exactly the limit passes.
    expectOk(await c.call("kimo_apply_ops", { docId, ops: ops.slice(0, AGENT_MAX_NEW_LAYERS) }))
  })

  test("copying a 300-layer page passes", async () => {
    const c = setup()
    const docId = await newDoc(c)
    const page = await bigPage(c, docId, 300)
    const r = expectOk(
      await c.call<{ inserted: number }>("kimo_apply_ops", {
        docId,
        ops: [{ op: "copy", id: page, parent: "root", set: { name: "Page · variant", x: 1540 } }],
      }),
    )
    expect(r.data.inserted).toBe(301)
  })

  test("a copy plus ≤ 40 inserts in the same call passes", async () => {
    const c = setup()
    const docId = await newDoc(c)
    const page = await bigPage(c, docId, 120)
    const r = expectOk(
      await c.call<{ inserted: number }>("kimo_apply_ops", {
        docId,
        ops: [
          { op: "copy", id: page, key: "v2", parent: "root", set: { x: 1540 } },
          ...Array.from({ length: AGENT_MAX_NEW_LAYERS }, (_, i) => rect("@v2", 500 + i)),
        ],
      }),
    )
    expect(r.data.inserted).toBe(121 + 40)
  })

  test("instantiating a large component passes", async () => {
    const c = setup()
    const docId = await newDoc(c)
    const page = await bigPage(c, docId, 60)
    expectOk(
      await c.call("kimo_apply_ops", {
        docId,
        ops: [{ op: "make_component", ids: [page], name: "Big" }],
      }),
    )
    const r = expectOk(
      await c.call<unknown>("kimo_apply_ops", {
        docId,
        ops: Array.from({ length: 5 }, (_, i) => ({
          op: "instantiate",
          of: page,
          parent: "root",
          x: 2000 + i * 10,
          y: 0,
        })),
      }),
    )
    expect(r.ok).toBe(true)
  })

  test("editing many existing layers is not limited", async () => {
    const c = setup()
    const docId = await newDoc(c)
    const page = await bigPage(c, docId, 80)
    const q = expectOk(
      await c.call<{ nodes: { id: string }[] }>("kimo_query", {
        docId,
        select: { under: page },
        depth: 1,
        limit: 200,
      }),
    )
    const ids = q.data.nodes.map((n) => n.id).filter((id) => id !== page)
    expect(ids.length).toBeGreaterThan(AGENT_MAX_NEW_LAYERS)
    expectOk(
      await c.call("kimo_apply_ops", {
        docId,
        ops: ids.map((id) => ({ op: "update", id, set: { h: 8 } })),
      }),
    )
  })
})
