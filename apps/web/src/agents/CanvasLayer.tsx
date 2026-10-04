/**
 * Canvas-side agent surfaces (board 21): attribution outline + tag and the agent cursor (AxgvU,
 * rule "Canvas attribution"), dry-run ghosts and the Dry Run Bar (L2eaCu / P1Ulp, rule "Dry
 * run"). A DOM layer stacked over the canvas (pointer-events: none except the bar); the caller
 * projects node ids to layer coordinates.
 */
import { AgentOrb, Button } from "@kimo/ui"
import { useEffect, useState } from "react"
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
}

export function AgentCanvasLayer({
  controller,
  project,
  viewportKey,
  fadeMs = 2000,
}: AgentCanvasLayerProps) {
  const state = useAgentsState(controller)
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
    <div className="agents-canvas-layer" data-testid="agent-canvas-layer">
      {state.chips.map((chip) => (
        <Attribution
          key={chip.connectionId}
          chip={chip}
          project={project}
          fadeMs={fadeMs}
          store={controller.store}
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
  store,
}: {
  chip: AgentChipView
  project: AgentCanvasLayerProps["project"]
  fadeMs: number
  store: AgentsControllerExt["store"]
}) {
  const writing = chip.state === "editing" || Date.now() - chip.lastActivityAt < fadeMs
  if (chip.presence === "paused") return null
  const id = chip.focus.find((f) => project(f) !== null)
  if (!id) return null
  const box = project(id)
  if (!box) return null
  const name = (store?.getNode(id) as { name?: string } | undefined)?.name ?? id
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
      {/* Agent Attribution tag (GSUtG): 18 tall, 3 px above the outline */}
      <div
        className="agents-attribution__tag"
        data-testid="agent-tag"
        style={{ left: box.x, top: box.y - 21 }}
      >
        <AgentOrb size={12} ring={1} />
        <span className="agents-attribution__tag-label">
          {chip.label} · {name}
        </span>
      </div>
      {/* Agent Cursor (IJH2i): board 04 cursor with the client orb */}
      {chip.state === "editing" && (
        <div
          className="agents-cursor"
          data-testid="agent-cursor"
          style={{ left: box.x + Math.round(box.w * 0.62), top: box.y + Math.round(box.h * 0.85) }}
        >
          <AgentIcon name="mouse-pointer-2" size={18} className="agents-cursor__pointer" />
          <div className="agents-cursor__pill">
            <AgentOrb size={14} ring={1} />
            <span className="agents-cursor__label">
              {chip.label} · editing {name}…
            </span>
          </div>
        </div>
      )}
    </div>
  )
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

/** Dry Run Bar (P1Ulp): "Dry run · nothing applied", counts, Hide / Show preview. */
export function DryRunBar({ controller }: { controller: AgentsControllerExt }) {
  const state = useAgentsState(controller)
  const dry = state.dryRun
  if (!dry) return null
  const { delete: del, insert, update } = dry.counts
  return (
    <div className="agents-dry-bar" role="status" data-testid="agent-dry-run-bar">
      <AgentIcon name="eye" size={16} className="agents-dry-bar__icon" />
      <span className="agents-dry-bar__title">Dry run · nothing applied</span>
      {del > 0 && (
        <span className="agents-count agents-count--delete">
          <span className="agents-count__label">−{del} delete</span>
        </span>
      )}
      {insert > 0 && (
        <span className="agents-count agents-count--insert">
          <span className="agents-count__label">+{insert} insert</span>
        </span>
      )}
      {update > 0 && (
        <span className="agents-count agents-count--update">
          <span className="agents-count__label">~{update} update</span>
        </span>
      )}
      <Button
        variant="ghost"
        className="agents-button agents-button--ghost-primary agents-dry-bar__toggle"
        icon={<AgentIcon name={state.dryRunHidden ? "eye" : "eye-off"} size={14} />}
        onClick={() => controller.setDryRunHidden(!state.dryRunHidden)}
      >
        {state.dryRunHidden ? "Show preview" : "Hide preview"}
      </Button>
    </div>
  )
}
