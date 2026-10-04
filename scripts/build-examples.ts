/**
 * Builds the example documents in `examples/` from typed `@kimo/editor-state` ops, so they are
 * reproducible and always valid for the current format: every document is created in a
 * `DocStore` (each op group is validated by the store), written with the canonical serializer,
 * then checked like `kimo validate --strict` (no errors, no warnings, libraries loaded). PNG
 * thumbnails (`examples/<name>/preview.png`) come from the headless CanvasKit renderer with the
 * same layout/expansion pipeline as the canvas.
 *
 *   bun scripts/build-examples.ts            write every .kimo and preview.png
 *   bun scripts/build-examples.ts --check    exit 1 when a .kimo on disk differs from the build
 *                                            or does not validate strictly (no rendering)
 *   bun scripts/build-examples.ts --no-png   write the .kimo files only
 *
 * Ids are spelled out and order keys are generated without jitter, so a rebuild is
 * byte-identical.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import {
  type KimoDocument,
  type Libraries,
  mergeDocuments,
  parse,
} from "../packages/core-schema/src/index"
import {
  createDocStore,
  createEmptyDocument,
  type DocStore,
  type Op,
  openDocument,
  serialize,
} from "../packages/editor-state/src/index"

const ROOT = join(import.meta.dir, "..")
const OUT = join(ROOT, "examples")
const CHECK = process.argv.includes("--check")
const PNG = !CHECK && !process.argv.includes("--no-png")

type Body = Record<string, unknown>
const ref = (name: string) => ({ $ref: name })
const FILL = { mode: "fill" } as const

// ---------------------------------------------------------------------------------------------
// A tiny builder over the op vocabulary: header ops first, then node inserts in tree order.
// ---------------------------------------------------------------------------------------------

class Builder {
  readonly header: Op[] = []
  readonly nodes: Op[] = []
  private n = 0
  constructor(
    readonly name: string,
    private readonly prefix: string,
  ) {}

  private nextId(): string {
    this.n += 1
    return `${this.prefix}${this.n.toString().padStart(4, "0")}`
  }

  meta(meta: Record<string, unknown>) {
    this.header.push({ op: "setHeader", set: { meta: { name: this.name, ...meta } } })
    return this
  }
  features(...features: string[]) {
    this.header.push({ op: "setHeader", set: { features: [...features].sort() } })
    return this
  }
  imports(imports: Record<string, string>) {
    this.header.push({ op: "setHeader", set: { imports } })
    return this
  }
  themes(themes: Record<string, string[]>) {
    this.header.push({ op: "setThemes", set: themes })
    return this
  }
  variables(variables: Record<string, unknown>) {
    this.header.push({ op: "setVariables", set: variables as never })
    return this
  }

  /** Inserts a node (appended to its siblings) and returns its id. */
  add(parent: string | null, node: Body, id?: string): string {
    const nid = id ?? this.nextId()
    this.nodes.push({ op: "insert", id: nid, parent, node: node as never })
    return nid
  }
  frame(parent: string | null, name: string, props: Body = {}, id?: string): string {
    return this.add(parent, { type: "frame", name, ...props }, id)
  }
  text(parent: string, name: string, content: unknown, props: Body = {}, id?: string): string {
    return this.add(parent, { type: "text", name, content, ...props }, id)
  }
  icon(parent: string, icon: string, size: number, color: unknown, props: Body = {}): string {
    return this.add(parent, {
      type: "icon",
      name: `Icon/${icon}`,
      set: "lucide",
      icon,
      w: size,
      h: size,
      color,
      ...props,
    })
  }
  instance(parent: string, of: string, props: Body = {}, id?: string): string {
    return this.add(parent, { type: "instance", of, ...props }, id)
  }

  /** Applies everything to a fresh store (validated per op group) and returns it. */
  build(libraries: Libraries = {}): DocStore {
    const store = createDocStore(createEmptyDocument(), {
      jitter: 0,
      validateOptions: { libraries },
    })
    for (const [label, ops] of [
      ["header", this.header],
      ["nodes", this.nodes],
    ] as const) {
      if (ops.length === 0) continue
      const r = store.apply(ops, { origin: "user", label })
      if (!r.ok) {
        console.error(JSON.stringify(r, null, 2))
        throw new Error(`${this.name}: ${label} ops rejected`)
      }
    }
    return store
  }
}

// ---------------------------------------------------------------------------------------------
// 1. Landing page with auto layout
// ---------------------------------------------------------------------------------------------

function landingPage(): Builder {
  const b = new Builder("Lumen — landing page", "lp")
  b.meta({}).variables({
    "color/bg": { type: "color", value: "#FBFAF7", group: "color" },
    "color/surface": { type: "color", value: "#FFFFFF", group: "color" },
    "color/ink": { type: "color", value: "#17140F", group: "color" },
    "color/muted": { type: "color", value: "#6B655B", group: "color" },
    "color/border": { type: "color", value: "#E8E3D9", group: "color" },
    "color/accent": { type: "color", value: "#E4572E", group: "color" },
    "color/on-accent": { type: "color", value: "#FFFFFF", group: "color" },
    "radius/card": { type: "number", value: 20, group: "radius" },
    "radius/pill": { type: "number", value: 999, group: "radius" },
  })
  const ink = ref("color/ink")
  const muted = ref("color/muted")

  const page = b.frame(
    null,
    "Landing — Desktop",
    {
      x: 0,
      y: 0,
      w: 1440,
      fill: ref("color/bg"),
      layout: { dir: "column", align: "center" },
    },
    "lpPageDesk",
  )

  // Nav
  const nav = b.frame(page, "Nav", {
    w: FILL,
    layout: { dir: "row", justify: "between", align: "center", pad: [24, 80] },
  })
  const brand = b.frame(nav, "Brand", { layout: { dir: "row", gap: 10, align: "center" } })
  b.add(brand, {
    type: "ellipse",
    name: "Logo",
    w: 28,
    h: 28,
    fill: {
      kind: "angular",
      stops: [
        { color: "#E4572E", at: 0 },
        { color: "#F3A712", at: 0.5 },
        { color: "#E4572E", at: 1 },
      ],
    },
  })
  b.text(brand, "Wordmark", "Lumen", {
    style: { font: "Inter", size: 20, weight: 700, letterSpacing: -0.4 },
    fill: ink,
  })
  const links = b.frame(nav, "Links", { layout: { dir: "row", gap: 32, align: "center" } })
  for (const l of ["Product", "Pricing", "Customers", "Docs"])
    b.text(links, l, l, { style: { font: "Inter", size: 15, weight: 500 }, fill: muted })
  const navCta = b.frame(nav, "Sign in", {
    radius: ref("radius/pill"),
    stroke: { paint: ref("color/border") },
    layout: { dir: "row", pad: [10, 18] },
  })
  b.text(navCta, "Label", "Sign in", { style: { font: "Inter", size: 14, weight: 600 }, fill: ink })

  // Hero
  const hero = b.frame(page, "Hero", {
    w: FILL,
    layout: { dir: "column", gap: 28, align: "center", pad: [72, 120, 96, 120] },
  })
  const pill = b.frame(hero, "Announcement", {
    radius: ref("radius/pill"),
    fill: ref("color/surface"),
    stroke: { paint: ref("color/border") },
    layout: { dir: "row", gap: 8, align: "center", pad: [6, 14, 6, 6] },
  })
  const tag = b.frame(pill, "Tag", {
    radius: ref("radius/pill"),
    fill: ref("color/accent"),
    layout: { dir: "row", pad: [2, 8] },
  })
  b.text(tag, "Tag label", "New", {
    style: { font: "Inter", size: 12, weight: 700 },
    fill: ref("color/on-accent"),
  })
  b.text(pill, "Message", "Funnels now update in real time", {
    style: { font: "Inter", size: 13, weight: 500 },
    fill: ink,
  })
  b.text(hero, "Headline", "Analytics your whole team actually reads", {
    grow: "fixed-width",
    w: 880,
    style: {
      font: "Inter",
      size: 68,
      weight: 800,
      lineHeight: 1.05,
      letterSpacing: -2,
      align: "center",
    },
    fill: ink,
  })
  b.text(
    hero,
    "Subhead",
    "Lumen turns product events into plain-language answers. No SQL, no dashboards nobody opens — just the numbers that move your week.",
    {
      grow: "fixed-width",
      w: 640,
      style: { font: "Inter", size: 19, weight: 400, lineHeight: 1.5, align: "center" },
      fill: muted,
    },
  )
  const actions = b.frame(hero, "Actions", { layout: { dir: "row", gap: 12, align: "center" } })
  const primary = b.frame(actions, "Primary CTA", {
    radius: ref("radius/pill"),
    fill: ref("color/accent"),
    layout: { dir: "row", gap: 8, align: "center", pad: [14, 24] },
    effects: [{ kind: "shadow", x: 0, y: 8, blur: 24, spread: -8, color: "#E4572E80" }],
  })
  b.text(primary, "Label", "Start free trial", {
    style: { font: "Inter", size: 16, weight: 600 },
    fill: ref("color/on-accent"),
  })
  b.icon(primary, "arrow-right", 18, ref("color/on-accent"))
  const secondary = b.frame(actions, "Secondary CTA", {
    radius: ref("radius/pill"),
    fill: ref("color/surface"),
    stroke: { paint: ref("color/border") },
    layout: { dir: "row", gap: 8, align: "center", pad: [14, 24] },
  })
  b.icon(secondary, "play", 16, ink)
  b.text(secondary, "Label", "Watch the demo", {
    style: { font: "Inter", size: 16, weight: 600 },
    fill: ink,
  })

  // Product shot: a window mock built from frames.
  const shot = b.frame(hero, "Product shot", {
    w: 1120,
    h: 520,
    radius: ref("radius/card"),
    clip: true,
    fill: {
      kind: "linear",
      rotation: 180,
      stops: [
        { color: "#FFE8D6", at: 0 },
        { color: "#FBD3C1", at: 1 },
      ],
    },
    layout: { dir: "column", pad: [40, 56, 0, 56] },
    effects: [{ kind: "shadow", x: 0, y: 30, blur: 60, spread: -20, color: "#17140F33" }],
  })
  const win = b.frame(shot, "Window", {
    w: FILL,
    h: FILL,
    radius: [14, 14, 0, 0],
    fill: ref("color/surface"),
    layout: { dir: "column" },
  })
  const chrome = b.frame(win, "Window bar", {
    w: FILL,
    stroke: { paint: ref("color/border"), width: { b: 1 } },
    layout: { dir: "row", gap: 8, align: "center", pad: [14, 18] },
  })
  for (const c of ["#FF5F57", "#FEBC2E", "#28C840"])
    b.add(chrome, { type: "ellipse", name: "Dot", w: 12, h: 12, fill: c })
  const body = b.frame(win, "Window body", {
    w: FILL,
    h: FILL,
    layout: { dir: "row", gap: 24, pad: 28 },
  })
  const ask = b.frame(body, "Question", {
    w: 300,
    h: FILL,
    radius: 12,
    fill: "#F6F3EE",
    layout: { dir: "column", gap: 12, pad: 20 },
  })
  b.text(ask, "Prompt", "Why did sign-ups dip on Tuesday?", {
    grow: "fixed-width",
    w: 260,
    style: { font: "Inter", size: 16, weight: 600, lineHeight: 1.35 },
    fill: ink,
  })
  b.text(
    ask,
    "Answer",
    "Mobile sign-ups fell 18% after the 2.4 release. Desktop was flat. The new SMS step is where people drop.",
    {
      grow: "fixed-width",
      w: 260,
      style: { font: "Inter", size: 14, lineHeight: 1.5 },
      fill: muted,
    },
  )
  const chart = b.frame(body, "Chart", {
    w: FILL,
    h: FILL,
    layout: { dir: "row", gap: 10, align: "end", pad: [8, 0, 0, 0] },
  })
  const heights = [120, 150, 138, 170, 96, 182, 196, 210, 228, 240, 262, 280]
  for (const [i, h] of heights.entries())
    b.add(chart, {
      type: "rect",
      name: `Bar ${i + 1}`,
      w: FILL,
      h,
      radius: [6, 6, 0, 0],
      fill: i === 4 ? ref("color/accent") : "#F1E4D8",
    })

  // Features
  const features = b.frame(page, "Features", {
    w: FILL,
    layout: { dir: "column", gap: 48, align: "center", pad: [0, 120, 96, 120] },
  })
  b.text(features, "Section title", "Everything you need, nothing you don't", {
    style: { font: "Inter", size: 40, weight: 700, letterSpacing: -1 },
    fill: ink,
  })
  const grid = b.frame(features, "Feature grid", { w: FILL, layout: { dir: "row", gap: 24 } })
  for (const [icon, title, copy] of [
    [
      "message-circle",
      "Ask in plain words",
      "Type a question, get a chart and a sentence that explains it.",
    ],
    [
      "bell-ring",
      "Alerts that matter",
      "Lumen watches your metrics and pings you only when something moves.",
    ],
    [
      "users",
      "Built for teams",
      "Share answers in Slack, pin them to a board, comment in context.",
    ],
  ] as const) {
    const card = b.frame(grid, title, {
      w: FILL,
      radius: ref("radius/card"),
      fill: ref("color/surface"),
      stroke: { paint: ref("color/border") },
      layout: { dir: "column", gap: 14, pad: 28 },
    })
    const badge = b.frame(card, "Icon tile", {
      w: 44,
      h: 44,
      radius: 12,
      fill: "#FDEBE4",
      layout: { dir: "row", justify: "center", align: "center" },
    })
    b.icon(badge, icon, 22, ref("color/accent"))
    b.text(card, "Title", title, { style: { font: "Inter", size: 20, weight: 700 }, fill: ink })
    b.text(card, "Copy", copy, {
      grow: "fixed-width",
      w: 300,
      style: { font: "Inter", size: 15, lineHeight: 1.55 },
      fill: muted,
    })
  }

  // Footer
  const footer = b.frame(page, "Footer", {
    w: FILL,
    stroke: { paint: ref("color/border"), width: { t: 1 } },
    layout: { dir: "row", justify: "between", align: "center", pad: [28, 80] },
  })
  b.text(footer, "Copyright", "© 2026 Lumen Labs", {
    style: { font: "Inter", size: 13 },
    fill: muted,
  })
  const fl = b.frame(footer, "Footer links", { layout: { dir: "row", gap: 24 } })
  for (const l of ["Privacy", "Terms", "Status"])
    b.text(fl, l, l, { style: { font: "Inter", size: 13 }, fill: muted })
  return b
}

// ---------------------------------------------------------------------------------------------
// 2. Mobile app screens (components with text / boolean props, overrides)
// ---------------------------------------------------------------------------------------------

function mobileApp(): Builder {
  const b = new Builder("Streak — mobile screens", "ma")
  b.meta({}).variables({
    "color/bg": { type: "color", value: "#F5F4FF", group: "color" },
    "color/surface": { type: "color", value: "#FFFFFF", group: "color" },
    "color/ink": { type: "color", value: "#15132B", group: "color" },
    "color/muted": { type: "color", value: "#6E6A8C", group: "color" },
    "color/line": { type: "color", value: "#E6E3F5", group: "color" },
    "color/accent": { type: "color", value: "#6C4CF5", group: "color" },
    "color/accent-soft": { type: "color", value: "#ECE7FF", group: "color" },
    "color/on-accent": { type: "color", value: "#FFFFFF", group: "color" },
    "space/screen": { type: "number", value: 24, group: "space" },
  })
  const ink = ref("color/ink")
  const muted = ref("color/muted")
  const accent = ref("color/accent")
  const sans = (size: number, weight = 400, extra: Body = {}) => ({
    font: "Inter",
    size,
    weight,
    ...extra,
  })

  // Components board
  const lib = b.frame(null, "Components", {
    x: 0,
    y: 1100,
    fill: "#FFFFFF",
    radius: 24,
    layout: { dir: "column", gap: 32, pad: 40 },
  })
  // HabitRow: text props name/meta, boolean prop done.
  const row = b.frame(
    lib,
    "Habit row",
    {
      component: {
        props: {
          name: {
            type: "text",
            target: "maRowName1",
            field: "content",
            default: "Habit",
            order: "a0",
          },
          meta: {
            type: "text",
            target: "maRowMeta1",
            field: "content",
            default: "Daily",
            order: "a1",
          },
          done: {
            type: "boolean",
            target: "maRowChk01",
            field: "visible",
            default: true,
            order: "a2",
          },
        },
      },
      w: 342,
      radius: 18,
      fill: ref("color/surface"),
      layout: { dir: "row", gap: 14, align: "center", pad: [14, 16] },
    },
    "maHabitRow",
  )
  const tile = b.frame(row, "Icon tile", {
    w: 44,
    h: 44,
    radius: 14,
    fill: ref("color/accent-soft"),
    layout: { dir: "row", justify: "center", align: "center" },
  })
  b.add(
    tile,
    { type: "icon", name: "Icon", set: "lucide", icon: "sparkles", w: 22, h: 22, color: accent },
    "maRowIcon1",
  )
  const texts = b.frame(row, "Texts", { w: FILL, layout: { dir: "column", gap: 2 } })
  b.text(texts, "Name", "Habit", { style: sans(16, 600), fill: ink }, "maRowName1")
  b.text(texts, "Meta", "Daily", { style: sans(13), fill: muted }, "maRowMeta1")
  const status = b.frame(row, "Status", { w: 28, h: 28 })
  b.add(status, {
    type: "ellipse",
    name: "Ring",
    x: 0,
    y: 0,
    w: 28,
    h: 28,
    stroke: { paint: ref("color/line"), width: 2 },
  })
  const chk = b.frame(
    status,
    "Check",
    {
      x: 0,
      y: 0,
      w: 28,
      h: 28,
      radius: 14,
      fill: accent,
      layout: { dir: "row", justify: "center", align: "center" },
    },
    "maRowChk01",
  )
  b.icon(chk, "check", 16, ref("color/on-accent"), { strokeWidth: 3 })

  // TabBar: four tabs; instances override which one is active.
  const tabs = b.frame(
    lib,
    "Tab bar",
    {
      component: true,
      w: 390,
      fill: ref("color/surface"),
      stroke: { paint: ref("color/line"), width: { t: 1 } },
      layout: { dir: "row", justify: "around", pad: [12, 16, 30, 16] },
    },
    "maTabBar01",
  )
  const tabIds: Record<string, { icon: string; label: string }> = {}
  for (const [key, icon, label] of [
    ["Today", "calendar-check", "Today"],
    ["Stats", "chart-no-axes-column", "Stats"],
    ["Friends", "users", "Friends"],
    ["Me", "circle-user", "Me"],
  ] as const) {
    const t = b.frame(tabs, label, { layout: { dir: "column", gap: 4, align: "center" } })
    const i = b.add(
      t,
      { type: "icon", name: "Icon", set: "lucide", icon, w: 24, h: 24, color: muted },
      `maTab${key}I`.padEnd(10, "0"),
    )
    const l = b.text(
      t,
      "Label",
      label,
      { style: sans(11, 600), fill: muted },
      `maTab${key}L`.padEnd(10, "0"),
    )
    tabIds[key] = { icon: i, label: l }
  }
  const activeTab = (key: string) => {
    const t = tabIds[key] as { icon: string; label: string }
    return { [t.icon]: { set: { color: accent } }, [t.label]: { set: { fill: accent } } }
  }

  // Screens board
  const board = b.frame(
    null,
    "Screens",
    {
      x: 0,
      y: 0,
      fill: "#DCD8F0",
      layout: { dir: "row", gap: 56, pad: 64 },
    },
    "maScreens1",
  )
  const screen = (name: string) =>
    b.frame(board, name, {
      w: 390,
      h: 844,
      radius: 44,
      clip: true,
      fill: ref("color/bg"),
      layout: { dir: "column" },
      effects: [{ kind: "shadow", x: 0, y: 24, blur: 48, spread: -16, color: "#15132B40" }],
    })
  const statusBar = (parent: string) => {
    const s = b.frame(parent, "Status bar", {
      w: FILL,
      layout: { dir: "row", justify: "between", align: "center", pad: [16, 28, 8, 28] },
    })
    b.text(s, "Time", "9:41", { style: sans(15, 600), fill: ink })
    const r = b.frame(s, "Indicators", { layout: { dir: "row", gap: 6, align: "center" } })
    b.icon(r, "signal", 16, ink)
    b.icon(r, "wifi", 16, ink)
    b.icon(r, "battery-full", 20, ink)
  }

  // Screen 1: Welcome
  const s1 = screen("Welcome")
  statusBar(s1)
  const w = b.frame(s1, "Content", {
    w: FILL,
    h: FILL,
    layout: { dir: "column", gap: ref("space/screen"), pad: [24, 24, 40, 24] },
  })
  const art = b.frame(w, "Illustration", {
    w: FILL,
    h: FILL,
    radius: 32,
    clip: true,
    fill: {
      kind: "radial",
      center: [0.3, 0.25],
      size: [1.4, 1.4],
      stops: [
        { color: "#B9A8FF", at: 0 },
        { color: "#6C4CF5", at: 0.55 },
        { color: "#2E1B8F", at: 1 },
      ],
    },
    layout: { dir: "column", justify: "end", pad: 24 },
  })
  b.add(art, {
    type: "ellipse",
    name: "Orb",
    position: "absolute",
    x: 170,
    y: 40,
    w: 140,
    h: 140,
    fill: "#FFFFFF33",
  })
  b.text(art, "Streak count", "21", {
    style: sans(96, 800, { letterSpacing: -4 }),
    fill: ref("color/on-accent"),
  })
  b.text(art, "Streak label", "days in a row", {
    style: sans(18, 600),
    fill: ref("color/on-accent"),
  })
  b.text(w, "Title", "Build habits that stick", {
    style: sans(32, 800, { letterSpacing: -1, lineHeight: 1.1 }),
    fill: ink,
  })
  b.text(w, "Body", "Tiny daily check-ins, gentle reminders and a streak worth protecting.", {
    grow: "fixed-width",
    w: 342,
    style: sans(16, 400, { lineHeight: 1.5 }),
    fill: muted,
  })
  const go = b.frame(w, "Get started", {
    w: FILL,
    radius: 16,
    fill: accent,
    layout: { dir: "row", justify: "center", pad: 16 },
  })
  b.text(go, "Label", "Get started", { style: sans(17, 600), fill: ref("color/on-accent") })
  const signIn = b.frame(w, "Sign in", { w: FILL, layout: { dir: "row", justify: "center" } })
  b.text(signIn, "Label", "I already have an account", { style: sans(15, 600), fill: accent })

  // Screen 2: Today
  const s2 = screen("Today")
  statusBar(s2)
  const today = b.frame(s2, "Content", {
    w: FILL,
    h: FILL,
    layout: { dir: "column", gap: 16, pad: [12, 24] },
  })
  const head = b.frame(today, "Header", {
    w: FILL,
    layout: { dir: "row", justify: "between", align: "center" },
  })
  const ht = b.frame(head, "Titles", { layout: { dir: "column", gap: 2 } })
  b.text(ht, "Date", "Saturday, Oct 4", { style: sans(14, 500), fill: muted })
  b.text(ht, "Title", "Today", { style: sans(32, 800, { letterSpacing: -1 }), fill: ink })
  const avatar = b.frame(head, "Avatar", {
    w: 44,
    h: 44,
    radius: 22,
    fill: "#FFC857",
    layout: { dir: "row", justify: "center", align: "center" },
  })
  b.text(avatar, "Initials", "AL", { style: sans(15, 700), fill: ink })
  const prog = b.frame(today, "Progress card", {
    w: FILL,
    radius: 22,
    fill: {
      kind: "linear",
      rotation: 120,
      stops: [
        { color: "#6C4CF5", at: 0 },
        { color: "#9B7BFF", at: 1 },
      ],
    },
    layout: { dir: "column", gap: 12, pad: 20 },
  })
  b.text(prog, "Label", "3 of 5 done", { style: sans(20, 700), fill: ref("color/on-accent") })
  const track = b.frame(prog, "Track", { w: FILL, h: 8, radius: 4, fill: "#FFFFFF40" })
  b.add(track, {
    type: "rect",
    name: "Value",
    x: 0,
    y: 0,
    w: 181,
    h: 8,
    radius: 4,
    fill: "#FFFFFF",
  })
  b.text(prog, "Hint", "Two more to keep your 21-day streak", {
    style: sans(13, 500),
    fill: ref("color/on-accent"),
  })
  const list = b.frame(today, "Habits", { w: FILL, layout: { dir: "column", gap: 10 } })
  for (const [name, meta, done, icon] of [
    ["Morning run", "5 km · 7:00", true, "footprints"],
    ["Read 20 pages", "Daily", true, "book-open"],
    ["Drink water", "6 of 8 glasses", false, "glass-water"],
    ["Meditate", "10 min", true, "leaf"],
    ["No phone after 10", "Evening", false, "moon"],
  ] as const)
    b.instance(list, "maHabitRow", {
      name,
      props: { w: FILL },
      args: { name, meta, done },
      overrides: { maRowIcon1: { set: { icon } } },
    })
  b.instance(s2, "maTabBar01", { name: "Tab bar", overrides: activeTab("Today") })

  // Screen 3: Habit detail
  const s3 = screen("Habit detail")
  statusBar(s3)
  const det = b.frame(s3, "Content", {
    w: FILL,
    h: FILL,
    layout: { dir: "column", gap: ref("space/screen"), pad: [12, 24] },
  })
  const navRow = b.frame(det, "Nav", {
    w: FILL,
    layout: { dir: "row", justify: "between", align: "center" },
  })
  b.icon(navRow, "chevron-left", 26, ink)
  b.text(navRow, "Title", "Morning run", { style: sans(17, 700), fill: ink })
  b.icon(navRow, "ellipsis", 24, ink)
  const hero = b.frame(det, "Streak", { w: FILL, layout: { dir: "row", gap: 12, align: "end" } })
  b.text(hero, "Number", "21", { style: sans(64, 800, { letterSpacing: -3 }), fill: accent })
  b.text(hero, "Unit", "day streak", { style: sans(17, 600), fill: muted })
  const cal = b.frame(det, "Calendar", {
    w: FILL,
    radius: 22,
    fill: ref("color/surface"),
    layout: { dir: "column", gap: 8, pad: 18 },
  })
  const levels = ["#ECE7FF", "#C9BCFF", "#9B7BFF", "#6C4CF5"]
  for (let r = 0; r < 5; r++) {
    const wk = b.frame(cal, `Week ${r + 1}`, { w: FILL, layout: { dir: "row", gap: 8 } })
    for (let c = 0; c < 7; c++) {
      const v = (r * 7 + c) * 37
      b.add(wk, {
        type: "rect",
        name: "Day",
        w: FILL,
        h: 34,
        radius: 9,
        fill: levels[r * 7 + c >= 14 ? 3 - ((v >> 3) % 2) : (v >> 2) % 4] as string,
      })
    }
  }
  const stats = b.frame(det, "Stats", { w: FILL, layout: { dir: "row", gap: 12 } })
  for (const [label, value] of [
    ["Best streak", "34 days"],
    ["This month", "92%"],
  ] as const) {
    const c = b.frame(stats, label, {
      w: FILL,
      radius: 18,
      fill: ref("color/surface"),
      layout: { dir: "column", gap: 4, pad: 16 },
    })
    b.text(c, "Label", label, { style: sans(13, 500), fill: muted })
    b.text(c, "Value", value, { style: sans(22, 800), fill: ink })
  }
  b.instance(s3, "maTabBar01", {
    name: "Tab bar",
    position: "absolute",
    x: 0,
    y: 760,
    overrides: activeTab("Stats"),
  })
  return b
}

// ---------------------------------------------------------------------------------------------
// 3. Dashboard: components + derived variants + variables over two theme axes
// ---------------------------------------------------------------------------------------------

function dashboard(): Builder {
  const b = new Builder("Northwind — dashboard", "db")
  const themed = (light: string, dark: string, group = "color") => ({
    type: "color",
    group,
    value: [
      { value: light, when: { mode: "light" } },
      { value: dark, when: { mode: "dark" } },
    ],
  })
  const dense = (comfortable: number, compact: number) => ({
    type: "number",
    group: "space",
    value: [
      { value: comfortable, when: { density: "comfortable" } },
      { value: compact, when: { density: "compact" } },
    ],
  })
  b.meta({ "kimo.themes.order": ["mode", "density"] })
    .themes({ mode: ["light", "dark"], density: ["comfortable", "compact"] })
    .variables({
      "color/bg": themed("#F5F6F8", "#0B0D12"),
      "color/surface": themed("#FFFFFF", "#141821"),
      "color/border": themed("#E4E7EC", "#262B36"),
      "color/ink": themed("#101828", "#F2F4F7"),
      "color/muted": themed("#667085", "#98A2B3"),
      "color/accent": themed("#4F46E5", "#8B8CFA"),
      "color/accent-soft": themed("#EEF2FF", "#1F1D4D"),
      "color/success": themed("#067647", "#47CD89"),
      "color/success-soft": themed("#ECFDF3", "#0A2E1D"),
      "color/warning": themed("#B54708", "#FDB022"),
      "color/warning-soft": themed("#FFFAEB", "#3A2108"),
      "color/on-accent": { type: "color", value: "#FFFFFF", group: "color" },
      "space/xs": dense(6, 4),
      "space/s": dense(12, 8),
      "space/m": dense(16, 12),
      "space/l": dense(24, 16),
      "space/xl": dense(32, 20),
      "size/row": {
        type: "number",
        group: "size",
        value: [
          { value: 40, when: { density: "comfortable" } },
          { value: 30, when: { density: "compact" } },
        ],
      },
      "radius/card": { type: "number", value: 12, group: "radius" },
      "radius/control": { type: "number", value: 8, group: "radius" },
    })
  const ink = ref("color/ink")
  const muted = ref("color/muted")
  const sans = (size: number, weight = 400, extra: Body = {}) => ({
    font: "Inter",
    size,
    weight,
    ...extra,
  })
  const card = (extra: Body = {}) => ({
    radius: ref("radius/card"),
    fill: ref("color/surface"),
    stroke: { paint: ref("color/border") },
    ...extra,
  })

  // --- Components board ---
  const comps = b.frame(
    null,
    "Components",
    {
      x: 0,
      y: 1040,
      fill: ref("color/bg"),
      radius: 16,
      layout: { dir: "row", gap: 48, pad: 48, align: "start" },
    },
    "dbCompBrd1",
  )
  const col = (name: string) =>
    b.frame(comps, name, { layout: { dir: "column", gap: 16, align: "start" } })

  // Button/Primary + Button/Secondary (derived)
  const buttons = col("Buttons")
  const btn = b.frame(
    buttons,
    "Button/Primary",
    {
      component: {
        props: {
          label: {
            type: "text",
            target: "dbBtnLabel",
            field: "content",
            default: "Button",
            order: "a0",
          },
        },
      },
      radius: ref("radius/control"),
      fill: ref("color/accent"),
      layout: { dir: "row", gap: 8, align: "center", pad: [8, 14] },
      meta: { "kimo.component.description": "Primary action. One per view." },
    },
    "dbBtnPrim1",
  )
  b.text(
    btn,
    "Label",
    "Button",
    { style: sans(14, 600), fill: ref("color/on-accent") },
    "dbBtnLabel",
  )
  b.instance(
    buttons,
    "dbBtnPrim1",
    {
      name: "Button/Secondary",
      component: true,
      props: { fill: ref("color/surface"), stroke: { paint: ref("color/border") } },
      overrides: { dbBtnLabel: { set: { fill: ink } } },
    },
    "dbBtnSec01",
  )

  // Badge/Success + Badge/Warning (derived)
  const badges = col("Badges")
  const badge = b.frame(
    badges,
    "Badge/Success",
    {
      component: {
        props: {
          label: {
            type: "text",
            target: "dbBdgLabel",
            field: "content",
            default: "+0%",
            order: "a0",
          },
        },
      },
      radius: 999,
      fill: ref("color/success-soft"),
      layout: { dir: "row", gap: 4, align: "center", pad: [2, 8] },
    },
    "dbBdgSucc1",
  )
  b.add(
    badge,
    {
      type: "icon",
      name: "Trend",
      set: "lucide",
      icon: "trending-up",
      w: 14,
      h: 14,
      color: ref("color/success"),
    },
    "dbBdgIcon1",
  )
  b.text(badge, "Label", "+0%", { style: sans(12, 600), fill: ref("color/success") }, "dbBdgLabel")
  b.instance(
    badges,
    "dbBdgSucc1",
    {
      name: "Badge/Warning",
      component: true,
      props: { fill: ref("color/warning-soft") },
      overrides: {
        dbBdgIcon1: { set: { icon: "trending-down", color: ref("color/warning") } },
        dbBdgLabel: { set: { fill: ref("color/warning") } },
      },
    },
    "dbBdgWarn1",
  )

  // NavItem + NavItem/Active (derived)
  const navs = col("Navigation")
  const nav = b.frame(
    navs,
    "NavItem",
    {
      component: {
        props: {
          label: {
            type: "text",
            target: "dbNavLabel",
            field: "content",
            default: "Item",
            order: "a0",
          },
        },
      },
      w: 200,
      radius: ref("radius/control"),
      layout: { dir: "row", gap: 10, align: "center", pad: [7, 10] },
    },
    "dbNavItem1",
  )
  b.add(
    nav,
    { type: "icon", name: "Icon", set: "lucide", icon: "circle", w: 18, h: 18, color: muted },
    "dbNavIcon1",
  )
  b.text(nav, "Label", "Item", { style: sans(14, 500), fill: muted }, "dbNavLabel")
  b.instance(
    navs,
    "dbNavItem1",
    {
      name: "NavItem/Active",
      component: true,
      props: { fill: ref("color/accent-soft") },
      overrides: {
        dbNavIcon1: { set: { color: ref("color/accent") } },
        dbNavLabel: { set: { fill: ref("color/accent"), style: sans(14, 600) } },
      },
    },
    "dbNavActv1",
  )

  // StatCard: text props + an instance prop that swaps the trend badge variant.
  const cards = col("Cards")
  const stat = b.frame(
    cards,
    "StatCard",
    {
      component: {
        props: {
          label: {
            type: "text",
            target: "dbStatLbl1",
            field: "content",
            default: "Metric",
            order: "a0",
          },
          value: {
            type: "text",
            target: "dbStatVal1",
            field: "content",
            default: "0",
            order: "a1",
          },
          delta: {
            type: "text",
            target: "dbStatBdg1/dbBdgLabel",
            field: "content",
            default: "+0%",
            order: "a2",
          },
          trend: { type: "instance", target: "dbStatBdg1", default: "dbBdgSucc1", order: "a3" },
        },
      },
      w: 260,
      ...card({ layout: { dir: "column", gap: ref("space/xs"), pad: ref("space/m") } }),
    },
    "dbStatCrd1",
  )
  b.text(stat, "Label", "Metric", { style: sans(13, 500), fill: muted }, "dbStatLbl1")
  b.text(
    stat,
    "Value",
    "0",
    { style: sans(28, 700, { letterSpacing: -0.6 }), fill: ink },
    "dbStatVal1",
  )
  const foot = b.frame(stat, "Footer", { layout: { dir: "row", gap: 8, align: "center" } })
  b.instance(foot, "dbBdgSucc1", { name: "Trend" }, "dbStatBdg1")
  b.text(foot, "Caption", "vs last month", { style: sans(12), fill: muted })

  // TableRow
  const tr = b.frame(
    cards,
    "TableRow",
    {
      component: {
        props: {
          product: {
            type: "text",
            target: "dbRowProd1",
            field: "content",
            default: "Product",
            order: "a0",
          },
          units: {
            type: "text",
            target: "dbRowUnit1",
            field: "content",
            default: "0",
            order: "a1",
          },
          revenue: {
            type: "text",
            target: "dbRowRev01",
            field: "content",
            default: "$0",
            order: "a2",
          },
        },
      },
      w: 360,
      h: ref("size/row"),
      stroke: { paint: ref("color/border"), width: { t: 1 } },
      layout: { dir: "row", gap: ref("space/s"), align: "center" },
    },
    "dbTableRow",
  )
  b.text(
    tr,
    "Product",
    "Product",
    { w: FILL, grow: "fixed-width", style: sans(14, 500), fill: ink },
    "dbRowProd1",
  )
  b.text(
    tr,
    "Units",
    "0",
    { w: 64, grow: "fixed-width", style: sans(14, 400, { align: "right" }), fill: muted },
    "dbRowUnit1",
  )
  b.text(
    tr,
    "Revenue",
    "$0",
    { w: 88, grow: "fixed-width", style: sans(14, 600, { align: "right" }), fill: ink },
    "dbRowRev01",
  )

  // --- The dashboard itself is a component, so the board can show it under two themes ---
  const board = b.frame(
    null,
    "Dashboard — themes",
    { x: 0, y: 0, fill: "#D0D5DD", layout: { dir: "row", gap: 64, pad: 64 } },
    "dbBoard001",
  )
  const dash = b.frame(
    board,
    "Dashboard",
    {
      component: true,
      w: 1280,
      h: 800,
      clip: true,
      radius: 16,
      fill: ref("color/bg"),
      layout: { dir: "row" },
      meta: { "kimo.component.description": "Overview screen; follows mode and density." },
    },
    "dbDashbrd1",
  )
  const side = b.frame(dash, "Sidebar", {
    w: 240,
    h: FILL,
    fill: ref("color/surface"),
    stroke: { paint: ref("color/border"), width: { r: 1 } },
    layout: { dir: "column", gap: ref("space/xs"), pad: ref("space/l") },
  })
  const brand = b.frame(side, "Brand", {
    layout: { dir: "row", gap: 10, align: "center", pad: [0, 0, 16, 4] },
  })
  b.add(brand, {
    type: "rect",
    name: "Logo",
    w: 28,
    h: 28,
    radius: 8,
    fill: {
      kind: "linear",
      rotation: 135,
      stops: [
        { color: "#4F46E5", at: 0 },
        { color: "#06B6D4", at: 1 },
      ],
    },
  })
  b.text(brand, "Name", "Northwind", { style: sans(17, 700), fill: ink })
  b.instance(side, "dbNavActv1", {
    args: { label: "Overview" },
    overrides: { dbNavIcon1: { set: { icon: "layout-dashboard" } } },
  })
  for (const [label, icon] of [
    ["Orders", "shopping-bag"],
    ["Customers", "users"],
    ["Products", "package"],
    ["Reports", "chart-line"],
    ["Settings", "settings"],
  ] as const)
    b.instance(side, "dbNavItem1", {
      args: { label },
      overrides: { dbNavIcon1: { set: { icon } } },
    })

  const main = b.frame(dash, "Main", {
    w: FILL,
    h: FILL,
    layout: { dir: "column", gap: ref("space/l"), pad: ref("space/xl") },
  })
  const header = b.frame(main, "Header", {
    w: FILL,
    layout: { dir: "row", justify: "between", align: "center" },
  })
  const titles = b.frame(header, "Titles", { layout: { dir: "column", gap: 4 } })
  b.text(titles, "Title", "Overview", { style: sans(26, 700, { letterSpacing: -0.5 }), fill: ink })
  b.text(titles, "Subtitle", "Last 30 days · updated 2 min ago", { style: sans(14), fill: muted })
  const acts = b.frame(header, "Actions", { layout: { dir: "row", gap: ref("space/s") } })
  b.instance(acts, "dbBtnSec01", { args: { label: "Export" } })
  b.instance(acts, "dbBtnPrim1", { args: { label: "New report" } })

  const stats = b.frame(main, "Stats", { w: FILL, layout: { dir: "row", gap: ref("space/m") } })
  for (const [label, value, delta, warn] of [
    ["Revenue", "$48,290", "+12.4%", false],
    ["Orders", "1,284", "+4.1%", false],
    ["Refunds", "23", "−2.3%", true],
    ["Avg. order", "$37.60", "+1.8%", false],
  ] as const)
    b.instance(stats, "dbStatCrd1", {
      props: { w: FILL },
      args: { label, value, delta, ...(warn ? { trend: "dbBdgWarn1" } : {}) },
    })

  const content = b.frame(main, "Content", {
    w: FILL,
    h: FILL,
    layout: { dir: "row", gap: ref("space/m") },
  })
  const chart = b.frame(content, "Revenue chart", {
    w: { mode: "fill", weight: 1.6 },
    h: FILL,
    ...card({ layout: { dir: "column", gap: ref("space/m"), pad: ref("space/l") } }),
  })
  const ch = b.frame(chart, "Chart header", {
    w: FILL,
    layout: { dir: "row", justify: "between", align: "center" },
  })
  b.text(ch, "Title", "Revenue by week", { style: sans(16, 600), fill: ink })
  b.text(ch, "Total", "$48.3k", { style: sans(16, 700), fill: ref("color/accent") })
  const bars = b.frame(chart, "Bars", {
    w: FILL,
    h: FILL,
    layout: { dir: "row", gap: 10, align: "end" },
  })
  const hs = [96, 132, 118, 160, 142, 188, 170, 214, 196, 240, 228, 268]
  for (const [i, h] of hs.entries())
    b.add(bars, {
      type: "rect",
      name: `Week ${i + 1}`,
      w: FILL,
      h,
      radius: [6, 6, 2, 2],
      fill: i === hs.length - 1 ? ref("color/accent") : ref("color/accent-soft"),
    })
  const table = b.frame(content, "Top products", {
    w: FILL,
    h: FILL,
    ...card({ layout: { dir: "column", pad: ref("space/l"), gap: ref("space/s") } }),
  })
  b.text(table, "Title", "Top products", { style: sans(16, 600), fill: ink })
  for (const [product, units, revenue] of [
    ["Linen shirt", "412", "$12,360"],
    ["Canvas tote", "388", "$7,760"],
    ["Wool beanie", "301", "$6,020"],
    ["Field jacket", "96", "$11,520"],
    ["Rain shell", "88", "$9,680"],
  ] as const)
    b.instance(table, "dbTableRow", { props: { w: FILL }, args: { product, units, revenue } })

  b.instance(board, "dbDashbrd1", {
    name: "Dashboard — dark, compact",
    theme: { mode: "dark", density: "compact" },
  })
  return b
}

// ---------------------------------------------------------------------------------------------
// 4. Design system library (+ a document that imports it)
// ---------------------------------------------------------------------------------------------

const DS_ALIAS = "ds"
const DS_PATH = "../design-system/kimo-ds.lib.kimo"

function designSystem(): Builder {
  const b = new Builder("Kimo DS", "ds")
  const themed = (light: string, dark: string) => ({
    type: "color",
    group: "color",
    value: [
      { value: light, when: { mode: "light" } },
      { value: dark, when: { mode: "dark" } },
    ],
  })
  b.meta({ library: true })
    .features("tokens/composite")
    .themes({ mode: ["light", "dark"] })
    .variables({
      "color/bg": themed("#F7F7F8", "#0E0F12"),
      "color/surface": themed("#FFFFFF", "#17191E"),
      "color/border": themed("#E3E4E8", "#2A2D35"),
      "color/ink": themed("#111216", "#F3F4F6"),
      "color/muted": themed("#5F6370", "#9CA0AB"),
      "color/accent": themed("#2563EB", "#60A5FA"),
      "color/accent-soft": themed("#E8F0FE", "#13233F"),
      "color/danger": themed("#DC2626", "#F87171"),
      "color/on-accent": { type: "color", value: "#FFFFFF", group: "color" },
      "radius/control": { type: "number", value: 8, group: "radius" },
      "radius/card": { type: "number", value: 14, group: "radius" },
      "space/2": { type: "number", value: 8, group: "space" },
      "space/3": { type: "number", value: 12, group: "space" },
      "space/4": { type: "number", value: 16, group: "space" },
      "space/6": { type: "number", value: 24, group: "space" },
      "type/heading": {
        type: "typography",
        group: "typography",
        value: { font: "Inter", size: 22, weight: 700, lineHeight: 1.25, letterSpacing: -0.3 },
      },
      "type/body": {
        type: "typography",
        group: "typography",
        value: { font: "Inter", size: 14, weight: 400, lineHeight: 1.5 },
      },
      "type/label": {
        type: "typography",
        group: "typography",
        value: { font: "Inter", size: 13, weight: 600 },
      },
      "shadow/card": {
        type: "shadow",
        group: "shadow",
        value: [
          { kind: "shadow", x: 0, y: 1, blur: 2, color: "#1018280F" },
          { kind: "shadow", x: 0, y: 8, blur: 24, spread: -8, color: "#1018281F" },
        ],
      },
    })
  const ink = ref("color/ink")
  const muted = ref("color/muted")

  const board = b.frame(
    null,
    "Kimo DS",
    {
      x: 0,
      y: 0,
      w: 1200,
      fill: ref("color/bg"),
      layout: { dir: "column", gap: 40, pad: 56 },
    },
    "dsBoard001",
  )
  b.text(board, "Title", "Kimo DS", {
    style: { typography: ref("type/heading"), size: 36 },
    fill: ink,
  })
  const section = (title: string, layout: Body = { dir: "row", gap: 24, align: "start" }) => {
    const s = b.frame(board, title, { w: FILL, layout: { dir: "column", gap: 16 } })
    b.text(s, "Heading", title.toUpperCase(), {
      style: { typography: ref("type/label"), letterSpacing: 1 },
      fill: muted,
    })
    return b.frame(s, `${title} row`, { w: FILL, layout })
  }

  // Colors
  const colors = section("Colors", { dir: "row", gap: 16, wrap: false })
  for (const v of ["bg", "surface", "border", "ink", "muted", "accent", "accent-soft", "danger"]) {
    const sw = b.frame(colors, `color/${v}`, { layout: { dir: "column", gap: 8 } })
    b.add(sw, {
      type: "rect",
      name: "Swatch",
      w: 112,
      h: 64,
      radius: ref("radius/control"),
      fill: ref(`color/${v}`),
      stroke: { paint: ref("color/border") },
    })
    b.text(sw, "Name", v, { style: { typography: ref("type/body"), size: 12 }, fill: muted })
  }

  // Buttons
  const buttons = section("Buttons", { dir: "row", gap: 16, align: "center" })
  const btn = b.frame(
    buttons,
    "Button/Primary",
    {
      component: {
        props: {
          label: {
            type: "text",
            target: "DsBtnLabel",
            field: "content",
            default: "Button",
            order: "a0",
          },
        },
      },
      radius: ref("radius/control"),
      fill: ref("color/accent"),
      layout: { dir: "row", gap: 8, align: "center", pad: [10, 16] },
      meta: { "kimo.component.description": "The main call to action." },
    },
    "DsBtnPrim1",
  )
  b.text(
    btn,
    "Label",
    "Button",
    { style: { typography: ref("type/label"), size: 14 }, fill: ref("color/on-accent") },
    "DsBtnLabel",
  )
  b.instance(
    buttons,
    "DsBtnPrim1",
    {
      name: "Button/Secondary",
      component: true,
      props: { fill: ref("color/surface"), stroke: { paint: ref("color/border") } },
      overrides: { DsBtnLabel: { set: { fill: ink } } },
    },
    "DsBtnSec01",
  )
  b.instance(
    buttons,
    "DsBtnPrim1",
    {
      name: "Button/Danger",
      component: true,
      props: { fill: ref("color/danger") },
    },
    "DsBtnDng01",
  )

  // Inputs
  const inputs = section("Inputs", { dir: "row", gap: 24, align: "start" })
  const input = b.frame(
    inputs,
    "Input",
    {
      component: {
        props: {
          label: {
            type: "text",
            target: "DsInpLabel",
            field: "content",
            default: "Label",
            order: "a0",
          },
          placeholder: {
            type: "text",
            target: "DsInpPlace",
            field: "content",
            default: "Placeholder",
            order: "a1",
          },
          hint: {
            type: "text",
            target: "DsInpHint1",
            field: "content",
            default: "Hint",
            order: "a2",
          },
          showHint: {
            type: "boolean",
            target: "DsInpHint1",
            field: "visible",
            default: true,
            order: "a3",
          },
        },
      },
      w: 320,
      layout: { dir: "column", gap: 6 },
    },
    "DsInput001",
  )
  b.text(
    input,
    "Label",
    "Label",
    { style: { typography: ref("type/label") }, fill: ink },
    "DsInpLabel",
  )
  const field = b.frame(input, "Field", {
    w: FILL,
    radius: ref("radius/control"),
    fill: ref("color/surface"),
    stroke: { paint: ref("color/border") },
    layout: { dir: "row", align: "center", pad: [10, 12] },
  })
  b.text(
    field,
    "Placeholder",
    "Placeholder",
    { style: { typography: ref("type/body") }, fill: muted },
    "DsInpPlace",
  )
  b.text(
    input,
    "Hint",
    "Hint",
    { style: { typography: ref("type/body"), size: 12 }, fill: muted },
    "DsInpHint1",
  )
  b.instance(inputs, "DsInput001", {
    name: "Input (example)",
    args: {
      label: "Email",
      placeholder: "ada@example.com",
      hint: "We never share your address.",
    },
  })

  // Badge + Card
  const misc = section("Cards", { dir: "row", gap: 24, align: "start" })
  const badge = b.frame(
    misc,
    "Badge",
    {
      component: {
        props: {
          label: {
            type: "text",
            target: "DsBdgLabel",
            field: "content",
            default: "Badge",
            order: "a0",
          },
        },
      },
      radius: 999,
      fill: ref("color/accent-soft"),
      layout: { dir: "row", pad: [3, 10] },
    },
    "DsBadge001",
  )
  b.text(
    badge,
    "Label",
    "Badge",
    { style: { typography: ref("type/label"), size: 12 }, fill: ref("color/accent") },
    "DsBdgLabel",
  )
  const cardNode = b.frame(
    misc,
    "Card",
    {
      component: {
        props: {
          title: {
            type: "text",
            target: "DsCrdTitle",
            field: "content",
            default: "Card title",
            order: "a0",
          },
          body: {
            type: "text",
            target: "DsCrdBody1",
            field: "content",
            default: "Card body",
            order: "a1",
          },
          content: { type: "slot", target: "DsCrdCont1", order: "a2" },
          actions: { type: "slot", target: "DsCrdActn1", order: "a3" },
        },
      },
      w: 400,
      radius: ref("radius/card"),
      fill: ref("color/surface"),
      stroke: { paint: ref("color/border") },
      effects: ref("shadow/card"),
      layout: { dir: "column", gap: ref("space/4"), pad: ref("space/6") },
    },
    "DsCard0001",
  )
  b.text(
    cardNode,
    "Title",
    "Card title",
    { style: { typography: ref("type/heading"), size: 18 }, fill: ink },
    "DsCrdTitle",
  )
  b.text(
    cardNode,
    "Body",
    "Card body",
    { w: FILL, grow: "fixed-width", style: { typography: ref("type/body") }, fill: muted },
    "DsCrdBody1",
  )
  b.frame(
    cardNode,
    "Content",
    { w: FILL, slot: {}, layout: { dir: "column", gap: ref("space/4") } },
    "DsCrdCont1",
  )
  b.frame(
    cardNode,
    "Actions",
    {
      w: FILL,
      slot: { suggested: ["DsBtnPrim1", "DsBtnSec01", "DsBtnDng01"] },
      layout: { dir: "row", gap: ref("space/2"), justify: "end" },
    },
    "DsCrdActn1",
  )
  const example = b.instance(
    misc,
    "DsCard0001",
    {
      name: "Card (example)",
      args: {
        title: "Invite your team",
        body: "Teammates can comment and edit designs in real time.",
      },
      overrides: { DsCrdActn1: { slot: true } },
    },
    "DsCardEx01",
  )
  b.add(example, { type: "instance", at: "DsCrdActn1", of: "DsBtnSec01", args: { label: "Later" } })
  b.add(example, {
    type: "instance",
    at: "DsCrdActn1",
    of: "DsBtnPrim1",
    args: { label: "Send invites" },
  })
  return b
}

function libraryConsumer(): Builder {
  const b = new Builder("Account settings (uses Kimo DS)", "ac")
  const ds = (name: string) => ref(`${DS_ALIAS}:${name}`)
  const q = (id: string) => `${DS_ALIAS}:${id}`
  b.meta({})
    .features("tokens/composite")
    .imports({ [DS_ALIAS]: DS_PATH })

  const board = b.frame(
    null,
    "Settings — light and dark",
    { x: 0, y: 0, fill: "#C9CCD3", layout: { dir: "row", gap: 64, pad: 64, align: "start" } },
    "acBoard001",
  )
  const page = b.frame(
    board,
    "Settings page",
    {
      component: true,
      w: 760,
      radius: 18,
      fill: ds("color/bg"),
      layout: { dir: "column", gap: 24, pad: 40 },
    },
    "acSettings",
  )
  const head = b.frame(page, "Header", {
    w: FILL,
    layout: { dir: "row", justify: "between", align: "center" },
  })
  const titles = b.frame(head, "Titles", { layout: { dir: "column", gap: 4 } })
  b.text(titles, "Title", "Account settings", {
    style: { typography: ds("type/heading"), size: 28 },
    fill: ds("color/ink"),
  })
  b.text(titles, "Subtitle", "Manage your profile and workspace.", {
    style: { typography: ds("type/body") },
    fill: ds("color/muted"),
  })
  b.instance(head, q("DsBadge001"), { args: { label: "Pro plan" } })

  const contentKey = q("DsCrdCont1")
  const actionsKey = q("DsCrdActn1")
  const profile = b.instance(page, q("DsCard0001"), {
    name: "Profile",
    props: { w: FILL },
    args: {
      title: "Profile",
      body: "This is how teammates see you in comments and on the canvas.",
    },
    overrides: { [contentKey]: { slot: true }, [actionsKey]: { slot: true } },
  })
  b.add(profile, {
    type: "instance",
    at: contentKey,
    of: q("DsInput001"),
    props: { w: FILL },
    args: { label: "Full name", placeholder: "Ada Lovelace", showHint: false },
  })
  b.add(profile, {
    type: "instance",
    at: contentKey,
    of: q("DsInput001"),
    props: { w: FILL },
    args: {
      label: "Email",
      placeholder: "ada@analytical.engine",
      hint: "Used for sign-in and notifications.",
    },
  })
  b.add(profile, {
    type: "instance",
    at: actionsKey,
    of: q("DsBtnSec01"),
    args: { label: "Cancel" },
  })
  b.add(profile, {
    type: "instance",
    at: actionsKey,
    of: q("DsBtnPrim1"),
    args: { label: "Save changes" },
  })

  const danger = b.instance(page, q("DsCard0001"), {
    name: "Danger zone",
    props: { w: FILL },
    args: {
      title: "Danger zone",
      body: "Deleting the workspace removes every file, comment and version. This cannot be undone.",
    },
    overrides: { [contentKey]: { slot: true }, [actionsKey]: { slot: true } },
  })
  b.add(danger, {
    type: "instance",
    at: actionsKey,
    of: q("DsBtnDng01"),
    args: { label: "Delete workspace" },
  })

  b.instance(board, "acSettings", {
    name: "Settings page — dark",
    theme: { [`${DS_ALIAS}:mode`]: "dark" },
  })
  return b
}

// ---------------------------------------------------------------------------------------------
// 5. Merge demo: base / ours / theirs for `kimo merge`
// ---------------------------------------------------------------------------------------------

function mergeBase(): Builder {
  const b = new Builder("Pricing card (merge demo)", "mg")
  b.meta({})
  const cardId = b.frame(
    null,
    "Pricing card",
    {
      x: 0,
      y: 0,
      w: 360,
      radius: 20,
      fill: "#FFFFFF",
      stroke: { paint: "#E4E4E7" },
      layout: { dir: "column", gap: 16, pad: 28 },
    },
    "mgCard0001",
  )
  b.text(
    cardId,
    "Plan",
    "Pro",
    { style: { font: "Inter", size: 18, weight: 600 }, fill: "#52525B" },
    "mgPlan0001",
  )
  b.text(
    cardId,
    "Price",
    "$12/mo",
    { style: { font: "Inter", size: 44, weight: 800, letterSpacing: -1.5 }, fill: "#18181B" },
    "mgPrice001",
  )
  b.frame(
    cardId,
    "Features",
    { w: { mode: "fill" }, layout: { dir: "column", gap: 10 } },
    "mgFeatList",
  )
  for (const [i, f] of ["Unlimited files", "Version history", "Shared libraries"].entries())
    b.text(
      "mgFeatList",
      "Feature",
      `✓  ${f}`,
      { style: { font: "Inter", size: 15 }, fill: "#3F3F46" },
      `mgFeat000${i + 1}`,
    )
  const btn = b.frame(
    cardId,
    "Button",
    {
      w: FILL,
      radius: 12,
      fill: "#18181B",
      layout: { dir: "row", justify: "center", pad: 14 },
    },
    "mgButton01",
  )
  b.text(
    btn,
    "Label",
    "Start free trial",
    { style: { font: "Inter", size: 15, weight: 600 }, fill: "#FFFFFF" },
    "mgBtnLabel",
  )
  return b
}

/** Ours: raise the price (conflicts with theirs) and add a feature line (clean). */
const OURS_OPS: Op[] = [
  { op: "update", id: "mgPrice001", set: { content: "$15/mo" } },
  {
    op: "insert",
    id: "mgFeat0004",
    parent: "mgFeatList",
    node: {
      type: "text",
      name: "Feature",
      content: "✓  Priority support",
      style: { font: "Inter", size: 15 },
      fill: "#3F3F46",
    } as never,
  },
]
/** Theirs: lower the price (conflict), rename the plan and recolor the button (clean). */
const THEIRS_OPS: Op[] = [
  { op: "update", id: "mgPrice001", set: { content: "$10/mo" } },
  { op: "update", id: "mgPlan0001", set: { content: "Pro plan" } },
  { op: "update", id: "mgButton01", set: { fill: "#4F46E5" } },
]

// ---------------------------------------------------------------------------------------------
// Output, validation, thumbnails
// ---------------------------------------------------------------------------------------------

interface Output {
  file: string
  doc: KimoDocument
  libraries: Libraries
  /** Node rendered to `<dir>/preview.png`. */
  preview?: string
}

function strictIssues(text: string, libraries: Libraries): string[] {
  const r = openDocument(text, { libraries, lints: true, allowInvalid: true })
  if (r.readOnly) return r.readOnlyReasons.map((x) => `read-only: ${x.message}`)
  const v = r.validation
  if (!v) return ["not validated"]
  return [...v.errors, ...v.warnings].map((i) => `${i.severity} ${i.code} ${i.path} ${i.message}`)
}

async function renderPreview(out: Output, maxSize = 2000): Promise<Uint8Array> {
  const { createInstanceView, createResolver, createLayoutEngine } = await import(
    "../packages/layout/src/index"
  )
  const { createRenderer } = await import("../packages/renderer/src/index")
  const store = createDocStore(out.doc, { validateOptions: { libraries: out.libraries } })
  const header = () => store.toHeader() as never
  const view = createInstanceView(store, { header, libraries: out.libraries })
  const resolve = createResolver(header, view, { libraries: out.libraries })
  const engine = createLayoutEngine()
  await engine.init()
  const r = createRenderer()
  await r.init({ offlineFonts: true })
  const compute = () =>
    engine.compute({ nodes: store, expanded: view, resolve, measureText: r.textMeasurer() })
  const id = out.preview as string
  let layout = compute()
  const scene = { nodes: view, header, resolve, assets: { load: async () => null } }
  r.setDocument(scene as never)
  r.setLayout(layout)
  await r.ensureFonts?.(id)
  layout = compute()
  r.setLayout(layout)
  const box = layout.nodes.get(id)?.world
  if (!box) throw new Error(`${out.file}: preview node ${id} has no layout`)
  const scale = Math.min(1, maxSize / Math.max(box.w, box.h))
  const png = await r.exportRaster(id, { scale })
  r.dispose()
  engine.dispose()
  return png
}

function outputs(): Output[] {
  const lib = designSystem().build().toDocument()
  const base = mergeBase().build()
  const ours = createDocStore(base.toDocument(), { jitter: 0 })
  const theirs = createDocStore(base.toDocument(), { jitter: 0 })
  for (const [s, ops] of [
    [ours, OURS_OPS],
    [theirs, THEIRS_OPS],
  ] as const) {
    const r = s.apply(ops, { origin: "user" })
    if (!r.ok) throw new Error(`merge demo ops rejected: ${JSON.stringify(r)}`)
  }
  return [
    {
      file: "landing-page/landing.kimo",
      doc: landingPage().build().toDocument(),
      libraries: {},
      preview: "lpPageDesk",
    },
    {
      file: "mobile-app/streak.kimo",
      doc: mobileApp().build().toDocument(),
      libraries: {},
      preview: "maScreens1",
    },
    {
      file: "dashboard/dashboard.kimo",
      doc: dashboard().build().toDocument(),
      libraries: {},
      preview: "dbBoard001",
    },
    { file: "design-system/kimo-ds.lib.kimo", doc: lib, libraries: {}, preview: "dsBoard001" },
    {
      file: "library-consumer/settings.kimo",
      doc: libraryConsumer()
        .build({ [DS_ALIAS]: lib })
        .toDocument(),
      libraries: { [DS_ALIAS]: lib },
      preview: "acBoard001",
    },
    { file: "merge-demo/base.kimo", doc: base.toDocument(), libraries: {}, preview: "mgCard0001" },
    { file: "merge-demo/ours.kimo", doc: ours.toDocument(), libraries: {} },
    { file: "merge-demo/theirs.kimo", doc: theirs.toDocument(), libraries: {} },
  ]
}

async function main() {
  let failed = false
  const docs = outputs()
  for (const out of docs) {
    const path = join(OUT, out.file)
    const text = serialize(out.doc)
    const issues = strictIssues(text, out.libraries)
    if (issues.length > 0) {
      failed = true
      console.error(`✗ ${out.file}: not strictly valid\n  ${issues.join("\n  ")}`)
    }
    if (CHECK) {
      const onDisk = existsSync(path) ? readFileSync(path, "utf8") : null
      if (onDisk !== text) {
        failed = true
        console.error(`✗ ${out.file}: stale (run bun scripts/build-examples.ts)`)
      } else if (issues.length === 0) console.log(`✓ ${out.file}`)
      continue
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
    console.log(`wrote ${relative(ROOT, path)} (${Object.keys(out.doc.nodes).length} nodes)`)
    if (PNG && out.preview) {
      const png = await renderPreview(out)
      const pp = join(dirname(path), "preview.png")
      writeFileSync(pp, png)
      console.log(`wrote ${relative(ROOT, pp)}`)
    }
  }

  // The merge demo must actually produce a stored conflict (and clean changes).
  const read = (f: string) =>
    parse(readFileSync(join(OUT, "merge-demo", f), "utf8")) as KimoDocument
  if (!failed) {
    const r = mergeDocuments({
      base: read("base.kimo"),
      ours: read("ours.kimo"),
      theirs: read("theirs.kimo"),
    })
    const n = Object.keys(r.conflicts).length
    if (n !== 1 || r.changes < 3) {
      failed = true
      console.error(
        `✗ merge-demo: expected 1 conflict and ≥ 3 clean changes, got ${n} / ${r.changes}`,
      )
    } else console.log(`✓ merge-demo: ${n} stored conflict, ${r.changes} clean changes`)
  }
  if (failed) process.exit(1)
}

await main()
