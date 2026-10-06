/**
 * Builds the bundled templates (`packages/templates`, `@kimo/templates`) from the modules in
 * `scripts/templates/*.ts` (every file but `lib.ts`). Each template becomes
 *
 *   packages/templates/files/<slug>/<slug>.kimo        canonical document
 *   packages/templates/files/<slug>/cover.png          720×450 cover (first page)
 *   packages/templates/files/<slug>/pages/<n>.png      one preview per page (its first frame)
 *   packages/templates/index.json                      the gallery index, sorted by slug
 *
 * Every document must be strictly valid (`kimo validate --strict`: no errors, no warnings), pass
 * the design check (`checkDesign`, the MCP `kimo_validate {check: true}` pass) with zero
 * problems, bind every color to a token, use auto layout (absolute only for flagged overlays)
 * and keep its copy free of the phrases docs/style/writing.md bans.
 *
 *   bun scripts/build-templates.ts                 build everything (documents + PNGs + index)
 *   bun scripts/build-templates.ts --only <slug>   build one template (index is still rewritten)
 *   bun scripts/build-templates.ts --no-png        documents and index only
 *   bun scripts/build-templates.ts --check         exit 1 when a file on disk differs from the
 *                                                  build or any rule fails (no rendering)
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join, relative } from "node:path"
import { deflateSync } from "node:zlib"
import { aiTellPhrases } from "../packages/ai-agent/src/style"
import { type DocStore, openDocument, serialize } from "../packages/editor-state/src/index"
import { checkDesign, formatProblems } from "../packages/mcp-server/src/handlers/check"
import {
  absoluteIssues,
  type Body,
  type BuiltTemplate,
  buildTemplate,
  rawColorIssues,
  type Template,
} from "./templates/lib"

const ROOT = join(import.meta.dir, "..")
const PKG = join(ROOT, "packages", "templates")
const FILES = join(PKG, "files")
const SRC = join(import.meta.dir, "templates")
const args = process.argv.slice(2)
const CHECK = args.includes("--check")
const PNG = !CHECK && !args.includes("--no-png")
const onlyAt = args.indexOf("--only")
const ONLY = onlyAt >= 0 ? args[onlyAt + 1] : undefined

/** Everything the app ships (documents and previews) for all templates. */
const BUDGET = 6.5 * 1024 * 1024
const COVER_W = 720
const SCREEN_W = 480
const MOBILE_SCALE = 0.75
/** Screen previews are cut at this height (top of the frame), so long pages stay small. */
const SCREEN_MAX_H = 1200

export interface IndexEntry {
  slug: string
  name: string
  category: string
  description: string
  /** Category pages, in order (Cover, Screens…, Components, Foundations). */
  pages: string[]
  /** Paths relative to the package root. */
  file: string
  cover: string
  screens: { name: string; page: string; preview: string; width: number; height: number }[]
}

const screenFile = (i: number, name: string) =>
  `${String(i + 1).padStart(2, "0")}-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}.png`

async function loadTemplates(): Promise<Template[]> {
  const files = readdirSync(SRC)
    .filter((f) => f.endsWith(".ts") && f !== "lib.ts" && !f.endsWith(".test.ts"))
    .sort()
  const out: Template[] = []
  for (const f of files) {
    const mod = (await import(join(SRC, f))) as { template?: Template }
    if (!mod.template) throw new Error(`${f}: no \`template\` export`)
    if (`${mod.template.slug}.ts` !== f) throw new Error(`${f}: slug must match the file name`)
    out.push(mod.template)
  }
  const prefixes = new Map<string, string>()
  for (const t of out) {
    const seen = prefixes.get(t.prefix)
    if (seen) throw new Error(`${t.slug}: prefix "${t.prefix}" already used by ${seen}`)
    prefixes.set(t.prefix, t.slug)
  }
  return out
}

function strictIssues(text: string): string[] {
  const r = openDocument(text, { libraries: {}, lints: true, allowInvalid: true })
  if (r.readOnly) return r.readOnlyReasons.map((x) => `read-only: ${x.message}`)
  const v = r.validation
  if (!v) return ["not validated"]
  return [...v.errors, ...v.warnings].map((i) => `${i.severity} ${i.code} ${i.path} ${i.message}`)
}

type LayoutResult = import("../packages/layout/src/index").LayoutResult

// --- layout, check and rendering -------------------------------------------------------------------

interface Scene {
  layoutOf(): Promise<import("../packages/layout/src/index").LayoutResult>
  raster(id: string, scale: number): Promise<Uint8Array>
  dispose(): void
}

async function scene(store: DocStore): Promise<Scene> {
  const { createInstanceView, createResolver, createLayoutEngine } = await import(
    "../packages/layout/src/index"
  )
  const { createRenderer } = await import("../packages/renderer/src/index")
  const header = () => store.toHeader() as never
  const view = createInstanceView(store, { header, libraries: {} })
  const resolve = createResolver(header, view, { libraries: {} })
  const engine = createLayoutEngine()
  await engine.init()
  const r = createRenderer()
  await r.init({ offlineFonts: true })
  const compute = () =>
    engine.compute({ nodes: store, expanded: view, resolve, measureText: r.textMeasurer() })
  let layout = compute()
  r.setDocument({ nodes: view, header, resolve, assets: { load: async () => null } } as never)
  r.setLayout(layout)
  for (const id of store.children(null)) await r.ensureFonts?.(id)
  layout = compute()
  r.setLayout(layout)
  return {
    async layoutOf() {
      return layout
    },
    raster: (id, scale) => r.exportRaster(id, { scale }),
    dispose() {
      r.dispose()
      engine.dispose()
    },
  }
}

/** A compact PNG (RGB, per-row filter choice, deflate level 9) from RGBA pixels. */
function encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const stride = w * 3
  const raw = Buffer.alloc((stride + 1) * h)
  const prev = Buffer.alloc(stride)
  const cur = Buffer.alloc(stride)
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      const a = (rgba[s + 3] ?? 255) / 255
      // Composite over white (frames are opaque; this only matters for antialiased edges).
      cur[x * 3] = Math.round((rgba[s] ?? 0) * a + 255 * (1 - a))
      cur[x * 3 + 1] = Math.round((rgba[s + 1] ?? 0) * a + 255 * (1 - a))
      cur[x * 3 + 2] = Math.round((rgba[s + 2] ?? 0) * a + 255 * (1 - a))
    }
    let best = 0
    let bestSum = Number.POSITIVE_INFINITY
    for (let f = 0; f < 5; f++) {
      const out = cand[f] as Buffer
      let sum = 0
      for (let i = 0; i < stride; i++) {
        const left = i >= 3 ? (cur[i - 3] as number) : 0
        const up = prev[i] as number
        const ul = i >= 3 ? (prev[i - 3] as number) : 0
        const v = cur[i] as number
        let pred = 0
        if (f === 1) pred = left
        else if (f === 2) pred = up
        else if (f === 3) pred = (left + up) >> 1
        else if (f === 4) {
          const pp = left + up - ul
          const pa = Math.abs(pp - left)
          const pb = Math.abs(pp - up)
          const pc = Math.abs(pp - ul)
          pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul
        }
        const d = (v - pred) & 0xff
        out[i] = d
        sum += d < 128 ? d : 256 - d
      }
      if (sum < bestSum) {
        bestSum = sum
        best = f
      }
    }
    const o = y * (stride + 1)
    raw[o] = best
    ;(cand[best] as Buffer).copy(raw, o + 1)
    cur.copy(prev)
  }
  const idat = deflateSync(raw, { level: 9, memLevel: 9 })
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, "ascii"), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

/** Draws PNGs onto a `w`×`h` canvas (backdrop color) and returns a compact PNG. */
async function compose(
  w: number,
  h: number,
  backdrop: string,
  layers: { png: Uint8Array; x: number; y: number }[],
): Promise<Uint8Array> {
  const { loadCanvasKit } = await import("../packages/renderer/src/ck")
  const ck = await loadCanvasKit()
  const surface = ck.MakeSurface(w, h)
  if (!surface) throw new Error("no raster surface")
  const c = surface.getCanvas()
  c.clear(ck.parseColorString(backdrop))
  const paint = new ck.Paint()
  for (const l of layers) {
    const img = ck.MakeImageFromEncoded(l.png)
    if (!img) throw new Error("cannot decode a rendered PNG")
    c.drawImage(img, l.x, l.y, paint)
    img.delete()
  }
  paint.delete()
  surface.flush()
  const snap = surface.makeImageSnapshot()
  const pixels = snap.readPixels(0, 0, {
    width: w,
    height: h,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  }) as Uint8Array
  snap.delete()
  surface.delete()
  return encodePng(pixels, w, h)
}

async function renderPngs(
  built: BuiltTemplate,
  dir: string,
  sc: Scene,
  layout: LayoutResult,
): Promise<string[]> {
  const box = (id: string) => {
    const b = layout.nodes.get(id)?.world
    if (!b) throw new Error(`${id} has no layout`)
    return b
  }
  const written: string[] = []
  // Screens: desktop frames SCREEN_W wide (cut at SCREEN_MAX_H), mobile frames at MOBILE_SCALE.
  mkdirSync(join(dir, "screens"), { recursive: true })
  for (const [i, s] of built.screens.entries()) {
    const b = box(s.id)
    const scale = b.w >= 1000 ? SCREEN_W / b.w : MOBILE_SCALE
    const png = await sc.raster(s.id, scale)
    const w = Math.ceil(b.w * scale)
    const h = Math.min(SCREEN_MAX_H, Math.ceil(b.h * scale))
    const out = await compose(w, h, built.backdrop, [{ png, x: 0, y: 0 }])
    const f = join(dir, "screens", screenFile(i, s.name))
    writeFileSync(f, out)
    written.push(f)
  }
  // Cover: the Cover page's frame (1440×900) at COVER_W.
  const cover = built.pages.find((pg) => pg.kind === "cover")?.roots[0]
  if (!cover) throw new Error("no cover frame")
  const b = box(cover)
  const png = await sc.raster(cover, COVER_W / b.w)
  const out = await compose(COVER_W, Math.round((b.h * COVER_W) / b.w), built.backdrop, [
    { png, x: 0, y: 0 },
  ])
  const cf = join(dir, "cover.png")
  writeFileSync(cf, out)
  written.push(cf)
  return written
}

// --- rules -----------------------------------------------------------------------------------------

/** docs/style/writing.md words that `aiTellPhrases` does not cover, plus placeholder text. */
const EXTRA_BANNED =
  /\b(powerful|intuitive|best-in-class|world-class|next-gen|revolutionary|unleash|supercharge|magic(al)?|beautiful|delightful|simply|lorem|ipsum)\b/i

let lucide: Set<string> | null = null
function lucideNames(): Set<string> {
  if (lucide) return lucide
  const catalog = JSON.parse(
    readFileSync(join(ROOT, "packages/renderer/assets/icons/lucide/catalog.json"), "utf8"),
  ) as { name: string }[]
  lucide = new Set(catalog.map((e) => e.name))
  return lucide
}

function ruleIssues(
  tpl: Template,
  built: BuiltTemplate,
  text: string,
  layout: LayoutResult,
): string[] {
  const issues = strictIssues(text)
  const nodes = built.store.toDocument().nodes as unknown as Record<string, Body>
  issues.push(...rawColorIssues(nodes), ...absoluteIssues(nodes))
  for (const s of built.copy)
    for (const hit of aiTellPhrases(s))
      issues.push(`copy: ${hit.kind} "${hit.match}" in "${s.slice(0, 60)}"`)
  for (const s of built.copy) {
    const m = s.match(EXTRA_BANNED)
    if (m) issues.push(`copy: banned word "${m[0]}" in "${s.slice(0, 60)}"`)
  }
  const icons = lucideNames()
  for (const [id, n] of Object.entries(nodes))
    if (n.type === "icon" && (n.set !== "lucide" || !icons.has(String(n.icon))))
      issues.push(`${id}: unknown lucide icon "${String(n.icon)}"`)
  for (const t of [tpl.name, tpl.description])
    for (const hit of aiTellPhrases(t)) issues.push(`meta: ${hit.kind} "${hit.match}"`)
  if (built.screens.length < 3 || built.screens.length > 10)
    issues.push(`${built.screens.length} screens (3–10 expected)`)
  const comps = Object.values(nodes).filter((n) => n.component).length
  if (comps < 8) issues.push(`${comps} components (8 or more expected)`)
  const problems = checkDesign(built.store, layout, { placeholders: true })
  issues.push(...formatProblems(problems, 60).map((l) => `check: ${l}`))
  return issues
}

// --- main ------------------------------------------------------------------------------------------

async function main() {
  const templates = await loadTemplates()
  const selected = ONLY ? templates.filter((t) => t.slug === ONLY) : templates
  if (ONLY && selected.length === 0) throw new Error(`no template "${ONLY}"`)
  let failed = false
  const entries: IndexEntry[] = []
  for (const tpl of templates) {
    const built = buildTemplate(tpl)
    const text = serialize(built.store.toDocument())
    const dir = join(FILES, tpl.slug)
    const file = join(dir, `${tpl.slug}.kimo`)
    const rel = (p: string) => relative(PKG, p).split("\\").join("/")
    const sc = await scene(built.store)
    try {
      const layout = await sc.layoutOf()
      entries.push({
        slug: tpl.slug,
        name: tpl.name,
        category: tpl.category,
        description: tpl.description,
        pages: built.pages.map((p) => p.name),
        file: rel(file),
        cover: rel(join(dir, "cover.png")),
        screens: built.screens.map((s, i) => {
          const box = layout.nodes.get(s.id)?.world
          return {
            name: s.name,
            page: s.page,
            preview: rel(join(dir, "screens", screenFile(i, s.name))),
            width: Math.round(box?.w ?? 0),
            height: Math.round(box?.h ?? 0),
          }
        }),
      })
      if (!selected.includes(tpl)) continue
      const issues = ruleIssues(tpl, built, text, layout)
      if (issues.length) {
        failed = true
        console.error(`✗ ${tpl.slug}: ${issues.length} issue(s)\n  ${issues.join("\n  ")}`)
      }
      if (CHECK) {
        const onDisk = existsSync(file) ? readFileSync(file, "utf8") : null
        if (onDisk !== text) {
          failed = true
          console.error(`✗ ${tpl.slug}: stale (run bun scripts/build-templates.ts)`)
        } else if (!issues.length) console.log(`✓ ${tpl.slug}`)
        continue
      }
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, text)
      const nodeCount = Object.keys(built.store.toDocument().nodes).length
      console.log(`wrote ${relative(ROOT, file)} (${nodeCount} nodes, ${built.pages.length} pages)`)
      if (PNG) {
        rmSync(join(dir, "screens"), { recursive: true, force: true })
        for (const f of await renderPngs(built, dir, sc, layout))
          console.log(`wrote ${relative(ROOT, f)}`)
      }
    } finally {
      sc.dispose()
    }
  }
  entries.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
  // Short string arrays on one line, as biome formats them.
  const index = `${JSON.stringify(entries, null, 2).replace(
    /"pages": \[\n\s*([^\]]*?)\n\s*\]/g,
    (_, items: string) => `"pages": [${items.split(/,\n\s*/).join(", ")}]`,
  )}\n`
  const indexFile = join(PKG, "index.json")
  if (CHECK) {
    const onDisk = existsSync(indexFile) ? readFileSync(indexFile, "utf8") : null
    if (onDisk !== index) {
      failed = true
      console.error("✗ index.json: stale (run bun scripts/build-templates.ts)")
    }
    for (const e of entries)
      for (const f of [e.cover, ...e.screens.map((x) => x.preview)])
        if (!existsSync(join(PKG, f))) {
          failed = true
          console.error(`✗ ${e.slug}: missing ${f}`)
        }
  } else {
    writeFileSync(indexFile, index)
    console.log(`wrote ${relative(ROOT, indexFile)}`)
  }
  const bytes = folderBytes(FILES)
  const mb = (bytes / 1024 / 1024).toFixed(2)
  if (bytes > BUDGET) {
    failed = true
    console.error(`✗ packages/templates/files is ${mb} MB (budget ${BUDGET / 1024 / 1024} MB)`)
  } else console.log(`packages/templates/files: ${mb} MB`)
  if (failed) process.exit(1)
}

function folderBytes(dir: string): number {
  if (!existsSync(dir)) return 0
  let n = 0
  for (const e of readdirSync(dir, { withFileTypes: true }))
    n += e.isDirectory() ? folderBytes(join(dir, e.name)) : statSync(join(dir, e.name)).size
  return n
}

await main()
