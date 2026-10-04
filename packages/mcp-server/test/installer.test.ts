/**
 * Host installer (teardown 11.5, ADR 0013 §9). Every test uses a temp HOME: the real user
 * config is never read or written.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { configPath, HOSTS, install, type Launcher, remove, status } from "../src/installer"

let home: string
const shim: Launcher = { kind: "shim", command: "/Applications/Kimo.app/Contents/MacOS/kimo-mcp" }
const ctx = () => ({ home, os: "macos" as const, scope: "user" as const })
const put = (p: string, text: string) => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, text)
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kimo-installer-"))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe("paths", () => {
  test("user and project config files", () => {
    expect(configPath("claude-code", "user", { home: "/h", os: "macos" })).toBe("/h/.claude.json")
    expect(configPath("codex", "user", { home: "/h", os: "linux" })).toBe("/h/.codex/config.toml")
    expect(configPath("gemini-cli", "user", { home: "/h", os: "linux" })).toBe(
      "/h/.gemini/settings.json",
    )
    expect(configPath("cursor", "user", { home: "/h", os: "linux" })).toBe("/h/.cursor/mcp.json")
    expect(configPath("vscode", "user", { home: "/h", os: "macos" })).toBe(
      "/h/Library/Application Support/Code/User/mcp.json",
    )
    expect(configPath("vscode", "user", { home: "/h", os: "linux" })).toBe(
      "/h/.config/Code/User/mcp.json",
    )
    expect(configPath("claude-code", "project", { home: "/h", os: "linux", project: "/r" })).toBe(
      "/r/.mcp.json",
    )
    expect(configPath("vscode", "project", { home: "/h", os: "linux", project: "/r" })).toBe(
      "/r/.vscode/mcp.json",
    )
  })
})

describe.each([...HOSTS])("%s", (host) => {
  test("install into a missing file, idempotent, then remove", () => {
    const r1 = install(host, shim, ctx())
    expect(r1.plan.ok && r1.plan.changed).toBe(true)
    expect(status(host, shim, ctx())).toMatchObject({ installed: true, current: true })
    const r2 = install(host, shim, ctx())
    expect(r2.plan.ok && r2.plan.changed).toBe(false)
    remove(host, ctx())
    expect(status(host, shim, ctx()).installed).toBe(false)
  })

  test("preserves other entries and keys, and backs up", () => {
    const p = configPath(host, "user", ctx())
    const other =
      host === "codex"
        ? `model = "o5"\n\n[mcp_servers.other]\ncommand = "other"\nargs = ["x"]\n`
        : JSON.stringify(
            {
              theme: "dark",
              [host === "vscode" ? "servers" : "mcpServers"]: { other: { command: "other" } },
            },
            null,
            2,
          )
    put(p, other)
    const r = install(host, shim, ctx())
    expect(r.backup).toBeDefined()
    expect(readFileSync(r.backup as string, "utf8")).toBe(other)
    const after = readFileSync(p, "utf8")
    expect(after).toContain("other")
    if (host === "codex") expect(after.startsWith(other)).toBe(true)
    else {
      const j = JSON.parse(after)
      expect(j.theme).toBe("dark")
      expect(Object.keys(j[host === "vscode" ? "servers" : "mcpServers"]).sort()).toEqual([
        "kimo",
        "other",
      ])
    }
    remove(host, ctx())
    const back = readFileSync(p, "utf8")
    if (host === "codex") expect(back.trimEnd()).toBe(other.trimEnd())
    else expect(JSON.parse(back)).toEqual(JSON.parse(other))
  })

  test("never rewrites an unparsable file", () => {
    if (host === "codex") return
    const p = configPath(host, "user", ctx())
    const jsonc = `{\n  // my servers\n  "mcpServers": {}\n}\n`
    put(p, jsonc)
    const r = install(host, shim, ctx())
    expect(r.plan.ok).toBe(false)
    if (!r.plan.ok) expect(r.plan.snippet).toContain("kimo")
    expect(readFileSync(p, "utf8")).toBe(jsonc)
    expect(existsSync(join(home, ".kimo", "mcp", "backups"))).toBe(false)
  })

  test("dryRun writes nothing", () => {
    const r = install(host, shim, { ...ctx(), dryRun: true })
    expect(r.plan.ok && r.plan.after).toContain("kimo")
    expect(existsSync(configPath(host, "user", ctx()))).toBe(false)
  })
})

test("entries: stdio shape per host; no secrets", () => {
  install("claude-code", shim, ctx())
  install("gemini-cli", shim, ctx())
  install("vscode", shim, ctx())
  install("codex", shim, ctx())
  const cc = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")).mcpServers.kimo
  expect(cc).toEqual({ type: "stdio", command: shim.command, args: ["--client", "claude-code"] })
  const gm = JSON.parse(readFileSync(join(home, ".gemini/settings.json"), "utf8")).mcpServers.kimo
  expect(gm.type).toBeUndefined()
  expect(gm.args).toEqual(["--client", "gemini-cli"])
  const vs = JSON.parse(readFileSync(configPath("vscode", "user", ctx()), "utf8")).servers.kimo
  expect(vs.type).toBe("stdio")
  const toml = readFileSync(join(home, ".codex/config.toml"), "utf8")
  expect(toml).toContain("[mcp_servers.kimo]")
  expect(toml).toContain('args = ["--client", "codex"]')
  for (const f of [".claude.json", ".gemini/settings.json", ".codex/config.toml"])
    expect(readFileSync(join(home, f), "utf8")).not.toMatch(/token|Bearer/i)
  expect(readdirSync(home)).toContain(".claude.json")
})
