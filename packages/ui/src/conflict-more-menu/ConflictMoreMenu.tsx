import { GitMerge } from "lucide-react"
import { type ComponentPropsWithRef, type KeyboardEvent, useEffect, useMemo, useRef } from "react"
import { middleTruncate } from "../file-row/middle-truncate"
import { cx, mergeRefs } from "../internal/util"
import type { PlacementOptions } from "../popover/position"
import {
  floating,
  type PopoverAnchor,
  useAnchoredPosition,
  useDismiss,
} from "../popover/usePopover"

/** One hidden conflict in the "+N" menu. */
export interface ConflictMoreItem {
  id: string
  /** Layer path segments, outermost first: ["Pricing", "Cards", "Item 3"]. */
  path: readonly string[]
  /** Meta: the conflicted property ("fill", "text"). */
  meta: string
}

/** Board 24 (l) widths: fixed 240, min 200, grows to max 320 only for long names. */
export const CONFLICT_MENU_WIDTH = { base: 240, min: 200, max: 320 } as const
/** Rows shown before the menu scrolls. */
export const CONFLICT_MENU_MAX_ROWS = 8

const PAD = 4 // menu padding
const ITEM_PAD = 8 // item padding-x
const ICON = 14
const GAP = 8
const ROW = 28
const GROUP = 25 // group label: 6 + 15 + 4

type Measure = (text: string, font: "label" | "meta") => number

/**
 * Middle-truncates a layer path by whole segments ("Pricing / … / Item 3"), then by characters
 * when even "first / … / last" does not fit.
 */
export function middleTruncatePath(
  path: readonly string[],
  maxWidth: number,
  measure: (s: string) => number,
): string {
  const sep = " / "
  const full = path.join(sep)
  if (path.length <= 2 || measure(full) <= maxWidth) return middleTruncate(full, maxWidth, measure)
  const first = path[0] as string
  // Keep as many trailing segments as fit after "first / … / ".
  for (let keep = path.length - 2; keep >= 1; keep--) {
    const s = [first, "…", ...path.slice(path.length - keep)].join(sep)
    if (measure(s) <= maxWidth) return s
  }
  return middleTruncate(`${first}${sep}…${sep}${path[path.length - 1]}`, maxWidth, measure)
}

/** Menu width for these items: 240, growing to 320 for long names, never under 200. */
export function conflictMenuWidth(
  items: readonly ConflictMoreItem[],
  measure: Measure,
  viewport = Number.POSITIVE_INFINITY,
): number {
  let need = 0
  for (const it of items) {
    const w =
      2 * PAD +
      2 * ITEM_PAD +
      ICON +
      3 * GAP +
      measure(it.path.join(" / "), "label") +
      measure(it.meta, "meta")
    need = Math.max(need, Math.ceil(w))
  }
  const { base, min, max } = CONFLICT_MENU_WIDTH
  const w = Math.min(Math.max(need, base), max)
  return Math.max(min, Math.min(w, viewport))
}

let canvas: HTMLCanvasElement | null = null
function canvasMeasure(): Measure {
  if (typeof document === "undefined") return (t, f) => t.length * (f === "meta" ? 6.6 : 6.2)
  canvas ??= document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) return (t, f) => t.length * (f === "meta" ? 6.6 : 6.2)
  const css = getComputedStyle(document.documentElement)
  const sans = css.getPropertyValue("--kimo-font-sans").trim() || "Inter, sans-serif"
  const mono = css.getPropertyValue("--kimo-font-mono").trim() || "monospace"
  return (t, f) => {
    ctx.font = f === "meta" ? `400 11px ${mono}` : `400 12px ${sans}`
    return ctx.measureText(t).width
  }
}

/** Props for {@link ConflictMoreMenu}. Remaining `<div>` props go to the menu frame. */
export interface ConflictMoreMenuProps extends Omit<ComponentPropsWithRef<"div">, "onSelect"> {
  items: readonly ConflictMoreItem[]
  /** Row click: select + zoom to the conflicted node. */
  onSelect: (id: string) => void
  onClose: () => void
  anchor?: PopoverAnchor
  placement?: PlacementOptions
  /** Text measurement (tests); the 2D canvas with the label fonts by default. */
  measure?: Measure
}

/**
 * Board 24 (l) "Conflict '+N' menu" (c2CNAR › Menu · conflicts OJl8h): column, padding 4, width
 * 240 (min 200, max 320), bg-overlay, stroke 1 border, radius-md, shadow 0 8 24 shadow-strong.
 *   Group (aKs8f) padding [6, 8, 4, 8] › "2 MORE CONFLICTS" mono 11 text-tertiary.
 *   Item (XJjNE) row, gap 8, padding [0, 8], h 28, radius-sm, center: `git-merge` 14 danger ·
 *     Label sans 12 text-primary (middle-truncated path) · Spacer · Meta mono 11 text-tertiary.
 * Scrolls after 8 rows. ↑ / ↓ move, Enter selects, Escape / outside press close.
 */
export function ConflictMoreMenu({
  items,
  onSelect,
  onClose,
  anchor,
  placement,
  measure,
  className,
  style,
  ref,
  ...rest
}: ConflictMoreMenuProps) {
  const root = useRef<HTMLDivElement>(null)
  const pos = useAnchoredPosition(root, anchor, placement)
  useDismiss(root, onClose, anchor)
  const m = useMemo(() => measure ?? canvasMeasure(), [measure])
  const viewport = typeof window !== "undefined" ? window.innerWidth - 16 : Number.POSITIVE_INFINITY
  const width = conflictMenuWidth(items, m, viewport)
  const rows = items.map((it) => {
    const labelMax = width - 2 * PAD - 2 * ITEM_PAD - ICON - 3 * GAP - m(it.meta, "meta")
    return { ...it, label: middleTruncatePath(it.path, labelMax, (s) => m(s, "label")) }
  })
  const maxHeight = 2 * PAD + GROUP + CONFLICT_MENU_MAX_ROWS * ROW
  const ready = !pos || pos.ready
  useEffect(() => {
    if (!ready) return
    root.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true })
  }, [ready])
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = [...(root.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])]
    const i = list.indexOf(document.activeElement as HTMLElement)
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const n = list.length
      if (n === 0) return
      const next = e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n
      list[next]?.focus()
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault()
      list[e.key === "Home" ? 0 : list.length - 1]?.focus()
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }
  return floating(
    <div
      role="menu"
      aria-label={`${items.length} more conflicts`}
      {...rest}
      ref={mergeRefs(root, ref)}
      className={cx("kimo-conflict-more-menu", className)}
      style={{
        width,
        maxHeight,
        ...(pos
          ? {
              position: "fixed",
              left: pos.x,
              top: pos.y,
              visibility: pos.ready ? undefined : "hidden",
            }
          : {}),
        ...style,
      }}
      onKeyDown={onKeyDown}
    >
      <div className="kimo-conflict-more-menu__group" role="presentation">
        <span className="kimo-conflict-more-menu__group-label">
          {`${items.length} more conflict${items.length === 1 ? "" : "s"}`.toUpperCase()}
        </span>
      </div>
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="kimo-conflict-more-menu__item"
          title={r.label !== r.path.join(" / ") ? r.path.join(" / ") : undefined}
          data-conflict-id={r.id}
          onClick={() => onSelect(r.id)}
        >
          <GitMerge className="kimo-conflict-more-menu__icon" aria-hidden="true" />
          <span className="kimo-conflict-more-menu__label">{r.label}</span>
          <span className="kimo-conflict-more-menu__spacer" aria-hidden="true" />
          <span className="kimo-conflict-more-menu__meta">{r.meta}</span>
        </button>
      ))}
    </div>,
    anchor,
  )
}
