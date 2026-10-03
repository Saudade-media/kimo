/**
 * The typed op vocabulary (teardown 9.3, 11.3 `kimo_apply_ops`). Every document mutation —
 * UI, agent, MCP, file watcher — is expressed as these ops and applied through
 * {@link DocStore.apply}.
 *
 * Inputs may leave things implicit (no id, a sibling `index` instead of an `order` key);
 * {@link NormalizedOp}s, as returned in results and stored in the op log, are fully explicit
 * and can be replayed verbatim.
 */
import {
  type CreateComponentOptions,
  type InstancePlacement,
  type KimoDocument,
  type Libraries,
  type Node,
  type OverrideChange,
  type Plan,
  type PlanError,
  type PlanNote,
  type PropDef,
  planAddAxisValue,
  planCreateAxis,
  planCreateComponent,
  planCreateInstance,
  planCreateVariable,
  planDeclareProp,
  planDeleteAxis,
  planDeleteVariable,
  planDetachAlias,
  planDetachInstance,
  planDuplicateAxisValue,
  planDuplicateVariable,
  planHideInInstance,
  planLinkLibrary,
  planMoveAxisValue,
  planRelinkLibrary,
  planRemoveAxisValue,
  planRemoveProp,
  planRenameAxis,
  planRenameAxisValue,
  planRenameVariable,
  planReorderProp,
  planResetAll,
  planResetOverride,
  planSetArgs,
  planSetCell,
  planSetComponentDescription,
  planSetOverride,
  planSetSlot,
  planSetThemePin,
  planSetVariableValue,
  planSwapInstance,
  planUnlinkLibrary,
  planUpdateProp,
  planUpdateVariable,
  type ResetOptions,
  type Variable,
  type VariablePatch,
} from "@kimo/core-schema"
import { generateId } from "./ids"
import type { ApplyOptions, ApplySuccess, DocStore, OpError } from "./types"

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** Plain JSON node data as stored in the node table (unknown fields preserved). */
export type NodeData = Readonly<Record<string, unknown>> & {
  readonly type: string
  readonly parent: string | null
  readonly order: string
  readonly at?: string
}

/** A node body for {@link InsertOp}: a schema node whose tree position may be left out. */
export type NodeInput = DistributiveOmit<Node, "parent" | "order" | "at"> & {
  parent?: string | null
  order?: string
  at?: string
}

/** Where a node goes among its siblings. */
export interface Placement {
  /** Parent id, or null for a root node. */
  parent?: string | null
  /** Instance-owned group (slot / replace path) when `parent` is an instance. */
  at?: string | null
  /**
   * Explicit order key. Wins over `index`. Legal keys only (`^[0-9A-Za-z]{1,64}$`).
   */
  order?: string
  /**
   * Position among the destination siblings (after removing the node itself for a move),
   * clamped to [0, length]. Default: append at the end.
   */
  index?: number
}

/** Inserts one node. Children are inserted by later ops naming it as `parent`. */
export interface InsertOp extends Placement {
  op: "insert"
  /** Node id; generated (10 base-62 chars) when absent. */
  id?: string
  /** Node body. Its own `parent`/`order`/`at` are used when the op does not give them. */
  node: NodeInput | Readonly<Record<string, unknown>>
}

/**
 * Replaces top-level fields of a node wholesale (shallow) and/or removes fields.
 * `type`, `parent`, `at` and `order` cannot be changed here (use {@link MoveOp}).
 */
export interface UpdateOp {
  op: "update"
  id: string
  /** Field → new value. An `undefined` value removes the field. */
  set?: Readonly<Record<string, unknown>>
  /** Fields to remove. */
  unset?: readonly string[]
}

/** Moves a node to a new parent and/or position. Local cycles are rejected. */
export interface MoveOp extends Placement {
  op: "move"
  id: string
  /** Destination parent (required: `null` moves to the root). */
  parent: string | null
}

/** Deletes a node and its whole subtree (children and instance-owned nodes). */
export interface DeleteOp {
  op: "delete"
  id: string
}

/** Sets and/or removes document variables. */
export interface SetVariablesOp {
  op: "setVariables"
  set?: Readonly<Record<string, Variable>>
  unset?: readonly string[]
}

/** Sets and/or removes theme axes (axis → values; the first value is the default). */
export interface SetThemesOp {
  op: "setThemes"
  set?: Readonly<Record<string, readonly string[]>>
  unset?: readonly string[]
}

/**
 * Root members an op may set as whole values through {@link SetHeaderOp}: the feature list
 * (spec §13: a construct and its feature are declared in the same edit) and the asset manifest
 * (spec §12: a new asset reference and its entry are added in the same edit). M3 (ADR 0011):
 * `imports` (link / relink / unlink a library), `components` (the optional index, kept in
 * sync by Create component / Detach) and `meta` (root metadata, e.g. `kimo.themes.order`).
 */
export const HEADER_OP_KEYS = ["features", "assets", "imports", "components", "meta"] as const
export type HeaderOpKey = (typeof HEADER_OP_KEYS)[number]

/** Sets and/or removes header members ({@link HEADER_OP_KEYS}), as whole values. */
export interface SetHeaderOp {
  op: "setHeader"
  set?: Readonly<Partial<Record<HeaderOpKey, unknown>>>
  unset?: readonly HeaderOpKey[]
}

/** Several ops applied atomically, in order. Batches may nest; they are flattened. */
export interface BatchOp {
  op: "batch"
  ops: readonly Op[]
}

/** Any op accepted by {@link DocStore.apply}. */
export type Op =
  | InsertOp
  | UpdateOp
  | MoveOp
  | DeleteOp
  | SetVariablesOp
  | SetThemesOp
  | SetHeaderOp
  | BatchOp

/** A normalized insert: the full node, including `parent`, `order` and (optional) `at`. */
export interface NormalizedInsert {
  op: "insert"
  id: string
  node: NodeData
}

/** A normalized update: explicit `set` and `unset` (both always present). */
export interface NormalizedUpdate {
  op: "update"
  id: string
  set: Record<string, unknown>
  unset: string[]
}

/** A normalized move: explicit parent, order and (when set) `at`. */
export interface NormalizedMove {
  op: "move"
  id: string
  parent: string | null
  at?: string
  order: string
}

/** A normalized delete (subtree). */
export interface NormalizedDelete {
  op: "delete"
  id: string
}

/** A normalized variables change. */
export interface NormalizedSetVariables {
  op: "setVariables"
  set: Record<string, Variable>
  unset: string[]
}

/** A normalized themes change. */
export interface NormalizedSetThemes {
  op: "setThemes"
  set: Record<string, string[]>
  unset: string[]
}

/** A normalized header change. */
export interface NormalizedSetHeader {
  op: "setHeader"
  set: Partial<Record<HeaderOpKey, unknown>>
  unset: HeaderOpKey[]
}

/** Fully explicit op, as returned in results and recorded in the op log. Replayable as input. */
export type NormalizedOp =
  | NormalizedInsert
  | NormalizedUpdate
  | NormalizedMove
  | NormalizedDelete
  | NormalizedSetVariables
  | NormalizedSetThemes
  | NormalizedSetHeader

/** Flattens nested batches into a list of leaf ops, each with its path (`ops[1].ops[0]`). */
export function flattenOps(
  ops: Op | readonly Op[],
  prefix = "ops",
): { op: Exclude<Op, BatchOp>; path: string }[] {
  const out: { op: Exclude<Op, BatchOp>; path: string }[] = []
  const list = Array.isArray(ops) ? (ops as readonly Op[]) : [ops as Op]
  list.forEach((op, i) => {
    const path = Array.isArray(ops) ? `${prefix}[${i}]` : prefix
    if (op && op.op === "batch") out.push(...flattenOps(op.ops, `${path}.ops`))
    else out.push({ op: op as Exclude<Op, BatchOp>, path })
  })
  return out
}

// --- M3 commands (ADR 0011) ------------------------------------------------------------------
//
// High-level editor gestures on components, instances, props, slots, variables, themes and
// libraries. A command compiles (pure, `@kimo/core-schema` `plan*`) into the low-level ops
// above and is applied with ONE `store.apply` — validated by the store, one transaction with
// the caller's origin, one undo step, inverse recorded in the op log. No new op kinds: the CRDT,
// undo and sync layers are unchanged.

/** Component / instance / prop / slot commands (boards 11, 12, 13, 15). */
export type ComponentCommand =
  | { cmd: "createComponent"; ids: readonly string[]; options?: CreateComponentOptions }
  | { cmd: "createInstance"; of: string; placement: InstancePlacement }
  | { cmd: "detachInstance"; id: string }
  /** `path` `""` = the instance root (`props`); else an IdPath (use `ExpandedView.locate`). */
  | { cmd: "setOverride"; instance: string; path: string; change: OverrideChange }
  | { cmd: "resetOverride"; instance: string; path: string; options?: ResetOptions }
  | { cmd: "resetAllOverrides"; instance: string }
  /** Delete inside an instance → `set: { visible: false }` (board 15). */
  | { cmd: "hideInInstance"; instance: string; path: string }
  | { cmd: "setArgs"; instance: string; args: Readonly<Record<string, unknown>> }
  | { cmd: "swapInstance"; instance: string; of: string; path?: string }
  | { cmd: "declareProp"; component: string; name: string; def: PropDef }
  | {
      cmd: "updateProp"
      component: string
      name: string
      patch: Partial<Record<string, unknown>> & { rename?: string }
    }
  | { cmd: "removeProp"; component: string; name: string }
  | { cmd: "reorderProp"; component: string; name: string; before: string | null }
  | {
      cmd: "setSlot"
      frame: string
      slot: { suggested?: readonly string[] } | null
      deleteContent?: boolean
    }
  | { cmd: "setComponentDescription"; component: string; text: string | null }

/** Variable, theme-axis and theme-pin commands (board 14). */
export type VariableCommand =
  | { cmd: "createVariable"; name: string; variable: Variable }
  | { cmd: "updateVariable"; name: string; patch: VariablePatch }
  | { cmd: "setVariableValue"; name: string; value: unknown }
  | { cmd: "setCell"; name: string; axis: string; value: string; cell: unknown }
  | { cmd: "renameVariable"; from: string; to: string }
  | { cmd: "duplicateVariable"; from: string; to: string }
  | { cmd: "deleteVariable"; name: string; detach?: boolean }
  | { cmd: "detachAlias"; name: string; entry: number | null }
  | { cmd: "createAxis"; axis: string; values: readonly string[] }
  | { cmd: "renameAxis"; from: string; to: string }
  | { cmd: "deleteAxis"; axis: string }
  | { cmd: "addAxisValue"; axis: string; value: string; index?: number }
  | { cmd: "moveAxisValue"; axis: string; value: string; index: number }
  | { cmd: "renameAxisValue"; axis: string; from: string; to: string }
  | { cmd: "duplicateAxisValue"; axis: string; from: string; to: string }
  | { cmd: "removeAxisValue"; axis: string; value: string; force?: boolean }
  /** `value` null = Inherit (remove the pin). Real nodes; inside instances use setOverride. */
  | { cmd: "setThemePin"; node: string; axis: string; value: string | null }

/** Linked-library commands (boards 13, 15). */
export type LibraryCommand =
  | { cmd: "linkLibrary"; alias: string; path: string }
  | { cmd: "relinkLibrary"; alias: string; path: string }
  | { cmd: "unlinkLibrary"; alias: string }

/** Every M3 command. */
export type M3Command = ComponentCommand | VariableCommand | LibraryCommand

/** What compiling a command reads besides the document. */
export interface CommandContext {
  /** Loaded libraries by alias (or the editor's cached copies, for detach / unlink). */
  libraries?: Libraries
  /** Id generator for new nodes. Default {@link generateId}. */
  newId?: () => string
}

/** Compiles a command against a document (pure). */
export function planCommand(
  doc: KimoDocument,
  command: M3Command,
  context: CommandContext = {},
): Plan {
  const ctx = { doc, libraries: context.libraries, newId: context.newId ?? generateId }
  const c = command
  switch (c.cmd) {
    case "createComponent":
      return planCreateComponent(ctx, c.ids, c.options)
    case "createInstance":
      return planCreateInstance(ctx, c.of, c.placement)
    case "detachInstance":
      return planDetachInstance(ctx, c.id)
    case "setOverride":
      return planSetOverride(ctx, c.instance, c.path, c.change)
    case "resetOverride":
      return planResetOverride(ctx, c.instance, c.path, c.options)
    case "resetAllOverrides":
      return planResetAll(ctx, c.instance)
    case "hideInInstance":
      return planHideInInstance(ctx, c.instance, c.path)
    case "setArgs":
      return planSetArgs(ctx, c.instance, c.args)
    case "swapInstance":
      return planSwapInstance(ctx, c.instance, c.of, c.path)
    case "declareProp":
      return planDeclareProp(ctx, c.component, c.name, c.def)
    case "updateProp":
      return planUpdateProp(ctx, c.component, c.name, c.patch)
    case "removeProp":
      return planRemoveProp(ctx, c.component, c.name)
    case "reorderProp":
      return planReorderProp(ctx, c.component, c.name, c.before)
    case "setSlot":
      return planSetSlot(ctx, c.frame, c.slot, { deleteContent: c.deleteContent })
    case "setComponentDescription":
      return planSetComponentDescription(ctx, c.component, c.text)
    case "createVariable":
      return planCreateVariable(ctx, c.name, c.variable)
    case "updateVariable":
      return planUpdateVariable(ctx, c.name, c.patch)
    case "setVariableValue":
      return planSetVariableValue(ctx, c.name, c.value)
    case "setCell":
      return planSetCell(ctx, c.name, c.axis, c.value, c.cell)
    case "renameVariable":
      return planRenameVariable(ctx, c.from, c.to)
    case "duplicateVariable":
      return planDuplicateVariable(ctx, c.from, c.to)
    case "deleteVariable":
      return planDeleteVariable(ctx, c.name, { detach: c.detach })
    case "detachAlias":
      return planDetachAlias(ctx, c.name, c.entry)
    case "createAxis":
      return planCreateAxis(ctx, c.axis, c.values)
    case "renameAxis":
      return planRenameAxis(ctx, c.from, c.to)
    case "deleteAxis":
      return planDeleteAxis(ctx, c.axis)
    case "addAxisValue":
      return planAddAxisValue(ctx, c.axis, c.value, c.index)
    case "moveAxisValue":
      return planMoveAxisValue(ctx, c.axis, c.value, c.index)
    case "renameAxisValue":
      return planRenameAxisValue(ctx, c.axis, c.from, c.to)
    case "duplicateAxisValue":
      return planDuplicateAxisValue(ctx, c.axis, c.from, c.to)
    case "removeAxisValue":
      return planRemoveAxisValue(ctx, c.axis, c.value, { force: c.force })
    case "setThemePin":
      return planSetThemePin(ctx, c.node, c.axis, c.value)
    case "linkLibrary":
      return planLinkLibrary(ctx, c.alias, c.path)
    case "relinkLibrary":
      return planRelinkLibrary(ctx, c.alias, c.path)
    case "unlinkLibrary":
      return planUnlinkLibrary(ctx, c.alias)
    default:
      return {
        ok: false,
        error: {
          code: "INVALID",
          message: `Unknown command ${JSON.stringify((c as { cmd: unknown }).cmd)}`,
        },
      }
  }
}

/** Result of {@link applyCommand}. */
export type CommandResult =
  | {
      ok: true
      /** The store's result (revision, inverse, warnings, …). */
      applied: ApplySuccess
      notes: PlanNote[]
      /** Ids to select afterwards (new main, detached root, inserted instance…), when any. */
      select?: string[]
    }
  /** The planner refused (board 15 toast copy keyed by `error.code`). Nothing was applied. */
  | { ok: false; refused: PlanError }
  /** The store rejected the ops (validation, read-only, revision conflict). */
  | { ok: false; rejected: OpError[] }

/**
 * Plans `command` against the store's current document and applies it as ONE op group
 * (`store.apply(plan.ops, options)`): one transaction with `options.origin`, one undo step.
 * Note: `store.toDocument()` copies the document (O(n)); fine per gesture, not per frame.
 */
export function applyCommand(
  store: DocStore,
  command: M3Command,
  options: ApplyOptions & CommandContext,
): CommandResult {
  const { libraries, newId, ...apply } = options
  const plan = planCommand(store.toDocument(), command, { libraries, newId })
  if (!plan.ok) return { ok: false, refused: plan.error }
  const r = store.apply(plan.ops, apply)
  if (!r.ok) return { ok: false, rejected: r.errors }
  const out: CommandResult = { ok: true, applied: r, notes: plan.notes }
  if (plan.select) out.select = plan.select
  return out
}
