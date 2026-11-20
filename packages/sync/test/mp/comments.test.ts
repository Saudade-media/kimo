/** Signed comment changes (docs/spec/comments.md §4.1, §4.2). */
import { describe, expect, test } from "bun:test"
import { type CommentRecordBody, CommentStore } from "@kimo/editor-state"
import {
  CommentChannel,
  type CommentSession,
  type CommentSigner,
  MemoryCommentReplicaStore,
} from "../../src/comment-channel"
import {
  type ClientMessage,
  deriveRoomId,
  deriveRoomKeys,
  exportPublicKey,
  generateRoomKey,
  generateSigningKeyPair,
  type LogEntry,
  RelayHttpClient,
  type RoomKeys,
  sealCommentsUpdate,
  toBase64Url,
} from "../../src/mp"
import {
  decodeCommentBatch,
  decodeCommentSnapshot,
  encodeCommentBatch,
  encodeCommentSnapshot,
  signComment,
  verifyComment,
} from "../../src/mp/comments"

const ROOM = "a".repeat(32)
const OTHER = "b".repeat(32)

const body = (key: string): CommentRecordBody => ({
  v: 1,
  id: "Change0001",
  n: 1,
  base: 0,
  at: "2026-11-19T10:00:00.000Z",
  op: "thread",
  thread: "Thread0001",
  message: "Msg0000001",
  anchor: { x: 1, y: 2 },
  author: { id: `dev:${key}`, name: "Ana", kind: "person" },
  text: "Hi",
})

describe("signed comment changes", () => {
  test("a change verifies only in its room, with its key and its exact bytes", async () => {
    const pair = await generateSigningKeyPair()
    const pub = await exportPublicKey(pair.publicKey)
    const key = toBase64Url(pub)
    const signed = await signComment(ROOM, body(key), pair.privateKey, pub)
    const ok = await verifyComment(ROOM, signed, 256)
    expect(ok?.key).toBe(key)
    expect(ok?.body.op).toBe("thread")
    // Replayed into another room.
    expect(await verifyComment(OTHER, signed, 256)).toBeNull()
    // Body changed after signing.
    const tampered = signed.body.slice()
    tampered[tampered.length - 3] = (tampered[tampered.length - 3] as number) ^ 1
    expect(await verifyComment(ROOM, { ...signed, body: tampered }, 256)).toBeNull()
    // Claimed by another key.
    const other = await exportPublicKey((await generateSigningKeyPair()).publicKey)
    expect(await verifyComment(ROOM, { ...signed, key: other }, 256)).toBeNull()
    // Signed but malformed: not a change.
    const bad = await signComment(
      ROOM,
      { ...body(key), text: "" } as CommentRecordBody,
      pair.privateKey,
      pub,
    )
    expect(await verifyComment(ROOM, bad, 256)).toBeNull()
  })

  test("batches and snapshots keep every signed byte and position", async () => {
    const pair = await generateSigningKeyPair()
    const pub = await exportPublicKey(pair.publicKey)
    const signed = await signComment(ROOM, body(toBase64Url(pub)), pair.privateKey, pub)
    const [back] = decodeCommentBatch(encodeCommentBatch([signed]))
    expect(back).toEqual(signed)
    const snap = decodeCommentSnapshot(encodeCommentSnapshot([{ pos: 513, signed }]))
    expect(snap).toEqual([{ pos: 513, signed }])
    expect(() => decodeCommentBatch(new Uint8Array([0]))).toThrow()
  })
})

/** The relay's comment log in miniature: order, ack, fan out to subscribers. */
class MiniRelay {
  readonly log: LogEntry[] = []
  private readonly subs = new Map<CommentSession, CommentChannel>()
  append(from: CommentSession | null, env: Uint8Array): number {
    const entry = { seq: this.log.length + 1, origin: "user" as const, env }
    this.log.push(entry)
    for (const [s, ch] of this.subs) if (s !== from) ch.onEntries(s, [entry])
    return entry.seq
  }
  connect(channel: CommentChannel): CommentSession {
    let next = 0
    const session: CommentSession = {
      send: (m: ClientMessage) => {
        if (m.type === "comments-subscribe") {
          this.subs.set(session, channel)
          channel.onEntries(session, this.log.slice(m.since))
        } else if (m.type === "append-comment")
          channel.onAck(session, m.cid, this.append(session, m.env))
      },
      cid: () => ++next,
      token: () => "t",
      alive: () => true,
      edit: true,
      maxEntryBytes: 1024 * 1024,
      maxSnapshotBytes: 1024 * 1024,
      info: { head: this.log.length, base: 0, snapshot: null },
      resync: () => {
        throw new Error("unexpected gap")
      },
    }
    channel.start(session)
    return session
  }
}

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5))
}

async function signer(pair?: CryptoKeyPair): Promise<CommentSigner> {
  const p = pair ?? (await generateSigningKeyPair())
  return { privateKey: p.privateKey, publicKey: await exportPublicKey(p.publicKey) }
}

describe("comment channel", () => {
  test("two devices converge; a forged edit is dropped; the root key deletes any thread", async () => {
    const rootPair = await generateSigningKeyPair()
    const root = await signer(rootPair)
    const roomId = await deriveRoomId(root.publicKey)
    const keys: RoomKeys = await deriveRoomKeys(generateRoomKey(), roomId)
    const http = new RelayHttpClient({ relayUrl: "https://relay.invalid" })
    const relay = new MiniRelay()
    const devA = await signer()
    const devB = await signer()
    const a = new CommentStore()
    const b = new CommentStore()
    const opts = { room: roomId.id, keys, http, origin: "remote:mp:test" as const }
    const chA = new CommentChannel({ ...opts, store: a, device: devA, root })
    const chB = new CommentChannel({ ...opts, store: b, device: devB })
    relay.connect(chA)
    relay.connect(chB)
    await settle()
    const ana = { id: `dev:${toBase64Url(devA.publicKey)}`, name: "Ana", kind: "person" as const }
    const bo = { id: `dev:${toBase64Url(devB.publicKey)}`, name: "Bo", kind: "person" as const }
    const t = a.createThread(
      { anchor: { x: 1, y: 1 }, message: { author: ana, text: "Hi" } },
      "user",
    )
    await settle()
    expect(b.thread(t.threadId)?.messages[t.messageId]?.text).toBe("Hi")
    b.reply(t.threadId, { author: bo, text: "Hey" }, "user")
    const own = b.createThread(
      { anchor: { x: 5, y: 5 }, message: { author: bo, text: "Mine" } },
      "user",
    )
    await settle()
    expect(Object.keys(a.thread(t.threadId)?.messages ?? {})).toHaveLength(2)
    expect(a.threads()).toEqual(b.threads())

    // A modified client signs an edit of Ana's message with Bo's key.
    const forged = await signComment(
      roomId.id,
      {
        v: 1,
        id: "Forged0001",
        n: 99,
        base: b.position,
        at: "2026-11-19T10:00:00.000Z",
        op: "edit",
        thread: t.threadId,
        message: t.messageId,
        text: "pwned",
      },
      devB.privateKey,
      devB.publicKey,
    )
    relay.append(null, await sealCommentsUpdate(keys, encodeCommentBatch([forged])))
    await settle()
    expect(a.thread(t.threadId)?.messages[t.messageId]?.text).toBe("Hi")
    expect(b.thread(t.threadId)?.messages[t.messageId]?.text).toBe("Hi")

    // The owner's device deletes Bo's thread with the root key; Bo's device learns that key.
    a.deleteThread(own.threadId, ana.id, "user", { moderator: true })
    await settle()
    expect(a.thread(own.threadId)).toBeUndefined()
    expect(b.thread(own.threadId)).toBeUndefined()
    expect(a.threads()).toEqual(b.threads())
    await chA.dispose()
    await chB.dispose()
  })

  test("after a relay loses its log, a device's edits, resolves and reactions come back", async () => {
    const root = await signer()
    const roomId = await deriveRoomId(root.publicKey)
    const keys = await deriveRoomKeys(generateRoomKey(), roomId)
    const http = new RelayHttpClient({ relayUrl: "https://relay.invalid" })
    const opts = { room: roomId.id, keys, http, origin: "remote:mp:test" as const }
    const dev = await signer()
    const a = new CommentStore()
    const chA = new CommentChannel({ ...opts, store: a, device: dev, root })
    new MiniRelay().connect(chA)
    await settle()
    const ana = { id: `dev:${toBase64Url(dev.publicKey)}`, name: "Ana", kind: "person" as const }
    // Earlier entries, so the old changes' bases lie past every position of the new log.
    for (const text of ["a", "b", "c"]) {
      a.createThread({ anchor: { x: 0, y: 0 }, message: { author: ana, text } }, "user")
      await settle()
    }
    const t = a.createThread(
      { anchor: { x: 1, y: 1 }, message: { author: ana, text: "3rd" } },
      "user",
    )
    await settle()
    a.editMessage(t.threadId, t.messageId, "10th", ana.id, "user")
    a.setResolved(t.threadId, ana, "user")
    a.toggleReaction(t.threadId, t.messageId, "👍", ana.id, "user")
    await settle()
    // The relay comes back empty; the device reconnects and sends what it holds.
    chA.stop()
    const fresh = new MiniRelay()
    fresh.connect(chA)
    await settle()
    const b = new CommentStore()
    const chB = new CommentChannel({ ...opts, store: b, device: await signer() })
    fresh.connect(chB)
    await settle()
    const got = b.thread(t.threadId)
    expect(got?.messages[t.messageId]?.text).toBe("10th")
    expect(got?.resolved?.by.id).toBe(ana.id)
    expect(got?.messages[t.messageId]?.reactions?.["👍"]).toEqual([ana.id])
    await chA.dispose()
    await chB.dispose()
  })

  test("after a relay loses its log, a guest that takes a thread's id first neither erases nor keeps it", async () => {
    const root = await signer()
    const roomId = await deriveRoomId(root.publicKey)
    const keys = await deriveRoomKeys(generateRoomKey(), roomId)
    const http = new RelayHttpClient({ relayUrl: "https://relay.invalid" })
    const opts = { room: roomId.id, keys, http, origin: "remote:mp:test" as const }
    const [dev, guest, troll] = [await signer(), await signer(), await signer()]
    const a = new CommentStore()
    const chA = new CommentChannel({ ...opts, store: a, device: dev, root })
    const g = new CommentStore()
    const chG = new CommentChannel({ ...opts, store: g, device: guest })
    const old = new MiniRelay()
    old.connect(chA)
    old.connect(chG)
    await settle()
    const person = (k: CommentSigner, name: string) =>
      ({ id: `dev:${toBase64Url(k.publicKey)}`, name, kind: "person" }) as const
    const [ana, bo] = [person(dev, "Ana"), person(guest, "Bo")]
    const at = { x: 0, y: 0 }
    for (const text of ["a", "b", "c", "d", "e"]) {
      a.createThread({ anchor: at, message: { author: ana, text } }, "user")
      await settle()
    }
    const launch = a.createThread({ anchor: at, message: { author: ana, text: "Launch" } }, "user")
    await settle()
    const mine = g.createThread({ anchor: at, message: { author: bo, text: "Mine" } }, "user")
    await settle()
    const gone = g.createThread({ anchor: at, message: { author: bo, text: "Gone" } }, "user")
    await settle()
    // The relay comes back empty and a troll who noted the ids writes first.
    const fresh = new MiniRelay()
    const author = person(troll, "Troll")
    const forge = (n: number, op: Record<string, unknown>) =>
      signComment(
        roomId.id,
        {
          v: 1,
          id: `Troll0000${n}`,
          n,
          base: 0,
          at: "2026-11-20T10:00:00.000Z",
          ...op,
        } as CommentRecordBody,
        troll.privateKey,
        troll.publicKey,
      )
    const batch = [
      await forge(1, {
        op: "thread",
        thread: launch.threadId,
        message: "TrollMsg01",
        anchor: at,
        author,
        text: "spam",
      }),
      await forge(2, { op: "delete", thread: launch.threadId }),
      await forge(3, {
        op: "thread",
        thread: mine.threadId,
        message: "TrollMsg02",
        anchor: at,
        author,
        text: "spam",
      }),
    ]
    fresh.append(null, await sealCommentsUpdate(keys, encodeCommentBatch(batch)))
    chA.stop()
    chG.stop()
    // The guest is back first and deletes its own thread: that delete stands.
    fresh.connect(chG)
    await settle()
    g.deleteThread(gone.threadId, bo.id, "user")
    await settle()
    fresh.connect(chA)
    await settle()
    const b = new CommentStore()
    const chB = new CommentChannel({ ...opts, store: b, device: await signer() })
    fresh.connect(chB)
    await settle()
    for (const s of [a, g, b]) {
      const texts = Object.values(s.threads()).map((t) => t.messages[t.first]?.text)
      expect(texts).toContain("Launch")
      expect(texts).toContain("Mine")
      expect(texts).not.toContain("spam")
      expect(texts).not.toContain("Gone")
    }
    for (const ch of [chA, chG, chB]) await ch.dispose()
  })

  test("a device folding its saved replica knows the room root key before it enters", async () => {
    const root = await signer()
    const roomId = await deriveRoomId(root.publicKey)
    const keys = await deriveRoomKeys(generateRoomKey(), roomId)
    const troll = await signer()
    const created = await signComment(
      roomId.id,
      body(toBase64Url(troll.publicKey)),
      troll.privateKey,
      troll.publicKey,
    )
    const removed = await signComment(
      roomId.id,
      {
        v: 1,
        id: "Change0002",
        n: 1,
        base: 256,
        at: "2026-11-19T10:00:00.000Z",
        op: "delete",
        thread: "Thread0001",
      },
      root.privateKey,
      root.publicKey,
    )
    const replica = new MemoryCommentReplicaStore()
    await replica.save(roomId.id, {
      since: 0,
      changes: [
        { pos: 256, signed: created },
        { pos: 512, signed: removed },
      ],
      unsent: [],
    })
    const store = new CommentStore()
    const ch = new CommentChannel({
      room: roomId.id,
      keys,
      http: new RelayHttpClient({ relayUrl: "https://relay.invalid" }),
      origin: "remote:mp:test",
      store,
      device: await signer(),
      replica,
    })
    new MiniRelay().connect(ch)
    await settle()
    expect(store.room?.root).toBe(toBase64Url(root.publicKey))
    expect(store.thread("Thread0001")).toBeUndefined()
    await ch.dispose()
  })
})
