import type { ComponentPropsWithRef, MouseEventHandler, ReactNode } from "react"
import { cx } from "../internal/util"

/** The header action of a {@link PropSection}. */
export interface PropSectionAction {
  /** Accessible name. */
  label: string
  /** 14 × 14 icon (the design uses lucide `plus`). */
  icon: ReactNode
  onClick?: MouseEventHandler<HTMLButtonElement>
}

/** Props for {@link PropSection}. Remaining `<section>` props go to the frame. */
export interface PropSectionProps extends Omit<ComponentPropsWithRef<"section">, "title"> {
  title: ReactNode
  action?: PropSectionAction
}

/**
 * Inspector section. Mirrors `PropSection` (fWrGA): vertical, gap 8, padding [12, 12, 16, 12],
 * bottom stroke 1 border; Header (space-between, center): title sans 12 / 600 text-primary,
 * action icon 14 text-tertiary. Children follow the header (typically {@link PropRow}s).
 * The design instance is 260 wide; the component fills its container.
 */
export function PropSection({ title, action, className, children, ...rest }: PropSectionProps) {
  return (
    <section {...rest} className={cx("kimo-prop-section", className)}>
      <div className="kimo-prop-section__header">
        <h3 className="kimo-prop-section__title">{title}</h3>
        {action && (
          <button
            type="button"
            className="kimo-prop-section__action"
            aria-label={action.label}
            onClick={action.onClick}
          >
            {action.icon}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

/** Props for {@link PropRow}. */
export type PropRowProps = ComponentPropsWithRef<"div">

/**
 * A row of fields inside a {@link PropSection}. Mirrors PropSection > Row (y5Lz1A):
 * fill_container, horizontal, gap 8; every child fills (fill_container).
 */
export function PropRow({ className, ...rest }: PropRowProps) {
  return <div {...rest} className={cx("kimo-prop-row", className)} />
}
