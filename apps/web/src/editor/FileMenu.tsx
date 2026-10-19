/**
 * The File menu — board 20 "File menu" (AsXP1): `Menu/Dense` (G7A3Aj) at width 256 with
 * `MenuItem/Dense` rows whose Check Slot holds the item icon (14, text-secondary) and whose Meta
 * holds the shortcut (mono 11):
 *
 *   New file ⌘N (file-plus) · Open… ⌘O (folder-open) · Open recent ▸ (history) · Save ⌘S (save)
 *   · Save as… ⇧⌘S (file-output) · ─ · Export… ⇧⌘E (download) · Copy selection as PNG ⇧⌘C
 *   (image) (board 27 §10 (d) W3CpXw) · ─ · Reveal in Finder (folder-search; desktop only) · Clean up
 *   assets… (brush-cleaning) · ─ · Settings… ⌘, (settings)
 *   · ─ · Help ▸ (Windows / Linux / web; board 25 §7 (b) A0qRF: macOS has the native Help menu)
 *
 * Board 37 (Xq4V0): "Back to files" (house) leads the menu, then a divider (E3: the way back to
 * Home when macOS hides the logo behind the traffic lights).
 *
 * Desktop (A1jsC) opens from the breadcrumb's file name, web (cPHVm) from the topbar file name:
 * the menu's top-left is the trigger's left edge, 12px below it. "Open recent" opens the
 * submenu (Aw9t8, width 232) on hover after 120 ms, overlapping the menu by 4px: recent files
 * (name · folder in mono meta), a divider, "Clear recent". Off macOS the shortcuts read
 * Ctrl+… / Shift+Ctrl+…, and Reveal reads "Show in Explorer" / "Show in folder".
 *
 * Help (A0qRF, without the macOS-only Search row): Kimo documentation · Keyboard shortcuts ⌘/ ·
 * What's new · ─ · Report an issue… · Copy diagnostics · ─ · Show logs (desktop only); opens like
 * Open recent (same delay, overlap and raise).
 */
import type { FileRef, HostOS, RecentFile } from "@kimo/platform"
import { basenameOf } from "@kimo/platform"
import { MenuDense, MenuDivider, MenuItemDense } from "@kimo/ui"
import { Fragment, type KeyboardEvent, useEffect, useRef, useState } from "react"
import { Icon } from "../lib/icons"
import { revealLabel } from "../platform/contract"
import { type HelpAction, helpItems } from "../settings/help"
import { currentPlatform } from "../shortcuts/shortcuts"

/** What the File menu runs. Absent actions hide their item. */
export interface FileMenuActions {
  /** Board 37 Xq4V0: "Back to files" (house), first, then a divider. */
  onHome?: () => void
  onNewFile(): void
  /**
   * Board 20 r3ukd: New window (app-window, no shortcut) under New file. Windows and Linux only:
   * they have no native menu bar, and macOS keeps it in the native File menu (audit G4).
   */
  onNewWindow?: () => void
  onOpenFile(): void
  onOpenRecent(ref: FileRef): void
  /**
   * Save and Save as… (a copy). Absent hides the row: a View link has neither (board 41 section
   * 9, `canDuplicate` false).
   */
  onSave?: () => void
  onSaveAs?: () => void
  /** Board 27 §10 (d): Export… ⇧⌘E — the Export dialog (selection, else the current page). */
  onExportDialog?: () => void
  /** Board 27 §10 (d): Copy selection as PNG ⇧⌘C — a 2× PNG on the clipboard. */
  onCopyPng?: () => void
  /** Desktop only: the web build has no filesystem path (board 20 V7Lu4m omits it). */
  onReveal?: () => void
  /** Absent hides the row (a joined room's assets are not this device's). */
  onCleanUpAssets?: () => void
  onSettings(): void
}

/** File › Help (board 25 §7 (b)): shown off macOS desktop, where the native Help menu has it. */
export interface FileMenuHelp {
  version: string
  /** "Show logs" (desktop only). */
  logs: boolean
  run(action: HelpAction): void
}

/** Help submenu width (A0qRF). */
export const HELP_MENU_WIDTH = 256

/**
 * True when menus show the design's macOS glyphs: the macOS desktop app, or the web build in a
 * browser running on macOS (E12: a browser reports os "web" on every OS).
 */
export function usesMacGlyphs(os: HostOS): boolean {
  return os === "macos" || (os === "web" && currentPlatform() === "mac")
}

/**
 * File › New window off macOS (audit G4): desktop Windows and Linux open another window on Home;
 * macOS has it in the native File menu and the web build in the browser's own menu, so both get
 * none. A refused open reports through `fail`.
 */
export function newWindowAction(
  os: HostOS,
  openNewWindow: (() => Promise<void>) | undefined,
  fail: (action: string, e: unknown) => void,
): (() => void) | undefined {
  if ((os !== "windows" && os !== "linux") || !openNewWindow) return undefined
  return () => void openNewWindow().catch((e: unknown) => fail("open a new window", e))
}

/** Menu shortcut text per OS (board 20 note VJFSo: "Ctrl/Shift+Ctrl off macOS"). */
export function menuShortcut(os: HostOS, key: string, shift = false): string {
  if (usesMacGlyphs(os)) return `${shift ? "⇧" : ""}⌘${key}`
  return `${shift ? "Shift+" : ""}Ctrl+${key}`
}

/** Hover delay before "Open recent" opens its submenu (note VJFSo). */
export const SUBMENU_DELAY_MS = 120
/** Menu widths: A1jsC / cPHVm 256, Aw9t8 232. */
export const FILE_MENU_WIDTH = 256
export const RECENT_MENU_WIDTH = 232
/** The menu's top sits 12px below the trigger (note VJFSo, y 44 under a file row at 16–32). */
export const FILE_MENU_OFFSET = 12
/** The submenu overlaps the menu by 4px (x 431 = 179 + 256 − 4). */
export const SUBMENU_OVERLAP = 4
/** Aw9t8 sits 10px above its item (y 96 vs Open recent at 106). */
export const SUBMENU_RAISE = 10
/** Recent files listed in the submenu (Aw9t8 shows three). Not designed beyond that. */
export const RECENT_LIMIT = 8

export interface FileMenuProps extends FileMenuActions {
  /** The trigger (breadcrumb file name / topbar file name). */
  anchor: HTMLElement
  os: HostOS
  /** Recent files (newest first); null while loading. */
  recents: readonly RecentFile[] | null
  onClearRecent(): void
  onClose(): void
  /** The Help submenu; absent (or on macOS desktop) hides it. */
  help?: FileMenuHelp
}

export function FileMenu(props: FileMenuProps) {
  const { anchor, os, recents, onClose } = props
  const [sub, setSub] = useState<{ kind: "recent" | "help"; el: HTMLElement } | null>(null)
  /** Opened from the keyboard (→ / Enter): the submenu takes focus. */
  const [subFocus, setSubFocus] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recentItem = useRef<HTMLButtonElement>(null)
  const helpItem = useRef<HTMLButtonElement>(null)
  const help = props.help && os !== "macos" ? props.help : null
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const openSub = (now = false, focus = false, kind: "recent" | "help" = "recent") => {
    clearTimer()
    const el = (kind === "help" ? helpItem : recentItem).current
    if (!el) return
    setSubFocus(focus)
    if (now) setSub({ kind, el })
    else timer.current = setTimeout(() => setSub({ kind, el }), SUBMENU_DELAY_MS)
  }
  const closeSub = () => {
    clearTimer()
    setSub(null)
  }
  const run = (f: () => void) => () => {
    onClose()
    f()
  }
  const hoverOther = () => {
    // Moving to another row closes the submenu (after the same delay as opening).
    clearTimer()
    if (sub) timer.current = setTimeout(() => setSub(null), SUBMENU_DELAY_MS)
  }
  const r = sub?.el.getBoundingClientRect()
  const subAnchor = r && {
    x: r.x,
    y: r.y - SUBMENU_RAISE,
    width: r.width + 4 /* menu padding */,
    height: r.height,
  }
  return (
    <MenuDense
      anchor={anchor}
      placement={{ side: "bottom", align: "start", offset: FILE_MENU_OFFSET }}
      width={FILE_MENU_WIDTH}
      label="File"
      autoFocus
      onClose={onClose}
      className="file-menu"
      data-testid="file-menu"
    >
      {props.onHome && (
        <>
          <MenuItemDense
            className="file-menu__home"
            icon={<Icon name="house" size={14} />}
            label="Back to files"
            onPointerEnter={hoverOther}
            onSelect={run(props.onHome)}
          />
          <MenuDivider />
        </>
      )}
      <MenuItemDense
        icon={<Icon name="file-plus" size={14} />}
        label="New file"
        meta={menuShortcut(os, "N")}
        onPointerEnter={hoverOther}
        onSelect={run(props.onNewFile)}
      />
      {props.onNewWindow && (
        <MenuItemDense
          className="file-menu__new-window"
          icon={<Icon name="app-window" size={14} />}
          label="New window"
          onPointerEnter={hoverOther}
          onSelect={run(props.onNewWindow)}
        />
      )}
      <MenuItemDense
        icon={<Icon name="folder-open" size={14} />}
        label="Open…"
        meta={menuShortcut(os, "O")}
        onPointerEnter={hoverOther}
        onSelect={run(props.onOpenFile)}
      />
      <MenuItemDense
        ref={recentItem}
        icon={<Icon name="history" size={14} />}
        label="Open recent"
        submenu
        aria-expanded={sub?.kind === "recent"}
        highlighted={sub?.kind === "recent"}
        onPointerEnter={() => openSub()}
        onSelect={() => (sub?.kind === "recent" ? closeSub() : openSub(true, true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault()
            openSub(true, true)
          }
        }}
      />
      {props.onSave && (
        <MenuItemDense
          icon={<Icon name="save" size={14} />}
          label="Save"
          meta={menuShortcut(os, "S")}
          onPointerEnter={hoverOther}
          onSelect={run(props.onSave)}
        />
      )}
      {props.onSaveAs && (
        <MenuItemDense
          icon={<Icon name="file-output" size={14} />}
          label="Save as…"
          meta={menuShortcut(os, "S", true)}
          onPointerEnter={hoverOther}
          onSelect={run(props.onSaveAs)}
        />
      )}
      {(props.onExportDialog || props.onCopyPng) && <MenuDivider />}
      {props.onExportDialog && (
        <MenuItemDense
          icon={<Icon name="download" size={14} />}
          label="Export…"
          meta={menuShortcut(os, "E", true)}
          onPointerEnter={hoverOther}
          onSelect={run(props.onExportDialog)}
        />
      )}
      {props.onCopyPng && (
        <MenuItemDense
          icon={<Icon name="image" size={14} />}
          label="Copy selection as PNG"
          meta={menuShortcut(os, "C", true)}
          onPointerEnter={hoverOther}
          onSelect={run(props.onCopyPng)}
        />
      )}
      <MenuDivider />
      {props.onReveal && (
        <MenuItemDense
          icon={<Icon name="folder-search" size={14} />}
          label={revealLabel(os)}
          onPointerEnter={hoverOther}
          onSelect={run(props.onReveal)}
        />
      )}
      {props.onCleanUpAssets && (
        <MenuItemDense
          icon={<Icon name="brush-cleaning" size={14} />}
          label="Clean up assets…"
          onPointerEnter={hoverOther}
          onSelect={run(props.onCleanUpAssets)}
        />
      )}
      {(props.onReveal || props.onCleanUpAssets) && <MenuDivider />}
      <MenuItemDense
        icon={<Icon name="settings" size={14} />}
        label="Settings…"
        meta={menuShortcut(os, ",")}
        onPointerEnter={hoverOther}
        onSelect={run(props.onSettings)}
      />
      {help && (
        <>
          <MenuDivider />
          <MenuItemDense
            ref={helpItem}
            icon={<Icon name="circle-help" size={14} />}
            label="Help"
            submenu
            aria-expanded={sub?.kind === "help"}
            highlighted={sub?.kind === "help"}
            onPointerEnter={() => openSub(false, false, "help")}
            onSelect={() => (sub?.kind === "help" ? closeSub() : openSub(true, true, "help"))}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault()
                openSub(true, true, "help")
              }
            }}
          />
        </>
      )}
      {sub?.kind === "help" && subAnchor && help && (
        <HelpSubmenu
          anchor={subAnchor}
          os={os}
          help={help}
          autoFocus={subFocus}
          onPointerEnter={clearTimer}
          onRun={(a) => {
            onClose()
            help.run(a)
          }}
          onBack={() => {
            closeSub()
            helpItem.current?.focus()
          }}
        />
      )}
      {sub?.kind === "recent" && subAnchor && (
        <RecentSubmenu
          anchor={subAnchor}
          recents={recents}
          autoFocus={subFocus}
          onPointerEnter={clearTimer}
          onOpen={(ref) => {
            onClose()
            props.onOpenRecent(ref)
          }}
          onClear={() => {
            onClose()
            props.onClearRecent()
          }}
          onBack={() => {
            closeSub()
            recentItem.current?.focus()
          }}
        />
      )}
    </MenuDense>
  )
}

/** Open recent (Aw9t8): recent files (name · folder) · divider · Clear recent. */
function RecentSubmenu({
  anchor,
  recents,
  autoFocus,
  onPointerEnter,
  onOpen,
  onClear,
  onBack,
}: {
  anchor: { x: number; y: number; width: number; height: number }
  recents: readonly RecentFile[] | null
  autoFocus: boolean
  onPointerEnter(): void
  onOpen(ref: FileRef): void
  onClear(): void
  onBack(): void
}) {
  const list = (recents ?? []).filter((f) => !f.missing).slice(0, RECENT_LIMIT)
  return (
    <MenuDense
      anchor={anchor}
      placement={{ side: "right", align: "start", offset: -SUBMENU_OVERLAP }}
      width={RECENT_MENU_WIDTH}
      label="Open recent"
      autoFocus={autoFocus}
      className="file-menu__recent"
      data-testid="file-menu-recent"
      onPointerEnter={onPointerEnter}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "ArrowLeft" || e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onBack()
        }
      }}
    >
      {list.map((f) => (
        <MenuItemDense
          key={f.ref}
          label={f.name}
          meta={basenameOf(f.folder)}
          title={f.ref}
          onSelect={() => onOpen(f.ref)}
        />
      ))}
      {list.length === 0 && <MenuItemDense label="No recent files" disabled />}
      <MenuDivider />
      <MenuItemDense label="Clear recent" disabled={list.length === 0} onSelect={onClear} />
    </MenuDense>
  )
}

/** File › Help (A0qRF items; the macOS Search row is the system's, so it is not here). */
function HelpSubmenu({
  anchor,
  os,
  help,
  autoFocus,
  onPointerEnter,
  onRun,
  onBack,
}: {
  anchor: { x: number; y: number; width: number; height: number }
  os: HostOS
  help: FileMenuHelp
  autoFocus: boolean
  onPointerEnter(): void
  onRun(action: HelpAction): void
  onBack(): void
}) {
  return (
    <MenuDense
      anchor={anchor}
      placement={{ side: "right", align: "start", offset: -SUBMENU_OVERLAP }}
      width={HELP_MENU_WIDTH}
      label="Help"
      autoFocus={autoFocus}
      className="file-menu__help"
      data-testid="file-menu-help"
      onPointerEnter={onPointerEnter}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "ArrowLeft" || e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onBack()
        }
      }}
    >
      {helpItems({ version: help.version, os, logs: help.logs }).map((it) => (
        <Fragment key={it.id}>
          {it.divider && <MenuDivider />}
          <MenuItemDense
            icon={<Icon name={it.icon} size={14} />}
            label={it.label}
            {...(it.id === "shortcuts" ? { meta: menuShortcut(os, "/") } : {})}
            onSelect={() => onRun(it.id)}
          />
        </Fragment>
      ))}
    </MenuDense>
  )
}
