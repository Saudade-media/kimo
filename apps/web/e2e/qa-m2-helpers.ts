/**
 * Shared helpers for the adversarial M2 QA scenarios (`qa-m2-*.e2e.ts`). Not a scenario file
 * (the runner only loads `*.e2e.ts`).
 */
import type { Page } from "playwright"
import { armFileChooser, docJson, type Hook, settle } from "./qa-helpers"

export type Ops = Record<string, unknown>[]

export interface M2Hook extends Hook {
  session: Hook["session"] & {
    store: Hook["session"]["store"] & {
      apply(
        ops: unknown[],
        o: { origin: string; label?: string },
      ): { ok: boolean; errors?: unknown }
      undo(o: string): unknown
      redo(o: string): unknown
      hasNode(id: string): boolean
    }
    apply(ops: unknown[], label?: string): boolean
    ui: {
      getState(): ReturnType<Hook["session"]["ui"]["getState"]> & {
        setTool(t: string): void
      }
    }
  }
  canvas(): {
    layout(): {
      nodes: Map<
        string,
        {
          world: { x: number; y: number; w: number; h: number }
          local: { x: number; y: number; w: number; h: number }
        }
      >
    } | null
    editingPath(): string | null
    editPath(id: string): void
    placement(): unknown
    insertIcon(i: { set: string; name: string }, at?: { x: number; y: number }): string | null
    zoomTo(z: number): void
    isGesturing(): boolean
    renderer: { setOverlay(o: unknown): void; theme?: Record<string, string> } | null
  } | null
}

export const K = "__kimo"

/** Applies ops as the user (one undo step) and clears the selection. */
export async function applyOps(page: Page, ops: Ops, select: string[] = []) {
  const ok = await page.evaluate(
    ({ ops, select }) => {
      const k = (window as unknown as { __kimo: M2Hook }).__kimo
      const r = k.session.store.apply(ops, { origin: "user" })
      k.session.ui.getState().select(select)
      return r.ok
    },
    { ops, select },
  )
  if (!ok) throw new Error(`fixture rejected: ${JSON.stringify(ops).slice(0, 300)}`)
  await settle(page)
}

/** A white 600×400 root frame "Board" at 0,0 with children; viewport (-100,-100) zoom 1. */
export async function board(
  page: Page,
  kids: { id: string; node: Record<string, unknown>; parent?: string }[],
  frame: Record<string, unknown> = {},
) {
  await applyOps(page, [
    {
      op: "insert",
      id: "board0000001",
      parent: null,
      node: { type: "frame", name: "Board", x: 0, y: 0, w: 600, h: 400, fill: "#FFFFFF", ...frame },
    },
    ...kids.map((c) => ({
      op: "insert",
      id: c.id,
      parent: c.parent ?? "board0000001",
      node: c.node,
    })),
  ])
  await page.evaluate(() =>
    (window as unknown as { __kimo: M2Hook }).__kimo.session.ui
      .getState()
      .setViewport({ x: -100, y: -100, zoom: 1 }),
  )
  await settle(page)
}

export const storeUndo = async (page: Page) => {
  await page.evaluate(() =>
    (window as unknown as { __kimo: M2Hook }).__kimo.session.store.undo("user"),
  )
  await settle(page)
}

/**
 * Undo steps needed to get back to `before` (store API). Returns -1 when 25 steps do not get
 * there. Leaves the document at `before` on success.
 */
export async function stepsBack(page: Page, before: string): Promise<number> {
  for (let i = 0; i <= 25; i++) {
    if ((await docJson(page)) === before) return i
    const can = await page.evaluate(() =>
      (window as unknown as { __kimo: M2Hook }).__kimo.session.store.canUndo("user"),
    )
    if (!can) return -1
    await storeUndo(page)
  }
  return -1
}

/** Records every overlay the controller sends to the renderer (window.__ov = latest). */
export async function spyOverlay(page: Page) {
  await page.evaluate(() => {
    const k = (window as unknown as { __kimo: M2Hook }).__kimo
    const r = k.canvas()?.renderer as unknown as {
      setOverlay(o: unknown): void
      __spied?: boolean
    }
    if (!r || r.__spied) return
    const orig = r.setOverlay.bind(r)
    r.setOverlay = (o: unknown) => {
      ;(window as unknown as { __ov: unknown }).__ov = o
      orig(o)
    }
    r.__spied = true
  })
}

export interface OverlaySnapshot {
  snap?: {
    lines: { axis: string; at: number; from: number; to: number }[]
    markers: unknown[]
  } | null
  spacing?: { axis: string; from: number; to: number; label: string }[]
  measurements?: { axis: string; at: number; from: number; to: number; label: string }[]
  measureOutlines?: { id: string; role: string }[]
  pixelGrid?: boolean | number
  pen?: { contour: { anchors: { x: number; y: number }[] } } | null
  pathEdit?: { contours: { anchors: { x: number; y: number }[]; closed: boolean }[] } | null
  cursorBadge?: { text: string } | null
}

export const overlay = (page: Page) =>
  page.evaluate(
    () => ((window as unknown as { __ov?: unknown }).__ov ?? null) as OverlaySnapshot | null,
  )

/** Board-08 section by title in the Design tab. */
export const section = (page: Page, title: string) =>
  page.locator(".design-tab .kimo-prop-section", {
    has: page.locator(".kimo-prop-section__title", { hasText: new RegExp(`^${title}$`) }),
  })

/** Types into a labelled panel text field and presses Enter. */
export async function typeField(
  page: Page,
  scope: ReturnType<Page["locator"]>,
  label: string,
  v: string,
) {
  const f = scope.getByRole("textbox", { name: label, exact: true })
  await f.click()
  await f.fill(v)
  await f.press("Enter")
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await settle(page)
}

export const fieldValue = (scope: ReturnType<Page["locator"]>, label: string) =>
  scope.getByRole("textbox", { name: label, exact: true }).inputValue()

/** Drag with explicit intermediate steps and modifier keys held during the move only. */
export async function dragSteps(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++)
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    )
  await settle(page)
  await page.mouse.up()
  await settle(page)
}

/** 2×2 PNG. */
export const PNG_2x2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGN4nh+4AoQZYAwAVOQJPdIwj3IAAAAASUVORK5CYII=",
  "base64",
)
/** 3×2 PNG. */
export const PNG_3x2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGN4nh/4H4YZkDkAzjAP5U44ecgAAAAASUVORK5CYII=",
  "base64",
)

/**
 * Forces the download / <input type=file> paths of saveKimoFile / pickKimoFile, and arms file
 * chooser interception (see armFileChooser). Call before openEditor.
 */
export async function noPickers(page: Page) {
  armFileChooser(page)
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    delete w.showSaveFilePicker
    delete w.showOpenFilePicker
  })
}

export async function saveViaShortcut(
  page: Page,
): Promise<{ name: string; text: string; buffer: Buffer }> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 10_000 }),
    page.keyboard.press("ControlOrMeta+s"),
  ])
  const stream = await dl.createReadStream()
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  const buffer = Buffer.concat(chunks)
  return { name: dl.suggestedFilename(), text: buffer.toString("utf8"), buffer }
}

/** Collects console warnings (edit rejections) for the page. */
export function collectWarnings(page: Page): string[] {
  const out: string[] = []
  page.on("console", (m) => {
    if (m.type() === "warning" || m.type() === "error") out.push(m.text())
  })
  return out
}
