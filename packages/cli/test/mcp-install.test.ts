/**
 * `kimo mcp install | remove | status` against a temp HOME for all five hosts. The real user
 * configs are never touched: HOME, KIMO_HOME and the shim search list are all overridden.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  configPath,
  HOSTS,
  type HostId,
  type InstallerFs,
  install,
  nodeInstallerFs,
} from "@kimo/mcp-server/installer"
import { type CliIO, run } from "../src/cli"
import { hostOs, resolveLauncher } from "../src/mcp/launcher"

// biome-ignore lint/suspicious/noExplicitAny: tests poke at JSON
type Loose = any

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "kimo-mcp-install-"))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function session(extraEnv: Record<string, string> = {}) {
  const home = tmp()
  const env: Record<string, string> = {
    HOME: home,
    KIMO_HOME: join(home, ".kimo"),
    // No real app lookup: an empty-ish candidate list means "app not installed".
    KIMO_MCP_SHIM_CANDIDATES: join(home, "no-such-shim"),
    ...extraEnv,
  }
  const call = async (...argv: string[]) => {
    const out: string[] = []
    const err: string[] = []
    const io: CliIO = { stdout: (t) => out.push(t), stderr: (t) => err.push(t), env, cwd: home }
    const code = await run(["mcp", ...argv], io)
    return { code, out: out.join(""), err: err.join("") }
  }
  const path = (h: HostId, scope: "user" | "project" = "user") =>
    configPath(h, scope, { home, os: hostOs(), project: home })
  const backups = () => {
    const d = join(home, ".kimo", "mcp", "backups")
    return existsSync(d) ? readdirSync(d) : []
  }
  return { home, env, call, path, backups }
}

const put = (p: string, text: string) => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, text)
}
const rootKey = (h: HostId) => (h === "vscode" ? "servers" : "mcpServers")
const entryOf = (h: HostId, text: string): Loose =>
  h === "codex" ? text : JSON.parse(text)[rootKey(h)]?.kimo

describe.each([...HOSTS])("kimo mcp install/remove/status --host %s", (host) => {
  const flag = host === "gemini-cli" ? "gemini" : host

  test("install writes the entry; second install is idempotent (no write, no backup)", async () => {
    const s = session()
    const r1 = await s.call("install", "--host", flag)
    expect(r1.code).toBe(0)
    expect(r1.out).toContain("installed")
    const text = readFileSync(s.path(host), "utf8")
    if (host === "codex") {
      expect(text).toContain("[mcp_servers.kimo]")
      expect(text).toContain('command = "bunx"')
      expect(text).toContain('args = ["@kimo/cli", "mcp", "--client", "codex"]')
    } else {
      const e = entryOf(host, text)
      expect(e.command).toBe("bunx")
      expect(e.args).toEqual(["@kimo/cli", "mcp", "--client", host])
      if (host === "gemini-cli") expect(e.trust).toBe(false)
      else expect(e.type).toBe("stdio")
    }
    const mtime = statSync(s.path(host)).mtimeMs
    const r2 = await s.call("install", "--host", flag)
    expect(r2.code).toBe(0)
    expect(r2.out).toContain("unchanged")
    expect(readFileSync(s.path(host), "utf8")).toBe(text)
    expect(statSync(s.path(host)).mtimeMs).toBe(mtime)
    expect(s.backups()).toEqual([])

    const st = await s.call("status", "--host", flag, "--json")
    const row = JSON.parse(st.out).rows[0]
    expect(row.status.installed).toBe(true)
    expect(row.status.current).toBe(true)
  })

  test("preserves other entries, backs up the original, remove restores it", async () => {
    const s = session()
    const p = s.path(host)
    const original =
      host === "codex"
        ? `model = "o5"\n\n[mcp_servers.other]\ncommand = "other"\n`
        : `${JSON.stringify({ theme: "dark", [rootKey(host)]: { other: { command: "o" } } }, null, 4)}\n`
    put(p, original)
    const r = await s.call("install", "--host", flag)
    expect(r.code).toBe(0)
    expect(r.out).toContain("backup:")
    const [backup] = s.backups()
    expect(backup).toStartWith(`${host}-`)
    expect(readFileSync(join(s.home, ".kimo", "mcp", "backups", backup as string), "utf8")).toBe(
      original,
    )
    const after = readFileSync(p, "utf8")
    if (host === "codex") expect(after.startsWith(original)).toBe(true)
    else {
      const j = JSON.parse(after)
      expect(j.theme).toBe("dark")
      expect(j[rootKey(host)].other).toEqual({ command: "o" })
      expect(after).toContain('\n    "theme"') // indentation kept
    }
    const rm = await s.call("remove", "--host", flag)
    expect(rm.code).toBe(0)
    expect(rm.out).toContain("removed")
    const back = readFileSync(p, "utf8")
    if (host === "codex") expect(back.trimEnd()).toBe(original.trimEnd())
    else expect(JSON.parse(back)).toEqual(JSON.parse(original))
    const rm2 = await s.call("remove", "--host", flag)
    expect(rm2.out).toContain("not-installed")
  })
})

describe("kimo mcp install: unparsable config", () => {
  for (const host of ["claude-code", "codex"] as const)
    test(`${host}: refused with exit 1, file untouched, no backup, snippet printed`, async () => {
      const s = session()
      const p = s.path(host)
      const broken =
        host === "codex"
          ? `model = "o5"\n[mcp_servers.other\ncommand = "x"\n`
          : `{\n  // my servers\n  "${rootKey(host)}": {}\n}\n`
      put(p, broken)
      const r = await s.call("install", "--host", host)
      expect(r.code).toBe(1)
      expect(r.out).toContain("ERROR")
      expect(r.out).toContain("kimo")
      expect(readFileSync(p, "utf8")).toBe(broken)
      expect(s.backups()).toEqual([])
      const st = await s.call("status", "--host", host)
      expect(st.out).toContain("unreadable")
    })
})

describe("kimo mcp install: host selection and launcher", () => {
  test("without --host, install targets only detected hosts", async () => {
    const s = session()
    mkdirSync(join(s.home, ".codex"), { recursive: true })
    put(join(s.home, ".claude.json"), `{"numStartups": 3}\n`)
    const r = await s.call("install")
    expect(r.code).toBe(0)
    expect(existsSync(s.path("claude-code"))).toBe(true)
    expect(existsSync(s.path("codex"))).toBe(true)
    expect(existsSync(s.path("cursor"))).toBe(false)
    expect(JSON.parse(readFileSync(s.path("claude-code"), "utf8")).numStartups).toBe(3)
  })

  test("no hosts detected: usage error", async () => {
    const s = session()
    const r = await s.call("install")
    expect(r.code).toBe(64)
    expect(r.err).toContain("--host")
  })

  test("bundled shim is used when the app is installed; status flags an outdated entry", async () => {
    const s = session()
    await s.call("install", "--host", "cursor")
    const shim = join(s.home, "Kimo.app", "Contents", "MacOS", "kimo-mcp")
    put(shim, "#!/bin/sh\n")
    const env2 = { ...s.env, KIMO_MCP_SHIM_CANDIDATES: shim }
    const io = (out: string[]): CliIO => ({
      stdout: (t) => out.push(t),
      stderr: () => {},
      env: env2,
      cwd: s.home,
    })
    const o1: string[] = []
    await run(["mcp", "status", "--host", "cursor"], io(o1))
    expect(o1.join("")).toContain("outdated")
    const o2: string[] = []
    expect(await run(["mcp", "install", "--host", "cursor"], io(o2))).toBe(0)
    expect(o2.join("")).toContain("updated")
    const e = JSON.parse(readFileSync(s.path("cursor"), "utf8")).mcpServers.kimo
    expect(e).toEqual({ type: "stdio", command: shim, args: ["--client", "cursor"] })
  })

  test("resolveLauncher: falls back to bunx unless a shim is found, and the CLI can be forced", () => {
    const base = { os: "macos" as const, home: "/h", env: {} }
    expect(resolveLauncher({ ...base, exists: () => false }).launcher).toEqual({
      kind: "cli",
      command: "bunx",
      prefixArgs: ["@kimo/cli"],
    })
    expect(
      resolveLauncher({ ...base, env: { KIMO_MCP_SHIM: "/y" }, exists: () => false }).launcher,
    ).toEqual({ kind: "shim", command: "/y" })
    expect(resolveLauncher({ ...base, useCli: true, exists: () => true }).launcher.kind).toBe("cli")
  })
})

describe("installer compare-and-swap (Claude Code writes ~/.claude.json concurrently)", () => {
  test("a write that lands between our read and our rename is merged, not clobbered", () => {
    const home = tmp()
    const p = join(home, ".claude.json")
    writeFileSync(p, `${JSON.stringify({ numStartups: 1 }, null, 2)}\n`)
    let raced = false
    const racingFs: InstallerFs = {
      read: nodeInstallerFs.read,
      now: nodeInstallerFs.now,
      writeAtomic(path, text, expect) {
        if (path === p && !raced) {
          raced = true
          // Claude Code saves its own state right before our rename.
          writeFileSync(p, `${JSON.stringify({ numStartups: 2, projects: {} }, null, 2)}\n`)
        }
        return nodeInstallerFs.writeAtomic(path, text, expect)
      },
    }
    const r = install(
      "claude-code",
      { kind: "cli", command: "kimo" },
      { home, os: "macos", scope: "user" },
      racingFs,
    )
    expect(r.plan.ok).toBe(true)
    const j = JSON.parse(readFileSync(p, "utf8"))
    expect(j.numStartups).toBe(2)
    expect(j.projects).toEqual({})
    expect(j.mcpServers.kimo.command).toBe("kimo")
  })

  test("keeps the file mode of an existing config", () => {
    const home = tmp()
    const p = join(home, ".gemini", "settings.json")
    put(p, "{}\n")
    const { chmodSync } = require("node:fs") as typeof import("node:fs")
    chmodSync(p, 0o644)
    install("gemini-cli", { kind: "cli", command: "kimo" }, { home, os: "macos", scope: "user" })
    expect(statSync(p).mode & 0o777).toBe(0o644)
  })
})
