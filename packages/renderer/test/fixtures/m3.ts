/**
 * M3 renderer fixtures (ADR 0011): mains, instances (slot content, nested button, theme pin,
 * unresolved placeholder) with variable-bound OKLCH / Display-P3 colors, laid out by the real
 * Yoga engine through the shared expanded view, plus the component overlays of boards 02c /
 * 11 / 12 / 13.
 */
import type { TestDoc } from "../helpers/scene"

type N = Record<string, unknown>

let k = 0
const o = () => `a${String(k++).padStart(4, "0")}`

export const M3_COLORS = {
  /** `ink` (dark surface): OKLCH, in sRGB gamut. */
  ink: { space: "oklch", l: 0.24, c: 0.03, h: 55 },
  /** `accent`: Display-P3 violet, outside sRGB → gamut-mapped. */
  accent: { space: "display-p3", r: 0.45, g: 0.2, b: 0.98 },
  /** `hot`: OKLCH far outside sRGB (chroma 0.4) → gamut-mapped. */
  hot: { space: "oklch", l: 0.65, c: 0.4, h: 25 },
} as const

const nodes: Record<string, N> = {
  paper0001: {
    type: "rect",
    parent: null,
    order: o(),
    x: 0,
    y: 0,
    w: 760,
    h: 420,
    fill: "#FAFAF9",
  },
  // Main: Button (row, pad [6, 12], gap 6, P3 accent fill).
  btn000001: {
    type: "frame",
    parent: null,
    order: o(),
    name: "Button",
    x: 20,
    y: 20,
    component: true,
    radius: 6,
    fill: { $ref: "accent" },
    layout: { dir: "row", gap: 6, pad: [6, 12], align: "center" },
  },
  btnDot001: {
    type: "rect",
    parent: "btn000001",
    order: o(),
    w: 8,
    h: 8,
    radius: 4,
    fill: "#FFFFFF",
  },
  btnBar001: { type: "rect", parent: "btn000001", order: o(), w: 40, h: 6, fill: { $ref: "hot" } },
  // Main: Card (column, pad 12, gap 8) with a title, a slot and a nested Button instance.
  card00001: {
    type: "frame",
    parent: null,
    order: o(),
    name: "Card",
    x: 20,
    y: 80,
    w: 200,
    component: true,
    radius: 8,
    fill: { $ref: "surface" },
    stroke: { paint: "#E7E5E4", width: 1 },
    layout: { dir: "column", gap: 8, pad: 12 },
  },
  cardTitl1: {
    type: "rect",
    parent: "card00001",
    order: o(),
    w: 120,
    h: 12,
    fill: { $ref: "ink-text" },
  },
  cardBody1: {
    type: "frame",
    parent: "card00001",
    order: o(),
    name: "Body",
    w: { mode: "fill" },
    h: { mode: "fit", fallback: 24 },
    slot: {},
    layout: { dir: "column", gap: 4 },
  },
  cardPh001: { type: "rect", parent: "cardBody1", order: o(), w: 176, h: 20, fill: "#D6D3D1" },
  cardCta01: { type: "instance", parent: "card00001", order: o(), of: "btn000001" },
  // Instances.
  inst00001: { type: "instance", parent: null, order: o(), of: "card00001", x: 260, y: 80 },
  inst00002: {
    type: "instance",
    parent: null,
    order: o(),
    of: "card00001",
    x: 500,
    y: 80,
    theme: { mode: "dark" },
    overrides: { cardBody1: { slot: true }, "cardCta01/btnBar001": { set: { w: 80 } } },
  },
  slotA0001: {
    type: "rect",
    parent: "inst00002",
    at: "cardBody1",
    order: o(),
    w: 176,
    h: 10,
    fill: "#A78BFA",
  },
  slotB0001: {
    type: "rect",
    parent: "inst00002",
    at: "cardBody1",
    order: o(),
    w: 90,
    h: 10,
    fill: "#F59E0B",
  },
  inst00003: {
    type: "instance",
    parent: null,
    order: o(),
    of: "card00001",
    x: 260,
    y: 260,
    overrides: { cardBody1: { slot: true } },
  },
  missing01: {
    type: "instance",
    parent: null,
    order: o(),
    of: "gone00001",
    x: 20,
    y: 300,
    props: { w: 120, h: 60 },
  },
}

export const m3Doc: TestDoc = {
  themes: { mode: ["light", "dark"] },
  variables: {
    accent: { type: "color", value: M3_COLORS.accent },
    hot: { type: "color", value: M3_COLORS.hot },
    ink: { type: "color", value: M3_COLORS.ink },
    surface: {
      type: "color",
      value: [
        { value: "#FFFFFF", when: { mode: "light" } },
        { value: { $ref: "ink" }, when: { mode: "dark" } },
      ],
    },
    "ink-text": {
      type: "color",
      value: [
        { value: "#2A1E14", when: { mode: "light" } },
        { value: "#F5EEE6", when: { mode: "dark" } },
      ],
    },
  } as never,
  nodes,
}

/** 1k-instance stress document (perf gate variant): `count` root instances of a 6-node card. */
export function instancesDoc(count: number) {
  const nodes: Record<string, Record<string, unknown>> = {
    card: {
      type: "frame",
      parent: null,
      order: "a",
      x: -400,
      y: 0,
      w: 120,
      component: true,
      radius: 8,
      fill: { $ref: "surface" },
      stroke: { paint: "#E7E5E4", width: 1 },
      layout: { dir: "column", gap: 6, pad: 10 },
    },
    title: { type: "text", parent: "card", order: "a", content: "Card", style: { size: 11 } },
    bar: { type: "rect", parent: "card", order: "b", w: 80, h: 6, fill: { $ref: "accent" } },
    row: { type: "frame", parent: "card", order: "c", layout: { dir: "row", gap: 4 } },
    dot1: { type: "ellipse", parent: "row", order: "a", w: 10, h: 10, fill: "#E76F51" },
    dot2: { type: "ellipse", parent: "row", order: "b", w: 10, h: 10, fill: "#2A9D8F" },
  }
  for (let i = 0; i < count; i++)
    nodes[`i${String(i).padStart(4, "0")}`] = {
      type: "instance",
      parent: null,
      order: `b${String(i).padStart(4, "0")}`,
      of: "card",
      x: (i % 40) * 140,
      y: Math.floor(i / 40) * 90,
      ...(i % 3 === 0 ? { theme: { mode: "dark" } } : {}),
    }
  return {
    themes: { mode: ["light", "dark"] },
    variables: {
      surface: {
        type: "color",
        value: [
          { value: "#FFFFFF", when: { mode: "light" } },
          { value: { space: "oklch", l: 0.24, c: 0.03, h: 55 }, when: { mode: "dark" } },
        ],
      },
      accent: { type: "color", value: { space: "display-p3", r: 0.45, g: 0.2, b: 0.98 } },
    },
    nodes,
  }
}
