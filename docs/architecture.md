# Architecture

How the Kimo repository is put together: the principles behind it, the packages and how they
depend on each other, and where the editor's own design lives. The full plan of record is the
[teardown](teardown.md); decisions are recorded as [ADRs](adr/README.md).

## Principles

Condensed from [teardown section 8.1](teardown.md#81-principles):

1. **Open all the way down.** App, format spec, JSON Schema, MCP tool schemas, socket protocol
   and agent guides are MIT. The format is never encrypted or obfuscated.
2. **The file is the product.** `.kimo` is readable, diffable, mergeable and stable, with semver,
   migrations and a changelog.
3. **Local-first, no account.** Everything, including the CLI and MCP, works offline without
   sign-in. Cloud features are optional and self-hostable.
4. **Never lose work.** Atomic writes, autosave, crash recovery, verified saves, and no save after
   a failed load.
5. **Agents edit; people stay in control.** Typed declarative tools, enforced scopes,
   attributed edits, per-origin undo, suggestion and dry-run modes.
6. **Provider-agnostic by construction.** Claude is the default; other providers and compatible
   endpoints are supported. No vendored agent CLIs.
7. **Deterministic over prompted.** Exporters and token sync are code.
8. **Familiar and fast.** Figma-like interaction and identical raster output across canvas,
   headless renderer and PNG export.

## Monorepo map

bun workspaces. Packages export TypeScript source directly (no build step).

### Apps

| Path | Package | Role |
|---|---|---|
| `apps/web` | `@kimo/web` | React + Vite editor: the whole UI, in the browser and inside Tauri |
| `apps/desktop` | `@kimo/desktop` | Tauri v2 shell: files, dialogs, watch, file association, document host and MCP socket |
| `apps/server` | `@kimo/server` | Reserved, a stub in v1. Self-hostable; nothing depends on it |

The website (getkimo.design: the landing page and the docs) lives in its own private repository,
[Saudade-media/kimo-site](https://github.com/Saudade-media/kimo-site). It renders the docs from
this repository's markdown (docs/, the CLI and examples READMEs, CONTRIBUTING and the changelog)
at a pinned commit, so a docs change here reaches the site when kimo-site bumps its `kimo.ref`.

### Packages

| Path | Package | Role |
|---|---|---|
| `packages/core-schema` | `@kimo/core-schema` | `.kimo` types, JSON Schema, validation, canonical serialization, migrations |
| `packages/editor-state` | `@kimo/editor-state` | Document store (Yjs), op layer, undo groups, revisions, selection |
| `packages/sync` | `@kimo/sync` | `DocStore` persistence providers behind one interface (IndexedDB, file autosave) |
| `packages/layout` | `@kimo/layout` | `LayoutEngine` interface and its Yoga implementation (flex auto layout) |
| `packages/renderer` | `@kimo/renderer` | `Renderer` interface and its CanvasKit (Skia WASM) implementation: interactive WebGL and headless raster |
| `packages/exporters` | `@kimo/exporters` | Deterministic export: React + Tailwind v4, HTML/CSS, design tokens (DTCG, CSS variables, Tailwind `@theme`), SVG, PDF; PNG through the renderer |
| `packages/mcp-server` | `@kimo/mcp-server` | The MCP tool registry (one source for MCP and the built-in agent), socket protocol, attach and headless runtimes, host installer |
| `packages/ai-agent` | `@kimo/ai-agent` | The built-in agent: provider interface and adapters, the agent loop over the tool registry, skills, sessions, modes |
| `packages/cli` | `@kimo/cli` | The `kimo` command: `merge` (git merge driver), `gc`, `validate`, `mcp` ([README](../packages/cli/README.md)) |
| `packages/platform` | `@kimo/platform` | Host abstraction for the editor: files, dialogs, watch, leases, recovery, git, fonts, updater, settings, deep links (desktop through Tauri, browser, in-memory) |
| `packages/design-tokens` | `@kimo/design-tokens` | The editor's own tokens, transcribed from `desing.pen` and compiled to CSS/TS |
| `packages/ui` | `@kimo/ui` | Editor chrome components (panels, inputs, menus) built on the generated tokens. Browser-only (React); only apps import it |
| `packages/templates` | `@kimo/templates` | The starter templates bundled with the app ([README](../packages/templates/README.md)) |

### Dependency rule

The internal dependencies, from each package's `package.json` (`←` reads "is used by"):

- `core-schema` ← `layout` ← `renderer` ← `exporters` (the renderer only for PNG tests and
  goldens, as a dev dependency).
- `editor-state` depends on `core-schema`; `sync` on `core-schema` and `editor-state`.
- `mcp-server` builds on `core-schema`, `editor-state`, `sync`, `layout`, `renderer`,
  `exporters` and `platform`; `ai-agent` and `cli` build on `mcp-server`.
- `design-tokens`, `platform` and `templates` have no internal dependencies.
- `ui` depends on `design-tokens` only.

Only `apps/*` may depend on React or Tauri, with one exception: `packages/ui`, the browser-only
chrome package, which only apps may import ([ADR 0001](adr/0001-monorepo-and-server-readiness.md)).
`packages/platform` talks to Tauri through an `invoke` / `listen` bridge that `apps/desktop` hands
in, so it does not import Tauri itself. No app depends on `apps/server`. Every other package under
`packages/` runs in Node, Bun, browsers and workers.

### Server-readiness rule

The UI, the built-in agent and MCP all mutate documents through the same `editor-state` ops, and
every op carries an origin (`user`, `agent:<id>`, `mcp:<client>`, `file`). A network provider in
`packages/sync` (talking to `apps/server`) can therefore be added without touching the editor.
See [ADR 0001](adr/0001-monorepo-and-server-readiness.md).

## About `desing.pen`

[`desing.pen`](../desing.pen) is the source of truth for Kimo's own editor design system: one
board per area, from 01 Foundations and 02 Components onward (see
[ADR 0007](adr/0007-editor-design-system.md)). The filename's spelling is historical; token
generation references it, so do not rename it.

It is a pen.dev (Pencil) document, plain JSON (schema 2.x), edited with pen.dev/Pencil, a
proprietary tool. Kimo can open `.pen` files (it converts them to a `.kimo` beside the original),
but the design source stays in `desing.pen` until Kimo covers every feature the file uses; then it
moves to a `.kimo` file and pen.dev leaves the toolchain.

`packages/design-tokens/src/tokens.json` is transcribed from the file's variables and checked
against a `GetVariables()` snapshot, the CSS/TS tokens are generated from `tokens.json`, and the
`packages/ui` components are hand-built to the file's component nodes using those tokens. The
steps for a design change are in [CONTRIBUTING](../CONTRIBUTING.md).
