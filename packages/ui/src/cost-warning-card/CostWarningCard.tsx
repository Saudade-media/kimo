import { CircleDollarSign } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link CostWarningCard}. Remaining `<div>` props go to the card. */
export interface CostWarningCardProps
  extends Omit<ComponentPropsWithRef<"div">, "children" | "title"> {
  /** "This turn may cost about $0.42" / "This turn is large: ~180k tokens". */
  title: string
  /** "Above your $0.25 per-turn warning: 14 frames + 3 images in context. …". */
  description: string
  onSendAnyway: () => void
  onEditMessage: () => void
  /** "Settings" link (Settings › AI providers). Omitted: no link. */
  onSettings?: () => void
}

/**
 * Per-turn cost warning above the agent composer. Mirrors desing.pen board 27 §10 (b) EP0Ir ›
 * Cost Warning Card (qtTiZ): column fill, gap 8, padding [10, 12], fill warning-soft, radius-md ›
 *   Head (npqDG) row gap 8, center: Icon circle-dollar-sign 14 warning · Title sans sm (12) 400
 *     text-primary
 *   Desc (iHQMS) sans xs (11) text-secondary, line height 1.45
 *   Actions (RvSkG) row gap 6, center: Send anyway (QOGhX) h 26, padding [0, 10], bg-muted,
 *     stroke 1 border-strong, radius-pill, label sm 500 text-primary · Edit message (jGwMp) same
 *     without fill/stroke, label text-secondary · Spacer · Link "Settings" (XlDRH) xs 400 tertiary
 */
export function CostWarningCard({
  title,
  description,
  onSendAnyway,
  onEditMessage,
  onSettings,
  className,
  ...rest
}: CostWarningCardProps) {
  return (
    <div role="alert" {...rest} className={cx("kimo-cost-warning", className)}>
      <div className="kimo-cost-warning__head">
        <CircleDollarSign className="kimo-cost-warning__icon" aria-hidden="true" />
        <span className="kimo-cost-warning__title">{title}</span>
      </div>
      <p className="kimo-cost-warning__desc">{description}</p>
      <div className="kimo-cost-warning__actions">
        <button
          type="button"
          className="kimo-cost-warning__button kimo-cost-warning__button--send"
          onClick={onSendAnyway}
        >
          <span className="kimo-cost-warning__label">Send anyway</span>
        </button>
        <button
          type="button"
          className="kimo-cost-warning__button kimo-cost-warning__button--edit"
          onClick={onEditMessage}
        >
          <span className="kimo-cost-warning__label">Edit message</span>
        </button>
        <span className="kimo-cost-warning__spacer" aria-hidden="true" />
        {onSettings && (
          <button type="button" className="kimo-cost-warning__link" onClick={onSettings}>
            Settings
          </button>
        )}
      </div>
    </div>
  )
}
