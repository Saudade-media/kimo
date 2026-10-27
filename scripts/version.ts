/**
 * Bumps the Kimo version everywhere it is spelled out, consistently:
 *
 *   - every workspace `package.json` (`apps/*`, `packages/*`)
 *   - `apps/desktop/src-tauri/tauri.conf.json` (`version`: the app, installer and updater version)
 *   - `apps/desktop/src-tauri/Cargo.toml` and `kimo-mcp/Cargo.toml` (`[package] version`)
 *   - their two entries in `apps/desktop/src-tauri/Cargo.lock` (so `cargo build --locked` holds)
 *   - the CLI's hard-coded version strings (`kimo version`, the headless MCP server info)
 *   - `@kimo/sync`'s `CLIENT_VERSION` (the multiplayer client version sent in `hello`)
 *
 * Dry run by default: prints every change and writes nothing. Pass --write to apply.
 *
 *   bun scripts/version.ts                     show the current version and any drift
 *   bun scripts/version.ts 0.2.0               plan a bump to 0.2.0 (dry run)
 *   bun scripts/version.ts minor --write       0.1.3 → 0.2.0, written
 *   bun scripts/version.ts prerelease --preid rc   0.2.0 → 0.2.1-rc.0, 0.2.1-rc.0 → 0.2.1-rc.1
 *
 * The current version is read from tauri.conf.json; files that disagree are reported as drift
 * and rewritten to the new version too. The `.kimo` format version is NOT touched: it moves only
 * with a spec change (docs/release.md, "Spec freeze").
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dir, "..")
const TAURI = join(ROOT, "apps/desktop/src-tauri")

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/

export interface Edit {
  file: string
  /** What is being changed, for the report. */
  what: string
  from: string
  to: string
}

/** One place a version lives: how to read it and how to rewrite it, preserving formatting. */
interface Site {
  file: string
  what: string
  read(text: string): string | null
  write(text: string, version: string): string
}

/** `"version": "x"` as the first top-level `version` member of a JSON file. */
const jsonVersion = (file: string, what: string): Site => ({
  file,
  what,
  read: (t) => (JSON.parse(t) as { version?: string }).version ?? null,
  write: (t, v) => t.replace(/("version"\s*:\s*")[^"]*(")/, `$1${v}$2`),
})

/** `version = "x"` inside the `[package]` table of a Cargo.toml. */
const cargoToml = (file: string, what: string): Site => {
  const pkg = /(\[package\][^[]*?\nversion\s*=\s*")([^"]*)(")/
  return {
    file,
    what,
    read: (t) => t.match(pkg)?.[2] ?? null,
    write: (t, v) => t.replace(pkg, `$1${v}$3`),
  }
}

/** The `version` of `[[package]] name = "<crate>"` in a Cargo.lock. */
const cargoLock = (file: string, crate: string): Site => {
  const entry = new RegExp(`(\\[\\[package\\]\\]\\nname = "${crate}"\\nversion = ")([^"]*)(")`)
  return {
    file,
    what: `Cargo.lock entry ${crate}`,
    read: (t) => t.match(entry)?.[2] ?? null,
    write: (t, v) => t.replace(entry, `$1${v}$3`),
  }
}

/** A version inside a source string literal, matched by a regex with one capture group. */
const literal = (file: string, what: string, re: RegExp): Site => ({
  file,
  what,
  read: (t) => t.match(re)?.[1] ?? null,
  write: (t, v) => t.replace(re, (m, old: string) => m.replace(old, v)),
})

function workspacePackages(): string[] {
  const out: string[] = []
  for (const dir of ["apps", "packages"])
    for (const name of readdirSync(join(ROOT, dir)).sort()) {
      const p = join(ROOT, dir, name, "package.json")
      try {
        readFileSync(p)
        out.push(p)
      } catch {
        // not a package
      }
    }
  return out
}

export function sites(): Site[] {
  return [
    jsonVersion(join(TAURI, "tauri.conf.json"), "app version (tauri.conf.json)"),
    ...workspacePackages().map((p) =>
      jsonVersion(p, `${(JSON.parse(readFileSync(p, "utf8")) as { name: string }).name}`),
    ),
    cargoToml(join(TAURI, "Cargo.toml"), "crate kimo-desktop"),
    cargoToml(join(TAURI, "kimo-mcp/Cargo.toml"), "crate kimo-mcp"),
    cargoLock(join(TAURI, "Cargo.lock"), "kimo-desktop"),
    cargoLock(join(TAURI, "Cargo.lock"), "kimo-mcp"),
    literal(
      join(ROOT, "packages/cli/src/cli.ts"),
      "`kimo version` output",
      /"kimo ([^ "]+) \(format/,
    ),
    literal(
      join(ROOT, "packages/cli/src/mcp/headless.ts"),
      "headless MCP server version",
      /CLI_VERSION = "([^"]+)"/,
    ),
    literal(
      join(ROOT, "packages/sync/src/network-provider.ts"),
      "multiplayer client version (sent in hello)",
      /CLIENT_VERSION = "([^"]+)"/,
    ),
  ]
}

/** `current` bumped by `spec` (an exact version, or major / minor / patch / prerelease). */
export function nextVersion(current: string, spec: string, preid = "rc"): string {
  if (SEMVER.test(spec)) return spec
  const m = current.match(SEMVER)
  if (!m) throw new Error(`current version ${current} is not semver`)
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const pre = m[4]
  switch (spec) {
    case "major":
      return pre && min === 0 && pat === 0 ? `${maj}.0.0` : `${maj + 1}.0.0`
    case "minor":
      return pre && pat === 0 ? `${maj}.${min}.0` : `${maj}.${min + 1}.0`
    case "patch":
      return pre ? `${maj}.${min}.${pat}` : `${maj}.${min}.${pat + 1}`
    case "prerelease": {
      if (pre?.startsWith(`${preid}.`)) {
        const n = Number(pre.slice(preid.length + 1))
        if (Number.isInteger(n)) return `${maj}.${min}.${pat}-${preid}.${n + 1}`
      }
      return `${maj}.${min}.${pre ? pat : pat + 1}-${preid}.0`
    }
    default:
      throw new Error(`"${spec}" is not a version or one of major, minor, patch, prerelease`)
  }
}

/** The edits a bump to `version` makes (empty `to` = unchanged sites are left out). */
export function plan(version: string): { current: string; edits: Edit[]; missing: string[] } {
  const all = sites()
  const texts = new Map<string, string>()
  const text = (f: string) => {
    if (!texts.has(f)) texts.set(f, readFileSync(f, "utf8"))
    return texts.get(f) as string
  }
  const current = all[0]?.read(text(all[0].file)) ?? "0.0.0"
  const edits: Edit[] = []
  const missing: string[] = []
  for (const s of all) {
    const from = s.read(text(s.file))
    if (from === null) {
      missing.push(`${relative(ROOT, s.file)} (${s.what})`)
      continue
    }
    if (from !== version) edits.push({ file: s.file, what: s.what, from, to: version })
  }
  return { current, edits, missing }
}

function apply(version: string, edits: Edit[]) {
  const byFile = new Map<string, Site[]>()
  const all = sites()
  for (const e of edits) {
    const s = all.find((x) => x.file === e.file && x.what === e.what)
    if (s) byFile.set(e.file, [...(byFile.get(e.file) ?? []), s])
  }
  for (const [file, list] of byFile) {
    let t = readFileSync(file, "utf8")
    for (const s of list) t = s.write(t, version)
    writeFileSync(file, t)
  }
}

function main() {
  const args = process.argv.slice(2)
  const write = args.includes("--write")
  const preIdx = args.indexOf("--preid")
  const preid = preIdx >= 0 ? (args[preIdx + 1] ?? "rc") : "rc"
  // --exclude <dir> (repeatable): leave a workspace out of this bump, e.g. one another
  // branch owns; its version then shows as drift until it is bumped too.
  const excluded = args.flatMap((a, i) => (args[i - 1] === "--exclude" ? [join(ROOT, a)] : []))
  const spec = args.find(
    (a, i) => !a.startsWith("--") && args[i - 1] !== "--preid" && args[i - 1] !== "--exclude",
  )

  const probe = plan("\0")
  const versions = new Map<string, string[]>()
  for (const e of probe.edits) versions.set(e.from, [...(versions.get(e.from) ?? []), e.what])
  console.log(`current version: ${probe.current}`)
  if (versions.size > 1) {
    console.log("drift:")
    for (const [v, whats] of versions) console.log(`  ${v}: ${whats.join(", ")}`)
  }
  for (const m of probe.missing) console.log(`  ! no version found in ${m}`)
  if (!spec) {
    console.log("\nusage: bun scripts/version.ts <x.y.z | major | minor | patch | prerelease>")
    console.log("       [--preid rc] [--exclude <dir>]... [--write]   (dry run without --write)")
    process.exit(versions.size > 1 || probe.missing.length > 0 ? 1 : 0)
  }

  const next = nextVersion(probe.current, spec, preid)
  const planned = plan(next)
  const missing = planned.missing
  const edits = planned.edits.filter((e) => !excluded.some((d) => e.file.startsWith(`${d}/`)))
  if (missing.length > 0) {
    console.error("refusing to bump: some version sites were not found (see above)")
    process.exit(1)
  }
  console.log(`\n${write ? "bumping" : "would bump"} to ${next}:`)
  for (const e of edits)
    console.log(`  ${relative(ROOT, e.file).padEnd(52)} ${e.from} → ${e.to}  (${e.what})`)
  if (edits.length === 0) console.log("  (nothing to change)")
  if (!write) {
    console.log("\ndry run: nothing written. Re-run with --write to apply.")
    return
  }
  apply(next, edits)
  console.log(
    `\nwrote ${new Set(edits.map((e) => e.file)).size} files. Next: docs/release.md step 3.`,
  )
}

if (import.meta.main) main()
