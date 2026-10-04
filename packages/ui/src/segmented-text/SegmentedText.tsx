import { type ComponentPropsWithRef, type KeyboardEvent, useRef } from "react"
import { cx } from "../internal/util"

/** One text segment of a {@link SegmentedText}. */
export interface SegmentedTextOption<V extends string = string> {
  value: V
  label: string
  disabled?: boolean
}

/** Props for {@link SegmentedText}. Remaining `<div>` props go to the frame. */
export interface SegmentedTextProps<V extends string = string>
  extends Omit<ComponentPropsWithRef<"div">, "onChange" | "children"> {
  options: readonly SegmentedTextOption<V>[]
  value: V | null
  onChange?: (value: V) => void
  /** Accessible name of the radio group. */
  label: string
}

/**
 * Text-label segmented control. Mirrors `SegmentedText` (FC6O7): row, gap 2, padding 2,
 * bg-muted, radius-pill. Segment (mgJRy / sK1Gg / wu1jc): h 24, padding [0, 10], center,
 * radius-pill; label sans 12 / 500 text-tertiary. Selected (sK1Gg): fill bg-app, shadow 0 1 2
 * shadow, label text-primary. Keyboard: ←/→ (wrapping), Home/End select (radio group).
 */
export function SegmentedText<V extends string = string>({
  options,
  value,
  onChange,
  label,
  className,
  ...rest
}: SegmentedTextProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
  const move = (e: KeyboardEvent, from: number) => {
    const pos = enabled.indexOf(from)
    let next: number | undefined
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = enabled[(pos + 1) % enabled.length]
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = enabled[(pos - 1 + enabled.length) % enabled.length]
    else if (e.key === "Home") next = enabled[0]
    else if (e.key === "End") next = enabled[enabled.length - 1]
    if (next === undefined) return
    e.preventDefault()
    const o = options[next]
    if (o) onChange?.(o.value)
    refs.current[next]?.focus()
  }
  const focusable = options.findIndex((o) => o.value === value)
  return (
    <div {...rest} role="radiogroup" aria-label={label} className={cx("kimo-seg-text", className)}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          // biome-ignore lint/a11y/useSemanticElements: APG radio group pattern with text buttons.
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            tabIndex={on || (focusable < 0 && i === enabled[0]) ? 0 : -1}
            data-value={o.value}
            className={cx("kimo-seg-text__segment", on && "kimo-seg-text__segment--on")}
            onClick={() => !on && onChange?.(o.value)}
            onKeyDown={(e) => move(e, i)}
          >
            <span className="kimo-seg-text__label">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
