import {
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import { clamp, cx } from "../internal/util"

/** Props for {@link PropField}. Remaining `<div>` props go to the frame. */
export interface PropFieldProps
  extends Omit<ComponentPropsWithRef<"div">, "onChange" | "children" | "prefix"> {
  /**
   * Prefix label (`W`, `H`, `X`, …) or a 12 × 12 icon (board 08 replaces the Prefix text with a
   * lucide icon, e.g. Opacity `blend`, Rotation `rotate-cw`). Drag it horizontally to scrub.
   */
  prefix: ReactNode
  /** Current value. A string shows a keyword (`Hug`, `Mixed`) instead of a number. */
  value: number | string
  /** Called with the new value: on Enter/blur commit, arrow keys and every scrub step. */
  onChange?: (value: number) => void
  /** Scrub gesture start/end (lets the host group the steps into one undo entry). */
  onScrubStart?: () => void
  onScrubEnd?: () => void
  /** Value change per px of drag / per arrow press. Default 1. Shift ×10, Alt ×0.1. */
  step?: number
  min?: number
  max?: number
  /** Decimal places kept. Default 2 (trailing zeros dropped). */
  precision?: number
  /** Scrub start value when `value` is a keyword. Default 0. */
  scrubFrom?: number
  /**
   * Relative mode for keyword values (`Mixed` across a multi-selection): when set and `value`
   * is not a number, ↑/↓ report `±step` and a scrub reports its total offset since the press,
   * instead of absolute values from `scrubFrom`, so the host can shift each value by it.
   */
  onDelta?: (delta: number) => void
  /** Accessible name of the input. Defaults to `prefix`. */
  inputLabel?: string
  disabled?: boolean
  /**
   * Rendered after the value, inside the frame: board 27 §7 `PropField/Bindable` (LFrgQ) puts
   * its Bind Button here (with `kimo-prop-field--bindable` on the frame).
   */
  trailing?: ReactNode
}

const parse = (text: string): number | undefined => {
  const t = text.trim().replace(",", ".")
  if (t === "") return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

const multiplier = (e: { shiftKey: boolean; altKey: boolean }) =>
  e.shiftKey ? 10 : e.altKey ? 0.1 : 1

/**
 * Numeric property field. Mirrors `PropField` (A9DDs): fill_container × 28, bg-subtle,
 * radius-sm, padding [0, 8], gap 8; prefix mono 11 text-tertiary; value sans 12 text-primary.
 * Scrub by dragging the prefix; ↑/↓ nudge (Shift ×10, Alt ×0.1); Enter commits; Escape reverts.
 */
export function PropField({
  prefix,
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
  step = 1,
  min,
  max,
  precision = 2,
  scrubFrom = 0,
  onDelta,
  inputLabel,
  disabled = false,
  trailing,
  className,
  ...rest
}: PropFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const scrub = useRef<{
    x: number
    from: number
    last: number
    pointer: number
    relative: boolean
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Set by Escape so the blur that follows does not commit the abandoned draft. */
  const cancelled = useRef(false)

  const round = (n: number) => Number(clamp(n, min, max).toFixed(precision))
  const display = typeof value === "number" ? String(round(value)) : value
  const numeric = typeof value === "number" ? value : undefined
  const relative = numeric === undefined && onDelta !== undefined

  // A scrub must always end: if the field unmounts mid-scrub (selection change, section
  // hidden), report the end so the host closes its undo group.
  const scrubEnd = useRef(onScrubEnd)
  scrubEnd.current = onScrubEnd
  useEffect(
    () => () => {
      if (scrub.current) {
        scrub.current = null
        scrubEnd.current?.()
      }
    },
    [],
  )

  const emit = (n: number) => {
    const next = round(n)
    if (next !== numeric) onChange?.(next)
    return next
  }

  const commit = () => {
    if (draft === null) return
    const n = parse(draft)
    if (n !== undefined) emit(n)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      commit()
      setDraft(null)
      e.currentTarget.select()
    } else if (e.key === "Escape") {
      e.preventDefault()
      cancelled.current = true
      setDraft(null)
      e.currentTarget.blur()
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault()
      const dir = e.key === "ArrowUp" ? 1 : -1
      // Relative while the field still shows its keyword (nothing numeric typed).
      if (relative && (draft === null || parse(draft) === undefined)) {
        onDelta?.(Number((dir * step * multiplier(e)).toFixed(precision)))
        setDraft(null)
        return
      }
      const base = (draft !== null ? parse(draft) : undefined) ?? numeric ?? scrubFrom
      const next = emit(base + dir * step * multiplier(e))
      setDraft(String(next))
    }
  }

  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const from = relative ? 0 : (numeric ?? scrubFrom)
    scrub.current = { x: e.clientX, from, last: from, pointer: e.pointerId, relative }
    setScrubbing(true)
    setDraft(null)
    inputRef.current?.blur()
    onScrubStart?.()
  }

  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    const s = scrub.current
    if (!s || s.pointer !== e.pointerId) return
    const dx = Math.round(e.clientX - s.x)
    if (s.relative) {
      const delta = Number((dx * step * multiplier(e)).toFixed(precision))
      if (delta !== s.last) {
        s.last = delta
        onDelta?.(delta)
      }
      return
    }
    const next = round(s.from + dx * step * multiplier(e))
    if (next !== s.last) {
      s.last = next
      onChange?.(next)
    }
  }

  const endScrub = (e: PointerEvent<HTMLSpanElement>) => {
    const s = scrub.current
    if (!s || s.pointer !== e.pointerId) return
    scrub.current = null
    setScrubbing(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    onScrubEnd?.()
  }

  return (
    <div
      {...rest}
      className={cx(
        "kimo-prop-field",
        scrubbing && "kimo-prop-field--scrubbing",
        disabled && "kimo-prop-field--disabled",
        className,
      )}
    >
      <span
        className={cx(
          "kimo-prop-field__prefix",
          typeof prefix !== "string" && "kimo-prop-field__prefix--icon",
        )}
        aria-hidden="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onLostPointerCapture={endScrub}
      >
        {prefix}
      </span>
      <input
        ref={inputRef}
        className="kimo-prop-field__value"
        type="text"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        aria-label={inputLabel ?? (typeof prefix === "string" ? prefix : undefined)}
        disabled={disabled}
        value={draft ?? display}
        onFocus={(e) => {
          setDraft(display)
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
      {trailing}
    </div>
  )
}
