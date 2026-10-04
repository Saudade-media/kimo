/**
 * Builds the `kimo-mcp` stdio shim (ADR 0008, ADR 0013 §7) in release mode and stages it as a
 * Tauri sidecar: `src-tauri/binaries/kimo-mcp-<target-triple>[.exe]`. `tauri build --config
 * src-tauri/tauri.bundle.conf.json` then bundles it next to the app binary
 * (`Kimo.app/Contents/MacOS/kimo-mcp`, …), the path `kimo_mcp_status.shimPath` reports.
 *
 * Usage: bun scripts/build-shim.ts [--target <triple>]
 *
 * `--target universal-apple-darwin` (what `tauri build --target universal-apple-darwin` asks
 * for) builds `aarch64-apple-darwin` and `x86_64-apple-darwin`, stages both, and joins them with
 * `lipo` into `kimo-mcp-universal-apple-darwin`. Both Rust targets must be installed
 * (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`).
 */
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "src-tauri")
const argTarget = process.argv.indexOf("--target")
const explicit = argTarget >= 0 ? process.argv[argTarget + 1] : process.env.TAURI_ENV_TARGET_TRIPLE
const UNIVERSAL = "universal-apple-darwin"

function hostTriple(): string {
  const out = spawnSync("rustc", ["-vV"], { encoding: "utf8" })
  const line = out.stdout.split("\n").find((l) => l.startsWith("host: "))
  if (!line) throw new Error("could not read the host triple from `rustc -vV`")
  return line.slice("host: ".length).trim()
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: "inherit" })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

/** Builds the shim for `triple` (`explicit`: pass `--target`) and returns the staged path. */
function stage(triple: string, explicitTarget: boolean): string {
  const args = ["build", "--release", "-p", "kimo-mcp", "--manifest-path", join(root, "Cargo.toml")]
  if (explicitTarget) args.push("--target", triple)
  run("cargo", args)
  const exe = triple.includes("windows") ? ".exe" : ""
  const targetDir = process.env.CARGO_TARGET_DIR ?? join(root, "target")
  const built = join(targetDir, ...(explicitTarget ? [triple] : []), "release", `kimo-mcp${exe}`)
  mkdirSync(join(root, "binaries"), { recursive: true })
  const staged = join(root, "binaries", `kimo-mcp-${triple}${exe}`)
  copyFileSync(built, staged)
  console.log(`staged ${staged}`)
  return staged
}

if (explicit === UNIVERSAL) {
  const parts = ["aarch64-apple-darwin", "x86_64-apple-darwin"].map((t) => stage(t, true))
  const out = join(root, "binaries", `kimo-mcp-${UNIVERSAL}`)
  run("lipo", ["-create", "-output", out, ...parts])
  console.log(`staged ${out}`)
} else {
  stage(explicit ?? hostTriple(), Boolean(explicit))
}
