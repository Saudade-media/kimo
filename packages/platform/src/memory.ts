/**
 * `createMemoryPlatform()`: a complete in-memory {@link KimoPlatform} for tests of the
 * document session (board 16–19 flows) without a desktop or browser. `control` scripts what
 * the outside world does: external edits, git operations, foreign leases, disk-full and
 * read-back failures, crashed owners, deep links, updates, focus.
 */
import type { AppliedCapabilities } from "./capabilities"
import { PlatformError, type PlatformErrorCode } from "./errors"
import { basenameOf, dirnameOf, isKimoPath } from "./links"
import { createMemoryMcpHost, type MemoryMcpHost } from "./mcp-memory"
import { createSettingsStore } from "./settings-store"
import { createMemorySkills, type MemorySkills } from "./skills"
import {
  type AcquireResult,
  type DefaultAppStatus,
  type EditorMenuAction,
  type FileRef,
  type FileStat,
  type FontCacheEntry,
  type GitChange,
  type GitState,
  type HelpMenuAction,
  type KimoPlatform,
  type Lease,
  type LeaseHolder,
  type LocalFontFamily,
  MACOS_CHROME,
  type OpenRequest,
  RECOVERY_RETENTION_MS,
  type RecentFile,
  type RecoveryEntry,
  type TrashApi,
  type TrashedFile,
  type UpdateInfo,
  type UpdaterStatus,
  type WatchEvent,
  type WatchedFolder,
} from "./types"
import { createBatcher, DEFAULT_WATCH_DEBOUNCE_MS, Emitter, sha256Hex, utf8Length } from "./util"

interface MemFile {
  bytes: Uint8Array
  mtimeMs: number
  readOnly: boolean
}

/** Test hooks of the memory platform. */
export interface MemoryControl {
  /** Current fake time (ms). Advance with {@link tick}. */
  now(): number
  tick(ms: number): void
  /** Writes a file as another program would (fires watchers). */
  writeExternal(ref: FileRef, text: string | Uint8Array): void
  removeExternal(ref: FileRef): void
  /** Text of a file, or null. */
  readFile(ref: FileRef): string | null
  /** The next write to `ref` (or any file when omitted) fails with this code / errno. */
  failNextWrite(code: PlatformErrorCode, errno?: string, ref?: FileRef): void
  /** The next write succeeds but reads back different bytes (antivirus / sync client). */
  corruptNextReadBack(ref?: FileRef): void
  setReadOnly(ref: FileRef, readOnly: boolean): void
  /** Another process takes the lease of `ref`. */
  setForeignLease(ref: FileRef, holder: Partial<LeaseHolder> & { pid: number }): void
  clearForeignLease(ref: FileRef): void
  /** Marks a lease holder's process dead (stale lease, crashed recovery owner). */
  killPid(pid: number): void
  /** Sets the git state of the repo containing `ref` and notifies watchers. */
  setGit(repoRoot: FileRef, state: Omit<GitState, "repoRoot"> | null, change: GitChange): void
  /** Emits an open request (file association, deep link, second instance). */
  open(request: OpenRequest): void
  setFocused(focused: boolean): void
  setFullscreen(fullscreen: boolean): void
  /** Makes an update available on the next check. */
  publishUpdate(info: Omit<UpdateInfo, "currentVersion">): void
  /** Simulates the OS asking to close the window; resolves to whether it closed. */
  requestClose(options?: { quitting?: boolean }): Promise<boolean>
  /** Calls made to window/updater methods, for assertions. */
  readonly calls: string[]
  /** Local fonts the host reports. */
  setLocalFonts(families: LocalFontFamily[], bytes?: Record<string, Uint8Array>): void
  /** Board 25 §7 (b): a native Help menu item picked (desktop `kimo://help-menu`). */
  helpMenu(action: HelpMenuAction): void
  /** Board 27 / 37: a native File / Edit / View item picked (desktop `kimo://editor-menu`). */
  editorMenu(action: EditorMenuAction): void
  /** Settings › Default app: what `defaultApp.status` answers; a message makes `makeDefault` fail. */
  setDefaultApp(status: DefaultAppStatus, failMessage?: string): void
  /** What `clipboard.writeText` last wrote (null before any write). */
  clipboardText(): string | null
  /** The next settings write is refused with this IO message (read-only settings.json). */
  failNextSettingsWrite(message: string): void
}

export type MemoryPlatform = KimoPlatform & {
  control: MemoryControl
  trash: TrashApi
  mcp: MemoryMcpHost
  skills: MemorySkills
}

export interface MemoryPlatformOptions {
  os?: "macos" | "windows" | "linux"
  appVersion?: string
  /** CPU architecture (Rust `std::env::consts::ARCH`); default "aarch64". */
  arch?: string
  pid?: number
  host?: string
  /** Recovery directory path (informative). */
  recoveryDir?: string
  /** Initial files: path → text. */
  files?: Record<FileRef, string>
  /** Initial settings. */
  settings?: Record<string, unknown>
  /** Initial user skills: folder name → SKILL.md text. */
  skills?: Record<string, string>
}

const enc = new TextEncoder()
const dec = new TextDecoder()
const toBytes = (d: string | Uint8Array) => (typeof d === "string" ? enc.encode(d) : d)

export function createMemoryPlatform(options: MemoryPlatformOptions = {}): MemoryPlatform {
  const os = options.os ?? "macos"
  const pid = options.pid ?? 1000
  const host = options.host ?? "test-host"
  const appVersion = options.appVersion ?? "0.0.0"
  let clock = 1_759_000_000_000
  const now = () => clock
  const calls: string[] = []

  const files = new Map<FileRef, MemFile>()
  const dirs = new Set<FileRef>()
  const addDirs = (ref: FileRef) => {
    for (let d = dirnameOf(ref); d !== "/" && d !== "." && !dirs.has(d); d = dirnameOf(d))
      dirs.add(d)
    dirs.add("/")
  }
  for (const [ref, text] of Object.entries(options.files ?? {})) {
    files.set(ref, { bytes: enc.encode(text), mtimeMs: clock, readOnly: false })
    addDirs(ref)
  }

  // --- watchers ---
  type Watch = { refs: FileRef[]; recursive: boolean; push: (e: WatchEvent) => void }
  const watches = new Set<Watch>()
  const notify = (e: WatchEvent) => {
    for (const w of watches) {
      if (
        w.refs.some(
          (r) =>
            r === e.ref || dirnameOf(e.ref) === r || (w.recursive && e.ref.startsWith(`${r}/`)),
        )
      )
        w.push(e)
    }
  }

  // --- failure injection ---
  const failures: { code: PlatformErrorCode; errno?: string; ref?: FileRef }[] = []
  const corrupt: (FileRef | undefined)[] = []
  const takeFailure = (ref: FileRef) => {
    const i = failures.findIndex((f) => f.ref === undefined || f.ref === ref)
    return i < 0 ? null : failures.splice(i, 1)[0]
  }

  const must = (ref: FileRef): MemFile => {
    const f = files.get(ref)
    if (!f) throw new PlatformError("NOT_FOUND", `No such file: ${ref}`, { errno: "ENOENT" })
    return f
  }

  async function writeAtomic(ref: FileRef, bytes: Uint8Array, mkdirs?: boolean) {
    const fail = takeFailure(ref)
    if (fail)
      throw new PlatformError(fail.code, `Injected ${fail.code} writing ${ref}`, {
        errno: fail.errno,
      })
    if (!dirs.has(dirnameOf(ref))) {
      if (!mkdirs)
        throw new PlatformError("NOT_FOUND", `No directory for ${ref}`, { errno: "ENOENT" })
      addDirs(ref)
    }
    const existing = files.get(ref)
    if (existing?.readOnly)
      throw new PlatformError("PERMISSION", `${ref} is read-only`, { errno: "EACCES" })
    const hash = await sha256Hex(bytes)
    const ci = corrupt.findIndex((c) => c === undefined || c === ref)
    const stored = ci >= 0 ? enc.encode(`${dec.decode(bytes)} `) : bytes
    if (ci >= 0) corrupt.splice(ci, 1)
    files.set(ref, { bytes: stored, mtimeMs: clock, readOnly: false })
    notify({ kind: existing ? "modified" : "created", ref, at: clock })
    if ((await sha256Hex(stored)) !== hash)
      throw new PlatformError("READ_BACK_MISMATCH", `Read-back of ${ref} did not match`)
    return { bytes: bytes.byteLength, hash }
  }

  const stat = (ref: FileRef): FileStat | null => {
    const f = files.get(ref)
    if (f)
      return {
        ref,
        name: basenameOf(ref),
        kind: "file",
        size: f.bytes.byteLength,
        mtimeMs: f.mtimeMs,
        readOnly: f.readOnly,
      }
    if (dirs.has(ref))
      return { ref, name: basenameOf(ref), kind: "directory", size: 0, mtimeMs: 0, readOnly: false }
    return null
  }

  // --- leases ---
  const alivePids = new Set<number>([pid])
  const leases = new Map<FileRef, LeaseHolder & { token: string }>()
  const leaseEvents = new Emitter<[FileRef, LeaseHolder | null]>()
  const lockPathFor = (ref: FileRef) =>
    `/home/test/.kimo/locks/${ref.length.toString(16).padStart(16, "0")}.lock`
  const holderView = (h: LeaseHolder & { token: string }): LeaseHolder => {
    const { token: _t, ...rest } = h
    return {
      ...rest,
      alive: rest.host !== host || alivePids.has(rest.pid),
      self: rest.pid === pid && rest.host === host,
    }
  }
  let tokenSeq = 0

  // --- recovery ---
  const recovery = new Map<string, { entry: Omit<RecoveryEntry, "ownerAlive">; text: string }>()

  // --- git ---
  const git = new Map<FileRef, GitState>()
  const gitEvents = new Emitter<[FileRef, GitState | null, GitChange]>()
  const repoOf = (ref: FileRef): FileRef | null => {
    let best: FileRef | null = null
    for (const root of git.keys())
      if (ref.startsWith(`${root}/`) && (!best || root.length > best.length)) best = root
    return best
  }

  // --- trash ---
  const trashed = new Map<string, { entry: TrashedFile; file: MemFile }>()
  let trashSeq = 0

  // --- recents ---
  const opened = new Map<FileRef, number>()
  const folders = new Set<FileRef>()
  const recentsEvents = new Emitter<[]>()
  const recentOf = (ref: FileRef): RecentFile => {
    const root = repoOf(ref)
    const g = root ? git.get(root) : null
    return {
      ref,
      name: basenameOf(ref),
      folder: dirnameOf(ref),
      modifiedAt: files.get(ref)?.mtimeMs ?? 0,
      openedAt: opened.get(ref) ?? null,
      git: g
        ? { branch: g.branch, status: g.fileStatus, conflicts: 0, operation: g.operation }
        : null,
      missing: !files.has(ref),
    }
  }

  // --- fonts ---
  let localFonts: LocalFontFamily[] = []
  let localFontBytes: Record<string, Uint8Array> = {}
  const fontCache = new Map<string, { entry: FontCacheEntry; bytes: Uint8Array }>()
  const fontPack = new Map<string, { entry: FontCacheEntry; bytes: Uint8Array }>()

  // --- updater ---
  let updaterStatus: UpdaterStatus = { state: "idle" }
  let published: UpdateInfo | null = null
  const updaterEvents = new Emitter<[UpdaterStatus]>()
  const setUpdater = (s: UpdaterStatus) => {
    updaterStatus = s
    updaterEvents.emit(s)
  }

  // --- window ---
  let focused = true
  let fullscreen = false
  const focusEvents = new Emitter<[boolean]>()
  const fullscreenEvents = new Emitter<[boolean]>()
  let closeHandler: ((info: { quitting: boolean }) => Promise<boolean> | boolean) | null = null

  // --- launch ---
  const initial: OpenRequest[] = []
  const openEvents = new Emitter<[OpenRequest]>()
  const helpEvents = new Emitter<[HelpMenuAction]>()
  const menuEvents = new Emitter<[EditorMenuAction]>()
  let clipboardText: string | null = null
  const defaultApp: { status: DefaultAppStatus; fail: string | null } = {
    status: "default",
    fail: null,
  }

  let persisted: Record<string, unknown> = { ...(options.settings ?? {}) }
  let settingsFailure: string | null = null
  const settings = createSettingsStore({
    load: async () => persisted,
    persist: async (_k, _v, all) => {
      if (settingsFailure !== null) {
        const message = settingsFailure
        settingsFailure = null
        throw new PlatformError("IO", message)
      }
      persisted = { ...all }
    },
  })

  const capabilities: AppliedCapabilities = {
    fileAccess: "memory",
    saveInPlace: true,
    watch: true,
    reveal: true,
    leases: "os",
    recovery: "memory",
    git: true,
    localFonts: true,
    remoteFonts: true,
    updater: true,
    trafficLights: os === "macos",
    settingsWindow: true,
    deepLinks: true,
    fileAssociation: true,
    watchedFolders: true,
  }

  const platform: MemoryPlatform = {
    kind: "memory",
    os,
    appVersion,
    arch: options.arch ?? "aarch64",
    help: {
      onMenu: (l) => helpEvents.on(l),
      showLogs: async () => {
        calls.push("showLogs")
      },
    },
    menu: {
      onAction: (l) => menuEvents.on(l),
      async setContext(context) {
        calls.push(`menuContext ${context}`)
      },
    },
    clipboard: {
      async writeText(text) {
        calls.push(`clipboard ${text.length}`)
        clipboardText = text
      },
    },
    defaultApp: {
      async status() {
        return defaultApp.status
      },
      async makeDefault() {
        calls.push("makeDefaultApp")
        if (defaultApp.fail) throw new PlatformError("IO", defaultApp.fail)
        defaultApp.status = "default"
      },
    },
    capabilities,
    mcp: createMemoryMcpHost({ status: { version: appVersion } }),
    skills: createMemorySkills(options.skills),
    files: {
      async readText(ref) {
        const f = must(ref)
        return { text: dec.decode(f.bytes), hash: await sha256Hex(f.bytes) }
      },
      async readBytes(ref) {
        return must(ref).bytes.slice()
      },
      writeTextAtomic: (ref, text, o) => writeAtomic(ref, enc.encode(text), o?.mkdirs),
      writeBytesAtomic: (ref, bytes, o) => writeAtomic(ref, bytes.slice(), o?.mkdirs),
      async remove(ref) {
        if (files.delete(ref)) notify({ kind: "removed", ref, at: clock })
      },
      async rename(from, to) {
        const f = must(from)
        if (files.has(to) || dirs.has(to))
          throw new PlatformError("EXISTS", `${basenameOf(to)} already exists`, { errno: "EEXIST" })
        const fail = takeFailure(to)
        if (fail) throw new PlatformError(fail.code, `Injected ${fail.code} renaming ${from}`)
        files.delete(from)
        files.set(to, { ...f, mtimeMs: clock })
        addDirs(to)
        if (opened.delete(from)) opened.set(to, clock)
        notify({ kind: "removed", ref: from, at: clock })
        notify({ kind: "created", ref: to, at: clock })
        recentsEvents.emit()
      },
      async copy(from, to) {
        const f = must(from)
        if (files.has(to) || dirs.has(to))
          throw new PlatformError("EXISTS", `${basenameOf(to)} already exists`, { errno: "EEXIST" })
        await writeAtomic(to, f.bytes.slice(), true)
      },
      stat: async (ref) => stat(ref),
      async list(dir, o) {
        const out: FileStat[] = []
        for (const ref of [...files.keys(), ...dirs]) {
          if (dirnameOf(ref) !== dir || ref === dir) continue
          const s = stat(ref)
          if (!s) continue
          if (
            s.kind === "file" &&
            o?.extensions &&
            !o.extensions.some((e) => ref.endsWith(`.${e}`))
          )
            continue
          out.push(s)
        }
        return out.sort((a, b) => (a.ref < b.ref ? -1 : 1))
      },
      watch(refs, o, listener) {
        const batcher = createBatcher<WatchEvent>(
          o.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS,
          listener,
        )
        const w: Watch = { refs, recursive: o.recursive ?? false, push: (e) => batcher.push(e) }
        watches.add(w)
        return () => {
          watches.delete(w)
          batcher.cancel()
        }
      },
      async reveal(ref) {
        calls.push(`reveal ${ref}`)
      },
      async openWithDefaultApp(ref) {
        calls.push(`openWithDefaultApp ${ref}`)
      },
      async openAsText(ref) {
        calls.push(`openAsText ${ref}`)
      },
      async openExternalUrl(url) {
        calls.push(`openExternalUrl ${url}`)
      },
      async download(name) {
        calls.push(`download ${name}`)
      },
    },
    dialogs: {
      async openFile() {
        calls.push("dialog openFile")
        return []
      },
      async saveFile() {
        calls.push("dialog saveFile")
        return null
      },
      async pickFolder() {
        calls.push("dialog pickFolder")
        return null
      },
    },
    recents: {
      async listFiles(o) {
        const refs = new Set<FileRef>(opened.keys())
        for (const folder of folders)
          for (const ref of files.keys())
            if (ref.startsWith(`${folder}/`) && isKimoPath(ref)) refs.add(ref)
        const list = [...refs].map(recentOf).sort((a, b) => b.modifiedAt - a.modifiedAt)
        return o?.limit ? list.slice(0, o.limit) : list
      },
      async noteOpened(ref) {
        opened.set(ref, clock)
        recentsEvents.emit()
      },
      async removeFile(ref) {
        opened.delete(ref)
        recentsEvents.emit()
      },
      async clearFiles() {
        opened.clear()
        recentsEvents.emit()
      },
      async listFolders() {
        return [...folders].map((ref): WatchedFolder => {
          const root = repoOf(`${ref}/x`) ?? (git.has(ref) ? ref : null)
          const g = root ? git.get(root) : null
          return {
            ref,
            label: basenameOf(ref),
            git: g ? { branch: g.branch, changedCount: g.changedCount } : null,
            fileCount: [...files.keys()].filter((f) => f.startsWith(`${ref}/`) && isKimoPath(f))
              .length,
          }
        })
      },
      async addFolder(ref) {
        folders.add(ref)
        recentsEvents.emit()
      },
      async removeFolder(ref) {
        folders.delete(ref)
        recentsEvents.emit()
      },
      async scanFolder(ref) {
        return [...files.keys()]
          .filter((f) => f.startsWith(`${ref}/`) && isKimoPath(f))
          .map(recentOf)
      },
      onChange: (l) => recentsEvents.on(l),
    },
    trash: {
      async move(ref) {
        const f = must(ref)
        const fail = takeFailure(ref)
        if (fail) throw new PlatformError(fail.code, `Injected ${fail.code} trashing ${ref}`)
        const entry: TrashedFile = {
          id: `t${++trashSeq}`,
          originalRef: ref,
          name: basenameOf(ref),
          trashedAt: clock,
        }
        files.delete(ref)
        opened.delete(ref)
        trashed.set(entry.id, { entry, file: f })
        notify({ kind: "removed", ref, at: clock })
        recentsEvents.emit()
        return entry
      },
      async list() {
        return [...trashed.values()].map((t) => t.entry).sort((a, b) => b.trashedAt - a.trashedAt)
      },
      async restore(id, to) {
        const t = trashed.get(id)
        if (!t) throw new PlatformError("NOT_FOUND", "That file is no longer in the Trash")
        const target = to ?? t.entry.originalRef
        if (files.has(target))
          throw new PlatformError("EXISTS", `${basenameOf(target)} already exists`, {
            errno: "EEXIST",
          })
        files.set(target, t.file)
        addDirs(target)
        trashed.delete(id)
        opened.set(target, clock)
        notify({ kind: "created", ref: target, at: clock })
        recentsEvents.emit()
        return target
      },
      async remove(id) {
        trashed.delete(id)
      },
      async empty() {
        const n = trashed.size
        trashed.clear()
        return n
      },
    },
    leases: {
      async acquire(ref, o): Promise<AcquireResult> {
        const cur = leases.get(ref)
        let reclaimed: LeaseHolder | undefined
        if (cur) {
          const view = holderView(cur)
          if (view.self) return { ok: true, lease: { ref, token: cur.token, holder: view } }
          if (view.alive || o?.reclaimStale === false) return { ok: false, holder: view }
          reclaimed = view
        }
        const token = `t${++tokenSeq}`
        const holder = {
          pid,
          app: "kimo-desktop",
          appLabel: "Kimo",
          host,
          sinceIso: new Date(clock).toISOString(),
          lockPath: lockPathFor(ref),
          alive: true,
          self: true,
          token,
        }
        leases.set(ref, holder)
        leaseEvents.emit(ref, holderView(holder))
        const lease: Lease = { ref, token, holder: holderView(holder) }
        return reclaimed ? { ok: true, lease, reclaimed } : { ok: true, lease }
      },
      async release(lease) {
        const cur = leases.get(lease.ref)
        if (cur && cur.token === lease.token) {
          leases.delete(lease.ref)
          leaseEvents.emit(lease.ref, null)
        }
      },
      async inspect(ref) {
        const cur = leases.get(ref)
        return cur ? holderView(cur) : null
      },
      watch: (ref, l) => leaseEvents.on((r, h) => r === ref && l(h)),
    },
    recovery: {
      dir: options.recoveryDir ?? "/home/test/.kimo/recovery",
      async list() {
        return [...recovery.values()]
          .map(({ entry }) => ({ ...entry, ownerAlive: alivePids.has(entry.ownerPid) }))
          .sort((a, b) => b.updatedAt - a.updatedAt)
      },
      async write(input) {
        const prev = recovery.get(input.id)
        const entry: Omit<RecoveryEntry, "ownerAlive"> = {
          id: input.id,
          sourceRef: input.sourceRef,
          name: input.name,
          reason: input.reason,
          createdAt: prev?.entry.createdAt ?? clock,
          updatedAt: clock,
          edits: input.edits,
          lastAutosaveAt: input.lastAutosaveAt ?? null,
          sourceChangedSince: null,
          bytes: utf8Length(input.text),
          hash: await sha256Hex(input.text),
          ownerPid: pid,
          ownerExitedAt: null,
          appVersion,
        }
        if (input.layers !== undefined) entry.layers = input.layers
        recovery.set(input.id, { entry, text: input.text })
        return { ...entry, ownerAlive: true }
      },
      async restore(id) {
        const r = recovery.get(id)
        if (!r) throw new PlatformError("NOT_FOUND", `No recovery entry ${id}`)
        const source = r.entry.sourceRef ? files.get(r.entry.sourceRef) : undefined
        const sourceChangedSince = source ? source.mtimeMs > r.entry.updatedAt : null
        return {
          entry: { ...r.entry, sourceChangedSince, ownerAlive: alivePids.has(r.entry.ownerPid) },
          text: r.text,
        }
      },
      async discard(id) {
        recovery.delete(id)
      },
      async prune(maxAgeMs = RECOVERY_RETENTION_MS) {
        let n = 0
        for (const [id, r] of recovery)
          if (clock - r.entry.updatedAt > maxAgeMs) {
            recovery.delete(id)
            n++
          }
        return n
      },
    },
    git: {
      async state(ref) {
        const root = repoOf(ref)
        return root ? (git.get(root) ?? null) : null
      },
      watch(ref, l) {
        return gitEvents.on((root, state, change) => {
          if (ref.startsWith(`${root}/`)) l(state, change)
        })
      },
      async mergeDriverStatus() {
        return { gitattributes: false, config: false }
      },
      async installMergeDriver(root) {
        calls.push(`installMergeDriver ${root}`)
      },
    },
    fonts: {
      listLocal: async () => localFonts,
      async loadLocal(ps) {
        const b = localFontBytes[ps]
        if (!b) throw new PlatformError("NOT_FOUND", `No local font ${ps}`)
        return b
      },
      cache: {
        get: async (key) => fontCache.get(key)?.bytes ?? null,
        async put(meta, bytes) {
          const key = (await sha256Hex(bytes)).slice(0, 16)
          const entry: FontCacheEntry = { ...meta, key, bytes: bytes.byteLength, cachedAt: clock }
          fontCache.set(key, { entry, bytes })
          return entry
        },
        list: async () => [...fontCache.values()].map((e) => e.entry),
        stats: async () => ({
          count: fontCache.size,
          bytes: [...fontCache.values()].reduce((s, e) => s + e.entry.bytes, 0),
          dir: "/home/test/.kimo/fonts",
        }),
        clear: async () => fontCache.clear(),
      },
      pack: {
        get: async (key) => fontPack.get(key)?.bytes ?? null,
        async put(meta, bytes) {
          const key = (await sha256Hex(bytes)).slice(0, 16)
          const entry: FontCacheEntry = { ...meta, key, bytes: bytes.byteLength, cachedAt: clock }
          fontPack.set(key, { entry, bytes })
          return entry
        },
        list: async () => [...fontPack.values()].map((e) => e.entry),
        stats: async () => ({
          count: fontPack.size,
          bytes: [...fontPack.values()].reduce((s, e) => s + e.entry.bytes, 0),
          dir: "/home/test/.local/share/kimo/font-pack",
        }),
        clear: async () => fontPack.clear(),
      },
      async fetchRemote(url) {
        const s = settings.all()
        if (s["privacy.noThirdPartyFetch"] || !s["fonts.google"])
          throw new PlatformError("BLOCKED", "Remote fonts are off in Settings")
        if (!/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url))
          throw new PlatformError("BLOCKED", `Host not allowed: ${url}`)
        calls.push(`fetchRemote ${url}`)
        return new Uint8Array()
      },
      async openCacheFolder() {
        calls.push("openCacheFolder")
      },
    },
    updater: {
      status: () => updaterStatus,
      async check() {
        setUpdater({ state: "checking" })
        if (published) {
          setUpdater({ state: "available", info: published })
          return published
        }
        setUpdater({ state: "up-to-date", checkedAt: clock })
        return null
      },
      async download() {
        if (!published) throw new PlatformError("INVALID", "No update to download")
        setUpdater({ state: "downloading", info: published, received: 0, total: 1 })
        setUpdater({ state: "ready", info: published })
      },
      async restart() {
        calls.push("updater restart")
      },
      onStatus: (l) => updaterEvents.on(l),
    },
    window: {
      label: "main",
      trafficLightPosition: () =>
        os === "macos" ? { ...MACOS_CHROME.trafficLightPosition } : null,
      trafficLightInset: () =>
        os !== "macos" ? 0 : fullscreen ? MACOS_CHROME.fullscreenInset : MACOS_CHROME.inset,
      onTrafficLightInsetChange: (l) =>
        fullscreenEvents.on((f) =>
          l(os !== "macos" ? 0 : f ? MACOS_CHROME.fullscreenInset : MACOS_CHROME.inset),
        ),
      async titlebarDoubleClick() {
        calls.push("titlebar double-click")
      },
      isFocused: () => focused,
      onFocusChange: (l) => focusEvents.on(l),
      isFullscreen: () => fullscreen,
      onFullscreenChange: (l) => fullscreenEvents.on(l),
      async setTitle(t) {
        calls.push(`setTitle ${t}`)
      },
      async setDocumentEdited(e) {
        calls.push(`setDocumentEdited ${e}`)
      },
      async openSettings(pane, focus) {
        calls.push(`openSettings ${pane ?? "general"}${focus ? ` ${focus}` : ""}`)
        return "window"
      },
      async openNewWindow() {
        calls.push("openNewWindow")
      },
      onCloseRequested(handler) {
        closeHandler = handler
        return () => {
          if (closeHandler === handler) closeHandler = null
        }
      },
      async close() {
        calls.push("close")
      },
    },
    settings,
    launch: {
      async takeInitialRequests() {
        return initial.splice(0)
      },
      onOpenRequest: (l) => openEvents.on(l),
    },
    dispose() {
      watches.clear()
      settings.dispose()
    },
    control: {
      now,
      helpMenu: (a) => helpEvents.emit(a),
      editorMenu: (a) => menuEvents.emit(a),
      clipboardText: () => clipboardText,
      setDefaultApp(status, failMessage) {
        defaultApp.status = status
        defaultApp.fail = failMessage ?? null
      },
      failNextSettingsWrite: (message) => {
        settingsFailure = message
      },
      tick(ms) {
        clock += ms
      },
      writeExternal(ref, data) {
        const existed = files.has(ref)
        files.set(ref, { bytes: toBytes(data), mtimeMs: clock, readOnly: false })
        addDirs(ref)
        notify({ kind: existed ? "modified" : "created", ref, at: clock })
      },
      removeExternal(ref) {
        if (files.delete(ref)) notify({ kind: "removed", ref, at: clock })
      },
      readFile: (ref) => {
        const f = files.get(ref)
        return f ? dec.decode(f.bytes) : null
      },
      failNextWrite(code, errno, ref) {
        failures.push(ref === undefined ? { code, errno } : { code, errno, ref })
      },
      corruptNextReadBack(ref) {
        corrupt.push(ref)
      },
      setReadOnly(ref, ro) {
        const f = files.get(ref)
        if (f) f.readOnly = ro
      },
      setForeignLease(ref, h) {
        const holder = {
          app: "kimo-mcp",
          appLabel: "kimo mcp (headless)",
          host,
          sinceIso: new Date(clock).toISOString(),
          lockPath: lockPathFor(ref),
          alive: true,
          self: false,
          ...h,
          token: `foreign-${h.pid}`,
        }
        alivePids.add(h.pid)
        leases.set(ref, holder)
        leaseEvents.emit(ref, holderView(holder))
      },
      clearForeignLease(ref) {
        leases.delete(ref)
        leaseEvents.emit(ref, null)
      },
      killPid(p) {
        alivePids.delete(p)
        for (const r of recovery.values())
          if (r.entry.ownerPid === p) r.entry = { ...r.entry, ownerExitedAt: clock }
      },
      setGit(root, state, change) {
        if (state) git.set(root, { ...state, repoRoot: root })
        else git.delete(root)
        gitEvents.emit(root, state ? { ...state, repoRoot: root } : null, change)
        recentsEvents.emit()
      },
      open(req) {
        if (openEvents.size === 0) initial.push(req)
        else openEvents.emit(req)
      },
      setFocused(f) {
        focused = f
        focusEvents.emit(f)
      },
      setFullscreen(f) {
        fullscreen = f
        fullscreenEvents.emit(f)
      },
      publishUpdate(info) {
        published = { ...info, currentVersion: appVersion }
      },
      async requestClose(options = {}) {
        const ok = closeHandler ? await closeHandler({ quitting: options.quitting === true }) : true
        if (ok) calls.push("close")
        return ok
      },
      calls,
      setLocalFonts(families, bytes = {}) {
        localFonts = families
        localFontBytes = bytes
      },
    },
  }
  return platform
}
