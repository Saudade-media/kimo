/**
 * The multiplayer view model (board 41): everything the Share popover, the topbar sync status and
 * avatar stack, the people list, presence on the canvas, agent claims, asset sync, view-only mode,
 * the join card and Settings › Multiplayer read, as stable snapshots with `subscribe`
 * (`useSyncExternalStore`-friendly; React hooks in `./hooks`). It holds no UI and no CSS.
 *
 * The model runs over a {@link ShareBackend}: the share layer in this window (web), or the desktop
 * document host's `mp.*` RPC. Timing rules of board 41 live here:
 *
 * - "Syncing…" only after local edits wait {@link SYNCING_DELAY_MS} for the relay.
 * - "Reconnecting…" while the relay is gone, "Offline · edits kept" after {@link OFFLINE_AFTER_MS}.
 * - A person with no input for {@link IDLE_AFTER_MS} is idle.
 * - The join card shows only when joining takes longer than {@link JOIN_CARD_DELAY_MS}.
 * - Testing a relay gives up after {@link RELAY_TEST_TIMEOUT_MS}.
 */
import type { ClaimView } from "@kimo/editor-state"
import type { KimoPlatform, SettingsApi } from "@kimo/platform"
import type { PresenceState } from "@kimo/sync"
import {
  MultiplayerError,
  normalizeRelayUrl,
  parseJoinLink,
  parseToken,
  RelayHttpClient,
  type RelayInfo,
  type Role,
} from "@kimo/sync/mp"
import type { LocalPresence } from "../platform/share"
import { assertRelayReachable } from "../platform/share"
import type { AgentPauseView } from "./agent-pause"
import {
  type AssetTransfers,
  roomKeyOf,
  roomOfKey,
  type ShareBackend,
  type ShareErrorSnapshot,
  type ShareSnapshot,
  type StartOptions,
} from "./backend"
import type { RelayOwnerState } from "./ownership"
import {
  isPresenceColor,
  JoinOrder,
  type PresenceColor,
  personLabel,
  presenceColorAt,
} from "./presence"
import type { IssuedLink } from "./registry"
import type { SharedSession } from "./share"

export const SYNCING_DELAY_MS = 600
export const OFFLINE_AFTER_MS = 30_000
const IDLE_AFTER_MS = 60_000
const JOIN_CARD_DELAY_MS = 400
export const RELAY_TEST_TIMEOUT_MS = 5_000

// --- Types ---------------------------------------------------------------------------------------

/** Whether the document is shared. */
export type ShareStatus = "not-shared" | "starting" | "live" | "error"

/** The topbar sync status of a shared document (replaces "Saved locally"). */
export type RelayStatus =
  /** The relay has every update. */
  | "synced"
  /** Local edits wait for the relay longer than {@link SYNCING_DELAY_MS} (or the first catch-up). */
  | "syncing"
  /** No pending edits, assets uploading ("Sharing 2 images"). */
  | "saving"
  /** The relay dropped; retrying. */
  | "reconnecting"
  /** Down for more than {@link OFFLINE_AFTER_MS}; edits are kept. */
  | "offline"
  /** A view link: caught up, read-only. */
  | "view-only"

export interface ShareState {
  status: ShareStatus
  room: string | null
  relayUrl: string | null
  /** The relay's host name, for copy ("relay.maya.studio"). */
  relayHost: string | null
  /** True when this device shared the file. */
  owner: boolean
  role: Role | null
  /** Null while not shared. */
  relay: RelayStatus | null
  /** Assets this client is uploading. */
  uploading: number
  error: ShareErrorSnapshot | null
  /** Other people in the file now (you excluded). */
  othersOnline: number
}

/** The expiry choices of a new link (board 41 section 3). */
export type ExpiryChoice = "1d" | "7d" | "30d" | "never"
export const EXPIRY_CHOICES: readonly ExpiryChoice[] = ["1d", "7d", "30d", "never"]
export const DEFAULT_EXPIRY: ExpiryChoice = "7d"
const EXPIRY_SECONDS: Record<ExpiryChoice, number | null> = {
  "1d": 86_400,
  "7d": 7 * 86_400,
  "30d": 30 * 86_400,
  never: null,
}
export const expirySeconds = (choice: ExpiryChoice) => EXPIRY_SECONDS[choice]

export interface LinkView {
  jti: string
  role: Role
  label?: string
  /** The full link (key after `#`). */
  link: string
  /** Ms; null never expires. */
  expiresAt: number | null
  createdAt: number
  expired: boolean
  revoked: boolean
  /**
   * When the link was last used (ms). Null: never used, or unknown (the relay does not report
   * which link a connection used yet).
   */
  lastUsedAt: number | null
}

export interface LinksState {
  /** Active links (not revoked, not expired), newest first. */
  items: readonly LinkView[]
  loading: boolean
  error: ShareErrorSnapshot | null
}

export interface AgentView {
  /** `agent:<id>` or `mcp:<client>`. */
  holder: string
  /** Persona or client name ("Kimo", "Sol", "Claude Code"). */
  label: string
  /** The person running it; null for an agent connected with its own link. */
  ownerPeer: number | null
  ownerLabel: string | null
  /** Runs on this client. */
  isYours: boolean
  /** Node ids it claims (its area). */
  editing: readonly string[]
  /** Paused because a person edited inside its claim (local agents only). */
  paused: AgentPauseView | null
  /** Its caret in a text layer (an agent connected with its own link), encoded positions. */
  text: PresenceState["text"] | null
}

export interface PersonView {
  /** Presence user id (stable per device). */
  id: string
  peer: number
  /** Display name, or "Guest N". */
  label: string
  /** The display name; null shows as Guest N. */
  name: string | null
  /** The Guest number when unnamed. */
  guest: number | null
  role: Role | null
  /** Owns the file (listed first). */
  owner: boolean
  /** One of the six presence color tokens (`--kimo-presence-*`). */
  color: PresenceColor
  idle: boolean
  isYou: boolean
  cursor: PresenceState["cursor"] | null
  selection: readonly string[]
  page: string | null
  viewport: PresenceState["viewport"] | null
  /**
   * Their caret and selection in the text layer they are editing (encoded positions; resolve
   * them with `remoteTextCarets` in `text-carets.ts`).
   */
  text: PresenceState["text"] | null
  /** Agents this person runs, under them in the people list. */
  agents: readonly AgentView[]
}

export interface FollowState {
  peer: number
  label: string
  color: PresenceColor
  page: string | null
  viewport: PresenceState["viewport"] | null
  cursor: PresenceState["cursor"] | null
}

export interface Capabilities {
  canEdit: boolean
  /** Viewers keep Export (code and images of what they can see). */
  canExport: boolean
  /** Duplicate and Save a copy: not for viewers. */
  canDuplicate: boolean
  /** Share button and links: the owner, or any file not shared yet (not guests). */
  canShare: boolean
  /** A view link: banner, Select tool only, properties dimmed. */
  viewOnly: boolean
}

/** Who Reset all links disconnects now (the confirm dialog's copy). */
export interface ResetImpact {
  /** People by label, up to three. */
  people: readonly string[]
  /** People past the first three. */
  more: number
  /** Agents connected through links. */
  agents: number
}

export interface DocumentShareView {
  share: ShareState
  links: LinksState
  /** Owner first, then join order; you included (`isYou`). The avatar stack leaves you out. */
  people: readonly PersonView[]
  /** Every agent: local, other people's, and agents with their own link. */
  agents: readonly AgentView[]
  follow: FollowState | null
  assets: AssetTransfers
  fontsNameOnly: readonly string[]
  capabilities: Capabilities
  /** Agent area claims (outlines and tabs). */
  claims: readonly ClaimView[]
  paused: readonly AgentPauseView[]
  /** The expiry the next link gets (remembered per file). */
  expiry: ExpiryChoice
}

export interface DocumentShareModel {
  readonly key: string
  subscribe(listener: () => void): () => void
  /** Stable until something changes; each member keeps its identity while it is unchanged. */
  getState(): DocumentShareView
  startSharing(options?: StartOptions): Promise<void>
  stopSharing(): Promise<{ relayNotified: boolean }>
  refreshLinks(): Promise<void>
  /** Creates a link (expiry default: the remembered choice) and remembers the choice. */
  createLink(role: Role, expiry?: ExpiryChoice, label?: string): Promise<LinkView>
  setExpiry(choice: ExpiryChoice): void
  revokeLink(jti: string): Promise<void>
  /** Who Reset all links would disconnect now. */
  resetImpact(): ResetImpact
  /** Rotates the link key: every link dies. Returns who was disconnected. */
  resetAllLinks(): Promise<{ kid: number; disconnected: ResetImpact }>
  /** Follows a person (their viewport); null stops (pan, zoom, Esc). */
  follow(peer: number | null): void
  /** Publishes your pointer, selection, page and viewport. */
  setLocalPresence(fields: LocalPresence): void
  ensureAsset(asset: string): Promise<boolean>
  resumeAgent(holder: string): void
  stopAgent(holder: string): void
}

export interface MultiplayerSettingsView {
  /** Empty: you show as Guest N. */
  displayName: string
  relayUrl: string | null
  showCursors: boolean
  fetchAssets: boolean
}

export interface MultiplayerSettingsModel {
  subscribe(listener: () => void): () => void
  getState(): MultiplayerSettingsView
  setDisplayName(name: string): Promise<void>
  /** Normalizes and saves; null or empty clears. Throws `BAD_RELAY_URL` for an unusable URL. */
  setRelayUrl(url: string | null): Promise<string | null>
  setShowCursors(show: boolean): Promise<void>
  setFetchAssets(fetch: boolean): Promise<void>
}

export type RelayTestState =
  | { kind: "idle" }
  | { kind: "testing"; url: string }
  | {
      kind: "ok"
      url: string
      name: string
      version: string
      protocol: string
      ms: number
      /**
       * Whose relay it is (§16.9): `unclaimed`, `yours`, `other` or `external` (an owner policy
       * decides, §14.12); null when the model has no
       * ownership check or it failed (Start sharing finds out then).
       */
      owner: RelayOwnerState | null
    }
  | { kind: "not-a-relay"; url: string; message: string }
  | { kind: "unreachable"; url: string; message: string }
  /** The relay speaks an older protocol (`protocol` when it said which). */
  | { kind: "too-old"; url: string; protocol: string | null; message: string }
  | { kind: "invalid"; url: string; message: string }

export interface RelayTestModel {
  subscribe(listener: () => void): () => void
  getState(): RelayTestState
  /** Runs the handshake (5 s at most). Start sharing needs `ok`. */
  test(url: string): Promise<RelayTestState>
  /**
   * Tests `url` again when the last result is about it (its ownership may have changed: the
   * wizard or Start sharing claimed it); otherwise does nothing.
   */
  recheck(url: string): Promise<void>
  reset(): void
}

export type JoinErrorKind =
  | "bad-link"
  | "expired"
  | "revoked"
  | "unreachable"
  | "not-a-relay"
  | "relay-too-old"
  | "decrypt-failed"
  | "failed"

export type JoinPhase = "idle" | "parsing" | "connecting" | "decrypting" | "joined" | "error"

export interface JoinState {
  phase: JoinPhase
  /** The three steps of the card, ticking in place. */
  steps: { reachedRelay: boolean; linkValid: boolean; decrypted: boolean }
  /** False until joining took {@link JOIN_CARD_DELAY_MS}: a quick join opens the editor directly. */
  showCard: boolean
  relayHost: string | null
  role: Role | null
  /** Link expiry (ms); null never. */
  expiresAt: number | null
  /** Decrypting progress 0..1; null while unknown (indeterminate). */
  progress: number | null
  /** Once joined: the room and its document key ({@link roomKeyOf}). */
  room: string | null
  key: string | null
  /** Once joined: the room session (store, assets) the joined editor opens on. */
  session: SharedSession | null
  error: { kind: JoinErrorKind; code: string; message: string } | null
}

export interface JoinModel {
  subscribe(listener: () => void): () => void
  getState(): JoinState
  /** Joins from a link; resolves with the final state (`joined` or `error`). */
  join(link: string): Promise<JoinState>
  reset(): void
}

export interface ModelTimers {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** Where per-file choices (the last link expiry) are kept. */
export interface ModelStorage {
  get(key: string): string | null
  set(key: string, value: string): void
}

export interface MultiplayerModelDeps {
  backend: ShareBackend
  settings?: SettingsApi
  /** For the desktop CSP check of relay URLs. */
  platformKind?: KimoPlatform["kind"]
  /** Relay handshake. Default `RelayHttpClient.probe`. */
  probe?(relayUrl: string): Promise<RelayInfo>
  /** Whose a claimed relay is, with this device's key (§16.9). Without it the test says null. */
  ownership?(relayUrl: string): Promise<RelayOwnerState>
  /** Joins a room from a link (the window's share layer). */
  join?(link: string): Promise<SharedSession>
  timers?: ModelTimers
  storage?: ModelStorage
}

export interface MultiplayerModel {
  /** The model of one document (a file ref, or {@link roomKeyOf} for a joined room). */
  document(key: string): DocumentShareModel
  readonly settings: MultiplayerSettingsModel
  readonly relayTest: RelayTestModel
  readonly join: JoinModel
  dispose(): void
}

// --- Helpers -------------------------------------------------------------------------------------

export const realModelTimers: ModelTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const h = setTimeout(fn, ms)
    ;(h as { unref?: () => void }).unref?.()
    return h
  },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

const localStorageModel: ModelStorage = {
  get(key) {
    try {
      return (globalThis as { localStorage?: Storage }).localStorage?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      ;(globalThis as { localStorage?: Storage }).localStorage?.setItem(key, value)
    } catch {
      // Private mode or blocked storage: the choice lasts for this window only.
    }
  },
}

const hostOf = (url: string | null): string | null => {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const errorView = (error: unknown): ShareErrorSnapshot => ({
  code: error instanceof MultiplayerError ? error.code : "INTERNAL",
  message: error instanceof Error ? error.message : String(error),
  fatal: true,
})

/** Keeps `prev` when `next` has the same content, so selectors return stable references. */
function keep<T>(prev: T | undefined, next: T): T {
  if (prev === undefined) return next
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next
}

/** The confirm copy of Reset all links (board 41 section 3 D). */
export function resetConfirmCopy(impact: ResetImpact): string {
  const people = impact.people.length + impact.more
  const parts: string[] = []
  if (people > 0) {
    const names =
      impact.more > 0
        ? `${impact.people.join(", ")} and ${impact.more} more`
        : impact.people.join(", ")
    parts.push(`${people} ${people === 1 ? "person" : "people"} now (${names})`)
  }
  if (impact.agents > 0) parts.push(`${impact.agents} ${impact.agents === 1 ? "agent" : "agents"}`)
  if (parts.length === 0) return "Nobody is connected through these links now."
  return `Disconnects ${parts.join(" and ")} using these links.`
}

/** The relay status of a snapshot at `now` (board 41 section 2). */
export function relayStatusOf(
  snap: ShareSnapshot,
  t: { now: number; savingSince: number | null; everConnected: boolean },
): RelayStatus | null {
  if (!snap.room) return null
  const status = snap.status
  const uploads = snap.assets.uploading.length > 0
  if (status === "read-only") return "view-only"
  if (status === "synced") return uploads ? "saving" : "synced"
  if (status === "saving") {
    if (t.savingSince !== null && t.now - t.savingSince >= SYNCING_DELAY_MS) return "syncing"
    return uploads ? "saving" : "synced"
  }
  if (snap.downSince !== null && t.now - snap.downSince >= OFFLINE_AFTER_MS) return "offline"
  return t.everConnected ? "reconnecting" : "syncing"
}

const isAgentOrigin = (origin: string) => origin.startsWith("agent:") || origin.startsWith("mcp:")

// --- Document model ------------------------------------------------------------------------------

interface DocInternals {
  model: DocumentShareModel
  dispose(): void
}

function createDocumentModel(
  key: string,
  deps: Required<Pick<MultiplayerModelDeps, "backend">> & {
    timers: ModelTimers
    storage: ModelStorage
    /** After Start sharing went through (it may have claimed the relay). */
    started?(relayUrl: string | undefined): void
  },
): DocInternals {
  const { backend, timers, storage } = deps
  const listeners = new Set<() => void>()
  const order = new JoinOrder()
  let view: DocumentShareView | undefined
  let dirty = true
  let timer: unknown = null
  let savingSince: number | null = null
  let everConnected = false
  let lastStatus: string | null = null
  let lastRoom: string | null = null
  let following: number | null = null
  let links: LinksState = { items: [], loading: false, error: null }
  let rawLinks: IssuedLink[] = []
  const expiryKey = `kimo.multiplayer.expiry:${key}`
  let expiry: ExpiryChoice = (() => {
    const saved = storage.get(expiryKey)
    return (EXPIRY_CHOICES as readonly string[]).includes(saved ?? "")
      ? (saved as ExpiryChoice)
      : DEFAULT_EXPIRY
  })()

  const emit = () => {
    dirty = true
    for (const l of [...listeners]) l()
  }
  let offBackend: (() => void) | null = null
  const ensureSubscribed = () => {
    offBackend ??= backend.subscribe(key, emit)
  }

  const linkViews = (now: number): LinkView[] =>
    rawLinks
      .map((l) => ({
        jti: l.jti,
        role: l.role,
        ...(l.label !== undefined ? { label: l.label } : {}),
        link: l.link,
        expiresAt: l.exp === 0 ? null : l.exp * 1000,
        createdAt: l.iat * 1000,
        expired: l.exp !== 0 && l.exp * 1000 <= now,
        revoked: l.revoked,
        lastUsedAt: null,
      }))
      .filter((l) => !l.revoked && !l.expired)
      .sort((a, b) => b.createdAt - a.createdAt)

  const compute = (): DocumentShareView => {
    const snap = backend.snapshot(key)
    const now = timers.now()
    // Status bookkeeping for the timing rules.
    if (snap.room !== lastRoom) {
      lastRoom = snap.room
      everConnected = false
      savingSince = null
      if (snap.room === null) {
        following = null
        rawLinks = []
      }
    }
    if (snap.status === "synced" || snap.status === "saving" || snap.status === "read-only")
      everConnected = true
    if (snap.status === "saving" && lastStatus !== "saving") savingSince = now
    if (snap.status !== "saving") savingSince = null
    lastStatus = snap.status

    // People: you and everyone with a user origin, in join order (owner first).
    const humans: {
      id: string
      peer: number
      state: PresenceState
      isYou: boolean
      role: Role | null
      changedAt: number
    }[] = []
    if (snap.room && snap.selfState && snap.self !== null)
      humans.push({
        id: snap.selfState.user.id,
        peer: snap.self,
        state: snap.selfState,
        isYou: true,
        role: snap.role,
        changedAt: now,
      })
    for (const p of snap.peers)
      if (p.state && !isAgentOrigin(p.origin))
        humans.push({
          id: p.state.user.id,
          peer: p.peer,
          state: p.state,
          isYou: false,
          role: p.role,
          changedAt: p.changedAt,
        })
    order.see(
      humans.map((h) => ({ id: h.id, peer: h.peer, named: h.state.user.name.trim() !== "" })),
    )

    const pausedBy = new Map(snap.paused.map((p) => [p.holder, p]))
    const agentsOf = (
      records: readonly { holder: string; ids: readonly string[]; label?: string }[],
      owner: { peer: number | null; label: string | null; isYours: boolean },
    ): AgentView[] => {
      const byHolder = new Map<string, AgentView>()
      for (const r of records) {
        const prior = byHolder.get(r.holder)
        byHolder.set(r.holder, {
          holder: r.holder,
          label: r.label ?? prior?.label ?? "Agent",
          ownerPeer: owner.peer,
          ownerLabel: owner.label,
          isYours: owner.isYours,
          editing: [...new Set([...(prior?.editing ?? []), ...r.ids])],
          paused: owner.isYours ? (pausedBy.get(r.holder) ?? null) : null,
          text: null,
        })
      }
      return [...byHolder.values()]
    }

    const people: PersonView[] = humans.map((h) => {
      const name = h.state.user.name.trim()
      const guest = name === "" ? order.guest(h.id) || 1 : null
      const label = personLabel(name, guest ?? 0)
      const color = isPresenceColor(h.state.user.color)
        ? h.state.user.color
        : presenceColorAt(Math.max(0, order.index(h.id)))
      const agents = h.isYou
        ? agentsOf(
            snap.claims.filter((c) => c.local),
            { peer: h.peer, label, isYours: true },
          )
        : agentsOf(h.state.claims ?? [], { peer: h.peer, label, isYours: false })
      return {
        id: h.id,
        peer: h.peer,
        label,
        name: name === "" ? null : name,
        guest,
        role: h.role,
        owner: h.state.owner === true,
        color,
        idle: !h.isYou && now - h.changedAt >= IDLE_AFTER_MS,
        isYou: h.isYou,
        cursor: h.state.cursor ?? null,
        selection: h.state.selection ?? [],
        page: h.state.page ?? null,
        viewport: h.state.viewport ?? null,
        text: h.state.text ?? null,
        agents,
      }
    })
    people.sort(
      (a, b) => Number(b.owner) - Number(a.owner) || order.index(a.id) - order.index(b.id),
    )

    // Agents: yours (also when not shared), other people's, and agents with their own link.
    const agents: AgentView[] = []
    const you = people.find((p) => p.isYou)
    if (you) agents.push(...you.agents)
    else
      agents.push(
        ...agentsOf(
          snap.claims.filter((c) => c.local),
          { peer: null, label: null, isYours: true },
        ),
      )
    for (const p of people) if (!p.isYou) agents.push(...p.agents)
    for (const p of snap.peers)
      if (isAgentOrigin(p.origin))
        agents.push({
          holder: p.origin,
          label: p.state?.user.name || p.origin.replace(/^(agent|mcp):/, ""),
          ownerPeer: null,
          ownerLabel: null,
          isYours: false,
          editing: p.state?.working ?? [],
          paused: null,
          text: p.state?.text ?? null,
        })

    if (following !== null && !people.some((p) => p.peer === following && !p.isYou))
      following = null
    const followed = people.find((p) => p.peer === following)
    const follow: FollowState | null = followed
      ? {
          peer: followed.peer,
          label: followed.label,
          color: followed.color,
          page: followed.page,
          viewport: followed.viewport,
          cursor: followed.cursor,
        }
      : null

    const shared = snap.room !== null
    const viewOnly = shared && snap.role === "view"
    const capabilities: Capabilities = {
      canEdit: !viewOnly,
      canExport: true,
      canDuplicate: !viewOnly,
      canShare: shared ? snap.owner : roomOfKey(key) === null,
      viewOnly,
    }
    const status: ShareStatus = snap.starting
      ? "starting"
      : shared
        ? snap.error?.fatal
          ? "error"
          : "live"
        : snap.error
          ? "error"
          : "not-shared"
    const share: ShareState = {
      status,
      room: snap.room,
      relayUrl: snap.relayUrl,
      relayHost: hostOf(snap.relayUrl),
      owner: snap.owner,
      role: snap.role,
      relay: relayStatusOf(snap, { now, savingSince, everConnected }),
      uploading: snap.assets.uploading.length,
      error: snap.error,
      othersOnline: people.filter((p) => !p.isYou).length,
    }
    const prev = view
    const next: DocumentShareView = {
      share: keep(prev?.share, share),
      links: keep(prev?.links, { ...links, items: linkViews(now) }),
      people: keep(prev?.people, people),
      agents: keep(prev?.agents, agents),
      follow: keep(prev?.follow ?? undefined, follow),
      assets: keep(prev?.assets, snap.assets),
      fontsNameOnly: keep(prev?.fontsNameOnly, snap.fontsNameOnly),
      capabilities: keep(prev?.capabilities, capabilities),
      claims: snap.claims,
      paused: snap.paused,
      expiry,
    }
    const same =
      prev !== undefined &&
      (Object.keys(next) as (keyof DocumentShareView)[]).every((k) => prev[k] === next[k])
    schedule(snap, people, now)
    return same ? (prev as DocumentShareView) : next
  }

  /** One timer at the next time-based transition (syncing, offline, idle, link expiry). */
  const schedule = (snap: ShareSnapshot, people: PersonView[], now: number) => {
    if (timer !== null) timers.clearTimeout(timer)
    timer = null
    if (listeners.size === 0) return
    const at: number[] = []
    if (savingSince !== null) at.push(savingSince + SYNCING_DELAY_MS)
    if (snap.room && snap.downSince !== null) at.push(snap.downSince + OFFLINE_AFTER_MS)
    for (const p of snap.peers)
      if (people.some((h) => h.peer === p.peer && !h.idle)) at.push(p.changedAt + IDLE_AFTER_MS)
    for (const l of rawLinks) if (l.exp !== 0 && !l.revoked) at.push(l.exp * 1000)
    const next = Math.min(...at.filter((t) => t > now))
    if (!Number.isFinite(next)) return
    timer = timers.setTimeout(() => {
      timer = null
      emit()
    }, next - now)
  }

  const refreshLinks = async () => {
    if (!backend.snapshot(key).owner) {
      rawLinks = []
      links = { items: [], loading: false, error: null }
      emit()
      return
    }
    links = { ...links, loading: true }
    emit()
    try {
      rawLinks = await backend.links(key)
      links = { items: [], loading: false, error: null }
    } catch (error) {
      links = { ...links, loading: false, error: errorView(error) }
    }
    emit()
  }

  const impact = (): ResetImpact => {
    const state = model.getState()
    const others = state.people.filter((p) => !p.isYou)
    return {
      people: others.slice(0, 3).map((p) => p.label),
      more: Math.max(0, others.length - 3),
      agents: state.agents.filter((a) => a.ownerPeer === null && !a.isYours).length,
    }
  }

  const model: DocumentShareModel = {
    key,
    subscribe(listener) {
      ensureSubscribed()
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          offBackend?.()
          offBackend = null
          if (timer !== null) timers.clearTimeout(timer)
          timer = null
          dirty = true
        }
      }
    },
    getState() {
      // Without subscribers nothing marks the view stale: read through.
      if (dirty || !view || listeners.size === 0) {
        view = compute()
        dirty = false
      }
      return view
    },
    async startSharing(options) {
      await backend.start(key, options)
      deps.started?.(options?.relayUrl)
      await refreshLinks()
    },
    async stopSharing() {
      const result = await backend.stop(key)
      rawLinks = []
      following = null
      emit()
      return result
    },
    refreshLinks,
    async createLink(role, choice, label) {
      const pick = choice ?? expiry
      model.setExpiry(pick)
      const link = await backend.mintLink(key, {
        role,
        ttlSeconds: expirySeconds(pick),
        ...(label !== undefined ? { label } : {}),
      })
      rawLinks = [...rawLinks.filter((l) => l.jti !== link.jti), link]
      emit()
      void refreshLinks()
      return linkViews(timers.now()).find((l) => l.jti === link.jti) as LinkView
    },
    setExpiry(choice) {
      if (choice === expiry) return
      expiry = choice
      storage.set(expiryKey, choice)
      emit()
    },
    async revokeLink(jti) {
      await backend.revokeLink(key, jti)
      rawLinks = rawLinks.map((l) => (l.jti === jti ? { ...l, revoked: true } : l))
      emit()
    },
    resetImpact: impact,
    async resetAllLinks() {
      const disconnected = impact()
      const { kid } = await backend.resetAllLinks(key)
      rawLinks = rawLinks.map((l) => ({ ...l, revoked: true }))
      emit()
      void refreshLinks()
      return { kid, disconnected }
    },
    follow(peer) {
      if (peer === following) return
      following = peer
      emit()
    },
    setLocalPresence(fields) {
      backend.setPresence(key, fields)
    },
    ensureAsset: (asset) => backend.ensureAsset(key, asset),
    resumeAgent: (holder) => backend.resumeAgent(key, holder),
    stopAgent: (holder) => backend.stopAgent(key, holder),
  }

  return {
    model,
    dispose() {
      offBackend?.()
      offBackend = null
      if (timer !== null) timers.clearTimeout(timer)
      timer = null
      listeners.clear()
    },
  }
}

// --- Settings ------------------------------------------------------------------------------------

function createSettingsModel(
  settings: SettingsApi | undefined,
  platformKind: KimoPlatform["kind"] | undefined,
): MultiplayerSettingsModel & { dispose(): void } {
  const listeners = new Set<() => void>()
  let state: MultiplayerSettingsView | null = null
  const read = (): MultiplayerSettingsView => ({
    displayName: (settings?.get("multiplayer.displayName") as string | undefined) ?? "",
    relayUrl: (settings?.get("multiplayer.relayUrl") as string | null | undefined) ?? null,
    showCursors: settings?.get("multiplayer.showCursors") !== false,
    fetchAssets: settings?.get("multiplayer.fetchAssets") !== false,
  })
  const off = settings?.onChange((key) => {
    if (!String(key).startsWith("multiplayer.")) return
    state = null
    for (const l of [...listeners]) l()
  })
  const need = () => {
    if (!settings) throw new MultiplayerError("INTERNAL", "settings are not available here")
    return settings
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState() {
      const next = read()
      state = keep(state ?? undefined, next)
      return state
    },
    async setDisplayName(name) {
      await need().set("multiplayer.displayName", name.trim().slice(0, 80))
    },
    async setRelayUrl(url) {
      const next = url === null || url.trim() === "" ? null : normalizeRelayUrl(url)
      if (next !== null && platformKind) assertRelayReachable({ kind: platformKind }, next)
      await need().set("multiplayer.relayUrl", next)
      return next
    },
    async setShowCursors(show) {
      await need().set("multiplayer.showCursors", show)
    },
    async setFetchAssets(fetch) {
      await need().set("multiplayer.fetchAssets", fetch)
    },
    dispose() {
      off?.()
      listeners.clear()
    },
  }
}

// --- Relay test ----------------------------------------------------------------------------------

/** The protocol named in a `NOT_A_RELAY` probe failure, when the relay said one. */
function probeProtocol(error: unknown): string | null {
  if (!(error instanceof MultiplayerError)) return null
  if (error.code === "PROTOCOL_MISMATCH") return ""
  if (error.code !== "NOT_A_RELAY") return null
  const m = /\(protocol (?:kimo-mp\/)?(\d+)\)/.exec(error.message)
  if (!m) return null
  const version = Number(m[1])
  return version < 1 ? (m[1] as string) : null
}

function createRelayTestModel(
  probe: (url: string) => Promise<RelayInfo>,
  timers: ModelTimers,
  ownership?: (url: string) => Promise<RelayOwnerState>,
): RelayTestModel {
  const listeners = new Set<() => void>()
  let state: RelayTestState = { kind: "idle" }
  let run = 0
  const set = (next: RelayTestState) => {
    state = next
    for (const l of [...listeners]) l()
  }
  const self: RelayTestModel = {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState: () => state,
    async test(input) {
      const mine = ++run
      let url: string
      try {
        url = normalizeRelayUrl(input)
      } catch (error) {
        const result: RelayTestState = {
          kind: "invalid",
          url: input,
          message: error instanceof Error ? error.message : String(error),
        }
        set(result)
        return result
      }
      set({ kind: "testing", url })
      const started = timers.now()
      let handle: unknown = null
      const timeout = new Promise<never>((_, reject) => {
        handle = timers.setTimeout(
          () =>
            reject(
              new MultiplayerError(
                "RELAY_UNREACHABLE",
                `no answer within ${RELAY_TEST_TIMEOUT_MS / 1000} s`,
              ),
            ),
          RELAY_TEST_TIMEOUT_MS,
        )
      })
      let result: RelayTestState
      try {
        const info = await Promise.race([probe(url), timeout])
        const ms = Math.max(0, timers.now() - started)
        let owner: RelayOwnerState | null =
          info.owner === "unclaimed" ? "unclaimed" : info.owner === "external" ? "external" : null
        if (info.owner === "claimed" && ownership)
          owner = await Promise.race([ownership(url), timeout]).catch(() => null)
        result = {
          kind: "ok",
          url,
          name: info.name,
          version: info.version,
          protocol: info.protocol,
          ms,
          owner,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const old = probeProtocol(error)
        if (old !== null) result = { kind: "too-old", url, protocol: old || null, message }
        else if (error instanceof MultiplayerError && error.code === "NOT_A_RELAY")
          result = { kind: "not-a-relay", url, message }
        else if (error instanceof MultiplayerError && error.code === "BAD_RELAY_URL")
          result = { kind: "invalid", url, message }
        else result = { kind: "unreachable", url, message }
      } finally {
        timers.clearTimeout(handle)
      }
      if (mine === run) set(result)
      return result
    },
    reset() {
      run++
      set({ kind: "idle" })
    },
    async recheck(input) {
      let url: string
      try {
        url = normalizeRelayUrl(input)
      } catch {
        return
      }
      if (state.kind === "idle" || state.url !== url) return
      await self.test(url)
    },
  }
  return self
}

// --- Join ----------------------------------------------------------------------------------------

const JOIN_IDLE: JoinState = {
  phase: "idle",
  steps: { reachedRelay: false, linkValid: false, decrypted: false },
  showCard: false,
  relayHost: null,
  role: null,
  expiresAt: null,
  progress: null,
  room: null,
  key: null,
  session: null,
  error: null,
}

/** The join card's error for a failure. */
export function joinErrorKind(error: unknown): JoinErrorKind {
  const code = error instanceof MultiplayerError ? error.code : ""
  if (probeProtocol(error) !== null) return "relay-too-old"
  switch (code) {
    case "BAD_LINK":
    case "BAD_RELAY_URL":
    case "ROOM_ID_MISMATCH":
    case "AUTH_INVALID":
      return "bad-link"
    case "TOKEN_EXPIRED":
      return "expired"
    case "TOKEN_REVOKED":
    case "KEY_ROTATED":
    case "KEY_ID_INVALID":
    case "ROOM_NOT_FOUND":
    case "ROOM_CLOSED":
      return "revoked"
    case "RELAY_UNREACHABLE":
      return "unreachable"
    case "NOT_A_RELAY":
      return "not-a-relay"
    case "PROTOCOL_MISMATCH":
      return "relay-too-old"
    case "DECRYPT_FAILED":
    case "CRYPTO_UNSUPPORTED":
      return "decrypt-failed"
    default:
      return "failed"
  }
}

function createJoinModel(
  deps: Pick<MultiplayerModelDeps, "join"> & {
    probe(url: string): Promise<RelayInfo>
    timers: ModelTimers
  },
): JoinModel {
  const { timers } = deps
  const listeners = new Set<() => void>()
  let state: JoinState = JOIN_IDLE
  let run = 0
  const set = (patch: Partial<JoinState>) => {
    state = { ...state, ...patch, steps: { ...state.steps, ...patch.steps } }
    for (const l of [...listeners]) l()
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState: () => state,
    reset() {
      run++
      state = JOIN_IDLE
      for (const l of [...listeners]) l()
    },
    async join(link) {
      const mine = ++run
      const live = () => mine === run
      state = { ...JOIN_IDLE, phase: "parsing" }
      for (const l of [...listeners]) l()
      const card = timers.setTimeout(() => {
        if (live() && state.phase !== "joined" && state.phase !== "idle") set({ showCard: true })
      }, JOIN_CARD_DELAY_MS)
      const fail = (error: unknown): JoinState => {
        timers.clearTimeout(card)
        if (!live()) return state
        set({
          phase: "error",
          showCard: true,
          error: {
            kind: joinErrorKind(error),
            code: error instanceof MultiplayerError ? error.code : "INTERNAL",
            message: error instanceof Error ? error.message : String(error),
          },
        })
        return state
      }
      try {
        const parsed = parseJoinLink(link)
        const token = parseToken(parsed.token)
        const role: Role = token.role === "edit" ? "edit" : "view"
        const expiresAt = token.exp === 0 ? null : token.exp * 1000
        set({ phase: "connecting", relayHost: hostOf(parsed.relayUrl), role, expiresAt })
        if (expiresAt !== null && expiresAt <= timers.now())
          throw new MultiplayerError("TOKEN_EXPIRED", "the link has expired")
        let handle: unknown = null
        const timeout = new Promise<never>((_, reject) => {
          handle = timers.setTimeout(
            () => reject(new MultiplayerError("RELAY_UNREACHABLE", "no answer within 5 s")),
            RELAY_TEST_TIMEOUT_MS,
          )
        })
        try {
          await Promise.race([deps.probe(parsed.relayUrl), timeout])
        } finally {
          timers.clearTimeout(handle)
        }
        if (!live()) return state
        set({ steps: { reachedRelay: true, linkValid: false, decrypted: false } })
        if (!deps.join) throw new MultiplayerError("INTERNAL", "joining is not available here")
        const session = await deps.join(link)
        if (!live()) return state
        const welcomed = session.provider.role !== null
        set({
          phase: "decrypting",
          role: session.role,
          steps: { reachedRelay: true, linkValid: welcomed, decrypted: false },
        })
        // Decrypting: the first catch-up applies the snapshot and the log.
        if (!session.provider.connected) {
          await new Promise<void>((resolve, reject) => {
            const off = session.onEvent((event) => {
              if (event.type === "welcome")
                set({
                  role: event.role,
                  steps: { reachedRelay: true, linkValid: true, decrypted: false },
                })
              else if (event.type === "caught-up") {
                off()
                resolve()
              } else if (event.type === "denied") {
                off()
                reject(new MultiplayerError(event.code, event.message))
              } else if (event.type === "closed" && event.error && !event.willRetry) {
                off()
                reject(event.error)
              }
            })
          })
        }
        timers.clearTimeout(card)
        if (!live()) return state
        set({
          phase: "joined",
          role: session.role,
          progress: 1,
          room: session.room,
          key: roomKeyOf(session.room),
          session,
          steps: { reachedRelay: true, linkValid: true, decrypted: true },
        })
        return state
      } catch (error) {
        return fail(error)
      }
    },
  }
}

// --- Model ---------------------------------------------------------------------------------------

export function createMultiplayerModel(deps: MultiplayerModelDeps): MultiplayerModel {
  const timers = deps.timers ?? realModelTimers
  const storage = deps.storage ?? localStorageModel
  const probe = deps.probe ?? ((relayUrl: string) => new RelayHttpClient({ relayUrl }).probe())
  const docs = new Map<string, DocInternals>()
  const settings = createSettingsModel(deps.settings, deps.platformKind)
  const relayTest = createRelayTestModel(probe, timers, deps.ownership)
  /** Start sharing may have claimed the relay: the check of it reads again (Settings, popover). */
  const started = (relayUrl: string | undefined) =>
    void relayTest.recheck(relayUrl ?? settings.getState().relayUrl ?? "").catch(() => undefined)
  return {
    document(key) {
      let d = docs.get(key)
      if (!d) {
        d = createDocumentModel(key, { backend: deps.backend, timers, storage, started })
        docs.set(key, d)
      }
      return d.model
    },
    settings,
    relayTest,
    join: createJoinModel({ ...(deps.join ? { join: deps.join } : {}), probe, timers }),
    dispose() {
      for (const d of docs.values()) d.dispose()
      docs.clear()
      settings.dispose()
    },
  }
}
