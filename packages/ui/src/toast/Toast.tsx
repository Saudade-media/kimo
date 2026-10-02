import { CircleCheck } from "lucide-react"
import type { ComponentPropsWithRef, MouseEventHandler, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link Toast}. Remaining `<div>` props go to the frame. */
export interface ToastProps extends ComponentPropsWithRef<"div"> {
  /** Leading 16 × 16 icon. Default lucide `circle-check` in `success`. */
  icon?: ReactNode
  /** Trailing action text (`Undo`). */
  actionLabel?: string
  onAction?: MouseEventHandler<HTMLButtonElement>
}

/**
 * Notification. Mirrors `Toast` (XB33E): fill text-primary, radius-lg, shadow 0 8 24
 * shadow-strong, gap 10, padding [10, 12], alignItems center; icon 16 success; label sans 12 /
 * 500 text-inverse; action sans 12 / 600 accent-soft. Announced politely (`role="status"`).
 */
export function Toast({ icon, actionLabel, onAction, className, children, ...rest }: ToastProps) {
  return (
    <div role="status" {...rest} className={cx("kimo-toast", className)}>
      <span className="kimo-toast__icon" aria-hidden="true">
        {icon ?? <CircleCheck />}
      </span>
      <span className="kimo-toast__label">{children}</span>
      {actionLabel != null && (
        <button type="button" className="kimo-toast__action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}
