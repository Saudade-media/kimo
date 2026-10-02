/**
 * Anchors a `@kimo/ui` Menu under a trigger: opens on click, closes on outside pointerdown,
 * Escape, or after an item is chosen.
 */
import { Menu } from "@kimo/ui"
import { type ReactNode, useEffect, useRef, useState } from "react"

export interface MenuPopoverProps {
  /** Renders the trigger; spread `props` onto the button. */
  trigger: (props: {
    onClick: () => void
    "aria-haspopup": "menu"
    "aria-expanded": boolean
  }) => ReactNode
  /** Menu items; call `close` after acting. */
  children: (close: () => void) => ReactNode
  label: string
  align?: "start" | "end"
  className?: string
}

export function MenuPopover({
  trigger,
  children,
  label,
  align = "start",
  className,
}: MenuPopoverProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [open])

  const close = () => setOpen(false)
  return (
    <div ref={root} className={className ? `menu-popover ${className}` : "menu-popover"}>
      {trigger({
        onClick: () => setOpen((o) => !o),
        "aria-haspopup": "menu",
        "aria-expanded": open,
      })}
      {open && (
        <Menu
          label={label}
          autoFocus
          onClose={close}
          className={`menu-popover__menu menu-popover__menu--${align}`}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[role="menuitem"]')) close()
          }}
        >
          {children(close)}
        </Menu>
      )}
    </div>
  )
}
