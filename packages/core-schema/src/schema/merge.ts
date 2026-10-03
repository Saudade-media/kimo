/**
 * Merge conflicts stored in the document (feature "merge/conflicts", spec §21, ADR 0012).
 *
 * `kimo merge` (the git merge driver) never drops a side silently: every disagreement it cannot
 * settle becomes one entry of the root `conflicts` table, and the body of the document (nodes,
 * variables, header) holds the side named by the entry's `applied`. The file therefore stays
 * valid JSON, validates and renders; the editor lists the entries (board 18), applies sides,
 * and "Mark resolved & save" removes `conflicts`, `merge` and the feature flag.
 *
 * In every entry, `base` / `ours` / `theirs` hold that side's value; **a missing side means the
 * value is absent on that side** (property unset, node or variable deleted, themed entry
 * missing). JSON has no `undefined`, so absence is encoded by omitting the key.
 */
import Type, { type Static } from "typebox"
import { Node } from "./nodes"
import {
  ID_PATTERN,
  Id,
  IdPath,
  OrderKey,
  RecordOf,
  Strict,
  StringEnum,
  ThemeSelection,
  VARIABLE_NAME_PATTERN,
} from "./primitives"

const opt = Type.Optional

/** A side of a three-way merge that can be applied. */
export const CONFLICT_SIDES = ["ours", "theirs", "base"] as const
export type ConflictSide = (typeof CONFLICT_SIDES)[number]

/**
 * What the body currently holds for a conflict: one of the sides, or `"edited"` when the user
 * changed the target by hand after the merge (which also counts as resolving it).
 */
export const APPLIED_STATES = [...CONFLICT_SIDES, "edited"] as const
export type AppliedState = (typeof APPLIED_STATES)[number]

/** Conflict kinds (board 18 "ConflictRow per kind"). */
export const CONFLICT_KINDS = ["prop", "node", "move", "variable", "header"] as const
export type ConflictKind = (typeof CONFLICT_KINDS)[number]

/** RFC 6901 JSON Pointer with at least one token (`/fill`, `/layout/gap`, `/args/label`). */
export const NON_EMPTY_POINTER_PATTERN = "^(?:/(?:[^~/]|~[01])*)+$"

const Pointer = (description: string) =>
  Type.String({ pattern: NON_EMPTY_POINTER_PATTERN, description })

const Applied = StringEnum(APPLIED_STATES, {
  description: "Which side the document body holds now; `edited` = changed by hand.",
})
const Resolved = opt(
  Type.Boolean({
    default: false,
    description: "True once the user picked a side (or edited the target). Default false.",
  }),
)
const AnySide = (description: string) => opt(Type.Unknown({ description }))

/**
 * Both sides changed the same property of a node differently. `path` is a JSON Pointer
 * relative to the node (`/fill`, `/layout/gap`, `/args/label`, `/component/props/size`). It
 * never addresses `type`, `parent`, `order` or `at`: a type change is a `node` conflict and a
 * placement change is a `move` conflict.
 */
export const PropConflict = Strict(
  {
    kind: Type.Literal("prop"),
    node: Id,
    path: Pointer("Property path inside the node."),
    base: AnySide("Value in the merge base (absent = unset)."),
    ours: AnySide("Value on our side (absent = unset)."),
    theirs: AnySide("Value on their side (absent = unset)."),
    applied: Applied,
    resolved: Resolved,
  },
  { title: "PropConflict" },
)
export type PropConflict = Static<typeof PropConflict>

/**
 * A whole-node conflict: delete vs edit (one of `ours` / `theirs` is absent), or both sides
 * changed the node's `type`. `restored` holds snapshots of the other nodes that are present in
 * the body only because the target is kept (its descendants, and ancestors the deleting side
 * removed); applying the deleting side removes them with the target, applying a keeping side
 * puts them back.
 */
export const NodeConflict = Strict(
  {
    kind: Type.Literal("node"),
    node: Id,
    base: opt(Node),
    ours: opt(Node),
    theirs: opt(Node),
    restored: opt(RecordOf(ID_PATTERN, Node)),
    applied: Applied,
    resolved: Resolved,
  },
  { title: "NodeConflict" },
)
export type NodeConflict = Static<typeof NodeConflict>

/** Where a node sits: its placement fields. */
export const Placement = Strict(
  {
    parent: Type.Union([Id, Type.Null()]),
    order: OrderKey,
    at: opt(IdPath),
  },
  { title: "Placement" },
)
export type Placement = Static<typeof Placement>

/** Both sides moved the same node to different places ("moved twice"). */
export const MoveConflict = Strict(
  {
    kind: Type.Literal("move"),
    node: Id,
    base: Placement,
    ours: Placement,
    theirs: Placement,
    applied: Applied,
    resolved: Resolved,
  },
  { title: "MoveConflict" },
)
export type MoveConflict = Static<typeof MoveConflict>

/**
 * A variable conflict. Without `when`, the sides are whole variable definitions (absent =
 * deleted; covers delete vs edit and type changes). With `when`, the sides are the `value` of
 * the themed entry whose `when` equals it exactly ("$brand · light"); absent = no such entry.
 */
export const VariableConflict = Strict(
  {
    kind: Type.Literal("variable"),
    variable: Type.String({ pattern: VARIABLE_NAME_PATTERN, description: "Local variable." }),
    when: opt(ThemeSelection),
    base: AnySide("Base definition / themed value."),
    ours: AnySide("Our definition / themed value."),
    theirs: AnySide("Their definition / themed value."),
    applied: Applied,
    resolved: Resolved,
  },
  { title: "VariableConflict" },
)
export type VariableConflict = Static<typeof VariableConflict>

/**
 * A header conflict: a JSON Pointer from the root into `meta`, `themes`, `imports`, `assets`
 * or `components` (e.g. `/themes/mode`, `/meta/name`, `/imports/ui`).
 */
export const HeaderConflict = Strict(
  {
    kind: Type.Literal("header"),
    path: Pointer("Pointer from the document root."),
    base: AnySide("Base value."),
    ours: AnySide("Our value."),
    theirs: AnySide("Their value."),
    applied: Applied,
    resolved: Resolved,
  },
  { title: "HeaderConflict" },
)
export type HeaderConflict = Static<typeof HeaderConflict>

/** One stored merge conflict. */
export const Conflict = Type.Union([
  PropConflict,
  NodeConflict,
  MoveConflict,
  VariableConflict,
  HeaderConflict,
])
export type Conflict = Static<typeof Conflict>

/** The conflicts table: conflict id (node-id grammar) → conflict. */
export const Conflicts = RecordOf(ID_PATTERN, Conflict, { minProperties: 1 })
export type Conflicts = Record<string, Conflict>

/**
 * Labels of an in-progress merge, for the UI ("main ← feat/pricing-v2 · base 4e1a9c2") and
 * `changes` = number of changes `kimo merge` applied cleanly ("14 changes applied").
 */
export const MergeInfo = Strict(
  {
    base: opt(Type.String({ maxLength: 200, description: "Base label, e.g. a short commit." })),
    ours: opt(Type.String({ maxLength: 200, description: "Our label, e.g. the current branch." })),
    theirs: opt(
      Type.String({ maxLength: 200, description: "Their label, e.g. the merged branch." }),
    ),
    changes: opt(Type.Integer({ minimum: 0, description: "Changes applied without conflict." })),
  },
  { title: "MergeInfo" },
)
export type MergeInfo = Static<typeof MergeInfo>

/** First pointer tokens a `prop` conflict may not address (see {@link PropConflict}). */
export const PROP_CONFLICT_FORBIDDEN = new Set(["type", "parent", "order", "at"])

/** Root members a `header` conflict may address. */
export const HEADER_CONFLICT_MEMBERS = new Set([
  "meta",
  "themes",
  "imports",
  "assets",
  "components",
])
