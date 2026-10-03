/**
 * Headless perf probe, M3 1k-instance stress variant of the perf gate: 1,000 root instances of
 * a 6-node card (6k view nodes) laid out by Yoga through the shared expanded view, rendered on
 * a CPU raster surface (1440×900). Prints compute / frame / edit timings.
 * Run: `bun run bench:instances` (in packages/renderer).
 */
import {
  createInstanceView,
  createLayoutEngine,
  createResolver,
  type NodeSource,
  nodeSourceFromDocument,
} from "@kimo/layout"
import { CanvasKitRenderer } from "../../src"
import { instancesDoc } from "../fixtures/m3"

const COUNT = Number(process.env.KIMO_INSTANCES ?? 1000)
const doc = instancesDoc(COUNT)
let table = { ...doc.nodes }
let src: NodeSource = nodeSourceFromDocument({ nodes: table } as never)
const store: NodeSource = {
  getNode: (id) => src.getNode(id),
  children: (p, at) => src.children(p, at),
}
const header = { variables: doc.variables, themes: doc.themes } as never
const view = createInstanceView(store, { header: () => header })
const resolve = createResolver(header, view)
const r = new CanvasKitRenderer()
await r.init({ offlineFonts: true })
r.setDocument({ nodes: view, header, resolve, assets: { load: async () => null } })
const engine = createLayoutEngine()
await engine.init()
const input = () => ({ nodes: store, expanded: view, resolve, measureText: r.textMeasurer() })
const time = <T>(f: () => T): [T, number] => {
  const t = performance.now()
  const v = f()
  return [v, performance.now() - t]
}
const [layout, computeMs] = time(() => engine.compute(input()))
console.log(
  `instances: ${COUNT}, view nodes: ${layout.nodes.size}, compute ${computeMs.toFixed(1)} ms`,
)
r.setLayout(layout)
r.attachRaster(1440, 900, 1)
for (const zoom of [1, 0.25]) {
  r.setViewport({ x: -20, y: -20, zoom })
  const [, first] = time(() => r.render())
  const frames: number[] = []
  for (let i = 0; i < 30; i++) frames.push(time(() => r.render())[1])
  frames.sort((a, b) => a - b)
  console.log(
    `zoom ${zoom}: first ${first.toFixed(1)} ms, replay p50 ${frames[15]?.toFixed(1)} p95 ${frames[28]?.toFixed(1)} ms`,
  )
}
for (const [name, id, patch] of [
  ["move instance", "i0010", { x: 77 }],
  ["override", "i0011", { overrides: { bar: { set: { w: 20 } } } }],
  ["main edit", "bar", { w: 90 }],
] as const) {
  table = { ...table, [id]: { ...table[id], ...patch } }
  src = nodeSourceFromDocument({ nodes: table } as never)
  resolve.invalidate()
  const [l, ms] = time(() => engine.update(input(), { nodes: [id] }))
  r.invalidate([id])
  r.setLayout(l)
  const [, frame] = time(() => r.render())
  console.log(
    `${name}: layout ${ms.toFixed(2)} ms, frame ${frame.toFixed(1)} ms, recorded ${r.stats().recorded}`,
  )
}
engine.dispose()
r.dispose()
