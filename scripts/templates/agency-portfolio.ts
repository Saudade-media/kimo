/**
 * Oriel: the portfolio site of a fictional nine-person brand and digital design studio in
 * Rotterdam. Desktop (1440 wide): Home, Work, Case study, About, Contact. Mobile (390×844):
 * Home, Case study.
 *
 * Direction: editorial and typographic. A 12-column grid (40 px margins, 20 px gutters,
 * 95 px columns), one display weight set very large and tight, hairline rules instead of cards,
 * mono labels, and flat colour "posters" with a giant cropped word or one geometric motif where
 * project photography would go. One signal colour (vermilion) is used for fields, not for
 * decoration. References are listed in the template's refs.md (scratchpad).
 */
import { FILL, fill, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "agency-portfolio",
  name: "Oriel studio portfolio",
  category: "Portfolio",
  description:
    "Editorial portfolio site for a small design studio: home, work index, case study, about and contact on desktop, with mobile home and case study.",
  prefix: "ap",
  build,
}

type Tone = "verm" | "cobalt" | "moss" | "butter" | "lilac" | "bone"
type Motif = "type" | "orb" | "arches" | "phone" | "tiles"
type Scale = "sm" | "md" | "lg"

const COL = 95
const GUT = 20
/** Width of n grid columns (and the gutters between them). */
const cols = (n: number) => n * COL + (n - 1) * GUT

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F1EFE9", "#0F0F0E"],
      surface: ["#F8F6F1", "#171715"],
      subtle: ["#E6E3DA", "#1F1F1C"],
      ink: ["#111110", "#F1EFE9"],
      muted: ["#6B6962", "#9B988E"],
      border: ["#C9C5B9", "#34332F"],
      accent: ["#FF4B14", "#FF5C2B"],
      "on-accent": ["#111110", "#111110"],
      live: ["#1FA45B", "#3BD17F"],
      inverse: ["#111110", "#1A1A18"],
      "on-inverse": ["#F1EFE9", "#F1EFE9"],
      "inverse-muted": ["#9B988E", "#9B988E"],
      "inverse-border": ["#3A3935", "#3A3935"],
      "t-verm": ["#FF4B14", "#EB440F"],
      "t-verm-fg": ["#111110", "#111110"],
      "t-cobalt": ["#2438F2", "#2B3FFF"],
      "t-cobalt-fg": ["#F1EFE9", "#F1EFE9"],
      "t-moss": ["#1E3A2E", "#1E3A2E"],
      "t-moss-fg": ["#D8F25C", "#D8F25C"],
      "t-butter": ["#F2D24B", "#E8C53A"],
      "t-butter-fg": ["#111110", "#111110"],
      "t-lilac": ["#C8B6F5", "#B6A2EE"],
      "t-lilac-fg": ["#2A1B72", "#2A1B72"],
      "t-bone": ["#DDD8C9", "#2B2A26"],
      "t-bone-fg": ["#111110", "#F1EFE9"],
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
      "radius/sm": 2,
      "radius/md": 6,
      "radius/pill": 999,
    },
    type: {
      hero: { font: "Inter", size: 104, weight: 600, lineHeight: 0.98, letterSpacing: -5 },
      display: { font: "Inter", size: 96, weight: 600, lineHeight: 0.9, letterSpacing: -5 },
      h1: { font: "Inter", size: 72, weight: 600, lineHeight: 1, letterSpacing: -3.2 },
      heading: { font: "Inter", size: 40, weight: 600, lineHeight: 1.08, letterSpacing: -1.6 },
      lead: { font: "Inter", size: 28, weight: 500, lineHeight: 1.18, letterSpacing: -1 },
      title: { font: "Inter", size: 22, weight: 600, lineHeight: 1.25, letterSpacing: -0.5 },
      body: { font: "Inter", size: 16, weight: 400, lineHeight: 1.45, letterSpacing: -0.1 },
      label: { font: "Inter", size: 14, weight: 500, lineHeight: 1.3, letterSpacing: -0.1 },
      small: { font: "Inter", size: 13, weight: 400, lineHeight: 1.4 },
      mono: { font: "JetBrains Mono", size: 11, weight: 500, lineHeight: 1.4, letterSpacing: 0.6 },
    },
    shadows: {
      device: { kind: "shadow", x: 0, y: 20, blur: 40, spread: -12, color: "#00000040" },
    },
  })

  const c = (n: string) => b.c(n)
  const s = (n: number) => b.n(`space/${n}`)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  const monoStyle = b.ty("mono", { case: "upper" })
  const rule = { paint: ink, width: { t: 1 } }
  const hair = { paint: c("border"), width: { t: 1 } }

  // --- Actions ---------------------------------------------------------------------------------------

  const button = b.component(
    "Button",
    {
      key: "Btn",
      section: "Actions",
      description: "Pill button: ink, accent or outline; md or lg. Arrow optional.",
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
          outline: {
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
          lg: { "root.layout/pad": [16, 28], "BtnLabel.style/size": 17 },
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
  const buttonOutline = b.derive(button, "Button/Outline", "BtnOut", {
    section: "Actions",
    args: { variant: "outline" },
  })

  const chip = b.component(
    "Filter chip",
    {
      key: "Chip",
      section: "Actions",
      description: "Filter toggle with a count. Solid marks the active filter.",
      props: {
        label: p.text("ChipLbl", "Identity"),
        count: p.text("ChipN", "9"),
        state: p.variants({
          off: {
            "root.fill": c("bg"),
            "root.stroke": { paint: c("border") },
            "ChipLbl.fill": ink,
            "ChipN.fill": muted,
          },
          on: {
            "root.fill": ink,
            "root.stroke": { paint: ink },
            "ChipLbl.fill": c("bg"),
            "ChipN.fill": c("bg"),
          },
        }),
      },
      root: {
        dir: "row",
        gap: 6,
        align: "center",
        pad: [7, 14],
        radius: r("pill"),
        fill: c("bg"),
        stroke: { paint: c("border") },
      },
    },
    (root) => {
      b.text(root, "Identity", b.ty("label"), ink, { key: "ChipLbl", name: "Label" })
      b.text(root, "9", b.ty("mono"), muted, { key: "ChipN", name: "Count" })
    },
  )

  const textLink = b.component(
    "Text link",
    {
      key: "Link",
      section: "Actions",
      description: "Inline link with an arrow. Underlined, no box.",
      props: {
        label: p.text("LinkLbl", "All work"),
        tone: p.variants({
          default: { "LinkLbl.fill": ink, "LinkIcon.color": ink },
          inverse: { "LinkLbl.fill": c("on-inverse"), "LinkIcon.color": c("on-inverse") },
        }),
      },
      root: { dir: "row", gap: 6, align: "center" },
    },
    (root) => {
      b.text(root, "All work", b.ty("label", { decoration: ["underline"] }), ink, {
        key: "LinkLbl",
        name: "Label",
      })
      b.icon(root, "arrow-up-right", 14, ink, { key: "LinkIcon" })
    },
  )

  // --- Navigation ------------------------------------------------------------------------------------

  function wordmark(parent: string, fill = ink, key?: string, size = 22, dotKey?: string) {
    const row = b.row(parent, "Wordmark", { gap: 4, align: "end", ...(key ? { key } : {}) })
    b.text(row, "Oriel", b.ty("title", { size, weight: 700, letterSpacing: -size * 0.05 }), fill, {
      name: "Name",
      ...(dotKey ? { key: "NavWord" } : {}),
    })
    b.ellipse(row, "Dot", {
      w: size * 0.36,
      h: size * 0.36,
      fill: c("accent"),
      ...(dotKey ? { key: dotKey } : {}),
    })
    return row
  }

  const navLinks = ["Work", "Studio", "Contact"] as const
  const navActive = (i: number) =>
    Object.fromEntries(
      navLinks.map((_, j) => [`NavL${j + 1}.style/decoration`, j === i ? ["underline"] : []]),
    )
  const navTone = (onAccent: boolean) => ({
    "root.fill": onAccent ? c("accent") : c("bg"),
    ...Object.fromEntries(
      [...navLinks.map((_, j) => `NavL${j + 1}`), "NavAvail", "NavCta", "NavWord"].map((k) => [
        `${k}.fill`,
        onAccent ? c("on-accent") : ink,
      ]),
    ),
    "NavIcon.color": onAccent ? c("on-accent") : ink,
    "NavDot.fill": onAccent ? c("on-accent") : c("accent"),
  })
  const navBar = b.component(
    "Nav bar",
    {
      key: "NavBar",
      section: "Navigation",
      description: "Desktop header on the 12-column grid. Active underlines the current page.",
      props: {
        active: p.variants({
          home: navActive(-1),
          work: navActive(0),
          studio: navActive(1),
          contact: navActive(2),
        }),
        tone: p.variants({ page: navTone(false), accent: navTone(true) }),
      },
      root: {
        dir: "row",
        w: 1440,
        justify: "between",
        align: "center",
        pad: [24, 40],
        fill: c("bg"),
      },
    },
    (root) => {
      const left = b.row(root, "Left", { w: cols(5) + GUT, align: "center" })
      wordmark(left, ink, undefined, 22, "NavDot")
      const mid = b.row(root, "Links", { w: cols(4) + GUT, gap: 28, align: "center" })
      for (const [i, l] of navLinks.entries())
        b.text(mid, l, b.ty("label"), ink, { key: `NavL${i + 1}` })
      const right = b.row(root, "Right", { w: FILL, gap: 24, align: "center", justify: "end" })
      const live = b.row(right, "Availability", { gap: 8, align: "center" })
      b.ellipse(live, "Status", { w: 7, h: 7, fill: c("live") })
      b.text(live, "Booking from January 2027", b.ty("label"), ink, { key: "NavAvail" })
      const cta = b.row(right, "Start", { gap: 4, align: "center" })
      b.text(cta, "Start a project", b.ty("label"), ink, { key: "NavCta" })
      b.icon(cta, "arrow-up-right", 14, ink, { key: "NavIcon" })
    },
  )

  const mobileHeader = b.component(
    "Mobile header",
    {
      key: "MobHead",
      section: "Navigation",
      description: "Mobile header: wordmark and a text menu button.",
      root: {
        dir: "row",
        w: 390,
        justify: "between",
        align: "center",
        pad: [18, 20],
        fill: c("bg"),
      },
    },
    (root) => {
      wordmark(root, ink, undefined, 20)
      const menu = b.row(root, "Menu", { gap: 6, align: "center" })
      b.text(menu, "Menu", b.ty("label"), ink)
      b.icon(menu, "plus", 14, ink)
    },
  )

  const footer = b.component(
    "Footer",
    {
      key: "Footer",
      section: "Navigation",
      description: "Closing band: the email set huge, then the studio details on the grid.",
      root: {
        dir: "column",
        w: 1440,
        gap: s(16),
        pad: [64, 40, 32, 40],
        fill: c("inverse"),
      },
    },
    (root) => {
      const top = b.row(root, "Pitch", { w: FILL, gap: GUT, align: "start" })
      b.text(top, "(Say hello)", monoStyle, c("inverse-muted"), { w: cols(4) + GUT })
      const mail = b.col(top, "Email", { w: FILL, gap: s(5) })
      b.text(mail, "Have a project for 2027?", b.ty("lead", { size: 32 }), c("inverse-muted"))
      b.text(
        mail,
        "hello@oriel.studio",
        b.ty("display", { size: 132, letterSpacing: -7 }),
        c("accent"),
        {
          name: "Email",
        },
      )
      const grid = b.row(root, "Columns", {
        w: FILL,
        gap: GUT,
        pad: [24, 0, 0, 0],
        stroke: { paint: c("inverse-border"), width: { t: 1 } },
      })
      const col = (title: string, lines: string[], w: number) => {
        const cc = b.col(grid, title, { w, gap: 6 })
        b.text(cc, title, monoStyle, c("inverse-muted"), { name: "Heading" })
        for (const l of lines) b.text(cc, l, b.ty("body"), c("on-inverse"))
      }
      col("Studio", ["Schiedamse Vest 82", "3011 BE Rotterdam", "The Netherlands"], cols(3))
      col(
        "Contact",
        ["hello@oriel.studio", "+31 10 412 77 90", "Mon to Fri, 9:00 to 17:30"],
        cols(3),
      )
      col("Elsewhere", ["Instagram", "LinkedIn", "Are.na"], cols(2))
      const news = b.col(grid, "Field notes", { w: FILL, gap: 6 })
      b.text(news, "Field notes", monoStyle, c("inverse-muted"), { name: "Heading" })
      b.para(
        news,
        "Four letters a year about what we made and what we learned making it.",
        b.ty("body"),
        c("on-inverse"),
      )
      const bottom = b.row(root, "Legal", { w: FILL, justify: "between", align: "center" })
      b.text(bottom, "Oriel Studio B.V.  KvK 71840326  2027", b.ty("small"), c("inverse-muted"))
      b.text(bottom, "Privacy  Imprint", b.ty("small"), c("inverse-muted"))
    },
  )

  // --- Posters ---------------------------------------------------------------------------------------

  const TONES: Tone[] = ["verm", "cobalt", "moss", "butter", "lilac", "bone"]
  const toneVars = (t: Tone) => {
    const bg = c(`t-${t}`)
    const fg = c(`t-${t}-fg`)
    const o: Record<string, unknown> = {
      "root.fill": bg,
      "PWord.fill": fg,
      "PLabel.fill": fg,
      "PIdx.fill": fg,
      "POrbA.fill": fg,
      "POrbB.fill": fg,
      "PPhone.fill": fg,
      "PScreen.fill": bg,
      "PUiA.fill": fg,
      "PUiB.fill": fg,
      "PUiC.fill": fg,
    }
    for (let i = 1; i <= 4; i++) o[`PArch${i}.fill`] = fg
    for (let i = 1; i <= 6; i++) o[`PTile${i}.fill`] = fg
    return o
  }
  const motifVars = (m: Motif) => ({
    "PType.visible": m === "type",
    "POrb.visible": m === "orb",
    "PArches.visible": m === "arches",
    "PPhoneBox.visible": m === "phone",
    "PTiles.visible": m === "tiles",
  })
  const SCALE: Record<
    Scale,
    { word: number; orb: number; arch: number; phone: [number, number]; tile: number; pad: number }
  > = {
    sm: { word: 96, orb: 220, arch: 64, phone: [150, 260], tile: 64, pad: 16 },
    md: { word: 200, orb: 300, arch: 110, phone: [230, 460], tile: 120, pad: 20 },
    lg: { word: 400, orb: 900, arch: 190, phone: [320, 700], tile: 200, pad: 28 },
  }
  const scaleVars = (sc: Scale) => {
    const k = SCALE[sc]
    const o: Record<string, unknown> = {
      "PWord.style/size": k.word,
      "PWord.style/letterSpacing": -k.word * 0.045,
      "root.layout/pad": [k.pad, k.pad, 0, k.pad],
      "POrbA.w": k.orb,
      "POrbA.h": k.orb,
      "POrbB.w": k.orb * 0.25,
      "POrbB.h": k.orb * 0.25,
      "PPhone.w": k.phone[0],
      "PPhone.h": k.phone[1],
      "PPhone.radius": k.phone[0] * 0.16,
      "PScreen.radius": k.phone[0] * 0.12,
    }
    const heights = [1.2, 2.1, 1.6, 2.6]
    for (let i = 1; i <= 4; i++) {
      o[`PArch${i}.w`] = k.arch
      o[`PArch${i}.h`] = k.arch * (heights[i - 1] as number)
      o[`PArch${i}.radius`] = [k.arch / 2, k.arch / 2, 0, 0]
    }
    o["PArches.layout/gap"] = k.arch * 0.18
    for (let i = 1; i <= 6; i++) {
      o[`PTile${i}.w`] = k.tile
      o[`PTile${i}.h`] = k.tile
    }
    o["PTileRow1.layout/gap"] = k.tile * 0.14
    o["PTileRow2.layout/gap"] = k.tile * 0.14
    o["PTiles.layout/gap"] = k.tile * 0.14
    return o
  }
  const poster = b.component(
    "Poster",
    {
      key: "Poster",
      section: "Work",
      description:
        "Stands in for project photography: a flat colour field with a mono caption and one motif (cropped word, orb, arches, phone or tiles).",
      props: {
        word: p.text("PWord", "Hollis"),
        label: p.text("PLabel", "Hollis Coffee"),
        index: p.text("PIdx", "01"),
        tone: p.variants(Object.fromEntries(TONES.map((t) => [t, toneVars(t)]))),
        motif: p.variants({
          type: motifVars("type"),
          orb: motifVars("orb"),
          arches: motifVars("arches"),
          phone: motifVars("phone"),
          tiles: motifVars("tiles"),
        }),
        scale: p.variants({ sm: scaleVars("sm"), md: scaleVars("md"), lg: scaleVars("lg") }),
      },
      root: {
        dir: "column",
        w: 670,
        h: 520,
        pad: [20, 20, 0, 20],
        gap: 0,
        radius: r("sm"),
        clip: true,
        fill: c("t-verm"),
      },
    },
    (root) => {
      const head = b.row(root, "Caption", { w: FILL, justify: "between", align: "center" })
      b.text(head, "Hollis Coffee", monoStyle, c("t-verm-fg"), { key: "PLabel" })
      b.text(head, "01", monoStyle, c("t-verm-fg"), { key: "PIdx" })
      const stage = b.frame(root, "Stage", {
        w: FILL,
        h: FILL,
        clip: true,
        layout: { dir: "column", align: "stretch" },
      })

      const type = b.row(stage, "Word", { key: "PType", w: FILL, h: FILL, align: "end" })
      b.text(
        type,
        "Hollis",
        b.ty("display", { size: 200, lineHeight: 0.66, letterSpacing: -9 }),
        c("t-verm-fg"),
        { key: "PWord", name: "Word" },
      )

      const orb = b.row(stage, "Orb", {
        key: "POrb",
        visible: false,
        w: FILL,
        h: FILL,
        gap: 24,
        align: "center",
        justify: "center",
      })
      b.ellipse(orb, "Sun", { key: "POrbA", w: 520, h: 520, fill: c("t-verm-fg") })
      b.ellipse(orb, "Moon", { key: "POrbB", w: 156, h: 156, fill: c("t-verm-fg") })

      const arches = b.row(stage, "Arches", {
        key: "PArches",
        visible: false,
        w: FILL,
        h: FILL,
        gap: 20,
        align: "end",
        justify: "center",
      })
      for (let i = 1; i <= 4; i++)
        b.rect(arches, "Arch", { key: `PArch${i}`, w: 110, h: 200, fill: c("t-verm-fg") })

      const phoneBox = b.row(stage, "Phone", {
        key: "PPhoneBox",
        visible: false,
        w: FILL,
        h: FILL,
        align: "end",
        justify: "center",
      })
      const phone = b.col(phoneBox, "Device", {
        key: "PPhone",
        w: 230,
        h: 460,
        pad: [10, 10, 0, 10],
        radius: 36,
        fill: c("t-verm-fg"),
        effects: b.shadow("device"),
      })
      const screen = b.col(phone, "Screen", {
        key: "PScreen",
        w: FILL,
        h: FILL,
        gap: 10,
        pad: 14,
        radius: 28,
        fill: c("t-verm"),
      })
      b.rect(screen, "Title", { key: "PUiA", w: 90, h: 10, radius: 5, fill: c("t-verm-fg") })
      b.rect(screen, "Hero", { key: "PUiB", w: FILL, h: 160, radius: 14, fill: c("t-verm-fg") })
      b.rect(screen, "Line", { key: "PUiC", w: 150, h: 8, radius: 4, fill: c("t-verm-fg") })

      const tiles = b.col(stage, "Tiles", {
        key: "PTiles",
        visible: false,
        w: FILL,
        h: FILL,
        gap: 17,
        align: "center",
        justify: "center",
      })
      const row1 = b.row(tiles, "Row", { key: "PTileRow1", gap: 17 })
      b.ellipse(row1, "Circle", { key: "PTile1", w: 120, h: 120, fill: c("t-verm-fg") })
      b.rect(row1, "Square", { key: "PTile2", w: 120, h: 120, fill: c("t-verm-fg") })
      b.rect(row1, "Quarter", {
        key: "PTile3",
        w: 120,
        h: 120,
        radius: [120, 0, 0, 0],
        fill: c("t-verm-fg"),
      })
      const row2 = b.row(tiles, "Row", { key: "PTileRow2", gap: 17 })
      b.rect(row2, "Quarter", {
        key: "PTile4",
        w: 120,
        h: 120,
        radius: [0, 0, 120, 0],
        fill: c("t-verm-fg"),
      })
      b.ellipse(row2, "Circle", { key: "PTile5", w: 120, h: 120, fill: c("t-verm-fg") })
      b.rect(row2, "Square", { key: "PTile6", w: 120, h: 120, fill: c("t-verm-fg") })
    },
  )

  interface Project {
    name: string
    word: string
    cat: string
    place: string
    year: string
    tone: Tone
    motif: Motif
  }
  const P: Record<string, Project> = {
    hollis: {
      name: "Hollis Coffee",
      word: "Hollis",
      cat: "Identity, packaging",
      place: "Rotterdam",
      year: "2026",
      tone: "verm",
      motif: "type",
    },
    ferro: {
      name: "Ferro Bikes",
      word: "Ferro",
      cat: "Website, e-commerce",
      place: "Utrecht",
      year: "2026",
      tone: "cobalt",
      motif: "phone",
    },
    lumen: {
      name: "Lumen Health",
      word: "Lumen",
      cat: "App, service design",
      place: "Amsterdam",
      year: "2025",
      tone: "lilac",
      motif: "orb",
    },
    noord: {
      name: "Museum Noord",
      word: "Noord",
      cat: "Identity, wayfinding",
      place: "Groningen",
      year: "2025",
      tone: "butter",
      motif: "arches",
    },
    kade: {
      name: "Kade Wonen",
      word: "Kade",
      cat: "Web app, research",
      place: "Rotterdam",
      year: "2025",
      tone: "moss",
      motif: "type",
    },
    tessel: {
      name: "Tessel Tea",
      word: "Tessel",
      cat: "Packaging, print",
      place: "Haarlem",
      year: "2024",
      tone: "bone",
      motif: "tiles",
    },
    brandt: {
      name: "Brandt & Co",
      word: "Brandt",
      cat: "Annual report",
      place: "Antwerp",
      year: "2024",
      tone: "verm",
      motif: "arches",
    },
    vlieg: {
      name: "Vlieg Festival",
      word: "Vlieg",
      cat: "Identity, motion",
      place: "Eindhoven",
      year: "2024",
      tone: "cobalt",
      motif: "orb",
    },
    atlas: {
      name: "Atlas Mutual",
      word: "Atlas",
      cat: "Website",
      place: "The Hague",
      year: "2023",
      tone: "butter",
      motif: "tiles",
    },
    radio: {
      name: "Noord Radio",
      word: "Noord",
      cat: "App, brand",
      place: "Groningen",
      year: "2023",
      tone: "moss",
      motif: "phone",
    },
  }
  const keys = Object.keys(P)
  const no = (k: string) => String(keys.indexOf(k) + 1).padStart(2, "0")

  /** A poster instance. `h` is the instance height. */
  function art(
    parent: string,
    k: string,
    scale: Scale,
    h: number,
    over: {
      w?: number | typeof FILL
      motif?: Motif
      tone?: Tone
      label?: string
      index?: string
      word?: string
    } = {},
  ) {
    const x = P[k] as Project
    return b.use(parent, poster, {
      props: { w: over.w ?? FILL, h },
      args: {
        word: over.word ?? x.word,
        label: over.label ?? x.name,
        index: over.index ?? no(k),
        tone: over.tone ?? x.tone,
        motif: over.motif ?? x.motif,
        scale,
      },
    })
  }

  // --- Work ------------------------------------------------------------------------------------------

  const projectCard = b.component(
    "Project card",
    {
      key: "Case",
      section: "Work",
      description: "Poster with a caption underneath. Set the poster through CcArt.",
      props: {
        title: p.text("CcTitle", "Hollis Coffee"),
        category: p.text("CcCat", "Identity, packaging"),
        year: p.text("CcYear", "2026"),
      },
      root: { dir: "column", w: 670, gap: s(3) },
    },
    (root) => {
      b.use(root, poster, { key: "CcArt", props: { w: FILL } })
      const meta = b.row(root, "Caption", { w: FILL, gap: GUT, align: "start", justify: "between" })
      const names = b.col(meta, "Names", { gap: 2 })
      b.text(names, "Hollis Coffee", b.ty("title"), ink, { key: "CcTitle", name: "Title" })
      b.text(names, "Identity, packaging", b.ty("label", { weight: 400 }), muted, {
        key: "CcCat",
        name: "Category",
      })
      b.text(meta, "2026", b.ty("mono"), muted, { key: "CcYear", name: "Year" })
    },
  )
  function card(
    parent: string,
    k: string,
    w: number,
    h: number,
    scale: Scale,
    extra: Record<string, unknown> = {},
  ) {
    const x = P[k] as Project
    return b.use(parent, projectCard, {
      props: { w },
      args: { title: x.name, category: x.cat, year: x.year },
      set: {
        CcArt: {
          props: { w: FILL, h },
          args: { word: x.word, label: x.name, index: no(k), tone: x.tone, motif: x.motif, scale },
        },
      },
      ...extra,
    })
  }

  const indexRow = b.component(
    "Index row",
    {
      key: "IdxRow",
      section: "Work",
      description: "One line of the project index. Hover fills the row with the accent.",
      props: {
        number: p.text("IrNo", "01"),
        project: p.text("IrName", "Hollis Coffee"),
        category: p.text("IrCat", "Identity, packaging"),
        place: p.text("IrPlace", "Rotterdam"),
        year: p.text("IrYear", "2026"),
        state: p.variants({
          default: {
            "root.fill": c("bg"),
            "IrNo.fill": muted,
            "IrName.fill": ink,
            "IrCat.fill": ink,
            "IrPlace.fill": muted,
            "IrYear.fill": muted,
            "IrArrow.color": muted,
          },
          hover: {
            "root.fill": c("accent"),
            "IrNo.fill": c("on-accent"),
            "IrName.fill": c("on-accent"),
            "IrCat.fill": c("on-accent"),
            "IrPlace.fill": c("on-accent"),
            "IrYear.fill": c("on-accent"),
            "IrArrow.color": c("on-accent"),
            "root.layout/pad": [16, 12],
          },
        }),
      },
      root: {
        dir: "row",
        w: 1360,
        gap: GUT,
        align: "center",
        pad: [16, 0],
        fill: c("bg"),
        stroke: rule,
      },
    },
    (root) => {
      b.text(root, "01", b.ty("mono"), muted, { key: "IrNo", w: COL, grow: "fixed-width" })
      b.text(root, "Hollis Coffee", b.ty("h1", { size: 76, letterSpacing: -3.4 }), ink, {
        key: "IrName",
        w: cols(6) - COL,
        grow: "fixed-width",
      })
      b.text(root, "Identity, packaging", b.ty("label"), ink, {
        key: "IrCat",
        w: cols(3),
        grow: "fixed-width",
      })
      b.text(root, "Rotterdam", b.ty("label", { weight: 400 }), muted, {
        key: "IrPlace",
        w: cols(2) - COL,
        grow: "fixed-width",
      })
      b.text(root, "2026", b.ty("mono", { align: "right" }), muted, {
        key: "IrYear",
        w: FILL,
        grow: "fixed-width",
      })
      b.icon(root, "arrow-up-right", 22, muted, { key: "IrArrow" })
    },
  )

  const sectionHead = b.component(
    "Section head",
    {
      key: "SecHead",
      section: "Content",
      description: "Numbered mono label on a rule, with an aside on the right.",
      props: {
        label: p.text("ShLabel", "(01) Selected work"),
        aside: p.text("ShAside", "2023 to 2027"),
      },
      root: {
        dir: "row",
        w: 1360,
        justify: "between",
        align: "center",
        pad: [14, 0, 20, 0],
        stroke: rule,
      },
    },
    (root) => {
      b.text(root, "(01) Selected work", monoStyle, ink, { key: "ShLabel" })
      b.text(root, "2023 to 2027", monoStyle, muted, { key: "ShAside" })
    },
  )

  const metaCell = b.component(
    "Meta cell",
    {
      key: "Meta",
      section: "Content",
      description: "Label over value, on a hairline. Used for project facts and studio facts.",
      props: {
        label: p.text("MtLabel", "Client"),
        value: p.text("MtValue", "Hollis Coffee Roasters"),
      },
      root: { dir: "column", w: cols(3), gap: 6, pad: [12, 0, 0, 0], stroke: hair },
    },
    (root) => {
      b.text(root, "Client", monoStyle, muted, { key: "MtLabel" })
      b.para(root, "Hollis Coffee Roasters", b.ty("label", { size: 16 }), ink, { key: "MtValue" })
    },
  )

  const stat = b.component(
    "Stat",
    {
      key: "Stat",
      section: "Content",
      description: "A result set large, with one line under it.",
      props: {
        value: p.text("StatVal", "+31%"),
        label: p.text("StatLbl", "Subscription signups in the first quarter"),
      },
      root: { dir: "column", w: cols(4), gap: 10, pad: [14, 0, 0, 0], stroke: rule },
    },
    (root) => {
      b.text(root, "+31%", b.ty("display", { size: 132, letterSpacing: -7 }), ink, {
        key: "StatVal",
        name: "Value",
      })
      b.para(
        root,
        "Subscription signups in the first quarter",
        b.ty("label", { size: 16, weight: 400 }),
        muted,
        {
          key: "StatLbl",
          name: "Label",
        },
      )
    },
  )

  const listRow = b.component(
    "List row",
    {
      key: "ListRow",
      section: "Content",
      description: "Three-column text row on a hairline: name, detail, and a note on the right.",
      props: {
        a: p.text("LrA", "Identity"),
        bb: p.text("LrB", "Naming, logo, type, guidelines"),
        cc: p.text("LrC", "6 to 12 weeks"),
      },
      root: { dir: "row", w: 1360, gap: GUT, pad: [14, 0, 14, 0], stroke: hair },
    },
    (root) => {
      const cellA = b.row(root, "Name", { w: fill(4), justify: "start" })
      b.text(cellA, "Identity", b.ty("label", { size: 16 }), ink, { key: "LrA" })
      const cellB = b.row(root, "Detail", { w: fill(5), justify: "start" })
      b.text(
        cellB,
        "Naming, logo, type, guidelines",
        b.ty("label", { size: 16, weight: 400 }),
        ink,
        { key: "LrB" },
      )
      const cellC = b.row(root, "Note", { w: fill(3), justify: "end" })
      b.text(cellC, "6 to 12 weeks", b.ty("label", { size: 16, weight: 400 }), muted, {
        key: "LrC",
      })
    },
  )

  const person = b.component(
    "Person",
    {
      key: "Person",
      section: "People",
      description: "Flat colour portrait field with the initials set huge, then name and role.",
      props: {
        name: p.text("PsName", "Nadia Verhoeven"),
        role: p.text("PsRole", "Founder, creative director"),
        initials: p.text("PsInit", "NV"),
        tone: p.variants(
          Object.fromEntries(
            TONES.map((t) => [t, { "PsField.fill": c(`t-${t}`), "PsInit.fill": c(`t-${t}-fg`) }]),
          ),
        ),
      },
      root: { dir: "column", w: cols(3), gap: s(3) },
    },
    (root) => {
      const field = b.col(root, "Portrait", {
        key: "PsField",
        w: FILL,
        h: 400,
        pad: [0, 16, 0, 16],
        justify: "end",
        radius: r("sm"),
        clip: true,
        fill: c("t-verm"),
      })
      b.text(
        field,
        "NV",
        b.ty("display", { size: 168, lineHeight: 0.68, letterSpacing: -9 }),
        c("t-verm-fg"),
        {
          key: "PsInit",
          name: "Initials",
        },
      )
      const names = b.col(root, "Names", { w: FILL, gap: 2 })
      b.text(names, "Nadia Verhoeven", b.ty("title"), ink, { key: "PsName" })
      b.text(names, "Founder, creative director", b.ty("label", { weight: 400 }), muted, {
        key: "PsRole",
      })
    },
  )

  const field = b.component(
    "Field",
    {
      key: "Field",
      section: "Forms",
      description:
        "Underlined field: mono label over a large value or placeholder. Accent sits on the accent field.",
      props: {
        label: p.text("FdLabel", "Your name"),
        value: p.text("FdValue", "Marieke Vos"),
        tone: p.variants({
          page: {
            "FdLabel.fill": muted,
            "FdValue.fill": ink,
            "root.stroke": { paint: ink, width: { b: 1 } },
          },
          empty: {
            "FdLabel.fill": muted,
            "FdValue.fill": muted,
            "root.stroke": { paint: ink, width: { b: 1 } },
          },
          accent: {
            "FdLabel.fill": c("on-accent"),
            "FdValue.fill": c("on-accent"),
            "root.stroke": { paint: c("on-accent"), width: { b: 1 } },
          },
        }),
      },
      root: {
        dir: "column",
        w: cols(6),
        gap: 6,
        pad: [0, 0, 10, 0],
        stroke: { paint: ink, width: { b: 1 } },
      },
    },
    (root) => {
      b.text(root, "Your name", monoStyle, muted, { key: "FdLabel" })
      b.text(
        root,
        "Marieke Vos",
        b.ty("heading", { size: 30, weight: 500, letterSpacing: -1 }),
        ink,
        { key: "FdValue" },
      )
    },
  )

  // --- Shared page pieces ----------------------------------------------------------------------------

  const eyebrow = (parent: string, text: string, w: number = cols(4) + GUT, fill = muted) =>
    b.text(parent, text, monoStyle, fill, { w, grow: "fixed-width" })

  // --- Cover -----------------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Portfolio template",
    title: "Oriel studio portfolio",
    description:
      "An editorial site for a nine-person design studio. Home, work index, case study, about and contact on desktop, plus mobile home and case study. Flat colour posters stand in for photography.",
    preview: (area) => {
      const row = b.row(area, "Posters", { w: FILL, gap: 16, align: "start" })
      b.use(row, projectCard, {
        props: { w: 300 },
        args: { title: "Hollis Coffee", category: "Identity, packaging", year: "2026" },
        set: {
          CcArt: {
            props: { w: FILL, h: 420 },
            args: {
              word: "Hollis",
              label: "Hollis Coffee",
              index: "01",
              tone: "verm",
              motif: "type",
              scale: "sm",
            },
          },
        },
      })
      const right = b.col(row, "Right", { w: FILL, gap: 16, pad: [96, 0, 0, 0] })
      art(right, "lumen", "sm", 250, { motif: "tiles" })
      art(right, "noord", "sm", 250)
    },
  })

  // --- Desktop ---------------------------------------------------------------------------------------

  const desktop = b.page("Desktop")
  function page(
    name: string,
    active: "home" | "work" | "studio" | "contact",
    tone: "page" | "accent" = "page",
    fillTone = c("bg"),
  ) {
    const scr = b.screen(desktop, name, { w: 1440, fill: fillTone })
    b.use(scr, navBar, { args: { active, tone } })
    return scr
  }
  const band = (parent: string, name: string, props: Record<string, unknown> = {}) =>
    b.col(parent, name, { w: FILL, gap: s(10), pad: [0, 40], ...props })

  // Home
  {
    const scr = page("Home", "home")
    const hero = b.row(scr, "Hero", { w: FILL, gap: GUT, pad: [88, 40, 0, 40], align: "start" })
    b.text(hero, "(Studio) Rotterdam, since 2017", monoStyle, ink, {
      w: cols(4) + GUT,
      grow: "fixed-width",
    })
    b.para(
      hero,
      "Identities, websites and products for people who make things.",
      b.ty("hero", { size: 112, letterSpacing: -5.6 }),
      ink,
    )

    const facts = b.row(scr, "Facts", { w: FILL, gap: GUT, pad: [96, 40, 0, 40] })
    for (const [label, value] of [
      ["Founded", "2017"],
      ["People", "Nine, in one room"],
      ["Clients", "112 since 2017"],
      ["Next opening", "January 2027"],
    ])
      b.use(facts, metaCell, { props: { w: cols(3) }, args: { label, value } })

    const featured = band(scr, "Featured", { pad: [56, 40, 0, 40], gap: 0 })
    card(featured, "hollis", 1360, 720, "lg")

    const grid = band(scr, "Grid", { pad: [72, 40, 0, 40], gap: s(16) })
    const r1 = b.row(grid, "Row", { w: FILL, justify: "between", align: "start" })
    card(r1, "ferro", cols(7), 600, "md", {})
    const r1b = b.col(r1, "Offset", { w: cols(4), pad: [160, 0, 0, 0] })
    card(r1b, "lumen", cols(4), 520, "md")
    const r2 = b.row(grid, "Row", { w: FILL, justify: "between", align: "start" })
    const r2a = b.col(r2, "Offset", { w: cols(5), pad: [0, 0, 0, 0] })
    card(r2a, "noord", cols(5), 560, "md")
    const r2b = b.col(r2, "Offset", { w: cols(6), pad: [120, 0, 0, 0] })
    card(r2b, "kade", cols(6), 520, "md")

    const idx = band(scr, "Index", { pad: [96, 40, 0, 40], gap: 0 })
    b.use(idx, sectionHead, { args: { label: "(02) Index", aside: "24 projects, 2017 to 2027" } })
    for (const k of ["tessel", "brandt", "vlieg", "atlas", "radio"] as const) {
      const x = P[k] as Project
      b.use(idx, indexRow, {
        args: { number: no(k), project: x.name, category: x.cat, place: x.place, year: x.year },
      })
    }
    const more = b.row(idx, "More", { w: FILL, pad: [20, 0, 0, 0], stroke: rule, justify: "end" })
    b.use(more, textLink, { args: { label: "All 24 projects" } })

    const studio = b.row(scr, "Studio", {
      w: FILL,
      gap: GUT,
      pad: [112, 40, 0, 40],
      align: "start",
    })
    b.text(studio, "(03) Studio", monoStyle, ink, { w: cols(4) + GUT, grow: "fixed-width" })
    const st = b.col(studio, "Text", { w: FILL, gap: s(10) })
    b.para(
      st,
      "We are nine designers and developers who like small clients with strong opinions. We draw the logo, build the site and stay for the first year of using it.",
      b.ty("lead", { size: 44, letterSpacing: -1.8, lineHeight: 1.1 }),
      ink,
    )
    const rows = b.col(st, "Services", { w: FILL })
    b.text(rows, "", b.ty("mono"), muted, { visible: false, name: "spacer" })
    for (const [a, bb, cc] of [
      ["Identity", "Naming, logo, type, guidelines", "6 to 12 weeks"],
      ["Websites", "Design, Webflow and custom builds, CMS", "8 to 16 weeks"],
      ["Products", "Research, prototypes, design systems", "From 12 weeks"],
      ["Packaging and print", "Labels, boxes, signage, annual reports", "4 to 10 weeks"],
    ])
      b.use(rows, listRow, { props: { w: FILL }, args: { a, bb, cc } })

    const quote = b.row(scr, "Quote", { w: FILL, gap: GUT, pad: [112, 40, 0, 40], align: "start" })
    b.text(quote, "(04) Kind words", monoStyle, ink, { w: cols(4) + GUT, grow: "fixed-width" })
    const qc = b.col(quote, "Quote", { w: FILL, gap: s(8) })
    b.para(
      qc,
      "Our logo was drawn for one café in 2014. Oriel gave four shops, a subscription box and 200 bags one voice, in fourteen weeks.",
      b.ty("hero", { size: 64, letterSpacing: -2.8, weight: 500, lineHeight: 1.04 }),
      ink,
    )
    b.text(qc, "Marieke Vos, founder, Hollis Coffee Roasters", monoStyle, muted)
    b.rect(scr, "Space", { w: FILL, h: 112, fill: c("bg") })
    b.use(scr, footer)
  }

  // Work
  {
    const scr = page("Work", "work")
    const head = b.row(scr, "Title", {
      w: FILL,
      gap: GUT,
      pad: [72, 40, 0, 40],
      align: "end",
      justify: "between",
    })
    b.text(head, "Work", b.ty("display", { size: 240, letterSpacing: -14 }), ink)
    const aside = b.col(head, "Aside", { w: cols(4), gap: 6, pad: [0, 0, 24, 0] })
    b.text(aside, "(24)", b.ty("heading", { size: 40 }), ink)
    b.para(
      aside,
      "Selected projects from 2017 to 2027. Ten shown, the rest on request.",
      b.ty("body"),
      muted,
    )

    const filters = b.row(scr, "Filters", {
      w: FILL,
      gap: 8,
      pad: [48, 40, 24, 40],
      align: "center",
    })
    for (const [i, [label, n]] of [
      ["All", "24"],
      ["Identity", "9"],
      ["Websites", "8"],
      ["Products", "5"],
      ["Packaging", "6"],
    ].entries())
      b.use(filters, chip, {
        args: { label: label as string, count: n as string, state: i === 0 ? "on" : "off" },
      })
    const view = b.row(filters, "View", { w: FILL, gap: 14, justify: "end", align: "center" })
    for (const [label, on] of [
      ["Index", true],
      ["Grid", false],
    ] as const)
      b.text(view, label, b.ty("label", { decoration: on ? ["underline"] : [] }), on ? ink : muted)

    const list = band(scr, "Index", { gap: 0 })
    for (const [i, k] of (
      [
        "hollis",
        "ferro",
        "lumen",
        "noord",
        "kade",
        "tessel",
        "brandt",
        "vlieg",
        "atlas",
        "radio",
      ] as const
    ).entries()) {
      const x = P[k] as Project
      b.use(list, indexRow, {
        args: {
          number: no(k),
          project: x.name,
          category: x.cat,
          place: x.place,
          year: x.year,
          ...(i === 2 ? { state: "hover" } : {}),
        },
      })
    }
    b.rect(list, "Rule", { w: FILL, h: 1, fill: ink })
    const foot = b.row(list, "Pager", {
      w: FILL,
      justify: "between",
      align: "center",
      pad: [20, 0, 0, 0],
    })
    b.text(foot, "Showing 10 of 24", monoStyle, muted)
    b.use(foot, buttonOutline, { args: { label: "Load 14 more", icon: true } })
    b.rect(scr, "Space", { w: FILL, h: 120, fill: c("bg") })
    b.use(scr, footer)
  }

  // Case study
  {
    const scr = page("Case study", "work")
    const head = b.row(scr, "Title", { w: FILL, gap: GUT, pad: [64, 40, 0, 40], align: "start" })
    eyebrow(head, "(Case study) 2026", cols(4) + GUT, ink)
    const t = b.col(head, "Title", { w: FILL, gap: s(8) })
    b.text(t, "Hollis Coffee", b.ty("display", { size: 148, letterSpacing: -8 }), ink)
    b.para(
      t,
      "A voice for four cafés, a subscription box and 200 bags a week.",
      b.ty("lead", { size: 32, letterSpacing: -1.2 }),
      muted,
    )

    const meta = b.row(scr, "Facts", { w: FILL, gap: GUT, pad: [64, 40, 0, 40] })
    for (const [label, value] of [
      ["Client", "Hollis Coffee Roasters"],
      ["Year", "2026, 14 weeks"],
      ["Services", "Identity, packaging, signage"],
      ["Team", "Nadia Verhoeven, Joris Bakker, Sanne de Wit"],
    ])
      b.use(meta, metaCell, { props: { w: cols(3) }, args: { label, value } })

    const lead = band(scr, "Lead", { pad: [48, 40, 0, 40], gap: 0 })
    art(lead, "hollis", "lg", 760)

    const brief = b.row(scr, "Brief", { w: FILL, gap: GUT, pad: [120, 40, 0, 40], align: "start" })
    eyebrow(brief, "(01) The brief", cols(4) + GUT, ink)
    b.para(
      brief,
      "Hollis had outgrown a logo drawn for one café in 2014. Four shops and a subscription service later, every bag, cup and menu looked a little different, and nobody could say which was right.",
      b.ty("hero", { size: 56, letterSpacing: -2.4, weight: 500, lineHeight: 1.06 }),
      ink,
    )

    const pair = b.row(scr, "Pair", {
      w: FILL,
      justify: "between",
      align: "start",
      pad: [96, 40, 0, 40],
    })
    art(pair, "hollis", "md", 640, {
      w: cols(8),
      tone: "butter",
      motif: "arches",
      label: "Hollis Coffee, origin range",
      index: "02",
    })
    art(pair, "hollis", "md", 640, {
      w: cols(4),
      tone: "cobalt",
      motif: "tiles",
      label: "Hollis Coffee, sachets",
      index: "03",
    })

    const text = b.row(scr, "Approach", { w: FILL, gap: GUT, pad: [96, 40, 0, 40], align: "start" })
    eyebrow(text, "(02) The approach", cols(4) + GUT, ink)
    const tcol = b.row(text, "Columns", { w: FILL, gap: GUT, align: "start" })
    for (const [h, body] of [
      [
        "One letter, drawn twice",
        "We started with the H of the old sign and redrew it as a roaster's mark and as a stamp that fits on a 12 gram sample sachet.",
      ],
      [
        "Colour from the beans",
        "Each origin gets a flat field taken from its green coffee: Huila in vermilion, Sidamo in butter, Cerrado in moss.",
      ],
    ]) {
      const cc = b.col(tcol, h, { w: FILL, gap: s(3), pad: [12, 0, 0, 0], stroke: hair })
      b.text(cc, h, b.ty("title"), ink)
      b.para(cc, body, b.ty("body"), muted)
    }

    const wide = band(scr, "Wide", { pad: [96, 40, 0, 40], gap: 0 })
    art(wide, "kade", "lg", 640, {
      tone: "moss",
      motif: "type",
      word: "Huila",
      label: "Hollis Coffee, bag system",
      index: "04",
    })

    const results = b.col(scr, "Results", { w: FILL, gap: s(10), pad: [120, 40, 0, 40] })
    b.use(results, sectionHead, {
      args: { label: "(03) Results", aside: "Measured to September 2026" },
    })
    const sr = b.row(results, "Stats", { w: FILL, gap: GUT })
    for (const [value, label] of [
      ["+31%", "Subscription signups in the first quarter"],
      ["6 to 1", "Bag formats collapsed into one system"],
      ["9 weeks", "To re-sign all four cafés"],
    ])
      b.use(sr, stat, { args: { value, label } })

    const quote = b.row(scr, "Quote", { w: FILL, gap: GUT, pad: [120, 40, 0, 40], align: "start" })
    eyebrow(quote, "(04) Client", cols(4) + GUT, ink)
    const qc = b.col(quote, "Quote", { w: FILL, gap: s(6) })
    b.para(
      qc,
      "They asked what we sell before they asked what we look like. That is why the bags finally look like us.",
      b.ty("hero", { size: 56, letterSpacing: -2.4, weight: 500, lineHeight: 1.06 }),
      ink,
    )
    b.text(qc, "Marieke Vos, founder, Hollis Coffee Roasters", monoStyle, muted)

    b.rect(scr, "Space", { w: FILL, h: 120, fill: c("bg") })
    const next = b.col(scr, "Next", {
      w: FILL,
      gap: s(5),
      pad: [112, 40, 56, 40],
      fill: c("t-cobalt"),
    })
    b.text(next, "(Next project) 02 of 24", monoStyle, c("t-cobalt-fg"))
    const nr = b.row(next, "Title", { w: FILL, justify: "between", align: "end" })
    b.text(nr, "Ferro Bikes", b.ty("display", { size: 200, letterSpacing: -11 }), c("t-cobalt-fg"))
    b.icon(nr, "arrow-up-right", 120, c("t-cobalt-fg"))
    b.use(scr, footer)
  }

  // About
  {
    const scr = page("About", "studio")
    const head = b.row(scr, "Title", { w: FILL, gap: GUT, pad: [72, 40, 0, 40], align: "start" })
    eyebrow(head, "(About) The studio", cols(4) + GUT, ink)
    b.para(
      head,
      "We are nine people in one room on the Schiedamse Vest. We make identities, websites and products for independent businesses, and we stay small on purpose.",
      b.ty("hero", { size: 80, letterSpacing: -3.6 }),
      ink,
    )
    const wide = band(scr, "Wide", { pad: [96, 40, 0, 40], gap: 0 })
    art(wide, "noord", "lg", 560, {
      tone: "lilac",
      motif: "arches",
      label: "Oriel, Schiedamse Vest 82",
      index: "—",
    })

    const two = b.row(scr, "Text", { w: FILL, gap: GUT, pad: [96, 40, 0, 40], align: "start" })
    eyebrow(two, "(01) How we work", cols(4) + GUT, ink)
    const tc = b.col(two, "Columns", { w: FILL, gap: s(8) })
    b.para(
      tc,
      "Oriel began in 2017 as two designers and a shared desk. Today it is nine people who all draw, write or build, and every project has at least one of each in the room.",
      b.ty("lead", { size: 32, letterSpacing: -1.1 }),
      ink,
    )
    const three = b.row(tc, "Columns", { w: FILL, gap: GUT, align: "start" })
    for (const [h, body] of [
      [
        "Small on purpose",
        "We take on eleven projects a year. Every client works with the people who draw the thing.",
      ],
      [
        "Build what we draw",
        "Designers and developers share one board, so what you approve is what ships.",
      ],
      [
        "Stay for a year",
        "Each project includes twelve months of support, because launch day is not the end.",
      ],
    ]) {
      const cc = b.col(three, h, { w: FILL, gap: s(2), pad: [12, 0, 0, 0], stroke: hair })
      b.text(cc, h, b.ty("title"), ink)
      b.para(cc, body, b.ty("body"), muted)
    }

    const team = b.col(scr, "Team", { w: FILL, gap: s(10), pad: [120, 40, 0, 40] })
    b.use(team, sectionHead, { args: { label: "(02) People", aside: "Nine, plus one studio dog" } })
    const tr = b.row(team, "People", { w: FILL, justify: "between", align: "start" })
    for (const [name, role, initials, tone] of [
      ["Nadia Verhoeven", "Founder, creative director", "NV", "verm"],
      ["Joris Bakker", "Design director", "JB", "cobalt"],
      ["Sanne de Wit", "Type designer", "SW", "butter"],
      ["Yusuf Demir", "Strategist", "YD", "moss"],
    ] as const)
      b.use(tr, person, { args: { name, role, initials, tone } })
    const lst = b.col(team, "Others", { w: FILL, pad: [24, 0, 0, 0], gap: 0 })
    for (const [a, bb, cc] of [
      ["Ines Carvalho", "Developer", "Since 2019"],
      ["Pim Hoekstra", "Developer", "Since 2020"],
      ["Lotte Maas", "Producer", "Since 2021"],
      ["Teun Brouwer", "Motion designer", "Since 2022"],
      ["Mila Jansen", "Designer", "Since 2024"],
    ])
      b.use(lst, listRow, { props: { w: FILL }, args: { a, bb, cc } })

    const recog = b.col(scr, "Recognition", { w: FILL, gap: s(10), pad: [120, 40, 0, 40] })
    b.use(recog, sectionHead, { args: { label: "(03) Recognition", aside: "Selected" } })
    const rl = b.col(recog, "Rows", { w: FILL, gap: 0 })
    for (const [a, bb, cc] of [
      ["Dutch Design Awards, nominee", "Hollis Coffee, identity", "2026"],
      ["Awwwards, site of the day", "Ferro Bikes, website", "2026"],
      ["Red Dot, packaging", "Tessel Tea, tins", "2024"],
      ["ADCN Lamp, silver", "Museum Noord, wayfinding", "2025"],
    ])
      b.use(rl, listRow, { props: { w: FILL }, args: { a, bb, cc } })
    b.rect(scr, "Space", { w: FILL, h: 120, fill: c("bg") })
    b.use(scr, footer)
  }

  // Contact
  {
    const scr = page("Contact", "contact", "accent", c("accent"))
    const ac = c("on-accent")
    const head = b.col(scr, "Title", { w: FILL, gap: s(8), pad: [64, 40, 0, 40] })
    b.text(head, "(Contact) Booking from January 2027", monoStyle, ac)
    b.para(
      head,
      "Tell us what you are making.",
      b.ty("display", { size: 184, letterSpacing: -10 }),
      ac,
    )

    const body = b.row(scr, "Body", { w: FILL, gap: GUT, pad: [96, 40, 120, 40], align: "start" })
    const left = b.col(body, "Details", { w: cols(5), gap: s(10) })
    b.text(left, "hello@oriel.studio", b.ty("heading", { size: 44, decoration: ["underline"] }), ac)
    for (const [label, lines] of [
      ["Studio", ["Schiedamse Vest 82", "3011 BE Rotterdam"]],
      ["Call", ["+31 10 412 77 90", "Mon to Fri, 9:00 to 17:30"]],
      ["Press", ["press@oriel.studio"]],
    ] as const) {
      const cc = b.col(left, label, {
        w: FILL,
        gap: 4,
        pad: [12, 0, 0, 0],
        stroke: { paint: ac, width: { t: 1 } },
      })
      b.text(cc, label, monoStyle, ac)
      for (const l of lines) b.text(cc, l, b.ty("title", { weight: 500 }), ac)
    }
    const form = b.col(body, "Form", { w: FILL, gap: s(10), pad: [0, 0, 0, 0] })
    b.text(form, "(Enquiry) A few lines are enough", monoStyle, ac)
    const names = b.row(form, "Names", { w: FILL, gap: GUT })
    b.use(names, field, {
      props: { w: FILL },
      args: { label: "Your name", value: "Marieke Vos", tone: "accent" },
    })
    b.use(names, field, {
      props: { w: FILL },
      args: { label: "Company", value: "Hollis Coffee", tone: "accent" },
    })
    b.use(form, field, {
      props: { w: FILL },
      args: { label: "Email", value: "marieke@hollis.coffee", tone: "accent" },
    })
    b.use(form, field, {
      props: { w: FILL },
      args: {
        label: "What do you need? Identity, site, product",
        value: "A site for our new roastery",
        tone: "accent",
      },
    })
    b.use(form, field, {
      props: { w: FILL },
      args: { label: "Budget and timing", value: "€25k to €50k, launch in June", tone: "accent" },
    })
    const send = b.row(form, "Send", { w: FILL, gap: s(6), align: "center", justify: "between" })
    b.text(send, "We reply within two working days.", b.ty("label"), ac)
    b.use(send, button, { args: { label: "Send enquiry", size: "lg", icon: true } })
    b.use(scr, footer)
  }

  // --- Mobile ----------------------------------------------------------------------------------------

  const mobile = b.page("Mobile")
  function mobileScreen(name: string) {
    const scr = b.screen(mobile, name, { w: 390, h: 844, fill: c("bg"), clip: true })
    b.use(scr, mobileHeader, { props: { w: FILL } })
    return scr
  }

  // Mobile home
  {
    const scr = mobileScreen("Mobile home")
    const hero = b.col(scr, "Hero", { w: FILL, gap: s(5), pad: [28, 20, 0, 20] })
    b.text(hero, "(Studio) Rotterdam", monoStyle, ink)
    b.para(
      hero,
      "Identities, websites and products for people who make things.",
      b.ty("hero", { size: 52, letterSpacing: -2.6 }),
      ink,
    )
    const live = b.row(hero, "Availability", { gap: 8, align: "center", pad: [8, 0, 0, 0] })
    b.ellipse(live, "Status", { w: 7, h: 7, fill: c("live") })
    b.text(live, "Booking from January 2027", b.ty("label"), ink)
    const feat = b.col(scr, "Featured", { w: FILL, pad: [28, 20, 0, 20] })
    card(feat, "hollis", 350, 330, "sm")
    const idx = b.col(scr, "Index", { w: FILL, pad: [32, 20, 0, 20], gap: 0 })
    b.use(idx, sectionHead, {
      props: { w: FILL },
      args: { label: "(02) Index", aside: "24 projects" },
    })
    for (const k of ["ferro", "lumen"] as const) {
      const x = P[k] as Project
      const row = b.row(idx, x.name, {
        w: FILL,
        pad: [12, 0],
        stroke: rule,
        justify: "between",
        align: "center",
      })
      b.text(row, x.name, b.ty("heading", { size: 30, letterSpacing: -1.2 }), ink)
      b.text(row, x.year, b.ty("mono"), muted)
    }
  }

  // Mobile case study
  {
    const scr = mobileScreen("Mobile case study")
    const top = b.col(scr, "Header", { w: FILL, gap: s(4), pad: [20, 20, 0, 20] })
    const back = b.row(top, "Back", { gap: 6, align: "center" })
    b.icon(back, "arrow-left", 14, ink)
    b.text(back, "All work", b.ty("label"), ink)
    b.text(top, "(Case study) 2026", monoStyle, muted, { name: "Label" })
    b.text(top, "Hollis Coffee", b.ty("display", { size: 62, letterSpacing: -3.4 }), ink)
    b.para(
      top,
      "A voice for four cafés, a subscription box and 200 bags a week.",
      b.ty("lead", { size: 20, letterSpacing: -0.6 }),
      muted,
    )
    const lead = b.col(scr, "Lead", { w: FILL, pad: [24, 20, 0, 20] })
    art(lead, "hollis", "sm", 300, { w: 350 })
    const meta = b.row(scr, "Facts", { w: FILL, gap: GUT, pad: [24, 20, 0, 20] })
    b.use(meta, metaCell, {
      props: { w: FILL },
      args: { label: "Client", value: "Hollis Coffee Roasters" },
    })
    b.use(meta, metaCell, { props: { w: FILL }, args: { label: "Year", value: "2026, 14 weeks" } })
    const brief = b.col(scr, "Brief", { w: FILL, gap: s(3), pad: [32, 20, 0, 20] })
    b.text(brief, "(01) The brief", monoStyle, ink)
    b.para(
      brief,
      "Hollis had outgrown a logo drawn for one café in 2014. Four shops and a subscription later, nothing matched.",
      b.ty("lead", { size: 26, letterSpacing: -0.9, lineHeight: 1.14 }),
      ink,
    )
  }
}
