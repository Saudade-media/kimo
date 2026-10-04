<!-- Generated from packages/mcp-server/guides/components.md by scripts/gen-guides.ts. Agents read the same text with kimo_read_docs {path: "components"}. MIT licence. -->

# Components, instances and overrides

## Model

- A **component** is any node with `component: true` (or `component: {props:{…}}`). Its subtree is
  the content.
- An **instance** is `{type:"instance", of:"<componentId>"}`. It has no children of its own. It
  shows the component's content, live.
- An instance's top level holds only placement (`x`, `y`, `name`, `position`, `theme`) plus `of`,
  `props`, `args` and `overrides`. Root visuals (size, fill, layout) go in `props`:
  `"props":{"w":200,"fill":"#F5F5F5"}`. Putting them at the top level is
  `INSTANCE_VISUAL_FIELD`.
- Library components are `alias:id` (`ui:Button0001`). Libraries are read-only. Edit them in their
  own file.

Find components with `kimo_list_components {docId}`. It returns ids, declared props, slots and
instance counts.

## Addressing inside an instance

Descendants are addressed by **IdPath**, relative to the instance's component: the descendant's
id inside the component, plus one more segment for each nested instance you cross:

- `Label00001`: a node directly in the component;
- `Action0001/Label00001`: `Label00001` inside the nested instance `Action0001`.

`kimo_query {resolveInstances:true}` shows instance content as virtual nodes with these paths, and
`include:["overrides"]` lists what is already overridden.

## Overrides (`set_override`)

| kind | Effect | Payload |
|---|---|---|
| `set` | replace fields of the target (shallow) | `set:{content:"Buy now"}` |
| `slot` | the target slot frame takes new children | `content:[nodeBody…]` |
| `replace` | swap the target node for another | `node:{…}` |

To hide a descendant: `set:{visible:false}`. You cannot delete inside an instance
(`INSTANCE_STRUCTURE`). `reset_override {instance, path, fields?}` or `{all:true}` reverts.

## Declared props (preferred over raw overrides)

A component may declare a prop API: `text`, `boolean`, `instance`, `enum` or `slot`, each
pointing at a target path. Set them with `set_args`:

```json
{"op":"set_args","instance":"@btn","args":[{"name":"label","value":"Continue"},
  {"name":"variant","value":"ghost"}]}
```

Declared props survive component edits better and export as typed code props. Declare them with
`declare_prop {component, name, def:{type:"text", target:"Label00001", field:"content"}}`.

## Slots

`set_slot {frame}` marks a frame inside a component as a slot. In an instance, fill it with
`set_override {kind:"slot", path:"<slotFrameId>", content:[…]}`, or insert nodes with
`parent:"<instanceId>"` and `at:"<slotFrameId>"`.

## Variants

A variant is an instance of a base component, with overrides, that is itself marked as a
component (a derived component). Create it with `instantiate`, then `set_override`, then
`update {set:{component:true}}`. Switch an instance between variants with `swap_instance`.

## Workflow

1. Build the thing once as plain frames and render it.
2. `make_component {ids:[id], name}`.
3. `instantiate` it where needed, and customise with `set_args` / `set_override`.
4. Change the component itself and every instance follows. Overrides stay put.
