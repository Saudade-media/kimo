/**
 * `CommentStore`: canvas comments next to the design document of a `YjsDocStore`
 * (docs/spec/comments.md). Comments never enter the design undo stacks or the design revision.
 *
 * State is a fold of changes ({@link CommentFold}). On a local file every write is a trusted
 * change applied at once, and authorship is checked by author id. In a room
 * ({@link CommentStore.enterRoom}) every write becomes a change signed by this device's key: the
 * sync layer signs and sends what {@link CommentStore.onRecord} reports, feeds the room's
 * verified changes to {@link CommentStore.receive}, and the fold drops any change its key may
 * not make (spec §4.3), so no client can rewrite another person's message.
 */
import {
  COMMENT_ATTACHMENTS_MAX,
  type CommentAnchor,
  type CommentAttachment,
  type CommentAuthor,
  type Comments,
  type CommentThread,
  commentTime,
  ID_PATTERN,
  jsonEqual,
} from "@kimo/core-schema"
import {
  COMMENT_RECORD_VERSION,
  CommentFold,
  type CommentOp,
  type CommentRecord,
  type CommentRecordBody,
  devKeyOf,
  isCommentAnchor,
  isCommentText,
  isEmoji,
  LOCAL_KEY,
  parseCommentOp,
} from "./comment-records"
import { generateId } from "./ids"
import type { Origin } from "./origin"

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

/** Emitted once per write, load or batch of received changes that changed comments. */
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
  /** Only threads and messages missing here are added. */
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
  /** New messages and replies per author per hour (spec §4.4). 0 = no limit. Default 100. */
  hourlyLimit?: number
  /** Ids taken by design nodes (never used for comments). */
  nodeIds?: (id: string) => boolean
}

/** A room this store syncs with (spec §4). */
export interface CommentRoom {
  /** This device's public key, base64url. */
  key: string
  /** The room root public key, base64url (owner changes). */
  root: string | null
  /** This client holds the root key: it may delete any thread and import a file's threads. */
  moderator: boolean
}

const ID_RE = new RegExp(ID_PATTERN)
const HOUR = 3_600_000

function checkText(text: string): void {
  if (!isCommentText(text))
    throw new CommentError("INVALID", "A message needs 1 to 5000 characters")
}

function checkAnchor(a: CommentAnchor): void {
  if (!isCommentAnchor(a)) throw new CommentError("INVALID", "Bad anchor")
}

function checkAttachments(list: CommentAttachment[] | undefined): void {
  if (list === undefined) return
  if (list.length === 0 || list.length > COMMENT_ATTACHMENTS_MAX)
    throw new CommentError("INVALID", `1 to ${COMMENT_ATTACHMENTS_MAX} images per message`)
}

/** A thread's content under fresh message ids (owner recovery, spec §4.4). */
function rehomed(t: CommentThread, fresh: () => string): CommentThread {
  const ids = new Map(Object.keys(t.messages).map((m) => [m, fresh()] as const))
  const messages = Object.fromEntries(
    Object.entries(t.messages).map(([m, v]) => [ids.get(m) as string, v]),
  )
  return { ...t, first: ids.get(t.first) as string, messages }
}

export class CommentStore {
  private readonly listeners = new Set<(c: CommentChange) => void>()
  private readonly recordListeners = new Set<(r: CommentRecord, origin: Origin) => void>()
  private readonly commitListeners = new Set<(op: CommentOp, origin: Origin) => void>()
  private readonly now: () => number
  private readonly hourlyLimit: number
  private readonly nodeIds: ((id: string) => boolean) | undefined
  private readonly posted = new Map<string, number[]>()
  private _readOnly: string | null = null
  private _room: CommentRoom | null = null
  /** Owner device after a relay reset: thread owners and content from before it. */
  private recovering: { owners: Map<string, string | null>; threads: Comments } | null = null
  /** Acknowledged changes, by position. */
  private acked: CommentRecord[] = []
  private confirmed: CommentFold
  /** Local changes the room has not acknowledged, in the order written. */
  private pendingList: CommentRecord[] = []
  private view: CommentFold | null = null
  private cache: Comments | null = null
  private lastJson = new Map<string, string>()
  private lastN = 0
  private localPos = 0
  /** The file's comments while in a room (imported by the owner when the room lacks them). */
  private fileComments: Comments | undefined

  constructor(options: CommentStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.hourlyLimit = options.hourlyLimit ?? 100
    this.nodeIds = options.nodeIds
    this.confirmed = this.newFold()
  }

  private newFold(): CommentFold {
    return new CommentFold({
      root: this._room?.root ?? null,
      ...(this.nodeIds ? { nodeIds: this.nodeIds } : {}),
    })
  }

  private state(): CommentFold {
    if (this.pendingList.length === 0) return this.confirmed
    if (!this.view) {
      const v = this.confirmed.copy()
      for (const r of this.pendingList) v.apply(r)
      this.view = v
    }
    return this.view
  }

  // --- Reading --------------------------------------------------------------------------------

  /** Number of threads. */
  get size(): number {
    return Object.keys(this.threads()).length
  }

  /** Every thread as plain data (cached until the next change; do not mutate). */
  threads(): Comments {
    this.cache ??= this.state().project()
    return this.cache
  }

  thread(id: string): CommentThread | undefined {
    const all = this.threads()
    return Object.hasOwn(all, id) ? all[id] : undefined
  }

  /** The file projection: undefined when there are no threads. */
  toJSON(): Comments | undefined {
    const t = this.threads()
    return Object.keys(t).length > 0 ? JSON.parse(JSON.stringify(t)) : undefined
  }

  /** The room this store syncs with, or null on a local file. */
  get room(): CommentRoom | null {
    return this._room
  }

  /** Whether `actor` (this device in a room) may edit or delete the message. */
  canModify(threadId: string, messageId: string, actor: string): boolean {
    const msgs = this.thread(threadId)?.messages
    const m = msgs && Object.hasOwn(msgs, messageId) ? msgs[messageId] : undefined
    if (!m) return false
    const owner = this.state().ownerOf(threadId, messageId)
    if (this._room && owner !== null) return owner === this._room.key
    return m.author.id === actor
  }

  // --- Writing --------------------------------------------------------------------------------

  /** Non-null while writes are refused (a read-only file or a view-only room). */
  get readOnly(): string | null {
    return this._readOnly
  }

  setReadOnly(reason: string | null): void {
    this._readOnly = reason
  }

  private assertWritable(): void {
    if (this._readOnly !== null) throw new CommentError("READ_ONLY", this._readOnly)
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

  private checkAuthor(author: CommentAuthor): void {
    const dev = devKeyOf(author.id)
    if (this._room && dev !== null && dev !== this._room.key)
      throw new CommentError("INVALID", "A dev: author must be this device")
  }

  private freshId(): string {
    const s = this.state()
    for (;;) {
      const id = generateId()
      if (!this.thread(id) && !s.isTomb(id) && !(this.nodeIds?.(id) ?? false)) return id
    }
  }

  private nextN(): number {
    this.lastN = Math.max(this.now(), this.lastN + 1)
    return this.lastN
  }

  /** Writes one change: applied at once on a local file, pending (and reported) in a room. */
  private commit(op: CommentOp, origin: Origin, options: { asRoot?: boolean } = {}): void {
    const room = this._room
    const body = {
      v: COMMENT_RECORD_VERSION,
      id: generateId(),
      n: this.nextN(),
      base: room ? this.confirmed.maxPos : this.localPos,
      at: commentTime(new Date(this.now())),
      ...op,
    } as CommentRecordBody
    const key = room ? (options.asRoot && room.root ? room.root : room.key) : LOCAL_KEY
    for (const l of [...this.commitListeners]) l(op, origin)
    if (!room) {
      const rec: CommentRecord = { body, key, pos: ++this.localPos }
      this.acked.push(rec)
      this.confirmed.apply(rec)
      this.changed(origin, "edit")
      return
    }
    const rec: CommentRecord = { body, key, pos: null }
    this.pendingList.push(rec)
    this.view = null
    this.changed(origin, "edit")
    for (const l of [...this.recordListeners]) l(rec, origin)
  }

  /** Starts a thread. Returns its id and the opening message's id. */
  createThread(
    input: { anchor: CommentAnchor; message: NewMessage; id?: string },
    origin: Origin,
  ): { threadId: string; messageId: string } {
    this.assertWritable()
    checkAnchor(input.anchor)
    const threadId = input.id ?? this.freshId()
    const messageId = input.message.id ?? this.freshId()
    if (!ID_RE.test(threadId) || !ID_RE.test(messageId) || threadId === messageId)
      throw new CommentError("INVALID", "Bad comment id")
    if (this.thread(threadId) || this.state().isTomb(threadId))
      throw new CommentError("INVALID", "Thread id is taken")
    checkText(input.message.text)
    checkAttachments(input.message.attachments)
    this.checkAuthor(input.message.author)
    this.budget(input.message.author)
    this.commit(
      {
        op: "thread",
        thread: threadId,
        message: messageId,
        anchor: input.anchor,
        author: input.message.author,
        text: input.message.text,
        ...(input.message.attachments ? { attachments: input.message.attachments } : {}),
      },
      origin,
    )
    if (!this.thread(threadId)) throw new CommentError("INVALID", "Comment id is taken")
    return { threadId, messageId }
  }

  /** Adds a reply. Returns its id. */
  reply(threadId: string, message: NewMessage, origin: Origin): string {
    this.assertWritable()
    if (!this.thread(threadId)) throw new CommentError("NOT_FOUND", `No thread "${threadId}"`)
    const id = message.id ?? this.freshId()
    if (!ID_RE.test(id)) throw new CommentError("INVALID", "Bad comment id")
    checkText(message.text)
    checkAttachments(message.attachments)
    this.checkAuthor(message.author)
    this.budget(message.author)
    this.commit(
      {
        op: "reply",
        thread: threadId,
        message: id,
        author: message.author,
        text: message.text,
        ...(message.attachments ? { attachments: message.attachments } : {}),
      },
      origin,
    )
    const after = this.thread(threadId)?.messages
    if (!after || !Object.hasOwn(after, id))
      throw new CommentError("INVALID", "Comment id is taken")
    return id
  }

  private message(threadId: string, messageId: string) {
    const t = this.thread(threadId)
    if (!t) throw new CommentError("NOT_FOUND", `No thread "${threadId}"`)
    const m = Object.hasOwn(t.messages, messageId) ? t.messages[messageId] : undefined
    if (!m) throw new CommentError("NOT_FOUND", `No message "${messageId}"`)
    return { thread: t, message: m }
  }

  /** Changes a message's text. Only its author may (in a room: the key that wrote it). */
  editMessage(
    threadId: string,
    messageId: string,
    text: string,
    actor: string,
    origin: Origin,
  ): void {
    this.assertWritable()
    this.message(threadId, messageId)
    if (!this.canModify(threadId, messageId, actor))
      throw new CommentError("NOT_AUTHOR", "Only the author can edit a message")
    checkText(text)
    this.commit({ op: "edit", thread: threadId, message: messageId, text }, origin)
  }

  /**
   * Deletes a message: its author, or a moderator (in a room: a holder of the root key).
   * Deleting the opening message deletes the thread.
   */
  deleteMessage(
    threadId: string,
    messageId: string,
    actor: string,
    origin: Origin,
    options: { moderator?: boolean } = {},
  ): "message" | "thread" {
    this.assertWritable()
    const { thread } = this.message(threadId, messageId)
    const own = this.canModify(threadId, messageId, actor)
    const asRoot = !own && this.moderates(options.moderator)
    if (!own && !asRoot)
      throw new CommentError("NOT_AUTHOR", "Only the author can delete a message")
    const whole = thread.first === messageId
    this.commit(
      whole
        ? { op: "delete", thread: threadId }
        : { op: "delete", thread: threadId, message: messageId },
      origin,
      { asRoot },
    )
    return whole ? "thread" : "message"
  }

  /** Whether this client may act as moderator (`moderator` asked, and a root key in rooms). */
  private moderates(asked: boolean | undefined): boolean {
    if (!asked) return false
    return this._room ? this._room.moderator && this._room.root !== null : true
  }

  /** Deletes a whole thread (moderators, or the author of its first message). */
  deleteThread(
    threadId: string,
    actor: string,
    origin: Origin,
    options: { moderator?: boolean } = {},
  ): void {
    this.assertWritable()
    const thread = this.thread(threadId)
    if (!thread) throw new CommentError("NOT_FOUND", `No thread "${threadId}"`)
    const own = this.canModify(threadId, thread.first, actor)
    const asRoot = !own && this.moderates(options.moderator)
    if (!own && !asRoot)
      throw new CommentError("NOT_AUTHOR", "Only a file owner can delete other people's comments")
    this.commit({ op: "delete", thread: threadId }, origin, { asRoot })
  }

  /** Resolves (with `by`) or unresolves (null) a thread. */
  setResolved(threadId: string, by: CommentAuthor | null, origin: Origin): void {
    this.assertWritable()
    if (!this.thread(threadId)) throw new CommentError("NOT_FOUND", `No thread "${threadId}"`)
    if (by) this.checkAuthor(by)
    this.commit({ op: "resolve", thread: threadId, by }, origin)
  }

  /** Toggles `authorId`'s `emoji` on a message. True when the reaction is now on. */
  toggleReaction(
    threadId: string,
    messageId: string,
    emoji: string,
    authorId: string,
    origin: Origin,
  ): boolean {
    this.assertWritable()
    if (!isEmoji(emoji)) throw new CommentError("INVALID", "Bad emoji")
    if (/\s/.test(authorId)) throw new CommentError("INVALID", "Bad author id")
    const { message } = this.message(threadId, messageId)
    const dev = devKeyOf(authorId)
    if (this._room && dev !== null && dev !== this._room.key)
      throw new CommentError("INVALID", "A dev: author must be this device")
    const r = message.reactions
    const on = !(r && Object.hasOwn(r, emoji) ? (r[emoji] ?? []) : []).includes(authorId)
    this.commit(
      { op: "react", thread: threadId, message: messageId, emoji, author: authorId, on },
      origin,
    )
    return on
  }

  /** Moves a pin or area (re-anchored by the caller, spec §2). */
  setAnchor(threadId: string, anchor: CommentAnchor, origin: Origin): void {
    this.assertWritable()
    checkAnchor(anchor)
    if (!this.thread(threadId)) throw new CommentError("NOT_FOUND", `No thread "${threadId}"`)
    this.commit({ op: "anchor", thread: threadId, anchor }, origin)
  }

  /**
   * Writes page coordinates (`fallback`) and optionally a new `page` on anchored threads: before
   * their node is deleted, or after it moved to another page.
   */
  updateAnchors(
    updates: ReadonlyMap<string, { fallback?: { x: number; y: number }; page?: string | null }>,
    origin: Origin,
  ): void {
    if (updates.size === 0 || this._readOnly !== null) return
    for (const [id, u] of updates) {
      const t = this.thread(id)
      if (!t) continue
      const anchor: CommentAnchor = { ...t.anchor }
      if (u.fallback) anchor.fallback = { x: u.fallback.x, y: u.fallback.y }
      if (u.page === null) delete anchor.page
      else if (u.page !== undefined) anchor.page = u.page
      if (!jsonEqual(anchor, t.anchor)) this.commit({ op: "anchor", thread: id, anchor }, origin)
    }
  }

  /**
   * Loads the file's `comments` (see {@link CommentLoadMode}). In a room the room is the truth:
   * the file's threads are kept aside for {@link importMissing}.
   */
  load(
    comments: Comments | undefined,
    options: { mode?: CommentLoadMode; origin?: Origin } = {},
  ): void {
    const mode = options.mode ?? "replace"
    if (mode === "keep") return
    if (this._room) {
      this.fileComments = comments
      return
    }
    if (mode === "replace") {
      this.acked = []
      this.confirmed = this.newFold()
      this.localPos = 0
    }
    for (const [id, t] of Object.entries(comments ?? {})) {
      const rec: CommentRecord = {
        body: {
          v: COMMENT_RECORD_VERSION,
          id: generateId(),
          n: this.nextN(),
          base: this.localPos,
          at: commentTime(new Date(this.now())),
          op: "import",
          thread: id,
          data: t,
        },
        key: LOCAL_KEY,
        pos: ++this.localPos,
      }
      this.acked.push(rec)
      this.confirmed.apply(rec)
    }
    this.changed(options.origin ?? "file", "load")
  }

  // --- Rooms ----------------------------------------------------------------------------------

  /**
   * Switches to a room: from now on the state is the room's changes (`records`: this device's
   * replica, verified), and every write is a change to sign. The file's comments are kept aside.
   * The replica holds only changes a fold applied, so they enter as compacted (spec §4.3).
   */
  enterRoom(
    room: CommentRoom,
    records: readonly CommentRecord[] = [],
    origin: Origin = "remote",
  ): void {
    this.fileComments = this.toJSON()
    this._room = { ...room }
    this.acked = []
    this.pendingList = []
    this.confirmed = this.newFold()
    this.view = null
    this.receive(
      records.map((r) => ({ ...r, compacted: true })),
      origin,
    )
    this.changed(origin, "load")
  }

  /**
   * Learns the room root key (a receiver finds it when a change's key derives the room id):
   * changes it signed were folded as a stranger's, so the log folds again.
   */
  setRoomRoot(root: string, origin: Origin = "remote"): void {
    const room = this._room
    if (!room || room.root === root) return
    room.root = root
    this.refold()
    this.view = null
    this.changed(origin, "update")
  }

  /** Back to a local file: the current state becomes its comments. */
  leaveRoom(origin: Origin = "file"): void {
    if (!this._room) return
    this.recovering = null
    const now = this.toJSON()
    this._room = null
    this.pendingList = []
    this.view = null
    this.load(now, { mode: "replace", origin })
  }

  /** Reports every write as it is made, on a file and in a room (host-sync forwards them). */
  onCommit(listener: (op: CommentOp, origin: Origin) => void): () => void {
    this.commitListeners.add(listener)
    return () => this.commitListeners.delete(listener)
  }

  /**
   * Makes a write another replica of this document made (the document host's agents, through
   * host-sync): checked against the rights here, then written as this device's own.
   */
  submit(op: CommentOp, origin: Origin): void {
    this.assertWritable()
    let asRoot = false
    if (op.op === "import") {
      if (!this.moderates(true))
        throw new CommentError("NOT_AUTHOR", "Only a file owner can import comments")
      asRoot = true
    }
    if (op.op === "edit" || op.op === "delete") {
      const t = this.thread(op.thread)
      if (!t) throw new CommentError("NOT_FOUND", `No thread "${op.thread}"`)
      const message = op.op === "edit" ? op.message : (op.message ?? t.first)
      const own = this._room ? this.state().ownerOf(op.thread, message) === this._room.key : true
      if (!own && op.op === "delete" && this.moderates(true)) asRoot = true
      else if (!own) throw new CommentError("NOT_AUTHOR", "Only the author can change this comment")
    }
    this.commit(op, origin, { asRoot })
  }

  /**
   * Writes again, as a new change of this device, what an old change of this device set (a
   * relay that lost its log: the old bytes name positions the new log does not have).
   */
  reissue(rec: CommentRecord, origin: Origin): void {
    const room = this._room
    const op = parseCommentOp(rec.body)
    if (!room || !op) return
    if (rec.key !== room.key && rec.key !== room.root) return
    this.commit(op, origin, { asRoot: rec.key === room.root && rec.key !== room.key })
  }

  /** Reports each local change to sign and send (rooms only). */
  onRecord(listener: (record: CommentRecord, origin: Origin) => void): () => void {
    this.recordListeners.add(listener)
    return () => this.recordListeners.delete(listener)
  }

  /** Local changes not acknowledged yet, in the order written. */
  pending(): readonly CommentRecord[] {
    return this.pendingList
  }

  /** Highest acknowledged position (the `base` of the next change). */
  get position(): number {
    return this.confirmed.maxPos
  }

  /**
   * Applies changes from the room (signatures already verified, `pos` set). Changes the fold
   * may not make are dropped (spec §4.3).
   */
  receive(records: readonly CommentRecord[], origin: Origin = "remote"): void {
    if (records.length === 0) return
    let inOrder = true
    let last = this.confirmed.maxPos
    for (const r of records) {
      if (r.pos === null) continue
      if (r.pos <= last) inOrder = false
      last = Math.max(last, r.pos)
    }
    const fresh = records.filter((r) => r.pos !== null && !this.confirmed.seen.has(r.body.id))
    if (fresh.length === 0) return
    this.acked.push(...fresh)
    // A pending change that came back (re-sent before its ack) is acknowledged by it.
    const ids = new Set(fresh.map((r) => r.body.id))
    this.pendingList = this.pendingList.filter((p) => !ids.has(p.body.id))
    if (inOrder) for (const r of fresh) this.confirmed.apply(r)
    else this.refold()
    this.view = null
    this.changed(origin, "update")
  }

  /** The room acknowledged a local change at `pos`. */
  acknowledge(changeId: string, pos: number): void {
    const i = this.pendingList.findIndex((r) => r.body.id === changeId)
    if (i < 0) return
    const rec = { ...(this.pendingList[i] as CommentRecord), pos }
    this.pendingList.splice(i, 1)
    this.acked.push(rec)
    if (pos > this.confirmed.maxPos) this.confirmed.apply(rec)
    else this.refold()
    this.view = null
    this.changed("remote", "update")
  }

  private refold(): void {
    this.acked.sort((a, b) => (a.pos as number) - (b.pos as number))
    // A change refused at one position may apply when replayed at a later one: keep each copy.
    const seen = new Set<string>()
    this.acked = this.acked.filter((r) => {
      const k = `${r.body.id}@${r.pos}`
      return !seen.has(k) && seen.add(k)
    })
    this.confirmed = this.newFold()
    for (const r of this.acked) this.confirmed.apply(r)
  }

  /** Acknowledged changes a comment snapshot keeps (spec §4.4 Compaction). */
  kept(): CommentRecord[] {
    return this.confirmed.kept()
  }

  /** Changes holding live state (re-append candidates, spec §4.4). */
  live(): CommentRecord[] {
    return this.state().live()
  }

  /** Drops acknowledged changes a snapshot no longer needs (after a compaction). */
  compact(): void {
    this.acked = this.confirmed.kept()
  }

  /**
   * Owner device, before a relay reset is folded away: records who owned each thread, so a
   * guest that takes one of these ids in the empty log can be told apart (spec §4.4 Recovery).
   */
  beginRecovery(): void {
    const room = this._room
    if (!room?.moderator || !room.root) return
    const c = this.confirmed
    const owners = new Map<string, string | null>()
    for (const [id, t] of c.threads) owners.set(id, c.ownerOf(id, t.first) ?? null)
    this.recovering = { owners, threads: c.project() }
  }

  /**
   * Owner device after a reset: a recorded thread id now held or deleted by a key that is
   * neither its owner's nor the root key was taken by someone else. Its old content comes back
   * as a root `import` under fresh ids (and the taker's thread is deleted). Returns the ids moved.
   */
  recover(origin: Origin): string[] {
    const room = this._room
    const rec = this.recovering
    if (!room?.moderator || !room.root || !rec) return []
    const c = this.confirmed
    const busy = new Set(this.pendingList.map((p) => p.body.thread))
    const legit = (k: string | null | undefined, was: string | null) => k === room.root || k === was
    const moved: string[] = []
    for (const [id, was] of [...rec.owners]) {
      if (busy.has(id)) continue
      const t = c.threads.get(id)
      let taken: boolean
      if (t) taken = !legit(c.ownerOf(id, t.first), was)
      else if (c.isTomb(id)) taken = !legit(c.tombKey(id), was)
      else continue
      rec.owners.delete(id)
      const data = rec.threads[id]
      if (!taken || !data) continue
      if (t) this.commit({ op: "delete", thread: id }, origin, { asRoot: true })
      const fresh = rehomed(data, () => this.freshId())
      this.commit({ op: "import", thread: this.freshId(), data: fresh }, origin, { asRoot: true })
      moved.push(id)
    }
    return moved
  }

  /** Whether a delete named `id` (a change naming it can never apply again). */
  isDeleted(id: string): boolean {
    return this.state().isTomb(id)
  }

  /**
   * Owner device only: appends one `import` per file thread (or missing messages) the room
   * lacks (spec §4.4 Authority). Returns how many changes it wrote.
   */
  importMissing(origin: Origin = "file"): number {
    const room = this._room
    const file = this.fileComments
    if (!room?.moderator || !room.root || !file) return 0
    const s = this.state()
    let n = 0
    for (const [id, t] of Object.entries(file)) {
      if (s.tombs.has(id)) continue
      const cur = this.thread(id)
      if (
        cur &&
        Object.keys(t.messages).every((m) => Object.hasOwn(cur.messages, m) || s.tombs.has(m))
      )
        continue
      this.commit({ op: "import", thread: id, data: t }, origin, { asRoot: true })
      n++
    }
    this.fileComments = undefined
    return n
  }

  // --- Events ---------------------------------------------------------------------------------

  private changed(origin: Origin, cause: CommentChange["cause"]): void {
    this.cache = null
    const next = this.threads()
    const threads = new Set<string>()
    const json = new Map<string, string>()
    for (const [id, t] of Object.entries(next)) {
      const j = JSON.stringify(t)
      json.set(id, j)
      if (this.lastJson.get(id) !== j) threads.add(id)
    }
    for (const id of this.lastJson.keys()) if (!json.has(id)) threads.add(id)
    this.lastJson = json
    if (threads.size === 0) return
    const change: CommentChange = { origin, threads, cause }
    for (const l of [...this.listeners]) l(change)
  }

  onChange(listener: (c: CommentChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  destroy(): void {
    this.listeners.clear()
    this.recordListeners.clear()
  }
}
