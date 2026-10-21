/**
 * Owner-signed room administration (docs/spec/multiplayer.md §6, §14.7): register, revoke,
 * rotate, close and sweep. Every command is signed by the room's root key, which the relay learns
 * only from the register command and checks against the room id. Register also carries the proof
 * that an owner device of this relay asked for the room, checked by the owner policy (`./policy`).
 */
import {
  type AdminCommand,
  equalBytes,
  fromBase64Url,
  fromHex,
  type LinkCert,
  MultiplayerError,
  parseAdminCommand,
  parseLinkCert,
  parseRoomId,
  roomMatchesRootKey,
  verifyAdminCommand,
  verifyLinkCert,
} from "@kimo/sync/mp"
import type { RoomGrant } from "./policy"
import type { Relay } from "./rooms"

const MAX_SKEW_MS = 300_000
const NONCE_TTL_MS = 600_000
const DAY_MS = 86_400_000

export interface AdminResult {
  status: number
  body: Record<string, unknown>
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== "string") throw new MultiplayerError("BAD_REQUEST", `missing ${key}`)
  return value
}

/** Parses and checks a certificate against the room and root key; throws AUTH_INVALID. */
async function checkCert(text: string, roomId: string, rootPub: Uint8Array): Promise<LinkCert> {
  const cert = parseLinkCert(fromBase64Url(text))
  if (cert.room.id !== roomId || !(await verifyLinkCert(cert, rootPub)))
    throw new MultiplayerError("AUTH_INVALID", "bad link certificate")
  return cert
}

export async function runAdmin(
  relay: Relay,
  roomId: string,
  bytes: Uint8Array,
): Promise<AdminResult> {
  const { db, config } = relay
  const command: AdminCommand = parseAdminCommand(bytes)
  if (command.room.id !== roomId)
    throw new MultiplayerError("BAD_REQUEST", "command is for another room")
  parseRoomId(roomId)

  let row = db.getRoom(roomId)
  let rootPub: Uint8Array
  let registerCert: LinkCert | null = null
  let grant: RoomGrant = { account: null, storageLimitBytes: null }

  if (command.op === "register") {
    rootPub = fromBase64Url(stringField(command.body, "rootPub"))
    if (!(await roomMatchesRootKey(command.room, rootPub)))
      throw new MultiplayerError("ROOM_ID_MISMATCH", "room id does not derive from the root key")
  } else {
    if (!row) throw new MultiplayerError("ROOM_NOT_FOUND", "unknown room")
    if (row.closed_at !== null) throw new MultiplayerError("ROOM_CLOSED", "room is closed")
    rootPub = row.root_pub
  }

  if (!(await verifyAdminCommand(command, rootPub)))
    throw new MultiplayerError("AUTH_INVALID", "bad admin signature")
  const now = relay.now()
  if (Math.abs(now - command.iat) > MAX_SKEW_MS)
    throw new MultiplayerError("STALE_REQUEST", "admin command is too old or too new")
  if (command.op === "register") {
    grant = await relay.owner.register(command, rootPub, row)
    registerCert = await checkCert(stringField(command.body, "cert"), roomId, rootPub)
  }
  if (!db.consumeNonce(roomId, command.nonce, command.iat + NONCE_TTL_MS))
    throw new MultiplayerError("NONCE_REPLAY", "admin nonce already used")

  // Re-read after the awaits above.
  row = db.getRoom(roomId)

  switch (command.op) {
    case "register": {
      if (!registerCert) throw new MultiplayerError("INTERNAL")
      const cert = registerCert
      const fresh = {
        id: roomId,
        rootPub,
        kid: cert.kid,
        linkPub: cert.linkPub,
        cert: cert.bytes,
        at: now,
        account: grant.account,
      }
      if (!row) {
        if (config.maxRooms > 0 && db.countOpenRooms() >= config.maxRooms)
          throw new MultiplayerError("RELAY_FULL", "this relay hosts as many rooms as it allows")
        relay.checkAccountStorage(grant, 0)
        db.insertRoom(fresh)
        return { status: 201, body: { room: roomId, kid: cert.kid } }
      }
      if (row.closed_at === null) {
        if (equalBytes(row.link_cert, cert.bytes))
          return { status: 200, body: { room: roomId, kid: row.link_kid } }
        throw new MultiplayerError("BAD_REQUEST", "room is already registered with another key")
      }
      if (cert.kid <= row.link_kid)
        throw new MultiplayerError("KEY_ID_INVALID", "reopening needs a newer link key id")
      if (config.maxRooms > 0 && db.countOpenRooms() >= config.maxRooms)
        throw new MultiplayerError("RELAY_FULL", "this relay hosts as many rooms as it allows")
      relay.checkAccountStorage(grant, 0)
      db.reopenRoom(fresh)
      relay.unload(roomId)
      return { status: 201, body: { room: roomId, kid: cert.kid } }
    }
    case "revoke": {
      const jtiText = stringField(command.body, "jti")
      const exp = command.body.exp
      db.addRevocation(roomId, fromHex(jtiText), typeof exp === "number" ? exp : 0, now)
      const closed = relay.closeWhere(roomId, (data) => data.jti === jtiText, "TOKEN_REVOKED")
      return { status: 200, body: { revoked: true, closed } }
    }
    case "rotate": {
      const cert = await checkCert(stringField(command.body, "cert"), roomId, rootPub)
      const current = db.getRoom(roomId)
      if (!current || current.closed_at !== null)
        throw new MultiplayerError("ROOM_CLOSED", "room is closed")
      if (cert.kid <= current.link_kid)
        throw new MultiplayerError("KEY_ID_INVALID", "link key id must increase")
      db.setLinkKey(roomId, cert.kid, cert.linkPub, cert.bytes)
      const closed = relay.closeWhere(roomId, () => true, "KEY_ROTATED")
      return { status: 200, body: { kid: cert.kid, closed } }
    }
    case "close": {
      relay.closeWhere(roomId, () => true, "ROOM_CLOSED")
      relay.unload(roomId)
      db.closeRoom(roomId, now)
      relay.blobs.deleteRoom(roomId)
      return { status: 200, body: {} }
    }
    case "sweep":
      return { status: 200, body: sweep(relay, roomId, command.body, now) }
  }
}

/** Owner sweep (§14.7): mark unreferenced blobs, delete those marked longer than the grace. */
function sweep(
  relay: Relay,
  roomId: string,
  body: Record<string, unknown>,
  now: number,
): Record<string, number> {
  const { db, config } = relay
  const keep = new Set<string>(body.keep as string[])
  const graceDays = typeof body.graceDays === "number" ? body.graceDays : config.sweepGraceDays
  const cutoff = now - graceDays * DAY_MS
  let marked = 0
  let kept = 0
  const doomed: string[] = []
  let bytesFreed = 0
  for (const blob of db.allBlobs(roomId)) {
    if (keep.has(blob.id)) {
      kept++
      if (blob.unref_since !== null) db.clearUnref(roomId, blob.id)
      continue
    }
    if (blob.unref_since === null) {
      db.setUnref(roomId, blob.id, now)
      marked++
    } else if (blob.unref_since <= cutoff) {
      doomed.push(blob.id)
      bytesFreed += blob.bytes
    }
  }
  for (const id of doomed) relay.blobs.delete(roomId, id)
  if (doomed.length > 0) db.deleteBlobRows(roomId, doomed, bytesFreed)
  return { marked, deleted: doomed.length, kept, bytesFreed }
}
