/**
 * Board 21 › Editor · external agent editing (DPrpd): the presence chip in the topbar drag region
 * (AxgvU / nYai1 / L2eaCu), the session popover under it (hIfmx) and the approval prompt (weJXw).
 * Mount `<AgentPresence>` in the topbar's drag region, right-aligned before Save status.
 */
import {
  AgentOpRow,
  AgentOrb,
  AgentPresenceChip,
  Button,
  IconButton,
  useAnchoredPosition,
  useDismiss,
} from "@kimo/ui"
import { useEffect, useRef, useState } from "react"
import { ApprovalPrompt } from "./ApprovalPrompt"
import type { AgentChipView, AgentsControllerExt } from "./controller"
import { useAgentsState } from "./hooks"
import { AgentIcon } from "./icons"
import { canLabel, changesLabel, formatRevision, nowCopy, transportLabel } from "./model"

export interface AgentPresenceProps {
  controller: AgentsControllerExt
  /** "Show on canvas": select + zoom to the session's nodes. */
  onShowOnCanvas?: (nodeIds: string[]) => void
  /** Client settings (Settings › Agents & MCP, that client expanded). */
  onOpenClientSettings?: (client: string) => void
}

/**
 * One chip per active client; 2+ clients collapse to stacked orbs + "N agents editing" (rule
 * "Presence chip"). Click → session popover. The approval prompt opens under the chip by itself.
 */
export function AgentPresence({
  controller,
  onShowOnCanvas,
  onOpenClientSettings,
}: AgentPresenceProps) {
  const state = useAgentsState(controller)
  const [open, setOpen] = useState(false)
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  const chips = state.chips
  useEffect(() => {
    if (chips.length === 0) setOpen(false)
  }, [chips.length])

  if (chips.length === 0)
    return state.prompt ? <ApprovalPrompt controller={controller} anchor={null} /> : null
  const waiting = chips.filter((c) => c.presence === "waiting")
  const paused = chips.filter((c) => c.presence === "paused")
  const many = chips.length > 1
  const ops = chips.reduce((n, c) => n + c.session.rows.length, 0)
  const lead = waiting[0] ?? paused[0] ?? (chips[0] as AgentChipView)
  const chipState =
    waiting.length > 0 ? "waiting" : !many && paused.length > 0 ? "paused" : "editing"
  const label = many
    ? waiting.length > 0
      ? `${waiting.length === 1 ? (waiting[0] as AgentChipView).label : `${waiting.length} agents`} need${waiting.length === 1 ? "s" : ""} approval`
      : `${chips.length} agents editing`
    : lead.text
  const meta = many
    ? waiting.length > 0
      ? String(waiting.reduce((n, c) => n + c.pending, 0))
      : ops > 0
        ? `${ops} ${ops === 1 ? "op" : "ops"}`
        : undefined
    : lead.meta
  return (
    <span className="agents-presence" data-testid="agent-presence">
      <AgentPresenceChip
        ref={setAnchorEl}
        state={chipState}
        label={label}
        meta={meta}
        orbs={chips.length}
        open={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && anchorEl && !state.prompt && (
        <SessionPopover
          controller={controller}
          chips={chips}
          anchor={anchorEl}
          onClose={() => setOpen(false)}
          onShowOnCanvas={onShowOnCanvas}
          onOpenClientSettings={onOpenClientSettings}
        />
      )}
      {state.prompt && <ApprovalPrompt controller={controller} anchor={anchorEl} />}
    </span>
  )
}

export interface SessionPopoverProps {
  controller: AgentsControllerExt
  chips: AgentChipView[]
  /** Positioned under this element (fixed); omitted: in flow (gallery, harness). */
  anchor?: HTMLElement | null
  onClose?: () => void
  onShowOnCanvas?: (nodeIds: string[]) => void
  onOpenClientSettings?: (client: string) => void
}

/** The session popover (hIfmx); one section per client when 2+ are active (not designed). */
export function SessionPopover({
  controller,
  chips,
  anchor,
  onClose,
  onShowOnCanvas,
  onOpenClientSettings,
}: SessionPopoverProps) {
  const root = useRef<HTMLDivElement>(null)
  const pos = useAnchoredPosition(root, anchor ?? undefined, {
    side: "bottom",
    align: "end",
    offset: 16,
  })
  useDismiss(root, onClose, anchor ?? undefined, !!onClose)
  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Agent session"
      className="agents-session"
      data-testid="agent-session-popover"
      style={
        pos
          ? {
              position: "fixed",
              left: pos.x,
              top: pos.y,
              visibility: pos.ready ? "visible" : "hidden",
            }
          : undefined
      }
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation()
          onClose?.()
        }
      }}
    >
      {chips.map((chip) => (
        <SessionSection
          key={chip.connectionId}
          controller={controller}
          chip={chip}
          onShowOnCanvas={onShowOnCanvas}
          onOpenClientSettings={onOpenClientSettings}
        />
      ))}
    </div>
  )
}

function SessionSection({
  controller,
  chip,
  onShowOnCanvas,
  onOpenClientSettings,
}: {
  controller: AgentsControllerExt
  chip: AgentChipView
  onShowOnCanvas?: (nodeIds: string[]) => void
  onOpenClientSettings?: (client: string) => void
}) {
  const c = chip.connection
  const s = chip.session
  const now = nowCopy(c)
  const userPaused = chip.paused?.code === "USER"
  const topGroup = s.groups.length - 1
  const version = [c.identity.version, transportLabel(c, controller.state.server)]
    .filter(Boolean)
    .join(" · ")
  const nodeIds = [...new Set(s.rows.map((r) => r.nodeId).filter((id): id is string => !!id))]
  return (
    <section className="agents-session__section" data-origin={chip.origin}>
      {/* Header (eLfuF) */}
      <div className="agents-session__header">
        <AgentOrb size={28} />
        <div className="agents-session__text">
          <div className="agents-session__name-row">
            <span className="agents-session__name">{chip.label}</span>
            <span className="agents-session__version">{version}</span>
          </div>
          <span className="agents-session__scope">{canLabel(chip.policy, c.cwd)}</span>
        </div>
        <IconButton
          size="sm"
          tone="ghost"
          className="agents-icon-button"
          label={userPaused ? `Resume ${chip.label}` : `Pause ${chip.label}`}
          icon={<AgentIcon name={userPaused ? "play" : "pause"} size={14} />}
          onClick={() =>
            void (userPaused ? controller.resume(chip.client) : controller.pause(chip.client))
          }
        />
        <IconButton
          size="sm"
          tone="ghost"
          className="agents-icon-button"
          label={`${chip.label} settings`}
          icon={<AgentIcon name="settings-2" size={14} />}
          onClick={() => onOpenClientSettings?.(chip.client)}
        />
      </div>
      {/* Now (esKwa): while a call runs */}
      {now && (
        <div className="agents-session__now" data-testid="agent-session-now">
          <AgentIcon name="loader-circle" size={14} className="agents-session__spinner" />
          <span className="agents-session__now-label">{now.label}</span>
          <span className="agents-spacer" />
          <span className="agents-session__now-tool">{now.tool}</span>
        </div>
      )}
      {/* List Header (l7Meg6) */}
      <div className="agents-session__list-header">
        <AgentIcon name="git-compare" size={14} className="agents-session__list-icon" />
        <span className="agents-session__list-label">{changesLabel(s)}</span>
        <span className="agents-spacer" />
        {nodeIds.length > 0 && (
          <button
            type="button"
            className="agents-link agents-link--sm"
            onClick={() => onShowOnCanvas?.(nodeIds)}
          >
            Show on canvas
          </button>
        )}
      </div>
      {/* Ops (fM9DY) */}
      <div className="agents-session__ops">
        {s.rows.map((r, i) => (
          <AgentOpRow
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond order.
            key={i}
            op={r.op}
            target={r.target}
            detail={r.detail}
            tone={r.tone}
            revertLabel={`Revert ${r.op} ${r.target}`}
            onRevert={r.group === topGroup ? () => void controller.undoTop(chip.origin) : undefined}
          />
        ))}
      </div>
      {/* Actions (Z9p0c) */}
      <div className="agents-session__actions">
        <span className="agents-session__revision">
          {s.before && s.after ? `${formatRevision(s.before)} → ${formatRevision(s.after)}` : ""}
        </span>
        <span className="agents-spacer" />
        <Button
          size="sm"
          variant="secondary"
          className="agents-button"
          icon={<AgentIcon name="undo-2" size={14} />}
          disabled={s.groups.length === 0}
          onClick={() => void controller.undoAll(chip.origin)}
        >
          Undo all
        </Button>
        <Button
          size="sm"
          variant="primary"
          className="agents-button"
          icon={<AgentIcon name="check" size={14} />}
          disabled={s.groups.length === 0}
          onClick={() => controller.keep(chip.origin)}
        >
          Keep
        </Button>
      </div>
    </section>
  )
}
