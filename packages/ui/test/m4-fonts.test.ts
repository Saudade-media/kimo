/** 02d FontRow (WVvHj + variants) and SettingRow (MuoTX): structure, copy, CSS node values. */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { GalleryM4Fonts } from "../src/gallery/GalleryM4Fonts"
import { FontRow, fontRowMeta, SettingRow, Toggle } from "../src/index"

const css = (p: string) => Bun.file(join(import.meta.dir, "..", "src", p)).text()

describe("FontRow", () => {
  test("variants: status pill tone + label, specimen family, source badge", () => {
    const row = (status: "installed" | "cached" | "not-cached" | "missing", family = "Fraunces") =>
      renderToString(
        h(FontRow, { family, meta: fontRowMeta([600, 700], 18), source: "Google", status }),
      )
    expect(row("installed")).toContain("kimo-status-pill--linked")
    expect(row("installed")).toContain(">Installed<")
    expect(row("cached")).toContain(">Cached<")
    expect(row("not-cached")).toContain("kimo-status-pill--changed")
    expect(row("not-cached")).toContain(">Not cached<")
    expect(row("missing")).toContain("kimo-status-pill--missing")
    // Renders in its own face when available; Inter + muted when not.
    expect(row("cached")).toContain("font-family:&quot;Fraunces&quot;")
    expect(row("missing")).toContain("font-family:&quot;Inter&quot;")
    expect(row("missing")).toContain("kimo-font-row__aa--muted")
    expect(row("cached")).toContain('class="kimo-badge kimo-font-row__source"')
    expect(fontRowMeta([600, 700], 18)).toBe("600 · 700  ·  used by 18 layers")
    expect(fontRowMeta([500], 1)).toBe("500  ·  used by 1 layer")
  })

  test("specimen family is sanitized", () => {
    const html = renderToString(
      h(FontRow, {
        family: 'X"; background:url(evil)',
        meta: "",
        source: "Document",
        status: "installed",
      }),
    )
    expect(html).not.toContain('X";')
  })

  test("CSS carries the node values", async () => {
    const s = await css("font-row/FontRow.css")
    for (const v of [
      "gap: 12px",
      "padding: 10px 12px",
      "width: 32px",
      "height: 32px",
      "font-size: 14px",
      "gap: 2px",
    ])
      expect(s).toContain(v)
    expect(s).toContain("inset 0 -1px 0 0 var(--kimo-border)")
  })
})

describe("SettingRow", () => {
  test("label/desc ids reach the control; last and dimmed variants", () => {
    const html = renderToString(
      h(SettingRow, {
        label: "Autosave",
        description: "Write to disk after you stop editing.",
        last: true,
        dimmed: true,
        control: (ids) => h(Toggle, { checked: true, "aria-labelledby": ids.labelId }),
      }),
    )
    const id = /id="([^"]+)-label"/.exec(html)?.[1]
    expect(id).toBeTruthy()
    expect(html).toContain(`aria-labelledby="${id}-label"`)
    expect(html).toContain("kimo-setting-row--last")
    expect(html).toContain("kimo-setting-row--dimmed")
  })

  test("CSS carries the node values", async () => {
    const s = await css("setting-row/SettingRow.css")
    for (const v of [
      "gap: 16px",
      "padding: 12px 0",
      "line-height: 1.45",
      "opacity: 0.45",
      "justify-content: flex-end",
    ])
      expect(s).toContain(v)
  })
})

test("gallery board renders both 02d sections", () => {
  const html = renderToString(h(GalleryM4Fonts, {}))
  expect(html).toContain('data-pen="o5RdO"')
  expect(html).toContain('data-pen="oNc2R"')
  expect(html).toContain("Söhne")
  expect(html).toContain("Replace with…")
  expect(html).toContain("Autosave interval")
})
