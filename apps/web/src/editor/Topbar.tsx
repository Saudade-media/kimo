/**
 * Editor top bar — board 03 "Topbar" (fYEz3): 48 high, bg-app, bottom border, gap 8,
 * padding [0, 12], items centered. Children in node order: Logo, File, Sep, Page, Spacer,
 * Saved, Zoom, Theme (IconButton sun), Play (Button/Ghost "Preview"), Export (Button/Primary).
 *
 * A `.kimo` on disk uses board 16's Topbar/Desktop (XDqrb) instead (`files/FileTopbar`): the
 * traffic-light inset, `folder / file.kimo / page` breadcrumb, branch chip and SaveStatus pill,
 * followed by the same trailing controls ({@link TopbarTrailing}). Its file name opens the same
 * File menu ({@link FileMenuItems}) anchored under the name.
 */
import type { SyncStatus } from "@kimo/sync"
import { Button, IconButton, Menu, MenuItem } from "@kimo/ui"
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { CanvasHandle, UiStore } from "../canvas/contract"
import { useUi } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { MenuPopover } from "../lib/MenuPopover"
import { getTheme } from "../lib/theme"
import { useRuntime } from "../platform/runtime"

export interface FileMenuActions {
  /** Browser library only (a file on disk is renamed in the file manager). */
  onRename?(): void
  onSave(): void
  /** A file on disk: Save as… (⇧⌘S). */
  onSaveAs?(): void
  onOpenFile(): void
  onCleanUpAssets(): void
  onHome(): void
}

export interface TopbarProps extends Omit<FileMenuActions, "onRename"> {
  fileName: string
  pageName: string
  syncStatus: SyncStatus
  ui: UiStore
  canvas: () => CanvasHandle | null
  onRename(name: string): void
  onExport(): void
  onPreview(): void
}

const SAVED_LABEL: Partial<Record<SyncStatus, [icon: string, label: string]>> = {
  loading: ["cloud-upload", "Loading…"],
  saving: ["cloud-upload", "Saving…"],
  dirty: ["cloud-upload", "Saving…"],
  error: ["cloud-alert", "Not saved"],
  "read-only": ["cloud-alert", "Read-only"],
}

/** Settings › Fonts & privacy "Google Fonts" (`fonts.google`), kept current. */
function useGoogleFonts(): [boolean, (on: boolean) => void] {
  const { platform } = useRuntime()
  const on = useSyncExternalStore(
    (cb) => platform.settings.onChange((key) => key === "fonts.google" && cb()),
    () => platform.settings.get("fonts.google"),
  )
  return [on, (next) => void platform.settings.set("fonts.google", next).catch(() => undefined)]
}

/** Theme toggle → General › Appearance (`bindAppearance` applies it to `[data-theme]`). */
function useToggleAppearance(): () => void {
  const { platform } = useRuntime()
  return () =>
    void platform.settings
      .set("general.appearance", getTheme() === "light" ? "dark" : "light")
      .catch(() => undefined)
}

/** The File menu's items (board 03 file menu + M4 file actions). */
export function FileMenuItems(props: FileMenuActions) {
  const [webFonts, setWebFonts] = useGoogleFonts()
  return (
    <>
      {props.onRename && (
        <MenuItem icon={<Icon name="pencil-line" size={14} />} onSelect={props.onRename}>
          Rename
        </MenuItem>
      )}
      {props.onSaveAs ? (
        <>
          <MenuItem icon={<Icon name="save" size={14} />} shortcut="⌘S" onSelect={props.onSave}>
            Save
          </MenuItem>
          <MenuItem
            icon={<Icon name="download" size={14} />}
            shortcut="⇧⌘S"
            onSelect={props.onSaveAs}
          >
            Save as…
          </MenuItem>
        </>
      ) : (
        <MenuItem icon={<Icon name="download" size={14} />} shortcut="⌘S" onSelect={props.onSave}>
          Save as .kimo
        </MenuItem>
      )}
      <MenuItem
        icon={<Icon name="folder-open" size={14} />}
        shortcut="⌘O"
        onSelect={props.onOpenFile}
      >
        Open file…
      </MenuItem>
      <MenuItem
        icon={<Icon name="globe" size={14} />}
        role="menuitemcheckbox"
        aria-checked={webFonts}
        shortcut={webFonts ? "On" : "Off"}
        onSelect={() => setWebFonts(!webFonts)}
      >
        Web fonts
      </MenuItem>
      <MenuItem icon={<Icon name="trash-2" size={14} />} onSelect={props.onCleanUpAssets}>
        Clean up assets…
      </MenuItem>
      <MenuItem icon={<Icon name="house" size={14} />} onSelect={props.onHome}>
        Back to files
      </MenuItem>
    </>
  )
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

/**
 * A menu anchored under an element that is not a MenuPopover trigger (the desktop breadcrumb's
 * file name). Closes on outside pointerdown, Escape, or after an item is chosen.
 */
export function AnchoredMenu({
  anchor,
  label,
  onClose,
  children,
}: {
  anchor: DOMRect
  label: string
  onClose(): void
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [onClose])
  return (
    <div
      ref={root}
      className="menu-popover menu-popover--anchored"
      style={{ position: "fixed", left: anchor.left, top: anchor.bottom, zIndex: 50 }}
    >
      <Menu
        label={label}
        autoFocus
        onClose={onClose}
        className="menu-popover__menu menu-popover__menu--start"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('[role="menuitem"]')) onClose()
        }}
      >
        {children}
      </Menu>
    </div>
  )
}

export function Topbar(props: TopbarProps) {
  const [renaming, setRenaming] = useState(false)
  const [saved, savedLabel] = SAVED_LABEL[props.syncStatus] ?? ["cloud-check", "Saved locally"]

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
        <MenuPopover
          label="File"
          trigger={(t) => (
            <button
              type="button"
              className="topbar__file"
              {...t}
              onDoubleClick={() => setRenaming(true)}
            >
              <span className="topbar__file-name">{props.fileName}</span>
              <span className="topbar__file-icon">
                <Icon name="chevron-down" size={14} />
              </span>
            </button>
          )}
        >
          {() => (
            <FileMenuItems
              onRename={() => setRenaming(true)}
              onSave={props.onSave}
              onOpenFile={props.onOpenFile}
              onCleanUpAssets={props.onCleanUpAssets}
              onHome={props.onHome}
            />
          )}
        </MenuPopover>
      )}
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
