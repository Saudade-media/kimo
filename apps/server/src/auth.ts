/**
 * Token verification against a room (docs/spec/multiplayer.md §4) and the shared helpers the
 * WebSocket and HTTP layers use. The relay holds only the room's public link key, so it can
 * check a capability but never mint one.
 */
import {
  MultiplayerError,
  type ParsedToken,
  parseToken,
  toHex,
  verifyTokenSignature,
} from "@kimo/sync/mp"
import type { RelayDb, RoomRow } from "./db"

export interface VerifiedToken {
  token: ParsedToken
  room: RoomRow
  jtiHex: string
}

/**
 * The §4 order, first failure wins. `room` is the id from the path; the row may be null when the
 * room is unknown.
 */
export async function verifyToken(
  db: RelayDb,
  roomId: string,
  text: string,
  nowSeconds: number,
): Promise<VerifiedToken> {
  const token = parseToken(text)
  if (token.room.id !== roomId)
    throw new MultiplayerError("AUTH_INVALID", "token is for another room")
  const room = db.getRoom(roomId)
  if (!room) throw new MultiplayerError("ROOM_NOT_FOUND", "unknown room")
  if (room.closed_at !== null)
    throw new MultiplayerError("ROOM_CLOSED", "the owner stopped sharing")
  if (token.kid !== room.link_kid) throw new MultiplayerError("KEY_ROTATED", "links were reset")
  if (!(await verifyTokenSignature(token, room.link_pub)))
    throw new MultiplayerError("AUTH_INVALID", "bad token signature")
  if (token.role !== "view" && token.role !== "edit")
    throw new MultiplayerError("ROLE_UNSUPPORTED", "role not supported")
  if (token.exp !== 0 && token.exp <= nowSeconds)
    throw new MultiplayerError("TOKEN_EXPIRED", "token expired")
  if (db.isRevoked(roomId, token.jti)) throw new MultiplayerError("TOKEN_REVOKED", "token revoked")
  return { token, room, jtiHex: toHex(token.jti) }
}

/** `Authorization: Bearer <token>` to the token text, or throws AUTH_INVALID. */
export function bearerToken(req: Request): string {
  const header = req.headers.get("authorization")
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null
  if (!match?.[1]) throw new MultiplayerError("AUTH_INVALID", "missing bearer token")
  return match[1]
}

/**
 * Synchronous re-check of a token that was verified before an await (a body upload): the room may
 * have been closed, its links reset or the jti revoked meanwhile. The signature is not repeated.
 */
export function recheckToken(db: RelayDb, verified: VerifiedToken, nowSeconds: number): RoomRow {
  const { token } = verified
  const room = db.getRoom(token.room.id)
  if (!room || room.closed_at !== null)
    throw new MultiplayerError("ROOM_CLOSED", "the owner stopped sharing")
  if (room.link_kid !== token.kid) throw new MultiplayerError("KEY_ROTATED", "links were reset")
  if (token.exp !== 0 && token.exp <= nowSeconds)
    throw new MultiplayerError("TOKEN_EXPIRED", "token expired")
  if (db.isRevoked(room.id, token.jti)) throw new MultiplayerError("TOKEN_REVOKED", "token revoked")
  return room
}
