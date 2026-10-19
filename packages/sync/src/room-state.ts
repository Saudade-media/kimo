/**
 * Per-room cursor of the network provider (docs/spec/multiplayer.md §15.6). Only the state
 * vector of the last fully acknowledged local state is persisted; the log position (`since`) is
 * not, so a restarted provider always catches up from the latest snapshot plus the tail.
 */

/** What the network provider remembers about one room between sessions. */
export interface RoomCursor {
  /** State vector of the local store when everything local was acknowledged by the relay. */
  ackedSv: Uint8Array | null
}

/** Storage of {@link RoomCursor}s (IndexedDB in the web app, a map in tests). */
export interface RoomStateStore {
  load(room: string): Promise<RoomCursor | null>
  save(room: string, cursor: RoomCursor): Promise<void>
  clear(room: string): Promise<void>
}

/** In-memory {@link RoomStateStore} (the provider's default; also handy across test instances). */
export class MemoryRoomStateStore implements RoomStateStore {
  private readonly cursors = new Map<string, RoomCursor>()

  async load(room: string): Promise<RoomCursor | null> {
    const cursor = this.cursors.get(room)
    return cursor ? copy(cursor) : null
  }

  async save(room: string, cursor: RoomCursor): Promise<void> {
    this.cursors.set(room, copy(cursor))
  }

  async clear(room: string): Promise<void> {
    this.cursors.delete(room)
  }
}

const copy = (cursor: RoomCursor): RoomCursor => ({ ackedSv: cursor.ackedSv?.slice() ?? null })
