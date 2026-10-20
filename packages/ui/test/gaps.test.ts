/** Board 24 gap components: DOM order isomorphic to the desing.pen nodes, copy, states. */
import { describe, expect, test } from "bun:test"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  ClosePrompt,
  ConflictMoreMenu,
  CustomTagField,
  LinkPopover,
  MissingWeightTooltip,
  SvgRejectionDetails,
  WarningDot,
} from "../src/index"

const order = (html: string, parts: string[]) => {
  let at = -1
  for (const p of parts) {
    const i = html.indexOf(p, at + 1)
    expect(i, `${p} after index ${at}`).toBeGreaterThan(at)
    at = i
  }
}

describe("LinkPopover (NpwJS)", () => {
  test("Header › Leading (icon, Link) · Close; Body › Field · Hint · Actions (Open, Remove, Spacer, Apply)", () => {
    const html = renderToString(
      h(LinkPopover, {
        value: "https://getkimo.design/pricing",
        onApply() {},
        onRemove() {},
        onOpen() {},
        onClose() {},
      }),
    )
    order(html, [
      "kimo-popover__header",
      "kimo-link-popover__title",
      ">Link<",
      "kimo-popover__close",
      "kimo-link-popover__body",
      "kimo-link-popover__field",
      'value="https://getkimo.design/pricing"',
      "kimo-link-popover__hint",
      "http(s), mailto:, tel: or #frame",
      "kimo-link-popover__actions",
      ">Open<",
      ">Remove link<",
      "kimo-link-popover__spacer",
      ">Apply<",
    ])
  })
  test("no current link: no Remove; Apply disabled while empty", () => {
    const html = renderToString(
      h(LinkPopover, { value: "", onApply() {}, onRemove() {}, onClose() {} }),
    )
    expect(html).not.toContain("Remove link")
    expect(html).toMatch(/disabled=""[^>]*><span class="kimo-button__label">Apply/)
  })
})

describe("CustomTagField (Ehror)", () => {
  test("Label · Inputs (tag, =, value, Spacer, Add) · Hint", () => {
    const html = renderToString(h(CustomTagField, { family: "Inter", onAdd() {} }))
    order(html, [
      "kimo-custom-tag__label",
      "Custom tag…",
      "kimo-custom-tag__field--tag",
      "kimo-custom-tag__eq",
      "kimo-custom-tag__field--value",
      'value="1"',
      "kimo-custom-tag__spacer",
      ">Add<",
      "kimo-custom-tag__hint",
      "4 characters, a–z 0–9",
    ])
  })
})

describe("ClosePrompt (a3Y0Fb)", () => {
  test("Head (icon wrap, title, desc) · Footer (Don't save, Spacer, Cancel, Save…)", () => {
    const html = renderToString(
      h(ClosePrompt, {
        fileName: "Untitled 3",
        frames: 12,
        inline: true,
        onSave() {},
        onDiscard() {},
        onCancel() {},
      }),
    )
    order(html, [
      'role="alertdialog"',
      "kimo-close-prompt__icon-wrap",
      "Save “Untitled 3” before closing?",
      "its 12 frames are gone for good.",
      "kimo-close-prompt__discard",
      "Don&#x27;t save",
      "kimo-close-prompt__spacer",
      ">Cancel<",
      ">Save…<",
    ])
  })
})

describe("SvgRejectionDetails (nx2kl)", () => {
  const items = Array.from({ length: 7 }, (_, i) => ({
    line: i + 1,
    code: "<script>",
    why: "scripts are never imported",
  }))
  test("Head · up to 5 reasons + '+N more' · Footer", () => {
    const html = renderToString(
      h(SvgRejectionDetails, {
        fileName: "logo.svg",
        items,
        onHide() {},
        onCopyReport() {},
        onCancel() {},
        onImport() {},
      }),
    )
    order(html, [
      "kimo-svg-rejection__head",
      "Couldn&#x27;t import logo.svg",
      "Hide details",
      ">L1<",
      ">L5<",
      "+2 more",
      ">Copy report<",
      ">Cancel<",
      ">Import without these<",
    ])
    expect(html).not.toContain(">L6<")
  })
})

describe("WarningDot + MissingWeightTooltip (QfSAK)", () => {
  test("dot and tooltip title/body", () => {
    expect(renderToString(h(WarningDot))).toContain("kimo-warning-dot")
    const html = renderToString(
      h(MissingWeightTooltip, {
        title: "Inter Bold (700) isn't installed",
        body: "Showing Semi Bold 600. Install the weight or pick another.",
      }),
    )
    order(html, ['role="tooltip"', "kimo-weight-tooltip__title", "kimo-weight-tooltip__body"])
  })
})

describe("ConflictMoreMenu (c2CNAR)", () => {
  test("Group label · items (icon, label, spacer, meta); width 240", () => {
    const html = renderToString(
      h(ConflictMoreMenu, {
        items: [
          { id: "c1", path: ["Pricing", "Cards", "Item 3"], meta: "fill" },
          { id: "c2", path: ["Navbar", "Logo"], meta: "text" },
        ],
        measure: (t: string) => t.length * 6,
        onSelect() {},
        onClose() {},
      }),
    )
    order(html, [
      "width:240px",
      "2 MORE CONFLICTS",
      "kimo-conflict-more-menu__icon",
      "Pricing / Cards / Item 3",
      "kimo-conflict-more-menu__spacer",
      ">fill<",
      "Navbar / Logo",
      ">text<",
    ])
    expect(html).toContain("max-height:257px")
  })
})
