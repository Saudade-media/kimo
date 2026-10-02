import { type ComponentPropsWithRef, type KeyboardEvent, useRef } from "react"
import { cx } from "../internal/util"

/** A main/cross-axis position of the 3 × 3 grid. */
export type GridAlign = "start" | "center" | "end"
/** Main-axis distribution as stored in `.kimo` (`between`/`around`/`evenly` leave no cell active). */
export type GridJustify = GridAlign | "between" | "around" | "evenly"

/** Props for {@link AlignmentGrid}. Remaining `<div>` props go to the frame. */
export interface AlignmentGridProps
  extends Omit<ComponentPropsWithRef<"div">, "onChange" | "children" | "dir"> {
  /** Layout direction: rows are the cross axis for `"row"`, the main axis for `"column"`. */
  dir: "row" | "column"
  justify: GridJustify
  align: GridAlign
  onChange?: (v: { justify: GridAlign; align: GridAlign }) => void
  /** Accessible name of the radio group. Default `"Alignment"`. */
  label?: string
}

const AXIS: readonly GridAlign[] = ["start", "center", "end"]
const ROWS = ["Top", "Middle", "Bottom"] as const
const COLS = ["Left", "Center", "Right"] as const

/** Grid cell (row, col) of a justify/align pair, or null when the distribution has no cell. */
export function alignmentCell(
  dir: "row" | "column",
  justify: GridJustify,
  align: GridAlign,
): { row: number; col: number } | null {
  const j = AXIS.indexOf(justify as GridAlign)
  const a = AXIS.indexOf(align)
  if (j < 0 || a < 0) return null
  return dir === "row" ? { row: a, col: j } : { row: j, col: a }
}

/** Inverse of {@link alignmentCell}. */
export function cellAlignment(
  dir: "row" | "column",
  row: number,
  col: number,
): { justify: GridAlign; align: GridAlign } {
  const r = AXIS[row] ?? "start"
  const c = AXIS[col] ?? "start"
  return dir === "row" ? { justify: c, align: r } : { justify: r, align: c }
}

/**
 * 3 × 3 justify/align picker of the Auto layout section. Mirrors `AlignmentGrid` (i1pQK):
 * fill_container × 64, bg-subtle, radius-sm, vertical, padding [4, 8], space-between; three
 * rows (xdx2v / q0HLow / S6hP0) fill, space-between, center; cells 24 × 16, radius-xs,
 * center/center, holding a Dot (ellipse 3, text-tertiary) or, for the active cell, Bars (h 12,
 * gap 2: rects 2 × 6 / 2 × 10 / 2 × 6, radius 1, accent; aligned top / center / bottom by row).
 * A radio group: ←↑→↓ move and select, Home/End jump to the corners.
 */
export function AlignmentGrid({
  dir,
  justify,
  align,
  onChange,
  label = "Alignment",
  className,
  ...rest
}: AlignmentGridProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const active = alignmentCell(dir, justify, align)
  // Roving tab stop: the active cell, else the first cell of the current cross-axis line.
  const fallback = alignmentCell(dir, "start", align) ?? { row: 0, col: 0 }
  const tabStop = active ?? fallback

  const select = (row: number, col: number) => {
    refs.current[row * 3 + col]?.focus()
    const next = cellAlignment(dir, row, col)
    if (!active || active.row !== row || active.col !== col) onChange?.(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, row: number, col: number) => {
    let r = row
    let c = col
    switch (e.key) {
      case "ArrowUp":
        r = Math.max(0, row - 1)
        break
      case "ArrowDown":
        r = Math.min(2, row + 1)
        break
      case "ArrowLeft":
        c = Math.max(0, col - 1)
        break
      case "ArrowRight":
        c = Math.min(2, col + 1)
        break
      case "Home":
        r = 0
        c = 0
        break
      case "End":
        r = 2
        c = 2
        break
      default:
        return
    }
    e.preventDefault()
    select(r, c)
  }

  return (
    <div
      {...rest}
      role="radiogroup"
      aria-label={label}
      className={cx("kimo-alignment-grid", className)}
    >
      {ROWS.map((rowName, row) => (
        <div key={rowName} className="kimo-alignment-grid__row">
          {COLS.map((colName, col) => {
            const on = active?.row === row && active.col === col
            const name = row === 1 && col === 1 ? "Center" : `${rowName} ${colName.toLowerCase()}`
            return (
              // biome-ignore lint/a11y/useSemanticElements: APG radio group pattern with buttons.
              <button
                key={colName}
                ref={(el) => {
                  refs.current[row * 3 + col] = el
                }}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={name}
                tabIndex={tabStop.row === row && tabStop.col === col ? 0 : -1}
                className={cx("kimo-alignment-grid__cell", on && "kimo-alignment-grid__cell--on")}
                onClick={() => select(row, col)}
                onKeyDown={(e) => onKeyDown(e, row, col)}
              >
                {on ? (
                  <span
                    className={cx(
                      "kimo-alignment-grid__bars",
                      `kimo-alignment-grid__bars--${AXIS[row]}`,
                    )}
                    aria-hidden="true"
                  >
                    <span className="kimo-alignment-grid__bar kimo-alignment-grid__bar--short" />
                    <span className="kimo-alignment-grid__bar kimo-alignment-grid__bar--long" />
                    <span className="kimo-alignment-grid__bar kimo-alignment-grid__bar--short" />
                  </span>
                ) : (
                  <span className="kimo-alignment-grid__dot" aria-hidden="true" />
                )}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
