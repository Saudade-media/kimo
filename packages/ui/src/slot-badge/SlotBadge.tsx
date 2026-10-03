import { Component, Plus, SquareDashed } from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link SlotBadge}. Remaining `<span>` props go to the pill. */
export interface SlotBadgeProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  /** Slot name; the label reads "Slot · <name>". */
  name: string
}

/**
 * Slot label pill (DOM overlay drawn by the canvas host). Mirrors `SlotBadge` (kMGG0): row,
 * gap 4, padding [2, 8, 2, 6], alignItems center, fill component, radius-pill; Icon (PCa4i)
 * `square-dashed` 10 text-inverse; Label (VGs3v) mono 11 / 500 text-inverse.
 */
export function SlotBadge({ name, className, ...rest }: SlotBadgeProps) {
  return (
    <span {...rest} className={cx("kimo-slot-badge", className)}>
      <span className="kimo-slot-badge__icon" aria-hidden="true">
        <SquareDashed />
      </span>
      <span className="kimo-slot-badge__label">{`Slot · ${name}`}</span>
    </span>
  )
}

/** Props for {@link SlotQuickInsert}. Native `<button>` props pass through. */
export interface SlotQuickInsertProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** Suggested component name ("Button/Primary"), or the "+1" count for the More variant. */
  label: string
  /** "More" variant (board 12 `nev4I`): padding [3, 8], no icon/glyph, label text-secondary. */
  more?: boolean
  /** Glyph after the plus; default lucide `component`. */
  glyph?: ReactNode
}

/**
 * Quick-insert pill under a selected main's empty slot. Mirrors `SlotQuickInsert` (AJSok): row,
 * gap 4, padding [3, 10, 3, 6], alignItems center, fill bg-subtle, stroke 1 border,
 * radius-pill; Icon (B93PCT) `plus` 12 text-secondary · Glyph (BSq4s) `component` 12 component
 * · Label (x68rp1) sans 11 / 500 text-primary.
 */
export function SlotQuickInsert({
  label,
  more = false,
  glyph,
  className,
  type = "button",
  ...rest
}: SlotQuickInsertProps) {
  return (
    <button
      aria-label={more ? `${label} more suggestions` : `Insert ${label}`}
      {...rest}
      type={type}
      className={cx("kimo-slot-quick-insert", more && "kimo-slot-quick-insert--more", className)}
    >
      {!more && (
        <>
          <span className="kimo-slot-quick-insert__icon" aria-hidden="true">
            <Plus />
          </span>
          <span className="kimo-slot-quick-insert__glyph" aria-hidden="true">
            {glyph ?? <Component />}
          </span>
        </>
      )}
      <span className="kimo-slot-quick-insert__label">{label}</span>
    </button>
  )
}
