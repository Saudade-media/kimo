import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { type TokenEntry, tokens as typedTokens } from "@kimo/design-tokens"

const tokens: Record<string, TokenEntry> = typedTokens
const srcDir = join(import.meta.dir, "..", "src")
const src = (p: string) => Bun.file(join(srcDir, p)).text()

describe("component CSS", () => {
  const stylesPath = "styles.css"
  const filesOf = async () =>
    [...(await src(stylesPath)).matchAll(/@import "\.\/([^"]+)";/g)].map((m) => m[1] as string)

  test("styles.css imports every component stylesheet", async () => {
    const files = await filesOf()
    const all = [...new Bun.Glob("**/*.css").scanSync(srcDir)].filter((f) => f !== stylesPath)
    expect(files.sort()).toEqual(all.sort())
  })

  test("every var(--kimo-*) refers to a defined token or a custom property of the same sheet", async () => {
    for (const f of await filesOf()) {
      const css = (await src(f)).replace(/\/\*[\s\S]*?\*\//g, "")
      // Layout-only stylesheets (FillRow, StrokeSideFields) reuse other components' colors.
      if (!/(color|background|shadow|border)\s*:/.test(css)) continue
      // Component-local runtime properties (set inline: slider fraction, color-area position)
      // are declared in the same sheet and are not tokens.
      const local = new Set([...css.matchAll(/(--kimo-[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
      for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
        const v = m[1] as string
        expect(v.startsWith("--kimo-"), `${f}: ${v}`).toBe(true)
        if (!local.has(v)) expect(tokens[v.slice("--kimo-".length)], `${f}: ${v}`).toBeDefined()
      }
    }
  })
})
