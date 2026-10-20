# The `.kimo` File Format — 1.0

| | |
|---|---|
| **Status** | **Stable** (format version `1.0.0`, frozen 2026-10). Backward compatible within 1.x (§16.4). Supersedes the draft [v0.1](kimo-format-v0.1.md), kept as a historical record; 0.1 files open through the `0.1 → 1.0` migration (§16.2). |
| **Schema** | `https://getkimo.design/schema/kimo-1.0.json` (JSON Schema draft 2020-12), generated into `packages/core-schema/schema/kimo-1.0.schema.json`. The 0.1 schema stays published at `…/kimo-0.1.json` (`schema/kimo-0.1.schema.json`, frozen). **Erratum (2026-10):** the website moved from kimo.design to getkimo.design. The legacy form `https://kimo.design/schema/kimo-<major>.<minor>.json` is an alias of the getkimo.design URL: readers and validators MUST accept it as equivalent, with no warning, and writers keep a document's existing `$schema` as it is. |
| **Reference implementation** | `@kimo/core-schema` (`packages/core-schema`). Where this document and the implementation disagree, that is a bug in one of them; file an issue. |
| **Plan of record** | `docs/teardown.md` §10. Every place where this spec resolves an ambiguity in, or deviates from, that section is listed in §20. |
| **License** | MIT |

## 1. Introduction and conformance

A `.kimo` file is a plain UTF-8 JSON document describing a design: a flat table of nodes (frames, shapes, text, component instances, …), design variables with multi-axis themes, imported libraries and content-addressed assets. It is designed to be diffable and mergeable with plain git, editable by agents through tools, and convertible to code deterministically.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY** and **OPTIONAL** are to be interpreted as described in RFC 2119 and RFC 8174 when, and only when, they appear in all capitals.

Conformance classes:

- A **writer** produces `.kimo` files. A conforming writer MUST produce the canonical serialization (§15) of a document that is valid (§17).
- A **reader** consumes `.kimo` files. A conforming reader MUST accept every valid document of a format version it supports, MUST apply the defaults (§14) and resolution rules (§9, §10), and MUST follow the forward-compatibility rules (§16.3).
- A **validator** reports the issues of §17.

Terms: *node* — an entry of the `nodes` table; *component* — a node whose `component` is truthy; *instance* — a node of type `instance`; *binding* — a `{ "$ref": … }` object standing for a variable's value; *record* — a JSON object whose keys are data (ids, names, axis names) rather than property names; *struct* — a JSON object whose keys are property names defined by this spec.

## 2. Container

1. The canonical working form is **one UTF-8 `.kimo` JSON file** plus an `assets/` folder next to it. Files MUST NOT be encrypted or compressed.
2. Writers MUST NOT emit a byte-order mark and MUST use LF line endings. Readers MUST ignore a leading BOM and MUST accept CRLF (it is JSON whitespace).
3. A library is an ordinary `.kimo` document with `meta.library: true`; its file name SHOULD end in `.lib.kimo`.
4. `.kimoz` is a ZIP used only for transport ("Export as package"): it holds the `.kimo`, its `assets/` and imported libraries. It is never the working form.
5. Every relative path in a document (imports, assets, shaders, scripts) resolves against the directory of the `.kimo` file.

## 3. Value types

| Name | Grammar / shape | Notes |
|---|---|---|
| **Id** | `^[A-Za-z0-9]{6,24}$` | Node id; never contains `/` or `:`. Unique per document (it is the key in `nodes`). Kimo generates 10-character base62 ids. Importers keep matching ids and re-key others. |
| **Alias** | `^[A-Za-z][A-Za-z0-9_-]{0,31}$` | Import alias (§11). |
| **QId** | `Id` or `alias:Id` | A local node, or a node of the library imported as `alias`. |
| **IdPath** | QIds joined by `/` | One segment per instance boundary (§9.5). Override keys are id paths only, never names. |
| **Name** | `^[^\s:$][^\s:]{0,127}$` | Variable and theme-axis names: no whitespace, no `:` (reserved for library namespaces), not starting with `$`. `/` and `.` are allowed (`text/default`, `color.surface`). |
| **Axis key** | `Name` or `alias:Name` | Key of a theme pin or of a `when` condition. |
| **Order key** | `^[0-9A-Za-z]{1,64}$` | Fractional index. Writers SHOULD generate keys with random jitter so concurrent inserts rarely collide. |
| **Ref** (binding) | `{ "$ref": "name" }` or `{ "$ref": "alias:name" }` | Exactly one member. A binding is the only way to reference a variable: a plain string is always literal (`"$49/mo"` is text). |
| **Num** | number or Ref | |
| **Hex color** | `^#([0-9A-Fa-f]{3}\|[0-9A-Fa-f]{6}\|[0-9A-Fa-f]{8})$` | sRGB `#RGB`, `#RRGGBB`, `#RRGGBBAA`. `#RGBA` is not allowed. |
| **OKLCH color** | `{ "space": "oklch", "l": 0–1, "c": ≥0, "h": [0,360), "alpha"?: 0–1 }` | `alpha` defaults to 1. |
| **Display-P3 color** | `{ "space": "display-p3", "r": 0–1, "g": 0–1, "b": 0–1, "alpha"?: 0–1 }` | `alpha` defaults to 1. |
| **Color** | hex, OKLCH, Display-P3, or Ref | |
| **BlendMode** | `normal`, `darken`, `multiply`, `color-burn`, `linear-burn`, `lighten`, `screen`, `color-dodge`, `linear-dodge`, `overlay`, `soft-light`, `hard-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity` | Paints and shadows. Editor labels: `linear-burn` is "Plus darker", `linear-dodge` is "Plus lighter". |
| **LayerBlendMode** | BlendMode or `pass-through` | Node `blend` (§5.3). |
| **Relative path** | `^\.{1,2}/(?:[^\\/\s]+/)*[^\\/\s]+$` | `./x` or `../x`; no scheme, no absolute path, no backslash. |
| **Asset reference** | `^\./assets/[0-9a-f]{16}\.[a-z0-9]{1,8}$` | First 16 lowercase hex digits of the file's SHA-256, plus extension. |
| **Meta key** | `^[a-z][a-z0-9-]*(\.[A-Za-z0-9_-]+)+$` | Namespaced extension key, e.g. `kimo.export.tag`. |
| **Prop name** | `^[A-Za-z_][A-Za-z0-9_]{0,63}$` | Declared component property (usable as a React prop). |

Numbers MUST be finite. Colors are specified in their own space; renderers and exporters map them deterministically, gamut-mapping out-of-gamut values with the CSS Color 4 algorithm, and CSS emitters SHOULD write the original `oklch()` / `color(display-p3 …)` value.

## 4. Document root

| Member | Required | Type | Meaning |
|---|---|---|---|
| `$schema` | yes | string | `https://getkimo.design/schema/kimo-<major>.<minor>.json` for the document's format. For 1.0: `https://getkimo.design/schema/kimo-1.0.json`. |
| `format` | yes | `major.minor.patch` | Format version (§16). This spec defines `1.0.x`. |
| `features` | no | string[] (unique) | Feature flags used by the document (§13). Writers MUST list every feature they use and MUST sort the list by code unit. |
| `meta` | no | struct | `name` (string), `library` (boolean: this is a library), `createdWith` (string), plus namespaced keys (Meta key grammar) with any JSON value. Kimo-owned root keys: `kimo.themes.order` (string[]: display order of theme axes; axes not listed follow by name). |
| `themes` | no | record axis → string[] | Theme axes. Each list is non-empty with unique values; **the first value is the axis default**. |
| `imports` | no | record alias → relative path | Imported libraries (§11). |
| `variables` | no | record Name → Variable | §10. |
| `assets` | no | record asset file name → AssetEntry | Optional asset manifest (§12). |
| `components` | no | Id[] (unique) | Optional index of component node ids. Derived data; when present every entry MUST be a component. |
| `pages` | no | record Id → Page | The document's pages (§5.6). Absent or empty = one implicit page. |
| `merge` | no | struct MergeInfo | Labels of an in-progress semantic merge (§21). Only with `conflicts`. Feature `merge/conflicts`. |
| `conflicts` | no | record Id → Conflict (non-empty) | Stored merge conflicts written by `kimo merge` (§21). Feature `merge/conflicts`. |
| `nodes` | yes | record Id → Node | The flat node table (§5). |

No other members are defined in 1.0. A 1.0 validator reports any other member as `UNKNOWN_PROPERTY`; every reader MUST nevertheless preserve it (§16.3).

The published JSON Schema accepts any `$schema` of the form `https://getkimo.design/schema/kimo-<major>.<minor>.json` (or the legacy `https://kimo.design/...` alias); that the URL names the document's own format version is checked by validators only (`SCHEMA_URL_MISMATCH`, a warning), so JSON Schema tooling and `validate()` agree.

## 5. Nodes

### 5.1 Tree model

The document is a forest stored as a flat table. Each node names its parent; readers rebuild children lists.

1. `parent` is a node id or `null` (a root node). It is always an id in `nodes`, never a path.
2. Only `frame` and `group` nodes have children, plus instances through `at` (§9.4). A node whose parent has another type is invalid.
3. **Sibling order is normatively (`order`, then id), both compared by UTF-16 code unit** (not locale-aware). Siblings are the nodes with the same `parent` and the same `at` (absent counts as its own group). Equal `order` keys are legal (they arise from concurrent inserts) and are linted.
4. Parent links MUST NOT form a cycle. When a cycle appears only after a CRDT or git merge, the editor repairs it: the node whose move has the later timestamp (ties: larger id) is reparented to its previous parent, or to the root if that is also in the cycle.
5. Children paint in sibling order: later siblings on top.

### 5.2 Placement fields (every node, including instances)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `type` | node type | — (required) | One of §5.5. |
| `parent` | Id \| null | — (required) | §5.1. |
| `at` | IdPath | absent | Only when `parent` is an instance: the descendant of that instance this node attaches to (§9.4). |
| `order` | Order key | — (required) | §5.1. |
| `name` | string | absent | Human-readable layer name. Never used for referencing. |
| `x`, `y` | number | absent = 0 | Position relative to the parent's top-left, y down. Ignored in a parent with `layout` unless `position` is `"absolute"`. Not part of the defaults table: an explicit `0` is kept (§14). |
| `position` | `"auto"` \| `"absolute"` | `"auto"` | `"absolute"` takes the node out of the parent's flex flow. |
| `theme` | record axis key → value | absent | Per-axis theme pins for this subtree (§10.3). |
| `locked` | boolean | `false` | Editor state: not selectable on canvas. |
| `meta` | record Meta key → any | absent | Namespaced extension data. Readers MUST preserve it and MUST NOT interpret keys of namespaces they do not own. Bindings inside `meta` are not bindings. |
| `page` | Id | absent | Root nodes only: the page the node is on (§5.6). Absent = the first page. Not allowed in instance `props` or `set` overrides. |

### 5.3 Base fields (every node except instances)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `rotation` | number | `0` | Degrees, counter-clockwise, around the node's top-left corner. |
| `opacity` | Num in [0,1] | `1` | |
| `visible` | boolean \| Ref | `true` | Hidden nodes take no space in layout. Also how a descendant is "removed" inside an instance (`set: {visible: false}`). |
| `flipX`, `flipY` | boolean | `false` | Mirror around the node's center. |
| `blend` | LayerBlendMode | `"normal"` | How the node (with its subtree) composites onto what is behind it. On a `frame` or `group`, every mode but `"pass-through"` composites the subtree as an isolated group first, then blends it with that mode; `"pass-through"` composites no group, so descendants blend directly with the backdrop (CSS: no `isolation`). On other node types `"pass-through"` means `"normal"`; writers SHOULD write `"normal"` there. The isolated group matters only when a descendant uses a non-`normal` blend, so exporters MAY omit `isolation: isolate` otherwise. |
| `component` | boolean \| ComponentDef | `false` | Makes the node a component; the object form declares a prop API (§9.6). |
| `placeholder` | `true` \| `{ by?: string, since?: string }` | absent | In-progress marker (e.g. an agent is working on it; `since` is an ISO 8601 timestamp). `by` is the editor-state origin of the owner (`agent:kimo.<session>.<n>`, `mcp:<client>.<session>`); an editor whose owner is not running shows the frame as *interrupted* (ADR 0014). Owners MUST clear the flag when their work ends; it never locks the node for people. |

### 5.4 Graphics fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `fill` | Paint \| Paint[] | absent = no fill (text: §8.3) | A list paints in order, last on top. `[]` means explicitly no paint. |
| `stroke` | Stroke | absent | §7.2. |
| `effects` | Effect[] \| Ref | absent | A Ref binds a `shadow` variable (feature `tokens/composite`). |

### 5.5 Node types

Required fields are marked **req**. Every type also has the Placement fields; every type but `instance` has the Base fields.

| `type` | Fields (besides Placement/Base) | Notes |
|---|---|---|
| `frame` | Graphics; `w`, `h`: Size, default `{mode:"fit"}`; `radius`: Radius, default 0; `clip`: boolean \| Ref, default `false`; `layout`: Layout (absent = no flex layout); `slot`: `{ suggested?: QId[] }` | Container. `slot` marks the frame as a slot of its component; `suggested` is advisory (slot content is not restricted to it), but every entry MUST name a component (`REF_MISSING`, `REF_NOT_COMPONENT`, `ALIAS_UNKNOWN`). |
| `group` | `effects` | Container without size, paint or layout; its bounds are its children's. |
| `rect` | Graphics; `w` **req**, `h` **req**: Size; `radius`: Radius, default 0 | Images are image paints on rects or frames; there is no image node. |
| `ellipse` | Graphics; `w` **req**, `h` **req**; `innerRadius`: [0,1), default 0 (ring hole as a fraction); `startAngle`: degrees CCW from the positive x axis, default 0; `sweepAngle`: [-360,360], default 360 | Arcs and rings. |
| `polygon` | Graphics; `w` **req**, `h` **req**; `sides` **req**: integer ≥ 3; `radius`: Num, default 0; `star`: `{ ratio?: (0,1] }`, `ratio` default 0.38 | Regular polygon inscribed in the box. With `star` it is a star with `sides` points: the outer vertices are the polygon's, and an inner vertex sits between each pair, on the same ellipse scaled by `ratio` (inner / outer radius). `radius` rounds every vertex. |
| `path` | Graphics; `w`, `h`: Size (absent = the `viewBox` size, else the geometry's bounds); `d` **req**: SVG path data; `fillRule`: `"nonzero"`\|`"evenodd"`, default `"nonzero"`; `viewBox`: `[x, y, w, h]` (absent = the geometry's bounding box) | The geometry is scaled from `viewBox` to `w`×`h`. Writers SHOULD set `viewBox`. |
| `text` | Graphics; `w`, `h`: Size; `content` **req**: string \| Ref \| TextSpan[]; `grow`: `"auto"`\|`"fixed-width"`\|`"fixed"`, default `"auto"`; `style`: TextStyle | §8. |
| `icon` | `w` **req**, `h` **req**; `set` **req**: string; `icon` **req**: string \| Ref (glyph name); `weight`: Num 100–700; `strokeWidth`: Num > 0; `color`: Color; `effects` | Known sets: `lucide`, `feather`, `phosphor`, `material-outlined`, `material-rounded`, `material-sharp`. Other values are allowed and render as a missing glyph. Icons are rendered as paths from the set, scaled from the set's grid to `w`×`h`. `weight` applies to Material sets (the `wght` axis; absent = 400) and to `phosphor` (nearest of thin 100, light 300, regular 400, bold 700; absent = regular); other sets ignore it. `strokeWidth` applies to stroke sets (`lucide`, `feather`) in the set's 24-unit grid units (absent = the set's own width, 2); other sets ignore it. |
| `note` | `w`, `h`: Size (absent = fit content); `content` **req**: string; `style`: TextStyle; `author`: string (display name) | Sticky note. Not part of the design: exporters (code, SVG, PNG/PDF of a parent) and Play skip notes and prompts. Agents read notes as context and MUST NOT edit a person's note. |
| `prompt` | as `note`, plus `model`: ModelRef \| string; `target`: Id | A runnable AI prompt on the canvas (ADR 0014). `model` is `{ provider, model }` (both non-empty strings); a bare string is the legacy form and MUST resolve to exactly one configured provider or the run fails (never a silent fallback). `target` names the frame a run is scoped to; absent, a run creates a new frame next to the prompt. A `target` that is not a frame of the document is linted (`PROMPT_TARGET_MISSING`). Run state (last run, cost) is app data, not stored in the file. |
| `script` | `w` **req**, `h` **req**; `src` **req**: relative path to a `.js` file; `inputs`: record name → any (literals or Refs); `clip`: boolean \| Ref, default `false` | **Feature `node/script`.** Generated children are derived state and are not stored. The script protocol is out of scope for 0.1. |
| `browser` | `w` **req**, `h` **req**; `url` **req**: string; `device`: string; `zoom`: > 0, default 1; `scrollX`, `scrollY`: default 0; `radius`, default 0; `stroke`; `effects` | **Feature `node/browser`.** A live web page on the canvas. |
| `instance` | `of` **req**: QId; `props`: struct; `args`: record; `overrides`: record IdPath → Override; `component`: boolean \| ComponentDef, default `false` | §9. Has no Base fields at its top level. |

Any other `type` is invalid in 1.0 (`UNKNOWN_NODE_TYPE`) and MUST be preserved by readers.

### 5.6 Pages

A document is split into **pages**: independent canvases that partition the root nodes. A page only groups roots; it is not a node and never appears in `parent`.

1. The root member `pages` maps a page id (Id grammar) to `{ "order": Order key, "name": string }`. Pages list by (`order`, then id), code-unit order, like siblings (§5.1). Names need not be unique. Page ids are their own namespace, but writers SHOULD NOT reuse a node id.
2. A root node (`parent: null`) is on the page its `page` names. A root without `page`, or whose `page` names no entry of `pages` (lint `PAGE_UNKNOWN`), is on the **first page**. So a document without `pages` (or with `pages: {}`) has exactly one implicit page holding every root; editors name it "Page 1".
3. Every other node is on its root's page. `page` on a non-root node is ignored (lint `PAGE_NOT_ROOT`); writers moving a root into a container SHOULD remove it, and writers moving a node to the root SHOULD set it.
4. Writers that add the first explicit page to a document SHOULD also give an explicit entry to the implicit page, so the existing roots stay on it whatever the new page's order. Deleting a page deletes its roots (or moves them first); readers never delete nodes because of `pages`.
5. Viewport, selection and the active page are editor state, not document data.
6. Exporters and tools that address "the canvas" address one page; whole-document operations (validation, variables, components, assets) span every page. A component on one page may be instantiated on any page.
7. Live sync merges `pages` per page id (like `imports`); git three-way merges merge it as a record (§21: a `header` conflict may address `pages`).

## 6. Sizing and layout

### 6.1 Size

A Size is one of:

- **a number ≥ 0 or a number binding** — a fixed size in px;
- **`{ "mode": "fit", "fallback"?: n, "min"?: n, "max"?: n }`** — size to the content. A frame fits its children (with layout: the flex content size; without: their bounding box). When there is nothing to fit (no children), `fallback` is used, else 0;
- **`{ "mode": "fill", "fallback"?: n, "weight"?: n, "min"?: n, "max"?: n }`** — take the space of a parent with `layout` along the relevant axis (main axis: shared by `weight`, default 1; cross axis: stretch). On the main axis the space left after the parent's padding, gaps and non-fill siblings is shared by weight **from a zero basis: the fill items' content size is ignored** (CSS `flex: <weight> 1 0`, as pen.dev and Figma; two `fill` texts in a row get equal widths whatever their length). The shares are **outer** sizes: padding (and `includeStroke` insets) does not add to a fill item's share, so a padded and an unpadded fill sibling end equal; padding larger than the share is a floor. This needs a definite main size: when the parent `fit`s that axis (a fill parent is definite only if its own parent is, along the same chain) or wraps (`layout.wrap`), the content size is the basis and only the free space beyond it is shared (CSS `flex: <weight> 1 auto`), so fill items do not collapse in a hug parent and lines still break (§20 row 34). When the parent has no layout or the node is `absolute`, `fallback` is used, else the content size.

`min` / `max` clamp the result and need feature **`size/min-max`**; fill items that violate them are frozen at the bound and the others share what is left (CSS "resolving flexible lengths"). Exporters map `fallback` to `min-width`/`min-height` or document it as ignored.

A frame whose size on an axis is `fit` and whose flowing children all `fill` that axis is circular (lint `FIT_ALL_FILL`); readers SHOULD resolve it by sizing those children as `fit` on that axis.

Text sizes follow `grow` (§8.1). An instance has no size fields; it takes its component root's size unless `props` overrides `w`/`h`.

### 6.2 Layout (frames)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `dir` | `"row"` \| `"column"` | — (required) | Main axis. |
| `gap` | Num | `0` | Space between children on the main axis (may be negative). |
| `crossGap` | Num | `0` | Space between wrapped lines. **Feature `layout/wrap`.** |
| `pad` | Num \| `[v, h]` \| `[t, r, b, l]` | `0` | Padding; entries are non-negative. |
| `justify` | `start` `center` `end` `between` `around` `evenly` | `"start"` | Main-axis distribution. |
| `align` | `start` `center` `end` `stretch` `baseline` | `"start"` | Cross-axis alignment. `stretch` and `baseline` need **feature `layout/stretch-baseline`**. |
| `wrap` | boolean | `false` | Wrap onto several lines. **Feature `layout/wrap`.** |
| `includeStroke` | boolean | `false` | Include the frame's stroke width in its padding box. |

Absent `layout` means children are placed by `x`/`y`. Children with `position: "absolute"` or `visible: false` do not take part in the flow. A property equal to its default never requires its feature (e.g. `wrap: false`).

### 6.3 Radius

`radius` is one Num ≥ 0 or `[topLeft, topRight, bottomRight, bottomLeft]`.

## 7. Paints, strokes and effects

### 7.1 Paint

A Paint is a **Color** (hex, OKLCH, P3 or Ref — a solid paint) or one of:

| `kind` | Fields | Defaults |
|---|---|---|
| `"solid"` | `color` **req**, `blend`, `visible` | `blend: "normal"`, `visible: true` |
| `"linear"` \| `"radial"` \| `"angular"` | `stops` **req**: ≥ 2 × `{ color, at ∈ [0,1] }`; `center`: [x, y] normalized; `size`: [w, h] normalized (for linear, `h` is the length); `rotation`: degrees CCW, 0 = up; `interpolation`: `"srgb"` \| `"oklab"`; `opacity`: Num [0,1]; `blend`; `visible` | `center [0.5,0.5]`, `size [1,1]`, `rotation 0`, `interpolation "srgb"`, `opacity 1`, `blend "normal"`, `visible true` |
| `"image"` | `src` **req**: asset reference; `fit`: `cover` `contain` `stretch` `tile` `crop`; `crop`: affine `[a, b, c, d, tx, ty]` in normalized image space; `opacity`; `blend`; `visible` | `fit "cover"`, `opacity 1`, `blend "normal"`, `visible true` |
| `"mesh"` | `cols` **req**, `rows` **req** (integers ≥ 1); `colors` **req**: Color[]; `points` **req**: array | **Feature `fill/mesh`.** `colors` and `points` are row-major with exactly `cols × rows` entries; each `points` entry is opaque in 1.0: readers store and round-trip it and are not required to render mesh paints (§20 row 29). *Informative (§20 row 33):* Kimo renders entries `[x, y]` or `{position: [x, y], leftHandle?, rightHandle?, topHandle?, bottomHandle?}` (normalized to the node box; handles are offsets from the position, a missing one mirrors its opposite or is automatic) as pen.dev `mesh_gradient`: Coons patches with Catmull-Rom auto handles, corner colors blended with smoothstep weights in sRGB. |
| `"shader"` | `src` **req**: relative path; `uniforms`: record name → any | **Feature `fill/shader`.** The shader protocol is not defined by 1.0: readers store and round-trip `src` and `uniforms` and are not required to render shader paints (§20 row 29). *Informative (§20 row 33):* Kimo runs `src` as a pen.dev WebGL 1.0 (GLSL ES 1.00) fragment shader with annotated uniforms (`@resolution`, `@time`, `@mouse`, `@color`, `@default`, `@range`/`@min`/`@max`, `@label`); `uniforms` override them by name (number, boolean, `#RRGGBB[AA]`, 2–4 numbers, or a binding). |

**Image crop.** `crop` maps the node box, normalized to [0,1]², into normalized image space (`[a, b, c, d, tx, ty]` as in SVG/CSS `matrix()`): a box point (u, v) samples the image at (a·u + c·v + tx, b·u + d·v + ty). With `fit: "crop"` the image is drawn through that transform, so the crop region (the transform's image of the unit square) is stretched to the node box; an absent `crop` is the identity (same as `stretch`). An axis-aligned crop of the image rectangle (x, y, w, h), normalized, is `[w, 0, 0, h, x, y]`. Readers that do not support `crop` with another `fit` ignore it there.

### 7.2 Stroke

| Field | Type | Default |
|---|---|---|
| `paint` | Paint \| Paint[] — **required** | |
| `width` | Num ≥ 0, or `{ t?, r?, b?, l? }` (per side; an absent side is 0) | `1` |
| `align` | `"inside"` \| `"center"` \| `"outside"` | `"inside"` |
| `cap` | `"butt"` \| `"round"` \| `"square"` | `"butt"` |
| `join` | `"miter"` \| `"bevel"` \| `"round"` | `"miter"` |
| `miterLimit` | number ≥ 1 | `4` (SVG `stroke-miterlimit`; a miter longer than `miterLimit × width` is beveled) |
| `dash` | number[] (≥ 0) | absent = solid. Alternating dash and gap lengths in px, as SVG `stroke-dasharray` (an odd-length list repeats). `cap` applies to every dash. |

Per-side widths (`{ t, r, b, l }`) draw each side as its own segment, with the given `align`, `cap` and `dash`; corners are joined only where both adjacent sides are non-zero.

### 7.3 Effects

| `kind` | Fields | Defaults |
|---|---|---|
| `"shadow"` | `x` **req**, `y` **req**: Num; `blur` **req**: Num ≥ 0; `color` **req**; `inner`: boolean; `spread`: Num; `blend`; `visible`: boolean | `inner false`, `spread 0`, `blend "normal"`, `visible true` |
| `"blur"` | `radius` **req**: Num ≥ 0 (layer blur); `visible`: boolean | `visible true` |
| `"backdrop-blur"` | `radius` **req**: Num ≥ 0 (background blur); `visible`: boolean | `visible true` |

Effects apply in list order. An effect with `visible: false` is kept but not rendered or exported (the eye toggle). `blur` is the CSS blur radius (`filter: blur(r)`, standard deviation `r / 2`); a shadow's `blur` is the CSS shadow blur radius (standard deviation `blur / 2`), and `spread` grows (inner: shrinks the hole of) the shadow shape before blurring.

## 8. Text

### 8.1 Content and growth

- `content` is a **string** (always literal), a **binding** to a string variable, or (feature **`text/runs`**) an array of spans `{ text: string, style?: TextStyle, href?: string, fill?: Color }`. A span's style applies on top of the node's `style`; its `fill` (a solid color or a color binding) paints that span instead of the node's `fill`, and its `href` links that span. Paragraph fields (`align`, `valign`) are read from the node's `style` only. Spans are a delta sequence (they map onto `Y.Text` attributes), not offsets. Writers SHOULD merge adjacent spans with equal attributes and SHOULD write a plain string when every span would be equal.
- `grow: "auto"` — both dimensions come from the content (single line unless the content has line breaks); `w`/`h` are ignored and SHOULD be omitted. `"fixed-width"` — `w` is used and text wraps; `h` comes from the content. `"fixed"` — both are used; overflow is clipped by an ancestor's `clip` only.

### 8.2 TextStyle

| Field | Type | Meaning (absent = the reader's default) |
|---|---|---|
| `font` | string \| Ref | Family name. |
| `size` | Num > 0 | px. |
| `weight` | Num 1–1000 | |
| `italic` | boolean | |
| `lineHeight` | Num ≥ 0 (multiplier of `size`) \| `{ px: n }` | Absent = the font's default line height. |
| `letterSpacing` | Num | px. |
| `align` | `left` `center` `right` `justify` | |
| `valign` | `top` `middle` `bottom` | |
| `decoration` | (`"underline"` \| `"strike"`)[] (unique) | |
| `case` | `upper` `lower` `title` | Render-time transform (also applied when measuring); `content` keeps what was typed. Absent = as typed. `title` capitalises the first letter of each word. |
| `features` | record 4-char OpenType tag → boolean \| number | |
| `href` | string | Link. |
| `typography` | Ref | Binds a `typography` variable (feature **`tokens/composite`**): its fields apply first, inline fields override them. |

### 8.3 Default text fill

A text node without `fill` paints with the color variable **`text/default`** when the document declares it, otherwise opaque black (`#000000`). Text is never invisible by omission. An explicit `fill: []` (or only invisible paints) is honored and linted (`TEXT_INVISIBLE`).

## 9. Components, instances, overrides and slots

### 9.1 Components

Any non-instance node with a truthy `component` is a component; its subtree (every node whose parent chain reaches it) is the component's content. An instance MAY also carry `component` — a **derived component** (e.g. a variant: `Button/Ghost` = an instance of `Button/Primary` with overrides, marked as a component). Paths into a derived component resolve through to the component it instantiates (§9.5).

A component MUST NOT contain, directly or through nested instances or derived components, an instance of itself (`INSTANCE_CYCLE`). This includes what an instance places inside its component: a `set.of` swap of a nested instance and an `args` value of an `instance` prop put the named component inside every component that holds the target (the instance's component and the component of each instance the path crosses), so naming one of those is a cycle too.

### 9.2 Instances

- `of` names a component: a local id, or `alias:id` for a library component. The target MUST exist and MUST be a component.
- An instance has only Placement fields at its top level (plus `of`, `props`, `args`, `overrides`, `component`). **Every visual property of the component root (`w`, `h`, `fill`, `opacity`, `visible`, `rotation`, `flipX`, `layout`, …) MAY appear only inside `props`**, never at the instance's top level (`INSTANCE_VISUAL_FIELD`). `props` MUST NOT contain Placement fields or `component`; applying `props` to the root MUST yield a valid node.
- `args` holds values for the component's declared props (§9.6).
- An instance has no children of its own: its subtree is the component's, plus instance-owned nodes (§9.4).

### 9.3 Overrides

`overrides` maps an IdPath (§9.5) to exactly one of:

| Override | Meaning |
|---|---|
| `{ "set": { … } }` | **Property override.** Each key replaces the target's property wholesale (shallow: `set: {layout: …}` replaces the whole layout). Keys `type`, `parent`, `at`, `order`, `component` and `overrides` MUST NOT appear. Applying `set` to the target MUST yield a valid node of the target's type. When the target is an instance, `set` uses instance fields (`of` swaps the component, `props`, `args`, `theme`, `name`, `x`, `y`, `position`); visual fields go inside `set.props`. |
| `{ "slot": true }` | **Children replacement.** The target MUST be a frame with `slot`. Its children become exactly the nodes with `parent` = this instance and `at` = this key, in sibling order. Zero nodes = an empty slot. |
| `{ "replace": true }` | **Full replacement.** Exactly one node with `parent` = this instance and `at` = this key replaces the target (and its subtree). |

Overrides are explicitly tagged; their meaning never depends on which keys a value happens to contain.

**Precedence** (later wins): the component as authored → a derived component's own `props`/`args`/`overrides` → the instance's `props` (root) → the instance's `args` (declared props) → the instance's `overrides`. For nested instances, an outer instance's override of a deep path wins over the nested instance's own overrides. Overrides do not cascade to other instances of the same component.

To hide a descendant inside an instance, set `visible: false`; descendants of an instance cannot be deleted.

### 9.4 Instance-owned nodes (`at`)

Slot content and replacement nodes live in the flat node table like any other node, so they diff, merge and sync the same way:

- `parent` = the instance id (a real Id), `at` = the IdPath of the descendant they attach to.
- A node whose parent is an instance MUST have `at`, and `at` MUST equal a key of that instance's `overrides` whose value is `slot` or `replace` (`AT_WITHOUT_OVERRIDE`). A node whose parent is not an instance MUST NOT have `at`.
- The override entry is only a marker: the child list's single source of truth is the set of nodes pointing at it.

### 9.5 Id path resolution

An IdPath is resolved relative to a component C (for an override or `at`: the instance's component; for a declared prop target: the declaring component):

1. Split the path at `/`. For each segment, in order:
   1. The segment is looked up **among the descendants of C** (nodes whose parent chain reaches C, including instance-owned nodes inside C), **in C's namespace**: written as a bare Id when C is a node of this document, and as `alias:Id` when C belongs to the library imported as `alias`.
   2. If not found and C is a derived component (an instance), C is replaced by the component it instantiates and the lookup is repeated (derived components are transparent).
   3. If it is not the last segment, the found node MUST be an instance, and C becomes its component; the next segment crosses that instance boundary.
2. The node found for the last segment is the target. Any failure is `OVERRIDE_PATH_UNRESOLVED`.

So `"ui:CardActns1/ui:BtnLabel01"` crosses from a library card into a library button. Paths never use names, so renames cannot break them. In 1.0, a path segment that would enter a library imported *by a library* (rather than by this document) is not resolved by validators (reported as not checked).

### 9.6 Declared component props

`component: { "props": { <name>: PropDef } }` declares a typed prop API (used by the React exporter: typed props for declared props only; every other override is inlined).

| PropDef `type` | Fields | Target requirement | An `args` value… |
|---|---|---|---|
| `"text"` | `target`, `field: "content"`, `default?: string` | a `text` node | string or string binding; sets `content` |
| `"boolean"` | `target`, `field: "visible"`, `default?: boolean` | any non-instance node | boolean or boolean binding; sets `visible` |
| `"instance"` | `target`, `default?: QId` | an `instance` | a component QId; swaps the target's `of` |
| `"enum"` | `options` (record option → value, ≥ 1); `target` + `field` (together, optional); `targets` (optional record option → EnumTarget[]) | `target`: a node that has `field` (not `type`/`parent`/`at`/`order`/`component`/`overrides`); every option value MUST be valid for `field`. Without `target`/`field`, `targets` is required and option values are informative (editors write `null`) | an option name; sets `field` to that option's value, then applies that option's `targets` in order |
| `"slot"` | `target` | a frame with `slot` | not allowed: slot content is given by nodes with `at` (§9.4); exporters emit `children` or a named `ReactNode` prop |

`target` is an IdPath resolved from the declaring component (§9.5). **A `target` equal to the declaring component's own id names the component root** (through derived components, the base root); its `args` apply at the root with the precedence of `args` (above `props`). Only declared prop targets may name the root: override keys and `at` MUST NOT (`OVERRIDE_PATH_UNRESOLVED`; the root is overridden through `props`). `default` is informative for exporters (the generated prop's default); an instance without the arg renders the component as authored; `enum` props have no `default`. `args` keys MUST be declared props (`ARG_UNKNOWN`).

**Enum targets** (board 27 §8 a). `targets[option]` is a list of EnumTarget `{ target, field, value }`: `target` is an IdPath resolved like a prop target (the declaring component's own id names the root), `field` is a property name of the target node, or `<property>/<key>` for one key of a struct property (`layout/pad`, `layout/gap`, `style/size`, `style/weight`, an instance's `props/opacity`) — the property keeps its other keys (an absent property starts empty). `value` MUST be valid for the field (checked as the property with that key replaced) and MAY be a binding. Every `targets` key MUST be an option (`PROP_TARGET_INVALID`), as are a target that does not resolve, a field the node lacks, or a `target` without `field` (and vice versa). Choosing an option on an instance applies the legacy `target`/`field` value first, then the option's targets in list order, all with the precedence of `args`; args apply in key order. Properties an option does not target keep the main's values. A file whose enum props use only `target`/`field`/`options` is unchanged; editors MAY rewrite such a prop as `targets` (one target per option) when it is edited.

Every PropDef MAY carry **`order`** (an Order key): `component.props` is a record, so canonical serialization sorts it by name; editors list declared props by (`order`, then name), an absent `order` counting as the empty string, and SHOULD write an `order` on every declaration they create. A derived component's redeclaration without `order` keeps the base declaration's position.

**Derived components inherit the prop API.** The declared props of a derived component are those of the component it instantiates (recursively), with its own `component.props` declarations merged over them by name. Inherited targets resolve through the derived component (§9.5), so an instance of `Button/Ghost` takes the same `args` as an instance of `Button/Primary`.

### 9.7 Component metadata (namespace `kimo.component`)

| Node meta key | Value | Meaning |
|---|---|---|
| `kimo.component.description` | string | The component's description (editor Component section; exporters MAY emit it as a doc comment). |

### 9.8 Expansion (normative for readers that render or edit instances)

Readers expand an instance to its component's content as follows; `@kimo/core-schema` `createExpandedView` is the reference.

1. **Composite ids.** A node emitted from component content is addressed as `<instance id>/<IdPath>`, the IdPath being the node's path relative to the instance's component (§9.5) — exactly the key an override of that instance uses. Instance-owned nodes keep their own ids. Real ids never contain `/`.
2. **Root.** The expanded root is the base component root with `props` (and root-targeting `args`) applied; its placement fields (`parent`, `at`, `order`, `x`, `y`, `position`, `locked`, `meta`, `name` when the instance has one) are the instance's. Its `theme` is the component root's pins (base first, then each derived component's own pins) overwritten by the instance's pins, so a component authored under a pinned theme keeps it unless the instance pins otherwise.
3. **Library content** is read in the consumer's namespace: bindings, theme pin keys, `of` and `slot.suggested` values written inside library `alias` get the `alias:` prefix.
4. **Theme of expanded nodes.** The placement path of an expanded node runs through the expanded tree (instance → component content → slot frame → slot content), so pins inside component content apply to slot content placed in it.

The same rules apply to `set.props` and `set.args` of a `set` override on a nested instance: they are checked against that instance's effective component (the one named by `set.of`, if present) exactly like an instance's own `props` and `args`. Likewise an override key that crosses a nested instance continues in its effective component: when the holder swaps the nested instance (`set.of` on that path, else an `instance` prop arg targeting it), the remaining segments resolve in the swapped component, and keys that no longer resolve are `OVERRIDE_PATH_UNRESOLVED`.

5. **Precedence of kinds across nesting levels.** When an outer instance overrides a deep path with `slot` or `replace`, it replaces the nested instance's own `slot` / `replace` on that path; an outer `set` on a path the nested instance replaced targets a node that is not there and is not applied.
6. **Size.** Readers MAY bound the number of nodes one top-level expansion emits (the reference stops at 50 000 and reports `INSTANCE_TOO_LARGE`), since depth alone does not bound fan-out.

## 10. Variables and themes

### 10.1 Variables

```jsonc
"variables": {
  "surface": { "type": "color", "value": [ { "value": "#FFFFFF", "when": { "mode": "light" } },
                                           { "value": { "$ref": "ink-900" }, "when": { "mode": "dark" } } ],
               "group": "color.surface", "description": "Page background" }
}
```

| Field | Meaning |
|---|---|
| `type` | `color`, `number`, `string`, `boolean`; composite (feature **`tokens/composite`**): `typography`, `shadow`, `dimension`. |
| `value` | A **plain value** used under every theme, or a **themed value**: a non-empty array of entries `{ value, when?: record axis key → value }`. An array is themed exactly when every element is an object with a `value` member (shadow arrays and plain values never qualify). |
| `description` | Free text. |
| `group` | Dotted group path for DTCG export (e.g. `color.surface`). |

Plain values by type: `color` → Color; `number` → Num; `string` → string \| Ref; `boolean` → boolean \| Ref; `typography` → a TextStyle without `typography`, or Ref; `shadow` → a shadow Effect or an array of them, or Ref; `dimension` → `{ value: number, unit: "px" }` (px only in 0.x and 1.x), or Ref. **A value that is a binding is an alias**; an alias MUST name a variable of the same type.

### 10.2 Bindings and types

A binding MUST name an existing variable (`VARIABLE_MISSING`); `alias:name` names a variable of an imported library, which is never copied into the consumer. The bound variable's type MUST fit the property:

| Property | Accepted variable types |
|---|---|
| `fill`, `color`, `colors`, stroke `paint`, gradient stop `color` | `color` |
| `opacity`, `gap`, `crossGap`, `pad`, `radius`, stroke `width` / `t` `r` `b` `l`, shadow `x` `y` `blur` `spread`, effect `radius`, `w`, `h`, text `size` `weight` `lineHeight` `letterSpacing`, icon `weight` | `number`, `dimension` |
| `visible`, `clip` | `boolean` |
| `content`, `icon`, `font` | `string` |
| `effects` | `shadow` |
| `typography` | `typography` |
| `args` of a text / boolean prop | `string` / `boolean` |
| script `inputs`, shader `uniforms`, enum `options`, enum target `value` | any |

### 10.3 Themes

`themes` declares axes, each with its values; the first value is the default. A node's `theme` pins axes for its subtree; keys are axis keys (`alias:axis` for a library's axis) and values MUST be declared values of that axis (`THEME_AXIS_UNKNOWN`, `THEME_VALUE_UNKNOWN`). The same applies to `when` keys and values.

### 10.4 Resolution (normative)

1. **Effective theme of a node.** Start from the defaults: the first value of every local axis, and for every *loaded* imported library `alias`, the first value of each of its axes under the key `alias:axis`. Walk from the root to the node along its **placement path** (`parent` links, which include instance placement and `at` nodes), so instances inherit from where they sit. At each node with `theme`, overwrite only the named axes. For nodes inside an expanded instance the placement path is the expanded one (§9.8 rules 2 and 4).
2. **Library axes** are namespaced `alias:axis` and default from the library.
3. **Variable value.** A plain value applies under every theme. For a themed value, an entry **matches** when every axis named in its `when` equals the effective value of that axis; axes it does not name are ignored (partial `when` is allowed). **Entries without `when`, or with `when: {}`, are fallbacks only and never candidates.** Among matching entries **the last one in list order wins** (no specificity ranking).
4. **No candidate.** Use the fallback entry — the *last* entry without `when` (or with `when: {}`) — if there is one, otherwise the *first* entry. In both cases emit the lint `THEME_NO_MATCH(variable, effectiveTheme)`.
5. **Aliases** resolve recursively with cycle detection: a cycle is the error `VARIABLE_CYCLE`.
6. **Library variables** (`{ "$ref": "alias:name" }`) resolve inside the library: a `when` key `axis` of the library reads the consumer's effective value of `alias:axis`, or the library's default for that axis. Paste-without-import copies the variables, with a "use existing" / "add renamed" choice.

## 11. Imports and libraries

`imports` maps an alias to a relative path of a library `.kimo` file. Library node ids, variables and axes are referenced with the alias prefix everywhere (`of`, override path segments, `at`, bindings, theme pins, `when`, `slot.suggested`, instance prop defaults); consumer-owned ids are never prefixed. An alias used anywhere MUST be declared (`ALIAS_UNKNOWN`). Libraries are linked read-only and loaded when the consumer is opened; validators check references into a library only when the library is supplied (otherwise `LIBRARY_NOT_LOADED`, a warning).

## 12. Assets

1. Binary assets live in `assets/` next to the `.kimo` file, **content-addressed**: `assets/<sha256-16>.<ext>` where `<sha256-16>` is the first 16 lowercase hex digits of the SHA-256 of the file bytes. They are referenced as `./assets/<hash>.<ext>`, deduplicate, never collide across branches and merge as add-only. `kimo gc` removes unreferenced files; the docs recommend Git LFS above a size threshold.
2. The optional header member `assets` is a manifest: asset file name → `{ mime: string, bytes?: integer, width?: integer, height?: integer, name?: string }` (`name` is the original file name, informative). When the manifest is present, every asset reference MUST be listed (`ASSET_MISSING`) and unreferenced entries are linted (`ASSET_UNUSED`); font entries (a `font/*` MIME type or a `.ttf` / `.otf` / `.woff` / `.woff2` name) are used by family, never by path, and are not linted. A validator given the folder listing MUST also report references to missing files.
3. Fonts fetched from a font service SHOULD be stored as document assets so the file renders offline. A reader matches a font asset to text by the family, weight and style in the font's own `name` / `OS/2` tables; when it cannot inspect the file (WOFF2 needs a Brotli decoder), it reads them from the manifest `name`, which writers SHOULD then set to `<Family>-<Style>.<ext>` with the family verbatim and the style one of `Thin`, `ExtraLight`, `Light`, `Regular`, `Medium`, `SemiBold`, `Bold`, `ExtraBold`, `Black`, optionally followed by `Italic` (`Italic` alone for 400 italic), e.g. `"Space Grotesk-SemiBold.woff2"`. Family names compare case-insensitively, ignoring spaces. (Informative: Kimo writes each Google face it fetches to `assets/` on first use and lists it in the manifest, with this name, when the file is saved — the font never becomes an edit of the open document; files over 20 MB are skipped.)

## 13. Feature flags

A document MUST list in `features` every gated construct it uses (`FEATURE_NOT_DECLARED` otherwise). A property equal to its default never needs its feature.

| Feature | Unlocks |
|---|---|
| `layout/wrap` | `layout.wrap`, `layout.crossGap` |
| `layout/stretch-baseline` | `layout.align` `"stretch"` and `"baseline"` |
| `size/min-max` | `min` / `max` in `fit` / `fill` sizes |
| `text/runs` | `content` as TextSpan[] |
| `tokens/composite` | variable types `typography`, `shadow`, `dimension`; `style.typography`; `effects` as a binding |
| `fill/mesh` | `kind: "mesh"` paints |
| `fill/shader` | `kind: "shader"` paints |
| `node/script` | `script` nodes |
| `node/browser` | `browser` nodes |
| `merge/conflicts` | root `merge` and `conflicts` (stored merge conflicts, §21) |

Feature gates apply wherever the construct appears, including instance `props` and `set` overrides. Opaque records (script `inputs`, shader `uniforms`, `args`; Appendix B) hold data, not document constructs, and are never gated. Enum option values are gated as values of the prop's `field` (an option `{dir:"row", wrap:true}` for `field: "layout"` needs `layout/wrap`). `style.typography` is gated wherever a TextStyle appears (node `style`, TextSpan `style`). A reader that does not support a listed feature MUST open the file read-only (§16.3); validators report it as `FEATURE_UNKNOWN` (warning). Feature names have the form `area/name` (`^[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$`).

## 14. Defaults

A property equal to its default means exactly the same as the absent property. **Canonical writers omit it** (§15). The table is data in `@kimo/core-schema` (`DEFAULTS`); the JSON Schema `default` keywords and the writer's omit logic are generated from it.

| Scope | Field | Default | `.pen` default, if different |
|---|---|---|---|
| every node but instance | `visible`, `opacity`, `rotation`, `flipX` / `flipY`, `blend` | `true`, `1`, `0`, `false`, `"normal"` | |
| every node | `position`, `locked`, `component` | `"auto"`, `false`, `false` | |
| frame | `layout` | absent = no flex layout | `layout: horizontal` (importer writes `dir: "row"`) |
| frame | `w` / `h` | `{ "mode": "fit" }` | `fit_content` |
| frame | `clip`, `radius` | `false`, `0` | |
| rect, polygon, browser | `radius` | `0` | |
| polygon `star` | `ratio` | `0.38` | |
| ellipse | `innerRadius`, `startAngle`, `sweepAngle` | `0`, `0`, `360` | |
| path | `fillRule` | `"nonzero"` | |
| text | `grow` | `"auto"` | |
| text | `style.lineHeight` | absent = the font's default | same |
| script | `clip` | `false` | |
| browser | `zoom`, `scrollX`, `scrollY` | `1`, `0`, `0` | |
| layout | `gap`, `crossGap`, `pad` | `0` | gap 0; padding undocumented |
| layout | `justify`, `align` | `"start"` | |
| layout | `wrap`, `includeStroke` | `false` | |
| Size `fill` | `fallback` / `weight` | none / `1` | |
| stroke | `width`, `align`, `cap`, `join`, `miterLimit` | `1`, `"inside"`, `"butt"`, `"miter"`, `4` | (to be checked by the importer) |
| solid paint | `blend`, `visible` | `"normal"`, `true` | |
| gradient | `center`, `size`, `rotation`, `interpolation`, `opacity`, `blend`, `visible` | `[0.5,0.5]`, `[1,1]`, `0`, `"srgb"`, `1`, `"normal"`, `true` | |
| image paint | `fit`, `opacity`, `blend`, `visible` | `"cover"`, `1`, `"normal"`, `true` | `cover` |
| shadow | `inner`, `spread`, `blend`, `visible` | `false`, `0`, `"normal"`, `true` | |
| blur, backdrop-blur | `visible` | `true` | |
| OKLCH / P3 color | `alpha` | `1` | |

Not defaulted: `x` and `y` (absent means 0, but an explicit 0 is kept so positions stay visible in diffs), and every field without a row above.

**Where defaults do not apply.** The top-level keys of an instance's `props` and of a `set` override are never omitted or filled in, because there they override a component value (`opacity: 1` restores full opacity over a component's 0.5). Values nested below those keys are normalized, because each such value replaces the target's value wholesale.

## 15. Canonical serialization

The canonical serialization is a pure function of the document's data. Writers MUST produce it; for every canonical text `s`, `serialize(parse(s)) === s`.

### 15.1 Layout

```
{
"$schema": "https://getkimo.design/schema/kimo-1.0.json",
"format": "1.0.0",
"features": ["layout/wrap"],
"meta": {"name":"Kimo landing"},
"variables": {
"ink": {"type":"color","value":"#111111"}

, "space-m": {"type":"number","value":16}
},
"nodes": {
"A1hero0001": {"type":"frame","parent":null,"order":"a0","name":"Hero"}

, "B2title001": {"type":"text","parent":"A1hero0001","order":"a0","content":"Hi"}
}
}
```

1. The first line is `{`; the file ends with `}` and one LF.
2. Each root member is written on its own line as `"key": <value>` — one space after the colon — followed by `,` except for the last member. Members appear in canonical order (§15.2); **`nodes` is always last**; unknown root members follow the known ones (sorted by code unit) and precede `nodes`. Only the members defined in §4 are ranked at the root; an unknown root member is not ranked even when its name appears in Appendix A, and its value is opaque (§15.2).
3. **Tables** — `nodes`, `variables`, `assets` and `conflicts` (§21) — are written as `"key": {`, then one line per entry, then `}`. Entries are sorted by key (code unit). Each entry is `"<key>": <value>` on a single line; **the separating comma is written at the start of every entry line after the first (`, "<key>": …`)**, and **one blank line separates consecutive entries**. An empty table is written `{}` on the member's line. (Appending or removing the last entry never edits a neighbouring line; the blank line keeps unrelated neighbours out of one conflict hunk in a line-based merge.)
4. Every other value (root members, table entries) is written as **compact JSON**: no insignificant whitespace.
5. Strings are written as by ECMAScript `JSON.stringify` (minimal escaping; non-ASCII as UTF-8; U+2028/U+2029 unescaped). A value never spans lines.
6. Numbers are written in the shortest form that round-trips (ECMAScript `Number.prototype.toString`), e.g. `0.30000000000000004`, `1e+21`. Negative zero is written `0`. NaN and infinities cannot be written.
7. Properties equal to their default are omitted (§14). Top-level `features` is sorted by code unit. Arrays otherwise keep their order. Properties whose value is undefined do not exist.

### 15.2 Key order

- **Structs** (schema-defined objects: the root, nodes, paints, layout, …): keys listed in Appendix A come first, in that order; all other keys follow, sorted by code unit. The order is a single global ranking that does not depend on the object's kind.
- **Records** (keys are data): keys sorted by code unit. Record-valued properties are listed in Appendix B. Their values are structs, except where Appendix B says *opaque*.
- **Opaque values** — anything below an unknown key, and the values of the opaque records — are ordered purely by code unit at every depth.

This rule is part of the versioning contract (§16.4): because keys introduced by later versions sort after all 1.0 keys and their subtrees are ordered purely by code unit, a 1.0 reader re-serializes a newer document byte-identically.

### 15.3 Parsing

Readers MUST reject: malformed JSON; **duplicate keys in any object** (a duplicated node id would otherwise be silently dropped); a root that is not an object. A `__proto__` key is ordinary data. Parsing does not validate (§17).

## 16. Versioning, migration and forward compatibility

### 16.1 Version numbers

`format` is `major.minor.patch`. Major and minor identify the format; a **patch** release is editorial and never changes what a document may contain (a 1.0 reader treats `1.0.7` as current). A **minor** release may add optional fields, node types, paint kinds and features. A **major** release may change or remove anything. Within 1.x every minor release is backward compatible (§16.4); the 0.x line, which allowed breaking minors, ended with 0.1. Defaults MUST NOT change within a major version.

### 16.2 Migrations

- A migration is a pure function from one format line (`major.minor`) to the next, registered in `@kimo/core-schema` (`MIGRATIONS`, e.g. `migrations/1.0→1.1`), tested with fixtures. The 1.0 registry holds one step, **`0.1 → 1.0`**: format 1.0 is format 0.1 declared stable, so every 0.1 document is a valid 1.0 document and the step is the identity; only the `format` and `$schema` header lines change (fixtures `fixtures/migrations/`). A file with any `0.1.x` format therefore opens migrated in memory behind the upgrade prompt below.
- Readers open an older file **migrated in memory**. Autosave of a migrated file goes to a recovery file (`~/.kimo/recovery/<hash>`), never to the working file, **until the user accepts a one-time "Upgrade file format" prompt or saves explicitly**. The upgrade then changes the `format` and `$schema` header lines, plus whatever the migration itself must rewrite.
- Migrations MUST preserve every property they do not understand.
- A file with no migration path to the reader's version opens read-only.

### 16.3 Forward compatibility

- A file whose `format` major or minor is newer than the reader's, or whose `features` include one the reader does not support, **opens read-only**: saves are refused with a "newer Kimo needed" message. A validator does not validate a newer document beyond its version (`FORMAT_NEWER`).
- **Readers MUST preserve unknown properties, unknown root members, unknown node fields and unknown node types on round-trip.**
- Conformance test (in `@kimo/core-schema`): a newer file is byte-identical after open and re-serialization, and an edit to one node changes only that node's line.
- A store that failed to load is read-only and cannot be saved. Editors SHOULD also open documents with validation errors read-only unless the user chooses to repair them.

### 16.4 Rules for future versions

- Appendix A is frozen for the 0.x and 1.x lines: keys introduced by later versions are never ranked, so they sort after all ranked keys by code unit, and everything below them is ordered purely by code unit (§15.2). This is what lets an older reader re-serialize a newer document byte-identically. At the root this holds for every new member (§15.1 rule 2). Below the root, ranking is by name, so later versions MUST NOT introduce a property whose name is already in Appendix A on an object that does not define it in 1.0; they pick an unranked name instead.
- New record-valued properties are opaque to older readers, so their subtrees are ordered purely by code unit in every version.
- New semantics MUST be introduced through new properties, node types, paint kinds or feature flags, never by changing the meaning or default of an existing property within a major version.

## 17. Validation

A validator checks, in order: the format version; the structure (the JSON Schema, with clear errors for unions); feature declarations; then the semantic rules. Every issue has a JSON Pointer `path`, a `code` and a message. **Errors** make the document invalid; **warnings** are lints. The table is normative.

| Code | Severity | Meaning |
|---|---|---|
| `NOT_AN_OBJECT` | error | The document root is not a JSON object. |
| `SCHEMA` | error | A value does not match the structural schema. |
| `UNKNOWN_PROPERTY` | error | A property not defined by this format version (preserved, but invalid). |
| `UNKNOWN_NODE_TYPE` | error | A node `type` not defined by this format version. |
| `FORMAT_INVALID` | error | `format` is not a `major.minor.patch` version. |
| `FORMAT_NEWER` | error | The document's format is newer than this reader; it opens read-only. |
| `FORMAT_OLDER` | error | The document's format is older; migrate it before validating. |
| `SCHEMA_URL_MISMATCH` | warning | `$schema` does not name the document's format version. |
| `FEATURE_UNKNOWN` | warning | `features` lists a feature this reader does not know; the file opens read-only. |
| `FEATURE_NOT_DECLARED` | error | A feature-gated construct is used but its feature is not listed in `features`. |
| `PARENT_MISSING` | error | `parent` names a node that does not exist. |
| `PARENT_CYCLE` | error | Following `parent` links leads back to the node. |
| `PARENT_NOT_CONTAINER` | error | The parent's type cannot have children. |
| `AT_WITHOUT_INSTANCE` | error | `at` is set but the parent is not an instance. |
| `INSTANCE_CHILD_WITHOUT_AT` | error | A node whose parent is an instance has no `at`. |
| `AT_WITHOUT_OVERRIDE` | error | `at` does not name a `slot` or `replace` override of the parent instance. |
| `REPLACE_COUNT` | error | A `replace` override does not have exactly one replacement node. |
| `ORDER_DUPLICATE` | warning | Two siblings share an `order` key (legal; ties sort by id). |
| `INSTANCE_VISUAL_FIELD` | error | A visual field at an instance's top level; it belongs in `props`. |
| `REF_MISSING` | error | A component reference (`of`, `set.of`, an instance prop's `default` or `args` value, `slot.suggested`) names a node that does not exist. |
| `REF_NOT_COMPONENT` | error | A component reference names a node that is not a component. |
| `INSTANCE_CYCLE` | error | A component contains (directly or transitively, including through `set.of`, instance-prop `args` and instance-prop `default`s) an instance of itself. |
| `OVERRIDE_PATH_UNRESOLVED` | error | An override key, `at` or prop target does not resolve to a descendant. |
| `OVERRIDE_INVALID` | error | A `set` override or instance `props` would make the target invalid. |
| `SLOT_TARGET_INVALID` | error | A `slot` override or slot prop targets a node that is not a slot frame. |
| `PROP_TARGET_INVALID` | error | A declared component prop targets a node of the wrong kind. |
| `ARG_UNKNOWN` | error | An instance `args` key is not a declared prop of the component. |
| `ARG_INVALID` | error | An instance `args` value does not fit the declared prop. |
| `COMPONENTS_INDEX_INVALID` | error | The `components` index lists a node that is not a component. |
| `VARIABLE_MISSING` | error | A binding names a variable that does not exist. |
| `VARIABLE_TYPE_MISMATCH` | error | A binding's variable type does not fit the bound property. |
| `VARIABLE_CYCLE` | error | Variable aliases form a cycle. |
| `THEME_AXIS_UNKNOWN` | error | A theme pin or `when` names an undeclared axis. |
| `THEME_VALUE_UNKNOWN` | error | A theme pin or `when` names a value its axis does not declare. |
| `THEME_NO_MATCH` | warning | A bound variable has no themed entry for the node's effective theme. |
| `ALIAS_UNKNOWN` | error | A qualified id, id path segment, binding or axis uses an alias not declared in `imports`. |
| `LIBRARY_NOT_LOADED` | warning | References into a library were not checked because it was not supplied. |
| `ASSET_MISSING` | error | An asset reference is not in the asset manifest / asset folder. |
| `ASSET_UNUSED` | warning | An asset manifest entry is not referenced. |
| `MESH_SIZE` | error | A mesh paint's `colors` / `points` length is not `cols * rows`. |
| `TEXT_INVISIBLE` | warning | A text node's fill paints nothing. |
| `FIT_ALL_FILL` | warning | A `fit` frame whose children all `fill` the same axis (circular sizing). |
| `PROMPT_TARGET_MISSING` | warning | A prompt's `target` names no frame of this document. |
| `PAGE_UNKNOWN` | warning | A root node's `page` names no page of `pages`; the node is shown on the first page. |
| `PAGE_NOT_ROOT` | warning | A node that is not a root node has `page`; it is ignored. |
| `VARIABLE_UNUSED` | warning | A variable is not referenced (not reported for library documents). |
| `MERGE_WITHOUT_CONFLICTS` | error | `merge` labels are present but there is no `conflicts` table. |
| `CONFLICT_PATH_INVALID` | error | A conflict `path` addresses what another kind owns (`type`/`parent`/`order`/`at`, or a root member other than meta/themes/imports/assets/components/pages). |
| `CONFLICT_DUPLICATE` | error | Two conflicts address the same target, or one contains the other. |
| `CONFLICT_OPEN` | warning | A merge conflict is not resolved yet. |
| `CONFLICT_STALE` | warning | The document body no longer holds the conflict's `applied` side (edited by hand); editors mark it `edited`. |

The five conflict codes (§21.3) are reported by whole-document runs only, like the usage lints.

Parse-level failures (`PARSE_ERROR`, `DUPLICATE_KEY`, `NOT_AN_OBJECT`) are raised by the reader before validation. Lints are reader behaviour, not format: a later release may add lints (clipped content, unused components) without a format change.

## 18. Merge behaviour (measured)

The table layout targets clean results from plain line-based `git merge` (merge drivers only run where configured locally; GitHub/GitLab and CI ignore `merge=kimo`). Measured with `git merge-file` (git 2.50; myers, histogram and patience agree) on canonical files, in `test/git-merge.test.ts`:

| Concurrent change (ours / theirs) | Result |
|---|---|
| Insert nodes at different positions | clean |
| Edit adjacent nodes | clean |
| Delete a node / edit the node before it, or two entries below it | clean |
| Reparent a node / edit another | clean |
| Edit a variable / add a node | clean |
| Append after the last node / edit the first | clean |
| Remove the last node / edit another | clean |
| **Delete a node / edit the node right after it** | conflict (git removes the deleted line with the blank line after it, so the hunks touch) |
| **Both append different nodes after the last node** | conflict (same insertion point) |
| Both edit the same node | conflict (true conflict) |

**Live sync (CRDT).** Record-valued instance fields (`overrides`, `args`, `props`) and `imports` merge per key, so concurrent changes of different override paths, args or library aliases all survive. Semantic conflicts are not repaired automatically: two concurrent aliases that are each acyclic can merge into an alias cycle (`VARIABLE_CYCLE`); the resolver guards it, the document stays editable, and the user breaks the cycle by giving one variable a literal value.

Independent edits: 8 of 10 scenarios merge cleanly, and every clean result is the canonical serialization of both changes applied. A `.gitattributes` template ships with `*.kimo merge=kimo diff=kimo`; `kimo merge` (semantic, three-way) can also run as a pre-merge step in CI.

## 19. Examples

### 19.1 The teardown example (§10.5), canonical

`packages/core-schema/fixtures/valid/example-10-5.kimo` (with its library `fixtures/valid/libs/kimo-ui.lib.kimo`). The node lines are byte-identical to the teardown's, except that `"fit":"cover"` is omitted because it is the default:

```
{
"$schema": "https://getkimo.design/schema/kimo-1.0.json",
"format": "1.0.0",
"features": ["layout/wrap"],
"meta": {"name":"Kimo landing"},
"themes": {"mode":["light","dark"]},
"imports": {"ui":"./libs/kimo-ui.lib.kimo"},
"variables": {
"ink": {"type":"color","value":[{"value":"#111111","when":{"mode":"light"}},{"value":"#F4F4F5","when":{"mode":"dark"}}]}

, "radius-m": {"type":"number","value":8}

, "space-m": {"type":"number","value":16}

, "surface": {"type":"color","value":[{"value":"#FFFFFF","when":{"mode":"light"}},{"value":{"space":"oklch","l":0.18,"c":0.01,"h":270},"when":{"mode":"dark"}}]}
},
"nodes": {
"A1hero0001": {"type":"frame","parent":null,"order":"a0","name":"Hero","x":0,"y":0,"w":1440,"h":{"mode":"fit","fallback":900},"clip":true,"fill":{"$ref":"surface"},"layout":{"dir":"column","gap":24,"pad":[96,120],"align":"center"}}

, "B2title001": {"type":"text","parent":"A1hero0001","order":"a0","name":"Title","content":"Design next to your code","style":{"font":"Inter","size":64,"weight":700,"lineHeight":1.1},"fill":{"$ref":"ink"}}

, "C3row00001": {"type":"frame","parent":"A1hero0001","order":"a1","name":"Actions","layout":{"dir":"row","gap":{"$ref":"space-m"},"wrap":true}}

, "D4cta00001": {"type":"instance","parent":"C3row00001","order":"a0","name":"Primary CTA","of":"ui:BtnPrimary","overrides":{"ui:BtnLabel01":{"set":{"content":"Get Kimo — $49/mo"}}}}

, "E5card0001": {"type":"instance","parent":"A1hero0001","order":"a2","name":"Feature card","of":"ui:CardBase01","theme":{"mode":"dark"},"props":{"w":{"mode":"fill"}},"overrides":{"ui:CardActns1":{"slot":true}}}

, "F6btn00001": {"type":"instance","parent":"E5card0001","at":"ui:CardActns1","order":"a0","of":"ui:BtnGhost01","overrides":{"ui:BtnLabel01":{"set":{"content":"Learn more"}}}}

, "G7img00001": {"type":"rect","parent":"A1hero0001","order":"a3","name":"Screenshot","w":1200,"h":720,"radius":{"$ref":"radius-m"},"fill":{"kind":"image","src":"./assets/9f2c1ab04e7d3c55.png"},"effects":[{"kind":"shadow","x":0,"y":24,"blur":48,"spread":-12,"color":"#0000003D"}]}
}
}
```

Notes: `F6btn00001` is slot content (`parent` = the instance, `at` = the slot's path). `"$49/mo"` is literal text. `ui:BtnGhost01` is a derived component (an instance of `ui:BtnPrimary` marked `component`), which is why the same path `ui:BtnLabel01` resolves in both `D4cta00001` and `F6btn00001`. The effective theme of `F6btn00001` is `{mode: dark, ui:mode: light}`: it inherits `mode` from where it is placed.

### 19.2 More fixtures

`packages/core-schema/fixtures/` holds the normative examples: `valid/` (components with declared props, args, `set`/`slot`/`replace`, nested paths; multi-axis themes with partial `when`, fallbacks and aliases; every paint, stroke, effect and shape; every feature; Unicode and escaping; `styling-m2.kimo` for the M2 styling fields: layer blend incl. `pass-through`, per-side dashed strokes, `miterLimit`, hidden effects, icon `strokeWidth`/`weight`; `components-m3.kimo` for M3: every prop kind incl. a root-targeting enum, prop `order`, a derived component redeclaring a prop, slot suggestions, slot and replace overrides, a nested `set: { of, props }` swap, `kimo.component.description`, instance theme pins, multi-axis `when` with fallback and OKLCH / Display-P3 values), `invalid/` (one file per error code, named `<CODE>--<case>.kimo`), `lint/` (one per warning), `forward/` (newer minor/major/patch, unknown features) and `parse-errors/`.

## 20. Decisions relative to the teardown (§10)

| # | Topic | Decision |
|---|---|---|
| 1 | Version | The draft format was `0.1.0` with `$schema` `…/kimo-0.1.json`; the frozen format is `1.0.0` with `…/kimo-1.0.json`, matching the teardown sketch. §19.1 is the teardown example in canonical form. Files newer than 1.0 (`1.1.0`, `2.0.0`) open read-only (fixtures `forward/newer-minor.kimo`, `forward/newer-major.kimo`). |
| 2 | Icon glyph field | Renamed from `name` to **`icon`**: in the sketch `Icon.name` collided with the node's `name` (layer name) from `Placement`. |
| 3 | Derived components | Instances MAY carry `component`. The 10.5 example needs this: `ui:BtnLabel01` is overridden through both `ui:BtnPrimary` and `ui:BtnGhost01`, and ids are unique, so `ui:BtnGhost01` must be an instance of `ui:BtnPrimary`. Paths look through derived components (§9.5). |
| 4 | Undetailed node types | `group`, `rect`, `ellipse`, `polygon`, `path`, `note`, `prompt`, `script`, `browser` get fields based on teardown §4.7 under Kimo naming (`d`, `fillRule`, `viewBox`, `sides`, `innerRadius`, `startAngle`, `sweepAngle`, `model`, `src`, `inputs`, `url`, `device`, `zoom`, `scrollX`, `scrollY`). `w`/`h` are required where nothing else determines the size (rect, ellipse, polygon, icon, script, browser). The script and browser feature flags are named `node/script` and `node/browser`. |
| 5 | Key order | The teardown requires a "canonical key order" without defining it. This spec uses one global ranking (Appendix A) chosen so the example's node lines are reproduced, plus code-unit order for records and unknown data (§15.2), which keeps newer files byte-stable in older readers. |
| 6 | Table layout | The one-entry-per-line, leading-comma, blank-line layout (rule 2) also applies to `variables` and `assets`. Inline values are compact JSON; the example's spaced header (`{ "name": … }`) is illustrative jsonc. |
| 7 | Defaults table | Extended with the rows marked in `DEFAULTS_ADDED_IN_SPEC` (e.g. `locked`, `component`, radii, ellipse angles, `fillRule`, paint `opacity`/`blend`/`visible`, shadow `blend`, color `alpha`, browser fields). `x`/`y` are not defaulted. The example writes `"fit":"cover"`, a default, which canonical writers omit. |
| 8 | Defaults and overrides | Defaults are never stripped or applied at the top level of `props` and `set` (they override); nested values are normalized (§14). |
| 9 | Asset manifest | New optional header member `assets` (§12), so asset references can be checked without the folder. Header order: `…, variables, assets, components, nodes`. |
| 10 | Override details | `set` is shallow and cannot change identity/tree fields; a `slot` override MUST target a frame with `slot`; on a nested instance, `set` uses instance fields; precedence is defined (§9.3). |
| 11 | Declared props | `boolean` props cannot target instances; `enum` options are validated against the target field; `slot` props take no `args`; `default` is informative (§9.6). |
| 12 | Themed values | "Themed" is defined structurally (non-empty array of objects that all have `value`), which disambiguates shadow-array values (§10.1). |
| 13 | Feature gates | Apply inside `props`/`set` too; a default-valued property never needs its feature (so `applyDefaults` keeps documents valid). |
| 14 | Upgrade diff | Rule 6 says `format` is "the single header line that changes"; `$schema` embeds the version, so it changes too. |
| 15 | Rule 7 conformance | Newer files open read-only, so "open, edit elsewhere, save" is tested at the library level (re-serialization after an edit), not through the app's save path. |
| 16 | Validation of other versions | Newer documents are not validated beyond the version; older ones must be migrated first. |
| 17 | Library-of-library | References that cross into a library imported *by a library* are not resolved by 1.0 validators (decided for 1.0: kept; resolving them needs a loader contract for transitive libraries, which a later minor can add without breaking 1.0 files). |
| 18 | Colors | `#RGBA` is not allowed (sketch lists `#RGB`, `#RRGGBB`, `#RRGGBBAA`); OKLCH hue is [0, 360). |
| 19 | JSON details | Duplicate keys are rejected; `-0` is written `0`; `features` are sorted. |
| 20 | Text fill | The default text fill rule (§8.3) is a resolution rule, not a serialized default; `fill: []` is respected and linted. |
| 21 | Merge results | Measured, not inferred: two independent-edit patterns still conflict in plain `git merge` (§18). |
| 22 | Clipped-content lint | Teardown §10.6 lists a "clipped content" lint; it needs computed layout. Decided for 1.0: lints are not part of the format (§17), so it can ship in any release without a format change. |
| 23 | Derived component props | Not covered by the teardown: a derived component inherits the declared props of the component it instantiates, its own declarations merged over them (§9.6). |
| 24 | Slot suggestions | `slot.suggested` stays advisory for content, but each entry must name a component, like every other QId (§5.5, §11). |
| 25 | M2 styling (ADR 0010) | Additive, still format `0.1.0` (draft): node `blend` (LayerBlendMode, default `normal`, with `pass-through` for containers), stroke `miterLimit` (default 4), `visible` on every effect (default `true`), icon `strokeWidth` (stroke sets) and `weight` for `phosphor`. The teardown's Graphics sketch has no layer blend or effect visibility; the editor's Layer and Effects sections need both. No new feature flag: a reader that predates these fields reports `UNKNOWN_PROPERTY` and preserves them (§16.3). |
| 26 | M3 components and tokens (ADR 0011) | Additive, still `0.1.0`: PropDef `order` (declaration order of a record-valued `component.props`); a prop `target` may name the declaring component itself (the root; board 12's `size` enum sets the root's padding); node meta key `kimo.component.description` and root meta key `kimo.themes.order` (axis display order, string[]; the `themes` record is sorted by name) in the `kimo` namespace; expansion rules (§9.8) incl. the component root's theme pins and library-namespace rewriting. Known limit kept: one override per path, so an instance cannot restyle a slot frame *and* fill it (no M3 design needs it). |
| 27 | M4 stored merge conflicts (ADR 0012) | Additive, still `0.1.0`, behind feature `merge/conflicts`: root members `merge` and `conflicts` (§21). They are root-only and **not** added to Appendix A (which stays frozen); the serializer ranks them after `components` and lays `conflicts` out as a table. A reader without the feature opens such a file read-only, so it never re-serializes it. The teardown (§10.2 rule 8) only says `kimo merge` is semantic; the board 18 design needs conflicts the editor can load, so they are stored in the file rather than as text markers. |
| 28 | M6 note and prompt nodes (ADR 0014) | Additive, still `0.1.0`: `author` on `note`/`prompt`; prompt `model` also accepts the struct ModelRef `{provider, model}` (the bare string stays valid but is legacy); prompt `target` (Id); lint `PROMPT_TARGET_MISSING`; `placeholder.by` holds the owner's origin. Appendix A stays frozen, so `author` and `provider` are unranked keys: they serialize after the ranked keys in code-unit order (`…"model":{"model":…,"provider":…},"target":…,"author":…`). |
| 29 | 1.0 freeze | Format `1.0.0` = format 0.1 as of rows 1–28, declared stable; no field, default, node type or feature changed. Open items decided: mesh `points` and the shader protocol stay opaque (stored and round-tripped, rendering optional; a later minor defines them only through new properties or kinds, §16.4); library-of-library references stay unresolved (row 17); planned lints are not format (row 22). Migration `0.1 → 1.0` rewrites only the header. `kimo://schema/1.0` is the MCP resource name of the schema. |
| 30 | v1 completeness (board 27), before the 1.0 tag | Additive, no feature flag, no migration (no 1.0 file was published before them): root `pages` (record Id → `{order, name}`) and the root-only placement field `page` (§5.6), lints `PAGE_UNKNOWN` / `PAGE_NOT_ROOT` (warnings, so a concurrent page delete never makes a document invalid); polygon `star: {ratio}` (default 0.38); image `fit: "crop"` with the `crop` semantics of §7.1. Pages are a header record rather than `page` container nodes so that every reader, exporter and tool that walks `parent: null` roots keeps working unchanged, and a page edit merges per id. `pages`, `page`, `star` and `ratio` are unranked (Appendix A stays frozen): `pages` follows `components` at the root, `page` and `star` sort after the ranked node keys. A file without `pages` is exactly the one-page document it always was. |
| 31 | Enum prop targets (board 27 §8) | Additive, no feature flag, no migration: EnumPropDef `targets` (record option → `{target, field, value}[]`, `field` may be `<property>/<key>`), and `target`/`field` become optional (both or neither; then `targets` is required). Lets one option set several properties on several layers (board 27 "Enum targets": "old opacity-only files migrate to one opacity target per option" is an editor rewrite on edit, not a file migration). `targets` is unranked (Appendix A stays frozen) and serializes after `options`. Fixtures: `valid/components-enum-targets.kimo`, `invalid/PROP_TARGET_INVALID--enum-target-field.kimo`. |
| 32 | Rich-text span color (board 30) | Additive, behind the existing feature `text/runs`, no migration: TextSpan `fill` (Color: a solid color or a color binding) paints one span over the node `fill`. Writers merge equal adjacent spans and fall back to a plain string when all spans are equal (§8.1). |
| 33 | Mesh and shader rendering (informative) | No format change, no feature or version bump: §7.1 mesh `points` and the shader protocol stay opaque and rendering stays optional (row 29). Kimo now renders both with pen.dev semantics so imported pen.dev designs draw fully. **Mesh:** `cols × rows` vertices row-major; each cell is a Coons patch bounded by cubic Béziers, handles from the point's `left/right/top/bottomHandle` (normalized offsets) or automatic (Catmull-Rom: ⅙ of the neighbour-to-neighbour vector, ⅓ toward the single neighbour on an edge); colors blend the four patch corners with smoothstep weights in sRGB (fitted to pen.dev output); clipped to the node shape like any fill. **Shader:** `src` (resolved against the `.kimo`'s directory) is a WebGL 1.0 / GLSL ES 1.00 fragment shader; `gl_FragCoord` (bottom-left origin) and `@resolution` are in design px whatever the zoom or export scale, as in pen.dev; `gl_FragColor` is premultiplied; `@time` is seconds on screen (frozen at 0 under `prefers-reduced-motion`) and 0 in static exports; `@mouse` is 0. `uniforms` override annotated defaults by name: numbers, booleans, `#RRGGBB[AA]` (→ vec3/vec4 0..1), arrays of 2–4 numbers, `{ "$ref" }` bindings; a missing one takes `@default`, else 0. Samplers (`@sdf`, `@backdrop`, images) and `textureSize` are not supported: such shaders, and ones that fail to compile, draw nothing and are reported. HTML/CSS/React export approximates a mesh with radial gradients, SVG/PDF use its mean color; shaders are exported only to PNG. |
| 34 | Fill shares from a zero basis (clarification) | No format change, no feature or version bump: §6.1 now states how main-axis `fill` shares space, which 1.0 left to "like `flex-grow`" and Kimo's engine had resolved from the content size (`flex-basis: auto`). Aligned with pen.dev and Figma: in a parent with a definite main size (fixed, or a fill whose parent is definite) that does not wrap, fill items share the space from a zero basis by weight, content and padding ignored (`flex: <weight> 1 0`, `min-width/height: 0`; CSS and Yoga floor a zero basis at the padding, so writers give padded siblings bases proportional to their weights: weight × the largest main-axis padding / weight). A `fit` parent keeps the content basis (a zero basis would size the children to 0 and so the parent), and so does a wrapping parent (lines break on the content sizes). Documents whose fill siblings had unequal content lay out differently: they now match pen.dev (e.g. a 480 px row with a 130 px label and two fill texts gives both texts 163 px, where content-based sharing gave 127.5 / 198.5 and taller wrapped text). |

## 21. Stored merge conflicts (feature `merge/conflicts`)

`kimo merge` (the git merge driver, `*.kimo merge=kimo`, and the editor's merge of external changes) is semantic and three-way. It **never drops a side silently**: every disagreement it cannot settle becomes a *stored conflict*, and the file stays valid JSON that validates, renders and round-trips byte-stably. The editor loads it, lists the conflicts (board 18), applies sides live, and saving with open conflicts keeps them.

### 21.1 Root members

- `merge` (struct MergeInfo, optional): `base`, `ours`, `theirs` — display labels (≤ 200 chars; git's `%S`/`%X`/`%Y`, e.g. `"4e1a9c2"`, `"main"`, `"feat/pricing-v2"`) — and `changes` (integer ≥ 0: changes applied without conflict). Present only together with `conflicts`.
- `conflicts` (record Id → Conflict, at least one entry): conflict ids use the node-id grammar. Serialized as a **table** (§15.1 rule 3) between `merge` and `nodes`: root order is `…, assets, components, merge, conflicts, nodes`.
- Both require feature `merge/conflicts`. `merge`, `conflicts` and the feature are removed together when the merge is finished ("Mark resolved & save").

### 21.2 Conflict entries

Every entry has `kind`, `applied` and optional `resolved`, plus `base` / `ours` / `theirs`. **A missing side means the value is absent on that side** (property unset, node or variable deleted, themed entry missing): JSON has no `undefined`, so absence is encoded by omitting the key.

| `kind` | Target fields | Sides hold | Board 18 row |
|---|---|---|---|
| `prop` | `node` (Id), `path` (JSON Pointer inside the node, ≥ 1 token: `/fill`, `/layout/gap`, `/args/label`, `/component/props/size`) | the property value | "fill · both changed" |
| `node` | `node` (Id), `restored` (optional record Id → Node) | the whole node (Node schema) | "node · deleted vs edited" |
| `move` | `node` (Id) | Placement `{ parent, order, at? }` — all three sides required | "parent · moved twice" |
| `variable` | `variable` (local name), `when` (optional ThemeSelection) | without `when`: the whole Variable; with `when`: the `value` of the themed entry whose `when` equals it exactly | "$brand · light · both changed" |
| `header` | `path` (JSON Pointer from the root into `meta`, `themes`, `imports`, `assets`, `components` or `pages`) | the value at `path` | — |

- `applied` (required): which side the **document body currently holds** — `"ours"`, `"theirs"`, `"base"`, or `"edited"` when the user changed the target by hand after the merge.
- `resolved` (boolean, default `false`): the user picked a side (or edited the target). Open conflicts are those not resolved.
- A `prop` conflict MUST NOT address `type` (a type change is a `node` conflict) or `parent`/`order`/`at` (a `move` conflict).
- `node` conflicts cover delete vs edit (one side absent) and type changes. `restored` holds snapshots of the other nodes that are in the body only because the target is kept — its descendants and any ancestors the deleting side removed — so that applying a side is reversible.
- Entries are structs: `kind` is ranked (Appendix A); the other keys are not, so they follow by code unit and their subtrees are ordered purely by code unit (§15.2). This is deterministic and needs no change to Appendix A.

### 21.3 Validation

Structure: the Conflict union and MergeInfo are part of the JSON Schema (`$defs/Conflict`, `$defs/MergeInfo`, …). Semantic rules (whole-document runs only):

- `FEATURE_NOT_DECLARED` when `merge` or `conflicts` is present without `merge/conflicts`;
- `MERGE_WITHOUT_CONFLICTS` (error); `CONFLICT_PATH_INVALID` (error); `CONFLICT_DUPLICATE` (error: two entries on the same target, a `node` conflict and a `prop`/`move` conflict on the same node, a whole-variable and a themed-entry conflict on the same variable, or nested pointers);
- whole-variable sides MUST be Variables (`SCHEMA`);
- `CONFLICT_OPEN` (warning) for each unresolved entry — `kimo validate` in CI flags unfinished merges;
- `CONFLICT_STALE` (warning) when the body no longer holds `applied` (including a `prop`/`move` target whose node is gone). This is deliberately a warning: a hand edit must never make the file open read-only.

### 21.4 Writing and resolving (normative)

1. **Body.** The merged body holds `ours` for every conflict, except delete vs edit, where it holds the edited side (and `restored`); `applied` says so. The result MUST validate (no errors).
2. **Applying a side** (`applyConflictSide`): `prop` sets or unsets the pointer (creating intermediate objects); `node` puts the side's node and every `restored` node back, or removes the node, its `restored` nodes and all their descendants; `move` sets `parent`/`order`/`at`; `variable` sets/deletes the variable, or sets/adds/removes the matching themed entry (never the last one); `header` sets/unsets the pointer. Then `applied` = the side and `resolved` = true. Applying another side afterwards restores that side exactly.
3. **Take all ours/theirs** applies to unresolved entries only.
4. **Finishing** (`finishMerge`) is refused while any entry is open; it removes `merge`, `conflicts` and the feature. The body already holds every choice.
5. **Saving with open conflicts** writes them as they are. Editors keep autosave paused while any conflict is open; ⌘S writes.
6. **The three-way merge** (contract `ThreeWayMerge` in `@kimo/core-schema`): inputs are the base, ours and theirs documents at the reader's format. Header members, variables (per themed entry when both sides kept the variable themed) and nodes (per property, by JSON Pointer into structs; records such as `overrides`, `args`, `props`, `imports` merge per key; arrays are atomic values) merge independently. A change on one side wins; equal changes on both sides are not conflicts; different changes become entries per 21.2. Placement changes (`parent`, `order`, `at`) merge as one unit (`move`). After merging, cycles are repaired per teardown §9.2 (the node whose move is later — ties: larger id — returns to its previous parent, or the root), and orphans whose parent was deleted on the other side become `node` conflicts on the parent with the orphans in `restored`. Asset manifests merge add-only.
7. **Git driver exit codes** (`MERGE_EXIT`): 0 clean, 1 merged with stored conflicts (git marks the path conflicted), 2 not mergeable semantically (an input unparsable, invalid or newer): the driver leaves git's textual result, and the editor's failed-load banner explains the markers.

Fixtures: `lint/CONFLICT_OPEN--board-18.kimo` (board 18: 5 conflicts, 3 resolved), `lint/CONFLICT_OPEN--every-kind.kimo`, `lint/CONFLICT_STALE--edited-by-hand.kimo`, `valid/merge-conflicts-resolved.kimo`, and one `invalid/` file per error code.

## Appendix A — canonical key order

`$schema`, `format`, `type`, `kind`, `space`, `mode`, `$ref`, `stops`, `parent`, `at`, `order`, `name`, `library`, `createdWith`, `of`, `component`, `placeholder`, `by`, `since`, `locked`, `text`, `inner`, `x`, `y`, `position`, `w`, `t`, `r`, `g`, `b`, `l`, `c`, `h`, `alpha`, `fallback`, `font`, `center`, `size`, `weight`, `strokeWidth`, `min`, `max`, `italic`, `lineHeight`, `px`, `letterSpacing`, `rotation`, `flipX`, `flipY`, `theme`, `props`, `args`, `overrides`, `content`, `grow`, `style`, `set`, `icon`, `d`, `fillRule`, `viewBox`, `sides`, `innerRadius`, `startAngle`, `sweepAngle`, `src`, `inputs`, `url`, `device`, `zoom`, `scrollX`, `scrollY`, `model`, `radius`, `clip`, `cols`, `rows`, `colors`, `points`, `interpolation`, `fit`, `crop`, `uniforms`, `blur`, `spread`, `color`, `opacity`, `blend`, `visible`, `fill`, `stroke`, `effects`, `dir`, `gap`, `crossGap`, `pad`, `justify`, `mime`, `bytes`, `paint`, `width`, `height`, `align`, `valign`, `cap`, `join`, `miterLimit`, `dash`, `wrap`, `includeStroke`, `layout`, `slot`, `suggested`, `replace`, `decoration`, `case`, `features`, `href`, `typography`, `value`, `unit`, `when`, `description`, `group`, `target`, `field`, `default`, `options`, `meta`, `themes`, `imports`, `variables`, `assets`, `components`, `nodes`

(The root `meta` is a struct; a node's `meta` is a record.)

## Appendix B — record-valued properties

| Property | Values |
|---|---|
| root `themes`, `imports`, `variables`, `assets`, `pages`, `conflicts`, `nodes` | struct (or string / string[]) |
| `theme`, `when` | strings |
| `overrides` | struct (Override) |
| `props` directly under `component` (declared props) | struct (PropDef) |
| text style `features` | numbers / booleans |
| node `meta`, `args`, script `inputs`, shader `uniforms`, enum `options` | **opaque** |
| enum `targets` | **opaque** (unranked key: the subtree is ordered by code unit, so an EnumTarget serializes `field`, `target`, `value`) |

An instance's `props` and a `set` override are structs (their keys are node property names).

## Appendix C — reference implementation map

| Concern | `@kimo/core-schema` export |
|---|---|
| Schemas and static types | `KimoDocument`, `Node`, `FrameNode`, …, `Variable`, `Paint`, `Size`, … (TypeBox; `Static<>` types of the same names) |
| JSON Schema | `buildJsonSchema()`, `schema/kimo-1.0.schema.json` (`schema/kimo-0.1.schema.json` is the frozen 0.1 schema) (`bun run build:schema`; `check:generated` fails when stale) |
| Validation | `validate(doc, { libraries, assetFiles, supportedFeatures, lints })`, `ISSUE_CODES` |
| Defaults | `DEFAULTS`, `applyDefaults`, `stripDefaults` |
| Serialization | `serialize`, `parse`, `canonicalize`, `isCanonical`, `KEY_ORDER`, `parseJson`, `KimoParseError` |
| Versioning | `FORMAT_VERSION`, `SCHEMA_URL`, `formatStatus`, `MIGRATIONS` (`MIGRATE_0_1_TO_1_0`), `migrate`, `openDocument` |
| Resolution (§10.4) | `effectiveTheme`, `defaultTheme`, `resolveVariable`, `selectThemedValue`, `defaultTextFill` |
| Tree | `buildTree`, `compareSiblings` |
| Pages (§5.6) | `listPages`, `pageOfRoot`, `isOnPage`, `rootsByPage`, `DEFAULT_PAGE_NAME` |
| Components (§9) | `locate`, `derivedChain`, `baseRoot`, `resolveIdPath`, `declaredProps`, `argEffect`, `instancesOf`, `localComponents`, `COMPONENT_DESCRIPTION_META_KEY` |
| Expansion (§9.8) | `createExpandedView`, `documentLookup`, `virtualId`, `parseVirtualId`, `qualifyNodeData` |
| Merge conflicts (§21) | `Conflict`, `MergeInfo`, `listConflicts`, `conflictCounts`, `applyConflictSide`, `applyAllConflicts`, `markConflictEdited`, `finishMerge`, `attachConflicts`, `conflictMatchesBody`, `ThreeWayMerge` (contract), `MERGE_EXIT` |
| Edit planners (M3) | `plan*` (components, instances, overrides, props, slots, variables, themes, pins, imports), `applyPlan`, `libraryUsage` |
