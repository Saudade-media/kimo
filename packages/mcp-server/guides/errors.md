<!-- related: envelope, ops -->
# Error codes

Every failure carries `errors[].code`. Nothing was committed (`rolledBack: true`).

| Code | Cause | Fix |
|---|---|---|
| `DOCUMENT_NOT_OPEN` | Unknown or stale `docId` (the file was reloaded or closed) | Use `detail.currentDocId` if present, else `kimo_get_state` / `kimo_open` |
| `DOCUMENT_LOCKED` | Another process holds the file's write lease (`detail.holder`) | Use the holder (e.g. connect through the Kimo app), or open with `readOnly: true` |
| `LOAD_FAILED` | The file is not valid `.kimo` (left untouched) | Don't retry. Tell the user |
| `READ_ONLY` | Read-only open, newer format, library, or locked | Open writable, or edit the library file itself |
| `REVISION_CONFLICT` | `baseRevision` is behind (`detail.current`, `detail.changed`) | Re-query the changed nodes, rebuild the ops, retry with the new revision |
| `NODE_EXISTS` | An insert reused an existing id | Use `key`; Kimo mints ids |
| `NODE_NOT_FOUND` | An id or `@key` does not exist (`nodeId`, `path` = op index) | Check the id. A `@key` only works within the call that created it |
| `INVALID_PROPERTY` | A field is unknown for the node type or has a bad value | Compare with `schema` / `kimo://schema/1.0` |
| `INVALID_INPUT` | The tool input failed its schema (`path` points at it) | Fix the named field. Check spelling and types |
| `SCHEMA_VIOLATION` | The resulting document would be invalid (`detail` has the validator issue) | Apply `suggestion` (a one-line fix for unknown fields such as `unset`, `padding`, `fontSize`), else read the issue code (`VARIABLE_MISSING`, `INSTANCE_VISUAL_FIELD`, …) and change the op |
| `INSTANCE_STRUCTURE` | Tried to add/delete/move children inside an instance | Use `set_override` (`visible:false`, `slot`, `replace`), or `detach` |
| `BATCH_TOO_LARGE` | More than 40 `insert`s in one call (`detail.newLayers`) | One finished section (or sub-block) per call. `copy` is free (`guide/steps`) |
| `CYCLE` | A move or instance would contain itself | Pick another parent or component |
| `OUT_OF_SCOPE` | Edit outside the node subtrees assigned to you | Stay inside your scope, or ask the coordinator |
| `PERMISSION_DENIED` | Policy level, allow-list, grant, or the user said no / didn't answer | Don't loop. Ask the user (Kimo › Settings › Agents), or take a non-destructive path |
| `ASSET_NOT_FOUND` | Image/font/file path missing | `kimo_assets {action:"import"}` first |
| `FILE_EXISTS` | `kimo_create` / `kimo_export` target exists | Choose another path, or `overwrite:true` for exports |
| `FILE_NOT_FOUND` | Path does not exist | Check the absolute path |
| `TIMEOUT` | Too slow, or the app restarted mid-call | Retryable: re-read, retry once |
| `RATE_LIMITED` | Too many calls too fast | Retryable after a short wait |
| `APP_NOT_RUNNING` | The relay cannot reach the Kimo app | Retryable: ask the user to start Kimo, or use `kimo mcp` (headless) |
| `PROTOCOL_MISMATCH` | Relay and app versions differ | Update Kimo or the CLI |
| `UNSUPPORTED` | Not available in this host (raster render without CanvasKit, headless SVG import, `kimo_script`, asset generation) | Use the alternative in `suggestion` |
| `INTERNAL` | Bug | Report it with the input. Re-read state before continuing |

## Common validator issues inside SCHEMA_VIOLATION

- `UNKNOWN_PROPERTY`: `suggestion` names the Kimo field (`padding` → `pad`, `fontSize` →
  `style.size`, `unset` → the update op's own `unset`).
- `FEATURE_NOT_DECLARED`: only from tools other than `kimo_apply_ops` (which declares features
  itself). Add the feature to the document or use the ungated form.
- `VARIABLE_MISSING` / `VARIABLE_TYPE`: the binding names an unknown variable or one of the wrong
  type. Check `kimo_get_variables`.
- `INSTANCE_VISUAL_FIELD`: a visual field on an instance's top level. Move it into `props`.
- `OVERRIDE_PATH_UNRESOLVED`: the IdPath doesn't resolve (query with `resolveInstances`).
- `AT_WITHOUT_OVERRIDE`: slot content without a `slot` override. Use `set_override kind:"slot"`.
- `REF_NOT_COMPONENT`: `of` names a node that isn't a component.
