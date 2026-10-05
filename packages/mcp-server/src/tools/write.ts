/**
 * Write tools: typed ops, imports, assets and the (stubbed) script tool (teardown 11.3).
 */
import { isDestructive, type WireOp, WireOpSchema } from "../ops"
import { Arr, Bool, Enum, Int, Num, Obj, Opt, Str } from "../schema"
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

export const kimoApplyOps = defineTool({
  name: "kimo_apply_ops",
  title: "Edit with typed ops",
  description:
    "The way to change a document. Sends an ordered list of typed ops applied atomically: all succeed or nothing changes. Ops: insert, update, replace, move, delete, copy, instantiate, make_component, detach, set_override, reset_override, set_args, swap_instance, declare_prop, remove_prop, set_slot, set_variables, set_theme_axes, create_variable, update_variable, rename_variable, delete_variable, set_theme_pin, theme_axis. Give new nodes a key and reference them later in the same call as @key (e.g. insert a frame with key hero, then insert a text node with parent @hero; a text node's string goes in content, not text). Pass baseRevision from your last read to avoid overwriting edits made since (REVISION_CONFLICT). dryRun=true validates and returns the diff without committing; render=true attaches a PNG of the changed top-level frames after commit. At most 40 inserts per call (BATCH_TOO_LARGE): a skeleton first, then one section per call. Copy, instantiate and edits are never limited: make a variant by copying the page. Deletes and other destructive ops may ask the user first. Read kimo_read_docs path=ops.",
  input: Obj({
    docId,
    ops: Arr(WireOpSchema, {
      description: "Ops, applied in order as one undoable edit.",
      minItems: 1,
      maxItems: MAX_OPS_PER_CALL,
    }),
    baseRevision,
    dryRun,
    label,
    render: Opt(
      Bool({
        description:
          "Attach a PNG of the affected top-level frames after commit (never for dryRun).",
      }),
    ),
  }),
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
    "Imports content as ops: svg (editable vector layers), image (hashed into assets/ and placed as an image-filled rect), tokens-dtcg or tokens-css (variables, merged). Give exactly one source: an absolute file path or inline text (svg/tokens). Returns the ops it applied; supports dryRun and baseRevision like kimo_apply_ops.",
  input: Obj({
    docId,
    kind: Enum(IMPORT_KINDS, { description: "What to import." }),
    path: Opt(Str({ description: "Absolute path of the source file (allow-list applies)." })),
    text: Opt(
      Str({
        description: "Inline source (svg markup, DTCG JSON or CSS custom properties).",
        maxLength: 2_000_000,
      }),
    ),
    parent: Opt(
      Str({
        description: 'Where to place svg/image: node id or "root" (default root at a free spot).',
      }),
    ),
    index: Opt(Int({ description: "Position among parent's children.", minimum: 0 })),
    x: Opt(Num({ description: "X (absolute parents)." })),
    y: Opt(Num({ description: "Y (absolute parents)." })),
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
    "list: the document's assets (hash, type, size, used-by count). import: hash an image or font file (absolute path) into assets/ and return its ./assets/ reference to use in fills or fonts (no node is created; use kimo_import kind=image to place one). fonts: font families available (document, cached, local, Google catalog when allowed); check_font: whether a family/weight loads, so you never reference a font that cannot render. generate / job_status: generation jobs through configured providers (not available in this version: UNSUPPORTED).",
  input: Obj({
    docId,
    action: Enum(ASSET_ACTIONS, { description: "What to do." }),
    path: Opt(Str({ description: "import: absolute file path." })),
    family: Opt(Str({ description: "check_font: family name; fonts: filter by name." })),
    weight: Opt(Int({ description: "check_font: weight 100–900.", minimum: 100, maximum: 900 })),
    italic: Opt(Bool({ description: "check_font: italic style." })),
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
