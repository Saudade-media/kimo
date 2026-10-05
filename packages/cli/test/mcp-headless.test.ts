/**
 * Headless `kimo mcp --headless` driven end to end by the official MCP SDK client over stdio
 * (a real child process), with a temp HOME / KIMO_HOME.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parse, serialize } from "@kimo/core-schema"
import { listTools } from "@kimo/mcp-server"
import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { pathHash } from "../src/cli"

const MAIN = resolve(import.meta.dir, "../src/main.ts")

// biome-ignore lint/suspicious/noExplicitAny: envelopes are checked field by field
type Loose = any

const dirs: string[] = []
const clients: Client[] = []
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => {})
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function workspace() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "kimo-mcp-headless-")))
  dirs.push(home)
  const project = join(home, "repo")
  mkdirSync(project)
  const file = join(project, "site.kimo")
  writeFileSync(
    file,
    serialize({
      $schema: "https://kimo.design/schema/kimo-1.0.json",
      format: "1.0.0",
      nodes: { Page000001: { type: "frame", parent: null, order: "a0", name: "Home", w: 1440 } },
    } as Loose),
  )
  return { home, project, file, kimoHome: join(home, ".kimo") }
}

async function connect(
  ws: ReturnType<typeof workspace>,
  args: string[] = [],
  name = "test-agent",
): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MAIN, "mcp", "--headless", ...args],
    cwd: ws.project,
    env: { HOME: ws.home, KIMO_HOME: ws.kimoHome, PATH: process.env.PATH ?? "" },
    stderr: "pipe",
  })
  const client = new Client({ name, version: "1.0.0" })
  await client.connect(transport)
  clients.push(client)
  return client
}

const call = async (c: Client, name: string, args: Record<string, unknown>): Promise<Loose> =>
  ((await c.callTool({ name, arguments: args })) as Loose).structuredContent

describe("kimo mcp --headless over stdio (MCP SDK client)", () => {
  test("initialize: server info and instructions; tools/list matches the registry", async () => {
    const ws = workspace()
    const c = await connect(ws)
    expect(c.getServerVersion()?.name).toBe("kimo")
    expect(c.getInstructions()).toContain("kimo_get_state")
    const tools = (await c.listTools()).tools.map((t) => t.name)
    expect(tools).toEqual(listTools({ host: "headless" }).map((t) => t.name))
    expect(tools).toContain("kimo_script")
  })

  test('stderr: the mode label is "headless" and names each file opened', async () => {
    const ws = workspace()
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [MAIN, "mcp", "--headless"],
      cwd: ws.project,
      env: { HOME: ws.home, KIMO_HOME: ws.kimoHome, PATH: process.env.PATH ?? "" },
      stderr: "pipe",
    })
    let err = ""
    transport.stderr?.on("data", (b: Buffer) => {
      err += b.toString("utf8")
    })
    const c = new Client({ name: "stderr-agent", version: "1.0.0" })
    await c.connect(transport)
    clients.push(c)
    expect((await call(c, "kimo_open", { path: ws.file })).ok).toBe(true)
    await new Promise((r) => setTimeout(r, 100))
    expect(err).toMatch(/kimo mcp: headless, files: .+, level edit\+delete/)
    expect(err).not.toContain("memory-host")
    expect(err).toMatch(/kimo mcp: headless: opened .*site\.kimo/)
  })

  test("kimo_read_docs serves the guides", async () => {
    const ws = workspace()
    const c = await connect(ws)
    const idx = await call(c, "kimo_read_docs", {})
    expect(idx.ok).toBe(true)
    expect(idx.data.path).toBe("index")
    expect(idx.data.markdown).toContain("kimo_apply_ops")
    const ops = await call(c, "kimo_read_docs", { path: "ops" })
    expect(ops.data.markdown).toContain("@key")
    const res = await c.readResource({ uri: "kimo://docs/ops" })
    expect((res.contents[0] as Loose).text).toBe(ops.data.markdown)
    const schema = await c.readResource({ uri: "kimo://schema/1.0" })
    expect(JSON.parse((schema.contents[0] as Loose).text).$schema).toContain("2020-12")
  })

  test("write op + save + reopen is byte-stable; the lease is taken and released", async () => {
    const ws = workspace()
    const c = await connect(ws)
    const opened = await call(c, "kimo_open", { path: ws.file })
    expect(opened.ok).toBe(true)
    const docId = opened.data.doc.id as string
    const lock = join(ws.kimoHome, "locks", `${pathHash(ws.file)}.lock`)
    expect(existsSync(lock)).toBe(true)
    const holder = JSON.parse(readFileSync(lock, "utf8"))
    expect(holder.app).toBe("kimo-mcp")
    expect(holder.appLabel).toBe("kimo mcp (headless)")

    const applied = await call(c, "kimo_apply_ops", {
      docId,
      baseRevision: opened.data.revision,
      ops: [
        {
          op: "insert",
          key: "hero",
          parent: "Page000001",
          node: { type: "frame", name: "Hero", w: { mode: "fill" }, layout: { dir: "column" } },
        },
        { op: "insert", parent: "@hero", node: { type: "text", content: "Plan less." } },
      ],
    })
    expect(applied.ok).toBe(true)
    expect(applied.created[0].key).toBe("hero")
    const heroId = applied.created[0].id as string

    // A stale baseRevision is refused and changes nothing.
    const stale = await call(c, "kimo_apply_ops", {
      docId,
      baseRevision: opened.data.revision,
      ops: [{ op: "delete", id: heroId }],
    })
    expect(stale.ok).toBe(false)
    expect(stale.errors[0].code).toBe("REVISION_CONFLICT")

    const saved = await call(c, "kimo_save", { docId })
    expect(saved.ok).toBe(true)
    const bytes = readFileSync(ws.file, "utf8")
    expect(saved.data.bytes).toBe(Buffer.byteLength(bytes))
    expect(bytes).toContain(heroId)
    expect(bytes).toContain("Plan less.")
    expect(serialize(parse(bytes))).toBe(bytes) // canonical

    await c.close()
    clients.splice(clients.indexOf(c), 1)
    await Bun.sleep(300)
    expect(existsSync(lock)).toBe(false)

    // Reopen in a new session: same content, and an unchanged save rewrites the same bytes.
    const c2 = await connect(ws)
    const again = await call(c2, "kimo_open", { path: ws.file })
    expect(again.ok).toBe(true)
    const state = await call(c2, "kimo_get_state", { docId: again.data.doc.id })
    expect(state.data.documents[0].doc.dirty).toBe(false)
    expect(state.data.app.mode).toBe("headless")
    await call(c2, "kimo_save", { docId: again.data.doc.id })
    expect(readFileSync(ws.file, "utf8")).toBe(bytes)
  })

  test("lease conflict: a second headless process gets DOCUMENT_LOCKED with the holder", async () => {
    const ws = workspace()
    const a = await connect(ws, [], "agent-a")
    expect((await call(a, "kimo_open", { path: ws.file })).ok).toBe(true)
    const b = await connect(ws, [], "agent-b")
    const r = await call(b, "kimo_open", { path: ws.file })
    expect(r.ok).toBe(false)
    expect(r.errors[0].code).toBe("DOCUMENT_LOCKED")
    expect(r.errors[0].detail.holder.appLabel).toBe("kimo mcp (headless)")
    const ro = await call(b, "kimo_open", { path: ws.file, readOnly: true })
    expect(ro.ok).toBe(true)
    expect(ro.data.doc.readOnly).toBe(true)
  })

  test("a lease held by the desktop app suggests attaching", async () => {
    const ws = workspace()
    mkdirSync(join(ws.kimoHome, "locks"), { recursive: true })
    writeFileSync(
      join(ws.kimoHome, "locks", `${pathHash(ws.file)}.lock`),
      JSON.stringify({
        version: 1,
        path: ws.file,
        pid: process.pid, // alive, and not the server's pid
        app: "kimo-desktop",
        appLabel: "Kimo",
        host: hostname(),
        sinceIso: new Date().toISOString(),
        token: "t",
      }),
    )
    const c = await connect(ws)
    const r = await call(c, "kimo_open", { path: ws.file })
    expect(r.ok).toBe(false)
    expect(r.errors[0].code).toBe("DOCUMENT_LOCKED")
    expect(r.errors[0].suggestion).toContain("Kimo app")
  })

  test("autosave writes after 2 s idle", async () => {
    const ws = workspace()
    const c = await connect(ws)
    const o = await call(c, "kimo_open", { path: ws.file })
    const before = readFileSync(ws.file, "utf8")
    await call(c, "kimo_apply_ops", {
      docId: o.data.doc.id,
      ops: [{ op: "update", id: "Page000001", set: { name: "Landing" } }],
    })
    expect(readFileSync(ws.file, "utf8")).toBe(before)
    await Bun.sleep(2_600)
    expect(readFileSync(ws.file, "utf8")).toContain('"Landing"')
  }, 10_000)

  test("policy: --allow read denies edits; files outside --files are denied (no prompts)", async () => {
    const ws = workspace()
    const ro = await connect(ws, ["--allow", "read"])
    const o = await call(ro, "kimo_open", { path: ws.file })
    expect(o.ok).toBe(true)
    const edit = await call(ro, "kimo_apply_ops", {
      docId: o.data.doc.id,
      ops: [{ op: "update", id: "Page000001", set: { name: "X" } }],
    })
    expect(edit.ok).toBe(false)
    expect(edit.errors[0].code).toBe("PERMISSION_DENIED")

    const outside = join(ws.home, "elsewhere.kimo")
    writeFileSync(outside, readFileSync(ws.file))
    const other = await connect(ws, ["--files", `${ws.project}/**`])
    const denied = await call(other, "kimo_open", { path: outside })
    expect(denied.ok).toBe(false)
    expect(denied.errors[0].code).toBe("PERMISSION_DENIED")
  })

  test("unknown docId never falls back to another document", async () => {
    const ws = workspace()
    const c = await connect(ws)
    await call(c, "kimo_open", { path: ws.file })
    const r = await call(c, "kimo_query", {
      docId: "d_0000000000000000_x",
      select: { topLevel: true },
    })
    expect(r.ok).toBe(false)
    expect(r.errors[0].code).toBe("DOCUMENT_NOT_OPEN")
  })
})
