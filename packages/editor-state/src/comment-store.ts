/**
 * `CommentStore`: canvas comments as their own Yjs document (docs/spec/comments.md §4), next to
 * the design document of a `YjsDocStore`. Comments never enter the design undo stacks or the
 * design revision, and in a room they sync on their own channel.
 *
 * Shape: `threads`: Y.Map<threadId, Y.Map> with `anchor` (whole value), `first` (opening message
 * id), `resolved` (whole value) and `messages`: Y.Map<messageId, Y.Map> holding `author`, `at`,
 * `edited`, `attachments` (whole values), `text` (Y.Text, so concurrent edits merge by character)
 * and `reactions`: Y.Map<"<emoji> <authorId>", true>, made with the message, so concurrent
 * reactions are distinct keys and all survive (set semantics). The plain projection is the
 * file's `comments` member.
 */
import {
  COMMENT_ATTACHMENTS_MAX,
  COMMENT_TEXT_MAX,
  type CommentAnchor,
  type CommentAttachment,
  type CommentAuthor,
  type CommentMessage,
  type Comments,
  type CommentThread,
  codePointLength,
  commentTime,
  ID_PATTERN,
  jsonEqual,
} from "@kimo/core-schema"
import * as Y from "yjs"
import { generateId } from "./ids"
import type { Origin, RemoteOrigin } from "./origin"

/** Why a comment write was refused. */
export type CommentErrorCode = "NOT_FOUND" | "NOT_AUTHOR" | "INVALID" | "RATE_LIMITED" | "READ_ONLY"

export class CommentError extends Error {
  override readonly name = "CommentError"
  constructor(
    readonly code: CommentErrorCode,
    message: string,
  ) {
    super(message)
  }
}

/** Emitted once per transaction that changed comments. */
export interface CommentChange {
  origin: Origin
  /** Threads whose data changed (added, updated or removed). */
  threads: ReadonlySet<string>
  cause: "edit" | "load" | "update"
}

/** How {@link CommentStore.load} treats the threads already held. */
export type CommentLoadMode =
  /** The file is the truth: threads it lacks are deleted, changed ones rewritten. */
  | "replace"
  /** Only threads and messages missing here are added (a room replica meets a file). */
  | "add"
  /** The file's comments are ignored. */
  | "keep"

export interface NewMessage {
  author: CommentAuthor
  text: string
  attachments?: CommentAttachment[]
  /** Defaults to a new id. */
  id?: string
  /** Defaults to now. */
  at?: string
}

export interface CommentStoreOptions {
  now?: () => number
  /** New messages and replies per author per hour (spec §4). 0 = no limit. Default 100. */
  hourlyLimit?: number
}

const ID_RE = new RegExp(ID_PATTERN)
const HOUR = 3_600_000
const MAX_EMOJI_LENGTH = 32

type YThread = Y.Map<unknown>
type YMessage = Y.Map<unknown>

/** Reaction key: emoji and author id never contain whitespace. */
const reactionKey = (emoji: string, authorId: string) => `${emoji} ${authorId}`

const plainJson = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

function checkText(text: string): void {
  if (typeof text !== "string" || text.trim() === "")
    throw new CommentError("INVALID", "A message needs text")
  if (codePointLength(text) > COMMENT_TEXT_MAX)
    throw new CommentError("INVALID", `A message is at most ${COMMENT_TEXT_MAX} characters`)
}

function checkAnchor(a: CommentAnchor): void {
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)
  if (!a || !finite(a.x) || !finite(a.y)) throw new CommentError("INVALID", "Anchor needs x and y")
  if ((a.w === undefined) !== (a.h === undefined))
    throw new CommentError("INVALID", "An area needs both w and h")
  if (a.w !== undefined && (!finite(a.w) || a.w <= 0 || !finite(a.h) || a.h <= 0))
    throw new CommentError("INVALID", "An area needs a positive size")
  if (a.node !== undefined && !ID_RE.test(a.node))
    throw new CommentError("INVALID", "Bad anchor node")
  if (a.page !== undefined && !ID_RE.test(a.page))
    throw new CommentError("INVALID", "Bad anchor page")
}

function checkAttachments(list: CommentAttachment[] | undefined): void {
  if (list === undefined) return
  if (list.length === 0 || list.length > COMMENT_ATTACHMENTS_MAX)
    throw new CommentError("INVALID", `1 to ${COMMENT_ATTACHMENTS_MAX} images per message`)
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff

/** Replaces the content of `yt` by `next` with the smallest middle edit. */
function rewriteText(yt: Y.Text, next: string): void {
  const prev = yt.toString()
  if (prev === next) return
  let start = 0
  const max = Math.min(prev.length, next.length)
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++
  // Never split a surrogate pair.
  if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start--
  let endPrev = prev.length
  let endNext = next.length
  while (
    endPrev > start &&
    endNext > start &&
    prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)
  ) {
    endPrev--
    endNext--
  }
  if (endPrev > start) yt.delete(start, endPrev - start)
  if (endNext > start) yt.insert(start, next.slice(start, endNext))
}

export class CommentStore {
  /** The comment document (sync providers only; consumers use the methods). */
  readonly ydoc = new Y.Doc()
  private readonly yThreads: Y.Map<YThread>
  private readonly listeners = new Set<(c: CommentChange) => void>()
  private readonly updateListeners = new Set<(u: Uint8Array, origin: Origin) => void>()
  private readonly now: () => number
  private readonly hourlyLimit: number
  private readonly posted = new Map<string, number[]>()
  private pending = new Set<string>()
  private tx: { origin: Origin; cause: CommentChange["cause"] } | null = null
  private cache: Comments | null = null
  private _readOnly: string | null = null

  constructor(options: CommentStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.hourlyLimit = options.hourlyLimit ?? 100
    this.yThreads = this.ydoc.getMap("threads")
    this.yThreads.observeDeep((events) => {
      for (const e of events) {
        if (e.target === this.yThreads) {
          for (const k of (e as Y.YMapEvent<unknown>).keysChanged) this.pending.add(k)
        } else {
          const id = e.path[0]
          if (typeof id === "string") this.pending.add(id)
        }
      }
    })
    this.ydoc.on("afterTransaction", (tr: Y.Transaction) => {
      if (this.pending.size === 0) return
      const threads = this.pending
      this.pending = new Set()
      this.cache = null
      const origin: Origin =
        this.tx?.origin ?? (typeof tr.origin === "string" ? (tr.origin as Origin) : "remote")
      const change: CommentChange = { origin, threads, cause: this.tx?.cause ?? "update" }
      for (const l of [...this.listeners]) l(change)
    })
    this.ydoc.on("update", (update: Uint8Array, origin: unknown) => {
      if (this.updateListeners.size === 0) return
      const o = this.tx?.origin ?? (typeof origin === "string" ? (origin as Origin) : "remote")
      for (const l of [...this.updateListeners]) l(update, o)
    })
  }

  // --- Reading --------------------------------------------------------------------------------

  /** Number of threads. */
  get size(): number {
    return Object.keys(this.threads()).length
  }

  /** Every thread as plain data (cached until the next change; do not mutate). */
  threads(): Comments {
    if (!this.cache) {
      const out: Comments = {}
      for (const id of [...this.yThreads.keys()].sort()) {
        const t = this.readThread(this.yThreads.get(id))
        if (t) out[id] = t
      }
      this.cache = out
    }
    return this.cache
  }

  thread(id: string): CommentThread | undefined {
    const all = this.threads()
    return Object.hasOwn(all, id) ? all[id] : undefined
  }

  /** The file projection: undefined when there are no threads. */
  toJSON(): Comments | undefined {
    const t = this.threads()
    return Object.keys(t).length > 0 ? plainJson(t) : undefined
  }

  private readThread(y: YThread | undefined): CommentThread | undefined {
    if (!(y instanceof Y.Map)) return undefined
    const first = y.get("first")
    const anchor = y.get("anchor")
    const ym = y.get("messages")
    if (typeof first !== "string" || !anchor || !(ym instanceof Y.Map)) return undefined
    const messages: Record<string, CommentMessage> = {}
    for (const mid of [...ym.keys()].sort()) {
      const m = this.readMessage(ym.get(mid) as YMessage | undefined)
      if (m) messages[mid] = m
    }
    if (!Object.hasOwn(messages, first)) return undefined
    const out: CommentThread = { anchor: plainJson(anchor) as CommentAnchor, first, messages }
    const resolved = y.get("resolved")
    if (resolved) out.resolved = plainJson(resolved) as CommentThread["resolved"]
    return out
  }

  private readMessage(y: YMessage | undefined): CommentMessage | undefined {
    if (!(y instanceof Y.Map)) return undefined
    const author = y.get("author")
    const at = y.get("at")
    const yt = y.get("text")
    const text = yt instanceof Y.Text ? yt.toString() : typeof yt === "string" ? yt : ""
    if (!author || typeof at !== "string" || text === "") return undefined
    const m: CommentMessage = { author: plainJson(author) as CommentAuthor, at, text }
    const edited = y.get("edited")
    if (typeof edited === "string") m.edited = edited
    const attachments = y.get("attachments")
    if (Array.isArray(attachments) && attachments.length > 0)
      m.attachments = plainJson(attachments) as CommentAttachment[]
    const yr = y.get("reactions")
    if (yr instanceof Y.Map && yr.size > 0) {
      const reactions: Record<string, string[]> = {}
      for (const key of [...yr.keys()].sort()) {
        const space = key.indexOf(" ")
        if (space <= 0) continue
        const emoji = key.slice(0, space)
        const list = reactions[emoji] ?? []
        list.push(key.slice(space + 1))
        reactions[emoji] = list
      }
      for (const ids of Object.values(reactions)) ids.sort()
      if (Object.keys(reactions).length > 0) m.reactions = reactions
    }
    return m
  }

  // --- Writing --------------------------------------------------------------------------------

  /** Non-null while writes are refused (a read-only file or a view-only room). */
  get readOnly(): string | null {
    return this._readOnly
  }

  setReadOnly(reason: string | null): void {
    this._readOnly = reason
  }

  private write<T>(origin: Origin, fn: () => T, cause: CommentChange["cause"] = "edit"): T {
    if (cause === "edit" && this._readOnly !== null)
      throw new CommentError("READ_ONLY", this._readOnly)
    const prev = this.tx
    this.tx = { origin, cause }
    try {
      let out: T | undefined
      this.ydoc.transact(() => {
        out = fn()
      }, origin)
      return out as T
    } finally {
      this.tx = prev
    }
  }

  private budget(author: CommentAuthor): void {
    if (this.hourlyLimit <= 0) return
    const now = this.now()
    const list = (this.posted.get(author.id) ?? []).filter((t) => now - t < HOUR)
    if (list.length >= this.hourlyLimit)
      throw new CommentError("RATE_LIMITED", "Too many comments in the last hour")
    list.push(now)
    this.posted.set(author.id, list)
  }

  private yThread(id: string): YThread {
    const t = this.yThreads.get(id)
    if (!(t instanceof Y.Map) || !this.thread(id))
      throw new CommentError("NOT_FOUND", `No thread "${id}"`)
    return t
  }

  private yMessage(threadId: string, messageId: string): YMessage {
    const ym = this.yThread(threadId).get("messages") as Y.Map<unknown>
    const m = ym.get(messageId)
    if (!(m instanceof Y.Map)) throw new CommentError("NOT_FOUND", `No message "${messageId}"`)
    return m as YMessage
  }

  private freshId(): string {
    for (;;) {
      const id = generateId()
      if (!this.yThreads.has(id)) return id
    }
  }

  private newMessage(m: NewMessage): YMessage {
    checkText(m.text)
    checkAttachments(m.attachments)
    const y = new Y.Map<unknown>()
    y.set("author", plainJson(m.author))
    y.set("at", m.at ?? commentTime(new Date(this.now())))
    y.set("text", new Y.Text(m.text))
    if (m.attachments) y.set("attachments", plainJson(m.attachments))
    y.set("reactions", new Y.Map<boolean>())
    return y
  }

  /** Starts a thread. Returns its id and the opening message's id. */
  createThread(
    input: { anchor: CommentAnchor; message: NewMessage; id?: string },
    origin: Origin,
  ): { threadId: string; messageId: string } {
    if (this._readOnly !== null) throw new CommentError("READ_ONLY", this._readOnly)
    checkAnchor(input.anchor)
    const threadId = input.id ?? this.freshId()
    const messageId = input.message.id ?? this.freshId()
    if (!ID_RE.test(threadId) || !ID_RE.test(messageId) || threadId === messageId)
      throw new CommentError("INVALID", "Bad comment id")
    if (this.yThreads.has(threadId)) throw new CommentError("INVALID", "Thread id is taken")
    const msg = this.newMessage(input.message)
    this.budget(input.message.author)
    this.write(origin, () => {
      const t = new Y.Map<unknown>()
      t.set("anchor", plainJson(input.anchor))
      t.set("first", messageId)
      const messages = new Y.Map<unknown>()
      messages.set(messageId, msg)
      t.set("messages", messages)
      this.yThreads.set(threadId, t)
    })
    return { threadId, messageId }
  }

  /** Adds a reply. Returns its id. */
  reply(threadId: string, message: NewMessage, origin: Origin): string {
    if (this._readOnly !== null) throw new CommentError("READ_ONLY", this._readOnly)
    const t = this.yThread(threadId)
    const id = message.id ?? this.freshId()
    if (!ID_RE.test(id)) throw new CommentError("INVALID", "Bad comment id")
    const msg = this.newMessage(message)
    this.budget(message.author)
    this.write(origin, () => (t.get("messages") as Y.Map<unknown>).set(id, msg))
    return id
  }

  /** Changes a message's text. Only its author may. */
  editMessage(
    threadId: string,
    messageId: string,
    text: string,
    actor: string,
    origin: Origin,
  ): void {
    const m = this.yMessage(threadId, messageId)
    if ((m.get("author") as CommentAuthor | undefined)?.id !== actor)
      throw new CommentError("NOT_AUTHOR", "Only the author can edit a message")
    checkText(text)
    this.write(origin, () => {
      const yt = m.get("text")
      if (yt instanceof Y.Text) rewriteText(yt, text)
      else m.set("text", new Y.Text(text))
      m.set("edited", commentTime(new Date(this.now())))
    })
  }

  /**
   * Deletes a message: its author, or a moderator (file owner, workspace admin). Deleting the
   * opening message deletes the thread.
   */
  deleteMessage(
    threadId: string,
    messageId: string,
    actor: string,
    origin: Origin,
    options: { moderator?: boolean } = {},
  ): "message" | "thread" {
    const t = this.yThread(threadId)
    const m = this.yMessage(threadId, messageId)
    if (!options.moderator && (m.get("author") as CommentAuthor | undefined)?.id !== actor)
      throw new CommentError("NOT_AUTHOR", "Only the author can delete a message")
    if (t.get("first") === messageId) {
      this.write(origin, () => this.yThreads.delete(threadId))
      return "thread"
    }
    this.write(origin, () => (t.get("messages") as Y.Map<unknown>).delete(messageId))
    return "message"
  }

  /** Deletes a whole thread (moderators, or the author of its every message). */
  deleteThread(
    threadId: string,
    actor: string,
    origin: Origin,
    options: { moderator?: boolean } = {},
  ): void {
    const thread = this.thread(threadId)
    if (!thread) throw new CommentError("NOT_FOUND", `No thread "${threadId}"`)
    const own = Object.values(thread.messages).every((m) => m.author.id === actor)
    if (!options.moderator && !own)
      throw new CommentError("NOT_AUTHOR", "Only a file owner can delete other people's comments")
    this.write(origin, () => this.yThreads.delete(threadId))
  }

  /** Resolves (with `by`) or unresolves (null) a thread. */
  setResolved(threadId: string, by: CommentAuthor | null, origin: Origin): void {
    const t = this.yThread(threadId)
    this.write(origin, () => {
      if (by) t.set("resolved", { by: plainJson(by), at: commentTime(new Date(this.now())) })
      else t.delete("resolved")
    })
  }

  /** Toggles `authorId`'s `emoji` on a message. True when the reaction is now on. */
  toggleReaction(
    threadId: string,
    messageId: string,
    emoji: string,
    authorId: string,
    origin: Origin,
  ): boolean {
    if (!emoji || /\s/.test(emoji) || [...emoji].length > MAX_EMOJI_LENGTH)
      throw new CommentError("INVALID", "Bad emoji")
    if (/\s/.test(authorId)) throw new CommentError("INVALID", "Bad author id")
    const m = this.yMessage(threadId, messageId)
    const key = reactionKey(emoji, authorId)
    let on = false
    this.write(origin, () => {
      let yr = m.get("reactions")
      if (!(yr instanceof Y.Map)) {
        yr = new Y.Map<boolean>()
        m.set("reactions", yr)
      }
      const reactions = yr as Y.Map<boolean>
      if (reactions.has(key)) reactions.delete(key)
      else {
        reactions.set(key, true)
        on = true
      }
    })
    return on
  }

  /** Moves a pin or area (re-anchored by the caller, spec §2). */
  setAnchor(threadId: string, anchor: CommentAnchor, origin: Origin): void {
    checkAnchor(anchor)
    const t = this.yThread(threadId)
    this.write(origin, () => t.set("anchor", plainJson(anchor)))
  }

  /**
   * Writes page coordinates (`fallback`) and optionally a new `page` on anchored threads, in one
   * transaction: before their node is deleted, or after it moved to another page.
   */
  updateAnchors(
    updates: ReadonlyMap<string, { fallback?: { x: number; y: number }; page?: string | null }>,
    origin: Origin,
  ): void {
    if (updates.size === 0 || this._readOnly !== null) return
    this.write(origin, () => {
      for (const [id, u] of updates) {
        const t = this.yThreads.get(id)
        if (!(t instanceof Y.Map)) continue
        const anchor = { ...(t.get("anchor") as CommentAnchor) }
        if (u.fallback) anchor.fallback = { x: u.fallback.x, y: u.fallback.y }
        if (u.page === null) delete anchor.page
        else if (u.page !== undefined) anchor.page = u.page
        if (!jsonEqual(anchor, t.get("anchor"))) t.set("anchor", anchor)
      }
    })
  }

  /** Loads the file's `comments` (see {@link CommentLoadMode}). */
  load(
    comments: Comments | undefined,
    options: { mode?: CommentLoadMode; origin?: Origin } = {},
  ): void {
    const mode = options.mode ?? "replace"
    if (mode === "keep") return
    const src = comments ?? {}
    this.write(
      options.origin ?? "file",
      () => {
        if (mode === "replace")
          for (const id of [...this.yThreads.keys()])
            if (!Object.hasOwn(src, id)) this.yThreads.delete(id)
        for (const [id, t] of Object.entries(src)) {
          const cur = this.yThreads.get(id)
          if (cur instanceof Y.Map) this.syncThread(cur, t, mode)
          else this.yThreads.set(id, this.buildThread(t))
        }
      },
      "load",
    )
  }

  private buildThread(t: CommentThread): YThread {
    const y = new Y.Map<unknown>()
    y.set("anchor", plainJson(t.anchor))
    y.set("first", t.first)
    if (t.resolved) y.set("resolved", plainJson(t.resolved))
    const ym = new Y.Map<unknown>()
    for (const [mid, m] of Object.entries(t.messages)) ym.set(mid, this.buildMessage(m))
    y.set("messages", ym)
    return y
  }

  private buildMessage(m: CommentMessage): YMessage {
    const y = new Y.Map<unknown>()
    y.set("author", plainJson(m.author))
    y.set("at", m.at)
    if (m.edited !== undefined) y.set("edited", m.edited)
    if (m.attachments) y.set("attachments", plainJson(m.attachments))
    y.set("text", new Y.Text(m.text))
    const yr = new Y.Map<boolean>()
    for (const [e, ids] of Object.entries(m.reactions ?? {}))
      for (const id of ids) yr.set(reactionKey(e, id), true)
    y.set("reactions", yr)
    return y
  }

  private syncThread(y: YThread, t: CommentThread, mode: CommentLoadMode): void {
    let ym = y.get("messages")
    if (!(ym instanceof Y.Map)) {
      ym = new Y.Map<unknown>()
      y.set("messages", ym)
    }
    const messages = ym as Y.Map<unknown>
    if (mode === "add") {
      for (const [mid, m] of Object.entries(t.messages))
        if (!messages.has(mid)) messages.set(mid, this.buildMessage(m))
      return
    }
    if (!jsonEqual(y.get("anchor"), t.anchor)) y.set("anchor", plainJson(t.anchor))
    if (y.get("first") !== t.first) y.set("first", t.first)
    if (t.resolved) {
      if (!jsonEqual(y.get("resolved"), t.resolved)) y.set("resolved", plainJson(t.resolved))
    } else if (y.has("resolved")) y.delete("resolved")
    for (const mid of [...messages.keys()])
      if (!Object.hasOwn(t.messages, mid)) messages.delete(mid)
    for (const [mid, m] of Object.entries(t.messages)) {
      const cur = messages.get(mid)
      if (cur instanceof Y.Map) this.syncMessage(cur as YMessage, m)
      else messages.set(mid, this.buildMessage(m))
    }
  }

  private syncMessage(y: YMessage, m: CommentMessage): void {
    const put = (k: string, v: unknown) => {
      if (v === undefined) {
        if (y.has(k)) y.delete(k)
      } else if (!jsonEqual(y.get(k), v)) y.set(k, plainJson(v))
    }
    put("author", m.author)
    put("at", m.at)
    put("edited", m.edited)
    put("attachments", m.attachments)
    const yt = y.get("text")
    if (yt instanceof Y.Text) rewriteText(yt, m.text)
    else y.set("text", new Y.Text(m.text))
    const want = new Set<string>()
    for (const [e, ids] of Object.entries(m.reactions ?? {}))
      for (const id of ids) want.add(reactionKey(e, id))
    let yr = y.get("reactions")
    if (!(yr instanceof Y.Map)) {
      yr = new Y.Map<boolean>()
      y.set("reactions", yr)
    }
    const reactions = yr as Y.Map<boolean>
    for (const k of [...reactions.keys()]) if (!want.has(k)) reactions.delete(k)
    for (const k of want) if (!reactions.has(k)) reactions.set(k, true)
  }

  // --- Events and sync ------------------------------------------------------------------------

  onChange(listener: (c: CommentChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onUpdate(listener: (update: Uint8Array, origin: Origin) => void): () => void {
    this.updateListeners.add(listener)
    return () => this.updateListeners.delete(listener)
  }

  encodeStateVector(): Uint8Array {
    return Y.encodeStateVector(this.ydoc)
  }

  encodeStateAsUpdate(stateVector?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc, stateVector)
  }

  applyUpdate(update: Uint8Array, origin: RemoteOrigin = "remote"): void {
    const prev = this.tx
    this.tx = { origin, cause: "update" }
    try {
      Y.applyUpdate(this.ydoc, update, origin)
    } finally {
      this.tx = prev
    }
  }

  destroy(): void {
    this.listeners.clear()
    this.updateListeners.clear()
    this.ydoc.destroy()
  }
}
