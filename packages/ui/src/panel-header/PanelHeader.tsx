import type { ComponentPropsWithRef, MouseEventHandler, ReactNode } from "react"
import { IconButton } from "../icon-button/IconButton"
import { cx } from "../internal/util"

/** The trailing action of a {@link PanelHeader}. */
export interface PanelHeaderAction {
  /** Accessible name. */
  label: string
  /** 14 × 14 icon (the design uses lucide `plus`). */
  icon: ReactNode
  onClick?: MouseEventHandler<HTMLButtonElement>
}

/** Props for {@link PanelHeader}. Remaining `<div>` props go to the frame. */
export interface PanelHeaderProps extends Omit<ComponentPropsWithRef<"div">, "title"> {
  title: ReactNode
  action?: PanelHeaderAction
}

/**
 * Panel title bar. Mirrors `PanelHeader` (LWjoa): fill_container × 32, padding [0, 4, 0, 8],
 * space-between, alignItems center; title sans 12 / 600 text-primary; action = IconButton
 * resized to 24 × 24 with a 14px icon.
 */
export function PanelHeader({ title, action, className, children, ...rest }: PanelHeaderProps) {
  return (
    <div {...rest} className={cx("kimo-panel-header", className)}>
      <span className="kimo-panel-header__title">{title}</span>
      {action && (
        <IconButton
          size="sm"
          className="kimo-panel-header__action"
          label={action.label}
          icon={action.icon}
          onClick={action.onClick}
        />
      )}
      {children}
    </div>
  )
}
