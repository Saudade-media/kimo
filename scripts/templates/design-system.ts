/**
 * Basalt: a published UI kit (the document is a library, `meta.library`, so other files can
 * import its components and tokens). Pages: Cover, Patterns (forms, empty states, settings,
 * data table, dialog and toast as 1440×900 screens), Components (every main plus variant
 * matrices), Foundations (color in light and dark, type, spacing, radius, elevation, icons).
 * Example content comes from Tallybook, a fictional invoicing app for small studios.
 */
import { FILL, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "design-system",
  name: "Basalt UI kit",
  category: "Design system",
  description:
    "A published UI kit with 38 components and their variants, light and dark tokens, and five page patterns built from them.",
  prefix: "bx",
  build,
}

type Slot = { inst: string; at: string }

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F7F7F8", "#0B0C0F"],
      surface: ["#FFFFFF", "#141519"],
      subtle: ["#F1F1F3", "#1C1D23"],
      sunken: ["#E8E8EC", "#23252C"],
      ink: ["#16171D", "#F2F2F5"],
      "ink-2": ["#3A3C46", "#C9CAD3"],
      muted: ["#6B6D7A", "#8E909D"],
      border: ["#E3E3E8", "#2A2C34"],
      "border-strong": ["#C9CAD2", "#3B3E48"],
      accent: ["#4F46E5", "#8B85FF"],
      "accent-soft": ["#EEEDFD", "#221F4A"],
      "on-accent": ["#FFFFFF", "#0B0C0F"],
      inverse: ["#1D1E25", "#ECECF1"],
      "on-inverse": ["#F4F4F7", "#16171D"],
      "inverse-muted": ["#A3A5B3", "#5D5F6B"],
      success: ["#15803D", "#4ADE80"],
      "success-soft": ["#E7F6EC", "#11301D"],
      warning: ["#B45309", "#FBBF24"],
      "warning-soft": ["#FDF3E1", "#3A2A0B"],
      danger: ["#DC2626", "#F87171"],
      "danger-soft": ["#FDECEC", "#3B1414"],
      info: ["#0369A1", "#38BDF8"],
      "info-soft": ["#E6F3FA", "#0E2A3B"],
      scrim: ["#16171D73", "#000000A6"],
      "tone-1": ["#DDDAFE", "#36316F"],
      "tone-2": ["#CDEFE0", "#1C4A36"],
      "tone-3": ["#FBE2BE", "#59401A"],
      "tone-4": ["#F9D4D0", "#5A2620"],
    },
    numbers: {
      "space/1": 4,
      "space/2": 8,
      "space/3": 12,
      "space/4": 16,
      "space/5": 20,
      "space/6": 24,
      "space/8": 32,
      "space/10": 40,
      "space/12": 48,
      "space/16": 64,
      "radius/xs": 4,
      "radius/sm": 6,
      "radius/md": 8,
      "radius/lg": 12,
      "radius/xl": 16,
      "radius/pill": 999,
    },
    type: {
      display: { font: "Inter", size: 52, weight: 700, lineHeight: 1.05, letterSpacing: -1.5 },
      h1: { font: "Inter", size: 32, weight: 700, lineHeight: 1.2, letterSpacing: -0.8 },
      h2: { font: "Inter", size: 24, weight: 600, lineHeight: 1.25, letterSpacing: -0.4 },
      h3: { font: "Inter", size: 18, weight: 600, lineHeight: 1.3, letterSpacing: -0.2 },
      heading: { font: "Inter", size: 16, weight: 600, lineHeight: 1.35, letterSpacing: -0.1 },
      body: { font: "Inter", size: 14, weight: 400, lineHeight: 1.5 },
      "body-sm": { font: "Inter", size: 13, weight: 400, lineHeight: 1.45 },
      label: { font: "Inter", size: 14, weight: 500, lineHeight: 1.3 },
      caption: { font: "Inter", size: 12, weight: 400, lineHeight: 1.4 },
      overline: { font: "Inter", size: 11, weight: 600, lineHeight: 1.3, letterSpacing: 0.8 },
      code: { font: "JetBrains Mono", size: 12, weight: 500, lineHeight: 1.4 },
    },
    shadows: {
      "elevation-1": [{ kind: "shadow", x: 0, y: 1, blur: 2, color: "#16171D14" }],
      "elevation-2": [
        { kind: "shadow", x: 0, y: 1, blur: 3, color: "#16171D14" },
        { kind: "shadow", x: 0, y: 4, blur: 10, spread: -2, color: "#16171D14" },
      ],
      "elevation-3": [
        { kind: "shadow", x: 0, y: 2, blur: 6, color: "#16171D0F" },
        { kind: "shadow", x: 0, y: 12, blur: 28, spread: -6, color: "#16171D29" },
      ],
      "elevation-4": [
        { kind: "shadow", x: 0, y: 4, blur: 12, color: "#16171D14" },
        { kind: "shadow", x: 0, y: 24, blur: 56, spread: -12, color: "#16171D3D" },
      ],
      "focus-ring": [{ kind: "shadow", x: 0, y: 0, blur: 0, spread: 3, color: "#4F46E559" }],
      "state-hover": [
        { kind: "shadow", inner: true, x: 0, y: 0, blur: 0, spread: 200, color: "#16171D12" },
      ],
      "state-pressed": [
        { kind: "shadow", inner: true, x: 0, y: 0, blur: 0, spread: 200, color: "#16171D24" },
      ],
    },
  })

  // Publish: the document is a library, so other files can import its components and tokens.
  ;(b as unknown as { nodes: unknown[] }).nodes.push({
    op: "setHeader",
    set: {
      meta: {
        name: template.name,
        library: true,
        "kimo.template": {
          slug: template.slug,
          category: template.category,
          description: template.description,
        },
      },
    },
  })

  const c = (n: string) => b.c(n)
  const s = (n: number) => b.n(`space/${n}`)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  const none: unknown[] = []
  const box = (extra: Record<string, unknown> = {}) => ({
    radius: r("lg"),
    fill: c("surface"),
    stroke: { paint: c("border") },
    ...extra,
  })
  // Labeled cells on the Components page next to a main (variant matrices).
  const kit = b as unknown as { section(name: string): string }
  function showcase(section: string, label: string, fill: (cell: string) => void) {
    const cell = b.col(kit.section(section), label, { gap: 12 })
    b.text(cell, label, b.ty("label"), muted, { name: "Label" })
    const body = b.col(cell, "Variants", {
      gap: 14,
      pad: 20,
      radius: r("lg"),
      fill: c("surface"),
      stroke: { paint: c("border") },
    })
    fill(body)
  }
  function grid(
    parent: string,
    cols: string[],
    rows: string[],
    cellW: number,
    put: (cell: string, row: number, col: number) => void,
  ) {
    const head = b.row(parent, "Columns", { gap: 12, align: "center" })
    b.text(head, "", b.ty("caption"), muted, { name: "Corner", w: 84, grow: "fixed-width" })
    for (const t of cols)
      b.text(head, t, b.ty("caption", { weight: 600 }), muted, { w: cellW, grow: "fixed-width" })
    rows.forEach((label, i) => {
      const row = b.row(parent, label, { gap: 12, align: "center" })
      b.text(row, label, b.ty("caption", { weight: 600 }), muted, { w: 84, grow: "fixed-width" })
      cols.forEach((_, j) => {
        const cell = b.row(row, `${label} ${cols[j]}`, { w: cellW, align: "center" })
        put(cell, i, j)
      })
    })
  }
  const states = {
    default: { "root.effects": none, "root.opacity": 1 },
    hover: { "root.effects": b.shadow("state-hover"), "root.opacity": 1 },
    pressed: { "root.effects": b.shadow("state-pressed"), "root.opacity": 1 },
    focus: { "root.effects": b.shadow("focus-ring"), "root.opacity": 1 },
    disabled: { "root.effects": none, "root.opacity": 0.4 },
  }

  // --- Actions ---------------------------------------------------------------------------------

  const button = b.component(
    "Button",
    {
      key: "Btn",
      section: "Actions",
      description:
        "Five variants, three sizes, five states. Start and end icons are optional; swap the icon by name.",
      props: {
        label: p.text("BtnL", "Button"),
        iconStart: p.bool("BtnS", false),
        iconEnd: p.bool("BtnE", false),
        variant: p.variants({
          primary: {
            "root.fill": c("accent"),
            "root.stroke": { paint: c("accent") },
            "BtnL.fill": c("on-accent"),
            "BtnS.color": c("on-accent"),
            "BtnE.color": c("on-accent"),
          },
          secondary: {
            "root.fill": c("subtle"),
            "root.stroke": { paint: c("subtle") },
            "BtnL.fill": ink,
            "BtnS.color": c("ink-2"),
            "BtnE.color": c("ink-2"),
          },
          outline: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border-strong") },
            "BtnL.fill": ink,
            "BtnS.color": c("ink-2"),
            "BtnE.color": c("ink-2"),
          },
          ghost: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("surface") },
            "BtnL.fill": c("ink-2"),
            "BtnS.color": c("ink-2"),
            "BtnE.color": c("ink-2"),
          },
          danger: {
            "root.fill": c("danger"),
            "root.stroke": { paint: c("danger") },
            "BtnL.fill": c("on-accent"),
            "BtnS.color": c("on-accent"),
            "BtnE.color": c("on-accent"),
          },
        }),
        size: p.variants({
          md: { "root.layout/pad": [8, 14], "BtnL.style/size": 14 },
          sm: { "root.layout/pad": [5, 10], "BtnL.style/size": 13 },
          lg: { "root.layout/pad": [11, 18], "BtnL.style/size": 15 },
        }),
        state: p.variants(states),
      },
      root: {
        dir: "row",
        gap: 6,
        align: "center",
        justify: "center",
        pad: [8, 14],
        radius: r("md"),
        fill: c("accent"),
        stroke: { paint: c("accent") },
      },
    },
    (root) => {
      b.icon(root, "plus", 16, c("on-accent"), { key: "BtnS", visible: false })
      b.text(root, "Button", b.ty("label"), c("on-accent"), { key: "BtnL", name: "Label" })
      b.icon(root, "chevron-down", 16, c("on-accent"), { key: "BtnE", visible: false })
    },
  )
  const btnOutline = b.derive(button, "Button/Outline", "BtnOut", {
    section: "Actions",
    args: { variant: "outline" },
  })
  showcase("Actions", "Button: variant × state", (cell) => {
    const variants = ["primary", "secondary", "outline", "ghost", "danger"]
    const st = ["default", "hover", "pressed", "focus", "disabled"]
    grid(cell, st, variants, 104, (into, i, j) =>
      b.use(into, button, {
        args: {
          label: variants[i] === "danger" ? "Delete" : "Save",
          variant: variants[i],
          state: st[j],
        },
      }),
    )
  })
  showcase("Actions", "Button: size and icons", (cell) => {
    for (const size of ["sm", "md", "lg"]) {
      const row = b.row(cell, size, { gap: 12, align: "center" })
      b.text(row, size, b.ty("caption", { weight: 600 }), muted, { w: 40, grow: "fixed-width" })
      b.use(row, button, { args: { label: "New invoice", size, iconStart: true } })
      b.use(row, button, {
        args: { label: "Export", size, variant: "outline", iconEnd: true },
      })
      b.use(row, button, {
        args: { label: "Continue", size, variant: "secondary", iconEnd: true },
        set: { BtnE: { icon: "arrow-right" } },
      })
    }
  })

  const iconButton = b.component(
    "Icon button",
    {
      key: "IcBtn",
      section: "Actions",
      description: "Square button for toolbars. Always give it a tooltip.",
      props: {
        variant: p.variants({
          outline: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border-strong") },
            "IcI.color": c("ink-2"),
          },
          primary: {
            "root.fill": c("accent"),
            "root.stroke": { paint: c("accent") },
            "IcI.color": c("on-accent"),
          },
          ghost: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("surface") },
            "IcI.color": c("ink-2"),
          },
        }),
        size: p.variants({
          md: { "root.w": 36, "root.h": 36 },
          sm: { "root.w": 30, "root.h": 30 },
          lg: { "root.w": 44, "root.h": 44 },
        }),
        state: p.variants(states),
      },
      root: {
        dir: "row",
        w: 36,
        h: 36,
        align: "center",
        justify: "center",
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border-strong") },
      },
    },
    (root) => b.icon(root, "ellipsis", 16, c("ink-2"), { key: "IcI" }),
  )
  showcase("Actions", "Icon button", (cell) => {
    for (const variant of ["outline", "primary", "ghost"]) {
      const row = b.row(cell, variant, { gap: 12, align: "center" })
      b.text(row, variant, b.ty("caption", { weight: 600 }), muted, { w: 56, grow: "fixed-width" })
      for (const [size, icon] of [
        ["sm", "pencil"],
        ["md", "copy"],
        ["lg", "trash-2"],
      ] as const)
        b.use(row, iconButton, { args: { variant, size }, set: { IcI: { icon } } })
    }
  })

  const segLabels = ["Day", "Week", "Month"]
  const segSel = (i: number) =>
    Object.fromEntries(
      segLabels.flatMap((_, j) => [
        [`SegI${j + 1}.fill`, j === i ? c("surface") : c("subtle")],
        [`SegI${j + 1}.effects`, j === i ? b.shadow("elevation-1") : none],
        [`SegL${j + 1}.fill`, j === i ? ink : muted],
      ]),
    )
  const segmented = b.component(
    "Segmented control",
    {
      key: "Seg",
      section: "Actions",
      props: {
        option1: p.text("SegL1", "Day"),
        option2: p.text("SegL2", "Week"),
        option3: p.text("SegL3", "Month"),
        selected: p.variants({ first: segSel(0), second: segSel(1), third: segSel(2) }),
      },
      root: { dir: "row", gap: 2, pad: 3, radius: r("md"), fill: c("subtle") },
    },
    (root) =>
      segLabels.forEach((t, i) => {
        const item = b.row(root, t, {
          key: `SegI${i + 1}`,
          pad: [5, 14],
          radius: r("sm"),
          fill: i === 0 ? c("surface") : c("subtle"),
          ...(i === 0 ? { effects: b.shadow("elevation-1") } : {}),
        })
        b.text(item, t, b.ty("label", { size: 13 }), i === 0 ? ink : muted, {
          key: `SegL${i + 1}`,
          name: "Label",
        })
      }),
  )

  b.component(
    "Link",
    {
      key: "Link",
      section: "Actions",
      props: {
        label: p.text("LnkL", "View all invoices"),
        external: p.bool("LnkI", false),
        tone: p.variants({
          accent: { "LnkL.fill": c("accent"), "LnkI.color": c("accent") },
          neutral: { "LnkL.fill": ink, "LnkI.color": c("ink-2") },
        }),
        state: p.variants({
          default: { "LnkL.style/decoration": [] },
          hover: { "LnkL.style/decoration": ["underline"] },
        }),
      },
      root: { dir: "row", gap: 4, align: "center" },
    },
    (root) => {
      b.text(root, "View all invoices", b.ty("label"), c("accent"), { key: "LnkL" })
      b.icon(root, "external-link", 14, c("accent"), { key: "LnkI", visible: false })
    },
  )

  // --- Forms -----------------------------------------------------------------------------------

  const fieldStates = (k: string) => ({
    default: {
      [`${k}Box.stroke`]: { paint: c("border-strong") },
      [`${k}Box.effects`]: none,
      [`${k}Box.fill`]: c("surface"),
      [`${k}H.fill`]: muted,
      "root.opacity": 1,
    },
    focus: {
      [`${k}Box.stroke`]: { paint: c("accent") },
      [`${k}Box.effects`]: b.shadow("focus-ring"),
      [`${k}Box.fill`]: c("surface"),
      [`${k}H.fill`]: muted,
      "root.opacity": 1,
    },
    error: {
      [`${k}Box.stroke`]: { paint: c("danger") },
      [`${k}Box.effects`]: none,
      [`${k}Box.fill`]: c("surface"),
      [`${k}H.fill`]: c("danger"),
      "root.opacity": 1,
    },
    disabled: {
      [`${k}Box.stroke`]: { paint: c("border") },
      [`${k}Box.effects`]: none,
      [`${k}Box.fill`]: c("subtle"),
      [`${k}H.fill`]: muted,
      "root.opacity": 0.55,
    },
  })
  const fieldShell = (
    root: string,
    k: string,
    label: string,
    hint: string,
    body: (bx: string) => void,
    boxProps = {},
    hintVisible = true,
  ) => {
    b.text(root, label, b.ty("label", { size: 13 }), c("ink-2"), { key: `${k}Lbl`, name: "Label" })
    const fieldBox = b.row(root, "Control", {
      key: `${k}Box`,
      w: FILL,
      gap: 8,
      align: "center",
      pad: [9, 12],
      radius: r("md"),
      fill: c("surface"),
      stroke: { paint: c("border-strong") },
      ...boxProps,
    })
    body(fieldBox)
    b.text(root, hint, b.ty("caption"), muted, {
      key: `${k}H`,
      name: "Hint",
      ...(hintVisible ? {} : { visible: false }),
    })
  }

  const textField = b.component(
    "Text field",
    {
      key: "Fld",
      section: "Forms",
      description: "Label, control and hint. Error turns the hint into the error message.",
      props: {
        label: p.text("FldLbl", "Label"),
        value: p.text("FldV", "Value"),
        hint: p.text("FldH", "Hint"),
        showHint: p.bool("FldH", true),
        icon: p.bool("FldI", false),
        content: p.variants({ value: { "FldV.fill": ink }, placeholder: { "FldV.fill": muted } }),
        size: p.variants({
          md: { "FldBox.layout/pad": [9, 12], "FldV.style/size": 14 },
          sm: { "FldBox.layout/pad": [6, 10], "FldV.style/size": 13 },
          lg: { "FldBox.layout/pad": [12, 14], "FldV.style/size": 15 },
        }),
        state: p.variants({
          ...fieldStates("Fld"),
          error: { ...fieldStates("Fld").error, "FldErr.visible": true },
          default: { ...fieldStates("Fld").default, "FldErr.visible": false },
        }),
      },
      root: { dir: "column", w: 320, gap: 6 },
    },
    (root) =>
      fieldShell(root, "Fld", "Label", "Hint", (bx) => {
        b.icon(bx, "search", 16, muted, { key: "FldI", visible: false })
        b.text(bx, "Value", b.ty("body"), ink, { key: "FldV", w: FILL, grow: "fixed-width" })
        b.icon(bx, "circle-alert", 16, c("danger"), { key: "FldErr", visible: false })
      }),
  )
  showcase("Forms", "Text field: states", (cell) => {
    const row = b.row(cell, "States", { gap: 20, align: "start" })
    for (const [state, value, hint, content] of [
      ["default", "Okonkwo Architects", "Shown on invoices and receipts.", "value"],
      ["focus", "accounts@okon", "We send invoices to this address.", "value"],
      ["error", "accounts@okonkwo", "Enter an email like name@company.com.", "value"],
      ["disabled", "MP-1050", "Set by your invoice numbering.", "value"],
    ] as const)
      b.use(row, textField, {
        props: { w: 240 },
        args: {
          label:
            state === "error" || state === "focus"
              ? "Billing email"
              : state === "disabled"
                ? "Invoice number"
                : "Company name",
          value,
          hint,
          state,
          content,
        },
      })
    const row2 = b.row(cell, "Sizes", { gap: 20, align: "end" })
    for (const size of ["sm", "md", "lg"])
      b.use(row2, textField, {
        props: { w: 240 },
        args: {
          label: `Search, ${size}`,
          value: "Search invoices",
          content: "placeholder",
          icon: true,
          showHint: false,
          size,
        },
      })
  })

  const textarea = b.component(
    "Textarea",
    {
      key: "Area",
      section: "Forms",
      props: {
        label: p.text("AreaLbl", "Notes"),
        value: p.text("AreaV", "Text"),
        hint: p.text("AreaH", "0 / 500"),
        state: p.variants(fieldStates("Area")),
      },
      root: { dir: "column", w: 320, gap: 6 },
    },
    (root) =>
      fieldShell(
        root,
        "Area",
        "Notes",
        "0 / 500",
        (bx) => b.para(bx, "Text", b.ty("body"), ink, { key: "AreaV" }),
        { h: 96, align: "start" },
      ),
  )

  const select = b.component(
    "Select",
    {
      key: "Sel",
      section: "Forms",
      props: {
        label: p.text("SelLbl", "Label"),
        value: p.text("SelV", "Choose one"),
        hint: p.text("SelH", "Hint"),
        showHint: p.bool("SelH", false),
        state: p.variants({
          ...fieldStates("Sel"),
          default: { ...fieldStates("Sel").default, "SelC.icon": "chevron-down" },
          focus: { ...fieldStates("Sel").focus, "SelC.icon": "chevron-up" },
        }),
      },
      root: { dir: "column", w: 320, gap: 6 },
    },
    (root) =>
      fieldShell(
        root,
        "Sel",
        "Label",
        "Hint",
        (bx) => {
          b.text(bx, "Choose one", b.ty("body"), ink, { key: "SelV", w: FILL, grow: "fixed-width" })
          b.icon(bx, "chevron-down", 16, muted, { key: "SelC" })
        },
        {},
        false,
      ),
  )
  // Hint is hidden by default on selects.
  const enabled = {
    enabled: { "root.opacity": 1 },
    disabled: { "root.opacity": 0.45 },
  }

  const checkbox = b.component(
    "Checkbox",
    {
      key: "Chk",
      section: "Forms",
      props: {
        label: p.text("ChkL", "Label"),
        showLabel: p.bool("ChkL", true),
        state: p.variants({
          off: {
            "ChkB.fill": c("surface"),
            "ChkB.stroke": { paint: c("border-strong"), width: 1.5 },
            "ChkI.visible": false,
          },
          on: {
            "ChkB.fill": c("accent"),
            "ChkB.stroke": { paint: c("accent"), width: 1.5 },
            "ChkI.visible": true,
            "ChkI.icon": "check",
          },
          mixed: {
            "ChkB.fill": c("accent"),
            "ChkB.stroke": { paint: c("accent"), width: 1.5 },
            "ChkI.visible": true,
            "ChkI.icon": "minus",
          },
        }),
        interaction: p.variants(enabled),
      },
      root: { dir: "row", gap: 8, align: "center" },
    },
    (root) => {
      const bx = b.row(root, "Box", {
        key: "ChkB",
        w: 18,
        h: 18,
        align: "center",
        justify: "center",
        radius: r("xs"),
        fill: c("surface"),
        stroke: { paint: c("border-strong"), width: 1.5 },
      })
      b.icon(bx, "check", 13, c("on-accent"), { key: "ChkI", visible: false })
      b.text(root, "Label", b.ty("body"), ink, { key: "ChkL" })
    },
  )

  const radio = b.component(
    "Radio",
    {
      key: "Rad",
      section: "Forms",
      props: {
        label: p.text("RadL", "Label"),
        state: p.variants({
          off: { "RadB.stroke": { paint: c("border-strong"), width: 1.5 }, "RadD.visible": false },
          on: { "RadB.stroke": { paint: c("accent"), width: 5 }, "RadD.visible": true },
        }),
        interaction: p.variants(enabled),
      },
      root: { dir: "row", gap: 8, align: "center" },
    },
    (root) => {
      const ring = b.row(root, "Ring", {
        key: "RadB",
        w: 18,
        h: 18,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("surface"),
        stroke: { paint: c("border-strong"), width: 1.5 },
      })
      b.ellipse(ring, "Dot", { key: "RadD", w: 6, h: 6, fill: c("surface"), visible: false })
      b.text(root, "Label", b.ty("body"), ink, { key: "RadL" })
    },
  )

  const toggle = b.component(
    "Switch",
    {
      key: "Sw",
      section: "Forms",
      props: {
        label: p.text("SwL", "Label"),
        showLabel: p.bool("SwL", true),
        state: p.variants({
          on: { "SwT.fill": c("accent"), "SwT.layout/justify": "end" },
          off: { "SwT.fill": c("border-strong"), "SwT.layout/justify": "start" },
        }),
        size: p.variants({
          md: { "SwT.w": 36, "SwT.h": 20, "SwK.w": 16, "SwK.h": 16 },
          sm: { "SwT.w": 28, "SwT.h": 16, "SwK.w": 12, "SwK.h": 12 },
        }),
        interaction: p.variants(enabled),
      },
      root: { dir: "row", gap: 10, align: "center" },
    },
    (root) => {
      const track = b.row(root, "Track", {
        key: "SwT",
        w: 36,
        h: 20,
        pad: 2,
        align: "center",
        justify: "end",
        radius: r("pill"),
        fill: c("accent"),
      })
      b.ellipse(track, "Knob", {
        key: "SwK",
        w: 16,
        h: 16,
        fill: c("surface"),
        effects: b.shadow("elevation-1"),
      })
      b.text(root, "Label", b.ty("body"), ink, { key: "SwL" })
    },
  )
  showcase("Forms", "Selection controls", (cell) => {
    const row = b.row(cell, "Rows", { gap: 40, align: "start" })
    const c1 = b.col(row, "Checkbox", { gap: 12 })
    for (const [state, interaction, label] of [
      ["off", "enabled", "Unchecked"],
      ["on", "enabled", "Checked"],
      ["mixed", "enabled", "Indeterminate"],
      ["on", "disabled", "Disabled"],
    ] as const)
      b.use(c1, checkbox, { args: { state, interaction, label } })
    const c2 = b.col(row, "Radio", { gap: 12 })
    for (const [state, interaction, label] of [
      ["off", "enabled", "Unselected"],
      ["on", "enabled", "Selected"],
      ["off", "disabled", "Disabled"],
    ] as const)
      b.use(c2, radio, { args: { state, interaction, label } })
    const c3 = b.col(row, "Switch", { gap: 12 })
    for (const [state, size, interaction, label] of [
      ["on", "md", "enabled", "On"],
      ["off", "md", "enabled", "Off"],
      ["on", "sm", "enabled", "Small"],
      ["off", "md", "disabled", "Disabled"],
    ] as const)
      b.use(c3, toggle, { args: { state, size, interaction, label } })
  })

  b.component(
    "Slider",
    {
      key: "Sld",
      section: "Forms",
      props: {
        label: p.text("SldL", "Label"),
        value: p.text("SldV", "50%"),
        position: p.variants({
          half: { "SldA.w": { mode: "fill", weight: 50 }, "SldB.w": { mode: "fill", weight: 50 } },
          quarter: {
            "SldA.w": { mode: "fill", weight: 25 },
            "SldB.w": { mode: "fill", weight: 75 },
          },
          threeQuarters: {
            "SldA.w": { mode: "fill", weight: 75 },
            "SldB.w": { mode: "fill", weight: 25 },
          },
        }),
      },
      root: { dir: "column", w: 280, gap: 10 },
    },
    (root) => {
      const head = b.row(root, "Header", { w: FILL, justify: "between" })
      b.text(head, "Label", b.ty("label", { size: 13 }), c("ink-2"), { key: "SldL" })
      b.text(head, "50%", b.ty("code"), muted, { key: "SldV" })
      const track = b.row(root, "Track", { w: FILL, h: 18, align: "center" })
      b.rect(track, "Filled", {
        key: "SldA",
        w: { mode: "fill", weight: 50 },
        h: 4,
        radius: [2, 0, 0, 2],
        fill: c("accent"),
      })
      b.ellipse(track, "Thumb", {
        w: 18,
        h: 18,
        fill: c("surface"),
        stroke: { paint: c("accent"), width: 2 },
        effects: b.shadow("elevation-1"),
      })
      b.rect(track, "Rest", {
        key: "SldB",
        w: { mode: "fill", weight: 50 },
        h: 4,
        radius: [0, 2, 2, 0],
        fill: c("sunken"),
      })
    },
  )

  // --- Navigation ------------------------------------------------------------------------------

  const tabLabels = ["Tab one", "Tab two", "Tab three", "Tab four"]
  const tabActive = (i: number) =>
    Object.fromEntries(
      tabLabels.flatMap((_, j) => [
        [`TabI${j + 1}.stroke`, { paint: c("accent"), width: { b: j === i ? 2 : 0 } }],
        [`TabL${j + 1}.fill`, j === i ? ink : muted],
      ]),
    )
  const tabs = b.component(
    "Tabs",
    {
      key: "Tabs",
      section: "Navigation",
      props: {
        tab1: p.text("TabL1", "Tab one"),
        tab2: p.text("TabL2", "Tab two"),
        tab3: p.text("TabL3", "Tab three"),
        tab4: p.text("TabL4", "Tab four"),
        active: p.variants({
          first: tabActive(0),
          second: tabActive(1),
          third: tabActive(2),
          fourth: tabActive(3),
        }),
        size: p.variants(
          Object.fromEntries(
            (
              [
                ["md", [10, 12], 14],
                ["sm", [7, 10], 13],
              ] as const
            ).map(([k, pad, size]) => [
              k,
              Object.fromEntries(
                tabLabels.flatMap((_, j) => [
                  [`TabI${j + 1}.layout/pad`, pad],
                  [`TabL${j + 1}.style/size`, size],
                ]),
              ),
            ]),
          ),
        ),
      },
      root: { dir: "row", w: 520, gap: 4, stroke: { paint: c("border"), width: { b: 1 } } },
    },
    (root) =>
      tabLabels.forEach((t, i) => {
        const item = b.row(root, t, {
          key: `TabI${i + 1}`,
          pad: [10, 12],
          stroke: { paint: c("accent"), width: { b: i === 0 ? 2 : 0 } },
        })
        b.text(item, t, b.ty("label"), i === 0 ? ink : muted, {
          key: `TabL${i + 1}`,
          name: "Label",
        })
      }),
  )

  const breadcrumb = b.component(
    "Breadcrumb",
    {
      key: "Crumb",
      section: "Navigation",
      props: {
        first: p.text("CrL1", "Clients"),
        second: p.text("CrL2", "Okonkwo Architects"),
        third: p.text("CrL3", "INV-1044"),
        depth: p.variants({
          three: {
            "CrS2.visible": true,
            "CrL3.visible": true,
            "CrL2.fill": muted,
            "CrL2.style/weight": 400,
          },
          two: {
            "CrS2.visible": false,
            "CrL3.visible": false,
            "CrL2.fill": ink,
            "CrL2.style/weight": 500,
          },
        }),
      },
      root: { dir: "row", gap: 6, align: "center" },
    },
    (root) => {
      b.text(root, "Clients", b.ty("body-sm"), muted, { key: "CrL1" })
      b.icon(root, "chevron-right", 14, muted)
      b.text(root, "Okonkwo Architects", b.ty("body-sm"), muted, { key: "CrL2" })
      b.icon(root, "chevron-right", 14, muted, { key: "CrS2" })
      b.text(root, "INV-1044", b.ty("body-sm", { weight: 500 }), ink, { key: "CrL3" })
    },
  )

  const pageNums = ["1", "2", "3"]
  const pageActive = (i: number) =>
    Object.fromEntries(
      pageNums.flatMap((_, j) => [
        [`PgB${j + 1}.fill`, j === i ? c("accent-soft") : c("surface")],
        [`PgN${j + 1}.fill`, j === i ? c("accent") : c("ink-2")],
      ]),
    )
  const pagination = b.component(
    "Pagination",
    {
      key: "Pager",
      section: "Navigation",
      props: {
        summary: p.text("PgSum", "1 to 8 of 64"),
        last: p.text("PgLast", "8"),
        page: p.variants({ first: pageActive(0), second: pageActive(1), third: pageActive(2) }),
      },
      root: { dir: "row", w: 640, gap: 12, align: "center", justify: "between" },
    },
    (root) => {
      b.text(root, "1 to 8 of 64", b.ty("body-sm"), muted, { key: "PgSum" })
      const pages = b.row(root, "Pages", { gap: 4, align: "center" })
      const pg = (parent: string, content: string, key?: string, icon?: string, active = false) => {
        const cell = b.row(parent, content || icon || "Page", {
          ...(key ? { key: `PgB${key}` } : {}),
          w: 32,
          h: 32,
          align: "center",
          justify: "center",
          radius: r("md"),
          fill: active ? c("accent-soft") : c("surface"),
        })
        if (icon) b.icon(cell, icon, 16, c("ink-2"))
        else
          b.text(cell, content, b.ty("label", { size: 13 }), active ? c("accent") : c("ink-2"), {
            ...(key ? { key: key === "Last" ? "PgLast" : `PgN${key}` } : {}),
          })
      }
      pg(pages, "", undefined, "chevron-left")
      pageNums.forEach((n, i) => {
        pg(pages, n, String(i + 1), undefined, i === 0)
      })
      pg(pages, "…")
      pg(pages, "8", "Last")
      pg(pages, "", undefined, "chevron-right")
    },
  )

  const navItem = b.component(
    "Nav item",
    {
      key: "Nav",
      section: "Navigation",
      props: {
        label: p.text("NavL", "Item"),
        count: p.text("NavC", "0"),
        showCount: p.bool("NavC", false),
        state: p.variants({
          default: {
            "root.fill": c("bg"),
            "NavL.fill": c("ink-2"),
            "NavI.color": muted,
            "root.effects": none,
          },
          hover: {
            "root.fill": c("subtle"),
            "NavL.fill": ink,
            "NavI.color": c("ink-2"),
            "root.effects": none,
          },
          active: {
            "root.fill": c("surface"),
            "NavL.fill": ink,
            "NavI.color": c("accent"),
            "root.effects": b.shadow("elevation-1"),
          },
        }),
      },
      root: {
        dir: "row",
        w: 216,
        gap: 10,
        align: "center",
        pad: [7, 10],
        radius: r("md"),
        fill: c("bg"),
      },
    },
    (root) => {
      b.icon(root, "house", 17, muted, { key: "NavI" })
      b.text(root, "Item", b.ty("label"), c("ink-2"), {
        key: "NavL",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(root, "0", b.ty("caption", { weight: 600 }), muted, { key: "NavC", visible: false })
    },
  )

  const step = b.component(
    "Step",
    {
      key: "Step",
      section: "Navigation",
      description: "One step of a horizontal stepper. Hide the line on the last step.",
      props: {
        number: p.text("StpN", "1"),
        label: p.text("StpL", "Step"),
        detail: p.text("StpD", "Detail"),
        line: p.bool("StpLine", true),
        state: p.variants({
          done: {
            "StpC.fill": c("accent"),
            "StpC.stroke": { paint: c("accent"), width: 1.5 },
            "StpN.visible": false,
            "StpI.visible": true,
            "StpL.fill": ink,
            "StpLine.fill": c("accent"),
          },
          current: {
            "StpC.fill": c("surface"),
            "StpC.stroke": { paint: c("accent"), width: 1.5 },
            "StpN.visible": true,
            "StpN.fill": c("accent"),
            "StpI.visible": false,
            "StpL.fill": ink,
            "StpLine.fill": c("border"),
          },
          upcoming: {
            "StpC.fill": c("surface"),
            "StpC.stroke": { paint: c("border-strong"), width: 1.5 },
            "StpN.visible": true,
            "StpN.fill": muted,
            "StpI.visible": false,
            "StpL.fill": muted,
            "StpLine.fill": c("border"),
          },
        }),
      },
      root: { dir: "column", w: 200, gap: 10 },
    },
    (root) => {
      const top = b.row(root, "Indicator", { w: FILL, gap: 8, align: "center" })
      const circle = b.row(top, "Circle", {
        key: "StpC",
        w: 26,
        h: 26,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("accent"),
        stroke: { paint: c("accent"), width: 1.5 },
      })
      b.icon(circle, "check", 14, c("on-accent"), { key: "StpI" })
      b.text(circle, "1", b.ty("label", { size: 12, weight: 600 }), c("accent"), {
        key: "StpN",
        visible: false,
      })
      b.rect(top, "Line", { key: "StpLine", w: FILL, h: 2, radius: 1, fill: c("accent") })
      const t = b.col(root, "Text", { w: FILL, gap: 2, pad: [0, 12, 0, 0] })
      b.text(t, "Step", b.ty("label", { size: 13 }), ink, { key: "StpL" })
      b.text(t, "Detail", b.ty("caption"), muted, { key: "StpD" })
    },
  )
  showcase("Navigation", "Stepper, breadcrumb, pagination", (cell) => {
    const steps = b.row(cell, "Stepper", { gap: 0 })
    for (const [n, label, detail, state] of [
      ["1", "Client", "Okonkwo Architects", "done"],
      ["2", "Line items", "4 items, £9,600", "done"],
      ["3", "Schedule", "Send on Oct 15", "current"],
      ["4", "Review", "Check and send", "upcoming"],
    ] as const)
      b.use(steps, step, {
        args: { number: n, label, detail, state, ...(n === "4" ? { line: false } : {}) },
      })
    b.use(cell, breadcrumb)
    b.use(cell, breadcrumb, { args: { depth: "two", first: "Settings", second: "Invoices" } })
    b.use(cell, pagination, { args: { page: "second" } })
  })

  const sidebar = b.component(
    "Sidebar",
    {
      key: "Side",
      section: "Navigation",
      description: "App navigation. Set one Nav item to active per screen.",
      root: {
        dir: "column",
        w: 248,
        h: 900,
        justify: "between",
        pad: [20, 16],
        fill: c("bg"),
        stroke: { paint: c("border"), width: { r: 1 } },
      },
    },
    (root) => {
      const top = b.col(root, "Top", { w: FILL, gap: s(6) })
      const brand = b.row(top, "Brand", { gap: 10, align: "center", pad: [0, 6] })
      const mark = b.row(brand, "Mark", {
        w: 28,
        h: 28,
        radius: 8,
        fill: c("accent"),
        align: "center",
        justify: "center",
      })
      b.icon(mark, "receipt-text", 16, c("on-accent"))
      const bt = b.col(brand, "Names", { gap: 0 })
      b.text(bt, "Tallybook", b.ty("heading"), ink)
      b.text(bt, "Moss & Pike Studio", b.ty("caption"), muted)
      const nav = b.col(top, "Navigation", { w: FILL, gap: 2 })
      for (const [i, [label, icon, count]] of [
        ["Overview", "layout-dashboard", ""],
        ["Invoices", "receipt-text", "8"],
        ["Clients", "building-2", ""],
        ["Payments", "banknote", ""],
        ["Reports", "chart-column", ""],
      ].entries())
        b.use(nav, navItem, {
          key: `SideN${i + 1}`,
          props: { w: FILL },
          args: { label, ...(count ? { count, showCount: true } : {}) },
          set: { NavI: { icon } },
        })
      const bottom = b.col(root, "Bottom", { w: FILL, gap: 2 })
      b.use(bottom, navItem, {
        key: "SideSet",
        props: { w: FILL },
        args: { label: "Settings" },
        set: { NavI: { icon: "settings" } },
      })
      b.use(bottom, navItem, {
        props: { w: FILL },
        args: { label: "Help" },
        set: { NavI: { icon: "circle-help" } },
      })
    },
  )
  const sideArgs: Record<string, Record<string, string | boolean>> = {
    SideN1: { label: "Overview" },
    SideN2: { label: "Invoices", count: "8", showCount: true },
    SideN3: { label: "Clients" },
    SideN4: { label: "Payments" },
    SideN5: { label: "Reports" },
    SideSet: { label: "Settings" },
  }

  // --- Data display ----------------------------------------------------------------------------

  const tones = ["neutral", "accent", "success", "warning", "danger", "info"] as const
  const toneColors: Record<(typeof tones)[number], [string, string]> = {
    neutral: ["subtle", "ink-2"],
    accent: ["accent-soft", "accent"],
    success: ["success-soft", "success"],
    warning: ["warning-soft", "warning"],
    danger: ["danger-soft", "danger"],
    info: ["info-soft", "info"],
  }
  const badge = b.component(
    "Badge",
    {
      key: "Bdg",
      section: "Data display",
      props: {
        label: p.text("BdgL", "Badge"),
        dot: p.bool("BdgD", true),
        tone: p.variants(
          Object.fromEntries(
            tones.map((t) => {
              const [bg, fg] = toneColors[t]
              return [t, { "root.fill": c(bg), "BdgL.fill": c(fg), "BdgD.fill": c(fg) }]
            }),
          ),
        ),
      },
      root: {
        dir: "row",
        gap: 6,
        align: "center",
        pad: [2, 8],
        radius: r("pill"),
        fill: c("subtle"),
      },
    },
    (root) => {
      b.ellipse(root, "Dot", { key: "BdgD", w: 6, h: 6, fill: c("ink-2") })
      b.text(root, "Badge", b.ty("caption", { weight: 600 }), c("ink-2"), { key: "BdgL" })
    },
  )
  const statusTone = { Paid: "success", Overdue: "danger", Sent: "info", Draft: "neutral" } as const

  const tag = b.component(
    "Tag",
    {
      key: "Tag",
      section: "Data display",
      props: {
        label: p.text("TagL", "Tag"),
        removable: p.bool("TagX", true),
        state: p.variants({
          default: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border-strong") },
            "TagL.fill": c("ink-2"),
            "root.opacity": 1,
          },
          selected: {
            "root.fill": c("accent-soft"),
            "root.stroke": { paint: c("accent") },
            "TagL.fill": c("accent"),
            "root.opacity": 1,
          },
          disabled: {
            "root.fill": c("subtle"),
            "root.stroke": { paint: c("border") },
            "TagL.fill": muted,
            "root.opacity": 0.6,
          },
        }),
      },
      root: {
        dir: "row",
        gap: 6,
        align: "center",
        pad: [4, 10],
        radius: r("pill"),
        fill: c("surface"),
        stroke: { paint: c("border-strong") },
      },
    },
    (root) => {
      b.text(root, "Tag", b.ty("caption", { weight: 500, size: 13 }), c("ink-2"), { key: "TagL" })
      b.icon(root, "x", 13, muted, { key: "TagX" })
    },
  )
  showcase("Data display", "Badge and tag", (cell) => {
    const row = b.row(cell, "Badges", { gap: 8, align: "center" })
    for (const [t, label] of [
      ["neutral", "Draft"],
      ["accent", "New"],
      ["success", "Paid"],
      ["warning", "Due soon"],
      ["danger", "Overdue"],
      ["info", "Sent"],
    ] as const)
      b.use(row, badge, { args: { tone: t, label } })
    const row2 = b.row(cell, "Tags", { gap: 8, align: "center" })
    b.use(row2, tag, { args: { label: "Architecture" } })
    b.use(row2, tag, { args: { label: "Retainer", state: "selected" } })
    b.use(row2, tag, { args: { label: "Archived", state: "disabled", removable: false } })
  })

  const avatar = b.component(
    "Avatar",
    {
      key: "Av",
      section: "Data display",
      props: {
        initials: p.text("AvI", "AO"),
        size: p.variants({
          md: { "root.w": 36, "root.h": 36, "AvI.style/size": 13 },
          xs: { "root.w": 20, "root.h": 20, "AvI.style/size": 8 },
          sm: { "root.w": 28, "root.h": 28, "AvI.style/size": 11 },
          lg: { "root.w": 48, "root.h": 48, "AvI.style/size": 16 },
          xl: { "root.w": 64, "root.h": 64, "AvI.style/size": 22 },
        }),
        tone: p.variants({
          violet: { "root.fill": c("tone-1") },
          green: { "root.fill": c("tone-2") },
          amber: { "root.fill": c("tone-3") },
          rose: { "root.fill": c("tone-4") },
        }),
        shape: p.variants({
          circle: { "root.radius": r("pill") },
          square: { "root.radius": r("md") },
        }),
      },
      root: {
        dir: "row",
        w: 36,
        h: 36,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("tone-1"),
        stroke: { paint: c("surface"), width: 2 },
      },
    },
    (root) => b.text(root, "AO", b.ty("label", { size: 13, weight: 600 }), ink, { key: "AvI" }),
  )
  const avatarGroup = b.component(
    "Avatar group",
    {
      key: "AvG",
      section: "Data display",
      props: {
        more: p.text("AvGM", "+4"),
        size: p.variants({
          md: {
            "AvG1.args": { initials: "AO", tone: "violet", size: "md" },
            "AvG2.args": { initials: "LP", tone: "green", size: "md" },
            "AvG3.args": { initials: "SK", tone: "amber", size: "md" },
            "AvGC.w": 36,
            "AvGC.h": 36,
          },
          sm: {
            "AvG1.args": { initials: "AO", tone: "violet", size: "sm" },
            "AvG2.args": { initials: "LP", tone: "green", size: "sm" },
            "AvG3.args": { initials: "SK", tone: "amber", size: "sm" },
            "AvGC.w": 28,
            "AvGC.h": 28,
          },
        }),
      },
      root: { dir: "row", gap: -8, align: "center" },
    },
    (root) => {
      b.use(root, avatar, { key: "AvG1", args: { initials: "AO", tone: "violet" } })
      b.use(root, avatar, { key: "AvG2", args: { initials: "LP", tone: "green" } })
      b.use(root, avatar, { key: "AvG3", args: { initials: "SK", tone: "amber" } })
      const more = b.row(root, "More", {
        key: "AvGC",
        w: 36,
        h: 36,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("sunken"),
        stroke: { paint: c("surface"), width: 2 },
      })
      b.text(more, "+4", b.ty("caption", { weight: 600 }), c("ink-2"), { key: "AvGM" })
    },
  )
  showcase("Data display", "Avatar: size, tone, shape", (cell) => {
    const row = b.row(cell, "Sizes", { gap: 12, align: "center" })
    for (const [size, tone, init] of [
      ["xs", "violet", "AO"],
      ["sm", "green", "LP"],
      ["md", "amber", "SK"],
      ["lg", "rose", "TH"],
      ["xl", "violet", "MO"],
    ] as const)
      b.use(row, avatar, { args: { size, tone, initials: init } })
    const row2 = b.row(cell, "Shapes", { gap: 12, align: "center" })
    b.use(row2, avatar, { args: { shape: "square", initials: "OA", tone: "green", size: "lg" } })
    b.use(row2, avatarGroup)
    b.use(row2, avatarGroup, { args: { size: "sm", more: "+9" } })
  })

  const card = b.component(
    "Card",
    {
      key: "Card",
      section: "Data display",
      description: "Header plus a Body slot. Elevation flat, raised or floating.",
      props: {
        title: p.text("CardT", "Card title"),
        description: p.text("CardD", "Supporting text"),
        showDescription: p.bool("CardD", true),
        body: p.slot("CardB"),
        elevation: p.variants({
          flat: { "root.stroke": { paint: c("border") }, "root.effects": none },
          raised: {
            "root.stroke": { paint: c("border") },
            "root.effects": b.shadow("elevation-2"),
          },
          floating: {
            "root.stroke": { paint: c("surface") },
            "root.effects": b.shadow("elevation-3"),
          },
        }),
      },
      root: { dir: "column", w: 360, gap: 16, pad: 20, ...box() },
    },
    (root) => {
      const head = b.col(root, "Header", { w: FILL, gap: 4 })
      b.text(head, "Card title", b.ty("heading"), ink, { key: "CardT" })
      b.para(head, "Supporting text", b.ty("body-sm"), muted, { key: "CardD" })
      b.col(root, "Body", { key: "CardB", w: FILL, gap: 12, slot: {} })
    },
  )

  const stat = b.component(
    "Stat",
    {
      key: "Stat",
      section: "Data display",
      props: {
        label: p.text("StL", "Metric"),
        value: p.text("StV", "0"),
        delta: p.text("StD", "0%"),
        caption: p.text("StC", "vs last month"),
        trend: p.variants({
          up: { "StD.fill": c("success"), "StI.icon": "arrow-up", "StI.color": c("success") },
          down: { "StD.fill": c("danger"), "StI.icon": "arrow-down", "StI.color": c("danger") },
          flat: { "StD.fill": muted, "StI.icon": "minus", "StI.color": muted },
        }),
      },
      root: { dir: "column", w: 240, gap: 6, pad: 20, ...box(), effects: b.shadow("elevation-1") },
    },
    (root) => {
      b.text(root, "Metric", b.ty("body-sm", { weight: 500 }), muted, { key: "StL" })
      b.text(root, "0", b.ty("h2", { weight: 700 }), ink, { key: "StV" })
      const foot = b.row(root, "Delta", { gap: 4, align: "center" })
      b.icon(foot, "arrow-up", 14, c("success"), { key: "StI" })
      b.text(foot, "0%", b.ty("caption", { weight: 600 }), c("success"), { key: "StD" })
      b.text(foot, "vs last month", b.ty("caption"), muted, { key: "StC", name: "Caption" })
    },
  )
  showcase("Data display", "Card elevation and stat trends", (cell) => {
    const row = b.row(cell, "Cards", { gap: 16, align: "start" })
    for (const [elevation, title] of [
      ["flat", "Flat"],
      ["raised", "Raised"],
      ["floating", "Floating"],
    ] as const)
      b.use(row, card, {
        props: { w: 200 },
        args: { elevation, title, description: `Elevation: ${elevation}` },
      })
    const row2 = b.row(cell, "Stats", { gap: 16, align: "start" })
    for (const [trend, label, value, delta] of [
      ["up", "Paid this month", "£18,240", "12%"],
      ["down", "Overdue", "£3,030", "4%"],
      ["flat", "Average days to pay", "14", "0"],
    ] as const)
      b.use(row2, stat, { props: { w: 200 }, args: { trend, label, value, delta } })
  })

  const th = b.component(
    "Table header cell",
    {
      key: "Th",
      section: "Data display",
      props: {
        label: p.text("ThL", "Column"),
        sort: p.variants({
          none: { "ThI.visible": false, "ThL.fill": muted },
          asc: { "ThI.visible": true, "ThI.icon": "arrow-up", "ThL.fill": ink },
          desc: { "ThI.visible": true, "ThI.icon": "arrow-down", "ThL.fill": ink },
        }),
      },
      root: { dir: "row", w: 140, gap: 4, align: "center" },
    },
    (root) => {
      b.text(root, "Column", b.ty("caption", { weight: 600 }), muted, { key: "ThL" })
      b.icon(root, "arrow-down", 13, ink, { key: "ThI", visible: false })
    },
  )

  const tableRow = b.component(
    "Table row",
    {
      key: "Tr",
      section: "Data display",
      description: "Invoice row: client, number, status, due date, amount.",
      props: {
        client: p.text("TrC", "Client"),
        email: p.text("TrE", "name@client.com"),
        initials: p.text("TrAv/AvI", "OA"),
        number: p.text("TrN", "INV-0000"),
        status: p.text("TrS/BdgL", "Draft"),
        due: p.text("TrDue", "Oct 15"),
        amount: p.text("TrA", "£0.00"),
        state: p.variants({
          default: { "root.fill": c("surface"), "TrChk.args": { state: "off", showLabel: false } },
          hover: { "root.fill": c("bg"), "TrChk.args": { state: "off", showLabel: false } },
          selected: {
            "root.fill": c("accent-soft"),
            "TrChk.args": { state: "on", showLabel: false },
          },
        }),
      },
      root: {
        dir: "row",
        w: 900,
        gap: 16,
        align: "center",
        pad: [11, 20],
        fill: c("surface"),
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      b.use(root, checkbox, { key: "TrChk", args: { showLabel: false } })
      const who = b.row(root, "Client", { w: FILL, gap: 10, align: "center" })
      b.use(who, avatar, { key: "TrAv", args: { size: "sm" } })
      const names = b.col(who, "Names", { w: FILL, gap: 1 })
      b.text(names, "Client", b.ty("label"), ink, { key: "TrC" })
      b.text(names, "name@client.com", b.ty("caption"), muted, { key: "TrE" })
      b.text(root, "INV-0000", b.ty("code"), c("ink-2"), {
        key: "TrN",
        w: 110,
        grow: "fixed-width",
      })
      const st = b.row(root, "Status", { w: 100 })
      b.use(st, badge, { key: "TrS", args: { label: "Draft" } })
      b.text(root, "Oct 15", b.ty("body-sm"), c("ink-2"), {
        key: "TrDue",
        w: 90,
        grow: "fixed-width",
      })
      b.text(root, "£0.00", b.ty("label", { align: "right" }), ink, {
        key: "TrA",
        w: 100,
        grow: "fixed-width",
      })
      b.icon(root, "ellipsis", 16, muted)
    },
  )

  const listItem = b.component(
    "List item",
    {
      key: "Li",
      section: "Data display",
      props: {
        title: p.text("LiT", "Title"),
        subtitle: p.text("LiS", "Subtitle"),
        meta: p.text("LiM", "Meta"),
        state: p.variants({
          default: {
            "root.fill": c("surface"),
            "LiBox.fill": c("subtle"),
            "LiIc.color": c("ink-2"),
          },
          hover: { "root.fill": c("bg"), "LiBox.fill": c("subtle"), "LiIc.color": c("ink-2") },
          selected: {
            "root.fill": c("accent-soft"),
            "LiBox.fill": c("surface"),
            "LiIc.color": c("accent"),
          },
        }),
      },
      root: {
        dir: "row",
        w: 360,
        gap: 12,
        align: "center",
        pad: [10, 12],
        radius: r("md"),
        fill: c("surface"),
      },
    },
    (root) => {
      const ic = b.row(root, "Icon", {
        key: "LiBox",
        w: 36,
        h: 36,
        align: "center",
        justify: "center",
        radius: r("md"),
        fill: c("subtle"),
      })
      b.icon(ic, "file-text", 18, c("ink-2"), { key: "LiIc" })
      const t = b.col(root, "Text", { w: FILL, gap: 1 })
      b.text(t, "Title", b.ty("label"), ink, { key: "LiT" })
      b.text(t, "Subtitle", b.ty("caption"), muted, { key: "LiS" })
      b.text(root, "Meta", b.ty("caption"), muted, { key: "LiM" })
      b.icon(root, "chevron-right", 16, muted)
    },
  )

  const progress = b.component(
    "Progress bar",
    {
      key: "Prog",
      section: "Data display",
      description: "Set the Done and Left weights to the percentage.",
      props: {
        tone: p.variants({
          accent: { "PrA.fill": c("accent") },
          success: { "PrA.fill": c("success") },
          warning: { "PrA.fill": c("warning") },
          danger: { "PrA.fill": c("danger") },
        }),
        size: p.variants({
          md: { "root.h": 8, "PrA.h": 8, "PrB.h": 8 },
          sm: { "root.h": 4, "PrA.h": 4, "PrB.h": 4 },
        }),
      },
      root: { dir: "row", w: 240, h: 8, radius: r("pill"), fill: c("sunken"), clip: true },
    },
    (root) => {
      b.rect(root, "Done", { key: "PrA", w: { mode: "fill", weight: 60 }, h: 8, fill: c("accent") })
      b.rect(root, "Left", { key: "PrB", w: { mode: "fill", weight: 40 }, h: 8, fill: c("sunken") })
    },
  )
  const pct = (n: number) => ({
    PrA: { visible: n > 0, w: { mode: "fill", weight: Math.max(n, 1) } },
    PrB: { visible: n < 100, w: { mode: "fill", weight: Math.max(100 - n, 1) } },
  })

  const spinner = b.component(
    "Spinner",
    {
      key: "Spin",
      section: "Data display",
      props: {
        size: p.variants({
          md: { "root.w": 24, "root.h": 24, "SpT.w": 24, "SpT.h": 24, "SpA.w": 24, "SpA.h": 24 },
          sm: { "root.w": 16, "root.h": 16, "SpT.w": 16, "SpT.h": 16, "SpA.w": 16, "SpA.h": 16 },
          lg: { "root.w": 36, "root.h": 36, "SpT.w": 36, "SpT.h": 36, "SpA.w": 36, "SpA.h": 36 },
        }),
        tone: p.variants({
          accent: { "SpA.fill": c("accent") },
          neutral: { "SpA.fill": c("ink-2") },
        }),
      },
      root: { dir: "row", w: 24, h: 24, align: "center", justify: "center" },
    },
    (root) => {
      // Track and arc share the cell: the arc is laid over the track as a flagged overlay.
      b.ellipse(root, "Track", { key: "SpT", w: 24, h: 24, innerRadius: 0.72, fill: c("sunken") })
      b.ellipse(root, "Arc", {
        key: "SpA",
        w: 24,
        h: 24,
        innerRadius: 0.72,
        startAngle: 90,
        sweepAngle: -100,
        fill: c("accent"),
        position: "absolute",
        x: 0,
        y: 0,
        meta: { "kimo.template.overlay": true },
      })
    },
  )

  const skeleton = b.component(
    "Skeleton",
    {
      key: "Skel",
      section: "Data display",
      props: {
        shape: p.variants({
          line: { "root.w": 200, "root.h": 12, "root.radius": r("xs") },
          block: { "root.w": 200, "root.h": 80, "root.radius": r("md") },
          circle: { "root.w": 36, "root.h": 36, "root.radius": r("pill") },
        }),
      },
      root: { dir: "row", w: 200, h: 12, radius: r("xs"), fill: c("sunken"), clip: true },
    },
    (root) => b.rect(root, "Shine", { w: 48, h: FILL, fill: c("subtle") }),
  )

  const kbd = b.component(
    "Kbd",
    {
      key: "Kbd",
      section: "Data display",
      props: {
        keys: p.text("KbdL", "Ctrl K"),
        size: p.variants({
          md: { "root.layout/pad": [2, 6], "KbdL.style/size": 12 },
          sm: { "root.layout/pad": [1, 4], "KbdL.style/size": 11 },
        }),
      },
      root: {
        dir: "row",
        align: "center",
        pad: [2, 6],
        radius: r("xs"),
        fill: c("subtle"),
        stroke: { paint: c("border-strong"), width: { b: 2, t: 1, l: 1, r: 1 } },
      },
    },
    (root) => b.text(root, "Ctrl K", b.ty("code"), c("ink-2"), { key: "KbdL" }),
  )
  showcase("Data display", "Loading and progress", (cell) => {
    const row = b.row(cell, "Spinners", { gap: 16, align: "center" })
    for (const size of ["sm", "md", "lg"]) b.use(row, spinner, { args: { size } })
    b.use(row, spinner, { args: { size: "md", tone: "neutral" } })
    b.use(row, kbd)
    b.use(row, kbd, { args: { keys: "Enter", size: "sm" } })
    for (const [tone, n] of [
      ["accent", 60],
      ["success", 100],
      ["warning", 82],
      ["danger", 24],
    ] as const)
      b.use(cell, progress, { args: { tone }, set: pct(n) })
    const sk = b.row(cell, "Skeleton", { gap: 12, align: "center" })
    b.use(sk, skeleton, { args: { shape: "circle" } })
    const lines = b.col(sk, "Lines", { gap: 8 })
    b.use(lines, skeleton, { props: { w: 180 } })
    b.use(lines, skeleton, { props: { w: 120 } })
  })

  // --- Feedback --------------------------------------------------------------------------------

  const alertTones = {
    info: ["info-soft", "info", "info"],
    success: ["success-soft", "success", "circle-check"],
    warning: ["warning-soft", "warning", "triangle-alert"],
    danger: ["danger-soft", "danger", "circle-alert"],
  } as const
  const alert = b.component(
    "Alert",
    {
      key: "Alert",
      section: "Feedback",
      props: {
        title: p.text("AlT", "Title"),
        body: p.text("AlB", "Body"),
        dismissible: p.bool("AlX", true),
        tone: p.variants(
          Object.fromEntries(
            Object.entries(alertTones).map(([k, [bg, fg, icon]]) => [
              k,
              {
                "root.fill": c(bg),
                "root.stroke": { paint: c(fg), width: { l: 3 } },
                "AlI.icon": icon,
                "AlI.color": c(fg),
              },
            ]),
          ),
        ),
      },
      root: {
        dir: "row",
        w: 440,
        gap: 12,
        align: "start",
        pad: [12, 14],
        radius: r("md"),
        fill: c("info-soft"),
        stroke: { paint: c("info"), width: { l: 3 } },
      },
    },
    (root) => {
      b.icon(root, "info", 18, c("info"), { key: "AlI" })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Title", b.ty("label"), ink, { key: "AlT" })
      b.para(t, "Body", b.ty("body-sm"), c("ink-2"), { key: "AlB" })
      b.icon(root, "x", 16, muted, { key: "AlX" })
    },
  )
  showcase("Feedback", "Alert tones", (cell) => {
    for (const [tone, title, body] of [
      [
        "info",
        "Exchange rates update at 06:00 UTC",
        "Invoices in other currencies use the rate from the day you send them.",
      ],
      ["success", "Payment received", "Halcyon Coffee Roasters paid INV-1042, £4,800.00."],
      [
        "warning",
        "Card expires in 9 days",
        "Update the card on file to keep automatic payouts running.",
      ],
      [
        "danger",
        "Couldn't send 2 invoices",
        "The client emails bounced. Check the addresses and send again.",
      ],
    ] as const)
      b.use(cell, alert, { args: { tone, title, body } })
  })

  const toast = b.component(
    "Toast",
    {
      key: "Toast",
      section: "Feedback",
      props: {
        message: p.text("ToM", "Message"),
        action: p.text("ToA", "Undo"),
        showAction: p.bool("ToA", true),
        tone: p.variants({
          neutral: { "ToI.icon": "info", "ToI.color": c("inverse-muted") },
          success: { "ToI.icon": "circle-check", "ToI.color": c("success") },
          danger: { "ToI.icon": "circle-alert", "ToI.color": c("danger") },
        }),
      },
      root: {
        dir: "row",
        w: 380,
        gap: 12,
        align: "center",
        pad: [12, 14],
        radius: r("lg"),
        fill: c("inverse"),
        effects: b.shadow("elevation-3"),
      },
    },
    (root) => {
      b.icon(root, "info", 18, c("inverse-muted"), { key: "ToI" })
      b.para(root, "Message", b.ty("body-sm"), c("on-inverse"), { key: "ToM" })
      b.text(root, "Undo", b.ty("label", { size: 13 }), c("on-inverse"), { key: "ToA" })
      b.icon(root, "x", 15, c("inverse-muted"))
    },
  )
  showcase("Feedback", "Toast tones", (cell) => {
    b.use(cell, toast, { args: { tone: "neutral", message: "Draft saved", showAction: false } })
    b.use(cell, toast, {
      args: { tone: "success", message: "INV-1044 sent to Okonkwo Architects", action: "View" },
    })
    b.use(cell, toast, {
      args: {
        tone: "danger",
        message: "Couldn't reach Stripe. Payouts are paused.",
        action: "Retry",
      },
    })
  })

  const tooltip = b.component(
    "Tooltip",
    {
      key: "Tip",
      section: "Feedback",
      props: {
        text: p.text("TipL", "Tooltip"),
        placement: p.variants({
          top: { "TipUp.visible": false, "TipDn.visible": true },
          bottom: { "TipUp.visible": true, "TipDn.visible": false },
        }),
      },
      root: { dir: "column", align: "center" },
    },
    (root) => {
      b.add(root, {
        type: "polygon",
        key: "TipUp",
        name: "Arrow up",
        sides: 3,
        w: 12,
        h: 6,
        fill: c("inverse"),
        visible: false,
      })
      const body = b.row(root, "Body", {
        gap: 8,
        align: "center",
        pad: [6, 10],
        radius: r("sm"),
        fill: c("inverse"),
      })
      b.text(body, "Tooltip", b.ty("caption", { weight: 500 }), c("on-inverse"), { key: "TipL" })
      b.add(root, {
        type: "polygon",
        key: "TipDn",
        name: "Arrow down",
        sides: 3,
        w: 12,
        h: 6,
        flipY: true,
        fill: c("inverse"),
      })
    },
  )

  const menuItem = b.component(
    "Menu item",
    {
      key: "Mi",
      section: "Feedback",
      props: {
        label: p.text("MiL", "Item"),
        shortcut: p.text("MiK", "Ctrl E"),
        showShortcut: p.bool("MiK", true),
        state: p.variants({
          default: {
            "root.fill": c("surface"),
            "MiL.fill": ink,
            "MiI.color": c("ink-2"),
            "root.opacity": 1,
          },
          hover: { "root.fill": c("subtle"), "MiL.fill": ink, "MiI.color": ink, "root.opacity": 1 },
          danger: {
            "root.fill": c("surface"),
            "MiL.fill": c("danger"),
            "MiI.color": c("danger"),
            "root.opacity": 1,
          },
          disabled: {
            "root.fill": c("surface"),
            "MiL.fill": muted,
            "MiI.color": muted,
            "root.opacity": 0.6,
          },
        }),
      },
      root: {
        dir: "row",
        w: 220,
        gap: 10,
        align: "center",
        pad: [7, 10],
        radius: r("sm"),
        fill: c("surface"),
      },
    },
    (root) => {
      b.icon(root, "pencil", 16, c("ink-2"), { key: "MiI" })
      b.text(root, "Item", b.ty("body-sm"), ink, { key: "MiL", w: FILL, grow: "fixed-width" })
      b.text(root, "Ctrl E", b.ty("caption"), muted, { key: "MiK" })
    },
  )
  const menu = b.component(
    "Menu",
    {
      key: "Menu",
      section: "Feedback",
      description: "Fill the Items slot with Menu items and dividers.",
      props: {
        items: p.slot("MenuI"),
        width: p.variants({ md: { "root.w": 232 }, lg: { "root.w": 280 } }),
      },
      root: {
        dir: "column",
        w: 232,
        pad: 4,
        ...box({ radius: r("lg") }),
        effects: b.shadow("elevation-3"),
      },
    },
    (root) =>
      b.col(root, "Items", { key: "MenuI", w: FILL, gap: 2, slot: { suggested: [menuItem] } }),
  )
  function menuItems(into: Slot) {
    for (const [label, icon, key, state] of [
      ["Edit invoice", "pencil", "E", "hover"],
      ["Duplicate", "copy", "D", "default"],
      ["Download PDF", "download", "P", "default"],
      ["Send reminder", "send", "", "disabled"],
    ] as const)
      b.use(into, menuItem, {
        props: { w: FILL },
        args: { label, state, ...(key ? { shortcut: `Ctrl ${key}` } : { showShortcut: false }) },
        set: { MiI: { icon } },
      })
    b.rect(into, "Divider", { w: FILL, h: 1, fill: c("border") })
    b.use(into, menuItem, {
      props: { w: FILL },
      args: { label: "Delete", state: "danger", showShortcut: false },
      set: { MiI: { icon: "trash-2" } },
    })
  }
  showcase("Feedback", "Menu and tooltips", (cell) => {
    const row = b.row(cell, "Row", { gap: 32, align: "start" })
    b.use(row, menu, { slots: { MenuI: menuItems } })
    const tips = b.col(row, "Tooltips", { gap: 20, align: "center" })
    b.use(tips, tooltip, { args: { text: "Duplicate invoice", placement: "top" } })
    b.use(tips, iconButton, { args: { variant: "outline" }, set: { IcI: { icon: "copy" } } })
    b.use(tips, tooltip, { args: { text: "Download PDF", placement: "bottom" } })
  })

  const modal = b.component(
    "Modal",
    {
      key: "Modal",
      section: "Feedback",
      description: "Dialog with a Body slot. Put it on a scrim overlay on screens.",
      props: {
        title: p.text("MdT", "Title"),
        description: p.text("MdD", "Description"),
        body: p.slot("MdB"),
        cancel: p.text("MdCancel/BtnL", "Cancel"),
        confirm: p.text("MdOk/BtnL", "Confirm"),
        size: p.variants({ md: { "root.w": 480 }, sm: { "root.w": 400 }, lg: { "root.w": 640 } }),
      },
      root: {
        dir: "column",
        w: 480,
        radius: r("xl"),
        fill: c("surface"),
        effects: b.shadow("elevation-4"),
        clip: true,
      },
    },
    (root) => {
      const head = b.row(root, "Header", { w: FILL, gap: 12, align: "start", pad: [20, 20, 4, 24] })
      const t = b.col(head, "Text", { w: FILL, gap: 6 })
      b.text(t, "Title", b.ty("h3"), ink, { key: "MdT" })
      b.para(t, "Description", b.ty("body"), muted, { key: "MdD" })
      b.use(head, iconButton, {
        args: { variant: "ghost", size: "sm" },
        set: { IcI: { icon: "x" } },
      })
      b.col(root, "Body", { key: "MdB", w: FILL, gap: 12, pad: [16, 24], slot: {} })
      const foot = b.row(root, "Footer", {
        w: FILL,
        gap: 8,
        justify: "end",
        pad: [14, 24],
        fill: c("bg"),
        stroke: { paint: c("border"), width: { t: 1 } },
      })
      b.use(foot, button, { key: "MdCancel", args: { label: "Cancel", variant: "outline" } })
      b.use(foot, button, { key: "MdOk", args: { label: "Confirm" } })
    },
  )

  const emptyState = b.component(
    "Empty state",
    {
      key: "Empty",
      section: "Feedback",
      props: {
        title: p.text("EmT", "Nothing here yet"),
        body: p.text("EmB", "Body"),
        action: p.text("EmA/BtnL", "Action"),
        showAction: p.bool("EmAW", true),
        tone: p.variants({
          accent: { "EmC.fill": c("accent-soft"), "EmI.color": c("accent") },
          neutral: { "EmC.fill": c("subtle"), "EmI.color": c("ink-2") },
          danger: { "EmC.fill": c("danger-soft"), "EmI.color": c("danger") },
        }),
      },
      root: { dir: "column", w: 360, gap: 16, align: "center", pad: [32, 24] },
    },
    (root) => {
      const circle = b.row(root, "Icon", {
        key: "EmC",
        w: 56,
        h: 56,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("accent-soft"),
      })
      b.icon(circle, "receipt-text", 24, c("accent"), { key: "EmI" })
      const t = b.col(root, "Text", { w: FILL, gap: 6 })
      b.para(t, "Nothing here yet", b.ty("heading", { align: "center" }), ink, { key: "EmT" })
      b.para(t, "Body", b.ty("body-sm", { align: "center" }), muted, { key: "EmB" })
      const act = b.row(root, "Action", { key: "EmAW" })
      b.use(act, button, { key: "EmA", args: { label: "Action", variant: "outline" } })
    },
  )

  const topNav = b.component(
    "Page header",
    {
      key: "TopNav",
      section: "Navigation",
      description: "Breadcrumb, title and an Actions slot.",
      props: {
        title: p.text("TnT", "Page title"),
        crumb: p.text("TnC", "Workspace"),
        actions: p.slot("TnA"),
      },
      root: {
        dir: "row",
        w: 1192,
        gap: 16,
        align: "end",
        pad: [28, 32, 20, 32],
        fill: c("surface"),
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const t = b.col(root, "Title", { w: FILL, gap: 4 })
      b.text(t, "Workspace", b.ty("body-sm"), muted, { key: "TnC" })
      b.text(t, "Page title", b.ty("h2"), ink, { key: "TnT" })
      b.row(root, "Actions", {
        key: "TnA",
        gap: 8,
        align: "center",
        slot: { suggested: [button, btnOutline] },
      })
    },
  )

  // --- Foundations: icons ----------------------------------------------------------------------

  const priv = b as unknown as {
    foundations(): void
    sectionIn(parent: string, name: string, items?: Record<string, unknown>): string
  }
  const baseFoundations = priv.foundations.bind(b)
  priv.foundations = () => {
    baseFoundations()
    const items = priv.sectionIn(b.id("Foundations"), "Icons", { gap: 12, crossGap: 12 })
    for (const icon of [
      "house",
      "layout-dashboard",
      "receipt-text",
      "file-text",
      "building-2",
      "banknote",
      "credit-card",
      "wallet",
      "chart-column",
      "users",
      "user",
      "settings",
      "search",
      "list-filter",
      "arrow-up-down",
      "plus",
      "pencil",
      "copy",
      "trash-2",
      "download",
      "upload",
      "send",
      "mail",
      "bell",
      "calendar",
      "clock",
      "paperclip",
      "link",
      "external-link",
      "share-2",
      "check",
      "x",
      "chevron-down",
      "chevron-right",
      "arrow-right",
      "ellipsis",
      "info",
      "circle-check",
      "triangle-alert",
      "circle-alert",
      "circle-help",
      "lock",
      "eye",
      "globe",
      "log-out",
      "moon",
    ]) {
      const tile = b.col(items, icon, {
        w: 120,
        gap: 10,
        align: "center",
        pad: [18, 8, 14, 8],
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      })
      b.icon(tile, icon, 22, ink)
      b.text(tile, icon, b.ty("caption"), muted)
    }
  }

  // --- Cover -----------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Design system",
    title: "Basalt UI kit",
    description:
      "38 components with variant props, light and dark tokens, and five page patterns. Published as a library, so your files can import it.",
    preview: (area) => {
      const top = b.row(area, "Top", { w: FILL, gap: 24, align: "start" })
      const left = b.col(top, "Controls", { w: FILL, gap: 18 })
      const btns = b.row(left, "Buttons", { gap: 8, align: "center" })
      b.use(btns, button, { args: { label: "New invoice", iconStart: true } })
      b.use(btns, button, { args: { label: "Export", variant: "outline", iconEnd: true } })
      b.use(btns, iconButton, { set: { IcI: { icon: "pencil" } } })
      b.use(left, textField, {
        props: { w: FILL },
        args: {
          label: "Billing email",
          value: "accounts@okonkwo.co.uk",
          hint: "We send invoices to this address.",
          state: "focus",
        },
      })
      b.use(left, segmented, { args: { selected: "second" } })
      const toggles = b.row(left, "Toggles", { gap: 20, align: "center" })
      b.use(toggles, toggle, { args: { label: "Reminders" } })
      b.use(toggles, checkbox, { args: { label: "Add VAT", state: "on" } })
      b.use(toggles, radio, { args: { label: "Net 30", state: "on" } })
      const badges = b.row(left, "Badges", { gap: 8, align: "center" })
      for (const [t, label] of [
        ["success", "Paid"],
        ["info", "Sent"],
        ["danger", "Overdue"],
        ["neutral", "Draft"],
      ] as const)
        b.use(badges, badge, { args: { tone: t, label } })
      const right = b.col(top, "Cards", { w: 260, gap: 16 })
      b.use(right, stat, {
        props: { w: FILL },
        args: { label: "Paid this month", value: "£18,240", delta: "12%" },
      })
      b.use(right, menu, { props: { w: FILL }, slots: { MenuI: menuItems } })
      b.use(area, toast, {
        props: { w: FILL },
        args: { tone: "success", message: "INV-1044 sent to Okonkwo Architects", action: "View" },
      })
      const bottom = b.row(area, "Bottom", { w: FILL, gap: 24, align: "center" })
      b.use(bottom, tabs, {
        props: { w: FILL },
        args: {
          tab1: "Overview",
          tab2: "Invoices",
          tab3: "Clients",
          tab4: "Payments",
          active: "second",
        },
      })
      b.use(bottom, avatarGroup)
      b.use(area, alert, {
        props: { w: FILL },
        args: {
          tone: "warning",
          title: "Card expires in 9 days",
          body: "Update the card on file to keep automatic payouts running.",
        },
      })
    },
  })

  // --- Patterns --------------------------------------------------------------------------------

  const patterns = b.page("Patterns")
  function shell(
    name: string,
    active: string,
    title: string,
    crumb: string,
    actions?: (into: Slot) => void,
  ) {
    const scr = b.screen(patterns, name, { dir: "row", w: 1440, h: 900, fill: c("bg") })
    b.use(scr, sidebar, {
      props: { h: FILL },
      set: { [active]: { args: { ...sideArgs[active], state: "active" } } },
    })
    const main = b.col(scr, "Main", { w: FILL, h: FILL, fill: c("bg") })
    b.use(main, topNav, {
      props: { w: FILL },
      args: { title, crumb },
      ...(actions ? { slots: { TnA: actions } } : {}),
    })
    const content = b.col(main, "Content", {
      w: FILL,
      h: FILL,
      gap: s(6),
      pad: [28, 32],
      clip: true,
    })
    return { scr, content }
  }
  const invoices: [
    string,
    string,
    string,
    string,
    "Paid" | "Overdue" | "Sent" | "Draft",
    string,
    string,
    string,
  ][] = [
    [
      "Halcyon Coffee Roasters",
      "finance@halcyoncoffee.com",
      "HC",
      "INV-1042",
      "Paid",
      "Sep 12",
      "£4,800.00",
      "green",
    ],
    [
      "Brightwater Dental",
      "accounts@brightwaterdental.co.uk",
      "BD",
      "INV-1043",
      "Overdue",
      "Sep 30",
      "£2,150.00",
      "rose",
    ],
    [
      "Okonkwo Architects",
      "accounts@okonkwo.co.uk",
      "OA",
      "INV-1044",
      "Sent",
      "Oct 15",
      "£9,600.00",
      "violet",
    ],
    [
      "Lumen Bikes",
      "hello@lumenbikes.com",
      "LB",
      "INV-1045",
      "Draft",
      "Not sent",
      "£1,275.00",
      "amber",
    ],
    [
      "Saltmarsh Brewing",
      "ap@saltmarshbrewing.com",
      "SB",
      "INV-1046",
      "Paid",
      "Oct 1",
      "£3,420.00",
      "green",
    ],
    [
      "Penrose Library Trust",
      "grants@penroselibrary.org",
      "PL",
      "INV-1047",
      "Sent",
      "Oct 20",
      "£6,000.00",
      "violet",
    ],
    [
      "Fieldnote Press",
      "studio@fieldnotepress.com",
      "FP",
      "INV-1048",
      "Overdue",
      "Oct 2",
      "£880.00",
      "rose",
    ],
    [
      "Juniper Yoga",
      "team@juniperyoga.co.uk",
      "JY",
      "INV-1049",
      "Sent",
      "Oct 24",
      "£1,940.00",
      "amber",
    ],
  ]
  function invoiceRow(parent: string, inv: (typeof invoices)[number], state = "default") {
    const [client, email, init, number, status, due, amount, tone] = inv
    b.use(parent, tableRow, {
      props: { w: FILL },
      args: { client, email, initials: init, number, status, due, amount, state },
      set: {
        TrAv: { args: { initials: init, size: "sm", tone } },
        TrS: { args: { label: status, tone: statusTone[status] } },
      },
    })
  }

  // Form
  {
    const { content } = shell("Form", "SideN3", "New client", "Clients", (into) => {
      b.use(into, button, { args: { label: "Cancel", variant: "outline" } })
      b.use(into, button, { args: { label: "Save client" } })
    })
    const sections: [string, string, (col: string) => void][] = [
      [
        "Company",
        "Shown on every invoice you send this client.",
        (col) => {
          b.use(col, textField, {
            props: { w: FILL },
            args: { label: "Company name", value: "Okonkwo Architects", showHint: false },
          })
          b.use(col, textField, {
            props: { w: FILL },
            args: {
              label: "Billing email",
              value: "accounts@okonkwo",
              hint: "Enter an email like name@company.com.",
              state: "error",
            },
          })
          const two = b.row(col, "Location", { w: FILL, gap: 16 })
          b.use(two, select, {
            props: { w: 302 },
            args: { label: "Country", value: "United Kingdom" },
          })
          b.use(two, select, {
            props: { w: 302 },
            args: { label: "Currency", value: "GBP, British pound" },
          })
        },
      ],
      [
        "Payment terms",
        "When invoices for this client are due.",
        (col) => {
          const radios = b.row(col, "Terms", { gap: 24, align: "center" })
          for (const [label, state] of [
            ["Due on receipt", "off"],
            ["Net 15", "off"],
            ["Net 30", "on"],
            ["Net 60", "off"],
          ] as const)
            b.use(radios, radio, { args: { label, state } })
          b.use(col, checkbox, {
            args: { label: "Send a reminder 3 days before the due date", state: "on" },
          })
          b.use(col, toggle, { args: { label: "Add VAT at 20%", state: "on" } })
        },
      ],
      [
        "Notes",
        "Only your team sees these.",
        (col) =>
          b.use(col, textarea, {
            props: { w: FILL },
            args: {
              label: "Internal notes",
              value:
                "Pays by bank transfer within a week. Send invoices to Tola, copy Femi on anything over £5,000.",
              hint: "102 / 500",
            },
          }),
      ],
    ]
    for (const [i, [title, desc, fillCol]] of sections.entries()) {
      const row = b.row(content, title, {
        w: FILL,
        gap: 48,
        align: "start",
        pad: [0, 0, 24, 0],
        ...(i < sections.length - 1 ? { stroke: { paint: c("border"), width: { b: 1 } } } : {}),
      })
      const t = b.col(row, "Intro", { w: 280, gap: 4 })
      b.text(t, title, b.ty("heading"), ink)
      b.para(t, desc, b.ty("body-sm"), muted)
      const col = b.col(row, "Fields", { w: 620, gap: 16 })
      fillCol(col)
    }
  }

  // Empty states
  {
    const { content } = shell("Empty states", "SideN2", "Invoices", "Moss & Pike Studio", (into) =>
      b.use(into, button, { args: { label: "New invoice", iconStart: true } }),
    )
    const grid2 = b.col(content, "Grid", { w: FILL, h: FILL, gap: s(6) })
    const rows = [
      b.row(grid2, "Row 1", { w: FILL, h: FILL, gap: s(6) }),
      b.row(grid2, "Row 2", { w: FILL, h: FILL, gap: s(6) }),
    ]
    const cards: [string, string, string, string, string, string][] = [
      [
        "First use",
        "accent",
        "receipt-text",
        "No invoices yet",
        "Create your first invoice, or import the ones you sent last year as a CSV.",
        "Create invoice",
      ],
      [
        "No results",
        "neutral",
        "search-x",
        "No invoices match “brightwater dentist”",
        "Check the spelling or clear the filters to see all 64 invoices.",
        "Clear filters",
      ],
      [
        "Error",
        "danger",
        "wifi-off",
        "Couldn't load payments",
        "Stripe didn't respond. Your data is safe; try again in a minute.",
        "Try again",
      ],
    ]
    cards.forEach(([label, tone, icon, title, body, action], i) => {
      const panel = b.col(rows[i < 2 ? 0 : 1] as string, label, {
        w: 552,
        h: FILL,
        gap: 0,
        align: "center",
        justify: "center",
        ...box(),
      })
      b.text(panel, label.toUpperCase(), b.ty("overline"), muted)
      b.use(panel, emptyState, {
        args: { tone, title, body, action },
        set: { EmI: { icon } },
      })
    })
    const loading = b.col(rows[1] as string, "Loading", {
      w: 552,
      h: FILL,
      gap: 16,
      pad: 32,
      align: "center",
      justify: "center",
      ...box(),
    })
    b.text(loading, "LOADING", b.ty("overline"), muted)
    for (let i = 0; i < 3; i++) {
      const row = b.row(loading, `Row ${i + 1}`, { w: FILL, gap: 12, align: "center" })
      b.use(row, skeleton, { args: { shape: "circle" } })
      const lines = b.col(row, "Lines", { w: FILL, gap: 8 })
      b.use(lines, skeleton, { props: { w: 220 } })
      b.use(lines, skeleton, { props: { w: 140 } })
      b.use(row, skeleton, { props: { w: 72 } })
    }
    const sp = b.row(loading, "Spinner", {
      w: FILL,
      gap: 10,
      align: "center",
      justify: "center",
      pad: [8, 0, 0, 0],
    })
    b.use(sp, spinner, { args: { size: "sm" } })
    b.text(sp, "Loading invoices…", b.ty("body-sm"), muted)
  }

  // Settings
  {
    const { content } = shell("Settings", "SideSet", "Settings", "Moss & Pike Studio")
    const cols = b.row(content, "Columns", { w: FILL, h: FILL, gap: s(8), align: "start" })
    const sub = b.col(cols, "Sections", { w: 220, gap: 2 })
    for (const [title, icon, state] of [
      ["Profile", "user", "default"],
      ["Workspace", "building-2", "default"],
      ["Invoices", "receipt-text", "active"],
      ["Payments", "credit-card", "default"],
      ["Notifications", "bell", "default"],
      ["Members", "users", "default"],
    ] as const)
      b.use(sub, navItem, {
        props: { w: FILL },
        args: { label: title, state },
        set: { NavI: { icon } },
      })
    const main = b.col(cols, "Settings", { w: FILL, gap: s(6) })
    b.use(main, alert, {
      props: { w: FILL },
      args: {
        tone: "info",
        title: "Changes apply to new invoices",
        body: "Invoices you already sent keep their number, terms and footer.",
      },
    })
    const defaults = b.col(main, "Invoice defaults", { w: FILL, gap: 16, pad: 24, ...box() })
    b.text(defaults, "Invoice defaults", b.ty("heading"), ink)
    const r1 = b.row(defaults, "Numbering", { w: FILL, gap: 16 })
    b.use(r1, textField, {
      props: { w: 260 },
      args: { label: "Number prefix", value: "MP-", hint: "Next invoice: MP-1050" },
    })
    b.use(r1, select, { props: { w: 260 }, args: { label: "Default terms", value: "Net 30" } })
    b.use(r1, select, {
      props: { w: 260 },
      args: { label: "Currency", value: "GBP, British pound" },
    })
    const rem = b.col(main, "Reminders", { w: FILL, gap: 0, pad: [8, 24], ...box() })
    for (const [title, desc, state] of [
      [
        "Remind clients before the due date",
        "Sends a short email 3 days before an invoice is due.",
        "on",
      ],
      [
        "Remind clients after the due date",
        "Sends on day 1, 7 and 14 after the due date, then stops.",
        "on",
      ],
      [
        "Copy me on reminders",
        "You get a copy of every reminder email at gabriel@mossandpike.studio.",
        "off",
      ],
    ] as const) {
      const row = b.row(rem, title, {
        w: FILL,
        gap: 24,
        align: "center",
        pad: [14, 0],
        ...(title.startsWith("Copy") ? {} : { stroke: { paint: c("border"), width: { b: 1 } } }),
      })
      const t = b.col(row, "Text", { w: FILL, gap: 2 })
      b.text(t, title, b.ty("label"), ink)
      b.text(t, desc, b.ty("body-sm"), muted)
      b.use(row, toggle, { args: { state, showLabel: false } })
    }
    const danger = b.row(main, "Danger zone", {
      w: FILL,
      gap: 24,
      align: "center",
      pad: 24,
      ...box({ stroke: { paint: c("danger") } }),
    })
    const dt = b.col(danger, "Text", { w: FILL, gap: 2 })
    b.text(dt, "Reset invoice numbering", b.ty("label"), ink)
    b.text(
      dt,
      "Starts the next invoice at MP-0001. Your accountant may need the old sequence.",
      b.ty("body-sm"),
      muted,
    )
    b.use(danger, button, { args: { label: "Reset numbering", variant: "danger" } })
  }

  // Data table
  {
    const { scr, content } = shell(
      "Data table",
      "SideN2",
      "Invoices",
      "Moss & Pike Studio",
      (into) => {
        b.use(into, button, {
          args: { label: "Export", variant: "outline", iconStart: true },
          set: { BtnS: { icon: "download" } },
        })
        b.use(into, button, { args: { label: "New invoice", iconStart: true } })
      },
    )
    const stats = b.row(content, "Stats", { w: FILL, gap: 16 })
    for (const [label, value, delta, trend] of [
      ["Outstanding", "£19,815", "8%", "up"],
      ["Overdue", "£3,030", "4%", "down"],
      ["Paid in September", "£18,240", "12%", "up"],
      ["Average days to pay", "14", "0", "flat"],
    ] as const)
      b.use(stats, stat, { props: { w: 270 }, args: { label, value, delta, trend } })
    const bar = b.row(content, "Toolbar", { w: FILL, gap: 12, align: "center" })
    b.use(bar, segmented, {
      args: { option1: "All", option2: "Unpaid", option3: "Paid", selected: "first" },
    })
    const tags = b.row(bar, "Filters", { w: FILL, gap: 8, align: "center" })
    b.use(tags, tag, { args: { label: "Status: overdue, sent", state: "selected" } })
    b.use(tags, tag, { args: { label: "Due: this month" } })
    b.use(bar, textField, {
      props: { w: 260 },
      args: {
        label: "Search",
        value: "Search invoices",
        content: "placeholder",
        icon: true,
        showHint: false,
        size: "sm",
      },
      hide: ["FldLbl"],
    })
    const table = b.col(content, "Table", { w: FILL, ...box(), clip: true })
    const head = b.row(table, "Head", {
      w: FILL,
      gap: 16,
      align: "center",
      pad: [10, 20],
      fill: c("bg"),
    })
    b.use(head, checkbox, { args: { state: "mixed", showLabel: false } })
    for (const [label, w, sort] of [
      ["Client", 0, "none"],
      ["Number", 110, "none"],
      ["Status", 100, "none"],
      ["Due", 90, "asc"],
      ["Amount", 100, "none"],
    ] as const)
      b.use(head, th, {
        props: {
          w: w || FILL,
          ...(label === "Amount"
            ? { layout: { dir: "row", gap: 4, align: "center", justify: "end" } }
            : {}),
        },
        args: { label, sort },
      })
    b.icon(head, "sliders-horizontal", 16, muted)
    invoices.slice(0, 7).forEach((inv, i) => {
      invoiceRow(table, inv, i === 2 ? "selected" : i === 5 ? "hover" : "default")
    })
    const foot = b.row(table, "Footer", {
      w: FILL,
      pad: [12, 20],
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    b.use(foot, pagination, {
      props: { w: FILL },
      args: { summary: "1 to 7 of 64 invoices", last: "10" },
    })
    // Row menu, open on INV-1044.
    const pop = b.col(scr, "Row menu", {
      position: "absolute",
      x: 1148,
      y: 532,
      meta: { "kimo.template.overlay": true },
    })
    b.use(pop, menu, { slots: { MenuI: menuItems } })
  }

  // Dialog and toast
  {
    const { scr, content } = shell("Dialog and toast", "SideN2", "INV-1045", "Invoices", (into) => {
      b.use(into, button, { args: { label: "Delete", variant: "outline" } })
      b.use(into, button, {
        args: { label: "Send invoice", iconStart: true },
        set: { BtnS: { icon: "send" } },
      })
    })
    const top = b.row(content, "Summary", { w: FILL, gap: 24, align: "start" })
    const inv = b.col(top, "Invoice", { w: FILL, gap: 20, pad: 28, ...box() })
    const ih = b.row(inv, "Header", { w: FILL, justify: "between", align: "start" })
    const it = b.col(ih, "To", { gap: 4 })
    b.text(it, "Billed to", b.ty("caption"), muted)
    b.text(it, "Lumen Bikes", b.ty("h3"), ink)
    b.text(it, "hello@lumenbikes.com", b.ty("body-sm"), muted)
    b.use(ih, badge, { args: { label: "Draft", tone: "neutral" } })
    for (const [item, qty, amount] of [
      ["Brand photography, half day", "1", "£650.00"],
      ["Retouching, per image", "25", "£500.00"],
      ["Usage licence, 12 months", "1", "£125.00"],
    ] as const) {
      const row = b.row(inv, item, {
        w: FILL,
        justify: "between",
        align: "center",
        pad: [10, 0],
        stroke: { paint: c("border"), width: { t: 1 } },
      })
      b.text(row, item, b.ty("body"), ink)
      const nums = b.row(row, "Amounts", { gap: 16, align: "center" })
      b.text(nums, qty, b.ty("body"), muted, { w: 40, grow: "fixed-width" })
      b.text(nums, amount, b.ty("label", { align: "right" }), ink, { w: 100, grow: "fixed-width" })
    }
    const total = b.row(inv, "Total", {
      w: FILL,
      justify: "between",
      pad: [12, 0, 0, 0],
      stroke: { paint: c("border-strong"), width: { t: 1 } },
    })
    b.text(total, "Total", b.ty("heading"), ink)
    b.text(total, "£1,275.00", b.ty("heading"), ink)
    const side = b.col(top, "Activity", { w: 340, gap: 4, pad: 12, ...box() })
    for (const [title, sub, meta, icon] of [
      ["Draft created", "Gabriel Moss", "Oct 4", "file-plus"],
      ["Line items edited", "Gabriel Moss", "Oct 5", "pencil"],
      ["PDF downloaded", "Ama Pike", "Today", "download"],
    ] as const)
      b.use(side, listItem, {
        props: { w: FILL },
        args: { title, subtitle: sub, meta },
        set: { LiIc: { icon } },
      })

    const scrim = b.col(scr, "Scrim", {
      position: "absolute",
      x: 0,
      y: 0,
      w: 1440,
      h: 900,
      align: "center",
      justify: "center",
      fill: c("scrim"),
      meta: { "kimo.template.overlay": true },
    })
    b.use(scrim, modal, {
      args: {
        title: "Delete INV-1045?",
        description:
          "The draft for Lumen Bikes and its 3 line items are deleted. This can't be undone.",
        confirm: "Delete draft",
      },
      set: { MdOk: { args: { label: "Delete draft", variant: "danger" } } },
      slots: {
        MdB: (into) =>
          b.use(into, checkbox, {
            args: { label: "Also delete the PDF from shared files", state: "off" },
          }),
      },
    })
    const toastSpot = b.col(scr, "Toast", {
      position: "absolute",
      x: 1036,
      y: 820,
      meta: { "kimo.template.overlay": true },
    })
    b.use(toastSpot, toast, {
      args: { tone: "success", message: "INV-1044 sent to Okonkwo Architects", action: "View" },
    })
  }
}
