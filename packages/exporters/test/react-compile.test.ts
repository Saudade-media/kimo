/**
 * The React goldens must compile: every generated `.tsx` is type-checked with strict
 * TypeScript and the React 19 types (`jsx: react-jsx`).
 */
import { expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GOLDEN_DIR } from "./helpers"

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p))
    else if (p.endsWith(".tsx")) out.push(p)
  }
  return out.sort()
}

test("generated React components type-check", () => {
  const files = tsxFiles(GOLDEN_DIR)
  expect(files.length).toBeGreaterThan(0)
  const dir = mkdtempSync(join(tmpdir(), "kimo-tsx-"))
  try {
    const config = {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        lib: ["ES2022", "DOM"],
        types: [],
      },
      files,
    }
    const tsconfig = join(dir, "tsconfig.json")
    writeFileSync(tsconfig, JSON.stringify(config))
    const tsc = join(import.meta.dir, "../../../node_modules/.bin/tsc")
    const r = Bun.spawnSync([tsc, "-p", tsconfig], { stdout: "pipe", stderr: "pipe" })
    const out = `${r.stdout.toString()}${r.stderr.toString()}`
    expect(out).toBe("")
    expect(r.exitCode).toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 120_000)
