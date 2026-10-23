/**
 * Relay ownership (docs/spec/multiplayer.md §6, §6.1, §6.2, §14.11, ADR 0017). The owner set is
 * the device public keys allowed to register rooms and to run owner commands; empty means
 * unclaimed. Boot seeds or resets it from the environment; `POST /owner` claims, lists, pairs,
 * removes, renames and cancels. Every change is one synchronous SQLite transaction, so concurrent
 * requests serialize. The relay logs neither device names nor public keys.
 */
import { createHash } from "node:crypto"
import {
  type AdminCommand,
  equalBytes,
  fromBase64Url,
  fromHex,
  MultiplayerError,
  type OwnerCommand,
  type OwnerDevice,
  PAIRING_MAX_TTL_SECONDS,
  parseOwnerCommand,
  parsePairingToken,
  RELAY_ID_BYTES,
  randomBytes,
  toBase64Url,
  verifyOwnerCommand,
  verifyPairingToken,
  verifyRegisterOwner,
} from "@kimo/sync/mp"
import type { OwnerRow, RelayDb } from "./db"
import type { Relay } from "./rooms"

const MAX_SKEW_MS = 300_000
const NONCE_TTL_MS = 600_000
/** Name of a device added by `KIMO_OWNER_KEY`, until it claims and names itself. */
export const ENV_DEVICE_NAME = "Added at deploy"

export interface OwnerResult {
  status: number
  body: Record<string, unknown>
}

/** The relay id from `relay_meta`, made on first boot (§14.11 step 1). */
export function bootRelayId(db: RelayDb): Uint8Array {
  let relayId = db.getMeta("relay_id")
  if (!relayId || relayId.length !== RELAY_ID_BYTES) {
    relayId = randomBytes(RELAY_ID_BYTES)
    db.setMeta("relay_id", relayId)
  }
  return relayId
}

/**
 * Boot (§14.11), before the server listens: the relay id, `KIMO_RESET_OWNER` once per distinct
 * value, then `KIMO_OWNER_KEY` on an empty set. Returns the relay id.
 */
export function bootOwnership(
  db: RelayDb,
  config: { ownerKeys: readonly Uint8Array[]; resetOwner: string | null },
  now: number,
  log?: (line: string) => void,
): Uint8Array {
  const relayId = bootRelayId(db)
  if (config.resetOwner !== null) {
    const hash = new Uint8Array(createHash("sha256").update(config.resetOwner).digest())
    const applied = db.getMeta("reset_applied")
    if (!applied || !equalBytes(applied, hash)) {
      db.tx(() => {
        db.clearOwners()
        db.setMeta("reset_applied", hash)
      })
      log?.(
        "warn: KIMO_RESET_OWNER cleared the owner list. Claim the relay from Kimo, then remove the variable.",
      )
    }
  }
  if (db.countOwners() === 0 && config.ownerKeys.length > 0)
    db.tx(() => {
      for (const pub of config.ownerKeys)
        db.insertOwner({ pub, name: ENV_DEVICE_NAME, added_at: now, added_by: null, via: "env" })
    })
  const n = db.countOwners()
  log?.(
    n === 0
      ? "owner: unclaimed, claim it from Kimo"
      : `owner: claimed (${n} ${n === 1 ? "device" : "devices"})`,
  )
  return relayId
}

export function deviceOf(row: OwnerRow): OwnerDevice {
  return {
    pub: toBase64Url(row.pub),
    name: row.name,
    addedAt: row.added_at,
    addedBy: row.added_by ? toBase64Url(row.added_by) : null,
    via: row.via,
  }
}

const devices = (db: RelayDb) => ({ devices: db.owners().map(deviceOf) })

/** `RELAY_UNCLAIMED` on an empty set, `NOT_OWNER` when `pub` is not in it. */
function requireOwner(db: RelayDb, pub: Uint8Array): OwnerRow {
  if (db.countOwners() === 0) throw new MultiplayerError("RELAY_UNCLAIMED", "no owner device yet")
  const row = db.owner(pub)
  if (!row) throw new MultiplayerError("NOT_OWNER", "this device does not own the relay")
  return row
}

/**
 * The register owner proof (§6), checked after the root signature and freshness, first failure
 * wins: unclaimed, no proof or not an owner, then the proof's signature.
 */
export async function checkRegisterOwner(
  relay: Relay,
  command: AdminCommand,
  rootPub: Uint8Array,
): Promise<void> {
  const { db } = relay
  if (db.countOwners() === 0)
    throw new MultiplayerError("RELAY_UNCLAIMED", "claim the relay before creating rooms")
  const owner = command.body.owner as { pub: string; sig: string } | undefined
  if (owner === undefined) throw new MultiplayerError("NOT_OWNER", "missing owner proof")
  let pub: Uint8Array
  try {
    pub = fromBase64Url(owner.pub)
  } catch {
    throw new MultiplayerError("NOT_OWNER", "this device does not own the relay")
  }
  if (!db.owner(pub)) throw new MultiplayerError("NOT_OWNER", "this device does not own the relay")
  const ok = await verifyRegisterOwner(owner, {
    relayId: relay.relayId,
    room: command.room,
    nonce: command.nonce,
    iat: command.iat,
    rootPub,
  })
  if (!ok) throw new MultiplayerError("AUTH_INVALID", "bad owner proof")
}

/** `POST /owner` (§6.1): verifies one owner command and runs its op. */
export async function runOwner(relay: Relay, bytes: Uint8Array): Promise<OwnerResult> {
  const { db } = relay
  const command: OwnerCommand = parseOwnerCommand(bytes)
  if (!equalBytes(command.relayId, relay.relayId))
    throw new MultiplayerError("AUTH_INVALID", "command is for another relay")
  if (!(await verifyOwnerCommand(command)))
    throw new MultiplayerError("AUTH_INVALID", "bad device signature")
  const now = relay.now()
  if (Math.abs(now - command.iat) > MAX_SKEW_MS)
    throw new MultiplayerError("STALE_REQUEST", "owner command is too old or too new")
  if (!db.consumeNonce("", command.nonce, command.iat + NONCE_TTL_MS))
    throw new MultiplayerError("NONCE_REPLAY", "owner nonce already used")

  const self = command.devicePub
  const body = command.body
  switch (command.op) {
    case "claim": {
      const name = body.name as string
      return db.tx(() => {
        if (db.countOwners() === 0) {
          db.insertOwner({ pub: self, name, added_at: now, added_by: null, via: "claim" })
          return { status: 201, body: devices(db) }
        }
        if (!db.renameOwner(self, name))
          throw new MultiplayerError("RELAY_CLAIMED", "this relay already has an owner")
        return { status: 200, body: devices(db) }
      })
    }
    case "devices":
      requireOwner(db, self)
      return { status: 200, body: devices(db) }
    case "pair":
      return pair(relay, self, body.token as string, body.name as string, now)
    case "remove": {
      const target = fromBase64Url(body.pub as string)
      return db.tx(() => {
        requireOwner(db, self)
        if (!db.owner(target)) throw new MultiplayerError("NOT_FOUND", "no such device")
        if (db.countOwners() <= 1)
          throw new MultiplayerError("LAST_DEVICE", "the relay needs at least one device")
        db.deleteOwner(target)
        return { status: 200, body: devices(db) }
      })
    }
    case "cancel-pairing":
      requireOwner(db, self)
      db.usePairing(fromHex(body.jti as string), body.exp as number)
      return { status: 200, body: {} }
    case "rename": {
      requireOwner(db, self)
      if (!db.renameOwner(fromBase64Url(body.pub as string), body.name as string))
        throw new MultiplayerError("NOT_FOUND", "no such device")
      return { status: 200, body: devices(db) }
    }
  }
}

/** Op 3: the §6.2 verification, then the device and the burned `jti` in one transaction. */
async function pair(
  relay: Relay,
  self: Uint8Array,
  text: string,
  name: string,
  now: number,
): Promise<OwnerResult> {
  const { db } = relay
  if (db.countOwners() === 0) throw new MultiplayerError("RELAY_UNCLAIMED", "no owner device yet")
  const invalid = (why: string) => new MultiplayerError("AUTH_INVALID", `pairing link: ${why}`)
  const token = parsePairingToken(text)
  if (!equalBytes(token.relayId, relay.relayId)) throw invalid("for another relay")
  const issuerOk = (row: OwnerRow | null) =>
    row !== null && token.iat >= Math.floor(row.added_at / 1000) - 300
  if (!issuerOk(db.owner(token.issuerPub))) throw invalid("issuer is not a device of this relay")
  if (!(await verifyPairingToken(token))) throw invalid("bad signature")
  const seconds = Math.floor(now / 1000)
  if (
    token.exp <= token.iat ||
    token.exp - token.iat > PAIRING_MAX_TTL_SECONDS ||
    token.iat > seconds + 300
  )
    throw invalid("bad lifetime")
  if (token.exp <= seconds)
    throw new MultiplayerError("PAIRING_EXPIRED", "the pairing link expired")
  return db.tx(() => {
    // Re-read after the await: the issuer may have been removed meanwhile.
    if (!issuerOk(db.owner(token.issuerPub))) throw invalid("issuer is not a device of this relay")
    // An existing owner does not use the link up.
    if (db.owner(self)) return { status: 200, body: devices(db) }
    if (!db.usePairing(token.jti, token.exp))
      throw new MultiplayerError("PAIRING_USED", "the pairing link was already used or cancelled")
    db.insertOwner({ pub: self, name, added_at: now, added_by: token.issuerPub, via: "pair" })
    return { status: 201, body: devices(db) }
  })
}
