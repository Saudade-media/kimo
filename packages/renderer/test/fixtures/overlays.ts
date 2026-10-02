/**
 * Board 10 "Canvas Overlays (M2)" (desing.pen nzfXx) vignettes as renderer scenes: the same
 * world geometry as each 640×420 vignette (viewport at its origin, zoom 1) and the overlay
 * state that produces its marks. Used by the overlay goldens.
 */
import type { Overlay, Viewport } from "../../src"
import type { TestDoc } from "../helpers/scene"

type N = Record<string, unknown>

export interface Vignette {
  doc: TestDoc
  overlay: Overlay
  viewport: Viewport
  width: number
  height: number
  dpr?: number
}

const BG = "#FAFAF9"

function doc(kids: Record<string, N>): TestDoc {
  const nodes: Record<string, N> = {
    paper0001: { type: "rect", parent: null, order: "a", x: 0, y: 0, w: 640, h: 420, fill: BG },
    artbd0001: {
      type: "rect",
      parent: null,
      order: "b",
      x: 40,
      y: 40,
      w: 560,
      h: 340,
      fill: "#FFF7EE",
      effects: [{ kind: "shadow", x: 0, y: 1, blur: 3, color: "#0A0A0A14" }],
    },
  }
  let i = 0
  for (const [k, v] of Object.entries(kids)) nodes[k] = { parent: null, order: `c${i++}`, ...v }
  return { nodes }
}

const base = { selection: [], hovered: null, marquee: null } as Overlay
const v0: Viewport = { x: 0, y: 0, zoom: 1 }

/** #1 O68JG1: snapping while moving. */
export const snapping: Vignette = {
  doc: doc({
    title0001: { type: "rect", x: 80, y: 76, w: 180, h: 16, radius: 3, fill: "#2B2118" },
    image0001: { type: "rect", x: 80, y: 128, w: 240, h: 160, radius: 12, fill: "#E76F51" },
    cardd0001: {
      type: "rect",
      x: 360,
      y: 128,
      w: 200,
      h: 160,
      radius: 12,
      fill: "#F4A261",
      effects: [{ kind: "shadow", x: 0, y: 8, blur: 20, color: "#0A0A0A26" }],
    },
  }),
  overlay: {
    ...base,
    selection: ["cardd0001"],
    sizeLabel: "X 360  Y 128",
    snap: {
      lines: [128, 208, 288].map((at) => ({ axis: "y" as const, at, from: 80, to: 560 })),
      markers: [128, 208, 288].flatMap((y) => [80, 320, 360, 560].map((x) => ({ x, y }))),
    },
  },
  viewport: v0,
  width: 640,
  height: 420,
}

const card = (x: number, fill: string, stroke?: string): N => ({
  type: "rect",
  x,
  y: 140,
  w: 120,
  h: 140,
  radius: 12,
  fill,
  ...(stroke ? { stroke: { paint: stroke, width: 1 } } : {}),
})

/** #2 V6rSVv: equal spacing. */
export const spacing: Vignette = {
  doc: doc({
    card00001: card(80, "#FFFFFF", "#E9DCCB"),
    card00002: card(248, "#F4A261"),
    card00003: card(416, "#FFFFFF", "#E9DCCB"),
  }),
  overlay: {
    ...base,
    selection: ["card00002"],
    sizeLabel: "120 × 140",
    spacing: [
      { axis: "x", from: 200, to: 248, crossFrom: 140, crossTo: 280, label: "48" },
      { axis: "x", from: 368, to: 416, crossFrom: 140, crossTo: 280, label: "48" },
    ],
  },
  viewport: v0,
  width: 640,
  height: 420,
}

const signup = (hoverId: string): Record<string, N> => ({
  parent001: {
    type: "rect",
    x: 80,
    y: 80,
    w: 480,
    h: 260,
    radius: 16,
    fill: "#FFFFFF",
    stroke: { paint: "#E9DCCB", width: 1 },
  },
  head00001: { type: "rect", x: 120, y: 112, w: 160, h: 14, radius: 3, fill: "#2B2118" },
  button001: { type: "rect", x: 200, y: 170, w: 160, h: 48, radius: 24, fill: "#E76F51" },
  [hoverId]: { type: "rect", x: 420, y: 178, w: 100, h: 32, radius: 8, fill: "#F4E3D3" },
})

/** #3a C7xrZ: ⌥ distance, sibling hovered. */
export const measureSibling: Vignette = {
  doc: doc(signup("link00001")),
  overlay: {
    ...base,
    selection: ["button001"],
    hovered: "link00001",
    measureOutlines: [{ id: "link00001", role: "target" }],
    measurements: [{ axis: "x", at: 194, from: 360, to: 420, label: "60" }],
  },
  viewport: v0,
  width: 640,
  height: 420,
}

/** #3b HOGOH: ⌥ distance, nothing hovered (distances to the parent's edges). */
export const measureParent: Vignette = {
  doc: doc(signup("link00002")),
  overlay: {
    ...base,
    selection: ["button001"],
    measureOutlines: [{ id: "parent001", role: "parent" }],
    measurements: [
      { axis: "y", at: 280, from: 80, to: 170, label: "90" },
      { axis: "x", at: 194, from: 80, to: 200, label: "120" },
      { axis: "y", at: 280, from: 218, to: 340, label: "122" },
      { axis: "x", at: 194, from: 360, to: 560, label: "200" },
    ],
  },
  viewport: v0,
  width: 640,
  height: 420,
}

/** #4 hD0aS: pixel grid at 800% over a rounded corner, with the pixel readout. */
export const pixelGrid: Vignette = {
  doc: {
    nodes: {
      paper0002: {
        type: "rect",
        parent: null,
        order: "a",
        x: 0,
        y: 0,
        w: 80,
        h: 53,
        fill: "#FFFFFF",
      },
      shape0001: {
        type: "rect",
        parent: null,
        order: "b",
        x: 20,
        y: 12,
        w: 60,
        h: 41,
        radius: 9,
        fill: "#E76F51",
      },
    },
  },
  overlay: {
    ...base,
    selection: ["shape0001"],
    pixelGrid: true,
    cursorBadge: { text: "x 22 · y 14 · E76F51 66%", screen: { x: 184, y: 224 } },
  },
  viewport: { x: 0, y: 0, zoom: 8 },
  width: 640,
  height: 420,
}

/** #5 cXWyk: pen tool while drawing (closing on the first anchor). */
export const penDrawing: Vignette = {
  doc: doc({}),
  overlay: {
    ...base,
    pen: {
      contour: {
        closed: false,
        anchors: [
          { x: 120, y: 290 },
          { x: 240, y: 140, in: { x: 180, y: 140 }, out: { x: 300, y: 140 } },
          { x: 380, y: 250, in: { x: 330, y: 250 }, out: { x: 430, y: 250 } },
        ],
      },
      active: 2,
      handlesFor: [1, 2],
      preview: { from: { x: 380, y: 250 }, c1: { x: 430, y: 250 }, to: { x: 120, y: 290 } },
      closeHint: true,
    },
  },
  viewport: v0,
  width: 640,
  height: 420,
}

/** #6 B9dJsH: path edit mode with one selected vertex and its badge. */
export const pathEdit: Vignette = {
  doc: doc({
    shape0002: {
      type: "path",
      x: 150,
      y: 100,
      w: 320,
      h: 240,
      viewBox: [150, 100, 320, 240],
      d: "M200 120 C300 100 380 100 460 180 C500 260 420 330 320 320 C240 312 150 280 150 210 C150 160 170 128 200 120 Z",
      fill: "#F4A261",
    },
  }),
  overlay: {
    ...base,
    selection: ["shape0002"],
    pathEdit: {
      nodeId: "shape0002",
      contours: [
        {
          closed: true,
          anchors: [
            { x: 200, y: 120 },
            { x: 460, y: 180, in: { x: 420, y: 100 }, out: { x: 500, y: 260 } },
            { x: 320, y: 320 },
            { x: 150, y: 210 },
          ],
        },
      ],
      selected: [{ contour: 0, index: 1 }],
      badge: "460, 180",
    },
  },
  viewport: v0,
  width: 640,
  height: 420,
}

/** #8 ect1B: resizing a row with layout children (sizing badges, ghost edge, delta). */
export const resizeChildren: Vignette = {
  doc: doc({
    row000001: {
      type: "rect",
      x: 96,
      y: 170,
      w: 464,
      h: 80,
      radius: 12,
      fill: "#FFFFFF",
      stroke: { paint: "#E9DCCB", width: 1 },
    },
    avatar001: { type: "ellipse", x: 112, y: 186, w: 48, h: 48, fill: "#F4A261" },
    textcol01: { type: "rect", x: 176, y: 186, w: 268, h: 48 },
    tline0001: { type: "rect", x: 176, y: 194, w: 160, h: 12, radius: 3, fill: "#2B2118" },
    sline0001: { type: "rect", x: 176, y: 214, w: 220, h: 10, radius: 3, fill: "#E9DCCB" },
    button002: { type: "rect", x: 460, y: 194, w: 84, h: 32, radius: 16, fill: "#2B2118" },
    btnbox001: { type: "rect", x: 460, y: 186, w: 84, h: 48 },
  }),
  overlay: {
    ...base,
    selection: ["row000001"],
    sizeLabel: "464 × Hug 80",
    handles: true,
    resize: {
      children: [
        { id: "avatar001", label: "Fixed 48" },
        { id: "textcol01", label: "Fill ↔" },
        { id: "btnbox001", label: "Hug" },
      ],
      ghostEdge: { axis: "x", at: 500, from: 170, to: 250 },
    },
    cursorBadge: { text: "+60", screen: { x: 564, y: 222 } },
  },
  viewport: v0,
  width: 640,
  height: 420,
}

export const VIGNETTES = {
  "overlay-snapping": snapping,
  "overlay-spacing": spacing,
  "overlay-measure-sibling": measureSibling,
  "overlay-measure-parent": measureParent,
  "overlay-pixel-grid": pixelGrid,
  "overlay-pen": penDrawing,
  "overlay-path-edit": pathEdit,
  "overlay-resize": resizeChildren,
} as const
