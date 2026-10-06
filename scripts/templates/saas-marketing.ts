/**
 * Ledgerline: the marketing site of a fictional month-end close tool for finance teams.
 * Screens: Home, Pricing, Customers, Blog, Blog post, Sign up (desktop, 1440 wide).
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
      bg: ["#FBFAF8", "#0E1116"],
      surface: ["#FFFFFF", "#161B22"],
      subtle: ["#F3F1EC", "#1C222B"],
      ink: ["#14171C", "#EEF1F5"],
      muted: ["#5B6270", "#9AA3B2"],
      border: ["#E6E2DA", "#2A313C"],
      accent: ["#2F5BEA", "#7C9BFF"],
      "accent-soft": ["#E8EEFF", "#1C2747"],
      "on-accent": ["#FFFFFF", "#0E1116"],
      success: ["#127A4B", "#4ACB8B"],
      "success-soft": ["#E3F5EC", "#13301F"],
      warning: ["#A35C00", "#F2B54B"],
      "warning-soft": ["#FDF1DC", "#33240C"],
      inverse: ["#14213D", "#1B2A4A"],
      "on-inverse": ["#FFFFFF", "#EEF1F5"],
      "inverse-muted": ["#AEB9CF", "#9FB0CF"],
      "art-1": ["#C9D6FF", "#2A3A6E"],
      "art-2": ["#CDEBDD", "#1F4A36"],
      "art-3": ["#F7DDB7", "#5A3F17"],
      "art-4": ["#F5CFD6", "#5A2431"],
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
      "radius/sm": 6,
      "radius/md": 10,
      "radius/lg": 16,
      "radius/xl": 24,
      "radius/pill": 999,
    },
    type: {
      display: { font: "Inter", size: 64, weight: 700, lineHeight: 1.05, letterSpacing: -2 },
      h1: { font: "Inter", size: 48, weight: 700, lineHeight: 1.1, letterSpacing: -1.2 },
      heading: { font: "Inter", size: 32, weight: 700, lineHeight: 1.2, letterSpacing: -0.6 },
      title: { font: "Inter", size: 20, weight: 600, lineHeight: 1.35, letterSpacing: -0.2 },
      "body-lg": { font: "Inter", size: 18, weight: 400, lineHeight: 1.6 },
      body: { font: "Inter", size: 16, weight: 400, lineHeight: 1.55 },
      label: { font: "Inter", size: 14, weight: 600, lineHeight: 1.3 },
      small: { font: "Inter", size: 13, weight: 400, lineHeight: 1.45 },
      mono: { font: "JetBrains Mono", size: 13, weight: 500, lineHeight: 1.4 },
    },
    shadows: {
      card: [
        { kind: "shadow", x: 0, y: 1, blur: 2, color: "#1418200F" },
        { kind: "shadow", x: 0, y: 8, blur: 24, spread: -8, color: "#1418201F" },
      ],
      pop: { kind: "shadow", x: 0, y: 24, blur: 64, spread: -16, color: "#14182040" },
    },
  })

  const c = (n: string) => b.c(n)
  const s = (n: number) => b.n(`space/${n}`)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  const grad = (from: string, to: string) => ({
    kind: "linear",
    rotation: 135,
    stops: [
      { color: c(from), at: 0 },
      { color: c(to), at: 1 },
    ],
  })

  // --- Components ------------------------------------------------------------------------------

  const button = b.component(
    "Button",
    {
      key: "Btn",
      section: "Actions",
      description: "Primary, secondary or subtle; md or lg. One primary per view.",
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
          subtle: {
            "root.fill": c("subtle"),
            "root.stroke": { paint: c("subtle") },
            "BtnLabel.fill": ink,
            "BtnIcon.color": ink,
          },
        }),
        size: p.variants({
          md: { "root.layout/pad": [10, 16], "BtnLabel.style/size": 14 },
          lg: { "root.layout/pad": [14, 22], "BtnLabel.style/size": 16 },
        }),
      },
      root: {
        dir: "row",
        gap: 8,
        align: "center",
        justify: "center",
        pad: [10, 16],
        radius: r("md"),
        fill: c("accent"),
        stroke: { paint: c("accent") },
      },
    },
    (root) => {
      b.text(root, "Button", b.ty("label"), c("on-accent"), { key: "BtnLabel", name: "Label" })
      b.icon(root, "arrow-right", 16, c("on-accent"), { key: "BtnIcon", visible: false })
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
      section: "Actions",
      props: {
        label: p.text("BadgeLbl", "Badge"),
        tone: p.variants({
          accent: { "root.fill": c("accent-soft"), "BadgeLbl.fill": c("accent") },
          neutral: { "root.fill": c("subtle"), "BadgeLbl.fill": muted },
          success: { "root.fill": c("success-soft"), "BadgeLbl.fill": c("success") },
          warning: { "root.fill": c("warning-soft"), "BadgeLbl.fill": c("warning") },
        }),
      },
      root: { dir: "row", pad: [4, 10], radius: r("pill"), fill: c("accent-soft") },
    },
    (root) =>
      b.text(root, "Badge", b.ty("small", { weight: 600 }), c("accent"), {
        key: "BadgeLbl",
        name: "Label",
      }),
  )

  const avatar = b.component(
    "Avatar",
    {
      key: "Avatar",
      section: "Content",
      props: {
        initials: p.text("AvInit", "MO"),
        size: p.variants({
          sm: { "root.w": 28, "root.h": 28, "AvInit.style/size": 11 },
          md: { "root.w": 40, "root.h": 40, "AvInit.style/size": 14 },
          lg: { "root.w": 56, "root.h": 56, "AvInit.style/size": 18 },
        }),
        tone: p.variants({
          blue: { "root.fill": c("art-1") },
          green: { "root.fill": c("art-2") },
          amber: { "root.fill": c("art-3") },
          rose: { "root.fill": c("art-4") },
        }),
      },
      root: {
        dir: "row",
        w: 40,
        h: 40,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("art-1"),
      },
    },
    (root) => b.text(root, "MO", b.ty("label"), ink, { key: "AvInit", name: "Initials" }),
  )

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
        pad: [20, 120],
        fill: c("bg"),
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      brand(root)
      const links = b.row(root, "Links", { gap: 36, align: "center" })
      for (const [i, l] of navLinks.entries())
        b.text(links, l, b.ty("body", { weight: 500 }), i === 0 ? ink : muted, {
          key: `NavL${i + 1}`,
        })
      const right = b.row(root, "Actions", { gap: 20, align: "center" })
      b.text(right, "Sign in", b.ty("body", { weight: 500 }), ink)
      b.use(right, button, { key: "NavCta", args: { label: "Start free trial" } })
    },
  )
  function brand(parent: string, onInverse = false) {
    const row = b.row(parent, "Brand", { gap: 10, align: "center" })
    const mark = b.row(row, "Mark", {
      w: 28,
      h: 28,
      radius: 8,
      fill: c("accent"),
      align: "center",
      justify: "center",
    })
    b.icon(mark, "book-check", 16, c("on-accent"))
    b.text(row, "Ledgerline", b.ty("title", { weight: 700 }), onInverse ? c("on-inverse") : ink, {
      name: "Wordmark",
    })
    return row
  }

  const footer = b.component(
    "Footer",
    {
      key: "Footer",
      section: "Navigation",
      root: {
        dir: "column",
        w: 1440,
        gap: 48,
        pad: [64, 120, 40, 120],
        fill: c("subtle"),
      },
    },
    (root) => {
      const top = b.row(root, "Top", { w: FILL, gap: 64 })
      const about = b.col(top, "About", { w: 360, gap: 16 })
      brand(about)
      b.para(
        about,
        "Close software for finance teams on NetSuite, Sage Intacct, QuickBooks and Xero.",
        b.ty("body"),
        muted,
      )
      for (const [title, items] of [
        ["Product", ["Close checklist", "Reconciliations", "Flux analysis", "Integrations"]],
        ["Company", ["About", "Customers", "Careers", "Press"]],
        ["Resources", ["Blog", "Close guide", "Help center", "Status"]],
      ] as const) {
        const col = b.col(top, title, { w: FILL, gap: 14 })
        b.text(col, title, b.ty("label"), ink)
        for (const it of items) b.text(col, it, b.ty("body"), muted)
      }
      b.divider(root, c("border"))
      const bottom = b.row(root, "Bottom", { w: FILL, justify: "between", align: "center" })
      b.text(bottom, "Copyright 2026 Ledgerline, Inc.", b.ty("small"), muted)
      b.text(bottom, "Privacy  ·  Terms  ·  Security", b.ty("small"), muted)
    },
  )

  const sectionHeader = b.component(
    "Section header",
    {
      key: "SecHead",
      section: "Content",
      props: {
        eyebrow: p.text("SecEye", "Eyebrow"),
        title: p.text("SecTitle", "Section title"),
        subtitle: p.text("SecSub", "Supporting sentence."),
        showSubtitle: p.bool("SecSub", true),
        align: p.variants({
          center: {
            "root.layout/align": "center",
            "SecTitle.style/align": "center",
            "SecSub.style/align": "center",
          },
          left: {
            "root.layout/align": "start",
            "SecTitle.style/align": "left",
            "SecSub.style/align": "left",
          },
        }),
      },
      root: { dir: "column", w: 760, gap: 16, align: "center" },
    },
    (root) => {
      b.text(root, "Eyebrow", b.ty("label", { case: "upper", letterSpacing: 1 }), c("accent"), {
        key: "SecEye",
      })
      b.para(root, "Section title", b.ty("h1", { align: "center" }), ink, { key: "SecTitle" })
      b.para(root, "Supporting sentence.", b.ty("body-lg", { align: "center" }), muted, {
        key: "SecSub",
      })
    },
  )

  const featureCard = b.component(
    "Feature card",
    {
      key: "FeatCard",
      section: "Content",
      props: { title: p.text("FeatTitle", "Feature"), body: p.text("FeatBody", "What it does.") },
      root: {
        dir: "column",
        w: 384,
        gap: 16,
        pad: s(8),
        radius: r("lg"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      },
    },
    (root) => {
      const tile = b.row(root, "Icon tile", {
        w: 44,
        h: 44,
        radius: r("md"),
        fill: c("accent-soft"),
        align: "center",
        justify: "center",
      })
      b.icon(tile, "list-checks", 22, c("accent"), { key: "FeatIcon" })
      b.text(root, "Feature", b.ty("title"), ink, { key: "FeatTitle", name: "Title" })
      b.para(root, "What it does.", b.ty("body"), muted, { key: "FeatBody", name: "Body" })
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
      root: { dir: "column", w: 260, gap: 8 },
    },
    (root) => {
      b.text(root, "0", b.ty("h1"), ink, { key: "StatVal", name: "Value" })
      b.para(root, "Metric", b.ty("body"), muted, { key: "StatLbl", name: "Label" })
    },
  )

  const quote = b.component(
    "Quote card",
    {
      key: "Quote",
      section: "Content",
      props: {
        quote: p.text("QText", "Quote"),
        name: p.text("QName", "Name"),
        role: p.text("QRole", "Role"),
        initials: p.text("QAv/AvInit", "MO"),
      },
      root: {
        dir: "column",
        w: 384,
        gap: 24,
        pad: s(8),
        radius: r("lg"),
        fill: c("surface"),
        stroke: { paint: c("border") },
        effects: b.shadow("card"),
      },
    },
    (root) => {
      b.icon(root, "quote", 24, c("accent"))
      b.para(root, "Quote", b.ty("body-lg"), ink, { key: "QText", name: "Quote" })
      const who = b.row(root, "Person", { gap: 12, align: "center" })
      b.use(who, avatar, { key: "QAv" })
      const names = b.col(who, "Names", { gap: 2 })
      b.text(names, "Name", b.ty("label"), ink, { key: "QName" })
      b.text(names, "Role", b.ty("small"), muted, { key: "QRole" })
    },
  )

  const logo = b.component(
    "Customer logo",
    {
      key: "Logo",
      section: "Content",
      props: { name: p.text("LogoName", "Company") },
      root: { dir: "row", gap: 8, align: "center" },
    },
    (root) => {
      b.icon(root, "building-2", 22, muted, { key: "LogoIcon" })
      b.text(root, "Company", b.ty("title", { weight: 700, letterSpacing: -0.4 }), muted, {
        key: "LogoName",
        name: "Name",
      })
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
        w: 800,
        gap: 12,
        pad: [24, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const head = b.row(root, "Question row", { w: FILL, gap: 16, align: "center" })
      b.para(head, "Question", b.ty("title"), ink, { key: "FaqQ", name: "Question" })
      b.icon(head, "chevron-down", 20, muted)
      b.para(root, "Answer.", b.ty("body"), muted, { key: "FaqA", name: "Answer" })
    },
  )

  const checkItem = b.component(
    "Check item",
    {
      key: "Check",
      section: "Pricing",
      props: {
        label: p.text("CkLbl", "Included feature"),
        state: p.variants({
          included: { "CkIcon.icon": "check", "CkIcon.color": c("success"), "CkLbl.fill": ink },
          excluded: { "CkIcon.icon": "minus", "CkIcon.color": muted, "CkLbl.fill": muted },
        }),
      },
      root: { dir: "row", w: 320, gap: 10, align: "start" },
    },
    (root) => {
      b.icon(root, "check", 18, c("success"), { key: "CkIcon" })
      b.para(root, "Included feature", b.ty("body", { size: 15 }), ink, {
        key: "CkLbl",
        name: "Label",
      })
    },
  )

  const pricing = b.component(
    "Pricing card",
    {
      key: "Price",
      section: "Pricing",
      description: "Plan card. Fill the Features slot with Check items.",
      props: {
        plan: p.text("PrcName", "Plan"),
        price: p.text("PrcPrice", "$0"),
        period: p.text("PrcPer", "per seat / month"),
        description: p.text("PrcDesc", "Who the plan is for."),
        popular: p.bool("PrcBdgWrap", false),
        cta: p.swap("PrcCta", button),
        ctaLabel: p.text("PrcCta/BtnLabel", "Start free trial"),
        features: p.slot("PrcFeat"),
        tone: p.variants({
          standard: { "root.stroke": { paint: c("border") }, "root.effects": b.shadow("card") },
          featured: {
            "root.stroke": { paint: c("accent"), width: 2 },
            "root.effects": b.shadow("pop"),
          },
        }),
      },
      root: {
        dir: "column",
        w: 384,
        gap: 24,
        pad: s(8),
        radius: r("xl"),
        fill: c("surface"),
        stroke: { paint: c("border") },
        effects: b.shadow("card"),
      },
    },
    (root) => {
      const head = b.col(root, "Header", { w: FILL, gap: 8 })
      const top = b.row(head, "Plan row", { w: FILL, justify: "between", align: "center" })
      b.text(top, "Plan", b.ty("title"), ink, { key: "PrcName" })
      const wrap = b.row(top, "Popular", { key: "PrcBdgWrap", visible: false })
      b.use(wrap, badge, { args: { label: "Most popular" } })
      b.para(head, "Who the plan is for.", b.ty("body", { size: 15 }), muted, { key: "PrcDesc" })
      const price = b.row(root, "Price", { w: FILL, gap: 8, align: "end" })
      b.text(price, "$0", b.ty("h1"), ink, { key: "PrcPrice" })
      b.para(price, "per seat / month", b.ty("small"), muted, { key: "PrcPer", name: "Period" })
      b.use(root, button, {
        key: "PrcCta",
        props: { w: FILL },
        args: { label: "Start free trial", size: "lg" },
      })
      b.divider(root, c("border"))
      b.col(root, "Features", {
        key: "PrcFeat",
        w: FILL,
        gap: 12,
        slot: { suggested: [checkItem] },
      })
    },
  )

  const blogCard = b.component(
    "Blog card",
    {
      key: "BlogCard",
      section: "Blog",
      props: {
        tag: p.text("BcTag/BadgeLbl", "Close process"),
        date: p.text("BcDate", "Oct 1, 2026"),
        title: p.text("BcTitle", "Post title"),
        excerpt: p.text("BcExc", "One or two sentences about the post."),
        author: p.text("BcAuth", "Author"),
        initials: p.text("BcAv/AvInit", "MO"),
        art: p.variants({
          blue: { "BcArt.fill": grad("art-1", "accent-soft") },
          green: { "BcArt.fill": grad("art-2", "success-soft") },
          amber: { "BcArt.fill": grad("art-3", "warning-soft") },
          rose: { "BcArt.fill": grad("art-4", "subtle") },
        }),
      },
      root: { dir: "column", w: 384, gap: 16 },
    },
    (root) => {
      b.rect(root, "Cover", {
        key: "BcArt",
        w: FILL,
        h: 216,
        radius: r("lg"),
        fill: grad("art-1", "accent-soft"),
      })
      const meta = b.row(root, "Meta", { gap: 12, align: "center" })
      b.use(meta, badge, { key: "BcTag", args: { label: "Close process" } })
      b.text(meta, "Oct 1, 2026", b.ty("small"), muted, { key: "BcDate", name: "Date" })
      b.para(root, "Post title", b.ty("title"), ink, { key: "BcTitle", name: "Title" })
      b.para(root, "One or two sentences about the post.", b.ty("body"), muted, {
        key: "BcExc",
        name: "Excerpt",
      })
      const by = b.row(root, "Author", { gap: 10, align: "center" })
      b.use(by, avatar, { key: "BcAv", args: { size: "sm" } })
      b.text(by, "Author", b.ty("label", { weight: 500 }), ink, { key: "BcAuth", name: "Name" })
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
      b.text(root, "Label", b.ty("label"), ink, { key: "InLbl" })
      const field = b.row(root, "Field", {
        w: FILL,
        pad: [12, 14],
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      })
      b.text(field, "Placeholder", b.ty("body"), muted, { key: "InPh" })
      b.text(root, "Hint", b.ty("small"), muted, { key: "InHint", visible: false })
    },
  )

  // --- Shared sections -------------------------------------------------------------------------

  const people = {
    MO: ["Maya Okafor", "blue"],
    DP: ["Daniel Park", "green"],
    LS: ["Lena Strauss", "amber"],
    RA: ["Rafael Alves", "rose"],
  } as const

  function page(name: string, active: "product" | "pricing" | "customers" | "blog") {
    const scr = b.screen(screens, name, { w: 1440, fill: c("bg") })
    b.use(scr, navBar, { args: { active } })
    return scr
  }
  function section(parent: string, name: string, props: Record<string, unknown> = {}) {
    return b.col(parent, name, { w: FILL, gap: s(12), align: "center", pad: [96, 120], ...props })
  }
  function header(parent: string, eyebrow: string, title: string, subtitle: string) {
    b.use(parent, sectionHeader, { args: { eyebrow, title, subtitle } })
  }
  function buttons(parent: string, primary: string, secondary: string, size = "lg") {
    const row = b.row(parent, "Actions", { gap: 12, align: "center" })
    b.use(row, button, {
      args: { label: primary, icon: true, size },
    })
    b.use(row, buttonSecondary, { args: { label: secondary, size } })
    return row
  }
  function ctaBand(scr: string) {
    const wrap = b.col(scr, "Call to action", { w: FILL, pad: [0, 120, 96, 120] })
    const band = b.col(wrap, "Band", {
      w: FILL,
      gap: s(6),
      align: "center",
      pad: 64,
      radius: r("xl"),
      fill: c("inverse"),
    })
    b.text(
      band,
      "Run your next close in Ledgerline",
      b.ty("h1", { align: "center" }),
      c("on-inverse"),
    )
    b.para(
      band,
      "Import last month's checklist from a spreadsheet and invite your team. Setup takes about an hour.",
      b.ty("body-lg", { align: "center" }),
      c("inverse-muted"),
      { w: 620 },
    )
    buttons(band, "Start free trial", "Book a demo")
  }
  const logos: [string, string][] = [
    ["Northwind Freight", "truck"],
    ["Halcyon Health", "heart-pulse"],
    ["Brightline Retail", "store"],
    ["Corvid Labs", "flask-conical"],
    ["Juniper Capital", "landmark"],
    ["Oakridge Foods", "wheat"],
  ]
  function logoRow(parent: string) {
    const row = b.row(parent, "Logos", { w: FILL, justify: "between", align: "center" })
    for (const [name, icon] of logos)
      b.use(row, logo, { args: { name }, set: { LogoIcon: { icon } } })
  }
  const quotes = [
    [
      "We closed August in five days with two fewer people on the team than last year. The checklist did most of the chasing.",
      "Priya Raman",
      "Controller, Halcyon Health",
      "PR",
    ],
    [
      "Our auditors pulled support for 140 reconciliations without emailing anyone. That alone saved a week in March.",
      "Tomás Herrera",
      "VP Finance, Brightline Retail",
      "TH",
    ],
    [
      "Flux notes used to live in a spreadsheet nobody opened. Now the owner writes them before review starts.",
      "Grace Liu",
      "Assistant Controller, Corvid Labs",
      "GL",
    ],
    [
      "Intercompany used to take two full days. With templates and auto-matching it is done by lunch on day two.",
      "Owen Becker",
      "Controller, Juniper Capital",
      "OB",
    ],
    [
      "We gave our auditors read-only access in January and stopped building PBC folders by hand.",
      "Aisha Bello",
      "CFO, Oakridge Foods",
      "AB",
    ],
    [
      "The reminders are what people notice. Nobody is surprised by a task on day four anymore.",
      "Marta Nowak",
      "Senior Accountant, Northwind Freight",
      "MN",
    ],
  ] as const
  function quoteGrid(parent: string, from: number, count: number) {
    const rows = Math.ceil(count / 3)
    const grid = b.col(parent, "Quotes", { w: FILL, gap: s(6) })
    for (let i = 0; i < rows; i++) {
      const row = b.row(grid, `Row ${i + 1}`, { w: FILL, gap: s(6), align: "stretch" })
      for (const [q, name, role, initials] of quotes.slice(from + i * 3, from + i * 3 + 3))
        b.use(row, quote, { args: { quote: q, name, role, initials } })
    }
  }
  const posts = [
    [
      "Audit",
      "What auditors ask for first, and how to have it ready",
      "The six requests that open almost every year-end audit, and where each one lives in Ledgerline.",
      "DP",
      "Sep 24, 2026",
      "green",
    ],
    [
      "Close process",
      "Accruals for recurring vendors, without the guesswork",
      "A template that drafts the entry from the last three invoices and flags any vendor whose bill is late.",
      "LS",
      "Sep 17, 2026",
      "amber",
    ],
    [
      "Product updates",
      "Flux review now asks owners for notes",
      "Set a threshold per account. When a balance moves past it, the owner gets a task with the variance attached.",
      "RA",
      "Sep 10, 2026",
      "blue",
    ],
    [
      "Close process",
      "Reconciling Stripe payouts to your bank feed",
      "Payouts bundle fees, refunds and disputes. Here is how to split them so the bank line ties on the first try.",
      "MO",
      "Sep 3, 2026",
      "rose",
    ],
    [
      "Audit",
      "SOC 1 or SOC 2: what a controller needs from finance software",
      "Which report your auditor will ask for, what each covers, and the bridge letter question.",
      "DP",
      "Aug 27, 2026",
      "green",
    ],
    [
      "Product updates",
      "NetSuite multi-book support is live",
      "Close secondary books on their own calendar, with separate checklists and the same audit trail.",
      "LS",
      "Aug 20, 2026",
      "amber",
    ],
  ] as const
  function postRow(parent: string, list: readonly (typeof posts)[number][]) {
    const row = b.row(parent, "Posts row", { w: FILL, gap: s(6), align: "start" })
    for (const [tag, title, excerpt, who, date, art] of list) {
      const [author] = people[who]
      b.use(row, blogCard, {
        args: { tag, title, excerpt, author, initials: who, date, art },
        set: { BcAv: { args: { size: "sm", tone: people[who][1] } } },
      })
    }
  }

  // --- Cover -----------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Website template",
    title: "Ledgerline marketing site",
    description:
      "Home, pricing, customers, blog, article and sign-up screens for a B2B finance tool. Built from 16 components with light and dark tokens.",
    preview: (area) => {
      const top = b.col(area, "Hero", { w: FILL, gap: 16 })
      b.use(top, badge, { args: { label: "New: flux review with variance notes" } })
      b.para(top, "Close the month in four days", b.ty("h1"), ink)
      b.para(
        top,
        "Reconciliations, accruals and sign-offs in one checklist that reads from your ERP.",
        b.ty("body-lg"),
        muted,
      )
      buttons(top, "Start free trial", "Book a demo", "md")
      const cards = b.row(area, "Cards", { w: FILL, gap: 24, align: "stretch" })
      for (const [icon, title, body] of [
        [
          "list-checks",
          "Close checklist",
          "Recurring tasks roll forward each month with owners and due days.",
        ],
        [
          "scale",
          "Reconciliations",
          "Bank and subledger lines match overnight. Exceptions wait for review.",
        ],
      ] as const)
        b.use(cards, featureCard, {
          props: { w: FILL },
          args: { title, body },
          set: { FeatIcon: { icon } },
        })
      const nums = b.row(area, "Numbers", { w: FILL, gap: 24, pad: [8, 0, 0, 0] })
      for (const [value, label] of [
        ["4.2 days", "Median close after 90 days"],
        ["1,400+", "Finance teams closing in Ledgerline"],
      ] as const)
        b.use(nums, stat, { props: { w: FILL }, args: { value, label } })
    },
  })

  // --- Screens ---------------------------------------------------------------------------------

  const screens = b.page("Screens")

  // Home
  {
    const scr = page("Home", "product")
    const hero = b.col(scr, "Hero", { w: FILL, gap: s(6), align: "center", pad: [80, 120, 0, 120] })
    b.use(hero, badge, { args: { label: "New: flux review with variance notes" } })
    b.para(hero, "Close the month in four days", b.ty("display", { align: "center" }), ink, {
      w: 880,
    })
    b.para(
      hero,
      "Ledgerline puts reconciliations, accruals and review sign-offs in one checklist that reads from your ERP and bank feeds. Controllers see what is left before anyone has to ask.",
      b.ty("body-lg", { align: "center" }),
      muted,
      { w: 680 },
    )
    buttons(hero, "Start free trial", "Book a demo")
    b.text(hero, "14-day trial. No credit card required.", b.ty("small"), muted)
    productShot(hero)

    const proof = b.col(scr, "Logos", { w: FILL, gap: s(8), align: "center", pad: [72, 120] })
    b.text(
      proof,
      "Finance teams at 1,400 companies run their close in Ledgerline",
      b.ty("label", { weight: 500 }),
      muted,
    )
    logoRow(proof)

    const feats = section(scr, "Features", { fill: c("surface") })
    header(
      feats,
      "What it does",
      "Every close task in one place, tied to the numbers",
      "Ledgerline reads balances from NetSuite, Intacct or QuickBooks every hour, so each task shows the account it covers and whether it still ties out.",
    )
    const featList = [
      [
        "list-checks",
        "Close checklist",
        "Recurring tasks roll forward each month with owners, due days and dependencies. Late items show up on day 2.",
      ],
      [
        "scale",
        "Reconciliations",
        "Bank and subledger lines match automatically. Anything over your threshold waits for a preparer and a reviewer.",
      ],
      [
        "chart-column",
        "Flux analysis",
        "Each account is compared to last month and last year. Owners are asked for a note when a variance passes 10%.",
      ],
      [
        "file-text",
        "Journal entries",
        "Draft accruals and reclasses from templates, attach support and post to the ERP after approval.",
      ],
      [
        "shield-check",
        "Audit trail",
        "Every sign-off, edit and attachment is logged with a timestamp. Auditors get read-only access to the period.",
      ],
      [
        "plug",
        "Integrations",
        "NetSuite, Sage Intacct, QuickBooks Online, Xero, Plaid bank feeds and Slack reminders.",
      ],
    ] as const
    const grid = b.col(feats, "Grid", { w: FILL, gap: s(6) })
    for (let i = 0; i < 2; i++) {
      const row = b.row(grid, `Row ${i + 1}`, { w: FILL, gap: s(6), align: "stretch" })
      for (const [icon, title, body] of featList.slice(i * 3, i * 3 + 3))
        b.use(row, featureCard, { args: { title, body }, set: { FeatIcon: { icon } } })
    }

    const band = b.row(scr, "Stats", {
      w: FILL,
      justify: "between",
      pad: [72, 120],
      fill: c("inverse"),
    })
    for (const [value, label] of [
      ["4.2 days", "Median close after 90 days, down from 9.5"],
      ["38%", "Fewer manual journal entries in the first quarter"],
      ["1,400+", "Finance teams closing in Ledgerline"],
      ["SOC 2", "Type II report, audited every year"],
    ] as const)
      b.use(band, stat, { args: { value, label, tone: "inverse" } })

    const voices = section(scr, "Testimonials")
    header(
      voices,
      "Customers",
      "Controllers who stopped chasing spreadsheets",
      "Teams switch to Ledgerline in the quiet week after a close and run the next one in it.",
    )
    quoteGrid(voices, 0, 3)
    ctaBand(scr)
    b.use(scr, footer)
  }

  function productShot(parent: string) {
    const win = b.col(parent, "Product shot", {
      w: FILL,
      radius: r("xl"),
      fill: c("surface"),
      stroke: { paint: c("border") },
      effects: b.shadow("pop"),
      clip: true,
    })
    const bar = b.row(win, "Window bar", {
      w: FILL,
      gap: 8,
      align: "center",
      pad: [12, 16],
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    for (let i = 0; i < 3; i++) b.ellipse(bar, "Dot", { w: 10, h: 10, fill: c("border") })
    b.text(bar, "app.ledgerline.com/close/2026-09", b.ty("mono", { size: 12 }), muted, {
      name: "Address",
    })
    const body = b.row(win, "Body", { w: FILL })
    const side = b.col(body, "Sidebar", {
      w: 232,
      gap: 4,
      pad: 16,
      fill: c("subtle"),
      stroke: { paint: c("border"), width: { r: 1 } },
    })
    for (const [i, [icon, label]] of (
      [
        ["list-checks", "Close checklist"],
        ["scale", "Reconciliations"],
        ["file-text", "Journal entries"],
        ["chart-column", "Flux review"],
        ["layers", "Entities"],
        ["receipt", "Reports"],
      ] as const
    ).entries()) {
      const item = b.row(side, label, {
        w: FILL,
        gap: 10,
        align: "center",
        pad: [8, 10],
        radius: r("sm"),
        ...(i === 0 ? { fill: c("accent-soft") } : {}),
      })
      b.icon(item, icon, 16, i === 0 ? c("accent") : muted)
      b.text(
        item,
        label,
        b.ty("label", { weight: i === 0 ? 600 : 500 }),
        i === 0 ? c("accent") : muted,
      )
    }
    const main = b.col(body, "Main", { w: FILL, gap: 20, pad: 28 })
    const head = b.row(main, "Header", { w: FILL, justify: "between", align: "center" })
    const titles = b.col(head, "Titles", { gap: 4 })
    b.text(titles, "September 2026 close", b.ty("title", { size: 22 }), ink)
    b.text(titles, "Day 3 of 5  ·  41 of 58 tasks done", b.ty("small"), muted)
    const right = b.row(head, "Status", { gap: 12, align: "center" })
    b.use(right, badge, { args: { label: "On track", tone: "success" } })
    b.use(right, buttonSecondary, { args: { label: "Assign tasks" } })
    const progress = b.row(main, "Progress", {
      w: FILL,
      h: 8,
      radius: r("pill"),
      fill: c("subtle"),
      clip: true,
    })
    b.rect(progress, "Done", { w: { mode: "fill", weight: 41 }, h: 8, fill: c("accent") })
    b.rect(progress, "Left", { w: { mode: "fill", weight: 17 }, h: 8, fill: c("subtle") })
    const table = b.col(main, "Tasks", { w: FILL })
    const cols = (row: string, cells: [string, number | null][], header = false) => {
      for (const [t, w] of cells)
        b.text(
          row,
          t,
          header ? b.ty("small", { weight: 600 }) : b.ty("body", { size: 14 }),
          header ? muted : ink,
          {
            ...(w ? { w, grow: "fixed-width" } : { w: FILL, grow: "fixed-width" }),
          },
        )
    }
    const th = b.row(table, "Head", {
      w: FILL,
      gap: 16,
      pad: [8, 0],
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    cols(
      th,
      [
        ["Task", null],
        ["Owner", 170],
        ["Due", 70],
        ["Status", 100],
      ],
      true,
    )
    for (const [task, who, due, status, tone] of [
      ["Bank reconciliation: operating account", "MO", "Oct 2", "Done", "success"],
      ["Accrue September payroll", "DP", "Oct 2", "Done", "success"],
      ["Prepaid expenses roll-forward", "LS", "Oct 3", "In review", "warning"],
      ["Revenue cutoff review", "MO", "Oct 3", "In review", "warning"],
      ["Intercompany eliminations", "RA", "Oct 4", "Open", "neutral"],
    ] as const) {
      const tr = b.row(table, task, {
        w: FILL,
        gap: 16,
        align: "center",
        pad: [12, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      })
      cols(tr, [[task, null]])
      const owner = b.row(tr, "Owner", { w: 170, gap: 8, align: "center" })
      b.use(owner, avatar, { args: { initials: who, size: "sm", tone: people[who][1] } })
      b.text(owner, people[who][0], b.ty("small"), ink)
      cols(tr, [[due, 70]])
      const st = b.row(tr, "Status", { w: 100 })
      b.use(st, badge, { args: { label: status, tone } })
    }
  }

  // Pricing
  {
    const scr = page("Pricing", "pricing")
    const top = section(scr, "Header", { pad: [80, 120, 48, 120], gap: s(8) })
    header(
      top,
      "Pricing",
      "Priced per finance seat",
      "Reviewers and auditors join free. Pay monthly, or save 15% with annual billing.",
    )
    const toggle = b.row(top, "Billing toggle", {
      gap: 4,
      pad: 4,
      radius: r("pill"),
      fill: c("subtle"),
    })
    const on = b.row(toggle, "Monthly", {
      pad: [8, 18],
      radius: r("pill"),
      fill: c("surface"),
      effects: b.shadow("card"),
    })
    b.text(on, "Monthly", b.ty("label"), ink)
    const off = b.row(toggle, "Annual", { pad: [8, 18], gap: 8, align: "center" })
    b.text(off, "Annual", b.ty("label"), muted)
    b.text(off, "Save 15%", b.ty("small", { weight: 600 }), c("success"))

    const plans = b.row(scr, "Plans", { w: FILL, gap: s(6), pad: [0, 120], align: "stretch" })
    const plan = (args: Record<string, unknown>, features: [string, boolean][]) =>
      b.use(plans, pricing, {
        props: { w: FILL },
        args,
        slots: {
          PrcFeat: (into) => {
            for (const [label, yes] of features)
              b.use(into, checkItem, {
                props: { w: FILL },
                args: { label, state: yes ? "included" : "excluded" },
              })
          },
        },
      })
    plan(
      {
        plan: "Starter",
        price: "$39",
        period: "per finance seat / month",
        description: "For teams of up to 5 closing on QuickBooks Online or Xero.",
        cta: buttonSecondary,
        ctaLabel: "Start free trial",
      },
      [
        ["Close checklist with 50 recurring tasks", true],
        ["Bank reconciliations for 5 accounts", true],
        ["QuickBooks Online and Xero sync", true],
        ["Slack and email reminders", true],
        ["Flux analysis", false],
        ["Journal entry approvals", false],
      ],
    )
    plan(
      {
        plan: "Growth",
        price: "$79",
        period: "per finance seat / month",
        description: "For multi-entity teams that need flux review and approvals.",
        popular: true,
        tone: "featured",
        ctaLabel: "Start free trial",
      },
      [
        ["Unlimited checklist tasks", true],
        ["Unlimited reconciliations", true],
        ["Flux analysis with variance notes", true],
        ["Journal entry approvals", true],
        ["NetSuite and Sage Intacct sync", true],
        ["Up to 10 entities", true],
      ],
    )
    plan(
      {
        plan: "Enterprise",
        price: "Custom",
        period: "billed annually",
        description: "For groups with more than 10 entities, SSO and audit requirements.",
        cta: buttonSecondary,
        ctaLabel: "Talk to sales",
      },
      [
        ["Everything in Growth", true],
        ["Unlimited entities", true],
        ["SAML SSO and SCIM provisioning", true],
        ["Read-only auditor portal", true],
        ["Named close specialist", true],
        ["99.9% uptime SLA", true],
      ],
    )

    const faqs = section(scr, "FAQ", { gap: s(8) })
    b.text(faqs, "Questions finance teams ask", b.ty("heading"), ink)
    const list = b.col(faqs, "Items", { w: 800 })
    for (const [i, [question, answer]] of (
      [
        [
          "Who counts as a finance seat?",
          "Anyone who prepares or posts work: accountants, controllers and FP&A. Approvers outside finance, reviewers and auditors join free.",
        ],
        [
          "Can we import our current checklist?",
          "Yes. Upload the spreadsheet you use today and map its columns to task, owner, due day and account. Most teams finish in under an hour.",
        ],
        [
          "Which ERPs do you support?",
          "NetSuite, Sage Intacct, QuickBooks Online, Xero and Microsoft Dynamics 365 Business Central. Others can import trial balances as CSV.",
        ],
        [
          "Is there a minimum contract?",
          "Starter and Growth are month to month. Enterprise plans are billed annually.",
        ],
      ] as const
    ).entries())
      b.use(list, faq, { props: { w: FILL }, args: { question, answer, open: i === 0 } })
    ctaBand(scr)
    b.use(scr, footer)
  }

  // Customers
  {
    const scr = page("Customers", "customers")
    const top = section(scr, "Header", { pad: [80, 120, 56, 120], gap: s(12) })
    header(
      top,
      "Customers",
      "1,400 finance teams close in Ledgerline",
      "From two-person teams on QuickBooks to groups consolidating 40 entities in NetSuite.",
    )
    logoRow(top)
    const study = b.col(scr, "Case study", { w: FILL, pad: [0, 120] })
    const card = b.row(study, "Card", {
      w: FILL,
      radius: r("xl"),
      fill: c("surface"),
      stroke: { paint: c("border") },
      clip: true,
    })
    const text = b.col(card, "Story", { w: FILL, gap: s(6), pad: 56 })
    b.use(text, badge, { args: { label: "Case study" } })
    b.para(text, "How Halcyon Health cut its close from 11 days to 5", b.ty("heading"), ink)
    b.para(
      text,
      "Halcyon runs 6 clinics as separate entities on NetSuite. Before Ledgerline, the close lived in a 400-row spreadsheet that one senior accountant kept current. Tasks now roll forward on their own, reconciliations match overnight, and the controller reviews from a single queue.",
      b.ty("body-lg"),
      muted,
    )
    const stats = b.row(text, "Results", { w: FILL, gap: s(8), pad: [8, 0, 0, 0] })
    for (const [value, label] of [
      ["5 days", "Close length, down from 11"],
      ["6", "Entities consolidated"],
      ["320", "Reconciliations each month"],
    ] as const)
      b.use(stats, stat, { props: { w: FILL }, args: { value, label } })
    const art = b.col(card, "Pull quote", {
      w: 460,
      h: FILL,
      justify: "end",
      gap: s(4),
      pad: 48,
      fill: grad("art-2", "success-soft"),
    })
    b.icon(art, "quote", 28, c("success"))
    b.para(
      art,
      "We used to spend the first two days finding out what was late. Now the checklist tells us on the first morning.",
      b.ty("title"),
      ink,
    )
    b.text(art, "Priya Raman, Controller", b.ty("label"), ink)

    const voices = section(scr, "More customers", { gap: s(10) })
    b.text(voices, "What finance teams say", b.ty("heading"), ink)
    quoteGrid(voices, 0, 6)
    ctaBand(scr)
    b.use(scr, footer)
  }

  // Blog
  {
    const scr = page("Blog", "blog")
    const top = b.row(scr, "Header", {
      w: FILL,
      justify: "between",
      align: "end",
      pad: [80, 120, 40, 120],
    })
    const titles = b.col(top, "Titles", { w: 640, gap: 12 })
    b.text(titles, "The Close", b.ty("label", { case: "upper", letterSpacing: 1 }), c("accent"))
    b.para(titles, "Notes on running a faster month-end", b.ty("h1"), ink)
    b.para(
      titles,
      "Checklists, audit prep and product updates from the Ledgerline team.",
      b.ty("body-lg"),
      muted,
    )
    const chips = b.row(top, "Filters", { gap: 8 })
    b.use(chips, badge, { args: { label: "All posts" } })
    for (const label of ["Close process", "Audit", "Product updates"])
      b.use(chips, badge, { args: { label, tone: "neutral" } })

    const featured = b.row(scr, "Featured", { w: FILL, gap: 48, align: "center", pad: [0, 120] })
    b.rect(featured, "Cover", { w: 680, h: 380, radius: r("xl"), fill: grad("art-1", "accent") })
    const ft = b.col(featured, "Text", { w: FILL, gap: 16 })
    const meta = b.row(ft, "Meta", { gap: 12, align: "center" })
    b.use(meta, badge, { args: { label: "Close process" } })
    b.text(meta, "Oct 1, 2026  ·  9 min read", b.ty("small"), muted)
    b.para(ft, "A five-day close checklist you can copy", b.ty("heading"), ink)
    b.para(
      ft,
      "The 58 tasks our customers run most often, grouped by day, with owners and the accounts each one ties to.",
      b.ty("body-lg"),
      muted,
    )
    const by = b.row(ft, "Author", { gap: 12, align: "center" })
    b.use(by, avatar, { args: { initials: "MO" } })
    const names = b.col(by, "Names", { gap: 2 })
    b.text(names, "Maya Okafor", b.ty("label"), ink)
    b.text(names, "Controller in residence", b.ty("small"), muted)

    const grid = b.col(scr, "Posts", { w: FILL, gap: 56, pad: [72, 120, 96, 120] })
    postRow(grid, posts.slice(0, 3))
    postRow(grid, posts.slice(3, 6))
    b.use(scr, footer)
  }

  // Blog post
  {
    const scr = page("Blog post", "blog")
    const art = b.col(scr, "Article", { w: FILL, gap: s(6), pad: [64, 360, 80, 360] })
    const back = b.row(art, "Back", { gap: 6, align: "center" })
    b.icon(back, "arrow-left", 16, muted)
    b.text(back, "All posts", b.ty("label", { weight: 500 }), muted)
    b.use(art, badge, { args: { label: "Close process" } })
    b.para(art, "A five-day close checklist you can copy", b.ty("h1"), ink)
    const by = b.row(art, "Author", { gap: 12, align: "center" })
    b.use(by, avatar, { args: { initials: "MO" } })
    const names = b.col(by, "Names", { gap: 2 })
    b.text(names, "Maya Okafor", b.ty("label"), ink)
    b.text(names, "Oct 1, 2026  ·  9 min read", b.ty("small"), muted)
    b.rect(art, "Cover", { w: FILL, h: 400, radius: r("xl"), fill: grad("art-1", "accent") })
    const body = (t: string) => b.para(art, t, b.ty("body-lg"), ink)
    const h2 = (t: string) =>
      b.para(art, t, b.ty("heading", { size: 26 }), ink, { name: "Heading" })
    body(
      "Teams that close in five days rarely work longer hours in the first week. They start earlier, every account has one owner, and they drop the work that nobody reviews.",
    )
    body(
      "Below is the checklist our customers run most often, grouped by day. Copy it into Ledgerline from the template gallery, or into a spreadsheet if you are not ready to switch.",
    )
    h2("Day 1: cash and cutoff")
    body(
      "Reconcile every bank and card account before anything else. Cash is the one balance you can tie to an outside source on the first morning, and it surfaces missing entries early.",
    )
    const list = b.col(art, "Checklist", { w: FILL, gap: 12 })
    for (const label of [
      "Bank reconciliations for all operating accounts",
      "Card statements matched to receipts",
      "Revenue cutoff reviewed for the last three business days",
    ])
      b.use(list, checkItem, { props: { w: FILL }, args: { label } })
    h2("Days 2 and 3: accruals and reclasses")
    body(
      "Draft recurring accruals from last month's entries and adjust only what changed. Ask budget owners about open purchase orders on day 1, so answers arrive before you need them.",
    )
    const pull = b.col(art, "Pull quote", {
      w: FILL,
      pad: [4, 0, 4, 24],
      stroke: { paint: c("accent"), width: { l: 3 } },
    })
    b.para(
      pull,
      "The fastest closes we see share one habit: the reviewer signs off each day, not in one long session on day five.",
      b.ty("title", { italic: true }),
      ink,
    )
    h2("Days 4 and 5: flux review and reporting")
    body(
      "Compare each account to last month and last year. Anything over your threshold gets a note from its owner before the controller reviews, so review is reading, not chasing.",
    )
    b.divider(art, c("border"))
    const bio = b.row(art, "Author bio", {
      w: FILL,
      gap: 16,
      align: "center",
      pad: 24,
      radius: r("lg"),
      fill: c("subtle"),
    })
    b.use(bio, avatar, { args: { initials: "MO", size: "lg" } })
    const bt = b.col(bio, "Text", { w: FILL, gap: 4 })
    b.text(bt, "Maya Okafor", b.ty("label"), ink)
    b.para(
      bt,
      "Maya ran the close at two venture-backed companies before joining Ledgerline. She writes about checklists and audit prep.",
      b.ty("body", { size: 15 }),
      muted,
    )

    const more = b.col(scr, "Keep reading", {
      w: FILL,
      gap: s(8),
      pad: [64, 120, 96, 120],
      fill: c("subtle"),
    })
    b.text(more, "Keep reading", b.ty("heading"), ink)
    postRow(more, posts.slice(0, 3))
    b.use(scr, footer)
  }

  // Sign up
  {
    const scr = b.screen(screens, "Sign up", { dir: "row", w: 1440, h: 900, fill: c("bg") })
    const left = b.col(scr, "Form side", { w: FILL, h: FILL, justify: "between", pad: [48, 120] })
    brand(left)
    const form = b.col(left, "Form", { w: 400, gap: s(5) })
    const heads = b.col(form, "Heading", { w: FILL, gap: 8 })
    b.para(heads, "Start your 14-day trial", b.ty("heading"), ink)
    b.para(
      heads,
      "No credit card. Your workspace comes with a sample close to explore.",
      b.ty("body"),
      muted,
    )
    b.use(form, buttonSecondary, {
      props: { w: FILL },
      args: { label: "Continue with Google", size: "lg" },
    })
    const or = b.row(form, "Or", { w: FILL, gap: 12, align: "center" })
    b.divider(or, c("border"))
    b.text(or, "or", b.ty("small"), muted)
    b.divider(or, c("border"))
    for (const [label, placeholder, hint] of [
      ["Work email", "maya@halcyonhealth.com", ""],
      ["Full name", "Maya Okafor", ""],
      ["Password", "At least 12 characters", "Use 12 or more characters with a number."],
    ] as const)
      b.use(form, input, {
        props: { w: FILL },
        args: { label, placeholder, ...(hint ? { hint, showHint: true } : {}) },
      })
    b.use(form, button, { props: { w: FILL }, args: { label: "Create workspace", size: "lg" } })
    b.para(
      form,
      "By continuing you agree to the Terms and the Privacy Policy.",
      b.ty("small"),
      muted,
    )
    const signin = b.row(left, "Sign in", { gap: 6 })
    b.text(signin, "Already have an account?", b.ty("body", { size: 15 }), muted)
    b.text(signin, "Sign in", b.ty("label", { size: 15 }), c("accent"))

    const right = b.col(scr, "Proof side", {
      w: 640,
      h: FILL,
      justify: "between",
      pad: 64,
      fill: c("inverse"),
    })
    const [q, name, role, initials] = quotes[1]
    b.use(right, quote, { props: { w: FILL }, args: { quote: q, name, role, initials } })
    const nums = b.row(right, "Numbers", { w: FILL, gap: s(8) })
    for (const [value, label] of [
      ["4.2 days", "Median close after 90 days"],
      ["1,400+", "Finance teams"],
    ] as const)
      b.use(nums, stat, { props: { w: FILL }, args: { value, label, tone: "inverse" } })
  }
}
