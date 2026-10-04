<p align="center">
  <img src="docs/assets/readme-header.png" width="1280" alt="Kimo — the open, local-first design canvas for people and their coding agents." />
</p>

# Kimo

Kimo is an open-source, local-first, agent-native design canvas: an MIT-licensed alternative to
pen.dev. Designs live in your repository as `.kimo` files, a published, versioned, plain-JSON
format laid out as a flat node table so it diffs and merges in git. You edit them on a fast
WebGL canvas with Figma-like interactions, and AI agents edit the same documents through an open,
typed MCP tool set and a built-in, provider-agnostic agent loop (Claude by default, bring your own
key). There is no account, no backend and no metering, and exporters (React + Tailwind,
HTML/CSS, design tokens, SVG/PNG/PDF) are deterministic code rather than prompts.

## Principles

Condensed from [teardown section 8.1](docs/teardown.md#81-principles):

1. **Open all the way down.** App, format spec, JSON Schema, MCP tool schemas, socket protocol
   and agent guides are MIT. The format is never encrypted or obfuscated.
2. **The file is the product.** `.kimo` is readable, diffable, mergeable and stable, with semver,
   migrations and a changelog.
3. **Local-first, no account.** Everything, including the CLI and MCP, works offline without
   sign-in. Cloud features are optional and self-hostable.
4. **Never lose work.** Atomic writes, autosave, crash recovery, verified saves, and no save after
   a failed load.
5. **Agents are first-class, humans stay in control.** Typed declarative tools, enforced scopes,
   attributed edits, per-origin undo, suggestion and dry-run modes.
6. **Provider-agnostic by construction.** Claude is the default; other providers and compatible
   endpoints are supported. No vendored agent CLIs.
7. **Deterministic over prompted.** Exporters and token sync are code.
8. **Familiar and fast.** Figma-like interaction and identical raster output across canvas,
   headless renderer and PNG export.

## Status

**Milestone M0 (Foundations).** Nothing here is usable as a design tool yet. M0 delivers the
monorepo, CI, ADRs, the `.kimo` v0.1 spec draft, the scope checklist and these packages and apps:
`@kimo/core-schema` (types, JSON Schema, defaults table, canonical serializer, validator),
`@kimo/editor-state` (Yjs document store, op layer, undo, tree repair), `@kimo/sync` (file
autosave and IndexedDB providers), `@kimo/design-tokens` (the editor's tokens and their build),
`@kimo/ui` (editor chrome components), the `@kimo/web` editor shell, the `@kimo/desktop` Tauri
shell and the reserved `@kimo/server` stub. See the
[roadmap](docs/teardown.md#12-v1-milestones-and-roadmap) and the
[scope checklist](docs/scope-checklist.md).

## Monorepo map

bun workspaces. Packages export TypeScript source directly (no build step).

| Path | Package | Role |
|---|---|---|
| `apps/web` | `@kimo/web` | React + Vite editor; the whole UI, in the browser and inside Tauri |
| `apps/desktop` | `@kimo/desktop` | Tauri v2 shell: files, dialogs, watch, file association, MCP socket host |
| `apps/server` | `@kimo/server` | **Reserved** (stub in v1): future multiplayer relay, share links, hosted MCP. Self-hostable; nothing depends on it |
| `packages/core-schema` | `@kimo/core-schema` | `.kimo` types, JSON Schema, validation, canonical serialization, migrations |
| `packages/editor-state` | `@kimo/editor-state` | Document store (Yjs), op layer, undo groups, revisions, selection |
| `packages/sync` | `@kimo/sync` | `DocStore` providers behind one interface: local (IndexedDB / file autosave) now, network later |
| `packages/design-tokens` | `@kimo/design-tokens` | Variable/theme resolver and the editor's own tokens, transcribed from `desing.pen` and compiled to CSS/TS |
| `packages/ui` | `@kimo/ui` | Editor chrome components (panels, inputs, menus) built on the generated tokens. Browser-only (React); only apps import it |

Planned packages (`layout`, `renderer`, `exporters`, `mcp-server`, `ai-agent`, `cli`) arrive with
their milestones; see [teardown 9.1](docs/teardown.md#91-monorepo-layout-bun-workspaces).

**Dependency rule.** `core-schema` ← `design-tokens` ← `layout` ← `renderer` ← `exporters`;
`editor-state` depends on `core-schema` and `design-tokens`; `sync` depends only on
`editor-state`'s `DocStore` interface. Only `apps/*` may depend on React or Tauri, with one
exception: `packages/ui`, the browser-only chrome package, which only apps may import (ADR 0001).
No app depends on `apps/server`. Every other package under `packages/` runs in Node, Bun, browsers
and workers.

**Server-readiness rule.** The UI, the built-in agent and MCP all mutate documents through the
same `editor-state` ops, and every op carries an origin (`user`, `agent:<id>`, `mcp:<client>`,
`file`). Adding a network provider in `packages/sync` (talking to `apps/server`) is therefore
enough to turn on multiplayer, without touching the editor. See
[ADR 0001](docs/adr/0001-monorepo-and-server-readiness.md).

## Quickstart

Requires [Bun](https://bun.sh). bun is the only supported package manager.

```sh
bun install                    # install all workspaces
bun run check                  # lint + typecheck + check:generated + test
bun --filter @kimo/web dev     # run the web editor (Vite)
bun --filter @kimo/desktop dev # run the desktop shell (needs Rust + Tauri v2 prerequisites)
```

Desktop development also needs the
[Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

## Documentation

- [Docs index](docs/README.md)
- [pen.dev teardown and the Kimo plan](docs/teardown.md): the plan of record
- [`.kimo` format spec 1.0](docs/spec/kimo-format-1.0.md) (stable; the [v0.1 draft](docs/spec/kimo-format-v0.1.md) is kept for history)
- [Architecture decision records](docs/adr/README.md)
- [Scope checklist](docs/scope-checklist.md)
- [Contributing](CONTRIBUTING.md), [Code of Conduct](CODE_OF_CONDUCT.md),
  [Security policy](SECURITY.md)

### About `desing.pen`

[`desing.pen`](desing.pen) is the source of truth for Kimo's own editor design system (boards 01
Foundations through 07 Export dialog; see [ADR 0007](docs/adr/0007-editor-design-system.md)).
The filename's spelling is historical; token generation references it, so do not rename it.

To be honest about the bootstrap problem: until Kimo can open and edit its own designs, this
file is a pen.dev (Pencil) document and is edited with pen.dev/Pencil, a proprietary tool.
`packages/design-tokens/src/tokens.json` is transcribed from its variables and checked against a
`GetVariables()` snapshot, the CSS/TS tokens are generated from `tokens.json`, and the
`packages/ui` components are hand-built to the file's component nodes using those tokens. Once Kimo reaches parity for
the features the file uses, the design source moves to a `.kimo` file and pen.dev leaves the
toolchain.

## License

[MIT](LICENSE). Third-party notices are in [NOTICE](NOTICE). "pen.dev" and "Pencil" are
trademarks of their owners; Kimo is not affiliated with them.
