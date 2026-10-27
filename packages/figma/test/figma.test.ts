import { describe, expect, test } from "bun:test"
import {
  FORMAT_VERSION,
  featuresNeeded,
  parse,
  SCHEMA_URL,
  serialize,
  validate,
} from "@kimo/core-schema"
import {
  convertFigma,
  decodeMessage,
  decodeSchema,
  figmaImageHashes,
  isFigmaClipboard,
  parseFigmaClipboard,
  vectorNetworkPath,
} from "../src/index"
import {
  encodeMessage,
  encodeSchema,
  figmaHtml,
  guid,
  identity,
  message,
  onInternal,
  onPage,
  rgb,
  SCHEMA,
  under,
} from "./helpers"

// biome-ignore lint/suspicious/noExplicitAny: tests poke at arbitrary JSON structures
type Obj = Record<string, any>

/** Encodes, decodes and converts `nodes`; checks the result is a valid Kimo document. */
function paste(nodes: Obj[], opts: { blobs?: Uint8Array[]; images?: Record<string, string> } = {}) {
  const html = figmaHtml(message(nodes, opts.blobs), { fileKey: "abc" })
  const copy = parseFigmaClipboard(html)
  if (!copy) throw new Error("not a Figma copy")
  let n = 0
  const r = convertFigma(copy.message, {
    newId: () => `Node${String(++n).padStart(4, "0")}`,
    images: opts.images,
  })
  const doc: Obj = { $schema: SCHEMA_URL, format: FORMAT_VERSION, nodes: r.nodes }
  const features = [...featuresNeeded(doc)]
  if (features.length) doc.features = features.sort()
  const v = validate(parse(serialize(doc as never)))
  expect(v.errors).toEqual([])
  const byName = (name: string) => Object.values(r.nodes).find((x) => x.name === name) as Obj
  return { ...r, byName }
}

describe("kiwi", () => {
  test("a schema and message round-trip: enums, structs, arrays, floats, bytes", () => {
    const schema = decodeSchema(encodeSchema(SCHEMA))
    expect(schema.find((d) => d.name === "Color")?.kind).toBe("STRUCT")
    const msg = {
      nodeChanges: [
        {
          guid: guid(7, 3),
          type: "FRAME",
          name: "Café ✨",
          opacity: 0.25,
          size: { x: 120.5, y: -3 },
          fillPaints: [{ type: "SOLID", color: rgb(1, 0.5, 0, 1), visible: true }],
        },
      ],
      blobs: [{ bytes: Uint8Array.from([0, 1, 255]) }],
    }
    const out = decodeMessage(schema, "Message", encodeMessage(SCHEMA, "Message", msg)) as Obj
    const n = out.nodeChanges[0]
    expect(n.guid).toEqual({ sessionID: 3, localID: 7 })
    expect(n.type).toBe("FRAME")
    expect(n.name).toBe("Café ✨")
    expect(n.opacity).toBe(0.25)
    expect(n.size).toEqual({ x: 120.5, y: -3 })
    expect(n.fillPaints[0].color).toEqual({ r: 1, g: 0.5, b: 0, a: 1 })
    expect([...out.blobs[0].bytes]).toEqual([0, 1, 255])
  })

  test("truncated data throws instead of reading past the end", () => {
    const schema = decodeSchema(encodeSchema(SCHEMA))
    const bytes = encodeMessage(SCHEMA, "Message", { nodeChanges: [{ name: "x" }] })
    expect(() => decodeMessage(schema, "Message", bytes.slice(0, 3))).toThrow()
  })
})

describe("clipboard", () => {
  test("a Figma copy is recognised and decoded with its metadata", () => {
    const html = figmaHtml(message([]), { fileKey: "abc", imageHashes: { aa: "https://x" } })
    expect(isFigmaClipboard(html)).toBe(true)
    const copy = parseFigmaClipboard(html)
    expect(copy?.kind).toBe("fig-kiwi")
    expect(copy?.meta?.fileKey).toBe("abc")
    expect((copy?.message.nodeChanges as Obj[] | undefined)?.length).toBe(3)
  })

  test("other HTML is not a Figma copy", () => {
    expect(isFigmaClipboard("<b>hello</b>")).toBe(false)
    expect(parseFigmaClipboard("<b>hello</b>")).toBeNull()
  })
})

describe("convert", () => {
  test("only the visible page's nodes are pasted, in order, with their source boxes", () => {
    const r = paste([
      {
        guid: guid(10),
        parentIndex: onPage("!"),
        type: "RECTANGLE",
        name: "A",
        size: { x: 10, y: 20 },
        transform: identity(5, 6),
      },
      {
        guid: guid(11),
        parentIndex: onPage('"'),
        type: "ELLIPSE",
        name: "B",
        size: { x: 4, y: 4 },
        transform: identity(),
      },
      {
        guid: guid(12),
        parentIndex: onInternal("!"),
        type: "RECTANGLE",
        name: "Main",
        size: { x: 1, y: 1 },
      },
    ])
    expect(r.roots.map((id) => r.nodes[id]?.name)).toEqual(["A", "B"])
    expect(Object.values(r.nodes).some((n) => n.name === "Main")).toBe(false)
    expect(r.boxes[r.roots[0] as string]).toEqual({ x: 5, y: 6, w: 10, h: 20 })
    expect(r.byName("A")).toMatchObject({ type: "rect", parent: null, x: 5, y: 6, w: 10, h: 20 })
    expect(r.byName("B").type).toBe("ellipse")
  })

  test("auto layout: direction, gap, padding, alignment, hug and fill sizing, absolute children", () => {
    const r = paste([
      {
        guid: guid(10),
        parentIndex: onPage("!"),
        type: "FRAME",
        name: "Row",
        size: { x: 300, y: 40 },
        transform: identity(),
        stackMode: "HORIZONTAL",
        stackSpacing: 8,
        stackHorizontalPadding: 16,
        stackVerticalPadding: 4,
        stackPaddingRight: 16,
        stackPaddingBottom: 4,
        stackPrimarySizing: "FIXED",
        stackCounterSizing: "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE",
        stackPrimaryAlignItems: "SPACE_EVENLY",
        stackCounterAlignItems: "CENTER",
        frameMaskDisabled: true,
      },
      {
        guid: guid(11),
        parentIndex: under(10, "!"),
        type: "FRAME",
        name: "Hug",
        size: { x: 50, y: 20 },
        transform: identity(16, 10),
        stackMode: "VERTICAL",
      },
      {
        guid: guid(12),
        parentIndex: under(10, '"'),
        type: "RECTANGLE",
        name: "Grow",
        size: { x: 100, y: 32 },
        transform: identity(74, 4),
        stackChildPrimaryGrow: 1,
        stackChildAlignSelf: "STRETCH",
      },
      {
        guid: guid(13),
        parentIndex: under(10, "#"),
        type: "RECTANGLE",
        name: "Badge",
        size: { x: 8, y: 8 },
        transform: identity(290, 2),
        stackPositioning: "ABSOLUTE",
      },
    ])
    expect(r.byName("Row")).toMatchObject({
      type: "frame",
      w: 300,
      h: { mode: "fit" },
      layout: { dir: "row", gap: 8, pad: [4, 16], justify: "between", align: "center" },
    })
    expect(r.byName("Row").clip).toBeUndefined()
    // Absent primary sizing hugs; absent counter sizing is fixed.
    expect(r.byName("Hug")).toMatchObject({
      w: 50,
      h: { mode: "fit" },
      layout: { dir: "column" },
      clip: true,
    })
    expect(r.byName("Grow")).toMatchObject({ w: { mode: "fill" }, h: { mode: "fill" } })
    expect(r.byName("Badge")).toMatchObject({ position: "absolute", x: 290, y: 2, w: 8, h: 8 })
  })

  test("a group (frame that resizes to fit) becomes a group; children stay relative", () => {
    const r = paste([
      {
        guid: guid(10),
        parentIndex: onPage("!"),
        type: "FRAME",
        name: "G",
        resizeToFit: true,
        size: { x: 20, y: 20 },
        transform: identity(100, 100),
      },
      {
        guid: guid(11),
        parentIndex: under(10, "!"),
        type: "RECTANGLE",
        name: "R",
        size: { x: 20, y: 20 },
        transform: identity(),
      },
    ])
    expect(r.byName("G")).toMatchObject({ type: "group", x: 100, y: 100 })
    expect(r.byName("R")).toMatchObject({ parent: r.roots[0], x: 0, y: 0 })
  })

  test("rotation and flips keep the box where Figma draws it", () => {
    const c = Math.cos(Math.PI / 6)
    const s = Math.sin(Math.PI / 6)
    // 30° counter-clockwise (Figma: m01 = sin, m10 = -sin), origin at (10, 20).
    const r = paste([
      {
        guid: guid(10),
        parentIndex: onPage("!"),
        type: "RECTANGLE",
        name: "R",
        size: { x: 40, y: 10 },
        transform: { m00: c, m01: s, m02: 10, m10: -s, m11: c, m12: 20 },
      },
      {
        guid: guid(11),
        parentIndex: onPage('"'),
        type: "RECTANGLE",
        name: "F",
        size: { x: 40, y: 10 },
        transform: { m00: -1, m01: 0, m02: 140, m10: 0, m11: 1, m12: 0 },
      },
    ])
    expect(r.byName("R").rotation).toBeCloseTo(30, 2)
    expect(r.byName("R").x).toBeCloseTo(10, 1)
    expect(r.byName("R").y).toBeCloseTo(20, 1)
    // Mirrored about x = 140 - 20: Kimo flips inside the box at (100, 0).
    expect(r.byName("F")).toMatchObject({ flipX: true, x: 100, y: 0 })
  })

  test("paints: solid with opacity, hidden paints, linear gradient direction, images", () => {
    const hash = Uint8Array.from({ length: 20 }, (_, i) => i)
    const hashHex = [...hash].map((b) => b.toString(16).padStart(2, "0")).join("")
    const r = paste(
      [
        {
          guid: guid(10),
          parentIndex: onPage("!"),
          type: "RECTANGLE",
          name: "Solid",
          size: { x: 10, y: 10 },
          transform: identity(),
          fillPaints: [
            { type: "SOLID", color: rgb(1, 0, 0), opacity: 0.5, visible: true },
            { type: "SOLID", color: rgb(0, 0, 1), opacity: 1, visible: false },
          ],
        },
        {
          guid: guid(11),
          parentIndex: onPage('"'),
          type: "RECTANGLE",
          name: "Gradient",
          size: { x: 10, y: 10 },
          transform: identity(),
          // Identity: left (stop 0) to right (stop 1).
          fillPaints: [
            {
              type: "GRADIENT_LINEAR",
              visible: true,
              opacity: 1,
              transform: identity(),
              stops: [
                { color: rgb(0, 0, 0), position: 0 },
                { color: rgb(1, 1, 1), position: 1 },
              ],
            },
          ],
        },
        {
          guid: guid(12),
          parentIndex: onPage("#"),
          type: "RECTANGLE",
          name: "Image",
          size: { x: 10, y: 10 },
          transform: identity(),
          fillPaints: [
            { type: "IMAGE", visible: true, opacity: 1, image: { hash }, imageScaleMode: "FIT" },
          ],
        },
      ],
      { images: { [hashHex]: "./assets/0123456789abcdef.png" } },
    )
    expect(r.byName("Solid").fill).toEqual([
      "#FF000080",
      { kind: "solid", color: "#0000FF", visible: false },
    ])
    const g = r.byName("Gradient").fill
    expect(g).toMatchObject({ kind: "linear", center: [0.5, 0.5], size: [1, 1] })
    // Kimo: rotation 0 points up; a left-to-right gradient is 90° clockwise = -90 CCW.
    expect(g.rotation).toBeCloseTo(-90, 1)
    expect(r.byName("Image").fill).toEqual({
      kind: "image",
      src: "./assets/0123456789abcdef.png",
      fit: "contain",
    })
    expect(
      figmaImageHashes(
        parseFigmaClipboard(
          figmaHtml(
            message([
              {
                guid: guid(12),
                parentIndex: onPage("!"),
                type: "RECTANGLE",
                fillPaints: [{ type: "IMAGE", image: { hash } }],
              },
            ]),
          ),
        )?.message ?? {},
      ),
    ).toEqual([hashHex])
  })

  test("an image that was not downloaded pastes as a missing image and is reported", () => {
    const r = paste([
      {
        guid: guid(10),
        parentIndex: onPage("!"),
        type: "RECTANGLE",
        name: "Image",
        size: { x: 10, y: 10 },
        transform: identity(),
        fillPaints: [
          { type: "IMAGE", visible: true, image: { hash: new Uint8Array(20).fill(171) } },
        ],
      },
    ])
    expect(r.byName("Image").fill.src).toBe("./assets/abababababababab.png")
    expect(r.warnings.map((w) => w.code)).toEqual(["IMAGE_MISSING"])
  })

  test("effects and strokes", () => {
    const r = paste([
      {
        guid: guid(10),
        parentIndex: onPage("!"),
        type: "FRAME",
        name: "Card",
        size: { x: 100, y: 50 },
        transform: identity(),
        cornerRadius: 12,
        strokePaints: [{ type: "SOLID", color: rgb(0, 0, 0, 0.1), visible: true, opacity: 1 }],
        strokeWeight: 2,
        effects: [
          {
            type: "DROP_SHADOW",
            color: rgb(0, 0, 0, 0.25),
            offset: { x: 0, y: 4 },
            radius: 8,
            spread: 0,
            visible: true,
          },
          { type: "BACKGROUND_BLUR", radius: 16, visible: true },
        ],
      },
    ])
    expect(r.byName("Card")).toMatchObject({
      radius: 12,
      stroke: { paint: "#0000001A", width: 2 },
      effects: [
        { kind: "shadow", x: 0, y: 4, blur: 7, color: "#00000040" },
        { kind: "backdrop-blur", radius: 14 },
      ],
    })
  })

  test("text: font, weight, italic, units, auto-resize, and style runs as spans", () => {
    const r = paste([
      {
        guid: guid(10),
        parentIndex: onPage("!"),
        type: "TEXT",
        name: "T",
        size: { x: 200, y: 20 },
        transform: identity(),
        fontSize: 16,
        fontName: { family: "Inter", style: "Semi Bold Italic" },
        lineHeight: { value: 24, units: "PIXELS" },
        letterSpacing: { value: 10, units: "PERCENT" },
        textAutoResize: "HEIGHT",
        fillPaints: [{ type: "SOLID", color: rgb(0, 0, 0), visible: true, opacity: 1 }],
        textData: {
          characters: "Hello bold",
          characterStyleIDs: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
          styleOverrideTable: [
            {
              styleID: 1,
              fontName: { family: "Inter", style: "Bold" },
              fillPaints: [{ type: "SOLID", color: rgb(1, 0, 0), visible: true, opacity: 1 }],
            },
          ],
        },
      },
    ])
    const t = r.byName("T")
    expect(t).toMatchObject({
      type: "text",
      grow: "fixed-width",
      w: 200,
      style: {
        font: "Inter",
        size: 16,
        weight: 600,
        italic: true,
        lineHeight: { px: 24 },
        letterSpacing: 1.6,
      },
      fill: "#000000",
    })
    expect(r.fonts).toEqual(["Inter"])
  })

  test("text runs use characterStyleIDs; a run's own style and color become a span", () => {
    const nodes = [
      {
        guid: guid(10),
        parentIndex: onPage("!"),
        type: "TEXT",
        name: "T",
        size: { x: 100, y: 20 },
        transform: identity(),
        fontSize: 16,
        fontName: { family: "Inter", style: "Regular" },
        textAutoResize: "WIDTH_AND_HEIGHT",
        fillPaints: [{ type: "SOLID", color: rgb(0, 0, 0), visible: true, opacity: 1 }],
        textData: {
          characters: "Hi you",
          characterStyleIDs: [0, 0, 0, 2, 2, 2],
          styleOverrideTable: [
            {
              styleID: 2,
              fontName: { family: "Inter", style: "Bold" },
              fillPaints: [{ type: "SOLID", color: rgb(1, 0, 0), visible: true, opacity: 1 }],
            },
          ],
        },
      },
    ]
    let n = 0
    const r = convertFigma(parseFigmaClipboard(figmaHtml(message(nodes)))?.message ?? {}, {
      newId: () => `Node${String(++n).padStart(4, "0")}`,
    })
    const t = Object.values(r.nodes)[0] as Obj
    expect(t.grow).toBe("auto")
    expect(t.content).toEqual([
      { text: "Hi " },
      { text: "you", style: { weight: 700 }, fill: "#FF0000" },
    ])
  })

  test("list paragraphs get their numbers and bullets", () => {
    const r = paste([
      {
        guid: guid(10),
        parentIndex: onPage("!"),
        type: "TEXT",
        name: "L",
        size: { x: 100, y: 60 },
        transform: identity(),
        textAutoResize: "WIDTH_AND_HEIGHT",
        textData: {
          characters: "One\nTwo\nDot\nPlain",
          lines: [
            { lineType: "ORDERED_LIST", indentationLevel: 1, isFirstLineOfList: true },
            { lineType: "ORDERED_LIST", indentationLevel: 1, isFirstLineOfList: false },
            { lineType: "UNORDERED_LIST", indentationLevel: 2, isFirstLineOfList: true },
            { lineType: "PLAIN", indentationLevel: 0, isFirstLineOfList: false },
          ],
        },
      },
    ])
    expect(r.byName("L").content).toBe("1. One\n2. Two\n    ◦ Dot\nPlain")
  })

  test("instances expand: overrides by key path, text and visibility properties, nested instances", () => {
    const r = paste([
      // Main "Button" on the internal page: a frame with a label and an icon instance.
      {
        guid: guid(100),
        parentIndex: onInternal("!"),
        type: "SYMBOL",
        name: "Button",
        size: { x: 80, y: 30 },
        transform: identity(),
        stackMode: "HORIZONTAL",
        stackSpacing: 4,
        fillPaints: [{ type: "SOLID", color: rgb(0, 0, 1), visible: true, opacity: 1 }],
      },
      {
        guid: guid(101),
        parentIndex: under(100, "!"),
        type: "TEXT",
        name: "Label",
        overrideKey: guid(501, 9),
        size: { x: 40, y: 16 },
        transform: identity(),
        textAutoResize: "WIDTH_AND_HEIGHT",
        textData: { characters: "Button" },
        componentPropRefs: [{ defID: guid(900), componentPropNodeField: "TEXT_DATA" }],
      },
      {
        guid: guid(102),
        parentIndex: under(100, '"'),
        type: "INSTANCE",
        name: "Icon",
        overrideKey: guid(502, 9),
        size: { x: 16, y: 16 },
        transform: identity(),
        symbolData: { symbolID: guid(200) },
        componentPropRefs: [{ defID: guid(901), componentPropNodeField: "VISIBLE" }],
      },
      // Main "Icon": a frame with a dot.
      {
        guid: guid(200),
        parentIndex: onInternal('"'),
        type: "SYMBOL",
        name: "Icon",
        size: { x: 16, y: 16 },
        transform: identity(),
      },
      {
        guid: guid(201),
        parentIndex: under(200, "!"),
        type: "ELLIPSE",
        name: "Dot",
        overrideKey: guid(601, 9),
        size: { x: 16, y: 16 },
        transform: identity(),
        fillPaints: [{ type: "SOLID", color: rgb(0, 0, 0), visible: true, opacity: 1 }],
      },
      // The copied instance: label text set by property, icon hidden by property is NOT set,
      // the dot recolored through a nested override path.
      {
        guid: guid(10),
        parentIndex: onPage("!"),
        type: "INSTANCE",
        name: "Save button",
        size: { x: 90, y: 30 },
        transform: identity(50, 60),
        stackMode: "HORIZONTAL",
        stackSpacing: 4,
        fillPaints: [{ type: "SOLID", color: rgb(0, 1, 0), visible: true, opacity: 1 }],
        symbolData: {
          symbolID: guid(100),
          symbolOverrides: [
            {
              guidPath: { guids: [guid(502, 9), guid(601, 9)] },
              fillPaints: [{ type: "SOLID", color: rgb(1, 0, 0), visible: true, opacity: 1 }],
            },
          ],
        },
        componentPropAssignments: [
          { defID: guid(900), value: { textValue: { characters: "Save" } } },
        ],
        derivedSymbolData: [{ guidPath: { guids: [guid(501, 9)] }, size: { x: 30, y: 16 } }],
      },
    ])
    const btn = r.byName("Save button")
    expect(btn).toMatchObject({
      type: "frame",
      parent: null,
      x: 50,
      y: 60,
      fill: "#00FF00",
      layout: { dir: "row", gap: 4 },
    })
    const label = r.byName("Label")
    expect(label).toMatchObject({ type: "text", parent: r.roots[0], content: "Save" })
    expect(r.byName("Icon")).toMatchObject({ type: "frame", parent: r.roots[0] })
    expect(r.byName("Dot").fill).toBe("#FF0000")
    expect(Object.values(r.nodes).some((n) => n.type === "instance")).toBe(false)
  })

  test("vectors decode their network, scaled from the normalized size", () => {
    // A triangle: 3 vertices, 3 straight segments, one region (nonzero) with one loop.
    const blob = new Uint8Array(12 + 3 * 12 + 3 * 28 + 4 + 4 + 4 + 12)
    const v = new DataView(blob.buffer)
    let o = 0
    const u = (n: number) => {
      v.setUint32(o, n, true)
      o += 4
    }
    const f = (n: number) => {
      v.setFloat32(o, n, true)
      o += 4
    }
    u(3)
    u(3)
    u(1)
    for (const [x, y] of [
      [0, 0],
      [10, 0],
      [5, 10],
    ]) {
      u(0)
      f(x as number)
      f(y as number)
    }
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      u(0)
      u(a as number)
      f(0)
      f(0)
      u(b as number)
      f(0)
      f(0)
    }
    u(1)
    u(1)
    u(3)
    u(0)
    u(1)
    u(2)
    expect(vectorNetworkPath(blob)?.d).toBe("M0 0 L10 0 L5 10 L0 0 Z")
    const r = paste(
      [
        {
          guid: guid(10),
          parentIndex: onPage("!"),
          type: "VECTOR",
          name: "Tri",
          size: { x: 20, y: 20 },
          transform: identity(),
          vectorData: { vectorNetworkBlob: 0, normalizedSize: { x: 10, y: 10 } },
          fillPaints: [{ type: "SOLID", color: rgb(0, 0, 0), visible: true, opacity: 1 }],
        },
      ],
      { blobs: [blob] },
    )
    expect(r.byName("Tri")).toMatchObject({
      type: "path",
      w: 20,
      h: 20,
      d: "M0 0 L20 0 L10 20 L0 0 Z",
    })
  })

  test("unsupported layers are skipped and counted", () => {
    const r = paste([
      {
        guid: guid(10),
        parentIndex: onPage("!"),
        type: "STICKY",
        name: "Note",
        size: { x: 1, y: 1 },
        transform: identity(),
      },
      {
        guid: guid(11),
        parentIndex: onPage('"'),
        type: "STICKY",
        name: "Note",
        size: { x: 1, y: 1 },
        transform: identity(),
      },
    ])
    expect(r.roots).toEqual([])
    expect(r.warnings).toEqual([
      { code: "NODE_UNSUPPORTED", message: "sticky layers were skipped", count: 2 },
    ])
  })
})
