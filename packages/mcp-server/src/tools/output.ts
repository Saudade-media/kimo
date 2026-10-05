/**
 * Output tools: render (PNG via the headless CanvasKit raster, always post-commit) and export
 * (teardown 11.3). Code, token, SVG and PDF targets go through `@kimo/exporters` (M7, ADR 0015).
 */
import { Arr, Bool, Enum, Int, Num, Obj, Opt, Str } from "../schema"
import { ALL_HOSTS, defineTool, docId, NOT_WEB, nodeIdField, READ, WRITE } from "./define"

export const kimoRender = defineTool({
  name: "kimo_render",
  title: "Render nodes to PNG or SVG",
  description:
    "PNG of nodes (same engine as the canvas, always current) to check layout, clipping and contrast. Images cost tokens: keep scale low. format svg returns SVG markup in data instead.",
  input: Obj({
    docId,
    ids: Arr(nodeIdField("Node id."), { description: "One image each.", minItems: 1, maxItems: 8 }),
    format: Opt(Enum(["png", "svg"], { description: "Default png." })),
    scale: Opt(Num({ description: "Default 1.", minimum: 0.1, maximum: 4 })),
    maxSize: Opt(
      Int({ description: "Longest side px (default 1600).", minimum: 64, maximum: 4096 }),
    ),
    background: Opt(Str({ description: "#rrggbb (default transparent)." })),
    theme: Opt(
      Arr(Obj({ axis: Str({ description: "Axis." }), value: Str({ description: "Value." }) }), {
        description: "Theme.",
      }),
    ),
  }),
  data: Obj({
    images: Arr(
      Obj({
        nodeId: Str({ description: "Node." }),
        width: Int({ description: "Pixels.", minimum: 0 }),
        height: Int({ description: "Pixels.", minimum: 0 }),
        index: Opt(
          Int({
            description: "png: index of the image content block in the MCP result.",
            minimum: 0,
          }),
        ),
        svg: Opt(Str({ description: "svg: the standalone SVG markup of the node." })),
      }),
      {
        description:
          "One entry per rendered node; png pixels are in the result's image content, svg markup in svg.",
      },
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
    "Exports nodes as png, kimo, svg, pdf, code (react-tailwind, html-css) or tokens to outDir (absolute), or returns code/tokens inline without outDir. Never overwrites a different file unless overwrite=true. Details: kimo_read_docs path=guide/export.",
  input: Obj({
    docId,
    target: Enum(EXPORT_TARGETS, { description: "Format." }),
    ids: Opt(
      Arr(nodeIdField("Node id."), { description: "Default: top-level frames.", maxItems: 200 }),
    ),
    outDir: Opt(Str({ description: "Absolute dir (required for png, kimo).", minLength: 1 })),
    scale: Opt(Num({ description: "png scale (default 2).", minimum: 0.1, maximum: 4 })),
    overwrite: Opt(Bool({ description: "Replace different files." })),
    variables: Opt(Bool({ description: "Code: variables as CSS vars (default true)." })),
    components: Opt(Bool({ description: "react-tailwind: components (default true)." })),
    layerNames: Opt(Bool({ description: "Code: layer names as data attributes." })),
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
