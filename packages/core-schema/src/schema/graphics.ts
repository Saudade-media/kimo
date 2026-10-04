/**
 * Sizing, layout, paints, strokes and effects (teardown 10.3: `Size`, `Frame.layout`,
 * `Graphics`, `Paint`, `Effect`).
 */
import Type, { type Static } from "typebox"
import { DEFAULTS } from "../defaults"
import {
  ASSET_REF_PATTERN,
  BLEND_MODES,
  Color,
  NonNegNum,
  Num,
  RELATIVE_PATH_PATTERN,
  Ref,
  Strict,
  StringEnum,
  UnitNum,
} from "./primitives"

const D = DEFAULTS
const opt = Type.Optional

// --- Size -------------------------------------------------------------------------------------

const nonNeg = Type.Number({ minimum: 0 })

/** `{ mode: "fit" }`: size to content. `min`/`max` need feature "size/min-max". */
export const SizeFit = Strict({
  mode: Type.Literal("fit"),
  fallback: opt(nonNeg),
  min: opt(nonNeg),
  max: opt(nonNeg),
})

/** `{ mode: "fill" }`: take the parent's free space, shared by `weight`. */
export const SizeFill = Strict({
  mode: Type.Literal("fill"),
  fallback: opt(nonNeg),
  weight: opt(Type.Number({ exclusiveMinimum: 0, default: D.sizeFill.weight })),
  min: opt(nonNeg),
  max: opt(nonNeg),
})

/** A fixed size (number or number binding) or a structured `fit` / `fill` size. */
export const Size = Type.Union([Type.Number({ minimum: 0 }), Ref, SizeFit, SizeFill])
export type Size = Static<typeof Size>

/** Corner radius: one value, or `[topLeft, topRight, bottomRight, bottomLeft]`. */
export const Radius = Type.Union([
  Type.Number({ minimum: 0 }),
  Ref,
  Type.Tuple([NonNegNum, NonNegNum, NonNegNum, NonNegNum]),
])
export type Radius = Static<typeof Radius>

// --- Layout -----------------------------------------------------------------------------------

/** Padding: all sides, `[vertical, horizontal]`, or `[top, right, bottom, left]`. */
export const Padding = Type.Union([
  Type.Number({ minimum: 0 }),
  Ref,
  Type.Tuple([NonNegNum, NonNegNum]),
  Type.Tuple([NonNegNum, NonNegNum, NonNegNum, NonNegNum]),
])
export type Padding = Static<typeof Padding>

export const JUSTIFY = ["start", "center", "end", "between", "around", "evenly"] as const
export const ALIGN = ["start", "center", "end", "stretch", "baseline"] as const

/** Single-axis flex layout of a frame's children. Absent = children placed by x/y. */
export const Layout = Strict({
  dir: StringEnum(["row", "column"] as const),
  gap: opt(Type.Union([Type.Number(), Ref], { default: D.layout.gap })),
  crossGap: opt(Type.Union([Type.Number(), Ref], { default: D.layout.crossGap })),
  pad: opt(Type.Union(Padding.anyOf, { default: D.layout.pad })),
  justify: opt(StringEnum(JUSTIFY, { default: D.layout.justify })),
  align: opt(StringEnum(ALIGN, { default: D.layout.align })),
  wrap: opt(Type.Boolean({ default: D.layout.wrap })),
  includeStroke: opt(Type.Boolean({ default: D.layout.includeStroke })),
})
export type Layout = Static<typeof Layout>

// --- Paint ------------------------------------------------------------------------------------

export const SolidPaint = Strict({
  kind: Type.Literal("solid"),
  color: Color,
  blend: opt(StringEnum(BLEND_MODES, { default: D.solid.blend })),
  visible: opt(Type.Boolean({ default: D.solid.visible })),
})

export const GradientStop = Strict({
  color: Color,
  at: Type.Number({ minimum: 0, maximum: 1, description: "Position along the gradient, 0–1." }),
})

export const GradientPaint = Strict({
  kind: StringEnum(["linear", "radial", "angular"] as const),
  stops: Type.Array(GradientStop, { minItems: 2 }),
  center: opt(Type.Tuple([Type.Number(), Type.Number()], { default: D.gradient.center })),
  size: opt(Type.Tuple([Type.Number(), Type.Number()], { default: D.gradient.size })),
  rotation: opt(Type.Number({ default: D.gradient.rotation })),
  interpolation: opt(StringEnum(["srgb", "oklab"] as const, { default: D.gradient.interpolation })),
  opacity: opt(Type.Union(UnitNum.anyOf, { default: D.gradient.opacity })),
  blend: opt(StringEnum(BLEND_MODES, { default: D.gradient.blend })),
  visible: opt(Type.Boolean({ default: D.gradient.visible })),
})

export const ImagePaint = Strict({
  kind: Type.Literal("image"),
  src: Type.String({ pattern: ASSET_REF_PATTERN, description: "Content-addressed asset." }),
  fit: opt(
    StringEnum(["cover", "contain", "stretch", "tile", "crop"] as const, {
      default: D.image.fit,
      description: '"crop": the `crop` region of the image, stretched to the node box.',
    }),
  ),
  crop: opt(
    Type.Tuple(
      [Type.Number(), Type.Number(), Type.Number(), Type.Number(), Type.Number(), Type.Number()],
      { description: "Affine transform [a, b, c, d, tx, ty] in normalized image space." },
    ),
  ),
  opacity: opt(Type.Union(UnitNum.anyOf, { default: D.image.opacity })),
  blend: opt(StringEnum(BLEND_MODES, { default: D.image.blend })),
  visible: opt(Type.Boolean({ default: D.image.visible })),
})

/** Feature "fill/mesh". `colors` and `points` are row-major, `cols * rows` entries each. */
export const MeshPaint = Strict({
  kind: Type.Literal("mesh"),
  cols: Type.Integer({ minimum: 1 }),
  rows: Type.Integer({ minimum: 1 }),
  colors: Type.Array(Color),
  points: Type.Array(Type.Unknown()),
})

/** Feature "fill/shader". */
export const ShaderPaint = Strict({
  kind: Type.Literal("shader"),
  src: Type.String({ pattern: RELATIVE_PATH_PATTERN }),
  uniforms: opt(Type.Record(Type.String(), Type.Unknown())),
})

/** A paint: a bare color (or binding) or a structured paint object. */
export const Paint = Type.Union([
  Color.anyOf[0],
  Color.anyOf[1],
  Color.anyOf[2],
  Color.anyOf[3],
  SolidPaint,
  GradientPaint,
  ImagePaint,
  MeshPaint,
  ShaderPaint,
])
export type Paint = Static<typeof Paint>

/** One paint or a list; a list paints in order, last on top. `[]` = explicitly no paint. */
export const Paints = Type.Union([...Paint.anyOf, Type.Array(Paint)])
export type Paints = Static<typeof Paints>

// --- Stroke -----------------------------------------------------------------------------------

/** Per-side stroke widths; an absent side has width 0. */
export const StrokeSides = Strict({
  t: opt(NonNegNum),
  r: opt(NonNegNum),
  b: opt(NonNegNum),
  l: opt(NonNegNum),
})

export const Stroke = Strict({
  paint: Paints,
  width: opt(
    Type.Union([Type.Number({ minimum: 0 }), Ref, StrokeSides], { default: D.stroke.width }),
  ),
  align: opt(StringEnum(["inside", "center", "outside"] as const, { default: D.stroke.align })),
  cap: opt(StringEnum(["butt", "round", "square"] as const, { default: D.stroke.cap })),
  join: opt(StringEnum(["miter", "bevel", "round"] as const, { default: D.stroke.join })),
  miterLimit: opt(
    Type.Number({
      minimum: 1,
      default: D.stroke.miterLimit,
      description: "Miter length / stroke width above which a miter join is beveled (SVG).",
    }),
  ),
  dash: opt(Type.Array(Type.Number({ minimum: 0 }))),
})
export type Stroke = Static<typeof Stroke>

// --- Effects ----------------------------------------------------------------------------------

export const ShadowEffect = Strict({
  kind: Type.Literal("shadow"),
  inner: opt(Type.Boolean({ default: D.shadow.inner })),
  x: Num,
  y: Num,
  blur: NonNegNum,
  spread: opt(Type.Union(Num.anyOf, { default: D.shadow.spread })),
  color: Color,
  blend: opt(StringEnum(BLEND_MODES, { default: D.shadow.blend })),
  visible: opt(Type.Boolean({ default: D.shadow.visible })),
})
export type ShadowEffect = Static<typeof ShadowEffect>

export const BlurEffect = Strict({
  kind: Type.Literal("blur"),
  radius: NonNegNum,
  visible: opt(Type.Boolean({ default: D.blur.visible })),
})
export const BackdropBlurEffect = Strict({
  kind: Type.Literal("backdrop-blur"),
  radius: NonNegNum,
  visible: opt(Type.Boolean({ default: D.blur.visible })),
})

export const Effect = Type.Union([ShadowEffect, BlurEffect, BackdropBlurEffect])
export type Effect = Static<typeof Effect>

/** A list of effects, or (feature "tokens/composite") a binding to a shadow variable. */
export const Effects = Type.Union([Type.Array(Effect), Ref])
export type Effects = Static<typeof Effects>
