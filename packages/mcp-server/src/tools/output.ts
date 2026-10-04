/**
 * Output tools: render (PNG via the headless CanvasKit raster, always post-commit) and export
 * (teardown 11.3). Code, token, SVG and PDF targets go through `@kimo/exporters` (M7, ADR 0015).
 */
import { Arr, Bool, Enum, Int, Num, Obj, Opt, Str } from "../schema"
import { ALL_HOSTS, defineTool, docId, NOT_WEB, nodeIdField, READ, WRITE } from "./define"

export const kimoRender = defineTool({
  name: "kimo_render",
  title: "Render nodes to PNG",
  description:
    "Renders nodes to PNG images attached to the result (MCP image content), using the same CanvasKit engine as the canvas. Always reflects every committed edit, including one made earlier in the same turn. Use after building a section to check layout, clipping and contrast. Keep scale modest (images cost tokens): maxSize caps the longest side. format svg arrives with code export (UNSUPPORTED for now).",
  input: Obj({
    docId,
    ids: Arr(nodeIdField("Node id."), {
      description: "Nodes to render (one image each).",
      minItems: 1,
      maxItems: 8,
    }),
    format: Opt(Enum(["png", "svg"], { description: "Default png." })),
    scale: Opt(Num({ description: "Pixel ratio (default 1, max 4).", minimum: 0.1, maximum: 4 })),
    maxSize: Opt(
      Int({
        description: "Longest side in px after scaling (default 1600, max 4096).",
        minimum: 64,
        maximum: 4096,
      }),
    ),
    background: Opt(Str({ description: "Background color #rrggbb (default transparent)." })),
    theme: Opt(
      Arr(Obj({ axis: Str({ description: "Axis." }), value: Str({ description: "Value." }) }), {
        description: "Render with this theme.",
      }),
    ),
  }),
  data: Obj({
    images: Arr(
      Obj({
        nodeId: Str({ description: "Node." }),
        width: Int({ description: "Pixels.", minimum: 0 }),
        height: Int({ description: "Pixels.", minimum: 0 }),
        index: Int({
          description: "Index of the image content block in the MCP result.",
          minimum: 0,
        }),
      }),
      { description: "One entry per rendered node; pixels are in the result's image content." },
    ),
  }),
  annotations: READ,
  scope: "read",
  doc: "required",
  mutating: false,
  timeoutMs: 120_000,
  availability: ALL_HOSTS,
  status: "m5",
})

export const EXPORT_TARGETS = [
  "png",
  "kimo",
  "svg",
  "pdf",
  "react-tailwind",
  "html-css",
  "tokens-dtcg",
  "tokens-css",
  "tailwind-theme",
] as const

/** Targets implemented in M5 (they need `outDir`). */
export const M5_EXPORT_TARGETS: readonly (typeof EXPORT_TARGETS)[number][] = ["png", "kimo"]
/** M7 targets through `@kimo/exporters` `exportDocument` (ADR 0015). */
export const CODE_EXPORT_TARGETS: readonly (typeof EXPORT_TARGETS)[number][] = [
  "react-tailwind",
  "html-css",
  "tokens-dtcg",
  "tokens-css",
  "tailwind-theme",
  "svg",
  "pdf",
]

export const kimoExport = defineTool({
  name: "kimo_export",
  title: "Export files",
  description:
    "Deterministic export (export grant needed). png (one file per node, <nodeId>.png) and kimo (the subtrees as a standalone .kimo with the variables they use) are written to outDir (absolute; allow-list applies). Code and token targets — react-tailwind (<Root>.tsx pages, <Component>.tsx per component, tokens.css), html-css (index.html, styles.css, tokens.css), tokens-dtcg (tokens.json), tokens-css, tailwind-theme (@theme), svg (one per root), pdf (one page per root) — are written to outDir when given, otherwise returned inline (contents; pdf as base64). Exact values, variables kept as CSS custom properties unless variables=false. Never overwrites a different file unless overwrite=true (identical files are reported unchanged); nothing is written when any file conflicts. Returns paths with hashes and export issues (approximations).",
  input: Obj({
    docId,
    target: Enum(EXPORT_TARGETS, { description: "Export format." }),
    ids: Opt(
      Arr(nodeIdField("Node id."), {
        description: "Nodes to export (default: all top-level frames).",
        maxItems: 200,
      }),
    ),
    outDir: Opt(
      Str({
        description:
          "Absolute output directory (required for png and kimo; code/token targets return files inline without it).",
        minLength: 1,
      }),
    ),
    scale: Opt(Num({ description: "png: pixel ratio (default 2).", minimum: 0.1, maximum: 4 })),
    overwrite: Opt(
      Bool({ description: "Replace existing different files (otherwise FILE_EXISTS)." }),
    ),
    variables: Opt(
      Bool({ description: "Code targets: variables as CSS custom properties (default true)." }),
    ),
    components: Opt(
      Bool({ description: "react-tailwind: split instances into components (default true)." }),
    ),
    layerNames: Opt(
      Bool({
        description:
          "Code targets: keep layer names as data attributes (default true for html-css, false for react-tailwind).",
      }),
    ),
  }),
  data: Obj({
    files: Arr(
      Obj({
        path: Str({
          description: "Absolute path written (inline: the path relative to an output folder).",
        }),
        bytes: Int({ description: "Size.", minimum: 0 }),
        sha256: Str({ description: "Hash of the written file (read back)." }),
        nodeId: Opt(Str({ description: "Source node." })),
        unchanged: Opt(
          Bool({ description: "The file already had these exact contents; not rewritten." }),
        ),
        contents: Opt(Str({ description: "Inline only (no outDir): the file contents." })),
        encoding: Opt(Enum(["utf8", "base64"], { description: "Inline only: contents encoding." })),
      }),
      { description: "Files written (or returned inline)." },
    ),
    issues: Opt(
      Arr(
        Obj({
          code: Str({ description: "Export issue code." }),
          message: Str({ description: "What was approximated or dropped." }),
          nodeId: Opt(Str({ description: "Node it is about." })),
        }),
        { description: "Code targets: approximations and gaps of the format (ADR 0015)." },
      ),
    ),
  }),
  annotations: { ...WRITE, idempotentHint: true },
  scope: "read",
  grant: "export",
  doc: "required",
  mutating: false,
  timeoutMs: 300_000,
  availability: NOT_WEB,
  status: "m5",
})
