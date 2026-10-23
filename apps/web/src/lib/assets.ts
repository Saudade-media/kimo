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
  /** Full lowercase hex SHA-256 of the bytes, when this store computed it (multiplayer sync). */
  sha256?: string
  /**
   * Where a font file came from, recorded when Kimo itself fetched it (Google). Absent for every
   * other font (a file the user picked, an import): those are never shared (multiplayer §16.5).
   */
  fontSource?: "google"
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

/** Shader sources embedded as assets when a file is shared (multiplayer spec §16.6). */
export const SHADER_MIME = "text/x-glsl"

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

/** Full lowercase hex SHA-256 of `bytes` (spec §12 rule 2 `sha256`). */
export async function contentDigest(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const digest = await crypto.subtle.digest("SHA-256", buf as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** First 16 lowercase hex digits of the SHA-256 of `bytes` (spec §12 rule 1). */
export async function contentHash(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  return (await contentDigest(bytes)).slice(0, 16)
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
  /** Full lowercase hex SHA-256 of the file (written by writers that share or sync assets). */
  sha256?: string
}

export function manifestEntry(info: AssetInfo): ManifestEntry {
  const e: ManifestEntry = { mime: info.mime, bytes: info.bytes }
  if (info.sha256 !== undefined) e.sha256 = info.sha256
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
   * package, a relay); verifies the content hash. Returns null when the bytes do not match the
   * key, or when an image is over {@link MAX_ASSET_PIXELS} (checked from its header, before any
   * decode).
   */
  putKey(
    key: string,
    bytes: Uint8Array,
    entry?: Partial<ManifestEntry> & Pick<AssetInfo, "fontSource">,
  ): Promise<AssetInfo | null>
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

/**
 * Pixel size an image's own header declares (PNG, JPEG, GIF, WebP, AVIF), without decoding it;
 * null when the header is not recognized. Bytes from a peer are checked with this before they
 * reach a decoder, since the file size cap says nothing about decoded pixels.
 */
export function imageHeaderSize(bytes: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)
  const u16le = (i: number) => (bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8)
  const u24le = (i: number) => u16le(i) | ((bytes[i + 2] ?? 0) << 16)
  const u32be = (i: number) => u16be(i) * 65536 + u16be(i + 2)
  const ascii = (i: number, t: string) => [...t].every((c, k) => bytes[i + k] === c.charCodeAt(0))
  switch (sniffImage(bytes)) {
    case "image/png":
      return ascii(12, "IHDR") ? { width: u32be(16), height: u32be(20) } : null
    case "image/gif":
      return { width: u16le(6), height: u16le(8) }
    case "image/jpeg": {
      let i = 2
      while (i + 8 < bytes.length) {
        if (bytes[i] !== 0xff) {
          i++
          continue
        }
        const marker = bytes[i + 1] as number
        if (marker === 0xff) {
          i++
          continue
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2
          continue
        }
        // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
          return { width: u16be(i + 7), height: u16be(i + 5) }
        i += 2 + u16be(i + 2)
      }
      return null
    }
    case "image/webp": {
      if (ascii(12, "VP8X")) return { width: u24le(24) + 1, height: u24le(27) + 1 }
      if (ascii(12, "VP8L")) {
        const bits = u16le(21) | (u16le(23) << 16)
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
      }
      if (ascii(12, "VP8 ")) return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff }
      return null
    }
    case "image/avif": {
      // `ispe` boxes (image spatial extents): the largest one is what a decoder may allocate.
      let best: { width: number; height: number } | null = null
      const end = Math.min(bytes.length - 20, 65_536)
      for (let i = 4; i < end; i++) {
        if (!ascii(i, "ispe")) continue
        const width = u32be(i + 8)
        const height = u32be(i + 12)
        if (!best || width * height > best.width * best.height) best = { width, height }
      }
      return best
    }
    default:
      return null
  }
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

/** An asset store that keeps its bytes in memory (guest rooms without storage, tests). */
export function createMemoryAssetStore(): AssetStore {
  const rows = new Map<string, Row>()
  return assetStoreOver({
    get: async (key) => rows.get(key),
    put: async (row) => {
      rows.set(row.key, row)
    },
    keys: async () => [...rows.keys()],
    close() {},
  })
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
      (ext === "glsl" ? SHADER_MIME : undefined) ??
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
          // The folder keeps bytes only, so provenance is a rule: Kimo writes a font here only
          // when it fetched the face from Google (§16.5), so one found on reopen is that.
          ...(Object.hasOwn(FONT_EXT_MIME, key.slice(key.lastIndexOf(".") + 1).toLowerCase())
            ? { fontSource: "google" as const }
            : {}),
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
  /** Font provenance of this session, for backends that keep no row of their own (the folder). */
  const fontSources = new Map<string, "google">()
  const strip = ({ key, data: _d, ...rest }: Row): AssetInfo => {
    const fontSource = rest.fontSource ?? fontSources.get(key)
    const info: AssetInfo = fontSource ? { ...rest, fontSource } : rest
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
      const sha256 = await contentDigest(bytes)
      const key = `${sha256.slice(0, 16)}.${ext}`
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
        sha256,
        data,
      })
    },
    async putKey(key, bytes, entry = {}) {
      const m = /^([0-9a-f]{16})\.([a-z0-9]{1,8})$/.exec(key)
      const sha256 = m ? await contentDigest(bytes) : ""
      if (!m || sha256.slice(0, 16) !== m[1]) return null
      const existing = await get(key)
      if (existing) {
        if (entry.fontSource && !existing.fontSource && fontSources.get(key) !== entry.fontSource) {
          fontSources.set(key, entry.fontSource)
          await rows.put({ ...existing, fontSource: entry.fontSource })
        }
        return strip(existing)
      }
      // A declared type never overrides what the bytes are: it must not switch off the pixel guard.
      const sniffed = sniffImage(bytes)
      const mime =
        (sniffed ? null : entry.mime) ??
        sniffed ??
        mimeForExtension(m[2] as string) ??
        (m[2] === "glsl" ? SHADER_MIME : null)
      if (!mime) return null
      // Bytes from a peer: refuse a decompression bomb from its header, before any decode.
      if (sniffed || mime.startsWith("image/")) {
        const declared = imageHeaderSize(bytes)
        if (declared && declared.width * declared.height > MAX_ASSET_PIXELS) return null
      }
      const data = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })
      const size =
        entry.width !== undefined && entry.height !== undefined
          ? { width: entry.width, height: entry.height }
          : mime.startsWith("image/")
            ? await imageSize(data)
            : null
      if (size && size.width * size.height > MAX_ASSET_PIXELS) return null
      if (entry.fontSource) fontSources.set(key, entry.fontSource)
      return store({
        key,
        src: `./assets/${key}`,
        mime,
        bytes: bytes.byteLength,
        ...(size ?? {}),
        ...(entry.name !== undefined ? { name: entry.name } : {}),
        ...(entry.fontSource ? { fontSource: entry.fontSource } : {}),
        sha256,
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
