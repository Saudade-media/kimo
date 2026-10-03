/**
 * Node types (teardown 10.3: `Placement`, `Base`, `Frame`, `Text`, `Icon`, `Instance`,
 * `ComponentDef`, `Override`, plus the shape, note, prompt, script and browser nodes that the
 * sketch names without spelling out; their fields follow section 4.7 under Kimo's naming).
 */
import Type, { type Static, type TSchema } from "typebox"
import { DEFAULTS } from "../defaults"
import { Effects, Layout, Paints, Radius, Size, Stroke } from "./graphics"
import {
  BoolOrRef,
  Color,
  ID_PATH_PATTERN,
  Id,
  IdPath,
  LAYER_BLEND_MODES,
  Meta,
  OrderKey,
  PROP_NAME_PATTERN,
  QId,
  RELATIVE_PATH_PATTERN,
  RecordOf,
  Ref,
  Strict,
  StringEnum,
  StringOrRef,
  ThemeSelection,
  UnitNum,
} from "./primitives"
import { TextContent, TextStyle } from "./text"

const D = DEFAULTS
const opt = Type.Optional

// --- Shared field groups ----------------------------------------------------------------------

/** Fields that position a node. The only base fields an instance has. */
export const placementProps = {
  parent: Type.Union([Id, Type.Null()], {
    description: "Parent node id, or null for a root node. Always a node id, never a path.",
  }),
  at: opt(IdPath),
  order: OrderKey,
  name: opt(Type.String()),
  x: opt(Type.Number()),
  y: opt(Type.Number()),
  position: opt(StringEnum(["auto", "absolute"] as const, { default: D.node.position })),
  theme: opt(ThemeSelection),
  locked: opt(Type.Boolean({ default: D.node.locked })),
  meta: opt(Meta),
}

/**
 * M3 (ADR 0011): optional fractional order key of a declaration. `component.props` is a record
 * (canonically sorted by name), so the editor's declaration order lives here: props list by
 * (`order`, then name), an absent `order` counting as the empty string.
 */
const propOrder = opt(OrderKey)

export const TextPropDef = Strict({
  type: Type.Literal("text"),
  target: IdPath,
  field: Type.Literal("content"),
  default: opt(Type.String()),
  order: propOrder,
})
export const BooleanPropDef = Strict({
  type: Type.Literal("boolean"),
  target: IdPath,
  field: Type.Literal("visible"),
  default: opt(Type.Boolean()),
  order: propOrder,
})
export const InstancePropDef = Strict({
  type: Type.Literal("instance"),
  target: IdPath,
  default: opt(QId),
  order: propOrder,
})
export const EnumPropDef = Strict({
  type: Type.Literal("enum"),
  target: IdPath,
  field: Type.String({ minLength: 1 }),
  options: Type.Record(Type.String({ minLength: 1 }), Type.Unknown(), { minProperties: 1 }),
  order: propOrder,
})
export const SlotPropDef = Strict({ type: Type.Literal("slot"), target: IdPath, order: propOrder })

export const PropDef = Type.Union([
  TextPropDef,
  BooleanPropDef,
  InstancePropDef,
  EnumPropDef,
  SlotPropDef,
])
export type PropDef = Static<typeof PropDef>

/** Declared component properties (the component's typed prop API). */
export const ComponentDef = Strict({ props: opt(RecordOf(PROP_NAME_PATTERN, PropDef)) })
export type ComponentDef = Static<typeof ComponentDef>

export const Placeholder = Type.Union([
  Type.Literal(true),
  Strict({ by: opt(Type.String()), since: opt(Type.String()) }),
])

/** Visual fields shared by every node type except `instance`. */
export const baseProps = {
  ...placementProps,
  rotation: opt(
    Type.Number({
      default: D.node.rotation,
      description: "Degrees, CCW, around the top-left corner.",
    }),
  ),
  opacity: opt(Type.Union(UnitNum.anyOf, { default: D.node.opacity })),
  visible: opt(Type.Union(BoolOrRef.anyOf, { default: D.node.visible })),
  flipX: opt(Type.Boolean({ default: D.node.flipX })),
  flipY: opt(Type.Boolean({ default: D.node.flipY })),
  blend: opt(StringEnum(LAYER_BLEND_MODES, { default: D.node.blend })),
  component: opt(Type.Union([Type.Boolean(), ComponentDef], { default: D.node.component })),
  placeholder: opt(Placeholder),
}

export const graphicsProps = {
  fill: opt(Paints),
  stroke: opt(Stroke),
  effects: opt(Effects),
}

const sizeOpt = (def?: unknown) =>
  opt(def === undefined ? Size : Type.Union(Size.anyOf, { default: def }))
const radiusOpt = (def: number) => opt(Type.Union(Radius.anyOf, { default: def }))

// --- Node types -------------------------------------------------------------------------------

export const SlotDef = Strict({ suggested: opt(Type.Array(QId, { uniqueItems: true })) })

export const FrameNode = Strict({
  type: Type.Literal("frame"),
  ...baseProps,
  ...graphicsProps,
  w: sizeOpt(D.frame.w),
  h: sizeOpt(D.frame.h),
  radius: radiusOpt(D.frame.radius),
  clip: opt(Type.Union(BoolOrRef.anyOf, { default: D.frame.clip })),
  layout: opt(Layout),
  slot: opt(SlotDef),
})

export const GroupNode = Strict({
  type: Type.Literal("group"),
  ...baseProps,
  effects: opt(Effects),
})

export const RectNode = Strict({
  type: Type.Literal("rect"),
  ...baseProps,
  ...graphicsProps,
  w: Size,
  h: Size,
  radius: radiusOpt(D.rect.radius),
})

export const EllipseNode = Strict({
  type: Type.Literal("ellipse"),
  ...baseProps,
  ...graphicsProps,
  w: Size,
  h: Size,
  innerRadius: opt(
    Type.Number({ minimum: 0, exclusiveMaximum: 1, default: D.ellipse.innerRadius }),
  ),
  startAngle: opt(Type.Number({ default: D.ellipse.startAngle })),
  sweepAngle: opt(Type.Number({ minimum: -360, maximum: 360, default: D.ellipse.sweepAngle })),
})

export const PolygonNode = Strict({
  type: Type.Literal("polygon"),
  ...baseProps,
  ...graphicsProps,
  w: Size,
  h: Size,
  sides: Type.Integer({ minimum: 3 }),
  radius: radiusOpt(D.polygon.radius),
})

export const PathNode = Strict({
  type: Type.Literal("path"),
  ...baseProps,
  ...graphicsProps,
  w: sizeOpt(),
  h: sizeOpt(),
  d: Type.String({ minLength: 1, description: "SVG path data." }),
  fillRule: opt(StringEnum(["nonzero", "evenodd"] as const, { default: D.path.fillRule })),
  viewBox: opt(
    Type.Tuple([
      Type.Number(),
      Type.Number(),
      Type.Number({ minimum: 0 }),
      Type.Number({ minimum: 0 }),
    ]),
  ),
})

export const TextNode = Strict({
  type: Type.Literal("text"),
  ...baseProps,
  ...graphicsProps,
  w: sizeOpt(),
  h: sizeOpt(),
  content: TextContent,
  grow: opt(StringEnum(["auto", "fixed-width", "fixed"] as const, { default: D.text.grow })),
  style: opt(TextStyle),
})

/** Icon sets every v0.1 reader knows; other values are allowed and render as missing. */
export const ICON_SETS = [
  "lucide",
  "feather",
  "phosphor",
  "material-outlined",
  "material-rounded",
  "material-sharp",
] as const

export const IconNode = Strict({
  type: Type.Literal("icon"),
  ...baseProps,
  w: Size,
  h: Size,
  set: Type.String({ minLength: 1, description: `Icon set, e.g. ${ICON_SETS.join(", ")}.` }),
  icon: StringOrRef,
  weight: opt(
    Type.Union([Type.Number({ minimum: 100, maximum: 700 }), Ref], {
      description: "Material sets: the wght axis. phosphor: nearest of thin/light/regular/bold.",
    }),
  ),
  strokeWidth: opt(
    Type.Union([Type.Number({ exclusiveMinimum: 0 }), Ref], {
      description: "Stroke sets (lucide, feather): stroke width in the set's 24-unit grid.",
    }),
  ),
  color: opt(Color),
  effects: opt(Effects),
})

const noteProps = {
  ...baseProps,
  w: sizeOpt(),
  h: sizeOpt(),
  content: Type.String(),
  style: opt(TextStyle),
}

export const NoteNode = Strict({ type: Type.Literal("note"), ...noteProps })

export const PromptNode = Strict({
  type: Type.Literal("prompt"),
  ...noteProps,
  model: opt(Type.String({ minLength: 1 })),
})

/** Feature "node/script". */
export const ScriptNode = Strict({
  type: Type.Literal("script"),
  ...baseProps,
  w: Size,
  h: Size,
  src: Type.String({ pattern: RELATIVE_PATH_PATTERN }),
  inputs: opt(Type.Record(Type.String({ minLength: 1 }), Type.Unknown())),
  clip: opt(Type.Union(BoolOrRef.anyOf, { default: D.script.clip })),
})

/** Feature "node/browser". */
export const BrowserNode = Strict({
  type: Type.Literal("browser"),
  ...baseProps,
  w: Size,
  h: Size,
  url: Type.String({ minLength: 1 }),
  device: opt(Type.String({ minLength: 1 })),
  zoom: opt(Type.Number({ exclusiveMinimum: 0, default: D.browser.zoom })),
  scrollX: opt(Type.Number({ default: D.browser.scrollX })),
  scrollY: opt(Type.Number({ default: D.browser.scrollY })),
  radius: radiusOpt(D.browser.radius),
  stroke: opt(Stroke),
  effects: opt(Effects),
})

export const SetOverride = Strict({ set: Type.Record(Type.String(), Type.Unknown()) })
export const SlotOverride = Strict({ slot: Type.Literal(true) })
export const ReplaceOverride = Strict({ replace: Type.Literal(true) })

/** An instance override, explicitly tagged. */
export const Override = Type.Union([SetOverride, SlotOverride, ReplaceOverride])
export type Override = Static<typeof Override>

/**
 * An instance of a component. It has only placement fields; the component root's visual fields
 * are overridden through `props`. An instance may itself be marked `component` (a derived
 * component, e.g. a variant: paths into it resolve through to the component it instantiates).
 */
export const InstanceNode = Strict({
  type: Type.Literal("instance"),
  ...placementProps,
  component: baseProps.component,
  of: QId,
  props: opt(Type.Record(Type.String(), Type.Unknown())),
  args: opt(RecordOf(PROP_NAME_PATTERN, Type.Unknown())),
  overrides: opt(RecordOf(ID_PATH_PATTERN, Override)),
})

/** Node schemas by `type`. */
export const NODE_SCHEMAS = {
  frame: FrameNode,
  group: GroupNode,
  rect: RectNode,
  ellipse: EllipseNode,
  polygon: PolygonNode,
  path: PathNode,
  text: TextNode,
  icon: IconNode,
  instance: InstanceNode,
  note: NoteNode,
  prompt: PromptNode,
  script: ScriptNode,
  browser: BrowserNode,
} as const satisfies Record<string, TSchema>

/** A node type defined by format 0.1. */
export type NodeType = keyof typeof NODE_SCHEMAS
export const NODE_TYPES = Object.keys(NODE_SCHEMAS) as NodeType[]

export const Node = Type.Union([
  FrameNode,
  GroupNode,
  RectNode,
  EllipseNode,
  PolygonNode,
  PathNode,
  TextNode,
  IconNode,
  InstanceNode,
  NoteNode,
  PromptNode,
  ScriptNode,
  BrowserNode,
])

export type FrameNode = Static<typeof FrameNode>
export type GroupNode = Static<typeof GroupNode>
export type RectNode = Static<typeof RectNode>
export type EllipseNode = Static<typeof EllipseNode>
export type PolygonNode = Static<typeof PolygonNode>
export type PathNode = Static<typeof PathNode>
export type TextNode = Static<typeof TextNode>
export type IconNode = Static<typeof IconNode>
export type InstanceNode = Static<typeof InstanceNode>
export type NoteNode = Static<typeof NoteNode>
export type PromptNode = Static<typeof PromptNode>
export type ScriptNode = Static<typeof ScriptNode>
export type BrowserNode = Static<typeof BrowserNode>
export type Node = Static<typeof Node>

/** Node types that may have children (nodes whose `parent` is them, without `at`). */
export const CONTAINER_TYPES: ReadonlySet<NodeType> = new Set(["frame", "group"])

/** Keys of {@link placementProps} plus `type`: the only top-level keys an instance shares with other nodes. */
export const PLACEMENT_KEYS: ReadonlySet<string> = new Set(["type", ...Object.keys(placementProps)])

/** Every property a node of `type` may carry. */
export function nodeKeys(type: NodeType): ReadonlySet<string> {
  return new Set(Object.keys(NODE_SCHEMAS[type].properties))
}

/**
 * Visual fields: properties of non-instance node types that are not placement fields. On an
 * instance these belong in `props` (they override the component root).
 */
export const VISUAL_KEYS: ReadonlySet<string> = new Set(
  NODE_TYPES.filter((t) => t !== "instance")
    .flatMap((t) => Object.keys(NODE_SCHEMAS[t].properties))
    .filter((k) => !Object.hasOwn(InstanceNode.properties, k)),
)

/** True for a value whose `type` names a node type defined by format 0.1. */
export function isNodeType(type: unknown): type is NodeType {
  return typeof type === "string" && Object.hasOwn(NODE_SCHEMAS, type)
}
