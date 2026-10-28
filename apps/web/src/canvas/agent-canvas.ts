/**
 * M6 canvas model (board 22 "Built-in Agent (M6)" D0zDSY, board 24 iLW1l, ADR 0014 §8–9) under
 * board 36 "Agent on canvas" (XDVdg): tracks the document's placeholder frames and prompt nodes
 * incrementally from store changes, and turns the host's {@link AgentCanvasProps} into what the
 * canvas shows while the built-in agent works: per agent one cursor on the center of its section
 * plus a 1 px outline on that section, one ring per landed edit on the section, the rejected-op
 * flash and pill, prompt connectors, footers and target chips, and the Iterate pass chip.
 * Placeholder frames draw nothing of their own (no tag, shimmer or skeleton). Framework-free;
 * CanvasHost renders the DOM.
 */
import { promptFooter } from "@kimo/ai-agent"
import type { LayoutResult, Rect } from "@kimo/layout"
import { OVERLAY_SPEC_M6, type Overlay, type Viewport } from "@kimo/renderer"
import type { SectionCursorView, SectionFlashView } from "./AgentSectionCursor"
import { cursorFlip } from "./AgentSectionCursor"
import {
  CURSOR_GLIDE_MS,
  centerOf,
  type Glide,
  glideAt,
  pickSection,
  retarget,
  SECTION_FLASH_MS,
} from "./agent-area"
import type { AgentCanvasProps, CanvasAgentPersona } from "./contract"

/** Minimal node reader (DocStore / NodeSource). */
export interface AgentNodeReader {
  getNode(id: string): Record<string, unknown> | undefined
  children(parent: string | null): readonly string[]
  nodeIds?(): string[]
}

/** Board 36 section flash: 1.2 s. */
const FLASH_MS = SECTION_FLASH_MS
/** Rejected-op pill and target flash (house value: the design gives no duration). */
const REJECT_MS = 3000

const nameOf = (n: Record<string, unknown> | undefined, fallback: string): string =>
  typeof n?.name === "string" && n.name ? n.name : fallback

const isPlaceholder = (v: unknown): boolean => v !== undefined && v !== null && v !== false

// --- DOM projection types ------------------------------------------------------------------

/** Iterate Pass Chip (h6oHb `NCElh`): 7 below the outset outline, left-aligned with it. */
interface PassChipView {
  key: string
  left: number
  top: number
  text: string
}

interface RejectedPillView {
  key: string
  /** Pill center x, top y. */
  cx: number
  top: number
  text: string
}

export interface PromptView {
  id: string
  /** Screen box of the card. */
  box: Rect
  zoom: number
  status: "idle" | "running" | "failed" | "never"
  footer: string
  /** Run button: Run (idle / never), Stop (running), Retry (failed). */
  action: "run" | "stop" | "retry"
  target: { left: number; top: number; text: string } | null
}

export interface AgentDomState {
  /** Board 36: one cursor + section outline per agent. */
  cursors: SectionCursorView[]
  /** Board 36: one ring per landed edit, on its section. */
  flashes: SectionFlashView[]
  passes: PassChipView[]
  rejected: RejectedPillView[]
  prompts: PromptView[]
}

export const EMPTY_DOM: AgentDomState = {
  cursors: [],
  flashes: [],
  passes: [],
  rejected: [],
  prompts: [],
}

/** Default footer formatters ("Ran 4m ago · 18 ops · $0.06"). */
function defaultAgo(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function defaultUsd(v: number | null): string {
  return v === null ? "—" : `$${v.toFixed(2)}`
}

export class AgentCanvasModel {
  props: AgentCanvasProps | null = null
  /** Frames carrying `placeholder` → their value (no canvas drawing; board 36). */
  readonly placeholders = new Map<string, unknown>()
  /** Prompt nodes → their `target`. */
  readonly prompts = new Map<string, string | undefined>()
  private readonly rejectedSeen = new Map<string, number>()
  /** Board 36 section flashes: landed key → when it was first seen. */
  private readonly landedSeen = new Map<string, number>()
  /**
   * Agent cursors' world anchors (the section center): the cursor glides from `from` to `to` in
   * world space, so a pan or zoom mid-glide moves it with the canvas (board 31 "Position lock").
   */
  private readonly glides = new Map<string, Glide>()
  /** Each cursor's section (resolved with the glide). */
  private readonly sections = new Map<string, string>()
  private reduced: boolean

  constructor(
    private readonly nodes: AgentNodeReader,
    private readonly now: () => number = () => globalThis.performance?.now() ?? Date.now(),
  ) {
    this.reduced =
      typeof globalThis.matchMedia === "function" &&
      globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
  }

  get reducedMotion(): boolean {
    return this.props?.reducedMotion ?? this.reduced
  }

  setProps(props: AgentCanvasProps | null): void {
    this.props = props
    const t = this.now()
    const keys = new Set<string>()
    for (const r of props?.rejections ?? []) {
      keys.add(r.key)
      if (!this.rejectedSeen.has(r.key)) this.rejectedSeen.set(r.key, t)
    }
    for (const k of this.rejectedSeen.keys()) if (!keys.has(k)) this.rejectedSeen.delete(k)
    const landed = new Set<string>()
    for (const l of props?.landed ?? []) {
      landed.add(l.key)
      if (!this.landedSeen.has(l.key)) this.landedSeen.set(l.key, t)
    }
    for (const k of this.landedSeen.keys()) if (!landed.has(k)) this.landedSeen.delete(k)
  }

  /** Full scan (load / first layout). */
  scanAll(): void {
    this.placeholders.clear()
    this.prompts.clear()
    const ids = this.nodes.nodeIds?.() ?? []
    for (const id of ids) this.read(id)
  }

  /** Incremental: re-reads changed ids. */
  scan(ids: Iterable<string>): void {
    for (const id of ids) this.read(id)
  }

  private read(id: string): void {
    const n = this.nodes.getNode(id)
    if (n && n.type === "frame" && isPlaceholder(n.placeholder))
      this.placeholders.set(id, n.placeholder)
    else this.placeholders.delete(id)
    if (n && n.type === "prompt")
      this.prompts.set(id, typeof n.target === "string" ? n.target : undefined)
    else this.prompts.delete(id)
  }

  private parentOf = (id: string): string | null => {
    const p = this.nodes.getNode(id)?.parent
    return typeof p === "string" && p ? p : null
  }

  /** Board 36 › Section of layout-visible ids. */
  private sectionFor(
    area: readonly string[],
    pointer: string | undefined,
    layout: LayoutResult,
  ): string | null {
    return pickSection(area, pointer, this.parentOf, (id) => !!layout.nodes.get(id)?.visible)
  }

  /**
   * Re-targets each cursor (world): the center of its section (board 36). Sections resolve once
   * the layout has the new nodes; a changed target starts a 600 ms glide from where the cursor
   * is now.
   */
  private syncCursors(layout: LayoutResult): void {
    const t = this.now()
    const seen = new Set<string>()
    for (const c of this.props?.cursors ?? []) {
      const area = c.nodeIds?.length ? c.nodeIds : [c.nodeId]
      const section = this.sectionFor(area.slice(0, 50), c.pointerId, layout)
      const box = section ? layout.nodes.get(section)?.world : undefined
      if (!section || !box) continue
      seen.add(c.origin)
      this.sections.set(c.origin, section)
      this.glides.set(
        c.origin,
        retarget(this.glides.get(c.origin), centerOf(box), t, this.reducedMotion),
      )
    }
    for (const k of this.glides.keys())
      if (!seen.has(k)) {
        this.glides.delete(k)
        this.sections.delete(k)
      }
  }

  /** True while the canvas must redraw per frame: a cursor glide or a rejected flash. */
  animating(): boolean {
    const t = this.now()
    for (const g of this.glides.values()) if (t - g.at < CURSOR_GLIDE_MS) return true
    for (const at of this.rejectedSeen.values()) if (t - at < REJECT_MS) return true
    return false
  }

  /** Kept for callers: nothing expires per frame any more (flashes are CSS). */
  prune(): void {}

  /** True when there is anything for the overlay or DOM. */
  active(): boolean {
    return (
      this.prompts.size > 0 ||
      !!this.props?.scopes?.length ||
      !!this.props?.cursors?.length ||
      this.rejectedSeen.size > 0 ||
      this.landedSeen.size > 0
    )
  }

  private persona(origin: string | undefined): CanvasAgentPersona {
    return (origin && this.props?.agent(origin)?.persona) || "agent"
  }

  /** Renderer overlay fields (merged into the controller's overlay). */
  overlay(layout: LayoutResult): Partial<Overlay> {
    if (!this.active()) return {}
    // Re-targets the cursors here too, so a new target starts its glide frames at once.
    this.syncCursors(layout)
    const t = this.now()
    const p = this.props
    const rejected = (p?.rejections ?? [])
      .filter(
        (r) => t - (this.rejectedSeen.get(r.key) ?? t) < REJECT_MS && layout.nodes.has(r.nodeId),
      )
      .map((r) => r.nodeId)
    const promptConnectors = [...this.prompts]
      .filter(([id, target]) => target && layout.nodes.has(id) && layout.nodes.has(target))
      .map(([prompt, target]) => ({ prompt, target: target as string }))
    return { rejected, promptConnectors }
  }

  /** DOM pieces in screen space (canvas CSS px). */
  dom(layout: LayoutResult | null, v: Viewport, size: { w: number; h: number }): AgentDomState {
    if (!layout || !this.active()) return EMPTY_DOM
    this.syncCursors(layout)
    const t = this.now()
    const p = this.props
    const toScreen = (w: { x: number; y: number }) => ({
      x: (w.x - v.x) * v.zoom,
      y: (w.y - v.y) * v.zoom,
    })
    const radiusOf = (id: string) => {
      const r = this.nodes.getNode(id)?.radius
      return typeof r === "number" ? r * v.zoom : 0
    }
    const screen = (id: string): (Rect & { radius: number }) | null => {
      const l = layout.nodes.get(id)
      if (!l?.visible) return null
      const o = toScreen(l.world)
      return { ...o, w: l.world.w * v.zoom, h: l.world.h * v.zoom, radius: radiusOf(id) }
    }
    const onScreen = (r: Rect) =>
      size.w === 0 || (r.x + r.w > -64 && r.x < size.w + 64 && r.y + r.h > -64 && r.y < size.h + 64)

    // Iterate pass chip (NCElh): 7 below the scope root's outset box, left-aligned with it.
    const passes: PassChipView[] = []
    for (const s of p?.scopes ?? []) {
      if (s.mode !== "iterate" || !s.iterate) continue
      for (const id of s.roots) {
        const r = screen(id)
        if (!r || !onScreen(r)) continue
        const o = OVERLAY_SPEC_M6.scope.outset
        passes.push({
          key: `${s.origin}/${id}`,
          left: r.x - o,
          top: r.y + r.h + o + 7,
          text: `Iterate · pass ${s.iterate.pass} of ${s.iterate.of}${s.iterate.reviewing ? " · review" : ""}`,
        })
      }
    }

    // Rejected-op pills (O2Whh): 12 below the target's top, centered on it.
    const rejected: RejectedPillView[] = []
    for (const rj of p?.rejections ?? []) {
      const at = this.rejectedSeen.get(rj.key) ?? t
      if (t - at >= REJECT_MS) continue
      const r = screen(rj.nodeId)
      if (!r) continue
      const label = p?.agent(rj.origin)?.label ?? "Agent"
      rejected.push({
        key: rj.key,
        cx: r.x + r.w / 2,
        top: r.y + 12,
        text: `${label} · ${rj.text}`,
      })
    }

    // Board 36: one cursor per agent on its section's center (gliding in world space) and the
    // section outline; agents in one section stack their pills 26 px apart, lead on top.
    const cursors: SectionCursorView[] = []
    const perSection = new Map<string, number>()
    const sorted = [...(p?.cursors ?? [])].sort(
      (a, b) =>
        (p?.agent(a.origin)?.persona === "agent" ? 0 : 1) -
        (p?.agent(b.origin)?.persona === "agent" ? 0 : 1),
    )
    for (const c of sorted) {
      const g = this.glides.get(c.origin)
      const section = this.sections.get(c.origin)
      if (!g || !section) continue
      // Board 41 › 7: a paused agent hides its cursor (its claim outline turns warning).
      if (p?.hiddenOrigins?.has(c.origin)) continue
      const stack = perSection.get(section) ?? 0
      perSection.set(section, stack + 1)
      const info = p?.agent(c.origin)
      const tip = toScreen(glideAt(g, t))
      cursors.push({
        origin: c.origin,
        kind: "builtin",
        persona: info?.persona ?? "agent",
        // Board 36 › Label: the agent's persona name only, whatever its engine.
        label: info?.label ?? "Kimo",
        state: c.state,
        section: screen(section),
        sectionId: section,
        tip,
        stack,
        ...cursorFlip(tip, size),
        // Board 41 › 7: the claim outline replaces the section outline.
        ...(p?.claimedOrigins?.has(c.origin) ? { outline: false } : {}),
      })
    }

    // Board 36 › Section flash: each landed edit rings its section(s) once.
    const flashes: SectionFlashView[] = []
    for (const l of p?.landed ?? []) {
      const at = this.landedSeen.get(l.key)
      if (at === undefined || t - at >= FLASH_MS) continue
      const done = new Set<string>()
      for (const id of l.ids) {
        const s = this.sectionFor([id], undefined, layout)
        if (!s || done.has(s)) continue
        done.add(s)
        const box = screen(s)
        if (box) flashes.push({ key: `${l.key}/${s}`, persona: this.persona(l.origin), box })
      }
    }

    // Prompt footers (poE5B Footer) + target chips (sWQ2b: 10 below the frame).
    const prompts: PromptView[] = []
    for (const [id, target] of this.prompts) {
      const r = screen(id)
      if (!r || !onScreen(r)) continue
      const run = p?.promptRun?.(id)
      const status: PromptView["status"] = !run
        ? "never"
        : run.status === "idle" && !run.lastRun
          ? "never"
          : run.status
      const footer = promptFooter(
        run ?? { status: "idle" },
        p?.ago ?? ((x) => defaultAgo(x)),
        p?.usd ?? defaultUsd,
      )
      let chip: PromptView["target"] = null
      if (target) {
        const tr = screen(target)
        const tn = this.nodes.getNode(target)
        if (tr && tn)
          chip = { left: tr.x, top: tr.y + tr.h + 10, text: `target · ${nameOf(tn, "Frame")}` }
      }
      prompts.push({
        id,
        box: { x: r.x, y: r.y, w: r.w, h: r.h },
        zoom: v.zoom,
        status,
        footer,
        action: status === "running" ? "stop" : status === "failed" ? "retry" : "run",
        target: chip,
      })
    }
    return { cursors, flashes, passes, rejected, prompts }
  }
}

// --- Side by side placement (modes ZFOQf `agblr`, ADR 0014 §8) ----------------------------------

/** `agblr`: original right edge 304 → v1 at 344, v1 right 624 → v2 at 664. */
export const SIDE_BY_SIDE_GAP = 40

/**
 * Where the side-by-side variants go: `planSideBySide` (`@kimo/ai-agent`) lays N copies of the
 * original's box to its right at the same y. The design (`agblr`: Pricing 24…304, v1 at 344,
 * v2 at 664) spaces them 40 apart: call it with `{ gap: SIDE_BY_SIDE_GAP }`. This returns
 * the box to pass as its `original` so that row lands on free canvas: the original's own row
 * when nothing else is there, else the first y below every root frame the row would overlap
 * (keeping the gap). Pure; `roots` are the other top-level boxes (world).
 */
export function sideBySideAnchor<T extends { x: number; y: number; w: number; h: number }>(
  original: T,
  roots: readonly Rect[],
  n: number,
  gap = SIDE_BY_SIDE_GAP,
): T {
  const rowX = original.x + original.w + gap
  const rowW = n * (original.w + gap) - gap
  const hits = (y: number) =>
    roots.filter(
      (r) => r.x < rowX + rowW && rowX < r.x + r.w && r.y < y + original.h && y < r.y + r.h,
    )
  let y = original.y
  for (let guard = 0; guard < 64; guard++) {
    const over = hits(y)
    if (over.length === 0) return y === original.y ? original : { ...original, y }
    y = Math.max(...over.map((r) => r.y + r.h)) + gap
  }
  return { ...original, y }
}
