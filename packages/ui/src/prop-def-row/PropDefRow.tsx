import { ArrowRight, Crosshair, Lock, Minus, Plus, RotateCcw } from "lucide-react"
import type { ComponentPropsWithRef, HTMLAttributes } from "react"
import { IconButton } from "../icon-button/IconButton"
import { DraftInput } from "../internal/DraftInput"
import { cx } from "../internal/util"
import { PropTextField } from "../prop-field/PropTextField"
import { Select, type SelectOption } from "../select/Select"
import { TypeGlyph } from "../type-glyph/TypeGlyph"

/** Declared component prop types (spec §9.6). */
export type PropType = "text" | "boolean" | "enum" | "instance" | "slot"

export const PROP_TYPE_OPTIONS: readonly SelectOption<PropType>[] = [
  { value: "text", label: "Text" },
  { value: "boolean", label: "Boolean" },
  { value: "enum", label: "Enum" },
  { value: "instance", label: "Instance" },
  { value: "slot", label: "Slot" },
]

/** Props for {@link PropDefRow}. Remaining `<div>` props go to the row. */
export interface PropDefRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  name: string
  type: PropType
  /** Target display: "<layer name> · <field>" ("Label · content", "Root · pad"). */
  target: string
  /** Default field ("= …"); omit for slot / enum props (no Default field). */
  defaultValue?: string
  /**
   * `own` (Remove `minus`), `inherited` (derived component: opacity 0.55, `lock`, read-only),
   * `redeclared` (full opacity, `rotate-ccw` drops the redeclaration). Board 12 `PsEAB`.
   */
  state?: "own" | "inherited" | "redeclared"
  onRename?: (name: string) => void
  onTypeChange?: (type: PropType) => void
  onPickTarget?: () => void
  onDefaultCommit?: (value: string) => void
  /** own: removeProp · redeclared: removeProp (falls back to the base declaration). */
  onRemove?: () => void
  /** Spread on the Type Glyph, the row's drag handle (reorder → reorderProp). */
  dragHandleProps?: HTMLAttributes<HTMLSpanElement>
}

/**
 * Component prop definition. Mirrors `PropDefRow` (VqB97): fill_container, column, gap 6,
 * padding [8, 0], stroke bottom 1 border.
 * Head (ZnnUs) row, gap 6, center: TypeGlyph (KBBi8) · Name Field (bhiaB: fill × 28, bg-subtle,
 * radius-sm, padding [0, 8]; mono 11) · Type (Y1b1v7: Select, width 92) · Remove (E7ep1u:
 * IconButton 24, transparent, `minus` 14 text-tertiary).
 * Binding (pVWiu) row, gap 6, padding [0, 0, 0, 24], center: Target (Q6ffKn: PropField, fill,
 * prefix `crosshair` 12 text-tertiary) · Default (LqiP8: PropField, fill, prefix "=").
 */
export function PropDefRow({
  name,
  type,
  target,
  defaultValue,
  state = "own",
  onRename,
  onTypeChange,
  onPickTarget,
  onDefaultCommit,
  onRemove,
  dragHandleProps,
  className,
  ...rest
}: PropDefRowProps) {
  const locked = state === "inherited"
  return (
    <div
      {...rest}
      data-state={state}
      className={cx("kimo-prop-def-row", locked && "kimo-prop-def-row--inherited", className)}
    >
      <div className="kimo-prop-def-row__head">
        <TypeGlyph
          type={type}
          {...dragHandleProps}
          className={cx("kimo-prop-def-row__glyph", dragHandleProps?.className)}
        />
        {/* biome-ignore lint/a11y/noLabelWithoutControl: DraftInput renders the <input>. */}
        <label className="kimo-prop-def-row__name-field">
          <DraftInput
            className="kimo-prop-def-row__name"
            aria-label="Prop name"
            value={name}
            disabled={locked}
            onCommit={onRename}
          />
        </label>
        <Select
          className="kimo-prop-def-row__type"
          label="Prop type"
          options={PROP_TYPE_OPTIONS}
          value={type}
          disabled={locked}
          onChange={onTypeChange}
        />
        <IconButton
          className="kimo-prop-def-row__remove"
          size="sm"
          tone="quiet"
          label={
            state === "inherited"
              ? "Inherited from the base component"
              : state === "redeclared"
                ? "Reset to the base declaration"
                : "Remove prop"
          }
          icon={
            state === "inherited" ? <Lock /> : state === "redeclared" ? <RotateCcw /> : <Minus />
          }
          disabled={locked}
          onClick={onRemove}
        />
      </div>
      <div className="kimo-prop-def-row__binding">
        <button
          type="button"
          className="kimo-prop-field kimo-prop-def-row__target"
          aria-label={`Target: ${target}`}
          disabled={locked}
          onClick={onPickTarget}
        >
          <span
            className="kimo-prop-field__prefix kimo-prop-field__prefix--static kimo-prop-field__prefix--icon"
            aria-hidden="true"
          >
            <Crosshair />
          </span>
          <span className="kimo-prop-field__value kimo-prop-def-row__target-value">{target}</span>
        </button>
        {defaultValue !== undefined && (
          <PropTextField
            className="kimo-prop-def-row__default"
            prefix="="
            inputLabel="Default value"
            value={defaultValue}
            disabled={locked}
            onCommit={(v) => {
              onDefaultCommit?.(v)
              return undefined
            }}
          />
        )}
      </div>
    </div>
  )
}

/** One enum option: its name and the value it applies to the target ("8 16"). */
export interface PropOption {
  name: string
  value: string
}

/** Props for {@link PropOptions}. Remaining `<div>` props go to the block. */
export interface PropOptionsProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** Target field shown in the title and as each value's prefix ("pad"). */
  field: string
  options: readonly PropOption[]
  /** Change one option; `null` removes it. */
  onOptionChange?: (index: number, option: PropOption | null) => void
  onAddOption?: () => void
  readOnly?: boolean
}

/**
 * Enum options block under an enum PropDefRow. Mirrors board 12 `ClRT2`: fill_container,
 * column, gap 4, padding [0, 0, 8, 24], stroke bottom 1 border. Options Header (Njt1D) h 20,
 * row, gap 6, center: Title "Options → <field>" sans 11 / 600 text-tertiary · Spacer · Hint "no
 * arg → as authored" sans 11 text-tertiary · Add option (IconButton 20, `plus` 12). Option rows
 * (MRqYG) h 28, row, gap 6, center: Name Field (56 × 28, bg-subtle, radius-sm, padding [0, 8];
 * mono 11) · Arrow `arrow-right` 12 text-tertiary · Value (PropField fill, prefix = field, value
 * mono 11) · Remove (IconButton 24, `minus` 14).
 */
export function PropOptions({
  field,
  options,
  onOptionChange,
  onAddOption,
  readOnly = false,
  className,
  ...rest
}: PropOptionsProps) {
  return (
    <div {...rest} className={cx("kimo-prop-options", className)}>
      <div className="kimo-prop-options__header">
        <span className="kimo-prop-options__title">{`Options → ${field}`}</span>
        <span className="kimo-prop-options__spacer" aria-hidden="true" />
        <span className="kimo-prop-options__hint">no arg → as authored</span>
        <IconButton
          className="kimo-prop-options__add"
          tone="quiet"
          label="Add option"
          icon={<Plus />}
          disabled={readOnly}
          onClick={onAddOption}
        />
      </div>
      {options.map((o, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: options are positional (renaming must keep focus).
        <div className="kimo-prop-options__option" key={i}>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: DraftInput renders the <input>. */}
          <label className="kimo-prop-options__name-field">
            <DraftInput
              className="kimo-prop-options__name"
              aria-label={`Option ${i + 1} name`}
              value={o.name}
              disabled={readOnly}
              onCommit={(name) => onOptionChange?.(i, { ...o, name })}
            />
          </label>
          <ArrowRight className="kimo-prop-options__arrow" aria-hidden="true" />
          <PropTextField
            className="kimo-prop-options__value"
            prefix={field}
            inputLabel={`Option ${o.name} value`}
            value={o.value}
            disabled={readOnly}
            onCommit={(value) => {
              onOptionChange?.(i, { ...o, value })
              return undefined
            }}
          />
          <IconButton
            className="kimo-prop-options__remove"
            size="sm"
            tone="quiet"
            label={`Remove option ${o.name}`}
            icon={<Minus />}
            disabled={readOnly}
            onClick={() => onOptionChange?.(i, null)}
          />
        </div>
      ))}
    </div>
  )
}
