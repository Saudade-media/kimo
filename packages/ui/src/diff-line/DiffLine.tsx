import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link DiffLine}. Remaining `<div>` props go to the row. */
export interface DiffLineProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  kind: "context" | "add" | "remove"
  /** Line number (new side for context / added lines, old side for removed lines). */
  number: number
  code: string
}

const SIGN = { context: " ", add: "+", remove: "-" } as const

/**
 * One row of the review step's unified diff. Mirrors `Line  3` (ayBwk) / `Line -4` (a5fCCx) /
 * `Line +4` (C3uVK6): row fill, gap 8, padding [2, 12]; fill transparent / danger-soft /
 * success-soft › No 18 wide, right, mono 11 text-tertiary › Sign mono 11 (text-tertiary · danger
 * · success) › Code mono 11 text-primary.
 */
export function DiffLine({ kind, number, code, className, ...rest }: DiffLineProps) {
  return (
    <div
      {...rest}
      data-kind={kind}
      className={cx("kimo-diff-line", `kimo-diff-line--${kind}`, className)}
    >
      <span className="kimo-diff-line__no" aria-hidden="true">
        {number}
      </span>
      <span className="kimo-diff-line__sign">{SIGN[kind]}</span>
      <span className="kimo-diff-line__code">{code}</span>
    </div>
  )
}
