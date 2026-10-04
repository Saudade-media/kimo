<!-- related: schema, components, tokens, envelope -->
# kimo_apply_ops cookbook

```json
{ "docId": "d_…", "baseRevision": {"epoch": "…", "seq": 12}, "label": "Pricing card",
  "ops": [ … up to 500 … ] }
```

The whole list is applied as one transaction. If any op fails, nothing changes
(`rolledBack: true`). One call = one undo step, attributed to you.

**References.** Any `id`, `parent`, `instance`, `component`, `frame` or `node` field takes a node id
or `@key` of a node created earlier in the same call. `parent: "root"` places a node at the top
level. `index` is the position among siblings (0 = first). Leave it out to append.

## Build a subtree

```json
[
 {"op":"insert","key":"card","parent":"root","node":{"type":"frame","name":"Card","x":0,"y":0,
   "w":320,"fill":"#FFFFFF","radius":12,"layout":{"dir":"column","gap":8,"pad":20}}},
 {"op":"insert","key":"title","parent":"@card","node":{"type":"text","content":"Pro",
   "style":{"size":20,"weight":600}}},
 {"op":"insert","parent":"@card","node":{"type":"text","content":"$49/mo"}}
]
```

Children are separate `insert` ops. A node body never contains its children.

## Edit

| Op | Shape | Notes |
|---|---|---|
| `update` | `{id, set?:{field:value}, unset?:[field]}` | Shallow: `set.layout` replaces the whole layout object |
| `replace` | `{id, node}` | New body, same id and position. Destructive |
| `move` | `{id, parent, index?, at?}` | Reparent or reorder. Cycles fail with `CYCLE` |
| `delete` | `{id}` | Removes the subtree. Destructive |
| `copy` | `{id, parent, key?, index?, set?}` | Deep copy with fresh ids, optional root fields |

```json
{"op":"update","id":"@title","set":{"content":"Team","style":{"size":24,"weight":700}}}
{"op":"update","id":"Hq3Lm9aZ1x","unset":["effects"]}
{"op":"move","id":"Hq3Lm9aZ1x","parent":"@card","index":0}
{"op":"copy","id":"@card","key":"card2","parent":"root","set":{"x":360}}
```

## Components and instances (details: `components`)

```json
{"op":"make_component","ids":["@card"],"name":"PriceCard"}
{"op":"instantiate","of":"@card","key":"c1","parent":"@row"}
{"op":"set_override","instance":"@c1","path":"Title00001","kind":"set","set":{"content":"Team"}}
{"op":"set_args","instance":"@c1","args":[{"name":"label","value":"Buy"}]}
{"op":"swap_instance","instance":"@c1","of":"Ghost00001"}
{"op":"reset_override","instance":"@c1","all":true}
{"op":"detach","id":"@c1"}
```

Also: `declare_prop {component, name, def}`, `remove_prop`, `set_slot {frame, suggested?,
remove?}`.

## Variables and themes (details: `tokens`)

```json
{"op":"theme_axis","action":"create","axis":"mode","values":["light","dark"]}
{"op":"create_variable","name":"surface","variable":{"type":"color",
  "value":[{"when":{"mode":"light"},"value":"#FFFFFF"},{"when":{"mode":"dark"},"value":"#111111"}]}}
{"op":"update","id":"@card","set":{"fill":{"$ref":"surface"}}}
{"op":"set_theme_pin","node":"@card","axis":"mode","value":"dark"}
```

Also: `update_variable`, `rename_variable` (rebinds every use), `delete_variable {detach?}`,
low-level `set_variables` / `set_theme_axes`.

## Habits that work

- Pass `baseRevision` from your previous result. You will get `REVISION_CONFLICT` instead of
  silently overwriting the user's edits.
- Use `dryRun: true` to check a large batch. It returns the would-be ops and warnings and
  commits nothing.
- Build one section per call (20–150 ops), then `kimo_render` it. Don't send one giant call.
- To place a new top-level frame, call `kimo_find_space {docId, w, h}` first and use its x/y.
- Mark work in progress with `placeholder: true` on the frame and remove it with `unset` at the
  end.
