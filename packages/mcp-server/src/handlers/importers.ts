/**
 * Pure importers for `kimo_import` / `kimo_assets` (ADR 0013 §2): DTCG and CSS custom-property
 * tokens → `.kimo` variables, image sniffing and intrinsic size. SVG vector import is supplied
 * by the host (`apps/web` svg-import) through `ToolHandlerOptions.svgImport`.
 */

export interface ImportedVariable {
  name: string
  variable: Record<string, unknown>
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(.*\)|hsla?\(.*\)|oklch\(.*\)|oklab\(.*\)|color\(.*\))$/i

const cleanName = (s: string) =>
  s
    .trim()
    .replace(/[\s:]+/g, "-")
    .replace(/^\$+/, "")

/** `{color.primary}` → `color/primary`. */
const aliasOf = (v: unknown): string | null => {
  const m = typeof v === "string" ? /^\{([^{}]+)\}$/.exec(v.trim()) : null
  return m ? (m[1] as string).split(".").map(cleanName).join("/") : null
}

function literal(type: string | undefined, raw: unknown): Record<string, unknown> | null {
  const alias = aliasOf(raw)
  const t = type?.toLowerCase()
  const value = alias ? { $ref: alias } : raw
  if (t === "color" || (!t && typeof raw === "string" && COLOR_RE.test(raw)))
    return { type: "color", value }
  if (t === "number" || t === "fontweight" || typeof raw === "number")
    return { type: "number", value: alias ? value : Number(raw) }
  if (t === "dimension" || t === "spacing" || t === "sizing" || t === "borderradius") {
    if (alias) return { type: "number", value }
    const n = Number.parseFloat(String(raw))
    return Number.isFinite(n) ? { type: "number", value: n } : null
  }
  if (t === "boolean" || typeof raw === "boolean") return { type: "boolean", value }
  if (typeof raw === "string") return { type: "string", value }
  return null
}

/** DTCG (design tokens community group) JSON → variables. Names join group paths with `/`. */
export function parseDtcg(text: string): ImportedVariable[] {
  const root = JSON.parse(text) as unknown
  const out: ImportedVariable[] = []
  const walk = (node: unknown, path: string[], inherited: string | undefined) => {
    if (typeof node !== "object" || node === null || Array.isArray(node)) return
    const rec = node as Record<string, unknown>
    const type = typeof rec.$type === "string" ? rec.$type : inherited
    if ("$value" in rec) {
      const v = literal(type, rec.$value)
      if (v && path.length) {
        if (path.length > 1) v.group = path.slice(0, -1).join("/")
        if (typeof rec.$description === "string") v.description = rec.$description
        out.push({ name: path.map(cleanName).join("/"), variable: v })
      }
      return
    }
    for (const [k, child] of Object.entries(rec))
      if (!k.startsWith("$")) walk(child, [...path, k], type)
  }
  walk(root, [], undefined)
  return out
}

/** CSS custom properties (`--brand: #f00;`, `var(--x)` aliases) → variables. */
export function parseCssTokens(text: string): ImportedVariable[] {
  const out: ImportedVariable[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(/--([A-Za-z0-9_-]+)\s*:\s*([^;}]+)[;}]?/g)) {
    const name = cleanName(m[1] as string)
    const raw = (m[2] as string).trim()
    if (seen.has(name)) continue
    seen.add(name)
    const ref = /^var\(\s*--([A-Za-z0-9_-]+)\s*\)$/.exec(raw)
    let v: Record<string, unknown> | null
    if (ref) {
      const target = cleanName(ref[1] as string)
      const t = out.find((o) => o.name === target)?.variable.type ?? "string"
      v = { type: t, value: { $ref: target } }
    } else if (COLOR_RE.test(raw)) v = { type: "color", value: raw }
    else if (/^-?\d+(\.\d+)?(px)?$/.test(raw)) v = { type: "number", value: Number.parseFloat(raw) }
    else v = { type: "string", value: raw.replace(/^["']|["']$/g, "") }
    out.push({ name, variable: v })
  }
  return out
}

/** Image MIME type from magic bytes (formats CanvasKit decodes), or null. */
export function sniffImage(bytes: Uint8Array): string | null {
  const at = (i: number, sig: readonly number[]) => sig.every((b, k) => bytes[i + k] === b)
  const ascii = (i: number, t: string) =>
    at(
      i,
      [...t].map((c) => c.charCodeAt(0)),
    )
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif"
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp"
  if (ascii(4, "ftyp") && (ascii(8, "avif") || ascii(8, "avis"))) return "image/avif"
  return null
}

export const EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "font/woff": "woff",
  "font/woff2": "woff2",
}

/** Font MIME type from magic bytes, or null. */
export function sniffFont(bytes: Uint8Array): string | null {
  const tag = String.fromCharCode(...bytes.subarray(0, 4))
  if (tag === "wOFF") return "font/woff"
  if (tag === "wOF2") return "font/woff2"
  if (tag === "OTTO") return "font/otf"
  if (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) return "font/ttf"
  if (tag === "true") return "font/ttf"
  return null
}

/** Intrinsic size of PNG / GIF / JPEG / WebP bytes (null when unknown). */
export function imageSize(bytes: Uint8Array, mime: string): { w: number; h: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  try {
    if (mime === "image/png") return { w: dv.getUint32(16), h: dv.getUint32(20) }
    if (mime === "image/gif") return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) }
    if (mime === "image/webp") {
      const kind = String.fromCharCode(...bytes.subarray(12, 16))
      if (kind === "VP8X")
        return {
          w:
            1 +
            (bytes[24] as number) +
            ((bytes[25] as number) << 8) +
            ((bytes[26] as number) << 16),
          h:
            1 +
            (bytes[27] as number) +
            ((bytes[28] as number) << 8) +
            ((bytes[29] as number) << 16),
        }
      if (kind === "VP8 ")
        return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff }
      if (kind === "VP8L") {
        const b = dv.getUint32(21, true)
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }
      }
    }
    if (mime === "image/jpeg") {
      let i = 2
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null
        const marker = bytes[i + 1] as number
        const len = dv.getUint16(i + 2)
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        )
          return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) }
        i += 2 + len
      }
    }
  } catch {
    return null
  }
  return null
}
