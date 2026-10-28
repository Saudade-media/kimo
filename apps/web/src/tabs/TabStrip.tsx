/**
 * Board 44 "Workspace v2" §1 "Tab Strip" (6LTyzBnoUm) and §4 "Tabs" (MMjjdnZ0Ne): fill × 46,
 * bg-muted, bottom stroke 1 border, row, gap 8, padding [0, 8, 0, 16], center: Traffic Lights ·
 * Tab · Home (32 × 28) · Divider (1 × 16, border-strong) · file tabs · New tab (28 × 28).
 *
 * Tab (4yDGRrDlbH): h 28, radius-sm, row, gap 6, padding [0, 6, 0, 10], center: File icon 13 ·
 * Name (text-sm 500) · Unsaved dot (6, text-secondary) · Close (16, radius-xs, `x` 12). Active:
 * bg-app + border, icon and name text-primary; inactive: icon text-tertiary, name
 * text-secondary; hover: bg-hover; Close hover: bg-muted, `x` text-primary.
 *
 * §4 C drag out (desktop): below the strip the tab follows the pointer as a ghost (bg-app,
 * border, shadow 0 8 24 shadow-strong, rotated -2°) over the "Release to open in a new window"
 * hint (24, radius-pill, accent), and its slot stays open (dashed border-strong 3 / 3 with a 4
 * dot). §4 D: tabs shrink to 120 and names ellipsize; past that the tabs scroll with 80 wide
 * edge fades, the active tab kept in view.
 *
 * The strip is the window's title bar on desktop (`data-tauri-drag-region` on the strip and the
 * free space after New tab; the tabs and buttons never drag the window). On the web it sits at
 * the top of the page with no traffic lights.
 */
import type { KimoPlatform } from "@kimo/platform"
import { TrafficLights } from "@kimo/ui"
import {
  type CSSProperties,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useSessionState, useSessions, useWindowChrome } from "../files/hooks"
import { getFile } from "../lib/files"
import { Icon } from "../lib/icons"
import { isUntitledRef, UNTITLED_NAME } from "../platform/contract"
import { fileNameOf } from "../platform/format"
import type { FileDocumentSession, FileSessionManager } from "../platform/session"
import type { TabsController } from "./controller"
import { dropIndex, type Tab } from "./model"
import "./tabs.css"

/** Pointer travel before a press on a tab becomes a drag. */
const DRAG_SLOP = 4

/** A file name as the tab shows it ("Landing", no extension). */
function tabName(fileName: string): string {
  return fileName.replace(/\.(kimo|kimoz|pen)$/i, "") || fileName
}

export function TabStrip({
  tabs,
  manager,
  platform,
}: {
  tabs: TabsController
  manager: FileSessionManager
  platform: KimoPlatform
}) {
  const state = useSyncExternalStore(tabs.subscribe, tabs.getState)
  const chrome = useWindowChrome(platform)
  // Re-render when sessions open or close (names and unsaved dots follow them).
  useSessions(manager)
  const strip = useRef<HTMLDivElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const [fade, setFade] = useState({ start: false, end: false, tight: false })
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag
  /** A drag just ended: the click that follows it doesn't switch tabs. */
  const suppressClick = useRef(false)

  // §4 D: tabs hug their names until the strip runs out of room ("tight"), then shrink to 120
  // with ellipsized names; past that they scroll, with edge fades on the hidden side.
  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const start = el.scrollLeft > 0
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    const overflow = el.scrollWidth > el.clientWidth + 1
    const truncated = [...el.querySelectorAll<HTMLElement>(".tab__name")].some(
      (n) => n.scrollWidth > n.clientWidth + 1,
    )
    const tight = overflow || truncated
    setFade((f) =>
      f.start === start && f.end === end && f.tight === tight ? f : { start, end, tight },
    )
  }, [])
  useLayoutEffect(() => {
    measure()
  })
  // §4 D: the active tab is kept in view (when it changes and when the strip resizes).
  const reveal = useCallback(() => {
    const el = scroller.current
    const tab = el?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!el || !tab) return
    const a = tab.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (a.left < r.left) el.scrollLeft -= r.left - a.left
    else if (a.right > r.right) el.scrollLeft += a.right - r.right
  }, [])
  useEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => {
      measure()
      reveal()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, reveal])
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the active tab or the tab widths change.
  useEffect(() => reveal(), [state.active, fade.tight, reveal])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, tab: Tab) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest(".tab__close")) return
    suppressClick.current = false
    const rect = e.currentTarget.getBoundingClientRect()
    setDrag({
      id: tab.id,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      width: rect.width,
      moved: false,
      out: false,
    })
  }

  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_SLOP
    if (!moved) return
    const bottom = strip.current?.getBoundingClientRect().bottom ?? 0
    // §4 C: below the strip (desktop) the tab is dragged out; the web only reorders.
    const out = e.clientY > bottom && tabs.canDragOut(d.id)
    if (!out) {
      const els = [...(scroller.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [])]
      const others = els.filter((el) => el.dataset.tabId !== d.id)
      const mids = others.map((el) => {
        const r = el.getBoundingClientRect()
        return r.left + r.width / 2
      })
      tabs.move(d.id, dropIndex(e.clientX, mids))
    }
    setDrag({ ...d, x: e.clientX, y: e.clientY, moved: true, out })
  }

  const onPointerUp = () => {
    const d = dragRef.current
    if (!d) return
    setDrag(null)
    if (!d.moved) return
    suppressClick.current = true
    if (d.out) void tabs.dragOut(d.id)
  }

  // The pointer is followed on the window: the dragged tab turns into its slot mid-drag.
  const pressed = drag !== null
  const handlers = useRef({ onPointerMove, onPointerUp })
  handlers.current = { onPointerMove, onPointerUp }
  useEffect(() => {
    if (!pressed) return
    const move = (e: PointerEvent) => handlers.current.onPointerMove(e)
    const up = () => handlers.current.onPointerUp()
    const cancel = () => setDrag(null)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
    }
  }, [pressed])

  const lights = chrome.inset >= 68
  const draggedOut = drag?.out ? state.tabs.find((t) => t.id === drag.id) : undefined

  return (
    <div
      ref={strip}
      className="tab-strip"
      data-pen="6LTyzBnoUm"
      data-tauri-drag-region=""
      role="tablist"
      aria-label="Open files"
    >
      {lights && (
        // The design's 16 strip padding is the lights' leading: the native lights sit at x 16.
        <TrafficLights
          className="tab-strip__lights"
          inset={chrome.inset - 16}
          leading={0}
          focused={chrome.focused}
          drawLights={false}
        />
      )}
      <button
        type="button"
        role="tab"
        aria-selected={state.active === null}
        aria-label="Home"
        title="Home"
        className={`tab-strip__home${state.active === null ? " tab-strip__home--active" : ""}`}
        onClick={() => tabs.activate(null)}
      >
        <Icon name="house" size={14} />
      </button>
      <span className="tab-strip__divider" aria-hidden="true" />
      <div className="tab-strip__scroll">
        <div
          className="tab-strip__tabs"
          ref={scroller}
          onScroll={measure}
          data-tight={fade.tight ? "" : undefined}
        >
          {state.tabs.map((tab) =>
            drag?.out && drag.id === tab.id ? (
              <span
                key={tab.id}
                className="tab-slot"
                data-tab-id={tab.id}
                style={{ width: drag.width }}
                aria-hidden="true"
              >
                <svg className="tab-slot__outline" aria-hidden="true">
                  <rect x="0.5" y="0.5" rx="5.5" ry="5.5" />
                </svg>
                <span className="tab-slot__dot" />
              </span>
            ) : (
              <TabItem
                key={tab.id}
                tab={tab}
                active={state.active === tab.id}
                manager={manager}
                dragging={drag?.moved === true && drag.id === tab.id}
                onPointerDown={(e) => onPointerDown(e, tab)}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false
                    return
                  }
                  tabs.activate(tab.id)
                }}
                onClose={() => void tabs.close(tab.id)}
              />
            ),
          )}
        </div>
        {fade.start && <span className="tab-strip__fade tab-strip__fade--start" />}
        {fade.end && <span className="tab-strip__fade tab-strip__fade--end" />}
      </div>
      <button
        type="button"
        className="tab-strip__new"
        aria-label="New tab"
        title="New tab"
        onClick={() => tabs.newTab()}
      >
        <Icon name="plus" size={14} />
      </button>
      <span className="tab-strip__drag" data-tauri-drag-region="" />
      {drag && draggedOut && (
        <div
          className="tab-drag"
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy } as CSSProperties}
          aria-hidden="true"
        >
          <TabItem tab={draggedOut} active={false} ghost manager={manager} dragging={false} />
          <span className="tab-drag__hint">
            <Icon name="app-window" size={12} />
            Release to open in a new window
          </span>
        </div>
      )}
    </div>
  )
}

interface DragState {
  id: string
  startX: number
  startY: number
  x: number
  y: number
  /** Grab point inside the tab. */
  dx: number
  dy: number
  /** The tab's width (its slot keeps it). */
  width: number
  moved: boolean
  /** Below the strip: released, it opens in a new window. */
  out: boolean
}

function TabItem({
  tab,
  active,
  ghost = false,
  manager,
  dragging,
  onPointerDown,
  onClick,
  onClose,
}: {
  tab: Tab
  active: boolean
  ghost?: boolean
  manager: FileSessionManager
  dragging: boolean
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void
  onClick?: () => void
  onClose?: () => void
}) {
  const target = tab.target
  const session = target?.kind === "disk" ? manager.get(target.ref) : undefined
  const cls = ["tab", active && "tab--active", ghost && "tab--ghost", dragging && "tab--dragging"]
    .filter(Boolean)
    .join(" ")
  const body = (name: string, unsaved: boolean) => (
    <div
      className={cls}
      role="tab"
      aria-selected={active}
      tabIndex={ghost ? undefined : active ? 0 : -1}
      title={ghost ? undefined : name}
      data-tab-id={ghost ? undefined : tab.id}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick?.()
        }
      }}
      // §5 "Switch": a middle click closes the tab.
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        onClose?.()
      }}
    >
      {/* A new tab shows Home until a file is picked there. */}
      <Icon name={target ? "file" : "house"} size={13} className="tab__icon" />
      <span className="tab__name">{name}</span>
      {unsaved && <span className="tab__dot" role="img" aria-label="Unsaved changes" />}
      <button
        type="button"
        className="tab__close"
        aria-label={`Close ${name}`}
        tabIndex={-1}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClose?.()
        }}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  )
  if (session) return <SessionTab session={session} render={body} />
  if (target?.kind === "file") return <LibraryTab id={target.id} active={active} render={body} />
  if (target?.kind === "disk")
    return body(isUntitledRef(target.ref) ? UNTITLED_NAME : tabName(fileNameOf(target.ref)), false)
  return body("Home", false)
}

/** A tab whose file is open: its name and unsaved dot follow the session. */
function SessionTab({
  session,
  render,
}: {
  session: FileDocumentSession
  render: (name: string, unsaved: boolean) => ReactElement
}) {
  const s = useSessionState(session)
  const status = s.saveStatus
  // The dot marks edits nothing will write on its own: a never-saved document with edits, or a
  // file while autosave is off. With autosave on the file is written within seconds.
  const unsaved = session.untitled
    ? session.needsClosePrompt
    : status.kind === "unsaved" && status.autosaveAt === null
  return render(tabName(s.fileName), unsaved)
}

/** A browser library file (`#/file/:id`): its name from the file index. */
function LibraryTab({
  id,
  active,
  render,
}: {
  id: string
  active: boolean
  render: (name: string, unsaved: boolean) => ReactElement
}) {
  const [name, setName] = useState<string | null>(null)
  // Re-read when the tab is focused or left (a rename in the editor).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` is the refresh trigger.
  useEffect(() => {
    let live = true
    void getFile(id)
      .then((m) => live && m && setName(m.name))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [id, active])
  return render(name ?? "Untitled", false)
}
