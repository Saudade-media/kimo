/**
 * Room sessions of shared files (docs/spec/multiplayer.md §16.3): the hooks that tie a file
 * session (`FileSessionManager`, on the web in the window and on desktop in the document host)
 * to its room.
 *
 * - Open: a file this device shared reconnects as it opens. The session's store is still empty:
 *   the room state comes first (the replica, or the catch-up), then only what the file changed
 *   since the owner last saved it (`reopenShared`). Unshared files load as before.
 * - Write: each write of a shared file records the state it holds (`captureSaved`), so the next
 *   reopen diffs against it and never reverts collaborators' edits.
 * - Save As: the room follows the session to its new file (the registry's file key moves), so
 *   the new file reopens shared; the file it came from is no longer the shared one. A read-only
 *   workspace copy (deleted workspace, removed member) saved elsewhere is a plain file: editable.
 * - Rename: the room follows the file to its new name, open or not.
 * - Close: the room connection of the session ends with it.
 */
import type { KimoDocument } from "@kimo/core-schema"
import type { AssetStore } from "../lib/assets"
import type { FileDocumentSession, SharedFileHooks } from "../platform/session"
import type { PlatformShare } from "../platform/share"
import { CLOUD_DELETED_REASON, CLOUD_REMOVED_REASON } from "./cloud/workspaces"

export interface SharedFileHooksOptions {
  /** The asset store of a session. Default: the share layer's (`assets/` beside the file). */
  assetsFor?(session: FileDocumentSession): AssetStore | undefined
  /** A shared file could not reconnect (the room was closed, the registry unreadable). */
  onError?(ref: string, error: unknown): void
}

export function createSharedFileHooks(
  share: PlatformShare,
  options: SharedFileHooksOptions = {},
): SharedFileHooks {
  /** The room each open session reconnected to. */
  const rooms = new WeakMap<FileDocumentSession, string>()
  return {
    async open(session, doc: KimoDocument) {
      // Cheap check first: most files were never shared (nor bound to a workspace room).
      if (!(await share.isShared(session.ref).catch(() => false))) return false
      try {
        const assets = options.assetsFor?.(session)
        const shared = await share.reopenShared(session, doc, assets)
        if (!shared) return false
        rooms.set(session, shared.room)
        return true
      } catch (error) {
        options.onError?.(session.ref, error)
        return false
      }
    },
    writing(session, doc) {
      // Sessions shared after they opened count too: ask the share layer, not `rooms`.
      if (!share.roomOfFile(session.ref)) return undefined
      const commit = share.captureSaved(session, doc)
      return () => {
        void commit().catch(() => undefined)
      }
    },
    async moved(session, from, to) {
      try {
        await share.fileMoved(from, to)
      } catch (error) {
        options.onError?.(to, error)
      }
      // Board 46 5D, 6E Save a copy: the copy is not bound to the workspace room.
      const reason = session.store.readOnly?.reason
      if (reason === CLOUD_DELETED_REASON || reason === CLOUD_REMOVED_REASON)
        session.store.setReadOnly(null)
    },
    async renamed(from, to) {
      try {
        await share.fileMoved(from, to)
      } catch (error) {
        options.onError?.(to, error)
      }
    },
    closed(session) {
      const room = rooms.get(session) ?? share.roomOfFile(session.ref)
      rooms.delete(session)
      if (room) void share.leave(room).catch(() => undefined)
    },
  }
}
