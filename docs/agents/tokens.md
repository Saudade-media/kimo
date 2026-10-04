<!-- Generated from packages/mcp-server/guides/tokens.md by scripts/gen-guides.ts. Agents read the same text with kimo_read_docs {path: "tokens"}. MIT licence. -->

# Variables and themes

## Variables

A variable has a `type` (`color`, `number`, `string`, `boolean`; with feature `tokens/composite`
also `typography`, `shadow`, `dimension`) and a `value`, plus an optional `group` (dotted path
used for DTCG export) and `description`. Names may contain `/` and `.` (`color/surface`,
`space.4`) but not spaces or `:`.

Read them with `kimo_get_variables {docId, resolve:true}`. Add `includeUsages:true` to see who
binds each variable.

## Binding

Any field that accepts a variable takes `{"$ref":"name"}`:

```json
{"op":"update","id":"@card","set":{"fill":{"$ref":"color/surface"},
  "radius":{"$ref":"radius/m"},"layout":{"dir":"column","gap":{"$ref":"space/3"}}}}
```

Type rules: colors bind to fills, strokes and stops. Numbers (or dimensions) bind to sizes,
gaps, padding, radius, opacity and font size/weight. Strings bind to `content`, `font` and
`icon`. Booleans bind to `visible` and `clip`. A plain string is never a reference.

Prefer binding to existing variables over hard-coded values whenever the document has a token
for it. That keeps themes working.

## Theme axes

An axis is a named list of values, and the first value is the default:
`{"op":"theme_axis","action":"create","axis":"mode","values":["light","dark"]}`. Documents can
have several axes (`mode`, `brand`, `density`).

A themed value lists candidates with conditions:

```json
{"type":"color","value":[
  {"when":{"mode":"light"},"value":"#FFFFFF"},
  {"when":{"mode":"dark"},"value":"#0B0B0F"}]}
```

Resolution: from the matching entries, the **last one in the list** wins. An entry without
`when` is only a fallback, used when nothing matches (with the lint `THEME_NO_MATCH`). An alias
is a value that is itself `{"$ref":…}`.

## Pins

A node's `theme` pins axes for its whole subtree. `set_theme_pin {node, axis, value}` sets one,
and `{inherit:true}` removes it. Use this to show a light and a dark version of the same screen
side by side: two copies, one pinned `mode: dark`.

To preview without changing anything, use `kimo_render {theme:[{axis, value}]}` or
`kimo_query {resolveVariables:true, theme:[…]}`.

## Edits

`create_variable` (fails if the name exists), `update_variable {name, value?, group?,
description?}`, `rename_variable {from, to}` (rebinds every use), `delete_variable {name,
detach?}` (`detach:true` replaces bindings with literal values, otherwise a used variable
refuses). Variable and axis ops are document-global. Scoped agents may need the `globals` grant.
