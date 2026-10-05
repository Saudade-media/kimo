/**
 * The export IR (teardown §9.2 "Code export: IR + emitters", §12 M7; ADR 0015).
 *
 * A normalized, resolved, framework-neutral tree built from a document subtree:
 *
 * - instances are expanded (`@kimo/core-schema` `createExpandedView`), and additionally
 *   described as component references (`IRNode.instance`) so an emitter can keep them as
 *   components;
 * - every bindable value is resolved under the node's effective theme (§10.4) **and** keeps the
 *   variable it came from (`ref`), so an emitter can write a literal or a `var(--x)` reference;
 * - layout is the flex model of the canvas (Yoga) restated in CSS terms: a `placement` per node
 *   (flow item / absolutely positioned / stacked / root), a `size` per axis, and an `IRFlex`
 *   for frames with layout;
 * - paints, strokes and effects are CSS-able structures; text is runs with explicit line
 *   height, letter spacing, OpenType features and wrap mode;
 * - images are asset references; notes, prompts and (by default) hidden nodes are skipped.
 *
 * Ids are view ids: real ids, or composite ids `<instance>/<IdPath>` for nodes emitted from
 * component content (§9.8) — the same ids `@kimo/layout` reports, so layout results line up.
 */
import type { Theme } from "@kimo/core-schema"
import type { RGBA } from "./color"

/** A resolved scalar plus the variable it is bound to (consumer-qualified, `alias:name`). */
export interface IRNum {
  v: number
  ref?: string
}

/** A resolved color: CSS text in its own space, sRGB for SVG/PDF, and its binding. */
export interface IRColor {
  /** CSS text in the color's own space (alpha multiplier already applied). */
  css: string
  rgba: RGBA
  ref?: string
  /** Extra alpha applied on top of the variable (gradient `opacity`); absent = 1. */
  alpha?: number
}

export type IRBlend = string

export interface IRSolidPaint {
  kind: "solid"
  color: IRColor
  blend: IRBlend
}

export interface IRGradientStop {
  at: number
  color: IRColor
}

export interface IRGradientPaint {
  kind: "linear" | "radial" | "angular"
  stops: IRGradientStop[]
  center: [number, number]
  size: [number, number]
  /** Degrees counter-clockwise, 0 = up. */
  rotation: number
  interpolation: "srgb" | "oklab"
  opacity: number
  blend: IRBlend
}

export interface IRImagePaint {
  kind: "image"
  /** Asset reference `./assets/<hash>.<ext>`. */
  src: string
  fit: "cover" | "contain" | "stretch" | "tile"
  crop: readonly [number, number, number, number, number, number] | null
  opacity: number
  blend: IRBlend
}

export type IRPaint = IRSolidPaint | IRGradientPaint | IRImagePaint

export interface IRSides<T> {
  t: T
  r: T
  b: T
  l: T
}

export interface IRStroke {
  /** Visible paints, bottom to top. */
  paints: IRPaint[]
  /** Uniform width, or per side (absent sides are 0). */
  width: IRNum | IRSides<IRNum>
  align: "inside" | "center" | "outside"
  cap: "butt" | "round" | "square"
  join: "miter" | "bevel" | "round"
  miterLimit: number
  dash: number[] | null
}

export interface IRShadow {
  inner: boolean
  x: IRNum
  y: IRNum
  blur: IRNum
  spread: IRNum
  color: IRColor
  blend: IRBlend
}

export interface IRVisual {
  /** Visible paints, bottom to top (spec §5.4: a list paints in order, last on top). */
  fills: IRPaint[]
  stroke: IRStroke | null
  /** Corner radii `[tl, tr, br, bl]`, or null for square corners. */
  radius: [IRNum, IRNum, IRNum, IRNum] | null
  /** Null = 1. */
  opacity: IRNum | null
  /** Non-normal layer blend (spec names), or null. */
  blend: IRBlend | null
  /** Composite the subtree as an isolated group (a descendant blends non-normally). */
  isolate: boolean
  clip: boolean
  /** Visible shadows in list order. */
  shadows: IRShadow[]
  /** Layer blur radius (spec §7.3: standard deviation r / 2), or null. */
  blur: IRNum | null
  backdropBlur: IRNum | null
}

/** One axis of a node's size, as the canvas applies it (spec §6.1). */
export type IRSize =
  | { kind: "fixed"; px: IRNum }
  /** Content size; `min`/`max` clamp (feature `size/min-max`). */
  | { kind: "fit"; min?: number; max?: number }
  /** Flex: grow by `weight` on the parent's main axis, stretch on its cross axis. */
  | { kind: "fill"; axis: "main" | "cross"; weight: number; min?: number; max?: number }

/** Where a node sits in its parent. */
export type IRPlacement =
  /** An exported root (its own x/y are ignored). */
  | { mode: "root" }
  /** A flowing child of a frame with layout. `lead` is a negative main-axis gap (margin). */
  | { mode: "flow"; dir: "row" | "column"; index: number; lead: number }
  /** Out of flow: `position: absolute` at x/y relative to the parent's top-left. */
  | { mode: "absolute"; x: number; y: number }
  /**
   * Out of flow in a frame without layout whose size fits its content: stacked in one grid
   * cell at a margin of x/y, so the browser computes the frame's content size (spec §6.1).
   */
  | {
      mode: "stack"
      x: number
      y: number
      /** Rotated children: rotated bounds' right/bottom minus the unrotated box's (may be < 0). */
      reach?: [number, number]
    }

export interface IRTransform {
  /** Degrees counter-clockwise around the top-left corner. */
  rotation: number
  flipX: boolean
  flipY: boolean
}

export interface IRFlex {
  dir: "row" | "column"
  /** Main-axis gap; negative gaps are 0 here and become child `lead` margins. */
  gap: IRNum
  /** The authored gap when negative (Yoga clamps gaps at 0; later children get it as margin). */
  negativeGap: number
  crossGap: IRNum
  /** Padding `[t, r, b, l]`, each a value plus `extra` px (`includeStroke`). */
  pad: [IRNum, IRNum, IRNum, IRNum]
  padExtra: [number, number, number, number]
  justify: "start" | "center" | "end" | "between" | "around" | "evenly"
  align: "start" | "center" | "end" | "stretch" | "baseline"
  wrap: boolean
}

export type IRLineHeight =
  | { kind: "normal" }
  | { kind: "multiplier"; v: IRNum }
  | { kind: "px"; v: number }

export interface IRTextStyle {
  family: { v: string; ref?: string }
  size: IRNum
  weight: IRNum
  italic: boolean
  lineHeight: IRLineHeight
  letterSpacing: IRNum
  align: "left" | "center" | "right" | "justify"
  valign: "top" | "middle" | "bottom"
  decoration: ("underline" | "strike")[]
  case: "upper" | "lower" | "title" | null
  features: Record<string, boolean | number>
}

export interface IRTextRun {
  text: string
  /** The run's own style (node style with the span style applied). */
  style: IRTextStyle
  href?: string
  /** The span's own solid color (TextSpan `fill`, feature "text/runs"); absent = the node fills. */
  color?: IRColor
}

export interface IRText {
  grow: "auto" | "fixed-width" | "fixed"
  /** Paragraph style (= the node style). */
  style: IRTextStyle
  runs: IRTextRun[]
  /** Text color paints (node `fill`, or the default text fill §8.3), bottom to top. */
  fills: IRPaint[]
  href?: string
}

export type IRShape =
  | { kind: "rect" }
  | { kind: "ellipse"; innerRadius: number; startAngle: number; sweepAngle: number }
  | {
      kind: "polygon"
      sides: number
      cornerRadius: number
      /** Board 27 §5: a star's inner/outer radius ratio (absent = a regular polygon). */
      starRatio?: number
    }
  | {
      kind: "path"
      d: string
      fillRule: "nonzero" | "evenodd"
      viewBox: [number, number, number, number] | null
    }

export interface IRIcon {
  set: string
  name: string
  weight: number | null
  strokeWidth: number | null
  color: IRColor
}

/** A declared prop value given to an instance kept as a component reference. */
export type IRArgValue =
  | { type: "text"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "enum"; value: string }
  | { type: "instance"; component: string }

/** An instance described as a reference to a component (for emitters that keep components). */
export interface IRInstanceRef {
  /** Component QId in the consumer namespace (the instance's own `of`). */
  of: string
  /** Index into {@link IRDocument.components}, or -1 when the component is not exported. */
  component: number
  /** Declared prop values: the instance's `args` plus overrides that equal a declared prop. */
  args: Record<string, IRArgValue>
  /** Slot props: prop name → the slot frame's children (view nodes) as placed by the instance. */
  slots: Record<string, IRNode[]>
  /**
   * True when the instance changes something no declared prop expresses (a `set` override,
   * a `replace`, root `props` other than `w`/`h`, theme pins differing from the component):
   * emitters must inline the expansion to stay exact.
   */
  needsInline: boolean
  /** Why {@link needsInline} (stable reasons, for reports). */
  inlineReasons: string[]
}

export interface IRNode {
  /** View id (real id or composite `<instance>/<IdPath>`). */
  id: string
  /** Original node type (`frame`, `text`, …; an unresolved instance stays `instance`). */
  type: string
  /** Layer name. */
  name: string | null
  /** Unique, stable kebab key (CSS class suffix, React keys). */
  key: string
  /** Semantic-ish tag hint (`meta["kimo.export.tag"]`, else by type). */
  tag: string
  /** False for hidden nodes kept for a boolean prop (emitters skip or condition them). */
  visible: boolean
  /** Full effective theme, set where the node pins an axis or is a root (data attributes). */
  themeAttrs: Theme | null
  /** Effective theme (§10.4), always set. */
  theme: Theme
  placement: IRPlacement
  w: IRSize
  h: IRSize
  transform: IRTransform | null
  /** Frames with `layout`. */
  flex: IRFlex | null
  /** Frames without layout and groups: how children are placed (`stack` when a size fits). */
  childMode: "absolute" | "stack" | null
  visual: IRVisual
  text: IRText | null
  shape: IRShape | null
  icon: IRIcon | null
  /** Slot frames (`slot` on a component frame). */
  slot: boolean
  /** Set on expanded instance roots (and unresolved instance placeholders). */
  instance: IRInstanceRef | null
  children: IRNode[]
}

/** A theme axis as exported (`ui:mode` for a library axis). */
export interface IRAxis {
  key: string
  attr: string
  values: string[]
  default: string
}

/** One themed entry of a variable (spec §10.1). */
export interface IRVariableEntry {
  /** Literal value or `{ $ref }` (consumer-qualified) alias. */
  value: unknown
  /** Consumer-qualified axis keys. Absent/empty = fallback entry. */
  when?: Record<string, string>
}

export interface IRVariable {
  /** Consumer-qualified name (`accent`, `ui:accent`). */
  name: string
  type: string
  /** CSS custom property. */
  css: string
  /** Plain value (null when themed). */
  value: unknown
  /** Themed entries (null when plain). */
  entries: IRVariableEntry[] | null
  description?: string
  group?: string
  /** Value under the export's default theme (resolved, aliases followed). */
  resolved: unknown
  /** How the document uses it (Tailwind namespace choice): `color`, `spacing`, `radius`, … */
  usage: string[]
}

/** A component exported as its own unit (React file). */
export interface IRComponent {
  /** Component QId in the consumer namespace. */
  qid: string
  name: string
  /** PascalCase identifier, unique. */
  ident: string
  description: string | null
  /** The component as authored (expanded through a synthetic instance), root placement "root". */
  root: IRNode
  props: IRComponentProp[]
}

export type IRComponentProp =
  | {
      name: string
      ident: string
      type: "text"
      targetId: string
      default: string | null
    }
  | {
      name: string
      ident: string
      type: "boolean"
      targetId: string
      default: boolean | null
    }
  | {
      name: string
      ident: string
      type: "enum"
      targetId: string
      field: string
      /** Option name → the target node rendered with that option applied. */
      options: Record<string, IRNode>
    }
  | {
      name: string
      ident: string
      type: "instance"
      targetId: string
      default: string | null
    }
  | { name: string; ident: string; type: "slot"; targetId: string }

export type ExportIssueCode =
  | "NODE_NOT_FOUND"
  | "NOT_EXPORTABLE"
  | "INSTANCE_UNRESOLVED"
  | "VARIABLE_UNRESOLVED"
  | "PAINT_UNSUPPORTED"
  | "STROKE_APPROXIMATED"
  | "GRADIENT_APPROXIMATED"
  | "EFFECT_APPROXIMATED"
  | "SIZE_UNRESOLVED"
  | "FEATURE_IGNORED"
  | "ICON_MISSING"
  | "FONT_MISSING"
  | "TEXT_APPROXIMATED"

export interface ExportIssue {
  code: ExportIssueCode
  nodeId?: string
  message: string
  /** Output file the issue belongs to (set by `exportDocument`; the Export dialog's Issues tab). */
  file?: string
}

export interface IRDocument {
  name: string
  roots: IRNode[]
  components: IRComponent[]
  variables: IRVariable[]
  axes: IRAxis[]
  /** Asset references used by the exported nodes (sorted). */
  assets: string[]
  /** Font faces used (family, weight, italic), sorted. */
  fonts: { family: string; weight: number; italic: boolean }[]
  /** Icons used (set, name, weight), sorted. */
  icons: { set: string; name: string; weight: number | null }[]
  issues: ExportIssue[]
}
