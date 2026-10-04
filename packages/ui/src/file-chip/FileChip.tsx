import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link FileChip}. Remaining `<button>` props pass through. */
export interface FileChipProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** File path shown as the label ("Hero.tsx"). */
  path: string
  active?: boolean
}

/**
 * A generated file's tab in the Code tab. Mirrors `File · Hero.tsx` (CHvca) / `File ·
 * Button.tsx` (jVMNY): row, h 24, padding [0, 8], center, radius-sm; active fill bg-muted,
 * label mono 11 / 500 text-primary; inactive transparent, label mono 11 / 400 text-tertiary.
 * `role="tab"`: the parent is the tablist.
 */
export function FileChip({
  path,
  active = false,
  className,
  type = "button",
  ...rest
}: FileChipProps) {
  return (
    <button
      {...rest}
      type={type}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-path={path}
      className={cx("kimo-file-chip", active && "kimo-file-chip--active", className)}
    >
      <span className="kimo-file-chip__label">{path}</span>
    </button>
  )
}
