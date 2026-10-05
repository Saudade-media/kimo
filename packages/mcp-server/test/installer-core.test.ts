/**
 * The desktop window imports `./installer-core` (apps/web/src/host/mcp-api.ts). Vite stubs Node
 * built-ins in a webview, so a `node:` import there blanks the window: keep the core free of them.
 */
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { configPath } from "../src/installer-core"

test("installer-core has no Node imports", () => {
  const src = readFileSync(join(import.meta.dir, "../src/installer-core.ts"), "utf8")
  expect(src).not.toMatch(/from "node:|require\(/)
})

test("config paths use the target OS separator", () => {
  expect(configPath("claude-code", "user", { home: "/h/", os: "macos" })).toBe("/h/.claude.json")
  expect(configPath("codex", "user", { home: "C:\\Users\\g", os: "windows" })).toBe(
    "C:\\Users\\g\\.codex\\config.toml",
  )
  expect(configPath("vscode", "user", { home: "C:\\Users\\g", os: "windows" })).toBe(
    "C:\\Users\\g\\AppData\\Roaming\\Code\\User\\mcp.json",
  )
  expect(
    configPath("vscode", "user", { home: "C:\\Users\\g", os: "windows", appData: "D:\\AD\\" }),
  ).toBe("D:\\AD\\Code\\User\\mcp.json")
})
