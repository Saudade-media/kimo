import type { ComponentPropsWithRef, ReactNode } from "react"

/** Props for {@link IconButton}. All native `<button>` props pass through. */
export interface IconButtonProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** Accessible name; the button has no visible text. */
  label: string
  /** 16 × 16 icon (e.g. a Lucide SVG). Colored with `currentColor`. */
  icon: ReactNode
  /** Toggled-on state (`IconButton/Active`); sets `aria-pressed` when defined. */
  active?: boolean
}

/**
 * Square icon-only button. Mirrors `IconButton` / `IconButton/Active` in desing.pen:
 * 28 × 28, radius-md, centered 16px icon; bg-app / text-secondary, active accent-soft / accent-text.
 * Requires `@kimo/design-tokens/editor.css` and `@kimo/ui/styles.css`.
 */
export function IconButton({
  label,
  icon,
  active,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  const classes = ["kimo-icon-button", active && "kimo-icon-button--active", className]
    .filter(Boolean)
    .join(" ")
  return (
    <button {...rest} type={type} className={classes} aria-label={label} aria-pressed={active}>
      <span className="kimo-icon-button__icon" aria-hidden="true">
        {icon}
      </span>
    </button>
  )
}
