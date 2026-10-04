/**
 * Board 25 §7 (a) "Licenses" rule: the open-source licence list is generated from bun.lock +
 * Cargo.lock + the bundled fonts, never hand-written.
 *
 *   bun scripts/gen-notices.ts          regenerate
 *   bun scripts/gen-notices.ts --check  exit 1 when the committed files are stale (CI)
 *
 * Shipped set:
 * - JavaScript: every package reachable from the `dependencies` (not devDependencies) of the
 *   workspaces that ship — @kimo/web and @kimo/desktop, through their workspace packages —
 *   resolved in bun.lock; version, licence and licence file from the installed package.
 * - Rust: every crate reachable through normal (non-dev, non-build) edges from the desktop crate,
 *   from `cargo metadata --offline` over Cargo.lock; licence and licence files from the crate
 *   sources in the local cargo registry.
 * - Fonts: the TTFs in packages/renderer/assets/fonts (version from the `name` table, OFL text
 *   beside them).
 *
 * Writes:
 * - src/settings/generated/notices.json: the list the About pane renders (name, version, SPDX
 *   licence, source, text id);
 * - src/settings/generated/notices-texts.json: the deduplicated licence texts (lazy chunk; a row
 *   opens its text in a sheet);
 * - public/THIRD_PARTY_NOTICES.txt: the full texts that ship with the app (footer "Open file").
 *
 * When cargo or node_modules are unavailable, `--check` warns and passes (the committed files
 * stay authoritative); a regenerate refuses to drop a whole source.
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const web = join(import.meta.dir, "..")
const root = join(web, "..", "..")
const tauri = join(root, "apps/desktop/src-tauri")
const fontsDir = join(root, "packages/renderer/assets/fonts")
const outList = join(web, "src/settings/generated/notices.json")
const outTexts = join(web, "src/settings/generated/notices-texts.json")
const outTxt = join(web, "public/THIRD_PARTY_NOTICES.txt")
const check = process.argv.includes("--check")

export interface Notice {
  name: string
  version: string
  /** SPDX expression as the package declares it ("MIT", "Apache-2.0 OR MIT"). */
  license: string
  source: "npm" | "cargo" | "font"
  /** Key into notices-texts.json; null when the package ships no licence file. */
  text: string | null
}

const texts = new Map<string, string>()
function textId(body: string | null): string | null {
  if (!body?.trim()) return null
  const norm = `${body.replace(/\r\n?/g, "\n").trim()}\n`
  // Whitespace-insensitive identity: the same licence reflowed is one text.
  const key = norm.replace(/\s+/g, " ").trim()
  const id = createHash("sha256").update(key).digest("hex").slice(0, 12)
  if (!texts.has(id)) texts.set(id, norm)
  return id
}

const LICENSE_FILE = /^(licen[cs]e|copying|unlicense|notice)([-._].*)?(\.(md|txt|markdown))?$/i
function licenceFiles(dir: string): string[] {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.filter((n) => LICENSE_FILE.test(n)).sort()
}
function readLicence(dir: string, explicit?: string | null): string | null {
  const files = explicit ? [explicit] : licenceFiles(dir)
  const parts: string[] = []
  for (const f of files) {
    try {
      parts.push(readFileSync(join(dir, f), "utf8").trim())
    } catch {}
  }
  return parts.length ? parts.join("\n\n---\n\n") : null
}

// --- JavaScript (bun.lock) ---------------------------------------------------------------------

type LockEntry = [
  string,
  string?,
  {
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    optionalPeers?: string[]
  }?,
  string?,
]
interface Lock {
  workspaces: Record<string, { name?: string; dependencies?: Record<string, string> }>
  packages: Record<string, LockEntry>
}

function npmNotices(): Notice[] | null {
  const raw = readFileSync(join(root, "bun.lock"), "utf8").replace(/,(\s*[}\]])/g, "$1")
  const lock = JSON.parse(raw) as Lock
  if (!existsSync(join(root, "node_modules"))) return null
  const wsByName = new Map<string, { path: string; deps: Record<string, string> }>()
  for (const [path, w] of Object.entries(lock.workspaces))
    if (w.name) wsByName.set(w.name, { path, deps: w.dependencies ?? {} })
  const seen = new Map<string, Notice>()
  const visitedWs = new Set<string>()
  /** `a/@s/b/c` → ["a", "@s/b", "c"] (scoped names keep their two parts). */
  const names = (key: string): string[] => {
    const out: string[] = []
    const parts = key.split("/")
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] as string
      if (p.startsWith("@") && i + 1 < parts.length) {
        out.push(`${p}/${parts[i + 1]}`)
        i++
      } else out.push(p)
    }
    return out
  }
  /** bun.lock keys nested versions as `parent/dep`; walk up to the hoisted one. */
  const resolve = (parentKey: string, dep: string): string | null => {
    const chain = parentKey ? names(parentKey) : []
    for (let n = chain.length; n >= 0; n--) {
      const k = [...chain.slice(0, n), dep].join("/")
      if (lock.packages[k]) return k
    }
    return null
  }
  // Bun's isolated layout: node_modules/.bun/<name, "/" → "+">@<version>[+<peer hash>]/node_modules/<name>.
  const store = join(root, "node_modules/.bun")
  const storeDirs = existsSync(store) ? readdirSync(store) : []
  const pkgDir = (name: string, version: string): string => {
    const base = `${name.replace("/", "+")}@${version}`
    const hit = storeDirs.find((d) => d === base || d.startsWith(`${base}+`))
    return hit ? join(store, hit, "node_modules", name) : join(root, "node_modules", name)
  }
  const visitWs = (name: string) => {
    if (visitedWs.has(name)) return
    visitedWs.add(name)
    const ws = wsByName.get(name)
    if (!ws) return
    for (const dep of Object.keys(ws.deps)) visit("", dep)
  }
  const visit = (parentKey: string, dep: string) => {
    if (wsByName.has(dep)) return visitWs(dep)
    const key = resolve(parentKey, dep)
    if (!key) return
    const entry = lock.packages[key] as LockEntry
    const spec = entry[0]
    const at = spec.lastIndexOf("@")
    const name = spec.slice(0, at)
    const version = spec.slice(at + 1)
    if (version.startsWith("workspace:")) return visitWs(name)
    const id = `${name}@${version}`
    if (seen.has(id)) return
    const dir = pkgDir(name, version)
    let license = "UNKNOWN"
    let licenseFile: string | null = null
    try {
      const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        license?: string | { type?: string }
        licenses?: { type?: string }[]
      }
      license =
        typeof pj.license === "string"
          ? pj.license
          : (pj.license?.type ?? pj.licenses?.map((l) => l.type).join(" OR ") ?? "UNKNOWN")
      const m = /^SEE LICEN[CS]E IN (.+)$/i.exec(license)
      if (m) licenseFile = (m[1] as string).trim()
    } catch {}
    seen.set(id, {
      name,
      version,
      license,
      source: "npm",
      text: textId(readLicence(dir, licenseFile)),
    })
    const meta = entry[2] ?? {}
    const optionalPeers = new Set(meta.optionalPeers ?? [])
    for (const d of Object.keys(meta.dependencies ?? {})) visit(key, d)
    for (const d of Object.keys(meta.optionalDependencies ?? {})) visit(key, d)
    for (const d of Object.keys(meta.peerDependencies ?? {}))
      if (!optionalPeers.has(d)) visit(key, d)
  }
  visitWs("@kimo/web")
  visitWs("@kimo/desktop")
  return [...seen.values()]
}

// --- Rust (cargo metadata over Cargo.lock) -----------------------------------------------------

interface CargoMeta {
  packages: {
    id: string
    name: string
    version: string
    license: string | null
    license_file: string | null
    manifest_path: string
    source: string | null
  }[]
  resolve: {
    root: string | null
    nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }[]
  }
}

/** The desktop app's release targets: crates for other platforms never ship. */
const SHIPPED_TARGETS = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
]

function cargoNotices(): Notice[] | null {
  const r = spawnSync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--locked",
      "--offline",
      ...SHIPPED_TARGETS.flatMap((t) => ["--filter-platform", t]),
      "--manifest-path",
      join(tauri, "Cargo.toml"),
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  )
  if (r.status !== 0 || !r.stdout) return null
  const meta = JSON.parse(r.stdout) as CargoMeta
  const byId = new Map(meta.packages.map((p) => [p.id, p]))
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]))
  const rootId = meta.resolve.root
  if (!rootId) return null
  const reach = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop() as string
    if (reach.has(id)) continue
    reach.add(id)
    for (const d of nodes.get(id)?.deps ?? [])
      if (d.dep_kinds.some((k) => k.kind === null)) stack.push(d.pkg)
  }
  const out: Notice[] = []
  for (const id of reach) {
    const p = byId.get(id)
    // Kimo's own crates (path sources) are not third-party.
    if (!p || p.source === null) continue
    const dir = dirname(p.manifest_path)
    out.push({
      name: p.name,
      version: p.version,
      license: p.license ?? (p.license_file ? "SEE LICENSE FILE" : "UNKNOWN"),
      source: "cargo",
      text: textId(readLicence(dir, p.license_file)),
    })
  }
  return out
}

// --- Bundled fonts -----------------------------------------------------------------------------

/** The `name` table's version string (nameID 5, "Version 4.001;git-…" → "4.001"). */
export function ttfVersion(bytes: Uint8Array): string | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const numTables = v.getUint16(4)
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    const tag = String.fromCharCode(...bytes.subarray(rec, rec + 4))
    if (tag !== "name") continue
    const off = v.getUint32(rec + 8)
    const count = v.getUint16(off + 2)
    const strings = off + v.getUint16(off + 4)
    for (let j = 0; j < count; j++) {
      const r = off + 6 + j * 12
      const platform = v.getUint16(r)
      const nameId = v.getUint16(r + 6)
      if (nameId !== 5) continue
      const len = v.getUint16(r + 8)
      const start = strings + v.getUint16(r + 10)
      const raw = bytes.subarray(start, start + len)
      let s = ""
      if (platform === 3 || platform === 0)
        for (let k = 0; k + 1 < raw.length; k += 2)
          s += String.fromCharCode((raw[k] as number) * 256 + (raw[k + 1] as number))
      else s = String.fromCharCode(...raw)
      const m = /(\d+(?:\.\d+)+)/.exec(s)
      return m ? (m[1] as string) : s.trim()
    }
  }
  return null
}

function fontNotices(): Notice[] {
  const families: [string, string, string][] = [
    ["Inter (font)", "Inter-", "OFL-Inter.txt"],
    ["JetBrains Mono (font)", "JetBrainsMono-", "OFL-JetBrainsMono.txt"],
  ]
  const files = readdirSync(fontsDir)
  const out: Notice[] = []
  for (const [name, prefix, ofl] of families) {
    const ttf = files.filter((f) => f.startsWith(prefix) && f.endsWith(".ttf")).sort()[0]
    if (!ttf) continue
    const version = ttfVersion(new Uint8Array(readFileSync(join(fontsDir, ttf)))) ?? "—"
    out.push({
      name,
      version,
      license: "OFL-1.1",
      source: "font",
      text: textId(readFileSync(join(fontsDir, ofl), "utf8")),
    })
  }
  return out
}

// --- Output ------------------------------------------------------------------------------------

const npm = npmNotices()
const cargo = cargoNotices()
if (!npm || !cargo) {
  const missing = [!npm && "node_modules (bun install)", !cargo && "cargo metadata --offline"]
    .filter(Boolean)
    .join(" and ")
  if (check) {
    console.warn(`gen-notices: skipped the staleness check (${missing} unavailable)`)
    process.exit(0)
  }
  console.error(`gen-notices: ${missing} unavailable; refusing to drop a whole source`)
  process.exit(1)
}
const order = { npm: 0, cargo: 1, font: 2 } as const
const all = [...npm, ...cargo, ...fontNotices()].sort(
  (a, b) =>
    order[a.source] - order[b.source] ||
    a.name.localeCompare(b.name, "en") ||
    a.version.localeCompare(b.version, "en"),
)
const used = new Set(all.map((n) => n.text).filter((t): t is string => t !== null))
const textsOut = Object.fromEntries(
  [...texts].filter(([k]) => used.has(k)).sort(([a], [b]) => a.localeCompare(b)),
)

const listText = `${JSON.stringify(
  { $comment: "Generated by apps/web/scripts/gen-notices.ts. Do not edit.", packages: all },
  null,
  1,
)}\n`
const textsText = `${JSON.stringify(textsOut)}\n`

// THIRD_PARTY_NOTICES.txt: packages grouped under each distinct licence text.
const groups = new Map<string, Notice[]>()
for (const n of all) {
  const k = n.text ?? `none:${n.license}`
  groups.set(k, [...(groups.get(k) ?? []), n])
}
const rule = "-".repeat(79)
let txt = `Kimo — third-party notices\n\nKimo is licensed under the MIT License (see LICENSE). It ships with the\n${all.length} open-source packages below: JavaScript packages from bun.lock, Rust crates\nfrom Cargo.lock and the bundled fonts. Generated by apps/web/scripts/gen-notices.ts.\n`
for (const [k, list] of groups) {
  txt += `\n${rule}\n`
  for (const n of list) txt += `${n.name} ${n.version} (${n.source}) — ${n.license}\n`
  txt += `${rule}\n\n`
  txt += k.startsWith("none:")
    ? "No licence file is included in this package.\n"
    : (texts.get(k) as string)
}

const outputs: [string, string][] = [
  [outList, listText],
  [outTexts, textsText],
  [outTxt, txt],
]
if (check) {
  const stale = outputs.filter(([p, t]) => {
    try {
      return readFileSync(p, "utf8") !== t
    } catch {
      return true
    }
  })
  if (stale.length) {
    console.error(
      `gen-notices: stale ${stale.map(([p]) => p.slice(root.length + 1)).join(", ")}: run \`bun run gen:notices\` in apps/web`,
    )
    process.exit(1)
  }
} else {
  for (const [p, t] of outputs) {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, t)
  }
  console.log(
    `gen-notices: ${all.length} packages (${npm.length} npm, ${cargo.length} cargo, ${all.length - npm.length - cargo.length} fonts), ${used.size} texts`,
  )
}
