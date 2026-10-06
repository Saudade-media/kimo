/**
 * Oriel: the portfolio site of a fictional nine-person brand and digital design studio in
 * Rotterdam. Desktop (1440 wide): Home, Work, Case study, About, Contact. Mobile (390×844):
 * Home, Case study.
 */
import { FILL, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "agency-portfolio",
  name: "Oriel studio portfolio",
  category: "Portfolio",
  description:
    "Portfolio site for a small design studio: home, work, case study, about and contact on desktop, with mobile home and case study.",
  prefix: "ap",
  build,
}

type Tone = "clay" | "olive" | "sky" | "plum" | "sand"
type Motif = "mark" | "phone" | "browser" | "arches"

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F4F1EA", "#12110F"],
      surface: ["#FBF9F4", "#1A1916"],
      subtle: ["#EAE5DA", "#23211D"],
      ink: ["#171613", "#F2EEE6"],
      muted: ["#67625A", "#A59F94"],
      border: ["#D9D2C4", "#34312B"],
      accent: ["#D9431E", "#FF7A52"],
      "accent-soft": ["#F8E0D6", "#3B1E14"],
      "on-accent": ["#FFFFFF", "#12110F"],
      success: ["#2E7A4E", "#62C98F"],
      inverse: ["#1C1A17", "#0B0A09"],
      "on-inverse": ["#F4F1EA", "#F2EEE6"],
      "inverse-muted": ["#A39C8F", "#8E887D"],
      "inverse-border": ["#3A3631", "#2A2723"],
      "art-paper": ["#FBF8F1", "#EDE8DD"],
      "art-line": ["#D6CEBE", "#B9B09F"],
      "art-ink": ["#2A2620", "#2A2620"],
      clay: ["#E3A586", "#8A4A2E"],
      "clay-deep": ["#B9532F", "#5A2C1A"],
      olive: ["#C3C49A", "#585A35"],
      "olive-deep": ["#6E7140", "#33351D"],
      sky: ["#AFCADB", "#355468"],
      "sky-deep": ["#4F7B98", "#1E3444"],
      plum: ["#C7A6C2", "#5B3A58"],
      "plum-deep": ["#6B3E66", "#341D33"],
      sand: ["#E6D6B5", "#6A5B3E"],
      "sand-deep": ["#B79B63", "#3F3522"],
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
      "radius/md": 8,
      "radius/lg": 14,
      "radius/xl": 24,
      "radius/pill": 999,
    },
    type: {
      hero: { font: "Inter", size: 96, weight: 600, lineHeight: 1, letterSpacing: -3.8 },
      display: { font: "Inter", size: 72, weight: 600, lineHeight: 1, letterSpacing: -2.6 },
      h1: { font: "Inter", size: 56, weight: 600, lineHeight: 1.05, letterSpacing: -1.8 },
      heading: { font: "Inter", size: 36, weight: 600, lineHeight: 1.15, letterSpacing: -1 },
      title: { font: "Inter", size: 22, weight: 600, lineHeight: 1.3, letterSpacing: -0.4 },
      "body-lg": { font: "Inter", size: 19, weight: 400, lineHeight: 1.55, letterSpacing: -0.1 },
      body: { font: "Inter", size: 16, weight: 400, lineHeight: 1.55 },
      label: { font: "Inter", size: 14, weight: 600, lineHeight: 1.3 },
      small: { font: "Inter", size: 13, weight: 400, lineHeight: 1.45 },
      mono: { font: "JetBrains Mono", size: 12, weight: 500, lineHeight: 1.4, letterSpacing: 0.4 },
    },
    shadows: {
      card: [
        { kind: "shadow", x: 0, y: 1, blur: 2, color: "#17161312" },
        { kind: "shadow", x: 0, y: 12, blur: 32, spread: -12, color: "#17161326" },
      ],
      device: { kind: "shadow", x: 0, y: 24, blur: 48, spread: -16, color: "#1716134D" },
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
  const eyebrowStyle = b.ty("mono", { case: "upper", letterSpacing: 1.2 })

  // --- Components: actions -----------------------------------------------------------------------

  const button = b.component(
    "Button",
    {
      key: "Btn",
      section: "Actions",
      description: "Primary (ink), accent, secondary or inverse; md or lg. Arrow icon optional.",
      props: {
        label: p.text("BtnLabel", "Button"),
        icon: p.bool("BtnIcon", false),
        variant: p.variants({
          primary: {
            "root.fill": ink,
            "root.stroke": { paint: ink },
            "BtnLabel.fill": c("bg"),
            "BtnIcon.color": c("bg"),
          },
          accent: {
            "root.fill": c("accent"),
            "root.stroke": { paint: c("accent") },
            "BtnLabel.fill": c("on-accent"),
            "BtnIcon.color": c("on-accent"),
          },
          secondary: {
            "root.fill": c("bg"),
            "root.stroke": { paint: ink },
            "BtnLabel.fill": ink,
            "BtnIcon.color": ink,
          },
          inverse: {
            "root.fill": c("on-inverse"),
            "root.stroke": { paint: c("on-inverse") },
            "BtnLabel.fill": c("inverse"),
            "BtnIcon.color": c("inverse"),
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
        fill: ink,
        stroke: { paint: ink },
      },
    },
    (root) => {
      b.text(root, "Button", b.ty("label"), c("bg"), { key: "BtnLabel", name: "Label" })
      b.icon(root, "arrow-up-right", 16, c("bg"), { key: "BtnIcon", visible: false })
    },
  )
  const buttonSecondary = b.derive(button, "Button/Secondary", "BtnSec", {
    section: "Actions",
    args: { variant: "secondary" },
  })

  const tag = b.component(
    "Tag",
    {
      key: "Tag",
      section: "Actions",
      description: "Discipline label and filter chip. Solid marks the selected filter.",
      props: {
        label: p.text("TagLbl", "Identity"),
        tone: p.variants({
          outline: {
            "root.fill": c("bg"),
            "root.stroke": { paint: c("border") },
            "TagLbl.fill": ink,
          },
          solid: { "root.fill": ink, "root.stroke": { paint: ink }, "TagLbl.fill": c("bg") },
          accent: {
            "root.fill": c("accent-soft"),
            "root.stroke": { paint: c("accent-soft") },
            "TagLbl.fill": c("accent"),
          },
        }),
      },
      root: {
        dir: "row",
        align: "center",
        pad: [6, 12],
        radius: r("pill"),
        fill: c("bg"),
        stroke: { paint: c("border") },
      },
    },
    (root) =>
      b.text(root, "Identity", b.ty("small", { weight: 500 }), ink, {
        key: "TagLbl",
        name: "Label",
      }),
  )

  // --- Components: navigation ----------------------------------------------------------------------

  function brand(parent: string, onInverse = false, key?: string) {
    const row = b.row(parent, "Brand", { gap: 6, align: "center", ...(key ? { key } : {}) })
    b.text(
      row,
      "Oriel",
      b.ty("title", { size: 24, weight: 700, letterSpacing: -1 }),
      onInverse ? c("on-inverse") : ink,
      { name: "Wordmark" },
    )
    b.ellipse(row, "Dot", { w: 8, h: 8, fill: c("accent") })
    return row
  }
  function availability(parent: string, onInverse = false) {
    const row = b.row(parent, "Availability", { gap: 8, align: "center" })
    b.ellipse(row, "Status", { w: 8, h: 8, fill: c("success") })
    b.text(
      row,
      "Booking projects from January 2027",
      b.ty("small", { weight: 500 }),
      onInverse ? c("inverse-muted") : muted,
    )
    return row
  }

  const navLinks = ["Work", "Services", "Studio", "Contact"] as const
  const navActive = (i: number) =>
    Object.fromEntries(
      navLinks.flatMap((_, j) => [
        [`NavL${j + 1}.fill`, j === i ? ink : muted],
        [`NavL${j + 1}.style/decoration`, j === i ? ["underline"] : []],
      ]),
    )
  const navBar = b.component(
    "Nav bar",
    {
      key: "NavBar",
      section: "Navigation",
      description: "Desktop header. Set active to the current section.",
      props: {
        active: p.variants({
          home: navActive(-1),
          work: navActive(0),
          services: navActive(1),
          studio: navActive(2),
          contact: navActive(3),
        }),
        cta: p.bool("NavCta", true),
      },
      root: {
        dir: "row",
        w: 1440,
        justify: "between",
        align: "center",
        pad: [28, 120],
        fill: c("bg"),
      },
    },
    (root) => {
      const left = b.row(root, "Left", { w: 420, gap: 40, align: "center" })
      brand(left)
      const links = b.row(root, "Links", { gap: 36, align: "center" })
      for (const [i, l] of navLinks.entries())
        b.text(links, l, b.ty("body", { weight: 500 }), muted, { key: `NavL${i + 1}` })
      const right = b.row(root, "Right", { w: 420, gap: 20, align: "center", justify: "end" })
      availability(right)
      const cta = b.row(right, "Call to action", { key: "NavCta" })
      b.use(cta, button, { args: { label: "Start a project" } })
    },
  )

  const mobileHeader = b.component(
    "Mobile header",
    {
      key: "MobHead",
      section: "Navigation",
      description: "Mobile header with the menu button.",
      props: { showCta: p.bool("MhCta", false) },
      root: {
        dir: "row",
        w: 390,
        justify: "between",
        align: "center",
        pad: [16, 20],
        fill: c("bg"),
      },
    },
    (root) => {
      brand(root)
      const right = b.row(root, "Right", { gap: 10, align: "center" })
      const cta = b.row(right, "Call to action", { key: "MhCta", visible: false })
      b.use(cta, button, { args: { label: "Contact" } })
      const menu = b.row(right, "Menu", {
        w: 40,
        h: 40,
        align: "center",
        justify: "center",
        radius: r("pill"),
        stroke: { paint: c("border") },
      })
      b.icon(menu, "menu", 18, ink)
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
        gap: s(16),
        pad: [96, 120, 40, 120],
        fill: c("inverse"),
      },
    },
    (root) => {
      const top = b.row(root, "Top", { w: FILL, justify: "between", align: "end" })
      const pitch = b.col(top, "Pitch", { w: 760, gap: s(5) })
      b.text(pitch, "Have a project for 2027?", b.ty("h1"), c("on-inverse"))
      b.text(pitch, "hello@oriel.studio", b.ty("h1"), c("accent"), { name: "Email" })
      b.use(top, button, {
        args: { label: "Start a project", variant: "inverse", size: "lg", icon: true },
      })
      b.rect(root, "Rule", { w: FILL, h: 1, fill: c("inverse-border") })
      const cols = b.row(root, "Columns", { w: FILL, gap: s(10) })
      const col = (title: string, lines: string[]) => {
        const cc = b.col(cols, title, { w: 220, gap: 10 })
        b.text(cc, title, eyebrowStyle, c("inverse-muted"))
        for (const l of lines) b.text(cc, l, b.ty("body"), c("on-inverse"))
      }
      col("Studio", ["Schiedamse Vest 82", "3011 BE Rotterdam", "The Netherlands"])
      col("Contact", ["hello@oriel.studio", "+31 10 412 77 90", "Mon to Fri, 9:00 to 17:30"])
      col("Follow", ["Instagram", "LinkedIn", "Are.na"])
      const news = b.col(cols, "Newsletter", { w: FILL, gap: 10 })
      b.text(news, "Field notes", eyebrowStyle, c("inverse-muted"))
      b.para(
        news,
        "Four letters a year about what we made and what we learned making it.",
        b.ty("body"),
        c("on-inverse"),
      )
      const bottom = b.row(root, "Bottom", { w: FILL, justify: "between", align: "center" })
      b.text(bottom, "Oriel Studio B.V.  ·  KvK 71840326", b.ty("small"), c("inverse-muted"))
      availability(bottom, true)
      b.text(bottom, "Privacy  ·  Imprint", b.ty("small"), c("inverse-muted"))
    },
  )

  // --- Components: work ----------------------------------------------------------------------------

  const tonesOf = (t: Tone) => ({
    "root.fill": grad(t, `${t}-deep`),
    "ArtHero.fill": grad(`${t}-deep`, t, 200),
    "ArtTile.fill": c(t),
    "ArtBlock.fill": grad(t, `${t}-deep`, 120),
    "ArtArch2.fill": c(`${t}-deep`),
  })
  const motifOf = (m: Motif) => ({
    "ArtMark.visible": m === "mark",
    "ArtPhone.visible": m === "phone",
    "ArtBrowser.visible": m === "browser",
    "ArtArches.visible": m === "arches",
  })
  const arch = (w: number, h: number) => ({ w, h, radius: [w / 2, w / 2, 0, 0] })
  const archSize = (w: number, h: number) =>
    Object.fromEntries(
      [1, 2, 3].flatMap((i) => {
        const a = arch(w, i === 2 ? h * 1.25 : h)
        return [
          [`ArtArch${i}.w`, a.w],
          [`ArtArch${i}.h`, a.h],
          [`ArtArch${i}.radius`, a.radius],
        ]
      }),
    )
  const projectArt = b.component(
    "Project art",
    {
      key: "Art",
      section: "Work",
      description:
        "Stands in for project photography: a tone, a motif (wordmark, phone, browser or arches) and a scale.",
      props: {
        wordmark: p.text("ArtWord", "Hollis"),
        tone: p.variants({
          clay: tonesOf("clay"),
          olive: tonesOf("olive"),
          sky: tonesOf("sky"),
          plum: tonesOf("plum"),
          sand: tonesOf("sand"),
        }),
        motif: p.variants({
          mark: motifOf("mark"),
          phone: motifOf("phone"),
          browser: motifOf("browser"),
          arches: motifOf("arches"),
        }),
        scale: p.variants({
          md: {
            "ArtDot.w": 48,
            "ArtDot.h": 48,
            "ArtWord.style/size": 64,
            "ArtWord.style/letterSpacing": -2.4,
            "ArtPhone.w": 168,
            "ArtPhone.h": 300,
            "ArtBrowser.w": 300,
            "ArtBrowser.h": 200,
            ...archSize(76, 150),
          },
          lg: {
            "ArtDot.w": 88,
            "ArtDot.h": 88,
            "ArtWord.style/size": 128,
            "ArtWord.style/letterSpacing": -5,
            "ArtPhone.w": 240,
            "ArtPhone.h": 440,
            "ArtBrowser.w": 720,
            "ArtBrowser.h": 420,
            ...archSize(132, 260),
          },
        }),
      },
      root: {
        dir: "row",
        w: 560,
        h: 380,
        align: "center",
        justify: "center",
        radius: r("lg"),
        clip: true,
        fill: grad("clay", "clay-deep"),
      },
    },
    (root) => {
      const mark = b.row(root, "Wordmark", { key: "ArtMark", gap: 14, align: "center" })
      b.ellipse(mark, "Dot", { key: "ArtDot", w: 48, h: 48, fill: c("art-paper") })
      b.text(mark, "Hollis", b.ty("display", { size: 64, weight: 700 }), c("art-paper"), {
        key: "ArtWord",
        name: "Wordmark",
      })

      const phone = b.col(root, "Phone", {
        key: "ArtPhone",
        visible: false,
        w: 168,
        h: 300,
        gap: 9,
        pad: [12, 10],
        radius: 26,
        fill: c("art-paper"),
        effects: b.shadow("device"),
      })
      const notch = b.row(phone, "Status", { w: FILL, justify: "center" })
      b.rect(notch, "Notch", { w: 44, h: 6, radius: r("pill"), fill: c("art-line") })
      b.rect(phone, "Hero", {
        key: "ArtHero",
        w: FILL,
        h: FILL,
        radius: 16,
        fill: grad("clay-deep", "clay", 200),
      })
      b.rect(phone, "Line", { w: FILL, h: 9, radius: r("sm"), fill: c("art-ink") })
      b.rect(phone, "Line short", { w: 80, h: 9, radius: r("sm"), fill: c("art-line") })
      const tiles = b.row(phone, "Tiles", { w: FILL, gap: 8 })
      b.rect(tiles, "Tile", { key: "ArtTile", w: FILL, h: 52, radius: 12, fill: c("clay") })
      b.rect(tiles, "Tile", { w: FILL, h: 52, radius: 12, fill: c("art-line") })

      const browser = b.col(root, "Browser", {
        key: "ArtBrowser",
        visible: false,
        w: 300,
        h: 200,
        radius: r("md"),
        fill: c("art-paper"),
        clip: true,
        effects: b.shadow("device"),
      })
      const bar = b.row(browser, "Bar", { w: FILL, gap: 5, pad: [9, 12], align: "center" })
      for (let i = 0; i < 3; i++) b.ellipse(bar, "Dot", { w: 7, h: 7, fill: c("art-line") })
      const page = b.col(browser, "Page", { w: FILL, h: FILL, gap: 10, pad: [12, 18, 18, 18] })
      b.rect(page, "Heading", { w: 150, h: 12, radius: r("sm"), fill: c("art-ink") })
      b.rect(page, "Line", { w: 104, h: 8, radius: r("sm"), fill: c("art-line") })
      const blocks = b.row(page, "Blocks", { w: FILL, h: FILL, gap: 10 })
      b.rect(blocks, "Block", {
        key: "ArtBlock",
        w: { mode: "fill", weight: 2 },
        h: FILL,
        radius: r("md"),
        fill: grad("clay", "clay-deep", 120),
      })
      b.rect(blocks, "Block", { w: FILL, h: FILL, radius: r("md"), fill: c("art-line") })

      const arches = b.row(root, "Arches", {
        key: "ArtArches",
        visible: false,
        gap: 12,
        align: "end",
      })
      b.rect(arches, "Arch", { key: "ArtArch1", ...arch(76, 150), fill: c("art-paper") })
      b.rect(arches, "Arch", { key: "ArtArch2", ...arch(76, 187.5), fill: c("clay-deep") })
      b.rect(arches, "Arch", { key: "ArtArch3", ...arch(76, 150), fill: c("art-ink") })
    },
  )

  const caseCard = b.component(
    "Case card",
    {
      key: "Case",
      section: "Work",
      description: "Project teaser. Set the art's tone, motif and height through CcArt.",
      props: {
        title: p.text("CcTitle", "Hollis Coffee"),
        summary: p.text("CcSum", "Identity and packaging for a Rotterdam roaster"),
        year: p.text("CcYear", "2026"),
        tag1: p.text("CcTag1/TagLbl", "Identity"),
        tag2: p.text("CcTag2/TagLbl", "Packaging"),
        tags: p.bool("CcTags", true),
        wordmark: p.text("CcArt/ArtWord", "Hollis"),
      },
      root: { dir: "column", w: 560, gap: s(5) },
    },
    (root) => {
      b.use(root, projectArt, { key: "CcArt", props: { w: FILL } })
      const meta = b.row(root, "Meta", { w: FILL, gap: s(6), align: "start" })
      const names = b.col(meta, "Names", { w: FILL, gap: 4 })
      b.text(names, "Hollis Coffee", b.ty("title"), ink, { key: "CcTitle", name: "Title" })
      b.para(names, "Identity and packaging for a Rotterdam roaster", b.ty("body"), muted, {
        key: "CcSum",
        name: "Summary",
      })
      b.text(meta, "2026", b.ty("mono"), muted, { key: "CcYear", name: "Year" })
      const tags = b.row(root, "Tags", { key: "CcTags", gap: 8 })
      b.use(tags, tag, { key: "CcTag1" })
      b.use(tags, tag, { key: "CcTag2", args: { label: "Packaging" } })
    },
  )

  const workRow = b.component(
    "Work row",
    {
      key: "WorkRow",
      section: "Work",
      description: "One line of the project index. Hover shows the accent title and arrow.",
      props: {
        number: p.text("WrNo", "01"),
        project: p.text("WrName", "Project"),
        client: p.text("WrClient", "Client"),
        discipline: p.text("WrDisc", "Identity, packaging"),
        year: p.text("WrYear", "2026"),
        state: p.variants({
          default: { "WrName.fill": ink, "WrArrow.color": muted, "root.fill": c("bg") },
          hover: {
            "WrName.fill": c("accent"),
            "WrArrow.color": c("accent"),
            "root.fill": c("surface"),
          },
        }),
      },
      root: {
        dir: "row",
        w: 1200,
        gap: s(6),
        align: "center",
        pad: [24, 8],
        fill: c("bg"),
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      b.text(root, "01", b.ty("mono"), muted, { key: "WrNo", w: 56, grow: "fixed-width" })
      b.text(root, "Project", b.ty("title", { size: 26 }), ink, {
        key: "WrName",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(root, "Client", b.ty("body"), muted, { key: "WrClient", w: 240, grow: "fixed-width" })
      b.text(root, "Identity, packaging", b.ty("body"), muted, {
        key: "WrDisc",
        w: 260,
        grow: "fixed-width",
      })
      b.text(root, "2026", b.ty("mono", { align: "right" }), muted, {
        key: "WrYear",
        w: 64,
        grow: "fixed-width",
      })
      b.icon(root, "arrow-up-right", 20, muted, { key: "WrArrow" })
    },
  )

  const service = b.component(
    "Service",
    {
      key: "Service",
      section: "Content",
      description: "Numbered service with a Deliverables slot for Tags.",
      props: {
        number: p.text("SvNo", "01"),
        title: p.text("SvTitle", "Service"),
        body: p.text("SvBody", "What it covers."),
        deliverables: p.slot("SvList"),
      },
      root: {
        dir: "column",
        w: 280,
        gap: s(4),
        pad: [24, 0, 0, 0],
        stroke: { paint: ink, width: { t: 1 } },
      },
    },
    (root) => {
      b.text(root, "01", b.ty("mono"), c("accent"), { key: "SvNo", name: "Number" })
      b.text(root, "Service", b.ty("title", { size: 24 }), ink, { key: "SvTitle", name: "Title" })
      b.para(root, "What it covers.", b.ty("body"), muted, { key: "SvBody", name: "Body" })
      b.row(root, "Deliverables", {
        key: "SvList",
        w: FILL,
        gap: 6,
        wrap: true,
        crossGap: 6,
        pad: [8, 0, 0, 0],
        slot: { suggested: [tag] },
      })
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
          accent: { "StatVal.fill": c("accent"), "StatLbl.fill": muted },
        }),
      },
      root: { dir: "column", w: 280, gap: s(2) },
    },
    (root) => {
      b.text(root, "0", b.ty("h1"), ink, { key: "StatVal", name: "Value" })
      b.para(root, "Metric", b.ty("body"), muted, { key: "StatLbl", name: "Label" })
    },
  )

  const avatar = b.component(
    "Avatar",
    {
      key: "Avatar",
      section: "People",
      props: {
        initials: p.text("AvInit", "NV"),
        size: p.variants({
          sm: { "root.w": 32, "root.h": 32, "AvInit.style/size": 12 },
          md: { "root.w": 44, "root.h": 44, "AvInit.style/size": 15 },
          lg: { "root.w": 64, "root.h": 64, "AvInit.style/size": 20 },
        }),
        tone: p.variants({
          clay: { "root.fill": c("clay") },
          olive: { "root.fill": c("olive") },
          sky: { "root.fill": c("sky") },
          plum: { "root.fill": c("plum") },
          sand: { "root.fill": c("sand") },
        }),
      },
      root: {
        dir: "row",
        w: 44,
        h: 44,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("clay"),
      },
    },
    (root) => b.text(root, "NV", b.ty("label"), c("art-ink"), { key: "AvInit", name: "Initials" }),
  )

  const quote = b.component(
    "Quote",
    {
      key: "Quote",
      section: "People",
      description: "Client quote. Inverse for dark bands.",
      props: {
        quote: p.text("QText", "Quote"),
        name: p.text("QName", "Name"),
        role: p.text("QRole", "Role"),
        initials: p.text("QAv/AvInit", "MV"),
        tone: p.variants({
          default: { "QText.fill": ink, "QName.fill": ink, "QRole.fill": muted },
          inverse: {
            "QText.fill": c("on-inverse"),
            "QName.fill": c("on-inverse"),
            "QRole.fill": c("inverse-muted"),
          },
        }),
      },
      root: { dir: "column", w: 960, gap: s(8) },
    },
    (root) => {
      b.para(root, "Quote", b.ty("heading", { weight: 500, lineHeight: 1.25 }), ink, {
        key: "QText",
        name: "Quote",
      })
      const who = b.row(root, "Person", { gap: 14, align: "center" })
      b.use(who, avatar, { key: "QAv", args: { initials: "MV", tone: "clay" } })
      const names = b.col(who, "Names", { gap: 2 })
      b.text(names, "Name", b.ty("label", { size: 15 }), ink, { key: "QName" })
      b.text(names, "Role", b.ty("small"), muted, { key: "QRole" })
    },
  )

  const teamCard = b.component(
    "Team card",
    {
      key: "Team",
      section: "People",
      props: {
        name: p.text("TmName", "Name"),
        role: p.text("TmRole", "Role"),
        initials: p.text("TmInit", "NV"),
        tone: p.variants({
          clay: { "TmPortrait.fill": grad("clay", "clay-deep") },
          olive: { "TmPortrait.fill": grad("olive", "olive-deep") },
          sky: { "TmPortrait.fill": grad("sky", "sky-deep") },
          plum: { "TmPortrait.fill": grad("plum", "plum-deep") },
          sand: { "TmPortrait.fill": grad("sand", "sand-deep") },
        }),
      },
      root: { dir: "column", w: 280, gap: s(4) },
    },
    (root) => {
      const portrait = b.col(root, "Portrait", {
        key: "TmPortrait",
        w: FILL,
        h: 340,
        justify: "end",
        pad: 24,
        radius: r("lg"),
        fill: grad("clay", "clay-deep"),
      })
      b.text(
        portrait,
        "NV",
        b.ty("display", { size: 88, weight: 700, letterSpacing: -4 }),
        c("art-paper"),
        { key: "TmInit", name: "Initials" },
      )
      const names = b.col(root, "Names", { w: FILL, gap: 2 })
      b.text(names, "Name", b.ty("title", { size: 19 }), ink, { key: "TmName" })
      b.text(names, "Role", b.ty("body"), muted, { key: "TmRole" })
    },
  )

  const clientLogo = b.component(
    "Client logo",
    {
      key: "Logo",
      section: "Content",
      props: { name: p.text("LogoName", "Client") },
      root: { dir: "row", gap: 8, align: "center" },
    },
    (root) => {
      b.icon(root, "coffee", 22, muted, { key: "LogoIcon" })
      b.text(root, "Client", b.ty("title", { weight: 700, letterSpacing: -0.6 }), muted, {
        key: "LogoName",
        name: "Name",
      })
    },
  )

  const sectionHeader = b.component(
    "Section header",
    {
      key: "SecHead",
      section: "Content",
      description: "Numbered eyebrow, title and an optional link on the right.",
      props: {
        eyebrow: p.text("ShEye", "(01) Section"),
        title: p.text("ShTitle", "Section title"),
        link: p.text("ShLinkLbl", "See all"),
        showLink: p.bool("ShLink", true),
      },
      root: { dir: "row", w: 1200, gap: s(8), justify: "between", align: "end" },
    },
    (root) => {
      const left = b.col(root, "Text", { w: 760, gap: s(4) })
      b.text(left, "(01) Section", eyebrowStyle, c("accent"), { key: "ShEye", name: "Eyebrow" })
      b.para(left, "Section title", b.ty("h1"), ink, { key: "ShTitle", name: "Title" })
      const link = b.row(root, "Link", {
        key: "ShLink",
        gap: 6,
        align: "center",
        pad: [0, 0, 4, 0],
        stroke: { paint: ink, width: { b: 1 } },
      })
      b.text(link, "See all", b.ty("label", { size: 15 }), ink, { key: "ShLinkLbl" })
      b.icon(link, "arrow-right", 16, ink)
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
        lines: p.variants({
          single: { "InField.h": 52, "InField.layout/align": "center" },
          multi: { "InField.h": 156, "InField.layout/align": "start" },
        }),
      },
      root: { dir: "column", w: 400, gap: s(2) },
    },
    (root) => {
      b.text(root, "Label", b.ty("label"), ink, { key: "InLbl" })
      const field = b.row(root, "Field", {
        key: "InField",
        w: FILL,
        h: 52,
        align: "center",
        pad: [14, 16],
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      })
      b.text(field, "Placeholder", b.ty("body"), muted, { key: "InPh" })
    },
  )

  const infoItem = b.component(
    "Info item",
    {
      key: "Info",
      section: "Forms",
      props: { label: p.text("IfLbl", "Label"), value: p.text("IfVal", "Value") },
      root: {
        dir: "row",
        w: 480,
        gap: s(4),
        align: "start",
        pad: [20, 0],
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      const tile = b.row(root, "Icon tile", {
        w: 40,
        h: 40,
        radius: r("pill"),
        fill: c("accent-soft"),
        align: "center",
        justify: "center",
      })
      b.icon(tile, "mail", 18, c("accent"), { key: "IfIcon" })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Label", eyebrowStyle, muted, { key: "IfLbl" })
      b.para(t, "Value", b.ty("title", { size: 19, weight: 500 }), ink, { key: "IfVal" })
    },
  )

  // --- Data ----------------------------------------------------------------------------------------

  interface Project {
    title: string
    summary: string
    client: string
    year: string
    tags: [string, string]
    discipline: string
    tone: Tone
    motif: Motif
    word: string
  }
  const projects: Project[] = [
    {
      title: "Hollis Coffee",
      summary: "Identity and packaging for a Rotterdam roaster with four cafés",
      client: "Hollis Coffee Roasters",
      year: "2026",
      tags: ["Identity", "Packaging"],
      discipline: "Identity, packaging",
      tone: "clay",
      motif: "mark",
      word: "Hollis",
    },
    {
      title: "Ferro Bikes",
      summary: "Online shop and frame configurator for a Utrecht bike maker",
      client: "Ferro Cycles B.V.",
      year: "2026",
      tags: ["Website", "E-commerce"],
      discipline: "Website, e-commerce",
      tone: "sky",
      motif: "browser",
      word: "Ferro",
    },
    {
      title: "Lumen Health",
      summary: "Patient app for a fertility clinic in Amsterdam and Leiden",
      client: "Lumen Kliniek",
      year: "2025",
      tags: ["App", "Service design"],
      discipline: "App, service design",
      tone: "plum",
      motif: "phone",
      word: "Lumen",
    },
    {
      title: "Museum Noord",
      summary: "Identity and wayfinding for a regional history museum",
      client: "Stichting Museum Noord",
      year: "2025",
      tags: ["Identity", "Wayfinding"],
      discipline: "Identity, wayfinding",
      tone: "sand",
      motif: "arches",
      word: "Noord",
    },
    {
      title: "Kade Wonen",
      summary: "Tenant portal for a housing cooperative with 2,400 homes",
      client: "Woningcoöperatie Kade",
      year: "2024",
      tags: ["Web app", "Research"],
      discipline: "Web app, research",
      tone: "olive",
      motif: "phone",
      word: "Kade",
    },
    {
      title: "Tij Festival",
      summary: "Identity, posters and site for a three-day music festival on the Maas",
      client: "Tij Events",
      year: "2024",
      tags: ["Identity", "Website"],
      discipline: "Identity, website",
      tone: "olive",
      motif: "mark",
      word: "Tij",
    },
  ]
  const more = [
    ["Vos & Daughters", "Vos Bakkerij", "Identity, signage", "2024"],
    ["Groen Energie", "Groen Coöperatief", "Website", "2023"],
    ["Atelier Brandt", "Brandt Architecten", "Identity, website", "2023"],
  ] as const

  function caseUse(
    parent: string,
    pr: Project,
    artH: number,
    opts: { scale?: "md" | "lg"; w?: unknown; tags?: boolean; motif?: Motif } = {},
  ) {
    return b.use(parent, caseCard, {
      props: { w: opts.w ?? FILL },
      args: {
        title: pr.title,
        summary: pr.summary,
        year: pr.year,
        tag1: pr.tags[0],
        tag2: pr.tags[1],
        wordmark: pr.word,
        ...(opts.tags === false ? { tags: false } : {}),
      },
      set: {
        CcArt: {
          props: { w: FILL, h: artH },
          args: { tone: pr.tone, motif: opts.motif ?? pr.motif, scale: opts.scale ?? "md" },
        },
      },
    })
  }
  function art(
    parent: string,
    pr: Project,
    h: number,
    opts: { motif?: Motif; scale?: "md" | "lg"; w?: unknown; tone?: Tone } = {},
  ) {
    return b.use(parent, projectArt, {
      props: { w: opts.w ?? FILL, h },
      args: {
        wordmark: pr.word,
        tone: opts.tone ?? pr.tone,
        motif: opts.motif ?? pr.motif,
        scale: opts.scale ?? "md",
      },
    })
  }
  const [hollis, ferro, lumen, noord, kade, tij] = projects as [
    Project,
    Project,
    Project,
    Project,
    Project,
    Project,
  ]

  const team = [
    ["Noor van Dijk", "Founder, creative director", "NV", "clay"],
    ["Jasper Okoye", "Design director", "JO", "sky"],
    ["Lieke Bos", "Brand designer", "LB", "sand"],
    ["Tomás Reyes", "Product designer", "TR", "plum"],
    ["Amira Haddad", "Developer", "AH", "olive"],
    ["Ruben Smit", "Strategist", "RS", "sky"],
  ] as const
  const clients: [string, string][] = [
    ["Hollis", "coffee"],
    ["Ferro", "bike"],
    ["Lumen", "heart-pulse"],
    ["Museum Noord", "landmark"],
    ["Kade", "house"],
    ["Tij", "waves"],
  ]
  const services = [
    [
      "01",
      "Brand identity",
      "Names, logos, type and colour systems, with guidelines your own team can work from.",
      ["Strategy", "Logo", "Guidelines"],
    ],
    [
      "02",
      "Websites",
      "Marketing sites and shops, designed and built by us, on a CMS your team can edit.",
      ["Design", "Webflow", "Shopify"],
    ],
    [
      "03",
      "Product design",
      "Apps and portals, from the first interviews to a tested prototype and a handoff file.",
      ["Research", "UX", "Prototypes"],
    ],
    [
      "04",
      "Packaging and print",
      "Labels, boxes, signage and posters, with proofing and press checks at the printer.",
      ["Packaging", "Signage", "Print"],
    ],
  ] as const

  // --- Shared sections -----------------------------------------------------------------------------

  function section(parent: string, name: string, props: Record<string, unknown> = {}) {
    return b.col(parent, name, { w: FILL, gap: s(12), pad: [96, 120], ...props })
  }
  function header(parent: string, eyebrow: string, title: string, link?: string) {
    b.use(parent, sectionHeader, {
      props: { w: FILL },
      args: { eyebrow, title, ...(link ? { link } : { showLink: false }) },
    })
  }
  function clientRow(parent: string) {
    const row = b.row(parent, "Clients", { w: FILL, justify: "between", align: "center" })
    for (const [name, icon] of clients)
      b.use(row, clientLogo, { args: { name }, set: { LogoIcon: { icon } } })
  }
  function serviceRow(parent: string) {
    const row = b.row(parent, "Services", { w: FILL, gap: s(8), align: "stretch" })
    for (const [number, title, body, list] of services)
      b.use(row, service, {
        props: { w: 276 },
        args: { number, title, body },
        slots: {
          SvList: (into) => {
            for (const label of list) b.use(into, tag, { args: { label } })
          },
        },
      })
  }
  const hollisQuote = {
    quote:
      "Oriel spent the first two weeks behind our counters and in the roastery. The identity they came back with looks like us on a good day, and our baristas use the guidelines without asking.",
    name: "Marieke Vos",
    role: "Founder, Hollis Coffee Roasters",
    initials: "MV",
  }

  // --- Cover ---------------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Portfolio template",
    title: "Oriel studio portfolio",
    description:
      "Home, work, case study, about and contact pages for a nine-person design studio, plus mobile home and case study. Built from 18 components with light and dark tokens.",
    preview: (area) => {
      const top = b.col(area, "Hero", { w: FILL, gap: s(4) })
      b.text(top, "Brand and digital design, Rotterdam", eyebrowStyle, c("accent"))
      b.para(
        top,
        "Brands, websites and apps for independent businesses.",
        b.ty("heading", { size: 40, letterSpacing: -1.4 }),
        ink,
      )
      const cards = b.row(area, "Cards", { w: FILL, gap: s(6), align: "start" })
      caseUse(cards, hollis, 330, { tags: false, w: 324 })
      caseUse(cards, lumen, 330, { tags: false, w: 324 })
    },
  })

  // --- Desktop -------------------------------------------------------------------------------------

  const desktop = b.page("Desktop")
  function page(name: string, active: "home" | "work" | "services" | "studio" | "contact") {
    const scr = b.screen(desktop, name, { w: 1440, fill: c("bg") })
    b.use(scr, navBar, { args: { active } })
    return scr
  }

  // Home
  {
    const scr = page("Home", "home")
    const hero = b.col(scr, "Hero", { w: FILL, gap: s(12), pad: [96, 120, 80, 120] })
    b.text(hero, "Brand and digital design studio, Rotterdam", eyebrowStyle, c("accent"))
    b.para(hero, "Brands, websites and apps for independent businesses.", b.ty("hero"), ink, {
      w: 1080,
    })
    const sub = b.row(hero, "Intro", { w: FILL, justify: "between", align: "end" })
    b.para(
      sub,
      "Oriel is nine people in one room on the Schiedamse Vest. Since 2017 we have worked with roasters, clinics, museums and bike makers on identities and sites that hold up in print, on screen and in the shop.",
      b.ty("body-lg"),
      muted,
      { w: 600 },
    )
    const acts = b.row(sub, "Actions", { gap: s(3), align: "center" })
    b.use(acts, button, { args: { label: "See the work", size: "lg" } })
    b.use(acts, buttonSecondary, { args: { label: "Start a project", size: "lg", icon: true } })

    const feat = b.col(scr, "Featured", { w: FILL, pad: [0, 120] })
    caseUse(feat, hollis, 640, { scale: "lg" })

    const work = section(scr, "Selected work")
    header(work, "(01) Selected work", "Recent projects", "All work (24)")
    const grid = b.col(work, "Grid", { w: FILL, gap: s(16) })
    for (const pair of [
      [ferro, lumen],
      [noord, kade],
    ]) {
      const row = b.row(grid, "Row", { w: FILL, gap: s(8), align: "start" })
      for (const pr of pair) caseUse(row, pr, 440, { w: 584 })
    }

    const svc = section(scr, "Services", { fill: c("surface") })
    header(svc, "(02) Services", "What we do", "How we work")
    serviceRow(svc)

    const voice = section(scr, "Testimonial", { align: "center", gap: s(16) })
    b.use(voice, quote, { args: hollisQuote })
    const proof = b.col(voice, "Clients", { w: FILL, gap: s(8), align: "center" })
    b.text(proof, "Clients since 2017 include", b.ty("label", { weight: 500 }), muted)
    clientRow(proof)
    b.use(scr, footer)
  }

  // Work
  {
    const scr = page("Work", "work")
    const top = b.col(scr, "Header", { w: FILL, gap: s(10), pad: [80, 120, 56, 120] })
    b.text(top, "Work", b.ty("hero"), ink)
    const sub = b.row(top, "Intro", { w: FILL, justify: "between", align: "end" })
    b.para(
      sub,
      "24 projects since 2017. Most of them started as a phone call about one thing and ended up as three.",
      b.ty("body-lg"),
      muted,
      { w: 520 },
    )
    const filters = b.row(sub, "Filters", { gap: 8 })
    b.use(filters, tag, { args: { label: "All 24", tone: "solid" } })
    for (const label of ["Identity 11", "Websites 8", "Apps 3", "Packaging 2"])
      b.use(filters, tag, { args: { label } })

    const grid = b.col(scr, "Grid", { w: FILL, gap: s(16), pad: [0, 120, 96, 120] })
    for (const trio of [
      [hollis, ferro, lumen],
      [noord, kade, tij],
    ]) {
      const row = b.row(grid, "Row", { w: FILL, gap: 30, align: "start" })
      for (const pr of trio) caseUse(row, pr, 360, { w: 380 })
    }

    const index = section(scr, "Index", { pad: [0, 120, 96, 120], gap: s(8) })
    header(index, "(02) Index", "Every project")
    const list = b.col(index, "List", {
      w: FILL,
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    const rows: [string, string, string, string][] = [
      ...projects.map(
        (pr) => [pr.title, pr.client, pr.discipline, pr.year] as [string, string, string, string],
      ),
      ...more.map((m) => [...m] as [string, string, string, string]),
    ]
    for (const [i, [project, client, discipline, year]] of rows.entries())
      b.use(list, workRow, {
        props: { w: FILL },
        args: {
          number: String(i + 1).padStart(2, "0"),
          project,
          client,
          discipline,
          year,
          ...(i === 1 ? { state: "hover" } : {}),
        },
      })
    b.use(scr, footer)
  }

  // Case study
  {
    const scr = page("Case study", "work")
    const top = b.col(scr, "Header", { w: FILL, gap: s(8), pad: [56, 120, 56, 120] })
    const back = b.row(top, "Back", { gap: 6, align: "center" })
    b.icon(back, "arrow-left", 16, muted)
    b.text(back, "All work", b.ty("label", { weight: 500 }), muted)
    const title = b.row(top, "Title", { w: FILL, justify: "between", align: "end", gap: s(12) })
    const tl = b.col(title, "Text", { w: 820, gap: s(6) })
    b.text(tl, "Hollis Coffee", b.ty("hero"), ink)
    b.para(
      tl,
      "A new identity and packaging system for a Rotterdam roaster with four cafés and a subscription shop.",
      b.ty("body-lg", { size: 22 }),
      muted,
    )
    const tags = b.row(title, "Tags", { gap: 8 })
    for (const label of ["Identity", "Packaging", "Signage"]) b.use(tags, tag, { args: { label } })
    const meta = b.row(top, "Meta", {
      w: FILL,
      gap: s(8),
      pad: [24, 0, 0, 0],
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    for (const [k, v] of [
      ["Client", "Hollis Coffee Roasters"],
      ["Year", "2026, 14 weeks"],
      ["Services", "Identity, packaging, signage"],
      ["Team", "Noor van Dijk, Lieke Bos, Ruben Smit"],
    ] as const) {
      const cell = b.col(meta, k, { w: 276, gap: 6 })
      b.text(cell, k, eyebrowStyle, muted)
      b.para(cell, v, b.ty("body", { weight: 500 }), ink)
    }

    const big = b.col(scr, "Lead image", { w: FILL, pad: [0, 120] })
    art(big, hollis, 720, { scale: "lg" })

    const brief = b.row(scr, "Brief", { w: FILL, gap: s(12), pad: [96, 120, 64, 120] })
    b.text(brief, "(01) The brief", eyebrowStyle, c("accent"), { w: 280, grow: "fixed-width" })
    const bt = b.col(brief, "Text", { w: FILL, gap: s(6) })
    b.para(
      bt,
      "Hollis had outgrown a logo drawn for one café in 2014. Four shops, a wholesale list and a subscription service later, every bag, cup and menu looked a little different.",
      b.ty("heading", { size: 30, weight: 500, lineHeight: 1.3 }),
      ink,
    )
    b.para(
      bt,
      "We spent two weeks in the cafés and the roastery before drawing anything. The new identity keeps the round mark regulars knew and adds a label system that tells you origin, roast and brew method at arm's length. Eleven bag designs now come out of one template.",
      b.ty("body-lg"),
      muted,
    )

    const pair = b.row(scr, "Images", { w: FILL, gap: s(8), pad: [0, 120] })
    art(pair, hollis, 520, { motif: "phone", w: 584 })
    art(pair, hollis, 520, { motif: "arches", tone: "sand", w: 584 })

    const results = b.row(scr, "Results", { w: FILL, gap: 33, pad: [96, 120] })
    for (const [value, label, tone] of [
      ["+38%", "Online subscriptions in the six months after launch", "accent"],
      ["11", "Bag designs from one label template", "default"],
      ["4", "Cafés re-signed in one weekend each", "default"],
    ] as const)
      b.use(results, stat, { props: { w: 378 }, args: { value, label, tone } })

    const voice = b.col(scr, "Testimonial", {
      w: FILL,
      pad: [96, 120],
      align: "center",
      fill: c("inverse"),
    })
    b.use(voice, quote, { args: { ...hollisQuote, tone: "inverse" } })

    const process = b.row(scr, "Process", { w: FILL, gap: s(12), pad: [96, 120, 64, 120] })
    b.text(process, "(02) The system", eyebrowStyle, c("accent"), { w: 280, grow: "fixed-width" })
    b.para(
      process,
      "Labels print on a single press sheet in two colours. Each origin gets a tint from the clay palette, and the brew guide on the back is set in one size so it reads on a shelf and in the hand.",
      b.ty("body-lg"),
      muted,
    )
    const shot = b.col(scr, "Web shop", { w: FILL, pad: [0, 120, 96, 120] })
    art(shot, hollis, 640, { motif: "browser", scale: "lg" })

    const next = b.row(scr, "Next project", {
      w: FILL,
      gap: s(12),
      align: "center",
      pad: [80, 120],
      fill: c("surface"),
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    const nt = b.col(next, "Text", { w: FILL, gap: s(4) })
    b.text(nt, "Next project", eyebrowStyle, muted)
    b.text(nt, "Ferro Bikes", b.ty("h1"), ink)
    b.para(nt, ferro.summary, b.ty("body-lg"), muted)
    b.use(nt, buttonSecondary, { args: { label: "Read the case", icon: true } })
    art(next, ferro, 320, { w: 560 })
    b.use(scr, footer)
  }

  // About
  {
    const scr = page("About", "studio")
    const top = b.col(scr, "Header", { w: FILL, gap: s(10), pad: [80, 120, 64, 120] })
    b.text(top, "Studio", eyebrowStyle, c("accent"))
    b.para(top, "Nine people, one room on the Schiedamse Vest.", b.ty("hero"), ink, { w: 1000 })
    const intro = b.row(top, "Intro", { w: FILL, gap: s(12) })
    b.para(
      intro,
      "Noor van Dijk started Oriel in 2017 after eight years at agencies in Amsterdam and London. She wanted a studio small enough that the people who pitch the work also make it.",
      b.ty("body-lg"),
      muted,
    )
    b.para(
      intro,
      "We take on about eight projects a year. Each one gets a lead designer from start to finish, and clients talk to the people doing the work, not to an account manager.",
      b.ty("body-lg"),
      muted,
    )
    const pic = b.col(scr, "Studio image", { w: FILL, pad: [0, 120] })
    art(pic, noord, 560, { scale: "lg" })

    const nums = b.row(scr, "Numbers", { w: FILL, gap: s(8), pad: [80, 120] })
    for (const [value, label] of [
      ["2017", "Founded in Rotterdam"],
      ["9", "Designers, developers and a strategist"],
      ["8", "Projects a year, on average"],
      ["70%", "Of our work comes from returning clients"],
    ] as const)
      b.use(nums, stat, { props: { w: 276 }, args: { value, label } })

    const people = section(scr, "Team", { fill: c("surface") })
    header(people, "(01) People", "Who you will work with")
    const grid = b.col(people, "Grid", { w: FILL, gap: s(12) })
    for (let i = 0; i < 2; i++) {
      const row = b.row(grid, `Row ${i + 1}`, { w: FILL, gap: 30, align: "start" })
      for (const [name, role, initials, tone] of team.slice(i * 3, i * 3 + 3))
        b.use(row, teamCard, { props: { w: 380 }, args: { name, role, initials, tone } })
    }

    const svc = section(scr, "Services")
    header(svc, "(02) Services", "What we do")
    serviceRow(svc)
    const proof = b.col(svc, "Clients", { w: FILL, gap: s(8), pad: [48, 0, 0, 0] })
    b.text(proof, "Clients since 2017 include", b.ty("label", { weight: 500 }), muted)
    clientRow(proof)
    b.use(scr, footer)
  }

  // Contact
  {
    const scr = page("Contact", "contact")
    const body = b.row(scr, "Body", { w: FILL, gap: s(24), pad: [80, 120, 120, 120] })
    const left = b.col(body, "Info", { w: FILL, gap: s(10) })
    b.text(left, "Contact", eyebrowStyle, c("accent"))
    b.para(left, "Tell us about the project.", b.ty("hero"), ink)
    b.para(
      left,
      "A few lines are enough to start. We read every enquiry ourselves and reply within two working days, usually with a time for a call.",
      b.ty("body-lg"),
      muted,
    )
    availability(left)
    const items = b.col(left, "Details", {
      w: FILL,
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    for (const [label, value, icon] of [
      ["Email", "hello@oriel.studio", "mail"],
      ["Phone", "+31 10 412 77 90", "phone"],
      ["Studio", "Schiedamse Vest 82, 3011 BE Rotterdam", "map-pin"],
      ["Hours", "Monday to Friday, 9:00 to 17:30", "clock"],
    ] as const)
      b.use(items, infoItem, {
        props: { w: FILL },
        args: { label, value },
        set: { IfIcon: { icon } },
      })

    const form = b.col(body, "Form", {
      w: 600,
      gap: s(6),
      pad: s(10),
      radius: r("xl"),
      fill: c("surface"),
      stroke: { paint: c("border") },
      effects: b.shadow("card"),
    })
    b.text(form, "Project enquiry", b.ty("title", { size: 26 }), ink)
    const names = b.row(form, "Names", { w: FILL, gap: s(4) })
    b.use(names, input, { props: { w: 252 }, args: { label: "Name", placeholder: "Marieke Vos" } })
    b.use(names, input, {
      props: { w: 252 },
      args: { label: "Company", placeholder: "Hollis Coffee" },
    })
    b.use(form, input, {
      props: { w: FILL },
      args: { label: "Email", placeholder: "marieke@hollis.coffee" },
    })
    const chips = (label: string, options: string[], selected: number) => {
      const g = b.col(form, label, { w: FILL, gap: s(2) })
      b.text(g, label, b.ty("label"), ink)
      const row = b.row(g, "Options", { w: FILL, gap: 8, wrap: true, crossGap: 8 })
      for (const [i, o] of options.entries())
        b.use(row, tag, { args: { label: o, ...(i === selected ? { tone: "solid" } : {}) } })
    }
    chips("What do you need?", ["Identity", "Website", "App", "Packaging", "Not sure yet"], 0)
    chips("Budget", ["Under €25k", "€25k to €50k", "€50k to €100k", "Over €100k"], 1)
    b.use(form, input, {
      props: { w: FILL },
      args: {
        label: "About the project",
        placeholder: "What you make, who it is for, and when you would like to launch.",
        lines: "multi",
      },
    })
    const send = b.row(form, "Send", { w: FILL, gap: s(4), align: "center" })
    b.use(send, button, { args: { label: "Send enquiry", size: "lg", variant: "accent" } })
    b.para(send, "We reply within two working days.", b.ty("small"), muted)
    b.use(scr, footer)
  }

  // --- Mobile --------------------------------------------------------------------------------------

  const mobile = b.page("Mobile")
  function mobileScreen(name: string) {
    const scr = b.screen(mobile, name, { w: 390, h: 844, fill: c("bg"), clip: true })
    b.use(scr, mobileHeader, { props: { w: FILL } })
    return scr
  }

  // Mobile home
  {
    const scr = mobileScreen("Mobile home")
    const hero = b.col(scr, "Hero", { w: FILL, gap: s(5), pad: [20, 20, 28, 20] })
    b.text(hero, "Design studio, Rotterdam", eyebrowStyle, c("accent"))
    b.para(
      hero,
      "Brands, websites and apps for independent businesses.",
      b.ty("h1", { size: 42, letterSpacing: -1.6 }),
      ink,
    )
    b.para(
      hero,
      "Nine people on the Schiedamse Vest, working with roasters, clinics, museums and bike makers since 2017.",
      b.ty("body"),
      muted,
    )
    const acts = b.row(hero, "Actions", { gap: s(2), align: "center" })
    b.use(acts, button, { args: { label: "See the work" } })
    b.use(acts, buttonSecondary, { args: { label: "Start a project" } })
    const list = b.col(scr, "Work", { w: FILL, gap: s(6), pad: [0, 20] })
    caseUse(list, hollis, 200, { tags: false })
    caseUse(list, ferro, 200, { tags: false })
  }

  // Mobile case study
  {
    const scr = mobileScreen("Mobile case study")
    const top = b.col(scr, "Header", { w: FILL, gap: s(4), pad: [16, 20, 24, 20] })
    const back = b.row(top, "Back", { gap: 6, align: "center" })
    b.icon(back, "arrow-left", 16, muted)
    b.text(back, "All work", b.ty("label", { weight: 500 }), muted)
    b.text(top, "Hollis Coffee", b.ty("h1", { size: 44, letterSpacing: -1.6 }), ink)
    b.para(
      top,
      "A new identity and packaging system for a Rotterdam roaster with four cafés and a subscription shop.",
      b.ty("body-lg", { size: 17 }),
      muted,
    )
    const tags = b.row(top, "Tags", { gap: 8 })
    for (const label of ["Identity", "Packaging", "Signage"]) b.use(tags, tag, { args: { label } })
    const lead = b.col(scr, "Lead image", { w: FILL, pad: [0, 20] })
    art(lead, hollis, 220)
    const meta = b.col(scr, "Meta", { w: FILL, gap: s(4), pad: [24, 20, 16, 20] })
    for (const pair of [
      [
        ["Client", "Hollis Coffee Roasters"],
        ["Year", "2026, 14 weeks"],
      ],
    ] as const) {
      const row = b.row(meta, "Row", {
        w: FILL,
        gap: s(4),
        pad: [16, 0, 0, 0],
        stroke: { paint: c("border"), width: { t: 1 } },
      })
      for (const [k, v] of pair) {
        const cell = b.col(row, k, { w: 167, gap: 4 })
        b.text(cell, k, eyebrowStyle, muted)
        b.para(cell, v, b.ty("body", { size: 15, weight: 500 }), ink)
      }
    }
    const brief = b.col(scr, "Brief", { w: FILL, gap: s(3), pad: [8, 20, 24, 20] })
    b.text(brief, "(01) The brief", eyebrowStyle, c("accent"))
    b.para(
      brief,
      "Hollis had outgrown a logo drawn for one café in 2014. Four shops and a subscription service later, every bag, cup and menu looked a little different.",
      b.ty("title", { size: 20, weight: 500, lineHeight: 1.4 }),
      ink,
    )
    const pair = b.col(scr, "Images", { w: FILL, pad: [0, 20] })
    art(pair, hollis, 300, { motif: "phone" })
  }
}
