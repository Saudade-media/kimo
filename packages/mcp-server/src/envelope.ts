/**
 * The common result envelope (teardown 11.2, ADR 0013 §4). Every tool returns exactly one
 * {@link ToolResult}; the MCP adapter puts it in `structuredContent` (validated against the
 * tool's `outputSchema`), adds a one-paragraph text `summary` as the first content block for
 * hosts that ignore structured content, appends render images, and sets `isError` when
 * `ok` is false. Results are never prose-only.
 */
import Type from "typebox"
import {
  AnyOf,
  Arr,
  Bool,
  Enum,
  Int,
  Obj,
  Open,
  Opt,
  type Static,
  Str,
  Tag,
  type TSchema,
  toJsonSchema,
} from "./schema"

// --- Revisions ---------------------------------------------------------------------------------

/** Optimistic-concurrency token (editor-state `Revision`; teardown 11.1). */
export const RevisionSchema = Obj(
  {
    epoch: Str({ description: "Random id minted when the document was (re)loaded.", minLength: 1 }),
    seq: Int({ description: "Commits since the epoch began.", minimum: 0 }),
  },
  { description: "Opaque revision token {epoch, seq}. Pass back verbatim as baseRevision." },
)
export type RevisionToken = Static<typeof RevisionSchema>

// --- Errors ------------------------------------------------------------------------------------

/**
 * Error codes (teardown 11.2 initial list + ADR 0002 `retryable` + ADR 0013 additions).
 * Stable strings; agents branch on them.
 */
export const ERROR_CODES = [
  "DOCUMENT_NOT_OPEN",
  "DOCUMENT_LOCKED",
  "LOAD_FAILED",
  "READ_ONLY",
  "REVISION_CONFLICT",
  "NODE_NOT_FOUND",
  "NODE_EXISTS",
  "INVALID_PROPERTY",
  "INVALID_INPUT",
  "SCHEMA_VIOLATION",
  "OUT_OF_SCOPE",
  "INSTANCE_STRUCTURE",
  "CYCLE",
  "ASSET_NOT_FOUND",
  "FILE_EXISTS",
  "FILE_NOT_FOUND",
  "TIMEOUT",
  "PERMISSION_DENIED",
  "APP_NOT_RUNNING",
  "PROTOCOL_MISMATCH",
  "UNSUPPORTED",
  "RATE_LIMITED",
  "INTERNAL",
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

/** Codes a client may retry unchanged after a short wait (ADR 0002 host restart, lease churn). */
export const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "TIMEOUT",
  "RATE_LIMITED",
  "APP_NOT_RUNNING",
])

export const ToolErrorSchema = Obj({
  code: Enum(ERROR_CODES, { description: "Stable error code (see kimo://docs/errors)." }),
  message: Str({ description: "What went wrong, for the agent." }),
  path: Opt(Str({ description: "Input location, e.g. ops[3].id." })),
  nodeId: Opt(Str({ description: "Node the error is about." })),
  suggestion: Opt(Str({ description: "How to fix or what to call next." })),
  retryable: Opt(Bool({ description: "True when the same call may succeed later unchanged." })),
  detail: Opt(
    Open(
      { kind: Str({ description: "Detail discriminator (revision, lock, plan, schema)." }) },
      {
        description:
          "Code-specific detail: REVISION_CONFLICT {current, changed[]}; DOCUMENT_NOT_OPEN {currentDocId?}; DOCUMENT_LOCKED {holder}; SCHEMA_VIOLATION {issue}.",
      },
    ),
  ),
})
export interface ToolError {
  code: ErrorCode
  message: string
  path?: string
  nodeId?: string
  suggestion?: string
  retryable?: boolean
  detail?: { kind: string } & Record<string, unknown>
}

export const WarningSchema = Obj({
  code: Str({ description: "Warning code (lint code such as TEXT_NO_FILL, or a host code)." }),
  message: Str({ description: "Explanation." }),
  nodeId: Opt(Str({ description: "Node the warning is about." })),
  fix: Opt(Str({ description: "Suggested fix." })),
})
export type ToolWarning = Static<typeof WarningSchema>

// --- Document reference ------------------------------------------------------------------------

export const DocRefSchema = Obj(
  {
    id: Str({ description: "docId: d_<hash(path)>_<epoch>. Changes when the file is reloaded." }),
    path: Str({ description: "Canonical absolute path, or untitled:<id>." }),
    dirty: Bool({ description: "Unsaved edits exist." }),
    readOnly: Bool({ description: "Edits are refused (READ_ONLY)." }),
    lastSavedRevision: Opt(RevisionSchema),
  },
  { description: "The document the call acted on." },
)
export type DocRef = Static<typeof DocRefSchema>

export const RevisionChangeSchema = Obj(
  { before: RevisionSchema, after: RevisionSchema },
  { description: "Revision before and after the call (equal for reads and dry runs)." },
)

// --- Envelope ----------------------------------------------------------------------------------

/** Fields every success carries in addition to the tool-specific `data`. */
export interface ToolSuccess<T> {
  ok: true
  /** One or two sentences for hosts that only show text. */
  summary: string
  doc?: DocRef
  revision?: { before: RevisionToken; after: RevisionToken }
  /** Mutating tools: normalized forward ops (editor-state `NormalizedOp`). */
  ops?: Record<string, unknown>[]
  /** Informational inverse ops against `revision.after`; undo via kimo_history. */
  inverse?: Record<string, unknown>[]
  /** Created nodes: `key` is the op's `key` (or the node name), `id` the new node id. */
  created?: { key: string; id: string }[]
  /** Node ids touched (inserted, updated, moved, deleted). */
  changed?: string[]
  /** Opaque token for kimo_history {action:"undo", token}: undoes exactly this group. */
  undoToken?: string
  dryRun?: boolean
  warnings: ToolWarning[]
  data: T
}

export interface ToolFailure {
  ok: false
  summary: string
  errors: ToolError[]
  /** Nothing was committed. Always true for Kimo tools (atomic). */
  rolledBack: true
  /** Current revision when known, so the agent can re-read and retry. */
  revision?: { before: RevisionToken; after: RevisionToken }
  /** kimo_script only: retry handle for {retryId, edits}. */
  retryId?: string
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure

/**
 * Output schema for a tool: the envelope with `data` typed per tool. `anyOf` of the success and
 * failure shapes, both closed. MCP `outputSchema` must be an object schema at the root, so the
 * union lives inside one object with `ok` as discriminator and optional members.
 */
export function envelopeSchema<T extends TSchema>(data: T, opts: { mutating: boolean }) {
  const mutating: Record<string, TSchema> = opts.mutating
    ? {
        ops: Opt(
          Arr(
            Open(
              { op: Str({ description: "Op kind." }) },
              { description: "Normalized editor-state op." },
            ),
            { description: "Normalized forward ops." },
          ),
        ),
        inverse: Opt(
          Arr(
            Open(
              { op: Str({ description: "Op kind." }) },
              { description: "Normalized editor-state op." },
            ),
            { description: "Informational inverse ops (undo via kimo_history)." },
          ),
        ),
        created: Opt(
          Arr(
            Obj({
              key: Str({ description: "The op's key, or the node name when no key was given." }),
              id: Str({ description: "New node id." }),
            }),
            { description: "Nodes created by the call." },
          ),
        ),
        changed: Opt(
          Arr(Str({ description: "Node id." }), { description: "Node ids touched by the call." }),
        ),
        undoToken: Opt(
          Str({ description: "Pass to kimo_history undo to revert exactly this call." }),
        ),
        dryRun: Opt(Bool({ description: "True when nothing was committed on purpose." })),
      }
    : {}
  return Obj(
    {
      ok: Bool({
        description: "True on success; false means errors[] is set and nothing changed.",
      }),
      summary: Str({ description: "Short human-readable summary." }),
      doc: Opt(DocRefSchema),
      revision: Opt(RevisionChangeSchema),
      warnings: Opt(
        Arr(WarningSchema, { description: "Non-fatal issues to fix in a later call." }),
      ),
      errors: Opt(Arr(ToolErrorSchema, { description: "Present when ok is false." })),
      rolledBack: Opt(Bool({ description: "Present (true) when ok is false." })),
      retryId: Opt(Str({ description: "kimo_script retry handle." })),
      data: Opt(
        Type.Unsafe<Static<T>>({
          ...toJsonSchema(data),
          description: "Tool-specific result (present when ok).",
        }),
      ),
      ...mutating,
    },
    { description: "Kimo result envelope (kimo://docs/envelope)." },
  )
}

// --- Helpers -----------------------------------------------------------------------------------

export function success<T>(
  data: T,
  summary: string,
  extra: Partial<Omit<ToolSuccess<T>, "ok" | "data" | "summary">> = {},
): ToolSuccess<T> {
  return { ok: true, summary, warnings: [], ...extra, data }
}

export function failure(
  errors: ToolError | ToolError[],
  extra: Partial<Omit<ToolFailure, "ok" | "errors" | "rolledBack">> = {},
): ToolFailure {
  const list = (Array.isArray(errors) ? errors : [errors]).map((e) =>
    RETRYABLE_CODES.has(e.code) && e.retryable === undefined ? { ...e, retryable: true } : e,
  )
  const first = list[0]
  return {
    ok: false,
    summary: extra.summary ?? (first ? `${first.code}: ${first.message}` : "Failed"),
    errors: list,
    rolledBack: true,
    ...extra,
  }
}

/** An image attached to a result (renders); carried as MCP image content, not in JSON. */
export interface ToolImage {
  mimeType: "image/png" | "image/svg+xml"
  /** Base64 data. */
  data: string
  nodeId?: string
}

/** MCP `CallToolResult` shape produced from an envelope (SDK-independent subset). */
export interface CallToolResultLike {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]
  structuredContent: Record<string, unknown>
  isError?: boolean
}

/** Envelope → MCP result: summary text, JSON text (for hosts without structuredContent), images. */
export function toCallToolResult(result: ToolResult, images: ToolImage[] = []): CallToolResultLike {
  const structured = result as unknown as Record<string, unknown>
  const out: CallToolResultLike = {
    content: [
      { type: "text", text: result.summary },
      { type: "text", text: JSON.stringify(result) },
      ...images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType })),
    ],
    structuredContent: structured,
  }
  if (!result.ok) out.isError = true
  return out
}

/** Re-export for tools that tag union members. */
export { AnyOf, Tag }
