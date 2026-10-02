import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { type TokenEntry, tokens as typedTokens } from "@kimo/design-tokens"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { Button, type ButtonVariant, IconButton } from "../src/index"

const tokens: Record<string, TokenEntry> = typedTokens
const icon = createElement("svg", { viewBox: "0 0 24 24", "data-testid": "icon" })
const src = (p: string) => Bun.file(join(import.meta.dir, "..", "src", p)).text()

describe("Button", () => {
  const variants: ButtonVariant[] = ["primary", "secondary", "ghost", "soft"]
  for (const variant of variants) {
    test(`renders the ${variant} variant as icon then label`, () => {
      const html = renderToString(createElement(Button, { variant, icon }, "Button"))
      expect(html).toBe(
        `<button type="button" class="kimo-button kimo-button--${variant}"><span class="kimo-button__icon" aria-hidden="true"><svg viewBox="0 0 24 24" data-testid="icon"></svg></span><span class="kimo-button__label">Button</span></button>`,
      )
    })
  }

  test("defaults to secondary, omits the icon slot, forwards props and classes", () => {
    const html = renderToString(
      createElement(Button, { type: "submit", disabled: true, className: "x" }, "Save"),
    )
    expect(html).toBe(
      `<button disabled="" type="submit" class="kimo-button kimo-button--secondary x"><span class="kimo-button__label">Save</span></button>`,
    )
  })
})

describe("IconButton", () => {
  test("renders an accessible icon-only button", () => {
    const html = renderToString(createElement(IconButton, { label: "More", icon }))
    expect(html).toBe(
      `<button type="button" class="kimo-icon-button" aria-label="More"><span class="kimo-icon-button__icon" aria-hidden="true"><svg viewBox="0 0 24 24" data-testid="icon"></svg></span></button>`,
    )
  })

  test("active state sets the modifier and aria-pressed", () => {
    const on = renderToString(createElement(IconButton, { label: "Preview", icon, active: true }))
    expect(on).toContain(`class="kimo-icon-button kimo-icon-button--active"`)
    expect(on).toContain(`aria-pressed="true"`)
    const off = renderToString(createElement(IconButton, { label: "Preview", icon, active: false }))
    expect(off).toContain(`aria-pressed="false"`)
    expect(off).not.toContain("--active")
  })
})

describe("component CSS", () => {
  const files = ["button/Button.css", "icon-button/IconButton.css"]

  test("styles.css imports every component stylesheet", async () => {
    const styles = await src("styles.css")
    for (const f of files) expect(styles).toContain(`@import "./${f}";`)
  })

  for (const f of files) {
    test(`${f} uses only defined --kimo-* tokens and no raw colors`, async () => {
      const css = (await src(f)).replace(/\/\*[\s\S]*?\*\//g, "")
      const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])
      expect(used.length).toBeGreaterThan(0)
      for (const v of used) {
        expect(v?.startsWith("--kimo-")).toBe(true)
        expect(tokens[v?.slice("--kimo-".length) ?? ""]).toBeDefined()
      }
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
    })
  }

  test("tokens behind the CSS resolve to the .pen node values", () => {
    const v = (n: string) => tokens[n]?.value.light
    // Button/*: height 32, padding [0, 14], gap 6, radius-pill, 13px / 500, icon 16.
    expect([
      v("button-height"),
      v("button-padding-x"),
      v("button-gap"),
      v("button-radius"),
    ]).toEqual(["32px", "14px", "6px", "999px"])
    expect([v("button-font-size"), v("button-font-weight"), v("button-icon-size")]).toEqual([
      "13px",
      "500",
      "16px",
    ])
    // IconButton: 28 × 28, radius-md (10), icon 16.
    expect([v("icon-button-size"), v("icon-button-radius"), v("icon-button-icon-size")]).toEqual([
      "28px",
      "10px",
      "16px",
    ])
  })
})
