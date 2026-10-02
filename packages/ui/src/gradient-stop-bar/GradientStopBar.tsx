import { type ComponentPropsWithRef, type KeyboardEvent, type PointerEvent, useRef } from "react"
import { clamp, cx, mergeRefs } from "../internal/util"
import type { GestureProps } from "../slider/Slider"

export interface GradientStop {
  /** Any CSS color (document data). */
  color: string
  /** Position 0–1. */
  at: number
}

/** Props for {@link GradientStopBar}. Remaining `<div>` props go to the frame. */
export interface GradientStopBarProps
  extends Omit<ComponentPropsWithRef<"div">, "onSelect" | "children">,
    GestureProps {
  stops: readonly GradientStop[]
  /** Index of the selected stop. */
  selected: number
  onSelect?: (i: number) => void
  /** Drag (or ←/→ on a focused stop) along the axis. */
  onMove?: (i: number, at: number) => void
  /** Click on the bar outside a stop. */
  onAdd?: (at: number) => void
  /** Delete / Backspace on a focused stop (hosts keep at least two stops). */
  onRemove?: (i: number) => void
  /** Default `"Gradient stops"`. */
  label?: string
}

/** Stop chip width; stops travel x = at × (width − 16). */
const STOP = 16

/** CSS `linear-gradient` of stops, left → right. */
export function stopsGradient(stops: readonly GradientStop[]): string {
  const sorted = [...stops].sort((a, b) => a.at - b.at)
  return `linear-gradient(to right, ${sorted
    .map((s) => `${s.color} ${Math.round(s.at * 10000) / 100}%`)
    .join(", ")})`
}

/**
 * Gradient stop editor. Mirrors `GradientStopBar` (rbnJS): 224 × 36, absolute. Bar (i6ppu)
 * 224 × 24 at (0, 0), clip, #FFFFFF, radius-sm, stroke 1 border-strong → Checker (#E4E2DE) +
 * Gradient (stops left → right). Stops at y 18, x = at × (224 − 16): 16 × 16, #FFFFFF,
 * radius-xs, stroke 1 border-strong (selected: 2 selection), shadow 0 1 3 shadow-strong,
 * padding 3 → Color (radius-2xs).
 * Click the bar to add a stop, drag a stop to move it (one gesture), ←/→ nudge 1% (Shift 10%),
 * Delete/Backspace remove.
 */
export function GradientStopBar({
  stops,
  selected,
  onSelect,
  onMove,
  onAdd,
  onRemove,
  onChangeStart,
  onChangeEnd,
  label = "Gradient stops",
  className,
  ref,
  ...rest
}: GradientStopBarProps) {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; index: number } | null>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const atOf = (clientX: number) => {
    const r = root.current?.getBoundingClientRect()
    if (!r) return 0
    return Number(
      clamp((clientX - r.left - STOP / 2) / Math.max(1, r.width - STOP), 0, 1).toFixed(4),
    )
  }

  const stopDown = (e: PointerEvent<HTMLButtonElement>, i: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.focus({ preventScroll: true })
    if (i !== selected) onSelect?.(i)
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { pointer: e.pointerId, index: i }
    onChangeStart?.()
  }
  const stopMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d || d.pointer !== e.pointerId) return
    const at = atOf(e.clientX)
    if (at !== stops[d.index]?.at) onMove?.(d.index, at)
  }
  const stopUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d || d.pointer !== e.pointerId) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    onChangeEnd?.()
  }
  const stopKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const s = stops[i]
    if (!s) return
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault()
      onRemove?.(i)
      return
    }
    const step = e.shiftKey ? 0.1 : 0.01
    let at: number | null = null
    if (e.key === "ArrowRight" || e.key === "ArrowUp") at = s.at + step
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") at = s.at - step
    else if (e.key === "Home") at = 0
    else if (e.key === "End") at = 1
    if (at === null) return
    e.preventDefault()
    onChangeStart?.()
    onMove?.(i, Number(clamp(at, 0, 1).toFixed(4)))
    onChangeEnd?.()
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group of stop sliders.
    <div
      {...rest}
      ref={mergeRefs(root, ref)}
      role="group"
      aria-label={label}
      className={cx("kimo-gradient-stop-bar", className)}
    >
      <div
        className="kimo-gradient-stop-bar__bar"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          onAdd?.(atOf(e.clientX))
        }}
      >
        <span className="kimo-gradient-stop-bar__checker" />
        <span
          className="kimo-gradient-stop-bar__gradient"
          style={{ backgroundImage: stopsGradient(stops) }}
        />
      </div>
      {stops.map((s, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: stops are positional (document order).
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="slider"
          aria-label={`Stop ${i + 1}, ${s.color}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(s.at * 100)}
          aria-valuetext={`${Math.round(s.at * 100)}%`}
          aria-current={i === selected || undefined}
          tabIndex={i === selected ? 0 : -1}
          className={cx(
            "kimo-gradient-stop-bar__stop",
            i === selected && "kimo-gradient-stop-bar__stop--selected",
          )}
          style={{ left: `calc(${clamp(s.at, 0, 1)} * (100% - ${STOP}px))` }}
          onPointerDown={(e) => stopDown(e, i)}
          onPointerMove={stopMove}
          onPointerUp={stopUp}
          onPointerCancel={stopUp}
          onLostPointerCapture={stopUp}
          onFocus={() => i !== selected && onSelect?.(i)}
          onKeyDown={(e) => stopKey(e, i)}
        >
          <span className="kimo-gradient-stop-bar__color" style={{ backgroundColor: s.color }} />
        </button>
      ))}
    </div>
  )
}
