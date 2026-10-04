import { Check, Minus } from "lucide-react"
import { type ComponentPropsWithRef, type ReactNode, useEffect, useRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link PanelIconToggle}. Native `<button>` props pass through. */
export interface PanelIconToggleProps
  extends Omit<ComponentPropsWithRef<"button">, "children" | "onChange"> {
  /** Accessible name (the button shows only the icon). */
  label: string
  /** 14 × 14 lucide icon (colored with `currentColor`). */
  icon: ReactNode
  /** On: `bg-muted` fill + `text-primary` icon. Sets `aria-pressed`. */
  pressed: boolean
  /** 28 (flip / wrap, beside a PropField) or 24 (paint row blend, beside the eye). Default 28. */
  size?: 28 | 24
  /**
   * The off look: `"subtle"` = `bg-subtle` fill + `text-secondary` icon (Flip vertical T4K2F);
   * `"clear"` = no fill + `text-tertiary` icon (paint row Blend r7ZOxn). Default `"subtle"`.
   */
  rest?: "subtle" | "clear"
}

/**
 * Panel icon toggle (board 27 §6): an `IconButton` (ZMxjt) instance — radius-md, centered
 * 14 px icon — whose fill marks the state: Flip H / V (IFtI5 / T4K2F, 28), Wrap (JIb4r, 28,
 * `text-wrap`), paint Blend (F1NkuB / r7ZOxn, 24, `blend`). Hover (off) = `bg-hover`.
 */
export function PanelIconToggle({
  label,
  icon,
  pressed,
  size = 28,
  rest = "subtle",
  className,
  type = "button",
  ...props
}: PanelIconToggleProps) {
  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cx(
        "kimo-panel-icon-toggle",
        size === 24 && "kimo-panel-icon-toggle--24",
        rest === "clear" && "kimo-panel-icon-toggle--clear",
        pressed && "kimo-panel-icon-toggle--on",
        className,
      )}
    >
      <span className="kimo-panel-icon-toggle__icon" aria-hidden="true">
        {icon}
      </span>
    </button>
  )
}

/** Props for {@link PanelCheckbox}. */
export interface PanelCheckboxProps
  extends Omit<ComponentPropsWithRef<"label">, "children" | "onChange"> {
  label: string
  /** `"mixed"` = indeterminate dash (mixed selection). */
  checked: boolean | "mixed"
  onChange: (checked: boolean) => void
  disabled?: boolean
}

/**
 * Panel checkbox row (board 27 §6 (a) "Checkbox · Clip content" atlT6): row, gap 8, center →
 * Box (V3Zqy) 14 × 14 radius 3, checked fill `accent` with lucide `check` 10 `on-accent`
 * (mixed: `minus`), off a 1.5 px `border-strong` ring (ConfirmDialog checkbox) · Label (H3rh3)
 * sans `text-sm` normal `text-primary`. A native checkbox (transparent, over the Box) takes
 * the input; mixed → on.
 */
export function PanelCheckbox({
  label,
  checked,
  onChange,
  disabled = false,
  className,
  ...rest
}: PanelCheckboxProps) {
  const input = useRef<HTMLInputElement>(null)
  const on = checked === true
  useEffect(() => {
    if (input.current) input.current.indeterminate = checked === "mixed"
  }, [checked])
  return (
    <label {...rest} className={cx("kimo-panel-checkbox", className)}>
      <span
        className={cx(
          "kimo-panel-checkbox__box",
          checked !== false && "kimo-panel-checkbox__box--on",
        )}
      >
        <input
          ref={input}
          type="checkbox"
          className="kimo-panel-checkbox__input"
          checked={on}
          disabled={disabled}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
        {checked === "mixed" ? <Minus aria-hidden="true" /> : on && <Check aria-hidden="true" />}
      </span>
      <span className="kimo-panel-checkbox__label">{label}</span>
    </label>
  )
}

/** Props for {@link PaintBlendChip}. */
export interface PaintBlendChipProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** Mode label ("Multiply"). */
  label: string
}

/**
 * The mode chip under a paint row with a non-normal blend (board 27 §6 (c) "Blend chip" FC2in):
 * frame fill, padding [0, 0, 0, 24] → Chip (I5CR0) `bg-muted`, radius-xs, padding [1, 6] →
 * Label sans `text-xs` normal `text-secondary`.
 */
export function PaintBlendChip({ label, className, ...rest }: PaintBlendChipProps) {
  return (
    <div {...rest} className={cx("kimo-paint-blend-chip", className)}>
      <span className="kimo-paint-blend-chip__chip">{label}</span>
    </div>
  )
}
