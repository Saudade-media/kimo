/**
 * Deep links (`kimo://open?path=…`) and the URI resolver (teardown 9.4: every URI resolves
 * against the `.kimo` file's directory, through one resolver).
 */

/** The URL scheme registered by the desktop app. */
export const DEEP_LINK_SCHEME = "kimo"

/** File extensions Kimo opens (file association + deep links). */
export const KIMO_EXTENSIONS = ["kimo", "kimoz"] as const

/** A parsed deep link. Only `open` is defined in M4. */
export interface DeepLink {
  action: "open"
  /** Absolute path of a `.kimo` / `.kimoz` file. */
  path: string
  /** Optional node id to select after opening. */
  node?: string
  /** Optional page id to open on (board 27 §1 "Copy link to page"). */
  page?: string
}

const ID_RE = /^[A-Za-z0-9]{6,24}$/

/** True for an absolute POSIX path or a Windows drive / UNC path. */
export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\")
}

/** True when `p` names a file Kimo opens. */
export function isKimoPath(p: string): boolean {
  const lower = p.toLowerCase()
  return KIMO_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`))
}

/**
 * Parses `kimo://open?path=<url-encoded absolute path>[&node=<id>][&page=<id>]`. Returns null for any
 * other URL, a relative path, a non-Kimo file, a path with `..` segments or NUL, or a bad id.
 * Deep links come from untrusted pages, so this is strict.
 */
export function parseDeepLink(url: string): DeepLink | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${DEEP_LINK_SCHEME}:`) return null
  // `kimo://open?…` parses with host "open"; `kimo:open?…` with pathname "open".
  const action = u.host || u.pathname.replace(/^\/+/, "")
  if (action !== "open") return null
  const path = u.searchParams.get("path")
  if (!path || path.includes("\0") || !isAbsolutePath(path) || !isKimoPath(path)) return null
  if (path.split(/[\\/]/).some((seg) => seg === "..")) return null
  const link: DeepLink = { action: "open", path }
  const node = u.searchParams.get("node")
  if (node !== null) {
    if (!ID_RE.test(node)) return null
    link.node = node
  }
  const page = u.searchParams.get("page")
  if (page !== null) {
    if (!ID_RE.test(page)) return null
    link.page = page
  }
  return link
}

/**
 * The join link in `kimo://join#<relay>/<room>/<token>/<key>` (or `kimo:join#...`), or the
 * pairing link in `kimo://pair#<relay>/<token>` (ADR 0017): the whole URL, for the app's join or
 * pairing route to parse (it validates the parts). Null for any other URL or an empty fragment.
 * The key or token stays in the fragment.
 */
export function parseJoinDeepLink(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${DEEP_LINK_SCHEME}:`) return null
  const action = u.host || u.pathname.replace(/^\/+/, "")
  if ((action !== "join" && action !== "pair") || u.hash.length < 2) return null
  return url.trim()
}

/** Builds a deep link for a file (and optionally a node). */
export function formatDeepLink(link: DeepLink): string {
  const q = new URLSearchParams({ path: link.path })
  if (link.node) q.set("node", link.node)
  if (link.page) q.set("page", link.page)
  return `${DEEP_LINK_SCHEME}://open?${q.toString()}`
}

const sepOf = (p: string) => (p.includes("\\") && !p.includes("/") ? "\\" : "/")

/** Directory part of a path or file ref (`/a/b/c.kimo` → `/a/b`). */
export function dirnameOf(ref: string): string {
  const i = Math.max(ref.lastIndexOf("/"), ref.lastIndexOf("\\"))
  if (i < 0) return "."
  if (i === 0) return ref.slice(0, 1)
  return ref.slice(0, i)
}

/** Last segment of a path or file ref. */
export function basenameOf(ref: string): string {
  const i = Math.max(ref.lastIndexOf("/"), ref.lastIndexOf("\\"))
  return i < 0 ? ref : ref.slice(i + 1)
}

/**
 * Resolves a document-relative reference (`./assets/…`, `../lib/ui.lib.kimo`) against the
 * `.kimo` file it appears in. Rejects absolute references, schemes, backslashes in the
 * reference and anything that climbs above the filesystem root. The result uses the file
 * ref's separator.
 *
 * @throws {Error} for a reference outside the grammar (spec §3 relative path).
 */
export function resolveAgainstFile(fileRef: string, relative: string): string {
  if (!/^\.{1,2}\//.test(relative) || relative.includes("\\") || relative.includes("\0"))
    throw new Error(`Not a document-relative reference: ${relative}`)
  const sep = sepOf(fileRef)
  const dir = dirnameOf(fileRef)
  const parts = dir.split(/[\\/]/)
  const root = parts[0] ?? ""
  const stack = parts.slice(1).filter((p) => p !== "")
  for (const seg of relative.split("/")) {
    if (seg === "." || seg === "") continue
    if (seg === "..") {
      if (stack.length === 0) throw new Error(`Reference climbs above the root: ${relative}`)
      stack.pop()
    } else stack.push(seg)
  }
  return [root, ...stack].join(sep)
}

/**
 * The document-relative reference from the `.kimo` at `fileRef` to `targetRef` (board 27 §8
 * rule gPEqc "Library paths": stored relative to the current file — `./icons.kimo`,
 * `../icons/icons.kimo` — never always `./file`). Spaces are written `%20` (spec §3 relative
 * paths have no whitespace). Null when the two refs share no root (another drive or scheme).
 */
export function relativeRefBetween(fileRef: string, targetRef: string): string | null {
  const split = (p: string) => p.split(/[\\/]/)
  const from = split(dirnameOf(fileRef))
  const to = split(targetRef)
  if ((from[0] ?? "") !== (to[0] ?? "")) return null
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
  const up = from.slice(i).filter((s) => s !== "")
  const down = to.slice(i).filter((s) => s !== "")
  if (down.length === 0) return null
  const rel = [...(up.length ? up.map(() => "..") : ["."]), ...down].join("/")
  return rel.replace(/\s/g, "%20")
}

/** Resolves a reference written by {@link relativeRefBetween} (`%20` → space). */
export function resolveRelativeRef(fileRef: string, relative: string): string {
  return resolveAgainstFile(fileRef, relative.replace(/%20/g, " "))
}

/**
 * Rewrites document-relative references after the document moved from `oldRef` to `newRef`
 * (Save as, a move): each still points at the same file. Unchanged or unresolvable entries keep
 * their value. Returns null when nothing changes.
 */
export function rebaseRelativeRefs(
  refs: Readonly<Record<string, string>>,
  oldRef: string,
  newRef: string,
): Record<string, string> | null {
  const out: Record<string, string> = {}
  let changed = false
  for (const [k, rel] of Object.entries(refs)) {
    let next = rel
    try {
      const abs = resolveRelativeRef(oldRef, rel)
      next = relativeRefBetween(newRef, abs) ?? rel
    } catch {
      next = rel
    }
    if (next !== rel) changed = true
    out[k] = next
  }
  return changed ? out : null
}

/**
 * Whether `openExternalUrl` opens `url` (audit G1, link popover › Open): web links with a host,
 * and mail / phone links. `file:`, `javascript:` and other schemes never open. Mirrors
 * `openable_url` in `src-tauri/src/commands.rs`.
 */
export function isOpenableUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  switch (u.protocol) {
    case "https:":
    case "http:":
      return u.hostname !== ""
    case "mailto:":
    case "tel:":
      return u.pathname.trim() !== ""
    default:
      return false
  }
}
