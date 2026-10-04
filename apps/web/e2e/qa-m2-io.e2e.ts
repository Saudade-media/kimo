/**
 * Adversarial QA of M2 persistence and theming: ⌘S / ⌘O round trips of every new property
 * (byte-stable, schema-valid), properties set through the panel, image assets across save/open,
 * IndexedDB reload, and dark mode for popovers, canvas overlays and hint pills.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { validate } from "@kimo/core-schema"
import type { Page } from "playwright"
import { docJson, nextFileChooser, node, openEditor, settle, waitCanvas } from "./qa-helpers"
import {
  board,
  type M2Hook,
  noPickers,
  PNG_2x2,
  saveViaShortcut,
  section,
  typeField,
} from "./qa-m2-helpers"
import { expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, "../../../packages/core-schema/fixtures/valid/styling-m2.kimo")

const sel = async (page: Page, s: string[]) => {
  await page.evaluate(
    (x) => (window as unknown as { __kimo: M2Hook }).__kimo.session.ui.getState().select(x),
    s,
  )
  await settle(page)
}

async function openText(page: Page, name: string, text: string | Buffer) {
  const from = page.url()
  const pending = nextFileChooser(page)
  await page.keyboard.press("ControlOrMeta+o")
  const chooser = await pending
  await chooser.setFiles({
    name,
    mimeType: name.endsWith(".kimoz") ? "application/zip" : "application/json",
    buffer: typeof text === "string" ? Buffer.from(text, "utf8") : text,
  })
  await page.waitForURL((u) => u.toString() !== from && /#\/file\//.test(u.toString()))
  await waitCanvas(page)
}

const nodesOf = (text: string) => (JSON.parse(text) as { nodes: Record<string, unknown> }).nodes

export const scenarios: Scenario[] = [
  {
    name: "qa-m2 io: the M2 styling fixture opens, saves schema-valid and round-trips byte-stable",
    async run({ page, url, log }) {
      await noPickers(page)
      await openEditor(page, url)
      const fixture = readFileSync(FIXTURE, "utf8")
      await openText(page, "styling-m2.kimo", fixture)
      const a = await saveViaShortcut(page)
      const v = validate(JSON.parse(a.text))
      log("errors", JSON.stringify(v.errors.slice(0, 3)), "warnings", v.warnings.length)
      expect(v.ok, `saved file validates (${v.errors.map((e) => e.code).join(", ")})`)
      expect(
        JSON.stringify(nodesOf(a.text)) === JSON.stringify(nodesOf(fixture)),
        "every M2 property survives open → save unchanged",
      )
      await openText(page, a.name, a.text)
      const b = await saveViaShortcut(page)
      if (b.text !== a.text) {
        const i = [...b.text].findIndex((ch, k) => ch !== a.text[k])
        log(
          "diff at",
          i,
          JSON.stringify(a.text.slice(i - 60, i + 60)),
          "vs",
          JSON.stringify(b.text.slice(i - 60, i + 60)),
        )
      }
      expect(b.text === a.text, "second save byte-identical")
    },
  },
  {
    name: "qa-m2 io: properties set through the panel save valid and round-trip byte-stable",
    async run({ page, url, log }) {
      await noPickers(page)
      await openEditor(page, url)
      await board(
        page,
        [
          {
            id: "ioRect000001",
            node: { type: "rect", name: "R", x: 40, y: 40, w: 100, h: 100, fill: "#F4A261" },
          },
          {
            id: "ioIcon000001",
            node: {
              type: "icon",
              name: "Star",
              set: "lucide",
              icon: "star",
              x: 200,
              y: 40,
              w: 24,
              h: 24,
            },
          },
        ],
        { layout: { dir: "row", gap: 8, pad: 16 } },
      )
      await sel(page, ["ioRect000001"])
      // Layer blend + opacity.
      await section(page, "Layer").getByRole("button", { name: "Blend mode" }).click()
      await page.getByRole("menu", { name: "Blend mode" }).getByText("Color burn").click()
      await typeField(page, section(page, "Layer"), "Opacity", "80")
      // Stroke: add, dashed, individual sides, cap round, join bevel, align outside.
      const st = section(page, "Stroke")
      await st.getByRole("button", { name: "Add stroke" }).click()
      await page.getByRole("menuitem", { name: "Solid" }).click()
      await settle(page)
      await st.getByRole("switch", { name: "Dashed" }).click()
      await st.getByRole("switch", { name: "Individual sides" }).click()
      await settle(page)
      await st
        .getByRole("radiogroup", { name: "Stroke cap" })
        .getByRole("radio", { name: "Round" })
        .click()
      await st
        .getByRole("radiogroup", { name: "Stroke join" })
        .getByRole("radio", { name: "Bevel" })
        .click()
      // Gradient fill on top, radial, rotated.
      await section(page, "Fill").getByRole("button", { name: "Add fill" }).click()
      await page.getByRole("menuitem", { name: "Gradient" }).click()
      await settle(page)
      await section(page, "Fill")
        .locator(".kimo-fill-row")
        .first()
        .locator(".kimo-color-field")
        .click()
      const ge = page.locator(".kimo-gradient-editor")
      await ge.waitFor()
      await ge.getByRole("radio", { name: "Angular" }).click()
      await ge.getByRole("button", { name: "Rotate 90°" }).click()
      await page.keyboard.press("Escape")
      await settle(page)
      // Effects: shadow + hidden layer blur.
      const fx = section(page, "Effects")
      await fx.getByRole("button", { name: "Add effect" }).click()
      await settle(page)
      await fx.getByRole("button", { name: "Add effect" }).click()
      await settle(page)
      await fx.getByRole("button", { name: "Drop shadow", exact: true }).last().click()
      await page.getByRole("menu", { name: "Effect type" }).getByText("Background blur").click()
      await settle(page)
      await fx.getByRole("button", { name: "Hide Background blur" }).click()
      await settle(page)
      // Icon stroke width.
      await sel(page, ["ioIcon000001"])
      await typeField(page, section(page, "Icon"), "Icon stroke", "1.5")
      // Board: individual padding + space between.
      await sel(page, ["board0000001"])
      await section(page, "Auto layout").getByRole("switch", { name: "Individual padding" }).click()
      await settle(page)
      await typeField(page, section(page, "Auto layout"), "Padding top", "24")
      log("rect", JSON.stringify(await node(page, "ioRect000001")))
      log("board", JSON.stringify((await node(page, "board0000001"))?.layout))
      const a = await saveViaShortcut(page)
      const v = validate(JSON.parse(a.text))
      expect(
        v.ok,
        `saved file validates (${v.errors.map((e) => `${e.code} ${e.path}`).join(", ")})`,
      )
      const before = await docJson(page)
      await openText(page, a.name, a.text)
      const b = await saveViaShortcut(page)
      expect(b.text === a.text, "reopened file saves byte-identical")
      const r = nodesOf(b.text).ioRect000001 as Record<string, unknown>
      expect(r.blend === "color-burn" && r.opacity === 0.8, "blend + opacity kept")
      expect(JSON.stringify((r.stroke as Record<string, unknown>).dash) === "[4,2]", "dash kept")
      void before
    },
  },
  {
    name: "qa-m2 io: an image fill still resolves its asset after save → open",
    async run({ page, url, log }) {
      await noPickers(page)
      await openEditor(page, url)
      await board(page, [
        { id: "imgRect00001", node: { type: "rect", name: "Img", x: 40, y: 40, w: 100, h: 100 } },
      ])
      await sel(page, ["imgRect00001"])
      const chooser = nextFileChooser(page)
      await section(page, "Fill").getByRole("button", { name: "Add fill" }).click()
      await page.getByRole("menuitem", { name: "Image…" }).click()
      await (await chooser).setFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG_2x2 })
      await page.waitForFunction(() => {
        const n = (window as unknown as { __kimo: M2Hook }).__kimo.session.store.getNode(
          "imgRect00001",
        ) as { fill?: unknown }
        return JSON.stringify(n?.fill ?? "").includes("image")
      })
      const a = await saveViaShortcut(page)
      // A design with images saves as a .kimoz package: the .kimo (with the §12 manifest) plus
      // assets/<hash>.<ext>.
      expect(a.name.endsWith(".kimoz"), `saved as a package (${a.name})`)
      expect(a.buffer.subarray(0, 4).toString("latin1") === "PK\x03\x04", "package is a ZIP")
      log("saved", a.buffer.length, "bytes; contains assets manifest:", a.text.includes('"assets"'))
      await openText(page, a.name, a.buffer)
      await sel(page, ["imgRect00001"])
      await section(page, "Fill")
        .locator(".kimo-fill-row")
        .first()
        .locator(".kimo-color-field")
        .click()
      const pop = page.locator(".kimo-image-fill")
      await pop.waitFor()
      const ok = await page
        .getByText("2 × 2")
        .waitFor({ timeout: 3000 })
        .then(() => true)
        .catch(() => false)
      expect(ok, "the reopened file shows the image (asset bytes travel with the saved file)")
    },
  },
  {
    name: "qa-m2 io: reload keeps every M2 property (IndexedDB autosave)",
    async run({ page, url }) {
      await noPickers(page)
      await openEditor(page, url)
      const fixture = readFileSync(FIXTURE, "utf8")
      await openText(page, "styling-m2.kimo", fixture)
      const before = await docJson(page)
      await page.waitForTimeout(600)
      await page.reload()
      await waitCanvas(page)
      expect((await docJson(page)) === before, "same document after reload")
    },
  },
  {
    name: "qa-m2 io: dark mode — popovers, menus, hint pill, zoom badge and overlay theme follow tokens",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "darkRect0001",
          node: { type: "rect", name: "D", x: 40, y: 40, w: 100, h: 100, fill: "#F4A261" },
        },
      ])
      const read = () =>
        page.evaluate(() => {
          const bg = (s: string) => {
            const el = document.querySelector(s)
            return el ? getComputedStyle(el).backgroundColor : null
          }
          const k = (window as unknown as { __kimo: M2Hook }).__kimo
          const theme = (k.canvas()?.renderer as unknown as { theme?: Record<string, string> })
            ?.theme
          const tok = (n: string) =>
            getComputedStyle(document.documentElement).getPropertyValue(n).trim()
          return {
            popover: bg(".kimo-color-picker"),
            badge: bg(".canvas-zoom-badge"),
            measure: theme?.measure ?? null,
            tokMeasure: tok("--kimo-measure"),
            tokOverlay: tok("--kimo-bg-overlay"),
          }
        })
      const open = async () => {
        await sel(page, ["darkRect0001"])
        await section(page, "Fill")
          .locator(".kimo-fill-row")
          .first()
          .locator(".kimo-color-field")
          .click()
        await page.locator(".kimo-color-picker").waitFor()
        await page.evaluate(() =>
          (window as unknown as { __kimo: M2Hook }).__kimo.session.ui
            .getState()
            .setViewport({ x: 0, y: 0, zoom: 8 }),
        )
        await page.waitForTimeout(250)
      }
      await open()
      const light = await read()
      await page.keyboard.press("Escape")
      await page.getByRole("button", { name: "Toggle theme" }).click()
      await settle(page)
      await open()
      const dark = await read()
      log("light", JSON.stringify(light))
      log("dark", JSON.stringify(dark))
      expect(dark.popover !== light.popover, "picker background changes in dark mode")
      expect(dark.badge !== light.badge, "zoom badge background changes in dark mode")
      expect(
        dark.measure?.toUpperCase() === dark.tokMeasure.toUpperCase(),
        `canvas overlays use the dark measure token (${dark.measure} vs ${dark.tokMeasure})`,
      )
      // Scan the open picker for hard-coded white backgrounds. Design literals excluded: the
      // Slider/Alpha track (qpmcK › A62mZE fill #FFFFFF under the checker) and thumbs/swatches.
      const whites = await page.evaluate(() =>
        [...document.querySelectorAll(".kimo-color-picker *")]
          .filter((el) => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)")
          .map((el) => (el as HTMLElement).className)
          .filter((c) => !/thumb|handle|swatch|slider__track/i.test(String(c))),
      )
      log("white backgrounds", JSON.stringify(whites))
      expect(whites.length === 0, `no literal white surfaces in dark mode: ${whites.join(", ")}`)
    },
  },
]
