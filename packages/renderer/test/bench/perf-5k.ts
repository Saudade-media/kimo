/**
 * Headless perf probe for the M1 gate (5k nodes at 60 fps): a synthetic 5,000-node document
 * (50 frames × 99 children: rects, rounded rects, ellipses, text), rendered on a CPU raster
 * surface (1440×900). CPU raster is a pessimistic proxy for the WebGL path.
 * Run: `bun run bench` (in packages/renderer).
 */
import { CanvasKitRenderer } from "../../src"
import { sceneOf, simpleLayout, type TestDoc } from "../helpers/scene"

const nodes: Record<string, Record<string, unknown>> = {}
const FRAMES = 50
const PER = 99
for (let f = 0; f < FRAMES; f++) {
  const fid = `frame${String(f).padStart(5, "0")}`
  nodes[fid] = {
    type: "frame",
    parent: null,
    order: `a${String(f).padStart(3, "0")}`,
    x: (f % 10) * 520,
    y: Math.floor(f / 10) * 520,
    w: 500,
    h: 500,
    fill: "#F4F2EE",
    clip: true,
    radius: 8,
  }
  for (let i = 0; i < PER; i++) {
    const id = `n${String(f).padStart(3, "0")}x${String(i).padStart(4, "0")}`
    const x = (i % 10) * 50 + 4
    const y = Math.floor(i / 10) * 50 + 4
    const k = i % 5
    nodes[id] =
      k === 4
        ? {
            type: "text",
            parent: fid,
            order: `b${String(i).padStart(4, "0")}`,
            x,
            y,
            content: `Item ${i}`,
            style: { size: 11 },
          }
        : k === 3
          ? {
              type: "ellipse",
              parent: fid,
              order: `b${String(i).padStart(4, "0")}`,
              x,
              y,
              w: 40,
              h: 40,
              fill: "#2F6BFF",
            }
          : {
              type: "rect",
              parent: fid,
              order: `b${String(i).padStart(4, "0")}`,
              x,
              y,
              w: 42,
              h: 42,
              radius: k * 4,
              fill: k === 1 ? "#E0457B" : "#1A1A1A",
              ...(k === 2 ? { stroke: { paint: "#000", width: 1 } } : {}),
            }
  }
}
const doc: TestDoc = { nodes }
console.log("nodes:", Object.keys(nodes).length)

const r = new CanvasKitRenderer()
await r.init({ offlineFonts: true })
const scene = sceneOf(doc)
r.setDocument(scene)
let t = performance.now()
const layout = simpleLayout(scene, r.textMeasurer())
console.log(`layout (test helper, incl. text measure): ${(performance.now() - t).toFixed(1)} ms`)
r.setLayout(layout)
r.attachRaster(1440, 900, 1)

function run(label: string, frames: number, step: (i: number) => void) {
  const times: number[] = []
  for (let i = 0; i < frames; i++) {
    step(i)
    r.render()
    times.push(r.stats().frameMs)
  }
  times.sort((a, b) => a - b)
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const s = r.stats()
  console.log(
    `${label.padEnd(34)} avg ${avg.toFixed(2)} ms  p95 ${times[Math.floor(times.length * 0.95)]?.toFixed(2)} ms  max ${times[times.length - 1]?.toFixed(2)} ms  drawn ${s.nodesDrawn} culled ${s.nodesCulled} draws ${s.drawCalls}`,
  )
}

// First frame records every visible root picture.
r.setViewport({ x: 0, y: 0, zoom: 0.25 })
t = performance.now()
r.render()
console.log(
  `first frame (records ${r.stats().nodesDrawn} nodes): ${(performance.now() - t).toFixed(1)} ms`,
)
run("pan, zoom 0.25 (all 5k visible)", 120, (i) => r.setViewport({ x: -i * 2, y: -i, zoom: 0.25 }))
run("pan, zoom 1 (~10% visible)", 120, (i) => r.setViewport({ x: i * 20, y: i * 8, zoom: 1 }))
run("zoom sweep 0.1 → 2", 120, (i) => r.setViewport({ x: 0, y: 0, zoom: 0.1 + (i / 120) * 1.9 }))
run("selection overlay + pan, zoom 0.5", 120, (i) => {
  r.setOverlay({
    selection: ["frame00012"],
    hovered: "n001x0003",
    marquee: null,
    sizeLabel: "500 × 500",
  })
  r.setViewport({ x: i * 4, y: 0, zoom: 0.5 })
})
// Edit one node per frame: one root re-records.
run("edit 1 node/frame (re-record 1 root)", 60, (i) =>
  r.invalidate([`n000x${String(i % 99).padStart(4, "0")}`]),
)
r.invalidate()
t = performance.now()
r.setViewport({ x: 0, y: 0, zoom: 0.25 })
r.render()
console.log(`full re-record after invalidate(): ${(performance.now() - t).toFixed(1)} ms`)
r.dispose()
