import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link SessionRow}. Remaining `<button>` props go to the row. */
export interface SessionRowProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  title: string
  /** "now", "1h", "yesterday", "Oct 1". */
  time: string
  /** "Opus 5.5 · 6 messages · $0.38". */
  meta: string
  /** The open session: fill bg-muted (uCPJ5). */
  current?: boolean
}

/**
 * One session in the history list. Mirrors `SessionRow` (cV3ln): column fill_container, gap 2,
 * padding [8, 10], radius-md › Top (txgCM) row gap 8 center: Title (T8AH3h) sans 12 / 500
 * text-primary · Spacer · Time (oBUYd) sans 11 text-tertiary › Meta (D6w4a) mono 11
 * text-tertiary. Current: fill bg-muted.
 */
export function SessionRow({
  title,
  time,
  meta,
  current = false,
  className,
  type = "button",
  ...rest
}: SessionRowProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-current={current || undefined}
      className={cx("kimo-session-row", current && "kimo-session-row--current", className)}
    >
      <span className="kimo-session-row__top">
        <span className="kimo-session-row__title">{title}</span>
        <span className="kimo-session-row__spacer" aria-hidden="true" />
        <span className="kimo-session-row__time">{time}</span>
      </span>
      <span className="kimo-session-row__meta">{meta}</span>
    </button>
  )
}
