import { Layers2 } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { AliasChip } from "../alias-chip/AliasChip"
import { cx } from "../internal/util"
import { SwatchTile } from "../swatch-tile/SwatchTile"
import { Toggle } from "../toggle/Toggle"

/** The value a cell shows (one axis-value column of one variable). */
export type VarCellValue =
  | { kind: "color"; color: string; label: string }
  | { kind: "number"; label: string }
  | { kind: "string"; label: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "alias"; name: string }
  | { kind: "empty" }

/** Props for {@link VarCell}. Remaining `<div>` props go to the cell. */
export interface VarCellProps
  extends Omit<ComponentPropsWithRef<"div">, "children" | "onChange" | "onToggle"> {
  value: VarCellValue
  /** Shows `layers-2` (Multi): the value comes from a multi-axis entry. Color / number only. */
  multi?: boolean
  /** `VarCell/Color · editing` (b8Koy): bg-app, stroke 1.5 selection, radius-sm. */
  editing?: boolean
  /** Color swatch click (open the color popover). */
  onSwatchClick?: () => void
  /** Alias chip click (open the Alias Picker). */
  onAliasClick?: () => void
  /** Boolean toggle. */
  onToggle?: (value: boolean) => void
  /** Accessible name prefix for the inner controls ("surface/page · light"). */
  label?: string
}

/**
 * Variable value cell (Variables dialog column, entry value). Mirrors `VarCell/Color` (iCQwv),
 * `/Number` (U8aZ2J), `/String` (MEKrO), `/Boolean` (pxZFa), `/Alias` (xn5O9), `/Empty`
 * (OJlJp): 150 × 36, row, gap 8, padding [0, 8], center.
 * Color: Swatch (SwatchTile 18, padding 1) · Value mono 11 · Multi `layers-2` 10 text-tertiary.
 * Number: Value mono 11 · Multi. String: Value sans 12. Boolean: Toggle · Value mono 11
 * text-secondary. Alias: AliasChip. Empty: "—" sans 12 text-tertiary (no entry: falls back).
 */
export function VarCell({
  value,
  multi = false,
  editing = false,
  onSwatchClick,
  onAliasClick,
  onToggle,
  label = "Value",
  className,
  ...rest
}: VarCellProps) {
  return (
    <div
      {...rest}
      data-kind={value.kind}
      className={cx("kimo-var-cell", editing && "kimo-var-cell--editing", className)}
    >
      {value.kind === "color" && (
        <>
          <SwatchTile
            size={18}
            color={value.color}
            aria-label={`${label}: ${value.label}`}
            onClick={onSwatchClick}
          />
          <span className="kimo-var-cell__value kimo-var-cell__value--mono">{value.label}</span>
        </>
      )}
      {value.kind === "number" && (
        <span className="kimo-var-cell__value kimo-var-cell__value--mono">{value.label}</span>
      )}
      {value.kind === "string" && <span className="kimo-var-cell__value">{value.label}</span>}
      {value.kind === "boolean" && (
        <>
          <Toggle label={label} checked={value.value} onChange={onToggle} />
          <span className="kimo-var-cell__value kimo-var-cell__value--mono kimo-var-cell__value--secondary">
            {String(value.value)}
          </span>
        </>
      )}
      {value.kind === "alias" && <AliasChip name={value.name} onClick={onAliasClick} />}
      {value.kind === "empty" && (
        <span
          className="kimo-var-cell__value kimo-var-cell__value--empty"
          title="No entry: falls back"
        >
          —
        </span>
      )}
      {multi && (value.kind === "color" || value.kind === "number") && (
        <Layers2 className="kimo-var-cell__multi" aria-label="Multi-axis entry" />
      )}
    </div>
  )
}

/**
 * "all themes" tag of a variable with one value for every theme (Variables dialog rows
 * `H7v50h`/`j5Ba3a`/`rlzdm`): padding [1, 5], fill bg-muted, radius-xs; mono 10 text-tertiary.
 */
export function AllThemesTag({ className, ...rest }: ComponentPropsWithRef<"span">) {
  return (
    <span {...rest} className={cx("kimo-all-themes-tag", className)}>
      <span className="kimo-all-themes-tag__label">all themes</span>
    </span>
  )
}
