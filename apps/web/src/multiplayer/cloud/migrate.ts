/**
 * The 1.3.0 re-share (ADR 0019 decision 8, kimo-cloud architecture.md §3 "Re-share"): each room
 * this device owns on Kimo Cloud's relay from before workspaces moves into the oldest workspace the
 * account owns. The old room's root key never left this device, so Kimo Cloud cannot move it; the
 * app does, once per room:
 *
 * 1. the old room's state is read (its replica, then the relay's catch-up; or the open editor's
 *    store);
 * 2. `POST /v1/workspaces/<ws>/files` with `replaces` = the old room: Kimo Cloud creates and
 *    registers the new room (a repeat answers the same new room with a fresh token);
 * 3. the state goes into the new room, then the blobs: the ones this device holds, and every one
 *    the old room holds that the new room still lacks, copied relay to relay (a guest's image this
 *    device never fetched included). The file's last recorded save carries over so a later reopen
 *    still adds only the file's own changes;
 * 4. the local file is bound to the new room, and the old room's record stops claiming the file;
 * 5. the old room is closed with its root key (admin op 4), which ends its links, and forgotten.
 *
 * Every step is safe to repeat: an interrupted run resumes on the next sign-in. Nothing is closed
 * before the new room holds the state and the old room's blobs (closing deletes them), and a relay
 * that cannot be told keeps the old record (under a tombstone file key) so the close is tried
 * again later.
 */
import { createDocStore } from "@kimo/editor-state"
import { fromBase64Url, MultiplayerError, normalizeRelayUrl } from "@kimo/sync/mp"
import type { PlatformShare } from "../../platform/share"
import type { Registry } from "../registry"
import type { SharedSession, ShareTarget } from "../share"
import type { CloudBinding, CloudCache } from "./cache"
import type { CloudClient } from "./client"
import { CloudError, type CloudToken } from "./types"
import { workspaceFileName } from "./workspace-view"

/** The file key an owned room keeps once its file moved to a workspace room (until it is closed). */
export const MIGRATED_PREFIX = "kimo-cloud-migrated:"

export type MigrationStep = "created" | "uploaded" | "bound" | "closed"

export interface MigrationContext {
  client: CloudClient
  share: PlatformShare
  registry: Registry
  cache: CloudCache
  /** Kimo Cloud's relay (`GET /v1/relay`): only rooms there move. */
  relayUrl: string
  /** The oldest workspace the account owns. */
  workspaceId: string
  now: () => number
  /** Records the new binding and its first token (the workspace store's state and cache). */
  bind(binding: CloudBinding, token: CloudToken): Promise<void>
  /** Moves an editor that has the file open to the new room. */
  reopen?(room: string, session: { ref: string; store: SharedSession["store"] }): Promise<unknown>
  /** Test seam: after each step of a room. */
  step?(room: string, step: MigrationStep): void | Promise<void>
  /** Bound on each wait for a relay (catch-up, upload). Default 30 s. */
  timeoutMs?: number
}

export interface MigrationOutcome {
  /** Rooms moved and closed in this run. */
  moved: number
  /** Rooms left for a later run (an error, an unreachable relay). */
  left: number
  /** The last error code seen, if any. */
  error: string | null
}

/** The full SHA-256 of every manifest entry: the blobs the room can hold for this document. */
function manifestShas(store: SharedSession["store"]): string[] {
  const assets = (store.toHeader() as { assets?: Record<string, { sha256?: unknown }> }).assets
  return Object.values(assets ?? {})
    .map((entry) => entry?.sha256)
    .filter((sha): sha is string => typeof sha === "string")
}

/** Resolves once the session is caught up and every local change is on the relay. */
function settled(session: SharedSession, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (error?: Error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      offStatus()
      offEvent()
      if (error) reject(error)
      else resolve()
    }
    const check = () => {
      if (session.status === "synced" || session.status === "read-only") finish()
    }
    const timer = setTimeout(
      () => finish(new CloudError("OFFLINE", "the relay did not finish in time")),
      timeoutMs,
    )
    const offStatus = session.onStatus(check)
    const offEvent = session.onEvent((event) => {
      if (event.type === "closed" && event.error && !event.willRetry) finish(event.error)
      else check()
    })
    check()
  })
}

export async function migrateLegacyRooms(ctx: MigrationContext): Promise<MigrationOutcome> {
  const relay = normalizeRelayUrl(ctx.relayUrl)
  const timeoutMs = ctx.timeoutMs ?? 30_000
  const service = ctx.share.service
  const outcome: MigrationOutcome = { moved: 0, left: 0, error: null }
  const owned = (await ctx.registry.listOwned()).filter((o) => {
    try {
      return normalizeRelayUrl(o.relayUrl) === relay
    } catch {
      return false
    }
  })
  const journal = (await ctx.cache.load()).migrations

  for (const o of owned) {
    try {
      const tombstoned = o.fileKey.startsWith(MIGRATED_PREFIX)
      if (!tombstoned) {
        const fileKey = o.fileKey
        // 1. What the old room holds. An editor open here has it already; otherwise its replica
        // and the relay's catch-up fill a scratch copy.
        const live = ctx.share.session(o.room)
        let target: ShareTarget
        let oldClosed = false
        if (live) {
          await settled(live, timeoutMs)
          target = { fileKey, store: live.store, assets: live.assets }
        } else {
          target = ctx.share.targetOf({ ref: fileKey, store: createDocStore() })
          let scratch: SharedSession | null = null
          try {
            scratch = await service.connect(target, o.room)
            await settled(scratch, timeoutMs)
          } catch (error) {
            if (!(error instanceof MultiplayerError && error.code === "ROOM_CLOSED")) throw error
            oldClosed = true
          } finally {
            await scratch?.leave().catch(() => undefined)
          }
        }
        // A closed old room can be brought over only by the run that uploaded it before closing
        // it: without that record, this device may hold less than the room did, so nothing moves.
        if (oldClosed && !journal[o.room]) {
          outcome.left++
          outcome.error = "ROOM_CLOSED"
          continue
        }

        // 2. The new room (a repeat answers the one an earlier run made), named like any file
        // shared to a workspace.
        const { file, token } = await ctx.client.addFile(ctx.workspaceId, {
          name: workspaceFileName(
            fileKey,
            target.store.toHeader() as { meta?: { name?: unknown } },
          ),
          origin: "user",
          replaces: o.room,
        })
        await ctx.step?.(o.room, "created")
        if (oldClosed && journal[o.room]?.newRoom !== file.room) {
          outcome.left++
          outcome.error = "ROOM_CLOSED"
          continue
        }
        const newRoom = {
          room: file.room,
          relayUrl: file.relayUrl,
          roomKey: fromBase64Url(file.roomKey),
          token: token.token,
        }

        // 3. The state into the new room, then the blobs. An editor's old connection stops
        // first, so one store never feeds two rooms. Blobs are fetched on demand, so this device
        // may lack some the old room holds: those are copied relay to relay, since closing the
        // old room deletes them. The journal records "uploaded" only once all of them are in.
        if (!oldClosed) {
          if (live) await ctx.share.leave(o.room).catch(() => undefined)
          await service.seedRoom(target, newRoom, { recordSave: false })
          const into = await service.openWithToken({ ...newRoom, target })
          try {
            await settled(into, timeoutMs)
            await into.assetSync.uploadMissing()
            await settled(into, timeoutMs)
            await service.copyOwnedBlobs(o.room, newRoom, manifestShas(target.store))
          } finally {
            // An editor keeps the new session; a scratch copy ends here.
            if (!live) await into.leave().catch(() => undefined)
          }
        }
        const saved = await ctx.registry.saves.load(o.room)
        if (saved && !(await ctx.registry.saves.load(file.room)))
          await ctx.registry.saves.save(file.room, saved)
        const record = {
          oldRoom: o.room,
          newRoom: file.room,
          workspaceId: ctx.workspaceId,
          fileKey,
          step: "uploaded" as const,
          at: ctx.now(),
        }
        journal[o.room] = record
        await ctx.cache.saveMigration(record)
        await ctx.step?.(o.room, "uploaded")

        // 4. The file follows the new room; the old record stops claiming it.
        await ctx.bind(
          {
            room: file.room,
            workspaceId: ctx.workspaceId,
            fileKey,
            relayUrl: file.relayUrl,
            roomKey: file.roomKey,
            name: file.name,
            boundAt: ctx.now(),
            ended: null,
          },
          token,
        )
        await service.moveFile(fileKey, `${MIGRATED_PREFIX}${o.room}`)
        if (live) await ctx.reopen?.(file.room, { ref: fileKey, store: live.store })
        await ctx.step?.(o.room, "bound")
      }

      // 5. Close the old room with its root key, then forget it.
      const closed = await service.closeOwnedRoom(o.room).catch((error: unknown) => {
        // Another window closed and forgot it meanwhile.
        if (error instanceof MultiplayerError && error.code === "ROOM_NOT_FOUND") return "gone"
        throw error
      })
      if (closed === "unreachable") {
        outcome.left++
        outcome.error = "RELAY_UNREACHABLE"
        continue
      }
      await service.forgetOwnedRoom(o.room)
      const record = journal[o.room]
      if (record) await ctx.cache.saveMigration({ ...record, step: "closed", at: ctx.now() })
      await ctx.step?.(o.room, "closed")
      outcome.moved++
    } catch (error) {
      outcome.left++
      outcome.error =
        error instanceof CloudError || error instanceof MultiplayerError ? error.code : "UNKNOWN"
    }
  }
  return outcome
}
