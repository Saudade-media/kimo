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
      $schema: "https://getkimo.design/schema/kimo-1.0.json",
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

    // An unknown docId never falls back to another open document.
    const unknown = await call(c, "kimo_query", {
      docId: "d_0000000000000000_x",
      select: { topLevel: true },
    })
    expect(unknown.errors[0].code).toBe("DOCUMENT_NOT_OPEN")

    const saved = await call(c, "kimo_save", { docId })
    expect(saved.ok).toBe(true)
    const bytes = readFileSync(ws.file, "utf8")
    expect(saved.data.bytes).toBe(Buffer.byteLength(bytes))
    expect(bytes).toContain(heroId)
    expect(bytes).toContain("Plan less.")
    expect(serialize(parse(bytes))).toBe(bytes) // canonical

    await c.close()
    clients.splice(clients.indexOf(c), 1)
    for (let i = 0; i < 150 && existsSync(lock); i++) await Bun.sleep(20)
    expect(existsSync(lock)).toBe(false)

    // Reopen in a new session: same content, and an unchanged save rewrites the same bytes.
    const c2 = await connect(ws)
    const again = await call(c2, "kimo_open", { path: ws.file })
    expect(again.ok).toBe(true)
    const state = await call(c2, "kimo_get_state", { docId: again.data.doc.id })
    expect(state.data.documents[0].doc.dirty).toBe(false)
    await call(c2, "kimo_save", { docId: again.data.doc.id })
    expect(readFileSync(ws.file, "utf8")).toBe(bytes)
  })

  test("lease conflict: a second process gets DOCUMENT_LOCKED with the holder; the desktop app suggests attaching", async () => {
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

    // A lease held by the desktop app (alive pid that is not the server's).
    const held = join(ws.project, "held.kimo")
    writeFileSync(held, readFileSync(ws.file))
    mkdirSync(join(ws.kimoHome, "locks"), { recursive: true })
    writeFileSync(
      join(ws.kimoHome, "locks", `${pathHash(held)}.lock`),
      JSON.stringify({
        version: 1,
        path: held,
        pid: process.pid,
        app: "kimo-desktop",
        appLabel: "Kimo",
        host: hostname(),
        sinceIso: new Date().toISOString(),
        token: "t",
      }),
    )
    const d = await call(b, "kimo_open", { path: held })
    expect(d.ok).toBe(false)
    expect(d.errors[0].code).toBe("DOCUMENT_LOCKED")
    expect(d.errors[0].suggestion).toContain("Kimo app")
  })

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
})
