import { ChevronDown, ChevronUp, Folder, FolderGit2, GitBranch } from "lucide-react"
import type { ComponentPropsWithRef, MouseEvent, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link TrafficLights}. */
export interface TrafficLightsProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /**
   * Width the platform reserves (`platform.window.trafficLightInset()`): 68 on macOS, 4 in
   * fullscreen (lights hidden), 0 elsewhere (renders nothing).
   */
  inset?: number
  /** Window focused; false draws `/Inactive` (border-strong lights). */
  focused?: boolean
  /**
   * Draw the three lights. macOS draws the real ones (Tauri `titleBarStyle: Overlay`), so the
   * desktop app only reserves the space (false); the gallery and the browser mock draw them.
   */
  drawLights?: boolean
  /** Leading padding: 16 in the topbar (L2zCG), 4 in the Home sidebar instance (G17HiQ). */
  leading?: number
}

/**
 * macOS traffic-light inset. Mirrors `WindowChrome/TrafficLights` (L2zCG) and `/Inactive`
 * (O8MOD): 68 × 48, row, gap 8, padding [0, 0, 0, 16], center; three 12 × 12 ellipses
 * (#FF5F57, #FEBC2E, #28C840; inactive border-strong) with a 0.5 #0000001F stroke. The colors
 * are the OS's, not tokens. Fullscreen collapses to width 4 with the lights hidden.
 */
export function TrafficLights({
  inset = 68,
  focused = true,
  drawLights = true,
  leading = 16,
  className,
  style,
  ...rest
}: TrafficLightsProps) {
  if (inset <= 0) return null
  const lights = inset >= 68 && drawLights
  return (
    <div
      aria-hidden="true"
      data-tauri-drag-region=""
      {...rest}
      className={cx("kimo-traffic-lights", !focused && "kimo-traffic-lights--inactive", className)}
      style={{ width: inset, paddingLeft: inset >= 68 ? leading : 0, ...style }}
    >
      {lights && (
        <>
          <span className="kimo-traffic-lights__light kimo-traffic-lights__light--close" />
          <span className="kimo-traffic-lights__light kimo-traffic-lights__light--minimize" />
          <span className="kimo-traffic-lights__light kimo-traffic-lights__light--zoom" />
        </>
      )}
    </div>
  )
}

/** Props for {@link DesktopBreadcrumb}. */
export interface DesktopBreadcrumbProps extends Omit<ComponentPropsWithRef<"nav">, "children"> {
  /**
   * Containing folder ("loom"). null hides the Folder and its separator (board 20 untitled
   * topbar Zvw7e: MPFjV and CkhLP disabled).
   */
  folder: string | null
  /** The folder is a git repository (`folder-git-2`) or not (`folder`). */
  folderIsRepo?: boolean
  file: string
  /** Current page; omitted on boards 17's compact topbars. */
  page?: string | null
  /** Window focused; unfocused drops the file name to weight 500 (02d). */
  focused?: boolean
  /** File name + chevron (the file menu). */
  onFileClick?: (e: MouseEvent<HTMLButtonElement>) => void
  /**
   * The File menu is open (board 20 Nl4Cz): File (gRY55) fill bg-muted, radius-sm, and the
   * chevron flips to `chevron-up`.
   */
  fileOpen?: boolean
}

/**
 * Topbar breadcrumb `folder / file.kimo / page`. Mirrors Topbar/Desktop > Breadcrumb (RuRhK):
 * row, gap 6, center. Folder (MPFjV, gap 6, padding [0, 4]: `folder-git-2` 14 text-tertiary +
 * name sans 13 text-secondary) · Sep "/" sans 13 text-tertiary · File (gRY55, gap 6, padding
 * [0, 4]: name sans 13 / 600 text-primary + `chevron-down` 14 text-tertiary) · Sep 2 · Page
 * sans 13 text-secondary.
 */
export function DesktopBreadcrumb({
  folder,
  folderIsRepo = true,
  file,
  page,
  focused = true,
  onFileClick,
  fileOpen = false,
  className,
  ...rest
}: DesktopBreadcrumbProps) {
  const FolderIcon = folderIsRepo ? FolderGit2 : Folder
  const Chevron = fileOpen ? ChevronUp : ChevronDown
  return (
    <nav
      aria-label="File location"
      {...rest}
      className={cx(
        "kimo-desktop-breadcrumb",
        !focused && "kimo-desktop-breadcrumb--inactive",
        className,
      )}
    >
      {folder !== null && (
        <>
          <span className="kimo-desktop-breadcrumb__folder">
            <FolderIcon className="kimo-desktop-breadcrumb__folder-icon" aria-hidden="true" />
            <span className="kimo-desktop-breadcrumb__folder-name">{folder}</span>
          </span>
          <span className="kimo-desktop-breadcrumb__sep" aria-hidden="true">
            /
          </span>
        </>
      )}
      <button
        type="button"
        className={cx(
          "kimo-desktop-breadcrumb__file",
          fileOpen && "kimo-desktop-breadcrumb__file--open",
        )}
        aria-haspopup="menu"
        aria-expanded={fileOpen}
        onClick={onFileClick}
      >
        <span className="kimo-desktop-breadcrumb__file-name">{file}</span>
        <Chevron className="kimo-desktop-breadcrumb__chevron" aria-hidden="true" />
      </button>
      {page != null && (
        <>
          <span className="kimo-desktop-breadcrumb__sep" aria-hidden="true">
            /
          </span>
          <span className="kimo-desktop-breadcrumb__page">{page}</span>
        </>
      )}
    </nav>
  )
}

/** Props for {@link BranchChip}. */
export interface BranchChipProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  /** "main", "feat/onboarding", "main ← feat/pricing-v2". */
  branch: string
}

/**
 * Git branch chip. Mirrors Topbar/Desktop > Branch (Fyxb9): height 22, bg-muted, radius-pill,
 * row, gap 4, padding [0, 8, 0, 6], center; `git-branch` 12 text-secondary + mono 11
 * text-secondary.
 */
export function BranchChip({ branch, className, ...rest }: BranchChipProps) {
  return (
    <span {...rest} className={cx("kimo-branch-chip", className)} title={branch}>
      <GitBranch className="kimo-branch-chip__icon" aria-hidden="true" />
      <span className="kimo-branch-chip__name">{branch}</span>
    </span>
  )
}

/** Props for {@link DesktopTopbar}. */
export interface DesktopTopbarProps extends Omit<ComponentPropsWithRef<"header">, "children"> {
  inset?: number
  focused?: boolean
  drawLights?: boolean
  breadcrumb: ReactNode
  /** Branch chip (omitted outside a repository). */
  branch?: ReactNode
  /** Save Status pill (Oxn3z). */
  status?: ReactNode
  /** Zoom, Theme, Preview, Export (the editor's own controls). */
  trailing?: ReactNode
  /**
   * Windows / Linux (board 20 N1mtd, `decorations: true`): the OS draws the title bar, so the
   * topbar drops the traffic-light inset, takes padding [0, 12] and leads with this logo (the
   * web topbar's 28px "k", uE2vu).
   */
  logo?: ReactNode
}

/**
 * Desktop editor topbar. Mirrors `Topbar/Desktop` (XDqrb): fill_container × 48, bg-app, stroke
 * bottom 1 border, row, gap 8, padding [0, 12, 0, 0], center: Traffic Lights · Breadcrumb ·
 * Branch · Drag Region (fill × 48) · Save Status · trailing controls. The root and the Drag
 * Region carry `data-tauri-drag-region`; everything else opts out. Windows / Linux (board 20
 * N1mtd): `logo` replaces the Traffic Lights and the padding becomes [0, 12].
 */
export function DesktopTopbar({
  inset = 68,
  focused = true,
  drawLights = true,
  breadcrumb,
  branch,
  status,
  trailing,
  logo,
  className,
  ...rest
}: DesktopTopbarProps) {
  return (
    <header
      data-tauri-drag-region=""
      {...rest}
      className={cx(
        "kimo-desktop-topbar",
        logo != null && "kimo-desktop-topbar--native",
        className,
      )}
    >
      {logo ?? <TrafficLights inset={inset} focused={focused} drawLights={drawLights} />}
      {breadcrumb}
      {branch}
      <span className="kimo-desktop-topbar__drag" data-tauri-drag-region="" />
      {status}
      {trailing}
    </header>
  )
}
