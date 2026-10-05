/**
 * kimo_script (ADR 0013 addendum 7): a sandboxed JavaScript program whose calls compile to
 * kimo_apply_ops ops, streamed statement by statement, authorized as the ops it makes.
 */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  type ApprovalOutcome,
  type ApprovalRequest,
  type ClientPolicy,
  createMemoryDocumentHost,
  DEFAULT_POLICY,
  type McpConnection,
  readGuide,
  type ToolResult,
} from "../src/index"
import { inProcessRunner, workerRunner } from "../src/script/runner"
import { DEFAULT_LIMITS, resolveRefs, ScriptSession, type WorldData } from "../src/script/session"
import { completePrefix, topLevelNames } from "../src/script/statements"
import { ScriptStream, TopLevelStrings } from "../src/script/stream"
import { validateInput } from "../src/server"

type R = ToolResult<Record<string, unknown>>
type Ok = Extract<R, { ok: true }>

function setup(
  policy: Partial<ClientPolicy> = {},
  approve: ApprovalOutcome = "deny",
): {
  conn: McpConnection
  asked: ApprovalRequest[]
  host: ReturnType<typeof createMemoryDocumentHost>
  dispose(): void
} {
  const platform = createMemoryPlatform({ pid: 3400, files: {} })
  const host = createMemoryDocumentHost({ platform, autosaveMs: 0, validate: validateInput })
  const asked: ApprovalRequest[] = []
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
        asked.push(r)
        return approve
      },
    },
  )
  return { conn, asked, host, dispose: () => host.dispose() }
}

async function call(conn: McpConnection, name: string, input: unknown, callId?: string) {
  return (await conn.call(name, input, callId ? { callId } : {})).result as R
}
function ok(r: R): Ok {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.errors)}`)
  return r
}
function failed(r: R) {
  if (r.ok) throw new Error(`expected a failure, got ${r.summary}`)
  return r
}
async function newDoc(conn: McpConnection): Promise<string> {
  const path = `/w/${Math.random().toString(36).slice(2)}.kimo`
  const r = ok(await call(conn, "kimo_create", { path, template: "blank" }))
  return (r.data as { doc: { id: string } }).doc.id
}
const nodes = async (conn: McpConnection, docId: string) =>
  ok(await call(conn, "kimo_query", { docId, select: { topLevel: true }, depth: 5 }))

const PRICING = `const page = Insert("root", {type: "frame", name: "Pricing", x: 0, y: 0, w: 900,
  layout: {dir: "column", gap: 24, pad: 40}, fill: "#FFFFFF"})
const row = Insert(page, {type: "frame", name: "Plans", layout: {dir: "row", gap: 16}})
function card(name, price) {
  return Insert(row, {type: "frame", name: name + " card", w: 260, fill: "#F4F4F5",
    layout: {dir: "column", gap: 8, pad: 24}, children: [
      {type: "text", name, content: name, fill: "#111111", style: {size: 20, weight: 600}},
      {type: "text", content: price + "/mo", fill: "#111111", style: {size: 32}},
    ]})
}
for (const [n, p] of [["Free", "$0"], ["Pro", "$29"]]) card(n, p)
Print("plans", 2)
`

async function session(code: string, world: WorldData = {}, page?: string) {
  const s = await inProcessRunner().open(world, {}, DEFAULT_LIMITS, page)
  const out = await s.run(code)
  return { s, out }
}

describe("compile", () => {
  test("API calls become wire ops with generated keys; children nest; lines are kept", async () => {
    const { s, out } =
      await session(`const a = Insert("root", {type: "frame", name: "A", children: [{type: "text", content: "x"}]})
Update(a, {fill: "#000000"}, ["effects"])
Move(a, "root", 0)
const c = Copy(a, "root", {x: 10})
Instantiate("Comp000001", c, {name: "I"})
Op({op: "set_variables", set: [{name: "x", variable: {type: "number", value: 1}}]})
Delete(c + "/abc")`)
    expect(out.result).toEqual({ ok: true })
    expect(out.ops).toEqual([
      { op: "insert", key: "s1", parent: "root", node: { type: "frame", name: "A" } },
      { op: "insert", key: "s2", parent: "@s1", node: { type: "text", content: "x" } },
      { op: "update", id: "@s1", set: { fill: "#000000" }, unset: ["effects"] },
      { op: "move", id: "@s1", parent: "root", index: 0 },
      { op: "copy", id: "@s1", key: "s3", parent: "root", set: { x: 10 } },
      { op: "instantiate", name: "I", of: "Comp000001", key: "s4", parent: "@s3" },
      { op: "set_variables", set: [{ name: "x", variable: { type: "number", value: 1 } }] },
      { op: "delete", id: "@s3/abc" },
    ] as never)
    expect(out.lines).toEqual([1, 1, 2, 3, 4, 5, 6, 7])
    expect(out.names).toEqual([
      ["s1", "A"],
      ["s4", "I"],
    ])
    s.dispose()
  })

  test("bad API calls throw in the script with their line", async () => {
    const { s, out } = await session(`Insert("root", {type: "frame"})\n\nUpdate(42, {})`)
    expect(out.result).toMatchObject({ ok: false, line: 3 })
    expect((out.result as { message: string }).message).toContain("Update(id, …)")
    s.dispose()
  })

  test("Get and Children read the world as it was; new layers are not readable", async () => {
    const world: WorldData = {
      F1: {
        id: "F1",
        type: "frame",
        name: "Hero",
        parent: null,
        children: ["T1"],
        box: { x: 0, y: 0, w: 10, h: 5 },
      },
      T1: { id: "T1", type: "text", content: "Hi", parent: "F1", children: [] },
    }
    const { s, out } = await session(
      `Print(Get("F1").box.w, Children("root").length, Children("F1")[0].content, Get("nope"), Get("__proto__"), Get("constructor"))`,
      world,
    )
    expect(out.prints).toEqual(["10 1 Hi null null null"])
    const r = await s.run(`const x = Insert("root", {type: "frame"}); Get(x)`)
    expect(r.result).toMatchObject({ ok: false })
    s.dispose()
  })

  test("page: top-level layers without a page go on it", async () => {
    const { s, out } = await session(
      `const a = Insert("root", {type: "frame"}); Insert("root", {type: "frame", page: "Other00001"}); Instantiate("C00000001", "root")`,
      {},
      "Page000001",
    )
    expect(out.ops).toEqual([
      { op: "insert", key: "s1", parent: "root", node: { type: "frame", page: "Page000001" } },
      { op: "insert", key: "s2", parent: "root", node: { type: "frame", page: "Other00001" } },
      { op: "instantiate", of: "C00000001", key: "s3", parent: "root" },
      { op: "update", id: "@s3", set: { page: "Page000001" } },
    ] as never)
    s.dispose()
  })

  test("the guide's example compiles and applies cleanly", async () => {
    const md = readGuide("script")?.markdown ?? ""
    const code = /```js\n([\s\S]*?)```/.exec(md)?.[1] ?? ""
    expect(code).toContain("function plan")
    const t = setup()
    const docId = await newDoc(t.conn)
    const r = ok(await call(t.conn, "kimo_script", { docId, code }))
    expect((r.data as { inserted: number }).inserted).toBeGreaterThan(15)
    expect((r.data as { problems?: string[] }).problems ?? []).toEqual([])
    t.dispose()
  })
})

describe("determinism and limits", () => {
  test("the same code makes the same ops (seeded random, fixed date)", async () => {
    const code = `for (let i = 0; i < 3; i++) Insert("root", {type: "frame", name: String(Math.random()) + Date.now() + new Date().getTime()})`
    const a = await session(code)
    const b = await session(code)
    expect(a.out.ops).toEqual(b.out.ops)
    expect(JSON.stringify(a.out.ops)).toContain("00") // Date.now() is 0
    a.s.dispose()
    b.s.dispose()
  })

  test("a run is interrupted at its deadline", async () => {
    const s = await inProcessRunner().open({}, {}, { ...DEFAULT_LIMITS, timeMs: 200 })
    const t = Date.now()
    const out = await s.run("while (true) {}")
    expect(Date.now() - t).toBeLessThan(2000)
    expect(out.result).toMatchObject({ ok: false, message: "The script ran longer than 200 ms." })
    // The session survives and runs the next statements.
    expect((await s.run("Print(1)")).prints).toEqual(["1"])
    s.dispose()
  })

  test("memory, stack, ops, argument and print limits", async () => {
    const limits = {
      ...DEFAULT_LIMITS,
      memoryBytes: 8 * 1024 * 1024,
      maxOps: 5,
      maxPrints: 2,
      maxPrintChars: 10,
      maxArgBytes: 1000,
    }
    const s = await inProcessRunner().open({}, {}, limits)
    const oom = await s.run("const big = []; while (true) big.push(new Array(10000).fill(7))")
    expect((oom.result as { message: string }).message).toMatch(/out of memory/)
    const deep = await s.run("function f(n) { return f(n + 1) + 1 } f(0)")
    expect((deep.result as { message: string }).message).toMatch(/stack|recursion/i)
    const many = await s.run(`for (let i = 0; i < 10; i++) Insert("root", {type: "frame"})`)
    expect((many.result as { message: string }).message).toContain("More than 5 ops")
    const arg = await s.run(`Update("abcdefghij", {name: "x".repeat(5000)})`)
    expect((arg.result as { message: string }).message).toContain("over 1000 bytes")
    const pr = await s.run(`Print("0123456789abc"); Print("more"); Print("x")`)
    expect(pr.prints).toEqual(["0123456789…"])
    s.dispose()
  })

  test("argument depth, total time across streamed runs, and restored code are bounded", async () => {
    const s = await inProcessRunner().open(
      {},
      {},
      { ...DEFAULT_LIMITS, timeMs: 300, totalTimeMs: 500 },
    )
    const deep = await s.run(
      `let o = {}; for (let i = 0; i < 100; i++) o = {a: o}; Update("abcdefghij", {meta: o})`,
    )
    expect((deep.result as { message: string }).message).toContain("nest deeper than 64")
    await s.run("const t0 = 1; for (let i = 0; i < 1e9; i++) {}")
    const rest = await s.run("for (let i = 0; i < 1e9; i++) {}")
    expect((rest.result as { message: string }).message).toContain("500 ms in all")
    s.dispose()
    // A carried "function" whose source would hang is stopped at the deadline.
    const t = Date.now()
    const bad = await inProcessRunner().open(
      {},
      { f: { fn: "(() => { while (true) {} })()" } },
      { ...DEFAULT_LIMITS, timeMs: 200 },
    )
    expect(Date.now() - t).toBeLessThan(3000)
    expect((await bad.run("Print(typeof f)")).prints).toEqual(["undefined"])
    bad.dispose()
    // Carried sources come from Function.prototype.toString, not a script's own toString.
    const { s: s2 } = await session(`function g() { return 1 }; g.toString = () => "while(true){}"`)
    expect((await s2.carry(["g"], {})).g).toEqual({ fn: "function g() { return 1 }" })
    s2.dispose()
  })

  test("the sandbox has no host access", async () => {
    const { s, out } =
      await session(`Print(typeof process, typeof require, typeof fetch, typeof setTimeout,
  typeof __kimo, typeof globalThis.Bun, typeof XMLHttpRequest, typeof importScripts);
let escaped = "no";
try { escaped = String(Insert.constructor("return typeof process")()) } catch (e) { escaped = "threw" }
Print(escaped)`)
    expect(out.result).toEqual({ ok: true })
    expect(out.prints[0]).toBe(
      "undefined undefined undefined undefined undefined undefined undefined undefined",
    )
    expect(out.prints[1]).toBe("undefined")
    s.dispose()
  })

  test("a script reaches the host only through the API; host prototypes are never touched", async () => {
    // Replacing an API function only changes the script's own binding: the host function is
    // held by the prelude's closure, deleted from globalThis before any script runs.
    const { s, out } =
      await session(`Object.defineProperty(globalThis, "Op", { value: () => "mine" })
Print(typeof __kimo, Op())
Object.prototype.polluted = 1
Insert("root", JSON.parse('{"type":"frame","__proto__":{"polluted":2},"constructor":{"prototype":{"polluted":3}}}'))`)
    expect(out.prints).toEqual(["undefined mine"])
    expect(({} as { polluted?: number }).polluted).toBeUndefined()
    expect(out.ops).toHaveLength(1)
    const op = out.ops[0] as { node: Record<string, unknown> }
    expect(Object.getPrototypeOf(op.node)).toBe(Object.prototype)
    expect(Object.hasOwn(op.node, "__proto__")).toBe(true)
    s.dispose()
  })

  test("a polluting script's ops fail validation; nothing lands", async () => {
    const t = setup()
    const docId = await newDoc(t.conn)
    const r = failed(
      await call(t.conn, "kimo_script", {
        docId,
        code: `Insert("root", JSON.parse('{"type":"frame","__proto__":{"x":1}}'))`,
      }),
    )
    expect(r.errors[0]?.message).toMatch(/^line 1:/)
    expect(({} as { x?: number }).x).toBeUndefined()
    t.dispose()
  })
})

describe("kimo_script through the runtime", () => {
  test("applies as one undo step with names and prints; created keys are left out", async () => {
    const t = setup()
    const docId = await newDoc(t.conn)
    const r = ok(await call(t.conn, "kimo_script", { docId, code: PRICING }))
    expect(r.summary).toBe("Applied the script's 8 op(s): 8 inserted, 0 updated, 0 deleted.")
    const data = r.data as { names: { name: string; id: string }[]; prints: string[] }
    expect(data.prints).toEqual(["plans 2"])
    expect(data.names.map((n) => n.name)).toEqual([
      "Pricing",
      "Plans",
      "Free card",
      "Free",
      "Pro card",
      "Pro",
    ])
    expect((r as { created?: unknown }).created).toBeUndefined()
    expect(r.undoToken).toBeDefined()
    ok(await call(t.conn, "kimo_history", { docId, action: "undo" }))
    const q = await nodes(t.conn, docId)
    expect(JSON.stringify(q.data)).not.toContain("Pricing")
    t.dispose()
  })

  test("a script error fails with its line, applies nothing, and patch-retry fixes the code", async () => {
    const t = setup()
    const docId = await newDoc(t.conn)
    const bad = PRICING.replace('fill: "#F4F4F5"', "fill: 42")
    const r = failed(await call(t.conn, "kimo_script", { docId, code: bad }))
    expect(r.errors[0]?.message).toMatch(/^line 5: /)
    const retryId = (r as { retryId?: string }).retryId as string
    expect(retryId).toBeDefined()
    expect(JSON.stringify((await nodes(t.conn, docId)).data)).not.toContain("Pricing")
    const fixed = ok(
      await call(t.conn, "kimo_script", {
        docId,
        retryId,
        edits: [{ find: "fill: 42", replace: 'fill: "#EEEEEE"' }],
      }),
    )
    expect((fixed.data as { inserted: number }).inserted).toBe(8)
    const thrown = failed(await call(t.conn, "kimo_script", { docId, code: "const a = 1\nnull.x" }))
    expect(thrown.errors[0]).toMatchObject({ code: "INVALID_INPUT", path: "code" })
    expect(thrown.errors[0]?.message).toMatch(/^line 2: TypeError/)
    t.dispose()
  })

  test("top-level names carry to the next script with refs turned into ids", async () => {
    const t = setup()
    const docId = await newDoc(t.conn)
    const first = ok(await call(t.conn, "kimo_script", { docId, code: PRICING }))
    const plans = (first.data as { names: { name: string; id: string }[] }).names.find(
      (n) => n.name === "Plans",
    )?.id
    const r = ok(
      await call(t.conn, "kimo_script", { docId, code: `card("Team", "$99"); Print(row)` }),
    )
    expect((r.data as { prints: string[] }).prints).toEqual([plans as string])
    expect((r.data as { inserted: number }).inserted).toBe(3)
    // Another agent does not see them.
    const other = setup()
    const r2 = failed(await call(other.conn, "kimo_script", { docId, code: `card("X", "$1")` }))
    expect(r2.errors[0]?.code).toBeDefined()
    other.dispose()
    t.dispose()
  })

  test("a script that only reads makes no op group", async () => {
    const t = setup()
    const docId = await newDoc(t.conn)
    const r = ok(
      await call(t.conn, "kimo_script", {
        docId,
        code: `const top = () => Children("root").length\nPrint(top())`,
      }),
    )
    expect(r.undoToken).toBeUndefined()
    expect((r.data as { prints: string[] }).prints).toEqual(["0"])
    // Its helpers still carry to the next script.
    const r2 = ok(await call(t.conn, "kimo_script", { docId, code: `Print(typeof top)` }))
    expect((r2.data as { prints: string[] }).prints).toEqual(["function"])
    t.dispose()
  })

  test("approvals see the compiled ops; a denied delete applies nothing", async () => {
    const t = setup({ confirmDestructive: true })
    const docId = await newDoc(t.conn)
    ok(await call(t.conn, "kimo_script", { docId, code: PRICING }))
    expect(t.asked).toEqual([])
    const r = failed(await call(t.conn, "kimo_script", { docId, code: `Delete(row)` }))
    expect(r.errors[0]?.code).toBe("PERMISSION_DENIED")
    expect(t.asked).toHaveLength(1)
    expect(t.asked[0]?.tool).toBe("kimo_script")
    expect(t.asked[0]?.reason).toMatchObject({ kind: "destructive", ops: ["delete"] })
    // The prompt's target list is a dry run of the compiled ops (the deleted row and its cards).
    expect(t.asked[0]?.preview?.nodeIds?.length).toBeGreaterThan(0)
    expect(JSON.stringify((await nodes(t.conn, docId)).data)).toContain("Plans")
    t.dispose()
  })

  test("an edit-level agent cannot delete through a script", async () => {
    const t = setup({ level: "edit", onExceed: "deny" })
    const docId = await newDoc(t.conn)
    ok(await call(t.conn, "kimo_script", { docId, code: PRICING }))
    const r = failed(await call(t.conn, "kimo_script", { docId, code: `Delete(row)` }))
    expect(r.errors[0]?.code).toBe("PERMISSION_DENIED")
    t.dispose()
  })

  test("a read-only agent is refused before its script runs", async () => {
    const t = setup()
    const docId = await newDoc(t.conn)
    const reader = t.host.runtime.connect(
      { client: "reader", label: "Reader", transport: "in-process" },
      { policy: { ...DEFAULT_POLICY, files: ["**"], level: "read", onExceed: "deny" } },
    )
    const r = failed(await call(reader, "kimo_script", { docId, code: "while (true) {}" }))
    expect(r.errors[0]?.code).toBe("PERMISSION_DENIED")
    t.dispose()
  })

  test("node scopes apply to the compiled ops", async () => {
    const t = setup()
    const docId = await newDoc(t.conn)
    const r = ok(await call(t.conn, "kimo_script", { docId, code: PRICING }))
    const plans = (r.data as { names: { name: string; id: string }[] }).names.find(
      (n) => n.name === "Plans",
    )?.id as string
    const child = t.host.runtime.connect(
      { client: "child", label: "Child", transport: "in-process" },
      {
        policy: {
          ...DEFAULT_POLICY,
          files: ["**"],
          level: "edit",
          nodes: [plans],
          onExceed: "deny",
        },
      },
    )
    ok(
      await call(child, "kimo_script", {
        docId,
        code: `Insert(${JSON.stringify(plans)}, {type: "text", content: "In scope", fill: "#111111"})`,
      }),
    )
    const out = failed(
      await call(child, "kimo_script", {
        docId,
        code: `Insert("root", {type: "frame", name: "Outside"})`,
      }),
    )
    expect(out.errors[0]?.code).toBe("OUT_OF_SCOPE")
    t.dispose()
  })

  test("batch limit counts compiled inserts; copies are free", async () => {
    const t = setup()
    const docId = await newDoc(t.conn)
    const r = failed(
      await call(t.conn, "kimo_script", {
        docId,
        code: `for (let i = 0; i < 41; i++) Insert("root", {type: "frame", name: "F" + i, x: i * 10, y: 0, w: 5, h: 5})`,
      }),
    )
    expect(r.errors[0]?.code).toBe("BATCH_TOO_LARGE")
    ok(
      await call(t.conn, "kimo_script", {
        docId,
        code: `const a = Insert("root", {type: "frame", name: "A", x: 0, y: 0, w: 5, h: 5})
for (let i = 0; i < 60; i++) Copy(a, "root", {x: 10 * i + 10})`,
      }),
    )
    t.dispose()
  })
})

describe("streamed kimo_script", () => {
  async function feed(conn: McpConnection, callId: string, json: string, chunk = 9) {
    const s = conn.openStream(callId, "kimo_script")
    if (!(s instanceof ScriptStream)) throw new Error("no script stream")
    const seen: number[] = []
    s.onProgress((p) => seen.push(p.applied))
    for (let i = 0; i < json.length; i += chunk) {
      s.feed(json.slice(i, i + chunk))
      await s.settled()
    }
    return { s, seen }
  }

  test("statements land while the code streams; the call commits them as one undo step", async () => {
    const t = setup()
    const docId = await newDoc(t.conn)
    const input = { docId, code: PRICING }
    const { s, seen } = await feed(t.conn, "toolu_1", JSON.stringify(input))
    // The page and its row landed before the card loop finished streaming.
    expect(seen[0]).toBe(1)
    expect(seen.at(-1)).toBe(8)
    const r = ok(await call(t.conn, "kimo_script", input, "toolu_1"))
    expect(s.progress().state).toBe("committed")
    expect((r.data as { inserted: number }).inserted).toBe(8)
    ok(await call(t.conn, "kimo_history", { docId, action: "undo" }))
    expect(JSON.stringify((await nodes(t.conn, docId)).data)).not.toContain("Pricing")
    t.dispose()
  })

  test("a call whose code differs rolls the stream back and runs normally", async () => {
    const t = setup()
    const docId = await newDoc(t.conn)
    const { s } = await feed(t.conn, "toolu_2", JSON.stringify({ docId, code: PRICING }))
    const other = PRICING.replace('"Pricing"', '"Prices"')
    const r = ok(await call(t.conn, "kimo_script", { docId, code: other }, "toolu_2"))
    expect(s.progress().state).toBe("rolled-back")
    expect((r.data as { inserted: number }).inserted).toBe(8)
    const text = JSON.stringify((await nodes(t.conn, docId)).data)
    expect(text).toContain("Prices")
    expect(text).not.toContain('"Pricing"')
    t.dispose()
  })

  test("a statement that throws stops the stream; the call fails and rolls back", async () => {
    const t = setup()
    const docId = await newDoc(t.conn)
    const code = `Insert("root", {type: "frame", name: "Kept?", x: 0, y: 0, w: 10, h: 10})\nnull.x\n`
    const { s, seen } = await feed(t.conn, "toolu_3", JSON.stringify({ docId, code }))
    expect(seen).toContain(1)
    const r = failed(await call(t.conn, "kimo_script", { docId, code }, "toolu_3"))
    expect(r.errors[0]?.message).toMatch(/^line 2:/)
    expect(s.progress().state).toBe("rolled-back")
    expect(JSON.stringify((await nodes(t.conn, docId)).data)).not.toContain("Kept?")
    t.dispose()
  })

  test("a delete that needs approval holds the stream; the call asks", async () => {
    const t = setup({ confirmDestructive: true }, "once")
    const docId = await newDoc(t.conn)
    ok(await call(t.conn, "kimo_script", { docId, code: PRICING }))
    const code = `Insert(row, {type: "text", content: "New", fill: "#111111"})\nDelete(row)\n`
    const { s, seen } = await feed(t.conn, "toolu_4", JSON.stringify({ docId, code }))
    expect(seen.at(-1)).toBe(1)
    expect(s.progress().state).toBe("held")
    ok(await call(t.conn, "kimo_script", { docId, code }, "toolu_4"))
    expect(t.asked).toHaveLength(1)
    expect(s.progress().state).toBe("committed")
    t.dispose()
  })

  test("closing a stream whose call never came rolls it back", async () => {
    const t = setup()
    const docId = await newDoc(t.conn)
    await feed(t.conn, "toolu_5", JSON.stringify({ docId, code: PRICING }))
    t.conn.closeStream("toolu_5", "Stopped.")
    expect(JSON.stringify((await nodes(t.conn, docId)).data)).not.toContain("Pricing")
    t.dispose()
  })

  test("the streamed and final runs read the same world", async () => {
    const t = setup()
    const docId = await newDoc(t.conn)
    ok(await call(t.conn, "kimo_script", { docId, code: PRICING }))
    // Children("root") counts top-level layers: the streamed page must not change the answer.
    const code = `const n = Children("root").length\nInsert("root", {type: "frame", name: "Copy " + n, x: 0, y: 900, w: 10, h: 10})\nInsert("root", {type: "frame", name: "Again " + Children("root").length, x: 20, y: 900, w: 10, h: 10})\n`
    const { s } = await feed(t.conn, "toolu_6", JSON.stringify({ docId, code }))
    ok(await call(t.conn, "kimo_script", { docId, code }, "toolu_6"))
    expect(s.progress().state).toBe("committed")
    const text = JSON.stringify((await nodes(t.conn, docId)).data)
    expect(text).toContain("Copy 1")
    expect(text).toContain("Again 1")
    t.dispose()
  })
})

describe("statements and scanning", () => {
  test("complete top-level statements of partial code", () => {
    expect(completePrefix(`const a = Insert("root", {`)).toBe(0)
    expect(completePrefix(`const a = 1;\nconst b = {`)).toBe(12)
    expect(completePrefix(`foo()\nbar(`)).toBe(5)
    expect(completePrefix(`if (a) {\n}\nelse {}\nx()\n`)).toBe(18)
    expect(completePrefix(`const x = a\n  .b()\nfoo()\n`)).toBe(18)
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a template literal in the script source
    expect(completePrefix("const s = `a ${b} c`\nfoo(")).toBe(20)
    expect(completePrefix(`const s = "unterminated`)).toBe(0)
    expect(completePrefix(`for (const x of y) {\n  f(x)\n}\ng()`)).toBe(29)
  })

  test("top-level names", () => {
    expect(
      topLevelNames(
        `const a = 1, {b, c: [d]} = x; let e; var f; function g() { const h = 1 } class K {}\nfor (const i of j) {}`,
      ),
    ).toEqual(["a", "b", "d", "e", "f", "g", "K"])
    expect(topLevelNames("const = ")).toEqual([])
  })

  test("the scanner decodes string fields as they stream, escapes split anywhere", () => {
    const json = JSON.stringify({
      docId: "d_1",
      label: 'x,"y"',
      code: 'a("\\u00e9")\n"q"',
      n: { code: "no" },
    })
    for (let size = 1; size < 6; size++) {
      const s = new TopLevelStrings()
      for (let i = 0; i < json.length; i += size) s.push(json.slice(i, i + size))
      expect(s.values.get("docId")).toEqual({ text: "d_1", done: true })
      expect(s.values.get("code")).toEqual({ text: 'a("\\u00e9")\n"q"', done: true })
      expect(s.values.get("label")?.text).toBe('x,"y"')
    }
    const bad = new TopLevelStrings()
    bad.push("[1]")
    expect(bad.failed).toBe(true)
  })

  test("carried refs that named nothing become null", () => {
    expect(
      resolveRefs('{"a":"@s1","b":"@s2/X1","c":"@s9","d":"@s1x"}', { s1: "ID1", "s2/X1": "ID2" }),
    ).toBe('{"a":"ID1","b":"ID2","c":null,"d":"@s1x"}')
  })

  test("carry keeps data and functions within the size bound", async () => {
    const { s } = await session(
      `const a = 1; const big = "x".repeat(100000); function f() { return a + 1 }; const r = Insert("root", {type: "frame"})`,
    )
    const carry = await s.carry(["a", "big", "f", "r", "missing"], { s1: "NODE1" })
    expect(Object.keys(carry).sort()).toEqual(["a", "f", "r"])
    expect(carry.r).toEqual({ json: '"NODE1"' })
    s.dispose()
    const next = await inProcessRunner().open({}, carry)
    const out = await next.run(`Print(f(), r); const a = 5; Print(a)`)
    expect(out.prints).toEqual(["2 NODE1", "5"])
    next.dispose()
  })
})

describe("worker runner", () => {
  test("runs sessions in a worker", async () => {
    const runner = workerRunner(
      () =>
        new Worker(new URL("../src/script/worker.ts", import.meta.url), {
          type: "module",
        }) as never,
    )
    const s = await runner.open({}, {}, DEFAULT_LIMITS)
    const out = await s.run(`Insert("root", {type: "frame", name: "W"}); Print("hi")`)
    expect(out.result).toEqual({ ok: true })
    expect(out.ops).toHaveLength(1)
    expect(out.prints).toEqual(["hi"])
    const loop = await (await runner.open({}, {}, { ...DEFAULT_LIMITS, timeMs: 100 })).run(
      "for(;;){}",
    )
    expect(loop.result).toMatchObject({ ok: false })
    s.dispose()
    runner.dispose?.()
  })

  test("a worker that never answers is terminated after the deadline", async () => {
    let terminated = 0
    const runner = workerRunner(() => {
      const w = {
        onmessage: null as ((e: { data: unknown }) => void) | null,
        onerror: null,
        postMessage(m: { t: string; id: number }) {
          // Opens answer; runs hang.
          if (m.t === "open")
            queueMicrotask(() => w.onmessage?.({ data: { id: m.id, ok: true, value: null } }))
        },
        terminate() {
          terminated++
        },
      }
      return w
    })
    const s = await runner.open({}, {}, { ...DEFAULT_LIMITS, timeMs: 10 })
    const out = await s.run("1")
    expect(out.result).toMatchObject({ ok: false })
    expect((out.result as { message: string }).message).toContain("worker was stopped")
    expect(terminated).toBe(1)
  }, 10_000)
})

test("ScriptSession can be built directly (worker parity)", async () => {
  const { loadNodeQuickJS } = await import("../src/script/runner")
  const s = new ScriptSession(await loadNodeQuickJS(), {})
  expect(s.run(`Insert("root", {type: "frame"})`).ops).toHaveLength(1)
  s.dispose()
})
