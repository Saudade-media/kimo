import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { createElement as h, type ReactElement } from "react"
import { renderToString } from "react-dom/server"
import { elementToPath } from "../src/gallery/demo-icons"
import {
  AlignmentGrid,
  AlphaSlider,
  alignmentCell,
  anchoredPosition,
  BLEND_MODE_GROUPS,
  BlendModeMenu,
  blendModeLabel,
  ColorArea,
  ColorPicker,
  cellAlignment,
  color,
  colorAt,
  DirectionControl,
  EffectRow,
  FillRow,
  filterIcons,
  formatColor,
  GradientEditor,
  GradientStopBar,
  HueSlider,
  IconPicker,
  IconTile,
  ImageFillPopover,
  iconSetOf,
  imageFillBackground,
  libraryOf,
  MenuDense,
  MenuDivider,
  MenuItemDense,
  Popover,
  PropField,
  parseColor,
  parseHex,
  parsePercent,
  percent,
  SizeField,
  Slider,
  StrokeSideFields,
  SwatchTile,
  stopsGradient,
  TooltipHint,
  toHex,
  visibleRows,
  ZoomBadge,
  zoomLabel,
} from "../src/index"

const icon = h("svg", { viewBox: "0 0 24 24", "data-icon": "" })
const html = (el: ReactElement) => renderToString(el)
/** createElement with positional children for components whose props require `children`. */
const hc = h as unknown as (type: unknown, props: object, ...children: unknown[]) => ReactElement
const byte = fc.integer({ min: 0, max: 255 })
const rgb = fc.record({ r: byte, g: byte, b: byte })

describe("color conversions", () => {
  test("hex parse / format", () => {
    expect(parseHex("#F4A261")).toEqual({ r: 244, g: 162, b: 97, a: 1 })
    expect(parseHex("f4a")).toEqual({ r: 255, g: 68, b: 170, a: 1 })
    expect(parseHex("#0A0A0A80")?.a).toBeCloseTo(128 / 255, 6)
    expect(parseHex("#12345")).toBeNull()
    expect(parseHex("zzzzzz")).toBeNull()
    expect(toHex({ r: 244, g: 162, b: 97, a: 1 })).toBe("#F4A261")
    expect(toHex({ r: 10, g: 10, b: 10, a: 0.5 })).toBe("#0A0A0A80")
  })

  test("known values in every format (board 09 Format menu meta)", () => {
    const c = { r: 244, g: 162, b: 97, a: 1 }
    expect(formatColor(c, "hex")).toBe("F4A261")
    expect(formatColor(c, "rgb")).toBe("244 162 97")
    expect(formatColor(c, "hsl")).toBe("27 87 67")
    // The design's meta (GbOS1) reads "0.78 0.13 55"; the exact OKLab hue of #F4A261 is 57.7°
    // (verified against the CSS Color 4 reference values below), so the hue is data, not copy.
    expect(formatColor(c, "oklch")).toBe("0.78 0.13 58")
    // CSS Color 4 reference values
    expect(formatColor({ r: 255, g: 0, b: 0, a: 1 }, "oklch")).toBe("0.63 0.26 29")
    expect(formatColor({ r: 0, g: 0, b: 255, a: 1 }, "hsl")).toBe("240 100 50")
    const white = color.rgbToOklch({ r: 255, g: 255, b: 255, a: 1 })
    expect(white.l).toBeCloseTo(1, 4)
    expect(white.c).toBeLessThan(1e-4)
  })

  test("HSV round-trips every sRGB byte triple", () => {
    fc.assert(
      fc.property(rgb, ({ r, g, b }) => {
        const back = color.hsvToRgb(color.rgbToHsv({ r, g, b, a: 1 }))
        expect(Math.round(back.r)).toBe(r)
        expect(Math.round(back.g)).toBe(g)
        expect(Math.round(back.b)).toBe(b)
      }),
      { numRuns: 500 },
    )
  })

  test("HSL round-trips", () => {
    fc.assert(
      fc.property(rgb, ({ r, g, b }) => {
        const back = color.hslToRgb(color.rgbToHsl({ r, g, b, a: 1 }))
        expect(Math.abs(back.r - r)).toBeLessThan(1e-6)
        expect(Math.abs(back.g - g)).toBeLessThan(1e-6)
        expect(Math.abs(back.b - b)).toBeLessThan(1e-6)
      }),
      { numRuns: 500 },
    )
  })

  test("OKLCH round-trips (in gamut)", () => {
    fc.assert(
      fc.property(rgb, ({ r, g, b }) => {
        const back = color.oklchToRgb(color.rgbToOklch({ r, g, b, a: 1 }))
        expect(Math.abs(back.r - r)).toBeLessThan(0.01)
        expect(Math.abs(back.g - g)).toBeLessThan(0.01)
        expect(Math.abs(back.b - b)).toBeLessThan(0.01)
      }),
      { numRuns: 500 },
    )
  })

  test("typed values parse back (hsl: integer H/S/L quantise to ≤ 4.6 per byte channel)", () => {
    fc.assert(
      fc.property(
        rgb,
        fc.constantFrom("rgb", "hsl", "hex") as fc.Arbitrary<"rgb" | "hsl" | "hex">,
        (c, f) => {
          const text = formatColor({ ...c, a: 1 }, f)
          const p = parseColor(text, f)
          expect(p).not.toBeNull()
          // ±0.5° H (≤2.13) + ±0.5% S (≤0.64) + ±0.5% L (≤1.28) + 0.5 byte rounding ≈ 4.54 worst case.
          const tol = f === "hsl" ? 4.6 : 0.5
          expect(Math.abs((p?.r ?? -9) - c.r)).toBeLessThanOrEqual(tol)
          expect(Math.abs((p?.g ?? -9) - c.g)).toBeLessThanOrEqual(tol)
          expect(Math.abs((p?.b ?? -9) - c.b)).toBeLessThanOrEqual(tol)
        },
      ),
      { numRuns: 300 },
    )
  })

  test("oklch out of gamut clips per channel; invalid input → null", () => {
    const c = color.oklchToRgb({ l: 0.9, c: 0.4, h: 140 })
    for (const v of [c.r, c.g, c.b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(255)
    }
    expect(parseColor("1 2", "rgb")).toBeNull()
    expect(parseColor("a b c", "hsl")).toBeNull()
    expect(parseColor("#F4A26180", "hex", 1)?.a).toBeCloseTo(128 / 255, 6)
    expect(parseColor("F4A261", "hex", 0.5)?.a).toBe(0.5)
  })

  test("percent helpers", () => {
    expect(percent(0.8)).toBe("80%")
    expect(parsePercent("45%")).toBe(0.45)
    expect(parsePercent("150")).toBe(1)
    expect(parsePercent("x")).toBeNull()
  })
})

describe("anchoredPosition", () => {
  const vp = { x: 0, y: 0, width: 1000, height: 800 }
  const box = { width: 248, height: 300 }
  test("4px below, left-aligned (board 09 default)", () => {
    expect(anchoredPosition({ x: 100, y: 100, width: 200, height: 28 }, box, vp)).toEqual({
      x: 100,
      y: 132,
      side: "bottom",
    })
  })
  test("flips above when it does not fit below", () => {
    const p = anchoredPosition({ x: 100, y: 600, width: 200, height: 28 }, box, vp)
    expect(p).toEqual({ x: 100, y: 296, side: "top" })
  })
  test("shifts inside the viewport on the cross axis", () => {
    const p = anchoredPosition({ x: 900, y: 100, width: 80, height: 28 }, box, vp)
    expect(p.x).toBe(1000 - 8 - 248)
  })
  test("never leaves the padded viewport horizontally (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 1050 }),
        fc.integer({ min: 0, max: 780 }),
        fc.integer({ min: 10, max: 300 }),
        (x, y, w) => {
          const p = anchoredPosition({ x, y, width: w, height: 20 }, box, vp)
          expect(p.x).toBeGreaterThanOrEqual(8)
          expect(p.x + box.width).toBeLessThanOrEqual(992)
        },
      ),
    )
  })
})

describe("alignment grid mapping", () => {
  test("row: rows are the cross axis", () => {
    expect(alignmentCell("row", "end", "start")).toEqual({ row: 0, col: 2 })
    expect(alignmentCell("column", "end", "start")).toEqual({ row: 2, col: 0 })
    expect(alignmentCell("row", "between", "center")).toBeNull()
  })
  test("cellAlignment inverts alignmentCell", () => {
    for (const dir of ["row", "column"] as const)
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++) {
          const a = cellAlignment(dir, row, col)
          expect(alignmentCell(dir, a.justify, a.align)).toEqual({ row, col })
        }
  })
})

describe("gradients, icons, image fill", () => {
  test("colorAt interpolates between stops", () => {
    const stops = [
      { color: "#000000", at: 0 },
      { color: "#FFFFFF", at: 1 },
    ]
    expect(colorAt(stops, 0.5).toUpperCase()).toMatch(/^#(7F|80){3}$/)
    expect(colorAt(stops, -1).toUpperCase()).toBe("#000000")
    expect(stopsGradient([stops[1] as never, stops[0] as never])).toBe(
      "linear-gradient(to right, #000000 0%, #FFFFFF 100%)",
    )
  })
  test("filterIcons ranks prefix matches first and matches tags", () => {
    const list = [
      { name: "arrow-up" },
      { name: "map" },
      { name: "camera", tags: ["photo"] },
      { name: "cam" },
    ]
    expect(filterIcons(list, "cam").map((e) => e.name)).toEqual(["camera", "cam"])
    expect(filterIcons(list, "photo").map((e) => e.name)).toEqual(["camera"])
    expect(filterIcons(list, "").length).toBe(4)
  })
  test("visibleRows covers the viewport plus overscan", () => {
    expect(visibleRows(0, 140, 100)).toEqual({ first: 0, last: 6 })
    expect(visibleRows(360, 140, 100)).toEqual({ first: 8, last: 16 })
    expect(visibleRows(0, 140, 2)).toEqual({ first: 0, last: 1 })
  })
  test("icon set ↔ library", () => {
    expect(iconSetOf("material", "rounded")).toBe("material-rounded")
    expect(libraryOf("material-sharp")).toEqual({ library: "material", style: "sharp" })
    expect(libraryOf("feather").library).toBe("feather")
  })
  test("image fill modes as CSS", () => {
    expect(imageFillBackground("a.png", "cover").backgroundSize).toBe("cover")
    expect(imageFillBackground("a.png", "stretch").backgroundSize).toBe("100% 100%")
    expect(imageFillBackground("a.png", "tile").backgroundRepeat).toBe("repeat")
  })
  test("demo icon elements → path data", () => {
    expect(elementToPath("line", { x1: 1, y1: 2, x2: 3, y2: 4 })).toBe("M1 2L3 4")
    expect(elementToPath("polygon", { points: "0,0 1,0 1,1" })).toBe("M0 0L1 0L1 1z")
    expect(elementToPath("circle", { cx: 12, cy: 12, r: 2 })).toBe(
      "M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0z",
    )
  })
  test("blend modes: 19 values, labels per board 09", () => {
    expect(BLEND_MODE_GROUPS.flat().length).toBe(19)
    expect(blendModeLabel("linear-burn")).toBe("Plus darker")
    expect(blendModeLabel("linear-dodge")).toBe("Plus lighter")
    expect(zoomLabel(8)).toBe("800%")
  })
})

describe("M2 components render (SSR, roles and labels)", () => {
  const provider = {
    catalog: async () => [{ name: "star" }],
    load: async () => null,
    get: () => null,
  }
  const cases: [string, ReactElement, string[]][] = [
    [
      "SizeField",
      h(SizeField, { prefix: "W", value: "640", mode: "fill" }),
      ['aria-haspopup="menu"', ">Fill<"],
    ],
    [
      "AlignmentGrid",
      h(AlignmentGrid, { dir: "row", justify: "start", align: "start" }),
      ['role="radiogroup"', 'aria-checked="true"', "kimo-alignment-grid__bars"],
    ],
    [
      "DirectionControl",
      h(DirectionControl, { value: "row" }),
      ['role="radiogroup"', 'aria-label="Horizontal"'],
    ],
    [
      "FillRow",
      h(FillRow, { swatch: "#F4A261", label: "F4A261", opacity: "100%", visible: false }),
      ["kimo-fill-row--hidden"],
    ],
    ["EffectRow", h(EffectRow, { kind: "background-blur", visible: true }), [">Background blur<"]],
    [
      "StrokeSideFields",
      h(StrokeSideFields, { value: { t: 1, r: 0, b: 1, l: 0 } }),
      ['aria-label="Stroke top"'],
    ],
    [
      "Slider",
      h(Slider, { value: 0.5, "aria-label": "Weight" }),
      ['role="slider"', 'aria-valuenow="0.5"'],
    ],
    ["HueSlider", h(HueSlider, { hue: 24, color: "#F4A261" }), ['aria-valuetext="24°"']],
    ["AlphaSlider", h(AlphaSlider, { alpha: 0.5, color: "#F4A261" }), ['aria-valuetext="50%"']],
    [
      "ColorArea",
      h(ColorArea, { hue: 0, saturation: 1, value: 1, color: "#FF0000" }),
      ["Saturation 100%"],
    ],
    [
      "GradientStopBar",
      h(GradientStopBar, {
        stops: [
          { color: "#000000", at: 0 },
          { color: "#FFFFFF", at: 1 },
        ],
        selected: 1,
      }),
      ['role="group"', 'aria-current="true"'],
    ],
    [
      "SwatchTile",
      h(SwatchTile, { color: "#F4A261", selected: true, "aria-label": "Sand" }),
      ['aria-pressed="true"'],
    ],
    [
      "IconTile",
      h(IconTile, { name: "star", icon, selected: true }),
      ['role="option"', 'aria-selected="true"'],
    ],
    [
      "MenuDense",
      hc(MenuDense, { label: "Menu" }, [
        h(MenuItemDense, { key: "a", label: "Multiply", checked: true }),
        h(MenuDivider, { key: "d" }),
        h(MenuItemDense, { key: "b", label: "RGB", meta: "244 162 97", mono: true }),
      ]),
      ['role="menu"', 'role="menuitemradio"', 'role="separator"', "244 162 97"],
    ],
    ["Popover", hc(Popover, { title: "Fill" }, "x"), ['role="dialog"', 'aria-label="Fill"']],
    ["TooltipHint", hc(TooltipHint, { icon }, "Close path"), ["Close path"]],
    ["ZoomBadge", h(ZoomBadge, { zoom: 8 }), [">800%<"]],
    [
      "ColorPicker",
      h(ColorPicker, { color: "#F4A261", documentColors: ["#F4A261"] }),
      ['role="tablist"', "Document colors"],
    ],
    [
      "GradientEditor",
      h(GradientEditor, {
        kind: "linear",
        stops: [
          { color: "#F4A261", at: 0 },
          { color: "#6D2E46", at: 1 },
        ],
        selected: 0,
      }),
      ['aria-label="Gradient"', "Stops"],
    ],
    [
      "BlendModeMenu",
      h(BlendModeMenu, { value: "multiply", autoFocus: false }),
      ["Plus darker", 'aria-checked="true"'],
    ],
    [
      "IconPicker",
      h(IconPicker, { provider, set: "lucide", name: "star" }),
      ['aria-label="Icon"', "lucide · ISC"],
    ],
    [
      "ImageFillPopover",
      h(ImageFillPopover, {
        mode: "cover",
        opacity: 1,
        naturalSize: { width: 2400, height: 1600 },
      }),
      ["2400<!-- --> × <!-- -->1600", ">Replace<", ">Remove<"],
    ],
    [
      "PropField icon prefix",
      h(PropField, { prefix: icon, value: 100, inputLabel: "Opacity" }),
      ["kimo-prop-field__prefix--icon"],
    ],
  ]
  for (const [name, el, needles] of cases)
    test(name, () => {
      const out = html(el)
      for (const n of needles) expect(out).toContain(n)
    })
})
