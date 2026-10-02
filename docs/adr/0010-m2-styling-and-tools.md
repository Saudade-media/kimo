# 0010. M2 styling, canvas overlays and tools: format additions and contracts

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** maintainers (M2 contracts)
- **Teardown refs:** 12 (M2 row: Yoga flex, strokes, gradients, shadows, blurs, blend modes,
  icons, pen tool, snapping, measurements, pixel grid), 10.3 (Graphics), 9.1 (dependency
  rules); builds on [0009](0009-m1-render-pipeline.md)
- **Design:** `desing.pen` boards 02b (`mj1CX`), 08 (`hkpU9`), 09 (`h3BVP0`), 10 (`nzfXx`)

## Context

M2 adds the styling half of the properties panel (board 08), its popovers (board 09) and the
canvas tools and overlays (board 10). Several builders work in parallel (format, renderer,
layout, canvas host, UI kit, panel), so — as in M1 — the seams are fixed first. An audit of
format 0.1 against the M2 designs found it already covers almost everything:

| M2 need | Format 0.1 |
|---|---|
| Stroke align / per-side / dash / cap / join | `stroke.align`, `width: {t,r,b,l}`, `dash`, `cap`, `join` (§7.2). The board 08 Hero Image stroke (`kimo-stroke` metadata: top+bottom 1, dash 4/2, round caps) maps 1:1. |
| Gradients linear / radial / angular + transform | `kind`, `center`, `size`, `rotation`, `interpolation`, `opacity` (§7.1). Rotate 90° and Flip are edits of `rotation` / stop order. |
| Image fill modes | `fit: cover / contain / stretch / tile`, `crop`, `opacity` (§7.1). |
| Shadow (+spread, inner), layer blur, background blur | `shadow` (`spread`, `inner`), `blur`, `backdrop-blur` (§7.3). |
| Paint blend modes | `BlendMode`; "Plus darker" = `linear-burn`, "Plus lighter" = `linear-dodge`. |
| Layout: wrap, individual padding, alignment, sizing, absolute | `layout.wrap`/`crossGap` (feature `layout/wrap`), `pad: [t,r,b,l]`, `justify`/`align`, `fit`/`fill`/fixed sizes, `position: "absolute"` (§6). |
| Path node | `d`, `fillRule`, `viewBox` (§5.5). |

Missing, and needed by the designs:

1. **Layer blend mode.** Board 08's Layer section has a Blend mode select next to Opacity and
   board 09's blend menu lists "Pass through". Paints and shadows had `blend`; nodes did not.
2. **Effect visibility.** Every EffectRow (`Q6vwp`) has an eye toggle (Inner shadow and Layer
   blur are shown hidden). Paints had `visible`; effects did not.
3. **Icon stroke width.** Board 09's icon section shows "Stroke 2" for Lucide/Feather;
   `weight` only covered Material.
4. **Miter limit.** Not drawn in the panel, but `join: "miter"` without a limit is
   under-specified for renderers and exporters (SVG default 4).

## Decision

### Format (additive, still `0.1.0` draft; spec §20 row 25)

- Node **`blend`**: `LayerBlendMode` = `BlendMode` | `"pass-through"`, default `"normal"`, on
  every non-instance node (a visual field: on instances it goes in `props`). On frames and
  groups every mode but `pass-through` composites the subtree as an isolated group, then
  blends; `pass-through` composites no group. On other node types `pass-through` = `normal`.
  Exporters need `isolation: isolate` only when a descendant uses a non-normal blend.
- **`visible`** on `shadow`, `blur`, `backdrop-blur`, default `true` (new `DEFAULTS.blur` scope).
- Stroke **`miterLimit`** ≥ 1, default 4 (SVG semantics).
- Icon **`strokeWidth`** (> 0, stroke sets lucide/feather, in the set's 24-unit grid; absent =
  the set's 2) and **`weight`** now also for `phosphor` (nearest of thin 100, light 300,
  regular 400, bold 700).
- No feature flag: 0.1 is a draft; an older reader reports `UNKNOWN_PROPERTY` and preserves the
  fields (§16.3). Key order: `miterLimit` after `join`, `strokeWidth` after `weight`.
- Fixture `fixtures/valid/styling-m2.kimo`; tests `test/m2-styling.test.ts`; JSON Schema
  regenerated.

### Renderer contract (`@kimo/renderer` `types.ts`)

- `Overlay` gains optional `snap` (lines + × markers), `spacing` (equal-spacing indicators),
  `measurements` + `measureOutlines` (⌥ distances), `pixelGrid`, `pen`, `pathEdit`, `resize`
  (child outlines, sizing badges, ghost edge) and `cursorBadge` (SizeBadge/Delta). All world
  coordinates; drawn at constant screen size, 1px lines on half pixels. M1 `guides` stays,
  deprecated.
- `OVERLAY_SPEC_M2` holds board 10's exact numbers (guide overhang 8, marker 7 / stroke 1.25,
  pill padding [2, 8] mono 11/500 height 19, ticks 1 × 10, parent outline opacity 0.5, pixel
  grid above zoom 4 with fixed `#0A0A0A14`, anchors 7 / 1.5, handles 6 / 1.25, preview 1px at
  0.7, close ring 14 / 1.5, child outlines 0.35, sizing badge 7 above the selection, ghost edge
  dash 4/4 + 8 overhang, delta badge at edge + 4 / pointer + 12, vertex badge + (16, −14)).
- `OverlayTheme` gains optional `measure`, `measureSoft`, `onAccent`, `selectionSoft`,
  `accentText`, `accent` (hosts pass them from `@kimo/design-tokens`; light values are the
  fallback).
- **Icons**: `IconProvider { load, get, catalog, onIconLoaded }` returning normalized
  `IconGlyph`s (every SVG element → path data, `fill` or `stroke` paint, `viewBox`, native
  stroke width). The renderer owns the icon packages and loads glyphs lazily, never a whole
  set in the main chunk: in the browser from pre-normalized **shard files**
  (`packages/renderer/assets/icons/<pack>/<n>.json`, glyph name → shard by FNV-1a hash,
  ~60–130 glyphs per shard, plus a `catalog.json` per pack fetched only by the picker; built by
  `bun run --filter @kimo/renderer icons`), outside the browser straight from the static icon
  packages. Only the shard URL table is in the bundle. A missing glyph draws the missing-glyph
  box and reports through `onIconLoaded` → `invalidate`.
- **Icon weights**: Phosphor uses the nearest shipped weight (100/300/400/700). Material
  always loads the weight-400 outlines and approximates other weights by offsetting the
  outline (`materialOffset`); this is not the real Material `wght` axis. `RendererInitOptions.icons` overrides it;
  `Renderer.icons` exposes it to the picker.
- DOM, not canvas: Tooltip/Hint pills, the ⌥ "Measuring" tooltip, the zoom badge and the
  pen/resize cursors (`@kimo/ui`, positioned by the shell from `CanvasHostProps.onHint`).

### Layout contract (`@kimo/layout` `types.ts`)

`NodeLayout` gains optional `sizing` (`fixed | fit | fill` actually applied per axis, after
fallbacks), `inFlow` and `content` (content box of layout frames). No change to `LAYOUT_KEYS`:
`blend`, effect `visible`, `miterLimit` and icon `strokeWidth`/`weight` are paint-only
(stroke already re-lays-out because of `includeStroke`).

### Canvas contract (`apps/web/src/canvas/contract.ts`)

- Pen is enabled (`Tool` `path`). Image is a **placement** held by the host
  (`ImagePlacement`, `activeToolId`, `CanvasHandle.armPlacement/placement`,
  `onPlacementChange`) because editor-state's `Tool` has no `image`; the toolbar shows it active
  while armed.
- **Snapping** is a pure function `SnapFn(SnapQuery) → SnapResult` (delta + `SnapOverlay` +
  `SpacingIndicator`s). Candidates = siblings + parent (`CollectSnapCandidates`); threshold in
  screen px (`SNAP_THRESHOLD_PX` = 5, a house value — the design gives none); ⌘ disables it.
  It is property-tested (fast-check): the snapped box is never farther than the threshold from
  the raw one, and a zero-candidate query returns a zero delta.
- **Measurement** is a pure `MeasureFn(MeasureQuery) → MeasureResult` (board 10 #3a/#3b rules).
- **Path geometry** (`PathGeometry.fromNode/toNode`) converts between `path` nodes and
  contours. The pen commits ONE `path` node per contour in ONE undo step; path edits are one
  step per gesture (the M1 stack-checked gesture collapse applies).

### UI contract

`packages/ui/src/m2-contract.md` lists every M2 component with its props and node id:
SizeField, AlignmentGrid, MenuDense/MenuItemDense/MenuDivider, Popover (+ wide),
DirectionControl, FillRow, EffectRow, StrokeSideFields, Slider/HueSlider/AlphaSlider,
ColorArea, GradientStopBar, SwatchTile, IconTile, TooltipHint, ZoomBadge, plus the board 09
popovers and the board 08 panel sections composed from them.

### Design-only artifacts that never ship

Board 08 stores the Hero Image's dashed per-side stroke in node metadata `kimo-stroke` and
fakes it with helper paths `inD4e` / `Iun59` (Pencil cannot draw dashes). Code renders real
dashes from the `.kimo` stroke; the helper paths are not translated.

## Consequences

- Builders work in parallel against stable types; M2 members are optional so M1 code keeps
  compiling until each part lands (then `CanvasHandle`'s M2 members become required).
- The renderer must implement: dashes (incl. per-side), stroke align for open/closed shapes,
  miter limit, layer blend (`saveLayer` with blend; pass-through without a layer), hidden
  effects, spread, inner shadows, background blur (`saveLayer` with a backdrop filter),
  icons, and the board 10 overlays.
- `@kimo/design-tokens` must add `measure`, `measure-soft`, `chip-edge`, `radius-xs`,
  `radius-2xs` (present in the .pen, absent from `tokens.json`).
- Icon packages add licenses to `NOTICE` (lucide ISC, phosphor MIT, Material Symbols
  Apache-2.0, feather MIT).

## Alternatives considered

- **Feature flag for the new fields** (`style/layer-blend`): would make a document with a
  hidden shadow open read-only in an older 0.1 build. The format is a draft and every addition
  has a default equal to the old behavior, so unknown-property preservation is enough.
- **`pass-through` as the frame default** (Figma): exporters would have to emit isolation
  rules for the common case, and board 08 shows "Normal" for a frame. Rejected.
- **Image as an editor-state `Tool`**: cleaner, but editor-state is another builder's area;
  kept as a host placement now, with the change requested (see "Revisit when").
- **Snapping inside the renderer**: the renderer would need the selection policy and sibling
  sets; keeping it a pure host function makes it testable headless.

## Revisit when

editor-state gains an `image` tool (drop the placement API), Phosphor's fill/duotone styles
or Material's FILL axis are designed, or the pixel-grid fade gets a designed duration. Also when Material weight fidelity matters (ship per-weight packs instead of
`materialOffset`), or when the icon picker's first open (≈20 hashed shards for the first
alphabetical page) needs to be cheaper (shard by catalog order instead of name hash).
