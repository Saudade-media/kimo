/**
 * The renderer's default {@link IconProvider} (ADR 0010 "Icons"): one glyph at a time, from a
 * pluggable {@link IconSource}.
 *
 * - **Headless (Bun/Node)**: {@link packageIconSource} reads the single SVG file of the glyph
 *   from the installed static packages (`lucide-static`, `feather-icons`,
 *   `@phosphor-icons/core`, `@material-symbols/svg-400`) and normalizes it.
 * - **Browser**: {@link packIconSource} fetches pre-normalized shard files (~100 glyphs each,
 *   `assets/icons/<pack>/<n>.json`, built by `scripts/build-icon-packs.ts`) on demand; the
 *   browser entry passes their Vite asset URLs. No set is ever in the main chunk: only the
 *   URL table (~250 entries) is.
 */
import type { IconCatalogEntry, IconGlyph, IconPath, IconProvider } from "../types"
import {
  dataWeight,
  glyphFile,
  ICON_NAME,
  isIconSet,
  PACK_SHARDS,
  packKey,
  phosphorWeight,
  shardOf,
} from "./sets"
import { normalizeSvg } from "./svg"

/** A glyph or catalog could not be loaded (network, server error): retried later. */
export class IconLoadError extends Error {
  override readonly name = "IconLoadError"
}

/** Where glyph data comes from. */
export interface IconSource {
  /**
   * One glyph, normalized, or null when the set/name is unknown. Throws when the data could
   * not be loaded (the provider retries; it never records a failed load as missing).
   */
  glyph(set: string, name: string, weight: number | undefined): Promise<IconGlyph | null>
  catalog(set: string): Promise<readonly IconCatalogEntry[]>
}

type State =
  | { status: "loading" }
  | { status: "ready"; glyph: IconGlyph }
  | { status: "missing" }
  /** Last load failed; retried automatically at `retryAt` (and on any `load` after it). */
  | { status: "failed"; attempts: number; retryAt: number }

/** Retry backoff after a failed load: 1 s, 2 s, 4 s … capped at 60 s. */
export const ICON_RETRY_BASE_MS = 1000
const ICON_RETRY_MAX_MS = 60_000
const now = () => (globalThis.performance ?? Date).now()

const key = (set: string, name: string, weight: number | undefined) =>
  `${set}\u0000${name}\u0000${dataWeight(set, weight) ?? ""}`

/** Caching provider over an {@link IconSource}; `status` tells loading from missing. */
export class SourceIconProvider implements IconProvider {
  private readonly glyphs = new Map<string, State>()
  private readonly pending = new Map<string, Promise<IconGlyph | null>>()
  private readonly catalogs = new Map<string, Promise<readonly IconCatalogEntry[]>>()
  private readonly listeners = new Set<(set: string, name: string) => void>()

  constructor(private readonly source: IconSource) {}

  load(set: string, name: string, weight?: number): Promise<IconGlyph | null> {
    const k = key(set, name, weight)
    const s = this.glyphs.get(k)
    if (s?.status === "ready") return Promise.resolve(s.glyph)
    if (s?.status === "missing") return Promise.resolve(null)
    if (s?.status === "failed" && now() < s.retryAt) return Promise.resolve(null)
    const p = this.pending.get(k)
    if (p) return p
    const attempts = s?.status === "failed" ? s.attempts : 0
    this.glyphs.set(k, { status: "loading" })
    const job = (async () => {
      let g: IconGlyph | null = null
      let failed = false
      try {
        g =
          isIconSet(set) && ICON_NAME.test(name) ? await this.source.glyph(set, name, weight) : null
      } catch {
        failed = true
      }
      this.pending.delete(k)
      if (failed) {
        // Not "missing": a network blip must not turn the glyph into a missing box for the
        // session. Retry with backoff; listeners fire when a retry succeeds.
        const delay = Math.min(ICON_RETRY_MAX_MS, ICON_RETRY_BASE_MS * 2 ** attempts)
        this.glyphs.set(k, { status: "failed", attempts: attempts + 1, retryAt: now() + delay })
        const t = setTimeout(() => void this.load(set, name, weight), delay)
        ;(t as { unref?: () => void }).unref?.()
        return null
      }
      this.glyphs.set(k, g ? { status: "ready", glyph: g } : { status: "missing" })
      for (const l of [...this.listeners]) l(set, name)
      return g
    })()
    this.pending.set(k, job)
    return job
  }

  get(set: string, name: string, weight?: number): IconGlyph | null {
    const s = this.glyphs.get(key(set, name, weight))
    return s?.status === "ready" ? s.glyph : null
  }

  /** `unknown` = never requested. */
  status(set: string, name: string, weight?: number): State["status"] | "unknown" {
    return this.glyphs.get(key(set, name, weight))?.status ?? "unknown"
  }

  catalog(set: string): Promise<readonly IconCatalogEntry[]> {
    let p = this.catalogs.get(set)
    if (!p) {
      // A failed load is not cached: the next request (picker reopened) tries again.
      p = this.source.catalog(set).catch(() => {
        this.catalogs.delete(set)
        return []
      })
      this.catalogs.set(set, p)
    }
    return p
  }

  onIconLoaded(listener: (set: string, name: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

// --- Headless: the installed packages ------------------------------------------------------

type Fs = typeof import("node:fs/promises")
type PathMod = typeof import("node:path")

async function nodeMods(): Promise<{ fs: Fs; path: PathMod; dir: string }> {
  // Specifiers in variables: bundlers must not try to resolve node builtins for the browser.
  const fsSpec = "node:fs/promises"
  const pathSpec = "node:path"
  const urlSpec = "node:url"
  const fs = (await import(/* @vite-ignore */ fsSpec)) as Fs
  const path = (await import(/* @vite-ignore */ pathSpec)) as PathMod
  const url = (await import(/* @vite-ignore */ urlSpec)) as typeof import("node:url")
  return { fs, path, dir: path.dirname(url.fileURLToPath(import.meta.url)) }
}

/** Reads glyphs straight from the static icon packages (Bun/Node, tests, CLI, MCP). */
export function packageIconSource(): IconSource {
  const roots = new Map<string, Promise<string | null>>()
  const pkgRoot = (pkg: string): Promise<string | null> => {
    let p = roots.get(pkg)
    if (!p) {
      p = (async () => {
        const { fs, path, dir } = await nodeMods()
        // Walk up from this file: workspace-local node_modules first (bun isolated installs).
        for (let d = dir; ; d = path.dirname(d)) {
          const cand = path.join(d, "node_modules", pkg)
          try {
            await fs.access(path.join(cand, "package.json"))
            return cand
          } catch {
            // keep walking
          }
          if (path.dirname(d) === d) return null
        }
      })()
      roots.set(pkg, p)
    }
    return p
  }
  return {
    async glyph(set, name, weight) {
      const f = glyphFile(set, name, weight)
      if (!f) return null
      const root = await pkgRoot(f.pkg)
      if (!root) return null
      const { fs, path } = await nodeMods()
      let svg: string
      try {
        svg = await fs.readFile(path.join(root, f.file), "utf8")
      } catch {
        return null
      }
      return normalizeSvg(svg, set, name, dataWeight(set, weight))
    },
    async catalog(set) {
      const f = glyphFile(set, "x", undefined)
      if (!f) return []
      const root = await pkgRoot(f.pkg)
      if (!root) return []
      const { fs, path } = await nodeMods()
      const dir = path.join(root, path.dirname(f.file))
      const tags = await readTags(set, root, fs, path)
      const names = (await fs.readdir(dir))
        .filter((n) => n.endsWith(".svg"))
        .map((n) => n.slice(0, -4))
        .filter((n) => ICON_NAME.test(n) && !(set.startsWith("material-") && n.endsWith("-fill")))
        .sort()
      return names.map((n) => (tags[n] ? { name: n, tags: tags[n] } : { name: n }))
    },
  }
}

async function readTags(
  set: string,
  root: string,
  fs: Fs,
  path: PathMod,
): Promise<Record<string, string[]>> {
  try {
    if (set === "lucide")
      return JSON.parse(await fs.readFile(path.join(root, "tags.json"), "utf8")) as Record<
        string,
        string[]
      >
    if (set === "phosphor") {
      const spec = "@phosphor-icons/core"
      const m = (await import(/* @vite-ignore */ spec)) as {
        icons: { name: string; tags: string[] }[]
      }
      return Object.fromEntries(m.icons.map((i) => [i.name, i.tags]))
    }
  } catch {
    // no tags
  }
  return {}
}

// --- Browser: pre-normalized shard packs ---------------------------------------------------

/** One glyph in a pack shard: `[viewBox, paths, strokeWidth?]`; path = `[d, 0 fill | 1 stroke, evenodd?, opacity?]`. */
export type PackedGlyph = [
  [number, number, number, number],
  [string, 0 | 1, (0 | 1)?, number?][],
  number?,
]

export function packGlyph(g: IconGlyph): PackedGlyph {
  const paths = g.paths.map((p) => {
    const e: [string, 0 | 1, (0 | 1)?, number?] = [p.d, p.paint === "stroke" ? 1 : 0]
    if (p.fillRule === "evenodd" || p.opacity !== undefined)
      e.push(p.fillRule === "evenodd" ? 1 : 0)
    if (p.opacity !== undefined) e.push(p.opacity)
    return e
  })
  const out: PackedGlyph = [[...g.viewBox] as [number, number, number, number], paths]
  if (g.strokeWidth !== undefined) out.push(g.strokeWidth)
  return out
}

export function unpackGlyph(
  p: PackedGlyph,
  set: string,
  name: string,
  weight: number | null,
): IconGlyph {
  const paths: IconPath[] = p[1].map(([d, paint, rule, opacity]) => {
    const e: IconPath = { d, paint: paint === 1 ? "stroke" : "fill" }
    if (rule === 1) e.fillRule = "evenodd"
    if (opacity !== undefined) e.opacity = opacity
    return e
  })
  const g: IconGlyph = { set, name, weight, viewBox: p[0], paths }
  if (p[2] !== undefined) g.strokeWidth = p[2]
  return g
}

/**
 * Glyphs from shard packs. `urls` maps `"<pack>/<shard>.json"` and `"<pack>/catalog.json"`
 * (paths relative to `assets/icons/`) to fetchable URLs.
 */
export function packIconSource(
  urls: Readonly<Record<string, string>>,
  fetchFn: (url: string) => Promise<Response> = (url) => fetch(url),
): IconSource {
  const shards = new Map<string, Promise<Record<string, PackedGlyph>>>()
  const json = async <T>(rel: string): Promise<T | null> => {
    const url = urls[rel]
    if (!url) return null
    const res = await fetchFn(url)
    // A server error is a load failure (retried), not "this glyph does not exist".
    if (!res.ok) throw new IconLoadError(`${rel}: HTTP ${res.status}`)
    return (await res.json()) as T
  }
  return {
    async glyph(set, name, weight) {
      const pack = packKey(set, weight)
      if (!pack || !glyphFile(set, name, weight)) return null
      const n = PACK_SHARDS[pack] ?? 1
      const rel = `${pack}/${shardOf(name, n)}.json`
      let p = shards.get(rel)
      if (!p) {
        p = json<Record<string, PackedGlyph>>(rel).then((r) => r ?? {})
        // Failed shards are evicted so a retry fetches them again.
        p.catch(() => shards.delete(rel))
        shards.set(rel, p)
      }
      const packed = (await p)[name]
      return packed ? unpackGlyph(packed, set, name, dataWeight(set, weight)) : null
    },
    async catalog(set) {
      const pack = packKey(set, set === "phosphor" ? phosphorWeight(400)[0] : undefined)
      if (!pack) return []
      return (await json<IconCatalogEntry[]>(`${pack}/catalog.json`)) ?? []
    },
  }
}
