/**
 * Export dialog model: generation through @kimo/exporters (files, issues, Tailwind theme options),
 * the no-overwrite write plan on a memory platform, the diff behind the review step, the zip
 * writer and Copy as PNG.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "@kimo/core-schema"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { copySelectionAsPng } from "../../src/export/copy-png"
import { type ExportSource, generateExport, pdfFontsFrom } from "../../src/export/generate"
import { EXPORT_GROUP, groupIssues, hasIssueError, issueTotal } from "../../src/export/issues"
import {
  contentHash,
  crc32,
  DEFAULT_TOGGLES,
  defaultChoice,
  defaultZipName,
  planWrite,
  safeFileName,
  unifiedDiff,
  zipFiles,
} from "../../src/export/model"

const PACKAGES = join(import.meta.dir, "../../../../packages")
const matrix = parse(
  readFileSync(join(PACKAGES, "exporters/test/fixtures/layout-matrix.kimo"), "utf8"),
)
const source: ExportSource = {
  fileName: "Layout matrix",
  document: () => matrix,
  selection: () => [],
}
const sourceOf = (name: string): ExportSource => {
  const doc = parse(readFileSync(join(PACKAGES, `core-schema/fixtures/valid/${name}.kimo`), "utf8"))
  return { fileName: name, document: () => doc, selection: () => [] }
}

describe("generation through @kimo/exporters", () => {
  test("react, html and tokens produce their files and a summary", async () => {
    const react = await generateExport(source, "react", DEFAULT_TOGGLES)
    expect(react.errors).toEqual([])
    expect(react.files.some((f) => f.path.endsWith(".tsx"))).toBe(true)
    expect(react.files.some((f) => f.path === "tokens.css")).toBe(true)
    expect(react.count).toBe(react.files.length)
    expect(react.summary.frames).toBeGreaterThan(0)

    const html = await generateExport(source, "html", DEFAULT_TOGGLES)
    expect(html.files.map((f) => f.path).sort()).toEqual(["index.html", "styles.css", "tokens.css"])

    const tokens = await generateExport(source, "tokens", DEFAULT_TOGGLES)
    expect(tokens.files.map((f) => f.path)).toEqual(["tokens.css", "tokens.json"])
  })

  test("a selection narrows the export to its frames", async () => {
    const nodes = matrix.nodes as unknown as Record<
      string,
      { parent?: string | null; type: string }
    >
    const first = Object.keys(nodes).find((id) => !nodes[id]?.parent && nodes[id]?.type === "frame")
    const one = await generateExport(
      { ...source, selection: () => (first ? [first] : []) },
      "html",
      DEFAULT_TOGGLES,
    )
    expect(one.summary.frames).toBe(1)
  })

  test("the Tailwind theme option reaches the React exporter: v4, v3, none, and token mapping off", async () => {
    const src = sourceOf("components-m3")
    const file = (g: Awaited<ReturnType<typeof generateExport>>, p: string) =>
      g.files.find((f) => f.path === p)?.contents as string | undefined
    const v4 = await generateExport(src, "react", DEFAULT_TOGGLES)
    expect(file(v4, "tokens.css")).toContain("@theme inline")
    const v3 = await generateExport(src, "react", DEFAULT_TOGGLES, {
      tailwind: { theme: "v3", mapTokens: true },
    })
    expect(file(v3, "tailwind.config.ts")).toContain("extend: {")
    expect(file(v3, "tokens.css")).not.toContain("@theme")
    const none = await generateExport(src, "react", DEFAULT_TOGGLES, {
      tailwind: { theme: "none", mapTokens: true },
    })
    expect(file(none, "tokens.css")).not.toContain("@theme")
    expect(file(none, "tailwind.config.ts")).toBeUndefined()
    const tsx = (g: typeof v4) =>
      g.files
        .filter((f) => f.path.endsWith(".tsx"))
        .map((f) => f.contents)
        .join("\n")
    const off = await generateExport(src, "react", DEFAULT_TOGGLES, {
      tailwind: { theme: "v4", mapTokens: false },
    })
    expect(tsx(v4)).toMatch(/\bbg-surface-card\b/)
    expect(tsx(off)).not.toMatch(/\bbg-surface-card\b/)
    expect(file(off, "tokens.css")).toContain("@theme inline")
  })
})

describe("export issues", () => {
  test("grouped per file in output order, duplicates collapse, failures last", () => {
    const groups = groupIssues(
      [
        {
          code: "FONT_MISSING",
          message: "Font 'Söhne' isn't bundled",
          nodeId: "h1",
          file: "Hero.tsx",
        },
        { code: "EFFECT_APPROXIMATED", message: "blur", nodeId: "g", file: "PricingCard.tsx" },
        { code: "EFFECT_APPROXIMATED", message: "blur", nodeId: "g", file: "PricingCard.tsx" },
        { code: "PAINT_UNSUPPORTED", message: "burn", nodeId: "t", file: "PricingCard.tsx" },
        { code: "VARIABLE_UNRESOLVED", message: "missing: space/legacy", file: "theme.css" },
      ],
      {
        files: ["PricingCard.tsx", "Hero.tsx", "Empty.tsx", "theme.css"],
        names: (id) =>
          ({ g: ["Card", "Glass"], t: ["Page", "Card", "Texture"], h1: ["Hero"] })[id] ?? null,
        failures: ["svg export needs a layout"],
      },
    )
    expect(groups.map((g) => [g.file, g.issues.length])).toEqual([
      ["PricingCard.tsx", 2],
      ["Hero.tsx", 1],
      ["theme.css", 1],
      [EXPORT_GROUP, 1],
    ])
    expect(groups[0]?.issues.map((i) => i.path)).toEqual(["Card › Glass", "Card › Texture"])
    expect(groups[2]?.issues[0]?.level).toBe("error")
    expect(issueTotal(groups)).toBe(5)
    expect(hasIssueError(groups)).toBe(true)
    expect(hasIssueError(groups.slice(0, 2))).toBe(false)
  })

  test("real exporter issues are attributed to emitted files", async () => {
    const g = await generateExport(sourceOf("features-all"), "react", DEFAULT_TOGGLES)
    const paths = new Set(g.files.map((f) => f.path))
    expect(g.issues.length).toBeGreaterThan(0)
    for (const grp of g.issues) expect(paths.has(grp.file) || grp.file === EXPORT_GROUP).toBe(true)
    const mesh = g.issues.flatMap((x) => x.issues).find((i) => i.message.includes("mesh"))
    expect(mesh?.level).toBe("warning")
    expect(mesh?.nodeId).toBeTruthy()
    // PDF (no text target): the IR's issues still show, under export.pdf.
    const pdf = await generateExport(sourceOf("features-all"), "pdf", DEFAULT_TOGGLES)
    expect(pdf.issues.map((x) => x.file)).toEqual(["export.pdf"])
    const messages = pdf.issues.flatMap((x) => x.issues).map((i) => i.message)
    expect(messages.some((m) => m.includes("PDF mesh gradients"))).toBe(true)
    expect(messages.some((m) => m.includes("shader"))).toBe(true)
  })
})

describe("writing to a folder", () => {
  test("existing files are diffed against what is on disk", async () => {
    const platform = createMemoryPlatform({
      files: { "/out/same.css": "a{}", "/out/changed.css": "old" },
    })
    const files = [
      { path: "new.tsx", contents: "x" },
      { path: "same.css", contents: "a{}" },
      { path: "changed.css", contents: "new" },
      { path: "img/a@2x.png", contents: new Uint8Array([1, 2, 3]) },
    ]
    const plan = await planWrite(files, "/out", platform)
    expect(plan.map((e) => [e.path, e.status])).toEqual([
      ["new.tsx", "new"],
      ["same.css", "same"],
      ["changed.css", "changed"],
      ["img/a@2x.png", "new"],
    ])
  })

  test("review defaults to Overwrite only for files Kimo wrote last time and nobody touched", () => {
    const disk = new TextEncoder().encode("old")
    expect(defaultChoice(disk, contentHash("old"))).toBe("overwrite")
    expect(defaultChoice(disk, contentHash("other"))).toBe("keep")
    expect(defaultChoice(disk, undefined)).toBe("keep")
  })

  test("unified diff: 3 lines of context, numbers per side, hunks split", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i + 1}`)
    const after = [...before]
    after[3] = "L4"
    after[16] = "L17"
    const d = unifiedDiff(`${before.join("\n")}\n`, `${after.join("\n")}\n`)
    expect(d.added).toBe(2)
    expect(d.removed).toBe(2)
    expect(d.hunks.length).toBe(2)
    expect(d.hunks[0]?.rows.map((r) => `${r.kind[0]}${r.number}`)).toEqual([
      "c1",
      "c2",
      "c3",
      "r4",
      "a4",
      "c5",
      "c6",
      "c7",
    ])
    expect(unifiedDiff("a\n", "a\n").hunks).toEqual([])
    expect(unifiedDiff("", "x\ny\n").added).toBe(2)
  })
})

describe("web download", () => {
  test("zip file names are sanitized", () => {
    expect(safeFileName("Marketing site", "zip")).toBe("Marketing site.zip")
    expect(safeFileName("a/b.zip", "zip")).toBe("a-b.zip")
    expect(defaultZipName("Hero")).toBe("kimo-export-hero.zip")
  })

  test("zip: known crc32 and a deterministic store-only archive layout", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926")
    const files = [
      { path: "a.txt", contents: "hello" },
      { path: "b/c.bin", contents: new Uint8Array([0, 255]) },
    ]
    const z = zipFiles(files)
    expect(zipFiles(files)).toEqual(z)
    const v = new DataView(z.buffer)
    expect(v.getUint32(0, true)).toBe(0x04034b50)
    const end = z.byteLength - 22
    expect(v.getUint32(end, true)).toBe(0x06054b50)
    expect(v.getUint16(end + 10, true)).toBe(2)
    expect(new TextDecoder().decode(z.slice(30, 35))).toBe("a.txt")
    expect(new TextDecoder().decode(z.slice(35, 40))).toBe("hello")
  })
})

describe("PDF fonts and Copy as PNG", () => {
  const ttf = new Uint8Array(
    readFileSync(join(PACKAGES, "renderer/assets/fonts/Inter-Regular.ttf")),
  )

  test("the canvas face's TTF/OTF bytes reach the exporter; WOFF 2, unknown bytes and no renderer fall back", () => {
    const asked: unknown[] = []
    const fonts = pdfFontsFrom(() => (family, weight, style) => {
      asked.push([family, weight, style])
      return family === "Inter" ? ttf : null
    })
    expect(fonts("Inter", 400, false)).toBe(ttf)
    expect(fonts("Inter", 700, true)).toBe(ttf)
    expect(fonts("Nope", 400, false)).toBeNull()
    expect(asked).toEqual([
      ["Inter", 400, "normal"],
      ["Inter", 700, "italic"],
      ["Nope", 400, "normal"],
    ])
    const woff2 = new Uint8Array(64)
    woff2.set([0x77, 0x4f, 0x46, 0x32]) // "wOF2"
    expect(pdfFontsFrom(() => () => woff2)("Inter", 400, false)).toBeNull()
    expect(pdfFontsFrom(() => () => new Uint8Array(64))("Inter", 400, false)).toBeNull()
    expect(pdfFontsFrom(() => null)("Inter", 400, false)).toBeNull()
  })

  test("copy as PNG: an empty selection, no renderer and a denied clipboard are reported, never thrown", async () => {
    const renderer = { exportRaster: async () => new Uint8Array() }
    expect(await copySelectionAsPng({ selection: [], renderer })).toMatchObject({
      ok: false,
      reason: "empty",
    })
    expect(await copySelectionAsPng({ selection: ["A"], renderer: null })).toMatchObject({
      ok: false,
      reason: "renderer",
    })
    const failed = await copySelectionAsPng({
      selection: ["A"],
      renderer,
      write: async () => {
        throw new Error("denied")
      },
    })
    expect(failed).toMatchObject({ ok: false, reason: "failed" })
    expect(failed.ok ? "" : failed.message).toContain("denied")
  })
})
