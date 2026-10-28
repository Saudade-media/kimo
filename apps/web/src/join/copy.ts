/**
 * Join screen copy and rows (board 41 section 5, vignettes A to G). Pure: the cards render what
 * these functions return, and the unit tests pin the copy.
 */
import type { JoinErrorKind, JoinState } from "../multiplayer/model"

/** The buttons of an error card, left to right. */
export type JoinActionId = "open-kimo" | "copy-details" | "try-again" | "paste-link"

export interface JoinErrorCard {
  kind: JoinErrorKind
  /** Lucide icon in the 40 px wrap. */
  icon: string
  /** Wrap fill: neutral (`bg-muted`, expired and revoked) or danger (`danger-soft`). */
  tone: "neutral" | "danger"
  title: string
  desc: string
  /** Mono line under the text (error code, status). */
  meta: string | null
  actions: readonly JoinActionId[]
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `12 Oct`: the day a link stopped working (board 41 C). */
export function shortDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** `6 days`, `3 hours`, `12 minutes`: the time left on a link. */
export function timeLeft(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`
  const days = Math.round(hours / 24)
  return `${days} days`
}

/** The text of step 2: `Link is valid · Edit · expires in 6 days`. */
function linkStepLabel(state: Pick<JoinState, "role" | "expiresAt">, now: number): string {
  const role = state.role === "edit" ? "Edit" : state.role === "view" ? "View" : null
  const expiry =
    state.expiresAt === null
      ? role
        ? "never expires"
        : null
      : `expires in ${timeLeft(state.expiresAt - now)}`
  return ["Link is valid", role, expiry].filter(Boolean).join(" · ")
}

export type StepStatus = "done" | "active" | "pending"

export interface JoinStepRow {
  id: "relay" | "link" | "decrypt"
  label: string
  status: StepStatus
}

/** The three steps, ticking in place (board 41 A). */
export function joinSteps(state: JoinState, now: number): JoinStepRow[] {
  const { reachedRelay, linkValid, decrypted } = state.steps
  const status = (done: boolean, previous: boolean): StepStatus =>
    done ? "done" : previous ? "active" : "pending"
  return [
    { id: "relay", label: "Reached the relay", status: status(reachedRelay, true) },
    {
      id: "link",
      label: reachedRelay ? linkStepLabel(state, now) : "Link is valid",
      status: status(linkValid, reachedRelay),
    },
    { id: "decrypt", label: "Decrypting the file", status: status(decrypted, linkValid) },
  ]
}

/** The progress meta under the bar. */
export function progressMeta(progress: number | null): string {
  if (progress === null) return "images load as you scroll"
  return `${Math.round(progress * 100)} % · images load as you scroll`
}

/** The card title: the owner's file name is not known before the file decrypts. */
export const JOINING_TITLE = "Joining a shared file"

/** Links never appear in the card or in Copy details: their fragment holds the key. */
const redact = (text: string): string =>
  text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<link>").replace(/#\S+/g, "#<key>")

const first = (text: string): string => redact((text.split("\n")[0] ?? "").trim())

/** The error card for a failed join (vignettes C to G; bad link and failed use the closest). */
export function errorCard(state: JoinState): JoinErrorCard {
  const kind = state.error?.kind ?? "failed"
  const host = state.relayHost ?? "the relay"
  const code = state.error?.code ?? ""
  const message = first(state.error?.message ?? "")
  switch (kind) {
    case "expired":
      return {
        kind,
        icon: "clock-alert",
        tone: "neutral",
        title: "This link has expired",
        desc: `${
          state.expiresAt !== null
            ? `It stopped working on ${shortDate(state.expiresAt)}.`
            : "It stopped working."
        } Ask the person who shared it for a new link.`,
        meta: null,
        actions: ["open-kimo"],
      }
    case "revoked":
      return {
        kind,
        icon: "link-2-off",
        tone: "neutral",
        title: "This link was turned off",
        desc: "The owner revoked it or reset all links. Ask them for a new one.",
        meta: null,
        actions: ["open-kimo"],
      }
    case "unreachable":
      return {
        kind,
        icon: "wifi-off",
        tone: "danger",
        title: "Couldn't reach the relay",
        desc: `${host} did not answer. It may be down, or blocked on this network.`,
        meta: message || code || null,
        actions: ["copy-details", "try-again"],
      }
    case "not-a-relay":
      return {
        kind,
        icon: "server-off",
        tone: "danger",
        title: "This is not a Kimo relay",
        desc: "The link's server does not speak Kimo. Check the link is complete, or ask for a new one.",
        meta: [host, message].filter((p) => p && p !== "the relay").join(" · ") || null,
        actions: ["copy-details"],
      }
    case "relay-too-old":
      return {
        kind,
        icon: "server-off",
        tone: "danger",
        title: "This relay is too old",
        desc: "The relay speaks an older version of Kimo. Ask its owner to update it, then try again.",
        meta: [host, message].filter((p) => p && p !== "the relay").join(" · ") || null,
        actions: ["copy-details"],
      }
    case "decrypt-failed":
      return {
        kind,
        icon: "key-round",
        tone: "danger",
        title: "Couldn't open this file",
        desc: "The key in the link is wrong or damaged. Copy the whole link again, including the part after #.",
        meta: message || "AEAD tag mismatch",
        actions: ["paste-link", "try-again"],
      }
    case "bad-link":
      return {
        kind,
        icon: "link-2-off",
        tone: "danger",
        title: "This link is not complete",
        desc: "It does not look like a Kimo link. Copy the whole link again, including the part after #.",
        meta: message || null,
        actions: ["paste-link", "try-again"],
      }
    default:
      return {
        kind: "failed",
        icon: "circle-alert",
        tone: "danger",
        title: "Couldn't join this file",
        desc: "Something went wrong while joining. Try again, or ask the owner for a new link.",
        meta: message || code || null,
        actions: ["copy-details", "try-again"],
      }
  }
}

/**
 * What Copy details puts on the clipboard for the owner: the relay, the time and the error code.
 * Never the link (its fragment holds the key) and never the token.
 */
export function detailsText(state: JoinState, now: Date): string {
  const error = state.error
  return [
    `Kimo join failed`,
    `Relay: ${state.relayHost ?? "unknown"}`,
    `Time: ${now.toISOString()}`,
    `Error: ${error?.code ?? "UNKNOWN"}${error?.message ? ` (${first(error.message)})` : ""}`,
  ].join("\n")
}

/** Retry back-off: 0.5 s, 1 s, 2 s, 4 s, 8 s, then 8 s (board 41 E: "Retry backs off"). */
export function retryDelay(attempt: number): number {
  return Math.min(8000, 500 * 2 ** Math.max(0, attempt))
}

/** The toast text once joined (board 41 B). */
export function joinedToast(role: "edit" | "view" | null, name: string): string {
  return `You joined ${name} · ${role === "edit" ? "you can edit" : "view only"}`
}
