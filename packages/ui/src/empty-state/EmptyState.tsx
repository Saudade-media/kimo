import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link EmptyState}. Remaining `<div>` props go to the frame. */
export interface EmptyStateProps extends Omit<ComponentPropsWithRef<"div">, "title"> {
  /** 18 × 18 icon (the design uses lucide `layers`). */
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
}

/**
 * Empty placeholder. Mirrors `EmptyState` (lUDi2): width 280, bg-subtle, radius-xl, 1px
 * border-strong stroke, vertical, gap 8, padding 24, alignItems center; Icon Wrap 40 × 40 bg-app
 * pill with an 18px text-primary icon; title sans 13 / 600; description sans 12 text-secondary,
 * line height 1.45, centered. Children (e.g. a Button) follow the description.
 */
export function EmptyState({
  icon,
  title,
  description,
  className,
  children,
  ...rest
}: EmptyStateProps) {
  return (
    <div {...rest} className={cx("kimo-empty-state", className)}>
      <span className="kimo-empty-state__icon-wrap" aria-hidden="true">
        <span className="kimo-empty-state__icon">{icon}</span>
      </span>
      <p className="kimo-empty-state__title">{title}</p>
      {description != null && <p className="kimo-empty-state__desc">{description}</p>}
      {children}
    </div>
  )
}
