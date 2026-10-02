import type { ComponentPropsWithRef, CSSProperties, KeyboardEvent } from "react"
import { usePointerDrag } from "../internal/drag"
import { clamp, cx } from "../internal/util"

/** Gesture bracketing shared by the sliders, ColorArea and GradientStopBar. */
export interface GestureProps {
  /** A drag or key press starts changing the value (open an undo group). */
  onChangeStart?: () => void
  /** The gesture ended (close the undo group). */
  onChangeEnd?: () => void
}

type DivProps = Omit<ComponentPropsWithRef<"div">, "onChange" | "children" | "defaultValue">

/** Thumb diameter; the thumb stays inside the track (its center travels 7 … width − 7). */
const THUMB = 14

/** CSS custom properties that place the thumb and fill at fraction `f` (0–1). */
const at = (f: number): CSSProperties =>
  ({ "--kimo-slider-f": String(clamp(f, 0, 1)) }) as CSSProperties

function keyStep(e: KeyboardEvent, step: number, range: number): number | "min" | "max" | null {
  const big = Math.max(step * 10, range / 10)
  switch (e.key) {
    case "ArrowRight":
    case "ArrowUp":
      return e.shiftKey ? big : step
    case "ArrowLeft":
    case "ArrowDown":
      return e.shiftKey ? -big : -step
    case "PageUp":
      return big
    case "PageDown":
      return -big
    case "Home":
      return "min"
    case "End":
      return "max"
    default:
      return null
  }
}

interface RangeCore extends GestureProps {
  value: number
  min: number
  max: number
  step: number
  onChange?: (v: number) => void
}

/** Pointer + keyboard behaviour of every horizontal slider. */
function useRange({ value, min, max, step, onChange, onChangeStart, onChangeEnd }: RangeCore) {
  const snap = (v: number) => {
    const s = Math.round((v - min) / step) * step + min
    return Number(clamp(s, min, max).toFixed(6))
  }
  const emit = (v: number) => {
    const next = snap(v)
    if (next !== value) onChange?.(next)
  }
  const drag = usePointerDrag<HTMLDivElement>({
    insetX: THUMB / 2,
    onStart: onChangeStart,
    onDrag: (s) => emit(min + s.fx * (max - min)),
    onEnd: onChangeEnd,
  })
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = keyStep(e, step, max - min)
    if (d === null) return
    e.preventDefault()
    onChangeStart?.()
    emit(d === "min" ? min : d === "max" ? max : value + d)
    onChangeEnd?.()
  }
  const f = max > min ? (value - min) / (max - min) : 0
  return { drag, onKeyDown, f }
}

/** Props for {@link Slider}. Remaining `<div>` props go to the frame. */
export interface SliderProps extends DivProps, GestureProps {
  value: number
  /** Default 0. */
  min?: number
  /** Default 1. */
  max?: number
  /** Default (max − min) / 100. */
  step?: number
  onChange?: (v: number) => void
  "aria-label": string
  /** `aria-valuetext`, e.g. `"400"`. */
  valueText?: string
}

/**
 * Value slider. Mirrors `Slider` (UWiq1): 224 × 14, absolute children. Track (Y9KX4) y 5, h 4,
 * pill, bg-muted; Fill (sBcG4) same, accent, up to the thumb center; Thumb (g0Ask) ellipse 14,
 * #FFFFFF, stroke 1 border-strong, shadow 0 1 3 shadow-strong. ←/→ step (Shift ×10),
 * PageUp/PageDown, Home/End.
 */
export function Slider({
  value,
  min = 0,
  max = 1,
  step,
  onChange,
  onChangeStart,
  onChangeEnd,
  valueText,
  className,
  style,
  ...rest
}: SliderProps) {
  const { drag, onKeyDown, f } = useRange({
    value,
    min,
    max,
    step: step ?? (max - min) / 100,
    onChange,
    onChangeStart,
    onChangeEnd,
  })
  return (
    <div
      {...rest}
      {...drag}
      role="slider"
      tabIndex={0}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-orientation="horizontal"
      className={cx("kimo-slider", className)}
      style={{ ...at(f), ...style }}
      onKeyDown={onKeyDown}
    >
      <span className="kimo-slider__track" />
      <span className="kimo-slider__fill" />
      <span className="kimo-slider__thumb" />
    </div>
  )
}

/** Props for {@link HueSlider}. */
export interface HueSliderProps extends DivProps, GestureProps {
  /** 0–360. */
  hue: number
  /** Thumb fill: the current color (opaque). */
  color: string
  onChange?: (h: number) => void
  /** Default `"Hue"`. */
  "aria-label"?: string
}

/**
 * Hue slider. Mirrors `Slider/Hue` (weqLa): 224 × 14. Track (kakaj) y 1, h 12, pill, stroke 1
 * chip-edge, linear gradient #FF0000 0 · #FFFF00 .17 · #00FF00 .33 · #00FFFF .5 · #0000FF .67 ·
 * #FF00FF .83 · #FF0000 1; Thumb (I4582f) ellipse 14, fill = color, stroke 2.5 #FFFFFF,
 * shadow 0 1 3 #0A0A0A40.
 */
export function HueSlider({
  hue,
  color,
  onChange,
  onChangeStart,
  onChangeEnd,
  className,
  style,
  "aria-label": label = "Hue",
  ...rest
}: HueSliderProps) {
  const { drag, onKeyDown, f } = useRange({
    value: hue,
    min: 0,
    max: 360,
    step: 1,
    onChange,
    onChangeStart,
    onChangeEnd,
  })
  return (
    <div
      {...rest}
      {...drag}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hue)}
      aria-valuetext={`${Math.round(hue)}°`}
      className={cx("kimo-slider", "kimo-slider--hue", className)}
      style={{ ...at(f), ...style }}
      onKeyDown={onKeyDown}
    >
      <span className="kimo-slider__track" />
      <span className="kimo-slider__thumb" style={{ backgroundColor: color }} />
    </div>
  )
}

/** Props for {@link AlphaSlider}. */
export interface AlphaSliderProps extends DivProps, GestureProps {
  /** 0–1. */
  alpha: number
  /** The opaque color (gradient end and thumb fill). */
  color: string
  onChange?: (a: number) => void
  /** Default `"Opacity"`. */
  "aria-label"?: string
}

/**
 * Alpha slider. Mirrors `Slider/Alpha` (qpmcK): 224 × 14. Track (A62mZE) frame y 1, h 12,
 * clip, #FFFFFF, pill, stroke 1 chip-edge → Checker (rp05o, #E4E2DE 4px squares) and Gradient
 * (C4KYVj, color at alpha 0 → color, left → right); Thumb (o6DokA) as Hue.
 */
export function AlphaSlider({
  alpha,
  color,
  onChange,
  onChangeStart,
  onChangeEnd,
  className,
  style,
  "aria-label": label = "Opacity",
  ...rest
}: AlphaSliderProps) {
  const { drag, onKeyDown, f } = useRange({
    value: alpha,
    min: 0,
    max: 1,
    step: 0.01,
    onChange,
    onChangeStart,
    onChangeEnd,
  })
  return (
    <div
      {...rest}
      {...drag}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(alpha * 100)}
      aria-valuetext={`${Math.round(alpha * 100)}%`}
      className={cx("kimo-slider", "kimo-slider--alpha", className)}
      style={{ ...at(f), ...style }}
      onKeyDown={onKeyDown}
    >
      <span className="kimo-slider__track">
        <span className="kimo-slider__checker" />
        <span
          className="kimo-slider__gradient"
          style={{ backgroundImage: `linear-gradient(to right, transparent, ${color})` }}
        />
      </span>
      <span className="kimo-slider__thumb" style={{ backgroundColor: color }} />
    </div>
  )
}
