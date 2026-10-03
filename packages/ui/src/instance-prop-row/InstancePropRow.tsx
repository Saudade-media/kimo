import { SquareDashed, Type, X } from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { Button } from "../button/Button"
import { IconButton } from "../icon-button/IconButton"
import { InstanceSwapField } from "../instance-swap-field/InstanceSwapField"
import { DraftInput } from "../internal/DraftInput"
import { cx } from "../internal/util"
import { OverrideDot } from "../override-dot/OverrideDot"
import type { PropType } from "../prop-def-row/PropDefRow"
import { Select } from "../select/Select"
import { Toggle } from "../toggle/Toggle"

/** Props for {@link InstancePropRow}. Remaining `<div>` props go to the row. */
export interface InstancePropRowProps
  extends Omit<ComponentPropsWithRef<"div">, "children" | "onChange"> {
  prop: { name: string; type: PropType }
  /** The instance sets this arg (slot: the slot override exists): dot on, label text-primary. */
  overridden: boolean
  /**
   * Effective value: text → string, boolean → boolean, enum → option name, instance → component
   * name. Unused for slots.
   */
  value?: string | boolean
  /** Enum option names. */
  options?: readonly string[]
  /** Slot: number of owned children ("2 children"). */
  slotCount?: number
  /** Instance: 12px preview inside the swap field. */
  preview?: ReactNode
  /** Main's value quoted by the dot's Reset hint. */
  mainValue?: string
  /** setArgs({ [name]: value }). Instance props: open the Swap Popover (`onSwap`) instead. */
  onChange?: (value: string | boolean) => void
  /** Dot click: setArgs({ [name]: undefined }) / resetOverride(slot). */
  onReset?: () => void
  /** Instance: the swap field was clicked (open the Swap Popover anchored to it). */
  onSwap?: (anchor: HTMLElement) => void
  /** Slot: select the owned nodes. */
  onSelectContent?: () => void
  /** Slot: empty the slot (keeps the override). */
  onClearContent?: () => void
}

/**
 * Instance property row (right panel, Properties section). Mirrors `InstancePropRow/Text`
 * (iYH5j), `/Boolean` (YSJLM), `/Enum` (ztxNk), `/Instance` (CpeMN), `/Slot` (ddT4A):
 * fill_container × 28, row, gap 8, center. Label Cell (row, gap 2, width 84, center): Override
 * (OverrideDot, opacity 0 unless overridden) + Label mono 11 (text-secondary; overridden
 * text-primary). Controls: Text Field (row, gap 6, padding [0, 8], fill × 28, bg-subtle,
 * radius-sm: `type` 12 text-tertiary + Value sans 12) · Boolean: Spacer + Toggle · Enum: Select
 * fill · Instance: InstanceSwapField fill · Slot Content (row, gap 6, fill × 28):
 * `square-dashed` 12 component · Meta sans 12 text-secondary · Spacer · Select (Button/Ghost,
 * h 24, padding [0, 6], label 11) · Clear (IconButton 24, `x` 12).
 */
export function InstancePropRow({
  prop,
  overridden,
  value,
  options = [],
  slotCount = 0,
  preview,
  mainValue,
  onChange,
  onReset,
  onSwap,
  onSelectContent,
  onClearContent,
  className,
  ...rest
}: InstancePropRowProps) {
  const { name, type } = prop
  return (
    <div
      {...rest}
      data-type={type}
      className={cx(
        "kimo-instance-prop-row",
        overridden && "kimo-instance-prop-row--overridden",
        className,
      )}
    >
      <span className="kimo-instance-prop-row__label-cell">
        <OverrideDot visible={overridden} onReset={onReset} resetValue={mainValue} />
        <span className="kimo-instance-prop-row__label">{name}</span>
      </span>
      {type === "text" && (
        // biome-ignore lint/a11y/noLabelWithoutControl: DraftInput renders the <input>.
        <label className="kimo-instance-prop-row__field">
          <Type className="kimo-instance-prop-row__field-icon" aria-hidden="true" />
          <DraftInput
            className="kimo-instance-prop-row__value"
            aria-label={name}
            value={typeof value === "string" ? value : ""}
            onCommit={onChange}
          />
        </label>
      )}
      {type === "boolean" && (
        <>
          <span className="kimo-instance-prop-row__spacer" aria-hidden="true" />
          <Toggle label={name} checked={value === true} onChange={(v) => onChange?.(v)} />
        </>
      )}
      {type === "enum" && (
        <Select
          className="kimo-instance-prop-row__select"
          label={name}
          options={options.map((o) => ({ value: o, label: o }))}
          value={typeof value === "string" ? value : null}
          onChange={(v) => onChange?.(v)}
        />
      )}
      {type === "instance" && (
        <InstanceSwapField
          className="kimo-instance-prop-row__swap"
          value={typeof value === "string" ? value : ""}
          preview={preview}
          onClick={(e) => onSwap?.(e.currentTarget)}
        />
      )}
      {type === "slot" && (
        <span className="kimo-instance-prop-row__content">
          <SquareDashed className="kimo-instance-prop-row__content-icon" aria-hidden="true" />
          <span className="kimo-instance-prop-row__meta">
            {slotCount === 1 ? "1 child" : `${slotCount} children`}
          </span>
          <span className="kimo-instance-prop-row__spacer" aria-hidden="true" />
          <Button
            variant="ghost"
            className="kimo-instance-prop-row__select-content"
            disabled={slotCount === 0}
            onClick={onSelectContent}
          >
            Select
          </Button>
          <IconButton
            className="kimo-instance-prop-row__clear"
            size="sm"
            tone="quiet"
            label={`Clear ${name}`}
            icon={<X />}
            disabled={slotCount === 0}
            onClick={onClearContent}
          />
        </span>
      )}
    </div>
  )
}
