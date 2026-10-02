# pen.dev Teardown and the Kimo Plan

> Status: research teardown, draft 1, written 2026-10-02.
> Scope: pen.dev (formerly "Pencil", pencil.dev) as a product, file format, agent API and desktop app, followed by the plan for **Kimo**, an MIT-licensed, local-first, open-format alternative.
> Method: the document is built only from the research notes collected for this project. No `.pen` file was decrypted, and no proprietary source code was copied. Where pen.dev internals are described, only file names, package names, identifiers, public schemas and observed behavior are reported. Claims that are deductions rather than observations are marked **INFERRED**.

---

## Source key

Citations are inline in short form. The keys map to sources as follows.

| Key | Source |
|---|---|
| `[home]` | https://pen.dev |
| `[pricing]` | https://www.pen.dev/pricing (fetched 2026-10-02) |
| `[eula]` | https://www.pen.dev/eula |
| `[downloads]` | https://www.pen.dev/downloads |
| `[docs]` | https://docs.pen.dev (Nextra site, root) |
| `[docs/pen-format]` | https://docs.pen.dev/for-developers/the-pen-format |
| `[docs/pen-files]` | https://docs.pen.dev/core-concepts/pen-files |
| `[docs/design-as-code]` | https://docs.pen.dev/core-concepts/design-as-code |
| `[docs/interface]` | https://docs.pen.dev/core-concepts/pencil-interface |
| `[docs/drawing]` | https://docs.pen.dev/core-concepts/drawing-and-editing |
| `[docs/components]` | https://docs.pen.dev/core-concepts/components |
| `[docs/slots]` | https://docs.pen.dev/core-concepts/slots |
| `[docs/libraries]` | https://docs.pen.dev/core-concepts/design-libraries |
| `[docs/build-ds]` | https://docs.pen.dev/core-concepts/build-a-design-system (with `examples/design-system.zip`) |
| `[docs/variables]` | https://docs.pen.dev/core-concepts/variables |
| `[docs/code-on-canvas]` | https://docs.pen.dev/core-concepts/code-on-canvas |
| `[docs/ai-agents]` | https://docs.pen.dev/core-concepts/ai-agents |
| `[docs/import-export]` | https://docs.pen.dev/core-concepts/import-and-export |
| `[docs/sharing]` | https://docs.pen.dev/core-concepts/sharing |
| `[docs/slides]` | https://docs.pen.dev/core-concepts/presentations |
| `[docs/d2c]` | https://docs.pen.dev/design-and-code/design-to-code |
| `[docs/auth]` | https://docs.pen.dev/getting-started/authentication |
| `[docs/ai-integration]` | https://docs.pen.dev/getting-started/ai-integration |
| `[docs/install]` | https://docs.pen.dev/getting-started/installation |
| `[docs/cli]` | https://docs.pen.dev/for-developers/pen-cli |
| `[docs/troubleshooting]` | https://docs.pen.dev/troubleshooting |
| `[skill:<file>]` | the `pen-dev` agent skill, read through the `mcp__pencil__read_skill` MCP tool (files such as `SKILL.md`, `pen-schema.md`, `execute.md`, `generate.md`, `guide/*.md`) |
| `[mcp:<tool>]` | live read-only calls to the `pencil` MCP server in this session (`get_app_state`, `get_style`, `execute`) and its tool schemas and server instructions |
| `[gh pen#N]` | https://github.com/highagency/pen-desktop-releases/issues/N |
| `[gh pencil#N]` | https://github.com/highagency/pencil-desktop-releases/issues/N (older repo) |
| `[local:app]` | inspection of `/Applications/Pen.app` limited to: `Info.plist` bundle metadata, directory and file listings (names and sizes), `package.json` `name`/`version`/`license` fields of bundled dependencies, and `lsof`/`ps` output. No app JavaScript, prompt text, tool descriptions or config schemas were read or copied. Any claim about runtime behavior that would need more than this is either sourced to public docs or marked INFERRED |
| `[local:userdata]` | names-only listings of `~/Library/Application Support/Pen` and `~/.pencil`, plus a key dump (values redacted) of `config.json` |
| `[tweets]` | Tom Krcha tweets: 1973033972654559476 (2025-09-30), 2014028990810300498 (2026-01-21), 2026329359838318906 (2026-02-24); Peter Yang 2031014671998980406 |
| `[reviews]` | flowstep.ai, uxmagic.ai, therundown.ai, banani.co, designwithai.substack.com, jeradbitner.com, paper.design/compare/pencil, open-design.ai, HN item 46732706, creatoreconomy.so, wakib.ai, abduzeedo.com |
| `[openpencil]` | https://openpencil.dev/guide/comparison |
| `[oss]` | library sources listed in section 9 (npm, GitHub, docs pages) |

---

## 1. TL;DR

- **What pen.dev is.** A proprietary desktop and IDE design canvas ("An agentic canvas for building bold software") whose real users are developers already working with coding agents. Design files (`.pen`) are JSON trees that live in the repo next to the code. Agents edit them through a local MCP server named `pencil`, whose main tool, `execute`, runs a sandboxed JavaScript DSL. `[home]` `[docs/ai-integration]` `[skill:execute.md]`
- **What it does well.** It has a compact, CSS-flex-shaped data model (fit/fill/fixed sizing, gap, padding, justify/align). Components use `reusable` plus `ref` instances with flat ID-path overrides. It has multi-axis themed variables, a single atomic agent tool with rollback and patch-retry, parallel agents shown as cursors on the canvas, and support for many model providers. `[skill:pen-schema.md]` `[docs/ai-agents]` `[docs/auth]`
- **Where it falls short.** The app is closed source with an anti-reverse-engineering, anti-training EULA. Its own MCP server says `.pen` is "encrypted", which contradicts the docs and public files. Publicly committed older-version files (2.11/2.17) are plain pretty-printed JSON; that current 2.20 saves are too is INFERRED and unverified. Either way the contradiction muddies the "open format" story. There is no autosave for project files and several data-loss bugs (empty documents written over real ones). MCP targeting and concurrency are fragile. Sign-in is required even for the CLI. Usage is metered ("agent days"). There is no multiplayer. The only native code exporter is HTML. Colors are hex sRGB only, there is no flex wrap, and there are no rich-text runs. `[eula]` `[mcp:server-instructions]` `[gh pen#4]` `[gh pen#6]` `[gh pencil#22]` `[gh pen#13]` `[pricing]` `[reviews]`
- **Kimo's position.** The same idea built as open infrastructure. The app is MIT licensed. The file format is a published, versioned, never-encrypted JSON format (`.kimo`), laid out as a flat node table that diffs and merges well in git. The MCP tool set is open, typed, and declarative, and it reports structured errors, revisions and inverse ops. A provider-agnostic agent loop defaults to Claude and accepts a user's own key. There is no account and no backend. Deterministic exporters cover React+Tailwind, HTML/CSS, DTCG tokens, and SVG/PNG/PDF. The data model is Yjs-friendly so multiplayer can follow.
- **Recommended stack.** A bun monorepo with React+TS+Vite. CanvasKit (Skia WASM) for rendering and text, so the browser canvas, the headless MCP renderer and PNG export produce identical raster output (code export is laid out by the browser and matches within a tolerance). Yoga for flex layout. Zustand for UI state, plus a normalized document store backed by Yjs (Loro is the alternative under evaluation). Tauri v2 for the desktop app. `@modelcontextprotocol/server` v2 for MCP. A Kimo-owned LLM interface, with a direct Anthropic adapter as the default and an OpenAI-compatible adapter for other providers.
- **Closest open-source prior art.** OpenPencil (MIT) already combines CanvasKit, Yoga, Yjs, MCP and Tauri `[openpencil]`. Kimo has to justify itself against it (see section 13).

---

## 2. What pen.dev is

### 2.1 Positioning and history

| Date | Event | Source |
|---|---|---|
| 2025-09-30 | Teaser: "MCP driven canvas built around open design files that live directly in your codebase... the end of design handoff" | `[tweets]` |
| 2025-10-20 | VS Code / Open VSX extension 0.1.4 (publisher id `highagency.pencildev`) | open-vsx.org API |
| 2025-12-31 | Desktop releases repo `highagency/pencil-desktop-releases` created | gh api |
| 2026-01-21 | Public launch: "INFINITE DESIGN CANVAS for Claude Code" / "design mode for Claude Code" | `[tweets]` |
| 2026-02-24 | Claimed 100,000 users about 8 weeks after launch; SWARM mode (parallel agents with cursors) announced | `[tweets]` |
| ~2026-04-16 | Code on Canvas (script nodes) | `[docs/code-on-canvas]`, abduzeedo |
| 2026-07-20 | Desktop v1.2.0, the last release in the old repo | gh api |
| ~Aug–Sep 2026 | Rename Pencil → pen.dev (pencil.dev now 307-redirects); multi-provider agents. Sources disagree on the exact month (wakib.ai says Aug 14, uxmagic says September) | `[reviews]` |
| 2026-08-21 → 09-30 | Desktop v1.2.6 → v1.2.15 in the new repo `highagency/pen-desktop-releases`, with empty release notes | gh api |
| by 2026-10-02 | Tiered pricing published. Earlier the product was "currently free"; the founders' line was "Free is not a business model" | `[pricing]` `[reviews]` |

Current tagline: **"An agentic canvas for building bold software."** The pitch is to design with AI agents, refine by hand, and turn designs into code, with `.pen` files living in the repo next to the app code. `[home]`

Leftovers from the old name are still visible: the extension id is `highagency.pencildev`, the CLI token directory is `~/.pencil`, the MCP server registers as `pencil`, the app's bundle id is `dev.pencil.desktop`, and the URL scheme is `pencil://`. `[docs/cli]` `[local:app]`. One open bug shows the rename breaking sign-in, because the editor still calls `api.pencil.dev` `[gh pen#12]`.

### 2.2 Company

Publisher: High Agency, Inc. (Covina, CA). CEO and creator: Tom Krcha. Backed by a16z speedrun, which is linked from the homepage. `[eula]` `[home]`

### 2.3 Users

The users are developers and designers who already use coding agents (Claude Code, Codex, Cursor) and want visual iteration inside that workflow, along with teams building design systems. Reviewers say non-developers cannot realistically use it and that it suits internal tools and rapid prototyping best. `[reviews]` (therundown, flowstep, jeradbitner)

### 2.4 Platforms

| Surface | Details | Source |
|---|---|---|
| Desktop | macOS (Apple Silicon and Intel) DMG; Windows x64 (ARM64 "coming soon"); Linux AppImage/tarball for x64 and arm64 | `[downloads]` `[docs/install]` |
| IDE extension | "pen.dev" (`highagency.pencildev`) for VS Code, Cursor, Windsurf, Antigravity and Open VSX. `.pen` opens as a custom editor ("Toggle Design Mode"). 101 versions, about 1.46M Open VSX downloads, about 157k Marketplace installs, 4.5★ from 12 reviews | open-vsx.org, marketplace |
| CLI | npm `@pen.dev/cli`, command `pen` (Node ≥ 22.19). Reportedly pulled from npm around 2026-09-25 after a Defender flag | `[docs/cli]`; github.com/markgoho/doula-cloud/issues/1469 |
| Chrome extension | "pen.dev web import": turns web pages into layers | `[docs/import-export]` |
| Web editor | `app.pen.dev`, with an embed mode (`/new?embed`), a MessagePort bridge and an `@pen.dev/sdk` package, shown in `highagency/pen-embed-demo` (Aug 2026, labelled "proposal"). Older reviews say there is "no browser version" | github.com/highagency/pen-embed-demo; flowstep |

### 2.5 Pricing (fetched 2026-10-02)

| Plan | Price | Agent usage | Generations | Parallel agents | Other |
|---|---|---|---|---|---|
| Free | $0 | 5 "agent days"/month | 25 image and SVG generations | 1 | Full editor, local files, components, variables, themes, scripts, shaders, import/export, CLI, MCP, sharing, snapshots, versions, comments, workspaces, personal dev keys |
| Pro | $16/user/mo | unlimited agent days | 350 | 3 | org dev keys for CLI/CI, roles, billing |
| Ultra | $48/user/mo | unlimited | 750 | 6 | shared usage pool, team workspaces |
| Enterprise | custom | | | | |

20% annual discount. An "agent day" is any day on which you use an agent. Bring-your-own subscriptions (Claude Code, Codex, Cursor) are allowed. `[pricing]`

Note the gating: even BYO-provider usage counts against "agent days" on the Free plan (**INFERRED** from the definition "any day you use an agent"), and the CLI requires sign-in even for export and `interactive` `[docs/cli]`.

### 2.6 Licensing

The app is proprietary and closed source. The EULA grants a limited, non-exclusive, non-transferable licence. It prohibits copying, modifying, reverse engineering and decompiling. It also prohibits using the product to train or improve competing models or services, and scraping or bulk-exporting outputs for that purpose. Users own their content and AI outputs. Inputs to Pro models are not used for training. With a BYO provider, text inputs and outputs bypass High Agency servers. `[eula]`

The only public open-source code is the MIT sample repo `highagency/pencil-scripts`. The release repos have no licence. `[gh api]`

### 2.7 Docs and changelog

The docs at docs.pen.dev (Nextra) are organized as Getting Started, Core Concepts, Design and Code, Troubleshooting, and For Developers. For Developers holds the full TypeScript schema and the CLI docs. There is no public changelog: `pen.dev/changelog` and `docs.pen.dev/changelog` both return 404, and the GitHub release notes are empty. `[docs]`

---

## 3. Feature inventory

Legend for "Kimo v1?": **Yes** means in the v1 scope. **Partial** means a reduced form ships in v1. **Later** means after v1 (milestone noted in section 12). **No** means explicitly out of scope.

### 3.1 Canvas and editing

| Feature | pen.dev behavior | Kimo v1? | Notes |
|---|---|---|---|
| Infinite canvas, WebGL | Infinite canvas with "buttery smooth" WebGL rendering of thousands of layers `[home]` | Yes | CanvasKit on WebGL2 (section 9) |
| Frames, groups, clip | Frames (Cmd+Alt+G wraps the selection), groups, Clip Content `[docs/drawing]` | Yes | |
| Shapes | Rectangle (R), ellipse (O) including arcs and rings, polygon, icon primitive `[docs/drawing]` `[skill:pen-schema.md]` | Yes | |
| Pen tool | P; point editing (Enter); cut segment (X); smooth/corner toggle `[docs/drawing]` | Yes | Boolean ops via Skia PathOps (Later) |
| Text | T; Auto width / Auto height / Fixed size growth; one style per node `[docs/drawing]` `[skill:pen-schema.md]` | Yes | Kimo adds rich-text runs (Later, format reserved in v1) |
| Custom fonts | .ttf/.otf/.woff/.woff2 per document `[docs/drawing]` | Yes | Fonts as content-hashed assets (M4) |
| Fills | color; linear/radial/angular/mesh gradient; image (fill/fit/stretch); shader; per-fill blend mode `[docs/drawing]` | Partial | v1: color, linear/radial/angular, image. Later: mesh, shader |
| Strokes | inside/center/outside; per-side widths; paint union `[skill:pen-schema.md]` | Yes | Kimo adds dash patterns |
| Effects | drop shadow, inner shadow, layer blur, background blur `[docs/drawing]` | Yes | Kimo adds shadow spread |
| Scale tool | K; scales contents including text, strokes and effects `[docs/drawing]` | Later | |
| Image tools | Remove background, Vectorize image (online, sign-in required) `[docs/drawing]` | Later | BYO-provider adapters only |
| Selection colors | blue normal, magenta component origin, violet instance `[docs/drawing]` | Yes | Same semantics, Kimo's own palette |
| Deep select | Cmd+click; Enter for children; Shift+Enter for parent `[docs/drawing]` | Yes | |
| Snapping, pixel grid, nudge | settings for pixel grid, snapping, nudge (1/10px) `[docs/drawing]` | Yes | |
| Measurements | `[home]` | Yes | |
| Layers panel | `[home]` | Yes | |
| Light/dark UI | `[docs/drawing]` | Yes | |
| Familiar shortcuts | Figma-like `[home]` | Yes | |

### 3.2 Layout

| Feature | pen.dev behavior | Kimo v1? | Notes |
|---|---|---|---|
| Flex layout | Shift+A; horizontal/vertical; gap; padding; alignment grid; Space Between / Space Around `[docs/interface]` | Yes | Yoga |
| Hug / Fill / Fixed | `fit_content`, `fill_container`, number; fallback in parentheses `[skill:pen-schema.md]` | Yes | Stored as a structured object, not a string |
| Absolute escape hatch | `layoutPosition: absolute` `[skill:pen-schema.md]` | Yes | |
| Remove layout | Shift+Alt+A `[docs/interface]` | Yes | |
| Wrap | Not supported `[skill:SKILL.md]` | Yes | Feature flag `layout/wrap`; ships in M2 (Yoga supports wrap) |
| Grid | Not supported; built from row frames `[skill:SKILL.md]` | Later | Taffy evaluation |
| Min/max size | Not in schema | Later | Schema fields exist only behind feature flag `size/min-max` |
| Baseline/stretch align | Not supported `[skill:SKILL.md]` | Later | Schema values exist only behind feature flag `layout/stretch-baseline`; stretch is cheap with Yoga, so possibly v1.1 |

### 3.3 Components, variables, themes

| Feature | pen.dev behavior | Kimo v1? | Notes |
|---|---|---|---|
| Components | `reusable: true` on any node (Cmd+Alt+K) `[docs/components]` | Yes | |
| Instances and overrides | `type: ref`, root overrides inline, flat `descendants` map keyed by ID paths `[skill:guide/components.md]` | Yes | Same semantics, Kimo's own field names |
| Full replacement | override containing `type` replaces the subtree `[docs/pen-format]` | Yes | |
| Detach | supported; keeps nested instances and variable links `[docs/components]` | Yes | |
| Slots | empty frame in a component with `slot: [suggested ids]`; advisory only `[docs/slots]` | Yes | |
| Variants | Naming convention only ("Button/Primary") `[skill:guide/design-system.md]` `[mcp:get_app_state]` | Partial | v1 keeps naming; first-class variant sets Later |
| Design libraries | `.lib.pen` files, irreversible conversion, linked via `imports` and the `alias:id` prefix `[docs/libraries]` `[docs/build-ds]` | Partial | v1: import/link read-only libraries; publishing workflow Later |
| Variables | color/number/string/boolean, `$name` refs, aliases `[docs/variables]` | Yes | Kimo adds typed composites (typography, shadow, dimension) Later, behind feature flag `tokens/composite` |
| Themes | multi-axis; last matching entry wins; per-node `theme` inherited per axis `[docs/pen-format]` `[docs/variables]` | Yes | Kimo specifies the no-match fallback |
| CSS variable sync | Agent-prompted only (read/write `globals.css`) `[docs/variables]` | Yes | Deterministic token exporter and importer |
| Color spaces | Hex only (#RGB, #RRGGBB, #RRGGBBAA) `[docs/pen-format]` | Yes | Kimo adds OKLCH and Display-P3 |

### 3.4 AI and agents

| Feature | pen.dev behavior | Kimo v1? | Notes |
|---|---|---|---|
| Agent composer | Cmd/Ctrl+K; model picker; reasoning effort; session history; selection as context; attachments `[docs/ai-agents]` | Yes | |
| Permission prompts | Allow/Deny, Claude auto mode, "Dangerously skip permissions" `[docs/ai-agents]` | Yes | Canvas ops auto-approved and undoable; fs/shell/network ask |
| Token and cost display | `[docs/ai-agents]` | Yes | |
| Skills | built-in `pen-dev` skill; custom SKILL.md folders via slash menu `[docs/ai-agents]` `[skill:SKILL.md]` | Yes | Original MIT content |
| Parallel agents | 1–6, "Split Work" / "Side by Side", per-agent model `[docs/ai-agents]` | Partial | v1: Side by Side and Split with enforced scopes, cap configurable |
| Let it cook | 2–6 sequential variants exploring Layout or Style `[docs/ai-agents]` | Yes | Prompt template |
| Agent cursors | SWARM mode `[tweets]` | Yes | |
| Providers | ~20 incl. Anthropic, OpenAI, Gemini, OpenRouter, custom endpoints `[docs/auth]` | Yes | Anthropic default; OpenAI-compatible; Gemini; custom |
| Hosted models | "pen.dev Pro" `[docs/ai-agents]` | No | No backend |
| Prompt / note / context nodes | runnable prompt node with `model`; note; context `[skill:pen-schema.md]` | Partial | note and prompt in v1 (M6); context Later |
| AI asset generation | `Generate`: ai image, stock (Unsplash), svg, vectorize, remove/replace background `[skill:generate.md]` | Later | Provider adapters; explicit job ids |
| Style archetypes | ~60 named styles with palettes, roundness, elevation, fonts `[mcp:get_style]` | Partial | A small original set in v1 |

### 3.5 Code, import, export, other

| Feature | pen.dev behavior | Kimo v1? | Notes |
|---|---|---|---|
| HTML export | Native HTML+Tailwind or HTML+CSS, optional scaffold `[docs/d2c]` | Yes | |
| React / other frameworks | Agent-prompted only `[docs/d2c]` | Yes | Deterministic React+Tailwind emitter |
| Design tokens export | none native | Yes | W3C DTCG JSON + CSS vars + Tailwind v4 `@theme` |
| Raster/PDF export | PNG/JPEG/WEBP/PDF, 1x/2x/3x, zip for several, copy as PNG `[docs/import-export]` | Yes | Plus SVG |
| Figma import | `.fig` file and copy-paste (no images on paste) `[docs/import-export]` | Later | |
| SVG / image import | SVG as editable layers; PNG/JPEG as image layers `[docs/import-export]` | Yes | M4; exposed to agents via `kimo_import` |
| HTML / web import | built-in browser, Chrome extension, layers without JS `[docs/import-export]` | Later | |
| Browser node | live web page on canvas, CDP control `[skill:pen-schema.md]` `[mcp:browser]` | Later | Needs multi-webview in Tauri |
| Script nodes | sandboxed JS generator, typed `@input` declarations `[docs/code-on-canvas]` | Later | Format reserved in v1 |
| Shader fills | WebGL1 GLSL fragment + annotated uniforms `[skill:scripts-and-shaders.md]` | Later | SkSL RuntimeEffect |
| Slides | top-level frames as slides; Present (Cmd+Enter); PDF `[docs/slides]` | Later | |
| Share link | snapshot uploaded to pen.dev servers `[docs/sharing]` | No | Kimo: export `.kimoz` bundle; optional self-hosted share later |
| Multiplayer | none `[reviews]` | Later | Yjs; v2 |
| Autosave | drafts only; project files need Cmd+S `[docs/troubleshooting]` `[gh pen#4]` | Yes | Debounced atomic autosave from day one |
| CLI | `pen` headless engine, agent mode, REPL, export `[docs/cli]` | Partial | `kimo` CLI: validate, export, render, merge, gc, mcp, migrate. No login |
| Embeddable editor | app.pen.dev embed + MessagePort (proposal) | Later | |
| UI libraries | `[home]` | Later | |

---

## 4. The `.pen` data model (reference)

This section restates the publicly documented schema, version **2.20**, in our own words. Sources: `[docs/pen-format]`, `[skill:pen-schema.md]`, `[skill:SKILL.md]`, `[skill:guide/components.md]`, `[docs/libraries]` and the published example files in `[docs/build-ds]`. Public example files are at versions 2.11 and 2.17. The script header tag is `@schema 2.11`.

### 4.1 Storage reality: JSON or "encrypted"?

- **Documentation:** `.pen` is "JSON-based", "version-control friendly", and you can "view diffs in Git (text-based format)". The homepage says "Schema fully opened". The docs also say *not* to hand-edit the JSON and to resolve git conflicts by re-applying changes in the app. `[docs/pen-files]` `[docs/design-as-code]` `[docs/troubleshooting]` `[home]`
- **The pencil MCP server's own instructions:** ".pen files are encrypted: access them only via the MCP tools". A practitioner blog repeats this without evidence. `[mcp:server-instructions]` `[reviews]` (jeradbitner)
- **Public evidence:** many `.pen` files committed to GitHub are plain, 2-space-indented JSON, for example civitai/civitai `designs/*.pen` and highagency's own `pencil-scripts/collection.pen`, which begins `{"version": "2.11", "children": [`. The official CLI loaded and saved a hand-written JSON `.pen` in `[gh pen#6]`. A third-party project removed the "encrypted" claim from its agent prompts and states "A .pen is plain JSON" (github.com/davidzoufaly/noldor/pull/552). GitHub issue searches for "encrypt", "git diff" and "merge conflict" in both release repos return nothing.
- **Conclusion (INFERRED):** "encrypted" is a guardrail to stop agents from grepping or hand-editing files, not a description of the storage format. Bundled or paid libraries, or a brand-new 2.20 save, have not been ruled out. Per our rules, we did not inspect the local `desing.pen` (which is 0 bytes anyway). For Kimo, the takeaway is that the contradiction itself hurts trust. Kimo should state plainly that the format is plain JSON and give the real reason to prefer the tools (validation and rendering fidelity).

### 4.2 Document root

```ts
// Paraphrase of the documented shape (not copied source)
Document {
  version: "2.20"
  themes?:    { [axis: string /* no ':' */]: string[] }   // first value = default
  imports?:   { [alias: string]: string /* relative URI of an imported .pen file (in practice a .lib.pen) */ }
  variables?: { [name: string /* no ':' */]: VariableDef }
  children:   Node[]   // one nested tree on an infinite canvas; no pages
}
```

- There are no pages. Top-level children are screens, components and boards. `[skill:SKILL.md]`
- The `[^:]+` regex on theme-axis and variable names reserves `:` as the namespace separator for imported libraries. `[docs/pen-format]` `[docs/build-ds]`
- Example files also carry an undocumented top-level `fileToken` UUID whose purpose is unknown. `[docs/build-ds]`

### 4.3 Value types

| Type | Definition |
|---|---|
| Variable ref | string beginning with `$` (e.g. `$--primary`); binds the property to a variable |
| `XOrVariable` | literal or `$ref` for Number, Color, Boolean, String |
| Color | hex `#RGB`, `#RRGGBB` or `#RRGGBBAA`; alpha only through hex |
| Theme | `{ [axis]: value }`, e.g. `{ device: "phone" }` |
| AffineTransform | `[a, b, c, d, tx, ty]` |
| IdPath | string; `/` separates levels of instance nesting only |
| Position | `x`, `y` relative to parent top-left; y grows down; **ignored when the parent has flex layout** |

`[skill:pen-schema.md]` `[skill:SKILL.md]`

### 4.4 Entity (base of every node)

| Property | Meaning |
|---|---|
| `id` | unique; must not contain `/`; generated by the server (the execute API overrides any supplied id) |
| `name` | human-readable name; the skill asks for one on every node |
| `context` | free string; import-to-canvas stores the source tag here, e.g. `"Card - div"` `[mcp:browser]` |
| `reusable` | `true` makes the node a component |
| `theme` | pins axis values for the subtree |
| `enabled` | visibility; also how deletion is emulated inside instances |
| `opacity`, `flipX`, `flipY` | |
| `rotation` | degrees, counter-clockwise, around the top-left corner |
| `layoutPosition` | `auto` or `absolute` (leave the parent's flex flow) |
| `metadata` | `{ type: string, ...any }` |
| `x`, `y` | position |

`[skill:pen-schema.md]`

### 4.5 Sizing

`width` and `height` each take one of:

- a number or number variable
- `"fit_content"`: size to the children. Requires layout on this node. Falls back when there are no children.
- `"fill_container"`: size to the parent. Requires layout on the parent. Falls back when the parent has no layout or the node is absolute.
- either keyword with a fallback in parentheses: `"fit_content(844)"`, `"fill_container(900)"`.

Not supported: percentages, `vh`, `calc()`. Frames default to `fit_content` on both axes. A `fit_content` parent whose children are all `fill_container` is a forbidden circular dependency. Sibling `fill_container` nodes share the space equally, like `flex-1`. `[skill:pen-schema.md]` `[skill:SKILL.md]` `[skill:guide/tailwind.md]`

### 4.6 Layout (frames only)

| Property | Values | Default |
|---|---|---|
| `layout` | `none` (children placed by x/y), `horizontal`, `vertical` | `horizontal` |
| `gap` | number or variable, along the main axis | 0 |
| `padding` | `p`, `[vertical, horizontal]`, or `[top, right, bottom, left]`; entries may be variables | undocumented (0 is INFERRED) |
| `justifyContent` | `start`, `center`, `end`, `space_between`, `space_around` | `start` |
| `alignItems` | `start`, `center`, `end` (no `baseline`, no `stretch`) | `start` |
| `layoutIncludeStroke` | boolean (exact behavior undocumented) | |

Single axis, no wrap, no margin. Offsets are made by wrapping in a padded frame. Grids are rows of frames. `[skill:pen-schema.md]` `[skill:SKILL.md]`

### 4.7 Node types

| `type` | Composition | Type-specific properties |
|---|---|---|
| `frame` | Rectangleish + children + Layout | `clip` (default false), `placeholder` (work-in-progress marker), `slot` (`false` or recommended component ids), `cornerRadius` (number or `[tl,tr,br,bl]`) |
| `group` | Entity + children + effects | no fill, stroke, size or layout |
| `rectangle` | Rectangleish | `cornerRadius` (1 or 4 values) |
| `ellipse` | Size + graphics | `innerRadius` (0 solid → 1 hollow, for donuts), `startAngle` (degrees CCW from the right, default 0), `sweepAngle` (−360..360, default 360) |
| `polygon` | Size + graphics | `polygonCount`, `cornerRadius` |
| `path` | Size + graphics | `geometry` (SVG path data), `fillRule` (`nonzero` or `evenodd`), `viewBox` `[x,y,w,h]` (defaults to the geometry's bounding box; the docs advise always setting it) |
| `text` | Entity + Size + graphics + TextStyle | `content`, `textGrowth` (`auto` / `fixed-width` / `fixed-width-height`) |
| `icon` | Entity + Size + effects | `library` (`lucide`, `feather`, `Material Symbols Outlined/Rounded/Sharp`, `phosphor`), `icon` (name), `weight` (100–700, variable-weight libraries only), `fill` (the glyph color) |
| `note` | Entity + Size + TextStyle | `content`: sticky note |
| `prompt` | as note | `model`: a runnable AI prompt on the canvas |
| `context` | as note | context material for AI |
| `script` | Size + `clip` | `scriptUri` (relative .js), `inputs` `{name: literal or $var}` |
| `browser` | Size + effects + stroke + `cornerRadius` | `url`, `deviceId`, `zoom` (default 1), `scrollX`, `scrollY` |
| `ref` | Entity + any override keys | `ref` (component id, or `alias:id`), `descendants` |

Only `frame` and `group` hold children. There is **no image node**: images are fills. `[skill:pen-schema.md]` `[skill:SKILL.md]`

### 4.8 TextStyle

`fontFamily`, `fontSize`, `fontWeight` (string such as `"600"` or `"bold"`), `letterSpacing`, `fontStyle`, `underline`, `strikethrough`, `lineHeight` (a multiplier of font size; the font's default when unset), `textAlign` (`left`, `center`, `right`, `justify`), `textAlignVertical` (`top`, `middle`, `bottom`), `href`.

Text color comes from `fill`. **Text has no default fill and is invisible without one.** There are no per-run spans, no padding, and no style cascade from parents. `[skill:pen-schema.md]` **INFERRED:** mixed styling needs several text nodes inside a horizontal frame.

### 4.9 Paint (fills and strokes)

`fill` and `stroke` both take `Fill | Fill[]`. Arrays paint in order, so the last entry is on top.

| Variant | Fields |
|---|---|
| bare color | `"#RRGGBB"` or `"$var"` |
| `color` | `color`, `enabled`, `blendMode` (opacity only through hex alpha) |
| `gradient` | `gradientType` (`linear` / `radial` / `angular`), `colors: [{color, position}]`, `center {x,y}` (normalized, default 0.5/0.5), `size {width,height}` (normalized; for linear, height is the length), `rotation` (degrees CCW, 0 = up), `opacity`, `enabled`, `blendMode` |
| `image` | `url` (relative to the .pen file), `mode` (`cover` default, `contain`, `stretch`), `opacity`, `transform` (affine crop in normalized image space), `enabled`, `blendMode` |
| `shader` | `url` (WebGL1 GLSL fragment file), `uniforms` `{name: number, bool, hex, number[] or $var}`, `opacity`, `enabled`, `blendMode` |
| `mesh_gradient` | `columns`, `rows`, `colors[]` (row-major), `points[]` (each `[x,y]` or a point with bezier handles), `opacity`, `enabled`, `blendMode` |

**Blend modes (18):** normal, darken, multiply, linearBurn, colorBurn, light, screen, linearDodge, colorDodge, overlay, softLight, hardLight, difference, exclusion, hue, saturation, color, luminosity.

**Stroke:** `stroke` (paint), `strokeWidth` (number or `{top,right,bottom,left}`, so per-side borders are possible), `strokeLinecap`, `strokeLinejoin`, `strokeAlignment` (`inner`, `center`, `outer`). No dash pattern.

**Effects:** `{type:'blur', radius}`, `{type:'background_blur', radius}`, `{type:'shadow', shadowType: inner|outer, offset, blur, color, blendMode}`. No spread.

`[skill:pen-schema.md]`

Generated images begin with a placeholder URL `pencil:pending-image-...` that is rewritten when the asset arrives. `[skill:generate.md]`

### 4.10 Components and instances

- **Component:** any node with `reusable: true`.
- **Instance:** `{ type: "ref", ref: "<componentId>", ...rootOverrides, descendants: { ... } }`. Any property of the component root can be overridden inline, for example `width: "fill_container"` or `x`/`y`. An instance outside a layout needs both `x` and `y`. `[skill:guide/components.md]`
- **Descendant overrides:** one *flat* map. Keys are a descendant id, a slash path through nested instances (`"inst/child"`, any depth), or a unique descendant name. "DO NOT create multiple levels of descendants objects." `[docs/pen-format]` `[skill:guide/components.md]`
- The agent skill documents **two** override forms, chosen by whether the entry has a `type` key `[skill:pen-schema.md]` (`Ref.descendants`):
  1. **Property override:** `{ "label": { "content": "OK" } }`
  2. **Full replacement:** the entry contains `type`, so the whole subtree is replaced by a new complete node. **INFERRED (not reproduced from a documented example):** the map key keeps the original descendant id while the replacement node carries its own new id.
- The public format docs and example files show a **third** form, **children replacement**: the entry has only `children: [...]`, so the node stays and its children are swapped. This is how slot content is stored. `[docs/pen-format]` `[docs/build-ds]`. The agent skill does not document this form; it tells agents to use `Replace`, not `Update`, to change an instance's children `[skill:execute.md]`.
- **Deletion** inside an instance is emulated with `enabled: false`. Instance descendants cannot be deleted. Inherited layers cannot be freely reparented. `[skill:execute.md]` `[docs/components]`
- An instance has no children of its own. Its subtree is resolved from the component. Overrides do not cascade. `[skill:guide/components.md]`
- **Copying** a reusable node produces a connected instance. **Detaching** keeps nested instances and variable references linked. `[skill:execute.md]` `[docs/components]`
- **Variants:** there is no first-class system. The convention is `Group/Variant` naming (Button/Primary, Card/Plan), confirmed in a live file. `[skill:guide/design-system.md]` `[mcp:get_app_state]`

### 4.11 Slots

- A slot is an *empty frame inside a component origin* with `slot: [recommendedComponentIds]`. Suggestions do not restrict what goes in. `[docs/slots]`
- Content added in an instance belongs to that instance and gets fresh, unprefixed ids owned by the consumer.
- Serialization, from the official example `consumer.pen`:

```json
"descendants": {
  "v:NyBbQ": {
    "children": [
      { "id": "HvKJf", "type": "ref", "ref": "v:JQDNA",
        "descendants": { "v:oCKiT": { "content": "Save" } } }
    ]
  }
}
```

`[docs/build-ds]`. An unused slot is hidden with `enabled: false`. Whether the MCP `Insert(inst/slot, ...)` always writes the `{children}` form is **INFERRED**, not observed.

### 4.12 Design libraries and imports

- A library is an ordinary document with a `.lib.pen` suffix. The JSON has no "isLibrary" flag. Converting a file to a library cannot be undone. `[docs/libraries]` `[docs/build-ds]`
- The consumer declares `"imports": { "v": "starter.lib.pen" }` and references library ids as `alias:id`. The prefix applies everywhere a library id appears: `ref` (`"v:C9A2z"`), descendant keys (`"v:jnbOp"`), refs nested in slot content, and theme axes (`"theme": {"v:Theme": "Dark"}`). Consumer-owned ids are not prefixed. `[docs/build-ds]`
- Library variables and themes **are not copied in**. They stay in the library and resolve at render time. Library changes load when the consumer is reopened, and instance overrides still win. `[docs/libraries]`
- **Paste without import** copies content verbatim. Referenced variables and themes travel with it, and name conflicts get a "Use existing" / "Add renamed" dialog. `[docs/libraries]`
- The schema allows any relative `.pen` URI as an `imports` value `[skill:pen-schema.md]`; the `[docs/libraries]` workflow is what produces `.lib.pen` files. The skill does not explain what `imports` is for.
- The agent-facing rule "You cannot reference components across files" `[skill:guide/components.md]` is stated without qualification. **INFERRED:** it means plain (non-imported) `.pen` files, which would reconcile it with the library feature. The bundled design-system guide and the execute API never mention imports. `[skill:guide/design-system.md]` `[skill:execute.md]`
- **INFERRED:** a consumer node binding a library variable directly is written `$v:accent`, and nested library paths are written `v:inst/v:child`. Neither is verified.

### 4.13 Variables and themes

```jsonc
// Shape (paraphrased)
"themes": { "mode": ["light", "dark"], "accent": ["violet", "coral", "teal"] },
"variables": {
  "--radius-m": { "type": "number", "value": 8 },
  "--accent": { "type": "color", "value": [
      { "value": "#6D5BFF", "theme": { "mode": "light", "accent": "violet" } },
      { "value": "#8B7DFF", "theme": { "mode": "dark",  "accent": "violet" } }
      // ...
  ] }
}
```

- Types: `boolean`, `color`, `number`, `string`. Names must not start with `$`, which is only the reference prefix. The usual convention is `--`-prefixed names (`$--background`, `$--primary`). Aliases (a variable whose value is another `$var`) are allowed. `[skill:pen-schema.md]` `[skill:guide/design-system.md]`
- **Default theme:** the first value of each axis. `[docs/pen-format]` `[docs/variables]`
- **Matching:** "the value that wins during evaluation is the *last* one whose theme is satisfied". `[docs/pen-format]`
- **Inheritance:** a node's `theme` overrides only the axes it names. Other axes are inherited from ancestors. Removing it restores inheritance. `[docs/variables]`
- **INFERRED (unverified):** instances resolve in the theme of where they are *placed*, not where the component is defined. This follows from the per-node, per-axis inheritance rule above `[docs/variables]`, but no doc states it for instances and no reproducible observation is recorded in the research notes.
- **No-match case: unspecified.** No doc says what happens when no entry matches. The docs only advise "Define a value for every theme you use". `[docs/variables]`. A plain non-array value applies under every theme. (A WebFetch summary claiming "first defined value as default" was a summarizer hallucination and is not cited.)
- `SetVariables` merges by default (`replace: true` overwrites) and auto-registers unknown axes and values. `[skill:execute.md]`

### 4.14 Script and shader protocols

**Script node** `[docs/code-on-canvas]` `[skill:scripts-and-shaders.md]`
- An external `.js` file referenced by a relative path. It must start with `/** @schema 2.11 */`.
- Inputs are declared as `@input name: type [= default]`. Types: number (min/max), string, boolean, color, `ref` (a component), `enum("a","b")`. Inputs appear as property-panel controls and can bind to variables.
- The script receives a `pencil` global (`width`, `height`, `input.<name>`) and returns an array of `.pen` nodes, which are rendered as children.
- Sandbox: no DOM, network or fs; synchronous; 2-second limit; at most 1000 nodes; no components. `Math.random` is reseeded deterministically. The output is derived state outside undo. "Convert to layers" takes a snapshot. The file is watched and reloads live. Samples live in the MIT repo `highagency/pencil-scripts`.

**Shader fill** `[skill:scripts-and-shaders.md]`
- WebGL 1.0 (`#version 100`) fragment shader, plus `textureSize()`.
- Uniforms: float/int, vec2–4/ivec2–4, sampler2D (an image URL).
- Annotations: `@color`, `@default`, `@resolution`, `@mouse`, `@time`, `@sdf` (the node's shape as a signed-distance texture), `@backdrop` (the content behind the node, for glass effects), `@min`, `@max`, `@range`, `@label`. Auto-bound uniforms must not appear in `uniforms`.
- A known bug: changes to a shader file (or to a fill's shader `url`) are not reloaded on existing nodes. `[gh pen#10]` ("Shader file/url changes are not reloaded on existing nodes, and same-call TakeScreenshot returns a stale frame", open)

### 4.15 Assets and on-disk layout

- All URIs (images, shaders, scripts, imports) are relative to the `.pen` file's directory. The docs say to keep them at their relative paths in the repo. `[skill:pen-schema.md]` `[docs/pen-files]`
- Public repos use a shared `./images/` folder. AI-generated images are named by millisecond timestamp (`generated-1774549681450.png`). civitai/civitai `designs/`
- Unsaved drafts live in `~/.pencil/documents/<uuid>/`, draft resources in `~/.pencil/resources/<uuid>/images/`, and recovery backups in `~/.pencil/backup/`. `[local:userdata]` (the mapping is INFERRED)
- ZIP is used only for share downloads and multi-file export. `[docs/sharing]` `[docs/import-export]`
- Versioning: older formats are converted on open, and saving writes the new format. **INFERRED:** an upgrade can rewrite a whole file in git even with no design change. The vendor "reserve[s] the right to introduce breaking changes". `[docs/pen-format]`
- Git: the file is diffable but not mergeable. A nested tree means reparenting or reordering produces large textual diffs (INFERRED). The official conflict advice is to pick one side and redo the other side's changes by hand. `[docs/pen-files]`

### 4.16 Authoring conventions the agent skill enforces

Name every node. Omit default values, except when overriding inside an instance. Top level holds only screens, components and major containers, with components at the top and screens below, growing right and down. Screens are top-level frames with `clip: true`. Mobile screens are vertical with `height: fit_content(844)`. There is no scrolling. Set `placeholder: true` while working on a frame. "The document is multiplayer and may change concurrently": re-read, don't recreate, and don't undo the user's changes. `[skill:SKILL.md]` `[skill:guide/mobile-app.md]`

---

## 5. The MCP and agent tool API

### 5.1 Topology

```
external agent (Claude Code, Codex, Gemini CLI, Claude Desktop, …)
      │  stdio (MCP)
      ▼
mcp-server-<os>-<arch>   (native Mach-O, ~4.5 MB; flags -app -agent -conversation_id -enable_spawn_agents)
      │  Unix socket ~/.pencil/socket/pencil-desktop.sock  (named pipe on Windows)
      ▼
Pen desktop app (Electron main + editor renderer)  ← owns the open document and canvas
```

`[docs/ai-integration]` `[local:app]` (lsof shows the MCP process fd connected to the app's socket endpoint; the wire protocol was not inspected)

The app writes MCP config entries itself for Claude Code CLI (`~/.claude.json`), Codex (`~/.codex/config.toml`, shared by the ChatGPT desktop app and the Codex IDE extension), Gemini CLI (`~/.gemini/settings.json`), Antigravity, OpenCode, Kiro and Claude Desktop, via Settings → MCP. The entries look like `args: ["--app","desktop","--agent",<agentId>]` with an empty env and no secrets. `[docs/install]` `[local:userdata]`

### 5.2 History of the tool surface

The pre-1.2 tools were granular: `batch_design` `[gh pencil#17]`, `batch_get` `[gh pencil#12]`, `export_nodes` `[gh pencil#20]`, `get_style_guide_tags` `[gh pencil#9]`, `open_document` `[gh pencil#22]`, `replace_all_matching_properties` `[gh pencil#16]` (all in issue titles), and `get_editor_state` (named in the body of `[gh pencil#20]`). These were merged into one `execute` DSL tool. The `browser` tool description still mentions `batch_get`. `[mcp:browser]`

### 5.3 Current tools

| Tool | Inputs | Behavior |
|---|---|---|
| `get_app_state` | none | Markdown: active file path, selection (id, type, name), top-level nodes with "user visible" / "outside viewport" hints (truncated after ~10, then "+N others"), reusable components as `id: name`, integrated browser state. Acts as the onboarding entry point. `[mcp:get_app_state]` |
| `read_skill` | optional `path` | No path returns SKILL.md (the `pen-dev` skill) with a quick-reference index. Paths return pen-schema.md, execute.md, generate.md, whiteboard.md, scripts-and-shaders.md, guide/{code, components, design-system, landing-page, mobile-app, slides, table, tailwind, web-app}.md. `guide/web-app.md` refers to a `brand.md` that is not shipped (ENOENT). Keeping docs out of tool descriptions keeps the schemas small. `[skill:SKILL.md]` |
| `get_style` | `name?`, `params?` | Three-step progressive call: `()` lists ~60 archetypes; `({name})` returns the required params (palette from ~26, roundness, elevation, four font roles from ~75 Google fonts); `({name, params})` loads prose plus YAML tokens (surface/foreground/accent, rounded scale, shadow effects). Reference only: writes nothing. `[mcp:get_style]` |
| `execute` | `filePath` (marked required in the schema, yet described as "An optional file path to access a .pen file"); `input` (JS) **or** `editId` + `edits[]` | Sandboxed JS against the document. See 5.4. The required-vs-"optional" contradiction (also in `browser`) is relevant to the fallback-to-active-document problem in 5.7. `[mcp:execute]` `[mcp:browser]` |
| `browser` | `filePath`, `action` ∈ {load-page, import-to-canvas, screenshot-to-canvas, return-element, return-screenshot, cdp}, `nodeId?`, `target` ∈ {full-page, selection, query}, `querySelector`, `url`, `method`+`params` | Desktop-only. Imports live pages as editable layers (`context` holds the source tag and the detected component name), returns the DOM plus computed styles, and gives raw CDP access for click/type/scroll/evaluate. The schema description was truncated after `url`. `[mcp:browser]` |
| `spawn_agents` | `filePath`, `config: [{prompt, containerNodes[]}]` | Only with `-enable_spawn_agents`, so it is absent from this session. See 5.6. `[docs/ai-integration]` `[local:app]` |

### 5.4 `execute` in detail

**Runtime model** `[skill:execute.md]` `[mcp:execute]`
- A global `document` holds the root id (the string `'document'`). The sandbox has no `setTimeout`, `fetch`, `require` or `structuredClone`.
- Each call is a **transaction**. On any error, all mutations *and* globals created in the call are rolled back, and Print and screenshot output is discarded (observed).
- Undeclared assignments (`x = Insert(...)`) persist as session globals across calls. `const` and `let` stay local.
- Paths are a node id or `instanceId/childId`. `/` is only for crossing instance boundaries.

**Mutation ops**

| Op | Semantics |
|---|---|
| `Insert(parent, node)` → id | Inserts one node, appended at the end. Ids are always generated by the server. |
| `Copy(path, parent, overrides?)` → id | Copying a reusable node creates an instance. Descendant overrides must go in `descendants` here, because copied descendants get new ids. |
| `Update(path, partial)` | Cannot change `id`, `type`, `ref` or `children`. |
| `Replace(path, node)` → id | Full swap. Used for instance slots and descendants. |
| `Move(path, parent?, index?)` | |
| `Delete(path)` | Cannot delete instance descendants (use `enabled:false`). |
| `SetVariables(vars, replace?)` | Merge by default. Auto-registers theme axes and values. |
| `Generate(...)` | Async asset jobs (5.5). |

**Read ops**

| Op | Semantics |
|---|---|
| `Get(path, opts)` | Returns the subtree as pure schema data that can be fed back into Insert/Copy/Update/Replace. Options: `depth` (elided children appear as the string `"..."`), `resolveVariables`, `resolveInstances`, `includePathGeometry`. Unknown option keys are ignored silently (observed). |
| `Get(path?, visitor, opts)` | Top-down visitor that collects non-undefined returns. `ctx`: `depth`, `index`, `bounds` (resolved, in parent space), `problems` (`'partially clipped'` or `'fully clipped'`), `parentCtx`, `skipChildren()`. A whole-document visitor starts at depth 0 = top-level children. |
| `Get(document)` without a visitor | **Refused** on purpose: "Reading the whole document without a visitor would return everything!" (observed) |
| `GetVariables()` | `{variables, themes}` |
| `FindEmptySpace({width, height, direction, padding, nodeId})` | Returns `{x, y, parentId?}`; defaults `direction: 'right'`, `padding: 0`. When `parentId` is present the caller should insert into that parent. Observed example: `{"x":4640,"y":0}` `[skill:execute.md]` `[mcp:execute]` |
| `Print(...)` | Appends output lines. Quirks: functions print as source, a Map prints as `{}`, NaN prints as `null`. |
| `TakeScreenshot(ids or ['document'])` | Attaches images. `[skill:execute.md]` says "The screenshots reflect the changes made earlier in the same execute call", but open issue `[gh pen#10]` (symptom 2, Windows) reports that a same-call screenshot returns the pre-mutation frame and only a later call shows the change. |
| `Export(ids, fmt, path, opts)` | `png`, `jpeg`, `webp`, `pdf`, `html-tailwind`, `html-css`. Options: `scale` (default 2), `quality`, `includeHtmlScaffold`, `includeLayerNames`, `includeLayerIds`. Images are written per node as `<nodeId>.<ext>`, PDF as a combined `export.pdf`, HTML as one file. |

**Response envelope (observed)**
- Success: plain markdown with `OK`, a blank line, `## Print output`, then one line per Print. No path, revision or status field is echoed.
- Failure: an MCP `isError` result with `### Failure during operation execution` → `#### Errors in the input code:` → a fenced block holding either `Failed to execute: Error: <msg>\n  at: \`<snippet>\`` or `- \`<stmt>\`: Error: Can't find node 'X'!`. That is followed by "All operations in this block have been rolled back", an instruction to retry with `edits`, and an `editId`. Syntax errors use the same shape. There are no error codes.
- Mutating calls are documented to add a **warnings list** (to be fixed on the next call) and a **name → id map** of created nodes. Their exact format was not observed (no mutations were made).

**Patch-retry protocol (observed)**
- Retry with `{filePath, editId, edits:[{find, replace, all?}]}` and no `input`. The server patches the stored failed snippet (each `find` must match exactly once unless `all:true`) and re-runs it from scratch.
- A `find` that does not match is an error, and the stored snippet is *not* modified. An unknown `editId` gets "Resend the full corrected snippet". A patched snippet that fails again keeps the same `editId`.

**Validation layers** `[skill:SKILL.md]` `[skill:execute.md]`
1. Schema errors on unsupported values (percent sizes, `baseline`/`stretch`, margin, padding on non-frames) roll the call back.
2. Returned warnings.
3. Layout problem detection through `ctx.problems` and `ctx.bounds`.
4. Skill guidance to verify each section right away (collapsed layout, clipping, contrast, alignment).

### 5.5 Asset generation (`Generate`)

Types: `ai` (prompt → image fill), `stock` (Unsplash query → image fill), `svg` (prompt → vector paths in a placeholder frame), `vectorize-image` (`Generate('vectorize-image', nodeId, imageUrl)`, returns nothing and inserts paths into the target frame asynchronously, like `svg`), `remove-background` and `replace-background` (`(imageUrl)` and `(imageUrl, prompt)`; only these two return a new asset URL to apply with Update). `[skill:execute.md]` All are async. Fills show `pencil:pending-image-...` until the asset arrives, and frame generators clear `placeholder` when done. **Failures are silent**: the agent detects them by polling with cheap `Get` reads. Inputs: JPEG/PNG/WEBP, ≤ 16 MB, 256–4096 px. `[skill:generate.md]`

### 5.6 How agents use it

**External agent loop (as the skill prescribes)** `[skill:SKILL.md]`
1. `get_app_state` gives the file, selection and components.
2. `read_skill()`, then the relevant guides (schema, execute, plus guide/web-app or mobile-app and so on).
3. Optionally `get_style` to pick an archetype and apply its tokens via `SetVariables`.
4. `execute`: `FindEmptySpace`, then insert a root frame with `placeholder: true`, build one section per call, and check with `Get` visitors (bounds and problems) plus a small `TakeScreenshot`.
5. Fix warnings through `editId` patches. Clear `placeholder` at the end.
6. Optionally `Export` to HTML+Tailwind, or let the coding agent write framework code by reading the design.

**Built-in agent** `[local:app]` (package and folder names only) `[docs/ai-agents]` `[gh pen#3]`
- The internal package `@ha/agent` wraps **four runtimes** with backend folders `claude`, `codex`, `cursor` and `pi`:
  - Claude: `@anthropic-ai/claude-agent-sdk` 0.3.284 with a bundled native `claude` binary (216 MB). Handles Anthropic API keys, Bedrock, Vertex, Foundry, and "your Claude Code settings".
  - Codex: `@openai/codex-sdk` 0.159.2 (Apache-2.0, a 315 MB vendor binary). Handles ChatGPT sign-in and OpenAI keys.
  - Cursor: `@cursor/sdk` 1.0.22 (proprietary).
  - Pi: the MIT `@earendil-works/pi-ai` / `pi-agent-core` / `pi-coding-agent` 0.87.1. Handles Gemini, OpenRouter, xAI, Moonshot, Kimi, Deepseek, Together, Fireworks, Z.AI, OpenCode, custom endpoints and "Sign in with Claude (Pro/Max)" (provider list per `[docs/auth]`). **INFERRED:** Pi also serves the hosted "pen.dev Pro" models, and GitHub Copilot probably goes through Pi too.
- **One tool surface (INFERRED).** The MCP binary accepts `-agent` and `-conversation_id` flags (`ps` output), which suggests the Claude and Codex backends launch the same stdio MCP binary per conversation. An internal `@ha/mcp` package exists (package name only); that Pi and Cursor get in-process tools built from the same schemas is an inference. The CLI exposes the same tools `[docs/cli]`. The tool layer appears to be the stable core and the LLM runtime swappable.
- **Bug from this design** `[gh pen#3]`: Pi encodes a model as the delimited string `<type>;<provider>;<modelId>`. A plain Gemini id breaks the parse and silently falls back to Pi's default Anthropic model.
- **Permissions** use each runtime's own system (Claude Agent SDK `canUseTool` / `permissionMode`; Codex sandbox and approvals), surfaced as Allow/Deny, "Switch to Auto" (Claude only) and "Dangerously skip permissions" `[docs/ai-agents]`. **INFERRED:** the agent is prevented from touching the `.pen` file directly, so that all edits go through the tools.
- **Skills:** custom SKILL.md folders can be selected from the slash menu `[docs/ai-agents]`. **INFERRED:** spawned children do not inherit the parent's skills, so the parent has to name the guide or style in each child's prompt.

**Parallel agents (`spawn_agents`)** `[docs/ai-agents]` `[docs/ai-integration]`
- The MCP binary has an `-enable_spawn_agents` flag (`ps` output, `[local:app]`), and the tool is absent from this session. Its input shape (`filePath`, `config: [{prompt, containerNodes[]}]`, where `containerNodes` are the node ids the child should work in) is as listed in 5.3; the internal tool description was not read.
- Agents are shown as cursors on the canvas `[docs/ai-agents]` `[tweets]`. The founder describes it as "just agents writing to a JSON file". `[tweets]`
- **Scope enforcement is undocumented.** The public docs describe how work is split, not whether writes outside an agent's containers are blocked. **INFERRED:** scope is held by prompts rather than an ownership check; this is untested.
- Modes: **Split Work** (the lead agent splits the work into placeholder sections), **Side by Side** (a coordinator creates N numbered root frames and spawns N−1 agents with empty prompts that the app fills in; the model can differ per agent), and **Let it cook** (2–6 *sequential* variants, iterating on Layout or Style).

### 5.7 Persistence, targeting and concurrency weaknesses

| Problem | Evidence |
|---|---|
| Agent edits stay in memory until the user presses Cmd+S. No autosave, no MCP save tool | `[gh pen#4]`; doula-cloud#1469 |
| An unopened `filePath` reportedly falls back to the active document, so edits land in the wrong file (third-party claim, not reproduced by the #13 reporter). The `execute`/`browser` schemas mark `filePath` required but describe it as "optional", which fits a fallback design | `[gh pen#13]`; github.com/baroned1707/pen-multi-mcp; `[mcp:execute]` |
| A same-call `TakeScreenshot` reportedly returns the pre-mutation frame, contrary to the docs, so agents chase phantom failures | `[gh pen#10]` (open) |
| `open_document` truncated a 130 KB file to `{"version":"2.11","children":[]}` and returned success | `[gh pencil#22]` |
| `pen interactive` load failure → empty doc → `save()` overwrote a 1.4 MB file and exited 0 | `[gh pen#6]` |
| CLI app-mode save reports "Saved" for documents that are not open | pen-multi-mcp README |
| No revision, `baseRevision` or lock in any schema. Concurrency is handled by "re-read" advice | `[skill:SKILL.md]` `[gh pen#13]` |
| Catch-all errors: multi-node `export_nodes` failed with "MCP error -32603 … you are probably referencing the wrong .pen file" although the path was correct, and the session stayed broken until the app was restarted (v1.1.57, pre-`execute` API) | `[gh pencil#20]` ("export_nodes MCP tool fails with -32603 when exporting 2+ nodeIds, error message misleading") |
| Bridge hangs, ~70 zombie mcp-server processes in Cursor | `[gh pencil#21]` |
| MCP config clobbering between desktop and IDE extension | `[gh pen#1]` |
| Invalid empty-properties JSON schema broke OpenAI-compatible providers | `[gh pencil#9]` |
| How an agent `execute` maps to the user's undo stack is undocumented (INFERRED: one transaction) | `[skill:execute.md]` |

### 5.8 Assessment of code-as-API (INFERRED)

Putting create/read/update/delete into one sandboxed JS tool lets an agent loop and compose in a single round trip with small payloads. Patch-retry saves tokens. The costs: edits are opaque scripts rather than declarative, diffable ops; errors are found only at runtime; responses are prose that agents must parse; and portability depends on a proprietary runtime.

---

## 6. App architecture

### 6.1 Observed

| Aspect | Observation | Source |
|---|---|---|
| Shell | Electron **44.2.0** (`AtomApplication`, Squirrel/Mantle/ReactiveObjC frameworks). App code in `Resources/app.asar` (174 MB) with ASAR integrity hash. Ships `LICENSE.electron.txt` and `LICENSES.chromium.html` | `[local:app]` |
| Identity | Bundle `dev.pencil.desktop`; display name "Pen" 1.2.15; © High Agency, Inc.; macOS ≥ 13; arm64; Xcode 16.4 / macOS 15.5 SDK | `[local:app]` |
| Size | ~1.0 GB total: `app.asar.unpacked` 568 MB (mostly bundled agent runtimes), `app.asar` 174 MB, plus Electron/Chromium | `[local:app]` |
| Registrations | Document type `pen` ("Pencil Design File", Editor); URL scheme `pencil://`; renderers run with `--standard-schemes=pencil`; ATS allows localhost HTTP | `[local:app]` |
| Processes | Standard Electron helpers (GPU, Renderer, Plugin), crashpad, NetworkService, one renderer per window/webview | `[local:app]` |
| MCP | A separate native binary `out/mcp-server-darwin-arm64` (4.5 MB, a Go binary per the gap notes) talking to the app over a Unix socket | `[local:app]` |
| Bundled runtimes | claude-agent-sdk (+216 MB binary), codex-sdk (+315 MB), cursor sdk (+`cursorsandbox`, `rg`), pi-* (MIT), esbuild 0.28.2, `@google/genai`, `openai` | `[local:app]` |
| Agent skill | Plain markdown at `app.asar.unpacked/out/skills/pen-dev/` | `[local:app]` |
| Embedded browser | Chromium partition `Partitions/pencil-browser-view` (610 MB) + `~/.pencil/browser-previews` | `[local:userdata]` |
| Updates | `app-update.yml` (provider github, `highagency/pen-desktop-releases`), Squirrel.Mac/ShipIt caches, `installOnAppQuit=false` | `[local:app]` `[local:userdata]` |
| User data | Electron profile + `config.json` (keys: provider login types, `enabledIntegrations`, `workspaceFolders` mapping each `.pen` to a code folder, `customSkills`, …) + `recent-documents.json` | `[local:userdata]` |
| `~/.pencil` | `socket/`, `sessions/`, `claude-sessions/*.jsonl`, `pi-sessions/*.jsonl`, `agent-auth/`, `models-store.json`, `skills/`, `resources/<uuid>/`, `previews/`, `documents/`, `backup/`, `apps/` (contents not read) | `[local:userdata]` |
| Web/embed | `app.pen.dev` editor; MessagePort bridge where the embedder provides storage load/write/asset functions and the editor exposes `get-mcp-schema` and `mcp-tool-call`; `@pen.dev/sdk` | pen-embed-demo |

### 6.2 Inferred

| Aspect | Inference | Basis |
|---|---|---|
| Renderer | WebGL-based (shader fills are WebGL1). Whether it is CanvasKit, custom WebGL or WebGPU **cannot be determined**: no CanvasKit, Skia, PixiJS or WebGPU strings in the skill docs; GPU caches are generic Chromium | `[local:app]` `[skill:scripts-and-shaders.md]` |
| UI served from a privileged custom protocol | `--standard-schemes=pencil` | `[local:app]` |
| esbuild used at runtime | for user scripts or generated code | `[local:app]` |
| Telemetry | Sentry Electron SDK (a `sentry/` folder with scope and session files) | `[local:userdata]` |
| Document ownership | The main process or editor renderer owns the document. External MCP edits arrive over the socket. Pi and Cursor tools probably go over in-app IPC | `[local:app]` |
| Old routing | In v0.6.28, with a file open in both the IDE extension and the desktop app, MCP edits went to the extension's unsaved buffer and the desktop app refreshed only after a manual save there. Which instance receives MCP edits was ambiguous | `[gh pencil#8]` ("MCP changes not reflected in Desktop app until manually saved in Cursor") |
| Legacy userdata | A `~/Library/Application Support/Pencil` folder left over from the old name | `[local:userdata]` |

### 6.3 What the architecture explains

- **Size and coupling.** Bundling three vendor agent CLIs makes the app about 1 GB and ties its release cadence to theirs (INFERRED).
- **One tool core, many hosts (INFERRED).** The same tools appear to serve the MCP binary, the in-process agents, the CLI and the embed bridge. If so, this is a good decision.
- **Fragility at the edges.** A separate MCP process plus a socket plus an in-memory document plus explicit save is where the data-loss and stale-state bugs cluster (5.7).

---

## 7. Strengths to keep, weaknesses to fix

### 7.1 Strengths to keep

| Strength | Why it matters | Source |
|---|---|---|
| Design files in git next to code; workspace-folder link to the code repo | The core reason developers like it | `[reviews]` (HN, jeradbitner) `[local:userdata]` |
| CSS-flex-shaped model (fit/fill/fixed, gap, padding, justify/align) | Maps almost 1:1 to Tailwind/CSS; easy for LLMs | `[skill:guide/tailwind.md]` |
| `reusable` + `ref` + flat ID-path `descendants`, with property and full-replacement overrides (plus children replacement in the public format) | Small, expressive, JSON-friendly | `[skill:guide/components.md]` `[skill:pen-schema.md]`; children form `[docs/pen-format]` `[docs/build-ds]` |
| Advisory slots | Composition without rigid variant matrices | `[docs/slots]` |
| Multi-axis themes, per-axis inheritance, placement-based resolution | Light/dark × brand × density in one model | `[docs/variables]` |
| Images as fills (no image node) | Simpler rendering and export | `[skill:pen-schema.md]` |
| Agent docs served as an on-demand skill | Tiny tool schemas, rich guidance | `[skill:SKILL.md]` |
| Atomic transactions, rollback, editId patch-retry, round-trippable `Get`, visitor with bounds and problems, `FindEmptySpace`, refusal of whole-document dumps | Agent ergonomics and token economy | `[skill:execute.md]` `[mcp:execute]` |
| `placeholder` flag and agent cursors | Cheap way to make parallel work legible | `[skill:SKILL.md]` `[tweets]` |
| One tool layer across MCP, in-app agents, CLI and embed (INFERRED) | Consistency | `[docs/cli]` `[docs/ai-integration]`, pen-embed-demo |
| Auto-install of MCP config into many hosts | Removes setup friction | `[docs/install]` |
| Fast WebGL canvas; Figma-like panels | Familiarity | `[reviews]` |
| Deterministic scripts with typed inputs | Generative design that diffs | `[docs/code-on-canvas]` |

### 7.2 Weaknesses and pain points to fix

| Weakness | Evidence | Kimo answer |
|---|---|---|
| Closed source; EULA bans reverse engineering and AI training | `[eula]` | MIT app, MIT spec, no such clauses |
| "Encrypted" vs "open JSON" contradiction | `[mcp:server-instructions]` vs `[docs/pen-files]` | Plain JSON forever, stated plainly |
| Nested tree: diffable but not mergeable | `[docs/pen-files]` | Flat node table + `kimo merge` driver |
| Auto-conversion on open may rewrite the whole file on save (INFERRED) | `[docs/pen-format]` (documents only convert-on-open, save-in-new-format) | Migrate only after explicit consent; autosave goes to a recovery file until then (10.2) |
| Data loss: empty doc over a real file (#6, #22); no autosave (#4) | `[gh pen#6]` `[gh pencil#22]` `[gh pen#4]` | Refuse save after a failed load; atomic write + verify; autosave |
| MCP targeting falls back to the active doc; multi-doc ambiguity | `[gh pen#13]` | Required `docId`; `DOCUMENT_NOT_OPEN` error |
| No revisions or concurrency control | `[gh pen#13]` | `revision`, `baseRevision`, `REVISION_CONFLICT` |
| Prose-only responses and catch-all errors | `[mcp:execute]` `[gh pencil#20]` | Structured result + error codes |
| Silent async asset failures | `[skill:generate.md]` | Job ids + status tool |
| Parallel-agent scope enforcement undocumented (prompt-only is INFERRED) | `[docs/ai-agents]` | Enforced write scopes in the ops layer, with per-op rules (11.3) |
| Delimited model-id strings → silent provider fallback | `[gh pen#3]` | Typed `{provider, model}`; fail loudly |
| Config clobbering, zombie processes, hard-coded hosts | `[gh pen#1]` `[gh pencil#21]` `[gh pen#12]` | Additive per-host config; process lifecycle; no backend |
| Invalid tool JSON schema broke providers | `[gh pencil#9]` | Schema CI against strict validators |
| Sign-in required even for CLI export; metered "agent days" | `[docs/cli]` `[pricing]` | No account; unlimited BYO |
| ~1 GB Electron app bundling vendor CLIs | `[local:app]` | Tauri; detect user's own CLIs; direct API |
| No multiplayer (only snapshot links) | `[reviews]` `[docs/sharing]` | Yjs model; multiplayer milestone |
| Only an HTML exporter; React etc. are prompt-only; CSS-var sync by prompt | `[docs/d2c]` `[docs/variables]` | Deterministic React+Tailwind, HTML/CSS, DTCG, SVG/PNG/PDF |
| Hex sRGB only; no OKLCH/P3; no OpenType features; one style per text node; no wrap; no dash; no shadow spread | `[docs/pen-format]` `[reviews]` (paper.design) | Extend the model (section 10) |
| Variants by naming only | `[skill:guide/design-system.md]` | Variant sets (later) |
| Theme no-match behavior unspecified | `[docs/variables]` | Specified resolver + lint |
| Unclear undo across agent and user edits; scripts outside undo | `[reviews]` `[docs/code-on-canvas]` | Per-origin undo groups; guarded replay |
| `TakeScreenshot` reported stale within one call, contrary to docs | `[gh pen#10]` (open, symptom 2) vs `[skill:execute.md]` | Render after commit, in the same call; render test in CI |
| Agent-facing docs contradict the import feature | `[skill:guide/components.md]` vs `[docs/libraries]` | Docs that explain imports |
| Not intuitive vs Figma; alignment inconsistencies; high token use; non-developers can't use it; no flow planning | `[reviews]` | Familiar UI, token-efficient tools, flows later |
| Platform bugs: gray screen on macOS 26 / Metal 4, Windows write failures, copy/paste broken in VS Code macOS, ~/.pencil missing breaks launch | `[gh pencil#11]` `[gh pencil#10]` `[gh pencil#17]` `[gh pencil#24]` `[gh pen#5]` | Create dirs lazily; WebGL fallback path; cross-platform CI |
| No i18n, no proxy support | `[gh pencil#6]` `[gh pencil#23]` `[gh pencil#3]` | i18n-ready UI strings; honor proxy env |

---

## 8. Kimo: product principles and differentiators

### 8.1 Principles

1. **Open all the way down.** The app, the format spec, the JSON Schema, the MCP tool schemas, the socket protocol and the agent skill docs are all MIT. No clause bans reverse engineering or training. The format is never encrypted or obfuscated.
2. **The file is the product.** `.kimo` must be readable, diffable, mergeable and stable. Format changes come with semver, migrations and a published changelog.
3. **Local-first, no account.** Every feature, including CLI export and MCP, works offline with no sign-in. Exceptions: the model call itself, and first use of a Google Font not yet cached (fonts are cached as document assets on first use; an offline font pack and a "no third-party fetch" setting are available). Any cloud feature is optional and self-hostable. On web, which providers work without a backend differs per provider (see Key storage in 9.2).
4. **Never lose work.** Atomic writes, autosave, crash recovery, refusing to save over a file after a failed load, and verified saves.
5. **Agents are first-class, humans stay in control.** Typed and declarative tools, enforced scopes, attributed edits, per-origin undo, suggestion and dry-run mode.
6. **Provider-agnostic by construction.** Claude is the default. Anthropic, OpenAI, Gemini, OpenRouter and any OpenAI- or Anthropic-compatible endpoint are supported. No vendored agent CLIs.
7. **Deterministic over prompted.** Exporters and token sync are code, not prompts. The agent is for creative work, not plumbing.
8. **Familiar and fast.** Figma-like interaction, a WebGL canvas, and identical raster output across the browser canvas, the headless renderer and PNG export. Code export (HTML/React) is laid out by the browser, so it matches geometry exactly but text only within a tolerance (see M7).

### 8.2 Differentiators vs pen.dev

| Dimension | pen.dev | Kimo |
|---|---|---|
| Licence | Proprietary; restrictive EULA | MIT |
| Format | JSON in practice, called "encrypted" by its MCP; nested tree; breaking changes reserved | Plain JSON spec; flat node table; semver + migrations; published JSON Schema and TS types |
| Merge | Redo by hand | `kimo merge` git driver; conflict nodes |
| MCP | 1 JS-DSL tool + helpers; prose responses; no revisions | Typed op tools + optional script tool compiled to ops; structured results; revisions; inverse ops; dry-run; resources |
| AI | 4 bundled runtimes; metered; hosted Pro | One open agent loop; BYO key, unlimited; optional adapters for the user's own CLIs |
| Parallel agents | Prompt-scoped | Scope enforced by the ops layer |
| Export | HTML only; the rest prompted | React+Tailwind, HTML/CSS, DTCG tokens, SVG/PNG/PDF, deterministic (SVG/PDF from Kimo's own emitters, 9.2) |
| Color | Hex sRGB | Hex, OKLCH, Display-P3 |
| Collaboration | Snapshot links | Yjs-ready model, multiplayer milestone |
| Desktop | Electron, ~1 GB | Tauri v2 shell (OpenPencil reports ~5 MB for a comparable build `[openpencil]`) plus the CanvasKit wasm (~7 MB uncompressed) and the MCP shim; the real target is to be measured, not ~5 MB |
| Account | Required for CLI and AI | None |

### 8.3 Non-goals for v1

Hosted models, cloud sharing, real-time multiplayer, Figma `.fig` import, the live browser node, shaders, mesh gradients, slides, and `.pen` import (see section 13 for the legal and technical question).

---

## 9. Kimo architecture proposal

### 9.1 Monorepo layout (bun workspaces)

```
kimo/
├─ apps/
│  ├─ web/              React + TS + Vite editor (the whole UI; runs in the browser and inside Tauri)
│  ├─ desktop/          Tauri v2 shell: fs/dialog/watch, file association, deep links, MCP socket host (Rust) relaying to the document server, updater
│  └─ server/           (reserved; stub in v1) Bun service for later: multiplayer sync relay (y-websocket-compatible), share links,
│                       optional hosted agent/MCP over Streamable HTTP. Self-hostable; nothing in web/desktop depends on it
├─ packages/
│  ├─ core-schema/      .kimo TS types, JSON Schema (generated), validators, migrations, (de)serializer, canonical ordering
│  ├─ editor-state/     Document store (normalized node map on Yjs), command/op layer, undo groups, selection (Zustand), revisions
│  ├─ sync/             DocStore providers behind one interface: local (IndexedDB / file autosave) in v1; network provider
│                       (WebSocket to apps/server, awareness/presence) added at the multiplayer milestone without touching the editor
│  ├─ layout/           LayoutEngine interface + Yoga implementation + text measure callback
│  ├─ renderer/         Renderer interface + CanvasKit implementation (interactive WebGL + headless raster); SVG/PDF come from exporters, not CanvasKit
│  ├─ design-tokens/    Variable/theme resolver, DTCG import/export, CSS vars, Tailwind v4 @theme
│  ├─ exporters/        Node tree → IR → emitters (react-tailwind, html-css, svg from the IR, png via renderer, pdf via pdf-lib)
│  ├─ mcp-server/       Tool definitions (single source), stdio + Streamable HTTP servers, socket client, headless mode
│  ├─ ai-agent/         Provider interface + adapters, tool loop, skills, parallel agents, permissions
│  ├─ ui/               Design-system components for the editor chrome (panels, inputs, menus)
│  └─ cli/              `kimo` binary: validate, render, export, merge, gc, mcp, migrate
└─ docs/                Spec, agent skills (MIT), ADRs, this teardown
```

Dependency rule: `core-schema` ← `design-tokens` ← `layout` ← `renderer` ← `exporters`, and `editor-state` depends on `core-schema` and `design-tokens`. `mcp-server` and `ai-agent` depend on `editor-state` plus the read-side packages. `sync` depends only on `editor-state`'s `DocStore` interface; `apps/server` depends on `core-schema`, `editor-state` and `sync` (it can validate ops, run headless exports and host MCP remotely) but no app depends on `apps/server`. **Server-readiness rule:** the UI, the AI agent and MCP all mutate documents through the same `editor-state` ops, and every op carries an origin, so adding a network provider in `sync` is enough to turn on multiplayer. Only `apps/*` depend on React or Tauri. Every package below `apps` runs in Node, Bun, browser and worker contexts, so the headless MCP server, the CLI and the editor share one engine, as pen.dev does with its CLI `[docs/cli]`.

### 9.2 Library choices

| Concern | Choice | Why | Alternatives considered |
|---|---|---|---|
| UI framework | React + TS + Vite | Project plan; ecosystem; fits the user's tooling | Vue (OpenPencil uses it `[openpencil]`) |
| Package manager | bun workspaces | Project plan and user preference | pnpm |
| Renderer | **CanvasKit** (`canvaskit-wasm`, standard build, lazy-loaded, WebGL, in a worker with OffscreenCanvas where possible) | BSD-3, mature (Flutter web, Penpot's new renderer, OpenPencil). Covers every blend mode, gradient, blur, background blur, shadow, path booleans and Paragraph text in one engine. Identical output in browser, Node headless and Tauri, so MCP screenshots and exports match the canvas. Cost: the standard `bin/canvaskit.wasm` in 0.42.0 is 7,317,345 bytes (~7.0 MiB) uncompressed and `bin/full` 8,242,911 bytes; `gzip -9` gives ~2.9 MB; the brotli size is unmeasured and must be recorded (all measured locally from `npm pack canvaskit-wasm@0.42.0`). It ships in the web bundle, the desktop app and any headless runtime, so the desktop app and the MCP/CLI path should share one copy. Lazy-load and cache. **No SVG or PDF backend:** the npm build's typings expose no PDF document or SVG canvas API (checked in `canvaskit-wasm@0.42.0` `types/index.d.ts`) `[oss]` | PixiJS v8 (MIT, WebGPU, but game-oriented: strokes, booleans and typography would have to be built); raw WebGL2/WebGPU (years of work, Figma-scale); Konva (Canvas2D, CPU-bound, INFERRED); tldraw (license key required in production, so incompatible with MIT) `[oss]` |
| Future GPU path | Keep a thin `Renderer` interface | CanvasKit WebGPU is experimental (INFERRED); Figma moved to WebGPU with a WebGL fallback | |
| Layout | **Yoga** (`yoga-layout`, async wasm) behind a `LayoutEngine` interface | MIT; the model is single-axis flex with no grid, and OpenPencil did it in ~314 lines `[openpencil]`. `fill_container` → flexGrow/stretch on the parent axis; `fit_content` → auto; text sizes via a measure callback. Yoga also supports wrap, so Kimo's `wrap` extension is cheap | Taffy (block/flex/grid, faster on deep trees, immature JS bindings): revisit when grid lands; custom solver (feasible, INFERRED) |
| Text | **CanvasKit Paragraph** for shaping, wrapping, measuring and drawing | Bundled HarfBuzz, line breaking, fallback, mixed styles. Measuring and drawing with the same engine is required so `fit_content` text matches everywhere (Penpot #9574 shows the failure mode) `[oss]` | harfbuzzjs (you'd write line breaking, bidi and fallback); SDF/MSDF (small-size quality); opentype.js (no complex shaping) |
| Fonts | Google Fonts fetched on first use, then stored as content-hashed document assets (so the file renders offline and in CI); document fonts as hashed assets; optional offline font pack; a "no third-party fetch" setting (on-demand Google Fonts fetches send the user's IP to Google, a known GDPR concern in the EU); explicit fallback chain | Avoids fallback flashes and network dependence | |
| UI state | **Zustand** (selection, tool, viewport, panels) | Plan; small; works outside React | |
| Document state / CRDT | **Yjs** for v1, behind a `DocStore` adapter | Plan says Yjs-friendly. MIT, ~18 kB gz, the largest provider ecosystem (y-websocket, y-webrtc, y-indexeddb), built-in `UndoManager` with `trackedOrigins` for per-agent undo `[oss]` | **Loro** (MIT; Movable Tree CRDT prevents cycles on concurrent reparenting; fastest; thinner ecosystem). Strong candidate: the adapter keeps the switch cheap. Automerge 3 (Git-like history, lower memory). Decide at M5 (multiplayer) |
| Tree moves on Yjs | Flat `Y.Map<nodeId, Y.Map>` with `parentId` + fractional-index `order` (keys generated with random jitter, as in fractional-indexing-jittered); sibling order is normatively (`order`, then `id`) | Avoids nested Y arrays; maps 1:1 to the file's node table. The op layer rejects local cycles, but cannot stop a cycle that appears only after a CRDT or git merge (a known Yjs gap that Loro solves natively, INFERRED). Post-merge repair is normative: the node whose move has the later timestamp (ties: larger id) is reparented to its previous parent, or to the root if that is also in the cycle. Tested in the merge driver and the Yjs observer | |
| Icons | `lucide-static` (ISC), `@phosphor-icons/core` (MIT), Material Symbols (Apache-2.0), `feather-icons` (MIT, per `npm view`) | Rendered as paths. Material Symbols SVG packages are published per static weight (`@material-symbols/svg-100` … `svg-700`; `svg-400` alone unpacks to ~13 MB), so continuous or variable-bound weight is impossible from SVGs and bundling all weights is too large. Kimo uses the variable Material Symbols font and extracts glyph paths through CanvasKit, which allows any weight 100–700. All icon sets load lazily per used icon into the asset cache, never bundled whole. Kimo's set identifiers (`material-outlined`, …) differ from pen.dev's (`Material Symbols Outlined`, …); the importer keeps a mapping table `[oss]` | Static-weight SVGs restricted to the published steps |
| MCP | **`@modelcontextprotocol/server` v2** (+ `/node` adapter) | Official, current spec (2026-07-28), stdio + Streamable HTTP; MIT (`npm view @modelcontextprotocol/server@2.2.0 license`) `[oss]` | `@modelcontextprotocol/sdk` 1.x (legacy) |
| Desktop | **Tauri v2** with `plugin-dialog`, `plugin-fs` (narrow scopes, widened at runtime via `fs_scope()` on user pick), fs watch, `deep-link`, updater (GitHub Releases), file association `.kimo` | Small binary (OpenPencil ~5 MB `[openpencil]`); the security model is deny-by-default `[oss]` | Electron (pen.dev; ~1 GB with vendored CLIs) |
| MCP sidecar on desktop | A tiny `kimo-mcp` stdio shim written in Rust and shipped inside the Tauri app, launched by agents over stdio and connecting to the app over `~/.kimo/socket/kimo.sock` (named pipe on Windows) with an open JSON-RPC protocol; also Streamable HTTP on localhost with a token. Hosts without the desktop app can run `bunx @kimo/mcp` with the user's own Bun/Node | Same topology as pen.dev `[local:app]`, but the protocol is documented. Not `bun build --compile`: Bun statically links JavaScriptCore/WebKit (LGPL-2), so every distributed compiled binary carries the LGPL relinking obligation (github.com/oven-sh/bun/blob/main/docs/project/license.mdx), and it embeds the whole Bun runtime (tens of MB, INFERRED) | Bun-compiled binary, if NOTICE lists JavaScriptCore/WebKit (LGPL-2) and object files plus build instructions are published for relinking |
| Web-only MCP | The `kimo mcp --attach` CLI bridges to an open tab over a localhost WebSocket, or edits `.kimo` files headlessly. Pairing: the CLI prints a pairing URL carrying a one-time token; the tab opens the socket with it and the CLI checks `Origin`, so other websites cannot use the port. Chrome's Private Network Access rules restrict public pages talking to localhost and keep tightening (INFERRED), and editing repo files needs the File System Access API (Chromium-only). So in v1 the attach bridge and repo-file editing are Chromium-only; other browsers get download/upload. Desktop is the primary v1 editor; web v1 is for evaluation and viewing | A browser cannot host an MCP server | |
| LLM layer | **Kimo-owned `Provider` interface** (messages, tools, stream, structured output, usage). Default adapter: `@anthropic-ai/sdk` directly (prompt caching, extended thinking). Secondary: OpenAI-compatible adapter (Chat Completions + Responses) and Gemini, possibly via Vercel AI SDK v7 (pinned) or MIT `pi-ai` | First-class Claude features without lowest-common-denominator limits; the AI SDK's major-version churn is contained `[oss]` | Vercel AI SDK only (provider features arrive late, INFERRED); vendoring agent CLIs (pen.dev) |
| Default models | `claude-opus-5-5` for the agent; a faster Claude model as the "fast" option. **Verify ids against the Anthropic Models API at build time** (`claude-sonnet-5-5` is unverified) | `[oss]` | |
| Key storage and provider reach | OS keychain on desktop (Tauri keyring/stronghold, INFERRED); local-only storage on web, never synced. On web, model calls go straight from the browser: Anthropic allows this only with an explicit opt-in (`dangerouslyAllowBrowser` in `@anthropic-ai/sdk`), other providers' CORS support varies (INFERRED), and Bedrock/Vertex/Foundry need signed or OAuth credentials that are unsafe or unworkable in a browser. A published per-provider matrix states what works from a browser; Bedrock/Vertex/Foundry are routed only through desktop (Rust-side HTTP in Tauri) or a user-run local proxy | | |
| Code export | IR + emitters; Tailwind v4 `@theme`; DTCG JSON | Deterministic, testable with golden files | Prompt-only (pen.dev) |
| Script sandbox (later) | QuickJS-wasm or a worker with no network, a time limit and node caps | Matches pen.dev's sandbox properties `[docs/code-on-canvas]` (INFERRED choice) | |
| Telemetry | None by default; opt-in Sentry for crashes | OSS norms | |

### 9.3 Runtime data flow

```
User input / Agent op / MCP op / file watcher
          │
          ▼
   editor-state: validate → apply as Yjs transaction (origin = user|agent:<id>|mcp:<client>|file)
          │                         │
          │                         ├─ undo groups per origin (Y.UndoManager trackedOrigins)
          │                         └─ revision {epoch, seq++} ; op log (forward + informational inverse)
          ▼
   design-tokens resolver (themes/variables) → layout (Yoga, measure via Paragraph) → renderer (CanvasKit)
          │
          └─ persistence: debounced autosave (2–5 s, flush on blur/quit) → canonical serializer → atomic write+rename → verify hash
             (to the working file only if its format is current and no git operation is in progress; otherwise to ~/.kimo/recovery/<hash>)
```

### 9.4 Key engineering decisions

- **One tool registry.** `mcp-server` defines every tool once (zod → JSON Schema, validated in CI against strict validators). `ai-agent` consumes the same definitions in process. The CLI uses them headlessly. This mirrors what pen.dev appears to do (INFERRED, 5.6), with an open schema.
- **The document lives in the app.** MCP writes go through the running app's store, never directly to the file, so one process is the authority for each open document (cf. the ambiguous routing in `[gh pencil#8]`). In headless mode the CLI owns an in-memory store and saves explicitly and atomically.
- **Document authority inside Tauri (ADR required).** The Yjs store lives in JS, while sockets, named pipes and the localhost HTTP server live in Rust, so the relay must be explicit. Option A: the store runs in one dedicated JS context (a hidden webview or a Bun/Node document-server sidecar) and every UI window is a client. Option B: Rust relays each MCP request to the window that holds the document over request/response IPC with a timeout, and returns `DOCUMENT_NOT_OPEN` when no window holds it. Either way the ADR specifies behavior on window reload (in-flight requests fail with a retryable error; the store reloads from the last autosave plus recovery file) and when no window is open. This is the same seam where pen.dev's bugs cluster (6.3).
- **Single writer per file.** Opening a `.kimo` for writing takes a lease: `~/.kimo/locks/<path-hash>.lock` holding pid, start time and socket path. `kimo mcp` headless, `kimo migrate`, `kimo gc` and any CLI command that writes check the lease first; if the desktop app holds it, they attach to the app over the socket instead of opening the file headlessly, and otherwise fail with `DOCUMENT_LOCKED`. Stale leases (dead pid) are reclaimed.
- **Failed loads are terminal.** A store that failed to load is read-only and cannot be saved.
- **Every URI resolves against the `.kimo` file's directory** through one resolver with explicit base-URI handling (prevents `[gh pen#6]`).
- **Watching.** The `.kimo` file, `assets/`, scripts and shaders are watched. With no local unsaved edits, Kimo hot-reloads and applies the diff. With local edits, it runs a three-way merge using the same code as `kimo merge`. Caches are invalidated by content hash.
- **Editor design system (decided 2026-10-02).** The editor chrome is specified in `desing.pen` (boards 01 Foundations, 02 Components, 03–05 Editor light/agent/dark, 06 Home, 07 Export dialog). It is **monochrome**, inspired by x.ai/bot: ink on warm greys, pill actions, big flat cards, mostly no shadows. Color is reserved for meaning: `selection` (blue) on the canvas, `agent` (teal + gradient orb) for anything the AI is doing, and status colors. Tokens are layered primitive → semantic → component with a single theme axis, `mode` (light/dark). Type is Inter for UI and JetBrains Mono for values and code, with a 13px UI base. `packages/ui` and `packages/design-tokens` (for the editor's own CSS vars) are generated 1:1 from those variables.
- **Git operations are not concurrent edits (INFERRED risk).** A `git checkout`/`rebase`/`stash` while edits are pending would otherwise merge those edits into another branch's file and autosave the result. Kimo detects git operations in progress (`.git/index.lock`, a `HEAD` change, `REBASE_HEAD`/`MERGE_HEAD`/`CHERRY_PICK_HEAD`), pauses autosave, and asks the user to keep local edits (merge), discard them, or stash them as a recovery file. Covered by a fixture test: checkout during unsaved edits.

---

## 10. Kimo open file format (`.kimo`) draft

### 10.1 Container decision

- **The canonical working file is one UTF-8 JSON `.kimo` file plus an `assets/` sidecar folder** next to it. This is the shape pen.dev actually uses in practice `[docs/pen-files]`.
- **ZIP is used only for transport:** `.kimoz` ("Export as package") holds the `.kimo`, `assets/` and imported libraries. Penpot's manifest idea (format version + feature flags) is used inside the JSON header instead `[oss]` (help.penpot.app).
- **Assets are content-addressed:** `assets/<sha256-16>.<ext>`, referenced as `./assets/<hash>.png`. They deduplicate, never collide across branches, and merge as add-only. `kimo gc` removes unreferenced files. The docs recommend Git LFS via `.gitattributes` above a size threshold.
- **Never encrypted, never compressed in the working form.**

### 10.2 Serialization rules (git-friendly)

1. A header block (`$schema`, `format`, `features`, `meta`, `themes`, `imports`, `variables`, `components` index optional), then a **flat `nodes` object keyed by id**.
2. **One node per line**: each node is serialized as a single-line JSON object with canonical key order, nodes sorted by id, with a **blank line between nodes**. The separating comma is written at the **start** of each node line after the first (`, "id": {...}`), so appending or removing the last node never edits a neighbouring line, and the blank line keeps unrelated neighbours from forming one conflict hunk in plain `git merge` (INFERRED from how git's line merge works; to be measured with fixtures run through plain `git merge`, not only through the driver).
3. Tree structure is `parent` + `order` (a fractional-index string, generated with random jitter). **Sibling order is normatively (`order`, then `id`), compared lexicographically by code unit**, so equal keys from concurrent inserts render the same everywhere. Readers rebuild children lists. Root nodes have `parent: null`.
4. Defaults are omitted, per the normative defaults table in 10.3. Numbers use the shortest round-trip form.
5. **Id grammar (single rule):** `/^[A-Za-z0-9]{6,24}$/` (so never `/` or `:`), unique per document. Kimo generates 10-character base62 ids; imported ids are kept if they match, otherwise re-keyed by the importer. Override keys are id paths only, never names (10.3).
6. **Migration needs consent.** Older-format files open migrated in memory. Autosave of an older-format file goes to a recovery file (`~/.kimo/recovery/<hash>`), never to the working file, until the user accepts a one-time "Upgrade file format" prompt or saves explicitly with Cmd+S. After that, the `format` field is the single header line that changes, plus whatever the migration itself must rewrite.
7. **Forward compatibility.** A file whose `format` major or minor is newer than the app, or whose `features` include one the app does not support, opens **read-only** (saves are refused, with a "newer Kimo needed" message). Readers must preserve unknown properties and unknown node fields on round-trip. A conformance test checks that a v1.0 reader leaves a v1.1 file byte-identical after open, an edit elsewhere and save.
8. A `.gitattributes` template: `*.kimo merge=kimo diff=kimo`. `kimo diff` gives a semantic textconv summary. **Custom merge drivers only run where configured locally**: GitHub/GitLab PR merges and CI checkouts ignore `merge=kimo`. So semantic merging is documented as a local feature, `kimo merge` can also run as a pre-merge step in CI, and rules 2–3 aim to keep plain textual merges clean in the common case.

### 10.3 Schema sketch (TypeScript, normative types live in `core-schema`)

```ts
type Id = string;                 // /^[A-Za-z0-9]{6,24}$/  (no '/', no ':'); Kimo generates 10 chars
type QId = Id | `${string}:${Id}`;  // local id, or alias:id for an imported library
type IdPath = string;             // QId segments joined by '/', one per instance boundary (see "Override paths")
type Ref = { $ref: string };      // structured variable binding: { "$ref": "name" } or { "$ref": "alias:name" }
type Num = number | Ref;
type ColorLit =
  | `#${string}`                                  // #RGB #RRGGBB #RRGGBBAA (sRGB)
  | { space: "oklch"; l: number; c: number; h: number; alpha?: number }
  | { space: "display-p3"; r: number; g: number; b: number; alpha?: number };
type Color = ColorLit | Ref;

type Size =
  | Num
  | { mode: "fit"; fallback?: number; min?: number; max?: number }                  // min/max: feature "size/min-max"
  | { mode: "fill"; fallback?: number; weight?: number; min?: number; max?: number };

interface KimoFile {
  $schema: "https://kimo.design/schema/kimo-1.0.json";
  format: "1.0.0";                          // semver of the format
  features?: string[];                      // e.g. ["layout/wrap", "text/runs", "fill/shader"]; unknown → read-only (10.2 rule 7)
  meta?: { name?: string; library?: boolean; createdWith?: string };
  themes?: Record<string, string[]>;        // axis -> values, first = default
  imports?: Record<string, string>;         // alias -> relative path to .kimo (library)
  variables?: Record<string, Variable>;
  nodes: Record<Id, Node>;                  // flat table, one per line
}

interface Variable {
  type: "color" | "number" | "string" | "boolean"
      | "typography" | "shadow" | "dimension";   // composites: feature "tokens/composite" (Later, 3.3)
  value: unknown | { value: unknown; when?: Record<string, string> }[];
  description?: string;
  group?: string;                            // for DTCG export ("color.surface")
}
// Composite bindings (only with "tokens/composite"):
//   typography → TextStyle.typography; inline TextStyle fields override the token's fields
//   shadow     → Graphics.effects may be a Ref to a shadow variable (or an array of Effect)
//   dimension  → { value: number, unit: "px" } (px-only in 1.x; DTCG export writes {value, unit})

interface Placement {                        // fields that position a node; the only Base fields an Instance has
  type: NodeType;
  parent: Id | null;                         // always a node id in `nodes`, never a path
  at?: IdPath;                               // only when `parent` is an instance: the descendant inside it this node attaches to
  order: string;                             // fractional index; siblings sort by (order, id)
  name?: string;
  x?: number; y?: number;                    // ignored in flex parents unless position:"absolute"
  position?: "auto" | "absolute";
  theme?: Record<string, string>;            // per-axis pin, inherited per axis; keys may be "alias:axis"
  locked?: boolean;                          // editor state
  meta?: Record<string, unknown>;            // namespaced keys, e.g. "kimo.export.tag"
}

interface Base extends Placement {
  rotation?: number;                         // degrees, CCW, around top-left (pen-compatible)
  opacity?: Num; visible?: boolean | Ref;    // 'visible' ≙ pen 'enabled'
  flipX?: boolean; flipY?: boolean;
  component?: boolean | ComponentDef;        // ≙ pen 'reusable'; object form declares a prop API
  placeholder?: { by?: string; since?: string } | true;   // in-progress marker
}

interface ComponentDef {                     // declared component properties (≈ Figma component properties)
  props?: Record<string /* prop name, a JS identifier */,
    | { type: "text"; target: IdPath; field: "content"; default?: string }
    | { type: "boolean"; target: IdPath; field: "visible"; default?: boolean }
    | { type: "instance"; target: IdPath; default?: QId }       // swap a nested instance
    | { type: "enum"; target: IdPath; field: string; options: Record<string, unknown> }
    | { type: "slot"; target: IdPath }>;                        // → React `children` / named slot prop
}

type NodeType = "frame" | "group" | "rect" | "ellipse" | "polygon" | "path"
  | "text" | "icon" | "instance" | "note" | "prompt"
  | "script" | "browser";                    // last two: feature-flagged

interface Frame extends Base, Graphics {
  type: "frame";
  w?: Size; h?: Size;
  radius?: Num | [Num, Num, Num, Num];
  clip?: boolean | Ref;
  layout?: {                                 // absent = no flex layout (children placed by x/y)
    dir: "row" | "column";
    gap?: Num; crossGap?: Num;               // crossGap only with wrap
    pad?: Num | [Num, Num] | [Num, Num, Num, Num];
    justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
    align?: "start" | "center" | "end" | "stretch" | "baseline";   // stretch/baseline: feature "layout/stretch-baseline"
    wrap?: boolean;                          // feature "layout/wrap" (M2)
    includeStroke?: boolean;
  };
  slot?: { suggested?: QId[] };              // advisory
}

interface Graphics {
  fill?: Paint | Paint[];                    // painted in order, last on top
  stroke?: { paint: Paint | Paint[]; width?: Num | { t?: Num; r?: Num; b?: Num; l?: Num };
             align?: "inside" | "center" | "outside"; cap?: "butt"|"round"|"square";
             join?: "miter"|"bevel"|"round"; dash?: number[] };
  effects?: Effect[] | Ref;                  // Ref to a shadow variable needs "tokens/composite"
}

type Paint =
  | Color
  | { kind: "solid"; color: Color; blend?: BlendMode; visible?: boolean }
  | { kind: "linear" | "radial" | "angular"; stops: { color: Color; at: number }[];
      center?: [number, number]; size?: [number, number]; rotation?: number;
      interpolation?: "srgb" | "oklab";        // default "srgb" (.pen-compatible)
      opacity?: Num; blend?: BlendMode; visible?: boolean }
  | { kind: "image"; src: string; fit?: "cover" | "contain" | "stretch" | "tile";
      crop?: [number, number, number, number, number, number]; opacity?: Num;
      blend?: BlendMode; visible?: boolean }
  | { kind: "mesh"; cols: number; rows: number; colors: Color[]; points: unknown[] }   // "fill/mesh"
  | { kind: "shader"; src: string; uniforms?: Record<string, unknown> };              // "fill/shader"

type Effect =
  | { kind: "shadow"; inner?: boolean; x: Num; y: Num; blur: Num; spread?: Num; color: Color; blend?: BlendMode }
  | { kind: "blur"; radius: Num }
  | { kind: "backdrop-blur"; radius: Num };

type BlendMode = "normal" | "darken" | "multiply" | "color-burn" | "linear-burn"
  | "lighten" | "screen" | "color-dodge" | "linear-dodge" | "overlay" | "soft-light"
  | "hard-light" | "difference" | "exclusion" | "hue" | "saturation" | "color" | "luminosity";

interface Text extends Base, Graphics {
  type: "text";
  w?: Size; h?: Size;
  content: string | Ref | TextSpan[];        // a plain string is always literal ("$49/mo" is text, not a binding)
                                             // TextSpan[] needs feature "text/runs"
  grow?: "auto" | "fixed-width" | "fixed";   // ≙ pen textGrowth
  style?: TextStyle;                         // default fill = { $ref: "text/default" } or #000 (never invisible)
}
// Rich text is a delta sequence, not offsets: it maps 1:1 onto Y.Text attributes and merges
// under concurrent edits. Decided before spec 1.0 is frozen.
type TextSpan = { text: string; style?: Partial<TextStyle>; href?: string };

interface TextStyle {
  font?: string | Ref; size?: Num; weight?: number | Ref; italic?: boolean;
  lineHeight?: Num | { px: number };         // multiplier by default
  letterSpacing?: Num; align?: "left"|"center"|"right"|"justify";
  valign?: "top"|"middle"|"bottom"; decoration?: ("underline"|"strike")[];
  case?: "upper"|"lower"|"title"; features?: Record<string, boolean | number>; // OpenType
  href?: string;
  typography?: Ref;                          // composite token ("tokens/composite"); inline fields above win
}

interface Icon extends Base {
  type: "icon"; w?: Size; h?: Size;
  set: "lucide" | "feather" | "phosphor" | "material-outlined" | "material-rounded" | "material-sharp" | string;
  name: string | Ref;
  weight?: Num;                              // 100–700, Material sets only (rendered from the variable font)
  color?: Color; effects?: Effect[] | Ref;
}

interface Instance extends Placement {       // no Base visual fields: they go in `props`
  type: "instance";
  of: QId;                                   // local id or alias:id
  props?: Record<string, unknown>;           // overrides of the component ROOT's visual fields (w, h, fill, opacity, visible, rotation, …)
  args?: Record<string, unknown>;            // values for declared ComponentDef props
  overrides?: Record<IdPath, Override>;
}

type Override =
  | { set: Record<string, unknown> }          // property override
  | { slot: true }                            // children replaced: the children are exactly the nodes with
                                              // parent = this instance and at = this key, sorted by (order, id)
  | { replace: true };                        // full replacement: the single node with parent = this instance
                                              // and at = this key replaces the descendant
```

Design notes on the sketch:

- **Overrides are explicitly tagged** (`set`, `slot`, `replace`) instead of relying on whether a `type` key is present. This fixes the implicit pen.dev rule and the undocumented slot serialization (4.11).
- **Instance-owned nodes live in the flat table** with `parent` set to the instance id (a real `Id`, so it validates) and `at` set to the descendant path inside the instance. Slot content therefore diffs, merges and syncs like any other node, and the child list has one source of truth: the nodes that point at it, ordered by (`order`, `id`). The override entry is only a marker.
- **Override paths.** Override keys are id paths, never names (renames cannot break them). Each path segment is resolved in the namespace of the component that owns it and is written `alias:id` when it belongs to an imported library, so `"ui:CardActns1/ui:BtnLabel01"` crosses from a library card into a library button; a local component nested in a local instance uses bare ids. A segment that names a library component from a different library than its parent uses that library's alias. `kimo validate` tests paths that mix local and library components.
- **Instance vs root properties.** Placement fields (`parent`, `at`, `order`, `x`, `y`, `position`, `theme`, `name`, `locked`, `meta`) exist only on the instance. Every visual property of the component root (`w`, `h`, `fill`, `opacity`, `visible`, `rotation`, `flipX`, …) may appear only in `props`. The validator rejects a visual field at the instance top level. Declared component properties go in `args`.
- **Component properties.** A component may declare a typed prop API (`component: { props }`). The React exporter emits typed props only for declared properties (slot props become `children` or named `ReactNode` props) and inlines every other override. Without declarations, an instance is exported inline. This is part of v1 because deterministic React export is a v1 commitment (pen.dev leaves this step to the agent `[docs/d2c]`).
- **Variable bindings are structured** (`{ "$ref": "name" }`), so literal strings that start with `$` (prices, names, URLs) are never misread; pen.dev had a related bug where `$` refs were escaped `[gh pencil#16]`. The `.pen` importer turns `"$x"` strings into `{ "$ref": "x" }`.
- **Sizing is structured**: `{mode:"fill", fallback:900}` rather than `"fill_container(900)"`. This is easier to validate and to store in Yjs. The `.pen` importer converts the strings.
- **Color working space.** The document's colors are specified in their own space; rendering and export map them deterministically. The canvas surface uses Display-P3 when the display supports it, otherwise sRGB (CanvasKit surfaces default to sRGB: `canvaskit-wasm` 0.42.0 `types/index.d.ts` L225). Out-of-gamut values are gamut-mapped with the CSS Color 4 algorithm in every path (canvas, PNG, CSS emitters write the original `oklch()`/`color(display-p3 …)` value, which browsers gamut-map the same way). PNG export embeds an ICC profile for the output space. Gradients interpolate in sRGB by default for `.pen` compatibility, with optional `interpolation: "oklab"`.
- **Field names differ from pen.dev** (`dir`, `pad`, `of`, `visible`) on purpose. The concepts are borrowed, but the spec is written independently. A mapping table ships with the importer.

**Normative defaults (omitted when equal).** The table lives in `core-schema` as data; both the JSON Schema `default` keywords and the serializer's omit logic are generated from it.

| Node / field | Default | `.pen` default, if different |
|---|---|---|
| any: `visible`, `opacity`, `rotation`, `flipX`/`flipY`, `position` | `true`, `1`, `0`, `false`, `"auto"` | |
| frame `layout` | absent = no flex layout | `layout: horizontal` `[skill:pen-schema.md]` (importer writes `dir:"row"` explicitly) |
| `layout.gap`, `crossGap`, `pad` | `0` | gap `0`; padding undocumented |
| `layout.justify`, `align` | `"start"` | |
| `layout.wrap`, `includeStroke` | `false` | |
| frame `w`/`h` | `{mode:"fit"}` | `fit_content` |
| frame `clip` | `false` | |
| `Size` `fallback` / `weight` | none / `1` | |
| stroke `width`, `align`, `cap`, `join` | `1`, `"inside"`, `"butt"`, `"miter"` | (to be checked by the importer) |
| gradient `center`, `size`, `rotation`, `interpolation` | `[0.5,0.5]`, `[1,1]`, `0`, `"srgb"` | |
| image `fit` | `"cover"` | `cover` |
| shadow `inner`, `spread` | `false`, `0` | |
| text `grow` | `"auto"` | |
| text `lineHeight` | absent = the font's default | same |

### 10.4 Theme and variable resolution (normative)

1. **Effective theme of a node:** start from the document defaults (the first value of each axis). Walk from the root to the node along its **placement** path, including instance placement, so instances inherit from where they sit. At each node with `theme`, overwrite only the named axes.
2. **Library axes** are namespaced as `alias:axis`. They have their own defaults from the library.
3. **Variable value:** for a plain (non-array) value, use it under every theme. For an array, an entry **matches** when every axis named in its `when` equals the effective value of that axis; axes it does not name are ignored (partial `when` is allowed). `when` keys may be library axes (`alias:axis`). **Entries without `when` (or with `when: {}`) are fallbacks only and never candidates.** Among the matching entries, **the last one in list order wins** (pen.dev-compatible; no specificity ranking).
4. **No candidate:** use the fallback entry (the last entry without `when`) if there is one; otherwise the first entry. In both cases emit the lint `THEME_NO_MATCH(variable, effectiveTheme)`. This is specified behavior, unlike pen.dev's. Spec tests cover partial matches, fallback position (first vs last in the list) and `alias:axis` keys.
5. **Aliases** resolve recursively with cycle detection (`VARIABLE_CYCLE` error). A value that is `{ "$ref": … }` is an alias.
6. **Library variables** are referenced as `{ "$ref": "alias:name" }` and never copied on import. Paste-without-import copies the variables, with a "use existing" / "add renamed" choice.

### 10.5 Example

```jsonc
{
"$schema": "https://kimo.design/schema/kimo-1.0.json",
"format": "1.0.0",
"features": ["layout/wrap"],
"meta": { "name": "Kimo landing" },
"themes": { "mode": ["light", "dark"] },
"imports": { "ui": "./libs/kimo-ui.lib.kimo" },
"variables": {
  "surface": { "type": "color", "value": [ { "value": "#FFFFFF", "when": { "mode": "light" } },
                                           { "value": { "space": "oklch", "l": 0.18, "c": 0.01, "h": 270 }, "when": { "mode": "dark" } } ] },
  "ink":     { "type": "color", "value": [ { "value": "#111111", "when": { "mode": "light" } },
                                           { "value": "#F4F4F5", "when": { "mode": "dark" } } ] },
  "space-m": { "type": "number", "value": 16 },
  "radius-m": { "type": "number", "value": 8 }
},
"nodes": {
  "A1hero0001": {"type":"frame","parent":null,"order":"a0","name":"Hero","x":0,"y":0,"w":1440,"h":{"mode":"fit","fallback":900},"clip":true,"fill":{"$ref":"surface"},"layout":{"dir":"column","gap":24,"pad":[96,120],"align":"center"}}

, "B2title001": {"type":"text","parent":"A1hero0001","order":"a0","name":"Title","content":"Design next to your code","style":{"font":"Inter","size":64,"weight":700,"lineHeight":1.1},"fill":{"$ref":"ink"}}

, "C3row00001": {"type":"frame","parent":"A1hero0001","order":"a1","name":"Actions","layout":{"dir":"row","gap":{"$ref":"space-m"},"wrap":true}}

, "D4cta00001": {"type":"instance","parent":"C3row00001","order":"a0","name":"Primary CTA","of":"ui:BtnPrimary","overrides":{"ui:BtnLabel01":{"set":{"content":"Get Kimo — $49/mo"}}}}

, "E5card0001": {"type":"instance","parent":"A1hero0001","order":"a2","name":"Feature card","of":"ui:CardBase01","theme":{"mode":"dark"},"props":{"w":{"mode":"fill"}},"overrides":{"ui:CardActns1":{"slot":true}}}

, "F6btn00001": {"type":"instance","parent":"E5card0001","at":"ui:CardActns1","order":"a0","of":"ui:BtnGhost01","overrides":{"ui:BtnLabel01":{"set":{"content":"Learn more"}}}}

, "G7img00001": {"type":"rect","parent":"A1hero0001","order":"a3","name":"Screenshot","w":1200,"h":720,"radius":{"$ref":"radius-m"},"fill":{"kind":"image","src":"./assets/9f2c1ab04e7d3c55.png","fit":"cover"},"effects":[{"kind":"shadow","x":0,"y":24,"blur":48,"spread":-12,"color":"#0000003D"}]}
}
}
```

Notes: every id is 10 base62 characters; override keys are library-namespaced id paths; `F6btn00001` is slot content (`parent` = the instance, `at` = the slot's path); `"$49/mo"` inside `content` is literal text; `grow:"auto"` is omitted because it is the default.

### 10.6 Validation and tooling

- JSON Schema (draft 2020-12) generated from the TS types and published at a stable URL and on npm (`@kimo/core-schema`).
- `kimo validate` checks schema, referential integrity (parents, `of`, override paths, variables, assets), cycles (parent and alias), and lints: `THEME_NO_MATCH`, invisible text, `fit` parent with all-`fill` children (the circular rule from `[skill:pen-schema.md]`), unused variables and assets, clipped content.
- Migrations: `migrations/1.0→1.1.ts`, pure functions, tested with fixtures, applied in memory on open and written to the working file only after the user consents (10.2 rule 6).
- `kimo validate` also checks: no visual field at an instance's top level (10.3), exactly one `replace` node per `replace` override, `at` only under instance parents, and unknown `features` (reported, file treated as read-only).

---

## 11. Kimo MCP server tool set draft

### 11.1 Principles

- **A small set of typed tools plus an on-demand docs tool**, modeled on pen.dev's `read_skill` `[skill:SKILL.md]`.
- **Declarative ops are the source of truth.** The optional script tool compiles to the same op log, so every agent edit can be diffed, reviewed and inverted.
- **Explicit targeting.** `docId` (or an opened path) is required on every document call, and the schema says so consistently (pen.dev's `filePath` is "required" but described as "optional", 5.3). There is never a fallback to the active document.
- **`docId` lifetime.** `docId` is derived from the canonical absolute path plus the document epoch (`d_<hash(path)>_<epoch>`). It is stable while the document stays open and changes when the app restarts or the file is reloaded from disk; a stale `docId` returns `DOCUMENT_NOT_OPEN` with the current id for that path, which agents reacquire through `kimo_get_state` or `kimo_open`.
- **Structured responses** with a short human-readable summary. Error codes, never prose-only results.
- **Optimistic concurrency** through `revision` and `baseRevision`. A revision is an opaque token `{epoch, seq}`: `epoch` is a random id minted whenever the document is loaded (app start, reload, merge-on-reload), `seq` counts commits within that epoch. Integer `seq` values are meaningful only within one epoch of one app session; a `baseRevision` from another epoch always fails with `REVISION_CONFLICT`. When multiplayer arrives, the token becomes a hash of the Yjs state vector.
- **Strict JSON Schemas**, validated in CI against Anthropic, OpenAI and Gemini schema rules (avoids `[gh pencil#9]`).

### 11.2 Common result envelope

```jsonc
{
  "ok": true,
  "doc": { "id": "d_3f…_k9", "path": "/repo/design/app.kimo", "dirty": true, "lastSavedRevision": { "epoch": "k9", "seq": 41 } },
  "revision": { "before": { "epoch": "k9", "seq": 42 }, "after": { "epoch": "k9", "seq": 43 } },
  "created": { "Hero": "A1hero0001", "Title": "B2title001" },   // name -> id
  "ops": [ /* normalized forward ops */ ],
  "inverse": [ /* informational: ops that would undo this call against revision.after */ ],
  "warnings": [ { "code": "TEXT_NO_FILL", "nodeId": "B2title001", "message": "…", "fix": "…" } ],
  "prints": [],
  "images": [ /* MCP image content for renders */ ]
}
// error
{ "ok": false, "errors": [ { "code": "NODE_NOT_FOUND", "path": "ops[3].id", "nodeId": "X", "message": "…", "suggestion": "…" } ],
  "rolledBack": true, "retryId": "r_8a…" }
```

`inverse` is informational (for review and diffs). The supported way to undo is `kimo_history` (guarded replay, 11.4). An agent that applies `inverse` ops through `kimo_apply_ops` must pass `baseRevision` = `revision.after`, so the replay fails with `REVISION_CONFLICT` instead of clobbering later edits; the applied ops are a new forward edit in the agent's history.

Error codes (initial): `DOCUMENT_NOT_OPEN`, `DOCUMENT_LOCKED`, `LOAD_FAILED`, `READ_ONLY` (newer format or unknown feature), `REVISION_CONFLICT`, `NODE_NOT_FOUND`, `INVALID_PROPERTY`, `SCHEMA_VIOLATION`, `OUT_OF_SCOPE`, `INSTANCE_STRUCTURE` (e.g. deleting an inherited node), `CYCLE`, `ASSET_NOT_FOUND`, `TIMEOUT`, `PERMISSION_DENIED`, `INTERNAL`.

### 11.3 Tools

| Tool | Purpose | Key inputs | Notes and pen.dev analogue |
|---|---|---|---|
| `kimo_get_state` | Open documents (id, path, dirty, revision), selection, viewport, top-level nodes with visibility hints, components, variables/themes summary, active agents and scopes | `docId?` | Lists **all** open docs (fixes the ask in `[gh pen#13]`). ≈ `get_app_state` |
| `kimo_read_docs` | On-demand MIT agent guides: schema, ops, components, tokens, web, mobile, tables, export | `path?` | ≈ `read_skill`; original content |
| `kimo_open` / `kimo_close` | Open a `.kimo` by path (never writes); close | `path` | Load failure → `LOAD_FAILED`, file untouched (fixes `[gh pencil#22]`) |
| `kimo_create` | Create a new `.kimo` document, optionally from a template, and open it | `path`, `template?` | Refuses to overwrite an existing file. pen.dev has no equivalent tool |
| `kimo_import` | Import SVG (as editable layers), images, or tokens (DTCG/CSS) as ops | `docId`, `kind`, `source`, `parent?` | Returns the ops it applied; supports `dryRun` |
| `kimo_query` | Declarative read: by ids, name, type, simple selector; `depth` with `"…"` elision; `resolveVariables`; `resolveInstances`; `include: ["bounds","problems","geometry"]` | `docId`, `select`, options | No unbounded whole-doc dump (pagination). ≈ `Get` + visitor |
| `kimo_apply_ops` | Atomic batch of typed ops: `insert`, `update`, `replace`, `move`, `delete`, `copy`, `instantiate`, `make_component`, `detach`, `set_override`, `set_variables`, `set_theme_axes` | `docId`, `ops[]`, `baseRevision?`, `dryRun?`, `label?` | Returns forward/inverse ops, `created`, warnings; `dryRun` returns the diff + optional render without committing |
| `kimo_script` | Optional sandboxed JS (QuickJS) with an API mirroring the ops; compiles to the op log; retry by `retryId` + `edits[{find,replace,all?}]` | `docId`, `code` or `retryId`+`edits` | ≈ `execute`, including patch-retry; still diffable |
| `kimo_find_space` | Free canvas area for a size | `docId`, `w`, `h`, `near?`, `direction?`, `padding?` | ≈ `FindEmptySpace` |
| `kimo_render` | Render nodes after commit to PNG/SVG at a scale; returns images | `docId`, `ids`, `format`, `scale` | Always post-commit, so a render in the same agent turn shows the change (the failure reported in `[gh pen#10]`) |
| `kimo_export` | Deterministic export: `react-tailwind`, `html-css`, `tokens-dtcg`, `tokens-css`, `tailwind-theme`, `svg`, `png`, `pdf` | `docId`, `ids`, `target`, `outDir`, options | Returns written paths + hashes |
| `kimo_validate` | Schema + lint report | `docId`, `ids?`, `rules?` | Same engine as `kimo validate` |
| `kimo_history` | List revisions/op groups with author; undo/redo the caller's own groups; revert to a revision | `docId`, `action` | Per-origin undo |
| `kimo_save` | Explicit atomic save; returns bytes, hash and mtime after read-back | `docId` | Never reports "Saved" without verification |
| `kimo_assets` | Import a local or remote image or font (hash + store); list available fonts (document, cached, system, Google catalog) and check that a font loads; start generation jobs via configured providers; `job_status` | `docId`, `action` | Explicit job ids (fixes silent `Generate` failures); `fonts` stops agents from referencing fonts that cannot render |
| `kimo_focus` | Set selection and/or scroll/zoom the viewport to nodes, so an agent can show its work | `docId`, `ids`, `select?`, `zoom?` | pen.dev's `get_app_state` only reports visibility hints |
| `kimo_styles` | List, describe and load open style presets (prose + tokens); `apply` writes variables | `name?`, `params?`, `apply?` | ≈ `get_style`, but can apply |
| `kimo_spawn_agents` | (built-in agent and opted-in hosts) Children with `scope: nodeIds[]`, `model?`, `skills?`, `grants?` | `docId`, `agents[]` | **Scope enforced** per op (rules below): violations → `OUT_OF_SCOPE` |
| `kimo_browser` | (later, desktop) load page, import to canvas, extract element, screenshot | `docId`, `action`, … | Gated; ≈ `browser` |

**Scope rules for spawned agents.** A child's scope is the union of the subtrees of its `scope` nodes.
- `insert`, `update`, `replace`, `delete`, `set_override`, `detach`: the target must be in scope.
- `move`: both the source node and the destination parent must be in scope.
- `copy` / `instantiate`: the destination must be in scope; the source may be anywhere (read-only).
- `make_component`, and any edit to a component origin whose instances exist outside the scope: rejected unless the child has the `components` grant, since it would change other agents' areas.
- `set_variables`, `set_theme_axes`: document-global, so they need the coordinator role or a `globals` grant.
- `kimo_save`: coordinator only. `kimo_export`: `outDir` must be inside a directory declared when the agents are spawned.

**Resources:** `kimo://schema/1.0`, `kimo://docs/{path}`, `kimo://doc/{docId}`, `kimo://doc/{docId}/node/{id}`, `kimo://doc/{docId}/variables`. Clients can subscribe to resources to get change notifications.

### 11.4 Concurrency, attribution, undo

- Every op group carries `origin` (`user`, `agent:<id>`, `mcp:<client>`) and an optional `label`. It is applied as one Yjs transaction with that origin.
- One undo stack per origin. The user's Cmd+Z does not undo agent work by default, and an agent's undo cannot touch user edits. Replay is guarded: ops on deleted or locked nodes are skipped and a "stale history" message appears, instead of the PatchError failure seen in comparable tools (github.com/Muqtadaa/open-frame/pull/12).
- With `baseRevision`, a write fails with `REVISION_CONFLICT` (current revision + changed-node summary) if the document has moved on or the epoch differs. Without it, the write is applied and the new revision returned.
- There is one undo mechanism: `Y.UndoManager` per origin, exposed through `kimo_history`. The `inverse` field in results is informational (11.2).
- **Suggestion mode:** an agent's batch can land as a pending suggestion that the user accepts or rejects as a unit.

### 11.5 Host integration

- `kimo mcp install --host claude-code|claude-desktop|codex|gemini|cursor|opencode` performs **additive, per-host** config edits with backup and diff preview, and never rewrites other entries (avoids `[gh pen#1]`).
- The stdio server exits when its parent closes. Socket heartbeats and process cleanup prevent zombie processes (`[gh pencil#21]`).
- The socket protocol is JSON-RPC 2.0, newline-delimited, versioned, and documented in `docs/spec/socket.md`.

---

## 12. v1 milestones and roadmap

Rough sizing assumes a small team. Each milestone ends with a usable build.

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 Foundations** | bun monorepo (incl. `apps/server` stub and `packages/sync` with the local provider), CI (lint, typecheck, test, schema validation), ADRs (incl. document authority, 9.4); `core-schema` types + JSON Schema + normative defaults table + canonical serializer + validator; spec v0.1 draft published; a scope checklist generated from section 3 (the single scope source) | Round-trip property tests (parse → serialize is byte-stable); forward-compat test (10.2 rule 7); plain-`git merge` conflict-rate fixtures; schema published |
| **M1 Canvas MVP** | Vite app; CanvasKit renderer (lazy); pan/zoom; frames, rect, ellipse, text (Paragraph), images-as-fills; selection, move/resize, layers panel, properties panel; Yjs-backed `editor-state` with undo; autosave to IndexedDB (web) | 5k-node doc at 60 fps on a mid laptop; undo/redo correct |
| **M2 Layout and styling** | Yoga flex (dir, gap, pad, justify, align, fit/fill/fixed, absolute, wrap via `layout/wrap`); strokes (align, per-side, dash); gradients; shadows (+spread), blurs; blend modes; icons (4 libraries); pen tool basics; snapping, measurements, pixel grid | Layout golden tests vs expected boxes; renderer golden images |
| **M3 Components and tokens** | Components, instances, three override kinds (`set`, `slot`, `replace`), declared component props, slots, detach; variables, multi-axis themes, resolver per 10.4; OKLCH/P3; libraries via `imports` (read-only link); variable panel | Resolver spec tests; library link round-trip |
| **M4 Desktop and files** | Tauri v2 shell; `.kimo` open/save, file association, deep links; atomic save + read-back; crash recovery and recovery files; migration consent prompt; per-file lease; file watch + hot reload + git-operation detection; assets/ hashing + `kimo gc`; custom fonts and font caching; SVG/image import; `kimo merge` driver; updater | Kill-the-app tests lose ≤ the autosave window; merge driver fixtures; checkout-during-unsaved-edits fixture; CLI-vs-app lock test |
| **M5 MCP server** | Tool registry; `kimo-mcp` stdio + socket + Streamable HTTP; tools from 11.3 except browser/spawn; structured envelope; revisions; dry-run; host installer; headless mode in `kimo` CLI | Tested with Claude Code, Codex and Gemini CLI; strict-schema CI; no-overwrite tests |
| **M6 Built-in agent** | Provider interface; Anthropic adapter (default), OpenAI-compatible, Gemini, custom endpoint; per-provider browser-support matrix; keychain storage; composer UI, sessions, cost display; skills (built-in + user SKILL.md); permissions; agent cursors; placeholder flag; note and prompt nodes; side-by-side, split and "iterate" modes with enforced per-op scopes | One prompt → screen across ≥ 3 providers; scope violations (incl. globals, moves, component origins) rejected |
| **M7 Export** | IR; React+Tailwind v4 (typed props from declared component props, everything else inlined), HTML/CSS, DTCG tokens, CSS vars, Tailwind `@theme`; PNG via headless CanvasKit; SVG from an IR emitter; PDF via a JS library (e.g. pdf-lib, MIT) unless an ADR accepts a custom CanvasKit build with SkPDF/SkSVG (a maintenance burden); explicit `line-height` and `font-feature-settings` and `text-wrap` hints in CSS; `fallback` sizes mapped to `min-height`/`min-width` or documented as ignored | Golden output tests; exported pages compared with canvas renders: exact box diff for non-text geometry, tolerance-based checks for text (browser line breaking, font fallback and hinting differ from Paragraph); a corpus of wrap-edge fixtures |
| **v1.0 release** | Docs site, spec 1.0 frozen, migration policy, examples, sample libraries, MIT agent guides | Public release |
| **v1.x** | Variant sets; rich-text runs UI (`text/runs`); composite tokens (`tokens/composite`); stretch/baseline and min/max (`layout/stretch-baseline`, `size/min-max`); boolean ops; scale tool; slides + PDF; script nodes; HTML import; `.pen` import from public-schema JSON | |
| **v2** | Multiplayer: network provider in `packages/sync` + `apps/server` relay (Yjs, or Loro after re-evaluation), presence, comments, self-hostable share server; Figma import; browser node; shaders and mesh gradients; embeddable editor with a postMessage bridge | |

---

## 13. Open questions and risks

### 13.1 Open questions about pen.dev (unverified)

| Question | Why it matters | Status |
|---|---|---|
| Is any current `.pen` (2.20, `.lib.pen`, paid libraries) actually encrypted? | Interop and positioning | Public files are plain JSON (2.11/2.17); 2.20 unchecked; not inspected per rules |
| What happens on a theme no-match? | Importer fidelity | Undocumented; Kimo defines its own |
| How is a direct library variable binding written (`$v:accent`?) and how are nested library paths written? | Importer | INFERRED only |
| Does `Insert` into an instance slot write the `{children}` form? | Importer | INFERRED |
| What is `fileToken` for? (drift detection?) | Library versioning ideas | Unknown |
| The exact format of execute's warnings and name→id map | Parity | Not observed (no mutations) |
| Renderer tech (CanvasKit vs custom WebGL vs WebGPU) | Competitive benchmark | Unknown |
| Socket wire protocol; `--app` values besides `desktop` | Interop | Not inspected |
| Is spawn scope enforced anywhere at runtime? | Claim accuracy | Undocumented; untested |
| Undo mapping of agent edits; concurrent multi-client write behavior | Parity | Undocumented |
| Fallback to the active doc for an unopened `filePath` in 1.2.15+ | Claim accuracy | Third-party claim only |
| Rebrand date; pricing introduction date; what cloud "comments/versions/workspaces" do | Accuracy of section 2 | Sources disagree |
| Status of `app.pen.dev` embed and `@pen.dev/sdk`; CLI availability after the npm removal | Competitive landscape | Proposal / reportedly pulled |
| `layoutIncludeStroke` exact behavior; `polygonCount` default; gradient stop range | Importer | Undocumented |
| Community sentiment beyond blogs and issues (Reddit blocked, no Product Hunt page) | Prioritization | Gap |

### 13.2 Product and strategy risks for Kimo

| Risk | Impact | Mitigation |
|---|---|---|
| **OpenPencil already exists** (MIT, CanvasKit + Yoga + Yjs + MCP + Tauri, ~90 tools, .fig import) `[openpencil]` | Kimo may look redundant | Decide early: differentiate (React stack, flat mergeable format, typed declarative MCP with revisions and enforced scopes, deterministic React export, pen-compatible concepts), contribute upstream, or collaborate on a shared format. Never copy its code without MIT attribution |
| pen.dev moves fast (rebrand, multi-provider, pricing in ~9 months) | Feature gap | Compete on openness and reliability rather than feature parity; ship the format and MCP early |
| Scope creep (shaders, browser nodes, Figma import, multiplayer) | Missed v1 | Strict v1 non-goals (8.3); feature flags in the format |
| Adoption depends on agent hosts' MCP support | Reach | stdio + Streamable HTTP; host installer; headless CLI |

### 13.3 Technical risks

| Risk | Mitigation |
|---|---|
| CanvasKit bundle size (7.0 MiB raw wasm, ~2.9 MB gzip; brotli to be measured) shipped in web, desktop and headless paths; startup time | Lazy load, service-worker cache, show the UI shell first; one shared wasm copy per install; record measured sizes in CI |
| CanvasKit WebGPU immaturity; WebGL quirks (cf. pen.dev's gray screen on macOS 26 / Metal 4 `[gh pencil#11]`) | `Renderer` interface; GPU smoke tests per OS; a Canvas2D software fallback for viewing |
| Text measurement drift between layout and render | Single engine (Paragraph) for both; fonts loaded before layout; deterministic fallback chain |
| Yjs tree-move cycles and large op logs | Op-layer cycle checks; normative post-merge cycle repair (9.2); periodic snapshotting; Loro adapter path |
| Flat node table + Yjs + one-node-per-line serializer must agree | One canonical serializer in `core-schema`; property tests |
| Merge driver correctness | Three-way fixtures; conflicts become explicit conflict nodes; never silently drop |
| Tauri multi-webview needed for browser nodes | Defer to v2; prototype early |
| Provider API churn (Vercel AI SDK majors, model ids) | Own interface; pin versions; verify model ids at build time |
| Tool schema incompatibilities across providers | Strict-schema CI per provider |
| Security of an MCP over localhost HTTP, socket and the web attach bridge | Token auth, localhost-only binding, per-host tokens, one-time pairing tokens and `Origin` checks for the browser bridge, permission tiers; CDP gated off by default |
| Color fidelity across canvas, PNG and CSS for OKLCH/P3 | One gamut-mapping algorithm (CSS Color 4) in every path; ICC-tagged PNG; P3 surfaces where supported |
| Script sandbox escapes (later) | QuickJS-wasm, no host bindings, time and node caps |

### 13.4 Legal and ethical risks

| Risk | Mitigation |
|---|---|
| Copying pen.dev's proprietary material (skill text, style archetypes, prompts, code) | Write all agent guides, presets and schemas independently. This teardown uses only public documentation, observed behavior and names. Concepts are not copyrightable, but text and code are |
| pen.dev EULA (no reverse engineering, no use for competing models) | Kimo does not decompile or redistribute pen.dev. Research was limited to public docs, public example files, MCP tool output and bundle metadata. Kimo's own team should avoid further inspection of `app.asar` contents |
| `.pen` import | Implement only against the public schema and plain-JSON files users already have. Never decrypt anything. If files turn out to be encrypted, support import only via user-initiated export from pen.dev |
| Trademark | Do not use "Pen", "Pencil" or pen.dev branding; describe interop factually ("imports .pen files") |
| Third-party licences | Generate NOTICE from an SBOM (e.g. license-checker over `bun.lock`, cargo-about for the Tauri/Rust side) rather than by hand. It must include: CanvasKit/Skia (BSD-3) and the natives compiled into the wasm: FreeType (FTL, which requires an acknowledgment in documentation; the standard wasm contains `FREETYPE_PROPERTIES` strings, checked locally), HarfBuzz (MIT "old"), ICU (Unicode-3.0), and expat/libpng/zlib as compiled in; Yoga (MIT); Lucide (ISC, with its Feather MIT heritage); feather-icons (MIT); Phosphor (MIT); Material Symbols (Apache-2.0); `@modelcontextprotocol/server` (MIT); AI SDK (Apache-2.0, INFERRED); bundled or downloaded fonts (OFL or Apache-2.0 per family). If any binary is built with `bun build --compile`, also JavaScriptCore/WebKit (LGPL-2) plus the relinking materials (9.2) |
