/**
 * Tidemark: the web app of a fictional product analytics tool, set up for Steepwell Tea Club, a
 * tea subscription business. Screens (1440×900 app frames): Overview, Funnels, Retention, Revenue,
 * Customers, Report builder.
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
const EXPLORER = [82.1, 82.4, 83.0, 82.6, 81.9, 81.5, 81.2, 80.8, 80.4, 80.1, 79.7, 79.4]
const DAILY = [172.4, 176.0, 182.5, 186.1, 189.0, 191.6, 195.3, 199.0, 202.4, 205.0, 207.4, 209.4]
/** Plan MRR before $2.2K of discounts; Reserve is the remainder. */
const RESERVE = MRR.map((m, i) => +(m + 2.2 - (EXPLORER[i] ?? 0) - (DAILY[i] ?? 0)).toFixed(1))

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F6F7F9", "#0D0F13"],
      surface: ["#FFFFFF", "#15181E"],
      subtle: ["#F0F2F5", "#1C2028"],
      sidebar: ["#FBFBFC", "#111318"],
      ink: ["#0F172A", "#EEF1F6"],
      "ink-2": ["#334155", "#C6CDD8"],
      muted: ["#64748B", "#8B95A7"],
      border: ["#E4E7EC", "#262B35"],
      grid: ["#EDEFF2", "#20242D"],
      accent: ["#5B47D6", "#A194FF"],
      "accent-soft": ["#EFEDFD", "#251F4A"],
      "on-accent": ["#FFFFFF", "#0D0F13"],
      success: ["#127A4B", "#4ACB8B"],
      "success-soft": ["#E3F5EC", "#12301F"],
      warning: ["#A35C00", "#F2B54B"],
      "warning-soft": ["#FDF1DC", "#33240C"],
      danger: ["#C0362C", "#F2766B"],
      "danger-soft": ["#FCE9E7", "#3A1714"],
      "series-1": ["#2A78D6", "#3987E5"],
      "series-2": ["#EB6834", "#D95926"],
      "series-3": ["#1BAF7A", "#199E70"],
      "series-1-soft": ["#2A78D624", "#3987E52E"],
      "series-1-clear": ["#2A78D600", "#3987E500"],
      "series-1-light": ["#86B6EF", "#256ABF"],
      "series-2-light": ["#F5B194", "#8C3A18"],
      "heat-1": ["#EEF4FC", "#172131"],
      "heat-2": ["#CDE2FB", "#15294A"],
      "heat-3": ["#9EC5F4", "#173C70"],
      "heat-4": ["#6DA7EC", "#1C5CAB"],
      "heat-5": ["#2A78D6", "#2A78D6"],
      "heat-6": ["#1C5CAB", "#3987E5"],
      "heat-ink": ["#0F172A", "#EEF1F6"],
      "heat-ink-strong": ["#FFFFFF", "#FFFFFF"],
      "tone-1": ["#DCD6FF", "#3A3170"],
      "tone-2": ["#CFEFE0", "#1D4A35"],
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
      "space/7": 28,
      "radius/sm": 4,
      "radius/md": 8,
      "radius/lg": 12,
      "radius/pill": 999,
      "size/sidebar": 240,
      "size/topbar": 64,
    },
    type: {
      display: { font: "Inter", size: 56, weight: 700, lineHeight: 1.05, letterSpacing: -1.6 },
      h1: { font: "Inter", size: 20, weight: 700, lineHeight: 1.25, letterSpacing: -0.3 },
      heading: { font: "Inter", size: 16, weight: 600, lineHeight: 1.3, letterSpacing: -0.1 },
      metric: {
        font: "Inter",
        size: 28,
        weight: 700,
        lineHeight: 1.15,
        letterSpacing: -0.6,
        features: { tnum: true },
      },
      body: { font: "Inter", size: 14, weight: 400, lineHeight: 1.5 },
      label: { font: "Inter", size: 13, weight: 600, lineHeight: 1.3 },
      small: { font: "Inter", size: 12, weight: 400, lineHeight: 1.4 },
      num: { font: "Inter", size: 13, weight: 500, lineHeight: 1.3, features: { tnum: true } },
      axis: { font: "Inter", size: 11, weight: 400, lineHeight: 1.3, features: { tnum: true } },
    },
    shadows: {
      card: [
        { kind: "shadow", x: 0, y: 1, blur: 2, color: "#0F172A0D" },
        { kind: "shadow", x: 0, y: 4, blur: 12, spread: -4, color: "#0F172A12" },
      ],
    },
  })

  const c = (n: string) => b.c(n)
  const s = (n: number) => b.n(`space/${n}`)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  const card = (extra: Record<string, unknown> = {}) => ({
    radius: r("lg"),
    fill: c("surface"),
    stroke: { paint: c("border") },
    ...extra,
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
          md: { "root.layout/pad": [8, 14], "BtnLabel.style/size": 13 },
          sm: { "root.layout/pad": [5, 10], "BtnLabel.style/size": 12 },
        }),
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
      b.icon(root, "plus", 15, c("on-accent"), { key: "BtnIcon", visible: false })
      b.text(root, "Button", b.ty("label"), c("on-accent"), { key: "BtnLabel", name: "Label" })
    },
  )
  const buttonSecondary = b.derive(button, "Button/Secondary", "BtnSec", {
    section: "Actions",
    args: { variant: "secondary" },
  })

  const badge = b.component(
    "Badge",
    {
      key: "Badge",
      section: "Status",
      props: {
        label: p.text("BadgeLbl", "Badge"),
        tone: p.variants({
          neutral: { "root.fill": c("subtle"), "BadgeLbl.fill": c("ink-2") },
          accent: { "root.fill": c("accent-soft"), "BadgeLbl.fill": c("accent") },
          success: { "root.fill": c("success-soft"), "BadgeLbl.fill": c("success") },
          warning: { "root.fill": c("warning-soft"), "BadgeLbl.fill": c("warning") },
          danger: { "root.fill": c("danger-soft"), "BadgeLbl.fill": c("danger") },
        }),
      },
      root: { dir: "row", pad: [3, 8], radius: r("pill"), fill: c("subtle") },
    },
    (root) =>
      b.text(root, "Badge", b.ty("small", { weight: 600 }), c("ink-2"), {
        key: "BadgeLbl",
        name: "Label",
      }),
  )

  const deltaTone = (bg: string, fg: string, icon: string) => ({
    "root.fill": c(bg),
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
          up: deltaTone("success-soft", "success", "arrow-up-right"),
          down: deltaTone("danger-soft", "danger", "arrow-down-right"),
          downGood: deltaTone("success-soft", "success", "arrow-down-right"),
          upBad: deltaTone("danger-soft", "danger", "arrow-up-right"),
          flat: deltaTone("subtle", "muted", "arrow-right"),
        }),
      },
      root: {
        dir: "row",
        gap: 2,
        align: "center",
        pad: [2, 6, 2, 4],
        radius: r("sm"),
        fill: c("success-soft"),
      },
    },
    (root) => {
      b.icon(root, "arrow-up-right", 13, c("success"), { key: "DlIcon" })
      b.text(root, "+0%", b.ty("small", { weight: 600 }), c("success"), { key: "DlLbl" })
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
          sm: { "root.w": 28, "root.h": 28, "AvInit.style/size": 11 },
          md: { "root.w": 32, "root.h": 32, "AvInit.style/size": 12 },
        }),
        tone: p.variants({
          violet: { "root.fill": c("tone-1") },
          green: { "root.fill": c("tone-2") },
          amber: { "root.fill": c("tone-3") },
          rose: { "root.fill": c("tone-4") },
        }),
      },
      root: {
        dir: "row",
        w: 32,
        h: 32,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("tone-1"),
      },
    },
    (root) =>
      b.text(root, "SW", b.ty("label", { size: 12 }), ink, { key: "AvInit", name: "Initials" }),
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
        }),
      },
      root: { dir: "row", gap: 6, align: "center" },
    },
    (root) => {
      b.rect(root, "Key", { key: "LgKey", w: 10, h: 10, radius: 3, fill: c("series-1") })
      b.text(root, "Series", b.ty("small"), c("ink-2"), { key: "LgLbl" })
    },
  )

  const sparks = {
    up: "M0 24 L12 21 L24 22 L36 15 L48 16 L60 9 L72 4",
    down: "M0 5 L12 8 L24 7 L36 13 L48 14 L60 19 L72 23",
    flat: "M0 15 L12 12 L24 16 L36 13 L48 15 L60 12 L72 14",
  }
  const kpi = b.component(
    "KPI card",
    {
      key: "Kpi",
      section: "Charts",
      description: "Headline number with change and a 12-month sparkline.",
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
      root: { dir: "column", w: 274, gap: 10, pad: 18, ...card(), effects: b.shadow("card") },
    },
    (root) => {
      const top = b.row(root, "Header", { w: FILL, gap: 6, align: "center" })
      b.text(top, "Metric", b.ty("body", { size: 13, weight: 500 }), muted, { key: "KpLbl" })
      b.icon(top, "info", 13, muted)
      const mid = b.row(root, "Value row", { w: FILL, justify: "between", align: "end" })
      b.text(mid, "0", b.ty("metric"), ink, { key: "KpVal", name: "Value" })
      b.add(mid, {
        type: "path",
        key: "KpSpark",
        name: "Sparkline",
        w: 72,
        h: 28,
        viewBox: [0, 0, 72, 28],
        d: sparks.up,
        stroke: { paint: c("series-1"), width: 2, join: "round", cap: "round" },
      })
      const foot = b.row(root, "Footer", { gap: 8, align: "center" })
      b.use(foot, delta, { key: "KpDelta" })
      b.text(foot, "vs last month", b.ty("small"), muted, { key: "KpCap" })
    },
  )

  const chartCard = b.component(
    "Chart card",
    {
      key: "Chart",
      section: "Charts",
      description: "Legend slot for Legend items; Body slot for the plot or table.",
      props: {
        title: p.text("ChTitle", "Chart title"),
        subtitle: p.text("ChSub", "What it measures"),
        legend: p.slot("ChLegend"),
        body: p.slot("ChBody"),
      },
      root: { dir: "column", w: 560, ...card(), clip: true },
    },
    (root) => {
      const head = b.row(root, "Header", { w: FILL, gap: 16, align: "center", pad: [16, 20] })
      const t = b.col(head, "Titles", { w: FILL, gap: 2 })
      b.text(t, "Chart title", b.ty("heading", { size: 15 }), ink, { key: "ChTitle" })
      b.text(t, "What it measures", b.ty("small"), muted, { key: "ChSub" })
      b.row(head, "Legend", {
        key: "ChLegend",
        gap: 14,
        align: "center",
        slot: { suggested: [legend] },
      })
      b.icon(head, "ellipsis", 18, muted)
      b.col(root, "Body", { key: "ChBody", w: FILL, h: FILL, pad: [0, 20, 18, 20], slot: {} })
    },
  )

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
      section: "Controls",
      props: {
        first: p.text("SgL1", "One"),
        second: p.text("SgL2", "Two"),
        third: p.text("SgL3", "Three"),
        active: p.variants({ first: segActive(0), second: segActive(1), third: segActive(2) }),
      },
      root: { dir: "row", gap: 2, pad: 3, radius: r("md"), fill: c("subtle") },
    },
    (root) => {
      for (const [i, l] of segLabels.entries()) {
        const it = b.row(root, l, {
          key: `SgI${i + 1}`,
          pad: [5, 12],
          radius: 6,
          fill: i === 0 ? c("surface") : c("subtle"),
          ...(i === 0 ? { effects: b.shadow("card") } : {}),
        })
        b.text(it, l, b.ty("label", { size: 12 }), i === 0 ? ink : muted, { key: `SgL${i + 1}` })
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
        pad: [6, 10],
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      },
    },
    (root) => {
      b.icon(root, "list-filter", 13, muted, { key: "ChpIcon" })
      b.text(root, "Field", b.ty("small"), muted, { key: "ChpField" })
      b.text(root, "is any", b.ty("small", { weight: 600 }), ink, { key: "ChpVal" })
      b.icon(root, "x", 13, muted, { key: "ChpX" })
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
      root: { dir: "column", w: 280, gap: 6 },
    },
    (root) => {
      b.text(root, "Label", b.ty("label", { size: 12 }), c("ink-2"), { key: "SlLbl" })
      const f = b.row(root, "Field", {
        w: FILL,
        gap: 8,
        align: "center",
        pad: [8, 10],
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      })
      b.icon(f, "chart-line", 15, muted, { key: "SlIcon" })
      b.text(f, "Value", b.ty("body", { size: 13 }), ink, {
        key: "SlVal",
        w: FILL,
        grow: "fixed-width",
      })
      b.icon(f, "chevron-down", 15, muted)
    },
  )

  const fieldRow = b.component(
    "Field option",
    {
      key: "Field",
      section: "Controls",
      props: {
        label: p.text("FoLbl", "Field"),
        kind: p.text("FoKind", "Metric"),
        checked: p.variants({
          yes: {
            "FoBox.fill": c("accent"),
            "FoBox.stroke": { paint: c("accent"), width: 1.5 },
            "FoTick.visible": true,
            "root.fill": c("accent-soft"),
          },
          no: {
            "FoBox.fill": c("surface"),
            "FoBox.stroke": { paint: c("border"), width: 1.5 },
            "FoTick.visible": false,
            "root.fill": c("surface"),
          },
        }),
      },
      root: {
        dir: "row",
        w: 280,
        gap: 10,
        align: "center",
        pad: [7, 10],
        radius: r("md"),
        fill: c("accent-soft"),
      },
    },
    (root) => {
      const box = b.row(root, "Box", {
        key: "FoBox",
        w: 16,
        h: 16,
        radius: r("sm"),
        align: "center",
        justify: "center",
        fill: c("accent"),
        stroke: { paint: c("accent"), width: 1.5 },
      })
      b.icon(box, "check", 12, c("on-accent"), { key: "FoTick" })
      b.text(root, "Field", b.ty("body", { size: 13 }), ink, {
        key: "FoLbl",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(root, "Metric", b.ty("small"), muted, { key: "FoKind" })
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
          default: { "root.fill": c("sidebar"), "NavLbl.fill": c("ink-2"), "NavIcon.color": muted },
          active: {
            "root.fill": c("accent-soft"),
            "NavLbl.fill": c("accent"),
            "NavIcon.color": c("accent"),
          },
        }),
      },
      root: {
        dir: "row",
        w: 208,
        gap: 10,
        align: "center",
        pad: [7, 10],
        radius: r("md"),
        fill: c("sidebar"),
      },
    },
    (root) => {
      b.icon(root, "layout-dashboard", 17, muted, { key: "NavIcon" })
      b.text(root, "Item", b.ty("label", { size: 14, weight: 500 }), c("ink-2"), {
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
        pad: [20, 16],
        fill: c("sidebar"),
        stroke: { paint: c("border"), width: { r: 1 } },
      },
    },
    (root) => {
      const top = b.col(root, "Top", { w: FILL, gap: s(5) })
      const brand = b.row(top, "Brand", { gap: 10, align: "center", pad: [0, 6] })
      const mark = b.row(brand, "Mark", {
        w: 26,
        h: 26,
        radius: 7,
        fill: c("accent"),
        align: "center",
        justify: "center",
      })
      b.icon(mark, "chart-line", 15, c("on-accent"))
      b.text(brand, "Tidemark", b.ty("heading", { size: 17, weight: 700 }), ink)
      const ws = b.row(top, "Workspace", {
        w: FILL,
        gap: 10,
        align: "center",
        pad: [8, 10],
        ...card({ radius: r("md") }),
      })
      const logo = b.row(ws, "Logo", {
        w: 24,
        h: 24,
        radius: 6,
        fill: c("tone-2"),
        align: "center",
        justify: "center",
      })
      b.icon(logo, "leaf", 13, ink)
      const wt = b.col(ws, "Names", { w: FILL, gap: 0 })
      b.text(wt, "Steepwell Tea Club", b.ty("label"), ink)
      b.text(wt, "Production", b.ty("small", { size: 11 }), muted)
      b.icon(ws, "chevrons-up-down", 14, muted)
      const nav = b.col(top, "Navigation", { w: FILL, gap: 2 })
      for (const [i, [label, icon]] of navs.entries())
        b.use(nav, navItem, {
          key: `SbNav${i + 1}`,
          props: { w: FILL },
          args: { label },
          set: { NavIcon: { icon } },
        })
      const saved = b.col(top, "Saved reports", { w: FILL, gap: 2 })
      b.text(saved, "Saved reports", b.ty("small", { weight: 600 }), muted, {
        name: "Section",
      })
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
        pad: [12, 6, 0, 6],
        stroke: { paint: c("border"), width: { t: 1 } },
      })
      b.use(me, avatar, { args: { initials: "RN", size: "sm", tone: "amber" } })
      const who = b.col(me, "Names", { w: FILL, gap: 0 })
      b.text(who, "Rosa Nguyen", b.ty("label"), ink)
      b.text(who, "Head of growth", b.ty("small"), muted)
    },
  )

  const topBar = b.component(
    "Top bar",
    {
      key: "TopBar",
      section: "Navigation",
      props: {
        title: p.text("TbTitle", "Page"),
        range: p.text("TbRange", "Oct 1, 2025 to Sep 30, 2026"),
        actions: p.slot("TbActs"),
      },
      root: {
        dir: "row",
        w: 1200,
        h: b.n("size/topbar"),
        gap: 12,
        align: "center",
        pad: [0, 28],
        fill: c("surface"),
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.text(root, "Page", b.ty("h1"), ink, {
        key: "TbTitle",
        name: "Title",
        w: FILL,
        grow: "fixed-width",
      })
      const range = b.row(root, "Date range", {
        gap: 8,
        align: "center",
        pad: [7, 12],
        radius: r("md"),
        stroke: { paint: c("border") },
      })
      b.icon(range, "calendar", 15, muted)
      b.text(range, "Oct 1, 2025 to Sep 30, 2026", b.ty("body", { size: 13 }), ink, {
        key: "TbRange",
      })
      b.icon(range, "chevron-down", 14, muted)
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
      description: "Set the Kept and Lost weights to the share of the first step.",
      props: {
        name: p.text("FsName", "Step"),
        count: p.text("FsCount", "0"),
        rate: p.text("FsRate", "100%"),
        drop: p.text("FsDrop", "0 dropped"),
        showDrop: p.bool("FsDrop", true),
      },
      root: { dir: "column", w: 200, gap: 10 },
    },
    (root) => {
      const head = b.col(root, "Header", { w: FILL, gap: 2 })
      const nr = b.row(head, "Name row", { w: FILL, gap: 8, align: "center" })
      b.text(nr, "Step", b.ty("label"), ink, { key: "FsName", w: FILL, grow: "fixed-width" })
      b.text(nr, "100%", b.ty("label"), c("series-1"), { key: "FsRate" })
      b.text(head, "0", b.ty("metric", { size: 22 }), ink, { key: "FsCount" })
      const bar = b.col(root, "Bar", {
        w: FILL,
        h: 260,
        gap: 0,
        radius: r("md"),
        fill: c("subtle"),
        clip: true,
      })
      b.rect(bar, "Lost", { key: "FsLost", w: FILL, h: fill(1), fill: c("series-1-soft") })
      b.rect(bar, "Kept", { key: "FsKept", w: FILL, h: fill(99), fill: c("series-1") })
      b.text(root, "0 dropped", b.ty("small"), muted, { key: "FsDrop" })
    },
  )
  const share = (n: number) => ({
    FsLost: { visible: n < 100, h: fill(Math.max(100 - n, 0.1)) },
    FsKept: { h: fill(n) },
  })

  const heatOpts = Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((lv) => [
      `l${lv}`,
      {
        "root.fill": c(`heat-${lv}`),
        "CcVal.fill": lv >= 5 ? c("heat-ink-strong") : c("heat-ink"),
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
          future: { "root.fill": c("bg"), "CcVal.visible": false },
        }),
      },
      root: {
        dir: "row",
        w: 68,
        h: 30,
        align: "center",
        justify: "center",
        radius: r("sm"),
        fill: c("heat-6"),
      },
    },
    (root) =>
      b.text(root, "100%", b.ty("num", { size: 12 }), c("heat-ink-strong"), { key: "CcVal" }),
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
        initials: p.text("CrAv/AvInit", "SW"),
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
        w: 1100,
        gap: 16,
        align: "center",
        pad: [10, 20],
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      const who = b.row(root, "Customer", { w: FILL, gap: 10, align: "center" })
      b.use(who, avatar, { key: "CrAv", args: { size: "sm" } })
      const names = b.col(who, "Names", { w: FILL, gap: 0 })
      b.text(names, "Name", b.ty("label"), ink, { key: "CrName" })
      b.text(names, "name@example.com", b.ty("small"), muted, { key: "CrEmail" })
      const plan = b.row(root, "Plan", { w: 100 })
      b.use(plan, badge, { key: "CrPlan", args: { label: "Daily", tone: "neutral" } })
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
      root: { dir: "column", w: 320, gap: 8 },
    },
    (root) => {
      const line = b.row(root, "Line", { w: FILL, gap: 8, align: "center" })
      b.text(line, "Label", b.ty("body", { size: 13 }), c("ink-2"), {
        key: "MtLbl",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(line, "0", b.ty("num"), ink, { key: "MtVal" })
      b.text(line, "0%", b.ty("num", { align: "right" }), muted, {
        key: "MtDet",
        w: 48,
        grow: "fixed-width",
      })
      const bar = b.row(root, "Bar", {
        w: FILL,
        h: 8,
        radius: r("pill"),
        fill: c("subtle"),
        clip: true,
      })
      b.rect(bar, "Done", { key: "MtDone", w: fill(50), h: 8, fill: c("series-1") })
      b.rect(bar, "Left", { key: "MtLeft", w: fill(50), h: 8, fill: c("subtle") })
    },
  )
  const pct = (n: number) => ({
    MtDone: { w: fill(n) },
    MtLeft: { w: fill(Math.max(100 - n, 0.1)) },
  })

  // --- Data and chart helpers ----------------------------------------------------------------

  type Slot = { inst: string; at: string }
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
        fill: i === ticks.length - 1 ? c("border") : c("grid"),
      })
    })
    return plot
  }
  function xAxis(parent: string | Slot, labels: string[], centered = false) {
    const row = b.row(parent, "X axis", {
      w: FILL,
      justify: centered ? "around" : "between",
      pad: [6, 0, 0, 48],
    })
    for (const l of labels) b.text(row, l, b.ty("axis"), muted)
  }
  const pts = (vals: number[], pw: number, ph: number, min: number, max: number) =>
    vals.map((v, i) => [
      +((i * pw) / (vals.length - 1)).toFixed(1),
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
    area = false,
  ) {
    const pp = pts(vals, pw, ph, min, max)
    if (area)
      b.add(plot, {
        type: "path",
        name: "Area",
        position: "absolute",
        x: 0,
        y: 0,
        w: pw,
        h: ph,
        viewBox: [0, 0, pw, ph],
        d: `${linePath(pp)} L${pw} ${ph} L0 ${ph} Z`,
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
      w: pw,
      h: ph,
      viewBox: [0, 0, pw, ph],
      d: linePath(pp),
      stroke: { paint: c(color), width: 2, join: "round", cap: "round" },
      meta: overlay,
    })
    const last = pp[pp.length - 1] as number[]
    b.ellipse(plot, "Marker", {
      position: "absolute",
      x: (last[0] as number) - 5,
      y: (last[1] as number) - 5,
      w: 10,
      h: 10,
      fill: c(color),
      stroke: { paint: c("surface"), width: 2 },
      meta: overlay,
    })
  }

  // --- App shell -------------------------------------------------------------------------------

  const screens = b.page("Screens")
  function shell(name: string, active: number, actions?: (into: Slot) => void) {
    const scr = b.screen(screens, name, { dir: "row", w: 1440, h: 900, fill: c("bg") })
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
    return b.col(main, "Content", { w: FILL, h: FILL, gap: s(5), pad: 28 })
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
    const steps = b.row(scale, "Steps", { gap: 2 })
    for (let lv = 1; lv <= 6; lv++)
      b.rect(steps, `Level ${lv}`, { w: 16, h: 10, radius: 2, fill: c(`heat-${lv}`) })
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
    return b.use(parent, chartCard, {
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
  function kpiRow(parent: string, items: [string, string, string, string, string, string][]) {
    const row = b.row(parent, "KPIs", { w: FILL, gap: s(4) })
    const w = Math.floor((1144 - 16 * (items.length - 1)) / items.length)
    for (const [label, value, d, trend, spark, caption] of items)
      b.use(row, kpi, {
        props: { w },
        args: { label, value, delta: d, caption, spark },
        set: { KpDelta: { args: { label: d, trend } } },
      })
  }
  const tableHead = (parent: string | Slot, cols: [string, number | null, "left" | "right"][]) => {
    const th = b.row(parent, "Head", {
      w: FILL,
      gap: 16,
      pad: [9, 20],
      fill: c("subtle"),
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    for (const [t, w, align] of cols)
      b.text(th, t, b.ty("small", { weight: 600, align }), muted, {
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
    for (const [t, w, align, strong] of cells)
      b.text(
        tr,
        t,
        b.ty("num", { align, ...(strong ? { weight: 600 } : {}) }),
        strong ? ink : c("ink-2"),
        {
          ...(w ? { w, grow: "fixed-width" } : { w: FILL, grow: "fixed-width" }),
        },
      )
    return tr
  }

  // --- Cover -----------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Dashboard template",
    title: "Tidemark subscription analytics",
    description:
      "Overview, funnels, cohort retention, revenue, customers and a report builder for a tea subscription business. Built from 19 components with light and dark tokens.",
    preview: (area) => {
      const row = b.row(area, "KPIs", { w: FILL, gap: 16 })
      b.use(row, kpi, {
        props: { w: FILL },
        args: { label: "MRR", value: "$412.9K", delta: "+2.0%", spark: "up" },
      })
      b.use(row, kpi, {
        props: { w: FILL },
        args: { label: "Monthly churn", value: "3.1%", delta: "-0.4 pts", spark: "down" },
        set: { KpDelta: { args: { label: "-0.4 pts", trend: "downGood" } } },
      })
      chart(
        area,
        "Monthly recurring revenue",
        "Oct 2025 to Sep 2026",
        { w: FILL, h: FILL },
        (into) => {
          const pw = 672 - 40 - 48
          const plot = plotFrame(into, pw, 290, ["$420K", "$390K", "$360K", "$330K", "$300K"])
          lineSeries(plot, MRR, pw, 290, 300, 420, "series-1", true)
          xAxis(into, MONTHS)
        },
      )
    },
  })

  // --- Overview ----------------------------------------------------------------------------------
  {
    const content = shell("Overview", 1, exportBtn)
    kpiRow(content, [
      ["Monthly recurring revenue", "$412.9K", "+2.0%", "up", "up", "vs August"],
      ["Active subscribers", "14,208", "+312", "up", "up", "vs August"],
      ["Trial to paid", "38.4%", "+1.9 pts", "up", "flat", "vs August"],
      ["Monthly churn", "3.1%", "-0.4 pts", "downGood", "down", "vs August"],
    ])
    const mid = b.row(content, "Charts", { w: FILL, h: 336, gap: s(4) })
    chart(
      mid,
      "Monthly recurring revenue",
      "Up 29.8% since October 2025",
      { w: 724, h: FILL },
      (into) => {
        const pw = 684 - 48
        const plot = plotFrame(into, pw, 196, ["$420K", "$390K", "$360K", "$330K", "$300K"])
        lineSeries(plot, MRR, pw, 196, 300, 420, "series-1", true)
        xAxis(into, MONTHS)
      },
    )
    chart(
      mid,
      "Subscriber movement",
      "New and canceled, last 6 months",
      { w: 404, h: FILL },
      (into) => {
        const pw = 364 - 48
        const ph = 166
        const plot = plotFrame(into, pw, ph, ["900", "600", "300", "0"])
        const bars = b.row(plot, "Bars", {
          position: "absolute",
          x: 0,
          y: 0,
          w: pw,
          h: ph,
          gap: 18,
          pad: [0, 8],
          align: "end",
          meta: overlay,
        })
        const data: [number, number][] = [
          [690, 402],
          [705, 418],
          [722, 431],
          [731, 436],
          [748, 441],
          [752, 440],
        ]
        for (const [i, [n, x]] of data.entries()) {
          const g = b.row(bars, MONTHS[6 + i] ?? "", { w: FILL, gap: 3, align: "end" })
          b.rect(g, "New", {
            w: FILL,
            h: Math.round((n / 900) * ph),
            radius: [3, 3, 0, 0],
            fill: c("series-1"),
          })
          b.rect(g, "Canceled", {
            w: FILL,
            h: Math.round((x / 900) * ph),
            radius: [3, 3, 0, 0],
            fill: c("series-2"),
          })
        }
        xAxis(into, MONTHS.slice(6), true)
      },
      [
        ["New", "s1"],
        ["Canceled", "s2"],
      ],
    )
    const bottom = b.row(content, "Bottom", { w: FILL, h: FILL, gap: s(4) })
    chart(
      bottom,
      "Subscribers by plan",
      "14,208 active in September",
      { w: 480, h: FILL },
      (into) => {
        const list = b.col(into, "Meters", { w: FILL, gap: 16, pad: [4, 0, 0, 0] })
        for (const [label, value, n, tone] of [
          ["Daily, $29 a month", "7,220", 50.8, "s1"],
          ["Explorer, $18 a month", "4,410", 31.0, "s2"],
          ["Reserve, $49 a month", "2,578", 18.1, "s3"],
        ] as const)
          b.use(list, meter, {
            props: { w: FILL },
            args: { label, value, detail: `${n}%`, tone },
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
        const cols: [string, number | null, "left" | "right"][] = [
          ["Channel", null, "left"],
          ["Trials", 80, "right"],
          ["Trial to paid", 100, "right"],
          ["Cost per paid", 100, "right"],
        ]
        const t = b.col(into, "Table", { w: FILL })
        const head = b.row(t, "Head", { w: FILL, gap: 16, pad: [0, 0, 8, 0] })
        for (const [l, w, align] of cols)
          b.text(head, l, b.ty("small", { weight: 600, align }), muted, {
            ...(w ? { w, grow: "fixed-width" } : { w: FILL, grow: "fixed-width" }),
          })
        for (const [ch, tr, rate, cpp] of [
          ["Instagram ads", "712", "34.1%", "$41.20"],
          ["Referral credits", "559", "47.9%", "$18.60"],
          ["Organic search", "458", "39.6%", "$0.00"],
          ["Podcast sponsorships", "295", "36.2%", "$52.80"],
        ] as const)
          simpleRow(
            t,
            [
              [ch, null, "left", true],
              [tr, 80, "right"],
              [rate, 100, "right"],
              [cpp, 100, "right"],
            ],
            [9, 0],
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
    b.use(tb, segmented, {
      args: { first: "Steps", second: "Trends", third: "Time to convert", active: "first" },
    })
    chart(
      content,
      "Sign-up to paid subscriber",
      "13,260 people signed up between Jul 1 and Sep 30, 2026. Conversion window: 30 days.",
      { w: FILL },
      (into) => {
        const steps = b.row(into, "Steps", { w: FILL, gap: s(4), pad: [8, 0, 0, 0] })
        for (const [name, count, n, d] of [
          ["Signed up", "13,260", 100, "7,558 did not start a trial"],
          ["Started trial", "5,702", 43.0, "467 canceled before shipping"],
          ["First box shipped", "5,235", 39.5, "1,482 did not rate the box"],
          ["Rated first box", "3,753", 28.3, "1,565 canceled in the trial"],
          ["Paid subscriber", "2,188", 16.5, ""],
        ] as const)
          b.use(steps, funnelStep, {
            props: { w: 208 },
            args: { name, count, rate: `${n}%`, ...(d ? { drop: d } : { showDrop: false }) },
            set: share(n),
          })
      },
      [
        ["Converted", "s1"],
        ["Dropped off", "s1light"],
      ],
    )
    const row = b.row(content, "Breakdown", { w: FILL, h: FILL, gap: s(4) })
    chart(
      row,
      "Conversion by channel",
      "Sign-up to paid, same period",
      { w: 680, h: FILL },
      (into) => {
        const t = b.col(into, "Table", { w: FILL })
        const head = b.row(t, "Head", { w: FILL, gap: 16, pad: [0, 0, 8, 0] })
        for (const [l, w, align] of [
          ["Channel", null, "left"],
          ["Sign-ups", 80, "right"],
          ["Trial rate", 80, "right"],
          ["Paid rate", 80, "right"],
          ["", 140, "left"],
        ] as const)
          b.text(head, l, b.ty("small", { weight: 600, align }), muted, {
            ...(w ? { w, grow: "fixed-width" } : { w: FILL, grow: "fixed-width" }),
          })
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
              [paid, 80, "right"],
            ],
            [9, 0],
          )
          const m = b.row(tr2, "Bar", {
            w: 140,
            h: 6,
            radius: r("pill"),
            fill: c("subtle"),
            clip: true,
          })
          b.rect(m, "Done", { w: fill(n), h: 6, fill: c("series-1") })
          b.rect(m, "Left", { w: fill(30 - n), h: 6, fill: c("subtle") })
        }
      },
    )
    chart(row, "Days from sign-up to paid", "Median 16 days", { w: FILL, h: FILL }, (into) => {
      const ph = 120
      const pw = 1144 - 680 - 16 - 40 - 48
      const plot = plotFrame(into, pw, ph, ["600", "300", "0"])
      const bars = b.row(plot, "Bars", {
        position: "absolute",
        x: 0,
        y: 0,
        w: pw,
        h: ph,
        gap: 6,
        pad: [0, 4],
        align: "end",
        meta: overlay,
      })
      for (const [i, v] of [140, 180, 210, 260, 410, 520, 560, 470, 380, 290, 210, 150].entries())
        b.rect(bars, `Days ${i * 3}`, {
          w: FILL,
          h: Math.round((v / 600) * ph),
          radius: [3, 3, 0, 0],
          fill: i === 5 ? c("series-1") : c("series-1-light"),
        })
      xAxis(into, ["0", "6", "12", "18", "24", "30 days"])
    })
  }

  // --- Retention ---------------------------------------------------------------------------------
  {
    const content = shell("Retention", 3, exportBtn)
    kpiRow(content, [
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
    chart(
      content,
      "Subscriber retention by signup month",
      "Share of each cohort still subscribed, by months since their first paid box",
      { w: FILL, h: FILL },
      (into) => {
        const t = b.col(into, "Cohort table", { w: FILL, gap: 4 })
        const head = b.row(t, "Head", { w: FILL, gap: 4, align: "center" })
        b.text(head, "Cohort", b.ty("small", { weight: 600 }), muted, {
          w: 92,
          grow: "fixed-width",
        })
        b.text(head, "Paid", b.ty("small", { weight: 600, align: "right" }), muted, {
          w: 56,
          grow: "fixed-width",
        })
        b.rect(head, "Gap", { w: 8, h: 1, fill: c("surface") })
        for (let m = 0; m < 12; m++)
          b.text(head, `M${m}`, b.ty("small", { weight: 600, align: "center" }), muted, {
            w: 74,
            grow: "fixed-width",
          })
        for (const [i, [label, size]] of cohorts.entries()) {
          const row = b.row(t, label, { w: FILL, gap: 4, align: "center" })
          b.text(row, label, b.ty("num"), ink, { w: 92, grow: "fixed-width" })
          b.text(row, size, b.ty("num", { align: "right" }), muted, { w: 56, grow: "fixed-width" })
          b.rect(row, "Gap", { w: 8, h: 1, fill: c("surface") })
          for (let m = 0; m < 12; m++) {
            const seen = m < 12 - i
            const v =
              m === 0
                ? 100
                : Math.round(48 + 52 * Math.exp(-m / 2.4) - 0.5 * m + 0.25 * i + (i === 2 ? -3 : 0))
            b.use(row, cohortCell, {
              props: { w: 74, h: 28 },
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
    kpiRow(content, [
      ["Monthly recurring revenue", "$412.9K", "+$8.2K", "up", "up", "net new in September"],
      ["New MRR", "$18.6K", "+0.0%", "flat", "flat", "vs August"],
      ["Expansion MRR", "$4.9K", "+2.1%", "up", "up", "vs August"],
      ["Churned MRR", "$12.7K", "+3.3%", "upBad", "up", "vs August"],
    ])
    const mid = b.row(content, "Charts", { w: FILL, h: 352, gap: s(4) })
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
      { w: 724, h: FILL },
      (into) => {
        const k = 5.5
        const up = b.row(into, "Gains", {
          w: FILL,
          h: 150,
          gap: 28,
          pad: [0, 20, 0, 48],
          align: "end",
        })
        b.rect(into, "Baseline", { w: FILL, h: 1, fill: c("border") })
        const down = b.row(into, "Losses", {
          w: FILL,
          h: 104,
          gap: 28,
          pad: [0, 20, 0, 48],
          align: "start",
        })
        for (const [i, [n, e, ct, ch]] of moves.entries()) {
          const g = b.col(up, `${MONTHS[6 + i]} gains`, { w: 79, gap: 2, align: "center" })
          b.text(g, `+${(n + e).toFixed(1)}`, b.ty("axis", { weight: 600 }), c("ink-2"))
          b.rect(g, "Expansion", {
            w: FILL,
            h: Math.round(e * k),
            radius: [3, 3, 0, 0],
            fill: c("series-1-light"),
          })
          b.rect(g, "New", { w: FILL, h: Math.round(n * k), fill: c("series-1") })
          const l = b.col(down, `${MONTHS[6 + i]} losses`, { w: 79, gap: 2, align: "center" })
          b.rect(l, "Contraction", { w: FILL, h: Math.round(ct * k), fill: c("series-2-light") })
          b.rect(l, "Churn", {
            w: FILL,
            h: Math.round(ch * k),
            radius: [0, 0, 3, 3],
            fill: c("series-2"),
          })
          b.text(l, `-${(ct + ch).toFixed(1)}`, b.ty("axis", { weight: 600 }), c("ink-2"))
        }
        const xl = b.row(into, "X axis", { w: FILL, gap: 28, pad: [8, 20, 0, 48] })
        for (const m of MONTHS.slice(6))
          b.text(xl, m, b.ty("axis", { align: "center" }), muted, { w: 79, grow: "fixed-width" })
      },
      [
        ["New", "s1"],
        ["Expansion", "s1light"],
        ["Contraction", "s2light"],
        ["Churn", "s2"],
      ],
    )
    chart(mid, "MRR by plan", "September 2026", { w: FILL, h: FILL }, (into) => {
      const t = b.col(into, "Table", { w: FILL })
      for (const [plan, subs, mrr, strong] of [
        ["Daily, $29", "7,220", "$209.4K", false],
        ["Reserve, $49", "2,578", "$126.3K", false],
        ["Explorer, $18", "4,410", "$79.4K", false],
        ["Discounts and credits", "", "-$2.2K", false],
        ["Total", "14,208", "$412.9K", true],
      ] as const)
        simpleRow(
          t,
          [
            [plan, null, "left", true],
            [subs, 70, "right", strong],
            [mrr, 80, "right", true],
          ],
          [11, 0],
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
        const t = b.col(into, "Table", { w: FILL })
        for (const [who, change, amt, when] of [
          ["Maya Lindqvist", "Daily to Reserve", "+$20.00", "Today, 9:42"],
          ["Owen Achebe", "Explorer to Daily", "+$11.00", "Yesterday, 18:10"],
          ["Hana Sato", "Reserve to Daily", "-$20.00", "Oct 4, 14:05"],
          ["Diego Ferreira", "Explorer, canceled", "-$18.00", "Oct 3, 21:37"],
          ["Lucas Moreau", "Daily to Reserve", "+$20.00", "Oct 2, 08:16"],
        ] as const)
          simpleRow(
            t,
            [
              [who, 200, "left", true],
              [change, null, "left"],
              [amt, 100, "right", true],
              [when, 140, "right"],
            ],
            [9, 0],
          )
      },
    )
  }

  // --- Customers ---------------------------------------------------------------------------------
  {
    const content = shell("Customers", 5, exportBtn)
    const tb = b.row(content, "Toolbar", { w: FILL, gap: 8, align: "center" })
    const bar = b.row(tb, "Filters", { w: FILL, gap: 8, align: "center" })
    const search = b.row(bar, "Search", {
      w: 300,
      gap: 8,
      align: "center",
      pad: [8, 12],
      radius: r("md"),
      fill: c("surface"),
      stroke: { paint: c("border") },
    })
    b.icon(search, "search", 15, muted)
    b.text(search, "Search name or email", b.ty("body", { size: 13 }), muted)
    b.use(bar, chip, { args: { field: "Plan", value: "is any" } })
    b.use(bar, chip, { args: { field: "Status", value: "is not Canceled" } })
    b.use(bar, chip, {
      args: { field: "Add filter", value: "", removable: false },
      set: { ChpIcon: { icon: "plus" } },
      hide: ["ChpVal"],
    })
    b.text(tb, "14,986 customers", b.ty("label"), c("ink-2"))
    const table = b.col(content, "Table", { w: FILL, h: FILL, ...card(), clip: true })
    tableHead(table, tableCols)
    const tones = ["violet", "green", "amber", "rose"] as const
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
    for (const [i, [name, email, plan, status, mrr, boxes, ltv, joined, last]] of rows.entries()) {
      const initials = name
        .split(" ")
        .map((w) => w[0])
        .join("")
      b.use(table, customerRow, {
        props: { w: FILL },
        args: { name, email, initials, plan, status, mrr, boxes, ltv, joined, last },
        set: {
          CrAv: { args: { size: "sm", tone: tones[i % 4] } },
          CrStatus: { args: { label: status, tone: statusTone[status] } },
          CrPlan: { args: { label: plan, tone: plan === "Reserve" ? "accent" : "neutral" } },
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
    b.text(foot, "Showing 1 to 10 of 14,986", b.ty("small"), muted)
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
    const row = b.row(content, "Builder", { w: FILL, h: FILL, gap: s(4) })
    const cfg = b.col(row, "Settings", { w: 300, h: FILL, gap: 18, pad: 18, ...card() })
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
    const br = b.col(cfg, "Breakdown", { w: FILL, gap: 6 })
    b.text(br, "Break down by", b.ty("label", { size: 12 }), c("ink-2"))
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
    b.text(fl, "Filters", b.ty("label", { size: 12 }), c("ink-2"))
    b.use(fl, chip, { args: { field: "Country", value: "is United States" } })
    b.use(fl, chip, {
      args: { field: "Add filter", value: "", removable: false },
      set: { ChpIcon: { icon: "plus" } },
      hide: ["ChpVal"],
    })
    const vz = b.col(cfg, "Chart type", { w: FILL, gap: 8 })
    b.text(vz, "Chart type", b.ty("label", { size: 12 }), c("ink-2"))
    b.use(vz, segmented, {
      args: { first: "Line", second: "Bar", third: "Table", active: "first" },
    })
    b.use(cfg, select, {
      props: { w: FILL },
      args: { label: "Interval", value: "Monthly" },
      set: { SlIcon: { icon: "calendar" } },
    })

    const right = b.col(row, "Preview", { w: FILL, h: FILL, gap: s(4) })
    const pw = 1144 - 300 - 16 - 40 - 48
    chart(
      right,
      "MRR by plan",
      "Monthly, Oct 2025 to Sep 2026, United States",
      { w: FILL },
      (into) => {
        const plot = plotFrame(into, pw, 300, ["$240K", "$180K", "$120K", "$60K", "$0"])
        lineSeries(plot, DAILY, pw, 300, 0, 240, "series-1")
        lineSeries(plot, RESERVE, pw, 300, 0, 240, "series-2")
        lineSeries(plot, EXPLORER, pw, 300, 0, 240, "series-3")
        xAxis(into, MONTHS)
      },
      [
        ["Daily", "s1"],
        ["Reserve", "s2"],
        ["Explorer", "s3"],
      ],
    )
    const data = b.col(right, "Data", { w: FILL, h: FILL, ...card(), clip: true })
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
