<!-- related: index, envelope, errors -->
# Tool details

Tool descriptions stay short (every model call carries them); the details are here.

## Session

- `kimo_get_state`: when the context gives no `docId`. Top-level nodes (first 50, `inViewport`
  when a window shows the file), components (first 100), other agents, your permissions
  (`data.you`), and `data.target`: the file and frames to edit, or `unclear`. `documents[].front`
  marks the file in the tab the person used last.
  - Kimo resolves the target from the person's selection in the front tab, your own last edit,
    open or pick, the front tab and its view, or the only candidate (`target.via` says which).
    Plain `kimo_get_state` never asks; when only the frame is unclear, `target.docId` is the file.
  - `target.page` is the page Kimo shows for that file (else the first): set it as `page` on a
    new top-level frame. An empty page gives `frameIds: []`.
  - `pick: "frame"` (or `"file"`) before the first edit of each request that does not name the
    file and frame: your recent work comes back at once when nothing changed; when two or more
    candidates are left, a client that supports elicitation shows the person a picker (up to 20
    choices, plus "I'll select it in Kimo" when a window is open). Pass `docId` only when the
    request names the file. A closed picker is `CANCELLED`; a client without elicitation gets
    `TARGET_UNCLEAR` with `detail.choices` to ask about in chat. A failed or timed-out pick
    counts as cancelled.
  - Twin guard: your first write to a file while the front tab shows another open file with the
    same name fails `TARGET_UNCLEAR` (`reason: "twin"`). Call `kimo_get_state {pick: "file"}`
    without `docId` and edit the file it returns.
- `kimo_open`: a file that fails to load gives `LOAD_FAILED` (untouched); a newer format opens
  read-only; another process's write lease gives `DOCUMENT_LOCKED`; files outside your
  allow-list ask the user.
- `kimo_create {path, template?}`: never overwrites (`FILE_EXISTS`); `template` seeds variables
  and a starter frame. Needs the `files.create` grant (asks otherwise).
- `kimo_close`: a dirty document needs `save` or `discard` (asks the user). A document open in
  a window stays open: only your reference is dropped.
- `kimo_save {docId, baseRevision?}`: temp file → fsync → rename → read back → SHA-256 compare.
  Reported only after the read-back matched.
- `kimo_history`: `list` shows recent op groups with their author. `undo` / `redo` act on your
  own origin's stack only, never on the user's or another agent's edits; with `token` (an
  `undoToken`) undo succeeds only when that group is on top. Replay is guarded: when later edits
  by others touched the same nodes the result says `stale: true` instead of clobbering them.
- `kimo_focus`: with no window it succeeds with a `NO_WINDOW` warning.

## Reading

- `kimo_query`: `select` needs at least one of `ids`, `under`, `topLevel`, `name` (substring,
  case-insensitive), `type`, `text`, `component` (instances of), `page`; `under: "root"` is not
  allowed (use `topLevel`). `depth` 0–10 (elided children show as `"…"`). `resolveVariables`
  replaces `$ref`s with values for `theme` (default: each node's effective theme);
  `resolveInstances` expands instance content as virtual nodes (`instanceId/childId`).
  `include`: `bounds` (computed boxes), `problems` (clipping, collapse, overflow, missing
  fonts/assets), `geometry`, `origin` (override origin), `overrides`. `limit` ≤ 1000, then
  `cursor`. The whole document is never dumped.
- `kimo_get_variables`: `includeUsages` counts bound nodes (slower). Edit variables with ops
  (`create_variable`, `update_variable`, `rename_variable`, `delete_variable`, `theme_axis`).

## Editing

- `kimo_apply_ops`: see `ops`. Limits: 500 ops per call, of which at most 40 `insert`s (150
  streamed: ops land while the model writes the call). Failures carry `retryId` (see `ops`).
  `dryRun` returns the would-be ops; `render: true` attaches a PNG of the changed top-level
  frames. Results leave out `ops` / `inverse` (a dry run keeps `ops`). `data.problems` lists
  problems in the changed layers: fix them next.
- `kimo_import`: `svg` (editable vector layers), `image` (hashed into `assets/`, placed as an
  image-filled rect), `tokens-dtcg` / `tokens-css` (variables, merged). Exactly one of `path`
  (absolute, allow-list applies) or `text`. Supports `dryRun` and `baseRevision`.
- `kimo_assets`: `import` hashes an image or font into `assets/` and returns its `./assets/`
  reference for fills or fonts (no node is created; `kimo_import kind=image` places one).
  `fonts`: document, cached, local and (when allowed) Google families. Use `check_font` before
  referencing a font.
- `kimo_styles {apply: true}` needs scope edit plus the globals grant.

## Output

- `kimo_render`: the same CanvasKit engine as the canvas; always reflects every committed edit.
  `scale` ≤ 4, `maxSize` (longest side, default 1600) caps the image. `format: "svg"` returns
  standalone SVG per node in `data.images[].svg` (text laid out with the canvas fonts).
- `kimo_export`: needs the export grant. `png` (one `<nodeId>.png` per node) and `kimo` (the
  subtrees as a standalone file with the variables they use) need `outDir`. Code and token
  targets (`react-tailwind`, `html-css`, `tokens-dtcg`, `tokens-css`, `tailwind-theme`, `svg`,
  `pdf`) are written to `outDir` or returned inline (pdf as base64). Identical files are
  reported unchanged; nothing is written when any file conflicts. See `guide/export`.
