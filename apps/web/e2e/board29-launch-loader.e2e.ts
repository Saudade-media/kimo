/**
 * Board 29 "Launch loader" (desing.pen vIK2m). The app bundle is held back with a route gate so
 * the static loader in index.html can be measured before any app JS runs; then the gate opens
 * and the layer must fade (is-leaving, 180 ms) and leave the DOM once React has mounted.
 *
 * Node values (Launch Screen · web BKYEu/G0BNYu/kD1jZ):
 *   Launch Screen: column, justify + align center, fill $bg-app (light #FFFFFF / dark #0A0A0A).
 *   Center (E3aNK7): column, gap 16, align center. Mark (z5TGCg) KimoLogo 64 × 64, $text-primary.
 *   Status (VnVK0): $font-mono $text-xs 11, line-height 1.45, $text-tertiary (#9A9DA2 / #6B6B6B).
 *   Motion: 1600 ms loop, 500 ms → rotate 90° scale 0.88, 1000 ms → 180° scale 1.
 *   Status opacity 0 until 3000 ms, then 200 ms → 1. Reduced motion: pulse 2400 ms.
 */
import type { Page, Route } from "playwright"
import { type Box, checker, measure } from "./board25-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

/** Holds every app entry/chunk request (`assets/index-*.js`) until `open()`. */
async function gateBundle(page: Page) {
  let open!: () => void
  const gate = new Promise<void>((r) => {
    open = r
  })
  await page.route(/\/assets\/index-[^/]*\.js$/, async (route: Route) => {
    await gate
    await route.continue()
  })
  return { open }
}

const LOADER = {
  launch: "#kimo-launch",
  center: "#kimo-launch .kimo-launch__center",
  mark: "#kimo-launch .kimo-launch__mark",
  status: "#kimo-launch .kimo-launch__status",
}

/** One measured pass of the loader against the node values for one theme. */
async function measureLoader(ctx: E2EContext, surface: string, dark: boolean) {
  const { page } = ctx
  const { check, box, flush } = checker(ctx, surface)
  const m = await measure(page, LOADER)
  const g = (k: string) => m[k] as Box
  const vw = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
  box("Launch Screen", g("launch"), {
    w: vw.w,
    h: vw.h,
    dir: "column",
    justify: "center",
    align: "center",
    bg: dark ? "rgb(10, 10, 10)" : "rgb(255, 255, 255)",
    color: dark ? "rgb(245, 245, 244)" : "rgb(10, 10, 10)",
    opacity: "1",
  })
  box("Center E3aNK7", g("center"), { dir: "column", align: "center", gap: 16 })
  // The mark turns and pulses (scale) from the first frame, so its bounding box is the rotated
  // one: read its size from layout, and its position from its center (the transform origin).
  const markSize = await page.evaluate((sel) => {
    const cs = getComputedStyle(document.querySelector(sel) as Element)
    return { w: parseFloat(cs.width), h: parseFloat(cs.height) }
  }, LOADER.mark)
  check("Mark z5TGCg", "w", markSize.w, 64)
  check("Mark z5TGCg", "h", markSize.h, 64)
  const mark = g("mark")
  const markTop = mark.y + mark.h / 2 - 32
  box("Status VnVK0", g("status"), {
    fs: 11,
    h: 11 * 1.45,
    fw: "400",
    ff: "JetBrains Mono",
    color: dark ? "rgb(107, 107, 107)" : "rgb(154, 157, 162)",
    opacity: "0",
  })
  // Center is centred in the window; the mark sits at its top, the status 16 below.
  const c = g("center")
  const centerH = 64 + 16 + 11 * 1.45
  check("Center", "h", c.h, centerH)
  check("Center", "y (centred)", c.y, (vw.h - centerH) / 2)
  check("Mark", "x (centred)", mark.x + mark.w / 2 - 32, (vw.w - 64) / 2)
  check("Status", "y = mark + 64 + 16", g("status").y - markTop, 80)
  // The mark's fill is currentColor = $text-primary.
  const fill = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector("#kimo-launch .kimo-launch__mark path") as Element)
        .fill,
  )
  check("Mark path", "fill", fill, dark ? "rgb(245, 245, 244)" : "rgb(10, 10, 10)")
  flush()
}

/** The mark's running animation, sampled at `t` ms (paused there). */
const sampleMark = (page: Page, t: number) =>
  page.evaluate((ms) => {
    const el = document.querySelector("#kimo-launch .kimo-launch__mark") as Element
    const a = el.getAnimations()[0] as CSSAnimation | undefined
    if (!a) return null
    a.pause()
    a.currentTime = ms
    const timing = a.effect?.getComputedTiming()
    return {
      name: a.animationName,
      duration: timing?.duration,
      iterations: timing?.iterations,
      transform: getComputedStyle(el).transform,
      opacity: getComputedStyle(el).opacity,
    }
  }, t)

/** Parses `matrix(a, b, c, d, e, f)` → rotation (deg, clockwise) and scale. */
function decompose(m: string): { deg: number; scale: number } {
  if (m === "none") return { deg: 0, scale: 1 }
  const [a, b] = (m.match(/-?[\d.e-]+/g) ?? []).map(Number) as [number, number]
  return { deg: (Math.atan2(b, a) * 180) / Math.PI, scale: Math.hypot(a, b) }
}

export const scenarios: Scenario[] = [
  {
    name: "board29: loader before mount (light, measured), turn keyframes, status at 3 s, fade out after mount",
    async run(ctx) {
      const { page, url } = ctx
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" })
      const gate = await gateBundle(page)
      await page.goto(url, { waitUntil: "commit" })
      await page.locator(LOADER.mark).waitFor()
      // No app JS has run: #root is still empty, the loader is the only thing on screen.
      const before = await page.evaluate(() => ({
        root: document.getElementById("root")?.childElementCount,
        theme: document.documentElement.dataset.theme ?? null,
      }))
      expect(before.root === 0, `#root is empty before the bundle (got ${before.root})`)
      expect(before.theme === null, `no stored theme → no data-theme (got ${before.theme})`)
      await measureLoader(ctx, "Launch loader · light · before mount", false)

      const { check, flush } = checker(ctx, "Launch loader · motion")
      for (const [t, deg, scale] of [
        [0, 0, 1],
        [500, 90, 0.88],
        [1000, 180, 1],
        [1300, 180, 1],
      ] as const) {
        const s = await sampleMark(page, t)
        expect(s, "the mark is animated")
        if (!s) continue
        check(`Mark @${t} ms`, "animation", s.name, "kimo-launch-turn")
        check(`Mark @${t} ms`, "duration", s.duration as number, 1600)
        const d = decompose(s.transform)
        check(`Mark @${t} ms`, "rotate°", Math.abs(d.deg), deg, 0.5)
        check(`Mark @${t} ms`, "scale", d.scale, scale, 0.005)
      }
      // Status: opacity 0 until 3000 ms, 1 from 3200 ms (200 ms ease-out).
      const statusAt = (ms: number) =>
        page.evaluate((t) => {
          const el = document.querySelector("#kimo-launch .kimo-launch__status") as Element
          const a = el.getAnimations()[0] as CSSAnimation
          a.pause()
          a.currentTime = t
          return { name: a.animationName, opacity: getComputedStyle(el).opacity }
        }, ms)
      check("Status @2900 ms", "opacity", (await statusAt(2900)).opacity, "0")
      check("Status @3300 ms", "opacity", (await statusAt(3300)).opacity, "1")
      flush()

      // Open the gate: React mounts, the loader fades (is-leaving: opacity 1 → 0, 180 ms ease-out)
      // and is removed. The fade is a compositor transition; removal waits for transitionend or
      // the 400 ms fallback, whichever the (busy, first-mount) main thread gets to first.
      type Exit = { root?: number; run?: string; removed?: boolean }
      await page.evaluate(() => {
        const w = window as unknown as { __exit: Exit }
        w.__exit = {}
        const el = document.getElementById("kimo-launch") as HTMLElement
        el.addEventListener("transitionrun", (e) => {
          const cs = getComputedStyle(el)
          w.__exit.root = document.getElementById("root")?.childElementCount
          w.__exit.run = `${e.propertyName} ${cs.transitionDuration} ${cs.transitionTimingFunction} → ${cs.opacity === "1" ? "from 1" : cs.opacity} pe=${cs.pointerEvents}`
        })
        new MutationObserver(() => {
          if (!el.isConnected) w.__exit.removed = true
        }).observe(document.body, { childList: true })
      })
      gate.open()
      await page.getByRole("heading", { name: "Recents" }).waitFor()
      await page.waitForFunction(() => !document.getElementById("kimo-launch"))
      const exit = await page.evaluate(() => (window as unknown as { __exit: Exit }).__exit)
      const x = checker(ctx, "Launch loader · exit")
      x.check(
        "Launch Screen",
        "exit transition",
        exit.run,
        "opacity 0.18s ease-out → from 1 pe=none",
      )
      x.check(
        "#root at exit",
        "children > 0",
        (exit.root ?? 0) > 0 ? "mounted" : "empty",
        "mounted",
      )
      x.check("Launch Screen", "removed", exit.removed ? "yes" : "no", "yes")
      x.flush()
    },
  },
  {
    name: "board29: dark (system) and stored theme override; reduced motion pulses",
    async run(ctx) {
      const { page, url } = ctx
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" })
      const gate = await gateBundle(page)
      await page.goto(url, { waitUntil: "commit" })
      await page.locator(LOADER.mark).waitFor()
      await measureLoader(ctx, "Launch loader · dark (prefers-color-scheme) · before mount", true)
      const { check, flush } = checker(ctx, "Launch loader · reduced motion")
      for (const [t, opacity] of [
        [0, 1],
        [1200, 0.6],
        [2400, 1],
      ] as const) {
        const s = await sampleMark(page, t)
        expect(s, "the mark pulses")
        if (!s) continue
        check(`Mark @${t} ms`, "animation", s.name, "kimo-launch-pulse")
        check(`Mark @${t} ms`, "duration", s.duration as number, 2400)
        check(`Mark @${t} ms`, "transform", s.transform, "none")
        check(`Mark @${t} ms`, "opacity", Number(s.opacity), opacity, 0.01)
      }
      flush()

      // A stored light theme (lib/theme "kimo.theme") wins over the dark system via launch.js.
      await page.addInitScript(() => localStorage.setItem("kimo.theme", "light"))
      await page.goto(url, { waitUntil: "commit" })
      await page.locator(LOADER.mark).waitFor()
      const theme = await page.evaluate(() => document.documentElement.dataset.theme)
      expect(theme === "light", `launch.js applied the stored theme (got ${theme})`)
      await measureLoader(ctx, "Launch loader · stored light over dark system", false)
      gate.open()
      await page.getByRole("heading", { name: "Recents" }).waitFor()
      await page.waitForFunction(() => !document.getElementById("kimo-launch"))
    },
  },
  {
    name: "board29: the document host (#/host) never renders the loader",
    async run(ctx) {
      const { page, url } = ctx
      await gateBundle(page)
      await page.goto(`${url}#/host`, { waitUntil: "commit" })
      await page.locator(LOADER.launch).waitFor({ state: "attached" })
      const s = await page.evaluate(() => ({
        flag: document.documentElement.dataset.launch,
        display: getComputedStyle(document.getElementById("kimo-launch") as Element).display,
        animations: document.getAnimations().length,
      }))
      expect(s.flag === "off", `data-launch=off (got ${s.flag})`)
      expect(s.display === "none", `display none (got ${s.display})`)
      expect(s.animations === 0, `no running animations (got ${s.animations})`)
    },
  },
]
