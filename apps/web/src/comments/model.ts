/**
 * Comment view model (docs/spec/comments.md §2, §6, §7): thread rows for the canvas and the
 * panel, anchor math, read state and the panel's per-file choices. No React here.
 */
import {
  type CommentAnchor,
  type CommentAuthor,
  type CommentMessage,
  type CommentThread,
  listPages,
  numberedThreads,
  pageOfRoot,
  threadMessages,
} from "@kimo/core-schema"
import type { DocStore } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"
import { presenceColorAt } from "../multiplayer/presence"
import { plainText } from "./text"

export interface ThreadRow {
  id: string
  /** Display number (#12): by the first message's time, then id. */
  number: number
  thread: CommentThread
  first: CommentMessage
  messages: { id: string; message: CommentMessage }[]
  /** Page id of the pin, null for a file without pages. */
  page: string | null
  /** Its node is gone: the pin shows at `fallback`. */
  detached: boolean
  area: boolean
  /** Name of the anchoring top-level node. */
  nodeName: string | null
  unread: boolean
}

type DocLike = Parameters<typeof listPages>[0]

/** The page a thread's pin is on (§2: an absent page is the first page). */
export function threadPage(store: DocStore, doc: DocLike, a: CommentAnchor): string | null {
  if (a.page) return a.page
  if (a.node) {
    const n = store.getNode(a.node) as Parameters<typeof pageOfRoot>[1]
    if (n) return pageOfRoot(doc, n)
  }
  return listPages(doc)[0]?.id ?? null
}

/** All threads as rows, in display-number order. */
export function threadRows(store: DocStore, me: string | null, read: ReadState): ThreadRow[] {
  const comments = store.comments?.toJSON() ?? undefined
  const doc = store.toHeader() as DocLike
  return numberedThreads(comments).map(({ id, thread, number }) => {
    const messages = threadMessages(thread)
    const a = thread.anchor
    const node = a.node ? (store.getNode(a.node) as { name?: unknown } | undefined) : undefined
    return {
      id,
      number,
      thread,
      first: (messages[0] as { message: CommentMessage }).message,
      messages,
      page: threadPage(store, doc, a),
      detached: !!a.node && !node,
      area: a.w !== undefined && a.h !== undefined,
      nodeName: typeof node?.name === "string" && node.name ? node.name : null,
      unread: read.unread(id, messages, me),
    }
  })
}

/** World position of a thread's pin (an area's top-left corner). */
export function anchorWorld(
  a: CommentAnchor,
  layout: LayoutResult | null,
): { x: number; y: number } {
  if (a.node) {
    const box = layout?.nodes.get(a.node)?.world
    if (box) return { x: box.x + a.x, y: box.y + a.y }
    return a.fallback ?? { x: 0, y: 0 }
  }
  return { x: a.x, y: a.y }
}

/**
 * The anchor for a pin or area placed at world `at` on `page` (§2): `node` is the topmost
 * top-level frame or group of the page under the point, else none.
 */
export function anchorAt(
  at: { x: number; y: number; w?: number; h?: number },
  roots: readonly string[],
  store: DocStore,
  layout: LayoutResult | null,
  page: string | null,
): CommentAnchor {
  const size = at.w !== undefined && at.h !== undefined ? { w: at.w, h: at.h } : {}
  const onPage = page !== null ? { page } : {}
  for (let i = roots.length - 1; i >= 0; i--) {
    const id = roots[i] as string
    const type = store.getNode(id)?.type
    if (type !== "frame" && type !== "group") continue
    const box = layout?.nodes.get(id)?.world
    if (!box) continue
    if (at.x < box.x || at.y < box.y || at.x > box.x + box.w || at.y > box.y + box.h) continue
    return {
      ...onPage,
      node: id,
      x: at.x - box.x,
      y: at.y - box.y,
      ...size,
      fallback: { x: at.x, y: at.y },
    }
  }
  return { ...onPage, x: at.x, y: at.y, ...size }
}

/** A presence color token for an author (stable per id). */
export function authorColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return presenceColorAt(Math.abs(h))
}

/** Up to two initials of a name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? "?"
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""
  return (first + second).toUpperCase()
}

/** True when `row` matches the search text (message text and author names, §7). */
export function matchesSearch(row: ThreadRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return row.messages.some(
    ({ message }) =>
      message.author.name.toLowerCase().includes(q) ||
      plainText(message.text).toLowerCase().includes(q),
  )
}

// --- Read state (§6) ----------------------------------------------------------------------------

/**
 * Per device, outside the file: thread id to the ids of the messages seen, in localStorage
 * `kimo.comments.read.<fileKey>`. A thread is unread when someone else's message is not listed.
 */
export class ReadState {
  private seen: Record<string, string[]>
  private listeners = new Set<() => void>()
  private rev = 0

  constructor(
    readonly fileKey: string,
    private storage: Pick<Storage, "getItem" | "setItem"> | null = globalThis.localStorage ?? null,
  ) {
    this.seen = this.load()
  }

  private get key() {
    return `kimo.comments.read.${this.fileKey}`
  }

  private load(): Record<string, string[]> {
    try {
      const raw = this.storage?.getItem(this.key)
      const v = raw ? (JSON.parse(raw) as unknown) : null
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string[]>) : {}
    } catch {
      return {}
    }
  }

  private save() {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.seen))
    } catch {
      // A full or blocked storage only loses read marks.
    }
    this.rev++
    for (const l of [...this.listeners]) l()
  }

  revision = () => this.rev

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }

  unread(
    thread: string,
    messages: readonly { id: string; message: CommentMessage }[],
    me: string | null,
  ): boolean {
    const seen = this.seen[thread]
    return messages.some(({ id, message }) => message.author.id !== me && !seen?.includes(id))
  }

  markRead(thread: string, messages: readonly { id: string }[]) {
    const ids = messages.map((m) => m.id)
    const prev = this.seen[thread]
    if (prev && ids.every((id) => prev.includes(id))) return
    this.seen = { ...this.seen, [thread]: ids }
    this.save()
  }

  markUnread(thread: string) {
    if (!(thread in this.seen)) return
    const { [thread]: _, ...rest } = this.seen
    this.seen = rest
    this.save()
  }

  markAll(rows: readonly { id: string; messages: readonly { id: string }[] }[]) {
    const next: Record<string, string[]> = {}
    for (const r of rows) next[r.id] = r.messages.map((m) => m.id)
    this.seen = next
    this.save()
  }
}

// --- Panel choices (§7) ---------------------------------------------------------------------------

export interface CommentPrefs {
  sort: "date" | "unread"
  scope: "page" | "all"
  mine: boolean
  resolved: boolean
  /** ⇧C: pins hidden. */
  hidden: boolean
}

export const DEFAULT_PREFS: CommentPrefs = {
  sort: "date",
  scope: "page",
  mine: false,
  resolved: false,
  hidden: false,
}

export function loadPrefs(fileKey: string): CommentPrefs {
  try {
    const raw = globalThis.localStorage?.getItem(`kimo.comments.prefs.${fileKey}`)
    const v = raw ? (JSON.parse(raw) as Partial<CommentPrefs>) : {}
    return {
      sort: v.sort === "unread" ? "unread" : "date",
      scope: v.scope === "all" ? "all" : "page",
      mine: v.mine === true,
      resolved: v.resolved === true,
      hidden: v.hidden === true,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function savePrefs(fileKey: string, prefs: CommentPrefs): void {
  try {
    globalThis.localStorage?.setItem(`kimo.comments.prefs.${fileKey}`, JSON.stringify(prefs))
  } catch {
    // Choices stay for this session only.
  }
}

/** The panel's list: filtered, searched and sorted (§7). */
export function panelRows(
  rows: readonly ThreadRow[],
  prefs: CommentPrefs,
  page: string | null,
  me: string | null,
  query: string,
): ThreadRow[] {
  const list = rows.filter(
    (r) =>
      (prefs.resolved || !r.thread.resolved) &&
      (prefs.scope === "all" || r.page === page) &&
      (!prefs.mine || r.messages.some((m) => m.message.author.id === me)) &&
      matchesSearch(r, query),
  )
  const last = (r: ThreadRow) => r.messages[r.messages.length - 1]?.message.at ?? ""
  return list.sort(
    (a, b) =>
      (prefs.sort === "unread" ? Number(b.unread) - Number(a.unread) : 0) ||
      (last(b) < last(a) ? -1 : last(b) > last(a) ? 1 : 0),
  )
}

/** The author for this person on this device. */
export function personAuthor(devicePub: string, name: string): CommentAuthor {
  const n = name.trim().slice(0, 64) || "Guest"
  return { id: `dev:${devicePub}`, name: n, kind: "person" }
}
