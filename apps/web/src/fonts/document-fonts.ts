/**
 * Document font assets (spec §12: fonts live in `assets/` content-addressed, like images; rule 3:
 * fonts fetched from a service SHOULD be stored there so the file renders offline). A face's
 * family/weight/style come from the font file itself (`name` / `OS/2` tables via
 * `readFontInfo`); WOFF2 (not inspectable without Brotli) falls back to the manifest `name`
 * ("Fraunces-SemiBold.woff2").
 */
import { type DocumentFontFace, readFontInfo } from "@kimo/renderer"

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

const WEIGHT_WORDS: [RegExp, number][] = [
  [/thin|hairline/i, 100],
  [/extra-?light|ultra-?light/i, 200],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi-?bold|demi-?bold/i, 600],
  [/extra-?bold|ultra-?bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
]

/** Family / weight / style from a font file name (`Fraunces-SemiBoldItalic.woff2`). */
export function parseFontFileName(
  name: string,
): { family: string; weight: number; style: "normal" | "italic" } | null {
  const base = name.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]+$/i, "")
  if (!base) return null
  const [famRaw, styleRaw = ""] = base.split(/[-_](?=[^-_]*$)/)
  const family = (styleRaw ? famRaw : base)
    ?.replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_]+/g, " ")
    .trim()
  if (!family) return null
  const weight = WEIGHT_WORDS.find(([re]) => re.test(styleRaw))?.[1] ?? 400
  const style = /italic|oblique/i.test(styleRaw) ? "italic" : "normal"
  return { family, weight, style }
}

/**
 * Inspects every font asset of a document once and returns its faces (bytes kept in memory so
 * the renderer never reads them twice). `read` returns an asset's bytes by key.
 */
export async function loadDocumentFontFaces(
  manifest: Readonly<Record<string, { mime?: string; name?: string }>> | undefined,
  keys: readonly string[],
  read: (key: string) => Promise<Uint8Array | null>,
): Promise<DocumentFontFace[]> {
  const out: DocumentFontFace[] = []
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
    out.push({
      family: meta.family,
      weight: meta.weight,
      style: meta.style as "normal" | "italic",
      load: async () => bytes,
    })
  }
  return out
}
