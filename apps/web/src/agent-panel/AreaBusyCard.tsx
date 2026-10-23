/**
 * Board 41 › 7 C "AREA_BUSY in the thread" (desing.pen `WfdMv`) and how it resolves (`gRvEC`).
 *
 * AreaBusyCard: column, fill, bg-subtle, radius-lg, 1 px border, gap 8, padding [10, 12] ›
 * Head (row, gap 8, center: the claimer's AgentMark 12 · Title sans 12 / 600 text-primary
 * "Waiting: Sol is editing Hero") · Desc (sans 11 / 1.45 text-secondary) · Actions (row, gap 6,
 * center: Work elsewhere Button/Secondary 26 [0, 10] · Wait Button/Ghost 26 [0, 10] · spacer ·
 * "AREA_BUSY" mono 11 text-tertiary). Wait turns into Stop waiting while the agent waits.
 *
 * Resolved lines (`veTuB`, `n1VCvQ`): row, gap 8, center › icon 14 · label sans 12 / 500
 * text-primary: "Work elsewhere · working on Features instead" (arrow-right text-secondary),
 * "Hero is free · continuing" (circle-check success).
 */
import { CompactButton } from "@kimo/ui"
import { useCallback, useSyncExternalStore } from "react"
import { CanvasAgentMark } from "../canvas/agent-mark"
import { Icon } from "../lib/icons"
import { type AreaWaits, areaBusyCopy } from "../multiplayer/area-busy"
import { personaOfHolder } from "../multiplayer/canvas-model"
import "./area-busy.css"

/** What the card needs from the editor (absent: no card, the step stays a failed step). */
export interface AreaBusyEnv {
  waits: AreaWaits
  /** A layer's name ("Hero"). */
  nodeName(id: string): string | undefined
  /** The person running another person's agent ("Maya"), null for local agents. */
  ownerOf(holder: string): string | null
  /** The agent that asked ("Kimo"). */
  agentLabel?: string
  /** The frame the asking agent works on now, outside the busy area (the Work elsewhere line). */
  workingOn?(origin: string, busy: readonly string[]): string | undefined
  now?(): number
}

export function AreaBusyCard({ env, callId }: { env: AreaBusyEnv; callId: string }) {
  const { waits } = env
  const subscribe = useCallback((l: () => void) => waits.subscribe(l), [waits])
  const version = () => waits.getVersion()
  useSyncExternalStore(subscribe, version, version)
  const busy = waits.busy(callId)
  if (!busy) return null
  const { detail, origin } = busy
  const frameId = detail.ids[0] ?? detail.touched[0]
  const frame = (frameId && env.nodeName(frameId)) || "this area"
  const holderLabel = detail.holderLabel ?? "Another agent"
  const res = waits.resolution(callId, detail)
  if (res.kind === "free")
    return (
      <div className="area-busy-line" data-testid="area-busy-line" data-kind="free">
        <span className="area-busy-line__icon area-busy-line__icon--success">
          <Icon name="circle-check" size={14} />
        </span>
        <span className="area-busy-line__label">{frame} is free · continuing</span>
      </div>
    )
  if (res.kind === "elsewhere") {
    const next = env.workingOn?.(origin, detail.ids)
    return (
      <div className="area-busy-line" data-testid="area-busy-line" data-kind="elsewhere">
        <span className="area-busy-line__icon">
          <Icon name="arrow-right" size={14} />
        </span>
        <span className="area-busy-line__label">
          {next ? `Work elsewhere · working on ${next} instead` : "Work elsewhere"}
        </span>
      </div>
    )
  }
  const copy = areaBusyCopy({
    holderLabel,
    owner: env.ownerOf(detail.holder),
    frame,
    agent: env.agentLabel ?? "Kimo",
    since: detail.since,
    now: env.now?.() ?? Date.now(),
  })
  const waiting = res.kind === "waiting"
  return (
    <div
      className="area-busy-card"
      data-testid="area-busy-card"
      data-pen="WfdMv"
      data-waiting={waiting ? "" : undefined}
    >
      <div className="area-busy-card__head">
        <CanvasAgentMark state="idle" persona={personaOfHolder(detail.holder)} size={12} />
        <span className="area-busy-card__title">{copy.title}</span>
      </div>
      <span className="area-busy-card__desc">{copy.desc}</span>
      <div className="area-busy-card__actions">
        <CompactButton
          variant="secondary"
          height={26}
          padX={10}
          className="area-busy-card__button"
          data-testid="area-busy-elsewhere"
          onClick={() => waits.workElsewhere(callId)}
        >
          Work elsewhere
        </CompactButton>
        <CompactButton
          variant="ghost"
          height={26}
          padX={10}
          className="area-busy-card__button"
          data-testid="area-busy-wait"
          onClick={() => (waiting ? waits.stopWaiting(callId) : waits.wait(callId, origin, detail))}
        >
          {waiting ? "Stop waiting" : "Wait"}
        </CompactButton>
        <span className="area-busy-card__spacer" />
        <span className="area-busy-card__code">AREA_BUSY</span>
      </div>
    </div>
  )
}

/** The status line of a turn waiting for an area ("Waiting for Hero"), else null. */
export function useAreaWaitStatus(env: AreaBusyEnv | undefined, callIds: readonly string[]) {
  const waits = env?.waits
  const subscribe = useCallback((l: () => void) => (waits ? waits.subscribe(l) : () => {}), [waits])
  const version = () => waits?.getVersion() ?? 0
  useSyncExternalStore(subscribe, version, version)
  if (!env || !waits) return null
  for (const id of [...callIds].reverse()) {
    const b = waits.busy(id)
    if (!b || waits.resolution(id, b.detail).kind !== "waiting") continue
    const frameId = b.detail.ids[0] ?? b.detail.touched[0]
    return `Waiting for ${(frameId && env.nodeName(frameId)) || "this area"}`
  }
  return null
}
