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

### Fixed

- Component instances an agent adds draw in full. Before, some stayed nearly invisible after
  their grow-in animation, until the file was reopened.
- Layers an agent adds while the Kimo window is in the background appear without the grow-in.
- The `kimo-mcp` shim exits when its agent session ends, even while the Kimo app is not
  responding. Before, it waited until the app read from it again.
- In a room joined from a share link, an agent's edits show who made them, and with Ask before
  changes on its requests wait in the room's tab. Before, they failed after 2 minutes.
- An agent's edit to a read-only file or a view link's room fails at once. Before, it asked for
  approval first.

## [1.2.1-beta.1] - 2026-10-29

Kimo Cloud workspaces, for installs on the Beta channel.

### Added

- Kimo Cloud workspaces. A plan belongs to a workspace, and its members open and edit every file
  in it. Each member is a seat: $8 a month for the first, then $4 for each extra member. Viewers
  stay free and need no account.
- Invite people by email, and approve edit requests from people who opened a view link.
- Several workspaces per account, with a picker when you share and a Kimo Cloud group on Home.
- Transfer a workspace to an Admin, delete a workspace, or leave one.
- Files shared on Kimo Cloud before workspaces move into your workspace on their own.

### Changed

- Kimo Cloud keeps each workspace file's keys, so opening is instant on any signed-in device and
  removing someone takes effect at once. Kimo Cloud is no longer described as end-to-end
  encrypted; self-hosted relays still are.
- Shorter wording across the app.

## [1.2.1-beta.0] - 2026-10-28

The first beta: the fixes below, for installs on the Beta channel.

### Fixed

- A guest opening a share link sees the shared images right away. Before, they kept showing
  placeholders until the guest reloaded the page.
- The Beta update channel works. Its update feed was never published, so checking for updates
  on Beta failed. Installs of 1.2.0 or earlier set to Beta update to the next stable release
  and get betas from then on.

## [1.2.0] - 2026-10-28

### Fixed

- Image placeholders on a shared canvas (fetching, waiting, sharing) stay inside the layer they
  cover: clipping frames cut them like the image, and the status chip shrinks on small images
  and hides on tiny ones instead of spilling out.
- The canvas overlays (image placeholders, cursors, claims, agent markers) no longer draw over
  the left and right cards.
- The model chooser and the other composer menus are no longer cut off by the right card.
- Starting to share creates one view link and one edit link. Starting again, or clicking Start
  sharing several times while it works, reuses them instead of creating a new pair each time.

## [1.1.0] - 2026-10-28

### Added

- Paste from Figma: copy layers in Figma and paste them into Kimo as editable layers, on the
  desktop app and the web. Frames, auto layout (direction, gap, padding, alignment, hug and fill
  sizing), shapes, vectors, text with mixed styles and lists, fills, gradients, strokes, corner
  radii, shadows and blurs carry over. Component instances paste as frames. The copy's images are
  downloaded from Figma and stored in the file; anything Kimo can't carry over is listed in a toast.

### Fixed

- Opening a `.pen` file whose images use plain relative paths (`images/photo.jpg`) loads the
  images instead of showing placeholders. Reopening a `.pen` converted before this fix relinks
  the images it missed.

## [1.0.1] - 2026-10-27

### Fixed

- Share links from Kimo Cloud use the relay Kimo Cloud names today (`relay.getkimo.design`)
  instead of a relay URL saved before it moved, which put the old host in every link.
- Popovers, menus and tooltips opened from the side cards (Share, sync status, lock details,
  agent presence and approval) float above both cards instead of slipping under the other one.
- The right card keeps the same 280 width on every tab, so its header (avatars, Sharing, Zoom)
  no longer squeezes together on the Page card.

## [1.0.0] - 2026-10-26

The first public release: release engineering, polish, the new mark and the format 1.0 freeze.

### Added

- Multiplayer (ADR 0016, `docs/spec/multiplayer.md`): share a file with a link and edit it
  together live. Content is end-to-end encrypted: the relay stores only ciphertext and the room key
  lives in the link fragment. Edit and View links are signed capabilities with expiry and
  revocation; guests need no account. Presence shows cursors, selections and avatars, canvas text
  merges character by character with remote carets, and agents take soft area claims so they
  pause around a human's edits.
- The relay (`apps/server`, image `ghcr.io/saudade-media/kimo-relay`) is self-hosted: This
  computer, Docker, Fly.io or the Railway template, set up from the relay wizard in the Share
  popover or Settings › Multiplayer.
- Relays belong to devices (ADR 0017): the first Kimo to use a fresh relay claims it, more
  devices join with a single-use pairing link, and `KIMO_OWNER_KEY` / `KIMO_RESET_OWNER` cover
  pre-claiming and recovery. An owner policy seam (ADR 0018) lets a hosted service decide who may
  create rooms.
- Kimo opens pen.dev `.pen` design files (plain JSON, schema 2.x): from Open file, Finder's
  Open With (registered as an alternate app, so pen.dev stays the default) or the command line.
  The first open converts the file into `<name>.kimo` beside it, with its images in `assets/`;
  reopening the same unchanged `.pen` reopens that `.kimo`, and an existing file is never
  replaced (`<name> 2.kimo`). The `.pen` is never written. In the browser a `.pen` imports into
  the library (only `https://` images can be fetched). Components, instances and overrides,
  slots, themed variables, auto layout, paints, effects, mesh gradients and shader fills carry
  over (`@kimo/core-schema` `importPen`).
- Mesh gradient and shader fills render on the canvas and in PNG export (pen.dev-compatible:
  Coons-patch mesh, GLSL ES 1.00 fragment shaders with `@resolution`/`@time` annotations,
  animated while visible, still under reduced motion). HTML/CSS/React approximate meshes with
  radial gradients, SVG/PDF use the mean color; shaders are reported as unsupported there.
- Composer bar and "…" menu for the built-in agent (board 40). The bar keeps Attach, the mode
  chip, a "…" button, the model chip and Send. **Skills** (with its count), **Ask before
  changes** and **Web access** moved into the "…" menu, which opens 232 px wide above the
  composer: Skills opens the skills menu, the two switches turn at once, and a blocked Web access
  row is disabled with the reason under it. A 6 px grey dot on "…" shows that web access is off.
  The menu has menu roles: opening
  focuses the first row, `↑`/`↓`/`Home`/`End` move, `Enter`/`Space` act, `Esc` closes and
  returns focus to "…". At the 360 px Agent panel the model name is never cut: the mode chip
  label shrinks first, and only a custom Local model id past 120 px gets an ellipsis (full name
  in the tooltip).

- Model chooser for the built-in agent (board 39), replacing the composer's model menu. It picks
  a provider, then a specific model, then the effort: **Recent** (the last two provider + model
  picks, saved in `ai.recentModels`, shown when 2+ providers are connected), provider chips (CLIs,
  then connected API providers; a signed-out CLI keeps its chip with a warning dot and offers
  **Sign in…**), the provider's models with at most one tag (Best, Fast, Local) and a detail line
  on hover ("1M context · 128K output · always thinks"), **Effort** (Low, Medium, High, Max; only
  the levels the model supports, hidden when none), and **Connect a provider…** (`⌘,`). A search
  field appears when a provider lists 9+ models and filters across providers. Keys: type to
  filter, `←`/`→` providers, `↑`/`↓`, `Enter`, `Tab` to Effort, `Esc`. The composer chip shows
  the model name only, after a 12 px provider mark (terminal, cloud, hard drive). CLIs now list
  specific models, each checked with a real one-message call: Claude Code `claude-opus-5-5`,
  `claude-sonnet-5-5`, `claude-haiku-4-5-20251001`, `claude-fable-5-1` (2.1.291); Codex
  `gpt-5.6-terra`, `gpt-5.6-luna` (0.146.0), after "Default (CLI decides)". Effort maps to
  `output_config.effort` (Opus, Sonnet, Fable), Haiku 4.5 thinking budgets (none, 4,096, 8,192,
  16,000), OpenAI `reasoning_effort` (low to high), Gemini 2.5 `thinkingBudget`, Claude Code
  `--effort` and Codex `model_reasoning_effort` (low, medium, high, max). Sessions saved with the
  old Off / Auto / Max open as Low / High / Max.

- Web access for the built-in agent (board 38), on by default. The agent can search the web and
  read pages when a task needs outside facts; the prompt tells it to use the web only then, never
  to paste page text into the design, and to end its reply with "Sources:" and plain links.
  **Settings › AI providers › Allow web access** (`ai.webAccess`, default on) sets it for new
  sessions; the Web access switch in the composer's "…" menu (board 40) turns it off or on for
  the current session only. **No third-party fetch** turns it off everywhere: the setting row is
  dimmed with its toggle off and disabled, and the menu row is disabled with the reason under it
  ("No third-party fetch is on"); a model without web tools gets
  "This model can't use the web". Each search and page read is a step and the status line
  ("Searching the web for “…”", "Reading example.com"), is saved in the session transcript
  (`TurnRecord.web`) and, on desktop, is an Activity row (kind `web`, tool `web_search` /
  `web_fetch`, the query or URL, no Undo). No approval is asked, and Ask before changes doesn't change it.
  Providers: Claude Code gets `--tools "WebSearch,WebFetch"` and both in `--allowedTools` (file,
  shell and edit tools stay off); Codex `-c web_search="live"` (`"disabled"` when off, and its
  ChatGPT apps are now off in every turn, since they carry their own web tool); Gemini CLI stops
  excluding `web_fetch` and allows `google_web_search`; the Anthropic API adds the
  `web_search` / `web_fetch` server tools (`_20260209` on Opus and Sonnet 4.6 and later, the basic
  versions on Haiku and Foundry, search only on Vertex, at most 5 uses each per request, fetched
  pages capped at 20,000 tokens) and bills searches at $10 per 1,000 in the cost estimate; OpenAI
  on the Responses API adds `web_search`. Gemini API, OpenRouter, custom endpoints, Bedrock and
  Chat Completions have no web tools in this release.
- File previews on Home (board 37 §9). Grid cards in Recents, All files, folders and Design
  systems, on desktop and on the web, show a 520 × 328 PNG of the file's first frame on its first
  page (or the union of that page's layers), cover-fit, in place of the placeholder sketch. The
  editor renders it with the renderer's raster export (`Renderer.exportThumbnail`) after a save
  (desktop) or an autosaved edit (browser library): debounced 1.5 s, at least 4 s apart, in an
  idle callback, skipped when the content hash matches the stored preview's. A render that runs
  past 5 s, or a page above 20,000 layers, keeps the old preview. The desktop app keeps previews
  in `~/.kimo/thumbs` (`<sha256(path)>.png` and `.json`, `platform.thumbnails`); the browser
  keeps them in the IndexedDB database `kimo-thumbs`. Rename moves a preview, Duplicate copies
  it, Delete forever and Empty trash drop it. A file made from a template starts with the
  template's cover until its first save. List rows keep the icon tile.
- Streamed agent edits. Layers appear on the canvas while the agent is still writing an edit:
  each op of a `kimo_apply_ops` call lands as soon as the model has written it, the status reads
  "Adding <layer>…" and the agent's pointer follows the last layer added. When the call arrives
  it commits everything as one undo step with the usual result; if it differs, fails, needs an
  approval that is refused, or the agent is stopped, the streamed layers are removed again
  (collaborators may see them appear and vanish). Works for the built-in agent with every API
  provider (Anthropic, OpenAI-compatible, Gemini) and for Claude Code in the desktop app, whose
  partial tool input the window forwards to the document host and whose call is matched by
  `_meta["claudecode/toolUseId"]`. Ops that need approval stop the streaming until the whole
  call is approved. Streamed calls may add up to 150 new layers (`STREAM_MAX_NEW_LAYERS`), a
  whole section per call; Codex, Gemini CLI and other MCP clients keep 40. Measured with Claude
  Code (Sonnet), 3 runs each: "add a testimonials section to the landing page" shows its first
  layer after 9.0 s instead of 13.9 s, "design a pricing page" after 8.7 s instead of 30.1 s.
- `kimo_script`: agents build with a short JavaScript program whose calls (`Insert`, `Update`,
  `Move`, `Delete`, `Copy`, `Instantiate`, `Op`, `Get`, `Children`, `Print`) compile to
  `kimo_apply_ops` ops, so loops and functions write repeated cards, rows and list items once.
  The ops take the normal path: validation, permissions and approvals (prompts show the
  compiled ops), node scopes, the batch limit, one undo step, `data.problems`, `render` and
  patch-retry (`edits` patch the code). Each top-level statement lands on the canvas as soon as
  the model has written it. Scripts run in a QuickJS sandbox (a Web Worker in the app) with no
  access to files, the network or the editor, within 3 s, 64 MB and 2,000 ops; they are
  deterministic, report errors by line, and leave their top-level names for the agent's next
  script. The built-in agent, Claude Code and every MCP client get it; the prompts prefer it for
  building and keep `kimo_apply_ops` for a few precise edits. Measured with Claude Code
  (Sonnet), 3 runs each against `kimo_apply_ops` alone: "design a pricing page" uses 68% fewer
  output tokens and 62% fewer tokens in all, finishes in 22 s instead of 41 s; "add a
  testimonials section" uses 31% fewer output tokens with no failed calls (2 before). Guide:
  `script`.
- Fewer failed edits: `kimo_apply_ops` and `kimo_script` read more slips as what they mean:
  `layout: "row"` / `"vertical"` and the like, `padding` / `padX` / `padY`, `alignItems` /
  `justifyContent` and CSS values such as `space-between`, `w: "fill"`, a stroke written as a
  color or `{color, width}`, and `cornerRadius` / `borderRadius`.
- Patch-retry for edits. A failed `kimo_apply_ops` call returns a `retryId`; the agent fixes it
  with `{docId, retryId, edits: [{find, replace, all?}]}` (compact JSON of the failed call)
  instead of sending the whole call again. Handles are per agent, used once and expire after 15
  minutes.
- Agents show work sooner: no long planning before the first edit, `render: true` on the call
  that finishes a section instead of a separate render call.
- Layers added by agents grow in (board 35 "Agent build motion"). Each new layer from the
  built-in agent or an MCP client fades in, scales up from 96 % and rises 6 px over 200 ms
  (cubic-bezier(0.2, 0, 0, 1)); auto-layout siblings slide and parents resize to their new boxes
  over the same 200 ms. Layers from one call start in layer order, 16 ms apart, tightened so the
  call finishes within 600 ms; more than 200 new layers fade in their common parent once. The
  renderer draws the motion only: the document, exports, `kimo_render`, thumbnails and hit
  testing use the final state. Your own edits, undo / redo and collaborators stay instant, and
  with reduced motion nothing moves (the landing flash stays).
- Agents work without asking (board 34, ADR 0013 Addendum 8). Claude Code, Codex and other
  agents connected over MCP, and the built-in agent, don't stop for approvals: opening,
  creating, saving and exporting files, deletes, edits outside the agent's area and
  document-wide changes run at once, like Pen.dev; the agent host's own tool approvals stay.
  Each one leaves a line in the thread ("Approved automatically: saved landing.kimo") and, on
  desktop, an Activity row, and canvas edits stay undoable. **Ask before changes** brings the
  prompts back: per session in the built-in agent's composer "…" menu (board 40), per client in
  Settings › Agents & MCP › Permissions (saved in the client's policy as `autoApprove: false`;
  the client row shows "· asks first"). Turning it off again approves the cards already
  waiting. Limits that are not approvals still apply: the new-layer limit per edit, path and
  read-only checks, the frames of agents started by side by side or split, and clients set to
  deny.
- The approval prompt stays on screen with many changes: its height is capped at 70 % of the
  window (less when the space below the agent chip is smaller), the change list scrolls inside
  it, and more than 8 changes are grouped by kind with the first 3 of each, "and N more" and
  Show all. The in-thread approval card is capped the same way.
- The macOS Dock icon animates while an agent works (board 32 "Dock activity"): during a
  built-in agent turn in any window, or while an MCP client's tool call runs (and for 2 s
  after), the mark's outer shape turns clockwise and its opening counter-clockwise, one 60°
  step per 2 s loop with a soft white glow. It stops 1.5 s after the last activity, at the end
  of the current beat, and the normal icon comes back. Reduce motion keeps the mark still and
  only pulses the glow. The frames carry the icon look macOS 26 gives the idle app icon (glass
  rim, depth, shaded mark), so only the rotation and the glow change. Pre-rendered frames,
  nothing runs while idle; Windows and Linux keep the static icon.
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
  system library and a document that imports it, and a three-way merge demo, generated from
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
- Rich text: style part of a text box while editing (family, weight, size, color, italic,
  underline, strikethrough, line height, letter spacing, link); ⌘B / ⌘I / ⌘U / ⇧⌘X, ⌘K for a
  link; the Text and Fill sections show "Mixed" for a range (board 30).
- Launch loader: the animated mark shows on first paint, before the app's code loads (board 29).
- Agent progress (board 31): while a turn runs the Agent tab shows one live status line: the
  agent's own short note for the current step, else what the tool is doing ("Adding 12 layers in
  Pricing"), with the elapsed time and a **Follow** chip that zooms to the layer the agent's
  cursor points at. The reply appears when the turn ends. Layers the agent edits flash in its
  hue as each edit lands; the viewport never moves on its own.
- The agent cursor follows the last layer the agent added (board 31 "Agent cursor"): after each
  landed edit it glides to that layer's top-left (+4, +4), or to the last layer it changed when
  the edit only changed layers. Reads, deletes and placeholder flags leave it where it is. Edit
  results carry it as `pointer`, MCP presence as `pointer`, so the built-in agent, CLI agents and
  MCP clients all point the same way, with no drift while panning or zooming.
- Agents build step by step: they plan the sections, then add one finished section per edit,
  with its real content, and never leave empty frames, placeholder-only boxes or half-built
  sections between edits. `kimo_apply_ops` refuses a call that inserts more than 40 new layers
  (`AGENT_MAX_NEW_LAYERS`, new error code `BATCH_TOO_LARGE` with `{limit, newLayers}`) for every
  agent client: the built-in panel, Claude Code, Codex, Gemini CLI and any MCP client. The limit
  is a ceiling, not a target (an edit is often 8 to 25 layers); a large section is split into
  finished sub-blocks. Copies, duplicates and component instances are never limited, and agents
  are told to copy existing frames or pages for variants instead of re-creating them (new guide
  `guide/steps`).
- Design check (board 31 "Check"): every `kimo_apply_ops` result lists clear problems in the
  layers it changed as `data.problems`, at most 8 lines of `<id> <kind>: <fix>`: an empty frame
  that draws nothing, zero size, text overflowing its box or cut by a clipping parent, a layer
  hidden by or outside its parent, content overflowing a fixed-size auto-layout frame, text
  stacked on text without auto layout, a missing variable, a shape with no visible fill or
  stroke. `kimo_validate {check: true}` lists them for the whole document, placeholders still
  set included. Agents fix them before moving on and finish with none. Every example file
  checks clean.
- Agent turns cost far fewer tokens (measured with the real Claude Code CLI on the landing
  example, "create a variant to add a pricing table": ~250–300k tokens over 7–8 model calls
  before, ~67–85k over 4–5 calls after):
  - Kimo's prompt replaces the CLI's own coding-agent prompt instead of being appended to it
    (Claude Code `--system-prompt` without its CLAUDE.md, memory and skill listing; Codex
    `model_instructions_file`; Gemini CLI `GEMINI_SYSTEM_MD`). The per-turn context goes in the
    user message, so a resumed session never sees a stale selection.
  - Tool definitions are about a third of their size (descriptions trimmed to what a model
    needs, details moved to the new `tools` guide, `kimo_apply_ops` ops advertised as a compact
    generated grammar). The server still validates every call against the full strict schemas.
  - Edit results leave out the normalized `ops` / `inverse` they used to echo back (`opCount`
    instead; a dry run keeps `ops`), and a failed commit lists at most 5 issues.
  - The turn context names the open document (`docId`) and carries a compact, bounded outline
    of the page (ids, names, boxes, key fields; the selection in detail), so agents skip
    exploratory reads.
  - Fewer failed calls: `kimo_apply_ops` declares every feature a value needs (for example
    `layout.align: "stretch"`), reads `null` in `update.set` as unset, `set.unset` as the op's
    `unset`, a text node's `text` as `content` and `width` / `height` as `w` / `h`; unknown
    fields get a one-line fix (`padding` → layout `pad`). After a `copy` with `key: "v"`,
    `@v/<original id>` addresses a node inside the copy in the same call, and `created[]` lists
    the copy's first two levels.

### Changed

- `fill` sizes share the parent's main axis equally by weight, ignoring content size and
  padding, as in pen.dev and Figma (CSS `flex: <weight> 1 0`): two fill texts in a row now get
  the same width whatever their length, so text wraps as in pen.dev, and padded and unpadded
  fill siblings end with equal outer sizes. A parent that hugs (`fit`) that axis or wraps keeps
  the content size as the basis. The canvas layout and the HTML/CSS and React exports change
  together (`flex-basis: 0`, or a px basis proportional to the weights when siblings are
  padded); min/max clamps are resolved from the same basis.
- ⇧⌘V is Paste in place; the Variables dialog moved to ⌥⇧⌘V.
- Agent tab: no streamed text or live token counts while a turn runs; tokens, cost and time
  show when hovering a finished reply. Tokens are new tokens only ("21.1k new tokens": input not
  served from the prompt cache plus output; the tooltip shows the cached input left out), and
  the thread header and usage ledger count the same way. Each reply's steps are folded behind an "N steps" toggle
  (always folded by default; a failed step adds a red count). The per-turn cost warning is unchanged.
- Agents on the canvas (board 36): each agent shows one cursor in the middle of the section it
  edits (a direct child of the top-level frame) and a 1 px outline on that section. The cursor
  floats 3 px every 2.4 s and glides 600 ms between sections; each landed edit rings the
  section once. The placeholder tag, tooltip, shimmer, skeleton and "ready" chip, the
  attribution tag, scope outlines and ScopeTags, the docked off-screen pill and outlines on
  small layers are gone. The label is the agent's name only: the built-in agent shows its
  persona name ("Kimo") also when it runs on Claude Code or Codex, and its own MCP connection
  no longer draws a second "Claude Code" cursor.
- The image size limit is 20 MB (was 50 MB).
- Docs:
  - Kimo collects no telemetry (SECURITY.md, teardown).
  - Links use getkimo.design.
  - ADR 0014: agent sessions are stored in IndexedDB on every platform.

### Fixed

- Files saved before the move to getkimo.design open again. Their `$schema` names the old
  `kimo.design` host, which failed validation ("This file isn't valid"); reading a file now
  heals that URL, so the file opens and its next save writes the new one.

- Settings: every saved setting takes effect. **On launch › Last files** reopens the file that
  was open when you quit (desktop). **When a file changes on disk › Ask first** asks with a banner
  (**Merge** / **Keep mine**) and writes nothing until you choose. **Canvas zoom › Mouse** zooms
  on a plain scroll and pans on `⇧`+scroll. **Embed fonts in .kimoz packages** is honoured (off:
  no fonts; on: only fonts whose OS/2 fsType allows embedding). The first save of an untitled
  file starts in **New files go to**. A new **Recovery snapshots** interval applies to open
  files. Extra font folders are listed and can be removed; **Font cache › Clear** refreshes open
  editors. Updates shows **Download**, the download progress and **Restart to update** (which
  saves every window first), and turning **Download updates** on downloads a waiting update. A
  refused settings write or a failed action in any pane (MCP server start, stop, port, token,
  log, config install, merge driver, AI provider changes) shows "Couldn't …" with the cause and
  Retry, and the control shows the stored value; the MCP config dialog stays open while it
  writes and offers **Try again**. **Use <port> and restart** starts HTTP on the new port and
  clears the error, HTTP gets a token when it is turned on, **Open log** reveals the activity
  logs, the session popover's client settings open that client, the agent's Usage card opens
  Usage & limits, and **Default app** shows on the web only in the installed app.
- Editing a text box keeps its width and wrapping (the editor used to reflow it to one line).
- Desktop launch no longer waits 10 s for the document host (a ping sent before the host
  listened was lost); files opened at launch are host-backed again.
- The desktop editor window loads in dev (the MCP installer's Node imports are split out).
- Per-corner radii render; bound per-side stroke widths and padding entries resolve in the
  renderer, the exporters and the panel.
- The agent's approval card names the layers it touches ("in Pricing") instead of their ids.
- The web build reports its real version in Settings › About and the release-notes link.
- Agent cursors, tags and component labels on the canvas no longer trail the layers while
  panning or zooming (they eased between positions and re-rendered a frame late).
- Agents: on desktop the session popover lists an MCP agent's edits and **Undo all** / **Keep**
  work (the window only saw them as remote changes). Pause, resume, undo, redo, approval answers
  and disconnect show "Couldn't …" with the cause when they fail, and Pause rolls back. Undone
  activity entries have **Redo** on desktop; a stale entry's Undo is disabled; hovering an entry
  outlines all its layers. **Agents & MCP…**, **Connect an agent…** and **Export JSON** work in
  the editor. **Run N prompts** runs them one after another instead of failing all but the
  first. Iterate **Before / After** shows the frame before the pass. Undo turn and Regenerate say
  why when they can't run. The mode summary pill with **Stop all** shows on the canvas, plan-card
  log rows can be reverted, and `⌥↵` in the skills menu toggles the top row. The Agent tab no
  longer shows "Agent arrives in M6" while it loads.
- Editor: the title bar shows the current page's name instead of "Page 1". **Back to files** leads
  the File menu (and the macOS menu bar's File menu), and the folder name in the title bar opens
  Home on that folder. Edit › Undo, Redo and Select All in the menu bar act on the document.
  Library Changes › **Fix broken overrides** opens the fix dialog for that library's instances.
  **Replace with selection** and Add prop › **Slot (mark a frame)** work. Right-click on a note,
  prompt, placeholder or conflict layer row opens the layer menu. View › Preview is disabled when
  there is nothing to preview. **Copy link to page** copies a `kimo://` link on desktop (deep
  links take `page=`) and confirms with a toast; `⌫` on a page row deletes it. The I-key icon
  picker's weight slider applies to the inserted icon. Shortcut hints read `Ctrl` on Windows and
  Linux. **Show diff** is now **Reveal recovery copy** and, like **Open as text**, is hidden in
  the browser. A failed image import, reveal, open as text or **Mark resolved & save** says
  "Couldn't …" with the cause instead of failing silently.
- Desktop menu bar: **File › New file** (`⌘N`), **Open…** (`⌘O`) and **New window** (`⇧⌘N`)
  work on Home and in the editor, and `⌘N` / `⌘O` work on Home. Edit › Undo, Redo and Select all
  act on the focused text field first (in Settings too). Back to files, Export…, Copy selection
  as PNG and Preview are disabled while the window shows Home. A link's **Open** opens `http`,
  `mailto` and `tel` links as well as `https`, and says why when a link can't open. **Help ›
  Copy diagnostics** writes the system clipboard and confirms with a toast.
- Home: every sidebar row works. **Recents**, **All files**, each local folder, **Templates**,
  **Design systems** and **Trash** each show their own list (`#/`, `#/all`, `#/folder/<path>`,
  `#/templates`, `#/libraries`, `#/trash`), with the active row marked, the row's name as the
  title, real counts and a search scoped to the list; Home comes back to the same section after
  a file. **Templates** lists the bundled examples and creates a new file from one (a template's
  imported library is copied along). **Trash** lists files moved there with **Restore** (or
  **Restore as copy**), **Delete forever** and **Empty trash…**; the browser keeps trashed files
  30 days. **Design systems** lists files that are imported or publish components, instead of
  opening the developer component gallery, which now ships in dev builds only. A file's **⋯** and
  right-click menu has Open, Reveal, Rename (inline), Duplicate, Remove from Recents and **Move to
  Trash** (`⌘⌫`, with Undo); folders have Reveal and **Remove from Kimo**. Missing files show as
  Missing instead of opening a failed editor. Home shows empty states (no files, no match, empty
  folder), lists local folders in Chromium, re-lists files when the window comes to the front,
  and every failed action says "Couldn't …" with the cause.
- Launch recovery: **Restore** asks where to save the copy when the original file can't take it
  (moved, deleted, read-only) instead of leaving it unrestored, and snapshots older than 30 days
  are pruned before the dialog lists them.
- Desktop: the Home composer no longer fails on a fresh install. The new-files folder
  (`~/Documents/Kimo`, or Settings › Files › New files go to) is granted at launch and when the
  setting changes, a refused folder is reported instead of read as free, and Recovery › Restore
  can write a file that has left Recents. **Move to Trash** moves files to the macOS Trash (the
  freedesktop Trash on Linux, `~/.kimo/trash` on Windows) and records them in `~/.kimo/trash.json`
  so the Trash view can restore them. Kimo never empties the Trash on its own.

### Format

- Spec §6.1 clarifies how `fill` shares main-axis space (zero basis; content basis in a hug or
  wrapping parent), §20 row 34. No format version or feature change.
- **`.kimo` format 1.0.0 (stable).** Format 1.0 is format 0.1 declared stable plus five additive
  fields; no existing field, default, node type or feature changed, every 0.1 document is a valid
  1.0 document, and it stays backward compatible within 1.x (spec §16.4).
- Additions in 1.0: root `pages` (page id → `{order, name}`) with a root-only `page` placement
  (§5.6; lints `PAGE_UNKNOWN`, `PAGE_NOT_ROOT`); polygon `star: {ratio}` (§5.5); image paint
  `fit: "crop"` using the existing `crop` transform (§7.1); enum component props with per-option
  `targets` (§9.6, `PROP_TARGET_INVALID`).
  Documents are written with `"format": "1.0.0"` and
  `"$schema": "https://getkimo.design/schema/kimo-1.0.json"`.
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
- Text spans may carry their own `fill` (a color or a color binding) under `text/runs` (§8.1).

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

- Desktop app (Tauri v2): all platform commands in Rust: atomic save with read-back, file
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

