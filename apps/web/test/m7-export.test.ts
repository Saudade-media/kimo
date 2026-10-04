/**
 * M7 Export dialog (board 07 AsO2h): format → targets, generation through @kimo/exporters,
 * the code tokenizer (board colors), output-folder display, the no-overwrite write plan on a
 * memory platform, the zip writer, and the dialog's server render (structure + copy).
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "@kimo/core-schema"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { ExportDialog } from "../src/export/ExportDialog"
import { type ExportSource, generateExport } from "../src/export/generate"
import {
  codeLines,
  crc32,
  DEFAULT_TOGGLES,
  describeExport,
  EXPORT_FORMATS,
  exportLabel,
  folderDisplay,
  footerNote,
  lineNumber,
  planWrite,
  targetsOf,
  tokenizeLine,
  writePlan,
  zipFiles,
  zipNameOf,
} from "../src/export/model"

const FIXTURE = join(
  import.meta.dir,
  "../../../packages/exporters/test/fixtures/layout-matrix.kimo",
)
const doc = parse(readFileSync(FIXTURE, "utf8"))
const source: ExportSource = {
  fileName: "Layout matrix",
  document: () => doc,
  selection: () => [],
}

describe("board 07 copy and formats", () => {
  test("format rows in node order", () => {
    expect(EXPORT_FORMATS.map((f) => [f.icon, f.title, f.sub])).toEqual([
      ["atom", "React + Tailwind", "TSX · Tailwind v4"],
      ["code-xml", "HTML + CSS", "Static markup, CSS variables"],
      ["braces", "Design tokens", "CSS vars · W3C JSON"],
      ["image", "SVG / PNG", "Assets at 1×, 2×, 3×"],
    ])
    expect(DEFAULT_TOGGLES).toEqual({ variables: true, components: true, layerNames: false })
  })
  test("header, footer and button copy", () => {
    expect(describeExport("Hero", { frames: 1, layers: 12, variables: 4 })).toBe(
      "Hero · 1 frame · 12 layers · 4 variables",
    )
    expect(footerNote(3, true, "x.zip")).toBe(
      "3 files · existing files are diffed, never overwritten silently",
    )
    expect(exportLabel(3)).toBe("Export 3 files")
    expect(exportLabel(1)).toBe("Export 1 file")
    expect(zipNameOf("Marketing site")).toBe("Marketing site.zip")
  })
  test("targets per format", () => {
    expect(targetsOf("react").text).toEqual(["react-tailwind"])
    expect(targetsOf("html").text).toEqual(["html-css"])
    expect(targetsOf("tokens").text).toEqual(["tokens-css", "tokens-dtcg"])
    expect(targetsOf("assets")).toEqual({ text: ["svg"], png: true })
  })
})

describe("code preview", () => {
  test("line numbers pad to 4 columns", () => {
    expect(lineNumber(1, 17)).toBe("1   ")
    expect(lineNumber(17, 17)).toBe("17  ")
    expect(lineNumber(1, 12345)).toBe("1     ")
  })
  test("tsx tokens match the board's colors", () => {
    const t = tokenizeLine('    <section className="flex flex-col gap-4 px-10 pt-12">', "jsx")
    expect(t).toEqual([
      { kind: "plain", text: "    <" },
      { kind: "keyword", text: "section" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "className" },
      { kind: "plain", text: "=" },
      { kind: "string", text: '"flex flex-col gap-4 px-10 pt-12"' },
      { kind: "plain", text: ">" },
    ])
    expect(tokenizeLine("export function Hero() {", "jsx")).toEqual([
      { kind: "keyword", text: "export" },
      { kind: "plain", text: " " },
      { kind: "keyword", text: "function" },
      { kind: "plain", text: " Hero() {" },
    ])
  })
  test("css and json tokens", () => {
    expect(tokenizeLine("  --kimo-gap: 8px;", "css")).toEqual([
      { kind: "plain", text: "  " },
      { kind: "attr", text: "--kimo-gap" },
      { kind: "plain", text: ": 8px;" },
    ])
    expect(tokenizeLine('  "color": "#fff"', "json")).toEqual([
      { kind: "plain", text: "  " },
      { kind: "attr", text: '"color"' },
      { kind: "plain", text: ": " },
      { kind: "string", text: '"#fff"' },
    ])
  })
  test("trailing newline adds no line", () => {
    expect(codeLines("a\nb\n")).toEqual(["a", "b"])
  })
})

describe("output folder", () => {
  test("home prefix", () => {
    expect(folderDisplay("/Users/gui/loom/src/components")).toEqual({
      prefix: "~/",
      value: "loom/src/components",
    })
    expect(folderDisplay("/opt/out")).toEqual({ prefix: "/", value: "opt/out" })
  })
})

describe("generation through @kimo/exporters", () => {
  test("react, html and tokens produce files and a summary", async () => {
    const react = await generateExport(source, "react", DEFAULT_TOGGLES)
    expect(react.errors).toEqual([])
    expect(react.files.some((f) => f.path.endsWith(".tsx"))).toBe(true)
    expect(react.files.some((f) => f.path === "tokens.css")).toBe(true)
    expect(react.count).toBe(react.files.length)
    expect(react.summary.frames).toBeGreaterThan(0)
    expect(react.summary.layers).toBeGreaterThanOrEqual(react.summary.frames)

    const html = await generateExport(source, "html", DEFAULT_TOGGLES)
    expect(html.files.map((f) => f.path).sort()).toEqual(["index.html", "styles.css", "tokens.css"])

    const tokens = await generateExport(source, "tokens", DEFAULT_TOGGLES)
    expect(tokens.files.map((f) => f.path)).toEqual(["tokens.css", "tokens.json"])
  })
  test("layer names toggle reaches the emitter", async () => {
    const off = await generateExport(source, "html", { ...DEFAULT_TOGGLES, layerNames: false })
    const on = await generateExport(source, "html", { ...DEFAULT_TOGGLES, layerNames: true })
    const html = (g: typeof on) => g.files.find((f) => f.path === "index.html")?.contents as string
    expect(html(on)).not.toBe(html(off))
  })
  test("assets: SVG needs the renderer, PNGs are counted per scale", async () => {
    const g = await generateExport(source, "assets", DEFAULT_TOGGLES)
    expect(g.count).toBe(g.files.length + g.summary.frames * 3)
    expect(g.errors.length).toBeGreaterThan(0)
  })
  test("selection narrows the export", async () => {
    const all = await generateExport(source, "html", DEFAULT_TOGGLES)
    const nodes = doc.nodes as unknown as Record<string, { parent?: string | null; type: string }>
    const first = Object.keys(nodes).find((id) => !nodes[id]?.parent && nodes[id]?.type === "frame")
    const one = await generateExport(
      { ...source, selection: () => (first ? [first] : []) },
      "html",
      DEFAULT_TOGGLES,
    )
    expect(one.summary.frames).toBe(1)
    expect(all.summary.frames).toBeGreaterThanOrEqual(1)
  })
})

describe("desktop: existing files are diffed, never overwritten silently", () => {
  test("new / same / changed", async () => {
    const platform = createMemoryPlatform({
      files: { "/out/same.css": "a{}", "/out/changed.css": "old" },
    })
    const files = [
      { path: "new.tsx", contents: "x" },
      { path: "same.css", contents: "a{}" },
      { path: "changed.css", contents: "new" },
      { path: "img/a@2x.png", contents: new Uint8Array([1, 2, 3]) },
    ]
    const plan = await planWrite(files, "/out", platform)
    expect(plan.map((e) => [e.path, e.status])).toEqual([
      ["new.tsx", "new"],
      ["same.css", "same"],
      ["changed.css", "changed"],
      ["img/a@2x.png", "new"],
    ])
    const r = await writePlan(plan, "/out", platform)
    expect(r).toEqual({
      folder: "/out",
      written: ["new.tsx", "img/a@2x.png"],
      unchanged: ["same.css"],
      kept: ["changed.css"],
    })
    expect((await platform.files.readText("/out/changed.css")).text).toBe("old")
    expect((await platform.files.readText("/out/new.tsx")).text).toBe("x")
    expect([...(await platform.files.readBytes("/out/img/a@2x.png"))]).toEqual([1, 2, 3])
    // An explicit overwrite is the only way to replace a changed file.
    const again = await writePlan(plan, "/out", platform, new Set(["changed.css"]))
    expect(again.written).toContain("changed.css")
    expect((await platform.files.readText("/out/changed.css")).text).toBe("new")
  })
})

describe("web: zip", () => {
  test("crc32 of a known string", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926")
  })
  test("store-only archive layout is deterministic", () => {
    const files = [
      { path: "a.txt", contents: "hello" },
      { path: "b/c.bin", contents: new Uint8Array([0, 255]) },
    ]
    const z = zipFiles(files)
    expect(zipFiles(files)).toEqual(z)
    const v = new DataView(z.buffer)
    expect(v.getUint32(0, true)).toBe(0x04034b50)
    const end = z.byteLength - 22
    expect(v.getUint32(end, true)).toBe(0x06054b50)
    expect(v.getUint16(end + 10, true)).toBe(2)
    const name = new TextDecoder().decode(z.slice(30, 35))
    expect(name).toBe("a.txt")
    expect(new TextDecoder().decode(z.slice(35, 40))).toBe("hello")
  })
})

describe("dialog render", () => {
  test("structure and copy (before the first generation)", () => {
    const html = renderToString(
      h(ExportDialog, {
        platform: createMemoryPlatform(),
        source,
        fileRef: "/Users/me/loom/site.kimo",
        onClose: () => {},
      }),
    )
    for (const s of [
      "Export to code",
      "Format",
      "React + Tailwind",
      "HTML + CSS",
      "Design tokens",
      "SVG / PNG",
      "Options",
      "Variables as CSS custom properties",
      "Split instances into components",
      "Keep layer names as data attributes",
      "Copy code",
      "Export 0 files",
    ])
      expect(html).toContain(s)
  })
})
