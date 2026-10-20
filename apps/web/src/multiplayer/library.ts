/**
 * Sharing files of the browser library (`#/file/:id`, docs/spec/multiplayer.md §16.3): the same
 * Share popover and room as a file on disk, under the document key `kimo-lib:<fileId>`.
 *
 * - The key is the library's file id, so it is stable across reloads; the owner's registry
 *   (IndexedDB on the web) records the room under it like a file path.
 * - The library's own persistence (`kimo-doc-<id>`, an `IndexedDbProvider`) stays the owner's
 *   copy. It stores the CRDT updates themselves, every update the store takes (the room's
 *   included), so the library copy and the room are two replicas of one document: reopening
 *   attaches the room to the store the library already loaded, with no file delta (a disk file
 *   holds JSON and needs one, see `reopenShared`). For the same reason nothing is recorded on
 *   write: there is no file write.
 * - An editor that closes ends its room connection; the room lives on at the relay.
 * - Trash keeps the room (the file can come back). Deleting the file for good (Delete forever,
 *   Empty Trash, the 30-day purge) stops sharing: the relay closes the room and this device
 *   forgets its keys. When the relay refuses the close for good, the room is still forgotten
 *   here, since nothing could ever reopen it.
 */
import type { DocStore } from "@kimo/editor-state"
import type { AssetStore } from "../lib/assets"
import type { PlatformShare } from "../platform/share"

export const LIBRARY_KEY_PREFIX = "kimo-lib:"

/** The document key of a browser library file. */
export const libraryKeyOf = (fileId: string) => `${LIBRARY_KEY_PREFIX}${fileId}`

/** The library file id of a key, or null for a file path or a joined room. */
export const libraryFileOfKey = (key: string): string | null =>
  key.startsWith(LIBRARY_KEY_PREFIX) ? key.slice(LIBRARY_KEY_PREFIX.length) : null

/** An open library file as the editor holds it. */
export interface LibraryDocument {
  fileId: string
  store: DocStore
  /** The editor's asset store of the file (IndexedDB `kimo-assets-<id>`). */
  assets: AssetStore
}

/** What the share backend needs of an open library file. */
export interface LibraryTarget {
  ref: string
  store: DocStore
  assets: AssetStore
}

export interface LibraryShare {
  /**
   * The editor opened a library file: it is known to the share backend (Share starts from it),
   * and a file this device shared reconnects to its room. The function returned releases it
   * (the editor closed): the room connection ends unless another editor holds the file.
   */
  open(doc: LibraryDocument): () => void
  /** The open library file of `key`, or null. */
  get(key: string): LibraryTarget | null
  /** The library file `fileId` was deleted for good: stops sharing it (see the module doc). */
  deleted(fileId: string): Promise<void>
  /** Fires when a library file opens or closes. */
  subscribe(listener: () => void): () => void
}

export interface LibraryShareOptions {
  /** A shared library file could not reconnect, or its room could not be closed. */
  onError?(fileId: string, error: unknown): void
}

export function createLibraryShare(
  share: PlatformShare,
  options: LibraryShareOptions = {},
): LibraryShare {
  const open = new Map<string, LibraryTarget>()
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const l of [...listeners]) l()
  }
  const leaveIfUnheld = (key: string) => {
    if (open.has(key)) return
    const room = share.roomOfFile(key)
    if (room) void share.leave(room).catch(() => undefined)
  }
  return {
    open(doc) {
      const key = libraryKeyOf(doc.fileId)
      const target: LibraryTarget = { ref: key, store: doc.store, assets: doc.assets }
      open.set(key, target)
      changed()
      let released = false
      void (async () => {
        // Cheap check first: most files were never shared.
        const summary = await share.service.roomForFile(key).catch(() => null)
        if (!summary || released) return
        try {
          await share.reconnectReplica(target, doc.assets)
        } catch (error) {
          options.onError?.(doc.fileId, error)
          return
        }
        // Closed while connecting: leave, unless the file opened again meanwhile (StrictMode).
        if (released) leaveIfUnheld(key)
      })()
      return () => {
        if (released) return
        released = true
        if (open.get(key) !== target) return
        open.delete(key)
        changed()
        leaveIfUnheld(key)
      }
    },

    get: (key) => open.get(key) ?? null,

    async deleted(fileId) {
      const key = libraryKeyOf(fileId)
      const summary = await share.service.roomForFile(key).catch(() => null)
      if (!summary) return
      try {
        await share.stopSharing(summary.room)
      } catch (error) {
        // The relay refused for good (the room is gone there, or the keys no longer match):
        // the file is gone too, so nothing could reopen the room. Forget it here.
        options.onError?.(fileId, error)
        await share.service.forgetOwnedRoom(summary.room)
      }
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
