/**
 * File previews for Home's grid cards (board 37 §9 "File previews"): a small PNG of a file's
 * first frame, kept in an app-data cache (`<kimo home>/thumbs`), never next to the file.
 *
 * Layout of the cache, one pair per file, keyed by the file's path:
 * - `<key>.png`: the preview (520 × 328, 2× of the 260 × 164 card thumbnail);
 * - `<key>.json`: `{ ref, hash, updatedAt }`, where `hash` is the content hash the preview was
 *   rendered from (the editor skips a render when it matches).
 * `key` is the first 32 hex digits of `sha256(ref)`. One pair per file (no shared index), so
 * editor windows writing previews of different files never race.
 */
import { isPlatformError } from "./errors"
import type { FileRef, FilesApi } from "./types"
import { sha256Hex } from "./util"

/** What the cache knows about one file's preview. */
export interface ThumbnailInfo {
  ref: FileRef
  /** Content hash the preview was rendered from (`template:<slug>` for a seeded cover). */
  hash: string
  updatedAt: number
}

export interface ThumbnailsApi {
  /** The cache folder (`~/.kimo/thumbs`). */
  readonly dir: string
  /** The preview PNG of `ref`, or null when there is none. */
  read(ref: FileRef): Promise<Uint8Array | null>
  /** What the cache holds for `ref` (null: no preview yet). */
  info(ref: FileRef): Promise<ThumbnailInfo | null>
  /** Stores the preview of `ref`, rendered from content `hash`. */
  write(ref: FileRef, hash: string, png: Uint8Array): Promise<void>
  /** Drops the preview of `ref` (no-op when there is none). */
  remove(ref: FileRef): Promise<void>
  /** Moves the preview of `from` to `to` (Rename); no-op when `from` has none. */
  move(from: FileRef, to: FileRef): Promise<void>
}

/** Cache file stem of `ref`. */
export async function thumbnailKey(ref: FileRef): Promise<string> {
  return (await sha256Hex(new TextEncoder().encode(ref))).slice(0, 32)
}

const missing = (e: unknown) => isPlatformError(e) && e.code === "NOT_FOUND"

/** A {@link ThumbnailsApi} over a host's files, in `dir`. */
export function createFileThumbnails(
  files: FilesApi,
  dir: string,
  now: () => number = Date.now,
): ThumbnailsApi {
  const base = dir.replace(/[/\\]+$/, "")
  const paths = async (ref: FileRef) => {
    const key = await thumbnailKey(ref)
    return { png: `${base}/${key}.png`, json: `${base}/${key}.json` }
  }
  const api: ThumbnailsApi = {
    dir: base,
    async read(ref) {
      try {
        return await files.readBytes((await paths(ref)).png)
      } catch (e) {
        if (missing(e)) return null
        throw e
      }
    },
    async info(ref) {
      try {
        const { text } = await files.readText((await paths(ref)).json)
        const v = JSON.parse(text) as Partial<ThumbnailInfo>
        return v && v.ref === ref && typeof v.hash === "string"
          ? { ref, hash: v.hash, updatedAt: Number(v.updatedAt) || 0 }
          : null
      } catch (e) {
        if (missing(e) || e instanceof SyntaxError) return null
        throw e
      }
    },
    async write(ref, hash, png) {
      const p = await paths(ref)
      await files.writeBytesAtomic(p.png, png, { mkdirs: true })
      const info: ThumbnailInfo = { ref, hash, updatedAt: now() }
      await files.writeTextAtomic(p.json, JSON.stringify(info), { mkdirs: true })
    },
    async remove(ref) {
      const p = await paths(ref)
      await files.remove(p.png).catch(() => {})
      await files.remove(p.json).catch(() => {})
    },
    async move(from, to) {
      if (from === to) return
      const [png, info] = await Promise.all([api.read(from), api.info(from)])
      if (!png) return
      await api.write(to, info?.hash ?? "", png)
      await api.remove(from)
    },
  }
  return api
}

/**
 * An in-memory {@link ThumbnailsApi} (the memory host): kept apart from the host's files so
 * scripted write failures and file-change events never see preview writes.
 */
export function createMemoryThumbnails(
  dir = "/home/test/.kimo/thumbs",
  now: () => number = Date.now,
): ThumbnailsApi {
  const store = new Map<FileRef, { info: ThumbnailInfo; png: Uint8Array }>()
  return {
    dir,
    read: async (ref) => store.get(ref)?.png.slice() ?? null,
    info: async (ref) => {
      const e = store.get(ref)
      return e ? { ...e.info } : null
    },
    async write(ref, hash, png) {
      store.set(ref, { info: { ref, hash, updatedAt: now() }, png: png.slice() })
    },
    async remove(ref) {
      store.delete(ref)
    },
    async move(from, to) {
      const e = store.get(from)
      if (!e || from === to) return
      store.delete(from)
      store.set(to, { info: { ...e.info, ref: to }, png: e.png })
    },
  }
}
