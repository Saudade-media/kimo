import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link Kbd}. Native `<kbd>` props pass through. */
export type KbdProps = ComponentPropsWithRef<"kbd">

/**
 * Keyboard shortcut. Mirrors `Kbd` (Eo5JW): bg-subtle, radius 4, 1px border stroke,
 * padding [1, 5]; keys mono 11 text-secondary.
 */
export function Kbd({ className, children, ...rest }: KbdProps) {
  return (
    <kbd {...rest} className={cx("kimo-kbd", className)}>
      <span className="kimo-kbd__keys">{children}</span>
    </kbd>
  )
}
