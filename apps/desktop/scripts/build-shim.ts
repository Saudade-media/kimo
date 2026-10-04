/**
 * Builds the `kimo-mcp` stdio shim (ADR 0008, ADR 0013 §7) in release mode and stages it as a
 * Tauri sidecar: `src-tauri/binaries/kimo-mcp-<target-triple>[.exe]`. `tauri build --config
 * src-tauri/tauri.bundle.conf.json` then bundles it next to the app binary
 * (`Kimo.app/Contents/MacOS/kimo-mcp`, …), the path `kimo_mcp_status.shimPath` reports.
 *
 * Usage: bun scripts/build-shim.ts [--target <triple>]
 */
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "src-tauri")
const argTarget = process.argv.indexOf("--target")
const explicit = argTarget >= 0 ? process.argv[argTarget + 1] : process.env.TAURI_ENV_TARGET_TRIPLE

function hostTriple(): string {
  const out = spawnSync("rustc", ["-vV"], { encoding: "utf8" })
  const line = out.stdout.split("\n").find((l) => l.startsWith("host: "))
  if (!line) throw new Error("could not read the host triple from `rustc -vV`")
  return line.slice("host: ".length).trim()
}

const triple = explicit ?? hostTriple()
const args = ["build", "--release", "-p", "kimo-mcp", "--manifest-path", join(root, "Cargo.toml")]
if (explicit) args.push("--target", triple)
const build = spawnSync("cargo", args, { stdio: "inherit" })
if (build.status !== 0) process.exit(build.status ?? 1)

const exe = triple.includes("windows") ? ".exe" : ""
const targetDir = process.env.CARGO_TARGET_DIR ?? join(root, "target")
const built = join(targetDir, ...(explicit ? [triple] : []), "release", `kimo-mcp${exe}`)
mkdirSync(join(root, "binaries"), { recursive: true })
const staged = join(root, "binaries", `kimo-mcp-${triple}${exe}`)
copyFileSync(built, staged)
console.log(`staged ${staged}`)
