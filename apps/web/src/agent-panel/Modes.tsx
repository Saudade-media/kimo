/**
 * Mode run surfaces (board 22 Modes ZFOQf as replaced on board 24 GmEAl):
 * - {@link PlanCard}: "Split Plan" (tiORC) — Head (layout-grid, "Split · 3 agents", cost, Stop
 *   all) › one row per agent (AgentMark 24 in its persona + live state, Name + Scope Badge, Meta,
 *   Status pill) › Log of op rows tinted by persona (rejections in danger). Side by side uses the
 *   same card ("Side by side · 3 agents") with Keep / Discard per finished variant (avr2x).
 * - {@link ReviewCard}: iterate "Review Card" (Vacqa) with passes, changes, steer field.
 * - Canvas pieces exported for the canvas mount: {@link ModeSummaryPill} (jDKaM),
 *   {@link VariantActions} (avr2x), {@link PassChip} (NCElh), {@link AgentCursorPill} (GmEAl
 *   cursors / joR0E), {@link RejectedOpPill} (O2Whh).
 */
import {
  AgentMark,
  type AgentMarkState,
  CompactButton,
  type Persona,
  personaVar,
  SegmentedText,
} from "@kimo/ui"
import { Ban, Check, LayoutGrid, Lock, MousePointer2, Repeat, Square, Undo2 } from "lucide-react"
import { type CSSProperties, useState } from "react"
import type { AgentPanelControllerExt, ModeAgentRow, ModeRunView, PlanLogRow } from "./controller"
import { costLabel } from "./format"

const tint = (p: Persona): CSSProperties =>
  ({
    "--agent-persona": personaVar(p),
    "--agent-persona-soft": personaVar(p, "soft"),
  }) as CSSProperties

const usd = (v: number | null) => costLabel({ costUsd: v, billing: "api" })
const tok = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k tok` : `${n} tok`)

function statusOf(a: ModeAgentRow): { label: string; tone: "done" | "neutral" | "danger" } {
  if (a.discarded) return { label: "Discarded", tone: "neutral" }
  switch (a.state) {
    case "done":
      return { label: "Done", tone: "done" }
    case "error":
      return { label: "Error", tone: "danger" }
    case "stopped":
      return { label: "Stopped", tone: "neutral" }
    case "paused":
      return { label: "Paused", tone: "neutral" }
    default:
      return { label: a.ops === 0 ? "Placeholder" : "Working", tone: "neutral" }
  }
}

/** Status (IGSLX / rCYI5): gap 5, padding [2, 8, 2, 6], pill; Dot 6; Label sans 11 / 500. */
function StatusDot({ label, tone }: { label: string; tone: "done" | "neutral" | "danger" }) {
  return (
    <span className={`agent-status agent-status--${tone}`}>
      <span className="agent-status__dot" aria-hidden="true" />
      <span className="agent-status__label">{label}</span>
    </span>
  )
}

/** One Log row (R9Q8AS / B6L1P): gap 8, padding [5, 12]; Op chip 52 × 18 in the persona hue. */
export function OpLogRow({ row, onRevert }: { row: PlanLogRow; onRevert?: () => void }) {
  return (
    <div
      className={`agent-op-log${row.op === "reject" ? " agent-op-log--reject" : ""}`}
      style={tint(row.persona)}
      data-op={row.op}
    >
      <span className="agent-op-log__chip">
        <span className="agent-op-log__op">{row.op}</span>
      </span>
      <span className="agent-op-log__target">{row.target}</span>
      <span className="agent-op-log__detail">{row.detail}</span>
      {onRevert && row.op !== "reject" && (
        <button
          type="button"
          className="agent-op-log__revert"
          aria-label={`Revert ${row.op} ${row.target}`}
          onClick={onRevert}
        >
          <Undo2 aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export function PlanCard({
  controller,
  run,
}: {
  controller: AgentPanelControllerExt
  run: ModeRunView
}) {
  const title =
    run.mode === "split"
      ? `Split · ${run.agents.length} agents`
      : `Side by side · ${run.agents.length} agents`
  return (
    <section className="agent-plan" data-testid="agent-plan" data-mode={run.mode}>
      <div className="agent-plan__head">
        <LayoutGrid className="agent-plan__icon" aria-hidden="true" />
        <span className="agent-plan__title">{title}</span>
        <span className="agent-plan__spacer" aria-hidden="true" />
        <span className="agent-plan__cost">
          {controller.state.showCost ? `${usd(run.costUsd)} · ` : ""}
          {tok(run.tokens)}
        </span>
        {run.running && (
          <button type="button" className="agent-plan__stop" onClick={() => controller.stopAll()}>
            <Square className="agent-plan__stop-icon" aria-hidden="true" />
            <span className="agent-plan__stop-label">Stop all</span>
          </button>
        )}
      </div>
      {run.agents.map((a) => {
        const st = statusOf(a)
        return (
          <div
            key={a.origin}
            className="agent-plan__agent"
            data-origin={a.origin}
            data-persona={a.persona}
            style={tint(a.persona)}
          >
            <AgentMark size={24} state={a.mark} persona={a.persona} />
            <div className="agent-plan__text">
              <div className="agent-plan__name-row">
                <span className="agent-plan__name">{a.label}</span>
                <span className="agent-plan__scope">
                  <Lock className="agent-plan__scope-icon" aria-hidden="true" />
                  <span className="agent-plan__scope-label">{a.scopeName}</span>
                </span>
              </div>
              <span className="agent-plan__meta">
                {[
                  a.modelLabel,
                  `${a.ops} ops`,
                  ...(a.rejected ? [`${a.rejected} rejected`] : []),
                  ...(controller.state.showCost ? [usd(a.costUsd)] : []),
                ].join(" · ")}
              </span>
            </div>
            {run.mode === "side-by-side" && a.state === "done" && !a.kept && !a.discarded ? (
              <VariantActions
                cost={a.costUsd}
                onKeep={() => controller.keepVariant(a.origin)}
                onDiscard={() => void controller.discardVariant(a.origin)}
                compact
              />
            ) : (
              <StatusDot {...st} />
            )}
          </div>
        )
      })}
      {run.log.length > 0 && (
        <div className="agent-plan__log">
          {run.log.slice(-8).map((r) => (
            <OpLogRow key={r.key} row={r} />
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Variant Actions (avr2x): row 280, gap 6, center › Done pill "Done · $0.14" (StatusPill) ·
 * Spacer · Discard (Button/Ghost h 26) · Keep (Button/Primary h 26, check 14).
 */
export function VariantActions({
  cost,
  onKeep,
  onDiscard,
  compact = false,
  showCost = true,
}: {
  cost: number | null
  onKeep(): void
  onDiscard(): void
  compact?: boolean
  /** Settings "Show cost" (board 27 r9hTk); default on. */
  showCost?: boolean
}) {
  return (
    <div className={`agent-variant-actions${compact ? " agent-variant-actions--compact" : ""}`}>
      {!compact && <StatusDot label={showCost ? `Done · ${usd(cost)}` : "Done"} tone="done" />}
      {!compact && <span className="agent-plan__spacer" aria-hidden="true" />}
      <CompactButton variant="ghost" height={26} padX={10} onClick={onDiscard}>
        Discard
      </CompactButton>
      <CompactButton variant="primary" height={26} padX={10} icon={<Check />} onClick={onKeep}>
        Keep
      </CompactButton>
    </div>
  )
}

/** Board 22 Iterate › Review Card (Vacqa). */
export function ReviewCard({
  controller,
  run,
}: {
  controller: AgentPanelControllerExt
  run: ModeRunView
}) {
  const it = run.iterate
  const [steer, setSteer] = useState("")
  if (!it) return null
  const passes = Array.from({ length: it.of + 1 }, (_, i) => i)
  return (
    <section className="agent-review" data-testid="agent-review">
      <div className="agent-review__head">
        <AgentMark size={24} state={it.reviewing ? "done" : "working"} />
        <div className="agent-review__text">
          <span className="agent-review__title">
            {it.reviewing ? `Pass ${it.pass} ready for review` : `Pass ${it.pass} running…`}
          </span>
          <span className="agent-review__sub">
            “{it.goal}” · {it.changes} changes
            {controller.state.showCost ? ` · ${usd(it.costUsd)}` : ""}
          </span>
        </div>
        <SegmentedText
          className="agent-seg-sm"
          label="Before / After"
          options={[
            { value: "before", label: "Before" },
            { value: "after", label: "After" },
          ]}
          value={it.view}
          onChange={(v) => controller.setIterateView(v)}
        />
      </div>
      <div className="agent-review__passes">
        {passes.map((p) => {
          const cls =
            p === it.pass
              ? "agent-pass agent-pass--current"
              : p < it.pass
                ? "agent-pass"
                : "agent-pass agent-pass--future"
          return (
            <button
              key={p}
              type="button"
              className={cls}
              disabled={p > it.pass || p === it.pass || run.running}
              onClick={() => void controller.review({ action: "revert", toPass: p })}
            >
              <span className="agent-pass__label">{p === 0 ? "Original" : `Pass ${p}`}</span>
            </button>
          )
        })}
      </div>
      {it.rows.length > 0 && (
        <div className="agent-review__changes">
          {it.rows.slice(0, 8).map((r) => (
            <OpLogRow key={r.key} row={r} />
          ))}
        </div>
      )}
      <div className="agent-review__next">
        <input
          className="agent-review__steer"
          placeholder="Steer the next pass (optional) — e.g. “less contrast on the button”"
          aria-label="Steer the next pass"
          value={steer}
          onChange={(e) => setSteer(e.currentTarget.value)}
          disabled={!it.reviewing}
        />
        <div className="agent-review__actions">
          <CompactButton
            variant="ghost"
            height={30}
            padX={12}
            icon={<Undo2 />}
            disabled={!it.reviewing}
            onClick={() => void controller.review({ action: "revert", toPass: it.pass - 1 })}
          >
            Undo pass
          </CompactButton>
          <span className="agent-plan__spacer" aria-hidden="true" />
          <CompactButton
            variant="secondary"
            height={30}
            padX={12}
            icon={<Check />}
            disabled={!it.reviewing}
            onClick={() => void controller.review({ action: "stop" })}
          >
            Keep &amp; stop
          </CompactButton>
          <CompactButton
            variant="primary"
            height={30}
            padX={14}
            icon={<Repeat />}
            disabled={!it.reviewing}
            onClick={() => {
              const s = steer.trim()
              setSteer("")
              void controller.review(s ? { action: "next", steer: s } : { action: "next" })
            }}
          >
            Run pass {it.pass + 1}
          </CompactButton>
        </div>
      </div>
    </section>
  )
}

/** Mode Summary (jDKaM): h 28, gap 8, padding [0, 10, 0, 6], bg-app, 1 px border, pill. */
export function ModeSummaryPill({
  run,
  onStopAll,
  showCost = true,
}: {
  run: ModeRunView
  onStopAll?: () => void
  /** Settings "Show cost" (board 27 r9hTk); default on. */
  showCost?: boolean
}) {
  const name =
    run.mode === "split" ? "Split" : run.mode === "side-by-side" ? "Side by side" : "Iterate"
  return (
    <div className="agent-mode-summary" data-testid="agent-mode-summary">
      <span className="agent-mode-summary__marks">
        {run.agents.slice(0, 3).map((a) => (
          <AgentMark
            key={a.origin}
            size={18}
            state={a.mark}
            persona={a.persona}
            ring={{ width: 1.5, color: "var(--kimo-bg-app)" }}
          />
        ))}
      </span>
      <span className="agent-mode-summary__label">
        {name} · {run.agents.length} agents · {run.done} done
      </span>
      {showCost && <span className="agent-mode-summary__cost">{usd(run.costUsd)}</span>}
      {run.running && onStopAll && (
        <button type="button" className="agent-mode-summary__stop" onClick={onStopAll}>
          Stop all
        </button>
      )}
    </div>
  )
}

/** Pass Chip (NCElh): h 22, gap 5, padding [0, 8, 0, 6], bg-app, 1 px agent, pill. */
export function PassChip({
  pass,
  of,
  reviewing,
}: {
  pass: number
  of: number
  reviewing: boolean
}) {
  return (
    <span className="agent-pass-chip">
      <Repeat className="agent-pass-chip__icon" aria-hidden="true" />
      <span className="agent-pass-chip__label">
        Iterate · pass {pass} of {of}
        {reviewing ? " · review" : ""}
      </span>
    </span>
  )
}

/**
 * Agent cursor (board 24 GmEAl H6ncRy, joR0E VhAoz): column gap 2 › Pointer mouse-pointer-2 18
 * in the persona › Pill gap 6, padding [4, 10, 4, 4], persona fill, pill, shadow 0 4 12 ›
 * AgentMark 12 (state) · Label sans 12 / 500 on-accent.
 */
export function AgentCursorPill({
  label,
  persona,
  state,
}: {
  label: string
  persona: Persona
  state: AgentMarkState
}) {
  return (
    <span className="agent-cursor" style={tint(persona)} data-persona={persona}>
      <MousePointer2 className="agent-cursor__pointer" aria-hidden="true" />
      <span className="agent-cursor__pill">
        <AgentMark size={12} state={state} persona={persona} />
        <span className="agent-cursor__label">{label}</span>
      </span>
    </span>
  )
}

/** Rejected Op (O2Whh): h 24, gap 6, padding [0, 10, 0, 8], danger, pill › ban 12 · mono 11 / 500. */
export function RejectedOpPill({ text }: { text: string }) {
  return (
    <span className="agent-rejected" role="status">
      <Ban className="agent-rejected__icon" aria-hidden="true" />
      <span className="agent-rejected__label">{text}</span>
    </span>
  )
}
