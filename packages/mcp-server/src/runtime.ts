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
import { claimGate, landClaims } from "./claims"
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
  approvedOutcome,
  autoApproveRefusal,
  autoApproves,
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
import { type RetryEdit, RetryStore } from "./retry"
import { SCRIPT_PLAN, type ScriptPlan, scriptCompilerOf, scriptLine } from "./script/plan"
import type { ApplyStream } from "./stream"
import type { ToolDef } from "./tools/define"

// --- Document host -----------------------------------------------------------------------------

/**
 * Path prefix of a room joined from a share link (`kimo-room:<room>`): a document with no file
 * that syncs live with the people in the room (desktop document host, #79).
 */
export const ROOM_PATH_PREFIX = "kimo-room:"

/** True for the path of a room joined from a share link. */
export const isRoomPath = (path: string): boolean => path.startsWith(ROOM_PATH_PREFIX)

/** A view link takes no edits and makes no .kimo copy, like a viewer in the app (board 41). */
export const VIEW_ROOM_SUGGESTION =
  "Ask the owner for an edit link. A view link can export code or PNG, not a .kimo copy."

/**
 * What an agent learns about a room joined from a share link. Never the link, its token or the
 * room key: those stay in the window that joined it.
 */
export interface SharedRoomInfo {
  /** Host of the relay the room syncs through (`relay.getkimo.design`), null when unknown. */
  relay: string | null
  /** The link's role: `view` refuses edits (READ_ONLY). */
  role: "edit" | "view"
}

/** One open document as the tool layer sees it. */
export interface HostDocument {
  ref: DocRef
  /** The authoritative store (apply with origin = ctx.origin). */
  store: DocStore
  /** True when a UI window shows it (focus works). */
  shownInWindow: boolean
  /** Set for a room joined from a share link (path `kimo-room:<room>`). */
  shared?: SharedRoomInfo
  /**
   * Bytes of `./assets/<key>` for a document with no folder on disk (a room's assets live in the
   * window that joined it). Absent: assets are read beside the file.
   */
  readAsset?(src: string): Promise<Uint8Array | null>
}

export type HostResult<T> = { ok: true; value: T } | { ok: false; error: ToolError }

/**
 * One window's editor tab as the host last heard it (#78 target resolution). Times are host
 * clock stamps: `selectionAt` a person selection change, `viewAt` a pan, zoom or page change,
 * `attentionAt` a mount, a tab activation or a window focus gain.
 */
export interface WindowView {
  /** Window label. */
  window: string
  /** The served document it shows (a file or a joined room); null when the host does not serve it. */
  docId: string | null
  kind: "disk" | "room" | "library" | "none"
  /** The window's current tab (its editor is mounted). */
  active: boolean
  focused: boolean
  selection: string[]
  /** `agent` when kimo_focus made the selection: it never counts as the person pointing. */
  selectionBy: "person" | "agent"
  /** Page shown; null for the first page. */
  page: string | null
  /** World rectangle of the view. */
  view: { x: number; y: number; w: number; h: number } | null
  selectionAt: number
  viewAt: number
  attentionAt: number
}

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
  /** Newest person selection among the windows showing the document (empty headless). */
  selection(docId: string): string[]
  /** Editor tabs of the windows (#78); absent or [] headless. */
  views?(): WindowView[]
  /**
   * The next person selection in a served document (`docId` when given), non-empty, once it
   * settled for 500 ms. Null after `ms` or when `signal` aborts.
   */
  waitForSelection?(
    docId: string | null,
    ms: number,
    signal: AbortSignal,
  ): Promise<{ docId: string; ids: string[] } | null>
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
  /**
   * The provisional stream of this call (ADR 0013 §4.7): set when the caller streamed the
   * tool input; `kimo_apply_ops` commits or rolls it back. The caller closes it after dispatch.
   */
  stream?: ApplyStream
  /** The caller streams tool input (built-in agent, Claude Code via the window): the batch limit is STREAM_MAX_NEW_LAYERS. */
  streamed?: boolean
  /** The agent's current turn (claims taken during it carry it; ADR 0016 item 16). */
  turn?: string
  /**
   * MCP elicitation (#78): `can` when this client may be shown a picker. A re-entered round
   * carries the client's `responses` and the verified `state`; `signal` aborts with the request.
   */
  ask?: { can: boolean; responses?: Record<string, unknown>; state?: unknown; signal: AbortSignal }
}

export interface HandlerOutput<T = unknown> {
  result: ToolResult<T>
  images?: ToolImage[]
  /** Op group label of an edit (activity log only; never sent to the client). */
  label?: string
  /**
   * Ask the person to pick (#78): the MCP server sends it as an elicitation and runs the call
   * again with the answer. `result` stays the answer for a caller that cannot ask.
   */
  ask?: {
    message: string
    title: string
    options: { value: string; label: string }[]
    state: unknown
  }
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
  /** The call is refused before authorization (#78 twin guard: TARGET_UNCLEAR). */
  unclear?: ToolError
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
  /** Runs before validation; a paused client waits here until resumed (or disconnected). */
  beforeCall?(def: ToolDef, ctx: ToolContext): Promise<void>
  /** Dry-run preview for an approval prompt (op kind per node); failures leave it out. */
  preview?(
    def: ToolDef,
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ApprovalRequest["preview"] | undefined>
}

/** Patch-retry handles of failed kimo_apply_ops / kimo_script calls (ADR 0013 §4.8), per origin. */
export const RETRIES = new RetryStore()

/** Failures a retry cannot fix by editing the call (permissions, host state, timeouts). */
const NOT_RETRYABLE = new Set([
  "PERMISSION_DENIED",
  "OUT_OF_SCOPE",
  "AREA_BUSY",
  "READ_ONLY",
  "DOCUMENT_NOT_OPEN",
  "TIMEOUT",
  "INTERNAL",
  "UNSUPPORTED",
  "TARGET_UNCLEAR",
  "CANCELLED",
])

/** Runs one tool call end to end. Never throws: everything becomes an envelope. */
export async function dispatch(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
  handlers: ToolHandlers,
  options: DispatchOptions,
): Promise<HandlerOutput> {
  let input = (rawInput ?? {}) as Record<string, unknown>
  if (name !== "kimo_apply_ops" && name !== "kimo_script")
    return dispatchOnce(name, input, ctx, handlers, options)
  if (typeof input.retryId === "string") {
    // The retry call itself must be well formed before its edits are applied.
    const def = toolByName(name) as ToolDef
    const invalid = options.validate(def, input)
    if (invalid.length) return { result: failure(invalid) }
    const edits = Array.isArray(input.edits) ? (input.edits as RetryEdit[]) : []
    const p = RETRIES.patch(
      ctx.origin,
      input.retryId,
      edits,
      name === "kimo_script" ? "code" : undefined,
    )
    if (!p.ok) return { result: failure(p.error) }
    input = p.input
  }
  const out = await dispatchOnce(name, input, ctx, handlers, options)
  const r = out.result
  if (!r.ok && !r.errors.some((e) => NOT_RETRYABLE.has(e.code))) {
    const id = RETRIES.put(ctx.origin, input)
    if (id) return { ...out, result: { ...r, retryId: id } }
  }
  return out
}

async function dispatchOnce(
  name: string,
  rawInput: Record<string, unknown>,
  ctx: ToolContext,
  handlers: ToolHandlers,
  options: DispatchOptions,
): Promise<HandlerOutput> {
  let input = rawInput
  const def = toolByName(name)
  if (!def) return { result: failure({ code: "INVALID_INPUT", message: `Unknown tool ${name}.` }) }
  if (options.beforeCall) {
    await options.beforeCall(def, ctx)
    if (ctx.signal.aborted)
      return {
        result: failure({ code: "TIMEOUT", message: "The connection closed.", retryable: true }),
      }
  }
  const invalid = options.validate(def, input)
  if (invalid.length) return { result: failure(invalid) }

  // kimo_script (ADR 0013 addendum 7): run the script first, then validate and authorize the
  // kimo_apply_ops call it compiles to, so approvals, scopes and limits see the real ops.
  let authDef = def
  let authInput = input
  let plan: ScriptPlan | undefined
  if (name === "kimo_script") {
    const compile = scriptCompilerOf(handlers)
    // A client that may not edit at all is refused before its code runs.
    const pre = authorize(def, input, ctx, {})
    if (compile && pre.kind === "deny") return { result: failure(pre.error) }
    if (compile) {
      let c: Awaited<ReturnType<typeof compile>>
      try {
        c = await compile(input, ctx)
      } catch (e) {
        return {
          result: failure({
            code: "INTERNAL",
            message: `The script could not run: ${e instanceof Error ? e.message : String(e)}`,
          }),
        }
      }
      if (!c.ok) return c.output
      plan = c.plan
      authDef = toolByName("kimo_apply_ops") as ToolDef
      authInput = plan.call
      // A script that only read and printed compiles to no ops: nothing to validate.
      const bad = (plan.call.ops as unknown[]).length ? options.validate(authDef, authInput) : []
      if (bad.length) {
        plan.dispose()
        const lines = plan.lines
        return { result: failure(bad.slice(0, 5).map((e) => scriptLine(e, lines))) }
      }
      input = Object.defineProperty({ ...input }, SCRIPT_PLAN, { value: plan, enumerable: false })
    }
  }
  try {
    return await authorizeAndRun(name, def, authDef, authInput, input, ctx, handlers, options)
  } finally {
    plan?.dispose()
  }
}

async function authorizeAndRun(
  name: string,
  def: ToolDef,
  authDef: ToolDef,
  authInput: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolContext,
  handlers: ToolHandlers,
  options: DispatchOptions,
): Promise<HandlerOutput> {
  const targets = await options.targets(authDef, authInput, ctx)
  // A write to an unclear target (#78 twin guard) is refused before anyone is asked to approve.
  if (targets.unclear) return { result: failure(targets.unclear) }
  const auth = authorize(authDef, authInput, ctx, targets)
  const denied = (error: ToolError): HandlerOutput => {
    ctx.recordActivity({
      time: ctx.now(),
      origin: ctx.origin,
      actor: ctx.identity.label,
      kind: "denied",
      tool: name,
      summary: error.message,
      code: error.code,
    })
    return { result: failure(error) }
  }
  if (auth.kind === "deny") return denied(auth.error)
  // Agent area claims (ADR 0016 item 16): refused before anyone is asked to approve.
  const gate = claimGate(authDef, authInput, ctx)
  const early = gate?.check()
  if (gate && early) {
    gate.told(early)
    return denied(early)
  }
  if (auth.kind === "ask") {
    const now = ctx.now()
    // Auto-approve (board 34): no prompt, no dry run; the approval is still logged. It never
    // widens Read only or reaches system and hidden folders (ADR 0013 Addendum 8).
    const auto = autoApproves(ctx.policy)
    const refusal = auto ? autoApproveRefusal(ctx.policy, auth.reason) : null
    if (refusal) return denied(refusal)
    const preview =
      options.preview && !auto
        ? await options.preview(authDef, authInput, ctx).catch(() => undefined)
        : undefined
    const request: ApprovalRequest = {
      id: ctx.newId(),
      client: ctx.identity,
      tool: name,
      ...(auth.path ? { path: auth.path } : {}),
      reason: auth.reason,
      summary: summarizeReason(def, auth.reason),
      ...(preview ? { preview } : {}),
      requestedAt: now,
      expiresAt: now + APPROVAL_TIMEOUT_MS,
    }
    const outcome: ApprovalOutcome = auto ? "auto" : await ctx.requestApproval(request)
    ctx.recordActivity({
      time: ctx.now(),
      origin: ctx.origin,
      actor: ctx.identity.label,
      kind: "approval",
      tool: name,
      summary: request.summary,
      outcome,
    })
    if (!approvedOutcome(outcome)) return { result: failure(outcomeError(outcome)) }
    if (outcome === "session") rememberAllowance(ctx.allowances, auth.reason)
  }
  // Another agent may have claimed the area while the approval waited: check and claim at once.
  const late = gate?.take()
  if (late) return denied(late)

  const handler = handlers[def.name as ToolName]
  try {
    const out = await withTimeout(handler(input, ctx), def.timeoutMs, ctx.signal)
    if (gate) landClaims(authDef, authInput, ctx, out.result)
    return out
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
