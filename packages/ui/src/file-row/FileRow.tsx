import { Ellipsis, File, FileX, Package } from "lucide-react"
import { type ComponentPropsWithRef, type MouseEvent, type ReactNode, useRef } from "react"
import { IconButton } from "../icon-button/IconButton"
import { cx } from "../internal/util"
import { StatusPill } from "../status-pill/StatusPill"
import { useMiddleTruncate } from "./middle-truncate"

/** Git dot tone: `clean` border-strong, `modified` warning, `untracked` success, `conflict`
 * danger, `none` ("not a repo") border. */
export type FileRowGitTone = "clean" | "modified" | "untracked" | "conflict" | "none"

/** Props for {@link FileRow}. Remaining `<div>` props go to the row. */
export interface FileRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  name: string
  /** LOCATION, shortened (`~/Work/kimo-site/design`); middle-truncated to fit. */
  path: string
  /** MODIFIED ("Just now", "12 min ago", "Yesterday"). */
  modified: string
  /** GIT label ("main · clean", "merge · 3 conflicts", "not a repo"). */
  gitLabel: string
  gitTone: FileRowGitTone
  /** `file` (`.kimo`) or `package` (`.kimoz`). */
  kind?: "file" | "package"
  /** `FileRow/Selected` (bg-hover). */
  selected?: boolean
  /** Opens the file (click, Enter). */
  onOpen?: () => void
  /** The ⋯ menu button; without a handler the cell stays empty (no dead button). */
  onMenu?: (e: MouseEvent<HTMLButtonElement>) => void
  /** Board 37 oRMVN: the row's menu is open (⋯ fill bg-muted). */
  menuOpen?: boolean
  /**
   * Board 37 axZMZ "Row · missing": `file-x` and name text-tertiary, path struck through,
   * StatusPill/Missing (jwQVJ) in the Modified cell, git dot border with label "—".
   */
  missing?: boolean
  /** Replaces the name text (board 37 zucQA inline rename field). */
  nameSlot?: ReactNode
}

/**
 * Home list row. Mirrors `FileRow` (K4gLI) and /Modified (KuHqA), /Untracked (tOPzo),
 * /Conflict (O3Tio3), /Selected (h6Wghb): height 48, row, gap 12, padding [0, 12], center,
 * stroke bottom 1 border. Icon Tile 28 (bg-muted, radius-sm, icon 14 text-secondary) · Name
 * Cell 200 (sans 13 / 500 text-primary) · Path Cell fill, clip (mono 11 text-tertiary) ·
 * Modified Cell 112 (sans 12 text-secondary) · Git Cell 168, clip, gap 6 (Dot 6 + label sans
 * 11 text-secondary) · Menu IconButton 28, transparent, `ellipsis` text-tertiary.
 */
export function FileRow({
  name,
  path,
  modified,
  gitLabel,
  gitTone,
  kind = "file",
  selected = false,
  onOpen,
  onMenu,
  menuOpen = false,
  missing = false,
  nameSlot,
  className,
  onClick,
  onKeyDown,
  ...rest
}: FileRowProps) {
  const pathRef = useRef<HTMLSpanElement>(null)
  const shownPath = useMiddleTruncate(pathRef, path)
  const Icon = missing ? FileX : kind === "package" ? Package : File
  return (
    // biome-ignore lint/a11y/useSemanticElements: a grid row with an interactive menu cell
    <div
      role="row"
      tabIndex={0}
      aria-selected={selected}
      {...rest}
      className={cx(
        "kimo-file-row",
        selected && "kimo-file-row--selected",
        missing && "kimo-file-row--missing",
        className,
      )}
      data-git={missing ? "none" : gitTone}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) onOpen?.()
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (!e.defaultPrevented && e.key === "Enter" && e.target === e.currentTarget) onOpen?.()
      }}
    >
      <span className="kimo-file-row__icon-tile" aria-hidden="true">
        <Icon />
      </span>
      <span className="kimo-file-row__name-cell">
        {nameSlot ?? <span className="kimo-file-row__name">{name}</span>}
      </span>
      <span className="kimo-file-row__path-cell" title={path}>
        <span ref={pathRef} className="kimo-file-row__path">
          {shownPath}
        </span>
      </span>
      <span className="kimo-file-row__modified-cell">
        {missing ? (
          <StatusPill status="missing" />
        ) : (
          <span className="kimo-file-row__modified">{modified}</span>
        )}
      </span>
      <span className="kimo-file-row__git-cell">
        <span className="kimo-file-row__dot" aria-hidden="true" />
        <span className="kimo-file-row__git">{missing ? "—" : gitLabel}</span>
      </span>
      {onMenu ? (
        <IconButton
          className={cx("kimo-file-row__menu", menuOpen && "kimo-file-row__menu--open")}
          label={`More actions for ${name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          icon={<Ellipsis />}
          tone="quiet"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onMenu(e)
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="kimo-file-row-header__menu-cell" aria-hidden="true" />
      )}
    </div>
  )
}

/** Props for {@link FileRowHeader}. */
export type FileRowHeaderProps = ComponentPropsWithRef<"div">

/**
 * Column headers. Mirrors `FileRow/Header` (ZyDkD): height 32, row, gap 12, padding [0, 12],
 * center, stroke bottom 1 border; Icon Cell 28 · NAME 200 · LOCATION fill · MODIFIED 112 · GIT
 * 168 · Menu Cell 28; labels sans 11 / 600 text-tertiary, letter-spacing 0.6.
 */
export function FileRowHeader({ className, ...rest }: FileRowHeaderProps) {
  return (
    <div aria-hidden="true" {...rest} className={cx("kimo-file-row-header", className)}>
      <span className="kimo-file-row-header__icon-cell" aria-hidden="true" />
      <span className="kimo-file-row-header__cell kimo-file-row-header__cell--name">
        <span className="kimo-file-row-header__label">NAME</span>
      </span>
      <span className="kimo-file-row-header__cell kimo-file-row-header__cell--path">
        <span className="kimo-file-row-header__label">LOCATION</span>
      </span>
      <span className="kimo-file-row-header__cell kimo-file-row-header__cell--modified">
        <span className="kimo-file-row-header__label">MODIFIED</span>
      </span>
      <span className="kimo-file-row-header__cell kimo-file-row-header__cell--git">
        <span className="kimo-file-row-header__label">GIT</span>
      </span>
      <span className="kimo-file-row-header__menu-cell" aria-hidden="true" />
    </div>
  )
}
