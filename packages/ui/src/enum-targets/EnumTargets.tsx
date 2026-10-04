import { Minus, Plus } from "lucide-react"
import { useState } from "react"
import { IconButton } from "../icon-button/IconButton"
import { DraftInput } from "../internal/DraftInput"
import { cx } from "../internal/util"
import { PropTextField } from "../prop-field/PropTextField"
import { SegmentedText } from "../segmented-text/SegmentedText"
import { Select, type SelectOption } from "../select/Select"

/** One target row of the selected option: Layer × Property × Value (board 27 §8 a). */
export interface EnumTargetRow {
  /** Layer id (Select value). */
  layer: string
  /** Property key (Select value), one of `properties(layer)`. */
  property: string
  /** Displayed value ("8 · 14", "14", "$space/md"). */
  value: string
}

/** Props for {@link EnumTargets}. */
export interface EnumTargetsProps {
  /** Option names in declaration order (the Option tabs). */
  options: readonly string[]
  /** The option whose targets are shown. */
  option: string | null
  onOptionChange?: (option: string) => void
  /** "default: md" (the option the main is authored as), or "default: as authored". */
  defaultLabel: string
  /** Layer choices: the main's root and descendants. */
  layers: readonly SelectOption[]
  /** Property choices for a layer (filtered by its type). */
  properties: (layer: string) => readonly SelectOption[]
  rows: readonly EnumTargetRow[]
  /** Change one row; `null` removes it. */
  onRowChange?: (index: number, row: EnumTargetRow | null) => void
  onAddTarget?: () => void
  onAddOption?: () => void
  /** Rename an option; `null` (an empty name) removes it. */
  onRenameOption?: (option: string, to: string | null) => void
  readOnly?: boolean
  /** `data-*` hook for tests (`data-options`). */
  "data-options"?: string
}

/**
 * The per-option targets of an enum prop, rendered inside an enum PropDefRow after its Head.
 * Mirrors board 27 §8 (a) `e0wsU`:
 * - Options (BRh1V): row, gap 6, padding [0, 0, 0, 24], center: Label "Option" sans 11
 *   text-tertiary · Option tabs (SegmentedText FC6O7) · Default "default: md" mono 11
 *   text-tertiary. (+ an Add option IconButton 20 at the end; double-click the tabs to rename the
 *   selected option, an empty name removes it.)
 * - Targets · <option> (j7xiy): column, gap 6, padding [0, 0, 0, 24]: Head (QD3yo) row, gap 6 —
 *   Layer 120 · Property 120 · Value fill (sans 11, line-height 1.45, text-tertiary) · Pad 24 × 1;
 *   Target rows (N7qK6U) row, gap 6, center — Layer Select 120 · Property Select 120 · Value
 *   PropField fill (no prefix) · Remove IconButton 24, transparent, `minus` 14; Add target
 *   (s1tIIS) row, gap 6, padding [4, 0], center — `plus` 14 text-secondary · "Add target" sans 12
 *   text-secondary.
 * The 120 columns are 120 / 414 of the row's free width (exactly 120 at the design's 504-wide
 * panel), so the block keeps the design's proportions in the 280 right panel.
 */
export function EnumTargets({
  options,
  option,
  onOptionChange,
  defaultLabel,
  layers,
  properties,
  rows,
  onRowChange,
  onAddTarget,
  onAddOption,
  onRenameOption,
  readOnly = false,
  "data-options": dataOptions,
}: EnumTargetsProps) {
  const [renaming, setRenaming] = useState(false)
  return (
    <>
      <div className="kimo-enum-options" data-options={dataOptions}>
        <span className="kimo-enum-options__label">Option</span>
        {renaming && option !== null ? (
          // biome-ignore lint/a11y/noLabelWithoutControl: DraftInput renders the <input>.
          <label className="kimo-enum-options__rename">
            <DraftInput
              className="kimo-enum-options__rename-input"
              aria-label={`Rename option ${option}`}
              value={option}
              autoFocus
              onCommit={(to) => {
                setRenaming(false)
                const t = to.trim()
                if (t !== option) onRenameOption?.(option, t || null)
              }}
              onBlur={() => setRenaming(false)}
            />
          </label>
        ) : (
          <SegmentedText
            className="kimo-enum-options__tabs"
            label="Option"
            options={options.map((o) => ({ value: o, label: o }))}
            value={option}
            onChange={onOptionChange}
            onDoubleClick={() => !readOnly && setRenaming(true)}
          />
        )}
        <span className="kimo-enum-options__default">{defaultLabel}</span>
        <span className="kimo-enum-options__spacer" aria-hidden="true" />
        <IconButton
          className="kimo-enum-options__add"
          tone="quiet"
          label="Add option"
          icon={<Plus />}
          disabled={readOnly}
          onClick={onAddOption}
        />
      </div>
      <div className="kimo-enum-targets" data-option={option ?? ""}>
        <div className="kimo-enum-targets__head">
          <span className="kimo-enum-targets__col kimo-enum-targets__col--layer">Layer</span>
          <span className="kimo-enum-targets__col kimo-enum-targets__col--property">Property</span>
          <span className="kimo-enum-targets__col kimo-enum-targets__col--value">Value</span>
          <span className="kimo-enum-targets__pad" aria-hidden="true" />
        </div>
        {rows.map((r, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional within an option.
            key={i}
            className="kimo-enum-targets__row"
            data-target={`${r.layer}:${r.property}`}
          >
            <Select
              className="kimo-enum-targets__layer"
              label={`Target ${i + 1} layer`}
              options={layers}
              value={r.layer}
              disabled={readOnly}
              onChange={(layer) => onRowChange?.(i, { ...r, layer })}
            />
            <Select
              className="kimo-enum-targets__property"
              label={`Target ${i + 1} property`}
              options={properties(r.layer)}
              value={r.property}
              disabled={readOnly}
              onChange={(property) => onRowChange?.(i, { ...r, property })}
            />
            <PropTextField
              className="kimo-enum-targets__value"
              inputLabel={`Target ${i + 1} value`}
              value={r.value}
              disabled={readOnly}
              onCommit={(value) => {
                onRowChange?.(i, { ...r, value })
                return undefined
              }}
            />
            <IconButton
              className="kimo-enum-targets__remove"
              size="sm"
              tone="ghost"
              label={`Remove target ${i + 1}`}
              icon={<Minus />}
              disabled={readOnly}
              onClick={() => onRowChange?.(i, null)}
            />
          </div>
        ))}
        <button
          type="button"
          className={cx("kimo-enum-targets__add")}
          disabled={readOnly}
          onClick={onAddTarget}
        >
          <Plus className="kimo-enum-targets__add-icon" aria-hidden="true" />
          <span className="kimo-enum-targets__add-label">Add target</span>
        </button>
      </div>
    </>
  )
}
