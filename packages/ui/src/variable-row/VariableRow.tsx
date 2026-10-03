import { ChevronDown, Ellipsis, Layers2, TriangleAlert } from "lucide-react"
import type { ComponentPropsWithRef, CSSProperties, ReactNode } from "react"
import { cx } from "../internal/util"
import { type GlyphType, TypeGlyph } from "../type-glyph/TypeGlyph"

/** Props for {@link VariableRow}. Remaining `<div>` props go to the row. */
export interface VariableRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  name: string
  type: Extract<GlyphType, "color" | "number" | "string" | "boolean">
  /** One VarCell per axis-value column (axes in display order), or an AllThemesTag. */
  values: ReactNode
  /** Values for every theme at once (AllThemesTag rows): Values gets gap 8 and `valuesWidth`. */
  uniform?: boolean
  /** Width of the Values block in a uniform row (columns × 150). */
  valuesWidth?: number
  /** Entries list open: Disclosure `chevron-down` shown, fill bg-hover, menu visible. */
  expanded?: boolean
  /** Forces the hover look (`Koxnr`: fill bg-hover, menu visible), e.g. while its menu is open. */
  highlighted?: boolean
  /** THEME_NO_MATCH under the previewed theme: `triangle-alert` 12 warning with this message. */
  lint?: string
  /** Name Cell width: 240 (02c specimen) or 216 (Variables dialog). */
  nameWidth?: number
  /** Row menu (Edit details…, Show entries, Move to group…, Duplicate, Delete). */
  onMenu?: (anchor: HTMLElement) => void
  /** Disclosure click (toggle the entries list). */
  onToggleEntries?: () => void
}

/**
 * Variables dialog row. Mirrors `VariableRow` (ejBTe): 880 (dialog: fill) × 36, row, padding
 * [0, 8, 0, 0], center, stroke bottom 1 border. Name Cell (F2PpG) row, gap 8, padding
 * [0, 8, 0, 12], width 240, center: Disclosure (esuNz `chevron-down` 12 text-tertiary, open
 * rows only) · TypeGlyph (ug3QR) · Name (PVpHs) mono 11 · Lint (SqNTB `triangle-alert` 12
 * warning). Values (vqZcj) row, center: VarCells. Spacer · Menu (Z2AwH) `ellipsis` 14
 * text-tertiary, opacity 0 until hover. Hover / open: fill bg-hover.
 */
export function VariableRow({
  name,
  type,
  values,
  uniform = false,
  valuesWidth,
  expanded = false,
  highlighted = false,
  lint,
  nameWidth = 240,
  onMenu,
  onToggleEntries,
  className,
  ...rest
}: VariableRowProps) {
  const valuesStyle: CSSProperties | undefined =
    uniform && valuesWidth !== undefined ? { width: valuesWidth } : undefined
  return (
    <div
      {...rest}
      className={cx(
        "kimo-variable-row",
        (expanded || highlighted) && "kimo-variable-row--expanded",
        className,
      )}
    >
      <div className="kimo-variable-row__name-cell" style={{ width: nameWidth }}>
        {expanded && (
          <button
            type="button"
            className="kimo-variable-row__disclosure"
            aria-label="Hide entries"
            aria-expanded
            onClick={onToggleEntries}
          >
            <ChevronDown aria-hidden="true" />
          </button>
        )}
        <TypeGlyph type={type} />
        <span className="kimo-variable-row__name">{name}</span>
        {lint !== undefined && (
          <TriangleAlert className="kimo-variable-row__lint" role="img" aria-label={lint}>
            <title>{lint}</title>
          </TriangleAlert>
        )}
      </div>
      <div
        className={cx("kimo-variable-row__values", uniform && "kimo-variable-row__values--uniform")}
        style={valuesStyle}
      >
        {values}
      </div>
      <span className="kimo-variable-row__spacer" aria-hidden="true" />
      <button
        type="button"
        className="kimo-variable-row__menu"
        aria-label={`${name} options`}
        onClick={(e) => onMenu?.(e.currentTarget)}
      >
        <Ellipsis aria-hidden="true" />
      </button>
    </div>
  )
}

/** Props for {@link ModeColumnHeader}. Remaining `<div>` props go to the header. */
export interface ModeColumnHeaderProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** Axis value ("light"). */
  value: string
  /** First value of its axis: shows the "default" tag (VhSDT). */
  isDefault?: boolean
  /** Column Menu (Make default, Rename value, Duplicate value, Delete value). Omit to hide. */
  onMenu?: (anchor: HTMLElement) => void
}

/**
 * Column header for one axis value. Mirrors `ModeColumnHeader` (MhpFW): 150 × 32, row, gap 6,
 * padding [0, 8], center, stroke bottom 1 border. Value (dnWjO) sans 11 / 600 text-primary ·
 * Default Tag (VhSDT: padding [0, 4], fill bg-muted, radius-xs; mono 11 text-tertiary
 * "default") · Spacer · Menu (tf2C4) `ellipsis` 14 text-tertiary.
 */
export function ModeColumnHeader({
  value,
  isDefault = false,
  onMenu,
  className,
  ...rest
}: ModeColumnHeaderProps) {
  return (
    <div {...rest} className={cx("kimo-mode-column-header", className)}>
      <span className="kimo-mode-column-header__value">{value}</span>
      {isDefault && (
        <span className="kimo-mode-column-header__default">
          <span className="kimo-mode-column-header__default-label">default</span>
        </span>
      )}
      <span className="kimo-mode-column-header__spacer" aria-hidden="true" />
      {onMenu && (
        <button
          type="button"
          className="kimo-mode-column-header__menu"
          aria-label={`${value} column options`}
          onClick={(e) => onMenu(e.currentTarget)}
        >
          <Ellipsis aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** Props for {@link AxisGroupHeader}. Remaining `<div>` props go to the header. */
export interface AxisGroupHeaderProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  axis: string
  /** Number of values (columns) under this header. Width = count × 150. */
  count: number
  /** 12px icon; default lucide `layers-2` (density: `rows-3`). */
  icon?: ReactNode
}

/**
 * Header spanning one theme axis's value columns. Mirrors `AxisGroupHeader` (E6DjdE): 300 × 24
 * (count × 150), row, gap 6, padding [0, 8], center. Icon (h6b7o) `layers-2` 12 text-tertiary ·
 * Axis (VEB5T) mono 11 / 500 text-secondary · Count (a3UcT) sans 11 text-tertiary "2 values".
 */
export function AxisGroupHeader({
  axis,
  count,
  icon,
  className,
  style,
  ...rest
}: AxisGroupHeaderProps) {
  return (
    <div
      {...rest}
      className={cx("kimo-axis-group-header", className)}
      style={{ width: count * 150, ...style }}
    >
      <span className="kimo-axis-group-header__icon" aria-hidden="true">
        {icon ?? <Layers2 />}
      </span>
      <span className="kimo-axis-group-header__axis">{axis}</span>
      <span className="kimo-axis-group-header__count">
        {count === 1 ? "1 value" : `${count} values`}
      </span>
    </div>
  )
}
