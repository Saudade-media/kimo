/**
 * Host installer (ADR 0013 §9). Every test uses a temp HOME: the real user config is never read
 * or written. Per-host install / backup / remove through the CLI is covered in
 * packages/cli/test/mcp-install.test.ts.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { install, type Launcher, remove } from "../src/installer"
import { configPath } from "../src/installer-core"

let home: string
const shim: Launcher = { kind: "shim", command: "/Applications/Kimo.app/Contents/MacOS/kimo-mcp" }
const ctx = () => ({ home, os: "macos" as const, scope: "user" as const })

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kimo-installer-"))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe("installer-core", () => {
  // The desktop window imports `./installer-core` (apps/web/src/host/mcp-api.ts). Vite stubs Node
  // built-ins in a webview, so a `node:` import there blanks the window.
  test("has no Node imports", () => {
    const src = readFileSync(join(import.meta.dir, "../src/installer-core.ts"), "utf8")
    expect(src).not.toMatch(/from "node:|require\(/)
  })

  test("config paths use the target OS separator", () => {
    expect(configPath("claude-code", "user", { home: "/h/", os: "macos" })).toBe("/h/.claude.json")
    expect(configPath("codex", "user", { home: "C:\\Users\\g", os: "windows" })).toBe(
      "C:\\Users\\g\\.codex\\config.toml",
    )
    expect(
      configPath("vscode", "user", { home: "C:\\Users\\g", os: "windows", appData: "D:\\AD\\" }),
    ).toBe("D:\\AD\\Code\\User\\mcp.json")
  })
})

describe("codex: default_tools_approval_mode (opt-in)", () => {
  const path = () => join(home, ".codex/config.toml")
  const read = () => readFileSync(path(), "utf8")
  const approve = () => ({ ...ctx(), codexApproval: "approve" as const })

  test("by default the user's Codex keeps its own prompts (no approval key written)", () => {
    install("codex", shim, ctx())
    expect(read()).toContain("[mcp_servers.kimo]")
    expect(read()).not.toContain("default_tools_approval_mode")
  })

  test("opting in writes it inside the kimo table", () => {
    install("codex", shim, approve())
    const toml = read()
    const table = toml.slice(toml.indexOf("[mcp_servers.kimo]"))
    expect(table).toContain('default_tools_approval_mode = "approve"')
  })

  test("a value the user set in the kimo table survives a plain reinstall; others' tables are untouched", () => {
    install("codex", shim, approve())
    const edited = `${read().replace('default_tools_approval_mode = "approve"', 'default_tools_approval_mode = "writes"')}\n[mcp_servers.other]\ncommand = "o"\ndefault_tools_approval_mode = "prompt"\n`
    writeFileSync(path(), edited)
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

  test("an invalid hand-set value is dropped on a plain reinstall; remove drops the key with the table", () => {
    install("codex", shim, approve())
    writeFileSync(path(), read().replace('"approve"', '"always"'))
    install("codex", { kind: "shim", command: "/opt/kimo-mcp" }, ctx())
    expect(read()).not.toContain("default_tools_approval_mode")
    install("codex", shim, approve())
    remove("codex", ctx())
    expect(existsSync(path()) ? read() : "").not.toContain("default_tools_approval_mode")
  })
})
