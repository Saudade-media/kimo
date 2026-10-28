/**
 * Board 16 hnvDX + board 37 "Home & gaps": the desktop Home over `platform.recents` (real files
 * on disk). One section at a time (rules xKrpy "Sections"): Recents, All files, a watched
 * folder, Templates, Design systems or Trash; the active row, the h1, the search scope and the
 * list all come from it.
 */
import {
  basenameOf,
  dirnameOf,
  type FileRef,
  KIMO_FILE_FILTER,
  KIMO_OPEN_FILTER,
  type KimoPlatform,
  type RecentFile,
  type TrashedFile,
  type WatchedFolder,
} from "@kimo/platform"
import { Button, Input } from "@kimo/ui"
import {
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  History,
  SearchX,
  SwatchBook,
  Trash2,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  addWatchedFolder,
  RecentFilesGrid,
  RecentFilesHeader,
  RecentFilesList,
  type RecentView,
  useNow,
} from "../files"
import { Icon } from "../lib/icons"
import { useHomeCommands } from "../lib/native-menu"
import { revealLabel } from "../platform/contract"
import { displayDir, displayPath, modifiedLabel } from "../platform/format"
import { useOpenSettings, useRuntime } from "../platform/runtime"
import { diskPath, type HomeSection, homeSectionPath, navigate } from "../router"
import { copyThumbnail, diskThumbnails, forgetThumbnails } from "../thumbnails/store"
import { HomeComposer } from "./HomeComposer"
import {
  copyName,
  countLabel,
  failure,
  filesNote,
  isExists,
  joinPath,
  type LibraryEntry,
  libraryIndex,
  libraryInfo,
  mergeFiles,
  probeDocument,
  resolveFolder,
  SECTION_TITLE,
  searchFiles,
} from "./model"
import {
  type ConfirmState,
  DangerConfirm,
  type FileMenuEntry,
  HomeEmpty,
  HomeMenu,
  HomeToasts,
  MENU_ICONS,
  type MenuAt,
  menuAtCursor,
  menuFromButton,
  RenameField,
  TemplateCard,
  TrashRow,
  TrashRowHeader,
  useHomeToasts,
} from "./parts"
import { HomeSidebar } from "./Sidebar"
import {
  createTemplateOnDisk,
  createTemplateWithSaveAs,
  TEMPLATES,
  type Template,
} from "./templates"
import { useWorkspaceTitle, WorkspaceFiles, WorkspaceHeaderButtons } from "./WorkspaceHome"

type MenuFrom = { button: HTMLElement } | { event: React.MouseEvent }
const at = (from: MenuFrom): MenuAt =>
  "button" in from ? menuFromButton(from.button) : menuAtCursor(from.event)

/** The OS trash's name in copy ("the macOS Trash"). */
function osTrashName(os: KimoPlatform["os"]): string {
  return os === "macos" ? "the macOS Trash" : "the Trash"
}

const RECENTS_LIMIT = 50

interface Lists {
  recents: RecentFile[]
  folders: WatchedFolder[]
  /** Every known file: uncapped recents plus each folder's scan. */
  all: RecentFile[]
  scans: Map<string, RecentFile[]>
}

/** Recents, folders and All files (rules "Lists"), refreshed on `recents.onChange`. */
function useDesktopLists(platform: KimoPlatform) {
  const [lists, setLists] = useState<Lists | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    const [folders, history] = await Promise.all([
      platform.recents.listFolders(),
      platform.recents.listFiles(),
    ])
    // Rules "Lists": Recents = recently opened (listFiles also carries watched-folder files).
    const recents = history
      .filter((f) => f.openedAt !== null)
      .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))
      .slice(0, RECENTS_LIMIT)
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
    const scans = new Map<string, RecentFile[]>()
    await Promise.all(
      folders.map(async (f) =>
        scans.set(f.ref, await platform.recents.scanFolder(f.ref).catch(() => [])),
      ),
    )
    setLists({ recents, folders, all: mergeFiles(history, ...scans.values()), scans })
    setError(null)
  }, [platform])
  useEffect(() => {
    let live = true
    const load = () =>
      void reload().catch((e: unknown) => live && setError(failure("list your files", e)))
    load()
    const off = platform.recents.onChange(load)
    // Files can move or vanish while Kimo is in the background: re-list on focus.
    const offFocus = platform.window.onFocusChange((focused) => {
      if (focused) load()
    })
    return () => {
      live = false
      off()
      offFocus()
    }
  }, [platform, reload])
  return { lists, error, reload }
}

/** Design systems over the All files set (rules "Design systems"). */
function useLibraries(platform: KimoPlatform, all: readonly RecentFile[] | undefined) {
  const [libs, setLibs] = useState<LibraryEntry[] | null>(null)
  const cache = useRef(new Map<string, ReturnType<typeof probeDocument>>())
  useEffect(() => {
    if (!all) return
    let live = true
    void (async () => {
      const probes = []
      for (const f of all.slice(0, 500)) {
        if (f.missing) continue
        const key = `${f.ref}\u0000${f.modifiedAt}`
        if (!cache.current.has(key)) {
          const text = await platform.files
            .readText(f.ref)
            .then((r) => r.text)
            .catch(() => null)
          cache.current.set(key, text === null ? null : probeDocument(f.ref, text))
        }
        const p = cache.current.get(key)
        if (p) probes.push(p)
      }
      if (live) setLibs(libraryIndex(probes))
    })()
    return () => {
      live = false
    }
  }, [platform, all])
  return libs
}

export function DesktopHomeView({
  platform,
  section,
}: {
  platform: KimoPlatform
  section: HomeSection
}) {
  const openSettings = useOpenSettings()
  const { manager } = useRuntime()
  const { lists, error: listError, reload } = useDesktopLists(platform)
  const libraries = useLibraries(platform, lists?.all)
  // Board 37 §9: the grid cards' previews (`~/.kimo/thumbs`).
  const thumbnails = useMemo(() => diskThumbnails(platform), [platform])
  const now = useNow()
  const [query, setQuery] = useState("")
  const [view, setView] = useState<RecentView>("list")
  const [libView, setLibView] = useState<RecentView>("grid")
  const [menu, setMenu] = useState<{ file: RecentFile; at: MenuAt } | null>(null)
  const [folderMenu, setFolderMenu] = useState<{ folder: WatchedFolder; at: MenuAt } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [trashTick, setTrashTick] = useState(0)
  const { toasts, show, dismiss } = useHomeToasts()
  const fail = useCallback(
    (text: string, kind = "error", action?: { label: string; run: () => void }) =>
      show({ tone: "danger", text, kind, ...(action ? { action } : {}) }),
    [show],
  )

  // The search scope is the section: a new section starts with an empty search.
  const sectionKey = homeSectionPath(section)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on section change only
  useEffect(() => {
    setQuery("")
    setMenu(null)
    setFolderMenu(null)
    setRenaming(null)
  }, [sectionKey])

  const folder =
    section.kind === "folder" && lists ? resolveFolder(section.ref, lists.folders) : null
  // `#/folder/<ref>` outside every added folder lands on All files (rules "Back to Home").
  useEffect(() => {
    if (section.kind === "folder" && lists && !folder) navigate("/all")
  }, [section, lists, folder])

  const openPicked = useCallback(async () => {
    try {
      const [ref] = await platform.dialogs.openFile({ title: "Open", filters: [KIMO_OPEN_FILTER] })
      if (ref) navigate(diskPath(ref))
    } catch (e) {
      fail(failure("open the file", e))
    }
  }, [platform, fail])
  const newFile = useCallback(async () => {
    // Board 20 V7ey1Q: no dialog up front — an untitled document opens right away and asks
    // where on its first ⌘S.
    try {
      navigate(diskPath((await manager.newUntitled()).ref))
    } catch (e) {
      fail(failure("create a file", e))
    }
  }, [manager, fail])
  const addFolder = useCallback(() => {
    void addWatchedFolder(platform).catch((e: unknown) => fail(failure("add the folder", e)))
  }, [platform, fail])
  // B9: ⌘N / ⌘O and File › New file / Open… (menu.rs); Edit items act on Home's text fields.
  useHomeCommands(platform, { newFile: () => void newFile(), openFile: () => void openPicked() })

  /** An open session on `ref` flushes and closes first, so it never writes the old path. */
  const release = useCallback(
    async (ref: FileRef) => {
      for (const s of manager.sessions()) if (s.ref === ref) await s.close()
    },
    [manager],
  )

  // --- file actions (board 37 §5, rules "File menu") ---
  const openFile = useCallback(
    (f: RecentFile) => {
      if (!f.missing) return navigate(diskPath(f.ref))
      show({
        tone: "warning",
        kind: "missing",
        text: `Couldn't find ${f.name}. It was moved or deleted.`,
        action: {
          label: "Remove from Recents",
          run: () =>
            void platform.recents
              .removeFile(f.ref)
              .catch((e: unknown) => fail(failure(`remove ${f.name} from Recents`, e))),
        },
      })
    },
    [platform, show, fail],
  )
  const reveal = (ref: FileRef, name: string) =>
    void platform.files.reveal(ref).catch((e: unknown) => fail(failure(`reveal ${name}`, e)))
  const moveToTrash = async (f: RecentFile) => {
    const trash = platform.trash
    if (!trash) return fail(`Couldn't move ${f.name} to the Trash. This host has no Trash.`)
    try {
      await release(f.ref)
      const entry = await trash.move(f.ref)
      show({
        tone: "success",
        kind: "trashed",
        text: `Moved ${f.name} to the Trash`,
        action: {
          label: "Undo",
          run: () =>
            void trash
              .restore(entry.id)
              .catch((e: unknown) => fail(failure(`restore ${f.name}`, e))),
        },
      })
    } catch (e) {
      fail(failure(`move ${f.name} to the Trash`, e))
    }
  }
  const rename = async (f: RecentFile, next: string) => {
    const ext = f.name.match(/\.kimoz?$/i)?.[0] ?? ".kimo"
    const name = /\.kimoz?$/i.test(next) ? next : `${next}${ext}`
    if (/[\\/]/.test(name)) return fail(`Couldn't rename ${f.name}. A name can't contain / or \\.`)
    const to = joinPath(dirnameOf(f.ref), name)
    if (to === f.ref) return
    try {
      await release(f.ref)
      await platform.files.rename(f.ref, to)
      await thumbnails?.move(f.ref, to).catch(() => {})
      if (f.openedAt !== null) {
        await platform.recents.removeFile(f.ref).catch(() => {})
        await platform.recents.noteOpened(to).catch(() => {})
      }
      await reload().catch(() => {})
    } catch (e) {
      fail(failure(`rename ${f.name}`, e, name), "rename")
    }
  }
  const duplicate = async (f: RecentFile) => {
    try {
      const dir = dirnameOf(f.ref)
      const taken = new Set((await platform.files.list(dir)).map((s) => s.name))
      const to = joinPath(
        dir,
        copyName(f.name, (n) => taken.has(n)),
      )
      await platform.files.copy(f.ref, to)
      await copyThumbnail(thumbnails, f.ref, to)
      await platform.recents.noteOpened(to)
    } catch (e) {
      fail(failure(`duplicate ${f.name}`, e))
    }
  }
  const fileMenuItems = (f: RecentFile): FileMenuEntry[] => {
    const removeRecent: FileMenuEntry = {
      id: "remove-recent",
      label: "Remove from Recents",
      icon: MENU_ICONS.removeRecent,
      run: () =>
        void platform.recents
          .removeFile(f.ref)
          .catch((e: unknown) => fail(failure(`remove ${f.name} from Recents`, e))),
    }
    if (f.missing)
      return [
        {
          id: "locate",
          label: "Locate…",
          icon: MENU_ICONS.reveal,
          run: () =>
            void (async () => {
              const [ref] = await platform.dialogs.openFile({
                title: `Locate ${f.name}`,
                filters: [KIMO_FILE_FILTER],
              })
              if (!ref) return
              await platform.recents.removeFile(f.ref).catch(() => {})
              navigate(diskPath(ref))
            })().catch((e: unknown) => fail(failure(`locate ${f.name}`, e))),
        },
        {
          id: "reveal-folder",
          label: "Reveal folder",
          icon: MENU_ICONS.open,
          run: () => reveal(f.folder, basenameOf(f.folder)),
        },
        "divider",
        removeRecent,
      ]
    return [
      { id: "open", label: "Open", icon: MENU_ICONS.open, meta: "↵", run: () => openFile(f) },
      {
        id: "reveal",
        label: revealLabel(platform.os),
        icon: MENU_ICONS.reveal,
        run: () => reveal(f.ref, f.name),
      },
      "divider",
      {
        id: "rename",
        label: "Rename",
        icon: MENU_ICONS.rename,
        run: () => {
          // Rename happens in a list row: switch the view this section uses.
          if (section.kind === "libraries") setLibView("list")
          else setView("list")
          setRenaming(f.ref)
        },
      },
      {
        id: "duplicate",
        label: "Duplicate",
        icon: MENU_ICONS.duplicate,
        run: () => void duplicate(f),
      },
      "divider",
      ...(f.openedAt !== null ? [removeRecent] : []),
      {
        id: "trash",
        label: "Move to Trash",
        icon: MENU_ICONS.trash,
        meta: platform.os === "macos" ? "⌘⌫" : "Ctrl+Del",
        danger: true,
        run: () => void moveToTrash(f),
      },
    ]
  }

  // ⌘⌫ on a focused row moves it to the Trash (the menu's shortcut).
  const onListKey = (e: React.KeyboardEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-file]")
    if (!row || !(e.key === "Backspace" || e.key === "Delete") || !(e.metaKey || e.ctrlKey)) return
    const f = lists?.all.find((x) => x.ref === row.dataset.file)
    if (!f) return
    e.preventDefault()
    void moveToTrash(f)
  }

  // --- folder menu (Vgu6J / InPFe) ---
  const folderItems = (f: WatchedFolder): FileMenuEntry[] => [
    {
      id: "reveal",
      label: revealLabel(platform.os),
      icon: MENU_ICONS.reveal,
      run: () => reveal(f.ref, f.label),
    },
    "divider",
    {
      id: "remove-folder",
      label: "Remove from Kimo",
      icon: MENU_ICONS.removeFolder,
      run: () =>
        void (async () => {
          await platform.recents.removeFolder(f.ref)
          if (folder?.ref === f.ref) navigate("/all")
          show({
            tone: "success",
            kind: "folder-removed",
            text: `Removed ${f.label} from Kimo`,
            action: {
              label: "Undo",
              run: () =>
                void platform.recents
                  .addFolder(f.ref)
                  .catch((e: unknown) => fail(failure(`add ${f.label} back`, e))),
            },
          })
        })().catch((e: unknown) => fail(failure(`remove ${f.label} from Kimo`, e))),
    },
  ]

  // --- templates (board 37 §2) ---
  const applyTemplate = async (t: Template) => {
    setBusy(t.dir)
    try {
      navigate(diskPath(await createTemplateOnDisk(platform, t)))
    } catch (e) {
      fail(failure(`create ${t.file}`, e), "template", {
        label: "Choose folder…",
        run: () =>
          void createTemplateWithSaveAs(platform, t)
            .then((ref) => ref && navigate(diskPath(ref)))
            .catch((err: unknown) => fail(failure(`create ${t.file}`, err), "template")),
      })
    } finally {
      setBusy(null)
    }
  }

  // --- render ---
  const workspaceTitle = useWorkspaceTitle(section.kind === "workspace" ? section.id : "")
  const title =
    section.kind === "folder"
      ? (folder?.label ?? basenameOf(section.ref))
      : section.kind === "workspace"
        ? (workspaceTitle ?? "")
        : SECTION_TITLE[section.kind]
  const sectionFiles: RecentFile[] | null = !lists
    ? null
    : section.kind === "recents"
      ? lists.recents
      : section.kind === "all"
        ? lists.all
        : section.kind === "folder"
          ? folder
            ? (lists.scans.get(folder.ref) ?? [])
            : []
          : null
  const shown = useMemo(() => searchFiles(sectionFiles ?? [], query), [sectionFiles, query])
  const folderCount = lists?.folders.length ?? 0
  const filesHeader = (count: number) => (
    <RecentFilesHeader
      folderCount={folderCount}
      {...(section.kind === "recents"
        ? {}
        : { title: countLabel(count), note: filesNote(section.kind, folderCount) })}
      view={view}
      onViewChange={setView}
    />
  )
  const headerButtons = (
    <>
      <Button variant="secondary" icon={<FolderOpen size={16} />} onClick={() => void openPicked()}>
        Open…
      </Button>
      <Button
        variant="primary"
        icon={<Icon name="plus" size={16} />}
        onClick={() => void newFile()}
      >
        New file
      </Button>
    </>
  )
  const searchPlaceholder =
    section.kind === "templates"
      ? "Search templates"
      : section.kind === "libraries"
        ? "Search design systems"
        : section.kind === "trash"
          ? "Search trash"
          : "Search files"

  // The inline rename field for the row being renamed, in whichever list shows it.
  const renamingRow = (rows: RecentFile[]) =>
    renaming
      ? {
          ref: renaming,
          field: (
            <RenameField
              name={basenameOf(renaming)}
              onCommit={(next) => {
                const f = rows.find((x) => x.ref === renaming)
                setRenaming(null)
                if (f) void rename(f, next)
              }}
              onCancel={() => setRenaming(null)}
            />
          ),
        }
      : null

  let body: React.ReactNode
  if (section.kind === "workspace") {
    body = (
      <WorkspaceFiles
        platform={platform}
        workspaceId={section.id}
        query={query}
        view={view}
        onViewChange={setView}
        now={now}
      />
    )
  } else if (section.kind === "templates") {
    body = (
      <TemplatesGrid
        templates={searchFiles(TEMPLATES, query)}
        busy={busy}
        onUse={(t) => void applyTemplate(t)}
      />
    )
  } else if (section.kind === "trash") {
    body = (
      <DesktopTrash
        platform={platform}
        tick={trashTick}
        query={query}
        onToast={show}
        onFail={fail}
        onConfirm={setConfirm}
        onClearSearch={() => setQuery("")}
      />
    )
  } else if (section.kind === "libraries") {
    const libFiles =
      libraries && lists
        ? libraries
            .map((l) => ({ l, f: lists.all.find((f) => f.ref === l.ref) }))
            .filter((x): x is { l: LibraryEntry; f: RecentFile } => !!x.f)
        : null
    const libShown = searchFiles(libFiles?.map((x) => x.f) ?? [], query)
    body = (
      <>
        <RecentFilesHeader
          folderCount={folderCount}
          title={countLabel(libFiles?.length ?? 0, "library", "libraries")}
          note="files that other files import, or that publish components"
          view={libView}
          onViewChange={setLibView}
        />
        {libFiles && libFiles.length === 0 ? (
          <HomeEmpty
            kind="libraries"
            icon={<SwatchBook />}
            title="No design systems yet"
            description="A file shows up here when another file imports it or it publishes components."
          />
        ) : libFiles && libShown.length === 0 ? (
          <NoMatch query={query} onClear={() => setQuery("")} />
        ) : libView === "grid" ? (
          <RecentFilesGrid
            thumbnails={thumbnails}
            files={libShown}
            folders={lists?.folders ?? []}
            now={now}
            onOpen={openFile}
            info={(f) => {
              const l = libraries?.find((x) => x.ref === f.ref)
              return l ? libraryInfo(l) : ""
            }}
            onMenu={(f, from) => setMenu({ file: f, at: at(from) })}
            menuRef={menu?.file.ref ?? null}
          />
        ) : (
          <RecentFilesList
            files={libShown}
            now={now}
            onOpen={openFile}
            onMenu={(f, from) => setMenu({ file: f, at: at(from) })}
            menuRef={menu?.file.ref ?? null}
            renaming={renamingRow(libShown)}
          />
        )}
      </>
    )
  } else {
    const empty = sectionFiles !== null && sectionFiles.length === 0
    body = (
      <>
        {section.kind === "recents" && <HomeComposer platform={platform} />}
        {filesHeader(sectionFiles?.length ?? 0)}
        {empty && section.kind === "folder" && folder ? (
          <HomeEmpty
            kind="folder"
            icon={<Folder />}
            title={`No .kimo files in ${folder.label}`}
            description="Files you save in this folder or its subfolders show up here."
            actions={[
              {
                label: revealLabel(platform.os),
                variant: "secondary",
                onClick: () => reveal(folder.ref, folder.label),
              },
            ]}
          />
        ) : empty && section.kind === "recents" && lists && lists.all.length > 0 ? (
          // Recents lists only files you opened; watched folders already hold files (B10).
          <HomeEmpty
            kind="no-recents"
            icon={<History />}
            title="Nothing opened yet"
            description="Files you open show up here."
            actions={[
              { label: "Show all files", variant: "secondary", onClick: () => navigate("/all") },
            ]}
          />
        ) : empty ? (
          <HomeEmpty
            kind="no-files"
            icon={<FilePlus />}
            title="No files yet"
            description="Create a file, open one from disk, or add a folder to list its .kimo files here."
            actions={[
              { label: "New file", variant: "primary", onClick: () => void newFile() },
              {
                label: "Open…",
                variant: "secondary",
                icon: <FolderOpen />,
                onClick: () => void openPicked(),
              },
              { label: "Add folder…", variant: "ghost", icon: <FolderPlus />, onClick: addFolder },
            ]}
          />
        ) : sectionFiles && shown.length === 0 ? (
          <NoMatch query={query} onClear={() => setQuery("")} />
        ) : view === "list" ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: forwards ⌘⌫ from the focused row
          <div className="home-file-list" onKeyDown={onListKey}>
            <RecentFilesList
              files={shown}
              now={now}
              onOpen={openFile}
              onMenu={(f, from) => setMenu({ file: f, at: at(from) })}
              menuRef={menu?.file.ref ?? null}
              renaming={renamingRow(shown)}
            />
          </div>
        ) : (
          <RecentFilesGrid
            thumbnails={thumbnails}
            files={shown}
            folders={lists?.folders ?? []}
            now={now}
            onOpen={openFile}
            onMenu={(f, from) => setMenu({ file: f, at: at(from) })}
            menuRef={menu?.file.ref ?? null}
          />
        )}
      </>
    )
  }

  const message = listError
  return (
    <div className="home">
      <HomeSidebar
        platform={platform}
        desktop
        section={section}
        allCount={lists ? lists.all.length : null}
        libraryCount={libraries ? libraries.length : null}
        folders={{
          list: lists?.folders ?? [],
          activeRef: folder?.ref ?? null,
          menuRef: folderMenu?.folder.ref ?? null,
          onAdd: addFolder,
          onOpen: (f) => navigate(homeSectionPath({ kind: "folder", ref: f.ref })),
          onMenu: (f, from) => setFolderMenu({ folder: f, at: at(from) }),
        }}
        onOpenSettings={() => openSettings("general")}
      />

      <main
        className="home-main home-main--desktop"
        data-tauri-drag-region=""
        data-section={section.kind}
      >
        <header className="home-header" data-tauri-drag-region="">
          <h1 className="home-header__title" data-tauri-drag-region="">
            {title}
          </h1>
          {folder && (
            <span className="home-header__path" data-tauri-drag-region="">
              {[displayPath(folder.ref), folder.git?.branch].filter(Boolean).join(" · ")}
            </span>
          )}
          <span className="home-header__spacer" data-tauri-drag-region="" />
          <Input
            icon={<Icon name="search" size={16} />}
            type="search"
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            frameProps={{ className: "home-header__search" }}
          />
          {section.kind === "workspace" ? (
            <WorkspaceHeaderButtons platform={platform} workspaceId={section.id} />
          ) : section.kind === "trash" ? (
            <EmptyTrashButton
              platform={platform}
              onConfirm={setConfirm}
              onFail={fail}
              onEmptied={() => setTrashTick((t) => t + 1)}
            />
          ) : (
            headerButtons
          )}
        </header>

        {message && (
          <p className="home-error" role="alert">
            {message}
          </p>
        )}
        {body}
      </main>

      {menu && (
        <HomeMenu
          at={menu.at}
          width={232}
          label={`${menu.file.name} actions`}
          items={fileMenuItems(menu.file)}
          onClose={() => setMenu(null)}
        />
      )}
      {folderMenu && (
        <HomeMenu
          at={folderMenu.at}
          width={200}
          label={`${folderMenu.folder.label} actions`}
          items={folderItems(folderMenu.folder)}
          onClose={() => setFolderMenu(null)}
        />
      )}
      <DangerConfirm state={confirm} onClose={() => setConfirm(null)} />
      <HomeToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

/** Empty state for a search with no match (FCuMM). */
export function NoMatch({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <HomeEmpty
      kind="no-match"
      icon={<SearchX />}
      title="No matches"
      description={`No files match “${query.trim()}”. Check the spelling or clear the search.`}
      actions={[{ label: "Clear search", variant: "secondary", onClick: onClear }]}
    />
  )
}

/** Template Grid (cOoFh): vertical, gap 24; rows of 4 cards, gap 20, spacer frames. */
export function TemplatesGrid({
  templates,
  busy,
  onUse,
}: {
  templates: readonly Template[]
  busy: string | null
  onUse: (t: Template) => void
}) {
  const rows: Template[][] = []
  for (let i = 0; i < templates.length; i += 4) rows.push(templates.slice(i, i + 4))
  return (
    <>
      <RecentFilesHeader
        folderCount={0}
        title={countLabel(templates.length, "template")}
        note="bundled with Kimo · each one opens as a new file"
      />
      <div className="home-template-grid">
        {rows.map((row) => (
          <div key={row[0]?.dir} className="home-template-grid__row">
            {row.map((t) => (
              <TemplateCard key={t.dir} template={t} busy={busy !== null} onUse={() => onUse(t)} />
            ))}
            {["pad-a", "pad-b", "pad-c"].slice(0, 4 - row.length).map((k) => (
              <span key={k} className="home-template-grid__spacer" aria-hidden="true" />
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

/** Header "Empty trash…" (wxdAD): Button/Secondary, icon trash-2. */
function EmptyTrashButton({
  platform,
  onConfirm,
  onFail,
  onEmptied,
}: {
  platform: KimoPlatform
  onConfirm: (c: ConfirmState) => void
  onFail: (text: string) => void
  onEmptied: () => void
}) {
  return (
    <Button
      variant="secondary"
      icon={<Trash2 size={16} />}
      onClick={() =>
        void (async () => {
          const trash = platform.trash
          if (!trash) throw new Error("This host has no Trash.")
          const entries = await trash.list()
          const n = entries.length
          if (n === 0) throw new Error("It's already empty.")
          onConfirm({
            title: "Empty the Trash?",
            description: `Kimo deletes the ${countLabel(n)} it moved to ${osTrashName(platform.os)}. You can't restore them after this. Other items in the Trash stay.`,
            confirmLabel: "Empty trash",
            failTitle: "Couldn't empty the Trash",
            run: async () => {
              try {
                await trash.empty()
                // Board 37 §9: previews of files deleted for good go too.
                await forgetThumbnails(
                  diskThumbnails(platform),
                  entries.map((e) => e.originalRef),
                )
              } finally {
                onEmptied()
              }
            },
          })
        })().catch((e: unknown) => onFail(failure("empty the Trash", e)))
      }
    >
      Empty trash…
    </Button>
  )
}

/** Desktop Trash (TPtBe): files Kimo moved to the OS trash, with Restore and Delete forever. */
function DesktopTrash({
  platform,
  tick,
  query,
  onToast,
  onFail,
  onConfirm,
  onClearSearch,
}: {
  platform: KimoPlatform
  /** Bumped after Empty trash. */
  tick: number
  query: string
  onToast: ReturnType<typeof useHomeToasts>["show"]
  onFail: (text: string, kind?: string, action?: { label: string; run: () => void }) => void
  onConfirm: (c: ConfirmState) => void
  onClearSearch: () => void
}) {
  const now = useNow()
  const [entries, setEntries] = useState<TrashedFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (!platform.trash) throw new Error("This host has no Trash.")
    setEntries(await platform.trash.list())
    setError(null)
  }, [platform])
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-lists after Empty trash
  useEffect(() => {
    const run = () => void load().catch((e: unknown) => setError(failure("list the Trash", e)))
    run()
    return platform.recents.onChange(run)
  }, [platform, load, tick])

  const restore = async (t: TrashedFile, to?: FileRef) => {
    const trash = platform.trash
    if (!trash) return
    setBusy(t.id)
    try {
      const ref = await trash.restore(t.id, to)
      if (ref !== t.originalRef) await copyThumbnail(diskThumbnails(platform), t.originalRef, ref)
      onToast({ tone: "success", kind: "restored", text: `Restored ${basenameOf(ref)}` })
    } catch (e) {
      if (isExists(e))
        onFail(`Couldn't restore ${t.name}. A file with that name exists.`, "restore", {
          label: "Restore as copy",
          run: () =>
            void (async () => {
              const dir = dirnameOf(t.originalRef)
              const taken = new Set((await platform.files.list(dir)).map((s) => s.name))
              await restore(
                t,
                joinPath(
                  dir,
                  copyName(t.name, (n) => taken.has(n)),
                ),
              )
            })().catch((err: unknown) => onFail(failure(`restore ${t.name}`, err), "restore")),
        })
      else onFail(failure(`restore ${t.name}`, e), "restore")
    } finally {
      setBusy(null)
      await load().catch(() => {})
    }
  }

  const shown = searchFiles(entries ?? [], query)
  return (
    <>
      <RecentFilesHeader
        folderCount={0}
        title={countLabel(entries?.length ?? 0)}
        note={`in ${osTrashName(platform.os)} · Restore puts a file back where it was`}
      />
      {error && (
        <p className="home-error" role="alert">
          {error}
        </p>
      )}
      {entries && entries.length === 0 ? (
        <HomeEmpty
          kind="trash"
          icon={<Trash2 />}
          title="Trash is empty"
          description="Files you move to the Trash from Kimo show up here until you empty the Trash."
        />
      ) : entries && shown.length === 0 ? (
        <NoMatch query={query} onClear={onClearSearch} />
      ) : (
        <div className="home-trash-list">
          <TrashRowHeader locationLabel="ORIGINAL LOCATION" />
          {shown.map((t) => (
            <TrashRow
              key={t.id}
              name={t.name}
              location={displayDir(t.originalRef)}
              deleted={modifiedLabel(t.trashedAt, now)}
              busy={busy === t.id}
              onRestore={() => void restore(t)}
              onDelete={() =>
                onConfirm({
                  title: `Delete “${t.name}” forever?`,
                  description: "You can't restore it after this.",
                  confirmLabel: "Delete forever",
                  failTitle: `Couldn't delete ${t.name}`,
                  run: async () => {
                    await platform.trash?.remove(t.id)
                    await forgetThumbnails(diskThumbnails(platform), [t.originalRef])
                    await load()
                  },
                })
              }
            />
          ))}
        </div>
      )}
    </>
  )
}
