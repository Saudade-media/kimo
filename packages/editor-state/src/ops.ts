/**
 * The typed op vocabulary (teardown 9.3, 11.3 `kimo_apply_ops`). Every document mutation —
 * UI, agent, MCP, file watcher — is expressed as these ops and applied through
 * {@link DocStore.apply}.
 *
 * Inputs may leave things implicit (no id, a sibling `index` instead of an `order` key);
 * {@link NormalizedOp}s, as returned in results and stored in the op log, are fully explicit
 * and can be replayed verbatim.
 */
import type { Node, Variable } from "@kimo/core-schema"

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

/** Several ops applied atomically, in order. Batches may nest; they are flattened. */
export interface BatchOp {
  op: "batch"
  ops: readonly Op[]
}

/** Any op accepted by {@link DocStore.apply}. */
export type Op = InsertOp | UpdateOp | MoveOp | DeleteOp | SetVariablesOp | SetThemesOp | BatchOp

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

/** Fully explicit op, as returned in results and recorded in the op log. Replayable as input. */
export type NormalizedOp =
  | NormalizedInsert
  | NormalizedUpdate
  | NormalizedMove
  | NormalizedDelete
  | NormalizedSetVariables
  | NormalizedSetThemes

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
