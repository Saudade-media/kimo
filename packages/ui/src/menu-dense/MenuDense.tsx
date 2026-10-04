import { Check, ChevronRight } from "lucide-react"
import {
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
} from "react"
import { cx, mergeRefs } from "../internal/util"
import type { PlacementOptions } from "../popover/position"
import { type PopoverAnchor, useAnchoredPosition, useDismiss } from "../popover/usePopover"

const ITEM_SELECTOR =
  '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemradio"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"])'

/** Props for {@link MenuDense}. Remaining `<div>` props go to the frame. */
export interface MenuDenseProps extends ComponentPropsWithRef<"div"> {
  children: ReactNode
  /** Frame width in px (instances: 208 blend, 188 format, 168 image mode). Default: fill. */
  width?: number
  /** Accessible name. */
  label?: string
  /** Escape / Tab / outside pointerdown. Enables dismissal when set. */
  onClose?: () => void
  /** Focus the checked (else first) item on mount. Default false. */
  autoFocus?: boolean
  /** Positions the menu (`position: fixed`) 4px below the anchor, left-aligned, with flip. */
  anchor?: PopoverAnchor
  placement?: PlacementOptions
}

/**
 * Dense menu for every Select in the right panel. Mirrors `Menu/Dense` (G7A3Aj):
 * fill_container (instances 208), bg-overlay, radius-lg, stroke 1 border, shadow 0 8 24
 * shadow-strong, vertical, gap 1, padding 4; one Items frame (ksc3x, vertical, gap 1) holds the
 * rows. Keyboard: ↑/↓ (wrapping), Home/End, Enter/Space activate, Escape/Tab close.
 */
export function MenuDense({
  children,
  width,
  label,
  onClose,
  autoFocus = false,
  anchor,
  placement,
  className,
  style,
  onKeyDown,
  ref,
  ...rest
}: MenuDenseProps) {
  const root = useRef<HTMLDivElement>(null)
  const pos = useAnchoredPosition(root, anchor, placement)
  useDismiss(root, onClose, anchor, onClose !== undefined)

  // Focus once the menu is visible: an anchored menu renders `visibility: hidden` until its
  // position is measured, and focus() on a hidden element is a no-op.
  const visible = pos === undefined || pos.ready
  const focused = useRef(false)
  useEffect(() => {
    if (!autoFocus || !visible || focused.current) return
    focused.current = true
    const el = root.current
    const checked = el?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
    ;(checked ?? el?.querySelector<HTMLElement>(ITEM_SELECTOR) ?? el)?.focus({
      preventScroll: true,
    })
  }, [autoFocus, visible])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    // Only this menu's own rows: a nested submenu (rendered inside the root so outside-press
    // dismissal treats it as part of the menu) navigates its own items.
    const items = [...(root.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])].filter(
      (el) => el.closest('[role="menu"]') === root.current,
    )
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
        if (!onClose) break
        e.preventDefault()
        e.stopPropagation()
        onClose()
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
      className={cx("kimo-menu-dense", className)}
      style={{
        ...(width !== undefined ? { width } : null),
        ...(pos
          ? {
              position: "fixed",
              left: pos.x,
              top: pos.y,
              visibility: pos.ready ? undefined : "hidden",
            }
          : null),
        ...style,
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="kimo-menu-dense__items">{children}</div>
    </div>
  )
}

/** Props for {@link MenuItemDense}. Native `<button>` props pass through. */
export interface MenuItemDenseProps
  extends Omit<ComponentPropsWithRef<"button">, "onSelect" | "children"> {
  label: string
  /**
   * Checked (the current value): Check visible, label weight 500, fill bg-hover
   * (`bkJJG` "Multiply (checked)"). When defined (true or false) the row is a
   * `menuitemradio` with `aria-checked`.
   */
  checked?: boolean
  /**
   * A checkable item (board 27 View menu rmQMe: "Checkable items use the Menu/Dense check
   * slot"): a `menuitemcheckbox` whose Check (RmOTH) shows when on. Unlike `checked` the row
   * keeps its regular weight and no fill. Ignored when `checked` is set.
   */
  toggled?: boolean
  /** Keyboard/hover highlight forced on: bg-hover. */
  highlighted?: boolean
  /** Right-hand text (Meta T4CD1), e.g. `244 162 97`. */
  meta?: string
  /** Meta font: `"mono"` (default, color values) or `"sans"` (image mode menu `ys18y`). */
  metaFont?: "mono" | "sans"
  /** Label in font-mono (the "With meta" variant dQw9B: format names). */
  mono?: boolean
  /**
   * A leading icon in the Check Slot (board 20 File menu: `file-plus`, `folder-open`, …, 14,
   * text-secondary). Replaces the check mark.
   */
  icon?: ReactNode
  /** Opens a submenu: the Meta slot shows `chevron-right` 12 text-tertiary (board 20 uNZcy). */
  submenu?: boolean
  /** Click, Enter or Space. */
  onSelect?: () => void
  /** Pointer or keyboard highlight (the blend menu previews live). */
  onHighlight?: () => void
}

/**
 * Dense menu row. Mirrors `MenuItem/Dense` (EAGNC): fill_container × 28, radius-sm, gap 8,
 * padding [0, 8], alignItems center: Check Slot (Hl922) 14 × 14 (lucide `check` 14 text-primary
 * when checked, always reserved) · Label (BRxvS) sans 12 text-primary · Spacer · Meta (T4CD1)
 * mono 11 text-tertiary.
 */
export function MenuItemDense({
  label,
  checked,
  toggled,
  highlighted = false,
  meta,
  metaFont = "mono",
  mono = false,
  icon,
  submenu = false,
  onSelect,
  onHighlight,
  disabled,
  className,
  onClick,
  onPointerMove,
  onFocus,
  type = "button",
  ...rest
}: MenuItemDenseProps) {
  return (
    <button
      {...rest}
      type={type}
      {...(checked !== undefined
        ? { role: "menuitemradio", "aria-checked": checked }
        : toggled !== undefined
          ? { role: "menuitemcheckbox", "aria-checked": toggled }
          : { role: "menuitem" })}
      aria-haspopup={submenu ? "menu" : undefined}
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      data-highlighted={highlighted || undefined}
      className={cx("kimo-menu-item-dense", checked && "kimo-menu-item-dense--checked", className)}
      onPointerMove={(e) => {
        onPointerMove?.(e)
        if (!disabled && document.activeElement !== e.currentTarget) e.currentTarget.focus()
      }}
      onFocus={(e) => {
        onFocus?.(e)
        if (!disabled) onHighlight?.()
      }}
      onClick={(e) => {
        if (disabled) return
        onClick?.(e)
        onSelect?.()
      }}
    >
      <span
        className={cx(
          "kimo-menu-item-dense__check",
          icon != null && "kimo-menu-item-dense__check--icon",
        )}
        aria-hidden="true"
      >
        {icon ?? ((checked ?? toggled) && <Check />)}
      </span>
      <span
        className={cx("kimo-menu-item-dense__label", mono && "kimo-menu-item-dense__label--mono")}
      >
        {label}
      </span>
      <span className="kimo-menu-item-dense__spacer" aria-hidden="true" />
      {submenu && <ChevronRight className="kimo-menu-item-dense__submenu" aria-hidden="true" />}
      {!submenu && meta != null && (
        <span
          className={cx(
            "kimo-menu-item-dense__meta",
            metaFont === "sans" && "kimo-menu-item-dense__meta--sans",
          )}
        >
          {meta}
        </span>
      )}
    </button>
  )
}

/** Props for {@link MenuDivider}. */
export type MenuDividerProps = Omit<ComponentPropsWithRef<"div">, "children">

/** Group separator. Mirrors `Menu/Divider` (fYNDQ): fill_container, padding [4, 8]; Line 1px border. */
export function MenuDivider({ className, ...rest }: MenuDividerProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot hold the padded Line child of the node.
    <div {...rest} role="separator" className={cx("kimo-menu-divider", className)}>
      <span className="kimo-menu-divider__line" />
    </div>
  )
}
