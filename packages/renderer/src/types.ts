/**
 * Renderer contracts: M1 (ADR 0004, ADR 0009), M2 overlays and icons (ADR 0010), M3 component
 * overlays and expanded instances (ADR 0011). One CanvasKit implementation serves the
 * interactive WebGL canvas and the headless raster path (Bun/Node, MCP renders, PNG export).
 *
 * No React here, and no CanvasKit types in the public surface (ADR 0004 §5). DOM types appear
 * only as type references (`HTMLCanvasElement | OffscreenCanvas`) for `attach`, which the
 * headless path never calls.
 */
import type {
  LayoutResult,
  Matrix,
  NodeSource,
  Rect,
  ResolveHeader,
  Resolver,
  TextMeasurer,
} from "@kimo/layout"

export type { Rect } from "@kimo/layout"

/** A point. Screen points are CSS pixels relative to the canvas's top-left corner. */
export interface Point {
  x: number
  y: number
}

/**
 * The visible region; structurally identical to `@kimo/editor-state`'s `Viewport`:
 * `screen = (world - {x, y}) * zoom`.
 */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

// --- Document ------------------------------------------------------------------------------

/** Loads asset bytes for `./assets/<hash>.<ext>` references (image fills, document fonts). */
export interface AssetSource {
  /** Resolves the bytes, or null when the asset is missing (drawn as a checkerboard). */
  load(src: string): Promise<Uint8Array | null>
}

/**
 * What the renderer paints. The renderer never subscribes to a store itself: the host (the
 * web app's CanvasHost, the CLI, the MCP server) owns the pipeline
 * `DocStore.onChange → LayoutEngine.update → setLayout + invalidate → requestFrame`.
 * `nodes` is read lazily at draw time, so a live `DocStore` can be passed directly. M3: pass
 * the shared expanded view (`@kimo/layout` `createInstanceView`) so instances draw expanded
 * and hit testing returns composite ids (`<instance>/<IdPath>`, top-most first); the same
 * view goes to the layout engine (`LayoutInput.expanded`) and the resolver.
 */
export interface RenderScene {
  nodes: NodeSource
  header: ResolveHeader | (() => ResolveHeader)
  resolve: Resolver
  assets: AssetSource
  /** Canvas background (world space, behind every root). Default: transparent. */
  background?: string
  /**
   * M6: display labels for note / prompt chrome. `promptModel` turns a prompt's `model`
   * (`{provider, model}` or the legacy string) into the pill text ("Opus 5.5"); absent = the
   * model id. Pictures of prompts are re-recorded on `invalidate()`.
   */
  labels?: { promptModel?: (model: unknown) => string }
}

// --- Overlays ------------------------------------------------------------------------------

/**
 * A snapping/measurement guide in world space.
 * @deprecated M1 placeholder; M2 hosts use {@link Overlay.snap}, {@link Overlay.spacing} and
 * {@link Overlay.measurements}. Still drawn (1px selection line + optional label) when set.
 */
export interface SnapGuide {
  axis: "x" | "y"
  /** World coordinate of the line on `axis`. */
  at: number
  /** World extent along the other axis. */
  from: number
  to: number
  /** Optional distance label (measurement), drawn at the segment's midpoint. */
  label?: string
}

// --- M2 overlays (desing.pen board 10 "Canvas Overlays (M2)", nzfXx) ------------------------
//
// Every coordinate below is WORLD space unless the name says `screen`; the renderer maps it
// with the viewport and draws every stroke/label at constant screen size (1px lines, 11px mono
// labels at any zoom). Lines are pixel-snapped: a 1px line sits on a half pixel (board 10 puts
// a guide for edge y=128 at y=127.5, h=1).

/**
 * One snap line (board 10 #1 "Snapping while moving", O68JG1: "Guide" k4EEW). Drawn 1px
 * `measure`, spanning [`from`, `to`] plus {@link OVERLAY_SPEC_M2}.snap.overhang screen px at
 * both ends ("guides span both objects plus 8px").
 */
export interface SnapLine {
  /** `x`: a vertical line at world x = `at`; `y`: a horizontal line at world y = `at`. */
  axis: "x" | "y"
  at: number
  /** World extent along the other axis (union of the snapped objects). */
  from: number
  to: number
}

/** Snap state while moving/resizing: lines plus × markers on every snapped point. */
export interface SnapOverlay {
  lines: readonly SnapLine[]
  /** World points where an edge/center coincides (SnapMarker L1uJy, 7×7 ×, centered). */
  markers: readonly Point[]
}

/**
 * Equal-spacing indicator (board 10 #2, V6rSVv): the gap area tinted `measure-soft`, a 1px
 * `measure` line across it at the cross-axis midpoint with 1×10 end ticks inside the gap, and
 * a MeasurePill (lSZXU) centered on the line.
 */
export interface SpacingIndicator {
  /** Main axis of the gap: `x` = horizontal gap between siblings side by side. */
  axis: "x" | "y"
  /** Gap start/end on `axis` (world). */
  from: number
  to: number
  /** Cross-axis extent of the tinted area (world; the overlap of the two neighbors). */
  crossFrom: number
  crossTo: number
  /** Pill text, e.g. `"48"` (the host formats world units). */
  label: string
}

/**
 * A distance (board 10 #3a C7xrZ / #3b): a 1px `measure` line with a MeasurePill centered on
 * its midpoint (pill drawn above content).
 */
export interface Measurement {
  /** `x`: horizontal line from x=`from` to x=`to` at world y=`at`; `y`: vertical line. */
  axis: "x" | "y"
  at: number
  from: number
  to: number
  label: string
}

/**
 * A node outlined in `measure` while ⌥-measuring (board 10 #3a "Hover outline" rmL0x: 1px,
 * follows the node's corner radius; #3b "Parent outline" DglSx: same at opacity 0.5).
 */
export interface MeasureOutline {
  id: string
  role: "target" | "parent"
}

/**
 * A vertex of a path being drawn or edited, absolute world coordinates. `in`/`out` are the
 * bezier control points (absent = sharp corner on that side).
 */
export interface PathAnchorPoint {
  x: number
  y: number
  in?: Point | null
  out?: Point | null
}

/** One contour of a path overlay: anchors in order; `closed` joins the last to the first. */
export interface PathContour {
  anchors: readonly PathAnchorPoint[]
  closed: boolean
}

/** Address of one anchor: contour index + anchor index. */
export interface AnchorRef {
  contour: number
  index: number
}

/**
 * Pen tool while drawing (board 10 #5 "Pen tool — drawing", cXWyk). Draws the contour with its
 * own `stroke` ("User path" ZiOBk), then the contour outline 1px `selection`, every anchor as PathAnchor (iqdgN), the active anchor as PathAnchor/Active
 * (V9wRl), the handles of `handlesFor` (1px lines + BezierHandle B65mjM), the preview segment
 * ("Rubber band" BjnR2: 1px `selection` at opacity 0.7) and, when `closeHint`, a 14×14 ring
 * (z6CuY5, stroke 1.5 `selection`) centered on the first anchor. The pen cursor and the
 * "Close path" Tooltip/Hint are DOM (host), not canvas.
 */
export interface PenOverlay {
  contour: PathContour
  /**
   * The contour's own stroke as it will be written ("User path" ZiOBk, drawn under the outline):
   * hex color and width in world units (scaled by zoom). Null/absent: outline only.
   */
  stroke?: { color: string; width: number } | null
  /** Index of the last-placed anchor (filled), or null. */
  active: number | null
  /** Anchors whose handles are shown (cXWyk: every anchor that has a handle). */
  handlesFor: readonly number[]
  /**
   * Segment from the last anchor to the cursor: cubic when the last anchor has an `out`
   * handle (`c1` = that handle, `c2` = `to`), straight otherwise. Null hides it.
   */
  preview: { from: Point; c1?: Point; c2?: Point; to: Point } | null
  /** Cursor is within the close threshold of the first anchor. */
  closeHint: boolean
}

/**
 * Path edit mode (board 10 #6 "Path edit mode", B9dJsH): all segments outlined 1px
 * `selection`, every vertex an anchor, selected vertices filled; only selected vertices show
 * their handles. `badge` is a SizeBadge (JlrHC) next to the (first) selected vertex, e.g.
 * `"460, 180"`, offset by {@link OVERLAY_SPEC_M2}.pathEdit.vertexBadgeOffset. The mode pill
 * ("Editing path · Esc or Enter to exit") is a DOM Tooltip/Hint (host).
 */
export interface PathEditOverlay {
  nodeId: string
  /** Contours in world space (host converts the node's `d` through its transform). */
  contours: readonly PathContour[]
  selected: readonly AnchorRef[]
  /** Hovered segment for insertion feedback (drawn 1.5px), or null. */
  hoveredSegment?: AnchorRef | null
  /**
   * Board 27 §5 (J5Vng "Selected Segment" yeYJK): the clicked segment, drawn 3 px `selection`
   * (⌫ deletes it), or null.
   */
  selectedSegment?: AnchorRef | null
  badge?: string | null
}

/**
 * Resize of a frame with layout children (board 10 #8, ect1B): each flowing child outlined
 * 1px `selection` at opacity 0.35 with a SizingBadge (xPekI) centered on it, above the
 * selection's top edge; the pre-drag edge as a dashed "Ghost edge" (GV63U); the live
 * SizeBadge under the selection (existing `sizeLabel`).
 */
export interface ResizeOverlay {
  children: readonly { id: string; label: string }[]
  /** Pre-drag position of the dragged edge (world), drawn 4/4 dashed 1px `selection`. */
  ghostEdge?: SnapLine | null
}

/**
 * Board 27 §5 (ICb89 "Polygon & Star"): handles on a selected star (world points). `hollow` =
 * Ratio Handle M2IQJ (8 × 8 ellipse, fill #FFFFFF, stroke 1.5 selection); `filled` = Radius
 * Handle gAuNj (fill selection, stroke 1.5 #FFFFFF). `pill` = MeasurePill (xP9Lo, fill
 * `selection`, on-accent) beside the dragged handle: left = handle right + 6, centred on it.
 */
export interface ShapeHandlesOverlay {
  handles: readonly { at: Point; kind: "hollow" | "filled" }[]
  pill?: { text: string; at: Point } | null
}

/**
 * A badge that follows the pointer (SizeBadge/Delta PIz6o: `accent` fill, `on-accent` mono
 * 11/500, e.g. `"+60"` while resizing or the pixel readout `"x 22 · y 14 · E76F51 66%"`).
 * `screen` is the badge's top-left in CSS px; the host places it per
 * {@link OVERLAY_SPEC_M2}.deltaBadge.
 */
export interface CursorBadge {
  text: string
  screen: Point
}

/** Editor overlays drawn on top of the document in screen space (not exported). */
export interface Overlay {
  /** Selected node ids: outline + corner handles + size badge (single or union box). */
  selection: readonly string[]
  /** Hovered node id: outline only. */
  hovered: string | null
  /** Marquee rectangle in world space. */
  marquee: Rect | null
  /** @deprecated M1 guides; see {@link SnapGuide}. */
  guides?: readonly SnapGuide[]
  /** Size badge text under the selection (`"720 × Hug 366"`); null hides it. */
  sizeLabel?: string | null
  /** Hide handles while dragging/transforming. Default true. */
  handles?: boolean

  // M2 (board 10). All optional: absent = not drawn.
  /** Snap lines + markers while moving/resizing (#1). */
  snap?: SnapOverlay | null
  /** Equal-spacing indicators (#2). */
  spacing?: readonly SpacingIndicator[]
  /** ⌥ distances (#3a/#3b). */
  measurements?: readonly Measurement[]
  /** Nodes outlined in `measure` while ⌥-measuring (#3a target, #3b parent). */
  measureOutlines?: readonly MeasureOutline[]
  /**
   * Pixel grid (#4): drawn when `zoom > OVERLAY_SPEC_M2.pixelGrid.minZoom` and this is not
   * false/0. A number is the grid's opacity multiplier (0–1) so the host can fade it in.
   */
  pixelGrid?: boolean | number
  /**
   * Board 27 §4 rulers (rule YwZyP, ⇧R): 20 px top/left strips in canvas units, drawn on top of
   * everything. `selection` (world AABB) is highlighted in `selection-soft` with its start/end
   * values; null / absent hides the rulers.
   */
  rulers?: { selection: Rect | null } | null
  /** Pen tool state (#5). */
  pen?: PenOverlay | null
  /** Path edit mode (#6). Selection handles are hidden while set. */
  pathEdit?: PathEditOverlay | null
  /** Resize with layout children (#8). */
  resize?: ResizeOverlay | null
  /** Board 27 §5 (ICb89): a selected star's ratio / radius handles (+ MeasurePill while dragged). */
  shapeHandles?: ShapeHandlesOverlay | null
  /** Pointer-following delta badge (#8 "Delta", #4 "Pixel readout"). */
  cursorBadge?: CursorBadge | null

  // M3 (boards 02c / 11 / 12 / 13, ADR 0011). All optional: absent = not drawn.
  /**
   * Tone of the selection outline, handles and size badge: `"component"` when the selection is
   * a main, a derived component or an instance (board 11 `Q4JWk`/`pjCl0`/`h7Uden`, board 12
   * `cHDIO`: stroke / handle stroke / badge fill `component`). Default `"selection"` (blue).
   */
  selectionTone?: "selection" | "component"
  /**
   * Component identity outlines (02c "Canvas outlines", `sdBO5`): drawn under the selection.
   * The host lists the hovered main/instance and, while a main or instance is selected, its
   * slot frames (with their view ids, which may be composite). A hovered id listed here as
   * `main`/`instance` gets no blue hover outline (the identity outline replaces it).
   */
  componentOutlines?: readonly ComponentOutline[]
  /**
   * Board 13 drag-and-drop onto an instance: the insertion bar inside a slot, or the replace
   * target box around an instance descendant. Null hides.
   */
  instanceDrop?: InstanceDropOverlay | null

  // M6 (board 22 D0zDSY, board 24 iLW1l, ADR 0014). All optional: absent = not drawn. Drawn
  // under the hover and selection chrome; tags, chips, cursors and buttons are DOM (host).
  /** Frames carrying the `placeholder` flag (DzQcZ): outline, shimmer, skeleton when empty. */
  placeholders?: readonly PlaceholderOverlay[]
  /** Frames whose placeholder just cleared: the 1.2 s fade (`progress` 0 → 1). */
  placeholderFlashes?: readonly PlaceholderFlash[]
  /**
   * Shimmer phase 0–1 (one sweep = {@link OVERLAY_SPEC_M6}.placeholder.shimmerPeriodMs). The
   * host advances it per frame only while a building placeholder is on screen; null/absent
   * draws the band centered and still (reduced motion, goldens).
   */
  shimmerPhase?: number | null
  /** Agent scope outlines (modes ZFOQf: side by side, split, iterate). */
  scopes?: readonly ScopeOutline[]
  /** Nodes each agent is working on, outlined in its persona hue (board 24 GmEAl). */
  agentSelections?: readonly AgentSelectionOutline[]
  /** Targets of rejected (OUT_OF_SCOPE) ops: 1.5 `danger` flash (z6D2MM `O9CyHA`). */
  rejected?: readonly string[]
  /** Prompt → target connectors (cf2sC `C9IXO8` / `bPSY1`). */
  promptConnectors?: readonly PromptConnector[]

  // Board 27 §6 (d) VCSml: image crop mode. Absent = not drawn.
  /** Image crop mode: the whole source, dim outside the crop box, box + thirds + brackets. */
  crop?: CropOverlay | null
}

/**
 * Board 27 §6 (d) "Image crop mode" (VCSml, stage ud74f): drawn over everything else. The whole
 * image source draws through `imageToScreen`; outside `box` it is dimmed
 * ({@link OVERLAY_SPEC_CROP}.dim); the box gets a white 1 px outline, thirds, 3 px corner
 * brackets and edge bars, and a MeasurePill with `label` under it.
 */
export interface CropOverlay {
  /** `./assets/<hash>.<ext>` of the image paint. */
  src: string
  /** Natural size of the source in px. */
  imageWidth: number
  imageHeight: number
  /** Image px → screen CSS px (node transform · crop mapping · viewport). */
  imageToScreen: Matrix
  /** Crop box corners on screen (tl, tr, br, bl). */
  box: readonly Point[]
  /** MeasurePill text under the box: the crop size in source px ("1440 × 960"). */
  label: string
  /** Paint opacity (0–1) of the image. Default 1. */
  opacity?: number
}

/**
 * Board 27 §6 (d) crop chrome (VCSml, stage ud74f), screen CSS px. Dim T/B/L/R `#14141499`;
 * Crop Box stroke 1 `#FFFFFF`; Third V1/V2/H1/H2 1 px `#FFFFFF59`; brackets (TL/TR/BL/BR h+v)
 * and edge bars (T/B/L/R) 16 × 3 `#FFFFFF` starting 3 px outside the box; MeasurePill (lSZXU)
 * `selection` fill / `on-accent` label, 10 below the box, centered.
 */
export const OVERLAY_SPEC_CROP = {
  dim: "#14141499",
  box: { color: "#FFFFFF", width: 1 },
  thirds: { color: "#FFFFFF59", width: 1 },
  bracket: { color: "#FFFFFF", length: 16, thickness: 3 },
  pill: { fill: "selection", text: "on-accent", offset: 10 },
} as const

// --- M6 overlays (desing.pen board 22 "Built-in Agent (M6)", board 24 "Agent Mark & Gaps") ---

/** Agent persona hue: the lead is `agent` (teal); spawned agents take Iris → Violet → Rose → Ember → Moss. */
export type AgentPersona = "agent" | "iris" | "violet" | "rose" | "ember" | "moss"

/** One placeholder frame (PlaceholderFrame `EKCy7`). */
export interface PlaceholderOverlay {
  id: string
  /** Tint: `agent` (lead) or the persona hue in split mode (board 24 nVrLq). Default `agent`. */
  persona?: AgentPersona
  /** `interrupted`: the owner is gone (orphan): no shimmer. */
  state: "building" | "interrupted"
  /** Skeleton bars (`Wun0d`): only while the frame has no children. */
  skeleton: boolean
}

export interface PlaceholderFlash {
  id: string
  /** 0 at clear, 1 when the 1.2 s fade ends. */
  progress: number
  persona?: AgentPersona
}

/** A scope outline (`Scope Outline · …`). */
export interface ScopeOutline {
  id: string
  persona?: AgentPersona
  /**
   * `outset`: 3 px outside the node, radius + 3 (side by side `TvhRj`, iterate `cCMHZ`);
   * `flush`: on the node's box (split sections `REU1L`, flush with their parent).
   */
  fit: "outset" | "flush"
}

/** Board 24 GmEAl "Sel · Agent n": 1.5 persona-hue rect, 2 px outside the node. */
export interface AgentSelectionOutline {
  id: string
  persona: AgentPersona
}

export interface PromptConnector {
  /** The prompt node. */
  prompt: string
  /** Its `target` frame. */
  target: string
  persona?: AgentPersona
}

/**
 * Colors of the M6 canvas surfaces. Every value is a token of `@kimo/design-tokens` (the name
 * in the comment); the defaults ({@link DEFAULT_AGENT_CANVAS_THEME}) are the light values
 * from desing.pen. Hosts pass the live values through {@link OverlayTheme.agentCanvas}.
 */
export interface AgentCanvasTheme {
  /** `note` */
  note: string
  /** `note-edge` */
  noteEdge: string
  /** `note-text` */
  noteText: string
  /** `shadow` */
  shadow: string
  /** `bg-app` */
  bgApp: string
  /** `bg-subtle` */
  bgSubtle: string
  /** `bg-muted` */
  bgMuted: string
  /** `border` */
  border: string
  /** `border-strong` */
  borderStrong: string
  /** `text-primary` */
  textPrimary: string
  /** `text-secondary` */
  textSecondary: string
  /** `text-tertiary` */
  textTertiary: string
  /** `agent` */
  agent: string
  /** `agent-soft` */
  agentSoft: string
  /** `danger` */
  danger: string
  /** `agent-iris`, `agent-violet`, `agent-rose`, `agent-ember`, `agent-moss` */
  iris: string
  violet: string
  rose: string
  ember: string
  moss: string
  /** `agent-<persona>-soft` (skeleton bars and flash ring of persona-tinted placeholders). */
  irisSoft: string
  violetSoft: string
  roseSoft: string
  emberSoft: string
  mossSoft: string
}

/** Light values from desing.pen variables (token name → value). */
export const DEFAULT_AGENT_CANVAS_THEME: AgentCanvasTheme = {
  note: "#FFF1B8",
  noteEdge: "#EBD686",
  noteText: "#3D3205",
  shadow: "#0A0A0A0F",
  bgApp: "#FFFFFF",
  bgSubtle: "#F9F8F6",
  bgMuted: "#F2F1EF",
  border: "#ECEBE8",
  borderStrong: "#DDDBD7",
  textPrimary: "#0A0A0A",
  textSecondary: "#6B6F75",
  textTertiary: "#9A9DA2",
  agent: "#0093A3",
  agentSoft: "#E3F5F7",
  danger: "#DD2229",
  iris: "#4F5FE8",
  violet: "#8B47DE",
  rose: "#D6457F",
  ember: "#E8652A",
  moss: "#5E8A2E",
  irisSoft: "#ECEEFF",
  violetSoft: "#F3EBFD",
  roseSoft: "#FDEBF2",
  emberSoft: "#FDEEE6",
  mossSoft: "#EEF4E4",
}

/** Token names of {@link AgentCanvasTheme} keys (hosts read `--kimo-<token>`). */
export const AGENT_CANVAS_TOKENS: Record<keyof AgentCanvasTheme, string> = {
  note: "note",
  noteEdge: "note-edge",
  noteText: "note-text",
  shadow: "shadow",
  bgApp: "bg-app",
  bgSubtle: "bg-subtle",
  bgMuted: "bg-muted",
  border: "border",
  borderStrong: "border-strong",
  textPrimary: "text-primary",
  textSecondary: "text-secondary",
  textTertiary: "text-tertiary",
  agent: "agent",
  agentSoft: "agent-soft",
  danger: "danger",
  iris: "agent-iris",
  violet: "agent-violet",
  rose: "agent-rose",
  ember: "agent-ember",
  moss: "agent-moss",
  irisSoft: "agent-iris-soft",
  violetSoft: "agent-violet-soft",
  roseSoft: "agent-rose-soft",
  emberSoft: "agent-ember-soft",
  mossSoft: "agent-moss-soft",
}

/** Persona hue and its soft tint. */
export function personaColors(
  theme: AgentCanvasTheme,
  persona: AgentPersona = "agent",
): { hue: string; soft: string } {
  if (persona === "agent") return { hue: theme.agent, soft: theme.agentSoft }
  return { hue: theme[persona], soft: theme[`${persona}Soft`] }
}

/**
 * M6 overlay geometry (screen px unless noted "world"). Values from board 22 (`DzQcZ`,
 * `cf2sC`, `ZFOQf`) and board 24 (`GmEAl`).
 */
export const OVERLAY_SPEC_M6 = {
  placeholder: {
    /** EKCy7 stroke 1.5 `agent` (inside). */
    outlineWidth: 1.5,
    /** Fill gradient: linear, rotation −60°, agent @ 0 → agent 0x1F @ 0.5 → agent 0 @ 1. */
    shimmerRotation: -60,
    shimmerAlpha: 0x1f / 255,
    /** f7c6p1: "a diagonal $agent shimmer sweeping every 1.6 s". */
    shimmerPeriodMs: 1600,
    /** Skeleton `Wun0d` (world units, frame-local): padding 16, tag 20 + gap 10, padding-top 6, gap 8. */
    skeleton: {
      padding: 16,
      top: 16 + 20 + 10 + 6,
      gap: 8,
      title: { w: 140, h: 14, r: 4 },
      line1: { h: 8, r: 4 },
      line2: { w: 180, h: 8, r: 4 },
      blocks: { paddingTop: 6, gap: 8, r: 6, count: 3 },
    },
  },
  /** F1viK5: "Outline fades over 1.2 s through a 3 px $agent-soft ring". */
  flash: { durationMs: 1200, ringWidth: 3 },
  /** Scope Outline: stroke 1.5, outset 3 (radius + 3) or flush. */
  scope: { width: 1.5, outset: 3 },
  /** GmEAl "Sel · Agent n": 1.5, 2 px outside the node. */
  agentSelection: { width: 1.5, outset: 2 },
  /** z6D2MM "Rejected Target Flash": 1.5 `danger` on the node box. */
  rejected: { width: 1.5 },
  /** cf2sC Connector: 1.5 line + 7 px end dot centered on the target edge. */
  connector: { width: 1.5, dot: 7 },
} as const

/**
 * One component identity outline. Colors are `component` / `component-soft`
 * ({@link OverlayTheme}); widths and dashes in {@link OVERLAY_SPEC_M3}.
 */
export interface ComponentOutline {
  /** View id (real or composite `<instance>/<IdPath>`) whose layout box is outlined. */
  id: string
  /**
   * `main`: 1.5 solid (02c `NENSo`); `instance`: 1 solid (02c `GTuxN`); `slot`: 1px dashed
   * 4/3, filled `component-soft` when the slot shows no children (02c `te3fa`), drawn on the
   * slot box offset per {@link OVERLAY_SPEC_M3}.slot (board 12 `f8MrUb`).
   */
  role: "main" | "instance" | "slot"
  /** Slots only: true when the slot renders no children (soft fill). */
  empty?: boolean
}

/** Board 13 drop feedback on instances (world coordinates). */
export type InstanceDropOverlay =
  /** Drop into a slot (`GMebs`): a 2px `component` bar, radius 1, across the slot's content box. */
  | { kind: "slot"; slotId: string; bar: { x: number; y: number; w: number } }
  /** Drop replaces a descendant (`d8kP2n`): its box outset, `component-soft` fill, 1.5 `component` stroke, radius 2. */
  | { kind: "replace"; targetId: string }

/** Colors for overlays, supplied by the host from design tokens (`--kimo-selection`, …). */
export interface OverlayTheme {
  selection: string
  /** Handle fill (#FFFFFF in board 03). */
  handleFill: string
  /** Size-badge text color (`on-accent`). */
  onSelection: string
  /** Font family for the size badge (`font-mono`, JetBrains Mono). */
  monoFamily: string
  // M2 (optional so M1 hosts keep compiling; the renderer falls back to the light values).
  /** `measure` (#E5177E light / #FF5CAB dark): guides, markers, distances, pills. */
  measure?: string
  /** `measure-soft` (#E5177E1F / #FF5CAB2E): equal-spacing gap tint. */
  measureSoft?: string
  /** `on-accent` (#FFFFFF / #0A0A0A): pill and badge text. */
  onAccent?: string
  /** `selection-soft` (#2F6BFF1A / #4C8DFF26): SizingBadge fill. */
  selectionSoft?: string
  /** `accent-text` (#0A0A0A / #F5F5F4): SizingBadge text. */
  accentText?: string
  /** `accent` (#0A0A0A / #F5F5F4): SizeBadge/Delta fill. */
  accent?: string
  // M3 (optional; light values are the fallback).
  /** `component` (#7C3AED light / #A78BFA dark): component/instance identity only. */
  component?: string
  /** `component-soft` (#7C3AED14 / #A78BFA24): empty-slot fill, replace target fill. */
  componentSoft?: string
  // Board 27 §4 (optional; light values are the fallback).
  /** Pixel grid lines: #0000000F light / #FFFFFF1F dark (rule zyQtF). */
  pixelGrid?: string
  /** Ruler strip fill (`bg-app`). */
  rulerBg?: string
  /** Ruler edge stroke (`border`). */
  rulerBorder?: string
  /** Ruler ticks (`border-strong`). */
  rulerTick?: string
  /** Ruler numbers (`text-tertiary`). */
  rulerText?: string
  // M6 (optional; DEFAULT_AGENT_CANVAS_THEME light values are the fallback).
  /** Note / prompt chrome and agent overlay colors ({@link AgentCanvasTheme}). */
  agentCanvas?: Partial<AgentCanvasTheme>
}

/**
 * Overlay geometry, copied from `desing.pen` board 03 (Canvas: "Selection Outline",
 * "Handle", "Size Badge"). Screen-space px, independent of zoom.
 */
export const OVERLAY_SPEC = {
  outlineWidth: 1.5,
  hoverWidth: 1.5,
  handleSize: 8,
  handleRadius: 2,
  handleStrokeWidth: 1.5,
  /** Badge: pill, padding [2, 8], 8px below the selection, centered. */
  badgePadding: [2, 8] as const,
  badgeOffset: 8,
  badgeFontSize: 11,
  badgeFontWeight: 500,
} as const

/**
 * M2 overlay geometry from `desing.pen` board 10 (nzfXx) and the 02b components it uses.
 * Screen-space CSS px. Colors are token names resolved through {@link OverlayTheme}, except
 * `pixelGrid.color`, which is fixed in both themes (it sits on document pixels).
 */
export const OVERLAY_SPEC_M2 = {
  /** #1 O68JG1: "Guide" k4EEW (w 496 = objects 80…560 + 8 each side, h 1, fill measure). */
  snap: {
    lineWidth: 1,
    color: "measure",
    overhang: 8,
    /** SnapMarker L1uJy: 7×7 frame, path "M0.5 0.5l6 6m0-6l-6 6", stroke 1.25 round cap. */
    marker: { size: 7, path: "M0.5 0.5l6 6m0-6l-6 6", strokeWidth: 1.25, cap: "round" },
  },
  /** #2 V6rSVv: Gap F8D1s (measure-soft), Guide M4nMBy (1px), ticks Q9RyVV/QT3OF (1×10, inside the gap). */
  spacing: { fill: "measure-soft", lineWidth: 1, tickLength: 10, tickWidth: 1, color: "measure" },
  /**
   * MeasurePill lSZXU: fill measure, radius-pill 999, padding [2, 8], mono 11/500 on-accent.
   * Rendered 19 tall in the .pen (width = text + 16: "48" → 30, "120" → 36); centered on the
   * line's midpoint.
   */
  pill: {
    fill: "measure",
    radius: 999,
    padding: [2, 8] as const,
    fontSize: 11,
    fontWeight: 500,
    text: "on-accent",
    height: 19,
  },
  /** #3a/#3b: lines 1px measure; "Hover outline" rmL0x 1px; "Parent outline" DglSx 1px @ 0.5. */
  measure: { lineWidth: 1, outlineWidth: 1, parentOutlineOpacity: 0.5 },
  /**
   * #4 hD0aS "Pixel grid" j2MBuX, revised by board 27 rule zyQtF: 1 px lines, one cell per
   * world unit, drawn at ≥ 800 % zoom; #0000000F light (dark: `OverlayTheme.pixelGrid`
   * #FFFFFF1F); never exported.
   */
  pixelGrid: { minZoom: 8, lineWidth: 1, color: "#0000000F" },
  /** #5 cXWyk / #6 B9dJsH. */
  path: {
    /** PathAnchor iqdgN: 7×7 rect, fill #FFFFFF (handleFill), stroke 1.5 selection. Active V9wRl: fill selection. */
    anchor: { size: 7, strokeWidth: 1.5 },
    /** BezierHandle B65mjM: 6×6 ellipse, fill #FFFFFF, stroke 1.25 selection. */
    handle: { size: 6, strokeWidth: 1.25 },
    /** "Handle line" R5Haai: 1px selection. */
    handleLineWidth: 1,
    /** "Path outline" Q7syMW: 1px selection. */
    outlineWidth: 1,
    /** "Rubber band" BjnR2: 1px selection at opacity 0.7. */
    preview: { width: 1, opacity: 0.7 },
    /** "Close ring" z6CuY5: 14×14 ellipse, stroke 1.5 selection, centered on the first anchor. */
    closeRing: { size: 14, strokeWidth: 1.5 },
  },
  /** #6: "Vertex badge" PzxaD (SizeBadge) top-left = selected anchor center + (16, −14). */
  pathEdit: {
    vertexBadgeOffset: { x: 16, y: -14 },
    /** Board 27 §5 J5Vng "Selected Segment" yeYJK: 3 px selection. */
    selectedSegmentWidth: 3,
  },
  /**
   * Board 27 §5 ICb89: star handles 8 × 8 ellipses, stroke 1.5 (ratio M2IQJ hollow: fill
   * #FFFFFF / stroke selection; radius gAuNj filled: fill selection / stroke #FFFFFF);
   * MeasurePill xP9Lo at (handle right + 6, handle centre).
   */
  shapeHandle: { size: 8, strokeWidth: 1.5, pillGap: 6 },
  /** #8 ect1B. */
  resize: {
    /** "Child outline" c4Meq: 1px selection at opacity 0.35. */
    childOutline: { width: 1, opacity: 0.35 },
    /**
     * SizingBadge xPekI: fill selection-soft, radius 999, padding [2, 8], mono 11/500
     * accent-text; centered on the child's x center, bottom edge 7px above the selection's
     * top edge (vignette: badge y 144 + h 19 = 163, selection top 170).
     */
    sizingBadge: {
      fill: "selection-soft",
      text: "accent-text",
      radius: 999,
      padding: [2, 8] as const,
      fontSize: 11,
      fontWeight: 500,
      offset: 7,
    },
    /** "Ghost edge" GV63U: 1px selection, dash 4/4, extends 8px beyond the selection. */
    ghostEdge: { width: 1, dash: [4, 4] as const, overhang: 8 },
  },
  /**
   * SizeBadge/Delta PIz6o: SizeBadge with fill accent. In #8 its top-left is
   * (dragged edge x + 4, pointer y + 12) (edge 560 → badge x 564; pointer 210 → badge y 222).
   */
  deltaBadge: { fill: "accent", text: "on-accent", edgeOffsetX: 4, pointerOffsetY: 12 },
} as const

/**
 * M3 overlay geometry (desing.pen 02c `SD9TU`, board 12 `M3150`, board 13 `XoUIl`). Screen px
 * at any zoom unless noted. Labels (CanvasLabel/Component `tl5O8`, /Instance `J3FKSK`), the
 * SlotBadge (`kMGG0`), SlotQuickInsert (`AJSok`), drag chip and drop hint are DOM (host), not
 * canvas: positions are listed here so the host and renderer agree.
 */
export const OVERLAY_SPEC_M3 = {
  /** 02c `NENSo`: main outline 1.5 solid `component`, radius 2 (specimen). */
  main: { width: 1.5, color: "component" },
  /** 02c `GTuxN`: instance outline 1 solid `component`. */
  instance: { width: 1, color: "component" },
  /**
   * 02c `te3fa` / board 12 `f8MrUb` / board 13 `mau05`: 1px `component`, dash 4 gap 3 (path
   * `M0.5 0.5l4 0m3 0…`), `component-soft` fill when empty. Box = slot frame box moved by
   * (dx, dy) and widened by dw, height unchanged — read from both boards: slot 188×39 →
   * outline at (−4, +2) 196×39. (World units at 100%; the host scales the offsets by zoom.)
   */
  slot: { width: 1, dash: [4, 3] as const, fillWhenEmpty: "component-soft", dx: -4, dy: 2, dw: 8 },
  /**
   * Selection in component tone: same geometry as {@link OVERLAY_SPEC} (outline 1.5, handles
   * 8 / stroke 1.5 / radius 2, badge pill) with `component` instead of `selection`.
   */
  selection: { color: "component" },
  /** Board 13 `GMebs`: insertion bar 2 high, radius 1, fill `component`; 4 below the previous child. */
  insertionBar: { height: 2, radius: 1, color: "component", gapBelowPrevious: 4 },
  /** Board 13 `d8kP2n`: replace target, stroke 1.5 `component`, fill `component-soft`, radius 2, outset 2. */
  replaceTarget: { strokeWidth: 1.5, radius: 2, outset: 2, fill: "component-soft" },
  /** DOM positions (host). */
  dom: {
    /** CanvasLabel above a root main / root instance: like the artboard label, 22 above (board 12 `dfoWu`: y 448 vs 470). */
    rootLabelOffset: 22,
    /** CanvasLabel/Instance above a nested instance: 18 above its top-left (board 11 `B70Th`: y −18). */
    nestedLabelOffset: 18,
    /** SlotBadge (board 12 `LQoWJ`): left = outline left, top = outline bottom + 4. */
    slotBadge: { gapBelowOutline: 4 },
    /** SlotQuickInsert row (board 12 `g9pFd`): gap 4 between chips; 13 below the main, 12 from its left. */
    quickInsert: { gap: 4, dx: 12, dy: 13 },
    /** Size badge under a main showing quick insert (board 12 `F4JHL`): 4 below the quick-insert row. */
    sizeBadgeBelowQuickInsert: 4,
  },
} as const

// --- Icons ---------------------------------------------------------------------------------

/** Icon libraries the editor offers (board 09 icon picker: Lucide · Phosphor · Material · Feather). */
export type IconLibrary = "lucide" | "phosphor" | "material" | "feather"

/** A path of an icon glyph, in the glyph's `viewBox` units. */
export interface IconPath {
  d: string
  /** `stroke` paths (lucide, feather) are drawn with the node's stroke width, round caps/joins. */
  paint: "fill" | "stroke"
  fillRule?: "nonzero" | "evenodd"
  /** Phosphor duotone back layer is 0.2. Default 1. */
  opacity?: number
}

/**
 * Normalized glyph: every SVG element (circle, rect, line, polyline, polygon, path) converted
 * to path data. The renderer scales `viewBox` to the node's `w`×`h` and paints with the node's
 * `color` (default: the text default color rule does not apply; absent = #000000).
 */
export interface IconGlyph {
  set: string
  name: string
  /** Resolved weight (Material wght 100–700; phosphor 100/300/400/700), or null. */
  weight: number | null
  viewBox: readonly [number, number, number, number]
  paths: readonly IconPath[]
  /** Native stroke width for stroke sets (2 for lucide/feather), in `viewBox` units. */
  strokeWidth?: number
}

/** One searchable entry of a library (icon picker). */
export interface IconCatalogEntry {
  name: string
  tags?: readonly string[]
}

/**
 * Icon data source (ADR 0010). Lazy per icon: never bundles a whole set into the main chunk.
 * `set` is the `.kimo` icon node `set` (`lucide`, `feather`, `phosphor`,
 * `material-outlined`, `material-rounded`, `material-sharp`).
 */
export interface IconProvider {
  /** Loads (once) one glyph. Resolves null for an unknown set/name (drawn as missing glyph). */
  load(set: string, name: string, weight?: number): Promise<IconGlyph | null>
  /** Synchronous cache read (draw path). */
  get(set: string, name: string, weight?: number): IconGlyph | null
  /** Names (and tags) of a set for the picker; loaded lazily, cached. */
  catalog(set: string): Promise<readonly IconCatalogEntry[]>
  /** Fires after a glyph finishes loading. Returns an unsubscribe function. */
  onIconLoaded(listener: (set: string, name: string) => void): () => void
  /**
   * Optional: `missing` = not in the set (final); `failed` = the last load failed (network)
   * and is retried with backoff; `unknown` = never requested. Without it, a null load counts
   * as missing.
   */
  status?(
    set: string,
    name: string,
    weight?: number,
  ): "loading" | "ready" | "missing" | "failed" | "unknown"
}

// --- Fonts ---------------------------------------------------------------------------------

export type FontStyle = "normal" | "italic"

/** A concrete font face. Weight is the requested CSS weight (1–1000). */
export interface FontFaceKey {
  family: string
  weight: number
  style: FontStyle
}

/** Where font bytes come from; tried in order by the {@link FontProvider}. */
export interface FontSource {
  readonly name: string
  /** TTF/OTF/WOFF/WOFF2 bytes for the nearest available face, or null if this source has none. */
  fetch(key: FontFaceKey): Promise<{ bytes: Uint8Array; weight: number; style: FontStyle } | null>
}

/** Result of {@link FontProvider.ensureFont}. */
export interface FontLoadResult {
  key: FontFaceKey
  /** False when no source had the family and the fallback is used. */
  loaded: boolean
  /** The face actually used (nearest weight/style, or the fallback family). */
  resolved: FontFaceKey
  source?: string
}

/**
 * Font registry backing Paragraph (CanvasKit `TypefaceFontProvider`). Text measured before its
 * font arrives uses the fallback; when the font loads, `onFontLoaded` fires and the host must
 * re-run layout for text nodes using that family (ADR 0009 "fonts").
 */
export interface FontProvider {
  /** Loads (once) and registers a face. Never rejects for a missing font. */
  ensureFont(family: string, weight: number, style: FontStyle): Promise<FontLoadResult>
  /** Synchronous check: is this face (or its nearest registered weight) available? */
  has(family: string, weight: number, style: FontStyle): boolean
  /** Registers bytes directly (document font assets, tests). */
  register(bytes: Uint8Array, key: FontFaceKey): void
  /** Fires after a face finishes loading. Returns an unsubscribe function. */
  onFontLoaded(listener: (key: FontFaceKey) => void): () => void
  /**
   * The registered font file Paragraph uses for this face (nearest weight/style of the family),
   * or null when the family is not registered. PDF export embeds it so glyphs and line breaks
   * match the canvas.
   */
  faceBytes?(family: string, weight: number, style: FontStyle): Uint8Array | null
  /** Deterministic last-resort family (bundled Inter). */
  readonly fallbackFamily: string
}

// --- Renderer ------------------------------------------------------------------------------

/** Options for {@link Renderer.init}. */
export interface RendererInitOptions {
  /**
   * URL of `canvaskit.wasm` (browser: a Vite `?url` import of
   * `canvaskit-wasm/bin/canvaskit.wasm`). Headless: omitted → resolved from node_modules.
   */
  canvaskitWasmUrl?: string
  /** Font sources, tried in order after the bundled faces (e.g. cache, Google Fonts). */
  fontSources?: readonly FontSource[]
  /** Disallow network font fetches ("no third-party fetch" setting). Default false. */
  offlineFonts?: boolean
  overlayTheme?: OverlayTheme
  /** Icon glyph source (M2). Default: the renderer's lazy static-package provider. */
  icons?: IconProvider
}

/** Options for {@link Renderer.attach}. */
export interface AttachOptions {
  /** Device pixel ratio. Default `globalThis.devicePixelRatio ?? 1`. */
  dpr?: number
  /** Force the CPU (software) surface: WebGL unavailable or broken (ADR 0004 consequences). */
  software?: boolean
}

/** Options for {@link Renderer.hitTest}. */
export interface HitTestOptions {
  /** Extra screen-px slop around thin shapes and text. Default 0. */
  tolerance?: number
  /** Include locked nodes. Default false. */
  includeLocked?: boolean
  /** Include invisible nodes. Default false. */
  includeHidden?: boolean
  /**
   * Restrict results to these candidates (e.g. the children of the entered group). The
   * selection policy (top-level frame vs deepest child, ⌘-click deep select) is the host's.
   */
  within?: ReadonlySet<string>
}

/** Options for {@link Renderer.hitTestRect}. */
export interface HitTestRectOptions extends Omit<HitTestOptions, "tolerance"> {
  /** `intersect` (default): any overlap. `contain`: fully inside. */
  mode?: "intersect" | "contain"
}

/** Options for {@link Renderer.exportRaster}. */
export interface RasterExportOptions {
  /** Pixel scale (1 = 1 world unit per pixel). Default 1. */
  scale?: number
  /** Background behind the node; default transparent. */
  background?: string
}

/** Rolling frame statistics for the perf gate (M1: 5k nodes at 60 fps). */
export interface RenderStats {
  /** Frames rendered since attach. */
  frames: number
  /** Frames per second over the last second of activity. */
  fps: number
  /** Last frame's CPU time in ms (scene traversal + command recording + flush). */
  frameMs: number
  /** Mean / 95th percentile CPU frame time over the last 120 frames. */
  frameMsAvg: number
  frameMsP95: number
  /** CanvasKit draw calls issued in the last frame. */
  drawCalls: number
  /** Nodes painted / skipped by viewport culling in the last frame. */
  nodesDrawn: number
  nodesCulled: number
  backend: "webgl" | "software" | "raster"
  /**
   * M2 diagnostics of the last frame (perf harness): CPU ms spent recording pictures and
   * creating raster-cache images, and how many roots were recorded / rasterized.
   */
  recordMs?: number
  rasterMs?: number
  /** Pictures recorded in the last frame: root pictures plus shared instance pictures. */
  recorded?: number
  rasterized?: number
  /**
   * M3: shared instance pictures recorded in the last frame (one per distinct expanded
   * instance content; included in `recorded`), and top-level instance roots that re-attached
   * to a shared picture instead of recording one of their own.
   */
  sharedRecorded?: number
  wrapped?: number
}

/** Error thrown/reported by the renderer. */
export class RendererError extends Error {
  override readonly name = "RendererError"
  constructor(
    readonly code:
      | "NOT_INITIALIZED"
      | "WASM_LOAD_FAILED"
      | "WEBGL_UNAVAILABLE"
      | "CONTEXT_LOST"
      | "NODE_NOT_FOUND"
      | "NOT_IMPLEMENTED",
    message: string,
  ) {
    super(message)
  }
}

/**
 * The renderer. Lifecycle: `init` → (`attach`)? → `setDocument` → `setLayout` → frames →
 * `dispose`. All `set*` calls are cheap and only mark state; drawing happens in `render()`
 * (synchronous) or on the next animation frame after `requestFrame()` (coalesced).
 */
/**
 * Board 35: how one node is drawn this frame, on top of its laid-out state. Offsets are world
 * px relative to the parent's own motion (children ride with their parent); `scale` is about
 * the node's world box center; `opacity` multiplies the node's own; `w` / `h` replace the drawn
 * size of a frame or rectangle (a parent growing during a reflow).
 */
export interface NodeMotion {
  opacity?: number
  dx?: number
  dy?: number
  scale?: number
  w?: number
  h?: number
}

/** Node id → its motion this frame (see {@link Renderer.setMotion}). */
export type MotionFrame = ReadonlyMap<string, NodeMotion>

export interface Renderer {
  /** Loads CanvasKit and the bundled fonts. Idempotent. */
  init(options?: RendererInitOptions): Promise<void>
  /** Binds an on-screen surface (WebGL, falls back to software). Browser only. */
  attach(canvas: HTMLCanvasElement | OffscreenCanvas, options?: AttachOptions): void
  /** Resizes the attached surface (CSS px + dpr). */
  resize(width: number, height: number, dpr?: number): void
  /** Releases the surface (the renderer stays usable headlessly). */
  detach(): void

  setDocument(scene: RenderScene): void
  /** Paint-only changes (fill, opacity, effects…): drop cached paints/pictures for these ids (all when omitted). */
  invalidate(nodeIds?: Iterable<string>): void
  setLayout(layout: LayoutResult): void
  setViewport(viewport: Viewport): void
  setOverlay(overlay: Overlay): void
  /**
   * Board 35 "Agent build motion": per-node draw offsets for the frames of an entrance / reflow
   * animation (null = none). Render only: layout, hit testing, overlays, `exportRaster` and
   * `snapshot` keep drawing the final state. Optional for fakes.
   */
  setMotion?(motion: MotionFrame | null): void

  /** Draws now (no-op when not attached). */
  render(): void
  /** Schedules one coalesced draw on the next animation frame. */
  requestFrame(): void
  /**
   * Draws now when a frame is pending (the scheduled callback then does nothing) and returns
   * true; false when nothing was pending. Call it at the end of an animation-frame callback
   * that changed the scene (layout flush), so the change lands in this frame instead of the
   * next one.
   */
  renderPending(): boolean

  /** Node ids under a screen point, top-most (last painted) first. */
  hitTest(screen: Point, options?: HitTestOptions): string[]
  /** Node ids whose world boxes meet a screen-space rectangle, top-most first. */
  hitTestRect(screen: Rect, options?: HitTestRectOptions): string[]
  screenToWorld(p: Point): Point
  worldToScreen(p: Point): Point

  /** Paragraph-backed measurer for the layout engine (same engine draws the text). */
  textMeasurer(): TextMeasurer
  readonly fonts: FontProvider
  /** Icon glyph source (M2; optional so M1 fakes keep compiling). */
  readonly icons?: IconProvider
  /**
   * Loads every font face the subtree's text uses (needs `setDocument` + `setLayout`). Layout
   * measured afterwards uses the real faces (exports, MCP renders). Optional for fakes.
   */
  ensureFonts?(nodeId: string): Promise<void>
  /**
   * Fonts may resolve differently now (document fonts added, the offline font pack downloaded):
   * forgets families known missing and re-records, so their text asks the sources again.
   * Optional for fakes.
   */
  retryFonts?(): void

  /**
   * PNG bytes of one node's subtree at `scale`, rendered on a CPU raster surface (works
   * headless). Waits for its fonts and image assets. Overlays are never included.
   */
  exportRaster(nodeId: string, options?: RasterExportOptions): Promise<Uint8Array>
  /**
   * M2 (#4 "Pixel readout"): the document's own color of the one document pixel containing
   * world point `world` (no canvas background, no overlays), as unpremultiplied RGBA 0–255;
   * null when nothing is laid out. Optional so M1 fakes keep compiling.
   */
  samplePixel?(world: Point): [number, number, number, number] | null
  /**
   * Board 27 crop mode: natural size of an image asset (loads it when needed); null when it is
   * missing or not an image. Optional for fakes.
   */
  imageSize?(src: string): Promise<{ width: number; height: number } | null>

  stats(): RenderStats
  /** Frees every CanvasKit object and the surface. */
  dispose(): void
}

/** Options for {@link createRenderer}. */
export interface CreateRendererOptions {
  /** Called on unrecoverable GPU errors (context lost twice, …). */
  onError?: (error: RendererError) => void
}

/** Factory signature the web app's CanvasHost receives (so tests can inject a fake). */
export type RendererFactory = (options?: CreateRendererOptions) => Renderer

/**
 * Board 27 §4 (b) rulers (Iaqcg › Ko6aO): "Ruler · top" FPOwB 20 tall / "Ruler · left" euDLd
 * 20 wide, fill `bg-app`, inner edge stroke 1 `border`; "Corner" O90uvJ 20 × 20 with right and
 * bottom strokes. Ticks 1 × 8 `border-strong` on the inner edge (y 12 / x 12); numbers mono 9
 * normal `text-tertiary` at tick + 3, y 3 (top ruler only, as designed). "Selection Range"
 * full-strip `selection-soft`; "Sel Start" at range + 3 and "Sel End" ending 5 before the range
 * end, in `selection`; tick numbers under the range are hidden. Ticks every "nice" step: the
 * smallest of 1 · 2 · 4 · 5 × 10ⁿ whose spacing is ≥ `minSpacing` px (1600 % → 4, 64 px).
 */
export const OVERLAY_SPEC_RULERS = {
  size: 20,
  borderWidth: 1,
  tick: { length: 8, width: 1 },
  label: { fontSize: 9, dx: 3, dy: 3, endGap: 5 },
  minSpacing: 50,
  defaults: {
    bg: "#FFFFFF",
    border: "#ECEBE8",
    tick: "#DDDBD7",
    text: "#9A9DA2",
  },
} as const

/** Ruler tick step in world units for `zoom` (see {@link OVERLAY_SPEC_RULERS}). */
export function rulerStep(
  zoom: number,
  minSpacing: number = OVERLAY_SPEC_RULERS.minSpacing,
): number {
  for (let k = 0; k < 12; k++)
    for (const m of [1, 2, 4, 5]) {
      const step = m * 10 ** k
      if (step * zoom >= minSpacing) return step
    }
  return 10 ** 12
}
