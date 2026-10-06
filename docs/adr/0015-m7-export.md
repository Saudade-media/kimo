# 0015. M7 export: one IR, deterministic emitters, and a browser box-diff harness

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** maintainers (M7)
- **Teardown refs:** 3.5 (code, import, export), 8.1 principle 7 (deterministic over prompted) and 8 (code export laid out by the browser), 9.1 (`packages/exporters`, dependency rule), 9.2 (Code export row: IR + emitters, Tailwind v4 `@theme`, DTCG JSON; SVG from an IR emitter; PDF via a JS library; PNG via the renderer), 12 (M7 row and exit criteria)
- **Builds on:** [0004](0004-renderer-canvaskit-layout-yoga.md) (Yoga layout, CanvasKit text), [0009](0009-m1-render-pipeline.md) (`exportRaster`), [0011](0011-m3-components-and-variables.md) (`createExpandedView`, composite ids, declared props, §10.4 resolver), [0013](0013-m5-mcp-server.md) (`kimo_export` targets), format spec §5–§10
- **Design:** `desing.pen` board 07 "Export Dialog" (`AsO2h`): formats React + Tailwind / HTML + CSS / Design tokens / SVG · PNG; options "Variables as CSS custom properties", "Split instances into components", "Keep layer names as data attributes", output folder; file tabs `Hero.tsx`, `Button.tsx`, `tokens.css`

## Context

pen.dev exports HTML natively and leaves everything else to prompts; Kimo commits to
deterministic exporters (principle 7): React + Tailwind v4 with typed component props, HTML/CSS,
W3C DTCG tokens with CSS variables and a Tailwind `@theme`, SVG, PNG and PDF. The M7 exit
criteria are golden output tests and a comparison of exported pages with the canvas: exact boxes
for non-text geometry, a tolerance for text (browser line breaking, font fallback and hinting
differ from CanvasKit Paragraph), and a corpus of wrap-edge fixtures.

Forces: every emitter must agree on the same reading of the document (instances, overrides,
themes, sizing), the output must be stable byte for byte, the package must run in Bun, Node,
browsers and workers (9.1), and the browser — not Yoga — lays out exported code, so the CSS must
restate the canvas layout model rather than approximate it.

## Decision

A new package **`@kimo/exporters`** (runtime-neutral, no DOM/Node APIs in `src`) turns a document
into an **IR**, and **emitters** turn the IR into files. Dependencies: `@kimo/core-schema`,
`@kimo/layout`, `pdf-lib` and `@pdf-lib/fontkit` (both MIT; the only new runtime dependencies).
`@kimo/renderer` is a dev dependency only: PNG and icons go through structural interfaces
(`RasterSource`, `IconLoader`), so the package never loads CanvasKit itself.

### IR (`buildIR(doc, options) → IRDocument`)

- **Reading.** Instances through `createExpandedView` (same composite ids `<instance>/<IdPath>` as
  layout and renderer, so a `LayoutResult` lines up with the IR). Notes and prompts are skipped,
  hidden nodes are dropped (kept only as boolean-prop targets inside components).
- **Values.** Every bindable value is resolved under the node's effective theme (§10.4) and keeps
  its binding: `IRNum { v, ref? }`, `IRColor { css, rgba, ref?, alpha? }` — `css` is the original
  space (`#hex`, `oklch()`, `color(display-p3 …)`), `rgba` is gamut-mapped sRGB for SVG/PDF (the
  renderer's algorithm, kept equal by a test). `dimension` tokens read as px numbers.
- **Layout as CSS terms.** `placement` per node: `root`, `flow` (dir, index, `lead` = a negative
  gap as margin), `absolute` (x/y), or `stack` (a frame without layout whose size fits its
  content: children share one grid cell at margin x/y so the browser computes the fit; rotated
  children add their rotated bounds' reach as margin). `w`/`h` per axis: `fixed`, `fit` (+min/max),
  `fill` (main: grow by weight; cross: stretch). Restated from `@kimo/layout`'s `sizeSpec`/
  `applyStyle`: fill outside a flow uses its fallback, `fit` with a fallback and nothing to fit is
  the fallback (exact, static — never `min-width`), groups get their children's static bounds
  (or the bounds from an optional `layout` hint when they contain text).
- **Paint.** Visible fills bottom to top, stroke (uniform or per side, align, cap, join, miter
  limit, dash), radius, opacity, layer blend, `isolate` (a descendant blends non-normally), clip,
  shadows, layer and background blur. Text: runs with family/size/weight/italic, explicit line
  height (`normal` | multiplier | px), letter spacing, decoration, case, OpenType features, wrap
  mode (`grow`), valign; text fills follow §8.3. Shapes keep their geometry; icons keep set/name/
  weight/stroke width/color. Images are asset references.
- **Components** (`components: true`). Each instance gets an `IRInstanceRef`: its declared-prop
  args (the instance's `args`, plus `set` overrides equal to a declared text/boolean/instance/enum
  prop), slot content per slot prop, and `needsInline` with stable reasons when it changes
  anything no declared prop expresses (`set` on a non-prop field, `replace`, root `props` other
  than `w`/`h`, overrides from an outer instance). Components are built from **synthetic
  instances** (`KimoExport000001…`, never written) so local, library and derived components are
  expanded by the same code; each enum option is another synthetic instance with that arg.
- **Tokens.** All document variables plus the library variables in use, with their themed
  entries (consumer-qualified `when` keys), default-theme value and usage (`color`, `spacing`,
  `radius`, `text`, `font`, `font-weight`, `tracking`, `leading`, `blur`), which picks Tailwind
  namespaces. Axes include loaded libraries' (`ui:mode` → `data-ui-mode`).

### CSS model (shared by HTML and React)

`box-sizing: border-box`, no margins or borders (a reset). Frames with layout are flex
containers (`align-content: flex-start` when wrapping, as Yoga). Non-fill flow items never shrink
(`flex-shrink: 0`); fill items grow by weight with `flex-basis: 0` (spec §6.1: the main axis is
shared from a zero basis, content ignored, as pen.dev/Figma) — `flex-basis: auto` when the parent
hugs that axis or wraps — and `min-width/height: 0` (Yoga has no automatic minimum). CSS floors a
basis at the item's padding, so when fill siblings are padded each gets `flex-basis: weight × k`
px (k = the largest main-axis padding / weight among them), which ends at the same equal outer
split as the canvas. Residual: k is computed at export time, so a padding bound to a themed
variable that changes at runtime (`data-*` theme switch) no longer balances exactly. Out-of-flow boxes and auto text are `width: max-content` (the canvas lays
them out unconstrained). Strokes never take space: uniform strokes are an `outline` with
`outline-offset` −w / −w/2 / 0 (painted over the content and not clipped by the node's own
`overflow`, as on the canvas); per-side widths are an `::after` overlay. Transforms use
`transform-origin: 0 0` and `rotate(-θ)` (spec rotation is counter-clockwise), flips about the
center. Linear gradients are exact for any box: the canvas gradient lives in the normalized box,
so the CSS angle is the normal of the scaled isolines and the stops are the projections of the
gradient's end points. Layer blur `r` is `blur(r/2)` (spec §7.3: σ = r/2). Text gets explicit
`line-height`, `font-feature-settings`, and wrap hints (`white-space: pre` for auto text,
`pre-wrap` + `overflow-wrap: break-word` otherwise; `align-content` for valign).

**Variables in CSS.** Number variables are unitless and used as `calc(var(--x) * 1px)`; colors
as `var(--x)`; strings and booleans are written resolved. `:root` holds the default theme.
Elements that pin a theme (and exported roots) carry `data-kimo-theme` plus their **full**
effective theme as `data-<axis>` attributes; on them every themed or aliasing variable is reset
to its fallback entry, then one zero-specificity `:where([data-a="x"][data-b="y"])` rule per
entry applies in list order — so partial `when`, "last matching entry wins", fallbacks and
alias re-resolution all hold with plain CSS inheritance.

### Emitters

| Target (`kimo_export`) | API | Output |
|---|---|---|
| `html-css` | `emitHtml(ir, { variables, layerNames, ids, icons, classPrefix, extraCss })` | `index.html` (semantic-ish tags: roots `section`, text `p`/`a`, vectors inline `svg`, `meta["kimo.export.tag"]` overrides), `styles.css` (one `.k-<key>` class per node, document order), `tokens.css` |
| `react-tailwind` | `emitReact(ir, { variables, components, layerNames, ids, icons })` | `<Root>.tsx` pages, `<Component>.tsx` per component, `tokens.css` (CSS variables + `@theme inline`) |
| `tokens-dtcg` / `tokens-css` / `tailwind-theme` | `emitDtcg`, `emitTokensCss`, `emitTailwindTheme` | DTCG 2025.10 JSON (path = `group` then name; aliases as `{a.b}`; themes in `$extensions["kimo.themes"]`; token/group collisions use `$root`), CSS variables, `@theme inline` |
| `svg` | `emitSvg(ir, { layout, measureText, icons })` | one SVG per root from the IR + a layout pass |
| `pdf` | `emitPdf(ir, { layout, measureText, icons, fonts, assets })` | one page per root (pdf-lib) |
| `png` | `emitPng(ir, { raster, scale })` | `<root>@<scale>x.png` via the renderer's `exportRaster` |

`exportDocument(doc, target, options)` wires them (board 07 options: `variables`, `components`,
`layerNames`; the output folder and overwrite policy stay with the host, e.g. `kimo_export`);
`layoutDocument` runs `@kimo/layout` with the same expanded ids; `loadIcons` turns an
`IconProvider` into a synchronous lookup.

**React specifics.** Typed props only for declared props (§9.6): text → `string` (default: the
declared default, else the authored text), boolean → `boolean` (conditional render — hidden nodes
take no space), enum → a union of option names whose per-option utility strings are computed
from the option's expansion, instance → `ReactNode` (default: the authored instance), slot →
`children` when the component has one slot, else a named `ReactNode` prop (authored content is
the fallback). Every component takes `className` (its placement and size: where it sits is the
caller's; the authored size is the default) and passes `data-*` theme attributes to its root.
Instances with `needsInline` are emitted expanded. Utilities use theme tokens where a value is
bound and exposed (`bg-surface`, `gap-x-space-m`), keyword utilities where exact, arbitrary values
or arbitrary properties otherwise — never a rounded "nearest" utility.

**Determinism.** No timestamps, no random ids (pdf-lib's random resource suffixes are replaced
by a counter; no metadata dates; no object streams), records sorted by code unit, names handed
out in document order (`NameRegistry`), fixed formatting without a formatter.

### Verification

- **Goldens:** every target for every fixture (core-schema valid fixtures + export fixtures
  `layout-matrix`, `wrap-edge`, `text-styles`, `paints-effects`) in `test/golden/<fixture>/…`,
  byte-compared (`UPDATE_GOLDENS=1`); SVG/PDF use a deterministic fake measurer. A test
  type-checks every generated `.tsx` with strict TypeScript and the React 19 types. A
  determinism test re-runs every target.
- **Box diff** (`harness/boxdiff.ts`, `bun run verify`, and `test/boxdiff.test.ts` when
  Playwright's Chromium is installed): the HTML export is rendered in headless Chromium with the
  renderer's bundled fonts. Pass **A** lays the document out with a `TextMeasurer` answered by
  Chromium (iterated to a fixed point), so every box must match **exactly** (≤ 1/64 px). Pass
  **B** uses CanvasKit Paragraph; nodes whose box is the same in A and B are text-independent and
  checked exactly, the others within max(2 px, 4 %), and Paragraph-vs-Chromium line-count
  differences are reported. Solid fills and text colors are read back from Chromium and compared
  with the IR's resolved colors (this checks the theme cascade, library axes and aliases).
  Differences that are not exporter bugs are listed with a reason (`KNOWN_DIFFS`).

## Consequences

- One reading of the document for every format; adding a target means writing an emitter.
- The exported HTML reproduces canvas geometry exactly; the harness turns that into a test.
- Gaps (documented, reported as `ExportIssue`s): SVG has no conic gradient (mean color), no inner
  shadow, no background blur, no shadow spread; PDF draws gradients as their mean color and drops
  effects and blend modes, outside strokes are centered; CSS strokes use the last solid paint
  (gradient strokes approximate), dashes use the browser's `dashed` pattern, an outside per-side
  stroke on a clipping frame is clipped; image `crop`/`tile` are approximated outside the canvas;
  angular gradients are exact only for square boxes and rotated radials are not rotated in CSS;
  mesh and shader paints are not exported; composite `shadow`/`typography` bindings are written
  resolved in node CSS (they are exported as tokens); themed colors inside inline SVG fills other
  than the single `currentColor` are literal; the React output is verified by goldens and the
  type check, not rendered (no Tailwind compiler in the repo).
- Findings outside this package: `@kimo/layout` reads a `dimension`-bound `gap` (and other
  dimension-bound lengths) as 0, and Yoga does not redistribute free space after a `min` clamp —
  both differ from the spec/CSS (`features-all` known diff). Fixed in the M7 integration: the
  layout resolver reads `dimension` values as px, and fill items with main-axis min/max are
  resolved as CSS §9.7 does (bounds out of Yoga, violators frozen per line, Yoga's own result
  kept for a wrapping container whose lines would move); the known diff is gone. `kimo_export`
  implements its code/token targets with `exportDocument`.

## Alternatives considered

- **Emit from the node table directly, per format.** Rejected: five readings of instances,
  overrides and themes would drift; the IR is the single place that encodes them.
- **Absolute positioning everywhere (bake Yoga's boxes).** Exact but not code anyone keeps, and
  it breaks as soon as content changes; the flex model with exact restated sizing is both
  editable and exact, and the harness proves it.
- **Resolve every variable to literals.** Simpler, but loses theming; kept as an option
  (`variables: false`).
- **SVG/PDF through a custom CanvasKit build (SkSVG/SkPDF).** Rejected in 9.2 (maintenance);
  pdf-lib + our own SVG emitter keep the package small and runtime-neutral.
- **Tailwind's nearest scale values (`p-4` for 15 px).** Rejected: exported values must be exact.

## Revisit when

- Tailwind (or another CSS compiler) is in the repo: render the React output in the harness too.
- Variant sets (v1.x) land: map variant axes onto enum props.
