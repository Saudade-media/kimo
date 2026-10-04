/** Board 27 §7 binding components: DOM isomorphic to PropField/Bound (egdNP), picker (xec6v). */
import { describe, expect, test } from "bun:test"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { BindButton, PropField, PropFieldBound, SizeField, VariablePicker } from "../src/index"

const order = (html: string, parts: string[]) => {
  let at = -1
  for (const p of parts) {
    const i = html.indexOf(p, at + 1)
    expect(i, `${p} after index ${at}`).toBeGreaterThan(at)
    at = i
  }
}

describe("PropField/Bound (egdNP)", () => {
  test("Prefix · Variable Chip (Glyph · Name) · Spacer · Resolved · Detach Button", () => {
    const html = renderToString(
      h(PropFieldBound, {
        prefix: "Gap",
        type: "number",
        name: "space/4",
        resolved: "16",
        onOpen() {},
        onDetach() {},
      }),
    )
    order(html, [
      'class="kimo-prop-field-bound"',
      "kimo-prop-field-bound__prefix",
      ">Gap<",
      "kimo-prop-field-bound__chip",
      "kimo-prop-field-bound__glyph",
      "kimo-prop-field-bound__name",
      ">space/4<",
      "kimo-prop-field-bound__spacer",
      "kimo-prop-field-bound__resolved",
      ">16<",
      "kimo-prop-field-bound__detach",
    ])
    expect(html).toContain("lucide-hash")
    expect(html).toContain("lucide-unlink")
  })

  test("glyph per type: hash number · type string · toggle-left boolean; no prefix when omitted", () => {
    const s = renderToString(h(PropFieldBound, { type: "string", name: "copy/cta" }))
    expect(s).toContain("lucide-type")
    expect(s).not.toContain("kimo-prop-field-bound__prefix")
    expect(s).not.toContain("kimo-prop-field-bound__detach")
    const b = renderToString(h(PropFieldBound, { type: "boolean", name: "show/badge" }))
    expect(b).toContain("lucide-toggle-left")
  })

  test("missing → --missing (danger chip), picker open → --active", () => {
    const html = renderToString(
      h(PropFieldBound, { type: "number", name: "space/legacy", missing: true, active: true }),
    )
    expect(html).toContain("kimo-prop-field-bound--missing")
    expect(html).toContain("kimo-prop-field-bound--active")
    expect(html).toContain("(missing)")
  })
})

describe("PropField/Bindable (LFrgQ)", () => {
  test("the Bind Button sits last inside PropField and SizeField frames", () => {
    const p = renderToString(
      h(PropField, {
        prefix: "Gap",
        value: 16,
        className: "kimo-prop-field--bindable",
        trailing: h(BindButton, {}),
      }),
    )
    order(p, [
      "kimo-prop-field kimo-prop-field--bindable",
      "kimo-prop-field__prefix",
      "kimo-prop-field__value",
      "kimo-bind-button",
      "lucide-variable",
    ])
    const s = renderToString(
      h(SizeField, {
        prefix: "W",
        value: "120",
        mode: "fixed",
        className: "kimo-prop-field--bindable",
        trailing: h(BindButton, {}),
      }),
    )
    order(s, ["kimo-size-field__mode", "kimo-size-field__chevron", "kimo-bind-button"])
  })
})

describe("VariablePicker (xec6v)", () => {
  const groups = [
    {
      key: "",
      title: "This file",
      meta: "2",
      items: [
        { ref: "space/4", name: "space/4", value: "16" },
        { ref: "space/gutter", name: "space/gutter", value: "→ space/6", alias: true },
      ],
    },
    {
      key: "brand",
      title: "brand",
      meta: "./brand.kimo",
      library: true,
      items: [{ ref: "brand:space/md", name: "brand/space/md", value: "20" }],
    },
  ]

  test("Header 'Bind Gap' · Search · This file group · rows · library group (Lib, path) · Footer", () => {
    const html = renderToString(
      h(VariablePicker, {
        title: "Bind Gap",
        type: "number",
        groups,
        selected: "space/4",
        onSelect() {},
        createLabel: "Create variable from 24",
        onCreate() {},
        onDetach() {},
      }),
    )
    order(html, [
      ">Bind Gap<",
      "kimo-variable-picker__body",
      "kimo-variable-picker__search",
      'placeholder="Search number variables"',
      "kimo-variable-picker__group",
      ">This file<",
      ">2<",
      'data-ref="space/4"',
      "kimo-variable-list-row--selected",
      'data-ref="space/gutter"',
      "→ space/6",
      'aria-label="alias"',
      "kimo-variable-picker__lib",
      ">brand<",
      ">./brand.kimo<",
      'data-ref="brand:space/md"',
      "kimo-variable-picker__footer",
      "kimo-variable-picker__plus",
      ">Create variable from 24<",
      "kimo-variable-picker__spacer",
      "kimo-variable-picker__detach",
    ])
  })

  test("no footer without create/detach; empty state copy", () => {
    const html = renderToString(
      h(VariablePicker, { title: "Bind Gap", type: "boolean", groups: [], onSelect() {} }),
    )
    expect(html).not.toContain("kimo-variable-picker__footer")
    expect(html).toContain("No boolean variables yet")
  })
})
