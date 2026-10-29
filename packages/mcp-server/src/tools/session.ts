/**
 * Session tools: state, docs, open / close / create, save, history, focus (teardown 11.3).
 */
import { DocRefSchema, RevisionSchema } from "../envelope"
import { Arr, Bool, Enum, Int, Num, Obj, Open, Opt, Str } from "../schema"
import {
  ALL_HOSTS,
  baseRevision,
  DEFAULT_TIMEOUT_MS,
  defineTool,
  docId,
  NOT_WEB,
  nodeIdField,
  optDocId,
  READ,
  WRITE,
  WRITE_MAYBE_DESTRUCTIVE,
} from "./define"

const absPath = (description: string) =>
  Str({ description, minLength: 1, pattern: "^(?:/|[A-Za-z]:[\\\\/]|untitled:).*" })

const NodeSummary = Obj({
  id: Str({ description: "Node id." }),
  type: Str({ description: "Node type." }),
  name: Opt(Str({ description: "Layer name." })),
  visible: Opt(Bool({ description: "False when hidden (visible:false)." })),
  inViewport: Opt(
    Bool({ description: "Visible in a window's viewport right now (desktop with a window only)." }),
  ),
  bounds: Opt(
    Obj(
      {
        x: Num({ description: "X (canvas space)." }),
        y: Num({ description: "Y." }),
        w: Num({ description: "Width." }),
        h: Num({ description: "Height." }),
      },
      { description: "Resolved bounds." },
    ),
  ),
})

const OpenDoc = Obj({
  doc: DocRefSchema,
  revision: RevisionSchema,
  name: Opt(Str({ description: "meta.name or file name." })),
  shared: Opt(
    Obj(
      {
        relay: Opt(Str({ description: "Host of the relay the room syncs through." })),
        role: Enum(["edit", "view"], {
          description: "Your link's role. view: edits fail with READ_ONLY.",
        }),
      },
      {
        description:
          "Set for a room joined from a share link (path kimo-room:<room>). It has no file: edits sync live to everyone in it.",
      },
    ),
  ),
  selection: Arr(Str({ description: "Node id." }), {
    description: "Selected ids in the frontmost window showing it (empty headless).",
  }),
  topLevel: Arr(NodeSummary, {
    description: "Top-level nodes (first 50; use kimo_query for more).",
  }),
  topLevelCount: Int({ description: "Total top-level nodes.", minimum: 0 }),
  pages: Arr(
    Obj({
      id: Opt(
        Str({
          description:
            "Page id (set it as `page` on a top-level node to put it on this page); absent for the single implicit page of a document without pages.",
        }),
      ),
      name: Str({ description: "Page name." }),
      topLevelCount: Int({ description: "Top-level nodes on the page.", minimum: 0 }),
    }),
    {
      description:
        "Pages in display order (spec §5.6). A top-level node without `page` is on the first page; filter kimo_query with select.page.",
    },
  ),
  components: Arr(
    Obj({
      id: Str({ description: "Component id." }),
      name: Str({ description: "Component name." }),
    }),
    { description: "Local components (first 100; kimo_list_components for details)." },
  ),
  variables: Obj(
    {
      count: Int({ description: "Variables in the document.", minimum: 0 }),
      axes: Arr(
        Obj({
          axis: Str({ description: "Axis." }),
          values: Arr(Str({ description: "Value." }), { description: "Values; first = default." }),
        }),
        { description: "Theme axes." },
      ),
    },
    { description: "Variables summary." },
  ),
  agents: Arr(
    Obj({
      origin: Str({ description: "mcp:<client>.<session> or agent:<id>." }),
      label: Str({ description: "Display name." }),
      state: Str({ description: "idle | reading | editing | rendering | waiting-approval." }),
    }),
    { description: "Other agents connected to this document." },
  ),
})

export const kimoGetState = defineTool({
  name: "kimo_get_state",
  title: "Get Kimo state",
  description:
    "Open documents (docId, path, revision), selection, top-level nodes, pages, components, variables summary and your permissions. docId: that document only.",
  input: Obj({ docId: optDocId }),
  data: Obj({
    app: Obj(
      {
        mode: Enum(["desktop", "headless", "web"], { description: "Who holds the documents." }),
        version: Str({ description: "Kimo version." }),
        windows: Int({ description: "Editor windows open (0 headless).", minimum: 0 }),
      },
      { description: "Host." },
    ),
    documents: Arr(OpenDoc, { description: "Open documents (one when docId was given)." }),
    you: Obj(
      {
        origin: Str({ description: "Your origin (mcp:<client>.<session>); your undo stack." }),
        level: Enum(["read", "edit", "edit+delete"], { description: "Permission level." }),
        files: Arr(Str({ description: "Glob." }), { description: "Files you may open." }),
        grants: Arr(Str({ description: "Grant." }), { description: "Extra grants." }),
      },
      { description: "Your identity and permissions." },
    ),
  }),
  annotations: READ,
  scope: "read",
  doc: "optional",
  mutating: false,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  availability: ALL_HOSTS,
  status: "m5",
})

export const DOC_PATHS = [
  "index",
  "schema",
  "ops",
  "script",
  "components",
  "tokens",
  "layout",
  "text",
  "errors",
  "envelope",
  "guide/steps",
  "guide/web",
  "guide/mobile",
  "guide/tables",
  "guide/export",
  "tools",
] as const

export const kimoReadDocs = defineTool({
  name: "kimo_read_docs",
  title: "Read Kimo guides",
  description:
    "Agent guide (markdown). No path = index. schema: node fields; ops: op examples; layout; text; components; tokens; errors: every error code; tools: tool details.",
  input: Obj({ path: Opt(Enum(DOC_PATHS, { description: "Guide (omit for the index)." })) }),
  data: Obj({
    path: Str({ description: "Guide path." }),
    markdown: Str({ description: "Guide text." }),
    related: Arr(Str({ description: "Guide path." }), {
      description: "Guides worth reading next.",
    }),
  }),
  annotations: READ,
  scope: "read",
  doc: "none",
  mutating: false,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  availability: ALL_HOSTS,
  status: "m5",
})

export const kimoOpen = defineTool({
  name: "kimo_open",
  title: "Open a .kimo file",
  description:
    "Opens a .kimo file by absolute path and returns its docId (the existing one when already open). Never writes the file.",
  input: Obj({
    path: absPath("Absolute .kimo path."),
    readOnly: Opt(Bool({ description: "No write lease." })),
  }),
  data: Obj({
    doc: DocRefSchema,
    revision: RevisionSchema,
    alreadyOpen: Bool({ description: "The document was open before this call." }),
    format: Str({ description: "File format version." }),
    readOnlyReason: Opt(
      Str({
        description: "Why it is read-only (newer format, unknown feature, lock, failed load).",
      }),
    ),
  }),
  annotations: { ...READ, idempotentHint: true },
  scope: "read",
  doc: "none",
  mutating: false,
  timeoutMs: 60_000,
  availability: NOT_WEB,
  status: "m5",
})

export const kimoClose = defineTool({
  name: "kimo_close",
  title: "Close a document",
  description:
    "Closes a document you opened. With unsaved edits: save=true or discard=true (asks the user).",
  input: Obj({
    docId,
    save: Opt(Bool({ description: "Save first." })),
    discard: Opt(Bool({ description: "Drop unsaved edits." })),
  }),
  data: Obj({
    closed: Bool({
      description: "The document was closed in the host (false: still open in a window).",
    }),
    saved: Bool({ description: "A save happened." }),
  }),
  annotations: WRITE_MAYBE_DESTRUCTIVE,
  scope: "read",
  scopeFor: (i) => (i.discard ? "delete" : i.save ? "edit" : "read"),
  doc: "required",
  mutating: false,
  timeoutMs: 60_000,
  availability: NOT_WEB,
  status: "m5",
})

export const kimoCreate = defineTool({
  name: "kimo_create",
  title: "Create a .kimo file",
  description: "Creates a new .kimo file at an absolute path (never overwrites) and opens it.",
  input: Obj({
    path: absPath("Absolute path ending in .kimo."),
    name: Opt(Str({ description: "Document name." })),
    template: Opt(
      Enum(["blank", "web", "mobile", "design-system"], { description: "Default blank." }),
    ),
  }),
  data: Obj({
    doc: DocRefSchema,
    revision: RevisionSchema,
    bytes: Int({ description: "Bytes written.", minimum: 0 }),
    sha256: Str({ description: "Hash of the written file (read back)." }),
  }),
  annotations: { ...WRITE, idempotentHint: false },
  scope: "edit",
  grant: "files.create",
  doc: "none",
  mutating: false,
  timeoutMs: 60_000,
  availability: NOT_WEB,
  status: "m5",
})

export const kimoSave = defineTool({
  name: "kimo_save",
  title: "Save a document",
  description:
    "Atomic save, verified by read-back. Autosave also runs; save for a durable checkpoint.",
  input: Obj({ docId, baseRevision }),
  data: Obj({
    path: Str({ description: "Saved path." }),
    bytes: Int({ description: "Bytes written.", minimum: 0 }),
    sha256: Str({ description: "SHA-256 of the file as read back." }),
    mtimeMs: Num({ description: "File mtime after the save." }),
    savedRevision: RevisionSchema,
  }),
  annotations: { ...WRITE, idempotentHint: true },
  scope: "edit",
  grant: "save",
  doc: "required",
  mutating: false,
  timeoutMs: 60_000,
  availability: NOT_WEB,
  status: "m5",
})

const HistoryEntry = Obj({
  revision: RevisionSchema,
  origin: Str({ description: "Who made it (user, mcp:<client>.<session>, agent:<id>, file)." }),
  kind: Enum(["ops", "undo", "redo", "load", "repair"], { description: "Entry kind." }),
  label: Opt(Str({ description: "Op group label." })),
  time: Num({ description: "ms since epoch." }),
  opCount: Int({ description: "Ops in the group.", minimum: 0 }),
  undoToken: Opt(Str({ description: "Your own groups only: pass to undo." })),
})

export const kimoHistory = defineTool({
  name: "kimo_history",
  title: "History and undo",
  description:
    "list: recent op groups. undo / redo: your own last op group only; token = the undoToken of the group you expect on top.",
  input: Obj({
    docId,
    action: Enum(["list", "undo", "redo"], { description: "Action." }),
    token: Opt(Str({ description: "undo / redo: undoToken." })),
    limit: Opt(Int({ description: "list: entries (default 20).", minimum: 1, maximum: 200 })),
  }),
  data: Obj({
    entries: Opt(Arr(HistoryEntry, { description: "list: newest first." })),
    stale: Opt(Bool({ description: "undo/redo: the group no longer had any effect." })),
    canUndo: Bool({ description: "Your undo stack is not empty." }),
    canRedo: Bool({ description: "Your redo stack is not empty." }),
    undoToken: Opt(Str({ description: "redo: the group's token, valid again." })),
  }),
  annotations: WRITE,
  scope: "read",
  scopeFor: (i) => (i.action === "list" ? "read" : "edit"),
  doc: "required",
  mutating: true,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  availability: ALL_HOSTS,
  status: "m5",
})

export const kimoFocus = defineTool({
  name: "kimo_focus",
  title: "Show nodes in the editor",
  description: "Selects and zooms the editor to nodes so the user sees them. View only.",
  input: Obj({
    docId,
    ids: Arr(nodeIdField("Node id."), { description: "Nodes.", minItems: 1, maxItems: 200 }),
    select: Opt(Bool({ description: "Select them (default true)." })),
    zoom: Opt(Enum(["fit", "keep", "100"], { description: "Default fit." })),
  }),
  data: Obj({ shown: Bool({ description: "A window showed the nodes." }) }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "read",
  doc: "required",
  mutating: false,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  availability: ALL_HOSTS,
  status: "m5",
})

export const kimoStyles = defineTool({
  name: "kimo_styles",
  title: "Style presets",
  description:
    "Style presets. No name: list. name: its params. name+params: guidance and tokens; apply=true writes the tokens into docId as variables.",
  input: Obj({
    name: Opt(Str({ description: "Preset." })),
    params: Opt(
      Open(
        { palette: Opt(Str({ description: "Palette (example)." })) },
        { description: "Preset params (from kimo_styles {name}); validated by the preset." },
      ),
    ),
    apply: Opt(Bool({ description: "Write tokens as variables." })),
    docId: optDocId,
    baseRevision,
  }),
  data: Obj({
    presets: Opt(
      Arr(
        Obj({ name: Str({ description: "Preset." }), summary: Str({ description: "One line." }) }),
        { description: "List mode." },
      ),
    ),
    params: Opt(
      Arr(
        Obj({
          name: Str({ description: "Param." }),
          choices: Arr(Str({ description: "Choice." }), { description: "Allowed values." }),
        }),
        { description: "Describe mode." },
      ),
    ),
    markdown: Opt(Str({ description: "Guidance prose." })),
    variables: Opt(Int({ description: "Variables written (apply).", minimum: 0 })),
  }),
  annotations: WRITE,
  scope: "read",
  scopeFor: (i) => (i.apply ? "edit" : "read"),
  doc: "optional",
  mutating: true,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  availability: ALL_HOSTS,
  status: "m5",
})
