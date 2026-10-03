import { Info, Link2 } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "../button/Button"
import { cx } from "../internal/util"
import { Popover, type PopoverProps } from "../popover/Popover"

/** Props for {@link LibraryManager}. Popover props (anchor, placement, …) pass through. */
export interface LibraryManagerProps extends Omit<PopoverProps, "children" | "title" | "wide"> {
  /** LibraryRows, one per `imports` entry. */
  children: ReactNode
  /** "Link library…" → file picker → `linkLibrary`. */
  onLink: () => void
  /** Close button / Escape / outside click. Omit for a static (gallery) rendering. */
  onClose?: () => void
}

/**
 * Library manager (board 13 `KBZKl`): Popover (xvOvm) width 600 titled "Libraries". Body (SCB6r)
 * column: Intro (BUKMI: padding [12, 12, 4, 12]; sans 11 text-secondary, line-height 1.45) ·
 * List (lKwPW: column of LibraryRows; the last row has no bottom stroke) · Footer (gXVzr: stroke
 * top 1 border, row, gap 8, padding 12, center: `info` 14 text-tertiary · hint sans 11
 * text-tertiary · Spacer · Button/Primary h 28, padding [0, 12], `link-2` 14, label 12 "Link
 * library…").
 */
export function LibraryManager({
  children,
  onLink,
  onClose,
  className,
  bodyProps,
  ...rest
}: LibraryManagerProps) {
  return (
    <Popover
      {...rest}
      title="Libraries"
      onClose={onClose}
      className={cx("kimo-library-manager", className)}
      bodyProps={{
        ...bodyProps,
        className: cx("kimo-library-manager__body", bodyProps?.className),
      }}
    >
      <div className="kimo-library-manager__intro">
        <p className="kimo-library-manager__intro-text">
          Linked libraries are read-only. Their components, variables and theme axes are referenced
          as alias:id.
        </p>
      </div>
      <div className="kimo-library-manager__list">{children}</div>
      <div className="kimo-library-manager__footer">
        <Info className="kimo-library-manager__info" aria-hidden="true" />
        <span className="kimo-library-manager__hint">
          Stored in imports · paths are relative to this file
        </span>
        <span className="kimo-library-manager__spacer" aria-hidden="true" />
        <Button
          variant="primary"
          className="kimo-library-manager__link"
          icon={<Link2 />}
          onClick={onLink}
        >
          Link library…
        </Button>
      </div>
    </Popover>
  )
}
