/**
 * Tidewell: the iPhone app of a fictional personal bank.
 * Screens (390×844): Sign in, Home, Transactions, Transaction detail, Send money, Cards (frozen
 * card), Insights.
 *
 * Built against Monzo (cents set small, day groups with totals, one colour slab for the balance),
 * Wise and Revolut (pill month bars, hairline category bars), Mercury (card action chips and a
 * daily limit), Lloyds (label/value detail rows) and World App / Wealthfront (borderless keypad).
 * One accent (deep tide green), no red for spending, no gradients.
 */
import { FILL, fill, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "mobile-banking",
  name: "Tidewell personal banking",
  category: "Mobile",
  description:
    "Seven-screen iPhone app for a personal bank: passcode sign-in, a balance slab with activity, a receipt, sending money, a frozen card and monthly insights.",
  prefix: "qb",
  build,
}

const W = 390
const H = 844
const CW = 350 // content width: 20pt gutters

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F1F4F1", "#080D0C"],
      surface: ["#FFFFFF", "#121A18"],
      subtle: ["#E6ECE8", "#1A2421"],
      ink: ["#0B1814", "#EAF1EE"],
      "ink-2": ["#33423C", "#C3D0CA"],
      muted: ["#5F6E68", "#8B9A94"],
      border: ["#DAE1DD", "#24302C"],
      accent: ["#0A5C49", "#62D9AC"],
      "on-accent": ["#FFFFFF", "#05231A"],
      "accent-soft": ["#D7ECE3", "#16322A"],
      credit: ["#16794D", "#58D19B"],
      amber: ["#A8620C", "#E8A24A"],
      slab: ["#0A5C49", "#0E2B24"],
      "on-slab": ["#FFFFFF", "#E8F4EE"],
      "slab-muted": ["#A8D4C5", "#7FB5A2"],
      "slab-chip": ["#064535", "#1B4438"],
      "card-fill": ["#0E1F1A", "#1D2C27"],
      "on-card": ["#F2F7F5", "#F2F7F5"],
      "card-muted": ["#9DB1AA", "#9DB1AA"],
      "card-line": ["#1F3A31", "#2E4B40"],
      frost: ["#BCC9C4", "#34413D"],
      "on-frost": ["#0B1814", "#E8EFEC"],
      "frost-line": ["#A6B5AF", "#45554F"],
      "toggle-off": ["#CBD5D0", "#34413C"],
      "knob-on": ["#FFFFFF", "#05231A"],
      "knob-off": ["#FFFFFF", "#C9D6D0"],
      "bar-dim": ["#CFD8D3", "#26322E"],
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
      "radius/lg": 16,
      "radius/card": 20,
      "radius/slab": 24,
      "radius/pill": 999,
      "size/status": 47,
    },
    type: {
      display: { font: "Inter", size: 34, weight: 700, lineHeight: 1.15, letterSpacing: -0.8 },
      amount: { font: "Inter", size: 56, weight: 650, lineHeight: 1, letterSpacing: -2.2 },
      heading: { font: "Inter", size: 17, weight: 600, lineHeight: 1.3, letterSpacing: -0.2 },
      row: { font: "Inter", size: 17, weight: 600, lineHeight: 1.25, letterSpacing: -0.3 },
      body: { font: "Inter", size: 15, weight: 400, lineHeight: 1.45 },
      label: { font: "Inter", size: 15, weight: 500, lineHeight: 1.3 },
      small: { font: "Inter", size: 13, weight: 400, lineHeight: 1.4 },
      micro: { font: "Inter", size: 11, weight: 600, lineHeight: 1.3, letterSpacing: 0.6 },
      mono: { font: "JetBrains Mono", size: 13, weight: 500, lineHeight: 1.3, letterSpacing: 0.2 },
    },
    shadows: {
      phone: { kind: "shadow", x: 0, y: 24, blur: 48, spread: -12, color: "#0B181433" },
    },
  })

  const c = (n: string) => b.c(n)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  const overlay = { "kimo.template.overlay": true }

  // --- Components: system ------------------------------------------------------------------------

  const statusBar = b.component(
    "Status bar",
    {
      key: "Status",
      section: "System",
      description: "iOS status bar. The slab variant is for screens on the green slab.",
      props: {
        time: p.text("StTime", "9:41"),
        tone: p.variants({
          ink: { "StTime.fill": ink, "StSig.color": ink, "StWifi.color": ink, "StBat.color": ink },
          slab: {
            "StTime.fill": c("on-slab"),
            "StSig.color": c("on-slab"),
            "StWifi.color": c("on-slab"),
            "StBat.color": c("on-slab"),
          },
        }),
      },
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
      b.text(root, "9:41", b.ty("label", { size: 16, weight: 600 }), ink, {
        key: "StTime",
        name: "Time",
      })
      const icons = b.row(root, "Icons", { gap: 6, align: "center" })
      b.icon(icons, "signal", 17, ink, { key: "StSig" })
      b.icon(icons, "wifi", 17, ink, { key: "StWifi" })
      b.icon(icons, "battery-full", 24, ink, { key: "StBat" })
    },
  )

  const homeBar = b.component(
    "Home indicator",
    {
      key: "HomeBar",
      section: "System",
      props: {
        tone: p.variants({
          ink: { "HbBar.fill": ink },
          slab: { "HbBar.fill": c("on-slab") },
        }),
      },
      root: { dir: "row", w: W, h: 34, justify: "center", align: "center", pad: [0, 0, 4, 0] },
    },
    (root) => b.rect(root, "Bar", { key: "HbBar", w: 134, h: 5, radius: r("pill"), fill: ink }),
  )

  const tabsDef = [
    ["Home", "house"],
    ["Activity", "arrow-left-right"],
    ["Send", "arrow-up-right"],
    ["Cards", "credit-card"],
    ["Insights", "chart-no-axes-column"],
  ] as const
  const tabActive = (i: number) =>
    Object.fromEntries(
      tabsDef.flatMap((_, j) => [
        [`TbPill${j + 1}.fill`, j === i ? c("accent-soft") : c("surface")],
        [`TbIc${j + 1}.color`, j === i ? c("accent") : muted],
        [`TbLb${j + 1}.fill`, j === i ? ink : muted],
      ]),
    )
  const tabBar = b.component(
    "Tab bar",
    {
      key: "TabBar",
      section: "System",
      description:
        "Five equal tabs (72pt each) and the home indicator. The active tab sits in a soft pill.",
      props: {
        active: p.variants({
          home: tabActive(0),
          activity: tabActive(1),
          send: tabActive(2),
          cards: tabActive(3),
          insights: tabActive(4),
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
      const items = b.row(root, "Items", { w: FILL, pad: [0, 15] })
      tabsDef.forEach(([label, icon], i) => {
        const it = b.col(items, label, { w: 72, gap: 3, align: "center", pad: [0, 0, 2, 0] })
        const pill = b.row(it, "Pill", {
          key: `TbPill${i + 1}`,
          w: 56,
          h: 30,
          align: "center",
          justify: "center",
          radius: r("pill"),
          fill: i === 0 ? c("accent-soft") : c("surface"),
        })
        b.icon(pill, icon, 22, i === 0 ? c("accent") : muted, { key: `TbIc${i + 1}` })
        b.text(it, label, b.ty("micro", { size: 10, letterSpacing: 0.1 }), i === 0 ? ink : muted, {
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
      description: "Primary, ink, outline or text; large or medium.",
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
          ink: {
            "root.fill": ink,
            "root.stroke": { paint: ink },
            "BtnLabel.fill": c("bg"),
            "BtnIcon.color": c("bg"),
          },
          outline: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border") },
            "BtnLabel.fill": ink,
            "BtnIcon.color": ink,
          },
          text: {
            "root.fill": c("bg"),
            "root.stroke": { paint: c("bg") },
            "BtnLabel.fill": c("accent"),
            "BtnIcon.color": c("accent"),
          },
        }),
        size: p.variants({
          lg: { "root.layout/pad": [17, 22], "BtnLabel.style/size": 16 },
          md: { "root.layout/pad": [10, 16], "BtnLabel.style/size": 14 },
        }),
      },
      root: {
        dir: "row",
        gap: 8,
        align: "center",
        justify: "center",
        pad: [17, 22],
        radius: r("lg"),
        fill: c("accent"),
        stroke: { paint: c("accent") },
      },
    },
    (root) => {
      b.icon(root, "arrow-up-right", 18, c("on-accent"), { key: "BtnIcon", visible: false })
      b.text(root, "Button", b.ty("label", { size: 16, weight: 600 }), c("on-accent"), {
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
          },
          plain: {
            "root.fill": c("bg"),
            "root.stroke": { paint: c("bg") },
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

  const chip = b.component(
    "Chip",
    {
      key: "Chip",
      section: "Actions",
      description: "Filter or action chip, optional leading icon. Ink when selected.",
      props: {
        label: p.text("ChLbl", "Chip"),
        icon: p.bool("ChIcon", false),
        state: p.variants({
          default: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border") },
            "ChLbl.fill": ink,
            "ChIcon.color": ink,
          },
          selected: {
            "root.fill": ink,
            "root.stroke": { paint: ink },
            "ChLbl.fill": c("bg"),
            "ChIcon.color": c("bg"),
          },
        }),
      },
      root: {
        dir: "row",
        gap: 6,
        align: "center",
        pad: [8, 14],
        radius: r("pill"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      },
    },
    (root) => {
      b.icon(root, "snowflake", 15, ink, { key: "ChIcon", visible: false })
      b.text(root, "Chip", b.ty("label", { size: 14 }), ink, { key: "ChLbl", name: "Label" })
    },
  )

  const slabPill = b.component(
    "Slab action",
    {
      key: "SlabPill",
      section: "Actions",
      description: "Pill that lives on the green slab.",
      props: { label: p.text("SpLbl", "Add money") },
      root: {
        dir: "row",
        gap: 7,
        align: "center",
        pad: [10, 14, 10, 12],
        radius: r("pill"),
        fill: c("slab-chip"),
      },
    },
    (root) => {
      b.icon(root, "plus", 16, c("on-slab"), { key: "SpIcon" })
      b.text(root, "Add money", b.ty("label", { size: 14, weight: 600 }), c("on-slab"), {
        key: "SpLbl",
      })
    },
  )

  const keypadKey = b.component(
    "Keypad key",
    {
      key: "Key",
      section: "Actions",
      description: "Borderless digit key, or an icon key (Face ID, delete). 112pt wide.",
      props: {
        digit: p.text("KeyNum", "1"),
        kind: p.variants({
          digit: { "KeyNum.visible": true, "KeyIcon.visible": false },
          icon: { "KeyNum.visible": false, "KeyIcon.visible": true },
        }),
        tone: p.variants({
          ink: { "KeyNum.fill": ink, "KeyIcon.color": ink },
          slab: { "KeyNum.fill": c("on-slab"), "KeyIcon.color": c("on-slab") },
        }),
      },
      root: { dir: "row", w: 112, h: 56, align: "center", justify: "center" },
    },
    (root) => {
      b.text(root, "1", b.ty("display", { size: 30, weight: 500, align: "center" }), ink, {
        key: "KeyNum",
      })
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
          on: {
            "root.fill": c("accent"),
            "root.layout/justify": "end",
            "TgKnob.fill": c("knob-on"),
          },
          off: {
            "root.fill": c("toggle-off"),
            "root.layout/justify": "start",
            "TgKnob.fill": c("knob-off"),
          },
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
    (root) => b.ellipse(root, "Knob", { key: "TgKnob", w: 27, h: 27, fill: c("knob-on") }),
  )
  const toggleOff = b.derive(toggle, "Toggle/Off", "ToggleOff", {
    section: "Actions",
    description: "Toggle preset in the off state. Setting row swaps to it through its toggle prop.",
    args: { state: "off" },
  })

  // --- Components: navigation --------------------------------------------------------------------

  const navHeader = b.component(
    "Nav header",
    {
      key: "NavHead",
      section: "Navigation",
      description: "Pushed screen: back, centered title, optional trailing action.",
      props: {
        title: p.text("NhTitle", "Title"),
        showAction: p.bool("NhActW", true),
      },
      root: { dir: "row", w: W, gap: 12, align: "center", pad: [4, 20] },
    },
    (root) => {
      b.use(root, iconBtn, { key: "NhBack", args: { variant: "plain" } })
      b.text(root, "Title", b.ty("heading", { align: "center" }), ink, {
        key: "NhTitle",
        name: "Title",
        w: FILL,
        grow: "fixed-width",
      })
      const slot = b.row(root, "Action slot", { w: 40, h: 40 })
      const act = b.row(slot, "Action", { key: "NhActW" })
      b.use(act, iconBtn, {
        key: "NhAct",
        args: { variant: "plain" },
        set: { IbIcon: { icon: "share" } },
      })
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
      root: { dir: "row", w: CW, align: "center", justify: "between" },
    },
    (root) => {
      b.text(root, "Section", b.ty("heading"), ink, { key: "ShTitle", name: "Title" })
      b.text(root, "See all", b.ty("label", { size: 14, weight: 600 }), c("accent"), {
        key: "ShAct",
        name: "Action",
      })
    },
  )

  const dayHead = b.component(
    "Day header",
    {
      key: "DayHead",
      section: "Navigation",
      description: "Date group header with the day's net total, as in Monzo.",
      props: { day: p.text("DhDay", "Today"), total: p.text("DhTot", "−$0.00") },
      root: { dir: "row", w: CW, align: "center", justify: "between", pad: [0, 0, 4, 0] },
    },
    (root) => {
      b.text(root, "Today", b.ty("small", { weight: 600 }), c("ink-2"), { key: "DhDay" })
      b.text(root, "−$0.00", b.ty("small", { weight: 500 }), muted, { key: "DhTot" })
    },
  )

  // --- Components: content -----------------------------------------------------------------------

  const money = b.component(
    "Money",
    {
      key: "Money",
      section: "Content",
      description:
        "Amount with the cents set smaller and aligned on the baseline. Size xl, lg or md; tone ink, slab or credit.",
      props: {
        whole: p.text("MnInt", "$8,214"),
        cents: p.text("MnCents", ".37"),
        size: p.variants({
          xl: { "MnInt.style/size": 56, "MnCents.style/size": 28 },
          lg: { "MnInt.style/size": 40, "MnCents.style/size": 22 },
          md: { "MnInt.style/size": 28, "MnCents.style/size": 17 },
        }),
        tone: p.variants({
          ink: { "MnInt.fill": ink, "MnCents.fill": muted },
          slab: { "MnInt.fill": c("on-slab"), "MnCents.fill": c("slab-muted") },
          credit: { "MnInt.fill": c("credit"), "MnCents.fill": c("credit") },
        }),
      },
      root: { dir: "row", align: "baseline", gap: 1 },
    },
    (root) => {
      b.text(root, "$8,214", b.ty("amount"), ink, { key: "MnInt", name: "Whole" })
      b.text(root, ".37", b.ty("amount", { size: 28, letterSpacing: -0.6 }), muted, {
        key: "MnCents",
        name: "Cents",
      })
    },
  )

  const monoTones = {
    neutral: { "root.fill": c("subtle"), "MgText.fill": c("ink-2") },
    accent: { "root.fill": c("accent-soft"), "MgText.fill": c("accent") },
    ink: { "root.fill": ink, "MgText.fill": c("bg") },
  }
  const monogram = b.component(
    "Monogram",
    {
      key: "Mono",
      section: "Content",
      description: "Merchant or person monogram. One tone per meaning, not per category.",
      props: {
        initials: p.text("MgText", "GG"),
        size: p.variants({
          sm: { "root.w": 40, "root.h": 40, "MgText.style/size": 13 },
          md: { "root.w": 44, "root.h": 44, "MgText.style/size": 14 },
          lg: { "root.w": 72, "root.h": 72, "MgText.style/size": 22 },
        }),
        tone: p.variants(monoTones),
      },
      root: {
        dir: "row",
        w: 44,
        h: 44,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("subtle"),
      },
    },
    (root) =>
      b.text(root, "GG", b.ty("label", { size: 14, weight: 650, letterSpacing: 0.2 }), c("ink-2"), {
        key: "MgText",
      }),
  )

  const bankCard = b.component(
    "Bank card",
    {
      key: "BCard",
      section: "Content",
      description:
        "Debit card: flat dark face with ripple lines. Frozen swaps to a frosted face with dark text.",
      props: {
        name: p.text("BcName", "Daniel Reyes"),
        last4: p.text("BcNum", "•••• 4821"),
        expiry: p.text("BcExp", "09/29"),
        kind: p.text("BcKind", "Everyday debit"),
        state: p.variants({
          active: {
            "root.fill": c("card-fill"),
            "BcFrozen.visible": false,
            "BcRip1.stroke": { paint: c("card-line"), width: 1 },
            "BcRip2.stroke": { paint: c("card-line"), width: 1 },
            "BcRip3.stroke": { paint: c("card-line"), width: 1 },
            "BcWord.fill": c("on-card"),
            "BcNfc.color": c("on-card"),
            "BcNum.fill": c("on-card"),
            "BcName.fill": c("on-card"),
            "BcKind.fill": c("card-muted"),
            "BcExp.fill": c("on-card"),
          },
          frozen: {
            "root.fill": c("frost"),
            "BcFrozen.visible": true,
            "BcRip1.stroke": { paint: c("frost-line"), width: 1 },
            "BcRip2.stroke": { paint: c("frost-line"), width: 1 },
            "BcRip3.stroke": { paint: c("frost-line"), width: 1 },
            "BcWord.fill": c("on-frost"),
            "BcNfc.color": c("on-frost"),
            "BcNum.fill": c("on-frost"),
            "BcName.fill": c("on-frost"),
            "BcKind.fill": c("on-frost"),
            "BcExp.fill": c("on-frost"),
          },
        }),
      },
      root: {
        dir: "column",
        w: CW,
        h: 220,
        justify: "between",
        pad: 22,
        radius: r("card"),
        clip: true,
        fill: c("card-fill"),
      },
    },
    (root) => {
      const ripple = (key: string, size: number) =>
        b.ellipse(root, "Ripple", {
          key,
          x: 330 - size / 2,
          y: 230 - size / 2,
          w: size,
          h: size,
          position: "absolute",
          meta: overlay,
          stroke: { paint: c("card-line"), width: 1 },
        })
      ripple("BcRip1", 150)
      ripple("BcRip2", 250)
      ripple("BcRip3", 350)
      const top = b.row(root, "Top", { w: FILL, align: "center", justify: "between" })
      b.text(
        top,
        "tidewell",
        b.ty("heading", { size: 20, weight: 700, letterSpacing: -0.6 }),
        c("on-card"),
        {
          key: "BcWord",
        },
      )
      b.icon(top, "nfc", 22, c("on-card"), { key: "BcNfc" })
      const bottom = b.row(root, "Bottom", { w: FILL, align: "end", justify: "between" })
      const left = b.col(bottom, "Holder", { gap: 6 })
      b.text(left, "Everyday debit", b.ty("micro"), c("card-muted"), { key: "BcKind" })
      b.text(left, "•••• 4821", b.ty("mono", { size: 18, letterSpacing: 1 }), c("on-card"), {
        key: "BcNum",
      })
      b.text(left, "Daniel Reyes", b.ty("label", { size: 14 }), c("on-card"), { key: "BcName" })
      const right = b.col(bottom, "Meta", { gap: 8, align: "end" })
      const fz = b.row(right, "Frozen", {
        key: "BcFrozen",
        gap: 5,
        align: "center",
        pad: [4, 9],
        radius: r("pill"),
        fill: ink,
        visible: false,
      })
      b.icon(fz, "snowflake", 12, c("bg"))
      b.text(fz, "Frozen", b.ty("micro", { size: 10 }), c("bg"))
      b.text(right, "09/29", b.ty("mono"), c("on-card"), { key: "BcExp" })
    },
  )

  const txRow = b.component(
    "Transaction row",
    {
      key: "Tx",
      section: "Content",
      description:
        "Monogram, merchant and meta, amount with small cents. Credits are green with +.",
      props: {
        name: p.text("TxName", "Merchant"),
        meta: p.text("TxMeta", "Groceries · 9:12"),
        whole: p.text("TxInt", "−$0"),
        cents: p.text("TxCents", ".00"),
        initials: p.text("TxMono/MgText", "MM"),
        direction: p.variants({
          out: { "TxInt.fill": ink, "TxCents.fill": muted },
          in: { "TxInt.fill": c("credit"), "TxCents.fill": c("credit") },
        }),
      },
      root: { dir: "row", w: CW, gap: 14, align: "center", pad: [10, 0] },
    },
    (root) => {
      b.use(root, monogram, { key: "TxMono" })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Merchant", b.ty("label", { size: 16 }), ink, { key: "TxName" })
      b.text(t, "Groceries · 9:12", b.ty("small"), muted, { key: "TxMeta" })
      const amt = b.row(root, "Amount", { align: "baseline", gap: 1 })
      b.text(amt, "−$0", b.ty("row"), ink, { key: "TxInt" })
      b.text(amt, ".00", b.ty("small", { size: 13, weight: 500 }), muted, { key: "TxCents" })
    },
  )

  const detailRow = b.component(
    "Detail row",
    {
      key: "Detail",
      section: "Content",
      description: "Label left, value right, as in Lloyds transaction details.",
      props: {
        label: p.text("DtLbl", "Label"),
        value: p.text("DtVal", "Value"),
        mono: p.variants({
          text: { "DtVal.style": b.ty("label", { align: "right" }) },
          code: { "DtVal.style": b.ty("mono", { size: 14, align: "right" }) },
        }),
      },
      root: {
        dir: "row",
        w: CW,
        gap: 16,
        align: "center",
        justify: "between",
        pad: [14, 16],
      },
    },
    (root) => {
      b.text(root, "Label", b.ty("body"), muted, { key: "DtLbl" })
      b.text(root, "Value", b.ty("label", { align: "right" }), ink, { key: "DtVal" })
    },
  )

  const catRow = b.component(
    "Category row",
    {
      key: "CatRow",
      section: "Content",
      description:
        "Spend per category with a hairline share bar (Wise). Set the bar's Done and Left weights to the share.",
      props: {
        name: p.text("CrName", "Category"),
        amount: p.text("CrAmt", "$0.00"),
      },
      root: { dir: "row", w: CW, gap: 14, align: "center", pad: [11, 0] },
    },
    (root) => {
      const tile = b.row(root, "Icon", {
        w: 40,
        h: 40,
        radius: r("pill"),
        align: "center",
        justify: "center",
        fill: c("subtle"),
      })
      b.icon(tile, "house", 18, c("ink-2"), { key: "CrIcon" })
      const t = b.col(root, "Text", { w: FILL, gap: 7 })
      const line = b.row(t, "Line", { w: FILL, justify: "between", align: "baseline" })
      b.text(line, "Category", b.ty("label", { size: 16 }), ink, { key: "CrName" })
      b.text(line, "$0.00", b.ty("row"), ink, { key: "CrAmt" })
      const bar = b.row(t, "Bar", {
        w: FILL,
        h: 4,
        radius: r("pill"),
        fill: c("subtle"),
        clip: true,
      })
      b.rect(bar, "Done", { key: "CrDone", w: fill(50), h: 4, fill: c("accent") })
      b.rect(bar, "Left", { key: "CrLeft", w: fill(50), h: 4, fill: c("subtle") })
    },
  )
  const share = (n: number) => ({
    CrDone: { w: { mode: "fill", weight: n } },
    CrLeft: { w: { mode: "fill", weight: 100 - n } },
  })

  const monthBar = b.component(
    "Month bar",
    {
      key: "MBar",
      section: "Content",
      description:
        "One month of the spending chart: a pill rising from the axis. Set MbPill height to value / max × 150.",
      props: {
        month: p.text("MbLbl", "Sep"),
        state: p.variants({
          default: { "MbPill.fill": c("bar-dim"), "MbLbl.fill": muted },
          selected: { "MbPill.fill": c("accent"), "MbLbl.fill": ink },
        }),
      },
      root: { dir: "column", w: 40, gap: 8, align: "center" },
    },
    (root) => {
      const track = b.col(root, "Track", { w: FILL, h: 150, justify: "end", align: "center" })
      b.rect(track, "Pill", { key: "MbPill", w: 32, h: 100, radius: 16, fill: c("bar-dim") })
      b.text(root, "Sep", b.ty("small", { size: 12, weight: 500, align: "center" }), muted, {
        key: "MbLbl",
      })
    },
  )

  const settingRow = b.component(
    "Setting row",
    {
      key: "Setting",
      section: "Content",
      description: "List row with a value and chevron, or a toggle.",
      props: {
        label: p.text("SrLbl", "Setting"),
        value: p.text("SrVal", "Value"),
        showValue: p.bool("SrVal", true),
        showChevron: p.bool("SrChev", true),
        showToggle: p.bool("SrTgWrap", false),
        toggle: p.swap("SrToggle", toggle),
      },
      root: { dir: "row", w: CW, gap: 14, align: "center", pad: [14, 16] },
    },
    (root) => {
      b.icon(root, "lock", 20, c("ink-2"), { key: "SrIcon" })
      b.text(root, "Setting", b.ty("label", { size: 16 }), ink, {
        key: "SrLbl",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(root, "Value", b.ty("body"), muted, { key: "SrVal" })
      b.icon(root, "chevron-right", 18, muted, { key: "SrChev" })
      const tw = b.row(root, "Toggle", { key: "SrTgWrap", visible: false })
      b.use(tw, toggle, { key: "SrToggle" })
    },
  )

  // --- Screen helpers ----------------------------------------------------------------------------

  const page = b.page("Screens")
  type TabKey = "home" | "activity" | "send" | "cards" | "insights"
  function screen(
    name: string,
    opts: {
      tab?: TabKey
      slab?: boolean
      pad?: number[]
      gap?: number
      header?: (scr: string) => void
    } = {},
  ) {
    const scr = b.screen(page, name, {
      dir: "column",
      w: W,
      h: H,
      clip: true,
      fill: opts.slab ? c("slab") : c("bg"),
    })
    b.use(scr, statusBar, { props: { w: FILL }, args: { tone: opts.slab ? "slab" : "ink" } })
    opts.header?.(scr)
    const content = b.col(scr, "Content", {
      w: FILL,
      h: FILL,
      gap: opts.gap ?? 16,
      pad: opts.pad ?? [8, 20, 16, 20],
      clip: true,
    })
    const bottom = (fn?: (into: string) => void) => {
      if (opts.tab) b.use(scr, tabBar, { props: { w: FILL }, args: { active: opts.tab } })
      else {
        const bar = b.col(scr, "Bottom bar", { w: FILL, gap: 0 })
        if (fn) {
          const inner = b.col(bar, "Actions", { w: FILL, gap: 4, pad: [8, 20, 4, 20] })
          fn(inner)
        }
        b.use(bar, homeBar, { props: { w: FILL }, args: { tone: opts.slab ? "slab" : "ink" } })
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
  const group = (parent: string, name: string) =>
    b.col(parent, name, { w: FILL, radius: r("card"), fill: c("surface"), clip: true })
  const divide = (parent: string) => b.divider(parent, c("border"))
  function keypad(parent: string, left: "face" | "dot", slab: boolean, h = 56) {
    const pad = b.col(parent, "Keypad", { w: FILL, gap: 2 })
    const rows = [
      ["1", "2", "3"],
      ["4", "5", "6"],
      ["7", "8", "9"],
      [left, "0", "del"],
    ]
    for (const [i, keys] of rows.entries()) {
      const row = b.row(pad, `Row ${i + 1}`, { w: FILL, justify: "between", pad: [0, 3] })
      for (const k of keys) {
        const icon = k === "face" ? "scan-face" : k === "del" ? "delete" : null
        b.use(row, keypadKey, {
          props: { h },
          args: {
            ...(icon ? { kind: "icon" } : { digit: k === "dot" ? "." : k }),
            tone: slab ? "slab" : "ink",
          },
          ...(icon ? { set: { KeyIcon: { icon } } } : {}),
        })
      }
    }
  }

  // --- Data --------------------------------------------------------------------------------------

  type Tx = {
    name: string
    meta: string
    whole: string
    cents: string
    mono: string
    dir: "in" | "out"
  }
  const T: Record<string, Tx> = {
    grocers: {
      name: "Greenline Grocers",
      meta: "Groceries · 9:12",
      whole: "−$64",
      cents: ".20",
      mono: "GG",
      dir: "out",
    },
    coffee: {
      name: "Northside Coffee",
      meta: "Dining · 8:02",
      whole: "−$4",
      cents: ".75",
      mono: "NC",
      dir: "out",
    },
    salary: {
      name: "Fernhill Studio",
      meta: "Salary · 9:00",
      whole: "+$3,120",
      cents: ".00",
      mono: "FS",
      dir: "in",
    },
    transit: {
      name: "Portland Transit",
      meta: "Transport · 17:41",
      whole: "−$2",
      cents: ".80",
      mono: "PT",
      dir: "out",
    },
    priya: {
      name: "Priya Shah",
      meta: "Paid your request · 19:20",
      whole: "+$42",
      cents: ".00",
      mono: "PS",
      dir: "in",
    },
    lumen: {
      name: "Lumen Electric",
      meta: "Bills · Autopay",
      whole: "−$88",
      cents: ".34",
      mono: "LE",
      dir: "out",
    },
    books: {
      name: "Marlow Books",
      meta: "Shopping · 14:05",
      whole: "−$23",
      cents: ".50",
      mono: "MB",
      dir: "out",
    },
  }
  const tx = (parent: string, key: keyof typeof T, meta?: string) => {
    const t = T[key] as Tx
    b.use(parent, txRow, {
      props: { w: FILL },
      args: {
        name: t.name,
        meta: meta ?? t.meta,
        whole: t.whole,
        cents: t.cents,
        initials: t.mono,
        direction: t.dir,
      },
      set: { TxMono: { args: { initials: t.mono, tone: t.dir === "in" ? "accent" : "neutral" } } },
    })
  }

  // --- Cover -------------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Mobile app template",
    title: "Tidewell personal banking",
    description:
      "Passcode sign-in, a balance slab, grouped activity, a receipt, sending money, a frozen card and monthly insights for an iPhone bank. Light and dark tokens, one accent, no gradients.",
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
          gap: 14,
          pad: [20, 16],
          radius: 40,
          clip: true,
          fill: c("bg"),
          stroke: { paint: c("border"), width: 1 },
          effects: b.shadow("phone"),
          ...(dark ? { theme: { mode: "dark" } } : {}),
        })
      const a = phone("Home", false)
      const slab = b.col(a, "Slab", {
        w: FILL,
        gap: 14,
        pad: 18,
        radius: r("slab"),
        fill: c("slab"),
      })
      b.text(slab, "Everyday account", b.ty("small"), c("slab-muted"))
      b.use(slab, money, { args: { size: "xl", tone: "slab" } })
      const pills = b.row(slab, "Actions", { gap: 8 })
      b.use(pills, slabPill, { args: { label: "Add money" } })
      b.use(pills, slabPill, { args: { label: "Card" }, set: { SpIcon: { icon: "credit-card" } } })
      const list = b.col(a, "Recent", { w: FILL, gap: 0 })
      b.use(list, dayHead, { props: { w: FILL }, args: { day: "Today", total: "−$68.95" } })
      tx(list, "grocers")
      tx(list, "coffee")
      tx(list, "salary", "Salary · Monday")
      const d = phone("Insights", true)
      const ih = b.col(d, "Heading", { w: FILL, gap: 6 })
      b.text(ih, "Spent in September", b.ty("small"), muted)
      b.use(ih, money, { args: { whole: "$2,846", cents: ".10", size: "lg" } })
      const bars = b.row(d, "Months", { w: FILL, justify: "between", pad: [8, 4, 0, 4] })
      for (const [m, h, st] of [
        ["May", 131, "default"],
        ["Jun", 106, "default"],
        ["Jul", 138, "default"],
        ["Aug", 143, "default"],
        ["Sep", 126, "selected"],
        ["Oct", 77, "default"],
      ] as const)
        b.use(bars, monthBar, { args: { month: m, state: st }, set: { MbPill: { h } } })
      const cl = b.col(d, "Categories", { w: FILL, gap: 0 })
      for (const [name, amount, icon, n] of [
        ["Rent", "$1,450.00", "house", 51],
        ["Groceries", "$612.40", "shopping-basket", 22],
      ] as const)
        b.use(cl, catRow, {
          props: { w: FILL },
          args: { name, amount },
          set: { CrIcon: { icon }, ...share(n) },
        })
    },
  })

  // --- Sign in -----------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Sign in", { slab: true, pad: [8, 20, 8, 20], gap: 0 })
    const top = b.col(content, "Welcome", {
      w: FILL,
      h: FILL,
      gap: 22,
      align: "center",
      justify: "center",
      pad: [0, 0, 8, 0],
    })
    const mark = b.row(top, "Ripple mark", { w: 56, h: 56, justify: "center", align: "center" })
    for (const [size, k] of [
      [56, "Outer"],
      [36, "Middle"],
      [16, "Inner"],
    ] as const)
      b.ellipse(mark, k, {
        w: size,
        h: size,
        position: "absolute",
        x: (56 - size) / 2,
        y: (56 - size) / 2,
        meta: overlay,
        stroke: { paint: c("on-slab"), width: 2 },
      })
    const t = b.col(top, "Text", { w: FILL, gap: 8, align: "center" })
    b.text(t, "Welcome back, Daniel", b.ty("display", { size: 28, align: "center" }), c("on-slab"))
    b.text(t, "Enter your 6-digit passcode", b.ty("body", { align: "center" }), c("slab-muted"))
    const dots = b.row(top, "Passcode", { gap: 18, pad: [10, 0] })
    for (let i = 0; i < 6; i++)
      b.ellipse(dots, i < 4 ? "Filled" : "Empty", {
        w: 14,
        h: 14,
        ...(i < 4 ? { fill: c("on-slab") } : {}),
        stroke: { paint: i < 4 ? c("on-slab") : c("slab-muted"), width: 1.5 },
      })
    keypad(content, "face", true, 62)
    const foot = b.row(content, "Links", { w: FILL, justify: "between", pad: [16, 24, 12, 24] })
    b.text(foot, "Forgot passcode?", b.ty("label", { size: 14, weight: 600 }), c("on-slab"))
    b.text(foot, "Not Daniel?", b.ty("label", { size: 14 }), c("slab-muted"))
    bottom()
  }

  // --- Home --------------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Home", { tab: "home", gap: 16 })
    const head = b.row(content, "Header", { w: FILL, gap: 10, align: "center" })
    b.use(head, monogram, { args: { initials: "DR", size: "sm", tone: "accent" } })
    b.text(head, "Good morning, Daniel", b.ty("label", { size: 15 }), ink, {
      w: FILL,
      grow: "fixed-width",
    })
    b.use(head, iconBtn, { args: { variant: "surface" }, set: { IbIcon: { icon: "search" } } })
    b.use(head, iconBtn, { args: { variant: "surface" }, set: { IbIcon: { icon: "bell" } } })
    const slab = b.col(content, "Balance slab", {
      w: FILL,
      gap: 18,
      pad: 20,
      radius: r("slab"),
      fill: c("slab"),
    })
    const st = b.row(slab, "Account", { w: FILL, align: "center", justify: "between" })
    b.text(st, "Everyday account", b.ty("small", { weight: 500 }), c("slab-muted"))
    b.text(st, "•• 4821", b.ty("mono"), c("slab-muted"))
    b.use(slab, money, { args: { size: "xl", tone: "slab" } })
    const pills = b.row(slab, "Actions", { gap: 8 })
    b.use(pills, slabPill, { args: { label: "Add money" } })
    b.use(pills, slabPill, { args: { label: "Send" }, set: { SpIcon: { icon: "arrow-up-right" } } })
    b.use(pills, slabPill, { args: { label: "Card" }, set: { SpIcon: { icon: "credit-card" } } })
    const budget = b.col(content, "October budget", {
      w: FILL,
      gap: 10,
      pad: 16,
      radius: r("card"),
      fill: c("surface"),
    })
    const bl = b.row(budget, "Line", { w: FILL, justify: "between", align: "baseline" })
    b.text(bl, "Spent in October", b.ty("small", { weight: 500 }), muted)
    const left = b.row(bl, "Left", { align: "baseline", gap: 4 })
    b.text(left, "$1,457.45", b.ty("row", { size: 15 }), ink)
    b.text(left, "left of $3,200", b.ty("small"), muted)
    const bar = b.row(budget, "Bar", {
      w: FILL,
      h: 6,
      radius: r("pill"),
      fill: c("subtle"),
      clip: true,
    })
    b.rect(bar, "Spent", { w: fill(54), h: 6, fill: c("accent") })
    b.rect(bar, "Left", { w: fill(46), h: 6, fill: c("subtle") })
    const recent = b.col(content, "Activity", { w: FILL, gap: 0 })
    b.use(recent, sectionHead, {
      props: { w: FILL },
      args: { title: "Activity", action: "See all" },
    })
    const g1 = b.col(recent, "Today", { w: FILL, gap: 0, pad: [8, 0, 0, 0] })
    b.use(g1, dayHead, { props: { w: FILL }, args: { day: "Today", total: "−$68.95" } })
    tx(g1, "grocers")
    tx(g1, "coffee")
    const g2 = b.col(recent, "Yesterday", { w: FILL, gap: 0, pad: [8, 0, 0, 0] })
    b.use(g2, dayHead, { props: { w: FILL }, args: { day: "Yesterday", total: "+$3,117.20" } })
    tx(g2, "salary")
    tx(g2, "transit")
    bottom()
  }

  // --- Transactions ------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Transactions", { tab: "activity", gap: 14 })
    const head = b.row(content, "Header", { w: FILL, align: "center", justify: "between" })
    b.text(head, "Activity", b.ty("display"), ink)
    const act = b.row(head, "Actions", { gap: 8 })
    b.use(act, iconBtn, { args: { variant: "surface" }, set: { IbIcon: { icon: "search" } } })
    b.use(act, iconBtn, {
      args: { variant: "surface" },
      set: { IbIcon: { icon: "sliders-horizontal" } },
    })
    const chips = b.row(content, "Filters", { w: FILL, gap: 8 })
    b.use(chips, chip, { args: { label: "All", state: "selected" } })
    b.use(chips, chip, { args: { label: "Money in" } })
    b.use(chips, chip, { args: { label: "Money out" } })
    b.use(chips, chip, { args: { label: "Cards" } })
    const groups: [string, string, (keyof typeof T)[], (string | undefined)[]][] = [
      ["Today", "−$68.95", ["grocers", "coffee"], [undefined, undefined]],
      ["Yesterday", "+$3,117.20", ["salary", "transit"], [undefined, undefined]],
      ["Sunday, October 4", "−$46.34", ["priya", "lumen"], [undefined, undefined]],
      ["Saturday, October 3", "−$23.50", ["books"], [undefined]],
    ]
    for (const [day, total, keys] of groups) {
      const g = b.col(content, day, { w: FILL, gap: 0 })
      b.use(g, dayHead, { props: { w: FILL }, args: { day, total } })
      for (const k of keys) tx(g, k)
    }
    bottom()
  }

  // --- Transaction detail ------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Transaction detail", {
      header: header("Transaction", "share"),
      pad: [8, 20, 8, 20],
      gap: 20,
    })
    const hero = b.col(content, "Summary", { w: FILL, gap: 10, align: "center", pad: [4, 0, 0, 0] })
    b.use(hero, monogram, { args: { initials: "GG", size: "lg", tone: "neutral" } })
    b.text(hero, "Greenline Grocers", b.ty("heading", { align: "center" }), ink)
    b.use(hero, money, { args: { whole: "−$64", cents: ".20", size: "xl" } })
    b.text(hero, "Today, 9:12 · Card payment", b.ty("small", { align: "center" }), muted)
    const chips = b.row(hero, "Tags", { gap: 8, pad: [6, 0, 0, 0] })
    b.use(chips, chip, {
      args: { label: "Groceries", icon: true },
      set: { ChIcon: { icon: "shopping-basket" } },
    })
    b.use(chips, chip, {
      args: { label: "Everyday •• 4821", icon: true },
      set: { ChIcon: { icon: "credit-card" } },
    })
    const rows = group(content, "Details")
    const list: [string, string, string?][] = [
      ["Category", "Groceries"],
      ["Location", "SE Hawthorne Blvd, Portland"],
      ["Reference", "TW-2610-58213", "code"],
      ["Balance after", "$8,214.37"],
    ]
    list.forEach(([label, value, kind], i) => {
      if (i) divide(rows)
      b.use(rows, detailRow, {
        props: { w: FILL },
        args: { label, value, ...(kind ? { mono: kind } : {}) },
      })
    })
    const more = b.row(content, "History", {
      w: FILL,
      gap: 12,
      align: "center",
      pad: [14, 16],
      radius: r("card"),
      fill: c("surface"),
    })
    b.icon(more, "history", 20, c("ink-2"))
    b.text(more, "14 payments to Greenline in 2026", b.ty("label", { size: 15 }), ink, {
      w: FILL,
      grow: "fixed-width",
    })
    b.icon(more, "chevron-right", 18, muted)
    bottom((into) => {
      b.use(into, button, {
        props: { w: FILL },
        args: { label: "Split this payment", variant: "outline" },
      })
      b.use(into, button, {
        props: { w: FILL },
        args: { label: "Report a problem", variant: "text" },
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
    const to = b.row(content, "Recipient", {
      w: FILL,
      gap: 12,
      align: "center",
      pad: [12, 14],
      radius: r("card"),
      fill: c("surface"),
    })
    b.use(to, monogram, { args: { initials: "PS", size: "sm", tone: "accent" } })
    const tt = b.col(to, "Text", { w: FILL, gap: 1 })
    b.text(tt, "Priya Shah", b.ty("label", { size: 16 }), ink)
    b.text(tt, "Tidewell •• 3390", b.ty("small"), muted)
    b.text(to, "Change", b.ty("label", { size: 14, weight: 600 }), c("accent"))
    const amt = b.col(content, "Amount", { w: FILL, gap: 10, align: "center", pad: [14, 0, 6, 0] })
    b.use(amt, money, { args: { whole: "$120", cents: ".00", size: "xl" } })
    const from = b.row(amt, "From", { gap: 6, align: "center" })
    b.text(from, "From Everyday · $8,214.37 available", b.ty("small"), muted)
    const quick = b.row(content, "Quick amounts", { w: FILL, gap: 8, justify: "center" })
    for (const [l, st] of [
      ["$25", "default"],
      ["$50", "default"],
      ["$120", "selected"],
      ["$250", "default"],
    ] as const)
      b.use(quick, chip, { args: { label: l, state: st } })
    const note = b.row(content, "Note", {
      w: FILL,
      gap: 10,
      align: "center",
      pad: [12, 14],
      radius: r("lg"),
      stroke: { paint: c("border") },
    })
    b.icon(note, "pencil", 16, muted)
    b.text(note, "Concert tickets", b.ty("body"), ink)
    keypad(content, "dot", false, 60)
    bottom((into) =>
      b.use(into, button, { props: { w: FILL }, args: { label: "Review and send", icon: true } }),
    )
  }

  // --- Cards -------------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Cards", { tab: "cards", gap: 16 })
    const head = b.row(content, "Header", { w: FILL, align: "center", justify: "between" })
    b.text(head, "Cards", b.ty("display"), ink)
    b.use(head, iconBtn, { args: { variant: "surface" }, set: { IbIcon: { icon: "plus" } } })
    const tabs = b.row(content, "Card tabs", { w: FILL, gap: 20, align: "center" })
    b.text(tabs, "Everyday", b.ty("label", { size: 15 }), muted)
    const sel = b.col(tabs, "Travel", { gap: 4 })
    b.text(sel, "Travel", b.ty("label", { size: 15, weight: 650 }), ink)
    b.rect(sel, "Underline", { w: FILL, h: 2, radius: 1, fill: ink })
    b.use(content, bankCard, {
      props: { w: FILL },
      args: { state: "frozen", kind: "Travel debit", last4: "•••• 7735", expiry: "03/28" },
    })
    const chips = b.row(content, "Card actions", { w: FILL, gap: 8 })
    b.use(chips, chip, {
      args: { label: "Unfreeze", icon: true, state: "selected" },
      set: { ChIcon: { icon: "snowflake" } },
    })
    b.use(chips, chip, {
      args: { label: "Limits", icon: true },
      set: { ChIcon: { icon: "gauge" } },
    })
    b.use(chips, chip, { args: { label: "Details", icon: true }, set: { ChIcon: { icon: "eye" } } })
    const info = group(content, "Card details")
    const dl = b.col(info, "Limit", { w: FILL, gap: 10, pad: 16 })
    const dlt = b.row(dl, "Line", { w: FILL, justify: "between", align: "baseline" })
    b.text(dlt, "Daily limit", b.ty("body"), muted)
    b.text(dlt, "$2,000", b.ty("row", { size: 16 }), ink)
    b.row(dl, "Bar", { w: FILL, h: 6, radius: r("pill"), fill: c("subtle") })
    b.text(dl, "$0.00 spent today. Frozen since Oct 5, 21:40.", b.ty("small"), muted)
    divide(info)
    for (const [i, [label, on, icon]] of (
      [
        ["Freeze card", true, "snowflake"],
        ["Online payments", false, "globe"],
        ["Contactless", false, "nfc"],
        ["Show PIN", false, "eye"],
      ] as const
    ).entries()) {
      if (i) divide(info)
      b.use(info, settingRow, {
        props: { w: FILL },
        args: {
          label,
          showValue: false,
          showChevron: label === "Show PIN",
          showToggle: label !== "Show PIN",
          ...(on ? {} : { toggle: toggleOff }),
        },
        set: { SrIcon: { icon } },
      })
    }
    bottom()
  }

  // --- Insights ----------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Insights", { tab: "insights", gap: 16 })
    const head = b.row(content, "Header", { w: FILL, align: "center", justify: "between" })
    b.text(head, "Insights", b.ty("display"), ink)
    const rng = b.row(head, "Range", { gap: 6 })
    b.use(rng, chip, { args: { label: "3M" } })
    b.use(rng, chip, { args: { label: "6M", state: "selected" } })
    b.use(rng, chip, { args: { label: "1Y" } })
    const sum = b.col(content, "Summary", { w: FILL, gap: 6 })
    b.text(sum, "Spent in September", b.ty("small", { weight: 500 }), muted)
    b.use(sum, money, { args: { whole: "$2,846", cents: ".10", size: "lg" } })
    const dl = b.row(sum, "Change", { gap: 6, align: "center" })
    b.icon(dl, "arrow-down-right", 15, c("credit"))
    b.text(dl, "12% less than August", b.ty("small", { weight: 600 }), c("credit"))
    const chart = b.row(content, "Chart", {
      w: FILL,
      h: 182,
      justify: "between",
      align: "start",
      pad: [8, 36, 0, 0],
    })
    for (const [y, label] of [
      [17, "$3k"],
      [84, "$1.5k"],
    ] as const) {
      b.rect(chart, "Gridline", {
        x: 0,
        y: 8 + y,
        w: 350,
        h: 1,
        position: "absolute",
        meta: overlay,
        fill: c("border"),
      })
      b.text(chart, label, b.ty("small", { size: 11, align: "right" }), muted, {
        x: 310,
        y: 8 + y - 16,
        position: "absolute",
        meta: overlay,
      })
    }
    for (const [m, h, st] of [
      ["May", 131, "default"],
      ["Jun", 106, "default"],
      ["Jul", 138, "default"],
      ["Aug", 143, "default"],
      ["Sep", 126, "selected"],
      ["Oct", 77, "default"],
    ] as const)
      b.use(chart, monthBar, { args: { month: m, state: st }, set: { MbPill: { h } } })
    const list = b.col(content, "Categories", { w: FILL, gap: 0 })
    b.use(list, sectionHead, {
      props: { w: FILL },
      args: { title: "By category", action: "All 6" },
    })
    for (const [name, amount, icon, n] of [
      ["Rent", "$1,450.00", "house", 51],
      ["Groceries", "$612.40", "shopping-basket", 22],
      ["Dining", "$318.75", "coffee", 11],
    ] as const)
      b.use(list, catRow, {
        props: { w: FILL },
        args: { name, amount },
        set: { CrIcon: { icon }, ...share(n) },
      })
    const rec = b.row(content, "Recurring", {
      w: FILL,
      gap: 12,
      align: "center",
      pad: [14, 16],
      radius: r("card"),
      fill: c("surface"),
    })
    b.icon(rec, "repeat", 20, c("ink-2"))
    const rt = b.col(rec, "Text", { w: FILL, gap: 1 })
    b.text(rt, "Recurring payments", b.ty("label", { size: 15 }), ink)
    b.text(rt, "7 payments · $412.60 a month", b.ty("small"), muted)
    b.icon(rec, "chevron-right", 18, muted)
    bottom()
  }
}
