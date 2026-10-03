/**
 * Minimal font file inspection (ADR 0012 "Fonts", board 19): reads the family, weight, style and
 * embedding permission of a TTF/OTF/WOFF file from its `name` and `OS/2` tables, so document font
 * assets (`./assets/<hash>.ttf`) can be matched to the families a document uses without trusting
 * a file name. WOFF2 needs a Brotli decoder and is not inspected (returns null): hosts pass its
 * family explicitly.
 */

export interface FontFileInfo {
  /** Typographic family (name ID 16), else the legacy family (ID 1). */
  family: string
  /** Typographic subfamily (ID 17), else ID 2 ("Regular", "SemiBold Italic"). */
  subfamily: string
  /** `OS/2.usWeightClass` (1–1000), 400 when absent. */
  weight: number
  italic: boolean
  /** `OS/2.fsType`; 0 = installable embedding. */
  fsType: number
  /** True when the license bits allow embedding the font in a document package. */
  embeddable: boolean
  format: "truetype" | "opentype" | "woff"
}

interface TableRecord {
  tag: string
  offset: number
  length: number
  /** WOFF only: compressed length (== length when stored uncompressed). */
  compLength?: number
}

const tag = (v: DataView, o: number) =>
  String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))

/** The sfnt flavour of `bytes`, or null when it is not a TTF/OTF/WOFF file. */
export function fontFormat(bytes: Uint8Array): FontFileInfo["format"] | "woff2" | null {
  if (bytes.byteLength < 12) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const t = tag(v, 0)
  if (t === "wOFF") return "woff"
  if (t === "wOF2") return "woff2"
  if (t === "OTTO") return "opentype"
  if (t === "true" || v.getUint32(0) === 0x00010000) return "truetype"
  return null
}

function sfntTables(v: DataView): TableRecord[] | null {
  const n = v.getUint16(4)
  if (12 + n * 16 > v.byteLength) return null
  const out: TableRecord[] = []
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16
    out.push({ tag: tag(v, o), offset: v.getUint32(o + 8), length: v.getUint32(o + 12) })
  }
  return out
}

function woffTables(v: DataView): TableRecord[] | null {
  const n = v.getUint16(12)
  if (44 + n * 20 > v.byteLength) return null
  const out: TableRecord[] = []
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20
    out.push({
      tag: tag(v, o),
      offset: v.getUint32(o + 4),
      compLength: v.getUint32(o + 8),
      length: v.getUint32(o + 12),
    })
  }
  return out
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream
  if (!DS) return null
  try {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DS("deflate"))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

async function tableBytes(bytes: Uint8Array, t: TableRecord): Promise<Uint8Array | null> {
  const len = t.compLength ?? t.length
  if (t.offset + len > bytes.byteLength) return null
  const raw = bytes.subarray(t.offset, t.offset + len)
  if (t.compLength === undefined || t.compLength === t.length) return raw
  const out = await inflate(raw)
  return out && out.byteLength === t.length ? out : null
}

function decodeName(b: Uint8Array, platform: number): string {
  if (platform === 0 || platform === 3) {
    let s = ""
    for (let i = 0; i + 1 < b.length; i += 2)
      s += String.fromCharCode(((b[i] ?? 0) << 8) | (b[i + 1] ?? 0))
    return s
  }
  let s = ""
  for (const c of b) s += String.fromCharCode(c)
  return s
}

function readNames(t: Uint8Array): Map<number, string> {
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength)
  const names = new Map<number, { s: string; rank: number }>()
  if (t.byteLength < 6) return new Map()
  const count = v.getUint16(2)
  const strings = v.getUint16(4)
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12
    if (o + 12 > t.byteLength) break
    const platform = v.getUint16(o)
    const encoding = v.getUint16(o + 2)
    const language = v.getUint16(o + 4)
    const id = v.getUint16(o + 6)
    const length = v.getUint16(o + 8)
    const offset = v.getUint16(o + 10)
    if (![1, 2, 16, 17].includes(id)) continue
    const start = strings + offset
    if (start + length > t.byteLength) continue
    // Prefer Windows Unicode English (US), then any Windows/Unicode, then Mac Roman.
    const rank =
      platform === 3 && (encoding === 1 || encoding === 10) && language === 0x409
        ? 0
        : platform === 3 || platform === 0
          ? 1
          : platform === 1 && encoding === 0
            ? 2
            : 9
    if (rank === 9) continue
    const prev = names.get(id)
    if (!prev || rank < prev.rank)
      names.set(id, { s: decodeName(t.subarray(start, start + length), platform), rank })
  }
  return new Map([...names].map(([k, x]) => [k, x.s.replace(/\0/g, "").trim()]))
}

/**
 * Family, weight, style and embedding bits of a font file, or null when it is not a readable
 * TTF/OTF/WOFF file (WOFF2, truncated or malformed input). Never throws.
 */
export async function readFontInfo(bytes: Uint8Array): Promise<FontFileInfo | null> {
  try {
    const format = fontFormat(bytes)
    if (!format || format === "woff2") return null
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const tables = format === "woff" ? woffTables(v) : sfntTables(v)
    if (!tables) return null
    const nameRec = tables.find((t) => t.tag === "name")
    if (!nameRec) return null
    const nameTable = await tableBytes(bytes, nameRec)
    if (!nameTable) return null
    const names = readNames(nameTable)
    const family = names.get(16) || names.get(1)
    if (!family) return null
    const subfamily = names.get(17) || names.get(2) || "Regular"
    let weight = 400
    let italic = /italic|oblique/i.test(subfamily)
    let fsType = 0
    const os2Rec = tables.find((t) => t.tag === "OS/2")
    const os2 = os2Rec ? await tableBytes(bytes, os2Rec) : null
    if (os2 && os2.byteLength >= 64) {
      const o = new DataView(os2.buffer, os2.byteOffset, os2.byteLength)
      const w = o.getUint16(4)
      if (w >= 1 && w <= 1000) weight = w
      fsType = o.getUint16(8)
      italic = italic || (o.getUint16(62) & 1) === 1
    }
    return {
      family,
      subfamily,
      weight,
      italic,
      fsType,
      embeddable: fsEmbeddable(fsType),
      format,
    }
  } catch {
    return null
  }
}

/**
 * OS/2 `fsType` embedding rule used by "Embed fonts in .kimoz packages": installable (0),
 * preview & print (4) and editable (8) allow embedding; restricted (2, without 4/8) and
 * bitmap-only (0x200) do not.
 */
export function fsEmbeddable(fsType: number): boolean {
  if (fsType & 0x200) return false
  const usage = fsType & 0xf
  if (usage === 0) return true
  if (usage & 0x8 || usage & 0x4) return true
  return false
}
