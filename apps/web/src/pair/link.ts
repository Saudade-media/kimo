/**
 * Where a pairing link comes from (board 41 section 5 H to N, ADR 0017):
 * `https://<origin>/pair#<relay>/<token>` in the web app, `#/pair/<encoded link>` inside the app
 * (the desktop `kimo://pair#...` deep link lands there). The token stays in the `#` part: it
 * never reaches a web server.
 */

/** The pathname of the web pairing route (`/pair`, or `<base>/pair` under a sub-path). */
export function isPairPath(pathname: string): boolean {
  return /(^|\/)pair\/?$/.test(pathname)
}

/** The pairing link of the page's location, or null on any other page ("" with no fragment). */
export function pairLinkFromLocation(
  loc: Pick<Location, "pathname" | "hash" | "href">,
): string | null {
  if (!isPairPath(loc.pathname)) return null
  return loc.hash.length > 1 ? loc.href : ""
}

/** The in-app hash route path of a pairing link (`/pair/<encoded link>`). */
export function pairPath(link: string): string {
  return `/pair/${encodeURIComponent(link)}`
}

/** Parses the in-app hash route `/pair/<encoded link>`; null when it is not one. */
export function parsePairPath(path: string): string | null {
  const m = /^\/pair\/(.*)$/.exec(path)
  if (!m) return null
  try {
    return decodeURIComponent(m[1] ?? "")
  } catch {
    return ""
  }
}

/** Whether a deep link the desktop handed over is a pairing link (`kimo://pair#...`). */
export function isPairDeepLink(link: string): boolean {
  return /^kimo:(\/\/)?pair(\/)?#/i.test(link.trim())
}
