/**
 * M1 performance gate (teardown 12: "5k-node doc at 60 fps on a mid laptop").
 *
 * Starts the Vite dev server, opens the editor in Chromium (playwright package), replaces the
 * new file's content with a generated 5,000-node document (./gen.ts: frames / rects / ellipses /
 * text in nested auto-layouts) and measures:
 *
 *  - import: one `store.apply` of 5k inserts → first rendered frame
 *  - cold open: page reload (document from IndexedDB) → canvas ready / first frame
 *  - pan and zoom over 3 s each: requestAnimationFrame deltas + renderer `RenderStats`
 *    (CPU ms per `render()`), at zoom-to-fit (every node visible) and at 100 %
 *  - hover and selection latency: input event timestamp → first rendered frame showing it
 *  - single-property edit → frame: paint-only (fill), layout (height in an auto-layout card),
 *    text content (re-measure)
 *  - M3: a 30-node main (bound to themed variables) + 1,000 instances (500 in one frame):
 *    insert → first frame, then override one instance / move one instance / edit the main
 *    (every instance follows) / toggle a theme pin on the 500-instance parent / switch the
 *    default variable mode / edit a variable → frame; pan and zoom with the instances
 *
 * Usage (from apps/web):
 *   bun e2e/perf/run.ts                  # SwiftShader WebGL (like the e2e suite; pessimistic)
 *   KIMO_PERF_GL=gpu bun e2e/perf/run.ts # hardware GL (headless Chromium on the host GPU)
 *   KIMO_PERF_NODES=10000 …              # document size (default 5000)
 *   KIMO_PERF_DPR=2 …                    # device pixel ratio (default 1; 2 = retina laptop)
 *   KIMO_PERF_PROFILE=1 …                # CPU profile per phase (top self-time functions)
 *   KIMO_PERF_JSON=out.json …            # also write the raw results
 *   KIMO_PERF_HEADED=1 …                 # headed browser
 *   KIMO_PERF_NO_RASTER=1 …              # A/B: renderer raster cache off
 *   KIMO_PERF_NO_MOTION=1 …              # A/B: motion raster cache off (filtered roots replay)
 *   KIMO_PERF_SHOTS=dir …                # zoom-to-fit screenshots (raster cache vs pictures)
 *   KIMO_PERF_PROD=1 …                   # production build (vite build + preview, the test
 *                                        # hook opted in with ?kimo-debug): no React dev cost
 *   KIMO_PERF_M2=1 …                     # M2 stress document (./gen.ts `m2`): dashed strokes,
 *                                        # shadows with spread, blurs, background blur, blend
 *                                        # modes, icon and path nodes
 *   KIMO_PERF_M2_SKIP=backdrop,blur,…    # M2 doc minus features (cost attribution; ./gen.ts)
 *   KIMO_PERF_PHASES=sweeps              # only import + pan/zoom sweeps (skip the rest)
 *   KIMO_PERF_PHASES=m3                  # only import + the M3 phase
 *   KIMO_PERF_VERBOSE=1 …                # slowest sweep frames: record / raster ms + counts
 *   KIMO_PERF_INSTANCES=1000 …           # M3 phase size (instances of one 30-node main; 0 = off)
 *   KIMO_PERF_NO_LABELS=1 …              # A/B: DOM canvas labels hidden (cost attribution)
 *
 * Package script: `bun run e2e:perf` (apps/web).
 *
 * Exit code is non-zero when the gate fails (p95 pan/zoom/drag rAF delta > 16.7 ms × 1.25, a
 * latency p95 > 100 ms, or an M3 main-component edit p95 > 150 ms); `KIMO_PERF_NO_GATE=1` only
 * reports.
 */
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type Browser, type CDPSession, chromium, type Page } from "playwright"
import { build, createServer, preview } from "vite"
import { generateM3Ops, generatePerfDoc, type PerfDoc } from "./gen"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..", "..")

const NODES = Number(process.env.KIMO_PERF_NODES ?? 5000)
const GL = process.env.KIMO_PERF_GL ?? "swiftshader"
const PROFILE = process.env.KIMO_PERF_PROFILE === "1"
const DPR = Number(process.env.KIMO_PERF_DPR ?? 1)
const SWEEP_MS = Number(process.env.KIMO_PERF_SWEEP_MS ?? 3000)
const PROD = process.env.KIMO_PERF_PROD === "1"
const M2 = process.env.KIMO_PERF_M2 === "1"
const SWEEPS_ONLY = process.env.KIMO_PERF_PHASES === "sweeps"
/** `KIMO_PERF_PHASES=m3`: import, then only the M3 phase (instances, themes, sweeps). */
const M3_ONLY = process.env.KIMO_PERF_PHASES === "m3"
/** Frame budget gate: p95 rAF delta ≤ 16.7 ms × 1.25 (= 20.9 ms). */
const FRAME_GATE = 16.7 * 1.25
/** Edit → frame gate; a main-component edit with every instance following gets 150 ms. */
const EDIT_GATE = 100
const MAIN_EDIT_GATE = 150
const LATENCY_SAMPLES = 20

// --- in-page probe ------------------------------------------------------------------------------

/** Installed in the page: wraps `renderer.render` to time-stamp every frame. */
interface Probe {
  frames: {
    end: number
    ms: number
    drawn: number
    culled: number
    draws: number
    /** Renderer diagnostics: CPU ms recording / rasterizing in this frame, and counts. */
    recMs: number
    rasMs: number
    rec: number
    ras: number
  }[]
  install(): void
}

type Win = Window & {
  __kimo: {
    session: {
      store: {
        apply(ops: unknown[], o: unknown): { ok: boolean; errors: { message: string }[] }
        children(p: string | null): string[]
        clearHistory(o?: string): void
        getNode(id: string): Record<string, unknown> | undefined
      }
      ui: {
        getState(): {
          viewport: { x: number; y: number; zoom: number }
          setViewport(v: object): void
          selection: string[]
          hovered: string | null
          select(ids: string[]): void
          setHovered(id: string | null): void
          clearSelection?(): void
        }
        subscribe(fn: (s: { hovered: string | null; selection: string[] }) => void): () => void
      }
    }
    canvas(): {
      renderer: {
        render(): void
        stats(): {
          frameMs: number
          nodesDrawn: number
          nodesCulled: number
          drawCalls: number
          backend: string
        }
      } | null
      layout(): { nodes: Map<string, { world: { x: number; y: number; w: number; h: number } }> }
      zoomToFit(ids?: string[]): void
    } | null
  }
  __probe: Probe
}

function installProbe() {
  const w = window as unknown as Win
  const probe: Probe = {
    frames: [],
    install() {
      type R = {
        render(): void
        stats(): {
          frameMs: number
          nodesDrawn: number
          nodesCulled: number
          drawCalls: number
          recordMs?: number
          rasterMs?: number
          recorded?: number
          rasterized?: number
        }
        __probed?: boolean
      }
      const r = w.__kimo?.canvas()?.renderer as unknown as R | null | undefined
      if (!r || r.__probed) return
      r.__probed = true
      // A/B: KIMO_PERF_NO_RASTER=1 measures with the zoomed-out raster cache off.
      if ((w as unknown as { __perfNoRaster?: boolean }).__perfNoRaster)
        (r as unknown as { rasterCache: boolean }).rasterCache = false
      if ((w as unknown as { __perfNoMotion?: boolean }).__perfNoMotion)
        (r as unknown as { motionRasterCache: boolean }).motionRasterCache = false
      // Diagnostics: which roots get (re-)recorded (KIMO_PERF_VERBOSE).
      const rr = r as unknown as {
        picture(ctx: unknown, root: string, e: { picture: unknown }): unknown
      }
      const pic = rr.picture.bind(rr)
      const w2 = w as unknown as { __recorded: Map<string, number> }
      w2.__recorded = new Map()
      rr.picture = (ctx, root, e) => {
        if (!e.picture) w2.__recorded.set(root, (w2.__recorded.get(root) ?? 0) + 1)
        return pic(ctx, root, e)
      }
      const rz = r as unknown as {
        rasterize(e: { ids?: string[] }, pic: unknown, b: unknown, scale: number): unknown
      }
      const ras = rz.rasterize.bind(rz)
      const w3 = w as unknown as { __rasterized: Map<string, number> }
      w3.__rasterized = new Map()
      rz.rasterize = (e, pic, b, scale) => {
        const k = `${e.ids?.[0] ?? "shared"}@${scale}`
        w3.__rasterized.set(k, (w3.__rasterized.get(k) ?? 0) + 1)
        return ras(e, pic, b, scale)
      }
      const orig = r.render.bind(r)
      r.render = () => {
        orig()
        const s = r.stats()
        probe.frames.push({
          end: performance.now(),
          ms: s.frameMs,
          drawn: s.nodesDrawn,
          culled: s.nodesCulled,
          draws: s.drawCalls,
          recMs: s.recordMs ?? 0,
          rasMs: s.rasterMs ?? 0,
          rec: s.recorded ?? 0,
          ras: s.rasterized ?? 0,
        })
      }
    },
  }
  w.__probe = probe
}

// --- stats ----------------------------------------------------------------------------------

function pct(xs: number[], p: number): number {
  if (!xs.length) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] as number
}
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "–")
function summary(xs: number[]) {
  return { n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95), max: pct(xs, 1) }
}
type Summary = ReturnType<typeof summary>
const line = (s: Summary) => `p50 ${f1(s.p50)}  p95 ${f1(s.p95)}  max ${f1(s.max)}  (n ${s.n})`

// --- profiling ------------------------------------------------------------------------------

interface ProfileNode {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number }
  hitCount?: number
}
function bucketOf(url: string, fn: string): string {
  if (fn === "(idle)") return "(idle)"
  if (fn === "(garbage collector)") return "gc"
  if (!url) return "(native)"
  const m = /\/packages\/([\w-]+)\//.exec(url) ?? /\/@kimo\/([\w-]+)\//.exec(url)
  if (m) return `@kimo/${m[1]}`
  if (/canvaskit/.test(url)) return "canvaskit"
  if (/yoga/.test(url)) return "yoga"
  if (/react/.test(url)) return "react"
  if (/yjs|y-indexeddb|lib0/.test(url)) return "yjs"
  if (/apps\/web\/src|\/src\//.test(url)) return "app"
  return url.replace(/^.*\/node_modules\/(\.vite\/deps\/)?/, "").slice(0, 40)
}

async function profiled<T>(cdp: CDPSession | null, label: string, fn: () => Promise<T>) {
  if (!cdp) return fn()
  await cdp.send("Profiler.enable")
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 })
  await cdp.send("Profiler.start")
  const out = await fn()
  const { profile } = (await cdp.send("Profiler.stop")) as {
    profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] }
  }
  const self = new Map<string, number>()
  const buckets = new Map<string, number>()
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i] as number)
    if (!n) continue
    const url = n.callFrame.url.replace(/^.*\/(src|node_modules)\//, "$1/").replace(/\?.*$/, "")
    const key = `${n.callFrame.functionName || "(anon)"} ${url}:${n.callFrame.lineNumber + 1}`
    const ms = (profile.timeDeltas[i] ?? 0) / 1000
    self.set(key, (self.get(key) ?? 0) + ms)
    const b = bucketOf(n.callFrame.url, n.callFrame.functionName)
    buckets.set(b, (buckets.get(b) ?? 0) + ms)
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0)
  console.log(`    profile ${label}: ${total.toFixed(0)} ms sampled; by package:`)
  console.log(
    `      ${[...buckets.entries()]
      .filter(([k]) => k !== "(idle)")
      .sort((a, b) => b[1] - a[1])
      .map(([k, ms]) => `${k} ${ms.toFixed(0)}`)
      .join(" · ")}`,
  )
  console.log("    top self time:")
  for (const [k, ms] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14))
    console.log(`      ${ms.toFixed(1).padStart(8)} ms  ${k}`)
  console.log("    top self time in JS:")
  for (const [k, ms] of [...self.entries()]
    .filter(([k]) => !/\.wasm|^\(/.test(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14))
    console.log(`      ${ms.toFixed(1).padStart(8)} ms  ${k}`)
  return out
}

// --- phases ---------------------------------------------------------------------------------

async function openNewFile(page: Page, url: string) {
  await page.goto(url)
  await page.getByRole("button", { name: "New file" }).click()
  await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 60_000 })
}

const raf2 = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  )

/** Replaces the document with `doc` in one op group; returns apply ms and ms to first frame. */
async function importDoc(page: Page, doc: PerfDoc) {
  return page.evaluate(async (ops) => {
    const w = window as unknown as Win
    w.__probe.install()
    const { store } = w.__kimo.session
    const del = store.children(null).map((id) => ({ op: "delete", id }))
    store.apply(del, { origin: "user" })
    const t0 = performance.now()
    const n = w.__probe.frames.length
    const r = store.apply(ops, { origin: "user", label: "perf doc" })
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "))
    const t1 = performance.now()
    store.clearHistory("user")
    w.__kimo.canvas()?.zoomToFit()
    // First frame that draws the new content.
    for (;;) {
      await new Promise((res) => requestAnimationFrame(res))
      const fs = w.__probe.frames.slice(n)
      const f = fs.find((x) => x.drawn > 0)
      // Complete: every node drawn or culled (the renderer records pictures progressively).
      const done = fs.find((x) => x.drawn + x.culled >= ops.length)
      if (f && done)
        return {
          applyMs: t1 - t0,
          firstFrameMs: f.end - t0,
          frameMs: f.ms,
          drawn: f.drawn,
          completeMs: done.end - t0,
          frames: fs.indexOf(done) + 1,
          maxFrameMs: Math.max(...fs.slice(0, fs.indexOf(done) + 1).map((x) => x.ms)),
        }
      if (performance.now() - t0 > 60_000) throw new Error("no frame after import")
    }
  }, doc.ops)
}

/** Reload: navigation start → canvas ready (first frame rendered synchronously in start()). */
async function coldOpen(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cold?: Record<string, number> }
    w.__cold = {}
    const mo = new MutationObserver(() => {
      const el = document.querySelector('.canvas-host[data-ready="true"]')
      if (el && w.__cold && !w.__cold.ready) w.__cold.ready = performance.now()
    })
    document.addEventListener("DOMContentLoaded", () => {
      mo.observe(document.body, {
        attributes: true,
        subtree: true,
        attributeFilter: ["data-ready"],
      })
    })
  })
  await page.reload()
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 60_000 })
  await raf2(page)
  return page.evaluate(() => {
    const w = window as unknown as Win & { __cold: { ready: number } }
    const s = w.__kimo.canvas()?.renderer?.stats()
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming
    return {
      domContentLoaded: nav.domContentLoadedEventEnd,
      ready: w.__cold.ready,
      firstFrameMs: s?.frameMs ?? Number.NaN,
      drawn: s?.nodesDrawn ?? 0,
      backend: s?.backend ?? "?",
    }
  })
}

type SweepKind = "pan-fit" | "pan-100" | "zoom"

/** Drives the viewport every animation frame for `ms`; returns rAF deltas + render CPU ms. */
async function sweep(page: Page, kind: SweepKind, ms: number) {
  return page.evaluate(
    async ({ kind, ms }) => {
      const w = window as unknown as Win
      w.__probe.install()
      const c = w.__kimo.canvas()
      const ui = w.__kimo.session.ui
      if (!c) throw new Error("no canvas")
      c.zoomToFit()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const fit = { ...ui.getState().viewport }
      const host = document.querySelector(".canvas-host") as HTMLElement
      const W = host.clientWidth
      const H = host.clientHeight
      const n0 = w.__probe.frames.length
      const deltas: number[] = []
      const t0 = performance.now()
      let last = t0
      await new Promise<void>((done) => {
        const tick = (t: number) => {
          deltas.push(t - last)
          last = t
          const k = (t - t0) / ms
          let v: { x: number; y: number; zoom: number }
          if (kind === "pan-fit") {
            v = { x: fit.x + Math.sin(k * Math.PI * 2) * 600, y: fit.y + k * 400, zoom: fit.zoom }
          } else if (kind === "pan-100") {
            v = { x: k * 6000, y: 200 + Math.sin(k * Math.PI * 4) * 300, zoom: 1 }
          } else {
            // Zoom about the screen center: fit → 2× → fit (everything visible at the ends).
            const z = fit.zoom * 2 ** (Math.sin(k * Math.PI) * 4)
            const cx = fit.x + W / 2 / fit.zoom
            const cy = fit.y + H / 2 / fit.zoom
            v = { x: cx - W / 2 / z, y: cy - H / 2 / z, zoom: z }
          }
          ui.getState().setViewport(v)
          if (t - t0 < ms) requestAnimationFrame(tick)
          else done()
        }
        requestAnimationFrame(tick)
      })
      const frames = w.__probe.frames.slice(n0)
      return {
        deltas: deltas.slice(2),
        renderMs: frames.map((f) => f.ms),
        // Slowest frames: what they spent on recording / rasterizing.
        slow: [...frames]
          .sort((a, b) => b.ms - a.ms)
          .slice(0, 6)
          .map(
            (f) =>
              `${f.ms.toFixed(0)}ms(rec ${f.rec}/${f.recMs.toFixed(0)}ms ras ${f.ras}/${f.rasMs.toFixed(0)}ms)`,
          ),
        rasterized: (() => {
          const m = (w as unknown as { __rasterized: Map<string, number> }).__rasterized
          const top = [...m].sort((a, b) => b[1] - a[1]).slice(0, 6)
          const n = [...m.values()].reduce((a, b) => a + b, 0)
          m.clear()
          return `${n}: ${top.map(([k, c]) => `${k}×${c}`).join(" ")}`
        })(),
        recorded: (() => {
          const m = (w as unknown as { __recorded: Map<string, number> }).__recorded
          const top = [...m].sort((a, b) => b[1] - a[1]).slice(0, 5)
          m.clear()
          return top.map(([k, n]) => `${k}×${n}`).join(" ")
        })(),
        // Renderer cache state (diagnostics, KIMO_PERF_VERBOSE).
        cache: (() => {
          const r = w.__kimo.canvas()?.renderer as unknown as {
            roots?: Map<string, { picture: unknown; raster: unknown; wrap: unknown }>
            shared?: Map<string, { raster: unknown; bounds: unknown }>
          }
          const roots = [...(r.roots?.values() ?? [])]
          const shared = [...(r.shared?.values() ?? [])]
          return `roots ${roots.length} (pictures ${roots.filter((e) => e.picture).length}, rasters ${roots.filter((e) => e.raster).length}, shared wrappers ${roots.filter((e) => e.wrap).length}); shared ${shared.length} (bounded ${shared.filter((x) => x.bounds).length}, rasters ${shared.filter((x) => x.raster).length})`
        })(),
        drawn: Math.max(...frames.map((f) => f.drawn)),
        draws: Math.max(...frames.map((f) => f.draws)),
        frames: frames.length,
      }
    },
    { kind, ms },
  )
}

/** Hover / selection latency: real mouse input → first frame rendered after the UI change. */
async function inputLatency(page: Page, doc: PerfDoc, kind: "hover" | "select") {
  // The first screen at 75 %: two sibling cards of its first card row as targets, and an empty
  // canvas spot right of the screen to move off to between hover samples.
  const targets = await page.evaluate((card) => {
    const w = window as unknown as Win
    w.__probe.install()
    const c = w.__kimo.canvas()
    const { store } = w.__kimo.session
    const ui = w.__kimo.session.ui.getState()
    ui.clearSelection?.()
    ui.setViewport({ x: -40, y: -40, zoom: 0.75 })
    const host = (document.querySelector(".canvas-host") as HTMLElement).getBoundingClientRect()
    const layout = c?.layout()
    const row = store.getNode(card)?.parent as string
    const screen = store.getNode(row)?.parent as string
    const toPage = (x: number, y: number) => ({
      x: host.x + (x + 40) * 0.75,
      y: host.y + (y + 40) * 0.75,
    })
    const pts = store
      .children(row)
      .slice(0, 2)
      .map((id) => {
        const b = layout?.nodes.get(id)?.world as { x: number; y: number; w: number; h: number }
        return { id, ...toPage(b.x + b.w / 2, b.y + 20) }
      })
    const sb = layout?.nodes.get(screen)?.world as { x: number; y: number; w: number; h: number }
    const off = toPage(sb.x + sb.w + 40, sb.y + 200)
    const inside = off.x < host.x + host.width - 4
    return { pts, off: inside ? off : { x: host.x + 4, y: host.y + host.height - 4 } }
  }, doc.cards[0] as string)
  await raf2(page)
  await page.evaluate(() => {
    const w = window as unknown as Win & { __lat: { ev: number[]; ui: number[] } }
    w.__lat = { ev: [], ui: [] }
    const type = "pointermove"
    window.addEventListener(type, (e) => w.__lat.ev.push(e.timeStamp), { capture: true })
    window.addEventListener("pointerdown", (e) => w.__lat.ev.push(e.timeStamp), { capture: true })
    w.__kimo.session.ui.subscribe(() => w.__lat.ui.push(performance.now()))
  })
  const out: number[] = []
  for (let i = 0; i < LATENCY_SAMPLES; i++) {
    const t = targets.pts[i % 2] as { id: string; x: number; y: number }
    await page.evaluate(() => {
      const w = window as unknown as Win & { __lat: { ev: number[]; ui: number[] } }
      w.__lat.ev.length = 0
      w.__lat.ui.length = 0
      w.__probe.frames.length = 0
    })
    if (kind === "hover") await page.mouse.move(t.x, t.y)
    else {
      await page.mouse.move(t.x, t.y)
      await raf2(page)
      await page.evaluate(() => {
        const w = window as unknown as Win & { __lat: { ev: number[]; ui: number[] } }
        w.__lat.ev.length = 0
        w.__lat.ui.length = 0
        w.__probe.frames.length = 0
      })
      // ⌘-click selects the deepest hit, so alternating sibling cards changes the selection.
      await page.keyboard.down("Meta")
      await page.mouse.down()
      await page.mouse.up()
      await page.keyboard.up("Meta")
    }
    await raf2(page)
    await raf2(page)
    const ms = await page.evaluate(() => {
      const w = window as unknown as Win & { __lat: { ev: number[]; ui: number[] } }
      const ev = w.__lat.ev[0]
      const u = w.__lat.ui[0]
      const f = u === undefined ? undefined : w.__probe.frames.find((x) => x.end >= u)
      if (ev === undefined || !f) {
        console.warn(`latency sample dropped: ev ${ev} ui ${u} frames ${w.__probe.frames.length}`)
        return Number.NaN
      }
      return f.end - ev
    })
    out.push(ms)
    if (kind === "hover") {
      // Move off to an empty spot so the next hover is a change.
      await page.mouse.move(targets.off.x, targets.off.y)
      await raf2(page)
    }
  }
  return out.filter((x) => Number.isFinite(x))
}

/**
 * Fidelity of the zoomed-out raster cache: the canvas at zoom-to-fit drawn from cached rasters
 * vs replayed pictures. Returns the mean and max per-channel difference (0–255).
 */
async function rasterFidelity(page: Page, shots: string | null) {
  await page.evaluate(async () => {
    const w = window as unknown as Win
    w.__kimo.session.ui.getState().select([])
    w.__kimo.canvas()?.zoomToFit()
    // Let the progressive raster fill finish.
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r))
  })
  const box = await page.locator(".canvas-host").boundingBox()
  if (!box) throw new Error("no canvas")
  const clip = { x: box.x, y: box.y, width: box.width, height: box.height }
  const cached = await page.screenshot({ clip })
  const prev = await page.evaluate(async () => {
    const r = (window as unknown as Win).__kimo.canvas()?.renderer as unknown as {
      rasterCache: boolean
      requestFrame(): void
    }
    const was = r.rasterCache
    r.rasterCache = false
    r.requestFrame()
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
    return was
  })
  const replayed = await page.screenshot({ clip })
  await page.evaluate((was) => {
    const r = (window as unknown as Win).__kimo.canvas()?.renderer as unknown as {
      rasterCache: boolean
      requestFrame(): void
    }
    r.rasterCache = was
    r.requestFrame()
  }, prev)
  if (shots) {
    writeFileSync(join(shots, "perf-fit-raster.png"), cached)
    writeFileSync(join(shots, "perf-fit-picture.png"), replayed)
  }
  return page.evaluate(
    async ([a, b]) => {
      const decode = async (b64: string) => {
        const img = new Image()
        img.src = `data:image/png;base64,${b64}`
        await img.decode()
        const c = new OffscreenCanvas(img.width, img.height)
        const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D
        g.drawImage(img, 0, 0)
        return g.getImageData(0, 0, img.width, img.height).data
      }
      const pa = await decode(a as string)
      const pb = await decode(b as string)
      let sum = 0
      let max = 0
      for (let i = 0; i < pa.length; i++) {
        const d = Math.abs((pa[i] as number) - (pb[i] as number))
        sum += d
        if (d > max) max = d
      }
      return { mean: sum / pa.length, max }
    },
    [cached.toString("base64"), replayed.toString("base64")],
  )
}

/** Drags the first screen (root frame) with the mouse for ~1 s: rAF deltas + render ms. */
async function dragRoot(page: Page, doc: PerfDoc) {
  const start = await page.evaluate((rootId) => {
    const w = window as unknown as Win
    w.__probe.install()
    const ui = w.__kimo.session.ui.getState()
    // Selected first: a press on an unselected root's background starts a marquee instead.
    ui.select([rootId])
    ui.setViewport({ x: -40, y: -40, zoom: 0.5 })
    const host = (document.querySelector(".canvas-host") as HTMLElement).getBoundingClientRect()
    const b = w.__kimo.canvas()?.layout()?.nodes.get(rootId)?.world as {
      x: number
      y: number
      h: number
    }
    // The screen's bottom padding: only the root itself is hit there, so the press selects it.
    return { x: host.x + (b.x + 30 + 40) * 0.5, y: host.y + (b.y + b.h - 20 + 40) * 0.5 }
  }, doc.roots[0] as string)
  await raf2(page)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await raf2(page)
  await page.evaluate(() => {
    const w = window as unknown as Win & { __drag: { deltas: number[]; on: boolean; n: number } }
    w.__drag = { deltas: [], on: true, n: w.__probe.frames.length }
    let last = performance.now()
    const tick = (t: number) => {
      w.__drag.deltas.push(t - last)
      last = t
      if (w.__drag.on) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  for (let i = 1; i <= 60; i++) {
    await page.mouse.move(start.x + i * 3, start.y + Math.sin(i / 6) * 20)
    await page.waitForTimeout(16)
  }
  const r = await page.evaluate(() => {
    const w = window as unknown as Win & { __drag: { deltas: number[]; on: boolean; n: number } }
    w.__drag.on = false
    return {
      deltas: w.__drag.deltas.slice(2),
      renderMs: w.__probe.frames.slice(w.__drag.n).map((f) => f.ms),
    }
  })
  await page.mouse.up()
  await raf2(page)
  const moved = await page.evaluate(
    (id) => (window as unknown as Win).__kimo.session.store.getNode(id)?.x,
    doc.roots[0] as string,
  )
  if (moved === 0) throw new Error("drag did not move the screen")
  // Undo the move so later phases see the original document.
  await page.keyboard.press("Meta+z")
  await raf2(page)
  return r
}

/** One `store.apply` of a single-property update → first frame rendered after it. */
async function editLatency(page: Page, doc: PerfDoc, kind: "paint" | "layout" | "text") {
  return page.evaluate(
    async ({ kind, cards, texts, samples }) => {
      const w = window as unknown as Win
      w.__probe.install()
      const { store } = w.__kimo.session
      w.__kimo.canvas()?.zoomToFit()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const out: number[] = []
      const applyMs: number[] = []
      const renderMs: number[] = []
      for (let i = 0; i < samples; i++) {
        const card = cards[i % cards.length] as string
        const text = texts[i % texts.length] as string
        const thumb = store.children(card)[0] as string
        const set =
          kind === "paint"
            ? { id: card, set: { fill: `#FFF4${(16 + i).toString(16).toUpperCase()}` } }
            : kind === "layout"
              ? { id: thumb, set: { h: 96 + ((i % 3) + 1) * 8 } }
              : { id: text, set: { content: `edited ${i} title` } }
        const n = w.__probe.frames.length
        const t0 = performance.now()
        const r = store.apply([{ op: "update", ...set }], { origin: "user" })
        if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "))
        applyMs.push(performance.now() - t0)
        for (;;) {
          await new Promise((res) => requestAnimationFrame(res))
          const f = w.__probe.frames[n]
          if (f) {
            out.push(f.end - t0)
            renderMs.push(f.ms)
            break
          }
          if (performance.now() - t0 > 5000) {
            out.push(Number.NaN)
            break
          }
        }
        await new Promise((r) => requestAnimationFrame(r))
      }
      return { out, applyMs, renderMs }
    },
    { kind, cards: doc.cards, texts: doc.texts, samples: LATENCY_SAMPLES },
  )
}

// --- M3: instances --------------------------------------------------------------------------

const INSTANCES = Number(process.env.KIMO_PERF_INSTANCES ?? 1000)

/**
 * M3 stress: a 30-node main (rows of label + swatch, fill and pad bound to themed variables) and
 * `count` instances — half inside one plain frame (`perfGroupA`, the theme-pin target), half at
 * the root — then edit → frame latencies: override one instance, move one instance, edit the
 * main (paint, layout; every instance follows), toggle a theme pin on the parent of half the
 * instances, switch the document's default variable mode (`setThemes` "make default") and edit
 * a variable's value.
 */
async function instanceSetup(page: Page, count: number) {
  const { ops, ids } = generateM3Ops(count)
  const insertMs = await page.evaluate(
    async ({ ops, ids }) => {
      const w = window as unknown as Win
      w.__probe.install()
      const { store } = w.__kimo.session
      const n0 = w.__probe.frames.length
      const t0 = performance.now()
      const r0 = store.apply(ops, { origin: "user", label: "perf instances" })
      if (!r0.ok) throw new Error(r0.errors.map((e) => e.message).join("; "))
      for (;;) {
        await new Promise((res) => requestAnimationFrame(res))
        if (w.__probe.frames.length > n0) break
      }
      const ms = performance.now() - t0
      store.clearHistory("user")
      // Half of group A and the main on screen (≈ 0.4 zoom): edits re-record what is visible.
      w.__kimo.canvas()?.zoomToFit(["perfMain01", ...ids.slice(0, 200)])
      for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r))
      return ms
    },
    { ops, ids },
  )
  return { insertMs, ids }
}

type M3Case = "override" | "move" | "main" | "mainLayout" | "pin" | "mode" | "variable"

/** `samples` edits of one kind, each `store.apply` → first frame rendered after it. */
async function instanceCase(page: Page, ids: string[], kind: M3Case) {
  return page.evaluate(
    async ({ ids, kind, samples }) => {
      const w = window as unknown as Win
      w.__probe.install()
      const { store } = w.__kimo.session
      const mk = (i: number): Record<string, unknown>[] => {
        switch (kind) {
          case "override":
            return [
              {
                op: "update",
                id: ids[(i * 7) % ids.length],
                set: {
                  overrides: { perfSw0003: { set: { fill: `#00${(16 + i).toString(16)}FF` } } },
                },
              },
            ]
          case "move":
            return [{ op: "update", id: ids[(i * 13) % ids.length], set: { x: -37 * i } }]
          case "main":
            return [
              { op: "update", id: "perfSw0005", set: { fill: `#FF${(16 + i).toString(16)}00` } },
            ]
          case "mainLayout":
            return [{ op: "update", id: "perfSw0002", set: { w: 12 + (i % 4) * 4 } }]
          case "pin":
            // Theme pin on the parent of half the instances: on (dark) / off (inherit).
            return [
              i % 2 === 0
                ? { op: "update", id: "perfGroupA", set: { theme: { mode: "dark" } } }
                : { op: "update", id: "perfGroupA", unset: ["theme"] },
            ]
          case "mode":
            // Document default mode switch (variables dialog "Make default"): light ⇄ dark.
            return [
              {
                op: "setThemes",
                set: { mode: i % 2 === 0 ? ["dark", "light"] : ["light", "dark"] },
              },
            ]
          case "variable":
            // A variable's value edited (variables dialog cell): every bound swatch repaints.
            return [
              {
                op: "setVariables",
                set: {
                  "perf/accent": {
                    type: "color",
                    value: [
                      { value: `#7C${(32 + i).toString(16)}ED`, when: { mode: "light" } },
                      { value: "#A78BFA", when: { mode: "dark" } },
                    ],
                  },
                },
              },
            ]
        }
      }
      const out: number[] = []
      const applyMs: number[] = []
      const renderMs: number[] = []
      const recMs: number[] = []
      const rasMs: number[] = []
      for (let i = 0; i < samples; i++) {
        const n = w.__probe.frames.length
        const t = performance.now()
        const r = store.apply(mk(i), { origin: "user" })
        if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "))
        applyMs.push(performance.now() - t)
        for (;;) {
          await new Promise((res) => requestAnimationFrame(res))
          const f = w.__probe.frames[n]
          if (f) {
            out.push(f.end - t)
            renderMs.push(f.ms)
            recMs.push(f.recMs)
            rasMs.push(f.rasMs)
            break
          }
          if (performance.now() - t > 5000) {
            out.push(Number.NaN)
            break
          }
        }
        // Let progressive recording settle so samples do not overlap.
        for (let k = 0; k < 4; k++) await new Promise((r) => requestAnimationFrame(r))
      }
      return { out, applyMs, renderMs, recMs, rasMs }
    },
    { ids, kind, samples: LATENCY_SAMPLES },
  )
}

// --- main -----------------------------------------------------------------------------------

/** `KIMO_PERF_PHASES=sweeps`: stop after the pan/zoom sweeps. */
class SweepsDone extends Error {}

async function main() {
  const skip = process.env.KIMO_PERF_M2_SKIP?.split(",").filter(Boolean)
  const doc = generatePerfDoc(NODES, 1, { m2: M2, skip })
  console.log(
    `Kimo perf gate${M2 ? ` (M2 stress${skip?.length ? `, without ${skip.join(", ")}` : ""})` : ""} — ${doc.count} nodes (${doc.roots.length} screens), GL ${GL}, dpr ${DPR}, ${PROD ? "production build" : "dev server"}`,
  )
  const configFile = join(root, "vite.config.ts")
  let url: string
  let server: { close(): Promise<void> }
  if (PROD) {
    // Production bundle in a scratch dir; `?kimo-debug` opts the page into the test hook.
    const outDir = join(root, "node_modules", ".kimo-perf-dist")
    await build({ root, configFile, logLevel: "error", build: { outDir, emptyOutDir: true } })
    const p = await preview({
      root,
      configFile,
      logLevel: "error",
      build: { outDir },
      preview: { port: 0, strictPort: false, host: "127.0.0.1" },
    })
    const address = p.httpServer.address()
    url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/?kimo-debug`
    server = { close: () => p.close() }
  } else {
    const dev = await createServer({
      root,
      configFile,
      logLevel: "error",
      server: { port: 0, strictPort: false, host: "127.0.0.1" },
    })
    await dev.listen()
    const address = dev.httpServer?.address()
    url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`
    server = dev
  }
  let browser: Browser | null = null
  const results: Record<string, unknown> = { nodes: doc.count, gl: GL, dpr: DPR, m2: M2 }
  let failed = false
  try {
    const args =
      GL === "gpu"
        ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal"]
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    browser = await chromium.launch({ args, headless: process.env.KIMO_PERF_HEADED !== "1" })
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: DPR,
    })
    const page = await context.newPage()
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text())
      if (m.type() === "warning" && m.text().startsWith("latency")) console.log(`    ${m.text()}`)
    })
    if (process.env.KIMO_PERF_NO_RASTER === "1")
      await page.addInitScript(() => {
        ;(window as unknown as { __perfNoRaster: boolean }).__perfNoRaster = true
      })
    if (process.env.KIMO_PERF_NO_MOTION === "1")
      await page.addInitScript(() => {
        ;(window as unknown as { __perfNoMotion: boolean }).__perfNoMotion = true
      })
    if (process.env.KIMO_PERF_NO_LABELS === "1")
      await page.addInitScript(() => {
        // A/B: the DOM artboard / instance labels (apps/web CanvasHost) hidden.
        document.addEventListener("DOMContentLoaded", () => {
          const st = document.createElement("style")
          st.textContent = ".canvas-host__labels{display:none!important}"
          document.head.append(st)
        })
      })
    await page.addInitScript(installProbe)
    const cdp = PROFILE ? await context.newCDPSession(page) : null

    await openNewFile(page, url)
    const imp = await profiled(cdp, "import", () => importDoc(page, doc))
    results.import = imp
    console.log(
      `  import (apply ${doc.count} inserts → first frame): apply ${f1(imp.applyMs)} ms, first frame at ${f1(imp.firstFrameMs)} ms (render ${f1(imp.frameMs)} ms, ${imp.drawn} nodes drawn); all ${doc.count} drawn at ${f1(imp.completeMs)} ms after ${imp.frames} frame(s), longest render ${f1(imp.maxFrameMs)} ms`,
    )
    const sweeps: Record<string, unknown> = {}
    const lat: Record<string, Summary> = {}
    if (!M3_ONLY) {
      // Let y-indexeddb persist before reloading.
      if (!SWEEPS_ONLY) await page.waitForTimeout(2500)
      if (!SWEEPS_ONLY) {
        const cold = await profiled(cdp, "cold open", () => coldOpen(page))
        results.coldOpen = cold
        console.log(
          `  cold open (reload → canvas ready): ${f1(cold.ready)} ms (DOMContentLoaded ${f1(cold.domContentLoaded)} ms, first render ${f1(cold.firstFrameMs)} ms, ${cold.drawn} drawn, ${cold.backend})`,
        )
      }
      // Zoom to fit right after opening: most roots were never recorded at 100 %.
      const fit = await page.evaluate(async (count) => {
        const w = window as unknown as Win
        w.__probe.install()
        const n = w.__probe.frames.length
        const t0 = performance.now()
        w.__kimo.canvas()?.zoomToFit()
        for (;;) {
          await new Promise((r) => requestAnimationFrame(r))
          const fs = w.__probe.frames.slice(n)
          const done = fs.find((x) => x.drawn + x.culled >= count)
          if (done)
            return {
              completeMs: done.end - t0,
              frames: fs.indexOf(done) + 1,
              maxFrameMs: Math.max(...fs.map((x) => x.ms)),
            }
          if (performance.now() - t0 > 30_000) throw new Error("fit never completed")
        }
      }, doc.count)
      results.fitAfterOpen = fit
      console.log(
        `  zoom to fit after open: all drawn after ${fit.frames} frame(s) / ${f1(fit.completeMs)} ms, longest render ${f1(fit.maxFrameMs)} ms`,
      )

      for (const kind of ["pan-fit", "pan-100", "zoom"] as const) {
        // Warm-up (records pictures, JIT; `KIMO_PERF_WARM_MS` longer to separate one-time costs
        // such as GPU shader compiles from steady state).
        await sweep(page, kind, Number(process.env.KIMO_PERF_WARM_MS ?? 500))
        const s = await profiled(cdp, kind, () => sweep(page, kind, SWEEP_MS))
        const raf = summary(s.deltas)
        const ren = summary(s.renderMs)
        sweeps[kind] = { raf, render: ren, frames: s.frames, maxDrawn: s.drawn, maxDraws: s.draws }
        console.log(`  ${kind.padEnd(8)} rAF Δ ms   ${line(raf)}`)
        console.log(
          `  ${"".padEnd(8)} render ms  ${line(ren)}  frames ${s.frames}, ≤${s.drawn} nodes / ${s.draws} draws`,
        )
        if (process.env.KIMO_PERF_VERBOSE === "1")
          console.log(`  ${"".padEnd(8)} slowest   ${s.slow.join(" ")}`)
        if (raf.p95 > FRAME_GATE) failed = true
      }
      results.sweeps = sweeps
      if (SWEEPS_ONLY) throw new SweepsDone()
      const fid = await rasterFidelity(page, process.env.KIMO_PERF_SHOTS ?? null)
      results.rasterFidelity = fid
      console.log(
        `  raster cache vs picture at fit: mean |Δ| ${fid.mean.toFixed(2)}, max ${fid.max} (0–255)`,
      )
      if (fid.mean > 2) failed = true
      {
        const d = await profiled(cdp, "drag", () => dragRoot(page, doc))
        const raf = summary(d.deltas)
        const ren = summary(d.renderMs)
        sweeps.drag = { raf, render: ren }
        console.log(`  ${"drag".padEnd(8)} rAF Δ ms   ${line(raf)}`)
        console.log(`  ${"".padEnd(8)} render ms  ${line(ren)}  (move a 121-node screen)`)
        if (raf.p95 > FRAME_GATE) failed = true
      }

      for (const kind of ["hover", "select"] as const) {
        const xs = await profiled(cdp, kind, () => inputLatency(page, doc, kind))
        lat[kind] = summary(xs)
        console.log(`  ${`${kind} → frame`.padEnd(18)} ms ${line(lat[kind])}`)
      }
      for (const kind of ["paint", "layout", "text"] as const) {
        const { out, applyMs, renderMs } = await profiled(cdp, `edit-${kind}`, () =>
          editLatency(page, doc, kind),
        )
        lat[`edit-${kind}`] = summary(out.filter(Number.isFinite))
        lat[`edit-${kind}-apply`] = summary(applyMs)
        console.log(
          `  ${`edit ${kind} → frame`.padEnd(18)} ms ${line(lat[`edit-${kind}`] as Summary)}   [store.apply p50 ${f1(pct(applyMs, 0.5))}, render p50 ${f1(pct(renderMs, 0.5))}]`,
        )
      }
    } // !M3_ONLY
    if (INSTANCES > 0) {
      const { insertMs, ids } = await profiled(cdp, "m3-insert", () =>
        instanceSetup(page, INSTANCES),
      )
      console.log(
        `  M3 ${INSTANCES} instances of a 30-node main: insert → first frame ${f1(insertMs)} ms`,
      )
      const rows = [
        ["override", "override", EDIT_GATE],
        ["move", "move", EDIT_GATE],
        ["main paint", "main", MAIN_EDIT_GATE],
        ["main layout", "mainLayout", MAIN_EDIT_GATE],
        ["theme pin (500)", "pin", EDIT_GATE],
        ["mode switch", "mode", EDIT_GATE],
        ["variable edit", "variable", EDIT_GATE],
      ] as const
      const m3: Record<string, unknown> = { insertMs }
      for (const [k, kind, gate] of rows) {
        const r = await profiled(cdp, `m3-${kind}`, () => instanceCase(page, ids, kind))
        const sm = summary(r.out.filter(Number.isFinite))
        console.log(
          `  ${`M3 ${k} → frame`.padEnd(26)} ms ${line(sm)}   [store.apply p50 ${f1(pct(r.applyMs, 0.5))}, render p50 ${f1(pct(r.renderMs, 0.5))} (record ${f1(pct(r.recMs, 0.5))}, raster ${f1(pct(r.rasMs, 0.5))})]`,
        )
        if (!(sm.p95 <= gate)) failed = true
        m3[k] = { frame: sm, apply: summary(r.applyMs), render: summary(r.renderMs) }
      }
      // Pan / zoom with the instances in the document (5k nodes + 1k × 31 expanded).
      for (const kind of ["pan-fit", "pan-100", "zoom"] as const) {
        await sweep(page, kind, Number(process.env.KIMO_PERF_WARM_MS ?? 500))
        const s = await profiled(cdp, `m3-${kind}`, () => sweep(page, kind, SWEEP_MS))
        const raf = summary(s.deltas)
        const ren = summary(s.renderMs)
        m3[kind] = { raf, render: ren, frames: s.frames, maxDrawn: s.drawn, maxDraws: s.draws }
        console.log(`  M3 ${kind.padEnd(8)} rAF Δ ms   ${line(raf)}`)
        console.log(
          `  ${"".padEnd(11)} render ms  ${line(ren)}  frames ${s.frames}, ≤${s.drawn} nodes / ${s.draws} draws`,
        )
        if (process.env.KIMO_PERF_VERBOSE === "1") {
          console.log(`  ${"".padEnd(11)} slowest   ${s.slow.join(" ")}`)
          console.log(`  ${"".padEnd(11)} cache     ${s.cache}`)
          console.log(`  ${"".padEnd(11)} recorded  ${s.recorded}`)
          console.log(`  ${"".padEnd(11)} rasters   ${s.rasterized}`)
        }
        if (raf.p95 > FRAME_GATE) failed = true
      }
      results.m3 = m3
    }
    results.latency = lat
    for (const s of Object.values(lat)) if (s.p95 > EDIT_GATE) failed = true
    if (errors.length) {
      console.log(`  page errors:\n    ${errors.slice(0, 10).join("\n    ")}`)
      failed = true
    }
  } catch (e) {
    if (!(e instanceof SweepsDone)) throw e
  } finally {
    await browser?.close()
    await server.close()
  }
  if (process.env.KIMO_PERF_JSON)
    writeFileSync(process.env.KIMO_PERF_JSON, JSON.stringify(results, null, 2))
  const gate = process.env.KIMO_PERF_NO_GATE !== "1"
  console.log(failed ? "\nperf gate: FAIL" : "\nperf gate: pass")
  process.exit(failed && gate ? 1 : 0)
}

if (import.meta.main) await main()
