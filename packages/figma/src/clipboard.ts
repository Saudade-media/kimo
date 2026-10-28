/**
 * Reading a Figma copy. Figma writes `text/html` with two HTML comments inside data attributes:
 * `<!--(figmeta)base64 JSON(/figmeta)-->` (file key, and signed download URLs of the copied
 * images by hash) and `<!--(figma)base64 binary(/figma)-->`. The binary is `fig-kiwi` (or
 * `fig-jam.`), a uint32 LE version, then length-prefixed chunks: the compressed Kiwi schema and
 * the compressed message. Chunks are raw deflate or zstd.
 */
import { inflateSync } from "fflate"
import { decompress } from "fzstd"
import { decodeMessage, decodeSchema, type KiwiValue } from "./kiwi"

/** The `(figmeta)` block of a Figma copy (fields Kimo reads; others are kept). */
export interface FigmaClipboardMeta {
  fileKey?: string
  /** Image hash (40 hex) → signed, expiring download URL. */
  imageHashes?: Record<string, string>
  [key: string]: unknown
}

export interface FigmaClipboard {
  meta: FigmaClipboardMeta | null
  /** `fig-kiwi` (design) or `fig-jam.` (FigJam). */
  kind: string
  version: number
  /** The decoded `Message` (nodeChanges, blobs, …). */
  message: Record<string, KiwiValue>
}

const DATA = /\(figma\)([A-Za-z0-9+/=\s]*)\(\/figma\)/
const META = /\(figmeta\)([A-Za-z0-9+/=\s]*)\(\/figmeta\)/
/** Largest decompressed chunk accepted (a copy of a whole page is a few MB). */
const MAX_CHUNK = 256 * 1024 * 1024

/** True when `html` looks like a Figma copy (cheap; no decoding). */
export function isFigmaClipboard(html: string): boolean {
  return html.includes("(figma)") && DATA.test(html)
}

function base64(s: string): Uint8Array {
  const bin = atob(s.replace(/\s+/g, ""))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function inflate(chunk: Uint8Array): Uint8Array {
  const zstd = chunk[0] === 0x28 && chunk[1] === 0xb5 && chunk[2] === 0x2f && chunk[3] === 0xfd
  const out = zstd ? decompress(chunk) : inflateSync(chunk)
  if (out.length > MAX_CHUNK) throw new Error("Figma clipboard: chunk too large")
  return out
}

function parseMeta(html: string): FigmaClipboardMeta | null {
  const m = META.exec(html)?.[1]
  if (!m) return null
  try {
    const v = JSON.parse(new TextDecoder().decode(base64(m))) as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as FigmaClipboardMeta) : null
  } catch {
    return null
  }
}

/** Decodes a Figma copy from clipboard `text/html`, or returns null when it is not one. */
export function parseFigmaClipboard(html: string): FigmaClipboard | null {
  const data = DATA.exec(html)?.[1]
  if (!data) return null
  const buf = base64(data)
  if (buf.length < 12) throw new Error("Figma clipboard: truncated data")
  const kind = new TextDecoder().decode(buf.subarray(0, 8))
  if (kind !== "fig-kiwi" && kind !== "fig-jam.")
    throw new Error(`Figma clipboard: unknown format "${kind}"`)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const version = view.getUint32(8, true)
  const chunks: Uint8Array[] = []
  for (let o = 12; o + 4 <= buf.length; ) {
    const n = view.getUint32(o, true)
    if (o + 4 + n > buf.length) throw new Error("Figma clipboard: truncated chunk")
    chunks.push(buf.subarray(o + 4, o + 4 + n))
    o += 4 + n
  }
  const [schemaChunk, messageChunk] = chunks
  if (!schemaChunk || !messageChunk) throw new Error("Figma clipboard: missing chunks")
  const schema = decodeSchema(inflate(schemaChunk))
  const message = decodeMessage(schema, "Message", inflate(messageChunk))
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    message instanceof Uint8Array
  )
    throw new Error("Figma clipboard: unexpected message")
  return { meta: parseMeta(html), kind, version, message: message as Record<string, KiwiValue> }
}
