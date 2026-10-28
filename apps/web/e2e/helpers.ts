/**
 * Shared types and helpers for the smoke scenarios (`*.e2e.ts`). Not a scenario file itself (the
 * runner only loads `*.e2e.ts`). Nothing here imports `run.ts`: the runner imports these types.
 *
 * The scenarios read the document through the test hook (`window.__kimo`, on in the e2e build)
 * and draw on a clear part of the canvas ({@link clearStage}), so they don't depend on the sample
 * document's content or on where the floating panels sit.
 */
import type { FileChooser, Page } from "playwright"

export interface E2EContext {
  page: Page
  url: string
  log(...args: unknown[]): void
  /** Another page in its own browser context (own storage), closed with the scenario. */
  newPage(): Promise<Page>
}
export type Scenario = { name: string; run(ctx: E2EContext): Promise<void> }

export function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`Expectation failed: ${message}`)
}

export type Pt = { x: number; y: number }
export type Box = { x: number; y: number; w: number; h: number }
export type NodeRec = Record<string, unknown>

export interface Hook {
  session: {
    store: {
      nodeIds(): string[]
      getNode(id: string): NodeRec | undefined
      apply(ops: unknown[], o: { origin: string; label?: string }): { ok: boolean }
      toDocument(): unknown
    }
    ui: {
      getState(): {
        selection: string[]
        tool: string
        viewport: { x: number; y: number; zoom: number }
        setViewport(v: object): void
        select(ids: string[]): void
      }
    }
  }
  canvas(): {
    layout(): { nodes: Map<string, { world: Box }> } | null
    editingPath(): string | null
  } | null
}

// Functions passed to page.evaluate are serialized into the page: each reads the hook itself
// (`(window as unknown as { __kimo: Hook }).__kimo`), nothing from this module's scope.

/**
 * Two animation frames, so pending renders and overlay updates land. Rejects if no frame comes
 * within 5 s: a stalled rAF is a real failure, not something to wait out.
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

export async function waitCanvas(page: Page) {
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
  await settle(page)
}

/** Home → New file: the editor on a new file (the sample document). */
export async function openEditor(page: Page, url: string) {
  await page.goto(url)
  // The empty state can show a second "New file"; the header one is always there.
  await page.getByRole("button", { name: "New file" }).first().click()
  await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
  await waitCanvas(page)
}

const STAGE = { x: 10000, y: 10000 }

/**
 * Pans the canvas to empty space at 100 % and clears the selection. {@link stage} maps canvas
 * pixels to the world points there; 300..1100 across and 100..650 down stay clear of the floating
 * panels and the toolbar.
 */
export async function clearStage(page: Page) {
  await page.evaluate((origin) => {
    const s = (window as unknown as { __kimo: Hook }).__kimo.session.ui.getState()
    s.setViewport({ x: origin.x, y: origin.y, zoom: 1 })
    s.select([])
  }, STAGE)
  await settle(page)
}

/** The world point under canvas pixel (x, y) after {@link clearStage}. */
export const stage = (x: number, y: number): Pt => ({ x: STAGE.x + x, y: STAGE.y + y })

export const node = (page: Page, id: string) =>
  page.evaluate(
    (i) => (window as unknown as { __kimo: Hook }).__kimo.session.store.getNode(i) ?? null,
    id,
  )

export const nodeIds = (page: Page) =>
  page.evaluate(() => (window as unknown as { __kimo: Hook }).__kimo.session.store.nodeIds())

/** Ids in the document that are not in `before`. */
export const newIds = async (page: Page, before: string[]) =>
  (await nodeIds(page)).filter((i) => !before.includes(i))

export const docJson = (page: Page) =>
  page.evaluate(() =>
    JSON.stringify((window as unknown as { __kimo: Hook }).__kimo.session.store.toDocument()),
  )

export const ui = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __kimo: Hook }).__kimo.session.ui.getState()
    return { selection: s.selection, tool: s.tool, viewport: s.viewport }
  })

export const select = (page: Page, ids: string[]) =>
  page.evaluate(
    (x) => (window as unknown as { __kimo: Hook }).__kimo.session.ui.getState().select(x),
    ids,
  )

export const editingPath = (page: Page) =>
  page.evaluate(() => (window as unknown as { __kimo: Hook }).__kimo.canvas()?.editingPath())

/** Adds nodes as one undo step of the user (the way a gesture does): `[id, parent, node]`. */
export async function insert(
  page: Page,
  nodes: [id: string, parent: string | null, node: NodeRec][],
) {
  const ok = await page.evaluate((list) => {
    const ops = list.map(([id, parent, n]) => ({ op: "insert", id, parent, node: n }))
    const k = (window as unknown as { __kimo: Hook }).__kimo
    return k.session.store.apply(ops, { origin: "user" }).ok
  }, nodes)
  expect(ok, "fixture nodes inserted")
  await settle(page)
}

export const world = (page: Page, id: string) =>
  page.evaluate(
    (i) =>
      (window as unknown as { __kimo: Hook }).__kimo.canvas()?.layout()?.nodes.get(i)?.world ??
      null,
    id,
  )

/** Page coordinates of a world point (canvas origin + viewport). */
export async function toPage(page: Page, p: Pt): Promise<Pt> {
  const r = await page.locator(".canvas-host").boundingBox()
  const v = (await ui(page)).viewport
  if (!r) throw new Error("no canvas")
  return { x: r.x + (p.x - v.x) * v.zoom, y: r.y + (p.y - v.y) * v.zoom }
}

export async function centerOf(page: Page, id: string): Promise<Pt> {
  const b = await world(page, id)
  if (!b) throw new Error(`no layout for ${id}`)
  return toPage(page, { x: b.x + b.w / 2, y: b.y + b.h / 2 })
}

/** Press at `pts[0]`, move through every point (8 steps per leg), release at the last one. */
export async function dragPath(page: Page, pts: Pt[]) {
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
  await page.mouse.up()
  await settle(page)
}

export const drag = (page: Page, from: Pt, to: Pt) => dragPath(page, [from, to])

/** Focuses the canvas so tool keys and shortcuts reach it. */
export const focusCanvas = (page: Page) => page.locator(".canvas-host").focus()

/**
 * Draws with tool key `key` from canvas pixel `a` to `b` (stage coordinates); resolves to the id of
 * the new, selected node.
 */
export async function draw(page: Page, key: string, a: Pt, b: Pt) {
  await focusCanvas(page)
  await page.keyboard.press(key)
  await drag(page, await toPage(page, stage(a.x, a.y)), await toPage(page, stage(b.x, b.y)))
  const id = (await ui(page)).selection[0]
  expect(id, `tool ${key} created a node`)
  return id
}

export const undo = async (page: Page) => {
  await page.keyboard.press("ControlOrMeta+z")
  await settle(page)
}
export const redo = async (page: Page) => {
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await settle(page)
}

/** Waits for `fn` (run in the page with `arg`) to return truthy. */
export async function waitFor<A>(
  page: Page,
  what: string,
  fn: (arg: A) => unknown,
  arg: A,
  timeout = 15_000,
) {
  // `never`: Playwright's PageFunction type can't see through the generic argument.
  await page.waitForFunction(fn as never, arg, { timeout, polling: 100 }).catch(() => {
    throw new Error(`Expectation failed: timed out waiting for ${what}`)
  })
}

/**
 * Keeps file-chooser interception on for the whole page. Playwright turns interception on only
 * when the first "filechooser" listener is added, and sends that request without waiting for it,
 * so a trigger fired right after adding the listener can reach Chromium first and the picker is
 * cancelled. Arm before the trigger (before {@link openEditor}).
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
  // A scenario that fails before awaiting this leaves it pending: its later rejection must not
  // become an unhandled rejection.
  p.catch(() => {})
  return p
}

/**
 * Opens and saves go through the <input type=file> / download paths instead of the native
 * pickers, which headless Chromium can't drive. Call before {@link openEditor}.
 */
export async function noPickers(page: Page) {
  armFileChooser(page)
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    w.showSaveFilePicker = undefined
    w.showOpenFilePicker = undefined
  })
}
