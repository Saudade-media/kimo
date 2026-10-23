/**
 * Hash routes: `#/` (home › Recents; board 37 sections `#/all`, `#/folder/<ref>`, `#/templates`,
 * `#/libraries`, `#/trash`), `#/file/:id` (editor, browser library), `#/disk/<encoded ref>`
 * (editor, a `.kimo` on disk through the session manager), `#/settings/<pane>` (the desktop
 * Settings window) and `#/gallery` (the @kimo/ui gallery).
 * Hash routing keeps the app servable from `file://` and the desktop shell (relative base).
 */
import type { SettingsPane } from "@kimo/platform"
import { parseJoinPath } from "./join/link"
import { parsePairPath } from "./pair/link"
import { parseSettingsHash } from "./settings/model"

/** Board 37 rules (xKrpy) "Sections": what Home shows. */
export type HomeSection =
  | { kind: "recents" }
  | { kind: "all" }
  /** A watched folder (or a folder inside one: Home resolves it to the added folder). */
  | { kind: "folder"; ref: string }
  | { kind: "templates" }
  | { kind: "libraries" }
  | { kind: "trash" }

export type Route =
  | { name: "home"; section: HomeSection }
  | { name: "file"; id: string }
  | { name: "disk"; ref: string; node: string | null }
  | { name: "settings"; pane: SettingsPane }
  | { name: "gallery" }
  /** Board 41 section 5: a join link (`#/join/<encoded link>`; the web form is `/join#...`). */
  | { name: "join"; link: string }
  /** ADR 0017: a pairing link (`#/pair/<encoded link>`; the web form is `/pair#...`). */
  | { name: "pair"; link: string }
  | { name: "not-found"; path: string }

const SIMPLE_SECTIONS: Record<string, "all" | "templates" | "libraries" | "trash"> = {
  "/all": "all",
  "/templates": "templates",
  "/libraries": "libraries",
  "/trash": "trash",
}

/** Parses `location.hash` (`#/file/abc` → file abc). */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/"
  if (path === "/" || path === "") return { name: "home", section: { kind: "recents" } }
  const simple = SIMPLE_SECTIONS[path]
  if (simple) return { name: "home", section: { kind: simple } }
  const f = /^\/folder\/(.+)$/.exec(path)
  if (f?.[1]) {
    try {
      return { name: "home", section: { kind: "folder", ref: decodeURIComponent(f[1]) } }
    } catch {
      return { name: "not-found", path }
    }
  }
  if (path === "/gallery") return { name: "gallery" }
  const joinLink = parseJoinPath(path)
  if (joinLink !== null) return { name: "join", link: joinLink }
  const pairLink = parsePairPath(path)
  if (pairLink !== null) return { name: "pair", link: pairLink }
  // Board 27 §1 "Copy link to page": `?page=<id>` (read by the pages strip).
  const m = /^\/file\/([A-Za-z0-9_-]+)\/?(?:\?page=[A-Za-z0-9]+)?$/.exec(path)
  if (m?.[1]) return { name: "file", id: m[1] }
  const d = /^\/disk\/([^?]+)(?:\?node=([A-Za-z0-9_-]+))?(?:[?&]page=[A-Za-z0-9]+)?$/.exec(path)
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

/**
 * The route path of a file on disk (`/disk/<encoded ref>`), optionally selecting `node` and
 * opening on `page` (a `kimo://open?…&page=` deep link, board 27 §1 "Copy link to page").
 */
export function diskPath(ref: string, node?: string | null, page?: string | null): string {
  const q = [node ? `node=${node}` : "", page ? `page=${page}` : ""].filter(Boolean).join("&")
  return `/disk/${encodeURIComponent(ref)}${q ? `?${q}` : ""}`
}

/**
 * The Home route of a folder's section (board 37 rules xKrpy: `#/folder/<ref>`). Home resolves
 * `ref` to the added folder that contains it.
 */
export function homeFolderPath(ref: string): string {
  return `/folder/${encodeURIComponent(ref)}`
}

/** The route path of a Home section (`/`, `/all`, `/folder/<ref>`, …). */
export function homeSectionPath(section: HomeSection): string {
  switch (section.kind) {
    case "recents":
      return "/"
    case "folder":
      return homeFolderPath(section.ref)
    case "libraries":
      return "/libraries"
    default:
      return `/${section.kind}`
  }
}

let lastHome = "/"
/** Board 37 rules "Sections": Home remembers its section across a trip to the editor. */
export function rememberHomePath(path: string): void {
  lastHome = path
}
/** The Home section last shown (`/` until Home renders), for "Back to files". */
export function lastHomePath(): string {
  return lastHome
}
