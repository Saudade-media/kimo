import { X } from "lucide-react"
import {
  type ComponentPropsWithoutRef,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useId,
  useRef,
} from "react"
import { IconButton } from "../icon-button/IconButton"
import { cx, mergeRefs } from "../internal/util"
import type { PlacementOptions } from "./position"
import { type PopoverAnchor, useAnchoredPosition, useDismiss, useFocusTrap } from "./usePopover"

/** Props for {@link Popover}. Remaining `<div>` props go to the frame. */
export interface PopoverProps extends Omit<ComponentPropsWithRef<"div">, "title" | "children"> {
  /** Header > Leading > Title (sans 12 / 600). Also the dialog's accessible name. */
  title?: string
  /** Replaces Leading (the color picker puts its Custom / Variables tabs here). */
  headerLeading?: ReactNode
  /** Replaces the Close button (the color picker: Eyedropper + Close). */
  actions?: ReactNode
  /** `Popover/Wide` (u0aiz): 296 instead of 248. */
  wide?: boolean
  /** Escape, outside pointerdown, or the Close button. */
  onClose?: () => void
  /** Body content. */
  children: ReactNode
  /**
   * Positions the popover (`position: fixed`) next to this element or rect: 4px below,
   * left-aligned, flipping above when it does not fit (board 09). Omit to render in flow.
   */
  anchor?: PopoverAnchor
  /** Overrides the default placement (`bottom` / `start`, offset 4). */
  placement?: PlacementOptions
  /** Accessible name when there is no `title` (e.g. the tabbed color picker). */
  label?: string
  /**
   * Where focus goes on open (once the popover is visible). Default `"root"` (the dialog itself,
   * so no field opens a caret); a ref focuses that element (the icon picker's search box).
   */
  initialFocus?: "first" | "root" | "none" | RefObject<HTMLElement | null>
  /** Extra props of the Body frame (e.g. `role="tabpanel"` for the color picker tabs). */
  bodyProps?: Omit<ComponentPropsWithoutRef<"div">, "children">
}

/**
 * Panel popover. Mirrors `Popover` (xvOvm) / `Popover/Wide` (u0aiz): 248 (296) wide, clip,
 * bg-overlay, radius-lg, stroke 1 border, shadow 0 8 24 shadow-strong, vertical.
 * Header (Am1eq) 40 tall, bottom stroke 1 border, padding [0, 6, 0, 12], space-between, center:
 * Leading (gap 6) > Title sans 12 / 600; Close = IconButton 24, transparent, `x` 14 text-tertiary.
 * Body (LjbJY): vertical, gap 12, padding 12.
 * Behaviour: `role="dialog"`, focus trapped (Tab cycles), Escape and outside pointerdown call
 * `onClose`, focus returns to the opener on unmount.
 */
export function Popover({
  title,
  headerLeading,
  actions,
  wide = false,
  onClose,
  children,
  anchor,
  placement,
  label,
  initialFocus = "root",
  bodyProps,
  className,
  style,
  onKeyDown,
  ref,
  ...rest
}: PopoverProps) {
  const root = useRef<HTMLDivElement>(null)
  const pos = useAnchoredPosition(root, anchor, placement)
  useDismiss(root, onClose, anchor, onClose !== undefined)
  const trap = useFocusTrap(root, initialFocus, pos === undefined || pos.ready)
  const titleId = useId()
  const titled = title !== undefined && headerLeading === undefined

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    if (e.key === "Escape" && onClose) {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    trap(e)
  }

  return (
    <div
      {...rest}
      ref={mergeRefs(root, ref)}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? label}
      aria-labelledby={titled ? titleId : undefined}
      tabIndex={-1}
      className={cx("kimo-popover", wide && "kimo-popover--wide", className)}
      style={
        pos
          ? {
              position: "fixed",
              left: pos.x,
              top: pos.y,
              visibility: pos.ready ? undefined : "hidden",
              ...style,
            }
          : style
      }
      onKeyDown={handleKeyDown}
    >
      <div className="kimo-popover__header">
        {headerLeading ?? (
          <div className="kimo-popover__leading">
            <span id={titleId} className="kimo-popover__title">
              {title}
            </span>
          </div>
        )}
        {actions ?? (
          <IconButton
            className="kimo-popover__close"
            label="Close"
            icon={<X />}
            size="sm"
            tone="quiet"
            onClick={onClose}
          />
        )}
      </div>
      <div {...bodyProps} className={cx("kimo-popover__body", bodyProps?.className)}>
        {children}
      </div>
    </div>
  )
}
