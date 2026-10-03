import { CircleCheck, CircleX, TriangleAlert } from "lucide-react"
import type { ComponentPropsWithRef, MouseEventHandler, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link Toast}. Remaining `<div>` props go to the frame. */
export interface ToastProps extends ComponentPropsWithRef<"div"> {
  /** Leading 16 × 16 icon. Default per tone: `circle-check` / `circle-x` / `triangle-alert`. */
  icon?: ReactNode
  /**
   * `"success"` (default, XB33E: icon success), `"danger"` (Toast/Danger FVd5q: `circle-x`
   * danger, rejected edits), `"warning"` (Toast/Warning qINpv: `triangle-alert` warning),
   * `"neutral"` (board 15 PnSwW: icon text-inverse, e.g. `component` "instances updated").
   */
  tone?: "success" | "danger" | "warning" | "neutral"
  /** Trailing action text (`Undo`). */
  actionLabel?: string
  onAction?: MouseEventHandler<HTMLButtonElement>
}

/**
 * Notification. Mirrors `Toast` (XB33E): fill text-primary, radius-lg, shadow 0 8 24
 * shadow-strong, gap 10, padding [10, 12], alignItems center; icon 16 success; label sans 12 /
 * 500 text-inverse; action sans 12 / 600 accent-soft. Announced politely (`role="status"`);
 * the danger tone (rejected edits, board 15) uses `role="alert"`.
 */
export function Toast({
  icon,
  tone = "success",
  actionLabel,
  onAction,
  className,
  children,
  ...rest
}: ToastProps) {
  const fallback =
    tone === "danger" ? <CircleX /> : tone === "warning" ? <TriangleAlert /> : <CircleCheck />
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      {...rest}
      className={cx("kimo-toast", tone !== "success" && `kimo-toast--${tone}`, className)}
    >
      <span className="kimo-toast__icon" aria-hidden="true">
        {icon ?? fallback}
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
