/**
 * Tidemark: the web app of a fictional product analytics tool, set up for Steepwell Tea Club, a
 * tea subscription business. Screens (1440×900 app frames): Overview, Funnels, Retention, Revenue,
 * Customers, Report builder.
 *
 * Direction (references in the brief): the restraint of Stripe's dashboard, Mixpanel's query
 * layout and Amplitude's funnels, without their chrome. One white canvas divided by hairline
 * rules instead of cards, a single teal accent, ochre and slate only where a second and third
 * series are needed, a grey dashed line for the previous period, JetBrains Mono for every
 * number in tables and on axes, direct labels at line ends instead of legends, status as a dot
 * and a word instead of a pill.
 */
import { FILL, fill, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "analytics-dashboard",
  name: "Tidemark subscription analytics",
  category: "Dashboard",
  description:
    "Six-screen analytics dashboard for a subscription business: overview, funnels, cohort retention, revenue, customers and a report builder.",
  prefix: "td",
  build,
}

const MONTHS = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"]
/** MRR in $K, Oct 2025 to Sep 2026. */
const MRR = [318.2, 326.5, 341.0, 349.8, 356.1, 362.4, 371.9, 380.3, 388.6, 396.2, 404.7, 412.9]
/** MRR in $K for the previous 12 months, Oct 2024 to Sep 2025. */
const MRR_PREV = [
  247.1, 251.8, 258.6, 265.2, 271.4, 278.0, 284.5, 291.3, 297.9, 304.2, 310.1, 316.0,
]
const EXPLORER = [82.1, 82.4, 83.0, 82.6, 81.9, 81.5, 81.2, 80.8, 80.4, 80.1, 79.7, 79.4]
const DAILY = [172.4, 176.0, 182.5, 186.1, 189.0, 191.6, 195.3, 199.0, 202.4, 205.0, 207.4, 209.4]
/** Plan MRR before $2.2K of discounts; Reserve is the remainder. */
const RESERVE = MRR.map((m, i) => +(m + 2.2 - (EXPLORER[i] ?? 0) - (DAILY[i] ?? 0)).toFixed(1))

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F6F5F1", "#0B0F0E"],
      surface: ["#FFFFFF", "#111615"],
      subtle: ["#F2F1EC", "#182020"],
      sidebar: ["#F3F2ED", "#0D1211"],
      ink: ["#13201F", "#E8EEEC"],
      "ink-2": ["#3A4A48", "#BCC8C5"],
      muted: ["#6B7775", "#8A9996"],
      border: ["#E1E0D9", "#232B2A"],
      grid: ["#ECEBE5", "#1B2322"],
      accent: ["#0B6B6A", "#46B8B3"],
      "accent-soft": ["#DCEEEC", "#12302F"],
      "on-accent": ["#FFFFFF", "#07100F"],
      success: ["#1F7A45", "#52C98A"],
      warning: ["#9A5B00", "#E8B04A"],
      danger: ["#B3392B", "#F0786B"],
      "series-1": ["#0B6B6A", "#46B8B3"],
      "series-2": ["#C27A12", "#E3A23B"],
      "series-3": ["#47629A", "#7E9AD6"],
      "series-prev": ["#A9B3B0", "#4D5957"],
      "series-1-soft": ["#0B6B6A1F", "#46B8B326"],
      "series-1-clear": ["#0B6B6A00", "#46B8B300"],
      "series-1-light": ["#8FC3BF", "#1F5E5B"],
      "series-2-light": ["#EBCB96", "#7A5416"],
      "heat-1": ["#F0F6F5", "#142120"],
      "heat-2": ["#D3E8E5", "#173432"],
      "heat-3": ["#A5D0CB", "#1B4A47"],
      "heat-4": ["#6FB0AA", "#22635F"],
      "heat-5": ["#2E8884", "#2C8580"],
      "heat-6": ["#0A4F4E", "#5BC9C3"],
      "heat-ink": ["#13201F", "#E8EEEC"],
      "heat-ink-strong": ["#FFFFFF", "#FFFFFF"],
      "heat-ink-top": ["#FFFFFF", "#06100F"],
      "tone-1": ["#D7E6E4", "#1F3836"],
    },
    numbers: {
      "space/1": 4,
      "space/2": 8,
      "space/3": 12,
      "space/4": 16,
      "space/5": 20,
      "space/6": 24,
      "space/8": 32,
      "radius/sm": 2,
      "radius/md": 4,
      "radius/lg": 4,
      "radius/pill": 999,
      "size/sidebar": 216,
      "size/topbar": 52,
    },
    type: {
      display: { font: "Inter", size: 52, weight: 300, lineHeight: 1.05, letterSpacing: -2 },
      h1: { font: "Inter", size: 22, weight: 600, lineHeight: 1.25, letterSpacing: -0.5 },
      heading: { font: "Inter", size: 14, weight: 600, lineHeight: 1.3, letterSpacing: -0.1 },
      metric: {
        font: "Inter",
        size: 30,
        weight: 500,
        lineHeight: 1.15,
        letterSpacing: -1,
        features: { tnum: true },
      },
      body: { font: "Inter", size: 13, weight: 400, lineHeight: 1.5 },
      label: { font: "Inter", size: 12, weight: 500, lineHeight: 1.3 },
      small: { font: "Inter", size: 12, weight: 400, lineHeight: 1.4 },
      num: { font: "JetBrains Mono", size: 12, weight: 400, lineHeight: 1.3 },
      axis: { font: "JetBrains Mono", size: 10.5, weight: 400, lineHeight: 1.3 },
      eyebrow: {
        font: "JetBrains Mono",
        size: 10.5,
        weight: 500,
        lineHeight: 1.3,
        letterSpacing: 0.8,
      },
    },
  })

  const c = (n: string) => b.c(n)
  const s = (n: number) => b.n(`space/${n}`)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  const hair = (sides: Record<string, number> = { b: 1 }, paint = c("border")) => ({
    stroke: { paint, width: sides },
  })
  const overlay = { "kimo.template.overlay": true }

  // --- Components: basics ----------------------------------------------------------------------

  const button = b.component(
    "Button",
    {
      key: "Btn",
      section: "Actions",
      description: "Primary, secondary or ghost; sm or md.",
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
            "BtnIcon.color": c("ink-2"),
          },
          ghost: {
            "root.fill": [],
            "root.stroke": { paint: c("border"), width: 0 },
            "BtnLabel.fill": c("ink-2"),
            "BtnIcon.color": c("ink-2"),
          },
        }),
        size: p.variants({
          md: { "root.layout/pad": [7, 12], "BtnLabel.style/size": 12 },
          sm: { "root.layout/pad": [4, 9], "BtnLabel.style/size": 12 },
        }),
      },
      root: {
        dir: "row",
        gap: 6,
        align: "center",
        justify: "center",
        pad: [7, 12],
        radius: r("md"),
        fill: c("accent"),
        stroke: { paint: c("accent") },
      },
    },
    (root) => {
      b.icon(root, "plus", 14, c("on-accent"), { key: "BtnIcon", visible: false })
      b.text(root, "Button", b.ty("label"), c("on-accent"), { key: "BtnLabel", name: "Label" })
    },
  )
  const buttonSecondary = b.derive(button, "Button/Secondary", "BtnSec", {
    section: "Actions",
    args: { variant: "secondary" },
  })

  const dotTone = (color: string) => ({ "BadgeDot.fill": c(color) })
  const badge = b.component(
    "Status",
    {
      key: "Badge",
      section: "Status",
      description: "A colored dot and a word. Plan tones use the chart series colors.",
      props: {
        label: p.text("BadgeLbl", "Status"),
        tone: p.variants({
          neutral: dotTone("series-prev"),
          accent: dotTone("accent"),
          success: dotTone("success"),
          warning: dotTone("warning"),
          danger: dotTone("danger"),
          s1: dotTone("series-1"),
          s2: dotTone("series-2"),
          s3: dotTone("series-3"),
        }),
      },
      root: { dir: "row", gap: 7, align: "center" },
    },
    (root) => {
      b.ellipse(root, "Dot", { key: "BadgeDot", w: 7, h: 7, fill: c("series-prev") })
      b.text(root, "Status", b.ty("body", { size: 12 }), c("ink-2"), {
        key: "BadgeLbl",
        name: "Label",
      })
    },
  )

  const deltaTone = (fg: string, icon: string) => ({
    "DlLbl.fill": c(fg),
    "DlIcon.color": c(fg),
    "DlIcon.icon": icon,
  })
  const delta = b.component(
    "Delta",
    {
      key: "Delta",
      section: "Status",
      description: "Change vs the previous period. Pick the direction and whether it is good.",
      props: {
        label: p.text("DlLbl", "+0%"),
        trend: p.variants({
          up: deltaTone("success", "arrow-up-right"),
          down: deltaTone("danger", "arrow-down-right"),
          downGood: deltaTone("success", "arrow-down-right"),
          upBad: deltaTone("danger", "arrow-up-right"),
          flat: deltaTone("muted", "arrow-right"),
        }),
      },
      root: { dir: "row", gap: 2, align: "center" },
    },
    (root) => {
      b.icon(root, "arrow-up-right", 13, c("success"), { key: "DlIcon" })
      b.text(root, "+0%", b.ty("num", { weight: 500 }), c("success"), { key: "DlLbl" })
    },
  )

  const avatar = b.component(
    "Avatar",
    {
      key: "Avatar",
      section: "Status",
      props: {
        initials: p.text("AvInit", "SW"),
        size: p.variants({
          sm: { "root.w": 26, "root.h": 26, "AvInit.style/size": 10.5 },
          md: { "root.w": 32, "root.h": 32, "AvInit.style/size": 12 },
        }),
      },
      root: {
        dir: "row",
        w: 26,
        h: 26,
        align: "center",
        justify: "center",
        radius: r("md"),
        fill: c("tone-1"),
      },
    },
    (root) =>
      b.text(root, "SW", b.ty("num", { size: 10.5, weight: 500 }), ink, {
        key: "AvInit",
        name: "Initials",
      }),
  )

  const legend = b.component(
    "Legend item",
    {
      key: "Legend",
      section: "Charts",
      props: {
        label: p.text("LgLbl", "Series"),
        series: p.variants({
          s1: { "LgKey.fill": c("series-1") },
          s2: { "LgKey.fill": c("series-2") },
          s3: { "LgKey.fill": c("series-3") },
          s1light: { "LgKey.fill": c("series-1-light") },
          s2light: { "LgKey.fill": c("series-2-light") },
          prev: { "LgKey.fill": c("series-prev") },
        }),
      },
      root: { dir: "row", gap: 6, align: "center" },
    },
    (root) => {
      b.rect(root, "Key", { key: "LgKey", w: 8, h: 8, radius: 1, fill: c("series-1") })
      b.text(root, "Series", b.ty("small"), c("ink-2"), { key: "LgLbl" })
    },
  )

  const sparks = {
    up: "M0 22 L10 20 L20 21 L30 15 L40 16 L50 9 L64 4",
    down: "M0 4 L10 7 L20 6 L30 12 L40 13 L50 18 L64 21",
    flat: "M0 13 L10 10 L20 14 L30 11 L40 13 L50 10 L64 12",
  }
  const stat = b.component(
    "Stat",
    {
      key: "Kpi",
      section: "Charts",
      description:
        "One cell of the metric strip: label, number, change and a 12-month sparkline. The first cell hides its left rule.",
      props: {
        label: p.text("KpLbl", "Metric"),
        value: p.text("KpVal", "0"),
        delta: p.text("KpDelta/DlLbl", "+0%"),
        caption: p.text("KpCap", "vs last month"),
        spark: p.variants({
          up: { "KpSpark.d": sparks.up },
          down: { "KpSpark.d": sparks.down },
          flat: { "KpSpark.d": sparks.flat },
        }),
      },
      root: {
        dir: "column",
        w: 290,
        gap: 6,
        pad: [16, 20],
        stroke: { paint: c("border"), width: { l: 1 } },
      },
    },
    (root) => {
      b.text(root, "Metric", b.ty("label"), muted, { key: "KpLbl" })
      const mid = b.row(root, "Value row", { w: FILL, justify: "between", align: "end" })
      b.text(mid, "0", b.ty("metric"), ink, { key: "KpVal", name: "Value" })
      b.add(mid, {
        type: "path",
        key: "KpSpark",
        name: "Sparkline",
        w: 64,
        h: 26,
        viewBox: [0, 0, 64, 26],
        d: sparks.up,
        stroke: { paint: c("series-1"), width: 1.5, join: "round", cap: "round" },
      })
      const foot = b.row(root, "Footer", { gap: 8, align: "center" })
      b.use(foot, delta, { key: "KpDelta" })
      b.text(foot, "vs last month", b.ty("small"), muted, { key: "KpCap" })
    },
  )

  const panel = b.component(
    "Panel",
    {
      key: "Chart",
      section: "Charts",
      description:
        "A section under a hairline rule. Legend slot for Legend items; Body slot for the plot or table.",
      props: {
        title: p.text("ChTitle", "Chart title"),
        subtitle: p.text("ChSub", "What it measures"),
        legend: p.slot("ChLegend"),
        body: p.slot("ChBody"),
      },
      root: { dir: "column", w: 560, gap: 12, pad: [14, 0, 0, 0], ...hair({ t: 1 }, ink) },
    },
    (root) => {
      const head = b.row(root, "Header", { w: FILL, gap: 16, align: "start" })
      const t = b.col(head, "Titles", { w: FILL, gap: 2 })
      b.text(t, "Chart title", b.ty("heading"), ink, { key: "ChTitle" })
      b.text(t, "What it measures", b.ty("small"), muted, { key: "ChSub" })
      b.row(head, "Legend", {
        key: "ChLegend",
        gap: 14,
        align: "center",
        slot: { suggested: [legend] },
      })
      b.col(root, "Body", { key: "ChBody", w: FILL, h: FILL, slot: {} })
    },
  )

  const tabLabels = ["One", "Two", "Three"]
  const tabActive = (i: number) =>
    Object.fromEntries(
      tabLabels.flatMap((_, j) => [
        [`SgI${j + 1}.stroke`, { paint: j === i ? ink : c("surface"), width: { b: 2 } }],
        [`SgL${j + 1}.fill`, j === i ? ink : muted],
      ]),
    )
  const tabs = b.component(
    "Tabs",
    {
      key: "Seg",
      section: "Controls",
      description: "Underlined view switcher.",
      props: {
        first: p.text("SgL1", "One"),
        second: p.text("SgL2", "Two"),
        third: p.text("SgL3", "Three"),
        active: p.variants({ first: tabActive(0), second: tabActive(1), third: tabActive(2) }),
      },
      root: { dir: "row", gap: 20 },
    },
    (root) => {
      for (const [i, l] of tabLabels.entries()) {
        const it = b.row(root, l, {
          key: `SgI${i + 1}`,
          pad: [4, 0, 8, 0],
          stroke: { paint: i === 0 ? ink : c("surface"), width: { b: 2 } },
        })
        b.text(it, l, b.ty("label", { size: 12.5 }), i === 0 ? ink : muted, { key: `SgL${i + 1}` })
      }
    },
  )

  const chip = b.component(
    "Filter chip",
    {
      key: "Chip",
      section: "Controls",
      props: {
        field: p.text("ChpField", "Field"),
        value: p.text("ChpVal", "is any"),
        removable: p.bool("ChpX", true),
      },
      root: {
        dir: "row",
        gap: 6,
        align: "center",
        pad: [5, 9],
        radius: r("md"),
        stroke: { paint: c("border") },
      },
    },
    (root) => {
      b.icon(root, "list-filter", 12, muted, { key: "ChpIcon" })
      b.text(root, "Field", b.ty("small"), muted, { key: "ChpField" })
      b.text(root, "is any", b.ty("label"), ink, { key: "ChpVal" })
      b.icon(root, "x", 12, muted, { key: "ChpX" })
    },
  )

  const select = b.component(
    "Select",
    {
      key: "Select",
      section: "Controls",
      props: {
        label: p.text("SlLbl", "Label"),
        value: p.text("SlVal", "Value"),
        showLabel: p.bool("SlLbl", true),
      },
      root: { dir: "column", w: 280, gap: 5 },
    },
    (root) => {
      b.text(root, "Label", b.ty("label"), c("ink-2"), { key: "SlLbl" })
      const f = b.row(root, "Field", {
        w: FILL,
        gap: 8,
        align: "center",
        pad: [7, 10],
        radius: r("md"),
        stroke: { paint: c("border") },
      })
      b.icon(f, "chart-line", 14, muted, { key: "SlIcon" })
      b.text(f, "Value", b.ty("body", { size: 12.5 }), ink, {
        key: "SlVal",
        w: FILL,
        grow: "fixed-width",
      })
      b.icon(f, "chevron-down", 14, muted)
    },
  )

  const fieldRow = b.component(
    "Field option",
    {
      key: "Field",
      section: "Controls",
      props: {
        label: p.text("FoLbl", "Field"),
        kind: p.text("FoKind", "Property"),
        checked: p.variants({
          yes: {
            "FoBox.fill": c("accent"),
            "FoBox.stroke": { paint: c("accent"), width: 1 },
            "FoTick.visible": true,
            "root.stroke": { paint: c("accent"), width: { l: 2 } },
          },
          no: {
            "FoBox.fill": c("surface"),
            "FoBox.stroke": { paint: c("series-prev"), width: 1 },
            "FoTick.visible": false,
            "root.stroke": { paint: c("accent"), width: { l: 0 } },
          },
        }),
      },
      root: {
        dir: "row",
        w: 260,
        gap: 10,
        align: "center",
        pad: [7, 10],
        stroke: { paint: c("accent"), width: { l: 2 } },
      },
    },
    (root) => {
      const box = b.row(root, "Box", {
        key: "FoBox",
        w: 14,
        h: 14,
        radius: r("sm"),
        align: "center",
        justify: "center",
        fill: c("accent"),
        stroke: { paint: c("accent"), width: 1 },
      })
      b.icon(box, "check", 11, c("on-accent"), { key: "FoTick" })
      b.text(root, "Field", b.ty("body", { size: 12.5 }), ink, {
        key: "FoLbl",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(root, "Property", b.ty("eyebrow", { size: 9.5 }), muted, { key: "FoKind" })
    },
  )

  // --- Components: navigation ----------------------------------------------------------------

  const navItem = b.component(
    "Nav item",
    {
      key: "Nav",
      section: "Navigation",
      props: {
        label: p.text("NavLbl", "Item"),
        state: p.variants({
          default: {
            "root.stroke": { paint: c("accent"), width: { l: 0 } },
            "NavLbl.fill": c("ink-2"),
            "NavLbl.style/weight": 400,
            "NavIcon.color": muted,
          },
          active: {
            "root.stroke": { paint: c("accent"), width: { l: 2 } },
            "NavLbl.fill": ink,
            "NavLbl.style/weight": 600,
            "NavIcon.color": c("accent"),
          },
        }),
      },
      root: {
        dir: "row",
        w: 192,
        gap: 10,
        align: "center",
        pad: [6, 10],
        stroke: { paint: c("accent"), width: { l: 0 } },
      },
    },
    (root) => {
      b.icon(root, "layout-dashboard", 15, muted, { key: "NavIcon" })
      b.text(root, "Item", b.ty("body", { size: 13, weight: 400 }), c("ink-2"), {
        key: "NavLbl",
        w: FILL,
        grow: "fixed-width",
      })
    },
  )

  const navs = [
    ["Overview", "layout-dashboard"],
    ["Funnels", "funnel"],
    ["Retention", "repeat"],
    ["Revenue", "dollar-sign"],
    ["Customers", "users"],
    ["Report builder", "chart-column"],
  ] as const
  const sidebar = b.component(
    "Sidebar",
    {
      key: "Sidebar",
      section: "Navigation",
      description: "Set the active Nav item's state on each screen.",
      root: {
        dir: "column",
        w: b.n("size/sidebar"),
        h: 900,
        justify: "between",
        pad: [20, 12],
        fill: c("sidebar"),
        stroke: { paint: c("border"), width: { r: 1 } },
      },
    },
    (root) => {
      const top = b.col(root, "Top", { w: FILL, gap: s(6) })
      // Wordmark with a tide line: two rules, the lower one shorter.
      const brand = b.row(top, "Brand", { gap: 10, align: "center", pad: [0, 10] })
      const mark = b.col(brand, "Mark", {
        w: 18,
        h: 18,
        justify: "end",
        radius: 2,
        clip: true,
        stroke: { paint: ink, width: 1.5 },
      })
      b.rect(mark, "Water", { w: FILL, h: 8, fill: c("accent") })
      b.text(brand, "Tidemark", b.ty("heading", { size: 15, letterSpacing: -0.3 }), ink)
      const ws = b.row(top, "Workspace", {
        w: FILL,
        gap: 8,
        align: "center",
        pad: [7, 10],
        radius: r("md"),
        stroke: { paint: c("border") },
        fill: c("surface"),
      })
      const wt = b.col(ws, "Names", { w: FILL, gap: 0 })
      b.text(wt, "Steepwell Tea Club", b.ty("label", { size: 12.5 }), ink)
      b.text(wt, "Production", b.ty("axis"), muted)
      b.icon(ws, "chevrons-up-down", 13, muted)
      const nav = b.col(top, "Navigation", { w: FILL, gap: 1 })
      b.text(nav, "ANALYZE", b.ty("eyebrow"), muted, { name: "Section" })
      for (const [i, [label, icon]] of navs.entries())
        b.use(nav, navItem, {
          key: `SbNav${i + 1}`,
          props: { w: FILL },
          args: { label },
          set: { NavIcon: { icon } },
        })
      const saved = b.col(top, "Saved reports", { w: FILL, gap: 1 })
      b.text(saved, "SAVED REPORTS", b.ty("eyebrow"), muted, { name: "Section" })
      for (const label of ["Weekly exec summary", "Reserve plan health", "Gift subscriptions"])
        b.use(saved, navItem, {
          props: { w: FILL },
          args: { label },
          set: { NavIcon: { icon: "file-text" } },
        })
      const bottom = b.col(root, "Bottom", { w: FILL, gap: 2 })
      b.use(bottom, navItem, {
        props: { w: FILL },
        args: { label: "Settings" },
        set: { NavIcon: { icon: "settings" } },
      })
      const me = b.row(bottom, "Account", {
        w: FILL,
        gap: 10,
        align: "center",
        pad: [12, 10, 0, 10],
        stroke: { paint: c("border"), width: { t: 1 } },
      })
      b.use(me, avatar, { args: { initials: "RN", size: "sm" } })
      const who = b.col(me, "Names", { w: FILL, gap: 0 })
      b.text(who, "Rosa Nguyen", b.ty("label"), ink)
      b.text(who, "Head of growth", b.ty("small", { size: 11 }), muted)
    },
  )

  const topBar = b.component(
    "Top bar",
    {
      key: "TopBar",
      section: "Navigation",
      props: {
        title: p.text("TbTitle", "Page"),
        actions: p.slot("TbActs"),
      },
      root: {
        dir: "row",
        w: 1224,
        h: b.n("size/topbar"),
        gap: 12,
        align: "center",
        pad: [0, 32],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const crumb = b.row(root, "Breadcrumb", { w: FILL, gap: 8, align: "center" })
      b.text(crumb, "Steepwell Tea Club", b.ty("body", { size: 12.5 }), muted)
      b.text(crumb, "/", b.ty("num"), muted)
      b.text(crumb, "Page", b.ty("label", { size: 12.5 }), ink, { key: "TbTitle", name: "Title" })
      const search = b.row(root, "Search", {
        w: 220,
        gap: 8,
        align: "center",
        pad: [6, 10],
        radius: r("md"),
        fill: c("subtle"),
      })
      b.icon(search, "search", 13, muted)
      b.text(search, "Search metrics and reports", b.ty("small"), muted, {
        w: FILL,
        grow: "fixed-width",
      })
      const key = b.row(search, "Key", { pad: [0, 5], stroke: { paint: c("border") }, radius: 2 })
      b.text(key, "/", b.ty("axis"), muted)
      b.row(root, "Actions", {
        key: "TbActs",
        gap: 8,
        align: "center",
        slot: { suggested: [button, buttonSecondary] },
      })
    },
  )

  // --- Components: data ------------------------------------------------------------------------

  const funnelStep = b.component(
    "Funnel step",
    {
      key: "Step",
      section: "Charts",
      description:
        "Bar is the share of the first step; the lighter part above it is what dropped off.",
      props: {
        index: p.text("FsIdx", "01"),
        name: p.text("FsName", "Step"),
        count: p.text("FsCount", "0"),
        rate: p.text("FsRate", "100%"),
        drop: p.text("FsDrop", "0 dropped"),
        showDrop: p.bool("FsDrop", true),
      },
      root: { dir: "column", w: 184, gap: 8 },
    },
    (root) => {
      const head = b.col(root, "Header", { w: FILL, gap: 4 })
      const nr = b.row(head, "Name row", { w: FILL, gap: 8, align: "baseline" })
      b.text(nr, "01", b.ty("axis"), muted, { key: "FsIdx", name: "Index" })
      b.text(nr, "Step", b.ty("label", { size: 12.5, weight: 600 }), ink, {
        key: "FsName",
        w: FILL,
        grow: "fixed-width",
      })
      const cr = b.row(head, "Count row", { w: FILL, gap: 8, align: "baseline" })
      b.text(cr, "0", b.ty("metric", { size: 22 }), ink, { key: "FsCount" })
      b.text(cr, "100%", b.ty("num", { weight: 500 }), c("accent"), { key: "FsRate" })
      const bar = b.col(root, "Bar", { w: FILL, h: 236, gap: 0, clip: true })
      b.rect(bar, "Lost", { key: "FsLost", w: FILL, h: fill(1), fill: c("series-1-soft") })
      b.rect(bar, "Kept", { key: "FsKept", w: FILL, h: fill(99), fill: c("series-1") })
      b.text(root, "0 dropped", b.ty("small"), muted, { key: "FsDrop" })
    },
  )
  const share = (n: number) => ({
    FsLost: { visible: n < 100, h: fill(Math.max(100 - n, 0.1)) },
    FsKept: { h: fill(n) },
  })
  const funnelLink = b.component(
    "Funnel connector",
    {
      key: "StepLink",
      section: "Charts",
      description: "Step-to-step conversion between two bars.",
      props: { rate: p.text("SlkRate", "0%") },
      root: { dir: "column", w: 56, h: 236, gap: 4, align: "center", justify: "center" },
    },
    (root) => {
      b.text(root, "0%", b.ty("num", { size: 11, weight: 500 }), ink, { key: "SlkRate" })
      b.icon(root, "arrow-right", 13, muted)
    },
  )

  const heatOpts = Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((lv) => [
      `l${lv}`,
      {
        "root.fill": c(`heat-${lv}`),
        "CcVal.fill": lv === 6 ? c("heat-ink-top") : lv >= 5 ? c("heat-ink-strong") : c("heat-ink"),
        "CcVal.visible": true,
      },
    ]),
  )
  const cohortCell = b.component(
    "Cohort cell",
    {
      key: "Cell",
      section: "Charts",
      description: "Heat level l1 to l6 by retention; future months hide the value.",
      props: {
        value: p.text("CcVal", "100%"),
        level: p.variants({
          ...heatOpts,
          future: { "root.fill": c("surface"), "CcVal.visible": false },
        }),
      },
      root: {
        dir: "row",
        w: 80,
        h: 28,
        align: "center",
        justify: "center",
        radius: 0,
        fill: c("heat-6"),
      },
    },
    (root) =>
      b.text(root, "100%", b.ty("num", { size: 11.5 }), c("heat-ink-top"), { key: "CcVal" }),
  )

  const tableCols: [string, number | null, "left" | "right"][] = [
    ["Customer", null, "left"],
    ["Plan", 100, "left"],
    ["Status", 100, "left"],
    ["MRR", 80, "right"],
    ["Boxes", 64, "right"],
    ["Lifetime value", 110, "right"],
    ["Joined", 110, "left"],
    ["Last order", 100, "left"],
  ]
  const customerRow = b.component(
    "Customer row",
    {
      key: "CustRow",
      section: "Data",
      props: {
        name: p.text("CrName", "Name"),
        email: p.text("CrEmail", "name@example.com"),
        plan: p.text("CrPlan/BadgeLbl", "Daily"),
        status: p.text("CrStatus/BadgeLbl", "Active"),
        mrr: p.text("CrMrr", "$0"),
        boxes: p.text("CrBoxes", "0"),
        ltv: p.text("CrLtv", "$0"),
        joined: p.text("CrJoined", "Jan 1, 2026"),
        last: p.text("CrLast", "Sep 30"),
      },
      root: {
        dir: "row",
        w: 1160,
        gap: 16,
        align: "center",
        pad: [9, 20],
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      const names = b.col(root, "Customer", { w: FILL, gap: 1 })
      b.text(names, "Name", b.ty("label", { size: 12.5 }), ink, { key: "CrName" })
      b.text(names, "name@example.com", b.ty("small", { size: 11.5 }), muted, { key: "CrEmail" })
      const plan = b.row(root, "Plan", { w: 100 })
      b.use(plan, badge, { key: "CrPlan", args: { label: "Daily", tone: "s1" } })
      const st = b.row(root, "Status", { w: 100 })
      b.use(st, badge, { key: "CrStatus", args: { label: "Active", tone: "success" } })
      const num = (key: string, v: string, w: number, left = false) =>
        b.text(root, v, b.ty("num", { align: left ? "left" : "right" }), left ? c("ink-2") : ink, {
          key,
          w,
          grow: "fixed-width",
        })
      num("CrMrr", "$0", 80)
      num("CrBoxes", "0", 64)
      num("CrLtv", "$0", 110)
      num("CrJoined", "Jan 1, 2026", 110, true)
      num("CrLast", "Sep 30", 100, true)
    },
  )

  const meter = b.component(
    "Meter",
    {
      key: "Meter",
      section: "Data",
      description: "Labelled share bar. Set the Done and Left weights.",
      props: {
        label: p.text("MtLbl", "Label"),
        value: p.text("MtVal", "0"),
        detail: p.text("MtDet", "0%"),
        tone: p.variants({
          s1: { "MtDone.fill": c("series-1") },
          s2: { "MtDone.fill": c("series-2") },
          s3: { "MtDone.fill": c("series-3") },
        }),
      },
      root: { dir: "column", w: 320, gap: 7 },
    },
    (root) => {
      const line = b.row(root, "Line", { w: FILL, gap: 8, align: "center" })
      b.text(line, "Label", b.ty("body", { size: 12.5 }), c("ink-2"), {
        key: "MtLbl",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(line, "0", b.ty("num"), ink, { key: "MtVal" })
      b.text(line, "0%", b.ty("num", { align: "right" }), muted, {
        key: "MtDet",
        w: 52,
        grow: "fixed-width",
      })
      const bar = b.row(root, "Bar", { w: FILL, h: 4, fill: c("subtle"), clip: true })
      b.rect(bar, "Done", { key: "MtDone", w: fill(50), h: 4, fill: c("series-1") })
      b.rect(bar, "Left", { key: "MtLeft", w: fill(50), h: 4, fill: c("subtle") })
    },
  )
  const pct = (n: number) => ({
    MtDone: { w: fill(n) },
    MtLeft: { w: fill(Math.max(100 - n, 0.1)) },
  })

  // --- Data and chart helpers ----------------------------------------------------------------

  type Slot = { inst: string; at: string }
  const YW = 48 // y axis column (40) + gap (8)
  /** Gridlines with y labels; returns the plot frame (pw × ph) for overlays. */
  function plotFrame(parent: string | Slot, pw: number, ph: number, ticks: string[]) {
    const area = b.row(parent, "Plot area", { w: FILL, h: ph + 16, gap: 8 })
    const yAxis = b.col(area, "Y axis", { w: 40, h: FILL, justify: "between", align: "end" })
    for (const t of ticks) b.text(yAxis, t, b.ty("axis", { align: "right" }), muted)
    const wrap = b.col(area, "Plot wrap", { w: pw, h: FILL, pad: [8, 0] })
    const plot = b.col(wrap, "Plot", { w: pw, h: ph, justify: "between" })
    ticks.forEach((_, i) => {
      b.rect(plot, "Gridline", {
        w: FILL,
        h: 1,
        fill: i === ticks.length - 1 ? c("series-prev") : c("grid"),
      })
    })
    return plot
  }
  /** Month labels centered under equal cells of `dw` total width. */
  function xAxis(parent: string | Slot, labels: string[], dw: number, rightPad = 0) {
    const cw = Math.floor(dw / labels.length)
    const row = b.row(parent, "X axis", { w: FILL, pad: [6, rightPad, 0, YW] })
    for (const l of labels)
      b.text(row, l, b.ty("axis", { align: "center" }), muted, { w: cw, grow: "fixed-width" })
  }
  /** Space reserved at the right of a line plot for the end labels. */
  const LABEL_W = 64
  const pts = (vals: number[], dw: number, ph: number, min: number, max: number) =>
    vals.map((v, i) => [
      +(((i + 0.5) * dw) / vals.length).toFixed(1),
      +(ph - ((v - min) / (max - min)) * ph).toFixed(1),
    ])
  const linePath = (p0: number[][]) => p0.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ")
  function lineSeries(
    plot: string,
    vals: number[],
    pw: number,
    ph: number,
    min: number,
    max: number,
    color: string,
    o: { area?: boolean; dash?: number[]; label?: string; width?: number } = {},
  ) {
    const dw = pw - LABEL_W
    const pp = pts(vals, dw, ph, min, max)
    if (o.area)
      b.add(plot, {
        type: "path",
        name: "Area",
        position: "absolute",
        x: 0,
        y: 0,
        w: dw,
        h: ph,
        viewBox: [0, 0, dw, ph],
        d: `${linePath(pp)} L${pp[pp.length - 1]?.[0]} ${ph} L${pp[0]?.[0]} ${ph} Z`,
        fill: {
          kind: "linear",
          rotation: 180,
          stops: [
            { color: c("series-1-soft"), at: 0 },
            { color: c("series-1-clear"), at: 1 },
          ],
        },
        meta: overlay,
      })
    b.add(plot, {
      type: "path",
      name: "Line",
      position: "absolute",
      x: 0,
      y: 0,
      w: dw,
      h: ph,
      viewBox: [0, 0, dw, ph],
      d: linePath(pp),
      stroke: {
        paint: c(color),
        width: o.width ?? 2,
        join: "round",
        cap: "round",
        ...(o.dash ? { dash: o.dash } : {}),
      },
      meta: overlay,
    })
    const last = pp[pp.length - 1] as number[]
    if (!o.dash)
      b.ellipse(plot, "Marker", {
        position: "absolute",
        x: (last[0] as number) - 4,
        y: (last[1] as number) - 4,
        w: 8,
        h: 8,
        fill: c(color),
        stroke: { paint: c("surface"), width: 2 },
        meta: overlay,
      })
    if (o.label)
      b.text(plot, o.label, b.ty("num", { weight: 500 }), c(color), {
        position: "absolute",
        x: (last[0] as number) + 10,
        y: Math.min(Math.max((last[1] as number) - 8, 0), ph - 16),
        meta: overlay,
      })
  }

  // --- App shell -------------------------------------------------------------------------------

  const screens = b.page("Screens")
  /** Content width inside the main column (1224 - 2 × 32). */
  const CW = 1160
  function shell(name: string, active: number, actions?: (into: Slot) => void) {
    const scr = b.screen(screens, name, { dir: "row", w: 1440, h: 900, fill: c("surface") })
    b.use(scr, sidebar, {
      props: { h: FILL },
      set: { [`SbNav${active}`]: { args: { label: navs[active - 1]?.[0], state: "active" } } },
    })
    const main = b.col(scr, "Main", { w: FILL, h: FILL })
    b.use(main, topBar, {
      props: { w: FILL },
      args: { title: name },
      ...(actions ? { slots: { TbActs: actions } } : {}),
    })
    return b.col(main, "Content", { w: FILL, h: FILL, gap: s(5), pad: [24, 32] })
  }
  const exportBtn = (into: Slot) =>
    b.use(into, buttonSecondary, {
      args: { label: "Export", icon: true },
      set: { BtnIcon: { icon: "download" } },
    })
  const legendIn = (into: Slot, items: [string, string][]) => {
    for (const [label, series] of items) b.use(into, legend, { args: { label, series } })
  }
  const heatScale = (into: Slot) => {
    const scale = b.row(into, "Heat scale", { gap: 6, align: "center" })
    b.text(scale, "Lower", b.ty("small"), muted)
    const steps = b.row(scale, "Steps", { gap: 1 })
    for (let lv = 1; lv <= 6; lv++)
      b.rect(steps, `Level ${lv}`, { w: 16, h: 8, fill: c(`heat-${lv}`) })
    b.text(scale, "Higher", b.ty("small"), muted)
  }
  function chart(
    parent: string,
    title: string,
    subtitle: string,
    props: Record<string, unknown>,
    body: (into: Slot) => void,
    legendItems?: [string, string][] | "heat",
  ) {
    return b.use(parent, panel, {
      props,
      args: { title, subtitle },
      ...(legendItems ? {} : { hide: ["ChLegend"] }),
      slots: {
        ...(legendItems === "heat"
          ? { ChLegend: heatScale }
          : legendItems
            ? { ChLegend: (into: Slot) => legendIn(into, legendItems) }
            : {}),
        ChBody: body,
      },
    })
  }
  /** Page title, one muted line under it, and optional controls on the right. */
  function pageHead(parent: string, title: string, sub: string) {
    const row = b.col(parent, "Page header", { w: FILL, gap: 4 })
    b.text(row, title, b.ty("h1"), ink)
    b.text(row, sub, b.ty("body", { size: 12.5 }), muted)
    return row
  }
  /** Range, comparison and interval selectors. */
  function controls(parent: string, range: string, trailing?: string) {
    const row = b.row(parent, "Controls", { w: FILL, gap: 8, align: "center" })
    b.use(row, select, {
      props: { w: 268 },
      args: { showLabel: false, value: range },
      set: { SlIcon: { icon: "calendar" } },
    })
    b.text(row, "compared to", b.ty("small"), muted)
    b.use(row, select, {
      props: { w: 168 },
      args: { showLabel: false, value: "Previous period" },
      set: { SlIcon: { icon: "git-compare" } },
    })
    b.use(row, select, {
      props: { w: 120 },
      args: { showLabel: false, value: "Monthly" },
      set: { SlIcon: { icon: "chart-line" } },
    })
    if (trailing) {
      b.rect(row, "Spacer", { w: FILL, h: 1, fill: c("surface") })
      b.text(row, trailing, b.ty("axis"), muted)
    }
    return row
  }
  function statStrip(parent: string, items: [string, string, string, string, string, string][]) {
    const row = b.row(parent, "Metrics", { w: FILL, gap: 0, ...hair({ t: 1, b: 1 }) })
    const w = Math.floor(CW / items.length)
    for (const [i, [label, value, d, trend, spark, caption]] of items.entries())
      b.use(row, stat, {
        props: { w, ...(i === 0 ? { stroke: { paint: c("border"), width: { l: 0 } } } : {}) },
        args: { label, value, delta: d, caption, spark },
        set: { KpDelta: { args: { label: d, trend } } },
      })
  }
  const tableHead = (parent: string | Slot, cols: [string, number | null, "left" | "right"][]) => {
    const th = b.row(parent, "Head", {
      w: FILL,
      gap: 16,
      pad: [8, 20],
      fill: c("subtle"),
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    for (const [t, w, align] of cols)
      b.text(th, t.toUpperCase(), b.ty("eyebrow", { size: 9.5, align }), muted, {
        ...(w ? { w, grow: "fixed-width" } : { w: FILL, grow: "fixed-width" }),
      })
    return th
  }
  function simpleRow(
    parent: string | Slot,
    cells: [string, number | null, "left" | "right", boolean?][],
    pad: number[] = [10, 20],
  ) {
    const tr = b.row(parent, cells[0]?.[0] ?? "Row", {
      w: FILL,
      gap: 16,
      align: "center",
      pad,
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    cells.forEach(([t, w, align, strong], i) => {
      // First column is a label (Inter); the rest are numbers (mono).
      const style =
        i === 0 && align === "left" ? b.ty("label", { size: 12.5 }) : b.ty("num", { align })
      b.text(tr, t, style, strong ? ink : c("ink-2"), {
        ...(w ? { w, grow: "fixed-width" } : { w: FILL, grow: "fixed-width" }),
      })
    })
    return tr
  }
  /** A small table inside a panel: eyebrow heads, hairline rows. */
  function miniTable(
    into: Slot,
    cols: [string, number | null, "left" | "right"][],
    rows: [string, number | null, "left" | "right", boolean?][][],
  ) {
    const t = b.col(into, "Table", { w: FILL })
    const head = b.row(t, "Head", { w: FILL, gap: 16, pad: [0, 0, 8, 0] })
    for (const [l, w, align] of cols)
      b.text(head, l.toUpperCase(), b.ty("eyebrow", { size: 9.5, align }), muted, {
        ...(w ? { w, grow: "fixed-width" } : { w: FILL, grow: "fixed-width" }),
      })
    for (const row of rows) simpleRow(t, row, [9, 0])
    return t
  }

  // --- Cover -----------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Dashboard template",
    title: "Tidemark subscription analytics",
    description:
      "Overview, funnels, cohort retention, revenue, customers and a report builder for a tea subscription business. Built from 20 components with light and dark tokens.",
    preview: (area) => {
      const row = b.row(area, "KPIs", { w: FILL, gap: 0, ...hair({ t: 1, b: 1 }) })
      b.use(row, stat, {
        props: { w: FILL, stroke: { paint: c("border"), width: { l: 0 } } },
        args: { label: "Monthly recurring revenue", value: "$412.9K", delta: "+2.0%", spark: "up" },
      })
      b.use(row, stat, {
        props: { w: FILL },
        args: { label: "Monthly churn", value: "3.1%", delta: "-0.4 pts", spark: "down" },
        set: { KpDelta: { args: { label: "-0.4 pts", trend: "downGood" } } },
      })
      chart(
        area,
        "Monthly recurring revenue",
        "Oct 2025 to Sep 2026, against the 12 months before",
        { w: FILL, h: FILL },
        (into) => {
          const pw = 672 - YW
          const plot = plotFrame(into, pw, 290, ["$420K", "$360K", "$300K", "$240K"])
          lineSeries(plot, MRR_PREV, pw, 290, 240, 420, "series-prev", {
            dash: [4, 4],
            width: 1.5,
            label: "$316.0K",
          })
          lineSeries(plot, MRR, pw, 290, 240, 420, "series-1", { area: true, label: "$412.9K" })
          xAxis(into, MONTHS, pw - LABEL_W, LABEL_W)
        },
      )
    },
  })

  // --- Overview ----------------------------------------------------------------------------------
  {
    const content = shell("Overview", 1, exportBtn)
    pageHead(content, "Overview", "Steepwell Tea Club. Subscription health for the last 12 months.")
    controls(content, "Oct 1, 2025 to Sep 30, 2026", "UPDATED 8 MINUTES AGO")
    statStrip(content, [
      ["Monthly recurring revenue", "$412.9K", "+2.0%", "up", "up", "vs August"],
      ["Active subscribers", "14,208", "+312", "up", "up", "vs August"],
      ["Trial to paid", "38.4%", "+1.9 pts", "up", "flat", "vs August"],
      ["Monthly churn", "3.1%", "-0.4 pts", "downGood", "down", "vs August"],
    ])
    const mid = b.row(content, "Charts", { w: FILL, h: 282, gap: s(6) })
    chart(
      mid,
      "Monthly recurring revenue",
      "Up 29.8% since October 2025, and 30.7% on September 2025",
      { w: 748, h: FILL },
      (into) => {
        const pw = 748 - YW
        const ph = 152
        const plot = plotFrame(into, pw, ph, ["$420K", "$360K", "$300K", "$240K"])
        lineSeries(plot, MRR_PREV, pw, ph, 240, 420, "series-prev", {
          dash: [4, 4],
          width: 1.5,
          label: "$316.0K",
        })
        lineSeries(plot, MRR, pw, ph, 240, 420, "series-1", { area: true, label: "$412.9K" })
        xAxis(into, MONTHS, pw - LABEL_W, LABEL_W)
      },
      [
        ["Last 12 months", "s1"],
        ["Previous 12 months", "prev"],
      ],
    )
    chart(
      mid,
      "Net new subscribers",
      "New minus canceled, per month",
      { w: FILL, h: FILL },
      (into) => {
        const pw = 388 - YW
        const ph = 152
        const plot = plotFrame(into, pw, ph, ["400", "300", "200", "100", "0"])
        const labels = MONTHS.slice(6)
        const cw = Math.floor(pw / labels.length)
        const bars = b.row(plot, "Bars", {
          position: "absolute",
          x: 0,
          y: 0,
          w: cw * labels.length,
          h: ph,
          align: "end",
          meta: overlay,
        })
        const net = [288, 287, 291, 295, 307, 312]
        for (const [i, v] of net.entries()) {
          const g = b.col(bars, labels[i] ?? "", { w: cw, gap: 4, align: "center" })
          b.text(g, String(v), b.ty("axis", { weight: 500 }), i === net.length - 1 ? ink : muted)
          b.rect(g, "Net new", {
            w: 28,
            h: Math.round((v / 400) * ph),
            fill: i === net.length - 1 ? c("series-1") : c("series-1-light"),
          })
        }
        xAxis(into, labels, cw * labels.length)
      },
    )
    const bottom = b.row(content, "Bottom", { w: FILL, h: FILL, gap: s(6) })
    chart(
      bottom,
      "Subscribers by plan",
      "14,208 active in September",
      { w: 520, h: FILL },
      (into) => {
        const list = b.col(into, "Meters", { w: FILL, gap: 13, pad: [4, 0, 0, 0] })
        for (const [label, value, n, tone] of [
          ["Daily, $29 a month", "7,220", 50.8, "s1"],
          ["Explorer, $18 a month", "4,410", 31.0, "s3"],
          ["Reserve, $49 a month", "2,578", 18.1, "s2"],
        ] as const)
          b.use(list, meter, {
            props: { w: FILL },
            args: { label, value, detail: `${n.toFixed(1)}%`, tone },
            set: pct(n),
          })
      },
    )
    chart(
      bottom,
      "Acquisition channels",
      "Trials started in September",
      { w: FILL, h: FILL },
      (into) => {
        miniTable(
          into,
          [
            ["Channel", null, "left"],
            ["Trials", 80, "right"],
            ["Trial to paid", 100, "right"],
            ["Cost per paid", 100, "right"],
          ],
          [
            [
              ["Instagram ads", null, "left", true],
              ["712", 80, "right"],
              ["34.1%", 100, "right"],
              ["$41.20", 100, "right"],
            ],
            [
              ["Referral credits", null, "left", true],
              ["559", 80, "right"],
              ["47.9%", 100, "right"],
              ["$18.60", 100, "right"],
            ],
            [
              ["Organic search", null, "left", true],
              ["458", 80, "right"],
              ["39.6%", 100, "right"],
              ["$0.00", 100, "right"],
            ],
            [
              ["Podcast sponsorships", null, "left", true],
              ["295", 80, "right"],
              ["36.2%", 100, "right"],
              ["$52.80", 100, "right"],
            ],
          ],
        )
      },
    )
  }

  // --- Funnels -----------------------------------------------------------------------------------
  {
    const content = shell("Funnels", 2, (into) => {
      b.use(into, buttonSecondary, {
        args: { label: "Compare", icon: true },
        set: { BtnIcon: { icon: "git-compare" } },
      })
      b.use(into, button, { args: { label: "New funnel", icon: true } })
    })
    pageHead(
      content,
      "Funnels",
      "Where people drop between signing up and paying. Conversion window: 30 days.",
    )
    const tb = b.row(content, "Toolbar", { w: FILL, gap: 8, align: "center" })
    const bar = b.row(tb, "Filters", { w: FILL, gap: 8, align: "center" })
    b.use(bar, select, {
      props: { w: 260 },
      args: { showLabel: false, value: "Sign-up to paid subscriber" },
      set: { SlIcon: { icon: "funnel" } },
    })
    b.use(bar, chip, { args: { field: "Plan", value: "is any" } })
    b.use(bar, chip, { args: { field: "Channel", value: "is not Wholesale" } })
    b.use(bar, chip, {
      args: { field: "Add filter", value: "", removable: false },
      set: { ChpIcon: { icon: "plus" } },
      hide: ["ChpVal"],
    })
    b.use(tb, tabs, {
      args: { first: "Steps", second: "Trends", third: "Time to convert", active: "first" },
    })
    chart(
      content,
      "Sign-up to paid subscriber",
      "13,260 people signed up between Jul 1 and Sep 30, 2026. 16.5% became paying subscribers.",
      { w: FILL },
      (into) => {
        const steps = b.row(into, "Steps", { w: FILL, gap: 0, pad: [4, 0, 0, 0] })
        const data: [string, string, number, string][] = [
          ["Signed up", "13,260", 100, "7,558 did not start a trial"],
          ["Started trial", "5,702", 43.0, "467 canceled before shipping"],
          ["First box shipped", "5,235", 39.5, "1,482 did not rate the box"],
          ["Rated first box", "3,753", 28.3, "1,565 canceled in the trial"],
          ["Paid subscriber", "2,188", 16.5, ""],
        ]
        const links = ["43.0%", "91.8%", "71.7%", "58.3%"]
        for (const [i, [name, count, n, d]] of data.entries()) {
          b.use(steps, funnelStep, {
            props: { w: 184 },
            args: {
              index: `0${i + 1}`,
              name,
              count,
              rate: n === 100 ? "100%" : `${n.toFixed(1)}%`,
              ...(d ? { drop: d } : { showDrop: false }),
            },
            set: { ...share(n), ...{} },
          })
          if (i < links.length) b.use(steps, funnelLink, { args: { rate: links[i] } })
        }
      },
      [
        ["Converted", "s1"],
        ["Dropped off", "s1light"],
      ],
    )
    const row = b.row(content, "Breakdown", { w: FILL, h: FILL, gap: s(6) })
    chart(
      row,
      "Conversion by channel",
      "Sign-up to paid, same period",
      { w: 700, h: FILL },
      (into) => {
        const t = miniTable(
          into,
          [
            ["Channel", null, "left"],
            ["Sign-ups", 80, "right"],
            ["Trial rate", 80, "right"],
            ["Paid rate", 80, "right"],
            ["", 140, "left"],
          ],
          [],
        )
        for (const [ch, su, tr, paid, n] of [
          ["Referral credits", "2,495", "55.5%", "29.0%", 29.0],
          ["Organic search", "3,217", "38.1%", "16.0%", 16.0],
          ["Instagram ads", "4,992", "39.4%", "13.0%", 13.0],
          ["Podcast sponsorships", "2,556", "41.2%", "12.4%", 12.4],
        ] as const) {
          const tr2 = simpleRow(
            t,
            [
              [ch, null, "left", true],
              [su, 80, "right"],
              [tr, 80, "right"],
              [paid, 80, "right", true],
            ],
            [9, 0],
          )
          const m = b.row(tr2, "Bar", { w: 140, h: 4, fill: c("subtle"), clip: true })
          b.rect(m, "Done", { w: fill(n), h: 4, fill: c("series-1") })
          b.rect(m, "Left", { w: fill(30 - n), h: 4, fill: c("subtle") })
        }
      },
    )
    chart(row, "Days from sign-up to paid", "Median 16 days", { w: FILL, h: FILL }, (into) => {
      const ph = 96
      const labels = ["0", "6", "12", "18", "24", "30"]
      const vals = [140, 180, 210, 260, 410, 520, 560, 470, 380, 290, 210, 150]
      const pw = 1160 - 700 - 24 - YW
      const plot = plotFrame(into, pw, ph, ["600", "300", "0"])
      const cw = Math.floor(pw / vals.length)
      const bars = b.row(plot, "Bars", {
        position: "absolute",
        x: 0,
        y: 0,
        w: cw * vals.length,
        h: ph,
        align: "end",
        meta: overlay,
      })
      for (const [i, v] of vals.entries()) {
        const cell = b.col(bars, `Days ${i * 3}`, { w: cw, align: "center" })
        b.rect(cell, "Count", {
          w: cw - 6,
          h: Math.round((v / 600) * ph),
          fill: i === 5 ? c("series-1") : c("series-1-light"),
        })
      }
      const xr = b.row(into, "X axis", { w: FILL, pad: [6, 0, 0, YW] })
      for (const l of labels)
        b.text(xr, l, b.ty("axis", { align: "left" }), muted, {
          w: cw * 2,
          grow: "fixed-width",
        })
    })
  }

  // --- Retention ---------------------------------------------------------------------------------
  {
    const content = shell("Retention", 3, exportBtn)
    pageHead(
      content,
      "Retention",
      "Share of each signup cohort still subscribed, by months since their first paid box.",
    )
    statStrip(content, [
      ["Month 1 retention", "84.3%", "+0.3 pts", "up", "up", "Aug cohort vs Jul"],
      ["Month 6 retention", "50.5%", "+0.3 pts", "up", "flat", "Mar cohort vs Feb"],
      ["Average subscriber lifetime", "21.4 months", "+1.3", "up", "up", "vs last year"],
    ])
    const cohorts = [
      ["Oct 2025", "640"],
      ["Nov 2025", "668"],
      ["Dec 2025", "1,105"],
      ["Jan 2026", "702"],
      ["Feb 2026", "655"],
      ["Mar 2026", "671"],
      ["Apr 2026", "690"],
      ["May 2026", "705"],
      ["Jun 2026", "722"],
      ["Jul 2026", "731"],
      ["Aug 2026", "748"],
      ["Sep 2026", "752"],
    ] as const
    const level = (v: number) =>
      v >= 90 ? 6 : v >= 75 ? 5 : v >= 62 ? 4 : v >= 54 ? 3 : v >= 48 ? 2 : 1
    const val = (i: number, m: number) =>
      m === 0
        ? 100
        : Math.round(48 + 52 * Math.exp(-m / 2.4) - 0.5 * m + 0.25 * i + (i === 2 ? -3 : 0))
    chart(
      content,
      "Subscriber retention by signup month",
      "Each row is the people who started paying that month",
      { w: FILL, h: FILL },
      (into) => {
        const t = b.col(into, "Cohort table", { w: FILL, gap: 2 })
        const head = b.row(t, "Head", { w: FILL, gap: 2, align: "center", pad: [0, 0, 4, 0] })
        b.text(head, "COHORT", b.ty("eyebrow", { size: 9.5 }), muted, {
          w: 92,
          grow: "fixed-width",
        })
        b.text(head, "PAID", b.ty("eyebrow", { size: 9.5, align: "right" }), muted, {
          w: 56,
          grow: "fixed-width",
        })
        b.rect(head, "Gap", { w: 8, h: 1, fill: c("surface") })
        for (let m = 0; m < 12; m++)
          b.text(head, `M${m}`, b.ty("eyebrow", { size: 9.5, align: "center" }), muted, {
            w: 80,
            grow: "fixed-width",
          })
        // Weighted average of the cohorts that have reached each month.
        const avg = b.row(t, "Average", { w: FILL, gap: 2, align: "center" })
        b.text(avg, "Average", b.ty("label", { size: 12.5, weight: 600 }), ink, {
          w: 92,
          grow: "fixed-width",
        })
        b.text(avg, "8,789", b.ty("num", { align: "right", weight: 500 }), ink, {
          w: 56,
          grow: "fixed-width",
        })
        b.rect(avg, "Gap", { w: 8, h: 1, fill: c("surface") })
        for (let m = 0; m < 12; m++) {
          const reached = cohorts.slice(0, 12 - m)
          const a = Math.round(reached.reduce((acc, _, i) => acc + val(i, m), 0) / reached.length)
          b.use(avg, cohortCell, {
            props: { w: 80, h: 30 },
            args: { value: `${a}%`, level: `l${level(a)}` },
          })
        }
        b.rect(t, "Rule", { w: FILL, h: 1, fill: c("border") })
        for (const [i, [label, size]] of cohorts.entries()) {
          const row = b.row(t, label, { w: FILL, gap: 2, align: "center" })
          b.text(row, label, b.ty("num"), ink, { w: 92, grow: "fixed-width" })
          b.text(row, size, b.ty("num", { align: "right" }), muted, { w: 56, grow: "fixed-width" })
          b.rect(row, "Gap", { w: 8, h: 1, fill: c("surface") })
          for (let m = 0; m < 12; m++) {
            const seen = m < 12 - i
            const v = val(i, m)
            b.use(row, cohortCell, {
              props: { w: 80, h: 30 },
              args: seen ? { value: `${v}%`, level: `l${level(v)}` } : { level: "future" },
            })
          }
        }
      },
      "heat",
    )
  }

  // --- Revenue -----------------------------------------------------------------------------------
  {
    const content = shell("Revenue", 4, exportBtn)
    pageHead(content, "Revenue", "Recurring revenue and what moved it, September 2026.")
    statStrip(content, [
      ["Monthly recurring revenue", "$412.9K", "+$8.2K", "up", "up", "net new in September"],
      ["New MRR", "$18.6K", "+0.0%", "flat", "flat", "vs August"],
      ["Expansion MRR", "$4.9K", "+2.1%", "up", "up", "vs August"],
      ["Churned MRR", "$12.7K", "+3.3%", "upBad", "up", "vs August"],
    ])
    const mid = b.row(content, "Charts", { w: FILL, h: 322, gap: s(6) })
    const moves: [number, number, number, number][] = [
      [18.9, 4.1, 2.3, 11.2],
      [18.3, 4.3, 2.4, 11.8],
      [18.1, 4.4, 2.2, 12.0],
      [17.9, 4.6, 2.5, 12.4],
      [18.6, 4.8, 2.6, 12.3],
      [18.6, 4.9, 2.6, 12.7],
    ]
    chart(
      mid,
      "MRR movements",
      "Apr to Sep 2026, in $K",
      { w: 748, h: FILL },
      (into) => {
        const k = 5.2
        const cw = Math.floor((748 - YW) / 6)
        const up = b.row(into, "Gains", { w: FILL, h: 140, pad: [0, 0, 0, YW], align: "end" })
        b.rect(into, "Baseline", { w: FILL, h: 1, fill: c("series-prev") })
        const down = b.row(into, "Losses", { w: FILL, h: 100, pad: [0, 0, 0, YW], align: "start" })
        for (const [i, [n, e, ct, ch]] of moves.entries()) {
          const g = b.col(up, `${MONTHS[6 + i]} gains`, { w: cw, gap: 2, align: "center" })
          b.text(g, `+${(n + e).toFixed(1)}`, b.ty("axis", { weight: 500 }), c("ink-2"))
          b.rect(g, "Expansion", { w: 36, h: Math.round(e * k), fill: c("series-1-light") })
          b.rect(g, "New", { w: 36, h: Math.round(n * k), fill: c("series-1") })
          const l = b.col(down, `${MONTHS[6 + i]} losses`, { w: cw, gap: 2, align: "center" })
          b.rect(l, "Contraction", { w: 36, h: Math.round(ct * k), fill: c("series-2-light") })
          b.rect(l, "Churn", { w: 36, h: Math.round(ch * k), fill: c("series-2") })
          b.text(l, `-${(ct + ch).toFixed(1)}`, b.ty("axis", { weight: 500 }), c("ink-2"))
        }
        const xl = b.row(into, "X axis", { w: FILL, pad: [6, 0, 0, YW] })
        for (const m of MONTHS.slice(6))
          b.text(xl, m, b.ty("axis", { align: "center" }), muted, { w: cw, grow: "fixed-width" })
      },
      [
        ["New", "s1"],
        ["Expansion", "s1light"],
        ["Contraction", "s2light"],
        ["Churn", "s2"],
      ],
    )
    chart(mid, "MRR by plan", "September 2026", { w: FILL, h: FILL }, (into) => {
      miniTable(
        into,
        [
          ["Plan", null, "left"],
          ["Subscribers", 90, "right"],
          ["MRR", 80, "right"],
        ],
        [
          [
            ["Daily, $29", null, "left", true],
            ["7,220", 90, "right"],
            ["$209.4K", 80, "right", true],
          ],
          [
            ["Reserve, $49", null, "left", true],
            ["2,578", 90, "right"],
            ["$126.3K", 80, "right", true],
          ],
          [
            ["Explorer, $18", null, "left", true],
            ["4,410", 90, "right"],
            ["$79.4K", 80, "right", true],
          ],
          [
            ["Discounts and credits", null, "left", true],
            ["", 90, "right"],
            ["-$2.2K", 80, "right", true],
          ],
          [
            ["Total", null, "left", true],
            ["14,208", 90, "right", true],
            ["$412.9K", 80, "right", true],
          ],
        ],
      )
      b.para(
        into,
        "Reserve grew 92% in 12 months and is now 30% of plan revenue. Explorer has shrunk 3.3% as subscribers upgrade to Daily.",
        b.ty("small"),
        muted,
        { name: "Note" },
      )
    })
    chart(
      content,
      "Recent plan changes",
      "Upgrades, downgrades and cancellations this week",
      { w: FILL, h: FILL },
      (into) => {
        miniTable(
          into,
          [
            ["Customer", 200, "left"],
            ["Change", null, "left"],
            ["MRR", 100, "right"],
            ["When", 140, "right"],
          ],
          (
            [
              ["Maya Lindqvist", "Daily to Reserve", "+$20.00", "Today, 9:42"],
              ["Owen Achebe", "Explorer to Daily", "+$11.00", "Yesterday, 18:10"],
              ["Hana Sato", "Reserve to Daily", "-$20.00", "Oct 4, 14:05"],
              ["Diego Ferreira", "Explorer, canceled", "-$18.00", "Oct 3, 21:37"],
            ] as const
          ).map(([who, change, amt, when]) => [
            [who, 200, "left", true],
            [change, null, "left"],
            [amt, 100, "right", true],
            [when, 140, "right"],
          ]),
        )
      },
    )
  }

  // --- Customers ---------------------------------------------------------------------------------
  {
    const content = shell("Customers", 5, exportBtn)
    pageHead(content, "Customers", "Everyone who has signed up for a box, newest activity first.")
    const tb = b.row(content, "Toolbar", { w: FILL, gap: 8, align: "center" })
    const bar = b.row(tb, "Filters", { w: FILL, gap: 8, align: "center" })
    const search = b.row(bar, "Search", {
      w: 300,
      gap: 8,
      align: "center",
      pad: [7, 10],
      radius: r("md"),
      stroke: { paint: c("border") },
    })
    b.icon(search, "search", 14, muted)
    b.text(search, "Search name or email", b.ty("body", { size: 12.5 }), muted)
    b.use(bar, chip, { args: { field: "Plan", value: "is any" } })
    b.use(bar, chip, { args: { field: "Status", value: "is not Canceled" } })
    b.use(bar, chip, {
      args: { field: "Add filter", value: "", removable: false },
      set: { ChpIcon: { icon: "plus" } },
      hide: ["ChpVal"],
    })
    b.text(tb, "14,986 CUSTOMERS", b.ty("eyebrow"), muted)
    const table = b.col(content, "Table", { w: FILL, h: FILL, ...hair({ t: 1 }, ink), clip: true })
    tableHead(table, tableCols)
    const rows: [string, string, string, string, string, string, string, string, string][] = [
      [
        "Maya Lindqvist",
        "maya.lindqvist@gmail.com",
        "Reserve",
        "Active",
        "$49",
        "14",
        "$612",
        "Aug 3, 2025",
        "Sep 28",
      ],
      [
        "Owen Achebe",
        "owen.achebe@outlook.com",
        "Daily",
        "Active",
        "$29",
        "9",
        "$261",
        "Jan 12, 2026",
        "Sep 30",
      ],
      [
        "Hana Sato",
        "hana@satofamily.jp",
        "Daily",
        "Active",
        "$29",
        "22",
        "$786",
        "Nov 19, 2024",
        "Sep 26",
      ],
      [
        "Diego Ferreira",
        "dferreira@proton.me",
        "Explorer",
        "Trial",
        "$0",
        "1",
        "$0",
        "Sep 21, 2026",
        "Sep 22",
      ],
      [
        "Grace Whitman",
        "grace.whitman@icloud.com",
        "Reserve",
        "Past due",
        "$49",
        "6",
        "$294",
        "Mar 30, 2026",
        "Aug 29",
      ],
      [
        "Tomasz Nowak",
        "t.nowak@gmail.com",
        "Daily",
        "Active",
        "$29",
        "17",
        "$493",
        "Apr 2, 2025",
        "Sep 29",
      ],
      [
        "Amara Okoye",
        "amara.okoye@yahoo.com",
        "Explorer",
        "Paused",
        "$0",
        "5",
        "$90",
        "Feb 14, 2026",
        "Jul 3",
      ],
      [
        "Lucas Moreau",
        "lucas@moreau.fr",
        "Reserve",
        "Active",
        "$49",
        "11",
        "$539",
        "Oct 28, 2025",
        "Sep 27",
      ],
      [
        "Priya Raman",
        "priya.raman@gmail.com",
        "Daily",
        "Canceled",
        "$0",
        "8",
        "$232",
        "Dec 5, 2025",
        "Aug 4",
      ],
      [
        "Ben Halloran",
        "ben.halloran@fastmail.com",
        "Daily",
        "Active",
        "$29",
        "3",
        "$87",
        "Jul 9, 2026",
        "Sep 30",
      ],
    ]
    const statusTone: Record<string, string> = {
      Active: "success",
      Trial: "accent",
      "Past due": "warning",
      Paused: "neutral",
      Canceled: "danger",
    }
    const planTone: Record<string, string> = { Daily: "s1", Reserve: "s2", Explorer: "s3" }
    for (const [name, email, plan, status, mrr, boxes, ltv, joined, last] of rows) {
      b.use(table, customerRow, {
        props: { w: FILL },
        args: { name, email, plan, status, mrr, boxes, ltv, joined, last },
        set: {
          CrStatus: { args: { label: status, tone: statusTone[status] } },
          CrPlan: { args: { label: plan, tone: planTone[plan] } },
        },
      })
    }
    const foot = b.row(table, "Footer", {
      w: FILL,
      justify: "between",
      align: "center",
      pad: [10, 20],
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    b.text(foot, "SHOWING 1 TO 10 OF 14,986", b.ty("eyebrow"), muted)
    const pager = b.row(foot, "Pager", { gap: 8 })
    b.use(pager, buttonSecondary, { args: { label: "Previous", size: "sm" } })
    b.use(pager, buttonSecondary, { args: { label: "Next", size: "sm" } })
  }

  // --- Report builder ------------------------------------------------------------------------------
  {
    const content = shell("Report builder", 6, (into) => {
      b.use(into, buttonSecondary, {
        args: { label: "Share", icon: true },
        set: { BtnIcon: { icon: "share-2" } },
      })
      b.use(into, button, {
        args: { label: "Save report", icon: true },
        set: { BtnIcon: { icon: "save" } },
      })
    })
    pageHead(
      content,
      "Report builder",
      "Pick a metric, break it down and save the result for the team.",
    )
    const row = b.row(content, "Builder", { w: FILL, h: FILL, gap: s(8) })
    const cfg = b.col(row, "Settings", {
      w: 280,
      h: FILL,
      gap: 18,
      pad: [14, 0, 0, 0],
      ...hair({ t: 1 }, ink),
    })
    b.use(cfg, select, {
      props: { w: FILL },
      args: { label: "Report name", value: "MRR by plan" },
      set: { SlIcon: { icon: "file-text" } },
    })
    b.use(cfg, select, {
      props: { w: FILL },
      args: { label: "Metric", value: "Monthly recurring revenue" },
      set: { SlIcon: { icon: "dollar-sign" } },
    })
    const br = b.col(cfg, "Breakdown", { w: FILL, gap: 4 })
    b.text(br, "BREAK DOWN BY", b.ty("eyebrow"), muted)
    for (const [label, kind, on] of [
      ["Plan", "Property", true],
      ["Acquisition channel", "Property", false],
      ["Billing interval", "Property", false],
    ] as const)
      b.use(br, fieldRow, {
        props: { w: FILL },
        args: { label, kind, checked: on ? "yes" : "no" },
      })
    const fl = b.col(cfg, "Filters", { w: FILL, gap: 8 })
    b.text(fl, "FILTERS", b.ty("eyebrow"), muted)
    b.use(fl, chip, { args: { field: "Country", value: "is United States" } })
    b.use(fl, chip, {
      args: { field: "Add filter", value: "", removable: false },
      set: { ChpIcon: { icon: "plus" } },
      hide: ["ChpVal"],
    })
    const vz = b.col(cfg, "Chart type", { w: FILL, gap: 8 })
    b.text(vz, "CHART TYPE", b.ty("eyebrow"), muted)
    b.use(vz, tabs, {
      args: { first: "Line", second: "Bar", third: "Table", active: "first" },
    })
    b.use(cfg, select, {
      props: { w: FILL },
      args: { label: "Interval", value: "Monthly" },
      set: { SlIcon: { icon: "calendar" } },
    })

    const right = b.col(row, "Preview", { w: FILL, h: FILL, gap: s(6) })
    const pw = CW - 280 - 32 - YW
    chart(
      right,
      "MRR by plan",
      "Monthly, Oct 2025 to Sep 2026, United States",
      { w: FILL },
      (into) => {
        const plot = plotFrame(into, pw, 300, ["$240K", "$180K", "$120K", "$60K", "$0"])
        lineSeries(plot, DAILY, pw, 300, 0, 240, "series-1", { label: "$209.4K" })
        lineSeries(plot, RESERVE, pw, 300, 0, 240, "series-2", { label: "$126.3K" })
        lineSeries(plot, EXPLORER, pw, 300, 0, 240, "series-3", { label: "$79.4K" })
        xAxis(into, MONTHS, pw - LABEL_W, LABEL_W)
      },
      [
        ["Daily", "s1"],
        ["Reserve", "s2"],
        ["Explorer", "s3"],
      ],
    )
    const data = b.col(right, "Data", { w: FILL, h: FILL, ...hair({ t: 1 }, ink), clip: true })
    const cols: [string, number | null, "left" | "right"][] = [
      ["Plan", null, "left"],
      ["Jun", 90, "right"],
      ["Jul", 90, "right"],
      ["Aug", 90, "right"],
      ["Sep", 90, "right"],
      ["12-month change", 130, "right"],
    ]
    tableHead(data, cols)
    const k = (v: number) => `$${v.toFixed(1)}K`
    for (const [plan, vals] of [
      ["Daily", DAILY],
      ["Reserve", RESERVE],
      ["Explorer", EXPLORER],
    ] as const) {
      const first = vals[0] ?? 1
      const lastV = vals[11] ?? 0
      const ch = ((lastV - first) / first) * 100
      simpleRow(data, [
        [plan, null, "left", true],
        [k(vals[8] ?? 0), 90, "right"],
        [k(vals[9] ?? 0), 90, "right"],
        [k(vals[10] ?? 0), 90, "right"],
        [k(lastV), 90, "right", true],
        [`${ch >= 0 ? "+" : ""}${ch.toFixed(1)}%`, 130, "right"],
      ])
    }
    const tot = (i: number) => (DAILY[i] ?? 0) + (RESERVE[i] ?? 0) + (EXPLORER[i] ?? 0)
    simpleRow(data, [
      ["All plans, before discounts", null, "left", true],
      [k(tot(8)), 90, "right", true],
      [k(tot(9)), 90, "right", true],
      [k(tot(10)), 90, "right", true],
      [k(tot(11)), 90, "right", true],
      [`+${(((tot(11) - tot(0)) / tot(0)) * 100).toFixed(1)}%`, 130, "right", true],
    ])
  }
}
