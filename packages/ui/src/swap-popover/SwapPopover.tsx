import { Info, Search } from "lucide-react"
import { type KeyboardEvent, useId, useMemo, useState } from "react"
import { AssetRow } from "../asset-row/AssetRow"
import { Input } from "../input/Input"
import { cx } from "../internal/util"
import { Popover, type PopoverProps } from "../popover/Popover"

/** A swap candidate. */
export interface SwapItem {
  /** Component id (local) or `alias:id` (library). */
  id: string
  /** Display name ("Card/Pricing", "ui:Card/Base"). */
  name: string
  /** Usage meta ("4×", "—"). */
  usage?: string
}

/** A group of candidates: "This file" (meta = family) or a library (meta = alias). */
export interface SwapGroup {
  title: string
  meta?: string
  items: readonly SwapItem[]
}

/** Props for {@link SwapPopover}. Popover props (anchor, placement, …) pass through. */
export interface SwapPopoverProps
  extends Omit<PopoverProps, "children" | "title" | "onSelect" | "wide"> {
  groups: readonly SwapGroup[]
  /** Current component of the instance (selected row + check). */
  selected?: string
  /** Pick a component → `swapInstance` (host lists dropped overrides before confirming). */
  onSelect: (id: string) => void
  /** Close button / Escape / outside click. Omit for a static (gallery) rendering. */
  onClose?: () => void
  /** Footer hint. */
  hint?: string
}

/**
 * Swap instance popover (board 13 `jFlfP`): Popover/Wide (296) titled "Swap instance". Body
 * (UFzU3) column: Search (P4yRG: padding [8, 8, 4, 8]; Input h 30 "Search components") · List
 * (FQCYh: column, gap 1, padding [0, 4, 8, 4]) of group headers (row, gap 6, padding
 * [8, 8, 4, 8], center: Title sans 11 / 600 text-tertiary · Meta mono 11 text-tertiary) and
 * AssetRows (selected: AssetRow/Selected) · Footer (EUTC7: stroke top 1 border, row, gap 8,
 * padding 12, center: `info` 14 text-tertiary · hint sans 11 text-tertiary).
 * Keyboard: type to filter, ↑/↓ move the active row, Enter swaps, Escape closes.
 */
export function SwapPopover({
  groups,
  selected,
  onSelect,
  onClose,
  hint = "Overrides carry over to layers with matching ids.",
  className,
  bodyProps,
  ...rest
}: SwapPopoverProps) {
  const [query, setQuery] = useState("")
  const listId = useId()
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return groups
      .map((g) => ({
        ...g,
        items: q ? g.items.filter((i) => i.name.toLowerCase().includes(q)) : g.items,
      }))
      .filter((g) => g.items.length > 0)
  }, [groups, query])
  const flat = filtered.flatMap((g) => g.items)
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      flat.findIndex((i) => i.id === selected),
    ),
  )
  const current = flat[Math.min(active, flat.length - 1)]

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (flat.length === 0) return
      const d = e.key === "ArrowDown" ? 1 : -1
      setActive((a) => (Math.min(a, flat.length - 1) + d + flat.length) % flat.length)
    } else if (e.key === "Enter" && current) {
      e.preventDefault()
      onSelect(current.id)
    }
  }

  let index = -1
  return (
    <Popover
      {...rest}
      title="Swap instance"
      wide
      onClose={onClose}
      initialFocus="first"
      className={cx("kimo-swap-popover", className)}
      bodyProps={{ ...bodyProps, className: cx("kimo-swap-popover__body", bodyProps?.className) }}
    >
      <div className="kimo-swap-popover__search">
        <Input
          icon={<Search />}
          placeholder="Search components"
          aria-label="Search components"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={current ? `${listId}-${current.id}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          frameProps={{ className: "kimo-swap-popover__input" }}
        />
      </div>
      <div id={listId} role="listbox" aria-label="Components" className="kimo-swap-popover__list">
        {filtered.map((g) => [
          <div key={`h:${g.title}`} className="kimo-swap-popover__group-header" role="presentation">
            <span className="kimo-swap-popover__group-title">{g.title}</span>
            {g.meta !== undefined && (
              <span className="kimo-swap-popover__group-meta">{g.meta}</span>
            )}
          </div>,
          ...g.items.map((item) => {
            index++
            const i = index
            return (
              <AssetRow
                key={item.id}
                id={`${listId}-${item.id}`}
                role="option"
                aria-selected={item.id === selected}
                data-active={current?.id === item.id || undefined}
                name={item.name}
                meta={item.usage ?? "—"}
                selected={item.id === selected}
                onPointerEnter={() => setActive(i)}
                onClick={() => onSelect(item.id)}
              />
            )
          }),
        ])}
        {filtered.length === 0 && <p className="kimo-swap-popover__empty">No components match</p>}
      </div>
      <div className="kimo-swap-popover__footer">
        <Info className="kimo-swap-popover__info" aria-hidden="true" />
        <span className="kimo-swap-popover__hint">{hint}</span>
      </div>
    </Popover>
  )
}
