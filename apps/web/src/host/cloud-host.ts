/**
 * Kimo Cloud workspace files in the desktop document host (ADR 0019, ADR 0002 Option A). The host
 * holds every file on disk and the owner's registry, so it runs a workspace store of its own over
 * its share layer (`multiplayer/cloud/workspaces.ts`, cache in `rooms.json`):
 *
 * - a bound file reopens in its workspace room as the host opens it, and the room's token is kept
 *   fresh here, in every window that shows the file;
 * - Share to a workspace, Home's managed copies and the 1.3.0 re-share of pre-workspace rooms run
 *   here (`mp.cloud.*`), over the host's store of the file and its `listOwned()` rooms;
 * - windows get the host's bindings, open rooms and re-share progress pushed
 *   (`kimo://host-cloud`), and tell the host when their account changed (`mp.cloud.refresh`).
 *
 * The window side is {@link createHostedWorkspaceFiles}, used by `cloud/hosted.ts`.
 */
import type { KimoPlatform } from "@kimo/platform"
import { type MpErrorCode, MultiplayerError } from "@kimo/sync/mp"
import type {
  HostedFilesView,
  HostedShareResult,
  HostedWorkspaceFiles,
} from "../multiplayer/cloud/hosted"
import { desktopManagedCopies } from "../multiplayer/cloud/managed"
import type { MigrationOutcome } from "../multiplayer/cloud/migrate"
import type { CloudStore } from "../multiplayer/cloud/store"
import { CloudError, type CloudErrorCode } from "../multiplayer/cloud/types"
import {
  createWorkspaceStore,
  type WorkspaceStore,
  type WorkspacesState,
} from "../multiplayer/cloud/workspaces"
import { deviceNameFor } from "../multiplayer/device"
import type { Clock } from "../multiplayer/relay-setup/runner"
import type { FileSessionManager } from "../platform/session"
import type { PlatformShare } from "../platform/share"
import { HOST_EVENTS, type HostBridge } from "./bridge"
import { type HostClient, HostedDocumentSession } from "./client"

type Rpc = Record<string, (args: Record<string, unknown>, from: string) => Promise<unknown>>

/** An answer that keeps the error's code across the bridge (RPC errors arrive as messages). */
type Wire<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: "cloud" | "mp" | "other"; code: string; message: string } }

async function wire<T>(fn: () => Promise<T>): Promise<Wire<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (e instanceof CloudError)
      return { ok: false, error: { kind: "cloud", code: e.code, message } }
    if (e instanceof MultiplayerError)
      return { ok: false, error: { kind: "mp", code: e.code, message } }
    return { ok: false, error: { kind: "other", code: "", message } }
  }
}

function unwire<T>(answer: Wire<T>): T {
  if (answer.ok) return answer.value
  const { kind, code, message } = answer.error
  if (kind === "cloud") throw new CloudError(code as CloudErrorCode, message)
  if (kind === "mp") throw new MultiplayerError(code as MpErrorCode, message)
  throw new Error(message)
}

const viewOf = (s: WorkspacesState): HostedFilesView => ({
  bindings: s.bindings,
  open: s.open,
  migration: s.migration,
})

export interface HostWorkspacesOptions {
  platform: KimoPlatform
  bridge: HostBridge
  manager: FileSessionManager
  /** The host's share layer (its registry is the owner's `rooms.json`). */
  share: PlatformShare
  /** The host's Kimo Cloud store (its own sign-in state, signed with this install's device key). */
  cloud: CloudStore
  clock?: Clock
}

export interface HostWorkspaces {
  readonly store: WorkspaceStore
  /** The `mp.cloud.*` RPC handlers. */
  readonly rpc: Rpc
  dispose(): void
}

export function createHostWorkspaces(options: HostWorkspacesOptions): HostWorkspaces {
  const { platform, bridge, manager, share, cloud } = options
  const store = createWorkspaceStore({
    client: cloud.client,
    cloud,
    registry: share.service.registry,
    share,
    deviceName: () => deviceNameFor(platform),
    clientKind: "desktop",
    openUrl: (url) => platform.files.openExternalUrl(url),
    ...(options.clock ? { clock: options.clock } : {}),
    managedCopies: desktopManagedCopies(platform),
    migrate: true,
  })
  // The account as Kimo Cloud answers it now (a window asks again whenever its own changes).
  void cloud.refresh().catch(() => undefined)

  let pushed: HostedFilesView | null = null
  const offStore = store.subscribe(() => {
    const s = store.getState()
    if (
      pushed &&
      pushed.bindings === s.bindings &&
      pushed.open === s.open &&
      pushed.migration === s.migration
    )
      return
    pushed = viewOf(s)
    void bridge.emit(HOST_EVENTS.cloud, pushed).catch(() => undefined)
  })

  const sessionOf = (ref: string) => {
    const s = manager.get(ref)
    if (!s) throw new Error(`${ref} is not open in the document host`)
    return { ref: s.ref, store: s.store }
  }

  const rpc: Rpc = {
    "mp.cloud.view": async () => viewOf(store.getState()),
    "mp.cloud.shareFile": (args) =>
      wire(async (): Promise<HostedShareResult> => {
        const r = await store.shareFile(sessionOf(String(args.ref)), {
          ...(typeof args.workspaceId === "string" ? { workspaceId: args.workspaceId } : {}),
          ...(typeof args.name === "string" ? { name: args.name } : {}),
        })
        return r.status === "choose"
          ? r
          : { status: "shared", file: r.file, workspaceId: r.workspaceId }
      }),
    "mp.cloud.localCopy": (args) => wire(() => store.localCopy(String(args.room))),
    // The account only: the store follows it (bindings, rooms, re-share) and asks for the lists
    // that are due. Every window asks as it attaches, and the device shares one request budget.
    "mp.cloud.refresh": (args) =>
      wire(async () => {
        if (typeof args.workspaceId === "string") return store.refreshWorkspace(args.workspaceId)
        await store.ready()
        await cloud.refresh()
      }),
    "mp.cloud.migrate": () => wire(() => store.migrate()),
  }

  return {
    store,
    rpc,
    dispose() {
      offStore()
      store.dispose()
      cloud.dispose()
    },
  }
}

/** The window side: this window's hosted files, calls and pushes of the document host. */
export function createHostedWorkspaceFiles(
  client: HostClient,
  manager: FileSessionManager,
): HostedWorkspaceFiles {
  let current: HostedFilesView | null = null
  const listeners = new Set<() => void>()
  const set = (next: HostedFilesView) => {
    current = next
    for (const l of [...listeners]) l()
  }
  const load = () => client.call<HostedFilesView>("mp.cloud.view", {}).then(set, () => undefined)
  const offs: (() => void)[] = []
  let disposed = false
  void client.bridge
    .listen<HostedFilesView>(HOST_EVENTS.cloud, (view) => set(view))
    .then((off) => (disposed ? off() : offs.push(off)))
  // After a host restart the window asks again.
  offs.push(client.onReady(() => void load()))
  void load()
  const call = async <T>(method: string, args: Record<string, unknown>, timeoutMs?: number) =>
    unwire(await client.call<Wire<T>>(method, args, timeoutMs))

  return {
    holds(ref) {
      const s = manager.get(ref)
      return s instanceof HostedDocumentSession && s.hosted
    },
    // Seeding a room uploads the file's images: give it the time a share takes.
    shareFile: (ref, options) =>
      call<HostedShareResult>("mp.cloud.shareFile", { ref, ...options }, 120_000),
    localCopy: (room) => call<string | null>("mp.cloud.localCopy", { room }),
    refresh: (workspaceId) => call<void>("mp.cloud.refresh", workspaceId ? { workspaceId } : {}),
    migrate: () => call<MigrationOutcome | null>("mp.cloud.migrate", {}, 600_000),
    view: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      disposed = true
      for (const off of offs.splice(0)) off()
      listeners.clear()
    },
  }
}
