import { Eye, EyeOff, Minus } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { ColorField } from "../color-field/ColorField"
import { IconButton } from "../icon-button/IconButton"
import { cx } from "../internal/util"

/** Props for {@link FillRow}. Remaining `<div>` props go to the row frame. */
export interface FillRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** CSS background of the 16 × 16 swatch: a color, a gradient or a `url()`. */
  swatch: string
  /** `F4A261` | `Linear` | `Image · Cover` | `brand/sand`. */
  label: string
  /** Hex = `"mono"` (default); kinds and variable names = `"sans"` (`vBwVv`). */
  labelFont?: "mono" | "sans"
  /** `"80%"`. Omit to hide. */
  opacity?: string
  visible: boolean
  /** Its popover is open (`H3Grs`): field bg-hover + stroke 1 border-strong. */
  active?: boolean
  /** Remove shown; otherwise opacity 0 with its 24px kept (`FFtaO` opacity 0). Default true. */
  removable?: boolean
  onOpen?: () => void
  onToggleVisible?: () => void
  onRemove?: () => void
  /** Accessible name prefix, e.g. `"Fill 1"`. Default `label`. */
  name?: string
}

/**
 * Fill / stroke paint row. Mirrors `FillRow` (xYqbE): fill_container, row, gap 2, center:
 * Field (chrvk) = `ColorField` fill · Eye (r3MBc) IconButton 24, transparent, `eye` / `eye-off`
 * 14 text-tertiary · Remove (FFtaO) IconButton 24, `minus` 14 text-tertiary.
 * Hidden paint (`X5R2J`): Field opacity 0.45, Eye `eye-off`.
 */
export function FillRow({
  swatch,
  label,
  labelFont = "mono",
  opacity,
  visible,
  active = false,
  removable = true,
  onOpen,
  onToggleVisible,
  onRemove,
  name,
  className,
  ...rest
}: FillRowProps) {
  const who = name ?? label
  return (
    <div {...rest} className={cx("kimo-fill-row", !visible && "kimo-fill-row--hidden", className)}>
      <ColorField
        className="kimo-fill-row__field"
        color={swatch}
        swatchBackground={swatch}
        value={label}
        valueFont={labelFont}
        opacity={opacity}
        highlight={active ? "active" : undefined}
        swatchLabel={`Edit ${who}`}
        swatchProps={{ "aria-haspopup": "dialog", "aria-expanded": active }}
        onSwatchClick={(e) => {
          e.stopPropagation()
          onOpen?.()
        }}
        onClick={() => onOpen?.()}
      />
      <IconButton
        className="kimo-fill-row__eye"
        label={visible ? `Hide ${who}` : `Show ${who}`}
        icon={visible ? <Eye /> : <EyeOff />}
        size="sm"
        tone="quiet"
        onClick={onToggleVisible}
      />
      <IconButton
        className={cx("kimo-fill-row__remove", !removable && "kimo-fill-row__remove--hidden")}
        label={`Remove ${who}`}
        icon={<Minus />}
        size="sm"
        tone="quiet"
        tabIndex={removable ? undefined : -1}
        aria-hidden={removable ? undefined : true}
        disabled={!removable}
        onClick={onRemove}
      />
    </div>
  )
}
