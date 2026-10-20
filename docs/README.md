# Kimo documentation

| Document | What it is |
|---|---|
| [architecture.md](architecture.md) | Principles, the monorepo map (apps and packages), the dependency and server-readiness rules, and notes on `desing.pen` |
| [teardown.md](teardown.md) | The pen.dev teardown and the Kimo plan: principles (8), architecture (9), `.kimo` format draft (10), MCP tool set (11), roadmap (12), risks (13). **The plan of record.** |
| [spec/kimo-format-1.0.md](spec/kimo-format-1.0.md) | `.kimo` file format specification 1.0, stable (normative types live in `@kimo/core-schema`) |
| [spec/kimo-format-v0.1.md](spec/kimo-format-v0.1.md) | The v0.1 draft, superseded by 1.0 and kept as a historical record |
| [adr/](adr/README.md) | Architecture decision records, with the ADR process and template |
| [scope-checklist.md](scope-checklist.md) | Every feature from teardown section 3 as a checkbox, tagged with its milestone |
| [agents/](agents/index.md) | The MIT agent guides for coding agents (the same text `kimo_read_docs` serves): the `.kimo` model, `kimo_apply_ops` cookbook, layout, text, components, tokens, results and verification, error codes, web/mobile/tables/export workflows |
| [Templates](../packages/templates/README.md) | The starter templates bundled with the app (`@kimo/templates`): what each contains, how the app loads them offline, how to rebuild. Writing a new one: [scripts/templates/README.md](../scripts/templates/README.md) |
| [kimo CLI](../packages/cli/README.md) | `kimo merge` (semantic git merge driver), `kimo gc`, `kimo validate`, `kimo mcp` (MCP server, attach or headless) and `kimo mcp install/remove/status`: usage and exit codes |

Repository-level documents:

| Document | What it is |
|---|---|
| [README](../README.md) | Overview, screenshots, how to try Kimo and run it from source |
| [CONTRIBUTING](../CONTRIBUTING.md) | Setup, check pipeline, commit style, ADR, design and spec change process, licensing |
| [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md) | Contributor Covenant 2.1 |
| [SECURITY](../SECURITY.md) | How to report vulnerabilities, and what is in scope |
| [NOTICE](../NOTICE) | Kimo copyright and third-party licences |
| [LICENSE](../LICENSE) | MIT |

## Planned

These are referenced by the plan and will be added with their milestones:

- `spec/socket.md`: the desktop socket JSON-RPC protocol (M5, [ADR 0008](adr/0008-mcp-sidecar-in-rust.md))
- MCP tool reference (M5)
- Per-provider browser-support matrix ([ADR 0006](adr/0006-llm-provider-interface.md), M6)
- Format changelog and migration policy (with the first format change; frozen at v1.0)

## Design source

The editor's design system lives in [`desing.pen`](../desing.pen) at the repository root
([ADR 0007](adr/0007-editor-design-system.md)). It is a pen.dev/Pencil document until Kimo can
open its own design.
