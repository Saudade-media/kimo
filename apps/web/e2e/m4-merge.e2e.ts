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
      const resolved = await texts(page, ".conflicts-panel__resolved-choice")
      expect(
        resolved.join(",") === "kept ours · 12,took theirs,took theirs · deleted",
        `resolved ${resolved}`,
      )
      expect(
        (await texts(page, ".conflicts-panel__resolved-node")).join(",") ===
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
        (await texts(page, ".conflicts-panel__resolved-choice")).includes("took theirs"),
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
          resolvedRow: box(q(".conflicts-panel__resolved-row")),
          resolvedStatus: box(q(".conflicts-panel__resolved-status")),
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
      check("ConflictRow · fill", "height", g(m.row, "h"), 109, 1.5)
      check("ConflictRow · content", "height", g(m.rowContent, "h"), 124, 1.5)
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
      check(
        "Marker vs outline",
        "gap above node (24)",
        (g(m.outline, "y") as number) - (g(m.canvasMarker, "y") as number),
        24,
      )
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
]
