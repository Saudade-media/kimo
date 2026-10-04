import { Frame, X } from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link AttachmentChip}. Remaining `<span>` props go to the chip. */
export interface AttachmentChipProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  /** Layer name ("Hero"). */
  label: string
  /** 12 px icon (default lucide `frame`). */
  icon?: ReactNode
  /** Remove (×). Omitted: no Remove (chips persisted on a sent user message). */
  onRemove?: () => void
}

/**
 * Selection context chip. Mirrors `AttachmentChip` (DwwpT): row, gap 4, padding [2, 6, 2, 8],
 * center, fill bg-muted, radius-pill › Icon (Fg9Kl) frame 12 text-secondary › Label (UfluG) sans
 * 11 / 500 text-secondary › Remove (JKnL3) x 12 text-tertiary.
 */
export function AttachmentChip({ label, icon, onRemove, className, ...rest }: AttachmentChipProps) {
  return (
    <span
      {...rest}
      className={cx("kimo-attach-chip", !onRemove && "kimo-attach-chip--fixed", className)}
    >
      <span className="kimo-attach-chip__icon" aria-hidden="true">
        {icon ?? <Frame />}
      </span>
      <span className="kimo-attach-chip__label">{label}</span>
      {onRemove && (
        <button
          type="button"
          className="kimo-attach-chip__remove"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </button>
      )}
    </span>
  )
}
