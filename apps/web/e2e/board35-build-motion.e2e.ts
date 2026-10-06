/**
 * Board 35 "Agent build motion" (IASl0) in the real editor: an MCP-origin insert into an
 * auto-layout page grows in (frames sampled while it plays: opacity, scale and rise against the
 * keyframes, the footer sliding 56 px, pixels moving from the page fill to the layer's fill),
 * ends on exactly the pixels of the same insert made by the user (which draws at once), a
 * 30-layer batch staggers 13.8 ms apart and ends by 600 ms, and with prefers-reduced-motion
 * nothing moves.
 */
import type { Page } from "playwright"
import { settle } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type Box = { x: number; y: number; w: number; h: number }
type Motion = { opacity?: number; dx?: number; dy?: number; scale?: number; w?: number; h?: number }
type Sample = { t: number; m: Record<string, Motion> | null; px: number[][]; has: boolean }
interface Hook {
  session: {
    store: {
      apply(ops: unknown, opts: { origin: string }): unknown
      getNode(id: string): Record<string, unknown> | undefined
    }
    ui: { getState(): { setViewport(v: object): void } }
  }
  canvas(): {
    layout(): { nodes: Map<string, { world: Box }> } | null
    renderer: {
      render(): void
      setMotion?(m: Map<string, Motion> | null): void
    } | null
  } | null
}
declare const window: Window & {
  __kimo: Hook
  __b35?: {
    samples: Sample[]
    points: { x: number; y: number }[]
    motionCalls: number
    watch: string
  }
}

/** Board 35 values (rules x9R37b). */
const DUR = 200
const STAGGER_30 = 400 / 29

function ease(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const [x1, y1, x2, y2] = [0.2, 0, 0, 1]
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  let lo = 0
  let hi = 1
  let t = x
  for (let i = 0; i < 40; i++) {
    const v = ((ax * t + bx) * t + cx) * t
    if (v < x) lo = t
    else hi = t
    t = (lo + hi) / 2
  }
  return ((ay * t + by) * t + cy) * t
}

const pageFrame = (id: string, x: number) => [
  {
    op: "insert",
    id,
    parent: null,
    node: {
      type: "frame",
      name: "Page",
      x,
      y: 0,
      w: 220,
      fill: "#F2F2F2",
      layout: { dir: "column", gap: 8, pad: 12 },
    },
  },
  ...(
    [
      ["Hero", 56],
      ["Features", 40],
      ["Footer", 28],
    ] as const
  ).map(([name, h], i) => ({
    op: "insert",
    id: `${id}${name}`,
    parent: id,
    node: { type: "rect", name, w: { mode: "fill" }, h, fill: "#C8CDD4" },
    index: i,
  })),
]

const pricing = (id: string) => ({
  op: "insert",
  id: `${id}Pricing`,
  parent: id,
  index: 2,
  node: { type: "rect", name: "Pricing", w: { mode: "fill" }, h: 48, fill: "#2563EB" },
})

async function open(page: Page, url: string) {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(url)
  await page.getByRole("button", { name: "New file" }).first().click()
  await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
  await settle(page)
  await page.evaluate(() =>
    window.__kimo.session.ui.getState().setViewport({ x: -40, y: -40, zoom: 1 }),
  )
  await settle(page)
}

/**
 * Records every drawn frame: the motion the canvas handed the renderer and the canvas pixels at
 * `points` (world, zoom 1, viewport -40, -40), read right after the draw.
 */
async function arm(page: Page, points: { x: number; y: number }[], watch = "") {
  await page.evaluate(
    ({ pts, watch }) => {
      const r = window.__kimo.canvas()?.renderer as unknown as Record<string, unknown>
      const gl = document.querySelector(".canvas-host__canvas") as HTMLCanvasElement
      const c2 = document.createElement("canvas")
      c2.width = 1
      c2.height = 1
      const g2 = c2.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D
      const state = { samples: [] as Sample[], points: pts, motionCalls: 0, watch }
      window.__b35 = state
      let current: Record<string, Motion> | null = null
      let at = 0
      const proto = Object.getPrototypeOf(r)
      const setMotion = proto.setMotion as (m: Map<string, Motion> | null) => void
      const render = proto.render as () => void
      r.setMotion = function (m: Map<string, Motion> | null) {
        if (m) state.motionCalls++
        at = performance.now()
        current = m ? Object.fromEntries([...m].map(([k, v]) => [k, { ...v }])) : null
        setMotion.call(this, m)
      }
      r.render = function () {
        render.call(this)
        const dpr = gl.width / gl.clientWidth
        const px = state.points.map((p) => {
          g2.clearRect(0, 0, 1, 1)
          g2.drawImage(
            gl,
            Math.round((p.x + 40) * dpr),
            Math.round((p.y + 40) * dpr),
            1,
            1,
            0,
            0,
            1,
            1,
          )
          return [...g2.getImageData(0, 0, 1, 1).data]
        })
        // A motion frame's time is when the canvas computed it (just before the draw).
        // `has`: the drawn layout already holds the watched (new) layer.
        const lay = (this as unknown as { layout: { nodes: Map<string, unknown> } | null }).layout
        const has = !!lay?.nodes.has(state.watch)
        state.samples.push({ t: current ? at : performance.now(), m: current, px, has })
      }
    },
    { pts: points, watch },
  )
}

async function samples(page: Page): Promise<{ samples: Sample[]; motionCalls: number }> {
  return page.evaluate(() => {
    const s = window.__b35 as NonNullable<typeof window.__b35>
    const out = { samples: s.samples.slice(), motionCalls: s.motionCalls }
    s.samples.length = 0
    s.motionCalls = 0
    return out
  })
}

const applyAs = (page: Page, ops: unknown[], origin: string) =>
  page.evaluate(
    ({ ops, origin }) => {
      const r = window.__kimo.session.store.apply(ops, { origin }) as { ok?: boolean }
      if (r && r.ok === false) throw new Error(`apply failed: ${JSON.stringify(r).slice(0, 400)}`)
    },
    { ops, origin },
  )

const wait = (page: Page, ms: number) => page.waitForTimeout(ms)

export const scenarios: Scenario[] = [
  {
    name: "board 35: an MCP insert grows in; the user's insert is instant; finals match",
    async run({ page, url, log }: E2EContext) {
      await open(page, url)
      // Two identical pages: A gets the MCP insert, B the user's.
      await applyAs(page, [...pageFrame("pageAa", 0), ...pageFrame("pageBb", 400)], "user")
      await settle(page)
      // Pricing center (12 + 98, 124 + 24) in each page; footer at y 180 after the insert.
      const pts = [
        { x: 110, y: 148 },
        { x: 510, y: 148 },
      ]
      await arm(page, pts, "pageBbPricing")

      // The user's insert: drawn final in its first frame, no motion at all.
      await applyAs(page, [pricing("pageBb")], "user")
      await settle(page)
      const user = await samples(page)
      expect(user.motionCalls === 0, `user insert set motion ${user.motionCalls}×`)
      const firstB = user.samples.find((x) => x.has)?.px[1] ?? []
      expect(
        Math.abs((firstB[0] ?? 0) - 0x25) <= 3 && Math.abs((firstB[2] ?? 0) - 0xeb) <= 3,
        `user insert first frame ${firstB}`,
      )

      // The MCP insert.
      await applyAs(page, [pricing("pageAa")], "mcp:e2e.b35")
      await wait(page, 700)
      await settle(page)
      const mcp = await samples(page)
      const moving = mcp.samples.filter((s) => s.m?.pageAaPricing)
      log(`mcp insert: ${mcp.samples.length} frames, ${moving.length} with motion`)
      expect(moving.length >= 2, `frames with motion ${moving.length}`)
      const t0 = moving[0]?.t ?? 0
      const first = moving[0]?.m ?? {}
      // Keyframe t = 0 (Y4NcI): opacity 0, scale 0.96, y +6; the footer starts 56 higher.
      // (The first frame is drawn in the same task as the layout, microseconds after the start.)
      const near = (a: number | undefined, b: number, tol = 0.01) =>
        Math.abs((a ?? Number.NaN) - b) < tol
      expect(near(first.pageAaPricing?.opacity, 0), `t0 opacity ${first.pageAaPricing?.opacity}`)
      expect(
        near(first.pageAaPricing?.scale, 0.96, 0.001),
        `t0 scale ${first.pageAaPricing?.scale}`,
      )
      expect(near(first.pageAaPricing?.dy, 6, 0.05), `t0 rise ${first.pageAaPricing?.dy}`)
      expect(near(first.pageAaFooter?.dy, -56, 0.5), `t0 footer ${first.pageAaFooter?.dy}`)
      expect(near(first.pageAa?.h, 164, 0.5), `t0 page h ${first.pageAa?.h}`)
      // Measured pass vs the keyframes: each frame's values on the 200 ms curve.
      let prevOpacity = -1
      let prevRed = 999
      const reds: number[] = []
      for (const s of moving) {
        const dt = s.t - t0
        const k = ease(dt / DUR)
        const p = s.m?.pageAaPricing ?? {}
        const o = p.opacity ?? 1
        expect(o >= prevOpacity - 1e-9, `opacity rises (${prevOpacity} → ${o})`)
        prevOpacity = o
        expect(
          Math.abs(o - k) < 0.08,
          `opacity ${o.toFixed(3)} vs eased ${k.toFixed(3)} at ${dt.toFixed(0)} ms`,
        )
        expect(Math.abs((p.scale ?? 1) - (0.96 + 0.04 * o)) < 1e-6, `scale ${p.scale}`)
        expect(Math.abs((p.dy ?? 0) - 6 * (1 - o)) < 1e-6, `rise ${p.dy}`)
        const fy = s.m?.pageAaFooter?.dy ?? 0
        expect(Math.abs(fy + 56 * (1 - o)) < 0.02, `footer ${fy} at opacity ${o}`)
        const red = s.px[0]?.[0] ?? 0
        expect(red <= prevRed + 3, `pixel moves toward the fill (${prevRed} → ${red})`)
        prevRed = red
        reds.push(red)
      }
      log(`pricing center red over frames: ${reds.join(" ")}`)
      // Headless frames come 15–70 ms apart: at least one lands mid-entrance.
      const mid = moving.filter((x) => {
        const o = x.m?.pageAaPricing?.opacity ?? 1
        return o > 0.05 && o < 0.95
      })
      expect(mid.length >= 1, `in-between frames ${mid.length}`)
      for (const x of mid) {
        // Where the sliding footer has cleared the center: Pricing at its opacity over #F2F2F2.
        if (180 + (x.m?.pageAaFooter?.dy ?? 0) <= 150) continue
        const o = x.m?.pageAaPricing?.opacity ?? 1
        const red = x.px[0]?.[0] ?? 0
        const want = o * 0x25 + (1 - o) * 0xf2
        expect(
          Math.abs(red - want) <= 8,
          `in-between pixel ${red} vs ${want.toFixed(0)} at opacity ${o.toFixed(3)}`,
        )
      }
      const lastMoving = moving[moving.length - 1]?.t ?? 0
      expect(lastMoving - t0 <= DUR + 1, `entrance lasted ${(lastMoving - t0).toFixed(0)} ms`)
      // Final: motion cleared, A matches B (the user's instant insert) pixel for pixel.
      const fin = mcp.samples[mcp.samples.length - 1]
      expect(fin && fin.m === null, "final frame has no motion")
      // A grid inside both pages (the new file's sample design sits around them), one fresh draw.
      const grid: { x: number; y: number }[] = []
      for (let y = 2; y < 220; y += 6)
        for (let x = 2; x < 220; x += 6) grid.push({ x, y }, { x: x + 400, y })
      const px = await page.evaluate((g) => {
        const s = window.__b35 as NonNullable<typeof window.__b35>
        s.points = g
        window.__kimo.canvas()?.renderer?.render()
        return s.samples[s.samples.length - 1]?.px ?? []
      }, grid)
      let diff = 0
      for (let i = 0; i < px.length; i += 2) {
        const a = px[i] ?? []
        const b = px[i + 1] ?? []
        if (a.some((v, j) => Math.abs(v - (b[j] ?? 0)) > 2)) {
          diff++
          log(`differs at ${JSON.stringify(grid[i])}: ${a} vs ${b}`)
        }
      }
      expect(px.length === grid.length, `grid ${px.length}`)
      expect(diff === 0, `${diff} of ${px.length / 2} final pixels differ from the user's insert`)
      // The document never held an in-between value.
      const doc = await page.evaluate(() => window.__kimo.session.store.getNode("pageAaPricing"))
      expect(doc?.h === 48 && doc.opacity === undefined, `document ${JSON.stringify(doc)}`)
    },
  },
  {
    name: "board 35: a 30-layer MCP batch staggers 13.8 ms apart and ends by 600 ms",
    async run({ page, url, log }: E2EContext) {
      await open(page, url)
      await applyAs(
        page,
        [
          {
            op: "insert",
            id: "batchRoot",
            parent: null,
            node: {
              type: "frame",
              name: "Batch",
              x: 0,
              y: 0,
              w: 300,
              fill: "#FFFFFF",
              layout: { dir: "column", gap: 2, pad: 4 },
            },
          },
        ],
        "user",
      )
      await settle(page)
      await arm(page, [])
      const ops = Array.from({ length: 30 }, (_, i) => ({
        op: "insert",
        id: `b35layer${String(i).padStart(2, "0")}`,
        parent: "batchRoot",
        index: i,
        node: { type: "rect", name: `Layer ${i + 1}`, w: { mode: "fill" }, h: 6, fill: "#2563EB" },
      }))
      await applyAs(page, ops, "mcp:e2e.batch")
      await wait(page, 900)
      await settle(page)
      const { samples: s } = await samples(page)
      const moving = s.filter((x) => x.m && Object.keys(x.m).some((k) => k.startsWith("b35layer")))
      const t0 = moving[0]?.t ?? 0
      const end = (moving[moving.length - 1]?.t ?? 0) - t0
      log(`batch: ${moving.length} frames with motion over ${end.toFixed(0)} ms`)
      expect(end <= 601, `batch window ${end.toFixed(0)} ms`)
      // It never ends early: the first frame without motion comes after 600 ms (frames can be
      // far apart on a loaded headless GPU, so the last motion frame may be well before 600).
      const after = s.find((x) => x.t > t0 && x.m === null)
      expect(
        after && after.t - t0 >= 600,
        `motion ended at ${after ? (after.t - t0).toFixed(0) : "?"} ms`,
      )
      for (const f of moving) {
        const dt = f.t - t0
        for (let i = 0; i < 30; i++) {
          const id = `b35layer${String(i).padStart(2, "0")}`
          const want = ease((dt - i * STAGGER_30) / DUR)
          const m = f.m?.[id]
          const got = m ? (m.opacity ?? 1) : 1
          if (want >= 0.999 && !m) continue
          expect(
            Math.abs(got - want) < 0.1,
            `${id} at ${dt.toFixed(0)} ms: ${got.toFixed(3)} vs ${want.toFixed(3)}`,
          )
        }
      }
      expect(s[s.length - 1]?.m === null, "batch ends with no motion")
    },
  },
  {
    name: "board 35: prefers-reduced-motion draws the final state at once",
    async run({ page, url }: E2EContext) {
      await page.emulateMedia({ reducedMotion: "reduce" })
      await open(page, url)
      await applyAs(page, pageFrame("pageRr", 0), "user")
      await settle(page)
      await arm(page, [{ x: 110, y: 148 }], "pageRrPricing")
      await applyAs(page, [pricing("pageRr")], "mcp:e2e.reduced")
      await settle(page)
      const r = await samples(page)
      expect(r.motionCalls === 0, `reduced motion set motion ${r.motionCalls}×`)
      const p = r.samples.find((x) => x.has)?.px[0] ?? []
      expect(Math.abs((p[0] ?? 0) - 0x25) <= 3, `first frame ${p}`)
      await page.emulateMedia({ reducedMotion: null })
    },
  },
]
