/**
 * Real-browser scale bench: loads a synthetic document into the built app in Chromium and
 * measures what a person feels: load to first paint, then frame intervals while panning,
 * zooming, hovering, editing and dragging.
 *
 *   scripts/safe-run.sh apps/web/node_modules/.bin/tsx apps/web/bench/browser.ts <url> <shape> <nodes>
 *
 * `url`: a served build of the app with the debug hook (`VITE_KIMO_DEBUG=1 vite build`, then
 * `vite preview`). Runs under Node (tsx), like the e2e runner. KIMO_BENCH_HEADED=1 shows the
 * window. Frame intervals are requestAnimationFrame deltas: main-thread frame production.
 */
import { writeFileSync } from "node:fs"
import { chromium } from "playwright"
import { generate } from "./gen"

const [url = "http://localhost:4173", shape = "screens", count = "10000"] = process.argv.slice(2)
const N = Number(count)

interface Hook {
  session: {
    provider?: {
      flush(): Promise<void>
      status: string
      onStatus(l: (e: { error?: Error }) => void): () => void
    }
    store: {
      loadDocument(doc: unknown, o: { validate: boolean }): void
      apply(ops: unknown, o: { origin: string }): { ok: boolean }
      undo(origin: string): unknown
      encodeStateAsUpdate(): Uint8Array
      size: number
      getNode(id: string): Record<string, unknown> | undefined
    }
    ui: {
      getState(): {
        viewport: { x: number; y: number; zoom: number }
        setViewport(v: object): void
        select(ids: string[]): void
      }
    }
  }
  canvas(): {
    layout(): {
      nodes: Map<string, { world: { x: number; y: number; w: number; h: number } }>
      bounds: { x: number; y: number; w: number; h: number } | null
    } | null
    zoomToFit(): void
    stats(): Record<string, number> | null
    hitTestCount?: number
  } | null
}

const browser = await chromium.launch({
  headless: !(process.env.KIMO_BENCH_HEADED || process.env.KIMO_BENCH_HOLD),
  channel: "chromium",
  args: [
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--use-angle=metal",
    "--enable-precise-memory-info",
    ...(process.env.KIMO_BENCH_HOLD ? ["--window-size=1680,1050"] : []),
    // A lower heap limit bounds the peak: a run that passes never needed more.
    ...(process.env.KIMO_BENCH_HEAP_MB
      ? [`--js-flags=--max-old-space-size=${process.env.KIMO_BENCH_HEAP_MB}`]
      : []),
  ],
})
// KIMO_BENCH_HOLD=1: a window with the generated document, left open to try by hand.
const context = await browser.newContext({
  viewport: process.env.KIMO_BENCH_HOLD ? null : { width: 1440, height: 900 },
})
await context.addInitScript({ content: "globalThis.__name ??= (fn) => fn" })
const page = await context.newPage()
const errors: string[] = []
page.on("pageerror", (e) => errors.push(e.message.slice(0, 300)))
page.on("crash", () => errors.push("PAGE CRASHED"))
if (process.env.KIMO_BENCH_CONSOLE)
  page.on("console", (m) => console.error("[console]", m.type(), m.text().slice(0, 300)))

const out: Record<string, unknown> = { shape, nodes: N }
const done = async (code: number) => {
  const counts = new Map<string, number>()
  for (const e of errors) counts.set(e, (counts.get(e) ?? 0) + 1)
  out.errors = [...counts].map(([e, n]) => (n > 1 ? `${n}x ${e}` : e))
  console.log(JSON.stringify(out))
  await browser.close().catch(() => undefined)
  process.exit(code)
}

try {
  await page.goto(`${url}/?kimo-debug`)
  await page.getByRole("button", { name: "New file" }).first().click()
  await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 60_000 })

  out.gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2")
    const ext = gl?.getExtension("WEBGL_debug_renderer_info")
    return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "none"
  })

  // In-page helpers (serialized: each reads the hook itself). Installed again after a reload.
  const helpers = () =>
    page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>
      const long: number[] = []
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) long.push(e.duration)
        }).observe({ entryTypes: ["longtask"] })
      } catch {}
      const summary = (ts: number[], from: number) => {
        const d: number[] = []
        for (let i = 1; i < ts.length; i++) d.push((ts[i] as number) - (ts[i - 1] as number))
        d.sort((a, b) => a - b)
        const at = (q: number) =>
          +(d[Math.min(d.length - 1, Math.floor(d.length * q))] ?? 0).toFixed(1)
        const tasks = long.slice(from)
        return {
          frames: d.length,
          p50: at(0.5),
          p95: at(0.95),
          max: +(d[d.length - 1] ?? 0).toFixed(1),
          over33: d.filter((x) => x > 33.4).length,
          longTasks: tasks.length,
          longMax: +Math.max(0, ...tasks).toFixed(0),
        }
      }
      /** Runs `step(i)` once per frame for `n` frames and summarizes the frame intervals. */
      w.__frames = (n: number, step: (i: number) => void) =>
        new Promise((resolve) => {
          const ts: number[] = []
          const from = long.length
          let i = 0
          const tick = (t: number) => {
            ts.push(t)
            if (i < n) {
              step(i++)
              requestAnimationFrame(tick)
            } else resolve(summary(ts, from))
          }
          requestAnimationFrame(tick)
        })
      /** Records frame intervals until the returned function is called. */
      w.__record = () => {
        const ts: number[] = []
        const from = long.length
        let on = true
        const tick = (t: number) => {
          ts.push(t)
          if (on) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        w.__stop = () => {
          on = false
          return summary(ts, from)
        }
      }
    })
  await helpers()

  // Load: generate in the page, then replace the document.
  // KIMO_BENCH_PROFILE_LOAD=<file>: a CPU profile of the load.
  const loadProfile = process.env.KIMO_BENCH_PROFILE_LOAD
  const loadCdp = loadProfile ? await context.newCDPSession(page) : null
  if (loadCdp) {
    await loadCdp.send("Profiler.enable")
    await loadCdp.send("Profiler.setSamplingInterval", { interval: 1000 })
    await loadCdp.send("Profiler.start")
  }
  // Three steps, each logged as it ends, so a crash names the stage it died in.
  const gcCdp = await context.newCDPSession(page)
  const heap = async () => {
    // Collected first: what stays is what the document holds.
    await gcCdp.send("HeapProfiler.collectGarbage").catch(() => undefined)
    return heapNow()
  }
  const heapNow = () =>
    page.evaluate(() => {
      const m = (
        performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }
      ).memory
      return m
        ? [Math.round(m.usedJSHeapSize / 1048576), Math.round(m.jsHeapSizeLimit / 1048576)]
        : [-1, -1]
    })
  const stage = (name: string, v: unknown) => console.error(`stage ${name}`, JSON.stringify(v))
  const genMs = await page.evaluate(
    ({ src, shape, N }) => {
      const gen = new Function(`return (${src})`)() as (s: string, n: number) => unknown
      const t0 = performance.now()
      ;(window as unknown as { __doc: unknown }).__doc = gen(shape, N)
      return Math.round(performance.now() - t0)
    },
    { src: generate.toString(), shape, N },
  )
  const genHeap = await heap()
  stage("generated", { genMs, heapMB: genHeap[0], limitMB: genHeap[1] })
  const stored = await page.evaluate(() => {
    const w = window as unknown as { __kimo: Hook; __doc?: unknown; __saveError?: string }
    w.__kimo.session.provider?.onStatus((e) => {
      if (e.error) w.__saveError = `${e.error.name}: ${e.error.message}`.slice(0, 300)
    })
    const t0 = performance.now()
    w.__kimo.session.store.loadDocument(w.__doc, { validate: false })
    w.__doc = undefined
    const storedAt = performance.now()
    return { storeMs: Math.round(storedAt - t0), size: w.__kimo.session.store.size, storedAt }
  })
  // Layout runs on the next frame: timed from the end of the store load until it is painted.
  const layoutAndPaintMs = await page.evaluate(async (t0) => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return Math.round(performance.now() - t0)
  }, stored.storedAt)
  const paintHeap = await heap()
  const laidOut = await page.evaluate(
    () => (window as unknown as { __kimo: Hook }).__kimo.canvas()?.layout()?.nodes.size ?? 0,
  )
  const load = {
    laidOut,
    genMs,
    ...stored,
    layoutAndPaintMs,
    heapMB: paintHeap[0],
    limitMB: paintHeap[1],
  }
  out.load = load
  // KIMO_BENCH_REOPEN=1: what a later visit costs. The document is written to IndexedDB, the
  // page reloaded, and the open timed until every node is laid out again.
  if (process.env.KIMO_BENCH_REOPEN) {
    const flushed = await page.evaluate(async () => {
      const w = window as unknown as { __kimo: Hook; __saveError?: string }
      const k = w.__kimo
      const t0 = performance.now()
      await k.session.provider?.flush()
      return {
        flushMs: Math.round(performance.now() - t0),
        status: k.session.provider?.status,
        error: w.__saveError,
        updateMB: +(k.session.store.encodeStateAsUpdate().byteLength / 1048576).toFixed(1),
      }
    })
    stage("flushed", flushed)
    const t0 = Date.now()
    await page.reload()
    await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 300_000 })
    await page.waitForFunction(
      (n) =>
        ((window as unknown as { __kimo?: Hook }).__kimo?.canvas()?.layout()?.nodes.size ?? 0) >= n,
      laidOut,
      { timeout: 300_000, polling: 250 },
    )
    const openMs = Date.now() - t0
    const before = await heapNow()
    const after = await heap()
    const size = await page.evaluate(
      () => (window as unknown as { __kimo: Hook }).__kimo.session.store.size,
    )
    await helpers()
    out.reopen = { ...flushed, openMs, size, heapBeforeGcMB: before[0], heapMB: after[0] }
    stage("reopened", out.reopen)
  }
  // KIMO_BENCH_HEAP=1: self size and count of the heaviest classes on the JS heap after load.
  if (process.env.KIMO_BENCH_HEAP) {
    const cdp = await context.newCDPSession(page)
    const chunks: string[] = []
    cdp.on("HeapProfiler.addHeapSnapshotChunk", (e) => chunks.push(e.chunk))
    await cdp.send("HeapProfiler.collectGarbage")
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false })
    const snap = JSON.parse(chunks.join("")) as {
      snapshot: { meta: { node_fields: string[]; node_types: [string[], ...unknown[]] } }
      nodes: number[]
      strings: string[]
    }
    const f = snap.snapshot.meta.node_fields
    const [iType, iName, iSelf] = [f.indexOf("type"), f.indexOf("name"), f.indexOf("self_size")]
    const types = snap.snapshot.meta.node_types[0]
    const by = new Map<string, { n: number; bytes: number }>()
    let total = 0
    for (let i = 0; i < snap.nodes.length; i += f.length) {
      const type = types[snap.nodes[i + iType] as number] as string
      const raw = snap.strings[snap.nodes[i + iName] as number] ?? ""
      // Strings and numbers are grouped by type; objects by constructor.
      const name =
        type === "object" || type === "native" || type === "array" || type === "closure"
          ? `${type}:${raw.slice(0, 40)}`
          : type
      const size = snap.nodes[i + iSelf] as number
      total += size
      const e = by.get(name)
      if (e) {
        e.n++
        e.bytes += size
      } else by.set(name, { n: 1, bytes: size })
    }
    // Who holds the bytes: each heap node is charged to the path from its nearest owner with
    // a class name (one retainer per node, up to 8 hops).
    {
      const full = snap as unknown as {
        snapshot: { meta: { edge_fields: string[]; edge_types: [string[], ...unknown[]] } }
        edges: number[]
      }
      const nf = f.length
      const ef = full.snapshot.meta.edge_fields.length
      const etypes = full.snapshot.meta.edge_types[0]
      const iEdges = f.indexOf("edge_count")
      const count = snap.nodes.length / nf
      const parent = new Int32Array(count).fill(-1)
      const via = new Int32Array(count).fill(-1)
      let e = 0
      for (let n = 0; n < count; n++) {
        const edges = snap.nodes[n * nf + iEdges] as number
        for (let k = 0; k < edges; k++, e += ef) {
          const et = etypes[full.edges[e] as number]
          if (et === "weak" || et === "shortcut") continue
          const to = (full.edges[e + 2] as number) / nf
          if (parent[to] === -1 && to !== n) {
            parent[to] = n
            via[to] = e
          }
        }
      }
      const plain = new Set(["Object", "Array", "Map", "Set", ""])
      const label = (n: number) => {
        const type = types[snap.nodes[n * nf + iType] as number] as string
        const raw = snap.strings[snap.nodes[n * nf + iName] as number] ?? ""
        return { type, raw }
      }
      const edgeName = (ei: number) => {
        const et = etypes[full.edges[ei] as number]
        if (et === "element" || et === "hidden") return "[]"
        const s = snap.strings[full.edges[ei + 1] as number] ?? "?"
        return /\d/.test(s) && s.length >= 5 ? "<id>" : s.slice(0, 24)
      }
      const paths = new Map<string, { n: number; bytes: number }>()
      for (let n = 0; n < count; n++) {
        const size = snap.nodes[n * nf + iSelf] as number
        if (size === 0) continue
        const parts: string[] = []
        let cur = n
        let anchor = ""
        for (let hop = 0; hop < 8; hop++) {
          const l = label(cur)
          if (
            (l.type === "object" && !plain.has(l.raw) && !l.raw.startsWith("system")) ||
            l.type === "closure" ||
            l.type === "native" ||
            l.type === "synthetic"
          ) {
            anchor = `${l.type === "object" ? "" : `${l.type}:`}${l.raw.slice(0, 28)}`
            break
          }
          const p = parent[cur] as number
          if (p < 0) break
          parts.push(edgeName(via[cur] as number))
          cur = p
        }
        const self = label(n)
        const leaf = self.type === "object" ? "" : ` (${self.type})`
        const near = parts
          .slice(0, 2)
          .reverse()
          .map((p) => `.${p}`)
          .join("")
        const key =
          anchor && parts.length <= 4
            ? `${anchor}${parts
                .reverse()
                .map((p) => `.${p}`)
                .join("")}${leaf}`
            : `~${near}${leaf}`
        const got = paths.get(key)
        if (got) {
          got.n++
          got.bytes += size
        } else paths.set(key, { n: 1, bytes: size })
      }
      out.heapPaths = [...paths]
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .slice(0, 400)
        .map(([name, v]) => [name, v.n, v.bytes])
    }
    out.heapTotalMB = Math.round(total / 1048576)
    out.heapClasses = [...by]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .slice(0, 45)
      .map(([name, e]) => [name, e.n, e.bytes])
  }
  if (loadCdp && loadProfile) {
    const { profile } = await loadCdp.send("Profiler.stop")
    writeFileSync(loadProfile, JSON.stringify(profile))
  }
  console.error("load", JSON.stringify(load))

  type Frames = (n: number, step: (i: number) => void) => Promise<unknown>
  // KIMO_BENCH_PROFILE=<scenario>:<file>: a CPU profile of that scenario (.cpuprofile).
  if (process.env.KIMO_BENCH_HOLD) {
    await page.evaluate(() => (window as unknown as { __kimo: Hook }).__kimo.canvas()?.zoomToFit())
    console.log("holding: close the browser window to end")
    await new Promise((resolve) => browser.on("disconnected", resolve))
    process.exit(0)
  }
  const [profiled, profilePath] = (process.env.KIMO_BENCH_PROFILE ?? "").split(":")
  const only = process.env.KIMO_BENCH_ONLY?.split(",")
  const scenario = async (name: string, fn: () => Promise<unknown>) => {
    if (only && !only.includes(name)) return
    const cdp = name === profiled && profilePath ? await context.newCDPSession(page) : null
    if (cdp) {
      await cdp.send("Profiler.enable")
      await cdp.send("Profiler.setSamplingInterval", { interval: 500 })
      await cdp.send("Profiler.start")
    }
    try {
      out[name] = await fn()
    } catch (e) {
      out[name] = { error: String(e).slice(0, 200) }
    }
    if (cdp && profilePath) {
      const { profile } = await cdp.send("Profiler.stop")
      writeFileSync(profilePath, JSON.stringify(profile))
    }
    console.error(name, JSON.stringify(out[name]))
  }

  await scenario("fit", () =>
    page.evaluate(async () => {
      const k = (window as unknown as { __kimo: Hook }).__kimo
      const frames = (window as unknown as { __frames: Frames }).__frames
      k.canvas()?.zoomToFit()
      // Two seconds at rest (progressive recording and rasters fill in), then a slow pan.
      const trace: string[] = []
      const settle = await frames(120, (i) => {
        const s = k.canvas()?.stats()
        if (s && (i < 12 || i % 10 === 0))
          trace.push(
            `${i}: ${Math.round(s.frameMs ?? 0)}ms rec ${s.recorded} ras ${s.rasterized} rep ${s.replayed} draws ${s.drawCalls}`,
          )
      })
      const v = k.session.ui.getState().viewport
      const pan = await frames(120, (i) =>
        k.session.ui.getState().setViewport({ x: v.x + (i * 4) / v.zoom, y: v.y, zoom: v.zoom }),
      )
      return { zoom: +v.zoom.toFixed(4), settle, pan, trace, stats: k.canvas()?.stats() }
    }),
  )

  await scenario("zoom", () =>
    page.evaluate(async () => {
      const k = (window as unknown as { __kimo: Hook }).__kimo
      const frames = (window as unknown as { __frames: Frames }).__frames
      const b = k.canvas()?.layout()?.bounds ?? { x: 0, y: 0, w: 1, h: 1 }
      const v0 = k.session.ui.getState().viewport
      ;(window as unknown as { __fitView?: unknown }).__fitView = v0
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      // Geometric zoom from fit to 100 % about the document center. Each frame's interval is
      // kept with what the renderer did in it, so a slow frame names its cause.
      const rows: Record<string, number>[] = []
      let last = performance.now()
      let at = v0.zoom
      const sum = await frames(150, (i) => {
        const now = performance.now()
        const s = k.canvas()?.stats() as Record<string, number> | undefined
        if (i > 0 && s)
          rows.push({
            i: i - 1,
            ms: Math.round(now - last),
            zoom: +at.toFixed(3),
            drawMs: Math.round(s.frameMs ?? 0),
            recMs: Math.round(s.recordMs ?? 0),
            rasMs: Math.round(s.rasterMs ?? 0),
            rec: s.recorded ?? 0,
            ras: s.rasterized ?? 0,
            draws: s.drawCalls ?? 0,
            nodes: s.nodesDrawn ?? 0,
          })
        last = now
        const zoom = v0.zoom * (1 / v0.zoom) ** ((i + 1) / 150)
        at = zoom
        k.session.ui.getState().setViewport({ x: cx - 720 / zoom, y: cy - 450 / zoom, zoom })
      })
      const total = (key: string) => rows.reduce((n, r) => n + (r[key] ?? 0), 0)
      return {
        ...(sum as object),
        slow: rows.filter((r) => (r.ms ?? 0) > 30),
        every10: rows.filter((r) => (r.i ?? 0) % 10 === 0),
        totals: {
          ms: total("ms"),
          drawMs: total("drawMs"),
          recMs: total("recMs"),
          rasMs: total("rasMs"),
          rec: total("rec"),
          ras: total("ras"),
        },
      }
    }),
  )

  await scenario("zoom-again", () =>
    page.evaluate(async () => {
      const k = (window as unknown as { __kimo: Hook }).__kimo
      const frames = (window as unknown as { __frames: Frames }).__frames
      const b = k.canvas()?.layout()?.bounds ?? { x: 0, y: 0, w: 1, h: 1 }
      const w = window as unknown as { __fitView?: { x: number; y: number; zoom: number } }
      if (w.__fitView) {
        k.session.ui.getState().setViewport(w.__fitView)
        await frames(60, () => {})
      }
      const v0 = k.session.ui.getState().viewport
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      // Geometric zoom from fit to 100 % about the document center.
      return frames(150, (i) => {
        const zoom = v0.zoom * (1 / v0.zoom) ** ((i + 1) / 150)
        k.session.ui.getState().setViewport({ x: cx - 720 / zoom, y: cy - 450 / zoom, zoom })
      })
    }),
  )

  await scenario("pan@1", () =>
    page.evaluate(async () => {
      const k = (window as unknown as { __kimo: Hook }).__kimo
      const frames = (window as unknown as { __frames: Frames }).__frames
      const v = k.session.ui.getState().viewport
      const r = await frames(180, (i) =>
        k.session.ui.getState().setViewport({ x: v.x + i * 24, y: v.y + i * 9, zoom: 1 }),
      )
      k.session.ui.getState().setViewport(v)
      return r
    }),
  )

  // Hover: real pointer moves over the canvas.
  await scenario("hover", async () => {
    const box = await page.locator(".canvas-host canvas").first().boundingBox()
    if (!box) throw new Error("no canvas")
    await page.evaluate(() => (window as unknown as { __record: () => void }).__record())
    for (let i = 0; i < 150; i++)
      await page.mouse.move(box.x + 300 + ((i * 5) % 700), box.y + 200 + ((i * 3) % 400))
    return page.evaluate(() => (window as unknown as { __stop: () => unknown }).__stop())
  })

  // A rect near the middle of the document, centered in the canvas at 100 %.
  const target = await page.evaluate(() => {
    const k = (window as unknown as { __kimo: Hook }).__kimo
    const layout = k.canvas()?.layout()
    const b = layout?.bounds
    if (!layout || !b) return null
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    let best: string | null = null
    let bestD = Number.POSITIVE_INFINITY
    let seen = 0
    for (const [id, l] of layout.nodes) {
      // A sample is enough (and keeps this from scanning a huge document twice).
      if (
        (layout.nodes.size > 200_000 && seen++ % 7 !== 0) ||
        k.session.store.getNode(id)?.type !== "rect"
      )
        continue
      const d = Math.abs(l.world.x - cx) + Math.abs(l.world.y - cy)
      if (d < bestD) {
        bestD = d
        best = id
      }
    }
    const w = best ? layout.nodes.get(best)?.world : null
    if (w)
      k.session.ui
        .getState()
        .setViewport({ x: w.x + w.w / 2 - 720, y: w.y + w.h / 2 - 450, zoom: 1 })
    return best
  })
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )
  out.target = target

  if (target) {
    await scenario("edit", () =>
      page.evaluate(async (id) => {
        const k = (window as unknown as { __kimo: Hook }).__kimo
        const frames = (window as unknown as { __frames: Frames }).__frames
        const first0 = performance.now()
        k.session.store.apply({ op: "update", id, set: { fill: "#00AA55" } }, { origin: "user" })
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        const firstMs = Math.round(performance.now() - first0)
        const r = await frames(90, (i) => {
          k.session.store.apply(
            { op: "update", id, set: { fill: i % 2 ? "#00AA55" : "#AA0055" } },
            { origin: "user" },
          )
        })
        return { firstMs, ...(r as object) }
      }, target),
    )

    await scenario("insert+delete", () =>
      page.evaluate(async (id) => {
        const k = (window as unknown as { __kimo: Hook }).__kimo
        const frames = (window as unknown as { __frames: Frames }).__frames
        const parent = k.session.store.getNode(id)?.parent ?? null
        const made: string[] = []
        const add = await frames(60, (i) => {
          const nid = `benchadd${String(i).padStart(4, "0")}`
          const r = k.session.store.apply(
            {
              op: "insert",
              id: nid,
              parent,
              node: { type: "rect", x: 10 + i, y: 10, w: 20, h: 20, fill: "#22AA66" },
            },
            { origin: "user" },
          )
          if (r.ok) made.push(nid)
        })
        const del = await frames(made.length, (i) => {
          k.session.store.apply({ op: "delete", id: made[i] }, { origin: "user" })
        })
        return { inserted: made.length, add, del }
      }, target),
    )

    await scenario("drag", async () => {
      const box = await page.locator(".canvas-host canvas").first().boundingBox()
      if (!box) throw new Error("no canvas")
      const cx = box.x + 720
      const cy = box.y + 450
      await page.mouse.click(cx, cy)
      await page.mouse.dblclick(cx, cy)
      await page.mouse.move(cx, cy)
      await page.evaluate(() => (window as unknown as { __record: () => void }).__record())
      await page.mouse.down()
      for (let i = 1; i <= 120; i++) await page.mouse.move(cx + i * 2, cy + i)
      await page.mouse.up()
      const r = await page.evaluate(() => (window as unknown as { __stop: () => unknown }).__stop())
      await page.keyboard.press("Meta+z")
      return r
    })

    // Enough small edits to pass the autosave trim size: the compaction runs a second later.
    await scenario("compact", () =>
      page.evaluate(async (id) => {
        const w = window as unknown as { __kimo: Hook; __record: () => void; __stop: () => unknown }
        const k = w.__kimo
        for (let i = 0; i < 600; i++)
          k.session.store.apply(
            { op: "update", id, set: { opacity: 0.5 + (i % 50) / 100 } },
            { origin: "user" },
          )
        await k.session.provider?.flush()
        w.__record()
        await new Promise((r) => setTimeout(r, 4000))
        return { status: k.session.provider?.status, ...(w.__stop() as object) }
      }, target),
    )

    await scenario("undo", () =>
      page.evaluate(async (id) => {
        const k = (window as unknown as { __kimo: Hook }).__kimo
        const frame = () =>
          new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        k.session.store.apply({ op: "update", id, set: { fill: "#3355FF" } }, { origin: "user" })
        await frame()
        const t0 = performance.now()
        k.session.store.undo("user")
        const callMs = performance.now() - t0
        await frame()
        return { callMs: +callMs.toFixed(1), paintedMs: Math.round(performance.now() - t0) }
      }, target),
    )

    // Download: the whole document as .kimo text.
    await scenario("save", () =>
      page.evaluate(async () => {
        const w = window as unknown as {
          __kimo: Hook
          __kimoModules: Record<
            string,
            { exportFile: (...a: unknown[]) => Promise<{ data: Blob }> }
          >
        }
        const mem = () =>
          Math.round(
            ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
              ?.usedJSHeapSize ?? 0) / 1048576,
          )
        const t0 = performance.now()
        const file = await w.__kimoModules["/src/lib/files.ts"]?.exportFile(
          w.__kimo.session.store,
          "bench",
          {},
          (d: unknown) => d,
          false,
        )
        return {
          ms: Math.round(performance.now() - t0),
          fileMB: +((file?.data.size ?? 0) / 1048576).toFixed(1),
          heapAfterMB: mem(),
        }
      }),
    )
  }

  // What the session holds once the save's garbage is collected.
  await scenario("after-save", async () => {
    const c = await context.newCDPSession(page)
    await c.send("HeapProfiler.collectGarbage").catch(() => undefined)
    return page.evaluate(() => ({
      heapMB: Math.round(
        ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? 0) / 1048576,
      ),
    }))
  })

  await scenario("end", () =>
    page.evaluate(() => {
      const k = (window as unknown as { __kimo: Hook }).__kimo
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      return {
        heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : -1,
        // The Skia wasm heap never shrinks: this is its high-water mark.
        wasmMB: Math.round(
          ((k.canvas() as unknown as { renderer: { ck?: { HEAPU8?: Uint8Array } } }).renderer.ck
            ?.HEAPU8?.byteLength ?? 0) / 1048576,
        ),
        stats: k.canvas()?.stats(),
      }
    }),
  )
  await done(0)
} catch (e) {
  out.fatal = String(e).slice(0, 500)
  await done(1)
}
