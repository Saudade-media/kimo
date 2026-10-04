# @kimo/ui — M3 component contract

Source of truth: `desing.pen` boards **02c Components — Systems (M3)** (`SD9TU`), **11 Editor —
Components (M3)** (`Yf2Ax`: editor body `CADFy`, annex `d4ldDT`), **12 Editor — Main component
(M3)** (`M3150`: editor `k299zu`, annex `q6jWa`), **13 Assets & Libraries (M3)** (`XoUIl`),
**14 Variables & Themes (M3)** (`JlaLY`: variables dialog `igDdR`) and **15 Feedback states
(M3)** (`qJRq1`). Decision record: [ADR 0011](../../../docs/adr/0011-m3-components-and-variables.md).

This file fixes **names, props and node ids** so the UI builder (`packages/ui`), the panel
builder (`apps/web/src/editor`) and the canvas builder (`apps/web/src/canvas`) agree. Values
were read from the nodes with the Pencil MCP; when building, re-read the node (CLAUDE.md
design→code rules: exact values, DOM isomorphic to the node tree, container flex 1:1, exact
lucide icon names, one measured `getComputedStyle`/`getBoundingClientRect` pass). Ignore
`enabled: false` nodes except as the alternate state named here.

Conventions: same as M1/M2 (`m2-contract.md`): one folder per component, class prefix
`kimo-<kebab>`, only `--kimo-*` custom properties, exported from `src/index.ts` with its `Props`
type, rest props spread on the root, React 19 `ref` prop, controlled values with `onChange(value)`,
`lucide-react` icons with the exact design name (kebab → Pascal).

**New tokens** (`@kimo/design-tokens` adds them first; ADR 0007 amendment):
`component` (#7C3AED light / #A78BFA dark) and `component-soft` (#7C3AED14 / #A78BFA24).
**Violet means component/instance identity only** — glyphs, canvas outlines, slot outlines,
the override dot, component-tone selection, slot drop hints. Never decoration.

Token shorthand: `bg-subtle` = `var(--kimo-bg-subtle)`; `r-xs` 4, `r-sm` 6, `r-md` 10, `r-lg`
16, `r-xl`, `r-2xl`, `pill` 999; text `xs` 11, `sm` 12, `base` 13, `md`, `xl`; `sans`/`mono`.
Padding is `[top/bottom, left/right]` or `[t, r, b, l]` exactly as in the node. "row" = the
Pencil default horizontal layout; "column" = `layout: vertical`.

Data comes from `@kimo/core-schema` (ADR 0011): `createExpandedView` (expanded instances,
composite ids `<instance>/<IdPath>`, provenance `origin(id)`: `overrides`, `owned`, `slot`,
`instance.chain`), `declaredProps`, `resolveVariable`, `axisDisplayOrder`, `libraryUsage`.
Every change goes through `@kimo/editor-state` `applyCommand(store, M3Command, { origin })`
(or `CanvasHandle.runCommand`): one undo step per gesture.

---

## 1. Identity (02c "Identity — layers & canvas", `tqwgl`)

Legend (02c `M5DvY3`): `component` glyph = main · `diamond` = instance · "from …" = derived ·
dot = overridden · dashed = slot · `replace` glyph = replaced child.

### OverrideDot — `rqoRv`
12 × 12 frame, center/center; child **Dot** `T0yxdd` ellipse 6 × 6 fill `component`.
```ts
interface OverrideDotProps { visible?: boolean /* false → opacity 0, keeps its 12px slot */ }
```
Used in LayerRow (`Override` slot, hidden by default), InstancePropRow label cells (opacity 0
when not overridden), Overrides summary. Hover on a dot shows the **Reset hint** pill
(board 11 `izW94`: row, gap 8, padding [6, 12, 6, 10], fill `text-primary`, pill; icon
`rotate-ccw` 12 `text-inverse`; label sans xs 500 `text-inverse` "Click to reset to main ·
“<value>”"); click = `resetOverride` of that entry.

### LayerRow/* (layers panel rows)
All: row, gap 6, padding [0, 8], align center, `fill_container` × 28, `r-sm`. Children in
order: **Disclosure** (lucide `chevron-right`/`chevron-down` 12 `text-tertiary`) · **Type
Icon** (14, fill `component`) · **Name** (sans sm, `text-primary`) · [extra] · **Spacer**
(fill × 1) · **Override** (OverrideDot, shown when overridden) · **Visibility** (`eye` 14
`text-tertiary`, hover only).

| Variant | Id | Type icon | Name weight | Fill | Extra |
|---|---|---|---|---|---|
| LayerRow/Component | `ZcfUj` (icons `Wl0FR AHoeG`, name `uELcn`) | `component` | 500 | — | — |
| LayerRow/Component/Selected | `L3PiIW` | `component` | 500 | `component-soft` | — |
| LayerRow/Instance | `oHsXi` (name `UDSGK`) | `diamond` | normal | — | — |
| LayerRow/Instance/Selected | `N3AA7R` | `diamond` | 500 | `component-soft` | — |
| LayerRow/Slot | `lAFda` (name `jfGcC`) | `square-dashed` | normal | — | **Slot Tag** `Wep46`: padding [0, 4], stroke 1 `component`, `r-xs`; label `zA2RQ` mono xs `component` "slot" — after Name |
| LayerRow/Replaced | `Uh0kH` (ref of Slot) | `replace` | normal | — | Slot Tag label "replaced"; Override dot **on** |
| LayerRow/Derived | `x5xNG` (ref of Component) | `component` | 500 | — | Spacer replaced by **Origin** `TLTw8` (fill, justify end, align center) with **From** `tBTsQ` sans xs `text-tertiary` "from Button/Primary" |

```ts
type LayerKind = "component" | "instance" | "slot" | "replaced" | "derived"
interface LayerRowM3Props {
  kind: LayerKind
  name: string
  /** derived: base component name ("from Card/Pricing") */
  from?: string
  expanded?: boolean | null   // null = no children (disclosure transparent)
  selected?: boolean          // component/instance only (soft violet fill)
  overridden?: boolean        // OverrideDot
  hidden?: boolean
  depth: number               // indent: existing M1 LayerRow rule
  onToggle?: () => void
  onSelect?: (e: { shift: boolean; meta: boolean }) => void
  onToggleVisible?: () => void
}
```
Panel rules (board 11 annex `C2Qs8V`): instance rows mirror the main's **full** child list
through `ExpandedView.children` (composite ids); rows of instance-owned nodes show their kind
(`slot`, `replaced`) with the override dot; plain descendants use the M1 LayerRow (`GXnBT`).

### CanvasLabel/Component — `tl5O8` · CanvasLabel/Instance — `J3FKSK`
Row, gap 4, align center (no fill). **Glyph** 12 `component` (`component` / `diamond`), **Name**
sans sm 500 `component`. DOM, rendered by CanvasHost (`ComponentDomOverlay.labels`): root
mains/instances 22 px above (like artboard labels, board 12 `dfoWu`), nested selected/hovered
instances 18 px above (board 11 `B70Th`). Derived: "Card/Pricing/Featured · from Card/Pricing"
(board 12 `GtzU7`).

### SlotBadge — `kMGG0`
Row, gap 4, padding [2, 8, 2, 6], align center, fill `component`, pill. **Icon** `PCa4i`
`square-dashed` 10 `text-inverse`; **Label** `VGs3v` mono xs 500 `text-inverse` "Slot · Actions".
Board 12 placement: left of the slot outline, 4 below it (`LQoWJ`).

### SlotQuickInsert — `AJSok`
Row, gap 4, padding [3, 10, 3, 6], align center, fill `bg-subtle`, stroke 1 `border`, pill.
**Icon** `B93PCT` `plus` 12 `text-secondary` · **Glyph** `BSq4s` `component` 12 `component` ·
**Label** `x68rp1` sans xs 500 `text-primary`. "More" variant (board 12 `nev4I`): padding
[3, 8], icon and glyph hidden, label "+1" `text-secondary`. Row `g9pFd`: gap 4, 12 from the
main's left, 13 below it; click = `createInstance(of, { parent, at: slotPath })` (instance) or
a default child (main).

### Canvas outlines (renderer, not DOM) — 02c `sdBO5`
main 1.5 solid (`NENSo`), instance 1 solid (`GTuxN`), slot 1 dashed 4/3 with `component-soft`
fill when empty (`te3fa`); component-tone selection (board 11 `Q4JWk`…`h7Uden`). Contract:
`Overlay.selectionTone`, `Overlay.componentOutlines`, `OVERLAY_SPEC_M3` in `@kimo/renderer`.

## 2. Assets & props (02c `PdC0U`)

### AssetTile — `Q4zkG` (+ `AssetTile/Hover` `SGo9R`)
Column, gap 6, padding 4, width 112, stroke 1 `#00000000`, `r-md`. **Preview** `hwUNY`:
`fill_container` × 72, fill `bg-subtle`, `r-sm`, clip, center/center — holds the component
thumbnail (renderer `exportRaster` of the main at fit scale; design placeholder `txUC3`) and
**Grip** `WhNv3` (`grip-vertical` 12 `text-tertiary`, hover only). **Name Row** `B0LqDC`: row,
gap 4, padding [0, 2, 2, 2], align center: **Glyph** `fjQ56` `component` 12 `component`,
**Name** `eHHvU` sans xs 500 `text-primary`, fixed-width, fill (ellipsis). Hover: fill
`bg-hover`, stroke `border-strong`, grip shown. Drag source (board 13 `a5C4Uc`): opacity 0.5
with hover style. Drag ghost (`kVsm2`): hover tile with fill `bg-overlay`, stroke `component`,
shadow y 12 blur 32 `shadow-strong`.
```ts
interface AssetTileProps {
  name: string; from?: string            // derived: "Button/Ghost · from Primary"
  thumbnail?: string | null              // object URL of the rendered preview
  hover?: boolean; dragging?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onSelect?: () => void
}
```

### AssetRow — `h6gLx` (+ `AssetRow/Selected` `Nugw3`)
Row, gap 8, padding [0, 8], align center, `fill_container` × 28, `r-sm`. **Glyph** `UlF9Z`
`component` 14 `component` · **Name** `jEh39` sans sm normal · **Spacer** · **Meta** `N4UyW`
mono xs `text-tertiary` (usage "12×", "—"). Selected: fill `bg-hover`, name 500, Meta replaced
by **Check** `i5kIH` `check` 14 `text-primary`. Library rows in the panel indent with padding
[0, 8, 0, 26] (board 13 `d8gVP`).

### TypeGlyph — `s5R49`
18 × 18, fill `bg-muted`, `r-xs`, center/center; **Icon** `OHWJN` 12 `text-secondary`.
Icons (02c `etSt8`): text `type` · boolean `toggle-left` · enum `list` · instance `diamond` ·
slot `square-dashed` · color `palette` · number `hash` (string variables `type`).

### PropDefRow — `VqB97`
Column, gap 6, padding [8, 0], `fill_container`, stroke bottom 1 `border`.
**Head** `ZnnUs` (row, gap 6, align center): TypeGlyph `KBBi8` · **Name Field** `bhiaB`
(padding [0, 8], fill × 28, `bg-subtle`, `r-sm`; mono xs) · **Type** `Y1b1v7` (Select `gP276`,
width 92: Text / Boolean / Enum / Instance / Slot) · **Remove** `E7ep1u` (IconButton `ZMxjt`
24, transparent, icon `minus` 14 `text-tertiary`). **Binding** `pVWiu` (row, gap 6, padding
[0, 0, 0, 24]): **Target** `Q6ffKn` (PropField `A9DDs`, fill; prefix icon `crosshair` 12
`text-tertiary`; value "Label · content", "Root · pad") · **Default** `LqiP8` (PropField, fill;
prefix "="). Slot props have no Default; enum props have no Default and add an **Options**
block (board 12 `ClRT2`: column, gap 4, padding [0, 0, 8, 24], stroke bottom `border`; header
`Njt1D` h 20: "Options → pad" xs 600 `text-tertiary`, hint "no arg → as authored", add `plus`
20; option rows `MRqYG` h 28 gap 6: name field 56 · `arrow-right` 12 · value field (prefix =
field name, mono xs value) · remove `minus`).
Derived component (board 12 `PsEAB`): inherited rows opacity 0.55 with Remove icon `lock`;
a redeclared row is full opacity with Remove icon `rotate-ccw` (drops the redeclaration).
```ts
interface PropDefRowProps {
  name: string; type: "text" | "boolean" | "enum" | "instance" | "slot"
  target: string            // display: "<layer name> · <field>"
  defaultValue?: string
  options?: readonly { name: string; value: string }[]   // enum
  state?: "own" | "inherited" | "redeclared"
  onRename?(name: string): void; onTypeChange?(t: PropDefRowProps["type"]): void
  onPickTarget?(): void; onDefaultCommit?(v: string): void
  onRemove?(): void          // own: removeProp · redeclared: removeProp (falls back)
  onOptionChange?(i: number, o: { name: string; value: string } | null): void
  onAddOption?(): void
  dragHandleProps?: object   // reorder → reorderProp
}
```

### InstanceSwapField — `VjO7v`
Row, gap 6, padding [0, 8, 0, 4], align center, fill × 28, `bg-subtle`, `r-sm`. **Preview**
`G23zFQ` 20 × 20 (fill `bg-app`, stroke 1 `border`, `r-xs`, center) with **Preview Icon**
`nGWUc` (12 `text-primary`; the component's thumbnail or glyph) · **Value** `QKKLp` sans sm ·
Spacer · **Glyph** `y5oFE6` `diamond` 12 `component` · **Chevron** `H6W9cl` `chevron-down` 14
`text-tertiary`. Opens the Swap Popover (§5).

### InstancePropRow/* — row, gap 8, align center, `fill_container` × 28
**Label Cell** (row, gap 2, align center, width 84): OverrideDot (opacity 0 unless the arg is
set) + **Label** mono xs (`text-secondary`; overridden: `text-primary`). Then:

| Variant | Id | Control |
|---|---|---|
| /Text | `iYH5j` | **Field** `B4lmr` (row, gap 6, padding [0, 8], fill × 28, `bg-subtle`, `r-sm`): icon `type` 12 `text-tertiary` + Value sans sm |
| /Boolean | `YSJLM` | Spacer + Toggle (`y893S`) |
| /Enum | `ztxNk` | Select (`gP276`, fill) with the option names |
| /Instance | `CpeMN` | InstanceSwapField (fill) |
| /Slot | `ddT4A` | **Content** `Pdjps` (row, gap 6, fill × 28): `square-dashed` 12 `component` · Meta sans sm `text-secondary` ("2 children") · Spacer · **Select** (Button/Ghost, padding [0, 6], h 24, label xs "Select") · **Clear** (IconButton 24, `x` 12) |

```ts
interface InstancePropRowProps {
  prop: { name: string; type: "text" | "boolean" | "enum" | "instance" | "slot" }
  overridden: boolean        // args has the prop (slot: the slot override exists)
  value: unknown             // effective value (arg or authored)
  options?: readonly string[]
  slotCount?: number
  onChange?(value: unknown): void      // setArgs({ [name]: value })
  onReset?(): void                     // dot click: setArgs({ [name]: undefined }) / resetOverride(slot)
  onSelectContent?(): void; onClearContent?(): void   // slot: select owned nodes / empty the slot
}
```

## 3. Variables & themes (02c `T49T0O`)

### AliasChip — `bEYCg`
Row, gap 4, padding [2, 8, 2, 6], align center, fill `bg-muted`, stroke 1 `border`, pill.
**Icon** `UCO47` `link-2` 10 `text-secondary` · **Name** `HanrP` mono xs `text-primary`.
A `{"$ref"}` binding; click opens the Alias Picker.

### WhenChip — `FOOJI`
Row, gap 3, padding [1, 5], align center, fill `bg-muted`, `r-xs`. **Axis** `A3Ic6` mono xs
`text-tertiary` · **Eq** `n95i7v` "=" · **Value** `T20Nq` mono xs 500 `text-primary`.

### EntryRow — `H6Mdtf` (+ `EntryRow/Fallback` `Ni5kJ`)
Row, gap 8, padding [0, 8, 0, 12], align center, `fill_container` × 32, stroke bottom 1 `border`.
**Grip** `x8qPB` (`grip-vertical` 12) · **Index** `yafcc` mono xs `text-tertiary` · **When**
`ZXu86` (row, gap 4, width 300: WhenChips) · **Value** (a VarCell, h 32) · Spacer · **State**
`bNimB` sans xs `text-tertiary` · **Menu** `qyMH0` `ellipsis` 14. Fallback: When holds the
**Fallback Tag** `aKpIg` (padding [0, 5], stroke 1 `border-strong`, `r-xs`; mono xs
`text-secondary` "fallback · no when"), State "used only if nothing matches".
Entries list (board 14 `akJGT`): column, padding [0, 0, 0, 24], fill `bg-subtle`, stroke
`border`; header "Entries" + "<n> · in list order · last matching entry wins" + preview
"preview: light · comfortable → 16"; footer Button/Ghost "Add entry", "Add fallback" (h 24,
`plus` 12). Drag grip reorders (`setVariableValue` with the new array).
```ts
interface EntryRowProps {
  index: number; when: Readonly<Record<string, string>> | null   // null = fallback
  value: React.ReactNode   // a VarCell
  state?: string           // "matches" / "shadowed" / "used only if nothing matches"
  onMenu?(): void; dragHandleProps?: object
}
```

### VarCell/* — row, gap 8, padding [0, 8], align center, 150 × 36
| Variant | Id | Children |
|---|---|---|
| /Color | `iCQwv` | **Swatch** (SwatchTile `rg74x` 18 × 18, padding 1) · Value mono xs (hex without "#"; OKLCH/P3 written as stored) · **Multi** `JKic0` (`layers-2` 10, shown for a multi-axis entry) |
| /Number | `U8aZ2J` | Value mono xs · Multi |
| /String | `MEKrO` | Value sans sm |
| /Boolean | `pxZFa` | Toggle + Value mono xs `text-secondary` |
| /Alias | `xn5O9` | AliasChip |
| /Empty | `OJlJp` | "—" sans sm `text-tertiary` (no entry for that axis value: falls back) |

### VariableRow — `ejBTe`
Row, padding [0, 8, 0, 0], align center, 880 (dialog: fill) × 36, stroke bottom 1 `border`.
**Name Cell** `F2PpG` (row, gap 8, padding [0, 8, 0, 12], width 240 — dialog 216):
Disclosure `esuNz` (`chevron-down`, shown when the entries list is open) · TypeGlyph `ug3QR`
· **Name** `PVpHs` mono xs · **Lint** `SqNTB` (`triangle-alert` 12 `warning`: THEME_NO_MATCH
under the previewed theme). **Values** `vqZcj`: one VarCell per axis value column, axes in
`axisDisplayOrder`, values in axis order. Spacer · **Menu** `Z2AwH` (`ellipsis` 14, opacity 0
until hover). Open row: fill `bg-hover`.

### ModeColumnHeader — `MhpFW`
Row, gap 6, padding [0, 8], align center, 150 × 32, stroke bottom 1 `border`. **Value** `dnWjO`
sans xs 600 · **Default Tag** `VhSDT` (padding [0, 4], fill `bg-muted`, `r-xs`; mono xs
`text-tertiary` "default"; only on the axis's first value) · Spacer · **Menu** `tf2C4`
(`ellipsis` 14) → Column Menu (§5).

### AxisGroupHeader — `E6DjdE`
Row, gap 6, padding [0, 8], align center, 300 × 24. **Icon** `h6b7o` (`layers-2` 12; density
`rows-3`) · **Axis** `VEB5T` mono xs 500 `text-secondary` · **Count** `a3UcT` sans xs
`text-tertiary` "2 values". Width spans its value columns.

### ThemePinRow — `Lamcg`
Row, gap 8, align center, `fill_container` × 28. **Axis Cell** `blp2E` (row, gap 6, width 96):
icon 12 `text-tertiary` (`sun-moon` for `mode`, `rows-3` other local axes, `library` for
`alias:axis`) + Axis mono xs (`text-secondary`; pinned `text-primary`) · **Value** `Rvy1c`
(Select, fill; "Inherit · light" in `text-tertiary` when not pinned, else the value) ·
**Reset** `COjHI` (IconButton 24, `rotate-ccw` 14, opacity 0 when not pinned).
```ts
interface ThemePinRowProps {
  axis: string                      // "mode" | "ui:mode"
  values: readonly string[]
  pinned: string | null             // null = inherit
  inherited: string                 // effective value from the parent chain
  onChange?(value: string | null): void   // setThemePin (real) / setOverride theme (in instance)
}
```

### VariableListRow — `yB4CN` (left panel Variables tab)
Row, gap 8, padding [0, 8], align center, `fill_container` × 28, `r-sm`. **Lead** `YvK47`
16 × 16 center: **Swatch** `NSFgQ` 14 × 14 (stroke 1 `chip-edge`, `r-xs`) for colors, or
**Glyph** `z6GTC` (`hash`/`type`/`toggle-left` 12 `text-tertiary`) · **Name** `iP6bu` mono xs ·
Spacer · **Value** `WJLUV` mono xs `text-tertiary` (resolved under the preview theme) ·
**Alias** `zQn04` (`link-2` 10, when the value is an alias). Click selects; drag onto a field binds.

### ThemeChip (canvas DOM, board 14 `djQO7` / `EnjCg`)
Next to the artboard label (label row gap 8). Inherited: padding [1, 7, 1, 5], gap 4, stroke 1
`border`, transparent, pill; icon `corner-left-up` 10 `text-tertiary`; text 10 `text-tertiary`
"mode: light · inherited". Pinned: fill `bg-app`, stroke `border-strong`, icon `pin`, text
`text-primary` "mode: dark".

## 4. Libraries & feedback (02c `JEmkq`)

### StatusPill — `SVobH` (`/Changed` `n20iVc`, `/Missing` `jwQVJ`)
Row, gap 5, padding [2, 8, 2, 6], align center, pill. **Dot** `dmG7C` 6 × 6 · **Label** `tJyiu`
sans xs 500. Linked: fill `success-soft`, dot/label `success` "Linked"; Changed: `warning-soft`
/ `warning` "Changed"; Missing: `danger-soft` / `danger` "Missing". Compact (assets panel
`MayJf`): padding [1, 6, 1, 5], label 10.
```ts
interface StatusPillProps { status: "linked" | "changed" | "missing"; compact?: boolean }
```

### LibraryRow — `hxry7` (`/Changed` `F8YIg`, `/Missing` `heWrG`)
Row, gap 12, padding [10, 12], align center, `fill_container`, stroke bottom 1 `border`.
**Icon Tile** `mEJR9` 32 × 32 (`bg-muted`, `r-md`; `library` 16 `text-primary`) · **Info**
`vPF9q` (column, gap 2, fill, clip): **Title Row** (gap 8: Name sans base 600 = library
`meta.name`; **Alias** tag `T3U8v` padding [1, 5] `bg-muted` `r-xs`, mono xs `text-secondary`
"ui:") · **Meta Row** (gap 6: Path mono xs `text-tertiary` — `danger` when missing · "·" ·
Count sans xs "24 components · 86 variables" / "12 components · 3 changed" / "file not found ·
9 instances use it") · **Status** (StatusPill) · **Actions** `UQ8Ia` (gap 4: Secondary Action
Button/Ghost h 28 padding [0, 10] "Review" (changed) / "Locate…" (missing); Menu IconButton 28
`ellipsis` 16).

### Toast/Danger — `FVd5q` · Toast/Warning — `qINpv`
Row, gap 10, padding [10, 12], align center, fill `text-primary`, `r-lg`. **Icon** 16
(`circle-x` `danger` / `triangle-alert` `warning`) · **Label** sans sm 500 `text-inverse` ·
**Action** sans sm 600 `accent-soft` (optional). Extends the M1 Toast (`src/toast`) with
`tone: "danger" | "warning"`. Placement (board 15 `b6PPwj`): bottom-center, 12 above the
floating toolbar, newest at the bottom, max 3, older ones opacity 0.5; danger 6 s, warning
4 s, hover pauses. Copy: `M3_TOAST_COPY` (apps/web canvas contract).

### EmptyState (board 15 `XHOWs`)
Column, gap 8, padding 24, align center, fill `bg-subtle`, stroke 1 `border-strong`, `r-xl`.
**Icon Wrap** 40 × 40 `bg-app` pill (icon 18 `text-primary`: `component` / `table-2`) · Title
sans base 600 · Desc sans sm `text-secondary` (fill). Below it **Actions** column gap 6:
primary pill (fill `accent`, h 28, padding [0, 12], icon 14 + label sm 500 `on-accent`) and
secondary pill (fill `bg-muted`, stroke `border-strong`). Copy: "No components yet" / "Select
layers and press ⌥⌘K to make a component, or link a library to use its components." →
"Create component", "Link library…"; "No variables yet" / "Variables hold colors, numbers,
strings and booleans you can bind to fields and switch per theme." → "New variable",
"Import DTCG…".

### ConfirmDialog (board 15 `i8PfIC`, `ysXyK`, `fmB2B`)
Column, gap 14, padding 20, fill `bg-overlay`, stroke `border`, `r-xl`. **Head** (gap 12):
Icon Wrap 32 pill (`component-soft` + `unlink` `component` for Detach; `danger-soft` +
`square-dashed`/`unlink` `danger` for slot/unlink) · Text (gap 4: Title sans md 600, Desc sans
sm `text-secondary`). **Impact** (column, gap 6, padding [10, 12], `bg-subtle`, `r-md`): items
(gap 8: icon 14 + text xs `text-secondary`). **Footer** (gap 8): [Checkbox 14 + "Don't ask
again"] · Spacer · Cancel (Button/Ghost h 30) · Confirm (h 30, padding [0, 14], `accent` for
Detach, `danger` with `#FFFFFF` label for destructive).

| Confirm | Data source | Command |
|---|---|---|
| Detach Card · Pro? | override counts from `origin().overrides` | `detachInstance` |
| Turn off slot on Actions? | `planSetSlot(…, null)` → `IN_USE` + notes | `setSlot(null, deleteContent)` |
| Unlink the Icons library? | `libraryUsage(doc, alias)` | `unlinkLibrary` (needs cached library) |

## 5. Panels, popovers, menus (boards 11–15)

All menus reuse MenuDense (`G7A3Aj`: column, gap 1, padding 4, `bg-overlay`, stroke `border`,
`r-lg`; items 28 tall, gap 8, padding [0, 8], `r-sm`, Check Slot 14 icon, label sm, Meta xs
`text-tertiary`). All popovers reuse Popover (`xvOvm`: header 40 with title sm 600 and Close).

**Right panel — selection header** (board 11 `Rke3I`, board 12 `ExZmA`): row, gap 8, padding
[8, 12, 12, 12], stroke `border`: icon 14 `component` (`diamond` instance / `component` main) ·
Name sans base 600 · Spacer · **Kind** pill (padding [2, 8], `component-soft`, label xs 500
`component`: "Instance" / "Component"; derived `flb9q`: `bg-muted` + `text-secondary`
"Derived").

**Instance section** (board 11 `GKEMZ`, PropSection `fWrGA`; header action `ellipsis` → Instance
Menu): **Component Row** (gap 6): Component Chip (row, gap 6, padding [0, 8], fill × 28,
`component-soft`, `r-sm`: `component` 12 · name sm 500 · Spacer · Source xs `text-tertiary`
"local" / alias) + **Go to main** 28 × 28 `bg-subtle` `r-sm` (`arrow-up-right` 14). **Actions
Row** (gap 6): three pills Swap (`repeat`) / Detach (`unlink`) / Reset (`rotate-ccw`) — fill
`bg-muted`, stroke `border-strong`, h 28, gap 5, icon 13, label sm 500. **Overrides Summary**
(row, gap 6, padding [0, 8], fill × 28, `bg-subtle`, `r-sm`): OverrideDot · "props 1 · args 2 ·
overrides 2" xs `text-secondary` · Spacer · `chevron-right` 12 → Overrides Popover.

**Properties section** (board 11 `EituC`; header action `settings-2`): InstancePropRows in
`declaredProps` order.

**Theme section** (boards 11/13/14 `kMHeh`/`MwLsT`/`nLE5p`; header `plus` pins another axis):
ThemePinRows + **Effective** (row, gap 6, padding [6, 8], `bg-subtle`, `r-sm`: `git-merge` 12 +
10 px `text-secondary` "effective  mode=dark · density=comfortable · ui:mode=light", from
`ExpandedView.theme(id)`).

**Component section** (board 12 `SZCqE`; header `ellipsis`): **Name** (PropField: "Name" +
value = node `name`) · **Description** (`nRw8k`: label row "Description" xs 600 + key
`kimo.component.description` xs `text-tertiary`; box padding [7, 8] `bg-subtle` sm
`text-secondary`) → `setComponentDescription` · **Props Header** (h 28: "Props" xs 600 ·
count · Spacer · **Add prop** 24 `accent-soft` `r-md` `plus` 14 `accent-text` → Add prop Menu)
· **Props List** (PropDefRows). Derived (`XJ8Uy`): Derived Row (`component-soft` h 28:
`diamond` · "Instance of" xs · base sm 500 · Spacer · `arrow-up-right`) instead of Name, count
"5 · 4 inherited · 1 redeclared".

**Slot section** (board 12 `noppX`): header "Slot" + Toggle (`setSlot`) · Help xs · **Expose
Row** ("Expose as prop" · prop name xs `text-tertiary` · Toggle → `declareProp(type slot)` /
`removeProp`) · **Suggested Header** ("Suggested" + count) · Suggested List (AssetRow-like rows,
padding [0, 4, 0, 8], Remove 20 `x` 12) · **Add suggestion** (Button/Ghost `plus`).

**Assets tab** (board 13 `E7P7N`): Search + View Segmented (`hx0Wg`: `layout-grid` / `list`);
PanelHeader "Local components" (action `chevrons-down-up`); groups from name segments before
the last "/" (`e2rfIo`: `chevron-down` · `folder` 14 · path sm `text-secondary` · count); tile
grid (gap 8, two columns); Divider; PanelHeader "Libraries"; library rows (`dSpOF`: disclosure
· `library` 14 · name sm · alias xs `text-tertiary` · Spacer · count or compact StatusPill;
missing: icon `danger`, name `text-tertiary`); AssetRows indented; **Link library…**
(Button/Secondary fill, `link-2`). Missing banner (board 15 `nSzYt`: `danger-soft`, `r-md`,
`unlink` + title + desc + "Locate…" / "Unlink").

**Variables tab** (board 14 `A49BBi`): **Preview Theme** (`zGMmt`: `eye` 12 + pill "preview" 10
+ "light · comfortable" xs 500 + `chevron-down` 10 — editor state, not in the file) · groups by
`group` first segment (`pA5k7`) · VariableListRows · **Open variables** (pill `table-2`).

**Variables dialog** (board 14 `EIkIk`, ⌥⇧⌘V): 1040 × 780, `bg-app`, `r-2xl`. Header (padding
[20, 20, 16, 24]: title xl 500 "Variables", desc base `text-secondary`, Close 32 pill
`bg-muted`). Body row: **Sidebar** (184, column, gap 1, padding [4, 8, 12, 8], `bg-subtle`,
stroke `border`): sections Groups (All + one per group, `folder` 14) / Theme axes (`sun-moon`,
`rows-3`, + "Add axis") / Libraries (`lock` 14, count, "missing" `danger`). **Main**: Toolbar
(padding [12, 16]: Search 220 × 30, Type Filter segmented All/Color/Number/String/Boolean,
Spacer, "New variable" accent pill → New variable Menu) · Table (Axis Row h 24 with
AxisGroupHeaders over a 216 pad; Column Row h 32: "Name" header 216 + ModeColumnHeaders;
VariableRows; open entries) · Footer (`info` · "Last matching entry wins · — means no entry
for that axis (falls back)" · "Export DTCG" (`braces`) · "Done").

| Menu / popover | Node | Items → command |
|---|---|---|
| Instance Menu | board 11 `GK5mh` (240) | Go to main component ⌥⏎ (`arrow-up-right`) · Select all instances "12" (`scan`) · — · Create derived component ⌥⌘K (`component`) → `createComponent([instance])` · Swap instance… (`repeat`) · — · Reset all overrides (`rotate-ccw`) → `resetAllOverrides` · Detach instance ⌥⌘B (`unlink`) |
| Instance Child Menu | board 11 `aDExV` (260) | label "Title · in Card · Pro" · Replace with component… (`replace`) → `setOverride(replace)` · Replace with selection (`copy-plus`) · Hide layer ⌫ (`eye-off`) → `hideInInstance` · — · Reset overrides on Title → `resetOverride` · "Delete — not in instances" (`trash-2`, disabled `text-tertiary`) |
| Overrides Popover | board 11 `P7Nxi` (320) | rows (gap 8, padding [0, 4, 0, 8], h 28): Kind Tag (52; `bg-muted` `r-xs` xs "props"/"args"/"slot"/"replace") · Path xs · Spacer · Value xs `text-tertiary` · Reset 24 `rotate-ccw` 12; footer hint "Reset removes one entry; the main's value shows again." + "Reset all" |
| Add prop Menu | board 12 `lJC2O` (200) | label "Add prop" · Text T (`type`) · Boolean B (`toggle-left`) · Enum E (`list`) · Instance swap I (`diamond`) · — · "Slot — mark a frame" (`square-dashed`, `text-tertiary`) |
| Swap Popover | board 13 `jFlfP` (296) | Search 30; groups "This file" / "<Library> · ui"; AssetRow-like rows (selected `bg-hover` + `check`); footer `info` "Overrides carry over to layers with matching ids." → `swapInstance` (notes list dropped overrides before confirming) |
| Library Manager | board 13 `KBZKl` (600) | intro; LibraryRows; footer `info` "Stored in imports · paths are relative to this file" + accent "Link library…" (`link-2`) → `linkLibrary` |
| Library Changes | board 13 `MuCtC` (400) | back `arrow-left` + title + "changed since last open"; summary (StatusPill + "mkt · 3 changes" + explanation); change rows (h 32: glyph · name · tag modified/added/removed · Spacer · usage); warning box (`warning-soft`, `triangle-alert`); footer "Fix broken overrides" (`wrench`) + "Got it" (`check`, accent). Diff = editor snapshot vs re-read library (not stored in `.kimo`) |
| New variable Menu | board 14 `BCCLC` (200) | Color C (`palette`) · Number N (`hash`) · String S (`type`) · Boolean B (`toggle-left`) · — · Group… (`folder-plus`) · Theme axis… (`sun-moon`) |
| Row Menu | board 14 `b5mwNG` (220) | Edit details… (`pencil`) · Show entries "4" (`list-ordered`) · Move to group… (`folder-input`) · — · Duplicate (`copy`) · Delete (`trash-2`, label `danger`) |
| Column Menu | board 14 `k0fJT7` (220) | Make default (moves first) (`arrow-left-to-line`) → `moveAxisValue(…, 0)` · Rename value (`pencil`) · Duplicate value (`copy`) · — · Delete value (`trash-2`, `danger`) |
| Alias Picker | board 14 `pP5bp` (268) | title "Alias · light"; search; groups "local" / "ui · library"; rows (h 28: Swatch 18 · name xs · Spacer · per-mode chips 10 × 10 `r` 3 · `check`); actions "Detach alias · keep 2A1E14" (`unlink`) → `detachAlias`, "Custom value (OKLCH / P3)…" (`pipette`) |
| Variable Details | board 14 `zy2oU` (320) | Name · Group (DTCG path) · Description · Type (TypeGlyph + name, read-only) → `renameVariable` / `updateVariable` |
| Color Popover · OKLCH | board 14 `q6dI19` | M2 ColorPicker + **Value Row** (Format select 76 "OKLCH"/"P3"/"Hex", value field mono "0.70 0.17 45", Opacity 52) + **Gamut Row** (select 112 "Gamut · P3" + **Gamut Flag**: `warning-soft` pill, `triangle-alert` 10 + "outside sRGB" 10 500 `warning`). Values stay in their space (`{space:"oklch"…}`) |

Groups: "Group…" names a group for the next variable; groups are not stored on their own
(a group exists while a variable's `group` names it).

## 6. Canvas states (DOM + renderer)

| State | Nodes | Who |
|---|---|---|
| Selected instance | board 11 `B70Th` label, `Q4JWk` outline 1.5, handles `pjCl0`…, badge `h7Uden` fill `component` | renderer (`selectionTone: "component"`) + host label |
| Selected main + slot | board 12 `ZpNto`: `cHDIO`, `f8MrUb` dashed slot outline, `LQoWJ` SlotBadge, `g9pFd` quick insert, `F4JHL` size badge | renderer + host |
| Created component | board 12 `VexIX`: toast `frWtC` (`component` icon `text-inverse`, "Created component Card/Pricing", action "Undo"), 12 above the toolbar, 4 s | shell |
| Drag from Assets | board 13 `A3eub` drop hint (`selection`, `corner-down-right`), `kVsm2` ghost, `X93P1` `hand-grab` cursor | host |
| Drop into slot | board 13 `mFePH`: slot outline, insertion bar `GMebs`, drag chip `oz00b` (`bg-overlay`, stroke `component`, shadow y 8 blur 24, padding [4, 10, 4, 8], gap 6), drop hint `CTfcw` (`component`) | renderer (`instanceDrop`) + host |
| Drop replaces | board 13 `M1JBA`: replace target `d8kP2n`, hint `orZ62` (`replace` icon) | renderer + host |
| Rejected edit | board 15 `Ua40l`: `BXJRr` Toast/Danger "Can't delete Features inside an instance — hidden instead" + "Undo" | shell |
