<!-- related: ops, schema, layout, errors -->
# kimo_script

`kimo_script` runs a short JavaScript program whose calls compile to `kimo_apply_ops` ops. Those
ops take the normal path: one transaction, one undo step, the same validation, permissions,
approvals, batch limit (copies free), `data.problems`, `render` and patch-retry. Use it to build:
loops and functions keep a 30-layer section short. Use `kimo_apply_ops` for a few precise edits.

## API

| Call | Compiles to |
|---|---|
| `Insert(parent, node, index?)` → ref | `insert`, plus one per node of `node.children` |
| `Update(ref, set, unset?)` | `update` |
| `Move(ref, parent, index?)` | `move` |
| `Delete(ref)` | `delete` |
| `Copy(ref, parent, set?)` → ref | `copy` |
| `Instantiate(component, parent, {name?, x?, y?})` → ref | `instantiate` |
| `Op(op)` → ref when it creates | any `kimo_apply_ops` op |
| `Get(id)`, `Children(id)`, `Children("root")` | nothing: reads |
| `Print(...values)` | nothing: lines in `data.prints` |

- `parent`: `"root"`, a node id, or a ref (a string like `"@s3"`). `ref + "/<original id>"` is a
  node inside a copy.
- `node`: an insert body (see `schema`, `layout`), with `children: [nodes]` for nesting.
- `Get` / `Children` read the document as it was before the script: fields, `id`, `parent`,
  `children` ids and the laid-out `box` `{x, y, w, h}`.
- The result lists `names` (layer name → id) instead of `created`.

## A section in one call

```js
const page = Insert("root", {type: "frame", name: "Pricing", x: 0, y: 0, w: 1280,
  fill: "#FFFFFF", layout: {dir: "column", gap: 48, pad: 80}})
const row = Insert(page, {type: "frame", name: "Plans", w: {mode: "fill"},
  layout: {dir: "row", gap: 24}})
function plan(name, price, features, dark) {
  const ink = dark ? "#FFFFFF" : "#111827"
  const card = Insert(row, {type: "frame", name: `${name} plan`, w: {mode: "fill"},
    radius: 16, fill: dark ? "#111827" : "#F3F4F6", layout: {dir: "column", gap: 16, pad: 32}})
  Insert(card, {type: "text", content: name, fill: ink, style: {size: 20, weight: 600}})
  Insert(card, {type: "text", content: `${price}/mo`, fill: ink, style: {size: 40, weight: 700}})
  for (const f of features) Insert(card, {type: "text", content: f, fill: ink})
}
plan("Starter", "$0", ["1 project", "Community support"], false)
plan("Pro", "$24", ["Unlimited projects", "Priority support"], true)
plan("Team", "$99", ["SSO", "Audit log"], false)
```

## Streaming, globals

When your tool input streams (the Kimo app's agent, Claude Code in the app), each top-level
statement runs once complete and its layers appear while you write. The call reruns the whole
script and commits the same ops as one undo step. Short top-level statements land sooner.

Top-level `const`, `let`, `function` and `class` names stay for your next script: data as JSON
(refs become node ids), functions as source (they see globals only). At most 64 KB.

## Errors and limits

- A thrown error, a bad API call, or an op that fails its checks fails the call with nothing
  applied; the message starts with `line N:`. Fix it with `{docId, retryId, edits}`; `find` is
  text of the code (no JSON escaping).
- Sandbox (QuickJS): no files, network, timers or editor access. Per run: 3 s (6 s in
  all while streaming), 64 MB, 2,000 ops, 100 printed lines. `Math.random` is seeded and `Date` is fixed: the same code makes the
  same ops.
