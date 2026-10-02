import type { ComponentPropsWithRef, ReactNode } from "react"

/** Props for {@link IconButton}. All native `<button>` props pass through. */
export interface IconButtonProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** Accessible name; the button has no visible text. */
  label: string
  /** 16 × 16 icon (e.g. a Lucide SVG). Colored with `currentColor`. */
  icon: ReactNode
  /** Toggled-on state (`IconButton/Active`); sets `aria-pressed` when defined. */
  active?: boolean
  /**
   * `"md"` (default): 28 × 28, 16px icon. `"sm"`: 24 × 24, 14px icon, the instance override used
   * by `PanelHeader` > Action (TidcK) in desing.pen.
   */
  size?: "md" | "sm"
  /**
   * `"default"`: bg-app, icon text-secondary. The M2 instances override the fill to
   * `#00000000`: `"ghost"` keeps the icon text-secondary (color picker Eyedropper/Close
   * `hcAM8`/`W3Ijc`, gradient Rotate/Flip/Remove); `"quiet"` uses text-tertiary (Popover Close
   * `gKfsp`, FillRow Eye/Remove `r3MBc`/`FFtaO`). Hover bg-hover in every tone.
   */
  tone?: "default" | "ghost" | "quiet"
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
  size = "md",
  tone = "default",
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  const classes = [
    "kimo-icon-button",
    size === "sm" && "kimo-icon-button--sm",
    tone !== "default" && `kimo-icon-button--${tone}`,
    active && "kimo-icon-button--active",
    className,
  ]
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
