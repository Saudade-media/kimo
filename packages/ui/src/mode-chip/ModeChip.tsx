import { ChevronDown, Columns2, LayoutGrid, MessageSquare, Repeat } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** The four modes (board 22 "Modes"). */
export type AgentModeId = "single" | "side-by-side" | "split" | "iterate"

/** Mode icons by their exact design names (ModeOption instances in d5X1eG). */
export const MODE_ICONS = {
  single: MessageSquare,
  "side-by-side": Columns2,
  split: LayoutGrid,
  iterate: Repeat,
} as const

/** Props for {@link ModeChip}. Remaining `<button>` props go to the chip. */
export interface ModeChipProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  mode: AgentModeId
  /** "Single", "Side by side · 3", "Split · 3", "Iterate · 3". */
  label: string
  /** The mode menu is open (aria-expanded). */
  open?: boolean
}

/**
 * The composer's mode chip. Mirrors `ModeChip` (qBbwC): h 24, gap 4, padding [0, 8, 0, 6],
 * center, fill agent-soft, radius-pill › Icon (lfq38) 12 agent › Label (XQtSh) sans 11 / 500
 * agent › Chevron (Xvj19) chevron-down 12 agent. Single (Composer/Agent SzC72): fill bg-muted,
 * icon message-square text-secondary, label text-secondary, chevron text-tertiary.
 */
export function ModeChip({
  mode,
  label,
  open,
  className,
  type = "button",
  ...rest
}: ModeChipProps) {
  const Icon = MODE_ICONS[mode]
  return (
    <button
      {...rest}
      type={type}
      aria-haspopup="menu"
      aria-expanded={open}
      data-mode={mode}
      className={cx("kimo-mode-chip", mode === "single" && "kimo-mode-chip--single", className)}
    >
      <Icon className="kimo-mode-chip__icon" aria-hidden="true" />
      <span className="kimo-mode-chip__label">{label}</span>
      <ChevronDown className="kimo-mode-chip__chevron" aria-hidden="true" />
    </button>
  )
}
