/**
 * Synthetic perf document for the M1 gate (teardown 12: "5k-node doc at 60 fps"): `count` nodes
 * as editor-state `insert` ops, shaped like real product screens — root artboards (column
 * auto-layout) holding a navbar row, a hero, and rows of cards; each card nests a column
 * layout (image rect, title, wrapped body text) and a footer row (avatar ellipse, fill spacer,
 * pill button with a label). Mixed node kinds: frames, rects, ellipses, text (fixed-width
 * wrapping and auto-width), gradients, strokes, shadows, clipping. Deterministic for a seed.
 */

type Body = Record<string, unknown>
export interface PerfOp {
  op: "insert"
  id: string
  parent: string | null
  node: Body
}

export interface PerfDoc {
  ops: PerfOp[]
  /** Root artboard ids, left → right, top → bottom. */
  roots: string[]
  /** A card (frame inside an auto-layout row) per root, for selection / edit probes. */
  cards: string[]
  /** A text node inside a card per root. */
  texts: string[]
  count: number
}

const COLS = 8
const ROOT_W = 960
const GAP_X = 120
const GAP_Y = 160
const CARDS_PER_ROW = 4
const ROWS_PER_ROOT = 3

const INKS = ["#1A1A1A", "#2A1E14", "#3B3B3B"]
const FILLS = ["#F4F2EE", "#FFF7EE", "#EEF1F6", "#F6EEF4"]
const ACCENTS = ["#2F6BFF", "#E2683A", "#1F9D8B", "#8A4B1C", "#E0457B"]
const WORDS =
  "plan ship calm weekly roadmap team follow board shared design canvas agent layer frame text".split(
    " ",
  )

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function generatePerfDoc(count = 5000, seed = 1): PerfDoc {
  const rand = rng(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(" ")
  let seq = 0
  // Spec §2 ids: [A-Za-z0-9]{6,24}.
  const nextId = () => `perf${(seq++).toString(36).padStart(6, "0")}`
  const ops: PerfOp[] = []
  const add = (parent: string | null, node: Body): string => {
    const id = nextId()
    ops.push({ op: "insert", id, parent, node })
    return id
  }
  const roots: string[] = []
  const cards: string[] = []
  const texts: string[] = []
  const left = () => count - ops.length

  /** Nodes one card adds (card, image, title, body, footer, avatar, spacer, pill, label). */
  const CARD_NODES = 9
  for (let r = 0; left() > 0; r++) {
    const col = r % COLS
    const row = Math.floor(r / COLS)
    const accent = pick(ACCENTS)
    const root = add(null, {
      type: "frame",
      name: `Screen ${r + 1}`,
      x: col * (ROOT_W + GAP_X),
      y: row * (1400 + GAP_Y),
      w: ROOT_W,
      clip: true,
      fill: pick(FILLS),
      effects: [{ kind: "shadow", x: 0, y: 1, blur: 3, color: "#0A0A0A0F" }],
      layout: { dir: "column", gap: 24, pad: [0, 0, 40, 0] },
    })
    roots.push(root)
    if (left() < 12) {
      while (left() > 0)
        add(root, { type: "rect", w: 40, h: 40, fill: accent, radius: 4, name: "Filler" })
      break
    }
    const nav = add(root, {
      type: "frame",
      name: "Navbar",
      w: { mode: "fill" },
      layout: { dir: "row", gap: 28, pad: [18, 40], align: "center" },
    })
    add(nav, {
      type: "text",
      name: "Brand",
      content: "loom.",
      fill: pick(INKS),
      style: { size: 22, weight: 700 },
    })
    add(nav, { type: "frame", name: "Spacer", w: { mode: "fill" }, h: 1 })
    for (const label of ["Product", "Pricing", "Journal"])
      add(nav, {
        type: "text",
        name: label,
        content: label,
        fill: "#6B5848",
        style: { size: 13, weight: 500 },
      })
    const hero = add(root, {
      type: "frame",
      name: "Hero",
      w: { mode: "fill" },
      layout: { dir: "column", gap: 16, pad: [32, 40] },
    })
    add(hero, {
      type: "text",
      name: "Headline",
      content: `${words(3)}\n${words(2)}`,
      fill: pick(INKS),
      style: { size: 44, weight: 600, lineHeight: 1.05, letterSpacing: -1 },
    })
    add(hero, {
      type: "rect",
      name: "Hero Image",
      w: { mode: "fill" },
      h: 180,
      radius: 20,
      fill: {
        kind: "linear",
        rotation: 200,
        stops: [
          { color: "#F4B183", at: 0 },
          { color: accent, at: 1 },
        ],
      },
    })
    // Card rows.
    let rowFrame: string | null = null
    let inRow = 0
    let rows = 0
    let first = true
    while (left() >= CARD_NODES) {
      if (!rowFrame || inRow === CARDS_PER_ROW) {
        // Three rows of cards per screen, then the next screen.
        if (rows === ROWS_PER_ROOT || left() < CARD_NODES + 1) break
        rows++
        rowFrame = add(root, {
          type: "frame",
          name: "Card Row",
          w: { mode: "fill" },
          layout: { dir: "row", gap: 20, pad: [0, 40] },
        })
        inRow = 0
      }
      const card = add(rowFrame, {
        type: "frame",
        name: "Card",
        w: { mode: "fill" },
        fill: "#FFFFFF",
        radius: 12,
        clip: true,
        stroke: { paint: "#E6E2DC", width: 1 },
        layout: { dir: "column", gap: 10, pad: 14 },
      })
      if (first) cards.push(card)
      add(card, {
        type: "rect",
        name: "Thumb",
        w: { mode: "fill" },
        h: 96,
        radius: 8,
        fill: pick(FILLS),
      })
      const title = add(card, {
        type: "text",
        name: "Title",
        content: words(2),
        fill: pick(INKS),
        style: { size: 15, weight: 600 },
      })
      if (first) texts.push(title)
      add(card, {
        type: "text",
        name: "Body",
        content: words(10),
        fill: "#6B5848",
        w: { mode: "fill" },
        grow: "fixed-width",
        style: { size: 12, lineHeight: 1.4 },
      })
      const footer = add(card, {
        type: "frame",
        name: "Footer",
        w: { mode: "fill" },
        layout: { dir: "row", gap: 8, align: "center" },
      })
      add(footer, { type: "ellipse", name: "Avatar", w: 24, h: 24, fill: accent })
      add(footer, { type: "frame", name: "Spacer", w: { mode: "fill" }, h: 1 })
      const pill = add(footer, {
        type: "frame",
        name: "Pill",
        fill: accent,
        radius: 999,
        layout: { dir: "row", pad: [4, 10] },
      })
      add(pill, {
        type: "text",
        name: "Label",
        content: "Open",
        fill: "#FFFFFF",
        style: { size: 11, weight: 600 },
      })
      first = false
      inRow++
    }
  }
  return { ops, roots, cards, texts, count: ops.length }
}
