/**
 * Board 48 "Right card · people and agents": this window's agents in the right card's avatar
 * stack (§1, drawn by `multiplayer/ui/PresenceStack`), the changes popover that opens from an
 * agent (§3, board 21 Session Popover hIfmx), the approval queue (board 24 XCENV) and the
 * approval prompt (board 21 weJXw), both anchored to the agent's avatar. Mount
 * `<AgentStack>` around the stack: it hands the agents over and draws what hangs from them.
 */
import {
  AgentMark,
  type AgentMarkState,
  AgentOpRow,
  assignPersonas,
  Button,
  CompactButton,
  floating,
  IconButton,
  type Persona,
  useAnchoredPosition,
  useDismiss,
} from "@kimo/ui"
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ApprovalPrompt } from "./ApprovalPrompt"
import type { AgentChipView, AgentsControllerExt } from "./controller"
import { useAgentsState } from "./hooks"
import { AgentIcon } from "./icons"
import { canLabel, changesLabel, nowCopy } from "./model"

/** One agent of this window in the stack and in the people popover (`StackAgent`). */
export interface AgentStackEntry {
  /** The agent origin, `mcp:<client>.<session>`. */
  key: string
  label: string
  state: AgentMarkState
  persona: Persona
  /** Its avatar's Tooltip: "Claude Code is editing Hero". */
  status: string
  /** Its popover row: "Editing Hero · 3 changes". */
  meta: string
  avatarRef(el: HTMLElement | null): void
  /** Its changes popover (the approval queue while requests wait). */
  onOpen(): void
  onReveal?: () => void
  onHover(on: boolean): void
}

export interface AgentStackSlot {
  /** Waiting first, then working, then idle (board 24 yeF1Z). */
  agents: readonly AgentStackEntry[]
  /** The people popover opened or closed: the approval prompt waits while it is open. */
  onPeopleOpenChange(open: boolean): void
}

export interface AgentStackProps {
  /** Null: no agents (browser library files, no MCP host). */
  controller: AgentsControllerExt | null
  /** "Show on canvas" and an agent row's eye: select + zoom to its layers. */
  onShowOnCanvas?: (nodeIds: string[]) => void
  /** Client settings (Settings › Agents & MCP, that client expanded). */
  onOpenClientSettings?: (client: string) => void
  /** Draws the stack (and Share) with the agents. */
  children(slot: AgentStackSlot): ReactNode
}

const NO_STACK: AgentStackSlot = { agents: [], onPeopleOpenChange: () => {} }

/** AgentMark state of a chip (board 24 mapping eqlcN): waiting = listening. */
function chipMarkState(c: AgentChipView): AgentMarkState {
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
function sortChips(chips: readonly AgentChipView[]): AgentChipView[] {
  const rank = (c: AgentChipView) =>
    PRESENCE_ORDER[c.presence] * 2 + (chipMarkState(c) === "working" ? 0 : 1)
  return [...chips].sort((a, b) => rank(a) - rank(b))
}

/**
 * Persona per chip (board 24 PqjaS): the first agent attached is the lead (Teal); external CLIs
 * stay Teal outside Split mode; agents spawned inside a session (`agent:` origins) take the next
 * hue in order Iris → Moss.
 */
function chipPersonas(chips: readonly AgentChipView[]): Map<string, Persona> {
  const slots = assignPersonas(
    chips.map((c, i) => ({
      id: c.origin,
      lead: i === 0,
      external: c.origin.startsWith("mcp:"),
    })),
  )
  return new Map(chips.map((c, i) => [c.origin, slots[i]?.persona ?? "teal"]))
}

export function AgentStack(props: AgentStackProps) {
  if (!props.controller) return <>{props.children(NO_STACK)}</>
  return <LiveAgentStack {...props} controller={props.controller} />
}

/**
 * The agents in the stack: waiting first, each with its live mark. Clicking one in the people
 * popover opens its changes (§3) or, while requests wait, the approval queue. The approval prompt
 * hangs from the waiting agent's avatar; ⌘↩ approves the oldest request. An agent's dry-run call
 * shows the dry-run bar instead of its avatar (board 24 g).
 */
function LiveAgentStack({
  controller,
  onShowOnCanvas,
  onOpenClientSettings,
  children,
}: AgentStackProps & { controller: AgentsControllerExt }) {
  const state = useAgentsState(controller)
  /** The agent whose changes (or the queue) are open. */
  const [open, setOpen] = useState<string | null>(null)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const avatars = useAvatarRegistry()
  const chips = state.chips
  useEffect(() => {
    if (open !== null && !chips.some((c) => c.origin === open)) setOpen(null)
  }, [chips, open])
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

  const personas = chipPersonas(chips)
  // The dry-run bar stands in for the agent of a dry-run call while it shows (board 24 g). A dry
  // run that previews an approval keeps the avatar: the approval prompt hangs from it.
  const dry =
    state.dryRun && state.dryRun.source === "call" && !state.dryRunHidden
      ? state.dryRun.origin
      : null
  const shown = sortChips(chips).filter((c) => c.origin !== dry || c.origin === open)
  const agents: AgentStackEntry[] = shown.map((c) => ({
    key: c.origin,
    label: c.label,
    state: chipMarkState(c),
    persona: personas.get(c.origin) ?? "teal",
    status: c.text,
    meta: c.meta,
    avatarRef: avatars.ref(c.origin),
    onOpen: () => setOpen(c.origin),
    ...(c.focus.length > 0 && onShowOnCanvas ? { onReveal: () => onShowOnCanvas(c.focus) } : {}),
    onHover: (on) => controller.setHighlight(on && c.focus.length > 0 ? c.focus : null),
  }))
  // An agent past the three avatars (in "+N") hangs its popovers from the first one.
  const anchorOf = (origin: string | null): HTMLElement | null =>
    (origin ? avatars.get(origin) : undefined) ??
    shown.map((c) => avatars.get(c.origin)).find((el) => el !== undefined) ??
    null
  const openChip = open === null ? undefined : chips.find((c) => c.origin === open)
  const anchor = openChip ? anchorOf(openChip.origin) : null
  const request = state.prompt?.request
  const close = () => setOpen(null)
  return (
    <>
      {children({ agents, onPeopleOpenChange: setPeopleOpen })}
      {openChip && anchor && state.queue.length > 0 && (
        <QueuePopover controller={controller} anchor={anchor} onClose={close} />
      )}
      {openChip && anchor && state.queue.length === 0 && (
        <ChangesPopover
          controller={controller}
          chip={openChip}
          anchor={anchor}
          onClose={close}
          onShowOnCanvas={onShowOnCanvas}
          onOpenClientSettings={onOpenClientSettings}
        />
      )}
      {request && !(openChip && anchor) && !peopleOpen && (
        <ApprovalPrompt
          controller={controller}
          anchor={anchorOf(`mcp:${request.client.client}.${request.client.session}`)}
        />
      )}
    </>
  )
}

/**
 * Avatar elements by agent origin, with one stable ref callback per origin (a new callback every
 * render would detach and attach the avatar on each commit).
 */
function useAvatarRegistry() {
  const [els, setEls] = useState<ReadonlyMap<string, HTMLElement>>(() => new Map())
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>())
  return {
    get: (origin: string) => els.get(origin),
    ref(origin: string) {
      let ref = refs.current.get(origin)
      if (!ref) {
        ref = (el) =>
          setEls((prev) => {
            if (el ? prev.get(origin) === el : !prev.has(origin)) return prev
            const next = new Map(prev)
            if (el) next.set(origin, el)
            else next.delete(origin)
            return next
          })
        refs.current.set(origin, ref)
      }
      return ref
    },
  }
}

/** Popover frame of (e): 320 wide, Header h 40 + Close. */
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
  // Like the people popover it replaces: under the stack, on the avatar's left edge.
  const pos = useAnchoredPosition(root, anchor, { side: "bottom", align: "start", offset: 4 })
  useDismiss(root, onClose, undefined, true)
  return floating(
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
    </div>,
    anchor,
  )
}

/**
 * Board 24 (e) I7jut › Popover · Waiting for approval (XCENV, 320): Header (hand) › one request
 * per row (mywhw): row gap 8, padding [8, 12], center, bottom stroke › Text column gap 2 (Title
 * sans 12 / 500 · Detail sans 11 text-tertiary) · Deny (ghost h 24) · Approve (primary h 24).
 * Oldest first; ⌘↩ approves the top item.
 */
function QueuePopover({
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

/** Board 48 §3: 12 from each window edge, so the popover is at most the window height minus 24. */
const FIT_MARGIN = 12
/** Under the stack like the people popover it replaces. */
const FIT_OFFSET = 4
/** Side gutter (the popovers' default viewport padding). */
const FIT_GUTTER = 8

interface FitPosition {
  x: number
  y: number
  maxHeight: number
  side: "bottom" | "top"
  ready: boolean
}

/**
 * Board 48 §3 rule "Fits the window, and flips above when there's no room below": below the
 * anchor on its left edge (shifted to stay in the window), above it when the popover does not fit
 * below and there is more room above, and never taller than the room on that side. `list` is the
 * part that scrolls: its hidden overflow counts toward the height the popover wants.
 */
function useFitPosition(
  root: RefObject<HTMLElement | null>,
  list: RefObject<HTMLElement | null>,
  anchor: HTMLElement,
): FitPosition {
  const [pos, setPos] = useState<FitPosition>({
    x: 0,
    y: 0,
    maxHeight: 0,
    side: "bottom",
    ready: false,
  })
  useLayoutEffect(() => {
    const update = () => {
      const el = root.current
      if (!el) return
      const a = anchor.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      const scroll = list.current
      const wants = box.height + (scroll ? scroll.scrollHeight - scroll.clientHeight : 0)
      const vw = window.innerWidth
      const vh = window.innerHeight
      const below = vh - FIT_MARGIN - (a.bottom + FIT_OFFSET)
      const above = a.top - FIT_OFFSET - FIT_MARGIN
      const side = wants <= below || below >= above ? "bottom" : "top"
      const room = side === "bottom" ? below : above
      const maxHeight = Math.max(0, Math.min(vh - 2 * FIT_MARGIN, room))
      const height = Math.min(wants, maxHeight)
      const y = side === "bottom" ? a.bottom + FIT_OFFSET : a.top - FIT_OFFSET - height
      const x = Math.max(FIT_GUTTER, Math.min(a.left, vw - FIT_GUTTER - box.width))
      setPos((p) =>
        p.ready && p.x === x && p.y === y && p.maxHeight === maxHeight && p.side === side
          ? p
          : { x, y, maxHeight, side, ready: true },
      )
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : undefined
    if (root.current) ro?.observe(root.current)
    // Rows added under a capped popover change only the list's scroll height.
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(update) : undefined
    if (list.current) mo?.observe(list.current, { childList: true, subtree: true })
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
      ro?.disconnect()
      mo?.disconnect()
    }
  }, [anchor, root, list])
  return pos
}

interface ChangesPopoverProps {
  controller: AgentsControllerExt
  chip: AgentChipView
  anchor: HTMLElement
  onClose(): void
  onShowOnCanvas?: (nodeIds: string[]) => void
  onOpenClientSettings?: (client: string) => void
}

/**
 * Board 48 §3 Changes Popover (AjVX67YAR9, 380): Header (AgentMark 28, Name, Scope "Can edit this
 * file", Pause, Settings) › Now (the running call's label) › List Header ("6 changes to 4 layers",
 * Show on canvas) › Ops (scrolls) › Actions (Undo all, Keep; pinned at the bottom, top stroke).
 */
function ChangesPopover({
  controller,
  chip,
  anchor,
  onClose,
  onShowOnCanvas,
  onOpenClientSettings,
}: ChangesPopoverProps) {
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const pos = useFitPosition(root, list, anchor)
  useDismiss(root, onClose, undefined, true)
  const c = chip.connection
  const s = chip.session
  const now = nowCopy(c)
  const userPaused = chip.paused?.code === "USER"
  // Hosted windows list the agent's logged edits (one row per edit): the last one is the top.
  const hosted = s.groups.length === 0 && s.entries.length > 0
  const topGroup = hosted ? s.entries.length - 1 : s.groups.length - 1
  const undoable = s.groups.length > 0 || s.entries.length > 0
  const nodeIds = [...new Set(s.rows.map((r) => r.nodeId).filter((id): id is string => !!id))]
  return floating(
    <div
      ref={root}
      role="dialog"
      aria-label={`${chip.label} changes`}
      className="agents-session"
      data-testid="agent-session-popover"
      data-origin={chip.origin}
      data-side={pos.side}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        ...(pos.ready ? { maxHeight: pos.maxHeight } : {}),
        visibility: pos.ready ? "visible" : "hidden",
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      {/* Header (HywGC2kJSP) */}
      <div className="agents-session__header">
        <AgentMark size={28} state={chipMarkState(chip)} />
        <div className="agents-session__text">
          <div className="agents-session__name-row">
            <span className="agents-session__name">{chip.label}</span>
          </div>
          <span className="agents-session__scope">{canLabel(chip.policy)}</span>
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
      {/* Now (xq6PYm2V1w): while a call runs */}
      {now && (
        <div className="agents-session__now" data-testid="agent-session-now">
          <AgentIcon name="loader-circle" size={14} className="agents-session__spinner" />
          <span className="agents-session__now-label">{now.label}</span>
        </div>
      )}
      {/* List Header (GFYNEUyh4X) */}
      <div className="agents-session__list-header">
        <AgentIcon name="git-compare" size={14} className="agents-session__list-icon" />
        <span className="agents-session__list-label">{changesLabel(s)}</span>
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
      {/* Ops (wxfmQxBUJ5): scrolls between the header and Actions */}
      <div ref={list} className="agents-session__ops">
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
      {/* Actions (XxNDbDO8jZ): pinned at the bottom */}
      <div className="agents-session__actions">
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
    </div>,
    anchor,
  )
}
