/**
 * What a View link may do, enforced from the capabilities at every entry point: keys, tools and
 * the context menu.
 */
import { describe, expect, test } from "bun:test"
import { createDocStore, createUiStore } from "@kimo/editor-state"
import { canvasMenuModel } from "../../src/editor/context-menu"
import { guardViewerTool, VIEW_ONLY_SHORTCUTS, viewerKeyBlocked } from "../../src/editor/view-only"
import { SHORTCUT_LIST } from "../../src/shortcuts/shortcuts"

const key = (
  k: string,
  mods: { meta?: boolean; shift?: boolean; alt?: boolean; code?: string } = {},
) => ({
  key: k,
  code: mods.code ?? `Key${k.toUpperCase()}`,
  metaKey: mods.meta ?? false,
  ctrlKey: false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
})

describe("keyboard", () => {
  test("keys that write, duplicate or save a copy are dropped; select, inspect, copy and export stay", () => {
    const blocked: ReturnType<typeof key>[] = [
      key("d", { meta: true }), // Duplicate
      key("s", { meta: true }), // Save
      key("x", { meta: true }), // Cut
      key("v", { meta: true }), // Paste
      key("r"), // Rectangle tool
      key("Backspace", { code: "Backspace" }),
    ]
    for (const e of blocked) expect(viewerKeyBlocked(e)).toBe(true)
    const kept: ReturnType<typeof key>[] = [
      key("v"), // Move (Select)
      key("c", { meta: true }), // Copy
      key("e", { meta: true, shift: true }), // Export
      key("h"), // Hand
    ]
    for (const e of kept) expect(viewerKeyBlocked(e)).toBe(false)
  })

  test("every allow-listed id exists in the shortcuts table", () => {
    const ids = new Set(SHORTCUT_LIST.map((s) => s.id))
    for (const id of VIEW_ONLY_SHORTCUTS) expect(ids.has(id)).toBe(true)
  })
})

describe("tools", () => {
  test("any other tool snaps back to Select", () => {
    const ui = createUiStore()
    const off = guardViewerTool(ui)
    ui.getState().setTool("rect")
    expect(ui.getState().tool).toBe("select")
    ui.getState().setTool("hand")
    expect(ui.getState().tool).toBe("hand")
    off()
    ui.getState().setTool("rect")
    expect(ui.getState().tool).toBe("rect")
  })
})

describe("menus", () => {
  test("context menu: Copy only for a viewer", () => {
    const store = createDocStore()
    store.apply(
      {
        op: "insert",
        id: "Rect000001",
        node: { type: "rect", parent: null, order: "a0", x: 0, y: 0, w: 10, h: 10 },
      },
      { origin: "user" },
    )
    const input = {
      doc: store,
      selection: ["Rect000001"],
      live: new Set<string>(),
      agent: true,
      structure: {
        canPaste: true,
        canGroup: true,
        canUngroup: false,
        layout: null,
        canCreateComponent: true,
      },
    }
    const full = canvasMenuModel(input)
    const flat = (m: NonNullable<typeof full>) =>
      [m.agent, m.standard, ...m.structure, m.danger].flat().map((r) => r.id)
    expect(flat(full as NonNullable<typeof full>)).toContain("duplicate")
    const viewer = canvasMenuModel({ ...input, viewOnly: true })
    expect(flat(viewer as NonNullable<typeof viewer>)).toEqual(["copy"])
  })
})
