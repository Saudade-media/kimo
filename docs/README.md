# Kimo documentation

| Document | What it is |
|---|---|
| [teardown.md](teardown.md) | The pen.dev teardown and the Kimo plan: principles (8), architecture (9), `.kimo` format draft (10), MCP tool set (11), roadmap (12), risks (13). **The plan of record.** |
| [spec/kimo-format-v0.1.md](spec/kimo-format-v0.1.md) | `.kimo` file format specification, v0.1 draft (normative types live in `@kimo/core-schema`) |
| [adr/](adr/README.md) | Architecture decision records, with the ADR process and template |
| [scope-checklist.md](scope-checklist.md) | Every feature from teardown section 3 as a checkbox, tagged with its milestone |
| [kimo CLI](../packages/cli/README.md) | `kimo merge` (semantic git merge driver), `kimo gc`, `kimo validate`: usage and exit codes |

Repository-level documents:

| Document | What it is |
|---|---|
| [README](../README.md) | Overview, principles, monorepo map, quickstart |
| [CONTRIBUTING](../CONTRIBUTING.md) | Setup, check pipeline, commit style, ADR, design and spec change process, licensing |
| [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md) | Contributor Covenant 2.1 |
| [SECURITY](../SECURITY.md) | How to report vulnerabilities, and what is in scope |
| [NOTICE](../NOTICE) | Kimo copyright and third-party licences |
| [LICENSE](../LICENSE) | MIT |

## Planned

These are referenced by the plan and will be added with their milestones:

- `spec/socket.md`: the desktop socket JSON-RPC protocol (M5, [ADR 0008](adr/0008-mcp-sidecar-in-rust.md))
- MCP tool reference and the MIT agent guides served by `kimo_read_docs` (M5)
- Per-provider browser-support matrix ([ADR 0006](adr/0006-llm-provider-interface.md), M6)
- Format changelog and migration policy (with the first format change; frozen at v1.0)

## Design source

The editor's design system lives in [`desing.pen`](../desing.pen) at the repository root
([ADR 0007](adr/0007-editor-design-system.md)). It is a pen.dev/Pencil document until Kimo can
open its own design.
