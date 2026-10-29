/** `@kimo/mcp-server/host`: a relayed MCP session end to end (initialize, tools/call, resources). */
import { expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createConnectionServer, RelayTransport, validateInput } from "../src/handlers/sdk"
import { createMemoryDocumentHost, HEADLESS_POLICY, listTools } from "../src/index"

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
  expect((list.result?.tools as unknown[] | undefined)?.length).toBe(
    listTools({ host: "desktop" }).length,
  )
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

test("pick asks through elicitation/create; accept, decline, a value never offered, a client without elicitation (#78)", async () => {
  const platform = createMemoryPlatform()
  const host = createMemoryDocumentHost({
    platform,
    autosaveMs: 0,
    validate: validateInput,
    clientPolicy: { ...HEADLESS_POLICY, files: ["/w/**"], grants: ["files.create"] },
  })
  // Two files the person opened: nothing points at either.
  const person = host.runtime.connect({ client: "kimo", label: "Kimo", transport: "in-process" })
  for (const path of ["/w/a.kimo", "/w/b.kimo"])
    expect((await person.call("kimo_create", { path, template: "web" })).result.ok).toBe(true)

  /** One relayed client; `answer` replies to the server's elicitation/create requests. */
  async function client(
    capabilities: Record<string, unknown>,
    answer?: (params: never) => unknown,
  ) {
    const conn = host.runtime.connect({
      client: "claude-code",
      label: "Claude Code",
      transport: "socket",
    })
    const out: Record<string, unknown>[] = []
    const asked: Record<string, unknown>[] = []
    const transport: RelayTransport = new RelayTransport((line) => {
      const m = JSON.parse(line) as Record<string, unknown>
      if (m.method === "elicitation/create") {
        asked.push(m.params as Record<string, unknown>)
        const result = answer?.(m.params as never) ?? { action: "cancel" }
        queueMicrotask(() => transport.receive({ jsonrpc: "2.0", id: m.id, result } as never))
      } else out.push(m)
    })
    const server = createConnectionServer(conn, { version: "0.5.0", host: "desktop", canAsk: true })
    await server.connect(transport)
    const next = async (id: number) => {
      for (let i = 0; i < 400; i++) {
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
        protocolVersion: "2025-11-25",
        capabilities,
        clientInfo: { name: "t", version: "1" },
      },
    } as never)
    await next(1)
    transport.receive({ jsonrpc: "2.0", method: "notifications/initialized" } as never)
    let id = 1
    const pick = async () => {
      transport.receive({
        jsonrpc: "2.0",
        id: ++id,
        method: "tools/call",
        params: { name: "kimo_get_state", arguments: { pick: "frame" } },
      } as never)
      return (await next(id)).result?.structuredContent as {
        ok: boolean
        data?: { target: { status: string; docId: string; frameIds: string[]; via: string } }
        errors?: { code: string; detail?: { reason: string } }[]
      }
    }
    return { pick, asked, close: () => server.close() }
  }
  type Schema = { properties: { target: { oneOf: { const: string; title: string }[] } } }
  const offered = (p: Record<string, unknown>) =>
    (p.requestedSchema as Schema).properties.target.oneOf.map((o) => o.const)

  // Accept an offered value: the target is clear and comes from the person's pick.
  const yes = await client({ elicitation: {} }, (p) => ({
    action: "accept",
    content: { target: offered(p)[1] },
  }))
  const ok = await yes.pick()
  expect(ok.ok).toBe(true)
  const value = offered(yes.asked[0] as Record<string, unknown>)[1] as string
  expect(ok.data?.target).toMatchObject({ status: "clear", via: "picked" })
  expect(`${ok.data?.target.docId}/${ok.data?.target.frameIds[0]}`).toBe(value)
  await yes.close()

  // Declined: CANCELLED, never a guess.
  const no = await client({ elicitation: {} }, () => ({ action: "decline" }))
  const declined = await no.pick()
  expect(declined.errors?.[0]?.code).toBe("CANCELLED")
  await no.close()

  // An answer outside the offered set is refused.
  const odd = await client({ elicitation: {} }, () => ({
    action: "accept",
    content: { target: "d_0000000000000000_zzzz/DesktopFrm1" },
  }))
  expect((await odd.pick()).errors?.[0]?.code).toBe("INVALID_INPUT")
  await odd.close()

  // A client without elicitation is never sent a request: TARGET_UNCLEAR, ask in chat.
  const plain = await client({})
  const unclear = await plain.pick()
  expect(plain.asked).toHaveLength(0)
  expect(unclear.errors?.[0]?.code).toBe("TARGET_UNCLEAR")
  expect(unclear.errors?.[0]?.detail?.reason).toBe("no-elicitation")
  await plain.close()
  await host.dispose()
})
