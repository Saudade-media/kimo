/**
 * The comment channel of a room (docs/spec/comments.md §4): signs the comment store's local
 * changes, sends them as `append-comment` batches, verifies what the relay hands out and feeds
 * it to the store in log order. One channel per provider; each connection starts a session.
 *
 * Every change is checked twice on receipt: its signature here, its right to act in the fold
 * (CommentStore). A change that fails either is dropped, the same way on every client.
 */
import {
  COMMENT_ENTRY_SLOTS,
  type CommentRecord,
  type CommentStore,
  type Origin,
} from "@kimo/editor-state"
import {
  decodeCommentBatch,
  decodeCommentSnapshot,
  encodeCommentBatch,
  encodeCommentSnapshot,
  MAX_COMMENT_BATCH,
  type SignedComment,
  signComment,
  verifyComment,
} from "./mp/comments"
import {
  type ClientMessage,
  type CommentLogInfo,
  ENVELOPE_OVERHEAD,
  type LogEntry,
  openCommentsSnapshot,
  openCommentsUpdate,
  parseRoomId,
  type RelayHttpClient,
  type RoomKeys,
  roomMatchesRootKey,
  type SnapshotInfo,
  sealCommentsSnapshot,
  sealCommentsUpdate,
  toBase64Url,
} from "./mp/index"

/** A key that signs comment changes. */
export interface CommentSigner {
  privateKey: CryptoKey
  /** Raw 32-byte public key. */
  publicKey: Uint8Array
}

/** What a device keeps of a room's comment log between sessions. */
export interface CommentReplica {
  /** Highest comment log seq applied. */
  since: number
  /** Acknowledged changes still needed, with their positions. */
  changes: { pos: number; signed: SignedComment }[]
  /** Signed local changes not acknowledged yet (sent again next session). */
  unsent: SignedComment[]
}

/** Storage of {@link CommentReplica}s (IndexedDB in the web app, a map in tests). */
export interface CommentReplicaStore {
  load(room: string): Promise<CommentReplica | null>
  save(room: string, replica: CommentReplica): Promise<void>
}

export class MemoryCommentReplicaStore implements CommentReplicaStore {
  private readonly rooms = new Map<string, CommentReplica>()
  async load(room: string): Promise<CommentReplica | null> {
    return this.rooms.get(room) ?? null
  }
  async save(room: string, replica: CommentReplica): Promise<void> {
    this.rooms.set(room, replica)
  }
}

/** What one connection gives the channel. */
export interface CommentSession {
  /** Sends on this connection (a no-op once it closed). */
  send(message: ClientMessage): void
  /** A fresh client message id on this connection. */
  cid(): number
  /** The token HTTP calls present. */
  token(): string
  /** False once the connection is gone. */
  alive(): boolean
  /** An edit token: compaction requests come to it. */
  edit: boolean
  /** The relay's per-entry limit. */
  maxEntryBytes: number
  maxSnapshotBytes: number
  info: CommentLogInfo
  /** Called when the log shows a gap: the provider reconnects. */
  resync(): void
}

export interface CommentChannelOptions {
  room: string
  keys: RoomKeys
  http: RelayHttpClient
  store: CommentStore
  /** This device's key: every local change is signed with it. */
  device: CommentSigner
  /** The room root key, on the owner's devices: moderation and file imports. */
  root?: CommentSigner | null
  replica?: CommentReplicaStore
  /** Origin of changes the channel applies. */
  origin: Origin
  /** Debounce of replica saves in ms. Default 1 000. */
  saveMs?: number
}

const strayKey = (signed: SignedComment) => toBase64Url(signed.key)

export class CommentChannel {
  private readonly store: CommentStore
  private readonly signers = new Map<string, CommentSigner>()
  private readonly roomId
  /** Signed bytes of every change held, by change id. */
  private readonly signed = new Map<string, SignedComment>()
  /** Signed changes of earlier sessions not in the room yet: sent, then received on ack. */
  private readonly unsent = new Map<string, { signed: SignedComment; record: CommentRecord }>()
  private readonly rootChecks = new Map<string, Promise<boolean>>()
  private session: CommentSession | null = null
  private since = 0
  private caughtUp = false
  /** Change ids in flight on the current session, by cid. */
  private inflight = new Map<number, string[]>()
  private readonly sent = new Set<string>()
  private chain: Promise<void> = Promise.resolve()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private loaded: Promise<void> | null = null
  private readonly offRecord: () => void
  private entered = false
  private compacting = false
  private disposed = false

  constructor(private readonly options: CommentChannelOptions) {
    this.store = options.store
    this.roomId = parseRoomId(options.room)
    this.signers.set(toBase64Url(options.device.publicKey), options.device)
    if (options.root) this.signers.set(toBase64Url(options.root.publicKey), options.root)
    this.offRecord = this.store.onRecord(() => this.scheduleFlush())
  }

  /** Enters the room with the device's replica (once per channel). */
  private enter(): Promise<void> {
    this.loaded ??= (async () => {
      const replica = (await this.options.replica?.load(this.options.room)) ?? null
      const records: CommentRecord[] = []
      // The replica's root is found before entering: the store is not in the room yet, so
      // learnRoot could not tell it (and the owner's changes would fold as a stranger's).
      let learned: string | null = null
      if (replica) {
        for (const c of replica.changes) {
          const rec = await verifyComment(this.options.room, c.signed, c.pos)
          if (!rec) continue
          if (learned === null && (await this.isRootKey(c.signed))) learned = strayKey(c.signed)
          this.signed.set(rec.body.id, c.signed)
          records.push(rec)
        }
        for (const s of replica.unsent) {
          const rec = await verifyComment(this.options.room, s, null)
          if (rec) this.unsent.set(rec.body.id, { signed: s, record: rec })
        }
        this.since = replica.since
      }
      if (this.disposed) return
      const own = this.options.root ? toBase64Url(this.options.root.publicKey) : null
      const root = own ?? learned
      this.store.enterRoom(
        { key: toBase64Url(this.options.device.publicKey), root, moderator: own !== null },
        records,
        this.options.origin,
      )
      this.entered = true
    })()
    return this.loaded
  }

  /** A connection was welcomed by a relay that carries comments. */
  start(session: CommentSession): void {
    this.session = session
    this.caughtUp = false
    this.inflight = new Map()
    this.sent.clear()
    this.serial(async () => {
      await this.enter()
      if (this.session !== session || !session.alive()) return
      if (session.info.head < this.since) {
        // The relay lost entries this device saw: start over and send what it holds again.
        for (const [id, s] of this.signed) {
          const rec = await verifyComment(this.options.room, s, null)
          if (rec && this.store.live().some((r) => r.body.id === id))
            this.unsent.set(id, { signed: s, record: rec })
        }
        this.since = 0
        this.signed.clear()
        this.store.enterRoom(this.store.room ?? this.roomFallback(), [], this.options.origin)
      }
      session.send({ type: "comments-subscribe", since: this.since })
      this.maybeCaughtUp(session)
    })
  }

  private roomFallback() {
    return { key: toBase64Url(this.options.device.publicKey), root: null, moderator: false }
  }

  /** The connection closed. */
  stop(): void {
    this.session = null
    this.caughtUp = false
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
  }

  /** Detach: saves the replica and leaves the room. */
  async dispose(): Promise<void> {
    this.stop()
    this.disposed = true
    this.offRecord()
    await this.chain.catch(() => {})
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (this.entered) await this.save()
    if (this.entered) this.store.leaveRoom()
  }

  onEntries(session: CommentSession, entries: readonly LogEntry[]): void {
    this.serial(async () => {
      const records: CommentRecord[] = []
      for (const entry of entries) {
        if (this.session !== session) return
        if (entry.seq <= this.since) continue
        if (entry.seq !== this.since + 1) {
          session.resync()
          return
        }
        records.push(...(await this.openEntry(entry.seq, entry.env)))
        this.since = entry.seq
      }
      this.receive(records)
      this.maybeCaughtUp(session)
    })
  }

  onSnapshot(session: CommentSession, info: SnapshotInfo): void {
    this.serial(async () => {
      if (this.session !== session) return
      if (this.since >= info.upTo) {
        // Someone compacted what this device holds: drop what the snapshot no longer needs.
        this.store.compact()
        this.scheduleSave()
        return
      }
      const fetched = await this.options.http.getCommentSnapshot(this.options.room, session.token())
      if (this.session !== session || !fetched) return
      let changes: { pos: number; signed: SignedComment }[] = []
      try {
        const plain = await openCommentsSnapshot(this.options.keys, fetched.upTo, fetched.envelope)
        changes = decodeCommentSnapshot(plain)
      } catch {
        // A snapshot that does not open holds nothing this device can trust.
      }
      const limit = (fetched.upTo + 1) * COMMENT_ENTRY_SLOTS
      const records: CommentRecord[] = []
      for (const c of changes) {
        if (c.pos >= limit) continue
        const rec = await this.verify(c.signed, c.pos)
        if (rec) records.push(rec)
      }
      this.since = Math.max(this.since, fetched.upTo)
      this.receive(records)
      this.maybeCaughtUp(session)
    })
  }

  onAck(session: CommentSession, cid: number, seq: number): boolean {
    const ids = this.inflight.get(cid)
    if (!ids || this.session !== session) return false
    this.inflight.delete(cid)
    this.serial(async () => {
      if (seq !== this.since + 1) {
        // Entries before ours are still on their way (never on one relay socket): resync.
        if (seq > this.since + 1) session.resync()
        return
      }
      this.since = seq
      ids.forEach((id, i) => {
        const pos = seq * COMMENT_ENTRY_SLOTS + i
        const orphan = this.unsent.get(id)
        if (orphan) {
          this.unsent.delete(id)
          this.signed.set(id, orphan.signed)
          this.store.receive([{ ...orphan.record, pos }], this.options.origin)
        } else this.store.acknowledge(id, pos)
      })
      this.scheduleSave()
    })
    return true
  }

  /** A denial of one of this channel's appends: the changes go back to waiting. */
  onDenied(cid: number): boolean {
    const ids = this.inflight.get(cid)
    if (!ids) return false
    this.inflight.delete(cid)
    for (const id of ids) this.sent.delete(id)
    return true
  }

  owns(cid: number): boolean {
    return this.inflight.has(cid)
  }

  /** `comment-compact {upTo}`: edit peers upload the kept changes once caught up. */
  onCompact(session: CommentSession, upTo: number): void {
    if (!session.edit || this.compacting) return
    this.compacting = true
    this.serial(async () => {
      try {
        if (this.session !== session || this.since < upTo) return
        const limit = (upTo + 1) * COMMENT_ENTRY_SLOTS
        const changes: { pos: number; signed: SignedComment }[] = []
        for (const r of this.store.kept()) {
          const s = r.pos !== null && r.pos < limit ? this.signed.get(r.body.id) : undefined
          if (s) changes.push({ pos: r.pos as number, signed: s })
        }
        const env = await sealCommentsSnapshot(
          this.options.keys,
          upTo,
          encodeCommentSnapshot(changes),
        )
        if (env.length > session.maxSnapshotBytes) return
        await this.options.http.putCommentSnapshot(this.options.room, session.token(), upTo, env)
      } catch {
        // SNAPSHOT_STALE: another peer won. Anything else: the relay asks someone else.
      } finally {
        this.compacting = false
      }
    })
  }

  // --- Receiving ------------------------------------------------------------------------------

  private async openEntry(seq: number, env: Uint8Array): Promise<CommentRecord[]> {
    let batch: SignedComment[]
    try {
      batch = decodeCommentBatch(await openCommentsUpdate(this.options.keys, env))
    } catch {
      return [] // An entry that does not open is skipped, as on the design log.
    }
    const out: CommentRecord[] = []
    for (let i = 0; i < batch.length; i++) {
      const rec = await this.verify(batch[i] as SignedComment, seq * COMMENT_ENTRY_SLOTS + i)
      if (rec) out.push(rec)
    }
    return out
  }

  private async verify(signed: SignedComment, pos: number): Promise<CommentRecord | null> {
    const rec = await verifyComment(this.options.room, signed, pos)
    if (!rec) return null
    await this.learnRoot(signed)
    if (!this.signed.has(rec.body.id)) this.signed.set(rec.body.id, signed)
    return rec
  }

  /** A change signed by the key the room id derives from is the owner's (spec §4.1). */
  private async learnRoot(signed: SignedComment): Promise<void> {
    const key = strayKey(signed)
    if (this.store.room?.root === key) return
    if (await this.isRootKey(signed)) this.store.setRoomRoot(key, this.options.origin)
  }

  private isRootKey(signed: SignedComment): Promise<boolean> {
    const key = strayKey(signed)
    let check = this.rootChecks.get(key)
    if (!check) {
      check = roomMatchesRootKey(this.roomId, signed.key)
      this.rootChecks.set(key, check)
    }
    return check
  }

  private receive(records: CommentRecord[]): void {
    for (const r of records) this.unsent.delete(r.body.id)
    this.store.receive(records, this.options.origin)
    this.scheduleSave()
  }

  private maybeCaughtUp(session: CommentSession): void {
    if (this.caughtUp || this.session !== session || this.since < session.info.head) return
    this.caughtUp = true
    if (this.options.root) this.store.importMissing(this.options.origin)
    this.scheduleFlush()
  }

  // --- Sending --------------------------------------------------------------------------------

  private scheduleFlush(): void {
    if (this.flushTimer || !this.caughtUp) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.serial(() => this.flush())
    }, 0)
  }

  private async flush(): Promise<void> {
    const session = this.session
    if (!session || !this.caughtUp || !session.alive()) return
    const waiting: SignedComment[] = []
    const ids: string[] = []
    for (const [id, o] of this.unsent)
      if (!this.sent.has(id)) {
        waiting.push(o.signed)
        ids.push(id)
      }
    for (const rec of this.store.pending()) {
      const id = rec.body.id
      if (this.sent.has(id) || this.unsent.has(id)) continue
      const signer = this.signers.get(rec.key)
      if (!signer) continue
      let s = this.signed.get(id)
      if (!s) {
        try {
          s = await signComment(this.options.room, rec.body, signer.privateKey, signer.publicKey)
        } catch {
          continue // Over 32 KiB: the store's limits keep this from happening.
        }
        this.signed.set(id, s)
      }
      waiting.push(s)
      ids.push(id)
    }
    if (this.session !== session) return
    const room = session.maxEntryBytes - ENVELOPE_OVERHEAD - 16
    let i = 0
    while (i < waiting.length) {
      const batch: SignedComment[] = []
      let bytes = 4
      while (i + batch.length < waiting.length && batch.length < MAX_COMMENT_BATCH) {
        const s = waiting[i + batch.length] as SignedComment
        const size = s.key.length + s.sig.length + s.body.length + 4
        if (batch.length > 0 && bytes + size > room) break
        batch.push(s)
        bytes += size
      }
      const batchIds = ids.slice(i, i + batch.length)
      i += batch.length
      const env = await sealCommentsUpdate(this.options.keys, encodeCommentBatch(batch))
      if (this.session !== session) return
      const cid = session.cid()
      this.inflight.set(cid, batchIds)
      for (const id of batchIds) this.sent.add(id)
      session.send({ type: "append-comment", cid, env })
    }
    this.scheduleSave()
  }

  // --- Replica --------------------------------------------------------------------------------

  private scheduleSave(): void {
    if (this.saveTimer || !this.options.replica) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, this.options.saveMs ?? 1_000)
  }

  private async save(): Promise<void> {
    const replica = this.options.replica
    if (!replica) return
    const changes: CommentReplica["changes"] = []
    for (const r of this.store.kept()) {
      const s = this.signed.get(r.body.id)
      if (s && r.pos !== null) changes.push({ pos: r.pos, signed: s })
    }
    const unsent = [...this.unsent.values()].map((o) => o.signed)
    for (const rec of this.store.pending()) {
      const s = this.signed.get(rec.body.id)
      if (s) unsent.push(s)
    }
    try {
      await replica.save(this.options.room, { since: this.since, changes, unsent })
    } catch {
      // Without a replica the next session catches up from the relay; nothing is lost there.
    }
  }

  private serial(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch(() => {})
  }
}
