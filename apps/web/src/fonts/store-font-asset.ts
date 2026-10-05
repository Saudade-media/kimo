/**
 * Board 28 "Store on first use" (spec §12 rule 3, teardown 9.2 "Fonts"): a Google face the
 * canvas fetched is written once to the document's `assets/<sha256-16>.<ext>`, so the file
 * renders offline, in CI, in the `kimo` CLI and in headless render.
 *
 * Storing never edits the document: the bytes go to the asset store (outside the document) and
 * the `assets` manifest lists them only when the file is written ({@link withFontManifest}, run
 * by every save / autosave / Save as and by library exports). The in-memory store and its undo
 * history stay untouched, and opening a file never makes it dirty.
 *
 * The manifest entry carries the face in its `name` (`<Family>-<Style>.<ext>`), since WOFF2
 * can't be inspected without Brotli. Over {@link MAX_ASSET_BYTES} (20 MB): not stored (the font
 * cache still has it). Bundled families (Inter, JetBrains Mono) are never stored.
 */
import { referencedAssets } from "@kimo/core-schema"
import {
  BUNDLED_FAMILIES,
  type FontFaceKey,
  fontAssetName,
  fontExtension,
  fontFamilyKey,
} from "@kimo/renderer"
import { type AssetStore, contentHash, MAX_ASSET_BYTES, type ManifestEntry } from "../lib/assets"
import { FONT_MIME } from "./document-fonts"

/** A font file of the asset store with the face it holds. */
export interface FontAssetFile {
  /** `<hash>.<ext>` in `assets/`. */
  key: string
  family: string
  entry: ManifestEntry
}

/** Stores `bytes` (a fetched face) in the asset store. Null when skipped. */
export async function storeFontAsset(
  face: FontFaceKey,
  bytes: Uint8Array,
  assets: Pick<AssetStore, "putKey">,
): Promise<FontAssetFile | null> {
  // Families bundled with Kimo (Inter, JetBrains Mono) render everywhere Kimo does: a weight
  // fetched for them stays in the font cache, not in the file.
  if (BUNDLED_FAMILIES.has(face.family.toLowerCase())) return null
  const ext = fontExtension(bytes)
  if (!ext || bytes.byteLength > MAX_ASSET_BYTES) return null
  const key = `${await contentHash(bytes)}.${ext}`
  const entry: ManifestEntry = {
    mime: FONT_MIME[ext] as string,
    bytes: bytes.byteLength,
    name: fontAssetName(face.family, face.weight, face.style, ext),
  }
  const stored = await assets
    .putKey(key, bytes, { mime: entry.mime, name: entry.name as string })
    .catch(() => null)
  return stored ? { key, family: face.family, entry } : null
}

/** Font families (keys) the document's text uses: styles, spans, typography variables. */
function usedFamilies(doc: Readonly<Record<string, unknown>>): Set<string> {
  const out = new Set<string>()
  const vars = (doc.variables ?? {}) as Record<string, { value?: unknown }>
  const value = (v: unknown, depth = 0): unknown => {
    if (depth > 8 || !v || typeof v !== "object" || Array.isArray(v)) return v
    const ref = (v as { $ref?: unknown }).$ref
    if (typeof ref !== "string") return v
    let x = vars[ref]?.value
    if (Array.isArray(x)) x = (x[0] as { value?: unknown } | undefined)?.value
    return value(x, depth + 1)
  }
  const walk = (v: unknown, depth: number) => {
    if (depth > 14 || !v || typeof v !== "object") return
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1)
      return
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "font" || k === "fontFamily") {
        const f = value(x)
        if (typeof f === "string") out.add(fontFamilyKey(f))
      } else if (k === "typography") walk(value(x), depth + 1)
      else walk(x, depth + 1)
    }
  }
  walk(doc.nodes, 0)
  walk(doc.variables, 0)
  return out
}

/**
 * The document as written: its `assets` manifest also lists the font files of `fonts` whose
 * family the text uses (spec §12 rule 3). Without a manifest, one is added only when every
 * asset the document references has a known entry (`entryOf`), so `ASSET_MISSING` never flags
 * a reference that was fine before. Pure and idempotent; returns `doc` itself when nothing is
 * added.
 */
export function withFontManifest<D extends object>(
  doc: D,
  fonts: readonly FontAssetFile[],
  entryOf: (key: string) => ManifestEntry | null,
): D {
  if (!fonts.length) return doc
  const d = doc as unknown as Record<string, unknown>
  const used = usedFamilies(d)
  const have = d.assets as Record<string, unknown> | undefined
  const add: Record<string, ManifestEntry> = {}
  for (const f of fonts)
    if (used.has(fontFamilyKey(f.family)) && !(have && Object.hasOwn(have, f.key)))
      add[f.key] = f.entry
  if (!Object.keys(add).length) return doc
  if (have) return { ...d, assets: { ...have, ...add } } as D
  const refs: Record<string, ManifestEntry> = {}
  for (const ref of referencedAssets(d)) {
    const e = entryOf(ref)
    if (!e) return doc
    refs[ref] = e
  }
  return { ...d, assets: { ...refs, ...add } } as D
}
