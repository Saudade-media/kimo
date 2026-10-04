import { Check } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"
import { type AgentModeId, MODE_ICONS } from "../mode-chip/ModeChip"

/** Props for {@link ModeOption}. Remaining `<button>` props go to the row. */
export interface ModeOptionProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  mode: AgentModeId
  name: string
  description: string
  checked?: boolean
  /** Keyboard / pointer highlight: bg-hover (NIIY8). */
  highlighted?: boolean
}

/**
 * One mode in the mode menu. Mirrors `ModeOption` (leX10): row fill_container, gap 10, padding 8,
 * radius-sm › Tile (xhNUb) 28 × 28 center, fill agent-soft, radius-sm, Icon (m2RV7) 14 agent ›
 * Text (i3APr) column fill, gap 2: Name (MTHEE) sans 12 / 500 text-primary · Desc (qyR7W) sans 11
 * text-secondary, line height 1.4 › Check (F9baR) 14 text-primary. Single (wK090): tile bg-muted,
 * icon text-secondary.
 */
export function ModeOption({
  mode,
  name,
  description,
  checked = false,
  highlighted = false,
  className,
  type = "button",
  ...rest
}: ModeOptionProps) {
  const Icon = MODE_ICONS[mode]
  return (
    <button
      {...rest}
      type={type}
      role="menuitemradio"
      aria-checked={checked}
      data-highlighted={highlighted || undefined}
      data-mode={mode}
      className={cx("kimo-mode-option", mode === "single" && "kimo-mode-option--single", className)}
    >
      <span className="kimo-mode-option__tile" aria-hidden="true">
        <Icon className="kimo-mode-option__icon" />
      </span>
      <span className="kimo-mode-option__text">
        <span className="kimo-mode-option__name">{name}</span>
        <span className="kimo-mode-option__desc">{description}</span>
      </span>
      {checked && <Check className="kimo-mode-option__check" aria-hidden="true" />}
    </button>
  )
}
