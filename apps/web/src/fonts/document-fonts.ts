/**
 * Document font assets (spec §12: fonts live in `assets/` content-addressed, like images; rule 3:
 * fonts fetched from a service SHOULD be stored there so the file renders offline). A face's
 * family/weight/style come from the font file itself (`name` / `OS/2` tables via
 * `readFontInfo`); WOFF2 (not inspectable without Brotli) falls back to the manifest `name`
 * ("Fraunces-SemiBold.woff2").
 */
import {
  type DocumentFontFace,
  fontAssetName,
  parseFontFileName,
  readFontInfo,
} from "@kimo/renderer"

export const FONT_MIME: Readonly<Record<string, string>> = {
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
}

/** True for a manifest entry / key that is a font file. */
export function isFontAsset(key: string, mime?: string): boolean {
  if (mime && /^(font\/|application\/(x-)?font)/i.test(mime)) return true
  const ext = /\.([a-z0-9]+)$/i.exec(key)?.[1]?.toLowerCase()
  return ext !== undefined && ext in FONT_MIME
}

/** Family / weight / style from a font file name (shared with headless render). */
export { parseFontFileName }

/** A document font face plus its asset file (board 28: listed in the manifest on save). */
export interface DocumentFontAsset extends DocumentFontFace {
  /** `<hash>.<ext>` in `assets/`. */
  key: string
  /** Its manifest entry (`name` = `<Family>-<Style>.<ext>` when Kimo wrote it). */
  entry: { mime: string; bytes?: number; name?: string }
}

/**
 * Inspects every font asset of a document once and returns its faces (bytes kept in memory so
 * the renderer never reads them twice). `read` returns an asset's bytes by key.
 */
export async function loadDocumentFontFaces(
  manifest: Readonly<Record<string, { mime?: string; name?: string }>> | undefined,
  keys: readonly string[],
  read: (key: string) => Promise<Uint8Array | null>,
): Promise<DocumentFontAsset[]> {
  const out: DocumentFontAsset[] = []
  const all = new Set([...keys, ...Object.keys(manifest ?? {})])
  for (const key of all) {
    const entry = manifest?.[key]
    if (!isFontAsset(key, entry?.mime)) continue
    const bytes = await read(key).catch(() => null)
    if (!bytes) continue
    const info = await readFontInfo(bytes)
    const meta = info
      ? { family: info.family, weight: info.weight, style: info.italic ? "italic" : "normal" }
      : entry?.name
        ? parseFontFileName(entry.name)
        : null
    if (!meta) continue
    const ext = /\.([a-z0-9]+)$/i.exec(key)?.[1]?.toLowerCase() ?? "ttf"
    const style = meta.style as "normal" | "italic"
    out.push({
      family: meta.family,
      weight: meta.weight,
      style,
      load: async () => bytes,
      key,
      entry: {
        mime: entry?.mime ?? FONT_MIME[ext] ?? "font/ttf",
        bytes: bytes.byteLength,
        name: entry?.name ?? fontAssetName(meta.family, meta.weight, style, ext),
      },
    })
  }
  return out
}
