/**
 * Board 27 §5 (a) "Shape slot · flyout" (rkFut): Rectangle, Ellipse, Line, Arrow, Polygon and
 * Star share ONE toolbar slot (Figma pattern). Shape Slot (jkzTd): row, alignItems center, no
 * gap — a ToolButton (N0cHp / l6HCd when the slot's tool is active) showing the last-used
 * shape, then the Flyout Caret (XELvA: lucide `chevron-down` 10 × 10, text-tertiary).
 *
 * Click = that tool; caret or long-press = the Shape flyout (MBxVC): Menu/Dense 200 wide,
 * 8 px above the toolbar, rows MenuItem/Dense with the shape's icon in the Check Slot (14,
 * text-secondary; the current tool's row bg-hover + icon text-primary) and its shortcut as
 * Meta (R · O · L · ⇧L · — · ⇧S; Polygon has no key: the design's ⇧P stays Prompt's). Shortcuts work regardless of the slot.
 */
import { MenuDense, MenuItemDense, ToolButton, Tooltip } from "@kimo/ui"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { type CanvasToolId, SHAPE_SLOT_TOOLS } from "../canvas/contract"
import { Icon } from "../lib/icons"
import { toolHint } from "./kbd"
import "./shape-slot.css"

/** Long-press delay before the flyout opens (house value; the design names no duration). */
const LONG_PRESS_MS = 400

/** Flyout bottom → toolbar top (MBxVC y 12 + h 181 = 193; Floating Toolbar kG342 y 201). */
const FLYOUT_GAP = 8

export function ShapeSlot({
  shape,
  active,
  onActivate,
}: {
  /** The slot's shape: the active slot tool, else the last used one. */
  shape: CanvasToolId
  /** The slot's tool is the current tool (ToolButton/Active). */
  active: boolean
  onActivate(id: CanvasToolId): void
}) {
  const spec = SHAPE_SLOT_TOOLS.find((t) => t.id === shape) ?? SHAPE_SLOT_TOOLS[0]
  const slot = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  /** When the flyout last closed (an outside press on the caret must not reopen it). */
  const closedAt = useRef(0)
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null)
  const clearPress = () => {
    if (press.current) clearTimeout(press.current.timer)
  }
  useEffect(
    () => () => {
      if (press.current) clearTimeout(press.current.timer)
    },
    [],
  )
  if (!spec) return null

  // Anchor: the slot's x extent, the toolbar's top edge (the flyout clears the whole pill).
  const anchor = () => {
    const s = slot.current?.getBoundingClientRect()
    const bar = slot.current?.closest(".floating-toolbar")?.getBoundingClientRect()
    if (!s) return null
    return { x: s.x, y: bar?.y ?? s.y, width: s.width, height: (bar?.height ?? s.height) as number }
  }
  const anchorRect = open ? anchor() : null

  return (
    <div ref={slot} className="shape-slot" data-pen="jkzTd">
      <Tooltip side="top" label={spec.label} shortcut={toolHint(spec) || undefined}>
        <ToolButton
          label={spec.label}
          icon={<Icon name={spec.icon} size={18} />}
          active={active}
          data-tool={spec.id}
          data-slot="shape"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            clearPress()
            const p = { fired: false, timer: setTimeout(() => {}, 0) }
            p.timer = setTimeout(() => {
              p.fired = true
              setOpen(true)
            }, LONG_PRESS_MS)
            press.current = p
          }}
          onPointerUp={clearPress}
          onPointerLeave={clearPress}
          onClick={() => {
            // A long press opened the flyout: the release is not a click on the tool.
            if (press.current?.fired) {
              press.current = null
              return
            }
            onActivate(spec.id)
          }}
        />
      </Tooltip>
      <button
        type="button"
        className="shape-slot__caret"
        aria-label="Shapes"
        aria-haspopup="menu"
        aria-expanded={open}
        data-pen="XELvA"
        onClick={() => {
          if (Date.now() - closedAt.current > 250) setOpen((o) => !o)
        }}
      >
        <Icon name="chevron-down" size={10} />
      </button>
      {open &&
        anchorRect &&
        // Portaled: the toolbar's translateX(-50%) would make it the fixed menu's containing block.
        createPortal(
          <MenuDense
            className="shape-flyout"
            data-pen="MBxVC"
            label="Shapes"
            width={200}
            anchor={anchorRect}
            placement={{ side: "top", align: "center", offset: FLYOUT_GAP }}
            autoFocus
            onClose={() => {
              closedAt.current = Date.now()
              setOpen(false)
            }}
          >
            {SHAPE_SLOT_TOOLS.map((t) => {
              const current = active && t.id === shape
              return (
                <MenuItemDense
                  key={t.id}
                  className={
                    current
                      ? "shape-flyout__item shape-flyout__item--current"
                      : "shape-flyout__item"
                  }
                  data-tool={t.id}
                  label={t.label}
                  icon={<Icon name={t.icon} size={14} />}
                  meta={toolHint(t) || undefined}
                  highlighted={current}
                  // The current tool's row: focused first (autoFocus) instead of Rectangle.
                  {...(current ? { checked: true } : {})}
                  onSelect={() => {
                    setOpen(false)
                    onActivate(t.id)
                  }}
                />
              )
            })}
          </MenuDense>,
          document.body,
        )}
    </div>
  )
}
