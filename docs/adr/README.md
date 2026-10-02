# Architecture decision records

Kimo records significant decisions as ADRs in [MADR](https://adr.github.io/madr/) style. Each ADR
cites the sections of the [teardown](../teardown.md) (the plan of record) it implements.

| # | Title | Status |
|---|---|---|
| [0000](0000-template.md) | Template | n/a |
| [0001](0001-monorepo-and-server-readiness.md) | One bun monorepo, server-ready from day one | Accepted |
| [0002](0002-document-authority-in-tauri.md) | Document authority inside Tauri: a dedicated document host context (Option A) | Accepted |
| [0003](0003-crdt-yjs-behind-docstore.md) | Yjs as the document CRDT, behind a `DocStore` interface | Accepted |
| [0004](0004-renderer-canvaskit-layout-yoga.md) | CanvasKit for rendering and text, Yoga for layout, both behind interfaces | Accepted |
| [0005](0005-kimo-file-format.md) | `.kimo` format: flat node table, canonical serialization, semver with migrations, never encrypted | Accepted |
| [0006](0006-llm-provider-interface.md) | A Kimo-owned LLM `Provider` interface, Claude by default | Accepted |
| [0007](0007-editor-design-system.md) | Editor design system: monochrome, tokens transcribed from `desing.pen` | Accepted |
| [0008](0008-mcp-sidecar-in-rust.md) | The desktop MCP sidecar is a small Rust binary, not `bun build --compile` | Accepted |
| [0009](0009-m1-render-pipeline.md) | M1 render pipeline: CanvasKit renderer, Yoga layout, bundled fonts, host-driven updates | Accepted |

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
