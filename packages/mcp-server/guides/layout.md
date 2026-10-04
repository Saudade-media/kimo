<!-- related: schema, text, guide/web -->
# Layout and sizing

Kimo layout is flexbox, set on frames. Map CSS intuitions directly, and note the different
names below.

## Layout frames

```json
"layout": {"dir":"row", "gap":12, "pad":[16,24], "justify":"between", "align":"center"}
```

| Field | Values | Default |
|---|---|---|
| `dir` | `row`, `column` (required) | |
| `gap` | number (may be negative) | 0 |
| `pad` | `n`, `[vertical, horizontal]`, `[top, right, bottom, left]` | 0 |
| `justify` | `start` `center` `end` `between` `around` `evenly` | `start` |
| `align` | `start` `center` `end`, plus `stretch` `baseline` (feature `layout/stretch-baseline`) | `start` |
| `wrap`, `crossGap` | wrap onto lines (feature `layout/wrap`) | off |

Without `layout`, children are placed by `x`/`y` relative to the frame's top-left. Inside a
layout frame, `x`/`y` are ignored unless the child has `position: "absolute"` (badges, overlays).
Hidden children (`visible: false`) take no space.

## Sizes

`w` and `h` take one of:

- a number: fixed px;
- `{"mode":"fit"}`: hug the content (the default for frames);
- `{"mode":"fill"}`: take the free space of a layout parent. On the main axis it grows like
  `flex: 1` (`weight` shares space between several fill children). On the cross axis it
  stretches.

`fallback` gives the size used when `fill` has no layout parent, or when `fit` has no children.
`min`/`max` need feature `size/min-max`.

## Rules that prevent most layout bugs

1. Put spacing on the **container** (`pad`, `gap`), not on children's `x`/`y`.
2. A screen-level frame gets fixed `w` (for example 1440 or 390) and `h: {"mode":"fit"}` so it
   grows with its content.
3. Full-width rows inside a column: give the child `w: {"mode":"fill"}`, not a pixel width.
4. A `fit` frame whose only flowing children all `fill` the same axis is circular (lint
   `FIT_ALL_FILL`). Give the parent a fixed size or the child a fit/fixed size.
5. Text that should wrap needs `grow: "fixed-width"` plus a width (`fill` inside a column works).
6. Use `justify: "between"` for "left item … right item" bars, not spacer frames.
7. Use `clip: true` on frames that must crop (cards with images, scroll areas).

## Checking

`kimo_query {include:["bounds"]}` returns the computed boxes, and `include:["problems"]` returns
layout lints per node. `kimo_render` shows the result. Check widths before you check the visuals.
