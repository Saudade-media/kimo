/** M2 golden fixtures (ADR 0010): strokes, blends, effects, images/gradients, paths, icons. */
import type { TestDoc } from "../helpers/scene"

type N = Record<string, unknown>
const n = (o: N) => o

/** Builds a doc: one board + children placed on a grid of `cell`-sized slots. */
function board(id: string, w: number, h: number, fill: string, kids: Record<string, N>): TestDoc {
  const nodes: Record<string, N> = {
    [id]: n({ type: "frame", parent: null, order: "a", x: 0, y: 0, w, h, fill }),
  }
  let i = 0
  for (const [k, v] of Object.entries(kids)) {
    nodes[k] = { parent: id, order: `b${String(i++).padStart(3, "0")}`, ...v }
  }
  return { nodes }
}

const INK = "#1A1A1A"

/** Strokes: per-side dashed (board 08 Hero Image), radii, caps, joins, miter limits, open paths. */
export const strokesM2Doc: TestDoc = board("boardS001", 360, 300, "#FFFFFF", {
  // Board 08 "Hero Image" stroke (kimo-stroke metadata): top + bottom 1, dash 4/2, round caps.
  hero00001: n({
    type: "rect",
    x: 16,
    y: 16,
    w: 100,
    h: 56,
    radius: 16,
    fill: "#F4A261",
    stroke: { paint: "#0A0A0A", width: { t: 1, b: 1 }, cap: "round", dash: [4, 2] },
  }),
  side00001: n({
    type: "rect",
    x: 132,
    y: 16,
    w: 100,
    h: 56,
    fill: "#F4F2EE",
    stroke: { paint: INK, width: { t: 4, r: 1, b: 4, l: 1 }, dash: [8, 4] },
  }),
  side00002: n({
    type: "rect",
    x: 248,
    y: 16,
    w: 96,
    h: 56,
    radius: 12,
    fill: "#F4F2EE",
    stroke: { paint: "#2F6BFF", width: { t: 3, r: 0, b: 1, l: 6 }, align: "center" },
  }),
  dash00001: n({
    type: "rect",
    x: 16,
    y: 92,
    w: 100,
    h: 56,
    radius: 8,
    stroke: { paint: INK, width: 3, align: "outside", dash: [10, 5], cap: "square" },
  }),
  dash00002: n({
    type: "ellipse",
    x: 132,
    y: 92,
    w: 100,
    h: 56,
    stroke: { paint: "#E0457B", width: 4, align: "inside", dash: [1, 6], cap: "round" },
  }),
  dash00003: n({
    type: "rect",
    x: 248,
    y: 92,
    w: 96,
    h: 56,
    stroke: { paint: INK, width: 2, align: "center", dash: [12, 4, 2, 4] },
  }),
  // Sharp V: miter limit 1 bevels, 10 keeps the miter.
  miter0001: n({
    type: "path",
    x: 24,
    y: 172,
    w: 60,
    h: 40,
    viewBox: [0, 0, 60, 40],
    d: "M0 40 L30 0 L60 40",
    stroke: { paint: INK, width: 6, align: "center", join: "miter", miterLimit: 1 },
  }),
  miter0002: n({
    type: "path",
    x: 100,
    y: 172,
    w: 60,
    h: 40,
    viewBox: [0, 0, 60, 40],
    d: "M0 40 L30 0 L60 40",
    stroke: { paint: INK, width: 6, align: "center", join: "miter", miterLimit: 10 },
  }),
  // Open path asked for inside: stroked centered (spec: open contours have no inside).
  open00001: n({
    type: "path",
    x: 176,
    y: 172,
    w: 72,
    h: 40,
    viewBox: [0, 0, 260, 150],
    d: "M0 150C40 50 60 0 120 0 180 0 210 110 260 110",
    stroke: { paint: "#2B2118", width: 3, cap: "round", join: "round" },
  }),
  // Evenodd fill rule + outside stroke on a closed path.
  ring00001: n({
    type: "path",
    x: 268,
    y: 164,
    w: 64,
    h: 64,
    viewBox: [0, 0, 24, 24],
    fillRule: "evenodd",
    d: "M2 2H22V22H2Z M7 7V17H17V7Z",
    fill: "#7B61FF",
    stroke: { paint: INK, width: 2, align: "outside", join: "round" },
  }),
  bevel0001: n({
    type: "polygon",
    x: 24,
    y: 232,
    w: 56,
    h: 52,
    sides: 3,
    fill: "#F5A623",
    stroke: { paint: INK, width: 6, align: "center", join: "bevel" },
  }),
  round0001: n({
    type: "polygon",
    x: 100,
    y: 232,
    w: 56,
    h: 52,
    sides: 5,
    fill: "#F5A623",
    stroke: { paint: INK, width: 6, align: "outside", join: "round" },
  }),
  gradst001: n({
    type: "rect",
    x: 176,
    y: 236,
    w: 160,
    h: 44,
    radius: 22,
    stroke: {
      paint: {
        kind: "linear",
        rotation: 90,
        stops: [
          { color: "#2F6BFF", at: 0 },
          { color: "#E0457B", at: 1 },
        ],
      },
      width: 4,
    },
  }),
})

const BLENDS = [
  "normal",
  "darken",
  "multiply",
  "color-burn",
  "linear-burn",
  "lighten",
  "screen",
  "color-dodge",
  "linear-dodge",
  "overlay",
  "soft-light",
  "hard-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const

/** Every layer blend mode over a two-tone backdrop, plus pass-through vs isolated groups. */
export const blendDoc: TestDoc = (() => {
  const kids: Record<string, N> = {
    backdrop1: n({
      type: "rect",
      x: 0,
      y: 0,
      w: 360,
      h: 120,
      fill: {
        kind: "linear",
        rotation: 90,
        stops: [
          { color: "#2F6BFF", at: 0 },
          { color: "#F5A623", at: 1 },
        ],
      },
    }),
  }
  BLENDS.forEach((b, i) => {
    kids[`blend${String(i).padStart(4, "0")}`] = n({
      type: "rect",
      x: 8 + (i % 9) * 39,
      y: 12 + Math.floor(i / 9) * 52,
      w: 32,
      h: 40,
      radius: 4,
      blend: b,
      fill: "#E0457B",
    })
  })
  // Groups: a frame with pass-through lets its multiply child reach the backdrop; a normal
  // frame isolates it (the child multiplies only with the frame's own transparent layer).
  const nodes = board("boardB001", 360, 200, "#FFFFFF", kids).nodes
  nodes.passf0001 = n({
    type: "frame",
    parent: "boardB001",
    order: "c0",
    x: 16,
    y: 132,
    w: 150,
    h: 56,
    blend: "pass-through",
  })
  nodes.isolf0001 = n({
    type: "frame",
    parent: "boardB001",
    order: "c1",
    x: 194,
    y: 132,
    w: 150,
    h: 56,
  })
  nodes.under0001 = n({
    type: "rect",
    parent: "boardB001",
    order: "b999",
    x: 0,
    y: 124,
    w: 360,
    h: 72,
    fill: "#2F6BFF",
  })
  for (const f of ["passf0001", "isolf0001"]) {
    nodes[`${f.slice(0, 5)}c001`] = n({
      type: "ellipse",
      parent: f,
      order: "a",
      x: 8,
      y: 4,
      w: 64,
      h: 48,
      fill: { kind: "solid", color: "#F5A623", blend: "multiply" },
    })
    nodes[`${f.slice(0, 5)}c002`] = n({
      type: "rect",
      parent: f,
      order: "b",
      x: 80,
      y: 4,
      w: 64,
      h: 48,
      blend: "linear-burn",
      fill: "#E0457B",
    })
  }
  return { nodes }
})()

/** Effects: spread (rect/path/layer), inner shadow spread, hidden effects, blurs, backdrop. */
export const effectsM2Doc: TestDoc = board("boardE001", 360, 320, "#F4F2EE", {
  sprd00001: n({
    type: "rect",
    x: 24,
    y: 24,
    w: 64,
    h: 48,
    radius: 8,
    fill: "#FFFFFF",
    effects: [{ kind: "shadow", x: 0, y: 4, blur: 8, spread: 6, color: "#2F6BFF80" }],
  }),
  sprd00002: n({
    type: "rect",
    x: 120,
    y: 24,
    w: 64,
    h: 48,
    radius: 8,
    fill: "#FFFFFF",
    effects: [{ kind: "shadow", x: 0, y: 10, blur: 6, spread: -6, color: "#00000080" }],
  }),
  sprd00003: n({
    type: "path",
    x: 216,
    y: 20,
    w: 56,
    h: 56,
    viewBox: [0, 0, 24, 24],
    d: "M12 2 L15 9 L22 9 L16.5 14 L18.5 22 L12 17.5 L5.5 22 L7.5 14 L2 9 L9 9 Z",
    fill: "#F5A623",
    effects: [{ kind: "shadow", x: 2, y: 3, blur: 4, spread: 3, color: "#E0457BAA" }],
  }),
  inner0001: n({
    type: "rect",
    x: 296,
    y: 24,
    w: 48,
    h: 48,
    radius: 24,
    fill: "#FFFFFF",
    effects: [{ kind: "shadow", inner: true, x: 0, y: 0, blur: 4, spread: 6, color: "#2F6BFFCC" }],
  }),
  hidden001: n({
    type: "rect",
    x: 24,
    y: 104,
    w: 64,
    h: 48,
    fill: "#7B61FF",
    effects: [
      { kind: "shadow", x: 0, y: 8, blur: 12, color: "#000000AA", visible: false },
      { kind: "blur", radius: 12, visible: false },
      { kind: "shadow", x: 6, y: 6, blur: 0, color: "#1A1A1A" },
    ],
  }),
  lblur0001: n({
    type: "rect",
    x: 120,
    y: 104,
    w: 64,
    h: 48,
    fill: "#E0457B",
    effects: [{ kind: "blur", radius: 6 }],
  }),
  txtsh0001: n({
    type: "text",
    x: 208,
    y: 108,
    content: "Shadow",
    style: { size: 26, weight: 700 },
    fill: "#FFFFFF",
    effects: [{ kind: "shadow", x: 0, y: 2, blur: 4, spread: 2, color: "#1A1A1ACC" }],
  }),
  // Group with a layer shadow (no fill geometry) + opacity.
  grp000001: n({
    type: "group",
    opacity: 0.8,
    effects: [{ kind: "shadow", x: 4, y: 4, blur: 2, color: "#00000066" }],
  }),
  grpc00001: n({
    type: "ellipse",
    parent: "grp000001",
    order: "a",
    x: 24,
    y: 184,
    w: 40,
    h: 40,
    fill: "#1E8E3E",
  }),
  grpc00002: n({
    type: "rect",
    parent: "grp000001",
    order: "b",
    x: 56,
    y: 196,
    w: 40,
    h: 28,
    fill: "#F5A623",
  }),
  // Background blur over stripes; the glass node has opacity < 1 (backdrop is still read).
  strip0001: n({ type: "rect", x: 128, y: 176, w: 12, h: 120, fill: "#1A1A1A" }),
  strip0002: n({ type: "rect", x: 152, y: 176, w: 12, h: 120, fill: "#E0457B" }),
  strip0003: n({ type: "rect", x: 176, y: 176, w: 12, h: 120, fill: "#2F6BFF" }),
  strip0004: n({ type: "rect", x: 200, y: 176, w: 12, h: 120, fill: "#1E8E3E" }),
  strip0005: n({ type: "rect", x: 224, y: 176, w: 12, h: 120, fill: "#F5A623" }),
  glass0001: n({
    type: "rect",
    x: 120,
    y: 196,
    w: 124,
    h: 80,
    radius: 16,
    opacity: 0.9,
    fill: "#FFFFFF59",
    stroke: { paint: "#FFFFFF", width: 1 },
    effects: [{ kind: "backdrop-blur", radius: 10.5 }],
  }),
  // Shadow with a blend mode.
  blsh00001: n({
    type: "rect",
    x: 272,
    y: 196,
    w: 56,
    h: 56,
    radius: 6,
    fill: "#FFFFFF",
    effects: [{ kind: "shadow", x: 6, y: 6, blur: 8, color: "#2F6BFF", blend: "multiply" }],
  }),
})

const IMG = "./assets/0123456789abcdef.png"
const stops = [
  { color: "#2F6BFF", at: 0 },
  { color: "#FFFFFF", at: 0.5 },
  { color: "#E0457B", at: 1 },
]

/** Image fill modes + crop; gradient transforms (center, size, rotation); paint blend + opacity. */
export const paintsM2Doc: TestDoc = board("boardP001", 360, 220, "#F4F2EE", {
  imgcov001: n({
    type: "rect",
    x: 16,
    y: 16,
    w: 72,
    h: 56,
    fill: { kind: "image", src: IMG, fit: "cover" },
  }),
  imgcon001: n({
    type: "rect",
    x: 100,
    y: 16,
    w: 72,
    h: 56,
    fill: { kind: "image", src: IMG, fit: "contain" },
  }),
  imgstr001: n({
    type: "rect",
    x: 184,
    y: 16,
    w: 72,
    h: 56,
    fill: { kind: "image", src: IMG, fit: "stretch" },
  }),
  imgtil001: n({
    type: "rect",
    x: 268,
    y: 16,
    w: 76,
    h: 56,
    fill: { kind: "image", src: IMG, fit: "tile", opacity: 0.6 },
  }),
  // Crop: the box shows the image's top-left quadrant (box [0,1]² → image [0,0.5]²).
  imgcrp001: n({
    type: "rect",
    x: 16,
    y: 88,
    w: 72,
    h: 56,
    radius: 10,
    fill: { kind: "image", src: IMG, crop: [0.5, 0, 0, 0.5, 0, 0] },
  }),
  // Crop with rotation-free offset: right half of the image, stretched.
  imgcrp002: n({
    type: "rect",
    x: 100,
    y: 88,
    w: 72,
    h: 56,
    fill: { kind: "image", src: IMG, crop: [0.5, 0, 0, 1, 0.5, 0] },
  }),
  glin00001: n({
    type: "rect",
    x: 184,
    y: 88,
    w: 72,
    h: 56,
    fill: { kind: "linear", rotation: 45, center: [0.3, 0.5], size: [1, 0.6], stops },
  }),
  grad00001: n({
    type: "rect",
    x: 268,
    y: 88,
    w: 76,
    h: 56,
    fill: { kind: "radial", center: [0.25, 0.3], size: [1.2, 0.6], rotation: 30, stops },
  }),
  gang00001: n({
    type: "ellipse",
    x: 16,
    y: 156,
    w: 56,
    h: 56,
    fill: { kind: "angular", center: [0.4, 0.6], rotation: 90, stops },
  }),
  // board 08 Hero Image gradient: 3 stops, rotation −90, opacity 0.8.
  hero00002: n({
    type: "rect",
    x: 88,
    y: 156,
    w: 120,
    h: 56,
    radius: 12,
    fill: [
      {
        kind: "linear",
        rotation: -90,
        opacity: 0.8,
        stops: [
          { at: 0, color: "#F4A261" },
          { at: 0.55, color: "#E76F51" },
          { at: 1, color: "#6D2E46" },
        ],
      },
    ],
  }),
  pblend001: n({
    type: "rect",
    x: 224,
    y: 156,
    w: 120,
    h: 56,
    fill: [
      "#F5A623",
      {
        kind: "linear",
        rotation: 90,
        blend: "linear-burn",
        stops: [
          { color: "#FFFFFF", at: 0 },
          { color: "#2F6BFF", at: 1 },
        ],
      },
    ],
  }),
})

/** Icons from the four libraries, weights and stroke widths, and a missing glyph. */
export const iconsDoc: TestDoc = board("boardI001", 360, 152, "#FFFFFF", {
  ilucide01: n({
    type: "icon",
    x: 16,
    y: 16,
    w: 32,
    h: 32,
    set: "lucide",
    icon: "pen-tool",
    color: INK,
  }),
  ilucide02: n({
    type: "icon",
    x: 60,
    y: 16,
    w: 32,
    h: 32,
    set: "lucide",
    icon: "star",
    strokeWidth: 1,
    color: "#2F6BFF",
  }),
  ilucide03: n({
    type: "icon",
    x: 104,
    y: 16,
    w: 32,
    h: 32,
    set: "lucide",
    icon: "star",
    strokeWidth: 3,
    color: "#2F6BFF",
  }),
  ilucide04: n({
    type: "icon",
    x: 148,
    y: 16,
    w: 32,
    h: 32,
    set: "lucide",
    icon: "chart-scatter",
    color: INK,
  }),
  ifeathe01: n({
    type: "icon",
    x: 192,
    y: 16,
    w: 32,
    h: 32,
    set: "feather",
    icon: "x",
    color: "#E0457B",
  }),
  ifeathe02: n({
    type: "icon",
    x: 236,
    y: 16,
    w: 32,
    h: 32,
    set: "feather",
    icon: "activity",
    color: INK,
  }),
  imissin01: n({
    type: "icon",
    x: 280,
    y: 16,
    w: 32,
    h: 32,
    set: "lucide",
    icon: "no-such-icon",
    color: INK,
  }),
  imissin02: n({
    type: "icon",
    x: 320,
    y: 16,
    w: 24,
    h: 24,
    set: "unknown-set",
    icon: "x",
    color: INK,
  }),
  iphosp001: n({
    type: "icon",
    x: 16,
    y: 60,
    w: 32,
    h: 32,
    set: "phosphor",
    icon: "house",
    weight: 100,
    color: INK,
  }),
  iphosp002: n({
    type: "icon",
    x: 60,
    y: 60,
    w: 32,
    h: 32,
    set: "phosphor",
    icon: "house",
    weight: 300,
    color: INK,
  }),
  iphosp003: n({
    type: "icon",
    x: 104,
    y: 60,
    w: 32,
    h: 32,
    set: "phosphor",
    icon: "house",
    color: INK,
  }),
  iphosp004: n({
    type: "icon",
    x: 148,
    y: 60,
    w: 32,
    h: 32,
    set: "phosphor",
    icon: "bell",
    weight: 700,
    color: INK,
  }),
  imater001: n({
    type: "icon",
    x: 16,
    y: 104,
    w: 32,
    h: 32,
    set: "material-outlined",
    icon: "home",
    weight: 100,
    color: INK,
  }),
  imater002: n({
    type: "icon",
    x: 60,
    y: 104,
    w: 32,
    h: 32,
    set: "material-outlined",
    icon: "home",
    color: INK,
  }),
  imater003: n({
    type: "icon",
    x: 104,
    y: 104,
    w: 32,
    h: 32,
    set: "material-outlined",
    icon: "home",
    weight: 700,
    color: INK,
  }),
  imater004: n({
    type: "icon",
    x: 148,
    y: 104,
    w: 32,
    h: 32,
    set: "material-rounded",
    icon: "home",
    weight: 300,
    color: "#E0457B",
  }),
  imater005: n({
    type: "icon",
    x: 192,
    y: 104,
    w: 32,
    h: 32,
    set: "material-sharp",
    icon: "settings",
    color: INK,
  }),
  imater006: n({
    type: "icon",
    x: 236,
    y: 96,
    w: 48,
    h: 48,
    set: "material-outlined",
    icon: "favorite",
    color: "#E0457B",
    effects: [{ kind: "shadow", x: 0, y: 2, blur: 4, color: "#00000066" }],
  }),
})
