/**
 * Board 24 "Needs design — decided" (XCW1g) on the integrated app (`e2e/m4-app-harness`, memory
 * platform): (a) Link… popover NpwJS, (b) OpenType Custom tag Ehror, (i) untitled close prompt
 * a3Y0Fb, (j) SVG rejection details nx2kl, (k) missing font weight QfSAK, (m) web tab title
 * i3wgk, (n) banner priority vs "Ready to commit" a9ykr0. ((l) "+N" menu runs on the board 18
 * harness, `m4-merge.e2e.ts`.) Each surface gets one measured getComputedStyle /
 * getBoundingClientRect pass against the desing.pen node values.
 */
import type { Page } from "playwright"
import { disk, harnessUrl, LOOM, SITE } from "./m4-app.e2e"
import { type E2EContext, expect, type Scenario } from "./run"

type Session = {
  store: {
    getNode(id: string): Record<string, unknown> | undefined
    apply(ops: unknown, o: { origin: string }): { ok: boolean }
    undo(o: string): unknown
    toDocument(): { nodes: Record<string, unknown> }
  }
  ui: { getState(): { select(ids: string[]): void } }
}
export type App = {
  __kimoApp: {
    control: {
      calls: string[]
      requestClose(): Promise<boolean>
      setLocalFonts(f: unknown[]): void
      setGit(root: string, state: unknown, change: unknown): void
    }
    manager: {
      newUntitled(): Promise<{ ref: string }>
      get(ref: string):
        | {
            conflicts: { chooseAll(side: string): void } | null
            state(): { banner: { kind: string } | null }
          }
        | undefined
    }
  }
  __kimo?: { session: Session }
  __closed?: Promise<boolean>
  __closedValue?: boolean
}
declare const window: App & Window

export async function openApp(ctx: E2EContext, hash: string, query = ""): Promise<void> {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}${query}${hash}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as App).__kimoApp)
}

export async function editor(ctx: E2EContext, ref = `${SITE}/home.kimo`, query = "") {
  await openApp(ctx, disk(ref), query)
  await ctx.page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
  await ctx.page.waitForFunction(() => !!(window as unknown as App).__kimo?.session)
  await ctx.page.evaluate(() => document.fonts.ready)
}

export async function selectHeadline(page: Page) {
  await page.evaluate(() =>
    (window as unknown as App).__kimo?.session.ui.getState().select(["Headline01"]),
  )
  await page.getByTestId("text-section").waitFor()
}

export const style = (page: Page) =>
  page.evaluate(
    () =>
      ((window as unknown as App).__kimo?.session.store.getNode("Headline01")?.style ??
        {}) as Record<string, unknown>,
  )

type Box = {
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
  bg: string
  color: string
  radius: number
  shadow: string
  opacity: number
  justify: string
}

export function measure(page: Page, sels: Record<string, string>) {
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
        bg: cs.backgroundColor,
        color: cs.color,
        radius: parseFloat(cs.borderTopLeftRadius),
        shadow: cs.boxShadow,
        opacity: parseFloat(cs.opacity),
        justify: cs.justifyContent,
      }
    }
    return out
  }, sels) as Promise<Record<string, Box | null>>
}

export const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.createElement("div")
    el.style.color = `var(${n})`
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, name)

export function checker(ctx: E2EContext, surface: string) {
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

async function shot(ctx: E2EContext, name: string) {
  if (ctx.shots) await ctx.page.screenshot({ path: `${ctx.shots}/board24-${name}.png` })
}

export const scenarios: Scenario[] = [
  {
    name: "board24 (a): Link… popover — Enter applies, invalid disables Apply, empty removes (measured)",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await selectHeadline(page)
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press("Meta+k")
      const pop = page.getByTestId("text-link-popover")
      await pop.waitFor()
      const field = page.getByRole("textbox", { name: "Link URL" })
      // Board 25 §6 (b): an unsupported scheme (a bare host is now auto-prefixed https://);
      // the error shows 250 ms after input.
      await field.fill("javascript:alert(1)")
      const apply = pop.getByRole("button", { name: "Apply" })
      await pop.locator(".kimo-link-popover__hint--error").waitFor()
      expect(await apply.isDisabled(), "Apply disabled for a URL without an allowed scheme")
      await field.fill("https://kimo.design/pricing")
      await pop.locator(".kimo-link-popover__hint--error").waitFor({ state: "detached" })
      expect(!(await apply.isDisabled()), "Apply enabled for https")
      const m = await measure(page, {
        pop: ".kimo-link-popover",
        header: ".kimo-link-popover .kimo-popover__header",
        leading: ".kimo-link-popover .kimo-popover__leading",
        icon: ".kimo-link-popover__title-icon",
        title: ".kimo-link-popover__title",
        close: ".kimo-link-popover .kimo-popover__close",
        body: ".kimo-link-popover__body",
        field: ".kimo-link-popover__field",
        fieldIcon: ".kimo-link-popover__field .kimo-input__icon",
        fieldText: ".kimo-link-popover__field .kimo-input__field",
        hint: ".kimo-link-popover__hint",
        hintIcon: ".kimo-link-popover__hint-icon",
        hintText: ".kimo-link-popover__hint-text",
        actions: ".kimo-link-popover__actions",
        apply: ".kimo-link-popover__actions .kimo-button--primary",
        open: ".kimo-link-popover__actions .kimo-button--ghost",
        openIcon: ".kimo-link-popover__actions .kimo-button--ghost .kimo-button__icon",
      })
      const { check, flush } = checker(ctx, "Popover · Link (L3eKN)")
      check("Popover L3eKN", "width", m.pop?.w, 300)
      check("Popover L3eKN", "radius-lg", m.pop?.radius, 16)
      check("Popover L3eKN", "bg-overlay", m.pop?.bg, await token(page, "--kimo-bg-overlay"))
      check("Header oqDII", "height", m.header?.h, 40)
      check("Header oqDII", "padding-left", m.header?.pad[3], 12)
      check("Header oqDII", "padding-right", m.header?.pad[1], 6)
      check("Leading JTVM6", "gap", m.leading?.gap, 6)
      check("Icon KqORT", "size", m.icon?.w, 14)
      check("Icon KqORT", "color", m.icon?.color, await token(page, "--kimo-text-secondary"))
      check("Title rG26Y", "font", `${m.title?.ff} ${m.title?.fs} ${m.title?.fw}`, "Inter 12 500")
      check("Close A7UGEI", "size", m.close?.w, 24)
      check("Body mzMkc", "padding", m.body?.pad[0], 12)
      check("Body mzMkc", "gap", m.body?.gap, 10)
      check("Field Oe8Zg", "height", m.field?.h, 30)
      check("Field Oe8Zg", "width", m.field?.w, 276)
      check("Field Oe8Zg", "radius-md", m.field?.radius, 10)
      check("Field Oe8Zg", "padding-x", m.field?.pad[3], 10)
      check("Field icon mU4b8", "size", m.fieldIcon?.w, 14)
      check("Field text BwYzP", "font-size", m.fieldText?.fs, 12)
      check("Hint t7NY3J", "gap", m.hint?.gap, 6)
      check("Hint t7NY3J", "y (field + 10)", (m.hint?.y ?? 0) - ((m.field?.y ?? 0) + 30), 10)
      check("Hint icon tCqnp", "size", m.hintIcon?.w, 12)
      check("Hint text d4xyX", "font-size", m.hintText?.fs, 11)
      check(
        "Hint text d4xyX",
        "color",
        m.hintText?.color,
        await token(page, "--kimo-text-tertiary"),
      )
      check("Actions H1Sutf", "gap", m.actions?.gap, 6)
      check("Open UTbzh", "height", m.open?.h, 28)
      check("Open UTbzh", "padding-x", m.open?.pad[3], 10)
      check("Open UTbzh", "font-size", m.open?.fs, 12)
      check("Open icon zAVGx", "size", m.openIcon?.w, 14)
      check("Apply o0z2u", "height", m.apply?.h, 28)
      check("Apply o0z2u", "padding-x", m.apply?.pad[1], 10)
      check(
        "Apply o0z2u",
        "right edge = body − 12",
        (m.pop?.x ?? 0) + 300 - ((m.apply?.x ?? 0) + (m.apply?.w ?? 0)),
        12,
      )
      flush()
      await shot(ctx, "link-popover")
      await page.keyboard.press("Enter")
      await pop.waitFor({ state: "detached" })
      expect((await style(page)).href === "https://kimo.design/pricing", "Enter applies")
      // Reopen: the current link offers Remove link; an empty field + Enter removes it.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press("Meta+k")
      await pop.waitFor()
      expect((await pop.getByRole("button", { name: "Remove link" }).count()) === 1, "Remove link")
      await page.getByRole("textbox", { name: "Link URL" }).fill("")
      await page.keyboard.press("Enter")
      await pop.waitFor({ state: "detached" })
      expect((await style(page)).href === undefined, "empty + Enter removes")
      // #frame anchors are allowed.
      await page.keyboard.press("Meta+k")
      await page.getByRole("textbox", { name: "Link URL" }).fill("#Pricing")
      await page.keyboard.press("Enter")
      await pop.waitFor({ state: "detached" })
      expect((await style(page)).href === "#Pricing", "#frame applies")
    },
  },
  {
    name: "board24 (b): OpenType Custom tag… expands inline — 4-char tag, value 0–99 (measured)",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await selectHeadline(page)
      await page.getByRole("button", { name: "More text options" }).click()
      const menu = page.getByTestId("text-more-menu")
      await menu.waitFor()
      await menu.getByRole("menuitemradio", { name: /Custom tag/ }).click()
      const block = page.getByTestId("text-custom-tag")
      await block.waitFor()
      const tag = page.getByRole("textbox", { name: "OpenType tag" })
      const value = page.getByRole("textbox", { name: "Feature value" })
      const add = block.getByRole("button", { name: "Add" })
      await tag.fill("cv1")
      expect(await add.isDisabled(), "3 chars: Add disabled")
      await tag.fill("CV11")
      expect((await tag.inputValue()) === "cv11", "lowercased")
      await value.fill("ab")
      expect(await add.isDisabled(), "non-numeric value: Add disabled")
      await value.fill("2")
      expect(!(await add.isDisabled()), "valid: Add enabled")
      const m = await measure(page, {
        block: ".kimo-custom-tag",
        label: ".kimo-custom-tag__label",
        inputs: ".kimo-custom-tag__inputs",
        tag: ".kimo-custom-tag__field--tag",
        tagText: ".kimo-custom-tag__field--tag .kimo-input__field",
        eq: ".kimo-custom-tag__eq",
        value: ".kimo-custom-tag__field--value",
        add: ".kimo-custom-tag__add",
        hint: ".kimo-custom-tag__hint",
      })
      const { check, flush } = checker(ctx, "Custom tag (jtxHo)")
      check("Custom tag jtxHo", "padding-top", m.block?.pad[0], 10)
      check("Custom tag jtxHo", "gap", m.block?.gap, 8)
      check(
        "Custom tag jtxHo",
        "top stroke 1 border",
        /0px 1px 0px 0px inset/.test(m.block?.shadow ?? "") ? 1 : 0,
        1,
      )
      check("Label tQkMh", "font", `${m.label?.ff} ${m.label?.fs} ${m.label?.fw}`, "Inter 12 500")
      check("Inputs oZgHz", "gap", m.inputs?.gap, 6)
      check("Field Qcbn1", "size", `${m.tag?.w}×${m.tag?.h}`, "84×30")
      check("Field Qcbn1", "text", `${m.tagText?.ff} ${m.tagText?.fs}`, "JetBrains Mono 12")
      check("Eq l6vuGd", "font", `${m.eq?.ff} ${m.eq?.fs}`, "JetBrains Mono 11")
      check("Field pPUw9", "size", `${m.value?.w}×${m.value?.h}`, "48×30")
      check("Add IIbvY", "height", m.add?.h, 28)
      check("Add IIbvY", "padding-x", m.add?.pad[1], 10)
      check(
        "Add IIbvY",
        "right edge = block right",
        (m.block?.x ?? 0) + (m.block?.w ?? 0) - ((m.add?.x ?? 0) + (m.add?.w ?? 0)),
        0,
      )
      check("Hint pqGfb", "font-size", m.hint?.fs, 11)
      check("Hint pqGfb", "color", m.hint?.color, await token(page, "--kimo-text-tertiary"))
      flush()
      await shot(ctx, "custom-tag")
      await value.press("Enter")
      await page.waitForFunction(
        () =>
          (
            (window as unknown as App).__kimo?.session.store.getNode("Headline01")?.style as {
              features?: { cv11?: number }
            }
          )?.features?.cv11 === 2,
      )
      expect((await block.count()) === 0, "collapses after Add")
    },
  },
  {
    name: "board24 (i): untitled close prompt — Esc cancels, Don't save discards (measured)",
    async run(ctx) {
      const { page } = ctx
      await openApp(ctx, "#/")
      const ref = await page.evaluate(
        async () => (await window.__kimoApp.manager.newUntitled()).ref,
      )
      await page.evaluate((r) => {
        location.hash = `#/disk/${encodeURIComponent(r)}`
      }, ref)
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      await page.waitForFunction(() => !!(window as unknown as App).__kimo?.session)
      await page.evaluate(() => {
        const s = (window as unknown as App).__kimo?.session
        for (const id of ["Frame00001", "Frame00002"])
          s?.store.apply(
            { op: "insert", id, node: { type: "frame", name: id, w: 100, h: 100 } },
            { origin: "user" },
          )
      })
      const ask = async () => {
        await page.evaluate(() => {
          window.__closedValue = undefined
          window.__closed = window.__kimoApp.control.requestClose()
          void window.__closed.then((v) => {
            window.__closedValue = v
          })
        })
        await page.getByTestId("close-prompt").waitFor()
      }
      await ask()
      const prompt = page.getByTestId("close-prompt")
      expect(
        (await prompt.locator(".kimo-close-prompt__title").innerText()) ===
          "Save “Untitled” before closing?",
        "title",
      )
      expect(
        (await prompt.locator(".kimo-close-prompt__desc").innerText()).includes(
          "its 2 frames are gone for good",
        ),
        "frames count",
      )
      const focused = await page.evaluate(() => document.activeElement?.textContent)
      expect(focused === "Save…", `focus starts on Save… (${focused})`)
      const m = await measure(page, {
        dialog: ".kimo-close-prompt",
        head: ".kimo-close-prompt__head",
        wrap: ".kimo-close-prompt__icon-wrap",
        icon: ".kimo-close-prompt__icon-wrap svg",
        text: ".kimo-close-prompt__text",
        title: ".kimo-close-prompt__title",
        desc: ".kimo-close-prompt__desc",
        footer: ".kimo-close-prompt__footer",
        discard: ".kimo-close-prompt__discard",
        discardLabel: ".kimo-close-prompt__discard .kimo-button__label",
        save: ".kimo-close-prompt__footer .kimo-button--primary",
      })
      const { check, flush } = checker(ctx, "Dialog · Close untitled (n7Xrg)")
      check("Dialog n7Xrg", "padding", m.dialog?.pad[0], 20)
      check("Dialog n7Xrg", "gap", m.dialog?.gap, 14)
      check("Dialog n7Xrg", "radius-xl", m.dialog?.radius, 24)
      check(
        "Dialog n7Xrg",
        "shadow 0 16 48",
        /0px 16px 48px/.test(m.dialog?.shadow ?? "") ? 1 : 0,
        1,
      )
      check("Head cjNpC", "gap", m.head?.gap, 12)
      check("Icon Wrap J3qcm", "size", `${m.wrap?.w}×${m.wrap?.h}`, "32×32")
      check("Icon Wrap J3qcm", "bg-muted", m.wrap?.bg, await token(page, "--kimo-bg-muted"))
      check("Icon Gieuc", "size", m.icon?.w, 16)
      check("Icon Gieuc", "color", m.wrap?.color, await token(page, "--kimo-text-secondary"))
      check("Text wllgi", "gap", m.text?.gap, 4)
      check("Title K3Szup", "font", `${m.title?.ff} ${m.title?.fs} ${m.title?.fw}`, "Inter 13 600")
      check("Desc J0qBj", "font-size", m.desc?.fs, 12)
      check("Desc J0qBj", "line-height 1.45", m.desc?.lh, 17.4)
      check("Desc J0qBj", "color", m.desc?.color, await token(page, "--kimo-text-secondary"))
      check("Footer Pr0X1", "gap", m.footer?.gap, 8)
      check(
        "Don't save VYQpB",
        "left-aligned (dialog x + 20)",
        (m.discard?.x ?? 0) - (m.dialog?.x ?? 0),
        20,
      )
      check("Don't save VYQpB", "height", m.discard?.h, 28)
      check("Don't save VYQpB", "padding-x", m.discard?.pad[3], 10)
      check(
        "Don't save label e5j2wK",
        "color danger",
        m.discardLabel?.color,
        await token(page, "--kimo-danger"),
      )
      check("Save… nUfbg", "height", m.save?.h, 28)
      check(
        "Save… nUfbg",
        "right edge = dialog − 20",
        (m.dialog?.x ?? 0) + (m.dialog?.w ?? 0) - ((m.save?.x ?? 0) + (m.save?.w ?? 0)),
        20,
      )
      check(
        "Footer Pr0X1",
        "y (head + 14)",
        (m.footer?.y ?? 0) - ((m.head?.y ?? 0) + (m.head?.h ?? 0)),
        14,
      )
      flush()
      await shot(ctx, "close-prompt")
      // Esc = Cancel: the window stays open.
      await page.keyboard.press("Escape")
      await prompt.waitFor({ state: "detached" })
      await page.waitForFunction(() => window.__closedValue === false)
      // Again → Don't save: the window closes, the recovery entry is gone.
      await ask()
      await page.getByRole("button", { name: "Don't save" }).click()
      await page.waitForFunction(() => window.__closedValue === true)
      expect(
        await page.evaluate(() => window.__kimoApp.control.calls.includes("close")),
        "window closed",
      )
    },
  },
  {
    name: "board24 (j): SVG rejection details — rows with lines, Import without these (measured)",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      const before = await page.evaluate(
        () =>
          Object.keys((window as unknown as App).__kimo?.session.store.toDocument().nodes ?? {})
            .length,
      )
      await page.locator(".editor__canvas").click({ position: { x: 900, y: 600 } })
      await page.evaluate(() => {
        const dt = new DataTransfer()
        dt.setData(
          "text/plain",
          [
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">',
            '<path d="M0 0L10 10"/>',
            "<g>",
            "<script>alert(1)</script>",
            "</g>",
            '<use href="https://cdn.example.com/assets/x.svg"/>',
            "<foreignObject><div>hi</div></foreignObject>",
            '<rect width="1" height="1" onload="x()"/>',
            "</svg>",
          ].join("\n"),
        )
        window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }))
      })
      const host = page.getByTestId("svg-rejection-toast")
      await host.locator(".kimo-toast").waitFor({ timeout: 5000 })
      await host.getByRole("button", { name: "Details" }).click()
      const panel = host.locator(".kimo-svg-rejection")
      await panel.waitFor()
      const rows = (await panel.locator(".kimo-svg-rejection__reason").allInnerTexts()).map((t) =>
        t.replace(/\s+/g, " ").trim(),
      )
      expect(
        rows.join(" | ") ===
          'L4 <script> scripts are never imported | L6 href="https://cdn…/x.svg" external refs blocked | L7 <foreignObject> HTML inside SVG unsupported | L8 onload="…" event handlers stripped',
        rows.join(" | "),
      )
      const m = await measure(page, {
        panel: ".kimo-svg-rejection",
        head: ".kimo-svg-rejection__head",
        icon: ".kimo-svg-rejection__icon",
        title: ".kimo-svg-rejection__title",
        action: ".kimo-svg-rejection__action",
        reasons: ".kimo-svg-rejection__reasons",
        reason: ".kimo-svg-rejection__reason",
        line: ".kimo-svg-rejection__line",
        code: ".kimo-svg-rejection__code",
        why: ".kimo-svg-rejection__why",
        footer: ".kimo-svg-rejection__footer",
        copy: ".kimo-svg-rejection__copy",
        copyIcon: ".kimo-svg-rejection__copy .kimo-button__icon",
        import: ".kimo-svg-rejection__footer .kimo-button--secondary",
      })
      const { check, flush } = checker(ctx, "Toast · expanded (wcrmf)")
      // Board 25 §6 (c) J30Nk decides 360 (was the 349 stage width).
      check("Toast wcrmf", "width", m.panel?.w, 360)
      check("Toast wcrmf", "radius-lg", m.panel?.radius, 16)
      check("Toast wcrmf", "bg-overlay", m.panel?.bg, await token(page, "--kimo-bg-overlay"))
      check("Head imrWl", "height", m.head?.h, 35)
      check("Head imrWl", "padding", `${m.head?.pad[0]} ${m.head?.pad[1]}`, "10 12")
      check("Head imrWl", "gap", m.head?.gap, 8)
      check("Head imrWl", "fill danger-soft", m.head?.bg, await token(page, "--kimo-danger-soft"))
      check("Icon PVGT6", "size", m.icon?.w, 14)
      check("Icon PVGT6", "color", m.icon?.color, await token(page, "--kimo-danger"))
      check("Title RA7gk", "font", `${m.title?.ff} ${m.title?.fs} ${m.title?.fw}`, "Inter 12 500")
      check("Action vwS9j", "font", `${m.action?.fs} ${m.action?.fw}`, "11 500")
      check(
        "Action vwS9j",
        "right inset 12",
        (m.head?.x ?? 0) + (m.head?.w ?? 0) - ((m.action?.x ?? 0) + (m.action?.w ?? 0)),
        12,
      )
      check("Reasons eLrfb", "padding-y", m.reasons?.pad[0], 6)
      check("Reason HwfRw", "height", m.reason?.h, 23)
      check("Reason HwfRw", "padding", `${m.reason?.pad[0]} ${m.reason?.pad[3]}`, "4 12")
      check("Reason HwfRw", "gap", m.reason?.gap, 8)
      check("Line q1wKl", "width", m.line?.w, 24)
      check("Line q1wKl", "font", `${m.line?.ff} ${m.line?.fs}`, "JetBrains Mono 11")
      check("Code I9kZJ", "color danger", m.code?.color, await token(page, "--kimo-danger"))
      check("Why oNF7R", "font", `${m.why?.ff} ${m.why?.fs}`, "Inter 11")
      check("Why oNF7R", "color", m.why?.color, await token(page, "--kimo-text-secondary"))
      check("Footer aO5B5", "height", m.footer?.h, 40)
      check("Footer aO5B5", "padding", `${m.footer?.pad[0]} ${m.footer?.pad[3]}`, "8 12")
      check("Footer aO5B5", "gap", m.footer?.gap, 6)
      check("Copy report blImo", "height", m.copy?.h, 24)
      check("Copy report blImo", "padding-x", m.copy?.pad[3], 6)
      check("Copy report blImo", "font-size", m.copy?.fs, 11)
      check("Copy icon zAVGx", "size", m.copyIcon?.w, 14)
      check("Import without these I5oP6g", "height", m.import?.h, 24)
      check("Import without these I5oP6g", "padding-x", m.import?.pad[3], 8)
      check("Toast wcrmf", "height", m.panel?.h, 179, 1)
      flush()
      await shot(ctx, "svg-rejection")
      // Import without these: the sanitized SVG imports (explicit consent).
      await panel.getByRole("button", { name: "Import without these" }).click()
      await host.waitFor({ state: "detached" })
      await page.waitForFunction(
        (n) =>
          Object.keys((window as unknown as App).__kimo?.session.store.toDocument().nodes ?? {})
            .length > n,
        before,
        { timeout: 5000 },
      )
      const imported = await page.evaluate(() =>
        JSON.stringify((window as unknown as App).__kimo?.session.store.toDocument().nodes),
      )
      expect(!imported.includes("cdn.example") && !imported.includes("onload"), "sanitized")
    },
  },
  {
    name: "board24 (k): missing font weight — 6px warning dot, tooltip names the rendered weight (measured)",
    async run(ctx) {
      const { page } = ctx
      await openApp(ctx, "#/")
      await page.evaluate(() =>
        window.__kimoApp.control.setLocalFonts([
          {
            family: "Local Sans",
            styles: [400, 600].map((w) => ({
              postscriptName: `LocalSans-${w}`,
              fullName: `Local Sans ${w}`,
              weight: w,
              italic: false,
            })),
          },
        ]),
      )
      await page.evaluate(
        (h) => {
          location.hash = h
        },
        disk(`${SITE}/home.kimo`),
      )
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      await page.waitForFunction(() => !!(window as unknown as App).__kimo?.session)
      await page.evaluate(() =>
        (window as unknown as App).__kimo?.session.store.apply(
          {
            op: "update",
            id: "Headline01",
            set: { style: { font: "Local Sans", weight: 700, size: 28 } },
          },
          { origin: "user" },
        ),
      )
      await selectHeadline(page)
      const dot = page.getByTestId("weight-warning-dot")
      await dot.waitFor({ timeout: 5000 })
      const trigger = page.getByRole("button", { name: "Font weight" })
      await trigger.hover()
      const tip = page.getByTestId("weight-warning-tooltip")
      await tip.waitFor()
      const tipText = (await tip.innerText()).replace(/\s+/g, " ").trim()
      expect(
        tipText ===
          "Local Sans Bold (700) isn't installed Showing Semi Bold 600. Install the weight or pick another.",
        tipText,
      )
      const m = await measure(page, {
        field: '[aria-label="Font weight"]',
        value: '[aria-label="Font weight"] .rp-select__value',
        dot: '[data-testid="weight-warning-dot"]',
        chevron: '[aria-label="Font weight"] .rp-select__chevron',
        tip: '[data-testid="weight-warning-tooltip"]',
        tipTitle: ".kimo-weight-tooltip__title",
        tipBody: ".kimo-weight-tooltip__body",
      })
      const { check, flush } = checker(ctx, "Font missing-weight warning (QfSAK)")
      check("Warning dot HWYvD", "size", `${m.dot?.w}×${m.dot?.h}`, "6×6")
      check("Warning dot HWYvD", "fill warning", m.dot?.bg, await token(page, "--kimo-warning"))
      check("Warning dot HWYvD", "round (radius 3)", m.dot?.radius, 3)
      check("Warning dot HWYvD", "gap to chevron 6", (m.chevron?.x ?? 0) - ((m.dot?.x ?? 0) + 6), 6)
      check(
        "Warning dot HWYvD",
        "vertically centered",
        (m.dot?.y ?? 0) + 3 - ((m.field?.y ?? 0) + (m.field?.h ?? 0) / 2),
        0,
      )
      check("Tooltip Esdjk", "width", m.tip?.w, 260)
      check("Tooltip Esdjk", "padding", `${m.tip?.pad[0]} ${m.tip?.pad[3]}`, "6 8")
      check("Tooltip Esdjk", "gap", m.tip?.gap, 2)
      check("Tooltip Esdjk", "radius-sm", m.tip?.radius, 6)
      check(
        "Tooltip Esdjk",
        "fill text-primary",
        m.tip?.bg,
        await token(page, "--kimo-text-primary"),
      )
      check(
        "Title rQ5cV",
        "font",
        `${m.tipTitle?.ff} ${m.tipTitle?.fs} ${m.tipTitle?.fw}`,
        "Inter 12 500",
      )
      check("Title rQ5cV", "color", m.tipTitle?.color, await token(page, "--kimo-text-inverse"))
      check("Body tPank", "font-size", m.tipBody?.fs, 11)
      check("Body tPank", "line-height 1.45", m.tipBody?.lh, 15.95)
      check("Body tPank", "opacity", m.tipBody?.opacity, 0.8, 0.01)
      check(
        "Tooltip Esdjk",
        "below the field",
        (m.tip?.y ?? 0) - ((m.field?.y ?? 0) + (m.field?.h ?? 0)),
        6,
      )
      flush()
      await shot(ctx, "weight-warning")
      // Changing to a weight the family ships clears the dot.
      await page.evaluate(() =>
        (window as unknown as App).__kimo?.session.store.apply(
          {
            op: "update",
            id: "Headline01",
            set: { style: { font: "Local Sans", weight: 600, size: 28 } },
          },
          { origin: "user" },
        ),
      )
      await dot.waitFor({ state: "detached" })
    },
  },
  {
    name: "board24 (m): web tab title — [●] {file} [· state] — Kimo",
    async run(ctx) {
      const { page } = ctx
      // The memory platform records `window.setTitle` (the browser platform sets document.title).
      const lastTitle = () =>
        page.evaluate(() =>
          [...window.__kimoApp.control.calls]
            .reverse()
            .find((c) => c.startsWith("setTitle "))
            ?.slice("setTitle ".length),
        )
      const until = async (want: RegExp | string) => {
        const end = Date.now() + 10_000
        let got: string | undefined
        while (Date.now() < end) {
          got = await lastTitle()
          if (typeof want === "string" ? got === want : want.test(got ?? "")) return got
          await page.waitForTimeout(50)
        }
        throw new Error(`tab title: want ${want}, got ${got}`)
      }
      await editor(ctx, `${SITE}/home.kimo`, "?os=web")
      ctx.log(`    saved: ${await until("home — Kimo")}`)
      await page.evaluate(
        (h) => {
          location.hash = h
        },
        disk(`${LOOM}/marketing.kimo`),
      )
      ctx.log(`    conflicts: ${await until(/^marketing · \d+ conflicts? — Kimo$/)}`)
      await page.evaluate(() => {
        location.hash = "#/"
      })
      ctx.log(`    home: ${await until("Kimo")}`)
    },
  },
  {
    name: "board24 (n): git merge → all resolved (Save) → 'Ready to commit' replaces the git banner in the same slot",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx, `${LOOM}/marketing.kimo`)
      await page.evaluate((root) => {
        window.__kimoApp.control.setGit(
          root,
          {
            branch: "feature/pricing",
            head: "abc",
            operation: "merge",
            indexLocked: false,
            fileStatus: "conflict",
            changedCount: 1,
          },
          { kind: "operation-started", operation: "merge" },
        )
      }, LOOM)
      const banner = page.locator(".kimo-banner")
      await banner.waitFor({ timeout: 10_000 })
      await page.waitForFunction(
        () =>
          document.querySelector(".kimo-banner")?.getAttribute("data-banner") === "merge-conflicts",
      )
      const slot1 = await banner.boundingBox()
      await page.evaluate(
        (r) => window.__kimoApp.manager.get(r)?.conflicts?.chooseAll("ours"),
        `${LOOM}/marketing.kimo`,
      )
      await page.waitForFunction(() =>
        (document.querySelector(".kimo-banner") as HTMLElement | null)?.innerText.includes(
          "All conflicts resolved. Save to mark them resolved for git.",
        ),
      )
      expect(
        (await banner.getByRole("button", { name: "Save", exact: true }).count()) === 1,
        "step 2: CTA becomes Save",
      )
      await banner.getByRole("button", { name: "Save", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".kimo-banner")?.getAttribute("data-banner") === "merge-ready",
        undefined,
        { timeout: 10_000 },
      )
      expect((await page.locator(".kimo-banner").count()) === 1, "one banner, no stacking")
      const slot3 = await banner.boundingBox()
      const { check, flush } = checker(ctx, "Banner slot (a9ykr0)")
      check("Ready to commit iCsK2", "same slot y", slot3?.y, slot1?.y ?? -1)
      check("Ready to commit iCsK2", "same slot width", slot3?.width, slot1?.width ?? -1)
      check("Ready to commit iCsK2", "same slot height", slot3?.height, slot1?.height ?? -1)
      flush()
      await shot(ctx, "ready-to-commit")
      // A resolution undone → the git (conflicts) banner returns.
      await page.evaluate(() => (window as unknown as App).__kimo?.session.store.undo("user"))
      await page.waitForFunction(
        () =>
          document.querySelector(".kimo-banner")?.getAttribute("data-banner") === "merge-conflicts",
        undefined,
        { timeout: 5000 },
      )
    },
  },
]
