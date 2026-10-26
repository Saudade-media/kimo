/**
 * The browser hand-off of a share link (board 45 section 2). Links are `https://<relay>/join#...`
 * (or `/pair#...`); the relay serves this app there. A browser that opened one first offers the
 * link to the Kimo app (`kimo://join#<same fragment>`), then lets the person continue here.
 *
 * A (trying): shown at once, one `kimo://` attempt. C (opened): the tab was hidden or lost focus
 * within {@link HANDOFF_WAIT_MS}, so the app took it. B (no app): still visible after that.
 * D (insecure): an http page other than localhost has no `crypto.subtle`, so the browser can't
 * decrypt; no attempt to join here. Pure: the gate component drives it.
 */
import { parseJoinLink, parseToken } from "@kimo/sync/mp"
import { timeLeft } from "./copy"

export type HandoffKind = "join" | "pair"

export type HandoffPhase = "trying" | "no-app" | "opened" | "insecure"

/** How long a visible tab waits for the app before offering the browser (board 45 B). */
export const HANDOFF_WAIT_MS = 1500

export interface StartupLink {
  kind: HandoffKind
  /** The fragment, without `#`. */
  fragment: string
  /** The page URL as opened (Copy link on D copies it). */
  href: string
}

/**
 * The link this browser page was opened at, or null: inside the desktop app, on any other path,
 * or with an empty fragment (the join screen then reports the incomplete link itself).
 */
export function startupLinkOf(
  loc: Pick<Location, "pathname" | "hash" | "href">,
  inApp: boolean,
): StartupLink | null {
  if (inApp || loc.hash.length <= 1) return null
  const m = /(?:^|\/)(join|pair)\/?$/.exec(loc.pathname)
  if (!m) return null
  return { kind: m[1] as HandoffKind, fragment: loc.hash.slice(1), href: loc.href }
}

/** The app's deep link for the same fragment. */
export function appLinkOf(link: Pick<StartupLink, "kind" | "fragment">): string {
  return `kimo://${link.kind}#${link.fragment}`
}

/** The first phase: D on an insecure page, else A. */
export function initialPhase(secure: boolean): HandoffPhase {
  return secure ? "trying" : "insecure"
}

/** Desktop builds exist for these; elsewhere (phones) the Get Kimo link is hidden. */
export function downloadLabel(userAgent: string): string | null {
  if (/iPhone|iPad|iPod|Android/i.test(userAgent)) return null
  if (/Mac/i.test(userAgent)) return "Get Kimo for Mac"
  if (/Win/i.test(userAgent)) return "Get Kimo for Windows"
  if (/Linux|X11/i.test(userAgent)) return "Get Kimo for Linux"
  return null
}

export const DOWNLOAD_URL = "https://getkimo.design/"

/** The relay host of a fragment (`relay.maya.studio`, `relay.local:8787`), or null. */
export function relayHostOf(fragment: string): string | null {
  const m = /^(https?|wss?):\/\/([^/]+)/i.exec(fragment)
  return m ? (m[2] ?? null) : null
}

/**
 * The mono line on B: `relay.maya.studio · can edit · expires in 6 days`. Role and expiry come
 * from the signed token, readable before anything is decrypted; a pairing link or a link that
 * does not parse shows the host only.
 */
export function handoffMeta(link: Pick<StartupLink, "kind" | "fragment">, now: number): string {
  const host = relayHostOf(link.fragment) ?? ""
  if (link.kind !== "join") return host
  try {
    const claims = parseToken(parseJoinLink(link.fragment).token)
    const role = claims.role === "edit" ? "can edit" : "can view"
    const expiry =
      claims.exp === 0 ? "never expires" : `expires in ${timeLeft(claims.exp * 1000 - now)}`
    return [host, role, expiry].filter(Boolean).join(" · ")
  } catch {
    return host
  }
}
