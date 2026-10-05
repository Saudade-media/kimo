<!-- Generated from packages/mcp-server/guides/envelope.md by scripts/gen-guides.ts. Agents read the same text with kimo_read_docs {path: "envelope"}. MIT licence. -->

# Results, revisions and the verification loop

## The envelope

Every tool returns one JSON object (also in `structuredContent`):

```json
{"ok":true,"summary":"Inserted 3 nodes","doc":{"id":"d_…","path":"/…/site.kimo","dirty":true,"readOnly":false},
 "revision":{"before":{"epoch":"k2","seq":11},"after":{"epoch":"k2","seq":12}},
 "created":[{"key":"card","id":"Hq3Lm9aZ1x"}],"changed":["Hq3Lm9aZ1x"],
 "undoToken":"u_…","warnings":[],"data":{…}}
```

On failure: `{"ok":false,"summary":…,"errors":[{"code","message","path?","nodeId?",
"suggestion?","retryable?","detail?"}],"rolledBack":true}`. Nothing was committed. Branch on
`code`, read `suggestion`, and retry automatically only when `retryable` is true.

## Revisions and docIds

- `revision` is `{epoch, seq}`. Pass the latest `revision.after` back as `baseRevision`. If anyone
  changed the document since then, you get `REVISION_CONFLICT` with `detail.current` and
  `detail.changed` (ids). Re-read those nodes, then redo your change.
- `docId` stays the same while the file stays open. A reload (external edit, git checkout) mints a
  new one, and old ids fail with `DOCUMENT_NOT_OPEN` plus `detail.currentDocId`. Switch to it and
  re-read.

## Safety

- `dryRun: true` on `kimo_apply_ops` / `kimo_import` validates and returns ops and warnings, and
  commits nothing.
- Destructive ops (`delete`, `replace`, `detach`, `remove_prop`, `delete_variable`, axis
  deletes) may need a higher permission level or the user's approval. A denial is
  `PERMISSION_DENIED`, so don't retry it in a loop. Ask the user, or change approach.
- Your permissions (level `read` / `edit` / `edit+delete`, file allow-list, grants) are in
  `kimo_get_state`. Files outside the allow-list ask the user every time.
- `kimo_history {action:"undo", token:<undoToken>}` reverts exactly your call, and only if it is
  still on top of *your* stack. It never undoes the user's or another agent's work.

## Verification loop

After each meaningful write:

0. **Problems.** A `kimo_apply_ops` result carries `data.problems` when the layers it changed
   have clear problems (empty frame, text overflowing or clipped, zero size, outside its parent,
   missing variable, invisible shape). Fix them in the next call.
1. **Render.** `kimo_render {docId, ids:[frameId]}` (or `render:true` on `kimo_apply_ops`). It
   always shows the committed state. Look for clipped text, overlap and wrong spacing.
2. **Measure.** `kimo_query {select:{ids:[…]}, include:["bounds","problems"]}`. Compare the
   actual boxes with what you intended.
3. **Validate.** `kimo_validate {docId, check: true}` reports schema errors, lints (missing
   variables, invisible text, circular sizing, unresolved overrides) and the design problems of
   the whole document, placeholders still set included. Finish with none.
4. **Fix** with a small follow-up call, then repeat. Stop when render, bounds and validate all
   agree.

`warnings` in a successful result are lints that your change introduced. Fix them before you
move on.

## Saving

`kimo_save {docId}` writes atomically and reads the file back. `data.bytes`/`sha256` are reported
only after verification. The app (and headless `kimo mcp`) also autosaves after 2 s idle.
`kimo_close` refuses a dirty document unless you pass `save:true` or `discard:true`.
