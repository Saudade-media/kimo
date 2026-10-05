# Export for agents

Agents export through the `kimo_export` MCP tool: the same deterministic exporters as the [Export dialog](export-dialog.md), callable from a coding agent connected over MCP (see [Agents & MCP](../../agents/index.md)) or from the [built-in agent](../built-in-agent/providers.md).

> [!IMPORTANT]
> **Needs the export grant.** `kimo_export` writes files, so the app asks you to approve it (an **Export** approval) unless you granted it. With auto-approve on, the approval is given at once and logged in Activity: for an MCP client in **Settings › Agents & MCP** (its **Permissions**, **Auto-approve**), for the built-in agent with the shield in the composer ([Auto-approve](../built-in-agent/agent-tab.md#auto-approve)). It is a desktop tool: it isn't available in the browser, and agents spawned by another agent never get it.

## Targets

| `target` | Output |
|---|---|
| `react-tailwind` | `<Root>.tsx` per exported frame, `<Component>.tsx` per component, `tokens.css` |
| `html-css` | `index.html`, `styles.css`, `tokens.css` |
| `tokens-dtcg` | `tokens.json` (W3C DTCG) |
| `tokens-css` | `tokens.css` |
| `tailwind-theme` | `theme.css` with a Tailwind `@theme` block (only available here, not in the dialog) |
| `svg` | One SVG per frame |
| `pdf` | One PDF, one page per frame |
| `png` | `<nodeId>.png` per node |
| `kimo` | The nodes as a standalone `.kimo` file with the variables they use |

## Parameters

| Parameter | Meaning |
|---|---|
| `docId` | The open document |
| `ids` | Nodes to export, up to 200 (default: every top-level frame) |
| `outDir` | Absolute output folder. Required for `png` and `kimo`; without it, code, token, SVG and PDF targets return the files inline (PDF as base64) |
| `scale` | `png` pixel ratio, 0.1 to 4 (default 2) |
| `overwrite` | Replace existing files with different contents |
| `variables` | Variables as CSS custom properties (default true) |
| `components` | `react-tailwind`: split instances into components (default true) |
| `layerNames` | Keep layer names as data attributes (default true for `html-css`, false for `react-tailwind`) |

## Results

The result lists every file with its path, size and SHA-256, and for code targets the `issues`: what the exporter approximated or dropped, with the node it concerns.

Writes are all or nothing. If any file already exists with different contents, the call fails with `FILE_EXISTS` and writes nothing, unless `overwrite: true`. Files that already have the exact contents are reported `unchanged` and not rewritten.

For the full agent workflow (render, check, export), agents read [`guide/export`](../../agents/guide/export.md) with `kimo_read_docs`.
