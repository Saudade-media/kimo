import { Fragment, type ReactNode } from "react"
import { cx } from "../internal/util"
import { MenuDense, MenuDivider, MenuItemDense } from "../menu-dense/MenuDense"
import type { PopoverAnchor } from "../popover/usePopover"

/** Board 25 §3 context menu frame width (j8U4z / AYe2e / cXA2Y: 236). */
export const CANVAS_CONTEXT_MENU_WIDTH = 236

/** One row of the canvas context menu (a MenuItem/Dense EAGNC instance). */
export interface CanvasContextMenuItem {
  id: string
  label: string
  /**
   * Check Slot (Hl922) content: a 14 px lucide icon for agent items (RmOTH `sparkles`, `play`,
   * `crosshair`, `flag-off`) or AgentMark/12/Idle for "Resume agent" (nN0TD). Empty on standard rows.
   */
  icon?: ReactNode
  /** Meta (T4CD1): `⌘D`, the prompt's target name, `session 3`. */
  meta?: string
  /** Meta font: mono (shortcuts, target name; default) or sans (`session 3`, qScPD). */
  metaFont?: "mono" | "sans"
  /**
   * `agent`: icon `$agent`, label 500 (rule H8cZk6). `danger`: label `$danger` (Delete A7BF6s).
   * Omitted: a standard row (label text-primary, normal).
   */
  tone?: "agent" | "danger"
  disabled?: boolean
  onSelect(): void
}

export interface CanvasContextMenuProps {
  /**
   * Groups in order, separated by Menu/Divider (fYNDQ). Board 25 rule L8EbvG: the agent group
   * first, then the standard items, then Delete. Empty groups are skipped.
   */
  groups: readonly (readonly CanvasContextMenuItem[])[]
  /** Pointer position (viewport px): the menu opens at its top-left, flipped to stay on screen. */
  anchor: PopoverAnchor
  onClose(): void
  label?: string
  "data-testid"?: string
}

/**
 * Canvas context menu (board 25 §3 jWmmU): Menu/Dense look, 236 wide (j8U4z), vertical gap 1,
 * padding 4, bg-overlay, radius-lg, border, shadow 0 8 24 shadow-strong. Rows are
 * MenuItem/Dense (EAGNC); agent rows carry their icon in the Check Slot (RmOTH, 14, `$agent`)
 * and a 500 label.
 */
export function CanvasContextMenu({
  groups,
  anchor,
  onClose,
  label = "Canvas",
  "data-testid": testId,
}: CanvasContextMenuProps) {
  const shown = groups.filter((g) => g.length > 0)
  return (
    <MenuDense
      width={CANVAS_CONTEXT_MENU_WIDTH}
      label={label}
      anchor={anchor}
      placement={{ side: "bottom", align: "start", offset: 0 }}
      onClose={onClose}
      autoFocus
      className="kimo-canvas-menu"
      data-testid={testId}
    >
      {shown.map((group, gi) => (
        <Fragment key={group[0]?.id ?? gi}>
          {gi > 0 && <MenuDivider />}
          {group.map((it) => (
            <MenuItemDense
              key={it.id}
              data-item={it.id}
              label={it.label}
              icon={it.icon}
              meta={it.meta}
              metaFont={it.metaFont ?? "mono"}
              disabled={it.disabled}
              className={cx(it.tone && `kimo-canvas-menu__item--${it.tone}`)}
              onSelect={() => {
                onClose()
                it.onSelect()
              }}
            />
          ))}
        </Fragment>
      ))}
    </MenuDense>
  )
}
