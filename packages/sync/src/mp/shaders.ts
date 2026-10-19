/**
 * Shader embedding at share time (docs/spec/multiplayer.md §16.6): every shader paint
 * `{ kind: "shader", src }` whose `src` is a relative file path becomes a hash-named asset
 * `./assets/<hash16>.glsl`, so the shader travels as a blob instead of a path the guest lacks.
 */

import { sha256 } from "./blob-crypto"
import type { BlobManifestEntry } from "./blobs"
import { toHex } from "./bytes"

export interface ShaderAssetStore {
  putKey(key: string, bytes: Uint8Array, entry?: BlobManifestEntry): Promise<unknown | null>
}

export interface EmbedShadersResult<T> {
  doc: T
  embedded: number
  /** Sources that could not be read or stored; left unchanged. */
  missing: string[]
  /** Manifest entries to add, by asset key (`<hash16>.glsl`). */
  entries: Record<string, BlobManifestEntry & { mime: string; bytes: number; sha256: string }>
}

const ASSET_REF = /^\.\/assets\//
/** The shader file types a `shader` paint may name (same set as the renderer's source loader). */
const SHADER_EXTENSION = /\.(?:glsl|frag|fs|fsh)$/i
/** A shader source larger than this is not embedded (it would also be uploaded to the room). */
export const MAX_SHADER_BYTES = 1024 * 1024

/**
 * Whether `src` is a shader file inside the document's folder: a shader extension (so a stray
 * path such as `../.ssh/id_ed25519` is never read into a room), no absolute path, URL scheme or `..`.
 */
export function isRelativeShaderSource(src: string): boolean {
  if (src === "" || src.includes("\0")) return false
  if (!SHADER_EXTENSION.test(src)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false
  if (/^[\\/]/.test(src)) return false
  return !src.split(/[\\/]/).includes("..")
}

/** Rewrites shader sources in `doc` (a plain JSON document) and returns a modified copy. */
export async function embedShaders<T>(
  doc: T,
  read: (path: string) => Promise<Uint8Array | null>,
  assets: ShaderAssetStore,
): Promise<EmbedShadersResult<T>> {
  const entries: EmbedShadersResult<T>["entries"] = {}
  const missing: string[] = []
  const done = new Map<string, string | null>()
  let embedded = 0

  async function embed(src: string): Promise<string | null> {
    if (done.has(src)) return done.get(src) ?? null
    let result: string | null = null
    try {
      if (!isRelativeShaderSource(src)) throw new Error("not relative")
      const bytes = await read(src)
      if (bytes && bytes.length <= MAX_SHADER_BYTES) {
        const sha = toHex(await sha256(bytes))
        const key = `${sha.slice(0, 16)}.glsl`
        const entry = {
          mime: "text/x-glsl",
          bytes: bytes.length,
          name: src.split("/").pop() ?? src,
          sha256: sha,
        }
        if ((await assets.putKey(key, bytes, entry)) !== null) {
          entries[key] = entry
          result = `./assets/${key}`
          embedded++
        }
      }
    } catch {
      result = null
    }
    done.set(src, result)
    if (result === null) missing.push(src)
    return result
  }

  async function walk(value: unknown): Promise<unknown> {
    if (Array.isArray(value)) {
      const items: unknown[] = []
      for (const item of value) items.push(await walk(item))
      return items
    }
    if (typeof value !== "object" || value === null) return value
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(record)) out[k] = await walk(v)
    if (record.kind === "shader" && typeof record.src === "string" && !ASSET_REF.test(record.src)) {
      const ref = await embed(record.src)
      if (ref !== null) out.src = ref
    }
    return out
  }

  return { doc: (await walk(doc)) as T, embedded, missing, entries }
}
