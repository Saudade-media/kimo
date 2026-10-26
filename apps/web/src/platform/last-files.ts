/**
 * General › On launch = "Last files": the files each desktop window shows are remembered while
 * it is open; a window the user closes forgets them, a window closed by Quit keeps them. On the
 * next launch with no file to open (no Finder double-click, link or argv), the main window
 * reopens the most recent window's tabs in order, the focused one in front (board 44 §5
 * "Restore").
 *
 * Every window of the desktop app shares one origin, so the record lives in localStorage
 * (`kimo.lastFiles`: window label → tabs + focused file + time; records written before tabs
 * hold one `ref`). Storage failures are ignored: the worst case is that Home shows instead of
 * the last files.
 */
import type { FileRef } from "@kimo/platform"

const KEY = "kimo.lastFiles"

interface Entry {
  /** The focused file (null: Home was in front). */
  ref: FileRef | null
  /** Board 44 §5: the window's file tabs, in order. */
  tabs: FileRef[]
  at: number
}

type Record_ = Record<string, Entry>

/** What one window had open (board 44 §5 "Restore"). */
export interface WindowFiles {
  tabs: FileRef[]
  active: FileRef | null
}

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
      const x = e as { ref?: unknown; tabs?: unknown; at?: unknown } | null
      if (!x || typeof x.at !== "number") continue
      const ref = typeof x.ref === "string" ? x.ref : null
      const tabs = Array.isArray(x.tabs)
        ? x.tabs.filter((t): t is string => typeof t === "string")
        : ref
          ? [ref]
          : []
      if (ref && !tabs.includes(ref)) tabs.unshift(ref)
      if (tabs.length) out[label] = { ref, tabs, at: x.at }
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
  noteWindowTabs(
    label,
    ref ? { tabs: [ref], active: ref } : { tabs: [], active: null },
    now,
    storage,
  )
}

/** Board 44 §5: window `label` now has `files` open (no tabs forgets it). */
export function noteWindowTabs(
  label: string,
  files: WindowFiles,
  now = Date.now(),
  storage = defaultStorage(),
): void {
  const r = read(storage)
  const prev = r[label]
  if (files.tabs.length) {
    if (
      prev &&
      prev.ref === files.active &&
      prev.tabs.length === files.tabs.length &&
      prev.tabs.every((t, i) => t === files.tabs[i])
    )
      return
    r[label] = { ref: files.active, tabs: [...files.tabs], at: now }
  } else if (prev) delete r[label]
  else return
  write(storage, r)
}

/** The user closed window `label` (not a quit): its files are not reopened. */
export function forgetWindowFile(label: string, storage = defaultStorage()): void {
  noteWindowFile(label, null, 0, storage)
}

/** The remembered files (each window's focused one), most recent first; clears the record. */
export function takeLastFiles(storage = defaultStorage()): FileRef[] {
  const r = read(storage)
  write(storage, {})
  const seen = new Set<FileRef>()
  return Object.values(r)
    .sort((a, b) => b.at - a.at)
    .map((e) => e.ref ?? e.tabs[0] ?? "")
    .filter((ref) => !!ref && !seen.has(ref) && !!seen.add(ref))
}

/**
 * Board 44 §5 "Restore": the most recent window's tabs and focused file; clears the record
 * (each launch reads it once). Null when nothing was remembered.
 */
export function takeLastWindow(storage = defaultStorage()): WindowFiles | null {
  const r = read(storage)
  write(storage, {})
  const last = Object.values(r).sort((a, b) => b.at - a.at)[0]
  return last ? { tabs: [...last.tabs], active: last.ref } : null
}
