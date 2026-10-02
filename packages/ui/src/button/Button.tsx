import type { ComponentPropsWithRef, ReactNode } from "react"

/** Visual variants, one per `Button/*` component on the 02 Components board. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "soft"

/** Props for {@link Button}. All native `<button>` props pass through. */
export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  /** Defaults to `"secondary"`. */
  variant?: ButtonVariant
  /** Leading 16 × 16 icon (e.g. a Lucide SVG). Colored with `currentColor`. */
  icon?: ReactNode
  /** Label text. */
  children?: ReactNode
}

/**
 * Pill action button. Mirrors `Button/Primary|Secondary|Ghost|Soft` in desing.pen:
 * height 32, padding 0 14, gap 6, radius-pill, label 13px / 500, 16px icon.
 * Requires `@kimo/design-tokens/editor.css` and `@kimo/ui/styles.css`.
 */
export function Button({
  variant = "secondary",
  icon,
  children,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = ["kimo-button", `kimo-button--${variant}`, className].filter(Boolean).join(" ")
  return (
    <button {...rest} type={type} className={classes}>
      {icon != null && (
        <span className="kimo-button__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children != null && <span className="kimo-button__label">{children}</span>}
    </button>
  )
}
