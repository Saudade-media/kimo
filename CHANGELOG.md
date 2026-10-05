# Changelog

All notable changes to Kimo are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Kimo uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) for the app, the CLI and the packages
(one version for all of them, bumped by `scripts/version.ts`).

The `.kimo` **file format** has its own version (`format` in every document, spec in
`docs/spec/`). It stayed `0.1.x` through the 0.x releases and is frozen as format 1.0 for the 1.0
release; format changes are listed under **Format** in each entry.

Versions 0.1.0 to 0.7.0 are the development milestones M0–M7. They were not tagged or published;
the dates are those of the milestone commits.

## [Unreleased]

## [1.0.0] - 2026-10-04

The first public release: release engineering, polish, the new mark and the format 1.0 freeze.

### Added

- CI split into `check` (lint, typecheck, generated files, unit tests, examples, web build),
  browser e2e in Chromium with one retry and a flaky/infra report in the job summary, and the
  exporters' box-diff harness; `rust` runs rustfmt, clippy (`-D warnings`) and the test suites on
  macOS, Windows and Linux.
- Release workflow for `v*` tags: the kimo-mcp shim is built per target (a universal binary on
  macOS) and bundled as a sidecar; installers for macOS (universal `.app`/`.dmg`), Windows
  (MSI and NSIS) and Linux (AppImage and `.deb`); signing, notarization and updater signing from
  repository secrets (each optional); a draft GitHub release with the updater manifest
  (`latest.json`, copied to `latest-stable.json` for the stable channel), the static web app and
  a dry run of the `@kimo/cli` package. Nothing is published automatically.
- `examples/`: a landing page, mobile screens, a themed dashboard (mode × density), a design
  system library and a document that imports it, and a three-way merge demo — generated from
  typed ops by `scripts/build-examples.ts`, checked in CI with `kimo validate --strict`, with
  headless-rendered thumbnails.
- `scripts/version.ts`: one version across every workspace package, `tauri.conf.json`, both
  crates (and `Cargo.lock`) and the CLI's version strings; dry run by default.
- `docs/release.md`: the release checklist (version bump, spec freeze, signing, notarization,
  updater keys, smoke tests including real agents). `scripts/version.ts --exclude <dir>` leaves
  a workspace out of a bump.
- New mark (board 26, "Bloom with pucker"): `KimoLogo` (one even-odd path, 0–100 viewBox,
  `currentColor`; the `KimoLogo/Small` cut is picked automatically at ≤ 24 px) and `KimoLockup`
  in `@kimo/ui`. It replaces every old "k" mark: the web and desktop topbars, both Home sidebars
  (lockup) and Settings › About (the app icon: ink plate + white mark). The desktop icon set
  (`.icns`, `.ico`, PNGs, `source.svg`), the web favicons, apple-touch icon and web manifest, the
  social card and the README header are exported from the design's icon masters.
- PDF export with *Embed fonts* embeds the TrueType/OpenType faces the canvas renders with
  (WOFF/WOFF 2 faces fall back to Helvetica with a `FONT_MISSING` issue).
- Cloud providers on desktop: the credential choice reaches the relay. Bedrock can use
  environment variables, a named profile (static keys or AWS SSO, with the profile's region) or
  SSO only; Vertex a saved service account or Application Default Credentials; Foundry an API
  key or Entra ID through the Azure CLI. Missing credentials come back as a 401 that says what to
  do.

- Board 27 completeness pass:
  - Pages (strip in the Layers tab, ⌘P switcher; MCP `select.page` and a `page` op).
  - System clipboard copy, cut, paste and paste in place, across files.
  - Real groups, ungroup, wrap in frame, add/remove auto layout.
  - Layer drag to reorder and reparent; drawing and dragging into auto layout.
  - PNG/JPEG drop and paste.
  - View menu and Settings › Canvas: snapping, pixel grid, rulers, nudge.
  - Shape slot with Line, Arrow, Polygon and Star; path-edit toolbar.
  - Clip content, flip, wrap row gap, per-paint blend, image crop, SVG outline strokes.
  - Variable binding on every bindable field, including library variables.
  - Components: enum targets, replace main with selection, fix broken overrides, ⌘D / ⌥-drag on
    a main asks, relative library paths, a copied main pastes as an instance.
  - Preview overlay (⇧Space).
  - Agent: default provider and model, per-turn cost warning, the active page in context.
  - Export: an Issues tab, a Tailwind theme option, File › Export… (⇧⌘E), Copy selection as PNG
    (⇧⌘C).
- Google fonts a file uses are stored in its `assets/` folder by content hash on first use and
  listed in the manifest (`font/*`, name `<Family>-<Style>.<ext>`) when the file is saved, so the
  file renders offline, in CI, in the `kimo` CLI and in headless render and export. The open
  document is never edited for it (no undo step, opening a file never makes it dirty); files over
  20 MB are skipped (board 28).
- Offline font pack (Settings › Fonts & privacy): 16 curated Google families, 400–700, downloaded
  once on request (desktop app data dir `font-pack`, browser Cache Storage), with progress,
  Cancel and Remove; resolved after installed fonts and before the cache.
- The Missing fonts dialog explains when No third-party fetch (or Google Fonts off) blocks
  Google, with Open settings.
- The Code tab follows the Export dialog's Tailwind theme and Map variables choices.

### Changed

- ⇧⌘V is Paste in place; the Variables dialog moved to ⌥⇧⌘V.
- The image size limit is 20 MB (was 50 MB).
- Docs:
  - Kimo collects no telemetry (SECURITY.md, teardown).
  - Links use kimo.design.
  - ADR 0014: agent sessions are stored in IndexedDB on every platform.

### Fixed

- Per-corner radii render; bound per-side stroke widths and padding entries resolve in the
  renderer, the exporters and the panel.
- The agent's approval card names the layers it touches ("in Pricing") instead of their ids.
- The web build reports its real version in Settings › About and the release-notes link.

### Format

- **`.kimo` format 1.0.0 (stable).** Format 1.0 is format 0.1 declared stable plus five additive
  fields; no existing field, default, node type or feature changed, every 0.1 document is a valid
  1.0 document, and it stays backward compatible within 1.x (spec §16.4).
- Additions in 1.0: root `pages` (page id → `{order, name}`) with a root-only `page` placement
  (§5.6; lints `PAGE_UNKNOWN`, `PAGE_NOT_ROOT`); polygon `star: {ratio}` (§5.5); image paint
  `fit: "crop"` using the existing `crop` transform (§7.1); enum component props with per-option
  `targets` (§9.6, `PROP_TARGET_INVALID`).
  Documents are written with `"format": "1.0.0"` and
  `"$schema": "https://kimo.design/schema/kimo-1.0.json"`.
- Spec: `docs/spec/kimo-format-1.0.md` (status *Stable*). The open draft items are decided: mesh
  `points` and the shader protocol stay opaque (stored and round-tripped, rendering optional),
  library-of-library references stay unresolved, and lints are not part of the format
  (§20 row 29). `docs/spec/kimo-format-v0.1.md` is kept as a historical record.
- Migration `0.1 → 1.0` (`MIGRATE_0_1_TO_1_0`, the first entry of `MIGRATIONS`): identity on the
  content, rewrites the `format` and `$schema` header lines only. A 0.1 file opens migrated in
  memory behind the existing upgrade-consent prompt (autosave goes to recovery until *Upgrade and
  save* or an explicit save); files newer than 1.0 (`1.1.x`, `2.x`) open read-only. Fixtures:
  `fixtures/migrations/`, `fixtures/forward/` moved to 1.1 / 2.0 / 1.0.7.
- JSON Schema: `schema/kimo-1.0.schema.json` (`@kimo/core-schema/schema.json`); the frozen 0.1
  schema stays at `schema/kimo-0.1.schema.json` (`@kimo/core-schema/schema-0.1.json`). The MCP
  schema resource is now `kimo://schema/1.0`; `kimo version` reports `(format 1.0)`.
- `examples/` regenerated at format 1.0.0 (header lines only; thumbnails unchanged).
- Font manifest entries are no longer linted `ASSET_UNUSED` (they are used by family); §12 rule 3
  defines the `<Family>-<Style>.<ext>` manifest name readers use for WOFF2 fonts. No schema
  change.

## [0.7.0] - 2026-10-04 — M7: Export

### Added

- `@kimo/exporters`: an intermediate representation built from the expanded view (resolved
  values that keep their variable references, CSS-ready layout and sizing, text runs with
  explicit metrics, component references with typed props).
- Emitters: React + Tailwind v4 (typed props from declared component props), HTML/CSS with
  multi-axis theme selectors, design tokens as DTCG, CSS variables and Tailwind `@theme`, SVG,
  and deterministic PDF from a layout pass; PNG through the renderer.
- Export dialog (board 07): desktop writes without overwriting, a zip on the web; MCP
  `kimo_export` for code and token targets; `kimo_render` as SVG and MCP SVG/PDF exports measured
  with the canvas text measurer and real fonts.
- Box-diff harness in headless Chromium (exact non-text geometry, text within tolerance, color
  readback); goldens for 15 fixtures; a determinism test; a strict TypeScript compile of the
  generated React. ADR 0015.

### Fixed

- Layout: dimension variables resolve; free space is redistributed CSS-style after min/max
  clamps.

## [0.6.0] - 2026-10-04 — M6: Built-in agent

### Added

- `@kimo/ai-agent`: a provider interface with Anthropic (default API), OpenAI-compatible, Gemini,
  OpenRouter, custom/Ollama, and Bedrock/Vertex/Foundry through the desktop relay; local CLI
  providers (Claude Code by default when signed in, Codex, Gemini CLI) that edit through Kimo's
  MCP server. ADR 0014.
- Agent loop with retries, cancellation, op groups and regenerate; skills (`~/.kimo/skills` on
  desktop, path-confined); sessions; side-by-side, split and iterate modes with per-op scope
  enforcement.
- In-app agents run on the desktop document host with `agent:kimo` origins, window scope
  checks, approvals forwarded to the in-thread card, and presence and activity next to MCP
  clients.
- Desktop: provider keys in the OS keychain, a streaming provider relay with key injection, a
  sandboxed CLI host.
- UI (boards 21–24): AgentMark (shared WebGL, six personas), the Agent tab (streaming, steps,
  costs, sessions, model picker, skills, attachments, modes), AI provider settings, the Home
  composer hand-off, notes and prompt nodes, placeholders, scope outlines, persona cursors.
- Board 24 gaps: link popover, custom OpenType tags, untitled close prompt, SVG rejection
  details, missing-weight warning, conflict `+N` menu, tab titles, banner order.

### Changed

- `kimo mcp install` writes Codex's `default_tools_approval_mode` only with `--auto-approve`;
  a Codex spawned by Kimo keeps it on its own command line.

### Format

- `note` and `prompt` nodes (`model` as `{provider, model}`), `placeholder` with owner origin.

## [0.5.0] - 2026-10-04 — M5: MCP server

### Added

- `@kimo/mcp-server`: 20 typed tools with strict portable schemas, a result envelope, typed ops
  with `@key` references, revisions, dry runs and per-client undo; conformance tests including
  no-overwrite. ADR 0013.
- Desktop: a socket relay (`kimo-socket/1`: token, heartbeat), optional localhost HTTP, a hidden
  document host synced with the windows, and the `kimo-mcp` stdio shim bundled in the app
  (offline tool list, reconnect, `--launch`).
- CLI: `kimo mcp` (attach to the app, or headless on files) and `kimo mcp install | remove |
  status` for Claude Code, Codex, Gemini CLI, Cursor and VS Code; MIT-licensed agent guides.
- Per-client permissions, approvals with a dry-run preview, pause/resume, an activity log and
  presence; UI from board 21 (presence chip, session review, approval prompt, canvas
  attribution, Activity tab, Settings › Agents & MCP, Text … menu).
- Layers: auto layout frames show a direction icon (columns, rows, or grid for wrap).

## [0.4.0] - 2026-10-03 — M4: Desktop app and files

### Added

- Desktop app (Tauri v2): all platform commands in Rust — atomic save with read-back, file
  watching, single-writer leases, crash recovery, git operation detection and merge-driver
  install, local fonts and a font cache, updater, macOS overlay title bar, settings window,
  `.kimo` file association, `kimo://` deep links, single instance. ADR 0012.
- `@kimo/platform` with desktop, browser and memory implementations.
- Files: 2 s autosave, recovery snapshots, save-failure retry, upgrade consent, reload or
  three-way merge on external change, pause during git operations; session manager, save
  status, banners (save failure > stored conflicts > git operation > lock/read-only > info),
  recovery and migration dialogs, failed-load view, desktop home with folders and recent files.
- Stored merge conflicts and the Conflicts panel with layer and canvas markers.
- `@kimo/cli`: `kimo merge` (semantic git merge driver), `kimo gc`, `kimo validate`.
- Fonts from the document, the system, the cache or Google (with a no-third-party-fetch
  setting), missing-font handling, asset clean-up, safe SVG import, update toasts.
- Board 20: file menu, text section (font, weight, size, line height, letter spacing,
  alignment, resizing, decoration, case), macOS app menu, Windows/Linux title bar.

### Format

- Stored merge conflicts: root `merge` and `conflicts` (feature `merge/conflicts`, spec §21).

## [0.3.0] - 2026-10-03 — M3: Components, variables and themes

### Added

- Components, instances (all override kinds, `args`, slots, derived components) and linked
  libraries with namespaced ids; pure edit planners for every component command, applied as
  single validated, invertible transactions. ADR 0011.
- Variables and multi-axis themes (aliases, partial `when`), theme pins, OKLCH and Display-P3
  colors.
- UI: layer rows for components, instances and slots; the Assets tab; library link, change
  notice, missing and unlink states; instance and main-component panels; props and slots; the
  Variables tab and dialog.

### Changed

- Performance pass: drawing in the same frame as the layout flush, scoped validation for
  non-structural edits, in-place instance patching, color-only variable edits without relayout,
  a multi-scale raster cache (every perf gate passes at p95).
- e2e: production-build harness, a browser per file, scenario timeouts, one retry reported as
  flaky; the Playwright driver runs under Node.

### Format

- Prop `order`, root prop targets, `kimo.component.description` and `kimo.themes.order` meta
  keys, normative instance expansion (spec §9.8).

## [0.2.0] - 2026-10-02 — M2: Styling and canvas tools

### Added

- Renderer: dashed and per-side strokes, caps and joins, every blend mode, linear/radial/angular
  gradients, image fills, shadows with spread, layer and background blur, paths, lazily loaded
  icon sets (Lucide, Phosphor, Material, Feather). ADR 0010.
- Layout: wrap, individual padding, distribution, absolute positioning.
- UI: color picker (HEX/RGB/HSL/OKLCH and variables), gradient editor, blend menu, icon picker,
  image fills, the styling panel (board 08), snapping, equal spacing, measurements, pixel grid,
  pen tool and path editing.
- `.kimoz` packages for designs with images.

### Format

- Layer `blend` (including `pass-through`), effect visibility, stroke `miterLimit`, icon
  `strokeWidth` and `weight`.

## [0.1.0] - 2026-10-02 — M0 + M1: Foundations and canvas MVP

### Added

- Monorepo (bun workspaces, Biome, TypeScript), the `.kimo` v0.1 format: TypeBox schema →
  JSON Schema, validator, canonical serializer, migrations, spec draft. ADRs 0001–0008.
- `@kimo/editor-state`: a Yjs-backed document store with validated ops, revisions, per-origin
  undo and cycle repair; `@kimo/sync` memory, file and IndexedDB providers.
- `@kimo/design-tokens` and `@kimo/ui`, generated from and built 1:1 with `desing.pen`.
- `@kimo/layout` (Yoga: fit/fill/fixed, gap, padding, alignment, absolute, text measurement,
  incremental updates) and `@kimo/renderer` (CanvasKit, WebGL and headless raster: shapes,
  Paragraph text with bundled Inter and JetBrains Mono, fills, strokes, effects, clipping,
  overlays, hit testing, a zoomed-out raster cache). ADRs 0004, 0009.
- The web editor: layers, canvas, properties, floating toolbar, home; select, marquee, move,
  resize, draw, text, pan and zoom; per-gesture undo; IndexedDB autosave; `.kimo` open and save.
- e2e scenarios and a perf gate (5k nodes, pan and zoom at 60 fps).

