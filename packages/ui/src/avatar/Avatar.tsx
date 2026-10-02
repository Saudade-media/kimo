import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link Avatar}. Native `<span>` props pass through. */
export interface AvatarProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  /** Person's name: accessible name and initials source. */
  name: string
  /** Explicit initials (default: first letters of the first two words). */
  initials?: string
}

/** Initials of a name: first letter of the first two words, upper-cased. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase()
}

/**
 * Person avatar. Mirrors `Avatar` (FVhW0): 24 × 24, radius-pill, linear gradient agent → agent-2
 * (rotation 225: agent top-left, agent-2 bottom-right); initials sans 10 / 600 #FFFFFF.
 */
export function Avatar({ name, initials, className, ...rest }: AvatarProps) {
  return (
    <span {...rest} role="img" aria-label={name} className={cx("kimo-avatar", className)}>
      <span className="kimo-avatar__initials" aria-hidden="true">
        {initials ?? initialsOf(name)}
      </span>
    </span>
  )
}
