/**
 * Wire ops for `kimo_apply_ops` (teardown 11.3, ADR 0013 §5): the declarative edit vocabulary
 * agents send. Each wire op maps 1:1 either to an `@kimo/editor-state` {@link Op} (low-level)
 * or to an M3 {@link M3Command} (compiled by the core-schema planners), so every agent edit is
 * one `DocStore.apply` op group: validated, one Yjs transaction with origin `mcp:<client>`, one
 * undo step, inverse recorded.
 *
 * Conventions agents rely on:
 * - Node references accept a node id (`A1b2C3d4E5`) or `@key`, where `key` was given to an
 *   earlier `insert`/`copy`/`instantiate`/`make_component` in the same call. `created` in the
 *   result maps every key to its real id.
 * - Positions: `index` among the destination siblings (default: append). Order keys are never
 *   exposed to agents.
 * - Node bodies are `.kimo` node objects (kimo://schema/1.0) without `parent`/`order`/`at`.
 * - `null` is never used: removal is `unset: [...]`, "inherit" is `inherit: true`.
 */
import type { Variable } from "@kimo/core-schema"
import type { M3Command, Op } from "@kimo/editor-state"
import {
  AnyOf,
  Arr,
  Bool,
  Enum,
  Int,
  JsonValue,
  Num,
  Obj,
  Open,
  Opt,
  type Static,
  Str,
  Tag,
} from "./schema"

// --- Shared fields -----------------------------------------------------------------------------

/** Node id or `@key` back-reference. */
export const NODE_REF_PATTERN = "^(?:[A-Za-z0-9]{6,24}|@[A-Za-z0-9_-]{1,64})$"
/** Qualified component id (`id` or `alias:id`) or `@key`. */
export const COMPONENT_REF_PATTERN =
  "^(?:(?:[A-Za-z][A-Za-z0-9_-]{0,31}:)?[A-Za-z0-9]{6,24}|@[A-Za-z0-9_-]{1,64})$"
/** Instance IdPath (`childId` or `nestedInstance/childId`), see kimo://docs/components. */
export const ID_PATH_PATTERN =
  "^(?:[A-Za-z][A-Za-z0-9_-]{0,31}:)?[A-Za-z0-9]{6,24}(?:/(?:[A-Za-z][A-Za-z0-9_-]{0,31}:)?[A-Za-z0-9]{6,24})*$"
export const KEY_PATTERN = "^[A-Za-z0-9_-]{1,64}$"
export const VARIABLE_NAME_PATTERN = "^[^\\s:$][^\\s:]{0,127}$"

const varName = (description: string) => Str({ description, pattern: VARIABLE_NAME_PATTERN })
const nodeRef = (description: string) => Str({ description, pattern: NODE_REF_PATTERN })
const key = Opt(
  Str({
    description: "Your name for the created node; later ops in this call may reference it as @key.",
    pattern: KEY_PATTERN,
  }),
)
const index = Opt(
  Int({
    description: "Position among the destination's children (0 = first). Default: append.",
    minimum: 0,
  }),
)
const parent = Str({
  description: 'Parent node id or @key. Use "root" for a top-level node on the canvas.',
  pattern: `^(?:root|${NODE_REF_PATTERN.slice(1, -1)})$`,
})
const at = Opt(
  Str({
    description:
      "When parent is an instance: the slot IdPath that receives the node (slot content).",
    pattern: ID_PATH_PATTERN,
  }),
)

export const NodeBody = Open(
  {
    type: Enum(
      [
        "frame",
        "group",
        "rect",
        "ellipse",
        "polygon",
        "path",
        "text",
        "icon",
        "instance",
        "note",
        "prompt",
      ],
      { description: "Node type." },
    ),
    name: Opt(Str({ description: "Layer name." })),
  },
  {
    description:
      "A .kimo node object without parent/order/at, validated against kimo://schema/1.0 (read kimo_read_docs path=schema). Children are separate insert ops naming this node's @key as parent.",
  },
)

const FieldMap = Open(
  { name: Opt(Str({ description: "Layer name (example field)." })) },
  {
    description:
      "Field → new value (shallow, whole value per top-level field), validated against kimo://schema/1.0. To remove a field use unset.",
  },
)
const fieldList = (description: string) =>
  Opt(Arr(Str({ description: "Field name." }), { description }))

const VariableBody = Open(
  {
    type: Enum(["color", "number", "string", "boolean", "typography", "shadow", "dimension"], {
      description: "Variable type.",
    }),
  },
  {
    description:
      "A .kimo Variable {type, value, group?, description?}; value may be themed [{when:{axis:value}, value}]. Validated against kimo://schema/1.0.",
  },
)

// --- Low-level ops (→ editor-state Op) ----------------------------------------------------------

export const InsertWire = Obj(
  {
    op: Tag("insert", { description: "Insert one node." }),
    key,
    parent,
    at,
    index,
    node: NodeBody,
  },
  { description: "Insert one node (children: further inserts with parent @key)." },
)
export const UpdateWire = Obj(
  {
    op: Tag("update", { description: "Change fields of a node." }),
    id: nodeRef("Node to change."),
    set: Opt(FieldMap),
    unset: fieldList("Fields to remove (back to defaults)."),
  },
  { description: "Shallow field update. type/parent cannot change (use replace/move)." },
)
export const ReplaceWire = Obj(
  {
    op: Tag("replace", { description: "Replace a node's whole body." }),
    id: nodeRef("Node to replace; its id and position are kept."),
    node: NodeBody,
  },
  { description: "Replace a node body (fields not given are removed). Destructive." },
)
export const MoveWire = Obj(
  {
    op: Tag("move", { description: "Reparent and/or reorder." }),
    id: nodeRef("Node to move."),
    parent,
    at,
    index,
  },
  { description: "Move a node. Cycles are rejected (CYCLE)." },
)
export const DeleteWire = Obj(
  {
    op: Tag("delete", { description: "Delete a node and its subtree." }),
    id: nodeRef("Node to delete."),
  },
  {
    description:
      "Delete a node subtree. Destructive. Inside an instance use set_override {visible:false} instead (INSTANCE_STRUCTURE).",
  },
)
export const CopyWire = Obj(
  {
    op: Tag("copy", { description: "Deep-copy a subtree." }),
    id: nodeRef(
      "Node to copy (copies of a component main become plain frames; use instantiate for instances).",
    ),
    key,
    parent,
    at,
    index,
    set: Opt(FieldMap),
  },
  { description: "Deep copy with fresh ids; optional field overrides on the copy's root." },
)
export const SetVariablesWire = Obj(
  {
    op: Tag("set_variables", { description: "Set or remove variables." }),
    set: Opt(
      Arr(Obj({ name: varName("Variable name."), variable: VariableBody }), {
        description: "Variables to create or overwrite (whole value).",
      }),
    ),
    unset: Opt(
      Arr(Str({ description: "Variable name.", pattern: VARIABLE_NAME_PATTERN }), {
        description: "Variables to delete (bindings break: prefer delete_variable).",
      }),
    ),
  },
  { description: "Low-level variable write (merge). Document-global." },
)
export const SetThemeAxesWire = Obj(
  {
    op: Tag("set_theme_axes", { description: "Set or remove theme axes." }),
    set: Opt(
      Arr(
        Obj({
          axis: Str({ description: "Axis name." }),
          values: Arr(Str({ description: "Axis value." }), {
            description: "Ordered values; the first is the default.",
            minItems: 1,
          }),
        }),
        { description: "Axes to create or overwrite." },
      ),
    ),
    unset: Opt(Arr(Str({ description: "Axis name." }), { description: "Axes to delete." })),
  },
  { description: "Low-level theme axes write. Document-global." },
)

/** Board 27 / spec §5.6: pages (root `pages`; a top-level node's `page` names its page). */
export const PageWire = Obj(
  {
    op: Tag("page", { description: "Add, rename, move or delete a page." }),
    action: Enum(["add", "rename", "move", "delete"], {
      description:
        "add (name, index?) · rename (id, name) · move (id, index) · delete (id; deletes its top-level nodes; never the last page).",
    }),
    id: Opt(
      Str({
        description: "Page id (from kimo_get_state pages[].id).",
        pattern: "^[A-Za-z0-9]{6,24}$",
      }),
    ),
    name: Opt(Str({ description: "Page name (add / rename).", minLength: 1 })),
    index: Opt(
      Int({ description: "Position among the pages (add / move; 0 = first).", minimum: 0 }),
    ),
    key,
  },
  {
    description:
      "Pages are document-global. Put a top-level node on a page by setting its `page` field (insert node.page / update set.page); without `page` it is on the first page. The first add on a one-page document also gives that page an id (its nodes keep their page).",
  },
)

// --- Component / instance commands (→ M3 ComponentCommand) --------------------------------------

export const InstantiateWire = Obj(
  {
    op: Tag("instantiate", { description: "Create an instance of a component." }),
    of: Str({
      description: "Component id, alias:id for a linked library, or @key.",
      pattern: COMPONENT_REF_PATTERN,
    }),
    key,
    parent,
    at,
    index,
    x: Opt(Num({ description: "X in the parent's space (absolute parents only)." })),
    y: Opt(Num({ description: "Y in the parent's space (absolute parents only)." })),
    name: Opt(Str({ description: "Layer name." })),
  },
  { description: "createInstance." },
)
export const MakeComponentWire = Obj(
  {
    op: Tag("make_component", { description: "Turn nodes into a component main." }),
    ids: Arr(nodeRef("Node to include."), {
      description: "One node, or several siblings with wrap.",
      minItems: 1,
    }),
    key,
    name: Opt(Str({ description: "Component name." })),
    wrap: Opt(
      Obj(
        {
          x: Num({ description: "Wrapper x in the shared parent's space." }),
          y: Num({ description: "Wrapper y." }),
          w: Num({ description: "Wrapper width.", minimum: 0 }),
          h: Num({ description: "Wrapper height.", minimum: 0 }),
          name: Opt(Str({ description: "Wrapper name." })),
        },
        { description: "Required for several nodes: the new wrapping frame's box." },
      ),
    ),
  },
  { description: "createComponent. Needs the components grant for scoped agents." },
)
export const DetachWire = Obj(
  {
    op: Tag("detach", { description: "Detach an instance into plain nodes." }),
    id: nodeRef("Instance to detach."),
  },
  { description: "detachInstance. Destructive (the component link is lost)." },
)
export const SetOverrideWire = Obj(
  {
    op: Tag("set_override", { description: "Override something inside an instance." }),
    instance: nodeRef("The instance."),
    path: Opt(
      Str({
        description:
          "IdPath of the descendant inside the instance (omit for the instance root's props).",
        pattern: ID_PATH_PATTERN,
      }),
    ),
    kind: Enum(["set", "slot", "replace"], {
      description:
        "set = merge fields; slot = make path take content; replace = swap the node at path.",
    }),
    set: Opt(FieldMap),
    node: Opt(NodeBody),
    content: Opt(Arr(NodeBody, { description: "kind=slot: nodes inserted into the slot." })),
  },
  { description: "setOverride (kind set needs set; replace needs node)." },
)
export const ResetOverrideWire = Obj(
  {
    op: Tag("reset_override", { description: "Remove overrides." }),
    instance: nodeRef("The instance."),
    path: Opt(
      Str({
        description: "IdPath; omit with all=true to reset everything.",
        pattern: ID_PATH_PATTERN,
      }),
    ),
    fields: fieldList("Only these fields of a set override."),
    all: Opt(Bool({ description: "Reset every override of the instance." })),
  },
  { description: "resetOverride / resetAllOverrides." },
)
export const SetArgsWire = Obj(
  {
    op: Tag("set_args", { description: "Set declared component props on an instance." }),
    instance: nodeRef("The instance."),
    args: Arr(
      Obj({
        name: Str({ description: "Declared prop name." }),
        value: JsonValue({ description: "Prop value." }),
      }),
      { description: "Prop values per the component's declared props.", minItems: 1 },
    ),
  },
  { description: "setArgs." },
)
export const SwapInstanceWire = Obj(
  {
    op: Tag("swap_instance", {
      description: "Swap which component an instance (or nested instance) uses.",
    }),
    instance: nodeRef("The instance."),
    of: Str({ description: "New component id or alias:id.", pattern: COMPONENT_REF_PATTERN }),
    path: Opt(
      Str({
        description: "Nested instance IdPath; omit for the instance itself.",
        pattern: ID_PATH_PATTERN,
      }),
    ),
  },
  { description: "swapInstance." },
)
export const DeclarePropWire = Obj(
  {
    op: Tag("declare_prop", { description: "Declare or update a component prop." }),
    component: nodeRef("Component main."),
    name: Str({ description: "Prop name." }),
    def: Open(
      {
        type: Enum(["text", "boolean", "instance", "enum", "slot"], { description: "Prop kind." }),
      },
      { description: "A .kimo PropDef (kimo://schema/1.0)." },
    ),
  },
  { description: "declareProp (upsert)." },
)
export const RemovePropWire = Obj(
  {
    op: Tag("remove_prop", { description: "Remove a declared prop." }),
    component: nodeRef("Component main."),
    name: Str({ description: "Prop name." }),
  },
  { description: "removeProp. Destructive (instance args for it are dropped)." },
)
export const SetSlotWire = Obj(
  {
    op: Tag("set_slot", {
      description: "Mark a frame inside a component as a slot, or unmark it.",
    }),
    frame: nodeRef("Frame inside a component main."),
    suggested: Opt(
      Arr(Str({ description: "Component id.", pattern: COMPONENT_REF_PATTERN }), {
        description: "Suggested components.",
      }),
    ),
    remove: Opt(Bool({ description: "Unmark the slot." })),
    deleteContent: Opt(Bool({ description: "With remove: also delete instance slot content." })),
  },
  { description: "setSlot." },
)

// --- Variable / theme commands (→ M3 VariableCommand) ------------------------------------------

export const CreateVariableWire = Obj(
  {
    op: Tag("create_variable", { description: "Create a variable." }),
    name: varName("New name."),
    variable: VariableBody,
  },
  { description: "createVariable (fails with INVALID_INPUT if it exists)." },
)
export const UpdateVariableWire = Obj(
  {
    op: Tag("update_variable", { description: "Edit a variable." }),
    name: varName("Variable."),
    value: Opt(JsonValue({ description: "New value (whole, may be themed)." })),
    group: Opt(Str({ description: "DTCG group path." })),
    description: Opt(Str({ description: "Description." })),
    unset: Opt(
      Arr(Enum(["group", "description"], { description: "Field." }), {
        description: "Fields to remove.",
      }),
    ),
  },
  { description: "updateVariable." },
)
export const RenameVariableWire = Obj(
  {
    op: Tag("rename_variable", { description: "Rename a variable and rebind every use." }),
    from: varName("Current name."),
    to: varName("New name."),
  },
  { description: "renameVariable." },
)
export const DeleteVariableWire = Obj(
  {
    op: Tag("delete_variable", { description: "Delete a variable." }),
    name: varName("Variable."),
    detach: Opt(
      Bool({ description: "Replace bindings with the resolved literal (otherwise IN_USE fails)." }),
    ),
  },
  { description: "deleteVariable. Destructive." },
)
export const SetThemePinWire = Obj(
  {
    op: Tag("set_theme_pin", { description: "Pin a node's subtree to a theme value." }),
    node: nodeRef("Node."),
    axis: Str({ description: "Axis name." }),
    value: Opt(Str({ description: "Axis value to pin." })),
    inherit: Opt(Bool({ description: "Remove the pin (inherit from ancestors)." })),
  },
  { description: "setThemePin (give value, or inherit=true)." },
)
export const ThemeAxisWire = Obj(
  {
    op: Tag("theme_axis", { description: "Edit theme axes and their values." }),
    action: Enum(
      ["create", "rename", "delete", "add_value", "move_value", "rename_value", "remove_value"],
      { description: "What to do." },
    ),
    axis: Str({ description: "Axis name (current name for rename)." }),
    to: Opt(Str({ description: "rename / rename_value: new name." })),
    value: Opt(Str({ description: "add_value / move_value / rename_value (old) / remove_value." })),
    values: Opt(
      Arr(Str({ description: "Value." }), {
        description: "create: ordered values (first = default).",
      }),
    ),
    index: Opt(Int({ description: "add_value / move_value position.", minimum: 0 })),
    force: Opt(Bool({ description: "remove_value: also drop pins and themed entries using it." })),
  },
  {
    description:
      "createAxis/renameAxis/deleteAxis/addAxisValue/moveAxisValue/renameAxisValue/removeAxisValue. delete and remove_value are destructive.",
  },
)

// --- Union -------------------------------------------------------------------------------------

export const WIRE_OP_SCHEMAS = [
  InsertWire,
  UpdateWire,
  ReplaceWire,
  MoveWire,
  DeleteWire,
  CopyWire,
  SetVariablesWire,
  SetThemeAxesWire,
  InstantiateWire,
  MakeComponentWire,
  DetachWire,
  SetOverrideWire,
  ResetOverrideWire,
  SetArgsWire,
  SwapInstanceWire,
  DeclarePropWire,
  RemovePropWire,
  SetSlotWire,
  CreateVariableWire,
  UpdateVariableWire,
  RenameVariableWire,
  DeleteVariableWire,
  SetThemePinWire,
  ThemeAxisWire,
  PageWire,
] as const

export const WireOpSchema = AnyOf([...WIRE_OP_SCHEMAS], {
  description: "One typed edit. See kimo_read_docs path=ops for examples.",
})

export type InsertWire = Static<typeof InsertWire>
export type UpdateWire = Static<typeof UpdateWire>
export type ReplaceWire = Static<typeof ReplaceWire>
export type MoveWire = Static<typeof MoveWire>
export type DeleteWire = Static<typeof DeleteWire>
export type CopyWire = Static<typeof CopyWire>
export type SetVariablesWire = Static<typeof SetVariablesWire>
export type SetThemeAxesWire = Static<typeof SetThemeAxesWire>
export type InstantiateWire = Static<typeof InstantiateWire>
export type MakeComponentWire = Static<typeof MakeComponentWire>
export type DetachWire = Static<typeof DetachWire>
export type SetOverrideWire = Static<typeof SetOverrideWire>
export type ResetOverrideWire = Static<typeof ResetOverrideWire>
export type SetArgsWire = Static<typeof SetArgsWire>
export type SwapInstanceWire = Static<typeof SwapInstanceWire>
export type DeclarePropWire = Static<typeof DeclarePropWire>
export type RemovePropWire = Static<typeof RemovePropWire>
export type SetSlotWire = Static<typeof SetSlotWire>
export type CreateVariableWire = Static<typeof CreateVariableWire>
export type UpdateVariableWire = Static<typeof UpdateVariableWire>
export type RenameVariableWire = Static<typeof RenameVariableWire>
export type DeleteVariableWire = Static<typeof DeleteVariableWire>
export type SetThemePinWire = Static<typeof SetThemePinWire>
export type ThemeAxisWire = Static<typeof ThemeAxisWire>
export type PageWire = Static<typeof PageWire>

export type WireOp =
  | InsertWire
  | UpdateWire
  | ReplaceWire
  | MoveWire
  | DeleteWire
  | CopyWire
  | SetVariablesWire
  | SetThemeAxesWire
  | InstantiateWire
  | MakeComponentWire
  | DetachWire
  | SetOverrideWire
  | ResetOverrideWire
  | SetArgsWire
  | SwapInstanceWire
  | DeclarePropWire
  | RemovePropWire
  | SetSlotWire
  | CreateVariableWire
  | UpdateVariableWire
  | RenameVariableWire
  | DeleteVariableWire
  | SetThemePinWire
  | ThemeAxisWire
  | PageWire

export type WireOpKind = WireOp["op"]

export const WIRE_OP_KINDS = [
  "insert",
  "update",
  "replace",
  "move",
  "delete",
  "copy",
  "set_variables",
  "set_theme_axes",
  "instantiate",
  "make_component",
  "detach",
  "set_override",
  "reset_override",
  "set_args",
  "swap_instance",
  "declare_prop",
  "remove_prop",
  "set_slot",
  "create_variable",
  "update_variable",
  "rename_variable",
  "delete_variable",
  "set_theme_pin",
  "theme_axis",
  "page",
] as const satisfies readonly WireOpKind[]

// --- Classification (scopes, approvals) ---------------------------------------------------------

/**
 * How each wire op is compiled:
 * - `op`: one editor-state op (after @key resolution);
 * - `ops`: several editor-state ops that need the current document (copy, replace);
 * - `command`: an M3 command planned by `planCommand` against the document *as updated by the
 *   earlier ops of the same call* (the whole call is still one `store.apply`).
 */
export const WIRE_OP_COMPILE: Record<WireOpKind, "op" | "ops" | "command"> = {
  insert: "op",
  update: "op",
  replace: "ops",
  move: "op",
  delete: "op",
  copy: "ops",
  set_variables: "op",
  set_theme_axes: "op",
  instantiate: "command",
  make_component: "command",
  detach: "command",
  set_override: "command",
  reset_override: "command",
  set_args: "command",
  swap_instance: "command",
  declare_prop: "command",
  remove_prop: "command",
  set_slot: "command",
  create_variable: "command",
  update_variable: "command",
  rename_variable: "command",
  delete_variable: "command",
  set_theme_pin: "command",
  theme_axis: "command",
  page: "ops",
}

/** Ops that write document-global state (scoped agents need the `globals` grant, 11.3). */
export const GLOBAL_OPS: ReadonlySet<WireOpKind> = new Set<WireOpKind>([
  "set_variables",
  "set_theme_axes",
  "create_variable",
  "update_variable",
  "rename_variable",
  "delete_variable",
  "theme_axis",
  "page",
])

/** Ops that change components other areas instantiate (need the `components` grant, 11.3). */
export const COMPONENT_ORIGIN_OPS: ReadonlySet<WireOpKind> = new Set<WireOpKind>([
  "make_component",
  "declare_prop",
  "remove_prop",
  "set_slot",
])

/**
 * True when the op removes content (needs the `delete` permission level; may prompt).
 * Undo exists, but these lose information a later edit can build on.
 */
export function isDestructive(op: WireOp): boolean {
  switch (op.op) {
    case "delete":
    case "replace":
    case "detach":
    case "remove_prop":
    case "delete_variable":
      return true
    case "set_variables":
    case "set_theme_axes":
      return (op.unset?.length ?? 0) > 0
    case "theme_axis":
      return op.action === "delete" || op.action === "remove_value"
    case "page":
      return op.action === "delete"
    case "set_slot":
      return op.remove === true && op.deleteContent === true
    default:
      return false
  }
}

// --- 1:1 mapping (pure) ------------------------------------------------------------------------

/** Resolves `@key` → id and `"root"` → null. Supplied by the compiler. */
export type RefResolver = (ref: string) => string

const parentOf = (p: string, r: RefResolver): string | null => (p === "root" ? null : r(p))

/** Low-level wire ops → editor-state `Op` (copy/replace need the document: not handled here). */
export function toStoreOp(
  op: InsertWire | UpdateWire | MoveWire | DeleteWire | SetVariablesWire | SetThemeAxesWire,
  resolve: RefResolver,
  newId: () => string,
): Op {
  switch (op.op) {
    case "insert": {
      const out: Op = {
        op: "insert",
        id: newId(),
        parent: parentOf(op.parent, resolve),
        node: op.node,
      }
      if (op.at !== undefined) out.at = op.at
      if (op.index !== undefined) out.index = op.index
      return out
    }
    case "update": {
      const out: Op = { op: "update", id: resolve(op.id) }
      if (op.set) out.set = op.set
      if (op.unset) out.unset = op.unset
      return out
    }
    case "move": {
      const out: Op = { op: "move", id: resolve(op.id), parent: parentOf(op.parent, resolve) }
      if (op.at !== undefined) out.at = op.at
      if (op.index !== undefined) out.index = op.index
      return out
    }
    case "delete":
      return { op: "delete", id: resolve(op.id) }
    case "set_variables": {
      const out: Op = { op: "setVariables" }
      if (op.set)
        out.set = Object.fromEntries(op.set.map((e) => [e.name, e.variable as unknown as Variable]))
      if (op.unset) out.unset = op.unset
      return out
    }
    case "set_theme_axes": {
      const out: Op = { op: "setThemes" }
      if (op.set) out.set = Object.fromEntries(op.set.map((e) => [e.axis, e.values]))
      if (op.unset) out.unset = op.unset
      return out
    }
  }
}

type CommandWire = Exclude<
  WireOp,
  | InsertWire
  | UpdateWire
  | MoveWire
  | DeleteWire
  | SetVariablesWire
  | SetThemeAxesWire
  | CopyWire
  | ReplaceWire
  | PageWire
>

/** Command wire ops → M3 command(s). `theme_axis` and `reset_override` pick the command by action. */
export function toCommand(op: CommandWire, resolve: RefResolver, newId: () => string): M3Command {
  switch (op.op) {
    case "instantiate": {
      const placement: Extract<M3Command, { cmd: "createInstance" }>["placement"] = {
        parent: parentOf(op.parent, resolve),
        id: newId(),
      }
      if (op.at !== undefined) placement.at = op.at
      if (op.index !== undefined) placement.index = op.index
      if (op.x !== undefined) placement.x = op.x
      if (op.y !== undefined) placement.y = op.y
      if (op.name !== undefined) placement.name = op.name
      return {
        cmd: "createInstance",
        of: op.of.startsWith("@") ? resolve(op.of) : op.of,
        placement,
      }
    }
    case "make_component": {
      const options: Extract<M3Command, { cmd: "createComponent" }>["options"] = {}
      if (op.name !== undefined) options.name = op.name
      if (op.wrap) options.wrap = op.wrap
      return { cmd: "createComponent", ids: op.ids.map(resolve), options }
    }
    case "detach":
      return { cmd: "detachInstance", id: resolve(op.id) }
    case "set_override": {
      const change =
        op.kind === "set"
          ? { kind: "set" as const, set: op.set ?? {} }
          : op.kind === "slot"
            ? { kind: "slot" as const, content: (op.content ?? []).map((node) => ({ node })) }
            : { kind: "replace" as const, node: op.node ?? {} }
      return { cmd: "setOverride", instance: resolve(op.instance), path: op.path ?? "", change }
    }
    case "reset_override":
      if (op.all) return { cmd: "resetAllOverrides", instance: resolve(op.instance) }
      return {
        cmd: "resetOverride",
        instance: resolve(op.instance),
        path: op.path ?? "",
        ...(op.fields ? { options: { fields: op.fields } } : {}),
      }
    case "set_args":
      return {
        cmd: "setArgs",
        instance: resolve(op.instance),
        args: Object.fromEntries(op.args.map((a) => [a.name, a.value])),
      }
    case "swap_instance":
      return {
        cmd: "swapInstance",
        instance: resolve(op.instance),
        of: op.of,
        ...(op.path !== undefined ? { path: op.path } : {}),
      }
    case "declare_prop":
      return {
        cmd: "declareProp",
        component: resolve(op.component),
        name: op.name,
        def: op.def as unknown as Extract<M3Command, { cmd: "declareProp" }>["def"],
      }
    case "remove_prop":
      return { cmd: "removeProp", component: resolve(op.component), name: op.name }
    case "set_slot":
      return {
        cmd: "setSlot",
        frame: resolve(op.frame),
        slot: op.remove ? null : { suggested: op.suggested ?? [] },
        ...(op.deleteContent !== undefined ? { deleteContent: op.deleteContent } : {}),
      }
    case "create_variable":
      return { cmd: "createVariable", name: op.name, variable: op.variable as unknown as Variable }
    case "update_variable": {
      const patch: Extract<M3Command, { cmd: "updateVariable" }>["patch"] = {}
      if (op.value !== undefined) patch.value = op.value
      if (op.group !== undefined) patch.group = op.group
      if (op.description !== undefined) patch.description = op.description
      for (const f of op.unset ?? []) patch[f] = null
      return { cmd: "updateVariable", name: op.name, patch }
    }
    case "rename_variable":
      return { cmd: "renameVariable", from: op.from, to: op.to }
    case "delete_variable":
      return { cmd: "deleteVariable", name: op.name, ...(op.detach ? { detach: true } : {}) }
    case "set_theme_pin":
      return {
        cmd: "setThemePin",
        node: resolve(op.node),
        axis: op.axis,
        value: op.inherit ? null : (op.value ?? null),
      }
    case "theme_axis":
      switch (op.action) {
        case "create":
          return { cmd: "createAxis", axis: op.axis, values: op.values ?? [] }
        case "rename":
          return { cmd: "renameAxis", from: op.axis, to: op.to ?? "" }
        case "delete":
          return { cmd: "deleteAxis", axis: op.axis }
        case "add_value":
          return {
            cmd: "addAxisValue",
            axis: op.axis,
            value: op.value ?? "",
            ...(op.index !== undefined ? { index: op.index } : {}),
          }
        case "move_value":
          return {
            cmd: "moveAxisValue",
            axis: op.axis,
            value: op.value ?? "",
            index: op.index ?? 0,
          }
        case "rename_value":
          return { cmd: "renameAxisValue", axis: op.axis, from: op.value ?? "", to: op.to ?? "" }
        case "remove_value":
          return {
            cmd: "removeAxisValue",
            axis: op.axis,
            value: op.value ?? "",
            ...(op.force ? { force: true } : {}),
          }
      }
  }
}
