/**
 * The sample document a new file starts with: the "Loom" marketing hero drawn on the canvas of
 * board "03 Editor — Light" in desing.pen (frames `MyNYM` "Home — Desktop" and `C9zJVV`
 * "Home — Mobile"). Every value is copied from those nodes; the document is built through
 * editor-state ops (one op group), so it goes through validation like any user edit.
 */
import { createEmptyDocument, type DocStore, generateId, type Op } from "@kimo/editor-state"

/** Font family of the design's `$font-sans` variable. */
const SANS = "Inter"
const SERIF = "Fraunces"
/** `$shadow` (light) — the artboard drop shadow in board 03. */
const ARTBOARD_SHADOW = { kind: "shadow", x: 0, y: 1, blur: 3, color: "#0A0A0A0F" } as const

const INK = "#2A1E14"
const MUTED = "#6B5848"
const SAND = "#F6DFC6"
const CREAM = "#FFF7EE"
const CLAY = "#E2683A"
const RUST = "#8A4B1C"

type Body = Record<string, unknown>

/** Builds the op list. Ids are generated so several sample files never collide. */
export function sampleOps(newId: () => string = () => generateId()): Op[] {
  const ops: Op[] = []
  const add = (parent: string | null, node: Body): string => {
    const id = newId()
    ops.push({ op: "insert", id, parent, node: node as never })
    return id
  }
  const text = (parent: string, name: string, content: string, fill: string, style: Body) =>
    add(parent, { type: "text", name, content, fill, style })

  // --- Home — Desktop (MyNYM) ---------------------------------------------------------------
  const desktop = add(null, {
    type: "frame",
    name: "Home — Desktop",
    x: 56,
    y: 62,
    w: 720,
    clip: true,
    fill: CREAM,
    effects: [ARTBOARD_SHADOW],
    layout: { dir: "column" },
  })

  const navbar = add(desktop, {
    type: "frame",
    name: "Navbar",
    w: { mode: "fill" },
    layout: { dir: "row", gap: 28, pad: [18, 40], align: "center" },
  })
  text(navbar, "Brand", "loom.", INK, { font: SERIF, size: 22, weight: 700, letterSpacing: -0.5 })
  add(navbar, { type: "frame", name: "Spacer", w: { mode: "fill" }, h: 1 })
  for (const label of ["Product", "Pricing", "Journal"])
    text(navbar, label, label, MUTED, { font: SANS, size: 13, weight: 500 })
  const signIn = add(navbar, {
    type: "frame",
    name: "Sign in",
    radius: 999,
    stroke: { paint: INK, width: 1 },
    layout: { dir: "row", pad: [8, 14] },
  })
  text(signIn, "Label", "Sign in", INK, { font: SANS, size: 13, weight: 600 })

  const hero = add(desktop, {
    type: "frame",
    name: "Hero",
    w: { mode: "fill" },
    layout: { dir: "column", gap: 18, pad: [48, 40, 40, 40] },
  })
  const eyebrow = add(hero, {
    type: "frame",
    name: "Eyebrow",
    fill: SAND,
    radius: 999,
    layout: { dir: "row", pad: [4, 10] },
  })
  text(eyebrow, "Label", "New · Shared planning boards", RUST, {
    font: SANS,
    size: 12,
    weight: 600,
  })
  text(hero, "Headline", "Plan less.\nShip more together.", INK, {
    font: SERIF,
    size: 52,
    weight: 600,
    lineHeight: 1.02,
    letterSpacing: -1.5,
  })
  add(hero, {
    type: "text",
    name: "Subhead",
    content:
      "Loom turns messy roadmaps into calm weekly plans your whole team can actually follow.",
    fill: MUTED,
    w: 440,
    grow: "fixed-width",
    style: { font: SANS, size: 16, lineHeight: 1.5 },
  })
  const cta = add(hero, {
    type: "frame",
    name: "CTA Row",
    layout: { dir: "row", gap: 10, pad: [6, 0, 0, 0] },
  })
  const primary = add(cta, {
    type: "frame",
    name: "Primary",
    fill: CLAY,
    radius: 999,
    layout: { dir: "row", pad: [12, 20] },
  })
  text(primary, "Label", "Start free", "#FFFFFF", { font: SANS, size: 14, weight: 600 })
  const secondary = add(cta, {
    type: "frame",
    name: "Secondary",
    fill: SAND,
    radius: 999,
    layout: { dir: "row", pad: [12, 20] },
  })
  text(secondary, "Label", "Watch demo", INK, { font: SANS, size: 14, weight: 600 })

  const imageWrap = add(desktop, {
    type: "frame",
    name: "Hero Image Wrap",
    w: { mode: "fill" },
    layout: { dir: "row", pad: [0, 40, 40, 40] },
  })
  add(imageWrap, {
    type: "rect",
    name: "Hero Image",
    w: { mode: "fill" },
    h: 220,
    radius: 20,
    fill: {
      kind: "linear",
      rotation: 200,
      stops: [
        { color: "#F4B183", at: 0 },
        { color: CLAY, at: 0.55 },
        { color: RUST, at: 1 },
      ],
    },
  })

  // --- Home — Mobile (C9zJVV) ---------------------------------------------------------------
  const mobile = add(null, {
    type: "frame",
    name: "Home — Mobile",
    x: 808,
    y: 62,
    w: 280,
    h: 560,
    clip: true,
    fill: CREAM,
    effects: [ARTBOARD_SHADOW],
    layout: { dir: "column", gap: 14, pad: 20 },
  })
  text(mobile, "Brand", "loom.", INK, { font: SERIF, size: 18, weight: 700 })
  add(mobile, {
    type: "text",
    name: "Headline",
    content: "Plan less. Ship more together.",
    fill: INK,
    w: { mode: "fill" },
    grow: "fixed-width",
    style: { font: SERIF, size: 32, weight: 600, lineHeight: 1.05, letterSpacing: -1 },
  })
  return ops
}

/**
 * Fills `store` with the sample design as one op group, then clears the user's undo history so
 * the sample is the starting point rather than an undoable edit.
 */
export function buildSampleDocument(store: DocStore): void {
  const r = store.apply(sampleOps(), { origin: "user", label: "Sample document" })
  if (!r.ok)
    throw new Error(`Sample document rejected: ${r.errors.map((e) => e.message).join("; ")}`)
  store.clearHistory("user")
}

/** A new empty document named `name`. */
export function newDocument(name: string) {
  return createEmptyDocument(name)
}
