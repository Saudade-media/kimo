import { Redo2, Undo2 } from "lucide-react"
import type { ComponentPropsWithRef, KeyboardEvent } from "react"
import { cx } from "../internal/util"

/** Tool-line tone (rule "States"). */
export type ActivityTone = "default" | "agent" | "danger" | "warning"

/** Props for {@link ActivityRow}. Remaining `<div>` props go to the row. */
export interface ActivityRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** "10:47". */
  time: string
  /** Call label or tool summary ("Restyle pricing cards"). */
  label: string
  /** "kimo_apply_ops · 6 ops", "PERMISSION_DENIED · denied by you". */
  tool: string
  /** "Card 2 +3 · k9·38 → k9·43". */
  target: string
  /** Pending approval: agent-soft row, agent tool line. */
  tone?: ActivityTone
  pending?: boolean
  /** Undo this entry (omitted: no Undo button, e.g. reads, exports, denials). */
  onUndo?: () => void
  /** Guarded replay found nothing to undo: Undo dims to 40%. */
  stale?: boolean
  /** Click / Enter: select and scroll to the targets. */
  onActivate?: () => void
  /**
   * Undone (board 24 vignette h, d8Vjj1): fill bg-subtle, label struck through in tertiary,
   * target tertiary; pass `tool` as "Undone by you · 10:52". The action becomes Redo.
   */
  undone?: boolean
  /** Redo an undone entry (redo-2). */
  onRedo?: () => void
}

/**
 * One activity entry. Mirrors `ActivityRow` (R7zb80): row, gap 10, padding [10, 12],
 * fill_container, bottom stroke 1 border. Time (d7qv9g) 36 mono 11 text-tertiary · Text (pnhEg)
 * column gap 3 fill: Label (lQxhQ) sans 12 / 500 · Tool (PPms1) mono 11 text-secondary · Target
 * (aegZN) mono 11 text-tertiary · Undo (ECru2) IconButton 24, fill #00000000, undo-2 14
 * text-secondary. Hover: bg-hover (s8L4Rd). Pending: agent-soft (hIHR9). Undone (board 24
 * d8Vjj1): bg-subtle, label + target text-tertiary (label struck through), Redo (redo-2).
 */
export function ActivityRow({
  time,
  label,
  tool,
  target,
  tone = "default",
  pending = false,
  onUndo,
  stale = false,
  onActivate,
  undone = false,
  onRedo,
  className,
  onKeyDown,
  ...rest
}: ActivityRowProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: the row holds its own Undo button.
    <div
      role="button"
      tabIndex={0}
      {...rest}
      data-tone={tone}
      data-stale={stale || undefined}
      data-undone={undone || undefined}
      className={cx(
        "kimo-activity-row",
        pending && "kimo-activity-row--pending",
        undone && "kimo-activity-row--undone",
        tone !== "default" && `kimo-activity-row--${tone}`,
        className,
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".kimo-activity-row__undo")) return
        onActivate?.()
      }}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(e)
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onActivate?.()
        }
      }}
    >
      <span className="kimo-activity-row__time">{time}</span>
      <span className="kimo-activity-row__text">
        <span className="kimo-activity-row__label">{label}</span>
        <span className="kimo-activity-row__tool">{tool}</span>
        <span className="kimo-activity-row__target">{target}</span>
      </span>
      {undone && onRedo && (
        <button
          type="button"
          className="kimo-activity-row__undo"
          aria-label="Redo"
          onClick={onRedo}
        >
          <Redo2 aria-hidden="true" />
        </button>
      )}
      {!undone && onUndo && (
        <button
          type="button"
          className="kimo-activity-row__undo"
          aria-label={stale ? "Undo (stale)" : "Undo"}
          onClick={onUndo}
        >
          <Undo2 aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
