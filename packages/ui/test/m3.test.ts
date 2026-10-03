import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { type TokenEntry, tokens as typedTokens } from "@kimo/design-tokens"
import { createElement as h, type ReactElement } from "react"
import { renderToString } from "react-dom/server"
import { MAP_M3 } from "../scripts/measure-map-m3"
import { GalleryM3 } from "../src/gallery/GalleryM3"
import {
  AliasChip,
  AssetRow,
  AssetTile,
  AxisGroupHeader,
  axisIcon,
  ConfirmDialog,
  EntryRow,
  InstancePropRow,
  InstanceSwapField,
  LayerRowM3,
  LibraryManager,
  LibraryRow,
  ModeColumnHeader,
  moveItem,
  OverrideDot,
  PropDefRow,
  PropOptions,
  SlotBadge,
  SlotQuickInsert,
  StatusPill,
  SwapPopover,
  ThemePinRow,
  Toast,
  TYPE_GLYPH_ICONS,
  TypeGlyph,
  VarCell,
  VariableEntries,
  VariableListRow,
  VariableRow,
  VariablesDialog,
  WhenChip,
} from "../src/index"

const html = (el: ReactElement) => renderToString(el)
const tokens: Record<string, TokenEntry> = typedTokens
const src = (p: string) => Bun.file(join(import.meta.dir, "..", "src", p)).text()
const noop = () => {}
/** createElement with positional children for components whose props require `children`. */
const hc = h as unknown as (type: unknown, props: object, ...children: unknown[]) => ReactElement

describe("component tokens (violet = component identity only)", () => {
  test("component / component-soft match desing.pen", () => {
    expect(tokens.component?.value).toEqual({ light: "#7C3AED", dark: "#A78BFA" })
    expect(tokens["component-soft"]?.value).toEqual({ light: "#7C3AED14", dark: "#A78BFA24" })
  })

  test("M3 CSS uses only --kimo-* custom properties and Pencil text boxes", async () => {
    const files = [
      "override-dot/OverrideDot.css",
      "layer-row-m3/LayerRowM3.css",
      "slot-badge/SlotBadge.css",
      "asset-tile/AssetTile.css",
      "asset-row/AssetRow.css",
      "prop-def-row/PropDefRow.css",
      "instance-prop-row/InstancePropRow.css",
      "var-cell/VarCell.css",
      "entry-row/EntryRow.css",
      "variable-row/VariableRow.css",
      "library-row/LibraryRow.css",
      "variables-dialog/VariablesDialog.css",
    ]
    for (const f of files) {
      const css = await src(f)
      for (const m of css.matchAll(/var\(--([a-z0-9-]+)\)/g)) expect(m[1]).toStartWith("kimo-")
      expect(css).not.toContain("line-height: normal")
    }
  })
})

describe("identity", () => {
  test("OverrideDot hidden keeps its slot; interactive dot is a labelled button", () => {
    expect(html(h(OverrideDot, { visible: false }))).toContain("kimo-override-dot--off")
    const out = html(h(OverrideDot, { onReset: noop, resetValue: "Get started" }))
    expect(out).toContain('role="button"')
    expect(out).toContain("Click to reset to main · “Get started”")
  })

  test("LayerRowM3 variants: icons, weights, slot tag, origin, dot", () => {
    const comp = html(h(LayerRowM3, { kind: "component", name: "Card" }))
    expect(comp).toContain("lucide-component")
    expect(comp).toContain("kimo-layer-row-m3__name--emphasized")
    const inst = html(h(LayerRowM3, { kind: "instance", name: "Card" }))
    expect(inst).toContain("lucide-diamond")
    expect(inst).not.toContain("--emphasized")
    expect(html(h(LayerRowM3, { kind: "instance", name: "Card", selected: true }))).toContain(
      "--emphasized",
    )
    const slot = html(h(LayerRowM3, { kind: "slot", name: "Actions" }))
    expect(slot).toContain(">slot<")
    expect(slot).not.toContain("kimo-override-dot")
    const replaced = html(h(LayerRowM3, { kind: "replaced", name: "Price" }))
    expect(replaced).toContain(">replaced<")
    expect(replaced).toContain("kimo-override-dot")
    const derived = html(h(LayerRowM3, { kind: "derived", name: "B", from: "Button/Primary" }))
    expect(derived).toContain("from Button/Primary")
    expect(derived).not.toContain("kimo-layer-row-m3__spacer")
    expect(html(h(LayerRowM3, { kind: "component", name: "Card", depth: 2 }))).toContain(
      "padding-left:36px",
    )
  })

  test("SlotBadge / SlotQuickInsert", () => {
    expect(html(h(SlotBadge, { name: "Actions" }))).toContain("Slot · Actions")
    const more = html(h(SlotQuickInsert, { label: "+1", more: true }))
    expect(more).toContain("kimo-slot-quick-insert--more")
    expect(more).not.toContain("lucide-plus")
  })
})

describe("assets & props", () => {
  test("AssetTile is a draggable button-like tile; image thumbnails render <img>", () => {
    const out = html(
      h(AssetTile, { name: "Button/Primary", thumbnail: "blob:x", onDragStart: noop }),
    )
    expect(out).toContain('draggable="true"')
    expect(out).toContain('src="blob:x"')
    expect(html(h(AssetTile, { name: "A", dragging: true }))).toContain("kimo-asset-tile--dragging")
  })

  test("AssetRow selected swaps the meta for a check", () => {
    expect(html(h(AssetRow, { name: "Card", meta: "3×" }))).toContain("3×")
    const sel = html(h(AssetRow, { name: "Card", meta: "3×", selected: true }))
    expect(sel).toContain("lucide-check")
    expect(sel).not.toContain("3×")
  })

  test("TypeGlyph icons follow 02c etSt8", () => {
    expect(Object.keys(TYPE_GLYPH_ICONS).sort()).toEqual(
      ["boolean", "color", "enum", "instance", "number", "slot", "string", "text"].sort(),
    )
    expect(html(h(TypeGlyph, { type: "slot" }))).toContain("lucide-square-dashed")
    expect(html(h(TypeGlyph, { type: "boolean" }))).toContain("lucide-toggle-left")
  })

  test("PropDefRow: default field optional; inherited rows lock", () => {
    const own = html(
      h(PropDefRow, { name: "label", type: "text", target: "Label · content", defaultValue: "Go" }),
    )
    expect(own).toContain("kimo-prop-def-row__default")
    expect(own).toContain("lucide-minus")
    const slot = html(h(PropDefRow, { name: "actions", type: "slot", target: "Actions" }))
    expect(slot).not.toContain("kimo-prop-def-row__default")
    const inh = html(h(PropDefRow, { name: "x", type: "text", target: "t", state: "inherited" }))
    expect(inh).toContain("kimo-prop-def-row--inherited")
    expect(inh).toContain("lucide-lock")
    expect(
      html(h(PropDefRow, { name: "x", type: "text", target: "t", state: "redeclared" })),
    ).toContain("lucide-rotate-ccw")
    const opts = html(h(PropOptions, { field: "pad", options: [{ name: "sm", value: "8 16" }] }))
    expect(opts).toContain("Options → pad")
    expect(opts).toContain("8 16")
  })

  test("InstancePropRow per type", () => {
    const row = (type: "text" | "boolean" | "enum" | "instance" | "slot", extra = {}) =>
      html(h(InstancePropRow, { prop: { name: "p", type }, overridden: false, ...extra }))
    expect(row("text", { value: "Hi" })).toContain('value="Hi"')
    expect(row("boolean", { value: true })).toContain('aria-checked="true"')
    expect(row("enum", { value: "md", options: ["sm", "md"] })).toContain("md")
    expect(row("instance", { value: "Icon/Arrow" })).toContain("kimo-instance-swap-field")
    expect(row("slot", { slotCount: 2 })).toContain("2 children")
    expect(row("text")).toContain("kimo-override-dot--off")
    expect(
      html(h(InstancePropRow, { prop: { name: "p", type: "text" }, overridden: true, value: "x" })),
    ).toContain("kimo-instance-prop-row--overridden")
    expect(html(h(InstanceSwapField, { value: "Icon/Arrow" }))).toContain('aria-haspopup="dialog"')
  })
})

describe("variables & themes", () => {
  test("VarCell kinds", () => {
    expect(
      html(h(VarCell, { value: { kind: "color", color: "#fff", label: "FFFFFF" } })),
    ).toContain("kimo-swatch-tile")
    expect(html(h(VarCell, { value: { kind: "alias", name: "ink-900" } }))).toContain(
      "kimo-alias-chip",
    )
    expect(html(h(VarCell, { value: { kind: "empty" } }))).toContain("—")
    expect(html(h(VarCell, { value: { kind: "number", label: "12" }, multi: true }))).toContain(
      "kimo-var-cell__multi",
    )
    expect(html(h(VarCell, { value: { kind: "string", label: "x" }, multi: true }))).not.toContain(
      "kimo-var-cell__multi",
    )
  })

  test("chips and rows", () => {
    expect(html(h(AliasChip, { name: "ink-900" }))).toContain("lucide-link-2")
    expect(html(h(WhenChip, { axis: "mode", value: "dark" }))).toContain(">dark<")
    expect(html(h(EntryRow, { index: 1, when: null, value: "v" }))).toContain("fallback · no when")
    const row = html(h(VariableRow, { name: "a", type: "color", values: null, lint: "no match" }))
    expect(row).toContain("kimo-variable-row__lint")
    expect(row).not.toContain("kimo-variable-row__disclosure")
    expect(
      html(h(VariableRow, { name: "a", type: "color", values: null, expanded: true })),
    ).toContain("kimo-variable-row__disclosure")
    expect(html(h(ModeColumnHeader, { value: "light", isDefault: true }))).toContain(">default<")
    expect(html(h(AxisGroupHeader, { axis: "mode", count: 2 }))).toContain("width:300px")
    expect(html(h(VariableListRow, { name: "n", type: "number", value: "12" }))).toContain(
      "lucide-hash",
    )
  })

  test("ThemePinRow inherit vs pinned; axis icons", () => {
    const inherit = html(
      h(ThemePinRow, { axis: "mode", values: ["light", "dark"], pinned: null, inherited: "light" }),
    )
    expect(inherit).toContain("Inherit · light")
    expect(inherit).toContain("kimo-select__value--placeholder")
    const pinned = html(h(ThemePinRow, { axis: "mode", values: ["light", "dark"], pinned: "dark" }))
    expect(pinned).toContain("kimo-theme-pin-row--pinned")
    expect(html(axisIcon("mode") as ReactElement)).toContain("lucide-sun-moon")
    expect(html(axisIcon("density") as ReactElement)).toContain("lucide-rows-3")
    expect(html(axisIcon("ui:mode") as ReactElement)).toContain("lucide-library")
  })

  test("VariableEntries header, grips and moveItem", () => {
    const out = html(
      h(VariableEntries, {
        entries: [
          { key: "a", when: null, value: "x" },
          { key: "b", when: { density: "compact" }, value: "y" },
        ],
        onReorder: noop,
      }),
    )
    expect(out).toContain("2 · in list order · last matching entry wins")
    expect(out).toContain('aria-roledescription="sortable"')
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"])
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"])
  })

  test("VariablesDialog renders axes as column headers", () => {
    const out = html(
      hc(
        VariablesDialog,
        {
          description: "d",
          onClose: noop,
          sidebar: null,
          query: "",
          onQueryChange: noop,
          typeFilter: "all",
          onTypeFilterChange: noop,
          onNewVariable: noop,
          axes: [{ axis: "mode", values: ["light", "dark"] }],
        },
        null,
      ),
    )
    expect(out).toContain('role="dialog"')
    expect(out).toContain('role="radiogroup"')
    expect(out.match(/kimo-mode-column-header"/g)?.length).toBe(2)
    expect(out).toContain(">default<")
  })
})

describe("libraries & feedback", () => {
  test("StatusPill / LibraryRow status classes", () => {
    expect(html(h(StatusPill, { status: "missing" }))).toContain(">Missing<")
    expect(html(h(StatusPill, { status: "linked", compact: true }))).toContain("--compact")
    const row = html(
      h(LibraryRow, {
        name: "Icons",
        alias: "icons",
        path: "../i.kimo",
        count: "c",
        status: "missing",
        actionLabel: "Locate…",
      }),
    )
    expect(row).toContain("kimo-library-row--missing")
    expect(row).toContain(">icons:<")
    expect(row).toContain("Locate…")
  })

  test("Toast tones", () => {
    const danger = html(h(Toast, { tone: "danger" }, "No"))
    expect(danger).toContain('role="alert"')
    expect(danger).toContain("lucide-circle-x")
    expect(html(h(Toast, { tone: "warning" }, "Hm"))).toContain("lucide-triangle-alert")
    expect(html(h(Toast, {}, "Ok"))).not.toContain("kimo-toast--")
  })

  test("ConfirmDialog tones and optional checkbox", () => {
    const base = {
      icon: "i",
      title: "T",
      description: "D",
      confirmLabel: "Go",
      onConfirm: noop,
      onCancel: noop,
    }
    const comp = html(h(ConfirmDialog, { ...base, tone: "component", dontAskAgain: true }))
    expect(comp).toContain('role="alertdialog"')
    expect(comp).toContain("Don&#x27;t ask again")
    const danger = html(h(ConfirmDialog, { ...base, tone: "danger" }))
    expect(danger).toContain("kimo-confirm-dialog--danger")
    expect(danger).not.toContain("checkbox")
  })

  test("SwapPopover / LibraryManager", () => {
    const swap = html(
      h(SwapPopover, {
        groups: [{ title: "This file", meta: "Card", items: [{ id: "a", name: "Card/A" }] }],
        selected: "a",
        onSelect: noop,
      }),
    )
    expect(swap).toContain("Swap instance")
    expect(swap).toContain('aria-selected="true"')
    const lm = html(hc(LibraryManager, { onLink: noop }, null))
    expect(lm).toContain("Link library…")
  })
})

describe("gallery", () => {
  test("GalleryM3 renders every mapped design root", () => {
    const out = html(h(GalleryM3))
    const pen = new Set([...out.matchAll(/data-pen="([^"]+)"/g)].map((m) => m[1]))
    for (const id of Object.keys(MAP_M3)) expect(pen.has(id)).toBe(true)
  })
})
