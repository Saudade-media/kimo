/**
 * M6 canvas model (board 22 "Built-in Agent (M6)" D0zDSY, board 24 iLW1l, ADR 0014 §8–9):
 * tracks the document's placeholder frames and prompt nodes incrementally from store changes,
 * turns the host's {@link AgentCanvasProps} into renderer overlay fields (outlines, shimmer,
 * skeleton, flashes, scopes, persona selections, rejected flashes, connectors) and projects the
 * DOM pieces (placeholder tags, ready chips, ScopeTags, rejected pills, persona cursors, prompt
 * footers, target chips) to screen space. Framework-free; CanvasHost renders the DOM.
 */
import { isOrphanPlaceholder, placeholderOwner, promptFooter } from "@kimo/ai-agent"
import { type LayoutResult, PROMPT_CHROME, type Rect } from "@kimo/layout"
import {
  type AgentPersona,
  OVERLAY_SPEC_M6,
  type Overlay,
  type PlaceholderFlash,
  type PlaceholderOverlay,
  type Viewport,
} from "@kimo/renderer"
import type {
  AgentCanvasProps,
  CanvasAgentMarkState,
  CanvasAgentPersona,
  CanvasPromptRun,
} from "./contract"

/** Minimal node reader (DocStore / NodeSource). */
export interface AgentNodeReader {
  getNode(id: string): Record<string, unknown> | undefined
  children(parent: string | null): readonly string[]
  nodeIds?(): string[]
}

/** F1viK5: the flash lasts 1.2 s; the "ready" chip stays 4 s. */
export const FLASH_MS = OVERLAY_SPEC_M6.flash.durationMs
export const READY_CHIP_MS = 4000
/** Rejected-op pill and target flash (house value: the design gives no duration). */
export const REJECT_MS = 3000
/** Shimmer frame interval: 30 fps is enough for a 1.6 s sweep at 12 % alpha. */
export const SHIMMER_FRAME_MS = 1000 / 30

/** Board 24 GmEAl: Lead = Teal, then Iris → Violet → Rose → Ember → Moss (repeating). */
export const PERSONA_ORDER: readonly CanvasAgentPersona[] = [
  "iris",
  "violet",
  "rose",
  "ember",
  "moss",
]

/** Persona of agent number `n` (lead 0 = `agent`). */
export function personaFor(n: number): CanvasAgentPersona {
  return n <= 0 ? "agent" : (PERSONA_ORDER[(n - 1) % PERSONA_ORDER.length] as CanvasAgentPersona)
}

interface Flash {
  at: number
  origin: string | undefined
  name: string
  ops: number | undefined
  persona: AgentPersona
}

const nameOf = (n: Record<string, unknown> | undefined, fallback: string): string =>
  typeof n?.name === "string" && n.name ? n.name : fallback

const isPlaceholder = (v: unknown): boolean => v !== undefined && v !== null && v !== false

// --- DOM projection types ------------------------------------------------------------------

export interface PlaceholderTagView {
  id: string
  origin: string | undefined
  /** Screen top-left of the tag (inside the frame's padding 16, EKCy7). */
  left: number
  top: number
  text: string
  state: "building" | "interrupted"
  persona: CanvasAgentPersona
  /** Tooltip copy: "<label> is building this frame". */
  label: string
}

export interface ReadyChipView {
  id: string
  origin: string | undefined
  left: number
  top: number
  text: string
}

export interface ScopeTagView {
  key: string
  left: number
  top: number
  /** `right`: `left` is the tag's right edge (split: inside the section's top-right). */
  anchor: "left" | "right"
  text: string
  persona: CanvasAgentPersona
}

/** Iterate Pass Chip (h6oHb `NCElh`): 7 below the outset outline, left-aligned with it. */
export interface PassChipView {
  key: string
  left: number
  top: number
  text: string
}

export interface RejectedPillView {
  key: string
  /** Pill center x, top y. */
  cx: number
  top: number
  text: string
}

export interface CursorView {
  origin: string
  left: number
  top: number
  /** Pill flips left / up within 8 px of a viewport edge (board 24 decision G2). */
  flipX: boolean
  flipY: boolean
  text: string
  persona: CanvasAgentPersona
  state: CanvasAgentMarkState
  /** Stack index among cursors on the same node (pills 4 px apart, lead on top). */
  stack: number
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
  tags: PlaceholderTagView[]
  ready: ReadyChipView[]
  scopes: ScopeTagView[]
  passes: PassChipView[]
  rejected: RejectedPillView[]
  cursors: CursorView[]
  prompts: PromptView[]
}

export const EMPTY_DOM: AgentDomState = {
  tags: [],
  ready: [],
  scopes: [],
  passes: [],
  rejected: [],
  cursors: [],
  prompts: [],
}

/** Default footer formatters ("Ran 4m ago · 18 ops · $0.06"). */
export function defaultAgo(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function defaultUsd(v: number | null): string {
  return v === null ? "—" : `$${v.toFixed(2)}`
}

export class AgentCanvasModel {
  props: AgentCanvasProps | null = null
  /** Frames carrying `placeholder` → their value. */
  readonly placeholders = new Map<string, unknown>()
  /** Prompt nodes → their `target`. */
  readonly prompts = new Map<string, string | undefined>()
  private readonly flashes = new Map<string, Flash>()
  private readonly rejectedSeen = new Map<string, number>()
  /** Board 31 landing flashes: key → when it was first seen. */
  private readonly landedSeen = new Map<string, number>()
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
    for (const id of ids) this.read(id, false)
  }

  /** Incremental: re-reads changed ids; a cleared placeholder starts its flash. */
  scan(ids: Iterable<string>): void {
    for (const id of ids) this.read(id, true)
  }

  private read(id: string, flash: boolean): void {
    const n = this.nodes.getNode(id)
    const had = this.placeholders.get(id)
    const wasPlaceholder = this.placeholders.has(id)
    if (n && n.type === "frame" && isPlaceholder(n.placeholder)) {
      this.placeholders.set(id, n.placeholder)
      this.flashes.delete(id)
    } else {
      this.placeholders.delete(id)
      if (flash && wasPlaceholder && n) {
        const origin = placeholderOwner(had)
        const info = origin ? this.props?.agent(origin) : null
        this.flashes.set(id, {
          at: this.now(),
          origin,
          name: nameOf(n, "Frame"),
          ops: info?.ops,
          persona: info?.persona ?? "agent",
        })
      }
    }
    if (n && n.type === "prompt")
      this.prompts.set(id, typeof n.target === "string" ? n.target : undefined)
    else this.prompts.delete(id)
  }

  private live(): ReadonlySet<string> {
    return this.props?.liveOrigins ?? EMPTY_SET
  }

  /** Building placeholders (not orphaned) exist: the shimmer needs frames. */
  private building(): boolean {
    const live = this.live()
    for (const v of this.placeholders.values()) if (!isOrphanPlaceholder(v, live)) return true
    return false
  }

  /** True while something animates (shimmer, flash, ready chip, rejected pill). */
  animating(): boolean {
    const t = this.now()
    if (!this.reducedMotion && this.building()) return true
    for (const f of this.flashes.values()) if (t - f.at < READY_CHIP_MS) return true
    for (const at of this.rejectedSeen.values()) if (t - at < REJECT_MS) return true
    for (const at of this.landedSeen.values()) if (t - at < FLASH_MS) return true
    return false
  }

  /** Drops expired flashes / rejections (call per frame). */
  prune(): void {
    const t = this.now()
    for (const [id, f] of this.flashes) if (t - f.at >= READY_CHIP_MS) this.flashes.delete(id)
  }

  /** True when there is anything for the overlay or DOM. */
  active(): boolean {
    return (
      this.placeholders.size > 0 ||
      this.prompts.size > 0 ||
      this.flashes.size > 0 ||
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
    const t = this.now()
    const live = this.live()
    const placeholders: PlaceholderOverlay[] = []
    for (const [id, v] of this.placeholders) {
      if (!layout.nodes.has(id)) continue
      placeholders.push({
        id,
        persona: this.persona(placeholderOwner(v)),
        state: isOrphanPlaceholder(v, live) ? "interrupted" : "building",
        skeleton: this.nodes.children(id).length === 0,
      })
    }
    const flashes: PlaceholderFlash[] = []
    for (const [id, f] of this.flashes) {
      const p = (t - f.at) / FLASH_MS
      if (p < 1 && layout.nodes.has(id)) flashes.push({ id, progress: p, persona: f.persona })
    }
    const p = this.props
    // Board 31: each landed edit flashes its top-most layers once (same ring as F1viK5).
    for (const l of p?.landed ?? []) {
      const at = this.landedSeen.get(l.key)
      if (at === undefined) continue
      const progress = (t - at) / FLASH_MS
      if (progress >= 1) continue
      const persona = this.persona(l.origin)
      for (const id of l.ids)
        if (layout.nodes.has(id) && !this.placeholders.has(id))
          flashes.push({ id, progress, persona })
    }
    const scopes = (p?.scopes ?? []).flatMap((s) =>
      s.roots
        .filter((id) => layout.nodes.has(id))
        .map((id) => ({
          id,
          persona: this.persona(s.origin),
          fit: s.mode === "split" ? ("flush" as const) : ("outset" as const),
        })),
    )
    const agentSelections = (p?.cursors ?? [])
      .filter((c) => layout.nodes.has(c.nodeId))
      .map((c) => ({ id: c.nodeId, persona: this.persona(c.origin) }))
    const rejected = (p?.rejections ?? [])
      .filter(
        (r) => t - (this.rejectedSeen.get(r.key) ?? t) < REJECT_MS && layout.nodes.has(r.nodeId),
      )
      .map((r) => r.nodeId)
    const promptConnectors = [...this.prompts]
      .filter(([id, target]) => target && layout.nodes.has(id) && layout.nodes.has(target))
      .map(([prompt, target]) => ({ prompt, target: target as string }))
    return {
      placeholders,
      placeholderFlashes: flashes,
      shimmerPhase: this.reducedMotion
        ? null
        : (t % OVERLAY_SPEC_M6.placeholder.shimmerPeriodMs) /
          OVERLAY_SPEC_M6.placeholder.shimmerPeriodMs,
      scopes,
      agentSelections,
      rejected,
      promptConnectors,
    }
  }

  /** DOM pieces in screen space (canvas CSS px). */
  dom(layout: LayoutResult | null, v: Viewport, size: { w: number; h: number }): AgentDomState {
    if (!layout || !this.active()) return EMPTY_DOM
    const t = this.now()
    const live = this.live()
    const p = this.props
    const screen = (id: string): Rect | null => {
      const l = layout.nodes.get(id)
      if (!l?.visible) return null
      return {
        x: (l.world.x - v.x) * v.zoom,
        y: (l.world.y - v.y) * v.zoom,
        w: l.world.w * v.zoom,
        h: l.world.h * v.zoom,
      }
    }
    const onScreen = (r: Rect) =>
      size.w === 0 || (r.x + r.w > -64 && r.x < size.w + 64 && r.y + r.h > -64 && r.y < size.h + 64)

    // Placeholder tags (EKCy7 Tag: inside the 16 px padding) — hidden on tiny frames.
    const tags: PlaceholderTagView[] = []
    for (const [id, val] of this.placeholders) {
      const r = screen(id)
      if (!r || !onScreen(r) || r.w < 48 || r.h < 28) continue
      const origin = placeholderOwner(val)
      const info = origin ? p?.agent(origin) : null
      const orphan = isOrphanPlaceholder(val, live)
      const label = info?.label ?? "Kimo"
      const name = nameOf(this.nodes.getNode(id), "Frame")
      const inset = Math.min(16, r.w / 8)
      tags.push({
        id,
        origin,
        left: r.x + inset,
        top: r.y + inset,
        state: orphan ? "interrupted" : "building",
        // Board 25 §3 kTwwU / rule jMJaL: an orphan reads "Agent stopped · <name>".
        // Board 31 "Canvas label": the agent's name only (no state, tool or counts).
        text: orphan ? `Agent stopped · ${name}` : label,
        persona: info?.persona ?? "agent",
        label,
      })
    }

    // "<name> ready · N ops · Review" (Done Chip i6wxFe: 12 below the frame, left-aligned).
    const ready: ReadyChipView[] = []
    for (const [id, f] of this.flashes) {
      if (t - f.at >= READY_CHIP_MS) continue
      const r = screen(id)
      if (!r || !onScreen(r)) continue
      ready.push({
        id,
        origin: f.origin,
        left: r.x,
        top: r.y + r.h + 12,
        text: `${f.name} ready${f.ops ? ` · ${f.ops} ops` : ""}`,
      })
    }

    // ScopeTags (NKE7Z): outset → 3 px above the outline, left-aligned (t51Sk / R6qeO);
    // split → inside the section's top edge, right-aligned (HHDET / laiQs).
    const scopes: ScopeTagView[] = []
    const passes: PassChipView[] = []
    for (const s of p?.scopes ?? []) {
      const info = p?.agent(s.origin)
      for (const id of s.roots) {
        const r = screen(id)
        if (!r || !onScreen(r)) continue
        const name = nameOf(this.nodes.getNode(id), "Frame")
        const persona = info?.persona ?? "agent"
        const text =
          s.mode === "single" || s.mode === "iterate"
            ? `Agent can only edit inside ${name}`
            : `${info?.label ?? "Agent"} · only inside ${name}`
        if (s.mode === "split")
          scopes.push({
            key: `${s.origin}/${id}`,
            left: r.x + r.w - 6,
            top: r.y + 6,
            anchor: "right",
            text,
            persona,
          })
        else {
          const o = OVERLAY_SPEC_M6.scope.outset
          if (s.mode === "iterate" && s.iterate)
            passes.push({
              key: `${s.origin}/${id}`,
              left: r.x - o,
              top: r.y + r.h + o + 7,
              text: `Iterate · pass ${s.iterate.pass} of ${s.iterate.of}${s.iterate.reviewing ? " · review" : ""}`,
            })
          scopes.push({
            key: `${s.origin}/${id}`,
            left: r.x - o,
            top: r.y - o - 3 - 20,
            anchor: "left",
            text,
            persona,
          })
        }
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

    // Persona cursors: anchor = target top-left (+4, +4); pills stack per node, lead on top.
    const cursors: CursorView[] = []
    const perNode = new Map<string, number>()
    const sorted = [...(p?.cursors ?? [])].sort(
      (a, b) =>
        (p?.agent(a.origin)?.persona === "agent" ? 0 : 1) -
        (p?.agent(b.origin)?.persona === "agent" ? 0 : 1),
    )
    for (const c of sorted) {
      const r = screen(c.nodeId)
      if (!r) continue
      const stack = perNode.get(c.nodeId) ?? 0
      perNode.set(c.nodeId, stack + 1)
      const info = p?.agent(c.origin)
      const left = r.x + 4
      const top = r.y + 4
      cursors.push({
        origin: c.origin,
        left,
        top,
        flipX: size.w > 0 && left + 240 > size.w - 8,
        flipY: size.h > 0 && top + 18 + 2 + 22 > size.h - 8,
        // Board 31 "Canvas label": the agent's name only; status lives in the panel.
        text: info?.label ?? "Agent",
        persona: info?.persona ?? "agent",
        state: c.state,
        stack,
      })
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
        box: r,
        zoom: v.zoom,
        status,
        footer,
        action: status === "running" ? "stop" : status === "failed" ? "retry" : "run",
        target: chip,
      })
    }
    return { tags, ready, scopes, passes, rejected, cursors, prompts }
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set()

/** Prompt footer height in world units (DOM footer = 42 × zoom). */
export const PROMPT_FOOTER_H = PROMPT_CHROME.footerHeight

export type { CanvasPromptRun }

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
