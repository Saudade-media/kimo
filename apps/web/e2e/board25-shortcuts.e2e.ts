/**
 * Board 25 §7 (c) Keyboard shortcuts sheet (WcWPY) on the web editor: ⌘/ opens it, Esc / Close
 * / scrim close it, the filter matches action names and keys, the platform switch re-renders the
 * modifiers, and one measured getComputedStyle / getBoundingClientRect pass against the
 * desing.pen node values. Plus: existing bindings still work through the SHORTCUTS table.
 */
import type { Page } from "playwright"
import { openEditor, settle } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type M = {
  x: number
  y: number
  w: number
  h: number
  pad: number[]
  gap: number
  fs: number
  fw: string
  ff: string
  lh: number
  ls: number
  bg: string
  color: string
  radius: number
  shadow: string
  tt: string
}

function measure(page: Page, sels: Record<string, string>) {
  return page.evaluate((s) => {
    const out: Record<string, unknown> = {}
    for (const [k, sel] of Object.entries(s)) {
      const e = document.querySelector(sel)
      if (!e) {
        out[k] = null
        continue
      }
      const r = e.getBoundingClientRect()
      const cs = getComputedStyle(e)
      out[k] = {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat),
        gap: parseFloat(cs.columnGap) || parseFloat(cs.rowGap) || 0,
        fs: parseFloat(cs.fontSize),
        fw: cs.fontWeight,
        ff: cs.fontFamily.split(",")[0]?.replace(/"/g, "").trim() ?? "",
        lh: parseFloat(cs.lineHeight) || 0,
        ls: parseFloat(cs.letterSpacing) || 0,
        bg: cs.backgroundColor,
        color: cs.color,
        radius: parseFloat(cs.borderTopLeftRadius),
        shadow: cs.boxShadow,
        tt: cs.textTransform,
      }
    }
    return out
  }, sels) as Promise<Record<string, M | null>>
}

const token = (page: Page, name: string, prop: "color" | "backgroundColor" = "color") =>
  page.evaluate(
    ([n, p]) => {
      const el = document.createElement("div")
      el.style[p as "color"] = `var(${n})`
      document.body.append(el)
      const c = getComputedStyle(el)[p as "color"]
      el.remove()
      return c
    },
    [name, prop] as const,
  )

function checker(ctx: E2EContext, surface: string) {
  const rows: string[] = []
  const check = (el: string, prop: string, got: unknown, want: number | string, tol = 0.75) => {
    const ok =
      typeof want === "number"
        ? typeof got === "number" && Math.abs(got - want) <= tol
        : got === want
    rows.push(
      `| ${el} | ${prop} | ${want} | ${typeof got === "number" ? Math.round(got * 100) / 100 : got} |`,
    )
    expect(ok, `${surface} · ${el} ${prop}: want ${want}, got ${got}`)
  }
  const flush = () =>
    ctx.log(
      `\n    ${surface}\n    | element | property | design | measured |\n    |---|---|---|---|\n${rows.join("\n")}`,
    )
  return { check, flush }
}

const SHEET = '[data-testid="shortcuts-sheet"]'
const sheet = (page: Page) => page.locator(SHEET)

async function openSheet(page: Page) {
  await page.mouse.click(600, 400)
  await page.keyboard.press("ControlOrMeta+Slash")
  await sheet(page).waitFor()
}

const rowKbds = (page: Page, id: string) =>
  page.locator(`${SHEET} [data-shortcut="${id}"] kbd`).allInnerTexts()

export const scenarios: Scenario[] = [
  {
    name: "board25 §7 (c): ⌘/ opens the Keyboard shortcuts sheet; Esc / Close / scrim close it",
    async run(ctx) {
      const { page } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      await openEditor(page, ctx.url)
      await openSheet(page)
      // Focus starts in the filter (first focusable).
      expect(
        await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
        "focus on Filter shortcuts",
      )
      expect(
        (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) ===
          "Filter shortcuts",
        "initial focus = filter",
      )
      await page.keyboard.press("Escape")
      await sheet(page).waitFor({ state: "detached" })
      await openSheet(page)
      await sheet(page).getByRole("button", { name: "Close" }).click()
      await sheet(page).waitFor({ state: "detached" })
      await openSheet(page)
      await page.mouse.click(20, 20) // the scrim
      await sheet(page).waitFor({ state: "detached" })
      // ⌘/ toggles.
      await openSheet(page)
      await page.keyboard.press("ControlOrMeta+Slash") // focus is in the filter
      await sheet(page).waitFor({ state: "detached" })
    },
  },
  {
    name: "board25 §7 (c): filter matches names and keys; platform switch re-renders modifiers",
    async run(ctx) {
      const { page } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      await openEditor(page, ctx.url)
      await openSheet(page)
      const groups = () =>
        page.locator(`${SHEET} .kimo-shortcuts-sheet__group-title`).allInnerTexts()
      expect(
        JSON.stringify(await groups()) ===
          JSON.stringify([
            "TOOLS",
            "FILE",
            "EDIT",
            "SELECTION & LAYERS",
            "COMPONENTS & VARIABLES",
            "VIEW",
            "AGENT & TEXT",
            "CONFLICTS",
            "HELP",
          ]),
        `groups: ${await groups()}`,
      )
      // Default platform = current OS (headless Chromium on macOS → macOS).
      const mac = await page.evaluate(() => /Mac/.test(navigator.platform))
      const on = await sheet(page).getByRole("radio", { checked: true }).innerText()
      expect(on === (mac ? "macOS" : "Windows · Linux"), `default platform ${on}`)
      await sheet(page).getByRole("radio", { name: "macOS" }).click()
      expect(
        JSON.stringify(await rowKbds(page, "saveAs")) === '["⇧⌘S"]',
        `mac saveAs ${await rowKbds(page, "saveAs")}`,
      )
      expect(
        JSON.stringify(await rowKbds(page, "redo")) === '["⇧⌘Z","⌘Y"]',
        `mac redo ${await rowKbds(page, "redo")}`,
      )
      await sheet(page).getByRole("radio", { name: "Windows · Linux" }).click()
      expect(
        JSON.stringify(await rowKbds(page, "saveAs")) === '["Ctrl+Shift+S"]',
        `win saveAs ${await rowKbds(page, "saveAs")}`,
      )
      expect(
        JSON.stringify(await rowKbds(page, "createComponent")) === '["Ctrl+Alt+K"]',
        "win createComponent",
      )
      // Filter: names …
      await sheet(page).getByRole("searchbox", { name: "Filter shortcuts" }).fill("zoom")
      expect(JSON.stringify(await groups()) === '["VIEW"]', `zoom → ${await groups()}`)
      // … and keys (formatted for the selected platform).
      await sheet(page).getByRole("searchbox", { name: "Filter shortcuts" }).fill("ctrl+shift+s")
      const ids = await page
        .locator(`${SHEET} .kimo-shortcuts-sheet__row`)
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-shortcut")))
      expect(JSON.stringify(ids) === '["saveAs"]', `keys filter → ${ids}`)
      await sheet(page).getByRole("searchbox", { name: "Filter shortcuts" }).fill("")
      // Typing in the filter doesn't fire single-key tools.
      await sheet(page).getByRole("searchbox", { name: "Filter shortcuts" }).fill("r")
      const tool = await page.evaluate(
        () =>
          (
            window as unknown as {
              __kimo: { session: { ui: { getState(): { tool: string } } } }
            }
          ).__kimo.session.ui.getState().tool,
      )
      expect(tool === "select", `tool stayed select, got ${tool}`)
    },
  },
  {
    name: "board25 §7 (c): existing bindings still run through SHORTCUTS (tools, zoom, undo, ⌥⌘K)",
    async run(ctx) {
      const { page } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      await openEditor(page, ctx.url)
      type W = {
        __kimo: {
          session: {
            store: { nodeIds(): string[]; getNode(id: string): Record<string, unknown> }
            ui: {
              getState(): {
                tool: string
                selection: string[]
                viewport: { zoom: number }
                select(ids: string[]): void
              }
            }
          }
        }
      }
      const ui = () =>
        page.evaluate(() => {
          const s = (window as unknown as W).__kimo.session.ui.getState()
          return { tool: s.tool, zoom: s.viewport.zoom, sel: s.selection }
        })
      await page.mouse.click(600, 400)
      for (const [k, tool] of [
        ["r", "rect"],
        ["o", "ellipse"],
        ["t", "text"],
        ["f", "frame"],
        ["p", "path"],
        ["h", "hand"],
        ["v", "select"],
      ] as const) {
        await page.keyboard.press(k)
        expect((await ui()).tool === tool, `${k} → ${tool}, got ${(await ui()).tool}`)
      }
      await page.keyboard.press("Shift+Digit0")
      await settle(page)
      expect(Math.abs((await ui()).zoom - 1) < 1e-6, "⇧0 → 100 %")
      await page.keyboard.press("Equal")
      await settle(page)
      expect(Math.abs((await ui()).zoom - 2) < 1e-6, `= → 200 %, got ${(await ui()).zoom}`)
      await page.keyboard.press("ControlOrMeta+Digit0")
      await settle(page)
      expect(Math.abs((await ui()).zoom - 1) < 1e-6, "⌘0 → 100 %")
      // Draw a rectangle, ⌘D duplicates, ⌘Z undoes, ⇧⌘Z redoes, ⌫ deletes.
      const count = () =>
        page.evaluate(() => (window as unknown as W).__kimo.session.store.nodeIds().length)
      await page.keyboard.press("r")
      await page.mouse.move(500, 300)
      await page.mouse.down()
      await page.mouse.move(600, 380, { steps: 4 })
      await page.mouse.up()
      await settle(page)
      const n0 = await count()
      await page.keyboard.press("ControlOrMeta+d")
      await settle(page)
      expect((await count()) === n0 + 1, "⌘D duplicates")
      await page.keyboard.press("ControlOrMeta+z")
      await settle(page)
      expect((await count()) === n0, "⌘Z undoes")
      await page.keyboard.press("ControlOrMeta+Shift+z")
      await settle(page)
      expect((await count()) === n0 + 1, "⇧⌘Z redoes")
      await page.evaluate(() => {
        const s = (window as unknown as W).__kimo.session
        const ids = s.store.nodeIds().filter((i) => s.store.getNode(i).type === "rect")
        s.ui.getState().select(ids.slice(-1))
      })
      await page.keyboard.press("Backspace")
      await settle(page)
      expect((await count()) === n0, "⌫ deletes")
      // ⌥⌘K: create component (matched by code).
      await page.evaluate(() => {
        const s = (window as unknown as W).__kimo.session
        const id = s.store.nodeIds().find((i) => s.store.getNode(i).type === "rect")
        if (id) s.ui.getState().select([id])
      })
      await page.keyboard.press("ControlOrMeta+Alt+KeyK")
      await settle(page)
      const comp = await page.evaluate(() => {
        const s = (window as unknown as W).__kimo.session
        return s.store.nodeIds().some((i) => !!s.store.getNode(i).component)
      })
      expect(comp, "⌥⌘K created a component")
    },
  },
  {
    name: "board25 §7 (c): shortcuts sheet measured against WcWPY",
    async run(ctx) {
      const { page } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      await openEditor(page, ctx.url)
      await page.evaluate(() => document.fonts.ready)
      await openSheet(page)
      await sheet(page).getByRole("radio", { name: "macOS" }).click()
      const S = SHEET
      const m = await measure(page, {
        sheet: S,
        header: `${S} .kimo-shortcuts-sheet__header`,
        titles: `${S} .kimo-shortcuts-sheet__titles`,
        title: `${S} .kimo-shortcuts-sheet__title`,
        desc: `${S} .kimo-shortcuts-sheet__desc`,
        filter: `${S} .kimo-shortcuts-sheet__filter`,
        filterField: `${S} .kimo-shortcuts-sheet__filter input`,
        platform: `${S} .kimo-shortcuts-sheet__platform`,
        segment: `${S} .kimo-shortcuts-sheet__platform button`,
        segLabel: `${S} .kimo-shortcuts-sheet__platform .kimo-seg-text__label`,
        close: `${S} .kimo-shortcuts-sheet__close`,
        closeIcon: `${S} .kimo-shortcuts-sheet__close svg`,
        body: `${S} .kimo-shortcuts-sheet__body`,
        col1: `${S} [data-column="1"]`,
        col2: `${S} [data-column="2"]`,
        col3: `${S} [data-column="3"]`,
        tools: `${S} [data-group="tools"]`,
        groupTitle: `${S} [data-group="tools"] .kimo-shortcuts-sheet__group-title`,
        gap: `${S} [data-group="tools"] .kimo-shortcuts-sheet__gap`,
        row: `${S} [data-shortcut="tool.move"]`,
        action: `${S} [data-shortcut="tool.move"] .kimo-shortcuts-sheet__action`,
        kbd: `${S} [data-shortcut="tool.move"] kbd`,
        kbdKeys: `${S} [data-shortcut="tool.move"] .kimo-kbd__keys`,
        or: `${S} [data-shortcut="redo"] .kimo-shortcuts-sheet__or`,
        newBadge: `${S} .kimo-shortcuts-sheet__new`,
        newLabel: `${S} .kimo-shortcuts-sheet__new-label`,
        footer: `${S} .kimo-shortcuts-sheet__footer`,
        footIcon: `${S} .kimo-shortcuts-sheet__footer-icon`,
        note: `${S} .kimo-shortcuts-sheet__note`,
      })
      const g = (k: string) => {
        const v = m[k]
        expect(v, `${k} rendered`)
        return v as M
      }
      const tok = {
        bgApp: await token(page, "--kimo-bg-app"),
        bgMuted: await token(page, "--kimo-bg-muted"),
        bgSubtle: await token(page, "--kimo-bg-subtle"),
        primary: await token(page, "--kimo-text-primary"),
        secondary: await token(page, "--kimo-text-secondary"),
        tertiary: await token(page, "--kimo-text-tertiary"),
        border: await token(page, "--kimo-border"),
      }
      const { check, flush } = checker(ctx, "Keyboard shortcuts sheet (WcWPY)")
      const sh = g("sheet")
      check("Dialog", "width", sh.w, 1040)
      check("Dialog", "height", sh.h, 762, 3)
      check("Dialog", "fill", sh.bg, tok.bgApp)
      check("Dialog", "radius (radius-2xl)", sh.radius, 32)
      expect(sh.shadow.includes("0px 2px 6px") && sh.shadow.includes("0px 24px 64px"), "shadows")
      const hd = g("header")
      check("Header", "height", hd.h, 82)
      check("Header", "padding", hd.pad.join(","), "22,24,16,28")
      check("Header", "gap", hd.gap, 12)
      check("Titles", "height", g("titles").h, 44)
      check("Titles", "gap", g("titles").gap, 4)
      check("Title", "font-size", g("title").fs, 20)
      check("Title", "weight", g("title").fw, "500")
      check("Title", "letter-spacing", g("title").ls, -0.3, 0.01)
      check("Title", "height", g("title").h, 24)
      check("Title", "color", g("title").color, tok.primary)
      check("Desc", "font-size", g("desc").fs, 13)
      check("Desc", "height", g("desc").h, 16)
      check("Desc", "color", g("desc").color, tok.secondary)
      check("Filter", "width", g("filter").w, 220)
      check("Filter", "height", g("filter").h, 32)
      check("Filter", "fill", g("filter").bg, tok.bgMuted)
      check("Filter field", "font-size", g("filterField").fs, 12)
      check("Platform", "height", g("platform").h, 28)
      check("Platform", "width", g("platform").w, 171, 6)
      check("Segment", "height", g("segment").h, 24)
      check("Segment label", "font-size", g("segLabel").fs, 11)
      check("Close", "size", g("close").w, 32)
      check("Close", "height", g("close").h, 32)
      check("Close", "fill", g("close").bg, tok.bgMuted)
      check("Close", "radius (pill)", g("close").radius >= 16 ? 16 : g("close").radius, 16)
      check("Close icon", "size", g("closeIcon").w, 16)
      const bd = g("body")
      check("Body", "padding", bd.pad.join(","), "4,28,24,28")
      check("Body", "gap", bd.gap, 32)
      for (const c of ["col1", "col2", "col3"]) {
        check(c, "width", g(c).w, 306.67, 1)
        check(c, "gap", g(c).gap, 20)
      }
      check("Column 2", "x − Column 1 x", g("col2").x - g("col1").x, 306.67 + 32, 1)
      check("Group · Tools", "height", g("tools").h, 351)
      check("Group Title", "font", g("groupTitle").ff, "JetBrains Mono")
      check("Group Title", "font-size", g("groupTitle").fs, 11)
      check("Group Title", "letter-spacing", g("groupTitle").ls, 0.4, 0.01)
      check("Group Title", "color", g("groupTitle").color, tok.tertiary)
      check("Group Title", "height", g("groupTitle").h, 15)
      check("Gap", "height", g("gap").h, 6)
      const row = g("row")
      check("Row", "height", row.h, 30)
      check("Row", "gap", row.gap, 8)
      expect(row.shadow.includes("inset") && row.shadow.includes("-1px"), "row bottom stroke")
      check("Action", "font-size", g("action").fs, 12)
      check("Action", "color", g("action").color, tok.primary)
      check("Action", "height", g("action").h, 15)
      check("Kbd", "height", g("kbd").h, 17)
      check("Kbd", "width (V)", g("kbd").w, 17, 1)
      check("Kbd", "padding", g("kbd").pad.join(","), "1,5,1,5")
      check("Kbd", "fill", g("kbd").bg, tok.bgSubtle)
      check("Kbd", "radius", g("kbd").radius, 4)
      check("Kbd keys", "font-size", g("kbdKeys").fs, 11)
      check("Or", "font-size", g("or").fs, 11)
      check("Or", "color", g("or").color, tok.tertiary)
      check("Or", "height", g("or").h, 13)
      check("New", "padding", g("newBadge").pad.join(","), "1,6,1,6")
      check("New", "fill", g("newBadge").bg, tok.bgMuted)
      check("New", "height", g("newBadge").h, 14)
      check("New", "width", g("newBadge").w, 33, 1.5)
      check("New label", "font-size", g("newLabel").fs, 10)
      check("New label", "weight", g("newLabel").fw, "500")
      check("New label", "color", g("newLabel").color, tok.secondary)
      const ft = g("footer")
      check("Footer", "height", ft.h, 39)
      check("Footer", "padding", ft.pad.join(","), "12,28,12,28")
      check("Footer", "gap", ft.gap, 8)
      check("Footer", "fill", ft.bg, tok.bgSubtle)
      expect(ft.shadow.includes("inset") && ft.shadow.includes("1px"), "footer top stroke")
      check("Footer icon", "size", g("footIcon").w, 14)
      check("Footer icon", "color", g("footIcon").color, tok.tertiary)
      check("Note", "font-size", g("note").fs, 12)
      check("Note", "color", g("note").color, tok.tertiary)
      flush()
      if (ctx.shots) await sheet(page).screenshot({ path: `${ctx.shots}/board25-shortcuts.png` })
    },
  },
]
