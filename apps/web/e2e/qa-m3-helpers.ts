/**
 * Shared helpers for the adversarial M3 QA scenarios (`qa-m3-*.e2e.ts`). Not a scenario file
 * (the runner only loads `*.e2e.ts`).
 */
import { validate } from "@kimo/core-schema"
import type { Page } from "playwright"
import { docJson, settle } from "./qa-helpers"

export type Rec = Record<string, unknown>
export type Box = { x: number; y: number; w: number; h: number }

export type QW = {
  __kimo: {
    session: {
      store: {
        getNode(id: string): Rec | undefined
        undo(o: string): unknown
        redo(o: string): unknown
        canUndo(o: string): boolean
        toDocument(): Rec
        nodeIds(): string[]
        children(p: string | null, at?: string | null): string[]
        apply(ops: unknown[], o: { origin: string; label?: string }): { ok: boolean }
      }
      apply(ops: unknown[], label?: string): boolean
      ui: {
        getState(): {
          selection: string[]
          select(ids: string[]): void
          setViewport(v: object): void
        }
      }
    }
    canvas(): {
      layout(): { nodes: Map<string, { world: Box; visible?: boolean }> } | null
      worldToScreen(p: { x: number; y: number }): { x: number; y: number }
    } | null
    m3: {
      view(): {
        children(p: string | null, at?: string | null): string[]
        getNode(id: string): Rec | undefined
        isVirtual(id: string): boolean
        theme(id: string): Record<string, string>
        issues(id?: string): readonly { code: string; message?: string }[]
      }
      libs: {
        inject(alias: string, path: string, doc: unknown, status?: string): void
        entries(): readonly { alias: string; status: string; name: string }[]
      }
      run(cmd: unknown, label: string): { ok: boolean; refused?: { code: string; message: string } }
      toasts: { get(): { text: string; tone: string }[] }
      doc(): Rec
    }
  }
}

/** Soft-assert collector: every failed check is reported, the scenario fails once at the end. */
export class Checks {
  readonly failures: string[] = []
  constructor(private log: (...a: unknown[]) => void) {}
  ok(cond: unknown, message: string) {
    if (!cond) {
      this.failures.push(message)
      this.log(`FAIL: ${message}`)
    }
  }
  done() {
    if (this.failures.length)
      throw new Error(
        `${this.failures.length} check(s) failed:\n    - ${this.failures.join("\n    - ")}`,
      )
  }
}

export const doc = (page: Page) =>
  page.evaluate(() => (window as unknown as QW).__kimo.session.store.toDocument()) as Promise<Rec>

export const getNode = (page: Page, id: string) =>
  page.evaluate(
    (i) => ((window as unknown as QW).__kimo.session.store.getNode(i) ?? null) as Rec | null,
    id,
  )

export const viewNode = (page: Page, id: string) =>
  page.evaluate(
    (i) => ((window as unknown as QW).__kimo.m3.view().getNode(i) ?? null) as Rec | null,
    id,
  )

export const viewChildren = (page: Page, id: string | null) =>
  page.evaluate((i) => [...(window as unknown as QW).__kimo.m3.view().children(i)], id)

export const layoutBox = (page: Page, id: string) =>
  page.evaluate((i) => {
    const n = (window as unknown as QW).__kimo.canvas()?.layout()?.nodes.get(i)
    return n ? { ...n.world, visible: n.visible } : null
  }, id)

export async function run(page: Page, cmd: Rec, label = "qa") {
  const r = await page.evaluate(
    ({ cmd, label }) => {
      const r = (window as unknown as QW).__kimo.m3.run(cmd, label)
      return {
        ok: r.ok,
        code: (r as { refused?: { code: string } }).refused?.code ?? null,
        message: (r as { refused?: { message: string } }).refused?.message ?? null,
      }
    },
    { cmd, label },
  )
  await settle(page)
  return r
}

export async function apply(page: Page, ops: unknown[], label = "fixture") {
  const ok = await page.evaluate(
    ({ ops, label }) => (window as unknown as QW).__kimo.session.apply(ops, label),
    { ops, label },
  )
  await settle(page)
  return ok
}

export async function select(page: Page, ids: string[]) {
  await page.evaluate((i) => (window as unknown as QW).__kimo.session.ui.getState().select(i), ids)
  await settle(page)
}

export const selection = (page: Page) =>
  page.evaluate(() => (window as unknown as QW).__kimo.session.ui.getState().selection)

export async function storeUndo(page: Page) {
  await page.evaluate(() => (window as unknown as QW).__kimo.session.store.undo("user"))
  await settle(page)
}
export async function storeRedo(page: Page) {
  await page.evaluate(() => (window as unknown as QW).__kimo.session.store.redo("user"))
  await settle(page)
}

export const toasts = (page: Page) =>
  page.evaluate(() => (window as unknown as QW).__kimo.m3.toasts.get().map((t) => ({ ...t })))

/** Validates the store's document (errors only), optionally with library documents. */
export async function validDoc(page: Page, libraries?: Record<string, unknown>) {
  const d = await doc(page)
  const r = validate(d, libraries ? { libraries: libraries as never } : {})
  return { ok: r.ok, errors: r.errors.map((e) => `${e.code} ${e.path} ${e.message}`), doc: d }
}

/** Asserts a gesture is exactly one undo step: undo restores `before`, redo restores `after`. */
export async function oneUndo(page: Page, c: Checks, before: string, what: string) {
  const after = await docJson(page)
  c.ok(after !== before, `${what}: changed the document`)
  await storeUndo(page)
  const undone = await docJson(page)
  c.ok(undone === before, `${what}: one undo step restores the document`)
  await storeRedo(page)
  c.ok((await docJson(page)) === after, `${what}: redo restores the change`)
}

/**
 * Fixture: `Icon/Star` (B) and `Icon/Heart` (H) mains, `Card/Pricing` (A) main with Title text,
 * Badge rect, Actions slot frame and a nested `Icon` instance of B; instance `inst000001` of A.
 */
export async function componentsFixture(page: Page) {
  const ok = await apply(page, [
    {
      op: "insert",
      id: "starmain01",
      parent: null,
      node: {
        type: "frame",
        name: "Icon/Star",
        x: 600,
        y: 40,
        w: 24,
        h: 24,
        fill: "#FFD166",
        component: true,
      },
    },
    {
      op: "insert",
      id: "starglyph1",
      parent: "starmain01",
      node: { type: "rect", name: "Glyph", x: 4, y: 4, w: 16, h: 16, fill: "#E2683A" },
    },
    {
      op: "insert",
      id: "heartmain1",
      parent: null,
      node: {
        type: "frame",
        name: "Icon/Heart",
        x: 600,
        y: 100,
        w: 24,
        h: 24,
        fill: "#EF476F",
        component: true,
      },
    },
    {
      op: "insert",
      id: "main000001",
      parent: null,
      node: {
        type: "frame",
        name: "Card/Pricing",
        x: 40,
        y: 40,
        w: 220,
        h: 240,
        fill: "#FFFFFF",
        component: true,
        layout: { dir: "column", gap: 10, pad: 16 },
      },
    },
    {
      op: "insert",
      id: "title00001",
      parent: "main000001",
      node: { type: "text", name: "Title", content: "Plan name", fill: "#2A1E14" },
    },
    {
      op: "insert",
      id: "badge00001",
      parent: "main000001",
      node: { type: "rect", name: "Badge", w: 40, h: 16, fill: "#F6DFC6" },
    },
    {
      op: "insert",
      id: "actions001",
      parent: "main000001",
      node: {
        type: "frame",
        name: "Actions",
        w: 188,
        h: 40,
        layout: { dir: "row", gap: 6 },
        slot: {},
      },
    },
    {
      op: "insert",
      id: "icon000001",
      parent: "main000001",
      node: { type: "instance", name: "Icon", of: "starmain01" },
    },
    {
      op: "insert",
      id: "inst000001",
      parent: null,
      node: { type: "instance", name: "Card · Pro", of: "main000001", x: 320, y: 40 },
    },
  ])
  if (!ok) throw new Error("components fixture rejected")
}
