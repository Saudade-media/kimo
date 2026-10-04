import type { ComponentPropsWithRef, ReactNode } from "react"
import { CompactButton } from "../compact-button/CompactButton"
import { cx } from "../internal/util"

/** One action of an {@link IconErrorCard}: the first is Button/Secondary, the second Ghost. */
export interface IconErrorCardAction {
  id: string
  label: string
  icon?: ReactNode
  onClick?: () => void
}

/** Props for {@link IconErrorCard}. Remaining `<div>` props go to the card. */
export interface IconErrorCardProps
  extends Omit<ComponentPropsWithRef<"div">, "children" | "title"> {
  /** The instance's icon override (Q3ljkL), e.g. lucide `folder-x`. */
  icon: ReactNode
  title: string
  description: string
  actions?: IconErrorCardAction[]
}

/**
 * The shared danger card (`AgentErrorCard` Ny3kQ visual) for instances that override its icon
 * and actions outside the agent (board 25 export error `u5xjVk`: icon folder-x, "Choose
 * folder…" folder-open, "Copy error" copy). Same classes and CSS as `AgentErrorCard` (danger
 * tone): column fill, gap 8, padding [10, 12], danger-soft, radius-lg › Head: Icon 14 danger ·
 * Title sans 12 / 600 › Desc sans 11 text-secondary 1.45 › Actions row gap 6: h 26, padding
 * [0, 10].
 */
export function IconErrorCard({
  icon,
  title,
  description,
  actions = [],
  className,
  ...rest
}: IconErrorCardProps) {
  return (
    <div role="alert" {...rest} data-tone="danger" className={cx("kimo-error-card", className)}>
      <div className="kimo-error-card__head">
        <span className="kimo-error-card__icon kimo-icon-error-card__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="kimo-error-card__title">{title}</span>
      </div>
      <p className="kimo-error-card__desc">{description}</p>
      {actions.length > 0 && (
        <div className="kimo-error-card__actions">
          {actions.slice(0, 2).map((a, i) => (
            <CompactButton
              key={a.id}
              variant={i === 0 ? "secondary" : "ghost"}
              height={26}
              padX={10}
              data-action={a.id}
              icon={a.icon}
              onClick={a.onClick}
            >
              {a.label}
            </CompactButton>
          ))}
        </div>
      )}
    </div>
  )
}
