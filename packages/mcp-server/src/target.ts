/**
 * Which file and frame an agent means (#78). Kimo resolves the target from pointers, newest
 * first, and asks only when two or more candidates are left at the level the agent needs.
 *
 * 1. Named: the agent passes `docId` (always wins).
 * 2. Person selection: a non-empty selection the person made in the front tab (or after they
 *    last switched tabs; a selection left in a tab they moved away from is stale).
 * 3. The agent's own last target: its last landed edit, kimo_open / kimo_create, or a pick.
 * 4. Front tab: the editor tab the person used last; at frame level, the one frame in its view.
 * 5. Only candidate: one open file, one visible top-level frame, or none.
 *
 * A person's selection beats older agent work; the agent's work beats an older front tab. The
 * one conflict that asks: after the agent's last target the person moved to another file, or
 * scrolled every agent frame out of view, and selected nothing. A front tab showing a file the
 * host does not serve is never resolved to a local file with the same name.
 *
 * Pure: the handler gathers the signals (`TargetSignals`), this decides.
 */
import type { WindowView } from "./runtime"

export type TargetNeed = "file" | "frame"
export type TargetVia =
  | "given"
  | "selection"
  | "recent"
  | "window"
  | "view"
  | "only"
  | "empty"
  | "picked"
  | "selected-in-kimo"
export type UnclearReason = "conflict" | "no-signal" | "not-visible"

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** A visible top-level frame, group or instance (the only nodes that can be a target frame). */
export interface FrameSignal {
  id: string
  name?: string
  /** Page id; null for the implicit page of a document without pages. */
  page: string | null
  bounds?: Rect
}

export interface DocSignal {
  docId: string
  name: string
  path: string
  /** A room joined from a share link (#79), not a file of this device. */
  shared: boolean
  /** Pages in display order (one `{id: null}` page when the document has none). */
  pages: { id: string | null; name: string }[]
  /** Candidate frames in document order, every page. */
  frames: FrameSignal[]
  /** Top-level ancestor of a node (itself when top-level); null when it does not exist. */
  top(id: string): string | null
}

/** This connection's last target: a landed edit, kimo_open / kimo_create, or a pick. */
export interface LastTarget {
  docId: string
  frameIds: string[]
  at: number
}

export interface TargetSignals {
  docs: DocSignal[]
  views: WindowView[]
  last?: LastTarget
}

export type TargetResult =
  | { status: "clear"; docId: string; frameIds: string[]; via: TargetVia }
  | { status: "none" }
  | {
      status: "unclear"
      level: TargetNeed
      reason: UnclearReason
      /** File level: the candidate files (the pair on `conflict`). Frame level: the one file. */
      docIds: string[]
    }

// --- Views -------------------------------------------------------------------------------------

const live = (views: readonly WindowView[]) => views.filter((v) => v.active && v.kind !== "none")

/** The editor tab the person used last (Home and Settings tabs are not editor tabs). */
export function frontView(views: readonly WindowView[]): WindowView | undefined {
  let best: WindowView | undefined
  for (const v of live(views)) if (!best || v.attentionAt > best.attentionAt) best = v
  return best
}

/**
 * The newest non-empty person selection among active tabs (of `docId` when given) that still
 * counts: in the `front` tab, or made after the person last switched to it.
 */
function newestSelection(
  views: readonly WindowView[],
  front: WindowView | undefined,
  docId?: string,
): WindowView | undefined {
  let best: WindowView | undefined
  for (const v of live(views)) {
    if (v.selectionBy !== "person" || v.selection.length === 0) continue
    if (docId !== undefined && v.docId !== docId) continue
    if (front && v.window !== front.window && v.selectionAt <= front.attentionAt) continue
    if (!best || v.selectionAt > best.selectionAt) best = v
  }
  return best
}

/** The tab showing `docId` the person used last. */
export function frontViewOf(views: readonly WindowView[], docId: string): WindowView | undefined {
  return frontView(views.filter((v) => v.docId === docId))
}

/** The page a view shows (its page, else the document's first). */
export function pageOf(doc: DocSignal, view: WindowView): string | null {
  if (view.page !== null && doc.pages.some((p) => p.id === view.page)) return view.page
  return doc.pages[0]?.id ?? null
}

/** True when the frame is on the view's page and its box meets the view rectangle. */
export function inView(doc: DocSignal, frame: FrameSignal, view: WindowView): boolean {
  const r = view.view
  const b = frame.bounds
  if (!r || !b || frame.page !== pageOf(doc, view)) return false
  return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y
}

/** The frames a person can be pointing at in `doc`: the front tab's page, else all of them. */
export function shownFrames(doc: DocSignal, views: readonly WindowView[]): FrameSignal[] {
  const f = frontViewOf(views, doc.docId)
  if (!f) return doc.frames
  const page = pageOf(doc, f)
  return doc.frames.filter((x) => x.page === page)
}

// --- Resolver ----------------------------------------------------------------------------------

type FileResult =
  | { status: "clear"; docId: string; via: TargetVia }
  | Exclude<TargetResult, { status: "clear" }>

function resolveFile(s: TargetSignals, docId?: string): FileResult {
  if (docId !== undefined) return { status: "clear", docId, via: "given" }
  const served = new Set(s.docs.map((d) => d.docId))
  if (served.size === 0) return { status: "none" }
  const all = [...served]
  const a = s.last && served.has(s.last.docId) ? s.last : undefined
  const front = frontView(s.views)
  const sel = newestSelection(s.views, front)
  if (sel && (!a || sel.selectionAt > a.at)) {
    if (sel.docId !== null && served.has(sel.docId))
      return { status: "clear", docId: sel.docId, via: "selection" }
    return { status: "unclear", level: "file", reason: "not-visible", docIds: [] }
  }
  if (a) {
    if (front && front.attentionAt > a.at && front.docId !== a.docId) {
      if (front.docId !== null && served.has(front.docId))
        return {
          status: "unclear",
          level: "file",
          reason: "conflict",
          docIds: [front.docId, a.docId],
        }
      return { status: "unclear", level: "file", reason: "not-visible", docIds: [] }
    }
    return { status: "clear", docId: a.docId, via: "recent" }
  }
  if (front) {
    if (front.docId !== null && served.has(front.docId))
      return { status: "clear", docId: front.docId, via: "window" }
    return { status: "unclear", level: "file", reason: "not-visible", docIds: [] }
  }
  if (all.length === 1) return { status: "clear", docId: all[0] as string, via: "only" }
  return { status: "unclear", level: "file", reason: "no-signal", docIds: all }
}

function resolveFrame(s: TargetSignals, doc: DocSignal): TargetResult {
  const d = doc.docId
  const k = shownFrames(doc, s.views)
  const clear = (frameIds: string[], via: TargetVia): TargetResult => ({
    status: "clear",
    docId: d,
    frameIds,
    via,
  })
  if (k.length === 0) return clear([], "empty")
  const a = s.last?.docId === d ? s.last : undefined
  const sel = newestSelection(s.views, frontViewOf(s.views, d), d)
  if (sel && (!a || sel.selectionAt > a.at)) {
    const tops = unique(sel.selection.map((id) => doc.top(id)))
    if (tops.length) return clear(tops, "selection")
  }
  if (a) {
    const mine = a.frameIds.filter((id) => doc.top(id) === id)
    if (mine.length) {
      const frames = mine.map((id) => doc.frames.find((f) => f.id === id))
      const moved = live(s.views).some(
        (v) =>
          v.docId === d &&
          v.view !== null &&
          v.viewAt > a.at &&
          // Frames without a box (hidden, notes) never count as scrolled away.
          frames.every((f) => f !== undefined && f.bounds !== undefined && !inView(doc, f, v)),
      )
      if (moved) return { status: "unclear", level: "frame", reason: "conflict", docIds: [d] }
      return clear(mine, "recent")
    }
  }
  const front = frontViewOf(s.views, d)
  if (front) {
    const seen = k.filter((f) => inView(doc, f, front))
    if (seen.length === 1) return clear([(seen[0] as FrameSignal).id], "view")
  }
  if (k.length === 1) return clear([(k[0] as FrameSignal).id], "only")
  return { status: "unclear", level: "frame", reason: "no-signal", docIds: [d] }
}

/**
 * Resolves the target at the level the agent needs. `docId` (already checked open) is the
 * named file. File level returns `frameIds: []`.
 */
export function resolveTarget(s: TargetSignals, need: TargetNeed, docId?: string): TargetResult {
  const f = resolveFile(s, docId)
  if (f.status !== "clear") return f
  if (need === "file") return { status: "clear", docId: f.docId, frameIds: [], via: f.via }
  const doc = s.docs.find((x) => x.docId === f.docId)
  if (!doc) return { status: "clear", docId: f.docId, frameIds: [], via: f.via }
  return resolveFrame(s, doc)
}

function unique(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((x): x is string => typeof x === "string"))]
}

// --- Labels and choices ------------------------------------------------------------------------

/** "Homepage", "Homepage (shared)", "Homepage (local)", or "Homepage (Work)" between two local twins. */
export function fileLabel(doc: DocSignal, docs: readonly DocSignal[]): string {
  const key = normalizeName(doc.name)
  const twins = docs.filter((d) => d.docId !== doc.docId && normalizeName(d.name) === key)
  if (twins.length === 0) return doc.name
  if (doc.shared) {
    const n = twins.filter((t) => t.shared).length
    return n ? `${doc.name} (shared ${rank(doc, docs, true) + 1})` : `${doc.name} (shared)`
  }
  const local = twins.filter((t) => !t.shared)
  if (local.length === 0) return `${doc.name} (local)`
  const folder = folderOf(doc.path)
  const same = local.filter((t) => folderOf(t.path) === folder).length
  return same ? `${doc.name} (${folder} ${rank(doc, docs, false) + 1})` : `${doc.name} (${folder})`
}

function rank(doc: DocSignal, docs: readonly DocSignal[], shared: boolean): number {
  const key = normalizeName(doc.name)
  return docs
    .filter((d) => d.shared === shared && normalizeName(d.name) === key)
    .findIndex((d) => d.docId === doc.docId)
}

function folderOf(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/)
  return parts.at(-2) || parts.at(-1) || path
}

/** Names compared for twins: case, spacing and a `.kimo` suffix ignored. */
export function normalizeName(name: string): string {
  return name
    .replace(/\.kimo$/i, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
}

/**
 * The frames of `doc` a picker offers, in order: in the front view first, then the rest of
 * the shown page, then other pages. Labels: the layer name, `Hero (Mobile)` on another page,
 * `Hero (2)` for a repeat on the same page, `Unnamed frame` without a name.
 */
export function frameChoices(
  doc: DocSignal,
  views: readonly WindowView[],
): { id: string; label: string }[] {
  const front = frontViewOf(views, doc.docId)
  const page = front ? pageOf(doc, front) : (doc.pages[0]?.id ?? null)
  const onPage = doc.frames.filter((f) => f.page === page)
  const seen = front ? onPage.filter((f) => inView(doc, f, front)) : []
  const ordered = [
    ...seen,
    ...onPage.filter((f) => !seen.includes(f)),
    ...doc.frames.filter((f) => f.page !== page),
  ]
  const count = new Map<string, number>()
  return ordered.map((f) => {
    const name = f.name?.trim() || "Unnamed frame"
    const key = `${f.page ?? ""}\u0000${name}`
    const n = (count.get(key) ?? 0) + 1
    count.set(key, n)
    let label = n > 1 ? `${name} (${n})` : name
    if (f.page !== page)
      label = `${label} (${doc.pages.find((p) => p.id === f.page)?.name ?? "Page"})`
    return { id: f.id, label }
  })
}

/** Value of "I'll select it in Kimo" (`@` never starts a node id or a docId). */
export const SELECT_IN_KIMO = "@kimo"
export const MAX_CHOICES = 20
/** A frame need with this many candidate frames or fewer across the files: one combined list. */
export const COMBINED_MAX = 12

export type PickStep = "file" | "frame" | "combined"

export interface PickChoice {
  /** docId (file step), frame id (frame step) or `docId/frameId` (combined step). */
  value: string
  label: string
  docId: string
  frameId?: string
}

/** The one dialog step an unclear target needs, with its choices (without the Kimo option). */
export function choicesFor(
  s: TargetSignals,
  r: Extract<TargetResult, { status: "unclear" }>,
  need: TargetNeed,
): { step: PickStep; docId?: string; choices: PickChoice[] } {
  const byId = (id: string) => s.docs.find((d) => d.docId === id)
  if (r.level === "frame") {
    const doc = byId(r.docIds[0] as string)
    if (!doc) return { step: "frame", choices: [] }
    const choices = frameChoices(doc, s.views)
      .slice(0, MAX_CHOICES)
      .map((f) => ({ value: f.id, label: f.label, docId: doc.docId, frameId: f.id }))
    return { step: "frame", docId: doc.docId, choices }
  }
  const front = frontView(s.views)?.docId
  const docs = (r.docIds.length ? r.docIds : s.docs.map((d) => d.docId))
    .map(byId)
    .filter((d): d is DocSignal => d !== undefined)
    // The front tab's file first, then the order the host lists them.
    .sort((a, b) => Number(b.docId === front) - Number(a.docId === front))
  const frames = docs.map((d) => ({ doc: d, frames: frameChoices(d, s.views) }))
  const total = frames.reduce((n, x) => n + Math.max(1, x.frames.length), 0)
  if (need === "frame" && total <= COMBINED_MAX) {
    const choices: PickChoice[] = []
    for (const { doc, frames: fs } of frames) {
      const file = fileLabel(doc, s.docs)
      if (fs.length === 0) choices.push({ value: doc.docId, label: file, docId: doc.docId })
      for (const f of fs)
        choices.push({
          value: `${doc.docId}/${f.id}`,
          label: `${file}: ${f.label}`,
          docId: doc.docId,
          frameId: f.id,
        })
    }
    return { step: "combined", choices }
  }
  const choices = docs
    .slice(0, MAX_CHOICES)
    .map((d) => ({ value: d.docId, label: fileLabel(d, s.docs), docId: d.docId }))
  return { step: "file", choices }
}
