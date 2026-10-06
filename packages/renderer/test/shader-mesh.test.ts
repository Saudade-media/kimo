import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CanvasKitRenderer } from "../src"
import { loadCanvasKit } from "../src/ck"
import { pixelAt } from "./helpers/golden"
import { sceneOf, simpleLayout, type TestDoc } from "./helpers/scene"

const enc = (s: string) => new TextEncoder().encode(s)
const LIQUID = new Uint8Array(
  readFileSync(join(import.meta.dir, "..", "..", "..", "shaders", "agent-liquid.glsl")),
)
const ORB_MESH = {
  kind: "mesh",
  cols: 3,
  rows: 3,
  colors: [
    "#BDF4F6",
    "#2FC3D0",
    "#3B67C8",
    "#14A9B8",
    "#52D9E2",
    "#2A4FA6",
    "#05566A",
    "#0C2C5A",
    "#081A36",
  ],
  points: [
    [0, 0],
    [0.5, 0],
    [1, 0],
    [0, 0.5],
    [0.4, 0.42],
    [1, 0.5],
    [0, 1],
    [0.5, 1],
    [1, 1],
  ],
}
/** Red = height above the bottom (gl_FragCoord has a bottom-left origin, in design px). */
const GRADIENT_Y = `/** @resolution */ uniform vec2 res;
void main() { gl_FragColor = vec4(gl_FragCoord.y / res.y, 0.0, 0.0, 1.0); }`
/** Red = fract(time). */
const CLOCK = `/** @time */ uniform float t;
void main() { gl_FragColor = vec4(fract(t), 0.0, 0.0, 1.0); }`

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

async function setup(doc: TestDoc, assets: Record<string, Uint8Array>, w: number, h: number) {
  const ck = await loadCanvasKit()
  const r = new CanvasKitRenderer()
  await r.init({ offlineFonts: true })
  r.shaderAnimation = false
  const scene = sceneOf(doc, assets)
  r.setDocument(scene)
  r.setLayout(simpleLayout(scene, r.textMeasurer()))
  r.attachRaster(w, h)
  // Like image assets, shader sources start loading when first drawn.
  r.snapshot()
  return { ck, r }
}

describe("mesh paints", () => {
  test("fill the shape, clipped to it, transparent outside", async () => {
    const { ck, r } = await setup(
      {
        nodes: {
          orb0000001: {
            type: "ellipse",
            parent: null,
            order: "a",
            x: 0,
            y: 0,
            w: 60,
            h: 60,
            fill: ORB_MESH,
          },
        },
      },
      {},
      60,
      60,
    )
    const png = r.snapshot()
    const center = pixelAt(ck, png, 30, 30)
    expect(center[3]).toBe(255)
    // Interior vertex #52D9E2 near (24, 25); bottom-right is the deep #081A36.
    const light = pixelAt(ck, png, 24, 25)
    expect(light[1]).toBeGreaterThan(190)
    const dark = pixelAt(ck, png, 48, 48)
    expect(dark[1]).toBeLessThan(90)
    expect(pixelAt(ck, png, 1, 1)[3]).toBe(0) // outside the ellipse
    r.dispose()
  })

  test("malformed meshes draw nothing", async () => {
    const { ck, r } = await setup(
      {
        nodes: {
          bad0000001: {
            type: "rect",
            parent: null,
            order: "a",
            w: 20,
            h: 20,
            fill: { kind: "mesh", cols: 3, rows: 3, colors: ["#f00"], points: [] },
          },
        },
      },
      {},
      20,
      20,
    )
    expect(pixelAt(ck, r.snapshot(), 10, 10)[3]).toBe(0)
    r.dispose()
  })
})

describe("shader paints", () => {
  test("agent-liquid fills a circle once its source loads; transparent outside", async () => {
    const { ck, r } = await setup(
      {
        nodes: {
          mark000001: {
            type: "frame",
            parent: null,
            order: "a",
            w: 56,
            h: 56,
            fill: { kind: "shader", src: "./shaders/agent-liquid.glsl", uniforms: { u_gloss: 0 } },
          },
        },
      },
      { "./shaders/agent-liquid.glsl": LIQUID },
      56,
      56,
    )
    await tick()
    const png = r.snapshot()
    expect(pixelAt(ck, png, 28, 28)[3]).toBe(255)
    // The shader's own circular mask: the frame's corners stay transparent.
    expect(pixelAt(ck, png, 1, 1)[3]).toBe(0)
    r.dispose()
  })

  test("gl_FragCoord is bottom-up; the paint is clipped to the node shape", async () => {
    const { ck, r } = await setup(
      {
        nodes: {
          ell0000001: {
            type: "ellipse",
            parent: null,
            order: "a",
            w: 40,
            h: 40,
            fill: { kind: "shader", src: "./g.glsl" },
          },
        },
      },
      { "./g.glsl": enc(GRADIENT_Y) },
      40,
      40,
    )
    await tick()
    const png = r.snapshot()
    const top = pixelAt(ck, png, 20, 3)
    const bottom = pixelAt(ck, png, 20, 36)
    expect(top[3]).toBe(255)
    expect(top[0]).toBeGreaterThan(200)
    expect(bottom[0]).toBeLessThan(40)
    expect(pixelAt(ck, png, 1, 1)[3]).toBe(0)
    r.dispose()
  })

  test("uniform overrides and bindings", async () => {
    const SRC = `/** @color @default #000000 */ uniform vec3 c;
void main() { gl_FragColor = vec4(c, 1.0); }`
    const { ck, r } = await setup(
      {
        variables: { accent: { type: "color", value: "#00FF00" } },
        nodes: {
          a000000001: {
            type: "rect",
            parent: null,
            order: "a",
            w: 10,
            h: 10,
            fill: { kind: "shader", src: "./c.glsl" },
          },
          b000000001: {
            type: "rect",
            parent: null,
            order: "b",
            x: 10,
            w: 10,
            h: 10,
            fill: { kind: "shader", src: "./c.glsl", uniforms: { c: "#FF0000" } },
          },
          c000000001: {
            type: "rect",
            parent: null,
            order: "c",
            x: 20,
            w: 10,
            h: 10,
            fill: { kind: "shader", src: "./c.glsl", uniforms: { c: { $ref: "accent" } } },
          },
        },
      } as TestDoc,
      { "./c.glsl": enc(SRC) },
      30,
      10,
    )
    await tick()
    const png = r.snapshot()
    expect(pixelAt(ck, png, 5, 5)).toEqual([0, 0, 0, 255])
    expect(pixelAt(ck, png, 15, 5)).toEqual([255, 0, 0, 255])
    expect(pixelAt(ck, png, 25, 5)).toEqual([0, 255, 0, 255])
    r.dispose()
  })

  test("a shader that does not compile draws nothing and warns once", async () => {
    const warn = console.warn
    const seen: string[] = []
    console.warn = (m: string) => seen.push(m)
    try {
      const { ck, r } = await setup(
        {
          nodes: {
            a000000001: {
              type: "rect",
              parent: null,
              order: "a",
              w: 10,
              h: 10,
              fill: [{ kind: "shader", src: "./bad.glsl" }, "#0000ff80"],
            },
            b000000001: {
              type: "rect",
              parent: null,
              order: "b",
              x: 10,
              w: 10,
              h: 10,
              fill: { kind: "shader", src: "./bad.glsl" },
            },
          },
        },
        { "./bad.glsl": enc("uniform sampler2D t; void main() { gl_FragColor = vec4(1.0); }") },
        20,
        10,
      )
      await tick()
      const png = r.snapshot()
      r.snapshot()
      // The other paint of the list still draws.
      expect(pixelAt(ck, png, 5, 5)[2]).toBeGreaterThan(100)
      expect(pixelAt(ck, png, 15, 5)[3]).toBe(0)
      expect(seen.length).toBe(1)
      expect(seen[0]).toContain("./bad.glsl")
      r.dispose()
    } finally {
      console.warn = warn
    }
  })

  test("@time animates on screen only while enabled; exports render t = 0", async () => {
    const doc: TestDoc = {
      nodes: {
        clk0000001: {
          type: "rect",
          parent: null,
          order: "a",
          w: 10,
          h: 10,
          fill: { kind: "shader", src: "./t.glsl" },
        },
      },
    }
    const { ck, r } = await setup(doc, { "./t.glsl": enc(CLOCK) }, 10, 10)
    await tick()
    expect(pixelAt(ck, r.snapshot(), 5, 5)[0]).toBe(0)
    r.shaderAnimation = true
    r.snapshot() // starts the clock
    await tick(300)
    const red = pixelAt(ck, r.snapshot(), 5, 5)[0]
    expect(red).toBeGreaterThan(40)
    const exported = await r.exportRaster("clk0000001")
    expect(pixelAt(ck, exported, 5, 5)[0]).toBe(0)
    r.shaderAnimation = false
    expect(pixelAt(ck, r.snapshot(), 5, 5)[0]).toBe(0)
    r.dispose()
  })

  test("exportRaster waits for the shader source", async () => {
    const ck = await loadCanvasKit()
    const r = new CanvasKitRenderer()
    await r.init({ offlineFonts: true })
    const scene = sceneOf(
      {
        nodes: {
          s000000001: {
            type: "rect",
            parent: null,
            order: "a",
            w: 10,
            h: 10,
            fill: { kind: "shader", src: "./c.glsl" },
          },
        },
      },
      { "./c.glsl": enc("void main() { gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0); }") },
    )
    r.setDocument(scene)
    r.setLayout(simpleLayout(scene, r.textMeasurer()))
    expect(pixelAt(ck, await r.exportRaster("s000000001"), 5, 5)).toEqual([0, 0, 255, 255])
    r.dispose()
  })
})
