/**
 * Hash routes: `#/` (home), `#/file/:id` (editor, browser library), `#/disk/<encoded ref>`
 * (editor, a `.kimo` on disk through the session manager), `#/settings/<pane>` (the desktop
 * Settings window) and `#/gallery` (the @kimo/ui gallery).
 * Hash routing keeps the app servable from `file://` and the desktop shell (relative base).
 */
import type { SettingsPane } from "@kimo/platform"
import { parseSettingsHash } from "./settings/model"

export type Route =
  | { name: "home" }
  | { name: "file"; id: string }
  | { name: "disk"; ref: string; node: string | null }
  | { name: "settings"; pane: SettingsPane }
  | { name: "gallery" }
  | { name: "not-found"; path: string }

/** Parses `location.hash` (`#/file/abc` → file abc). */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/"
  if (path === "/" || path === "") return { name: "home" }
  if (path === "/gallery") return { name: "gallery" }
  const m = /^\/file\/([A-Za-z0-9_-]+)\/?$/.exec(path)
  if (m?.[1]) return { name: "file", id: m[1] }
  const d = /^\/disk\/([^?]+)(?:\?node=([A-Za-z0-9_-]+))?$/.exec(path)
  if (d?.[1]) {
    try {
      return { name: "disk", ref: decodeURIComponent(d[1]), node: d[2] ?? null }
    } catch {
      return { name: "not-found", path }
    }
  }
  const pane = parseSettingsHash(hash)
  if (pane) return { name: "settings", pane }
  return { name: "not-found", path }
}

/** Navigates to a route path (`/file/abc`). */
export function navigate(path: string): void {
  location.hash = `#${path}`
}

/** The route path of a file on disk (`/disk/<encoded ref>`). */
export function diskPath(ref: string, node?: string | null): string {
  return `/disk/${encodeURIComponent(ref)}${node ? `?node=${node}` : ""}`
}
