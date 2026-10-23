/**
 * Board 41 section 9 (View only): what a View link may do, enforced from the capabilities at
 * every entry point: keys, tools, File menu and context menu.
 */
import { describe, expect, test } from "bun:test"
import { createDocStore, createUiStore } from "@kimo/editor-state"
import { canvasMenuModel } from "../src/editor/context-menu"
import type { FileMenuActions } from "../src/editor/FileMenu"
import {
  fileMenuFor,
  guardViewerTool,
  VIEW_ONLY_SHORTCUTS,
  viewerKeyBlocked,
  viewerToolAllowed,
} from "../src/editor/view-only"
import type { Capabilities } from "../src/multiplayer/model"
import { SHORTCUT_LIST } from "../src/shortcuts/shortcuts"

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

const VIEWER: Capabilities = {
  canEdit: false,
  canExport: true,
  canDuplicate: false,
  canShare: false,
  viewOnly: true,
}
const EDITOR: Capabilities = { ...VIEWER, canEdit: true, canDuplicate: true, viewOnly: false }

describe("keyboard", () => {
  test("keys that write, duplicate or save a copy are dropped", () => {
    const blocked: ReturnType<typeof key>[] = [
      key("d", { meta: true }), // Duplicate
      key("s", { meta: true }), // Save
      key("s", { meta: true, shift: true }), // Save as
      key("z", { meta: true }), // Undo
      key("Backspace", { code: "Backspace" }),
      key("g", { meta: true }), // Group
      key("x", { meta: true }), // Cut
      key("v", { meta: true }), // Paste
      key("r"), // Rectangle tool
      key("f"), // Frame tool
      key("t"), // Text tool
      key("p"), // Pen tool
      key("i"), // Image tool
      key("ArrowLeft", { code: "ArrowLeft" }), // Nudge
      key("k", { meta: true, alt: true }), // Create component
    ]
    for (const e of blocked) expect(viewerKeyBlocked(e)).toBe(true)
  })

  test("select, inspect, zoom, Preview, Export, Copy stay", () => {
    const kept: ReturnType<typeof key>[] = [
      key("v"), // Move (Select)
      key("c", { meta: true }), // Copy
      key("a", { meta: true }), // Select all
      key("e", { meta: true, shift: true }), // Export
      key("c", { meta: true, shift: true }), // Copy as PNG
      key("0", { meta: true, code: "Digit0" }), // Zoom 100
      key(" ", { shift: true, code: "Space" }), // Preview
      key("h"), // Hand
      key("q"), // no binding: never blocked
    ]
    for (const e of kept) expect(viewerKeyBlocked(e)).toBe(false)
  })

  test("every allow-listed id exists in the shortcuts table", () => {
    const ids = new Set(SHORTCUT_LIST.map((s) => s.id))
    for (const id of VIEW_ONLY_SHORTCUTS) expect(ids.has(id)).toBe(true)
  })
})

describe("tools", () => {
  test("only Select (and Hand, which only pans) are allowed", () => {
    expect(viewerToolAllowed("select")).toBe(true)
    expect(viewerToolAllowed("hand")).toBe(true)
    for (const t of ["frame", "rect", "ellipse", "text", "path", "image", "line"])
      expect(viewerToolAllowed(t)).toBe(false)
  })

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
  const actions: FileMenuActions = {
    onNewFile() {},
    onOpenFile() {},
    onOpenRecent() {},
    onSave() {},
    onSaveAs() {},
    onExportDialog() {},
    onCopyPng() {},
    onCleanUpAssets() {},
    onSettings() {},
  }

  test("File menu: Save and Save as are gone for a viewer, Export stays", () => {
    const v = fileMenuFor(actions, VIEWER)
    expect(v.onSave).toBeUndefined()
    expect(v.onSaveAs).toBeUndefined()
    expect(v.onExportDialog).toBeDefined()
    expect(v.onCopyPng).toBeDefined()
    expect(fileMenuFor(actions, EDITOR)).toBe(actions)
  })

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
