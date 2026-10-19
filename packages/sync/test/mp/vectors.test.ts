import { describe, expect, test } from "bun:test"
import {
  blobIdFor,
  deriveKeyBits,
  deriveRoomId,
  deriveRoomKeys,
  fromBase64Url,
  fromHex,
  fromUtf8,
  HKDF_INFO,
  mintToken,
  openAwareness,
  openBlob,
  openSnapshot,
  openUpdate,
  parseAdminCommand,
  parseLinkCert,
  parseToken,
  sealAwareness,
  sealBlob,
  sealSnapshot,
  sealUpdate,
  sha256,
  signAdminCommand,
  signLinkCert,
  toBase64Url,
  toHex,
  utf8,
  verifyAdminCommand,
  verifyLinkCert,
  verifyTokenSignature,
} from "../../src/mp"
import { keyPairFromSeed, seq } from "./helpers"
import vectors from "./vectors.json"

const iv = seq(12, 0xa0)

async function fixtures() {
  const root = await keyPairFromSeed(seq(32, 0x00))
  const link = await keyPairFromSeed(seq(32, 0x20))
  const room = await deriveRoomId(root.publicRaw)
  const roomKey = seq(32, 0x80)
  const keys = await deriveRoomKeys(roomKey, room)
  return { root, link, room, roomKey, keys }
}

describe("§19 vectors", () => {
  test("identity: public keys and room id", async () => {
    const { root, link, room } = await fixtures()
    expect(toHex(root.publicRaw)).toBe(vectors.identity.rootPublicKey)
    expect(toHex(link.publicRaw)).toBe(vectors.identity.linkPublicKey)
    expect(toHex(room.raw)).toBe(vectors.identity.roomIdRaw)
    expect(room.id).toBe(vectors.identity.roomId)
  })

  test("token reproduces byte for byte and verifies", async () => {
    const { link, room } = await fixtures()
    const v = vectors.token
    const token = await mintToken(link.privateKey, {
      room,
      role: "edit",
      kid: v.kid,
      iat: v.iat,
      exp: v.exp,
      jti: seq(16, 0x40),
      origin: "user",
    })
    expect(token).toBe(v.token)
    const parsed = parseToken(token)
    expect(toHex(parsed.payload)).toBe(v.payload)
    expect(parsed).toMatchObject({ role: "edit", kid: 1, iat: v.iat, exp: v.exp, origin: "user" })
    expect(parsed.room.id).toBe(room.id)
    expect(toHex(parsed.jti)).toBe(toHex(seq(16, 0x40)))
    expect(await verifyTokenSignature(parsed, link.publicRaw)).toBe(true)
  })

  test("link certificate reproduces and verifies", async () => {
    const { root, link, room } = await fixtures()
    const cert = await signLinkCert(root.privateKey, {
      kid: vectors.linkCert.kid,
      iat: vectors.linkCert.iat,
      room,
      linkPub: link.publicRaw,
    })
    expect(toBase64Url(cert.bytes)).toBe(vectors.linkCert.cert)
    const parsed = parseLinkCert(fromBase64Url(vectors.linkCert.cert))
    expect(parsed.kid).toBe(1)
    expect(parsed.iat).toBe(vectors.linkCert.iat)
    expect(toHex(parsed.linkPub)).toBe(vectors.identity.linkPublicKey)
    expect(await verifyLinkCert(parsed, root.publicRaw)).toBe(true)
  })

  test("admin register: body and signature", async () => {
    const { root, room } = await fixtures()
    const v = vectors.adminRegister
    const body = JSON.parse(v.body) as { rootPub: string; cert: string }
    expect(body.rootPub).toBe(toBase64Url(root.publicRaw))
    const bytes = await signAdminCommand(
      root.privateKey,
      room,
      { op: "register", rootPub: body.rootPub, cert: body.cert },
      { iat: v.iat, nonce: seq(16, 0x60) },
    )
    expect(toHex(bytes.subarray(bytes.length - 64))).toBe(v.signature)
    const command = parseAdminCommand(bytes)
    expect(command.op).toBe("register")
    expect(command.iat).toBe(v.iat)
    expect(fromUtf8(command.payload.subarray(52))).toBe(v.body)
    expect(await verifyAdminCommand(command, root.publicRaw)).toBe(true)
  })

  test("HKDF outputs", async () => {
    const { room, roomKey } = await fixtures()
    expect(toBase64Url(roomKey)).toBe(vectors.keys.roomKeyBase64Url)
    expect(toHex(await deriveKeyBits(roomKey, room, HKDF_INFO.doc))).toBe(vectors.keys.doc)
    expect(toHex(await deriveKeyBits(roomKey, room, HKDF_INFO.awareness))).toBe(
      vectors.keys.awareness,
    )
    expect(toHex(await deriveKeyBits(roomKey, room, HKDF_INFO.blobId))).toBe(vectors.keys.blobMac)
    expect(
      toHex(await deriveKeyBits(roomKey, room, HKDF_INFO.blobPrefix + vectors.blob.sha256)),
    ).toBe(vectors.blob.blobKey)
  })

  test("derived CryptoKeys are non-extractable", async () => {
    const { keys } = await fixtures()
    expect(keys.doc.extractable).toBe(false)
    expect(keys.awareness.extractable).toBe(false)
    expect(keys.blobMac.extractable).toBe(false)
    expect((await keys.blobKey(fromHex(vectors.blob.sha256))).extractable).toBe(false)
  })

  test("blob: digest, id and envelope", async () => {
    const { keys } = await fixtures()
    const plaintext = utf8(vectors.blob.plaintextUtf8)
    const sha = await sha256(plaintext)
    expect(toHex(sha)).toBe(vectors.blob.sha256)
    expect(await blobIdFor(keys, sha)).toBe(vectors.blob.blobId)
    const sealed = await sealBlob(keys, plaintext, { iv })
    expect(sealed.id).toBe(vectors.blob.blobId)
    expect(toHex(sealed.envelope)).toBe(vectors.blob.envelope)
    const opened = await openBlob(keys, sha, fromHex(vectors.blob.envelope))
    expect(fromUtf8(opened)).toBe(vectors.blob.plaintextUtf8)
  })

  test("update, snapshot and awareness envelopes", async () => {
    const { keys } = await fixtures()
    const e = vectors.envelopes
    const update = await sealUpdate(keys, fromHex(e.update.plaintext), { iv })
    expect(toHex(update)).toBe(e.update.envelope)
    expect(toHex(await openUpdate(keys, fromHex(e.update.envelope)))).toBe(e.update.plaintext)

    const snapshot = await sealSnapshot(keys, e.snapshot.upTo, fromHex(e.snapshot.plaintext), {
      iv,
    })
    expect(toHex(snapshot)).toBe(e.snapshot.envelope)
    expect(toHex(await openSnapshot(keys, e.snapshot.upTo, fromHex(e.snapshot.envelope)))).toBe(
      e.snapshot.plaintext,
    )

    const json = utf8(e.awareness.plaintextUtf8)
    const awareness = await sealAwareness(keys, e.awareness.peer, json, { iv })
    expect(toHex(awareness)).toBe(e.awareness.envelope)
    expect(
      fromUtf8(await openAwareness(keys, e.awareness.peer, fromHex(e.awareness.envelope))),
    ).toBe(e.awareness.plaintextUtf8)
  })

  test("the stated AAD strings are the ones bound (raw AES-GCM cross-check)", async () => {
    const { room } = await fixtures()
    expect(room.id).toBe(vectors.identity.roomId)
    const docKey = await crypto.subtle.importKey(
      "raw",
      fromHex(vectors.keys.doc),
      "AES-GCM",
      false,
      ["decrypt"],
    )
    for (const v of [vectors.envelopes.update, vectors.envelopes.snapshot]) {
      const env = fromHex(v.envelope)
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: env.slice(2, 14), additionalData: utf8(v.aad) },
        docKey,
        env.slice(14),
      )
      expect(toHex(new Uint8Array(plain))).toBe(v.plaintext)
    }
  })
})
