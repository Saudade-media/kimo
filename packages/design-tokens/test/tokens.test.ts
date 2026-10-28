import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { buildCssEntries, buildTokens, collectTokens, type Mode } from "../src/build"
import { contrastRatio } from "../src/contrast"
import { type TokenEntry, tokenValue, tokens as typedTokens } from "../src/index"
import tree from "../src/tokens.json"

const files = buildTokens(tree)

describe("generated token files", () => {
  test("src/generated is up to date with tokens.json", async () => {
    for (const [name, contents] of Object.entries(files)) {
      const onDisk = await Bun.file(join(import.meta.dir, "..", "src", "generated", name)).text()
      expect(onDisk).toBe(contents)
    }
  })

  test("every token resolves to a concrete value in both modes", () => {
    const tokens: Record<string, TokenEntry> = typedTokens
    for (const [name, t] of Object.entries(tokens))
      for (const mode of ["light", "dark"] as const) {
        expect(t.value[mode], `${name} (${mode})`).not.toBe("")
        expect(t.value[mode], `${name} (${mode})`).not.toContain("var(")
      }
  })

  test("editor.css redeclares every mode-dependent alias in the dark theme blocks", () => {
    const css = files["editor.css"]
    const dark = css.slice(css.indexOf('[data-theme="dark"]'), css.indexOf("@media"))
    for (const e of buildCssEntries(collectTokens(tree)).filter((x) => x.modeDependent))
      expect(dark).toContain(`--kimo-${e.name}: ${e.declared.dark};`)
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

describe("contrast (WCAG AA, 4.5:1)", () => {
  test("body text and on-accent text stay readable in light and dark", () => {
    const modes: Mode[] = ["light", "dark"]
    for (const mode of modes) {
      for (const fg of ["text-primary", "text-secondary"] as const)
        for (const bg of ["bg-app", "bg-subtle"] as const)
          expect(
            contrastRatio(tokenValue(fg, mode), tokenValue(bg, mode)),
            `${fg} on ${bg} (${mode})`,
          ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(tokenValue("on-accent", mode), tokenValue("accent", mode)),
        `on-accent on accent (${mode})`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})
