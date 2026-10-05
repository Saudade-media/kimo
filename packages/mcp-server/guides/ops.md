<!-- related: schema, components, tokens, envelope -->
# kimo_apply_ops cookbook

```json
{ "docId": "d_…", "baseRevision": {"epoch": "…", "seq": 12}, "label": "Pricing card",
  "ops": [ … up to 500 … ] }
```

One transaction (any failure: nothing changes, `rolledBack: true`), one undo step.

Max 40 `insert`s per call (`BATCH_TOO_LARGE`); `copy` is free. Build per section: `guide/steps`.

**References.** Any `id`, `parent`, `instance`, `component`, `frame` or `node` field takes a node id
or `@key` of a node created earlier in the call. After `{"op":"copy","key":"v2",…}`,
`@v2/<original id>` is the copy of that node, so one call can copy a page and insert into the
copy's sections. `created[]` also lists the copies of the copied root's first two levels as
`v2/<original id>` → new id, for later calls. `parent: "root"` = top level. `index` is the
position among siblings (0 = first); omit it to append.

**Clearing fields.** `{"op":"update","id":…,"unset":["effects"]}`; a `null` value in `set`
does the same (`"set":{"effects":null}`). Never put `unset` inside `set` or a node body.

**Features** (`layout/wrap`, `text/runs`, …) are declared for you by the edit that needs them.

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

Children are separate `insert` ops, never inside a body.

## Edit

| Op | Shape | Notes |
|---|---|---|
| `update` | `{id, set?:{field:value}, unset?:[field]}` | Shallow: `set.layout` replaces the whole layout object |
| `replace` | `{id, node}` | New body, same id and position. Destructive |
| `move` | `{id, parent, index?, at?}` | Reparent or reorder |
| `delete` | `{id}` | Removes the subtree. Destructive |
| `copy` | `{id, parent, key?, index?, set?}` | Deep copy with fresh ids, optional root fields |

```json
{"op":"update","id":"@title","set":{"content":"Team","style":{"size":24,"weight":700}}}
{"op":"update","id":"Hq3Lm9aZ1x","unset":["effects"]}
{"op":"copy","id":"@card","key":"card2","parent":"root","set":{"x":360}}
```

## Components and instances (details: `components`)

```json
{"op":"make_component","ids":["@card"],"name":"PriceCard"}
{"op":"instantiate","of":"@card","key":"c1","parent":"@row"}
{"op":"set_override","instance":"@c1","path":"Title00001","kind":"set","set":{"content":"Team"}}
{"op":"set_args","instance":"@c1","args":[{"name":"label","value":"Buy"}]}
```

Also `swap_instance`, `reset_override`, `detach`, `declare_prop`, `remove_prop`, `set_slot`.

## Variables and themes (details: `tokens`)

```json
{"op":"theme_axis","action":"create","axis":"mode","values":["light","dark"]}
{"op":"create_variable","name":"surface","variable":{"type":"color",
  "value":[{"when":{"mode":"light"},"value":"#FFFFFF"},{"when":{"mode":"dark"},"value":"#111111"}]}}
{"op":"update","id":"@card","set":{"fill":{"$ref":"surface"}}}
{"op":"set_theme_pin","node":"@card","axis":"mode","value":"dark"}
```

Also: `update_variable`, `rename_variable`, `delete_variable {detach?}`, `set_variables`,
`set_theme_axes`.

## Pages

```json
{"op":"page","action":"add","name":"Checkout","key":"checkout"}
{"op":"insert","parent":"root","node":{"type":"frame","name":"Cart","w":390,"h":844,"page":"<page id>"}}
{"op":"page","action":"rename","id":"<page id>","name":"Cart flow"}
{"op":"page","action":"move","id":"<page id>","index":0}
```

`created[]` maps the add's `key` to the page id. A top-level insert without `page` lands on the
first page. `delete` removes the page and its top-level nodes; never the last page.

## Habits that work

- Pass `baseRevision` from your previous result (`REVISION_CONFLICT` instead of overwriting).
- New top-level frame: x/y from the outline's boxes or `kimo_find_space {docId, w, h}`.
- Mark work in progress with `placeholder: true` on the frame; `unset` it at the end.
