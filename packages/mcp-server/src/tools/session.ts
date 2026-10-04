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
  selection: Arr(Str({ description: "Node id." }), {
    description: "Selected ids in the frontmost window showing it (empty headless).",
  }),
  topLevel: Arr(NodeSummary, {
    description: "Top-level nodes (first 50; use kimo_query for more).",
  }),
  topLevelCount: Int({ description: "Total top-level nodes.", minimum: 0 }),
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
    "Start here. Lists every open Kimo document (docId, path, dirty, revision), the selection, top-level nodes with visibility hints, components, a variables/themes summary and other connected agents. Pass docId to describe one document only. Your permissions are in data.you. Then call kimo_read_docs for the schema and ops guides, kimo_open to open a .kimo file, or kimo_query to read nodes.",
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
  "components",
  "tokens",
  "layout",
  "text",
  "errors",
  "envelope",
  "guide/web",
  "guide/mobile",
  "guide/tables",
  "guide/export",
] as const

export const kimoReadDocs = defineTool({
  name: "kimo_read_docs",
  title: "Read Kimo guides",
  description:
    "Returns an MIT-licensed agent guide as markdown. No path = the index (what each guide covers). Read 'schema' (the .kimo node format) and 'ops' (kimo_apply_ops examples) before your first edit; 'errors' explains every error code. Guides are also MCP resources kimo://docs/{path}.",
  input: Obj({ path: Opt(Enum(DOC_PATHS, { description: "Guide to read; omit for the index." })) }),
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
    "Opens a .kimo document by absolute path and returns its docId. Never writes the file. If it is already open, returns the existing docId. A file that fails to load returns LOAD_FAILED and stays untouched; a newer format opens read-only. If another process holds the file's lease you get DOCUMENT_LOCKED with the holder. Files outside your allow-list ask the user each time.",
  input: Obj({
    path: absPath("Absolute path of the .kimo file."),
    readOnly: Opt(Bool({ description: "Open without taking the write lease." })),
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
    "Closes a document you opened. A dirty document is refused unless save=true (atomic save first) or discard=true (drops unsaved edits; asks the user). Documents the user has open in a window are never closed for them: you only drop your own reference.",
  input: Obj({
    docId,
    save: Opt(Bool({ description: "Save before closing." })),
    discard: Opt(Bool({ description: "Close even with unsaved edits (destructive; asks)." })),
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
  description:
    "Creates a new .kimo document at an absolute path and opens it. Refuses to overwrite: an existing path returns FILE_EXISTS. Optional template seeds variables and a starter frame. Needs the files.create grant (asks otherwise).",
  input: Obj({
    path: absPath("Absolute path for the new file (must end in .kimo and not exist)."),
    name: Opt(Str({ description: "Document name (meta.name)." })),
    template: Opt(
      Enum(["blank", "web", "mobile", "design-system"], {
        description: "Starter content. Default blank.",
      }),
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
    "Atomic save: temp file → fsync → rename → read back → SHA-256 compare. Reports bytes, hash and mtime only after the read-back matched; never says 'saved' otherwise. Autosave also runs in the desktop app; call this when you need a durable checkpoint (e.g. before running a build). Pass baseRevision to save only the state you reviewed.",
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
    "list: recent op groups with author. undo / redo: undo or redo YOUR OWN last op group (your origin's undo stack; never the user's or another agent's edits). With token (undoToken from an earlier result) undo succeeds only if that group is on top of your stack. Replay is guarded: if later edits by others touched the same nodes, the result reports stale=true instead of clobbering them.",
  input: Obj({
    docId,
    action: Enum(["list", "undo", "redo"], { description: "What to do." }),
    token: Opt(Str({ description: "undo: the undoToken of the group you expect on top." })),
    limit: Opt(
      Int({ description: "list: entries, newest first (default 20).", minimum: 1, maximum: 200 }),
    ),
  }),
  data: Obj({
    entries: Opt(Arr(HistoryEntry, { description: "list: newest first." })),
    stale: Opt(Bool({ description: "undo/redo: the group no longer had any effect." })),
    canUndo: Bool({ description: "Your undo stack is not empty." }),
    canRedo: Bool({ description: "Your redo stack is not empty." }),
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
  description:
    "Selects nodes and/or scrolls and zooms the editor to them, so the user sees your work. Changes only the view, never the document. Headless or with no window showing the document, it succeeds with a NO_WINDOW warning.",
  input: Obj({
    docId,
    ids: Arr(nodeIdField("Node id."), {
      description: "Nodes to show.",
      minItems: 1,
      maxItems: 200,
    }),
    select: Opt(Bool({ description: "Also select them (default true)." })),
    zoom: Opt(
      Enum(["fit", "keep", "100"], { description: "fit (default), keep the zoom, or 100%." }),
    ),
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
    "Open style presets. No name: list presets. name: the parameters the preset takes. name+params: prose guidance plus tokens. apply=true with docId writes the tokens as variables (one undoable edit; scope edit + globals grant).",
  input: Obj({
    name: Opt(Str({ description: "Preset name from the list." })),
    params: Opt(
      Open(
        { palette: Opt(Str({ description: "Palette choice (example parameter)." })) },
        {
          description:
            "Preset parameters as listed by kimo_styles {name}; validated by the preset.",
        },
      ),
    ),
    apply: Opt(Bool({ description: "Write the tokens into docId as variables." })),
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
