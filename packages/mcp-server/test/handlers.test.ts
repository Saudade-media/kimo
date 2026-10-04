/** Tool handlers beyond the conformance list: reads, components, variables, imports, output, runtime. */
import { describe, expect, test } from "bun:test"
import { validate } from "@kimo/core-schema"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  type ActivityEntry,
  type ApprovalRequest,
  connectionHandlers,
  createMemoryDocumentHost,
  HEADLESS_POLICY,
  parseCssTokens,
  parseDtcg,
  templateDocument,
} from "../src/index"
import { validateInput } from "../src/server"
import { decodePng, expectFail, expectOk, testClient } from "./conformance"

function setup(files: Record<string, string> = {}) {
  const platform = createMemoryPlatform({ pid: 3000, files })
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
    h,
    c: testClient(h, { policy: { level: "edit+delete", confirmDestructive: false } }),
  }
}

async function newDoc(s: ReturnType<typeof setup>, template = "blank") {
  const path = `/w/${Math.random().toString(36).slice(2)}.kimo`
  const r = expectOk(await s.c.call<{ doc: { id: string } }>("kimo_create", { path, template }))
  return { path, docId: r.data.doc.id }
}

describe("templates", () => {
  test("every kimo_create template is a valid document", () => {
    for (const t of ["blank", "web", "mobile", "design-system"])
      expect(validate(templateDocument(t, "X")).errors).toEqual([])
  })
})

describe("read tools", () => {
  test("get_state, query selectors/depth/pagination/bounds, read_docs", async () => {
    const s = setup()
    const { docId } = await newDoc(s, "web")
    expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "insert",
            key: "card",
            parent: "DesktopFrm1",
            node: { type: "frame", name: "Card", x: 10, y: 10, w: 100, h: 50, clip: true },
          },
          {
            op: "insert",
            parent: "@card",
            node: { type: "text", name: "Title", content: "Hello world", x: 80, y: 0 },
          },
          {
            op: "insert",
            parent: "@card",
            node: { type: "rect", name: "Bg", x: 0, y: 0, w: 0, h: 10 },
          },
        ],
      }),
    )
    const st = expectOk(
      await s.c.call<{
        documents: { topLevel: { id: string; bounds?: unknown }[]; topLevelCount: number }[]
        you: { origin: string }
      }>("kimo_get_state", {}),
    )
    expect(st.data.documents[0]?.topLevelCount).toBe(1)
    expect(st.data.documents[0]?.topLevel[0]?.bounds).toEqual({ x: 0, y: 0, w: 1440, h: 1024 })
    expect(st.data.you.origin).toBe(s.c.ctx.origin)
    // No selector → INVALID_INPUT; never a dump.
    expectFail(await s.c.call("kimo_query", { docId, select: {} }), "INVALID_INPUT")
    const q = expectOk(
      await s.c.call<{ nodes: Record<string, unknown>[]; matched: number }>("kimo_query", {
        docId,
        select: { topLevel: true },
        depth: 1,
      }),
    )
    expect(q.data.matched).toBe(1)
    expect(q.data.nodes.map((n) => n.name)).toEqual(["Desktop", "Card"])
    expect(q.data.nodes[1]?.children).toEqual(["…"])
    const t = expectOk(
      await s.c.call<{ nodes: Record<string, unknown>[] }>("kimo_query", {
        docId,
        select: { text: "hello" },
        depth: 0,
        include: ["bounds", "problems"],
      }),
    )
    expect(t.data.nodes).toHaveLength(1)
    expect(t.data.nodes[0]?.problems).toContain("partially-clipped")
    const bg = expectOk(
      await s.c.call<{ nodes: Record<string, unknown>[] }>("kimo_query", {
        docId,
        select: { name: "bg" },
        include: ["problems"],
      }),
    )
    expect(bg.data.nodes[0]?.problems).toContain("collapsed")
    const page = expectOk(
      await s.c.call<{ nodes: unknown[]; nextCursor?: string }>("kimo_query", {
        docId,
        select: { under: "DesktopFrm1" },
        depth: 0,
        limit: 1,
      }),
    )
    expect(page.data.nodes).toHaveLength(1)
    expect(page.data.nextCursor).toBe("o1")
    const page2 = expectOk(
      await s.c.call<{ nodes: unknown[] }>("kimo_query", {
        docId,
        select: { under: "DesktopFrm1" },
        depth: 0,
        limit: 1,
        cursor: "o1",
      }),
    )
    expect(page2.data.nodes).toHaveLength(1)
    const docs = expectOk(
      await s.c.call<{ markdown: string; related: string[] }>("kimo_read_docs", { path: "ops" }),
    )
    expect(docs.data.markdown.length).toBeGreaterThan(100)
    expect(docs.data.related.length).toBeGreaterThan(0)
  })

  test("variables: themes, resolve, usages; query resolveVariables", async () => {
    const s = setup()
    const { docId } = await newDoc(s, "design-system")
    expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [{ op: "update", id: "TokensFrm01", set: { fill: { $ref: "color.bg" } } }],
      }),
    )
    const v = expectOk(
      await s.c.call<{
        variables: { name: string; value: { kind: string; resolved?: unknown }; usages?: number }[]
        axes: unknown[]
      }>("kimo_get_variables", {
        docId,
        resolve: true,
        theme: [{ axis: "mode", value: "dark" }],
        includeUsages: true,
      }),
    )
    const bg = v.data.variables.find((x) => x.name === "color.bg")
    expect(bg?.value.kind).toBe("themed")
    expect(bg?.value.resolved).toBe("#0B0B0F")
    expect(bg?.usages).toBe(1)
    expect(v.data.axes).toEqual([{ axis: "mode", values: ["light", "dark"] }])
    const q = expectOk(
      await s.c.call<{ nodes: Record<string, unknown>[] }>("kimo_query", {
        docId,
        select: { ids: ["TokensFrm01"] },
        depth: 0,
        resolveVariables: true,
      }),
    )
    expect(q.data.nodes[0]?.fill).toBe("#FFFFFF")
    // Variable commands through the M3 planners.
    expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "create_variable",
            name: "color.accent",
            variable: { type: "color", value: "#FF00FF" },
          },
          { op: "rename_variable", from: "color.bg", to: "color.surface" },
        ],
      }),
    )
    const d = s.host.get(docId)
    expect(d.ok && JSON.stringify(d.value.store.getNode("TokensFrm01"))).toContain("color.surface")
    expectFail(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "create_variable",
            name: "color.accent",
            variable: { type: "color", value: "#000000" },
          },
        ],
      }),
      "INVALID_INPUT",
    )
  })

  test("components: make_component, instantiate @key, set_override, list_components", async () => {
    const s = setup()
    const { docId } = await newDoc(s, "web")
    const r = expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "insert",
            key: "btn",
            parent: "root",
            node: { type: "frame", name: "Button", x: 2000, y: 0, w: 120, h: 40, fill: "#4F46E5" },
          },
          {
            op: "insert",
            key: "label",
            parent: "@btn",
            node: { type: "text", name: "Label", content: "Go", x: 10, y: 10 },
          },
          { op: "make_component", ids: ["@btn"], key: "comp" },
          { op: "instantiate", of: "@comp", key: "inst", parent: "DesktopFrm1", x: 20, y: 20 },
        ],
      }),
    )
    const ids = Object.fromEntries((r.created ?? []).map((x) => [x.key, x.id]))
    expect(ids.comp).toBe(ids.btn)
    const list = expectOk(
      await s.c.call<{ components: { id: string; instances: number }[] }>("kimo_list_components", {
        docId,
      }),
    )
    expect(list.data.components).toEqual([expect.objectContaining({ id: ids.btn, instances: 1 })])
    expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "set_override",
            instance: ids.inst,
            path: ids.label,
            kind: "set",
            set: { content: "Stop" },
          },
        ],
      }),
    )
    const q = expectOk(
      await s.c.call<{ nodes: Record<string, unknown>[] }>("kimo_query", {
        docId,
        select: { ids: [`${ids.inst}/${ids.label}`] },
        resolveInstances: true,
        depth: 0,
        include: ["origin"],
      }),
    )
    expect(q.data.nodes[0]?.content).toBe("Stop")
    expect(q.data.nodes[0]?.origin).toMatchObject({ virtual: true })
    // Detaching a non-instance is refused by the planner.
    expectFail(
      await s.c.call("kimo_apply_ops", { docId, ops: [{ op: "detach", id: "DesktopFrm1" }] }),
      "INSTANCE_STRUCTURE",
    )
  })

  test("find_space, validate, replace", async () => {
    const s = setup()
    const { docId } = await newDoc(s, "web")
    const fs = expectOk(
      await s.c.call<{ x: number; y: number; parent: string }>("kimo_find_space", {
        docId,
        w: 400,
        h: 300,
      }),
    )
    expect(fs.data).toEqual({ x: 1520, y: 0, parent: "root" })
    const v = expectOk(await s.c.call<{ valid: boolean }>("kimo_validate", { docId }))
    expect(v.data.valid).toBe(true)
    expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "replace",
            id: "DesktopFrm1",
            node: { type: "frame", name: "Replaced", w: 10, h: 10 },
          },
        ],
      }),
    )
    const d = s.host.get(docId)
    if (!d.ok) throw new Error()
    expect(d.value.store.getNode("DesktopFrm1")?.fill).toBeUndefined()
    expect(d.value.store.getNode("DesktopFrm1")?.name).toBe("Replaced")
    expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "replace",
            id: "DesktopFrm1",
            node: { type: "rect", name: "Now a rect", w: 5, h: 5 },
          },
        ],
      }),
    )
    expect(d.value.store.getNode("DesktopFrm1")?.type).toBe("rect")
  })
})

describe("imports, assets, styles, output", () => {
  test("tokens (DTCG + CSS), image import with asset file, assets list, export png", async () => {
    expect(
      parseDtcg(
        '{"color":{"$type":"color","brand":{"$value":"#ff0000"},"alias":{"$value":"{color.brand}"}}}',
      ),
    ).toEqual([
      { name: "color/brand", variable: { type: "color", value: "#ff0000", group: "color" } },
      {
        name: "color/alias",
        variable: { type: "color", value: { $ref: "color/brand" }, group: "color" },
      },
    ])
    expect(
      parseCssTokens(":root{--gap: 8px; --brand: #00f; --accent: var(--brand)}").map(
        (v) => v.variable.type,
      ),
    ).toEqual(["number", "color", "color"])
    const s = setup()
    const { path, docId } = await newDoc(s, "web")
    const t = expectOk(
      await s.c.call<{ variables: number }>("kimo_import", {
        docId,
        kind: "tokens-css",
        text: ":root{--gap: 8px; --brand: #00f}",
      }),
    )
    expect(t.data.variables).toBe(2)
    // A PNG from the raster engine as the image source.
    const out = await s.c.raw("kimo_render", { docId, ids: ["DesktopFrm1"], scale: 0.1 })
    const png = Uint8Array.from(atob(out.images?.[0]?.data as string), (c) => c.charCodeAt(0))
    await s.platform.files.writeBytesAtomic("/w/pic.png", png)
    const im = expectOk(
      await s.c.call<{ rootId: string; asset: string }>("kimo_import", {
        docId,
        kind: "image",
        path: "/w/pic.png",
      }),
    )
    expect(im.data.asset).toMatch(/^\.\/assets\/[0-9a-f]{16}\.png$/)
    expect(await s.platform.files.stat(`/w/${im.data.asset.slice(2)}`)).not.toBeNull()
    const d = s.host.get(docId)
    expect(d.ok && Object.keys(d.value.store.toHeader().assets ?? {})).toHaveLength(1)
    const list = expectOk(
      await s.c.call<{ assets: { usedBy: number }[] }>("kimo_assets", { docId, action: "list" }),
    )
    expect(list.data.assets[0]?.usedBy).toBe(1)
    expectFail(
      await s.c.call("kimo_assets", { docId, action: "generate", prompt: "x" }),
      "UNSUPPORTED",
    )
    const ex = expectOk(
      await s.c.call<{ files: { path: string }[] }>("kimo_export", {
        docId,
        target: "png",
        outDir: "/w/out",
        scale: 0.25,
      }),
    )
    expect(ex.data.files.map((f) => f.path)).toEqual(["/w/out/DesktopFrm1.png"])
    const bytes = await s.platform.files.readBytes("/w/out/DesktopFrm1.png")
    expect(decodePng(btoa(String.fromCharCode(...bytes))).w).toBe(360)
    expect(path).toMatch(/\.kimo$/)
    expectFail(await s.c.call("kimo_import", { docId, kind: "svg", text: "<svg/>" }), "UNSUPPORTED")
  })

  test("styles list / describe / apply", async () => {
    const s = setup()
    const { docId } = await newDoc(s)
    const l = expectOk(await s.c.call<{ presets: { name: string }[] }>("kimo_styles", {}))
    expect(l.data.presets[0]?.name).toBe("kimo-basic")
    expectOk(await s.c.call("kimo_styles", { name: "kimo-basic" }))
    expectFail(await s.c.call("kimo_styles", { name: "kimo-basic", apply: true }), "INVALID_INPUT")
    const a = expectOk(
      await s.c.call<{ variables: number }>("kimo_styles", {
        name: "kimo-basic",
        params: { palette: "rose" },
        apply: true,
        docId,
      }),
    )
    expect(a.data.variables).toBe(9)
  })

  test("focus warns NO_WINDOW headless; close refuses dirty; save then close", async () => {
    const s = setup()
    const { docId } = await newDoc(s, "web")
    const f = expectOk(await s.c.call("kimo_focus", { docId, ids: ["DesktopFrm1"] }))
    expect(f.warnings.map((w) => w.code)).toEqual(["NO_WINDOW"])
    expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [{ op: "update", id: "DesktopFrm1", set: { name: "x" } }],
      }),
    )
    expectFail(await s.c.call("kimo_close", { docId }), "INVALID_INPUT")
    const c = expectOk(
      await s.c.call<{ closed: boolean; saved: boolean }>("kimo_close", { docId, save: true }),
    )
    expect(c.data).toEqual({ closed: true, saved: true })
    expectFail(
      await s.c.call("kimo_query", { docId, select: { topLevel: true } }),
      "DOCUMENT_NOT_OPEN",
    )
    expectFail(await s.c.call("kimo_script", { docId, code: "1" }), "UNSUPPORTED")
  })
})

describe("host runtime", () => {
  test("connections: origin per session, activity per file, presence, approvals with session allowances", async () => {
    const platform = createMemoryPlatform({ pid: 4000 })
    const entries: { fileId: string; e: ActivityEntry }[] = []
    const host = createMemoryDocumentHost({
      platform,
      autosaveMs: 0,
      validate: validateInput,
      approvals: "ask",
      clientPolicy: {
        level: "edit",
        files: ["/w/**"],
        nodes: [],
        grants: ["files.create", "save"],
        onExceed: "ask",
        confirmDestructive: true,
      },
      onActivity: (fileId, e) => entries.push({ fileId, e }),
    })
    const rt = host.runtime
    const conn = rt.connect({
      client: "claude-code",
      label: "Claude Code",
      transport: "stdio-headless",
    })
    expect(conn.origin).toMatch(/^mcp:claude-code\.[a-z0-9]{6}$/)
    const cr = expectOk(
      (await conn.call("kimo_create", { path: "/w/a.kimo", template: "web" })).result,
    )
    const docId = (cr.data as { doc: { id: string } }).doc.id
    expect(rt.presence.list()[0]?.docs).toContain(docId)
    // Outside the allow-list: asks (file reasons are never remembered for the session).
    const asked: ApprovalRequest[] = []
    rt.approvals.onRequest((r) => {
      asked.push(r)
      rt.approvals.respond(r.id, "session")
    })
    await platform.files.writeTextAtomic("/other/b.kimo", templateDocumentText(), { mkdirs: true })
    expectOk((await conn.call("kimo_open", { path: "/other/b.kimo" })).result)
    expect(asked[0]?.reason.kind).toBe("file")
    expect(conn.allowances.ops.size).toBe(0)
    // Destructive: session allowance remembers the op kind.
    const del = { docId, ops: [{ op: "delete", id: "DesktopFrm1" }] }
    expectOk(
      (
        await conn.call("kimo_apply_ops", {
          docId,
          ops: [{ op: "insert", key: "x", parent: "root", node: { type: "rect", w: 1, h: 1 } }],
        })
      ).result,
    )
    expectOk((await conn.call("kimo_apply_ops", del)).result)
    expect(asked.at(-1)?.reason.kind).toBe("destructive")
    const n = asked.length
    expectOk((await conn.call("kimo_history", { docId, action: "undo" })).result)
    expectOk((await conn.call("kimo_apply_ops", del)).result)
    expect(asked.length).toBe(n)
    // Activity: edits recorded under the file id with revision + undo token.
    const edits = entries.filter((x) => x.e.kind === "edit")
    expect(edits.length).toBe(3)
    expect(edits[0]?.fileId).toMatch(/^[0-9a-f]{16}$/)
    expect(edits[0]?.e.undoToken).toBeString()
    expect(edits[0]?.e.seq).toBeGreaterThan(0)
    expect((await rt.activity.list(edits[0]?.fileId as string)).length).toBeGreaterThan(3)
    // Timeout with nobody answering.
    const rt2 = createMemoryDocumentHost({
      platform: createMemoryPlatform(),
      approvals: "ask",
      validate: validateInput,
    })
    const short = rt2.runtime
    ;(short.approvals as unknown as { timeoutMs: number }).timeoutMs = 20
    const c2 = short.connect({ client: "codex", label: "Codex", transport: "socket" })
    const t = await c2.call("kimo_open", { path: "/nowhere/x.kimo" })
    expectFail(t.result, "PERMISSION_DENIED")
    expect(connectionHandlers(conn)).toBeDefined()
    conn.close()
    expect(rt.presence.list()).toHaveLength(0)
    await host.dispose()
    await rt2.dispose()
  })

  test("M5 addendum: preview op kinds, activity label/opCount/revisionBefore, call label, pause", async () => {
    const platform = createMemoryPlatform({ pid: 4100 })
    const entries: ActivityEntry[] = []
    const host = createMemoryDocumentHost({
      platform,
      autosaveMs: 0,
      validate: validateInput,
      approvals: "ask",
      clientPolicy: {
        level: "edit+delete",
        files: ["/w/**"],
        nodes: [],
        grants: ["files.create", "save"],
        onExceed: "ask",
        confirmDestructive: true,
      },
      onActivity: (_f, e) => entries.push(e),
    })
    const rt = host.runtime
    const conn = rt.connect({ client: "claude-code", label: "Claude Code", transport: "socket" })
    const cr = expectOk(
      (await conn.call("kimo_create", { path: "/w/p.kimo", template: "web" })).result,
    )
    const docId = (cr.data as { doc: { id: string } }).doc.id
    const ins = expectOk(
      (
        await conn.call("kimo_apply_ops", {
          docId,
          label: "Insert Card",
          ops: [{ op: "insert", key: "card", parent: "root", node: { type: "frame", w: 4, h: 3 } }],
        })
      ).result,
    )
    const cardId = (ins.created as { id: string }[])[0]?.id as string
    const edit = entries.filter((e) => e.kind === "edit").at(-1)
    expect(edit?.label).toBe("Insert Card")
    expect(edit?.opCount).toBe(1)
    expect(edit?.revisionBefore?.seq).toBe((edit?.revision?.seq ?? 0) - 1)
    // Approval preview: op kind per node from a dry run that leaves no trace.
    const asked: ApprovalRequest[] = []
    rt.approvals.onRequest((r) => {
      asked.push(r)
      rt.approvals.respond(r.id, "once")
    })
    const before = entries.length
    expectOk(
      (
        await conn.call("kimo_apply_ops", {
          docId,
          ops: [
            { op: "update", id: "DesktopFrm1", set: { name: "Desk" } },
            { op: "delete", id: cardId },
          ],
        })
      ).result,
    )
    const pv = asked[0]?.preview
    expect(pv?.kinds?.[cardId]).toBe("delete")
    expect(pv?.kinds?.DesktopFrm1).toBe("update")
    expect(pv?.deleted).toBe(1)
    expect(entries.slice(before).some((e) => e.kind === "dry-run")).toBe(false)
    // Call label while running.
    const labels: string[] = []
    const off = rt.presence.onChange((l) => {
      const c = l[0]?.call
      if (c) labels.push(c.label)
    })
    expectOk((await conn.call("kimo_query", { docId, select: { topLevel: true } })).result)
    off()
    expect(labels).toContain("Reading nodes")
    expect(rt.presence.list()[0]?.call).toBeUndefined()
    // Pause: calls wait until resume; presence says paused.
    rt.pause("claude-code")
    expect(rt.presence.list()[0]?.paused).toBe(true)
    let finished = false
    const p = conn.call("kimo_get_state", {}).then((o) => {
      finished = true
      return o
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(finished).toBe(false)
    expect(rt.paused()).toEqual(["claude-code"])
    rt.resume("claude-code")
    expectOk((await p).result)
    expect(rt.presence.list()[0]?.paused).toBe(false)
    // A paused call fails retryable when the connection closes.
    rt.pause("claude-code")
    const q = conn.call("kimo_get_state", {})
    conn.close()
    expectFail((await q).result, "TIMEOUT")
    await host.dispose()
  })

  test("memory host autosaves after idle and flushes on dispose", async () => {
    const platform = createMemoryPlatform({ pid: 5000 })
    const host = createMemoryDocumentHost({
      platform,
      autosaveMs: 20,
      validate: validateInput,
      clientPolicy: { ...HEADLESS_POLICY, files: ["/w/**"] },
    })
    const conn = host.runtime.connect({ client: "cli", label: "CLI", transport: "stdio-headless" })
    await platform.files.writeTextAtomic("/w/auto.kimo", templateDocumentText(), { mkdirs: true })
    const o = expectOk((await conn.call("kimo_open", { path: "/w/auto.kimo" })).result)
    const docId = (o.data as { doc: { id: string } }).doc.id
    expectOk(
      (
        await conn.call("kimo_apply_ops", {
          docId,
          ops: [{ op: "update", id: "DesktopFrm1", set: { name: "Auto" } }],
        })
      ).result,
    )
    await new Promise((r) => setTimeout(r, 80))
    expect(platform.control.readFile("/w/auto.kimo")).toContain('"Auto"')
    expectOk(
      (
        await conn.call("kimo_apply_ops", {
          docId,
          ops: [{ op: "update", id: "DesktopFrm1", set: { name: "Final" } }],
        })
      ).result,
    )
    await host.dispose()
    expect(platform.control.readFile("/w/auto.kimo")).toContain('"Final"')
    // The lease is released on dispose.
    expect(await platform.leases.inspect("/w/auto.kimo")).toBeNull()
  })
})

function templateDocumentText(): string {
  return `${JSON.stringify(templateDocument("web"), null, 2)}\n`
}

describe("kimo_export code and token targets (M7, ADR 0015)", () => {
  async function designSystemDoc() {
    const s = setup()
    const { docId } = await newDoc(s, "web")
    expectOk(
      await s.c.call("kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "set_variables",
            set: [{ name: "gap", variable: { type: "number", value: 8 } }],
          },
        ],
      }),
    )
    return { s, docId }
  }
  type Files = {
    files: { path: string; contents?: string; encoding?: string; unchanged?: boolean }[]
    issues?: { code: string }[]
  }

  test("without outDir the files come back inline (tokens, html, react)", async () => {
    const { s, docId } = await designSystemDoc()
    const dtcg = expectOk(
      await s.c.call<Files>("kimo_export", { docId, target: "tokens-dtcg" }),
    ).data
    expect(dtcg.files.map((f) => f.path)).toEqual(["tokens.json"])
    expect(dtcg.files[0]?.encoding).toBe("utf8")
    expect(JSON.parse(dtcg.files[0]?.contents ?? "{}").gap.$value).toBeDefined()
    const css = expectOk(await s.c.call<Files>("kimo_export", { docId, target: "tokens-css" }))
    expect(css.data.files[0]?.contents).toContain("--gap: 8;")
    const html = expectOk(
      await s.c.call<Files>("kimo_export", { docId, target: "html-css", ids: ["DesktopFrm1"] }),
    )
    expect(html.data.files.map((f) => f.path).sort()).toEqual([
      "index.html",
      "styles.css",
      "tokens.css",
    ])
    expect(Array.isArray(html.data.issues)).toBe(true)
    const react = expectOk(
      await s.c.call<Files>("kimo_export", {
        docId,
        target: "react-tailwind",
        ids: ["DesktopFrm1"],
      }),
    )
    expect(react.data.files.some((f) => f.path.endsWith(".tsx"))).toBe(true)
    // Nothing written.
    expect(await s.platform.files.stat("/w/index.html").catch(() => null)).toBeNull()
  })

  test("svg reads the committed layout; pdf comes back as base64", async () => {
    const { s, docId } = await designSystemDoc()
    const svg = expectOk(
      await s.c.call<Files>("kimo_export", { docId, target: "svg", ids: ["DesktopFrm1"] }),
    )
    expect(svg.data.files[0]?.contents).toStartWith("<svg")
    const pdf = expectOk(
      await s.c.call<Files>("kimo_export", { docId, target: "pdf", ids: ["DesktopFrm1"] }),
    )
    expect(pdf.data.files[0]?.encoding).toBe("base64")
    expect(atob(pdf.data.files[0]?.contents ?? "").slice(0, 5)).toBe("%PDF-")
  })

  test("outDir: written through the host, identical files unchanged, conflicts block", async () => {
    const { s, docId } = await designSystemDoc()
    const call = (overwrite = false) =>
      s.c.call<Files>("kimo_export", {
        docId,
        target: "tokens-css",
        outDir: "/w/tokens",
        ...(overwrite ? { overwrite } : {}),
      })
    const a = expectOk(await call()).data
    expect(a.files).toMatchObject([{ path: "/w/tokens/tokens.css" }])
    expect(a.files[0]?.contents).toBeUndefined()
    const written = new TextDecoder().decode(
      await s.platform.files.readBytes("/w/tokens/tokens.css"),
    )
    expect(written).toContain("--gap: 8;")
    expect(expectOk(await call()).data.files[0]?.unchanged).toBe(true)
    await s.platform.control.writeExternal("/w/tokens/tokens.css", "/* edited */")
    expectFail(await call(), "FILE_EXISTS")
    expect(expectOk(await call(true)).data.files[0]?.unchanged).toBeUndefined()
    // png and kimo still need a folder.
    expectFail(await s.c.call("kimo_export", { docId, target: "png" }), "INVALID_INPUT")
  })
})
