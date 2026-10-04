import { Library, Plus, Search, Unlink } from "lucide-react"
import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react"
import { Input } from "../input/Input"
import { cx } from "../internal/util"
import { Popover, type PopoverProps } from "../popover/Popover"
import type { BindableType } from "../prop-field-bound/PropFieldBound"
import { VariableListRow } from "../variable-list-row/VariableListRow"

/** One bindable variable. */
export interface VariablePickerItem {
  /** Binding target written as `{ $ref }`: `name` (this file) or `alias:name` (library). */
  ref: string
  /** Display name (`space/4`; library rows `brand/space/md`). */
  name: string
  /** Resolved value in the current theme (`16`), or `→ target` for an alias. */
  value: string
  /** The variable is an alias of another one (`link-2` after the value). */
  alias?: boolean
}

/** "This file" (meta = count) or one imported library (meta = its path from `imports`). */
export interface VariablePickerGroup {
  key: string
  title: string
  meta: string
  /** Library group: `library` 12 glyph before the title. */
  library?: boolean
  items: readonly VariablePickerItem[]
}

/** Props for {@link VariablePicker}. Popover props (anchor, placement, …) pass through. */
export interface VariablePickerProps
  extends Omit<PopoverProps, "children" | "title" | "onSelect" | "wide"> {
  /** Header title (`Bind Gap`). */
  title: string
  /** The field's type: search placeholder and row glyphs. */
  type: BindableType
  groups: readonly VariablePickerGroup[]
  /** Current binding (pre-selected row). */
  selected?: string
  onSelect: (ref: string) => void
  /** Footer "Create variable from <value>" label; omit to hide (Mixed values). */
  createLabel?: string
  onCreate?: () => void
  /** Footer Detach (bound fields only). */
  onDetach?: () => void
}

/**
 * Variable picker (board 27 §7 b, `xec6v`): Popover (xvOvm) 320 wide titled "Bind <field>".
 * Body (oDd1B) column, gap 2, padding [8, 6, 6, 6]: Search (VyoHA: Input h 28, placeholder
 * "Search <type> variables" sans 12) · group headers (rPIXV / uUIBy: row, gap 6, padding
 * [8, 8, 4, 8], center → [Lib `library` 12 text-tertiary] · Title sans 11 / 600 text-tertiary ·
 * Spacer · Meta mono 11 text-tertiary) · VariableListRows (current = bg-hover; aliases show
 * `→ target` + `link-2`) · Footer (phtV6: stroke top 1 border, row, gap 8, padding [8, 8, 2, 8],
 * center → Plus 14 text-secondary · "Create variable from <value>" sans 12 text-secondary ·
 * Spacer · Detach `unlink` 14 text-tertiary).
 * Keyboard: type to filter across groups, ↑/↓ move, Enter binds, Escape closes.
 */
export function VariablePicker({
  title,
  type,
  groups,
  selected,
  onSelect,
  createLabel,
  onCreate,
  onDetach,
  onClose,
  className,
  bodyProps,
  ...rest
}: VariablePickerProps) {
  const [query, setQuery] = useState("")
  const search = useRef<HTMLInputElement>(null)
  const listId = useId()
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return groups
      .map((g) => ({
        ...g,
        items: q
          ? g.items.filter(
              (i) => i.name.toLowerCase().includes(q) || i.ref.toLowerCase().includes(q),
            )
          : g.items,
      }))
      .filter((g) => g.items.length > 0)
  }, [groups, query])
  const flat = filtered.flatMap((g) => g.items)
  const [active, setActive] = useState<string | undefined>(selected)
  const current = flat.find((i) => i.ref === active) ?? (query ? flat[0] : undefined)
  const optionId = (ref: string) => `${listId}-${ref.replace(/[^A-Za-z0-9_-]/g, "_")}`

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (flat.length === 0) return
      const at = current ? flat.indexOf(current) : -1
      const d = e.key === "ArrowDown" ? 1 : -1
      const next = at < 0 ? (d > 0 ? 0 : flat.length - 1) : (at + d + flat.length) % flat.length
      setActive(flat[next]?.ref)
    } else if (e.key === "Enter" && current) {
      e.preventDefault()
      onSelect(current.ref)
    }
  }

  return (
    <Popover
      {...rest}
      title={title}
      onClose={onClose}
      initialFocus={search}
      className={cx("kimo-variable-picker", className)}
      bodyProps={{
        ...bodyProps,
        className: cx("kimo-variable-picker__body", bodyProps?.className),
      }}
    >
      <Input
        ref={search}
        dense
        icon={<Search />}
        placeholder={`Search ${type} variables`}
        aria-label={`Search ${type} variables`}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={current ? optionId(current.ref) : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.currentTarget.value)
          setActive(undefined)
        }}
        onKeyDown={onKeyDown}
        frameProps={{ className: "kimo-variable-picker__search" }}
      />
      <div
        id={listId}
        role="listbox"
        aria-label={`${type} variables`}
        className="kimo-variable-picker__list"
      >
        {filtered.map((g) => [
          <div
            key={`h:${g.key}`}
            className="kimo-variable-picker__group"
            role="presentation"
            data-group={g.key}
          >
            {g.library && <Library className="kimo-variable-picker__lib" aria-hidden="true" />}
            <span className="kimo-variable-picker__group-title">{g.title}</span>
            <span className="kimo-variable-picker__spacer" aria-hidden="true" />
            <span className="kimo-variable-picker__group-meta">{g.meta}</span>
          </div>,
          ...g.items.map((item) => (
            <VariableListRow
              key={item.ref}
              id={optionId(item.ref)}
              role="option"
              aria-selected={item.ref === selected}
              data-ref={item.ref}
              name={item.name}
              type={type}
              value={item.value}
              alias={item.alias}
              selected={current?.ref === item.ref}
              onPointerEnter={() => setActive(item.ref)}
              onClick={() => onSelect(item.ref)}
            />
          )),
        ])}
        {filtered.length === 0 && (
          <p className="kimo-variable-picker__empty">
            {query ? "No variables match" : `No ${type} variables yet`}
          </p>
        )}
      </div>
      {(createLabel !== undefined || onDetach) && (
        <div className="kimo-variable-picker__footer">
          {createLabel !== undefined ? (
            <>
              <Plus className="kimo-variable-picker__plus" aria-hidden="true" onClick={onCreate} />
              <button type="button" className="kimo-variable-picker__create" onClick={onCreate}>
                {createLabel}
              </button>
            </>
          ) : null}
          <span className="kimo-variable-picker__spacer" aria-hidden="true" />
          {onDetach && (
            <button
              type="button"
              className="kimo-variable-picker__detach"
              aria-label="Detach variable"
              title="Detach"
              onClick={onDetach}
            >
              <Unlink aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </Popover>
  )
}
