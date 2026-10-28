/**
 * What this device keeps of Kimo Cloud's workspaces (ADR 0019 "fast by default"), in the
 * registry's `cloud` store next to the other room secrets: IndexedDB on web and in the desktop
 * webview, the registry JSON file where the host keeps one, memory in tests.
 *
 * Two kinds of records, with different lifetimes:
 *
 * - **Account records** (the account with its workspaces, each workspace's members, file list and
 *   this device's tokens) belong to the signed-in account. They are replaced only by a newer
 *   answer, never by a failure, and they all go when the account signs out or another account
 *   signs in, so one person never sees another's list.
 * - **Bindings** tie a room to the local copy of its file (a file on disk, a browser library file,
 *   or a Kimo-managed replica) and the migration journal records rooms re-shared from before
 *   workspaces. They outlive sign-out: a local copy is never dropped or unbound by a refresh, only
 *   marked `ended` (the file was closed, the workspace deleted, the member removed) so it opens as
 *   a plain local file, read-only where board 46 says so.
 *
 * A record that does not parse is skipped, never fatal: the cache then refills from the network.
 */
import { parseAccount, parseCloudToken, parseFileList, parseWorkspaceDetail } from "./client"
import type { CloudAccount, CloudToken, FileList, WorkspaceDetail } from "./types"

/** A plain key-value store (the registry's `cloud` store). */
export interface CloudRecords {
  get(key: string): Promise<unknown | undefined>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  list(): Promise<unknown[]>
}

/** Why a binding no longer syncs (its local copy stays). */
export type BindingEnd =
  /** An Admin closed the file (§16.4): the copy is a plain local file again. */
  | "closed"
  /** The workspace was deleted (§13.10, board 46 6E): the copy is read-only. */
  | "deleted"
  /** This account left or was removed (§14.6, §14.7, board 46 6F): the copy is read-only. */
  | "removed"

/** A room bound to a local copy of its file. */
export interface CloudBinding {
  room: string
  workspaceId: string
  /**
   * The local file (a path on desktop, `kimo-lib:<id>` on web); null for a Kimo-managed replica of
   * a file that is not on disk (it lives in the room's replica store).
   */
  fileKey: string | null
  relayUrl: string
  /** Base64url room key (as in the file list). */
  roomKey: string
  name: string
  boundAt: number
  ended: BindingEnd | null
  /** The account that bound it; another account signed in here leaves it alone. */
  accountId?: string
}

/** One room re-shared from before workspaces (architecture.md §3 "Re-share"). */
export interface MigrationRecord {
  oldRoom: string
  newRoom: string
  workspaceId: string
  fileKey: string
  /** `uploaded`: the new room holds the state; `closed`: the old room was closed and forgotten. */
  step: "uploaded" | "closed"
  at: number
}

export interface CachedCloud {
  accountId: string | null
  account: CloudAccount | null
  details: Record<string, WorkspaceDetail>
  files: Record<string, FileList>
  tokens: Record<string, CloudToken>
  bindings: Record<string, CloudBinding>
  migrations: Record<string, MigrationRecord>
}

const V = 1
type Kind = "account" | "ws" | "files" | "token" | "bind" | "migrated"

interface Envelope {
  v: number
  kind: Kind
  key: string
  /** Account records: the account they belong to. */
  accountId?: string
  savedAt: number
  value: unknown
}

const keyOf = (kind: Kind, id = "") => (kind === "account" ? "account" : `${kind}:${id}`)

const isEnvelope = (v: unknown): v is Envelope =>
  typeof v === "object" &&
  v !== null &&
  (v as Envelope).v === V &&
  typeof (v as Envelope).kind === "string" &&
  typeof (v as Envelope).key === "string"

function parseBinding(v: unknown): CloudBinding | null {
  const b = v as Partial<CloudBinding> | null
  if (
    !b ||
    typeof b.room !== "string" ||
    typeof b.workspaceId !== "string" ||
    (b.fileKey !== null && typeof b.fileKey !== "string") ||
    typeof b.relayUrl !== "string" ||
    typeof b.roomKey !== "string"
  )
    return null
  const ended = b.ended === "closed" || b.ended === "deleted" || b.ended === "removed" ? b.ended : null
  return {
    room: b.room,
    workspaceId: b.workspaceId,
    fileKey: b.fileKey ?? null,
    relayUrl: b.relayUrl,
    roomKey: b.roomKey,
    name: typeof b.name === "string" ? b.name : "",
    boundAt: typeof b.boundAt === "number" ? b.boundAt : 0,
    ended,
    ...(typeof b.accountId === "string" ? { accountId: b.accountId } : {}),
  }
}

function parseMigration(v: unknown): MigrationRecord | null {
  const m = v as Partial<MigrationRecord> | null
  if (
    !m ||
    typeof m.oldRoom !== "string" ||
    typeof m.newRoom !== "string" ||
    typeof m.workspaceId !== "string" ||
    typeof m.fileKey !== "string" ||
    (m.step !== "uploaded" && m.step !== "closed")
  )
    return null
  return { ...(m as MigrationRecord), at: typeof m.at === "number" ? m.at : 0 }
}

const attempt = <T>(f: () => T): T | null => {
  try {
    return f()
  } catch {
    return null
  }
}

export interface CloudCache {
  /** Everything kept here; account records of another account than the newest are left out. */
  load(): Promise<CachedCloud>
  saveAccount(account: CloudAccount): Promise<void>
  saveDetail(accountId: string, ws: string, detail: WorkspaceDetail): Promise<void>
  saveFiles(accountId: string, ws: string, list: FileList): Promise<void>
  /**
   * Keeps `token` for `room` unless the one kept expires later (two windows, or a slow answer
   * landing after a newer one, never put an older token back). Resolves whether it was kept.
   */
  saveToken(accountId: string, room: string, token: CloudToken): Promise<boolean>
  dropToken(room: string): Promise<void>
  saveBinding(binding: CloudBinding): Promise<void>
  /** Only on an explicit "forget" from the person: refreshes never call this. */
  dropBinding(room: string): Promise<void>
  saveMigration(record: MigrationRecord): Promise<void>
  /** Drops every account record (sign-out, another account); bindings and migrations stay. */
  clearAccount(): Promise<void>
}

export function createCloudCache(records: CloudRecords, now: () => number = Date.now): CloudCache {
  /** Per-key write chains: a read-modify-write of one record never interleaves in this window. */
  const chains = new Map<string, Promise<unknown>>()
  const locked = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const run = (chains.get(key) ?? Promise.resolve()).then(fn, fn)
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    chains.set(key, tail)
    void tail.then(() => {
      if (chains.get(key) === tail) chains.delete(key)
    })
    return run
  }
  const put = (kind: Kind, id: string, value: unknown, accountId?: string) => {
    const key = keyOf(kind, id)
    const envelope: Envelope = {
      v: V,
      kind,
      key,
      savedAt: now(),
      value,
      ...(accountId !== undefined ? { accountId } : {}),
    }
    return locked(key, () => records.put(key, envelope))
  }

  return {
    async load() {
      const all = (await records.list().catch(() => [] as unknown[])).filter(isEnvelope)
      const accountRecord = all.find((e) => e.kind === "account")
      const account = accountRecord ? attempt(() => parseAccount(accountRecord.value)) : null
      const accountId = account?.account.id ?? null
      const out: CachedCloud = {
        accountId,
        account,
        details: {},
        files: {},
        tokens: {},
        bindings: {},
        migrations: {},
      }
      const mine = (e: Envelope) => accountId !== null && e.accountId === accountId
      for (const e of all) {
        const id = e.key.slice(e.kind.length + 1)
        if (e.kind === "ws" && mine(e)) {
          const d = attempt(() => parseWorkspaceDetail(e.value))
          if (d) out.details[id] = d
        } else if (e.kind === "files" && mine(e)) {
          const l = attempt(() => parseFileList(e.value))
          if (l) out.files[id] = l
        } else if (e.kind === "token" && mine(e)) {
          const t = attempt(() => parseCloudToken(e.value))
          if (t) out.tokens[id] = t
        } else if (e.kind === "bind") {
          const b = parseBinding(e.value)
          if (b) out.bindings[b.room] = b
        } else if (e.kind === "migrated") {
          const m = parseMigration(e.value)
          if (m) out.migrations[m.oldRoom] = m
        }
      }
      return out
    },

    saveAccount: (account) => put("account", "", account, account.account.id),
    saveDetail: (accountId, ws, detail) => put("ws", ws, detail, accountId),
    saveFiles: (accountId, ws, list) => put("files", ws, list, accountId),

    saveToken(accountId, room, token) {
      const key = keyOf("token", room)
      return locked(key, async () => {
        const kept = await records.get(key).catch(() => undefined)
        if (isEnvelope(kept) && kept.accountId === accountId) {
          const current = attempt(() => parseCloudToken(kept.value))
          const later = (t: CloudToken) => t.expiresAt ?? Number.POSITIVE_INFINITY
          if (current && later(current) > later(token)) return false
        }
        const envelope: Envelope = {
          v: V,
          kind: "token",
          key,
          accountId,
          savedAt: now(),
          value: token,
        }
        await records.put(key, envelope)
        return true
      })
    },
    dropToken: (room) => locked(keyOf("token", room), () => records.delete(keyOf("token", room))),

    saveBinding: (binding) => put("bind", binding.room, binding),
    dropBinding: (room) => locked(keyOf("bind", room), () => records.delete(keyOf("bind", room))),
    saveMigration: (record) => put("migrated", record.oldRoom, record),

    async clearAccount() {
      const all = (await records.list().catch(() => [] as unknown[])).filter(isEnvelope)
      for (const e of all)
        if (e.kind === "account" || e.kind === "ws" || e.kind === "files" || e.kind === "token")
          await locked(e.key, () => records.delete(e.key))
    },
  }
}
