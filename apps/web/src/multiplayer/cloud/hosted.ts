/**
 * Kimo Cloud workspaces in a desktop window whose files live in the document host (ADR 0002 Option
 * A; `host/cloud-host.ts`). The host holds the files on disk and the owner's registry
 * (`rooms.json`), so it also holds their workspace rooms: it reopens bound files in their rooms,
 * keeps their tokens fresh, shares its files into workspaces, makes Home's managed copies and runs
 * the 1.3.0 re-share. The window's store keeps the rest (the account, lists, members, invites,
 * transfers, rooms joined from a view link, untitled files) and shows the host's bindings, open
 * rooms and re-share progress as its own.
 *
 * Kimo Cloud tells each store separately: the host asks again whenever this window's account
 * changes in a way it acts on (sign-in, sign-out, a workspace deleted or left, a plan change).
 */
import type { CloudBinding } from "./cache"
import type { MigrationOutcome } from "./migrate"
import type { CloudFile, WorkspaceSummary } from "./types"
import {
  fileOf,
  type MigrationState,
  type WorkspaceStore,
  type WorkspacesState,
} from "./workspaces"

/** What the document host holds of the workspaces (pushed to every window on change). */
export interface HostedFilesView {
  bindings: Record<string, CloudBinding>
  open: WorkspacesState["open"]
  migration: MigrationState
}

export type HostedShareResult =
  | { status: "shared"; file: CloudFile; workspaceId: string }
  | { status: "choose"; workspaces: WorkspaceSummary[] }

/** The document host's workspace files, as a window reaches them. */
export interface HostedWorkspaceFiles {
  /** Whether the document host holds `ref` (a file on disk this window opened through it). */
  holds(ref: string): boolean
  shareFile(
    ref: string,
    options: { workspaceId?: string; name?: string },
  ): Promise<HostedShareResult>
  /** The host makes the managed copy and binds it, so the path reopens in its room there. */
  localCopy(room: string): Promise<string | null>
  /** The host asks Kimo Cloud again: the account, or one workspace's members and files. */
  refresh(workspaceId?: string): Promise<void>
  migrate(): Promise<MigrationOutcome | null>
  /** Null until the host answered. */
  view(): HostedFilesView | null
  subscribe(listener: () => void): () => void
  dispose(): void
}

/** What the host acts on in an account: who is signed in, and each workspace's state. */
const accountKey = (s: WorkspacesState) =>
  JSON.stringify([s.accountId, s.workspaces.map((w) => [w.id, w.role, w.deletedAt, w.plan.status])])

/**
 * `base` (the window's own store, created with `migrate` deferred to `attach`) with the files of
 * the document host once `attach` resolves; without a host it is `base` unchanged.
 */
export function withHostedFiles(
  base: WorkspaceStore,
  attach: Promise<HostedWorkspaceFiles | null>,
): WorkspaceStore {
  let hosted: HostedWorkspaceFiles | null = null
  const listeners = new Set<() => void>()
  const merge = (): WorkspacesState => {
    const s = base.getState()
    const h = hosted?.view()
    if (!h) return s
    return {
      ...s,
      bindings: { ...s.bindings, ...h.bindings },
      open: { ...s.open, ...h.open },
      migration: h.migration,
    }
  }
  let view = merge()
  let account = accountKey(base.getState())
  const changed = () => {
    view = merge()
    for (const l of [...listeners]) l()
  }
  const offs: (() => void)[] = [
    base.subscribe(() => {
      const next = accountKey(base.getState())
      if (hosted && next !== account) void hosted.refresh().catch(() => undefined)
      account = next
      changed()
    }),
  ]
  let disposed = false
  void attach.then((h) => {
    if (!h || disposed) return
    hosted = h
    offs.push(h.subscribe(changed), () => h.dispose())
    // The host may have last asked Kimo Cloud before this window's account changed.
    account = accountKey(base.getState())
    if (base.getState().accountId !== null) void h.refresh().catch(() => undefined)
    changed()
  })
  const files = async () => (disposed ? null : await attach)

  return {
    ...base,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState: () => view,
    async shareFile(session, options = {}) {
      const h = await files()
      if (!h?.holds(session.ref)) return base.shareFile(session, options)
      const result = await h.shareFile(session.ref, options)
      if (result.status === "choose") return result
      // The window lists the file at once; its own list catches up in the background.
      void base.refreshWorkspace(result.workspaceId).catch(() => undefined)
      return { ...result, session: null }
    },
    async localCopy(room) {
      const h = await files()
      return h ? h.localCopy(room) : base.localCopy(room)
    },
    async renameFile(room, name) {
      const workspaceId = fileOf(base.getState(), room)?.workspaceId ?? null
      await base.renameFile(room, name)
      // The host lists the new name too.
      if (hosted) await hosted.refresh(workspaceId ?? undefined).catch(() => undefined)
    },
    async closeFile(room) {
      const workspaceId = fileOf(base.getState(), room)?.workspaceId ?? null
      await base.closeFile(room)
      // The host ends its binding (its copy stays a plain local file).
      if (hosted) await hosted.refresh(workspaceId ?? undefined).catch(() => undefined)
    },
    async migrate() {
      const h = await files()
      return h ? h.migrate() : base.migrate()
    },
    dispose() {
      disposed = true
      for (const off of offs.splice(0)) off()
      listeners.clear()
      base.dispose()
    },
  }
}
