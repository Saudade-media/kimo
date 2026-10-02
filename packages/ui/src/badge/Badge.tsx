import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link Badge}. Native `<span>` props pass through. */
export type BadgeProps = ComponentPropsWithRef<"span">

/**
 * Small label. Mirrors `Badge` (jrIWa): bg-muted, radius-pill, padding [2, 8];
 * label sans 11 / 500 text-secondary.
 */
export function Badge({ className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={cx("kimo-badge", className)}>
      <span className="kimo-badge__label">{children}</span>
    </span>
  )
}
