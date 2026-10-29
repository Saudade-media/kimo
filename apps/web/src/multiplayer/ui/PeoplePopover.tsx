/**
 * Board 48 §2 "Popover · Everyone" (board 41 ZccsX with agents first): 300 wide, "In this file ·
 * N" (agents and people). Agents · N first, like the stack: AgentMark 12 in a 24 wrap, the name
 * and its status in its persona hue; clicking one of this window's agents opens its changes.
 * Then a divider and People · N: owner first, then join order; "you" is a Badge; role on the
 * right; Follow (eye) on every other person, pressed while following (viewport tracks theirs;
 * pan, zoom or Esc stops); idle people show "idle" and a 0.5 avatar. The list scrolls past 8 rows
 * under the header. Opens below the stack, on its left edge, shifted to stay in the window.
 */
import { AgentMark, Badge, IconButton, Popover, type PopoverAnchor, personaVar } from "@kimo/ui"
import { type CSSProperties, useEffect, useRef } from "react"
import { Icon } from "../../lib/icons"
import { useCollaborators, useFollow } from "../hooks"
import type { MultiplayerModel } from "../model"
import { personRole } from "./copy"
import type { StackAgent } from "./PresenceStack"
import { PresenceAvatar } from "./shared"
import "./share-ui.css"

export interface PeoplePopoverProps {
  model: MultiplayerModel
  docKey: string
  /** Every agent in the file, in the stack's order. */
  agents: readonly StackAgent[]
  anchor: PopoverAnchor | null
  onClose(): void
}

export function PeoplePopover({ model, docKey, agents, anchor, onClose }: PeoplePopoverProps) {
  const people = useCollaborators(model, docKey)
  const follow = useFollow(model, docKey)
  const doc = model.document(docKey)
  const title = `In this file · ${agents.length + people.length}`
  return (
    <Popover
      className="mp-people"
      label={title}
      headerLeading={<span className="kimo-popover__title">{title}</span>}
      actions={
        <IconButton
          className="mp-close"
          label="Close"
          icon={<Icon name="x" size={14} />}
          size="sm"
          tone="ghost"
          onClick={onClose}
        />
      }
      {...(anchor ? { anchor, placement: { side: "bottom", align: "start", offset: 4 } } : {})}
      onClose={onClose}
    >
      <div className="mp-people__body">
        {agents.length > 0 && (
          <>
            <div className="mp-people__head">Agents · {agents.length}</div>
            {agents.map((a) => (
              <AgentRow key={a.key} agent={a} onClose={onClose} />
            ))}
            {people.length > 0 && (
              <>
                <hr className="mp-divider" />
                <div className="mp-people__head">People · {people.length}</div>
              </>
            )}
          </>
        )}
        {people.map((p) => {
          const following = follow?.peer === p.peer
          return (
            <div
              key={p.id}
              className={`mp-person${p.idle ? " mp-person--idle" : ""}`}
              data-you={p.isYou || undefined}
              data-following={following || undefined}
            >
              <PresenceAvatar label={p.label} color={p.color} />
              <div className="mp-person__name">
                <span className="mp-label-strong">{p.label}</span>
                {p.isYou && <Badge>you</Badge>}
                {!p.isYou && p.idle && <span className="mp-meta">idle</span>}
              </div>
              <span className="mp-meta">{personRole(p)}</span>
              {p.isYou ? (
                <span className="mp-person__slot" aria-hidden="true" />
              ) : (
                <IconButton
                  className="mp-follow"
                  label={following ? `Stop following ${p.label}` : `Follow ${p.label}`}
                  icon={<Icon name="eye" size={14} />}
                  size="sm"
                  tone="ghost"
                  active={following}
                  onClick={() => doc.follow(following ? null : p.peer)}
                />
              )}
            </div>
          )
        })}
      </div>
    </Popover>
  )
}

/**
 * An agent row (tW5ly): Mark Wrap 24 › AgentMark 12, Text (Label, Meta in the persona hue),
 * Follow (eye). This window's agents open their changes from the mark and text; hovering the row
 * outlines the layers they work on.
 */
function AgentRow({ agent: a, onClose }: { agent: StackAgent; onClose(): void }) {
  const hovered = useRef(false)
  // The agent's latest callback (rows re-render with new ones while hovered).
  const onHover = useRef(a.onHover)
  onHover.current = a.onHover
  const hover = (on: boolean) => {
    if (hovered.current === on) return
    hovered.current = on
    onHover.current?.(on)
  }
  // A row that goes away under the pointer (the popover closed) clears its outline.
  useEffect(
    () => () => {
      if (hovered.current) onHover.current?.(false)
    },
    [],
  )
  const content = (
    <>
      <span className="mp-mark-wrap">
        <AgentMark size={12} persona={a.persona} state={a.state} />
      </span>
      <span className="mp-text mp-text--1">
        <span className="mp-label-strong">{a.label}</span>
        {a.meta && (
          <span
            className="mp-agent-meta"
            style={{ "--mp-color": personaVar(a.persona) } as CSSProperties}
          >
            {a.meta}
          </span>
        )}
      </span>
    </>
  )
  const open = a.onOpen
  return (
    <div
      className="mp-person mp-person--agent"
      data-persona={a.persona}
      data-origin={a.key}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
    >
      {open ? (
        <button
          type="button"
          className="mp-agent-open"
          aria-label={`${a.label}: show changes`}
          onClick={() => {
            hover(false)
            onClose()
            open()
          }}
        >
          {content}
        </button>
      ) : (
        content
      )}
      <IconButton
        className="mp-follow"
        label={`Show what ${a.label} is editing`}
        icon={<Icon name="eye" size={14} />}
        size="sm"
        tone="ghost"
        disabled={!a.onReveal}
        onClick={() => a.onReveal?.()}
      />
    </div>
  )
}
