/**
 * `createBrowserPlatform()`: the web build's host (ADR 0012).
 *
 * - Files: File System Access API handles where available (Chromium): in-place save with
 *   `createWritable()` (a swap file committed on close) plus a read-back hash; polling watch.
 *   Elsewhere files are picked with `<input type=file>` (read-only `upload:` refs) and saved by
 *   download.
 * - Leases: Web Locks (one writer per file across tabs of this profile).
 * - Recovery, recents, font cache: IndexedDB (`kimo-platform`).
 * - Settings: `localStorage` (`kimo.settings`), synced across tabs by the `storage` event;
 *   the Settings UI is an in-app dialog.
 * - Git, reveal, updater, deep links, traffic lights: `UNSUPPORTED` (see `capabilities`).
 */
import type { AppliedCapabilities } from "./capabilities"
import { PlatformError } from "./errors"
import { basenameOf, dirnameOf, isKimoPath } from "./links"
import { googleFontsAllowed, type SettingKey } from "./settings"
import { createSettingsStore } from "./settings-store"
import {
  type AcquireResult,
  type FileRef,
  type FileStat,
  type FontCacheEntry,
  type KimoPlatform,
  type LeaseHolder,
  type LocalFontFamily,
  type OpenRequest,
  RECOVERY_RETENTION_MS,
  type RecentFile,
  type RecoveryEntry,
  type WatchEvent,
} from "./types"
import { createBatcher, DEFAULT_WATCH_DEBOUNCE_MS, Emitter, sha256Hex, utf8Length } from "./util"

// --- Minimal File System Access / Local Font Access typings (not in lib.dom) -------------------

interface FsWritable {
  write(data: string | Uint8Array): Promise<void>
  close(): Promise<void>
  abort?(): Promise<void>
}
interface FsHandleBase {
  kind: "file" | "directory"
  name: string
  queryPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>
  requestPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>
}
interface FsFileHandle extends FsHandleBase {
  kind: "file"
  getFile(): Promise<File>
  createWritable(): Promise<FsWritable>
  remove?(): Promise<void>
}
interface FsDirHandle extends FsHandleBase {
  kind: "directory"
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FsFileHandle>
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<FsDirHandle>
  removeEntry(name: string): Promise<void>
  values(): AsyncIterable<FsFileHandle | FsDirHandle>
}
type FsHandle = FsFileHandle | FsDirHandle
interface FsPickerType {
  description: string
  accept: Record<string, string[]>
}
interface FsWindow {
  showOpenFilePicker?(o: { multiple?: boolean; types?: FsPickerType[] }): Promise<FsFileHandle[]>
  showSaveFilePicker?(o: { suggestedName?: string; types?: FsPickerType[] }): Promise<FsFileHandle>
  showDirectoryPicker?(o: { mode?: "read" | "readwrite" }): Promise<FsDirHandle>
  queryLocalFonts?(): Promise<
    {
      family: string
      fullName: string
      postscriptName: string
      style: string
      blob(): Promise<Blob>
    }[]
  >
  launchQueue?: { setConsumer(cb: (p: { files: FsFileHandle[] }) => void): void }
}

// --- IndexedDB ----------------------------------------------------------------------------------

const DB = "kimo-platform"
const STORES = ["handles", "recents", "folders", "recovery", "fonts"] as const
type StoreName = (typeof STORES)[number]

let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      for (const s of STORES)
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}
async function idb<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const d = await db()
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode)
    const req = run(t.objectStore(store))
    t.oncomplete = () => resolve(req.result as T)
    t.onerror = () => reject(t.error)
  })
}
const idbGet = <T>(s: StoreName, k: string) => idb<T | undefined>(s, "readonly", (o) => o.get(k))
const idbPut = (s: StoreName, k: string, v: unknown) =>
  idb<void>(s, "readwrite", (o) => o.put(v, k))
const idbDel = (s: StoreName, k: string) => idb<void>(s, "readwrite", (o) => o.delete(k))
const idbAll = <T>(s: StoreName) => idb<T[]>(s, "readonly", (o) => o.getAll())
const idbClear = (s: StoreName) => idb<void>(s, "readwrite", (o) => o.clear())

// --- Refs ---------------------------------------------------------------------------------------

/** `fsa:<id>/<rel>` → handle id and the path below it. */
function splitRef(ref: FileRef): { scheme: "fsa" | "upload"; id: string; rel: string[] } {
  const m = /^(fsa|upload):([A-Za-z0-9-]+)\/(.+)$/.exec(ref)
  if (!m) throw new PlatformError("INVALID", `Not a browser file ref: ${ref}`)
  return { scheme: m[1] as "fsa" | "upload", id: m[2] as string, rel: (m[3] as string).split("/") }
}

const newId = () => crypto.randomUUID()
const KIMO_TYPES: FsPickerType[] = [
  {
    description: "Kimo document",
    accept: { "application/vnd.kimo+json": [".kimo"], "application/zip": [".kimoz"] },
  },
]

export interface BrowserPlatformOptions {
  appVersion?: string
  /** Poll interval of the File System Access watcher. Default 1000 ms. */
  pollMs?: number
}

export function createBrowserPlatform(options: BrowserPlatformOptions = {}): KimoPlatform {
  const w = globalThis as unknown as FsWindow & Window
  const hasFsa = typeof w.showOpenFilePicker === "function"
  const appVersion = options.appVersion ?? "0.0.0"
  const pollMs = options.pollMs ?? 1000
  const tabId = newId()
  const host = "browser"
  const handles = new Map<string, FsHandle>()
  const uploads = new Map<string, Uint8Array>()
  const disposers: (() => void)[] = []

  const capabilities: AppliedCapabilities = {
    fileAccess: hasFsa ? "fsa" : "upload-download",
    saveInPlace: hasFsa,
    watch: hasFsa,
    reveal: false,
    leases: typeof navigator !== "undefined" && "locks" in navigator ? "tab" : "none",
    recovery: "indexeddb",
    git: false,
    localFonts: typeof w.queryLocalFonts === "function",
    remoteFonts: true,
    updater: false,
    trafficLights: false,
    settingsWindow: false,
    deepLinks: false,
    fileAssociation: !!w.launchQueue,
    watchedFolders: typeof w.showDirectoryPicker === "function",
  }
  const no = (what: string): never => {
    throw new PlatformError("UNSUPPORTED", `${what} is not available in the browser`)
  }

  async function handleById(id: string): Promise<FsHandle> {
    let h = handles.get(id)
    if (!h) {
      h = await idbGet<FsHandle>("handles", id)
      if (!h) throw new PlatformError("NOT_FOUND", `Unknown file handle ${id}`)
      handles.set(id, h)
    }
    return h
  }
  async function ensurePermission(h: FsHandleBase, mode: "read" | "readwrite") {
    if (!h.queryPermission) return
    if ((await h.queryPermission({ mode })) === "granted") return
    if ((await h.requestPermission?.({ mode })) !== "granted")
      throw new PlatformError(
        "PERMISSION",
        `Permission to ${mode === "read" ? "read" : "write"} ${h.name} denied`,
      )
  }
  async function register(h: FsHandle, rel?: string): Promise<FileRef> {
    const id = newId()
    handles.set(id, h)
    await idbPut("handles", id, h)
    return `fsa:${id}/${rel ?? h.name}`
  }
  /** Resolves a ref to a file handle (optionally creating it and its directories). */
  async function fileHandle(ref: FileRef, create = false): Promise<FsFileHandle> {
    const { scheme, id, rel } = splitRef(ref)
    if (scheme === "upload") no("Writing an uploaded file")
    const root = await handleById(id)
    if (root.kind === "file") {
      if (rel.length !== 1 || rel[0] !== root.name)
        throw new PlatformError("NOT_FOUND", `No such file: ${ref}`)
      return root
    }
    let dir: FsDirHandle = root
    for (const seg of rel.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create })
    try {
      return await dir.getFileHandle(rel[rel.length - 1] as string, { create })
    } catch (e) {
      throw new PlatformError("NOT_FOUND", `No such file: ${ref}`, { cause: e })
    }
  }
  async function readFile(ref: FileRef): Promise<File | Uint8Array> {
    const { scheme, id } = splitRef(ref)
    if (scheme === "upload") {
      const b = uploads.get(id)
      if (!b) throw new PlatformError("NOT_FOUND", `Upload ${ref} is gone`)
      return b
    }
    const h = await fileHandle(ref)
    await ensurePermission(h, "read")
    return h.getFile()
  }
  const bytesOf = async (f: File | Uint8Array) =>
    f instanceof Uint8Array ? f : new Uint8Array(await f.arrayBuffer())

  async function writeAtomic(ref: FileRef, data: string | Uint8Array, mkdirs?: boolean) {
    if (!hasFsa) no("Saving in place")
    const h = await fileHandle(ref, mkdirs ?? false)
    await ensurePermission(h, "readwrite")
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
    const hash = await sha256Hex(bytes)
    let ws: FsWritable
    try {
      ws = await h.createWritable()
      await ws.write(bytes)
      await ws.close()
    } catch (e) {
      const name = (e as { name?: string }).name
      if (name === "QuotaExceededError")
        throw new PlatformError("DISK_FULL", "Out of storage", { errno: "ENOSPC", cause: e })
      if (name === "NotAllowedError")
        throw new PlatformError("PERMISSION", "Write not allowed", { errno: "EACCES", cause: e })
      throw new PlatformError("IO", `Could not write ${ref}`, { cause: e })
    }
    const back = await sha256Hex(new Uint8Array(await (await h.getFile()).arrayBuffer()))
    if (back !== hash)
      throw new PlatformError("READ_BACK_MISMATCH", `Read-back of ${ref} did not match`)
    return { bytes: bytes.byteLength, hash }
  }

  // --- leases (Web Locks + localStorage holder info) ---
  const held = new Map<FileRef, { token: string; release: () => void }>()
  const leaseKey = (ref: FileRef) => `kimo.lease.${ref}`
  const leaseEvents = new Emitter<[FileRef, LeaseHolder | null]>()
  const selfHolder = (ref: FileRef): LeaseHolder => ({
    pid: 0,
    app: "kimo-web",
    appLabel: "Kimo (this tab)",
    host,
    sinceIso: new Date().toISOString(),
    lockPath: `web-lock:kimo-lease:${ref}`,
    alive: true,
    self: true,
  })
  const locks = () => (navigator as Navigator & { locks?: LockManager }).locks

  // --- settings ---
  const SETTINGS_KEY = "kimo.settings"
  const settings = createSettingsStore({
    async load() {
      const raw = localStorage.getItem(SETTINGS_KEY)
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      // Pre-M4 web setting (apps/web/src/lib/settings.ts).
      if (localStorage.getItem("kimo.webFonts") === "off" && parsed["fonts.google"] === undefined)
        parsed["fonts.google"] = false
      return parsed
    },
    async persist(_k, _v, all) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(all))
      } catch {
        // Not persisted (private mode); applies to this tab.
      }
    },
    subscribe(onRemote) {
      const h = (e: StorageEvent) => {
        if (e.key !== SETTINGS_KEY || !e.newValue) return
        const all = JSON.parse(e.newValue) as Record<SettingKey, unknown>
        for (const [k, v] of Object.entries(all)) onRemote(k, v)
      }
      addEventListener("storage", h)
      return () => removeEventListener("storage", h)
    },
  })

  // Hold a per-tab lock so other tabs can tell whether a recovery owner is alive.
  void locks()?.request(`kimo-tab:${tabId}`, () => new Promise<void>(() => {}))

  const recentsEvents = new Emitter<[]>()
  const openEvents = new Emitter<[OpenRequest]>()
  const initial: OpenRequest[] = []
  w.launchQueue?.setConsumer(async ({ files }) => {
    const refs = await Promise.all(files.map((f) => register(f)))
    const req: OpenRequest = { source: "launch-queue", refs }
    if (openEvents.size === 0) initial.push(req)
    else openEvents.emit(req)
  })

  const platform: KimoPlatform = {
    kind: "browser",
    os: "web",
    appVersion,
    capabilities,
    files: {
      async readText(ref) {
        const bytes = await bytesOf(await readFile(ref))
        return { text: new TextDecoder().decode(bytes), hash: await sha256Hex(bytes) }
      },
      readBytes: async (ref) => bytesOf(await readFile(ref)),
      writeTextAtomic: (ref, text, o) => writeAtomic(ref, text, o?.mkdirs),
      writeBytesAtomic: (ref, bytes, o) => writeAtomic(ref, bytes, o?.mkdirs),
      async remove(ref) {
        const { scheme, id, rel } = splitRef(ref)
        if (scheme === "upload") return void uploads.delete(id)
        const root = await handleById(id)
        if (root.kind === "file") {
          if (!root.remove) no("Deleting a picked file")
          return root.remove?.()
        }
        let dir: FsDirHandle = root
        for (const seg of rel.slice(0, -1)) dir = await dir.getDirectoryHandle(seg)
        await dir.removeEntry(rel[rel.length - 1] as string).catch(() => {})
      },
      async stat(ref): Promise<FileStat | null> {
        try {
          const f = await readFile(ref)
          return f instanceof Uint8Array
            ? {
                ref,
                name: basenameOf(ref),
                kind: "file",
                size: f.byteLength,
                mtimeMs: 0,
                readOnly: true,
              }
            : {
                ref,
                name: f.name,
                kind: "file",
                size: f.size,
                mtimeMs: f.lastModified,
                readOnly: false,
              }
        } catch (e) {
          if (e instanceof PlatformError && e.code === "NOT_FOUND") return null
          throw e
        }
      },
      async list(dirRef, o) {
        const { id, rel } = splitRef(`${dirRef}/x`)
        let dir = await handleById(id)
        if (dir.kind !== "directory")
          throw new PlatformError("INVALID", `${dirRef} is not a folder`)
        for (const seg of rel.slice(0, -1)) dir = await (dir as FsDirHandle).getDirectoryHandle(seg)
        const out: FileStat[] = []
        for await (const h of (dir as FsDirHandle).values()) {
          const ref = `${dirRef}/${h.name}`
          if (h.kind === "directory") {
            out.push({ ref, name: h.name, kind: "directory", size: 0, mtimeMs: 0, readOnly: false })
          } else if (!o?.extensions || o.extensions.some((e) => h.name.endsWith(`.${e}`))) {
            const f = await h.getFile()
            out.push({
              ref,
              name: h.name,
              kind: "file",
              size: f.size,
              mtimeMs: f.lastModified,
              readOnly: false,
            })
          }
        }
        return out
      },
      watch(refs, o, listener) {
        if (!hasFsa) no("Watching files")
        const batcher = createBatcher<WatchEvent>(
          o.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS,
          listener,
        )
        const seen = new Map<FileRef, string>()
        const poll = async () => {
          for (const ref of refs) {
            const s = await platform.files.stat(ref).catch(() => null)
            const sig = s ? `${s.mtimeMs}:${s.size}` : "gone"
            const prev = seen.get(ref)
            seen.set(ref, sig)
            if (prev === undefined || prev === sig) continue
            batcher.push({
              kind: s ? (prev === "gone" ? "created" : "modified") : "removed",
              ref,
              at: Date.now(),
            })
          }
        }
        void poll()
        const timer = setInterval(poll, Math.max(pollMs, o.debounceMs ?? 0))
        return () => {
          clearInterval(timer)
          batcher.cancel()
        }
      },
      reveal: async () => no("Reveal in file manager"),
      openWithDefaultApp: async () => no("Opening with another app"),
      async openExternalUrl(url) {
        if (!/^https:\/\//.test(url)) throw new PlatformError("INVALID", `Not an https URL: ${url}`)
        window.open(url, "_blank", "noopener,noreferrer")
      },
      async download(name, bytes, mime) {
        const url = URL.createObjectURL(
          new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }),
        )
        const a = document.createElement("a")
        a.href = url
        a.download = name
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      },
    },
    dialogs: {
      async openFile(o) {
        if (hasFsa) {
          try {
            const picked = await (
              w.showOpenFilePicker as NonNullable<FsWindow["showOpenFilePicker"]>
            )({
              multiple: o?.multiple ?? false,
              types: KIMO_TYPES,
            })
            return Promise.all(picked.map((h) => register(h)))
          } catch (e) {
            if ((e as { name?: string }).name === "AbortError") return []
            throw e
          }
        }
        // Upload fallback: read-only refs backed by the picked bytes.
        const files = await new Promise<File[]>((resolve) => {
          const input = document.createElement("input")
          input.type = "file"
          input.multiple = o?.multiple ?? false
          input.accept = (o?.filters ?? [{ name: "", extensions: ["kimo", "kimoz"] }])
            .flatMap((f) => f.extensions.map((e) => `.${e}`))
            .join(",")
          input.onchange = () => resolve([...(input.files ?? [])])
          input.oncancel = () => resolve([])
          input.click()
        })
        return Promise.all(
          files.map(async (f) => {
            const id = newId()
            uploads.set(id, new Uint8Array(await f.arrayBuffer()))
            return `upload:${id}/${f.name}`
          }),
        )
      },
      async saveFile(o) {
        if (!w.showSaveFilePicker) no("Save dialog")
        try {
          const h = await (w.showSaveFilePicker as NonNullable<FsWindow["showSaveFilePicker"]>)({
            suggestedName: o.suggestedName,
            types: KIMO_TYPES,
          })
          return register(h)
        } catch (e) {
          if ((e as { name?: string }).name === "AbortError") return null
          throw e
        }
      },
      async pickFolder() {
        if (!w.showDirectoryPicker) no("Folder picker")
        try {
          const h = await (w.showDirectoryPicker as NonNullable<FsWindow["showDirectoryPicker"]>)({
            mode: "readwrite",
          })
          const id = newId()
          handles.set(id, h)
          await idbPut("handles", id, h)
          // A folder ref is the bare root: files below it are `fsa:<id>/<rel path>`.
          return `fsa:${id}`
        } catch (e) {
          if ((e as { name?: string }).name === "AbortError") return null
          throw e
        }
      },
    },
    recents: {
      async listFiles(o) {
        const all = await idbAll<RecentFile>("recents")
        const list = all.sort((a, b) => b.modifiedAt - a.modifiedAt)
        return o?.limit ? list.slice(0, o.limit) : list
      },
      async noteOpened(ref) {
        if (ref.startsWith("upload:")) return
        const s = await platform.files.stat(ref).catch(() => null)
        const entry: RecentFile = {
          ref,
          name: basenameOf(ref),
          folder: dirnameOf(ref),
          modifiedAt: s?.mtimeMs ?? Date.now(),
          openedAt: Date.now(),
          git: null,
          missing: s === null,
        }
        await idbPut("recents", ref, entry)
        recentsEvents.emit()
      },
      async removeFile(ref) {
        await idbDel("recents", ref)
        recentsEvents.emit()
      },
      async clearFiles() {
        await idbClear("recents")
        recentsEvents.emit()
      },
      async listFolders() {
        const rows = await idbAll<{ ref: FileRef; label: string }>("folders")
        return Promise.all(
          rows.map(async ({ ref, label }) => ({
            ref,
            label,
            git: null,
            fileCount: (await platform.recents.scanFolder(ref).catch(() => [])).length,
          })),
        )
      },
      async addFolder(ref) {
        const id = /^fsa:([A-Za-z0-9-]+)$/.exec(ref)?.[1]
        if (!id) throw new PlatformError("INVALID", `Not a picked folder: ${ref}`)
        const h = await handleById(id)
        await idbPut("folders", ref, { ref, label: h.name })
        recentsEvents.emit()
      },
      async removeFolder(ref) {
        await idbDel("folders", ref)
        recentsEvents.emit()
      },
      async scanFolder(ref) {
        const out: RecentFile[] = []
        const walk = async (dir: FileRef, depth: number) => {
          if (depth > 6) return
          for (const s of await platform.files.list(dir)) {
            if (s.kind === "directory") {
              if (!s.name.startsWith(".") && s.name !== "node_modules") await walk(s.ref, depth + 1)
            } else if (isKimoPath(s.name)) {
              out.push({
                ref: s.ref,
                name: s.name,
                folder: dir,
                modifiedAt: s.mtimeMs,
                openedAt: null,
                git: null,
                missing: false,
              })
            }
          }
        }
        await walk(ref, 0)
        return out
      },
      onChange: (l) => recentsEvents.on(l),
    },
    leases: {
      async acquire(ref): Promise<AcquireResult> {
        const lm = locks()
        if (!lm) no("Leases")
        const mine = held.get(ref)
        if (mine) return { ok: true, lease: { ref, token: mine.token, holder: selfHolder(ref) } }
        const token = newId()
        const got = await new Promise<boolean>((resolve) => {
          void lm?.request(`kimo-lease:${ref}`, { ifAvailable: true }, (lock) => {
            if (!lock) {
              resolve(false)
              return
            }
            return new Promise<void>((release) => {
              held.set(ref, { token, release: () => release() })
              resolve(true)
            })
          })
        })
        if (!got) {
          const info = localStorage.getItem(leaseKey(ref))
          const holder: LeaseHolder = info
            ? { ...(JSON.parse(info) as LeaseHolder), alive: true, self: false }
            : { ...selfHolder(ref), appLabel: "Kimo (another tab)", self: false }
          return { ok: false, holder }
        }
        const holder = selfHolder(ref)
        localStorage.setItem(
          leaseKey(ref),
          JSON.stringify({ ...holder, appLabel: "Kimo (another tab)" }),
        )
        leaseEvents.emit(ref, holder)
        return { ok: true, lease: { ref, token, holder } }
      },
      async release(lease) {
        const mine = held.get(lease.ref)
        if (!mine || mine.token !== lease.token) return
        held.delete(lease.ref)
        localStorage.removeItem(leaseKey(lease.ref))
        mine.release()
        leaseEvents.emit(lease.ref, null)
      },
      async inspect(ref) {
        if (held.has(ref)) return selfHolder(ref)
        const lm = locks()
        if (!lm) no("Leases")
        const q = await (lm as LockManager).query()
        if (!q.held?.some((l) => l.name === `kimo-lease:${ref}`)) return null
        const info = localStorage.getItem(leaseKey(ref))
        return info
          ? { ...(JSON.parse(info) as LeaseHolder), alive: true, self: false }
          : { ...selfHolder(ref), appLabel: "Kimo (another tab)", self: false }
      },
      watch: (ref, l) => leaseEvents.on((r, h) => r === ref && l(h)),
    },
    recovery: {
      dir: null,
      async list() {
        const rows = await idbAll<{ entry: RecoveryEntry; text: string; tabId: string }>("recovery")
        const q = await locks()?.query()
        const live = new Set((q?.held ?? []).map((l) => l.name))
        return rows
          .map((r) => ({ ...r.entry, ownerAlive: live.has(`kimo-tab:${r.tabId}`) }))
          .sort((a, b) => b.updatedAt - a.updatedAt)
      },
      async write(input) {
        const prev = await idbGet<{ entry: RecoveryEntry }>("recovery", input.id)
        const entry: RecoveryEntry = {
          id: input.id,
          sourceRef: input.sourceRef,
          name: input.name,
          reason: input.reason,
          createdAt: prev?.entry.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          edits: input.edits,
          lastAutosaveAt: input.lastAutosaveAt ?? null,
          sourceChangedSince: null,
          bytes: utf8Length(input.text),
          hash: await sha256Hex(input.text),
          ownerPid: 0,
          ownerAlive: true,
          ownerExitedAt: null,
          appVersion,
        }
        if (input.layers !== undefined) entry.layers = input.layers
        await idbPut("recovery", input.id, { entry, text: input.text, tabId })
        return entry
      },
      async restore(id) {
        const r = await idbGet<{ entry: RecoveryEntry; text: string }>("recovery", id)
        if (!r) throw new PlatformError("NOT_FOUND", `No recovery entry ${id}`)
        return { entry: r.entry, text: r.text }
      },
      discard: (id) => idbDel("recovery", id),
      async prune(maxAgeMs = RECOVERY_RETENTION_MS) {
        let n = 0
        for (const e of await platform.recovery.list())
          if (Date.now() - e.updatedAt > maxAgeMs) {
            await idbDel("recovery", e.id)
            n++
          }
        return n
      },
    },
    git: {
      state: async () => no("Git"),
      watch: () => no("Git"),
      mergeDriverStatus: async () => no("Git"),
      installMergeDriver: async () => no("Git"),
    },
    fonts: {
      async listLocal() {
        if (!w.queryLocalFonts) no("Local fonts")
        const faces = await (w.queryLocalFonts as NonNullable<FsWindow["queryLocalFonts"]>)()
        const fams = new Map<string, LocalFontFamily>()
        for (const f of faces) {
          const fam = fams.get(f.family) ?? { family: f.family, styles: [] }
          const style = f.style.toLowerCase()
          fam.styles.push({
            postscriptName: f.postscriptName,
            fullName: f.fullName,
            weight: styleWeight(style),
            italic: /italic|oblique/.test(style),
          })
          fams.set(f.family, fam)
        }
        return [...fams.values()].sort((a, b) => a.family.localeCompare(b.family))
      },
      async loadLocal(ps) {
        if (!w.queryLocalFonts) no("Local fonts")
        const faces = await (w.queryLocalFonts as NonNullable<FsWindow["queryLocalFonts"]>)()
        const face = faces.find((f) => f.postscriptName === ps)
        if (!face) throw new PlatformError("NOT_FOUND", `No local font ${ps}`)
        return new Uint8Array(await (await face.blob()).arrayBuffer())
      },
      cache: {
        get: async (key) =>
          (await idbGet<{ entry: FontCacheEntry; bytes: Uint8Array }>("fonts", key))?.bytes ?? null,
        async put(meta, bytes) {
          const key = (await sha256Hex(bytes)).slice(0, 16)
          const entry: FontCacheEntry = {
            ...meta,
            key,
            bytes: bytes.byteLength,
            cachedAt: Date.now(),
          }
          await idbPut("fonts", key, { entry, bytes })
          return entry
        },
        list: async () => (await idbAll<{ entry: FontCacheEntry }>("fonts")).map((r) => r.entry),
        async stats() {
          const all = await platform.fonts.cache.list()
          return { count: all.length, bytes: all.reduce((s, e) => s + e.bytes, 0), dir: null }
        },
        clear: () => idbClear("fonts"),
      },
      async fetchRemote(url) {
        if (!googleFontsAllowed(settings.all()))
          throw new PlatformError("BLOCKED", "Google Fonts are off (No third-party fetch)")
        if (!/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url))
          throw new PlatformError("BLOCKED", `Host not allowed: ${url}`)
        const res = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" })
        if (!res.ok) throw new PlatformError("IO", `HTTP ${res.status} for ${url}`)
        return new Uint8Array(await res.arrayBuffer())
      },
      openCacheFolder: async () => no("Opening the font cache folder"),
    },
    updater: {
      status: () => ({ state: "idle" }),
      check: async () => no("Updates"),
      download: async () => no("Updates"),
      restart: async () => no("Updates"),
      onStatus: () => () => {},
    },
    window: {
      label: "web",
      trafficLightPosition: () => null,
      trafficLightInset: () => 0,
      isFocused: () => document.hasFocus(),
      onFocusChange(l) {
        const on = () => l(true)
        const off = () => l(false)
        addEventListener("focus", on)
        addEventListener("blur", off)
        return () => {
          removeEventListener("focus", on)
          removeEventListener("blur", off)
        }
      },
      isFullscreen: () => document.fullscreenElement !== null,
      onFullscreenChange(l) {
        const h = () => l(document.fullscreenElement !== null)
        document.addEventListener("fullscreenchange", h)
        return () => document.removeEventListener("fullscreenchange", h)
      },
      async setTitle(t) {
        document.title = t
      },
      async setDocumentEdited() {},
      openSettings: async () => "dialog",
      onCloseRequested(handler) {
        // Browsers only allow a generic "leave site?" prompt; a false result triggers it.
        const h = (e: BeforeUnloadEvent) => {
          const r = handler()
          if (r === false) e.preventDefault()
        }
        addEventListener("beforeunload", h)
        return () => removeEventListener("beforeunload", h)
      },
      async close() {
        window.close()
      },
    },
    settings,
    launch: {
      takeInitialRequests: async () => initial.splice(0),
      onOpenRequest: (l) => openEvents.on(l),
    },
    dispose() {
      for (const d of disposers.splice(0)) d()
      settings.dispose()
      for (const [ref, h] of held) {
        h.release()
        localStorage.removeItem(leaseKey(ref))
      }
      held.clear()
    },
  }
  return platform
}

function styleWeight(style: string): number {
  const table: [RegExp, number][] = [
    [/thin|hairline/, 100],
    [/extra ?light|ultra ?light/, 200],
    [/light/, 300],
    [/medium/, 500],
    [/semi ?bold|demi ?bold/, 600],
    [/extra ?bold|ultra ?bold/, 800],
    [/black|heavy/, 900],
    [/bold/, 700],
  ]
  for (const [re, w] of table) if (re.test(style)) return w
  return 400
}
