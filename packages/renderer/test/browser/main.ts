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
  // Spec §7.1 mesh and shader paints: a mesh orb and an animated (@time) shader orb.
  const orbs = {
    orbs000001: { type: "frame", parent: null, order: "z", x: 620, y: 300, w: 80, h: 150 },
    mesh000001: {
      type: "ellipse",
      parent: "orbs000001",
      order: "a",
      x: 12,
      y: 0,
      w: 56,
      h: 56,
      fill: {
        kind: "mesh",
        cols: 2,
        rows: 2,
        colors: ["#BDF4F6", "#3B67C8", "#05566A", "#081A36"],
        points: [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ],
      },
    },
    shad000001: {
      type: "ellipse",
      parent: "orbs000001",
      order: "b",
      x: 12,
      y: 80,
      w: 56,
      h: 56,
      fill: { kind: "shader", src: "./shaders/agent-liquid.glsl", uniforms: { u_speed: 1.5 } },
    },
  }
  const doc = {
    ...textDoc,
    nodes: {
      ...paintsDoc.nodes,
      ...orbs,
      ...Object.fromEntries(
        Object.entries(textDoc.nodes).map(([k, v]) => [
          k,
          k === "board0003" ? { ...v, x: 340 } : v,
        ]),
      ),
    },
  }
  const shaders = import.meta.glob<string>("../../../../shaders/agent-liquid.glsl", {
    query: "?raw",
    import: "default",
    eager: true,
  })
  const liquid = Object.values(shaders)[0] ?? ""
  const scene = sceneOf(doc as never, {
    "./shaders/agent-liquid.glsl": new TextEncoder().encode(liquid),
  })
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
  // The shader source loads on first draw; then @time keeps frames coming (~30 fps) unasked.
  await new Promise((res) => setTimeout(res, 300))
  const framesBefore = r.stats().frames
  await new Promise((res) => setTimeout(res, 1000))
  const shaderFrames = r.stats().frames - framesBefore
  const iconRequests = performance
    .getEntriesByType("resource")
    .filter(isShard)
    .map((e) => e.name.replace(/^.*\/assets\/icons\//, ""))
  w.__result = {
    initMs,
    stats: r.stats(),
    shaderFrames,
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
