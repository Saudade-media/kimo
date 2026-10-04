import { ChevronDown } from "lucide-react"
import {
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react"
import { cx, mergeRefs } from "../internal/util"
import { MenuDense, MenuItemDense } from "../menu-dense/MenuDense"

/** Sizing mode of one axis: `.kimo` `fixed` / `fit` (shown "Hug") / `fill`. */
export type SizeMode = "fixed" | "fit" | "fill"

/** Menu order and labels (Fixed · Hug · Fill). */
export const SIZE_MODES: readonly { value: SizeMode; label: string }[] = [
  { value: "fixed", label: "Fixed" },
  { value: "fit", label: "Hug" },
  { value: "fill", label: "Fill" },
]

/** Props for {@link SizeField}. Remaining `<div>` props go to the frame. */
export interface SizeFieldProps
  extends Omit<ComponentPropsWithRef<"div">, "prefix" | "onChange" | "children"> {
  /** `"W"` | `"H"`. Also the input's accessible name unless `inputLabel` is set. */
  prefix: string
  /** Displayed value (`"640"`; the computed size in Hug, shown text-secondary). */
  value: string
  mode: SizeMode
  /** Enabled modes (Fill only inside a layout parent). Default: all three. */
  modes?: readonly SizeMode[]
  /** Enter / blur with an edited value, or ↑/↓ (Shift ×10) on a numeric value. */
  onValueCommit?: (value: string) => void
  onModeChange?: (mode: SizeMode) => void
  disabled?: boolean
  /** Accessible name of the value input. Default: `prefix` ("W" → "Width" is up to the host). */
  inputLabel?: string
  /** Rendered last inside the frame (board 27 §7 Bind Button, `kimo-prop-field--bindable`). */
  trailing?: ReactNode
}

/**
 * W/H field with a sizing-mode menu. Mirrors `SizeField` (G6R6IX): fill_container × 28,
 * bg-subtle, radius-sm, row, gap 8, padding [0, 8], center: Prefix (t111tE) mono 11
 * text-tertiary · Value (WCAAf) sans 12 text-primary (Hug: text-secondary, `QvUEC`) · Spacer
 * (jl5qQ) · Mode (aC4BS) sans 11 / 500 text-secondary · Chevron (n908B) `chevron-down` 12
 * text-tertiary. Mode or Chevron opens a `MenuDense` 4px below the field, left-aligned, with
 * Fixed / Hug / Fill (checked = current).
 */
export function SizeField({
  prefix,
  value,
  mode,
  modes,
  onValueCommit,
  onModeChange,
  disabled = false,
  inputLabel,
  trailing,
  className,
  ref,
  ...rest
}: SizeFieldProps) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const modeButton = useRef<HTMLButtonElement>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const cancelled = useRef(false)
  const label = SIZE_MODES.find((m) => m.value === mode)?.label ?? mode

  const commit = () => {
    if (draft !== null && draft.trim() !== "" && draft !== value) onValueCommit?.(draft.trim())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      commit()
      setDraft(null)
      e.currentTarget.select()
    } else if (e.key === "Escape") {
      e.preventDefault()
      cancelled.current = true
      setDraft(null)
      e.currentTarget.blur()
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const n = Number((draft ?? value).trim())
      if (!Number.isFinite(n)) return
      e.preventDefault()
      const next = String(
        Number((n + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1)).toFixed(2)),
      )
      onValueCommit?.(next)
      setDraft(next)
    }
  }

  const toggleMenu = () => {
    if (!disabled) setOpen((o) => !o)
  }

  const closeMenu = () => {
    setOpen(false)
    modeButton.current?.focus({ preventScroll: true })
  }

  return (
    <div
      {...rest}
      ref={mergeRefs(root, ref)}
      className={cx(
        "kimo-size-field",
        mode === "fit" && "kimo-size-field--hug",
        disabled && "kimo-size-field--disabled",
        className,
      )}
    >
      <span className="kimo-size-field__prefix" aria-hidden="true">
        {prefix}
      </span>
      <input
        ref={input}
        className="kimo-size-field__value"
        type="text"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        size={Math.max(1, (draft ?? value).length)}
        aria-label={inputLabel ?? prefix}
        disabled={disabled}
        value={draft ?? value}
        onFocus={(e) => {
          setDraft(value)
          e.currentTarget.select()
        }}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => {
          if (!cancelled.current) commit()
          cancelled.current = false
          setDraft(null)
        }}
        onKeyDown={onKeyDown}
      />
      <span
        className="kimo-size-field__spacer"
        aria-hidden="true"
        onPointerDown={(e) => {
          e.preventDefault()
          input.current?.focus()
        }}
      />
      <button
        ref={modeButton}
        type="button"
        className="kimo-size-field__mode"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={`${inputLabel ?? prefix} sizing: ${label}`}
        disabled={disabled}
        onClick={toggleMenu}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {label}
      </button>
      <span
        className="kimo-size-field__chevron"
        aria-hidden="true"
        onPointerDown={(e) => e.preventDefault()}
        onClick={toggleMenu}
      >
        <ChevronDown />
      </span>
      {trailing}
      {open && (
        <MenuDense
          id={`${id}-menu`}
          label={`${inputLabel ?? prefix} sizing`}
          anchor={root.current}
          autoFocus
          onClose={closeMenu}
          style={{ width: root.current?.getBoundingClientRect().width }}
        >
          {SIZE_MODES.map((m) => (
            <MenuItemDense
              key={m.value}
              label={m.label}
              checked={m.value === mode}
              disabled={modes !== undefined && !modes.includes(m.value)}
              onSelect={() => {
                if (m.value !== mode) onModeChange?.(m.value)
                closeMenu()
              }}
            />
          ))}
        </MenuDense>
      )}
    </div>
  )
}
