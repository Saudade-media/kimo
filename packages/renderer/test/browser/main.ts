/** Browser smoke: WebGL surface, bundled wasm/fonts via Vite, a frame with overlays. */
import { createRenderer } from "@kimo/renderer/browser"
import { paintsDoc, textDoc } from "../fixtures/docs"
import { sceneOf, simpleLayout } from "../helpers/scene"

const w = window as unknown as { __result?: unknown; __error?: string }
try {
  const canvas = document.getElementById("c") as HTMLCanvasElement
  const dpr = window.devicePixelRatio || 1
  canvas.width = 720 * dpr
  canvas.height = 480 * dpr
  const errors: string[] = []
  const r = createRenderer({ onError: (e) => errors.push(e.code) })
  const t0 = performance.now()
  await r.init()
  const initMs = performance.now() - t0
  const doc = {
    ...textDoc,
    nodes: {
      ...paintsDoc.nodes,
      ...Object.fromEntries(
        Object.entries(textDoc.nodes).map(([k, v]) => [
          k,
          k === "board0003" ? { ...v, x: 340 } : v,
        ]),
      ),
    },
  }
  const scene = sceneOf(doc as never)
  r.attach(canvas, { dpr })
  r.setDocument(scene)
  r.setLayout(simpleLayout(scene, r.textMeasurer()))
  r.setViewport({ x: -20, y: -20, zoom: 1 })
  r.setOverlay({
    selection: ["text00002"],
    hovered: "grad00003",
    marquee: null,
    sizeLabel: "Hug 150 × Hug 34",
  })
  r.render()
  const hit = r.hitTest({ x: 20 + 30, y: 20 + 30 })
  w.__result = { initMs, stats: r.stats(), errors, hit }
} catch (e) {
  w.__error = String((e as Error)?.stack ?? e)
}
