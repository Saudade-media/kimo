/**
 * Canvas-side agent surfaces (board 21): attribution outline + tag and the agent cursor (AxgvU,
 * rule "Canvas attribution"), dry-run ghosts and the Dry Run Bar (L2eaCu / P1Ulp, rule "Dry
 * run"). A DOM layer stacked over the canvas (pointer-events: none except the bar); the caller
 * projects node ids to layer coordinates.
 */
import { AgentMark, CompactButton } from "@kimo/ui"
import { useEffect, useRef, useState } from "react"
import { CURSOR_GLIDE_MS, glideEase, unionBox } from "../canvas/agent-area"
import type { AgentChipView, AgentsControllerExt } from "./controller"
import { useAgentsState } from "./hooks"
import { AgentIcon } from "./icons"
import type { GhostKind } from "./model"

/** A node's box in the layer's coordinate space (screen px), with its corner radius. */
export interface ProjectedBox {
  x: number
  y: number
  w: number
  h: number
  radius?: number
}

export interface AgentCanvasLayerProps {
  controller: AgentsControllerExt
  /** Node id → box in this layer's coordinates (null when off-canvas / not laid out). */
  project: (id: string) => ProjectedBox | null
  /** Changes whenever the viewport or layout changes, so boxes re-project. */
  viewportKey?: unknown
  /** Outline fades this long after the op group commits (rule: 2 s). */
  fadeMs?: number
  /** Off-screen cursor pill click: pan to the node (board 24 g rule 3). */
  onPanTo?: (nodeId: string) => void
  /**
   * World box of a node and world → layer projection: the cursor glides between work areas in
   * world space (board 31 "Position lock": a pan mid-glide moves it with the canvas). Without
   * them the cursor jumps.
   */
  world?: (id: string) => ProjectedBox | null
  toLayer?: (p: { x: number; y: number }) => { x: number; y: number }
}

/** Cursor hides after this much idle time (board 24 g rule 5). */
export const CURSOR_IDLE_MS = 3000

export interface CursorPlacement {
  kind: "on-canvas" | "docked"
  /** Pointer position (on canvas) or the docked pill's position. */
  x: number
  y: number
  /** Label pill flipped left / up near a viewport edge (rule 2). */
  flipX: boolean
  flipY: boolean
  /** Docked: arrow toward the target. */
  arrow?:
    | "arrow-up-left"
    | "arrow-up"
    | "arrow-up-right"
    | "arrow-left"
    | "arrow-right"
    | "arrow-down-left"
    | "arrow-down"
    | "arrow-down-right"
}

/**
 * Board 24 › 5 · (g) cursor placement rules: anchor = top-left of the target node (+4, +4); the
 * label pill sits below-right of the pointer and flips left/up within 8 px of a viewport edge; an
 * off-screen target docks the pill to the nearest edge with an arrow; several agents on one node
 * stack 4 px apart (lead on top) and never overlap the dry-run bar.
 */
export function placeCursor(
  box: ProjectedBox,
  view: { w: number; h: number },
  opts: { stack?: number; pill?: { w: number; h: number }; reservedTop?: number } = {},
): CursorPlacement {
  const pill = opts.pill ?? { w: 180, h: 26 }
  const stack = (opts.stack ?? 0) * (pill.h + 4)
  const top = opts.reservedTop ?? 0
  const ax = box.x + 4
  const ay = box.y + 4 + stack
  const off = ax < 0 || ay < top || ax > view.w || ay > view.h
  if (!off) {
    return {
      kind: "on-canvas",
      x: ax,
      y: ay,
      flipX: ax + 18 + pill.w > view.w - 8,
      flipY: ay + 20 + pill.h > view.h - 8,
    }
  }
  const h = ax < 0 ? "left" : ax > view.w ? "right" : ""
  const v = ay < top ? "up" : ay > view.h ? "down" : ""
  const arrow = (
    v && h ? `arrow-${v}-${h}` : v ? `arrow-${v}` : `arrow-${h || "right"}`
  ) as CursorPlacement["arrow"]
  return {
    kind: "docked",
    x: Math.max(8, Math.min(view.w - 8 - pill.w, ax)),
    y: Math.max(top + 8, Math.min(view.h - 8 - pill.h, ay)),
    flipX: false,
    flipY: false,
    ...(arrow ? { arrow } : {}),
  }
}

export function AgentCanvasLayer({
  controller,
  project,
  viewportKey,
  fadeMs = 2000,
  onPanTo,
  world,
  toLayer,
}: AgentCanvasLayerProps) {
  const state = useAgentsState(controller)
  const layer = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = layer.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setView({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  const [tick, setTick] = useState(0)
  // Re-render once the fade window of the most recent edit passes.
  const latest = Math.max(0, ...state.chips.map((c) => c.lastActivityAt))
  useEffect(() => {
    const left = latest + fadeMs - Date.now()
    if (left <= 0) return
    const t = setTimeout(() => setTick((n) => n + 1), left + 20)
    return () => clearTimeout(t)
  }, [latest, fadeMs])
  void tick
  void viewportKey
  const dry = state.dryRun && !state.dryRunHidden ? state.dryRun : null
  return (
    <div ref={layer} className="agents-canvas-layer" data-testid="agent-canvas-layer">
      {state.chips.map((chip, i) => (
        <Attribution
          key={chip.connectionId}
          chip={chip}
          project={project}
          fadeMs={fadeMs}
          view={view}
          stack={
            state.chips
              .slice(0, i)
              .filter((c) => c.focus[0] !== undefined && c.focus[0] === chip.focus[0]).length
          }
          reservedTop={dry || state.dryRun ? 52 : 0}
          {...(onPanTo ? { onPanTo } : {})}
          {...(world && toLayer ? { world, toLayer } : {})}
        />
      ))}
      {dry?.ghosts.map((g) => {
        const box = project(g.id)
        return box ? (
          <Ghost key={`${g.kind}-${g.id}`} kind={g.kind} name={g.name} box={box} />
        ) : null
      })}
      {state.dryRun && <DryRunBar controller={controller} />}
    </div>
  )
}

function Attribution({
  chip,
  project,
  fadeMs,
  view,
  stack,
  reservedTop,
  onPanTo,
  world,
  toLayer,
}: {
  chip: AgentChipView
  project: AgentCanvasLayerProps["project"]
  fadeMs: number
  view: { w: number; h: number }
  stack: number
  reservedTop: number
  onPanTo?: (id: string) => void
  world?: AgentCanvasLayerProps["world"]
  toLayer?: AgentCanvasLayerProps["toLayer"]
}) {
  const area = world ? unionBox(chip.focus.slice(0, 50).map((f) => world(f))) : null
  const glide = useWorldGlide(area ? { x: area.x, y: area.y } : null)
  const writing = chip.state === "editing" || Date.now() - chip.lastActivityAt < fadeMs
  if (chip.presence === "paused") return null
  // The work area: the union of the focus layers' boxes.
  const boxes = chip.focus.slice(0, 50).flatMap((f) => {
    const b = project(f)
    return b ? [{ id: f, b }] : []
  })
  const first = boxes[0]
  if (!first) return null
  const id = first.id
  const u = unionBox(boxes.map((x) => x.b))
  if (!u) return null
  // A box that contains the whole area is the area (it keeps its corner radius).
  const box: ProjectedBox =
    boxes.find(
      (x) =>
        x.b.x <= u.x + 0.5 &&
        x.b.y <= u.y + 0.5 &&
        x.b.x + x.b.w >= u.x + u.w - 0.5 &&
        x.b.y + x.b.h >= u.y + u.h - 0.5,
    )?.b ?? u
  // Cursor anchor: the glided world point of the area's top-left, projected now.
  const at = glide && toLayer ? toLayer(glide) : { x: box.x, y: box.y }
  const anchor: ProjectedBox = { ...box, x: at.x, y: at.y }
  const idle = Date.now() - chip.lastActivityAt > CURSOR_IDLE_MS && chip.state !== "editing"
  const place = view.w > 0 ? placeCursor(anchor, view, { stack, reservedTop }) : null
  const markState = chip.state === "editing" ? "working" : "idle"
  return (
    <div
      className={`agents-attribution${writing ? "" : " agents-attribution--faded"}`}
      data-origin={chip.origin}
    >
      {/* Agent Outline (LMWYr): 1.5 agent, the node's radius */}
      <div
        className="agents-attribution__outline"
        data-testid="agent-outline"
        style={{
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          borderRadius: box.radius ?? 0,
        }}
      />
      {/* Agent Attribution tag (GSUtG): 18 tall, 3 px above the outline; mark → AgentMark 12 */}
      <div
        className="agents-attribution__tag"
        data-testid="agent-tag"
        style={{ left: box.x, top: box.y - 21 }}
      >
        <AgentMark size={12} state={markState} />
        {/* Board 31 "Canvas label": the agent's name only. */}
        <span className="agents-attribution__tag-label">{chip.label}</span>
      </div>
      {/* Agent Cursor (IJH2i; board 24 g placement): anchor = node top-left + (4, 4) */}
      {!idle && place?.kind === "docked" && (
        <button
          type="button"
          className="agents-cursor-docked"
          data-testid="agent-cursor-docked"
          style={{ left: place.x, top: place.y }}
          onClick={() => onPanTo?.(id)}
        >
          <AgentMark size={12} state={markState} />
          <span className="agents-cursor-docked__label">{chip.label}</span>
          <AgentIcon name={place.arrow ?? "arrow-right"} size={12} />
        </button>
      )}
      {!idle && chip.state === "editing" && place?.kind !== "docked" && (
        <div
          className="agents-cursor"
          data-testid="agent-cursor"
          data-flip-x={place?.flipX || undefined}
          data-flip-y={place?.flipY || undefined}
          style={{ left: place?.x ?? anchor.x + 4, top: place?.y ?? anchor.y + 4 }}
        >
          <AgentIcon name="mouse-pointer-2" size={18} className="agents-cursor__pointer" />
          <div className="agents-cursor__pill">
            <AgentMark size={12} state="working" />
            <span className="agents-cursor__label">{chip.label}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * World-space glide of the cursor anchor between work areas (CURSOR_GLIDE_MS, ease-out): the
 * returned point is in world space and the caller projects it with the current viewport, so the
 * cursor never trails a pan or zoom. Reduced motion jumps.
 */
function useWorldGlide(target: { x: number; y: number } | null): { x: number; y: number } | null {
  const g = useRef<{
    from: { x: number; y: number }
    to: { x: number; y: number }
    at: number
  } | null>(null)
  const [, setFrame] = useState(0)
  const now = performance.now()
  if (target) {
    const cur = g.current
    if (!cur) g.current = { from: target, to: target, at: now - CURSOR_GLIDE_MS }
    else if (Math.abs(cur.to.x - target.x) > 0.5 || Math.abs(cur.to.y - target.y) > 0.5) {
      const reduced =
        typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
      g.current = { from: reduced ? target : pointAt(cur, now), to: target, at: now }
    }
  }
  const cur = g.current
  const gliding = !!cur && now - cur.at < CURSOR_GLIDE_MS
  useEffect(() => {
    if (!gliding) return
    const raf = requestAnimationFrame(() => setFrame((n) => n + 1))
    return () => cancelAnimationFrame(raf)
  })
  return target && cur ? pointAt(cur, now) : null
}

function pointAt(
  g: { from: { x: number; y: number }; to: { x: number; y: number }; at: number },
  t: number,
): { x: number; y: number } {
  const k = glideEase((t - g.at) / CURSOR_GLIDE_MS)
  return { x: g.from.x + (g.to.x - g.from.x) * k, y: g.from.y + (g.to.y - g.from.y) * k }
}

const OP_LABEL: Record<GhostKind, string> = { delete: "delete", insert: "insert", update: "update" }

/** One dry-run ghost: Label Row (name + op chip) 6 px above a Box over the node. */
function Ghost({ kind, name, box }: { kind: GhostKind; name: string; box: ProjectedBox }) {
  return (
    <div
      className={`agents-ghost agents-ghost--${kind}`}
      data-testid="agent-ghost"
      data-kind={kind}
      style={{ left: box.x, top: box.y - 22 }}
    >
      <div className="agents-ghost__label-row">
        <span className="agents-ghost__name">{name}</span>
        <span className="agents-ghost__chip">
          <span className="agents-ghost__op">{OP_LABEL[kind]}</span>
        </span>
      </div>
      <div
        className="agents-ghost__box"
        style={{ width: box.w, height: box.h, borderRadius: box.radius ?? 4 }}
      />
    </div>
  )
}

/**
 * Dry-run bar (board 24 › 5 · (g) joR0E › jMSYI): pinned top-centre of the canvas; row, h 32, gap
 * 8, padding [0, 4], center, bg-overlay, 1 px border, pill, shadow 0 4 12 › AgentMark 12 ·
 * Label "Dry run · 7 ops" sans 12 / 500 · Meta "nothing applied" sans 11 text-tertiary · Discard
 * (Button/Ghost h 24, padding [0, 8], 11) · Apply (Button/Primary h 24, padding [0, 10], 11).
 * Apply = ⌘↩, Discard = Esc. It replaces the presence chip while active.
 */
export function DryRunBar({ controller }: { controller: AgentsControllerExt }) {
  const state = useAgentsState(controller)
  const dry = state.dryRun
  const approval = dry?.source === "approval" ? state.queue[0] : undefined
  // Discard = Esc. With an approval behind the dry run, the approval prompt already answers Esc
  // (Deny) and the presence layer ⌘↩ (Apply); a dry-run call only needs Esc to dismiss.
  useEffect(() => {
    if (!dry || approval) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest("input, textarea, [contenteditable=true], [role=dialog]")) return
      if (e.key === "Escape") {
        e.preventDefault()
        controller.setDryRunHidden(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [dry, approval, controller])
  if (!dry || state.dryRunHidden) return null
  const { delete: del, insert, update } = dry.counts
  const ops = del + insert + update
  return (
    <div className="agents-dry-bar" role="status" data-testid="agent-dry-run-bar">
      <AgentMark size={12} state="working" />
      <span className="agents-dry-bar__title">
        Dry run · {ops} {ops === 1 ? "op" : "ops"}
      </span>
      <span className="agents-dry-bar__meta">nothing applied</span>
      <CompactButton
        variant="ghost"
        height={24}
        padX={8}
        text="xs"
        onClick={() =>
          approval ? void controller.answer(approval.id, "deny") : controller.setDryRunHidden(true)
        }
      >
        Discard
      </CompactButton>
      {approval && (
        <CompactButton
          variant="primary"
          height={24}
          padX={10}
          text="xs"
          onClick={() => void controller.answer(approval.id, "once")}
        >
          Apply
        </CompactButton>
      )}
    </div>
  )
}
