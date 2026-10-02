import { type ComponentPropsWithRef, type KeyboardEvent, type ReactNode, useRef } from "react"
import { cx, nextEnabled } from "../internal/util"

/** One segment of a {@link Segmented} control. */
export interface SegmentedOption<V extends string = string> {
  value: V
  /** Accessible name of an icon segment; the visible text of a text segment. */
  label: string
  /**
   * 14 × 14 icon (Lucide). Omit for a text segment (M2: gradient Type `WpK9W`, icon Library
   * `CSNC1` / Style `w5XAy`): label sans 11 / 500, text-secondary, selected text-primary.
   */
  icon?: ReactNode
  disabled?: boolean
}

/** Props for {@link Segmented}. Remaining `<div>` props go to the frame. */
export interface SegmentedProps<V extends string = string>
  extends Omit<ComponentPropsWithRef<"div">, "onChange" | "children"> {
  options: readonly SegmentedOption<V>[]
  value: V | null
  onChange?: (value: V) => void
  /** Accessible name of the group. */
  label: string
  /** M2 `fill_container` variant: the frame fills its parent and segments share it equally. */
  fill?: boolean
}

/**
 * Icon segmented control (radio group). Mirrors `Segmented` (hx0Wg): bg-muted, radius-pill,
 * padding 2, gap 2; segments 32 × 24 pill, icon 14 text-tertiary; the selected one bg-app with
 * shadow 0 1 2 shadow and icon text-primary. ←/→ (and ↑/↓) move and select.
 */
export function Segmented<V extends string = string>({
  options,
  value,
  onChange,
  label,
  fill = false,
  className,
  ...rest
}: SegmentedProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selected = options.findIndex((o) => o.value === value)
  const focusable = selected >= 0 ? selected : options.findIndex((o) => !o.disabled)

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0
    if (!dir) return
    e.preventDefault()
    const next = nextEnabled(options.length, i, dir, (j) => options[j]?.disabled === true)
    const o = options[next]
    if (!o) return
    refs.current[next]?.focus()
    if (o.value !== value) onChange?.(o.value)
  }

  return (
    <div
      {...rest}
      role="radiogroup"
      aria-label={label}
      className={cx("kimo-segmented", fill && "kimo-segmented--fill", className)}
    >
      {options.map((o, i) => {
        const checked = o.value === value
        return (
          // biome-ignore lint/a11y/useSemanticElements: APG radio group pattern with icon buttons.
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.icon != null ? o.label : undefined}
            title={o.icon != null ? o.label : undefined}
            disabled={o.disabled}
            tabIndex={i === focusable ? 0 : -1}
            className={cx(
              "kimo-segmented__segment",
              o.icon == null && "kimo-segmented__segment--text",
              checked && "kimo-segmented__segment--selected",
            )}
            onClick={() => !checked && onChange?.(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.icon != null ? (
              <span className="kimo-segmented__icon" aria-hidden="true">
                {o.icon}
              </span>
            ) : (
              <span className="kimo-segmented__label">{o.label}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
