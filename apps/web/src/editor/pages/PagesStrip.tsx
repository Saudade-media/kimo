/**
 * Board 27 §1 (a) lid8E "Pages" (k801nc) at the top of the Layers tab, (b) Zq3KS reorder / page
 * menu / delete confirm, (d) wsA6U footer.
 *
 * Pages (k801nc): column, gap 1, padding [4, 6, 8, 6], bottom border. Pages Header (vs31B):
 * 28 high, gap 4, padding [0, 2, 0, 8], centered: Collapse chevron 12 text-tertiary · Title
 * "Pages" sans text-sm 500 text-primary · Spacer · Add page (IconButton 24, transparent fill,
 * plus 14). Rows: PageRow / PageRow/Current; at most 6 visible, then the list scrolls; the
 * collapsed strip is just the header (state per file).
 */
import { pagesOf } from "@kimo/editor-state"
import {
  Dialog,
  DialogScrim,
  DropIndicator,
  IconButton,
  Kbd,
  MenuDense,
  MenuDivider,
  MenuItemDense,
  PageRow,
} from "@kimo/ui"
import { useEffect, useMemo, useRef, useState } from "react"
import { useDocHeader } from "../../lib/header"
import { useTreeRevision, useUi } from "../../lib/hooks"
import { Icon } from "../../lib/icons"
import type { M3Controller } from "../m3/controller"
import type { FileSession } from "../session"
import {
  activatePage,
  addPage,
  deletePage,
  duplicatePage,
  movePage,
  pageLayers,
  renamePage,
} from "./actions"
import { activePageId } from "./model"
import "./pages.css"

/** PageRow height (28) + strip gap (1). */
const ROW_PITCH = 29
/** Rows visible before the strip scrolls (rules WqZ84 "max 6 rows then scrolls"). */
const MAX_ROWS = 6

const collapsedKey = (fileId: string) => `kimo.pagesCollapsed.${fileId}`

function readCollapsed(fileId: string): boolean {
  try {
    return localStorage.getItem(collapsedKey(fileId)) === "1"
  } catch {
    return false
  }
}

/** The page list of the store, kept current with header changes. */
export function usePageList(session: FileSession) {
  const header = useDocHeader(session.store)
  const page = useUi(session.ui, (s) => s.page)
  return useMemo(() => {
    void header
    const pages = pagesOf(session.store)
    return { pages, active: activePageId(session.store, page) }
  }, [header, page, session.store])
}

interface DragState {
  id: string
  from: number
  /** Slot index among all rows (0 … n): the gap the dragged row would land in. */
  slot: number
  y: number
  startY: number
}

export function PagesStrip({ session, m3 }: { session: FileSession; m3: M3Controller }) {
  const { pages, active } = usePageList(session)
  const ctx = useMemo(() => ({ session, m3 }), [session, m3])
  const [collapsed, setCollapsed] = useState(() => readCollapsed(session.id))
  /** The page being renamed (`id` null = the implicit page of a one-page document). */
  const [renaming, setRenaming] = useState<{ id: string | null } | null>(null)
  const [menu, setMenu] = useState<{ id: string | null; x: number; y: number } | null>(null)
  const [confirm, setConfirm] = useState<{ id: string; name: string; layers: number } | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const list = useRef<HTMLDivElement>(null)

  // "Copy link to page": a link with `page=<id>` opens on that page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per mounted file
  useEffect(() => {
    const query = location.hash.split("?")[1]
    const id = query ? new URLSearchParams(query).get("page") : null
    if (id && pagesOf(session.store).some((p) => p.id === id)) activatePage(ctx, id)
  }, [session.id])

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(collapsedKey(session.id), c ? "0" : "1")
      } catch {
        // per-viewer convenience only
      }
      return !c
    })
  }

  const onAdd = () => {
    const id = addPage(ctx)
    if (id) {
      setCollapsed(false)
      setRenaming({ id })
    }
  }

  const askDelete = (id: string | null) => {
    if (id === null || pages.length <= 1) return
    const p = pages.find((x) => x.id === id)
    setConfirm({ id, name: p?.name ?? "", layers: pageLayers(session, id) })
  }

  // --- reorder (drag a row; Between indicator in the gap; Esc cancels) ---------------------------
  useEffect(() => {
    if (!drag) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        setDrag(null)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [drag])

  const slotAt = (clientY: number): number => {
    const el = list.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    const y = clientY - r.top + el.scrollTop
    return Math.max(0, Math.min(pages.length, Math.round(y / ROW_PITCH)))
  }

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, id: string | null, from: number) => {
    if (e.button !== 0 || id === null || renaming) return
    const startY = e.clientY
    const target = e.currentTarget
    const pointerId = e.pointerId
    let started = false
    const move = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientY - startY) < 4) return
      if (!started) {
        started = true
        target.setPointerCapture?.(pointerId)
      }
      setDrag({ id, from, slot: slotAt(ev.clientY), y: ev.clientY, startY })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      if (!started) return
      setDrag((d) => {
        if (d && d.id === id) {
          const slot = slotAt(ev.clientY)
          // Slot index among all rows → index among the others (the dragged row removed).
          const index = slot > from ? slot - 1 : slot
          if (index !== from) movePage(ctx, id, index)
        }
        return null
      })
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  const visibleRows = Math.min(pages.length, MAX_ROWS)
  const menuPage = menu ? pages.findIndex((p) => p.id === menu.id) : -1

  return (
    <div className="pages-strip" data-collapsed={collapsed || undefined}>
      <div className="pages-strip__header">
        <button
          type="button"
          className="pages-strip__collapse"
          aria-label={collapsed ? "Expand pages" : "Collapse pages"}
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
        >
          <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={12} />
        </button>
        <span className="pages-strip__title">Pages</span>
        <span className="pages-strip__spacer" />
        <IconButton
          size="sm"
          tone="ghost"
          className="pages-strip__add"
          label="Add page"
          icon={<Icon name="plus" size={14} />}
          onClick={onAdd}
        />
      </div>
      {!collapsed && (
        <div
          ref={list}
          className="pages-strip__list"
          role="listbox"
          aria-label="Pages"
          style={{ maxHeight: MAX_ROWS * ROW_PITCH - 1 }}
          data-rows={visibleRows}
        >
          {pages.map((p, i) => {
            const id = p.id
            const current = id === active
            const dragged = drag?.id === id && drag !== null
            return (
              <PageRow
                key={id ?? "implicit"}
                data-page-id={id ?? ""}
                name={p.name}
                current={current}
                renaming={renaming !== null && renaming.id === id}
                className={dragged ? "pages-strip__row--dragging" : undefined}
                onPointerDown={(e) => startDrag(e, id, i)}
                onClick={() => {
                  if (!renaming) activatePage(ctx, id)
                }}
                onDoubleClick={() => setRenaming({ id })}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ id, x: e.clientX, y: e.clientY })
                }}
                onMenu={(anchor) => {
                  const r = anchor.getBoundingClientRect()
                  setMenu({ id, x: r.left, y: r.bottom + 4 })
                }}
                onRename={(name) => renamePage(ctx, id, name)}
                onRenameEnd={() => setRenaming(null)}
              />
            )
          })}
          {drag && (
            <DropIndicator
              className="pages-strip__drop"
              style={{ top: drag.slot * ROW_PITCH - 4.5 - (list.current?.scrollTop ?? 0) }}
            />
          )}
          {drag && (
            <PageRow
              className="pages-strip__ghost"
              name={pages.find((p) => p.id === drag.id)?.name ?? ""}
              style={{ top: drag.from * ROW_PITCH + (drag.y - drag.startY) }}
              aria-hidden="true"
            />
          )}
        </div>
      )}
      {menu && (
        <MenuDense
          className="pages-strip__menu"
          width={196}
          label="Page menu"
          autoFocus
          onClose={() => setMenu(null)}
          anchor={{ x: menu.x, y: menu.y, width: 0, height: 0 }}
        >
          <MenuItemDense
            label="Rename"
            meta="Dbl-click"
            metaFont="sans"
            onSelect={() => {
              setRenaming({ id: menu.id })
              setMenu(null)
            }}
          />
          <MenuItemDense
            label="Duplicate page"
            onSelect={() => {
              duplicatePage(ctx, menu.id)
              setMenu(null)
            }}
          />
          <MenuItemDense
            label="Copy link to page"
            disabled={menu.id === null}
            onSelect={() => {
              if (menu.id) void copyPageLink(menu.id)
              setMenu(null)
            }}
          />
          <MenuDivider />
          <MenuItemDense
            label="Move up"
            disabled={menuPage <= 0}
            onSelect={() => {
              if (menu.id) movePage(ctx, menu.id, menuPage - 1)
              setMenu(null)
            }}
          />
          <MenuItemDense
            label="Move down"
            disabled={menuPage < 0 || menuPage >= pages.length - 1}
            onSelect={() => {
              if (menu.id) movePage(ctx, menu.id, menuPage + 1)
              setMenu(null)
            }}
          />
          <MenuDivider />
          <MenuItemDense
            className="pages-strip__menu-delete"
            label="Delete page…"
            meta="⌫"
            disabled={pages.length <= 1}
            onSelect={() => {
              askDelete(menu.id)
              setMenu(null)
            }}
          />
        </MenuDense>
      )}
      {confirm && (
        <DialogScrim>
          <Dialog
            size="sm"
            icon={<Icon name="trash-2" size={16} />}
            title={`Delete “${confirm.name}”?`}
            description={`Its ${confirm.layers} ${confirm.layers === 1 ? "layer is" : "layers are"} removed from this file. You can undo with ⌘Z until you close the file.`}
            confirmLabel="Delete page"
            confirmTone="danger"
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              deletePage(ctx, confirm.id, true)
              setConfirm(null)
            }}
          />
        </DialogScrim>
      )}
    </div>
  )
}

/** "Copy link to page": the editor URL with `page=<id>` (opening it activates the page). */
async function copyPageLink(id: string): Promise<void> {
  const url = new URL(location.href)
  const [route, query = ""] = url.hash.split("?")
  const params = new URLSearchParams(query)
  params.set("page", id)
  url.hash = `${route}?${params.toString()}`
  try {
    await navigator.clipboard.writeText(url.toString())
  } catch {
    // Clipboard denied (no user activation): nothing else to do.
  }
}

/**
 * Board 27 §1 (d) wsA6U: the footer is a button — "1 page" / "N pages" (live) and Kbd ⌘P; click
 * opens the quick switcher. Hover: bg-hover, icon text-secondary, label text-primary.
 */
export function PagesFooter({
  session,
  onOpenSwitcher,
}: {
  session: FileSession
  onOpenSwitcher(): void
}) {
  const { pages } = usePageList(session)
  // Live on add / delete / undo (header changes) and root moves.
  useTreeRevision(session.store)
  const n = pages.length
  return (
    <button type="button" className="left-panel__footer pages-footer" onClick={onOpenSwitcher}>
      <span className="left-panel__footer-icon">
        <Icon name="files" size={14} />
      </span>
      <span className="left-panel__footer-label">{n === 1 ? "1 page" : `${n} pages`}</span>
      <span className="left-panel__footer-spacer" />
      <Kbd>⌘P</Kbd>
    </button>
  )
}
