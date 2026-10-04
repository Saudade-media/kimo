/**
 * Adversarial QA of the M2 Design tab (board 08) and its popovers (board 09): Mixed values on
 * every control, input parsing/clamping, paint list edits, color picker / gradient editor /
 * effects / icon picker interactions and keyboard, and undo granularity (one step per gesture).
 */
import type { Locator, Page } from "playwright"
import { docJson, node, openEditor, settle } from "./qa-helpers"
import {
  board,
  collectWarnings,
  fieldValue,
  type M2Hook,
  section,
  stepsBack,
  typeField,
} from "./qa-m2-helpers"
import { expect, type Scenario } from "./run"

const sel = async (page: Page, s: string[]) => {
  await page.evaluate(
    (x) => (window as unknown as { __kimo: M2Hook }).__kimo.session.ui.getState().select(x),
    s,
  )
  await settle(page)
}

/** Two rects whose every M2 styling property differs. */
const MIXED_KIDS = [
  {
    id: "mixA0000001",
    node: {
      type: "rect",
      name: "A",
      x: 40,
      y: 40,
      w: 100,
      h: 100,
      fill: "#F4A261",
      opacity: 0.5,
      blend: "multiply",
      radius: 4,
      stroke: { paint: "#000000", width: 2, align: "center", cap: "round", dash: [4, 2] },
      effects: [{ kind: "shadow", x: 0, y: 4, blur: 8, color: "#00000033" }],
    },
  },
  {
    id: "mixB0000001",
    node: {
      type: "rect",
      name: "B",
      x: 200,
      y: 40,
      w: 100,
      h: 100,
      fill: "#2A9D8F",
      radius: 8,
      stroke: { paint: "#FF0000" },
    },
  },
]

const one = (page: Page, id: string) => node(page, id)

/** Clicks the row's swatch to open its popover. */
async function openRow(row: Locator) {
  await row.locator(".kimo-color-field").first().click()
}

/** Drags across an element horizontally (fractions of its box). */
async function dragAcross(page: Page, el: Locator, fx0: number, fx1: number, fy = 0.5) {
  const b = await el.boundingBox()
  if (!b) throw new Error("no box")
  await page.mouse.move(b.x + b.width * fx0, b.y + b.height * fy)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(b.x + b.width * (fx0 + ((fx1 - fx0) * i) / 8), b.y + b.height * fy)
  await page.mouse.up()
  await settle(page)
}

export const scenarios: Scenario[] = [
  {
    name: "qa-m2 panel: Mixed shows on blend, opacity, radius, stroke weight/align/cap/dash, effects",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, MIXED_KIDS)
      await sel(page, ["mixA0000001", "mixB0000001"])
      const layer = section(page, "Layer")
      const blend = (await layer.getByRole("button", { name: "Blend mode" }).textContent()) ?? ""
      const opacity = await fieldValue(layer, "Opacity")
      const radius = await fieldValue(section(page, "Position"), "Corner radius")
      const stroke = section(page, "Stroke")
      const weight = await fieldValue(stroke, "Stroke weight")
      const align =
        (await stroke.getByRole("combobox", { name: "Stroke align" }).textContent()) ?? ""
      const capChecked = await stroke
        .getByRole("radiogroup", { name: "Stroke cap" })
        .getByRole("radio", { checked: true })
        .count()
      const effects = (await section(page, "Effects").textContent()) ?? ""
      log(JSON.stringify({ blend, opacity, radius, weight, align, capChecked, effects }))
      expect(blend.includes("Mixed"), `blend shows Mixed (${blend})`)
      expect(opacity === "Mixed", `opacity Mixed (${opacity})`)
      expect(radius === "Mixed", `radius Mixed (${radius})`)
      expect(weight === "Mixed", `stroke weight Mixed (${weight})`)
      expect(align.includes("Mixed"), `stroke align Mixed (${align})`)
      expect(capChecked === 0, "no cap segment checked")
      expect(effects.includes("Mixed"), "effects Mixed")
    },
  },
  {
    name: "qa-m2 panel: editing a Mixed control sets every node in one undo step",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, MIXED_KIDS)
      await sel(page, ["mixA0000001", "mixB0000001"])
      const doc0 = await docJson(page)
      const step = async (
        what: string,
        act: () => Promise<void>,
        check: () => Promise<boolean>,
      ) => {
        const before = await docJson(page)
        await act()
        await settle(page)
        expect(await check(), `${what}: applied to both`)
        const n = await stepsBack(page, before)
        expect(n === 1, `${what}: one undo step (${n})`)
        // Redo it so the next step starts from the edited state is not needed: start fresh.
      }
      const both = async (f: (n: Record<string, unknown> | null) => boolean) =>
        f(await one(page, "mixA0000001")) && f(await one(page, "mixB0000001"))
      await step(
        "opacity",
        () => typeField(page, section(page, "Layer"), "Opacity", "30"),
        () => both((n) => n?.opacity === 0.3),
      )
      await step(
        "radius",
        () => typeField(page, section(page, "Position"), "Corner radius", "12"),
        () => both((n) => n?.radius === 12),
      )
      await step(
        "stroke weight",
        () => typeField(page, section(page, "Stroke"), "Stroke weight", "3"),
        () => both((n) => (n?.stroke as { width?: unknown })?.width === 3),
      )
      await step(
        "cap",
        () =>
          section(page, "Stroke")
            .getByRole("radiogroup", { name: "Stroke cap" })
            .getByRole("radio", { name: "Square" })
            .click(),
        () => both((n) => (n?.stroke as { cap?: unknown })?.cap === "square"),
      )
      await step(
        "dashed on Mixed",
        () => section(page, "Stroke").getByRole("switch", { name: "Dashed" }).click(),
        () => both((n) => Array.isArray((n?.stroke as { dash?: unknown })?.dash)),
      )
      await step(
        "blend",
        async () => {
          await section(page, "Layer").getByRole("button", { name: "Blend mode" }).click()
          await page.getByRole("menu", { name: "Blend mode" }).getByText("Darken").click()
        },
        () => both((n) => n?.blend === "darken"),
      )
      await step(
        "stroke align",
        async () => {
          await section(page, "Stroke").getByRole("combobox", { name: "Stroke align" }).click()
          await page.getByRole("option", { name: "Outside" }).click()
        },
        () => both((n) => (n?.stroke as { align?: unknown })?.align === "outside"),
      )
      // A's dash survives ([4,2]); per-node values are only replaced for the edited field.
      expect((await docJson(page)) === doc0, "all steps undone")
      log("ok")
    },
  },
  {
    name: "qa-m2 panel: opacity / rotation / radius input parsing and clamping",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [MIXED_KIDS[0] as (typeof MIXED_KIDS)[number]])
      await sel(page, ["mixA0000001"])
      const layer = section(page, "Layer")
      const pos = section(page, "Position")
      const cases: [Locator, string, string, (n: Record<string, unknown> | null) => boolean][] = [
        [layer, "Opacity", "150", (n) => n?.opacity === undefined],
        [layer, "Opacity", "-20", (n) => n?.opacity === 0],
        [layer, "Opacity", "45.6%", (n) => n?.opacity === 0.46],
        [layer, "Opacity", "abc", (n) => n?.opacity === 0.46],
        [pos, "Rotation", "190", (n) => n?.rotation === -170],
        [pos, "Rotation", "-30°", (n) => n?.rotation === -30],
        [pos, "Rotation", "360", (n) => n?.rotation === undefined],
        [pos, "Corner radius", "-5", (n) => n?.radius === undefined || n?.radius === 0],
        [pos, "Corner radius", "4 8 12 16", (n) => JSON.stringify(n?.radius) === "[4,8,12,16]"],
      ]
      for (const [scope, label, input, ok] of cases) {
        await typeField(page, scope, label, input)
        const n = await one(page, "mixA0000001")
        log(label, input, "→", JSON.stringify({ o: n?.opacity, r: n?.rotation, rad: n?.radius }))
        expect(ok(n), `${label} "${input}"`)
      }
    },
  },
  {
    name: "qa-m2 panel: fill list — hide, ⌥↑ reorder, remove last → fill unset; one step each",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "fillRect0001",
          node: {
            type: "rect",
            name: "F",
            x: 40,
            y: 40,
            w: 100,
            h: 100,
            fill: ["#111111", "#222222"],
          },
        },
      ])
      await sel(page, ["fillRect0001"])
      const fill = section(page, "Fill")
      // Rows list the top paint first: "Fill 1" = #222222 (stored last).
      let before = await docJson(page)
      await fill.getByRole("button", { name: "Hide fill 1" }).click()
      await settle(page)
      const f1 = (await one(page, "fillRect0001"))?.fill as unknown[]
      log("hidden", JSON.stringify(f1))
      expect(
        JSON.stringify(f1[1]) === '{"kind":"solid","color":"#222222","visible":false}',
        "hidden paint stored as a solid with visible false",
      )
      expect((await stepsBack(page, before)) === 1, "hide: one step")
      // ⌥↓ on the top row moves it below.
      before = await docJson(page)
      await fill
        .locator(".kimo-fill-row")
        .first()
        .getByRole("button", { name: "Edit fill 1" })
        .focus()
      await page.keyboard.press("Alt+ArrowDown")
      await settle(page)
      const f2 = (await one(page, "fillRect0001"))?.fill as unknown[]
      expect(JSON.stringify(f2) === '["#222222","#111111"]', `reordered ${JSON.stringify(f2)}`)
      expect((await stepsBack(page, before)) === 1, "reorder: one step")
      // Remove both → fill unset (not []).
      before = await docJson(page)
      await fill.getByRole("button", { name: "Remove fill 1" }).click()
      await settle(page)
      await fill.getByRole("button", { name: /^Remove fill/ }).click()
      await settle(page)
      const f3 = (await one(page, "fillRect0001"))?.fill
      expect(f3 === undefined, `fill unset (${JSON.stringify(f3)})`)
      expect((await stepsBack(page, before)) === 2, "two removals = two steps")
    },
  },
  {
    name: "qa-m2 panel: color picker — hue / alpha drags and hex entry are one step each",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "pickRect0001",
          node: { type: "rect", name: "P", x: 40, y: 40, w: 100, h: 100, fill: "#F4A261" },
        },
      ])
      await sel(page, ["pickRect0001"])
      const fillRow = section(page, "Fill").locator(".kimo-fill-row").first()
      await openRow(fillRow)
      const picker = page.locator(".kimo-color-picker")
      await picker.waitFor()
      for (const [label, f0, f1] of [
        ["Hue", 0.1, 0.6],
        ["Opacity", 0.9, 0.3],
      ] as const) {
        const before = await docJson(page)
        await dragAcross(page, picker.getByRole("slider", { name: label }), f0, f1)
        const v = (await one(page, "pickRect0001"))?.fill
        log(label, JSON.stringify(v))
        expect(before !== (await docJson(page)), `${label} drag changed the fill`)
        const n = await stepsBack(page, before)
        expect(n === 1, `${label} drag: one undo step (${n})`)
      }
      // Hex entry.
      const before = await docJson(page)
      const hex = picker.getByRole("textbox", { name: "Hex value" })
      await hex.fill("00FF00")
      await hex.press("Enter")
      await settle(page)
      const v = (await one(page, "pickRect0001"))?.fill
      expect(String(v).toUpperCase() === "#00FF00", `hex typed (${v})`)
      expect((await stepsBack(page, before)) === 1, "hex: one step")
      // Keyboard on the hue slider: 3 presses → 3 steps, each reversible.
      const b2 = await docJson(page)
      const hue = picker.getByRole("slider", { name: "Hue" })
      await hue.focus()
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight")
      await settle(page)
      const n = await stepsBack(page, b2)
      log("hue key steps", n)
      expect(n === 3, `three key presses = three steps (${n})`)
    },
  },
  {
    name: "qa-m2 panel: color picker keyboard — focus inside on open, Tab trapped, Escape returns focus",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "pickRect0001",
          node: { type: "rect", name: "P", x: 40, y: 40, w: 100, h: 100, fill: "#F4A261" },
        },
      ])
      await sel(page, ["pickRect0001"])
      const swatch = section(page, "Fill").getByRole("button", { name: "Edit fill" })
      await swatch.click()
      const picker = page.locator(".kimo-color-picker")
      await picker.waitFor()
      await settle(page)
      const inside = () =>
        page.evaluate(() => !!document.activeElement?.closest(".kimo-color-picker"))
      expect(await inside(), "focus moves into the picker")
      for (let i = 0; i < 15; i++) await page.keyboard.press("Tab")
      expect(await inside(), "Tab stays inside")
      for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+Tab")
      expect(await inside(), "Shift+Tab stays inside")
      await page.keyboard.press("Escape")
      await settle(page)
      const focus = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))
      log("focus after Escape", focus)
      expect((await picker.count()) === 0, "Escape closes")
      expect(focus === "Edit fill", `focus returns to the swatch (${focus})`)
    },
  },
  {
    name: "qa-m2 panel: gradient editor — stop drag, add, remove (min 2), rotate, reverse",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "gradRect0001",
          node: {
            type: "rect",
            name: "G",
            x: 40,
            y: 40,
            w: 100,
            h: 100,
            fill: {
              kind: "linear",
              stops: [
                { color: "#FF0000", at: 0 },
                { color: "#0000FF", at: 1 },
              ],
            },
          },
        },
      ])
      await sel(page, ["gradRect0001"])
      await openRow(section(page, "Fill").locator(".kimo-fill-row").first())
      const ge = page.locator(".kimo-gradient-editor")
      await ge.waitFor()
      const g = async () => (await one(page, "gradRect0001"))?.fill as Record<string, unknown>
      // Drag stop 1 from 0 to ~50%.
      let before = await docJson(page)
      const stop = ge.getByRole("slider", { name: /^Stop 1,/ })
      const bar = ge.locator(".kimo-gradient-stop-bar")
      const bb = await bar.boundingBox()
      const sb = await stop.boundingBox()
      if (!bb || !sb) throw new Error("no stop bar")
      await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
      await page.mouse.down()
      for (let i = 1; i <= 8; i++)
        await page.mouse.move(sb.x + sb.width / 2 + (bb.width / 2) * (i / 8), sb.y + sb.height / 2)
      await page.mouse.up()
      await settle(page)
      const s1 = ((await g()).stops as { at: number }[])[0]?.at ?? 0
      log("dragged stop at", s1)
      expect(s1 > 0.3 && s1 < 0.7, `stop moved (${s1})`)
      expect((await stepsBack(page, before)) === 1, "stop drag: one step")
      // Add stop (+): 3 stops, one step.
      before = await docJson(page)
      await ge.getByRole("button", { name: "Add stop" }).click()
      await settle(page)
      expect(((await g()).stops as unknown[]).length === 3, "3 stops")
      expect((await stepsBack(page, before)) === 1, "add: one step")
      // Remove is disabled at 2 stops; Delete on a stop does nothing.
      expect(
        await ge.getByRole("button", { name: "Remove stop 1" }).isDisabled(),
        "remove disabled at 2",
      )
      await ge.getByRole("slider", { name: /^Stop 1,/ }).focus()
      await page.keyboard.press("Delete")
      await settle(page)
      expect(((await g()).stops as unknown[]).length === 2, "still 2 stops after Delete")
      // Rotate / reverse: one step each.
      before = await docJson(page)
      await ge.getByRole("button", { name: "Rotate 90°" }).click()
      await settle(page)
      log("rotated", JSON.stringify(await g()))
      expect(typeof (await g()).rotation === "number", "rotation set")
      expect((await stepsBack(page, before)) === 1, "rotate: one step")
      before = await docJson(page)
      await ge.getByRole("button", { name: "Reverse stops" }).click()
      await settle(page)
      const st = (await g()).stops as { color: string; at: number }[]
      log("reversed", JSON.stringify(st))
      expect(st.find((s) => s.color === "#FF0000")?.at === 1, "red now at 100%")
      expect((await stepsBack(page, before)) === 1, "reverse: one step")
    },
  },
  {
    name: "qa-m2 panel: effects — kind change, negative blur clamps, hide, shadow color, remove → unset",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "fxRect000001",
          node: {
            type: "rect",
            name: "E",
            x: 40,
            y: 40,
            w: 100,
            h: 100,
            fill: "#FFFFFF",
            effects: [{ kind: "shadow", x: 0, y: 8, blur: 24, color: "#0A0A0A1F" }],
          },
        },
      ])
      await sel(page, ["fxRect000001"])
      const fx = section(page, "Effects")
      const eff = async () =>
        (await one(page, "fxRect000001"))?.effects as Record<string, unknown>[] | undefined
      // Kind → Layer blur.
      let before = await docJson(page)
      await fx.getByRole("button", { name: "Drop shadow", exact: true }).click()
      await page.getByRole("menu", { name: "Effect type" }).getByText("Layer blur").click()
      await settle(page)
      log("blur", JSON.stringify(await eff()))
      expect(
        JSON.stringify(await eff()) === '[{"kind":"blur","radius":24}]',
        "layer blur radius 24",
      )
      expect((await stepsBack(page, before)) === 1, "kind: one step")
      // Open settings; negative blur clamps to 0.
      await fx.getByRole("button", { name: "Drop shadow settings" }).click()
      await typeField(page, fx, "Shadow blur", "-5")
      expect((await eff())?.[0]?.blur === 0, `blur clamped to 0 (${JSON.stringify(await eff())})`)
      // Shadow color through the picker: hex entry = one step.
      before = await docJson(page)
      await fx.getByRole("button", { name: "Edit shadow color" }).click()
      const picker = page.locator(".kimo-color-picker")
      await picker.waitFor()
      const hex = picker.getByRole("textbox", { name: "Hex value" })
      await hex.fill("FF0000")
      await hex.press("Enter")
      await settle(page)
      const c = String((await eff())?.[0]?.color)
      log("shadow color", c)
      expect(/^#FF0000/i.test(c), `shadow color set (${c})`)
      // The shadow's 12% alpha should survive a hex-only edit.
      expect(/^#FF00001F$/i.test(c), `hex edit keeps the shadow's alpha (${c})`)
      expect((await stepsBack(page, before)) === 1, "shadow color: one step")
      await page.keyboard.press("Escape")
      // Hide, then remove → effects unset.
      await fx.getByRole("button", { name: "Hide Drop shadow" }).click()
      await settle(page)
      expect((await eff())?.[0]?.visible === false, "hidden")
      await fx.getByRole("button", { name: "Remove Drop shadow" }).click()
      await settle(page)
      expect((await eff()) === undefined, "effects unset")
    },
  },
  {
    name: "qa-m2 panel: stroke dash 0 / gap 0 and all sides 0 do not break the renderer",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "dashRect0001",
          node: {
            type: "rect",
            name: "D",
            x: 40,
            y: 40,
            w: 100,
            h: 100,
            stroke: { paint: "#000000", width: 2, dash: [4, 2] },
          },
        },
      ])
      await sel(page, ["dashRect0001"])
      const st = section(page, "Stroke")
      await typeField(page, st, "Dash length", "0")
      await typeField(page, st, "Dash gap", "0")
      log("dash", JSON.stringify((await one(page, "dashRect0001"))?.stroke))
      await st.getByRole("switch", { name: "Individual sides" }).click()
      await settle(page)
      for (const s of ["top", "right", "bottom", "left"]) {
        const f = st.getByRole("textbox", { name: new RegExp(`Stroke ${s}`, "i") })
        await f.fill("0")
        await f.press("Enter")
      }
      await settle(page)
      const stroke = (await one(page, "dashRect0001"))?.stroke
      log("sides", JSON.stringify(stroke))
      // The renderer keeps drawing frames.
      const f0 = await page.evaluate(
        () =>
          (
            window as unknown as { __kimo: { canvas(): { stats(): { frames: number } | null } } }
          ).__kimo
            .canvas()
            ?.stats()?.frames ?? 0,
      )
      await page.evaluate(() =>
        (window as unknown as { __kimo: M2Hook }).__kimo.session.ui
          .getState()
          .setViewport({ x: -90, y: -100, zoom: 1 }),
      )
      await page.waitForTimeout(300)
      const f1 = await page.evaluate(
        () =>
          (
            window as unknown as { __kimo: { canvas(): { stats(): { frames: number } | null } } }
          ).__kimo
            .canvas()
            ?.stats()?.frames ?? 0,
      )
      log("frames", f0, f1)
      expect(f1 > f0, "renderer still producing frames")
    },
  },
  {
    name: "qa-m2 panel: auto layout — wrap toggle is accepted (feature layout/wrap)",
    async run({ page, url, log }) {
      await openEditor(page, url)
      const warnings = collectWarnings(page)
      await board(page, [
        {
          id: "alFrame00001",
          node: {
            type: "frame",
            name: "AL",
            x: 40,
            y: 40,
            w: 300,
            h: 120,
            layout: { dir: "row", gap: 8 },
          },
        },
      ])
      await sel(page, ["alFrame00001"])
      // Board 27 §6 (b): Wrap is an icon toggle (text-wrap) beside the DirectionControl.
      await section(page, "Auto layout").getByRole("button", { name: "Wrap" }).click()
      await settle(page)
      const l = (await one(page, "alFrame00001"))?.layout as Record<string, unknown>
      const features = await page.evaluate(
        () =>
          (
            (window as unknown as { __kimo: M2Hook }).__kimo.session.store.toDocument() as {
              features?: string[]
            }
          ).features ?? [],
      )
      log("layout", JSON.stringify(l), "features", features, "warnings", warnings.join(" | "))
      expect(l?.wrap === true, `wrap stored (${JSON.stringify(l)}; ${warnings.join(" | ")})`)
      expect(features.includes("layout/wrap"), "feature layout/wrap declared")
    },
  },
  {
    name: "qa-m2 panel: auto layout — direction, grid, distribution, padding, remove: one step each",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "alFrame00001",
          node: {
            type: "frame",
            name: "AL",
            x: 40,
            y: 40,
            w: 300,
            h: 120,
            layout: { dir: "row", gap: 8 },
          },
        },
      ])
      await sel(page, ["alFrame00001"])
      const al = section(page, "Auto layout")
      const lay = async () =>
        (await one(page, "alFrame00001"))?.layout as Record<string, unknown> | undefined
      const steps: [
        string,
        () => Promise<void>,
        (l: Record<string, unknown> | undefined) => boolean,
      ][] = [
        [
          "direction column",
          () =>
            al
              .getByRole("radio", { name: /column|vertical|down/i })
              .first()
              .click(),
          (l) => l?.dir === "column",
        ],
        [
          "grid bottom right",
          () => al.getByRole("radio", { name: "Bottom right" }).click(),
          (l) => l?.justify === "end" && l?.align === "end",
        ],
        [
          "distribution between",
          async () => {
            await al.getByRole("combobox", { name: "Distribution" }).click()
            await page.getByRole("option", { name: "Space between" }).click()
          },
          (l) => l?.justify === "between",
        ],
        [
          "padding H 12",
          () => typeField(page, al, "Horizontal padding", "12"),
          (l) => JSON.stringify(l?.pad) === "[0,12]" || JSON.stringify(l?.pad) === "[0,12,0,12]",
        ],
        [
          "remove",
          () => al.getByRole("button", { name: "Remove auto layout" }).click(),
          (l) => l === undefined,
        ],
      ]
      for (const [what, act, ok] of steps) {
        const before = await docJson(page)
        await act()
        await settle(page)
        const l = await lay()
        log(what, JSON.stringify(l))
        expect(ok(l), `${what} (${JSON.stringify(l)})`)
        const n = await stepsBack(page, before)
        expect(n === 1, `${what}: one step (${n})`)
        await page.evaluate(() =>
          (window as unknown as { __kimo: M2Hook }).__kimo.session.store.redo("user"),
        )
        await settle(page)
      }
    },
  },
  {
    name: "qa-m2 panel: Add auto layout on a rect wraps it in a layout frame in one step",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "wrapRect0001",
          node: { type: "rect", name: "R", x: 40, y: 40, w: 100, h: 60, fill: "#CCCCCC" },
        },
      ])
      await sel(page, ["wrapRect0001"])
      const before = await docJson(page)
      await section(page, "Auto layout").getByRole("button", { name: "Add auto layout" }).click()
      await settle(page)
      const r = await one(page, "wrapRect0001")
      const p = await one(page, r?.parent as string)
      log("wrapped", JSON.stringify(p), JSON.stringify(r))
      expect(p?.type === "frame" && !!p?.layout, "new layout frame parent")
      expect(p?.x === 40 && p?.y === 40, `frame keeps the rect's place (${p?.x}, ${p?.y})`)
      expect((await stepsBack(page, before)) === 1, "one step")
    },
  },
  {
    name: "qa-m2 panel: icon section — size, stroke, picker search + keyboard, one step per pick",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "iconNode0001",
          node: {
            type: "icon",
            name: "Star",
            set: "lucide",
            icon: "star",
            x: 40,
            y: 40,
            w: 24,
            h: 24,
          },
        },
      ])
      await sel(page, ["iconNode0001"])
      const ic = section(page, "Icon")
      await typeField(page, ic, "Icon size", "32")
      let n = await one(page, "iconNode0001")
      expect(n?.w === 32 && n?.h === 32, `size 32 (${n?.w}×${n?.h})`)
      await typeField(page, ic, "Icon stroke", "1.5")
      expect((await one(page, "iconNode0001"))?.strokeWidth === 1.5, "strokeWidth 1.5")
      await typeField(page, ic, "Icon stroke", "2")
      expect((await one(page, "iconNode0001"))?.strokeWidth === undefined, "2 = default, removed")
      const before = await docJson(page)
      await ic.getByRole("button", { name: /^Icon:/ }).click()
      const picker = page.locator(".kimo-icon-picker")
      await picker.waitFor()
      await settle(page)
      const focusIn = await page.evaluate(
        () => !!document.activeElement?.closest(".kimo-icon-picker"),
      )
      expect(focusIn, "focus moves into the icon picker")
      const search = picker.getByRole("searchbox").or(picker.getByRole("textbox")).first()
      await search.fill("heart")
      await page.waitForTimeout(400)
      await search.press("ArrowDown")
      await page.keyboard.press("Enter")
      await settle(page)
      n = await one(page, "iconNode0001")
      log("picked", n?.icon)
      expect(/heart/.test(String(n?.icon)), `picked heart (${n?.icon})`)
      expect((await stepsBack(page, before)) === 1, "pick: one step")
    },
  },
  {
    name: "qa-m2 panel: icon picker — Material weight slider drag is one step",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "iconNode0001",
          node: {
            type: "icon",
            name: "Home",
            set: "material-outlined",
            icon: "home",
            x: 40,
            y: 40,
            w: 24,
            h: 24,
          },
        },
      ])
      await sel(page, ["iconNode0001"])
      await section(page, "Icon")
        .getByRole("button", { name: /^Icon:/ })
        .click()
      const picker = page.locator(".kimo-icon-picker")
      await picker.waitFor()
      const slider = picker.getByRole("slider").first()
      expect((await slider.count()) === 1, "weight slider shown for Material")
      const before = await docJson(page)
      await dragAcross(page, slider, 0.5, 0.95)
      const w = (await one(page, "iconNode0001"))?.weight
      log("weight", w)
      expect(typeof w === "number" && w > 400, `weight raised (${w})`)
      expect((await stepsBack(page, before)) === 1, "one step")
    },
  },
  {
    name: "qa-m2 panel: blend menu keyboard — ArrowDown opens, arrows preview, Enter commits one step",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "blendRect001",
          node: { type: "rect", name: "B", x: 40, y: 40, w: 100, h: 100, fill: "#F4A261" },
        },
      ])
      await sel(page, ["blendRect001"])
      const before = await docJson(page)
      const trigger = section(page, "Layer").getByRole("button", { name: "Blend mode" })
      await trigger.focus()
      await page.keyboard.press("ArrowDown")
      const menu = page.getByRole("menu", { name: "Blend mode" })
      await menu.waitFor()
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown")
      await settle(page)
      const previewed = (await one(page, "blendRect001"))?.blend
      log("previewed", previewed)
      await page.keyboard.press("Enter")
      await settle(page)
      const b = (await one(page, "blendRect001"))?.blend
      log("committed", b)
      expect(typeof b === "string", `a blend committed (${b})`)
      expect((await menu.count()) === 0, "menu closed")
      const n = await stepsBack(page, before)
      expect(n === 1, `one step (${n})`)
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))
      expect(focused === "Blend mode", `focus back on the trigger (${focused})`)
    },
  },
  {
    name: "qa-m2 panel: Escape in every panel menu closes it and keeps the selection",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "escRect00001",
          node: {
            type: "rect",
            name: "Esc",
            x: 40,
            y: 40,
            w: 100,
            h: 100,
            fill: "#F4A261",
            stroke: { paint: "#000000" },
            effects: [{ kind: "shadow", x: 0, y: 8, blur: 24, color: "#0A0A0A1F" }],
          },
        },
      ])
      const selection = () =>
        page.evaluate(() =>
          JSON.stringify(
            (window as unknown as { __kimo: M2Hook }).__kimo.session.ui.getState().selection,
          ),
        )
      const menus: [string, () => Promise<void>][] = [
        [
          "blend mode menu",
          () => section(page, "Layer").getByRole("button", { name: "Blend mode" }).click(),
        ],
        [
          "add fill menu",
          () => section(page, "Fill").getByRole("button", { name: "Add fill" }).click(),
        ],
        [
          "effect type menu",
          () =>
            section(page, "Effects")
              .getByRole("button", { name: "Drop shadow", exact: true })
              .click(),
        ],
        [
          "stroke align select",
          () => section(page, "Stroke").getByRole("combobox", { name: "Stroke align" }).click(),
        ],
      ]
      const bad: string[] = []
      for (const [what, open] of menus) {
        await sel(page, ["escRect00001"])
        await open()
        await page.waitForTimeout(150)
        const focusIn = await page.evaluate(
          () => !!document.activeElement?.closest("[role=menu],[role=listbox]"),
        )
        await page.keyboard.press("Escape")
        await settle(page)
        const s = await selection()
        // The Pages strip (board 27 §1) is a permanent listbox, not a popup.
        const open2 = await page
          .locator("[role=menu],[role=listbox]:not(.pages-strip__list)")
          .count()
        log(what, JSON.stringify({ focusIn, selection: s, stillOpen: open2 }))
        if (s !== '["escRect00001"]' || open2 > 0)
          bad.push(`${what} (selection ${s}, focus in menu ${focusIn})`)
      }
      expect(bad.length === 0, `Escape lost the selection or left the menu open: ${bad.join("; ")}`)
    },
  },
  {
    name: "qa-m2 panel: changing the selection while a color drag is open closes the popover cleanly",
    async run({ page, url }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "pickRect0001",
          node: { type: "rect", name: "P", x: 40, y: 40, w: 100, h: 100, fill: "#F4A261" },
        },
        {
          id: "pickRect0002",
          node: { type: "rect", name: "Q", x: 200, y: 40, w: 100, h: 100, fill: "#2A9D8F" },
        },
      ])
      await sel(page, ["pickRect0001"])
      await openRow(section(page, "Fill").locator(".kimo-fill-row").first())
      await page.locator(".kimo-color-picker").waitFor()
      await sel(page, ["pickRect0002"])
      expect((await page.locator(".kimo-color-picker").count()) === 0, "picker closed")
      expect((await one(page, "pickRect0002"))?.fill === "#2A9D8F", "other node untouched")
    },
  },
  {
    name: "qa-m2 panel: popovers stay inside a short viewport",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await page.setViewportSize({ width: 1440, height: 560 })
      await board(page, [
        {
          id: "lowRect00001",
          node: {
            type: "rect",
            name: "L",
            x: 40,
            y: 40,
            w: 100,
            h: 100,
            fill: "#F4A261",
            stroke: { paint: "#000000" },
            effects: [{ kind: "shadow", x: 0, y: 8, blur: 24, color: "#0A0A0A1F" }],
          },
        },
      ])
      await sel(page, ["lowRect00001"])
      const tab = page.locator(".design-tab")
      await tab.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      await settle(page)
      await openRow(section(page, "Stroke").locator(".kimo-fill-row").first())
      const p = page.locator(".kimo-color-picker")
      await p.waitFor()
      await settle(page)
      const b = await p.boundingBox()
      log("picker box", JSON.stringify(b))
      expect(
        !!b && b.y >= 8 - 0.5 && b.y + b.height <= 560 - 8 + 0.5,
        "inside the viewport with 8px",
      )
    },
  },
]
