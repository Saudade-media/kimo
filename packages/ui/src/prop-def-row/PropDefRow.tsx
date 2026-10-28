import { Crosshair, Lock, Minus, RotateCcw } from "lucide-react"
import type { ComponentPropsWithRef, HTMLAttributes, ReactNode } from "react"
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
  /**
   * Board 27 §8 (a): an enum prop with per-option targets has no Binding row; its Options and
   * Targets blocks ({@link EnumTargets}) render after the Head instead.
   */
  hideBinding?: boolean
  /** Rendered after the Head (and the Binding row, when shown). */
  children?: ReactNode
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
  hideBinding = false,
  children,
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
      {!hideBinding && (
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
      )}
      {children}
    </div>
  )
}
