# Architecture decision records

Kimo records significant decisions as ADRs in [MADR](https://adr.github.io/madr/) style. Each ADR
cites the sections of the [teardown](../teardown.md) (the plan of record) it implements.

| # | Title | Status |
|---|---|---|
| [0000](0000-template.md) | Template | n/a |
| [0001](0001-monorepo-and-server-readiness.md) | One bun monorepo, server-ready from day one | Accepted |
| [0002](0002-document-authority-in-tauri.md) | Document authority inside Tauri: a dedicated document host context (Option A) | Accepted, amended by [0012](0012-m4-desktop-and-files.md) |
| [0003](0003-crdt-yjs-behind-docstore.md) | Yjs as the document CRDT, behind a `DocStore` interface | Accepted |
| [0004](0004-renderer-canvaskit-layout-yoga.md) | CanvasKit for rendering and text, Yoga for layout, both behind interfaces | Accepted |
| [0005](0005-kimo-file-format.md) | `.kimo` format: flat node table, canonical serialization, semver with migrations, never encrypted | Accepted |
| [0006](0006-llm-provider-interface.md) | A Kimo-owned LLM `Provider` interface, Claude by default | Accepted |
| [0007](0007-editor-design-system.md) | Editor design system: monochrome, tokens transcribed from `desing.pen` (amended: `measure`, `component` meaning colors) | Accepted |
| [0008](0008-mcp-sidecar-in-rust.md) | The desktop MCP sidecar is a small Rust binary, not `bun build --compile` | Accepted |
| [0009](0009-m1-render-pipeline.md) | M1 render pipeline: CanvasKit renderer, Yoga layout, bundled fonts, host-driven updates | Accepted |
| [0010](0010-m2-styling-and-tools.md) | M2 styling, canvas overlays and tools: format additions and contracts | Accepted |
| [0011](0011-m3-components-and-variables.md) | M3 components, instances, variables and libraries: format additions, expansion and contracts | Accepted |
| [0012](0012-m4-desktop-and-files.md) | M4 desktop and files: stored merge conflicts, `@kimo/platform`, the document session and the Tauri command surface | Accepted |
| [0013](0013-m5-mcp-server.md) | M5 MCP server: one tool registry, typed ops, the `kimo-socket/1` protocol, attach vs headless, permissions and the host installer | Accepted (addendum: [0014](0014-m6-built-in-agent.md)) |
| [0014](0014-m6-built-in-agent.md) | M6 built-in agent: provider interface and adapters, local agent CLIs, the in-process tool loop, modes with enforced scopes, sessions, skills, placeholders and prompt nodes | Accepted |
| [0015](0015-m7-export.md) | M7 export: one IR, deterministic emitters (React+Tailwind v4, HTML/CSS, DTCG tokens, SVG, PDF, PNG via the renderer) and a browser box-diff harness | Accepted |
| [0016](0016-multiplayer-transport-and-sessions.md) | Multiplayer v2: an end-to-end encrypted Bun relay on Yjs, self-hosted, joined with signed capability links | Proposed |

## Process

1. Copy [0000-template.md](0000-template.md) to the next free number with a short kebab-case
   title, status **Proposed**.
2. Open a pull request with the ADR alone, or together with the change it enables. Discussion
   happens on the PR.
3. On merge the status becomes **Accepted**. ADRs are not rewritten afterwards: to change a
   decision, write a new ADR and mark the old one **Superseded by NNNN**.
4. Add the ADR to the table above.

Write an ADR when a decision is hard to reverse, crosses package boundaries, changes the file
format or a public protocol, adds a runtime dependency to a package under `packages/`, or deviates
from the teardown.
