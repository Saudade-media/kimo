# 0011. M3 components, instances, variables and libraries: format additions, expansion and contracts

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** maintainers (M3 contracts)
- **Teardown refs:** 12 (M3 row: components, instances, override kinds `set`/`slot`/`replace`,
  declared props, slots, detach; variables, multi-axis themes, resolver per 10.4; OKLCH/P3;
  libraries via `imports` as read-only links; variables panel), 10.3–10.4, 9.1 (dependency
  rules), 9.3 (op layer); builds on [0009](0009-m1-render-pipeline.md) and
  [0010](0010-m2-styling-and-tools.md)
- **Design:** `desing.pen` boards 02c (`SD9TU`), 11 (`Yf2Ax`), 12 (`M3150`), 13 (`XoUIl`),
  14 (`JlaLY`), 15 (`qJRq1`)

## Context

M3 makes components and tokens editable: the instance inspector and its menus (board 11), the
main component's prop API and slots (board 12), assets, swap and libraries (board 13), the
variables dialog and theme pins (board 14) and the refusal / confirm states (board 15).
Format 0.1 already defined components, instances, the three override kinds, declared props,
slots, derived components, variables with themed entries, multi-axis themes and imports, and
`@kimo/core-schema` validated all of it. What was missing was everything *between* the file and
the UI: one expansion of instances that layout, renderer, hit testing and the layers panel
share; a way to edit components and tokens that stays one validated, invertible transaction per
gesture; and a few things the designs show that the format could not express.

### Audit: every M3 control → format

| Control (board) | Format 0.1 |
|---|---|
| Props / args / overrides stores, per-entry reset, summary "props 1 · args 2 · overrides 2" (11) | `props`, `args`, `overrides` (§9.2–9.3) |
| Replace with component / selection, hide layer, delete → hide (11, 15) | `{ replace: true }` + one `at` node; `set: { visible: false }` |
| Swap instance, nested swap, Instance swap prop (11, 13) | `of`; `set: { of }`; instance prop `args` |
| Create derived component, "from <base>", inherited / redeclared props (11, 12) | instance with `component` (§9.1, §9.6) |
| Text / Boolean / Enum (option → value) / Instance / Slot props (12) | PropDef `text` / `boolean` / `enum.options` / `instance` / `slot` |
| Enum targeting the root ("Root · pad", 12) | **missing**: targets resolved among descendants only |
| Props list in declaration order, drag reorder (12) | **missing**: `component.props` is a record, sorted canonically |
| Component description (12) | **missing** → node meta `kimo.component.description` |
| Slot toggle, suggestions, expose as prop, quick insert, drop into slot (12, 13) | `slot: { suggested }`, slot PropDef, `{ slot: true }` + `at` nodes |
| Theme pins on frames and instances, Inherit, library axes (11, 13, 14) | `theme` (placement field, so instances too), `alias:axis` |
| Grid cells, multi-axis entries, fallback, list order, aliases, OKLCH/P3 (14) | themed `value` arrays, `when`, `{ $ref }`, OKLCH / Display-P3 colors (§10) |
| Variable group (DTCG path), description, type (14) | `group`, `description`, `type` |
| Axis default "moves first", rename / duplicate / delete value (14) | `themes` arrays (first = default) |
| Axis display order (mode before density, 14) | **missing**: `themes` is a record, sorted canonically |
| Link / Locate… / Unlink, alias tags (13, 15) | `imports` alias → relative path |
| Library display name, counts, "Changed since last open" (13) | library `meta.name`; counts derived; the diff is an editor cache, **not** in the file |

## Decision

### 1. Format (additive, still `0.1.0`; spec §9.6–9.8, §20 row 26)

- **PropDef `order`** (Order key, optional): display order of declared props = (`order`, then
  name). Editors write it on every declaration; a redeclaration without `order` keeps the base's.
- **Root prop targets:** a declared prop's `target` may be the declaring component's own id,
  naming the (base) root; its `args` apply at the root with `args` precedence. Override keys and
  `at` still may not name the root (`OVERRIDE_PATH_UNRESOLVED`; the root takes `props`).
  The validator accepts it; fixture `valid/components-m3.kimo`, invalid
  `OVERRIDE_PATH_UNRESOLVED--override-key-is-root.kimo`.
- **Kimo meta keys:** node `meta["kimo.component.description"]` (string); root
  `meta["kimo.themes.order"]` (string[]; axes not listed follow by name). No schema change: both
  are namespaced meta keys the `kimo` namespace owns.
- **Expansion rules (§9.8)** made normative: composite ids `<instance>/<IdPath>`; the expanded
  root's theme = component root pins (base first, then derived) overwritten by the instance's
  pins; library content is read in the consumer's namespace (bindings, pin keys, `of`,
  `slot.suggested` get the alias); the theme of expanded nodes follows the expanded placement path.
- Kept limit: one override per path, so an instance cannot both restyle a slot frame and fill it.
  No M3 design needs it; a later minor can allow `{ set, slot }` together.

### 2. One instance expansion (`@kimo/core-schema` `src/expand.ts`)

`createExpandedView(base: NodeLookup, { libraries, header, onIssue }) → ExpandedView` is the
single implementation for layout, renderer, hit testing, the layers panel and the planners:

- `getNode(id)` / `children(parent, at?)` over real and composite ids (a `DocStore` is a
  `NodeLookup`); lazy, cached until `invalidate()`;
- `origin(id)`: provenance — `virtual`, `top` instance, `path` (the override key),
  `source` node, applied `overrides` with their layer (`derived`/`props`/`args`/`overrides`),
  holder and fields; `instance` info (`of`, derived `chain`, `resolved`); `owned` (slot /
  replace content); `slot` (overridden, empty);
- `locate(id)` (reverse mapping: composite id → `{ real, instance, path }`), `theme(id)`,
  `issues(id?)` (`COMPONENT_MISSING`, `NOT_A_COMPONENT`, `ALIAS_UNKNOWN`,
  `LIBRARY_NOT_LOADED`, `INSTANCE_CYCLE`, `OVERRIDE_PATH_UNRESOLVED` for top-level keys and
  args that matched nothing — board 15's "1 override no longer resolves").

Ids, precedence and slot/replace behaviour equal `@kimo/layout`'s M1 `expandInstances`, which it
replaces (tests in `core-schema/test/expand.test.ts` mirror `layout/test/instances.test.ts`).
Two fixes over it: library-declared prop targets and library bindings are namespaced, and an
owned node asked for before its instance still reads with its expanded parent. Component
helpers are public (`locate`, `derivedChain`, `baseRoot`, `resolveIdPath` with `allowRoot`,
`declaredProps` in display order, `argEffect`, `instancesOf`, `localComponents`).

### 3. Edits: planners + commands, no new op kinds

`@kimo/core-schema` `src/edit/*` holds pure **planners** (`plan*`) that turn one gesture into an
ordered list of ops structurally identical to `@kimo/editor-state`'s `Op` (insert / update /
move / delete / setVariables / setThemes / setHeader), plus notes and a `select` hint, or a
refusal (`PlanError` codes → board 15 toasts). `@kimo/editor-state` adds an **`M3Command`**
union, `planCommand(doc, cmd, ctx)` and `applyCommand(store, cmd, { origin, label, libraries })`
which applies the plan with ONE `store.apply`: validated by the store, one transaction with the
origin, one undo step, inverse in the op log. The CRDT, undo, sync and op log are untouched;
`HEADER_OP_KEYS` gains `imports`, `components` and `meta`.

| Gesture | Command (planner) |
|---|---|
| Create component (⌥⌘K): in place; several siblings wrapped; instance → derived | `createComponent` |
| Insert instance (Assets, quick insert, drop into slot) | `createInstance` (adds `{ slot: true }` for `at`) |
| Detach (⌥⌘B): one level; owned nodes **moved** (ids kept); nested instances keep the outer overrides of their paths; library content namespaced; new root id in `select` | `detachInstance` |
| Override per path and kind; reset per entry / fields; reset all; delete → hide | `setOverride`, `resetOverride`, `resetAllOverrides`, `hideInInstance` |
| Args; swap (keeps what resolves, notes the rest) | `setArgs`, `swapInstance` |
| Declare / update (rename moves instance args) / remove / reorder props | `declareProp`, `updateProp`, `removeProp`, `reorderProp` |
| Slot on/off/suggestions (off deletes instance content only with consent: `IN_USE` first) | `setSlot` |
| Description | `setComponentDescription` |
| Variables: create, update (value/type/group/description), whole value (entries), grid cell, rename (bindings follow), duplicate, delete (`IN_USE` unless `detach`: bindings become literals), detach alias; alias cycles refused (`CYCLE`) | `createVariable` … `detachAlias` |
| Axes: create, rename, delete (pins removed; default-value entries broadened, others removed), add / move ("make default") / rename / duplicate / remove value (`force` for pinned) | `createAxis` … `removeAxisValue` |
| Theme pin / Inherit (real nodes; inside instances via `setOverride` `set.theme`) | `setThemePin` |
| Link / Locate… / Unlink (detaches every library instance, literalizes bindings, drops library pins, `when` keys and suggestions; needs the library or the editor's cached copy) | `linkLibrary`, `relinkLibrary`, `unlinkLibrary` |

### 4. Layout / renderer / canvas contracts

- **Layout** (`types.ts`): `LayoutInput.expanded?: ExpandedView` — the host's shared view; the
  engine reads instances through it (else builds its own `createExpandedView`). Issue
  `INSTANCE_UNRESOLVED` (placeholder sized by `props.w/h`, else `INSTANCE_PLACEHOLDER_SIZE`
  100 × 100); `of`/`props`/`args`/`overrides` join `LAYOUT_KEYS`; resolvers take themes from
  `ExpandedView.theme`.
- **Renderer** (`types.ts`): `Overlay.selectionTone` (`component` tone for mains/instances),
  `Overlay.componentOutlines` (main 1.5, instance 1, slot dashed 4/3 + soft fill when empty),
  `Overlay.instanceDrop` (insertion bar / replace target), `OverlayTheme.component` /
  `componentSoft`, `OVERLAY_SPEC_M3` (exact board numbers, DOM offsets for labels, badge, quick
  insert).
- **Canvas** (`apps/web/src/canvas/contract.ts`): `EditTarget` + `RouteEdit` (composite ids in
  the selection route edits to overrides), `InstanceHitPolicy` (click = top instance,
  double/⌘-click = deepest composite id), `ComponentDrag`, `ComponentDropTarget` +
  `ResolveComponentDrop` (board 13 rules), `ComponentDomOverlay` (CanvasLabel, SlotBadge,
  SlotQuickInsert, positioned per `OVERLAY_SPEC_M3.dom`), `CanvasError.kind "command"`,
  `CanvasNotice`, `M3_TOAST_COPY`, `CanvasHostProps.libraries/onNotice/onComponentContext`,
  optional `CanvasHandle.expanded/runCommand/armComponentDrag/goToMain`. The toolbar Component
  button gets `action: "createComponent"` (enabled when the host implements it).
- **UI** (`packages/ui/src/m3-contract.md`): every M3 component, section, popover, menu, confirm
  and canvas state with its node id and props.

### 5. Libraries

Libraries are re-read from disk every time the consumer opens; there is no pinned version.
"Changed since last open" compares against a local snapshot the editor caches (outside the
`.kimo`); the same cache lets Unlink detach instances of a library that went missing; without
it (fresh clone) unlink refuses with "locate the file instead".

## Consequences

- One expansion means the canvas, layers panel, hit testing and planners can never disagree on
  ids or precedence; layout's `expandInstances` is retired by the layout builder.
- Every M3 gesture is one undo step and is validated by the same rules as file loading; the
  planners are pure and headless-testable (core-schema tests apply each plan and validate).
- `applyCommand` copies the document (`store.toDocument()`, O(n)) per gesture — fine for
  clicks, not for drags; continuous gestures (dragging a prop row) commit once at the end.
- Planners never run on library documents: library content is read-only (`LIBRARY_READ_ONLY`).
- `@kimo/design-tokens` must add `component` / `component-soft` (ADR 0007 amendment).

## Alternatives considered

- **New op kinds (`setOverride`, `detach`, …) in the store:** every op kind needs draft
  application, inverses, Yjs mapping and replay; compiling to the existing ops gets the same
  atomicity and undo for free and keeps sync providers unchanged.
- **Keep expansion in `@kimo/layout`:** the editor and planners would depend on layout for a
  format concern (teardown 9.1 puts format rules in core-schema) and provenance would be
  re-derived in three places.
- **A `components` folder field / asset groups:** groups come from name segments ("Card/Pricing"
  → Card) as the design states; no format field.
- **Prop order as an array on `ComponentDef`:** concurrent reorders would conflict on one line
  value; per-declaration fractional keys merge like node order.

## Revisit when

An instance needs both a restyled and a filled slot (allow `{ set, slot }`), libraries import
libraries (namespacing beyond one level), or library versions are pinned (then the change review
becomes a format concern).

## Amendments (M3 QA)

- **Cycles through swaps and instance props.** `wouldCycle` (planners) and the validator's
  `INSTANCE_CYCLE` treat a nested `set.of` swap and an instance-prop arg as placing the named
  component inside every component holding the target (the instance's component chain and the
  component of each instance the path crosses), matching the expansion's cycle guard. Refusal:
  `CYCLE` (board 15 toast).
- **Swap-aware paths.** `resolveIdPath(..., { swaps })` and `instanceSwaps()` resolve override
  keys through swapped nested instances (spec §9.8). A nested swap (or an instance-prop arg)
  drops the deep overrides that no longer resolve, with `OVERRIDE_DROPPED` notes; detach skips
  them. The validator reports stale deep keys as `OVERRIDE_PATH_UNRESOLVED`.
- **Library components are read-only in every planner**: prop, slot and description edits on
  an `alias:id` refuse with `LIBRARY_READ_ONLY`.
- **Expansion**: an outer `slot`/`replace` wins over the nested instance's own kind on a deep
  path; an expansion past `MAX_EXPANDED_NODES` (50 000) stops with `INSTANCE_TOO_LARGE`.
- **CRDT shape**: `overrides`, `args`, `props` of instances and the `imports` header member are
  nested Y.Maps (per-key last-writer-wins; an empty map reads as an absent field). Concurrent
  alias edits may still merge into `VARIABLE_CYCLE` (spec §18); the repair UI needs design.
- **Two expanded views, on purpose.** The canvas keeps its own `InstanceView` (per-instance
  invalidation driven by the layout engine's dependency index, flushed once per frame); the
  panels and planners read `M3Controller`'s `createExpandedView`, invalidated synchronously on
  every store change (and only fully on `imports` changes or a load). Sharing one view would
  make panels read expansions the canvas has not flushed yet; the cost is a second expansion of
  what the panels look at (lazy, per instance).
- `DocStore.toHeader()` reads the root members without copying the node table (header hub,
  canvas resolver header).

