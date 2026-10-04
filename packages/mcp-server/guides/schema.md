<!-- related: ops, layout, text -->
# The .kimo model

A document is one JSON object. Its `nodes` member is a **flat table**: `id → node`. Each node
names its `parent` (an id, or `null` at the top level). There is no nested `children` array.
Siblings are ordered by an internal key, and you only ever deal with an `index`.

```json
{ "type": "frame", "name": "Card", "w": 320, "h": {"mode": "fit"},
  "fill": "#FFFFFF", "radius": 12,
  "layout": {"dir": "column", "gap": 8, "pad": 16} }
```

## Ids

- Ids are 6–24 letters/digits (`Hq3Lm9aZ1x`). Kimo mints them. You name new nodes with `key`
  and refer to them as `@key` within the same call. `created[]` in the result maps keys to ids.
- Names (`name`) are labels only. Never use them to reference anything.
- Inside an instance, descendants are addressed by **IdPath**: `instanceId` plus the path
  inside its component, for example `Inst000001/Label00001` (see `components`).

## Node types

| type | Key fields |
|---|---|
| `frame` | container. `w`,`h` (Size), `fill`, `stroke`, `radius`, `clip`, `layout`, `effects` |
| `group` | container with no box of its own; bounds = children |
| `rect`, `ellipse`, `polygon` | `w`,`h` required; `fill`, `stroke`, `radius` / `sides` / `innerRadius` |
| `path` | `d` (SVG path data), `viewBox`, `w`,`h`, `fillRule` |
| `text` | `content` (string), `grow`, `style` (see `text`) |
| `icon` | `set` (`lucide`, `feather`, `phosphor`, `material-*`), `icon` (glyph name), `w`,`h`, `color` |
| `instance` | `of` (component id), `props`, `args`, `overrides` (see `components`) |
| `note`, `prompt` | canvas annotations: `content` |

Only `frame` and `group` hold children. Images are `fill: {kind:"image", src:"./assets/…"}` on a
rect or frame, imported with `kimo_import` / `kimo_assets`. There is no image node.

## Common fields

- Placement: `x`, `y` (relative to the parent; ignored inside a layout frame unless
  `position: "absolute"`), `name`, `locked`, `theme` (pins, see `tokens`).
- Look: `opacity` 0–1, `visible`, `rotation` (degrees CCW), `blend`, `flipX`/`flipY`.
- Paint: a color string `#RRGGBB` / `#RRGGBBAA`, `{space:"oklch", l, c, h}`, a binding
  `{"$ref":"name"}`, or `{kind:"linear"|"radial"|"angular", stops:[{color, at}]}`. A list paints
  bottom to top. `fill: []` means "no paint".
- Stroke: `{paint, width, align:"inside"|"center"|"outside", dash?}`; `width` can be per side
  `{t, r, b, l}`.
- Effects: `[{kind:"shadow", x, y, blur, color, spread?, inner?}, {kind:"blur", radius},
  {kind:"backdrop-blur", radius}]`.

## Defaults and nulls

A field equal to its default is the same as the field being absent, and Kimo omits it when it
saves. Never send `null`. To clear a field, use `update {unset:["field"]}`.

## Features

Some constructs need a feature listed in the document's `features`: `layout/wrap`,
`layout/stretch-baseline`, `size/min-max`, `text/runs`, `tokens/composite`. If you get
`FEATURE_NOT_DECLARED`, see `errors`. Prefer the ungated form when one exists.

The normative JSON Schema is the resource `kimo://schema/1.0`.
