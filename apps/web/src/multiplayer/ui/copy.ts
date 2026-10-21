/**
 * Board 41 copy and state mapping for the share UI (sections 2, 3, 4 and 6), as pure functions so
 * every state is unit-tested without a DOM. The components in this folder only render these.
 */

import type { Role } from "@kimo/sync/mp"
import type { Persona, SaveStatusKind } from "@kimo/ui"
import { assetSyncStatus } from "../canvas-model"
import type {
  AgentView,
  ExpiryChoice,
  LinkView,
  PersonView,
  RelayStatus,
  RelayTestState,
  ShareState,
} from "../model"
import type { RelayOwnerState } from "../ownership"
import type { PresenceColor } from "../presence"

// --- Topbar sync status (section 2, rules row "Sync status") -------------------------------------

export interface SyncStatusView {
  /** The SaveStatus look: saved (no fill, tertiary), paused (warning), read-only (muted). */
  kind: SaveStatusKind
  /** Exact lucide name on the board. */
  icon: string
  label: string
  /** Hover text ("Hover explains it" on Offline). */
  tooltip: string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The pill that replaces "Saved locally" while a file is shared: Synced (circle-check), Syncing…
 * (loader-circle), Sharing N images (arrow-up, section 8 E), Reconnecting… (Paused, refresh-cw),
 * Offline · edits kept (ReadOnly, wifi-off), View only (ReadOnly, eye).
 */
export function syncStatusView(relay: RelayStatus, uploading = 0): SyncStatusView {
  switch (relay) {
    case "synced":
      return {
        kind: "saved",
        icon: "circle-check",
        label: "Synced",
        tooltip: "The relay has every update",
      }
    case "syncing":
      return {
        kind: "saving",
        icon: "loader-circle",
        label: "Syncing…",
        tooltip: "Sending your edits to the relay",
      }
    case "saving":
      return {
        kind: "saving",
        icon: "arrow-up",
        label: `Sharing ${plural(uploading, "image")}`,
        tooltip: SHARING_TOOLTIP,
      }
    case "reconnecting":
      return {
        kind: "paused",
        icon: "refresh-cw",
        label: "Reconnecting…",
        tooltip: "The relay dropped. Keep editing: Kimo retries and syncs when it is back",
      }
    case "offline":
      return {
        kind: "read-only",
        icon: "wifi-off",
        label: "Offline · edits kept",
        tooltip:
          "No network for more than 30 s. Edits stay in this file and sync when the relay is back",
      }
    case "view-only":
      return {
        kind: "read-only",
        icon: "eye",
        label: "View only",
        tooltip: "You joined with a view link",
      }
  }
}

const SHARING_TOOLTIP = "Others see these images once the relay has them"
const FETCHING_TOOLTIP = "Images others added are on their way from the relay"

/**
 * Board 41 › 8 E "sync status while assets move": edits sync first, assets after, so the asset
 * work ({@link assetSyncStatus}) shows only when no edit is pending and the relay is there, where
 * the status would read Synced or View only. Uploads come first: "Sharing N images" (arrow-up,
 * SaveStatus/Saving hbDxo), then "Fetching N images" (arrow-down, SaveStatus EdNXU). Syncing…,
 * Reconnecting… and Offline · edits kept keep the slot while assets wait.
 */
export function topbarSyncStatus(
  relay: RelayStatus,
  transfers: { uploading: readonly string[]; fetching: readonly unknown[] },
): SyncStatusView & { moving: "uploading" | "fetching" | null } {
  const quiet = relay === "synced" || relay === "saving" || relay === "view-only"
  const assets = quiet ? assetSyncStatus(transfers) : null
  if (assets?.icon === "arrow-up")
    return {
      kind: "saving",
      icon: "arrow-up",
      label: assets.text,
      tooltip: SHARING_TOOLTIP,
      moving: "uploading",
    }
  if (assets)
    return {
      kind: "saved",
      icon: "arrow-down",
      label: assets.text,
      tooltip: FETCHING_TOOLTIP,
      moving: "fetching",
    }
  // "saving" is Synced with uploads; with none left it reads Synced.
  return { ...syncStatusView(relay === "saving" ? "synced" : relay), moving: null }
}

/** Presence is stale while the relay is gone: the avatar stack dims to 0.5. */
export const stackDimmed = (relay: RelayStatus | null) =>
  relay === "reconnecting" || relay === "offline"

// --- Avatar stack (section 2, rules row "Avatar stack") ------------------------------------------

/** At most three avatars, then a "+N" disc. */
export const STACK_MAX = 3

export function stackOf<T>(others: readonly T[]): { shown: readonly T[]; more: number } {
  if (others.length <= STACK_MAX) return { shown: others, more: 0 }
  return { shown: others.slice(0, STACK_MAX), more: others.length - STACK_MAX }
}

/** Initials of a person: "Maya Rossi" → "MR", "Guest 3" → "G3", "Ana" → "A". */
export function initialsOf(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase()
}

export const presenceVar = (color: PresenceColor) => `var(--kimo-${color})`

// --- Share popover (section 3) -------------------------------------------------------------------

export type SharePopoverStage = "first-run" | "ready" | "live"

/** Which of A (first run), B (relay set, ready) or C (live) the popover shows. */
export function sharePopoverStage(
  share: Pick<ShareState, "status" | "owner">,
  relayUrl: string | null,
): SharePopoverStage {
  if (share.status === "live" && share.owner) return "live"
  return relayUrl ? "ready" : "first-run"
}

/** Connection meta: "relay.maya.studio · 5 people here". */
export function connectionMeta(relayHost: string | null, othersOnline: number): string {
  const here =
    othersOnline === 0 ? "nobody else here" : `${plural(othersOnline, "person", "people")} here`
  return relayHost ? `${relayHost} · ${here}` : here
}

export const EXPIRY_LABEL: Record<ExpiryChoice, string> = {
  "1d": "1 day",
  "7d": "7 days",
  "30d": "30 days",
  never: "Never",
}

export const ROLE_LABEL: Record<Role, string> = { view: "View", edit: "Edit" }

/** "6 days", "23 h", "40 min", "less than a minute" until `at` (rounded to the nearest unit). */
export function remaining(at: number, now: number): string {
  const min = Math.floor(Math.max(0, at - now) / 60_000)
  if (min < 1) return "less than a minute"
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h`
  return plural(Math.round(min / 1440), "day")
}

/** "2 h ago", "yesterday", "3 days ago". */
export function ago(at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000)
  if (min < 1) return "just now"
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? "yesterday" : `${d} days ago`
}

/** "Expires in 6 days", "Never expires". */
export const expiryText = (link: Pick<LinkView, "expiresAt">, now: number) =>
  link.expiresAt === null ? "Never expires" : `Expires in ${remaining(link.expiresAt, now)}`

/**
 * A link row's meta: "Expires in 6 days · used 2 h ago". The relay does not report which link a
 * connection used yet (`lastUsedAt` null means unknown), so the "used" part is left out rather
 * than claiming "never used".
 */
export function linkMeta(link: Pick<LinkView, "expiresAt" | "lastUsedAt">, now: number): string {
  const expiry = expiryText(link, now)
  return link.lastUsedAt === null ? expiry : `${expiry} · used ${ago(link.lastUsedAt, now)}`
}

/** Toast after Create link or Copy: "Edit link copied · expires in 7 days". */
export function linkCopiedText(link: Pick<LinkView, "role" | "expiresAt">, now: number): string {
  const when =
    link.expiresAt === null ? "never expires" : `expires in ${remaining(link.expiresAt, now)}`
  return `${ROLE_LABEL[link.role]} link copied · ${when}`
}

export const linkRevokedText = (role: Role) => `${ROLE_LABEL[role]} link revoked`

/** The Reset all links dialog description (section 3 D, QTzCg). */
export function resetDescription(activeLinks: number, impactCopy: string): string {
  const links =
    activeLinks === 0
      ? "Every link stops working."
      : activeLinks === 1
        ? "Every link stops working, including the active one."
        : `Every link stops working, including the ${activeLinks} active ones.`
  return `${links} ${impactCopy} The file and its history stay as they are.`
}

// --- Relay test results (section 4, and inline in the popover) -----------------------------------

export type RelayResultView =
  | { kind: "testing"; text: string }
  /**
   * `relay` ("Kimo relay 1.2") and `time` make the meta: "Kimo relay 1.2 · 84 ms" in the popover
   * (B, G, H), "Kimo relay 1.2 · answered in 84 ms" in Settings. `owner` picks the pill (ADR 0017).
   */
  | {
      kind: "ok"
      relay: string
      ms: number
      time: string
      protocol: string
      owner: RelayOwnerState | null
    }
  | { kind: "warning" | "danger"; icon: "triangle-alert" | "circle-x"; text: string }

const hostOf = (url: string) => {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** "kimo-mp/1" → "1". */
const protocolNumber = (protocol: string) => protocol.replace(/^kimo-mp\//, "")

/** The result row under the Relay URL field, or null when nothing was tested. */
export function relayResultView(state: RelayTestState): RelayResultView | null {
  switch (state.kind) {
    case "idle":
      return null
    case "testing":
      return { kind: "testing", text: `Testing ${state.url}…` }
    case "ok":
      return {
        kind: "ok",
        relay: `Kimo relay ${state.version}`,
        ms: Math.round(state.ms),
        time: `answered in ${Math.round(state.ms)} ms`,
        protocol: `protocol ${protocolNumber(state.protocol)}`,
        owner: state.owner,
      }
    case "not-a-relay":
      return {
        kind: "warning",
        icon: "triangle-alert",
        text: "This server answered, but not as a Kimo relay. Check the path, it usually ends in /kimo.",
      }
    case "unreachable":
      return {
        kind: "danger",
        icon: "circle-x",
        text: `Couldn't reach ${hostOf(state.url)}. Check the URL and that the relay is running.`,
      }
    case "too-old":
      return {
        kind: "warning",
        icon: "triangle-alert",
        text: `This relay speaks ${state.protocol ? `protocol ${protocolNumber(state.protocol)}` : "an older protocol"}. Update kimo-relay to 1.2 or later.`,
      }
    case "invalid":
      return {
        kind: "danger",
        icon: "circle-x",
        text: `That is not a relay URL. Use wss:// or https:// and the relay's host, like wss://relay.example.com.`,
      }
  }
}

/**
 * The ownership pill (board 41: section 3 B, G, H in the popover; section 4 in Settings): the tone
 * and the label. Unknown ownership (no check) shows the relay version like before.
 */
export function ownerPill(
  owner: RelayOwnerState | null,
  where: "popover" | "settings",
  relay: string,
): { tone: "success" | "muted" | "warning"; label: string } {
  switch (owner) {
    case "yours":
      return { tone: "success", label: where === "popover" ? "Your relay" : "Yours" }
    case "unclaimed":
      return { tone: "muted", label: where === "popover" ? "Not set up yet" : "Not claimed yet" }
    case "other":
      return { tone: "warning", label: "Not yours" }
    case "external":
      return { tone: "success", label: where === "popover" ? "Managed relay" : "Managed" }
    default:
      return { tone: "success", label: relay }
  }
}

/** "Couldn't use this URL: the desktop app reaches plain http relays only on localhost…" */
export const refusedText = (message: string) =>
  `Couldn't use this URL: ${message.replace(/\.$/, "")}.`

/** Start sharing needs a Kimo relay: the last test passed for this very URL. */
export const relayReady = (state: RelayTestState, url: string | null) =>
  state.kind === "ok" && url !== null && state.url === url

// --- People list (section 6 B) -------------------------------------------------------------------

/** "Owner", "Edit", "View". */
export const personRole = (p: Pick<PersonView, "owner" | "role">) =>
  p.owner ? "Owner" : p.role ? ROLE_LABEL[p.role] : ""

const PERSONAS: readonly Persona[] = ["iris", "violet", "rose", "ember", "moss"]

/**
 * An agent's persona hue: your lead agent is teal (`$agent`); every other agent gets a stable hue
 * from its holder id, so it keeps its color for everyone in the file.
 */
export function agentPersona(agent: Pick<AgentView, "holder" | "isYours">, index: number): Persona {
  if (agent.isYours && index === 0) return "teal"
  let h = 0
  for (const c of agent.holder) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PERSONAS[h % PERSONAS.length] as Persona
}

/** "Kimo · Gui's agent", or the agent alone when it joined with its own link. */
export const agentLabel = (a: Pick<AgentView, "label" | "ownerLabel">) =>
  a.ownerLabel ? `${a.label} · ${a.ownerLabel}'s agent` : a.label

/** "editing Hero Image" (the first claimed node by name), or null while it claims nothing. */
export function agentMeta(
  a: Pick<AgentView, "editing">,
  nodeName: (id: string) => string | null,
): string | null {
  const first = a.editing[0]
  if (first === undefined) return null
  const name = nodeName(first) ?? "a layer"
  return a.editing.length > 1
    ? `editing ${name} and ${a.editing.length - 1} more`
    : `editing ${name}`
}
