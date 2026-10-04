/**
 * M4 merge conflicts e2e (board 18 "18 Merge Conflicts (M4)" dTPQO). The scenarios run against
 * a harness page (`src/conflicts/harness`: the real CanvasHost with the conflict overlay, a layer
 * list with LayerRow/Conflict, and the Conflicts panel over a DocStore) that this file builds and
 * serves itself. The board-18 fixture (`lint/CONFLICT_OPEN--board-18.kimo`) is loaded through
 * the debug hook `window.__kimoConflicts.load(text)`. The last scenario is the measured
 * getComputedStyle / getBoundingClientRect pass against the desing.pen node values.
 */
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build, type PreviewServer, preview } from "vite"
import { type E2EContext, expect, type Scenario } from "./run"

const here = fileURLToPath(new URL(".", import.meta.url))
const root = join(here, "..")
const FIXTURE = readFileSync(
  join(root, "../../packages/core-schema/fixtures/lint/CONFLICT_OPEN--board-18.kimo"),
  "utf8",
)

let served: Promise<{ url: string; server: PreviewServer }> | null = null

/** Builds and serves the harness once per run. */
function harnessUrl(): Promise<string> {
  served ??= (async () => {
    const outDir = join(tmpdir(), "kimo-e2e-m4-merge")
    const shared = { root, configFile: false as const, logLevel: "error" as const, base: "./" }
    await build({
      ...shared,
      plugins: [react()],
      build: {
        outDir,
        emptyOutDir: true,
        target: "es2022",
        rollupOptions: { input: join(root, "src/conflicts/harness/index.html") },
      },
    })
    const server = await preview({
      ...shared,
      build: { outDir },
      preview: {
        port: 49000 + Math.floor(Math.random() * 900),
        strictPort: false,
        host: "127.0.0.1",
      },
    })
    const address = server.httpServer?.address()
    const port = typeof address === "object" && address ? address.port : 0
    return { url: `http://127.0.0.1:${port}/src/conflicts/harness/index.html`, server }
  })()
  return served.then((s) => s.url)
}

type Api = {
  load(text: string): void
  store: {
    getNode(id: string): Record<string, unknown> | undefined
    hasNode(id: string): boolean
    undo(o: string): unknown
  }
  ui: { getState(): { selection: string[] } }
  session(): {
    counts(): { total: number; open: number; resolved: number }
    focused(): string | null
  } | null
  saves: string[]
  toasts: { kind: string }[]
  rejects: string[]
  mergeReady(): boolean
}
declare const window: { __kimoConflicts: Api }

async function load(page: Page): Promise<void> {
  await page.goto(await harnessUrl())
  await page.waitForFunction(
    () => !!(window as unknown as { __kimoConflicts?: unknown }).__kimoConflicts,
  )
  await page.evaluate((t) => window.__kimoConflicts.load(t), FIXTURE)
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
  await page.locator(".conflict-overlay__marker").first().waitFor({ timeout: 10_000 })
}

const texts = (page: Page, sel: string) =>
  page
    .locator(sel)
    .allInnerTexts()
    .then((a) => a.map((s) => s.trim()))
const counts = (page: Page) => page.evaluate(() => window.__kimoConflicts.session()?.counts())

async function until(page: Page, check: () => Promise<boolean>, what: string, ms = 5000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return
    await page.waitForTimeout(40)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

async function shot(ctx: E2EContext, name: string) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `m4-merge-${name}.png`) })
}

export const scenarios: Scenario[] = [
  {
    name: "m4-merge: board 18 loads — summary, groups, resolved list, layer + canvas markers",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      expect(
        (await texts(page, ".conflicts-panel__count"))[0] === "3 of 5 resolved",
        "3 of 5 resolved",
      )
      expect(
        (await texts(page, ".conflicts-panel__source"))[0] ===
          "main ← feat/pricing-v2 · base 4e1a9c2",
        "source line",
      )
      expect(
        (await texts(page, ".conflicts-panel__group-node")).join(",") === "Hero,Headline",
        "open groups in layer order",
      )
      expect(
        (await texts(page, ".conflicts-panel__group-count")).join(",") === "1 open,1 open",
        "group counts",
      )
      const props = await texts(page, ".conflicts-panel__group .kimo-conflict-row__property")
      expect(props.join(",") === "fill,content", `rows ${props}`)
      const choices = await texts(page, ".kimo-conflict-row .kimo-conflict-choice__value")
      expect(
        choices.join("|") ===
          "#FFF4E8|#FFFFFF|Plan less. Ship more together.|Plan less, ship more.",
        `choices ${choices.join("|")}`,
      )
      expect(
        (await texts(page, ".conflicts-panel__resolved-label"))[0] === "Resolved · 3",
        "Resolved · 3",
      )
      const resolved = await texts(page, ".kimo-resolved-row__choice")
      expect(
        resolved.join(",") === "kept ours · 12,took theirs,took theirs · deleted",
        `resolved ${resolved}`,
      )
      expect(
        (await texts(page, ".kimo-resolved-row__node")).join(",") ===
          "CTA Row,Button / Primary,Footer › Legal",
        "resolved nodes",
      )
      expect(await page.locator(".conflicts-panel__mark").isDisabled(), "Mark resolved disabled")
      expect(
        (await texts(page, ".conflicts-panel__hint"))[0] === "Pick a side for 2 more conflicts",
        "hint",
      )
      const layerIds = await page
        .locator(".kimo-layer-row--conflict")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-node-id")))
      expect(layerIds.join(",") === "Hero000001,Headline01", `layer markers ${layerIds}`)
      const markers = await texts(page, ".conflict-overlay__marker")
      expect(markers.join(",") === "Hero · fill,Headline · content", `canvas ${markers}`)
      expect((await page.locator(".conflict-overlay__outline").count()) === 2, "two outlines")
      await shot(ctx, "loaded")
    },
  },
  {
    name: "m4-merge: picking a side applies live on canvas and is one undo step",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      await page
        .locator('[data-conflict-id="CfHeroFil1"] .kimo-conflict-choice[data-side="theirs"]')
        .click()
      const fill = await page.evaluate(
        () => window.__kimoConflicts.store.getNode("Hero000001")?.fill,
      )
      expect(fill === "#FFFFFF", `fill ${fill}`)
      expect((await counts(page))?.resolved === 4, "4 resolved")
      await until(
        page,
        async () => (await texts(page, ".conflicts-panel__count"))[0] === "4 of 5 resolved",
        "4 of 5",
      )
      expect(
        (await texts(page, ".conflict-overlay__marker")).join(",") === "Headline · content",
        "Hero marker gone",
      )
      expect(
        (await page.locator('.kimo-layer-row--conflict[data-node-id="Hero000001"]').count()) === 0,
        "Hero layer marker gone",
      )
      expect(
        (await texts(page, ".kimo-resolved-row__choice")).includes("took theirs"),
        "resolved list has the pick",
      )
      await page.keyboard.press("ControlOrMeta+z")
      await until(page, async () => (await counts(page))?.open === 2, "undo back to 2 open")
      const back = await page.evaluate(
        () => window.__kimoConflicts.store.getNode("Hero000001")?.fill,
      )
      expect(back === "#FFF4E8", `undo restores ours: ${back}`)
    },
  },
  {
    name: "m4-merge: ⌘' selects the next conflict's node and focuses its row; markers focus too",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      await page.locator(".conflicts-panel").click({ position: { x: 5, y: 5 } })
      await page.keyboard.press("ControlOrMeta+'")
      await until(
        page,
        async () =>
          (await page.evaluate(() => window.__kimoConflicts.ui.getState().selection.join(","))) ===
          "Hero000001",
        "Hero selected",
      )
      expect(
        (await page.locator('[data-conflict-id="CfHeroFil1"][data-focused]').count()) === 1,
        "Hero row focused",
      )
      await page.keyboard.press("ControlOrMeta+'")
      await until(
        page,
        async () =>
          (await page.evaluate(() => window.__kimoConflicts.ui.getState().selection.join(","))) ===
          "Headline01",
        "Headline selected",
      )
      await page.keyboard.press("ControlOrMeta+'")
      await until(
        page,
        async () =>
          (await page.evaluate(() => window.__kimoConflicts.session()?.focused())) === "CfHeroFil1",
        "wraps to Hero",
      )
      await page.locator('.conflict-overlay__marker[data-node-id="Headline01"]').click()
      await until(
        page,
        async () =>
          (await page.evaluate(() => window.__kimoConflicts.session()?.focused())) === "CfHeadlin1",
        "marker focuses Headline",
      )
    },
  },
  {
    name: "m4-merge: Take all ours, then Mark resolved & save (toast + Ready to commit)",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      await page.getByRole("button", { name: "Take all ours" }).click()
      await until(page, async () => (await counts(page))?.open === 0, "all resolved")
      expect(!(await page.locator(".conflicts-panel__mark").isDisabled()), "Mark resolved enabled")
      expect(
        (await texts(page, ".conflicts-panel__hint"))[0] ===
          "5 of 5 resolved · writes marketing.kimo without conflict nodes",
        "ready hint",
      )
      expect((await page.locator(".conflict-overlay__marker").count()) === 0, "no markers")
      await shot(ctx, "ready")
      await page.locator(".conflicts-panel__mark").click()
      await until(
        page,
        async () => (await page.evaluate(() => window.__kimoConflicts.saves.length)) === 1,
        "saved",
      )
      const saved = await page.evaluate(() => JSON.parse(window.__kimoConflicts.saves[0] as string))
      expect(saved.conflicts === undefined && saved.merge === undefined, "conflicts removed")
      expect(!(saved.features ?? []).includes("merge/conflicts"), "feature removed")
      const toasts = await page.evaluate(() => window.__kimoConflicts.toasts.map((t) => t.kind))
      expect(toasts.join(",") === "merge-saved", `toasts ${toasts}`)
      expect(await page.evaluate(() => window.__kimoConflicts.mergeReady()), "merge-ready banner")
    },
  },
  {
    name: "m4-merge: measured pass (Conflicts panel, ConflictRow/Choice, markers) vs desing.pen",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      const m = await page.evaluate(() => {
        const q = (s: string) => document.querySelector(s) as HTMLElement | null
        const box = (e: Element | null) => {
          if (!e) return null
          const r = e.getBoundingClientRect()
          const cs = getComputedStyle(e)
          return {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            display: cs.display,
            pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat),
            gap: parseFloat(cs.columnGap) || parseFloat(cs.rowGap) || 0,
            fs: parseFloat(cs.fontSize),
            fw: cs.fontWeight,
            ff: cs.fontFamily.split(",")[0]?.replace(/"/g, ""),
            bt: parseFloat(cs.borderTopWidth),
            bb: parseFloat(cs.borderBottomWidth),
            bl: parseFloat(cs.borderLeftWidth),
            radius: parseFloat(cs.borderTopLeftRadius),
            bg: cs.backgroundColor,
            color: cs.color,
            opacity: cs.opacity,
            shadow: parseFloat(cs.boxShadow.match(/0px 0px 0px ([\d.]+)px inset/)?.[1] ?? "0"),
            justify: cs.justifyContent,
            align: cs.alignItems,
          }
        }
        const heroRow = q('.conflicts-panel__group [data-conflict-id="CfHeroFil1"]')
        const headRow = q('.conflicts-panel__group [data-conflict-id="CfHeadlin1"]')
        const heroBox = q('.conflict-overlay__outline[data-node-id="Headline01"]')
        const headMarker = q('.conflict-overlay__marker[data-node-id="Headline01"]')
        return {
          panel: box(q(".conflicts-panel")),
          summary: box(q(".conflicts-panel__summary")),
          title: box(q(".conflicts-panel__title")),
          count: box(q(".conflicts-panel__count")),
          progress: box(q(".conflicts-panel__progress")),
          progressFill: box(q(".conflicts-panel__progress-fill")),
          source: box(q(".conflicts-panel__source")),
          pickAll: box(q(".conflicts-panel__pick-all")),
          pick: box(q(".conflicts-panel__pick")),
          groupHeader: box(q(".conflicts-panel__group-header")),
          groupIcon: box(q(".conflicts-panel__group-icon")),
          groupNode: box(q(".conflicts-panel__group-node")),
          row: box(heroRow),
          rowContent: box(headRow),
          head: box(heroRow?.querySelector(".kimo-conflict-row__head") ?? null),
          status: box(heroRow?.querySelector(".kimo-conflict-row__status") ?? null),
          property: box(heroRow?.querySelector(".kimo-conflict-row__property") ?? null),
          choice: box(heroRow?.querySelector(".kimo-conflict-choice") ?? null),
          radio: box(heroRow?.querySelector(".kimo-conflict-choice__radio") ?? null),
          swatch: box(heroRow?.querySelector(".kimo-conflict-choice__swatch") ?? null),
          value: box(heroRow?.querySelector(".kimo-conflict-choice__value") ?? null),
          side: box(heroRow?.querySelector(".kimo-conflict-choice__side") ?? null),
          resolved: box(q(".conflicts-panel__resolved")),
          resolvedHeader: box(q(".conflicts-panel__resolved-header")),
          resolvedRow: box(q(".kimo-resolved-row__row")),
          resolvedStatus: box(q(".kimo-resolved-row__status")),
          footer: box(q(".conflicts-panel__footer")),
          mark: box(q(".conflicts-panel__mark")),
          hint: box(q(".conflicts-panel__hint")),
          layerMarker: box(q(".kimo-layer-row--conflict .kimo-conflict-marker")),
          layerMarkerIcon: box(q(".kimo-layer-row--conflict .kimo-conflict-marker > svg")),
          layerRow: box(q(".kimo-layer-row--conflict")),
          canvasMarker: box(headMarker),
          canvasIcon: box(headMarker?.querySelector("svg") ?? null),
          canvasLabel: box(
            headMarker?.querySelector(".kimo-canvas-conflict-marker__label") ?? null,
          ),
          outline: box(heroBox),
        }
      })
      type B = NonNullable<(typeof m)["panel"]>
      const rows: [string, string, number | string, number | string][] = []
      const near = (a: number, b: number, tol = 0.75) => Math.abs(a - b) <= tol
      const check = (
        el: string,
        prop: string,
        actual: number | string | undefined,
        want: number | string,
        tol?: number,
      ) => {
        rows.push([el, prop, want, actual ?? "∅"])
        const ok =
          typeof want === "number"
            ? typeof actual === "number" && near(actual, want, tol)
            : actual === want
        expect(ok, `${el} ${prop}: want ${want}, got ${actual}`)
      }
      // biome-ignore lint/suspicious/noExplicitAny: measured values are numbers, strings or arrays by key
      const g = (b: B | null, k: keyof B): any => (b ? b[k] : undefined)
      // Conflicts Panel cNrNM (280 wide in the board's right panel; the harness aside is 280 −1 border).
      check("Summary dsAsJ", "padding-top", g(m.summary, "pad")?.[0], 12)
      check("Summary dsAsJ", "gap", g(m.summary, "gap"), 8)
      check("Summary dsAsJ", "border-bottom", g(m.summary, "bb"), 1)
      check("Summary dsAsJ", "height", g(m.summary, "h"), 114, 1)
      check("Title KRyTs", "font-size", g(m.title, "fs"), 12)
      check("Title KRyTs", "font-weight", g(m.title, "fw"), "600")
      check("Count B09XG", "font-size", g(m.count, "fs"), 11)
      check("Progress BxNy8", "height", g(m.progress, "h"), 4)
      check("Progress BxNy8", "width", g(m.progress, "w"), (g(m.summary, "w") as number) - 24)
      check(
        "Resolved QtFsi",
        "width (3/5)",
        g(m.progressFill, "w"),
        ((g(m.progress, "w") as number) * 3) / 5,
      )
      check("Source XCDbb", "font-size", g(m.source, "fs"), 11)
      check("Source XCDbb", "font", g(m.source, "ff"), "JetBrains Mono")
      check("Pick All Zzg9m", "padding-top", g(m.pickAll, "pad")?.[0], 4)
      check("Pick All Zzg9m", "gap", g(m.pickAll, "gap"), 6)
      check("Take all ours WyYCl", "height", g(m.pick, "h"), 28)
      check("Take all ours WyYCl", "padding-x", g(m.pick, "pad")?.[1], 10)
      check("Take all ours WyYCl", "width", g(m.pick, "w"), ((g(m.pickAll, "w") as number) - 6) / 2)
      check("Take all ours WyYCl", "font-size", g(m.pick, "fs"), 12)
      check("Take all ours WyYCl", "justify", g(m.pick, "justify"), "center")
      check("Group Header time9", "padding-top", g(m.groupHeader, "pad")?.[0], 12)
      check("Group Header time9", "padding-bottom", g(m.groupHeader, "pad")?.[2], 2)
      check("Group Header time9", "height", g(m.groupHeader, "h"), 27)
      check("Group Header time9", "gap", g(m.groupHeader, "gap"), 6)
      check("Icon liWrH", "size", g(m.groupIcon, "w"), 12)
      check("Node UCvpD", "font-weight", g(m.groupNode, "fw"), "600")
      // ConflictRow uP9RN / ConflictChoice o2cOff.
      // Board 20 ConflictRow/Base (b3xOtr): the Base Toggle (h 18) makes the head 18 tall, so
      // the row is 112 (board 18's 109 + 3); the two-line content row grows the same.
      check("ConflictRow/Base b3xOtr · fill", "height", g(m.row, "h"), 112, 1.5)
      check("ConflictRow/Base · content", "height", g(m.rowContent, "h"), 127, 1.5)
      check(
        "ConflictRow uP9RN",
        "padding",
        (g(m.row, "pad") as number[] | undefined)?.join(" "),
        "10 12 9 12",
      )
      check("ConflictRow uP9RN", "gap", g(m.row, "gap"), 6)
      check("ConflictRow uP9RN", "border-bottom", g(m.row, "bb"), 1)
      check("Head pApQH", "gap", g(m.head, "gap"), 6)
      check("Status vwMkN", "size", g(m.status, "w"), 14)
      check("Status vwMkN", "color (danger)", g(m.status, "color"), "rgb(221, 34, 41)")
      check("Property GXuAU", "font-weight", g(m.property, "fw"), "500")
      check("Property GXuAU", "font", g(m.property, "ff"), "JetBrains Mono")
      check(
        "ConflictChoice o2cOff",
        "padding + inside stroke",
        (g(m.choice, "pad")?.[0] as number) + (g(m.choice, "bt") as number),
        8,
      )
      check("ConflictChoice o2cOff", "height", g(m.choice, "h"), 31, 1)
      check("ConflictChoice o2cOff", "gap", g(m.choice, "gap"), 8)
      check("ConflictChoice o2cOff", "border", g(m.choice, "bt"), 1)
      check("ConflictChoice o2cOff", "radius", g(m.choice, "radius"), 6)
      check("ConflictChoice o2cOff", "width", g(m.choice, "w"), (g(m.row, "w") as number) - 24)
      check("Radio OYfDz", "size", g(m.radio, "w"), 14)
      check("Radio OYfDz", "stroke (inset)", g(m.radio, "shadow"), 1.5, 0.01)
      check("Swatch W3tggP", "size", g(m.swatch, "w"), 12)
      check("Swatch W3tggP", "fill", g(m.swatch, "bg"), "rgb(255, 244, 232)")
      check("Value yGCTb", "font-size", g(m.value, "fs"), 11)
      check("Side zeVrc", "font-size", g(m.side, "fs"), 11)
      // Resolved KzQy6.
      check("Resolved KzQy6", "padding-top", g(m.resolved, "pad")?.[0], 12)
      check("Resolved Header e1NP6n", "padding-bottom", g(m.resolvedHeader, "pad")?.[2], 4)
      check("Resolved Header e1NP6n", "height", g(m.resolvedHeader, "h"), 17)
      check("Resolved · CTA Row AnPLa", "height", g(m.resolvedRow, "h"), 28)
      check("Resolved · CTA Row AnPLa", "padding-x", g(m.resolvedRow, "pad")?.[1], 12)
      check("Resolved · CTA Row AnPLa", "gap", g(m.resolvedRow, "gap"), 6)
      check("Status f4l9i", "size", g(m.resolvedStatus, "w"), 14)
      // Footer L9mpx.
      check(
        "Footer L9mpx",
        "padding-top + inside stroke",
        (g(m.footer, "pad")?.[0] as number) + (g(m.footer, "bt") as number),
        12,
      )
      check("Footer L9mpx", "gap", g(m.footer, "gap"), 8)
      check("Footer L9mpx", "border-top", g(m.footer, "bt"), 1)
      check("Footer L9mpx", "height", g(m.footer, "h"), 77, 1)
      check("Mark Resolved vQdpL", "height", g(m.mark, "h"), 32)
      check("Mark Resolved vQdpL", "opacity", g(m.mark, "opacity"), "0.4")
      check("Mark Resolved vQdpL", "width", g(m.mark, "w"), (g(m.footer, "w") as number) - 24)
      check("Hint A2bUn2", "font-size", g(m.hint, "fs"), 11)
      // Layer row + markers.
      check("LayerRow/Conflict VpvIr", "height", g(m.layerRow, "h"), 28)
      check("ConflictMarker VXsYo", "size", g(m.layerMarker, "w"), 16)
      check("ConflictMarker VXsYo", "height", g(m.layerMarker, "h"), 16)
      check(
        "ConflictMarker VXsYo",
        "radius ≥ h/2 (pill)",
        (g(m.layerMarker, "radius") as number) >= 8 ? "pill" : "square",
        "pill",
      )
      check("Icon kWIm4", "size", g(m.layerMarkerIcon, "w"), 10)
      check("CanvasMarker/Conflict ar36v", "height", g(m.canvasMarker, "h"), 20)
      check(
        "CanvasMarker/Conflict ar36v",
        "padding",
        (g(m.canvasMarker, "pad") as number[] | undefined)?.join(" "),
        "0 8 0 6",
      )
      check("CanvasMarker/Conflict ar36v", "gap", g(m.canvasMarker, "gap"), 4)
      check("Icon gTAr8", "size", g(m.canvasIcon, "w"), 12)
      check("Label Elf3t", "font-weight", g(m.canvasLabel, "fw"), "600")
      check("Conflict Outline fawpR", "stroke (inset)", g(m.outline, "shadow"), 1.5, 0.01)
      // At the fitted zoom the Headline pill overlaps the Hero pill, so board 20's stacking rule
      // moves it up by pill height + 4 (24 + 24); unstacked it sits 24 above its node.
      const gap = (g(m.outline, "y") as number) - (g(m.canvasMarker, "y") as number)
      check("Marker vs outline", "gap above node (24, or 48 stacked)", gap, gap > 36 ? 48 : 24)
      check(
        "Marker vs outline",
        "left aligned",
        (g(m.outline, "x") as number) - (g(m.canvasMarker, "x") as number),
        0,
      )
      // Every overlay element has a box and is displayed.
      expect(g(m.outline, "h") > 0 && g(m.outline, "display") !== "none", "outline has a box")
      ctx.log("\n    | element | property | design | measured |\n    |---|---|---|---|")
      for (const [el, prop, want, got] of rows)
        ctx.log(
          `| ${el} | ${prop} | ${want} | ${typeof got === "number" ? Math.round(got * 100) / 100 : got} |`,
        )
      await shot(ctx, "measured")
    },
  },
  {
    name: "m4-merge: board 20 polish — base toggle, resolved expand + Reopen, pill stacking (measured)",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      const rowSel = '.conflicts-panel__group [data-conflict-id="CfHeroFil1"]'
      // Base toggle: collapsed by default, opens the mono base line.
      const toggle = page.locator(`${rowSel} .kimo-conflict-row__base-toggle`)
      expect((await toggle.getAttribute("aria-expanded")) === "false", "base collapsed")
      await toggle.click()
      await page.locator(`${rowSel} .kimo-conflict-base`).waitFor()
      const baseText = (await page.locator(`${rowSel} .kimo-conflict-base`).innerText())
        .replace(/\s+/g, " ")
        .trim()
      expect(baseText === "base #FFF7EE 4e1a9c2", `base line: ${baseText}`)
      // Resolved row: expand in place, both sides + base + Reopen.
      const cta = page.locator('.kimo-resolved-row[data-conflict-id="CfCtaGap01"]')
      await cta.locator(".kimo-resolved-row__row").click()
      await cta.locator(".kimo-resolved-row__reopen").waitFor()
      const m = await page.evaluate((sel) => {
        const box = (e: Element | null) => {
          if (!e) return null
          const r = e.getBoundingClientRect()
          const cs = getComputedStyle(e)
          return {
            w: r.width,
            h: r.height,
            display: cs.display,
            pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat),
            gap: parseFloat(cs.columnGap) || parseFloat(cs.rowGap) || 0,
            fs: parseFloat(cs.fontSize),
            ff: cs.fontFamily.split(",")[0]?.replace(/"/g, ""),
            bg: cs.backgroundColor,
            radius: parseFloat(cs.borderTopLeftRadius),
          }
        }
        const q = (s: string) => document.querySelector(s)
        const row = q(sel)
        const exp = q('.kimo-resolved-row[data-conflict-id="CfCtaGap01"]')
        return {
          row: box(row),
          toggle: box(row?.querySelector(".kimo-conflict-row__base-toggle") ?? null),
          toggleLabel: box(row?.querySelector(".kimo-conflict-row__base-toggle-label") ?? null),
          chevron: box(row?.querySelector(".kimo-conflict-row__base-toggle-chevron") ?? null),
          head: box(row?.querySelector(".kimo-conflict-row__head") ?? null),
          base: box(row?.querySelector(".kimo-conflict-base") ?? null),
          baseSwatch: box(row?.querySelector(".kimo-conflict-base__swatch") ?? null),
          baseValue: box(row?.querySelector(".kimo-conflict-base__value") ?? null),
          expanded: box(exp),
          expRow: box(exp?.querySelector(".kimo-resolved-row__row") ?? null),
          detail: box(exp?.querySelector(".kimo-resolved-row__detail") ?? null),
          expBase: box(exp?.querySelector(".kimo-conflict-base") ?? null),
          actions: box(exp?.querySelector(".kimo-resolved-row__actions") ?? null),
          reopen: box(exp?.querySelector(".kimo-resolved-row__reopen") ?? null),
          reopenIcon: box(
            exp?.querySelector(".kimo-resolved-row__reopen .kimo-button__icon") ?? null,
          ),
          chevronUp: box(exp?.querySelector(".kimo-resolved-row__chevron") ?? null),
        }
      }, rowSel)
      const log: string[] = []
      const near = (a: number | undefined, b: number, tol = 0.75) =>
        typeof a === "number" && Math.abs(a - b) <= tol
      const check = (
        el: string,
        prop: string,
        got: number | string | undefined,
        want: number | string,
        tol?: number,
      ) => {
        log.push(
          `| ${el} | ${prop} | ${want} | ${typeof got === "number" ? Math.round(got * 100) / 100 : got} |`,
        )
        expect(
          typeof want === "number" ? near(got as number, want, tol) : got === want,
          `${el} ${prop}: want ${want}, got ${got}`,
        )
      }
      check("ConflictRow/Base/Open d4P5H", "height", m.row?.h, 138, 1.5)
      check("Head KEKwy", "height", m.head?.h, 44, 0.75)
      check("Head KEKwy", "gap", m.head?.gap, 6)
      check("Base Toggle ZmwPH", "height", m.toggle?.h, 18)
      check("Base Toggle ZmwPH", "padding", m.toggle?.pad.join(" "), "0 4 0 6")
      check("Base Toggle ZmwPH", "gap", m.toggle?.gap, 2)
      check(
        "Base Toggle ZmwPH",
        "fill (bg-muted)",
        m.toggle?.bg !== "rgba(0, 0, 0, 0)" ? "muted" : "none",
        "muted",
      )
      check("Label zJyDm", "font", m.toggleLabel?.ff, "JetBrains Mono")
      check("Chevron n3UqRO", "size", m.chevron?.w, 12)
      check("Base HEuRD", "height", m.base?.h, 20)
      check("Base HEuRD", "padding-left", m.base?.pad[3], 20)
      check("Base HEuRD", "gap", m.base?.gap, 6)
      check("Base Swatch g1Lsf", "size", m.baseSwatch?.w, 12)
      check("Base Value s3dO3a", "font-size", m.baseValue?.fs, 11)
      check("ResolvedRow/Expanded OPe5M", "height", m.expanded?.h, 170, 1.5)
      check("ResolvedRow/Expanded OPe5M", "padding-bottom", m.expanded?.pad[2], 10)
      check("ResolvedRow/Expanded OPe5M", "gap", m.expanded?.gap, 6)
      check("Row WHL5X", "height", m.expRow?.h, 28)
      check("Chevron XNeYa", "size", m.chevronUp?.w, 12)
      check("Detail kECtq", "height", m.detail?.h, 126, 1.5)
      check("Detail kECtq", "padding-x", m.detail?.pad[1], 12)
      check("Base bdpQx", "padding-left", m.expBase?.pad[3], 4)
      check("Actions jmxOT", "height", m.actions?.h, 26)
      check("Reopen n8hRv", "height", m.reopen?.h, 26)
      check("Reopen n8hRv", "padding-x", m.reopen?.pad[1], 10)
      check("Reopen n8hRv", "font-size", m.reopen?.fs, 11)
      check("Reopen icon zAVGx", "size", m.reopenIcon?.w, 12)
      ctx.log(
        `\n    | element | property | design | measured |\n    |---|---|---|---|\n${log.join("\n")}`,
      )
      await shot(ctx, "board20-polish")
      // Reopen moves the row back to its group as open.
      await cta.locator(".kimo-resolved-row__reopen").click()
      await until(page, async () => (await counts(page))?.open === 3, "3 open after Reopen")
      expect(
        (await page.locator('.conflicts-panel__group [data-conflict-id="CfCtaGap01"]').count()) ===
          1,
        "reopened row is in its group",
      )
      // Pill stacking: zoomed far out the Hero and Headline pills overlap → the later one stacks.
      await page.evaluate(() => {
        const ui = window.__kimoConflicts.ui as unknown as {
          getState(): { setViewport(v: { x: number; y: number; zoom: number }): void }
        }
        ui.getState().setViewport({ x: -100, y: -1200, zoom: 0.05 })
      })
      await until(
        page,
        async () => (await page.locator(".conflict-overlay__marker").count()) >= 2,
        "markers at low zoom",
      )
      const pills = await page.locator(".conflict-overlay__marker").evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect()
          return {
            id: e.getAttribute("data-node-id"),
            more: e.classList.contains("kimo-canvas-conflict-marker--more"),
            y: r.y,
            h: r.height,
            text: (e as HTMLElement).innerText.trim(),
          }
        }),
      )
      const more = pills.find((p) => p.more)
      if (more) {
        expect(/^\+\d+$/.test(more.text), `+N pill ${more.text}`)
        await page.locator(".kimo-canvas-conflict-marker--more").click()
        // Board 24 (l): the conflicts menu (c2CNAR) replaced the Menu/Dense "Hidden conflicts".
        await page.getByRole("menu", { name: /more conflicts$/ }).waitFor()
      } else {
        const ys = pills.map((p) => p.y).sort((a, b) => a - b)
        expect(
          ys.length >= 2 && near((ys[1] as number) - (ys[0] as number), 24, 1),
          `stacked pills ${JSON.stringify(pills)}`,
        )
      }
    },
  },
  {
    name: "board24 (l): conflict '+N' menu — 240 wide, middle-truncated paths, row selects (measured)",
    async run(ctx) {
      const { page } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      await load(page)
      // Far out every pill overlaps: the first pill + "+N".
      await page.evaluate(() => {
        const ui = window.__kimoConflicts.ui as unknown as {
          getState(): { setViewport(v: { x: number; y: number; zoom: number }): void }
        }
        ui.getState().setViewport({ x: -100, y: -1200, zoom: 0.02 })
      })
      // Reopen every resolved node conflict: 3+ overlapping pills collapse into "+N".
      await page.evaluate(() => {
        const s = window.__kimoConflicts.session() as unknown as {
          rows(): { id: string; nodeId: string | null; resolved: boolean }[]
          reopen(id: string): void
        }
        for (const r of s.rows()) if (r.resolved && r.nodeId) s.reopen(r.id)
      })
      const more = page.locator(".kimo-canvas-conflict-marker--more")
      await more.waitFor({ timeout: 10_000 })
      await more.click()
      const menu = page.locator(".kimo-conflict-more-menu")
      await menu.waitFor()
      const m = await page.evaluate(() => {
        const q = (sel: string) => {
          const e = document.querySelector(sel)
          if (!e) return null
          const r = e.getBoundingClientRect()
          const cs = getComputedStyle(e)
          return {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat),
            gap: parseFloat(cs.columnGap) || 0,
            fs: parseFloat(cs.fontSize),
            ff: cs.fontFamily.split(",")[0]?.replace(/"/g, "").trim(),
            radius: parseFloat(cs.borderTopLeftRadius),
            color: cs.color,
            shadow: cs.boxShadow,
            display: cs.display,
          }
        }
        return {
          menu: q(".kimo-conflict-more-menu"),
          group: q(".kimo-conflict-more-menu__group"),
          groupLabel: q(".kimo-conflict-more-menu__group-label"),
          item: q(".kimo-conflict-more-menu__item"),
          icon: q(".kimo-conflict-more-menu__icon"),
          label: q(".kimo-conflict-more-menu__label"),
          meta: q(".kimo-conflict-more-menu__meta"),
          danger: (() => {
            const el = document.createElement("div")
            el.style.color = "var(--kimo-danger)"
            document.body.append(el)
            const c = getComputedStyle(el).color
            el.remove()
            return c
          })(),
        }
      })
      const log: string[] = []
      const check = (el: string, prop: string, got: unknown, want: number | string, tol = 0.75) => {
        const ok =
          typeof want === "number"
            ? typeof got === "number" && Math.abs(got - want) <= tol
            : got === want
        log.push(
          `| ${el} | ${prop} | ${want} | ${typeof got === "number" ? Math.round(got * 100) / 100 : got} |`,
        )
        expect(ok, `${el} ${prop}: want ${want}, got ${got}`)
      }
      const labels = await texts(page, ".kimo-conflict-more-menu__label")
      const full = await page
        .locator(".kimo-conflict-more-menu__item")
        .evaluateAll((els) => els.map((e) => e.getAttribute("title")))
      ctx.log(`    rows: ${JSON.stringify(labels)} full: ${JSON.stringify(full)}`)
      // 240 unless a name is long: then it grows, up to 320 (and the name middle-truncates).
      const long = full.some((t) => t !== null)
      check("Menu OJl8h", "width (240, max 320)", m.menu?.w, long ? 320 : 240)
      check("Menu OJl8h", "padding", m.menu?.pad[0], 4)
      check("Menu OJl8h", "radius (radius-md)", m.menu?.radius, 10)
      check("Menu OJl8h", "shadow 0 8 24", /0px 8px 24px/.test(m.menu?.shadow ?? "") ? 1 : 0, 1)
      check("Group aKs8f", "padding-top", m.group?.pad[0], 6)
      check("Group aKs8f", "padding-bottom", m.group?.pad[2], 4)
      check("Group aKs8f", "padding-x", m.group?.pad[1], 8)
      check(
        "Group label dnp0l",
        "font",
        `${m.groupLabel?.ff} ${m.groupLabel?.fs}`,
        "JetBrains Mono 11",
      )
      check("Group aKs8f", "height", m.group?.h, 25)
      check("Item XJjNE", "height", m.item?.h, 28)
      check("Item XJjNE", "width (menu − 2 × 4)", m.item?.w, (m.menu?.w ?? 0) - 8)
      check("Item XJjNE", "padding-x", m.item?.pad[1], 8)
      check("Item XJjNE", "gap", m.item?.gap, 8)
      check("Item XJjNE", "radius-sm", m.item?.radius, 6)
      check("Icon JZM0n", "size", m.icon?.w, 14)
      check("Icon JZM0n", "color danger", m.icon?.color, m.danger)
      check("Icon JZM0n", "x (item + 8)", (m.icon?.x ?? 0) - (m.item?.x ?? 0), 8)
      check("Label yP8x0", "font", `${m.label?.ff} ${m.label?.fs}`, "Inter 12")
      check("Label yP8x0", "x (icon + 14 + 8)", (m.label?.x ?? 0) - (m.icon?.x ?? 0), 22)
      check("Meta hMjfC", "font", `${m.meta?.ff} ${m.meta?.fs}`, "JetBrains Mono 11")
      check(
        "Meta hMjfC",
        "right inset 8",
        (m.item?.x ?? 0) + (m.item?.w ?? 0) - ((m.meta?.x ?? 0) + (m.meta?.w ?? 0)),
        8,
      )
      check(
        "Menu",
        "top = +N bottom + 4",
        (m.menu?.y ?? 0) - ((await more.boundingBox())?.y ?? 0) - 20,
        4,
      )
      ctx.log(
        `\n    | element | property | design | measured |\n    |---|---|---|---|\n${log.join("\n")}`,
      )
      expect(
        labels.every((l) => !l.includes(" › ")),
        `paths use " / ": ${labels.join(" | ")}`,
      )
      // Row click: select + zoom to the conflicted node.
      await page.locator(".kimo-conflict-more-menu__item").first().click()
      await menu.waitFor({ state: "detached" })
      await until(
        page,
        async () =>
          (await page.evaluate(() => window.__kimoConflicts.ui.getState().selection.length)) === 1,
        "selection after row click",
      )
      await shot(ctx, "board24-plus-n-menu")
    },
  },
]
