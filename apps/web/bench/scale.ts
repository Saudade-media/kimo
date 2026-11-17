/**
 * Scale probe: a synthetic document of N nodes pushed through the app's own pipeline (DocStore
 * → instance view → Yoga layout → CanvasKit renderer, wired as `CanvasController` wires them),
 * timing every stage and reporting memory. CPU raster surface, so paint times are a pessimistic
 * proxy for WebGL; everything before the paint is the same code the browser runs.
 *
 *   scripts/safe-run.sh bun apps/web/bench/scale.ts <shape> <nodes> [--skip=validate,save]
 *
 * Shapes: see ./gen.ts. Always run through safe-run.sh.
 */
import { type KimoDocument, serialize, validate } from "@kimo/core-schema"
import { createDocStore } from "@kimo/editor-state"
import {
  createInstanceView,
  createLayoutEngine,
  createResolver,
  type LayoutInput,
} from "@kimo/layout"
import { CanvasKitRenderer } from "@kimo/renderer"
import { generate } from "./gen"

const shape = process.argv[2] ?? "screens"
const N = Number(process.argv[3] ?? 10000)
const skip = new Set((process.argv.find((a) => a.startsWith("--skip="))?.slice(7) ?? "").split(","))

type Rec = Record<string, unknown>
const doc = generate(shape, N) as unknown as KimoDocument
const nodes = doc.nodes as unknown as Record<string, Rec>
const ids = Object.keys(nodes)
const rootCount = ids.filter((id) => nodes[id]?.parent === null).length

const out: Record<string, number | string> = { shape, nodes: ids.length, roots: rootCount }
const mb = (b: number) => Math.round(b / 1048576)
const mem = (label: string) => {
  Bun.gc(true)
  const m = process.memoryUsage()
  out[`${label}.rssMB`] = mb(m.rss)
  out[`${label}.heapMB`] = mb(m.heapUsed)
}
/** The Skia wasm heap (it never shrinks: a high-water mark). */
const wasm = (label: string) => {
  const ck = (r as unknown as { ck?: { HEAPU8?: Uint8Array } }).ck
  out[`${label}.wasmMB`] = mb(ck?.HEAPU8?.byteLength ?? 0)
}
const time = <T>(label: string, fn: () => T): T => {
  const t = performance.now()
  const r = fn()
  out[`${label}.ms`] = +(performance.now() - t).toFixed(2)
  console.error(`${label}: ${out[`${label}.ms`]} ms`)
  return r
}
/** Median and max of `runs` calls. */
const sample = (label: string, runs: number, fn: (i: number) => void) => {
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const s = performance.now()
    fn(i)
    t.push(performance.now() - s)
    if (t.length >= 3 && t.reduce((a, b) => a + b, 0) > 20000) break
  }
  t.sort((a, b) => a - b)
  out[`${label}.med`] = +(t[Math.floor(t.length / 2)] as number).toFixed(3)
  out[`${label}.max`] = +(t[t.length - 1] as number).toFixed(3)
  console.error(
    `${label}: med ${out[`${label}.med`]} max ${out[`${label}.max`]} ms (${t.length} runs)`,
  )
}

mem("gen")
if (!skip.has("validate")) {
  const v = time("validate", () => validate(doc))
  if (!v.ok) {
    console.error(v.errors.slice(0, 5))
    process.exit(2)
  }
}
const store = createDocStore()
time("store.load", () => store.loadDocument(doc, { validate: false }))
mem("store")

const header = () => store.toHeader() as never
const src = createInstanceView(store, { libraries: {}, header })
const resolver = createResolver(header, src, { libraries: {} })
const r = new CanvasKitRenderer()
await r.init({ offlineFonts: true })
const engine = createLayoutEngine({})
await engine.init()
const input = (): LayoutInput => ({
  nodes: src,
  expanded: src,
  resolve: resolver,
  measureText: r.textMeasurer(),
})

r.setDocument({ nodes: src, header, resolve: resolver, assets: { load: async () => null } })
let layout = time("layout.compute", () => engine.compute(input()))
out.laidOut = layout.nodes.size
mem("layout")
wasm("layout")
time("renderer.setLayout", () => r.setLayout(layout))
r.attachRaster(1440, 900, 1)

const b = layout.bounds ?? { x: 0, y: 0, w: 1, h: 1 }
const fit = Math.min(1440 / b.w, 900 / b.h)
// Zoom 1 near the middle: what someone working on one screen sees.
const cx = b.x + b.w / 2
const cy = b.y + b.h / 2
r.setViewport({ x: cx, y: cy, zoom: 1 })
time("frame.first@1", () => r.render())
out["drawn@1"] = r.stats().nodesDrawn
wasm("first@1")
sample("frame.pan@1", 60, (i) => {
  r.setViewport({ x: cx + i * 20, y: cy + i * 8, zoom: 1 })
  r.render()
})
if (!skip.has("fit")) {
  r.setViewport({ x: b.x, y: b.y, zoom: fit })
  time("frame.first@fit", () => r.render())
  out["drawn@fit"] = r.stats().nodesDrawn
  sample("frame.pan@fit", 20, (i) => {
    r.setViewport({ x: b.x + i / fit, y: b.y, zoom: fit })
    r.render()
  })
}
mem("painted")
wasm("painted")
r.setViewport({ x: cx, y: cy, zoom: 1 })
r.render()

// Pointer move: hit test at the cursor (the first one builds the index).
time("hit.first", () => r.hitTest({ x: 700, y: 400 }))
sample("hit.point", 50, (i) => r.hitTest({ x: 100 + i * 20, y: 100 + i * 10 }))
sample("hit.rect", 20, (i) => r.hitTestRect({ x: 100, y: 100, w: 200 + i * 10, h: 200 }))

// One edit, end to end, as CanvasController.relayout does it.
const target = ids[Math.floor(ids.length / 2)] as string
const edit = (set: Rec) => {
  const res = store.apply({ op: "update", id: target, set } as never, { origin: "user" })
  if (!res.ok) throw new Error(JSON.stringify(res).slice(0, 300))
}
const relayout = () => {
  resolver.invalidate()
  layout = engine.update(input(), { nodes: [target] })
  r.invalidate([target])
  r.setLayout(layout)
  r.render()
  // The next pointer move hit tests against the new layout.
  r.hitTest({ x: 700, y: 400 })
}
const stages: Record<string, number[]> = {
  apply: [],
  update: [],
  setLayout: [],
  render: [],
  hit: [],
}
const t0 = () => performance.now()
sample("edit.paint(fill)", 10, (i) => {
  let t = t0()
  edit({ fill: i % 2 ? "#00AA55" : "#AA0055" })
  stages.apply?.push(t0() - t)
  t = t0()
  resolver.invalidate()
  layout = engine.update(input(), { nodes: [target] })
  stages.update?.push(t0() - t)
  t = t0()
  r.invalidate([target])
  r.setLayout(layout)
  stages.setLayout?.push(t0() - t)
  t = t0()
  r.render()
  stages.render?.push(t0() - t)
  t = t0()
  r.hitTest({ x: 700, y: 400 })
  stages.hit?.push(t0() - t)
})
for (const [k, v] of Object.entries(stages)) {
  // The first edit after a load pays one-off costs (undo manager, first validation).
  out[`edit.first.${k}`] = +(v[0] ?? 0).toFixed(1)
  v.sort((a, b) => a - b)
  out[`edit.${k}.med`] = +(v[Math.floor(v.length / 2)] ?? 0).toFixed(3)
}
sample("edit.move(x)", 10, (i) => {
  edit({ x: 10 + i })
  relayout()
})
sample("undo", 5, () => {
  store.undo("user")
  relayout()
})
mem("edited")
if (!skip.has("save")) {
  const d = time("save.toDocument", () => store.toDocument())
  const text = time("save.serialize", () => serialize(d))
  out.fileMB = mb(text.length)
}
console.log(JSON.stringify(out))
process.exit(0)
