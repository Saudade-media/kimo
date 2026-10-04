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
import {
  CODEX_TOOLS_APPROVAL_MODE,
  configPath,
  HOSTS,
  install,
  type Launcher,
  remove,
  status,
} from "../src/installer"

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

describe("codex: default_tools_approval_mode (opt-in)", () => {
  const read = () => readFileSync(join(home, ".codex/config.toml"), "utf8")
  const approve = () => ({ ...ctx(), codexApproval: "approve" as const })
  test("by default the user's Codex keeps its own prompts (no approval key written)", () => {
    expect(CODEX_TOOLS_APPROVAL_MODE).toBe("approve")
    install("codex", shim, ctx())
    expect(read()).toContain("[mcp_servers.kimo]")
    expect(read()).not.toContain("default_tools_approval_mode")
  })
  test("--auto-approve writes it inside the kimo table", () => {
    install("codex", shim, approve())
    const toml = read()
    const table = toml.slice(toml.indexOf("[mcp_servers.kimo]"))
    expect(table).toContain('default_tools_approval_mode = "approve"')
  })
  test("HTTP entries carry it too when opted in", () => {
    install("codex", { kind: "http", url: "http://127.0.0.1:47820/mcp", token: "t" }, approve())
    expect(read()).toContain('default_tools_approval_mode = "approve"')
  })
  test("idempotent: a second opted-in install changes nothing and writes the key once", () => {
    install("codex", shim, approve())
    const once = read()
    install("codex", shim, approve())
    expect(read()).toBe(once)
    expect(read().match(/default_tools_approval_mode/g)?.length).toBe(1)
  })
  test("a value the user set in the kimo table survives a plain reinstall; others' tables untouched", () => {
    install("codex", shim, approve())
    const edited = `${read().replace('default_tools_approval_mode = "approve"', 'default_tools_approval_mode = "writes"')}\n[mcp_servers.other]\ncommand = "o"\ndefault_tools_approval_mode = "prompt"\n`
    writeFileSync(join(home, ".codex/config.toml"), edited)
    install("codex", { kind: "shim", command: "/opt/kimo-mcp" }, ctx())
    const after = read()
    expect(after).toContain('command = "/opt/kimo-mcp"')
    const kimo = after.slice(after.indexOf("[mcp_servers.kimo]"))
    expect(kimo).toContain('default_tools_approval_mode = "writes"')
    expect(after).not.toContain('default_tools_approval_mode = "approve"')
    expect(after).toContain(
      '[mcp_servers.other]\ncommand = "o"\ndefault_tools_approval_mode = "prompt"',
    )
  })
  test("an invalid hand-set value is dropped on a plain reinstall", () => {
    install("codex", shim, approve())
    writeFileSync(join(home, ".codex/config.toml"), read().replace('"approve"', '"always"'))
    install("codex", { kind: "shim", command: "/opt/kimo-mcp" }, ctx())
    expect(read()).not.toContain("default_tools_approval_mode")
  })
  test("remove drops the key with the table", () => {
    install("codex", shim, ctx())
    remove("codex", ctx())
    expect(existsSync(join(home, ".codex/config.toml")) ? read() : "").not.toContain(
      "default_tools_approval_mode",
    )
  })
})
