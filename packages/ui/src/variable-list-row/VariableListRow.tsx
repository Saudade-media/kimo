import { Link2 } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"
import { TYPE_GLYPH_ICONS } from "../type-glyph/TypeGlyph"

/** Props for {@link VariableListRow}. Remaining `<div>` props go to the row. */
export interface VariableListRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** Variable name ("surface/base"). */
  name: string
  type: "color" | "number" | "string" | "boolean"
  /** Resolved value under the preview theme (hex without "#", "12", "ink-900"). */
  value: string
  /** Resolved CSS color for the swatch (color variables). */
  color?: string
  /** The value is an alias (`link-2` 10 after the value). */
  alias?: boolean
  /** Hover/selected fill (bg-hover). */
  selected?: boolean
}

/**
 * Left-panel Variables tab row. Mirrors `VariableListRow` (yB4CN): fill_container × 28,
 * radius-sm, row, gap 8, padding [0, 8], center. Lead (YvK47) 16 × 16 center: Swatch (NSFgQ)
 * 14 × 14, stroke 1 chip-edge, radius-xs — or Glyph (z6GTC) `hash` / `type` / `toggle-left` 12
 * text-tertiary · Name (iP6bu) mono 11 text-primary · Spacer · Value (WJLUV) mono 11
 * text-tertiary · Alias (zQn04) `link-2` 10 text-tertiary.
 */
export function VariableListRow({
  name,
  type,
  value,
  color,
  alias = false,
  selected = false,
  className,
  ...rest
}: VariableListRowProps) {
  const Glyph = TYPE_GLYPH_ICONS[type]
  return (
    <div
      {...rest}
      data-type={type}
      className={cx(
        "kimo-variable-list-row",
        selected && "kimo-variable-list-row--selected",
        className,
      )}
    >
      <span className="kimo-variable-list-row__lead" aria-hidden="true">
        {type === "color" ? (
          <span className="kimo-variable-list-row__swatch" style={{ backgroundColor: color }} />
        ) : (
          <Glyph className="kimo-variable-list-row__glyph" />
        )}
      </span>
      <span className="kimo-variable-list-row__name">{name}</span>
      <span className="kimo-variable-list-row__spacer" aria-hidden="true" />
      <span className="kimo-variable-list-row__value">{value}</span>
      {alias && <Link2 className="kimo-variable-list-row__alias" aria-label="alias" />}
    </div>
  )
}
