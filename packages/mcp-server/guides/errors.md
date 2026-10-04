<!-- related: envelope, ops -->
# Error codes

Every failure carries `errors[].code`. Nothing was committed (`rolledBack: true`).

| Code | Cause | Fix |
|---|---|---|
| `DOCUMENT_NOT_OPEN` | Unknown or stale `docId` (the file was reloaded or closed) | Use `detail.currentDocId` if present, else `kimo_get_state` / `kimo_open` |
| `DOCUMENT_LOCKED` | Another process holds the file's write lease (`detail.holder`) | Use the holder (e.g. connect through the Kimo app), or open with `readOnly: true` |
| `LOAD_FAILED` | The file is not valid `.kimo` | Don't retry. Report to the user. The file was not touched |
| `READ_ONLY` | Read-only open, newer format, library, or locked | Open writable, or edit the library file itself |
| `REVISION_CONFLICT` | `baseRevision` is behind (`detail.current`, `detail.changed`) | Re-query the changed nodes, rebuild the ops, retry with the new revision |
| `NODE_NOT_FOUND` | An id or `@key` does not exist (`nodeId`, `path` = op index) | Check the id. A `@key` only works within the call that created it |
| `NODE_EXISTS` | An insert reused an existing id | Let Kimo mint ids. Use `key` |
| `INVALID_PROPERTY` | A field is unknown for the node type or has a bad value | Compare with `schema` / `kimo://schema/1.0` |
| `INVALID_INPUT` | The tool input failed its schema (`path` points at it) | Fix the named field. Check spelling and types, and remember no `null` |
| `SCHEMA_VIOLATION` | The resulting document would be invalid (`detail` has the validator issue) | Read the issue code (e.g. `FEATURE_NOT_DECLARED`, `VARIABLE_MISSING`, `INSTANCE_VISUAL_FIELD`) and change the op |
| `INSTANCE_STRUCTURE` | Tried to add/delete/move children inside an instance | Use `set_override` (`visible:false`, `slot`, `replace`), or `detach` |
| `CYCLE` | A move or instance would contain itself | Pick another parent or component |
| `OUT_OF_SCOPE` | Edit outside the node subtrees assigned to you | Stay inside your scope, or ask the coordinator |
| `PERMISSION_DENIED` | Policy level, file allow-list, grant, or the user said no / didn't answer in 2 min | Don't loop. Ask the user to allow it in Kimo › Settings › Agents, or take a non-destructive path |
| `ASSET_NOT_FOUND` | Image/font/file path missing | Import it first (`kimo_assets {action:"import"}`) |
| `FILE_EXISTS` | `kimo_create` / `kimo_export` target exists | Choose another path, or `overwrite:true` for exports |
| `FILE_NOT_FOUND` | Path does not exist | Check the absolute path |
| `TIMEOUT` | The call took too long, or the app restarted mid-call | Retryable: re-read state, then retry once |
| `RATE_LIMITED` | Too many calls too fast | Retryable after a short wait |
| `APP_NOT_RUNNING` | The relay cannot reach the Kimo app | Retryable: ask the user to start Kimo, or use `kimo mcp` (headless) |
| `PROTOCOL_MISMATCH` | Relay and app versions differ | Update Kimo or the CLI |
| `UNSUPPORTED` | Not available in this host (e.g. raster render without CanvasKit, SVG import headless, `kimo_script`, asset generation) | Use the alternative named in `suggestion` |
| `INTERNAL` | Bug | Report it with the input. Re-read state before continuing |

## Common validator issues inside SCHEMA_VIOLATION

- `FEATURE_NOT_DECLARED`: the op used a gated construct (wrap, stretch, min/max, text runs,
  composite tokens). Use the ungated form.
- `VARIABLE_MISSING` / `VARIABLE_TYPE`: the binding names an unknown variable or one of the wrong
  type. Check `kimo_get_variables`.
- `INSTANCE_VISUAL_FIELD`: a visual field on an instance's top level. Move it into `props`.
- `OVERRIDE_PATH_UNRESOLVED`: the IdPath doesn't resolve. Query with `resolveInstances:true`.
- `AT_WITHOUT_OVERRIDE`: slot content without a `slot` override. Use `set_override kind:"slot"`.
- `REF_NOT_COMPONENT`: `of` names a node that isn't a component.
