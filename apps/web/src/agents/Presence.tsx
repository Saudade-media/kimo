/**
 * Board 21 › Editor · external agent editing (DPrpd): the presence chip in the topbar drag region
 * (AxgvU / nYai1 / L2eaCu), the session popover under it (hIfmx) and the approval prompt (weJXw).
 * Mount `<AgentPresence>` in the topbar's drag region, right-aligned before Save status.
 */
import {
  AgentMark,
  type AgentMarkState,
  AgentOpRow,
  AgentPresenceChip,
  assignPersonas,
  Button,
  CompactButton,
  IconButton,
  type Persona,
  useAnchoredPosition,
  useDismiss,
} from "@kimo/ui"
import { ShieldCheck } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
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
  /** "Agents & MCP…" in the 2+ agents popover. */
  onOpenAgentsSettings?: () => void
  /** "Pricing page.kimo" for the 2+ agents popover title ("Session · <file>"). */
  fileName?: string
}

/** AgentMark state of a chip (board 24 mapping eqlcN; presence chip rule BXTD5). */
export function chipMarkState(c: AgentChipView): AgentMarkState {
  if (c.presence === "waiting") return "listening"
  if (c.presence === "paused") return "paused"
  switch (c.state) {
    case "editing":
      return "working"
    case "reading":
    case "rendering":
      return "thinking"
    default:
      return "idle"
  }
}

const PRESENCE_ORDER = { waiting: 0, editing: 1, paused: 2 } as const

/** Sorted waiting → working → idle (board 24 yeF1Z rule), lead first among equals. */
export function sortChips(chips: readonly AgentChipView[]): AgentChipView[] {
  const rank = (c: AgentChipView) =>
    PRESENCE_ORDER[c.presence] * 2 + (chipMarkState(c) === "working" ? 0 : 1)
  return [...chips].sort((a, b) => rank(a) - rank(b))
}

/**
 * Persona per chip (board 24 PqjaS): the first agent attached is the lead (Teal); external CLIs
 * stay Teal outside Split mode; agents spawned inside a session (`agent:` origins) take the next
 * hue in order Iris → Moss.
 */
export function chipPersonas(chips: readonly AgentChipView[]): Map<string, Persona> {
  const slots = assignPersonas(
    chips.map((c, i) => ({
      id: c.origin,
      lead: i === 0,
      external: c.origin.startsWith("mcp:"),
    })),
  )
  return new Map(chips.map((c, i) => [c.origin, slots[i]?.persona ?? "teal"]))
}

/**
 * The presence chip: the lead agent's mark + label, "+N" when 2+ agents are active (board 24
 * yeF1Z), a neutral approval-queue badge while approvals wait (I7jut). Click → the session
 * popover (one agent: hIfmx; 2+: the agents list N4cx0) or, with a queue, the queue popover
 * (XCENV). The approval prompt still opens under the chip by itself.
 */
export function AgentPresence({
  controller,
  onShowOnCanvas,
  onOpenClientSettings,
  onOpenAgentsSettings,
  fileName,
}: AgentPresenceProps) {
  const state = useAgentsState(controller)
  const [open, setOpen] = useState(false)
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  const chips = state.chips
  useEffect(() => {
    if (chips.length === 0) setOpen(false)
  }, [chips.length])
  // ⌘↩ approves the oldest queued request (rule e).
  useEffect(() => {
    const first = state.queue[0]
    if (!first) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void controller.answer(first.id, "once")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [state.queue, controller])

  if (chips.length === 0)
    return state.prompt ? <ApprovalPrompt controller={controller} anchor={null} /> : null
  const sorted = sortChips(chips)
  const personas = chipPersonas(chips)
  const lead = sorted[0] as AgentChipView
  const queue = state.queue.length
  const many = chips.length > 1
  const chipState = queue > 0 ? "waiting" : lead.presence
  const label = queue > 0 && !many ? `${lead.label} is waiting` : lead.text
  const meta = many ? `+${chips.length - 1}` : lead.meta
  const autoClients = sorted.filter(
    (c, i, all) =>
      c.origin.startsWith("mcp:") &&
      c.policy.autoApprove === true &&
      c.policy.onExceed === "ask" &&
      all.findIndex((x) => x.client === c.client) === i,
  )
  // The dry-run bar replaces the presence chip while active (board 24 g) — for an agent's dry-run
  // call. A dry run that previews an approval keeps the chip: the approval prompt hangs from it
  // (board 21 weJXw) and the bar's Apply / Discard answer the same request.
  if (state.dryRun && state.dryRun.source === "call" && !state.dryRunHidden && !open) return null
  return (
    <span className="agents-presence" data-testid="agent-presence">
      <AgentPresenceChip
        ref={setAnchorEl}
        state={chipState}
        label={label}
        {...(queue > 0 ? { queue } : meta !== undefined ? { meta } : {})}
        markState={queue > 0 ? "listening" : chipMarkState(lead)}
        persona={personas.get(lead.origin) ?? "teal"}
        open={open}
        onClick={() => setOpen((o) => !o)}
      />
      {autoClients.length > 0 && (
        // Board 34 Auto-approve Pill (XYAmZ): a connected client approves its own requests.
        <button
          type="button"
          className="agents-auto-pill"
          data-testid="agent-auto-approve-pill"
          data-pen="XYAmZ"
          title={`${autoClients.map((c) => c.label).join(", ")}: every request is approved without asking. Change it in Settings › Agents & MCP.`}
          onClick={() => onOpenClientSettings?.((autoClients[0] as AgentChipView).client)}
        >
          <ShieldCheck className="agents-auto-pill__icon" aria-hidden="true" />
          <span className="agents-auto-pill__label">Auto-approve</span>
        </button>
      )}
      {open && anchorEl && queue > 0 && (
        <QueuePopover controller={controller} anchor={anchorEl} onClose={() => setOpen(false)} />
      )}
      {open && anchorEl && queue === 0 && many && (
        <AgentsPopover
          controller={controller}
          chips={sorted}
          personas={personas}
          {...(fileName ? { fileName } : {})}
          anchor={anchorEl}
          onClose={() => setOpen(false)}
          onOpenAgentsSettings={onOpenAgentsSettings}
        />
      )}
      {open && anchorEl && queue === 0 && !many && !state.prompt && (
        <SessionPopover
          controller={controller}
          chips={chips}
          anchor={anchorEl}
          onClose={() => setOpen(false)}
          onShowOnCanvas={onShowOnCanvas}
          onOpenClientSettings={onOpenClientSettings}
        />
      )}
      {state.prompt && !open && <ApprovalPrompt controller={controller} anchor={anchorEl} />}
    </span>
  )
}

/** Popover frame shared by (d) and (e): 340 / 320 wide, Header h 40 + Close. */
function AgentsPopoverFrame({
  title,
  icon,
  width,
  anchor,
  onClose,
  testId,
  children,
}: {
  title: string
  icon: string
  width: number
  anchor: HTMLElement
  onClose(): void
  testId: string
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const pos = useAnchoredPosition(root, anchor, { side: "bottom", align: "end", offset: 8 })
  useDismiss(root, onClose, anchor, true)
  return (
    <div
      ref={root}
      role="dialog"
      aria-label={title}
      className="agents-pop"
      data-testid={testId}
      style={{
        width,
        ...(pos
          ? {
              position: "fixed",
              left: pos.x,
              top: pos.y,
              visibility: pos.ready ? "visible" : "hidden",
            }
          : {}),
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="agents-pop__header">
        <span className="agents-pop__leading">
          <AgentIcon name={icon} size={14} className="agents-pop__icon" />
          <span className="agents-pop__title">{title}</span>
        </span>
        <IconButton
          size="sm"
          tone="quiet"
          className="agents-icon-button agents-pop__close"
          label="Close"
          icon={<AgentIcon name="x" size={14} />}
          onClick={onClose}
        />
      </div>
      {children}
    </div>
  )
}

/**
 * Board 24 (d) yeF1Z › Popover · Session N4cx0 (340): Header "Session · <file>" (users icon) ›
 * Body rows (OGJkT): row gap 10, padding [8, 12], center › AgentMark 24 (live state + persona) ·
 * Text column gap 2 (Name sans 12 / 500 · Meta sans 11 text-tertiary) · Review (Button/Secondary
 * h 24) when waiting / Pause (Button/Ghost h 24) when working › Footer (PwFn6) gap 6, padding
 * [8, 12, 4, 12], top stroke: Agents & MCP… · Spacer · Stop all (≥ 2 active, danger label).
 */
export function AgentsPopover({
  controller,
  chips,
  personas,
  anchor,
  onClose,
  onOpenAgentsSettings,
  fileName,
}: {
  controller: AgentsControllerExt
  chips: AgentChipView[]
  personas: Map<string, Persona>
  fileName?: string
  anchor: HTMLElement
  onClose(): void
  onOpenAgentsSettings?: () => void
}) {
  const file = fileName ?? ""
  const active = chips.filter((c) => chipMarkState(c) !== "idle" || c.presence === "waiting")
  return (
    <AgentsPopoverFrame
      title={file ? `Session · ${file}` : "Session"}
      icon="users"
      width={340}
      anchor={anchor}
      onClose={onClose}
      testId="agents-session-list"
    >
      <div className="agents-pop__body">
        {chips.map((c) => {
          const mark = chipMarkState(c)
          const ops = c.session.rows.length
          const opsLabel = `${ops} ${ops === 1 ? "op" : "ops"}`
          const focus = c.focus[0]
          const focusName = focus
            ? ((controller.store?.getNode(focus) as { name?: string } | undefined)?.name ?? "")
            : ""
          const meta =
            c.presence === "waiting"
              ? `waiting for approval · ${opsLabel}`
              : c.presence === "paused"
                ? "paused"
                : mark === "working"
                  ? `editing${focusName ? ` ${focusName}` : ""} · ${opsLabel}`
                  : mark === "thinking"
                    ? `reading · ${opsLabel}`
                    : "idle"
          return (
            <div key={c.connectionId} className="agents-pop__agent" data-origin={c.origin}>
              <AgentMark size={24} state={mark} persona={personas.get(c.origin) ?? "teal"} />
              <span className="agents-pop__text">
                <span className="agents-pop__name">{c.label}</span>
                <span className="agents-pop__meta">{meta}</span>
              </span>
              {c.presence === "waiting" ? (
                <CompactButton
                  variant="secondary"
                  height={24}
                  padX={8}
                  text="xs"
                  onClick={() => {
                    onClose()
                    controller.refresh()
                  }}
                >
                  Review
                </CompactButton>
              ) : mark === "working" ? (
                <CompactButton
                  variant="ghost"
                  height={24}
                  padX={8}
                  text="xs"
                  onClick={() => void controller.pause(c.client)}
                >
                  Pause
                </CompactButton>
              ) : c.presence === "paused" ? (
                <CompactButton
                  variant="ghost"
                  height={24}
                  padX={8}
                  text="xs"
                  onClick={() => void controller.resume(c.client)}
                >
                  Resume
                </CompactButton>
              ) : null}
            </div>
          )
        })}
        <div className="agents-pop__footer">
          <CompactButton
            variant="ghost"
            height={24}
            padX={6}
            text="xs"
            icon={<AgentIcon name="settings" size={14} />}
            onClick={() => {
              onClose()
              onOpenAgentsSettings?.()
            }}
          >
            Agents &amp; MCP…
          </CompactButton>
          <span className="agents-spacer" />
          {active.length >= 2 && (
            <CompactButton
              variant="ghost"
              height={24}
              padX={6}
              text="xs"
              danger
              icon={<AgentIcon name="square" size={14} />}
              onClick={() => {
                for (const c of active) void controller.disconnect(c.connectionId)
                onClose()
              }}
            >
              Stop all
            </CompactButton>
          )}
        </div>
      </div>
    </AgentsPopoverFrame>
  )
}

/**
 * Board 24 (e) I7jut › Popover · Waiting for approval (XCENV, 320): Header (hand) › one request
 * per row (mywhw): row gap 8, padding [8, 12], center, bottom stroke › Text column gap 2 (Title
 * sans 12 / 500 · Detail sans 11 text-tertiary) · Deny (ghost h 24) · Approve (primary h 24).
 * Oldest first; ⌘↩ approves the top item.
 */
export function QueuePopover({
  controller,
  anchor,
  onClose,
}: {
  controller: AgentsControllerExt
  anchor: HTMLElement
  onClose(): void
}) {
  const state = useAgentsState(controller)
  const names = (ids: readonly string[]) =>
    ids
      .slice(0, 3)
      .map((id) => (controller.store?.getNode(id) as { name?: string } | undefined)?.name ?? id)
      .join(", ")
  useEffect(() => {
    if (state.queue.length === 0) onClose()
  }, [state.queue.length, onClose])
  return (
    <AgentsPopoverFrame
      title={`Waiting for approval · ${state.queue.length}`}
      icon="hand"
      width={320}
      anchor={anchor}
      onClose={onClose}
      testId="agents-queue-popover"
    >
      <div className="agents-pop__body">
        {state.queue.map((r) => (
          <div key={r.id} className="agents-pop__request" data-request={r.id}>
            <span className="agents-pop__text">
              <span className="agents-pop__name">{r.summary}</span>
              <span className="agents-pop__meta">
                {r.preview?.nodeIds?.length
                  ? names(r.preview.nodeIds)
                  : `${r.client.label} · ${r.tool}`}
              </span>
            </span>
            <CompactButton
              variant="ghost"
              height={24}
              padX={8}
              text="xs"
              onClick={() => void controller.answer(r.id, "deny")}
            >
              Deny
            </CompactButton>
            <CompactButton
              variant="primary"
              height={24}
              padX={8}
              text="xs"
              onClick={() => void controller.answer(r.id, "once")}
            >
              Approve
            </CompactButton>
          </div>
        ))}
      </div>
    </AgentsPopoverFrame>
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
  // Hosted windows list the agent's logged edits (one row per edit): the last one is the top.
  const hosted = s.groups.length === 0 && s.entries.length > 0
  const topGroup = hosted ? s.entries.length - 1 : s.groups.length - 1
  const undoable = s.groups.length > 0 || s.entries.length > 0
  const version = [c.identity.version, transportLabel(c, controller.state.server)]
    .filter(Boolean)
    .join(" · ")
  const nodeIds = [...new Set(s.rows.map((r) => r.nodeId).filter((id): id is string => !!id))]
  return (
    <section className="agents-session__section" data-origin={chip.origin}>
      {/* Header (eLfuF) */}
      <div className="agents-session__header">
        <AgentMark size={28} state={chipMarkState(chip)} />
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
          disabled={!undoable}
          onClick={() => void controller.undoAll(chip.origin)}
        >
          Undo all
        </Button>
        <Button
          size="sm"
          variant="primary"
          className="agents-button"
          icon={<AgentIcon name="check" size={14} />}
          disabled={!undoable}
          onClick={() => controller.keep(chip.origin)}
        >
          Keep
        </Button>
      </div>
    </section>
  )
}
