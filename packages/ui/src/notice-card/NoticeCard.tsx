import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link NoticeCard}. Remaining `<div>` props go to the card. */
export interface NoticeCardProps extends Omit<ComponentPropsWithRef<"div">, "children" | "title"> {
  /** 14 × 14 icon (lucide), colored text-secondary. */
  icon: ReactNode
  title: string
  description: string
}

/**
 * A neutral, non-error notice. Mirrors `Notice` (xHvmD): column fill, gap 6, padding [10, 12],
 * fill bg-subtle, stroke 1 border, radius-md › Head (row gap 8, center): Icon 14 text-secondary ·
 * Title sans 12 / 600 text-primary › Desc sans 11 text-secondary, line height 1.45.
 */
export function NoticeCard({ icon, title, description, className, ...rest }: NoticeCardProps) {
  return (
    <div role="note" {...rest} className={cx("kimo-notice", className)}>
      <div className="kimo-notice__head">
        <span className="kimo-notice__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="kimo-notice__title">{title}</span>
      </div>
      <p className="kimo-notice__desc">{description}</p>
    </div>
  )
}
