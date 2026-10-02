/**
 * The normative defaults table (teardown 10.3, spec section "Defaults").
 *
 * This object is the single source of truth: the JSON Schema `default` keywords and the
 * serializer's omit logic ({@link stripDefaults}) are both derived from it. A property whose
 * value equals its default is omitted by canonical writers and means the same thing as an
 * absent property.
 */
export const DEFAULTS = {
  /** Fields shared by every node type except `instance` (which only has `position` and `locked`). */
  node: {
    visible: true,
    opacity: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
    position: "auto",
    locked: false,
    component: false,
  },
  frame: { w: { mode: "fit" }, h: { mode: "fit" }, clip: false, radius: 0 },
  rect: { radius: 0 },
  polygon: { radius: 0 },
  ellipse: { innerRadius: 0, startAngle: 0, sweepAngle: 360 },
  path: { fillRule: "nonzero" },
  text: { grow: "auto" },
  script: { clip: false },
  browser: { radius: 0, zoom: 1, scrollX: 0, scrollY: 0 },
  layout: {
    gap: 0,
    crossGap: 0,
    pad: 0,
    justify: "start",
    align: "start",
    wrap: false,
    includeStroke: false,
  },
  /** `{ mode: "fill" }` sizes. `fallback` has no default (absent = none). */
  sizeFill: { weight: 1 },
  stroke: { width: 1, align: "inside", cap: "butt", join: "miter" },
  solid: { blend: "normal", visible: true },
  gradient: {
    center: [0.5, 0.5],
    size: [1, 1],
    rotation: 0,
    interpolation: "srgb",
    opacity: 1,
    blend: "normal",
    visible: true,
  },
  image: { fit: "cover", opacity: 1, blend: "normal", visible: true },
  shadow: { inner: false, spread: 0, blend: "normal" },
  /** OKLCH and Display-P3 color objects. */
  color: { alpha: 1 },
} as const

/** Scope keys of {@link DEFAULTS}. */
export type DefaultScope = keyof typeof DEFAULTS

/**
 * Rows of {@link DEFAULTS} that are not in the teardown's table (10.3) but are fixed by this
 * spec version. Used by the spec document; listed here so that the provenance is reviewable.
 */
export const DEFAULTS_ADDED_IN_SPEC: readonly string[] = [
  "node.locked",
  "node.component",
  "frame.radius",
  "rect.radius",
  "polygon.radius",
  "ellipse.innerRadius",
  "ellipse.startAngle",
  "ellipse.sweepAngle",
  "path.fillRule",
  "script.clip",
  "browser.radius",
  "browser.zoom",
  "browser.scrollX",
  "browser.scrollY",
  "solid.blend",
  "solid.visible",
  "gradient.opacity",
  "gradient.blend",
  "gradient.visible",
  "image.opacity",
  "image.blend",
  "image.visible",
  "shadow.blend",
  "color.alpha",
]
