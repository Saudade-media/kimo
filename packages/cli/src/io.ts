/**
 * File helpers shared by the commands: console sink, atomic writes and the per-file lease
 * check (teardown 9.4 "single writer per file", ADR 0012 §3 "Leases").
 */
import { createHash, randomBytes } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs"
import { homedir, hostname } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

/** Where a command prints. Tests capture it; `main.ts` binds it to the process streams. */
export interface CliIO {
  stdout(text: string): void
  stderr(text: string): void
  /** Directory relative paths resolve against (default `process.cwd()`). */
  cwd?: string
  /** Environment (default `process.env`): `KIMO_HOME` overrides `~/.kimo`. */
  env?: Record<string, string | undefined>
}

export const processIO: CliIO = {
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
}

export const resolveIn = (io: CliIO, p: string) => resolve(io.cwd ?? process.cwd(), p)

/** `~/.kimo`, or `$KIMO_HOME`. */
function kimoHome(io: CliIO): string {
  const env = io.env ?? process.env
  return env.KIMO_HOME && env.KIMO_HOME.length > 0 ? env.KIMO_HOME : join(homedir(), ".kimo")
}

/** `sha256(path)[:16]` of the cleaned absolute path: the id of lease and recovery file names (same as apps/desktop leases.rs). */
export const pathHash = (path: string) =>
  createHash("sha256").update(path, "utf8").digest("hex").slice(0, 16)

/** The lease holder of `file` when one is alive, else null. */
export interface LiveLease {
  pid: number
  appLabel: string
  host: string
  sinceIso: string
  lockPath: string
}

/**
 * Reads the per-file lease (`<kimo home>/locks/<sha256(path)[:16]>.lock`). A holder on this host
 * whose pid is gone is stale and ignored; a holder on another host counts as alive.
 */
export function liveLease(io: CliIO, file: string): LiveLease | null {
  const candidates = new Set<string>([file])
  try {
    candidates.add(realpathSync(file))
  } catch {
    // The file may not exist yet.
  }
  for (const p of candidates) {
    const lockPath = join(kimoHome(io), "locks", `${pathHash(p)}.lock`)
    if (!existsSync(lockPath)) continue
    let body: Record<string, unknown>
    try {
      body = JSON.parse(readFileSync(lockPath, "utf8")) as Record<string, unknown>
    } catch {
      continue
    }
    const pid = typeof body.pid === "number" ? body.pid : -1
    const host = typeof body.host === "string" ? body.host : hostname()
    const alive = host !== hostname() || pidAlive(pid)
    if (!alive) continue
    return {
      pid,
      host,
      lockPath,
      appLabel: typeof body.appLabel === "string" ? body.appLabel : "another app",
      sinceIso: typeof body.sinceIso === "string" ? body.sinceIso : "",
    }
  }
  return null
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as { code?: string }).code === "EPERM"
  }
}

/**
 * Atomic write (ADR 0012 §3): temp file in the same directory → fsync → rename → read back and
 * compare. The original is untouched when anything before the rename fails.
 */
export function writeFileAtomic(path: string, text: string): void {
  const dir = dirname(path)
  const tmp = join(dir, `.${basename(path)}.${randomBytes(4).toString("hex")}.tmp`)
  const bytes = Buffer.from(text, "utf8")
  const fd = openSync(tmp, "w")
  try {
    writeSync(fd, bytes)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(tmp, path)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
  try {
    const dfd = openSync(dir, "r")
    try {
      fsyncSync(dfd)
    } finally {
      closeSync(dfd)
    }
  } catch {
    // Directory fsync is not supported everywhere (e.g. Windows).
  }
  if (!readFileSync(path).equals(bytes)) throw new Error(`Read-back mismatch after writing ${path}`)
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
