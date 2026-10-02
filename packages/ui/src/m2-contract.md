# @kimo/ui — M2 component contract

Source of truth: `desing.pen` boards **02b Components — Styling (M2)** (`mj1CX`), **08 Editor —
Styling (M2)** (`hkpU9`, right panel `hgQkJ`), **09 Popovers (M2)** (`h3BVP0`) and **10 Canvas
Overlays (M2)** (`nzfXx`). Decision record: [ADR 0010](../../../docs/adr/0010-m2-styling-and-tools.md).

This file fixes **names, props and node ids** so the UI builder (`packages/ui`) and the panel
builder (`apps/web/src/editor`) agree. Values below were read from the nodes with the Pencil
MCP; when building, re-read the node (CLAUDE.md design→code rules: exact values, DOM isomorphic
to the node tree, container flex 1:1, exact lucide icon names, one measured
`getComputedStyle`/`getBoundingClientRect` pass). Ignore `enabled: false` nodes except as the
alternate state named here.

Conventions (same as M1 components):

- One folder per component (`src/<kebab>/<Name>.tsx` + `.css`), class prefix `kimo-<kebab>`,
  only `--kimo-*` custom properties, exported from `src/index.ts` with its `Props` type.
- Every component spreads remaining DOM props on its root and forwards `ref` (React 19 ref prop).
- Controlled values; `onChange` receives the new value, never an event, unless named `on…Event`.
- Icons are `lucide-react` with the exact design name (kebab → Pascal: `grid-3x3` → `Grid3x3`).
- New tokens the design uses that `@kimo/design-tokens` must add first: `measure`
  (#E5177E / #FF5CAB), `measure-soft` (#E5177E1F / #FF5CAB2E), `chip-edge` (#0A0A0A14 /
  #FFFFFF24), `radius-xs` (4), `radius-2xs` (2). (light / dark)

Token shorthand below: `bg-subtle` = `var(--kimo-bg-subtle)`, `r-sm` = `--kimo-radius-sm` (6),
`r-xs` 4, `r-2xs` 2, `r-md` 10, `r-lg` 16, `pill` 999; text sizes `xs` 11, `sm` 12, `base` 13.
`sans`/`mono` = `font-sans`/`font-mono`. Padding is `[top/bottom, left/right]` or
`[t, r, b, l]`, exactly as in the node.

---

## 1. Leaf components (board 02b)

### SizeField — `G6R6IX`
W/H field with a sizing-mode menu (Position section).

```ts
interface SizeFieldProps {
  prefix: string                       // "W" | "H"
  value: string                        // "640"
  mode: SizeMode                       // shown as "Fixed" | "Hug" | "Fill"
  modes?: readonly SizeMode[]          // enabled entries of the mode menu (Fill only in a layout parent)
  onValueCommit?: (value: string) => void
  onModeChange?: (mode: SizeMode) => void
  disabled?: boolean
}
type SizeMode = "fixed" | "fit" | "fill"   // labels: Fixed · Hug · Fill
```

Node: frame `fill_container` × 28, `bg-subtle`, `r-sm`, row, gap 8, padding [0, 8], align
center. Children in order: **Prefix** `t111tE` (mono xs normal, text-tertiary) · **Value**
`WCAAf` (sans sm normal, text-primary; the editable input) · **Spacer** `jl5qQ` (fill × 1) ·
**Mode** `aC4BS` (sans xs 500, text-secondary) · **Chevron** `n908B` (lucide `chevron-down`
12, text-tertiary). Mode + chevron open a `MenuDense` (4px below, left-aligned) with
Fixed / Hug / Fill, checked = current.

### AlignmentGrid — `i1pQK`
3×3 justify/align picker of the Auto layout section.

```ts
interface AlignmentGridProps {
  dir: "row" | "column"
  /** main-axis position: start | center | end (between/around/evenly → no cell active) */
  justify: "start" | "center" | "end" | "between" | "around" | "evenly"
  align: "start" | "center" | "end"
  onChange?: (v: { justify: "start" | "center" | "end"; align: "start" | "center" | "end" }) => void
}
```

Node: frame `fill_container` × 64, `bg-subtle`, `r-sm`, **column**, padding [4, 8],
`justify-content: space-between`. Three rows (`Top Row` xdx2v, `Middle Row` q0HLow,
`Bottom Row` S6hP0): `fill_container`, row, `space-between`, align center. Each row has three
cells (`Top Left` XKNOk …): 24 × 16, `r-xs`, center/center, containing either

- **Dot** (inactive; e.g. `C2gPgq`): ellipse 3 × 3, text-tertiary, or
- **Bars** (active; e.g. `tkeBE`): frame h 12, row, gap 2, three rects 2 × 6 / 2 × 10 / 2 × 6,
  radius 1, `accent`; `align-items`: top row default (flex-start), middle row `center`,
  bottom row `end` (`flex-end`).

Exactly one cell shows Bars (the others show Dot). Grid position = (row = cross axis for
`dir: row`, column = main axis). For `dir: column` the axes swap; the design only shows row —
TODO(design): bars orientation for column.

### PropSectionEmpty — `z1rMhb`
Not a new component: `<PropSection title="Auto layout" action={{ label: "Add auto layout",
icon: <Plus size={14} /> }} />` with **no children** (the instance disables Row `y5Lz1A`). The
existing PropSection must render header-only with its [12, 12, 16, 12] padding.

### MenuDense, MenuItemDense, MenuDivider — `G7A3Aj`, `EAGNC`, `fYNDQ`
Dense menus for every Select in the panel (blend modes, size modes, distribution, stroke
align, image mode, color format).

```ts
interface MenuDenseProps { children: ReactNode; width?: number }      // role="menu"
interface MenuItemDenseProps {
  label: string
  checked?: boolean        // Check icon visible + label weight 500 + bg-hover
  highlighted?: boolean    // keyboard/hover highlight: bg-hover
  meta?: string            // right text (Meta T4CD1), e.g. "244 162 97"
  mono?: boolean           // label in font-mono ("With meta" variant dQw9B)
  onSelect?: () => void
  onHighlight?: () => void // live preview (blend menu)
}
type MenuDividerProps = Record<string, never>
```

- **Menu/Dense**: `fill_container` (instances set 208), `bg-overlay`, `r-lg`, stroke 1
  `border`, shadow 0 8 24 `shadow-strong`, column, gap 1, padding 4; one **Items** frame
  (`ksc3x`, column, gap 1, fill) holds the items.
- **MenuItem/Dense**: `fill_container` × 28, `r-sm`, row, gap 8, padding [0, 8], align center:
  **Check Slot** `Hl922` 14 × 14 center/center (lucide `check` 14 text-primary when checked,
  empty otherwise) · **Label** `BRxvS` sans sm normal text-primary (500 when checked) ·
  **Spacer** · **Meta** `T4CD1` mono xs normal text-tertiary (only when `meta`).
- **Menu/Divider**: `fill_container`, padding [4, 8]; **Line** `eTfCQ` fill × 1 `border`.

### Popover — `xvOvm` (+ `Popover/Wide` `u0aiz`)

```ts
interface PopoverProps {
  title?: string                 // Header > Leading > Title
  headerLeading?: ReactNode      // replaces Leading (color picker tabs)
  actions?: ReactNode            // replaces the Close button group (eyedropper + close)
  wide?: boolean                 // 296 instead of 248
  onClose?: () => void
  children: ReactNode            // Body
  anchor?: DOMRect               // the shell positions it; see placement per popover
}
```

Frame 248 wide (wide 296), `clip`, `bg-overlay`, `r-lg`, stroke 1 `border`, shadow 0 8 24
`shadow-strong`, column. **Header** `Am1eq`: `fill_container` × 40, bottom stroke 1 `border`,
padding [0, 6, 0, 12], `space-between`, align center; **Leading** `lSGG7` (row, gap 6,
center) → **Title** `cNBKW` sans sm 600 text-primary; **Close** `gKfsp` = IconButton 24 × 24,
transparent, lucide `x` 14 text-tertiary. **Body** `LjbJY`: `fill_container`, column, gap 12,
padding 12.

### DirectionControl — `J6Reo`

```ts
interface DirectionControlProps { value: "row" | "column"; onChange?: (v: "row" | "column") => void }
```

Frame `bg-muted`, `pill`, row, gap 2, padding 2. Two items 32 × 24, `pill`, center/center:
**Horizontal** `xyvmk` (lucide `arrow-right` 14) and **Vertical** `RzC9v` (`arrow-down` 14).
Selected: fill `bg-app`, shadow 0 1 2 `shadow`, icon text-primary; unselected: no fill,
icon text-tertiary. role="radiogroup".

### FillRow — `xYqbE`

```ts
interface FillRowProps {
  swatch: string               // CSS background for the 16×16 swatch (color, gradient or url())
  label: string                // "F4A261" | "Linear" | "Image · Cover" | "brand/sand"
  labelFont?: "mono" | "sans"  // hex = mono (ColorField default); kinds and variable names = sans
  opacity?: string             // "80%"
  visible: boolean
  active?: boolean             // its popover is open: field bg-hover + stroke 1 border-strong
  removable?: boolean          // Remove shown; design hides it with opacity 0 (keeps its 24px)
  onOpen?: () => void
  onToggleVisible?: () => void
  onRemove?: () => void
}
```

Frame `fill_container`, row, gap 2, align center: **Field** `chrvk` = the existing
`ColorField` (`GOaBx`: fill × 28, `bg-subtle`, `r-sm`, row gap 8, padding [0, 6]; Swatch 16,
radius 4, stroke 1 `border`; Value mono sm; Spacer; Opacity sans sm text-tertiary) · **Eye**
`r3MBc` IconButton 24 transparent, lucide `eye` / `eye-off` 14 text-tertiary · **Remove**
`FFtaO` IconButton 24 transparent, lucide `minus` 14 text-tertiary. Used by Fill and Stroke.

### EffectRow — `Q6vwp`

```ts
type EffectKind = "drop-shadow" | "inner-shadow" | "layer-blur" | "background-blur"
interface EffectRowProps {
  kind: EffectKind               // labels: Drop shadow · Inner shadow · Layer blur · Background blur
  visible: boolean               // hidden: Field opacity 0.5, Eye icon eye-off
  open?: boolean                 // details expanded: Settings fill+stroke accent, icon on-accent
  removable?: boolean
  onToggleOpen?: () => void
  onKindChange?: (k: EffectKind) => void   // Type + Chevron open a MenuDense
  onToggleVisible?: () => void
  onRemove?: () => void
}
```

Frame `fill_container`, row, gap 2, center. **Field** `gLR6X`: fill × 28, `bg-subtle`, `r-sm`,
row, gap 6, padding [0, 8, 0, 4], center → **Settings** `upS17` 20 × 20, `bg-app`, `r-xs`,
stroke 1 `border`, center/center, icon 12 text-secondary: `sliders-horizontal` (shadows),
`droplet` (layer blur), `droplets` (background blur) · **Type** `q0Vgql` sans sm normal
text-primary · **Spacer** · **Chevron** `Gh1AU` `chevron-down` 14 text-tertiary. Then **Eye**
`nYSHl` and **Remove** `M0titT` as in FillRow. Schema mapping: drop/inner shadow →
`kind: "shadow"` (`inner`), layer blur → `"blur"`, background blur → `"backdrop-blur"`.

### StrokeSideFields — `YMKcJ`

```ts
interface StrokeSideFieldsProps {
  value: { t: number; r: number; b: number; l: number }
  onChange?: (side: "t" | "r" | "b" | "l", value: number) => void
}
```

Frame `fill_container`, row, **gap 4**; four `PropField`s (`A9DDs`) `fill_container` with
prefixes T, R, B, L.

### Slider — `UWiq1`, HueSlider — `weqLa`, AlphaSlider — `qpmcK`

```ts
interface SliderProps { value: number; min?: number; max?: number; step?: number; onChange?: (v: number) => void; "aria-label": string }
interface HueSliderProps { hue: number /* 0–360 */; color: string /* thumb fill */; onChange?: (h: number) => void }
interface AlphaSliderProps { alpha: number /* 0–1 */; color: string /* opaque rgb */; onChange?: (a: number) => void }
```

All three: frame 224 × 14 (fill the parent width when placed in a fill container), absolute
children (`layout: none`).

- **Slider**: Track `Y9KX4` y 5, h 4, `pill`, `bg-muted`; Fill `sBcG4` same, `accent`, width =
  value fraction; Thumb `g0Ask` ellipse 14, `#FFFFFF`, stroke 1 `border-strong`, shadow 0 1 3
  `shadow-strong`, centered on the value.
- **Slider/Hue**: Track `kakaj` y 1, h 12, `pill`, stroke 1 `chip-edge`, linear gradient left →
  right #FF0000 0 · #FFFF00 .17 · #00FF00 .33 · #00FFFF .5 · #0000FF .67 · #FF00FF .83 ·
  #FF0000 1; Thumb `I4582f` ellipse 14, fill = current color, stroke 2.5 `#FFFFFF`, shadow
  0 1 3 `#0A0A0A40`.
- **Slider/Alpha**: Track `A62mZE` frame y 1, 224 × 12, `clip`, `#FFFFFF`, `pill`, stroke 1
  `chip-edge` → **Checker** `rp05o` (#E4E2DE, 4px squares) and **Gradient** `C4KYVj`
  (color at alpha 0 → color, left → right); Thumb `o6DokA` as Hue.

### ColorArea — `H5QKDe`

```ts
interface ColorAreaProps { hue: number; saturation: number; value: number; color: string; onChange?: (sv: { saturation: number; value: number }) => void }
```

Frame 224 × 160, `clip`, `r-sm`, fill = pure hue; **Saturation** `P4xJV` (white → white 0%,
left → right); **Brightness** `h99I2` (black 0% → black, top → bottom); **Picker Ring**
`phbmP` ellipse 14, fill = color, stroke 2.5 `#FFFFFF`, shadow 0 1 3 `#0A0A0A59`, centered on
(s, 1 − v).

### GradientStopBar — `rbnJS`

```ts
interface GradientStop { color: string; at: number }
interface GradientStopBarProps {
  stops: readonly GradientStop[]
  selected: number
  onSelect?: (i: number) => void
  onMove?: (i: number, at: number) => void   // drag along the axis
  onAdd?: (at: number) => void               // click on the bar
}
```

Frame 224 × 36, absolute. **Bar** `i6ppu` 224 × 24 at (0, 0), `clip`, `#FFFFFF`, `r-sm`,
stroke 1 `border-strong` → Checker (#E4E2DE) + Gradient (stops left → right). **Stops** at
y 18, x = `at × (224 − 16)`: frame 16 × 16, `#FFFFFF`, `r-xs`, stroke 1 `border-strong`
(selected: 2 `selection`), shadow 0 1 3 `shadow-strong`, padding 3 → **Color** rect fill ×
fill, `r-2xs`. TODO(design): the bar's Checker `a99w5` scales a 224 × 12 viewBox to 24 tall
(4 × 8 cells); ship 4 × 4 cells unless the designer confirms.

### SwatchTile — `rg74x` (+ Selected `Jr3U1`)

```ts
interface SwatchTileProps { color: string; selected?: boolean; size?: 20 | 18; onClick?: () => void; "aria-label": string }
```

Frame 20 × 20, `r-sm`, stroke 1.5 transparent (selected: `accent`), padding 2 → **Color** rect
fill × fill, `r-xs`, stroke 1 `chip-edge`. The Variables list uses an 18 × 18 / padding 1
instance (`size={18}`).

### IconTile — `D4Fvc` (+ Hover `Nv0eZ`, Selected `cJZRB`)

```ts
interface IconTileProps { name: string; icon: ReactNode; selected?: boolean; onSelect?: () => void }
```

Frame 32 × 32, `r-sm`, center/center; icon 16 text-secondary. Hover (CSS `:hover`, not a
prop): `bg-hover`, icon text-primary. Selected: `accent`, icon `on-accent`. role="option".

### TooltipHint — `u0dQ1`
Canvas hint pill (pen tool, close path, path edit mode).

```ts
interface TooltipHintProps { icon: ReactNode; children: ReactNode }
```

Frame `text-primary` fill, `pill`, shadow 0 4 12 `shadow`, row, gap 8, padding
[6, 12, 6, 10], center; icon 12 `text-inverse` (`pen-tool` / `circle-dot` / `spline`); label
sans sm 500 `text-inverse`. Placement: 12px above the floating toolbar, centered (board 10
#7); "Close path" next to the cursor (#5); path-edit pill at the top of the canvas (#6).

### ZoomBadge — `L5GCtM` (SizeBadge/Zoom)

```ts
interface ZoomBadgeProps { zoom: number /* 8 → "800%" */ }
```

Frame `bg-app`, `pill`, stroke 1 `border`, shadow 0 2 8 `shadow`, row, gap 6, padding [4, 10],
center: lucide `grid-3x3` 12 text-secondary · label mono xs 500 text-primary. Shown at the
canvas's top-left (16, 16) while the pixel grid is visible.

### Canvas-only primitives (renderer, not React)

Drawn by `@kimo/renderer` from `Overlay` (see `OVERLAY_SPEC_M2` in
`packages/renderer/src/types.ts`); listed so nobody builds them as DOM:
`SizeBadge` `JlrHC`, `SizeBadge/Delta` `PIz6o`, `SizingBadge` `xPekI`, `MeasurePill`
`lSZXU`, `SnapMarker` `L1uJy`, `PathAnchor` `iqdgN` / `V9wRl`, `BezierHandle` `B65mjM`.

---

## 2. Popovers (board 09) — composed in `apps/web/src/editor` from §1

All open from their panel row, **4px below, left-aligned** with the row (board 09 caption of
the blend menu: "like every Select in the panel"), and close on Esc / outside click.
Every edit is one `store.apply` with the editor origin; a drag (slider, area, stop) is one
undo step per gesture.

| Popover | Node | Built from | Notes |
|---|---|---|---|
| **ColorPicker** (Custom tab) | `E1jsd` › `jNAqx` | Popover 248; headerLeading = Tabs (Tab/Active `P3e7Mp` "Custom", Tab `GfneW` "Variables"; frame gap 2, padding-left −6 in this state); actions = IconButton `pipette` + `x` (14, text-secondary) | Body: ColorArea · **Sliders** (column, gap 10: HueSlider, AlphaSlider) · **Value Row** (gap 6, center: Format select 68 × 28 "HEX" + `chevron-down` 14, space-between, padding [0, 8]; Hex field fill × 28 prefix "#" xs text-tertiary; Opacity field 60 × 28 "100%") · Divider (fill × 1 `border`) · **Document colors** (column, gap 8: label xs text-tertiary; Swatches row gap 6 of SwatchTile). Eyedropper uses `EyeDropper` where available, hidden otherwise. |
| **ColorPicker** (Variables tab) | `MoN4J` › `nim6l` | same Popover, tabs swapped, actions = `x` only | Body: **Search** (Input `Zs05d`: h 28, `bg-muted`, stroke 1 `border`, `r-sm`, padding [0, 10], gap 8, `search` 14 text-tertiary, "Search variables") · **List** (column, gap 2): group header (row gap 8, padding [0, 6, 4, 6] first / [8, 6, 4, 6] next; name + count xs text-tertiary) and **VariableRow** (h 28, padding [0, 6], gap 8, `r-sm`; selected `accent-soft`): SwatchTile 18 · name sans sm text-primary · Spacer · **Modes** (gap 3: chip 10 × 10, radius 3, stroke 1 `#0A0A0A1F`, one per theme value) · `check` 14 (text-primary when selected, transparent otherwise) · **Footer** (gap 8, padding [8, 6, 0, 6], top stroke 1 `border`: "Modes" · Spacer · "light · dark", xs text-tertiary). Picking binds `{ $ref }`. |
| **GradientEditor** | `o13Uf` › `b2Y0pD` | Popover 248 "Gradient" | Body: **Type Row** (gap 4: Segmented fill "Linear · Radial · Angular" with labels sans xs 500; IconButton 24 `rotate-cw` = rotate 90°; IconButton 24 `flip-horizontal-2` = reverse stops) · GradientStopBar · **Stops** (column gap 6: header "Stops" xs text-tertiary + Add stop 20 × 20 `plus` 14; per stop row gap 4: color field (ColorField padding [0, 6]; selected bg-hover + stroke 1 `selection`), Position 52 × 28 "55%", Remove 24 `minus`) · Divider · ColorArea + HueSlider for the selected stop. |
| **BlendModeMenu** | `EdigD` › `YFOTX` | MenuDense width 208 | Groups separated by MenuDivider: Normal, Pass through │ Darken, Multiply, Plus darker, Color burn │ Lighten, Screen, Plus lighter, Color dodge │ Overlay, Soft light, Hard light │ Difference, Exclusion │ Hue, Saturation, Color, Luminosity. Values: `normal`, `pass-through` (frames/groups only; omit for other types), `darken`, `multiply`, `linear-burn`, `color-burn`, `lighten`, `screen`, `linear-dodge`, `color-dodge`, `overlay`, `soft-light`, `hard-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity`. Highlight previews live (no undo entry), Esc reverts, select commits one step. |
| **IconPicker** | `jKClR` › `b1gaD`, empty `Vr0Sk` › `r6tBTD` | Popover **wide** (296) "Icon" | Body: **Search** (as above; placeholder "Search 1,600 icons"; typed: stroke `border-strong`, text-primary) · **Library** Segmented fill (Lucide · Phosphor · Material · Feather; segments h 24, `pill`; active `bg-app` text-primary, else text-secondary; sans xs 500) · *Material only:* **Style** Segmented (Outlined · Rounded · Sharp) and **Weight Row** (gap 8: label 40 wide "Weight" sans sm text-secondary; Slider 224, 100–700) · **Grid** (column gap 8): sections "Recent" / "All icons" (column gap 4; label xs 500 text-tertiary; rows gap 2 of 8 IconTiles) · **Footer** (gap 8, padding [8, 0, 0, 0], top stroke 1 `border`: icon name mono xs text-primary · Spacer · "lucide · ISC" mono xs text-tertiary). **Empty**: column gap 6, padding [28, 16], center, `bg-subtle`, `r-md`: `search-x` 20 text-tertiary · "No icons match “xyzzy”" sans sm 500 · "Try another library or a shorter word" xs text-tertiary · Clear search (h 28, padding [0, 14], gap 6, `pill`: `x` 14 + sans sm 500 text-secondary). Data: `IconProvider.catalog(set)` from `@kimo/renderer`; licenses in the footer: lucide ISC, phosphor MIT, material Apache-2.0, feather MIT. TODO(design): Phosphor weight control. |
| **ImageFillPopover** | `wM79U` › `Kgfrv` | Popover 248 "Image" | Body: **Preview** (fill × 140, `#C9B8A6`, stroke 1 `border`, `r-md`; image drawn with the fill's mode; **Mode Badge** at (8, 112): padding [2, 8], `#0A0A0A99`, `pill`, mono 10 `#FFFFFF` "2400 × 1600") · **Mode Row** (gap 8: label 48 wide "Mode"; select field fill × 28 `bg-subtle` `r-sm` padding [0, 8] space-between "Cover" + `chevron-down` 14 → MenuDense Cover · Contain · Stretch (the caption lists these three; `tile` exists in the schema — TODO(design): offer Tile or not)) · **Opacity Row** (label 48 "Opacity"; field "100%") · **Actions** (gap 8, padding [4, 0, 0, 0]: Replace fill × 28, `bg-muted`, stroke 1 `border-strong`, `pill`, padding [0, 14], gap 6, center, `upload` 14 + "Replace" sans sm 500 text-primary; Remove h 28 `pill` padding [0, 14] gap 6 `trash-2` 14 + "Remove" sans sm 500, both `danger`). Drop onto the preview = Replace. |

---

## 3. Right panel sections (board 08 `hgQkJ`) — `apps/web/src/editor/RightPanel.tsx`

Panel 280 wide, `bg-app`, left stroke 1 `border`, column. Sections are `PropSection`
(`fWrGA`) instances; **Body** = column, gap 8, fill; **Row** = row, gap 8, center, fill.
**ToggleRow** = row, h 28, gap 8, center: label sans sm text-secondary · Spacer · Toggle.

| Section | Node | Content (in order) |
|---|---|---|
| Selection header | `eZbgB` | row, gap 8, padding [8, 12, 12, 12], bottom stroke 1 `border`: type icon 14 `accent-text` (`frame`, …) · name sans base text-primary · Spacer · Badge (kind). |
| **Layer** | `cmbN4` | no action. Row: Select "Blend mode" fill (opens BlendModeMenu) · PropField "Opacity" 96 wide, prefix icon `blend` 12 text-tertiary, "100%". |
| **Position** | `Z72l9N` | no action. Row X · Y (PropField) · Row W · H (**SizeField**) · Row Rotation (prefix icon `rotate-cw`) · Radius (prefix icon `square-dashed`) · ToggleRow "Absolute position" (only for children of a layout frame; `position: "absolute"`). |
| **Auto layout** | `S3QTvG` | action `minus` = remove `layout`; absent layout → PropSectionEmpty (`plus`). Direction Row (h 28: DirectionControl · Spacer · "Wrap" label · Toggle → `layout/wrap` feature) · Align Row (gap 8, top-aligned: AlignmentGrid fill · Spacing Column fill, column gap 8: PropField "Gap" · Select "Distribution" — design shows "Packed" only; menu entries are schema-derived: Packed / Space between / Space around / Space evenly ↔ `justify` start (center/end via the grid) | between | around | evenly) · Padding Row (PropField prefix `arrow-left-right` = horizontal, `arrow-up-down` = vertical) · ToggleRow "Individual padding" (on: four PropFields T R B L like StrokeSideFields, writes `pad: [t, r, b, l]`). |
| **Fill** | `LpXDi` | action `plus`; FillRow per paint, top row = topmost paint. Opens ColorPicker / GradientEditor / ImageFillPopover. |
| **Stroke** | `qQR6J` | action `plus`; FillRow (stroke paint) · Row: PropField "Weight" 96 (prefix icon `menu`) · Select "Align" ("Inside" in the design; entries from the schema: Inside / Center / Outside) · ToggleRow "Individual sides" · StrokeSideFields (when on; `width: {t, r, b, l}`) · ToggleRow "Dashed" · Row PropField "Dash" · "Gap" (`dash: [dash, gap]`) · Cap Row (label 36 wide "Cap" + Segmented fill Butt · Round · Square) · Join Row ("Join" + Segmented Miter · Round · Bevel). |
| **Effects** | `Vyrj5` | action `plus`; EffectRow per effect; the open one is followed by its details (column gap 8): Row X · Y, Row Blur · Spread (shadows only), ColorField shadow color ("0A0A0A" + "12%"). Blurs show a single "Blur" PropField. |
| **Icon** (icon nodes) | board 09 `jKClR` panel fragment `CVMdd` | Icon Field (h 28, padding [0, 8], gap 8, `r-sm`; idle `bg-subtle`, open `bg-hover` + stroke 1 `border-strong`: icon 14 text-primary · name sans sm · Spacer · library label xs text-tertiary) → IconPicker · Row: "Size" field · "Stroke" field (lucide/feather → `strokeWidth`) or "Weight" (material/phosphor → `weight`). |

Mixed values across a multi-selection show "Mixed" (house rule from M1 `fields.tsx`).

---

## 4. Implementation status (`@kimo/ui`)

Every component of §1 and every popover of §2 ships from `@kimo/ui` (see `src/index.ts`); the
editor may use the composite popovers directly or compose its own from the leaves.

| Export | Notes beyond §1–§2 |
|---|---|
| `ColorPicker` | Controlled `color` (hex), `tab`/`format` optional-controlled, `onChangeStart/End` per gesture. Conversions in `color` (`formatColor`, `parseColor`, `rgbToOklch`, …), property-tested. |
| `GradientEditor`, `GradientStopBar` | Stop bar: click adds, drag moves (one gesture), ←/→ (Shift ×10) nudge, Delete/Backspace removes (min 2 stops). |
| `BlendModeMenu` | `onPreview(mode \| null)` live preview, `null` = revert (Escape / outside click without a pick). |
| `IconPicker` | `provider: IconIndexProvider` (structural subset of the renderer's `IconProvider`), `initialQuery`, virtualised "All icons" (8 × 32, 36px row pitch), ←↑→↓/Home/End/Enter. |
| `ImageFillPopover` | `src`, `mode`, `modes` (default cover · contain · stretch; pass `"tile"` to offer it), `opacity`, `naturalSize` (else measured from `src`), `onReplace(file)` (dialog or drop on the preview), `onRemove`. |
| `Popover` | `anchor` (element or rect) → `position: fixed`, 4px below / left-aligned with flip + shift (`anchoredPosition`, pure); focus trap, Escape, outside pointerdown; `initialFocus`. |
| `PropField` / `PropTextField` | `prefix` also accepts a 12 × 12 icon (board 08 Opacity `blend`, Rotation `rotate-cw`, Radius `square-dashed`, padding `arrow-left-right` / `arrow-up-down`). |

Measured pass: `bun run --filter @kimo/ui measure:gallery` compares the Gallery's M2 boards
(`GalleryM2`, `data-pen` ids) with `test/fixtures/pen-components-m2.json` (read from the nodes):
0 drift; 8 accepted deviations are data-driven (ColorArea base is the pure hue; ring/alpha
thumb follow the value — the nodes are not self-consistent). Design copy deviation: the OKLCH
meta of #F4A261 is `0.78 0.13 58` (exact OKLab hue 57.7°), the node reads `… 55`.
