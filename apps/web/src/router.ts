/**
 * Hash routes: `#/` (home), `#/file/:id` (editor), `#/gallery` (the @kimo/ui gallery).
 * Hash routing keeps the app servable from `file://` and the desktop shell (relative base).
 */
export type Route =
  | { name: "home" }
  | { name: "file"; id: string }
  | { name: "gallery" }
  | { name: "not-found"; path: string }

/** Parses `location.hash` (`#/file/abc` → file abc). */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/"
  if (path === "/" || path === "") return { name: "home" }
  if (path === "/gallery") return { name: "gallery" }
  const m = /^\/file\/([A-Za-z0-9_-]+)\/?$/.exec(path)
  if (m?.[1]) return { name: "file", id: m[1] }
  return { name: "not-found", path }
}

/** Navigates to a route path (`/file/abc`). */
export function navigate(path: string): void {
  location.hash = `#${path}`
}
