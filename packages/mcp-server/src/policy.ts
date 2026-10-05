/**
 * Permissions, approvals, activity and presence for MCP clients (teardown 11.3 scope rules,
 * 11.4; ADR 0013 §6). Pure types and decision functions: the document host enforces them, the
 * editor UI renders them (apps/web/src/platform/contract.ts "M5 agents"), and the M6 built-in
 * agent reuses them for spawned children.
 *
 * Model:
 * - Every connection has a {@link ClientIdentity} and an origin `mcp:<client>.<session>`, so each
 *   connection has its own undo stack and every op group is attributed.
 * - A {@link ClientPolicy} gives a permission level (`read` < `edit` < `edit+delete`), a file
 *   allow-list, optional node scope and grants. Defaults come from Settings › Agents per client
 *   name; unknown clients get {@link DEFAULT_POLICY}.
 * - A call that needs more than the policy allows is either refused (`PERMISSION_DENIED` /
 *   `OUT_OF_SCOPE`) or, when the policy says `ask`, turned into an {@link ApprovalRequest}
 *   shown in the editor. No answer within {@link APPROVAL_TIMEOUT_MS} → `PERMISSION_DENIED`.
 * - "Allow for this session" remembers the approved **op kinds** for that connection only. It
 *   never widens file access: a file outside the allow-list asks every time ("allow once").
 */

// --- Identity ----------------------------------------------------------------------------------

/** Known agent hosts (installer targets). Others are `other`. */
export const KNOWN_CLIENTS = ["claude-code", "codex", "gemini-cli", "cursor", "vscode"] as const
export type KnownClient = (typeof KNOWN_CLIENTS)[number]

export interface ClientIdentity {
  /** Slug: `[a-z0-9-]{1,32}`. From the shim's `--client` flag, else MCP `clientInfo.name` slugified. */
  client: string
  /** Display name ("Claude Code"). */
  label: string
  /** MCP clientInfo.version when given. */
  version?: string
  /** Per-connection id (6 base-36 chars), minted by the document host at handshake. */
  session: string
  /** Transport the client used. */
  transport: "socket" | "http" | "stdio-headless" | "in-process"
  /** Peer process id when known (socket: from the shim's hello). */
  pid?: number
}

const SLUG_RE = /[^a-z0-9-]+/g

/** `"Claude Code"` → `"claude-code"`; empty → `"client"`. */
export function clientSlug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(SLUG_RE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
  return s || "client"
}

/** The editor-state origin of a connection: `mcp:<client>.<session>`. */
export function originOf(id: Pick<ClientIdentity, "client" | "session">): `mcp:${string}` {
  return `mcp:${id.client}.${id.session}`
}

/** Parses an origin back into client and session (null for non-MCP origins). */
export function parseMcpOrigin(origin: string): { client: string; session: string } | null {
  const m = /^mcp:([a-z0-9-]{1,32})\.([a-z0-9]{1,16})$/.exec(origin)
  return m ? { client: m[1] as string, session: m[2] as string } : null
}

// --- Permission levels and grants ---------------------------------------------------------------

/** Ordered permission levels (Settings › Agents "Can read / Can edit / Can edit and delete"). */
export const PERMISSION_LEVELS = ["read", "edit", "edit+delete"] as const
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number]

/** What a tool call needs at minimum. `save` is coordinator-only for spawned agents (M6). */
export type RequiredScope = "read" | "edit" | "delete"

/** Extra grants (teardown 11.3 scope rules). */
export const GRANTS = ["globals", "components", "save", "export", "files.create"] as const
export type Grant = (typeof GRANTS)[number]

/** What happens when a call exceeds the policy. */
export type EscalationMode = "ask" | "deny"

export interface ClientPolicy {
  level: PermissionLevel
  /**
   * Absolute paths or globs (`/repo/design/**`, `**` = any) of files the client may open and
   * act on. Empty = only files already open in the app.
   */
  files: string[]
  /** Optional node scope: union of these subtrees (spawned agents; M6). Empty = whole document. */
  nodes: string[]
  grants: Grant[]
  /** On exceeding level / files / grants: ask the user or deny outright. */
  onExceed: EscalationMode
  /** Destructive ops ask even when `level` is `edit+delete`. */
  confirmDestructive: boolean
  /**
   * Auto-approve (board 34): every approval this policy would ask for (`onExceed: "ask"`) is
   * approved at once with outcome `auto` and recorded in the activity log. Hard limits that are
   * errors, not prompts (batch size, path checks, read-only, `onExceed: "deny"`), still apply.
   * Additive; absent = false.
   */
  autoApprove?: boolean
}

/** Unknown clients: can edit open documents, destructive ops and other files ask. */
export const DEFAULT_POLICY: ClientPolicy = {
  level: "edit",
  files: [],
  nodes: [],
  grants: ["globals", "components", "save", "export"],
  onExceed: "ask",
  confirmDestructive: true,
}

/** Headless `kimo mcp` defaults (no UI to ask): explicit files only, destructive allowed. */
export const HEADLESS_POLICY: ClientPolicy = {
  level: "edit+delete",
  files: [],
  nodes: [],
  grants: ["globals", "components", "save", "export", "files.create"],
  onExceed: "deny",
  confirmDestructive: false,
}

export function levelAllows(level: PermissionLevel, need: RequiredScope): boolean {
  if (need === "read") return true
  if (need === "edit") return level !== "read"
  return level === "edit+delete"
}

// --- Approvals ---------------------------------------------------------------------------------

/** Lead decision (ADR 0013 §6): unanswered prompts deny after 2 minutes. */
export const APPROVAL_TIMEOUT_MS = 120_000

/** Why the call needs a person. */
export type ApprovalReason =
  /** `ops`: wire op kinds (WireOpKind names; plain strings so @kimo/platform can mirror it). */
  | { kind: "destructive"; ops: string[]; nodeIds: string[] }
  | { kind: "level"; need: RequiredScope; have: PermissionLevel }
  | { kind: "file"; path: string; action: "open" | "create" | "export" | "save" }
  | { kind: "grant"; grant: Grant }
  | { kind: "scope"; nodeIds: string[] }

export interface ApprovalRequest {
  id: string
  client: ClientIdentity
  tool: string
  /** Document path when the call targets one. */
  path?: string
  reason: ApprovalReason
  /** One line for the prompt ("Delete 3 layers in Hero"). */
  summary: string
  /** Optional dry-run preview: counts, the first changed ids and the op kind per id. */
  preview?: ApprovalPreview
  requestedAt: number
  /** requestedAt + APPROVAL_TIMEOUT_MS. */
  expiresAt: number
}

/** What a node would undergo if the call ran (moves count as updates). */
export type PreviewOpKind = "insert" | "update" | "delete"

export interface ApprovalPreview {
  inserted: number
  updated: number
  deleted: number
  nodeIds: string[]
  /** Op kind per entry of `nodeIds`. */
  kinds?: Record<string, PreviewOpKind>
}

/** The three buttons. `session` is offered only when {@link sessionAllowable}. */
export type ApprovalChoice = "once" | "session" | "deny"

/** `auto`: approved by auto-approve (the client's policy or the agent session), nobody asked. */
export type ApprovalOutcome = ApprovalChoice | "auto" | "timeout" | "disconnected"

/** True for the outcomes that let the call run. */
export function approvedOutcome(o: ApprovalOutcome): o is "once" | "session" | "auto" {
  return o === "once" || o === "session" || o === "auto"
}

/** True when a policy turns its approval prompts into automatic approvals. */
export function autoApproves(policy: Pick<ClientPolicy, "autoApprove" | "onExceed">): boolean {
  return policy.autoApprove === true && policy.onExceed === "ask"
}

/**
 * "Always for this session" covers op kinds (destructive / level) only, never file access or
 * node scope (lead decision): those are approved once per call.
 */
export function sessionAllowable(reason: ApprovalReason): boolean {
  return reason.kind === "destructive" || reason.kind === "level" || reason.kind === "grant"
}

/** What a connection remembers after "Allow for this session". */
export interface SessionAllowances {
  ops: Set<string>
  levels: Set<RequiredScope>
  grants: Set<Grant>
}

export const emptyAllowances = (): SessionAllowances => ({
  ops: new Set(),
  levels: new Set(),
  grants: new Set(),
})

/** Records a `session` choice. File/scope reasons are ignored by design. */
export function rememberAllowance(a: SessionAllowances, reason: ApprovalReason): void {
  if (reason.kind === "destructive") for (const k of reason.ops) a.ops.add(k)
  else if (reason.kind === "level") a.levels.add(reason.need)
  else if (reason.kind === "grant") a.grants.add(reason.grant)
}

/** True when an earlier session allowance already covers `reason`. */
export function coveredBySession(a: SessionAllowances, reason: ApprovalReason): boolean {
  switch (reason.kind) {
    case "destructive":
      return reason.ops.every((k) => a.ops.has(k))
    case "level":
      return a.levels.has(reason.need)
    case "grant":
      return a.grants.has(reason.grant)
    default:
      return false
  }
}

/** Error the tool returns for each outcome other than once/session. */
export function outcomeError(o: Exclude<ApprovalOutcome, "once" | "session" | "auto">): {
  code: "PERMISSION_DENIED"
  message: string
  retryable: boolean
} {
  if (o === "timeout")
    return {
      code: "PERMISSION_DENIED",
      message: "No one answered the approval prompt within 2 minutes.",
      retryable: false,
    }
  if (o === "disconnected")
    return { code: "PERMISSION_DENIED", message: "The editor closed the prompt.", retryable: true }
  return { code: "PERMISSION_DENIED", message: "The user denied this action.", retryable: false }
}

// --- File allow-list ---------------------------------------------------------------------------

/** Minimal glob: `**` any path, `*` one segment. Paths are absolute, `/`-separated. */
export function fileAllowed(path: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(path))
}

function globToRegExp(glob: string): RegExp {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*"
        i++
      } else re += "[^/]*"
    } else re += /[.+^${}()|[\]\\?]/.test(c) ? `\\${c}` : c
  }
  return new RegExp(`^${re}$`)
}

// --- Activity log ------------------------------------------------------------------------------

/** Lead decision: the last 500 entries per file, stored outside the `.kimo`. */
export const ACTIVITY_LIMIT = 500

/**
 * Where entries live: desktop `~/.kimo/activity/<fileId>.jsonl` (append-only JSON lines, trimmed
 * to the last {@link ACTIVITY_LIMIT} on open), web IndexedDB store `kimo-activity` keyed by
 * fileId. `fileId` = `sha256(path)[:16]` (same id as leases and recovery files), or
 * `untitled-<docId>`.
 */
export const ACTIVITY_DIR = "activity"

export type ActivityKind =
  | "connected"
  | "disconnected"
  | "read"
  | "edit"
  | "dry-run"
  | "undo"
  | "redo"
  | "save"
  | "export"
  | "render"
  | "open"
  | "close"
  | "approval"
  | "denied"
  | "error"

export interface ActivityEntry {
  /** Monotonic per file. */
  seq: number
  time: number
  /** `mcp:<client>.<session>`, `user`, `agent:<id>`. */
  origin: string
  /** Display name of the client ("Claude Code"). */
  actor: string
  kind: ActivityKind
  tool?: string
  /** Op group label or summary ("Insert Hero (4 nodes)"). */
  summary: string
  /** Revision after the call, for edits. */
  revision?: { epoch: string; seq: number }
  nodeIds?: string[]
  /** Error code for `error`/`denied`. */
  code?: string
  /** For `approval`: the outcome. */
  outcome?: ApprovalOutcome
  /** Undo token of the op group (edits), so the UI can offer "Undo agent edit". */
  undoToken?: string
  /** Op group label ("Insert Card"); edits only. */
  label?: string
  /** Resolved ops the call committed (edits / dry runs). */
  opCount?: number
  /** Revision before the call, for edits. */
  revisionBefore?: { epoch: string; seq: number }
}

/** Keeps the newest {@link ACTIVITY_LIMIT} entries. */
export function trimActivity(entries: readonly ActivityEntry[]): ActivityEntry[] {
  return entries.length > ACTIVITY_LIMIT
    ? entries.slice(entries.length - ACTIVITY_LIMIT)
    : [...entries]
}

// --- Presence ----------------------------------------------------------------------------------

/** One connected client as the editor shows it (agent chip + optional canvas cursor). */
export interface AgentPresence {
  identity: ClientIdentity
  origin: string
  /** Documents the client touched this session (docIds). */
  docs: string[]
  /** Nodes it is editing or last changed (for the canvas "agent" highlight). */
  focus: string[]
  /**
   * Board 31 "Agent cursor": the layer its pointer points at, the last layer its latest landed
   * edit added (or changed). Reads never move it; absent until the first edit lands.
   */
  pointer?: string
  /** What it is doing right now (tool running), or idle. */
  state: "idle" | "reading" | "editing" | "rendering" | "waiting-approval"
  /** The running call (absent when idle). */
  call?: { tool: string; label: string; startedAt: number }
  /** Paused by the user: calls wait until resumed. */
  paused?: boolean
  connectedAt: number
  lastActivityAt: number
  policy: ClientPolicy
}
