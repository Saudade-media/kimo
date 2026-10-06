/**
 * Web asset store (spec §12): content-addressed binary assets per file, kept in IndexedDB
 * database `kimo-assets-<fileId>` (object store `assets`, key = `<sha256-16>.<ext>`).
 * Image fills and the canvas Image tool reference them as `./assets/<hash>.<ext>`; the
 * renderer reads them through {@link AssetStore.source}.
 */
import { dirnameOf, type FileRef, type KimoPlatform, resolveAgainstFile } from "@kimo/platform"
import type { AssetSource } from "@kimo/renderer"

/** What a stored asset carries besides its bytes (the spec's manifest entry). */
export interface AssetInfo {
  /** `./assets/<hash>.<ext>` */
  src: string
  mime: string
  bytes: number
  width?: number
  height?: number
  /** Original file name (informative). */
  name?: string
}

interface Row extends AssetInfo {
  key: string
  data: Blob
}

const STORE = "assets"
export const assetDbName = (fileId: string) => `kimo-assets-${fileId}`

/** Image formats CanvasKit decodes, by MIME type → file extension. */
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
}

/** MIME type of an extension this store writes (`png` → `image/png`). */
export function mimeForExtension(ext: string): string | null {
  for (const [mime, e] of Object.entries(EXT)) if (e === ext.toLowerCase()) return mime
  return ext.toLowerCase() === "jpeg" ? "image/jpeg" : null
}

/** Font files stored as document assets (board 28: Google faces stored on first use). */
const FONT_EXT_MIME: Readonly<Record<string, string>> = {
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
}

/** File picker `accept` for image intake (the formats {@link sniffImage} recognizes). */
export const IMAGE_ACCEPT = Object.keys(EXT).join(",")

/**
 * Largest image file accepted (bytes); checked before reading or hashing. Board 27 §3 rules
 * (N77cg "Storage"): 20 MB per image.
 */
export const MAX_ASSET_BYTES = 20 * 1024 * 1024
/** Largest decoded image accepted (pixels): 16k × 16k worth of RGBA would exhaust memory. */
export const MAX_ASSET_PIXELS = 100_000_000

/**
 * The image format of `bytes` from its magic number (PNG, JPEG, GIF, WebP, AVIF), or null.
 * The file's declared type and name are not trusted: a `.pdf` picked with "All files" or an
 * SVG (which CanvasKit cannot decode) is rejected here.
 */
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

/** Rejected image intake (unsupported format, too large, undecodable). */
export class AssetError extends Error {
  override readonly name = "AssetError"
}

/** Lowercase extension for a supported image MIME type, else null. */
export function extensionFor(mime: string): string | null {
  return EXT[mime.toLowerCase()] ?? null
}

/** First 16 lowercase hex digits of the SHA-256 of `bytes` (spec §12 rule 1). */
export async function contentHash(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const digest = await crypto.subtle.digest("SHA-256", buf as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** `./assets/<hash>.<ext>` → `<hash>.<ext>` (null when not an asset reference). */
export function assetKey(src: string): string | null {
  const m = /^\.\/assets\/([0-9a-f]{16}\.[a-z0-9]{1,8})$/.exec(src)
  return m ? (m[1] as string) : null
}

/** The spec §12 manifest entry of an asset (`assets` header member). */
export interface ManifestEntry {
  mime: string
  bytes?: number
  width?: number
  height?: number
  name?: string
}

export function manifestEntry(info: AssetInfo): ManifestEntry {
  const e: ManifestEntry = { mime: info.mime, bytes: info.bytes }
  if (info.width !== undefined) e.width = info.width
  if (info.height !== undefined) e.height = info.height
  if (info.name !== undefined) e.name = info.name
  return e
}

export interface AssetStore {
  /** Renderer source: bytes by reference. */
  readonly source: AssetSource
  /**
   * Stores an image file (deduplicated by content) and returns its reference and size.
   * Rejects ({@link AssetError}) files over {@link MAX_ASSET_BYTES}, formats other than
   * PNG/JPEG/GIF/WebP/AVIF (sniffed from the bytes) and images that do not decode.
   */
  put(file: Blob & { name?: string }): Promise<AssetInfo>
  /**
   * Stores bytes under an existing reference key (`<hash>.<ext>`, e.g. from a `.kimoz`
   * package); verifies the content hash. Returns null when the bytes do not match the key.
   */
  putKey(key: string, bytes: Uint8Array, entry?: Partial<ManifestEntry>): Promise<AssetInfo | null>
  /** Every stored key. */
  keys(): Promise<string[]>
  /** Bytes of a stored asset. */
  bytes(key: string): Promise<Uint8Array | null>
  info(src: string): Promise<AssetInfo | null>
  /** Manifest entry of an asset this session stored or read (sync cache), else null. */
  entrySync(src: string): ManifestEntry | null
  /** An object URL for a stored asset (cached; revoked by {@link dispose}). */
  url(src: string): Promise<string | null>
  /** Synchronous read of an already created object URL. */
  urlSync(src: string): string | null
  /** Fires after `put` stores a new asset or `url` resolves one. */
  subscribe(cb: () => void): () => void
  dispose(): void
}

async function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const size = { width: bmp.width, height: bmp.height }
    bmp.close()
    return size
  } catch {
    return null
  }
}

/** Where an {@link AssetStore} keeps its rows. */
interface RowBackend {
  get(key: string): Promise<Row | undefined>
  put(row: Row): Promise<void>
  keys(): Promise<string[]>
  close(): void
}

/** Opens (lazily) the asset store of file `fileId` (browser library, IndexedDB). */
export function createAssetStore(fileId: string): AssetStore {
  return assetStoreOver(indexedDbRows(fileId))
}

/** Shader sources a `shader` paint may reference (spec §7.1: a path relative to the `.kimo`). */
const SHADER_SOURCE = /^\.{1,2}\/(?:[^\\/\s]+\/)*[^\\/\s]+\.(?:glsl|frag|fs|fsh)$/i

/**
 * The asset store of a `.kimo` on disk: `assets/<hash>.<ext>` beside the file (spec §12),
 * read and written through `platform.files` (atomic writes; the folder is created on demand).
 * Its renderer source also reads shader paint sources (`./shaders/x.glsl`, `../x.glsl`)
 * relative to the file.
 */
export function createFolderAssetStore(platform: KimoPlatform, kimoRef: FileRef): AssetStore {
  const store = folderAssetStore(platform, kimoRef)
  const assets = store.source
  const source: AssetSource = {
    async load(src) {
      if (assetKey(src) || !SHADER_SOURCE.test(src)) return assets.load(src)
      try {
        return await platform.files.readBytes(resolveAgainstFile(kimoRef, src))
      } catch {
        return null
      }
    },
  }
  return { ...store, source }
}

function folderAssetStore(platform: KimoPlatform, kimoRef: FileRef): AssetStore {
  const dir = `${dirnameOf(kimoRef).replace(/\/$/, "")}/assets`
  const mimeOf = (key: string) => {
    const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase()
    return (
      mimeForExtension(ext) ??
      FONT_EXT_MIME[ext] ??
      (ext === "svg" ? "image/svg+xml" : "application/octet-stream")
    )
  }
  return assetStoreOver({
    async get(key) {
      if (!/^[0-9a-f]{16}\.[a-z0-9]{1,8}$/.test(key)) return undefined
      try {
        const bytes = await platform.files.readBytes(`${dir}/${key}`)
        const mime = mimeOf(key)
        return {
          key,
          src: `./assets/${key}`,
          mime,
          bytes: bytes.byteLength,
          data: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }),
        }
      } catch {
        return undefined
      }
    },
    async put(row) {
      const bytes = new Uint8Array(await row.data.arrayBuffer())
      await platform.files.writeBytesAtomic(`${dir}/${row.key}`, bytes, { mkdirs: true })
    },
    async keys() {
      const stat = await platform.files.stat(dir).catch(() => null)
      if (stat?.kind !== "directory") return []
      return (await platform.files.list(dir)).filter((e) => e.kind === "file").map((e) => e.name)
    },
    close() {},
  })
}

function indexedDbRows(fileId: string): RowBackend {
  let dbp: Promise<IDBDatabase> | null = null
  const db = () =>
    (dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(assetDbName(fileId), 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE))
          req.result.createObjectStore(STORE, { keyPath: "key" })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }))
  const run = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) =>
    db().then(
      (d) =>
        new Promise<T>((resolve, reject) => {
          const t = d.transaction(STORE, mode)
          const req = f(t.objectStore(STORE))
          t.oncomplete = () => resolve(req.result)
          t.onerror = () => reject(t.error)
          t.onabort = () => reject(t.error)
        }),
    )
  return {
    get: (key) => run<Row | undefined>("readonly", (s) => s.get(key)),
    put: async (row) => {
      await run("readwrite", (s) => s.put(row))
    },
    keys: async () => (await run<IDBValidKey[]>("readonly", (s) => s.getAllKeys())).map(String),
    close() {
      void dbp?.then((d) => d.close()).catch(() => undefined)
    },
  }
}

function assetStoreOver(rows: RowBackend): AssetStore {
  const get = (key: string) => rows.get(key)
  const urls = new Map<string, string>()
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const l of [...listeners]) l()
  }

  const entries = new Map<string, ManifestEntry>()
  const strip = ({ key: _k, data: _d, ...info }: Row): AssetInfo => {
    entries.set(info.src, manifestEntry(info))
    return info
  }
  const store = async (row: Row) => {
    await rows.put(row)
    emit()
    return strip(row)
  }

  return {
    source: {
      async load(src) {
        const key = assetKey(src)
        if (!key) return null
        try {
          const row = await get(key)
          return row ? new Uint8Array(await row.data.arrayBuffer()) : null
        } catch {
          return null
        }
      },
    },
    async put(file) {
      if (file.size > MAX_ASSET_BYTES)
        throw new AssetError(
          `Image is too large (${Math.round(file.size / 1048576)} MB; the limit is ${MAX_ASSET_BYTES / 1048576} MB)`,
        )
      const bytes = new Uint8Array(await file.arrayBuffer())
      const mime = sniffImage(bytes)
      const ext = mime ? extensionFor(mime) : null
      if (!mime || !ext)
        throw new AssetError(
          `Unsupported image format${file.name ? ` (${file.name})` : ""}: use PNG, JPEG, GIF, WebP or AVIF`,
        )
      const key = `${await contentHash(bytes)}.${ext}`
      const existing = await get(key)
      if (existing) return strip(existing)
      const data = new Blob([bytes], { type: mime })
      const size = await imageSize(data)
      if (!size)
        throw new AssetError(`The image${file.name ? ` ${file.name}` : ""} could not be decoded`)
      if (size.width * size.height > MAX_ASSET_PIXELS)
        throw new AssetError(`Image is too large (${size.width} × ${size.height} px)`)
      return store({
        key,
        src: `./assets/${key}`,
        mime,
        bytes: bytes.byteLength,
        ...size,
        ...(file.name ? { name: file.name } : {}),
        data,
      })
    },
    async putKey(key, bytes, entry = {}) {
      const m = /^([0-9a-f]{16})\.([a-z0-9]{1,8})$/.exec(key)
      if (!m || (await contentHash(bytes)) !== m[1]) return null
      const existing = await get(key)
      if (existing) return strip(existing)
      const mime = entry.mime ?? sniffImage(bytes) ?? mimeForExtension(m[2] as string)
      if (!mime) return null
      const data = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })
      const size =
        entry.width !== undefined && entry.height !== undefined
          ? { width: entry.width, height: entry.height }
          : mime.startsWith("image/")
            ? await imageSize(data)
            : null
      return store({
        key,
        src: `./assets/${key}`,
        mime,
        bytes: bytes.byteLength,
        ...(size ?? {}),
        ...(entry.name !== undefined ? { name: entry.name } : {}),
        data,
      })
    },
    keys: () => rows.keys(),
    async bytes(key) {
      const row = await get(key).catch(() => undefined)
      return row ? new Uint8Array(await row.data.arrayBuffer()) : null
    },
    entrySync: (src) => entries.get(src) ?? null,
    async info(src) {
      const key = assetKey(src)
      const row = key ? await get(key).catch(() => undefined) : undefined
      return row ? strip(row) : null
    },
    async url(src) {
      const cached = urls.get(src)
      if (cached) return cached
      const key = assetKey(src)
      const row = key ? await get(key).catch(() => undefined) : undefined
      if (!row) return null
      const u = urls.get(src) ?? URL.createObjectURL(row.data)
      if (!urls.has(src)) {
        urls.set(src, u)
        emit()
      }
      return u
    },
    urlSync: (src) => urls.get(src) ?? null,
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    dispose() {
      for (const u of urls.values()) URL.revokeObjectURL(u)
      urls.clear()
      listeners.clear()
      rows.close()
    },
  }
}

/** Deletes a file's asset database (file deleted from the library). */
export function deleteAssetDb(fileId: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(assetDbName(fileId))
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}
