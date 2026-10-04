import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/**
 * "Ink" token kinds (board 25 rule G4uiv8): structure by weight and grey only. `strong` =
 * keywords / tag names (text-primary 600), `attr` = attribute / property names
 * (text-secondary), `punct` = punctuation (text-tertiary), `comment` = comments (text-tertiary
 * italic), `plain` = everything else (text-primary).
 */
export type InkKind = "plain" | "strong" | "attr" | "punct" | "comment"

export interface InkToken {
  kind: InkKind
  text: string
}

/** Props for {@link CodeLine}. Remaining `<div>` props go to the line frame. */
export interface CodeLineProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** 1-based line number (right-aligned in a 22 px column). */
  number: number
  tokens: readonly InkToken[]
  /** Selected-child range (Fd5Zh…huaHq): selection-soft fill, 2 px selection rule, number selection. */
  highlighted?: boolean
}

/**
 * One line of the Code tab's code view. Mirrors `Line N` (zwdHw): row, padding [1, 12, 1, 10];
 * No (dILXj) 22 wide, right-aligned, mono 11 text-tertiary; Gutter (q55No) 10 × 1; then the
 * tokens, mono 11. Highlighted (Fd5Zh): fill selection-soft, left stroke 2 selection, number
 * selection.
 */
export function CodeLine({
  number,
  tokens,
  highlighted = false,
  className,
  ...rest
}: CodeLineProps) {
  return (
    <div
      {...rest}
      data-line={number}
      data-highlighted={highlighted || undefined}
      className={cx("kimo-code-line", highlighted && "kimo-code-line--highlighted", className)}
    >
      <span className="kimo-code-line__no" aria-hidden="true">
        {number}
      </span>
      <span className="kimo-code-line__gutter" aria-hidden="true" />
      {tokens.map((t, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
        <span key={i} className={`kimo-code-line__token kimo-code-line__token--${t.kind}`}>
          {t.text}
        </span>
      ))}
    </div>
  )
}
