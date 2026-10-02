/** Browser smoke: WebGL surface, bundled wasm/fonts via Vite, a frame with overlays. */
import { browserIconProvider, createRenderer } from "@kimo/renderer/browser"
import { paintsDoc, textDoc } from "../fixtures/docs"
import { sceneOf, simpleLayout } from "../helpers/scene"

const w = window as unknown as { __result?: unknown; __error?: string }
performance.setResourceTimingBufferSize(5000) // the icon URL table alone is ~250 entries in dev
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
  // Icons (ADR 0010): one shard per requested glyph, fetched lazily; nothing at init.
  const icons = browserIconProvider()
  // Data fetches only: in dev, Vite also serves each `?url` import as a stub module
  // (`…json?import&url`, the URL string — inlined in a build), which is not glyph data.
  const isShard = (e: PerformanceEntry) =>
    e.name.includes("/assets/icons/") && !e.name.includes("import")
  const iconRequestsAtInit = performance.getEntriesByType("resource").filter(isShard).length
  const glyphs = await Promise.all([
    icons.load("lucide", "star"),
    icons.load("phosphor", "bell", 700),
    icons.load("material-rounded", "home", 300),
    icons.load("feather", "x"),
    icons.load("lucide", "no-such-glyph-zz"),
  ])
  const iconRequests = performance
    .getEntriesByType("resource")
    .filter(isShard)
    .map((e) => e.name.replace(/^.*\/assets\/icons\//, ""))
  w.__result = {
    initMs,
    stats: r.stats(),
    errors,
    hit,
    icons: {
      requestsAtInit: iconRequestsAtInit,
      loaded: glyphs.map((g) => (g ? g.paths.length : null)),
      requests: iconRequests,
    },
  }
} catch (e) {
  w.__error = String((e as Error)?.stack ?? e)
}
