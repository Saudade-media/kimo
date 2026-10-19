/**
 * Editor top bar — board 03 "Topbar" (fYEz3): 48 high, bg-app, bottom border, gap 8,
 * padding [0, 12], items centered. Children in node order: Logo, File, Sep, Page, Spacer,
 * Saved, Zoom, Theme (IconButton sun), Play (Button/Ghost "Preview"), Export (Button/Primary).
 *
 * The file name opens board 20's File menu (`FileMenu`, web cPHVm): the trigger shows pressed
 * (bg-muted, radius-sm) and its chevron flips up while the menu is open (s7QHW / rRmKs).
 *
 * A `.kimo` on disk uses board 16's Topbar/Desktop (XDqrb) instead (`files/FileTopbar`): the
 * traffic-light inset (or, off macOS, the KimoLogo), `folder / file.kimo / page` breadcrumb,
 * branch chip and SaveStatus pill, followed by the same trailing controls
 * ({@link TopbarTrailing}). Its file name opens the same File menu.
 */
import type { RecentFile } from "@kimo/platform"
import type { SyncStatus } from "@kimo/sync"
import { Button, IconButton, KimoLogo, Tooltip } from "@kimo/ui"
import { type ReactNode, useEffect, useState } from "react"
import type { CanvasHandle, UiStore } from "../canvas/contract"
import { useCanvasViewPrefs } from "../canvas/view-prefs"
import { useUi } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { getTheme } from "../lib/theme"
import { TopbarShare, TopbarSyncStatus } from "../multiplayer/ui/TopbarShare"
import { useRuntime } from "../platform/runtime"
import { runHelpAction } from "../settings/help"
import { shortcutLabel } from "../shortcuts/shortcuts"
import { FileMenu, type FileMenuActions, newWindowAction, RECENT_LIMIT } from "./FileMenu"
import { useFailureToast } from "./failure-toast"
import { ViewMenu } from "./ViewMenu"

export type { FileMenuActions } from "./FileMenu"

export interface TopbarProps extends FileMenuActions {
  fileName: string
  pageName: string
  syncStatus: SyncStatus
  ui: UiStore
  canvas: () => CanvasHandle | null
  onRename(name: string): void
  onExport(): void
  onPreview(): void
  /**
   * Board 27 §9 (b) mtgng: the frame Preview will open (tooltip "Preview “<name>”"); null = the
   * page has no top-level frame (button at 40 %, "Page has no frames"); undefined = unknown.
   */
  previewTarget?: string | null
  onHome(): void
  /**
   * Board 41 §1/§2: the multiplayer document key of this editor (a room joined from a link,
   * `roomKeyOf(room)`). Set, the sync status replaces "Saved locally" while it is shared, and the
   * avatar stack and Share sit after Theme.
   */
  shareKey?: string | null
}

const SAVED_LABEL: Partial<Record<SyncStatus, [icon: string, label: string]>> = {
  loading: ["cloud-upload", "Loading…"],
  saving: ["cloud-upload", "Saving…"],
  dirty: ["cloud-upload", "Saving…"],
  error: ["cloud-alert", "Not saved"],
  "read-only": ["cloud-alert", "Read-only"],
}

/** Theme toggle → General › Appearance (`bindAppearance` applies it to `[data-theme]`). */
function useToggleAppearance(): () => void {
  const { platform } = useRuntime()
  const fail = useFailureToast()
  return () =>
    void platform.settings
      .set("general.appearance", getTheme() === "light" ? "dark" : "light")
      .catch((e: unknown) => fail("change the theme", e))
}

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
 * Zoom, Theme, Preview, Export (board 03 / XDqrb trailing controls). The zoom control opens the
 * View menu (board 27 §4 rmQMe). `share` (board 41 §1: avatar stack + Share) sits after Theme,
 * before Preview.
 */
export function TopbarTrailing({
  ui,
  canvas,
  onPreview,
  onExport,
  previewTarget,
  share,
}: Pick<TopbarProps, "ui" | "canvas" | "onPreview" | "onExport" | "previewTarget"> & {
  share?: ReactNode
}) {
  const zoom = useUi(ui, (s) => s.viewport.zoom)
  const toggleAppearance = useToggleAppearance()
  const { platform } = useRuntime()
  const prefs = useCanvasViewPrefs(platform.settings)
  /** Board 27 §4: the zoom control opens the View menu (F5DXf). */
  const [viewAnchor, setViewAnchor] = useState<HTMLElement | null>(null)
  const zoomTo = (z: number) => {
    const c = canvas()
    if (c) c.zoomTo(z)
    else ui.getState().setViewport({ zoom: z })
  }
  return (
    <>
      <button
        type="button"
        className="topbar__zoom"
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
          onClose={() => {
            viewAnchor.focus({ preventScroll: true })
            setViewAnchor(null)
          }}
        />
      )}
      <IconButton
        label="Toggle theme"
        icon={<Icon name="sun" size={16} />}
        onClick={toggleAppearance}
      />
      {share}
      {/* Board 27 §9 (b): ghost look kept; tooltip names the frame; disabled at 40 % (aria). */}
      <Tooltip
        label={
          previewTarget === null
            ? "Page has no frames"
            : previewTarget
              ? `Preview “${previewTarget}”`
              : "Preview"
        }
        {...(previewTarget === null ? {} : { shortcut: shortcutLabel("preview") })}
      >
        <Button
          variant="ghost"
          className="topbar__preview"
          icon={<Icon name="play" size={16} />}
          aria-disabled={previewTarget === null || undefined}
          onClick={() => {
            if (previewTarget !== null) onPreview()
          }}
        >
          Preview
        </Button>
      </Tooltip>
      <Button variant="primary" icon={<Icon name="code-xml" size={16} />} onClick={onExport}>
        Export
      </Button>
    </>
  )
}

function SavedLocally({
  status,
  icon,
  label,
}: {
  status: SyncStatus
  icon: string
  label: string
}) {
  return (
    <span className="topbar__saved" data-status={status}>
      <span className="topbar__saved-icon">
        <Icon name={icon} size={14} />
      </span>
      <span className="topbar__saved-label">{label}</span>
    </span>
  )
}

export function Topbar(props: TopbarProps) {
  const [renaming, setRenaming] = useState(false)
  const [saved, savedLabel] = SAVED_LABEL[props.syncStatus] ?? ["cloud-check", "Saved locally"]
  const fileMenu = useFileMenu(props)

  return (
    <header className="topbar" data-tauri-drag-region="">
      <button type="button" className="topbar__logo" aria-label="Kimo home" onClick={props.onHome}>
        <KimoLogo size={28} />
      </button>
      {renaming ? (
        <input
          className="topbar__file-input"
          aria-label="File name"
          defaultValue={props.fileName}
          // biome-ignore lint/a11y/noAutofocus: rename was explicitly requested
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            setRenaming(false)
            const v = e.currentTarget.value.trim()
            if (v && v !== props.fileName) props.onRename(v)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
            if (e.key === "Escape") {
              e.currentTarget.value = props.fileName
              e.currentTarget.blur()
            }
          }}
        />
      ) : (
        <button
          type="button"
          className={fileMenu.open ? "topbar__file topbar__file--open" : "topbar__file"}
          aria-haspopup="menu"
          aria-expanded={fileMenu.open}
          onClick={(e) => fileMenu.toggle(e.currentTarget)}
          onDoubleClick={() => {
            fileMenu.close()
            setRenaming(true)
          }}
        >
          <span className="topbar__file-name">{props.fileName}</span>
          <span className="topbar__file-icon">
            <Icon name={fileMenu.open ? "chevron-up" : "chevron-down"} size={14} />
          </span>
        </button>
      )}
      {fileMenu.menu}
      <span className="topbar__sep">/</span>
      <span className="topbar__page">{props.pageName}</span>
      <span className="topbar__spacer" data-tauri-drag-region="" />
      {props.shareKey ? (
        <TopbarSyncStatus
          docKey={props.shareKey}
          fallback={<SavedLocally status={props.syncStatus} icon={saved} label={savedLabel} />}
        />
      ) : (
        <SavedLocally status={props.syncStatus} icon={saved} label={savedLabel} />
      )}
      <TopbarTrailing
        ui={props.ui}
        canvas={props.canvas}
        onPreview={props.onPreview}
        previewTarget={props.previewTarget}
        onExport={props.onExport}
        {...(props.shareKey ? { share: <TopbarShare docKey={props.shareKey} /> } : {})}
      />
    </header>
  )
}
