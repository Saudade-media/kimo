/**
 * Board 27 §9 Preview (j52y5f): the topbar Preview button (mtgng: tooltip names the frame,
 * disabled at 40 % on an empty page), ⇧Space opens the in-place overlay (yK8pG / PMt3U), ‹ ›
 * and ← → step through the top-level frames, T flips the light/dark axis in the preview only
 * (rendered pixels change, the document never does), Esc exits and the last frame becomes
 * selected. Plus one measured getComputedStyle / getBoundingClientRect pass against the node
 * values of the Preview Bar, Stage and Hint Row.
 */
import type { Page } from "playwright"
import { openEditor, settle } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type W = {
  __kimo: {
    session: {
      apply(ops: unknown[], label: string): unknown
      store: { toDocument(): unknown; children(p: null): string[] }
      ui: { getState(): { selection: string[]; select(ids: string[]): void } }
    }
  }
}

const SEED = [
  { op: "setThemes", set: { mode: ["light", "dark"], brand: ["Kimo", "Acme"] } },
  {
    op: "setVariables",
    set: {
      "surface/page": {
        type: "color",
        value: [
          { value: "#FFFFFF", when: { mode: "light" } },
          { value: "#000000", when: { mode: "dark" } },
        ],
      },
    },
  },
  {
    op: "insert",
    id: "frameone",
    parent: null,
    node: { type: "frame", name: "Home", x: 0, y: 0, w: 400, h: 300, fill: "#F1EEE8" },
  },
  {
    op: "insert",
    id: "pricing",
    parent: null,
    node: {
      type: "frame",
      name: "Pricing — Desktop",
      x: 500,
      y: 0,
      w: 1440,
      h: 960,
      fill: { $ref: "surface/page" },
      theme: { brand: "Acme" },
    },
  },
  {
    op: "insert",
    id: "framethree",
    parent: null,
    node: { type: "frame", name: "Docs", x: 2100, y: 0, w: 400, h: 300, fill: "#1B1F24" },
  },
]

/** A new file may start with sample content: clear the page first. */
async function clearPage(page: Page) {
  await page.evaluate(() => {
    const s = (window as unknown as W).__kimo.session
    const ids = s.store.children(null)
    if (ids.length)
      s.apply(
        ids.map((id) => ({ op: "delete", id })),
        "clear page",
      )
  })
  await settle(page)
}

async function seed(page: Page) {
  await clearPage(page)
  await page.evaluate(
    (ops) => (window as unknown as W).__kimo.session.apply(ops, "seed preview"),
    SEED,
  )
  await settle(page)
}

const docJson = (page: Page) =>
  page.evaluate(() => JSON.stringify((window as unknown as W).__kimo.session.store.toDocument()))

/** RGBA of one screen pixel (CSS px, page coordinates). */
async function screenPixel(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.screenshot({
    clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 },
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

/** Waits until the stage has drawn something at its centre (CanvasKit init is async). */
type Px = [number, number, number, number]

async function waitDrawn(page: Page, want: (px: Px) => boolean, what: string): Promise<Px> {
  const st = await page.locator(".preview__stage").boundingBox()
  if (!st) throw new Error("no stage")
  const deadline = Date.now() + 20_000
  let px: number[] = []
  while (Date.now() < deadline) {
    px = await screenPixel(page, st.x + st.width / 2, st.y + st.height / 2)
    const rgba: Px = [px[0] ?? 0, px[1] ?? 0, px[2] ?? 0, px[3] ?? 0]
    if (want(rgba)) return rgba
    await page.waitForTimeout(150)
  }
  throw new Error(`${what}: stage centre pixel ${px}`)
}

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
  bg: string
  color: string
  radius: number
  border: string
  bb: string
  shadow: string
  jc: string
  ai: string
  op: string
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
        gap: parseFloat(cs.columnGap) || 0,
        fs: parseFloat(cs.fontSize),
        fw: cs.fontWeight,
        ff: cs.fontFamily.split(",")[0]?.replace(/"/g, "").trim() ?? "",
        bg: cs.backgroundColor,
        color: cs.color,
        radius: parseFloat(cs.borderTopLeftRadius),
        border: `${cs.borderTopWidth} ${cs.borderTopColor}`,
        bb: `${cs.borderBottomWidth} ${cs.borderBottomColor}`,
        shadow: cs.boxShadow,
        jc: cs.justifyContent,
        ai: cs.alignItems,
        op: cs.opacity,
      }
    }
    return out
  }, sels) as Promise<Record<string, M | null>>
}

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

const previewButton = (page: Page) => page.locator(".topbar__preview")

export const scenarios: Scenario[] = [
  {
    name: "board27 §9 (b): topbar Preview — disabled on an empty page, tooltip names the frame",
    async run(ctx) {
      const { page } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      await openEditor(page, ctx.url)
      await clearPage(page)
      const btn = previewButton(page)
      expect((await btn.getAttribute("aria-disabled")) === "true", "disabled without frames")
      const op = await btn.evaluate((e) => getComputedStyle(e).opacity)
      expect(op === "0.4", `disabled opacity ${op}`)
      await btn.hover()
      await page.locator(".kimo-tooltip", { hasText: "Page has no frames" }).waitFor()
      await btn.click({ force: true }) // aria-disabled: Playwright would wait for "enabled"
      expect((await page.locator(".preview").count()) === 0, "disabled click opens nothing")
      await page.mouse.move(700, 500)
      await seed(page)
      expect((await btn.getAttribute("aria-disabled")) === null, "enabled with frames")
      await page.evaluate(() =>
        (window as unknown as W).__kimo.session.ui.getState().select(["pricing"]),
      )
      await btn.hover()
      const tip = page.locator(".kimo-tooltip", { hasText: "Preview “Pricing — Desktop”" })
      await tip.waitFor()
      const keys = await tip.locator(".kimo-tooltip__keys").innerText()
      expect(/Space/.test(keys), `tooltip key ${keys}`)
    },
  },
  {
    name: "board27 §9 (a): ⇧Space opens Preview; ‹ › / ← →; T is preview-only; Esc restores",
    async run(ctx) {
      const { page } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      await openEditor(page, ctx.url)
      await seed(page)
      await page.evaluate(() =>
        (window as unknown as W).__kimo.session.ui.getState().select(["pricing"]),
      )
      const before = await docJson(page)
      await page.locator(".canvas-host").click({ position: { x: 5, y: 5 } })
      await page.evaluate(() =>
        (window as unknown as W).__kimo.session.ui.getState().select(["pricing"]),
      )
      await page.keyboard.press("Shift+Space")
      const overlay = page.locator(".preview")
      await overlay.waitFor()
      // Covers the whole window (panels, toolbar, agent hidden underneath).
      const ob = await overlay.boundingBox()
      expect(
        ob?.x === 0 && ob.y === 0 && ob.width === 1440 && ob.height === 900,
        `overlay ${JSON.stringify(ob)}`,
      )
      expect((await page.locator(".preview__name").innerText()) === "Pricing — Desktop", "name")
      expect((await page.locator(".preview__count").innerText()) === "2 / 3", "count 2 / 3")
      // Initial theme = the frame's pins (mode light by default): the frame renders white.
      const light = await waitDrawn(page, (p) => p[0] > 240 && p[1] > 240 && p[2] > 240, "light")
      // Zoom pill reads Fit with the fitted percent.
      const zl = await page.locator(".preview__pill-value--mono").innerText()
      expect(/^Fit · \d+ %$/.test(zl), `zoom label ${zl}`)
      // T: dark — the bound fill re-resolves in the preview; the document is untouched.
      await page.keyboard.press("t")
      const dark = await waitDrawn(page, (p) => p[0] < 20 && p[1] < 20 && p[2] < 20, "dark")
      expect(light[0] !== dark[0], "pixels changed")
      expect(
        (await page.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")) === "true",
        "moon pressed",
      )
      expect((await docJson(page)) === before, "theme override never written")
      // Axis select shows the frame's pinned brand.
      const brand = await page.getByRole("button", { name: "Theme brand" }).innerText()
      expect(brand.includes("brand: Acme"), `brand pill ${brand}`)
      // Zoom 1 → 100 %, 0 → Fit.
      await page.keyboard.press("1")
      await settle(page)
      expect((await page.locator(".preview__pill-value--mono").innerText()) === "100 %", "100 %")
      await page.keyboard.press("0")
      await settle(page)
      // Editor shortcuts don't fire underneath (R would arm the rectangle tool).
      await page.keyboard.press("r")
      // → / ‹ ›.
      await page.keyboard.press("ArrowRight")
      expect((await page.locator(".preview__name").innerText()) === "Docs", "→ Docs")
      // A picked axis stays picked while stepping (the next frame starts from its own pins).
      expect(
        (await page.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")) === "true",
        "dark kept across frames",
      )
      expect((await page.locator(".preview__count").innerText()) === "3 / 3", "3 / 3")
      await page.getByRole("button", { name: "Previous frame" }).click()
      await page.getByRole("button", { name: "Previous frame" }).click()
      expect((await page.locator(".preview__count").innerText()) === "1 / 3", "1 / 3")
      await settle(page)
      const fitted = await page.evaluate(() => {
        const e = document.querySelector(".preview") as HTMLElement
        return [e.dataset.box, e.dataset.zoom]
      })
      ctx.log("after ‹‹", fitted)
      // Home (400 × 300) re-fits: min((1440 − 48) / 400, (828 − 48) / 300) = 2.6.
      expect(fitted[0] === "0,0,400,300" && fitted[1] === "2.6000", `re-fit ${fitted}`)
      if (ctx.shots) await page.screenshot({ path: `${ctx.shots}/board27-preview.png` })
      // Esc exits; navigation happened → the last frame is selected; document unchanged.
      await page.keyboard.press("Escape")
      await overlay.waitFor({ state: "detached" })
      const sel = await page.evaluate(() =>
        (window as unknown as W).__kimo.session.ui.getState().selection.join(","),
      )
      expect(sel === "frameone", `selection after exit ${sel}`)
      expect((await docJson(page)) === before, "document unchanged after Preview")
      const tool = await page.evaluate(
        () =>
          (
            window as unknown as { __kimo: { session: { ui: { getState(): { tool: string } } } } }
          ).__kimo.session.ui.getState().tool,
      )
      expect(tool !== "rect", `R did not reach the editor (${tool})`)
      // Topbar button + Exit button path; no navigation keeps the selection.
      await previewButton(page).click()
      await overlay.waitFor()
      expect((await page.locator(".preview__name").innerText()) === "Home", "opens the selection")
      await page.locator(".preview__exit").click()
      await overlay.waitFor({ state: "detached" })
    },
  },
  {
    name: "board27 §9 (a): measured pass — Preview Bar / Stage / Hint Row vs PMt3U node values",
    async run(ctx) {
      const { page } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      await openEditor(page, ctx.url)
      await seed(page)
      await page.evaluate(() =>
        (window as unknown as W).__kimo.session.ui.getState().select(["pricing"]),
      )
      await previewButton(page).click()
      await page.locator(".preview").waitFor()
      await waitDrawn(page, (p) => p[0] > 240, "drawn")
      const m = await measure(page, {
        root: ".preview",
        bar: ".preview__bar",
        logo: ".preview__logo",
        name: ".preview__name",
        nav: ".preview__nav",
        navBtn: ".preview__nav-btn",
        count: ".preview__count",
        theme: ".preview__theme",
        segOn: ".preview__seg--on",
        segOff: ".preview__seg:not(.preview__seg--on)",
        pill: ".preview__pill",
        pillValue: ".preview__pill .preview__pill-value",
        zoomValue: ".preview__pill-value--mono",
        pillIcon: ".preview__pill-icon",
        exit: ".preview__exit",
        exitLabel: ".preview__exit-label",
        exitKey: ".preview__key--bar",
        stage: ".preview__stage",
        shadow: ".preview__frame-shadow",
        hints: ".preview__hints",
        hint: ".preview__hint",
        hintKey: ".preview__hint .preview__key",
        hintLabel: ".preview__hint-label",
      })
      const { check, flush } = checker(ctx, "Preview (PMt3U)")
      const g = (k: string) => {
        const v = m[k]
        if (!v) throw new Error(`missing ${k}`)
        return v
      }
      check("root", "fill", g("root").bg, "rgb(14, 14, 16)")
      check("Preview Bar dMexB", "height", g("bar").h, 44)
      check("Preview Bar dMexB", "fill", g("bar").bg, "rgb(22, 22, 24)")
      check("Preview Bar dMexB", "stroke bottom", g("bar").bb, "1px rgba(255, 255, 255, 0.08)")
      check("Preview Bar dMexB", "padding x", g("bar").pad[3] as number, 12)
      check("Preview Bar dMexB", "gap", g("bar").gap, 10)
      check("Preview Bar dMexB", "alignItems", g("bar").ai, "center")
      check("KimoLogo guszg", "size", g("logo").w, 16)
      check("KimoLogo guszg", "x", g("logo").x, 12)
      check("KimoLogo guszg", "fill", g("logo").color, "rgb(242, 242, 243)")
      check(
        "Frame Name NJYXt",
        "font",
        `${g("name").ff} ${g("name").fs} ${g("name").fw}`,
        "Inter 12 400",
      )
      check("Frame Name NJYXt", "color", g("name").color, "rgb(242, 242, 243)")
      check("Frame Name NJYXt", "x (logo + gap 10)", g("name").x, 38)
      check("Frame Nav Y6AA1", "height", g("nav").h, 24)
      check("Frame Nav Y6AA1", "fill", g("nav").bg, "rgba(255, 255, 255, 0.06)")
      check("Frame Nav Y6AA1", "padding x", g("nav").pad[1] as number, 4)
      check("Frame Nav Y6AA1", "gap", g("nav").gap, 2)
      check("Frame Nav Y6AA1", "radius", g("nav").radius, 999)
      check("Nav chevron bC0WI", "size", `${g("navBtn").w}x${g("navBtn").h}`, "24x24")
      check("Nav chevron bC0WI", "icon color", g("navBtn").color, "rgb(201, 201, 206)")
      check("Count X99Rmz", "font", `${g("count").ff} ${g("count").fs}`, "JetBrains Mono 11")
      check("Count X99Rmz", "color", g("count").color, "rgb(201, 201, 206)")
      check("Theme Toggle lAQUQ", "size", `${g("theme").w}x${g("theme").h}`, "62x28")
      check("Theme Toggle lAQUQ", "fill", g("theme").bg, "rgba(255, 255, 255, 0.06)")
      check("Theme Toggle lAQUQ", "padding", g("theme").pad[0] as number, 2)
      check("Seg sun u5miT0 (on)", "size", `${g("segOn").w}x${g("segOn").h}`, "28x24")
      check("Seg sun u5miT0 (on)", "fill", g("segOn").bg, "rgba(255, 255, 255, 0.12)")
      check("Seg sun u5miT0 (on)", "icon", g("segOn").color, "rgb(255, 255, 255)")
      check("Seg moon eQxjm (off)", "icon", g("segOff").color, "rgb(142, 142, 149)")
      check("Theme Select JXfhp", "height", g("pill").h, 28)
      check("Theme Select JXfhp", "padding x", g("pill").pad[1] as number, 10)
      check("Theme Select JXfhp", "gap", g("pill").gap, 6)
      check("Theme Select JXfhp", "fill", g("pill").bg, "rgba(255, 255, 255, 0.06)")
      check("Value H8bOV", "font", `${g("pillValue").ff} ${g("pillValue").fs}`, "Inter 11")
      check("Value H8bOV", "color", g("pillValue").color, "rgb(228, 228, 231)")
      check(
        "Zoom Value C3ZAQ",
        "font",
        `${g("zoomValue").ff} ${g("zoomValue").fs}`,
        "JetBrains Mono 11",
      )
      check(
        "chevron-down lXsUL",
        "size / color",
        `${g("pillIcon").w} ${g("pillIcon").color}`,
        "12 rgb(142, 142, 149)",
      )
      check("Exit CT7WC", "height", g("exit").h, 28)
      check("Exit CT7WC", "padding", g("exit").pad.join(" "), "0 6 0 10")
      check("Exit CT7WC", "stroke", g("exit").border, "1px rgba(255, 255, 255, 0.14)")
      check("Exit CT7WC", "gap", g("exit").gap, 6)
      check("Exit CT7WC", "right edge (padding 12)", g("exit").x + g("exit").w, 1440 - 12)
      check(
        "Label j4LKq3",
        "font / color",
        `${g("exitLabel").ff} ${g("exitLabel").fs} ${g("exitLabel").color}`,
        "Inter 11 rgb(242, 242, 243)",
      )
      check("Key AypvU", "fill", g("exitKey").bg, "rgba(255, 255, 255, 0.12)")
      check("Key AypvU", "radius / padding", `${g("exitKey").radius} ${g("exitKey").pad[1]}`, "3 4")
      check(
        "Keys IKKRF",
        "font / color",
        `${g("exitKey").ff} ${g("exitKey").fs} ${g("exitKey").color}`,
        "JetBrains Mono 11 rgb(228, 228, 231)",
      )
      check("Stage I6kjY", "y", g("stage").y, 44)
      check("Stage I6kjY", "height (900 − 44 − 28)", g("stage").h, 828)
      check(
        "Frame (fit) udQKA",
        "shadow",
        g("shadow").shadow,
        "rgba(0, 0, 0, 0.5) 0px 12px 40px 0px",
      )
      // Fit with 24 px margin: the limiting side sits exactly 24 px inside the stage.
      const sh = g("shadow")
      const st = g("stage")
      const mx = Math.min(sh.x - st.x, st.x + st.w - (sh.x + sh.w))
      const my = Math.min(sh.y - st.y, st.y + st.h - (sh.y + sh.h))
      check("Frame (fit) udQKA", "fit margin (min side)", Math.min(mx, my), 24, 1)
      check("Hint Row szqdl", "height", g("hints").h, 28)
      check("Hint Row szqdl", "gap / justify", `${g("hints").gap} ${g("hints").jc}`, "16 center")
      check("Hint W2E27", "gap", g("hint").gap, 6)
      check(
        "Key kDwh3",
        "fill / radius",
        `${g("hintKey").bg} ${g("hintKey").radius}`,
        "rgba(255, 255, 255, 0.08) 3",
      )
      check(
        "Keys Wi5hL",
        "font / color",
        `${g("hintKey").ff} ${g("hintKey").fs} ${g("hintKey").color}`,
        "JetBrains Mono 11 rgb(201, 201, 206)",
      )
      check(
        "Label a5oPZ",
        "font / color",
        `${g("hintLabel").ff} ${g("hintLabel").fs} ${g("hintLabel").color}`,
        "Inter 11 rgb(142, 142, 149)",
      )
      // Overlay bits must have a real box (no collapsed / hidden scrims).
      for (const k of ["root", "bar", "stage", "hints", "shadow"])
        expect(g(k).h > 0, `${k} has height`)
      flush()
    },
  },
]
