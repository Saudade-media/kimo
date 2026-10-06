/**
 * Fieldwork: the web app of a fictional project tracker for design and engineering studios.
 * Screens (1440×900 app frames): Overview, Projects, Project board, Team, Settings, Billing.
 */
import { FILL, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "saas-app",
  name: "Fieldwork project tracker",
  category: "Web app",
  description:
    "Six-screen SaaS web app for a studio project tracker: dashboard, projects, kanban board, team, settings and billing.",
  prefix: "sa",
  build,
}

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F6F7F9", "#0D0F14"],
      surface: ["#FFFFFF", "#151821"],
      subtle: ["#F0F2F5", "#1B1F2A"],
      sidebar: ["#FBFBFC", "#11141B"],
      ink: ["#111827", "#F1F3F7"],
      "ink-2": ["#374151", "#C9CFDA"],
      muted: ["#6B7280", "#8E97A8"],
      border: ["#E5E7EB", "#262B37"],
      accent: ["#5B4BDB", "#9D90FF"],
      "accent-soft": ["#EEEBFF", "#231F45"],
      "on-accent": ["#FFFFFF", "#0D0F14"],
      success: ["#15803D", "#4ADE80"],
      "success-soft": ["#E7F6EC", "#12301E"],
      warning: ["#B45309", "#FBBF24"],
      "warning-soft": ["#FDF3E1", "#3A2A0B"],
      danger: ["#C2410C", "#FB923C"],
      "danger-soft": ["#FDEDE6", "#3A1A0D"],
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
      "space/8": 32,
      "radius/sm": 6,
      "radius/md": 8,
      "radius/lg": 12,
      "radius/pill": 999,
      "size/sidebar": 248,
      "size/topbar": 64,
    },
    type: {
      display: { font: "Inter", size: 56, weight: 700, lineHeight: 1.05, letterSpacing: -1.6 },
      h1: { font: "Inter", size: 24, weight: 700, lineHeight: 1.25, letterSpacing: -0.4 },
      heading: { font: "Inter", size: 18, weight: 600, lineHeight: 1.3, letterSpacing: -0.2 },
      metric: { font: "Inter", size: 28, weight: 700, lineHeight: 1.15, letterSpacing: -0.6 },
      body: { font: "Inter", size: 14, weight: 400, lineHeight: 1.5 },
      label: { font: "Inter", size: 14, weight: 600, lineHeight: 1.3 },
      small: { font: "Inter", size: 12, weight: 400, lineHeight: 1.45 },
      mono: { font: "JetBrains Mono", size: 12, weight: 500, lineHeight: 1.4 },
    },
    shadows: {
      card: [
        { kind: "shadow", x: 0, y: 1, blur: 2, color: "#1118270D" },
        { kind: "shadow", x: 0, y: 4, blur: 12, spread: -4, color: "#11182714" },
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
      description: "Primary, secondary, ghost or danger; sm or md.",
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
            "root.fill": c("bg"),
            "root.stroke": { paint: c("bg") },
            "BtnLabel.fill": c("ink-2"),
            "BtnIcon.color": c("ink-2"),
          },
          danger: {
            "root.fill": c("danger-soft"),
            "root.stroke": { paint: c("danger-soft") },
            "BtnLabel.fill": c("danger"),
            "BtnIcon.color": c("danger"),
          },
        }),
        size: p.variants({
          sm: { "root.layout/pad": [6, 10], "BtnLabel.style/size": 13 },
          md: { "root.layout/pad": [8, 14], "BtnLabel.style/size": 14 },
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
      b.icon(root, "plus", 16, c("on-accent"), { key: "BtnIcon", visible: false })
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
          neutral: {
            "root.fill": c("subtle"),
            "BadgeLbl.fill": c("ink-2"),
            "BadgeDot.fill": muted,
          },
          accent: {
            "root.fill": c("accent-soft"),
            "BadgeLbl.fill": c("accent"),
            "BadgeDot.fill": c("accent"),
          },
          success: {
            "root.fill": c("success-soft"),
            "BadgeLbl.fill": c("success"),
            "BadgeDot.fill": c("success"),
          },
          warning: {
            "root.fill": c("warning-soft"),
            "BadgeLbl.fill": c("warning"),
            "BadgeDot.fill": c("warning"),
          },
          danger: {
            "root.fill": c("danger-soft"),
            "BadgeLbl.fill": c("danger"),
            "BadgeDot.fill": c("danger"),
          },
        }),
      },
      root: {
        dir: "row",
        gap: 6,
        align: "center",
        pad: [3, 8],
        radius: r("pill"),
        fill: c("subtle"),
      },
    },
    (root) => {
      b.ellipse(root, "Dot", { key: "BadgeDot", w: 6, h: 6, fill: muted })
      b.text(root, "Badge", b.ty("small", { weight: 600 }), c("ink-2"), {
        key: "BadgeLbl",
        name: "Label",
      })
    },
  )
  const badgeSuccess = b.derive(badge, "Badge/Success", "BdgOk", {
    section: "Status",
    args: { tone: "success", label: "On track" },
  })
  const badgeWarning = b.derive(badge, "Badge/Warning", "BdgWarn", {
    section: "Status",
    args: { tone: "warning", label: "At risk" },
  })
  const badgeDanger = b.derive(badge, "Badge/Danger", "BdgDanger", {
    section: "Status",
    args: { tone: "danger", label: "Blocked" },
  })
  const badgeAccent = b.derive(badge, "Badge/Accent", "BdgAccent", {
    section: "Status",
    args: { tone: "accent", label: "Planning" },
  })
  const tones = {
    ok: badgeSuccess,
    warn: badgeWarning,
    bad: badgeDanger,
    plan: badgeAccent,
    neutral: badge,
  } as const

  const avatar = b.component(
    "Avatar",
    {
      key: "Avatar",
      section: "Status",
      props: {
        initials: p.text("AvInit", "CD"),
        size: p.variants({
          xs: { "root.w": 22, "root.h": 22, "AvInit.style/size": 9 },
          sm: { "root.w": 28, "root.h": 28, "AvInit.style/size": 11 },
          md: { "root.w": 36, "root.h": 36, "AvInit.style/size": 13 },
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
        w: 36,
        h: 36,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("tone-1"),
        stroke: { paint: c("surface"), width: 2 },
      },
    },
    (root) =>
      b.text(root, "CD", b.ty("label", { size: 13 }), ink, { key: "AvInit", name: "Initials" }),
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
          success: { "PbDone.fill": c("success") },
          warning: { "PbDone.fill": c("warning") },
          danger: { "PbDone.fill": c("danger") },
        }),
      },
      root: { dir: "row", w: 160, h: 6, radius: r("pill"), fill: c("subtle"), clip: true },
    },
    (root) => {
      b.rect(root, "Done", {
        key: "PbDone",
        w: { mode: "fill", weight: 50 },
        h: 6,
        fill: c("accent"),
      })
      b.rect(root, "Left", {
        key: "PbLeft",
        w: { mode: "fill", weight: 50 },
        h: 6,
        fill: c("subtle"),
      })
    },
  )
  const pct = (n: number) => ({
    PbDone: { visible: n > 0, w: { mode: "fill", weight: Math.max(n, 1) } },
    PbLeft: { visible: n < 100, w: { mode: "fill", weight: Math.max(100 - n, 1) } },
  })

  const toggle = b.component(
    "Toggle",
    {
      key: "Toggle",
      section: "Forms",
      props: {
        state: p.variants({
          on: { "root.fill": c("accent"), "root.layout/justify": "end" },
          off: { "root.fill": c("border"), "root.layout/justify": "start" },
        }),
      },
      root: {
        dir: "row",
        w: 36,
        h: 20,
        pad: 2,
        justify: "end",
        radius: r("pill"),
        fill: c("accent"),
      },
    },
    (root) => b.ellipse(root, "Knob", { w: 16, h: 16, fill: c("surface") }),
  )
  const toggleOff = b.derive(toggle, "Toggle/Off", "ToggleOff", {
    section: "Forms",
    args: { state: "off" },
  })

  const input = b.component(
    "Input",
    {
      key: "Input",
      section: "Forms",
      props: {
        label: p.text("InLbl", "Label"),
        value: p.text("InVal", "Value"),
        hint: p.text("InHint", "Hint"),
        showHint: p.bool("InHint", false),
      },
      root: { dir: "column", w: 360, gap: 6 },
    },
    (root) => {
      b.text(root, "Label", b.ty("label", { size: 13 }), c("ink-2"), { key: "InLbl" })
      const field = b.row(root, "Field", {
        w: FILL,
        pad: [9, 12],
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      })
      b.text(field, "Value", b.ty("body"), ink, { key: "InVal" })
      b.text(root, "Hint", b.ty("small"), muted, { key: "InHint", visible: false })
    },
  )

  const tabsLabels = ["Tab one", "Tab two", "Tab three", "Tab four"]
  const tabActive = (i: number) =>
    Object.fromEntries(
      tabsLabels.flatMap((_, j) => [
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
      },
      root: { dir: "row", w: 600, gap: 4, stroke: { paint: c("border"), width: { b: 1 } } },
    },
    (root) => {
      tabsLabels.forEach((t, i) => {
        const item = b.row(root, t, {
          key: `TabI${i + 1}`,
          pad: [10, 12],
          stroke: { paint: c("accent"), width: { b: i === 0 ? 2 : 0 } },
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
        w: 216,
        gap: 10,
        align: "center",
        pad: [7, 10],
        radius: r("md"),
        fill: c("sidebar"),
      },
    },
    (root) => {
      b.icon(root, "layout-dashboard", 18, muted, { key: "NavIcon" })
      b.text(root, "Item", b.ty("label", { weight: 500 }), c("ink-2"), {
        key: "NavLbl",
        w: FILL,
        grow: "fixed-width",
        name: "Label",
      })
      b.text(root, "0", b.ty("small", { weight: 600 }), muted, {
        key: "NavCnt",
        visible: false,
        name: "Count",
      })
    },
  )

  const navs = [
    ["Overview", "layout-dashboard", ""],
    ["Projects", "folder-kanban", ""],
    ["My tasks", "circle-check", "8"],
    ["Inbox", "inbox", "3"],
    ["Team", "users", ""],
    ["Reports", "chart-column", ""],
  ] as const
  const navArgs: Record<string, Record<string, string | boolean>> = {
    SbSet: { label: "Settings" },
    SbBill: { label: "Billing" },
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
      b.icon(mark, "kanban", 15, c("on-accent"))
      b.text(brand, "Fieldwork", b.ty("heading", { size: 17, weight: 700 }), ink)
      const ws = b.row(top, "Workspace", {
        w: FILL,
        gap: 10,
        align: "center",
        pad: [8, 10],
        ...card({ radius: r("md") }),
      })
      const wsMark = b.row(ws, "Logo", {
        w: 24,
        h: 24,
        radius: 6,
        fill: c("tone-2"),
        align: "center",
        justify: "center",
      })
      b.text(wsMark, "NB", b.ty("small", { size: 10, weight: 700 }), ink)
      b.text(ws, "Northbeam Studio", b.ty("label", { size: 13 }), ink, {
        w: FILL,
        grow: "fixed-width",
      })
      b.icon(ws, "chevrons-up-down", 14, muted)
      const nav = b.col(top, "Navigation", { w: FILL, gap: 2 })
      for (const [i, [label, icon, count]] of navs.entries())
        b.use(nav, navItem, {
          key: `SbNav${i + 1}`,
          props: { w: FILL },
          args: { label, ...(count ? { count, showCount: true } : {}) },
          set: { NavIcon: { icon } },
        })
      const fav = b.col(top, "Favorites", { w: FILL, gap: 2 })
      b.text(fav, "Pinned projects", b.ty("small", { weight: 600 }), muted, { name: "Section" })
      for (const label of ["Fernway checkout", "Halden onboarding"])
        b.use(fav, navItem, {
          props: { w: FILL },
          args: { label },
          set: { NavIcon: { icon: "folder" } },
        })
      const bottom = b.col(root, "Bottom", { w: FILL, gap: 2 })
      b.use(bottom, navItem, {
        key: "SbSet",
        props: { w: FILL },
        args: { label: "Settings" },
        set: { NavIcon: { icon: "settings" } },
      })
      b.use(bottom, navItem, {
        key: "SbBill",
        props: { w: FILL },
        args: { label: "Billing" },
        set: { NavIcon: { icon: "credit-card" } },
      })
      const me = b.row(bottom, "Account", {
        w: FILL,
        gap: 10,
        align: "center",
        pad: [12, 6, 0, 6],
        stroke: { paint: c("border"), width: { t: 1 } },
      })
      b.use(me, avatar, { args: { initials: "CD", size: "sm", tone: "rose" } })
      const who = b.col(me, "Names", { w: FILL, gap: 0 })
      b.text(who, "Clara Dumont", b.ty("label", { size: 13 }), ink)
      b.text(who, "clara@northbeam.studio", b.ty("small"), muted)
    },
  )

  const topBar = b.component(
    "Top bar",
    {
      key: "TopBar",
      section: "Navigation",
      props: { title: p.text("TbTitle", "Page"), actions: p.slot("TbActs") },
      root: {
        dir: "row",
        w: 1192,
        h: b.n("size/topbar"),
        gap: 16,
        align: "center",
        pad: [0, 32],
        fill: c("surface"),
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.text(root, "Page", b.ty("h1", { size: 20 }), ink, {
        key: "TbTitle",
        name: "Title",
        w: FILL,
        grow: "fixed-width",
      })
      const search = b.row(root, "Search", {
        w: 300,
        gap: 8,
        align: "center",
        pad: [8, 12],
        radius: r("md"),
        fill: c("subtle"),
      })
      b.icon(search, "search", 16, muted)
      b.text(search, "Search projects and tasks", b.ty("body"), muted, {
        w: FILL,
        grow: "fixed-width",
      })
      b.text(search, "Ctrl K", b.ty("mono", { size: 11 }), muted)
      b.row(root, "Actions", {
        key: "TbActs",
        gap: 8,
        align: "center",
        slot: { suggested: [button, buttonSecondary] },
      })
      const bell = b.row(root, "Notifications", {
        w: 36,
        h: 36,
        radius: r("md"),
        align: "center",
        justify: "center",
        stroke: { paint: c("border") },
      })
      b.icon(bell, "bell", 18, c("ink-2"))
      b.use(root, avatar, { args: { initials: "CD", tone: "rose" } })
    },
  )

  // --- Components: data ------------------------------------------------------------------------

  const statCard = b.component(
    "Stat card",
    {
      key: "StatCard",
      section: "Data",
      props: {
        label: p.text("StLbl", "Metric"),
        value: p.text("StVal", "0"),
        delta: p.text("StDelta/BadgeLbl", "+0%"),
        trend: p.swap("StDelta", badgeSuccess),
        caption: p.text("StCap", "vs last month"),
      },
      root: { dir: "column", w: 264, gap: 8, pad: 20, ...card(), effects: b.shadow("card") },
    },
    (root) => {
      const top = b.row(root, "Header", { w: FILL, gap: 8, align: "center" })
      b.text(top, "Metric", b.ty("body", { weight: 500 }), muted, {
        key: "StLbl",
        w: FILL,
        grow: "fixed-width",
      })
      b.icon(top, "folder-kanban", 18, muted, { key: "StIcon" })
      b.text(root, "0", b.ty("metric"), ink, { key: "StVal", name: "Value" })
      const foot = b.row(root, "Footer", { gap: 8, align: "center" })
      b.use(foot, badgeSuccess, { key: "StDelta", args: { label: "+0%" } })
      b.text(foot, "vs last month", b.ty("small"), muted, { key: "StCap" })
    },
  )

  const projectRow = b.component(
    "Project row",
    {
      key: "ProjRow",
      section: "Data",
      description: "Table row. Set the progress weights with the Progress bar's Done and Left.",
      props: {
        name: p.text("PrName", "Project"),
        client: p.text("PrClient", "Client"),
        status: p.swap("PrStatus", badgeSuccess),
        statusLabel: p.text("PrStatus/BadgeLbl", "On track"),
        percent: p.text("PrPct", "50%"),
        owner: p.text("PrOwnName", "Owner"),
        initials: p.text("PrOwner/AvInit", "IK"),
        due: p.text("PrDue", "Nov 14"),
      },
      root: {
        dir: "row",
        w: 1000,
        gap: 20,
        align: "center",
        pad: [14, 20],
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      const names = b.col(root, "Names", { w: FILL, gap: 2 })
      b.text(names, "Project", b.ty("label"), ink, { key: "PrName" })
      b.text(names, "Client", b.ty("small"), muted, { key: "PrClient" })
      const st = b.row(root, "Status", { w: 110 })
      b.use(st, badgeSuccess, { key: "PrStatus" })
      const prog = b.row(root, "Progress", { w: 210, gap: 10, align: "center" })
      b.use(prog, progress, { key: "PrBar" })
      b.text(prog, "50%", b.ty("small", { weight: 600 }), c("ink-2"), {
        key: "PrPct",
        w: 40,
        grow: "fixed-width",
      })
      const own = b.row(root, "Owner", { w: 170, gap: 8, align: "center" })
      b.use(own, avatar, { key: "PrOwner", args: { size: "sm" } })
      b.text(own, "Owner", b.ty("body"), c("ink-2"), { key: "PrOwnName" })
      b.text(root, "Nov 14", b.ty("body", { align: "right" }), muted, {
        key: "PrDue",
        w: 80,
        grow: "fixed-width",
      })
    },
  )

  const taskCard = b.component(
    "Task card",
    {
      key: "Task",
      section: "Board",
      props: {
        title: p.text("TkTitle", "Task"),
        tag: p.text("TkTag/BadgeLbl", "Design"),
        tagStyle: p.swap("TkTag", badge),
        due: p.text("TkDue", "Oct 9"),
        comments: p.text("TkCmt", "0"),
        files: p.text("TkFiles", "0"),
        initials: p.text("TkAv/AvInit", "TN"),
        priority: p.variants({
          high: { "TkFlag.color": c("danger") },
          medium: { "TkFlag.color": c("warning") },
          low: { "TkFlag.color": muted },
        }),
      },
      root: {
        dir: "column",
        w: 280,
        gap: 10,
        pad: 14,
        ...card({ radius: r("md") }),
        effects: b.shadow("card"),
      },
    },
    (root) => {
      const top = b.row(root, "Tags", { w: FILL, justify: "between", align: "center" })
      b.use(top, badge, { key: "TkTag", args: { label: "Design" } })
      b.icon(top, "flag", 14, c("warning"), { key: "TkFlag" })
      b.para(root, "Task", b.ty("label", { lineHeight: 1.4 }), ink, {
        key: "TkTitle",
        name: "Title",
      })
      const foot = b.row(root, "Footer", { w: FILL, gap: 12, align: "center" })
      b.use(foot, avatar, { key: "TkAv", args: { size: "xs", initials: "TN" } })
      const meta = b.row(foot, "Meta", { w: FILL, gap: 10, align: "center" })
      for (const [icon, key] of [
        ["message-square", "TkCmt"],
        ["paperclip", "TkFiles"],
      ] as const) {
        const m = b.row(meta, icon, { gap: 4, align: "center" })
        b.icon(m, icon, 13, muted)
        b.text(m, "0", b.ty("small"), muted, { key })
      }
      const due = b.row(foot, "Due", { gap: 4, align: "center" })
      b.icon(due, "calendar", 13, muted)
      b.text(due, "Oct 9", b.ty("small"), muted, { key: "TkDue" })
    },
  )

  const column = b.component(
    "Board column",
    {
      key: "Column",
      section: "Board",
      description: "Fill the Cards slot with Task cards.",
      props: {
        title: p.text("ColTitle", "To do"),
        count: p.text("ColCount", "0"),
        cards: p.slot("ColCards"),
        tone: p.variants({
          todo: { "ColDot.fill": muted },
          doing: { "ColDot.fill": c("accent") },
          review: { "ColDot.fill": c("warning") },
          done: { "ColDot.fill": c("success") },
        }),
      },
      root: { dir: "column", w: 304, gap: 12, pad: 12, radius: r("lg"), fill: c("subtle") },
    },
    (root) => {
      const head = b.row(root, "Header", { w: FILL, gap: 8, align: "center", pad: [2, 4] })
      b.ellipse(head, "Dot", { key: "ColDot", w: 8, h: 8, fill: muted })
      b.text(head, "To do", b.ty("label"), ink, { key: "ColTitle" })
      b.text(head, "0", b.ty("small", { weight: 600 }), muted, {
        key: "ColCount",
        w: FILL,
        grow: "fixed-width",
      })
      b.icon(head, "plus", 16, muted)
      b.col(root, "Cards", { key: "ColCards", w: FILL, gap: 10, slot: { suggested: [taskCard] } })
    },
  )

  const memberRow = b.component(
    "Member row",
    {
      key: "Member",
      section: "Data",
      props: {
        name: p.text("MrName", "Name"),
        email: p.text("MrEmail", "name@northbeam.studio"),
        initials: p.text("MrAv/AvInit", "IK"),
        title: p.text("MrTitle", "Role"),
        access: p.text("MrAccess/BadgeLbl", "Member"),
        accessStyle: p.swap("MrAccess", badge),
        seen: p.text("MrSeen", "Today"),
      },
      root: {
        dir: "row",
        w: 1000,
        gap: 20,
        align: "center",
        pad: [12, 20],
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      b.use(root, avatar, { key: "MrAv" })
      const names = b.col(root, "Names", { w: FILL, gap: 2 })
      b.text(names, "Name", b.ty("label"), ink, { key: "MrName" })
      b.text(names, "name@northbeam.studio", b.ty("small"), muted, { key: "MrEmail" })
      b.text(root, "Role", b.ty("body"), c("ink-2"), {
        key: "MrTitle",
        w: 220,
        grow: "fixed-width",
      })
      const acc = b.row(root, "Access", { w: 100 })
      b.use(acc, badge, { key: "MrAccess", args: { label: "Member" } })
      b.text(root, "Today", b.ty("body"), muted, { key: "MrSeen", w: 120, grow: "fixed-width" })
      b.icon(root, "ellipsis", 18, muted)
    },
  )

  const activity = b.component(
    "Activity item",
    {
      key: "Activity",
      section: "Data",
      props: {
        text: p.text("AcText", "Something happened."),
        time: p.text("AcTime", "2 min ago"),
        initials: p.text("AcAv/AvInit", "TN"),
      },
      root: { dir: "row", w: 320, gap: 12, align: "start" },
    },
    (root) => {
      b.use(root, avatar, { key: "AcAv", args: { size: "sm" } })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.para(t, "Something happened.", b.ty("body", { size: 13 }), c("ink-2"), { key: "AcText" })
      b.text(t, "2 min ago", b.ty("small"), muted, { key: "AcTime" })
    },
  )

  const settingRow = b.component(
    "Setting row",
    {
      key: "Setting",
      section: "Forms",
      props: {
        title: p.text("SrTitle", "Setting"),
        description: p.text("SrDesc", "What it changes."),
        toggle: p.swap("SrToggle", toggle),
      },
      root: {
        dir: "row",
        w: 560,
        gap: 24,
        align: "center",
        pad: [14, 0],
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Setting", b.ty("label"), ink, { key: "SrTitle" })
      b.para(t, "What it changes.", b.ty("body", { size: 13 }), muted, { key: "SrDesc" })
      b.use(root, toggle, { key: "SrToggle" })
    },
  )

  const planCard = b.component(
    "Plan card",
    {
      key: "Plan",
      section: "Billing",
      props: {
        plan: p.text("PlName", "Plan"),
        price: p.text("PlPrice", "$0"),
        period: p.text("PlPer", "per seat / month"),
        description: p.text("PlDesc", "What the plan includes."),
        current: p.bool("PlCur", true),
        cta: p.text("PlCta/BtnLabel", "Change plan"),
      },
      root: { dir: "column", w: 360, gap: 14, pad: 24, ...card(), effects: b.shadow("card") },
    },
    (root) => {
      const top = b.row(root, "Header", { w: FILL, justify: "between", align: "center" })
      b.text(top, "Plan", b.ty("heading"), ink, { key: "PlName" })
      const cur = b.row(top, "Current", { key: "PlCur" })
      b.use(cur, badgeAccent, { args: { label: "Current plan" } })
      const price = b.row(root, "Price", { w: FILL, gap: 6, align: "end" })
      b.text(price, "$0", b.ty("metric"), ink, { key: "PlPrice" })
      b.para(price, "per seat / month", b.ty("small"), muted, { key: "PlPer" })
      b.para(root, "What the plan includes.", b.ty("body"), muted, { key: "PlDesc" })
      b.use(root, buttonSecondary, {
        key: "PlCta",
        props: { w: FILL },
        args: { label: "Change plan" },
      })
    },
  )

  const invoiceRow = b.component(
    "Invoice row",
    {
      key: "Invoice",
      section: "Billing",
      props: {
        number: p.text("IvNo", "INV-0000"),
        date: p.text("IvDate", "Oct 1, 2026"),
        amount: p.text("IvAmt", "$0.00"),
        status: p.text("IvStatus/BadgeLbl", "Paid"),
      },
      root: {
        dir: "row",
        w: 1000,
        gap: 20,
        align: "center",
        pad: [13, 20],
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      b.icon(root, "file-text", 18, muted)
      b.text(root, "INV-0000", b.ty("mono"), ink, { key: "IvNo", w: 160, grow: "fixed-width" })
      b.text(root, "Oct 1, 2026", b.ty("body"), c("ink-2"), {
        key: "IvDate",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(root, "$0.00", b.ty("label", { align: "right" }), ink, {
        key: "IvAmt",
        w: 110,
        grow: "fixed-width",
      })
      const st = b.row(root, "Status", { w: 90, justify: "end" })
      b.use(st, badgeSuccess, { key: "IvStatus", args: { label: "Paid" } })
      b.icon(root, "download", 18, muted)
    },
  )

  // --- Data --------------------------------------------------------------------------------------

  const people = {
    IK: ["Ines Kowalski", "violet"],
    TN: ["Theo Nakamura", "green"],
    AS: ["Ama Serwaa", "amber"],
    JR: ["Jonas Reiter", "violet"],
    MB: ["Mateo Bianchi", "green"],
    CD: ["Clara Dumont", "rose"],
    SO: ["Sam Ortega", "amber"],
  } as const
  type Who = keyof typeof people
  const projects: [string, string, keyof typeof tones, string, number, Who, string][] = [
    ["Halden Bank mobile onboarding", "Halden Bank", "ok", "On track", 72, "IK", "Nov 14"],
    ["Fernway checkout redesign", "Fernway", "warn", "At risk", 45, "TN", "Oct 30"],
    ["Lumo Health patient portal", "Lumo Health", "ok", "On track", 88, "AS", "Oct 21"],
    ["Orbit Fitness app v2", "Orbit Fitness", "bad", "Blocked", 30, "MB", "Nov 2"],
    ["Atlas Freight dispatch dashboard", "Atlas Freight", "plan", "Planning", 12, "JR", "Dec 5"],
    ["Kettle & Co. brand site", "Kettle & Co.", "neutral", "Done", 100, "IK", "Sep 26"],
  ]
  const barTone = {
    ok: "success",
    warn: "warning",
    bad: "danger",
    plan: "accent",
    neutral: "success",
  } as const
  function projRow(parent: string, row: (typeof projects)[number]) {
    const [name, client, tone, label, n, who, due] = row
    b.use(parent, projectRow, {
      props: { w: FILL },
      args: {
        name,
        client,
        status: tones[tone],
        statusLabel: label,
        percent: `${n}%`,
        owner: people[who][0],
        initials: who,
        due,
      },
      set: {
        PrOwner: { args: { size: "sm", tone: people[who][1] } },
        PrBar: { args: { tone: barTone[tone] } },
        "PrBar/PbDone": pct(n).PbDone,
        "PrBar/PbLeft": pct(n).PbLeft,
      },
    })
  }

  // --- App shell -----------------------------------------------------------------------------------

  const screens = b.page("Screens")
  function shell(
    name: string,
    active: string,
    actions?: (into: { inst: string; at: string }) => void,
  ) {
    const scr = b.screen(screens, name, { dir: "row", w: 1440, h: 900, fill: c("bg") })
    b.use(scr, sidebar, {
      props: { h: FILL },
      // `set.args` replaces the nested instance's args, so restate them.
      set: { [active]: { args: { ...navArgs[active], state: "active" } } },
    })
    const main = b.col(scr, "Main", { w: FILL, h: FILL })
    b.use(main, topBar, {
      props: { w: FILL },
      args: { title: name },
      ...(actions ? { slots: { TbActs: actions } } : {}),
    })
    const content = b.col(main, "Content", { w: FILL, h: FILL, gap: s(6), pad: 32, clip: true })
    return content
  }
  function panel(parent: string, name: string, props: Record<string, unknown> = {}) {
    return b.col(parent, name, { w: FILL, ...card(), clip: true, ...props })
  }
  function panelHead(parent: string, title: string, right?: (row: string) => void) {
    const head = b.row(parent, "Header", { w: FILL, gap: 12, align: "center", pad: [16, 20] })
    b.text(head, title, b.ty("heading", { size: 16 }), ink, { w: FILL, grow: "fixed-width" })
    right?.(head)
    return head
  }
  const newProject = (into: { inst: string; at: string }) =>
    b.use(into, button, { args: { label: "New project", icon: true } })

  // --- Cover ---------------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Web app template",
    title: "Fieldwork project tracker",
    description:
      "Dashboard, projects, kanban board, team, settings and billing screens for a studio project tracker. Built from 24 components with light and dark tokens.",
    preview: (area) => {
      const stats = b.row(area, "Stats", { w: FILL, gap: 16 })
      b.use(stats, statCard, {
        props: { w: FILL },
        args: { label: "Active projects", value: "12", delta: "+2" },
      })
      b.use(stats, statCard, {
        props: { w: FILL },
        args: { label: "Hours this week", value: "318", delta: "+6%" },
        set: { StIcon: { icon: "clock" } },
      })
      const board = b.row(area, "Board", { w: FILL, gap: 16, align: "start" })
      b.use(board, column, {
        props: { w: FILL },
        args: { title: "In progress", count: "3", tone: "doing" },
        slots: {
          ColCards: (into) => {
            b.use(into, taskCard, {
              props: { w: FILL },
              args: {
                title: "Shipping step: address autocomplete",
                tag: "Design",
                due: "Oct 9",
                comments: "4",
                files: "2",
                initials: "TN",
                priority: "high",
              },
            })
            b.use(into, taskCard, {
              props: { w: FILL },
              args: {
                title: "Apple Pay button states",
                tag: "Engineering",
                due: "Oct 12",
                comments: "1",
                files: "0",
                initials: "JR",
                priority: "medium",
              },
              set: { TkAv: { args: { size: "xs", tone: "violet" } } },
            })
          },
        },
      })
      b.use(board, column, {
        props: { w: FILL },
        args: { title: "In review", count: "2", tone: "review" },
        slots: {
          ColCards: (into) => {
            b.use(into, taskCard, {
              props: { w: FILL },
              args: {
                title: "Order summary on mobile",
                tag: "Design",
                due: "Oct 8",
                comments: "7",
                files: "3",
                initials: "IK",
                priority: "medium",
              },
              set: { TkAv: { args: { size: "xs", tone: "violet" } } },
            })
          },
        },
      })
    },
  })

  // --- Overview ------------------------------------------------------------------------------------
  {
    const content = shell("Overview", "SbNav1", newProject)
    const greet = b.row(content, "Greeting", { w: FILL, justify: "between", align: "end" })
    const gt = b.col(greet, "Text", { gap: 4 })
    b.text(gt, "Good morning, Clara", b.ty("h1"), ink)
    b.text(
      gt,
      "Tuesday, October 6. 27 tasks are due this week across 8 projects.",
      b.ty("body"),
      muted,
    )
    b.use(greet, buttonSecondary, {
      args: { label: "Last 30 days", icon: true },
      set: { BtnIcon: { icon: "calendar" } },
    })

    const stats = b.row(content, "Stats", { w: FILL, gap: s(4) })
    for (const [label, value, delta, trend, icon] of [
      ["Active projects", "12", "+2", badgeSuccess, "folder-kanban"],
      ["Hours logged this week", "318", "+6%", badgeSuccess, "clock"],
      ["Tasks due this week", "27", "+4", badgeWarning, "circle-check"],
      ["Budget used", "64%", "+3%", badgeWarning, "credit-card"],
    ] as const)
      b.use(stats, statCard, {
        props: { w: FILL },
        args: { label, value, delta, trend, caption: "vs last month" },
        set: { StIcon: { icon } },
      })

    const mid = b.row(content, "Middle", { w: FILL, h: 264, gap: s(4) })
    const chart = panel(mid, "Hours by week", { h: FILL, gap: 0 })
    panelHead(chart, "Hours logged by week", (row) =>
      b.text(row, "2,412 h in 8 weeks", b.ty("label"), c("accent")),
    )
    const bars = b.row(chart, "Bars", {
      w: FILL,
      h: FILL,
      gap: 16,
      align: "end",
      pad: [8, 20, 16, 20],
    })
    const hours = [252, 276, 240, 298, 310, 284, 334, 318]
    hours.forEach((h, i) => {
      const col = b.col(bars, `Week ${34 + i}`, { w: FILL, gap: 8, align: "center" })
      b.text(
        col,
        String(h),
        b.ty("small", { weight: 600 }),
        i === hours.length - 1 ? c("accent") : muted,
      )
      b.rect(col, "Bar", {
        w: FILL,
        h: Math.round((h / 334) * 120),
        radius: [6, 6, 2, 2],
        fill: i === hours.length - 1 ? c("accent") : c("accent-soft"),
      })
      b.text(col, `W${34 + i}`, b.ty("small"), muted)
    })
    const act = panel(mid, "Activity", { w: 380, h: FILL })
    panelHead(act, "Recent activity")
    const list = b.col(act, "Items", { w: FILL, gap: 16, pad: [0, 20, 16, 20] })
    for (const [text, time, who] of [
      ["Theo moved “Shipping step” to In review", "12 min ago", "TN"],
      ["Ama logged 6 h on Lumo Health patient portal", "1 h ago", "AS"],
      ["Mateo flagged Orbit Fitness app v2 as blocked", "3 h ago", "MB"],
      ["Ines uploaded 14 files to Halden Bank", "Yesterday", "IK"],
    ] as const)
      b.use(list, activity, {
        props: { w: FILL },
        args: { text, time, initials: who },
        set: { AcAv: { args: { size: "sm", tone: people[who][1] } } },
      })

    const table = panel(content, "Projects", { h: FILL })
    panelHead(table, "Projects due soon", (row) =>
      b.use(row, button, { args: { label: "View all", variant: "ghost", size: "sm" } }),
    )
    for (const row of [projects[2], projects[1], projects[3]]) if (row) projRow(table, row)
  }

  // --- Projects ------------------------------------------------------------------------------------
  {
    const content = shell("Projects", "SbNav2", newProject)
    const bar = b.row(content, "Toolbar", { w: FILL, gap: 12, align: "end" })
    b.use(bar, tabs, {
      props: { w: FILL },
      args: {
        tab1: "All  12",
        tab2: "Active  8",
        tab3: "Planning  2",
        tab4: "Done  2",
        active: "first",
      },
    })
    b.use(bar, buttonSecondary, {
      args: { label: "Filter", icon: true },
      set: { BtnIcon: { icon: "list-filter" } },
    })
    b.use(bar, buttonSecondary, {
      args: { label: "Sort: due date", icon: true },
      set: { BtnIcon: { icon: "arrow-up-down" } },
    })
    const table = panel(content, "Table")
    const th = b.row(table, "Head", { w: FILL, gap: 20, pad: [10, 20], fill: c("subtle") })
    for (const [t, w] of [
      ["Project", null],
      ["Status", 110],
      ["Progress", 210],
      ["Owner", 170],
      ["Due", 80],
    ] as const)
      b.text(
        th,
        t,
        b.ty("small", { weight: 600, ...(t === "Due" ? { align: "right" } : {}) }),
        muted,
        {
          ...(w ? { w, grow: "fixed-width" } : { w: FILL, grow: "fixed-width" }),
        },
      )
    for (const row of projects) projRow(table, row)
    const foot = b.row(table, "Footer", {
      w: FILL,
      justify: "between",
      align: "center",
      pad: [12, 20],
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    b.text(foot, "Showing 6 of 12 projects", b.ty("small"), muted)
    const pager = b.row(foot, "Pager", { gap: 8 })
    b.use(pager, buttonSecondary, { args: { label: "Previous", size: "sm" } })
    b.use(pager, buttonSecondary, { args: { label: "Next", size: "sm" } })
  }

  // --- Project board ------------------------------------------------------------------------------
  {
    const content = shell("Fernway checkout redesign", "SbNav2", (into) => {
      b.use(into, buttonSecondary, {
        args: { label: "Share", icon: true },
        set: { BtnIcon: { icon: "user-plus" } },
      })
      b.use(into, button, { args: { label: "Add task", icon: true } })
    })
    const head = b.row(content, "Project header", { w: FILL, gap: 16, align: "center" })
    const crumbs = b.row(head, "Breadcrumb", { w: FILL, gap: 6, align: "center" })
    b.text(crumbs, "Projects", b.ty("body"), muted)
    b.icon(crumbs, "chevron-right", 14, muted)
    b.text(crumbs, "Fernway", b.ty("body"), muted)
    b.icon(crumbs, "chevron-right", 14, muted)
    b.text(crumbs, "Checkout redesign", b.ty("label"), ink)
    b.use(head, badgeWarning, { args: { label: "At risk" } })
    const team = b.row(head, "Team", { gap: -6 })
    for (const who of ["TN", "IK", "JR", "AS"] as const)
      b.use(team, avatar, { args: { initials: who, size: "sm", tone: people[who][1] } })
    const due = b.row(head, "Due", { gap: 6, align: "center" })
    b.icon(due, "calendar", 14, muted)
    b.text(due, "Due Oct 30", b.ty("body"), c("ink-2"))
    b.use(content, tabs, {
      props: { w: FILL },
      args: { tab1: "Board", tab2: "List", tab3: "Timeline", tab4: "Files  18", active: "first" },
    })
    const board = b.row(content, "Board", { w: FILL, h: FILL, gap: s(4), align: "start" })
    const tasks: Record<string, [string, string, string, string, string, string, Who, string][]> = {
      todo: [
        ["Gift card field validation", "Engineering", "neutral", "Oct 14", "0", "0", "JR", "low"],
        ["Saved addresses list", "Design", "accent", "Oct 15", "2", "1", "TN", "medium"],
        ["Copy review: error messages", "Content", "neutral", "Oct 16", "1", "0", "IK", "low"],
      ],
      doing: [
        [
          "Shipping step: address autocomplete",
          "Design",
          "accent",
          "Oct 9",
          "4",
          "2",
          "TN",
          "high",
        ],
        ["Apple Pay button states", "Engineering", "neutral", "Oct 12", "1", "0", "JR", "medium"],
        ["Promo code drawer", "Design", "accent", "Oct 13", "3", "1", "IK", "medium"],
      ],
      review: [
        ["Order summary on mobile", "Design", "accent", "Oct 8", "7", "3", "IK", "high"],
        [
          "Tax line items from the API",
          "Engineering",
          "neutral",
          "Oct 8",
          "2",
          "0",
          "AS",
          "medium",
        ],
      ],
      done: [
        ["Checkout funnel audit", "Research", "neutral", "Sep 29", "9", "4", "TN", "low"],
        ["Payment step wireframes", "Design", "accent", "Oct 2", "5", "6", "IK", "low"],
      ],
    }
    for (const [tone, title, count] of [
      ["todo", "To do", "3"],
      ["doing", "In progress", "3"],
      ["review", "In review", "2"],
      ["done", "Done", "2"],
    ] as const)
      b.use(board, column, {
        props: { w: FILL },
        args: { title, count, tone },
        slots: {
          ColCards: (into) => {
            for (const [t, tag, tagTone, d, cm, fl, who, pr] of tasks[tone] ?? [])
              b.use(into, taskCard, {
                props: { w: FILL },
                args: {
                  title: t,
                  tag,
                  tagStyle: tagTone === "accent" ? badgeAccent : badge,
                  due: d,
                  comments: cm,
                  files: fl,
                  initials: who,
                  priority: pr,
                },
                set: { TkAv: { args: { size: "xs", tone: people[who][1] } } },
              })
          },
        },
      })
  }

  // --- Team ----------------------------------------------------------------------------------------
  {
    const content = shell("Team", "SbNav5", (into) =>
      b.use(into, button, {
        args: { label: "Invite member", icon: true },
        set: { BtnIcon: { icon: "user-plus" } },
      }),
    )
    const stats = b.row(content, "Stats", { w: FILL, gap: s(4) })
    for (const [label, value, delta, trend, caption, icon] of [
      ["Members", "7", "+1", badgeSuccess, "joined in September", "users"],
      ["Pending invites", "1", "Sent", badgeAccent, "to sam@ortega.design", "mail"],
      ["Seats available", "3 of 10", "70%", badgeWarning, "of seats in use", "credit-card"],
    ] as const)
      b.use(stats, statCard, {
        props: { w: FILL },
        args: { label, value, delta, trend, caption },
        set: { StIcon: { icon } },
      })
    const table = panel(content, "Members")
    panelHead(table, "Members", (row) => {
      const sb = b.row(row, "Search", {
        w: 240,
        gap: 8,
        align: "center",
        pad: [7, 10],
        radius: r("md"),
        stroke: { paint: c("border") },
      })
      b.icon(sb, "search", 14, muted)
      b.text(sb, "Find a member", b.ty("body", { size: 13 }), muted)
    })
    for (const [who, email, title, access, seen] of [
      ["CD", "clara@northbeam.studio", "Studio director", "Owner", "Online"],
      ["IK", "ines@northbeam.studio", "Design lead", "Admin", "Online"],
      ["AS", "ama@northbeam.studio", "Engineering lead", "Admin", "1 h ago"],
      ["TN", "theo@northbeam.studio", "Senior product designer", "Member", "12 min ago"],
      ["JR", "jonas@northbeam.studio", "Frontend engineer", "Member", "Yesterday"],
      ["MB", "mateo@northbeam.studio", "iOS engineer", "Member", "3 h ago"],
      ["SO", "sam@ortega.design", "Contract illustrator", "Invited", "Not joined"],
    ] as const)
      b.use(table, memberRow, {
        props: { w: FILL },
        args: {
          name: people[who][0],
          email,
          initials: who,
          title,
          access,
          seen,
          ...(access === "Owner" || access === "Admin" ? { accessStyle: badgeAccent } : {}),
          ...(access === "Invited" ? { accessStyle: badgeWarning } : {}),
        },
        set: { MrAv: { args: { size: "md", tone: people[who][1] } } },
      })
  }

  // --- Settings ------------------------------------------------------------------------------------
  {
    const content = shell("Settings", "SbSet")
    b.use(content, tabs, {
      props: { w: FILL },
      args: {
        tab1: "General",
        tab2: "Notifications",
        tab3: "Integrations",
        tab4: "Security",
        active: "first",
      },
    })
    const cols = b.row(content, "Columns", { w: FILL, gap: s(6), align: "start" })
    const ws = panel(cols, "Workspace", { gap: 0 })
    panelHead(ws, "Workspace")
    const form = b.col(ws, "Form", { w: FILL, gap: 16, pad: [0, 20, 20, 20] })
    for (const [label, value, hint] of [
      ["Workspace name", "Northbeam Studio", ""],
      [
        "Workspace URL",
        "northbeam.fieldwork.app",
        "Changing it breaks links people have bookmarked.",
      ],
      ["Time zone", "Europe/Lisbon (UTC+1)", ""],
      ["Week starts on", "Monday", ""],
    ] as const)
      b.use(form, input, {
        props: { w: FILL },
        args: { label, value, ...(hint ? { hint, showHint: true } : {}) },
      })
    const actions = b.row(form, "Actions", { w: FILL, gap: 8, justify: "end", pad: [8, 0, 0, 0] })
    b.use(actions, buttonSecondary, { args: { label: "Cancel" } })
    b.use(actions, button, { args: { label: "Save changes" } })

    const right = b.col(cols, "Right", { w: FILL, gap: s(6) })
    const notes = panel(right, "Notifications", { gap: 0 })
    panelHead(notes, "Email notifications")
    const rows = b.col(notes, "Rows", { w: FILL, pad: [0, 20, 6, 20] })
    for (const [title, description, on] of [
      ["Daily digest", "A summary of due tasks at 9:00 in your time zone.", true],
      ["Mentions and replies", "When someone mentions you in a task or comment.", true],
      ["Weekly client report", "Hours and progress per client, every Friday.", false],
      ["Budget warnings", "When a project passes 80% of its budget.", true],
    ] as const)
      b.use(rows, settingRow, {
        props: { w: FILL },
        args: { title, description, ...(on ? {} : { toggle: toggleOff }) },
      })
    const danger = panel(right, "Danger zone", { gap: 0 })
    panelHead(danger, "Delete workspace", (row) =>
      b.use(row, button, { args: { label: "Delete", variant: "danger", size: "sm" } }),
    )
    const dz = b.col(danger, "Body", { w: FILL, pad: [0, 20, 20, 20] })
    b.para(
      dz,
      "Deletes all 12 projects, 1,840 tasks and their files after 30 days. Export first if you need a copy.",
      b.ty("body", { size: 13 }),
      muted,
      { name: "Description" },
    )
  }

  // --- Billing -------------------------------------------------------------------------------------
  {
    const content = shell("Billing", "SbBill")
    const top = b.row(content, "Summary", { w: FILL, gap: s(4), align: "stretch" })
    b.use(top, planCard, {
      props: { w: FILL },
      args: {
        plan: "Studio",
        price: "$24",
        period: "per seat / month, billed monthly",
        description: "10 seats, unlimited projects and client portals. Renews on Nov 1, 2026.",
      },
    })
    const usage = panel(top, "Usage", { gap: 18, pad: 24 })
    b.text(usage, "Usage this month", b.ty("heading"), ink)
    for (const [label, value, n, tone] of [
      ["Seats", "7 of 10", 70, "accent"],
      ["File storage", "38 of 100 GB", 38, "accent"],
      ["Client portals", "9 of 15", 60, "warning"],
    ] as const) {
      const row = b.col(usage, label, { w: FILL, gap: 8 })
      const line = b.row(row, "Line", { w: FILL, justify: "between" })
      b.text(line, label, b.ty("body"), c("ink-2"))
      b.text(line, value, b.ty("label"), ink)
      b.use(row, progress, { props: { w: FILL }, args: { tone }, set: pct(n) })
    }
    const pay = panel(top, "Payment method", { gap: 14, pad: 24 })
    b.text(pay, "Payment method", b.ty("heading"), ink)
    const cardRow = b.row(pay, "Card", {
      w: FILL,
      gap: 12,
      align: "center",
      pad: 14,
      radius: r("md"),
      stroke: { paint: c("border") },
    })
    const brandTile = b.row(cardRow, "Brand", {
      w: 44,
      h: 30,
      radius: 6,
      fill: c("subtle"),
      align: "center",
      justify: "center",
    })
    b.icon(brandTile, "credit-card", 18, c("ink-2"))
    const ct = b.col(cardRow, "Text", { w: FILL, gap: 2 })
    b.text(ct, "Visa ending in 4242", b.ty("label"), ink)
    b.text(ct, "Expires 08/28", b.ty("small"), muted)
    b.text(pay, "Invoices go to billing@northbeam.studio", b.ty("body", { size: 13 }), muted)
    b.use(pay, buttonSecondary, { props: { w: FILL }, args: { label: "Update payment method" } })

    const inv = panel(content, "Invoices")
    panelHead(inv, "Invoices", (row) =>
      b.use(row, button, { args: { label: "Download all", variant: "ghost", size: "sm" } }),
    )
    for (const [number, date, amount] of [
      ["INV-2026-010", "Oct 1, 2026", "$168.00"],
      ["INV-2026-009", "Sep 1, 2026", "$168.00"],
      ["INV-2026-008", "Aug 1, 2026", "$144.00"],
      ["INV-2026-007", "Jul 1, 2026", "$144.00"],
      ["INV-2026-006", "Jun 1, 2026", "$120.00"],
    ] as const)
      b.use(inv, invoiceRow, { props: { w: FILL }, args: { number, date, amount } })
  }
}
