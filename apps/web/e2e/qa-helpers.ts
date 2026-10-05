/**
 * Shared helpers for the adversarial QA scenarios (`qa-*.e2e.ts`). Not a scenario file itself
 * (the runner only loads `*.e2e.ts`).
 */
import type { FileChooser, Page } from "playwright"

export type Box = { x: number; y: number; w: number; h: number }
export type Pt = { x: number; y: number }
export type NodeRec = Record<string, unknown>

export interface Hook {
  session: {
    store: {
      nodeIds(): string[]
      getNode(id: string): NodeRec | undefined
      children(p: string | null): string[]
      canUndo(o: string): boolean
      canRedo(o: string): boolean
      toDocument(): unknown
    }
    ui: {
      getState(): {
        selection: string[]
        hovered: string | null
        tool: string
        viewport: { x: number; y: number; zoom: number }
        setViewport(v: object): void
        select(ids: string[]): void
      }
    }
  }
  canvas(): {
    layout(): { nodes: Map<string, { world: Box; local: Box }> } | null
  } | null
}

/**
 * Keeps file-chooser interception on for the whole page. Playwright turns interception on only
 * when the first "filechooser" listener is added, and sends that request without waiting for it
 * (`updateSubscription` is fire-and-forget), then turns it off again when the last listener goes.
 * `Promise.all([page.waitForEvent("filechooser"), page.keyboard.press("ControlOrMeta+o")])` can
 * therefore reach Chromium's keydown before `Page.setInterceptFileChooserDialog` takes effect;
 * headless Chromium then cancels the un-intercepted picker and the wait times out. Arm before
 * the page loads (before `openEditor`), so interception is on long before any trigger.
 */
export function armFileChooser(page: Page) {
  if (armed.has(page)) return
  armed.add(page)
  page.on("filechooser", () => {})
}
const armed = new WeakSet<Page>()

/** The next file chooser; the page must be {@link armFileChooser armed} first. */
export function nextFileChooser(page: Page, timeout = 10_000): Promise<FileChooser> {
  if (!armed.has(page))
    throw new Error("nextFileChooser: call armFileChooser(page) before the trigger")
  const p = page.waitForEvent("filechooser", { timeout })
  // A scenario that fails before awaiting this leaves it pending: its later rejection (timeout,
  // page closed) must not become an unhandled rejection that kills the whole driver.
  p.catch(() => {})
  return p
}

export async function openEditor(page: Page, url: string) {
  await page.goto(url)
  await page.getByRole("button", { name: "New file" }).click()
  await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
  await waitCanvas(page)
}

export async function waitCanvas(page: Page) {
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
  await settle(page)
}

/**
 * Two animation frames, so pending renders and overlay updates land. Rejects if no frame comes
 * within 5 s: a stalled rAF is a real failure, not something to wait out. (An earlier silent
 * 500 ms timer fallback was added for "rAF hangs" that were really the Bun-hosted driver losing
 * its pipe to Chromium; see run.ts. It let tests read state before the frame they waited for.)
 */
export const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("settle: no animation frame in 5 s")), 5000)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            clearTimeout(t)
            resolve()
          }),
        )
      }),
  )

export const idOf = (page: Page, name: string) =>
  page.evaluate((n) => {
    const s = (window as unknown as { __kimo: Hook }).__kimo.session.store
    return s.nodeIds().find((i) => s.getNode(i)?.name === n) ?? null
  }, name)

export const node = (page: Page, id: string) =>
  page.evaluate(
    (i) => (window as unknown as { __kimo: Hook }).__kimo.session.store.getNode(i) ?? null,
    id,
  )

export const nodeCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { __kimo: Hook }).__kimo.session.store.nodeIds().length)

export const children = (page: Page, id: string | null) =>
  page.evaluate((i) => (window as unknown as { __kimo: Hook }).__kimo.session.store.children(i), id)

export const docJson = (page: Page) =>
  page.evaluate(() =>
    JSON.stringify((window as unknown as { __kimo: Hook }).__kimo.session.store.toDocument()),
  )

export const ui = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __kimo: Hook }).__kimo.session.ui.getState()
    return { selection: s.selection, hovered: s.hovered, tool: s.tool, viewport: s.viewport }
  })

export const select = (page: Page, ids: string[]) =>
  page.evaluate(
    (x) => (window as unknown as { __kimo: Hook }).__kimo.session.ui.getState().select(x),
    ids,
  )

export const setViewport = (page: Page, v: Partial<{ x: number; y: number; zoom: number }>) =>
  page.evaluate(
    (x) => (window as unknown as { __kimo: Hook }).__kimo.session.ui.getState().setViewport(x),
    v,
  )

export const world = (page: Page, id: string) =>
  page.evaluate(
    (i) =>
      (window as unknown as { __kimo: Hook }).__kimo.canvas()?.layout()?.nodes.get(i)?.world ??
      null,
    id,
  )

export async function toPage(page: Page, p: Pt): Promise<Pt> {
  const r = await page.locator(".canvas-host").boundingBox()
  const v = (await ui(page)).viewport
  if (!r) throw new Error("no canvas")
  return { x: r.x + (p.x - v.x) * v.zoom, y: r.y + (p.y - v.y) * v.zoom }
}

export async function centerOf(page: Page, id: string) {
  const b = await world(page, id)
  if (!b) throw new Error(`no layout for ${id}`)
  return toPage(page, { x: b.x + b.w / 2, y: b.y + b.h / 2 })
}

/** Press at `pts[0]`, move through every point (8 steps per leg), release at the last one. */
export async function dragPath(page: Page, pts: Pt[], opts: { release?: boolean } = {}) {
  const [first, ...rest] = pts
  if (!first) return
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  let cur = first
  for (const to of rest) {
    for (let i = 1; i <= 8; i++)
      await page.mouse.move(cur.x + ((to.x - cur.x) * i) / 8, cur.y + ((to.y - cur.y) * i) / 8)
    await settle(page)
    cur = to
  }
  if (opts.release !== false) {
    await page.mouse.up()
    await settle(page)
  }
}

export const drag = (page: Page, from: Pt, to: Pt) => dragPath(page, [from, to])

/** Draws a shape with tool key `k` on empty canvas from world `a` to world `b`. */
export async function drawShape(page: Page, k: string, a: Pt, b: Pt) {
  await page.locator(".canvas-host").focus()
  await page.keyboard.press(k)
  await drag(page, await toPage(page, a), await toPage(page, b))
  return (await ui(page)).selection[0] as string
}

export const row = (page: Page, name: string) =>
  page
    .getByRole("treeitem")
    .filter({ has: page.locator(".kimo-layer-row__name", { hasText: new RegExp(`^${name}$`) }) })

export const field = (page: Page, label: string) =>
  page.getByRole("textbox", { name: label, exact: true })

export async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

export async function setField(page: Page, label: string, value: string) {
  const f = field(page, label)
  await f.click()
  await f.fill(value)
  await f.press("Enter")
  await blur(page)
  await settle(page)
}

export const undo = (page: Page) => page.keyboard.press("ControlOrMeta+z")
export const redo = (page: Page) => page.keyboard.press("ControlOrMeta+Shift+z")

/** RGBA of one screen pixel at canvas-relative CSS point `p`. */
export async function pixel(page: Page, p: Pt): Promise<number[]> {
  const r = await page.locator(".canvas-host").boundingBox()
  if (!r) throw new Error("no canvas")
  const png = await page.screenshot({
    clip: { x: r.x + Math.round(p.x), y: r.y + Math.round(p.y), width: 1, height: 1 },
  })
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const o = new OffscreenCanvas(1, 1)
    const g = o.getContext("2d") as OffscreenCanvasRenderingContext2D
    g.drawImage(img, 0, 0)
    return Array.from(g.getImageData(0, 0, 1, 1).data)
  }, png.toString("base64"))
}

/** Canvas-relative CSS point of world point `p`. */
export async function toCanvas(page: Page, p: Pt): Promise<Pt> {
  const v = (await ui(page)).viewport
  return { x: (p.x - v.x) * v.zoom, y: (p.y - v.y) * v.zoom }
}

export const box = (n: NodeRec | null) => ({
  x: n?.x as number,
  y: n?.y as number,
  w: n?.w as number,
  h: n?.h as number,
})
