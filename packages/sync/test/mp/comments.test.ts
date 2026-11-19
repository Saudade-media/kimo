/** Signed comment changes (docs/spec/comments.md §4.1, §4.2). */
import { describe, expect, test } from "bun:test"
import type { CommentRecordBody } from "@kimo/editor-state"
import { exportPublicKey, generateSigningKeyPair, toBase64Url } from "../../src/mp"
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
