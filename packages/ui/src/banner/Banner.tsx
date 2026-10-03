import { CircleX, Info, TriangleAlert, X } from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { Button } from "../button/Button"
import { IconButton } from "../icon-button/IconButton"
import { cx } from "../internal/util"

export type BannerTone = "info" | "warning" | "danger"

/** One banner action. `ghost` and `secondary` both render the board's Button/Ghost instance
 * (label text-primary); `primary` is Button/Primary. Order = left to right. */
export interface BannerActionItem {
  id: string
  label: string
  variant: "ghost" | "secondary" | "primary"
}

/** Props for {@link Banner}. Remaining `<div>` props go to the frame. */
export interface BannerProps extends Omit<ComponentPropsWithRef<"div">, "title"> {
  tone?: BannerTone
  /** 16px lucide icon; defaults to `info` / `triangle-alert` / `circle-x` per tone. */
  icon?: ReactNode
  title: string
  body?: ReactNode
  actions?: readonly BannerActionItem[]
  onAction?: (id: string) => void
  /** Shows the Dismiss button (only "Ready to commit" keeps it on board 17/18). */
  onDismiss?: () => void
}

const FALLBACK: Record<BannerTone, ReactNode> = {
  info: <Info />,
  warning: <TriangleAlert />,
  danger: <CircleX />,
}

/**
 * Full-width banner under the topbar. Mirrors `Banner` (R6VHG) / `Banner/Warning` (KPgcF) /
 * `Banner/Danger` (Gq3Fs): row, gap 10, padding [8, 8, 8, 16], alignItems center, stroke
 * bottom 1 border; fill bg-subtle / warning-soft / danger-soft. Icon 16 (text-secondary /
 * warning / danger) · Message (row, gap 6, center, fill): Title sans 12 / 600 text-primary +
 * Body sans 12 text-secondary (fill) · Actions (row, gap 6, center): Button/Ghost (label
 * text-primary) and Button/Primary, each h 28, padding [0, 12], label 12 · Dismiss
 * IconButton 24, transparent, `x` 14 text-tertiary.
 */
export function Banner({
  tone = "info",
  icon,
  title,
  body,
  actions = [],
  onAction,
  onDismiss,
  className,
  ...rest
}: BannerProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      {...rest}
      data-tone={tone}
      className={cx("kimo-banner", `kimo-banner--${tone}`, className)}
    >
      <span className="kimo-banner__icon" aria-hidden="true">
        {icon ?? FALLBACK[tone]}
      </span>
      <div className="kimo-banner__message">
        <span className="kimo-banner__title">{title}</span>
        {body != null && <span className="kimo-banner__body">{body}</span>}
      </div>
      {actions.length > 0 && (
        <div className="kimo-banner__actions">
          {actions.map((a) => (
            <Button
              key={a.id}
              variant={a.variant === "primary" ? "primary" : "ghost"}
              className={cx(
                "kimo-banner__action",
                a.variant !== "primary" && "kimo-banner__action--ghost",
              )}
              data-action={a.id}
              onClick={() => onAction?.(a.id)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
      {onDismiss && (
        <IconButton
          className="kimo-banner__dismiss"
          label="Dismiss"
          icon={<X />}
          size="sm"
          tone="quiet"
          onClick={onDismiss}
        />
      )}
    </div>
  )
}
