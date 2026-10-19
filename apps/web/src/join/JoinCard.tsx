/**
 * The join cards (board 41 section 5): "Join Card" (ZDoa1) for joining and decrypting, and the
 * error cards (wCWyR, Muoq0, iCo0a, x0nKi, R89WL2). Presentational: `JoinRoute` feeds them.
 *
 * Join Card A: 360 wide, bg-app, radius-xl, 1px border, shadow 0 4 16, column, gap 16, padding
 * 24. Head (row, gap 10, centered): KimoLogo/Small + Text (title text-md 600, relay mono
 * text-xs tertiary, gap 2). Steps (column, gap 8): 14 px icon + label text-sm. Progress (column,
 * gap 6): Track 4 high bg-muted pill, Bar accent, Meta mono text-xs tertiary.
 *
 * Error cards: column, gap 14, padding 24, items centered: Icon Wrap 40 pill (bg-muted or
 * danger-soft) with an 18 px icon, Text (column, gap 6: Title text-md 600, Desc text-sm
 * secondary, both centered, line-height 1.45), optional mono Meta, Actions (row, gap 8).
 */
import { Button, KimoLogo } from "@kimo/ui"
import type { ReactNode } from "react"
import { Icon } from "../lib/icons"
import type { JoinState } from "../multiplayer/model"
import {
  JOINING_TITLE,
  type JoinActionId,
  type JoinErrorCard,
  joinSteps,
  progressMeta,
} from "./copy"
import "./join.css"

const ACTIONS: Record<JoinActionId, { icon: string; label: string; primary?: boolean }> = {
  "open-kimo": { icon: "house", label: "Open Kimo" },
  "copy-details": { icon: "copy", label: "Copy details" },
  "try-again": { icon: "refresh-cw", label: "Try again", primary: true },
  "paste-link": { icon: "clipboard", label: "Paste link" },
}

/** The full-window stage the card sits centered on (bg-canvas). */
export function JoinStage({ children }: { children: ReactNode }) {
  return (
    <main className="join-stage" data-testid="join-stage">
      {children}
    </main>
  )
}

export function JoinProgressCard({
  state,
  now,
  title = JOINING_TITLE,
}: {
  state: JoinState
  now: number
  title?: string
}) {
  const steps = joinSteps(state, now)
  const pct = state.progress === null ? null : Math.round(state.progress * 1000) / 10
  return (
    <section
      className="join-card"
      aria-live="polite"
      data-testid="join-card"
      data-phase={state.phase}
    >
      <div className="join-card__head">
        <KimoLogo size={16} variant="small" />
        <div className="join-card__text">
          <span className="join-card__title">{title}</span>
          {state.relayHost && <span className="join-card__meta">{state.relayHost}</span>}
        </div>
      </div>
      <div className="join-card__steps">
        {steps.map((s) => (
          <div key={s.id} className="join-card__step" data-status={s.status} data-step={s.id}>
            <span className="join-card__step-icon" aria-hidden="true">
              <Icon
                name={
                  s.status === "done"
                    ? "circle-check"
                    : s.status === "active"
                      ? "loader-circle"
                      : "circle"
                }
                size={14}
              />
            </span>
            <span className="join-card__step-label">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="join-card__progress">
        <div
          className="join-card__track"
          role="progressbar"
          aria-label="Decrypting the file"
          aria-valuemin={0}
          aria-valuemax={100}
          {...(pct === null ? {} : { "aria-valuenow": pct })}
        >
          <div
            className={`join-card__bar${pct === null ? " join-card__bar--indeterminate" : ""}`}
            style={pct === null ? undefined : { width: `${pct}%` }}
          />
        </div>
        <span className="join-card__meta">{progressMeta(state.progress)}</span>
      </div>
    </section>
  )
}

export function JoinErrorCardView({
  card,
  busy = false,
  copied = false,
  onAction,
}: {
  card: JoinErrorCard
  /** A retry is waiting out its back-off: Try again is disabled. */
  busy?: boolean
  /** Copy details just ran: the button says Copied for a moment. */
  copied?: boolean
  onAction(id: JoinActionId): void
}) {
  return (
    <section
      className="join-card join-card--error"
      role="alert"
      data-testid="join-card"
      data-kind={card.kind}
    >
      <div className={`join-card__wrap join-card__wrap--${card.tone}`}>
        <Icon name={card.icon} size={18} />
      </div>
      <div className="join-card__copy">
        <span className="join-card__heading">{card.title}</span>
        <span className="join-card__desc">{card.desc}</span>
      </div>
      {card.meta && <span className="join-card__meta join-card__meta--code">{card.meta}</span>}
      <div className="join-card__actions">
        {card.actions.map((id) => {
          const a = ACTIONS[id]
          const done = id === "copy-details" && copied
          return (
            <Button
              key={id}
              variant={a.primary ? "primary" : "ghost"}
              icon={<Icon name={done ? "check" : a.icon} size={16} />}
              data-action={id}
              disabled={busy && id === "try-again"}
              onClick={() => onAction(id)}
            >
              {done ? "Copied" : a.label}
            </Button>
          )
        })}
      </div>
    </section>
  )
}
