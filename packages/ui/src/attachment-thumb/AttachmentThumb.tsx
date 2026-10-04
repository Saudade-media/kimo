import { X } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link AttachmentThumb}. Remaining `<span>` props go to the frame. */
export interface AttachmentThumbProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  /** Image URL (object URL or data: URL). Omitted: the design's placeholder gradient. */
  src?: string
  /** File name ("moodboard.png"): alt text and the Remove label. */
  name: string
  /** `40` (component: Image 36 at y 4, Remove top-right) or `24` (composer / sent message rows). */
  size?: 40 | 24
  onRemove?: () => void
}

/**
 * Image attachment. Mirrors `AttachmentThumb` (PeXjy): frame 40 × 40, layout none › Image (BnTL3)
 * rect 36 × 36 at (0, 4), stroke 1 border, radius-sm › Remove (NNiWS) 16 × 16 at (24, 0), fill
 * text-primary, stroke 1.5 bg-app, radius-pill, x 10 text-inverse. The 24 px instances (w4ZW9O,
 * jm1ey) size the frame and Image to 24 at y 0 and disable Remove.
 */
export function AttachmentThumb({
  src,
  name,
  size = 40,
  onRemove,
  className,
  ...rest
}: AttachmentThumbProps) {
  return (
    <span
      {...rest}
      data-size={size}
      className={cx("kimo-attach-thumb", `kimo-attach-thumb--${size}`, className)}
    >
      <span className="kimo-attach-thumb__image" role="img" aria-label={name}>
        {src && <img src={src} alt="" />}
      </span>
      {size === 40 && onRemove && (
        <button
          type="button"
          className="kimo-attach-thumb__remove"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </button>
      )}
    </span>
  )
}
