/**
 * Browser library file events, for layers the library module must not import (multiplayer stops
 * sharing a file that is deleted for good). Listeners run after the file is gone; they are not
 * awaited, so a slow listener (a relay that does not answer) never holds up a delete.
 */

const deleted = new Set<(fileId: string) => void | Promise<void>>()

/** Calls `listener` with the id of each library file deleted for good (not moved to the Trash). */
export function onFileDeleted(listener: (fileId: string) => void | Promise<void>): () => void {
  deleted.add(listener)
  return () => {
    deleted.delete(listener)
  }
}

/** @internal `deleteFile` reports a deletion. */
export function fileDeleted(fileId: string): void {
  for (const l of [...deleted]) {
    try {
      void Promise.resolve(l(fileId)).catch(() => undefined)
    } catch {
      // A listener's failure never fails the delete.
    }
  }
}
