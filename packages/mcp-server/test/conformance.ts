/**
 * Host conformance suite (ADR 0013 §10): the behaviours every DocumentHost + handler set must
 * show, run against the headless memory host (this package) and the desktop document host
 * (apps/web/test/host.test.ts, memory platform). Each case of {@link CONFORMANCE_CASES} has an
 * implementation below; `describeHostConformance` runs them all for one harness.
 */
import { describe, expect, test } from "bun:test"
import { inflateSync } from "node:zlib"
import type { RevisionToken, ToolFailure, ToolResult, ToolSuccess } from "../src/envelope"
import {
  type ApprovalOutcome,
  type DocumentHost,
  dispatch,
  type HandlerOutput,
  type ToolContext,
  type ToolHandlers,
} from "../src/index"
import { ASK_POLICY, type ClientPolicy, emptyAllowances, HEADLESS_POLICY } from "../src/policy"
import { TOOLS } from "../src/registry"
import { validateInput } from "../src/server"

export interface ConformanceHarness {
  host: DocumentHost
  handlers: ToolHandlers
  /** Writes a file the host may open (temp dir). */
  writeFile(path: string, text: string): Promise<void>
  readFile(path: string): Promise<string | null>
  dispose(): Promise<void>
  /** Absolute directory for the suite's files (default `/conformance`). */
  root?: string
  /** Another live process takes the lease of `path`. */
  setForeignLease?(path: string, holder: { pid: number; app: string; appLabel: string }): void
  /** True for headless `kimo mcp` hosts (lease suggestions differ). */
  headless?: boolean
}

export const CONFORMANCE_CASES = [
  // Targeting (11.1)
  "every document tool without docId fails INVALID_INPUT (no active-document fallback)",
  "a stale docId fails DOCUMENT_NOT_OPEN with detail.currentDocId",
  // No-overwrite (M5 exit criterion)
  "kimo_create on an existing path fails FILE_EXISTS and leaves the file byte-identical",
  "kimo_open of an unparsable file fails LOAD_FAILED and never writes it, even after edits/save attempts",
  "kimo_save of a read-only (newer format) document fails READ_ONLY and leaves the file untouched",
  "kimo_export never overwrites without overwrite=true (FILE_EXISTS)",
  "kimo_save reports bytes/sha256 only after read-back matched",
  // Concurrency (11.4)
  "kimo_apply_ops with a stale baseRevision fails REVISION_CONFLICT with current revision and changed ids",
  "a baseRevision from another epoch fails REVISION_CONFLICT",
  "dryRun returns ops/inverse/warnings and leaves the revision unchanged",
  "a failing op rolls back the whole call (rolledBack: true, revision unchanged)",
  "@key references resolve within one call and created lists every key",
  // Attribution and undo
  "edits carry origin mcp:<client>.<session>; kimo_history list shows it",
  "kimo_history undo never undoes the user's or another client's edits",
  "kimo_history undo with a non-top token fails without changing anything",
  // Leases (9.4)
  "kimo_open of a file leased by another live process fails DOCUMENT_LOCKED with holder",
  "headless: a lease held by the desktop app suggests attaching",
  // Render
  "kimo_render after kimo_apply_ops in the same turn shows the committed change",
  // Approvals
  "a destructive op with no approver (headless) is denied per policy, not silently applied",
] as const

export type ConformanceCase = (typeof CONFORMANCE_CASES)[number]

// --- Client helper -----------------------------------------------------------------------------

export interface TestClient {
  ctx: ToolContext
  call<T = Record<string, unknown>>(
    tool: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult<T>>
  raw(tool: string, input: Record<string, unknown>): Promise<HandlerOutput>
}

let sessionSeq = 0

/** A client calling through the real dispatcher (validation, authorize, approvals). */
export function testClient(
  h: ConformanceHarness,
  opts: {
    client?: string
    policy?: Partial<ClientPolicy>
    approve?: ApprovalOutcome
    headless?: boolean
  } = {},
): TestClient {
  const client = opts.client ?? "claude-code"
  const session = `s${(++sessionSeq).toString(36).padStart(5, "0")}`
  const base = opts.headless ? HEADLESS_POLICY : ASK_POLICY
  const ctx: ToolContext = {
    identity: { client, label: client, session, transport: "in-process" },
    origin: `mcp:${client}.${session}`,
    policy: { ...base, files: ["**"], grants: [...base.grants, "files.create"], ...opts.policy },
    allowances: emptyAllowances(),
    host: h.host,
    requestApproval: async () => opts.approve ?? "deny",
    recordActivity: () => {},
    signal: new AbortController().signal,
    now: () => Date.now(),
    newId: () => Math.random().toString(36).slice(2, 12),
  }
  const raw = (tool: string, input: Record<string, unknown>) =>
    dispatch(tool, input, ctx, h.handlers, {
      validate: validateInput,
      targets: async (def, i) => {
        const t: { path?: string; pathAlreadyOpen?: boolean } = {}
        if (typeof i.docId === "string") {
          const r = h.host.get(i.docId)
          if (r.ok) {
            t.path = r.value.ref.path
            t.pathAlreadyOpen = true
          }
        }
        const f = def.name === "kimo_export" ? i.outDir : i.path
        if (typeof f === "string" && def.doc !== "required") t.path = await h.host.canonicalPath(f)
        return t
      },
    })
  return {
    ctx,
    raw,
    call: async <T>(tool: string, input: Record<string, unknown>) =>
      (await raw(tool, input)).result as ToolResult<T>,
  }
}

export function expectOk<T>(r: ToolResult<T>): ToolSuccess<T> {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.errors)}`)
  return r
}
export function expectFail(r: ToolResult<unknown>, code: string): ToolFailure {
  if (r.ok) throw new Error(`expected ${code}, got ok: ${r.summary}`)
  expect(r.errors.map((e) => e.code)).toContain(code as never)
  expect(r.rolledBack).toBe(true)
  return r
}

const DOC = (nodes: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify(
    {
      $schema: "https://getkimo.design/schema/kimo-1.0.json",
      format: "1.0.0",
      ...extra,
      nodes: {
        Board00001: {
          type: "frame",
          parent: null,
          order: "a0",
          name: "Board",
          x: 0,
          y: 0,
          w: 200,
          h: 100,
          fill: "#FFFFFF",
        },
        ...nodes,
      },
    },
    null,
    2,
  )}\n`

let fileSeq = 0
async function openFixture(h: ConformanceHarness, c: TestClient, text = DOC()) {
  const path = `${h.root ?? "/conformance"}/f${++fileSeq}.kimo`
  await h.writeFile(path, text)
  const r = expectOk(
    await c.call<{ doc: { id: string }; revision: RevisionToken }>("kimo_open", { path }),
  )
  return { path, docId: r.data.doc.id, revision: r.data.revision }
}

const insertRect = (key: string, fill = "#FF0000", extra: Record<string, unknown> = {}) => ({
  op: "insert",
  key,
  parent: "Board00001",
  node: { type: "rect", name: key, x: 0, y: 0, w: 200, h: 100, fill, ...extra },
})

// --- Tiny PNG decoder (8-bit RGB/RGBA, non-interlaced) -----------------------------------------

export function decodePng(b64: string): {
  w: number
  h: number
  at(x: number, y: number): number[]
} {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const dv = new DataView(bytes.buffer)
  let i = 8
  let w = 0
  let h = 0
  let ct = 6
  const idat: Uint8Array[] = []
  while (i < bytes.length) {
    const len = dv.getUint32(i)
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8))
    const data = bytes.subarray(i + 8, i + 8 + len)
    if (type === "IHDR") {
      w = dv.getUint32(i + 8)
      h = dv.getUint32(i + 12)
      ct = bytes[i + 17] as number
    } else if (type === "IDAT") idat.push(data)
    i += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat.map((d) => Buffer.from(d))))
  const bpp = ct === 6 ? 4 : 3
  const stride = w * bpp
  const px = new Uint8Array(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)] as number
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] as number
      const a = x >= bpp ? (px[y * stride + x - bpp] as number) : 0
      const b = y > 0 ? (px[(y - 1) * stride + x] as number) : 0
      const c = x >= bpp && y > 0 ? (px[(y - 1) * stride + x - bpp] as number) : 0
      let p = v
      if (f === 1) p = v + a
      else if (f === 2) p = v + b
      else if (f === 3) p = v + ((a + b) >> 1)
      else if (f === 4) {
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      px[y * stride + x] = p & 255
    }
  }
  return { w, h, at: (x, y) => [...px.subarray(y * stride + x * bpp, y * stride + x * bpp + bpp)] }
}

// --- Cases -------------------------------------------------------------------------------------

type Impl = (h: ConformanceHarness) => Promise<void>

const CASES: Record<ConformanceCase, Impl> = {
  "every document tool without docId fails INVALID_INPUT (no active-document fallback)": async (
    h,
  ) => {
    const c = testClient(h)
    await openFixture(h, c)
    for (const def of TOOLS.filter((t) => t.doc === "required")) {
      const r = await c.call(def.name, {})
      const f = expectFail(r, "INVALID_INPUT")
      expect(JSON.stringify(f.errors)).toContain("docId")
    }
  },

  "a stale docId fails DOCUMENT_NOT_OPEN with detail.currentDocId": async (h) => {
    const c = testClient(h)
    const { docId } = await openFixture(h, c)
    const d = h.host.get(docId)
    if (!d.ok) throw new Error("not open")
    // A reload (external change, host restart) mints a new epoch.
    d.value.store.loadDocument(d.value.store.toDocument())
    const f = expectFail(
      await c.call("kimo_query", { docId, select: { topLevel: true } }),
      "DOCUMENT_NOT_OPEN",
    )
    const current = f.errors[0]?.detail?.currentDocId as string
    expect(current).toBeString()
    expect(current).not.toBe(docId)
    expectOk(await c.call("kimo_query", { docId: current, select: { topLevel: true } }))
    // Unknown ids never fall back.
    expectFail(
      await c.call("kimo_query", { docId: "d_0000000000000000_zzzz", select: { topLevel: true } }),
      "DOCUMENT_NOT_OPEN",
    )
  },

  "kimo_create on an existing path fails FILE_EXISTS and leaves the file byte-identical": async (
    h,
  ) => {
    const c = testClient(h)
    const path = `${h.root ?? "/conformance"}/existing.kimo`
    const text = DOC()
    await h.writeFile(path, text)
    expectFail(await c.call("kimo_create", { path, template: "web" }), "FILE_EXISTS")
    expect(await h.readFile(path)).toBe(text)
    const fresh = `${h.root ?? "/conformance"}/fresh-${Date.now()}.kimo`
    const r = expectOk(
      await c.call<{ sha256: string; bytes: number }>("kimo_create", {
        path: fresh,
        template: "web",
        name: "Fresh",
      }),
    )
    const back = await h.readFile(fresh)
    expect(back).not.toBeNull()
    expect(r.data.bytes).toBe(new TextEncoder().encode(back as string).length)
  },

  "kimo_open of an unparsable file fails LOAD_FAILED and never writes it, even after edits/save attempts":
    async (h) => {
      const c = testClient(h)
      const path = `${h.root ?? "/conformance"}/broken.kimo`
      const text = '{"format": "1.0.0", "nodes": {<<<<<<< HEAD\n'
      await h.writeFile(path, text)
      expectFail(await c.call("kimo_open", { path }), "LOAD_FAILED")
      expect(h.host.list().some((d) => d.ref.path === path)).toBe(false)
      expectFail(await c.call("kimo_open", { path }), "LOAD_FAILED")
      await new Promise((r) => setTimeout(r, 30))
      expect(await h.readFile(path)).toBe(text)
    },

  "kimo_save of a read-only (newer format) document fails READ_ONLY and leaves the file untouched":
    async (h) => {
      const c = testClient(h)
      const text = DOC(
        {},
        { $schema: "https://getkimo.design/schema/kimo-1.9.json", format: "1.9.0" },
      )
      const { path, docId } = await openFixture(h, c, text)
      const open = h.host.get(docId)
      expect(open.ok && open.value.ref.readOnly).toBe(true)
      expectFail(await c.call("kimo_save", { docId }), "READ_ONLY")
      expectFail(await c.call("kimo_apply_ops", { docId, ops: [insertRect("r")] }), "READ_ONLY")
      expect(await h.readFile(path)).toBe(text)
    },

  "kimo_export never overwrites without overwrite=true (FILE_EXISTS)": async (h) => {
    const c = testClient(h)
    const { docId } = await openFixture(h, c)
    const outDir = `${h.root ?? "/conformance"}/out-${++fileSeq}`
    const target = `${outDir}/Board00001.kimo`
    await h.writeFile(target, "keep me")
    expectFail(
      await c.call("kimo_export", { docId, target: "kimo", ids: ["Board00001"], outDir }),
      "FILE_EXISTS",
    )
    expect(await h.readFile(target)).toBe("keep me")
    const r = expectOk(
      await c.call<{ files: { path: string; sha256: string }[] }>("kimo_export", {
        docId,
        target: "kimo",
        ids: ["Board00001"],
        outDir,
        overwrite: true,
      }),
    )
    expect(r.data.files[0]?.path).toBe(target)
    expect(await h.readFile(target)).toContain('"Board00001"')
    // Code targets (M7): an identical file is unchanged, a different one blocks the batch.
    const call = () =>
      c.call<{ files: { path: string; unchanged?: boolean }[] }>("kimo_export", {
        docId,
        target: "html-css",
        ids: ["Board00001"],
        outDir: `${outDir}/web`,
      })
    const first = expectOk(await call())
    expect(first.data.files.map((f) => f.path.slice(outDir.length + 1)).sort()).toEqual([
      "web/index.html",
      "web/styles.css",
      "web/tokens.css",
    ])
    expect(first.data.files.every((f) => !f.unchanged)).toBe(true)
    const again = expectOk(await call())
    expect(again.data.files.every((f) => f.unchanged === true)).toBe(true)
    await h.writeFile(`${outDir}/web/styles.css`, "/* mine */")
    expectFail(await call(), "FILE_EXISTS")
    expect(await h.readFile(`${outDir}/web/styles.css`)).toBe("/* mine */")
  },

  "kimo_save reports bytes/sha256 only after read-back matched": async (h) => {
    const c = testClient(h)
    const { path, docId } = await openFixture(h, c)
    expectOk(await c.call("kimo_apply_ops", { docId, ops: [insertRect("r")] }))
    const r = expectOk(
      await c.call<{ bytes: number; sha256: string; path: string }>("kimo_save", { docId }),
    )
    const back = (await h.readFile(path)) as string
    expect(r.data.path).toBe(path)
    expect(r.data.bytes).toBe(new TextEncoder().encode(back).length)
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(back))
    expect(r.data.sha256).toBe(
      [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""),
    )
    expect(back).toContain('"rect"')
    const state = h.host.get(docId)
    expect(state.ok && state.value.ref.dirty).toBe(false)
  },

  "kimo_apply_ops with a stale baseRevision fails REVISION_CONFLICT with current revision and changed ids":
    async (h) => {
      const c = testClient(h)
      const { docId, revision } = await openFixture(h, c)
      const a = expectOk(
        await c.call("kimo_apply_ops", { docId, ops: [insertRect("a")], baseRevision: revision }),
      )
      const aId = a.created?.[0]?.id as string
      const b = expectOk(
        await c.call("kimo_apply_ops", {
          docId,
          ops: [{ op: "update", id: aId, set: { name: "moved" } }],
          baseRevision: a.revision?.after,
        }),
      )
      const f = expectFail(
        await c.call("kimo_apply_ops", {
          docId,
          ops: [{ op: "update", id: aId, set: { name: "x" } }],
          baseRevision: a.revision?.after,
        }),
        "REVISION_CONFLICT",
      )
      const detail = f.errors[0]?.detail as unknown as { current: RevisionToken; changed: string[] }
      expect(detail.current).toEqual(b.revision?.after as RevisionToken)
      expect(detail.changed).toContain(aId)
      expect(f.revision?.after).toEqual(b.revision?.after as RevisionToken)
      // Without baseRevision the write applies.
      expectOk(
        await c.call("kimo_apply_ops", {
          docId,
          ops: [{ op: "update", id: aId, set: { name: "y" } }],
        }),
      )
    },

  "a baseRevision from another epoch fails REVISION_CONFLICT": async (h) => {
    const c = testClient(h)
    const { docId, revision } = await openFixture(h, c)
    expectFail(
      await c.call("kimo_apply_ops", {
        docId,
        ops: [insertRect("a")],
        baseRevision: { epoch: "otherepoch", seq: revision.seq },
      }),
      "REVISION_CONFLICT",
    )
  },

  "dryRun returns ops/inverse/warnings and leaves the revision unchanged": async (h) => {
    const c = testClient(h)
    const { docId, revision } = await openFixture(h, c)
    const before = h.host.get(docId)
    const size = before.ok ? before.value.store.size : 0
    const r = expectOk(
      await c.call("kimo_apply_ops", { docId, ops: [insertRect("a")], dryRun: true }),
    )
    expect(r.dryRun).toBe(true)
    expect(r.ops?.length).toBeGreaterThan(0)
    expect(r.inverse?.length).toBeGreaterThan(0)
    expect(Array.isArray(r.warnings)).toBe(true)
    expect(r.revision?.after).toEqual(revision)
    expect(r.undoToken).toBeUndefined()
    const after = h.host.get(docId)
    expect(after.ok && after.value.store.size).toBe(size)
    expect(after.ok && after.value.store.revision).toEqual(revision)
  },

  "a failing op rolls back the whole call (rolledBack: true, revision unchanged)": async (h) => {
    const c = testClient(h)
    const { docId, revision } = await openFixture(h, c)
    const f = expectFail(
      await c.call("kimo_apply_ops", {
        docId,
        ops: [insertRect("a"), { op: "update", id: "Missing0001", set: { name: "x" } }],
      }),
      "NODE_NOT_FOUND",
    )
    expect(f.errors[0]?.path).toBe("ops[1]")
    expect(f.revision?.after).toEqual(revision)
    const d = h.host.get(docId)
    expect(d.ok && d.value.store.size).toBe(1)
    // A schema violation in the final group also rolls back everything.
    expectFail(
      await c.call("kimo_apply_ops", {
        docId,
        ops: [insertRect("b"), { op: "update", id: "Board00001", set: { w: "wide" } }],
      }),
      "SCHEMA_VIOLATION",
    )
    expect(
      h.host.get(docId).ok &&
        (h.host.get(docId) as { value: { store: { size: number } } }).value.store.size,
    ).toBe(1)
  },

  "@key references resolve within one call and created lists every key": async (h) => {
    const c = testClient(h)
    const { docId } = await openFixture(h, c)
    const r = expectOk(
      await c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "insert",
            key: "hero",
            parent: "root",
            node: { type: "frame", name: "Hero", x: 400, y: 0, w: 300, h: 200 },
          },
          { op: "insert", key: "title", parent: "@hero", node: { type: "text", content: "Hello" } },
          { op: "update", id: "@hero", set: { name: "Hero 2" } },
          { op: "copy", id: "@hero", key: "hero2", parent: "root", set: { x: 800 } },
        ],
      }),
    )
    const keys = Object.fromEntries((r.created ?? []).map((x) => [x.key, x.id]))
    // A copy also lists the copies of its top levels as `<copy key>/<original id>`.
    expect(Object.keys(keys).sort()).toEqual(["hero", "hero2", `hero2/${keys.title}`, "title"])
    const d = h.host.get(docId)
    if (!d.ok) throw new Error()
    expect(d.value.store.getNode(keys.title as string)?.parent).toBe(keys.hero as string)
    expect(d.value.store.getNode(keys.hero as string)?.name).toBe("Hero 2")
    expect(d.value.store.children(keys.hero2 as string)).toEqual([
      keys[`hero2/${keys.title}`] as string,
    ])
    expectFail(
      await c.call("kimo_apply_ops", {
        docId,
        ops: [{ op: "update", id: "@nope", set: { name: "x" } }],
      }),
      "INVALID_INPUT",
    )
  },

  "edits carry origin mcp:<client>.<session>; kimo_history list shows it": async (h) => {
    const c = testClient(h, { client: "codex" })
    const { docId } = await openFixture(h, c)
    const r = expectOk(
      await c.call("kimo_apply_ops", { docId, ops: [insertRect("a")], label: "Add a" }),
    )
    const list = expectOk(
      await c.call<{ entries: { origin: string; label?: string; undoToken?: string }[] }>(
        "kimo_history",
        { docId, action: "list" },
      ),
    )
    const top = list.data.entries[0]
    expect(top?.origin).toBe(c.ctx.origin)
    expect(c.ctx.origin).toMatch(/^mcp:codex\.[a-z0-9]+$/)
    expect(top?.label).toBe("Add a")
    expect(top?.undoToken).toBe(r.undoToken as string)
  },

  "kimo_history undo never undoes the user's or another client's edits": async (h) => {
    const a = testClient(h, { client: "claude-code" })
    const b = testClient(h, { client: "gemini-cli" })
    const { docId } = await openFixture(h, a)
    const ra = expectOk(await a.call("kimo_apply_ops", { docId, ops: [insertRect("a")] }))
    const d = h.host.get(docId)
    if (!d.ok) throw new Error()
    const store = d.value.store
    const user = store.apply(
      { op: "update", id: "Board00001", set: { name: "User name" } },
      { origin: "user" },
    )
    expect(user.ok).toBe(true)
    const rb = expectOk(
      await b.call("kimo_apply_ops", { docId, ops: [insertRect("b", "#00FF00")] }),
    )
    const u = expectOk(
      await a.call<{ canUndo: boolean }>("kimo_history", { docId, action: "undo" }),
    )
    expect(store.hasNode(ra.created?.[0]?.id as string)).toBe(false)
    expect(store.hasNode(rb.created?.[0]?.id as string)).toBe(true)
    expect(store.getNode("Board00001")?.name).toBe("User name")
    expect(u.data.canUndo).toBe(false)
    expectFail(await a.call("kimo_history", { docId, action: "undo" }), "INVALID_INPUT")
    expect(store.getNode("Board00001")?.name).toBe("User name")
    expect(store.hasNode(rb.created?.[0]?.id as string)).toBe(true)
    // Redo brings back only A's edit.
    expectOk(await a.call("kimo_history", { docId, action: "redo" }))
    expect(store.hasNode(ra.created?.[0]?.id as string)).toBe(true)
  },

  "kimo_history undo with a non-top token fails without changing anything": async (h) => {
    const c = testClient(h)
    const { docId } = await openFixture(h, c)
    const r1 = expectOk(await c.call("kimo_apply_ops", { docId, ops: [insertRect("a")] }))
    const r2 = expectOk(await c.call("kimo_apply_ops", { docId, ops: [insertRect("b")] }))
    const d = h.host.get(docId)
    if (!d.ok) throw new Error()
    const rev = d.value.store.revision
    const f = expectFail(
      await c.call("kimo_history", { docId, action: "undo", token: r1.undoToken }),
      "REVISION_CONFLICT",
    )
    expect(f.errors[0]?.path).toBe("token")
    expect(d.value.store.revision).toEqual(rev)
    expect(d.value.store.hasNode(r2.created?.[0]?.id as string)).toBe(true)
    expectOk(await c.call("kimo_history", { docId, action: "undo", token: r2.undoToken }))
    expect(d.value.store.hasNode(r2.created?.[0]?.id as string)).toBe(false)
    expectOk(await c.call("kimo_history", { docId, action: "undo", token: r1.undoToken }))
    expect(d.value.store.hasNode(r1.created?.[0]?.id as string)).toBe(false)
  },

  "kimo_open of a file leased by another live process fails DOCUMENT_LOCKED with holder": async (
    h,
  ) => {
    if (!h.setForeignLease) throw new Error("harness must implement setForeignLease")
    const c = testClient(h)
    const path = `${h.root ?? "/conformance"}/leased-${++fileSeq}.kimo`
    await h.writeFile(path, DOC())
    h.setForeignLease(path, { pid: 4242, app: "other-tool", appLabel: "Other Tool" })
    const f = expectFail(await c.call("kimo_open", { path }), "DOCUMENT_LOCKED")
    const holder = f.errors[0]?.detail?.holder as { pid: number; appLabel: string }
    expect(holder.pid).toBe(4242)
    expect(holder.appLabel).toBe("Other Tool")
    const ro = expectOk(
      await c.call<{ doc: { readOnly: boolean } }>("kimo_open", { path, readOnly: true }),
    )
    expect(ro.data.doc.readOnly).toBe(true)
  },

  "headless: a lease held by the desktop app suggests attaching": async (h) => {
    if (!h.setForeignLease) throw new Error("harness must implement setForeignLease")
    const c = testClient(h)
    const path = `${h.root ?? "/conformance"}/app-leased-${++fileSeq}.kimo`
    await h.writeFile(path, DOC())
    h.setForeignLease(path, { pid: 777, app: "kimo-desktop", appLabel: "Kimo" })
    const f = expectFail(await c.call("kimo_open", { path }), "DOCUMENT_LOCKED")
    if (h.headless) expect(f.errors[0]?.suggestion).toContain("Connect through the app")
    else expect(f.errors[0]?.suggestion).toContain("Kimo")
  },

  "kimo_render after kimo_apply_ops in the same turn shows the committed change": async (h) => {
    const c = testClient(h)
    const { docId } = await openFixture(h, c)
    const before = expectOk(await c.call("kimo_render", { docId, ids: ["Board00001"] }))
    expect(before.ok).toBe(true)
    expectOk(await c.call("kimo_apply_ops", { docId, ops: [insertRect("r", "#FF0000")] }))
    const out = await c.raw("kimo_render", { docId, ids: ["Board00001"], maxSize: 400 })
    const r = expectOk(
      out.result as ToolResult<{ images: { width: number; height: number; index: number }[] }>,
    )
    expect(r.data.images[0]).toMatchObject({ width: 200, height: 100, index: 2 })
    const png = decodePng(out.images?.[0]?.data as string)
    expect(png.w).toBe(200)
    expect(png.at(100, 50).slice(0, 3)).toEqual([255, 0, 0])
    // render=true on apply attaches the post-commit image too.
    const ap = await c.raw("kimo_apply_ops", {
      docId,
      ops: [
        {
          op: "insert",
          parent: "Board00001",
          node: { type: "rect", x: 0, y: 0, w: 200, h: 100, fill: "#0000FF" },
        },
      ],
      render: true,
    })
    expect(ap.result.ok).toBe(true)
    expect(
      decodePng(ap.images?.[0]?.data as string)
        .at(10, 10)
        .slice(0, 3),
    ).toEqual([0, 0, 255])
  },

  "a destructive op with no approver (headless) is denied per policy, not silently applied": async (
    h,
  ) => {
    const strict = testClient(h, { policy: { level: "edit", onExceed: "deny" } })
    const { docId } = await openFixture(h, strict)
    const del = { docId, ops: [{ op: "delete", id: "Board00001" }] }
    expectFail(await strict.call("kimo_apply_ops", del), "PERMISSION_DENIED")
    // Asking with no UI (headless broker) answers deny.
    const asking = testClient(h, { policy: { level: "edit", onExceed: "ask" }, approve: "deny" })
    expectFail(await asking.call("kimo_apply_ops", del), "PERMISSION_DENIED")
    const timeout = testClient(h, { approve: "timeout" })
    const t = expectFail(await timeout.call("kimo_apply_ops", del), "PERMISSION_DENIED")
    expect(t.errors[0]?.message).toContain("2 minutes")
    const d = h.host.get(docId)
    expect(d.ok && d.value.store.hasNode("Board00001")).toBe(true)
  },
}

export function describeHostConformance(
  name: string,
  make: () => Promise<ConformanceHarness>,
): void {
  describe(`host conformance: ${name}`, () => {
    for (const c of CONFORMANCE_CASES)
      test(c, async () => {
        const h = await make()
        try {
          await CASES[c](h)
        } finally {
          await h.dispose()
        }
      }, 30_000)
  })
}
