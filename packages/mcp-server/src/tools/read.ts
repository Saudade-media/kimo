/**
 * Read tools: query nodes, variables, components, free space, validation (teardown 11.3).
 * None of them is unbounded: every list is paginated or capped.
 */
import { WarningSchema } from "../envelope"
import { Arr, Bool, Enum, Int, Num, Obj, Open, Opt, Str } from "../schema"
import { ALL_HOSTS, DEFAULT_TIMEOUT_MS, defineTool, docId, nodeIdField, READ } from "./define"

export const QUERY_INCLUDES = ["bounds", "problems", "geometry", "origin", "overrides"] as const

const Bounds = Obj(
  {
    x: Num({ description: "X in canvas space." }),
    y: Num({ description: "Y in canvas space." }),
    w: Num({ description: "Width." }),
    h: Num({ description: "Height." }),
  },
  { description: "Resolved bounds in canvas space (include bounds)." },
)

const QueriedNode = Open(
  {
    id: Str({ description: "Node id (virtual instance children: instanceId/childId)." }),
    type: Str({ description: "Node type." }),
    parent: Opt(Str({ description: "Parent id (absent for top-level nodes)." })),
    depth: Int({ description: "Depth below the query root (0 = matched node).", minimum: 0 }),
    children: Opt(
      Arr(Str({ description: 'Child id, or "…" when elided by depth.' }), {
        description:
          "Child ids in order. Children are listed as separate entries when within depth.",
      }),
    ),
    bounds: Opt(Bounds),
    problems: Opt(
      Arr(
        Enum(
          [
            "partially-clipped",
            "fully-clipped",
            "collapsed",
            "overflow",
            "missing-font",
            "missing-asset",
          ],
          { description: "Problem." },
        ),
        { description: "Layout problems (include problems)." },
      ),
    ),
  },
  {
    description:
      "A node as .kimo data (fields per kimo://schema/1.0, defaults omitted) plus query metadata. Feeding the body back into insert/replace works.",
  },
)

export const kimoQuery = defineTool({
  name: "kimo_query",
  title: "Query nodes",
  description:
    'Declarative read of nodes. select by ids, and/or filter by name (substring, case-insensitive), type, text content, component (instances of), or under (subtree of). depth controls how many levels of children are returned (0 = matched nodes only; elided children show as "…"). resolveVariables replaces $variable refs with values for the given theme; resolveInstances expands instance content as virtual nodes (instanceId/childId). include adds bounds, layout problems (clipping, collapse, missing fonts), path geometry, override origin. Results are a flat list, paginated with cursor. The whole document is never dumped: give at least one selector or under.',
  input: Obj({
    docId,
    select: Obj(
      {
        ids: Opt(
          Arr(nodeIdField("Node id or IdPath."), { description: "Exact nodes.", maxItems: 500 }),
        ),
        under: Opt(
          nodeIdField('Only nodes inside this subtree ("root" not allowed: use topLevel).'),
        ),
        topLevel: Opt(Bool({ description: "Match the top-level nodes." })),
        name: Opt(Str({ description: "Name contains (case-insensitive)." })),
        type: Opt(Arr(Str({ description: "Node type." }), { description: "Any of these types." })),
        text: Opt(Str({ description: "Text content contains (text nodes)." })),
        component: Opt(
          Str({ description: "Instances of this component id (alias:id for libraries)." }),
        ),
        page: Opt(
          Str({
            description:
              "Only nodes on this page (a page id from kimo_get_state; with topLevel: the page's top-level nodes).",
          }),
        ),
      },
      { description: "At least one of ids, under, topLevel, name, type, text, component, page." },
    ),
    depth: Opt(
      Int({
        description: "Levels of children per match (default 1, max 10).",
        minimum: 0,
        maximum: 10,
      }),
    ),
    resolveVariables: Opt(Bool({ description: "Replace variable refs by their values." })),
    theme: Opt(
      Arr(Obj({ axis: Str({ description: "Axis." }), value: Str({ description: "Value." }) }), {
        description: "Theme for resolveVariables (default: each node's effective theme).",
      }),
    ),
    resolveInstances: Opt(Bool({ description: "Expand instance content as virtual nodes." })),
    include: Opt(
      Arr(Enum(QUERY_INCLUDES, { description: "Extra data." }), {
        description: "Extra data per node.",
      }),
    ),
    fields: Opt(
      Arr(Str({ description: "Field name." }), {
        description: "Return only these .kimo fields (plus id/type/parent).",
      }),
    ),
    limit: Opt(
      Int({
        description: "Max nodes per page (default 200, max 1000).",
        minimum: 1,
        maximum: 1000,
      }),
    ),
    cursor: Opt(Str({ description: "nextCursor from the previous page." })),
  }),
  data: Obj({
    nodes: Arr(QueriedNode, { description: "Matched nodes and their children up to depth." }),
    matched: Int({ description: "Number of matches (before depth expansion).", minimum: 0 }),
    nextCursor: Opt(Str({ description: "Present when more results exist." })),
  }),
  annotations: READ,
  scope: "read",
  doc: "required",
  mutating: false,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  availability: ALL_HOSTS,
  status: "m5",
})

const VariableOut = Obj({
  name: Str({ description: "Variable name (alias:name for libraries)." }),
  type: Str({ description: "Variable type." }),
  value: Open(
    { kind: Enum(["literal", "themed", "alias"], { description: "How the value is stored." }) },
    { description: "{kind, raw} as stored (.kimo Variable value), plus resolved when requested." },
  ),
  group: Opt(Str({ description: "DTCG group path." })),
  description: Opt(Str({ description: "Description." })),
  usages: Opt(Int({ description: "Nodes binding it (includeUsages).", minimum: 0 })),
})

export const kimoGetVariables = defineTool({
  name: "kimo_get_variables",
  title: "Get variables and themes",
  description:
    "Variables (tokens) and theme axes of a document, including linked libraries' variables (alias:name). Filter by names or group prefix. resolve=true adds each value resolved for the given theme (default theme otherwise). Edit them with kimo_apply_ops ops create_variable / update_variable / rename_variable / delete_variable / theme_axis.",
  input: Obj({
    docId,
    names: Opt(
      Arr(Str({ description: "Variable name." }), { description: "Only these.", maxItems: 500 }),
    ),
    group: Opt(Str({ description: "Only variables whose group starts with this." })),
    includeLibraries: Opt(
      Bool({ description: "Include linked libraries' variables (default true)." }),
    ),
    resolve: Opt(Bool({ description: "Add resolved values." })),
    theme: Opt(
      Arr(Obj({ axis: Str({ description: "Axis." }), value: Str({ description: "Value." }) }), {
        description: "Theme for resolve.",
      }),
    ),
    includeUsages: Opt(Bool({ description: "Count bound nodes per variable (slower)." })),
  }),
  data: Obj({
    variables: Arr(VariableOut, { description: "Variables, by name." }),
    axes: Arr(
      Obj({
        axis: Str({ description: "Axis name." }),
        values: Arr(Str({ description: "Value." }), { description: "Values; first = default." }),
      }),
      { description: "Theme axes." },
    ),
  }),
  annotations: READ,
  scope: "read",
  doc: "required",
  mutating: false,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  availability: ALL_HOSTS,
  status: "m5",
})

export const kimoListComponents = defineTool({
  name: "kimo_list_components",
  title: "List components",
  description:
    "Components available in a document: local mains and linked-library components (alias:id), with declared props, slots and instance counts. Use the id with kimo_apply_ops instantiate; set props with set_args; fill slots with set_override kind=slot.",
  input: Obj({
    docId,
    query: Opt(Str({ description: "Name contains (case-insensitive)." })),
    includeLibraries: Opt(Bool({ description: "Include linked libraries (default true)." })),
    limit: Opt(Int({ description: "Max results (default 200).", minimum: 1, maximum: 1000 })),
  }),
  data: Obj({
    components: Arr(
      Obj({
        id: Str({ description: "Component id or alias:id." }),
        name: Str({ description: "Name." }),
        library: Opt(Str({ description: "Library alias when linked." })),
        description: Opt(Str({ description: "Component description." })),
        props: Arr(
          Obj({
            name: Str({ description: "Prop name." }),
            type: Enum(["text", "boolean", "instance", "enum", "slot"], {
              description: "Prop kind.",
            }),
            options: Opt(Arr(Str({ description: "Option." }), { description: "enum options." })),
          }),
          { description: "Declared props." },
        ),
        slots: Arr(Str({ description: "Slot IdPath." }), { description: "Slots." }),
        instances: Int({ description: "Instances in this document.", minimum: 0 }),
        size: Opt(
          Obj(
            { w: Num({ description: "Width." }), h: Num({ description: "Height." }) },
            { description: "Main's size." },
          ),
        ),
      }),
      { description: "Components." },
    ),
  }),
  annotations: READ,
  scope: "read",
  doc: "required",
  mutating: false,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  availability: ALL_HOSTS,
  status: "m5",
})

export const kimoFindSpace = defineTool({
  name: "kimo_find_space",
  title: "Find empty canvas space",
  description:
    "Returns a free position on the canvas (or inside a frame) for a w×h box, so new top-level frames do not overlap existing work. Insert at the returned x/y with parent from the result.",
  input: Obj({
    docId,
    w: Num({ description: "Width needed.", minimum: 1 }),
    h: Num({ description: "Height needed.", minimum: 1 }),
    near: Opt(nodeIdField("Search next to this node (default: the whole canvas).")),
    direction: Opt(
      Enum(["right", "below", "left", "above"], {
        description: "Where to look first (default right).",
      }),
    ),
    padding: Opt(Num({ description: "Gap to keep from other nodes (default 80).", minimum: 0 })),
  }),
  data: Obj({
    x: Num({ description: "X." }),
    y: Num({ description: "Y." }),
    parent: Str({ description: '"root" or the frame to insert into.' }),
  }),
  annotations: READ,
  scope: "read",
  doc: "required",
  mutating: false,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  availability: ALL_HOSTS,
  status: "m5",
})

export const kimoValidate = defineTool({
  name: "kimo_validate",
  title: "Validate",
  description:
    "Schema validation plus lints (same engine as `kimo validate`): errors make the document invalid; warnings (e.g. TEXT_NO_FILL, CONFLICT_OPEN) are fixable issues. Restrict to ids to check a section you just built.",
  input: Obj({
    docId,
    ids: Opt(Arr(nodeIdField("Node id."), { description: "Only these subtrees.", maxItems: 500 })),
    lints: Opt(Bool({ description: "Include lint warnings (default true)." })),
  }),
  data: Obj({
    valid: Bool({ description: "No errors." }),
    errors: Arr(WarningSchema, { description: "Schema errors (code, message, nodeId)." }),
    warnings: Arr(WarningSchema, { description: "Lints." }),
  }),
  annotations: READ,
  scope: "read",
  doc: "required",
  mutating: false,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  availability: ALL_HOSTS,
  status: "m5",
})
