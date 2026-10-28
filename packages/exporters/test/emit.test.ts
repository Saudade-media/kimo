/** Emitter units: colors, token paths, polygon geometry, CSS and Tailwind mapping, PDF, icons. */
import { describe, expect, test } from "bun:test"
import { parseColor as rendererParseColor } from "@kimo/renderer"
import { PDFDocument } from "pdf-lib"
import {
  buildIR,
  CssWriter,
  emitPdf,
  exportDocument,
  type IRGradientPaint,
  layoutDocument,
  loadIcons,
  paintIssues,
  parseColor,
  tokenPath,
} from "../src"
import { utility } from "../src/css/tailwind"
import { polygonPath } from "../src/emit/geometry"
import { FIXTURES, fakeIcons, fakeMeasurer, loadFixture } from "./helpers"

const fixture = (name: string) => {
  const f = FIXTURES.find((x) => x.name === name)
  if (!f) throw new Error(name)
  return loadFixture(f)
}

describe("colors", () => {
  test("same sRGB as the renderer (hex, OKLCH gamut-mapped, Display-P3)", () => {
    for (const c of [
      "#12345678",
      "#ABC",
      { space: "oklch", l: 0.7, c: 0.4, h: 30 },
      { space: "oklch", l: 0.18, c: 0.01, h: 270, alpha: 0.5 },
      { space: "display-p3", r: 1, g: 0, b: 0 },
    ])
      expect(parseColor(c)).toEqual(rendererParseColor(c) as never)
  })
})

describe("token paths", () => {
  test("group then name, no repeated segment, alias first", () => {
    expect(tokenPath({ name: "surface/card", group: "color.surface" })).toEqual([
      "color",
      "surface",
      "card",
    ])
    expect(tokenPath({ name: "ink" })).toEqual(["ink"])
    expect(tokenPath({ name: "ui:accent" })).toEqual(["ui", "accent"])
  })
})

describe("star geometry", () => {
  test("2n vertices, first up, inner ones midway on the ratio ellipse", () => {
    const d = polygonPath(130, 130, 5, 0, 0.38)
    const pts = d
      .replace(/^M|Z$/g, "")
      .split("L")
      .map((p) => p.split(" ").map(Number) as [number, number])
    expect(pts.length).toBe(10)
    expect(pts[0]).toEqual([65, 0])
    const inner = pts[1] as [number, number]
    expect(Math.hypot(inner[0] - 65, inner[1] - 65)).toBeCloseTo(65 * 0.38, 1)
    expect(Math.atan2(inner[1] - 65, inner[0] - 65)).toBeCloseTo(-Math.PI / 2 + Math.PI / 5, 2)
  })

  test("radius rounds every vertex (outer and inner)", () => {
    expect((polygonPath(130, 130, 5, 4, 0.38).match(/A/g) ?? []).length).toBe(10)
    expect((polygonPath(130, 130, 6, 4).match(/A/g) ?? []).length).toBe(6)
  })
})

describe("CSS mapping", () => {
  const w = new CssWriter({ variables: false })
  const grad = (rotation: number): IRGradientPaint => ({
    kind: "linear",
    stops: [
      { at: 0, color: { css: "#000000", rgba: [0, 0, 0, 1] } },
      { at: 1, color: { css: "#FFFFFF", rgba: [1, 1, 1, 1] } },
    ],
    center: [0.5, 0.5],
    size: [1, 1],
    rotation,
    interpolation: "srgb",
    opacity: 1,
    blend: "normal",
  })
  test("linear gradients: rotation 0 points up (stop 0 at the bottom)", () => {
    expect(w.gradient(grad(0), 100, 100)).toBe("linear-gradient(0deg, #000000 0%, #FFFFFF 100%)")
    expect(w.gradient(grad(90), 100, 100)).toBe("linear-gradient(270deg, #000000 0%, #FFFFFF 100%)")
  })
  test("linear gradients on non-square boxes keep the canvas isolines", () => {
    // 45° CCW in a 200×100 box: the normal of the scaled isolines, not 315deg.
    expect(w.gradient(grad(45), 200, 100)).toMatch(/^linear-gradient\(333\.435deg/)
  })
  test("Tailwind: tokens, keywords, arbitrary values", () => {
    const tokens = (ns: string, ref: string) => (ns === "color" ? ref : null)
    expect(
      utility(
        { prop: "background-color", value: "var(--x)", token: { ns: "color", ref: "x" } },
        tokens,
      ),
    ).toBe("bg-x")
    expect(utility({ prop: "justify-content", value: "space-between" }, tokens)).toBe(
      "justify-between",
    )
    expect(utility({ prop: "width", value: "12.5px" }, tokens)).toBe("w-[12.5px]")
    expect(utility({ prop: "box-shadow", value: "0px 1px 2px 0px #000" }, tokens)).toBe(
      "shadow-[0px_1px_2px_0px_#000]",
    )
    expect(utility({ prop: "font-feature-settings", value: '"liga" 0' }, tokens)).toBe(
      "[font-feature-settings:'liga'_0]",
    )
  })
})

describe("raster and vector seams", () => {
  test("PDF: one page per root at the root's size, loadable", async () => {
    const { doc, libraries } = fixture("wrap-edge")
    const layout = await layoutDocument(doc, { libraries, measureText: fakeMeasurer })
    const ir = buildIR(doc, { libraries, layout })
    const file = await emitPdf(ir, { layout, measureText: fakeMeasurer })
    const pdf = await PDFDocument.load(file.contents as Uint8Array)
    expect(pdf.getPageCount()).toBe(1)
    const root = layout.nodes.get("Edges00001")
    expect(pdf.getPage(0).getSize()).toEqual({
      width: root?.local.w ?? 0,
      height: root?.local.h ?? 0,
    })
  })
  test("PDF bleed grows the page on every side and marks the trim box", async () => {
    const { doc, libraries } = fixture("wrap-edge")
    const layout = await layoutDocument(doc, { libraries, measureText: fakeMeasurer })
    const ir = buildIR(doc, { libraries, layout })
    const file = await emitPdf(ir, { layout, measureText: fakeMeasurer, bleed: 8.5 })
    const page = (await PDFDocument.load(file.contents as Uint8Array)).getPage(0)
    const root = layout.nodes.get("Edges00001")
    const w = root?.local.w ?? 0
    const h = root?.local.h ?? 0
    expect(page.getSize()).toEqual({ width: w + 17, height: h + 17 })
    expect(page.getTrimBox()).toEqual({ x: 8.5, y: 8.5, width: w, height: h })
  })
  test("icons load once into a synchronous lookup", async () => {
    const { doc, libraries } = fixture("styling-m2")
    const ir = buildIR(doc, { libraries })
    const seen: string[] = []
    const lookup = await loadIcons(ir, {
      load: async (s, n, w) => {
        seen.push(`${s}/${n}/${w ?? ""}`)
        return fakeIcons.get(s, n, w)
      },
    })
    expect(seen).toEqual(["lucide/star/", "material-rounded/home/300", "phosphor/bell/700"])
    expect(lookup.get("phosphor", "bell", 700)?.paths.length).toBe(1)
  })
})

describe("mesh and shader paint issues", () => {
  test("exportDocument reports them per target; PNG and tokens don't", async () => {
    const doc = {
      kimo: "1.0.0",
      features: ["fill/mesh", "fill/shader"],
      nodes: {
        mesh000001: {
          type: "rect",
          parent: null,
          order: "a",
          w: 10,
          h: 10,
          fill: { kind: "mesh", cols: 1, rows: 1, colors: ["#f00"], points: [[0, 0]] },
        },
        shad000001: {
          type: "rect",
          parent: null,
          order: "b",
          w: 10,
          h: 10,
          fill: { kind: "shader", src: "./a.glsl" },
        },
      },
    } as never
    const html = await exportDocument(doc, "html-css")
    expect(html.issues.map((i) => [i.code, i.nodeId])).toEqual([
      ["GRADIENT_APPROXIMATED", "mesh000001"],
      ["PAINT_UNSUPPORTED", "shad000001"],
    ])
    const ir = buildIR(doc)
    expect(paintIssues(ir, "svg").length).toBeGreaterThan(0)
    expect(paintIssues(ir, "pdf").length).toBeGreaterThan(0)
    expect(paintIssues(ir, "png")).toEqual([])
    expect(paintIssues(ir, "tokens-css")).toEqual([])
  })
})
