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
    "Reads nodes as .kimo data (a flat list; feed bodies back into insert/replace). select by ids or filters; depth = child levels (default 1, 0 = matches only). include bounds / problems for computed boxes and layout issues. Paginated by cursor.",
  input: Obj({
    docId,
    select: Obj(
      {
        ids: Opt(Arr(nodeIdField("Node id or IdPath."), { description: "Nodes.", maxItems: 500 })),
        under: Opt(nodeIdField("Subtree root.")),
        topLevel: Opt(Bool({ description: "Top-level nodes." })),
        name: Opt(Str({ description: "Name contains." })),
        type: Opt(Arr(Str({ description: "Node type." }), { description: "Types." })),
        text: Opt(Str({ description: "Text contains." })),
        component: Opt(Str({ description: "Instances of this component." })),
        page: Opt(Str({ description: "Page id." })),
      },
      { description: "At least one selector." },
    ),
    depth: Opt(Int({ description: "Child levels (default 1).", minimum: 0, maximum: 10 })),
    resolveVariables: Opt(Bool({ description: "Variable refs → values." })),
    theme: Opt(
      Arr(Obj({ axis: Str({ description: "Axis." }), value: Str({ description: "Value." }) }), {
        description: "Theme for resolveVariables.",
      }),
    ),
    resolveInstances: Opt(Bool({ description: "Expand instance content." })),
    include: Opt(
      Arr(Enum(QUERY_INCLUDES, { description: "Extra." }), { description: "Extra data." }),
    ),
    fields: Opt(Arr(Str({ description: "Field." }), { description: "Only these fields." })),
    limit: Opt(Int({ description: "Page size (default 200).", minimum: 1, maximum: 1000 })),
    cursor: Opt(Str({ description: "nextCursor." })),
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
    "Variables (tokens) and theme axes, including linked libraries' (alias:name). resolve=true adds resolved values.",
  input: Obj({
    docId,
    names: Opt(Arr(Str({ description: "Name." }), { description: "Only these.", maxItems: 500 })),
    group: Opt(Str({ description: "Group prefix." })),
    includeLibraries: Opt(Bool({ description: "Default true." })),
    resolve: Opt(Bool({ description: "Add resolved values." })),
    theme: Opt(
      Arr(Obj({ axis: Str({ description: "Axis." }), value: Str({ description: "Value." }) }), {
        description: "Theme for resolve.",
      }),
    ),
    includeUsages: Opt(Bool({ description: "Count bound nodes." })),
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
    "Components (local and library alias:id) with props, slots and instance counts, for ops instantiate, set_args and set_override.",
  input: Obj({
    docId,
    query: Opt(Str({ description: "Name contains." })),
    includeLibraries: Opt(Bool({ description: "Default true." })),
    limit: Opt(Int({ description: "Default 200.", minimum: 1, maximum: 1000 })),
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
  description: "A free x/y for a w×h box that overlaps nothing (next to near, default right).",
  input: Obj({
    docId,
    w: Num({ description: "Width.", minimum: 1 }),
    h: Num({ description: "Height.", minimum: 1 }),
    near: Opt(nodeIdField("Node to search next to.")),
    direction: Opt(Enum(["right", "below", "left", "above"], { description: "Default right." })),
    padding: Opt(Num({ description: "Gap (default 80).", minimum: 0 })),
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
    "Schema errors and lint warnings (same engine as kimo validate); ids limits it to subtrees.",
  input: Obj({
    docId,
    ids: Opt(Arr(nodeIdField("Node id."), { description: "Subtrees.", maxItems: 500 })),
    lints: Opt(Bool({ description: "Default true." })),
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
