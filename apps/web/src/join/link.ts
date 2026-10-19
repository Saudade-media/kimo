/**
 * Where a join link comes from (board 41 section 5): `https://<origin>/join#<relay>/<room>/<token>/<key>`
 * in the web app, `#/join/<encoded link>` inside the app (the desktop `kimo://join#...` deep link
 * lands there). The key stays in the `#` part: it never reaches a server.
 */

/** The pathname of the web join route (`/join`, or `<base>/join` under a sub-path). */
export function isJoinPath(pathname: string): boolean {
  return /(^|\/)join\/?$/.test(pathname)
}

/**
 * The join link of the page's location: the `/join` path with a fragment. Null on any other page
 * or when the fragment is empty (the join screen then says the link is incomplete).
 */
export function joinLinkFromLocation(
  loc: Pick<Location, "pathname" | "hash" | "href">,
): string | null {
  if (!isJoinPath(loc.pathname)) return null
  return loc.hash.length > 1 ? loc.href : ""
}

/** The in-app hash route path of a join link (`/join/<encoded link>`). */
export function joinPath(link: string): string {
  return `/join/${encodeURIComponent(link)}`
}

/** Parses the in-app hash route `/join/<encoded link>`; null when it is not one. */
export function parseJoinPath(path: string): string | null {
  const m = /^\/join\/(.*)$/.exec(path)
  if (!m) return null
  try {
    return decodeURIComponent(m[1] ?? "")
  } catch {
    return ""
  }
}

/** Home as seen from the join page: the app root (`/`), hash route Recents. */
export function homeUrlFromJoin(loc: Pick<Location, "href" | "pathname">): string {
  const url = new URL(".", loc.href)
  return `${url.href}#/`
}
