import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  createExpandedView,
  documentLookup,
  importPen,
  isPenDocument,
  type PenDocument,
  penImageUrls,
  penOrderKey,
  validate,
} from "../src/index"

/** A small `.pen` exercising the mapping table; ids are 5 characters, as pen.dev writes them. */
const pen: PenDocument = {
  version: "2.20",
  themes: { mode: ["light", "dark"] },
  variables: {
    fg: {
      type: "color",
      value: [
        { value: "#111111", theme: { mode: "light" } },
        { value: "#EEEEEE", theme: { mode: "dark" } },
      ],
    },
    "gap-md": { type: "number", value: 16 },
    "font-sans": { type: "string", value: "Inter" },
  },
  children: [
    {
      type: "frame",
      id: "Btn01",
      name: "Button",
      reusable: true,
      padding: [8, 16],
      gap: "$gap-md",
      alignItems: "center",
      cornerRadius: 999,
      fill: "#000000",
      children: [
        {
          type: "text",
          id: "Lbl01",
          name: "Label",
          content: "Click",
          fill: "#FFFFFF",
          fontFamily: "$font-sans",
          fontSize: 14,
          fontWeight: "600",
        },
        {
          type: "icon",
          id: "Ico01",
          library: "lucide",
          icon: "plus",
          width: 16,
          height: 16,
          fill: "$fg",
        },
      ],
    },
    {
      type: "frame",
      id: "Slt01",
      name: "Menu",
      reusable: true,
      layout: "vertical",
      children: [
        { type: "frame", id: "Itm01", name: "Items", layout: "vertical", slot: ["Btn01"] },
      ],
    },
    {
      type: "frame",
      id: "Scr01",
      name: "Screen",
      x: 100,
      y: 0,
      width: 400,
      height: "fit_content(300)",
      layout: "none",
      theme: { mode: "dark" },
      clip: true,
      children: [
        {
          type: "ref",
          id: "Ins01",
          ref: "Btn01",
          x: 10,
          y: 20,
          fill: "#FF0000",
          descendants: { Lbl01: { content: "Buy", fontSize: 16 }, Ico01: { enabled: false } },
        },
        {
          type: "ref",
          id: "Ins02",
          ref: "Btn01",
          descendants: {
            Lbl01: { type: "text", id: "New01", content: "Replaced", fill: "#00FF00" },
          },
        },
        {
          type: "ref",
          id: "Ins03",
          ref: "Slt01",
          descendants: {
            Itm01: { children: [{ type: "ref", id: "Ins04", ref: "Btn01" }] },
          },
        },
        {
          type: "text",
          id: "Prc01",
          content: "$49/mo",
          fill: "$fg",
          textGrowth: "fixed-width",
          width: "fill_container",
          lineHeight: 1.4,
          underline: true,
        },
        {
          type: "rectangle",
          id: "Rct01",
          width: 40,
          height: 40,
          stroke: "#000000",
          strokeWidth: { bottom: 1 },
          effect: [
            {
              type: "shadow",
              shadowType: "inner",
              offset: { x: 0, y: 2 },
              blur: 4,
              color: "#00000040",
            },
            { type: "background_blur", radius: 8 },
          ],
          fill: [
            {
              type: "gradient",
              gradientType: "radial",
              colors: [
                { color: "#FF0000", position: 0 },
                { color: "#0000FF", position: 1 },
              ],
            },
            { type: "image", url: "./photo.png", mode: "stretch" },
          ],
        },
        {
          type: "ellipse",
          id: "Orb01",
          width: 24,
          height: 24,
          fill: [
            {
              type: "mesh_gradient",
              columns: 2,
              rows: 2,
              colors: ["#000000", "#FFFFFF", "#FF0000", "#00FF00"],
              points: [
                [0, 0],
                [1, 0],
                [0, 1],
                [1, 1],
              ],
            },
            { type: "shader", url: "shaders/orb.glsl", uniforms: { u_speed: 0.5, u_tint: "$fg" } },
          ],
        },
      ],
    },
  ],
}

const nodes = (r: ReturnType<typeof importPen>) =>
  r.doc.nodes as Record<string, Record<string, unknown>>

describe(".pen import", () => {
  const r = importPen(pen, {
    name: "Sample",
    images: { "./photo.png": "./assets/0123456789abcdef.png" },
  })
  const n = nodes(r)
  const id = (p: string) => r.ids.get(p) as string

  test("produces a valid .kimo document", () => {
    const v = validate(r.doc)
    expect(v.errors).toEqual([])
    expect(r.doc.meta?.name).toBe("Sample")
    expect(r.doc.features).toEqual(["fill/mesh", "fill/shader"])
    expect(r.warnings).toEqual([])
  })

  test("detects .pen documents and lists their images", () => {
    expect(isPenDocument(pen)).toBe(true)
    expect(isPenDocument({ $schema: "x", format: "1.0.0", nodes: {} })).toBe(false)
    expect(penImageUrls(pen)).toEqual(["./photo.png"])
  })

  test("re-keys ids that do not fit Kimo's grammar, consistently", () => {
    expect(id("Btn01")).toMatch(/^[A-Za-z0-9]{6,24}$/)
    expect(n[id("Ins01")]?.of).toBe(id("Btn01"))
    expect(new Set(r.ids.values()).size).toBe(r.ids.size)
  })

  test("frames: implicit row layout, padding, bindings, sizes", () => {
    expect(n[id("Btn01")]).toMatchObject({
      component: true,
      layout: { dir: "row", pad: [8, 16], gap: { $ref: "gap-md" }, align: "center" },
      radius: 999,
    })
    expect(n[id("Scr01")]).toMatchObject({ w: 400, h: { mode: "fit", fallback: 300 }, clip: true })
    expect(n[id("Scr01")]?.layout).toBeUndefined()
    expect(n[id("Scr01")]?.theme).toEqual({ mode: "dark" })
  })

  test("text: style struct, literal `$` text, growth", () => {
    expect(n[id("Lbl01")]).toMatchObject({
      content: "Click",
      style: { font: { $ref: "font-sans" }, size: 14, weight: 600 },
    })
    expect(n[id("Prc01")]).toMatchObject({
      content: "$49/mo",
      fill: { $ref: "fg" },
      grow: "fixed-width",
      w: { mode: "fill" },
      style: { lineHeight: 1.4, decoration: ["underline"] },
    })
  })

  test("instances: root props and set overrides", () => {
    const ins = n[id("Ins01")] as Record<string, unknown>
    expect(ins).toMatchObject({ type: "instance", x: 10, y: 20, props: { fill: "#FF0000" } })
    const ov = ins.overrides as Record<string, { set: Record<string, unknown> }>
    // A set replaces `style` wholesale, so the merged style is written.
    expect(ov[id("Lbl01")]?.set).toEqual({
      content: "Buy",
      style: { font: { $ref: "font-sans" }, size: 16, weight: 600 },
    })
    expect(ov[id("Ico01")]?.set).toEqual({ visible: false })
  })

  test("instances: replacements and slots become instance-owned nodes", () => {
    expect(n[id("Ins02")]?.overrides).toEqual({ [id("Lbl01")]: { replace: true } })
    expect(n[id("New01")]).toMatchObject({
      parent: id("Ins02"),
      at: id("Lbl01"),
      content: "Replaced",
    })
    expect(n[id("Ins03")]?.overrides).toEqual({ [id("Itm01")]: { slot: true } })
    expect(n[id("Ins04")]).toMatchObject({ parent: id("Ins03"), at: id("Itm01"), of: id("Btn01") })
    expect(n[id("Itm01")]?.slot).toEqual({ suggested: [id("Btn01")] })
  })

  test("paints, strokes and effects", () => {
    expect(n[id("Rct01")]).toMatchObject({
      stroke: { paint: "#000000", width: { b: 1 } },
      effects: [
        { kind: "shadow", inner: true, x: 0, y: 2, blur: 4, color: "#00000040" },
        { kind: "backdrop-blur", radius: 8 },
      ],
      fill: [
        {
          kind: "radial",
          stops: [
            { color: "#FF0000", at: 0 },
            { color: "#0000FF", at: 1 },
          ],
        },
        { kind: "image", src: "./assets/0123456789abcdef.png", fit: "stretch" },
      ],
    })
    expect(n[id("Orb01")]?.fill).toEqual([
      {
        kind: "mesh",
        cols: 2,
        rows: 2,
        colors: ["#000000", "#FFFFFF", "#FF0000", "#00FF00"],
        points: [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ],
      },
      {
        kind: "shader",
        src: "./shaders/orb.glsl",
        uniforms: { u_speed: 0.5, u_tint: { $ref: "fg" } },
      },
    ])
  })

  test("variables keep their themed entries", () => {
    expect(r.doc.themes).toEqual({ mode: ["light", "dark"] })
    expect(r.doc.variables?.fg).toEqual({
      type: "color",
      value: [
        { value: "#111111", when: { mode: "light" } },
        { value: "#EEEEEE", when: { mode: "dark" } },
      ],
    })
  })

  test("an image that was not stored becomes a missing asset, with a warning", () => {
    const missing = importPen(pen)
    expect(missing.warnings.map((w) => w.code)).toEqual(["IMAGE_MISSING"])
    expect(validate(missing.doc).errors).toEqual([])
  })

  test("a renamed variable never takes another variable's name", () => {
    const r = importPen({
      version: "2.20",
      variables: {
        "a-b": { type: "number", value: 1 },
        "a b": { type: "number", value: 2 },
        $x: { type: "number", value: 3 },
        x: { type: "number", value: 4 },
      },
      children: [
        { type: "frame", id: "Frm01", width: 10, height: 10, gap: "$a b", opacity: "$$x" },
      ],
    } as unknown as PenDocument)
    const vars = r.doc.variables as Record<string, { value: unknown }>
    expect(vars["a-b"]?.value).toBe(1)
    expect(vars["a-b-2"]?.value).toBe(2)
    expect(vars.x?.value).toBe(4)
    expect(vars["x-2"]?.value).toBe(3)
    expect(validate(r.doc).errors).toEqual([])
  })

  test("a ref with its own children keeps them, and instances of it reach into them", () => {
    // pen.dev: a ref's `children` replace its component's, and live in the ref's own scope, so
    // an instance of a reusable ref addresses them with plain ids (no instance boundary).
    const r = importPen({
      version: "2.19",
      children: [
        { type: "frame", id: "Pnl01", reusable: true, layout: "vertical", fill: "#111111" },
        {
          type: "frame",
          id: "Btn01",
          reusable: true,
          children: [{ type: "text", id: "Lbl01", content: "Click", fill: "#FFFFFF" }],
        },
        {
          type: "ref",
          id: "Ins01",
          ref: "Pnl01",
          reusable: true,
          width: 300,
          children: [
            {
              type: "ref",
              id: "Crd01",
              ref: "Pnl01",
              children: [{ type: "text", id: "Txt01", content: "Inside", fill: "#FFFFFF" }],
            },
            {
              type: "ref",
              id: "Chk01",
              ref: "Btn01",
              children: [{ type: "text", id: "Lbl02", content: "Checking", fill: "#999999" }],
            },
          ],
        },
        { type: "ref", id: "Use01", ref: "Ins01", descendants: { Txt01: { content: "Changed" } } },
      ],
    } as PenDocument)
    const n = nodes(r)
    const id = (p: string) => r.ids.get(p) as string
    expect(validate(r.doc).errors).toEqual([])
    expect(n[id("Ins01")]).toMatchObject({
      type: "frame",
      component: true,
      w: 300,
      fill: "#111111",
    })
    expect(n[id("Crd01")]).toMatchObject({ type: "frame", parent: id("Ins01") })
    expect(n[id("Txt01")]).toMatchObject({ parent: id("Crd01"), content: "Inside" })
    // The component's own label is replaced, not kept next to the ref's.
    expect(n[id("Lbl02")]).toMatchObject({ parent: id("Chk01"), content: "Checking" })
    const view = createExpandedView(documentLookup(r.doc))
    const kids = (v: string): string[] => [...view.children(v)].flatMap((c) => [c, ...kids(c)])
    const texts = kids(id("Use01")).map((c) => view.getNode(c)?.content)
    expect(texts.filter(Boolean)).toEqual(["Changed", "Checking"])
    expect(view.issues()).toEqual([])
  })

  test("children given to a nested instance, and paths into a nested ref's replacement", () => {
    const r = importPen({
      version: "2.19",
      children: [
        {
          type: "frame",
          id: "Btn01",
          reusable: true,
          children: [{ type: "text", id: "Lbl01", content: "Click", fill: "#FFFFFF" }],
        },
        {
          type: "frame",
          id: "Row01",
          reusable: true,
          children: [
            { type: "ref", id: "Nst01", ref: "Btn01" },
            { type: "text", id: "Val01", content: "Value", fill: "#FFFFFF" },
          ],
        },
        {
          type: "frame",
          id: "Crd01",
          reusable: true,
          children: [
            {
              type: "ref",
              id: "Row02",
              ref: "Row01",
              descendants: {
                Val01: {
                  type: "frame",
                  id: "Rep01",
                  children: [{ type: "text", id: "Txt02", content: "A", fill: "#FFFFFF" }],
                },
              },
            },
          ],
        },
        // pen.dev crosses the ref that authored the replacement; Kimo's key does not.
        {
          type: "ref",
          id: "Use02",
          ref: "Crd01",
          descendants: { "Row02/Txt02": { content: "B" } },
        },
        {
          type: "ref",
          id: "Use03",
          ref: "Row01",
          descendants: {
            Nst01: { children: [{ type: "text", id: "Txt03", content: "Own", fill: "#FFFFFF" }] },
          },
        },
      ],
    } as PenDocument)
    const id = (p: string) => r.ids.get(p) as string
    expect(validate(r.doc).errors).toEqual([])
    expect(nodes(r)[id("Use02")]?.overrides).toEqual({
      [id("Txt02")]: { set: { content: "B" } },
    })
    const view = createExpandedView(documentLookup(r.doc))
    const texts = (v: string): unknown[] =>
      [...view.children(v)].flatMap((c) => [view.getNode(c)?.content, ...texts(c)])
    expect(texts(id("Use02")).filter(Boolean)).toEqual(["Click", "B"])
    expect(texts(id("Use03")).filter(Boolean)).toEqual(["Own", "Value"])
    expect(view.issues()).toEqual([])
  })

  test("order keys are increasing fractional-index heads", () => {
    const keys = Array.from({ length: 300 }, (_, i) => penOrderKey(i))
    expect(keys.slice(0, 3)).toEqual(["a0", "a1", "a2"])
    expect(keys[62]).toBe("b00")
    for (let i = 1; i < keys.length; i++)
      expect((keys[i - 1] as string) < (keys[i] as string)).toBe(true)
  })
})

describe(".pen import of the project's own design file", () => {
  const file = join(import.meta.dir, "../../../desing.pen")
  test.skipIf(!existsSync(file))("desing.pen converts to a valid document", () => {
    const r = importPen(JSON.parse(readFileSync(file, "utf8")) as PenDocument)
    expect(validate(r.doc).errors).toEqual([])
    expect(r.warnings.filter((w) => w.code !== "IMAGE_MISSING")).toEqual([])
  })
})
