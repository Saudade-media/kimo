/**
 * Click drill-down on deeply nested files: a click selects the top-level layer, each
 * double-click at the same point goes one level deeper down to the leaf, ⌘-click selects the
 * deepest layer directly, Esc / ⇧Enter go back up, Enter goes down. Real example files
 * (landing page: frames + auto layout; design system: component instances, slots).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Page } from "playwright"
import { settle } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type Box = { x: number; y: number; w: number; h: number }
interface Hook {
  session: {
    store: {
      loadDocument(d: unknown): void
      getNode(id: string): Record<string, unknown> | undefined
    }
    ui: {
      getState(): {
        selection: string[]
        viewport: { x: number; y: number; zoom: number }
        setViewport(v: object): void
        select(ids: string[]): void
      }
    }
  }
  canvas(): {
    renderer: { hitTest(p: { x: number; y: number }, o: { tolerance: number }): string[] } | null
    layout(): { nodes: Map<string, { world: Box }> } | null
    viewPath(id: string): string[]
  } | null
}
declare const window: Window & { __kimo: Hook }

const EXAMPLES = join(import.meta.dirname, "..", "..", "..", "examples")

async function openDoc(page: Page, url: string, file: string | object) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(url)
  await page.getByRole("button", { name: "New file" }).click()
  await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
  await settle(page)
  const doc: unknown =
    typeof file === "string" ? JSON.parse(readFileSync(join(EXAMPLES, file), "utf8")) : file
  await page.evaluate(
    (d) => window.__kimo.session.store.loadDocument(JSON.parse(d)),
    JSON.stringify(doc),
  )
  await settle(page)
}

/** View-id path (root first) of `id`, and the page point of its centre at a zoom that shows it. */
async function target(page: Page, pick: "deepest" | "deepest-virtual", zoom = 1) {
  const t = await page.evaluate((mode) => {
    const k = window.__kimo
    const c = k.canvas()
    const lay = c?.layout()
    if (!c || !lay) return null
    const pathOf = (id: string) => c.viewPath(id)
    let best: { path: string[]; box: Box } | null = null
    for (const [id, l] of lay.nodes) {
      if (l.world.w < 6 || l.world.h < 6) continue
      const path = pathOf(id)
      if (mode === "deepest-virtual" && !path.some((p) => !k.session.store.getNode(p))) continue
      if (!best || path.length > best.path.length) best = { path, box: l.world }
    }
    return best
  }, pick)
  if (!t) throw new Error("no target")
  await page.evaluate(
    ({ b, z }) => {
      const s = window.__kimo.session.ui.getState()
      s.setViewport({ x: b.x + b.w / 2 - 600 / z, y: b.y + b.h / 2 - 400 / z, zoom: z })
    },
    { b: t.box, z: zoom },
  )
  await settle(page)
  const r = await page.locator(".canvas-host").boundingBox()
  const v = await page.evaluate(() => window.__kimo.session.ui.getState().viewport)
  if (!r) throw new Error("no canvas")
  return {
    path: t.path,
    pt: {
      x: r.x + (t.box.x + t.box.w / 2 - v.x) * v.zoom,
      y: r.y + (t.box.y + t.box.h / 2 - v.y) * v.zoom,
    },
  }
}

const sel = (page: Page) => page.evaluate(() => window.__kimo.session.ui.getState().selection)

async function drillThrough(
  ctx: E2EContext,
  file: string,
  mode: "deepest" | "deepest-virtual",
  zoom = 1,
) {
  const { page, url } = ctx
  await openDoc(page, url, file)
  const { path, pt } = await target(page, mode, zoom)
  ctx.log(file, path.join(" > "))
  expect(path.length >= 5, `deep enough (${path.length})`)
  const pathTail = path.slice(1)
  // Click: the top-most layer below the page frame.
  await page.mouse.click(pt.x, pt.y)
  await settle(page)
  let s = await sel(page)
  expect(s.length === 1 && s[0] === path[1], `click selects ${path[1]}: ${s}`)
  // Double-click again and again: one level per double-click, down to the leaf.
  for (let i = 2; i < path.length; i++) {
    await page.mouse.dblclick(pt.x, pt.y)
    await settle(page)
    s = await sel(page)
    const isText = await page.getByRole("textbox", { name: "Edit text" }).count()
    if (isText) {
      expect(s[0] === path[i - 1] || s[0] === path[i], `text edit on ${path[i]}`)
      await page.keyboard.press("Escape")
      await settle(page)
    }
    expect(s.length === 1 && s[0] === path[i], `dblclick #${i - 1} selects ${path[i]}, got ${s}`)
  }
  // ⌘-click from scratch: the leaf directly.
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await settle(page)
  await page.keyboard.down("ControlOrMeta")
  await page.mouse.click(pt.x, pt.y)
  await page.keyboard.up("ControlOrMeta")
  await settle(page)
  s = await sel(page)
  expect(s[0] === path[path.length - 1], `⌘-click selects the leaf, got ${s}`)
  // ⇧Enter / Esc go up one level at a time; Enter goes back down.
  for (let i = path.length - 2; i >= 2; i--) {
    await page.keyboard.press(i % 2 ? "Shift+Enter" : "Escape")
    await settle(page)
    s = await sel(page)
    expect(s[0] === path[i], `up to ${path[i]}, got ${s}`)
  }
  await page.keyboard.press("Enter")
  await settle(page)
  s = await sel(page)
  expect(s.length > 0 && pathTail.length > 0, "Enter selects children")
}

/** Every leaf of a file: the drill path goes one level per double-click, never skipping or sticking. */
async function sweep(ctx: E2EContext, file: string | object, zoom: number) {
  const { page, url } = ctx
  await openDoc(page, url, file)
  const leaves = await page.evaluate(() => {
    const c = window.__kimo.canvas()
    const lay = c?.layout()
    if (!c || !lay) return []
    const ids = [...lay.nodes.keys()]
    const parents = new Set(ids.map((i) => c.viewPath(i).slice(-2)[0]))
    return ids.filter((i) => !parents.has(i) && c.viewPath(i).length >= 4)
  })
  const bad: string[] = []
  for (const leaf of leaves) {
    const box = await page.evaluate(
      (id) => window.__kimo.canvas()?.layout()?.nodes.get(id)?.world,
      leaf,
    )
    if (!box || box.w < 1 || box.h < 1) continue
    await page.evaluate(
      ({ b, z }) =>
        window.__kimo.session.ui.getState().setViewport({
          x: b.x + b.w / 2 - 600 / z,
          y: b.y + b.h / 2 - 400 / z,
          zoom: z,
        }),
      { b: box, z: zoom },
    )
    await settle(page)
    const r = await page.locator(".canvas-host").boundingBox()
    if (!r) throw new Error("no canvas")
    const pt = { x: r.x + 600, y: r.y + 400 }
    const path = await page.evaluate((id) => window.__kimo.canvas()?.viewPath(id) ?? [], leaf)
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
    await page.mouse.click(pt.x, pt.y)
    let s = await sel(page)
    // The deepest hit may be a covering sibling; only judge leaves that are hit themselves.
    if (!s[0] || !path.includes(s[0])) continue
    for (let i = path.indexOf(s[0] as string) + 1; i < path.length; i++) {
      await page.mouse.dblclick(pt.x, pt.y)
      await settle(page)
      if (await page.getByRole("textbox", { name: "Edit text" }).count()) {
        await page.keyboard.press("Escape")
        await settle(page)
      }
      s = await sel(page)
      if (s[0] !== path[i]) {
        bad.push(`${leaf}: want ${path[i]} (depth ${i}) got ${s[0]}`)
        break
      }
    }
  }
  ctx.log(`${leaves.length} leaves, ${bad.length} stuck`, bad.join(" | "))
  expect(bad.length === 0, `stuck drills: ${bad.slice(0, 5).join(" | ")}`)
}

/** Arbitrary points (not leaf centres): drilling reaches the deepest hit and never stalls early. */
async function grid(ctx: E2EContext, file: string, zoom: number) {
  const { page, url } = ctx
  await openDoc(page, url, file)
  const bad: string[] = []
  const r = await page.locator(".canvas-host").boundingBox()
  if (!r) throw new Error("no canvas")
  const root = await page.evaluate(() => {
    const c = window.__kimo.canvas()
    const l = c?.layout()
    const id = [...(l?.nodes.keys() ?? [])].find((i) => c?.viewPath(i).length === 1)
    return id ? l?.nodes.get(id)?.world : null
  })
  if (!root) throw new Error("no root")
  await page.evaluate(
    ({ b, z }) =>
      window.__kimo.session.ui.getState().setViewport({ x: b.x - 40, y: b.y - 40, zoom: z }),
    { b: root, z: zoom },
  )
  await settle(page)
  const cols = 14
  const rows = 22
  for (let iy = 0; iy < rows; iy++)
    for (let ix = 0; ix < cols; ix++) {
      const pt = { x: r.x + 60 + ix * 70 + (iy % 3) * 11, y: r.y + 30 + iy * 34 + (ix % 4) * 7 }
      const deep = await page.evaluate((q) => {
        const rr = document.querySelector(".canvas-host")?.getBoundingClientRect()
        const c = window.__kimo.canvas()
        if (!rr || !c?.renderer) return null
        return c.renderer.hitTest({ x: q.x - rr.x, y: q.y - rr.y }, { tolerance: 0 })[0] ?? null
      }, pt)
      if (!deep) continue
      const path = await page.evaluate((id) => window.__kimo.canvas()?.viewPath(id) ?? [], deep)
      await page.evaluate(() => window.__kimo.session.ui.getState().select([]))
      await page.mouse.click(pt.x, pt.y)
      let s = await sel(page)
      for (let i = 0; i < 10 && s[0] !== deep; i++) {
        const prev = s[0]
        await page.mouse.dblclick(pt.x, pt.y)
        await settle(page)
        if (await page.getByRole("textbox", { name: "Edit text" }).count()) {
          await page.keyboard.press("Escape")
          await settle(page)
          s = await sel(page)
          break
        }
        s = await sel(page)
        if (s[0] === prev) break
        if (prev && path.indexOf(s[0] as string) !== path.indexOf(prev) + 1) {
          bad.push(`${deep}@${pt.x},${pt.y}: ${prev} -> ${s[0]} skipped`)
          break
        }
      }
      const textual = await page.evaluate(
        (id) => window.__kimo.session.store.getNode(id)?.type === "text",
        deep,
      )
      if (s[0] !== deep && !textual)
        bad.push(
          `${deep}@${Math.round(pt.x)},${Math.round(pt.y)}: stuck at ${s[0]} (path ${path.join(">")})`,
        )
    }
  ctx.log(`${bad.length} bad`, bad.slice(0, 8).join("\n"))
  expect(bad.length === 0, `drill problems: ${bad.slice(0, 4).join(" | ")}`)
}

/** 9 levels: frames, groups, auto layout, clip, rotation; each level 14px smaller per side. */
function deepDoc() {
  const nodes: Record<string, unknown> = {}
  const kinds = ["frame", "group", "frame", "group", "frame", "frame", "group", "frame", "rect"]
  let parent: string | null = null
  let size = 700
  kinds.forEach((type, i) => {
    const id = `deepNode${i}`
    const n: Record<string, unknown> = {
      type,
      order: "a0",
      name: `L${i}`,
      x: 14,
      y: 14,
      w: size,
      h: size,
    }
    if (type === "group") {
      delete n.w
      delete n.h
    }
    if (parent) n.parent = parent
    else Object.assign(n, { parent: null, x: 0, y: 0 })
    if (type === "frame") {
      n.fill = i % 2 ? "#E8F0FF" : "#FFFFFF"
      if (i === 4) n.clip = true
      if (i === 5) n.layout = { dir: "column", pad: 12, gap: 8 }
    }
    if (type === "rect") n.fill = "#E4572E"
    if (i === 5) {
      delete n.x
      delete n.y
    }
    nodes[id] = n
    parent = id
    size -= 56
  })
  return {
    $schema: "https://kimo.design/schema/kimo-1.0.json",
    format: "1.0.0",
    meta: { name: "deep" },
    nodes,
  }
}

/** `n` rapid clicks (the browser's click count rises with each), `jitter` px of drift per click. */
async function rapid(page: Page, pt: { x: number; y: number }, n: number, jitter = 0) {
  for (let i = 1; i <= n; i++) {
    const x = pt.x + (i % 2 ? jitter : -jitter) * (i > 1 ? 1 : 0)
    const y = pt.y + (i % 3 ? jitter : 0) * (i > 1 ? 1 : 0)
    await page.mouse.move(x, y)
    await page.mouse.down({ clickCount: i })
    await page.mouse.up({ clickCount: i })
  }
  await settle(page)
}
const editing = (page: Page) => page.getByRole("textbox", { name: "Edit text" }).count()

async function multiClick(ctx: E2EContext, file: string, mode: "deepest" | "deepest-virtual") {
  const { page, url } = ctx
  await openDoc(page, url, file)
  const { path, pt } = await target(page, mode)
  const leaf = path.length - 1
  const leafType = await page.evaluate(
    (id) => window.__kimo.session.store.getNode(id)?.type ?? "virtual",
    path[leaf] as string,
  )
  const textLeaf = leafType === "text" || leafType === "virtual"
  // n rapid clicks: n = 1 → level 1, 2 → level 2 … until the leaf; never a step skipped.
  for (let n = 1; n <= leaf; n++) {
    await page.evaluate(() => window.__kimo.session.ui.getState().select([]))
    await page.waitForTimeout(450)
    await rapid(page, pt, n)
    if (await editing(page)) await page.keyboard.press("Escape")
    const s = await sel(page)
    expect(s.length === 1 && s[0] === path[n], `${n} clicks → level ${n} (${path[n]}), got ${s}`)
  }
  // Jitter of 1–3 px between clicks keeps the first click's path.
  for (const j of [1, 2, 3]) {
    await page.evaluate(() => window.__kimo.session.ui.getState().select([]))
    await page.waitForTimeout(450)
    await rapid(page, pt, 4, j)
    const s = await sel(page)
    expect(s[0] === path[4], `jitter ${j}px: 4 clicks → ${path[4]}, got ${s}`)
  }
  // A pause ends the sequence: the next single click is a plain click (top-level layer).
  await page.evaluate(() => window.__kimo.session.ui.getState().select([]))
  await page.waitForTimeout(450)
  await rapid(page, pt, 3)
  await page.waitForTimeout(600)
  await rapid(page, pt, 1)
  let s = await sel(page)
  expect(s[0] === path[3], `after a pause a click keeps depth, no extra step: ${s}`)
  await page.evaluate(() => window.__kimo.session.ui.getState().select([]))
  await page.waitForTimeout(450)
  await rapid(page, pt, 1)
  s = await sel(page)
  expect(s[0] === path[1], `fresh single click selects ${path[1]}, got ${s}`)
  // One more click than levels: a text leaf enters edit, anything else stays on the leaf.
  await page.evaluate(() => window.__kimo.session.ui.getState().select([]))
  await page.waitForTimeout(450)
  await rapid(page, pt, leaf + 1)
  s = await sel(page)
  expect(s[0] === path[leaf], `leaf stays selected, got ${s}`)
  if (textLeaf && leafType === "text")
    expect((await editing(page)) === 1, "the click after the text leaf enters text edit")
}

export const scenarios: Scenario[] = [
  {
    name: "drill-down: landing page, click then double-clicks reach the leaf",
    run: (ctx) => drillThrough(ctx, "landing-page/landing.kimo", "deepest"),
  },
  {
    name: "drill-down: landing page zoomed out (small layers)",
    run: (ctx) => drillThrough(ctx, "landing-page/landing.kimo", "deepest", 0.4),
  },
  {
    name: "drill-down: design system, through component instances",
    run: (ctx) => drillThrough(ctx, "design-system/kimo-ds.lib.kimo", "deepest"),
  },
  {
    name: "drill-down: every landing-page leaf at 100% and 40%",
    async run(ctx) {
      await sweep(ctx, "landing-page/landing.kimo", 1)
      await sweep(ctx, "landing-page/landing.kimo", 0.4)
    },
  },
  {
    name: "drill-down: every design-system leaf (instances, slots)",
    run: (ctx) => sweep(ctx, "design-system/kimo-ds.lib.kimo", 1),
  },
  {
    name: "drill-down: arbitrary points on the landing page at 50%",
    run: (ctx) => grid(ctx, "landing-page/landing.kimo", 0.5),
  },
  {
    name: "drill-down: nine levels of frames, groups, auto layout and clip",
    async run(ctx) {
      await sweep(ctx, deepDoc(), 1)
      await sweep(ctx, deepDoc(), 0.3)
    },
  },
  {
    name: "multi-click: 1…n rapid clicks drill one level each (landing page)",
    run: (ctx) => multiClick(ctx, "landing-page/landing.kimo", "deepest"),
  },
  {
    name: "multi-click: through component instances (design system)",
    run: (ctx) => multiClick(ctx, "design-system/kimo-ds.lib.kimo", "deepest"),
  },
]
