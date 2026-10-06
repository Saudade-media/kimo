/**
 * Linked libraries (spec §11, ADR 0011; board 13 "Assets & Libraries", board 15 "Library
 * missing"). A library is a read-only link stored in the document's `imports` (alias →
 * relative path). Browsers cannot resolve that path, so the editor keeps, per file and alias,
 * a **snapshot** in IndexedDB: the library text as last seen plus the File System Access handle
 * it came from (when the browser has one). On open each library is re-read through its handle:
 *
 * - read OK and equal to the snapshot → `linked`;
 * - read OK but different → `changed` ("Changed since last open"); the diff is computed against
 *   the snapshot and the snapshot only moves forward when the user acknowledges ("Got it");
 * - no handle, permission not granted, or the file is gone → the snapshot serves as a cached
 *   preview: `linked` when the snapshot exists and no read was possible, `missing` when the
 *   handle read failed (file moved/deleted) or no snapshot exists at all.
 *
 * Nothing here is stored in the `.kimo` file. Pure helpers ({@link diffLibraries},
 * {@link aliasFor}, {@link relativePath}) are unit-tested.
 */
import {
  ALIAS_PATTERN,
  instancesOf,
  type KimoDocument,
  type Libraries,
  localComponents,
  openDocument,
} from "@kimo/core-schema"
import { isZip, readZip } from "../../lib/zip"

export type LibraryStatus = "loading" | "linked" | "changed" | "missing"

/** One change of a library since the snapshot (board 13 Library Changes rows). */
export interface LibraryChange {
  kind: "component" | "variable"
  /** Component id or variable name inside the library. */
  id: string
  name: string
  change: "modified" | "added" | "removed"
}

export interface LibraryEntry {
  alias: string
  /** `imports[alias]` (relative path). */
  path: string
  /** Library `meta.name`, else the alias. */
  name: string
  status: LibraryStatus
  /** The document the editor uses: the fresh read, else the cached snapshot (or null). */
  doc: KimoDocument | null
  /** Changes since the snapshot (status `changed`). */
  changes: LibraryChange[]
  /** True when a File System Access handle is stored (Locate… can re-pick otherwise). */
  hasHandle: boolean
}

interface SnapshotRecord {
  key: string
  text: string
  path: string
  savedAt: number
  handle?: FileSystemFileHandleLike
  /**
   * B4: the browser-library file id the snapshot was linked from, when Kimo knows it. Home's
   * Design systems counts "used by N files" from this id only (never from the library's name).
   */
  sourceId?: string
}

/** The parts of `FileSystemFileHandle` used here (structured-clonable into IndexedDB). */
interface FileSystemFileHandleLike {
  name: string
  getFile(): Promise<File>
  queryPermission?(o: { mode: "read" }): Promise<PermissionState>
  requestPermission?(o: { mode: "read" }): Promise<PermissionState>
}

const DB = "kimo-libraries"
const STORE = "snapshots"

let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
  const d = await db()
  return new Promise<T>((resolve, reject) => {
    const r = run(d.transaction(STORE, mode).objectStore(STORE))
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
const keyOf = (fileId: string, alias: string) => `${fileId}\u0000${alias}`

/**
 * Library files are untrusted input (picked by the user, possibly from anywhere): their size,
 * a package's entry count and its decompressed document size are capped.
 */
export const MAX_LIBRARY_BYTES = 50 * 1024 * 1024
const MAX_ZIP_ENTRIES = 10_000

/** Parses `.kimo` text or a `.kimoz` package (its top-level document). Throws on bad input. */
export async function readLibraryBytes(bytes: Uint8Array, fileName: string): Promise<string> {
  if (bytes.byteLength > MAX_LIBRARY_BYTES)
    throw new Error(`${fileName} is larger than ${MAX_LIBRARY_BYTES / 1024 / 1024} MB`)
  if (!isZip(bytes)) return new TextDecoder().decode(bytes)
  // Only the documents are inflated (assets are never read), each capped.
  const entries = await readZip(bytes, {
    include: (name) => /\.kimo$/i.test(name),
    maxEntries: MAX_ZIP_ENTRIES,
    maxEntryBytes: MAX_LIBRARY_BYTES,
  })
  const docs = entries.filter((e) => /\.kimo$/i.test(e.name))
  const main = docs.find((e) => !e.name.includes("/")) ?? docs[0]
  if (!main) throw new Error(`${fileName} has no .kimo document`)
  return new TextDecoder().decode(main.data)
}

/**
 * Opens library text. Only a document this Kimo can read and that validates is accepted (a
 * newer format, an unknown feature or validation errors throw): the expansion, the resolver and
 * the change diff only ever see well-formed libraries.
 */
export function parseLibrary(text: string): KimoDocument {
  if (text.length > MAX_LIBRARY_BYTES) throw new Error("The library file is too large")
  const r = openDocument(text)
  if (r.readOnly)
    throw new Error(r.readOnlyReasons.map((x) => x.message).join("; ") || "unreadable library")
  return r.doc
}

/** A free import alias from a library name: `Kimo UI` → `kimo-ui` (spec ALIAS_PATTERN). */
export function aliasFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  let base = name
    .toLowerCase()
    .replace(/\.kimoz?$/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "")
    .slice(0, 28)
  if (!new RegExp(ALIAS_PATTERN).test(base)) base = "lib"
  if (!used.has(base)) return base
  for (let i = 2; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`
}

/** `imports` path for a picked file (browsers only know the name: `./<name>`, spaces escaped). */
export function relativePath(fileName: string): string {
  return `./${fileName.replace(/\s/g, "%20")}`
}

/** What changed in a library between two reads (components by id, variables by name). */
export function diffLibraries(before: KimoDocument, after: KimoDocument): LibraryChange[] {
  const out: LibraryChange[] = []
  const comps = (d: KimoDocument) => new Set(localComponents(d))
  const a = comps(before)
  const b = comps(after)
  const nodeName = (d: KimoDocument, id: string) => {
    const n = (d.nodes as Record<string, { name?: unknown }>)[id]
    return typeof n?.name === "string" ? n.name : id
  }
  // A component changed when its subtree changed. One child index per document, then each
  // component's subtree is walked once (no per-component scan of the whole node table).
  const sigs = (d: KimoDocument) => {
    const nodes = d.nodes as Record<string, Record<string, unknown>>
    const kids = new Map<string, string[]>()
    for (const [id, n] of Object.entries(nodes)) {
      if (typeof n?.parent !== "string") continue
      const l = kids.get(n.parent)
      if (l) l.push(id)
      else kids.set(n.parent, [id])
    }
    const memo = new Map<string, string>()
    return (root: string) => {
      const known = memo.get(root)
      if (known !== undefined) return known
      const parts: string[] = []
      const seen = new Set<string>()
      const stack = [root]
      while (stack.length) {
        const id = stack.pop() as string
        if (seen.has(id)) continue
        seen.add(id)
        parts.push(`${id}:${stable(nodes[id])}`)
        for (const c of kids.get(id) ?? []) stack.push(c)
      }
      const sig = parts.sort().join("|")
      memo.set(root, sig)
      return sig
    }
  }
  const sigBefore = sigs(before)
  const sigAfter = sigs(after)
  const subtreeSig = (d: KimoDocument, root: string) =>
    d === before ? sigBefore(root) : sigAfter(root)
  for (const id of b) {
    if (!a.has(id)) out.push({ kind: "component", id, name: nodeName(after, id), change: "added" })
    else if (subtreeSig(before, id) !== subtreeSig(after, id))
      out.push({ kind: "component", id, name: nodeName(after, id), change: "modified" })
  }
  for (const id of a)
    if (!b.has(id))
      out.push({ kind: "component", id, name: nodeName(before, id), change: "removed" })
  const va = (before.variables ?? {}) as Record<string, unknown>
  const vb = (after.variables ?? {}) as Record<string, unknown>
  for (const k of Object.keys(vb)) {
    if (!Object.hasOwn(va, k)) out.push({ kind: "variable", id: k, name: k, change: "added" })
    else if (stable(va[k]) !== stable(vb[k]))
      out.push({ kind: "variable", id: k, name: k, change: "modified" })
  }
  for (const k of Object.keys(va))
    if (!Object.hasOwn(vb, k)) out.push({ kind: "variable", id: k, name: k, change: "removed" })
  return out
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`
  return JSON.stringify(v) ?? "null"
}

/** Number of consumer instances using a library component (`ui:btn` → 9). */
export function usageCount(doc: Pick<KimoDocument, "nodes">, qid: string): number {
  return instancesOf(doc, qid).length
}

interface PickerWindow {
  showOpenFilePicker?(o: unknown): Promise<FileSystemFileHandleLike[]>
}

/** A picked library file (with its handle when the File System Access API is available). */
export interface PickedLibrary {
  name: string
  text: string
  handle?: FileSystemFileHandleLike
  /** The browser-library file id it came from (B4); unset for a file picked from disk. */
  sourceId?: string
}

/** Lets the user pick a `.kimo` / `.kimoz` library. Resolves null on cancel. */
export async function pickLibraryFile(): Promise<PickedLibrary | null> {
  const w = window as unknown as PickerWindow
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({
        types: [
          {
            description: "Kimo library",
            accept: { "application/json": [".kimo"], "application/zip": [".kimoz"] },
          },
        ],
        multiple: false,
      })
      if (!handle) return null
      const file = await handle.getFile()
      const text = await readLibraryBytes(new Uint8Array(await file.arrayBuffer()), file.name)
      return { name: file.name, text, handle }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null
    }
  }
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".kimo,.kimoz,application/json,application/zip"
    input.style.display = "none"
    input.dataset.kimoLibraryInput = ""
    input.addEventListener("change", () => {
      resolve(input.files?.[0] ?? null)
      input.remove()
    })
    input.addEventListener("cancel", () => {
      resolve(null)
      input.remove()
    })
    document.body.append(input)
    input.click()
  })
  if (!file) return null
  return {
    name: file.name,
    text: await readLibraryBytes(new Uint8Array(await file.arrayBuffer()), file.name),
  }
}

type Listener = () => void

/**
 * Per-file library state. `entries()` is a stable snapshot (new array on change) for
 * `useSyncExternalStore`; `libraries()` is what the expanded view, layout and commands read.
 */
export class LibraryManager {
  private map = new Map<string, LibraryEntry>()
  private list: readonly LibraryEntry[] = []
  private libs: Libraries = {}
  private listeners = new Set<Listener>()
  /** Fresh reads waiting for "Got it" (the snapshot moves forward then). */
  private pending = new Map<string, { text: string; handle?: FileSystemFileHandleLike }>()
  /**
   * Board 27 §8 (gPEqc): reads a library by its `imports` path relative to the open file (a file
   * on disk; set by the shell). Without a File System Access handle, the library is re-read
   * through it, so a moved or deleted library shows as missing.
   */
  reader: ((path: string) => Promise<Uint8Array>) | null = null
  version = 0

  constructor(readonly fileId: string) {}

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }
  entries = () => this.list
  libraries = () => this.libs
  get(alias: string) {
    return this.map.get(alias) ?? null
  }

  private emit() {
    this.version++
    this.list = [...this.map.values()].sort((a, b) => a.alias.localeCompare(b.alias))
    const libs: Record<string, KimoDocument> = {}
    for (const e of this.list) if (e.doc) libs[e.alias] = e.doc
    this.libs = libs
    for (const l of [...this.listeners]) l()
  }

  /** Syncs with the document's `imports` (call on open and when `imports` changes). */
  async sync(imports: Readonly<Record<string, string>>): Promise<void> {
    let changed = false
    for (const alias of [...this.map.keys()])
      if (!Object.hasOwn(imports, alias)) {
        this.map.delete(alias)
        changed = true
      }
    const loads: Promise<void>[] = []
    for (const [alias, path] of Object.entries(imports)) {
      const cur = this.map.get(alias)
      if (cur && cur.path === path) continue
      this.map.set(alias, {
        alias,
        path,
        name: cur?.name ?? alias,
        status: "loading",
        doc: cur?.doc ?? null,
        changes: [],
        hasHandle: false,
      })
      changed = true
      loads.push(this.load(alias, path))
    }
    if (changed) this.emit()
    await Promise.all(loads)
  }

  private async load(alias: string, path: string) {
    let rec: SnapshotRecord | undefined
    try {
      rec = await tx<SnapshotRecord | undefined>("readonly", (s) =>
        s.get(keyOf(this.fileId, alias)),
      )
    } catch {
      rec = undefined
    }
    let cached: KimoDocument | null = null
    try {
      cached = rec ? parseLibrary(rec.text) : null
    } catch {
      cached = null
    }
    let fresh: string | null = null
    let gone = false
    if (rec?.handle) {
      try {
        const perm = (await rec.handle.queryPermission?.({ mode: "read" })) ?? "granted"
        if (perm === "granted") {
          const file = await rec.handle.getFile()
          fresh = await readLibraryBytes(new Uint8Array(await file.arrayBuffer()), file.name)
        }
      } catch {
        gone = true
      }
    }
    if (!rec?.handle && this.reader) {
      try {
        const bytes = await this.reader(path)
        fresh = await readLibraryBytes(bytes, path)
        if (!rec) {
          // First open on this machine: the file itself is the snapshot.
          const doc = parseLibrary(fresh)
          await this.save(alias, path, fresh)
          if (this.map.get(alias)?.path !== path) return
          this.map.set(alias, {
            alias,
            path,
            name: libraryName(doc, alias),
            status: "linked",
            doc,
            changes: [],
            hasHandle: false,
          })
          this.emit()
          return
        }
      } catch {
        gone = true
      }
    }
    let doc = cached
    let status: LibraryStatus = cached ? "linked" : "missing"
    let changes: LibraryChange[] = []
    if (gone) status = "missing"
    else if (fresh !== null && rec && fresh !== rec.text) {
      try {
        const next = parseLibrary(fresh)
        changes = cached ? diffLibraries(cached, next) : []
        doc = next
        status = changes.length ? "changed" : "linked"
        this.pending.set(alias, { text: fresh, handle: rec.handle })
        if (!changes.length) void this.save(alias, path, fresh, rec.handle)
      } catch {
        status = "missing"
      }
    }
    if (this.map.get(alias)?.path !== path) return
    this.map.set(alias, {
      alias,
      path,
      name: libraryName(doc, alias),
      status,
      doc,
      changes,
      hasHandle: !!rec?.handle,
    })
    this.emit()
  }

  /** `sourceId` undefined keeps the stored one (a re-read); null clears it (a new pick). */
  private async save(
    alias: string,
    path: string,
    text: string,
    handle?: FileSystemFileHandleLike,
    sourceId?: string | null,
  ) {
    const key = keyOf(this.fileId, alias)
    const rec: SnapshotRecord = { key, text, path, savedAt: Date.now() }
    if (handle) rec.handle = handle
    const source =
      sourceId === undefined
        ? (
            await tx<SnapshotRecord | undefined>("readonly", (s) => s.get(key)).catch(
              () => undefined,
            )
          )?.sourceId
        : sourceId
    if (source) rec.sourceId = source
    try {
      await tx("readwrite", (s) => s.put(rec))
    } catch {
      // Handles are not clonable in some browsers: keep the text.
      delete rec.handle
      await tx("readwrite", (s) => s.put(rec)).catch(() => undefined)
    }
  }

  /** Stores a picked library under `alias` (link / relink / locate) and marks it linked. */
  async put(alias: string, path: string, picked: PickedLibrary): Promise<KimoDocument> {
    const doc = parseLibrary(picked.text)
    await this.save(alias, path, picked.text, picked.handle, picked.sourceId ?? null)
    this.pending.delete(alias)
    this.map.set(alias, {
      alias,
      path,
      name: libraryName(doc, alias),
      status: "linked",
      doc,
      changes: [],
      hasHandle: !!picked.handle,
    })
    this.emit()
    return doc
  }

  /** "Got it": the fresh read becomes the snapshot. */
  async acknowledge(alias: string): Promise<void> {
    const e = this.map.get(alias)
    const p = this.pending.get(alias)
    if (!e) return
    if (p) await this.save(alias, e.path, p.text, p.handle)
    this.pending.delete(alias)
    this.map.set(alias, { ...e, status: "linked", changes: [] })
    this.emit()
  }

  /** Forgets the snapshot (after unlink). */
  async forget(alias: string): Promise<void> {
    this.map.delete(alias)
    this.pending.delete(alias)
    await tx("readwrite", (s) => s.delete(keyOf(this.fileId, alias))).catch(() => undefined)
    this.emit()
  }

  /** Test hook: registers a library without disk access (e2e, unit tests). */
  inject(alias: string, path: string, doc: KimoDocument, status: LibraryStatus = "linked") {
    this.map.set(alias, {
      alias,
      path,
      name: libraryName(doc, alias),
      status,
      doc,
      changes: [],
      hasHandle: false,
    })
    this.emit()
  }
}

function libraryName(doc: KimoDocument | null, alias: string): string {
  const n = doc?.meta?.name
  return typeof n === "string" && n ? n : alias
}
