/**
 * Browser file library: an index of local files (IndexedDB database `kimo-files`) plus one
 * y-indexeddb database per document, written through `@kimo/sync`'s `IndexedDbProvider`.
 * Also the `.kimo` open/save helpers (File System Access API with an upload/download fallback).
 */

import type { KimoDocument } from "@kimo/core-schema"
import {
  createDocStore,
  type DocStore,
  generateId,
  openDocument,
  serialize,
} from "@kimo/editor-state"
import { IndexedDbProvider } from "@kimo/sync/indexeddb"
import { buildSampleDocument, newDocument } from "./sample"

/** One entry of the recent-files grid. */
export interface FileMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  /** Number of root frames (shown as "· 6 frames"). */
  frames: number
}

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

/** All files, most recently edited first. */
export async function listFiles(): Promise<FileMeta[]> {
  const all = await tx<FileMeta[]>("readonly", (s) => s.getAll() as IDBRequest<FileMeta[]>)
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
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
  await putFile({ id, name, createdAt: now, updatedAt: now, frames: countFrames(store) })
  return id
}

/** Creates a file (with the sample design unless `empty`) and returns its id. */
export async function createFile(name = "Untitled", options: { empty?: boolean } = {}) {
  const store = createDocStore(newDocument(name))
  if (!options.empty) buildSampleDocument(store)
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

/** Imports `.kimo` text as a new local file. */
export async function importKimo(text: string, fileName: string): Promise<string> {
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
  const name = result.doc.meta?.name ?? fileName.replace(/\.kimo$/i, "")
  const store = createDocStore(result.doc)
  try {
    return await persistNew(store, name)
  } finally {
    store.destroy()
  }
}

/** Canonical `.kimo` text of a store, with `meta.name` set to the file name. */
export function exportKimo(store: DocStore, name: string): string {
  const doc: KimoDocument = store.toDocument()
  doc.meta = { ...doc.meta, name }
  return serialize(doc)
}

// --- File pickers -------------------------------------------------------------------------

interface PickerWindow {
  showOpenFilePicker?: (o: unknown) => Promise<{ getFile(): Promise<File> }[]>
  showSaveFilePicker?: (o: unknown) => Promise<{
    createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }>
  }>
}

const KIMO_TYPES = [{ description: "Kimo document", accept: { "application/json": [".kimo"] } }]

/** Lets the user pick a `.kimo` file. Resolves null on cancel. */
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
    input.accept = ".kimo,application/json"
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
  const fileName = `${name.replace(/[\\/:*?"<>|]+/g, "-") || "Untitled"}.kimo`
  const w = window as unknown as PickerWindow
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: fileName, types: KIMO_TYPES })
      const out = await handle.createWritable()
      await out.write(text)
      await out.close()
      return
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return
    }
  }
  downloadBlob(new Blob([text], { type: "application/json" }), fileName)
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
