import { Check, ChevronDown } from "lucide-react"
import {
  type ComponentPropsWithRef,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { cx, nextEnabled } from "../internal/util"

/** One choice of a {@link Select}. */
export interface SelectOption<V extends string = string> {
  value: V
  label: string
  disabled?: boolean
}

/** Props for {@link Select}. Remaining `<div>` props go to the wrapper. */
export interface SelectProps<V extends string = string>
  extends Omit<ComponentPropsWithRef<"div">, "onChange" | "children"> {
  options: readonly SelectOption<V>[]
  value: V | null
  onChange?: (value: V) => void
  /** Shown when `value` matches no option. */
  placeholder?: string
  /** Accessible name of the combobox. */
  label: string
  disabled?: boolean
}

/**
 * Select-only combobox. The trigger mirrors `Select` (gP276): fill_container × 28, bg-subtle,
 * radius-sm, padding [0, 8], gap 8, space-between; value sans 12 text-primary; chevron-down 14
 * text-tertiary. The popover reuses the `Menu` / `MenuItem` look (selected option: lucide check).
 * Keyboard (WAI-ARIA select-only combobox): ↓/↑/Enter/Space open, ↑/↓/Home/End move,
 * Enter/Space choose, Escape closes, Tab chooses and moves on.
 */
export function Select<V extends string = string>({
  options,
  value,
  onChange,
  placeholder = "",
  label,
  disabled = false,
  className,
  ...rest
}: SelectProps<V>) {
  const id = useId()
  const listId = `${id}-list`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const wrapper = useRef<HTMLDivElement>(null)
  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = options[selectedIndex]
  const isDisabled = (i: number) => options[i]?.disabled === true

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [open])

  const show = () => {
    if (disabled) return
    setActive(selectedIndex >= 0 ? selectedIndex : nextEnabled(options.length, -1, 1, isDisabled))
    setOpen(true)
  }

  const choose = (i: number) => {
    const o = options[i]
    if (!o || o.disabled) return
    if (o.value !== value) onChange?.(o.value)
    setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setActive((a) => nextEnabled(options.length, a, 1, isDisabled))
        break
      case "ArrowUp":
        e.preventDefault()
        setActive((a) => nextEnabled(options.length, a < 0 ? 0 : a, -1, isDisabled))
        break
      case "Home":
        e.preventDefault()
        setActive(nextEnabled(options.length, -1, 1, isDisabled))
        break
      case "End":
        e.preventDefault()
        setActive(nextEnabled(options.length, 0, -1, isDisabled))
        break
      case "Enter":
      case " ":
        e.preventDefault()
        choose(active)
        break
      case "Escape":
        e.preventDefault()
        setOpen(false)
        break
      case "Tab":
        choose(active)
        break
    }
  }

  return (
    <div {...rest} ref={wrapper} className={cx("kimo-select", className)}>
      <button
        type="button"
        role="combobox"
        className="kimo-select__trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className={cx("kimo-select__value", !selected && "kimo-select__value--placeholder")}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="kimo-select__chevron" aria-hidden="true">
          <ChevronDown />
        </span>
      </button>
      {open && (
        <div id={listId} role="listbox" aria-label={label} className="kimo-menu kimo-select__list">
          {options.map((o, i) => (
            <div
              key={o.value}
              id={`${id}-opt-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              data-highlighted={i === active || undefined}
              className="kimo-menu-item kimo-select__option"
              onPointerDown={(e) => e.preventDefault()}
              onPointerMove={() => !o.disabled && setActive(i)}
              onClick={() => choose(i)}
              onKeyDown={() => {}}
            >
              <span className="kimo-menu-item__icon" aria-hidden="true">
                {o.value === value && <Check />}
              </span>
              <span className="kimo-menu-item__label">{o.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
