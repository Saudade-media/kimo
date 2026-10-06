/**
 * Offset 2027: the website of a fictional two-day product design conference in Copenhagen.
 * Screens (1440 wide): Home, Speakers, Schedule (two tracks), Speaker detail, Tickets,
 * Venue and travel.
 */
import { FILL, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "event-conference",
  name: "Offset conference site",
  category: "Website",
  description:
    "Six-screen site for a two-day product design conference: home, speakers, two-track schedule, speaker page, tickets and venue.",
  prefix: "ec",
  build,
}

type Tone = "blue" | "coral" | "lime" | "violet" | "teal"

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F4F4F1", "#0C0C0F"],
      surface: ["#FFFFFF", "#15151A"],
      subtle: ["#EBEBE6", "#1D1D24"],
      ink: ["#0E0E11", "#F3F3EF"],
      muted: ["#5E5E66", "#9C9CA6"],
      border: ["#DCDCD5", "#2C2C35"],
      accent: ["#3B36F5", "#8C88FF"],
      "accent-soft": ["#E6E5FF", "#22204A"],
      "on-accent": ["#FFFFFF", "#0C0C0F"],
      lime: ["#CDF24A", "#CDF24A"],
      "on-lime": ["#0E0E11", "#0E0E11"],
      coral: ["#F2603F", "#FF8466"],
      "coral-soft": ["#FDE5DE", "#3E1C14"],
      success: ["#1F7A4A", "#5BD08F"],
      inverse: ["#0E0E11", "#18181F"],
      "on-inverse": ["#F4F4F1", "#F3F3EF"],
      "inverse-muted": ["#9A9AA3", "#8D8D97"],
      "inverse-border": ["#2A2A31", "#2E2E37"],
      "inverse-surface": ["#1A1A20", "#22222A"],
      "tone-blue": ["#A9B4FF", "#3A3F8F"],
      "tone-blue-deep": ["#4A4FD9", "#24275E"],
      "tone-coral": ["#FFB8A3", "#8A3A28"],
      "tone-coral-deep": ["#E0573A", "#55231A"],
      "tone-lime": ["#E3F79E", "#5C6E1C"],
      "tone-lime-deep": ["#9DBE24", "#384412"],
      "tone-violet": ["#D7B8F2", "#5B3A7A"],
      "tone-violet-deep": ["#8A4FC4", "#35214A"],
      "tone-teal": ["#A6E3D8", "#22605A"],
      "tone-teal-deep": ["#2E9A8A", "#143B37"],
      figure: ["#FFFFFF", "#E9E9E4"],
      water: ["#C9D8F2", "#1B2740"],
      land: ["#E4E4DE", "#202027"],
      block: ["#D3D3CB", "#2C2C34"],
      park: ["#CFE6C2", "#1E3321"],
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
      "radius/sm": 6,
      "radius/md": 10,
      "radius/lg": 16,
      "radius/xl": 24,
      "radius/pill": 999,
    },
    type: {
      hero: { font: "Inter", size: 120, weight: 800, lineHeight: 0.9, letterSpacing: -5.5 },
      display: { font: "Inter", size: 72, weight: 800, lineHeight: 1, letterSpacing: -3 },
      h1: { font: "Inter", size: 52, weight: 800, lineHeight: 1.05, letterSpacing: -2 },
      heading: { font: "Inter", size: 32, weight: 700, lineHeight: 1.15, letterSpacing: -1 },
      title: { font: "Inter", size: 20, weight: 700, lineHeight: 1.3, letterSpacing: -0.4 },
      "body-lg": { font: "Inter", size: 18, weight: 400, lineHeight: 1.55 },
      body: { font: "Inter", size: 16, weight: 400, lineHeight: 1.5 },
      label: { font: "Inter", size: 14, weight: 600, lineHeight: 1.3 },
      small: { font: "Inter", size: 13, weight: 400, lineHeight: 1.45 },
      mono: { font: "JetBrains Mono", size: 13, weight: 500, lineHeight: 1.4 },
    },
    shadows: {
      card: [
        { kind: "shadow", x: 0, y: 1, blur: 2, color: "#0E0E1110" },
        { kind: "shadow", x: 0, y: 10, blur: 28, spread: -10, color: "#0E0E1122" },
      ],
      pop: { kind: "shadow", x: 0, y: 24, blur: 56, spread: -16, color: "#0E0E1144" },
    },
  })

  const c = (n: string) => b.c(n)
  const s = (n: number) => b.n(`space/${n}`)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  const grad = (from: string, to: string, rotation = 160) => ({
    kind: "linear",
    rotation,
    stops: [
      { color: c(from), at: 0 },
      { color: c(to), at: 1 },
    ],
  })
  const eyebrow = b.ty("mono", { case: "upper", letterSpacing: 1 })

  // --- Components: actions -----------------------------------------------------------------------

  const button = b.component(
    "Button",
    {
      key: "Btn",
      section: "Actions",
      description: "Primary, secondary, lime or inverse; md or lg.",
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
          lime: {
            "root.fill": c("lime"),
            "root.stroke": { paint: c("lime") },
            "BtnLabel.fill": c("on-lime"),
            "BtnIcon.color": c("on-lime"),
          },
          inverse: {
            "root.fill": c("inverse"),
            "root.stroke": { paint: c("inverse-border") },
            "BtnLabel.fill": c("on-inverse"),
            "BtnIcon.color": c("on-inverse"),
          },
        }),
        size: p.variants({
          md: { "root.layout/pad": [10, 18], "BtnLabel.style/size": 14 },
          lg: { "root.layout/pad": [15, 26], "BtnLabel.style/size": 16 },
        }),
      },
      root: {
        dir: "row",
        gap: 8,
        align: "center",
        justify: "center",
        pad: [10, 18],
        radius: r("pill"),
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
      description: "Track and status label. Main stage is blue, Studio is coral.",
      props: {
        label: p.text("BadgeLbl", "Main stage"),
        tone: p.variants({
          main: {
            "root.fill": c("accent-soft"),
            "BadgeLbl.fill": c("accent"),
            "BadgeDot.fill": c("accent"),
          },
          studio: {
            "root.fill": c("coral-soft"),
            "BadgeLbl.fill": c("coral"),
            "BadgeDot.fill": c("coral"),
          },
          lime: { "root.fill": c("lime"), "BadgeLbl.fill": c("on-lime"), "BadgeDot.fill": ink },
          neutral: { "root.fill": c("subtle"), "BadgeLbl.fill": muted, "BadgeDot.fill": muted },
        }),
      },
      root: {
        dir: "row",
        gap: 6,
        align: "center",
        pad: [4, 10],
        radius: r("pill"),
        fill: c("accent-soft"),
      },
    },
    (root) => {
      b.ellipse(root, "Dot", { key: "BadgeDot", w: 6, h: 6, fill: c("accent") })
      b.text(root, "Main stage", b.ty("small", { weight: 600 }), c("accent"), {
        key: "BadgeLbl",
        name: "Label",
      })
    },
  )

  // --- Components: navigation ----------------------------------------------------------------------

  function brand(parent: string, onInverse = false) {
    const row = b.row(parent, "Brand", { gap: 10, align: "center" })
    const mark = b.row(row, "Mark", {
      w: 30,
      h: 30,
      radius: r("sm"),
      fill: c("lime"),
      align: "center",
      justify: "center",
    })
    b.icon(mark, "square-dashed", 18, c("on-lime"))
    b.text(
      row,
      "Offset 2027",
      b.ty("title", { weight: 800, letterSpacing: -0.6 }),
      onInverse ? c("on-inverse") : ink,
      { name: "Wordmark" },
    )
    return row
  }

  const navLinks = ["Speakers", "Schedule", "Tickets", "Venue"] as const
  const navActive = (i: number) =>
    Object.fromEntries(navLinks.map((_, j) => [`NavL${j + 1}.fill`, j === i ? ink : muted]))
  const navBar = b.component(
    "Nav bar",
    {
      key: "NavBar",
      section: "Navigation",
      props: {
        active: p.variants({
          home: navActive(-1),
          speakers: navActive(0),
          schedule: navActive(1),
          tickets: navActive(2),
          venue: navActive(3),
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
      const left = b.row(root, "Left", { w: 360, align: "center" })
      brand(left)
      const links = b.row(root, "Links", { gap: 36, align: "center" })
      for (const [i, l] of navLinks.entries())
        b.text(links, l, b.ty("body", { weight: 500 }), muted, { key: `NavL${i + 1}` })
      const right = b.row(root, "Right", { w: 360, gap: 16, align: "center", justify: "end" })
      b.text(right, "15 and 16 April, Copenhagen", b.ty("small", { weight: 500 }), muted)
      b.use(right, button, { key: "NavCta", args: { label: "Get tickets" } })
    },
  )

  const footer = b.component(
    "Footer",
    {
      key: "Footer",
      section: "Navigation",
      root: { dir: "column", w: 1440, gap: s(12), pad: [80, 120, 40, 120], fill: c("inverse") },
    },
    (root) => {
      const top = b.row(root, "Top", { w: FILL, gap: s(16) })
      const about = b.col(top, "About", { w: 400, gap: s(4) })
      brand(about, true)
      b.para(
        about,
        "Two days of talks and workshops on product design, run by designers since 2019. Dok 4, Refshaleøen, Copenhagen.",
        b.ty("body"),
        c("inverse-muted"),
      )
      for (const [title, items] of [
        ["Conference", ["Speakers", "Schedule", "Tickets", "Venue and travel"]],
        ["Attend", ["Code of conduct", "Accessibility", "Scholarships", "Volunteer"]],
        ["Contact", ["hello@offset.events", "Sponsorship", "Press", "Newsletter"]],
      ] as const) {
        const col = b.col(top, title, { w: 200, gap: 12 })
        b.text(col, title, eyebrow, c("inverse-muted"))
        for (const it of items) b.text(col, it, b.ty("body"), c("on-inverse"))
      }
      b.rect(root, "Rule", { w: FILL, h: 1, fill: c("inverse-border") })
      const bottom = b.row(root, "Bottom", { w: FILL, justify: "between", align: "center" })
      b.text(bottom, "Offset Events ApS  ·  CVR 41 22 87 90", b.ty("small"), c("inverse-muted"))
      b.text(bottom, "Privacy  ·  Terms  ·  Refund policy", b.ty("small"), c("inverse-muted"))
    },
  )

  const sectionHeader = b.component(
    "Section header",
    {
      key: "SecHead",
      section: "Navigation",
      props: {
        eyebrow: p.text("ShEye", "Eyebrow"),
        title: p.text("ShTitle", "Section title"),
        subtitle: p.text("ShSub", "Supporting sentence."),
        showSubtitle: p.bool("ShSub", true),
        action: p.slot("ShAct"),
      },
      root: { dir: "row", w: 1200, gap: s(8), justify: "between", align: "end" },
    },
    (root) => {
      const t = b.col(root, "Text", { w: 760, gap: s(3) })
      b.text(t, "Eyebrow", eyebrow, c("accent"), { key: "ShEye", name: "Eyebrow" })
      b.para(t, "Section title", b.ty("h1"), ink, { key: "ShTitle", name: "Title" })
      b.para(t, "Supporting sentence.", b.ty("body-lg"), muted, { key: "ShSub", name: "Subtitle" })
      b.row(root, "Action", {
        key: "ShAct",
        gap: 8,
        align: "center",
        slot: { suggested: [button, buttonSecondary] },
      })
    },
  )

  const dayTabs = b.component(
    "Day tabs",
    {
      key: "Days",
      section: "Navigation",
      props: {
        active: p.variants({
          day1: {
            "DayT1.fill": ink,
            "DayL1.fill": c("bg"),
            "DayS1.fill": c("bg"),
            "DayT2.fill": c("surface"),
            "DayL2.fill": ink,
            "DayS2.fill": muted,
          },
          day2: {
            "DayT1.fill": c("surface"),
            "DayL1.fill": ink,
            "DayS1.fill": muted,
            "DayT2.fill": ink,
            "DayL2.fill": c("bg"),
            "DayS2.fill": c("bg"),
          },
        }),
      },
      root: {
        dir: "row",
        gap: 6,
        pad: 6,
        radius: r("lg"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      },
    },
    (root) => {
      const days: [string, string][] = [
        ["Day 1", "Thursday 15 April"],
        ["Day 2", "Friday 16 April"],
      ]
      for (const [i, [day, date]] of days.entries()) {
        const n = i + 1
        const t = b.col(root, day, {
          key: `DayT${n}`,
          w: 200,
          gap: 2,
          pad: [10, 16],
          radius: r("md"),
          fill: n === 1 ? ink : c("surface"),
        })
        b.text(t, day, b.ty("label"), n === 1 ? c("bg") : ink, { key: `DayL${n}` })
        b.text(t, date, b.ty("small"), n === 1 ? c("bg") : muted, { key: `DayS${n}` })
      }
    },
  )

  // --- Components: people ----------------------------------------------------------------------------

  const toneFill = (t: Tone) => grad(`tone-${t}`, `tone-${t}-deep`)
  const portrait = b.component(
    "Portrait",
    {
      key: "Portrait",
      section: "People",
      description: "Stand-in for a speaker photo: a tone and a size from sm (40) to xl (440).",
      props: {
        tone: p.variants({
          blue: { "root.fill": toneFill("blue") },
          coral: { "root.fill": toneFill("coral") },
          lime: { "root.fill": toneFill("lime") },
          violet: { "root.fill": toneFill("violet") },
          teal: { "root.fill": toneFill("teal") },
        }),
        size: p.variants({
          lg: {
            "root.w": 282,
            "root.h": 300,
            "root.radius": 16,
            "PtHead.w": 104,
            "PtHead.h": 104,
            "PtBody.w": 196,
            "PtBody.h": 96,
            "PtBody.radius": [98, 98, 0, 0],
            "root.layout/gap": 12,
          },
          sm: {
            "root.w": 40,
            "root.h": 40,
            "root.radius": 20,
            "PtHead.w": 16,
            "PtHead.h": 16,
            "PtBody.w": 30,
            "PtBody.h": 12,
            "PtBody.radius": [15, 15, 0, 0],
            "root.layout/gap": 2,
          },
          md: {
            "root.w": 64,
            "root.h": 64,
            "root.radius": 32,
            "PtHead.w": 26,
            "PtHead.h": 26,
            "PtBody.w": 48,
            "PtBody.h": 20,
            "PtBody.radius": [24, 24, 0, 0],
            "root.layout/gap": 3,
          },
          xl: {
            "root.w": 480,
            "root.h": 560,
            "root.radius": 24,
            "PtHead.w": 180,
            "PtHead.h": 180,
            "PtBody.w": 340,
            "PtBody.h": 190,
            "PtBody.radius": [170, 170, 0, 0],
            "root.layout/gap": 20,
          },
        }),
      },
      root: {
        dir: "column",
        w: 282,
        h: 300,
        gap: 12,
        align: "center",
        justify: "end",
        radius: 16,
        clip: true,
        fill: toneFill("blue"),
      },
    },
    (root) => {
      b.ellipse(root, "Head", { key: "PtHead", w: 104, h: 104, fill: c("figure"), opacity: 0.9 })
      b.rect(root, "Shoulders", {
        key: "PtBody",
        w: 196,
        h: 96,
        radius: [98, 98, 0, 0],
        fill: c("figure"),
        opacity: 0.9,
      })
    },
  )

  const speakerCard = b.component(
    "Speaker card",
    {
      key: "Speaker",
      section: "People",
      description: "Portrait, name, role and talk. Set the portrait tone through SpPt.",
      props: {
        name: p.text("SpName", "Name"),
        role: p.text("SpRole", "Role, Company"),
        talk: p.text("SpTalk", "Talk title"),
        showTalk: p.bool("SpTalkRow", true),
        track: p.variants({
          main: { "SpDot.fill": c("accent") },
          studio: { "SpDot.fill": c("coral") },
        }),
      },
      root: { dir: "column", w: 282, gap: s(4) },
    },
    (root) => {
      b.use(root, portrait, { key: "SpPt", props: { w: FILL } })
      const names = b.col(root, "Names", { w: FILL, gap: 2 })
      b.text(names, "Name", b.ty("title"), ink, { key: "SpName" })
      b.para(names, "Role, Company", b.ty("body", { size: 15 }), muted, { key: "SpRole" })
      const talk = b.row(root, "Talk", {
        key: "SpTalkRow",
        w: FILL,
        gap: 10,
        align: "start",
        pad: [12, 0, 0, 0],
        stroke: { paint: c("border"), width: { t: 1 } },
      })
      b.ellipse(talk, "Track", { key: "SpDot", w: 8, h: 8, fill: c("accent") })
      b.para(talk, "Talk title", b.ty("label", { weight: 500, lineHeight: 1.4 }), ink, {
        key: "SpTalk",
      })
    },
  )

  // --- Components: schedule --------------------------------------------------------------------------

  const session = b.component(
    "Session",
    {
      key: "Session",
      section: "Schedule",
      description: "One talk or workshop. Track sets the edge colour and label.",
      props: {
        time: p.text("SsTime", "09:30 to 10:15"),
        title: p.text("SsTitle", "Talk title"),
        speaker: p.text("SsName", "Speaker"),
        role: p.text("SsRole", "Role, Company"),
        format: p.text("SsFmt", "Talk"),
        track: p.variants({
          main: {
            "root.stroke": { paint: c("accent"), width: { l: 4 } },
            "SsTrack.fill": c("accent"),
            "SsTrack.content": "Main stage",
          },
          studio: {
            "root.stroke": { paint: c("coral"), width: { l: 4 } },
            "SsTrack.fill": c("coral"),
            "SsTrack.content": "Studio",
          },
        }),
      },
      root: {
        dir: "column",
        w: 516,
        gap: s(3),
        pad: [18, 20],
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("accent"), width: { l: 4 } },
        effects: b.shadow("card"),
      },
    },
    (root) => {
      const top = b.row(root, "Meta", { w: FILL, gap: 10, align: "center" })
      b.text(top, "Main stage", b.ty("mono", { case: "upper" }), c("accent"), { key: "SsTrack" })
      b.text(top, "·", b.ty("mono"), muted)
      b.text(top, "Talk", b.ty("mono", { case: "upper" }), muted, {
        key: "SsFmt",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(top, "09:30 to 10:15", b.ty("mono"), muted, { key: "SsTime" })
      b.para(root, "Talk title", b.ty("title", { size: 19 }), ink, { key: "SsTitle" })
      const who = b.row(root, "Speaker", { w: FILL, gap: 10, align: "center" })
      b.use(who, portrait, { key: "SsPt", args: { size: "sm" } })
      const names = b.col(who, "Names", { w: FILL, gap: 0 })
      b.text(names, "Speaker", b.ty("label"), ink, { key: "SsName" })
      b.text(names, "Role, Company", b.ty("small"), muted, { key: "SsRole" })
    },
  )

  const breakRow = b.component(
    "Break row",
    {
      key: "Break",
      section: "Schedule",
      props: {
        time: p.text("BrTime", "11:15"),
        label: p.text("BrLbl", "Coffee break"),
        note: p.text("BrNote", "Main hall"),
      },
      root: {
        dir: "row",
        w: 1200,
        gap: s(6),
        align: "center",
        pad: [14, 20],
        radius: r("md"),
        fill: c("subtle"),
      },
    },
    (root) => {
      b.text(root, "11:15", b.ty("mono"), muted, { key: "BrTime", w: 96, grow: "fixed-width" })
      b.icon(root, "coffee", 18, muted, { key: "BrIcon" })
      b.text(root, "Coffee break", b.ty("label"), ink, {
        key: "BrLbl",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(root, "Main hall", b.ty("small"), muted, { key: "BrNote" })
    },
  )

  // --- Components: tickets ---------------------------------------------------------------------------

  const checkItem = b.component(
    "Check item",
    {
      key: "Check",
      section: "Tickets",
      props: {
        label: p.text("CkLbl", "Included"),
        state: p.variants({
          included: { "CkIcon.icon": "check", "CkIcon.color": c("success"), "CkLbl.fill": ink },
          excluded: { "CkIcon.icon": "minus", "CkIcon.color": muted, "CkLbl.fill": muted },
        }),
      },
      root: { dir: "row", w: 320, gap: 10, align: "start" },
    },
    (root) => {
      b.icon(root, "check", 18, c("success"), { key: "CkIcon" })
      b.para(root, "Included", b.ty("body", { size: 15 }), ink, { key: "CkLbl", name: "Label" })
    },
  )

  const ticket = b.component(
    "Ticket card",
    {
      key: "Ticket",
      section: "Tickets",
      description: "Fill the Includes slot with Check items. Sold out dims the price.",
      props: {
        name: p.text("TkName", "Standard"),
        price: p.text("TkPrice", "€590"),
        note: p.text("TkNote", "Excl. 25% Danish VAT"),
        description: p.text("TkDesc", "Who it is for."),
        flag: p.text("TkFlag/BadgeLbl", "Best value"),
        showFlag: p.bool("TkFlagWrap", false),
        cta: p.swap("TkCta", button),
        ctaLabel: p.text("TkCta/BtnLabel", "Buy ticket"),
        includes: p.slot("TkList"),
        tone: p.variants({
          standard: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border") },
            "TkName.fill": ink,
            "TkPrice.fill": ink,
            "TkDesc.fill": muted,
          },
          featured: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("accent"), width: 2 },
            "TkName.fill": ink,
            "TkPrice.fill": c("accent"),
            "TkDesc.fill": muted,
          },
          soldout: {
            "root.fill": c("subtle"),
            "root.stroke": { paint: c("border") },
            "TkName.fill": muted,
            "TkPrice.fill": muted,
            "TkDesc.fill": muted,
          },
        }),
      },
      root: {
        dir: "column",
        w: 384,
        gap: s(6),
        pad: s(8),
        radius: r("xl"),
        fill: c("surface"),
        stroke: { paint: c("border") },
        effects: b.shadow("card"),
      },
    },
    (root) => {
      const head = b.col(root, "Header", { w: FILL, gap: 8 })
      const top = b.row(head, "Name row", { w: FILL, justify: "between", align: "center" })
      b.text(top, "Standard", b.ty("title"), ink, { key: "TkName" })
      const flag = b.row(top, "Flag", { key: "TkFlagWrap", visible: false })
      b.use(flag, badge, { key: "TkFlag", args: { label: "Best value", tone: "lime" } })
      b.para(head, "Who it is for.", b.ty("body", { size: 15 }), muted, { key: "TkDesc" })
      const price = b.col(root, "Price", { w: FILL, gap: 2 })
      b.text(price, "€590", b.ty("display", { size: 56 }), ink, { key: "TkPrice" })
      b.text(price, "Excl. 25% Danish VAT", b.ty("small"), muted, { key: "TkNote" })
      b.use(root, button, {
        key: "TkCta",
        props: { w: FILL },
        args: { label: "Buy ticket", size: "lg" },
      })
      b.rect(root, "Rule", { w: FILL, h: 1, fill: c("border") })
      b.col(root, "Includes", {
        key: "TkList",
        w: FILL,
        gap: 12,
        slot: { suggested: [checkItem] },
      })
    },
  )

  const faq = b.component(
    "FAQ item",
    {
      key: "Faq",
      section: "Tickets",
      props: {
        question: p.text("FaqQ", "Question"),
        answer: p.text("FaqA", "Answer."),
        open: p.bool("FaqA", true),
      },
      root: {
        dir: "column",
        w: 792,
        gap: 10,
        pad: [22, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const head = b.row(root, "Question row", { w: FILL, gap: 16, align: "center" })
      b.para(head, "Question", b.ty("title", { size: 18 }), ink, { key: "FaqQ" })
      b.icon(head, "plus", 20, muted)
      b.para(root, "Answer.", b.ty("body"), muted, { key: "FaqA" })
    },
  )

  // --- Components: content ---------------------------------------------------------------------------

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
          inverse: { "StatVal.fill": c("lime"), "StatLbl.fill": c("inverse-muted") },
        }),
      },
      root: { dir: "column", w: 282, gap: 6 },
    },
    (root) => {
      b.text(root, "0", b.ty("display", { size: 64 }), ink, { key: "StatVal", name: "Value" })
      b.para(root, "Metric", b.ty("body"), muted, { key: "StatLbl", name: "Label" })
    },
  )

  const sponsor = b.component(
    "Sponsor logo",
    {
      key: "Sponsor",
      section: "Content",
      props: {
        name: p.text("SpoName", "Sponsor"),
        tier: p.variants({
          gold: { "root.h": 120, "SpoName.style/size": 24, "SpoIcon.w": 26, "SpoIcon.h": 26 },
          partner: { "root.h": 88, "SpoName.style/size": 18, "SpoIcon.w": 20, "SpoIcon.h": 20 },
        }),
      },
      root: {
        dir: "row",
        w: 282,
        h: 120,
        gap: 10,
        align: "center",
        justify: "center",
        radius: r("lg"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      },
    },
    (root) => {
      b.icon(root, "hexagon", 26, ink, { key: "SpoIcon" })
      b.text(root, "Sponsor", b.ty("title", { size: 24, weight: 800, letterSpacing: -0.8 }), ink, {
        key: "SpoName",
      })
    },
  )

  const infoItem = b.component(
    "Info item",
    {
      key: "Info",
      section: "Content",
      props: {
        label: p.text("IfLbl", "Label"),
        value: p.text("IfVal", "Value"),
        detail: p.text("IfDet", "Detail"),
        showDetail: p.bool("IfDet", true),
      },
      root: { dir: "row", w: 384, gap: s(4), align: "start" },
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
      b.icon(tile, "calendar", 20, c("accent"), { key: "IfIcon" })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Label", eyebrow, muted, { key: "IfLbl" })
      b.para(t, "Value", b.ty("title", { size: 18 }), ink, { key: "IfVal" })
      b.para(t, "Detail", b.ty("small"), muted, { key: "IfDet" })
    },
  )

  const hotel = b.component(
    "Hotel card",
    {
      key: "Hotel",
      section: "Content",
      props: {
        name: p.text("HtName", "Hotel"),
        area: p.text("HtArea", "Area"),
        distance: p.text("HtDist", "10 min"),
        price: p.text("HtPrice", "€0"),
        code: p.text("HtCode", "OFFSET27"),
        tone: p.variants({
          blue: { "HtArt.fill": toneFill("blue") },
          coral: { "HtArt.fill": toneFill("coral") },
          teal: { "HtArt.fill": toneFill("teal") },
        }),
      },
      root: {
        dir: "column",
        w: 384,
        radius: r("lg"),
        fill: c("surface"),
        stroke: { paint: c("border") },
        clip: true,
      },
    },
    (root) => {
      const art = b.row(root, "Image", {
        key: "HtArt",
        w: FILL,
        h: 160,
        align: "end",
        justify: "center",
        gap: 10,
        fill: toneFill("blue"),
      })
      for (const [w, h] of [
        [56, 72],
        [80, 120],
        [48, 92],
      ])
        b.rect(art, "Building", { w, h, radius: [6, 6, 0, 0], fill: c("figure"), opacity: 0.85 })
      const body = b.col(root, "Body", { w: FILL, gap: s(3), pad: 20 })
      const head = b.row(body, "Head", { w: FILL, justify: "between", align: "start" })
      const names = b.col(head, "Names", { gap: 2 })
      b.text(names, "Hotel", b.ty("title", { size: 18 }), ink, { key: "HtName" })
      b.text(names, "Area", b.ty("small"), muted, { key: "HtArea" })
      const price = b.col(head, "Price", { gap: 0, align: "end" })
      b.text(price, "€0", b.ty("title", { size: 18 }), ink, { key: "HtPrice" })
      b.text(price, "per night", b.ty("small"), muted)
      const meta = b.row(body, "Meta", { w: FILL, justify: "between", align: "center" })
      const d = b.row(meta, "Distance", { gap: 6, align: "center" })
      b.icon(d, "footprints", 15, muted)
      b.text(d, "10 min", b.ty("small"), muted, { key: "HtDist" })
      const code = b.row(meta, "Code", {
        gap: 6,
        align: "center",
        pad: [4, 8],
        radius: r("sm"),
        fill: c("subtle"),
      })
      b.text(code, "Code", b.ty("small"), muted)
      b.text(code, "OFFSET27", b.ty("mono", { size: 12 }), ink, { key: "HtCode" })
    },
  )

  // --- Venue map ------------------------------------------------------------------------------------

  const venueMap = b.component(
    "Venue map",
    {
      key: "Map",
      section: "Content",
      description: "Schematic map of Refshaleøen. The pin and label are an overlay.",
      props: { label: p.text("MapLbl", "Dok 4") },
      root: {
        dir: "column",
        w: 792,
        h: 480,
        gap: 10,
        pad: 0,
        radius: r("xl"),
        clip: true,
        fill: c("water"),
      },
    },
    (root) => {
      const row = (h: number, cells: [number | "fill", string][], pad: number[]) => {
        const rr = b.row(root, "Blocks", { w: FILL, h, gap: 10, pad })
        for (const [w, fill] of cells)
          b.rect(rr, "Block", {
            w: w === "fill" ? FILL : w,
            h: FILL,
            radius: r("sm"),
            fill: c(fill),
          })
      }
      row(
        110,
        [
          [160, "land"],
          [120, "block"],
          [220, "park"],
          ["fill", "block"],
        ],
        [0, 0, 0, 260],
      )
      row(
        90,
        [
          [140, "block"],
          [200, "land"],
          [90, "block"],
          ["fill", "land"],
        ],
        [0, 0, 0, 200],
      )
      row(
        110,
        [
          [240, "park"],
          [130, "block"],
          [150, "block"],
          ["fill", "land"],
        ],
        [0, 0, 0, 120],
      )
      row(
        140,
        [
          [180, "land"],
          [110, "block"],
          [160, "land"],
          [120, "block"],
          ["fill", "park"],
        ],
        [0, 0, 0, 0],
      )
      const pin = b.col(root, "Pin", {
        position: "absolute",
        x: 452,
        y: 168,
        gap: 6,
        align: "center",
        meta: { "kimo.template.overlay": true },
      })
      const tagRow = b.row(pin, "Label", {
        gap: 8,
        align: "center",
        pad: [8, 12],
        radius: r("pill"),
        fill: ink,
        effects: b.shadow("pop"),
      })
      b.icon(tagRow, "map-pin", 16, c("lime"))
      b.text(tagRow, "Dok 4", b.ty("label"), c("bg"), { key: "MapLbl" })
      b.ellipse(pin, "Point", {
        w: 18,
        h: 18,
        fill: c("lime"),
        stroke: { paint: ink, width: 3 },
      })
      const metro = b.row(root, "Metro", {
        position: "absolute",
        x: 40,
        y: 400,
        gap: 8,
        align: "center",
        pad: [6, 10],
        radius: r("pill"),
        fill: c("surface"),
        meta: { "kimo.template.overlay": true },
      })
      b.icon(metro, "ship", 15, c("accent"))
      b.text(metro, "Harbour bus 991 to Refshaleøen", b.ty("small", { weight: 600 }), ink)
    },
  )

  // --- Data ------------------------------------------------------------------------------------------

  interface Speaker {
    name: string
    role: string
    talk: string
    tone: Tone
    track: "main" | "studio"
  }
  const sp: Record<string, Speaker> = {
    HS: {
      name: "Hana Sato",
      role: "Principal designer, Northwind Maps",
      talk: "Maps for people who are lost and in a hurry",
      tone: "blue",
      track: "main",
    },
    MJ: {
      name: "Malik Johnson",
      role: "Head of design, Parcelly",
      talk: "One design system, 40 teams and no mandate",
      tone: "coral",
      track: "main",
    },
    EP: {
      name: "Elena Petrova",
      role: "Staff researcher, Quill Health",
      talk: "Research operations on a team of two",
      tone: "teal",
      track: "studio",
    },
    JL: {
      name: "Jonas Lindqvist",
      role: "Design engineer, Fable Bank",
      talk: "Prototyping in production code",
      tone: "lime",
      track: "studio",
    },
    PN: {
      name: "Priya Nair",
      role: "VP product design, Tandem",
      talk: "Pricing pages are product design",
      tone: "violet",
      track: "main",
    },
    CD: {
      name: "Camille Dubois",
      role: "Accessibility lead, Ledger & Co.",
      talk: "Screen reader testing in every sprint",
      tone: "blue",
      track: "main",
    },
    DR: {
      name: "Diego Romero",
      role: "Founder, Field Type",
      talk: "Variable fonts in product interfaces",
      tone: "coral",
      track: "studio",
    },
    AT: {
      name: "Aiko Tanaka",
      role: "Design manager, Orbit",
      talk: "Design critique people look forward to",
      tone: "teal",
      track: "studio",
    },
    KM: {
      name: "Kwame Mensah",
      role: "Director of design, Bolt Freight",
      talk: "Dashboards for the 6 a.m. shift",
      tone: "lime",
      track: "main",
    },
    SO: {
      name: "Sam O'Connell",
      role: "Product designer, Harbor",
      talk: "Designing for slow networks in 2027",
      tone: "violet",
      track: "studio",
    },
    FH: {
      name: "Freya Holm",
      role: "Creative director, Studio Nord",
      talk: "Motion specs developers can build",
      tone: "blue",
      track: "main",
    },
    LF: {
      name: "Lea Fischer",
      role: "Content designer, Kino",
      talk: "Workshop: writing interface copy as a team",
      tone: "coral",
      track: "studio",
    },
  }
  const order = ["HS", "MJ", "PN", "CD", "KM", "FH", "EP", "JL", "DR", "AT", "SO", "LF"] as const
  function speakerUse(parent: string, key: string, opts: { w?: number; talk?: boolean } = {}) {
    const x = sp[key] as Speaker
    return b.use(parent, speakerCard, {
      props: { w: opts.w ?? 282 },
      args: {
        name: x.name,
        role: x.role,
        talk: x.talk,
        track: x.track,
        ...(opts.talk === false ? { showTalk: false } : {}),
      },
      set: { SpPt: { props: { w: FILL }, args: { tone: x.tone } } },
    })
  }
  function sessionUse(parent: string, key: string, time: string, format = "Talk") {
    const x = sp[key] as Speaker
    const [role] = [x.role]
    return b.use(parent, session, {
      props: { w: 516 },
      args: { time, title: x.talk, speaker: x.name, role, format, track: x.track },
      set: { SsPt: { args: { size: "sm", tone: x.tone } } },
    })
  }

  // --- Shared sections -------------------------------------------------------------------------------

  function section(parent: string, name: string, props: Record<string, unknown> = {}) {
    return b.col(parent, name, { w: FILL, gap: s(12), pad: [96, 120], ...props })
  }
  function header(
    parent: string,
    eye: string,
    title: string,
    subtitle?: string,
    action?: (into: { inst: string; at: string }) => void,
  ) {
    b.use(parent, sectionHeader, {
      props: { w: FILL },
      args: { eyebrow: eye, title, ...(subtitle ? { subtitle } : { showSubtitle: false }) },
      ...(action ? { slots: { ShAct: action } } : {}),
    })
  }
  const sponsors: [string, string, "gold" | "partner"][] = [
    ["Northwind", "compass", "gold"],
    ["Fable Bank", "landmark", "gold"],
    ["Parcelly", "package", "gold"],
    ["Quill", "feather", "gold"],
    ["Tandem", "bike", "partner"],
    ["Orbit", "orbit", "partner"],
    ["Field Type", "type", "partner"],
    ["Harbor", "anchor", "partner"],
  ]
  function sponsorGrid(parent: string) {
    const grid = b.col(parent, "Sponsors", { w: FILL, gap: s(6) })
    for (let i = 0; i < 2; i++) {
      const row = b.row(grid, `Row ${i + 1}`, { w: FILL, gap: s(6) })
      for (const [name, icon, tier] of sponsors.slice(i * 4, i * 4 + 4))
        b.use(row, sponsor, { args: { name, tier }, set: { SpoIcon: { icon } } })
    }
  }
  function ctaBand(scr: string) {
    const wrap = b.col(scr, "Call to action", { w: FILL, pad: [0, 120, 96, 120] })
    const band = b.row(wrap, "Band", {
      w: FILL,
      gap: s(12),
      align: "center",
      justify: "between",
      pad: [56, 64],
      radius: r("xl"),
      fill: c("lime"),
    })
    const t = b.col(band, "Text", { w: 840, gap: s(3) })
    b.para(t, "Standard tickets are €590 until 1 March", b.ty("h1", { size: 40 }), c("on-lime"))
    b.para(
      t,
      "After that the price goes to €690. Teams of five or more save 17%.",
      b.ty("body-lg"),
      c("on-lime"),
    )
    const acts = b.row(band, "Actions", { gap: s(3), align: "center" })
    b.use(acts, button, {
      args: { label: "Get tickets", size: "lg", variant: "inverse", icon: true },
    })
  }
  const tickets: {
    name: string
    price: string
    note: string
    desc: string
    tone: "standard" | "featured" | "soldout"
    flag?: string
    cta: string
    secondary?: boolean
    items: [string, boolean][]
  }[] = [
    {
      name: "Early bird",
      price: "€390",
      note: "Sold out on 12 December",
      desc: "The first 200 tickets, released with the speaker list.",
      tone: "soldout",
      cta: "Sold out",
      secondary: true,
      items: [
        ["Both days, both tracks", true],
        ["Lunch, coffee and the pier party", true],
        ["Talk recordings after the event", true],
        ["One workshop seat", false],
      ],
    },
    {
      name: "Standard",
      price: "€590",
      note: "€690 from 1 March. Excl. 25% VAT",
      desc: "For designers, researchers and design engineers.",
      tone: "featured",
      flag: "Most bought",
      cta: "Buy ticket",
      items: [
        ["Both days, both tracks", true],
        ["Lunch, coffee and the pier party", true],
        ["Talk recordings after the event", true],
        ["One workshop seat, booked in March", true],
      ],
    },
    {
      name: "Team of five",
      price: "€2,450",
      note: "€490 per person. Excl. 25% VAT",
      desc: "Five named tickets on one invoice. Names can change until 1 April.",
      tone: "standard",
      cta: "Buy team tickets",
      secondary: true,
      items: [
        ["Everything in Standard", true],
        ["Reserved table at lunch", true],
        ["One invoice with your PO number", true],
        ["Swap names until 1 April", true],
      ],
    },
  ]
  function ticketRow(parent: string) {
    const row = b.row(parent, "Tickets", { w: FILL, gap: s(6), align: "stretch" })
    for (const t of tickets)
      b.use(row, ticket, {
        args: {
          name: t.name,
          price: t.price,
          note: t.note,
          description: t.desc,
          tone: t.tone,
          ctaLabel: t.cta,
          ...(t.flag ? { flag: t.flag, showFlag: true } : {}),
          ...(t.secondary ? { cta: buttonSecondary } : {}),
        },
        slots: {
          TkList: (into) => {
            for (const [label, yes] of t.items)
              b.use(into, checkItem, {
                props: { w: FILL },
                args: { label, state: yes ? "included" : "excluded" },
              })
          },
        },
      })
  }

  // --- Cover -----------------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Event template",
    title: "Offset conference site",
    description:
      "Home, speakers, two-track schedule, speaker page, tickets and venue screens for a two-day design conference. Built from 19 components with light and dark tokens.",
    preview: (area) => {
      const top = b.row(area, "Top", { w: FILL, justify: "between", align: "center" })
      b.use(top, badge, { args: { label: "15 and 16 April 2027, Copenhagen", tone: "lime" } })
      b.use(top, dayTabs)
      const pair = b.row(area, "Sessions", { w: FILL, gap: s(4) })
      for (const [k, t] of [
        ["HS", "09:30 to 10:15"],
        ["EP", "09:30 to 10:15"],
      ] as const)
        b.use(pair, session, {
          props: { w: 316 },
          args: {
            time: t,
            title: (sp[k] as Speaker).talk,
            speaker: (sp[k] as Speaker).name,
            role: (sp[k] as Speaker).role,
            track: (sp[k] as Speaker).track,
            format: "Talk",
          },
          set: { SsPt: { args: { size: "sm", tone: (sp[k] as Speaker).tone } } },
        })
      const people = b.row(area, "Speakers", { w: FILL, gap: s(4) })
      for (const k of ["MJ", "PN", "JL"]) speakerUse(people, k, { w: 205, talk: false })
    },
  })

  // --- Screens ---------------------------------------------------------------------------------------

  const screens = b.page("Screens")
  function page(name: string, active: "home" | "speakers" | "schedule" | "tickets" | "venue") {
    const scr = b.screen(screens, name, { w: 1440, fill: c("bg") })
    b.use(scr, navBar, { args: { active } })
    return scr
  }
  function pageHead(scr: string, eye: string, title: string, sub: string) {
    const top = b.col(scr, "Header", { w: FILL, gap: s(4), pad: [80, 120, 56, 120] })
    b.text(top, eye, eyebrow, c("accent"))
    b.text(top, title, b.ty("display"), ink)
    b.para(top, sub, b.ty("body-lg"), muted, { w: 680 })
    return top
  }

  // Home
  {
    const scr = page("Home", "home")
    const hero = b.col(scr, "Hero", {
      w: FILL,
      gap: s(10),
      pad: [72, 120, 80, 120],
      fill: c("inverse"),
    })
    const tags = b.row(hero, "Tags", { gap: 10, align: "center" })
    b.use(tags, badge, { args: { label: "15 and 16 April 2027", tone: "lime" } })
    b.text(
      tags,
      "Dok 4, Refshaleøen, Copenhagen",
      b.ty("label", { weight: 500 }),
      c("inverse-muted"),
    )
    const title = b.col(hero, "Title", { gap: 0 })
    const big = b.ty("hero", { size: 176, letterSpacing: -8 })
    b.text(title, "Offset", big, c("on-inverse"))
    b.text(title, "2027", big, c("lime"))
    const sub = b.row(hero, "Intro", { w: FILL, justify: "between", align: "end" })
    b.para(
      sub,
      "Two days, two tracks and 24 sessions on the craft of product design. 900 designers, researchers and design engineers in a former shipyard hall on the Copenhagen harbour.",
      b.ty("body-lg", { size: 20 }),
      c("inverse-muted"),
      { w: 620 },
    )
    const acts = b.row(sub, "Actions", { gap: s(3), align: "center" })
    b.use(acts, button, { args: { label: "Get tickets", size: "lg", variant: "lime", icon: true } })
    b.use(acts, button, { args: { label: "See the schedule", size: "lg", variant: "inverse" } })
    const nums = b.row(hero, "Numbers", {
      w: FILL,
      gap: s(6),
      pad: [40, 0, 0, 0],
      stroke: { paint: c("inverse-border"), width: { t: 1 } },
    })
    for (const [value, label] of [
      ["2", "Days, Thursday and Friday"],
      ["24", "Talks and workshops on two tracks"],
      ["900", "Attendees from 31 countries in 2026"],
      ["€590", "Standard ticket until 1 March"],
    ] as const)
      b.use(nums, stat, { args: { value, label, tone: "inverse" } })

    const people = section(scr, "Speakers")
    header(
      people,
      "Speakers",
      "Designers who ship, talking about how",
      "No sponsor slots on stage. Every talk was picked from 410 proposals by last year's speakers.",
      (into) => b.use(into, buttonSecondary, { args: { label: "All 12 speakers", icon: true } }),
    )
    const grid = b.row(people, "Grid", { w: FILL, gap: s(6), align: "start" })
    for (const k of ["HS", "MJ", "PN", "JL"]) speakerUse(grid, k)

    const plan = section(scr, "Schedule", { fill: c("surface") })
    header(
      plan,
      "Schedule",
      "Two tracks, one building",
      "Main stage talks run 45 minutes. The Studio holds shorter talks and hands-on workshops of up to 40 people.",
      (into) => b.use(into, button, { args: { label: "Full schedule", icon: true } }),
    )
    const days = b.row(plan, "Days", { w: FILL, gap: s(6), align: "start" })
    for (const [day, picks] of [
      [
        "Thursday 15 April",
        [
          ["09:30", "HS"],
          ["10:30", "EP"],
          ["11:45", "PN"],
        ],
      ],
      [
        "Friday 16 April",
        [
          ["09:30", "FH"],
          ["10:30", "AT"],
          ["11:45", "KM"],
        ],
      ],
    ] as const) {
      const col = b.col(days, day, { w: 588, gap: s(3) })
      b.text(col, day, b.ty("title"), ink)
      for (const [t, k] of picks) sessionUse(col, k, t)
    }

    const spon = section(scr, "Sponsors")
    header(spon, "Sponsors", "Offset is paid for by tickets and these teams")
    sponsorGrid(spon)
    ctaBand(scr)
    b.use(scr, footer)
  }

  // Speakers
  {
    const scr = page("Speakers", "speakers")
    const top = pageHead(
      scr,
      "Speakers",
      "12 speakers, 24 sessions",
      "Six on the main stage, six in the Studio. Every speaker gives one talk and joins the Friday Q&A.",
    )
    const filters = b.row(top, "Filters", { gap: 8, pad: [16, 0, 0, 0] })
    b.use(filters, badge, { args: { label: "All speakers", tone: "lime" } })
    b.use(filters, badge, { args: { label: "Main stage", tone: "main" } })
    b.use(filters, badge, { args: { label: "Studio", tone: "studio" } })
    const grid = b.col(scr, "Grid", { w: FILL, gap: s(12), pad: [0, 120, 96, 120] })
    for (let i = 0; i < 3; i++) {
      const row = b.row(grid, `Row ${i + 1}`, { w: FILL, gap: s(6), align: "start" })
      for (const k of order.slice(i * 4, i * 4 + 4)) speakerUse(row, k)
    }
    ctaBand(scr)
    b.use(scr, footer)
  }

  // Schedule
  {
    const scr = page("Schedule", "schedule")
    const top = pageHead(
      scr,
      "Schedule",
      "Thursday 15 April",
      "Doors open at 08:30. All times are Copenhagen time (CEST). Workshops need a seat, booked from your ticket page in March.",
    )
    const bar = b.row(top, "Controls", {
      w: FILL,
      justify: "between",
      align: "center",
      pad: [16, 0, 0, 0],
    })
    b.use(bar, dayTabs)
    const legend = b.row(bar, "Legend", { gap: 8 })
    b.use(legend, badge, { args: { label: "Main stage, hall A", tone: "main" } })
    b.use(legend, badge, { args: { label: "Studio, hall C", tone: "studio" } })

    const grid = b.col(scr, "Program", { w: FILL, gap: s(4), pad: [0, 120, 96, 120] })
    const heads = b.row(grid, "Track heads", { w: FILL, gap: s(6), pad: [0, 0, 4, 0] })
    b.text(heads, "Time", eyebrow, muted, { w: 120, grow: "fixed-width" })
    b.text(heads, "Main stage", eyebrow, c("accent"), { w: 516, grow: "fixed-width" })
    b.text(heads, "Studio", eyebrow, c("coral"), { w: 516, grow: "fixed-width" })
    const pause = (time: string, label: string, note: string, icon: string) =>
      b.use(grid, breakRow, {
        props: { w: FILL },
        args: { time, label, note },
        set: { BrIcon: { icon } },
      })
    const slot = (
      time: string,
      main: [string, string, string?],
      studio: [string, string, string?],
    ) => {
      const row = b.row(grid, time, { w: FILL, gap: s(6), align: "stretch" })
      b.text(row, time, b.ty("title", { size: 18 }), ink, {
        w: 120,
        grow: "fixed-width",
        name: "Time",
      })
      sessionUse(row, main[0], main[1], main[2])
      sessionUse(row, studio[0], studio[1], studio[2])
    }
    pause("08:30", "Registration, coffee and pastries", "Main hall", "coffee")
    slot("09:30", ["HS", "09:30 to 10:15", "Keynote"], ["LF", "09:30 to 11:00", "Workshop"])
    slot("10:30", ["MJ", "10:30 to 11:15"], ["EP", "11:00 to 11:30"])
    pause("11:15", "Coffee break", "Main hall and pier", "coffee")
    slot("11:45", ["PN", "11:45 to 12:30"], ["JL", "11:45 to 12:15"])
    pause("12:30", "Lunch", "Food hall, vegetarian and vegan", "utensils")
    slot("13:45", ["CD", "13:45 to 14:30"], ["DR", "13:45 to 14:15"])
    slot("14:30", ["KM", "14:30 to 15:15"], ["AT", "14:30 to 15:30", "Workshop"])
    pause("15:15", "Break", "Main hall", "coffee")
    slot("15:45", ["FH", "15:45 to 16:30"], ["SO", "15:45 to 16:15"])
    pause("17:00", "Drinks on the pier", "Until 20:00, bring a jacket", "wine")
    b.use(scr, footer)
  }

  // Speaker detail
  {
    const scr = page("Speaker detail", "speakers")
    const x = sp.HS as Speaker
    const body = b.row(scr, "Profile", { w: FILL, gap: s(16), pad: [64, 120, 96, 120] })
    b.use(body, portrait, { args: { size: "xl", tone: x.tone } })
    const info = b.col(body, "Info", { w: FILL, gap: s(6) })
    const back = b.row(info, "Back", { gap: 6, align: "center" })
    b.icon(back, "arrow-left", 16, muted)
    b.text(back, "All speakers", b.ty("label", { weight: 500 }), muted)
    b.use(info, badge, { args: { label: "Keynote, main stage", tone: "main" } })
    b.text(info, x.name, b.ty("display"), ink)
    b.text(info, x.role, b.ty("title", { weight: 500 }), muted)
    b.para(
      info,
      "Hana leads design for navigation at Northwind Maps, where her team of 14 works on routing, search and offline maps used by 60 million people a month. Before that she designed ticket machines for the Tokyo Metro, which she still calls the hardest interface she has worked on.",
      b.ty("body-lg"),
      ink,
    )
    b.para(
      info,
      "She lives in Malmö and commutes to Copenhagen, usually with the app open to see if it gets the train right.",
      b.ty("body-lg"),
      muted,
    )
    const links = b.row(info, "Links", { gap: s(5), align: "center" })
    for (const [icon, label] of [
      ["globe", "hanasato.design"],
      ["link", "LinkedIn"],
      ["mic", "2025 talk recording"],
    ] as const) {
      const l = b.row(links, label, { gap: 6, align: "center" })
      b.icon(l, icon, 16, c("accent"))
      b.text(l, label, b.ty("label"), c("accent"))
    }
    const talk = b.col(info, "Talk", {
      w: FILL,
      gap: s(4),
      pad: s(8),
      radius: r("xl"),
      fill: c("surface"),
      stroke: { paint: c("border") },
    })
    const tm = b.row(talk, "Meta", { w: FILL, gap: s(4), align: "center" })
    for (const [icon, t] of [
      ["calendar", "Thursday 15 April"],
      ["clock", "09:30 to 10:15"],
      ["map-pin", "Main stage, hall A"],
    ] as const) {
      const m = b.row(tm, t, { gap: 6, align: "center" })
      b.icon(m, icon, 15, muted)
      b.text(m, t, b.ty("small", { weight: 500 }), muted)
    }
    b.para(talk, x.talk, b.ty("heading", { size: 28 }), ink)
    b.para(
      talk,
      "Most map users are not exploring. They are late, on a phone with 9% battery, and need the next turn. Hana walks through three years of research on stressed navigation, the features her team removed, and the one they had to put back.",
      b.ty("body"),
      muted,
    )
    const ta = b.row(talk, "Actions", { gap: s(3) })
    b.use(ta, button, { args: { label: "Add to my schedule", icon: true } })
    b.use(ta, buttonSecondary, { args: { label: "Share talk" } })

    const more = section(scr, "Also speaking", { fill: c("surface"), pad: [80, 120] })
    header(more, "Also on the main stage", "More Thursday talks")
    const row = b.row(more, "Grid", { w: FILL, gap: s(6), align: "start" })
    for (const k of ["MJ", "PN", "CD", "KM"]) speakerUse(row, k)
    b.use(scr, footer)
  }

  // Tickets
  {
    const scr = page("Tickets", "tickets")
    pageHead(
      scr,
      "Tickets",
      "One ticket, both days",
      "Every ticket covers both days, both tracks, food and the Thursday pier party. Prices go up on 1 March.",
    )
    const plans = b.col(scr, "Plans", { w: FILL, pad: [0, 120] })
    ticketRow(plans)
    const notes = b.row(scr, "Notes", { w: FILL, gap: s(6), pad: [48, 120, 0, 120] })
    for (const [icon, label, value, detail] of [
      [
        "graduation-cap",
        "Scholarships",
        "40 free tickets",
        "For students and people between jobs. Apply by 15 February.",
      ],
      [
        "receipt",
        "Invoices",
        "Pay by card or invoice",
        "Invoices are due in 30 days and list the VAT for your company.",
      ],
      [
        "rotate-ccw",
        "Refunds",
        "Full refund until 1 March",
        "After that, transfer your ticket to a colleague for free.",
      ],
    ] as const)
      b.use(notes, infoItem, {
        args: { label, value, detail },
        set: { IfIcon: { icon } },
      })
    const qs = section(scr, "FAQ", { align: "center", gap: s(8) })
    b.text(qs, "Questions about tickets", b.ty("heading"), ink)
    const list = b.col(qs, "Items", { w: 792 })
    for (const [i, [question, answer]] of (
      [
        [
          "Can I come for one day only?",
          "Day passes go on sale on 1 March for €340 if seats are left. Most years they are gone within a week.",
        ],
        [
          "How do workshop seats work?",
          "Standard and team tickets include one workshop seat. Booking opens in March on your ticket page, first come, first served.",
        ],
        [
          "Will talks be recorded?",
          "Every main stage and Studio talk is recorded and sent to ticket holders within three weeks. Workshops are not recorded.",
        ],
        [
          "Is the venue accessible?",
          "Dok 4 is step-free, with a hearing loop in hall A and live captions on both stages. Write to us about anything else you need.",
        ],
      ] as const
    ).entries())
      b.use(list, faq, { props: { w: FILL }, args: { question, answer, open: i < 2 } })
    b.use(scr, footer)
  }

  // Venue and travel
  {
    const scr = page("Venue and travel", "venue")
    pageHead(
      scr,
      "Venue and travel",
      "Dok 4, Refshaleøen",
      "A former shipyard hall at the north end of the harbour, 15 minutes from the city centre by harbour bus.",
    )
    const top = b.row(scr, "Venue", { w: FILL, gap: s(6), pad: [0, 120], align: "start" })
    b.use(top, venueMap)
    const details = b.col(top, "Details", { w: FILL, gap: s(6) })
    for (const [icon, label, value, detail] of [
      ["map-pin", "Address", "Refshalevej 163, 1432 Copenhagen K", "Enter through the north gate."],
      [
        "ship",
        "Harbour bus",
        "Line 991 or 992 to Refshaleøen",
        "Every 20 minutes from Nyhavn. Included with any city pass.",
      ],
      [
        "plane",
        "From the airport",
        "25 minutes by metro and harbour bus",
        "Metro M2 to Kongens Nytorv, then walk 6 minutes to Nyhavn.",
      ],
      ["bike", "By bike", "Free bike parking at the door", "City bikes dock at Refshaleøen stop."],
    ] as const)
      b.use(details, infoItem, {
        props: { w: FILL },
        args: { label, value, detail },
        set: { IfIcon: { icon } },
      })

    const stay = section(scr, "Hotels")
    header(
      stay,
      "Where to stay",
      "Hotels with a conference rate",
      "Book with the code OFFSET27 before 1 March. Rooms are held until then.",
    )
    const hotels = b.row(stay, "Hotels", { w: FILL, gap: s(6) })
    for (const [name, area, distance, price, tone] of [
      ["Hotel Nyhavn 17", "Nyhavn", "12 min by harbour bus", "€189", "blue"],
      ["Kanal Rooms", "Christianshavn", "18 min by bike", "€154", "coral"],
      ["Værft Hostel", "Refshaleøen", "4 min walk", "€72", "teal"],
    ] as const)
      b.use(hotels, hotel, { args: { name, area, distance, price, tone } })
    b.use(scr, footer)
  }
}
