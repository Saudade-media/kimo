/**
 * Board 37 §9 "File previews" (desing.pen H7PHrz › UJ2qv): Home grid cards show a preview of
 * the file's first frame.
 * - desktop (the real App over the memory platform): an edit + ⌘S renders the preview into the
 *   app-data cache; Home's grid card shows it as an <img> whose pixels are the design's (not
 *   the placeholder); one measured pass of the card image (aspect, radius, object-fit, padding);
 * - web (IndexedDB library): a template file starts with the template's cover; after an edit
 *   the card shows the rendered preview; Delete forever drops it.
 */
import type { Page } from "playwright"
import { disk, open, SITE } from "./m4-app.e2e"
import { type E2EContext, expect, type Scenario } from "./run"

type W = {
  __kimo: { session: { apply(o: unknown): boolean } }
  __kimoApp: {
    platform: { thumbnails: { info(r: string): Promise<{ hash: string } | null> } }
  }
}

const RED = "#E5243B"

/** Adds a red block to Frame00001 / `frame` (one undo step). */
const paintRed = (page: Page, parent: string) => {
  return page.evaluate(
    ([p, fill]) =>
      (window as unknown as W).__kimo.session.apply({
        op: "insert",
        id: "ThumbRed01",
        parent: p,
        node: {
          type: "rect",
          name: "Red",
          position: "absolute",
          x: 0,
          y: 0,
          w: 4000,
          h: 4000,
          fill,
        },
      }),
    [parent, RED] as const,
  )
}

/** Polls `fn` (in Node) until it returns true. */
async function until(fn: () => Promise<boolean>, what: string, timeout = 15_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

/** The library's stored preview row of file `id` (null: none). */
const libraryRow = (page: Page, id: string) =>
  page.evaluate(async (fid) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("kimo-thumbs", 1)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      return await new Promise<{ hash: string } | null>((resolve) => {
        const r = db.transaction("thumbs").objectStore("thumbs").get(fid)
        r.onsuccess = () => resolve((r.result as { hash: string } | undefined) ?? null)
        r.onerror = () => resolve(null)
      })
    } finally {
      db.close()
    }
  }, id)

/** Pixels of a loaded <img>: size, share of RED-ish pixels, distinct colors (sampled). */
const imagePixels = (page: Page, selector: string) =>
  page.evaluate(async (sel) => {
    const img = document.querySelector(sel) as HTMLImageElement | null
    if (!img) return null
    if (!img.complete) await img.decode().catch(() => {})
    const c = document.createElement("canvas")
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const g = c.getContext("2d")
    if (!g || !c.width) return null
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let red = 0
    let n = 0
    const colors = new Set<string>()
    for (let i = 0; i < d.length; i += 4 * 97) {
      n++
      const [r, gg, b, a] = [d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0, d[i + 3] ?? 0]
      if (a > 200 && r > 200 && gg < 80 && b < 90) red++
      colors.add(`${r >> 4},${gg >> 4},${b >> 4},${a >> 4}`)
    }
    return { w: img.naturalWidth, h: img.naturalHeight, red: red / n, colors: colors.size }
  }, selector)

/** One measured pass of a grid card with a preview (board 37 hVoFQ). */
async function measureCard(ctx: E2EContext, card: string) {
  const m = await ctx.page.evaluate((sel) => {
    const thumb = document.querySelector(`${sel} .kimo-file-card__thumbnail`) as HTMLElement
    const img = document.querySelector(`${sel} .kimo-file-card__image`) as HTMLImageElement
    const t = thumb.getBoundingClientRect()
    const i = img.getBoundingClientRect()
    const ts = getComputedStyle(thumb)
    const is = getComputedStyle(img)
    const probe = document.createElement("div")
    probe.style.borderRadius = "var(--kimo-radius-xl)"
    document.body.append(probe)
    const radiusXl = getComputedStyle(probe).borderTopLeftRadius
    probe.remove()
    return {
      thumb: { w: t.width, h: t.height, radius: ts.borderTopLeftRadius, padding: ts.padding },
      overflow: ts.overflow,
      radiusXl,
      img: {
        w: i.width,
        h: i.height,
        dx: i.left - t.left,
        dy: i.top - t.top,
        fit: is.objectFit,
        position: is.objectPosition,
        loading: img.loading,
        display: is.display,
      },
      miniFrames: document.querySelectorAll(`${sel} .kimo-file-card__mini-frame`).length,
    }
  }, card)
  ctx.log("card preview measured", JSON.stringify(m))
  expect(
    Math.abs(m.thumb.w / m.thumb.h - 260 / 164) < 0.01,
    `aspect 260:164: ${m.thumb.w}×${m.thumb.h}`,
  )
  expect(m.thumb.radius === m.radiusXl, `radius-xl: ${m.thumb.radius} vs ${m.radiusXl}`)
  expect(m.thumb.padding === "0px", `padding 0: ${m.thumb.padding}`)
  expect(m.overflow === "hidden", `clip: ${m.overflow}`)
  expect(
    Math.abs(m.img.w - m.thumb.w) < 0.5 && Math.abs(m.img.h - m.thumb.h) < 0.5,
    `img fills the thumbnail: ${m.img.w}×${m.img.h} in ${m.thumb.w}×${m.thumb.h}`,
  )
  expect(m.img.dx === 0 && m.img.dy === 0, `img at the thumbnail origin: ${m.img.dx},${m.img.dy}`)
  expect(m.img.fit === "cover", `object-fit: ${m.img.fit}`)
  expect(m.img.position === "50% 50%", `object-position: ${m.img.position}`)
  expect(m.img.loading === "lazy", `lazy img: ${m.img.loading}`)
  expect(m.img.display !== "none", "img shown")
  expect(m.miniFrames === 0, "the Mini Frame placeholder is hidden")
}

export const scenarios: Scenario[] = [
  {
    name: "thumbnails desktop: ⌘S renders the preview; Home's grid card shows it",
    async run(ctx) {
      const { page } = ctx
      const ref = `${SITE}/home.kimo`
      await open(ctx, disk(ref))
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      await page.locator(".canvas-host canvas").first().waitFor({ timeout: 15_000 })
      const info = () =>
        page.evaluate((r) => (window as unknown as W).__kimoApp.platform.thumbnails.info(r), ref)
      // Opening a file without a preview renders one once the editor is idle.
      await until(async () => !!(await info()), "the preview written on open")
      const first = (await info())?.hash
      expect(!!first, "preview written on open")

      // An edit + ⌘S: a new content hash → a new preview.
      expect(await paintRed(page, "Frame00001"), "edit applied")
      await page.locator(".canvas-host").click({ position: { x: 20, y: 20 } })
      await page.keyboard.press("Meta+s")
      await page.waitForFunction(
        () => document.querySelector(".kimo-save-status")?.getAttribute("data-status") === "saved",
        undefined,
        { timeout: 10_000 },
      )
      await until(async () => (await info())?.hash !== first, "a new preview after ⌘S")

      await page.evaluate(() => {
        location.hash = "#/all"
      })
      await page.getByRole("radio", { name: "Grid view" }).click()
      const card = `.kimo-file-card[data-file="${ref}"]`
      await page.locator(`${card} img.kimo-file-card__image`).waitFor({ timeout: 10_000 })
      const px = await imagePixels(page, `${card} img.kimo-file-card__image`)
      ctx.log("desktop preview pixels", JSON.stringify(px))
      expect(px && px.w === 520 && px.h === 328, `520×328 preview: ${px?.w}×${px?.h}`)
      expect(px && px.red > 0.5, `the design's red fill shows: ${px?.red}`)
      // A card without a preview keeps the placeholder.
      const others = await page.evaluate(
        (r) =>
          [...document.querySelectorAll(".kimo-file-card")].filter(
            (c) => c.getAttribute("data-file") !== r && !c.querySelector("img"),
          ).length,
        ref,
      )
      expect(others > 0, "files without a preview keep the placeholder")
      await measureCard(ctx, card)
      if (ctx.shots) await page.screenshot({ path: `${ctx.shots}/thumbnails-desktop.png` })
    },
  },
  {
    name: "thumbnails web: template cover first, rendered preview after an edit, gone on delete",
    async run(ctx) {
      const { page, url } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto(`${url}#/templates`)
      await page.locator('[data-template="saas-app"]').waitFor({ timeout: 15_000 })
      await page
        .locator('[data-template="saas-app"]')
        .getByRole("button", { name: /Use the/ })
        .click()
      await page.waitForFunction(() => location.hash.startsWith("#/file/"), undefined, {
        timeout: 15_000,
      })
      const id = await page.evaluate(() => location.hash.slice("#/file/".length))
      await page.goto(`${url}#/all`)
      const card = `.kimo-file-card[data-file-id="${id}"]`
      const img = `${card} img.kimo-file-card__image`
      await page.locator(img).waitFor({ timeout: 15_000 })
      const cover = await imagePixels(page, img)
      ctx.log("template cover", JSON.stringify(cover))
      expect(cover && cover.w === 720 && cover.h === 450, `the template cover: ${cover?.w}`)
      expect(cover && cover.colors > 8, "a real image, not a flat fill")

      // Open, edit (a red block over the first frame), back Home: the rendered preview.
      await page.goto(`${url}#/file/${id}`)
      await page.locator(".canvas-host canvas").first().waitFor({ timeout: 20_000 })
      // The first page's first top-level frame (pages sorted by `order`).
      const frame = await page.evaluate(() => {
        const k = (window as unknown as { __kimo: { session: { store: unknown } } }).__kimo
        const s = k.session.store as {
          toHeader(): { pages?: Record<string, { order: string }> }
          children(p: string | null): string[]
          getNode(i: string): { type: string; page?: string } | undefined
        }
        const pages = Object.entries(s.toHeader().pages ?? {}).sort((a, b) =>
          a[1].order < b[1].order ? -1 : 1,
        )
        const first = pages[0]?.[0]
        return (
          s
            .children(null)
            .find(
              (r) => s.getNode(r)?.type === "frame" && (!first || s.getNode(r)?.page === first),
            ) ?? null
        )
      })
      expect(!!frame, "the template has a frame")
      expect(await paintRed(page, frame as string), "edit applied")
      await until(
        async () => {
          const row = await libraryRow(page, id)
          return !!row && !row.hash.startsWith("template:")
        },
        "the rendered preview replaces the cover",
        20_000,
      )
      await page.goto(`${url}#/all`)
      await page.locator(img).waitFor({ timeout: 15_000 })
      await page.waitForFunction(
        (sel) => (document.querySelector(sel) as HTMLImageElement | null)?.naturalWidth === 520,
        img,
        { timeout: 10_000 },
      )
      const px = await imagePixels(page, img)
      ctx.log("web preview pixels", JSON.stringify(px))
      expect(px && px.w === 520 && px.h === 328, `520×328: ${px?.w}×${px?.h}`)
      expect(px && px.red > 0.5, `the design's red fill shows: ${px?.red}`)
      await measureCard(ctx, card)
      if (ctx.shots) await page.screenshot({ path: `${ctx.shots}/thumbnails-web.png` })

      // Move to Trash, then Delete forever: the preview goes with the file.
      await page.locator(card).click({ button: "right" })
      await page.locator('.home-menu [data-item="trash"]').click()
      await page.locator(card).waitFor({ state: "detached" })
      await page.locator('a.home-nav[href="#/trash"]').click()
      const row = page.locator("[data-trash]").first()
      await row.waitFor({ timeout: 10_000 })
      await row.getByRole("button", { name: /forever/ }).click()
      await page.getByRole("dialog").getByRole("button", { name: "Delete forever" }).click()
      await until(async () => (await libraryRow(page, id)) === null, "the preview deleted")
    },
  },
]
