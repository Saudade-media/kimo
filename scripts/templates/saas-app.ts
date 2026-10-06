/**
 * Fieldwork: the web app of a fictional project tracker for a design studio (Northbeam Studio).
 * Screens (1440x900 app frames): Overview, Projects, Project board, Team, Settings, Billing.
 *
 * Look: a studio wall, not a CRM. Warm paper ground with an inset white panel (Linear), 13px
 * density, hairlines, one vermilion accent, discipline hues as the only other colour, JetBrains
 * Mono for IDs, hours and dates. References: Linear (shell, projects), Buffer and Square (board),
 * HoneyBook (overview strip), Supabase and Browserbase (team, settings), Bloom (billing).
 */
import { FILL, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "saas-app",
  name: "Fieldwork project tracker",
  category: "Web app",
  description:
    "Six-screen web app for a design studio's project tracker: overview, projects, kanban board, team, settings and billing.",
  prefix: "sa",
  build,
}

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#EFEDE7", "#131211"],
      ground: ["#EFEDE7", "#131211"],
      surface: ["#FFFFFF", "#1B1A18"],
      subtle: ["#F6F4EF", "#222120"],
      sunken: ["#F1EFE9", "#171614"],
      ink: ["#1B1A17", "#EFEDE6"],
      "on-ink": ["#FFFFFF", "#1B1A17"],
      muted: ["#6B6860", "#98948A"],
      faint: ["#9B978D", "#6C6960"],
      border: ["#E4E1D8", "#2E2C28"],
      "border-strong": ["#CFCBBF", "#46433D"],
      accent: ["#D8431F", "#FF7A55"],
      "on-accent": ["#FFFFFF", "#1B1A17"],
      "accent-soft": ["#FBE6DF", "#3A211A"],
      success: ["#2E7D4F", "#5FCF98"],
      "success-soft": ["#DFF0E4", "#17301F"],
      warning: ["#A8620A", "#EDB24E"],
      "warning-soft": ["#F7E8C8", "#33250D"],
      danger: ["#B4372A", "#F08A78"],
      "danger-soft": ["#F7DDD8", "#3A1C17"],
      "d-brand": ["#C2553A", "#E0805F"],
      "d-web": ["#2F6FB3", "#6FA3E0"],
      "d-motion": ["#7B5BB5", "#A88BE0"],
      "d-print": ["#3E8E5A", "#6FC08A"],
      "d-strategy": ["#B58A1E", "#E0B84F"],
      "tint-1": ["#F1DDD3", "#3A2A24"],
      "tint-2": ["#D9E6DD", "#243229"],
      "tint-3": ["#DDE3EE", "#242B3A"],
      "tint-4": ["#EFE4C9", "#3A3320"],
      "load-1": ["#F6E4DD", "#34231D"],
      "load-2": ["#F0C5B5", "#5A3326"],
      "load-3": ["#E39A80", "#8A4630"],
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
      "radius/sm": 4,
      "radius/md": 6,
      "radius/lg": 8,
      "radius/xl": 10,
      "radius/pill": 999,
    },
    type: {
      display: { font: "Inter", size: 60, weight: 600, lineHeight: 1.02, letterSpacing: -2.2 },
      title: { font: "Inter", size: 20, weight: 600, lineHeight: 1.2, letterSpacing: -0.5 },
      heading: { font: "Inter", size: 14, weight: 600, lineHeight: 1.3, letterSpacing: -0.1 },
      body: { font: "Inter", size: 13, weight: 400, lineHeight: 1.45 },
      label: { font: "Inter", size: 13, weight: 500, lineHeight: 1.3 },
      small: { font: "Inter", size: 12, weight: 400, lineHeight: 1.4 },
      figure: { font: "Inter", size: 26, weight: 600, lineHeight: 1.1, letterSpacing: -0.8 },
      mono: { font: "JetBrains Mono", size: 12, weight: 500, lineHeight: 1.4 },
    },
    shadows: {
      pop: [
        { kind: "shadow", x: 0, y: 1, blur: 2, color: "#1B1A1714" },
        { kind: "shadow", x: 0, y: 12, blur: 24, spread: -8, color: "#1B1A1726" },
      ],
    },
  })

  const c = (n: string) => b.c(n)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  const cap = (extra: Record<string, unknown> = {}) =>
    b.ty("mono", { size: 11, case: "upper", letterSpacing: 0.6, ...extra })
  const disc: Record<string, [string, string]> = {
    brand: ["d-brand", "Brand"],
    web: ["d-web", "Web"],
    motion: ["d-motion", "Motion"],
    print: ["d-print", "Print"],
    strategy: ["d-strategy", "Strategy"],
  }

  // --- Components ------------------------------------------------------------------------------

  const button = b.component(
    "Button",
    {
      key: "Btn",
      section: "Actions",
      description: "Accent for the one primary action, dark, secondary or ghost; md or sm.",
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
          dark: {
            "root.fill": ink,
            "root.stroke": { paint: ink },
            "BtnLabel.fill": c("on-ink"),
            "BtnIcon.color": c("on-ink"),
          },
          secondary: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border-strong") },
            "BtnLabel.fill": ink,
            "BtnIcon.color": ink,
          },
          ghost: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("surface") },
            "BtnLabel.fill": muted,
            "BtnIcon.color": muted,
          },
          danger: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("danger") },
            "BtnLabel.fill": c("danger"),
            "BtnIcon.color": c("danger"),
          },
        }),
        size: p.variants({
          md: { "root.layout/pad": [7, 12], "BtnLabel.style/size": 13 },
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
      b.text(root, "Button", b.ty("label"), c("on-accent"), { key: "BtnLabel", name: "Label" })
      b.icon(root, "plus", 14, c("on-accent"), { key: "BtnIcon", visible: false })
    },
  )
  const buttonSecondary = b.derive(button, "Button/Secondary", "BtnSec", {
    section: "Actions",
    args: { variant: "secondary" },
  })

  const chip = b.component(
    "Chip",
    {
      key: "Chip",
      section: "Actions",
      description: "Small state label with an optional dot.",
      props: {
        label: p.text("ChipLbl", "Chip"),
        dot: p.bool("ChipDot", false),
        tone: p.variants({
          neutral: { "root.fill": c("subtle"), "ChipLbl.fill": muted, "ChipDot.fill": muted },
          success: {
            "root.fill": c("success-soft"),
            "ChipLbl.fill": c("success"),
            "ChipDot.fill": c("success"),
          },
          warning: {
            "root.fill": c("warning-soft"),
            "ChipLbl.fill": c("warning"),
            "ChipDot.fill": c("warning"),
          },
          danger: {
            "root.fill": c("danger-soft"),
            "ChipLbl.fill": c("danger"),
            "ChipDot.fill": c("danger"),
          },
          accent: {
            "root.fill": c("accent-soft"),
            "ChipLbl.fill": c("accent"),
            "ChipDot.fill": c("accent"),
          },
        }),
      },
      root: {
        dir: "row",
        gap: 5,
        align: "center",
        pad: [2, 7],
        radius: r("sm"),
        fill: c("subtle"),
      },
    },
    (root) => {
      b.ellipse(root, "Dot", { key: "ChipDot", w: 6, h: 6, fill: muted, visible: false })
      b.text(root, "Chip", b.ty("small", { weight: 500 }), muted, { key: "ChipLbl", name: "Label" })
    },
  )

  const avatar = b.component(
    "Avatar",
    {
      key: "Avatar",
      section: "Content",
      props: {
        initials: p.text("AvInit", "CD"),
        size: p.variants({
          xs: { "root.w": 20, "root.h": 20, "AvInit.style/size": 9 },
          sm: { "root.w": 24, "root.h": 24, "AvInit.style/size": 10 },
          md: { "root.w": 32, "root.h": 32, "AvInit.style/size": 12 },
          lg: { "root.w": 48, "root.h": 48, "AvInit.style/size": 16 },
        }),
        tone: p.variants({
          one: { "root.fill": c("tint-1") },
          two: { "root.fill": c("tint-2") },
          three: { "root.fill": c("tint-3") },
          four: { "root.fill": c("tint-4") },
        }),
      },
      root: {
        dir: "row",
        w: 24,
        h: 24,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("tint-1"),
      },
    },
    (root) =>
      b.text(root, "CD", b.ty("label", { size: 10, weight: 600 }), ink, {
        key: "AvInit",
        name: "Initials",
      }),
  )

  const discipline = b.component(
    "Discipline",
    {
      key: "Disc",
      section: "Content",
      description: "Dot and label for a studio discipline.",
      props: {
        kind: p.variants(
          Object.fromEntries(
            Object.entries(disc).map(([k, [tok, name]]) => [
              k,
              { "DiscDot.fill": c(tok), "DiscLbl.content": name },
            ]),
          ),
        ),
      },
      root: { dir: "row", gap: 6, align: "center" },
    },
    (root) => {
      b.rect(root, "Dot", { key: "DiscDot", w: 8, h: 8, radius: 2, fill: c("d-brand") })
      b.text(root, "Brand", b.ty("body", { size: 12 }), ink, { key: "DiscLbl", name: "Label" })
    },
  )

  const health = b.component(
    "Health",
    {
      key: "Health",
      section: "Content",
      description: "Project health glyph with label.",
      props: {
        state: p.variants({
          "on-track": {
            "HlIcon.icon": "circle-check",
            "HlIcon.color": c("success"),
            "HlLbl.content": "On track",
            "HlLbl.fill": ink,
          },
          "at-risk": {
            "HlIcon.icon": "triangle-alert",
            "HlIcon.color": c("warning"),
            "HlLbl.content": "At risk",
            "HlLbl.fill": ink,
          },
          "off-track": {
            "HlIcon.icon": "circle-x",
            "HlIcon.color": c("danger"),
            "HlLbl.content": "Off track",
            "HlLbl.fill": ink,
          },
          planning: {
            "HlIcon.icon": "circle-dashed",
            "HlIcon.color": muted,
            "HlLbl.content": "Planning",
            "HlLbl.fill": muted,
          },
        }),
      },
      root: { dir: "row", gap: 6, align: "center" },
    },
    (root) => {
      b.icon(root, "circle-check", 14, c("success"), { key: "HlIcon" })
      b.text(root, "On track", b.ty("body", { size: 12 }), ink, { key: "HlLbl", name: "Label" })
    },
  )

  const meter = b.component(
    "Meter",
    {
      key: "Meter",
      section: "Content",
      description: "Thin bar. Override the Fill width (0 to 96) and colour per use.",
      root: { dir: "row", w: 96, h: 6, radius: r("sm"), fill: c("border"), clip: true },
    },
    (root) => b.rect(root, "Fill", { key: "MtFill", w: 48, h: 6, fill: ink }),
  )

  // Sidebar -----------------------------------------------------------------------------------
  const navItems: [string, string][] = [
    ["Overview", "layout-dashboard"],
    ["My work", "circle-check"],
    ["Projects", "folder-kanban"],
    ["Team", "users"],
    ["Settings", "settings"],
  ]
  const navActive = (i: number) =>
    Object.fromEntries(
      navItems.flatMap((_, j) => [
        [`NavI${j + 1}.fill`, j === i ? c("surface") : c("ground")],
        [`NavI${j + 1}.stroke`, { paint: j === i ? c("border") : c("ground") }],
        [`NavL${j + 1}.fill`, j === i ? ink : muted],
        [`NavIc${j + 1}.color`, j === i ? ink : muted],
      ]),
    )
  const sidebar = b.component(
    "Sidebar",
    {
      key: "Side",
      section: "Navigation",
      props: {
        active: p.variants({
          overview: navActive(0),
          projects: navActive(2),
          team: navActive(3),
          settings: navActive(4),
        }),
      },
      root: {
        dir: "column",
        w: 232,
        h: 900,
        pad: [12, 10],
        gap: 16,
        justify: "between",
        fill: c("ground"),
      },
    },
    (root) => {
      const top = b.col(root, "Top", { w: FILL, gap: 14 })
      const ws = b.row(top, "Workspace", { w: FILL, gap: 10, align: "center", pad: [2, 6] })
      const mark = b.row(ws, "Mark", {
        w: 24,
        h: 24,
        radius: r("md"),
        fill: ink,
        align: "center",
        justify: "center",
      })
      b.text(mark, "N", b.ty("label", { size: 12, weight: 700 }), c("on-ink"))
      b.para(ws, "Northbeam Studio", b.ty("heading", { size: 13 }), ink)
      b.icon(ws, "chevrons-up-down", 14, muted)
      const search = b.row(top, "Search", {
        w: FILL,
        gap: 8,
        align: "center",
        pad: [6, 8],
        radius: r("md"),
        stroke: { paint: c("border-strong") },
      })
      b.icon(search, "search", 14, muted)
      b.para(search, "Search", b.ty("body", { size: 12 }), muted)
      b.text(search, "Ctrl K", b.ty("mono", { size: 10 }), c("faint"))
      const nav = b.col(top, "Nav", { w: FILL, gap: 2 })
      const item = (parent: string, i: number, label: string, icon: string) => {
        const row = b.row(parent, label, {
          key: `NavI${i + 1}`,
          w: FILL,
          gap: 10,
          align: "center",
          pad: [6, 8],
          radius: r("md"),
          fill: c("ground"),
          stroke: { paint: c("ground") },
        })
        b.icon(row, icon, 16, muted, { key: `NavIc${i + 1}` })
        b.text(row, label, b.ty("label"), muted, { key: `NavL${i + 1}` })
      }
      for (const [i, [label, icon]] of navItems.slice(0, 4).entries()) item(nav, i, label, icon)
      const pinned = b.col(top, "Pinned", { w: FILL, gap: 2 })
      b.text(pinned, "Pinned", cap({ size: 10 }), c("faint"), { name: "Heading" })
      b.rect(pinned, "Gap", { w: FILL, h: 4, fill: c("ground") })
      for (const [name, d] of [
        ["Fernway checkout", "d-web"],
        ["Halden brand refresh", "d-brand"],
        ["Orbit film titles", "d-motion"],
      ] as const) {
        const row = b.row(pinned, name, { w: FILL, gap: 10, align: "center", pad: [5, 8] })
        b.rect(row, "Dot", { w: 8, h: 8, radius: 2, fill: c(d) })
        b.text(row, name, b.ty("body", { size: 13 }), muted)
      }
      const bottom = b.col(root, "Bottom", { w: FILL, gap: 10 })
      item(bottom, 4, navItems[4][0], navItems[4][1])
      b.divider(bottom, c("border-strong"))
      const me = b.row(bottom, "Account", { w: FILL, gap: 10, align: "center", pad: [4, 6] })
      b.use(me, avatar, { args: { initials: "CD", size: "md", tone: "one" } })
      const who = b.col(me, "Who", { w: FILL, gap: 1 })
      b.text(who, "Clara Dumont", b.ty("label"), ink)
      b.text(who, "Studio lead", b.ty("small"), muted)
    },
  )

  const topBar = b.component(
    "Top bar",
    {
      key: "TopBar",
      section: "Navigation",
      description: "Breadcrumb on the left, actions slot on the right.",
      props: {
        parent: p.text("TbParent", "Studio"),
        current: p.text("TbCurrent", "Overview"),
        actions: p.slot("TbActions"),
      },
      root: {
        dir: "row",
        w: 1192,
        h: 44,
        pad: [0, 16, 0, 20],
        align: "center",
        justify: "between",
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const crumbs = b.row(root, "Breadcrumb", { gap: 8, align: "center" })
      b.text(crumbs, "Studio", b.ty("label"), muted, { key: "TbParent" })
      b.text(crumbs, "/", b.ty("label"), c("faint"))
      b.text(crumbs, "Overview", b.ty("label"), ink, { key: "TbCurrent" })
      b.row(root, "Actions", { key: "TbActions", gap: 8, align: "center", slot: {} })
    },
  )

  // Overview pieces -----------------------------------------------------------------------------
  const countCell = b.component(
    "Count",
    {
      key: "Count",
      section: "Overview",
      description: "One cell of the count strip.",
      props: {
        label: p.text("CtLbl", "Active projects"),
        value: p.text("CtVal", "12"),
        note: p.text("CtNote", "3 at risk"),
        tone: p.variants({
          neutral: { "CtNote.fill": muted },
          warning: { "CtNote.fill": c("warning") },
          danger: { "CtNote.fill": c("danger") },
          success: { "CtNote.fill": c("success") },
        }),
      },
      root: { dir: "column", w: 286, gap: 6, pad: [14, 18] },
    },
    (root) => {
      b.text(root, "Active projects", cap(), muted, { key: "CtLbl" })
      const row = b.row(root, "Value", { w: FILL, gap: 10, align: "baseline" })
      b.text(row, "12", b.ty("figure"), ink, { key: "CtVal" })
      b.text(row, "3 at risk", b.ty("mono", { size: 11 }), muted, { key: "CtNote" })
    },
  )

  const deliverable = b.component(
    "Deliverable",
    {
      key: "Deliv",
      section: "Overview",
      description: "A due item on the week grid. The left bar takes the discipline colour.",
      props: {
        title: p.text("DvTitle", "Checkout flow, v4"),
        project: p.text("DvProj", "FW-018"),
        time: p.text("DvTime", "Tue"),
        kind: p.variants(
          Object.fromEntries(
            Object.entries(disc).map(([k, [tok]]) => [
              k,
              { "root.stroke": { paint: c(tok), width: { l: 3 } } },
            ]),
          ),
        ),
      },
      root: {
        dir: "column",
        w: 204,
        gap: 4,
        pad: [8, 10],
        radius: r("sm"),
        fill: c("subtle"),
        stroke: { paint: c("d-brand"), width: { l: 3 } },
      },
    },
    (root) => {
      b.para(root, "Checkout flow, v4", b.ty("label", { size: 12 }), ink, { key: "DvTitle" })
      const m = b.row(root, "Meta", { w: FILL, justify: "between" })
      b.text(m, "FW-018", b.ty("mono", { size: 10 }), muted, { key: "DvProj" })
      b.text(m, "Tue", b.ty("mono", { size: 10 }), muted, { key: "DvTime" })
    },
  )

  const inboxRow = b.component(
    "Inbox row",
    {
      key: "Inbox",
      section: "Overview",
      props: {
        who: p.text("InAv/AvInit", "MB"),
        title: p.text("InTitle", "Mateo asked for review"),
        detail: p.text("InDetail", "Checkout flow, v4"),
        time: p.text("InTime", "9:12"),
        unread: p.bool("InDot", true),
      },
      root: {
        dir: "row",
        w: 380,
        gap: 12,
        pad: [12, 16],
        align: "start",
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.use(root, avatar, { key: "InAv", args: { size: "md", tone: "two" } })
      const col = b.col(root, "Text", { w: FILL, gap: 2 })
      b.para(col, "Mateo asked for review", b.ty("label"), ink, { key: "InTitle" })
      b.para(col, "Checkout flow, v4", b.ty("body", { size: 12 }), muted, { key: "InDetail" })
      const side = b.row(root, "Side", { gap: 8, align: "center" })
      b.ellipse(side, "Unread", { key: "InDot", w: 6, h: 6, fill: c("accent") })
      b.text(side, "9:12", b.ty("mono", { size: 11 }), muted, { key: "InTime" })
    },
  )

  // Lists and tables ----------------------------------------------------------------------------
  const projectRow = b.component(
    "Project row",
    {
      key: "PRow",
      section: "Tables",
      description: "One project in the grouped list.",
      props: {
        id: p.text("PrId", "FW-018"),
        name: p.text("PrName", "Project name"),
        client: p.text("PrClient", "Client"),
        lead: p.text("PrLead/AvInit", "CD"),
        leadName: p.text("PrLeadName", "Clara Dumont"),
        percent: p.text("PrPct", "62%"),
        budget: p.text("PrBudget", "212 / 340 h"),
        target: p.text("PrTarget", "Oct 30"),
      },
      root: {
        dir: "row",
        w: 1192,
        h: 48,
        gap: 12,
        pad: [0, 20],
        align: "center",
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.para(root, "FW-018", b.ty("mono", { size: 11 }), muted, { key: "PrId", w: 56 })
      const nm = b.col(root, "Name", { w: FILL, gap: 1 })
      b.para(nm, "Project name", b.ty("label"), ink, { key: "PrName" })
      b.para(nm, "Client", b.ty("small"), muted, { key: "PrClient" })
      b.use(root, health, { key: "PrHealth", props: { w: 112 } })
      const lead = b.row(root, "Lead", { w: 132, gap: 8, align: "center" })
      b.use(lead, avatar, { key: "PrLead", args: { size: "xs" } })
      b.para(lead, "Clara Dumont", b.ty("body", { size: 12 }), ink, { key: "PrLeadName" })
      b.use(root, discipline, { key: "PrDisc", props: { w: 96 } })
      const prog = b.row(root, "Progress", { w: 140, gap: 10, align: "center" })
      b.use(prog, meter, { key: "PrMeter" })
      b.para(prog, "62%", b.ty("mono", { size: 11, align: "right" }), ink, { key: "PrPct" })
      b.para(root, "212 / 340 h", b.ty("mono", { size: 11, align: "right" }), muted, {
        key: "PrBudget",
        w: 88,
      })
      b.para(root, "Oct 30", b.ty("mono", { size: 11, align: "right" }), ink, {
        key: "PrTarget",
        w: 64,
      })
    },
  )

  const groupHeader = b.component(
    "Group header",
    {
      key: "Group",
      section: "Tables",
      props: {
        name: p.text("GrName", "In progress"),
        count: p.text("GrCount", "7"),
        open: p.variants({
          open: { "GrIcon.icon": "chevron-down" },
          closed: { "GrIcon.icon": "chevron-right" },
        }),
      },
      root: {
        dir: "row",
        w: 1192,
        h: 32,
        gap: 8,
        pad: [0, 20],
        align: "center",
        fill: c("subtle"),
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.icon(root, "chevron-down", 14, muted, { key: "GrIcon" })
      b.text(root, "In progress", b.ty("heading", { size: 12 }), ink, { key: "GrName" })
      b.text(root, "7", b.ty("mono", { size: 11 }), muted, { key: "GrCount" })
    },
  )

  const personRow = b.component(
    "Person row",
    {
      key: "Person",
      section: "Tables",
      props: {
        initials: p.text("PeAv/AvInit", "MB"),
        name: p.text("PeName", "Mateo Bianchi"),
        email: p.text("PeEmail", "mateo@northbeam.studio"),
        role: p.text("PeRole", "Design lead"),
        percent: p.text("PePct", "90%"),
        hours: p.text("PeHours", "36 / 40 h"),
        status: p.text("PeStatus/ChipLbl", "Active"),
      },
      root: {
        dir: "row",
        w: 1192,
        h: 52,
        gap: 12,
        pad: [0, 20],
        align: "center",
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const who = b.row(root, "Person", { w: FILL, gap: 12, align: "center" })
      b.use(who, avatar, { key: "PeAv", args: { size: "md", tone: "one" } })
      const nm = b.col(who, "Name", { gap: 1 })
      b.text(nm, "Mateo Bianchi", b.ty("label"), ink, { key: "PeName" })
      b.text(nm, "mateo@northbeam.studio", b.ty("small"), muted, { key: "PeEmail" })
      b.para(root, "Design lead", b.ty("body", { size: 12 }), ink, { key: "PeRole", w: 150 })
      b.use(root, discipline, { key: "PeDisc", props: { w: 110 } })
      const alloc = b.row(root, "Allocation", { w: 170, gap: 10, align: "center" })
      b.use(alloc, meter, { key: "PeMeter" })
      b.para(alloc, "90%", b.ty("mono", { size: 11, align: "right" }), ink, { key: "PePct" })
      b.para(root, "36 / 40 h", b.ty("mono", { size: 11, align: "right" }), muted, {
        key: "PeHours",
        w: 80,
      })
      const st = b.row(root, "Status", { w: 84 })
      b.use(st, chip, { key: "PeStatus", args: { label: "Active", tone: "success", dot: true } })
      b.icon(root, "ellipsis", 16, muted)
    },
  )

  // Board ---------------------------------------------------------------------------------------
  const taskCard = b.component(
    "Task card",
    {
      key: "Card",
      section: "Board",
      description:
        "A task on the board: ID, discipline, title, assignee, due date, comments and hours left.",
      props: {
        id: p.text("CdId", "FW-142"),
        title: p.text("CdTitle", "Task title"),
        initials: p.text("CdAv/AvInit", "AS"),
        due: p.text("CdDue", "Oct 8"),
        comments: p.text("CdCom", "3"),
        hours: p.text("CdHours", "6 h left"),
        kind: p.variants(
          Object.fromEntries(
            Object.entries(disc).map(([k, [tok, name]]) => [
              k,
              { "CdDot.fill": c(tok), "CdKind.content": name },
            ]),
          ),
        ),
      },
      root: {
        dir: "column",
        w: 260,
        gap: 10,
        pad: 12,
        radius: r("lg"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      },
    },
    (root) => {
      const top = b.row(root, "Top", { w: FILL, justify: "between", align: "center" })
      b.text(top, "FW-142", b.ty("mono", { size: 11 }), muted, { key: "CdId" })
      const k = b.row(top, "Kind", { gap: 6, align: "center" })
      b.rect(k, "Dot", { key: "CdDot", w: 8, h: 8, radius: 2, fill: c("d-web") })
      b.text(k, "Web", b.ty("small"), muted, { key: "CdKind" })
      b.para(root, "Task title", b.ty("label"), ink, { key: "CdTitle" })
      const foot = b.row(root, "Footer", { w: FILL, gap: 10, align: "center" })
      b.use(foot, avatar, { key: "CdAv", args: { size: "sm", tone: "three" } })
      const due = b.row(foot, "Due", { gap: 4, align: "center" })
      b.icon(due, "calendar", 12, muted)
      b.text(due, "Oct 8", b.ty("mono", { size: 11 }), muted, { key: "CdDue" })
      const com = b.row(foot, "Comments", { gap: 4, align: "center" })
      b.icon(com, "message-square", 12, muted)
      b.text(com, "3", b.ty("mono", { size: 11 }), muted, { key: "CdCom" })
      b.rect(foot, "Space", { w: FILL, h: 1, fill: c("surface") })
      b.text(foot, "6 h left", b.ty("mono", { size: 11 }), ink, { key: "CdHours" })
    },
  )

  const boardColumn = b.component(
    "Board column",
    {
      key: "Col",
      section: "Board",
      description: "A status trough. Fill the Cards slot with Task cards.",
      props: {
        name: p.text("ColName", "In design"),
        count: p.text("ColCount", "4"),
        cards: p.slot("ColCards"),
        icon: p.variants({
          brief: { "ColIcon.icon": "circle-dashed", "ColIcon.color": muted },
          design: { "ColIcon.icon": "circle-dot", "ColIcon.color": c("d-web") },
          review: { "ColIcon.icon": "eye", "ColIcon.color": c("warning") },
          handoff: { "ColIcon.icon": "package-check", "ColIcon.color": c("success") },
        }),
      },
      root: {
        dir: "column",
        w: 284,
        gap: 8,
        pad: 8,
        radius: r("xl"),
        fill: c("sunken"),
      },
    },
    (root) => {
      const head = b.row(root, "Header", { w: FILL, gap: 8, pad: [4, 6], align: "center" })
      b.icon(head, "circle-dashed", 14, muted, { key: "ColIcon" })
      b.text(head, "In design", b.ty("heading", { size: 13 }), ink, { key: "ColName" })
      b.text(head, "4", b.ty("mono", { size: 11 }), muted, { key: "ColCount" })
      b.rect(head, "Space", { w: FILL, h: 1, fill: c("sunken") })
      b.icon(head, "plus", 14, muted)
      b.col(root, "Cards", { key: "ColCards", w: FILL, gap: 8, slot: { suggested: [taskCard] } })
    },
  )

  // Settings -------------------------------------------------------------------------------------
  const settingsItems = ["General", "Members", "Notifications", "Integrations", "Billing"] as const
  const settingsActive = (i: number) =>
    Object.fromEntries(
      settingsItems.flatMap((_, j) => [
        [`SnI${j + 1}.fill`, j === i ? c("subtle") : c("surface")],
        [`SnL${j + 1}.fill`, j === i ? ink : muted],
      ]),
    )
  const settingsNav = b.component(
    "Settings nav",
    {
      key: "SNav",
      section: "Navigation",
      props: {
        active: p.variants({
          general: settingsActive(0),
          members: settingsActive(1),
          notifications: settingsActive(2),
          integrations: settingsActive(3),
          billing: settingsActive(4),
        }),
      },
      root: {
        dir: "column",
        w: 216,
        gap: 2,
        pad: [20, 12],
        stroke: { paint: c("border"), width: { r: 1 } },
      },
    },
    (root) => {
      b.text(root, "Studio settings", cap({ size: 10 }), c("faint"), { name: "Heading" })
      b.rect(root, "Gap", { w: FILL, h: 6, fill: c("surface") })
      for (const [i, n] of settingsItems.entries()) {
        const row = b.row(root, n, {
          key: `SnI${i + 1}`,
          w: FILL,
          pad: [6, 10],
          radius: r("md"),
          fill: c("surface"),
        })
        b.text(row, n, b.ty("label"), muted, { key: `SnL${i + 1}` })
      }
    },
  )

  const formRow = b.component(
    "Form row",
    {
      key: "FRow",
      section: "Forms",
      description: "Label and hint on the left, a control on the right. Fill the Control slot.",
      props: {
        label: p.text("FrLabel", "Label"),
        hint: p.text("FrHint", "What this setting does."),
        control: p.slot("FrControl"),
      },
      root: {
        dir: "row",
        w: 760,
        gap: 40,
        pad: [16, 0],
        align: "start",
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const text = b.col(root, "Text", { w: 260, gap: 4 })
      b.text(text, "Label", b.ty("heading"), ink, { key: "FrLabel" })
      b.para(text, "What this setting does.", b.ty("body", { size: 12 }), muted, { key: "FrHint" })
      b.col(root, "Control", { key: "FrControl", w: FILL, gap: 8, slot: {} })
    },
  )

  const field = b.component(
    "Field",
    {
      key: "Field",
      section: "Forms",
      props: {
        value: p.text("FdValue", "Value"),
        prefix: p.text("FdPrefix", "prefix"),
        showPrefix: p.bool("FdPrefixWrap", false),
        icon: p.bool("FdIcon", false),
      },
      root: {
        dir: "row",
        w: 360,
        gap: 0,
        align: "center",
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border-strong") },
        clip: true,
      },
    },
    (root) => {
      const pre = b.row(root, "Prefix", {
        key: "FdPrefixWrap",
        pad: [8, 10],
        fill: c("subtle"),
        stroke: { paint: c("border-strong"), width: { r: 1 } },
        visible: false,
      })
      b.text(pre, "prefix", b.ty("body", { size: 12 }), muted, { key: "FdPrefix" })
      const val = b.row(root, "Value", { w: FILL, pad: [8, 10], gap: 8, align: "center" })
      b.para(val, "Value", b.ty("body"), ink, { key: "FdValue" })
      b.icon(val, "chevrons-up-down", 14, muted, { key: "FdIcon", visible: false })
    },
  )

  const toggle = b.component(
    "Switch",
    {
      key: "Switch",
      section: "Forms",
      props: {
        state: p.variants({
          on: { "SwTrack.fill": c("accent"), "SwTrack.layout/justify": "end" },
          off: { "SwTrack.fill": c("border-strong"), "SwTrack.layout/justify": "start" },
        }),
        label: p.text("SwLabel", "Enabled"),
      },
      root: {
        dir: "row",
        w: 360,
        gap: 12,
        align: "center",
      },
    },
    (root) => {
      const track = b.row(root, "Track", {
        w: 32,
        h: 18,
        pad: 2,
        radius: r("pill"),
        fill: c("accent"),
        justify: "end",
        key: "SwTrack",
      })
      b.ellipse(track, "Knob", { w: 14, h: 14, fill: c("surface") })
      b.para(root, "Enabled", b.ty("body"), ink, { key: "SwLabel" })
    },
  )

  const invoiceRow = b.component(
    "Invoice row",
    {
      key: "Inv",
      section: "Tables",
      props: {
        date: p.text("IvDate", "Oct 1, 2026"),
        number: p.text("IvNum", "FW-2026-10"),
        amount: p.text("IvAmt", "$216.00"),
        status: p.text("IvStatus/ChipLbl", "Paid"),
      },
      root: {
        dir: "row",
        w: 760,
        h: 44,
        gap: 12,
        pad: [0, 16],
        align: "center",
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.para(root, "Oct 1, 2026", b.ty("mono", { size: 12 }), ink, { key: "IvDate", w: 120 })
      b.para(root, "FW-2026-10", b.ty("mono", { size: 12 }), muted, { key: "IvNum" })
      b.para(root, "$216.00", b.ty("mono", { size: 12, align: "right" }), ink, {
        key: "IvAmt",
        w: 90,
      })
      const st = b.row(root, "Status", { w: 72, justify: "end" })
      b.use(st, chip, { key: "IvStatus", args: { label: "Paid", tone: "success" } })
      b.icon(root, "download", 16, muted)
    },
  )

  // --- Shared helpers --------------------------------------------------------------------------

  const people = [
    ["CD", "Clara Dumont", "one"],
    ["MB", "Mateo Bianchi", "two"],
    ["AS", "Ana Sorrell", "three"],
    ["TN", "Theo Nakamura", "four"],
    ["IO", "Ines Okoro", "one"],
    ["JW", "Jonas Weber", "two"],
    ["PM", "Priya Mehta", "three"],
    ["LF", "Lucas Ferreira", "four"],
    ["NH", "Noor Haddad", "one"],
  ] as const
  const tone = (ini: string) => people.find((x) => x[0] === ini)?.[2] ?? "one"
  const name = (ini: string) => people.find((x) => x[0] === ini)?.[1] ?? ini

  /** A 1440x900 app frame: sidebar and the inset panel. Returns the panel. */
  function shell(
    title: string,
    active: "overview" | "projects" | "team" | "settings",
    crumb: [string, string],
    actions?: (into: { inst: string; at: string }) => void,
  ) {
    const scr = b.screen(screens, title, { dir: "row", w: 1440, h: 900, fill: c("ground") })
    b.use(scr, sidebar, { args: { active } })
    const wrap = b.col(scr, "Main", { w: FILL, h: 900, pad: [8, 8, 8, 0] })
    const panel = b.col(wrap, "Panel", {
      w: FILL,
      h: FILL,
      radius: r("xl"),
      fill: c("surface"),
      stroke: { paint: c("border") },
      clip: true,
    })
    b.use(panel, topBar, {
      props: { w: FILL },
      args: { parent: crumb[0], current: crumb[1] },
      slots: { TbActions: (into) => actions?.(into) },
    })
    return panel
  }

  function tabs(parent: string, items: [string, string][], active: number) {
    const row = b.row(parent, "Tabs", {
      w: FILL,
      gap: 20,
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    for (const [i, [t, n]] of items.entries()) {
      const tab = b.row(row, t, {
        gap: 6,
        pad: [0, 0, 10, 0],
        stroke: { paint: ink, width: { b: i === active ? 2 : 0 } },
      })
      b.text(tab, t, b.ty("label"), i === active ? ink : muted)
      if (n) b.text(tab, n, b.ty("mono", { size: 11 }), muted)
    }
    return row
  }

  // --- Cover -----------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Web app template",
    title: "Fieldwork project tracker",
    description:
      "Overview, projects, kanban board, team, settings and billing for a design studio. 20 components, light and dark tokens, Inter and JetBrains Mono.",
    preview: (area) => {
      const strip = b.row(area, "Counts", {
        w: FILL,
        radius: r("lg"),
        stroke: { paint: c("border") },
      })
      for (const [i, [label, value, note]] of (
        [
          ["Active projects", "7", "3 need attention"],
          ["Hours this week", "318", "of 360"],
        ] as const
      ).entries()) {
        const cell = b.col(strip, "Cell", {
          w: FILL,
          ...(i === 0 ? {} : { stroke: { paint: c("border"), width: { l: 1 } } }),
        })
        b.use(cell, countCell, { props: { w: FILL }, args: { label, value, note } })
      }
      const cols = b.row(area, "Columns", { w: FILL, gap: 12, align: "start" })
      b.use(cols, boardColumn, {
        props: { w: FILL },
        args: { name: "In design", count: "2", icon: "design" },
        slots: {
          ColCards: (into) => {
            b.use(into, taskCard, {
              props: { w: FILL },
              args: {
                id: "FW-142",
                title: "Checkout: payment step, mobile",
                initials: "AS",
                due: "Oct 8",
                comments: "3",
                hours: "6 h left",
                kind: "web",
              },
            })
            b.use(into, taskCard, {
              props: { w: FILL },
              args: {
                id: "HB-031",
                title: "Logo lockups for Halden",
                initials: "MB",
                due: "Oct 9",
                comments: "5",
                hours: "12 h left",
                kind: "brand",
              },
              set: { CdAv: { args: { initials: "MB", size: "sm", tone: "two" } } },
            })
          },
        },
      })
      b.use(cols, boardColumn, {
        props: { w: FILL },
        args: { name: "In review", count: "1", icon: "review" },
        slots: {
          ColCards: (into) =>
            b.use(into, taskCard, {
              props: { w: FILL },
              args: {
                id: "OR-019",
                title: "Title sequence, cut 3",
                initials: "TN",
                due: "Oct 7",
                comments: "8",
                hours: "2 h left",
                kind: "motion",
              },
              set: { CdAv: { args: { initials: "TN", size: "sm", tone: "four" } } },
            }),
        },
      })
      const inbox = b.col(area, "Waiting on you", {
        w: FILL,
        radius: r("lg"),
        stroke: { paint: c("border") },
        clip: true,
      })
      for (const [who, title, detail, time] of [
        ["MB", "Mateo asked for review", "Checkout flow, v4 (FW-018)", "9:12"],
        ["IO", "Ines needs a decision", "Kestrel shortlist: 6 or 3 names?", "Mon"],
      ] as const)
        b.use(inbox, inboxRow, {
          props: { w: FILL },
          args: { who, title, detail, time },
          set: { InAv: { args: { initials: who, size: "md", tone: tone(who) } } },
        })
    },
  })

  // --- Screens ---------------------------------------------------------------------------------

  const screens = b.page("Screens")

  // Overview
  {
    const panel = shell("Overview", "overview", ["Northbeam Studio", "Overview"], (into) => {
      b.use(into, buttonSecondary, { args: { label: "Log time", size: "sm" } })
      b.use(into, button, { args: { label: "New project", size: "sm", icon: true } })
    })
    const body = b.col(panel, "Body", { w: FILL, h: FILL, pad: [24, 28], gap: 22 })
    const head = b.col(body, "Heading", { w: FILL, gap: 8 })
    b.text(head, "Tuesday 6 October", cap(), muted)
    b.text(
      head,
      "Good morning, Clara",
      b.ty("display", { size: 28, letterSpacing: -0.9, lineHeight: 1.1 }),
      ink,
    )

    const strip = b.row(body, "Counts", {
      w: FILL,
      radius: r("lg"),
      stroke: { paint: c("border") },
    })
    for (const [i, [label, value, note, t]] of (
      [
        ["Active projects", "7", "3 need attention", "warning"],
        ["Hours this week", "318", "of 360, 88%", "neutral"],
        ["Due this week", "10", "3 today", "danger"],
        ["Budget burn, studio", "64%", "1 project over", "danger"],
      ] as const
    ).entries()) {
      const cell = b.col(strip, "Cell", {
        w: FILL,
        ...(i === 0 ? {} : { stroke: { paint: c("border"), width: { l: 1 } } }),
      })
      b.use(cell, countCell, { props: { w: FILL }, args: { label, value, note, tone: t } })
    }

    const mid = b.row(body, "Week and inbox", { w: FILL, gap: 20, align: "stretch" })
    const week = b.col(mid, "This week", {
      w: FILL,
      radius: r("lg"),
      stroke: { paint: c("border") },
      clip: true,
    })
    const wh = b.row(week, "Header", {
      w: FILL,
      pad: [12, 16],
      justify: "between",
      align: "center",
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    b.text(wh, "This week", b.ty("heading"), ink)
    const nav = b.row(wh, "Range", { gap: 10, align: "center" })
    b.icon(nav, "chevron-left", 14, muted)
    b.text(nav, "Oct 5 to Oct 9", b.ty("mono", { size: 11 }), muted)
    b.icon(nav, "chevron-right", 14, muted)
    const days = b.row(week, "Days", { w: FILL, h: FILL, align: "stretch" })
    const dayItems: [string, string, boolean, [string, string, string, string][]][] = [
      [
        "Mon",
        "5",
        false,
        [
          ["Halden logo lockups, round 1", "HB-021", "10:00", "brand"],
          ["Lumo portal: IA sign-off", "LU-014", "15:00", "web"],
        ],
      ],
      [
        "Tue",
        "6",
        true,
        [
          ["Checkout flow, v4", "FW-018", "12:00", "web"],
          ["Orbit title sequence, cut 3", "OR-007", "17:00", "motion"],
          ["Marlow report: cover proof", "MA-011", "17:30", "print"],
        ],
      ],
      [
        "Wed",
        "7",
        false,
        [
          ["Kestrel naming shortlist", "KE-003", "11:00", "strategy"],
          ["Pine & Co dielines", "PC-009", "16:00", "print"],
        ],
      ],
      ["Thu", "8", false, [["Juno onboarding prototype", "JU-016", "14:00", "web"]]],
      [
        "Fri",
        "9",
        false,
        [
          ["Halden brand guide draft", "HB-021", "12:00", "brand"],
          ["Fernway QA handoff", "FW-018", "16:00", "web"],
        ],
      ],
    ]
    for (const [i, [d, n, today, items]] of dayItems.entries()) {
      const col = b.col(days, d, {
        w: FILL,
        gap: 8,
        pad: 10,
        fill: today ? c("subtle") : c("surface"),
        ...(i === 0 ? {} : { stroke: { paint: c("border"), width: { l: 1 } } }),
      })
      const dh = b.row(col, "Day", { gap: 6, align: "center", pad: [0, 0, 4, 0] })
      b.text(dh, d, cap({ size: 10 }), today ? c("accent") : muted)
      b.text(dh, n, b.ty("heading", { size: 13 }), today ? c("accent") : ink)
      for (const [t, proj, time, kind] of items)
        b.use(col, deliverable, {
          props: { w: FILL },
          args: { title: t, project: proj, time, kind },
        })
    }

    const inbox = b.col(mid, "Waiting on you", {
      w: 380,
      radius: r("lg"),
      stroke: { paint: c("border") },
      clip: true,
    })
    const ih = b.row(inbox, "Header", {
      w: FILL,
      pad: [12, 16],
      justify: "between",
      align: "center",
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    b.text(ih, "Waiting on you", b.ty("heading"), ink)
    b.use(ih, chip, { args: { label: "4 new", tone: "accent" } })
    for (const [who, title, detail, time, unread] of [
      ["MB", "Mateo asked for review", "Checkout flow, v4 (FW-018)", "9:12", true],
      ["TN", "Theo uploaded cut 3", "Orbit title sequence (OR-007)", "8:40", true],
      ["IO", "Ines needs a decision", "Kestrel shortlist: 6 or 3 names?", "Mon", true],
      ["JW", "Jonas moved a deadline", "Marlow report to Oct 14", "Mon", true],
      ["AS", "Ana commented", "Lumo portal, empty states", "Fri", false],
    ] as const)
      b.use(inbox, inboxRow, {
        props: { w: FILL },
        args: { who, title, detail, time, unread },
        set: { InAv: { args: { initials: who, size: "md", tone: tone(who) } } },
      })

    // Capacity
    const cap_ = b.col(body, "Capacity", { w: FILL, gap: 10 })
    const ch = b.row(cap_, "Header", { w: FILL, justify: "between", align: "center" })
    b.text(ch, "Capacity, next four weeks", b.ty("heading"), ink)
    const legend = b.row(ch, "Legend", { gap: 6, align: "center" })
    b.text(legend, "Free", b.ty("mono", { size: 10 }), muted)
    for (const l of ["subtle", "load-1", "load-2", "load-3", "accent"])
      b.rect(legend, "Level", {
        w: 14,
        h: 10,
        radius: 2,
        fill: c(l),
        stroke: { paint: c("border") },
      })
    b.text(legend, "Over", b.ty("mono", { size: 10 }), muted)
    const grid = b.col(cap_, "Grid", {
      w: FILL,
      radius: r("lg"),
      stroke: { paint: c("border") },
      clip: true,
    })
    const levels = ["subtle", "load-1", "load-2", "load-3", "accent"]
    const load: [string, string, number[]][] = [
      ["CD", "Studio lead", [2, 2, 3, 2, 3, 3, 3, 2, 2, 3, 3, 2, 2, 2, 1, 1, 2, 2, 2, 1]],
      ["MB", "Design lead", [3, 3, 4, 3, 3, 3, 3, 3, 4, 3, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2]],
      ["AS", "Senior designer", [2, 3, 3, 3, 2, 3, 2, 2, 2, 1, 2, 3, 3, 3, 3, 2, 2, 2, 2, 2]],
      ["TN", "Motion lead", [4, 4, 3, 4, 4, 3, 3, 3, 3, 2, 1, 1, 0, 1, 1, 2, 2, 3, 3, 3]],
      ["IO", "Strategist", [3, 3, 3, 3, 3, 2, 2, 3, 3, 3, 3, 3, 2, 2, 2, 1, 1, 1, 2, 2]],
      ["PM", "Designer", [2, 2, 3, 2, 2, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1]],
    ]
    for (const [i, [ini, role, cells]] of load.entries()) {
      const row = b.row(grid, name(ini), {
        w: FILL,
        pad: [8, 16],
        gap: 12,
        align: "center",
        ...(i === 0 ? {} : { stroke: { paint: c("border"), width: { t: 1 } } }),
      })
      const who = b.row(row, "Person", { w: 220, gap: 8, align: "center" })
      b.use(who, avatar, { args: { initials: ini, size: "xs", tone: tone(ini) } })
      b.text(who, name(ini), b.ty("label", { size: 12 }), ink)
      b.text(who, role, b.ty("small", { size: 11 }), muted)
      for (let wk = 0; wk < 4; wk++) {
        const weekCells = b.row(row, `Week ${wk + 1}`, { w: FILL, gap: 3 })
        for (let d = 0; d < 5; d++)
          b.rect(weekCells, "Day", {
            w: FILL,
            h: 14,
            radius: 2,
            fill: c(levels[cells[wk * 5 + d]]),
            stroke: { paint: c("border") },
          })
      }
    }
  }

  // Projects
  {
    const panel = shell("Projects", "projects", ["Northbeam Studio", "Projects"], (into) => {
      b.use(into, buttonSecondary, {
        args: { label: "Filter", size: "sm", icon: true },
        set: { BtnIcon: { icon: "list-filter" } },
      })
      b.use(into, button, { args: { label: "New project", size: "sm", icon: true } })
    })
    const head = b.col(panel, "Heading", { w: FILL, pad: [20, 20, 0, 20], gap: 14 })
    const t = b.row(head, "Title", { w: FILL, gap: 12, align: "baseline" })
    b.text(t, "Projects", b.ty("title"), ink)
    b.text(t, "15 in total, 7 active", b.ty("mono", { size: 12 }), muted)
    tabs(
      head,
      [
        ["All", "15"],
        ["Active", "7"],
        ["Planning", "3"],
        ["Done", "5"],
      ],
      1,
    )

    const table = b.col(panel, "Table", { w: FILL })
    const th = b.row(table, "Columns", {
      w: FILL,
      h: 32,
      gap: 12,
      pad: [0, 20],
      align: "center",
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    b.para(th, "ID", cap({ size: 10 }), muted, { w: 56 })
    b.para(th, "Project", cap({ size: 10 }), muted)
    b.para(th, "Health", cap({ size: 10 }), muted, { w: 112 })
    b.para(th, "Lead", cap({ size: 10 }), muted, { w: 132 })
    b.para(th, "Discipline", cap({ size: 10 }), muted, { w: 96 })
    b.para(th, "Progress", cap({ size: 10 }), muted, { w: 140 })
    b.para(th, "Hours", cap({ size: 10, align: "right" }), muted, { w: 88 })
    b.para(th, "Target", cap({ size: 10, align: "right" }), muted, { w: 64 })
    const row = (
      parent: string,
      id: string,
      nm: string,
      client: string,
      state: string,
      lead: string,
      kind: string,
      pct: number,
      spent: string,
      target: string,
    ) =>
      b.use(parent, projectRow, {
        props: { w: FILL },
        args: {
          id,
          name: nm,
          client,
          lead,
          leadName: name(lead),
          percent: `${pct}%`,
          budget: spent,
          target,
        },
        set: {
          PrHealth: { args: { state } },
          PrLead: { args: { initials: lead, size: "xs", tone: tone(lead) } },
          PrDisc: { args: { kind } },
          "PrMeter/MtFill": {
            w: Math.round(pct * 0.96),
            fill: state === "at-risk" ? c("warning") : state === "off-track" ? c("danger") : ink,
          },
        },
      })
    b.use(table, groupHeader, { props: { w: FILL }, args: { name: "In progress", count: "7" } })
    row(
      table,
      "FW-018",
      "Fernway checkout redesign",
      "Fernway Foods",
      "on-track",
      "CD",
      "web",
      62,
      "212 / 340 h",
      "Oct 30",
    )
    row(
      table,
      "HB-021",
      "Halden brand refresh",
      "Halden & Co",
      "at-risk",
      "MB",
      "brand",
      48,
      "190 / 400 h",
      "Nov 13",
    )
    row(
      table,
      "OR-007",
      "Orbit film titles",
      "Orbit Fitness",
      "on-track",
      "TN",
      "motion",
      81,
      "162 / 200 h",
      "Oct 16",
    )
    row(
      table,
      "LU-014",
      "Lumo patient portal",
      "Lumo Health",
      "off-track",
      "AS",
      "web",
      70,
      "640 / 600 h",
      "Oct 9",
    )
    row(
      table,
      "MA-011",
      "Marlow annual report 2026",
      "Marlow Capital",
      "on-track",
      "NH",
      "print",
      55,
      "98 / 180 h",
      "Nov 6",
    )
    row(
      table,
      "KE-003",
      "Kestrel naming and strategy",
      "Kestrel Energy",
      "at-risk",
      "IO",
      "strategy",
      34,
      "70 / 220 h",
      "Nov 20",
    )
    row(
      table,
      "JU-016",
      "Juno app onboarding",
      "Juno Mobility",
      "on-track",
      "PM",
      "web",
      44,
      "120 / 280 h",
      "Dec 4",
    )
    b.use(table, groupHeader, { props: { w: FILL }, args: { name: "Planning", count: "3" } })
    row(
      table,
      "AT-024",
      "Atlas rebrand pitch",
      "Atlas Logistics",
      "planning",
      "CD",
      "brand",
      5,
      "8 / 60 h",
      "Nov 27",
    )
    row(
      table,
      "PC-009",
      "Pine & Co packaging",
      "Pine & Co",
      "planning",
      "NH",
      "print",
      0,
      "0 / 140 h",
      "Jan 15",
    )
    row(
      table,
      "TW-026",
      "Tidewater website",
      "Tidewater Hotels",
      "planning",
      "JW",
      "web",
      0,
      "0 / 320 h",
      "Feb 12",
    )
    b.use(table, groupHeader, {
      props: { w: FILL },
      args: { name: "Done", count: "5", open: "closed" },
    })
  }

  // Project board
  {
    const panel = shell(
      "Fernway checkout redesign",
      "projects",
      ["Projects", "Fernway checkout redesign"],
      (into) => {
        b.use(into, buttonSecondary, { args: { label: "Share", size: "sm" } })
        b.use(into, button, { args: { label: "New task", size: "sm", icon: true } })
      },
    )
    const head = b.col(panel, "Heading", { w: FILL, pad: [20, 20, 0, 20], gap: 14 })
    const t = b.row(head, "Title", { w: FILL, gap: 12, align: "center" })
    b.text(t, "Fernway checkout redesign", b.ty("title"), ink)
    b.text(t, "FW-018", b.ty("mono", { size: 12 }), muted)
    b.use(t, health, { args: { state: "on-track" } })
    const props = b.row(head, "Properties", { w: FILL, gap: 32, align: "end" })
    const prop = (label: string) => {
      const col = b.col(props, label, { gap: 4 })
      b.text(col, label, cap({ size: 10 }), muted)
      return col
    }
    {
      const col = prop("Client")
      b.text(col, "Fernway Foods", b.ty("label"), ink)
    }
    {
      const col = prop("Lead")
      const r_ = b.row(col, "Lead", { gap: 8, align: "center" })
      b.use(r_, avatar, { args: { initials: "CD", size: "xs", tone: "one" } })
      b.text(r_, "Clara Dumont", b.ty("label"), ink)
    }
    {
      const col = prop("Hours")
      const r_ = b.row(col, "Hours", { gap: 10, align: "center" })
      b.use(r_, meter, { set: { MtFill: { w: 60, fill: ink } } })
      b.text(r_, "212 of 340 h", b.ty("mono", { size: 12 }), ink)
    }
    {
      const col = prop("Deadline")
      b.text(col, "Oct 30, 2026", b.ty("mono", { size: 12 }), ink)
    }
    {
      const col = prop("Team")
      const r_ = b.row(col, "Team", { gap: 4 })
      for (const ini of ["CD", "MB", "AS", "PM"])
        b.use(r_, avatar, { args: { initials: ini, size: "sm", tone: tone(ini) } })
    }
    tabs(
      head,
      [
        ["Board", ""],
        ["List", ""],
        ["Timeline", ""],
        ["Files", "14"],
      ],
      0,
    )

    const board = b.row(panel, "Board", { w: FILL, h: FILL, gap: 12, pad: 16, align: "start" })
    type Card = [string, string, string, string, string, string, string]
    const col = (nm: string, count: string, icon: string, cards: Card[]) =>
      b.use(board, boardColumn, {
        props: { w: 260 },
        args: { name: nm, count, icon },
        ...(nm === "In review" ? { set: { ColCount: { fill: c("warning") } } } : {}),
        slots: {
          ColCards: (into) => {
            for (const [id, title, ini, due, com, hours, kind] of cards)
              b.use(into, taskCard, {
                props: { w: FILL },
                args: { id, title, due, comments: com, hours, kind },
                set: { CdAv: { args: { initials: ini, size: "sm", tone: tone(ini) } } },
              })
          },
        },
      })
    col("Brief", "2", "brief", [
      ["FW-151", "Gift card and promo code states", "PM", "Oct 12", "2", "8 h left", "web"],
      ["FW-152", "Order confirmation email, plain text", "AS", "Oct 14", "0", "4 h left", "web"],
    ])
    col("In design", "4", "design", [
      ["FW-142", "Payment step, mobile and tablet", "AS", "Oct 8", "3", "6 h left", "web"],
      ["FW-144", "Address form errors and autofill", "PM", "Oct 9", "1", "9 h left", "web"],
      ["FW-146", "Cart drawer motion spec", "TN", "Oct 9", "4", "5 h left", "motion"],
      ["FW-148", "Checkout illustrations, set of 4", "NH", "Oct 13", "2", "14 h left", "brand"],
    ])
    col("In review", "3 of 3", "review", [
      ["FW-137", "Checkout flow, v4 prototype", "MB", "Oct 6", "9", "2 h left", "web"],
      ["FW-139", "Copy deck for payment errors", "IO", "Oct 7", "5", "1 h left", "strategy"],
      ["FW-140", "Receipt page, print stylesheet", "NH", "Oct 7", "2", "3 h left", "print"],
    ])
    col("Handoff", "2", "handoff", [
      ["FW-129", "Tokens and component specs, v2", "MB", "Oct 5", "6", "0 h left", "web"],
      ["FW-131", "Loading and empty states", "PM", "Oct 5", "1", "0 h left", "web"],
    ])
    const done = b.col(board, "Done", {
      w: 56,
      h: FILL,
      pad: [12, 0],
      gap: 12,
      align: "center",
      radius: r("xl"),
      fill: c("sunken"),
    })
    b.icon(done, "circle-check", 16, c("success"))
    b.text(done, "14", b.ty("mono", { size: 11 }), muted)
  }

  // Team
  {
    const panel = shell("Team", "team", ["Northbeam Studio", "Team"], (into) => {
      b.use(into, buttonSecondary, { args: { label: "Export", size: "sm" } })
      b.use(into, button, { args: { label: "Invite person", size: "sm", icon: true } })
    })
    const head = b.col(panel, "Heading", { w: FILL, pad: [20, 20, 0, 20], gap: 14 })
    const t = b.row(head, "Title", { w: FILL, gap: 12, align: "baseline" })
    b.text(t, "Team", b.ty("title"), ink)
    b.text(t, "9 people, 1 out today", b.ty("mono", { size: 12 }), muted)
    tabs(
      head,
      [
        ["Everyone", "9"],
        ["Design", "5"],
        ["Motion", "2"],
        ["Strategy", "2"],
      ],
      0,
    )

    const out = b.row(panel, "Out this week", {
      w: FILL,
      pad: [10, 20],
      gap: 12,
      align: "center",
      fill: c("subtle"),
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    b.icon(out, "plane", 14, muted)
    b.text(out, "Out this week", b.ty("label", { size: 12 }), ink)
    b.text(out, "Lucas Ferreira, Oct 5 to 7", b.ty("mono", { size: 11 }), muted)
    b.rect(out, "Rule", { w: 1, h: 12, fill: c("border-strong") })
    b.text(out, "Noor Haddad, Oct 8 to 9", b.ty("mono", { size: 11 }), muted)

    const table = b.col(panel, "Table", { w: FILL })
    const th = b.row(table, "Columns", {
      w: FILL,
      h: 32,
      gap: 12,
      pad: [0, 20],
      align: "center",
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    b.para(th, "Person", cap({ size: 10 }), muted)
    b.para(th, "Role", cap({ size: 10 }), muted, { w: 150 })
    b.para(th, "Discipline", cap({ size: 10 }), muted, { w: 110 })
    b.para(th, "Allocation, next 4 weeks", cap({ size: 10 }), muted, { w: 170 })
    b.para(th, "This week", cap({ size: 10, align: "right" }), muted, { w: 80 })
    b.para(th, "Status", cap({ size: 10 }), muted, { w: 84 })
    b.rect(th, "Actions", { w: 16, h: 1, fill: c("surface") })
    const person = (
      ini: string,
      role: string,
      kind: string,
      pct: number,
      hrs: string,
      status: string,
      tn: string,
      color?: string,
    ) =>
      b.use(table, personRow, {
        props: { w: FILL },
        args: {
          initials: ini,
          name: name(ini),
          email: `${name(ini).split(" ")[0].toLowerCase()}@northbeam.studio`,
          role,
          percent: `${pct}%`,
          hours: hrs,
        },
        set: {
          PeAv: { args: { initials: ini, size: "md", tone: tone(ini) } },
          PeDisc: { args: { kind } },
          PeStatus: { args: { label: status, tone: tn, dot: true } },
          "PeMeter/MtFill": {
            w: Math.min(96, Math.round(pct * 0.96)),
            fill: color ? c(color) : ink,
          },
        },
      })
    b.use(table, groupHeader, { props: { w: FILL }, args: { name: "Design", count: "5" } })
    person("CD", "Studio lead", "brand", 70, "28 / 40 h", "Active", "success")
    person("MB", "Design lead", "brand", 95, "38 / 40 h", "Active", "success")
    person("AS", "Senior designer", "web", 100, "40 / 40 h", "Active", "success", "warning")
    person("PM", "Designer", "web", 80, "32 / 40 h", "Active", "success")
    person("NH", "Print designer", "print", 85, "34 / 40 h", "Active", "success")
    b.use(table, groupHeader, {
      props: { w: FILL },
      args: { name: "Motion and strategy", count: "3" },
    })
    person("TN", "Motion lead", "motion", 110, "44 / 40 h", "Active", "success", "danger")
    person("LF", "Motion designer", "motion", 70, "0 / 40 h", "Out", "warning")
    person("IO", "Strategist", "strategy", 90, "36 / 40 h", "Active", "success")
    b.use(table, groupHeader, { props: { w: FILL }, args: { name: "Invited", count: "1" } })
    person("JW", "Producer", "strategy", 0, "0 / 40 h", "Invited", "neutral")
  }

  // Settings
  {
    const panel = shell("Settings", "settings", ["Settings", "General"])
    const row = b.row(panel, "Body", { w: FILL, h: FILL })
    b.use(row, settingsNav, { props: { h: FILL }, args: { active: "general" } })
    const body = b.col(row, "Content", { w: FILL, h: FILL, pad: [28, 40, 0, 40], gap: 4 })
    b.text(body, "General", b.ty("title"), ink)
    b.para(
      body,
      "Studio-wide defaults. Changes apply to everyone on the next page load.",
      b.ty("body"),
      muted,
    )
    b.rect(body, "Gap", { w: FILL, h: 12, fill: c("surface") })
    const frow = (
      label: string,
      hint: string,
      fill: (into: { inst: string; at: string }) => void,
    ) =>
      b.use(body, formRow, { props: { w: 760 }, args: { label, hint }, slots: { FrControl: fill } })
    frow("Logo", "Square, at least 256 px. Shown in the sidebar and on invoices.", (into) => {
      const lr = b.row(into, "Logo", { gap: 12, align: "center" })
      const mark = b.row(lr, "Mark", {
        w: 48,
        h: 48,
        radius: r("lg"),
        fill: ink,
        align: "center",
        justify: "center",
      })
      b.text(mark, "N", b.ty("title"), c("on-ink"))
      b.use(lr, buttonSecondary, { args: { label: "Upload", size: "sm" } })
      b.use(lr, button, { args: { label: "Remove", size: "sm", variant: "ghost" } })
    })
    frow("Studio name", "Shown in the sidebar, invoices and shared links.", (into) =>
      b.use(into, field, { props: { w: FILL }, args: { value: "Northbeam Studio" } }),
    )
    frow("Workspace URL", "Letters, numbers and hyphens. Changing it breaks old links.", (into) =>
      b.use(into, field, {
        props: { w: FILL },
        args: { value: "northbeam", showPrefix: true, prefix: "fieldwork.app/" },
      }),
    )
    frow("Week starts on", "Used by the week grid, capacity and timesheets.", (into) =>
      b.use(into, field, { props: { w: 200 }, args: { value: "Monday", icon: true } }),
    )
    frow(
      "Hours per person per day",
      "Capacity is calculated from this. Part-time people can override it.",
      (into) => b.use(into, field, { props: { w: 120 }, args: { value: "8" } }),
    )
    frow("Time entries", "Control what people have to fill in when they log time.", (into) => {
      b.use(into, toggle, {
        props: { w: FILL },
        args: { label: "Require a project on every entry", state: "on" },
      })
      b.use(into, toggle, {
        props: { w: FILL },
        args: { label: "Show budget burn to everyone", state: "off" },
      })
    })
    frow(
      "Delete workspace",
      "Removes every project, file and time entry. This cannot be undone.",
      (into) =>
        b.use(into, button, { args: { label: "Delete workspace", size: "sm", variant: "danger" } }),
    )
    const save = b.row(body, "Save", { w: FILL, gap: 12, pad: [20, 0, 0, 0], align: "center" })
    b.use(save, button, { args: { label: "Save changes", variant: "dark" } })
    b.use(save, buttonSecondary, { args: { label: "Cancel" } })
    b.text(save, "You have unsaved changes", b.ty("small"), muted)
  }

  // Billing
  {
    const panel = shell("Billing", "settings", ["Settings", "Billing"])
    const row = b.row(panel, "Body", { w: FILL, h: FILL })
    b.use(row, settingsNav, { props: { h: FILL }, args: { active: "billing" } })
    const body = b.col(row, "Content", { w: FILL, h: FILL, pad: [24, 40, 0, 40], gap: 16 })
    const ttl = b.col(body, "Title", { gap: 4 })
    b.text(ttl, "Billing", b.ty("title"), ink)
    b.text(
      ttl,
      "Seats are billed monthly. Invoices go to billing@northbeam.studio.",
      b.ty("body"),
      muted,
    )

    const plan = b.col(body, "Plan", {
      w: 760,
      radius: r("lg"),
      stroke: { paint: c("border") },
      clip: true,
    })
    const ph = b.row(plan, "Header", {
      w: FILL,
      pad: [12, 16],
      justify: "between",
      align: "center",
      fill: c("subtle"),
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    b.text(ph, "Current plan", b.ty("heading"), ink)
    const btns = b.row(ph, "Actions", { gap: 8 })
    b.use(btns, buttonSecondary, { args: { label: "Add seats", size: "sm" } })
    b.use(btns, button, { args: { label: "Change plan", size: "sm", variant: "dark" } })
    const pb = b.row(plan, "Details", { w: FILL, gap: 24, pad: 20, align: "start" })
    const price = b.col(pb, "Price", { w: 200, gap: 6 })
    b.text(price, "Studio", cap({ size: 10 }), muted)
    b.text(price, "$24", b.ty("figure", { size: 34 }), ink)
    b.text(price, "per seat, per month", b.ty("small"), muted)
    const seats = b.col(pb, "Seats", { w: FILL, gap: 8 })
    b.text(seats, "Seats", cap({ size: 10 }), muted)
    b.text(seats, "9 of 10 in use", b.ty("heading", { size: 16 }), ink)
    b.use(seats, meter, { props: { w: FILL }, set: { MtFill: { w: 240, fill: ink } } })
    const renew = b.col(pb, "Renewal", { w: 200, gap: 6 })
    b.text(renew, "Renews", cap({ size: 10 }), muted)
    b.text(renew, "Nov 1, 2026", b.ty("heading", { size: 16 }), ink)
    b.text(renew, "$216.00 for 9 seats", b.ty("small"), muted)

    const two = b.row(body, "Payment", { w: 760, gap: 20, align: "stretch" })
    for (const [titleText, lines, icon] of [
      ["Payment method", ["Visa ending 4242", "Expires 08/2028"], "credit-card"],
      ["Billing contact", ["Clara Dumont", "billing@northbeam.studio"], "mail"],
    ] as const) {
      const box = b.row(two, titleText, {
        w: FILL,
        gap: 14,
        pad: 16,
        align: "center",
        radius: r("lg"),
        stroke: { paint: c("border") },
      })
      const tile = b.row(box, "Icon", {
        w: 36,
        h: 36,
        radius: r("md"),
        fill: c("subtle"),
        align: "center",
        justify: "center",
      })
      b.icon(tile, icon, 18, ink)
      const tx = b.col(box, "Text", { w: FILL, gap: 2 })
      b.text(tx, titleText, cap({ size: 10 }), muted)
      b.text(tx, lines[0], b.ty("label"), ink)
      b.text(tx, lines[1], b.ty("small"), muted)
      b.use(box, buttonSecondary, { args: { label: "Update", size: "sm" } })
    }

    const use = b.col(body, "Usage", { w: 760, gap: 10 })
    b.text(use, "Usage this cycle", b.ty("heading"), ink)
    const ur = b.row(use, "Meters", { w: FILL, gap: 20 })
    for (const [labelText, valueText, w] of [
      ["Storage", "38 of 100 GB", 36],
      ["Guest reviewers", "4 of 10", 38],
    ] as const) {
      const box = b.col(ur, labelText, {
        w: FILL,
        gap: 8,
        pad: 16,
        radius: r("lg"),
        stroke: { paint: c("border") },
      })
      const hd = b.row(box, "Head", { w: FILL, justify: "between" })
      b.text(hd, labelText, cap({ size: 10 }), muted)
      b.text(hd, valueText, b.ty("mono", { size: 12 }), ink)
      b.use(box, meter, { props: { w: FILL }, set: { MtFill: { w, fill: ink } } })
    }
    const inv = b.col(body, "Invoices", { w: 760, gap: 10 })
    b.text(inv, "Invoices", b.ty("heading"), ink)
    const it = b.col(inv, "Table", {
      w: FILL,
      radius: r("lg"),
      stroke: { paint: c("border") },
      clip: true,
    })
    for (const [date, num, amt] of [
      ["Oct 1, 2026", "FW-2026-10", "$216.00"],
      ["Sep 1, 2026", "FW-2026-09", "$216.00"],
      ["Aug 1, 2026", "FW-2026-08", "$192.00"],
      ["Jul 1, 2026", "FW-2026-07", "$192.00"],
    ] as const)
      b.use(it, invoiceRow, { props: { w: FILL }, args: { date, number: num, amount: amt } })
  }
}
