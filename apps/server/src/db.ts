/**
 * `bun:sqlite` storage (docs/spec/multiplayer.md §14.2). Everything here is ciphertext or public
 * metadata: the relay never holds a key that could open an envelope. All methods are synchronous,
 * so a multi-statement change is one transaction and cannot interleave with another request.
 */
import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

export const SCHEMA_VERSION = 1

export interface RoomRow {
  id: string
  root_pub: Uint8Array
  link_kid: number
  link_pub: Uint8Array
  link_cert: Uint8Array
  created_at: number
  active_at: number
  closed_at: number | null
  head: number
  base: number
  log_bytes: number
  snapshot_bytes: number
  blob_bytes: number
  quota_bytes: number | null
  /** The account an `external` owner policy gave the room (§14.12); null under `devices`. */
  account: string | null
}

export interface LogRow {
  seq: number
  origin: string
  env: Uint8Array
}

export interface SnapshotMeta {
  gen: number
  up_to: number
  carries: number
  bytes: number
}

export interface SnapshotRow {
  gen: number
  up_to: number
  carries: number
  env: Uint8Array
}

export interface BlobRow {
  id: string
  bytes: number
  at: number
  unref_since: number | null
}

export interface OwnerRow {
  pub: Uint8Array
  name: string
  added_at: number
  added_by: Uint8Array | null
  via: "claim" | "pair" | "env"
}

export interface NewRoom {
  id: string
  rootPub: Uint8Array
  kid: number
  linkPub: Uint8Array
  cert: Uint8Array
  at: number
  /** Account from an `external` owner policy; omitted or null under `devices`. */
  account?: string | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  id             TEXT PRIMARY KEY,
  root_pub       BLOB NOT NULL,
  link_kid       INTEGER NOT NULL,
  link_pub       BLOB NOT NULL,
  link_cert      BLOB NOT NULL,
  created_at     INTEGER NOT NULL,
  active_at      INTEGER NOT NULL,
  closed_at      INTEGER,
  head           INTEGER NOT NULL DEFAULT 0,
  base           INTEGER NOT NULL DEFAULT 0,
  log_bytes      INTEGER NOT NULL DEFAULT 0,
  snapshot_bytes INTEGER NOT NULL DEFAULT 0,
  blob_bytes     INTEGER NOT NULL DEFAULT 0,
  quota_bytes    INTEGER,
  account        TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS rooms_account ON rooms(account) WHERE account IS NOT NULL;

CREATE TABLE IF NOT EXISTS log (
  room   TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq    INTEGER NOT NULL,
  origin TEXT NOT NULL,
  jti    BLOB NOT NULL,
  at     INTEGER NOT NULL,
  env    BLOB NOT NULL,
  PRIMARY KEY (room, seq)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS snapshots (
  room    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  gen     INTEGER NOT NULL,
  up_to   INTEGER NOT NULL,
  carries INTEGER NOT NULL,
  at      INTEGER NOT NULL,
  env     BLOB NOT NULL,
  PRIMARY KEY (room, gen)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS revocations (
  room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  jti  BLOB NOT NULL,
  exp  INTEGER NOT NULL,
  at   INTEGER NOT NULL,
  PRIMARY KEY (room, jti)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS blobs (
  room        TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  at          INTEGER NOT NULL,
  unref_since INTEGER,
  PRIMARY KEY (room, id)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS nonces (
  room  TEXT NOT NULL,
  nonce BLOB NOT NULL,
  exp   INTEGER NOT NULL,
  PRIMARY KEY (room, nonce)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS relay_meta (
  key   TEXT PRIMARY KEY,
  value BLOB NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS owners (
  pub      BLOB PRIMARY KEY,
  name     TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  added_by BLOB,
  via      TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS pairings_used (
  jti BLOB PRIMARY KEY,
  exp INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS accounts (
  account       TEXT PRIMARY KEY,
  storage_limit INTEGER,
  at            INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
`

export class RelayDb {
  readonly sqlite: Database

  constructor(dataDir: string) {
    if (dataDir === ":memory:") {
      this.sqlite = new Database(":memory:", { strict: true })
    } else {
      mkdirSync(dataDir, { recursive: true })
      this.sqlite = new Database(join(dataDir, "relay.sqlite"), { create: true, strict: true })
    }
    this.sqlite.run("PRAGMA journal_mode = WAL")
    this.sqlite.run("PRAGMA synchronous = NORMAL")
    this.sqlite.run("PRAGMA foreign_keys = ON")
    this.migrate()
  }

  private migrate(): void {
    const row = this.sqlite.query<{ user_version: number }, []>("PRAGMA user_version").get()
    const version = row?.user_version ?? 0
    if (version > SCHEMA_VERSION)
      throw new Error(
        `relay.sqlite has schema ${version}, this relay understands ${SCHEMA_VERSION}`,
      )
    // Every statement is CREATE IF NOT EXISTS: the ownership tables joined version 1 before
    // multiplayer shipped (ADR 0017), so a development database from before them gains them here.
    // `rooms.account` and `accounts` joined version 1 the same way (ADR 0018); a development table
    // made before the column gains it first, since the index below names it.
    const rooms = this.sqlite
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('rooms')")
      .all()
    if (rooms.length > 0 && !rooms.some((column) => column.name === "account"))
      this.sqlite.run("ALTER TABLE rooms ADD COLUMN account TEXT")
    this.sqlite.run(SCHEMA)
    if (version < SCHEMA_VERSION) this.sqlite.run(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }

  close(): void {
    this.sqlite.close()
  }

  tx<T>(fn: () => T): T {
    return this.sqlite.transaction(fn)()
  }

  // Rooms ------------------------------------------------------------------------------------

  getRoom(id: string): RoomRow | null {
    return this.sqlite.query<RoomRow, [string]>("SELECT * FROM rooms WHERE id = ?").get(id)
  }

  countOpenRooms(): number {
    const row = this.sqlite
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM rooms WHERE closed_at IS NULL")
      .get()
    return row?.n ?? 0
  }

  insertRoom(room: NewRoom): void {
    this.sqlite
      .query(
        `INSERT INTO rooms
           (id, root_pub, link_kid, link_pub, link_cert, created_at, active_at, account)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        room.id,
        room.rootPub,
        room.kid,
        room.linkPub,
        room.cert,
        room.at,
        room.at,
        room.account ?? null,
      )
  }

  /** Reopens a closed room under a newer link key, with empty storage and the new account. */
  reopenRoom(room: NewRoom): void {
    this.sqlite
      .query(
        `UPDATE rooms SET link_kid = ?, link_pub = ?, link_cert = ?, active_at = ?,
           closed_at = NULL, head = 0, base = 0, log_bytes = 0, snapshot_bytes = 0, blob_bytes = 0,
           account = ?
         WHERE id = ?`,
      )
      .run(room.kid, room.linkPub, room.cert, room.at, room.account ?? null, room.id)
  }

  /** Stored bytes (log, snapshots and blobs) of an account's open rooms (§14.12). */
  accountBytes(account: string): number {
    const row = this.sqlite
      .query<{ n: number }, [string]>(
        `SELECT COALESCE(SUM(log_bytes + snapshot_bytes + blob_bytes), 0) AS n FROM rooms
         WHERE account = ? AND closed_at IS NULL`,
      )
      .get(account)
    return row?.n ?? 0
  }

  /** The storage limit the owner policy last gave the account (§14.12); null: none recorded. */
  accountLimit(account: string): number | null {
    const row = this.sqlite
      .query<{ storage_limit: number | null }, [string]>(
        "SELECT storage_limit FROM accounts WHERE account = ?",
      )
      .get(account)
    return row?.storage_limit ?? null
  }

  /** Records the account's storage limit from the latest policy answer; null for no limit. */
  setAccountLimit(account: string, limit: number | null, at: number): void {
    this.sqlite
      .query("INSERT OR REPLACE INTO accounts (account, storage_limit, at) VALUES (?, ?, ?)")
      .run(account, limit, at)
  }

  setLinkKey(id: string, kid: number, linkPub: Uint8Array, cert: Uint8Array): void {
    this.sqlite
      .query("UPDATE rooms SET link_kid = ?, link_pub = ?, link_cert = ? WHERE id = ?")
      .run(kid, linkPub, cert, id)
  }

  touchActive(id: string, at: number): void {
    this.sqlite.query("UPDATE rooms SET active_at = ? WHERE id = ?").run(at, id)
  }

  /** Rows of rooms idle since before `cutoff` (ms). */
  idleRoomIds(cutoff: number): string[] {
    return this.sqlite
      .query<{ id: string }, [number]>("SELECT id FROM rooms WHERE active_at < ?")
      .all(cutoff)
      .map((row) => row.id)
  }

  /** Open rooms that have a snapshot, the only rooms retention can shrink. */
  roomsWithSnapshots(): string[] {
    return this.sqlite
      .query<{ room: string }, []>(
        `SELECT DISTINCT s.room AS room FROM snapshots s
         JOIN rooms r ON r.id = s.room WHERE r.closed_at IS NULL`,
      )
      .all()
      .map((row) => row.room)
  }

  /**
   * Removes a room's content but keeps the row, marked closed (§6 op 4). Nonces stay: they expire
   * on their own, and dropping them would let a captured close command be replayed after reopening.
   */
  closeRoom(id: string, at: number): void {
    this.tx(() => {
      for (const table of ["log", "snapshots", "revocations", "blobs"])
        this.sqlite.query(`DELETE FROM ${table} WHERE room = ?`).run(id)
      this.sqlite
        .query(
          `UPDATE rooms SET closed_at = ?, head = 0, base = 0, log_bytes = 0,
             snapshot_bytes = 0, blob_bytes = 0 WHERE id = ?`,
        )
        .run(at, id)
    })
  }

  /** Removes a room and everything it owns (TTL expiry). */
  deleteRoom(id: string): void {
    this.tx(() => {
      this.sqlite.query("DELETE FROM nonces WHERE room = ?").run(id)
      this.sqlite.query("DELETE FROM rooms WHERE id = ?").run(id)
    })
  }

  // Log --------------------------------------------------------------------------------------

  /** Inserts one entry and advances `head` and `log_bytes`; returns the new `seq`. */
  appendLog(room: string, origin: string, jti: Uint8Array, at: number, env: Uint8Array): number {
    return this.tx(() => {
      const row = this.sqlite
        .query<{ head: number }, [number, number, string]>(
          `UPDATE rooms SET head = head + 1, log_bytes = log_bytes + ?, active_at = ?
           WHERE id = ? AND closed_at IS NULL RETURNING head`,
        )
        .get(env.length, at, room)
      if (!row) throw new Error("room is not open")
      this.sqlite
        .query("INSERT INTO log (room, seq, origin, jti, at, env) VALUES (?, ?, ?, ?, ?, ?)")
        .run(room, row.head, origin, jti, at, env)
      return row.head
    })
  }

  entriesFrom(room: string, from: number): LogRow[] {
    return this.sqlite
      .query<LogRow, [string, number]>(
        "SELECT seq, origin, env FROM log WHERE room = ? AND seq >= ? ORDER BY seq",
      )
      .all(room, from)
  }

  /** Same rows as `entriesFrom`, read one at a time so a long tail is never materialized at once. */
  iterateEntriesFrom(room: string, from: number): IterableIterator<LogRow> {
    return this.sqlite
      .query<LogRow, [string, number]>(
        "SELECT seq, origin, env FROM log WHERE room = ? AND seq >= ? ORDER BY seq",
      )
      .iterate(room, from)
  }

  /** Envelope bytes of the entries after `upTo`. */
  logBytesAfter(room: string, upTo: number): number {
    const row = this.sqlite
      .query<{ n: number }, [string, number]>(
        "SELECT COALESCE(SUM(LENGTH(env)), 0) AS n FROM log WHERE room = ? AND seq > ?",
      )
      .get(room, upTo)
    return row?.n ?? 0
  }

  /**
   * Deletes the prefix of entries with `seq <= upTo` and `at <= cutoff`; updates `base` and
   * `log_bytes` in the same transaction. Returns the number of entries removed.
   */
  pruneLog(room: string, upTo: number, cutoff: number): number {
    return this.tx(() => {
      const edge = this.sqlite
        .query<{ seq: number | null }, [string, number, number]>(
          "SELECT MAX(seq) AS seq FROM log WHERE room = ? AND seq <= ? AND at <= ?",
        )
        .get(room, upTo, cutoff)
      const last = edge?.seq ?? null
      if (last === null) return 0
      const freed = this.sqlite
        .query<{ n: number }, [string, number]>(
          "SELECT COALESCE(SUM(LENGTH(env)), 0) AS n FROM log WHERE room = ? AND seq <= ?",
        )
        .get(room, last)
      const result = this.sqlite
        .query("DELETE FROM log WHERE room = ? AND seq <= ?")
        .run(room, last)
      this.sqlite
        .query(
          "UPDATE rooms SET base = MAX(base, ?), log_bytes = MAX(0, log_bytes - ?) WHERE id = ?",
        )
        .run(last, freed?.n ?? 0, room)
      return result.changes
    })
  }

  // Snapshots --------------------------------------------------------------------------------

  latestSnapshot(room: string): SnapshotMeta | null {
    return this.sqlite
      .query<SnapshotMeta, [string]>(
        `SELECT gen, up_to, carries, LENGTH(env) AS bytes FROM snapshots
         WHERE room = ? ORDER BY gen DESC LIMIT 1`,
      )
      .get(room)
  }

  latestSnapshotEnv(room: string): SnapshotRow | null {
    return this.sqlite
      .query<SnapshotRow, [string]>(
        "SELECT gen, up_to, carries, env FROM snapshots WHERE room = ? ORDER BY gen DESC LIMIT 1",
      )
      .get(room)
  }

  /** Stores a new generation, keeps the latest two and refreshes `snapshot_bytes`. */
  putSnapshot(room: string, upTo: number, carries: boolean, at: number, env: Uint8Array): number {
    return this.tx(() => {
      const prev = this.latestSnapshot(room)
      const gen = (prev?.gen ?? 0) + 1
      this.sqlite
        .query(
          "INSERT INTO snapshots (room, gen, up_to, carries, at, env) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(room, gen, upTo, carries ? 1 : 0, at, env)
      this.sqlite.query("DELETE FROM snapshots WHERE room = ? AND gen < ?").run(room, gen - 1)
      this.sqlite
        .query(
          `UPDATE rooms SET snapshot_bytes =
             (SELECT COALESCE(SUM(LENGTH(env)), 0) FROM snapshots WHERE room = ?) WHERE id = ?`,
        )
        .run(room, room)
      return gen
    })
  }

  // Revocations and nonces -------------------------------------------------------------------

  addRevocation(room: string, jti: Uint8Array, exp: number, at: number): void {
    this.sqlite
      .query("INSERT OR REPLACE INTO revocations (room, jti, exp, at) VALUES (?, ?, ?, ?)")
      .run(room, jti, exp, at)
  }

  isRevoked(room: string, jti: Uint8Array): boolean {
    return (
      this.sqlite
        .query("SELECT 1 AS x FROM revocations WHERE room = ? AND jti = ?")
        .get(room, jti) !== null
    )
  }

  /** Drops revocations whose token has expired anyway (`exp` in seconds; 0 never expires). */
  pruneRevocations(nowSeconds: number): void {
    this.sqlite.query("DELETE FROM revocations WHERE exp > 0 AND exp <= ?").run(nowSeconds)
  }

  /** Records a nonce; false when it was already seen. */
  consumeNonce(room: string, nonce: Uint8Array, exp: number): boolean {
    const result = this.sqlite
      .query("INSERT OR IGNORE INTO nonces (room, nonce, exp) VALUES (?, ?, ?)")
      .run(room, nonce, exp)
    return result.changes > 0
  }

  pruneNonces(now: number): void {
    this.sqlite.query("DELETE FROM nonces WHERE exp <= ?").run(now)
  }

  // Blobs ------------------------------------------------------------------------------------

  getBlob(room: string, id: string): BlobRow | null {
    return this.sqlite
      .query<BlobRow, [string, string]>(
        "SELECT id, bytes, at, unref_since FROM blobs WHERE room = ? AND id = ?",
      )
      .get(room, id)
  }

  clearUnref(room: string, id: string): void {
    this.sqlite.query("UPDATE blobs SET unref_since = NULL WHERE room = ? AND id = ?").run(room, id)
  }

  insertBlob(room: string, id: string, bytes: number, at: number): void {
    this.tx(() => {
      this.sqlite
        .query("INSERT INTO blobs (room, id, bytes, at) VALUES (?, ?, ?, ?)")
        .run(room, id, bytes, at)
      this.sqlite
        .query("UPDATE rooms SET blob_bytes = blob_bytes + ?, active_at = ? WHERE id = ?")
        .run(bytes, at, room)
    })
  }

  allBlobs(room: string): BlobRow[] {
    return this.sqlite
      .query<BlobRow, [string]>("SELECT id, bytes, at, unref_since FROM blobs WHERE room = ?")
      .all(room)
  }

  setUnref(room: string, id: string, at: number): void {
    this.sqlite
      .query("UPDATE blobs SET unref_since = ? WHERE room = ? AND id = ? AND unref_since IS NULL")
      .run(at, room, id)
  }

  deleteBlobRows(room: string, ids: readonly string[], bytes: number): void {
    this.tx(() => {
      for (const id of ids)
        this.sqlite.query("DELETE FROM blobs WHERE room = ? AND id = ?").run(room, id)
      this.sqlite
        .query("UPDATE rooms SET blob_bytes = MAX(0, blob_bytes - ?) WHERE id = ?")
        .run(bytes, room)
    })
  }

  // Relay meta and owners (§14.11) -----------------------------------------------------------

  getMeta(key: string): Uint8Array | null {
    const row = this.sqlite
      .query<{ value: Uint8Array }, [string]>("SELECT value FROM relay_meta WHERE key = ?")
      .get(key)
    return row?.value ?? null
  }

  setMeta(key: string, value: Uint8Array): void {
    this.sqlite
      .query("INSERT OR REPLACE INTO relay_meta (key, value) VALUES (?, ?)")
      .run(key, value)
  }

  /** The owner set, oldest first. */
  owners(): OwnerRow[] {
    return this.sqlite
      .query<OwnerRow, []>(
        "SELECT pub, name, added_at, added_by, via FROM owners ORDER BY added_at, pub",
      )
      .all()
  }

  owner(pub: Uint8Array): OwnerRow | null {
    return this.sqlite
      .query<OwnerRow, [Uint8Array]>(
        "SELECT pub, name, added_at, added_by, via FROM owners WHERE pub = ?",
      )
      .get(pub)
  }

  countOwners(): number {
    return this.sqlite.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM owners").get()?.n ?? 0
  }

  insertOwner(row: OwnerRow): void {
    this.sqlite
      .query("INSERT INTO owners (pub, name, added_at, added_by, via) VALUES (?, ?, ?, ?, ?)")
      .run(row.pub, row.name, row.added_at, row.added_by, row.via)
  }

  renameOwner(pub: Uint8Array, name: string): boolean {
    return this.sqlite.query("UPDATE owners SET name = ? WHERE pub = ?").run(name, pub).changes > 0
  }

  deleteOwner(pub: Uint8Array): boolean {
    return this.sqlite.query("DELETE FROM owners WHERE pub = ?").run(pub).changes > 0
  }

  /** Empties the owner set and the used pairings (`KIMO_RESET_OWNER`). */
  clearOwners(): void {
    this.tx(() => {
      this.sqlite.run("DELETE FROM owners")
      this.sqlite.run("DELETE FROM pairings_used")
    })
  }

  pairingUsed(jti: Uint8Array): boolean {
    return this.sqlite.query("SELECT 1 AS x FROM pairings_used WHERE jti = ?").get(jti) !== null
  }

  /** Burns a pairing `jti` until `exp` (unix seconds); false when it was already used. */
  usePairing(jti: Uint8Array, exp: number): boolean {
    return (
      this.sqlite
        .query("INSERT OR IGNORE INTO pairings_used (jti, exp) VALUES (?, ?)")
        .run(jti, exp).changes > 0
    )
  }

  prunePairings(nowSeconds: number): void {
    this.sqlite.query("DELETE FROM pairings_used WHERE exp <= ?").run(nowSeconds)
  }
}
