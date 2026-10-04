/**
 * Board 27 §4 (view menu & Settings › Canvas preferences) and §6 (a)–(c) (flip, clip, wrap
 * row gap preview, per-paint blend): pure logic behind the View menu, Canvas pane, Position /
 * Auto layout / Fill sections and the canvas gap preview.
 */
import { describe, expect, test } from "bun:test"
import { createDocStore, type Op } from "@kimo/editor-state"
import { isValidSetting, normalizeSettings, nudgeSteps, SETTINGS_DEFAULTS } from "@kimo/platform"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { flipOps } from "../src/canvas/commands"
import { gapMeasurements } from "../src/canvas/gap-preview"
import { toggleViewPref, viewPrefsOf } from "../src/canvas/view-prefs"
import { paintBlend, paintBlendable, withPaintBlend } from "../src/editor/style"
import { viewMeta } from "../src/editor/ViewMenu"
import { CHOICES, parseChoice, SETTINGS_PANES } from "../src/settings/model"
import { matches } from "../src/shortcuts/shortcuts"

const ev = (e: Partial<KeyboardEvent>) =>
  ({
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: "",
    code: "",
    ...e,
  }) as KeyboardEvent

describe("§4 canvas preferences (rules i6rbIi … Dos9n)", () => {
  test("defaults: snap to objects + snap to pixel grid + pixel grid on, rulers off, 1/10 nudge", () => {
    const p = viewPrefsOf(normalizeSettings({}))
    expect(p).toEqual({
      snapToObjects: true,
      snapToPixelGrid: true,
      pixelGrid: true,
      rulers: false,
      layerNames: true,
      nudge: { step: 1, big: 10 },
    })
    expect(SETTINGS_DEFAULTS["canvas.nudge"]).toBe("1/10")
  })

  test("validation: booleans and the three nudge presets only", () => {
    expect(isValidSetting("canvas.rulers", true)).toBe(true)
    expect(isValidSetting("canvas.rulers", "yes")).toBe(false)
    expect(isValidSetting("canvas.nudge", "0.5/5")).toBe(true)
    expect(isValidSetting("canvas.nudge", "2/20")).toBe(false)
    expect(nudgeSteps("8/16")).toEqual({ step: 8, big: 16 })
    expect(nudgeSteps("0.5/5")).toEqual({ step: 0.5, big: 5 })
  })

  test("View menu and Settings write the same key", async () => {
    const p = createMemoryPlatform()
    await p.settings.ready
    const seen: string[] = []
    p.settings.onChange((k) => seen.push(k))
    toggleViewPref(p.settings, "canvas.rulers")
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(p.settings.get("canvas.rulers")).toBe(true)
    expect(seen).toContain("canvas.rulers")
  })

  test("Settings › Canvas: pane right after General; Nudge select labels", () => {
    expect(SETTINGS_PANES.map((x) => x.id).slice(0, 2)).toEqual(["general", "canvas"])
    expect(CHOICES["canvas.nudge"].map((c) => c.label)).toContain("1 px · ⇧ 10 px")
    expect(parseChoice("canvas.nudge", "8/16")).toBe("8/16")
    expect(parseChoice("canvas.nudge", "3/30")).toBeNull()
  })

  test("shortcuts: ⇧' pixel grid, ⇧R rulers, ⇧H / ⇧V flip, ⌥ arrows resize", () => {
    expect(matches("view.pixelGrid", ev({ shiftKey: true, key: '"', code: "Quote" }))).toBe(true)
    expect(matches("view.rulers", ev({ shiftKey: true, key: "R" }))).toBe(true)
    expect(matches("view.rulers", ev({ key: "r" }))).toBe(false)
    expect(matches("flipHorizontal", ev({ shiftKey: true, key: "H" }))).toBe(true)
    expect(matches("flipVertical", ev({ shiftKey: true, key: "V" }))).toBe(true)
    expect(matches("nudgeResize", ev({ altKey: true, key: "ArrowRight" }))).toBe(true)
    expect(matches("nudge", ev({ altKey: true, key: "ArrowRight" }))).toBe(false)
  })

  test("menu meta: design glyphs on macOS / web, Ctrl+ / Shift+ elsewhere", () => {
    expect(viewMeta("macos", "⇧R")).toBe("⇧R")
    expect(viewMeta("windows", "⌘+")).toBe("Ctrl++")
    expect(viewMeta("linux", "⇧'")).toBe("Shift+'")
  })
})

describe("§6 (a) flip H / V (rule K0t6s)", () => {
  function store() {
    const s = createDocStore()
    const ops: Op[] = [
      {
        op: "insert",
        id: "rectA1",
        parent: null,
        node: { type: "rect", x: 0, y: 0, w: 10, h: 10 },
      },
      {
        op: "insert",
        id: "rectB1",
        parent: null,
        node: { type: "rect", x: 20, y: 0, w: 10, h: 10, flipX: true },
      },
      { op: "insert", id: "groupG", parent: null, node: { type: "group" } },
    ]
    expect(s.apply(ops, { origin: "user" }).ok).toBe(true)
    return s
  }

  test("any unflipped → all on; all flipped → unset (size stays positive)", () => {
    const s = store()
    expect(flipOps(s, ["rectA1", "rectB1"], "x")).toEqual([
      { op: "update", id: "rectA1", set: { flipX: true } },
      { op: "update", id: "rectB1", set: { flipX: true } },
    ])
    expect(flipOps(s, ["rectB1"], "x")).toEqual([{ op: "update", id: "rectB1", unset: ["flipX"] }])
    expect(flipOps(s, ["rectA1"], "y")).toEqual([
      { op: "update", id: "rectA1", set: { flipY: true } },
    ])
    expect(s.apply(flipOps(s, ["rectA1"], "x"), { origin: "user" }).ok).toBe(true)
    expect(s.getNode("rectA1")?.flipX).toBe(true)
    expect(s.getNode("rectA1")?.w).toBe(10)
  })

  test("groups are skipped", () => {
    expect(flipOps(store(), ["groupG"], "x")).toEqual([])
  })
})

describe("§6 (b) gap preview (lQ9JF mk4Ci)", () => {
  // Design: 2 × 2 wrapped items 48 × 46 at x 10 / 66, y 10 / 80 → gap 8, row gap 24.
  const boxes = [
    { x: 10, y: 10, w: 48, h: 46 },
    { x: 66, y: 10, w: 48, h: 46 },
    { x: 10, y: 80, w: 48, h: 46 },
    { x: 66, y: 80, w: 48, h: 46 },
  ]
  test("main gap: a horizontal mark between neighbours of each line", () => {
    expect(gapMeasurements(boxes, "row", "main")).toEqual([
      { axis: "x", at: 33, from: 58, to: 66, label: "8" },
      { axis: "x", at: 103, from: 58, to: 66, label: "8" },
    ])
  })
  test("row gap: a vertical mark at the upper line's first item centre (Row gap mark x 34)", () => {
    expect(gapMeasurements(boxes, "row", "cross")).toEqual([
      { axis: "y", at: 34, from: 56, to: 80, label: "24" },
    ])
  })
  test("column layouts swap the axes; touching items draw nothing", () => {
    const col = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 0, y: 14, w: 10, h: 10 },
    ]
    expect(gapMeasurements(col, "column", "main")).toEqual([
      { axis: "y", at: 5, from: 10, to: 14, label: "4" },
    ])
    expect(
      gapMeasurements(
        [
          { x: 0, y: 0, w: 10, h: 10 },
          { x: 10, y: 0, w: 10, h: 10 },
        ],
        "row",
        "main",
      ),
    ).toEqual([])
  })
})

describe("§6 (c) per-paint blend (rule K7NZ9)", () => {
  test("bare colors wrap to solid; normal unsets and collapses", () => {
    const on = withPaintBlend("#F4F1EC", "multiply")
    expect(on).toEqual({ kind: "solid", color: "#F4F1EC", blend: "multiply" })
    expect(paintBlend(on)).toBe("multiply")
    expect(withPaintBlend(on, "normal")).toBe("#F4F1EC")
    expect(paintBlend("#000000")).toBe("normal")
  })
  test("image / gradient keep their fields; mesh / shader can't blend", () => {
    const img = { kind: "image", src: "./assets/0123456789abcdef.png", opacity: 0.6 }
    expect(withPaintBlend(img, "screen")).toEqual({ ...img, blend: "screen" })
    expect(withPaintBlend({ ...img, blend: "screen" }, "normal")).toEqual(img)
    expect(paintBlendable(img)).toBe(true)
    expect(paintBlendable({ kind: "mesh", cols: 1, rows: 1, colors: [], points: [] })).toBe(false)
  })
})
