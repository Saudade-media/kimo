import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link ProgressTrack}. Remaining `<div>` props go to the frame. */
export interface ProgressTrackProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** 0…1. */
  value: number
  /** Line under the track ("Writing 2 of 3 · ~/loom/src/components"). */
  label: string
}

/**
 * Determinate progress. Mirrors `Progress` (ZxZlz): column fill, gap 6 › Track (gJqt8) fill ×
 * 4, bg-muted, radius-pill › Fill (oSC9C) accent, radius 999 · Label sans 11 text-secondary.
 */
export function ProgressTrack({ value, label, className, ...rest }: ProgressTrackProps) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return (
    <div {...rest} className={cx("kimo-progress", className)}>
      <div
        className="kimo-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v * 100)}
        aria-label={label}
      >
        <div className="kimo-progress__fill" style={{ width: `${v * 100}%` }} />
      </div>
      <span className="kimo-progress__label">{label}</span>
    </div>
  )
}
