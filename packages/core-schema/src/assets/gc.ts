/**
 * Unused-asset collection (spec §12 rule 1: "`kimo gc` removes unreferenced files"; board 19
 * "Clean up assets · same as kimo gc"). Pure and host-independent: shared by `kimo gc`
 * (`@kimo/cli`) and the editor's Clean up assets dialog (`apps/web/src/assets-gc`).
 *
 * Rules:
 * - Only content-addressed files (`<sha256-16>.<ext>`) directly in `assets/` are candidates;
 *   anything else (a README, a `.DS_Store`, sub-folders) is never touched.
 * - A file is referenced when its `./assets/<name>` (or `assets/<name>`) appears anywhere in the
 *   document's nodes, variables, themes, imports, components or meta. The `assets` manifest is
 *   NOT a reference (an entry for an unused file is exactly what `ASSET_UNUSED` lints).
 * - Font files are kept unless the caller knows their family and the document does not use it
 *   (document fonts are matched by family, not by path).
 * - Conservative on doubt: an unreadable document plans nothing.
 */

/** One file in the document's `assets/` folder. */
export interface AssetFile {
  /** File name inside `assets/` (`9f2c41ab03d1e7a2.png`). */
  name: string
  bytes: number
}

export interface AssetGcPlan {
  /** Files to remove, largest first. */
  unused: AssetFile[]
  unusedBytes: number
  /** Content-addressed files that stay (referenced, or fonts in use / of unknown family). */
  kept: AssetFile[]
  /** Referenced names with no file in `assets/` (`ASSET_MISSING` on disk). */
  missing: string[]
  /** Files that are not content-addressed (ignored). */
  ignored: AssetFile[]
}

const CONTENT_ADDRESSED = /^[0-9a-f]{16}\.[a-z0-9]{1,8}$/
const REF = /(?:^|[^0-9A-Za-z_])(?:\.\/)?assets\/([0-9a-f]{16}\.[a-z0-9]{1,8})(?![0-9a-z])/g
const FONT_EXT = /\.(ttf|otf|woff2?)$/i

/** True for `<sha256-16>.<ext>` names. */
export function isContentAddressed(name: string): boolean {
  return CONTENT_ADDRESSED.test(name)
}

/** Asset names referenced by the document (everything but the `assets` manifest). */
export function referencedAssets(doc: Readonly<Record<string, unknown>>): Set<string> {
  const out = new Set<string>()
  for (const [key, value] of Object.entries(doc)) {
    if (key === "assets") continue
    const text = typeof value === "string" ? value : JSON.stringify(value)
    if (!text?.includes("assets/")) continue
    for (const m of text.matchAll(REF)) out.add(m[1] as string)
  }
  return out
}

/** Font families the document's text uses, lowercase (style `font` strings anywhere). */
export function usedFontFamilies(doc: Readonly<Record<string, unknown>>): Set<string> {
  const out = new Set<string>()
  const vars = (doc.variables ?? {}) as Record<string, { value?: unknown }>
  const add = (v: unknown) => {
    if (typeof v === "string") out.add(v.toLowerCase())
    else if (v && typeof v === "object" && typeof (v as { $ref?: unknown }).$ref === "string") {
      let x = vars[(v as { $ref: string }).$ref]?.value
      if (Array.isArray(x)) x = (x[0] as { value?: unknown } | undefined)?.value
      if (typeof x === "string") out.add(x.toLowerCase())
    }
  }
  const walk = (v: unknown, depth: number) => {
    if (depth > 14 || !v || typeof v !== "object") return
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1)
      return
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "font" || k === "fontFamily") add(x)
      else walk(x, depth + 1)
    }
  }
  walk(doc.nodes, 0)
  walk(doc.variables, 0)
  return out
}

/**
 * What `kimo gc` would remove. `fontFamilyOf` names the family of a font file (from its `name`
 * table) when known; fonts without a known family are kept.
 */
export function planAssetGc(
  doc: Readonly<Record<string, unknown>>,
  files: readonly AssetFile[],
  fontFamilyOf?: (name: string) => string | null | undefined,
): AssetGcPlan {
  const refs = referencedAssets(doc)
  const families = usedFontFamilies(doc)
  const plan: AssetGcPlan = { unused: [], unusedBytes: 0, kept: [], missing: [], ignored: [] }
  const present = new Set<string>()
  for (const f of files) {
    if (!isContentAddressed(f.name)) {
      plan.ignored.push(f)
      continue
    }
    present.add(f.name)
    if (refs.has(f.name)) {
      plan.kept.push(f)
      continue
    }
    if (FONT_EXT.test(f.name)) {
      const family = fontFamilyOf?.(f.name)
      if (!family || families.has(family.toLowerCase())) {
        plan.kept.push(f)
        continue
      }
    }
    plan.unused.push(f)
    plan.unusedBytes += f.bytes
  }
  plan.unused.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
  plan.missing = [...refs].filter((r) => !present.has(r)).sort()
  return plan
}

/** The `assets` manifest without the removed files' entries (null when nothing changes). */
export function prunedManifest(
  manifest: unknown,
  removed: readonly string[],
): Record<string, unknown> | null {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null
  const gone = new Set(removed)
  const entries = Object.entries(manifest as Record<string, unknown>)
  if (!entries.some(([k]) => gone.has(k))) return null
  return Object.fromEntries(entries.filter(([k]) => !gone.has(k)))
}
