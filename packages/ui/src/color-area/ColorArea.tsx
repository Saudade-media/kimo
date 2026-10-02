import type { ComponentPropsWithRef, CSSProperties, KeyboardEvent } from "react"
import { hueColor } from "../color/color"
import { usePointerDrag } from "../internal/drag"
import { clamp, cx } from "../internal/util"
import type { GestureProps } from "../slider/Slider"

/** Props for {@link ColorArea}. Remaining `<div>` props go to the frame. */
export interface ColorAreaProps
  extends Omit<ComponentPropsWithRef<"div">, "onChange" | "children" | "color">,
    GestureProps {
  /** 0–360: the area's base fill is the pure hue. */
  hue: number
  /** HSV saturation 0–1 (x). */
  saturation: number
  /** HSV value 0–1 (1 − y). */
  value: number
  /** Ring fill: the current color (opaque). */
  color: string
  onChange?: (sv: { saturation: number; value: number }) => void
  /** Default `"Saturation and brightness"`. */
  "aria-label"?: string
}

/**
 * Saturation/brightness area. Mirrors `ColorArea` (H5QKDe): 224 × 160, clip, radius-sm, fill =
 * pure hue; Saturation (P4xJV) #FFFFFF → #FFFFFF00 left → right; Brightness (h99I2) #00000000 →
 * #000000 top → bottom; Picker Ring (phbmP) ellipse 14, fill = color, stroke 2.5 #FFFFFF,
 * shadow 0 1 3 #0A0A0A59, centered on (s × w, (1 − v) × h).
 * Pointer drag (one gesture), arrows ±1% (Shift ±10%) on s (←/→) and v (↑/↓).
 */
export function ColorArea({
  hue,
  saturation,
  value,
  color,
  onChange,
  onChangeStart,
  onChangeEnd,
  className,
  style,
  "aria-label": label = "Saturation and brightness",
  ...rest
}: ColorAreaProps) {
  const emit = (s: number, v: number) => {
    const S = clamp(s, 0, 1)
    const V = clamp(v, 0, 1)
    if (S !== saturation || V !== value) onChange?.({ saturation: S, value: V })
  }
  const drag = usePointerDrag<HTMLDivElement>({
    onStart: onChangeStart,
    onDrag: (p) => emit(p.fx, 1 - p.fy),
    onEnd: onChangeEnd,
  })
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.shiftKey ? 0.1 : 0.01
    let s = saturation
    let v = value
    if (e.key === "ArrowRight") s += d
    else if (e.key === "ArrowLeft") s -= d
    else if (e.key === "ArrowUp") v += d
    else if (e.key === "ArrowDown") v -= d
    else return
    e.preventDefault()
    onChangeStart?.()
    emit(Number(s.toFixed(4)), Number(v.toFixed(4)))
    onChangeEnd?.()
  }
  const pct = (n: number) => `${Math.round(n * 100)}%`
  return (
    <div
      {...rest}
      {...drag}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(saturation * 100)}
      aria-valuetext={`Saturation ${pct(saturation)}, brightness ${pct(value)}`}
      className={cx("kimo-color-area", className)}
      style={
        {
          backgroundColor: hueColor(hue),
          "--kimo-color-area-x": String(clamp(saturation, 0, 1)),
          "--kimo-color-area-y": String(1 - clamp(value, 0, 1)),
          ...style,
        } as CSSProperties
      }
      onKeyDown={onKeyDown}
    >
      <span className="kimo-color-area__saturation" />
      <span className="kimo-color-area__brightness" />
      <span className="kimo-color-area__ring" style={{ backgroundColor: color }} />
    </div>
  )
}
