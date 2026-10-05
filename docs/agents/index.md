<!-- Generated from packages/mcp-server/guides/index.md by scripts/gen-guides.ts. Agents read the same text with kimo_read_docs {path: "index"}. MIT licence. -->

# Kimo agent guides

Kimo is a local design canvas. A design is a `.kimo` file: plain JSON, one flat table of
nodes, safe to diff and merge in git. You never edit that file directly while Kimo has it open.
You edit through tools, and each call is one atomic, undoable change.

## The loop

1. Inside the Kimo app the turn context already names the document (`docId`) and outlines the
   page (ids, names, types, boxes). Otherwise `kimo_get_state` lists open documents (`docId`),
   selection, top-level frames, components, variables and your permissions. Open more files with
   `kimo_open {path}`.
2. Read before writing: `kimo_query {docId, select, depth}` for nodes, `kimo_get_variables` for
   tokens, `kimo_list_components` for reusable parts.
3. Write with `kimo_apply_ops {docId, baseRevision, ops:[…]}`. Up to 500 typed ops in one call,
   applied all-or-nothing, of which at most 40 `insert`s (new layers), 150 when your client
   streams tool input. New nodes get `key`s; later ops refer to them as `@key`. Show work early:
   one finished section per call (the limit is a ceiling, not a target), with a one-line note
   before each call saying what you are doing. Copy what already exists (a variant starts with
   one `copy` of the page) instead of re-creating it. A failed call returns `retryId`: fix it
   with `{docId, retryId, edits:[{find, replace}]}`. To build a section, `kimo_script` is
   shorter: a JavaScript program whose `Insert` / `Update` / … calls compile to the same ops,
   with loops and functions for repeated cards and rows (see `script`).
4. Verify: each result's `data.problems` lists problems in what you just changed; fix them in
   the next call. `render: true` on an edit (or `kimo_render {docId, ids}`) returns a PNG, and
   `kimo_validate {check: true}` lists what is left. Finish with none.
5. Save when asked (`kimo_save`), or let autosave do it.

Every document tool needs an explicit `docId`. Nothing falls back to an "active" document.
Every result is a JSON envelope `{ok, summary, revision, warnings, errors}`, so branch on
`errors[].code` and don't parse prose.

## Guides

| Path | Read it when |
|---|---|
| `schema` | Before your first edit: the node model, node types, fields, ids |
| `ops` | Before your first edit: every `kimo_apply_ops` op, with examples |
| `script` | Building with `kimo_script`: the API, streaming, globals, limits |
| `layout` | Building anything with rows, columns, padding or fill/fit sizing |
| `text` | Typography, text growth and wrapping, rich text runs |
| `components` | Components, instances, overrides, declared props, slots |
| `tokens` | Variables, bindings, theme axes and pins |
| `envelope` | Results, revisions, dry runs, undo, and the verification loop |
| `errors` | Any error code, what caused it and how to fix it |
| `guide/steps` | Building anything bigger than a few layers, or a variant of existing work |
| `guide/web` | Designing desktop web pages |
| `guide/mobile` | Designing phone screens |
| `guide/tables` | Data tables and lists |
| `guide/export` | Exporting PNGs and handing designs to code |
| `tools` | The details each tool description leaves out (limits, options, edge cases) |

Read with `kimo_read_docs {path}`, or as the MCP resource `kimo://docs/{path}`.
These guides are MIT licensed.
