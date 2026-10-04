/**
 * Board 25 §6 (d) "OpenType · custom tag · font support" (g95jKz, rule v0gB4
 * `font.features.has(tag)`): the OpenType feature tags a font file really has, read from the
 * FeatureList of its GSUB and GPOS tables.
 *
 * Supported containers: TrueType / OpenType (`0x00010000`, `true`, `OTTO`), collections
 * (`ttcf`, first face) and WOFF 1 (zlib tables are inflated with `DecompressionStream`). WOFF 2
 * (Brotli + transformed tables) is not decoded: the result is `null` = unknown, and the UI then
 * shows no hint (rule: "Unknown when the font can't be inspected").
 */

const tagAt = (v: DataView, o: number) =>
  String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))

interface TableRef {
  /** Table bytes (already uncompressed) or a WOFF zlib stream. */
  bytes: Uint8Array
  compressed: boolean
}

/** The GSUB / GPOS tables of the first face, or null when the container is not sfnt / WOFF 1. */
function layoutTables(bytes: Uint8Array): TableRef[] | null {
  if (bytes.byteLength < 12) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sig = tagAt(v, 0)
  const want = (t: string) => t === "GSUB" || t === "GPOS"
  const out: TableRef[] = []
  const slice = (off: number, len: number) => {
    if (off < 0 || len < 0 || off + len > bytes.byteLength) throw new RangeError("table bounds")
    return bytes.subarray(off, off + len)
  }
  if (sig === "wOFF") {
    if (bytes.byteLength < 44) return null
    const n = v.getUint16(12)
    for (let i = 0; i < n; i++) {
      const r = 44 + i * 20
      const tag = tagAt(v, r)
      if (!want(tag)) continue
      const off = v.getUint32(r + 4)
      const comp = v.getUint32(r + 8)
      const orig = v.getUint32(r + 12)
      out.push({ bytes: slice(off, comp), compressed: comp < orig })
    }
    return out
  }
  let base = 0
  if (sig === "ttcf") {
    if (v.getUint32(8) < 1) return null
    base = v.getUint32(12)
  } else if (sig === "wOF2") return null
  const ver = v.getUint32(base)
  if (ver !== 0x00010000 && tagAt(v, base) !== "OTTO" && tagAt(v, base) !== "true") return null
  const n = v.getUint16(base + 4)
  for (let i = 0; i < n; i++) {
    const r = base + 12 + i * 16
    const tag = tagAt(v, r)
    if (!want(tag)) continue
    out.push({ bytes: slice(v.getUint32(r + 8), v.getUint32(r + 12)), compressed: false })
  }
  return out
}

/** Feature tags of one GSUB / GPOS table (header → FeatureList → FeatureRecord tags). */
export function featureListTags(table: Uint8Array, into: Set<string> = new Set()): Set<string> {
  if (table.byteLength < 10) return into
  const v = new DataView(table.buffer, table.byteOffset, table.byteLength)
  const list = v.getUint16(6)
  if (list === 0 || list + 2 > table.byteLength) return into
  const count = v.getUint16(list)
  for (let i = 0; i < count; i++) {
    const r = list + 2 + i * 6
    if (r + 4 > table.byteLength) break
    into.add(tagAt(v, r))
  }
  return into
}

/** Synchronous variant for uncompressed sfnt / TTC (null for WOFF / WOFF 2 / unknown data). */
export function sfntFeatureTags(bytes: Uint8Array): Set<string> | null {
  try {
    const tables = layoutTables(bytes)
    if (!tables || tables.some((t) => t.compressed)) return null
    const out = new Set<string>()
    for (const t of tables) featureListTags(t.bytes, out)
    return out
  } catch {
    return null
  }
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null
  try {
    const stream = new Blob([data as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

const cache = new WeakMap<Uint8Array, Promise<ReadonlySet<string> | null>>()

/**
 * The OpenType feature tags of a font file (GSUB ∪ GPOS FeatureList), cached per byte array.
 * Null = unknown (WOFF 2, unparsable data, no DecompressionStream for a compressed WOFF table).
 */
export function fontFeatureTags(bytes: Uint8Array): Promise<ReadonlySet<string> | null> {
  const hit = cache.get(bytes)
  if (hit) return hit
  const run = (async () => {
    let tables: TableRef[] | null
    try {
      tables = layoutTables(bytes)
    } catch {
      return null
    }
    if (!tables) return null
    const out = new Set<string>()
    for (const t of tables) {
      const data = t.compressed ? await inflate(t.bytes) : t.bytes
      if (!data) return null
      try {
        featureListTags(data, out)
      } catch {
        return null
      }
    }
    return out as ReadonlySet<string>
  })()
  cache.set(bytes, run)
  return run
}
