import { describe, expect, test } from "bun:test"
import { createElement as h, type ReactElement } from "react"
import { renderToString } from "react-dom/server"
import { Gallery } from "../src/gallery/Gallery"
import {
  AgentStep,
  Avatar,
  Badge,
  ColorField,
  Composer,
  EmptyState,
  FileCard,
  IconButton,
  Input,
  initialsOf,
  Kbd,
  LayerRow,
  Menu,
  MenuItem,
  Message,
  PanelHeader,
  PropField,
  PropRow,
  PropSection,
  Segmented,
  Select,
  Tab,
  Tabs,
  Toast,
  Toggle,
  ToolButton,
  Tooltip,
  TooltipContent,
} from "../src/index"

const icon = h("svg", { viewBox: "0 0 24 24", "data-icon": "" })
const html = (el: ReactElement) => renderToString(el)
const noop = () => {}

describe("snapshots", () => {
  const cases: [string, ReactElement][] = [
    ["ToolButton", h(ToolButton, { label: "Rectangle", icon })],
    ["ToolButton/Active", h(ToolButton, { label: "Move", icon, active: true })],
    ["IconButton sm", h(IconButton, { label: "Add", icon, size: "sm" })],
    ["Input", h(Input, { icon, placeholder: "Search layers", "aria-label": "Search" })],
    ["PropField", h(PropField, { prefix: "W", value: 1440, onChange: noop })],
    ["PropField keyword", h(PropField, { prefix: "H", value: "Hug", inputLabel: "Height" })],
    ["ColorField", h(ColorField, { color: "#0A0A0A", value: "accent", opacity: "100%" })],
    [
      "Select",
      h(Select, {
        label: "Font",
        options: [
          { value: "Inter", label: "Inter" },
          { value: "Geist", label: "Geist" },
        ],
        value: "Inter",
      }),
    ],
    [
      "Segmented",
      h(Segmented, {
        label: "Align",
        options: [
          { value: "l", label: "Left", icon },
          { value: "c", label: "Center", icon },
        ],
        value: "l",
      }),
    ],
    ["Toggle/On", h(Toggle, { label: "Clip", checked: true })],
    ["Toggle/Off", h(Toggle, { label: "Clip", checked: false })],
    ["Badge", h(Badge, null, "Component")],
    ["Kbd", h(Kbd, null, "⌘K")],
    ["Avatar", h(Avatar, { name: "Gui Saudade" })],
    ["PanelHeader", h(PanelHeader, { title: "Layers", action: { label: "Add", icon } })],
    ["LayerRow", h(LayerRow, { name: "Navbar", icon, expanded: true })],
    [
      "LayerRow/Selected",
      h(LayerRow, { name: "Hero", icon, expanded: false, selected: true, depth: 1 }),
    ],
    [
      "LayerRow leaf hidden locked",
      h(LayerRow, {
        name: "Headline",
        icon,
        depth: 2,
        visible: false,
        locked: true,
        onToggleLocked: noop,
      }),
    ],
    ["Tab", h(Tab, null, "Design")],
    ["Tab/Active", h(Tab, { active: true }, "Design")],
    [
      "Tabs",
      h(Tabs, {
        label: "Panel",
        items: [
          { value: "a", label: "Design" },
          { value: "b", label: "Code" },
        ],
        value: "a",
      }),
    ],
    [
      "PropSection",
      h(
        PropSection,
        { title: "Layout", action: { label: "Add layout", icon } },
        h(PropRow, null, h(PropField, { prefix: "W", value: 1 })),
      ),
    ],
    ["TooltipContent", h(TooltipContent, { shortcut: "F" }, "Frame")],
    [
      "Tooltip (closed)",
      // biome-ignore lint/correctness/noChildrenProp: createElement with a required children prop.
      h(Tooltip, { label: "Frame", shortcut: "F", children: h("button", { type: "button" }, "x") }),
    ],
    [
      "Menu",
      h(
        Menu,
        { label: "Actions" },
        h(MenuItem, { icon, shortcut: "⌘D" }, "Duplicate"),
        h(MenuItem, { icon, shortcut: "⌘G", highlighted: true }, "Group selection"),
        h(MenuItem, { icon, disabled: true }, "Disabled"),
      ),
    ],
    ["Toast", h(Toast, { actionLabel: "Undo" }, "Exported 3 files")],
    ["EmptyState", h(EmptyState, { icon, title: "No layers yet", description: "Press F." })],
    ["FileCard", h(FileCard, { name: "Marketing site", info: "Edited 2 hours ago" })],
    ["Message/User", h(Message, { from: "user" }, "Make the hero warmer")],
    ["Message/Agent", h(Message, { from: "agent" }, "Sure.")],
    ["AgentStep", h(AgentStep, { status: "done" }, "Updated 4 color variables")],
    ["AgentStep/Running", h(AgentStep, { status: "running" }, "Inserting…")],
    ["Composer", h(Composer, { context: { label: "Hero", icon }, model: "Claude Sonnet 5.5" })],
  ]
  for (const [name, el] of cases) test(name, () => expect(html(el)).toMatchSnapshot())

  test("Gallery renders every board component", () => {
    const out = html(h(Gallery))
    const pen = [...out.matchAll(/data-pen="([^"]+)"/g)].map((m) => m[1])
    for (const id of [
      "W2lra",
      "kv3Fk",
      "sqJv4",
      "vyI3D",
      "ZMxjt",
      "l44gB",
      "N0cHp",
      "l6HCd",
      "Zs05d",
      "A9DDs",
      "GOaBx",
      "gP276",
      "hx0Wg",
      "y893S",
      "CSYQj",
      "jrIWa",
      "Eo5JW",
      "FVhW0",
      "LWjoa",
      "GXnBT",
      "dArBD",
      "GfneW",
      "P3e7Mp",
      "fWrGA",
      "xbtkW",
      "MPsxN",
      "JMW2O",
      "ROG0x",
      "QqwyN",
      "lNM1U",
      "jOrxb",
      "JvIbi",
      "byua1",
      "XB33E",
      "lUDi2",
    ])
      expect(pen).toContain(id)
    expect(out).toMatchSnapshot()
  })
})

describe("accessibility", () => {
  test("toggle is a switch with aria-checked", () => {
    const out = html(h(Toggle, { label: "Clip", checked: true }))
    expect(out).toContain('role="switch"')
    expect(out).toContain('aria-checked="true"')
    expect(out).toContain('aria-label="Clip"')
  })

  test("segmented is a radiogroup with one tabbable radio", () => {
    const out = html(
      h(Segmented, {
        label: "Align",
        options: [
          { value: "l", label: "Left", icon },
          { value: "c", label: "Center", icon },
          { value: "r", label: "Right", icon },
        ],
        value: "c",
      }),
    )
    expect(out).toContain('role="radiogroup"')
    expect(out.match(/role="radio"/g)?.length).toBe(3)
    expect(out.match(/tabindex="0"/g)?.length).toBe(1)
    expect(out).toMatch(/aria-checked="true"[^>]*aria-label="Center"/)
  })

  test("select is a collapsed combobox", () => {
    const out = html(
      h(Select, { label: "Font", options: [{ value: "a", label: "A" }], value: "a" }),
    )
    expect(out).toContain('role="combobox"')
    expect(out).toContain('aria-expanded="false"')
    expect(out).toContain('aria-haspopup="listbox"')
  })

  test("menu items are menuitems; disabled ones are aria-disabled", () => {
    const out = html(h(Menu, { label: "M" }, h(MenuItem, { disabled: true }, "X")))
    expect(out).toContain('role="menu"')
    expect(out).toContain('role="menuitem"')
    expect(out).toContain('aria-disabled="true"')
  })

  test("layer row is a treeitem with level, selection, expansion, and indent", () => {
    const out = html(h(LayerRow, { name: "Hero", icon, depth: 2, expanded: true, selected: true }))
    expect(out).toContain('role="treeitem"')
    expect(out).toContain('aria-level="3"')
    expect(out).toContain('aria-selected="true"')
    expect(out).toContain('aria-expanded="true"')
    expect(out).toContain("padding-left:36px")
    const leaf = html(h(LayerRow, { name: "T", icon }))
    expect(leaf).not.toContain("aria-expanded")
    expect(leaf).toContain("kimo-layer-row__disclosure--leaf")
  })

  test("tabs expose tablist/tab with roving tabindex", () => {
    const out = html(
      h(Tabs, {
        label: "P",
        items: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
        value: "b",
      }),
    )
    expect(out).toContain('role="tablist"')
    expect(out).toMatch(/tabindex="-1"[^>]*role="tab" aria-selected="false"/)
    expect(out).toMatch(/tabindex="0"[^>]*role="tab" aria-selected="true"/)
  })

  test("icon-only controls carry accessible names", () => {
    expect(html(h(ToolButton, { label: "Frame", icon }))).toContain('aria-label="Frame"')
    expect(html(h(Composer, {}))).toContain('aria-label="Send"')
    expect(html(h(Avatar, { name: "Ada Lovelace" }))).toContain(
      'role="img" aria-label="Ada Lovelace"',
    )
    expect(html(h(Toast, null, "x"))).toContain('role="status"')
    expect(html(h(TooltipContent, null, "x"))).toContain('role="tooltip"')
  })

  test("prop field labels its input and shows keywords", () => {
    const out = html(h(PropField, { prefix: "H", value: "Hug", inputLabel: "Height" }))
    expect(out).toContain('aria-label="Height"')
    expect(out).toContain('value="Hug"')
    expect(html(h(PropField, { prefix: "X", value: 1.23456 }))).toContain('value="1.23"')
    expect(html(h(PropField, { prefix: "X", value: -5, min: 0 }))).toContain('value="0"')
  })
})

describe("helpers", () => {
  test("initialsOf", () => {
    expect(initialsOf("Gui Saudade")).toBe("GS")
    expect(initialsOf("  ada  ")).toBe("A")
    expect(initialsOf("a b c")).toBe("AB")
  })
})
