import { Pause } from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { AgentMark } from "../agent-mark/AgentMark"
import type { Persona } from "../agent-mark/persona"
import { CompactButton } from "../compact-button/CompactButton"
import { cx } from "../internal/util"

/** One op row of an {@link ApprovalCard}: icon · verb + target · scope. */
export interface ApprovalCardOp {
  /** 14 px lucide icon (`trash-2`, `variable`, …). */
  icon: ReactNode
  /** "Delete 3 layers", "Edit $card-radius". */
  label: string
  /** "in Pricing", "global · 12 uses". */
  meta?: string
}

export type ApprovalCardChoice = "once" | "session" | "deny"

/** Props for {@link ApprovalCard}. Remaining `<div>` props go to the card. */
export interface ApprovalCardProps
  extends Omit<ComponentPropsWithRef<"div">, "children" | "title" | "onChange"> {
  /** "Kimo wants to". */
  title: string
  ops: readonly ApprovalCardOp[]
  /** Offered choices (in-app: Allow once / Always this session / Deny). */
  choices?: readonly ApprovalCardChoice[]
  onChoose?: (choice: ApprovalCardChoice) => void
  /** Waiting label (Q4aqqw): "paused". */
  waitingLabel?: string
  persona?: Persona
}

const CHOICE_LABEL: Record<ApprovalCardChoice, string> = {
  once: "Allow once",
  session: "Always this session",
  deny: "Deny",
}

/**
 * In-thread approval (board 25 "v1 Polish" §5 OlhpU, rule hb9kv). Column, gap 10, padding 12,
 * fill bg-app, stroke 1 $agent, radius-lg, shadow 0 2 8 $shadow
 *   ├ Head (y9tnrU) row gap 8, center › AgentMark/12/Listening (N0LALv) · Title sans 12 / 600
 *   │  text-primary · Spacer · Waiting (u25Yn) row gap 4: pause 12 + sans 11, text-tertiary
 *   ├ Ops (G9V6Kf) column gap 6, padding [8, 10], bg-subtle, radius-md › Op row gap 8, center:
 *   │  icon 14 text-primary · Op sans 11 / 500 text-primary · Spacer · Meta sans 11 tertiary
 *   └ Actions (v26S3I) row gap 4, center › Allow once (Button/Primary h 28, padding [0, 10],
 *      label 12) · Always this session (Button/Secondary) · Spacer · Deny (Button/Ghost)
 * In-app it waits indefinitely (no countdown); Deny → tool result "denied by user".
 */
export function ApprovalCard({
  title,
  ops,
  choices = ["once", "session", "deny"],
  onChoose,
  waitingLabel = "paused",
  persona = "teal",
  className,
  ...rest
}: ApprovalCardProps) {
  const allow = choices.filter((c) => c !== "deny")
  return (
    <div
      role="alertdialog"
      aria-label={title}
      {...rest}
      className={cx("kimo-approval-card", className)}
    >
      <div className="kimo-approval-card__head">
        <AgentMark size={12} state="listening" persona={persona} />
        <span className="kimo-approval-card__title">{title}</span>
        <span className="kimo-approval-card__spacer" aria-hidden="true" />
        <span className="kimo-approval-card__waiting">
          <Pause aria-hidden="true" />
          <span>{waitingLabel}</span>
        </span>
      </div>
      {ops.length > 0 && (
        <div className="kimo-approval-card__ops">
          {ops.map((op, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: op rows are positional.
            <div key={i} className="kimo-approval-card__op">
              <span className="kimo-approval-card__op-icon" aria-hidden="true">
                {op.icon}
              </span>
              <span className="kimo-approval-card__op-label">{op.label}</span>
              <span className="kimo-approval-card__spacer" aria-hidden="true" />
              {op.meta && <span className="kimo-approval-card__op-meta">{op.meta}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="kimo-approval-card__actions">
        {allow.map((c) => (
          <CompactButton
            key={c}
            variant={c === "once" ? "primary" : "secondary"}
            height={28}
            padX={10}
            data-choice={c}
            onClick={() => onChoose?.(c)}
          >
            {CHOICE_LABEL[c]}
          </CompactButton>
        ))}
        <span className="kimo-approval-card__spacer" aria-hidden="true" />
        {choices.includes("deny") && (
          <CompactButton
            variant="ghost"
            height={28}
            padX={10}
            data-choice="deny"
            onClick={() => onChoose?.("deny")}
          >
            {CHOICE_LABEL.deny}
          </CompactButton>
        )}
      </div>
    </div>
  )
}
