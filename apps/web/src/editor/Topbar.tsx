/**
 * Editor top bar — board 03 "Topbar" (fYEz3): 48 high, bg-app, bottom border, gap 8,
 * padding [0, 12], items centered. Children in node order: Logo, File, Sep, Page, Spacer,
 * Saved, Zoom, Theme (IconButton sun), Play (Button/Ghost "Preview"), Export (Button/Primary).
 *
 * The file name opens board 20's File menu (`FileMenu`, web cPHVm): the trigger shows pressed
 * (bg-muted, radius-sm) and its chevron flips up while the menu is open (s7QHW / rRmKs).
 *
 * A `.kimo` on disk uses board 16's Topbar/Desktop (XDqrb) instead (`files/FileTopbar`): the
 * traffic-light inset (or, off macOS, the k logo), `folder / file.kimo / page` breadcrumb,
 * branch chip and SaveStatus pill, followed by the same trailing controls
 * ({@link TopbarTrailing}). Its file name opens the same File menu.
 */
import type { RecentFile } from "@kimo/platform"
import type { SyncStatus } from "@kimo/sync"
import { Button, IconButton, MenuItem } from "@kimo/ui"
import { useEffect, useState } from "react"
import type { CanvasHandle, UiStore } from "../canvas/contract"
import { useUi } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { MenuPopover } from "../lib/MenuPopover"
import { getTheme } from "../lib/theme"
import { useRuntime } from "../platform/runtime"
import { FileMenu, type FileMenuActions, RECENT_LIMIT } from "./FileMenu"

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
  onHome(): void
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
  return () =>
    void platform.settings
      .set("general.appearance", getTheme() === "light" ? "dark" : "light")
      .catch(() => undefined)
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
        anchor={anchor}
        os={platform.os}
        recents={recents}
        onClearRecent={() => void platform.recents.clearFiles().catch(() => undefined)}
        onClose={() => {
          close()
          anchor.focus({ preventScroll: true })
        }}
      />
    ) : null,
  }
}

/** Zoom, Theme, Preview, Export (board 03 / XDqrb trailing controls). */
export function TopbarTrailing({
  ui,
  canvas,
  onPreview,
  onExport,
}: Pick<TopbarProps, "ui" | "canvas" | "onPreview" | "onExport">) {
  const zoom = useUi(ui, (s) => s.viewport.zoom)
  const toggleAppearance = useToggleAppearance()
  const zoomTo = (z: number) => {
    const c = canvas()
    if (c) c.zoomTo(z)
    else ui.getState().setViewport({ zoom: z })
  }
  return (
    <>
      <MenuPopover
        label="Zoom"
        align="end"
        trigger={(t) => (
          <button type="button" className="topbar__zoom" aria-label="Zoom" {...t}>
            <span className="topbar__zoom-value">{Math.round(zoom * 100)}%</span>
            <span className="topbar__zoom-icon">
              <Icon name="chevron-down" size={12} />
            </span>
          </button>
        )}
      >
        {() => (
          <>
            <MenuItem
              icon={<Icon name="zoom-in" size={14} />}
              shortcut="⌘+"
              onSelect={() => zoomTo(zoom * 2)}
            >
              Zoom in
            </MenuItem>
            <MenuItem
              icon={<Icon name="zoom-out" size={14} />}
              shortcut="⌘−"
              onSelect={() => zoomTo(zoom / 2)}
            >
              Zoom out
            </MenuItem>
            <MenuItem
              icon={<Icon name="search" size={14} />}
              shortcut="⌘0"
              onSelect={() => zoomTo(1)}
            >
              Zoom to 100%
            </MenuItem>
            <MenuItem
              icon={<Icon name="maximize" size={14} />}
              shortcut="⇧1"
              onSelect={() => canvas()?.zoomToFit()}
            >
              Zoom to fit
            </MenuItem>
          </>
        )}
      </MenuPopover>
      <IconButton
        label="Toggle theme"
        icon={<Icon name="sun" size={16} />}
        onClick={toggleAppearance}
      />
      <Button variant="ghost" icon={<Icon name="play" size={16} />} onClick={onPreview}>
        Preview
      </Button>
      <Button variant="primary" icon={<Icon name="code-xml" size={16} />} onClick={onExport}>
        Export
      </Button>
    </>
  )
}

export function Topbar(props: TopbarProps) {
  const [renaming, setRenaming] = useState(false)
  const [saved, savedLabel] = SAVED_LABEL[props.syncStatus] ?? ["cloud-check", "Saved locally"]
  const fileMenu = useFileMenu(props)

  return (
    <header className="topbar">
      <button type="button" className="topbar__logo" aria-label="Kimo home" onClick={props.onHome}>
        <span className="topbar__mark">k</span>
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
      <span className="topbar__spacer" />
      <span className="topbar__saved" data-status={props.syncStatus}>
        <span className="topbar__saved-icon">
          <Icon name={saved} size={14} />
        </span>
        <span className="topbar__saved-label">{savedLabel}</span>
      </span>
      <TopbarTrailing
        ui={props.ui}
        canvas={props.canvas}
        onPreview={props.onPreview}
        onExport={props.onExport}
      />
    </header>
  )
}
