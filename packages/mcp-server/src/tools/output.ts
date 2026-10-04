/**
 * Output tools: render (PNG via the headless CanvasKit raster, always post-commit) and export
 * (teardown 11.3). Code targets arrive with M7; in M5 they return UNSUPPORTED.
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

/** Targets implemented in M5; the rest return UNSUPPORTED until M7. */
export const M5_EXPORT_TARGETS: readonly (typeof EXPORT_TARGETS)[number][] = ["png", "kimo"]

export const kimoExport = defineTool({
  name: "kimo_export",
  title: "Export files",
  description:
    "Deterministic export written to outDir (absolute; allow-list applies, export grant needed): png (one file per node, <nodeId>.png), kimo (the subtrees as a standalone .kimo with the variables they use). Code and token targets (react-tailwind, html-css, svg, pdf, tokens-dtcg, tokens-css, tailwind-theme) are listed but return UNSUPPORTED in this version. Never overwrites a file unless overwrite=true. Returns written paths with hashes.",
  input: Obj({
    docId,
    target: Enum(EXPORT_TARGETS, { description: "Export format." }),
    ids: Opt(
      Arr(nodeIdField("Node id."), {
        description: "Nodes to export (default: all top-level frames).",
        maxItems: 200,
      }),
    ),
    outDir: Str({ description: "Absolute output directory.", minLength: 1 }),
    scale: Opt(Num({ description: "png: pixel ratio (default 2).", minimum: 0.1, maximum: 4 })),
    overwrite: Opt(Bool({ description: "Replace existing files (otherwise FILE_EXISTS)." })),
  }),
  data: Obj({
    files: Arr(
      Obj({
        path: Str({ description: "Absolute path written." }),
        bytes: Int({ description: "Size.", minimum: 0 }),
        sha256: Str({ description: "Hash of the written file (read back)." }),
        nodeId: Opt(Str({ description: "Source node." })),
      }),
      { description: "Files written." },
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
