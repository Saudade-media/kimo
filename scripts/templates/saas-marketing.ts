/**
 * Ledgerline: the marketing site of a fictional month-end close tool for finance teams.
 * Screens: Home, Pricing, Customers, Blog, Blog post, Sign up (desktop, 1440 wide).
 *
 * Look: a ledger page. Paper ground, ink type, hairline rules, JetBrains Mono for every figure and
 * index label, one highlighter-yellow action per view. See the references in the brief:
 * Ramp (hero), Assembly and Speakeasy (pricing), Amplemarket and Grammarly (customers),
 * Supabase and Klaviyo (sign up).
 */
import { FILL, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "saas-marketing",
  name: "Ledgerline marketing site",
  category: "Website",
  description:
    "Six-screen marketing site for a B2B finance tool: home, pricing, customers, blog, article and sign-up.",
  prefix: "lm",
  build,
}

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F4F1E9", "#0E110F"],
      surface: ["#FBF9F4", "#151916"],
      subtle: ["#EBE7DB", "#1C211D"],
      ink: ["#11140F", "#ECEEE6"],
      "on-ink": ["#F4F1E9", "#0E110F"],
      muted: ["#5C6058", "#979C92"],
      border: ["#D8D3C4", "#2A302B"],
      "border-strong": ["#B9B3A1", "#434A44"],
      accent: ["#0F4A36", "#74D8A6"],
      "on-accent": ["#F4F1E9", "#0E110F"],
      mark: ["#E4F06B", "#D5E25A"],
      "on-mark": ["#11140F", "#11140F"],
      success: ["#1B7F4F", "#5FCF98"],
      "success-soft": ["#DCEBDD", "#16301F"],
      warning: ["#9A5A07", "#EDB24E"],
      "warning-soft": ["#F4E3C0", "#33250D"],
      danger: ["#B03A2A", "#F08A78"],
      "danger-soft": ["#F3D9D2", "#3A1C17"],
      inverse: ["#0C2A20", "#08150F"],
      "on-inverse": ["#F2EFE6", "#ECEEE6"],
      "inverse-muted": ["#9DB5A8", "#8CA699"],
      "inverse-line": ["#24473A", "#1D3A2D"],
      "tile-mint": ["#CFE6D3", "#1B3828"],
      "tile-butter": ["#F1E4AA", "#463C12"],
      "tile-lilac": ["#DAD4EE", "#2B2749"],
      "tile-blush": ["#F3D4CA", "#4A2820"],
      "tile-sky": ["#CDE0EA", "#193241"],
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
      "space/20": 80,
      "space/24": 96,
      "space/30": 120,
      "radius/sm": 4,
      "radius/md": 6,
      "radius/lg": 10,
      "radius/xl": 16,
      "radius/pill": 999,
    },
    type: {
      display: { font: "Inter", size: 76, weight: 600, lineHeight: 0.98, letterSpacing: -3.2 },
      h1: { font: "Inter", size: 52, weight: 600, lineHeight: 1.04, letterSpacing: -2 },
      heading: { font: "Inter", size: 32, weight: 600, lineHeight: 1.15, letterSpacing: -1 },
      title: { font: "Inter", size: 20, weight: 600, lineHeight: 1.3, letterSpacing: -0.3 },
      "body-lg": { font: "Inter", size: 19, weight: 400, lineHeight: 1.55, letterSpacing: -0.1 },
      body: { font: "Inter", size: 16, weight: 400, lineHeight: 1.55 },
      label: { font: "Inter", size: 14, weight: 600, lineHeight: 1.3 },
      small: { font: "Inter", size: 13, weight: 400, lineHeight: 1.45 },
      figure: { font: "Inter", size: 64, weight: 600, lineHeight: 1, letterSpacing: -3 },
      mono: { font: "JetBrains Mono", size: 13, weight: 500, lineHeight: 1.4 },
    },
    shadows: {
      stage: [
        { kind: "shadow", x: 0, y: 1, blur: 1, color: "#11140F14" },
        { kind: "shadow", x: 0, y: 24, blur: 48, spread: -24, color: "#11140F33" },
      ],
    },
  })

  const c = (n: string) => b.c(n)
  const s = (n: number) => b.n(`space/${n}`)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  /** Mono caps label (indices, plan names, column heads). */
  const cap = (extra: Record<string, unknown> = {}) =>
    b.ty("mono", { size: 12, case: "upper", letterSpacing: 0.8, ...extra })

  // --- Components ------------------------------------------------------------------------------

  const button = b.component(
    "Button",
    {
      key: "Btn",
      section: "Actions",
      description:
        "Ink, highlighter or outline; md or lg. The highlighter is the one action per view.",
      props: {
        label: p.text("BtnLabel", "Button"),
        icon: p.bool("BtnIcon", false),
        variant: p.variants({
          primary: {
            "root.fill": ink,
            "root.stroke": { paint: ink },
            "BtnLabel.fill": c("on-ink"),
            "BtnIcon.color": c("on-ink"),
          },
          mark: {
            "root.fill": c("mark"),
            "root.stroke": { paint: c("mark") },
            "BtnLabel.fill": c("on-mark"),
            "BtnIcon.color": c("on-mark"),
          },
          outline: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border-strong") },
            "BtnLabel.fill": ink,
            "BtnIcon.color": ink,
          },
          inverse: {
            "root.fill": c("inverse"),
            "root.stroke": { paint: c("inverse-line") },
            "BtnLabel.fill": c("on-inverse"),
            "BtnIcon.color": c("on-inverse"),
          },
        }),
        size: p.variants({
          md: { "root.layout/pad": [10, 16], "BtnLabel.style/size": 14 },
          lg: { "root.layout/pad": [15, 24], "BtnLabel.style/size": 16 },
        }),
      },
      root: {
        dir: "row",
        gap: 8,
        align: "center",
        justify: "center",
        pad: [10, 16],
        radius: r("md"),
        fill: ink,
        stroke: { paint: ink },
      },
    },
    (root) => {
      b.text(root, "Button", b.ty("label"), c("on-ink"), { key: "BtnLabel", name: "Label" })
      b.icon(root, "arrow-right", 16, c("on-ink"), { key: "BtnIcon", visible: false })
    },
  )
  const buttonOutline = b.derive(button, "Button/Outline", "BtnOut", {
    section: "Actions",
    args: { variant: "outline" },
  })

  const tag = b.component(
    "Tag",
    {
      key: "Tag",
      section: "Actions",
      description: "Mono caps chip for categories and states.",
      props: {
        label: p.text("TagLbl", "Tag"),
        tone: p.variants({
          neutral: { "root.fill": c("subtle"), "TagLbl.fill": muted },
          mark: { "root.fill": c("mark"), "TagLbl.fill": c("on-mark") },
          success: { "root.fill": c("success-soft"), "TagLbl.fill": c("success") },
          warning: { "root.fill": c("warning-soft"), "TagLbl.fill": c("warning") },
          danger: { "root.fill": c("danger-soft"), "TagLbl.fill": c("danger") },
          outline: { "root.fill": c("surface"), "TagLbl.fill": ink },
        }),
      },
      root: { dir: "row", pad: [3, 7], radius: r("sm"), fill: c("subtle") },
    },
    (root) => b.text(root, "Tag", cap({ size: 11 }), muted, { key: "TagLbl", name: "Label" }),
  )

  const avatar = b.component(
    "Avatar",
    {
      key: "Avatar",
      section: "Content",
      props: {
        initials: p.text("AvInit", "MO"),
        size: p.variants({
          sm: { "root.w": 24, "root.h": 24, "AvInit.style/size": 10 },
          md: { "root.w": 36, "root.h": 36, "AvInit.style/size": 13 },
          lg: { "root.w": 56, "root.h": 56, "AvInit.style/size": 18 },
        }),
        tone: p.variants({
          mint: { "root.fill": c("tile-mint") },
          butter: { "root.fill": c("tile-butter") },
          lilac: { "root.fill": c("tile-lilac") },
          blush: { "root.fill": c("tile-blush") },
          sky: { "root.fill": c("tile-sky") },
        }),
      },
      root: {
        dir: "row",
        w: 36,
        h: 36,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("tile-mint"),
      },
    },
    (root) =>
      b.text(root, "MO", b.ty("label", { size: 13, weight: 600 }), ink, {
        key: "AvInit",
        name: "Initials",
      }),
  )

  function brand(parent: string, onInverse = false) {
    const row = b.row(parent, "Brand", { gap: 10, align: "center" })
    const mark = b.col(row, "Mark", { gap: 3, w: 22 })
    const col = onInverse ? c("on-inverse") : ink
    b.rect(mark, "Rule", { w: 22, h: 5, radius: 1, fill: col })
    b.rect(mark, "Rule", { w: 22, h: 5, radius: 1, fill: col })
    b.rect(mark, "Rule", { w: 12, h: 5, radius: 1, fill: c("mark") })
    b.text(row, "Ledgerline", b.ty("title", { size: 21, letterSpacing: -0.8 }), col, {
      name: "Wordmark",
    })
    return row
  }

  const navLinks = ["Product", "Pricing", "Customers", "Blog"] as const
  const navActive = (i: number) =>
    Object.fromEntries(navLinks.map((_, j) => [`NavL${j + 1}.fill`, j === i ? ink : muted]))
  const navBar = b.component(
    "Nav bar",
    {
      key: "NavBar",
      section: "Navigation",
      props: {
        active: p.variants({
          product: navActive(0),
          pricing: navActive(1),
          customers: navActive(2),
          blog: navActive(3),
        }),
      },
      root: {
        dir: "row",
        w: 1440,
        justify: "between",
        align: "center",
        pad: [18, 120],
        fill: c("bg"),
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const left = b.row(root, "Left", { gap: 48, align: "center" })
      brand(left)
      const links = b.row(left, "Links", { gap: 28, align: "center" })
      for (const [i, l] of navLinks.entries())
        b.text(links, l, b.ty("body", { size: 15, weight: 500 }), i === 0 ? ink : muted, {
          key: `NavL${i + 1}`,
        })
      const right = b.row(root, "Actions", { gap: 24, align: "center" })
      b.text(right, "Sign in", b.ty("body", { size: 15, weight: 500 }), ink)
      b.use(right, button, { key: "NavCta", args: { label: "Start free trial" } })
    },
  )

  const footer = b.component(
    "Footer",
    {
      key: "Footer",
      section: "Navigation",
      root: {
        dir: "column",
        w: 1440,
        gap: 56,
        pad: [72, 120, 40, 120],
        fill: c("bg"),
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      const top = b.row(root, "Top", { w: FILL, gap: 64 })
      const about = b.col(top, "About", { w: 400, gap: 20 })
      brand(about)
      b.para(
        about,
        "Month-end close for finance teams on NetSuite, Sage Intacct, QuickBooks and Xero.",
        b.ty("body"),
        muted,
      )
      const status = b.row(about, "Status", { gap: 8, align: "center" })
      b.ellipse(status, "Dot", { w: 8, h: 8, fill: c("success") })
      b.text(status, "All systems normal", cap({ size: 11 }), muted)
      for (const [title, items] of [
        ["Product", ["Close checklist", "Reconciliations", "Flux review", "Integrations"]],
        ["Company", ["About", "Customers", "Careers", "Press"]],
        ["Resources", ["Blog", "Close guide", "Help center", "Security"]],
      ] as const) {
        const col = b.col(top, title, { w: FILL, gap: 14 })
        b.text(col, title, cap({ size: 11 }), muted)
        for (const it of items) b.text(col, it, b.ty("body", { size: 15 }), ink)
      }
      b.divider(root, c("border"))
      const bottom = b.row(root, "Bottom", { w: FILL, justify: "between", align: "center" })
      b.text(bottom, "Copyright 2026 Ledgerline, Inc.", cap({ size: 11 }), muted)
      b.text(bottom, "Privacy  /  Terms  /  Security", cap({ size: 11 }), muted)
    },
  )

  const indexLabel = b.component(
    "Index label",
    {
      key: "Idx",
      section: "Content",
      description: "Section opener: hairline, mono index and mono caps title.",
      props: { index: p.text("IdxNum", "01"), title: p.text("IdxTitle", "Section") },
      root: {
        dir: "row",
        w: 1200,
        gap: 24,
        pad: [14, 0, 0, 0],
        stroke: { paint: ink, width: { t: 1 } },
      },
    },
    (root) => {
      b.text(root, "01", cap(), ink, { key: "IdxNum", name: "Index" })
      b.text(root, "Section", cap(), muted, { key: "IdxTitle", name: "Title" })
    },
  )

  const stat = b.component(
    "Stat",
    {
      key: "Stat",
      section: "Content",
      props: {
        value: p.text("StatVal", "0"),
        label: p.text("StatLbl", "Metric"),
        tone: p.variants({
          default: { "StatVal.fill": ink, "StatLbl.fill": muted },
          inverse: { "StatVal.fill": c("on-inverse"), "StatLbl.fill": c("inverse-muted") },
        }),
      },
      root: { dir: "column", w: 300, gap: 14 },
    },
    (root) => {
      b.text(root, "0", b.ty("figure"), ink, { key: "StatVal", name: "Value" })
      b.para(root, "Metric", b.ty("body", { size: 15 }), muted, { key: "StatLbl", name: "Label" })
    },
  )

  const ledgerRow = b.component(
    "Ledger row",
    {
      key: "LRow",
      section: "Ledger",
      description: "One account line: code, name, balance, variance and state.",
      props: {
        code: p.text("LrCode", "1010"),
        name: p.text("LrName", "Operating account"),
        balance: p.text("LrBal", "412,908.14"),
        variance: p.text("LrVar", "+0.0%"),
        state: p.variants({
          tied: {
            "LrIcon.icon": "check",
            "LrIcon.color": c("success"),
            "LrState.content": "Tied",
            "LrState.fill": c("success"),
            "LrVar.fill": muted,
          },
          review: {
            "LrIcon.icon": "circle-alert",
            "LrIcon.color": c("warning"),
            "LrState.content": "In review",
            "LrState.fill": c("warning"),
            "LrVar.fill": c("danger"),
          },
          open: {
            "LrIcon.icon": "circle",
            "LrIcon.color": c("border-strong"),
            "LrState.content": "Open",
            "LrState.fill": muted,
            "LrVar.fill": muted,
          },
        }),
      },
      root: {
        dir: "row",
        w: 760,
        gap: 16,
        pad: [0, 20],
        h: 48,
        align: "center",
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.para(root, "1010", b.ty("mono"), muted, { key: "LrCode", name: "Code", w: 48 })
      b.para(root, "Operating account", b.ty("label", { weight: 500 }), ink, {
        key: "LrName",
        name: "Name",
      })
      b.para(root, "412,908.14", b.ty("mono", { align: "right" }), ink, {
        key: "LrBal",
        name: "Balance",
        w: 120,
      })
      b.para(root, "+0.0%", b.ty("mono", { align: "right" }), muted, {
        key: "LrVar",
        name: "Variance",
        w: 72,
      })
      const st = b.row(root, "State", { w: 104, gap: 6, align: "center" })
      b.icon(st, "check", 14, c("success"), { key: "LrIcon" })
      b.text(st, "Tied", b.ty("small", { weight: 500 }), c("success"), { key: "LrState" })
    },
  )

  const ledgerTable = b.component(
    "Ledger table",
    {
      key: "LTab",
      section: "Ledger",
      description: "The product object shown on the site. Fill the Rows slot with Ledger rows.",
      props: {
        title: p.text("LtTitle", "September 2026 close"),
        meta: p.text("LtMeta", "Day 3 of 5"),
        total: p.text("LtTotal", "58 accounts"),
        rows: p.slot("LtRows"),
      },
      root: {
        dir: "column",
        w: 760,
        radius: r("lg"),
        fill: c("surface"),
        stroke: { paint: c("border") },
        effects: b.shadow("stage"),
        clip: true,
      },
    },
    (root) => {
      const head = b.row(root, "Head", {
        w: FILL,
        pad: [16, 20],
        justify: "between",
        align: "center",
        stroke: { paint: c("border"), width: { b: 1 } },
      })
      b.text(head, "September 2026 close", b.ty("label", { size: 15 }), ink, { key: "LtTitle" })
      b.text(head, "Day 3 of 5", cap({ size: 11 }), muted, { key: "LtMeta" })
      const cols = b.row(root, "Columns", {
        w: FILL,
        gap: 16,
        pad: [9, 20],
        fill: c("subtle"),
        stroke: { paint: c("border"), width: { b: 1 } },
      })
      b.para(cols, "Acct", cap({ size: 10 }), muted, { w: 48 })
      b.para(cols, "Account", cap({ size: 10 }), muted)
      b.para(cols, "Balance, USD", cap({ size: 10, align: "right" }), muted, { w: 120 })
      b.para(cols, "vs Aug", cap({ size: 10, align: "right" }), muted, { w: 72 })
      b.para(cols, "State", cap({ size: 10 }), muted, { w: 104 })
      b.col(root, "Rows", { key: "LtRows", w: FILL, slot: { suggested: [ledgerRow] } })
      const foot = b.row(root, "Foot", { w: FILL, pad: [14, 20], justify: "between" })
      b.text(foot, "58 accounts", cap({ size: 11 }), muted, { key: "LtTotal" })
      b.text(foot, "Last read from NetSuite 14:02", cap({ size: 11 }), muted)
    },
  )

  const wordmark = b.component(
    "Wordmark",
    {
      key: "Wm",
      section: "Content",
      description: "Typographic customer mark. Each style is set in Inter or Mono only.",
      props: {
        name: p.text("WmText", "Company"),
        style: p.variants({
          tight: {
            "WmText.style/weight": 700,
            "WmText.style/letterSpacing": -1,
          },
          caps: {
            "WmText.style/weight": 500,
            "WmText.style/letterSpacing": 2.4,
          },
          light: {
            "WmText.style/weight": 300,
            "WmText.style/letterSpacing": -0.6,
          },
          black: {
            "WmText.style/weight": 800,
            "WmText.style/letterSpacing": -1.6,
          },
        }),
        tone: p.variants({
          muted: { "WmText.fill": muted },
          ink: { "WmText.fill": ink },
        }),
      },
      root: { dir: "row", align: "center" },
    },
    (root) =>
      b.text(root, "Company", b.ty("title", { size: 20, weight: 700, letterSpacing: -1 }), muted, {
        key: "WmText",
        name: "Name",
      }),
  )

  const storyTile = b.component(
    "Story tile",
    {
      key: "Story",
      section: "Customers",
      description: "Metric first. Flat tile, company bottom left.",
      props: {
        metric: p.text("StMetric", "40%"),
        caption: p.text("StCap", "What changed."),
        company: p.text("StCo/WmText", "Company"),
        tone: p.variants({
          mint: { "root.fill": c("tile-mint") },
          butter: { "root.fill": c("tile-butter") },
          lilac: { "root.fill": c("tile-lilac") },
          blush: { "root.fill": c("tile-blush") },
          sky: { "root.fill": c("tile-sky") },
        }),
      },
      root: {
        dir: "column",
        w: 288,
        h: 240,
        pad: 24,
        justify: "between",
        radius: r("lg"),
        fill: c("tile-mint"),
      },
    },
    (root) => {
      const top = b.col(root, "Top", { w: FILL, gap: 8 })
      b.text(top, "40%", b.ty("figure", { size: 56 }), ink, { key: "StMetric", name: "Metric" })
      b.para(top, "What changed.", b.ty("body", { size: 15 }), ink, {
        key: "StCap",
        name: "Caption",
      })
      const foot = b.row(root, "Footer", { w: FILL, justify: "between", align: "center" })
      b.use(foot, wordmark, { key: "StCo", args: { tone: "ink" } })
      b.icon(foot, "arrow-up-right", 18, ink)
    },
  )

  const storyFeature = b.component(
    "Story feature",
    {
      key: "StoryF",
      section: "Customers",
      description: "Large story tile: one headline sentence and two figures.",
      props: {
        headline: p.text("SfHead", "How a team changed its close."),
        m1: p.text("SfM1V", "4 days"),
        m1Label: p.text("SfM1L", "Median close"),
        m2: p.text("SfM2V", "140"),
        m2Label: p.text("SfM2L", "Reconciliations"),
        company: p.text("SfCo/WmText", "Company"),
        tone: p.variants({
          mint: { "root.fill": c("tile-mint") },
          butter: { "root.fill": c("tile-butter") },
          lilac: { "root.fill": c("tile-lilac") },
        }),
      },
      root: {
        dir: "column",
        w: 588,
        h: 392,
        pad: 32,
        justify: "between",
        radius: r("lg"),
        fill: c("tile-mint"),
      },
    },
    (root) => {
      const hd = b.col(root, "Head", { w: FILL, gap: 24 })
      const top = b.row(hd, "Top", { w: FILL, justify: "between", align: "center" })
      b.use(top, wordmark, { key: "SfCo", args: { tone: "ink" } })
      b.text(top, "Case study", cap({ size: 11 }), ink)
      b.para(hd, "How a team changed its close.", b.ty("heading", { size: 30 }), ink, {
        key: "SfHead",
        name: "Headline",
      })
      const nums = b.row(root, "Figures", { w: FILL, gap: 12 })
      for (const [vk, lk, v, l] of [
        ["SfM1V", "SfM1L", "4 days", "Median close"],
        ["SfM2V", "SfM2L", "140", "Reconciliations"],
      ] as const) {
        const box = b.col(nums, "Figure", {
          w: FILL,
          gap: 4,
          pad: [16, 18],
          radius: r("md"),
          stroke: { paint: ink },
        })
        b.text(box, v, b.ty("figure", { size: 40 }), ink, { key: vk, name: "Value" })
        b.text(box, l, b.ty("small"), ink, { key: lk, name: "Label" })
      }
    },
  )

  const checkRow = b.component(
    "Check row",
    {
      key: "Check",
      section: "Pricing",
      props: {
        label: p.text("CkLbl", "Included feature"),
        state: p.variants({
          included: { "CkIcon.icon": "check", "CkIcon.color": c("success"), "CkLbl.fill": ink },
          excluded: { "CkIcon.icon": "minus", "CkIcon.color": muted, "CkLbl.fill": muted },
          onDark: {
            "CkIcon.icon": "check",
            "CkIcon.color": c("mark"),
            "CkLbl.fill": c("on-inverse"),
          },
        }),
      },
      root: { dir: "row", w: 320, gap: 10, align: "center" },
    },
    (root) => {
      b.icon(root, "check", 16, c("success"), { key: "CkIcon" })
      b.para(root, "Included feature", b.ty("body", { size: 15 }), ink, {
        key: "CkLbl",
        name: "Label",
      })
    },
  )

  const planColumn = b.component(
    "Plan column",
    {
      key: "Plan",
      section: "Pricing",
      description:
        "Plan column. Fill the Features slot with Check rows; set tone to featured for the inverted plan.",
      props: {
        plan: p.text("PlName", "Starter"),
        price: p.text("PlPrice", "$149"),
        period: p.text("PlPer", "per month, billed annually"),
        description: p.text("PlDesc", "Who the plan is for."),
        ctaLabel: p.text("PlCta/BtnLabel", "Start free trial"),
        features: p.slot("PlFeat"),
        tone: p.variants({
          standard: {
            "root.fill": c("surface"),
            "PlName.fill": muted,
            "PlPrice.fill": ink,
            "PlPer.fill": muted,
            "PlDesc.fill": ink,
            "PlIncl.fill": muted,
            "PlRule.fill": c("border"),
          },
          featured: {
            "root.fill": c("inverse"),
            "PlName.fill": c("mark"),
            "PlPrice.fill": c("on-inverse"),
            "PlPer.fill": c("inverse-muted"),
            "PlDesc.fill": c("on-inverse"),
            "PlIncl.fill": c("inverse-muted"),
            "PlRule.fill": c("inverse-line"),
          },
        }),
      },
      root: { dir: "column", w: 400, gap: 24, pad: 32, fill: c("surface") },
    },
    (root) => {
      b.text(root, "Starter", cap(), muted, { key: "PlName", name: "Plan" })
      const price = b.col(root, "Price", { w: FILL, gap: 6 })
      b.text(price, "$149", b.ty("figure", { size: 72 }), ink, { key: "PlPrice" })
      b.text(price, "per month, billed annually", cap({ size: 11 }), muted, { key: "PlPer" })
      b.para(root, "Who the plan is for.", b.ty("body", { size: 16 }), ink, { key: "PlDesc" })
      b.use(root, button, {
        key: "PlCta",
        props: { w: FILL },
        args: { label: "Start free trial", size: "lg" },
      })
      b.rect(root, "Rule", { key: "PlRule", w: FILL, h: 1, fill: c("border") })
      b.text(root, "Includes", cap({ size: 11 }), muted, { key: "PlIncl" })
      b.col(root, "Features", { key: "PlFeat", w: FILL, gap: 12, slot: { suggested: [checkRow] } })
    },
  )

  const compareRow = b.component(
    "Compare row",
    {
      key: "Cmp",
      section: "Pricing",
      description: "Feature row. Each cell is a check, a dash or a value.",
      props: {
        label: p.text("CmpLbl", "Feature"),
        a: p.text("CmpAT", "Value"),
        b: p.text("CmpBT", "Value"),
        c: p.text("CmpCT", "Value"),
        aMode: p.variants(cellModes("CmpA")),
        bMode: p.variants(cellModes("CmpB")),
        cMode: p.variants(cellModes("CmpC")),
      },
      root: {
        dir: "row",
        w: 1200,
        pad: [14, 0],
        align: "center",
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.para(root, "Feature", b.ty("body", { size: 15 }), ink, {
        key: "CmpLbl",
        name: "Label",
      })
      for (const k of ["A", "B", "C"]) {
        const cell = b.row(root, `Cell ${k}`, { w: 220, justify: "center", align: "center" })
        b.icon(cell, "check", 18, ink, { key: `Cmp${k}I` })
        b.text(cell, "Value", b.ty("mono", { size: 13 }), ink, { key: `Cmp${k}T`, visible: false })
      }
    },
  )
  function cellModes(k: string) {
    return {
      check: {
        [`${k}I.visible`]: true,
        [`${k}I.icon`]: "check",
        [`${k}I.color`]: ink,
        [`${k}T.visible`]: false,
      },
      dash: {
        [`${k}I.visible`]: true,
        [`${k}I.icon`]: "minus",
        [`${k}I.color`]: c("border-strong"),
        [`${k}T.visible`]: false,
      },
      text: { [`${k}I.visible`]: false, [`${k}T.visible`]: true },
    }
  }

  const postRow = b.component(
    "Post row",
    {
      key: "Post",
      section: "Blog",
      description: "Editorial list row used for posts and customer stories.",
      props: {
        meta: p.text("PoMeta", "Sep 24, 2026"),
        tag: p.text("PoTag/TagLbl", "Audit"),
        title: p.text("PoTitle", "Post title"),
        excerpt: p.text("PoExc", "One or two sentences about the post."),
        author: p.text("PoAuth", "Author"),
        initials: p.text("PoAv/AvInit", "MO"),
        readTime: p.text("PoRead", "6 min"),
      },
      root: {
        dir: "row",
        w: 1200,
        gap: 24,
        pad: [28, 0],
        align: "start",
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const metaCell = b.row(root, "Meta cell", { w: 120, pad: [5, 0, 0, 0] })
      b.text(metaCell, "Sep 24, 2026", b.ty("mono", { size: 12 }), muted, {
        key: "PoMeta",
        name: "Meta",
      })
      const tagCell = b.row(root, "Tag cell", { w: 128 })
      b.use(tagCell, tag, { key: "PoTag", args: { label: "Audit" } })
      const body = b.col(root, "Body", { w: FILL, gap: 8 })
      b.para(body, "Post title", b.ty("title", { size: 24, letterSpacing: -0.6 }), ink, {
        key: "PoTitle",
        name: "Title",
      })
      b.para(body, "One or two sentences about the post.", b.ty("body", { size: 15 }), muted, {
        key: "PoExc",
        name: "Excerpt",
      })
      const by = b.row(root, "Author", { w: 168, gap: 10, align: "center" })
      b.use(by, avatar, { key: "PoAv", args: { size: "sm" } })
      b.text(by, "Author", b.ty("small", { weight: 500 }), ink, { key: "PoAuth", name: "Name" })
      const readCell = b.row(root, "Read cell", { w: 56, pad: [5, 0, 0, 0], justify: "end" })
      b.text(readCell, "6 min", b.ty("mono", { size: 12 }), muted, {
        key: "PoRead",
        name: "Read time",
      })
    },
  )

  const input = b.component(
    "Input",
    {
      key: "Input",
      section: "Forms",
      props: {
        label: p.text("InLbl", "Label"),
        placeholder: p.text("InPh", "Placeholder"),
        hint: p.text("InHint", "Hint"),
        showHint: p.bool("InHint", false),
      },
      root: { dir: "column", w: 400, gap: 8 },
    },
    (root) => {
      b.text(root, "Label", b.ty("label", { size: 13 }), ink, { key: "InLbl" })
      const field = b.row(root, "Field", {
        w: FILL,
        pad: [13, 14],
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border-strong") },
      })
      b.text(field, "Placeholder", b.ty("body", { size: 15 }), muted, { key: "InPh" })
      b.text(root, "Hint", b.ty("small"), muted, { key: "InHint", visible: false })
    },
  )

  const faq = b.component(
    "FAQ item",
    {
      key: "Faq",
      section: "Content",
      props: {
        question: p.text("FaqQ", "Question"),
        answer: p.text("FaqA", "Answer."),
        open: p.bool("FaqA", true),
      },
      root: {
        dir: "column",
        w: 700,
        gap: 12,
        pad: [22, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const head = b.row(root, "Question row", { w: FILL, gap: 16, align: "center" })
      b.para(head, "Question", b.ty("title", { size: 18 }), ink, { key: "FaqQ", name: "Question" })
      b.icon(head, "plus", 18, muted)
      b.para(root, "Answer.", b.ty("body", { size: 15 }), muted, { key: "FaqA", name: "Answer" })
    },
  )

  const quote = b.component(
    "Pull quote",
    {
      key: "Quote",
      section: "Content",
      props: {
        quote: p.text("QText", "Quote"),
        name: p.text("QName", "Name"),
        role: p.text("QRole", "Role"),
        initials: p.text("QAv/AvInit", "MO"),
        tone: p.variants({
          paper: { "QText.fill": ink, "QName.fill": ink, "QRole.fill": muted },
          inverse: {
            "QText.fill": c("on-inverse"),
            "QName.fill": c("on-inverse"),
            "QRole.fill": c("inverse-muted"),
          },
        }),
      },
      root: { dir: "column", w: 640, gap: 32 },
    },
    (root) => {
      b.para(
        root,
        "Quote",
        b.ty("heading", { size: 34, letterSpacing: -1.2, lineHeight: 1.2 }),
        ink,
        {
          key: "QText",
          name: "Quote",
        },
      )
      const who = b.row(root, "Person", { gap: 12, align: "center" })
      b.use(who, avatar, { key: "QAv", args: { size: "md" } })
      const names = b.col(who, "Names", { gap: 2 })
      b.text(names, "Name", b.ty("label"), ink, { key: "QName" })
      b.text(names, "Role", b.ty("small"), muted, { key: "QRole" })
    },
  )

  // --- Shared helpers --------------------------------------------------------------------------

  function page(name: string, active: "product" | "pricing" | "customers" | "blog") {
    const scr = b.screen(screens, name, { w: 1440, fill: c("bg") })
    b.use(scr, navBar, { args: { active } })
    return scr
  }
  /** A content-width block (1200) with the 120 side padding of the grid. */
  function block(parent: string, name: string, props: Record<string, unknown> = {}) {
    return b.col(parent, name, { w: FILL, pad: [0, 120], gap: s(8), ...props })
  }
  function label(parent: string, index: string, title: string) {
    return b.use(parent, indexLabel, { props: { w: FILL }, args: { index, title } })
  }
  function emailForm(
    parent: string,
    w: number | typeof FILL,
    onDark = false,
    cta = "Start free trial",
  ) {
    const form = b.row(parent, "Email form", {
      w,
      gap: 8,
      pad: [6, 6, 6, 18],
      align: "center",
      radius: r("lg"),
      fill: onDark ? c("inverse") : c("surface"),
      stroke: { paint: onDark ? c("inverse-line") : c("border-strong") },
    })
    b.para(form, "Work email", b.ty("body", { size: 15 }), onDark ? c("inverse-muted") : muted)
    b.use(form, button, { args: { label: cta, variant: "mark", size: "md" } })
    return form
  }
  function ctaBand(scr: string) {
    const wrap = block(scr, "Call to action", { pad: [96, 120, 96, 120] })
    const band = b.row(wrap, "Band", {
      w: FILL,
      gap: 64,
      pad: 64,
      align: "center",
      radius: r("xl"),
      fill: c("inverse"),
    })
    const left = b.col(band, "Copy", { w: FILL, gap: 16 })
    b.para(left, "Run September in Ledgerline", b.ty("h1"), c("on-inverse"))
    b.para(
      left,
      "Import last month's checklist from a spreadsheet and invite your team. Most teams are set up in an afternoon.",
      b.ty("body-lg"),
      c("inverse-muted"),
    )
    const right = b.col(band, "Form", { w: 440, gap: 12 })
    emailForm(right, FILL, true)
    b.text(right, "14 days free. No card needed.", cap({ size: 11 }), c("inverse-muted"))
  }

  const people = {
    PR: ["Priya Raman", "mint"],
    TH: ["Tomás Herrera", "butter"],
    GL: ["Grace Liu", "lilac"],
    OB: ["Owen Becker", "sky"],
    AB: ["Aisha Bello", "blush"],
    MN: ["Marta Nowak", "mint"],
    DP: ["Daniel Park", "sky"],
    LS: ["Lena Strauss", "butter"],
    RA: ["Rafael Alves", "blush"],
  } as const

  const logos: [string, string, string][] = [
    ["Northwind Freight", "caps", "ink"],
    ["Halcyon Health", "tight", "ink"],
    ["Brightline", "black", "ink"],
    ["Corvid Labs", "light", "ink"],
    ["Juniper Capital", "caps", "ink"],
    ["Oakridge", "tight", "ink"],
  ]

  /** Ledger artwork: a flat tile with a sheet of mono figures, rules of different length and a marker. */
  function art(
    parent: string,
    name: string,
    tone: string,
    w: number | typeof FILL,
    h: number,
    seed: number,
  ) {
    const tile = b.col(parent, name, {
      w,
      h,
      pad: 32,
      gap: 24,
      justify: "between",
      radius: r("lg"),
      fill: c(`tile-${tone}`),
      clip: true,
    })
    const sheet = b.col(tile, "Sheet", {
      w: h >= 400 ? 480 : 420,
      radius: r("md"),
      fill: c("surface"),
      stroke: { paint: ink },
      clip: true,
    })
    const all = [
      ["1010", "412,908.14"],
      ["1200", "188,420.00"],
      ["2100", "64,310.55"],
      ["1450", "41,860.33"],
      ["2300", "230,004.00"],
      ["4000", "1,204,550.10"],
      ["6140", "51,904.00"],
      ["6200", "72,400.00"],
      ["6310", "9,822.40"],
    ]
    const count = h >= 400 ? 7 : 3
    const rows = [...all, ...all].slice(seed * 2, seed * 2 + count)
    for (const [i, [code, amt]] of rows.entries()) {
      const row = b.row(sheet, "Line", {
        w: FILL,
        pad: [10, 16],
        gap: 16,
        stroke: { paint: ink, width: { b: i === rows.length - 1 ? 0 : 1 } },
      })
      b.para(row, code, b.ty("mono", { size: 12 }), muted, { w: 48 })
      b.para(row, amt, b.ty("mono", { size: 12, align: "right" }), ink)
    }
    const lines = b.col(tile, "Lines", { gap: 12 })
    const widths = [
      [0.9, 0.55, 0.7],
      [0.5, 0.85, 0.62],
      [0.74, 0.46, 0.9],
    ][seed % 3]
    const total = typeof w === "number" ? w - 64 : 600
    for (const [i, f] of widths.entries()) {
      const line = b.row(lines, "Line", { gap: 12, align: "center" })
      b.rect(line, "Rule", { w: Math.round(total * f), h: i === 1 ? 8 : 3, fill: ink, radius: 1 })
      if (i === 1)
        b.ellipse(line, "Marker", { w: 24, h: 24, fill: c("mark"), stroke: { paint: ink } })
    }
    return tile
  }

  // --- Cover -----------------------------------------------------------------------------------

  const ledgerRows = (into: { inst: string; at: string }, rows: readonly (readonly string[])[]) => {
    for (const [code, name, bal, v, state] of rows)
      b.use(into, ledgerRow, {
        props: { w: FILL },
        args: { code, name, balance: bal, variance: v, state },
      })
  }

  b.cover({
    eyebrow: "Website template",
    title: "Ledgerline marketing site",
    description:
      "Home, pricing, customers, blog, article and sign-up screens for a B2B finance tool. 19 components, light and dark tokens, Inter and JetBrains Mono.",
    preview: (area) => {
      b.para(area, "Close the books in four days, not ten.", b.ty("h1", { size: 40 }), ink)
      emailForm(area, FILL, false, "Start free trial")
      b.use(area, ledgerTable, {
        props: { w: FILL },
        slots: {
          LtRows: (into) =>
            ledgerRows(into, [
              ["1010", "Operating account", "412,908.14", "+3.1%", "tied"],
              ["1200", "Accounts receivable", "188,420.00", "+12.4%", "review"],
              ["2100", "Accrued expenses", "64,310.55", "-1.8%", "tied"],
            ]),
        },
      })
      const tiles = b.row(area, "Tiles", { w: FILL, gap: 12 })
      b.use(tiles, storyTile, {
        props: { w: FILL, h: 176 },
        args: {
          metric: "11 to 4",
          caption: "Days to close",
          company: "Halcyon Health",
          tone: "mint",
        },
      })
      b.use(tiles, storyTile, {
        props: { w: FILL, h: 176 },
        args: {
          metric: "140",
          caption: "Reconciliations with support",
          company: "Brightline",
          tone: "butter",
        },
      })
    },
  })

  // --- Screens ---------------------------------------------------------------------------------

  const screens = b.page("Screens")

  // Home
  {
    const scr = page("Home", "product")

    const hero = block(scr, "Hero", { pad: [88, 120, 0, 120], gap: 56 })
    const top = b.row(hero, "Headline row", { w: FILL, gap: 48, align: "end" })
    const head = b.col(top, "Headline", { w: 740, gap: 28 })
    const eyebrow = b.row(head, "Eyebrow", { gap: 10, align: "center" })
    b.rect(eyebrow, "Square", { w: 10, h: 10, fill: c("mark"), stroke: { paint: ink } })
    b.text(eyebrow, "Month-end close software", cap(), ink)
    const lines = b.col(head, "Lines", { gap: 0 })
    b.text(lines, "Close the books", b.ty("display"), ink)
    const hl = b.row(lines, "Highlight", { pad: [0, 12], radius: r("sm"), fill: c("mark") })
    b.text(hl, "in four days,", b.ty("display"), c("on-mark"))
    b.text(lines, "not ten.", b.ty("display"), ink)
    const aside = b.col(top, "Aside", { w: FILL, gap: 24 })
    b.para(
      aside,
      "Ledgerline puts reconciliations, accruals and sign-offs on one checklist. It reads balances from your ERP every hour, so the controller sees what is left without asking.",
      b.ty("body-lg"),
      ink,
    )
    emailForm(aside, FILL)
    b.text(aside, "14 days free. SOC 2 Type II.", cap({ size: 11 }), muted)

    // Stage
    const stage = b.row(hero, "Stage", {
      w: FILL,
      gap: 40,
      pad: 48,
      radius: r("xl"),
      fill: c("subtle"),
      align: "start",
    })
    b.use(stage, ledgerTable, {
      slots: {
        LtRows: (into) =>
          ledgerRows(into, [
            ["1010", "Operating account", "412,908.14", "+3.1%", "tied"],
            ["1020", "Payroll account", "96,115.72", "-0.4%", "tied"],
            ["1200", "Accounts receivable", "188,420.00", "+12.4%", "review"],
            ["1450", "Prepaid expenses", "41,860.33", "-8.9%", "review"],
            ["2100", "Accrued expenses", "64,310.55", "-1.8%", "tied"],
            ["2300", "Deferred revenue", "230,004.00", "+5.7%", "open"],
            ["4000", "Subscription revenue", "1,204,550.10", "+4.2%", "open"],
          ]),
      },
    })
    const side = b.col(stage, "Progress", { w: FILL, gap: 28 })
    b.text(side, "Tasks done", cap({ size: 11 }), muted)
    const tally = b.row(side, "Tally", { gap: 12, align: "baseline" })
    b.text(tally, "41", b.ty("figure", { size: 88 }), ink)
    b.text(tally, "of 58", b.ty("mono", { size: 16 }), muted)
    const ticks = b.row(side, "Ticks", { w: FILL, gap: 3, h: 28 })
    for (let i = 0; i < 29; i++)
      b.rect(ticks, "Tick", { w: FILL, h: 28, radius: 1, fill: i < 20 ? ink : c("border-strong") })
    b.divider(side, c("border-strong"))
    b.text(side, "Waiting on you", cap({ size: 11 }), muted)
    for (const [who, what, when] of [
      ["Review", "Accounts receivable, 3 lines over threshold", "Today"],
      ["Approve", "Accrual for AWS, September", "Today"],
      ["Note", "Prepaid expenses moved 8.9%", "Oct 8"],
    ] as const) {
      const row = b.row(side, what, { w: FILL, gap: 12, align: "start" })
      const tcell = b.row(row, "Tag cell", { w: 72 })
      b.use(tcell, tag, { args: { label: who, tone: who === "Review" ? "warning" : "neutral" } })
      b.para(row, what, b.ty("body", { size: 14 }), ink)
      b.text(row, when, b.ty("mono", { size: 12 }), muted)
    }

    // Logos
    const proof = block(scr, "Logos", { pad: [72, 120, 0, 120], gap: 28 })
    b.text(proof, "Closing in Ledgerline: 1,400 finance teams", cap({ size: 11 }), muted)
    const logoRow = b.row(proof, "Logos", { w: FILL, justify: "between", align: "center" })
    for (const [name, style, tone] of logos)
      b.use(logoRow, wordmark, { args: { name, style, tone } })

    // Close calendar
    const cal = block(scr, "Close calendar", { pad: [120, 120, 0, 120], gap: 48 })
    label(cal, "01", "The close calendar")
    const calHead = b.row(cal, "Heading", { w: FILL, gap: 64, align: "end" })
    b.para(
      calHead,
      "Every task has an owner and a day, so nothing waits on a reply.",
      b.ty("h1"),
      ink,
      { w: 720 },
    )
    b.para(
      calHead,
      "Tasks roll forward each month with their owners, due days and dependencies. Anything late turns up on day 2, not on day 6.",
      b.ty("body-lg"),
      muted,
    )
    const gantt = b.col(cal, "Calendar", { w: FILL })
    const days = b.row(gantt, "Days", {
      w: FILL,
      stroke: { paint: ink, width: { b: 1 } },
      pad: [0, 0, 12, 0],
    })
    b.rect(days, "Label column", { w: 280, h: 1, fill: c("bg") })
    for (const [i, d] of ["Oct 1", "Oct 2", "Oct 5", "Oct 6", "Oct 7"].entries()) {
      const cell = b.row(days, `D${i + 1}`, { w: 184, gap: 8 })
      b.text(cell, `D${i + 1}`, cap({ size: 11 }), ink)
      b.text(cell, d, cap({ size: 11 }), muted)
    }
    const tasks: [string, string, number, number, string, string][] = [
      ["Bank reconciliations", "Priya Raman", 0, 2, "tile-mint", "6 accounts"],
      ["Payroll and benefits accrual", "Tomás Herrera", 1, 2, "tile-butter", "2 entries"],
      ["Prepaid and fixed assets", "Grace Liu", 1, 3, "tile-lilac", "Roll-forward"],
      ["Intercompany eliminations", "Owen Becker", 2, 2, "tile-sky", "4 entities"],
      ["Revenue cutoff review", "Aisha Bello", 3, 1, "tile-blush", "Review"],
      ["Flux review and notes", "Priya Raman", 3, 2, "tile-mint", "Variance over 10%"],
    ]
    for (const [name, owner, start, len, tone, note] of tasks) {
      const row = b.row(gantt, name, {
        w: FILL,
        align: "center",
        pad: [10, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      })
      const lab = b.col(row, "Label", { w: 280, gap: 2 })
      b.text(lab, name, b.ty("label", { weight: 500 }), ink)
      b.text(lab, owner, b.ty("small"), muted)
      const track = b.row(row, "Track", { w: 920, pad: [0, 0, 0, start * 184] })
      const bar = b.row(track, "Bar", {
        w: len * 184 - 8,
        h: 36,
        pad: [0, 12],
        align: "center",
        radius: r("sm"),
        fill: c(tone),
      })
      b.text(bar, note, b.ty("mono", { size: 12 }), ink)
    }

    // Features: three rows with different visuals
    const feats = block(scr, "Features", { pad: [120, 120, 0, 120], gap: 96 })
    function featRow(index: string, title: string, body: string, link: string) {
      const row = b.row(feats, title, { w: FILL, gap: 64, align: "start" })
      const copy = b.col(row, "Copy", { w: 340, gap: 20 })
      b.text(copy, index, cap(), ink)
      b.para(copy, title, b.ty("heading"), ink)
      b.para(copy, body, b.ty("body"), muted)
      const l = b.row(copy, "Link", { gap: 6, align: "center" })
      b.text(l, link, cap({ size: 12 }), ink)
      b.icon(l, "arrow-right", 14, ink)
      return b.col(row, "Visual", {
        w: FILL,
        pad: 32,
        gap: 0,
        radius: r("lg"),
        fill: c("subtle"),
      })
    }
    // 02 Reconciliation
    {
      const v = featRow(
        "02 / Reconciliations",
        "Bank lines match the ledger overnight",
        "Ledgerline pairs each bank line with the ledger entry by amount, date and reference. What it cannot pair waits for a preparer, with the likely match suggested.",
        "How matching works",
      )
      const head = b.row(v, "Head", { w: FILL, pad: [0, 0, 12, 0] })
      b.para(head, "Bank feed, Mercury ...4471", cap({ size: 11 }), muted, { w: 320 })
      b.text(head, "General ledger, 1010", cap({ size: 11 }), muted)
      const pairs: [string, string, string, boolean][] = [
        ["Sep 29  Stripe payout", "-", "Sep 29  Stripe clearing", true],
        ["Sep 30  Gusto payroll", "-", "Sep 30  Payroll run 18", true],
        ["Sep 30  AWS", "-", "Sep 30  Cloud hosting, Sep", true],
        ["Oct 1  Wire in 4,200.00", "-", "No matching entry", false],
      ]
      const amt = ["28,410.62", "96,115.72", "9,822.40", "4,200.00"]
      for (const [i, [bank, , gl, ok]] of pairs.entries()) {
        const row = b.row(v, bank, {
          w: FILL,
          pad: [14, 0],
          align: "center",
          stroke: { paint: c("border-strong"), width: { t: 1 } },
        })
        const left = b.col(row, "Bank", { w: 320, gap: 2 })
        b.text(left, bank.split("  ")[1] ?? bank, b.ty("label", { weight: 500 }), ink)
        b.text(left, `${bank.split("  ")[0]}  ${amt[i]}`, b.ty("mono", { size: 12 }), muted)
        const mid = b.row(row, "Link", { w: 56, justify: "center" })
        b.icon(mid, ok ? "check" : "circle-alert", 16, ok ? c("success") : c("warning"))
        const right = b.col(row, "Ledger", { w: FILL, gap: 2 })
        b.text(
          right,
          gl.split("  ")[1] ?? gl,
          b.ty("label", { weight: 500 }),
          ok ? ink : c("warning"),
        )
        b.text(
          right,
          ok ? `${gl.split("  ")[0]}  ${amt[i]}` : "Suggested: invoice 2041, Halcyon",
          b.ty("mono", { size: 12 }),
          muted,
        )
      }
    }
    // 03 Flux
    {
      const v = featRow(
        "03 / Flux review",
        "Owners explain a variance before review starts",
        "Set a threshold per account. When a balance moves past it, the owner gets a task with last month and last year beside it, and the note lands in the review pack.",
        "See a flux pack",
      )
      const head = b.row(v, "Head", { w: FILL, gap: 16, pad: [0, 0, 12, 0] })
      b.para(head, "Account", cap({ size: 11 }), muted, { w: 200 })
      b.para(head, "Aug", cap({ size: 11, align: "right" }), muted, { w: 88 })
      b.para(head, "Sep", cap({ size: 11, align: "right" }), muted, { w: 88 })
      b.text(head, "Change against 10% threshold", cap({ size: 11 }), muted)
      for (const [name, aug, sep, pct, over] of [
        ["Cloud hosting", "38,210", "51,904", 36, true],
        ["Contractors", "72,400", "69,150", -4, false],
        ["Software", "24,880", "26,310", 6, false],
        ["Recruiting fees", "9,000", "21,500", 139, true],
        ["Travel", "18,730", "15,220", -19, true],
      ] as const) {
        const row = b.row(v, name, {
          w: FILL,
          gap: 16,
          pad: [14, 0],
          align: "center",
          stroke: { paint: c("border-strong"), width: { t: 1 } },
        })
        b.para(row, name, b.ty("label", { weight: 500 }), ink, { w: 200 })
        b.para(row, aug, b.ty("mono", { size: 12, align: "right" }), muted, { w: 88 })
        b.para(row, sep, b.ty("mono", { size: 12, align: "right" }), ink, { w: 88 })
        const bar = b.row(row, "Bar", { w: FILL, gap: 10, align: "center" })
        const len = Math.min(190, Math.round((Math.abs(pct) / 139) * 190) + 6)
        b.rect(bar, "Change", {
          w: len,
          h: 10,
          radius: 1,
          fill: over ? (pct > 0 ? c("danger") : c("warning")) : c("border-strong"),
        })
        b.text(bar, `${pct > 0 ? "+" : ""}${pct}%`, b.ty("mono", { size: 12 }), over ? ink : muted)
      }
    }
    // 04 Sign-off trail
    {
      const v = featRow(
        "04 / Audit trail",
        "Auditors get the period, read-only",
        "Every sign-off, edit and attachment is stamped with who and when. Share the period with your auditors and they pull support themselves.",
        "Read the security overview",
      )
      for (const [i, [time, who, what]] of (
        [
          ["Oct 6, 09:12", "Priya Raman", "signed off Accounts receivable, 1200"],
          ["Oct 6, 08:47", "Tomás Herrera", "attached bank statement to 1010 (PDF, 3 pages)"],
          [
            "Oct 5, 17:30",
            "Grace Liu",
            "added a note on Prepaid expenses: annual renewal moved to Q4",
          ],
          ["Oct 5, 16:02", "Ledgerline", "matched 212 of 219 bank lines on 1010"],
          ["Oct 5, 11:20", "Aisha Bello", "posted journal entry JE-2209 to NetSuite"],
        ] as const
      ).entries()) {
        const row = b.row(v, who, {
          w: FILL,
          gap: 20,
          pad: [14, 0],
          align: "start",
          stroke: { paint: c("border-strong"), width: { t: i === 0 ? 0 : 1 } },
        })
        b.para(row, time, b.ty("mono", { size: 12 }), muted, { w: 112 })
        const t = b.row(row, "Entry", { w: FILL, gap: 6, wrap: true })
        b.text(t, who, b.ty("label", { size: 14 }), ink)
        b.para(t, what, b.ty("body", { size: 14 }), muted, { w: FILL })
      }
    }

    // Stats
    const stats = block(scr, "Numbers", { pad: [120, 120, 0, 120], gap: 32 })
    label(stats, "05", "After 90 days")
    const srow = b.row(stats, "Stats", { w: FILL, align: "stretch" })
    for (const [i, [value, lab]] of (
      [
        ["4.2 days", "Median close, down from 9.5 days before Ledgerline"],
        ["38%", "Fewer manual journal entries in the first quarter"],
        ["212 / 219", "Bank lines matched without a touch on a typical month"],
        ["SOC 2", "Type II report, audited every year since 2024"],
      ] as const
    ).entries()) {
      const cellw = b.col(srow, "Cell", {
        w: FILL,
        pad: [4, 0, 4, i === 0 ? 0 : 32],
        ...(i === 0 ? {} : { stroke: { paint: c("border"), width: { l: 1 } } }),
      })
      b.use(cellw, stat, { props: { w: FILL }, args: { value, label: lab } })
    }

    // Customer
    const voice = block(scr, "Customer", { pad: [120, 120, 0, 120], gap: 32 })
    label(voice, "06", "Customers")
    const vrow = b.row(voice, "Quote and tile", { w: FILL, gap: 64, align: "stretch" })
    b.use(vrow, quote, {
      props: { w: FILL },
      args: {
        quote:
          "We closed August in five days with two fewer people than last year. The checklist does most of the chasing.",
        name: "Priya Raman",
        role: "Controller, Halcyon Health",
        initials: "PR",
      },
      set: { QAv: { args: { size: "md", tone: "mint" } } },
    })
    b.use(vrow, storyTile, {
      props: { w: 360, h: 300 },
      args: {
        metric: "11 to 4",
        caption: "Days to close, from the first of the month",
        company: "Halcyon Health",
        tone: "mint",
      },
    })

    ctaBand(scr)
    b.use(scr, footer)
  }

  // Pricing
  {
    const scr = page("Pricing", "pricing")
    const head = block(scr, "Header", { pad: [88, 120, 0, 120], gap: 32 })
    const row = b.row(head, "Heading", { w: FILL, gap: 48, align: "end" })
    const left = b.col(row, "Copy", { w: 780, gap: 24 })
    b.text(left, "Pricing", cap(), ink)
    b.para(left, "One price per month, whatever you close.", b.ty("display", { size: 68 }), ink)
    const right = b.col(row, "Right", { w: FILL, gap: 20, align: "end" })
    b.para(
      right,
      "Plans are priced by users and entities, not by tasks or reconciliations. Pay annually and get two months free.",
      b.ty("body-lg"),
      muted,
    )
    const toggle = b.row(right, "Billing", {
      pad: 4,
      gap: 4,
      radius: r("md"),
      fill: c("subtle"),
    })
    for (const [t, on] of [
      ["Monthly", false],
      ["Annual", true],
    ] as const) {
      const seg = b.row(toggle, t, {
        pad: [8, 18],
        radius: r("sm"),
        fill: on ? ink : c("subtle"),
      })
      b.text(seg, t, cap({ size: 12 }), on ? c("on-ink") : muted)
    }

    const plans = block(scr, "Plans", { pad: [56, 120, 0, 120] })
    const grid = b.row(plans, "Plans", {
      w: FILL,
      radius: r("lg"),
      stroke: { paint: ink },
      clip: true,
      align: "stretch",
    })
    const plan = (
      args: Record<string, unknown>,
      feats: [string, string][],
      extra: Record<string, unknown> = {},
    ) =>
      b.use(grid, planColumn, {
        props: { w: 400, ...extra },
        args,
        ...(args.tone === "featured"
          ? { set: { PlCta: { args: { label: "Start free trial", size: "lg", variant: "mark" } } } }
          : {}),
        slots: {
          PlFeat: (into) => {
            for (const [labelText, state] of feats)
              b.use(into, checkRow, { props: { w: FILL }, args: { label: labelText, state } })
          },
        },
      })
    plan(
      {
        plan: "Starter",
        price: "$149",
        period: "per month, up to 5 users",
        description: "One entity on QuickBooks Online or Xero, closing once a month.",
        ctaLabel: "Start free trial",
      },
      [
        ["Close checklist with recurring tasks", "included"],
        ["Bank reconciliation, 3 accounts", "included"],
        ["Journal entry drafts and approvals", "included"],
        ["Flux review", "excluded"],
        ["Read-only auditor access", "excluded"],
      ],
    )
    plan(
      {
        plan: "Team",
        price: "$449",
        period: "per month, up to 25 users",
        description: "Up to 5 entities on NetSuite or Sage Intacct, with review steps.",
        tone: "featured",
      },
      [
        ["Everything in Starter", "onDark"],
        ["Unlimited bank accounts", "onDark"],
        ["Flux review with owner notes", "onDark"],
        ["Intercompany eliminations", "onDark"],
        ["Read-only auditor access", "onDark"],
        ["Slack reminders", "onDark"],
      ],
    )
    plan(
      {
        plan: "Enterprise",
        price: "Custom",
        period: "from 10 entities",
        description: "Multi-book close, SSO and a named contact for your audit season.",
        ctaLabel: "Talk to sales",
      },
      [
        ["Everything in Team", "included"],
        ["SAML SSO and SCIM", "included"],
        ["Multi-book and multi-currency", "included"],
        ["Audit log export to your SIEM", "included"],
        ["99.9% uptime commitment", "included"],
      ],
    )

    // Compare
    const cmp = block(scr, "Compare", { pad: [120, 120, 0, 120], gap: 24 })
    label(cmp, "01", "Compare plans")
    const table = b.col(cmp, "Table", { w: FILL })
    const th = b.row(table, "Head", {
      w: FILL,
      pad: [24, 0, 16, 0],
      align: "end",
      stroke: { paint: ink, width: { b: 1 } },
    })
    b.para(th, "Everything in every plan, then what changes.", b.ty("heading", { size: 26 }), ink, {
      w: FILL,
    })
    for (const n of ["Starter", "Team", "Enterprise"]) {
      const cell = b.row(th, n, { w: 220, justify: "center" })
      b.text(cell, n, cap({ size: 12 }), ink)
    }
    const groups: [string, [string, [string, string], [string, string], [string, string]][]][] = [
      [
        "Close",
        [
          ["Recurring checklist and due days", ["check", ""], ["check", ""], ["check", ""]],
          ["Task dependencies", ["dash", ""], ["check", ""], ["check", ""]],
          ["Entities", ["text", "1"], ["text", "Up to 5"], ["text", "10 or more"]],
          ["Users", ["text", "5"], ["text", "25"], ["text", "Unlimited"]],
        ],
      ],
      [
        "Reconciliation and review",
        [
          [
            "Bank feeds and auto-matching",
            ["text", "3 accounts"],
            ["text", "Unlimited"],
            ["text", "Unlimited"],
          ],
          ["Flux review with owner notes", ["dash", ""], ["check", ""], ["check", ""]],
          ["Intercompany eliminations", ["dash", ""], ["check", ""], ["check", ""]],
          ["Multi-book close", ["dash", ""], ["dash", ""], ["check", ""]],
        ],
      ],
      [
        "Security and support",
        [
          ["Read-only auditor access", ["dash", ""], ["check", ""], ["check", ""]],
          ["SAML SSO and SCIM", ["dash", ""], ["dash", ""], ["check", ""]],
          ["Support", ["text", "Email"], ["text", "Chat, 4 hours"], ["text", "Named contact"]],
        ],
      ],
    ]
    for (const [g, rows] of groups) {
      const gh = b.row(table, g, {
        w: FILL,
        pad: [32, 0, 10, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      })
      b.text(gh, g, cap({ size: 11 }), muted)
      for (const [name, a, bb, cc] of rows)
        b.use(table, compareRow, {
          props: { w: FILL },
          args: {
            label: name,
            a: a[1],
            b: bb[1],
            c: cc[1],
            aMode: a[0],
            bMode: bb[0],
            cMode: cc[0],
          },
        })
    }

    // FAQ
    const q = block(scr, "Questions", { pad: [120, 120, 0, 120], gap: 32 })
    label(q, "02", "Questions")
    const qrow = b.row(q, "Questions row", { w: FILL, gap: 64, align: "start" })
    const qcopy = b.col(qrow, "Copy", { w: 380, gap: 20 })
    b.para(qcopy, "What finance leads ask before they sign.", b.ty("heading", { size: 36 }), ink)
    b.para(
      qcopy,
      "Anything else goes to finance-support@ledgerline.com. A person answers within one business day.",
      b.ty("body"),
      muted,
    )
    const qlist = b.col(qrow, "List", { w: FILL })
    for (const [qq, a, open] of [
      [
        "Do you write to our ERP?",
        "Only journal entries you have approved. Balances and bank lines are read-only. Every post carries the approver and a link back to the task.",
        true,
      ],
      [
        "How long does setup take?",
        "Most teams import last month's checklist from a spreadsheet and connect their ERP in an afternoon. Bank feeds take a day to backfill 13 months.",
        false,
      ],
      [
        "Can we change plans mid-year?",
        "Yes. Upgrades apply the same day and are prorated. Downgrades apply at renewal.",
        false,
      ],
      [
        "Where is our data stored?",
        "In US or EU regions, your choice at signup. Data is encrypted at rest and in transit, and our SOC 2 Type II report is available under NDA.",
        false,
      ],
    ] as const)
      b.use(qlist, faq, { props: { w: FILL }, args: { question: qq, answer: a, open } })

    ctaBand(scr)
    b.use(scr, footer)
  }

  // Customers
  {
    const scr = page("Customers", "customers")
    const head = block(scr, "Header", { pad: [88, 120, 0, 120], gap: 56 })
    const row = b.row(head, "Heading", { w: FILL, gap: 48, align: "end" })
    const left = b.col(row, "Copy", { w: 780, gap: 24 })
    b.text(left, "Customers", cap(), ink)
    b.para(left, "Closing by day four.", b.ty("display", { size: 68 }), ink)
    b.para(
      row,
      "Six finance teams on what changed in their close after 90 days, in their own numbers.",
      b.ty("body-lg"),
      muted,
    )

    const bento = block(scr, "Bento", { pad: [56, 120, 0, 120], gap: 12 })
    const r1 = b.row(bento, "Row 1", { w: FILL, gap: 12 })
    b.use(r1, storyFeature, {
      props: { w: FILL },
      args: {
        headline: "How Halcyon Health cut its close from 11 days to 4 across three entities",
        m1: "4 days",
        m1Label: "Median close, was 11",
        m2: "140",
        m2Label: "Reconciliations with support",
        company: "Halcyon Health",
        tone: "mint",
      },
    })
    b.use(r1, storyFeature, {
      props: { w: FILL },
      args: {
        headline: "Why Brightline Retail gave its auditors read-only access in January",
        m1: "-6 days",
        m1Label: "Year-end audit fieldwork",
        m2: "0",
        m2Label: "PBC folders built by hand",
        company: "Brightline",
        tone: "butter",
      },
    })
    const r2 = b.row(bento, "Row 2", { w: FILL, gap: 12 })
    for (const [metric, caption, company, tone] of [
      ["2 days", "Intercompany, down from 5", "Juniper Capital", "lilac"],
      ["38%", "Fewer manual journal entries", "Oakridge", "blush"],
      ["9 of 10", "Flux variances explained by day 3", "Corvid Labs", "sky"],
      ["212", "Bank lines matched in one night", "Northwind Freight", "mint"],
    ] as const)
      b.use(r2, storyTile, {
        props: { w: 291 },
        args: { metric, caption, company, tone },
        set: { StCo: { args: { name: company, tone: "ink", style: "tight" } } },
      })

    // All stories
    const all = block(scr, "All stories", { pad: [120, 120, 0, 120], gap: 8 })
    label(all, "01", "All stories")
    const list = b.col(all, "List", { w: FILL })
    for (const [industry, metric, title, excerpt, who, read] of [
      [
        "Healthcare",
        "11 to 4 days",
        "Halcyon Health runs three entities on one close calendar",
        "A controller and two accountants moved from spreadsheets to a shared checklist in one quiet week.",
        "PR",
        "6 min",
      ],
      [
        "Retail",
        "-6 days audit",
        "Brightline Retail stops building PBC folders",
        "Read-only auditor access replaced 140 emailed requests a year.",
        "TH",
        "5 min",
      ],
      [
        "Biotech",
        "9 of 10",
        "Corvid Labs gets variance notes before review",
        "Owners write the note when the balance moves, not when the controller asks.",
        "GL",
        "4 min",
      ],
      [
        "Investments",
        "2 days",
        "Juniper Capital eliminates intercompany by lunch on day two",
        "Templates and auto-matching cut a two-day job to a morning.",
        "OB",
        "7 min",
      ],
      [
        "Food",
        "38% fewer",
        "Oakridge Foods posts fewer manual entries every quarter",
        "Recurring accruals draft themselves from the last three invoices.",
        "AB",
        "5 min",
      ],
    ] as const) {
      b.use(list, postRow, {
        props: { w: FILL },
        args: {
          meta: industry,
          tag: metric,
          title,
          excerpt,
          author: people[who][0],
          initials: who,
          readTime: read,
        },
        set: { PoAv: { args: { size: "sm", tone: people[who][1] } } },
      })
    }

    const big = block(scr, "Quote", { pad: [120, 120, 0, 120], gap: 32 })
    label(big, "02", "In their words")
    b.use(big, quote, {
      props: { w: 960 },
      args: {
        quote:
          "Our auditors pulled support for 140 reconciliations without emailing anyone. That alone saved a week in March.",
        name: "Tomás Herrera",
        role: "VP Finance, Brightline Retail",
        initials: "TH",
      },
      set: { QAv: { args: { size: "md", tone: "butter" } } },
    })

    ctaBand(scr)
    b.use(scr, footer)
  }

  // Blog
  const blogPosts = [
    [
      "Sep 24, 2026",
      "Audit",
      "What auditors ask for first, and how to have it ready",
      "The six requests that open almost every year-end audit, and where each one lives in Ledgerline.",
      "DP",
      "8 min",
    ],
    [
      "Sep 17, 2026",
      "Close process",
      "Accruals for recurring vendors, without the guesswork",
      "A template drafts the entry from the last three invoices and flags any vendor whose bill is late.",
      "LS",
      "6 min",
    ],
    [
      "Sep 10, 2026",
      "Product",
      "Flux review now asks owners for notes",
      "Set a threshold per account. When a balance moves past it, the owner gets a task with the variance attached.",
      "RA",
      "3 min",
    ],
    [
      "Sep 3, 2026",
      "Close process",
      "Reconciling Stripe payouts to your bank feed",
      "Payouts bundle fees, refunds and disputes. Here is how to split them so the bank line ties on the first try.",
      "PR",
      "9 min",
    ],
    [
      "Aug 27, 2026",
      "Audit",
      "SOC 1 or SOC 2: what a controller needs from finance software",
      "Which report your auditor will ask for, what each covers, and the bridge letter question.",
      "DP",
      "7 min",
    ],
    [
      "Aug 20, 2026",
      "Product",
      "NetSuite multi-book support is live",
      "Close secondary books on their own calendar, with separate checklists and the same audit trail.",
      "LS",
      "3 min",
    ],
  ] as const
  {
    const scr = page("Blog", "blog")
    const head = block(scr, "Header", { pad: [88, 120, 0, 120], gap: 40 })
    const row = b.row(head, "Heading", { w: FILL, gap: 48, align: "end" })
    const left = b.col(row, "Copy", { w: 780, gap: 24 })
    b.text(left, "Blog", cap(), ink)
    b.para(left, "Notes from the close.", b.ty("display", { size: 68 }), ink)
    b.para(
      row,
      "Practical writing from controllers and our own finance team on closing faster and keeping audits quiet.",
      b.ty("body-lg"),
      muted,
    )
    const tabs = b.row(head, "Filters", {
      w: FILL,
      gap: 28,
      pad: [0, 0, 0, 0],
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    for (const [i, t] of ["All posts", "Close process", "Audit", "Product"].entries()) {
      const tab = b.row(tabs, t, {
        pad: [0, 0, 14, 0],
        stroke: { paint: ink, width: { b: i === 0 ? 2 : 0 } },
      })
      b.text(tab, t, cap({ size: 12 }), i === 0 ? ink : muted)
    }

    const feat = block(scr, "Featured", { pad: [40, 120, 0, 120] })
    const frow = b.row(feat, "Featured post", { w: FILL, gap: 48, align: "stretch" })
    art(frow, "Artwork", "mint", 700, 460, 0)
    const fcopy = b.col(frow, "Copy", { w: FILL, gap: 20, justify: "end" })
    const meta = b.row(fcopy, "Meta", { gap: 12, align: "center" })
    b.use(meta, tag, { args: { label: "Close process", tone: "mark" } })
    b.text(meta, "Oct 1, 2026", b.ty("mono", { size: 12 }), muted)
    b.para(fcopy, "How a five-day close actually runs, hour by hour", b.ty("h1", { size: 44 }), ink)
    b.para(
      fcopy,
      "We timed the close at Halcyon Health, Brightline and ourselves. Here is the calendar the fastest team uses, and the three days nobody should skip.",
      b.ty("body-lg", { size: 17 }),
      muted,
    )
    const by = b.row(fcopy, "Author", { gap: 10, align: "center" })
    b.use(by, avatar, { args: { size: "sm", initials: "PR", tone: "mint" } })
    b.text(by, "Priya Raman", b.ty("label", { weight: 500 }), ink)
    b.text(by, "12 min read", b.ty("mono", { size: 12 }), muted)

    const list = block(scr, "Posts", { pad: [96, 120, 0, 120], gap: 8 })
    label(list, "01", "Latest")
    const col = b.col(list, "List", { w: FILL })
    for (const [date, tg, title, excerpt, who, read] of blogPosts)
      b.use(col, postRow, {
        props: { w: FILL },
        args: {
          meta: date,
          tag: tg,
          title,
          excerpt,
          author: people[who][0],
          initials: who,
          readTime: read,
        },
        set: { PoAv: { args: { size: "sm", tone: people[who][1] } } },
      })

    const news = block(scr, "Newsletter", { pad: [96, 120, 96, 120] })
    const nrow = b.row(news, "Newsletter row", {
      w: FILL,
      gap: 64,
      align: "center",
      pad: [40, 0, 0, 0],
      stroke: { paint: ink, width: { t: 1 } },
    })
    b.para(
      nrow,
      "One email a month. Close tips from people who run one.",
      b.ty("heading", { size: 30 }),
      ink,
      { w: 620 },
    )
    const nf = b.col(nrow, "Form", { w: FILL, gap: 10 })
    emailForm(nf, FILL, false, "Subscribe")
    b.text(nf, "No product news. Unsubscribe in one click.", cap({ size: 11 }), muted)
    b.use(scr, footer)
  }

  // Blog post
  {
    const scr = page("Blog post", "blog")
    const head = block(scr, "Header", { pad: [56, 120, 0, 120], gap: 32 })
    const crumbs = b.row(head, "Breadcrumb", { gap: 10, align: "center" })
    b.text(crumbs, "Blog", cap({ size: 11 }), muted)
    b.text(crumbs, "/", cap({ size: 11 }), muted)
    b.text(crumbs, "Audit", cap({ size: 11 }), ink)
    b.para(
      head,
      "What auditors ask for first, and how to have it ready",
      b.ty("display", { size: 64 }),
      ink,
      { w: 980 },
    )
    const meta = b.row(head, "Byline", { gap: 16, align: "center" })
    b.use(meta, avatar, { args: { size: "md", initials: "DP", tone: "sky" } })
    const who = b.col(meta, "Who", { gap: 2 })
    b.text(who, "Daniel Park", b.ty("label"), ink)
    b.text(who, "Audit lead, Ledgerline", b.ty("small"), muted)
    b.rect(meta, "Gap", { w: 24, h: 1, fill: c("bg") })
    b.text(meta, "Sep 24, 2026", b.ty("mono", { size: 12 }), muted)
    b.text(meta, "8 min read", b.ty("mono", { size: 12 }), muted)
    art(head, "Artwork", "butter", FILL, 380, 1)

    const body = block(scr, "Article", { pad: [72, 120, 0, 120] })
    const brow = b.row(body, "Article row", { w: FILL, gap: 80, align: "start" })
    const rail = b.col(brow, "Contents", { w: 240, gap: 14 })
    b.text(rail, "On this page", cap({ size: 11 }), muted)
    for (const [i, t] of [
      "The request list",
      "Trial balance and tie-outs",
      "Journal entries over threshold",
      "Support for estimates",
      "Who can see what",
    ].entries()) {
      const item = b.row(rail, t, { w: FILL, gap: 12, align: "start", pad: [0, 0, 0, 0] })
      b.text(item, `0${i + 1}`, b.ty("mono", { size: 12 }), i === 0 ? ink : muted)
      b.para(
        item,
        t,
        b.ty("body", { size: 14, weight: i === 0 ? 600 : 400 }),
        i === 0 ? ink : muted,
      )
    }
    const h2 = (parent: string, text: string) => {
      const w = b.col(parent, "Subhead", { w: FILL, pad: [24, 0, 0, 0] })
      b.para(w, text, b.ty("heading", { size: 30 }), ink)
    }
    const art_ = b.col(brow, "Text", { w: 680, gap: 24 })
    const p1 = (t: string) => b.para(art_, t, b.ty("body-lg", { size: 18, lineHeight: 1.65 }), ink)
    p1(
      "Auditors are not trying to be difficult. They sample, and what they sample first is whatever is quickest to test. If the first request takes a week to answer, the next ones get bigger.",
    )
    p1(
      "We read the opening request lists from 31 year-end audits our customers shared. Six requests showed up in almost every one, in nearly the same order.",
    )
    h2(art_, "The request list")
    p1(
      "Start with the trial balance as of year-end, the prior year comparative and a tie-out of each balance sheet account to a bank statement, subledger or schedule. Teams that keep these attached to the month-end task have them on day one.",
    )
    // Journal entry figure
    const fig = b.col(art_, "Figure", { w: FILL, gap: 12 })
    const tab = b.col(fig, "Journal entry", {
      w: FILL,
      radius: r("md"),
      fill: c("surface"),
      stroke: { paint: c("border-strong") },
      clip: true,
    })
    const th = b.row(tab, "Head", {
      w: FILL,
      pad: [10, 18],
      gap: 16,
      fill: c("subtle"),
      stroke: { paint: c("border-strong"), width: { b: 1 } },
    })
    b.para(th, "JE-2209  Accrue September hosting", cap({ size: 11 }), ink)
    b.para(th, "Debit", cap({ size: 11, align: "right" }), muted, { w: 96 })
    b.para(th, "Credit", cap({ size: 11, align: "right" }), muted, { w: 96 })
    for (const [acct, dr, cr] of [
      ["6140  Cloud hosting", "51,904.00", ""],
      ["2100  Accrued expenses", "", "51,904.00"],
    ] as const) {
      const tr = b.row(tab, acct, {
        w: FILL,
        pad: [12, 18],
        gap: 16,
        stroke: { paint: c("border"), width: { b: 1 } },
      })
      b.para(tr, acct, b.ty("mono", { size: 13 }), ink, { w: FILL })
      b.para(tr, dr || "0.00", b.ty("mono", { size: 13, align: "right" }), dr ? ink : muted, {
        w: 96,
      })
      b.para(tr, cr || "0.00", b.ty("mono", { size: 13, align: "right" }), cr ? ink : muted, {
        w: 96,
      })
    }
    b.text(
      fig,
      "An accrual with its support attached: invoice 2041, usage export, approver.",
      cap({ size: 11 }),
      muted,
    )
    h2(art_, "Journal entries over threshold")
    p1(
      "Auditors set a testing threshold and ask for every manual entry above it. Pull the list yourself before they do, and write one line of purpose next to each entry.",
    )
    const pq = b.row(art_, "Pull quote", {
      w: FILL,
      pad: [8, 0, 8, 24],
      stroke: { paint: c("mark"), width: { l: 5 } },
    })
    b.para(
      pq,
      "If the first request takes a week to answer, the next ones get bigger.",
      b.ty("heading", { size: 30, lineHeight: 1.25 }),
      ink,
    )
    p1(
      "Estimates are the other place time goes. For each accrual or reserve, keep the calculation, the source documents and the name of the person who approved it. A link from the entry to the task is enough.",
    )
    const call = b.row(art_, "Callout", {
      w: FILL,
      gap: 16,
      pad: 24,
      radius: r("md"),
      fill: c("tile-butter"),
    })
    b.icon(call, "shield-check", 20, ink)
    const ct = b.col(call, "Text", { w: FILL, gap: 6 })
    b.text(ct, "Give auditors read-only access", b.ty("label", { size: 15 }), ink)
    b.para(
      ct,
      "Share the period, not your drive. They see tasks, attachments and sign-offs, and nothing else.",
      b.ty("body", { size: 15 }),
      ink,
    )

    const more = block(scr, "Keep reading", { pad: [120, 120, 0, 120], gap: 8 })
    label(more, "01", "Keep reading")
    const col = b.col(more, "List", { w: FILL })
    for (const [date, tg, title, excerpt, who2, read] of blogPosts.slice(1, 3))
      b.use(col, postRow, {
        props: { w: FILL },
        args: {
          meta: date,
          tag: tg,
          title,
          excerpt,
          author: people[who2][0],
          initials: who2,
          readTime: read,
        },
        set: { PoAv: { args: { size: "sm", tone: people[who2][1] } } },
      })
    b.rect(scr, "Space", { w: FILL, h: 96, fill: c("bg") })
    b.use(scr, footer)
  }

  // Sign up
  {
    const scr = b.screen(screens, "Sign up", {
      dir: "row",
      w: 1440,
      h: 900,
      fill: c("bg"),
      gap: 0,
      align: "stretch",
    })
    const left = b.col(scr, "Form side", { w: 720, pad: [40, 120, 40, 120], justify: "between" })
    const topbar = b.row(left, "Top", { w: FILL, justify: "between", align: "center" })
    brand(topbar)
    const si = b.row(topbar, "Sign in", { gap: 6, align: "baseline" })
    b.text(si, "Have an account?", b.ty("body", { size: 14 }), muted)
    b.text(si, "Sign in", b.ty("label", { size: 14 }), ink)
    const form = b.col(left, "Form", { w: FILL, gap: 20 })
    b.text(form, "14-day trial", cap(), muted)
    b.para(form, "Create your workspace", b.ty("h1", { size: 44 }), ink)
    b.para(
      form,
      "No card needed. Invite your team once the first checklist is in.",
      b.ty("body"),
      muted,
    )
    b.use(form, buttonOutline, {
      props: { w: FILL },
      args: { label: "Continue with SSO", size: "lg", icon: true },
      set: { BtnIcon: { icon: "key-round" } },
    })
    const or = b.row(form, "Or", { w: FILL, gap: 12, align: "center" })
    b.divider(or, c("border"))
    b.text(or, "or", cap({ size: 11 }), muted)
    b.divider(or, c("border"))
    for (const [lab, ph, hint] of [
      ["Work email", "priya@halcyonhealth.com", ""],
      ["Full name", "Priya Raman", ""],
      ["Password", "At least 12 characters", "Use 12 or more characters with a number."],
    ] as const)
      b.use(form, input, {
        props: { w: FILL },
        args: { label: lab, placeholder: ph, ...(hint ? { hint, showHint: true } : {}) },
      })
    b.use(form, button, {
      props: { w: FILL },
      args: { label: "Create workspace", variant: "mark", size: "lg", icon: true },
    })
    b.text(
      left,
      "By continuing you agree to the Terms and the Privacy Policy.",
      b.ty("small"),
      muted,
    )

    const wrap = b.col(scr, "Panel wrap", { w: FILL, h: 900, pad: 16 })
    const panel = b.col(wrap, "Panel", {
      w: FILL,
      h: FILL,
      pad: 56,
      justify: "between",
      radius: r("xl"),
      fill: c("inverse"),
    })
    const incl = b.col(panel, "Included", { w: FILL, gap: 16 })
    b.text(incl, "In the trial", cap({ size: 11 }), c("inverse-muted"))
    for (const t of [
      "Import last month's checklist from a spreadsheet",
      "Connect NetSuite, Intacct, QuickBooks or Xero",
      "Bank feeds backfill 13 months overnight",
      "Invite auditors with read-only access",
    ])
      b.use(incl, checkRow, { props: { w: FILL }, args: { label: t, state: "onDark" } })
    const ghost = b.col(panel, "Ledger lines", { w: FILL })
    for (const [code, name, amt] of [
      ["1010", "Operating account", "412,908.14"],
      ["1200", "Accounts receivable", "188,420.00"],
      ["2100", "Accrued expenses", "64,310.55"],
      ["4000", "Subscription revenue", "1,204,550.10"],
    ]) {
      const gr = b.row(ghost, "Line", {
        w: FILL,
        gap: 16,
        pad: [12, 0],
        stroke: { paint: c("inverse-line"), width: { b: 1 } },
      })
      b.para(gr, code, b.ty("mono", { size: 12 }), c("inverse-muted"), { w: 48 })
      b.para(gr, name, b.ty("body", { size: 14 }), c("inverse-muted"))
      b.para(gr, amt, b.ty("mono", { size: 12, align: "right" }), c("inverse-muted"), { w: 120 })
    }
    b.use(panel, quote, {
      props: { w: FILL },
      args: {
        tone: "inverse",
        quote:
          "Flux notes used to live in a spreadsheet nobody opened. Now the owner writes them before review starts.",
        name: "Grace Liu",
        role: "Assistant Controller, Corvid Labs",
        initials: "GL",
      },
      set: { QAv: { args: { size: "md", tone: "lilac" } } },
    })
  }
}
