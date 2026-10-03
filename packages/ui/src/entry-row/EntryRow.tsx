import { Ellipsis, GripVertical, Plus } from "lucide-react"
import {
  type ComponentPropsWithRef,
  type DragEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useState,
} from "react"
import { WhenChip } from "../alias-chip/AliasChip"
import { Button } from "../button/Button"
import { cx } from "../internal/util"

/** Props for {@link EntryRow}. Remaining `<div>` props go to the row. */
export interface EntryRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** 1-based position in list order. */
  index: number
  /** `axis → value` conditions; `null` = fallback entry (no `when`). */
  when: Readonly<Record<string, string>> | null
  /** The entry's value: a VarCell (height 32). */
  value: ReactNode
  /** "wins in preview", "beats entry 2 under dark + compact", "used only if nothing matches". */
  state?: string
  /** Winning entry under the previewed theme (`mFjXw`): fill bg-subtle, state text-secondary. */
  winning?: boolean
  /** Row menu (Edit when…, Duplicate, Delete). Receives the ellipsis button. */
  onMenu?: (anchor: HTMLElement) => void
  /** Spread on the grip (drag / keyboard reorder handle). */
  dragHandleProps?: HTMLAttributes<HTMLSpanElement>
}

/**
 * One themed entry of a variable (raw list order). Mirrors `EntryRow` (H6Mdtf) /
 * `EntryRow/Fallback` (Ni5kJ): fill_container × 32, row, gap 8, padding [0, 8, 0, 12], center,
 * stroke bottom 1 border. Grip (x8qPB) `grip-vertical` 12 text-tertiary · Index (yafcc) mono 11
 * text-tertiary · When (ZXu86) width 300, row, gap 4, center: WhenChips, or the Fallback Tag
 * (aKpIg: padding [0, 5], stroke 1 border-strong, radius-xs; mono 11 text-secondary "fallback ·
 * no when") · Value (VarCell h 32) · Spacer · State (bNimB) sans 11 text-tertiary · Menu
 * (qyMH0) `ellipsis` 14 text-tertiary.
 */
export function EntryRow({
  index,
  when,
  value,
  state,
  winning = false,
  onMenu,
  dragHandleProps,
  className,
  ...rest
}: EntryRowProps) {
  return (
    <div
      {...rest}
      className={cx("kimo-entry-row", winning && "kimo-entry-row--winning", className)}
    >
      <span {...dragHandleProps} className={cx("kimo-entry-row__grip", dragHandleProps?.className)}>
        <GripVertical aria-hidden="true" />
      </span>
      <span className="kimo-entry-row__index">{index}</span>
      <span className="kimo-entry-row__when">
        {when === null ? (
          <span className="kimo-entry-row__fallback">
            <span className="kimo-entry-row__fallback-label">fallback · no when</span>
          </span>
        ) : (
          Object.entries(when).map(([axis, v]) => <WhenChip key={axis} axis={axis} value={v} />)
        )}
      </span>
      {value}
      <span className="kimo-entry-row__spacer" aria-hidden="true" />
      <span className="kimo-entry-row__state">{state}</span>
      <button
        type="button"
        className="kimo-entry-row__menu"
        aria-label={`Entry ${index} options`}
        onClick={(e) => onMenu?.(e.currentTarget)}
      >
        <Ellipsis aria-hidden="true" />
      </button>
    </div>
  )
}

/** One entry of {@link VariableEntries}. */
export interface VariableEntry {
  /** Stable key (survives reorder). */
  key: string
  when: Readonly<Record<string, string>> | null
  value: ReactNode
  state?: string
  winning?: boolean
}

/** Props for {@link VariableEntries}. Remaining `<div>` props go to the block. */
export interface VariableEntriesProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  entries: readonly VariableEntry[]
  /** "preview: light · comfortable → 16". */
  preview?: string
  /** Move entry `from` to index `to` (list order; last matching entry wins). */
  onReorder?: (from: number, to: number) => void
  onEntryMenu?: (index: number, anchor: HTMLElement) => void
  onAddEntry?: () => void
  onAddFallback?: () => void
}

/**
 * Open entries list of a multi-axis variable (Variables dialog `akJGT`): fill_container,
 * column, padding [0, 0, 0, 24], fill bg-subtle, stroke bottom 1 border. Entries Header
 * (E1sgyl: h 28, row, gap 8, padding [0, 12], center: "Entries" sans 11 / 600 text-secondary ·
 * count sans 11 text-tertiary · Spacer · preview mono 11 text-tertiary) · EntryRows · Entries
 * Footer (bTPBP: h 36, row, gap 6, padding [0, 12], center: Button/Ghost "Add entry" / "Add
 * fallback", h 24, padding [0, 8], `plus` 12, label 11).
 * Reorder: drag the grip, or focus it and press Alt+↑ / Alt+↓.
 */
export function VariableEntries({
  entries,
  preview,
  onReorder,
  onEntryMenu,
  onAddEntry,
  onAddFallback,
  className,
  ...rest
}: VariableEntriesProps) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const n = entries.length
  const move = (from: number, to: number) => {
    if (to < 0 || to >= n || to === from) return
    onReorder?.(from, to)
  }
  return (
    <div {...rest} className={cx("kimo-variable-entries", className)}>
      <div className="kimo-variable-entries__header">
        <span className="kimo-variable-entries__title">Entries</span>
        <span className="kimo-variable-entries__count">
          {`${n} · in list order · last matching entry wins`}
        </span>
        <span className="kimo-variable-entries__spacer" aria-hidden="true" />
        {preview !== undefined && <span className="kimo-variable-entries__preview">{preview}</span>}
      </div>
      {entries.map((e, i) => (
        <EntryRow
          key={e.key}
          index={i + 1}
          when={e.when}
          value={e.value}
          state={e.state}
          winning={e.winning}
          data-drop={
            drag && drag.over === i && drag.from !== i
              ? drag.from < i
                ? "after"
                : "before"
              : undefined
          }
          onDragOver={(ev: DragEvent<HTMLDivElement>) => {
            if (!drag) return
            ev.preventDefault()
            if (drag.over !== i) setDrag({ ...drag, over: i })
          }}
          onDrop={(ev: DragEvent<HTMLDivElement>) => {
            if (!drag) return
            ev.preventDefault()
            move(drag.from, i)
            setDrag(null)
          }}
          onMenu={(anchor) => onEntryMenu?.(i, anchor)}
          dragHandleProps={{
            role: "button",
            tabIndex: 0,
            "aria-label": `Reorder entry ${i + 1} (Alt+↑ / Alt+↓)`,
            draggable: onReorder !== undefined,
            "aria-roledescription": "sortable",
            onDragStart: (ev: DragEvent<HTMLSpanElement>) => {
              ev.dataTransfer.effectAllowed = "move"
              ev.dataTransfer.setData("text/plain", e.key)
              const row = ev.currentTarget.closest(".kimo-entry-row")
              if (row) ev.dataTransfer.setDragImage(row, 12, 16)
              setDrag({ from: i, over: i })
            },
            onDragEnd: () => setDrag(null),
            onKeyDown: (ev: KeyboardEvent<HTMLSpanElement>) => {
              if (!ev.altKey) return
              if (ev.key === "ArrowUp") {
                ev.preventDefault()
                move(i, i - 1)
              } else if (ev.key === "ArrowDown") {
                ev.preventDefault()
                move(i, i + 1)
              }
            },
          }}
        />
      ))}
      <div className="kimo-variable-entries__footer">
        <Button
          variant="ghost"
          className="kimo-variable-entries__add"
          icon={<Plus />}
          onClick={onAddEntry}
        >
          Add entry
        </Button>
        <Button
          variant="ghost"
          className="kimo-variable-entries__add"
          icon={<Plus />}
          onClick={onAddFallback}
        >
          Add fallback
        </Button>
      </div>
    </div>
  )
}

/** `arrayMove` for {@link VariableEntriesProps.onReorder} handlers. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice()
  const [item] = next.splice(from, 1)
  if (item === undefined) return next
  next.splice(to, 0, item)
  return next
}
