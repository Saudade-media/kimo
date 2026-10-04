/**
 * The tool definition shape (ADR 0013 §3): one {@link ToolDef} per tool, consumed by the MCP
 * server (`../server.ts`), the M6 built-in agent (in process) and the `kimo` CLI. Nothing about
 * a tool is defined anywhere else.
 */
import { envelopeSchema } from "../envelope"
import type { Grant, RequiredScope } from "../policy"
import { Bool, Int, Obj, Opt, type Static, Str, type TSchema } from "../schema"

/** MCP tool annotations (spec `ToolAnnotations`). `openWorldHint` is always false for Kimo. */
export interface ToolAnnotations {
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: false
}

/** Where a tool runs. */
export interface ToolAvailability {
  /** Desktop app (document host; socket + HTTP). */
  desktop: boolean
  /** Headless `kimo mcp` (no window: focus warns, render needs the CanvasKit raster). */
  headless: boolean
  /** Web attach bridge (`kimo mcp --attach`, Chromium only; later). */
  web: boolean
}

/** M5 delivery state. `stub`: schema frozen, handler returns UNSUPPORTED, hidden by default. */
export type ToolStatus = "m5" | "stub"

export interface ToolDef<
  I extends TSchema = TSchema,
  D extends TSchema = TSchema,
  N extends `kimo_${string}` = `kimo_${string}`,
> {
  name: N
  title: string
  /** Written for LLM agents: what it does, when to use it, what to call next. ≤ 1200 chars. */
  description: string
  input: I
  /** Schema of the envelope's `data`. The full output schema is {@link outputSchemaOf}. */
  data: D
  annotations: ToolAnnotations
  /** Minimum scope. Mutating tools may need more per call: {@link ToolDef.scopeFor}. */
  scope: RequiredScope
  /** Extra grant the call needs (save, export, files.create). */
  grant?: Grant
  /** Whether `docId` is required, optional or absent. */
  doc: "required" | "optional" | "none"
  /** True when the tool changes the document (envelope carries ops/inverse/created). */
  mutating: boolean
  /** Host IPC timeout (ADR 0002: default 30 s; renders and exports longer). */
  timeoutMs: number
  availability: ToolAvailability
  status: ToolStatus
  /** Per-call scope (e.g. kimo_apply_ops with a delete needs `delete`). Default: `scope`. */
  scopeFor?: (input: Static<I>) => RequiredScope
}

export type ToolInput<T extends ToolDef> = Static<T["input"]>
export type ToolData<T extends ToolDef> = Static<T["data"]>

export const DEFAULT_TIMEOUT_MS = 30_000

export const ALL_HOSTS: ToolAvailability = { desktop: true, headless: true, web: true }
export const NOT_WEB: ToolAvailability = { desktop: true, headless: true, web: false }

export const READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}
/** May delete content depending on input (MCP: destructiveHint is a worst-case hint). */
export const WRITE_MAYBE_DESTRUCTIVE: ToolAnnotations = { ...WRITE, destructiveHint: true }

export function defineTool<I extends TSchema, D extends TSchema, const N extends `kimo_${string}`>(
  def: ToolDef<I, D, N>,
): ToolDef<I, D, N> {
  return def
}

/** The full MCP `outputSchema` of a tool. */
export function outputSchemaOf(def: ToolDef) {
  return envelopeSchema(def.data, { mutating: def.mutating })
}

// --- Common input fields -----------------------------------------------------------------------

export const DOC_ID_PATTERN = "^d_[A-Za-z0-9]{1,32}_[A-Za-z0-9]{1,32}$"

export const docId = Str({
  description:
    "Target document id from kimo_get_state / kimo_open (d_<hash>_<epoch>). Required: there is never a fallback to the active document. A stale id returns DOCUMENT_NOT_OPEN with the current id.",
  pattern: DOC_ID_PATTERN,
})
export const optDocId = Opt(docId)

export const baseRevision = Opt(
  Obj(
    {
      epoch: Str({ description: "Epoch from revision.after of an earlier result.", minLength: 1 }),
      seq: Int({ description: "Seq from revision.after of an earlier result.", minimum: 0 }),
    },
    {
      description:
        "Fail with REVISION_CONFLICT unless the document is exactly at this revision (revision.after of your last read or edit). Recommended for every edit.",
    },
  ),
)

export const dryRun = Opt(
  Bool({ description: "Validate and return the ops, inverse and warnings without committing." }),
)

export const label = Opt(
  Str({
    description: "History label for this edit (shown in the editor's activity log).",
    maxLength: 120,
  }),
)

export const nodeIdField = (description: string) =>
  Str({
    description,
    pattern:
      "^(?:[A-Za-z][A-Za-z0-9_-]{0,31}:)?[A-Za-z0-9]{6,24}(?:/(?:[A-Za-z][A-Za-z0-9_-]{0,31}:)?[A-Za-z0-9]{6,24})*$",
  })

/** Placeholder data schema for tools whose data is a single acknowledgement. */
export const Ack = Obj({ done: Bool({ description: "True when the action happened." }) })
