/**
 * Tidewell: the iPhone app of a fictional personal bank.
 * Screens (390×844): Sign in, Home, Transactions, Transaction detail, Send money, Cards (frozen
 * card), Insights.
 */
import { FILL, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "mobile-banking",
  name: "Tidewell personal banking",
  category: "Mobile",
  description:
    "Seven-screen iPhone app for a personal bank: passcode sign-in, balances and cards, transactions, a receipt, sending money, freezing a card and monthly insights.",
  prefix: "qb",
  build,
}

const W = 390
const H = 844

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F3F5F8", "#0A0D14"],
      surface: ["#FFFFFF", "#141924"],
      subtle: ["#EAEEF3", "#1D2330"],
      ink: ["#0F1729", "#EEF1F7"],
      "ink-2": ["#344054", "#C5CCD9"],
      muted: ["#667085", "#8D97AA"],
      border: ["#E2E7EE", "#252C3A"],
      accent: ["#2E4FD6", "#8EA2FF"],
      "accent-soft": ["#E6EBFD", "#1C2550"],
      "on-accent": ["#FFFFFF", "#0A0D14"],
      positive: ["#13795B", "#45C99A"],
      "positive-soft": ["#E0F3EC", "#0F2E24"],
      danger: ["#C2361F", "#FF8A73"],
      "danger-soft": ["#FCE8E4", "#3A1711"],
      ice: ["#CFE3F2", "#24384A"],
      "card-1": ["#1B2B6B", "#1E2F78"],
      "card-2": ["#3A57E0", "#4361EA"],
      "card-frost-1": ["#46546E", "#3A4456"],
      "card-frost-2": ["#687690", "#5A6578"],
      chip: ["#E4C27A", "#C9A85E"],
      "chip-2": ["#F5E2B0", "#E3CB8E"],
      "chip-line": ["#A9883F", "#7E6430"],
      knob: ["#FFFFFF", "#FFFFFF"],
      "toggle-off": ["#DCE1E8", "#3A4456"],
      "on-card": ["#FFFFFF", "#FFFFFF"],
      "on-card-muted": ["#C9D3FF", "#C9D3FF"],
      "cat-1": ["#2E4FD6", "#8EA2FF"],
      "cat-2": ["#13795B", "#45C99A"],
      "cat-3": ["#D9822B", "#F5B061"],
      "cat-4": ["#B4479A", "#E78BD2"],
      "cat-5": ["#2A8BA8", "#62C6E3"],
      "cat-6": ["#98A2B3", "#5D6779"],
      "cat-1-soft": ["#E6EBFD", "#1C2550"],
      "cat-2-soft": ["#E0F3EC", "#0F2E24"],
      "cat-3-soft": ["#FBEEDD", "#3A2810"],
      "cat-4-soft": ["#F7E4F2", "#3A1733"],
      "cat-5-soft": ["#DFF1F6", "#0F2E38"],
      "cat-6-soft": ["#EEF0F3", "#1D2330"],
    },
    numbers: {
      "space/1": 4,
      "space/2": 8,
      "space/3": 12,
      "space/4": 16,
      "space/5": 20,
      "space/6": 24,
      "space/8": 32,
      "radius/sm": 8,
      "radius/md": 12,
      "radius/lg": 18,
      "radius/card": 20,
      "radius/pill": 999,
      "size/status": 47,
    },
    type: {
      display: { font: "Inter", size: 56, weight: 700, lineHeight: 1.05, letterSpacing: -1.8 },
      balance: { font: "Inter", size: 40, weight: 700, lineHeight: 1.1, letterSpacing: -1.4 },
      h1: { font: "Inter", size: 28, weight: 700, lineHeight: 1.15, letterSpacing: -0.6 },
      title: { font: "Inter", size: 20, weight: 700, lineHeight: 1.25, letterSpacing: -0.3 },
      heading: { font: "Inter", size: 17, weight: 600, lineHeight: 1.3, letterSpacing: -0.2 },
      body: { font: "Inter", size: 15, weight: 400, lineHeight: 1.45 },
      label: { font: "Inter", size: 14, weight: 600, lineHeight: 1.3 },
      small: { font: "Inter", size: 13, weight: 400, lineHeight: 1.4 },
      caption: { font: "Inter", size: 11, weight: 600, lineHeight: 1.3 },
      mono: { font: "JetBrains Mono", size: 14, weight: 500, lineHeight: 1.3, letterSpacing: 1 },
    },
    shadows: {
      card: [
        { kind: "shadow", x: 0, y: 1, blur: 2, color: "#0F17290D" },
        { kind: "shadow", x: 0, y: 6, blur: 16, spread: -6, color: "#0F172914" },
      ],
      lifted: { kind: "shadow", x: 0, y: 14, blur: 28, spread: -10, color: "#1B2B6B59" },
      phone: { kind: "shadow", x: 0, y: 24, blur: 48, spread: -12, color: "#0F172933" },
    },
  })

  const c = (n: string) => b.c(n)
  const s = (n: number) => b.n(`space/${n}`)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  const grad = (from: string, to: string, rotation = 135) => ({
    kind: "linear",
    rotation,
    stops: [
      { color: c(from), at: 0 },
      { color: c(to), at: 1 },
    ],
  })
  const card = (extra: Record<string, unknown> = {}) => ({
    radius: r("lg"),
    fill: c("surface"),
    effects: b.shadow("card"),
    ...extra,
  })

  // --- Components: system ------------------------------------------------------------------------

  const statusBar = b.component(
    "Status bar",
    {
      key: "Status",
      section: "System",
      description: "iOS status bar. Sits on the screen background.",
      props: { time: p.text("StTime", "9:41") },
      root: {
        dir: "row",
        w: W,
        h: b.n("size/status"),
        justify: "between",
        align: "center",
        pad: [0, 28, 0, 32],
      },
    },
    (root) => {
      b.text(root, "9:41", b.ty("label", { size: 16 }), ink, { key: "StTime", name: "Time" })
      const icons = b.row(root, "Icons", { gap: 6, align: "center" })
      b.icon(icons, "signal", 17, ink)
      b.icon(icons, "wifi", 17, ink)
      b.icon(icons, "battery-full", 24, ink)
    },
  )

  const homeBar = b.component(
    "Home indicator",
    {
      key: "HomeBar",
      section: "System",
      root: { dir: "row", w: W, h: 34, justify: "center", align: "center", pad: [0, 0, 4, 0] },
    },
    (root) => b.rect(root, "Bar", { w: 134, h: 5, radius: r("pill"), fill: ink }),
  )

  const tabsDef = [
    ["Home", "house"],
    ["Activity", "arrow-left-right"],
    ["Cards", "credit-card"],
    ["Insights", "chart-pie"],
  ] as const
  const tabActive = (i: number) =>
    Object.fromEntries(
      tabsDef.flatMap((_, j) => [
        [`TbIc${j + 1}.color`, j === i ? c("accent") : muted],
        [`TbLb${j + 1}.fill`, j === i ? c("accent") : muted],
      ]),
    )
  const tabBar = b.component(
    "Tab bar",
    {
      key: "TabBar",
      section: "System",
      description: "Four tabs with the home indicator. Set active per screen.",
      props: {
        active: p.variants({
          home: tabActive(0),
          activity: tabActive(1),
          cards: tabActive(2),
          insights: tabActive(3),
        }),
      },
      root: {
        dir: "column",
        w: W,
        pad: [8, 0, 0, 0],
        fill: c("surface"),
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      const items = b.row(root, "Items", { w: FILL, pad: [0, 12] })
      tabsDef.forEach(([label, icon], i) => {
        const it = b.col(items, label, { w: (W - 24) / 4, gap: 4, align: "center", pad: [4, 0] })
        b.icon(it, icon, 24, i === 0 ? c("accent") : muted, { key: `TbIc${i + 1}` })
        b.text(it, label, b.ty("caption"), i === 0 ? c("accent") : muted, {
          key: `TbLb${i + 1}`,
        })
      })
      b.use(root, homeBar, { props: { w: FILL } })
    },
  )

  // --- Components: actions -----------------------------------------------------------------------

  const button = b.component(
    "Button",
    {
      key: "Btn",
      section: "Actions",
      description: "Primary, secondary, soft or danger; md or lg.",
      props: {
        label: p.text("BtnLabel", "Button"),
        icon: p.bool("BtnIcon", false),
        variant: p.variants({
          primary: {
            "root.fill": c("accent"),
            "root.stroke": { paint: c("accent") },
            "BtnLabel.fill": c("on-accent"),
            "BtnIcon.color": c("on-accent"),
          },
          secondary: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border") },
            "BtnLabel.fill": ink,
            "BtnIcon.color": ink,
          },
          soft: {
            "root.fill": c("accent-soft"),
            "root.stroke": { paint: c("accent-soft") },
            "BtnLabel.fill": c("accent"),
            "BtnIcon.color": c("accent"),
          },
          danger: {
            "root.fill": c("danger-soft"),
            "root.stroke": { paint: c("danger-soft") },
            "BtnLabel.fill": c("danger"),
            "BtnIcon.color": c("danger"),
          },
        }),
        size: p.variants({
          lg: { "root.layout/pad": [16, 22], "BtnLabel.style/size": 16 },
          md: { "root.layout/pad": [10, 16], "BtnLabel.style/size": 14 },
        }),
      },
      root: {
        dir: "row",
        gap: 8,
        align: "center",
        justify: "center",
        pad: [16, 22],
        radius: r("md"),
        fill: c("accent"),
        stroke: { paint: c("accent") },
      },
    },
    (root) => {
      b.icon(root, "send", 18, c("on-accent"), { key: "BtnIcon", visible: false })
      b.text(root, "Button", b.ty("label", { size: 16 }), c("on-accent"), {
        key: "BtnLabel",
        name: "Label",
      })
    },
  )

  const iconBtn = b.component(
    "Icon button",
    {
      key: "IconBtn",
      section: "Actions",
      props: {
        variant: p.variants({
          surface: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border") },
            "IbIcon.color": ink,
          },
          soft: {
            "root.fill": c("subtle"),
            "root.stroke": { paint: c("subtle") },
            "IbIcon.color": ink,
          },
        }),
      },
      root: {
        dir: "row",
        w: 40,
        h: 40,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      },
    },
    (root) => b.icon(root, "chevron-left", 20, ink, { key: "IbIcon" }),
  )

  const quickAction = b.component(
    "Quick action",
    {
      key: "Quick",
      section: "Actions",
      props: { label: p.text("QaLbl", "Send") },
      root: { dir: "column", w: 80, gap: 8, align: "center" },
    },
    (root) => {
      const circle = b.row(root, "Circle", {
        w: 56,
        h: 56,
        radius: r("pill"),
        align: "center",
        justify: "center",
        fill: c("surface"),
        effects: b.shadow("card"),
      })
      b.icon(circle, "send", 22, c("accent"), { key: "QaIcon" })
      b.text(root, "Send", b.ty("small", { weight: 500, align: "center" }), c("ink-2"), {
        key: "QaLbl",
      })
    },
  )

  const keypadKey = b.component(
    "Keypad key",
    {
      key: "Key",
      section: "Actions",
      description: "Digit key, or an icon key (Face ID, delete).",
      props: {
        digit: p.text("KeyNum", "1"),
        kind: p.variants({
          digit: { "KeyNum.visible": true, "KeyIcon.visible": false },
          icon: { "KeyNum.visible": false, "KeyIcon.visible": true },
        }),
      },
      root: { dir: "row", w: 100, h: 56, align: "center", justify: "center" },
    },
    (root) => {
      b.text(root, "1", b.ty("h1", { weight: 500, align: "center" }), ink, { key: "KeyNum" })
      b.icon(root, "delete", 26, ink, { key: "KeyIcon", visible: false })
    },
  )

  const toggle = b.component(
    "Toggle",
    {
      key: "Toggle",
      section: "Actions",
      props: {
        state: p.variants({
          on: { "root.fill": c("accent"), "root.layout/justify": "end" },
          off: { "root.fill": c("toggle-off"), "root.layout/justify": "start" },
        }),
      },
      root: {
        dir: "row",
        w: 51,
        h: 31,
        pad: 2,
        justify: "end",
        radius: r("pill"),
        fill: c("accent"),
      },
    },
    (root) => b.ellipse(root, "Knob", { w: 27, h: 27, fill: c("knob") }),
  )
  const toggleOff = b.derive(toggle, "Toggle/Off", "ToggleOff", {
    section: "Actions",
    description:
      "Toggle preset in the off state. Setting row swaps between Toggle and this through its toggle prop.",
    args: { state: "off" },
  })

  const segLabels = ["One", "Two", "Three"]
  const segActive = (i: number) =>
    Object.fromEntries(
      segLabels.flatMap((_, j) => [
        [`SgI${j + 1}.fill`, j === i ? c("surface") : c("subtle")],
        [`SgI${j + 1}.effects`, j === i ? b.shadow("card") : []],
        [`SgL${j + 1}.fill`, j === i ? ink : muted],
      ]),
    )
  const segmented = b.component(
    "Segmented control",
    {
      key: "Seg",
      section: "Actions",
      props: {
        first: p.text("SgL1", "One"),
        second: p.text("SgL2", "Two"),
        third: p.text("SgL3", "Three"),
        active: p.variants({ first: segActive(0), second: segActive(1), third: segActive(2) }),
      },
      root: { dir: "row", w: 350, pad: 3, gap: 2, radius: r("md"), fill: c("subtle") },
    },
    (root) => {
      segLabels.forEach((l, i) => {
        const it = b.row(root, l, {
          key: `SgI${i + 1}`,
          w: (350 - 6 - 4) / 3,
          pad: [7, 0],
          justify: "center",
          radius: 9,
          fill: i === 0 ? c("surface") : c("subtle"),
          ...(i === 0 ? { effects: b.shadow("card") } : {}),
        })
        b.text(it, l, b.ty("label", { size: 13 }), i === 0 ? ink : muted, { key: `SgL${i + 1}` })
      })
    },
  )

  const input = b.component(
    "Input",
    {
      key: "Input",
      section: "Actions",
      props: {
        label: p.text("InLbl", "Label"),
        showLabel: p.bool("InLbl", true),
        value: p.text("InVal", "Value"),
        icon: p.bool("InIcon", false),
        tone: p.variants({
          value: { "InVal.fill": ink },
          placeholder: { "InVal.fill": muted },
        }),
      },
      root: { dir: "column", w: 350, gap: 6 },
    },
    (root) => {
      b.text(root, "Label", b.ty("label", { size: 13 }), c("ink-2"), { key: "InLbl" })
      const field = b.row(root, "Field", {
        w: FILL,
        gap: 10,
        align: "center",
        pad: [12, 14],
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      })
      b.icon(field, "search", 18, muted, { key: "InIcon", visible: false })
      b.text(field, "Value", b.ty("body"), ink, { key: "InVal", w: FILL, grow: "fixed-width" })
    },
  )

  // --- Components: navigation --------------------------------------------------------------------

  const navHeader = b.component(
    "Nav header",
    {
      key: "NavHead",
      section: "Navigation",
      props: {
        title: p.text("NhTitle", "Title"),
        showAction: p.bool("NhActW", true),
      },
      root: { dir: "row", w: W, gap: 12, align: "center", pad: [8, 20] },
    },
    (root) => {
      b.use(root, iconBtn, { key: "NhBack" })
      b.text(root, "Title", b.ty("heading", { align: "center" }), ink, {
        key: "NhTitle",
        name: "Title",
        w: FILL,
        grow: "fixed-width",
      })
      const slot = b.row(root, "Action slot", { w: 40, h: 40 })
      const act = b.row(slot, "Action", { key: "NhActW" })
      b.use(act, iconBtn, { key: "NhAct", set: { IbIcon: { icon: "ellipsis" } } })
    },
  )

  const sectionHead = b.component(
    "Section header",
    {
      key: "SecHead",
      section: "Navigation",
      props: {
        title: p.text("ShTitle", "Section"),
        action: p.text("ShAct", "See all"),
        showAction: p.bool("ShAct", true),
      },
      root: { dir: "row", w: 350, align: "center", justify: "between" },
    },
    (root) => {
      b.text(root, "Section", b.ty("heading"), ink, { key: "ShTitle", name: "Title" })
      b.text(root, "See all", b.ty("label"), c("accent"), { key: "ShAct", name: "Action" })
    },
  )

  // --- Components: content -----------------------------------------------------------------------

  const avatar = b.component(
    "Avatar",
    {
      key: "Avatar",
      section: "Content",
      props: {
        initials: p.text("AvInit", "DR"),
        size: p.variants({
          sm: { "root.w": 40, "root.h": 40, "AvInit.style/size": 14 },
          md: { "root.w": 52, "root.h": 52, "AvInit.style/size": 17 },
        }),
        tone: p.variants({
          blue: { "root.fill": c("cat-1-soft"), "AvInit.fill": c("cat-1") },
          green: { "root.fill": c("cat-2-soft"), "AvInit.fill": c("cat-2") },
          amber: { "root.fill": c("cat-3-soft"), "AvInit.fill": c("cat-3") },
          pink: { "root.fill": c("cat-4-soft"), "AvInit.fill": c("cat-4") },
        }),
      },
      root: {
        dir: "row",
        w: 40,
        h: 40,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("cat-1-soft"),
      },
    },
    (root) => b.text(root, "DR", b.ty("label"), c("cat-1"), { key: "AvInit" }),
  )

  const badge = b.component(
    "Badge",
    {
      key: "Badge",
      section: "Content",
      props: {
        label: p.text("BdgLbl", "Badge"),
        tone: p.variants({
          positive: { "root.fill": c("positive-soft"), "BdgLbl.fill": c("positive") },
          accent: { "root.fill": c("accent-soft"), "BdgLbl.fill": c("accent") },
          neutral: { "root.fill": c("subtle"), "BdgLbl.fill": c("ink-2") },
          ice: { "root.fill": c("ice"), "BdgLbl.fill": ink },
        }),
      },
      root: { dir: "row", pad: [4, 10], radius: r("pill"), fill: c("positive-soft") },
    },
    (root) =>
      b.text(root, "Badge", b.ty("caption", { size: 12 }), c("positive"), {
        key: "BdgLbl",
        name: "Label",
      }),
  )

  const contact = b.component(
    "Contact",
    {
      key: "Contact",
      section: "Content",
      props: {
        name: p.text("CtName", "Name"),
        initials: p.text("CtAv/AvInit", "PS"),
        state: p.variants({
          default: { "CtRing.stroke": { paint: c("bg"), width: 2 }, "CtName.fill": c("ink-2") },
          selected: { "CtRing.stroke": { paint: c("accent"), width: 2 }, "CtName.fill": ink },
        }),
      },
      root: { dir: "column", w: 72, gap: 6, align: "center" },
    },
    (root) => {
      const ringF = b.row(root, "Ring", {
        key: "CtRing",
        pad: 3,
        radius: r("pill"),
        stroke: { paint: c("bg"), width: 2 },
      })
      b.use(ringF, avatar, { key: "CtAv", args: { size: "md" } })
      b.text(root, "Name", b.ty("small", { weight: 500, align: "center" }), c("ink-2"), {
        key: "CtName",
      })
    },
  )

  const bankCard = b.component(
    "Bank card",
    {
      key: "BCard",
      section: "Content",
      description: "Debit card face; the frozen state greys it and shows the snowflake.",
      props: {
        name: p.text("BcName", "Daniel Reyes"),
        last4: p.text("BcNum", "•••• 4821"),
        expiry: p.text("BcExp", "09/29"),
        kind: p.text("BcKind", "Everyday debit"),
        state: p.variants({
          active: {
            "root.fill": grad("card-1", "card-2", 120),
            "BcFrozen.visible": false,
            "BcKind.fill": c("on-card-muted"),
          },
          frozen: {
            "root.fill": grad("card-frost-1", "card-frost-2", 120),
            "BcFrozen.visible": true,
            "BcKind.fill": c("on-card"),
          },
        }),
      },
      root: {
        dir: "column",
        w: 350,
        h: 206,
        justify: "between",
        pad: [20, 22],
        radius: r("card"),
        fill: grad("card-1", "card-2", 120),
        effects: b.shadow("lifted"),
      },
    },
    (root) => {
      const top = b.row(root, "Top", { w: FILL, align: "center", justify: "between" })
      const brand = b.row(top, "Brand", { gap: 8, align: "center" })
      b.icon(brand, "waves", 20, c("on-card"))
      b.text(brand, "Tidewell", b.ty("heading", { weight: 700 }), c("on-card"))
      const fz = b.row(top, "Frozen", {
        key: "BcFrozen",
        gap: 6,
        align: "center",
        pad: [4, 10],
        radius: r("pill"),
        fill: c("ice"),
        visible: false,
      })
      b.icon(fz, "snowflake", 14, ink)
      b.text(fz, "Frozen", b.ty("caption", { size: 12 }), ink)
      const mid = b.row(root, "Middle", { w: FILL, align: "center", justify: "between" })
      const chip = b.row(mid, "Chip", {
        w: 40,
        h: 30,
        radius: 6,
        clip: true,
        fill: grad("chip", "chip-2", 120),
        stroke: { paint: c("chip-line"), width: 0.75 },
      })
      const pads = (name: string) => {
        const col = b.col(chip, name, { w: FILL, h: FILL, gap: 9, justify: "center" })
        b.rect(col, "Line", { w: FILL, h: 1, fill: c("chip-line") })
        b.rect(col, "Line", { w: FILL, h: 1, fill: c("chip-line") })
      }
      pads("Left contacts")
      const center = b.row(chip, "Center pad", { h: FILL, gap: 12 })
      b.rect(center, "Edge", { w: 1, h: FILL, fill: c("chip-line") })
      b.rect(center, "Edge", { w: 1, h: FILL, fill: c("chip-line") })
      pads("Right contacts")
      b.icon(mid, "nfc", 24, c("on-card"))
      const bottom = b.row(root, "Bottom", { w: FILL, align: "end", justify: "between" })
      const left = b.col(bottom, "Holder", { gap: 4 })
      b.text(left, "•••• 4821", b.ty("mono", { size: 16 }), c("on-card"), { key: "BcNum" })
      b.text(left, "Daniel Reyes", b.ty("label"), c("on-card"), { key: "BcName" })
      const right = b.col(bottom, "Meta", { gap: 4, align: "end" })
      b.text(right, "Everyday debit", b.ty("caption"), c("on-card-muted"), { key: "BcKind" })
      b.text(right, "09/29", b.ty("mono"), c("on-card"), { key: "BcExp" })
    },
  )

  const cats = {
    groceries: ["cat-2-soft", "cat-2", "shopping-basket"],
    dining: ["cat-3-soft", "cat-3", "coffee"],
    transport: ["cat-5-soft", "cat-5", "bus"],
    bills: ["cat-6-soft", "ink-2", "zap"],
    income: ["positive-soft", "positive", "briefcase"],
    transfer: ["cat-1-soft", "cat-1", "arrow-left-right"],
    shopping: ["cat-4-soft", "cat-4", "shopping-bag"],
    rent: ["cat-1-soft", "cat-1", "house"],
  } as const
  type Cat = keyof typeof cats
  const catVariants = (tile: string, icon: string) =>
    p.variants(
      Object.fromEntries(
        Object.entries(cats).map(([k, [soft, strong, ic]]) => [
          k,
          { [`${tile}.fill`]: c(soft), [`${icon}.color`]: c(strong), [`${icon}.icon`]: ic },
        ]),
      ),
    )

  const txRow = b.component(
    "Transaction row",
    {
      key: "Tx",
      section: "Content",
      props: {
        name: p.text("TxName", "Merchant"),
        meta: p.text("TxMeta", "Groceries · 12:14"),
        amount: p.text("TxAmt", "−$0.00"),
        category: catVariants("TxTile", "TxIcon"),
        direction: p.variants({
          out: { "TxAmt.fill": ink },
          in: { "TxAmt.fill": c("positive") },
        }),
      },
      root: { dir: "row", w: 350, gap: 12, align: "center", pad: [10, 0] },
    },
    (root) => {
      const tile = b.row(root, "Icon tile", {
        key: "TxTile",
        w: 44,
        h: 44,
        radius: r("md"),
        align: "center",
        justify: "center",
        fill: c("cat-2-soft"),
      })
      b.icon(tile, "shopping-basket", 20, c("cat-2"), { key: "TxIcon" })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Merchant", b.ty("label", { size: 15, weight: 500 }), ink, { key: "TxName" })
      b.text(t, "Groceries · 12:14", b.ty("small"), muted, { key: "TxMeta" })
      b.text(root, "−$0.00", b.ty("label", { size: 15, align: "right" }), ink, { key: "TxAmt" })
    },
  )

  const detailRow = b.component(
    "Detail row",
    {
      key: "Detail",
      section: "Content",
      props: { label: p.text("DtLbl", "Label"), value: p.text("DtVal", "Value") },
      root: {
        dir: "row",
        w: 350,
        gap: 16,
        align: "center",
        justify: "between",
        pad: [13, 16],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.text(root, "Label", b.ty("body"), muted, { key: "DtLbl" })
      b.text(root, "Value", b.ty("body", { weight: 500, align: "right" }), ink, { key: "DtVal" })
    },
  )

  const categoryRow = b.component(
    "Category row",
    {
      key: "CatRow",
      section: "Content",
      description: "Spend per category. Set the bar's Done and Left weights to the share.",
      props: {
        name: p.text("CrName", "Category"),
        amount: p.text("CrAmt", "$0.00"),
        share: p.text("CrPct", "0%"),
        category: catVariants("CrTile", "CrIcon"),
        bar: p.variants(
          Object.fromEntries(
            (["cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6"] as const).map((k) => [
              k,
              { "CrDone.fill": c(k) },
            ]),
          ),
        ),
      },
      root: { dir: "row", w: 350, gap: 12, align: "center", pad: [10, 0] },
    },
    (root) => {
      const tile = b.row(root, "Icon tile", {
        key: "CrTile",
        w: 40,
        h: 40,
        radius: r("md"),
        align: "center",
        justify: "center",
        fill: c("cat-1-soft"),
      })
      b.icon(tile, "house", 18, c("cat-1"), { key: "CrIcon" })
      const t = b.col(root, "Text", { w: FILL, gap: 8 })
      const line = b.row(t, "Line", { w: FILL, justify: "between", align: "center" })
      b.text(line, "Category", b.ty("label", { size: 15, weight: 500 }), ink, { key: "CrName" })
      const right = b.row(line, "Amounts", { gap: 8, align: "center" })
      b.text(right, "0%", b.ty("small"), muted, { key: "CrPct" })
      b.text(right, "$0.00", b.ty("label", { size: 15 }), ink, { key: "CrAmt" })
      const bar = b.row(t, "Bar", {
        w: FILL,
        h: 6,
        radius: r("pill"),
        fill: c("subtle"),
        clip: true,
      })
      b.rect(bar, "Done", {
        key: "CrDone",
        w: { mode: "fill", weight: 50 },
        h: 6,
        fill: c("cat-1"),
      })
      b.rect(bar, "Left", {
        key: "CrLeft",
        w: { mode: "fill", weight: 50 },
        h: 6,
        fill: c("subtle"),
      })
    },
  )
  const share = (n: number) => ({
    CrDone: { w: { mode: "fill", weight: n } },
    CrLeft: { w: { mode: "fill", weight: 100 - n } },
  })

  const settingRow = b.component(
    "Setting row",
    {
      key: "Setting",
      section: "Content",
      description: "List row with a value and chevron, or a toggle.",
      props: {
        label: p.text("SrLbl", "Setting"),
        detail: p.text("SrDet", "Detail"),
        showDetail: p.bool("SrDet", false),
        value: p.text("SrVal", "Value"),
        showValue: p.bool("SrVal", true),
        showChevron: p.bool("SrChev", true),
        showToggle: p.bool("SrTgWrap", false),
        toggle: p.swap("SrToggle", toggle),
      },
      root: { dir: "row", w: 350, gap: 12, align: "center", pad: [12, 14] },
    },
    (root) => {
      const tile = b.row(root, "Icon tile", {
        w: 34,
        h: 34,
        radius: r("sm"),
        align: "center",
        justify: "center",
        fill: c("subtle"),
      })
      b.icon(tile, "lock", 17, c("ink-2"), { key: "SrIcon" })
      const t = b.col(root, "Text", { w: FILL, gap: 1 })
      b.text(t, "Setting", b.ty("body", { weight: 500 }), ink, { key: "SrLbl" })
      b.text(t, "Detail", b.ty("small"), muted, { key: "SrDet", visible: false })
      b.text(root, "Value", b.ty("body"), muted, { key: "SrVal" })
      b.icon(root, "chevron-right", 18, muted, { key: "SrChev" })
      const tw = b.row(root, "Toggle", { key: "SrTgWrap", visible: false })
      b.use(tw, toggle, { key: "SrToggle" })
    },
  )

  // --- Screen helpers ----------------------------------------------------------------------------

  const page = b.page("Screens")
  type TabKey = "home" | "activity" | "cards" | "insights"
  function screen(
    name: string,
    opts: {
      tab?: TabKey
      pad?: number[]
      gap?: number
      header?: (scr: string) => void
    } = {},
  ) {
    const scr = b.screen(page, name, { dir: "column", w: W, h: H, clip: true, fill: c("bg") })
    b.use(scr, statusBar, { props: { w: FILL } })
    opts.header?.(scr)
    const content = b.col(scr, "Content", {
      w: FILL,
      h: FILL,
      gap: opts.gap ?? s(6),
      pad: opts.pad ?? [8, 20, 20, 20],
      clip: true,
    })
    const bottom = (fn?: (into: string) => void) => {
      if (opts.tab) b.use(scr, tabBar, { props: { w: FILL }, args: { active: opts.tab } })
      else {
        const bar = b.col(scr, "Bottom bar", { w: FILL, gap: 0 })
        if (fn) {
          const inner = b.col(bar, "Actions", { w: FILL, gap: 10, pad: [12, 20, 4, 20] })
          fn(inner)
        }
        b.use(bar, homeBar, { props: { w: FILL } })
      }
    }
    return { scr, content, bottom }
  }
  const header = (title: string, action?: string) => (scr: string) =>
    b.use(scr, navHeader, {
      props: { w: FILL },
      args: { title, ...(action ? {} : { showAction: false }) },
      ...(action ? { set: { "NhAct/IbIcon": { icon: action } } } : {}),
    })
  function keypad(parent: string, faceId: boolean, h = 56) {
    const pad = b.col(parent, "Keypad", { w: FILL, gap: 4 })
    const rows = [
      ["1", "2", "3"],
      ["4", "5", "6"],
      ["7", "8", "9"],
      [faceId ? "face" : ".", "0", "del"],
    ]
    for (const [i, keys] of rows.entries()) {
      const row = b.row(pad, `Row ${i + 1}`, { w: FILL, justify: "between" })
      for (const k of keys) {
        const icon = k === "face" ? "scan-face" : k === "del" ? "delete" : null
        b.use(row, keypadKey, {
          props: { w: 116, h },
          args: icon ? { kind: "icon" } : { digit: k },
          ...(icon ? { set: { KeyIcon: { icon } } } : {}),
        })
      }
    }
  }

  // --- Data --------------------------------------------------------------------------------------

  const txs: [string, string, string, Cat, "in" | "out"][] = [
    ["Greenline Grocers", "Groceries · 12:14", "−$64.20", "groceries", "out"],
    ["Northside Coffee", "Dining · 8:02", "−$4.75", "dining", "out"],
    ["Fernhill Studio", "Salary · Yesterday", "+$3,120.00", "income", "in"],
    ["Portland Transit", "Transport · Yesterday", "−$2.80", "transport", "out"],
    ["Priya Shah", "Paid your request · Sun", "+$42.00", "transfer", "in"],
    ["Lumen Electric", "Bills · Sun", "−$88.34", "bills", "out"],
  ]
  const tx = (parent: string, i: number, meta?: string) => {
    const [name, m, amount, category, direction] = txs[i] as (typeof txs)[number]
    b.use(parent, txRow, {
      props: { w: FILL },
      args: { name, meta: meta ?? m, amount, category, direction },
    })
  }

  // --- Cover -------------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Mobile app template",
    title: "Tidewell personal banking",
    description:
      "Passcode sign-in, balances and cards, transactions, a receipt, sending money, a frozen card and monthly insights for an iPhone banking app. Built from 21 components with light and dark tokens.",
    preview: (area) => {
      const row = b.row(area, "Phones", {
        w: FILL,
        h: FILL,
        gap: 24,
        align: "center",
        justify: "center",
      })
      const phone = (name: string, dark: boolean) =>
        b.col(row, name, {
          w: 300,
          h: 560,
          gap: 16,
          pad: [24, 16],
          radius: 40,
          clip: true,
          fill: c("bg"),
          stroke: { paint: c("border"), width: 1 },
          effects: b.shadow("phone"),
          ...(dark ? { theme: { mode: "dark" } } : {}),
        })
      const a = phone("Home", false)
      const bal = b.col(a, "Balance", { w: FILL, gap: 2 })
      b.text(bal, "Total balance", b.ty("small"), muted)
      b.text(bal, "$8,214.37", b.ty("balance", { size: 32 }), ink)
      b.use(a, bankCard, { props: { w: FILL, h: 168 } })
      const qa = b.row(a, "Actions", { w: FILL, justify: "between" })
      for (const [label, icon] of [
        ["Send", "send"],
        ["Request", "hand-coins"],
        ["Top up", "plus"],
      ] as const)
        b.use(qa, quickAction, { args: { label }, set: { QaIcon: { icon } } })
      const list = b.col(a, "Recent", { w: FILL, gap: 0 })
      tx(list, 0)
      tx(list, 2)
      const d = phone("Insights", true)
      const ih = b.col(d, "Heading", { w: FILL, gap: 2 })
      b.text(ih, "Spent in September", b.ty("small"), muted)
      b.text(ih, "$2,846.10", b.ty("balance", { size: 32 }), ink)
      b.use(ih, badge, { args: { label: "12% less than August", tone: "positive" } })
      const stack = b.row(d, "Split", { w: FILL, h: 8, gap: 3 })
      for (const [k, v] of [
        ["cat-1", 1450],
        ["cat-2", 612],
        ["cat-3", 319],
        ["cat-4", 221],
        ["cat-5", 164],
        ["cat-6", 80],
      ] as const)
        b.rect(stack, k, { w: { mode: "fill", weight: v }, h: 8, radius: 4, fill: c(k) })
      const cl = b.col(d, "Categories", { w: FILL, gap: 0 })
      for (const [name, amount, pct, cat, bar, n] of [
        ["Rent", "$1,450.00", "51%", "rent", "cat-1", 51],
        ["Groceries", "$612.40", "22%", "groceries", "cat-2", 22],
        ["Dining", "$318.75", "11%", "dining", "cat-3", 11],
        ["Shopping", "$221.35", "8%", "shopping", "cat-4", 8],
        ["Transport", "$164.20", "6%", "transport", "cat-5", 6],
      ] as const)
        b.use(cl, categoryRow, {
          props: { w: FILL },
          args: { name, amount, share: pct, category: cat, bar },
          set: share(n),
          hide: ["CrPct"],
        })
      const tip = b.row(d, "Tip", {
        w: FILL,
        gap: 10,
        align: "start",
        pad: 12,
        radius: r("md"),
        fill: c("accent-soft"),
      })
      b.icon(tip, "coffee", 16, c("accent"))
      b.para(tip, "Dining is down $86 from August.", b.ty("small"), ink)
    },
  })

  // --- Sign in -----------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Sign in", { pad: [8, 20, 8, 20], gap: 0 })
    const top = b.col(content, "Welcome", {
      w: FILL,
      h: FILL,
      gap: 20,
      align: "center",
      justify: "center",
      pad: [0, 0, 16, 0],
    })
    const mark = b.row(top, "Logo", {
      w: 64,
      h: 64,
      radius: r("lg"),
      align: "center",
      justify: "center",
      fill: grad("card-1", "card-2", 120),
      effects: b.shadow("lifted"),
    })
    b.icon(mark, "waves", 30, c("on-card"))
    const t = b.col(top, "Text", { w: FILL, gap: 6, align: "center" })
    b.text(t, "Welcome back, Daniel", b.ty("title", { size: 24, align: "center" }), ink)
    b.text(t, "Enter your 6-digit passcode", b.ty("body", { align: "center" }), muted)
    const dots = b.row(top, "Passcode", { gap: 16, pad: [12, 0] })
    for (let i = 0; i < 6; i++)
      b.ellipse(dots, i < 4 ? "Filled" : "Empty", {
        w: 14,
        h: 14,
        fill: i < 4 ? c("accent") : c("surface"),
        stroke: { paint: i < 4 ? c("accent") : c("border"), width: 1.5 },
      })
    keypad(content, true, 64)
    const foot = b.row(content, "Links", { w: FILL, justify: "between", pad: [20, 24, 16, 24] })
    b.text(foot, "Forgot passcode?", b.ty("label"), c("accent"))
    b.text(foot, "Not Daniel?", b.ty("label"), muted)
    bottom()
  }

  // --- Home --------------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Home", { tab: "home", gap: 22 })
    const head = b.row(content, "Header", { w: FILL, gap: 12, align: "center" })
    b.use(head, avatar, { args: { initials: "DR", size: "sm", tone: "blue" } })
    const ht = b.col(head, "Greeting", { w: FILL, gap: 0 })
    b.text(ht, "Good morning", b.ty("small"), muted)
    b.text(ht, "Daniel Reyes", b.ty("heading"), ink)
    b.use(head, iconBtn, { args: { variant: "surface" }, set: { IbIcon: { icon: "bell" } } })
    const bal = b.col(content, "Balance", { w: FILL, gap: 4 })
    b.text(bal, "Total balance", b.ty("small", { weight: 500 }), muted)
    b.text(bal, "$8,214.37", b.ty("balance"), ink)
    const delta = b.row(bal, "Change", { gap: 8, align: "center" })
    b.use(delta, badge, { args: { label: "+$1,240.00", tone: "positive" } })
    b.text(delta, "since September 6", b.ty("small"), muted)
    b.use(content, bankCard, { props: { w: FILL } })
    const qa = b.row(content, "Quick actions", { w: FILL, justify: "between" })
    for (const [label, icon] of [
      ["Send", "send"],
      ["Request", "hand-coins"],
      ["Top up", "plus"],
      ["Pay bills", "receipt"],
    ] as const)
      b.use(qa, quickAction, { args: { label }, set: { QaIcon: { icon } } })
    const recent = b.col(content, "Recent", { w: FILL, gap: 4 })
    b.use(recent, sectionHead, { props: { w: FILL }, args: { title: "Recent activity" } })
    tx(recent, 0, "Groceries · Today, 12:14")
    tx(recent, 2)
    bottom()
  }

  // --- Transactions ------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Transactions", { tab: "activity", gap: 16 })
    const head = b.row(content, "Header", { w: FILL, align: "center", justify: "between" })
    b.text(head, "Activity", b.ty("h1"), ink)
    b.use(head, iconBtn, {
      args: { variant: "surface" },
      set: { IbIcon: { icon: "sliders-horizontal" } },
    })
    b.use(content, input, {
      props: { w: FILL },
      args: {
        showLabel: false,
        icon: true,
        value: "Search merchants or amounts",
        tone: "placeholder",
      },
    })
    b.use(content, segmented, {
      props: { w: FILL },
      args: { first: "All", second: "Money in", third: "Money out", active: "first" },
    })
    const groups: [string, string, number[]][] = [
      ["Today", "−$68.95", [0, 1]],
      ["Yesterday", "+$3,117.20", [2, 3]],
      ["Sunday, October 4", "−$46.34", [4, 5]],
    ]
    const metas = [
      "Groceries · 12:14",
      "Dining · 8:02",
      "Salary · 9:00",
      "Transport · 17:41",
      "Paid your request · 19:20",
      "Bills · Autopay",
    ]
    for (const [day, total, idx] of groups) {
      const g = b.col(content, day, { w: FILL, gap: 0 })
      const gh = b.row(g, "Day", { w: FILL, justify: "between", pad: [0, 0, 2, 0] })
      b.text(gh, day, b.ty("label", { size: 13 }), muted)
      b.text(gh, total, b.ty("label", { size: 13 }), muted)
      for (const i of idx) tx(g, i, metas[i])
    }
    bottom()
  }

  // --- Transaction detail ------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Transaction detail", {
      header: header("Transaction", "share"),
      pad: [8, 20, 12, 20],
      gap: 20,
    })
    const hero = b.col(content, "Summary", { w: FILL, gap: 10, align: "center", pad: [8, 0, 4, 0] })
    const tile = b.row(hero, "Icon tile", {
      w: 64,
      h: 64,
      radius: r("lg"),
      align: "center",
      justify: "center",
      fill: c("cat-2-soft"),
    })
    b.icon(tile, "shopping-basket", 30, c("cat-2"))
    b.text(hero, "Greenline Grocers", b.ty("heading", { align: "center" }), ink)
    b.text(hero, "−$64.20", b.ty("balance", { align: "center" }), ink)
    b.use(hero, badge, { args: { label: "Completed", tone: "positive" } })
    const rows = b.col(content, "Details", { w: FILL, ...card(), clip: true })
    for (const [label, value] of [
      ["Date", "Oct 6, 2026, 12:14"],
      ["Card", "Everyday debit •••• 4821"],
      ["Category", "Groceries"],
      ["Location", "SE Hawthorne Blvd, Portland"],
      ["Reference", "TW-2610-58213"],
    ] as const)
      b.use(rows, detailRow, { props: { w: FILL }, args: { label, value } })
    const note = b.row(content, "Note", { w: FILL, gap: 12, align: "center", pad: 14, ...card() })
    b.icon(note, "pencil", 18, muted)
    b.text(note, "Add a note or a receipt photo", b.ty("body"), muted, {
      w: FILL,
      grow: "fixed-width",
    })
    bottom((into) => {
      const row = b.row(into, "Actions", { w: FILL, gap: 10 })
      b.use(row, button, {
        props: { w: 170 },
        args: { label: "Split bill", variant: "soft", icon: true },
        set: { BtnIcon: { icon: "split" } },
      })
      b.use(row, button, {
        props: { w: 170 },
        args: { label: "Report", variant: "danger", icon: true },
        set: { BtnIcon: { icon: "flag" } },
      })
    })
  }

  // --- Send money --------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Send money", {
      header: header("Send money"),
      pad: [8, 20, 4, 20],
      gap: 18,
    })
    const people = b.row(content, "Recent contacts", { w: FILL, justify: "between" })
    for (const [name, ini, tone, sel] of [
      ["Priya", "PS", "pink", true],
      ["Marcus", "ML", "green", false],
      ["Hana", "HK", "amber", false],
      ["Leo", "LB", "blue", false],
    ] as const)
      b.use(people, contact, {
        args: { name, initials: ini, state: sel ? "selected" : "default" },
        set: { CtAv: { args: { size: "md", tone } } },
      })
    const amt = b.col(content, "Amount", { w: FILL, gap: 8, align: "center", pad: [6, 0] })
    b.text(amt, "To Priya Shah · Tidewell •••• 3390", b.ty("small", { align: "center" }), muted)
    b.text(amt, "$120.00", b.ty("display", { size: 52, align: "center" }), ink)
    b.use(amt, badge, { args: { label: "Concert tickets", tone: "neutral" } })
    const from = b.row(content, "From", {
      w: FILL,
      gap: 12,
      align: "center",
      pad: [12, 14],
      ...card(),
    })
    const ft = b.row(from, "Icon tile", {
      w: 34,
      h: 34,
      radius: r("sm"),
      align: "center",
      justify: "center",
      fill: c("accent-soft"),
    })
    b.icon(ft, "wallet", 17, c("accent"))
    const fx = b.col(from, "Text", { w: FILL, gap: 1 })
    b.text(fx, "From Everyday account", b.ty("label"), ink)
    b.text(fx, "$3,482.19 available", b.ty("small"), muted)
    b.icon(from, "chevron-down", 18, muted)
    keypad(content, false, 50)
    bottom((into) =>
      b.use(into, button, {
        props: { w: FILL },
        args: { label: "Send $120.00", icon: true },
      }),
    )
  }

  // --- Cards -------------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Cards", { tab: "cards", gap: 16 })
    const head = b.row(content, "Header", { w: FILL, align: "center", justify: "between" })
    b.text(head, "Cards", b.ty("h1"), ink)
    b.use(head, button, {
      args: { label: "New card", variant: "soft", size: "md", icon: true },
      set: { BtnIcon: { icon: "plus" } },
    })
    const stackC = b.col(content, "Card", { w: FILL, gap: 12, align: "center" })
    b.use(stackC, bankCard, {
      props: { w: FILL },
      args: { state: "frozen", kind: "Travel debit", last4: "•••• 7735", expiry: "03/28" },
    })
    const dots = b.row(stackC, "Pager", { gap: 6, align: "center" })
    b.ellipse(dots, "Everyday debit", { w: 6, h: 6, fill: c("cat-6") })
    b.rect(dots, "Travel debit", { w: 18, h: 6, radius: r("pill"), fill: c("accent") })
    const info = b.row(content, "Frozen notice", {
      w: FILL,
      gap: 12,
      align: "start",
      pad: 14,
      radius: r("md"),
      fill: c("ice"),
    })
    b.icon(info, "snowflake", 18, ink)
    b.para(
      info,
      "Frozen since Oct 5, 21:40. Card payments and cash withdrawals are blocked.",
      b.ty("small"),
      ink,
    )
    const g1 = b.col(content, "Controls", { w: FILL, ...card(), clip: true })
    for (const [label, icon, on] of [
      ["Freeze card", "snowflake", true],
      ["Online payments", "globe", false],
      ["Contactless", "nfc", false],
    ] as const)
      b.use(g1, settingRow, {
        props: { w: FILL },
        args: {
          label,
          showValue: false,
          showChevron: false,
          showToggle: true,
          ...(on ? {} : { toggle: toggleOff }),
        },
        set: { SrIcon: { icon } },
      })
    const g2 = b.col(content, "Settings", { w: FILL, ...card(), clip: true })
    for (const [label, value, icon] of [
      ["Spending limit", "$2,000 / mo", "gauge"],
      ["Show PIN", "", "eye"],
    ] as const)
      b.use(g2, settingRow, {
        props: { w: FILL },
        args: { label, ...(value ? { value } : { showValue: false }) },
        set: { SrIcon: { icon } },
      })
    bottom()
  }

  // --- Insights ----------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Insights", { tab: "insights", gap: 18 })
    b.text(content, "Insights", b.ty("h1"), ink)
    b.use(content, segmented, {
      props: { w: FILL },
      args: { first: "August", second: "September", third: "October", active: "second" },
    })
    const sum = b.col(content, "Summary", { w: FILL, gap: 14, pad: 16, ...card() })
    const st = b.row(sum, "Header", { w: FILL, align: "end", justify: "between" })
    const stx = b.col(st, "Total", { gap: 2 })
    b.text(stx, "Spent in September", b.ty("small"), muted)
    b.text(stx, "$2,846.10", b.ty("h1"), ink)
    b.use(st, badge, { args: { label: "12% less than August", tone: "positive" } })
    const split = [
      ["cat-1", 1450],
      ["cat-2", 612],
      ["cat-3", 319],
      ["cat-4", 221],
      ["cat-5", 164],
      ["cat-6", 80],
    ] as const
    const stack = b.row(sum, "Split", { w: FILL, h: 10, gap: 3 })
    split.forEach(([k, v], i) => {
      b.rect(stack, k, {
        w: { mode: "fill", weight: v },
        h: 10,
        radius: i === 0 ? [5, 0, 0, 5] : i === split.length - 1 ? [0, 5, 5, 0] : 0,
        fill: c(k),
      })
    })
    const list = b.col(content, "Categories", { w: FILL, gap: 0 })
    b.use(list, sectionHead, {
      props: { w: FILL },
      args: { title: "By category", action: "All 6" },
    })
    for (const [name, amount, pct, cat, bar, n] of [
      ["Rent", "$1,450.00", "51%", "rent", "cat-1", 51],
      ["Groceries", "$612.40", "22%", "groceries", "cat-2", 22],
      ["Dining", "$318.75", "11%", "dining", "cat-3", 11],
      ["Shopping", "$221.35", "8%", "shopping", "cat-4", 8],
    ] as const)
      b.use(list, categoryRow, {
        props: { w: FILL },
        args: { name, amount, share: pct, category: cat, bar },
        set: share(n),
      })
    const tip = b.row(content, "Tip", {
      w: FILL,
      gap: 12,
      align: "start",
      pad: 14,
      radius: r("md"),
      fill: c("accent-soft"),
    })
    b.icon(tip, "coffee", 18, c("accent"))
    b.para(
      tip,
      "Dining is down $86 from August. Coffee shops were $127 of it, mostly weekday mornings.",
      b.ty("small"),
      ink,
    )
    bottom()
  }
}
