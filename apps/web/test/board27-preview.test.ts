/**
 * Board 27 §9 Preview (j52y5f, rules PTmL2): which frame opens, ‹ › navigation, preview-only
 * theme overrides (applied in the render source, never written), zoom presets / fit, keys, exit
 * selection, and the ⇧Space binding (no clash with Space-drag pan).
 */
import { describe, expect, test } from "bun:test"
import { createDocStore, type DocStore, type Op } from "@kimo/editor-state"
import { createInstanceView, createResolver } from "@kimo/layout"
import {
  centeredView,
  countLabel,
  exitSelection,
  FIT_MARGIN,
  fitZoom,
  frameName,
  initialThemes,
  isDark,
  lightDarkAxis,
  pickPreviewFrame,
  previewKey,
  selectAxes,
  stepFrame,
  themeAxes,
  toggleLightDark,
  topLevelFrames,
  zoomAbout,
  zoomLabel,
} from "../src/preview/model"
import { previewSource } from "../src/preview/render"
import { matches, shortcutLabel } from "../src/shortcuts/shortcuts"

function doc(): DocStore {
  const store = createDocStore()
  const ops: Op[] = [
    { op: "setThemes", set: { mode: ["light", "dark"], brand: ["Kimo", "Acme"] } },
    {
      op: "setVariables",
      set: {
        bg: {
          type: "color",
          value: [
            { value: "#FFFFFF", when: { mode: "light" } },
            { value: "#000000", when: { mode: "dark" } },
          ],
        },
      },
    },
    {
      op: "insert",
      id: "homepage",
      parent: null,
      node: { type: "frame", name: "Home", x: 0, y: 0, w: 400, h: 300 },
    },
    {
      op: "insert",
      id: "looserect",
      parent: null,
      node: { type: "rect", name: "Loose rect", x: 500, y: 0, w: 10, h: 10 },
    },
    {
      op: "insert",
      id: "pricing",
      parent: null,
      node: {
        type: "frame",
        name: "Pricing — Desktop",
        x: 600,
        y: 0,
        w: 1440,
        h: 960,
        theme: { brand: "Acme" },
      },
    },
    {
      op: "insert",
      id: "cardnode",
      parent: "pricing",
      node: { type: "rect", name: "Card", x: 10, y: 10, w: 10, h: 10 },
    },
    {
      op: "insert",
      id: "docspage",
      parent: null,
      node: { type: "frame", name: "Docs", x: 2200, y: 0, w: 400, h: 300 },
    },
  ]
  const res = store.apply(ops, { origin: "user" })
  if (!res.ok) throw new Error(JSON.stringify(res))
  return store
}

const ev = (o: Partial<KeyboardEvent>) => ({
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...o,
})

describe("rule What: the frame Preview opens", () => {
  test("top-level frames in layer order; loose shapes are skipped", () => {
    expect(topLevelFrames(doc())).toEqual(["homepage", "pricing", "docspage"])
  })
  test("selected top-level frame, else the frame holding the selection, else the first", () => {
    const s = doc()
    expect(pickPreviewFrame(s, ["docspage"])).toBe("docspage")
    expect(pickPreviewFrame(s, ["cardnode"])).toBe("pricing")
    expect(pickPreviewFrame(s, ["looserect"])).toBe("homepage")
    expect(pickPreviewFrame(s, [])).toBe("homepage")
  })
  test("no top-level frame → null (topbar button disabled)", () => {
    const s = createDocStore()
    expect(pickPreviewFrame(s, [])).toBeNull()
  })
  test("frame name for the tooltip / bar", () => {
    expect(frameName(doc(), "pricing")).toBe("Pricing — Desktop")
  })
})

describe("rule Navigate", () => {
  const frames = ["homepage", "pricing", "docspage"]
  test("‹ › step in layer order, clamped (pages are not crossed)", () => {
    expect(stepFrame(frames, "pricing", 1)).toBe("docspage")
    expect(stepFrame(frames, "docspage", 1)).toBe("docspage")
    expect(stepFrame(frames, "homepage", -1)).toBe("homepage")
  })
  test("count 'i / n'", () => {
    expect(countLabel(frames, "pricing")).toBe("2 / 3")
    expect(countLabel(["homepage", "pricing", "docspage", "d", "e"], "pricing")).toBe("2 / 5")
  })
})

describe("rule Theme: preview-only overrides", () => {
  test("axes, light/dark axis and the select axes", () => {
    const s = doc()
    const axes = themeAxes(s.toHeader().themes)
    expect(lightDarkAxis(axes)).toEqual({ axis: "mode", light: "light", dark: "dark" })
    expect(selectAxes(axes)).toEqual(["brand"])
  })
  test("initial = the frame's pinned themes; T toggles light/dark", () => {
    const s = doc()
    const axes = themeAxes(s.toHeader().themes)
    const t = initialThemes(s.toDocument(), "pricing")
    expect(t).toEqual({ mode: "light", brand: "Acme" })
    const d = toggleLightDark(axes, t)
    expect(d.mode).toBe("dark")
    expect(isDark(axes, d)).toBe(true)
    expect(toggleLightDark(axes, d).mode).toBe("light")
  })
  test("overrides apply in the render source only; the store never changes", () => {
    const s = doc()
    const before = JSON.stringify(s.toDocument())
    const src = previewSource(
      s,
      () => "pricing",
      () => ({ mode: "dark" }),
    )
    // One root: the previewed frame.
    expect(src.children(null)).toEqual(["pricing"])
    expect(src.children("pricing")).toEqual(["cardnode"])
    const node = src.getNode("pricing") as { theme?: Record<string, string> }
    expect(node.theme).toEqual({ brand: "Acme", mode: "dark" })
    // The resolver over the source sees the override (variables resolve dark).
    const header = s.toHeader()
    const view = createInstanceView(src, { header: () => header as never })
    const resolver = createResolver(header as never, view)
    expect(resolver.theme("cardnode").mode).toBe("dark")
    expect(resolver.theme("cardnode").brand).toBe("Acme")
    expect(JSON.stringify(s.toDocument())).toBe(before)
    expect((s.getNode("pricing") as { theme?: unknown }).theme).toEqual({ brand: "Acme" })
  })
})

describe("rule Zoom", () => {
  test("fit with a 24 px margin, centred", () => {
    const box = { x: 600, y: 0, w: 1440, h: 960 }
    const z = fitZoom(box, 868, 468)
    expect(z).toBeCloseTo(Math.min((868 - 48) / 1440, (468 - 48) / 960), 6)
    expect(FIT_MARGIN).toBe(24)
    const v = centeredView(box, 868, 468, z)
    // The frame's centre lands at the stage centre.
    expect((box.x + box.w / 2 - v.x) * z).toBeCloseTo(434, 6)
    expect((box.y + box.h / 2 - v.y) * z).toBeCloseTo(234, 6)
  })
  test("zoom about a point keeps it under the pointer", () => {
    const v = { x: 10, y: 20, zoom: 1 }
    const n = zoomAbout(v, 100, 50, 2)
    expect(v.x + 100 / v.zoom).toBeCloseTo(n.x + 100 / n.zoom, 6)
    expect(v.y + 50 / v.zoom).toBeCloseTo(n.y + 50 / n.zoom, 6)
  })
  test("pill label: 'Fit · 62 %' at fit, else the percent", () => {
    expect(zoomLabel("fit", 0.62)).toBe("Fit · 62 %")
    expect(zoomLabel(2, 2)).toBe("200 %")
    expect(zoomLabel(null, 0.333)).toBe("33 %")
  })
})

describe("keys + exit", () => {
  test("Esc / ⇧Space exit, ← → step, 0 fit, 1 100 %, T theme", () => {
    expect(previewKey(ev({ key: "Escape" }))).toEqual({ kind: "exit" })
    expect(previewKey(ev({ key: " ", code: "Space", shiftKey: true }))).toEqual({ kind: "exit" })
    expect(previewKey(ev({ key: "ArrowRight" }))).toEqual({ kind: "step", delta: 1 })
    expect(previewKey(ev({ key: "ArrowLeft" }))).toEqual({ kind: "step", delta: -1 })
    expect(previewKey(ev({ key: "0" }))).toEqual({ kind: "zoom", preset: "fit" })
    expect(previewKey(ev({ key: "1" }))).toEqual({ kind: "zoom", preset: 1 })
    expect(previewKey(ev({ key: "t" }))).toEqual({ kind: "toggleTheme" })
    expect(previewKey(ev({ key: "t", metaKey: true }))).toBeNull()
  })
  test("exit selection: unchanged without navigation, else the last frame", () => {
    expect(exitSelection(["othernode"], "pricing", false)).toEqual(["othernode"])
    expect(exitSelection(["othernode"], "docspage", true)).toEqual(["docspage"])
  })
  test("⇧Space is Preview (global); plain Space stays Pan; they never match the same event", () => {
    const shiftSpace = ev({ key: " ", code: "Space", shiftKey: true })
    const space = ev({ key: " ", code: "Space" })
    expect(matches("preview", shiftSpace)).toBe(true)
    expect(matches("pan", shiftSpace)).toBe(false)
    expect(matches("pan", space)).toBe(true)
    expect(matches("preview", space)).toBe(false)
    expect(shortcutLabel("preview", "mac")).toBe("⇧Space")
  })
})
