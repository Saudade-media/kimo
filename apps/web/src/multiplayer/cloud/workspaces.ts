/**
 * Kimo Cloud workspaces in the app (ADR 0019, board 46), one store per window, headless: the
 * workspaces this account belongs to, their members, invites, requests and file lists, the files
 * bound to local copies, and the token of every workspace room open here. README.md beside this
 * file is the UI's guide to it.
 *
 * - **Fast by default.** Everything Kimo Cloud answered is kept in the registry (`./cache.ts`), so
 *   the lists render and a file opens from the cache (its room key and a token with time left)
 *   before the network answers; the cache is refreshed in the background. A failure keeps what is
 *   cached: nothing is dropped because Kimo Cloud did not answer.
 * - **Tokens.** Edit tokens live 24 hours. An open room asks for a new one once half its life is
 *   gone and presents it on the open connection (`refresh`, spec §11.2); when the new role differs
 *   (the plan went read-only, or was renewed) it reconnects instead, since `refresh` keeps the role.
 *   A read-only plan gets view tokens, so the file opens view-only. Expired or rotated tokens are
 *   replaced silently; a revoked one means removed, signed out, or the file is gone.
 * - **Local copies are never deleted here.** A closed file stays a plain local file; a deleted
 *   workspace or a removed member leaves read-only copies (board 46 6E, 6F).
 * - **Seats catch up.** Kimo Cloud bills a member who joined a moment after its answer (its seat
 *   sync runs after the request), so a running plan can list fewer seats than members for a few
 *   seconds. While it does, the account is asked again after {@link SEAT_FOLLOW_MS}.
 */
import type { KimoDocument } from "@kimo/core-schema"
import { formatJoinLink, fromBase64Url, parseToken } from "@kimo/sync/mp"
import type { CloudFileHooks, PlatformShare, ShareableSession } from "../../platform/share"
import type { Registry } from "../registry"
import { type Clock, realClock } from "../relay-setup/runner"
import type { SharedSession } from "../share"
import { type BindingEnd, type CloudBinding, type CloudCache, createCloudCache } from "./cache"
import type { CloudClient } from "./client"
import { type MigrationOutcome, migrateLegacyRooms } from "./migrate"
import type { CloudState, CloudStore } from "./store"
import {
  type AccessRequest,
  type BillingInterval,
  type CheckoutCreated,
  type CloudAccount,
  CloudError,
  type CloudErrorCode,
  type CloudFile,
  type CloudToken,
  type FileList,
  type InvitePeek,
  isUnreachable,
  type Member,
  type MemberRole,
  type PlanStatus,
  type TokenRole,
  type ViewLink,
  type WorkspaceDetail,
  type WorkspaceSummary,
} from "./types"
import { workspaceFileName } from "./workspace-view"

/** The read-only reason of a copy whose workspace was deleted (board 46 6E). */
export const CLOUD_DELETED_REASON = "cloud: workspace deleted"
/** The read-only reason of a copy after leaving or being removed (board 46 6F). */
export const CLOUD_REMOVED_REASON = "cloud: no longer a member"

/** A cached token opens a file while at least this much of it is left. */
export const TOKEN_MIN_LEFT_MS = 60_000
/** An open room checks its token at least this often (a machine asleep, a throttled tab). */
export const TOKEN_CHECK_MS = 60 * 60_000
/** After a token refresh got no answer, the next try. */
export const TOKEN_RETRY_MS = 60_000
/** The transfer checkout is polled this often while it is open (as board 43's checkout). */
export const TRANSFER_POLL_MS = 3000
/** A workspace's members and files are refreshed in the background at most this often. */
export const WORKSPACE_REFRESH_MS = 30_000
/**
 * While a running plan bills fewer seats than it has members (a member just joined and Kimo Cloud's
 * seat sync has not run yet), the account is asked again after each of these waits, then no more
 * until a refresh shows the seats caught up or another member is approved here.
 */
export const SEAT_FOLLOW_MS = [2000, 4000, 8000, 16_000] as const

export type InviteFlow =
  /** Reading the invite (§14.3). */
  | { phase: "checking"; token: string }
  /** Board 46 3D "Join <workspace>?" */
  | { phase: "ready"; token: string; peek: InvitePeek; busy: boolean; error: CloudErrorCode | null }
  /** The invite's email has an account: sign in as `peek.email` first; it is accepted after. */
  | { phase: "sign-in"; token: string; peek: InvitePeek }
  | { phase: "joined"; token: string; workspace: WorkspaceSummary }
  /** `INVITE_EXPIRED`, `INVITE_USED` or another refusal: "This invite no longer works." */
  | { phase: "failed"; token: string; error: CloudErrorCode }

export type TransferFlow =
  /** The new Owner's checkout is open in the browser (board 46 6B), polled. */
  | {
      phase: "waiting"
      workspaceId: string
      transferId: string
      checkoutId: string
      url: string
      expiresAt: number
    }
  /** 6C "You're now the Owner of <workspace>". */
  | { phase: "done"; workspaceId: string }
  | { phase: "failed"; workspaceId: string; error: CloudErrorCode | null }

export interface MigrationState {
  phase: "idle" | "running" | "done" | "failed"
  /** Rooms re-shared into a workspace so far. */
  moved: number
  /** Rooms still to move (an unreachable relay, an interrupted run). */
  left: number
  error: CloudErrorCode | null
}

export interface WorkspacesState {
  /** The cache was read: the lists below are what this device last knew. */
  hydrated: boolean
  accountId: string | null
  /** Every workspace the account is a member of, oldest membership first. */
  workspaces: WorkspaceSummary[]
  /** Members, invites and requests per workspace (as last fetched). */
  details: Record<string, WorkspaceDetail>
  /** File lists per workspace (as last fetched). */
  files: Record<string, FileList>
  /** Rooms bound to local copies, by room. */
  bindings: Record<string, CloudBinding>
  /** This account's own edit access requests. */
  accessRequests: AccessRequest[]
  invite: InviteFlow | null
  transfer: TransferFlow | null
  migration: MigrationState
  /** Workspace rooms open here, with the role of the token their connection holds. */
  open: Record<string, { workspaceId: string; role: TokenRole }>
  /** The last call got no answer (offline or Kimo Cloud down); cached data stays. */
  offline: boolean
}

export type ShareResult =
  | { status: "shared"; file: CloudFile; workspaceId: string; session: SharedSession }
  /** Several workspaces can take the file: the caller picks one and calls again with it. */
  | { status: "choose"; workspaces: WorkspaceSummary[] }

/** Desktop: where a workspace file that is not on disk gets its Kimo-managed copy. */
export interface ManagedCopies {
  /** Creates the copy (an empty document the room fills) and resolves its file key. */
  create(input: {
    workspaceId: string
    workspaceName: string
    room: string
    name: string
  }): Promise<string>
}

export interface WorkspaceStoreDeps {
  client: CloudClient
  /** The account, the sign-in and its refresh on focus (board 43). */
  cloud: CloudStore
  registry: Registry
  share: PlatformShare
  deviceName(): string
  clientKind: "web" | "desktop"
  openUrl(url: string): Promise<void>
  clock?: Clock
  /** Desktop: the managed folder for copies of files not on disk. Web: none (room replicas). */
  managedCopies?: ManagedCopies | null
  /** Base of view links (default: each file's relay, which serves `/join`). */
  webOrigin?: string
  /** Re-share this device's pre-workspace Cloud rooms after sign-in (default true). */
  migrate?: boolean
}

export interface WorkspaceStore {
  subscribe(listener: () => void): () => void
  getState(): WorkspacesState
  /** Resolves once the cache was read. */
  ready(): Promise<void>
  /** The account (through the Cloud store), then each workspace's members and files. */
  refresh(): Promise<void>
  refreshWorkspace(workspaceId: string): Promise<void>

  createWorkspace(name: string): Promise<WorkspaceSummary>
  renameWorkspace(workspaceId: string, name: string): Promise<void>
  /** §13.4 checkout for the Owner; opens it in the browser. Poll with the Cloud store's account. */
  checkout(workspaceId: string, interval: BillingInterval): Promise<CheckoutCreated>
  openPortal(workspaceId: string): Promise<void>

  invite(workspaceId: string, email: string, role: MemberRole): Promise<void>
  cancelInvite(workspaceId: string, inviteId: string): Promise<void>
  setRole(workspaceId: string, account: string, role: MemberRole): Promise<Member[]>
  /** Resolves the view links the member had made, now ended (the removal dialog offers new ones). */
  removeMember(workspaceId: string, account: string): Promise<ViewLink[]>
  /** Admins and Editors (board 46 6F): local copies stay, read-only. Resolves the ended links. */
  leave(workspaceId: string): Promise<ViewLink[]>
  approveRequest(workspaceId: string, requestId: string): Promise<void>
  declineRequest(workspaceId: string, requestId: string): Promise<void>

  /** Someone with a view link asks to edit (§15.1). */
  requestAccess(room: string): Promise<AccessRequest>
  /** Checks pending requests (on focus): an approved one refreshes the account. */
  checkAccessRequests(): Promise<void>

  /** An invite link opened (`kimo://cloud/invite#<token>`, `/invite#<token>`). */
  openInviteLink(token: string): Promise<void>
  acceptInvite(): Promise<void>
  dismissInvite(): void

  /** The Owner asks an Admin to take over (board 46 6A). */
  requestTransfer(workspaceId: string, toAccount: string): Promise<void>
  cancelTransfer(workspaceId: string): Promise<void>
  /** The named Admin accepts (6B): opens the checkout for the same seats and polls it. */
  acceptTransfer(workspaceId: string): Promise<void>
  declineTransfer(workspaceId: string): Promise<void>
  /** The transfer email's link (the app's URL): refreshes, so the 6B dialog can show. */
  openTransferLink(): Promise<void>
  dismissTransfer(): void
  /** Board 46 6D: `typedName` must equal the workspace's name. */
  deleteWorkspace(workspaceId: string, typedName: string): Promise<void>

  /**
   * Starts sharing an open document on Kimo Cloud: adds it to `workspaceId`, or to the only
   * workspace that can take it; with several, resolves `choose` and changes nothing.
   */
  shareFile(
    session: ShareableSession,
    options?: { workspaceId?: string; name?: string },
  ): Promise<ShareResult>
  /**
   * Opens a workspace file: in `session`'s document when given (a local copy), else in a
   * Kimo-managed replica. Uses the cached room key and token when it can.
   */
  openFile(
    room: string,
    options?: { session?: ShareableSession; file?: KimoDocument | null },
  ): Promise<SharedSession>
  /**
   * Where a workspace file's local copy is: its file key (a path on desktop, created in the
   * managed folder when the file is not on disk yet), or null on web, where the copy is the
   * room's replica and {@link WorkspaceStore.openFile} without a session opens it.
   */
  localCopy(room: string): Promise<string | null>
  renameFile(room: string, name: string): Promise<void>
  /** Admins: removes the file from the workspace; copies stay as local files. */
  closeFile(room: string): Promise<void>

  /** A view link for `room` (§17.2): the record and the link to show. */
  createViewLink(
    room: string,
    input: { expiresAt: number | null; label: string | null },
  ): Promise<{ link: ViewLink; url: string }>
  listLinks(workspaceId: string): Promise<ViewLink[]>
  revokeLink(room: string, jti: string): Promise<void>

  /** Re-shares this device's pre-workspace Cloud rooms (runs on sign-in; safe to call again). */
  migrate(): Promise<MigrationOutcome | null>
  dispose(): void
}

// --- Picks (pure) ---------------------------------------------------------------------------------

/** Workspaces a new file can go to: not deleted, and a plan that allows new rooms. */
export const shareableWorkspaces = (s: Pick<WorkspacesState, "workspaces">) =>
  s.workspaces.filter((w) => w.deletedAt === null && w.plan.canShare)

/** Transfers waiting for this account to accept (board 46 6B). */
export const incomingTransfers = (s: Pick<WorkspacesState, "workspaces" | "accountId">) =>
  s.workspaces.filter(
    (w) => w.deletedAt === null && w.transfer !== null && w.transfer.toAccount === s.accountId,
  )

/** The workspace a room belongs to, with its file, from the cached lists. */
export function fileOf(
  s: Pick<WorkspacesState, "files">,
  room: string,
): { workspaceId: string; file: CloudFile } | null {
  for (const [workspaceId, list] of Object.entries(s.files)) {
    const file = list.files.find((f) => f.room === room)
    if (file) return { workspaceId, file }
  }
  return null
}

/** The live binding of a local file: not ended, of this account, the newest. */
export function bindingForFile(
  s: Pick<WorkspacesState, "bindings" | "accountId">,
  fileKey: string,
): CloudBinding | null {
  const found = Object.values(s.bindings)
    .filter((b) => b.fileKey === fileKey && (b.accountId ?? s.accountId) === s.accountId)
    .sort((a, b) => b.boundAt - a.boundAt)
  return found.find((b) => b.ended === null) ?? found[0] ?? null
}

/** A running plan that bills fewer seats than members: Kimo Cloud's seat sync is still to come. */
export const seatsBehind = (w: Pick<WorkspaceSummary, "plan" | "members" | "deletedAt">) =>
  w.deletedAt === null &&
  (w.plan.status === "active" || w.plan.status === "past_due") &&
  w.plan.seats !== null &&
  w.plan.seats < w.members

/** The token role a plan gives (§17.1): view once writes stop; null without a plan. */
export const tokenRoleFor = (status: PlanStatus): TokenRole | null =>
  status === "none" ? null : status === "read_only" || status === "expired" ? "view" : "edit"

/** When a token should be replaced: half its life gone (null: a link that never expires). */
export function refreshDueAt(token: CloudToken): number | null {
  if (token.expiresAt === null) return null
  let lifetime = 0
  try {
    const parsed = parseToken(token.token)
    lifetime = parsed.exp === 0 ? 0 : (parsed.exp - parsed.iat) * 1000
  } catch {
    lifetime = 0
  }
  return token.expiresAt - Math.max(0, lifetime) / 2
}

const usable = (token: CloudToken | undefined, now: number): token is CloudToken =>
  !!token && (token.expiresAt === null || token.expiresAt - now > TOKEN_MIN_LEFT_MS)

const codeOf = (error: unknown): CloudErrorCode =>
  error instanceof CloudError ? error.code : "UNKNOWN"

/** What a refusal on a room means for its local copy; null: not the end of it. */
function endOf(code: string): BindingEnd | null {
  switch (code) {
    case "WORKSPACE_DELETED":
      return "deleted"
    case "NOT_MEMBER":
      return "removed"
    case "ROOM_CLOSED":
    case "NOT_FOUND":
      return "closed"
    default:
      return null
  }
}

/** A file's name in the workspace: the document's own name, else the file's base name. */
const fileNameOf = (session: ShareableSession): string =>
  workspaceFileName(session.ref, session.store.toHeader() as { meta?: { name?: unknown } })

const initialMigration: MigrationState = { phase: "idle", moved: 0, left: 0, error: null }

interface OpenRoom {
  room: string
  workspaceId: string
  session: SharedSession
  /** The token the connection holds. */
  token: CloudToken
  timer: unknown
  renewing: Promise<void> | null
  offs: (() => void)[]
  /** The local document it lives in (followed to a re-shared room). */
  local: ShareableSession | null
}

// --- Store ----------------------------------------------------------------------------------------

export function createWorkspaceStore(deps: WorkspaceStoreDeps): WorkspaceStore {
  const { client, cloud, share } = deps
  const clock = deps.clock ?? realClock
  const cache: CloudCache = createCloudCache(deps.registry.cloud, clock.now)
  const listeners = new Set<() => void>()
  let state: WorkspacesState = {
    hydrated: false,
    accountId: null,
    workspaces: [],
    details: {},
    files: {},
    bindings: {},
    accessRequests: [],
    invite: null,
    transfer: null,
    migration: initialMigration,
    open: {},
    offline: false,
  }
  let tokens: Record<string, CloudToken> = {}
  let disposed = false
  const set = (patch: Partial<WorkspacesState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const l of [...listeners]) l()
  }
  const reached = () => {
    if (state.offline) set({ offline: false })
  }
  const failed = (error: unknown) => {
    if (isUnreachable(error)) set({ offline: true })
    else reached()
  }
  /** Runs a call: the offline flag follows its outcome, errors still reach the caller. */
  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      const value = await fn()
      reached()
      return value
    } catch (error) {
      failed(error)
      throw error
    }
  }

  // --- Cache and account ----------------------------------------------------------------------

  let lastAccount: CloudAccount | null = null
  const refreshedAt = new Map<string, number>()
  let migrated = false

  const hydrated = (async () => {
    const kept = await cache.load().catch(() => null)
    if (disposed) return
    if (kept) {
      tokens = kept.tokens
      set({
        accountId: kept.accountId,
        workspaces: kept.account?.workspaces ?? [],
        accessRequests: kept.account?.accessRequests ?? [],
        details: kept.details,
        files: kept.files,
        bindings: kept.bindings,
      })
    }
    set({ hydrated: true })
    applyCloud(cloud.getState())
  })()

  /** Everything of the signed-in account goes (sign-out, another account); bindings stay. */
  const forgetAccount = () => {
    for (const o of [...opened.values()]) void endRoom(o, null)
    tokens = {}
    lastAccount = null
    migrated = false
    refreshedAt.clear()
    void cache.clearAccount().catch(() => undefined)
    set({
      accountId: null,
      workspaces: [],
      details: {},
      files: {},
      accessRequests: [],
      transfer: null,
      migration: initialMigration,
    })
  }

  function applyCloud(cs: CloudState) {
    if (!state.hydrated) return
    if (cs.session === "signed-out") {
      if (state.accountId !== null) forgetAccount()
      return
    }
    if (cs.session !== "signed-in" || !cs.account || cs.account === lastAccount) return
    const account = cs.account
    if (state.accountId !== null && state.accountId !== account.account.id) forgetAccount()
    const before = state.workspaces
    lastAccount = account
    set({
      accountId: account.account.id,
      workspaces: account.workspaces,
      accessRequests: account.accessRequests,
    })
    void cache.saveAccount(account).catch(() => undefined)
    afterWorkspaces(before, account.workspaces)
    const inv = state.invite
    if (inv?.phase === "sign-in") void acceptInvite()
    if (deps.migrate !== false && !migrated) {
      migrated = true
      void migrate()
    }
  }
  const offCloud = cloud.subscribe(() => applyCloud(cloud.getState()))

  /** Reacts to a new workspace list: deletions, removals, plan changes, finished transfers. */
  const afterWorkspaces = (before: WorkspaceSummary[], after: WorkspaceSummary[]) => {
    const now = new Map(after.map((w) => [w.id, w]))
    const was = new Map(before.map((w) => [w.id, w]))
    for (const b of Object.values(state.bindings)) {
      if (b.ended !== null || (b.accountId ?? state.accountId) !== state.accountId) continue
      const w = now.get(b.workspaceId)
      if (w?.deletedAt != null) void endBinding(b.room, "deleted")
      // Listed before and gone now: this account left or was removed.
      else if (!w && was.has(b.workspaceId)) void endBinding(b.room, "removed")
    }
    for (const o of opened.values()) {
      const w = now.get(o.workspaceId)
      const prev = was.get(o.workspaceId)
      if (!w || !prev) continue
      // A lapse or a renewal changes the role: reconnect with the new token now.
      if (tokenRoleFor(w.plan.status) !== tokenRoleFor(prev.plan.status)) void renew(o)
    }
    const t = state.transfer
    if (t?.phase === "waiting" && now.get(t.workspaceId)?.role === "owner") {
      stopTransferPoll()
      set({ transfer: { phase: "done", workspaceId: t.workspaceId } })
    }
    for (const w of after)
      if (
        w.deletedAt === null &&
        clock.now() - (refreshedAt.get(w.id) ?? 0) >= WORKSPACE_REFRESH_MS
      )
        void refreshWorkspace(w.id).catch(() => undefined)
    followSeats(after)
  }

  // --- Seats -------------------------------------------------------------------------------------

  /** Workspaces whose seats were behind their members at the last look. */
  const behind = new Set<string>()
  let seatTimer: unknown = null
  let seatTries = 0
  const stopSeatFollow = () => {
    if (seatTimer !== null) clock.clearTimeout(seatTimer)
    seatTimer = null
  }
  /**
   * Asks for the account again while a plan's seats are behind its members (the Plan row and the
   * storage limit follow), a few times at most; a workspace that caught up gets its detail again.
   */
  const followSeats = (list: readonly WorkspaceSummary[]) => {
    const now = new Set(list.filter(seatsBehind).map((w) => w.id))
    for (const id of behind)
      if (!now.has(id)) {
        behind.delete(id)
        if (list.some((w) => w.id === id && w.deletedAt === null))
          void refreshWorkspace(id).catch(() => undefined)
      }
    for (const id of now) behind.add(id)
    if (behind.size === 0) {
      seatTries = 0
      stopSeatFollow()
      return
    }
    const wait = SEAT_FOLLOW_MS[seatTries]
    if (seatTimer !== null || wait === undefined) return
    seatTries++
    seatTimer = clock.setTimeout(() => {
      seatTimer = null
      void cloud.refresh()
    }, wait)
  }

  const refresh = async () => {
    await hydrated
    await cloud.refresh()
    for (const w of state.workspaces)
      if (w.deletedAt === null) await refreshWorkspace(w.id).catch(() => undefined)
  }

  /** A route answered that the workspace is gone (deleted, or this account is no member). */
  const workspaceGone = async (error: unknown) => {
    const code = codeOf(error)
    if (code === "WORKSPACE_DELETED" || code === "NOT_FOUND") await cloud.refresh()
  }

  const refreshWorkspace = async (workspaceId: string) => {
    await hydrated
    const accountId = state.accountId
    if (!accountId) return
    refreshedAt.set(workspaceId, clock.now())
    try {
      const [detail, list] = await Promise.all([
        call(() => client.workspace(workspaceId)),
        call(() => client.files(workspaceId)),
      ])
      if (state.accountId !== accountId) return
      set({ details: { ...state.details, [workspaceId]: detail } })
      void cache.saveDetail(accountId, workspaceId, detail).catch(() => undefined)
      applyFileList(accountId, workspaceId, detail.workspace.plan.status, list)
    } catch (error) {
      await workspaceGone(error)
      throw error
    }
  }

  /** A fresh file list: kept, then closed and re-shared rooms are followed. */
  const applyFileList = (
    accountId: string,
    workspaceId: string,
    status: PlanStatus,
    list: FileList,
  ) => {
    // Without a plan the service lists nothing (§16.1): that is not every file closed.
    if (status === "none" && list.files.length === 0 && list.closed.length === 0) return
    set({ files: { ...state.files, [workspaceId]: list } })
    void cache.saveFiles(accountId, workspaceId, list).catch(() => undefined)
    for (const c of list.closed) {
      const b = state.bindings[c.room]
      if (!b || b.ended !== null || b.workspaceId !== workspaceId) continue
      void roomClosed(c.room, c.replacedBy)
    }
  }

  const fileFor = async (room: string) => {
    await hydrated
    const known = fileOf(state, room)
    if (known) return known
    const bound = state.bindings[room]
    if (bound && bound.ended === null)
      return {
        workspaceId: bound.workspaceId,
        file: {
          room,
          name: bound.name,
          relayUrl: bound.relayUrl,
          roomKey: bound.roomKey,
          addedBy: "",
          createdAt: 0,
          updatedAt: 0,
          replacedBy: null,
        },
      }
    // Not cached: ask each workspace for its list.
    for (const w of state.workspaces)
      if (w.deletedAt === null) await refreshWorkspace(w.id).catch(() => undefined)
    const found = fileOf(state, room)
    if (!found) throw new CloudError("NOT_FOUND", "this room is not a file of your workspaces")
    return found
  }

  // --- Bindings --------------------------------------------------------------------------------

  const saveBinding = async (binding: CloudBinding) => {
    set({ bindings: { ...state.bindings, [binding.room]: binding } })
    await cache.saveBinding(binding).catch(() => undefined)
  }

  /** The local copy stops syncing; it stays, read-only for a deleted workspace or a removal. */
  const endBinding = async (room: string, end: BindingEnd) => {
    const o = opened.get(room)
    if (o) await endRoom(o, end)
    const b = state.bindings[room]
    if (b && b.ended === null) await saveBinding({ ...b, ended: end })
    tokens = Object.fromEntries(Object.entries(tokens).filter(([r]) => r !== room))
    void cache.dropToken(room).catch(() => undefined)
  }

  /** A room closed at the relay or listed closed: follow a re-share, else end the copy. */
  const roomClosed = async (room: string, replacedBy: string | null) => {
    const o = opened.get(room)
    const b = state.bindings[room]
    if (!replacedBy) return endBinding(room, "closed")
    const local = o?.local ?? null
    if (o) await endRoom(o, null)
    if (b && b.ended === null) {
      // What the file last recorded carries over, so its next reopen adds only its own changes.
      const saved = await deps.registry.saves.load(room).catch(() => null)
      if (saved && !(await deps.registry.saves.load(replacedBy).catch(() => null)))
        await deps.registry.saves.save(replacedBy, saved).catch(() => undefined)
      await saveBinding({ ...b, ended: "closed" })
      const next = fileOf(state, replacedBy)
      if (next)
        await saveBinding({
          ...b,
          room: replacedBy,
          relayUrl: next.file.relayUrl,
          roomKey: next.file.roomKey,
          name: next.file.name,
          boundAt: clock.now(),
          ended: null,
        })
    }
    if (local) await openFile(replacedBy, { session: local }).catch(() => undefined)
  }

  // --- Open rooms and their tokens --------------------------------------------------------------

  const opened = new Map<string, OpenRoom>()

  const setOpen = () =>
    set({
      open: Object.fromEntries(
        [...opened.values()].map((o) => [
          o.room,
          { workspaceId: o.workspaceId, role: o.token.role },
        ]),
      ),
    })

  const keepToken = (room: string, token: CloudToken) => {
    const current = tokens[room]
    if (
      current?.expiresAt != null &&
      token.expiresAt !== null &&
      current.role === token.role &&
      current.expiresAt > token.expiresAt
    )
      return
    tokens = { ...tokens, [room]: token }
    const accountId = state.accountId
    if (accountId) void cache.saveToken(accountId, room, token).catch(() => undefined)
  }

  const fetchToken = async (room: string) => {
    const token = await call(() => client.roomToken(room))
    keepToken(room, token)
    return token
  }

  const schedule = (o: OpenRoom, wait?: number) => {
    if (o.timer !== null) clock.clearTimeout(o.timer)
    o.timer = null
    if (disposed || opened.get(o.room) !== o) return
    const due = refreshDueAt(o.token)
    if (due === null) return
    const ms = wait ?? Math.min(Math.max(due - clock.now(), 1000), TOKEN_CHECK_MS)
    o.timer = clock.setTimeout(() => {
      o.timer = null
      const at = refreshDueAt(o.token)
      if (at !== null && clock.now() < at) return schedule(o)
      void renew(o)
    }, ms)
    ;(o.timer as { unref?: () => void } | null)?.unref?.()
  }

  /** A new token for an open room: refreshed on the connection, or a reconnect for a new role. */
  const renew = (o: OpenRoom): Promise<void> => {
    o.renewing ??= (async () => {
      try {
        const token = await fetchToken(o.room)
        if (opened.get(o.room) !== o) return
        const held = o.token
        // An answer older than the token held (a slow call) never replaces it.
        if (
          token.role === held.role &&
          token.expiresAt !== null &&
          held.expiresAt !== null &&
          token.expiresAt < held.expiresAt
        )
          return schedule(o)
        o.token = token
        await share.service.swapToken(
          o.room,
          token.token,
          token.role === held.role ? "refresh" : "reconnect",
        )
        if (token.role !== held.role) setOpen()
        schedule(o)
      } catch (error) {
        const end = endOf(codeOf(error))
        if (end === "closed") return roomClosed(o.room, replacedOf(o.room))
        if (end) return endBinding(o.room, end)
        if (codeOf(error) === "NOT_SIGNED_IN" || codeOf(error) === "PLAN_REQUIRED")
          return endRoom(o, null)
        // No answer: the token held keeps working for its remaining half; try again soon.
        schedule(o, TOKEN_RETRY_MS)
      } finally {
        o.renewing = null
      }
    })()
    return o.renewing
  }

  const replacedOf = (room: string) => {
    for (const list of Object.values(state.files)) {
      const c = list.closed.find((x) => x.room === room)
      if (c) return c.replacedBy
    }
    return null
  }

  /** The relay refused the room's connection. */
  const onRelayCode = async (o: OpenRoom, code: string) => {
    if (opened.get(o.room) !== o) return
    if (code === "TOKEN_EXPIRED" || code === "KEY_ROTATED") return renew(o)
    if (code === "TOKEN_REVOKED") {
      // Removed, signed out, the file closed or the workspace deleted: the account says which.
      await cloud.refresh()
      if (opened.get(o.room) === o) return renew(o)
      return
    }
    if (code === "ROOM_CLOSED") {
      await refreshWorkspace(o.workspaceId).catch(() => undefined)
      if (opened.get(o.room) === o) return roomClosed(o.room, replacedOf(o.room))
    }
  }

  const watch = (
    room: string,
    workspaceId: string,
    session: SharedSession,
    token: CloudToken,
    local: ShareableSession | null,
  ) => {
    const prior = opened.get(room)
    if (prior?.session === session) {
      if (local) prior.local = local
      return prior
    }
    if (prior) void endRoom(prior, null, { keepSession: true })
    const o: OpenRoom = {
      room,
      workspaceId,
      session,
      token,
      timer: null,
      renewing: null,
      offs: [],
      local,
    }
    opened.set(room, o)
    o.offs.push(
      session.onEvent((event) => {
        const code =
          event.type === "denied"
            ? event.code
            : event.type === "closed" && event.error && !event.willRetry
              ? event.error.code
              : null
        if (code) void onRelayCode(o, code)
      }),
    )
    // Leaving the session (the editor closed) stops the token's upkeep.
    const leave = session.leave.bind(session)
    ;(session as { leave: () => Promise<void> }).leave = async () => {
      if (opened.get(room) === o) void endRoom(o, null, { keepSession: true })
      await leave()
    }
    schedule(o)
    setOpen()
    return o
  }

  /** Stops a room here: its token upkeep and its session; `end` makes the copy read-only. */
  const endRoom = async (
    o: OpenRoom,
    end: BindingEnd | null,
    opts: { keepSession?: boolean } = {},
  ) => {
    if (opened.get(o.room) === o) opened.delete(o.room)
    if (o.timer !== null) clock.clearTimeout(o.timer)
    o.timer = null
    for (const off of o.offs.splice(0)) off()
    setOpen()
    if (!opts.keepSession) await o.session.leave().catch(() => undefined)
    if (end === "deleted") o.session.store.setReadOnly(CLOUD_DELETED_REASON)
    if (end === "removed") o.session.store.setReadOnly(CLOUD_REMOVED_REASON)
  }

  const openFile: WorkspaceStore["openFile"] = async (room, options = {}) => {
    const { workspaceId, file } = await fileFor(room)
    const ws = state.workspaces.find((w) => w.id === workspaceId)
    if (ws?.deletedAt != null)
      throw new CloudError("WORKSPACE_DELETED", "the workspace was deleted")
    const cached = tokens[room]
    let token: CloudToken
    try {
      token = usable(cached, clock.now()) ? cached : await fetchToken(room)
    } catch (error) {
      const end = endOf(codeOf(error))
      if (end && end !== "closed") await endBinding(room, end)
      throw error
    }
    const session = await share.openCloudRoom(
      { room, relayUrl: file.relayUrl, roomKey: fromBase64Url(file.roomKey), token: token.token },
      {
        ...(options.session ? { session: options.session } : {}),
        file: options.file ?? null,
      },
    )
    const bound = state.bindings[room]
    const fileKey = options.session?.ref ?? bound?.fileKey ?? null
    if (!bound || bound.ended !== null || bound.fileKey !== fileKey || bound.name !== file.name)
      await saveBinding({
        room,
        workspaceId,
        fileKey,
        relayUrl: file.relayUrl,
        roomKey: file.roomKey,
        name: file.name,
        boundAt: bound?.boundAt ?? clock.now(),
        ended: null,
        ...(state.accountId ? { accountId: state.accountId } : {}),
      })
    const o = watch(room, workspaceId, session, token, options.session ?? null)
    // A cached token past half its life is replaced now, while the file is already open.
    const due = refreshDueAt(token)
    if (due !== null && clock.now() >= due) void renew(o)
    return session
  }

  // Bound files reopen through the share layer (room-session hooks, library files).
  const hooks: CloudFileHooks = {
    async isBound(ref) {
      await hydrated
      return bindingForFile(state, ref) !== null
    },
    async reopen(session, _target, file) {
      await hydrated
      const b = bindingForFile(state, session.ref)
      if (!b) return null
      const w = state.workspaces.find((x) => x.id === b.workspaceId)
      const end = b.ended ?? (w?.deletedAt != null ? "deleted" : null)
      if (end === "deleted") session.store.setReadOnly(CLOUD_DELETED_REASON)
      if (end === "removed") session.store.setReadOnly(CLOUD_REMOVED_REASON)
      if (end) return null
      try {
        return await openFile(b.room, { session, file })
      } catch (error) {
        // Offline with no token left: the file opens as a local file; its edits reach the room
        // on a later open (they are a delta over its last recorded save).
        if (isUnreachable(error)) return null
        const code = codeOf(error)
        if (code === "WORKSPACE_DELETED") session.store.setReadOnly(CLOUD_DELETED_REASON)
        if (code === "NOT_MEMBER") session.store.setReadOnly(CLOUD_REMOVED_REASON)
        if (endOf(code) !== "closed") return null
        // Closed while this file was not open: follow a re-share, else it is a local file now.
        await refreshWorkspace(b.workspaceId).catch(() => undefined)
        const next = replacedOf(b.room)
        await roomClosed(b.room, next)
        return next ? openFile(next, { session, file }).catch(() => null) : null
      }
    },
    async moved(from, to) {
      await hydrated
      const b = bindingForFile(state, from)
      if (b && from !== to) await saveBinding({ ...b, fileKey: to })
    },
  }
  share.setCloudFiles(hooks)
  share.service.setBoundFiles({
    roomForFile: async (fileKey) => {
      await hydrated
      const b = bindingForFile(state, fileKey)
      return b && b.ended === null ? b.room : null
    },
  })

  // --- Invites ------------------------------------------------------------------------------------

  const acceptInvite = async () => {
    const inv = state.invite
    if (!inv || (inv.phase !== "ready" && inv.phase !== "sign-in")) return
    const { token, peek } = inv
    set({ invite: { phase: "ready", token, peek, busy: true, error: null } })
    try {
      const answer = await call(() =>
        client.acceptInvite({ token, deviceName: deps.deviceName(), client: deps.clientKind }),
      )
      set({ invite: { phase: "joined", token, workspace: answer.workspace } })
      await cloud.refresh()
    } catch (error) {
      const code = codeOf(error)
      if (code === "NOT_SIGNED_IN") return set({ invite: { phase: "sign-in", token, peek } })
      if (code === "INVITE_EXPIRED" || code === "INVITE_USED")
        return set({ invite: { phase: "failed", token, error: code } })
      set({ invite: { phase: "ready", token, peek, busy: false, error: code } })
    }
  }

  // --- Transfers ------------------------------------------------------------------------------------

  let transferTimer: unknown = null
  const stopTransferPoll = () => {
    if (transferTimer !== null) clock.clearTimeout(transferTimer)
    transferTimer = null
  }
  const pollTransfer = () => {
    stopTransferPoll()
    transferTimer = clock.setTimeout(async () => {
      transferTimer = null
      const t = state.transfer
      if (t?.phase !== "waiting") return
      try {
        const status = await call(() => client.checkoutStatus(t.checkoutId))
        if (status.status === "failed" || status.status === "expired")
          return set({ transfer: { phase: "failed", workspaceId: t.workspaceId, error: null } })
        if (status.status === "succeeded" || status.status === "confirmed") await cloud.refresh()
      } catch {
        // Offline: keep polling until the checkout's expiry.
      }
      const now = state.transfer
      if (now?.phase !== "waiting" || now.checkoutId !== t.checkoutId) return
      if (clock.now() > now.expiresAt + TRANSFER_POLL_MS)
        return set({ transfer: { phase: "failed", workspaceId: now.workspaceId, error: null } })
      pollTransfer()
    }, TRANSFER_POLL_MS)
  }

  const transferOf = (workspaceId: string) => {
    const t = state.workspaces.find((w) => w.id === workspaceId)?.transfer
    if (!t) throw new CloudError("TRANSFER_CLOSED", "no pending transfer")
    return t
  }

  // --- Migration -----------------------------------------------------------------------------------

  let migrating: Promise<MigrationOutcome | null> | null = null
  /** One window of this origin migrates at a time (Web Locks where the browser has them). */
  const exclusively = <T>(fn: () => Promise<T>): Promise<T | null> => {
    const locks = (globalThis.navigator as { locks?: LockManager } | undefined)?.locks
    if (!locks) return fn()
    return locks.request("kimo-cloud-migrate", { ifAvailable: true }, (lock) =>
      lock ? fn() : null,
    ) as Promise<T | null>
  }
  const migrate = (): Promise<MigrationOutcome | null> => {
    migrating ??= exclusively(async () => {
      await hydrated
      const accountId = state.accountId
      const owned = state.workspaces
        .filter((w) => w.role === "owner" && w.deletedAt === null)
        .sort((a, b) => a.createdAt - b.createdAt)[0]
      if (!accountId || !owned) return null
      set({ migration: { ...state.migration, phase: "running", error: null } })
      try {
        const relay = await call(() => cloud.relay())
        const outcome = await migrateLegacyRooms({
          client,
          share,
          registry: deps.registry,
          cache,
          relayUrl: relay.relayUrl,
          workspaceId: owned.id,
          now: clock.now,
          bind: async (binding, token) => {
            await saveBinding({ ...binding, accountId })
            keepToken(binding.room, token)
          },
          reopen: (room, session) => openFile(room, { session }),
        })
        set({
          migration: {
            phase: outcome.left > 0 ? "failed" : "done",
            moved: outcome.moved,
            left: outcome.left,
            error: (outcome.error as CloudErrorCode | null) ?? null,
          },
        })
        if (outcome.moved > 0) void refreshWorkspace(owned.id).catch(() => undefined)
        return outcome
      } catch (error) {
        set({ migration: { ...state.migration, phase: "failed", error: codeOf(error) } })
        return null
      }
    }).finally(() => {
      migrating = null
    })
    return migrating
  }

  // --- Store ---------------------------------------------------------------------------------------

  const workspaceAction = async <T>(workspaceId: string, fn: () => Promise<T>): Promise<T> => {
    try {
      const value = await call(fn)
      void refreshWorkspace(workspaceId).catch(() => undefined)
      return value
    } catch (error) {
      await workspaceGone(error)
      throw error
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState: () => state,
    ready: () => hydrated,
    refresh,
    refreshWorkspace,

    async createWorkspace(name) {
      const workspace = await call(() => client.createWorkspace(name))
      await cloud.refresh()
      return workspace
    },
    async renameWorkspace(workspaceId, name) {
      await workspaceAction(workspaceId, () => client.renameWorkspace(workspaceId, name))
      await cloud.refresh()
    },
    async checkout(workspaceId, interval) {
      const created = await call(() => client.workspaceCheckout(workspaceId, interval))
      await deps.openUrl(created.url).catch(() => undefined)
      return created
    },
    async openPortal(workspaceId) {
      const portal = await call(() => client.workspacePortal(workspaceId))
      await deps.openUrl(portal.url)
    },

    async invite(workspaceId, email, role) {
      await workspaceAction(workspaceId, () => client.invite(workspaceId, email, role))
    },
    async cancelInvite(workspaceId, inviteId) {
      await workspaceAction(workspaceId, () => client.cancelInvite(workspaceId, inviteId))
    },
    setRole: (workspaceId, account, role) =>
      workspaceAction(workspaceId, () => client.setMemberRole(workspaceId, account, role)),
    async removeMember(workspaceId, account) {
      const ended = await workspaceAction(workspaceId, () =>
        client.removeMember(workspaceId, account),
      )
      await cloud.refresh()
      return ended
    },
    async leave(workspaceId) {
      const ended = await call(() => client.leaveWorkspace(workspaceId))
      for (const b of Object.values(state.bindings))
        if (b.workspaceId === workspaceId && b.ended === null) await endBinding(b.room, "removed")
      await cloud.refresh()
      return ended
    },
    async approveRequest(workspaceId, requestId) {
      await workspaceAction(workspaceId, () => client.approveRequest(workspaceId, requestId))
      // A new seat: follow its billing again even if an earlier follow gave up.
      seatTries = 0
      await cloud.refresh()
    },
    async declineRequest(workspaceId, requestId) {
      await workspaceAction(workspaceId, () => client.declineRequest(workspaceId, requestId))
    },

    async requestAccess(room) {
      const request = await call(() => client.requestAccess(room))
      set({
        accessRequests: [request, ...state.accessRequests.filter((r) => r.id !== request.id)],
      })
      return request
    },
    async checkAccessRequests() {
      let approved = false
      for (const r of state.accessRequests.filter((x) => x.status === "pending")) {
        const next = await call(() => client.accessRequest(r.id)).catch(() => null)
        if (!next) continue
        if (next.status === "approved") approved = true
        set({ accessRequests: state.accessRequests.map((x) => (x.id === next.id ? next : x)) })
      }
      if (approved) await cloud.refresh()
    },

    async openInviteLink(token) {
      set({ invite: { phase: "checking", token } })
      try {
        const peek = await call(() => client.peekInvite(token))
        if (state.invite?.phase === "checking" && state.invite.token === token)
          set({ invite: { phase: "ready", token, peek, busy: false, error: null } })
      } catch (error) {
        if (state.invite?.token === token)
          set({ invite: { phase: "failed", token, error: codeOf(error) } })
      }
    },
    acceptInvite,
    dismissInvite: () => set({ invite: null }),

    async requestTransfer(workspaceId, toAccount) {
      await workspaceAction(workspaceId, () => client.requestTransfer(workspaceId, toAccount))
      await cloud.refresh()
    },
    async cancelTransfer(workspaceId) {
      const t = transferOf(workspaceId)
      await workspaceAction(workspaceId, () => client.cancelTransfer(workspaceId, t.id)).catch(
        (error: unknown) => {
          if (codeOf(error) !== "TRANSFER_CLOSED") throw error
        },
      )
      await cloud.refresh()
    },
    async acceptTransfer(workspaceId) {
      const t = transferOf(workspaceId)
      try {
        const created = await call(() => client.acceptTransfer(workspaceId, t.id))
        set({
          transfer: {
            phase: "waiting",
            workspaceId,
            transferId: t.id,
            checkoutId: created.checkoutId,
            url: created.url,
            expiresAt: created.expiresAt,
          },
        })
        pollTransfer()
        await deps.openUrl(created.url).catch(() => undefined)
      } catch (error) {
        set({ transfer: { phase: "failed", workspaceId, error: codeOf(error) } })
        if (codeOf(error) === "TRANSFER_CLOSED") await cloud.refresh()
        throw error
      }
    },
    async declineTransfer(workspaceId) {
      const t = transferOf(workspaceId)
      await call(() => client.declineTransfer(workspaceId, t.id)).catch((error: unknown) => {
        if (codeOf(error) !== "TRANSFER_CLOSED") throw error
      })
      await cloud.refresh()
    },
    async openTransferLink() {
      await hydrated
      await cloud.refresh()
    },
    dismissTransfer() {
      stopTransferPoll()
      set({ transfer: null })
    },
    async deleteWorkspace(workspaceId, typedName) {
      await call(() => client.deleteWorkspace(workspaceId, typedName)).catch((error: unknown) => {
        if (codeOf(error) !== "WORKSPACE_DELETED") throw error
      })
      for (const b of Object.values(state.bindings))
        if (b.workspaceId === workspaceId && b.ended === null) await endBinding(b.room, "deleted")
      await cloud.refresh()
    },

    async shareFile(session, options = {}) {
      await hydrated
      // A file this device shares through a relay of its own (or on Kimo Cloud from before
      // workspaces, which the re-share moves) reopens in that room: it cannot join a workspace too.
      if (await share.service.roomForFile(session.ref))
        throw new CloudError("BAD_REQUEST", "this file is already shared through another room")
      const existing = bindingForFile(state, session.ref)
      if (existing && existing.ended === null) {
        const { workspaceId, file } = await fileFor(existing.room)
        const live = share.session(existing.room) ?? (await openFile(existing.room, { session }))
        return { status: "shared", file, workspaceId, session: live }
      }
      let workspaceId = options.workspaceId
      if (!workspaceId) {
        const can = shareableWorkspaces(state)
        if (can.length > 1) return { status: "choose", workspaces: can }
        const only = can[0]
        if (!only) throw new CloudError("PLAN_REQUIRED", "no workspace can take a new file")
        workspaceId = only.id
      }
      const id = workspaceId
      const added = await workspaceAction(id, () =>
        client.addFile(id, { name: options.name ?? fileNameOf(session), origin: "user" }),
      )
      const { file, token } = added
      await share.service.seedRoom(share.targetOf(session), {
        room: file.room,
        relayUrl: file.relayUrl,
        roomKey: fromBase64Url(file.roomKey),
        token: token.token,
      })
      keepToken(file.room, token)
      const list = state.files[id] ?? { files: [], closed: [] }
      set({
        files: {
          ...state.files,
          [id]: { ...list, files: [...list.files.filter((f) => f.room !== file.room), file] },
        },
      })
      const live = await openFile(file.room, { session })
      return { status: "shared", file, workspaceId: id, session: live }
    },
    openFile,
    async localCopy(room) {
      const { workspaceId, file } = await fileFor(room)
      const bound = state.bindings[room]
      if (bound?.fileKey) return bound.fileKey
      const managed = deps.managedCopies
      if (!managed) return null
      const name = state.workspaces.find((w) => w.id === workspaceId)?.name ?? "Workspace"
      const fileKey = await managed.create({
        workspaceId,
        workspaceName: name,
        room,
        name: file.name,
      })
      await saveBinding({
        room,
        workspaceId,
        fileKey,
        relayUrl: file.relayUrl,
        roomKey: file.roomKey,
        name: file.name,
        boundAt: clock.now(),
        ended: null,
        ...(state.accountId ? { accountId: state.accountId } : {}),
      })
      return fileKey
    },
    async renameFile(room, name) {
      const { workspaceId } = await fileFor(room)
      await workspaceAction(workspaceId, () => client.renameFile(room, name))
    },
    async closeFile(room) {
      const { workspaceId } = await fileFor(room)
      await workspaceAction(workspaceId, () => client.closeFile(room))
      await endBinding(room, "closed")
    },

    async createViewLink(room, input) {
      const { file } = await fileFor(room)
      const { link, token } = await call(() => client.createLink(room, input))
      const url = formatJoinLink({
        webOrigin: deps.webOrigin ?? file.relayUrl,
        relayUrl: file.relayUrl,
        room,
        token: token.token,
        roomKey: fromBase64Url(file.roomKey),
      })
      return { link, url }
    },
    listLinks: (workspaceId) => call(() => client.links(workspaceId)),
    revokeLink: (room, jti) => call(() => client.revokeLink(room, jti)),

    migrate,
    dispose() {
      disposed = true
      offCloud()
      stopTransferPoll()
      stopSeatFollow()
      for (const o of [...opened.values()]) {
        if (o.timer !== null) clock.clearTimeout(o.timer)
        for (const off of o.offs.splice(0)) off()
      }
      opened.clear()
      share.setCloudFiles(null)
      share.service.setBoundFiles(null)
      listeners.clear()
    },
  }
}
