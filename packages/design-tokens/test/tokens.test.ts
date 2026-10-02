import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { buildCssEntries, buildTokens, collectTokens, type Mode } from "../src/build"
import { contrastRatio } from "../src/contrast"
import {
  cssVar,
  cssVarName,
  type TokenEntry,
  tokenValue,
  tokens as typedTokens,
} from "../src/index"
import tree from "../src/tokens.json"
import pen from "./fixtures/pen-variables.json"

type PenVariable =
  | { type: "color"; value: { value: string; theme: { mode: Mode } }[] }
  | { type: "number"; value: number }
  | { type: "string"; value: string }

/** Widened view so assertions compare plain strings. */
const tokens: Record<string, TokenEntry> = typedTokens
const penVars = pen.variables as Record<string, PenVariable>
const collected = collectTokens(tree)
const entries = buildCssEntries(collected)
const byPen = new Map(collected.filter((t) => t.pen).map((t) => [t.pen, t]))

describe("tokens.json mirrors desing.pen 1:1", () => {
  test("snapshot declares a single theme axis, mode = light | dark", () => {
    expect(pen.themes).toEqual({ mode: ["light", "dark"] })
  })

  test("every .pen variable has exactly one token, and no token claims an unknown variable", () => {
    expect([...byPen.keys()].sort()).toEqual(Object.keys(penVars).sort())
    expect(collected.filter((t) => t.pen).length).toBe(Object.keys(penVars).length)
  })

  for (const [name, variable] of Object.entries(penVars)) {
    test(`${name} has an identical value and CSS name`, () => {
      const token = byPen.get(name)
      expect(token?.name).toBe(name)
      const entry = tokens[name]
      if (!entry) throw new Error(`no generated token for ${name}`)
      expect(entry.cssVar).toBe(`--kimo-${name}`)
      if (variable.type === "color") {
        expect(token?.type).toBe("color")
        for (const { value, theme } of variable.value) {
          expect(entry.value[theme.mode]).toBe(value)
        }
        // Convention: $value is the light (default) mode.
        expect(entry.declared.light).toBe(entry.value.light)
      } else if (variable.type === "number") {
        expect(token?.value).toEqual({ value: variable.value, unit: "px" })
        expect(entry.value.light).toBe(`${variable.value}px`)
        expect(entry.modeDependent).toBe(false)
      } else {
        expect(token?.type).toBe("fontFamily")
        expect((token?.value as string[] | undefined)?.[0]).toBe(variable.value)
        expect(entry.value.light.startsWith(`"${variable.value}"`)).toBe(true)
      }
    })
  }
})

describe("component and composite values from the .pen nodes", () => {
  test("Button: height 32, padding 0 14, gap 6, pill radius, 13px / 500", () => {
    expect(tokenValue("button-height")).toBe("32px")
    expect(tokenValue("button-padding-x")).toBe("14px")
    expect(tokenValue("button-gap")).toBe("6px")
    expect(tokenValue("button-radius")).toBe("999px")
    expect(tokenValue("button-font-size")).toBe("13px")
    expect(tokenValue("button-font-weight")).toBe("500")
    expect(tokenValue("button-icon-size")).toBe("16px")
  })

  test("IconButton: 28 × 28, radius-md, 16px icon", () => {
    expect(tokenValue("icon-button-size")).toBe("28px")
    expect(tokenValue("icon-button-radius")).toBe("10px")
    expect(tokenValue("icon-button-icon-size")).toBe("16px")
  })

  test("elevation shadows follow the mode through the shadow colors", () => {
    expect(typedTokens["elevation-popover"].value).toEqual({
      light: "0px 4px 16px 0px #0A0A0A0F",
      dark: "0px 4px 16px 0px #00000080",
    })
    expect(typedTokens["elevation-dialog"].value.light).toBe(
      "0px 2px 6px 0px #0A0A0A0F, 0px 16px 40px 0px #0A0A0A1F",
    )
  })

  test("typography styles", () => {
    expect(tokenValue("type-display-font-size")).toBe("40px")
    expect(tokenValue("type-display-font-weight")).toBe("500")
    expect(tokenValue("type-display-letter-spacing")).toBe("-1px")
    expect(tokenValue("type-heading-letter-spacing")).toBe("-0.6px")
    expect(tokenValue("type-caption-letter-spacing")).toBe("0.2px")
    expect(tokenValue("type-mono-font-family")).toStartWith('"JetBrains Mono"')
  })
})

describe("contrast (WCAG AA, 4.5:1)", () => {
  const modes: Mode[] = ["light", "dark"]
  for (const mode of modes) {
    for (const fg of ["text-primary", "text-secondary"] as const) {
      for (const bg of ["bg-app", "bg-subtle"] as const) {
        test(`${fg} on ${bg} (${mode})`, () => {
          const ratio = contrastRatio(tokenValue(fg, mode), tokenValue(bg, mode))
          expect(ratio).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
    test(`on-accent on accent (${mode})`, () => {
      expect(
        contrastRatio(tokenValue("on-accent", mode), tokenValue("accent", mode)),
      ).toBeGreaterThanOrEqual(4.5)
    })
  }

  test("contrastRatio matches known reference values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5)
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5)
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2)
  })
})

describe("generated files", () => {
  const files = buildTokens(tree)
  for (const [name, contents] of Object.entries(files)) {
    test(`src/generated/${name} is up to date`, async () => {
      const onDisk = await Bun.file(join(import.meta.dir, "..", "src", "generated", name)).text()
      expect(onDisk).toBe(contents)
    })
  }

  test("editor.css redeclares every mode-dependent alias in theme blocks", () => {
    const css = files["editor.css"]
    const dark = css.slice(css.indexOf('[data-theme="dark"]'), css.indexOf("@media"))
    for (const e of entries.filter((x) => x.modeDependent)) {
      expect(dark).toContain(`--kimo-${e.name}: ${e.declared.dark};`)
    }
    expect(css).toContain(':root:not([data-theme="light"])')
    expect(dark).toContain("--kimo-button-primary-bg: var(--kimo-accent);")
  })

  test("tailwind theme maps colors, spacing, radius, type and shadows", () => {
    const tw = files["tailwind-theme.css"]
    expect(tw).toContain("@theme inline {")
    expect(tw).toContain("--color-bg-app: var(--kimo-bg-app);")
    expect(tw).toContain("--spacing-4: var(--kimo-space-4);")
    expect(tw).toContain("--radius-pill: var(--kimo-radius-pill);")
    expect(tw).toContain("--text-display--letter-spacing: var(--kimo-type-display-letter-spacing);")
    expect(tw).toContain("--shadow-dialog: var(--kimo-elevation-dialog);")
  })

  test("CSS var helpers", () => {
    expect(cssVarName("bg-app")).toBe("--kimo-bg-app")
    expect(cssVar("radius-pill")).toBe("var(--kimo-radius-pill)")
  })

  test("build rejects unknown aliases and duplicate names", () => {
    expect(() => buildTokens({ a: { $type: "color", x: { $value: "{a.missing}" } } })).toThrow(
      /Unknown alias/,
    )
    expect(() =>
      buildTokens({
        a: { $type: "dimension", x: { $value: { value: 1, unit: "px" } } },
        b: { $type: "dimension", x: { $value: { value: 2, unit: "px" } } },
      }),
    ).toThrow(/Duplicate/)
  })
})
