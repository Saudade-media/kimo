import { Library, RotateCcw, Rows3, SunMoon } from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { IconButton } from "../icon-button/IconButton"
import { cx } from "../internal/util"
import { Select, type SelectOption } from "../select/Select"

/** Axis icon (ADR 0011): `mode` → `sun-moon`, other local axes → `rows-3`, `alias:axis` → `library`. */
export function axisIcon(axis: string): ReactNode {
  if (axis.includes(":")) return <Library />
  return axis === "mode" ? <SunMoon /> : <Rows3 />
}

const INHERIT = "\u0000inherit"

/** Props for {@link ThemePinRow}. Remaining `<div>` props go to the row. */
export interface ThemePinRowProps
  extends Omit<ComponentPropsWithRef<"div">, "children" | "onChange"> {
  /** "mode", "density", "ui:mode". */
  axis: string
  /** The axis's values in order. */
  values: readonly string[]
  /** Pinned value; `null` = inherit. */
  pinned: string | null
  /** Effective value from the parent chain ("light"); shown as "Inherit · light". */
  inherited?: string
  /** setThemePin (real node) / setOverride theme (inside an instance); `null` unpins. */
  onChange?: (value: string | null) => void
  /** Overrides the 12px axis icon. */
  icon?: ReactNode
}

/**
 * Theme pin of one axis (right panel Theme section). Mirrors `ThemePinRow` (Lamcg):
 * fill_container × 28, row, gap 8, center. Axis Cell (blp2E) row, gap 6, width 96, center:
 * Icon 12 text-tertiary + Axis mono 11 (text-secondary; pinned text-primary) · Value (Rvy1c:
 * Select fill; "Inherit · <value>" text-tertiary when not pinned) · Reset (COjHI: IconButton
 * 24, transparent, `rotate-ccw` 14 text-tertiary, opacity 0 when not pinned).
 */
export function ThemePinRow({
  axis,
  values,
  pinned,
  inherited,
  onChange,
  icon,
  className,
  ...rest
}: ThemePinRowProps) {
  const inheritLabel = inherited ? `Inherit · ${inherited}` : "Inherit"
  const options: SelectOption[] = [
    { value: INHERIT, label: inheritLabel },
    ...values.map((v) => ({ value: v, label: v })),
  ]
  return (
    <div
      {...rest}
      className={cx(
        "kimo-theme-pin-row",
        pinned !== null && "kimo-theme-pin-row--pinned",
        className,
      )}
    >
      <span className="kimo-theme-pin-row__axis-cell">
        <span className="kimo-theme-pin-row__icon" aria-hidden="true">
          {icon ?? axisIcon(axis)}
        </span>
        <span className="kimo-theme-pin-row__axis">{axis}</span>
      </span>
      <Select
        className="kimo-theme-pin-row__value"
        label={`${axis} theme`}
        options={options}
        value={pinned}
        placeholder={inheritLabel}
        onChange={(v) => onChange?.(v === INHERIT ? null : v)}
      />
      <IconButton
        className="kimo-theme-pin-row__reset"
        size="sm"
        tone="quiet"
        label={`Unpin ${axis}`}
        icon={<RotateCcw />}
        disabled={pinned === null}
        tabIndex={pinned === null ? -1 : undefined}
        onClick={() => onChange?.(null)}
      />
    </div>
  )
}
