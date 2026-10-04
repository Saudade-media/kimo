import { Info, Search, X } from "lucide-react"
import { type ComponentPropsWithRef, Fragment, useId, useRef } from "react"
import { IconButton } from "../icon-button/IconButton"
import { Input } from "../input/Input"
import { cx, mergeRefs } from "../internal/util"
import { Kbd } from "../kbd/Kbd"
import { useFocusTrap } from "../popover/usePopover"
import { SegmentedText, type SegmentedTextOption } from "../segmented-text/SegmentedText"

/** Board 25 §7 (c) WcWPY: Dialog 1040 px. */
export const SHORTCUTS_SHEET_WIDTH = 1040

/** One action row (Row · <Action>): label, optional "new" badge, its combos ("or" between). */
export interface ShortcutsSheetRow {
  id: string
  label: string
  /** Already formatted for the selected platform ("⇧⌘K" / "Ctrl+Shift+K"). */
  combos: readonly string[]
  isNew?: boolean
}

/** One group (Group · <Title>) in Body › Column 1–3. */
export interface ShortcutsSheetGroup {
  id: string
  title: string
  column: 1 | 2 | 3
  rows: readonly ShortcutsSheetRow[]
}

/** Props for {@link ShortcutsSheet}. Remaining `<div>` props go to the dialog frame. */
export interface ShortcutsSheetProps<P extends string = string>
  extends Omit<ComponentPropsWithRef<"div">, "children" | "title"> {
  groups: readonly ShortcutsSheetGroup[]
  filter: string
  onFilterChange: (value: string) => void
  platforms: readonly SegmentedTextOption<P>[]
  platform: P
  onPlatformChange: (value: P) => void
  onClose: () => void
  /** Footer › Note (QTqnj). */
  note?: string
  /** Rendered in place (gallery specimen): no focus trap or initial focus. */
  inline?: boolean
}

/**
 * Keyboard shortcuts sheet. Mirrors `Dialog · Keyboard shortcuts` (WcWPY): column, 1040,
 * bg-app, radius-2xl, shadows 0 2 6 shadow + 0 24 64 shadow-strong, clip.
 * Header (gVWmk) row, gap 12, padding [22, 24, 16, 28], center: Titles (ngix3, column, gap 4,
 * fill: Title sans 20 / 500 −0.3, Desc sans 13 text-secondary) · Filter (R5dm5, Input 220 × 32,
 * text 12) · Platform (AnOZ9, SegmentedText, labels 11) · Close (vh19d, IconButton 32 pill
 * bg-muted, lucide x).
 * Body (R0ug05) row, gap 32, padding [4, 28, 24, 28]: Column 1–3 (column, gap 20, fill) of
 * Group (column): Group Title (mono 11, +0.4, text-tertiary, upper) · Gap 6 · Row (h 30, gap 8,
 * center, bottom stroke border): Action (sans 12 text-primary) · New (padding [1, 6], bg-muted,
 * pill; sans 10 / 500 text-secondary) · Spacer · Kbd (Eo5JW) [· Or (sans 11 text-tertiary) · Kbd].
 * Footer (vALG2) row, gap 8, padding [12, 28], center, bg-subtle, top stroke border: Icon (info
 * 14 text-tertiary) · Note (sans 12 text-tertiary).
 */
export function ShortcutsSheet<P extends string = string>({
  groups,
  filter,
  onFilterChange,
  platforms,
  platform,
  onPlatformChange,
  onClose,
  note,
  inline = false,
  className,
  onKeyDown,
  ref,
  ...rest
}: ShortcutsSheetProps<P>) {
  const titleId = useId()
  const descId = useId()
  const root = useRef<HTMLDivElement>(null)
  const trap = useFocusTrap(root, inline ? "none" : "first")
  const columns = [1, 2, 3] as const
  return (
    <div
      role="dialog"
      aria-modal={inline ? undefined : "true"}
      aria-labelledby={titleId}
      aria-describedby={descId}
      {...rest}
      ref={mergeRefs(root, ref)}
      className={cx("kimo-shortcuts-sheet", className)}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented) return
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onClose()
          return
        }
        trap(e)
      }}
    >
      <div className="kimo-shortcuts-sheet__header">
        <div className="kimo-shortcuts-sheet__titles">
          <h2 id={titleId} className="kimo-shortcuts-sheet__title">
            Keyboard shortcuts
          </h2>
          <p id={descId} className="kimo-shortcuts-sheet__desc">
            Every binding in Kimo. Single keys work when the canvas has focus.
          </p>
        </div>
        <Input
          icon={<Search />}
          frameProps={{ className: "kimo-shortcuts-sheet__filter" }}
          type="search"
          placeholder="Filter shortcuts"
          aria-label="Filter shortcuts"
          value={filter}
          onChange={(e) => onFilterChange(e.currentTarget.value)}
        />
        <SegmentedText
          className="kimo-shortcuts-sheet__platform"
          label="Platform"
          options={platforms}
          value={platform}
          onChange={onPlatformChange}
        />
        <IconButton
          className="kimo-shortcuts-sheet__close"
          label="Close"
          icon={<X />}
          onClick={onClose}
        />
      </div>
      <div className="kimo-shortcuts-sheet__body">
        {columns.map((col) => (
          <div key={col} className="kimo-shortcuts-sheet__column" data-column={col}>
            {groups
              .filter((g) => g.column === col)
              .map((g) => (
                <section
                  key={g.id}
                  className="kimo-shortcuts-sheet__group"
                  aria-label={g.title}
                  data-group={g.id}
                >
                  <h3 className="kimo-shortcuts-sheet__group-title">{g.title}</h3>
                  <div className="kimo-shortcuts-sheet__gap" aria-hidden="true" />
                  {g.rows.map((r) => (
                    <div key={r.id} className="kimo-shortcuts-sheet__row" data-shortcut={r.id}>
                      <span className="kimo-shortcuts-sheet__action">{r.label}</span>
                      {r.isNew && (
                        <span className="kimo-shortcuts-sheet__new">
                          <span className="kimo-shortcuts-sheet__new-label">new</span>
                        </span>
                      )}
                      <span className="kimo-shortcuts-sheet__spacer" aria-hidden="true" />
                      {r.combos.map((c, i) => (
                        <Fragment key={c}>
                          {i > 0 && <span className="kimo-shortcuts-sheet__or">or</span>}
                          <Kbd>{c}</Kbd>
                        </Fragment>
                      ))}
                    </div>
                  ))}
                </section>
              ))}
          </div>
        ))}
      </div>
      <div className="kimo-shortcuts-sheet__footer">
        <Info className="kimo-shortcuts-sheet__footer-icon" aria-hidden="true" />
        <span className="kimo-shortcuts-sheet__note">
          {note ??
            "Windows · Linux: ⌘ → Ctrl, ⌥ → Alt. Single-key tools are ignored while typing in a field."}
        </span>
      </div>
    </div>
  )
}
