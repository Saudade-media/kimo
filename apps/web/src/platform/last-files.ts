/**
 * General › On launch = "Last files": the file each desktop window shows is remembered while
 * it is open; a window the user closes forgets it, a window closed by Quit keeps it. On the next
 * launch with no file to open (no Finder double-click, link or argv), the main window reopens the
 * most recent one.
 *
 * Every window of the desktop app shares one origin, so the record lives in localStorage
 * (`kimo.lastFiles`: window label → file + time). Storage failures are ignored: the worst case is
 * that Home shows instead of the last file.
 */
import type { FileRef } from "@kimo/platform"

const KEY = "kimo.lastFiles"

type Record_ = Record<string, { ref: FileRef; at: number }>

/** The storage the record lives in (localStorage; tests pass their own). */
export interface LastFilesStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): LastFilesStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function read(storage: LastFilesStorage | null): Record_ {
  try {
    const raw = storage?.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    if (!v || typeof v !== "object" || Array.isArray(v)) return {}
    const out: Record_ = {}
    for (const [label, e] of Object.entries(v as Record<string, unknown>)) {
      const x = e as { ref?: unknown; at?: unknown } | null
      if (x && typeof x.ref === "string" && typeof x.at === "number")
        out[label] = { ref: x.ref, at: x.at }
    }
    return out
  } catch {
    return {}
  }
}

function write(storage: LastFilesStorage | null, r: Record_): void {
  try {
    if (Object.keys(r).length) storage?.setItem(KEY, JSON.stringify(r))
    else storage?.removeItem(KEY)
  } catch {
    // Full or blocked storage: nothing is reopened next time.
  }
}

/** The window `label` now shows `ref` (null: Home, Settings, an untitled file). */
export function noteWindowFile(
  label: string,
  ref: FileRef | null,
  now = Date.now(),
  storage = defaultStorage(),
): void {
  const r = read(storage)
  if (ref) r[label] = { ref, at: now }
  else if (r[label]) delete r[label]
  else return
  write(storage, r)
}

/** The user closed window `label` (not a quit): its file is not reopened. */
export function forgetWindowFile(label: string, storage = defaultStorage()): void {
  noteWindowFile(label, null, 0, storage)
}

/** The remembered files, most recent first; clears the record (each launch reads it once). */
export function takeLastFiles(storage = defaultStorage()): FileRef[] {
  const r = read(storage)
  write(storage, {})
  const seen = new Set<FileRef>()
  return Object.values(r)
    .sort((a, b) => b.at - a.at)
    .map((e) => e.ref)
    .filter((ref) => !seen.has(ref) && !!seen.add(ref))
}
