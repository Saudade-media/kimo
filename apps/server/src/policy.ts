/**
 * Owner policy (docs/spec/multiplayer.md §14.12, ADR 0018 decision 6): who may register rooms and
 * run owner commands, chosen once at startup. `devices` (default) is the ADR 0017 owner set in
 * `relay.sqlite` (`./owners`), unchanged. `external` hands the register decision to a module the
 * operator names in `KIMO_OWNER_POLICY_MODULE`: it says whether a device may create a room, for
 * which account, and how many bytes that account may store. The relay records the account on the
 * room and the limit on the account, and enforces it from its own byte counts on every write (log
 * append, snapshot, blob); owner commands answer `OWNER_EXTERNAL`.
 */
import { pathToFileURL } from "node:url"
import {
  type AdminCommand,
  isDevicePub,
  MultiplayerError,
  toBase64Url,
  verifyRegisterOwner,
} from "@kimo/sync/mp"
import type { RoomRow } from "./db"
import { checkRegisterOwner, type OwnerResult, runOwner } from "./owners"
import type { Relay } from "./rooms"

/** How long the relay waits for a policy module's answer before failing the request. */
export const POLICY_TIMEOUT_MS = 10_000
const MAX_ACCOUNT_LENGTH = 256

/** What the relay asks before a register (§6 op 1). Keys are base64url, like `/version`. */
export interface RegisterRequest {
  relayId: string
  /** The room id (base32). */
  room: string
  /** The device whose owner proof verified. */
  devicePub: string
  /** `new` creates the room, `closed` reopens it, `open` repeats a register (idempotent). */
  state: "new" | "open" | "closed"
}

/**
 * What the relay asks before storing a blob in a room that has an account, and (with `bytes` 0)
 * when an editor joins such a room, to refresh the account's limit.
 */
export interface WriteRequest {
  relayId: string
  room: string
  account: string
  /** Envelope bytes about to be stored; 0 for the refresh as an editor joins. */
  bytes: number
}

export interface PolicyDenial {
  allow: false
  /** `NOT_OWNER`: this device may not create rooms here. `PLAN_REQUIRED`: the account needs a plan. */
  code: "NOT_OWNER" | "PLAN_REQUIRED"
  message?: string
}

export type RegisterDecision =
  | {
      allow: true
      /** Opaque account id, 1 to 256 characters. The relay stores it on the room. */
      account: string
      /** Bytes the account may store over its open rooms; null or omitted for no limit. */
      storageLimitBytes?: number | null
    }
  | PolicyDenial

export type WriteDecision = { allow: true; storageLimitBytes?: number | null } | PolicyDenial

/** What `KIMO_OWNER_POLICY_MODULE` default-exports. Either method may be async. */
export interface OwnerPolicyModule {
  register(request: RegisterRequest): RegisterDecision | Promise<RegisterDecision>
  write(request: WriteRequest): WriteDecision | Promise<WriteDecision>
}

/** A register the policy allowed: the account to record on a new or reopened room (null: none). */
export interface RoomGrant {
  account: string | null
}

/** The relay's owner checks, behind one interface (§14.12). */
export interface OwnerPolicy {
  readonly mode: "devices" | "external"
  /** The `/version` `owner` field. */
  status(): "unclaimed" | "claimed" | "external"
  /** The register owner proof (§6), after the root signature and freshness, before the cert. */
  register(command: AdminCommand, rootPub: Uint8Array): Promise<void>
  /**
   * The room's account, asked last: after the owner proof, the certificate, the nonce and the
   * room checks, so only a register that would otherwise commit is asked about.
   */
  grant(command: AdminCommand, row: RoomRow | null): Promise<RoomGrant>
  /**
   * Before a blob write into `room` (which has an account): records the account's limit, or
   * throws the denial after recording the account read-only (limit 0).
   */
  write(room: RoomRow & { account: string }, bytes: number): Promise<void>
  /**
   * As an editor joins `room`: refreshes its account's limit like `write` with no bytes. Never
   * throws: a module that fails or does not answer leaves the recorded limit as it was.
   */
  join(room: RoomRow): Promise<void>
  /** `POST /owner` (§6.1). */
  owner(bytes: Uint8Array): Promise<OwnerResult>
}

/** The ADR 0017 owner set: register needs an owner device, rooms get no account. */
export function devicesPolicy(relay: Relay): OwnerPolicy {
  return {
    mode: "devices",
    status: () => (relay.db.countOwners() === 0 ? "unclaimed" : "claimed"),
    async register(command, rootPub) {
      await checkRegisterOwner(relay, command, rootPub)
    },
    grant: async () => ({ account: null }),
    write: async () => {},
    join: async () => {},
    owner: (bytes) => runOwner(relay, bytes),
  }
}

/** Resolves `work`, or fails with `INTERNAL` after {@link POLICY_TIMEOUT_MS}. */
async function bounded<T>(work: T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new MultiplayerError("INTERNAL", "the owner policy did not answer")),
      POLICY_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([Promise.resolve(work), timeout])
  } finally {
    clearTimeout(timer)
  }
}

function malformed(what: string): MultiplayerError {
  return new MultiplayerError("INTERNAL", `the owner policy returned a malformed ${what}`)
}

function limitOf(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw malformed("storage limit")
  return value
}

/** Throws the denial's code, or `INTERNAL` for anything that is not a decision. */
function allowed(decision: unknown, what: string): Record<string, unknown> {
  if (typeof decision !== "object" || decision === null) throw malformed(what)
  const record = decision as Record<string, unknown>
  if (record.allow === true) return record
  if (record.allow !== false || (record.code !== "NOT_OWNER" && record.code !== "PLAN_REQUIRED"))
    throw malformed(what)
  const message = typeof record.message === "string" && record.message ? record.message : undefined
  throw new MultiplayerError(
    record.code,
    message ??
      (record.code === "NOT_OWNER"
        ? "this device may not create rooms on this relay"
        : "this account needs a plan"),
  )
}

/**
 * Accounts from a policy module. Register still needs the device's owner proof (§6): it shows the
 * device holds the key the module is asked about.
 */
export function externalPolicy(relay: Relay, module: OwnerPolicyModule): OwnerPolicy {
  const relayId = () => toBase64Url(relay.relayId)
  const record = (account: string, limit: number | null) =>
    relay.db.setAccountLimit(account, limit, relay.now())
  const write = async (room: RoomRow & { account: string }, bytes: number) => {
    let decision: Record<string, unknown>
    try {
      decision = allowed(
        await bounded(
          module.write({ relayId: relayId(), room: room.id, account: room.account, bytes }),
        ),
        "write decision",
      )
    } catch (error) {
      // A denial makes the account read-only until the module next allows (ADR 0018 decision 8).
      if (
        error instanceof MultiplayerError &&
        (error.code === "NOT_OWNER" || error.code === "PLAN_REQUIRED")
      )
        record(room.account, 0)
      throw error
    }
    record(room.account, limitOf(decision.storageLimitBytes))
  }
  return {
    mode: "external",
    status: () => "external",
    async register(command, rootPub) {
      const owner = command.body.owner as { pub: string; sig: string } | undefined
      if (owner === undefined) throw new MultiplayerError("NOT_OWNER", "missing owner proof")
      if (!isDevicePub(owner.pub)) throw new MultiplayerError("NOT_OWNER", "bad owner proof key")
      const ok = await verifyRegisterOwner(owner, {
        relayId: relay.relayId,
        room: command.room,
        nonce: command.nonce,
        iat: command.iat,
        rootPub,
      })
      if (!ok) throw new MultiplayerError("AUTH_INVALID", "bad owner proof")
    },
    async grant(command, row) {
      const owner = command.body.owner as { pub: string }
      // A repeat for an open room without an account (registered before the switch to external)
      // changes nothing, so the module is not asked about it.
      if (row && row.closed_at === null && row.account === null) return { account: null }
      const state = !row ? "new" : row.closed_at === null ? "open" : "closed"
      const decision = allowed(
        await bounded(
          module.register({
            relayId: relayId(),
            room: command.room.id,
            devicePub: owner.pub,
            state,
          }),
        ),
        "register decision",
      )
      const account = decision.account
      if (typeof account !== "string" || account.length < 1 || account.length > MAX_ACCOUNT_LENGTH)
        throw malformed("account")
      record(account, limitOf(decision.storageLimitBytes))
      return { account }
    },
    write,
    async join(room) {
      const { account } = room
      if (account === null) return
      await write({ ...room, account }, 0).catch(() => {})
    },
    owner: async () => {
      throw new MultiplayerError("OWNER_EXTERNAL", "this relay's owners are managed outside Kimo")
    },
  }
}

/**
 * Imports `KIMO_OWNER_POLICY_MODULE` (a path, relative to the working directory, or a `file:` URL) and
 * checks that its default export has `register` and `write`. Throws an Error naming the variable.
 */
export async function loadOwnerPolicy(specifier: string): Promise<OwnerPolicyModule> {
  const name = "KIMO_OWNER_POLICY_MODULE"
  const url = specifier.startsWith("file:") ? specifier : pathToFileURL(specifier).href
  let loaded: { default?: unknown }
  try {
    loaded = await import(url)
  } catch (error) {
    throw new Error(
      `Invalid ${name}: ${JSON.stringify(specifier)} (${error instanceof Error ? error.message : "import failed"})`,
    )
  }
  const policy = loaded.default as Partial<OwnerPolicyModule> | undefined
  if (
    typeof policy !== "object" ||
    policy === null ||
    typeof policy.register !== "function" ||
    typeof policy.write !== "function"
  )
    throw new Error(
      `Invalid ${name}: ${JSON.stringify(specifier)} (expected a default export with register and write functions)`,
    )
  return policy as OwnerPolicyModule
}
