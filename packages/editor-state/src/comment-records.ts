/**
 * Comment changes (docs/spec/comments.md §4.1) and their fold (§4.3). Pure and synchronous:
 * signatures are checked by the sync layer before a record reaches {@link CommentFold}, which
 * then enforces who may do what from the record's signing key.
 */
import {
  COMMENT_ATTACHMENT_MIMES,
  COMMENT_ATTACHMENTS_MAX,
  COMMENT_TEXT_MAX,
  type CommentAnchor,
  type CommentAttachment,
  type CommentAuthor,
  type CommentMessage,
  type Comments,
  type CommentThread,
  codePointLength,
  ID_PATTERN,
  isObject,
} from "@kimo/core-schema"

export const COMMENT_RECORD_VERSION = 1
/** Longest change body in UTF-8 bytes (spec §4.1). */
export const COMMENT_RECORD_MAX_BYTES = 32 * 1024
/** Changes per log entry; positions are `seq * COMMENT_ENTRY_SLOTS + index` (spec §4.3). */
export const COMMENT_ENTRY_SLOTS = 256
/** Signing key of records written on a local file (no room, no signature). */
export const LOCAL_KEY = "local"

export type CommentOp =
  | {
      op: "thread"
      thread: string
      message: string
      anchor: CommentAnchor
      author: CommentAuthor
      text: string
      attachments?: CommentAttachment[]
    }
  | {
      op: "reply"
      thread: string
      message: string
      author: CommentAuthor
      text: string
      attachments?: CommentAttachment[]
    }
  | { op: "edit"; thread: string; message: string; text: string }
  | { op: "delete"; thread: string; message?: string }
  | { op: "resolve"; thread: string; by: CommentAuthor | null }
  | { op: "anchor"; thread: string; anchor: CommentAnchor }
  | { op: "react"; thread: string; message: string; emoji: string; author: string; on: boolean }
  | { op: "import"; thread: string; data: CommentThread }

/** A change body (the signed bytes are its canonical JSON). */
export type CommentRecordBody = {
  v: 1
  id: string
  /** Per key, strictly increasing. */
  n: number
  /** Highest position the writer had applied. */
  base: number
  at: string
} & CommentOp

/** A change as the fold holds it. */
export interface CommentRecord {
  body: CommentRecordBody
  /** Signing key, base64url (43 characters), or {@link LOCAL_KEY}. */
  key: string
  /** Log position; null while a local change is not acknowledged. */
  pos: number | null
}

// --- Parsing ----------------------------------------------------------------------------------

const ID_RE = new RegExp(ID_PATTERN)
const AUTHOR_ID_RE = /^(?:acct|dev|agent):[^\s]{1,128}$/
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const SHA_RE = /^[0-9a-f]{64}$/
const MAX_EMOJI = 32

const isId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v)
const isUintValue = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

export function isCommentAuthor(v: unknown): v is CommentAuthor {
  if (!isObject(v)) return false
  const name = v.name
  return (
    typeof v.id === "string" &&
    AUTHOR_ID_RE.test(v.id) &&
    typeof name === "string" &&
    name.trim() !== "" &&
    codePointLength(name) <= 64 &&
    (v.kind === "person" || v.kind === "agent")
  )
}

export function isCommentAnchor(v: unknown): v is CommentAnchor {
  if (!isObject(v) || !finite(v.x) || !finite(v.y)) return false
  if ((v.w === undefined) !== (v.h === undefined)) return false
  if (v.w !== undefined && (!finite(v.w) || v.w <= 0 || !finite(v.h) || (v.h as number) <= 0))
    return false
  if (v.node !== undefined && !isId(v.node)) return false
  if (v.page !== undefined && !isId(v.page)) return false
  if (v.fallback !== undefined) {
    const f = v.fallback
    if (!isObject(f) || !finite(f.x) || !finite(f.y)) return false
  }
  return true
}

export function isCommentText(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "" && codePointLength(v) <= COMMENT_TEXT_MAX
}

function isAttachments(v: unknown): v is CommentAttachment[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > COMMENT_ATTACHMENTS_MAX) return false
  return v.every(
    (a) =>
      isObject(a) &&
      typeof a.file === "string" &&
      a.file.length <= 200 &&
      (COMMENT_ATTACHMENT_MIMES as readonly string[]).includes(a.mime as string) &&
      typeof a.sha256 === "string" &&
      SHA_RE.test(a.sha256) &&
      (a.width === undefined || isUintValue(a.width)) &&
      (a.height === undefined || isUintValue(a.height)),
  )
}

export function isEmoji(v: unknown): v is string {
  return typeof v === "string" && v !== "" && !/\s/.test(v) && [...v].length <= MAX_EMOJI
}

function isMessage(v: unknown): v is CommentMessage {
  if (!isObject(v) || !isCommentAuthor(v.author) || typeof v.at !== "string") return false
  if (!TIME_RE.test(v.at) || !isCommentText(v.text)) return false
  if (v.edited !== undefined && (typeof v.edited !== "string" || !TIME_RE.test(v.edited)))
    return false
  if (v.attachments !== undefined && !isAttachments(v.attachments)) return false
  if (v.reactions !== undefined) {
    if (!isObject(v.reactions)) return false
    for (const [e, ids] of Object.entries(v.reactions)) {
      if (!isEmoji(e) || !Array.isArray(ids) || ids.length === 0) return false
      if (!ids.every((id) => typeof id === "string" && AUTHOR_ID_RE.test(id))) return false
    }
  }
  return true
}

function isThread(v: unknown): v is CommentThread {
  if (!isObject(v) || !isCommentAnchor(v.anchor) || !isId(v.first)) return false
  if (!isObject(v.messages)) return false
  const ids = Object.keys(v.messages)
  if (ids.length === 0 || ids.length > 10_000 || !Object.hasOwn(v.messages, v.first)) return false
  if (!ids.every((id) => isId(id) && isMessage((v.messages as Record<string, unknown>)[id])))
    return false
  if (v.resolved !== undefined) {
    const r = v.resolved
    if (!isObject(r) || !isCommentAuthor(r.by) || typeof r.at !== "string") return false
  }
  return true
}

/** A change body from parsed JSON, or null when it is malformed (spec §4.1). */
export function parseCommentRecordBody(v: unknown): CommentRecordBody | null {
  if (!isObject(v) || v.v !== COMMENT_RECORD_VERSION) return null
  if (!isId(v.id) || !isUintValue(v.n) || !isUintValue(v.base)) return null
  if (typeof v.at !== "string" || !TIME_RE.test(v.at)) return null
  if (!isId(v.thread)) return null
  const ok = (() => {
    switch (v.op) {
      case "thread":
        return (
          isId(v.message) &&
          v.message !== v.thread &&
          isCommentAnchor(v.anchor) &&
          isCommentAuthor(v.author) &&
          isCommentText(v.text) &&
          (v.attachments === undefined || isAttachments(v.attachments))
        )
      case "reply":
        return (
          isId(v.message) &&
          isCommentAuthor(v.author) &&
          isCommentText(v.text) &&
          (v.attachments === undefined || isAttachments(v.attachments))
        )
      case "edit":
        return isId(v.message) && isCommentText(v.text)
      case "delete":
        return v.message === undefined || isId(v.message)
      case "resolve":
        return v.by === null || isCommentAuthor(v.by)
      case "anchor":
        return isCommentAnchor(v.anchor)
      case "react":
        return (
          isId(v.message) &&
          isEmoji(v.emoji) &&
          typeof v.author === "string" &&
          AUTHOR_ID_RE.test(v.author) &&
          typeof v.on === "boolean"
        )
      case "import":
        return isThread(v.data)
      default:
        return false
    }
  })()
  return ok ? (v as unknown as CommentRecordBody) : null
}

// --- Fold -------------------------------------------------------------------------------------

/** Who set a last-writer value (spec §4.3). */
interface Setter {
  pos: number
  key: string
  n: number
}

interface ReactionState {
  emoji: string
  author: string
  on: boolean
  by: Setter
}

interface MessageState {
  author: CommentAuthor
  at: string
  text: string
  edited?: string
  attachments?: CommentAttachment[]
  /** Owner key (spec §4.1); null for messages a local file brought. */
  owner: string | null
  textBy: Setter | null
  /** `emoji\0key` → reaction. */
  reactions: Map<string, ReactionState>
  /** Change that created it (re-append). */
  created: string | null
}

interface ThreadState {
  anchor: CommentAnchor
  anchorBy: Setter | null
  first: string
  resolved: CommentThread["resolved"] | null
  resolvedBy: Setter | null
  messages: Map<string, MessageState>
}

/** Pending local changes sort after every acknowledged one. */
const PENDING_POS = Number.MAX_SAFE_INTEGER

function replaces(c: Setter, base: number, s: Setter | null): boolean {
  if (!s) return true
  return base >= s.pos || (c.key === s.key && c.n > s.n)
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** The key of a `dev:` author id, or null. */
export function devKeyOf(authorId: string): string | null {
  return authorId.startsWith("dev:") ? authorId.slice(4) : null
}

export interface FoldContext {
  /** Room root key (base64url): acts as the owner. Null on a local file. */
  root: string | null
  /** Ids that are taken by nodes (never reused for comments). */
  nodeIds?: (id: string) => boolean
}

/**
 * State built from changes in position order. Records with key {@link LOCAL_KEY} are trusted
 * (local files: the editor checked authorship by author id).
 */
export class CommentFold {
  readonly threads = new Map<string, ThreadState>()
  /** Deleted thread and message ids. */
  readonly tombs = new Set<string>()
  /** Change ids applied or skipped. */
  readonly seen = new Set<string>()
  /** Every delete change, kept for compaction. */
  readonly deletes = new Map<string, CommentRecord>()
  /** Highest acknowledged position applied. */
  maxPos = 0
  /** Changes that hold something now, with how many things each holds. */
  private readonly holders = new Map<string, { rec: CommentRecord; refs: number }>()
  private readonly textHolder = new Map<string, string>()
  private readonly anchorHolder = new Map<string, string>()
  private readonly resolveHolder = new Map<string, string>()
  /** `messageId\0emoji\0reactor` → change id. */
  private readonly reactionHolder = new Map<string, string>()

  constructor(readonly ctx: FoldContext) {}

  copy(): CommentFold {
    const f = new CommentFold(this.ctx)
    for (const [id, t] of this.threads)
      f.threads.set(id, {
        ...t,
        messages: new Map(
          [...t.messages].map(([mid, m]) => [mid, { ...m, reactions: new Map(m.reactions) }]),
        ),
      })
    for (const id of this.tombs) f.tombs.add(id)
    for (const id of this.seen) f.seen.add(id)
    for (const [k, v] of this.deletes) f.deletes.set(k, v)
    for (const [k, v] of this.holders) f.holders.set(k, { ...v })
    for (const [k, v] of this.textHolder) f.textHolder.set(k, v)
    for (const [k, v] of this.anchorHolder) f.anchorHolder.set(k, v)
    for (const [k, v] of this.resolveHolder) f.resolveHolder.set(k, v)
    for (const [k, v] of this.reactionHolder) f.reactionHolder.set(k, v)
    f.maxPos = this.maxPos
    return f
  }

  private ref(rec: CommentRecord): string {
    const h = this.holders.get(rec.body.id)
    if (h) h.refs++
    else this.holders.set(rec.body.id, { rec, refs: 1 })
    return rec.body.id
  }

  private unref(id: string | null | undefined): void {
    if (!id) return
    const h = this.holders.get(id)
    if (!h) return
    if (--h.refs <= 0) this.holders.delete(id)
  }

  private swap(map: Map<string, string>, slot: string, rec: CommentRecord): void {
    this.unref(map.get(slot))
    map.set(slot, this.ref(rec))
  }

  private taken(id: string): boolean {
    if (this.tombs.has(id) || this.threads.has(id)) return true
    for (const t of this.threads.values()) if (t.messages.has(id)) return true
    return this.ctx.nodeIds?.(id) ?? false
  }

  private isRoot(key: string): boolean {
    return this.ctx.root !== null && key === this.ctx.root
  }

  /** `dev:X` authors must be signed by X (spec §4.1). */
  private authorOk(key: string, authorId: string): boolean {
    if (key === LOCAL_KEY) return true
    const dev = devKeyOf(authorId)
    return dev === null || dev === key
  }

  /**
   * Applies one change. Returns the thread it changed, or null when it was skipped (a
   * duplicate, invalid or not allowed).
   */
  apply(rec: CommentRecord): string | null {
    const b = rec.body
    if (this.seen.has(b.id)) return null
    this.seen.add(b.id)
    if (rec.pos !== null) {
      this.maxPos = Math.max(this.maxPos, rec.pos)
      if (b.base >= rec.pos) return null
    }
    const setter: Setter = { pos: rec.pos ?? PENDING_POS, key: rec.key, n: b.n }
    return this.applyOp(rec, setter, rec.key === LOCAL_KEY)
  }

  private newMessage(
    rec: CommentRecord,
    m: Pick<CommentMessage, "author" | "at" | "text" | "edited" | "attachments">,
    owner: string | null,
  ): MessageState {
    return {
      author: clone(m.author),
      at: m.at,
      text: m.text,
      ...(m.edited ? { edited: m.edited } : {}),
      ...(m.attachments ? { attachments: clone(m.attachments) } : {}),
      owner,
      textBy: null,
      reactions: new Map(),
      created: this.ref(rec),
    }
  }

  private applyOp(rec: CommentRecord, setter: Setter, trusted: boolean): string | null {
    const b = rec.body
    const key = rec.key
    if (this.tombs.has(b.thread) && b.op !== "delete") return null
    const t = this.threads.get(b.thread)
    switch (b.op) {
      case "thread": {
        if (!this.authorOk(key, b.author.id)) return null
        if (this.taken(b.thread) || this.taken(b.message) || b.thread === b.message) return null
        const m = this.newMessage(rec, b, trusted ? null : key)
        this.threads.set(b.thread, {
          anchor: clone(b.anchor),
          anchorBy: setter,
          first: b.message,
          resolved: null,
          resolvedBy: null,
          messages: new Map([[b.message, m]]),
        })
        this.anchorHolder.set(b.thread, this.ref(rec))
        return b.thread
      }
      case "reply": {
        if (!t || !this.authorOk(key, b.author.id) || this.taken(b.message)) return null
        t.messages.set(b.message, this.newMessage(rec, b, trusted ? null : key))
        return b.thread
      }
      case "edit": {
        const m = t?.messages.get(b.message)
        if (!t || !m) return null
        if (!trusted && m.owner !== key) return null
        if (!replaces(setter, b.base, m.textBy)) return null
        m.text = b.text
        m.edited = b.at
        m.textBy = setter
        this.swap(this.textHolder, b.message, rec)
        return b.thread
      }
      case "delete": {
        const mid = b.message
        if (!t || mid === undefined || mid === t.first) {
          if (t) {
            const first = t.messages.get(t.first)
            if (!trusted && !this.isRoot(key) && first?.owner !== key) return null
            this.dropThread(b.thread, t)
          }
          this.tombs.add(b.thread)
          if (mid !== undefined) this.tombs.add(mid)
        } else {
          const m = t.messages.get(mid)
          if (m) {
            if (!trusted && !this.isRoot(key) && m.owner !== key) return null
            this.dropMessage(t, mid, m)
          }
          this.tombs.add(mid)
        }
        this.deletes.set(b.id, rec)
        return b.thread
      }
      case "resolve": {
        if (!t) return null
        if (b.by && !this.authorOk(key, b.by.id)) return null
        if (!replaces(setter, b.base, t.resolvedBy)) return null
        t.resolved = b.by ? { by: clone(b.by), at: b.at } : null
        t.resolvedBy = setter
        this.swap(this.resolveHolder, b.thread, rec)
        return b.thread
      }
      case "anchor": {
        if (!t) return null
        if (!replaces(setter, b.base, t.anchorBy)) return null
        t.anchor = clone(b.anchor)
        t.anchorBy = setter
        this.swap(this.anchorHolder, b.thread, rec)
        return b.thread
      }
      case "react": {
        const m = t?.messages.get(b.message)
        if (!t || !m || !this.authorOk(key, b.author)) return null
        const reactor = trusted ? `local:${b.author}` : key
        const rk = `${b.emoji}\0${reactor}`
        const cur = m.reactions.get(rk)
        if (!replaces(setter, b.base, cur?.by ?? null)) return null
        m.reactions.set(rk, { emoji: b.emoji, author: b.author, on: b.on, by: setter })
        this.swap(this.reactionHolder, `${b.message}\0${rk}`, rec)
        return b.thread
      }
      case "import": {
        if (!trusted && !this.isRoot(key)) return null
        const d = b.data
        const add = (thread: ThreadState, mid: string, m: CommentMessage): void => {
          const state = this.newMessage(rec, m, trusted ? null : (devKeyOf(m.author.id) ?? key))
          for (const [emoji, ids] of Object.entries(m.reactions ?? {}))
            for (const author of ids) {
              const reactor = trusted
                ? `local:${author}`
                : (devKeyOf(author) ?? `imported:${author}`)
              const rk = `${emoji}\0${reactor}`
              state.reactions.set(rk, { emoji, author, on: true, by: setter })
              this.reactionHolder.set(`${mid}\0${rk}`, this.ref(rec))
            }
          thread.messages.set(mid, state)
        }
        if (t) {
          let added = false
          for (const [mid, m] of Object.entries(d.messages)) {
            if (this.taken(mid)) continue
            add(t, mid, m)
            added = true
          }
          return added ? b.thread : null
        }
        if (this.taken(b.thread) || this.taken(d.first) || d.first === b.thread) return null
        const thread: ThreadState = {
          anchor: clone(d.anchor),
          anchorBy: setter,
          first: d.first,
          resolved: d.resolved ? clone(d.resolved) : null,
          resolvedBy: d.resolved ? setter : null,
          messages: new Map(),
        }
        this.threads.set(b.thread, thread)
        for (const [mid, m] of Object.entries(d.messages))
          if (mid === d.first || (!this.taken(mid) && mid !== b.thread)) add(thread, mid, m)
        this.anchorHolder.set(b.thread, this.ref(rec))
        if (d.resolved) this.resolveHolder.set(b.thread, this.ref(rec))
        return b.thread
      }
    }
  }

  private dropMessage(t: ThreadState, mid: string, m: MessageState): void {
    t.messages.delete(mid)
    this.unref(m.created)
    this.unref(this.textHolder.get(mid))
    this.textHolder.delete(mid)
    for (const [k, id] of [...this.reactionHolder])
      if (k.startsWith(`${mid}\0`)) {
        this.unref(id)
        this.reactionHolder.delete(k)
      }
  }

  private dropThread(id: string, t: ThreadState): void {
    for (const [mid, m] of [...t.messages]) {
      this.dropMessage(t, mid, m)
      this.tombs.add(mid)
    }
    this.threads.delete(id)
    this.unref(this.resolveHolder.get(id))
    this.unref(this.anchorHolder.get(id))
    this.resolveHolder.delete(id)
    this.anchorHolder.delete(id)
  }

  /** Owner key of a message (null: a local file's message, checked by author id). */
  ownerOf(threadId: string, messageId: string): string | null | undefined {
    return this.threads.get(threadId)?.messages.get(messageId)?.owner
  }

  /** The plain projection (the file's `comments`). */
  project(): Comments {
    const out: Comments = {}
    for (const id of [...this.threads.keys()].sort()) {
      const t = this.threads.get(id) as ThreadState
      if (!t.messages.has(t.first)) continue
      const messages: Record<string, CommentMessage> = {}
      for (const mid of [...t.messages.keys()].sort()) {
        const m = t.messages.get(mid) as MessageState
        const msg: CommentMessage = { author: clone(m.author), at: m.at, text: m.text }
        if (m.edited) msg.edited = m.edited
        if (m.attachments) msg.attachments = clone(m.attachments)
        const reactions: Record<string, Set<string>> = {}
        for (const r of m.reactions.values()) {
          if (!r.on) continue
          const set = reactions[r.emoji] ?? new Set<string>()
          set.add(r.author)
          reactions[r.emoji] = set
        }
        const emojis = Object.keys(reactions).sort()
        if (emojis.length > 0)
          msg.reactions = Object.fromEntries(
            emojis.map((e) => [e, [...(reactions[e] as Set<string>)].sort()]),
          )
        messages[mid] = msg
      }
      const thread: CommentThread = { anchor: clone(t.anchor), first: t.first, messages }
      if (t.resolved) thread.resolved = clone(t.resolved)
      out[id] = thread
    }
    return out
  }

  /**
   * The acknowledged changes a snapshot keeps (spec §4.4 Compaction), in position order:
   * tombstones, creating changes of live messages and the holders of current values.
   */
  kept(): CommentRecord[] {
    const out = new Map<string, CommentRecord>()
    for (const [id, r] of this.deletes) out.set(id, r)
    for (const [id, h] of this.holders) out.set(id, h.rec)
    return [...out.values()]
      .filter((r) => r.pos !== null)
      .sort((a, b) => (a.pos as number) - (b.pos as number))
  }

  /** Changes that hold something now (re-append candidates), acknowledged or not. */
  live(): CommentRecord[] {
    return [...this.holders.values()].map((h) => h.rec)
  }
}
