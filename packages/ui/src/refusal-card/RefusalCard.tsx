import { Hand, Pencil } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { CompactButton } from "../compact-button/CompactButton"
import { cx } from "../internal/util"

/** Props for {@link RefusalCard}. Remaining `<div>` props go to the card. */
export interface RefusalCardProps extends Omit<ComponentPropsWithRef<"div">, "children" | "title"> {
  /** "Kimo won't do this one". */
  title: string
  /** The model's own one-line reason (≤ 2 lines). */
  reason: string
  /** "Edit request": prefills the composer with the turn's prompt. */
  onEditRequest?: () => void
}

/**
 * Refusal (board 25 "v1 Polish" §5 dIkT6, rule rwUkh): not an error — the neutral card. Column,
 * gap 8, padding [10, 12], fill bg-subtle, stroke 1 border, radius-lg › Head (HR5gC) row gap 8,
 * center: hand 14 text-secondary · Title sans 12 / 600 text-primary › Desc (Yjclc) sans 11
 * text-secondary, line height 1.45 › Actions (xcFzl) row gap 6: Edit request (Button/Secondary
 * h 26, padding [0, 10], pencil 14, label 12). Never danger. Shares the AgentErrorCard (Ny3kQ)
 * frame, whose "stopped" tone is this fill + stroke.
 */
export function RefusalCard({
  title,
  reason,
  onEditRequest,
  className,
  ...rest
}: RefusalCardProps) {
  return (
    <div
      role="status"
      {...rest}
      data-kind="refusal"
      data-tone="refusal"
      className={cx("kimo-error-card", "kimo-error-card--stopped", "kimo-refusal-card", className)}
    >
      <div className="kimo-error-card__head">
        <Hand className="kimo-error-card__icon" aria-hidden="true" />
        <span className="kimo-error-card__title">{title}</span>
      </div>
      <p className="kimo-error-card__desc kimo-refusal-card__reason">{reason}</p>
      {onEditRequest && (
        <div className="kimo-error-card__actions">
          <CompactButton
            variant="secondary"
            height={26}
            padX={10}
            data-action="edit_request"
            icon={<Pencil />}
            onClick={onEditRequest}
          >
            Edit request
          </CompactButton>
        </div>
      )}
    </div>
  )
}
