/**
 * Kimo Cloud links that reach the app (kimo-cloud api.md §3.3, §8.2, §13.6):
 *
 * - an invite: `kimo://cloud/invite#<token>` on desktop (the `/invite` landing page's Open in Kimo),
 *   `<app>/invite#<token>` on web. The token stays in the fragment, never sent to a server but
 *   Kimo Cloud's own `invites/peek` and `invites/accept`;
 * - an owner transfer: `kimo://cloud/transfer` (the email links the app's URL and carries no token:
 *   the app asks Kimo Cloud, whose workspace summary names the transfer);
 * - the sign-in page's Open Kimo: `kimo://cloud/signed-in`.
 *
 * Links come from untrusted pages: anything else parses to null.
 */

export type CloudLink =
  | { action: "invite"; token: string }
  | { action: "transfer" }
  | { action: "signed-in" }

/** An invite token: base64url of 32 bytes. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

const invite = (fragment: string): CloudLink | null => {
  const token = fragment.replace(/^#/, "")
  return TOKEN_RE.test(token) ? { action: "invite", token } : null
}

/** A `kimo://cloud/...` deep link (as the desktop hands it over), or null. */
export function parseCloudDeepLink(link: string): CloudLink | null {
  let u: URL
  try {
    u = new URL(link.trim())
  } catch {
    return null
  }
  if (u.protocol !== "kimo:" || u.host !== "cloud" || u.search !== "") return null
  if (u.pathname === "/invite") return invite(u.hash)
  if (u.pathname === "/transfer" && u.hash === "") return { action: "transfer" }
  if (u.pathname === "/signed-in" && u.hash === "") return { action: "signed-in" }
  return null
}

/** Whether a link the desktop handed over is a Kimo Cloud link (not a join or pairing link). */
export const isCloudDeepLink = (link: string) => /^kimo:\/\/cloud\//i.test(link.trim())

/** The web invite route (`/invite`, or `<base>/invite` under a sub-path) with its fragment. */
export function cloudLinkFromLocation(loc: Pick<Location, "pathname" | "hash">): CloudLink | null {
  if (!/(^|\/)invite\/?$/.test(loc.pathname)) return null
  return invite(loc.hash)
}
