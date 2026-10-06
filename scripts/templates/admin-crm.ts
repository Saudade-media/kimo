/**
 * Keel: the web app of a fictional B2B sales CRM, used by the sales team of Corvid Analytics
 * (fleet analytics software). Screens (1440×900 app frames): Pipeline, Deals, Deal detail,
 * Contacts, Company profile, Reports.
 */
import { FILL, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "admin-crm",
  name: "Keel sales CRM",
  category: "Web app",
  description:
    "Six-screen B2B sales CRM: pipeline board, deals table, deal timeline, contacts, company profile and reports.",
  prefix: "kc",
  build,
}

type Stage = "lead" | "qualified" | "proposal" | "negotiation" | "won" | "lost"

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F7F6F3", "#111210"],
      surface: ["#FFFFFF", "#181917"],
      subtle: ["#F2F0EB", "#1F201D"],
      sidebar: ["#FBFAF8", "#151614"],
      "sidebar-ink": ["#2A2925", "#DAD8D1"],
      "sidebar-muted": ["#7C796E", "#8D8B81"],
      "sidebar-active": ["#EDEBE5", "#242521"],
      ink: ["#1F1E1B", "#EDECE8"],
      "ink-2": ["#46443D", "#C3C1B9"],
      muted: ["#787568", "#8E8C82"],
      border: ["#E8E5DE", "#2A2B27"],
      "border-strong": ["#D6D2C8", "#3A3B36"],
      accent: ["#1E6B58", "#5CCFAE"],
      "accent-soft": ["#E6F0EC", "#15291F"],
      "on-accent": ["#FFFFFF", "#08130F"],
      "on-ink": ["#FFFFFF", "#111210"],
      info: ["#2C5F8F", "#8FB4E3"],
      "info-soft": ["#E8EEF4", "#17222F"],
      violet: ["#7A4B86", "#C7A0D2"],
      "violet-soft": ["#F1EAF3", "#2A1D2F"],
      success: ["#2E7A4C", "#6FD08F"],
      "success-soft": ["#E6F1E9", "#15281B"],
      warning: ["#9A6212", "#E6B35A"],
      "warning-soft": ["#F8EFDD", "#2F2411"],
      danger: ["#B0412F", "#F08A78"],
      "danger-soft": ["#F8E8E3", "#321B16"],
      "tone-1": ["#D9E7DF", "#243B30"],
      "tone-2": ["#DCE5EE", "#25323F"],
      "tone-3": ["#EFE0C6", "#43341B"],
      "tone-4": ["#EDD9D4", "#48282A"],
      "tone-5": ["#E3DBEA", "#352B42"],
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
      "radius/md": 6,
      "radius/lg": 8,
      "radius/pill": 999,
      "size/sidebar": 220,
      "size/topbar": 48,
    },
    type: {
      display: { font: "Inter", size: 56, weight: 600, lineHeight: 1.05, letterSpacing: -1.8 },
      h1: { font: "Inter", size: 20, weight: 600, lineHeight: 1.25, letterSpacing: -0.3 },
      heading: { font: "Inter", size: 14, weight: 600, lineHeight: 1.3, letterSpacing: -0.1 },
      metric: { font: "Inter", size: 22, weight: 600, lineHeight: 1.15, letterSpacing: -0.4 },
      body: { font: "Inter", size: 13, weight: 400, lineHeight: 1.5 },
      label: { font: "Inter", size: 13, weight: 500, lineHeight: 1.3 },
      small: { font: "Inter", size: 12, weight: 400, lineHeight: 1.4 },
      mono: { font: "JetBrains Mono", size: 12, weight: 500, lineHeight: 1.4 },
    },
    shadows: {
      pop: [
        { kind: "shadow", x: 0, y: 1, blur: 2, color: "#1F1E1B14" },
        { kind: "shadow", x: 0, y: 8, blur: 20, spread: -6, color: "#1F1E1B26" },
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

  // --- Components: basics ----------------------------------------------------------------------

  const button = b.component(
    "Button",
    {
      key: "Btn",
      section: "Actions",
      description:
        "Primary (ink), secondary, ghost or danger; sm or md. Turn on Icon for a leading icon.",
      props: {
        label: p.text("BtnLabel", "Button"),
        icon: p.bool("BtnIcon", false),
        variant: p.variants({
          primary: {
            "root.fill": c("ink"),
            "root.stroke": { paint: c("ink") },
            "BtnLabel.fill": c("on-ink"),
            "BtnIcon.color": c("on-ink"),
          },
          secondary: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border-strong") },
            "BtnLabel.fill": ink,
            "BtnIcon.color": c("ink-2"),
          },
          ghost: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("surface") },
            "BtnLabel.fill": c("ink-2"),
            "BtnIcon.color": c("ink-2"),
          },
          danger: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border-strong") },
            "BtnLabel.fill": c("danger"),
            "BtnIcon.color": c("danger"),
          },
        }),
        size: p.variants({
          md: { "root.layout/pad": [5, 10], "BtnLabel.style/size": 13 },
          sm: { "root.layout/pad": [3, 8], "BtnLabel.style/size": 12 },
        }),
      },
      root: {
        dir: "row",
        gap: 6,
        align: "center",
        justify: "center",
        pad: [5, 10],
        radius: r("md"),
        fill: c("ink"),
        stroke: { paint: c("ink") },
      },
    },
    (root) => {
      b.icon(root, "plus", 14, c("on-ink"), { key: "BtnIcon", visible: false })
      b.text(root, "Button", b.ty("label"), c("on-ink"), { key: "BtnLabel", name: "Label" })
    },
  )
  const buttonSecondary = b.derive(button, "Button/Secondary", "BtnSec", {
    section: "Actions",
    args: { variant: "secondary" },
  })

  const iconButton = b.component(
    "Icon button",
    {
      key: "IconBtn",
      section: "Actions",
      props: {
        variant: p.variants({
          outline: { "root.fill": c("surface"), "root.stroke": { paint: c("border-strong") } },
          ghost: { "root.fill": c("surface"), "root.stroke": { paint: c("surface") } },
        }),
      },
      root: {
        dir: "row",
        w: 28,
        h: 28,
        align: "center",
        justify: "center",
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border-strong") },
      },
    },
    (root) => b.icon(root, "ellipsis", 15, c("ink-2"), { key: "IbIcon" }),
  )

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
          info: { "root.fill": c("info-soft"), "BadgeLbl.fill": c("info") },
          success: { "root.fill": c("success-soft"), "BadgeLbl.fill": c("success") },
          warning: { "root.fill": c("warning-soft"), "BadgeLbl.fill": c("warning") },
          danger: { "root.fill": c("danger-soft"), "BadgeLbl.fill": c("danger") },
        }),
      },
      root: { dir: "row", align: "center", pad: [1, 6], radius: r("sm"), fill: c("subtle") },
    },
    (root) =>
      b.text(root, "Badge", b.ty("small", { weight: 500, size: 11.5 }), c("ink-2"), {
        key: "BadgeLbl",
        name: "Label",
      }),
  )

  const stageTone: Record<Stage, [string, string]> = {
    lead: ["subtle", "muted"],
    qualified: ["info-soft", "info"],
    proposal: ["violet-soft", "violet"],
    negotiation: ["warning-soft", "warning"],
    won: ["success-soft", "success"],
    lost: ["danger-soft", "danger"],
  }
  const stageName: Record<Stage, string> = {
    lead: "Lead",
    qualified: "Qualified",
    proposal: "Proposal",
    negotiation: "Negotiation",
    won: "Closed won",
    lost: "Closed lost",
  }
  const stageBadge = b.component(
    "Stage badge",
    {
      key: "StageBdg",
      section: "Status",
      description: "One tone per pipeline stage. Set the label to the stage name.",
      props: {
        label: p.text("SbLbl", "Lead"),
        stage: p.variants(
          Object.fromEntries(
            (Object.keys(stageTone) as Stage[]).map((k) => {
              const [bg, fg] = stageTone[k]
              return [k, { "root.fill": c(bg), "SbDot.fill": c(fg), "SbLbl.fill": c(fg) }]
            }),
          ),
        ),
      },
      root: {
        dir: "row",
        gap: 5,
        align: "center",
        pad: [2, 7, 2, 6],
        radius: r("sm"),
        fill: c("subtle"),
      },
    },
    (root) => {
      b.ellipse(root, "Dot", { key: "SbDot", w: 6, h: 6, fill: muted })
      b.text(root, "Lead", b.ty("small", { weight: 500, size: 11.5 }), muted, {
        key: "SbLbl",
        name: "Label",
      })
    },
  )

  const avatar = b.component(
    "Avatar",
    {
      key: "Avatar",
      section: "Status",
      props: {
        initials: p.text("AvInit", "DW"),
        size: p.variants({
          md: { "root.w": 28, "root.h": 28, "AvInit.style/size": 11 },
          xs: { "root.w": 20, "root.h": 20, "AvInit.style/size": 8.5 },
          sm: { "root.w": 24, "root.h": 24, "AvInit.style/size": 9.5 },
          lg: { "root.w": 36, "root.h": 36, "AvInit.style/size": 13 },
        }),
        tone: p.variants({
          green: { "root.fill": c("tone-1") },
          blue: { "root.fill": c("tone-2") },
          amber: { "root.fill": c("tone-3") },
          rose: { "root.fill": c("tone-4") },
          violet: { "root.fill": c("tone-5") },
        }),
      },
      root: {
        dir: "row",
        w: 28,
        h: 28,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("tone-1"),
      },
    },
    (root) =>
      b.text(root, "DW", b.ty("label", { size: 11, weight: 600 }), c("ink-2"), {
        key: "AvInit",
        name: "Initials",
      }),
  )

  const logo = b.component(
    "Company logo",
    {
      key: "Logo",
      section: "Status",
      description: "Placeholder mark: the company's initials on a tone, square like a favicon.",
      props: {
        initials: p.text("LgInit", "MG"),
        size: p.variants({
          sm: { "root.w": 24, "root.h": 24, "LgInit.style/size": 10, "root.radius": 5 },
          xs: { "root.w": 18, "root.h": 18, "LgInit.style/size": 8, "root.radius": 4 },
          lg: { "root.w": 44, "root.h": 44, "LgInit.style/size": 16, "root.radius": 9 },
        }),
        tone: p.variants({
          green: { "root.fill": c("tone-1") },
          blue: { "root.fill": c("tone-2") },
          amber: { "root.fill": c("tone-3") },
          rose: { "root.fill": c("tone-4") },
          violet: { "root.fill": c("tone-5") },
        }),
      },
      root: {
        dir: "row",
        w: 24,
        h: 24,
        align: "center",
        justify: "center",
        radius: 5,
        fill: c("tone-1"),
      },
    },
    (root) =>
      b.text(root, "MG", b.ty("label", { size: 10, weight: 700 }), c("ink-2"), {
        key: "LgInit",
        name: "Initials",
      }),
  )

  const progress = b.component(
    "Progress bar",
    {
      key: "Progress",
      section: "Status",
      description: "Set the Done and Left weights to the percentage.",
      props: {
        tone: p.variants({
          accent: { "PbDone.fill": c("accent") },
          info: { "PbDone.fill": c("info") },
          violet: { "PbDone.fill": c("violet") },
          muted: { "PbDone.fill": c("border-strong") },
          warning: { "PbDone.fill": c("warning") },
          danger: { "PbDone.fill": c("danger") },
        }),
      },
      root: { dir: "row", w: 160, h: 4, radius: r("pill"), fill: c("subtle"), clip: true },
    },
    (root) => {
      b.rect(root, "Done", {
        key: "PbDone",
        w: { mode: "fill", weight: 50 },
        h: 4,
        fill: c("accent"),
      })
      b.rect(root, "Left", {
        key: "PbLeft",
        w: { mode: "fill", weight: 50 },
        h: 4,
        fill: c("subtle"),
      })
    },
  )
  const pct = (n: number) => ({
    PbDone: { visible: n > 0, w: { mode: "fill", weight: Math.max(n, 1) } },
    PbLeft: { visible: n < 100, w: { mode: "fill", weight: Math.max(100 - n, 1) } },
  })

  const checkbox = b.component(
    "Checkbox",
    {
      key: "Check",
      section: "Forms",
      props: {
        state: p.variants({
          off: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border-strong"), width: 1 },
            "CbTick.visible": false,
          },
          on: {
            "root.fill": c("ink"),
            "root.stroke": { paint: c("ink"), width: 1 },
            "CbTick.visible": true,
          },
        }),
      },
      root: {
        dir: "row",
        w: 14,
        h: 14,
        align: "center",
        justify: "center",
        radius: 3,
        fill: c("surface"),
        stroke: { paint: c("border-strong"), width: 1 },
      },
    },
    (root) => b.icon(root, "check", 10, c("on-ink"), { key: "CbTick", visible: false }),
  )

  const chip = b.component(
    "Filter chip",
    {
      key: "Chip",
      section: "Forms",
      props: {
        label: p.text("ChLbl", "Owner"),
        value: p.text("ChVal", "Anyone"),
        state: p.variants({
          default: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border-strong") },
            "ChVal.fill": ink,
          },
          active: {
            "root.fill": c("accent-soft"),
            "root.stroke": { paint: c("accent") },
            "ChVal.fill": c("accent"),
          },
        }),
      },
      root: {
        dir: "row",
        gap: 5,
        align: "center",
        pad: [3, 8],
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border-strong") },
      },
    },
    (root) => {
      b.text(root, "Owner", b.ty("small"), muted, { key: "ChLbl", name: "Label" })
      b.text(root, "Anyone", b.ty("small", { weight: 500 }), ink, { key: "ChVal", name: "Value" })
      b.icon(root, "chevron-down", 12, muted)
    },
  )

  const searchField = b.component(
    "Search field",
    {
      key: "Search",
      section: "Forms",
      props: { placeholder: p.text("SfText", "Search") },
      root: {
        dir: "row",
        w: 280,
        gap: 8,
        align: "center",
        pad: [5, 10],
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border-strong") },
      },
    },
    (root) => {
      b.icon(root, "search", 14, muted)
      b.text(root, "Search", b.ty("body"), muted, {
        key: "SfText",
        w: FILL,
        grow: "fixed-width",
      })
    },
  )

  const tabsLabels = ["Tab one", "Tab two", "Tab three", "Tab four"]
  const tabActive = (i: number) =>
    Object.fromEntries(
      tabsLabels.flatMap((_, j) => [
        [`TabI${j + 1}.stroke`, { paint: ink, width: { b: j === i ? 1.5 : 0 } }],
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
        showFourth: p.bool("TabI4", true),
        active: p.variants({
          first: tabActive(0),
          second: tabActive(1),
          third: tabActive(2),
          fourth: tabActive(3),
        }),
      },
      root: { dir: "row", w: 600, gap: 2, stroke: { paint: c("border"), width: { b: 1 } } },
    },
    (root) => {
      tabsLabels.forEach((t, i) => {
        const item = b.row(root, t, {
          key: `TabI${i + 1}`,
          pad: [7, 10],
          stroke: { paint: ink, width: { b: i === 0 ? 1.5 : 0 } },
        })
        b.text(item, t, b.ty("label"), i === 0 ? ink : muted, {
          key: `TabL${i + 1}`,
          name: "Label",
        })
      })
    },
  )

  const navItem = b.component(
    "Nav item",
    {
      key: "Nav",
      section: "Navigation",
      props: {
        label: p.text("NavLbl", "Item"),
        count: p.text("NavCnt", "0"),
        showCount: p.bool("NavCnt", false),
        state: p.variants({
          default: {
            "root.fill": c("sidebar"),
            "NavLbl.fill": c("sidebar-ink"),
            "NavIcon.color": c("sidebar-muted"),
          },
          active: {
            "root.fill": c("sidebar-active"),
            "NavLbl.fill": ink,
            "NavIcon.color": ink,
          },
        }),
      },
      root: {
        dir: "row",
        w: 196,
        gap: 8,
        align: "center",
        pad: [5, 8],
        radius: r("md"),
        fill: c("sidebar"),
      },
    },
    (root) => {
      b.icon(root, "kanban", 16, c("sidebar-muted"), { key: "NavIcon" })
      b.text(root, "Item", b.ty("label"), c("sidebar-ink"), {
        key: "NavLbl",
        w: FILL,
        grow: "fixed-width",
        name: "Label",
      })
      b.text(root, "0", b.ty("mono", { size: 11 }), c("sidebar-muted"), {
        key: "NavCnt",
        visible: false,
        name: "Count",
      })
    },
  )

  const navs = [
    ["Pipeline", "kanban", ""],
    ["Deals", "circle-dollar-sign", "48"],
    ["Contacts", "contact", ""],
    ["Companies", "building-2", ""],
    ["Tasks", "square-check", "7"],
    ["Reports", "chart-column", ""],
  ] as const
  const navArgs: Record<string, Record<string, string | boolean>> = {
    SbSet: { label: "Settings" },
  }
  navs.forEach(([label, , count], i) => {
    navArgs[`SbNav${i + 1}`] = { label, ...(count ? { count, showCount: true } : {}) }
  })
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
        pad: [12, 12],
        fill: c("sidebar"),
        stroke: { paint: c("border"), width: { r: 1 } },
      },
    },
    (root) => {
      const top = b.col(root, "Top", { w: FILL, gap: s(3) })
      const brand = b.row(top, "Workspace", { w: FILL, gap: 8, align: "center", pad: [4, 6] })
      const mark = b.row(brand, "Mark", {
        w: 20,
        h: 20,
        radius: 5,
        fill: c("ink"),
        align: "center",
        justify: "center",
      })
      b.icon(mark, "anchor", 12, c("on-ink"))
      b.text(brand, "Corvid Analytics", b.ty("label"), ink, { w: FILL, grow: "fixed-width" })
      b.icon(brand, "chevrons-up-down", 14, c("sidebar-muted"))
      const find = b.row(top, "Search", {
        w: FILL,
        gap: 8,
        align: "center",
        pad: [5, 8],
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      })
      b.icon(find, "search", 14, c("sidebar-muted"))
      b.text(find, "Search", b.ty("body"), c("sidebar-muted"), { w: FILL, grow: "fixed-width" })
      b.text(find, "⌘K", b.ty("mono", { size: 11 }), c("sidebar-muted"))
      const nav = b.col(top, "Navigation", { w: FILL, gap: 1, pad: [8, 0, 0, 0] })
      const group = (label: string, at: number) => {
        const w = b.row(nav, "Section", { w: FILL, pad: [at === 0 ? 0 : 12, 8, 4, 8] })
        return b.text(w, label, b.ty("small", { weight: 500, size: 11 }), c("sidebar-muted"))
      }
      for (const [i, [label, icon, count]] of navs.entries()) {
        if (i === 0) group("Records", 0)
        if (i === 4) group("Work", 4)
        b.use(nav, navItem, {
          key: `SbNav${i + 1}`,
          props: { w: FILL },
          args: { label, ...(count ? { count, showCount: true } : {}) },
          set: { NavIcon: { icon } },
        })
      }
      group("Views", 6)
      for (const label of ["Closing this month", "Enterprise over $50k", "My open deals"])
        b.use(nav, navItem, {
          props: { w: FILL },
          args: { label },
          set: { NavIcon: { icon: "list-filter" } },
        })
      const bottom = b.col(root, "Bottom", { w: FILL, gap: 8 })
      const quota = b.col(bottom, "Quota", {
        w: FILL,
        gap: 6,
        pad: [10, 8],
        stroke: { paint: c("border"), width: { t: 1 } },
      })
      const qh = b.row(quota, "Head", { w: FILL, justify: "between", align: "center" })
      b.text(qh, "October target", b.ty("small", { weight: 500 }), c("sidebar-ink"))
      b.text(qh, "8%", b.ty("mono", { size: 11 }), c("sidebar-muted"))
      b.use(quota, progress, {
        props: { w: FILL },
        args: { tone: "accent" },
        set: pct(8),
      })
      b.text(quota, "$18,900 of $240,000 closed", b.ty("small"), c("sidebar-muted"))
      b.use(bottom, navItem, {
        key: "SbSet",
        props: { w: FILL },
        args: { label: "Settings" },
        set: { NavIcon: { icon: "settings" } },
      })
      const me = b.row(bottom, "Account", { w: FILL, gap: 8, align: "center", pad: [4, 8] })
      b.use(me, avatar, { args: { initials: "DW", size: "sm", tone: "amber" } })
      const who = b.col(me, "Names", { w: FILL, gap: 0 })
      b.text(who, "Dana Whitfield", b.ty("label"), ink)
      b.text(who, "Sales lead", b.ty("small", { size: 11 }), c("sidebar-muted"))
    },
  )

  const topBar = b.component(
    "Top bar",
    {
      key: "TopBar",
      section: "Navigation",
      props: {
        title: p.text("TbTitle", "Page"),
        crumb: p.text("TbCrumb", "Sales"),
        actions: p.slot("TbActs"),
      },
      root: {
        dir: "row",
        w: 1220,
        h: b.n("size/topbar"),
        gap: 16,
        align: "center",
        pad: [0, 20],
        fill: c("surface"),
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const t = b.row(root, "Title", { w: FILL, gap: 6, align: "center" })
      b.text(t, "Sales", b.ty("body"), muted, { key: "TbCrumb", name: "Crumb" })
      b.text(t, "/", b.ty("body"), c("border-strong"))
      b.text(t, "Page", b.ty("label"), ink, { key: "TbTitle", name: "Title" })
      b.row(root, "Actions", {
        key: "TbActs",
        gap: 6,
        align: "center",
        slot: { suggested: [button, buttonSecondary] },
      })
      b.use(root, iconButton, {
        args: { variant: "ghost" },
        set: { IbIcon: { icon: "bell" } },
      })
    },
  )

  // --- Components: deals -----------------------------------------------------------------------

  const dealCard = b.component(
    "Deal card",
    {
      key: "DealCard",
      section: "Pipeline",
      description:
        "Company, deal, value, close date and owner. The bar under it is days in stage against the stage's usual length.",
      props: {
        company: p.text("DcCo", "Company"),
        logo: p.text("DcLogo/LgInit", "CO"),
        deal: p.text("DcDeal", "Deal name"),
        value: p.text("DcVal", "$0"),
        close: p.text("DcClose", "Oct 30"),
        initials: p.text("DcAv/AvInit", "DW"),
        age: p.text("DcAge", "6d"),
        flag: p.bool("DcFlag", false),
        health: p.variants({
          normal: { "DcClose.fill": muted, "DcCal.color": muted },
          overdue: { "DcClose.fill": c("danger"), "DcCal.color": c("danger") },
        }),
      },
      root: {
        dir: "column",
        w: 216,
        gap: 8,
        pad: [10, 10, 9, 10],
        ...card({ radius: r("md") }),
      },
    },
    (root) => {
      const top = b.row(root, "Company", { w: FILL, gap: 6, align: "center" })
      b.use(top, logo, { key: "DcLogo", args: { size: "xs" } })
      b.text(top, "Company", b.ty("small"), muted, {
        key: "DcCo",
        w: FILL,
        grow: "fixed-width",
      })
      b.icon(top, "flame", 13, c("warning"), { key: "DcFlag", visible: false })
      b.para(root, "Deal name", b.ty("label", { lineHeight: 1.35 }), ink, {
        key: "DcDeal",
        name: "Deal",
      })
      const foot = b.row(root, "Footer", { w: FILL, gap: 8, align: "center" })
      b.text(foot, "$0", b.ty("mono", { size: 12.5, weight: 500 }), ink, {
        key: "DcVal",
        w: FILL,
        grow: "fixed-width",
      })
      const due = b.row(foot, "Close", { gap: 4, align: "center" })
      b.icon(due, "calendar", 12, muted, { key: "DcCal" })
      b.text(due, "Oct 30", b.ty("small"), muted, { key: "DcClose" })
      b.use(foot, avatar, { key: "DcAv", args: { size: "xs" } })
      const age = b.row(root, "In stage", { w: FILL, gap: 8, align: "center" })
      b.use(age, progress, { key: "DcBar", props: { w: FILL }, args: { tone: "muted" } })
      b.text(age, "6d", b.ty("mono", { size: 10.5 }), muted, { key: "DcAge" })
    },
  )

  const stageColumn = b.component(
    "Stage column",
    {
      key: "StageCol",
      section: "Pipeline",
      description:
        "Fill the Cards slot with Deal cards. No panel behind the cards: the stage reads from its dot and header.",
      props: {
        title: p.text("ScTitle", "Lead"),
        count: p.text("ScCount", "0"),
        total: p.text("ScTotal", "$0"),
        weighted: p.text("ScWeighted", "$0"),
        cards: p.slot("ScCards"),
        showAdd: p.bool("ScAdd", true),
        showFooter: p.bool("ScFoot", true),
        stage: p.variants(
          Object.fromEntries(
            (Object.keys(stageTone) as Stage[]).map((k) => [
              k,
              { "ScDot.fill": c(stageTone[k][1]) },
            ]),
          ),
        ),
      },
      root: { dir: "column", w: 226, gap: 8 },
    },
    (root) => {
      const head = b.row(root, "Header", { w: FILL, gap: 6, align: "center", pad: [2, 2, 4, 2] })
      b.ellipse(head, "Stage dot", { key: "ScDot", w: 8, h: 8, fill: muted })
      b.text(head, "Lead", b.ty("label"), ink, { key: "ScTitle" })
      b.text(head, "0", b.ty("mono", { size: 11.5 }), muted, {
        key: "ScCount",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(head, "$0", b.ty("mono", { size: 11.5 }), c("ink-2"), { key: "ScTotal" })
      b.col(root, "Cards", { key: "ScCards", w: FILL, gap: 6, slot: { suggested: [dealCard] } })
      const add = b.row(root, "Add deal", {
        key: "ScAdd",
        w: FILL,
        gap: 6,
        align: "center",
        pad: [5, 6],
        radius: r("md"),
        stroke: { paint: c("border-strong"), dash: [3, 3] },
      })
      b.icon(add, "plus", 13, muted)
      b.text(add, "Add deal", b.ty("small"), muted)
      const foot = b.row(root, "Weighted", {
        key: "ScFoot",
        w: FILL,
        gap: 6,
        align: "center",
        pad: [8, 2, 0, 2],
        stroke: { paint: c("border"), width: { t: 1 } },
      })
      b.text(foot, "Weighted", b.ty("small", { size: 11 }), muted, { w: FILL, grow: "fixed-width" })
      b.text(foot, "$0", b.ty("mono", { size: 11.5 }), c("ink-2"), { key: "ScWeighted" })
    },
  )

  const dealRow = b.component(
    "Deal row",
    {
      key: "DealRow",
      section: "Tables",
      description: "Deals table row. Hide Owner or Probability for narrow panels.",
      props: {
        deal: p.text("DrDeal", "Deal"),
        company: p.text("DrCo", "Company"),
        logo: p.text("DrLogo/LgInit", "CO"),
        stage: p.text("DrStage/SbLbl", "Lead"),
        value: p.text("DrVal", "$0"),
        owner: p.text("DrOwnName", "Owner"),
        initials: p.text("DrOwnAv/AvInit", "DW"),
        close: p.text("DrClose", "Oct 30"),
        probability: p.text("DrProb", "10%"),
        selected: p.variants({
          no: {
            "root.fill": c("surface"),
            "DrCheck.args": { state: "off" },
          },
          yes: {
            "root.fill": c("subtle"),
            "DrCheck.args": { state: "on" },
          },
        }),
      },
      root: {
        dir: "row",
        w: 1100,
        gap: 16,
        align: "center",
        pad: [6, 16],
        fill: c("surface"),
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      b.use(root, checkbox, { key: "DrCheck" })
      const name = b.row(root, "Deal", { w: FILL, gap: 8, align: "center" })
      b.use(name, logo, { key: "DrLogo", args: { size: "xs" } })
      b.text(name, "Deal", b.ty("label"), ink, { key: "DrDeal" })
      b.text(name, "Company", b.ty("small"), muted, { key: "DrCo" })
      const st = b.row(root, "Stage", { key: "DrStageCell", w: 120 })
      b.use(st, stageBadge, { key: "DrStage" })
      b.text(root, "$0", b.ty("mono", { align: "right" }), ink, {
        key: "DrVal",
        w: 96,
        grow: "fixed-width",
      })
      const own = b.row(root, "Owner", { key: "DrOwner", w: 160, gap: 8, align: "center" })
      b.use(own, avatar, { key: "DrOwnAv", args: { size: "xs" } })
      b.text(own, "Owner", b.ty("body"), c("ink-2"), { key: "DrOwnName" })
      b.text(root, "Oct 30", b.ty("body"), c("ink-2"), {
        key: "DrClose",
        w: 84,
        grow: "fixed-width",
      })
      b.text(root, "10%", b.ty("mono", { align: "right" }), muted, {
        key: "DrProb",
        w: 64,
        grow: "fixed-width",
      })
    },
  )

  const contactRow = b.component(
    "Contact row",
    {
      key: "ContRow",
      section: "Tables",
      props: {
        name: p.text("CrName", "Name"),
        title: p.text("CrTitle", "Title"),
        initials: p.text("CrAv/AvInit", "LB"),
        company: p.text("CrCo", "Company"),
        logo: p.text("CrLogo/LgInit", "CO"),
        email: p.text("CrMail", "name@company.com"),
        phone: p.text("CrPhone", "+1 555 0100"),
        last: p.text("CrLast", "Today"),
        owner: p.text("CrOwn/AvInit", "DW"),
      },
      root: {
        dir: "row",
        w: 1100,
        gap: 16,
        align: "center",
        pad: [6, 16],
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      b.use(root, checkbox)
      const who = b.row(root, "Person", { w: FILL, gap: 8, align: "center" })
      b.use(who, avatar, { key: "CrAv", args: { size: "sm" } })
      b.text(who, "Name", b.ty("label"), ink, { key: "CrName" })
      b.text(who, "Title", b.ty("small"), muted, { key: "CrTitle" })
      const co = b.row(root, "Company", { w: 190, gap: 8, align: "center" })
      b.use(co, logo, { key: "CrLogo", args: { size: "xs" } })
      b.text(co, "Company", b.ty("body"), c("ink-2"), { key: "CrCo" })
      b.text(root, "name@company.com", b.ty("body"), c("ink-2"), {
        key: "CrMail",
        w: 230,
        grow: "fixed-width",
      })
      b.text(root, "+1 555 0100", b.ty("mono"), c("ink-2"), {
        key: "CrPhone",
        w: 140,
        grow: "fixed-width",
      })
      b.text(root, "Today", b.ty("body"), muted, {
        key: "CrLast",
        w: 100,
        grow: "fixed-width",
      })
      const own = b.row(root, "Owner", { w: 48, justify: "end" })
      b.use(own, avatar, { key: "CrOwn", args: { size: "xs" } })
    },
  )

  const kinds = {
    call: ["phone", "info"],
    email: ["mail", "accent"],
    meeting: ["calendar", "violet"],
    note: ["sticky-note", "warning"],
    stage: ["arrow-right", "ink-2"],
  } as const
  const timelineItem = b.component(
    "Timeline item",
    {
      key: "Event",
      section: "Activity",
      description:
        "A 20px glyph on a one-pixel rail, a sentence and a mono timestamp. Turn off Connector on the last item.",
      props: {
        title: p.text("EvTitle", "Activity"),
        body: p.text("EvBody", "Details."),
        showBody: p.bool("EvBody", true),
        meta: p.text("EvMeta", "Dana Whitfield"),
        time: p.text("EvTime", "Today, 9:40"),
        connector: p.bool("EvLine", true),
        kind: p.variants(
          Object.fromEntries(
            Object.entries(kinds).map(([k, [icon, fg]]) => [
              k,
              { "EvIcon.icon": icon, "EvIcon.color": c(fg) },
            ]),
          ),
        ),
      },
      root: { dir: "row", w: 640, gap: 12, align: "stretch" },
    },
    (root) => {
      const rail = b.col(root, "Rail", { gap: 4, align: "center", pad: [2, 0, 0, 0] })
      const badgeBox = b.row(rail, "Icon", {
        key: "EvBadge",
        w: 20,
        h: 20,
        radius: 5,
        align: "center",
        justify: "center",
        fill: c("surface"),
        stroke: { paint: c("border-strong") },
      })
      b.icon(badgeBox, "phone", 11, c("info"), { key: "EvIcon" })
      b.rect(rail, "Connector", { key: "EvLine", w: 1, h: FILL, fill: c("border") })
      const text = b.col(root, "Text", { w: FILL, gap: 3, pad: [1, 0, 16, 0] })
      const head = b.row(text, "Header", { w: FILL, gap: 12, align: "center" })
      b.text(head, "Activity", b.ty("label"), ink, {
        key: "EvTitle",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(head, "Today, 9:40", b.ty("mono", { size: 11 }), muted, { key: "EvTime" })
      b.para(text, "Details.", b.ty("body"), c("ink-2"), { key: "EvBody" })
      b.text(text, "Dana Whitfield", b.ty("small", { size: 11.5 }), muted, { key: "EvMeta" })
    },
  )

  const taskItem = b.component(
    "Task item",
    {
      key: "TaskItem",
      section: "Activity",
      props: {
        title: p.text("TiTitle", "Task"),
        due: p.text("TiDue", "Today"),
        state: p.variants({
          open: {
            "TiCheck.args": { state: "off" },
            "TiTitle.fill": ink,
            "TiTitle.style/decoration": [],
          },
          done: {
            "TiCheck.args": { state: "on" },
            "TiTitle.fill": muted,
            "TiTitle.style/decoration": ["strike"],
          },
        }),
        dueTone: p.variants({
          normal: { "TiDue.fill": muted },
          overdue: { "TiDue.fill": c("danger") },
        }),
      },
      root: { dir: "row", w: 320, gap: 8, align: "center", pad: [6, 0] },
    },
    (root) => {
      b.use(root, checkbox, { key: "TiCheck" })
      b.text(root, "Task", b.ty("body"), ink, {
        key: "TiTitle",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(root, "Today", b.ty("mono", { size: 11 }), muted, { key: "TiDue" })
    },
  )

  const fieldRow = b.component(
    "Field row",
    {
      key: "Field",
      section: "Activity",
      description: "Attribute row for record side panels: icon, muted label, value.",
      props: { label: p.text("FrLbl", "Label"), value: p.text("FrVal", "Value") },
      root: { dir: "row", w: 320, gap: 8, align: "start", pad: [5, 0] },
    },
    (root) => {
      b.icon(root, "user", 14, muted, { key: "FrIcon" })
      b.text(root, "Label", b.ty("body"), muted, {
        key: "FrLbl",
        w: 96,
        grow: "fixed-width",
      })
      b.para(root, "Value", b.ty("body", { weight: 500 }), ink, { key: "FrVal" })
    },
  )

  const stepper = b.component(
    "Stage step",
    {
      key: "Step",
      section: "Pipeline",
      description: "A segment of the stage tracker: a bar and a label. Done, current or upcoming.",
      props: {
        label: p.text("StpLbl", "Stage"),
        state: p.variants({
          done: {
            "StpBar.fill": c("accent"),
            "StpLbl.fill": c("ink-2"),
            "StpIcon.visible": true,
          },
          current: {
            "StpBar.fill": ink,
            "StpLbl.fill": ink,
            "StpIcon.visible": false,
          },
          upcoming: {
            "StpBar.fill": c("border"),
            "StpLbl.fill": muted,
            "StpIcon.visible": false,
          },
        }),
      },
      root: { dir: "column", w: 160, gap: 6 },
    },
    (root) => {
      b.rect(root, "Bar", { key: "StpBar", w: FILL, h: 3, radius: 2, fill: c("accent") })
      const line = b.row(root, "Label", { gap: 4, align: "center" })
      b.icon(line, "check", 12, c("accent"), { key: "StpIcon" })
      b.text(line, "Stage", b.ty("small", { weight: 500 }), ink, { key: "StpLbl" })
    },
  )

  const kpi = b.component(
    "KPI cell",
    {
      key: "Kpi",
      section: "Reports",
      description:
        "One cell of a stats strip. Put cells side by side inside a single bordered card, divided by hairlines.",
      props: {
        label: p.text("KpLbl", "Metric"),
        value: p.text("KpVal", "0"),
        delta: p.text("KpDelta", "+0%"),
        caption: p.text("KpCap", "vs last quarter"),
        trend: p.variants({
          up: {
            "KpDelta.fill": c("success"),
            "KpTrend.icon": "arrow-up-right",
            "KpTrend.color": c("success"),
          },
          down: {
            "KpDelta.fill": c("danger"),
            "KpTrend.icon": "arrow-down-right",
            "KpTrend.color": c("danger"),
          },
        }),
      },
      root: { dir: "column", w: 264, gap: 6, pad: [14, 16] },
    },
    (root) => {
      b.text(root, "Metric", b.ty("small", { weight: 500 }), muted, { key: "KpLbl" })
      b.text(root, "0", b.ty("metric"), ink, { key: "KpVal", name: "Value" })
      const foot = b.row(root, "Footer", { gap: 3, align: "center" })
      b.icon(foot, "arrow-up-right", 12, c("success"), { key: "KpTrend" })
      b.text(foot, "+0%", b.ty("mono", { size: 11.5 }), c("success"), { key: "KpDelta" })
      const cap = b.row(foot, "Caption", { pad: [0, 0, 0, 4] })
      b.text(cap, "vs last quarter", b.ty("small", { size: 11.5 }), muted, { key: "KpCap" })
    },
  )

  // --- Data --------------------------------------------------------------------------------------

  const reps = {
    DW: ["Dana Whitfield", "amber"],
    MO: ["Marcus Oyelaran", "blue"],
    PR: ["Priya Raman", "violet"],
    TL: ["Tomas Lindqvist", "green"],
    HC: ["Hannah Cho", "rose"],
  } as const
  type Rep = keyof typeof reps
  const companies = {
    HS: ["Halvorsen Shipping", "blue"],
    MG: ["Meridian Grocers", "green"],
    CR: ["Copperline Rail", "amber"],
    PH: ["Pinecrest Health", "rose"],
    BM: ["Bluefin Marine", "blue"],
    TR: ["Tessera Retail", "violet"],
    OF: ["Oakridge Foods", "amber"],
    AP: ["Altamira Pharma", "violet"],
    QL: ["Quarry Lane Builders", "green"],
    FS: ["Fenwick & Shaw", "rose"],
    RD: ["Riverbend Dairy", "green"],
    ST: ["Solano Transit", "amber"],
    GP: ["Granite Peak Logistics", "blue"],
    VO: ["Vantage Outdoor", "rose"],
    KC: ["Kestrel Air Cargo", "violet"],
    NU: ["Northgate Utilities", "blue"],
    LH: ["Larkspur Hotels", "amber"],
    AW: ["Ashby Waste Services", "green"],
  } as const
  type Co = keyof typeof companies
  // deal, company, stage, value, owner, close, probability
  const deals: [string, Co, Stage, string, Rep, string, string][] = [
    ["Cold chain monitoring", "MG", "proposal", "$142,000", "PR", "Nov 14", "60%"],
    ["Bus fleet telematics", "ST", "qualified", "$118,000", "MO", "Dec 19", "40%"],
    ["GDP compliance reporting", "AP", "qualified", "$97,500", "DW", "Dec 12", "35%"],
    ["Fleet analytics rollout", "HS", "negotiation", "$86,400", "MO", "Oct 28", "80%"],
    ["Ambulance routing", "PH", "negotiation", "$64,000", "DW", "Oct 3", "75%"],
    ["Last-mile analytics", "TR", "proposal", "$54,200", "MO", "Nov 20", "50%"],
    ["Courier fleet renewal", "FS", "won", "$45,000", "HC", "Sep 29", "100%"],
    ["Track sensor pilot", "CR", "qualified", "$38,500", "TL", "Dec 3", "30%"],
    ["Warehouse yard visibility", "GP", "lost", "$33,000", "TL", "Sep 18", "0%"],
    ["Equipment tracking", "QL", "lead", "$27,300", "TL", "Jan 30", "10%"],
    ["Port dashboard", "BM", "lead", "$21,600", "HC", "Jan 15", "10%"],
    ["Driver safety add-on", "OF", "won", "$18,900", "PR", "Oct 2", "100%"],
    ["Route planning", "RD", "lead", "$12,800", "PR", "Feb 6", "10%"],
    ["Delivery fleet visibility", "VO", "lead", "$16,400", "HC", "Feb 20", "10%"],
    ["Ground handling tracking", "KC", "qualified", "$72,000", "DW", "Jan 8", "30%"],
    ["Service van routing", "NU", "proposal", "$48,600", "TL", "Nov 28", "55%"],
    ["Shuttle fleet monitoring", "LH", "negotiation", "$29,800", "HC", "Oct 31", "70%"],
    ["Collection route analytics", "AW", "won", "$36,200", "MO", "Sep 24", "100%"],
  ]
  const money = (v: string) => Number(v.replace(/[^0-9]/g, ""))
  const fmt = (n: number) => `$${n.toLocaleString("en-US")}`
  const byValue = [...deals].sort((x, y) => money(y[3]) - money(x[3]))

  // --- App shell ---------------------------------------------------------------------------------

  const screens = b.page("Screens")
  function shell(
    name: string,
    active: string,
    crumb: string,
    actions?: (into: { inst: string; at: string }) => void,
    title = name,
  ) {
    const scr = b.screen(screens, name, { dir: "row", w: 1440, h: 900, fill: c("bg") })
    b.use(scr, sidebar, {
      props: { h: FILL },
      set: { [active]: { args: { ...navArgs[active], state: "active" } } },
    })
    const main = b.col(scr, "Main", { w: FILL, h: FILL })
    b.use(main, topBar, {
      props: { w: FILL },
      args: { title, crumb },
      ...(actions ? { slots: { TbActs: actions } } : {}),
    })
    return b.col(main, "Content", { w: FILL, h: FILL, gap: 14, pad: [16, 20, 20, 20], clip: true })
  }
  function panel(parent: string, name: string, props: Record<string, unknown> = {}) {
    return b.col(parent, name, { w: FILL, ...card(), clip: true, ...props })
  }
  function panelHead(parent: string, title: string, right?: (row: string) => void) {
    const [name, count] = title.split("  ")
    const head = b.row(parent, "Header", { w: FILL, gap: 6, align: "center", pad: [9, 16, 7, 16] })
    const t = b.row(head, "Title", { w: FILL, gap: 6, align: "center" })
    b.text(t, name, b.ty("label", { weight: 600 }), ink)
    if (count) b.text(t, count, b.ty("mono", { size: 11.5 }), muted)
    right?.(head)
    return head
  }
  const newDeal = (into: { inst: string; at: string }) =>
    b.use(into, button, { args: { label: "New deal", icon: true } })
  const stageDays: Record<Stage, number> = {
    lead: 14,
    qualified: 21,
    proposal: 28,
    negotiation: 21,
    won: 0,
    lost: 0,
  }
  const ageOf = (d: (typeof deals)[number]) => {
    const i = deals.indexOf(d)
    return ((i * 7) % 17) + 3
  }
  function dealCardUse(parent: Parameters<typeof b.use>[0], d: (typeof deals)[number], extra = {}) {
    const [deal, co, stage, value, owner, close] = d
    const age = ageOf(d)
    const usual = stageDays[stage]
    const n = usual ? Math.min(100, Math.round((age / usual) * 100)) : 100
    const slow = usual > 0 && age > usual
    return b.use(parent, dealCard, {
      props: { w: FILL },
      args: {
        company: companies[co][0],
        logo: co,
        deal,
        value,
        close,
        initials: owner,
        age: usual ? `${age}d` : "won",
        ...extra,
      },
      set: {
        DcLogo: { args: { size: "xs", tone: companies[co][1] } },
        DcAv: { args: { size: "xs", tone: reps[owner][1] } },
        DcBar: { args: { tone: slow ? "warning" : usual ? "muted" : "accent" } },
        "DcBar/PbDone": { visible: true, w: { mode: "fill", weight: Math.max(n, 1) } },
        "DcBar/PbLeft": { visible: n < 100, w: { mode: "fill", weight: Math.max(100 - n, 1) } },
      },
    })
  }
  function dealRowUse(
    parent: string,
    d: (typeof deals)[number],
    extra: Record<string, unknown> = {},
  ) {
    const [deal, co, stage, value, owner, close, prob] = d
    const hide = (extra.hide as string[] | undefined) ?? []
    return b.use(parent, dealRow, {
      props: { w: FILL },
      args: {
        deal,
        company: companies[co][0],
        logo: co,
        stage: stageName[stage],
        value,
        owner: reps[owner][0],
        initials: owner,
        close,
        probability: prob,
        ...((extra.args as object) ?? {}),
      },
      set: {
        DrLogo: { args: { size: "xs", tone: companies[co][1] } },
        DrStage: { args: { stage, label: stageName[stage] } },
        DrOwnAv: { args: { size: "xs", tone: reps[owner][1] } },
        ...(hide.includes("DrCheck") ? { DrCheck: { props: { visible: false } } } : {}),
      },
      hide: hide.filter((k) => k !== "DrCheck"),
    })
  }
  const weightedOf = (list: (typeof deals)[number][]) =>
    Math.round(
      list.reduce((n, d) => n + (money(d[3]) * Number.parseInt(d[6], 10)) / 100, 0) / 100,
    ) * 100
  function tableHead(table: string, cols: readonly (readonly [string, number | null])[], pad = 16) {
    const th = b.row(table, "Head", {
      w: FILL,
      gap: 16,
      align: "center",
      pad: [7, pad],
      fill: c("surface"),
    })
    b.use(th, checkbox)
    for (const [t, w] of cols)
      b.text(
        th,
        t,
        b.ty("small", {
          weight: 500,
          ...(t === "Value" || t === "Probability" ? { align: "right" } : {}),
        }),
        muted,
        { ...(w ? { w, grow: "fixed-width" } : { w: FILL, grow: "fixed-width" }) },
      )
    return th
  }
  function stats(parent: string, items: readonly (readonly [string, string, string, string])[]) {
    const strip = b.row(parent, "KPIs", { w: FILL, ...card(), clip: true })
    items.forEach(([label, value, delta, trend], i) => {
      if (i > 0) b.divider(strip, c("border"), true)
      b.use(strip, kpi, { props: { w: FILL }, args: { label, value, delta, trend } })
    })
    return strip
  }

  // --- Cover -------------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Web app template",
    title: "Keel sales CRM",
    description:
      "Pipeline board, deals table, deal timeline, contacts, company profile and reports for a B2B sales team. Built from 24 components with light and dark tokens.",
    preview: (area) => {
      stats(area, [
        ["Open pipeline", "$1.13M", "+12%", "up"],
        ["Win rate", "31%", "+4 pts", "up"],
      ])
      const board = b.row(area, "Board", { w: FILL, h: FILL, gap: 16, align: "start" })
      for (const stage of ["proposal", "negotiation"] as const) {
        const list = byValue.filter((d) => d[2] === stage)
        b.use(board, stageColumn, {
          props: { w: FILL, h: FILL },
          args: {
            title: stageName[stage],
            count: String(list.length),
            total: fmt(list.reduce((n, d) => n + money(d[3]), 0)),
            weighted: fmt(weightedOf(list)),
            stage,
            showAdd: false,
          },
          slots: {
            ScCards: (into) => {
              for (const d of list)
                dealCardUse(into, d, {
                  ...(d[0] === "Ambulance routing" ? { health: "overdue" } : {}),
                  ...(d[0] === "Cold chain monitoring" || d[0] === "Fleet analytics rollout"
                    ? { flag: true }
                    : {}),
                })
            },
          },
        })
      }
    },
  })

  // --- Pipeline ----------------------------------------------------------------------------------
  {
    const content = shell("Pipeline", "SbNav1", "Sales", newDeal)
    const stages: Stage[] = ["lead", "qualified", "proposal", "negotiation", "won"]
    const inStage = (st: Stage) => byValue.filter((d) => d[2] === st)
    const open = stages.slice(0, 4).flatMap(inStage)
    const openTotal = open.reduce((n, d) => n + money(d[3]), 0)
    const bar = b.row(content, "Toolbar", { w: FILL, gap: 6, align: "center" })
    b.use(bar, searchField, { props: { w: 220 }, args: { placeholder: "Filter deals" } })
    b.use(bar, chip, { args: { label: "Owner", value: "Anyone" } })
    b.use(bar, chip, { args: { label: "Pipeline", value: "New business", state: "active" } })
    b.use(bar, chip, { args: { label: "Value", value: "Any" } })
    const sum = b.row(bar, "Summary", { w: FILL, gap: 14, justify: "end", align: "center" })
    for (const [label, value] of [
      [`${open.length} open`, fmt(openTotal)],
      ["Weighted", fmt(weightedOf(open))],
    ] as const) {
      const m = b.row(sum, label, { gap: 6, align: "center" })
      b.text(m, label, b.ty("small"), muted)
      b.text(m, value, b.ty("mono", { size: 12.5 }), ink)
    }
    b.use(sum, buttonSecondary, {
      args: { label: "Display", size: "sm", icon: true },
      set: { BtnIcon: { icon: "sliders-horizontal" } },
    })
    const board = b.row(content, "Board", { w: FILL, h: FILL, gap: 14 })
    for (const stage of stages) {
      const list = inStage(stage)
      b.use(board, stageColumn, {
        props: { w: FILL, h: FILL },
        args: {
          title: stageName[stage],
          count: String(list.length),
          total: fmt(list.reduce((n, d) => n + money(d[3]), 0)),
          weighted: fmt(weightedOf(list)),
          stage,
        },
        slots: {
          ScCards: (into) => {
            for (const d of list)
              dealCardUse(into, d, {
                ...(d[0] === "Fleet analytics rollout" || d[0] === "Cold chain monitoring"
                  ? { flag: true }
                  : {}),
                ...(d[0] === "Ambulance routing" ? { health: "overdue" } : {}),
              })
          },
        },
      })
    }
  }

  // --- Deals -------------------------------------------------------------------------------------
  {
    const content = shell("Deals", "SbNav2", "Sales", (into) => {
      b.use(into, buttonSecondary, {
        args: { label: "Export", icon: true },
        set: { BtnIcon: { icon: "download" } },
      })
      newDeal(into)
    })
    const bar = b.row(content, "Toolbar", { w: FILL, gap: 8, align: "end" })
    b.use(bar, tabs, {
      props: { w: FILL },
      args: {
        tab1: "All deals  48",
        tab2: "Open  31",
        tab3: "Won  12",
        tab4: "Lost  5",
        active: "first",
      },
    })
    b.use(bar, buttonSecondary, {
      args: { label: "Filter", icon: true },
      set: { BtnIcon: { icon: "list-filter" } },
    })
    b.use(bar, buttonSecondary, {
      args: { label: "Sorted by value", icon: true },
      set: { BtnIcon: { icon: "arrow-down-wide-narrow" } },
    })
    const table = panel(content, "Table")
    const bulk = b.row(table, "Selection", {
      w: FILL,
      gap: 8,
      align: "center",
      pad: [6, 16],
      fill: c("subtle"),
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    b.text(bulk, "2 selected", b.ty("label"), ink)
    b.text(bulk, "$228,400", b.ty("mono"), muted, { w: FILL, grow: "fixed-width" })
    b.use(bulk, buttonSecondary, { args: { label: "Change owner", size: "sm" } })
    b.use(bulk, buttonSecondary, { args: { label: "Move stage", size: "sm" } })
    b.use(bulk, button, { args: { label: "Delete", size: "sm", variant: "danger" } })
    tableHead(table, [
      ["Deal", null],
      ["Stage", 120],
      ["Value", 96],
      ["Owner", 160],
      ["Close date", 84],
      ["Probability", 64],
    ])
    byValue.slice(0, 18).forEach((d, i) => {
      dealRowUse(table, d, i === 0 || i === 3 ? { args: { selected: "yes" } } : {})
    })
    const foot = b.row(table, "Footer", {
      w: FILL,
      justify: "between",
      align: "center",
      pad: [8, 16],
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    b.text(foot, "1 to 18 of 48 deals", b.ty("small"), muted)
    const pager = b.row(foot, "Pager", { gap: 6 })
    b.use(pager, buttonSecondary, { args: { label: "Previous", size: "sm" } })
    b.use(pager, buttonSecondary, { args: { label: "Next", size: "sm" } })
  }

  // --- Deal detail -------------------------------------------------------------------------------
  {
    const content = shell(
      "Deal detail",
      "SbNav2",
      "Deals",
      (into) => {
        b.use(into, buttonSecondary, {
          args: { label: "Log activity", icon: true },
          set: { BtnIcon: { icon: "phone" } },
        })
        b.use(into, button, {
          args: { label: "Mark as won", icon: true },
          set: { BtnIcon: { icon: "trophy" } },
        })
      },
      "Cold chain monitoring",
    )
    const head = b.col(content, "Deal header", { w: FILL, gap: 14, pad: [4, 4, 0, 4] })
    const top = b.row(head, "Top", { w: FILL, gap: 12, align: "center" })
    b.use(top, logo, { args: { initials: "MG", size: "lg", tone: "green" } })
    const t = b.col(top, "Title", { w: FILL, gap: 3 })
    const tl = b.row(t, "Line", { gap: 10, align: "center" })
    b.text(tl, "Meridian Grocers: cold chain monitoring", b.ty("h1"), ink)
    b.use(tl, stageBadge, { args: { stage: "proposal", label: "Proposal" } })
    b.text(
      t,
      "640 refrigerated trailers, 3-year term. Created Aug 12 by Priya Raman.",
      b.ty("body"),
      muted,
    )
    const figures = b.row(top, "Figures", { gap: 24, align: "center" })
    for (const [label, value] of [
      ["Value", "$142,000"],
      ["Probability", "60%"],
      ["Expected close", "Nov 14"],
    ] as const) {
      const f = b.col(figures, label, { gap: 2 })
      b.text(f, label, b.ty("small"), muted)
      b.text(f, value, b.ty("mono", { size: 15, weight: 600 }), ink)
    }
    const steps = b.row(head, "Stages", { w: FILL, gap: 6 })
    for (const [label, state] of [
      ["Lead", "done"],
      ["Qualified", "done"],
      ["Proposal", "current"],
      ["Negotiation", "upcoming"],
      ["Closed", "upcoming"],
    ] as const)
      b.use(steps, stepper, { props: { w: FILL }, args: { label, state } })

    const body = panel(content, "Body", { h: FILL })
    const cols = b.row(body, "Columns", { w: FILL, h: FILL })
    const left = b.col(cols, "Activity", { w: FILL, h: FILL })
    const tabWrap = b.row(left, "Tabs", { w: FILL, pad: [2, 16, 0, 16] })
    b.use(tabWrap, tabs, {
      props: { w: FILL },
      args: {
        tab1: "Activity",
        tab2: "Emails  14",
        tab3: "Notes  3",
        tab4: "Files  6",
        active: "first",
      },
    })
    const composer = b.row(left, "Composer", {
      w: FILL,
      gap: 8,
      align: "center",
      pad: [14, 16, 6, 16],
    })
    b.use(composer, avatar, { args: { initials: "DW", size: "sm", tone: "amber" } })
    const box = b.row(composer, "Input", {
      w: FILL,
      gap: 8,
      align: "center",
      pad: [6, 10],
      radius: r("md"),
      fill: c("surface"),
      stroke: { paint: c("border-strong") },
    })
    b.text(box, "Add a note or @mention a teammate", b.ty("body"), muted, {
      w: FILL,
      grow: "fixed-width",
    })
    b.icon(box, "at-sign", 14, muted)
    b.icon(box, "paperclip", 14, muted)
    const list = b.col(left, "Timeline", { w: FILL, pad: [10, 16, 0, 16] })
    const events: [keyof typeof kinds, string, string, string, string][] = [
      [
        "email",
        "Sent revised proposal with 3-year pricing",
        "Moved sensors to a per-trailer rate of $74 per month and added the onboarding package at no charge. Laura asked for it before their budget review on the 21st.",
        "Priya Raman to Laura Bennett",
        "Today 9:40",
      ],
      [
        "call",
        "Call with Kwame Asante, 32 min",
        "Their pilot showed 11 temperature excursions on the Columbus to Dayton route that the current vendor missed. Wants alert routing to on-call dispatchers by region.",
        "Priya Raman",
        "Yesterday 16:05",
      ],
      [
        "meeting",
        "Security review with IT",
        "Ethan Brooks approved SSO through Okta. Open item: data residency for the two Canadian depots.",
        "Priya Raman, Dana Whitfield",
        "Oct 1",
      ],
      [
        "note",
        "Pilot results",
        "11 excursions caught across 40 trailers in 3 weeks. Kwame presents them to Laura on Oct 2.",
        "Priya Raman",
        "Sep 30",
      ],
      ["stage", "Stage changed from Qualified to Proposal", "", "Priya Raman", "Sep 26"],
      [
        "meeting",
        "Demo for the operations team",
        "Nine attendees from fleet and dispatch. Asked how alerts behave when a trailer loses signal in a tunnel.",
        "Priya Raman, Marcus Oyelaran",
        "Sep 19",
      ],
      ["stage", "Deal created from inbound demo request", "", "Priya Raman", "Aug 12"],
    ]
    events.forEach(([kind, title, body, meta, time], i) => {
      if (i === 0 || i === 3 || i === 6) {
        const g = b.row(list, "Group", { w: FILL, pad: [i === 0 ? 0 : 6, 0, 10, 0] })
        b.text(
          g,
          i === 0 ? "October" : i === 3 ? "September" : "August",
          b.ty("small", { weight: 500, size: 11 }),
          muted,
        )
      }
      b.use(list, timelineItem, {
        props: { w: FILL },
        args: {
          kind,
          title,
          body,
          meta,
          time,
          ...(body ? {} : { showBody: false }),
          ...(i === events.length - 1 ? { connector: false } : {}),
        },
      })
    })

    const right = b.col(cols, "Side", {
      w: 330,
      h: FILL,
      stroke: { paint: c("border"), width: { l: 1 } },
      fill: c("surface"),
    })
    panelHead(right, "Details", (row) =>
      b.use(row, iconButton, { args: { variant: "ghost" }, set: { IbIcon: { icon: "pencil" } } }),
    )
    const fields = b.col(right, "Fields", { w: FILL, pad: [0, 16, 10, 16] })
    for (const [label, value, icon] of [
      ["Owner", "Priya Raman", "user"],
      ["Pipeline", "New business", "kanban"],
      ["Product", "Cold chain sensors", "package"],
      ["Source", "Inbound demo request", "megaphone"],
      ["Competitor", "Thermaline", "swords"],
    ] as const)
      b.use(fields, fieldRow, {
        props: { w: FILL },
        args: { label, value },
        set: { FrIcon: { icon } },
      })
    const ppl = b.col(right, "Contacts", {
      w: FILL,
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    panelHead(ppl, "Contacts  3", (row) =>
      b.use(row, button, { args: { label: "Add", variant: "ghost", size: "sm" } }),
    )
    const pl = b.col(ppl, "People", { w: FILL, gap: 10, pad: [2, 16, 14, 16] })
    for (const [init, name, role, tone] of [
      ["LB", "Laura Bennett", "VP Supply Chain, decision maker", "rose"],
      ["KA", "Kwame Asante", "Director of Fleet Operations", "blue"],
      ["EB", "Ethan Brooks", "IT Security Lead", "violet"],
    ] as const) {
      const row = b.row(pl, name, { w: FILL, gap: 8, align: "center" })
      b.use(row, avatar, { args: { initials: init, size: "sm", tone } })
      const n = b.col(row, "Names", { w: FILL, gap: 0 })
      b.text(n, name, b.ty("label"), ink)
      b.text(n, role, b.ty("small", { size: 11.5 }), muted)
    }
    const tasks = b.col(right, "Next steps", {
      w: FILL,
      h: FILL,
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    panelHead(tasks, "Next steps  3")
    const tl2 = b.col(tasks, "Tasks", { w: FILL, pad: [0, 16, 8, 16] })
    for (const [title, due, state, tone] of [
      ["Send data residency answer to Ethan", "Today", "open", "overdue"],
      ["Book pricing call with procurement", "Oct 9", "open", "normal"],
      ["Share pilot excursion report", "Oct 2", "done", "normal"],
    ] as const)
      b.use(tl2, taskItem, { props: { w: FILL }, args: { title, due, state, dueTone: tone } })
  }

  // --- Contacts ----------------------------------------------------------------------------------
  {
    const content = shell("Contacts", "SbNav3", "Records", (into) =>
      b.use(into, button, {
        args: { label: "Add contact", icon: true },
        set: { BtnIcon: { icon: "user-plus" } },
      }),
    )
    const bar = b.row(content, "Toolbar", { w: FILL, gap: 6, align: "center" })
    b.use(bar, searchField, { props: { w: 260 }, args: { placeholder: "Search 1,284 contacts" } })
    b.use(bar, chip, { args: { label: "Company", value: "Any" } })
    b.use(bar, chip, { args: { label: "Owner", value: "Anyone" } })
    b.use(bar, chip, { args: { label: "Last activity", value: "Last 30 days", state: "active" } })
    const right = b.row(bar, "View", { w: FILL, justify: "end" })
    b.use(right, iconButton, { set: { IbIcon: { icon: "columns-3" } } })
    const table = panel(content, "Table")
    tableHead(table, [
      ["Name", null],
      ["Company", 190],
      ["Email", 230],
      ["Phone", 140],
      ["Last activity", 100],
      ["Owner", 48],
    ])
    const people: [string, string, string, Co, string, string, string, Rep, string][] = [
      [
        "LB",
        "Laura Bennett",
        "VP Supply Chain",
        "MG",
        "l.bennett@meridiangrocers.com",
        "+1 614 555 0182",
        "Today",
        "PR",
        "rose",
      ],
      [
        "KA",
        "Kwame Asante",
        "Director of Fleet Operations",
        "MG",
        "k.asante@meridiangrocers.com",
        "+1 614 555 0147",
        "Yesterday",
        "PR",
        "blue",
      ],
      [
        "IN",
        "Ingrid Nygaard",
        "Head of Operations",
        "HS",
        "ingrid.nygaard@halvorsen.no",
        "+47 22 55 01 34",
        "2 days ago",
        "MO",
        "green",
      ],
      [
        "RS",
        "Rafael Soto",
        "Chief Medical Officer",
        "PH",
        "rsoto@pinecresthealth.org",
        "+1 303 555 0119",
        "3 days ago",
        "DW",
        "amber",
      ],
      [
        "AM",
        "Amelia Mercer",
        "Procurement Director",
        "AP",
        "amelia.mercer@altamirapharma.com",
        "+1 919 555 0163",
        "Oct 1",
        "DW",
        "violet",
      ],
      [
        "JT",
        "Julian Tran",
        "VP Logistics",
        "TR",
        "julian.tran@tesseraretail.com",
        "+1 415 555 0107",
        "Sep 30",
        "MO",
        "blue",
      ],
      [
        "NO",
        "Nadia Okafor",
        "Transit Planning Manager",
        "ST",
        "nokafor@solanotransit.gov",
        "+1 707 555 0128",
        "Sep 29",
        "MO",
        "rose",
      ],
      [
        "BH",
        "Ben Hollis",
        "Fleet Manager",
        "OF",
        "ben.hollis@oakridgefoods.com",
        "+1 515 555 0174",
        "Sep 26",
        "PR",
        "green",
      ],
      [
        "CW",
        "Chloe Walsh",
        "Operations Lead",
        "FS",
        "chloe@fenwickshaw.co.uk",
        "+44 20 7946 0321",
        "Sep 24",
        "HC",
        "amber",
      ],
      [
        "DP",
        "Diego Paredes",
        "Signals Engineer",
        "CR",
        "d.paredes@copperline.com",
        "+1 312 555 0195",
        "Sep 22",
        "TL",
        "violet",
      ],
      [
        "MK",
        "Mei Kobayashi",
        "Harbor Master",
        "BM",
        "mei.k@bluefinmarine.com",
        "+1 206 555 0136",
        "Sep 19",
        "HC",
        "blue",
      ],
      [
        "SM",
        "Sofia Marquez",
        "Procurement Manager",
        "MG",
        "s.marquez@meridiangrocers.com",
        "+1 614 555 0129",
        "Sep 18",
        "PR",
        "amber",
      ],
      [
        "OA",
        "Olu Adeyemi",
        "Director of Maintenance",
        "NU",
        "olu.adeyemi@northgateutilities.com",
        "+1 602 555 0152",
        "Sep 16",
        "TL",
        "green",
      ],
      [
        "TV",
        "Tessa Vance",
        "General Manager",
        "LH",
        "tvance@larkspurhotels.com",
        "+1 702 555 0188",
        "Sep 12",
        "HC",
        "rose",
      ],
    ]
    for (const [init, name, title, co, email, phone, last, owner, tone] of people)
      b.use(table, contactRow, {
        props: { w: FILL },
        args: {
          name,
          title,
          initials: init,
          company: companies[co][0],
          logo: co,
          email,
          phone,
          last,
          owner,
        },
        set: {
          CrAv: { args: { size: "sm", tone } },
          CrLogo: { args: { size: "xs", tone: companies[co][1] } },
          CrOwn: { args: { size: "xs", tone: reps[owner][1] } },
        },
      })
    const foot = b.row(table, "Footer", {
      w: FILL,
      justify: "between",
      align: "center",
      pad: [8, 16],
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    b.text(foot, "1 to 14 of 1,284 contacts", b.ty("small"), muted)
    const pager = b.row(foot, "Pager", { gap: 6 })
    b.use(pager, buttonSecondary, { args: { label: "Previous", size: "sm" } })
    b.use(pager, buttonSecondary, { args: { label: "Next", size: "sm" } })
  }

  // --- Company profile ---------------------------------------------------------------------------
  {
    const content = shell(
      "Company profile",
      "SbNav4",
      "Companies",
      (into) => {
        b.use(into, buttonSecondary, {
          args: { label: "Visit website", icon: true },
          set: { BtnIcon: { icon: "external-link" } },
        })
        newDeal(into)
      },
      "Meridian Grocers",
    )
    const head = b.row(content, "Company header", {
      w: FILL,
      gap: 12,
      align: "center",
      pad: [4, 4, 0, 4],
    })
    b.use(head, logo, { args: { initials: "MG", size: "lg", tone: "green" } })
    const t = b.col(head, "Title", { w: FILL, gap: 4 })
    const tl = b.row(t, "Line", { gap: 10, align: "center" })
    b.text(tl, "Meridian Grocers", b.ty("h1"), ink)
    b.use(tl, badge, { args: { label: "Customer since 2024", tone: "accent" } })
    const meta = b.row(t, "Meta", { gap: 16, align: "center" })
    for (const [icon, text] of [
      ["store", "Grocery retail"],
      ["map-pin", "Columbus, Ohio"],
      ["users", "18,400 employees"],
      ["globe", "meridiangrocers.com"],
    ] as const) {
      const m = b.row(meta, text, { gap: 5, align: "center" })
      b.icon(m, icon, 13, muted)
      b.text(m, text, b.ty("body"), c("ink-2"))
    }
    const figures = b.row(head, "Figures", { gap: 24, align: "center" })
    for (const [label, value] of [
      ["Open pipeline", "$142,000"],
      ["Lifetime revenue", "$38,600"],
      ["Account owner", "Priya Raman"],
    ] as const) {
      const f = b.col(figures, label, { gap: 2 })
      b.text(f, label, b.ty("small"), muted)
      b.text(
        f,
        value,
        label === "Account owner"
          ? b.ty("label", { size: 15, weight: 600 })
          : b.ty("mono", { size: 15, weight: 600 }),
        ink,
      )
    }
    const cols = b.row(content, "Columns", { w: FILL, h: FILL, gap: 14, align: "start" })
    const left = panel(cols, "Left", { w: 330, h: FILL })
    panelHead(left, "About")
    const fields = b.col(left, "Fields", { w: FILL, pad: [0, 16, 10, 16] })
    for (const [label, value, icon] of [
      ["Industry", "Grocery retail", "store"],
      ["Stores", "412 in 6 states", "map-pin"],
      ["Fleet", "640 refrigerated trailers", "truck"],
      ["Revenue", "$4.2B a year", "banknote"],
      ["Vendor", "Thermaline, contract ends Jan 31", "swords"],
    ] as const)
      b.use(fields, fieldRow, {
        props: { w: FILL },
        args: { label, value },
        set: { FrIcon: { icon } },
      })
    const ppl = b.col(left, "People", { w: FILL, stroke: { paint: c("border"), width: { t: 1 } } })
    panelHead(ppl, "People  4")
    const pl = b.col(ppl, "List", { w: FILL, gap: 10, pad: [2, 16, 14, 16] })
    for (const [init, name, role, tone] of [
      ["LB", "Laura Bennett", "VP Supply Chain", "rose"],
      ["KA", "Kwame Asante", "Director of Fleet Operations", "blue"],
      ["SM", "Sofia Marquez", "Procurement Manager", "amber"],
      ["EB", "Ethan Brooks", "IT Security Lead", "violet"],
    ] as const) {
      const row = b.row(pl, name, { w: FILL, gap: 8, align: "center" })
      b.use(row, avatar, { args: { initials: init, size: "sm", tone } })
      const n = b.col(row, "Names", { w: FILL, gap: 0 })
      b.text(n, name, b.ty("label"), ink)
      b.text(n, role, b.ty("small", { size: 11.5 }), muted)
      b.icon(row, "mail", 14, muted)
    }
    const todo = b.col(left, "Tasks", {
      w: FILL,
      h: FILL,
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    panelHead(todo, "Open tasks  2")
    const taskList = b.col(todo, "List", { w: FILL, pad: [0, 16, 8, 16] })
    for (const [title, due, tone] of [
      ["Send data residency answer to Ethan", "Today", "overdue"],
      ["Book pricing call with procurement", "Oct 9", "normal"],
    ] as const)
      b.use(taskList, taskItem, { props: { w: FILL }, args: { title, due, dueTone: tone } })
    const mid = b.col(cols, "Right", { w: FILL, h: FILL, gap: 14 })
    const dl = panel(mid, "Deals")
    panelHead(dl, "Deals  3", (row) =>
      b.use(row, button, { args: { label: "View all", variant: "ghost", size: "sm" } }),
    )
    const mgDeals: (typeof deals)[number][] = [
      ["Cold chain monitoring", "MG", "proposal", "$142,000", "PR", "Nov 14", "60%"],
      ["Driver app pilot, Dayton depot", "MG", "won", "$24,600", "PR", "Mar 3", "100%"],
      ["Fuel card integration", "MG", "won", "$14,000", "DW", "Jun 18", "100%"],
    ]
    ;["3-year term, 640 trailers", "Pilot, Dayton depot", "Add-on"].forEach((sub, i) =>
      dealRowUse(dl, mgDeals[i], {
        hide: ["DrCheck", "DrOwner", "DrProb"],
        args: { company: sub },
      }),
    )
    const act = panel(mid, "Recent activity", { h: FILL })
    panelHead(act, "Recent activity")
    const list = b.col(act, "Timeline", { w: FILL, pad: [4, 16, 0, 16] })
    const evs: [keyof typeof kinds, string, string, string, string][] = [
      [
        "email",
        "Sent revised proposal with 3-year pricing",
        "Per-trailer rate of $74 per month, onboarding package included.",
        "Priya Raman to Laura Bennett",
        "Today 9:40",
      ],
      [
        "call",
        "Call with Kwame Asante, 32 min",
        "Wants alert routing to on-call dispatchers by region.",
        "Priya Raman",
        "Yesterday 16:05",
      ],
      [
        "note",
        "Budget review moved to Oct 21",
        "Laura needs the final pricing a week before. Proposal deadline is Oct 14.",
        "Dana Whitfield",
        "Oct 3",
      ],
      ["meeting", "Security review with IT", "", "Priya Raman, Dana Whitfield", "Oct 1"],
      [
        "meeting",
        "Pilot kickoff at the Dayton depot",
        "40 trailers fitted with sensors. Kwame's team owns alert routing during the pilot.",
        "Priya Raman",
        "Sep 8",
      ],
      ["stage", "Deal created from inbound demo request", "", "Priya Raman", "Aug 12"],
    ]
    evs.forEach(([kind, title, body, meta, time], i) => {
      b.use(list, timelineItem, {
        props: { w: FILL },
        args: {
          kind,
          title,
          body,
          meta,
          time,
          ...(body ? {} : { showBody: false }),
          ...(i === evs.length - 1 ? { connector: false } : {}),
        },
      })
    })
  }

  // --- Reports -----------------------------------------------------------------------------------
  {
    const content = shell("Reports", "SbNav6", "Work", (into) => {
      b.use(into, buttonSecondary, {
        args: { label: "Q3 2026", icon: true },
        set: { BtnIcon: { icon: "calendar" } },
      })
      b.use(into, buttonSecondary, {
        args: { label: "Export", icon: true },
        set: { BtnIcon: { icon: "download" } },
      })
    })
    stats(content, [
      ["Revenue won", "$612,400", "+18%", "up"],
      ["Open pipeline", "$1.13M", "+12%", "up"],
      ["Win rate", "31%", "+4 pts", "up"],
      ["Average sales cycle", "47 days", "+6 days", "down"],
    ])

    const mid = b.row(content, "Middle", { w: FILL, h: 380, gap: 14 })
    const chart = panel(mid, "Revenue by month", { h: FILL })
    panelHead(chart, "Revenue won by month", (row) => {
      const lg = b.row(row, "Legend", { gap: 12, align: "center" })
      for (const [label, tone] of [
        ["Won", "ink-2"],
        ["Target", "border-strong"],
      ] as const) {
        const l = b.row(lg, label, { gap: 5, align: "center" })
        b.rect(l, "Key", { w: 8, h: 8, radius: 2, fill: c(tone) })
        b.text(l, label, b.ty("small", { size: 11.5 }), muted)
      }
    })
    const bars = b.row(chart, "Bars", {
      w: FILL,
      h: FILL,
      gap: 14,
      align: "end",
      pad: [4, 16, 12, 16],
    })
    const months: [string, number, number][] = [
      ["Apr", 142, 180],
      ["May", 168, 180],
      ["Jun", 205, 190],
      ["Jul", 176, 200],
      ["Aug", 194, 200],
      ["Sep", 242, 210],
    ]
    const max = 250
    for (const [m, won, target] of months) {
      const col = b.col(bars, m, { w: FILL, gap: 6, align: "center" })
      b.text(col, `$${won}k`, b.ty("mono", { size: 11 }), m === "Sep" ? ink : muted)
      const pair = b.row(col, "Pair", { gap: 3, align: "end", justify: "center" })
      b.rect(pair, "Won", {
        w: 26,
        h: Math.round((won / max) * 245),
        radius: [3, 3, 0, 0],
        fill: m === "Sep" ? c("accent") : c("border-strong"),
      })
      b.rect(pair, "Target", {
        w: 8,
        h: Math.round((target / max) * 245),
        radius: [2, 2, 0, 0],
        fill: c("subtle"),
        stroke: { paint: c("border") },
      })
      b.text(col, m, b.ty("small", { size: 11.5 }), muted)
    }
    const funnel = panel(mid, "Funnel", { w: 400, h: FILL })
    panelHead(funnel, "Pipeline by stage")
    const fl = b.col(funnel, "Stages", { w: FILL, h: FILL, gap: 16, pad: [4, 16, 14, 16] })
    for (const [stage, count, value, n, conv] of [
      ["lead", "14", "$186k", 100, ""],
      ["qualified", "9", "$412k", 64, "64%"],
      ["proposal", "5", "$318k", 36, "56%"],
      ["negotiation", "3", "$214k", 21, "60%"],
      ["won", "3", "$100k", 12, ""],
    ] as const) {
      const row = b.col(fl, stageName[stage], { w: FILL, gap: 5 })
      const line = b.row(row, "Line", { w: FILL, gap: 8, align: "center" })
      b.text(line, stageName[stage], b.ty("label"), ink, { w: FILL, grow: "fixed-width" })
      b.text(line, `${count} deals`, b.ty("small"), muted)
      if (conv)
        b.text(line, `${conv} advance`, b.ty("mono", { size: 10.5 }), muted, { name: "Conversion" })
      b.text(line, value, b.ty("mono", { align: "right" }), ink, {
        w: 48,
        grow: "fixed-width",
      })
      const tone = {
        lead: "muted",
        qualified: "info",
        proposal: "violet",
        negotiation: "warning",
        won: "accent",
      }[stage]
      b.use(row, progress, { props: { w: FILL }, args: { tone }, set: pct(n) })
    }
    const fc = b.row(funnel, "Forecast", {
      w: FILL,
      gap: 8,
      align: "center",
      pad: [9, 16],
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    b.text(fc, "Weighted forecast for Q4", b.ty("small"), muted, {
      w: FILL,
      grow: "fixed-width",
    })
    b.text(fc, "$498,200", b.ty("mono", { size: 12.5 }), ink)

    const bottom = panel(content, "Leaderboard", { h: FILL })
    panelHead(bottom, "Quota attainment, Q3")
    const th = b.row(bottom, "Head", { w: FILL, gap: 20, pad: [6, 16], fill: c("surface") })
    for (const [t, w] of [
      ["Rep", null],
      ["Deals won", 90],
      ["Revenue", 110],
      ["Quota", 360],
      ["Win rate", 80],
    ] as const)
      b.text(th, t, b.ty("small", { weight: 500 }), muted, {
        ...(w ? { w, grow: "fixed-width" } : { w: FILL, grow: "fixed-width" }),
      })
    for (const [who, won, rev, n, rate] of [
      ["MO", "9", "$184,200", 92, "38%"],
      ["PR", "8", "$161,900", 81, "34%"],
      ["DW", "6", "$128,500", 64, "29%"],
      ["HC", "5", "$83,600", 56, "27%"],
      ["TL", "3", "$54,200", 36, "22%"],
    ] as const) {
      const row = b.row(bottom, reps[who][0], {
        w: FILL,
        gap: 20,
        align: "center",
        pad: [6, 16],
        stroke: { paint: c("border"), width: { t: 1 } },
      })
      const nm = b.row(row, "Rep", { w: FILL, gap: 8, align: "center" })
      b.use(nm, avatar, { args: { initials: who, size: "xs", tone: reps[who][1] } })
      b.text(nm, reps[who][0], b.ty("label"), ink)
      b.text(row, won, b.ty("mono"), c("ink-2"), { w: 90, grow: "fixed-width" })
      b.text(row, rev, b.ty("mono"), ink, { w: 110, grow: "fixed-width" })
      const q = b.row(row, "Quota", { w: 360, gap: 10, align: "center" })
      b.use(q, progress, {
        props: { w: FILL },
        args: { tone: n >= 80 ? "accent" : n >= 50 ? "info" : "warning" },
        set: pct(n),
      })
      b.text(q, `${n}%`, b.ty("mono", { size: 11 }), c("ink-2"), { w: 36, grow: "fixed-width" })
      b.text(row, rate, b.ty("mono"), c("ink-2"), { w: 80, grow: "fixed-width" })
    }
  }
}
