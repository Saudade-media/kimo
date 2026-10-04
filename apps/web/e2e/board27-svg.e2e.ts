/**
 * Board 27 §6 (e) r6nLx "SVG import · Outline strokes enabled" in the real editor (m4-app
 * harness): pasting an SVG with stroked paths opens the import popover with Outline strokes
 * enabled and the count in its sub line (G3tQz); on → each stroke imports as a filled outline
 * path (CanvasKit stroker); an SVG without strokes shows it disabled with "No strokes in this
 * file". One measured pass (getComputedStyle + getBoundingClientRect) against lxXp0's nodes.
 */
import type { Page } from "playwright"
import { disk, harnessUrl, SITE } from "./m4-app.e2e"
import { type E2EContext, expect, type Scenario } from "./run"

type Kimo = {
  __kimoApp?: unknown
  __kimo?: {
    session: {
      store: {
        getNode(id: string): Record<string, unknown> | undefined
        nodeIds(): string[]
      }
    }
    canvas(): { renderer: unknown } | null
  }
}
declare const window: Kimo & Window

async function editor(ctx: E2EContext) {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}${disk(`${SITE}/home.kimo`)}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as Kimo).__kimoApp)
  await ctx.page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
  await ctx.page.waitForFunction(
    () => !!window.__kimo?.session && !!window.__kimo.canvas()?.renderer,
    undefined,
    { timeout: 15_000 },
  )
}

/** Pastes SVG markup onto the canvas (the editor's window paste handler). */
async function paste(page: Page, text: string) {
  await page.evaluate((t) => {
    const dt = new DataTransfer()
    dt.setData("text/plain", t)
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, cancelable: true }))
  }, text)
  await page.locator(".svg-import").waitFor({ timeout: 5_000 })
}

const STROKED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect id="Ring" x="10" y="10" width="40" height="40" fill="none" stroke="#E8590C" stroke-width="4"/><path id="Rule" d="M0 90L100 90" fill="none" stroke="#0A0A0A" stroke-width="2" stroke-dasharray="10 10"/><circle id="Dot" cx="80" cy="30" r="8" fill="#0A0A0A"/></svg>`
const PLAIN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10Z" fill="#000"/></svg>`

type Diff = { what: string; design: string | number; got: string | number }
function check(diffs: Diff[], what: string, design: string | number, got: string | number) {
  const ok =
    typeof design === "number" && typeof got === "number"
      ? Math.abs(design - got) < 0.6
      : String(design) === String(got)
  if (!ok) diffs.push({ what, design, got })
}

const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.createElement("span")
    el.style.color = `var(${n})`
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, name)

function measure(page: Page) {
  return page.evaluate(() => {
    const read = (sel: string) => {
      const e = document.querySelector(sel)
      if (!e) return null
      const r = e.getBoundingClientRect()
      const cs = getComputedStyle(e)
      return {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        dir: cs.flexDirection,
        display: cs.display,
        gap: Number.parseFloat(cs.rowGap) || 0,
        justify: cs.justifyContent,
        align: cs.alignItems,
        fs: Number.parseFloat(cs.fontSize),
        fw: cs.fontWeight,
        lh: Number.parseFloat(cs.lineHeight),
        color: cs.color,
        ff: cs.fontFamily.split(",")[0]?.replace(/"/g, "").trim(),
      }
    }
    return {
      pop: read(".svg-import"),
      desc: read(".svg-import__desc"),
      group: read(".svg-import__option-group"),
      row: read(".svg-import__option-group > .svg-import__option"),
      label: read(".svg-import__option-group .svg-import__option-label"),
      toggle: read(".svg-import__option-group .kimo-toggle"),
      sub: read(".svg-import__option-sub"),
      prevOption: (() => {
        const g = document.querySelector(".svg-import__option-group")
        const p = g?.previousElementSibling?.getBoundingClientRect()
        return p ? { y: p.y, h: p.height } : null
      })(),
      next: (() => {
        const g = document.querySelector(".svg-import__option-group")
        const n = g?.nextElementSibling?.getBoundingClientRect()
        return n ? { y: n.y } : null
      })(),
    }
  })
}

export const scenarios: Scenario[] = [
  {
    name: "board27-svg: Outline strokes enabled with the stroke count; on → filled outlines",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      const before = new Set(await page.evaluate(() => window.__kimo?.session.store.nodeIds()))
      await paste(page, STROKED)
      const pop = page.locator(".svg-import")
      expect(
        (await pop.locator(".svg-import__desc").textContent()) ===
          "Editable paths in a frame. 3 paths · 2 stroked paths.",
        `desc: ${await pop.locator(".svg-import__desc").textContent()}`,
      )
      const sub = await pop.locator(".svg-import__option-sub").textContent()
      expect(
        sub ===
          "2 stroked paths become filled shapes — they scale without changing weight. Dashes are kept as segments.",
        `sub: ${sub}`,
      )
      const sw = pop.getByRole("switch", { name: "Outline strokes" })
      expect(!(await sw.isDisabled()), "Outline strokes enabled")
      if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click()
      expect((await sw.getAttribute("aria-checked")) === "true", "Outline strokes on")

      // --- Measured pass vs lxXp0 (Z14XA > Body Or83W > Option · Outline strokes vMlWH). -----
      const m = await measure(page)
      const diffs: Diff[] = []
      const tertiary = await token(page, "--kimo-text-tertiary")
      const secondary = await token(page, "--kimo-text-secondary")
      const primary = await token(page, "--kimo-text-primary")
      const p = m.pop
      const g = m.group
      const row = m.row
      const label = m.label
      const tg = m.toggle
      const s = m.sub
      const d = m.desc
      expect(!!(p && g && row && label && tg && s && d), "popover parts present")
      if (p && g && row && label && tg && s && d) {
        check(diffs, "Z14XA Popover width", 296, p.w)
        check(diffs, "Hu0vu Desc width (fill)", 272, d.w)
        check(diffs, "Hu0vu Desc font", 11, d.fs)
        check(diffs, "Hu0vu Desc lineHeight", 11 * 1.45, d.lh)
        check(diffs, "Hu0vu Desc color", secondary, d.color)
        check(diffs, "vMlWH group direction", "column", g.dir)
        check(diffs, "vMlWH group gap", 2, g.gap)
        check(diffs, "vMlWH group width (fill)", 272, g.w)
        check(diffs, "vMlWH group x (Body padding 12)", p.x + 12, g.x)
        check(diffs, "EiX2l Row justify", "space-between", row.justify)
        check(diffs, "EiX2l Row align", "center", row.align)
        check(diffs, "EiX2l Row width", 272, row.w)
        check(diffs, "aoNtL Label font", 12, label.fs)
        check(diffs, "aoNtL Label weight", "400", label.fw)
        check(diffs, "aoNtL Label color", primary, label.color)
        check(diffs, "aoNtL Label family", "Inter", label.ff ?? "")
        check(diffs, "PqcAa Toggle w", 28, tg.w)
        check(diffs, "PqcAa Toggle h", 16, tg.h)
        check(diffs, "PqcAa Toggle right edge", row.x + row.w, tg.x + tg.w)
        check(diffs, "G3tQz Sub font", 11, s.fs)
        check(diffs, "G3tQz Sub weight", "400", s.fw)
        check(diffs, "G3tQz Sub lineHeight", 11 * 1.45, s.lh)
        check(diffs, "G3tQz Sub color", tertiary, s.color)
        check(diffs, "G3tQz Sub width (fill)", 272, s.w)
        check(diffs, "G3tQz Sub y (gap 2 under Row)", row.y + row.h + 2, s.y)
        check(diffs, "G3tQz Sub height (3 lines)", 3 * 11 * 1.45, s.h)
        if (m.prevOption)
          check(diffs, "Body gap 12 above vMlWH", m.prevOption.y + m.prevOption.h + 12, g.y)
        if (m.next) check(diffs, "Body gap 12 below vMlWH", g.y + g.h + 12, m.next.y)
      }
      ctx.log(`measured pass lxXp0: ${diffs.length ? JSON.stringify(diffs, null, 1) : "0 diffs"}`)
      if (ctx.shots) await pop.screenshot({ path: `${ctx.shots}/board27-svg-outline-on.png` })
      expect(diffs.length === 0, `measured ≠ design: ${JSON.stringify(diffs)}`)

      // --- Import with Outline strokes on: one root frame; strokes are filled outline paths. --
      await pop.getByRole("button", { name: "Import" }).click()
      await page.waitForFunction(
        (n) => (window.__kimo?.session.store.nodeIds().length ?? 0) > n,
        before.size,
      )
      const added = await page.evaluate(
        (prev) =>
          (window.__kimo?.session.store.nodeIds() ?? [])
            .filter((id) => !prev.includes(id))
            .map((id) => window.__kimo?.session.store.getNode(id) as Record<string, unknown>),
        [...before] as string[],
      )
      const byName = (n: string) => added.find((x) => x.name === n)
      const ring = byName("Ring stroke")
      const rule = byName("Rule stroke")
      ctx.log(
        "imported:",
        added.map((x) => `${x.type}:${x.name} ${x.w}×${x.h}${x.stroke ? " stroke" : ""}`),
      )
      expect(!!ring && ring.type === "path" && !ring.stroke, "Ring outline is a filled path")
      expect(
        JSON.stringify(ring?.fill) === JSON.stringify(["#E8590C"]),
        `Ring outline fill ${JSON.stringify(ring?.fill)}`,
      )
      expect(ring?.w === 44 && ring?.h === 44, `Ring outline 44×44, got ${ring?.w}×${ring?.h}`)
      expect(!!rule && ((rule.d as string).match(/M/g)?.length ?? 0) === 5, "Rule dashes: 5")
      expect(!byName("Ring") && !byName("Rule"), "no unfilled originals kept")
      expect(!!byName("Dot"), "unstroked circle imported as-is")
      expect(
        !added.some((x) => x.type === "path" && x.stroke),
        "no editable strokes left with Outline strokes on",
      )
    },
  },
  {
    name: "board27-svg: no strokes → Outline strokes disabled with 'No strokes in this file'",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await paste(page, PLAIN)
      const pop = page.locator(".svg-import")
      const sub = await pop.locator(".svg-import__option-sub").textContent()
      expect(sub === "No strokes in this file", `sub: ${sub}`)
      const sw = pop.getByRole("switch", { name: "Outline strokes" })
      expect(await sw.isDisabled(), "Outline strokes disabled")
      expect((await sw.getAttribute("aria-checked")) === "false", "shown off")
      const box = await pop.locator(".svg-import__option-sub").boundingBox()
      expect(!!box && box.height > 0, "sub line visible")
      await pop.getByRole("button", { name: "Cancel" }).click()
    },
  },
]
