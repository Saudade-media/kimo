/**
 * Board 06 J3yxNC + board 37 "Home & gaps": the browser Home over the IndexedDB library. One
 * section at a time (rules xKrpy): Recents, All files, a picked folder (Chromium's File System
 * Access API, B13), Templates, Design systems or Trash (soft delete, `trashedAt`, 30 days).
 */
import type { KimoPlatform, RecentFile, WatchedFolder } from "@kimo/platform"
import { Button, FileCard, Input, Segmented } from "@kimo/ui"
import { FilePlus, FolderOpen, SwatchBook, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { RecentFilesGrid, RecentFilesHeader, useNow } from "../files"
import { createAssetStore } from "../lib/assets"
import {
  createFile,
  deleteFile,
  duplicateFile,
  editedLabel,
  exportFile,
  type FileMeta,
  framesLabel,
  importFile,
  listFiles,
  listTrashedFiles,
  loadFileStore,
  patchFile,
  pickKimoFile,
  purgeTrash,
  restoreFile,
  saveFile,
  trashFile,
} from "../lib/files"
import { Icon } from "../lib/icons"
import { useHomeCommands } from "../lib/native-menu"
import { useOpenSettings } from "../platform/runtime"
import { diskPath, type HomeSection, homeSectionPath, navigate } from "../router"
import { NoMatch, TemplatesGrid } from "./DesktopHomeView"
import { HomeComposer } from "./HomeComposer"
import {
  copyName,
  countLabel,
  daysLeft,
  failure,
  libraryInfo,
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
  TrashRow,
  TrashRowHeader,
  useHomeToasts,
} from "./parts"
import { HomeSidebar } from "./Sidebar"
import { createTemplateInBrowser, TEMPLATES, type Template } from "./templates"

const VIEWS = [
  { value: "grid", label: "Grid view", icon: <Icon name="layout-grid" size={14} /> },
  { value: "list", label: "List view", icon: <Icon name="list" size={14} /> },
] as const

/** Recents shows the most recently edited files (the library has no open history). */
const RECENTS_LIMIT = 50

/**
 * Design systems (B4): for each browser-library file a snapshot was linked from (its recorded
 * `sourceId`), the ids of the files that import it. Snapshots without a known origin (a file
 * picked from disk) count for nobody: the name of a library is never used to guess.
 */
export async function librarySnapshotUses(): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open("kimo-libraries", 1)
    req.onupgradeneeded = () => req.result.createObjectStore("snapshots", { keyPath: "key" })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
  if (!db) return out
  const rows = await new Promise<{ key: string; sourceId?: string }[]>((resolve) => {
    const req = db.transaction("snapshots", "readonly").objectStore("snapshots").getAll()
    req.onsuccess = () => resolve(req.result as { key: string; sourceId?: string }[])
    req.onerror = () => resolve([])
  })
  db.close()
  for (const r of rows) {
    const fileId = r.key.split("\u0000")[0] ?? ""
    if (!r.sourceId || !fileId || r.sourceId === fileId) continue
    const set = out.get(r.sourceId) ?? new Set<string>()
    out.set(r.sourceId, set)
    set.add(fileId)
  }
  return out
}

export function WebHomeView({
  platform,
  section,
}: {
  platform: KimoPlatform
  section: HomeSection
}) {
  const openSettings = useOpenSettings()
  const now = useNow()
  const [files, setFiles] = useState<FileMeta[] | null>(null)
  const [trashed, setTrashed] = useState<FileMeta[] | null>(null)
  const [uses, setUses] = useState<Map<string, Set<string>>>(new Map())
  const [folders, setFolders] = useState<WatchedFolder[] | null>(null)
  const [folderFiles, setFolderFiles] = useState<RecentFile[] | null>(null)
  const [query, setQuery] = useState("")
  const [view, setView] = useState<"grid" | "list">("grid")
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ file: FileMeta; at: MenuAt } | null>(null)
  const [folderMenu, setFolderMenu] = useState<{ folder: WatchedFolder; at: MenuAt } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const { toasts, show, dismiss } = useHomeToasts()
  const fail = useCallback(
    (text: string, kind = "error") => show({ tone: "danger", text, kind }),
    [show],
  )
  const folderApi = platform.capabilities.watchedFolders

  const reload = useCallback(async () => {
    const [f, t] = await Promise.all([listFiles(), listTrashedFiles()])
    setFiles(f)
    setTrashed(t)
    setUses(await librarySnapshotUses().catch(() => new Map()))
  }, [])
  useEffect(() => {
    let live = true
    // Rules "Trash · web": files trashed more than 30 days ago are deleted when Home loads.
    purgeTrash()
      .catch(() => 0)
      .then(() => reload())
      .catch((e: unknown) => live && setError(failure("list your files", e)))
    return () => {
      live = false
    }
  }, [reload])
  useEffect(() => {
    if (!folderApi) return
    let live = true
    const load = () =>
      void platform.recents
        .listFolders()
        .then((d) => live && setFolders(d))
        .catch((e: unknown) => live && setError(failure("list your folders", e)))
    load()
    const off = platform.recents.onChange(load)
    return () => {
      live = false
      off()
    }
  }, [platform, folderApi])

  const sectionKey = homeSectionPath(section)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on section change only
  useEffect(() => {
    setQuery("")
    setMenu(null)
    setRenaming(null)
  }, [sectionKey])

  const folder = section.kind === "folder" && folders ? resolveFolder(section.ref, folders) : null
  useEffect(() => {
    if (section.kind === "folder" && folders && !folder) navigate("/all")
  }, [section, folders, folder])
  useEffect(() => {
    if (!folder) return setFolderFiles(null)
    let live = true
    platform.recents
      .scanFolder(folder.ref)
      .then((f) => live && setFolderFiles(f))
      .catch((e: unknown) => live && setError(failure(`list ${folder.label}`, e)))
    return () => {
      live = false
    }
  }, [platform, folder])

  const newFile = useCallback(async () => {
    try {
      navigate(`/file/${await createFile("Untitled")}`)
    } catch (e) {
      fail(failure("create a file", e))
    }
  }, [fail])
  const openFile = useCallback(async () => {
    const file = await pickKimoFile()
    if (!file) return
    try {
      navigate(`/file/${(await importFile(file)).id}`)
    } catch (e) {
      fail(failure(`open ${file.name}`, e))
    }
  }, [fail])
  // B9: ⌘N / ⌘O and the desktop menu bar's File › New file / Open….
  useHomeCommands(platform, { newFile: () => void newFile(), openFile: () => void openFile() })

  // --- file actions (board 37 FgXgs) ---
  const act = async (label: string, run: () => Promise<void>) => {
    try {
      await run()
    } catch (e) {
      fail(failure(label, e))
    } finally {
      await reload().catch(() => {})
    }
  }
  const moveToTrash = (f: FileMeta) =>
    act(`move “${f.name}” to the Trash`, async () => {
      await trashFile(f.id)
      show({
        tone: "success",
        kind: "trashed",
        text: `Moved “${f.name}” to the Trash`,
        action: {
          label: "Undo",
          run: () => void act(`restore “${f.name}”`, () => restoreFile(f.id)),
        },
      })
    })
  const download = (f: FileMeta) =>
    act(`download “${f.name}”`, async () => {
      const store = await loadFileStore(f.id)
      const assets = createAssetStore(f.id)
      try {
        await saveFile(
          await exportFile(
            store,
            f.name,
            assets,
            (d) => d,
            platform.settings.get("fonts.embedInKimoz"),
          ),
        )
      } finally {
        assets.dispose()
        store.destroy()
      }
    })
  const menuItems = (f: FileMeta): FileMenuEntry[] => [
    { id: "open", label: "Open", icon: MENU_ICONS.open, run: () => navigate(`/file/${f.id}`) },
    { id: "rename", label: "Rename", icon: MENU_ICONS.rename, run: () => setRenaming(f.id) },
    {
      id: "duplicate",
      label: "Duplicate",
      icon: MENU_ICONS.duplicate,
      run: () =>
        void act(`duplicate “${f.name}”`, async () => {
          const names = new Set((files ?? []).map((x) => x.name))
          await duplicateFile(
            f.id,
            copyName(f.name, (n) => names.has(n)),
          )
        }),
    },
    {
      id: "download",
      label: "Download .kimo",
      icon: MENU_ICONS.download,
      run: () => void download(f),
    },
    "divider",
    {
      id: "trash",
      label: "Move to Trash",
      icon: MENU_ICONS.trash,
      danger: true,
      run: () => void moveToTrash(f),
    },
  ]
  const onMenu = (f: FileMeta, at: MenuAt) => setMenu({ file: f, at })

  // --- templates ---
  const applyTemplate = async (t: Template) => {
    setBusy(t.dir)
    try {
      navigate(`/file/${(await createTemplateInBrowser(t)).id}`)
    } catch (e) {
      fail(failure(`create “${t.name}”`, e), "template")
    } finally {
      setBusy(null)
    }
  }

  // --- render ---
  const all = files ?? []
  const libraries = useMemo(
    () =>
      all
        .map((f) => ({
          f,
          // Counted by the recorded source id; null (component count only) when unknown.
          usedBy: uses.get(f.id)?.size ?? null,
        }))
        .filter(({ f, usedBy }) => f.library || (f.components ?? 0) > 0 || (usedBy ?? 0) > 0),
    [all, uses],
  )
  const title =
    section.kind === "folder" ? (folder?.label ?? "Folder") : SECTION_TITLE[section.kind]
  const placeholder =
    section.kind === "templates"
      ? "Search templates"
      : section.kind === "libraries"
        ? "Search design systems"
        : section.kind === "trash"
          ? "Search trash"
          : "Search files"
  const list = section.kind === "recents" ? all.slice(0, RECENTS_LIMIT) : all
  const shown = searchFiles(list, query)

  const cards = (items: readonly FileMeta[], info: (f: FileMeta) => string) =>
    view === "grid" ? (
      <FileGrid
        files={items}
        info={info}
        renaming={renaming}
        menuId={menu?.file.id ?? null}
        onRename={(f, next) => {
          setRenaming(null)
          void act(`rename “${f.name}”`, () => patchFile(f.id, { name: next }))
        }}
        onCancelRename={() => setRenaming(null)}
        onMenu={onMenu}
      />
    ) : (
      <ul className="home-list" data-testid="file-list">
        {items.map((f) => (
          <li key={f.id}>
            {renaming === f.id ? (
              <div className="home-list__item home-list__item--renaming" data-file-id={f.id}>
                <RenameField
                  name={f.name}
                  onCommit={(next) => {
                    setRenaming(null)
                    void act(`rename “${f.name}”`, () => patchFile(f.id, { name: next }))
                  }}
                  onCancel={() => setRenaming(null)}
                />
                <span className="home-list__info">{info(f)}</span>
              </div>
            ) : (
              <button
                type="button"
                className="home-list__item"
                data-file-id={f.id}
                onClick={() => navigate(`/file/${f.id}`)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onMenu(f, menuAtCursor(e))
                }}
              >
                <span className="home-list__name">{f.name}</span>
                <span className="home-list__info">{info(f)}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    )
  const filesInfo = (f: FileMeta) => `${editedLabel(f.updatedAt)} · ${framesLabel(f.frames)}`
  const viewToggle = <Segmented label="View" options={VIEWS} value={view} onChange={setView} />

  let body: React.ReactNode
  if (section.kind === "templates") {
    body = (
      <TemplatesGrid
        templates={searchFiles(TEMPLATES, query)}
        busy={busy}
        onUse={(t) => void applyTemplate(t)}
      />
    )
  } else if (section.kind === "trash") {
    const t = searchFiles(trashed ?? [], query)
    body = (
      <>
        <div className="kimo-files-recent-header">
          <h2 className="kimo-files-recent-header__title">{countLabel(trashed?.length ?? 0)}</h2>
          <span className="kimo-files-recent-header__note">
            Deleted files stay here for 30 days
          </span>
          <span className="kimo-files-recent-header__spacer" aria-hidden="true" />
        </div>
        {trashed && trashed.length === 0 ? (
          <HomeEmpty
            kind="trash"
            icon={<Trash2 />}
            title="Trash is empty"
            description="Files you delete show up here for 30 days."
          />
        ) : trashed && t.length === 0 ? (
          <NoMatch query={query} onClear={() => setQuery("")} />
        ) : (
          <div className="home-trash-list">
            <TrashRowHeader locationLabel="DELETED FOR GOOD IN" />
            {t.map((f) => (
              <TrashRow
                key={f.id}
                name={f.name}
                location={daysLeft(f.trashedAt ?? now, now)}
                locationSans
                deleted={editedLabel(f.trashedAt ?? now).replace(/^Edited /, "")}
                busy={false}
                onRestore={() =>
                  void act(`restore “${f.name}”`, async () => {
                    await restoreFile(f.id)
                    show({ tone: "success", kind: "restored", text: `Restored “${f.name}”` })
                  })
                }
                onDelete={() =>
                  setConfirm({
                    title: `Delete “${f.name}” forever?`,
                    description: "You can't restore it after this.",
                    confirmLabel: "Delete forever",
                    failTitle: `Couldn't delete “${f.name}”`,
                    run: async () => {
                      await deleteFile(f.id)
                      await reload()
                    },
                  })
                }
              />
            ))}
          </div>
        )}
      </>
    )
  } else if (section.kind === "libraries") {
    const libShown = searchFiles(
      libraries.map((l) => l.f),
      query,
    )
    body = (
      <>
        <div className="home-files-header">
          <h2 className="home-files-header__title">
            {countLabel(libraries.length, "library", "libraries")}
          </h2>
          <span className="home-files-header__note">
            files that other files import, or that publish components
          </span>
          <span className="home-files-header__spacer" />
          {viewToggle}
        </div>
        {files && libraries.length === 0 ? (
          <HomeEmpty
            kind="libraries"
            icon={<SwatchBook />}
            title="No design systems yet"
            description="A file shows up here when another file imports it or it publishes components."
          />
        ) : files && libShown.length === 0 ? (
          <NoMatch query={query} onClear={() => setQuery("")} />
        ) : (
          cards(libShown, (f) =>
            libraryInfo({
              components: f.components ?? 0,
              usedBy: libraries.find((l) => l.f.id === f.id)?.usedBy ?? null,
            }),
          )
        )}
      </>
    )
  } else if (section.kind === "folder") {
    const ff = searchFiles(folderFiles ?? [], query)
    body = (
      <>
        <RecentFilesHeader
          folderCount={folders?.length ?? 0}
          title={countLabel(folderFiles?.length ?? 0)}
          note="in this folder and its subfolders · sorted by modified"
        />
        {folderFiles && folderFiles.length === 0 && folder ? (
          <HomeEmpty
            kind="folder"
            icon={<FolderOpen />}
            title={`No .kimo files in ${folder.label}`}
            description="Files you save in this folder or its subfolders show up here."
          />
        ) : folderFiles && ff.length === 0 ? (
          <NoMatch query={query} onClear={() => setQuery("")} />
        ) : (
          <RecentFilesGrid
            files={ff}
            folders={folders ?? []}
            now={now}
            onOpen={(f) => navigate(diskPath(f.ref))}
          />
        )}
      </>
    )
  } else {
    body = (
      <>
        {section.kind === "recents" && <HomeComposer platform={platform} />}
        <div className="home-files-header">
          <h2 className="home-files-header__title">
            {section.kind === "recents" ? "Recent files" : countLabel(all.length)}
          </h2>
          {section.kind === "all" && (
            <span className="home-files-header__note">in this browser · sorted by modified</span>
          )}
          <span className="home-files-header__spacer" />
          {viewToggle}
        </div>
        {files !== null && all.length === 0 ? (
          <HomeEmpty
            kind="no-files"
            icon={<FilePlus />}
            title="No files yet"
            description="Create a file or open a .kimo file from your computer. Files stay in this browser."
            actions={[
              { label: "New file", variant: "primary", onClick: () => void newFile() },
              {
                label: "Open…",
                variant: "secondary",
                icon: <FolderOpen />,
                onClick: () => void openFile(),
              },
            ]}
          />
        ) : files !== null && shown.length === 0 ? (
          <NoMatch query={query} onClear={() => setQuery("")} />
        ) : (
          cards(shown, filesInfo)
        )}
      </>
    )
  }

  return (
    <div className="home">
      <HomeSidebar
        platform={platform}
        desktop={false}
        section={section}
        allCount={files ? files.length : null}
        libraryCount={files ? libraries.length : null}
        folders={
          folderApi
            ? {
                list: folders ?? [],
                activeRef: folder?.ref ?? null,
                menuRef: folderMenu?.folder.ref ?? null,
                onAdd: () =>
                  void (async () => {
                    const ref = await platform.dialogs.pickFolder({ title: "Add folder" })
                    if (ref) await platform.recents.addFolder(ref)
                  })().catch((e: unknown) => fail(failure("add the folder", e))),
                onOpen: (f) => navigate(homeSectionPath({ kind: "folder", ref: f.ref })),
                onMenu: (f, from) =>
                  setFolderMenu({
                    folder: f,
                    at: "button" in from ? menuFromButton(from.button) : menuAtCursor(from.event),
                  }),
              }
            : null
        }
        onOpenSettings={() => openSettings("general")}
      />

      <main className="home-main" data-section={section.kind}>
        <header className="home-header" data-tauri-drag-region="">
          <h1 className="home-header__title" data-tauri-drag-region="">
            {title}
          </h1>
          <span className="home-header__spacer" data-tauri-drag-region="" />
          <Input
            icon={<Icon name="search" size={16} />}
            type="search"
            placeholder={placeholder}
            aria-label={placeholder}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            frameProps={{ className: "home-header__search" }}
          />
          {section.kind === "trash" ? (
            <Button
              variant="secondary"
              icon={<Trash2 size={16} />}
              disabled={!trashed?.length}
              onClick={() =>
                setConfirm({
                  title: "Empty the Trash?",
                  description: `Kimo deletes the ${countLabel(trashed?.length ?? 0)} in the Trash. You can't restore them after this.`,
                  confirmLabel: "Empty trash",
                  failTitle: "Couldn't empty the Trash",
                  run: async () => {
                    for (const f of trashed ?? []) await deleteFile(f.id)
                    await reload()
                  },
                })
              }
            >
              Empty trash…
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                icon={<Icon name="folder-open" size={16} />}
                onClick={() => void openFile()}
              >
                Open file
              </Button>
              <Button
                variant="primary"
                icon={<Icon name="plus" size={16} />}
                onClick={() => void newFile()}
              >
                New file
              </Button>
            </>
          )}
        </header>

        {error && (
          <p className="home-error" role="alert">
            {error}
          </p>
        )}
        {body}
      </main>

      {menu && (
        <HomeMenu
          at={menu.at}
          width={200}
          label={`${menu.file.name} actions`}
          items={menuItems(menu.file)}
          onClose={() => setMenu(null)}
        />
      )}
      {folderMenu && (
        <HomeMenu
          at={folderMenu.at}
          width={200}
          label={`${folderMenu.folder.label} actions`}
          items={[
            {
              id: "remove-folder",
              label: "Remove from Kimo",
              icon: MENU_ICONS.removeFolder,
              run: () =>
                void platform.recents.removeFolder(folderMenu.folder.ref).then(
                  () => folder?.ref === folderMenu.folder.ref && navigate("/all"),
                  (e: unknown) => fail(failure(`remove ${folderMenu.folder.label}`, e)),
                ),
            },
          ]}
          onClose={() => setFolderMenu(null)}
        />
      )}
      <DangerConfirm state={confirm} onClose={() => setConfirm(null)} />
      <HomeToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

/** Board 06 grid (DVL3B): rows of four FileCards, gap 24 / 20; right-click opens the menu. */
function FileGrid({
  files,
  info,
  renaming,
  menuId,
  onRename,
  onCancelRename,
  onMenu,
}: {
  files: readonly FileMeta[]
  info: (f: FileMeta) => string
  renaming: string | null
  menuId: string | null
  onRename: (f: FileMeta, next: string) => void
  onCancelRename: () => void
  onMenu: (f: FileMeta, at: MenuAt) => void
}) {
  const rows: FileMeta[][] = []
  for (let i = 0; i < files.length; i += 4) rows.push(files.slice(i, i + 4))
  return (
    <div className="home-grid" data-testid="file-grid">
      {rows.map((row) => (
        <div key={row[0]?.id} className="home-grid__row">
          {row.map((f) =>
            renaming === f.id ? (
              <div key={f.id} className="kimo-file-card home-grid__card home-grid__card--renaming">
                <span className="kimo-file-card__thumbnail" aria-hidden="true" />
                <span className="kimo-file-card__meta">
                  <RenameField
                    name={f.name}
                    onCommit={(next) => onRename(f, next)}
                    onCancel={onCancelRename}
                  />
                </span>
              </div>
            ) : (
              <FileCard
                key={f.id}
                data-file-id={f.id}
                className={`home-grid__card${menuId === f.id ? " kimo-files-grid__card--menu" : ""}`}
                name={f.name}
                info={info(f)}
                onClick={() => navigate(`/file/${f.id}`)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onMenu(f, menuAtCursor(e))
                }}
              />
            ),
          )}
          {Array.from({ length: 4 - row.length }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static fillers keep the 4-column rhythm
            <span key={i} className="home-grid__filler" aria-hidden="true" />
          ))}
        </div>
      ))}
    </div>
  )
}
