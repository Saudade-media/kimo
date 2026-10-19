/**
 * Board 41 section 6 B (ZccsX): the people list, from the avatar stack. 300 wide; "In this file ·
 * N"; owner first, then join order; "you" is a Badge; role on the right; Follow (eye) on every
 * other person, pressed while following (viewport tracks theirs; pan, zoom or Esc stops); idle
 * people show "idle" and a 0.5 avatar. Agents follow under a divider, each with its owner
 * ("Kimo · Gui's agent") and what it is editing in its persona hue.
 */
import { AgentMark, Badge, IconButton, Popover, type PopoverAnchor, personaVar } from "@kimo/ui"
import type { CSSProperties } from "react"
import { Icon } from "../../lib/icons"
import { useAgents, useCollaborators, useFollow } from "../hooks"
import type { MultiplayerModel } from "../model"
import { agentLabel, agentMeta, agentPersona, personRole } from "./copy"
import { PresenceAvatar } from "./shared"
import "./share-ui.css"

export interface PeoplePopoverProps {
  model: MultiplayerModel
  docKey: string
  anchor: PopoverAnchor | null
  onClose(): void
  nodeName?: (id: string) => string | null
  onRevealNodes?: (ids: readonly string[]) => void
}

export function PeoplePopover({
  model,
  docKey,
  anchor,
  onClose,
  nodeName = () => null,
  onRevealNodes,
}: PeoplePopoverProps) {
  const people = useCollaborators(model, docKey)
  const agents = useAgents(model, docKey)
  const follow = useFollow(model, docKey)
  const doc = model.document(docKey)
  const title = `In this file · ${people.length}`
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
      {...(anchor ? { anchor, placement: { side: "bottom", align: "end", offset: 4 } } : {})}
      onClose={onClose}
    >
      <div className="mp-people__body">
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
        {agents.length > 0 && (
          <>
            <hr className="mp-divider" />
            <div className="mp-agents-head">Agents · {agents.length}</div>
            {agents.map((a, i) => {
              const persona = agentPersona(a, i)
              const meta = agentMeta(a, nodeName)
              return (
                <div key={a.holder} className="mp-person mp-person--agent" data-persona={persona}>
                  <span className="mp-mark-wrap">
                    <AgentMark size={12} persona={persona} state={meta ? "working" : "idle"} />
                  </span>
                  <div className="mp-text mp-text--1">
                    <span className="mp-label-strong">{agentLabel(a)}</span>
                    {meta && (
                      <span
                        className="mp-agent-meta"
                        style={{ "--mp-color": personaVar(persona) } as CSSProperties}
                      >
                        {meta}
                      </span>
                    )}
                  </div>
                  <IconButton
                    className="mp-follow"
                    label={`Show what ${a.label} is editing`}
                    icon={<Icon name="eye" size={14} />}
                    size="sm"
                    tone="ghost"
                    disabled={a.editing.length === 0 || !onRevealNodes}
                    onClick={() => onRevealNodes?.(a.editing)}
                  />
                </div>
              )
            })}
          </>
        )}
      </div>
    </Popover>
  )
}
