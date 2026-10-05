/**
 * Board 30 "Rich text": agents write text runs (feature "text/runs", spec §8.1) through
 * kimo_apply_ops. A gated construct and its feature go in the same edit (spec §13), so the
 * host declares `text/runs` itself when an op writes span content.
 */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createMemoryDocumentHost } from "../src/index"
import { validateInput } from "../src/server"
import { expectOk, testClient } from "./conformance"

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
  return {
    platform,
    host,
    c: testClient(h, { policy: { level: "edit+delete", confirmDestructive: false } }),
  }
}

const RUNS = [
  { text: "Save " },
  { text: "40%", style: { weight: 700 }, fill: "#E5484D" },
  { text: " today", href: "https://kimo.design" },
]

describe("kimo_apply_ops with text runs", () => {
  test("insert with runs declares text/runs in the same edit", async () => {
    const s = setup()
    const path = "/w/runs.kimo"
    const r = expectOk(
      await s.c.call<{ doc: { id: string } }>("kimo_create", { path, template: "web" }),
    )
    const docId = r.data.doc.id
    const res = expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "insert",
            key: "t",
            parent: "DesktopFrm1",
            node: { type: "text", name: "Rich", content: RUNS, x: 0, y: 0 },
          },
        ],
      }),
    )
    const id = (res as unknown as { created: { key: string; id: string }[] }).created.find(
      (c) => c.key === "t",
    )?.id as string
    const q = expectOk(
      await s.c.call<{ nodes: Record<string, unknown>[] }>("kimo_query", {
        docId,
        select: { ids: [id] },
        depth: 0,
      }),
    )
    expect(q.data.nodes[0]?.content).toEqual(RUNS)
    expectOk(await s.c.call("kimo_save", { docId }))
    const saved = JSON.parse(s.platform.control.readFile(path) as string)
    expect(saved.features).toContain("text/runs")
    expect(saved.nodes[id].content).toEqual(RUNS)
    await s.host.dispose()
  })

  test("update content to runs also declares the feature; plain strings don't", async () => {
    const s = setup()
    const path = "/w/runs2.kimo"
    const r = expectOk(
      await s.c.call<{ doc: { id: string } }>("kimo_create", { path, template: "web" }),
    )
    const docId = r.data.doc.id
    const res = expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "insert",
            key: "t",
            parent: "DesktopFrm1",
            node: { type: "text", content: "plain", x: 0, y: 0 },
          },
        ],
      }),
    )
    const id = (res as unknown as { created: { key: string; id: string }[] }).created.find(
      (c) => c.key === "t",
    )?.id as string
    expectOk(await s.c.call("kimo_save", { docId }))
    expect(JSON.parse(s.platform.control.readFile(path) as string).features ?? []).not.toContain(
      "text/runs",
    )
    expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [{ op: "update", id, set: { content: RUNS } }],
      }),
    )
    expectOk(await s.c.call("kimo_save", { docId }))
    const saved = JSON.parse(s.platform.control.readFile(path) as string)
    expect(saved.features).toContain("text/runs")
    expect(saved.nodes[id].content).toEqual(RUNS)
    await s.host.dispose()
  })
})
