/** `@kimo/mcp-server/host`: a relayed MCP session end to end (initialize, tools/call, resources). */
import { expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createConnectionServer, RelayTransport, validateInput } from "../src/handlers/sdk"
import { createMemoryDocumentHost, HEADLESS_POLICY } from "../src/index"

test("a relayed connection serves initialize, tools/call and resources/read", async () => {
  const platform = createMemoryPlatform()
  const host = createMemoryDocumentHost({
    platform,
    autosaveMs: 0,
    validate: validateInput,
    clientPolicy: { ...HEADLESS_POLICY, files: ["/w/**"] },
  })
  const conn = host.runtime.connect({
    client: "claude-code",
    label: "Claude Code",
    transport: "socket",
  })
  const out: Record<string, unknown>[] = []
  const transport = new RelayTransport((line) => {
    out.push(JSON.parse(line))
  })
  const server = createConnectionServer(conn, { version: "0.5.0", host: "desktop" })
  await server.connect(transport)
  const next = async (id: number) => {
    for (let i = 0; i < 200; i++) {
      const m = out.find((x) => x.id === id)
      if (m) return m as { result?: Record<string, unknown>; error?: unknown }
      await new Promise((r) => setTimeout(r, 5))
    }
    throw new Error(`no response ${id}`)
  }
  transport.receive({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  } as never)
  const init = await next(1)
  expect((init.result?.serverInfo as { name: string } | undefined)?.name).toBe("kimo")
  transport.receive({ jsonrpc: "2.0", method: "notifications/initialized" } as never)
  transport.receive({ jsonrpc: "2.0", id: 2, method: "tools/list" } as never)
  const list = await next(2)
  expect((list.result?.tools as unknown[] | undefined)?.length).toBe(19)
  transport.receive({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "kimo_create", arguments: { path: "/w/a.kimo", template: "web" } },
  } as never)
  const created = await next(3)
  const sc = created.result?.structuredContent as { ok: boolean; data: { doc: { id: string } } }
  expect(sc.ok).toBe(true)
  transport.receive({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "kimo_query", arguments: { select: {} } },
  } as never)
  const bad = await next(4)
  expect(bad.result?.isError).toBe(true)
  expect(JSON.stringify(bad.result?.structuredContent)).toContain("INVALID_INPUT")
  transport.receive({
    jsonrpc: "2.0",
    id: 5,
    method: "resources/read",
    params: { uri: `kimo://doc/${sc.data.doc.id}/node/DesktopFrm1` },
  } as never)
  const res = await next(5)
  expect(JSON.stringify(res.result)).toContain("DesktopFrm1")
  transport.receive({
    jsonrpc: "2.0",
    id: 6,
    method: "resources/read",
    params: { uri: "kimo://docs/ops" },
  } as never)
  expect(JSON.stringify((await next(6)).result)).toContain("kimo_apply_ops")
  await transport.close()
  await host.dispose()
})

test("validateInput works without eval (CSP webview: the document host)", async () => {
  const { setEvalAllowedForTests, validateInput: v } = await import("../src/server")
  const { toolByName } = await import("../src/registry")
  const def = toolByName("kimo_query")
  if (!def) throw new Error("no kimo_query")
  setEvalAllowedForTests(false)
  try {
    expect(v(def, { docId: "d_0000000000000000_zzzz", select: { topLevel: true } })).toEqual([])
    const bad = v(def, { docId: "d_0000000000000000_zzzz" })
    expect(bad).toHaveLength(1)
    expect(bad[0]?.code).toBe("INVALID_INPUT")
    expect(bad[0]?.message).toContain("select")
  } finally {
    setEvalAllowedForTests(undefined)
  }
})

test("tools/call commits the stream named by _meta claudecode/toolUseId (Claude Code)", async () => {
  const platform = createMemoryPlatform()
  const host = createMemoryDocumentHost({
    platform,
    autosaveMs: 0,
    validate: validateInput,
    clientPolicy: { ...HEADLESS_POLICY, level: "edit", files: ["/w/**"] },
  })
  const conn = host.runtime.connect({
    client: "claude-code",
    label: "Claude Code",
    transport: "socket",
  })
  const out: Record<string, unknown>[] = []
  const transport = new RelayTransport((line) => {
    out.push(JSON.parse(line))
  })
  const server = createConnectionServer(conn, { version: "0.5.0", host: "desktop" })
  await server.connect(transport)
  const next = async (id: number) => {
    for (let i = 0; i < 200; i++) {
      const m = out.find((x) => x.id === id)
      if (m) return m as { result?: Record<string, unknown> }
      await new Promise((r) => setTimeout(r, 5))
    }
    throw new Error(`no response ${id}`)
  }
  transport.receive({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "2" },
    },
  } as never)
  await next(1)
  transport.receive({ jsonrpc: "2.0", method: "notifications/initialized" } as never)
  transport.receive({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "kimo_create", arguments: { path: "/w/s.kimo", template: "blank" } },
  } as never)
  const created = (await next(2)).result?.structuredContent as {
    data: { doc: { id: string } }
  }
  const docId = created.data.doc.id
  const args = {
    docId,
    ops: [
      {
        op: "insert",
        key: "f",
        parent: "root",
        node: { type: "frame", name: "Streamed", w: 10, h: 10 },
      },
    ],
  }
  // The window forwarded the model's partial input before the call arrives.
  const s = conn.openStream("toolu_meta1")
  s?.feed(JSON.stringify(args))
  await s?.settled()
  expect(s?.progress().applied).toBe(1)
  transport.receive({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "kimo_apply_ops",
      arguments: args,
      _meta: { "claudecode/toolUseId": "toolu_meta1" },
    },
  } as never)
  const r = (await next(3)).result?.structuredContent as { ok: boolean; undoToken: string }
  expect(r.ok).toBe(true)
  expect(s?.progress().state).toBe("committed")
  const d = host.get(docId)
  if (!d.ok) throw new Error("doc")
  expect(d.value.store.nodeIds().map((id) => d.value.store.getNode(id)?.name)).toEqual(["Streamed"])
  await server.close()
  host.dispose()
})
