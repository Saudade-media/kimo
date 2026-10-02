/**
 * Editor top bar — board 03 "Topbar" (fYEz3): 48 high, bg-app, bottom border, gap 8,
 * padding [0, 12], items centered. Children in node order: Logo, File, Sep, Page, Spacer,
 * Saved, Zoom, Theme (IconButton sun), Play (Button/Ghost "Preview"), Export (Button/Primary).
 */
import type { SyncStatus } from "@kimo/sync"
import { Button, IconButton, MenuItem } from "@kimo/ui"
import { useState } from "react"
import type { CanvasHandle, UiStore } from "../canvas/contract"
import { useUi } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { MenuPopover } from "../lib/MenuPopover"
import { setWebFonts, useWebFonts } from "../lib/settings"
import { toggleTheme } from "../lib/theme"

export interface TopbarProps {
  fileName: string
  pageName: string
  syncStatus: SyncStatus
  ui: UiStore
  canvas: () => CanvasHandle | null
  onRename(name: string): void
  onDownload(): void
  onOpenFile(): void
  onHome(): void
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

export function Topbar(props: TopbarProps) {
  const { ui } = props
  const zoom = useUi(ui, (s) => s.viewport.zoom)
  const [renaming, setRenaming] = useState(false)
  const webFonts = useWebFonts()
  const [saved, savedLabel] = SAVED_LABEL[props.syncStatus] ?? ["cloud-check", "Saved locally"]

  const zoomTo = (z: number) => {
    const c = props.canvas()
    if (c) c.zoomTo(z)
    else ui.getState().setViewport({ zoom: z })
  }

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
            <>
              <MenuItem
                icon={<Icon name="pencil-line" size={14} />}
                onSelect={() => setRenaming(true)}
              >
                Rename
              </MenuItem>
              <MenuItem
                icon={<Icon name="download" size={14} />}
                shortcut="⌘S"
                onSelect={props.onDownload}
              >
                Save as .kimo
              </MenuItem>
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
              <MenuItem icon={<Icon name="house" size={14} />} onSelect={props.onHome}>
                Back to files
              </MenuItem>
            </>
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
              onSelect={() => props.canvas()?.zoomToFit()}
            >
              Zoom to fit
            </MenuItem>
          </>
        )}
      </MenuPopover>
      <IconButton label="Toggle theme" icon={<Icon name="sun" size={16} />} onClick={toggleTheme} />
      <Button variant="ghost" icon={<Icon name="play" size={16} />} onClick={props.onPreview}>
        Preview
      </Button>
      <Button variant="primary" icon={<Icon name="code-xml" size={16} />} onClick={props.onExport}>
        Export
      </Button>
    </header>
  )
}
