/**
 * Browser file library: an index of local files (IndexedDB database `kimo-files`) plus one
 * y-indexeddb database per document, written through `@kimo/sync`'s `IndexedDbProvider`.
 * Also the `.kimo` open/save helpers (File System Access API with an upload/download fallback).
 */

import { type KimoDocument, localComponents } from "@kimo/core-schema"
import {
  createDocStore,
  type DocStore,
  generateId,
  openDocument,
  serialize,
} from "@kimo/editor-state"
import { readFontInfo } from "@kimo/renderer"
import { IndexedDbProvider } from "@kimo/sync/indexeddb"
import { assetRefs } from "./asset-manifest"
import { type AssetStore, createAssetStore, deleteAssetDb, type ManifestEntry } from "./assets"
import { buildSampleDocument, newDocument } from "./sample"
import { isZip, readZip, writeZip } from "./zip"

/** One entry of the recent-files grid. */
export interface FileMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  /** Number of root frames (shown as "· 6 frames"). */
  frames: number
  /**
   * Board 37 §3 (web Trash): when the file was moved to the Trash. Trashed files leave Recents,
   * All files and search; Home deletes them for good {@link TRASH_RETENTION_MS} later.
   */
  trashedAt?: number
  /** Board 37 §4: component count, and `meta.library` (Design systems). Kept on every save. */
  components?: number
  library?: boolean
}

/** Board 37 rules "Trash · web": files stay in the Trash for 30 days. */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const INDEX_DB = "kimo-files"
const STORE = "files"

/** IndexedDB database holding the document's CRDT updates. */
export const docDbName = (id: string) => `kimo-doc-${id}`

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(INDEX_DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE, { keyPath: "id" })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        t.oncomplete = () => resolve(req.result)
        t.onerror = () => reject(t.error)
      }),
  )
}

async function allFiles(): Promise<FileMeta[]> {
  return tx<FileMeta[]>("readonly", (s) => s.getAll() as IDBRequest<FileMeta[]>)
}

/** All files not in the Trash, most recently edited first. */
export async function listFiles(): Promise<FileMeta[]> {
  return (await allFiles()).filter((f) => !f.trashedAt).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Files in the Trash, most recently trashed first. */
export async function listTrashedFiles(): Promise<FileMeta[]> {
  return (await allFiles())
    .filter((f) => !!f.trashedAt)
    .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
}

/** Moves a file to the Trash (soft delete). */
export async function trashFile(id: string, now = Date.now()): Promise<void> {
  const cur = await getFile(id)
  if (!cur) throw new Error("That file is no longer in this browser")
  await putFile({ ...cur, trashedAt: now })
}

/** Takes a file out of the Trash. */
export async function restoreFile(id: string): Promise<void> {
  const cur = await getFile(id)
  if (!cur) throw new Error("That file is no longer in the Trash")
  const { trashedAt: _, ...rest } = cur
  await putFile(rest)
}

/** Deletes files trashed more than 30 days before `now` for good; resolves to how many. */
export async function purgeTrash(now = Date.now()): Promise<number> {
  const old = (await listTrashedFiles()).filter(
    (f) => now - (f.trashedAt ?? now) > TRASH_RETENTION_MS,
  )
  for (const f of old) await deleteFile(f.id)
  return old.length
}

/** A file's document, read from its database (Duplicate, Download .kimo, Design systems). */
export async function loadFileStore(id: string): Promise<DocStore> {
  const store = createDocStore()
  const provider = new IndexedDbProvider(docDbName(id))
  try {
    await provider.attach(store)
    await provider.detach()
  } catch (e) {
    store.destroy()
    throw e
  }
  return store
}

/** Duplicates a file (document and images) under `name`; resolves to the new id. */
export async function duplicateFile(id: string, name: string): Promise<string> {
  const store = await loadFileStore(id)
  let next: string
  try {
    next = await persistNew(store, name)
  } finally {
    store.destroy()
  }
  const from = createAssetStore(id)
  const to = createAssetStore(next)
  try {
    for (const key of await from.keys()) {
      const bytes = await from.bytes(key)
      if (bytes) await to.putKey(key, bytes)
    }
  } finally {
    from.dispose()
    to.dispose()
  }
  return next
}

/** Component count and `meta.library` of a store (Design systems, board 37 §4). */
export function libraryStats(store: DocStore): { components: number; library: boolean } {
  const doc = store.toDocument()
  return {
    components: localComponents(doc).length,
    library: (doc.meta as { library?: unknown } | undefined)?.library === true,
  }
}

export const getFile = (id: string) =>
  tx<FileMeta | undefined>("readonly", (s) => s.get(id) as IDBRequest<FileMeta | undefined>)

export const putFile = (meta: FileMeta) => tx("readwrite", (s) => s.put(meta)).then(() => undefined)

/** Updates fields of an index entry (no-op when it is gone). */
export async function patchFile(id: string, patch: Partial<Omit<FileMeta, "id">>): Promise<void> {
  const cur = await getFile(id)
  if (cur) await putFile({ ...cur, ...patch })
}

/** Removes a file and its document database. */
export async function deleteFile(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id))
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(docDbName(id))
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
  await deleteAssetDb(id)
}

/** Root-frame count of a store. */
export function countFrames(store: DocStore): number {
  return store.children(null).filter((id) => store.getNode(id)?.type === "frame").length
}

/** Writes a store's state into a new file's database and index entry. */
async function persistNew(store: DocStore, name: string): Promise<string> {
  const id = generateId()
  const provider = new IndexedDbProvider(docDbName(id))
  await provider.attach(store)
  await provider.detach()
  const now = Date.now()
  await putFile({
    id,
    name,
    createdAt: now,
    updatedAt: now,
    frames: countFrames(store),
    ...libraryStats(store),
  })
  return id
}

/** Creates a file (with the sample design unless `empty`) and returns its id. */
export async function createFile(
  name = "Untitled",
  options: { empty?: boolean; document?: KimoDocument } = {},
) {
  // M6 Home composer: a prebuilt document (the placeholder first frame) instead of the sample.
  const store = createDocStore(options.document ?? newDocument(name))
  if (!options.empty && !options.document) buildSampleDocument(store)
  try {
    return await persistNew(store, name)
  } finally {
    store.destroy()
  }
}

/** Thrown when a `.kimo` file cannot be opened for editing. */
export class OpenFileError extends Error {
  override readonly name = "OpenFileError"
}

/** Result of importing a file: the new file id and asset references whose bytes were not found. */
export interface ImportResult {
  id: string
  missingAssets: string[]
}

/**
 * Imports `.kimo` text as a new local file. Asset bytes come from `packaged` (a `.kimoz`
 * package's `assets/`), else from any other file in this browser's library that stored the
 * same content-addressed asset (a plain `.kimo` saved and reopened here). References found
 * nowhere are returned in `missingAssets` (they render as missing images).
 */
export async function importKimoFile(
  text: string,
  fileName: string,
  packaged: ReadonlyMap<string, Uint8Array> = new Map(),
): Promise<ImportResult> {
  let result: ReturnType<typeof openDocument>
  try {
    result = openDocument(text)
  } catch (e) {
    throw new OpenFileError(`Could not read ${fileName}: ${e instanceof Error ? e.message : e}`)
  }
  if (result.readOnly)
    throw new OpenFileError(
      `${fileName} can't be edited here: ${result.readOnlyReasons.map((r) => r.message).join("; ")}`,
    )
  const name = result.doc.meta?.name ?? fileName.replace(/\.kimoz?$/i, "")
  const store = createDocStore(result.doc)
  let id: string
  try {
    id = await persistNew(store, name)
  } finally {
    store.destroy()
  }
  const refs = assetRefs(result.doc.nodes)
  const missingAssets = refs.size
    ? await copyAssets(
        id,
        refs,
        packaged,
        (result.doc.assets ?? {}) as Record<string, ManifestEntry>,
      )
    : []
  if (missingAssets.length)
    console.warn(`Kimo: ${fileName}: images not found: ${missingAssets.join(", ")}`)
  return { id, missingAssets }
}

/** {@link importKimoFile} returning only the new file id. */
export async function importKimo(text: string, fileName: string): Promise<string> {
  return (await importKimoFile(text, fileName)).id
}

/** Opens a picked `.kimo` (JSON text) or `.kimoz` (package with `assets/`) file. */
export async function importFile(file: File): Promise<ImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!isZip(bytes)) return importKimoFile(new TextDecoder().decode(bytes), file.name)
  let entries: Awaited<ReturnType<typeof readZip>>
  try {
    entries = await readZip(bytes)
  } catch (e) {
    throw new OpenFileError(`Could not read ${file.name}: ${e instanceof Error ? e.message : e}`)
  }
  const docs = entries.filter((e) => /\.kimo$/i.test(e.name))
  const main = docs.find((e) => !e.name.includes("/")) ?? docs[0]
  if (!main) throw new OpenFileError(`${file.name} has no .kimo document`)
  const base = main.name.includes("/") ? main.name.slice(0, main.name.lastIndexOf("/") + 1) : ""
  const packaged = new Map<string, Uint8Array>()
  for (const e of entries) {
    const m = /^assets\/([0-9a-f]{16}\.[a-z0-9]{1,8})$/.exec(e.name.slice(base.length))
    if (m && e.name.startsWith(base)) packaged.set(m[1] as string, e.data)
  }
  return importKimoFile(new TextDecoder().decode(main.data), file.name, packaged)
}

/** Writes the referenced assets into file `id`'s asset store; returns the keys not found. */
async function copyAssets(
  id: string,
  refs: ReadonlySet<string>,
  packaged: ReadonlyMap<string, Uint8Array>,
  manifest: Record<string, ManifestEntry>,
): Promise<string[]> {
  const target = createAssetStore(id)
  const missing: string[] = []
  const others: AssetStore[] = []
  try {
    let library: FileMeta[] | null = null
    for (const key of refs) {
      let bytes = packaged.get(key) ?? null
      if (!bytes) {
        library ??= (await listFiles()).filter((f) => f.id !== id)
        if (!others.length) for (const f of library) others.push(createAssetStore(f.id))
        for (const o of others) {
          bytes = await o.bytes(key).catch(() => null)
          if (bytes) break
        }
      }
      const stored = bytes ? await target.putKey(key, bytes, manifest[key]) : null
      if (!stored) missing.push(key)
    }
  } finally {
    target.dispose()
    for (const o of others) o.dispose()
  }
  return missing
}

/** Canonical `.kimo` text of a store, with `meta.name` set to the file name. */
export function exportKimo(store: DocStore, name: string): string {
  const doc: KimoDocument = store.toDocument()
  doc.meta = { ...doc.meta, name }
  return serialize(doc)
}

/** A file ready to save: `.kimo` text, or a `.kimoz` package when the design has images. */
export interface ExportedFile {
  fileName: string
  data: Blob
  /** Asset references whose bytes this browser does not have (left out of the package). */
  missingAssets: string[]
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "-") || "Untitled"

/**
 * Exports a file for saving (spec §1 rule 4, §12). Without asset references: the canonical
 * `.kimo`. With them: a `.kimoz` package holding `<name>.kimo` and `assets/<hash>.<ext>`;
 * the document gets the §12 `assets` manifest (entries for every reference) when all bytes are
 * present, so the package can be checked without the folder.
 */
export async function exportFile(
  store: DocStore,
  name: string,
  assets: AssetStore,
  /** Board 28: the document as written (font assets the text uses join the manifest). */
  prepare: (doc: KimoDocument) => KimoDocument = (d) => d,
  /**
   * Settings › Fonts & privacy › Embed fonts in .kimoz packages. Off: no font file goes in the
   * package. On: only fonts whose OS/2 fsType allows embedding ({@link fontEmbeddable}).
   */
  embedFonts = true,
): Promise<ExportedFile> {
  let doc: KimoDocument = store.toDocument()
  const refs = assetRefs(doc.nodes)
  // A package (the design has images) also carries the font files its text uses, listed in its
  // manifest (board 28). A plain `.kimo` stays plain: fonts alone don't turn it into a package.
  if (refs.size) {
    doc = prepare(doc)
    const manifest = { ...((doc.assets ?? {}) as Record<string, { mime?: string }>) }
    let dropped = false
    for (const [key, e] of Object.entries(manifest)) {
      if (!/^font\//i.test(e?.mime ?? "") || refs.has(key)) continue
      if (embedFonts && (await fontEmbeddable(assets, key))) refs.add(key)
      else {
        // Not in the package, so not in its manifest either (no ASSET_MISSING on open).
        delete manifest[key]
        dropped = true
      }
    }
    if (dropped) doc = { ...doc, assets: manifest } as KimoDocument
  }
  doc.meta = { ...doc.meta, name }
  if (!refs.size)
    return {
      fileName: `${safeName(name)}.kimo`,
      data: new Blob([serialize(doc)], { type: "application/json" }),
      missingAssets: [],
    }
  const files: { name: string; data: Uint8Array }[] = []
  const entries: Record<string, ManifestEntry> = {}
  const missingAssets: string[] = []
  for (const key of [...refs].sort()) {
    const [bytes, info] = await Promise.all([assets.bytes(key), assets.info(`./assets/${key}`)])
    if (!bytes || !info) {
      missingAssets.push(key)
      continue
    }
    files.push({ name: `assets/${key}`, data: bytes })
    const e: ManifestEntry = { mime: info.mime, bytes: info.bytes }
    if (info.width !== undefined) e.width = info.width
    if (info.height !== undefined) e.height = info.height
    if (info.name !== undefined) e.name = info.name
    entries[key] = e
  }
  if (!missingAssets.length)
    doc.assets = { ...((doc.assets ?? {}) as Record<string, ManifestEntry>), ...entries }
  const text = new TextEncoder().encode(serialize(doc))
  const zip = writeZip([{ name: `${safeName(name)}.kimo`, data: text }, ...files])
  return {
    fileName: `${safeName(name)}.kimoz`,
    data: new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
    missingAssets,
  }
}

/**
 * Whether a stored font may go in a package: its OS/2 fsType allows embedding. A face that
 * can't be inspected (WOFF2 from Google Fonts, all under open licenses) is embedded; a missing
 * file is left to the missing-asset path.
 */
async function fontEmbeddable(assets: AssetStore, key: string): Promise<boolean> {
  const bytes = await assets.bytes(key).catch(() => null)
  if (!bytes) return true
  const info = await readFontInfo(bytes)
  return info ? info.embeddable : true
}

// --- File pickers -------------------------------------------------------------------------

interface PickerWindow {
  showOpenFilePicker?: (o: unknown) => Promise<{ getFile(): Promise<File> }[]>
  showSaveFilePicker?: (o: unknown) => Promise<{
    createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }>
  }>
}

const KIMO_TYPES = [
  {
    description: "Kimo document",
    accept: { "application/json": [".kimo"], "application/zip": [".kimoz"] },
  },
]
const KIMOZ_TYPES = [{ description: "Kimo package", accept: { "application/zip": [".kimoz"] } }]

/** Lets the user pick a `.kimo` or `.kimoz` file. Resolves null on cancel. */
export async function pickKimoFile(): Promise<File | null> {
  const w = window as unknown as PickerWindow
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: KIMO_TYPES, multiple: false })
      return handle ? await handle.getFile() : null
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null
      // Fall through to the input fallback (e.g. blocked in an iframe).
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".kimo,.kimoz,application/json,application/zip"
    input.style.display = "none"
    let done = false
    const finish = (file: File | null) => {
      if (done) return
      done = true
      window.removeEventListener("focus", onFocus)
      input.remove()
      resolve(file)
    }
    // Browsers without the `cancel` event: the window regains focus when the dialog closes;
    // `change` (if a file was picked) can land shortly after, so wait before calling it a cancel.
    const onFocus = () => setTimeout(() => finish(input.files?.[0] ?? null), 500)
    input.addEventListener("change", () => finish(input.files?.[0] ?? null))
    input.addEventListener("cancel", () => finish(null))
    document.body.append(input)
    input.click()
    window.addEventListener("focus", onFocus, { once: true })
  })
}

/** Saves `text` as `<name>.kimo` (save picker, or a download). */
export async function saveKimoFile(text: string, name: string): Promise<void> {
  await saveFile({
    fileName: `${safeName(name)}.kimo`,
    data: new Blob([text], { type: "application/json" }),
    missingAssets: [],
  })
}

/** Saves an exported file (save picker, or a download). */
export async function saveFile(file: ExportedFile): Promise<void> {
  const w = window as unknown as PickerWindow
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: file.fileName,
        types: file.fileName.endsWith(".kimoz") ? KIMOZ_TYPES : KIMO_TYPES.slice(0, 1),
      })
      const out = await handle.createWritable()
      await out.write(file.data)
      await out.close()
      return
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return
    }
  }
  downloadBlob(file.data, file.fileName)
}

/** Triggers a browser download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// --- Display ------------------------------------------------------------------------------

/** "Edited 2 hours ago", "Edited yesterday", "Edited last week", … */
export function editedLabel(updatedAt: number, now = Date.now()): string {
  const s = Math.max(0, (now - updatedAt) / 1000)
  const m = s / 60
  const h = m / 60
  const d = h / 24
  let t: string
  if (m < 1) t = "just now"
  else if (h < 1) t = `${Math.floor(m)} minute${Math.floor(m) === 1 ? "" : "s"} ago`
  else if (d < 1) t = `${Math.floor(h)} hour${Math.floor(h) === 1 ? "" : "s"} ago`
  else if (d < 2) t = "yesterday"
  else if (d < 7) t = `${Math.floor(d)} days ago`
  else if (d < 14) t = "last week"
  else if (d < 30) t = `${Math.floor(d / 7)} weeks ago`
  else if (d < 60) t = "last month"
  else t = `${Math.floor(d / 30)} months ago`
  return `Edited ${t}`
}

/** "6 frames" / "1 frame". */
export const framesLabel = (n: number) => `${n} frame${n === 1 ? "" : "s"}`
