import {
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
  useRef,
  useState,
} from "react"
import { cx } from "../internal/util"

/** Props for {@link PropTextField}. Remaining `<div>` props go to the frame. */
export interface PropTextFieldProps
  extends Omit<ComponentPropsWithRef<"div">, "onChange" | "children" | "prefix"> {
  /**
   * Prefix text (`#`) or a 12 × 12 icon; omit for the prefix-less instances (`jXquz` disabled:
   * Opacity, Position).
   */
  prefix?: ReactNode
  /** Displayed value (`F4A261`, `100%`, `55%`). */
  value: string
  /**
   * Enter / blur with an edited value. Return `false` to reject it (the field reverts); the
   * host parses the text (hex, percent, channel triplets).
   */
  onCommit?: (text: string) => boolean | undefined
  /** Accessible name of the input. */
  inputLabel: string
  disabled?: boolean
}

/**
 * Text variant of `PropField` (A9DDs) for non-numeric values: the same frame (fill × 28,
 * bg-subtle, radius-sm, padding [0, 8], gap 8; prefix mono 11 text-tertiary; value sans 12
 * text-primary). Used by the color picker's Hex (`AqBJI`) and Opacity (`aaHXu`) fields, gradient
 * stop Position (`X0q4f5`) and the image fill Opacity (`OVyIC`). Enter commits, Escape reverts.
 */
export function PropTextField({
  prefix,
  value,
  onCommit,
  inputLabel,
  disabled = false,
  className,
  ...rest
}: PropTextFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)

  const commit = () => {
    if (draft === null || draft === value) return
    onCommit?.(draft.trim())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      commit()
      setDraft(null)
      e.currentTarget.select()
    } else if (e.key === "Escape") {
      // Revert this field only; a second Escape (no draft) reaches the popover and closes it.
      if (draft === null) return
      e.preventDefault()
      e.stopPropagation()
      cancelled.current = true
      setDraft(null)
      e.currentTarget.blur()
    }
  }

  return (
    <div
      {...rest}
      className={cx("kimo-prop-field", disabled && "kimo-prop-field--disabled", className)}
    >
      {prefix != null && (
        <span
          className={cx(
            "kimo-prop-field__prefix kimo-prop-field__prefix--static",
            typeof prefix !== "string" && "kimo-prop-field__prefix--icon",
          )}
          aria-hidden="true"
        >
          {prefix}
        </span>
      )}
      <input
        className="kimo-prop-field__value"
        type="text"
        spellCheck={false}
        autoComplete="off"
        aria-label={inputLabel}
        disabled={disabled}
        value={draft ?? value}
        onFocus={(e) => {
          setDraft(value)
          e.currentTarget.select()
        }}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => {
          if (!cancelled.current) commit()
          cancelled.current = false
          setDraft(null)
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
