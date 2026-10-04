/**
 * A `KimoPlatform` for headless `kimo mcp` (ADR 0013 §8): real files (atomic write + read-back)
 * and real per-file leases in the lock format shared with the desktop app (`leases.rs`) and the
 * CLI (`io.ts`). Everything a headless process has no use for (dialogs, windows, updater, git
 * watching, fonts, recents) comes from the memory platform, so the type stays complete.
 */
import { createHash, randomBytes } from "node:crypto"
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs"
import { hostname } from "node:os"
import { basename, dirname, extname, join } from "node:path"
import type {
  AcquireResult,
  FileRef,
  FileStat,
  FilesApi,
  KimoPlatform,
  Lease,
  LeaseHolder,
  LeasesApi,
} from "@kimo/platform"
import { codeForErrno, PlatformError } from "@kimo/platform"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { pathHash, writeFileAtomic } from "../io"

export interface LeaseIdentity {
  app: string
  appLabel: string
  pid: number
  host: string
}

export const HEADLESS_IDENTITY = (): LeaseIdentity => ({
  app: "kimo-mcp",
  appLabel: "kimo mcp (headless)",
  pid: process.pid,
  host: hostname(),
})

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex")

function ioError(e: unknown, what: string): PlatformError {
  const errno = (e as { code?: string }).code
  return new PlatformError(codeForErrno(errno), `${what}: ${(e as Error).message}`, {
    ...(errno ? { errno } : {}),
    cause: e,
  })
}

/** Canonical absolute path (symlinks resolved; the parent's when the file does not exist). */
export function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    try {
      return join(realpathSync(dirname(path)), basename(path))
    } catch {
      return path
    }
  }
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as { code?: string }).code === "EPERM"
  }
}

export function createNodeFiles(): FilesApi {
  const stat = (ref: FileRef): FileStat | null => {
    try {
      const s = statSync(ref)
      return {
        ref,
        name: basename(ref),
        kind: s.isDirectory() ? "directory" : "file",
        size: s.size,
        mtimeMs: s.mtimeMs,
        readOnly: false,
      }
    } catch {
      return null
    }
  }
  const writeAtomic = (ref: FileRef, data: string | Uint8Array, mkdirs?: boolean) => {
    try {
      if (mkdirs) mkdirSync(dirname(ref), { recursive: true })
      const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data)
      if (typeof data === "string") writeFileAtomic(ref, data)
      else writeBytesAtomic(ref, bytes)
      return { bytes: bytes.length, hash: sha256(bytes) }
    } catch (e) {
      if (e instanceof Error && /Read-back mismatch/.test(e.message))
        throw new PlatformError("READ_BACK_MISMATCH", e.message)
      throw ioError(e, `write ${ref}`)
    }
  }
  const headless = (what: string) => async () => {
    throw new PlatformError("UNSUPPORTED", `${what} is not available headless`)
  }
  return {
    async readText(ref) {
      try {
        const buf = readFileSync(ref)
        return { text: buf.toString("utf8"), hash: sha256(buf) }
      } catch (e) {
        throw ioError(e, `read ${ref}`)
      }
    },
    async readBytes(ref) {
      try {
        return new Uint8Array(readFileSync(ref))
      } catch (e) {
        throw ioError(e, `read ${ref}`)
      }
    },
    async writeTextAtomic(ref, text, options) {
      return writeAtomic(ref, text, options?.mkdirs)
    },
    async writeBytesAtomic(ref, bytes, options) {
      return writeAtomic(ref, bytes, options?.mkdirs)
    },
    async remove(ref) {
      rmSync(ref, { force: true })
    },
    async stat(ref) {
      return stat(ref)
    },
    async list(dir, options) {
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch (e) {
        throw ioError(e, `list ${dir}`)
      }
      const exts = options?.extensions?.map((e) => `.${e.toLowerCase()}`)
      return names
        .filter((n) => !exts || exts.includes(extname(n).toLowerCase()))
        .map((n) => stat(join(dir, n)))
        .filter((s): s is FileStat => s !== null)
    },
    // Headless: external edits are not watched (the agent owns the file while it holds the lease).
    watch: () => () => {},
    reveal: headless("reveal"),
    openWithDefaultApp: headless("open"),
    openExternalUrl: headless("openExternalUrl"),
    download: headless("download"),
  }
}

function writeBytesAtomic(path: string, bytes: Buffer): void {
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(4).toString("hex")}.tmp`)
  const fd = openSync(tmp, "w")
  try {
    writeSync(fd, bytes)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(tmp, path)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
  if (!readFileSync(path).equals(bytes)) throw new Error(`Read-back mismatch after writing ${path}`)
}

interface LockBody {
  version: 1
  path: string
  pid: number
  app: string
  appLabel: string
  host: string
  sinceIso: string
  socket?: string
  token: string
}

/**
 * Leases in `<kimoHome>/locks/<sha256(path)[:16]>.lock`, created with O_EXCL. A lock whose pid
 * is dead on this host (or whose body is garbage) is stale and reclaimed on acquire.
 */
export function createNodeLeases(kimoHome: string, me: LeaseIdentity): LeasesApi {
  const dir = join(kimoHome, "locks")
  const lockPath = (ref: FileRef) => join(dir, `${pathHash(canonical(ref))}.lock`)
  const read = (lock: string): LockBody | "garbage" | null => {
    if (!existsSync(lock)) return null
    try {
      const b = JSON.parse(readFileSync(lock, "utf8")) as LockBody
      return typeof b.pid === "number" ? b : "garbage"
    } catch {
      return "garbage"
    }
  }
  const view = (b: LockBody, lock: string): LeaseHolder => ({
    pid: b.pid,
    app: b.app,
    appLabel: b.appLabel,
    host: b.host,
    sinceIso: b.sinceIso,
    ...(b.socket ? { socket: b.socket } : {}),
    lockPath: lock,
    alive: b.host !== me.host || pidAlive(b.pid),
    self: b.host === me.host && b.pid === me.pid,
  })
  const api: LeasesApi = {
    async acquire(ref, options): Promise<AcquireResult> {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const lock = lockPath(ref)
      let reclaimed: LeaseHolder | undefined
      for (let attempt = 0; attempt < 3; attempt++) {
        const body: LockBody = {
          version: 1,
          path: canonical(ref),
          pid: me.pid,
          app: me.app,
          appLabel: me.appLabel,
          host: me.host,
          sinceIso: new Date().toISOString(),
          token: randomBytes(16).toString("hex"),
        }
        try {
          const fd = openSync(lock, "wx", 0o600)
          try {
            writeSync(fd, JSON.stringify(body))
          } finally {
            closeSync(fd)
          }
          const lease: Lease = { ref, token: body.token, holder: view(body, lock) }
          return reclaimed ? { ok: true, lease, reclaimed } : { ok: true, lease }
        } catch (e) {
          if ((e as { code?: string }).code !== "EEXIST") throw ioError(e, `lock ${ref}`)
        }
        const cur = read(lock)
        if (cur === null) continue
        if (cur !== "garbage") {
          const h = view(cur, lock)
          if (h.self) return { ok: true, lease: { ref, token: cur.token, holder: h } }
          if (h.alive || options?.reclaimStale === false) return { ok: false, holder: h }
          reclaimed = h
        }
        rmSync(lock, { force: true })
      }
      throw new PlatformError("IO", `could not take the lease of ${ref}`)
    },
    async release(lease) {
      const lock = lockPath(lease.ref)
      const cur = read(lock)
      if (cur && cur !== "garbage" && cur.token === lease.token) rmSync(lock, { force: true })
    },
    async inspect(ref) {
      const lock = lockPath(ref)
      const cur = read(lock)
      if (cur === null || cur === "garbage") return null
      const h = view(cur, lock)
      return h.alive ? h : null
    },
    watch: () => () => {},
  }
  return api
}

/** The headless platform: memory platform with real files and leases. */
export function createNodePlatform(options: {
  kimoHome: string
  identity?: LeaseIdentity
  appVersion?: string
}): KimoPlatform {
  const os =
    process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"
  const base = createMemoryPlatform({ os, appVersion: options.appVersion ?? "0.0.0" })
  const identity = options.identity ?? HEADLESS_IDENTITY()
  const platform: KimoPlatform = {
    kind: base.kind,
    os: base.os,
    appVersion: base.appVersion,
    capabilities: base.capabilities,
    files: createNodeFiles(),
    dialogs: base.dialogs,
    recents: base.recents,
    leases: createNodeLeases(options.kimoHome, identity),
    recovery: base.recovery,
    git: base.git,
    fonts: base.fonts,
    updater: base.updater,
    window: base.window,
    settings: base.settings,
    launch: base.launch,
    dispose: () => base.dispose(),
  }
  return platform
}
