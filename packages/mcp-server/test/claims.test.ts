/** Agent area claims at the tool layer (ADR 0016 item 16): AREA_BUSY, human edits, release. */
import { describe, expect, test } from "bun:test"
import { claimsFor } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  type ClientPolicy,
  claimTargets,
  createMemoryDocumentHost,
  placeholderOnly,
  type ToolResult,
} from "../src/index"
import { validateInput } from "../src/server"

const POLICY: ClientPolicy = {
  level: "edit+delete",
  files: ["/w/**"],
  nodes: [],
  grants: ["files.create", "save"],
  onExceed: "deny",
  confirmDestructive: false,
}

async function setup() {
  const platform = createMemoryPlatform({ pid: 5100 })
  const host = createMemoryDocumentHost({
    platform,
    autosaveMs: 0,
    validate: validateInput,
    clientPolicy: POLICY,
  })
  const rt = host.runtime
  const a = rt.connect(
    { client: "kimo", label: "Kimo", transport: "in-process", session: "aaaaaa" },
    { origin: "agent:kimo.aaaaaa.1", policy: POLICY },
  )
  const b = rt.connect(
    { client: "kimo", label: "Agent 2", transport: "in-process", session: "bbbbbb" },
    { origin: "agent:kimo.bbbbbb.1", policy: POLICY },
  )
  const created = (await a.call("kimo_create", { path: "/w/claims.kimo", template: "blank" }))
    .result
  if (!created.ok) throw new Error(JSON.stringify(created))
  const docId = (created.data as { doc: { id: string } }).doc.id
  const doc = host.get(docId)
  if (!doc.ok) throw new Error("not open")
  const store = doc.value.store
  // Two top-level frames, one with a child.
  const seeded = store.apply(
    [
      { op: "insert", id: "Hero000001", node: { type: "frame", name: "Hero" } },
      {
        op: "insert",
        id: "Title00001",
        parent: "Hero000001",
        node: { type: "text", name: "Title", content: "Hi" },
      },
      { op: "insert", id: "Footer0001", node: { type: "frame", name: "Footer" } },
    ],
    { origin: "user" },
  )
  if (!seeded.ok) throw new Error(JSON.stringify(seeded))
  return { host, rt, a, b, docId, store }
}

const rename = (docId: string, id: string, name: string) => ({
  docId,
  ops: [{ op: "update", id, set: { name } }],
})

function code(r: ToolResult): string | undefined {
  return r.ok ? undefined : r.errors[0]?.code
}

describe("claim targets", () => {
  test("edited ids and insert/move parents, never copy sources, root or @keys", () => {
    expect(
      claimTargets([
        { op: "update", id: "A" },
        { op: "insert", key: "k", parent: "P", node: {} },
        { op: "insert", parent: "root", node: {} },
        { op: "insert", parent: "@k", node: {} },
        { op: "move", id: "M", parent: "Q" },
        { op: "copy", id: "Src", parent: "Dst" },
        { op: "set_override", instance: "I/child", kind: "set" },
        { op: "make_component", ids: ["C1", "C2"] },
      ]),
    ).toEqual(["A", "P", "Q", "M", "Dst", "I", "C1", "C2"])
  })

  test("placeholder-only groups are exempt", () => {
    expect(placeholderOnly([{ op: "update", id: "A", unset: ["placeholder"] }])).toBe(true)
    expect(placeholderOnly([{ op: "update", id: "A", set: { placeholder: true } }])).toBe(true)
    expect(
      placeholderOnly([{ op: "update", id: "A", set: { placeholder: true, name: "x" } }]),
    ).toBe(false)
    expect(placeholderOnly([])).toBe(false)
  })
})

describe("AREA_BUSY between two agents", () => {
  test("the second agent is refused inside the first one's area and works elsewhere", async () => {
    const s = await setup()
    const first = await s.a.call("kimo_apply_ops", rename(s.docId, "Hero000001", "Hero A"))
    expect(first.result.ok).toBe(true)
    // A child of the claimed frame.
    const busy = (await s.b.call("kimo_apply_ops", rename(s.docId, "Title00001", "B"))).result
    expect(code(busy)).toBe("AREA_BUSY")
    if (busy.ok) throw new Error("expected AREA_BUSY")
    const e = busy.errors[0]
    expect(e?.retryable).toBe(true)
    expect(e?.suggestion).toContain("another part")
    expect(e?.detail).toMatchObject({
      kind: "area",
      holder: "agent:kimo.aaaaaa.1",
      holderLabel: "Kimo",
      ids: ["Hero000001"],
      touched: ["Title00001"],
    })
    expect(typeof (e?.detail as { since?: unknown } | undefined)?.since).toBe("string")
    expect(busy.retryId).toBeUndefined()
    expect(s.store.getNode("Title00001")?.name).toBe("Title")
    // An insert into the claimed frame is refused too; elsewhere works.
    const insert = await s.b.call("kimo_apply_ops", {
      docId: s.docId,
      ops: [{ op: "insert", parent: "Hero000001", node: { type: "rect", w: 1, h: 1 } }],
    })
    expect(code(insert.result)).toBe("AREA_BUSY")
    expect((await s.b.call("kimo_apply_ops", rename(s.docId, "Footer0001", "B"))).result.ok).toBe(
      true,
    )
    await s.host.dispose()
  })

  test("a top-level insert joins the inserting agent's claim", async () => {
    const s = await setup()
    const r = (
      await s.a.call("kimo_apply_ops", {
        docId: s.docId,
        ops: [{ op: "insert", key: "p", parent: "root", node: { type: "frame", name: "New" } }],
      })
    ).result
    if (!r.ok) throw new Error(JSON.stringify(r))
    const id = r.created?.[0]?.id as string
    expect(code((await s.b.call("kimo_apply_ops", rename(s.docId, id, "B"))).result)).toBe(
      "AREA_BUSY",
    )
    await s.host.dispose()
  })

  test("dry runs and placeholder clears never claim or get refused", async () => {
    const s = await setup()
    await s.a.call("kimo_apply_ops", rename(s.docId, "Hero000001", "A"))
    const dry = await s.b.call("kimo_apply_ops", {
      ...rename(s.docId, "Footer0001", "B"),
      dryRun: true,
    })
    expect(dry.result.ok).toBe(true)
    expect(
      claimsFor(s.store)
        .list()
        .map((v) => v.holder),
    ).toEqual(["agent:kimo.aaaaaa.1"])
    const clear = await s.b.call("kimo_apply_ops", {
      docId: s.docId,
      ops: [{ op: "update", id: "Hero000001", unset: ["placeholder"] }],
    })
    expect(clear.result.ok).toBe(true)
    await s.host.dispose()
  })

  test("the claim ends with the turn and when the connection closes", async () => {
    const s = await setup()
    s.a.setTurn("turn-1")
    await s.a.call("kimo_apply_ops", rename(s.docId, "Hero000001", "A"))
    expect(claimsFor(s.store).list()[0]?.turn).toBe("turn-1")
    expect(
      code((await s.b.call("kimo_apply_ops", rename(s.docId, "Hero000001", "B"))).result),
    ).toBe("AREA_BUSY")
    s.a.setTurn(null)
    expect(claimsFor(s.store).list()).toEqual([])
    // B now holds the frame; closing B's connection frees it for A.
    expect((await s.b.call("kimo_apply_ops", rename(s.docId, "Hero000001", "B"))).result.ok).toBe(
      true,
    )
    expect(
      code((await s.a.call("kimo_apply_ops", rename(s.docId, "Title00001", "A"))).result),
    ).toBe("AREA_BUSY")
    s.b.close()
    expect((await s.a.call("kimo_apply_ops", rename(s.docId, "Title00001", "A"))).result.ok).toBe(
      true,
    )
    await s.host.dispose()
  })

  test("an MCP client respects agent claims but holds none", async () => {
    const s = await setup()
    const mcp = s.rt.connect(
      { client: "codex", label: "Codex", transport: "socket" },
      { policy: POLICY },
    )
    await s.a.call("kimo_apply_ops", rename(s.docId, "Hero000001", "A"))
    expect(
      code((await mcp.call("kimo_apply_ops", rename(s.docId, "Title00001", "C"))).result),
    ).toBe("AREA_BUSY")
    expect((await mcp.call("kimo_apply_ops", rename(s.docId, "Footer0001", "C"))).result.ok).toBe(
      true,
    )
    // No claim: an agent may still work on the frame the MCP client edited.
    expect((await s.b.call("kimo_apply_ops", rename(s.docId, "Footer0001", "B"))).result.ok).toBe(
      true,
    )
    await s.host.dispose()
  })

  test("people are never blocked inside a claim", async () => {
    const s = await setup()
    await s.a.call("kimo_apply_ops", rename(s.docId, "Hero000001", "A"))
    const r = s.store.apply(
      { op: "update", id: "Title00001", set: { name: "Person" } },
      { origin: "user" },
    )
    expect(r.ok).toBe(true)
    await s.host.dispose()
  })
})

describe("human edit inside a claim", () => {
  test("the agent's next write fails once with REVISION_CONFLICT human-edit, the retry lands", async () => {
    const s = await setup()
    await s.a.call("kimo_apply_ops", rename(s.docId, "Hero000001", "A"))
    s.store.apply(
      { op: "update", id: "Title00001", set: { content: "Edited" } },
      { origin: "user" },
    )
    // Any next write of that agent, even outside the area.
    const next = (await s.a.call("kimo_apply_ops", rename(s.docId, "Footer0001", "A"))).result
    expect(code(next)).toBe("REVISION_CONFLICT")
    if (next.ok) throw new Error("expected a conflict")
    expect(next.errors[0]?.detail).toMatchObject({
      kind: "human-edit",
      ids: ["Title00001"],
      by: "local",
    })
    expect(next.errors[0]?.suggestion).toContain("Re-read")
    const retry = (await s.a.call("kimo_apply_ops", rename(s.docId, "Footer0001", "A"))).result
    expect(retry.ok).toBe(true)
    // Other agents are not told about A's area.
    expect(
      (await s.b.call("kimo_query", { docId: s.docId, select: { ids: ["Footer0001"] } })).result.ok,
    ).toBe(true)
    await s.host.dispose()
  })

  test("a dry run does not consume the notice", async () => {
    const s = await setup()
    await s.a.call("kimo_apply_ops", rename(s.docId, "Hero000001", "A"))
    s.store.apply(
      { op: "update", id: "Title00001", set: { content: "Edited" } },
      { origin: "user" },
    )
    const dry = await s.a.call("kimo_apply_ops", {
      ...rename(s.docId, "Footer0001", "A"),
      dryRun: true,
    })
    expect(dry.result.ok).toBe(true)
    expect(
      code((await s.a.call("kimo_apply_ops", rename(s.docId, "Footer0001", "A"))).result),
    ).toBe("REVISION_CONFLICT")
    await s.host.dispose()
  })
})

describe("streamed edits", () => {
  test("a stream into another agent's area holds and the call reports AREA_BUSY", async () => {
    const s = await setup()
    await s.a.call("kimo_apply_ops", rename(s.docId, "Hero000001", "A"))
    const stream = s.b.openStream("call-1")
    if (!stream) throw new Error("no stream")
    const input = {
      docId: s.docId,
      ops: [{ op: "insert", parent: "Hero000001", node: { type: "rect", name: "R", w: 1, h: 1 } }],
    }
    stream.feed(JSON.stringify(input))
    await stream.settled()
    expect(stream.progress().applied).toBe(0)
    const out = await s.b.call("kimo_apply_ops", input, { callId: "call-1" })
    expect(code(out.result)).toBe("AREA_BUSY")
    expect(s.store.children("Hero000001")).toEqual(["Title00001"])
    await s.host.dispose()
  })
})
