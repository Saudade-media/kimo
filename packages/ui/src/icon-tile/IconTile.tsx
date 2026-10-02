import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link IconTile}. Remaining `<div>` props go to the cell. */
export interface IconTileProps extends Omit<ComponentPropsWithRef<"div">, "onSelect" | "children"> {
  /** Icon name (accessible name and `title`). */
  name: string
  /** 16 × 16 glyph, colored with `currentColor`. */
  icon: ReactNode
  selected?: boolean
  onSelect?: () => void
  /** Keyboard highlight (the listbox's active option): the hover look. */
  highlighted?: boolean
}

/**
 * Icon picker cell. Mirrors `IconTile` (D4Fvc): 32 × 32, radius-sm, center/center, icon 16
 * text-secondary. Hover (Nv0eZ, CSS `:hover`): bg-hover, icon text-primary. Selected (cJZRB):
 * accent, icon on-accent. `role="option"` inside the picker's listbox.
 */
export function IconTile({
  name,
  icon,
  selected = false,
  highlighted = false,
  onSelect,
  className,
  onClick,
  ...rest
}: IconTileProps) {
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: options are focused through the listbox's aria-activedescendant.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles the keyboard.
    <div
      {...rest}
      role="option"
      aria-selected={selected}
      aria-label={name}
      title={name}
      data-highlighted={highlighted || undefined}
      className={cx("kimo-icon-tile", selected && "kimo-icon-tile--selected", className)}
      onClick={(e) => {
        onClick?.(e)
        onSelect?.()
      }}
    >
      <span className="kimo-icon-tile__icon" aria-hidden="true">
        {icon}
      </span>
    </div>
  )
}
