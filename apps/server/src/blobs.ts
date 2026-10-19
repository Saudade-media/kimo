/**
 * Blob ciphertext storage (docs/spec/multiplayer.md §14.6). The relay stores opaque envelopes
 * under their id; the database tracks sizes and marks. `FsBlobStore` writes
 * `<dataDir>/blobs/<room>/<id[0..2]>/<id>` through a temporary file and a rename;
 * `MemBlobStore` backs the `":memory:"` data directory used by tests.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export interface BlobStore {
  put(room: string, id: string, bytes: Uint8Array): void
  /** A body for `Response`, or null when missing. */
  read(room: string, id: string): Blob | null
  has(room: string, id: string): boolean
  delete(room: string, id: string): void
  deleteRoom(room: string): void
}

export class FsBlobStore implements BlobStore {
  private readonly root: string

  constructor(dataDir: string) {
    this.root = join(dataDir, "blobs")
    mkdirSync(this.root, { recursive: true })
  }

  private path(room: string, id: string): string {
    return join(this.root, room, id.slice(0, 2), id)
  }

  put(room: string, id: string, bytes: Uint8Array): void {
    const target = this.path(room, id)
    mkdirSync(dirname(target), { recursive: true })
    const temp = `${target}.${crypto.randomUUID()}.tmp`
    writeFileSync(temp, bytes)
    renameSync(temp, target)
  }

  read(room: string, id: string): Blob | null {
    const file = Bun.file(this.path(room, id))
    return file.size > 0 ? file : null
  }

  has(room: string, id: string): boolean {
    return Bun.file(this.path(room, id)).size > 0
  }

  delete(room: string, id: string): void {
    rmSync(this.path(room, id), { force: true })
  }

  deleteRoom(room: string): void {
    rmSync(join(this.root, room), { recursive: true, force: true })
  }
}

export class MemBlobStore implements BlobStore {
  private readonly files = new Map<string, Uint8Array>()

  put(room: string, id: string, bytes: Uint8Array): void {
    this.files.set(`${room}/${id}`, bytes.slice())
  }

  read(room: string, id: string): Blob | null {
    const bytes = this.files.get(`${room}/${id}`)
    return bytes ? new Blob([bytes as Uint8Array<ArrayBuffer>]) : null
  }

  has(room: string, id: string): boolean {
    return this.files.has(`${room}/${id}`)
  }

  delete(room: string, id: string): void {
    this.files.delete(`${room}/${id}`)
  }

  deleteRoom(room: string): void {
    for (const key of [...this.files.keys()]) if (key.startsWith(`${room}/`)) this.files.delete(key)
  }
}

export function createBlobStore(dataDir: string): BlobStore {
  return dataDir === ":memory:" ? new MemBlobStore() : new FsBlobStore(dataDir)
}
