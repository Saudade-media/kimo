/**
 * Streamed edits (ADR 0013 §4.7): ops land while the model writes the call, then commit as one
 * undo step or roll back; patch-retry (§4.8).
 */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  AGENT_MAX_NEW_LAYERS,
  type ApprovalOutcome,
  type ClientPolicy,
  createMemoryDocumentHost,
  DEFAULT_POLICY,
  type McpConnection,
  RETRIES,
  type ToolResult,
} from "../src/index"
import { validateInput } from "../src/server"

function setup(policy: Partial<ClientPolicy> = {}, approve: ApprovalOutcome = "deny") {
  const platform = createMemoryPlatform({ pid: 3300, files: {} })
  const host = createMemoryDocumentHost({ platform, autosaveMs: 0, validate: validateInput })
  const asked: string[] = []
  const conn = host.runtime.connect(
    { client: "claude-code", label: "Claude Code", transport: "in-process" },
    {
      policy: {
        ...DEFAULT_POLICY,
        files: ["**"],
        grants: [...DEFAULT_POLICY.grants, "files.create"],
        level: "edit+delete",
        confirmDestructive: false,
        ...policy,
      },
      requestApproval: async (r) => {
        asked.push(r.summary)
        return approve
      },
    },
  )
  return { host, conn, asked, dispose: () => host.dispose() }
}

type Ok = Extract<ToolResult<Record<string, unknown>>, { ok: true }>

async function call(conn: McpConnection, name: string, input: unknown, callId?: string) {
  return (await conn.call(name, input, callId ? { callId } : {})).result as ToolResult<
    Record<string, unknown>
  >
}

function ok(r: ToolResult<Record<string, unknown>>): Ok {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.errors)}`)
  return r
}

async function newDoc(conn: McpConnection): Promise<string> {
  const path = `/w/${Math.random().toString(36).slice(2)}.kimo`
  const r = ok(await call(conn, "kimo_create", { path, template: "blank" }))
  return (r.data as { doc: { id: string } }).doc.id
}

const frame = (key: string, name: string, parent = "root") => ({
  op: "insert",
  key,
  parent,
  node: { type: "frame", name, x: 0, y: 0, w: 400, h: 300 },
})
const text = (key: string, parent: string, content: string) => ({
  op: "insert",
  key,
  parent,
  node: { type: "text", name: content, content, style: { size: 16 }, fill: "#111111" },
})

/** Feeds `json` to a stream in small chunks, waiting for each batch to land. */
async function stream(conn: McpConnection, callId: string, json: string, chunk = 7) {
  const s = conn.openStream(callId)
  if (!s) throw new Error("no stream")
  const seen: number[] = []
  s.onProgress((p) => seen.push(p.applied))
  for (let i = 0; i < json.length; i += chunk) {
    s.feed(json.slice(i, i + chunk))
    await s.settled()
  }
  return { s, seen }
}

function store(h: ReturnType<typeof setup>, docId: string) {
  const r = h.host.get(docId)
  if (!r.ok) throw new Error("doc")
  return r.value.store
}

const names = (h: ReturnType<typeof setup>, docId: string) =>
  store(h, docId)
    .nodeIds()
    .map((id) => store(h, docId).getNode(id)?.name)
    .sort()

describe("streamed kimo_apply_ops", () => {
  test("ops land while the call streams; the call commits them as one undo step", async () => {
    const h = setup()
    const docId = await newDoc(h.conn)
    const input = {
      docId,
      ops: [frame("page", "Page"), text("t1", "@page", "Title"), text("t2", "@page", "Body")],
    }
    const json = JSON.stringify(input)
    // Before the last op closes, the first ones are on the canvas already.
    const cut = json.indexOf('"Body"')
    const s = h.conn.openStream("toolu_1") as NonNullable<ReturnType<McpConnection["openStream"]>>
    s.feed(json.slice(0, cut))
    await s.settled()
    expect(names(h, docId)).toEqual(["Page", "Title"])
    expect(s.progress()).toMatchObject({ state: "open", applied: 2, name: "Title" })
    s.feed(json.slice(cut))
    await s.settled()
    expect(names(h, docId)).toEqual(["Body", "Page", "Title"])
    const revisionBefore = store(h, docId).revision

    const r = ok(await call(h.conn, "kimo_apply_ops", input, "toolu_1"))
    expect(r.data).toMatchObject({ applied: 3, inserted: 3 })
    expect(r.created?.map((c) => c.key)).toEqual(["page", "t1", "t2"])
    expect(r.pointer).toBe(r.created?.[2]?.id)
    // Nothing new was applied by the call itself: it committed the streamed group.
    expect(store(h, docId).revision).toEqual(revisionBefore)
    expect(s.progress().state).toBe("committed")

    // One undo step removes all three.
    const u = ok(await call(h.conn, "kimo_history", { docId, action: "undo", token: r.undoToken }))
    expect(u.ok).toBe(true)
    expect(names(h, docId)).toEqual([])
    h.dispose()
  })

  test("a call that differs from the stream rolls it back and runs normally", async () => {
    const h = setup()
    const docId = await newDoc(h.conn)
    const streamed = { docId, ops: [frame("a", "A"), frame("b", "B")] }
    await stream(h.conn, "toolu_2", JSON.stringify(streamed))
    expect(names(h, docId)).toEqual(["A", "B"])
    const r = ok(
      await call(
        h.conn,
        "kimo_apply_ops",
        { docId, ops: [frame("a", "A"), frame("c", "C")] },
        "toolu_2",
      ),
    )
    expect(r.data).toMatchObject({ applied: 2 })
    expect(names(h, docId)).toEqual(["A", "C"])
    // The rollback left nothing to redo and one undo step for the real call.
    ok(await call(h.conn, "kimo_history", { docId, action: "undo" }))
    expect(names(h, docId)).toEqual([])
    h.dispose()
  })

  test("closing a stream whose call never came (stop, retry) rolls everything back", async () => {
    const h = setup()
    const docId = await newDoc(h.conn)
    const input = { docId, ops: [frame("a", "A"), text("t", "@a", "Hello")] }
    const { s } = await stream(h.conn, "toolu_3", JSON.stringify(input).slice(0, -2))
    expect(names(h, docId)).toEqual(["A", "Hello"])
    s.close("Stopped")
    expect(names(h, docId)).toEqual([])
    expect(s.progress()).toMatchObject({ state: "rolled-back", reason: "Stopped" })
    const hist = ok(await call(h.conn, "kimo_history", { docId, action: "list" }))
    expect((hist.data as { canRedo: boolean }).canRedo).toBe(false)
    h.dispose()
  })

  test("a destructive op stops stream-applying; the call asks, then commits the rest", async () => {
    const h = setup({ confirmDestructive: true, onExceed: "ask" }, "once")
    const docId = await newDoc(h.conn)
    const made = ok(await call(h.conn, "kimo_apply_ops", { docId, ops: [frame("old", "Old")] }))
    const oldId = made.created?.[0]?.id as string
    const input = {
      docId,
      ops: [frame("a", "A"), { op: "delete", id: oldId }, frame("b", "B")],
    }
    const { s } = await stream(h.conn, "toolu_4", JSON.stringify(input))
    expect(s.progress()).toMatchObject({ state: "held", applied: 1 })
    expect(names(h, docId)).toEqual(["A", "Old"])
    expect(h.asked).toEqual([])
    const r = ok(await call(h.conn, "kimo_apply_ops", input, "toolu_4"))
    expect(h.asked.length).toBe(1)
    expect(names(h, docId)).toEqual(["A", "B"])
    expect(s.progress().state).toBe("committed")
    ok(await call(h.conn, "kimo_history", { docId, action: "undo", token: r.undoToken }))
    expect(names(h, docId)).toEqual(["Old"])
    h.dispose()
  })

  test("a denied approval rolls the streamed part back", async () => {
    const h = setup({ confirmDestructive: true, onExceed: "ask" }, "deny")
    const docId = await newDoc(h.conn)
    const made = ok(await call(h.conn, "kimo_apply_ops", { docId, ops: [frame("old", "Old")] }))
    const input = {
      docId,
      ops: [frame("a", "A"), { op: "delete", id: made.created?.[0]?.id }],
    }
    await stream(h.conn, "toolu_5", JSON.stringify(input))
    expect(names(h, docId)).toEqual(["A", "Old"])
    const r = await call(h.conn, "kimo_apply_ops", input, "toolu_5")
    expect(r.ok).toBe(false)
    expect(names(h, docId)).toEqual(["Old"])
    h.dispose()
  })

  test("a user deleting a parent mid-stream: the call rolls back and reports it", async () => {
    const h = setup()
    const docId = await newDoc(h.conn)
    const baseRevision = store(h, docId).revision
    const input = {
      docId,
      baseRevision,
      ops: [frame("a", "A"), text("t1", "@a", "One"), text("t2", "@a", "Two")],
    }
    const json = JSON.stringify(input)
    const s = h.conn.openStream("toolu_6") as NonNullable<ReturnType<McpConnection["openStream"]>>
    s.feed(json.slice(0, json.indexOf('"Two"')))
    await s.settled()
    const st = store(h, docId)
    const a = st.nodeIds().find((id) => st.getNode(id)?.name === "A") as string
    expect(st.apply({ op: "delete", id: a }, { origin: "user" }).ok).toBe(true)
    s.feed(json.slice(json.indexOf('"Two"')))
    await s.settled()
    expect(s.progress().state).toBe("held")
    const r = await call(h.conn, "kimo_apply_ops", input, "toolu_6")
    // Rolled back; the call ran the normal way and reports the user's edit.
    expect(s.progress().state).toBe("rolled-back")
    expect(r.ok ? [] : r.errors.map((e) => e.code)).toEqual(["REVISION_CONFLICT"])
    expect(names(h, docId)).toEqual([])
    h.dispose()
  })

  test("an @key reference to a later op waits; the call then fails normally and rolls back", async () => {
    const h = setup()
    const docId = await newDoc(h.conn)
    const input = {
      docId,
      ops: [frame("a", "A"), { op: "move", id: "@a", parent: "@b" }, frame("b", "B")],
    }
    const { s } = await stream(h.conn, "toolu_7", JSON.stringify(input))
    expect(s.progress()).toMatchObject({ state: "open", applied: 1, received: 3 })
    const r = await call(h.conn, "kimo_apply_ops", input, "toolu_7")
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).toContain("@b does not name a node created earlier")
    expect(s.progress().state).toBe("rolled-back")
    expect(names(h, docId)).toEqual([])
    h.dispose()
  })

  test("streamed calls may add up to 150 new layers; non-streamed calls stay at 40", async () => {
    const h = setup()
    const docId = await newDoc(h.conn)
    const many = (n: number, page: string) => [
      frame(page, page),
      ...Array.from({ length: n }, (_, i) => text(`t${i}`, `@${page}`, `T${i}`)),
    ]
    const plain = await call(h.conn, "kimo_apply_ops", {
      docId,
      ops: many(AGENT_MAX_NEW_LAYERS + 5, "P"),
    })
    expect(plain.ok).toBe(false)
    const input = { docId, ops: many(120, "Q") }
    const { s } = await stream(h.conn, "toolu_8", JSON.stringify(input), 400)
    expect(s.progress().applied).toBe(121)
    ok(await call(h.conn, "kimo_apply_ops", input, "toolu_8"))
    // Once a connection streams, its calls get the streamed limit too.
    ok(await call(h.conn, "kimo_apply_ops", { docId, ops: many(60, "R") }))
    h.dispose()
  })

  test("a second stream of the same agent waits until the first one ends", async () => {
    const h = setup()
    const docId = await newDoc(h.conn)
    const one = { docId, ops: [frame("a", "A")] }
    const two = { docId, ops: [frame("b", "B")] }
    const s1 = await stream(h.conn, "toolu_9a", JSON.stringify(one))
    const s2 = await stream(h.conn, "toolu_9b", JSON.stringify(two))
    expect(s2.s.progress().applied).toBe(0)
    const r1 = ok(await call(h.conn, "kimo_apply_ops", one, "toolu_9a"))
    await s2.s.settled()
    expect(s2.s.progress().applied).toBe(1)
    const r2 = ok(await call(h.conn, "kimo_apply_ops", two, "toolu_9b"))
    expect(s1.s.progress().state).toBe("committed")
    ok(await call(h.conn, "kimo_history", { docId, action: "undo", token: r2.undoToken }))
    expect(names(h, docId)).toEqual(["A"])
    ok(await call(h.conn, "kimo_history", { docId, action: "undo", token: r1.undoToken }))
    expect(names(h, docId)).toEqual([])
    h.dispose()
  })

  test("closing the connection rolls back its open streams", async () => {
    const h = setup()
    const docId = await newDoc(h.conn)
    await stream(h.conn, "toolu_10", JSON.stringify({ docId, ops: [frame("a", "A")] }))
    expect(names(h, docId)).toEqual(["A"])
    h.conn.close()
    expect(names(h, docId)).toEqual([])
    h.dispose()
  })
})

describe("patch-retry", () => {
  test("a failed call returns retryId; {retryId, edits} fixes and reruns it", async () => {
    const h = setup()
    const docId = await newDoc(h.conn)
    const bad = await call(h.conn, "kimo_apply_ops", {
      docId,
      ops: [frame("a", "A"), text("t", "@nope", "Hi")],
    })
    expect(bad.ok).toBe(false)
    const retryId = (bad as { retryId?: string }).retryId as string
    expect(retryId).toMatch(/^r_/)
    // `find` written with pretty spacing still matches the compact stored call.
    const fixed = ok(
      await call(h.conn, "kimo_apply_ops", {
        docId,
        retryId,
        edits: [{ find: '"parent": "@nope"', replace: '"parent":"@a"' }],
      }),
    )
    expect(fixed.data).toMatchObject({ applied: 2, inserted: 2 })
    // The handle is consumed.
    const again = await call(h.conn, "kimo_apply_ops", { docId, retryId, edits: [] })
    expect(again.ok).toBe(false)
    h.dispose()
  })

  test("ambiguous and missing finds fail clearly; another agent cannot use the handle", async () => {
    const h = setup()
    const docId = await newDoc(h.conn)
    const bad = await call(h.conn, "kimo_apply_ops", {
      docId,
      ops: [text("x", "@gone", "One"), text("y", "@gone", "Two")],
    })
    const retryId = (bad as { retryId?: string }).retryId as string
    const amb = await call(h.conn, "kimo_apply_ops", {
      docId,
      retryId,
      edits: [{ find: "@gone", replace: "root" }],
    })
    expect(amb.ok).toBe(false)
    expect(JSON.stringify(amb)).toContain("occurs 2 times")
    const other = h.host.runtime.connect({
      client: "codex",
      label: "Codex",
      transport: "in-process",
    })
    const foreign = await call(other, "kimo_apply_ops", { docId, retryId, edits: [] })
    expect(JSON.stringify(foreign)).toContain("Unknown or expired retryId")
    // The ambiguous attempt did not consume it: `all` fixes both.
    const bad2 = await call(h.conn, "kimo_apply_ops", {
      docId,
      ops: [text("x", "@gone", "One"), text("y", "@gone", "Two")],
    })
    const r = ok(
      await call(h.conn, "kimo_apply_ops", {
        docId,
        retryId: (bad2 as { retryId?: string }).retryId,
        edits: [{ find: '"@gone"', replace: '"root"', all: true }],
      }),
    )
    expect(r.data).toMatchObject({ inserted: 2 })
    expect(RETRIES.size).toBeLessThanOrEqual(64)
    h.dispose()
  })

  test("permission failures get no retryId", async () => {
    const h = setup({ onExceed: "deny" })
    const docId = await newDoc(h.conn)
    h.conn.setPolicy({ ...h.conn.policy, level: "read" })
    const r = await call(h.conn, "kimo_apply_ops", { docId, ops: [frame("a", "A")] })
    expect(r.ok).toBe(false)
    expect(r.ok ? [] : r.errors.map((e) => e.code)).toContain("PERMISSION_DENIED")
    expect((r as { retryId?: string }).retryId).toBeUndefined()
    h.dispose()
  })
})
