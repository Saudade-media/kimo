/**
 * Write tools: typed ops, imports, assets and the (stubbed) script tool (teardown 11.3).
 */
import { isDestructive, WIRE_OP_KINDS, WIRE_OP_SCHEMAS, type WireOp, WireOpSchema } from "../ops"
import {
  Arr,
  Bool,
  Enum,
  Int,
  Num,
  Obj,
  Open,
  Opt,
  Str,
  type TSchema,
  toJsonSchema,
} from "../schema"
import {
  ALL_HOSTS,
  baseRevision,
  DEFAULT_TIMEOUT_MS,
  defineTool,
  docId,
  dryRun,
  label,
  NOT_WEB,
  WRITE,
  WRITE_MAYBE_DESTRUCTIVE,
} from "./define"

/** Max ops per kimo_apply_ops call (larger edits: several calls with baseRevision). */
export const MAX_OPS_PER_CALL = 500

/**
 * Max freshly authored layers per kimo_apply_ops call (board 31 "Batch limit", ADR 0013 §4.6):
 * the number of `insert` ops — the nodes whose content the agent writes out. Copies (`copy` of a
 * subtree, frame or page), `instantiate` and page duplicates are never counted, whatever their
 * size; edits to existing layers (update, replace, move, delete, overrides…) are not limited.
 * Over the limit the call fails with BATCH_TOO_LARGE and nothing is applied, so agents build a
 * design step by step: a skeleton first, then one section per call. Every caller of this tool
 * is an agent (built-in panel, Claude Code / Codex / Gemini CLI, any MCP client); user actions
 * (paste, import, duplicate) never go through it.
 */
export const AGENT_MAX_NEW_LAYERS = 40

type JsonSchema = {
  type?: string
  enum?: string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  additionalProperties?: boolean
}

/** `a, b?, kind:x|y, list[], box?:{x,y}`: the fields of a closed object schema, compactly. */
function fieldsOf(j: JsonSchema, skip = ""): string {
  const req = new Set(j.required ?? [])
  return Object.entries(j.properties ?? {})
    .filter(([k]) => k !== skip)
    .map(([k, v]) => {
      const name = k + (req.has(k) ? "" : "?")
      if (v.enum && k !== "type") return `${name}:${v.enum.join("|")}`
      if (v.type === "array")
        return v.items?.type === "object" && v.items.additionalProperties === false
          ? `${name}:[{${fieldsOf(v.items)}}]`
          : `${name}:[]`
      if (v.type === "object" && v.additionalProperties === false) return `${name}:{${fieldsOf(v)}}`
      return name
    })
    .join(", ")
}

/**
 * The op grammar, one line per op kind, generated from the strict op schemas (so it cannot
 * drift from what the server validates): `insert {key?, parent, at?, index?, node}`.
 */
export function opGrammar(): string {
  return WIRE_OP_SCHEMAS.map((s) => {
    const j = toJsonSchema(s) as JsonSchema
    const tag = j.properties?.op?.enum?.[0]
    return `${tag} {${fieldsOf(j, "op")}}`
  }).join("\n")
}

/**
 * Model-facing schema of kimo_apply_ops (board 31 token pass): each op is an open object whose
 * `op` is enforced and whose fields are the generated grammar, about 2k characters instead of
 * the 24k of the strict 25-member union. The server validates the strict union
 * (`validationSchemaOf`), so nothing gets through that did before.
 */
function applyOpsAdvertised(input: TSchema): TSchema {
  const j = toJsonSchema(input) as JsonSchema & { properties: Record<string, unknown> }
  const op = Open(
    { op: Enum(WIRE_OP_KINDS, { description: "Op kind; its fields are listed below." }) },
    {
      description: `One op (fields per kind; ? = optional). A ref is a node id, @key (a node created earlier in this call) or @copyKey/<original id> (that node inside a copy made earlier in this call); parent also takes "root". key names the new node; index = position among siblings (default: append); node = one .kimo node body {type, name?, …fields}, never with children (each child is its own insert with parent @key), e.g. {"type":"text","content":"Hello","style":{"size":16}} (kimo_read_docs path=schema); set = {field: value} (shallow; null removes the field).\n${opGrammar()}\nExamples: kimo_read_docs path=ops.`,
    },
  )
  return {
    ...j,
    properties: {
      ...j.properties,
      ops: {
        ...toJsonSchema(Arr(op, { description: "Ops, applied in order as one undoable edit." })),
      },
    },
  } as unknown as TSchema
}

const applyOpsInput = Obj({
  docId,
  ops: Arr(WireOpSchema, {
    description: "Ops, applied in order as one undoable edit.",
    minItems: 1,
    maxItems: MAX_OPS_PER_CALL,
  }),
  baseRevision,
  dryRun,
  label,
  render: Opt(Bool({ description: "Attach a PNG of the changed top-level frames." })),
})

export const kimoApplyOps = defineTool({
  name: "kimo_apply_ops",
  title: "Edit with typed ops",
  description:
    "The only way to edit. Ops apply in order, all or nothing, as one undo step. Name new nodes with key and reference them later in the call as @key. At most 40 insert ops per call (BATCH_TOO_LARGE): a skeleton first, then one section per call; copy, instantiate and edits are unlimited, so start a variant with one copy. Features a value needs are declared for you. Pass baseRevision from your last result.",
  input: applyOpsInput,
  advertise: applyOpsAdvertised(applyOpsInput),
  data: Obj({
    applied: Int({ description: "Wire ops applied.", minimum: 0 }),
    inserted: Int({ description: "Nodes inserted.", minimum: 0 }),
    updated: Int({ description: "Nodes updated or moved.", minimum: 0 }),
    deleted: Int({ description: "Nodes deleted (whole subtrees counted).", minimum: 0 }),
    notes: Arr(
      Obj({
        code: Str({ description: "Planner note (OVERRIDE_DROPPED, BINDING_DETACHED, …)." }),
        message: Str({ description: "Explanation." }),
        nodeId: Opt(Str({ description: "Node." })),
      }),
      { description: "Side effects the component/variable planners reported." },
    ),
  }),
  annotations: WRITE_MAYBE_DESTRUCTIVE,
  scope: "edit",
  scopeFor: (i) => ((i.ops as WireOp[]).some(isDestructive) ? "delete" : "edit"),
  doc: "required",
  mutating: true,
  timeoutMs: 60_000,
  availability: ALL_HOSTS,
  status: "m5",
})

export const IMPORT_KINDS = ["svg", "image", "tokens-dtcg", "tokens-css"] as const

export const kimoImport = defineTool({
  name: "kimo_import",
  title: "Import SVG, images or tokens",
  description:
    "Imports svg (vector layers), image (an image-filled rect) or tokens-dtcg / tokens-css (variables). One source: absolute path or inline text.",
  input: Obj({
    docId,
    kind: Enum(IMPORT_KINDS, { description: "Kind." }),
    path: Opt(Str({ description: "Absolute source path." })),
    text: Opt(Str({ description: "Inline source.", maxLength: 2_000_000 })),
    parent: Opt(Str({ description: 'Node id or "root" (default: free spot).' })),
    index: Opt(Int({ description: "Position.", minimum: 0 })),
    x: Opt(Num({ description: "X." })),
    y: Opt(Num({ description: "Y." })),
    name: Opt(Str({ description: "Layer name." })),
    baseRevision,
    dryRun,
    label,
  }),
  data: Obj({
    rootId: Opt(Str({ description: "Imported root node (svg/image)." })),
    variables: Opt(Int({ description: "Variables written (tokens).", minimum: 0 })),
    asset: Opt(Str({ description: "Asset reference ./assets/<hash>.<ext> (image)." })),
  }),
  annotations: WRITE,
  scope: "edit",
  doc: "required",
  mutating: true,
  timeoutMs: 60_000,
  availability: NOT_WEB,
  status: "m5",
})

export const kimoScript = defineTool({
  name: "kimo_script",
  title: "Run an edit script (disabled)",
  description:
    "Sandboxed JavaScript whose API mirrors the ops and compiles to the same op log. Not available in this version: it returns UNSUPPORTED. Use kimo_apply_ops (one call can hold up to 500 ops with @key references).",
  input: Obj({
    docId,
    code: Opt(Str({ description: "Script source.", maxLength: 200_000 })),
    retryId: Opt(Str({ description: "retryId of a failed run, with edits." })),
    edits: Opt(
      Arr(
        Obj({
          find: Str({
            description: "Exact text in the stored script (must match once unless all).",
          }),
          replace: Str({ description: "Replacement." }),
          all: Opt(Bool({ description: "Replace every match." })),
        }),
        { description: "Patches to the stored failed script." },
      ),
    ),
    baseRevision,
    dryRun,
    label,
  }),
  data: Obj({
    prints: Arr(Str({ description: "Printed line." }), { description: "Output lines." }),
  }),
  annotations: WRITE_MAYBE_DESTRUCTIVE,
  scope: "edit",
  scopeFor: () => "delete",
  doc: "required",
  mutating: true,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  availability: ALL_HOSTS,
  status: "stub",
})

export const ASSET_ACTIONS = [
  "list",
  "import",
  "fonts",
  "check_font",
  "generate",
  "job_status",
] as const

export const kimoAssets = defineTool({
  name: "kimo_assets",
  title: "Assets and fonts",
  description:
    "list: assets. import: a file into assets/ (returns its ./assets/ ref; no node). fonts: available families. check_font: whether a family/weight renders. generate / job_status: not available yet.",
  input: Obj({
    docId,
    action: Enum(ASSET_ACTIONS, { description: "Action." }),
    path: Opt(Str({ description: "import: absolute path." })),
    family: Opt(Str({ description: "check_font / fonts filter." })),
    weight: Opt(Int({ description: "check_font weight.", minimum: 100, maximum: 900 })),
    italic: Opt(Bool({ description: "check_font italic." })),
    prompt: Opt(Str({ description: "generate: prompt." })),
    jobId: Opt(Str({ description: "job_status: job id." })),
  }),
  data: Obj({
    assets: Opt(
      Arr(
        Obj({
          ref: Str({ description: "./assets/<hash>.<ext>" }),
          type: Str({ description: "Media type." }),
          bytes: Int({ description: "Size.", minimum: 0 }),
          usedBy: Int({ description: "Referencing nodes.", minimum: 0 }),
        }),
        { description: "list / import." },
      ),
    ),
    fonts: Opt(
      Arr(
        Obj({
          family: Str({ description: "Family." }),
          source: Enum(["document", "cache", "local", "google"], {
            description: "Where it comes from.",
          }),
          weights: Arr(Int({ description: "Weight." }), { description: "Available weights." }),
        }),
        { description: "fonts." },
      ),
    ),
    loads: Opt(Bool({ description: "check_font: the font loads and renders." })),
  }),
  annotations: WRITE,
  scope: "read",
  scopeFor: (i) => (i.action === "import" || i.action === "generate" ? "edit" : "read"),
  doc: "required",
  mutating: true,
  timeoutMs: 60_000,
  availability: NOT_WEB,
  status: "m5",
})
