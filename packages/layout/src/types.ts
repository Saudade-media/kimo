/**
 * Layout contracts: M1 (ADR 0009); M2 additions (`NodeLayout.sizing`/`inFlow`/`content`,
 * ADR 0010). The engine turns the flat `.kimo` node table into boxes:
 * Yoga for frames with `layout`, x/y for everything else, text sized through a
 * {@link TextMeasurer} that the renderer implements with CanvasKit Paragraph (ADR 0004 §2).
 *
 * No React, no DOM, no Yoga or CanvasKit types here (ADR 0004 §5): this file is the seam.
 */
import type { KimoDocument, Libraries, Theme } from "@kimo/core-schema"

// --- Input --------------------------------------------------------------------------------

/**
 * Plain node data as the layout reads it. Structurally identical to `@kimo/editor-state`'s
 * `NodeData` (layout must not depend on editor-state, teardown 9.1), so a `DocStore` node is
 * accepted as-is, and so is `KimoDocument.nodes[id]`.
 */
export type LayoutNodeData = Readonly<Record<string, unknown>> & {
  readonly type: string
  readonly parent: string | null
  readonly order: string
  readonly at?: string
}

/** Read access to the node table. Implemented over a `DocStore` or a plain document. */
export interface NodeSource {
  getNode(id: string): LayoutNodeData | undefined
  /**
   * Regular child ids in sibling order (`order`, then id); `null` = roots. With `at`, the
   * instance-owned nodes of instance `parent` attached at that IdPath (spec §9.4), as
   * `DocStore.children(parent, at)` returns them. Optional: a source that ignores `at` returns
   * an instance's regular children (none), which renders slots empty.
   */
  children(parent: string | null, at?: string | null): readonly string[]
}

/** Document header members the resolver needs. */
export type ResolveHeader = Pick<KimoDocument, "variables" | "themes" | "imports">

/**
 * Variable/theme resolution for one document (spec §10.4, core-schema `resolveVariable`).
 * Shared by layout and renderer so both see the same literal values.
 */
export interface Resolver {
  /** Effective theme of a node (document defaults + `theme` pins along the parent chain). */
  theme(nodeId: string): Theme
  /**
   * Resolves `value` as seen by `nodeId`: a `{ $ref }` binding becomes its literal under the
   * node's effective theme; any other value is returned unchanged. A failed binding returns
   * `undefined` and records a {@link LayoutIssue} (`VARIABLE_UNRESOLVED`) via `onIssue`.
   */
  value(nodeId: string, value: unknown): unknown
  /** Drops cached themes/values (call when the header or any `theme` pin changes). */
  invalidate(nodeIds?: Iterable<string>): void
}

/** Input of a full {@link LayoutEngine.compute}. */
export interface LayoutInput {
  nodes: NodeSource
  /** Root ids to lay out (defaults to `nodes.children(null)`). */
  roots?: readonly string[]
  resolve: Resolver
  measureText: TextMeasurer
}

// --- Text measurement ---------------------------------------------------------------------

/** A text style with every binding resolved and every reader default applied. */
export interface ResolvedTextStyle {
  fontFamily: string
  /** px */
  fontSize: number
  /** 1–1000 */
  fontWeight: number
  italic: boolean
  /**
   * Line height: a multiplier of `fontSize`, absolute px, or null for the font's default.
   * Kept unresolved so a run that changes `fontSize` scales a multiplier correctly.
   */
  lineHeight: { multiplier: number } | { px: number } | null
  /** px */
  letterSpacing: number
  align: "left" | "center" | "right" | "justify"
  valign: "top" | "middle" | "bottom"
  decoration: readonly ("underline" | "strike")[]
  case: "upper" | "lower" | "title" | null
  /** OpenType features (`liga: false`, `ss01: true`, `cv11: 1`). */
  features: Readonly<Record<string, boolean | number>>
}

/** Reader defaults for absent TextStyle fields (spec §8.2 "the reader's default"; ADR 0009). */
export const TEXT_STYLE_DEFAULTS: ResolvedTextStyle = {
  fontFamily: "Inter",
  fontSize: 16,
  fontWeight: 400,
  italic: false,
  lineHeight: null,
  letterSpacing: 0,
  align: "left",
  valign: "top",
  decoration: [],
  case: null,
  features: {},
}

/** One run of resolved text (a plain string node is a single run with the node style). */
export interface ResolvedTextRun {
  text: string
  style: ResolvedTextStyle
}

/** What to measure: the node's resolved content (case transform NOT yet applied). */
export interface TextMeasureInput {
  nodeId: string
  runs: readonly ResolvedTextRun[]
  /** Paragraph-level style (alignment, default line height); equals `runs[0].style` for plain text. */
  style: ResolvedTextStyle
}

/** Measured text box. */
export interface TextMetrics {
  /** Width: the longest line (for `maxWidth === undefined`, the max intrinsic width). */
  w: number
  h: number
  /** Number of laid-out lines. */
  lines?: number
  /** Distance from the box top to the first line's alphabetic baseline (align: baseline). */
  baseline?: number
}

/**
 * Measures text with the same engine that draws it (CanvasKit Paragraph), so `fit` sizes match
 * the render (ADR 0004 §2). `maxWidth` undefined = no wrapping (explicit line breaks only).
 * Must be synchronous (called from Yoga's measure callback); fonts must be loaded beforehand
 * (see the renderer's `FontProvider`), otherwise the fallback font is measured and an
 * invalidation follows when the real font arrives.
 */
export interface TextMeasurer {
  measure(text: TextMeasureInput, maxWidth: number | undefined): TextMetrics
}

// --- Output -------------------------------------------------------------------------------

/** An axis-aligned box. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 2D affine matrix `[a, b, c, d, e, f]` (x' = a·x + c·y + e, y' = b·x + d·y + f). */
export type Matrix = readonly [number, number, number, number, number, number]

/** Layout of one node. */
export interface NodeLayout {
  id: string
  /** Box in the parent's coordinate space, before the node's own rotation/flip. */
  local: Rect
  /**
   * Axis-aligned world-space bounds of the transformed box (rotation and flips included):
   * what hit testing, culling, marquee and the selection outline use.
   */
  world: Rect
  /**
   * Local → world transform: parent's `transform` · translate(local.x, local.y) · rotate/flip
   * about the top-left corner (spec: rotation is CCW degrees around the top-left). Drawing a
   * node = concat(transform), then draw in [0, 0, local.w, local.h].
   */
  transform: Matrix
  /** Effective visibility (own `visible` resolved AND every ancestor visible). */
  visible: boolean
  /** Laid-out text metrics for text/note/prompt nodes. */
  text?: TextMetrics
  /**
   * M2 (ADR 0010): the sizing mode actually applied per axis, after fallbacks (a `fill` child
   * of a parent without layout, or an absolute one, is `fixed`/`fit` here; `FIT_ALL_FILL`
   * children report `fit`). Feeds SizingBadge ("Fixed 48", "Fill ↔", "Hug") and SizeField.
   * Filled by the engine for every node; the objects are shared and frozen (compare by value).
   */
  sizing?: { readonly w: AppliedSizing; readonly h: AppliedSizing }
  /**
   * M2: true when the node takes part in its parent's flex flow (parent has `layout`, node is
   * visible and not `position: "absolute"`). Moving a flow child reorders instead of snapping.
   */
  inFlow?: boolean
  /**
   * M2: for frames with `layout`, the content box (local, inside padding and, with
   * `includeStroke`, the stroke) — used for padding/gap overlays and the alignment grid.
   */
  content?: Rect
}

/** Sizing mode applied on one axis (`fit` is shown as "Hug" in the editor). */
export type AppliedSizing = "fixed" | "fit" | "fill"

/** Severity of a layout diagnostic. */
export type LayoutIssueSeverity = "error" | "warning"

/** Diagnostic codes produced during resolve/layout. */
export type LayoutIssueCode =
  | "VARIABLE_UNRESOLVED"
  | "INVALID_SIZE"
  | "UNSUPPORTED_NODE"
  | "UNSUPPORTED_FEATURE"
  | "TEXT_MEASURE_FAILED"
  | "CYCLE"

/** A diagnostic. Layout never throws for document content; it reports and falls back. */
export interface LayoutIssue {
  code: LayoutIssueCode
  severity: LayoutIssueSeverity
  nodeId: string
  message: string
  /** Property path inside the node (`/w`, `/layout/gap`, `/style/font`). */
  path?: string
}

/** Result of a layout pass. Immutable snapshot; incremental passes return a new object. */
export interface LayoutResult {
  /** Monotonic pass counter (renderer uses it to skip unchanged layouts). */
  readonly version: number
  /** Node id → layout. Contains every laid-out node reachable from the roots. */
  readonly nodes: ReadonlyMap<string, NodeLayout>
  /** Paint order: depth-first, parents before children, siblings in sibling order. */
  readonly order: readonly string[]
  /** Union of root world boxes (zoom-to-fit), or null for an empty document. */
  readonly bounds: Rect | null
  readonly issues: readonly LayoutIssue[]
  /** Ids whose `world` box or transform changed relative to the previous pass. */
  readonly changed: ReadonlySet<string>
}

/** Why nodes are dirty (lets the engine skip work: paint-only changes need no layout). */
export interface DirtySet {
  /** Nodes whose geometry/layout/text inputs changed, were added or were removed. */
  nodes: Iterable<string>
  /** True when variables/themes changed: everything bound must be re-resolved. */
  header?: boolean
}

/** Keys whose change can affect geometry. Anything else is paint-only (renderer redraws). */
export const LAYOUT_KEYS: ReadonlySet<string> = new Set([
  "type",
  "parent",
  "order",
  "at",
  "x",
  "y",
  "w",
  "h",
  "position",
  "rotation",
  "flipX",
  "flipY",
  "visible",
  "layout",
  "content",
  "grow",
  "style",
  "stroke",
  "theme",
  "sides",
  "viewBox",
  "d",
])

// --- Engine -------------------------------------------------------------------------------

/** The layout engine (Yoga implementation in `@kimo/layout`). Runs in Bun, browsers, workers. */
export interface LayoutEngine {
  /** Loads the Yoga wasm. Must resolve before `compute`/`update`. Idempotent. */
  init(): Promise<void>
  /** Full layout of `input.roots`. Rebuilds the internal tree. */
  compute(input: LayoutInput): LayoutResult
  /**
   * Incremental layout after a change: re-reads the dirty nodes from `input.nodes`, marks the
   * smallest affected Yoga subtrees dirty (a node, its layout ancestors up to the first fixed-
   * size or non-layout ancestor) and recomputes only those. Must yield the same result as
   * `compute` with the same input (property-tested). Requires a prior `compute`.
   */
  update(input: LayoutInput, dirty: DirtySet): LayoutResult
  /** The last result, or null before the first `compute`. */
  readonly current: LayoutResult | null
  /** Frees Yoga nodes. */
  dispose(): void
}

/** Options for {@link createLayoutEngine}. */
export interface LayoutEngineOptions {
  /** Report issues as they are found (in addition to `LayoutResult.issues`). */
  onIssue?: (issue: LayoutIssue) => void
  /** Imported libraries by alias, for instances of `alias:id` components. */
  libraries?: Libraries
}
