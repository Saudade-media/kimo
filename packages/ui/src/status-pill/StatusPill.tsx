import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Library link status. */
export type LibraryStatus = "linked" | "changed" | "missing"

const LABEL: Record<LibraryStatus, string> = {
  linked: "Linked",
  changed: "Changed",
  missing: "Missing",
}

/** Props for {@link StatusPill}. Remaining `<span>` props go to the pill. */
export interface StatusPillProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  status: LibraryStatus
  /** Assets-panel size (board 13 `MayJf`): padding [1, 6, 1, 5], label 10. */
  compact?: boolean
}

/**
 * Library status. Mirrors `StatusPill` (SVobH) / `/Changed` (n20iVc) / `/Missing` (jwQVJ): row,
 * gap 5, padding [2, 8, 2, 6], center, radius-pill; Dot (dmG7C) 6 × 6 · Label (tJyiu) sans 11 /
 * 500. Linked: success-soft / success; Changed: warning-soft / warning; Missing: danger-soft /
 * danger. Status tokens only.
 */
export function StatusPill({ status, compact = false, className, ...rest }: StatusPillProps) {
  return (
    <span
      {...rest}
      data-status={status}
      className={cx(
        "kimo-status-pill",
        `kimo-status-pill--${status}`,
        compact && "kimo-status-pill--compact",
        className,
      )}
    >
      <span className="kimo-status-pill__dot" aria-hidden="true" />
      <span className="kimo-status-pill__label">{LABEL[status]}</span>
    </span>
  )
}
