/**
 * Desktop Home pieces (board 16 hnvDX "Desktop Home · list view" and the Annex grid QYBeG):
 * - {@link LocalFolders}: sidebar "LOCAL FOLDERS" header (fgqWk) + one row per watched folder
 *   (yjABh / Ll3wG: `folder-git-2` or `folder` · label · spacer · changes dot + count · branch);
 * - {@link RecentFilesHeader}: "Recent files" + note + view Segmented (Xp6lo);
 * - {@link RecentFilesList}: FileRow/Header + FileRows (eso4o);
 * - {@link RecentFilesGrid}: FileCards in rows of four, gap 20 (a2kRP), info "folder · branch · modified".
 * Data comes from `platform.recents` ({@link useRecents}).
 */
import {
  basenameOf,
  dirnameOf,
  type KimoPlatform,
  type RecentFile,
  type WatchedFolder,
} from "@kimo/platform"
import {
  FileCard,
  FileRow,
  type FileRowGitTone,
  FileRowHeader,
  IconButton,
  Segmented,
  StatusPill,
} from "@kimo/ui"
import { Ellipsis, FileX, Folder, FolderGit2, LayoutGrid, List, Plus } from "lucide-react"
import type { MouseEvent, ReactNode } from "react"
import { displayDir, modifiedLabel } from "../platform/format"

/** GIT column label and dot tone (board 16 rows). */
export function gitColumn(file: RecentFile): { label: string; tone: FileRowGitTone } {
  const g = file.git
  if (!g) return { label: "not a repo", tone: "none" }
  const where = g.operation === "merge" ? "merge" : (g.branch ?? "detached")
  if (g.conflicts > 0 || g.status === "conflict") {
    const n = g.conflicts
    return { label: `${where} · ${n > 1 ? `${n} conflicts` : "conflict"}`, tone: "conflict" }
  }
  if (g.status === "modified") return { label: `${where} · modified`, tone: "modified" }
  if (g.status === "untracked") return { label: `${where} · untracked`, tone: "untracked" }
  return { label: `${where} · clean`, tone: "clean" }
}

/** Grid FileCard info line: "loom/design-system · feat/onboarding · 40 min ago". */
export function gridInfo(
  file: RecentFile,
  folders: readonly WatchedFolder[],
  now: number | null,
): string {
  const dir = file.folder
  const root = folders
    .filter((f) => dir === f.ref || dir.startsWith(`${f.ref}/`))
    .sort((a, b) => b.ref.length - a.ref.length)[0]
  const folder = root ? `${root.label}${dir.slice(root.ref.length)}` : basenameOf(dir)
  const modified = now == null ? null : modifiedLabel(file.modifiedAt, now)
  return [folder, file.git?.branch, modified].filter(Boolean).join(" · ")
}

export interface LocalFoldersProps {
  folders: readonly WatchedFolder[]
  /** "+": add a folder (`dialogs.pickFolder` → `recents.addFolder`). */
  onAdd?: () => void
  onOpenFolder?: (folder: WatchedFolder) => void
  /** The folder whose section Home shows (board 37 fiCwk active row, `aria-current=page`). */
  activeRef?: string | null
  /**
   * Board 37 Vgu6J / InPFe: the folder menu, from the ⋯ that replaces the branch on hover
   * (`button`) or a right-click on the row (`event`).
   */
  onMenu?: (folder: WatchedFolder, from: { button: HTMLElement } | { event: MouseEvent }) => void
  /** The folder whose menu is open (its ⋯ stays shown, fill bg-muted). */
  menuRef?: string | null
}

/** Sidebar section "LOCAL FOLDERS". */
export function LocalFolders({
  folders,
  onAdd,
  onOpenFolder,
  activeRef,
  onMenu,
  menuRef,
}: LocalFoldersProps) {
  return (
    <>
      <div className="kimo-files-folders-header" data-pen="fgqWk">
        <span className="kimo-files-folders-header__label">LOCAL FOLDERS</span>
        {onAdd && (
          <IconButton
            className="kimo-files-folders-header__add"
            label="Add folder"
            icon={<Plus />}
            tone="quiet"
            onClick={onAdd}
          />
        )}
      </div>
      {folders.map((f) => {
        const Icon = f.git ? FolderGit2 : Folder
        const active = activeRef === f.ref
        const open = () => onOpenFolder?.(f)
        return (
          // biome-ignore lint/a11y/useSemanticElements: the row holds its own ⋯ button
          <div
            key={f.ref}
            role="link"
            tabIndex={0}
            className={cx(
              "kimo-files-folder",
              active && "kimo-files-folder--active",
              menuRef === f.ref && "kimo-files-folder--menu",
            )}
            {...(active ? { "aria-current": "page" as const } : {})}
            title={f.ref}
            data-folder={f.ref}
            onClick={open}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target === e.currentTarget) open()
            }}
            onContextMenu={
              onMenu
                ? (e) => {
                    e.preventDefault()
                    onMenu(f, { event: e })
                  }
                : undefined
            }
          >
            <Icon className="kimo-files-folder__icon" aria-hidden="true" />
            <span className="kimo-files-folder__label">{f.label}</span>
            <span className="kimo-files-folder__spacer" aria-hidden="true" />
            {f.git && f.git.changedCount > 0 && (
              <span className="kimo-files-folder__changes" title={`${f.git.changedCount} changed`}>
                <span className="kimo-files-folder__dot" aria-hidden="true" />
                <span className="kimo-files-folder__count">{f.git.changedCount}</span>
              </span>
            )}
            {f.git?.branch && <span className="kimo-files-folder__branch">{f.git.branch}</span>}
            {onMenu && (
              <IconButton
                className="kimo-files-folder__menu"
                label={`More actions for ${f.label}`}
                aria-haspopup="menu"
                aria-expanded={menuRef === f.ref}
                icon={<Ellipsis />}
                tone="quiet"
                onClick={(e) => {
                  e.stopPropagation()
                  onMenu(f, { button: e.currentTarget })
                }}
                onKeyDown={(e) => e.stopPropagation()}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ")

export type RecentView = "list" | "grid"

const VIEWS = [
  { value: "grid", label: "Grid view", icon: <LayoutGrid size={14} /> },
  { value: "list", label: "List view", icon: <List size={14} /> },
] as const

export interface RecentFilesHeaderProps {
  folderCount: number
  /** Board 37 §1: the section's count ("24 files"); default "Recent files". */
  title?: string
  /** Default "from 3 folders on disk · sorted by modified". */
  note?: string
  view?: RecentView
  /** Without a handler the view toggle is not shown (Templates, Trash). */
  onViewChange?: (view: RecentView) => void
}

/** "Recent files" · "from 3 folders on disk · sorted by modified" · view toggle. */
export function RecentFilesHeader({
  folderCount,
  title = "Recent files",
  note,
  view,
  onViewChange,
}: RecentFilesHeaderProps) {
  return (
    <div className="kimo-files-recent-header" data-pen="Xp6lo">
      <h2 className="kimo-files-recent-header__title">{title}</h2>
      <span className="kimo-files-recent-header__note">
        {note ??
          `from ${folderCount} folder${folderCount === 1 ? "" : "s"} on disk · sorted by modified`}
      </span>
      <span className="kimo-files-recent-header__spacer" aria-hidden="true" />
      {onViewChange && view && (
        <Segmented label="View" options={VIEWS} value={view} onChange={onViewChange} />
      )}
    </div>
  )
}

export interface RecentFilesProps {
  files: readonly RecentFile[]
  now: number
  selected?: string | null
  onOpen: (file: RecentFile) => void
  /** The ⋯ menu (list) or right-click (list and grid). */
  onMenu?: (file: RecentFile, from: { button: HTMLElement } | { event: MouseEvent }) => void
  /** The file whose menu is open (⋯ fill bg-muted / card thumbnail stroke accent). */
  menuRef?: string | null
  /** Board 37 zucQA: the row being renamed shows this field in its Name cell. */
  renaming?: { ref: string; field: ReactNode } | null
}

/** List view: header + one FileRow per file. */
export function RecentFilesList({
  files,
  now,
  selected,
  onOpen,
  onMenu,
  menuRef,
  renaming,
}: RecentFilesProps) {
  return (
    <div className="kimo-files-list" data-pen="eso4o">
      <FileRowHeader />
      {files.map((f) => {
        const git = gitColumn(f)
        return (
          <FileRow
            key={f.ref}
            data-file={f.ref}
            name={f.name}
            kind={f.name.endsWith(".kimoz") ? "package" : "file"}
            path={displayDir(f.ref)}
            modified={modifiedLabel(f.modifiedAt, now)}
            gitLabel={git.label}
            gitTone={git.tone}
            selected={selected === f.ref}
            missing={f.missing}
            menuOpen={menuRef === f.ref}
            {...(renaming?.ref === f.ref ? { nameSlot: renaming.field } : {})}
            onOpen={() => {
              if (renaming?.ref !== f.ref) onOpen(f)
            }}
            {...(onMenu
              ? {
                  onMenu: (e) => onMenu(f, { button: e.currentTarget }),
                  onContextMenu: (e) => {
                    e.preventDefault()
                    onMenu(f, { event: e })
                  },
                }
              : {})}
          />
        )
      })}
    </div>
  )
}

/** Grid view: FileCards, four per row (gap 24 between rows, 20 between cards). */
export function RecentFilesGrid({
  files,
  folders,
  now,
  onOpen,
  onMenu,
  menuRef,
  info,
}: RecentFilesProps & {
  folders: readonly WatchedFolder[]
  /** Card info line; default "folder · branch · modified". */
  info?: (file: RecentFile) => string
}) {
  const rows: RecentFile[][] = []
  for (let i = 0; i < files.length; i += 4) rows.push(files.slice(i, i + 4))
  return (
    <div className="kimo-files-grid">
      {rows.map((row) => (
        <div key={row[0]?.ref} className="kimo-files-grid__row" data-pen="a2kRP">
          {row.map((f) => (
            <FileCard
              key={f.ref}
              data-file={f.ref}
              className={cx(
                "kimo-files-grid__card",
                menuRef === f.ref && "kimo-files-grid__card--menu",
                f.missing && "kimo-files-grid__card--missing",
              )}
              name={f.name}
              {...(f.missing
                ? {
                    // Board 37 de22N "Card · missing": file-x in the thumbnail, name dimmed,
                    // info row "folder · branch" + StatusPill/Missing in place of the date.
                    thumbnail: (
                      <FileX className="kimo-files-grid__missing-icon" aria-hidden="true" />
                    ),
                    info: (
                      <>
                        <span className="kimo-files-grid__where">{gridInfo(f, folders, null)}</span>
                        <StatusPill status="missing" />
                      </>
                    ),
                  }
                : { info: info ? info(f) : gridInfo(f, folders, now) })}
              onClick={() => onOpen(f)}
              {...(onMenu
                ? {
                    onContextMenu: (e) => {
                      e.preventDefault()
                      onMenu(f, { event: e })
                    },
                  }
                : {})}
            />
          ))}
          {["pad-a", "pad-b", "pad-c"].slice(0, 4 - row.length).map((k) => (
            <span key={k} className="kimo-files-grid__card" aria-hidden="true" />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Adds a watched folder through the folder picker. Resolves to the folder or null. */
export async function addWatchedFolder(platform: KimoPlatform): Promise<string | null> {
  const ref = await platform.dialogs.pickFolder({ title: "Add folder" })
  if (ref) await platform.recents.addFolder(ref)
  return ref
}

/** Label of the folder containing a file (breadcrumb "loom"). */
export const folderLabel = (ref: string) => basenameOf(dirnameOf(ref))
