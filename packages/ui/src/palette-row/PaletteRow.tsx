import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link PaletteRow}. Remaining `<div>` props go to the row. */
export interface PaletteRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** 14 × 14 lucide icon (`file`, `plus` for "New page"). */
  icon: ReactNode
  name: string
  /** Meta text after the name ("12 layers", "⌘↵"). */
  meta?: string
  /** Meta in font-mono ("New page" row: ⌘↵). */
  metaMono?: boolean
  /** `PaletteRow/Active` (Emzr7): bg-hover, icon text-primary, the ↵ key shown. */
  active?: boolean
}

/**
 * ⌘P switcher row. Mirrors `PaletteRow` (PiM7v) / `PaletteRow/Active` (Emzr7):
 * fill_container × 32, radius-md, gap 8, padding [0, 10], alignItems center: Icon 14
 * (text-tertiary; active text-primary) · Name sans text-sm text-primary · Meta sans text-xs
 * text-tertiary · Spacer · Enter Key (active only: bg-subtle, radius 4, stroke 1 border,
 * padding [1, 5]; "↵" sans text-xs text-secondary). Active: bg-hover.
 */
export function PaletteRow({
  icon,
  name,
  meta,
  metaMono = false,
  active = false,
  className,
  ...rest
}: PaletteRowProps) {
  return (
    <div
      role="option"
      aria-selected={active}
      tabIndex={-1}
      {...rest}
      className={cx("kimo-palette-row", active && "kimo-palette-row--active", className)}
    >
      <span className="kimo-palette-row__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="kimo-palette-row__name">{name}</span>
      {meta !== undefined && (
        <span className={cx("kimo-palette-row__meta", metaMono && "kimo-palette-row__meta--mono")}>
          {meta}
        </span>
      )}
      <span className="kimo-palette-row__spacer" aria-hidden="true" />
      {active && (
        <span className="kimo-palette-row__key" aria-hidden="true">
          <span className="kimo-palette-row__keys">↵</span>
        </span>
      )}
    </div>
  )
}
