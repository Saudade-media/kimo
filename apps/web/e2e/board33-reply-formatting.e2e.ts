/**
 * Board 33 "Reply formatting" (desing.pen ME2DT) on the M6 agent harness: §1 the reply's Markdown
 * subset inside Message/Agent (Reply · Formatted c3sxuV), §2 queued messages (JISdq). One
 * measured getComputedStyle / getBoundingClientRect pass against the node values.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { checker, measure, token } from "./m6-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
let built: Promise<string> | undefined

async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/m6-agent-harness/index.html`
  built ??= build({
    root: join(here, "m6-agent-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "board33"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "board33/index.html")
  return `${ctx.url}${await built}`
}

type W = { __m6: { controller: { state: { busy: boolean; composer: { text: string } } } } }

async function open(ctx: E2EContext) {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}?scene=panel`)
  await ctx.page.waitForFunction(() => !!(window as unknown as W).__m6)
  await ctx.page.evaluate(() => document.fonts.ready)
}

const composer = (page: Page) => page.locator("[data-testid=agent-composer] textarea")
async function send(page: Page, text: string) {
  await composer(page).fill(text)
  await composer(page).press("Enter")
}
const idle = (page: Page) =>
  page.waitForFunction(() => !(window as unknown as W).__m6.controller.state.busy, null, {
    timeout: 20_000,
  })

const R = "[data-testid=agent-reply]"

export const scenarios: Scenario[] = [
  {
    name: "board33: reply formatting — Markdown subset in Message/Agent + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await send(page, "Show a formatted reply")
      await idle(page)
      await page.locator(R).waitFor()

      // Nothing literal survives: no **, backticks, fences or link syntax.
      const text = await page.locator(R).innerText()
      for (const raw of ["**", "`", "](", "- **"])
        expect(!text.includes(raw), `no raw Markdown "${raw}" in the reply`)
      expect(
        (await page.locator(`${R} > *`).evaluateAll((els) => els.map((e) => e.tagName))).join(
          ",",
        ) === "P,UL,P,OL,P,PRE,P,P",
        "block order: p, ul, p, ol, p, pre, p, p",
      )

      const bgMuted = await token(page, "--kimo-bg-muted")
      const bgApp = await token(page, "--kimo-bg-app")
      const primary = await token(page, "--kimo-text-primary")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const border = await token(page, "--kimo-border")
      const m = await measure(page, {
        bubble: `.kimo-message--agent:has(${R}) .kimo-message__bubble`,
        stack: R,
        p: `${R} > p`,
        ul: `${R} > ul`,
        li: `${R} > ul > li`,
        marker: `${R} > ul > li .kimo-md__marker`,
        content: `${R} > ul > li .kimo-md__content`,
        nested: `${R} .kimo-md__list--nested`,
        strong: `${R} .kimo-md__strong`,
        em: `${R} .kimo-md__em`,
        code: `${R} .kimo-md__code`,
        pre: `${R} .kimo-md__pre`,
        link: `${R} .kimo-md__link`,
      })
      const c = checker(ctx, "Board 33 §1 Reply · Formatted (c3sxuV)")
      c.box("Bubble (Xt0Hx)", m.bubble, { pad: [10, 14, 10, 14], radius: 16, bg: bgMuted })
      c.box("Bubble stack", m.stack, { gap: 8 })
      c.box("Paragraph (p21fM)", m.p, { fs: 13, lh: 20, ff: "Inter", color: primary })
      c.box("Bullet List (pAvP9)", m.ul, { gap: 4, pad: [0, 0, 0, 0] })
      c.box("Item (EZwNh)", m.li, { gap: 6 })
      c.box("Marker (CiNk2)", m.marker, { w: 14, fs: 13, color: tertiary })
      c.box("Content (tUzLV)", m.content, { gap: 4 })
      c.box("Nested List (PzF9i)", m.nested, { pad: [0, 0, 0, 20], gap: 4 })
      c.box("Strong (z1uAH)", m.strong, { fw: "600", fs: 13 })
      c.box("Em (HQXhs)", m.em, { fs: 13 })
      c.box("Inline Code (r2gx8K)", m.code, {
        ff: "JetBrains Mono",
        fs: 12,
        radius: 4,
        pad: [0, 4, 0, 4],
        bg: bgApp,
      })
      c.box("Code Block (m8kcbO)", m.pre, {
        ff: "JetBrains Mono",
        fs: 12,
        lh: 18,
        radius: 6,
        pad: [8, 10, 8, 10],
        bg: bgApp,
      })
      c.check("Code Block (m8kcbO)", "border", m.pre?.border, `1px ${border}`)
      c.box("Link (RTfof)", m.link, { fs: 13, color: primary })
      const styles = await page.evaluate((r) => {
        const q = (s: string) => getComputedStyle(document.querySelector(`${r} ${s}`) as Element)
        const p = document.querySelector(`${r} > p`)?.getBoundingClientRect()
        const ul = document.querySelector(`${r} > ul`)?.getBoundingClientRect()
        const items = [...document.querySelectorAll(`${r} > ul > li`)].map((e) =>
          e.getBoundingClientRect(),
        )
        const li = document.querySelector(`${r} > ul > li`) as Element
        return {
          em: q(".kimo-md__em").fontStyle,
          link: q(".kimo-md__link").textDecorationLine,
          listStyle: q("> ul").listStyleType,
          pToUl: (ul?.top ?? 0) - (p?.bottom ?? 0),
          itemGap: (items[1]?.top ?? 0) - (items[0]?.bottom ?? 0),
          markerToText:
            (li.querySelector(".kimo-md__content") as Element).getBoundingClientRect().left -
            (li.querySelector(".kimo-md__marker") as Element).getBoundingClientRect().right,
        }
      }, R)
      c.check("Em (HQXhs)", "font-style", styles.em, "italic")
      c.check("Link (RTfof)", "text-decoration", styles.link, "underline")
      c.check("Bullet List (pAvP9)", "list-style", styles.listStyle, "none")
      c.check("Bubble stack", "Paragraph → List", styles.pToUl, 8)
      c.check("Bullet List (pAvP9)", "Item → Item", styles.itemGap, 4)
      c.check("Item (EZwNh)", "Marker → Content", styles.markerToText, 6)
      c.flush()

      // Links open through the controller (system browser), never navigate the app.
      await page.evaluate(() => {
        ;(window as unknown as { __opened: string[] }).__opened = []
        window.open = ((u: string) => {
          ;(window as unknown as { __opened: string[] }).__opened.push(u)
          return null
        }) as typeof window.open
      })
      await page.locator(`${R} .kimo-md__link`).click()
      const opened = await page.evaluate(
        () => (window as unknown as { __opened: string[] }).__opened,
      )
      expect(opened[0] === "https://kimo.dev/pricing", `link opened externally: ${opened}`)
      expect(page.url().includes("board33"), "the app did not navigate")
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board33-reply.png") })
    },
  },
  {
    name: "board33: queued messages — greyed in the thread, edit / remove, run in place + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await send(page, "Now a slow waitlist reply")
      await page.locator(".kimo-composer-agent__send--stop").waitFor()
      await send(page, "Make the answers shorter")
      await send(page, "Then move FAQ above Pricing")
      const q = page.locator("[data-testid=agent-queued-message]")
      await q.nth(1).waitFor()
      expect((await q.count()) === 2, "two queued messages")
      // At the bottom of the thread, after the live status.
      expect(
        await page.evaluate(() => {
          const t = document.querySelector("[data-testid=agent-thread]") as Element
          const kids = [...t.children]
          return kids.slice(-2).every((k) => k.matches("[data-testid=agent-queued-message]"))
        }),
        "queued messages are the last thread items",
      )
      const bgMuted = await token(page, "--kimo-bg-muted")
      const secondary = await token(page, "--kimo-text-secondary")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const sel = "[data-testid=agent-queued-message]"
      const m = await measure(page, {
        item: sel,
        bubble: `${sel} .agent-panel__queued-bubble`,
        meta: `${sel} .agent-panel__queued-meta`,
        label: `${sel} .agent-panel__queued-label`,
        edit: `${sel} [data-testid=agent-queued-edit]`,
        remove: `${sel} [data-testid=agent-queued-remove]`,
        thread: "[data-testid=agent-thread]",
      })
      const c = checker(ctx, "Board 33 §2 Queued Message (JISdq)")
      c.box("Queued Message (JISdq)", m.item, { gap: 4 })
      c.box("Bubble (jjfeY)", m.bubble, {
        w: 260,
        pad: [10, 14, 10, 14],
        radius: 16,
        fs: 13,
        lh: 19,
        bg: bgMuted,
        color: secondary,
      })
      c.box("Queued Meta (VNuE9)", m.meta, { gap: 2, h: 24 })
      c.box("Label (pOHdA)", m.label, { fs: 11, color: tertiary })
      c.box("Edit (IWxtB)", m.edit, { w: 24, h: 24, color: tertiary })
      c.box("Remove (rsnok)", m.remove, { w: 24, h: 24, color: tertiary })
      const t = m.thread as NonNullable<typeof m.thread>
      const right = t.x + t.w - 16
      c.check("Bubble (jjfeY)", "right edge = thread content edge", (m.bubble?.x ?? 0) + 260, right)
      c.check(
        "Queued Meta (VNuE9)",
        "right edge = thread content edge",
        (m.meta?.x ?? 0) + (m.meta?.w ?? 0),
        right,
      )
      c.flush()
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board33-queued.png") })

      // × drops the second; Edit puts the first back in the composer and drops it.
      await q.nth(1).locator("[data-testid=agent-queued-remove]").click()
      expect((await q.count()) === 1, "× removes a queued message")
      await q.nth(0).locator("[data-testid=agent-queued-edit]").click()
      expect((await q.count()) === 0, "Edit takes it out of the queue")
      expect(
        (await composer(page).inputValue()) === "Make the answers shorter",
        "Edit puts the text back in the composer",
      )
      // Queue it again; when the turn ends it runs as a normal user message in place.
      await composer(page).press("Enter")
      await q.nth(0).waitFor()
      await page.waitForFunction(
        () => document.querySelectorAll("[data-testid=agent-queued-message]").length === 0,
        null,
        { timeout: 20_000 },
      )
      const users = await page.locator("[data-testid=agent-user-message]").allInnerTexts()
      expect(
        users[users.length - 1]?.trim() === "Make the answers shorter",
        `the queued message became the last user message: ${users.join(" | ")}`,
      )
      await idle(page)
    },
  },
]
