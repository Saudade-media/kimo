/**
 * Home sections (board 37 "Home & gaps", rules table xKrpy): pure helpers for the section
 * titles, list sources, names of new files, the Design systems index, the web Trash clock and
 * the "Couldn't …" error copy. Unit-tested in `test/board37-home.test.ts`.
 */
import { localComponents } from "@kimo/core-schema"
import {
  basenameOf,
  dirnameOf,
  type PlatformError,
  type RecentFile,
  type WatchedFolder,
} from "@kimo/platform"
import type { HomeSection } from "../router"

/** Sidebar label = h1 of each fixed section (rules "h1"). */
export const SECTION_TITLE = {
  recents: "Recents",
  all: "All files",
  templates: "Templates",
  libraries: "Design systems",
  trash: "Trash",
} as const

/** The watched folder a `#/folder/<ref>` route lands on: `ref` itself, or the folder holding it. */
export function resolveFolder(
  ref: string,
  folders: readonly WatchedFolder[],
): WatchedFolder | null {
  const norm = ref.replace(/[\\/]+$/, "")
  return (
    folders
      .filter(
        (f) => norm === f.ref || norm.startsWith(`${f.ref}/`) || norm.startsWith(`${f.ref}\\`),
      )
      .sort((a, b) => b.ref.length - a.ref.length)[0] ?? null
  )
}

/** Same section? (sidebar `aria-current`). */
export function sameSection(a: HomeSection, b: HomeSection): boolean {
  if (a.kind !== b.kind) return false
  return a.kind !== "folder" || (b.kind === "folder" && a.ref === b.ref)
}

/** All files (desktop): recents plus every watched folder's scan, deduped by path, newest first. */
export function mergeFiles(...lists: readonly (readonly RecentFile[])[]): RecentFile[] {
  const byRef = new Map<string, RecentFile>()
  for (const list of lists)
    for (const f of list) {
      const cur = byRef.get(f.ref)
      // Keep the entry that knows when the file was opened (the recents one).
      if (!cur || (cur.openedAt === null && f.openedAt !== null)) byRef.set(f.ref, f)
    }
  return [...byRef.values()].sort((a, b) => b.modifiedAt - a.modifiedAt)
}

/** Files whose name contains the query (case-insensitive). */
export function searchFiles<T extends { name: string }>(files: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  return q ? files.filter((f) => f.name.toLowerCase().includes(q)) : [...files]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Files Header title: "24 files", "5 templates", "3 libraries". */
export const countLabel = (n: number, one = "file", many?: string) => plural(n, one, many)

/** Files Header note of a file list section (board 37 §1). */
export function filesNote(section: HomeSection["kind"], folderCount: number): string {
  if (section === "all")
    return `in ${plural(folderCount, "folder")} and Recents · sorted by modified`
  if (section === "folder") return "in this folder and its subfolders · sorted by modified"
  return `from ${plural(folderCount, "folder")} on disk · sorted by modified`
}

/** `home.kimo` → `home` (`.kimo` / `.kimoz`). */
export const stemOf = (name: string) => name.replace(/\.kimoz?$/i, "")
/** `home.kimo` → `.kimo`. */
export const extOf = (name: string) => /\.kimoz?$/i.exec(name)?.[0] ?? ""

/** `landing.kimo`, then `landing 2.kimo`, `landing 3.kimo`… (board 37 §2 "a taken name"). */
export function numberedName(name: string, taken: (name: string) => boolean): string {
  const stem = stemOf(name)
  const ext = extOf(name)
  for (let n = 1; n < 10_000; n++) {
    const next = n === 1 ? name : `${stem} ${n}${ext}`
    if (!taken(next)) return next
  }
  return `${stem} ${Date.now()}${ext}`
}

/** Duplicate's name: `home copy.kimo`, then `home copy 2.kimo` (rules "File menu"). */
export function copyName(name: string, taken: (name: string) => boolean): string {
  return numberedName(`${stemOf(name)} copy${extOf(name)}`, taken)
}

/** `dir` + `name` with the folder's separator. */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/"
  return `${dir.replace(/[\\/]+$/, "")}${sep}${name}`
}

/** Resolves an `imports` path (relative to the importing file) to an absolute ref. */
export function resolveImport(fromRef: string, path: string): string {
  if (/^([A-Za-z]:)?[\\/]/.test(path)) return path
  const parts = dirnameOf(fromRef).split(/[\\/]/)
  for (const seg of path.split(/[\\/]/)) {
    if (seg === "." || seg === "") continue
    if (seg === "..") parts.pop()
    else parts.push(seg)
  }
  return parts.join("/")
}

/** What Design systems needs to know of one file (board 37 §4, rules "Design systems"). */
export interface LibraryProbe {
  ref: string
  name: string
  /** `meta.library === true`. */
  library: boolean
  components: number
  /** `imports` values (relative paths). */
  imports: string[]
}

/** Reads a `.kimo` file's text into a {@link LibraryProbe}; null when it isn't a document. */
export function probeDocument(ref: string, text: string): LibraryProbe | null {
  let doc: { meta?: { library?: unknown }; imports?: unknown; nodes?: unknown }
  try {
    doc = JSON.parse(text)
  } catch {
    return null
  }
  if (!doc || typeof doc !== "object" || !doc.nodes || typeof doc.nodes !== "object") return null
  const imports =
    doc.imports && typeof doc.imports === "object"
      ? Object.values(doc.imports as Record<string, unknown>).filter(
          (v): v is string => typeof v === "string",
        )
      : []
  return {
    ref,
    name: basenameOf(ref),
    library: doc.meta?.library === true,
    components: localComponents({ nodes: doc.nodes as Record<string, never> }).length,
    imports,
  }
}

export interface LibraryEntry {
  ref: string
  name: string
  components: number
  usedBy: number
}

/**
 * Libraries among the known files: `meta.library` (a UI kit made to be imported) or imported by
 * another known file. A file with its own local components isn't a library (every template has
 * some). Sorted by name.
 */
export function libraryIndex(probes: readonly LibraryProbe[]): LibraryEntry[] {
  const usedBy = new Map<string, Set<string>>()
  for (const p of probes)
    for (const path of p.imports) {
      const target = resolveImport(p.ref, path)
      if (target === p.ref) continue
      const set = usedBy.get(target) ?? new Set<string>()
      usedBy.set(target, set)
      set.add(p.ref)
    }
  return probes
    .filter((p) => p.library || (usedBy.get(p.ref)?.size ?? 0) > 0)
    .map((p) => ({
      ref: p.ref,
      name: p.name,
      components: p.components,
      usedBy: usedBy.get(p.ref)?.size ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Card info: "12 components · used by 2 files". `usedBy` null means Kimo can't tell which files
 * import it (B4, web): the card shows the component count only.
 */
export function libraryInfo(e: { components: number; usedBy: number | null }): string {
  const components = plural(e.components, "component")
  return e.usedBy == null ? components : `${components} · used by ${plural(e.usedBy, "file")}`
}

const DAY = 24 * 60 * 60 * 1000

/** Web Trash "DELETED FOR GOOD IN" column: "30 days", "1 day" (never below 1). */
export function daysLeft(trashedAt: number, now: number, retentionMs = 30 * DAY): string {
  const full = Math.ceil(retentionMs / DAY)
  const left = Math.min(full, Math.max(1, Math.ceil((trashedAt + retentionMs - now) / DAY)))
  return plural(left, "day")
}

/** The cause sentence of a failure (rules "Errors": "Couldn't <verb> <object>" then the cause). */
export function causeOf(e: unknown, existing?: string): string {
  const code = (e as Partial<PlatformError> | null)?.code
  if (code === "PERMISSION") return "Permission denied."
  if (code === "NOT_FOUND") return "It was moved or deleted."
  if (code === "EXISTS")
    return existing ? `${existing} already exists.` : "A file with that name exists."
  if (code === "DISK_FULL") return "The disk is full."
  const msg = e instanceof Error ? e.message : String(e ?? "")
  if (!msg) return "Try again."
  return /[.!?]$/.test(msg) ? msg : `${msg}.`
}

/** "Couldn't move home.kimo to the Trash. Permission denied." */
export function failure(action: string, e: unknown, existing?: string): string {
  return `Couldn't ${action}. ${causeOf(e, existing)}`
}

/** True when the error is a platform `EXISTS`. */
export const isExists = (e: unknown) => (e as Partial<PlatformError> | null)?.code === "EXISTS"
