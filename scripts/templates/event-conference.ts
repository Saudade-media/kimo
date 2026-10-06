/**
 * Offset 2027: the website of a fictional two-day product design conference in Copenhagen.
 * Screens (1440 wide): Home, Speakers, Schedule (two tracks), Speaker detail, Tickets,
 * Venue and travel.
 *
 * Direction: festival poster, not SaaS landing page. Huge uppercase Inter 800 set tight, a ring
 * "O" as the mark, a full-width date ticker, flat colour fields (cobalt, lime, pink) with hard
 * offset shadows, mono times, hairline schedule rows. A 12-column grid (48 px margins, 24 px
 * gutters, 90 px columns). The track colours (lime for the main stage, pink for the Studio) carry
 * through lineup, schedule and speaker pages.
 */
import { FILL, fill, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "event-conference",
  name: "Offset conference site",
  category: "Website",
  description:
    "Six-screen poster-style site for a two-day product design conference: home, speakers, two-track schedule, speaker page, tickets and venue.",
  prefix: "ec",
  build,
}

type Track = "main" | "studio"
type Tone = "lime" | "pink" | "blue" | "paper" | "ink"

const COL = 90
const GUT = 24
const cols = (n: number) => n * COL + (n - 1) * GUT

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F2EFE6", "#0B0B12"],
      surface: ["#FBFAF5", "#14141D"],
      subtle: ["#E4E0D3", "#1C1C28"],
      ink: ["#0B0B12", "#F2EFE6"],
      muted: ["#5F5E66", "#A09FAC"],
      border: ["#C8C4B6", "#34343F"],
      accent: ["#2B2BF2", "#8585FF"],
      "on-accent": ["#F2EFE6", "#0B0B12"],
      blue: ["#2B2BF2", "#3434FF"],
      "on-blue": ["#F2EFE6", "#F2EFE6"],
      "blue-muted": ["#B9B9FF", "#B9B9FF"],
      lime: ["#D4FF3E", "#D4FF3E"],
      "on-lime": ["#0B0B12", "#0B0B12"],
      pink: ["#FF9AD1", "#FF9AD1"],
      "on-pink": ["#0B0B12", "#0B0B12"],
      night: ["#0B0B12", "#12121B"],
      "on-night": ["#F2EFE6", "#F2EFE6"],
      "night-muted": ["#A09FAC", "#A09FAC"],
      "night-border": ["#34343F", "#34343F"],
      "map-water": ["#BFC4FF", "#1B1C5A"],
      "map-land": ["#E4E0D3", "#1C1C28"],
      "map-block": ["#CFCABA", "#2A2A38"],
      "map-park": ["#C9E27A", "#2D3A12"],
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
      "radius/sm": 2,
      "radius/md": 8,
      "radius/pill": 999,
    },
    type: {
      display: { font: "Inter", size: 96, weight: 800, lineHeight: 0.9, letterSpacing: -5 },
      h1: { font: "Inter", size: 72, weight: 800, lineHeight: 0.92, letterSpacing: -3.6 },
      heading: { font: "Inter", size: 44, weight: 800, lineHeight: 0.98, letterSpacing: -2 },
      title: { font: "Inter", size: 24, weight: 700, lineHeight: 1.15, letterSpacing: -0.7 },
      lead: { font: "Inter", size: 28, weight: 600, lineHeight: 1.16, letterSpacing: -1 },
      body: { font: "Inter", size: 16, weight: 400, lineHeight: 1.45, letterSpacing: -0.1 },
      label: { font: "Inter", size: 14, weight: 600, lineHeight: 1.3, letterSpacing: -0.1 },
      small: { font: "Inter", size: 13, weight: 400, lineHeight: 1.4 },
      mono: { font: "JetBrains Mono", size: 12, weight: 500, lineHeight: 1.4, letterSpacing: 0.5 },
    },
    shadows: {
      offset: { kind: "shadow", x: 8, y: 8, blur: 0, color: "#0B0B12FF" },
    },
  })

  const c = (n: string) => b.c(n)
  const s = (n: number) => b.n(`space/${n}`)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  const mono = b.ty("mono", { case: "upper" })
  const up = (name: string, extra: Record<string, unknown> = {}) =>
    b.ty(name, { case: "upper", ...extra })
  const rule = { paint: ink, width: { t: 1 } }
  const hair = { paint: c("border"), width: { t: 1 } }

  const trackFill = (t: Track) => (t === "main" ? c("lime") : c("pink"))
  const trackInk = (t: Track) => (t === "main" ? c("on-lime") : c("on-pink"))

  // --- Actions ---------------------------------------------------------------------------------------

  const button = b.component(
    "Button",
    {
      key: "Btn",
      section: "Actions",
      description: "Pill button in lime, ink, blue or outline. md or lg; arrow optional.",
      props: {
        label: p.text("BtnLabel", "Get tickets"),
        icon: p.bool("BtnIcon", false),
        variant: p.variants({
          lime: {
            "root.fill": c("lime"),
            "root.stroke": { paint: c("lime") },
            "BtnLabel.fill": c("on-lime"),
            "BtnIcon.color": c("on-lime"),
          },
          ink: {
            "root.fill": ink,
            "root.stroke": { paint: ink },
            "BtnLabel.fill": c("bg"),
            "BtnIcon.color": c("bg"),
          },
          blue: {
            "root.fill": c("blue"),
            "root.stroke": { paint: c("blue") },
            "BtnLabel.fill": c("on-blue"),
            "BtnIcon.color": c("on-blue"),
          },
          outline: {
            "root.fill": c("bg"),
            "root.stroke": { paint: ink, width: 2 },
            "BtnLabel.fill": ink,
            "BtnIcon.color": ink,
          },
          ghost: {
            "root.fill": c("blue"),
            "root.stroke": { paint: c("on-blue"), width: 2 },
            "BtnLabel.fill": c("on-blue"),
            "BtnIcon.color": c("on-blue"),
          },
          night: {
            "root.fill": c("night"),
            "root.stroke": { paint: c("night") },
            "BtnLabel.fill": c("on-night"),
            "BtnIcon.color": c("on-night"),
          },
        }),
        size: p.variants({
          md: { "root.layout/pad": [10, 20], "BtnLabel.style/size": 14 },
          lg: { "root.layout/pad": [18, 34], "BtnLabel.style/size": 20 },
        }),
      },
      root: {
        dir: "row",
        gap: 8,
        align: "center",
        justify: "center",
        pad: [10, 20],
        radius: r("pill"),
        fill: c("lime"),
        stroke: { paint: c("lime") },
      },
    },
    (root) => {
      b.text(
        root,
        "Get tickets",
        b.ty("label", { weight: 700, case: "upper", letterSpacing: 0.2 }),
        c("on-lime"),
        {
          key: "BtnLabel",
          name: "Label",
        },
      )
      b.icon(root, "arrow-up-right", 18, c("on-lime"), { key: "BtnIcon", visible: false })
    },
  )
  const buttonOutline = b.derive(button, "Button/Outline", "BtnOut", {
    section: "Actions",
    args: { variant: "outline" },
  })

  const tag = b.component(
    "Track tag",
    {
      key: "Tag",
      section: "Actions",
      description:
        "Track or format label. Lime is the main stage, pink the Studio, outline a format.",
      props: {
        label: p.text("TagLbl", "Main stage"),
        tone: p.variants({
          main: {
            "root.fill": c("lime"),
            "root.stroke": { paint: c("lime") },
            "TagLbl.fill": c("on-lime"),
          },
          studio: {
            "root.fill": c("pink"),
            "root.stroke": { paint: c("pink") },
            "TagLbl.fill": c("on-pink"),
          },
          outline: { "root.fill": c("bg"), "root.stroke": { paint: ink }, "TagLbl.fill": ink },
          ink: { "root.fill": ink, "root.stroke": { paint: ink }, "TagLbl.fill": c("bg") },
        }),
      },
      root: {
        dir: "row",
        align: "center",
        pad: [5, 10],
        radius: r("pill"),
        fill: c("lime"),
        stroke: { paint: c("lime") },
      },
    },
    (root) =>
      b.text(root, "Main stage", b.ty("mono", { case: "upper" }), c("on-lime"), {
        key: "TagLbl",
        name: "Label",
      }),
  )

  // --- Navigation ------------------------------------------------------------------------------------

  /** The ring O mark followed by the rest of the word. */
  function wordmark(
    parent: string,
    size: number,
    fillOn: ReturnType<typeof c>,
    ringOn: ReturnType<typeof c>,
    keys?: { ring?: string; word?: string },
  ) {
    const cap = size * 0.727
    const row = b.row(parent, "Wordmark", { gap: size * 0.035, align: "center" })
    b.ellipse(row, "O", {
      w: cap,
      h: cap,
      stroke: { paint: ringOn, width: size * 0.155 },
      ...(keys?.ring ? { key: keys.ring } : {}),
    })
    b.text(
      row,
      "FFSET",
      up("display", { size, lineHeight: 0.7, letterSpacing: -size * 0.052 }),
      fillOn,
      {
        name: "Word",
        ...(keys?.word ? { key: keys.word } : {}),
      },
    )
    return row
  }

  const navLinks = ["Speakers", "Schedule", "Tickets", "Venue"] as const
  const navActive = (i: number) =>
    Object.fromEntries(
      navLinks.map((_, j) => [`NavL${j + 1}.style/decoration`, j === i ? ["underline"] : []]),
    )
  const navTone = (onBlue: boolean) => ({
    "root.fill": onBlue ? c("blue") : c("bg"),
    "NavRing.stroke": { paint: onBlue ? c("lime") : ink, width: 4 },
    "NavWord.fill": onBlue ? c("on-blue") : ink,
    "NavDate.fill": onBlue ? c("on-blue") : ink,
    ...Object.fromEntries(
      navLinks.map((_, j) => [`NavL${j + 1}.fill`, onBlue ? c("on-blue") : ink]),
    ),
  })
  const navBar = b.component(
    "Nav bar",
    {
      key: "NavBar",
      section: "Navigation",
      description:
        "Desktop header: ring mark, links, date and ticket button. Blue sits over the hero.",
      props: {
        active: p.variants({
          home: navActive(-1),
          speakers: navActive(0),
          schedule: navActive(1),
          tickets: navActive(2),
          venue: navActive(3),
        }),
        tone: p.variants({ page: navTone(false), blue: navTone(true) }),
      },
      root: {
        dir: "row",
        w: 1440,
        justify: "between",
        align: "center",
        pad: [22, 48],
        fill: c("bg"),
      },
    },
    (root) => {
      const left = b.row(root, "Left", { w: cols(3), align: "center" })
      wordmark(left, 30, ink, ink, { ring: "NavRing", word: "NavWord" })
      const mid = b.row(root, "Links", { gap: 32, align: "center" })
      for (const [i, l] of navLinks.entries())
        b.text(mid, l, b.ty("label", { size: 15, weight: 600 }), ink, { key: `NavL${i + 1}` })
      const right = b.row(root, "Right", { w: cols(4), gap: 20, align: "center", justify: "end" })
      b.text(right, "15 and 16 April 2027", b.ty("mono", { case: "upper" }), ink, {
        key: "NavDate",
      })
      b.use(right, button, { args: { label: "Get tickets" } })
    },
  )

  const footer = b.component(
    "Footer",
    {
      key: "Footer",
      section: "Navigation",
      description: "Closing block: the wordmark at full width, links, and the organisers.",
      root: { dir: "column", w: 1440, gap: s(10), pad: [64, 48, 32, 48], fill: c("night") },
    },
    (root) => {
      const top = b.row(root, "Top", { w: FILL, gap: GUT, align: "start" })
      const col = (title: string, lines: string[], w: number) => {
        const cc = b.col(top, title, { w, gap: 8 })
        b.text(cc, title, mono, c("night-muted"), { name: "Heading" })
        for (const l of lines)
          b.text(cc, l, b.ty("label", { size: 16, weight: 500 }), c("on-night"))
      }
      col("Conference", ["Speakers", "Schedule", "Tickets", "Venue and travel"], cols(3))
      col("Dates", ["Thursday 15 April", "Friday 16 April 2027", "Doors at 08:30"], cols(3))
      col("Venue", ["Dok 4, Refshalevej 163", "1432 Copenhagen K", "Denmark"], cols(3))
      const news = b.col(top, "Updates", { w: FILL, gap: 8 })
      b.text(news, "Updates", mono, c("night-muted"), { name: "Heading" })
      b.para(
        news,
        "Speaker announcements and ticket releases, about six emails a year.",
        b.ty("body"),
        c("on-night"),
      )
      const mark = b.row(root, "Mark", { w: FILL, justify: "start", pad: [32, 0, 0, 0] })
      wordmark(mark, 372, c("on-night"), c("lime"))
      const bottom = b.row(root, "Legal", { w: FILL, justify: "between", pad: [8, 0, 0, 0] })
      b.text(
        bottom,
        "Offset is run by Offset Events ApS, Copenhagen. CVR 41 22 87 03.",
        b.ty("small"),
        c("night-muted"),
      )
      b.text(bottom, "Code of conduct  Privacy  Press", b.ty("small"), c("night-muted"))
    },
  )

  // --- Hero pieces -----------------------------------------------------------------------------------

  const ticker = b.component(
    "Date ticker",
    {
      key: "Ticker",
      section: "Content",
      description:
        "Full-width band that spreads the dates and place across the page, separated by asterisks.",
      props: {
        a: p.text("TkA", "15 April 2027"),
        bb: p.text("TkB", "16 April 2027"),
        cc: p.text("TkC", "Copenhagen"),
        dd: p.text("TkD", "Dok 4"),
        tone: p.variants({
          lime: {
            "root.fill": c("lime"),
            "TkA.fill": c("on-lime"),
            "TkB.fill": c("on-lime"),
            "TkC.fill": c("on-lime"),
            "TkD.fill": c("on-lime"),
            "TkS1.color": c("on-lime"),
            "TkS2.color": c("on-lime"),
            "TkS3.color": c("on-lime"),
          },
          ink: {
            "root.fill": ink,
            "TkA.fill": c("bg"),
            "TkB.fill": c("bg"),
            "TkC.fill": c("bg"),
            "TkD.fill": c("bg"),
            "TkS1.color": c("lime"),
            "TkS2.color": c("lime"),
            "TkS3.color": c("lime"),
          },
          pink: {
            "root.fill": c("pink"),
            "TkA.fill": c("on-pink"),
            "TkB.fill": c("on-pink"),
            "TkC.fill": c("on-pink"),
            "TkD.fill": c("on-pink"),
            "TkS1.color": c("on-pink"),
            "TkS2.color": c("on-pink"),
            "TkS3.color": c("on-pink"),
          },
        }),
      },
      root: {
        dir: "row",
        w: 1440,
        justify: "between",
        align: "center",
        pad: [26, 48],
        fill: c("lime"),
      },
    },
    (root) => {
      const tk = up("h1", { size: 50, letterSpacing: -2.4 })
      b.text(root, "15 April 2027", tk, c("on-lime"), { key: "TkA" })
      b.icon(root, "asterisk", 40, c("on-lime"), { key: "TkS1" })
      b.text(root, "16 April 2027", tk, c("on-lime"), { key: "TkB" })
      b.icon(root, "asterisk", 40, c("on-lime"), { key: "TkS2" })
      b.text(root, "Copenhagen", tk, c("on-lime"), { key: "TkC" })
      b.icon(root, "asterisk", 40, c("on-lime"), { key: "TkS3" })
      b.text(root, "Dok 4", tk, c("on-lime"), { key: "TkD" })
    },
  )

  const countdown = b.component(
    "Countdown",
    {
      key: "Count",
      section: "Content",
      description: "Days, hours and minutes to doors open, as boxed digits.",
      props: {
        days: p.text("CdD", "191"),
        hours: p.text("CdH", "04"),
        minutes: p.text("CdM", "22"),
      },
      root: { dir: "row", gap: 10, align: "end", pad: 16, fill: c("blue") },
    },
    (root) => {
      for (const [key, val, label] of [
        ["CdD", "191", "Days"],
        ["CdH", "04", "Hours"],
        ["CdM", "22", "Minutes"],
      ] as const) {
        const cell = b.col(root, label, { gap: 6, align: "start" })
        const box = b.row(cell, "Digits", {
          pad: [10, 14],
          stroke: { paint: c("on-blue"), width: 2 },
          radius: r("sm"),
        })
        b.text(box, val, up("h1", { size: 56, letterSpacing: -2 }), c("on-blue"), { key })
        b.text(cell, label, mono, c("blue-muted"))
      }
    },
  )

  // --- People ----------------------------------------------------------------------------------------

  const toneVars = (t: Tone) => {
    const bgc = t === "paper" ? c("subtle") : t === "ink" ? c("night") : c(t)
    const fgc =
      t === "lime"
        ? c("on-lime")
        : t === "pink"
          ? c("on-pink")
          : t === "blue"
            ? c("on-blue")
            : t === "ink"
              ? c("lime")
              : ink
    return { "PsField.fill": bgc, "PsInit.fill": fgc }
  }
  const TONES: Tone[] = ["lime", "pink", "blue", "paper", "ink"]

  const speakerCard = b.component(
    "Speaker card",
    {
      key: "Spk",
      section: "People",
      description:
        "Flat colour portrait with the initials set huge, on a hard offset shadow. Name, role and talk below.",
      props: {
        name: p.text("SpName", "Hana Sato"),
        role: p.text("SpRole", "Principal designer, Northwind Maps"),
        talk: p.text("SpTalk", "Maps for people who are lost and in a hurry"),
        track: p.variants({
          main: { "SpDot.fill": c("lime") },
          studio: { "SpDot.fill": c("pink") },
        }),
        trackLabel: p.text("SpTrack", "Main stage"),
        tone: p.variants(Object.fromEntries(TONES.map((t) => [t, toneVars(t)]))),
        initials: p.text("PsInit", "HS"),
      },
      root: { dir: "column", w: cols(3), gap: s(4) },
    },
    (root) => {
      const field = b.col(root, "Portrait", {
        key: "PsField",
        w: FILL,
        h: 360,
        pad: [14, 16, 0, 16],
        justify: "between",
        stroke: { paint: ink, width: 2 },
        effects: b.shadow("offset"),
        clip: true,
        fill: c("lime"),
      })
      const trk = b.row(field, "Track", {
        gap: 8,
        align: "center",
        pad: [4, 8],
        radius: r("pill"),
        fill: c("bg"),
      })
      b.ellipse(trk, "Dot", {
        key: "SpDot",
        w: 12,
        h: 12,
        fill: c("lime"),
        stroke: { paint: ink, width: 1 },
      })
      b.text(trk, "Main stage", b.ty("mono", { case: "upper", size: 11 }), ink, { key: "SpTrack" })
      b.text(
        field,
        "HS",
        up("display", { size: 190, lineHeight: 0.68, letterSpacing: -10 }),
        c("on-lime"),
        {
          key: "PsInit",
          name: "Initials",
        },
      )
      const names = b.col(root, "Names", { w: FILL, gap: 4, pad: [8, 0, 0, 0] })
      b.text(names, "Hana Sato", up("heading", { size: 30, letterSpacing: -1.2 }), ink, {
        key: "SpName",
      })
      b.text(names, "Principal designer, Northwind Maps", b.ty("small"), muted, { key: "SpRole" })
      b.para(
        names,
        "Maps for people who are lost and in a hurry",
        b.ty("label", { size: 15, weight: 500 }),
        ink,
        { key: "SpTalk" },
      )
    },
  )

  const speakerChip = b.component(
    "Speaker chip",
    {
      key: "Chip",
      section: "People",
      description:
        "Round flat portrait with initials, the name set in two lines, then role and track.",
      props: {
        first: p.text("ChFirst", "Hana"),
        last: p.text("ChLast", "Sato"),
        role: p.text("ChRole", "Northwind Maps"),
        initials: p.text("ChInit", "HS"),
        tone: p.variants({
          lime: { "ChDot.fill": c("lime"), "ChInit.fill": c("on-lime") },
          pink: { "ChDot.fill": c("pink"), "ChInit.fill": c("on-pink") },
          blue: { "ChDot.fill": c("blue"), "ChInit.fill": c("on-blue") },
          ink: { "ChDot.fill": ink, "ChInit.fill": c("bg") },
        }),
      },
      root: {
        dir: "row",
        w: cols(4),
        gap: 18,
        align: "center",
        pad: [0, 0, 20, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const dot = b.row(root, "Portrait", {
        key: "ChDot",
        w: 112,
        h: 112,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("lime"),
      })
      b.text(dot, "HS", up("h1", { size: 44, letterSpacing: -2 }), c("on-lime"), {
        key: "ChInit",
        name: "Initials",
      })
      const t = b.col(root, "Text", { gap: 6 })
      const n = b.col(t, "Name", { gap: 0 })
      b.text(
        n,
        "Hana",
        up("heading", { size: 36, lineHeight: 0.9, letterSpacing: -1.6 }),
        c("accent"),
        { key: "ChFirst" },
      )
      b.text(
        n,
        "Sato",
        up("heading", { size: 36, lineHeight: 0.9, letterSpacing: -1.6 }),
        c("accent"),
        { key: "ChLast" },
      )
      b.text(t, "Northwind Maps", b.ty("small", { weight: 500 }), muted, { key: "ChRole" })
    },
  )

  // --- Schedule --------------------------------------------------------------------------------------

  const session = b.component(
    "Session",
    {
      key: "Ses",
      section: "Schedule",
      description:
        "One talk in the schedule: a track-coloured edge, format, title, then speaker and time.",
      props: {
        format: p.text("SsFormat", "Keynote"),
        title: p.text("SsTitle", "Maps for people who are lost and in a hurry"),
        speaker: p.text("SsSpeaker", "Hana Sato"),
        role: p.text("SsRole", "Principal designer, Northwind Maps"),
        time: p.text("SsTime", "09:30 to 10:15"),
        track: p.variants({
          main: { "root.stroke": { paint: c("lime"), width: { l: 8 } } },
          studio: { "root.stroke": { paint: c("pink"), width: { l: 8 } } },
        }),
      },
      root: {
        dir: "column",
        w: cols(5),
        gap: s(3),
        pad: [18, 20, 18, 24],
        fill: c("surface"),
        stroke: { paint: c("lime"), width: { l: 8 } },
      },
    },
    (root) => {
      const top = b.row(root, "Meta", { w: FILL, gap: 10, align: "center" })
      b.text(top, "Keynote", mono, ink, { key: "SsFormat" })
      b.text(top, "09:30 to 10:15", mono, muted, { key: "SsTime" })
      b.para(
        root,
        "Maps for people who are lost and in a hurry",
        b.ty("title", { size: 26, letterSpacing: -0.9 }),
        ink,
        { key: "SsTitle" },
      )
      const who = b.row(root, "Speaker", { w: FILL, gap: 8, align: "baseline" })
      b.text(who, "Hana Sato", b.ty("label", { weight: 700 }), ink, { key: "SsSpeaker" })
      b.text(who, "Principal designer, Northwind Maps", b.ty("small"), muted, { key: "SsRole" })
    },
  )

  const breakRow = b.component(
    "Break row",
    {
      key: "Break",
      section: "Schedule",
      description: "A pause across both tracks: time, label and where.",
      props: {
        time: p.text("BrTime", "11:15"),
        label: p.text("BrLabel", "Coffee break"),
        note: p.text("BrNote", "Main hall and pier"),
      },
      root: { dir: "row", w: 1344, gap: GUT, align: "center", pad: [14, 0], stroke: hair },
    },
    (root) => {
      b.text(root, "11:15", b.ty("mono", { size: 18, weight: 500 }), muted, {
        key: "BrTime",
        w: cols(2),
        grow: "fixed-width",
      })
      b.text(
        root,
        "Coffee break",
        b.ty("label", { size: 16, weight: 700, case: "upper", letterSpacing: 0.4 }),
        ink,
        { key: "BrLabel" },
      )
      b.text(root, "Main hall and pier", b.ty("small"), muted, { key: "BrNote" })
    },
  )

  const timeCell = b.component(
    "Time",
    {
      key: "TimeCell",
      section: "Schedule",
      description: "Start time set large in mono, with the time zone beneath.",
      props: { time: p.text("TcTime", "09:30") },
      root: { dir: "column", w: cols(2), gap: 2, pad: [4, 0, 0, 0] },
    },
    (root) => {
      b.text(root, "09:30", b.ty("h1", { size: 44, letterSpacing: -1.6 }), ink, { key: "TcTime" })
      b.text(root, "CEST", mono, muted)
    },
  )

  // --- Tickets ---------------------------------------------------------------------------------------

  const checkItem = b.component(
    "Check item",
    {
      key: "Check",
      section: "Tickets",
      description: "A line in a ticket's list. Excluded lines are muted and struck out.",
      props: {
        label: p.text("CkLabel", "Both days, both tracks"),
        state: p.variants({
          included: {
            "CkIcon.icon": "check",
            "CkIcon.color": ink,
            "CkLabel.fill": ink,
            "CkLabel.style/decoration": [],
          },
          excluded: {
            "CkIcon.icon": "minus",
            "CkIcon.color": muted,
            "CkLabel.fill": muted,
            "CkLabel.style/decoration": ["strike"],
          },
          onLime: {
            "CkIcon.icon": "check",
            "CkIcon.color": c("on-lime"),
            "CkLabel.fill": c("on-lime"),
            "CkLabel.style/decoration": [],
          },
        }),
      },
      root: { dir: "row", w: 360, gap: 10, align: "start" },
    },
    (root) => {
      b.icon(root, "check", 18, ink, { key: "CkIcon" })
      b.text(root, "Both days, both tracks", b.ty("label", { size: 15, weight: 500 }), ink, {
        key: "CkLabel",
        w: FILL,
        grow: "fixed-width",
      })
    },
  )

  const TIER_TONES = {
    soldout: {
      "root.fill": c("subtle"),
      "TkName.fill": muted,
      "TkPrice.fill": muted,
      "TkNote.fill": muted,
      "TkDesc.fill": muted,
      "TkPrice.style/decoration": ["strike"],
      "TkList.stroke": { paint: ink, width: { t: 1 } },
    },
    featured: {
      "root.fill": c("lime"),
      "TkName.fill": c("on-lime"),
      "TkPrice.fill": c("on-lime"),
      "TkNote.fill": c("on-lime"),
      "TkDesc.fill": c("on-lime"),
      "TkPrice.style/decoration": [],
      "TkList.stroke": { paint: c("on-lime"), width: { t: 1 } },
    },
    standard: {
      "root.fill": c("surface"),
      "TkName.fill": ink,
      "TkPrice.fill": ink,
      "TkNote.fill": muted,
      "TkDesc.fill": ink,
      "TkPrice.style/decoration": [],
      "TkList.stroke": { paint: ink, width: { t: 1 } },
    },
  }
  const ticket = b.component(
    "Ticket tier",
    {
      key: "Tk",
      section: "Tickets",
      description:
        "A ticket tier: name, huge price, note, a list slot and the call to action. Lime is the featured tier.",
      props: {
        name: p.text("TkName", "Standard"),
        price: p.text("TkPrice", "€590"),
        note: p.text("TkNote", "€690 from 1 March. Excl. 25% VAT"),
        description: p.text("TkDesc", "For designers, researchers and design engineers."),
        ctaLabel: p.text("TkCta/BtnLabel", "Buy ticket"),
        tone: p.variants(TIER_TONES),
        list: p.slot("TkList"),
      },
      root: {
        dir: "column",
        w: cols(4),
        gap: s(5),
        pad: [28, 28, 32, 28],
        fill: c("surface"),
        stroke: { paint: ink, width: 2 },
        effects: b.shadow("offset"),
      },
    },
    (root) => {
      b.text(root, "Standard", up("h1", { size: 24, letterSpacing: -0.6, weight: 800 }), ink, {
        key: "TkName",
      })
      const pr = b.col(root, "Price", { w: FILL, gap: 4 })
      b.text(pr, "€590", up("display", { size: 96, letterSpacing: -5.4 }), ink, { key: "TkPrice" })
      b.text(pr, "€690 from 1 March. Excl. 25% VAT", b.ty("mono"), muted, { key: "TkNote" })
      b.para(
        root,
        "For designers, researchers and design engineers.",
        b.ty("label", { size: 16, weight: 500 }),
        ink,
        { key: "TkDesc" },
      )
      b.row(root, "List", {
        key: "TkList",
        w: FILL,
        gap: 12,
        wrap: true,
        crossGap: 12,
        pad: [16, 0, 0, 0],
        stroke: rule,
        slot: { suggested: [checkItem] },
      })
      b.use(root, button, {
        key: "TkCta",
        props: { w: FILL },
        args: { label: "Buy ticket", variant: "ink", size: "lg" },
      })
    },
  )

  // --- Info ------------------------------------------------------------------------------------------

  const infoBlock = b.component(
    "Info block",
    {
      key: "Info",
      section: "Content",
      description:
        "Label, large value and a detail line on a heavy rule. Used for when, where and how to get there.",
      props: {
        label: p.text("IfLabel", "When"),
        value: p.text("IfValue", "Thursday 15 and Friday 16 April"),
        detail: p.text("IfDetail", "Doors open at 08:30, first talk at 09:30."),
      },
      root: {
        dir: "column",
        w: cols(4),
        gap: s(2),
        pad: [14, 0, 0, 0],
        stroke: { paint: ink, width: { t: 3 } },
      },
    },
    (root) => {
      b.text(root, "When", mono, muted, { key: "IfLabel" })
      b.para(
        root,
        "Thursday 15 and Friday 16 April",
        up("heading", { size: 32, letterSpacing: -1.2 }),
        ink,
        { key: "IfValue" },
      )
      b.para(root, "Doors open at 08:30, first talk at 09:30.", b.ty("body"), muted, {
        key: "IfDetail",
      })
    },
  )

  const tableRow = b.component(
    "Table row",
    {
      key: "TRow",
      section: "Content",
      description: "Four-column text row on a hairline: name, area, distance and price or time.",
      props: {
        a: p.text("TrA", "Hotel Nyhavn 17"),
        bb: p.text("TrB", "Nyhavn"),
        cc: p.text("TrC", "12 min by harbour bus"),
        dd: p.text("TrD", "€189"),
      },
      root: { dir: "row", w: 1344, gap: GUT, align: "center", pad: [18, 0], stroke: hair },
    },
    (root) => {
      b.text(root, "Hotel Nyhavn 17", b.ty("title", { size: 26, letterSpacing: -0.9 }), ink, {
        key: "TrA",
        w: cols(4),
        grow: "fixed-width",
      })
      b.text(root, "Nyhavn", b.ty("label", { weight: 500 }), muted, {
        key: "TrB",
        w: cols(3),
        grow: "fixed-width",
      })
      b.text(root, "12 min by harbour bus", b.ty("label", { weight: 500 }), ink, {
        key: "TrC",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(root, "€189", b.ty("title", { size: 26, letterSpacing: -0.9, align: "right" }), ink, {
        key: "TrD",
        w: cols(2),
        grow: "fixed-width",
      })
    },
  )

  const faq = b.component(
    "FAQ row",
    {
      key: "Faq",
      section: "Content",
      description: "A question on a rule. Open shows the answer and a minus.",
      props: {
        question: p.text("FqQ", "Can I come for one day only?"),
        answer: p.text("FqA", "Day passes go on sale on 1 March for €340 if seats are left."),
        state: p.variants({
          open: { "FqA.visible": true, "FqIcon.icon": "minus" },
          closed: { "FqA.visible": false, "FqIcon.icon": "plus" },
        }),
      },
      root: { dir: "column", w: 1344, gap: s(3), pad: [20, 0], stroke: rule },
    },
    (root) => {
      const q = b.row(root, "Question", { w: FILL, justify: "between", align: "center" })
      b.text(
        q,
        "Can I come for one day only?",
        b.ty("title", { size: 30, letterSpacing: -1.1 }),
        ink,
        { key: "FqQ" },
      )
      b.icon(q, "minus", 26, ink, { key: "FqIcon" })
      b.para(
        root,
        "Day passes go on sale on 1 March for €340 if seats are left. Most years they are gone within a week.",
        b.ty("body"),
        muted,
        { key: "FqA", w: cols(7), grow: "fixed-width" },
      )
    },
  )

  const stat = b.component(
    "Stat",
    {
      key: "Stat",
      section: "Content",
      description: "A number set huge in lime with its label beneath. Sits on night.",
      props: {
        value: p.text("StVal", "900"),
        label: p.text("StLbl", "designers, researchers and engineers"),
      },
      root: {
        dir: "column",
        w: cols(3),
        gap: s(2),
        pad: [16, 0, 16, 0],
        fill: c("night"),
        stroke: { paint: c("night-border"), width: { t: 1 } },
      },
    },
    (root) => {
      b.text(root, "900", up("display", { size: 132, letterSpacing: -7 }), c("lime"), {
        key: "StVal",
      })
      b.para(
        root,
        "designers, researchers and engineers",
        b.ty("label", { size: 16, weight: 500 }),
        c("on-night"),
        { key: "StLbl" },
      )
    },
  )

  // --- Data ------------------------------------------------------------------------------------------

  interface Speaker {
    name: string
    first: string
    last: string
    initials: string
    org: string
    role: string
    talk: string
    tone: Tone
    track: Track
  }
  const sp: Record<string, Speaker> = {
    HS: {
      name: "Hana Sato",
      first: "Hana",
      last: "Sato",
      initials: "HS",
      org: "Northwind Maps",
      role: "Principal designer, Northwind Maps",
      talk: "Maps for people who are lost and in a hurry",
      tone: "lime",
      track: "main",
    },
    MJ: {
      name: "Malik Johnson",
      first: "Malik",
      last: "Johnson",
      initials: "MJ",
      org: "Parcelly",
      role: "Head of design, Parcelly",
      talk: "One design system, 40 teams and no mandate",
      tone: "blue",
      track: "main",
    },
    EP: {
      name: "Elena Petrova",
      first: "Elena",
      last: "Petrova",
      initials: "EP",
      org: "Quill Health",
      role: "Staff researcher, Quill Health",
      talk: "Research operations on a team of two",
      tone: "pink",
      track: "studio",
    },
    JL: {
      name: "Jonas Lindqvist",
      first: "Jonas",
      last: "Lindqvist",
      initials: "JL",
      org: "Fable Bank",
      role: "Design engineer, Fable Bank",
      talk: "Prototyping in production code",
      tone: "ink",
      track: "studio",
    },
    PN: {
      name: "Priya Nair",
      first: "Priya",
      last: "Nair",
      initials: "PN",
      org: "Tandem",
      role: "VP product design, Tandem",
      talk: "Pricing pages are product design",
      tone: "pink",
      track: "main",
    },
    CD: {
      name: "Camille Dubois",
      first: "Camille",
      last: "Dubois",
      initials: "CD",
      org: "Ledger & Co.",
      role: "Accessibility lead, Ledger & Co.",
      talk: "Screen reader testing in every sprint",
      tone: "paper",
      track: "main",
    },
    DR: {
      name: "Diego Romero",
      first: "Diego",
      last: "Romero",
      initials: "DR",
      org: "Field Type",
      role: "Founder, Field Type",
      talk: "Variable fonts in product interfaces",
      tone: "lime",
      track: "studio",
    },
    AT: {
      name: "Aiko Tanaka",
      first: "Aiko",
      last: "Tanaka",
      initials: "AT",
      org: "Orbit",
      role: "Design manager, Orbit",
      talk: "Design critique people look forward to",
      tone: "blue",
      track: "studio",
    },
    KM: {
      name: "Kwame Mensah",
      first: "Kwame",
      last: "Mensah",
      initials: "KM",
      org: "Bolt Freight",
      role: "Director of design, Bolt Freight",
      talk: "Dashboards for the 6 a.m. shift",
      tone: "ink",
      track: "main",
    },
    SO: {
      name: "Sam O'Connell",
      first: "Sam",
      last: "O'Connell",
      initials: "SO",
      org: "Harbor",
      role: "Product designer, Harbor",
      talk: "Designing for slow networks in 2027",
      tone: "paper",
      track: "studio",
    },
    FH: {
      name: "Freya Holm",
      first: "Freya",
      last: "Holm",
      initials: "FH",
      org: "Studio Nord",
      role: "Creative director, Studio Nord",
      talk: "Motion specs developers can build",
      tone: "pink",
      track: "main",
    },
    LF: {
      name: "Lea Fischer",
      first: "Lea",
      last: "Fischer",
      initials: "LF",
      org: "Kino",
      role: "Content designer, Kino",
      talk: "Workshop: writing interface copy as a team",
      tone: "lime",
      track: "studio",
    },
  }
  const order = ["HS", "MJ", "PN", "CD", "KM", "FH", "EP", "JL", "DR", "AT", "SO", "LF"] as const

  function speakerUse(parent: string, key: string) {
    const x = sp[key] as Speaker
    return b.use(parent, speakerCard, {
      args: {
        name: x.name,
        role: x.role,
        talk: x.talk,
        track: x.track,
        trackLabel: x.track === "main" ? "Main stage" : "Studio",
        tone: x.tone,
        initials: x.initials,
      },
    })
  }
  function chipUse(parent: string, key: string) {
    const x = sp[key] as Speaker
    const tone = x.tone === "paper" ? "ink" : x.tone
    return b.use(parent, speakerChip, {
      args: {
        first: x.first,
        last: x.last,
        role: `${x.org}, ${x.track === "main" ? "main stage" : "Studio"}`,
        initials: x.initials,
        tone,
      },
    })
  }
  function sessionUse(parent: string, key: string, time: string, format = "Talk") {
    const x = sp[key] as Speaker
    return b.use(parent, session, {
      props: { w: FILL },
      args: { format, title: x.talk, speaker: x.name, role: x.role, time, track: x.track },
    })
  }

  // --- Cover -----------------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Conference template",
    title: "Offset conference site",
    description:
      "A poster-style site for a two-day product design conference: home, speakers, a two-track schedule, a speaker page, tickets and venue. Flat colour fields stand in for photography.",
    preview: (area) => {
      const hero = b.col(area, "Hero", {
        w: FILL,
        h: FILL,
        gap: s(5),
        pad: [28, 28, 28, 28],
        fill: c("blue"),
        radius: r("sm"),
        clip: true,
        justify: "between",
      })
      const top = b.row(hero, "Top", { w: FILL, justify: "between" })
      b.text(top, "15 and 16 April 2027", mono, c("on-blue"))
      b.text(top, "Copenhagen", mono, c("on-blue"))
      wordmark(hero, 160, c("on-blue"), c("lime"))
      const bot = b.row(hero, "Bottom", { w: FILL, justify: "between", align: "end" })
      b.para(
        bot,
        "Two days, two tracks, 24 talks on the craft of product design.",
        b.ty("lead", { size: 22 }),
        c("on-blue"),
        { w: 260, grow: "fixed-width" },
      )
      b.use(bot, button, { args: { label: "Get tickets", size: "lg" } })
    },
  })

  // --- Screens ---------------------------------------------------------------------------------------

  const desktop = b.page("Screens")
  function page(
    name: string,
    active: "home" | "speakers" | "schedule" | "tickets" | "venue",
    tone: "page" | "blue" = "page",
  ) {
    const scr = b.screen(desktop, name, { w: 1440, fill: c("bg") })
    if (tone === "page") b.use(scr, navBar, { args: { active, tone } })
    return scr
  }
  /** Page title block: mono label, huge title and a short line on the right. */
  function pageHead(scr: string, label: string, title: string, sub: string, size = 220) {
    const head = b.col(scr, "Title", { w: FILL, gap: s(4), pad: [48, 48, 0, 48] })
    b.text(head, label, mono, ink)
    b.text(head, title, up("display", { size, letterSpacing: -size * 0.052 }), ink)
    const row = b.row(head, "Intro", { w: FILL, gap: GUT, align: "start" })
    b.text(row, "", mono, ink, { visible: false, name: "Spacer", w: cols(3), grow: "fixed-width" })
    b.para(row, sub, b.ty("lead", { size: 26, letterSpacing: -0.9, weight: 500 }), ink, {
      w: cols(6),
      grow: "fixed-width",
    })
    return head
  }

  // Home
  {
    const scr = b.screen(desktop, "Home", { w: 1440, fill: c("blue") })
    b.use(scr, navBar, { args: { active: "home", tone: "blue" } })
    const hero = b.col(scr, "Hero", { w: FILL, gap: s(10), pad: [28, 48, 56, 48] })
    const meta = b.row(hero, "Meta", { w: FILL, justify: "between" })
    b.text(meta, "A conference on the craft of product design", mono, c("on-blue"))
    b.text(meta, "Copenhagen, Denmark", mono, c("on-blue"))
    wordmark(hero, 350, c("on-blue"), c("lime"))
    const bottom = b.row(hero, "Bottom", { w: FILL, gap: GUT, align: "end", justify: "between" })
    const left = b.col(bottom, "Pitch", { w: cols(5), gap: s(5) })
    b.para(
      left,
      "Two days, two tracks and 24 talks by designers who ship. No sponsor slots on stage.",
      b.ty("lead", { size: 32, letterSpacing: -1.2 }),
      c("on-blue"),
    )
    const acts = b.row(left, "Actions", { gap: s(3), align: "center" })
    b.use(acts, button, { args: { label: "Get tickets", size: "lg", icon: true } })
    b.use(acts, button, { args: { label: "See the schedule", size: "lg", variant: "ghost" } })
    const when = b.col(bottom, "When", { w: cols(4), gap: s(4), align: "start" })
    b.para(
      when,
      "15 and 16 April 2027, Copenhagen",
      up("heading", { size: 44, letterSpacing: -2 }),
      c("lime"),
    )
    b.use(when, countdown, {})
    b.use(scr, ticker, {})

    // Lineup
    const lineup = b.col(scr, "Lineup", {
      w: FILL,
      gap: s(10),
      pad: [96, 48, 96, 48],
      fill: c("bg"),
    })
    const lh = b.row(lineup, "Header", { w: FILL, gap: GUT, align: "end", justify: "between" })
    const lt = b.col(lh, "Title", { w: cols(9), gap: s(3) })
    b.text(lt, "(01) Lineup", mono, ink)
    b.para(
      lt,
      "12 speakers announced, 12 to come",
      up("display", { size: 96, letterSpacing: -5 }),
      ink,
      { w: cols(9), grow: "fixed-width" },
    )
    b.use(lh, buttonOutline, { args: { label: "All speakers", icon: true } })
    for (let i = 0; i < 4; i++) {
      const row = b.row(lineup, `Row ${i + 1}`, { w: FILL, gap: GUT })
      for (const k of order.slice(i * 3, i * 3 + 3)) chipUse(row, k)
    }

    // Schedule teaser
    const plan = b.col(scr, "Schedule", { w: FILL, gap: s(10), pad: [96, 48], fill: c("subtle") })
    const ph = b.row(plan, "Header", { w: FILL, align: "end", justify: "between" })
    const pt = b.col(ph, "Title", { gap: s(3) })
    b.text(pt, "(02) Two tracks, one building", mono, ink)
    b.text(pt, "Thursday morning", up("display", { size: 96, letterSpacing: -5 }), ink)
    b.use(ph, buttonOutline, { args: { label: "Full schedule", icon: true } })
    const tr = b.row(plan, "Tracks", { w: FILL, gap: GUT, align: "start" })
    for (const [track, label, picks] of [
      [
        "main",
        "Main stage, hall A",
        [
          ["HS", "09:30 to 10:15", "Keynote"],
          ["MJ", "10:30 to 11:15", "Talk"],
          ["PN", "11:45 to 12:30", "Talk"],
        ],
      ],
      [
        "studio",
        "Studio, hall C",
        [
          ["LF", "09:30 to 11:00", "Workshop"],
          ["EP", "11:00 to 11:30", "Talk"],
          ["JL", "11:45 to 12:15", "Talk"],
        ],
      ],
    ] as const) {
      const col = b.col(tr, label, { w: FILL, gap: s(3) })
      const hd = b.row(col, "Track", { w: FILL, pad: [14, 20], fill: trackFill(track) })
      b.text(
        hd,
        label,
        b.ty("label", { size: 16, weight: 800, case: "upper", letterSpacing: 0.4 }),
        trackInk(track),
      )
      for (const [k, t, f] of picks) sessionUse(col, k, t, f)
    }

    // Numbers
    const nums = b.col(scr, "Numbers", { w: FILL, gap: s(8), pad: [96, 48], fill: c("night") })
    b.text(nums, "(03) Last year", mono, c("night-muted"))
    const nr = b.row(nums, "Stats", { w: FILL, gap: GUT })
    for (const [value, label] of [
      ["2", "days on the Copenhagen harbour"],
      ["24", "talks and workshops on two tracks"],
      ["900", "designers, researchers and engineers"],
      ["31", "countries on the attendee list"],
    ])
      b.use(nr, stat, { args: { value, label } })

    // Ticket band
    const buy = b.row(scr, "Tickets", {
      w: FILL,
      gap: GUT,
      pad: [72, 48],
      align: "end",
      justify: "between",
      fill: c("lime"),
    })
    const bt = b.col(buy, "Text", { gap: s(2) })
    b.text(bt, "(04) Tickets", b.ty("mono", { case: "upper" }), c("on-lime"))
    b.text(bt, "€590", up("display", { size: 240, letterSpacing: -13 }), c("on-lime"))
    const br = b.col(buy, "Right", { w: cols(4), gap: s(5), pad: [0, 0, 20, 0] })
    b.para(
      br,
      "Until 1 March, then €690. One ticket covers both days, food and the pier party.",
      b.ty("lead", { size: 28, letterSpacing: -1 }),
      c("on-lime"),
    )
    b.use(br, button, { args: { label: "Get tickets", size: "lg", variant: "ink", icon: true } })
    b.use(scr, footer)
  }

  // Speakers
  {
    const scr = page("Speakers", "speakers")
    pageHead(
      scr,
      "(Speakers) 12 of 24 announced",
      "Speakers",
      "Six on the main stage, six in the Studio. Every speaker gives one talk and joins the Friday Q&A.",
    )
    const filters = b.row(scr, "Filters", {
      w: FILL,
      gap: 10,
      pad: [40, 48, 32, 48],
      align: "center",
    })
    b.use(filters, tag, { args: { label: "All 12", tone: "ink" } })
    b.use(filters, tag, { args: { label: "Main stage 6", tone: "main" } })
    b.use(filters, tag, { args: { label: "Studio 6", tone: "studio" } })
    const grid = b.col(scr, "Grid", { w: FILL, gap: s(12), pad: [0, 48, 112, 48] })
    for (let i = 0; i < 3; i++) {
      const row = b.row(grid, `Row ${i + 1}`, { w: FILL, gap: GUT, align: "start" })
      for (const k of order.slice(i * 4, i * 4 + 4)) speakerUse(row, k)
    }
    b.use(scr, ticker, { args: { tone: "ink" } })
    b.use(scr, footer)
  }

  // Schedule
  {
    const scr = page("Schedule", "schedule")
    pageHead(
      scr,
      "(Schedule) Thursday 15 April",
      "Schedule",
      "Doors open at 08:30. All times are Copenhagen time (CEST). Workshops need a seat, booked from your ticket page in March.",
    )
    const bar = b.row(scr, "Controls", { w: FILL, gap: 10, pad: [40, 48, 32, 48], align: "center" })
    b.use(bar, button, { args: { label: "Thursday 15 April", variant: "ink" } })
    b.use(bar, buttonOutline, { args: { label: "Friday 16 April" } })
    const legend = b.row(bar, "Legend", { w: FILL, gap: 10, justify: "end" })
    b.use(legend, tag, { args: { label: "Main stage, hall A", tone: "main" } })
    b.use(legend, tag, { args: { label: "Studio, hall C", tone: "studio" } })

    const grid = b.col(scr, "Program", { w: FILL, gap: 0, pad: [0, 48, 112, 48] })
    const heads = b.row(grid, "Track heads", { w: FILL, gap: GUT, pad: [0, 0, 12, 0] })
    b.text(heads, "Time", mono, muted, { w: cols(2), grow: "fixed-width" })
    b.text(heads, "Main stage, hall A", mono, ink, { w: 546, grow: "fixed-width" })
    b.text(heads, "Studio, hall C", mono, ink, { w: 546, grow: "fixed-width" })
    const pause = (time: string, label: string, note: string) =>
      b.use(grid, breakRow, { props: { w: FILL }, args: { time, label, note } })
    const slot = (
      time: string,
      main: [string, string, string?],
      studio: [string, string, string?],
    ) => {
      const row = b.row(grid, time, {
        w: FILL,
        gap: GUT,
        align: "start",
        pad: [20, 0],
        stroke: hair,
      })
      b.use(row, timeCell, { args: { time } })
      const m = b.col(row, "Main", { w: 546 })
      sessionUse(m, main[0], main[1], main[2])
      const st = b.col(row, "Studio", { w: 546 })
      sessionUse(st, studio[0], studio[1], studio[2])
    }
    pause("08:30", "Registration, coffee and pastries", "Main hall")
    slot("09:30", ["HS", "09:30 to 10:15", "Keynote"], ["LF", "09:30 to 11:00", "Workshop"])
    slot("10:30", ["MJ", "10:30 to 11:15"], ["EP", "11:00 to 11:30"])
    pause("11:15", "Coffee break", "Main hall and pier")
    slot("11:45", ["PN", "11:45 to 12:30"], ["JL", "11:45 to 12:15"])
    pause("12:30", "Lunch", "Food hall, vegetarian and vegan")
    slot("13:45", ["CD", "13:45 to 14:30"], ["DR", "13:45 to 14:15"])
    slot("14:30", ["KM", "14:30 to 15:15"], ["AT", "14:30 to 15:30", "Workshop"])
    pause("17:00", "Drinks on the pier", "Until 20:00, bring a jacket")
    b.use(scr, footer)
  }

  // Speaker detail
  {
    const scr = page("Speaker detail", "speakers")
    const x = sp.HS as Speaker
    const back = b.row(scr, "Back", { w: FILL, gap: 8, pad: [40, 48, 0, 48], align: "center" })
    b.icon(back, "arrow-left", 16, ink)
    b.text(back, "All speakers", b.ty("label", { weight: 600 }), ink)
    const head = b.row(scr, "Name", {
      w: FILL,
      gap: GUT,
      pad: [24, 48, 0, 48],
      align: "end",
      justify: "between",
    })
    const nm = b.col(head, "Name", { gap: 0 })
    b.text(nm, "Hana", up("display", { size: 260, lineHeight: 0.84, letterSpacing: -14 }), ink)
    b.text(
      nm,
      "Sato",
      up("display", { size: 260, lineHeight: 0.84, letterSpacing: -14 }),
      c("accent"),
    )
    const meta = b.col(head, "Meta", { w: cols(4), gap: s(3), pad: [0, 0, 24, 0] })
    b.use(meta, tag, { args: { label: "Keynote, main stage", tone: "main" } })
    b.para(meta, x.role, b.ty("lead", { size: 26, letterSpacing: -0.9 }), ink)

    const body = b.row(scr, "Profile", { w: FILL, gap: GUT, pad: [56, 48, 0, 48], align: "start" })
    b.use(body, speakerCard, {
      props: { w: cols(4) },
      args: {
        name: x.name,
        role: x.org,
        talk: "Thursday 15 April, 09:30",
        track: x.track,
        trackLabel: "Main stage",
        tone: x.tone,
        initials: x.initials,
      },
    })
    const info = b.col(body, "Info", { w: FILL, gap: s(6), pad: [0, 0, 0, GUT * 2] })
    b.para(
      info,
      "Hana leads design for navigation at Northwind Maps, where her team of 14 works on routing, search and offline maps used by 60 million people a month. Before that she designed ticket machines for the Tokyo Metro, which she still calls the hardest interface she has worked on.",
      b.ty("lead", { size: 28, letterSpacing: -0.9, weight: 500 }),
      ink,
    )
    b.para(
      info,
      "She lives in Malmö and commutes to Copenhagen, usually with the app open to see if it gets the train right.",
      b.ty("body", { size: 18 }),
      muted,
    )
    const links = b.row(info, "Links", { gap: s(6), align: "center" })
    for (const [icon, label] of [
      ["globe", "hanasato.design"],
      ["link", "LinkedIn"],
      ["mic", "2025 talk recording"],
    ] as const) {
      const l = b.row(links, label, { gap: 6, align: "center" })
      b.icon(l, icon, 16, c("accent"))
      b.text(l, label, b.ty("label", { decoration: ["underline"] }), c("accent"))
    }

    const talk = b.col(scr, "Talk", { w: FILL, gap: s(8), pad: [56, 48, 64, 48] })
    const card = b.col(talk, "Talk card", {
      w: FILL,
      gap: s(6),
      pad: [40, 48],
      fill: c("blue"),
      stroke: { paint: ink, width: 2 },
      effects: b.shadow("offset"),
    })
    const tm = b.row(card, "Meta", { w: FILL, gap: s(6), align: "center" })
    for (const t of ["Thursday 15 April", "09:30 to 10:15", "Main stage, hall A"])
      b.text(tm, t, mono, c("on-blue"))
    b.para(card, x.talk, up("display", { size: 84, letterSpacing: -4.4 }), c("lime"))
    const tb = b.row(card, "Body", { w: FILL, gap: GUT, align: "end", justify: "between" })
    b.para(
      tb,
      "Most map users are not exploring. They are late, on a phone with 9% battery, and need the next turn. Hana walks through three years of research on stressed navigation, the features her team removed, and the one they had to put back.",
      b.ty("body", { size: 18 }),
      c("on-blue"),
      { w: cols(7), grow: "fixed-width" },
    )
    const ta = b.row(tb, "Actions", { gap: s(3) })
    b.use(ta, button, { args: { label: "Add to my schedule", icon: true, size: "lg" } })

    const more = b.col(scr, "Also speaking", {
      w: FILL,
      gap: s(10),
      pad: [80, 48, 96, 48],
      fill: c("subtle"),
    })
    b.text(more, "(Also on the main stage)", mono, ink)
    const mr = b.row(more, "Row", { w: FILL, gap: GUT })
    for (const k of ["MJ", "PN", "CD", "KM"]) speakerUse(mr, k)
    b.use(scr, footer)
  }

  // Tickets
  {
    const scr = page("Tickets", "tickets")
    pageHead(
      scr,
      "(Tickets) Prices go up on 1 March",
      "Tickets",
      "One ticket covers both days, both tracks, food and the Thursday pier party.",
    )
    const plans = b.row(scr, "Tiers", { w: FILL, gap: GUT, pad: [64, 48, 0, 48], align: "stretch" })
    for (const t of [
      {
        name: "Early bird",
        price: "€390",
        note: "Sold out on 12 December",
        desc: "The first 200 tickets, released with the speaker list.",
        tone: "soldout",
        cta: "Sold out",
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
        items: [
          ["Everything in Standard", true],
          ["Reserved table at lunch", true],
          ["One invoice with your PO number", true],
          ["Swap names until 1 April", true],
        ],
      },
    ] as const)
      b.use(plans, ticket, {
        args: {
          name: t.name,
          price: t.price,
          note: t.note,
          description: t.desc,
          tone: t.tone,
          ctaLabel: t.cta,
        },
        set: {
          TkCta: {
            args: { label: t.cta, variant: t.tone === "featured" ? "ink" : "outline", size: "lg" },
            props: { w: FILL },
          },
        },
        slots: {
          TkList: (into) => {
            for (const [label, yes] of t.items)
              b.use(into, checkItem, {
                props: { w: FILL },
                args: {
                  label,
                  state: yes ? (t.tone === "featured" ? "onLime" : "included") : "excluded",
                },
              })
          },
        },
      })

    const notes = b.row(scr, "Notes", { w: FILL, gap: GUT, pad: [96, 48, 0, 48], align: "start" })
    for (const [label, value, detail] of [
      [
        "Scholarships",
        "40 free tickets",
        "For students and people between jobs. Apply by 15 February.",
      ],
      [
        "Invoices",
        "Pay by card or invoice",
        "Invoices are due in 30 days and list the VAT for your company.",
      ],
      [
        "Refunds",
        "Full refund until 1 March",
        "After that, transfer your ticket to a colleague for free.",
      ],
    ])
      b.use(notes, infoBlock, { args: { label, value, detail } })

    const qs = b.col(scr, "FAQ", { w: FILL, gap: s(8), pad: [112, 48, 112, 48] })
    b.text(qs, "(Questions about tickets)", mono, ink)
    const list = b.col(qs, "Items", { w: FILL, gap: 0 })
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
      b.use(list, faq, {
        props: { w: FILL },
        args: { question, answer, state: i < 2 ? "open" : "closed" },
      })
    b.rect(list, "Rule", { w: FILL, h: 1, fill: ink })
    b.use(scr, footer)
  }

  // Venue and travel
  {
    const scr = page("Venue and travel", "venue")
    pageHead(
      scr,
      "(Venue and travel) Refshaleøen",
      "Dok 4",
      "A former shipyard hall at the north end of the harbour, 15 minutes from the city centre by harbour bus.",
      300,
    )

    const info = b.row(scr, "Info", { w: FILL, gap: GUT, pad: [56, 48, 0, 48], align: "start" })
    b.use(info, infoBlock, {
      args: {
        label: "Where",
        value: "Refshalevej 163, 1432 Copenhagen K",
        detail: "Enter through the north gate.",
      },
    })
    b.use(info, infoBlock, {
      args: {
        label: "When",
        value: "15 and 16 April 2027",
        detail: "Doors open at 08:30, first talk at 09:30.",
      },
    })
    b.use(info, infoBlock, {
      args: {
        label: "Access",
        value: "Step-free, hearing loop",
        detail: "Live captions on both stages.",
      },
    })

    // Map: flat shapes, a harbour on the left and the hall on the peninsula.
    const mapWrap = b.col(scr, "Map", { w: FILL, pad: [56, 48, 0, 48] })
    const map = b.row(mapWrap, "Refshaleøen", {
      w: FILL,
      h: 560,
      fill: c("map-land"),
      stroke: { paint: ink, width: 2 },
      clip: true,
    })
    const water = b.col(map, "Harbour", {
      w: cols(4),
      h: FILL,
      fill: c("map-water"),
      pad: 28,
      justify: "end",
    })
    b.text(water, "Øresund", mono, ink)
    const land = b.col(map, "Land", {
      w: FILL,
      h: FILL,
      pad: [48, 48, 48, 72],
      gap: 20,
      justify: "center",
    })
    const r1 = b.row(land, "Blocks", { w: FILL, gap: 20 })
    b.rect(r1, "Block", { w: cols(2), h: 96, fill: c("map-block") })
    b.rect(r1, "Park", { w: FILL, h: 96, fill: c("map-park") })
    b.rect(r1, "Block", { w: cols(3), h: 96, fill: c("map-block") })
    const r2 = b.row(land, "Hall", { w: FILL, gap: 24, align: "center" })
    b.rect(r2, "Block", { w: cols(2), h: 110, fill: c("map-block") })
    const pin = b.row(r2, "Dok 4", {
      gap: 14,
      align: "center",
      pad: [14, 22],
      fill: c("lime"),
      stroke: { paint: ink, width: 3 },
      effects: b.shadow("offset"),
    })
    b.ellipse(pin, "Pin", { w: 22, h: 22, stroke: { paint: ink, width: 5 } })
    b.text(pin, "Dok 4", up("h1", { size: 40, letterSpacing: -1.6 }), c("on-lime"))
    b.rect(r2, "Block", { w: FILL, h: 110, fill: c("map-block") })
    const r3 = b.row(land, "Blocks", { w: FILL, gap: 20 })
    b.rect(r3, "Park", { w: cols(3), h: 80, fill: c("map-park") })
    b.rect(r3, "Block", { w: FILL, h: 80, fill: c("map-block") })
    const route = b.row(land, "Route", { w: FILL, gap: 12, align: "center", pad: [8, 0, 0, 0] })
    b.ellipse(route, "Stop", { w: 22, h: 22, fill: c("bg"), stroke: { paint: ink, width: 4 } })
    b.text(route, "Nyhavn", mono, ink)
    b.rect(route, "Line", { w: FILL, h: 10, fill: c("blue") })
    b.text(route, "Bus 991, 15 min", mono, ink)
    b.rect(route, "Line", { w: 48, h: 10, fill: c("blue") })
    b.ellipse(route, "Stop", { w: 22, h: 22, fill: c("lime"), stroke: { paint: ink, width: 4 } })
    b.text(route, "Refshaleøen", mono, ink)

    const how = b.col(scr, "Getting there", { w: FILL, gap: s(8), pad: [112, 48, 0, 48] })
    b.text(how, "(Getting there)", mono, ink)
    const hl = b.col(how, "Rows", { w: FILL, gap: 0 })
    for (const [a, bb, cc, dd] of [
      ["Harbour bus", "Line 991 or 992", "Every 20 min from Nyhavn", "15 min"],
      ["From the airport", "Metro M2, then walk", "To Kongens Nytorv, then Nyhavn", "25 min"],
      ["By bike", "City bikes dock at Refshaleøen", "Free parking at the door", "20 min"],
      ["By car", "Refshalevej 163", "Paid parking, 40 spaces", "20 min"],
    ])
      b.use(hl, tableRow, { props: { w: FILL }, args: { a, bb, cc, dd } })
    b.rect(hl, "Rule", { w: FILL, h: 1, fill: c("border") })

    const stay = b.col(scr, "Hotels", { w: FILL, gap: s(8), pad: [112, 48, 112, 48] })
    const sh = b.row(stay, "Header", { w: FILL, justify: "between", align: "end" })
    b.text(sh, "(Where to stay) Conference rate, code OFFSET27", mono, ink)
    b.text(sh, "Book before 1 March", mono, muted)
    const sl = b.col(stay, "Rows", { w: FILL, gap: 0 })
    for (const [a, bb, cc, dd] of [
      ["Hotel Nyhavn 17", "Nyhavn", "12 min by harbour bus", "€189"],
      ["Kanal Rooms", "Christianshavn", "18 min by bike", "€154"],
      ["Værft Hostel", "Refshaleøen", "4 min walk", "€72"],
    ])
      b.use(sl, tableRow, { props: { w: FILL }, args: { a, bb, cc, dd } })
    b.rect(sl, "Rule", { w: FILL, h: 1, fill: c("border") })
    b.use(scr, footer)
  }
  void fill
}
