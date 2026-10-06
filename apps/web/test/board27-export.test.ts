/**
 * Board 27 §10 (c) f6LWt / (d) W3CpXw: the Export dialog's Issues tab (grouping, levels, node
 * paths, report), the Tailwind theme option through generation, Copy selection as PNG and the
 * File-menu / shortcut rows.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "@kimo/core-schema"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { menuShortcut } from "../src/editor/FileMenu"
import { COPY_PNG_SCALE, copySelectionAsPng } from "../src/export/copy-png"
import { ExportDialog } from "../src/export/ExportDialog"
import { type ExportSource, generateExport } from "../src/export/generate"
import {
  EXPORT_GROUP,
  groupIssues,
  hasIssueError,
  issueLevel,
  issuesLabel,
  issuesReport,
  issueTotal,
  nodePath,
} from "../src/export/issues"
import { DEFAULT_TAILWIND, DEFAULT_TOGGLES, TAILWIND_THEMES } from "../src/export/model"
import { formatCombo, matches, SHORTCUT_LIST, shortcut } from "../src/shortcuts/shortcuts"

const fixture = (name: string) =>
  parse(
    readFileSync(
      join(import.meta.dir, `../../../packages/core-schema/fixtures/valid/${name}.kimo`),
      "utf8",
    ),
  )
const sourceOf = (name: string): ExportSource => {
  const doc = fixture(name)
  return { fileName: name, document: () => doc, selection: () => [] }
}

describe("Issues tab model (rule AiMJh)", () => {
  test("levels: unresolved things are errors, approximations warnings", () => {
    expect(issueLevel("VARIABLE_UNRESOLVED")).toBe("error")
    expect(issueLevel("INSTANCE_UNRESOLVED")).toBe("error")
    expect(issueLevel("EFFECT_APPROXIMATED")).toBe("warning")
    expect(issueLevel("FONT_MISSING")).toBe("warning")
  })

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
    expect(groups[1]?.issues[0]?.path).toBe("Hero")
    expect(groups[2]?.issues[0]).toEqual({
      level: "error",
      message: "missing: space/legacy",
      nodeId: null,
      path: "—",
    })
    expect(issueTotal(groups)).toBe(5)
    expect(hasIssueError(groups)).toBe(true)
    expect(hasIssueError(groups.slice(0, 2))).toBe(false)
  })

  test("labels, node path and the plain-text report", () => {
    expect(issuesLabel(1)).toBe("1 issue")
    expect(issuesLabel(2)).toBe("2 issues")
    expect(nodePath(null)).toBe("—")
    expect(nodePath(["A", "B", "C"])).toBe("B › C")
    const report = issuesReport(
      groupIssues([{ code: "ICON_MISSING", message: "icon x", nodeId: "i", file: "A.tsx" }], {
        names: () => ["Nav", "Icon"],
      }),
    )
    expect(report).toBe(
      "Kimo export issues: 1 issue (1 error)\n\nA.tsx: 1 issue\n  error    icon x  [Nav › Icon]\n",
    )
  })

  test("generation attributes real exporter issues to emitted files", async () => {
    const g = await generateExport(sourceOf("features-all"), "react", DEFAULT_TOGGLES)
    const paths = new Set(g.files.map((f) => f.path))
    expect(g.issues.length).toBeGreaterThan(0)
    for (const grp of g.issues) expect(paths.has(grp.file) || grp.file === EXPORT_GROUP).toBe(true)
    const mesh = g.issues.flatMap((x) => x.issues).find((i) => i.message.includes("mesh"))
    expect(mesh?.level).toBe("warning")
    expect(mesh?.nodeId).toBeTruthy()
    expect(mesh?.path).not.toBe("—")
    // PDF (no text target): the IR's issues still show, under export.pdf.
    const pdf = await generateExport(sourceOf("features-all"), "pdf", DEFAULT_TOGGLES)
    expect(pdf.issues.map((x) => x.file)).toEqual(["export.pdf"])
    // …including what PDF does with mesh and shader paints (spec §7.1).
    const messages = (g: typeof pdf) => g.issues.flatMap((x) => x.issues).map((i) => i.message)
    expect(messages(pdf).some((m) => m.includes("PDF mesh gradients"))).toBe(true)
    expect(messages(pdf).some((m) => m.includes("shader"))).toBe(true)
  })
})

describe("Tailwind theme option (rule jmMl8)", () => {
  test("options and defaults", () => {
    expect(TAILWIND_THEMES.map((t) => t.value)).toEqual(["v4", "v3", "none"])
    expect(TAILWIND_THEMES.map((t) => t.label)).toEqual([
      "@theme in tokens.css (v4)",
      "tailwind.config.ts (v3)",
      "Don't emit",
    ])
    expect(DEFAULT_TAILWIND).toEqual({ theme: "v4", mapTokens: true })
  })

  test("v4 / v3 / none / map off reach the React exporter", async () => {
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

describe("dialog render (f6LWt)", () => {
  test("Preview | Issues tabs and the Tailwind group under React + Tailwind", () => {
    const html = renderToString(
      h(ExportDialog, {
        platform: createMemoryPlatform({ os: "macos" }),
        source: sourceOf("components-m3"),
        preset: { format: "react" },
        onClose: () => {},
      }),
    )
    expect(html).toContain('data-pane-tab="preview"')
    expect(html).toContain('data-pane-tab="issues"')
    expect(html).toContain("Tailwind theme")
    expect(html).toContain("Map variables to theme tokens")
    expect(html).toContain("@theme in tokens.css (v4)")
  })
})

describe("Copy selection as PNG (rule VVlIk)", () => {
  test("first selected layer at 2× onto the clipboard", async () => {
    const calls: [string, number | undefined][] = []
    const blobs: Blob[] = []
    const r = await copySelectionAsPng({
      selection: ["A", "B"],
      renderer: {
        exportRaster: async (id, o) => {
          calls.push([id, o?.scale])
          return new Uint8Array([0x89, 0x50, 0x4e, 0x47])
        },
      },
      write: async (b) => {
        blobs.push(b)
      },
    })
    expect(r).toEqual({ ok: true, nodeId: "A" })
    expect(calls).toEqual([["A", COPY_PNG_SCALE]])
    expect(COPY_PNG_SCALE).toBe(2)
    expect(blobs[0]?.type).toBe("image/png")
    expect(blobs[0]?.size).toBe(4)
  })

  test("empty selection, no renderer and failures are reported, never thrown", async () => {
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

describe("File › Export… ⇧⌘E · Copy selection as PNG ⇧⌘C (W3CpXw)", () => {
  test("menu meta and the shortcuts table agree", () => {
    expect(menuShortcut("macos", "E", true)).toBe("⇧⌘E")
    expect(menuShortcut("macos", "C", true)).toBe("⇧⌘C")
    expect(menuShortcut("windows", "E", true)).toBe("Shift+Ctrl+E")
    expect(formatCombo(shortcut("exportDialog").combos[0] as never, "mac")).toBe("⇧⌘E")
    expect(formatCombo(shortcut("copyAsPng").combos[0] as never, "mac")).toBe("⇧⌘C")
    const file = SHORTCUT_LIST.filter((s) => s.group === "file").map((s) => s.id)
    expect(file.indexOf("exportDialog")).toBe(file.indexOf("saveAs") + 1)
    expect(file.indexOf("copyAsPng")).toBe(file.indexOf("exportDialog") + 1)
  })

  test("⇧⌘C / ⇧⌘E match, plain ⌘C / ⌘E do not", () => {
    const ev = (key: string, shift: boolean) => ({
      key,
      code: `Key${key.toUpperCase()}`,
      metaKey: true,
      ctrlKey: false,
      shiftKey: shift,
      altKey: false,
    })
    expect(matches("copyAsPng", ev("C", true))).toBe(true)
    expect(matches("copyAsPng", ev("c", false))).toBe(false)
    expect(matches("exportDialog", ev("E", true))).toBe(true)
    expect(matches("exportDialog", ev("e", false))).toBe(false)
  })
})
