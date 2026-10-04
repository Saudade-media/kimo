/**
 * Topology (ADR 0013 §8): where the documents live for an MCP session, and the files under
 * `~/.kimo` that relays and the app share.
 *
 *   agent host ──stdio──▶ kimo-mcp (Rust shim, app bundle)  ──socket──▶ desktop app ─▶ document host
 *   agent host ──HTTP (localhost + bearer)───────────────────────────▶ desktop app ─▶ document host
 *   agent host ──stdio──▶ kimo mcp (Bun/Node CLI) ── attach: same socket ──▶ desktop app
 *                                              └─ headless: in-memory DocStore + file lease + atomic save
 *
 * Pure functions only; the CLI and the app supply the probes.
 */

/** Paths relative to the Kimo home (`~/.kimo`; `%USERPROFILE%\.kimo` on Windows). */
export const KIMO_PATHS = {
  socketDir: "socket",
  socket: "socket/kimo.sock",
  /** Socket token, 0600, rotated at every app start. */
  token: "mcp/token",
  /** {@link EndpointFile}, 0600. Written by the app after both listeners are up; removed on quit. */
  endpoint: "mcp/endpoint.json",
  /** Per-host HTTP bearer tokens, 0600: `{ "<client>": "<token>" }`. */
  httpTokens: "mcp/http-tokens.json",
  /** Per-client policies set in Settings › Agents: `{ "<client>": ClientPolicy }`. */
  policies: "mcp/policies.json",
  /** Installer backups: `<host>-<timestamp>.bak`. */
  backups: "mcp/backups",
  /** Activity logs `<fileId>.jsonl` (last 500 per file). */
  activity: "activity",
  locks: "locks",
  recovery: "recovery",
} as const

/** Named pipe on Windows (per user). */
export const windowsPipeName = (user: string) => `\\\\.\\pipe\\kimo-${user}`

export interface EndpointFile {
  version: 1
  pid: number
  appVersion: string
  /** Socket path or pipe name. */
  socket: string
  socketProtocol: string
  /** Streamable HTTP endpoint (`http://127.0.0.1:<port>/mcp`), when enabled in Settings. */
  http?: { url: string; port: number }
  startedAtIso: string
}

/** Default localhost port (falls back to an ephemeral port, written to the endpoint file). */
export const DEFAULT_HTTP_PORT = 47_820
export const HTTP_PATH = "/mcp"

// --- docId -------------------------------------------------------------------------------------

/**
 * `docId` = `d_<pathHash>_<epoch>` (teardown 11.1): `pathHash` = first 16 hex chars of
 * SHA-256(canonical absolute path) — the same id as leases, recovery files and activity logs —
 * or the untitled id for `untitled:<id>`; `epoch` = the store epoch. Stable while open; a reload
 * (new epoch) makes it stale → DOCUMENT_NOT_OPEN with the current id in `detail.currentDocId`.
 */
export function formatDocId(pathHash: string, epoch: string): string {
  return `d_${pathHash}_${epoch}`
}

export function parseDocId(docId: string): { pathHash: string; epoch: string } | null {
  const m = /^d_([A-Za-z0-9]{1,32})_([A-Za-z0-9]{1,32})$/.exec(docId)
  return m ? { pathHash: m[1] as string, epoch: m[2] as string } : null
}

// --- Attach vs headless --------------------------------------------------------------------------

/** `kimo mcp` flags. */
export type McpModeFlag = "auto" | "attach" | "headless"

export interface ModeProbe {
  /** The endpoint file exists, its pid is alive and the socket accepted a hello. */
  appReachable: boolean
}

export type McpMode =
  | { mode: "attach" }
  | { mode: "headless" }
  /** `--attach` without a running app: serve tools/list, fail calls with APP_NOT_RUNNING. */
  | { mode: "unavailable"; reason: "APP_NOT_RUNNING" }

/**
 * Process-level decision when `kimo mcp` starts (and again on each reconnect attempt in auto):
 * - `auto` (default): attach when the app is reachable, else headless.
 * - `attach`: attach or report APP_NOT_RUNNING; never touches files.
 * - `headless`: never attaches.
 * The Rust shim is always `attach` (it never opens files, ADR 0008 §5); it can launch the app
 * with `--launch` and wait ≤ 15 s.
 */
export function decideMode(flag: McpModeFlag, probe: ModeProbe): McpMode {
  if (flag === "headless") return { mode: "headless" }
  if (probe.appReachable) return { mode: "attach" }
  return flag === "attach"
    ? { mode: "unavailable", reason: "APP_NOT_RUNNING" }
    : { mode: "headless" }
}

/** Lease holder as read from `~/.kimo/locks/<pathHash>.lock` (platform `LeaseHolder` subset). */
export interface LeaseView {
  pid: number
  app: string
  appLabel: string
  alive: boolean
  self: boolean
}

export type OpenDecision =
  | { action: "open-writable" }
  | { action: "open-read-only"; reason: "requested" | "locked" }
  | { action: "already-open" }
  | {
      action: "refuse"
      code: "DOCUMENT_LOCKED" | "PERMISSION_DENIED"
      holder?: LeaseView
      suggestion: string
    }

/**
 * Per-file decision for `kimo_open` in either mode (teardown 9.4 "single writer per file"):
 * - open already in this host → `already-open` (same docId; windows and agents share it);
 * - lease free or stale (dead pid) → take it, `open-writable`;
 * - live lease held by another process → `DOCUMENT_LOCKED` (detail.holder), unless the caller
 *   asked `readOnly: true` → `open-read-only`. Headless mode tells the agent to use the app when
 *   the holder is the desktop app; the app tells it the holder's label otherwise.
 */
export function decideOpen(input: {
  host: "desktop" | "headless"
  alreadyOpen: boolean
  readOnly: boolean
  holder: LeaseView | null
}): OpenDecision {
  if (input.alreadyOpen) return { action: "already-open" }
  if (input.readOnly) return { action: "open-read-only", reason: "requested" }
  const h = input.holder
  if (!h?.alive || h.self) return { action: "open-writable" }
  const suggestion =
    input.host === "headless" && h.app === "kimo-desktop"
      ? "The Kimo app has this file open. Connect through the app (kimo-mcp, or kimo mcp without --headless) to edit it, or pass readOnly: true."
      : `Held by ${h.appLabel} (pid ${h.pid}). Close it there, or pass readOnly: true.`
  return { action: "refuse", code: "DOCUMENT_LOCKED", holder: h, suggestion }
}

/** Headless save policy (ADR 0013 §8). */
export interface HeadlessOptions {
  /** Idle autosave in ms; 0 disables (then only kimo_save writes). Default 2000, like the app. */
  autosaveMs: number
  /** File allow-list globs (`--files`); default `<cwd>/**`. */
  allow: string[]
  /** On stdin EOF / SIGTERM with unsaved edits: flush autosave, else write a recovery file. */
  onExit: "save" | "recovery"
}

export const HEADLESS_DEFAULTS = (cwd: string): HeadlessOptions => ({
  autosaveMs: 2_000,
  allow: [`${cwd.replace(/\/$/, "")}/**`],
  onExit: "save",
})
