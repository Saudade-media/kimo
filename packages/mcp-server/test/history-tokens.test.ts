/**
 * kimo_history undo tokens survive undo / redo (board 37 F3, F6, F11): a group's token follows
 * it to the redo stack and back, so the same token undoes it again after a redo, and a token
 * redo replays exactly that group (or refuses when another one is on top).
 */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  type ClientPolicy,
  createMemoryDocumentHost,
  DEFAULT_POLICY,
  type McpConnection,
  type ToolResult,
} from "../src/index"
import { validateInput } from "../src/server"

function setup() {
  const platform = createMemoryPlatform({ pid: 3301, files: {} })
  const host = createMemoryDocumentHost({ platform, autosaveMs: 0, validate: validateInput })
  const policy: ClientPolicy = {
    ...DEFAULT_POLICY,
    files: ["**"],
    grants: [...DEFAULT_POLICY.grants, "files.create"],
    level: "edit+delete",
    confirmDestructive: false,
  }
  const conn = host.runtime.connect(
    { client: "claude-code", label: "Claude Code", transport: "in-process" },
    { policy, requestApproval: async () => "deny" },
  )
  return { host, conn }
}

type R = ToolResult<Record<string, unknown>>
const call = async (conn: McpConnection, name: string, input: unknown) =>
  (await conn.call(name, input)).result as R
const data = (r: R) => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.errors)}`)
  return r.data as Record<string, unknown>
}

async function fixture() {
  const h = setup()
  const created = data(await call(h.conn, "kimo_create", { path: "/w/t.kimo", template: "blank" }))
  const docId = (created.doc as { id: string }).id
  const add = async (name: string) => {
    const r = await call(h.conn, "kimo_apply_ops", {
      docId,
      ops: [
        { op: "insert", key: name, parent: "root", node: { type: "frame", name, w: 10, h: 10 } },
      ],
    })
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    return r.undoToken as string
  }
  const names = () => {
    const g = h.host.get(docId)
    if (!g.ok) throw new Error("doc")
    const s = g.value.store
    return s
      .nodeIds()
      .map((id) => s.getNode(id)?.name)
      .sort()
  }
  const history = (action: "undo" | "redo", token?: string) =>
    call(h.conn, "kimo_history", { docId, action, ...(token ? { token } : {}) })
  return { h, docId, add, names, history }
}

describe("kimo_history tokens across redo", () => {
  test("undo, redo, then the same token undoes the group again", async () => {
    const f = await fixture()
    const a = await f.add("A")
    data(await f.history("undo", a))
    expect(f.names()).toEqual([])
    const redo = data(await f.history("redo"))
    expect(redo.undoToken).toBe(a)
    expect(f.names()).toEqual(["A"])
    data(await f.history("undo", a))
    expect(f.names()).toEqual([])
    // Twice in a row (Before / After / Before / After).
    data(await f.history("redo", a))
    data(await f.history("undo", a))
    data(await f.history("redo", a))
    expect(f.names()).toEqual(["A"])
    f.h.host.dispose()
  })

  test("a token redo replays that group only; another one on top is refused", async () => {
    const f = await fixture()
    const a = await f.add("A")
    const b = await f.add("B")
    data(await f.history("undo", b))
    data(await f.history("undo", a))
    expect(f.names()).toEqual([])
    // B was undone first: A is on top of the redo stack.
    const wrong = await f.history("redo", b)
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.errors[0]?.code).toBe("REVISION_CONFLICT")
    expect(f.names()).toEqual([])
    data(await f.history("redo", a))
    expect(f.names()).toEqual(["A"])
    data(await f.history("redo", b))
    expect(f.names()).toEqual(["A", "B"])
    // Both tokens still undo, newest first.
    const notTop = await f.history("undo", a)
    expect(!notTop.ok && notTop.errors[0]?.code).toBe("REVISION_CONFLICT")
    data(await f.history("undo", b))
    data(await f.history("undo", a))
    expect(f.names()).toEqual([])
    f.h.host.dispose()
  })

  test("an undone token can't undo again; an untokened undo moves the token too", async () => {
    const f = await fixture()
    const a = await f.add("A")
    data(await f.history("undo"))
    const again = await f.history("undo", a)
    expect(!again.ok && again.errors[0]?.code).toBe("INVALID_INPUT")
    data(await f.history("redo", a))
    data(await f.history("undo", a))
    expect(f.names()).toEqual([])
    f.h.host.dispose()
  })
})
