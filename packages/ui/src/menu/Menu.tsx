import {
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
} from "react"
import { cx, mergeRefs } from "../internal/util"

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])'

/** Props for {@link Menu}. Remaining `<div>` props go to the frame. */
export interface MenuProps extends ComponentPropsWithRef<"div"> {
  /** Accessible name. */
  label?: string
  /** Escape / Tab, or an item was chosen (when the item does not prevent it). */
  onClose?: () => void
  /** Focus the first item on mount (menus opened from the keyboard). Default false. */
  autoFocus?: boolean
}

/**
 * Popover menu. Mirrors `Menu` (MPsxN): width 232, bg-overlay, radius-lg, 1px border stroke,
 * shadow 0 8 24 shadow-strong, vertical, gap 1, padding 4.
 * Keyboard: ↑/↓ (wrapping), Home/End, Enter/Space activate, Escape/Tab close.
 */
export function Menu({
  label,
  onClose,
  autoFocus = false,
  className,
  children,
  onKeyDown,
  ref,
  ...rest
}: MenuProps) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoFocus) root.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus()
  }, [autoFocus])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    const items = [...(root.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])]
    const index = items.indexOf(document.activeElement as HTMLElement)
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus()
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        focus(index + 1)
        break
      case "ArrowUp":
        e.preventDefault()
        focus(index < 0 ? -1 : index - 1)
        break
      case "Home":
        e.preventDefault()
        focus(0)
        break
      case "End":
        e.preventDefault()
        focus(-1)
        break
      case "Escape":
        e.preventDefault()
        onClose?.()
        break
      case "Tab":
        onClose?.()
        break
    }
  }

  return (
    <div
      {...rest}
      ref={mergeRefs(root, ref)}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      className={cx("kimo-menu", className)}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  )
}

/** Props for {@link MenuItem}. Native `<button>` props pass through. */
export interface MenuItemProps extends Omit<ComponentPropsWithRef<"button">, "onSelect"> {
  /** Leading 14 × 14 icon (Lucide). */
  icon?: ReactNode
  /** Trailing shortcut text (`⌘D`). */
  shortcut?: string
  /** Activated by click, Enter or Space. */
  onSelect?: () => void
  /** Force the highlighted look (`bg-hover`), as in the design's "Group selection" instance. */
  highlighted?: boolean
}

/**
 * Menu row. Mirrors `MenuItem` (JMW2O): fill_container × 30, radius-sm, gap 8, padding [0, 8];
 * icon 14 text-secondary; label 13 text-primary; spacer; shortcut mono 11 text-tertiary.
 * Hover/focus fill bg-hover.
 */
export function MenuItem({
  icon,
  shortcut,
  onSelect,
  highlighted = false,
  disabled,
  className,
  children,
  onClick,
  onPointerMove,
  type = "button",
  ...rest
}: MenuItemProps) {
  return (
    <button
      {...rest}
      type={type}
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      data-highlighted={highlighted || undefined}
      className={cx("kimo-menu-item", className)}
      onPointerMove={(e) => {
        onPointerMove?.(e)
        if (!disabled && document.activeElement !== e.currentTarget) e.currentTarget.focus()
      }}
      onClick={(e) => {
        if (disabled) return
        onClick?.(e)
        onSelect?.()
      }}
    >
      <span className="kimo-menu-item__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="kimo-menu-item__label">{children}</span>
      <span className="kimo-menu-item__spacer" aria-hidden="true" />
      {shortcut != null && <span className="kimo-menu-item__shortcut">{shortcut}</span>}
    </button>
  )
}
