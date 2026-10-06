/**
 * Brisk: the iPhone app of a fictional strength and habit coach.
 * Screens (390×844): Onboarding, Today, Workout detail, Workout in progress (dark), Progress
 * (dark), Profile.
 *
 * Built against Apple Fitness (small mono units beside big numerals), WHOOP (one ring, one plain
 * coaching sentence), The Outsiders (dot-matrix training weeks), Ladder (rest timer, "next" card,
 * volt accent), Peloton Strength+ and Bevel (workout blocks, option rows) and Strava (label/value
 * triplets, best efforts). One accent (volt) used as a fill, never as text on paper; coral only for
 * effort. No gradients, no rings except the one on Today.
 */
import { FILL, fill, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "mobile-fitness",
  name: "Brisk fitness coach",
  category: "Mobile",
  description:
    "Six-screen iPhone app for a strength and habit coach: onboarding, today with one ring, workout detail, a rest timer, a dot-matrix progress view and profile.",
  prefix: "qf",
  build,
}

const W = 390
const H = 844
const CW = 350

// Training minutes per day, Monday first, for ISO weeks 36 to 41 of 2026. Today is Tuesday of W41.
const WEEKS: [string, number[]][] = [
  ["W36", [45, 0, 38, 0, 50, 62, 0]],
  ["W37", [52, 0, 44, 0, 48, 70, 0]],
  ["W38", [40, 0, 0, 36, 0, 55, 0]],
  ["W39", [50, 0, 46, 0, 0, 65, 30]],
  ["W40", [48, 0, 42, 0, 52, 75, 0]],
  ["W41", [40, 0, 0, 0, 0, 0, 0]],
]
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
const hm = (m: number) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`
const dot = (m: number) => (m === 0 ? 6 : Math.round(10 + (m / 75) * 18))

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F2F0E9", "#0B0B0A"],
      surface: ["#FFFFFF", "#161614"],
      subtle: ["#E7E4DA", "#21211E"],
      ink: ["#12110D", "#F3F1E8"],
      "ink-2": ["#3B3A33", "#C9C7BD"],
      muted: ["#6E6B60", "#8E8B80"],
      border: ["#DDD9CC", "#2A2A26"],
      volt: ["#D4F03A", "#D4F03A"],
      "on-volt": ["#12110D", "#12110D"],
      notch: ["#12110D", "#D4F03A"],
      accent: ["#12110D", "#D4F03A"],
      avatar: ["#12110D", "#D4F03A"],
      "on-avatar": ["#D4F03A", "#12110D"],
      coral: ["#D9442A", "#FF6B4A"],
      hero: ["#12110D", "#1B1B18"],
      "on-hero": ["#F3F1E8", "#F3F1E8"],
      "hero-muted": ["#9A9788", "#9A9788"],
      "hero-line": ["#2C2B25", "#2C2B25"],
      "ring-track": ["#34332C", "#34332C"],
      "on-ink-muted": ["#B9B6A8", "#5A584E"],
      dot: ["#12110D", "#D4F03A"],
      "dot-dim": ["#CFCABB", "#2F2F2A"],
      "toggle-on": ["#D4F03A", "#D4F03A"],
      "toggle-off": ["#CFCBBD", "#3A3A35"],
      "knob-on": ["#12110D", "#12110D"],
      "knob-off": ["#FFFFFF", "#C9C7BD"],
    },
    numbers: {
      "space/1": 4,
      "space/2": 8,
      "space/3": 12,
      "space/4": 16,
      "space/5": 20,
      "space/6": 24,
      "space/8": 32,
      "radius/sm": 8,
      "radius/md": 12,
      "radius/lg": 16,
      "radius/card": 24,
      "radius/pill": 999,
      "size/status": 47,
    },
    type: {
      display: { font: "Inter", size: 34, weight: 700, lineHeight: 1.1, letterSpacing: -1 },
      numeral: { font: "Inter", size: 72, weight: 700, lineHeight: 1, letterSpacing: -3.2 },
      timer: { font: "Inter", size: 124, weight: 700, lineHeight: 1, letterSpacing: -6 },
      metric: { font: "Inter", size: 28, weight: 700, lineHeight: 1.1, letterSpacing: -0.9 },
      heading: { font: "Inter", size: 17, weight: 600, lineHeight: 1.3, letterSpacing: -0.2 },
      body: { font: "Inter", size: 15, weight: 400, lineHeight: 1.45 },
      label: { font: "Inter", size: 15, weight: 600, lineHeight: 1.3, letterSpacing: -0.1 },
      small: { font: "Inter", size: 13, weight: 400, lineHeight: 1.4 },
      micro: { font: "Inter", size: 11, weight: 600, lineHeight: 1.3, letterSpacing: 1 },
      mono: { font: "JetBrains Mono", size: 12, weight: 500, lineHeight: 1.3, letterSpacing: 0.4 },
    },
    shadows: {
      phone: { kind: "shadow", x: 0, y: 24, blur: 48, spread: -12, color: "#12110D33" },
    },
  })

  const c = (n: string) => b.c(n)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  const overlay = { "kimo.template.overlay": true }

  // --- Components: system ------------------------------------------------------------------------

  const statusBar = b.component(
    "Status bar",
    {
      key: "Status",
      section: "System",
      description: "iOS status bar. Sits on the screen background.",
      props: { time: p.text("StTime", "9:41") },
      root: {
        dir: "row",
        w: W,
        h: b.n("size/status"),
        justify: "between",
        align: "center",
        pad: [0, 28, 0, 32],
      },
    },
    (root) => {
      b.text(root, "9:41", b.ty("label", { size: 16 }), ink, { key: "StTime", name: "Time" })
      const icons = b.row(root, "Icons", { gap: 6, align: "center" })
      b.icon(icons, "signal", 17, ink)
      b.icon(icons, "wifi", 17, ink)
      b.icon(icons, "battery-full", 24, ink)
    },
  )

  const homeBar = b.component(
    "Home indicator",
    {
      key: "HomeBar",
      section: "System",
      root: { dir: "row", w: W, h: 34, justify: "center", align: "center", pad: [0, 0, 4, 0] },
    },
    (root) => b.rect(root, "Bar", { w: 134, h: 5, radius: r("pill"), fill: ink }),
  )

  const tabsDef = [
    ["Today", "sun"],
    ["Train", "dumbbell"],
    ["Progress", "chart-no-axes-column"],
    ["Profile", "user-round"],
  ] as const
  const tabActive = (i: number) =>
    Object.fromEntries(
      tabsDef.flatMap((_, j) => [
        [`TbNotch${j + 1}.fill`, j === i ? c("notch") : c("surface")],
        [`TbIc${j + 1}.color`, j === i ? ink : muted],
        [`TbLb${j + 1}.fill`, j === i ? ink : muted],
      ]),
    )
  const tabBar = b.component(
    "Tab bar",
    {
      key: "TabBar",
      section: "System",
      description:
        "Four equal tabs (90pt each) and the home indicator. The active tab gets a notch above its icon.",
      props: {
        active: p.variants({
          today: tabActive(0),
          train: tabActive(1),
          progress: tabActive(2),
          profile: tabActive(3),
        }),
      },
      root: {
        dir: "column",
        w: W,
        fill: c("surface"),
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      const items = b.row(root, "Items", { w: FILL, pad: [0, 15] })
      tabsDef.forEach(([label, icon], i) => {
        const it = b.col(items, label, { w: 90, gap: 5, align: "center", pad: [0, 0, 4, 0] })
        b.rect(it, "Notch", {
          key: `TbNotch${i + 1}`,
          w: 24,
          h: 3,
          radius: 2,
          fill: i === 0 ? c("notch") : c("surface"),
        })
        b.icon(it, icon, 23, i === 0 ? ink : muted, { key: `TbIc${i + 1}` })
        b.text(it, label, b.ty("micro", { size: 10, letterSpacing: 0.2 }), i === 0 ? ink : muted, {
          key: `TbLb${i + 1}`,
        })
      })
      b.use(root, homeBar, { props: { w: FILL } })
    },
  )

  // --- Components: actions -----------------------------------------------------------------------

  const button = b.component(
    "Button",
    {
      key: "Btn",
      section: "Actions",
      description: "Volt, ink, outline or text; large or medium.",
      props: {
        label: p.text("BtnLabel", "Button"),
        icon: p.bool("BtnIcon", false),
        variant: p.variants({
          volt: {
            "root.fill": c("volt"),
            "root.stroke": { paint: c("volt") },
            "BtnLabel.fill": c("on-volt"),
            "BtnIcon.color": c("on-volt"),
          },
          ink: {
            "root.fill": ink,
            "root.stroke": { paint: ink },
            "BtnLabel.fill": c("bg"),
            "BtnIcon.color": c("bg"),
          },
          outline: {
            "root.fill": c("bg"),
            "root.stroke": { paint: c("border") },
            "BtnLabel.fill": ink,
            "BtnIcon.color": ink,
          },
          text: {
            "root.fill": c("bg"),
            "root.stroke": { paint: c("bg") },
            "BtnLabel.fill": c("ink-2"),
            "BtnIcon.color": c("ink-2"),
          },
        }),
        size: p.variants({
          lg: { "root.layout/pad": [18, 24], "BtnLabel.style/size": 16 },
          md: { "root.layout/pad": [10, 18], "BtnLabel.style/size": 14 },
        }),
      },
      root: {
        dir: "row",
        gap: 8,
        align: "center",
        justify: "center",
        pad: [18, 24],
        radius: r("pill"),
        fill: c("volt"),
        stroke: { paint: c("volt") },
      },
    },
    (root) => {
      b.icon(root, "play", 18, c("on-volt"), { key: "BtnIcon", visible: false })
      b.text(root, "Button", b.ty("label", { size: 16, weight: 700 }), c("on-volt"), {
        key: "BtnLabel",
        name: "Label",
      })
    },
  )

  const iconBtn = b.component(
    "Icon button",
    {
      key: "IconBtn",
      section: "Actions",
      props: {
        variant: p.variants({
          surface: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border") },
          },
          plain: {
            "root.fill": c("bg"),
            "root.stroke": { paint: c("bg") },
          },
        }),
      },
      root: {
        dir: "row",
        w: 40,
        h: 40,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      },
    },
    (root) => b.icon(root, "chevron-left", 20, ink, { key: "IbIcon" }),
  )

  const chip = b.component(
    "Chip",
    {
      key: "Chip",
      section: "Actions",
      description: "Range or filter chip. Ink when selected; mono label.",
      props: {
        label: p.text("ChLbl", "6W"),
        state: p.variants({
          default: {
            "root.fill": c("bg"),
            "root.stroke": { paint: c("border") },
            "ChLbl.fill": c("ink-2"),
          },
          selected: {
            "root.fill": c("volt"),
            "root.stroke": { paint: c("volt") },
            "ChLbl.fill": c("on-volt"),
          },
        }),
      },
      root: {
        dir: "row",
        pad: [6, 13],
        radius: r("pill"),
        fill: c("bg"),
        stroke: { paint: c("border") },
      },
    },
    (root) =>
      b.text(root, "6W", b.ty("mono", { size: 13, weight: 600 }), c("ink-2"), {
        key: "ChLbl",
        name: "Label",
      }),
  )

  const toggle = b.component(
    "Toggle",
    {
      key: "Toggle",
      section: "Actions",
      props: {
        state: p.variants({
          on: {
            "root.fill": c("toggle-on"),
            "root.layout/justify": "end",
            "TgKnob.fill": c("knob-on"),
          },
          off: {
            "root.fill": c("toggle-off"),
            "root.layout/justify": "start",
            "TgKnob.fill": c("knob-off"),
          },
        }),
      },
      root: {
        dir: "row",
        w: 51,
        h: 31,
        pad: 2,
        justify: "end",
        radius: r("pill"),
        fill: c("toggle-on"),
      },
    },
    (root) => b.ellipse(root, "Knob", { key: "TgKnob", w: 27, h: 27, fill: c("knob-on") }),
  )
  b.derive(toggle, "Toggle/Off", "ToggleOff", {
    section: "Actions",
    description: "Toggle preset in the off state.",
    args: { state: "off" },
  })

  // --- Components: navigation --------------------------------------------------------------------

  const navHeader = b.component(
    "Nav header",
    {
      key: "NavHead",
      section: "Navigation",
      description: "Pushed screen: back button and up to two trailing icon buttons.",
      props: {
        showBookmark: p.bool("NhA1", true),
        showMore: p.bool("NhA2", true),
      },
      root: { dir: "row", w: W, gap: 8, align: "center", pad: [4, 20] },
    },
    (root) => {
      b.use(root, iconBtn, { key: "NhBack", args: { variant: "surface" } })
      const acts = b.row(root, "Actions", { w: FILL, gap: 8, justify: "end" })
      const w1 = b.row(acts, "Bookmark", { key: "NhA1" })
      b.use(w1, iconBtn, { args: { variant: "surface" }, set: { IbIcon: { icon: "bookmark" } } })
      const w2 = b.row(acts, "More", { key: "NhA2" })
      b.use(w2, iconBtn, { args: { variant: "surface" }, set: { IbIcon: { icon: "ellipsis" } } })
    },
  )

  const sectionHead = b.component(
    "Section header",
    {
      key: "SecHead",
      section: "Navigation",
      description: "Tracked caps label with an optional action.",
      props: {
        title: p.text("ShTitle", "TODAY'S PLAN"),
        action: p.text("ShAct", "Edit"),
        showAction: p.bool("ShAct", true),
      },
      root: { dir: "row", w: CW, align: "center", justify: "between" },
    },
    (root) => {
      b.text(root, "TODAY'S PLAN", b.ty("micro"), muted, { key: "ShTitle", name: "Title" })
      b.text(root, "Edit", b.ty("small", { weight: 600 }), c("ink-2"), {
        key: "ShAct",
        name: "Action",
      })
    },
  )

  // --- Components: data --------------------------------------------------------------------------

  const stat = b.component(
    "Stat",
    {
      key: "Stat",
      section: "Data",
      description:
        "Caps label over a big numeral with a small mono unit (Apple Fitness). 116pt wide so triplets align.",
      props: {
        label: p.text("SttLbl", "DURATION"),
        value: p.text("SttVal", "45"),
        unit: p.text("SttUnit", "MIN"),
        tone: p.variants({
          default: { "SttLbl.fill": muted, "SttVal.fill": ink, "SttUnit.fill": muted },
          hero: {
            "SttLbl.fill": c("hero-muted"),
            "SttVal.fill": c("on-hero"),
            "SttUnit.fill": c("hero-muted"),
          },
        }),
      },
      root: { dir: "column", w: 116, gap: 6 },
    },
    (root) => {
      b.text(root, "DURATION", b.ty("micro"), muted, { key: "SttLbl" })
      const line = b.row(root, "Value", { align: "baseline", gap: 4 })
      b.text(line, "45", b.ty("metric"), ink, { key: "SttVal" })
      b.text(line, "MIN", b.ty("mono"), muted, { key: "SttUnit" })
    },
  )

  const ring = b.component(
    "Progress ring",
    {
      key: "Ring",
      section: "Data",
      description:
        "One thin ring, clockwise from 12 o'clock. Set RgArc sweepAngle to −3.6 × the percentage.",
      props: { value: p.text("RgVal", "72") },
      root: { dir: "row", w: 120, h: 120, align: "center", justify: "center" },
    },
    (root) => {
      const arc = {
        x: 0,
        y: 0,
        w: 120,
        h: 120,
        innerRadius: 0.88,
        position: "absolute",
        meta: overlay,
      }
      b.ellipse(root, "Track", { key: "RgTrack", ...arc, fill: c("ring-track") })
      b.ellipse(root, "Arc", {
        key: "RgArc",
        ...arc,
        startAngle: 90,
        sweepAngle: -259,
        fill: c("volt"),
      })
      const v = b.row(root, "Center", { align: "baseline", gap: 1 })
      b.text(v, "72", b.ty("metric", { size: 30 }), c("on-hero"), { key: "RgVal", name: "Value" })
      b.text(v, "%", b.ty("mono", { size: 13 }), c("hero-muted"))
    },
  )
  const sweep = (pct: number) => ({ RgArc: { sweepAngle: -Math.round(pct * 3.6) } })

  const weekRow = b.component(
    "Week row",
    {
      key: "Week",
      section: "Data",
      description:
        "One training week as seven dots (Outsiders): a dot's size is that day's minutes. Override WkD1 to WkD7 size and fill.",
      props: {
        week: p.text("WkLbl", "W41"),
        time: p.text("WkTime", "3 h 15"),
        change: p.text("WkChg", "+12%"),
      },
      root: { dir: "row", w: CW, h: 34, align: "center" },
    },
    (root) => {
      b.text(b.row(root, "Label", { w: 40 }), "W41", b.ty("mono"), muted, { key: "WkLbl" })
      const cells = b.row(root, "Days", { w: 210 })
      for (let i = 1; i <= 7; i++) {
        const cell = b.row(cells, `Day ${i}`, { w: 30, h: 30, align: "center", justify: "center" })
        b.ellipse(cell, "Dot", { key: `WkD${i}`, w: 6, h: 6, fill: c("dot-dim") })
      }
      const right = b.row(root, "Totals", { w: FILL, gap: 10, justify: "end", align: "center" })
      b.text(right, "3 h 15", b.ty("mono", { size: 13, weight: 600 }), ink, { key: "WkTime" })
      b.text(right, "+12%", b.ty("mono", { align: "right" }), muted, { key: "WkChg", w: 44 })
    },
  )

  // --- Components: content ----------------------------------------------------------------------

  const monogram = b.component(
    "Monogram",
    {
      key: "Mono",
      section: "Content",
      props: {
        initials: p.text("MgText", "MO"),
        size: p.variants({
          sm: { "root.w": 40, "root.h": 40, "MgText.style/size": 13 },
          lg: { "root.w": 72, "root.h": 72, "MgText.style/size": 24 },
        }),
        tone: p.variants({
          ink: { "root.fill": c("avatar"), "MgText.fill": c("on-avatar") },
          soft: { "root.fill": c("subtle"), "MgText.fill": c("ink-2") },
        }),
      },
      root: {
        dir: "row",
        w: 40,
        h: 40,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("avatar"),
      },
    },
    (root) =>
      b.text(
        root,
        "MO",
        b.ty("label", { size: 13, weight: 700, letterSpacing: 0.3 }),
        c("on-avatar"),
        {
          key: "MgText",
        },
      ),
  )

  const planRow = b.component(
    "Plan row",
    {
      key: "Plan",
      section: "Content",
      description:
        "A line of the day's plan: time, title, meta and a state (todo, done, next with Start).",
      props: {
        time: p.text("PrTime", "07:30"),
        title: p.text("PrTitle", "Mobility flow"),
        meta: p.text("PrMeta", "10 min"),
        state: p.variants({
          todo: {
            "PrCircle.visible": true,
            "PrCircle.fill": c("bg"),
            "PrCircle.stroke": { paint: c("ink-2"), width: 1.5 },
            "PrCheck.visible": false,
            "PrStart.visible": false,
            "PrTitle.fill": ink,
          },
          done: {
            "PrCircle.visible": true,
            "PrCircle.fill": ink,
            "PrCircle.stroke": { paint: ink, width: 1.5 },
            "PrCheck.visible": true,
            "PrStart.visible": false,
            "PrTitle.fill": muted,
          },
          next: {
            "PrCircle.visible": false,
            "PrCircle.fill": c("bg"),
            "PrCircle.stroke": { paint: ink, width: 1.5 },
            "PrCheck.visible": false,
            "PrStart.visible": true,
            "PrTitle.fill": ink,
          },
        }),
      },
      root: {
        dir: "row",
        w: CW,
        gap: 14,
        align: "center",
        pad: [14, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.text(root, "07:30", b.ty("mono", { size: 13 }), muted, { key: "PrTime", w: 44 })
      const t = b.col(root, "Text", { w: FILL, gap: 3 })
      b.text(t, "Mobility flow", b.ty("label", { size: 16 }), ink, { key: "PrTitle" })
      b.text(t, "10 min", b.ty("small"), muted, { key: "PrMeta" })
      const circle = b.row(root, "Check", {
        key: "PrCircle",
        w: 26,
        h: 26,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("bg"),
        stroke: { paint: c("ink-2"), width: 1.5 },
      })
      b.icon(circle, "check", 15, c("bg"), { key: "PrCheck", visible: false })
      const start = b.row(root, "Start", {
        key: "PrStart",
        gap: 6,
        align: "center",
        pad: [8, 14, 8, 12],
        radius: r("pill"),
        fill: c("volt"),
        visible: false,
      })
      b.icon(start, "play", 14, c("on-volt"))
      b.text(start, "Start", b.ty("label", { size: 14, weight: 700 }), c("on-volt"))
    },
  )

  const exerciseRow = b.component(
    "Exercise row",
    {
      key: "Ex",
      section: "Content",
      description: "Numbered exercise: index in mono, name, sets × reps · load.",
      props: {
        index: p.text("ExIdx", "01"),
        name: p.text("ExName", "Back squat"),
        meta: p.text("ExMeta", "4 × 6 · 70 kg"),
      },
      root: {
        dir: "row",
        w: CW,
        gap: 14,
        align: "center",
        pad: [11, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.text(root, "01", b.ty("mono", { size: 13 }), muted, { key: "ExIdx", w: 24 })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Back squat", b.ty("label", { size: 16 }), ink, { key: "ExName" })
      b.text(t, "4 × 6 · 70 kg", b.ty("small"), muted, { key: "ExMeta" })
      b.icon(root, "ellipsis", 20, muted)
    },
  )

  const setRow = b.component(
    "Set row",
    {
      key: "SetRow",
      section: "Content",
      description: "One set in the live workout: done, current (volt ring) or upcoming.",
      props: {
        label: p.text("SsLbl", "SET 1"),
        value: p.text("SsVal", "8 × 40 kg"),
        state: p.variants({
          done: {
            "root.fill": c("bg"),
            "SsLbl.fill": muted,
            "SsVal.fill": ink,
            "SsCircle.fill": c("volt"),
            "SsCircle.stroke": { paint: c("volt"), width: 2 },
            "SsCheck.visible": true,
          },
          current: {
            "root.fill": c("subtle"),
            "SsLbl.fill": ink,
            "SsVal.fill": ink,
            "SsCircle.fill": c("subtle"),
            "SsCircle.stroke": { paint: c("volt"), width: 2 },
            "SsCheck.visible": false,
          },
          upcoming: {
            "root.fill": c("bg"),
            "SsLbl.fill": muted,
            "SsVal.fill": muted,
            "SsCircle.fill": c("bg"),
            "SsCircle.stroke": { paint: c("border"), width: 2 },
            "SsCheck.visible": false,
          },
        }),
      },
      root: {
        dir: "row",
        w: CW,
        gap: 14,
        align: "center",
        pad: [11, 14],
        radius: r("md"),
        fill: c("bg"),
      },
    },
    (root) => {
      b.text(root, "SET 1", b.ty("mono", { size: 12 }), muted, { key: "SsLbl", w: 48 })
      b.text(root, "8 × 40 kg", b.ty("label", { size: 16 }), ink, {
        key: "SsVal",
        w: FILL,
        grow: "fixed-width",
      })
      const circle = b.row(root, "Status", {
        key: "SsCircle",
        w: 24,
        h: 24,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("volt"),
        stroke: { paint: c("volt"), width: 2 },
      })
      b.icon(circle, "check", 14, c("on-volt"), { key: "SsCheck" })
    },
  )

  const optionRow = b.component(
    "Option row",
    {
      key: "Option",
      section: "Content",
      description:
        "Single-choice row for onboarding. Selected rows invert to ink with a volt check.",
      props: {
        title: p.text("OpTitle", "Build strength"),
        sub: p.text("OpSub", "Lift three days a week"),
        state: p.variants({
          default: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border") },
            "OpTitle.fill": ink,
            "OpSub.fill": muted,
            "OpCheck.visible": false,
          },
          selected: {
            "root.fill": ink,
            "root.stroke": { paint: ink },
            "OpTitle.fill": c("bg"),
            "OpSub.fill": c("on-ink-muted"),
            "OpCheck.visible": true,
          },
        }),
      },
      root: {
        dir: "row",
        w: CW,
        gap: 14,
        align: "center",
        pad: [16, 18],
        radius: r("lg"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      },
    },
    (root) => {
      const t = b.col(root, "Text", { w: FILL, gap: 3 })
      b.text(t, "Build strength", b.ty("heading"), ink, { key: "OpTitle" })
      b.text(t, "Lift three days a week", b.ty("small"), muted, { key: "OpSub" })
      const chk = b.row(root, "Check", {
        key: "OpCheck",
        w: 24,
        h: 24,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("volt"),
        visible: false,
      })
      b.icon(chk, "check", 14, c("on-volt"))
    },
  )

  const settingRow = b.component(
    "Setting row",
    {
      key: "Setting",
      section: "Content",
      description: "Hairline list row with a value and chevron, or a toggle.",
      props: {
        label: p.text("SrLbl", "Setting"),
        value: p.text("SrVal", "Value"),
        showValue: p.bool("SrVal", true),
        showChevron: p.bool("SrChev", true),
        showToggle: p.bool("SrTgWrap", false),
        toggle: p.swap("SrToggle", toggle),
      },
      root: {
        dir: "row",
        w: CW,
        gap: 14,
        align: "center",
        pad: [15, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.icon(root, "bell", 20, c("ink-2"), { key: "SrIcon" })
      b.text(root, "Setting", b.ty("label", { size: 16 }), ink, {
        key: "SrLbl",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(root, "Value", b.ty("body"), muted, { key: "SrVal" })
      b.icon(root, "chevron-right", 18, muted, { key: "SrChev" })
      const tw = b.row(root, "Toggle", { key: "SrTgWrap", visible: false })
      b.use(tw, toggle, { key: "SrToggle" })
    },
  )

  // --- Screen helpers ----------------------------------------------------------------------------

  const page = b.page("Screens")
  type TabKey = "today" | "train" | "progress" | "profile"
  function screen(
    name: string,
    opts: {
      tab?: TabKey
      dark?: boolean
      pad?: number[]
      gap?: number
      header?: (scr: string) => void
    } = {},
  ) {
    const scr = b.screen(page, name, {
      dir: "column",
      w: W,
      h: H,
      clip: true,
      fill: c("bg"),
      ...(opts.dark ? { theme: { mode: "dark" } } : {}),
    })
    b.use(scr, statusBar, { props: { w: FILL } })
    opts.header?.(scr)
    const content = b.col(scr, "Content", {
      w: FILL,
      h: FILL,
      gap: opts.gap ?? 18,
      pad: opts.pad ?? [8, 20, 16, 20],
      clip: true,
    })
    const bottom = (fn?: (into: string) => void) => {
      if (opts.tab) b.use(scr, tabBar, { props: { w: FILL }, args: { active: opts.tab } })
      else {
        const bar = b.col(scr, "Bottom bar", { w: FILL, gap: 0 })
        if (fn) {
          const inner = b.col(bar, "Actions", { w: FILL, gap: 6, pad: [8, 20, 4, 20] })
          fn(inner)
        }
        b.use(bar, homeBar, { props: { w: FILL } })
      }
    }
    return { scr, content, bottom }
  }
  const section = (parent: string, title: string, action?: string) =>
    b.use(parent, sectionHead, {
      props: { w: FILL },
      args: { title, ...(action ? { action } : { showAction: false }) },
    })
  const week = (parent: string, i: number, today?: number) => {
    const [label, mins] = WEEKS[i] as [string, number[]]
    const total = sum(mins)
    const prev = i ? sum((WEEKS[i - 1] as [string, number[]])[1]) : 0
    const chg =
      i && i < WEEKS.length - 1
        ? `${total >= prev ? "+" : "−"}${Math.round((Math.abs(total - prev) / prev) * 100)}%`
        : i
          ? "so far"
          : ""
    const set: Record<string, Record<string, unknown>> = {}
    mins.forEach((m, d) => {
      if (m) set[`WkD${d + 1}`] = { w: dot(m), h: dot(m), fill: c("dot") }
      else if (today === d)
        set[`WkD${d + 1}`] = {
          w: 18,
          h: 18,
          stroke: { paint: c("dot"), width: 1.5 },
          fill: c("bg"),
        }
    })
    b.use(parent, weekRow, {
      props: { w: FILL },
      args: { week: label, time: hm(total), change: chg },
      set,
    })
  }

  // --- Cover -------------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Mobile app template",
    title: "Brisk fitness coach",
    description:
      "Onboarding, a Today with one ring, workout detail, a rest timer, dot-matrix progress and a profile for an iPhone strength and habit coach. Light and dark tokens, one volt accent, no gradients.",
    preview: (area) => {
      const row = b.row(area, "Phones", {
        w: FILL,
        h: FILL,
        gap: 24,
        align: "center",
        justify: "center",
      })
      const phone = (name: string, dark: boolean) =>
        b.col(row, name, {
          w: 300,
          h: 560,
          gap: 14,
          pad: [20, 16],
          radius: 40,
          clip: true,
          fill: c("bg"),
          stroke: { paint: c("border"), width: 1 },
          effects: b.shadow("phone"),
          ...(dark ? { theme: { mode: "dark" } } : {}),
        })
      const a = phone("Today", false)
      b.text(a, "TUESDAY, OCTOBER 6", b.ty("micro"), muted)
      b.text(a, "Today", b.ty("display"), ink)
      const hero = b.row(a, "Move", {
        w: FILL,
        gap: 10,
        align: "center",
        pad: 16,
        radius: r("card"),
        fill: c("hero"),
      })
      const hc = b.col(hero, "Numbers", { w: FILL, gap: 4 })
      b.text(hc, "MOVE · KCAL", b.ty("micro"), c("hero-muted"))
      const hv = b.row(hc, "Value", { align: "baseline", gap: 4 })
      b.text(hv, "432", b.ty("numeral", { size: 52, letterSpacing: -2.2 }), c("on-hero"))
      b.text(hv, "/ 600", b.ty("mono", { size: 11 }), c("hero-muted"))
      b.use(hero, ring, {
        props: { w: 84, h: 84 },
        set: { RgTrack: { w: 84, h: 84 }, RgArc: { w: 84, h: 84, sweepAngle: -259 } },
      })
      const pl = b.col(a, "Plan", { w: FILL, gap: 0 })
      b.use(pl, planRow, {
        props: { w: FILL },
        args: { time: "07:30", title: "Mobility flow", meta: "10 min", state: "done" },
      })
      b.use(pl, planRow, {
        props: { w: FILL },
        args: { time: "18:00", title: "Lower body", meta: "45 min · 6 lifts", state: "next" },
      })
      const d = phone("Rest", true)
      b.text(d, "REST", b.ty("micro"), muted)
      b.text(d, "0:45", b.ty("timer", { size: 92, letterSpacing: -4.5 }), ink)
      const ss = b.col(d, "Sets", { w: FILL, gap: 4 })
      b.use(ss, setRow, {
        props: { w: FILL },
        args: { label: "SET 3", value: "8 × 40 kg", state: "done" },
      })
      b.use(ss, setRow, {
        props: { w: FILL },
        args: { label: "SET 4", value: "8 × 40 kg", state: "current" },
      })
      b.use(d, button, { props: { w: FILL }, args: { label: "Skip rest" } })
    },
  })

  // --- Onboarding --------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Onboarding", { pad: [4, 20, 8, 20], gap: 20 })
    const top = b.row(content, "Progress", { w: FILL, gap: 12, align: "center" })
    b.use(top, iconBtn, { args: { variant: "plain" } })
    const segs = b.row(top, "Steps", { w: FILL, gap: 4 })
    for (let i = 0; i < 5; i++)
      b.rect(segs, `Step ${i + 1}`, {
        w: fill(1),
        h: 4,
        radius: 2,
        fill: i < 2 ? ink : c("subtle"),
      })
    const head = b.col(content, "Heading", { w: FILL, gap: 10, pad: [16, 0, 0, 0] })
    b.text(head, "STEP 2 OF 5", b.ty("micro"), muted, { w: FILL, grow: "fixed-width" })
    b.para(head, "What should Brisk help you with first?", b.ty("display"), ink)
    b.para(
      head,
      "Your coach builds the first month around it. You can change it any time in Profile.",
      b.ty("body"),
      muted,
    )
    const opts = b.col(content, "Options", { w: FILL, gap: 10, pad: [8, 0, 0, 0] })
    for (const [title, sub, state] of [
      ["Build strength", "Three lifts a week, more load each time", "selected"],
      ["Run further", "From a first 5K to a steady half marathon", "default"],
      ["Move more every day", "Walks, mobility and small habits that stick", "default"],
      ["Sleep and recover better", "Rest days that adapt to how you feel", "default"],
    ] as const)
      b.use(opts, optionRow, { props: { w: FILL }, args: { title, sub, state } })
    bottom((into) => {
      b.use(into, button, { props: { w: FILL }, args: { label: "Continue" } })
      b.use(into, button, {
        props: { w: FILL },
        args: { label: "I'll decide later", variant: "text", size: "md" },
      })
    })
  }

  // --- Today -------------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Today", { tab: "today", gap: 14 })
    const head = b.row(content, "Header", { w: FILL, align: "end", justify: "between" })
    const ht = b.col(head, "Title", { gap: 4 })
    b.text(ht, "TUESDAY, OCTOBER 6", b.ty("micro"), muted)
    b.text(ht, "Today", b.ty("display"), ink)
    const streak = b.row(head, "Streak", {
      gap: 6,
      align: "center",
      pad: [7, 12, 7, 10],
      radius: r("pill"),
      fill: c("subtle"),
    })
    b.icon(streak, "flame", 16, c("coral"))
    b.text(streak, "23", b.ty("mono", { size: 13, weight: 700 }), ink)
    // the last seven days, in the same dot language as Progress
    const strip = b.row(content, "Last seven days", { w: FILL, justify: "between" })
    const dayAt = (w: number, d: number) => WEEKS[w]?.[1][d] ?? 0
    const days: [string, number | "today"][] = [
      ["W", dayAt(4, 2)],
      ["T", 0],
      ["F", dayAt(4, 4)],
      ["S", dayAt(4, 5)],
      ["S", 0],
      ["M", dayAt(5, 0)],
      ["T", "today"],
    ]
    for (const [l, m] of days) {
      const col = b.col(strip, l, { w: 46, gap: 8, align: "center" })
      b.text(
        col,
        l,
        b.ty("mono", { size: 12, weight: m === "today" ? 700 : 500, align: "center" }),
        m === "today" ? ink : muted,
      )
      const cell = b.row(col, "Cell", { w: 30, h: 30, align: "center", justify: "center" })
      if (m === "today")
        b.ellipse(cell, "Today", { w: 20, h: 20, stroke: { paint: c("dot"), width: 1.5 } })
      else b.ellipse(cell, "Day", { w: dot(m), h: dot(m), fill: m ? c("dot") : c("dot-dim") })
    }
    const hero = b.col(content, "Move", {
      w: FILL,
      gap: 14,
      pad: 18,
      radius: r("card"),
      fill: c("hero"),
    })
    const hr = b.row(hero, "Move", { w: FILL, gap: 12, align: "center" })
    const hc = b.col(hr, "Numbers", { w: FILL, gap: 6 })
    b.text(hc, "MOVE · KCAL", b.ty("micro"), c("hero-muted"))
    const hv = b.row(hc, "Value", { align: "baseline", gap: 6 })
    b.text(hv, "432", b.ty("numeral", { size: 64, letterSpacing: -2.8 }), c("on-hero"))
    b.text(hv, "/ 600", b.ty("mono", { size: 14 }), c("hero-muted"))
    b.use(hr, ring, { set: sweep(72) })
    b.divider(hero, c("hero-line"))
    b.para(
      hero,
      "Legs are recovered. Tonight's lift can be a heavy one.",
      b.ty("body", { size: 14 }),
      c("on-hero"),
    )
    const tri = b.row(hero, "Recovery", { w: FILL, justify: "between" })
    b.use(tri, stat, {
      props: { w: 100 },
      args: { label: "RECOVERY", value: "78", unit: "%", tone: "hero" },
    })
    b.use(tri, stat, {
      props: { w: 100 },
      args: { label: "HRV", value: "62", unit: "MS", tone: "hero" },
    })
    b.use(tri, stat, {
      props: { w: 100 },
      args: { label: "RESTING HR", value: "54", unit: "BPM", tone: "hero" },
    })
    const plan = b.col(content, "Plan", { w: FILL, gap: 4 })
    section(plan, "TODAY'S PLAN", "Edit")
    b.use(plan, planRow, {
      props: { w: FILL },
      args: { time: "07:30", title: "Mobility flow", meta: "10 min", state: "done" },
    })
    b.use(plan, planRow, {
      props: { w: FILL },
      args: { time: "13:00", title: "Water", meta: "5 of 8 glasses", state: "todo" },
    })
    b.use(plan, planRow, {
      props: { w: FILL },
      args: {
        time: "18:00",
        title: "Lower body strength",
        meta: "45 min · 6 exercises",
        state: "next",
      },
    })
    bottom()
  }

  // --- Workout detail ----------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Workout detail", {
      header: (scr) => b.use(scr, navHeader, { props: { w: FILL } }),
      pad: [8, 20, 8, 20],
      gap: 18,
    })
    const head = b.col(content, "Title", { w: FILL, gap: 8 })
    b.text(head, "STRENGTH · INTERMEDIATE", b.ty("micro"), muted)
    b.para(head, "Lower body strength", b.ty("display", { size: 32 }), ink)
    const st = b.row(content, "Facts", {
      w: FILL,
      justify: "between",
      pad: [14, 0],
      stroke: { paint: c("border"), width: { t: 1, b: 1 } },
    })
    b.use(st, stat, { args: { label: "DURATION", value: "45", unit: "MIN" } })
    b.use(st, stat, { args: { label: "EXERCISES", value: "6", unit: "" } })
    b.use(st, stat, { args: { label: "EST. BURN", value: "380", unit: "KCAL" } })
    const blocks: [string, [string, string, string][]][] = [
      ["WARM-UP · 5 MIN", [["01", "Easy bike", "5 min · zone 2"]]],
      [
        "MAIN · 32 MIN",
        [
          ["02", "Back squat", "4 × 6 · 70 kg"],
          ["03", "Romanian deadlift", "4 × 8 · 40 kg"],
          ["04", "Walking lunge", "3 × 12 per leg"],
          ["05", "Leg curl", "3 × 12 · 30 kg"],
        ],
      ],
      ["FINISHER · 8 MIN", [["06", "Dead bug", "3 × 10 per side"]]],
    ]
    const list = b.col(content, "Blocks", { w: FILL, gap: 14 })
    for (const [title, rows] of blocks) {
      const g = b.col(list, title, { w: FILL, gap: 0 })
      b.text(g, title, b.ty("micro"), muted, { w: FILL, grow: "fixed-width" })
      for (const [index, name, meta] of rows)
        b.use(g, exerciseRow, { props: { w: FILL }, args: { index, name, meta } })
    }
    bottom((into) =>
      b.use(into, button, { props: { w: FILL }, args: { label: "Start workout", icon: true } }),
    )
  }

  // --- Workout in progress -----------------------------------------------------------------------
  {
    const { content, bottom } = screen("Workout in progress", {
      dark: true,
      pad: [4, 20, 8, 20],
      gap: 16,
    })
    const top = b.row(content, "Header", { w: FILL, align: "center", justify: "between" })
    const el = b.col(top, "Elapsed", { gap: 2 })
    b.text(el, "ELAPSED", b.ty("micro"), muted)
    b.text(el, "18:42", b.ty("metric", { size: 26 }), ink)
    b.use(top, button, { args: { label: "End", variant: "outline", size: "md" } })
    const segs = b.row(content, "Exercises", { w: FILL, gap: 4 })
    ;[c("volt"), c("volt"), c("ink-2"), c("subtle"), c("subtle"), c("subtle")].forEach((f, i) => {
      b.rect(segs, `Exercise ${i + 1}`, { w: fill(1), h: 4, radius: 2, fill: f })
    })
    const next = b.row(content, "Next", {
      w: FILL,
      gap: 12,
      align: "center",
      pad: [14, 16],
      radius: r("lg"),
      fill: c("surface"),
    })
    const nt = b.col(next, "Text", { w: FILL, gap: 3 })
    b.text(nt, "NEXT · SET 4 OF 4", b.ty("micro", { size: 10 }), c("volt"))
    b.text(nt, "Romanian deadlift", b.ty("heading"), ink)
    b.text(nt, "8 reps × 40 kg", b.ty("small"), muted)
    b.icon(next, "chevron-right", 18, muted)
    const mid = b.col(content, "Rest timer", {
      w: FILL,
      gap: 4,
      align: "center",
      pad: [16, 0, 0, 0],
    })
    b.text(mid, "REST", b.ty("micro", { align: "center" }), muted)
    b.text(mid, "0:45", b.ty("timer", { align: "center" }), ink)
    const adj = b.row(content, "Adjust", { w: FILL, gap: 14, align: "center" })
    b.use(adj, chip, { args: { label: "−15 s" } })
    const bar = b.row(adj, "Progress", {
      w: FILL,
      h: 4,
      radius: r("pill"),
      fill: c("subtle"),
      clip: true,
    })
    b.rect(bar, "Elapsed", { w: fill(50), h: 4, fill: c("volt") })
    b.rect(bar, "Left", { w: fill(50), h: 4, fill: c("subtle") })
    b.use(adj, chip, { args: { label: "+15 s" } })
    const sets = b.col(content, "Sets", { w: FILL, gap: 2, pad: [4, 0, 0, 0] })
    ;(["done", "done", "done", "current"] as const).forEach((state, i) => {
      b.use(sets, setRow, {
        props: { w: FILL },
        args: { label: `SET ${i + 1}`, value: "8 × 40 kg", state },
      })
    })
    bottom((into) => {
      const row = b.row(into, "Controls", { w: FILL, gap: 10, align: "center" })
      b.use(row, iconBtn, {
        args: { variant: "surface" },
        props: { w: 56, h: 56 },
        set: { IbIcon: { icon: "pause" } },
      })
      b.use(row, button, {
        props: { w: FILL },
        args: { label: "Skip rest", icon: true },
        set: { BtnIcon: { icon: "skip-forward" } },
      })
    })
  }

  // --- Progress ----------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Progress", { tab: "progress", dark: true, gap: 18 })
    const head = b.row(content, "Header", { w: FILL, align: "center", justify: "between" })
    b.text(head, "Progress", b.ty("display"), ink)
    const rng = b.row(head, "Range", { gap: 6 })
    b.use(rng, chip, { args: { label: "6W", state: "selected" } })
    b.use(rng, chip, { args: { label: "12W" } })
    b.use(rng, chip, { args: { label: "1Y" } })
    const sessions = WEEKS.reduce((n, [, m]) => n + m.filter(Boolean).length, 0)
    const total = WEEKS.reduce((n, [, m]) => n + sum(m), 0)
    const avg = Math.round(WEEKS.slice(0, 5).reduce((n, [, m]) => n + sum(m), 0) / 5)
    const tri = b.row(content, "Totals", { w: FILL })
    b.use(tri, stat, { args: { label: "SESSIONS", value: String(sessions), unit: "" } })
    b.use(tri, stat, {
      args: {
        label: "TIME",
        value: `${Math.floor(total / 60)}`,
        unit: `H ${String(total % 60).padStart(2, "0")}`,
      },
    })
    b.use(tri, stat, {
      args: {
        label: "AVG / WEEK",
        value: `${Math.floor(avg / 60)}`,
        unit: `H ${String(avg % 60).padStart(2, "0")}`,
      },
    })
    const matrix = b.col(content, "Training weeks", { w: FILL, gap: 6 })
    section(matrix, "TRAINING WEEKS", "Dot = minutes")
    const days = b.row(matrix, "Days", { w: FILL, pad: [4, 0, 0, 40] })
    for (const d of ["M", "T", "W", "T", "F", "S", "S"])
      b.text(
        b.row(days, "Day", { w: 30, justify: "center" }),
        d,
        b.ty("mono", { size: 11, align: "center" }),
        muted,
      )
    const rows = b.col(matrix, "Weeks", { w: FILL, gap: 0 })
    WEEKS.forEach((_, i) => {
      week(rows, i, i === WEEKS.length - 1 ? 1 : undefined)
    })
    const pb = b.col(content, "Personal bests", { w: FILL, gap: 2 })
    section(pb, "PERSONAL BESTS", "")
    for (const [name, meta, value] of [
      ["Back squat", "5 reps · Sep 29", "82.5 kg"],
      ["Romanian deadlift", "8 reps · Sep 24", "52.5 kg"],
      ["Plank", "Sep 19", "2:10"],
    ] as const) {
      const row = b.row(pb, name, {
        w: FILL,
        gap: 12,
        align: "center",
        pad: [12, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      })
      const t = b.col(row, "Text", { w: FILL, gap: 2 })
      b.text(t, name, b.ty("label", { size: 16 }), ink)
      b.text(t, meta, b.ty("small"), muted)
      b.text(row, value, b.ty("metric", { size: 20 }), ink)
    }
    bottom()
  }

  // --- Profile -----------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Profile", { tab: "profile", gap: 18 })
    const head = b.row(content, "Header", { w: FILL, gap: 16, align: "center" })
    b.use(head, monogram, { args: { initials: "MO", size: "lg" } })
    const ht = b.col(head, "Name", { w: FILL, gap: 4 })
    b.text(ht, "Maya Okafor", b.ty("display", { size: 28 }), ink)
    b.text(ht, "MEMBER SINCE 2025", b.ty("micro", { size: 10 }), muted)
    b.use(head, iconBtn, { args: { variant: "surface" }, set: { IbIcon: { icon: "settings" } } })
    const tri = b.row(content, "Totals", {
      w: FILL,
      pad: [14, 0],
      stroke: { paint: c("border"), width: { t: 1, b: 1 } },
    })
    b.use(tri, stat, { args: { label: "WORKOUTS", value: "214", unit: "" } })
    b.use(tri, stat, { args: { label: "HABIT STREAK", value: "23", unit: "DAYS" } })
    b.use(tri, stat, { args: { label: "TRAINED", value: "168", unit: "H" } })
    const goal = b.col(content, "Goal", {
      w: FILL,
      gap: 12,
      pad: 18,
      radius: r("lg"),
      fill: c("surface"),
    })
    const gl = b.row(goal, "Line", { w: FILL, justify: "between", align: "baseline" })
    b.text(gl, "GOAL", b.ty("micro"), muted)
    b.text(gl, "1 of 3 this week", b.ty("mono", { size: 12 }), ink)
    b.text(goal, "Build strength", b.ty("heading"), ink)
    const gs = b.row(goal, "Sessions", { w: FILL, gap: 4 })
    for (let i = 0; i < 3; i++)
      b.rect(gs, `Session ${i + 1}`, {
        w: fill(1),
        h: 6,
        radius: 3,
        fill: i < 1 ? c("volt") : c("subtle"),
      })
    const coach = b.row(content, "Coach", { w: FILL, gap: 12, align: "center" })
    b.use(coach, monogram, { args: { initials: "JW", size: "sm", tone: "soft" } })
    const ct = b.col(coach, "Text", { w: FILL, gap: 1 })
    b.text(ct, "Jonas Weber", b.ty("label", { size: 16 }), ink)
    b.text(ct, "Coach · replies within a day", b.ty("small"), muted)
    b.use(coach, button, { args: { label: "Message", variant: "outline", size: "md" } })
    const sl = b.col(content, "Settings", { w: FILL, gap: 0 })
    for (const [i, [label, value, icon]] of (
      [
        ["Reminders", "07:15", "bell"],
        ["Connected apps", "Apple Health", "link"],
        ["Units", "kg · km", "ruler"],
        ["Subscription", "Renews Nov 3", "credit-card"],
        ["Rest day check-ins", "", "moon"],
      ] as const
    ).entries()) {
      void i
      const toggleRow = label === "Rest day check-ins"
      b.use(sl, settingRow, {
        props: { w: FILL },
        args: {
          label,
          ...(value ? { value } : { showValue: false }),
          showChevron: !toggleRow,
          showToggle: toggleRow,
        },
        set: { SrIcon: { icon } },
      })
    }
    bottom()
  }
}
