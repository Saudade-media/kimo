/** Export options: Tailwind theme output and per-file issues. */
import { describe, expect, test } from "bun:test"
import { exportDocument } from "../src"
import { FIXTURES, fakeMeasurer, loadFixture } from "./helpers"

const fixture = (name: string) => {
  const f = FIXTURES.find((x) => x.name === name)
  if (!f) throw new Error(`no fixture ${name}`)
  return loadFixture(f)
}

const file = (files: { path: string; contents: unknown }[], path: string) =>
  files.find((f) => f.path === path)?.contents as string | undefined

describe("tailwind theme output", () => {
  test("v4 (default): @theme block in tokens.css, token utilities", async () => {
    const { doc, libraries } = fixture("components-m3")
    const { files } = await exportDocument(doc, "react-tailwind", { libraries })
    expect(file(files, "tokens.css")).toContain("@theme inline {")
    expect(file(files, "tailwind.config.ts")).toBeUndefined()
    const explicit = await exportDocument(doc, "react-tailwind", {
      libraries,
      tailwindTheme: "v4",
    })
    expect(explicit.files.map((f) => f.contents)).toEqual(files.map((f) => f.contents))
  })

  test("v3: tailwind.config.ts with theme.extend, tokens.css without @theme", async () => {
    const { doc, libraries } = fixture("components-m3")
    const { files } = await exportDocument(doc, "react-tailwind", {
      libraries,
      tailwindTheme: "v3",
    })
    const config = file(files, "tailwind.config.ts") as string
    expect(config).toContain("theme: {\n    extend: {")
    expect(config).toContain("      colors: {")
    expect(config).toMatch(/"[a-z0-9-]+": "var\(--[a-z0-9-]+\)"/)
    expect(config).toContain("satisfies Config")
    expect(file(files, "tokens.css")).not.toContain("@theme")
    expect(file(files, "tokens.css")).toContain(":root {")
  })

  test("none: variables only; utilities fall back to arbitrary values", async () => {
    const { doc, libraries } = fixture("components-m3")
    const v4 = await exportDocument(doc, "react-tailwind", { libraries })
    const none = await exportDocument(doc, "react-tailwind", { libraries, tailwindTheme: "none" })
    expect(file(none.files, "tokens.css")).not.toContain("@theme")
    expect(file(none.files, "tailwind.config.ts")).toBeUndefined()
    const tsx = (fs: typeof none.files) =>
      fs
        .filter((f) => f.path.endsWith(".tsx"))
        .map((f) => f.contents)
        .join("\n")
    expect(tsx(v4.files)).toMatch(/\bbg-surface-card\b/)
    expect(tsx(none.files)).not.toMatch(/\bbg-surface-card\b/)
    expect(tsx(none.files)).toContain("var(--surface-card)")
  })

  test("Map variables to theme tokens off: theme still emitted, classes use arbitrary values", async () => {
    const { doc, libraries } = fixture("components-m3")
    const { files } = await exportDocument(doc, "react-tailwind", {
      libraries,
      themeTokens: false,
    })
    expect(file(files, "tokens.css")).toContain("@theme inline {")
    const tsx = files
      .filter((f) => f.path.endsWith(".tsx"))
      .map((f) => f.contents)
      .join("\n")
    expect(tsx).not.toMatch(/\bbg-surface-card\b/)
    expect(tsx).toContain("var(--surface-card)")
  })
})

describe("issues per file", () => {
  test("every issue names an emitted file", async () => {
    for (const name of ["features-all", "paints-effects", "styling-m2", "text-styles"]) {
      const { doc, libraries } = fixture(name)
      for (const target of ["react-tailwind", "html-css", "svg", "pdf"] as const) {
        const r = await exportDocument(doc, target, { libraries, measureText: fakeMeasurer })
        const paths = new Set(r.files.map((f) => f.path))
        for (const i of r.issues) {
          expect(i.file).toBeDefined()
          expect(paths.has(i.file as string)).toBe(true)
        }
      }
    }
  })
})
