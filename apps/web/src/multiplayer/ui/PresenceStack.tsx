/**
 * Board 48 §1, §2 and §4: the right card's avatar stack (Presence: row, gap -6, center) and the
 * people popover it opens. Everyone in the file is in it: agents first (a waiting one leads), with
 * their live AgentMark 24 and a Tooltip with what they do, then people, you first. At most three
 * avatars, then a "+N" disc. Alone (no agent, nobody else), there is no stack.
 *
 * The agents of this window (MCP clients) come from `agents/` as {@link StackAgent}s; other
 * people's agents come from the room. Opening an agent's changes, the approval prompt and the
 * queue stay in `agents/`: they anchor to the avatar `avatarRef` registers.
 */
import {
  AgentMark,
  type AgentMarkState,
  floating,
  type Persona,
  TooltipContent,
  useAnchoredPosition,
} from "@kimo/ui"
import { useCallback, useEffect, useRef, useState } from "react"
import { useAgents, useCollaborators, useShareState } from "../hooks"
import type { AgentView, MultiplayerModel, PersonView } from "../model"
import { agentLabel, agentMeta, agentPersona, stackDimmed, stackOf } from "./copy"
import { PeoplePopover } from "./PeoplePopover"
import { PresenceAvatar } from "./shared"

/** One agent in the stack and in the popover's Agents section. */
export interface StackAgent {
  /** Stable key: the agent origin (`mcp:<client>.<session>`, `agent:<id>`). */
  key: string
  /** "Claude Code", "Kimo · Maya's agent". */
  label: string
  state: AgentMarkState
  persona: Persona
  /** Its avatar's Tooltip: "Claude Code is editing Hero". */
  status: string
  /** Under its name in the popover: "Editing Hero · 3 changes" (null: nothing). */
  meta: string | null
  /** Registers its avatar (the changes popover and the approval prompt anchor to it). */
  avatarRef?: (el: HTMLElement | null) => void
  /** Row click: its changes (or the approval queue). Omitted: the row only shows. */
  onOpen?: () => void
  /** Eye: shows the layers it works on (omitted: disabled). */
  onReveal?: () => void
  /** Row hover: outlines its layers on the canvas (false on leave). */
  onHover?: (on: boolean) => void
  /** Another person's agent: stale with the people while the relay is gone. */
  remote?: boolean
}

export interface PresenceStackProps {
  model: MultiplayerModel
  docKey: string
  /** This window's agents, waiting first. */
  agents?: readonly StackAgent[]
  /** Layer names for the room agents' "Editing Hero". */
  nodeName?: (id: string) => string | null
  /** A room agent's eye: shows the layers it claims. */
  onRevealNodes?: (ids: readonly string[]) => void
  /** The people popover opened or closed. */
  onOpenChange?: (open: boolean) => void
}

const NO_AGENTS: readonly StackAgent[] = []

/** Other people's agents (and agents with their own link) from the room, as stack agents. */
function roomAgents(
  agents: readonly AgentView[],
  local: readonly StackAgent[],
  nodeName: (id: string) => string | null,
  onRevealNodes?: (ids: readonly string[]) => void,
): StackAgent[] {
  const shown = new Set(local.map((a) => a.key))
  return agents.flatMap((a, i): StackAgent[] => {
    // This window's MCP agents claim areas under their origin: they are already in `local`.
    if (shown.has(a.holder)) return []
    const label = agentLabel(a)
    const meta = agentMeta(a, nodeName)
    const first = a.editing[0]
    const name = first === undefined ? null : (nodeName(first) ?? "a layer")
    return [
      {
        key: a.holder,
        label,
        state: a.editing.length > 0 ? "working" : "idle",
        persona: agentPersona(a, i),
        status: name ? `${label} is editing ${name}` : label,
        meta,
        ...(a.editing.length > 0 && onRevealNodes
          ? { onReveal: () => onRevealNodes(a.editing) }
          : {}),
        remote: !a.isYours,
      },
    ]
  })
}

type StackItem = { kind: "agent"; agent: StackAgent } | { kind: "person"; person: PersonView }

export function PresenceStack({
  model,
  docKey,
  agents: local = NO_AGENTS,
  nodeName = () => null,
  onRevealNodes,
  onOpenChange,
}: PresenceStackProps) {
  const share = useShareState(model, docKey)
  const people = useCollaborators(model, docKey)
  const inRoom = useAgents(model, docKey)
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const agents = [...local, ...roomAgents(inRoom, local, nodeName, onRevealNodes)]
  const others = people.filter((p) => !p.isYou)
  const show = agents.length > 0 || others.length > 0
  // You first, then everyone else in the people list's order (owner, then join order).
  const items: StackItem[] = [
    ...agents.map((agent) => ({ kind: "agent" as const, agent })),
    ...people.filter((p) => p.isYou).map((person) => ({ kind: "person" as const, person })),
    ...others.map((person) => ({ kind: "person" as const, person })),
  ]
  const { shown, more } = stackOf(items)
  const report = useRef(onOpenChange)
  report.current = onOpenChange
  useEffect(() => {
    report.current?.(open && show)
  }, [open, show])
  useEffect(() => () => report.current?.(false), [])
  useEffect(() => {
    if (!show) setOpen(false)
  }, [show])
  if (!show) return null
  const total = agents.length + people.length
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`mp-stack${stackDimmed(share.relay) ? " mp-stack--dim" : ""}`}
        aria-label={`${total} in this file`}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-pen="BiY5XvRIYI"
        onClick={() => setOpen((o) => !o)}
      >
        {shown.map((item) =>
          item.kind === "agent" ? (
            <StackAgentAvatar key={item.agent.key} agent={item.agent} />
          ) : (
            <PresenceAvatar
              key={item.person.id}
              label={item.person.label}
              color={item.person.color}
            />
          ),
        )}
        {more > 0 && (
          <span className="mp-stack__more" aria-hidden="true">
            +{more}
          </span>
        )}
      </button>
      {open && (
        <PeoplePopover
          model={model}
          docKey={docKey}
          agents={agents}
          anchor={button.current}
          onClose={() => {
            setOpen(false)
            button.current?.focus({ preventScroll: true })
          }}
        />
      )}
    </>
  )
}

/** Tooltip delay, as `Tooltip`'s. */
const TIP_DELAY_MS = 500

/**
 * An agent in the stack: its AgentMark 24 (live state, persona hue, no ring) and, on hover, a
 * Tooltip with what it does. The Tooltip floats in `document.body`: the stack clips its avatars
 * when the header runs out of room.
 */
function StackAgentAvatar({ agent }: { agent: StackAgent }) {
  const [el, setEl] = useState<HTMLSpanElement | null>(null)
  const [tip, setTip] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const { avatarRef } = agent
  const ref = useCallback(
    (node: HTMLSpanElement | null) => {
      setEl(node)
      avatarRef?.(node)
    },
    [avatarRef],
  )
  const hide = () => {
    clearTimeout(timer.current)
    setTip(false)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <span
      ref={ref}
      className={`mp-stack__agent${agent.remote ? " mp-stack__agent--remote" : ""}`}
      data-origin={agent.key}
      data-state={agent.state}
      onPointerEnter={() => {
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setTip(true), TIP_DELAY_MS)
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
    >
      <AgentMark size={24} state={agent.state} persona={agent.persona} />
      {tip && el && <StackAgentTip anchor={el} label={agent.status} />}
    </span>
  )
}

/** Tooltip (xbtkW, Key hidden) 6 below the avatar, centered on it. */
function StackAgentTip({ anchor, label }: { anchor: HTMLElement; label: string }) {
  const root = useRef<HTMLDivElement>(null)
  const pos = useAnchoredPosition(root, anchor, { side: "bottom", align: "center", offset: 6 })
  return floating(
    <TooltipContent
      ref={root}
      className="mp-stack__tip"
      data-testid="agent-status-tip"
      style={{
        position: "fixed",
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        visibility: pos?.ready ? "visible" : "hidden",
      }}
    >
      {label}
    </TooltipContent>,
    anchor,
  )
}
