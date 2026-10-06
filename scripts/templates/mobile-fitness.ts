/**
 * Brisk: the iPhone app of a fictional fitness and habit coach.
 * Screens (390×844): Onboarding, Today, Workout detail, Workout in progress (dark), Progress,
 * Profile.
 */
import { FILL, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "mobile-fitness",
  name: "Brisk fitness coach",
  category: "Mobile",
  description:
    "Six-screen iPhone app for a fitness and habit coach: onboarding, today, workout detail, live workout, progress charts and profile.",
  prefix: "qf",
  build,
}

const W = 390
const H = 844

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F4F4F0", "#0C0D0C"],
      surface: ["#FFFFFF", "#171917"],
      subtle: ["#ECECE6", "#222522"],
      ink: ["#131512", "#F2F3EF"],
      "ink-2": ["#3A3D38", "#C8CBC4"],
      muted: ["#6D716A", "#8F948C"],
      border: ["#E3E3DC", "#2A2D29"],
      primary: ["#131512", "#F2F3EF"],
      "on-primary": ["#FFFFFF", "#0C0D0C"],
      accent: ["#D9481C", "#FF7A4D"],
      "accent-soft": ["#FCE6DC", "#3A1D12"],
      "on-accent": ["#FFFFFF", "#160904"],
      green: ["#23824C", "#4CD18A"],
      "green-soft": ["#DFF2E6", "#11301F"],
      blue: ["#1F74C2", "#5AAEF5"],
      "blue-soft": ["#DFEDFA", "#10263B"],
      violet: ["#5A4FCF", "#9D94FF"],
      "violet-soft": ["#E9E7FB", "#221F45"],
      track: ["#E6E6DF", "#3A3E38"],
      knob: ["#FFFFFF", "#FFFFFF"],
      "art-1": ["#FFC9A8", "#6B2E14"],
      "art-2": ["#FFE7C2", "#4A3417"],
      "art-3": ["#BFE6CF", "#18452C"],
      "art-4": ["#CFE2F7", "#1A3554"],
      "on-art": ["#131512", "#F2F3EF"],
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
      "radius/lg": 18,
      "radius/xl": 26,
      "radius/pill": 999,
      "size/status": 47,
    },
    type: {
      display: { font: "Inter", size: 34, weight: 700, lineHeight: 1.1, letterSpacing: -0.9 },
      h1: { font: "Inter", size: 28, weight: 700, lineHeight: 1.15, letterSpacing: -0.7 },
      title: { font: "Inter", size: 20, weight: 700, lineHeight: 1.25, letterSpacing: -0.3 },
      heading: { font: "Inter", size: 17, weight: 600, lineHeight: 1.3, letterSpacing: -0.2 },
      metric: { font: "Inter", size: 24, weight: 700, lineHeight: 1.1, letterSpacing: -0.5 },
      timer: { font: "Inter", size: 64, weight: 700, lineHeight: 1, letterSpacing: -2.4 },
      body: { font: "Inter", size: 15, weight: 400, lineHeight: 1.45 },
      label: { font: "Inter", size: 14, weight: 600, lineHeight: 1.3 },
      small: { font: "Inter", size: 13, weight: 400, lineHeight: 1.4 },
      caption: { font: "Inter", size: 11, weight: 600, lineHeight: 1.3 },
    },
    shadows: {
      card: [
        { kind: "shadow", x: 0, y: 1, blur: 2, color: "#1315120D" },
        { kind: "shadow", x: 0, y: 6, blur: 16, spread: -6, color: "#13151214" },
      ],
      phone: { kind: "shadow", x: 0, y: 24, blur: 48, spread: -12, color: "#13151233" },
    },
  })

  const c = (n: string) => b.c(n)
  const s = (n: number) => b.n(`space/${n}`)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  const grad = (from: string, to: string, rotation = 135) => ({
    kind: "linear",
    rotation,
    stops: [
      { color: c(from), at: 0 },
      { color: c(to), at: 1 },
    ],
  })
  const card = (extra: Record<string, unknown> = {}) => ({
    radius: r("lg"),
    fill: c("surface"),
    effects: b.shadow("card"),
    ...extra,
  })
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
    ["Plan", "calendar-days"],
    ["Progress", "chart-column"],
    ["Profile", "user"],
  ] as const
  const tabActive = (i: number) =>
    Object.fromEntries(
      tabsDef.flatMap((_, j) => [
        [`TbIc${j + 1}.color`, j === i ? c("accent") : muted],
        [`TbLb${j + 1}.fill`, j === i ? c("accent") : muted],
      ]),
    )
  const tabBar = b.component(
    "Tab bar",
    {
      key: "TabBar",
      section: "System",
      description: "Four tabs with the home indicator. Set active per screen.",
      props: {
        active: p.variants({
          today: tabActive(0),
          plan: tabActive(1),
          progress: tabActive(2),
          profile: tabActive(3),
        }),
      },
      root: {
        dir: "column",
        w: W,
        pad: [8, 0, 0, 0],
        fill: c("surface"),
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      const items = b.row(root, "Items", { w: FILL, pad: [0, 12] })
      tabsDef.forEach(([label, icon], i) => {
        const it = b.col(items, label, { w: (W - 24) / 4, gap: 4, align: "center", pad: [4, 0] })
        b.icon(it, icon, 24, i === 0 ? c("accent") : muted, { key: `TbIc${i + 1}` })
        b.text(it, label, b.ty("caption"), i === 0 ? c("accent") : muted, {
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
      description: "Primary (ink), accent, secondary or soft; md or lg.",
      props: {
        label: p.text("BtnLabel", "Button"),
        icon: p.bool("BtnIcon", false),
        variant: p.variants({
          primary: {
            "root.fill": c("primary"),
            "root.stroke": { paint: c("primary") },
            "BtnLabel.fill": c("on-primary"),
            "BtnIcon.color": c("on-primary"),
          },
          accent: {
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
          soft: {
            "root.fill": c("subtle"),
            "root.stroke": { paint: c("subtle") },
            "BtnLabel.fill": ink,
            "BtnIcon.color": ink,
          },
        }),
        size: p.variants({
          lg: { "root.layout/pad": [16, 22], "BtnLabel.style/size": 16 },
          md: { "root.layout/pad": [10, 16], "BtnLabel.style/size": 14 },
        }),
      },
      root: {
        dir: "row",
        gap: 8,
        align: "center",
        justify: "center",
        pad: [16, 22],
        radius: r("pill"),
        fill: c("primary"),
        stroke: { paint: c("primary") },
      },
    },
    (root) => {
      b.icon(root, "play", 18, c("on-primary"), { key: "BtnIcon", visible: false })
      b.text(root, "Button", b.ty("label", { size: 16 }), c("on-primary"), {
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
            "IbIcon.color": ink,
          },
          soft: {
            "root.fill": c("subtle"),
            "root.stroke": { paint: c("subtle") },
            "IbIcon.color": ink,
          },
          accent: {
            "root.fill": c("accent"),
            "root.stroke": { paint: c("accent") },
            "IbIcon.color": c("on-accent"),
          },
        }),
        size: p.variants({
          md: { "root.w": 40, "root.h": 40, "IbIcon.w": 20, "IbIcon.h": 20 },
          lg: { "root.w": 64, "root.h": 64, "IbIcon.w": 26, "IbIcon.h": 26 },
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
      props: {
        label: p.text("ChipLbl", "Chip"),
        state: p.variants({
          default: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border") },
            "ChipLbl.fill": ink,
          },
          selected: {
            "root.fill": c("primary"),
            "root.stroke": { paint: c("primary") },
            "ChipLbl.fill": c("on-primary"),
          },
        }),
      },
      root: {
        dir: "row",
        align: "center",
        justify: "center",
        pad: [10, 16],
        radius: r("pill"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      },
    },
    (root) => b.text(root, "Chip", b.ty("label"), ink, { key: "ChipLbl", name: "Label" }),
  )

  const toggle = b.component(
    "Toggle",
    {
      key: "Toggle",
      section: "Actions",
      props: {
        state: p.variants({
          on: { "root.fill": c("green"), "root.layout/justify": "end" },
          off: { "root.fill": c("track"), "root.layout/justify": "start" },
        }),
      },
      root: {
        dir: "row",
        w: 51,
        h: 31,
        pad: 2,
        justify: "end",
        radius: r("pill"),
        fill: c("green"),
      },
    },
    (root) => b.ellipse(root, "Knob", { w: 27, h: 27, fill: c("knob") }),
  )
  const toggleOff = b.derive(toggle, "Toggle/Off", "ToggleOff", {
    section: "Actions",
    description:
      "Toggle preset in the off state. Setting row swaps between Toggle and this through its toggle prop, so a row can be switched from the instance panel without opening the nested toggle.",
    args: { state: "off" },
  })

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
      section: "Actions",
      props: {
        first: p.text("SgL1", "One"),
        second: p.text("SgL2", "Two"),
        third: p.text("SgL3", "Three"),
        active: p.variants({ first: segActive(0), second: segActive(1), third: segActive(2) }),
      },
      root: { dir: "row", w: 350, pad: 3, gap: 2, radius: r("md"), fill: c("subtle") },
    },
    (root) => {
      segLabels.forEach((l, i) => {
        const it = b.row(root, l, {
          key: `SgI${i + 1}`,
          w: (350 - 6 - 4) / 3,
          pad: [7, 0],
          justify: "center",
          radius: 9,
          fill: i === 0 ? c("surface") : c("subtle"),
          ...(i === 0 ? { effects: b.shadow("card") } : {}),
        })
        b.text(it, l, b.ty("label", { size: 13 }), i === 0 ? ink : muted, { key: `SgL${i + 1}` })
      })
    },
  )

  // --- Components: content -----------------------------------------------------------------------

  const navHeader = b.component(
    "Nav header",
    {
      key: "NavHead",
      section: "Navigation",
      props: {
        title: p.text("NhTitle", "Title"),
        showAction: p.bool("NhActW", true),
      },
      root: { dir: "row", w: W, gap: 12, align: "center", pad: [8, 20] },
    },
    (root) => {
      b.use(root, iconBtn, { key: "NhBack" })
      b.text(root, "Title", b.ty("heading", { align: "center" }), ink, {
        key: "NhTitle",
        name: "Title",
        w: FILL,
        grow: "fixed-width",
      })
      const act = b.row(root, "Action", { key: "NhActW" })
      b.use(act, iconBtn, { key: "NhAct", set: { IbIcon: { icon: "ellipsis" } } })
    },
  )

  const sectionHead = b.component(
    "Section header",
    {
      key: "SecHead",
      section: "Navigation",
      props: {
        title: p.text("ShTitle", "Section"),
        action: p.text("ShAct", "See all"),
        showAction: p.bool("ShAct", true),
      },
      root: { dir: "row", w: 350, align: "center", justify: "between" },
    },
    (root) => {
      b.text(root, "Section", b.ty("title", { size: 18 }), ink, { key: "ShTitle", name: "Title" })
      b.text(root, "See all", b.ty("label"), c("accent"), { key: "ShAct", name: "Action" })
    },
  )

  const avatar = b.component(
    "Avatar",
    {
      key: "Avatar",
      section: "Content",
      props: {
        initials: p.text("AvInit", "MO"),
        size: p.variants({
          sm: { "root.w": 36, "root.h": 36, "AvInit.style/size": 13 },
          lg: { "root.w": 80, "root.h": 80, "AvInit.style/size": 26 },
        }),
      },
      root: {
        dir: "row",
        w: 36,
        h: 36,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: grad("art-1", "art-2"),
      },
    },
    (root) => b.text(root, "MO", b.ty("label", { size: 13 }), c("on-art"), { key: "AvInit" }),
  )

  const badge = b.component(
    "Badge",
    {
      key: "Badge",
      section: "Content",
      props: {
        label: p.text("BdgLbl", "Badge"),
        tone: p.variants({
          accent: { "root.fill": c("accent-soft"), "BdgLbl.fill": c("accent") },
          green: { "root.fill": c("green-soft"), "BdgLbl.fill": c("green") },
          neutral: { "root.fill": c("subtle"), "BdgLbl.fill": c("ink-2") },
          glass: { "root.fill": c("surface"), "BdgLbl.fill": ink },
        }),
      },
      root: { dir: "row", pad: [4, 10], radius: r("pill"), fill: c("accent-soft") },
    },
    (root) =>
      b.text(root, "Badge", b.ty("caption", { size: 12 }), c("accent"), {
        key: "BdgLbl",
        name: "Label",
      }),
  )

  const tones = {
    accent: ["accent-soft", "accent"],
    green: ["green-soft", "green"],
    blue: ["blue-soft", "blue"],
    violet: ["violet-soft", "violet"],
    neutral: ["subtle", "ink-2"],
  } as const
  const toneVariants = (tile: string, icon: string) =>
    p.variants(
      Object.fromEntries(
        Object.entries(tones).map(([k, [soft, strong]]) => [
          k,
          { [`${tile}.fill`]: c(soft), [`${icon}.color`]: c(strong) },
        ]),
      ),
    )

  const ring = b.component(
    "Progress ring",
    {
      key: "Ring",
      section: "Data",
      description: "Clockwise from 12 o’clock: set RgArc sweepAngle to −3.6 × the percentage.",
      props: {
        value: p.text("RgVal", "72%"),
        label: p.text("RgLbl", "of move goal"),
        tone: p.variants({
          accent: { "RgArc.fill": c("accent") },
          green: { "RgArc.fill": c("green") },
          blue: { "RgArc.fill": c("blue") },
          violet: { "RgArc.fill": c("violet") },
        }),
        size: p.variants({
          md: {
            "root.w": 112,
            "root.h": 112,
            "RgTrack.w": 112,
            "RgTrack.h": 112,
            "RgArc.w": 112,
            "RgArc.h": 112,
            "RgVal.style": b.ty("metric", { align: "center" }),
            "RgLbl.style/size": 12,
          },
          sm: {
            "root.w": 64,
            "root.h": 64,
            "RgTrack.w": 64,
            "RgTrack.h": 64,
            "RgArc.w": 64,
            "RgArc.h": 64,
            "RgVal.style": b.ty("metric", { size: 15, align: "center" }),
            "RgLbl.style/size": 9,
          },
          lg: {
            "root.w": 220,
            "root.h": 220,
            "RgTrack.w": 220,
            "RgTrack.h": 220,
            "RgArc.w": 220,
            "RgArc.h": 220,
            "RgVal.style": b.ty("timer", { align: "center" }),
            "RgLbl.style/size": 15,
          },
        }),
      },
      root: { dir: "column", w: 112, h: 112, align: "center", justify: "center", gap: 0 },
    },
    (root) => {
      const arc = {
        x: 0,
        y: 0,
        w: 112,
        h: 112,
        innerRadius: 0.84,
        position: "absolute",
        meta: overlay,
      }
      b.ellipse(root, "Track", { key: "RgTrack", ...arc, fill: c("track") })
      b.ellipse(root, "Arc", {
        key: "RgArc",
        ...arc,
        startAngle: 90,
        sweepAngle: -259,
        fill: c("accent"),
      })
      b.text(root, "72%", b.ty("metric", { align: "center" }), ink, { key: "RgVal", name: "Value" })
      b.text(root, "of move goal", b.ty("small", { size: 12, align: "center" }), muted, {
        key: "RgLbl",
        name: "Label",
      })
    },
  )
  const sweep = (pct: number) => ({ RgArc: { sweepAngle: -Math.round(pct * 3.6) } })

  const stat = b.component(
    "Stat tile",
    {
      key: "Stat",
      section: "Data",
      props: {
        value: p.text("SttVal", "0"),
        unit: p.text("SttUnit", "min"),
        label: p.text("SttLbl", "Metric"),
        tone: toneVariants("SttTile", "SttIcon"),
      },
      root: { dir: "column", w: 110, gap: 10, pad: 14, ...card({ radius: r("md") }) },
    },
    (root) => {
      const tile = b.row(root, "Icon tile", {
        key: "SttTile",
        w: 30,
        h: 30,
        radius: r("sm"),
        align: "center",
        justify: "center",
        fill: c("accent-soft"),
      })
      b.icon(tile, "flame", 16, c("accent"), { key: "SttIcon" })
      const v = b.col(root, "Text", { gap: 2 })
      const line = b.row(v, "Value", { gap: 3, align: "baseline" })
      b.text(line, "0", b.ty("metric", { size: 22 }), ink, { key: "SttVal" })
      b.text(line, "min", b.ty("small", { weight: 600 }), muted, { key: "SttUnit" })
      b.text(v, "Metric", b.ty("small", { size: 12 }), muted, { key: "SttLbl" })
    },
  )

  const habitRow = b.component(
    "Habit row",
    {
      key: "Habit",
      section: "Data",
      description: "A daily habit with its count and a check.",
      props: {
        title: p.text("HbTitle", "Habit"),
        detail: p.text("HbDetail", "0 of 8"),
        tone: toneVariants("HbTile", "HbIcon"),
        state: p.variants({
          todo: {
            "HbCheck.fill": c("surface"),
            "HbCheck.stroke": { paint: c("border"), width: 2 },
            "HbTick.visible": false,
          },
          done: {
            "HbCheck.fill": c("green"),
            "HbCheck.stroke": { paint: c("green"), width: 2 },
            "HbTick.visible": true,
          },
        }),
      },
      root: {
        dir: "row",
        w: 350,
        gap: 14,
        align: "center",
        pad: [12, 14],
        ...card({ radius: r("md") }),
      },
    },
    (root) => {
      const tile = b.row(root, "Icon tile", {
        key: "HbTile",
        w: 40,
        h: 40,
        radius: r("sm"),
        align: "center",
        justify: "center",
        fill: c("blue-soft"),
      })
      b.icon(tile, "glass-water", 20, c("blue"), { key: "HbIcon" })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Habit", b.ty("label", { size: 15 }), ink, { key: "HbTitle" })
      b.text(t, "0 of 8", b.ty("small"), muted, { key: "HbDetail" })
      const chk = b.row(root, "Check", {
        key: "HbCheck",
        w: 28,
        h: 28,
        radius: r("pill"),
        align: "center",
        justify: "center",
        fill: c("surface"),
        stroke: { paint: c("border"), width: 2 },
      })
      b.icon(chk, "check", 16, c("on-accent"), { key: "HbTick", visible: false, strokeWidth: 3 })
    },
  )

  const workoutCard = b.component(
    "Workout card",
    {
      key: "WCard",
      section: "Data",
      props: {
        eyebrow: p.text("WcEye", "Today"),
        title: p.text("WcTitle", "Workout"),
        duration: p.text("WcDur", "45 min"),
        kcal: p.text("WcKcal", "380 kcal"),
        art: p.variants({
          strength: { "WcArt.fill": grad("art-1", "art-2"), "WcIcon.icon": "dumbbell" },
          run: { "WcArt.fill": grad("art-3", "art-2"), "WcIcon.icon": "footprints" },
          mobility: { "WcArt.fill": grad("art-4", "art-3"), "WcIcon.icon": "person-standing" },
        }),
      },
      root: { dir: "row", w: 350, gap: 14, align: "center", pad: 12, ...card() },
    },
    (root) => {
      const art = b.row(root, "Art", {
        key: "WcArt",
        w: 76,
        h: 76,
        radius: r("md"),
        align: "center",
        justify: "center",
        fill: grad("art-1", "art-2"),
      })
      b.icon(art, "dumbbell", 30, c("on-art"), { key: "WcIcon" })
      const t = b.col(root, "Text", { w: FILL, gap: 6 })
      b.text(t, "Today", b.ty("caption", { case: "upper", letterSpacing: 0.6 }), c("accent"), {
        key: "WcEye",
        name: "Eyebrow",
      })
      b.para(t, "Workout", b.ty("heading"), ink, { key: "WcTitle", name: "Title" })
      const meta = b.row(t, "Meta", { gap: 12, align: "center" })
      for (const [icon, key, val] of [
        ["clock", "WcDur", "45 min"],
        ["flame", "WcKcal", "380 kcal"],
      ] as const) {
        const m = b.row(meta, icon, { gap: 4, align: "center" })
        b.icon(m, icon, 14, muted)
        b.text(m, val, b.ty("small"), muted, { key })
      }
      b.use(root, iconBtn, {
        key: "WcGo",
        args: { variant: "accent" },
        set: { IbIcon: { icon: "play" } },
      })
    },
  )

  const exerciseRow = b.component(
    "Exercise row",
    {
      key: "Exercise",
      section: "Data",
      props: {
        index: p.text("ExNum", "1"),
        name: p.text("ExName", "Exercise"),
        detail: p.text("ExDetail", "4 sets · 8 reps"),
        state: p.variants({
          next: {
            "ExDot.fill": c("subtle"),
            "ExNum.fill": c("ink-2"),
            "ExNum.visible": true,
            "ExTick.visible": false,
            "root.stroke": { paint: c("surface"), width: 1.5 },
          },
          current: {
            "ExDot.fill": c("accent"),
            "ExNum.fill": c("on-accent"),
            "ExNum.visible": true,
            "ExTick.visible": false,
            "root.stroke": { paint: c("accent"), width: 1.5 },
          },
          done: {
            "ExDot.fill": c("green-soft"),
            "ExNum.fill": c("green"),
            "ExNum.visible": false,
            "ExTick.visible": true,
            "root.stroke": { paint: c("surface"), width: 1.5 },
          },
        }),
      },
      root: {
        dir: "row",
        w: 350,
        gap: 14,
        align: "center",
        pad: [12, 14],
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("surface"), width: 1.5 },
      },
    },
    (root) => {
      const dot = b.row(root, "Index", {
        key: "ExDot",
        w: 32,
        h: 32,
        radius: r("pill"),
        align: "center",
        justify: "center",
        fill: c("subtle"),
      })
      b.text(dot, "1", b.ty("label", { size: 13 }), c("ink-2"), { key: "ExNum" })
      b.icon(dot, "check", 16, c("green"), { key: "ExTick", visible: false, strokeWidth: 3 })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Exercise", b.ty("label", { size: 15 }), ink, { key: "ExName" })
      b.text(t, "4 sets · 8 reps", b.ty("small"), muted, { key: "ExDetail" })
      b.icon(root, "chevron-right", 18, muted, { key: "ExChev" })
    },
  )

  const optionCard = b.component(
    "Goal option",
    {
      key: "Option",
      section: "Data",
      props: {
        title: p.text("OpTitle", "Goal"),
        detail: p.text("OpDetail", "What it means."),
        tone: toneVariants("OpTile", "OpIcon"),
        state: p.variants({
          default: {
            "root.stroke": { paint: c("border"), width: 1.5 },
            "OpRadio.stroke": { paint: c("border"), width: 2 },
            "OpRadio.fill": c("surface"),
            "OpDot.visible": false,
          },
          selected: {
            "root.stroke": { paint: c("primary"), width: 1.5 },
            "OpRadio.stroke": { paint: c("primary"), width: 2 },
            "OpRadio.fill": c("primary"),
            "OpDot.visible": true,
          },
        }),
      },
      root: {
        dir: "row",
        w: 350,
        gap: 14,
        align: "center",
        pad: [14, 16],
        radius: r("lg"),
        fill: c("surface"),
        stroke: { paint: c("border"), width: 1.5 },
      },
    },
    (root) => {
      const tile = b.row(root, "Icon tile", {
        key: "OpTile",
        w: 44,
        h: 44,
        radius: r("md"),
        align: "center",
        justify: "center",
        fill: c("accent-soft"),
      })
      b.icon(tile, "dumbbell", 22, c("accent"), { key: "OpIcon" })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Goal", b.ty("label", { size: 15 }), ink, { key: "OpTitle" })
      b.para(t, "What it means.", b.ty("small"), muted, { key: "OpDetail" })
      const radio = b.row(root, "Radio", {
        key: "OpRadio",
        w: 22,
        h: 22,
        radius: r("pill"),
        align: "center",
        justify: "center",
        fill: c("surface"),
        stroke: { paint: c("border"), width: 2 },
      })
      b.ellipse(radio, "Dot", { key: "OpDot", w: 8, h: 8, fill: c("on-primary"), visible: false })
    },
  )

  const settingRow = b.component(
    "Setting row",
    {
      key: "Setting",
      section: "Data",
      description: "List row with a value and chevron, or a toggle.",
      props: {
        label: p.text("SrLbl", "Setting"),
        value: p.text("SrVal", "Value"),
        showValue: p.bool("SrVal", true),
        showChevron: p.bool("SrChev", true),
        showToggle: p.bool("SrTgWrap", false),
        toggle: p.swap("SrToggle", toggle),
        tone: toneVariants("SrTile", "SrIcon"),
      },
      root: { dir: "row", w: 350, gap: 12, align: "center", pad: [11, 14] },
    },
    (root) => {
      const tile = b.row(root, "Icon tile", {
        key: "SrTile",
        w: 32,
        h: 32,
        radius: r("sm"),
        align: "center",
        justify: "center",
        fill: c("subtle"),
      })
      b.icon(tile, "bell", 17, c("ink-2"), { key: "SrIcon" })
      b.text(root, "Setting", b.ty("body", { weight: 500 }), ink, {
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

  // --- Screens helpers ---------------------------------------------------------------------------

  const page = b.page("Screens")
  type TabKey = "today" | "plan" | "progress" | "profile"
  function screen(
    name: string,
    opts: {
      tab?: TabKey
      dark?: boolean
      pad?: (number | ReturnType<typeof s>)[]
      header?: (scr: string) => void
      gap?: number
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
      gap: opts.gap ?? s(6),
      pad: opts.pad ?? [8, 20, 20, 20],
      clip: true,
    })
    const bottom = (fn?: (into: string) => void) => {
      if (opts.tab) b.use(scr, tabBar, { props: { w: FILL }, args: { active: opts.tab } })
      else {
        const bar = b.col(scr, "Bottom bar", { w: FILL, gap: 0 })
        if (fn) {
          const inner = b.col(bar, "Actions", { w: FILL, gap: 10, pad: [12, 20, 4, 20] })
          fn(inner)
        }
        b.use(bar, homeBar, { props: { w: FILL } })
      }
    }
    return { scr, content, bottom }
  }
  const twoLine = (parent: string, eyebrow: string, title: string) => {
    const t = b.col(parent, "Heading", { w: FILL, gap: 4 })
    b.text(t, eyebrow, b.ty("label", { size: 13 }), muted, { name: "Eyebrow" })
    b.para(t, title, b.ty("h1"), ink, { name: "Title" })
    return t
  }

  // --- Cover -------------------------------------------------------------------------------------

  b.cover({
    eyebrow: "Mobile app template",
    title: "Brisk fitness coach",
    description:
      "Onboarding, a daily plan, workout detail, a live workout, progress charts and a profile for an iPhone fitness and habit app. Built from 20 components with light and dark tokens.",
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
          pad: [24, 16],
          radius: 40,
          clip: true,
          fill: c("bg"),
          stroke: { paint: c("border"), width: 1 },
          effects: b.shadow("phone"),
          ...(dark ? { theme: { mode: "dark" } } : {}),
        })
      const a = phone("Today", false)
      twoLine(a, "Tuesday, October 6", "Morning, Maya")
      const ringCard = b.row(a, "Rings", { w: FILL, gap: 14, align: "center", pad: 14, ...card() })
      b.use(ringCard, ring, {
        args: { value: "72%", label: "of move goal", size: "md", tone: "accent" },
        set: sweep(72),
      })
      const rc = b.col(ringCard, "Totals", { w: FILL, gap: 8 })
      for (const [v, l] of [
        ["432 kcal", "of 600 moved"],
        ["24 min", "of 30 exercise"],
      ] as const) {
        const it = b.col(rc, l, { gap: 0 })
        b.text(it, v, b.ty("label", { size: 15 }), ink)
        b.text(it, l, b.ty("small", { size: 12 }), muted)
      }
      b.use(a, workoutCard, {
        props: { w: FILL },
        args: {
          eyebrow: "Today, 18:00",
          title: "Lower body strength",
          duration: "45 min",
          kcal: "380 kcal",
        },
      })
      b.use(a, habitRow, {
        props: { w: FILL },
        args: {
          title: "Drink 2 L of water",
          detail: "5 of 8 glasses",
          tone: "blue",
          state: "todo",
        },
      })
      b.use(a, habitRow, {
        props: { w: FILL },
        args: { title: "Stretch 10 min", detail: "Done at 7:40", tone: "violet", state: "done" },
        set: { HbIcon: { icon: "person-standing" } },
      })
      const d = phone("Workout", true)
      const segs = b.row(d, "Segments", { w: FILL, gap: 4 })
      for (let i = 0; i < 6; i++)
        b.rect(segs, `Exercise ${i + 1}`, {
          w: FILL,
          h: 4,
          radius: r("pill"),
          fill: i < 1 ? c("green") : i === 1 ? c("accent") : c("track"),
        })
      const dh = b.col(d, "Heading", { w: FILL, gap: 4, align: "center" })
      b.text(dh, "Romanian deadlift", b.ty("title", { align: "center" }), ink)
      b.text(dh, "Set 3 of 4 · 8 reps at 40 kg", b.ty("small", { align: "center" }), muted)
      const ringWrap = b.row(d, "Timer", { w: FILL, justify: "center", pad: [12, 0] })
      b.use(ringWrap, ring, {
        args: { value: "0:45", label: "Rest left", size: "lg", tone: "accent" },
        set: sweep(62),
      })
      const ctl = b.row(d, "Controls", { w: FILL, gap: 12, align: "center", justify: "center" })
      b.use(ctl, iconBtn, { args: { variant: "soft" }, set: { IbIcon: { icon: "pause" } } })
      b.use(ctl, button, { props: { w: FILL }, args: { label: "Log set", variant: "accent" } })
      b.use(d, exerciseRow, {
        props: { w: FILL },
        args: { index: "3", name: "Walking lunge", detail: "3 sets · 12 per leg", state: "next" },
      })
    },
  })

  // --- Onboarding --------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Onboarding")
    const top = b.row(content, "Progress", { w: FILL, gap: 12, align: "center" })
    b.use(top, iconBtn, { args: { variant: "surface" } })
    const steps = b.row(top, "Steps", { w: FILL, gap: 6 })
    for (const on of [true, true, false])
      b.rect(steps, on ? "Step done" : "Step", {
        w: FILL,
        h: 4,
        radius: r("pill"),
        fill: on ? c("primary") : c("track"),
      })
    b.text(top, "2 of 3", b.ty("label", { size: 13 }), muted)
    const head = b.col(content, "Heading", { w: FILL, gap: 8 })
    b.para(head, "What do you want\nto work on?", b.ty("h1"), ink)
    b.para(
      head,
      "Pick up to two. Brisk builds your weekly plan around them and you can change them later.",
      b.ty("body"),
      muted,
    )
    const opts = b.col(content, "Options", { w: FILL, gap: 10 })
    for (const [title, detail, tone, icon, sel] of [
      ["Build strength", "Three short lifting sessions a week", "accent", "dumbbell", true],
      ["Run farther", "From 5 km to your first 10 km", "green", "footprints", false],
      ["Sleep better", "A wind-down routine and a steady bedtime", "violet", "moon", true],
      ["Move every day", "8,000 steps and a stretch break", "blue", "activity", false],
    ] as const)
      b.use(opts, optionCard, {
        props: { w: FILL },
        args: { title, detail, tone, state: sel ? "selected" : "default" },
        set: { OpIcon: { icon } },
      })
    const days = b.col(content, "Days", { w: FILL, gap: 12 })
    b.text(days, "Days a week you can train", b.ty("label", { size: 15 }), ink)
    const chips = b.row(days, "Chips", { w: FILL, gap: 8 })
    for (const d of ["2", "3", "4", "5", "6"])
      b.use(chips, chip, {
        props: { w: FILL },
        args: { label: d, state: d === "3" ? "selected" : "default" },
      })
    bottom((into) => {
      b.use(into, button, { props: { w: FILL }, args: { label: "Continue" } })
    })
  }

  // --- Today -------------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Today", { tab: "today" })
    const head = b.row(content, "Header", { w: FILL, gap: 12, align: "center" })
    const ht = b.col(head, "Greeting", { w: FILL, gap: 4 })
    b.text(ht, "Tuesday, October 6", b.ty("label", { size: 13 }), muted)
    b.text(ht, "Morning, Maya", b.ty("display"), ink)
    b.use(head, avatar, { args: { initials: "MO", size: "sm" } })

    const rings = b.row(content, "Rings", { w: FILL, gap: 18, align: "center", pad: 16, ...card() })
    b.use(rings, ring, {
      args: { value: "72%", label: "of move goal", size: "md", tone: "accent" },
      set: sweep(72),
    })
    const totals = b.col(rings, "Totals", { w: FILL, gap: 10 })
    for (const [v, l, tone] of [
      ["432 kcal", "of 600 moved", "accent"],
      ["24 min", "of 30 min exercise", "green"],
      ["6,240", "of 8,000 steps", "blue"],
    ] as const) {
      const it = b.row(totals, l, { w: FILL, gap: 10, align: "center" })
      b.rect(it, "Swatch", { w: 4, h: 30, radius: r("pill"), fill: c(tone) })
      const tx = b.col(it, "Text", { gap: 0 })
      b.text(tx, v, b.ty("label", { size: 15 }), ink)
      b.text(tx, l, b.ty("small", { size: 12 }), muted)
    }

    const plan = b.col(content, "Plan", { w: FILL, gap: 12 })
    b.use(plan, sectionHead, {
      props: { w: FILL },
      args: { title: "Today’s workout", action: "Week plan" },
    })
    b.use(plan, workoutCard, {
      props: { w: FILL },
      args: {
        eyebrow: "Today, 18:00",
        title: "Lower body strength",
        duration: "45 min",
        kcal: "380 kcal",
      },
    })

    const habits = b.col(content, "Habits", { w: FILL, gap: 10 })
    b.use(habits, sectionHead, {
      props: { w: FILL },
      args: { title: "Habits", action: "1 of 3 done" },
    })
    for (const [title, detail, tone, icon, state] of [
      ["Drink 2 L of water", "5 of 8 glasses", "blue", "glass-water", "todo"],
      ["Stretch 10 min", "Done at 7:40", "violet", "person-standing", "done"],
      ["Lights out by 23:00", "Last night 23:12", "neutral", "moon", "todo"],
    ] as const)
      b.use(habits, habitRow, {
        props: { w: FILL },
        args: { title, detail, tone, state },
        set: { HbIcon: { icon } },
      })
    bottom()
  }

  // --- Workout detail ----------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Workout detail", {
      pad: [4, 20, 12, 20],
      gap: 20,
      header: (scr) =>
        b.use(scr, navHeader, {
          props: { w: FILL },
          args: { title: "Workout" },
          set: { NhAct: { args: { variant: "surface" } }, "NhAct/IbIcon": { icon: "bookmark" } },
        }),
    })
    const hero = b.col(content, "Hero", {
      w: FILL,
      h: 112,
      gap: 8,
      pad: 16,
      justify: "between",
      radius: r("xl"),
      fill: grad("art-1", "art-2"),
    })
    const hb = b.row(hero, "Badges", { w: FILL, gap: 6 })
    b.use(hb, badge, { args: { label: "Strength", tone: "glass" } })
    b.use(hb, badge, { args: { label: "Intermediate", tone: "glass" } })
    const hi = b.row(hero, "Mark", { w: FILL, justify: "end" })
    b.icon(hi, "dumbbell", 44, c("on-art"))
    const head = b.col(content, "Heading", { w: FILL, gap: 6 })
    b.para(head, "Lower body strength", b.ty("h1"), ink)
    b.para(
      head,
      "Hinges, squats and lunges. Week 3 adds 2.5 kg to the main lifts.",
      b.ty("body"),
      muted,
    )
    const stats = b.row(content, "Stats", { w: FILL, gap: 10 })
    for (const [value, unit, label, tone, icon] of [
      ["45", "min", "Duration", "accent", "clock"],
      ["6", "moves", "Exercises", "green", "list-checks"],
      ["380", "kcal", "Estimate", "blue", "flame"],
    ] as const)
      b.use(stats, stat, {
        props: { w: 110 },
        args: { value, unit, label, tone },
        set: { SttIcon: { icon } },
      })
    const list = b.col(content, "Exercises", { w: FILL, gap: 8 })
    b.use(list, sectionHead, {
      props: { w: FILL },
      args: { title: "Exercises", action: "Edit" },
    })
    for (const [i, name, detail] of [
      ["1", "Goblet squat", "4 sets · 10 reps · 20 kg"],
      ["2", "Romanian deadlift", "4 sets · 8 reps · 40 kg"],
      ["3", "Walking lunge", "3 sets · 12 per leg"],
    ] as const)
      b.use(list, exerciseRow, {
        props: { w: FILL },
        args: { index: i, name, detail, state: "next" },
      })
    const more = b.row(list, "More", {
      w: FILL,
      gap: 6,
      align: "center",
      justify: "center",
      pad: [4, 0],
    })
    b.text(
      more,
      "3 more: hip thrust, step-up, side plank",
      b.ty("label", { size: 13 }),
      c("accent"),
    )
    b.icon(more, "chevron-down", 16, c("accent"))
    bottom((into) =>
      b.use(into, button, {
        props: { w: FILL },
        args: { label: "Start workout", icon: true, variant: "accent" },
      }),
    )
  }

  // --- Workout in progress (dark) ----------------------------------------------------------------
  {
    const { content, bottom } = screen("Workout in progress", { dark: true, pad: [8, 20, 12, 20] })
    const top = b.row(content, "Top", { w: FILL, gap: 12, align: "center" })
    b.use(top, iconBtn, { args: { variant: "soft" }, set: { IbIcon: { icon: "chevron-down" } } })
    const tt = b.col(top, "Title", { w: FILL, gap: 2, align: "center" })
    b.text(tt, "Lower body strength", b.ty("label", { size: 15, align: "center" }), ink)
    b.text(tt, "18:42 elapsed", b.ty("small", { align: "center" }), muted)
    b.use(top, iconBtn, { args: { variant: "soft" }, set: { IbIcon: { icon: "list-checks" } } })

    const prog = b.col(content, "Workout progress", { w: FILL, gap: 8 })
    const segs = b.row(prog, "Segments", { w: FILL, gap: 4 })
    for (let i = 0; i < 6; i++)
      b.rect(segs, `Exercise ${i + 1}`, {
        w: FILL,
        h: 4,
        radius: r("pill"),
        fill: i < 1 ? c("green") : i === 1 ? c("accent") : c("track"),
      })
    b.text(prog, "Exercise 2 of 6", b.ty("small"), muted)

    const now = b.col(content, "Now", { w: FILL, gap: 6, align: "center" })
    b.text(now, "Romanian deadlift", b.ty("h1", { align: "center" }), ink)
    b.text(now, "Set 3 of 4", b.ty("body", { align: "center" }), muted)
    const tw = b.row(content, "Timer", { w: FILL, justify: "center" })
    b.use(tw, ring, {
      args: { value: "0:45", label: "Rest left", size: "lg", tone: "accent" },
      set: sweep(62),
    })
    const st = b.row(content, "Targets", { w: FILL, gap: 10 })
    for (const [value, unit, label, tone, icon] of [
      ["8", "reps", "Target", "accent", "repeat"],
      ["40", "kg", "Weight", "green", "dumbbell"],
      ["7", "/10", "Last RPE", "violet", "activity"],
    ] as const)
      b.use(st, stat, {
        props: { w: 110 },
        args: { value, unit, label, tone },
        set: { SttIcon: { icon } },
      })
    const next = b.col(content, "Up next", { w: FILL, gap: 8 })
    b.text(next, "Up next", b.ty("label", { size: 13 }), muted)
    b.use(next, exerciseRow, {
      props: { w: FILL },
      args: { index: "3", name: "Walking lunge", detail: "3 sets · 12 per leg", state: "next" },
    })
    bottom((into) => {
      const ctl = b.row(into, "Controls", { w: FILL, gap: 12, align: "center" })
      b.use(ctl, iconBtn, {
        args: { variant: "soft", size: "lg" },
        set: { IbIcon: { icon: "pause" } },
      })
      b.use(ctl, button, {
        props: { w: FILL, h: 64 },
        args: { label: "Log set", variant: "accent", icon: true },
        set: { BtnIcon: { icon: "check" } },
      })
      b.use(ctl, iconBtn, {
        args: { variant: "soft", size: "lg" },
        set: { IbIcon: { icon: "skip-forward" } },
      })
    })
  }

  // --- Progress ----------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Progress", { tab: "progress" })
    b.text(content, "Progress", b.ty("display"), ink)
    b.use(content, segmented, {
      props: { w: FILL },
      args: { first: "Week", second: "Month", third: "Year", active: "second" },
    })
    const stats = b.row(content, "Stats", { w: FILL, gap: 10 })
    for (const [value, unit, label, tone, icon] of [
      ["14", "", "Workouts", "accent", "dumbbell"],
      ["612", "min", "Active time", "green", "timer"],
      ["9", "days", "Streak", "violet", "flame"],
    ] as const)
      b.use(stats, stat, {
        props: { w: 110 },
        args: { value, unit, label, tone },
        set: { SttIcon: { icon } },
        ...(unit ? {} : { hide: ["SttUnit"] }),
      })

    // Bar chart: active minutes per week.
    const bars = b.col(content, "Active minutes", { w: FILL, gap: 14, pad: 16, ...card() })
    const bh = b.row(bars, "Header", { w: FILL, align: "end", justify: "between" })
    const bt = b.col(bh, "Title", { gap: 2 })
    b.text(bt, "Active minutes", b.ty("label", { size: 15 }), ink)
    b.text(bt, "Average 153 a week", b.ty("small"), muted)
    b.use(bh, badge, { args: { label: "+12% vs last month", tone: "green" } })
    const plot = b.row(bars, "Plot", { w: FILL, h: 124, gap: 14, align: "end" })
    const weeks = [
      ["Sep 14", 142],
      ["Sep 21", 136],
      ["Sep 28", 171],
      ["Oct 5", 163],
    ] as const
    weeks.forEach(([wk, v], i) => {
      const last = i === weeks.length - 1
      const colm = b.col(plot, wk, { w: (318 - 3 * 14) / 4, gap: 6, align: "center" })
      b.text(colm, String(v), b.ty("caption"), last ? c("accent") : muted)
      b.rect(colm, "Bar", {
        w: 44,
        h: Math.round((v / 171) * 80),
        radius: [6, 6, 3, 3],
        fill: last ? c("accent") : c("accent-soft"),
      })
      b.text(colm, wk, b.ty("caption", { weight: 500 }), muted)
    })

    // Line chart: goblet squat working weight.
    const line = b.col(content, "Squat weight", { w: FILL, gap: 12, pad: 16, ...card() })
    const lh = b.row(line, "Header", { w: FILL, align: "end", justify: "between" })
    const lt = b.col(lh, "Title", { gap: 2 })
    b.text(lt, "Goblet squat", b.ty("label", { size: 15 }), ink)
    b.text(lt, "Working weight, up from 15 kg", b.ty("small"), muted)
    const lv = b.row(lh, "Value", { gap: 3, align: "baseline" })
    b.text(lv, "20", b.ty("metric", { size: 22 }), ink)
    b.text(lv, "kg", b.ty("small", { weight: 600 }), muted)
    const CW = 318
    const CH = 72
    const chart = b.col(line, "Chart", { w: CW, h: CH })
    const kg = [15, 16, 16, 17.5, 18, 20]
    const pts = kg.map((v, i) => [
      Math.round((i * CW) / (kg.length - 1)),
      Math.round(CH - 6 - ((v - 14) / 6) * (CH - 10)),
    ])
    const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ")
    b.add(chart, {
      type: "path",
      name: "Area",
      x: 0,
      y: 0,
      w: CW,
      h: CH,
      viewBox: [0, 0, CW, CH],
      d: `${path} L${CW} ${CH} L0 ${CH} Z`,
      fill: c("accent-soft"),
      position: "absolute",
      meta: overlay,
    })
    b.add(chart, {
      type: "path",
      name: "Line",
      x: 0,
      y: 0,
      w: CW,
      h: CH,
      viewBox: [0, 0, CW, CH],
      d: path,
      fill: [],
      stroke: { paint: c("accent"), width: 2.5, cap: "round", join: "round" },
      position: "absolute",
      meta: overlay,
    })
    const axis = b.row(line, "Axis", { w: FILL, justify: "between" })
    for (const wk of ["Aug 31", "Sep 7", "Sep 14", "Sep 21", "Sep 28", "Oct 5"])
      b.text(axis, wk, b.ty("caption", { weight: 500 }), muted)
    bottom()
  }

  // --- Profile -----------------------------------------------------------------------------------
  {
    const { content, bottom } = screen("Profile", { tab: "profile", gap: 18 })
    const who = b.col(content, "Identity", { w: FILL, gap: 8, align: "center" })
    b.use(who, avatar, { args: { initials: "MO", size: "lg" } })
    const names = b.col(who, "Names", { gap: 2, align: "center" })
    b.text(names, "Maya Okafor", b.ty("title", { align: "center" }), ink)
    b.text(names, "Member since March 2025 · Lisbon", b.ty("small", { align: "center" }), muted)
    const badges = b.row(who, "Badges", { gap: 6 })
    b.use(badges, badge, { args: { label: "9-day streak", tone: "accent" } })
    b.use(badges, badge, { args: { label: "Strength block, week 3", tone: "green" } })

    const group = (title: string, rows: (into: string) => void) => {
      const g = b.col(content, title, { w: FILL, gap: 8 })
      b.text(g, title, b.ty("label", { size: 13 }), muted, { name: "Group title" })
      const list = b.col(g, "Rows", { w: FILL, ...card(), clip: true })
      rows(list)
    }
    group("Goals", (list) => {
      for (const [label, value, icon, tone] of [
        ["Weekly workouts", "3", "dumbbell", "accent"],
        ["Daily steps", "8,000", "footprints", "blue"],
        ["Bedtime", "23:00", "moon", "violet"],
      ] as const)
        b.use(list, settingRow, {
          props: { w: FILL },
          args: { label, value, tone },
          set: { SrIcon: { icon } },
        })
    })
    group("Reminders and data", (list) => {
      b.use(list, settingRow, {
        props: { w: FILL },
        args: {
          label: "Workout reminders",
          showValue: false,
          showChevron: false,
          showToggle: true,
          tone: "neutral",
        },
        set: { SrIcon: { icon: "bell" } },
      })
      b.use(list, settingRow, {
        props: { w: FILL },
        args: {
          label: "Sync with Apple Health",
          showValue: false,
          showChevron: false,
          showToggle: true,
          toggle: toggleOff,
          tone: "neutral",
        },
        set: { SrIcon: { icon: "heart-pulse" } },
      })
      b.use(list, settingRow, {
        props: { w: FILL },
        args: { label: "Units", value: "kg, km", tone: "neutral" },
        set: { SrIcon: { icon: "ruler" } },
      })
    })
    group("Account", (list) => {
      b.use(list, settingRow, {
        props: { w: FILL },
        args: { label: "Brisk Plus", value: "Renews Nov 12", tone: "accent" },
        set: { SrIcon: { icon: "medal" } },
      })
    })
    bottom()
  }
}
