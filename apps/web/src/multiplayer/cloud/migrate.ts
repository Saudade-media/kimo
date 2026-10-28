/**
 * The 1.3.0 re-share (ADR 0019 decision 8, kimo-cloud architecture.md §3 "Re-share"): each room
 * this device owns on Kimo Cloud's relay from before workspaces moves into the oldest workspace the
 * account owns. The old room's root key never left this device, so Kimo Cloud cannot move it; the
 * app does, once per room:
 *
 * 1. `POST /v1/workspaces/<ws>/files` with `replaces` = the old room: Kimo Cloud creates and
 *    registers the new room (a repeat answers the same new room with a fresh token);
 * 2. the old room's state (its replica, then the relay's catch-up; or the open editor's store) goes
 *    into the new room, then the blobs the file has locally, and the file's last recorded save
 *    carries over so a later reopen still adds only the file's own changes;
 * 3. the local file is bound to the new room, and the old room's record stops claiming the file;
 * 4. the old room is closed with its root key (admin op 4), which ends its links, and forgotten.
 *
 * Every step is safe to repeat: an interrupted run resumes on the next sign-in. Nothing is closed
 * before the new room holds the state, and a relay that cannot be told keeps the old record (under
 * a tombstone file key) so the close is tried again later.
 */
import { createDocStore } from "@kimo/editor-state"
import { fromBase64Url, MultiplayerError, normalizeRelayUrl } from "@kimo/sync/mp"
import type { PlatformShare } from "../../platform/share"
import type { Registry } from "../registry"
import type { SharedSession, ShareTarget } from "../share"
import type { CloudBinding, CloudCache } from "./cache"
import type { CloudClient } from "./client"
import { CloudError, type CloudToken } from "./types"

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

const baseName = (fileKey: string) => {
  const last = fileKey.split(/[\\/]/).pop() ?? fileKey
  return (last.replace(/\.(kimo|kimoz|pen)$/i, "") || "Untitled").slice(0, 64)
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
        // 1. The new room (a repeat answers the one an earlier run made).
        const { file, token } = await ctx.client.addFile(ctx.workspaceId, {
          name: baseName(fileKey),
          origin: "user",
          replaces: o.room,
        })
        await ctx.step?.(o.room, "created")
        const newRoom = {
          room: file.room,
          relayUrl: file.relayUrl,
          roomKey: fromBase64Url(file.roomKey),
          token: token.token,
        }

        // 2. The old room's state into the new one. An editor open here holds it already: its
        // old connection stops first, so one store never feeds two rooms.
        const live = ctx.share.session(o.room)
        let target: ShareTarget
        let oldClosed = false
        if (live) {
          await settled(live, timeoutMs)
          target = { fileKey, store: live.store, assets: live.assets }
          await ctx.share.leave(o.room).catch(() => undefined)
        } else {
          target = ctx.share.targetOf({ ref: fileKey, store: createDocStore() })
          let scratch: SharedSession | null = null
          try {
            scratch = await service.connect(target, o.room)
            await settled(scratch, timeoutMs)
          } catch (error) {
            // Closed by an earlier run, after its upload: nothing more to bring over.
            if (!(error instanceof MultiplayerError && error.code === "ROOM_CLOSED")) throw error
            oldClosed = true
          } finally {
            await scratch?.leave().catch(() => undefined)
          }
        }
        // A closed old room never seeds: what this device has of it may be less than the upload
        // that preceded the close.
        if (!oldClosed) {
          await service.seedRoom(target, newRoom, { recordSave: false })
          const into = await service.openWithToken({ ...newRoom, target })
          try {
            await settled(into, timeoutMs)
            await into.assetSync.uploadMissing()
            await settled(into, timeoutMs)
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

        // 3. The file follows the new room; the old record stops claiming it.
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

      // 4. Close the old room with its root key, then forget it.
      const closed = await service.closeOwnedRoom(o.room)
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
