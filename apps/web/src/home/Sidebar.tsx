/**
 * Home sidebar (board 06 lGmKI / board 16 LEwyc, board 37 fiCwk): every row is a link to its
 * section (`#/`, `#/all`, `#/templates`, `#/libraries`, `#/trash`, `#/folder/<ref>`); the active
 * one is `aria-current=page`. The developer component gallery has no row (dev builds only).
 */
import type { KimoPlatform, WatchedFolder } from "@kimo/platform"
import { KimoLockup } from "@kimo/ui"
import type { MouseEvent, ReactNode } from "react"
import { LocalFolders, TrafficLightInset } from "../files"
import { Icon } from "../lib/icons"
import { type HomeSection, homeSectionPath } from "../router"
import { SECTION_TITLE } from "./model"
import { NavRow } from "./parts"

export interface HomeSidebarProps {
  platform: KimoPlatform
  /** Desktop layout (board 16): traffic-light inset first, padding [0, 12, 16, 12]. */
  desktop: boolean
  section: HomeSection
  allCount: number | null
  libraryCount: number | null
  /** LOCAL FOLDERS: null = the static "Desktop app only" row (a browser without the API). */
  folders: {
    list: readonly WatchedFolder[]
    activeRef: string | null
    menuRef: string | null
    onAdd: () => void
    onOpen: (folder: WatchedFolder) => void
    onMenu: (folder: WatchedFolder, from: { button: HTMLElement } | { event: MouseEvent }) => void
  } | null
  onOpenSettings: () => void
}

const href = (s: HomeSection) => `#${homeSectionPath(s)}`

export function HomeSidebar({
  platform,
  desktop,
  section,
  allCount,
  libraryCount,
  folders,
  onOpenSettings,
}: HomeSidebarProps) {
  const row = (
    kind: Exclude<HomeSection["kind"], "folder">,
    icon: ReactNode,
    count?: number | null,
  ) => (
    <NavRow
      href={href({ kind } as HomeSection)}
      icon={icon}
      label={SECTION_TITLE[kind]}
      active={section.kind === kind}
      {...(count !== undefined ? { count } : {})}
    />
  )
  return (
    <nav className={`home-sidebar${desktop ? " home-sidebar--desktop" : ""}`} aria-label="Library">
      {desktop && <TrafficLightInset platform={platform} leading={4} />}
      <div className="home-sidebar__brand">
        <KimoLockup />
      </div>
      {row("recents", <Icon name="history" size={16} />)}
      {row("all", <Icon name="folder" size={16} />, allCount)}
      {row("templates", <Icon name="layout-template" size={16} />)}
      {row("libraries", <Icon name="swatch-book" size={16} />, libraryCount)}
      {row("trash", <Icon name="trash-2" size={16} />)}
      {folders ? (
        <LocalFolders
          folders={folders.list}
          activeRef={folders.activeRef}
          menuRef={folders.menuRef}
          onAdd={folders.onAdd}
          onOpenFolder={folders.onOpen}
          onMenu={folders.onMenu}
        />
      ) : (
        <>
          {/* Folders Header (CttNG): text-xs 600, ls 0.6, padding [20, 10, 6, 10]. */}
          <div className="home-folders-header">
            <span className="home-folders-header__label">LOCAL FOLDERS</span>
          </div>
          <span className="home-nav home-nav--static" aria-disabled="true">
            <span className="home-nav__icon">
              <Icon name="folder-git-2" size={16} />
            </span>
            <span className="home-nav__label">Desktop app only</span>
          </span>
        </>
      )}
      <div className="home-sidebar__spacer" />
      <div className="home-oss">
        <div className="home-oss__row">
          <span className="home-oss__icon">
            <Icon name="github" size={14} />
          </span>
          <span className="home-oss__title">Kimo is open source</span>
        </div>
        <p className="home-oss__desc">MIT licensed. Your files are plain JSON on your disk.</p>
      </div>
      <button type="button" className="home-nav home-nav--button" onClick={onOpenSettings}>
        <span className="home-nav__icon">
          <Icon name="settings" size={16} />
        </span>
        <span className="home-nav__label">Settings</span>
      </button>
    </nav>
  )
}
