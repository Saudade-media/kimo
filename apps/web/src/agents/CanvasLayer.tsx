/**
 * Canvas-side agent surfaces of MCP clients (board 21, under board 36 "Agent on canvas"
 * XDVdg): per client one cursor (pointer + name pill) on the center of the section it works in
 * and a 1 px outline on that section, one ring per landed edit on the section, dry-run ghosts
 * and the Dry Run Bar (L2eaCu / P1Ulp, rule "Dry run"). A DOM layer stacked over the canvas
 * (pointer-events: none except the bar); the caller projects node ids to layer coordinates.
 * The built-in agent's own CLI connection draws nothing here: its cursor is the agent panel's.
 */
import { AgentMark, CompactButton } from "@kimo/ui"
import { useEffect, useRef, useState } from "react"
import {
  AgentSectionLayer,
  cursorFlip,
  type SectionCursorView,
  type SectionFlashView,
} from "../canvas/AgentSectionCursor"
import {
  CURSOR_GLIDE_MS,
  centerOf,
  type Glide,
  glideAt,
  pickSection,
  retarget,
  SECTION_FLASH_MS,
} from "../canvas/agent-area"
import type { AgentChipView, AgentsControllerExt } from "./controller"
import { useAgentsState } from "./hooks"
import { builtInCliSession, type GhostKind } from "./model"

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
  /** Cursor and outline stay this long after the client's last write (board 36: 2 s). */
  fadeMs?: number
  /** A node's parent (board 36 section rule). Absent: the first focus layer is the section. */
  parentOf?: (id: string) => string | null
  /**
   * World box of a node and world → layer projection: the cursor glides between sections in
   * world space (board 31 "Position lock": a pan mid-glide moves it with the canvas). Without
   * them the cursor jumps.
   */
  world?: (id: string) => ProjectedBox | null
  toLayer?: (p: { x: number; y: number }) => { x: number; y: number }
}

/**
 * Whether a chip is the built-in agent's own connection (board 36 › dedupe): an in-app agent
 * (`agent:kimo.<session>.<n>` through the document host) or a CLI engine's MCP relay from its
 * session workspace. The agent panel's cursor stands for it, so this layer draws nothing.
 */
export const isBuiltInConnection = (chip: AgentChipView): boolean =>
  chip.origin.startsWith("agent:") || builtInCliSession(chip.connection.cwd) !== null

export function AgentCanvasLayer({
  controller,
  project,
  viewportKey,
  fadeMs = 2000,
  parentOf,
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
  const now = Date.now()
  // Re-render once the fade window of the most recent edit (or flash) passes.
  const latest = Math.max(0, ...state.chips.map((c) => c.lastActivityAt))
  useEffect(() => {
    const left = latest + Math.max(fadeMs, SECTION_FLASH_MS) - Date.now()
    if (left <= 0) return
    const t = setTimeout(() => setTick((n) => n + 1), left + 20)
    return () => clearTimeout(t)
  }, [latest, fadeMs])
  void tick
  void viewportKey
  const chips = state.chips.filter(
    (c) =>
      c.presence !== "paused" &&
      !isBuiltInConnection(c) &&
      (c.state === "editing" || now - c.lastActivityAt < fadeMs),
  )
  // Board 36 › Section: the pointed layer's section when it lies in the work area, else the
  // first focus layer's.
  const sectionOf = (chip: AgentChipView): string | null =>
    parentOf
      ? pickSection(chip.focus.slice(0, 50), chip.pointer, parentOf, (id) => !!project(id))
      : (chip.focus.find((id) => !!project(id)) ?? null)
  const sections = new Map(chips.map((c) => [c.connectionId, sectionOf(c)]))
  const targets = new Map<string, { x: number; y: number }>()
  for (const c of chips) {
    const s = sections.get(c.connectionId)
    const w = s && world ? world(s) : null
    if (w) targets.set(c.connectionId, centerOf(w))
  }
  const glides = useWorldGlides(targets)
  const perSection = new Map<string, number>()
  const cursors: SectionCursorView[] = []
  const flashes: SectionFlashView[] = []
  for (const c of chips) {
    const s = sections.get(c.connectionId)
    const box = s ? project(s) : null
    if (!s || !box) continue
    const stack = perSection.get(s) ?? 0
    perSection.set(s, stack + 1)
    const g = glides.get(c.connectionId)
    const tip = g && toLayer ? toLayer(g) : { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    cursors.push({
      origin: c.origin,
      kind: "mcp",
      persona: "agent",
      // Board 36 › Label: the client's name ("Claude Code", "Codex").
      label: c.label,
      state: c.state === "editing" ? "working" : "idle",
      section: box,
      sectionId: s,
      tip,
      stack,
      ...cursorFlip(tip, view),
    })
    // Board 36 › Section flash: the client's latest op group, once, on its section.
    const last = c.session.groups[c.session.groups.length - 1]
    if (last && now - last.time < SECTION_FLASH_MS)
      flashes.push({
        key: `${c.origin}:${c.session.groups.length}:${last.time}`,
        persona: "agent",
        box,
      })
  }
  const dry = state.dryRun && !state.dryRunHidden ? state.dryRun : null
  return (
    <div ref={layer} className="agents-canvas-layer" data-testid="agent-canvas-layer">
      <AgentSectionLayer cursors={cursors} flashes={flashes} />
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

/**
 * World-space glides of the cursors (CURSOR_GLIDE_MS, ease-in-out cubic): the returned points
 * are in world space and the caller projects them with the current viewport, so a cursor never
 * trails a pan or zoom. Reduced motion jumps.
 */
function useWorldGlides(
  targets: ReadonlyMap<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
  const g = useRef(new Map<string, Glide>())
  const [, setFrame] = useState(0)
  const now = performance.now()
  const reduced =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  for (const [k, to] of targets) g.current.set(k, retarget(g.current.get(k), to, now, reduced))
  for (const k of [...g.current.keys()]) if (!targets.has(k)) g.current.delete(k)
  const gliding = [...g.current.values()].some((x) => now - x.at < CURSOR_GLIDE_MS)
  useEffect(() => {
    if (!gliding) return
    const raf = requestAnimationFrame(() => setFrame((n) => n + 1))
    return () => cancelAnimationFrame(raf)
  })
  return new Map([...g.current].map(([k, x]) => [k, glideAt(x, now)]))
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
