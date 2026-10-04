import type { CSSProperties } from "react"
import { Button, type ButtonProps } from "../button/Button"
import { cx } from "../internal/util"

/** Props for {@link CompactButton}. */
export interface CompactButtonProps extends Omit<ButtonProps, "size"> {
  /** Instance height: 24 / 26 / 28 / 30 (board 22 / 24 instances). */
  height: 24 | 26 | 28 | 30
  /** Horizontal padding: [0, padX] (6, 8, 10, 12, 14). */
  padX: number
  /** Label size: `xs` (11) or `sm` (12). Default `sm`. */
  text?: "xs" | "sm"
  /** Danger label (Stop all: `e5j2wK` fill $danger). */
  danger?: boolean
}

/**
 * A `Button/*` instance with the M6 overrides the boards apply (height 24–30, padding [0, 6–14],
 * label text-xs / text-sm, icon 14). Neutralizes the base height, padding and font size.
 */
export function CompactButton({
  height,
  padX,
  text = "sm",
  danger = false,
  className,
  style,
  ...rest
}: CompactButtonProps) {
  return (
    <Button
      {...rest}
      className={cx("kimo-compact-button", `kimo-compact-button--${text}`, className)}
      data-danger={danger || undefined}
      style={
        {
          "--kimo-compact-h": `${height}px`,
          "--kimo-compact-px": `${padX}px`,
          ...style,
        } as CSSProperties
      }
    />
  )
}
