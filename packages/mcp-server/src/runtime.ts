/**
 * The runtime contract (ADR 0013 §5): what a tool handler receives, what the document host must
 * provide, and the one dispatcher every surface goes through (MCP server, M6 agent, CLI):
 *
 *   validate input → authorize (level, files, grants, destructive) → approval if needed →
 *   run handler with timeout → envelope → activity entry
 *
 * Handlers are implemented by the builders: `DocumentHost` once in the desktop document host
 * (hidden webview) and once headless (`kimo mcp`); tool handlers once, over `DocumentHost`.
 */
import type { DocStore } from "@kimo/editor-state"
import {
  type DocRef,
  failure,
  type RevisionToken,
  type ToolError,
  type ToolImage,
  type ToolResult,
} from "./envelope"
import { GLOBAL_OPS, isDestructive, type WireOp, type WireOpKind } from "./ops"
import {
  type ActivityEntry,
  APPROVAL_TIMEOUT_MS,
  type ApprovalOutcome,
  type ApprovalReason,
  type ApprovalRequest,
  type ClientIdentity,
  type ClientPolicy,
  coveredBySession,
  fileAllowed,
  levelAllows,
  outcomeError,
  rememberAllowance,
  type SessionAllowances,
} from "./policy"
import { type ToolName, toolByName } from "./registry"
import type { ToolDef } from "./tools/define"

// --- Document host -----------------------------------------------------------------------------

/** One open document as the tool layer sees it. */
export interface HostDocument {
  ref: DocRef
  /** The authoritative store (apply with origin = ctx.origin). */
  store: DocStore
  /** True when a UI window shows it (focus works). */
  shownInWindow: boolean
}

export type HostResult<T> = { ok: true; value: T } | { ok: false; error: ToolError }

/**
 * What the desktop document host and the headless host implement. Every method that targets a
 * document takes a docId and returns DOCUMENT_NOT_OPEN (with `detail.currentDocId` when the
 * path is open under a newer epoch) for unknown or stale ids. No method ever falls back to an
 * "active" document.
 */
export interface DocumentHost {
  readonly kind: "desktop" | "headless" | "web"
  list(): HostDocument[]
  get(docId: string): HostResult<HostDocument>
  /** Opens by absolute path per `decideOpen` (topology.ts). Never writes. */
  open(
    path: string,
    options: { readOnly: boolean },
  ): Promise<HostResult<HostDocument & { alreadyOpen: boolean }>>
  /** Creates a new file (FILE_EXISTS if present), atomically, then opens it. */
  create(
    path: string,
    options: { name?: string; template?: string },
  ): Promise<HostResult<HostDocument>>
  /** Drops the caller's reference; closes when no window/agent uses it. */
  close(
    docId: string,
    options: { save: boolean; discard: boolean },
  ): Promise<HostResult<{ closed: boolean; saved: boolean }>>
  /** Atomic save with read-back; `baseRevision` refuses a moved document. */
  save(
    docId: string,
    baseRevision?: RevisionToken,
  ): Promise<
    HostResult<{
      path: string
      bytes: number
      sha256: string
      mtimeMs: number
      savedRevision: RevisionToken
    }>
  >
  /** Headless CanvasKit raster of committed state (ADR 0009 `exportRaster`). */
  render(
    docId: string,
    ids: string[],
    options: {
      scale: number
      maxSize: number
      background?: string
      theme?: Record<string, string>
    },
  ): Promise<HostResult<ToolImage[]>>
  /** Window view only; `shown` false when no window shows the document. */
  focus(
    docId: string,
    ids: string[],
    options: { select: boolean; zoom: "fit" | "keep" | "100" },
  ): Promise<HostResult<{ shown: boolean }>>
  /** Selection of the frontmost window showing the document (empty headless). */
  selection(docId: string): string[]
  /** Reads a file the policy allowed (imports). */
  readFile(path: string): Promise<HostResult<Uint8Array>>
  /** Writes a file atomically with read-back (exports); FILE_EXISTS unless overwrite. */
  writeFile(
    path: string,
    bytes: Uint8Array,
    overwrite: boolean,
  ): Promise<HostResult<{ bytes: number; sha256: string }>>
  /** Resolves a path to its canonical absolute form (symlinks resolved) for allow-list checks. */
  canonicalPath(path: string): Promise<string>
}

// --- Context -----------------------------------------------------------------------------------

/** Per-connection state the dispatcher threads through every call. */
export interface ToolContext {
  identity: ClientIdentity
  /** `mcp:<client>.<session>` (or `agent:<id>` for the M6 agent). */
  origin: `mcp:${string}` | `agent:${string}`
  policy: ClientPolicy
  /** "Allow for this session" memory of this connection. */
  allowances: SessionAllowances
  host: DocumentHost
  /** Shows an approval prompt in the editor; resolves within APPROVAL_TIMEOUT_MS (else "timeout"). Headless: always "deny". */
  requestApproval(request: ApprovalRequest): Promise<ApprovalOutcome>
  /** Appends to the per-file activity log (and the UI feed). */
  recordActivity(entry: Omit<ActivityEntry, "seq">): void
  /** Aborted when the client cancels (`notifications/cancelled`) or disconnects. */
  signal: AbortSignal
  now(): number
  newId(): string
}

export interface HandlerOutput<T = unknown> {
  result: ToolResult<T>
  images?: ToolImage[]
}

export type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<HandlerOutput>
export type ToolHandlers = Record<ToolName, ToolHandler>

/** Every tool answering UNSUPPORTED: the starting point for builders and the `stub` status. */
export function createStubHandlers(): ToolHandlers {
  const stub: ToolHandler = async () => ({
    result: failure({ code: "UNSUPPORTED", message: "Not implemented yet." }),
  })
  return new Proxy({} as ToolHandlers, { get: () => stub })
}

// --- Authorization -----------------------------------------------------------------------------

export type Authorization =
  | { kind: "allow" }
  | { kind: "ask"; reason: ApprovalReason; path?: string }
  | { kind: "deny"; error: ToolError }

/** What the dispatcher knows about the call's targets (resolved before authorize). */
export interface CallTargets {
  /** Canonical path of the targeted document or file, when any. */
  path?: string
  /** True when `path` is a document already open in the host (opened by the user or allowed). */
  pathAlreadyOpen?: boolean
  /** Out-of-scope node ids (only when policy.nodes is non-empty). */
  outOfScope?: string[]
}

/**
 * Pure policy decision (teardown 11.3 scope rules, 11.4; ADR 0013 §6). Order: file → node scope
 * → level → grants → destructive. Any failing check with `onExceed: "deny"` denies outright.
 */
export function authorize(
  def: ToolDef,
  input: Record<string, unknown>,
  ctx: Pick<ToolContext, "policy" | "allowances">,
  targets: CallTargets = {},
): Authorization {
  const { policy, allowances } = ctx
  const askOrDeny = (reason: ApprovalReason, error: ToolError, path?: string): Authorization =>
    policy.onExceed === "ask"
      ? { kind: "ask", reason, ...(path ? { path } : {}) }
      : { kind: "deny", error }

  // 1. Files: never covered by session allowances (lead decision).
  if (targets.path && !targets.pathAlreadyOpen && !fileAllowed(targets.path, policy.files)) {
    const action =
      def.name === "kimo_create"
        ? "create"
        : def.name === "kimo_export"
          ? "export"
          : def.name === "kimo_save"
            ? "save"
            : "open"
    return askOrDeny(
      { kind: "file", path: targets.path, action },
      { code: "PERMISSION_DENIED", message: `${targets.path} is outside your file allow-list.` },
      targets.path,
    )
  }
  // 2. Node scope (spawned agents, M6): asks per call, never remembered.
  if (targets.outOfScope && targets.outOfScope.length > 0)
    return askOrDeny(
      { kind: "scope", nodeIds: targets.outOfScope },
      {
        code: "OUT_OF_SCOPE",
        message: "Edit outside your node scope.",
        nodeId: targets.outOfScope[0],
      },
    )
  // 3. Level.
  const need = def.scopeFor ? def.scopeFor(input as never) : def.scope
  const ops = Array.isArray(input.ops) ? (input.ops as WireOp[]) : []
  if (!levelAllows(policy.level, need)) {
    const reason: ApprovalReason =
      need === "delete" && ops.length
        ? { kind: "destructive", ops: destructiveKinds(ops), nodeIds: destructiveIds(ops) }
        : { kind: "level", need, have: policy.level }
    if (!coveredBySession(allowances, reason))
      return askOrDeny(reason, {
        code: "PERMISSION_DENIED",
        message: `Needs ${need} permission; you have ${policy.level}.`,
      })
  }
  // 4. Grants.
  const grants = new Set(policy.grants)
  const needGrant =
    def.grant ??
    (ops.some((o) => GLOBAL_OPS.has(o.op)) && policy.nodes.length ? "globals" : undefined)
  if (needGrant && !grants.has(needGrant)) {
    const reason: ApprovalReason = { kind: "grant", grant: needGrant }
    if (!coveredBySession(allowances, reason))
      return askOrDeny(reason, {
        code: "PERMISSION_DENIED",
        message: `Needs the ${needGrant} grant.`,
      })
  }
  // 5. Destructive confirmation even at edit+delete.
  if (policy.confirmDestructive && ops.some(isDestructive)) {
    const reason: ApprovalReason = {
      kind: "destructive",
      ops: destructiveKinds(ops),
      nodeIds: destructiveIds(ops),
    }
    if (!coveredBySession(allowances, reason))
      return askOrDeny(reason, {
        code: "PERMISSION_DENIED",
        message: "Destructive edit not allowed.",
      })
  }
  if (policy.confirmDestructive && def.name === "kimo_close" && input.discard === true) {
    const reason: ApprovalReason = { kind: "level", need: "delete", have: policy.level }
    if (!coveredBySession(allowances, reason))
      return askOrDeny(reason, {
        code: "PERMISSION_DENIED",
        message: "Discarding edits needs approval.",
      })
  }
  return { kind: "allow" }
}

function destructiveKinds(ops: WireOp[]): WireOpKind[] {
  return [...new Set(ops.filter(isDestructive).map((o) => o.op))]
}
function destructiveIds(ops: WireOp[]): string[] {
  return ops
    .filter(isDestructive)
    .map((o) => ("id" in o && typeof o.id === "string" ? o.id : ""))
    .filter(Boolean)
}

// --- Dispatcher --------------------------------------------------------------------------------

export interface DispatchOptions {
  /** Validates `input` against the tool's input schema (Ajv in the MCP server). */
  validate(def: ToolDef, input: unknown): ToolError[]
  /** Resolves call targets for authorization (paths canonicalized, scope checked). */
  targets(def: ToolDef, input: Record<string, unknown>, ctx: ToolContext): Promise<CallTargets>
}

/** Runs one tool call end to end. Never throws: everything becomes an envelope. */
export async function dispatch(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
  handlers: ToolHandlers,
  options: DispatchOptions,
): Promise<HandlerOutput> {
  const def = toolByName(name)
  if (!def) return { result: failure({ code: "INVALID_INPUT", message: `Unknown tool ${name}.` }) }
  const input = (rawInput ?? {}) as Record<string, unknown>
  const invalid = options.validate(def, input)
  if (invalid.length) return { result: failure(invalid) }

  const targets = await options.targets(def, input, ctx)
  const auth = authorize(def, input, ctx, targets)
  if (auth.kind === "deny") {
    ctx.recordActivity({
      time: ctx.now(),
      origin: ctx.origin,
      actor: ctx.identity.label,
      kind: "denied",
      tool: name,
      summary: auth.error.message,
      code: auth.error.code,
    })
    return { result: failure(auth.error) }
  }
  if (auth.kind === "ask") {
    const now = ctx.now()
    const request: ApprovalRequest = {
      id: ctx.newId(),
      client: ctx.identity,
      tool: name,
      ...(auth.path ? { path: auth.path } : {}),
      reason: auth.reason,
      summary: summarizeReason(def, auth.reason),
      requestedAt: now,
      expiresAt: now + APPROVAL_TIMEOUT_MS,
    }
    const outcome = await ctx.requestApproval(request)
    ctx.recordActivity({
      time: ctx.now(),
      origin: ctx.origin,
      actor: ctx.identity.label,
      kind: "approval",
      tool: name,
      summary: request.summary,
      outcome,
    })
    if (outcome !== "once" && outcome !== "session")
      return { result: failure(outcomeError(outcome)) }
    if (outcome === "session") rememberAllowance(ctx.allowances, auth.reason)
  }

  const handler = handlers[def.name as ToolName]
  try {
    return await withTimeout(handler(input, ctx), def.timeoutMs, ctx.signal)
  } catch (e) {
    if (e instanceof TimeoutError)
      return {
        result: failure({
          code: "TIMEOUT",
          message: `${name} took longer than ${def.timeoutMs} ms.`,
          retryable: true,
        }),
      }
    return {
      result: failure({ code: "INTERNAL", message: e instanceof Error ? e.message : String(e) }),
    }
  }
}

function summarizeReason(def: ToolDef, r: ApprovalReason): string {
  switch (r.kind) {
    case "destructive":
      return `${def.title}: ${r.ops.join(", ")}${r.nodeIds.length ? ` on ${r.nodeIds.length} node(s)` : ""}`
    case "file":
      return `${r.action} ${r.path}`
    case "level":
      return `${def.title} needs ${r.need} permission`
    case "grant":
      return `${def.title} needs the ${r.grant} grant`
    case "scope":
      return `${def.title} outside its area (${r.nodeIds.length} node(s))`
  }
}

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError()), ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new Error("Cancelled by the client."))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    p.then(
      (v) => {
        clearTimeout(t)
        signal.removeEventListener("abort", onAbort)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        signal.removeEventListener("abort", onAbort)
        reject(e)
      },
    )
  })
}
