import { RotateCcw } from "lucide-react"
import { type ComponentPropsWithRef, useState } from "react"
import { cx } from "../internal/util"
import { TooltipHint } from "../tooltip-hint/TooltipHint"

/** Props for {@link OverrideDot}. Remaining `<span>` props go to the 12 × 12 frame. */
export interface OverrideDotProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  /** `false` → opacity 0; the dot keeps its 12px slot (InstancePropRow label cells). Default true. */
  visible?: boolean
  /**
   * Makes the dot a reset button: hover shows the Reset hint (board 11 `izW94`, a
   * `Tooltip/Hint` with `rotate-ccw` and an xs label) and click calls `onReset`.
   */
  onReset?: () => void
  /** Main value quoted in the hint: "Click to reset to main · “<resetValue>”". */
  resetValue?: string
  /**
   * Dot fill: `component` (an override, default) or `warning` (board 27 §8 Kpf1o: the layer row
   * of an instance with broken overrides — same 12 × 12 slot, Dot fill `warning`).
   */
  tone?: "component" | "warning"
}

/**
 * Override marker. Mirrors `OverrideDot` (rqoRv): 12 × 12 frame, center/center, child Dot
 * (T0yxdd) ellipse 6 × 6 fill `component`. Violet = component/instance identity only.
 */
export function OverrideDot({
  visible = true,
  onReset,
  resetValue,
  tone = "component",
  className,
  onPointerEnter,
  onPointerLeave,
  onClick,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: OverrideDotProps) {
  const [hint, setHint] = useState(false)
  const interactive = onReset !== undefined && visible
  const label =
    resetValue !== undefined ? `Click to reset to main · “${resetValue}”` : "Click to reset to main"
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the label is only set together with role="button".
    <span
      {...rest}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : undefined}
      aria-hidden={interactive ? undefined : true}
      className={cx(
        "kimo-override-dot",
        !visible && "kimo-override-dot--off",
        interactive && "kimo-override-dot--interactive",
        tone === "warning" && "kimo-override-dot--warning",
        className,
      )}
      onPointerEnter={(e) => {
        onPointerEnter?.(e)
        if (interactive) setHint(true)
      }}
      onPointerLeave={(e) => {
        onPointerLeave?.(e)
        setHint(false)
      }}
      onFocus={(e) => {
        onFocus?.(e)
        if (interactive) setHint(true)
      }}
      onBlur={(e) => {
        onBlur?.(e)
        setHint(false)
      }}
      onClick={(e) => {
        onClick?.(e)
        if (!interactive || e.defaultPrevented) return
        e.stopPropagation()
        setHint(false)
        onReset?.()
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (!interactive || e.defaultPrevented) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          setHint(false)
          onReset?.()
        }
      }}
    >
      <span className="kimo-override-dot__dot" />
      {hint && (
        <TooltipHint icon={<RotateCcw />} className="kimo-override-dot__hint">
          {label}
        </TooltipHint>
      )}
    </span>
  )
}
