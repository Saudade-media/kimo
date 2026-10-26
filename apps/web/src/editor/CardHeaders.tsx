/**
 * Board 44 "Workspace v2" card headers: they replace the editor topbar (board 03 fYEz3 / board
 * 16 XDqrb). Both are "Card Header" frames: fill × 44, bottom stroke 1 border, row, padding
 * [0, 8, 0, 10], space-between, center (wNJcXZthFH / LKu07Q787a). Collapsed (§3), the card is
 * its header as a pill: hug width, gap 8, no bottom stroke (SOGylzbGrC / eWwNzMIgXj).
 *
 * - {@link LeftCardHeader}: File Menu (GdMuPj2aQw: h 28, radius-sm, row gap 6, padding
 *   [0, 6, 0, 4], center; KimoLogo 20, file name text-base 600 text-primary, chevron-down 12
 *   text-tertiary) opening the board 20 File menu, and Collapse (41brCkpWwF: 28 × 28, radius-sm,
 *   panel-left 16 text-secondary; collapsed panel-left-open).
 * - {@link RightCardHeader}: People (nF856tRgIb: row gap 8, center; presence + Share) and View
 *   (iXGvkzDzGN: row gap 2, center; Zoom h 28 radius-sm gap 4 padding [0, 6] "100%" mono
 *   text-sm text-secondary + chevron-down 12 text-tertiary, Play 28 × 28 play 16, Collapse
 *   panel-right / panel-right-open).
 *
 * Not in board 44's headers, kept so no behavior is lost: the save / sync status shows in the
 * left header only while it needs attention (anything but saved / synced), and the agent
 * presence chip (board 21) leads the People group. The window chrome (traffic-light inset and
 * drag region) lives in the left header until the tab strip owns it.
 */
import type { RecentFile } from "@kimo/platform"
import type { SyncStatus } from "@kimo/sync"
import { KimoLogo, Tooltip } from "@kimo/ui"
import { createContext, type ReactNode, useEffect, useState } from "react"
import type { CanvasHandle, UiStore } from "../canvas/contract"
import { useCanvasViewPrefs } from "../canvas/view-prefs"
import { useUi } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { useRuntime } from "../platform/runtime"
import { runHelpAction } from "../settings/help"
import { shortcutLabel } from "../shortcuts/shortcuts"
import { FileMenu, type FileMenuActions, newWindowAction, RECENT_LIMIT } from "./FileMenu"
import { useFailureToast } from "./failure-toast"
import { togglePanel, usePanels } from "./panels"
import { ViewMenu } from "./ViewMenu"

export type { FileMenuActions } from "./FileMenu"

/** Recent files for the File menu's "Open recent", loaded while `active`. */
export function useRecentFiles(active: boolean): readonly RecentFile[] | null {
  const { platform } = useRuntime()
  const [files, setFiles] = useState<readonly RecentFile[] | null>(null)
  useEffect(() => {
    if (!active) return
    let live = true
    const load = () =>
      void platform.recents
        .listFiles({ limit: RECENT_LIMIT })
        .then((f) => live && setFiles(f))
        .catch(() => live && setFiles([]))
    load()
    const off = platform.recents.onChange(load)
    return () => {
      live = false
      off()
    }
  }, [active, platform])
  return files
}

/**
 * The File menu bound to a trigger element: open state, recents, "Clear recent". Render
 * `menu` next to the trigger; `toggle(el)` opens or closes it.
 */
export function useFileMenu(actions: FileMenuActions) {
  const { platform } = useRuntime()
  const fail = useFailureToast()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const recents = useRecentFiles(anchor !== null)
  const close = () => setAnchor(null)
  return {
    open: anchor !== null,
    toggle: (el: HTMLElement) => setAnchor((a) => (a ? null : el)),
    close,
    menu: anchor ? (
      <FileMenu
        {...actions}
        onNewWindow={newWindowAction(
          platform.os,
          platform.window.openNewWindow?.bind(platform.window),
          fail,
        )}
        anchor={anchor}
        os={platform.os}
        recents={recents}
        help={{
          version: platform.appVersion,
          logs: platform.help !== undefined,
          run: runHelpAction,
        }}
        onClearRecent={() =>
          void platform.recents.clearFiles().catch((e: unknown) => fail("clear recent files", e))
        }
        onClose={() => {
          close()
          anchor.focus({ preventScroll: true })
        }}
      />
    ) : null,
  }
}

/**
 * A browser library file's status (board 03 Saved GwjIf: gap 6, padding [0, 8]; icon 14 and
 * label 12 text-tertiary), only while it needs attention: "Not saved" and "Read-only". Saving
 * and saved stay quiet (every edit autosaves to IndexedDB).
 */
const LIBRARY_ATTENTION: Partial<Record<SyncStatus, [icon: string, label: string]>> = {
  error: ["cloud-alert", "Not saved"],
  "read-only": ["cloud-alert", "Read-only"],
}

export function LibrarySaveStatus({ status }: { status: SyncStatus }) {
  const attention = LIBRARY_ATTENTION[status]
  if (!attention) return null
  return (
    <span className="topbar__saved" data-status={status}>
      <span className="topbar__saved-icon">
        <Icon name={attention[0]} size={14} />
      </span>
      <span className="topbar__saved-label">{attention[1]}</span>
    </span>
  )
}

/**
 * Whether the editor owns the window chrome (true): on macOS the left card header leaves room
 * for the traffic lights. A tab strip rendered above the editor that draws the lights and the
 * drag region provides false.
 */
export const EditorChromeContext = createContext(true)

/** Card x (8) + Card Header left padding (10): where the header's content starts in the window. */
const HEADER_CONTENT_X = 18
/** The old topbar's gap after the traffic-light inset. */
const LIGHTS_GAP = 8

/** Collapse (41brCkpWwF / hXXSelgxeV): 28 × 28, radius-sm, no fill, icon 16 text-secondary. */
function CollapseButton({ side, collapsed }: { side: "left" | "right"; collapsed: boolean }) {
  const label = `${collapsed ? "Show" : "Hide"} ${side} panel`
  return (
    <Tooltip label={label} shortcut={shortcutLabel("togglePanels")}>
      <button
        type="button"
        className="card-header__icon-button card-header__collapse"
        aria-label={label}
        aria-expanded={!collapsed}
        onClick={() => togglePanel(side)}
      >
        <Icon name={collapsed ? `panel-${side}-open` : `panel-${side}`} size={16} />
      </button>
    </Tooltip>
  )
}

export interface LeftCardHeaderProps extends FileMenuActions {
  fileName: string
  /** Double-click renames (browser library files); omitted: no rename. */
  onRename?: (name: string) => void
  /** The save / sync status while it needs attention (null: quiet). */
  status?: ReactNode
  /** The document's save status kind, exposed as `data-save-status` (tests, styling). */
  saveStatus?: string
  /**
   * The window's traffic-light inset (`platform.window.trafficLightInset()`): 68 on macOS with
   * the overlay title bar. The header leaves room for the lights until the tab strip owns them.
   */
  lightsInset?: number
  collapsed: boolean
}

/** Board 44 Left Card › Card Header (wNJcXZthFH). */
export function LeftCardHeader({
  fileName,
  onRename,
  status,
  saveStatus,
  lightsInset = 0,
  collapsed,
  ...actions
}: LeftCardHeaderProps) {
  const [renaming, setRenaming] = useState(false)
  const fileMenu = useFileMenu(actions)
  // Without a tab strip (EditorChromeContext true) the macOS lights sit over the header's leading edge:
  // the File Menu starts where the old topbar's breadcrumb did, 8 after the inset.
  const lights = lightsInset >= 68 ? lightsInset - HEADER_CONTENT_X + LIGHTS_GAP : 0
  return (
    <header className="card-header card-header--left" data-save-status={saveStatus}>
      {renaming ? (
        <input
          className="topbar__file-input"
          style={lights > 0 ? { marginLeft: lights } : undefined}
          aria-label="File name"
          defaultValue={fileName}
          // biome-ignore lint/a11y/noAutofocus: rename was explicitly requested
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            setRenaming(false)
            const v = e.currentTarget.value.trim()
            if (v && v !== fileName) onRename?.(v)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
            if (e.key === "Escape") {
              e.currentTarget.value = fileName
              e.currentTarget.blur()
            }
          }}
        />
      ) : (
        <button
          type="button"
          className={
            fileMenu.open
              ? "topbar__file card-header__file topbar__file--open"
              : "topbar__file card-header__file"
          }
          style={lights > 0 ? { marginLeft: lights } : undefined}
          aria-haspopup="menu"
          aria-expanded={fileMenu.open}
          onClick={(e) => fileMenu.toggle(e.currentTarget)}
          {...(onRename
            ? {
                onDoubleClick: () => {
                  fileMenu.close()
                  setRenaming(true)
                },
              }
            : {})}
        >
          <KimoLogo size={20} />
          <span className="topbar__file-name">{fileName}</span>
          <span className="topbar__file-icon">
            <Icon name={fileMenu.open ? "chevron-up" : "chevron-down"} size={12} />
          </span>
        </button>
      )}
      {fileMenu.menu}
      {status != null && <span className="card-header__status">{status}</span>}
      <CollapseButton side="left" collapsed={collapsed} />
    </header>
  )
}

export interface RightCardHeaderProps {
  ui: UiStore
  canvas: () => CanvasHandle | null
  onPreview(): void
  /**
   * Board 27 §9 (b) mtgng: the frame Preview will open (tooltip "Preview “<name>”"); null = the
   * page has no top-level frame (button at 40 %, "Page has no frames"); undefined = unknown.
   */
  previewTarget?: string | null
  /** People: the agent presence chip (board 21) and the avatar stack + Share (board 41). */
  people?: ReactNode
  collapsed: boolean
}

/** Board 44 Right Card › Card Header (LKu07Q787a). */
export function RightCardHeader({
  ui,
  canvas,
  onPreview,
  previewTarget,
  people,
  collapsed,
}: RightCardHeaderProps) {
  const zoom = useUi(ui, (s) => s.viewport.zoom)
  const { platform } = useRuntime()
  const prefs = useCanvasViewPrefs(platform.settings)
  const panels = usePanels()
  /** Board 27 §4: the zoom control opens the View menu (F5DXf). */
  const [viewAnchor, setViewAnchor] = useState<HTMLElement | null>(null)
  const zoomTo = (z: number) => {
    const c = canvas()
    if (c) c.zoomTo(z)
    else ui.getState().setViewport({ zoom: z })
  }
  const previewLabel =
    previewTarget === null
      ? "Page has no frames"
      : previewTarget
        ? `Preview “${previewTarget}”`
        : "Preview"
  return (
    <header className="card-header card-header--right">
      <div className="card-header__people">{people}</div>
      <div className="card-header__view">
        <button
          type="button"
          className="topbar__zoom card-header__zoom"
          aria-label="Zoom"
          aria-haspopup="menu"
          aria-expanded={viewAnchor !== null}
          onClick={(e) => {
            const el = e.currentTarget
            setViewAnchor((a) => (a ? null : el))
          }}
        >
          <span className="topbar__zoom-value">{Math.round(zoom * 100)}%</span>
          <span className="topbar__zoom-icon">
            <Icon name="chevron-down" size={12} />
          </span>
        </button>
        {viewAnchor && (
          <ViewMenu
            anchor={viewAnchor}
            os={platform.os}
            prefs={prefs}
            settings={platform.settings}
            zoomIn={() => zoomTo(zoom * 2)}
            zoomOut={() => zoomTo(zoom / 2)}
            zoom100={() => zoomTo(1)}
            zoomToFit={() => canvas()?.zoomToFit()}
            zoomToSelection={() => canvas()?.zoomToFit(ui.getState().selection)}
            onPreview={onPreview}
            previewTarget={previewTarget}
            panels={{
              leftCollapsed: panels.left,
              rightCollapsed: panels.right,
              toggleLeft: () => togglePanel("left"),
              toggleRight: () => togglePanel("right"),
            }}
            onClose={() => {
              viewAnchor.focus({ preventScroll: true })
              setViewAnchor(null)
            }}
          />
        )}
        {/* Board 27 §9 (b): tooltip names the frame; disabled at 40 % (aria). */}
        <Tooltip
          label={previewLabel}
          {...(previewTarget === null ? {} : { shortcut: shortcutLabel("preview") })}
        >
          <button
            type="button"
            className="card-header__icon-button topbar__preview"
            aria-label="Preview"
            aria-disabled={previewTarget === null || undefined}
            onClick={() => {
              if (previewTarget !== null) onPreview()
            }}
          >
            <Icon name="play" size={16} />
          </button>
        </Tooltip>
        <CollapseButton side="right" collapsed={collapsed} />
      </div>
    </header>
  )
}
