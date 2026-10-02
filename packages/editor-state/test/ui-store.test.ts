import { describe, expect, test } from "bun:test"
import { bindUiToDocument, createUiStore, MAX_ZOOM, MIN_ZOOM } from "../src/index"
import { emptyStore, ok, rect } from "./helpers"

describe("UI store", () => {
  test("selection actions", () => {
    const ui = createUiStore()
    const s = ui.getState()
    s.select(["a", "b", "a"])
    expect(ui.getState().selection).toEqual(["a", "b"])
    s.addToSelection(["b", "c"])
    expect(ui.getState().selection).toEqual(["a", "b", "c"])
    s.toggleSelection("b")
    expect(ui.getState().selection).toEqual(["a", "c"])
    s.clearSelection()
    expect(ui.getState().selection).toEqual([])
    s.setTool("frame")
    expect(ui.getState().tool).toBe("frame")
  })

  test("zoomAt keeps the point under the cursor fixed; zoom is clamped", () => {
    const ui = createUiStore({ viewport: { x: 100, y: 50, zoom: 1 } })
    const worldAt = (sx: number, sy: number) => {
      const v = ui.getState().viewport
      return [v.x + sx / v.zoom, v.y + sy / v.zoom]
    }
    const before = worldAt(300, 200)
    ui.getState().zoomAt(300, 200, 4)
    expect(worldAt(300, 200)).toEqual(before)
    ui.getState().zoomAt(0, 0, 1e9)
    expect(ui.getState().viewport.zoom).toBe(MAX_ZOOM)
    ui.getState().setViewport({ zoom: 0 })
    expect(ui.getState().viewport.zoom).toBe(MIN_ZOOM)
    ui.getState().setViewport({ zoom: 2, x: 0, y: 0 })
    ui.getState().panBy(20, 10)
    expect(ui.getState().viewport).toEqual({ x: -10, y: -5, zoom: 2 })
  })

  test("UI state is separate from the document and pruned on delete", () => {
    const doc = emptyStore()
    const ui = createUiStore()
    const off = bindUiToDocument(ui, doc)
    ok(doc.apply({ op: "insert", id: "Keep000001", node: rect("k") }, { origin: "user" }))
    ok(doc.apply({ op: "insert", id: "Drop000001", node: rect("d") }, { origin: "user" }))
    const rev = doc.revision
    ui.getState().select(["Keep000001", "Drop000001"])
    ui.getState().setHovered("Drop000001")
    expect(doc.revision).toEqual(rev) // selection never touches the document
    ok(doc.apply({ op: "delete", id: "Drop000001" }, { origin: "user" }))
    expect(ui.getState().selection).toEqual(["Keep000001"])
    expect(ui.getState().hovered).toBeNull()
    off()
  })
})
