import { KIMO_FILE_FILTER, type KimoPlatform } from "@kimo/platform"
import { Button, FileCard, Input, KimoLockup, Segmented } from "@kimo/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  addWatchedFolder,
  LocalFolders,
  RecentFilesGrid,
  RecentFilesHeader,
  RecentFilesList,
  type RecentView,
  TrafficLightInset,
  useNow,
  useRecents,
} from "../files"
import {
  createFile,
  editedLabel,
  type FileMeta,
  framesLabel,
  importFile,
  listFiles,
  pickKimoFile,
} from "../lib/files"
import { Icon } from "../lib/icons"
import { useOpenSettings, useRuntime } from "../platform/runtime"
import { diskPath, navigate } from "../router"
import { HomeComposer } from "./HomeComposer"

const VIEWS = [
  { value: "grid", label: "Grid view", icon: <Icon name="layout-grid" size={14} /> },
  { value: "list", label: "List view", icon: <Icon name="list" size={14} /> },
] as const

export function Home() {
  const { platform } = useRuntime()
  // Board 06 in the browser; board 16's desktop Home on the desktop host (and the memory host
  // that stands in for it in tests).
  return platform.kind === "browser" ? <WebHome /> : <DesktopHome platform={platform} />
}

function WebHome() {
  const { platform } = useRuntime()
  const openSettings = useOpenSettings()
  const [files, setFiles] = useState<FileMeta[] | null>(null)
  const [query, setQuery] = useState("")
  const [view, setView] = useState<"grid" | "list">("grid")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    listFiles()
      .then((f) => live && setFiles(f))
      .catch((e) => live && setError(String(e)))
    return () => {
      live = false
    }
  }, [])

  const newFile = useCallback(async () => {
    try {
      navigate(`/file/${await createFile("Untitled")}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  const openFile = useCallback(async () => {
    const file = await pickKimoFile()
    if (!file) return
    try {
      navigate(`/file/${(await importFile(file)).id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (files ?? []).filter((f) => !q || f.name.toLowerCase().includes(q))
  }, [files, query])
  const rows: FileMeta[][] = []
  for (let i = 0; i < shown.length; i += 4) rows.push(shown.slice(i, i + 4))

  return (
    <div className="home">
      <nav className="home-sidebar" aria-label="Library">
        <div className="home-sidebar__brand">
          <KimoLockup />
        </div>
        <a className="home-nav home-nav--active" href="#/" aria-current="page">
          <span className="home-nav__icon">
            <Icon name="history" size={16} />
          </span>
          <span className="home-nav__label">Recents</span>
        </a>
        <a className="home-nav" href="#/">
          <span className="home-nav__icon">
            <Icon name="folder" size={16} />
          </span>
          <span className="home-nav__label">All files</span>
          <span className="home-nav__spacer" />
          <span className="home-nav__count">{files?.length ?? ""}</span>
        </a>
        <span className="home-nav home-nav--static">
          <span className="home-nav__icon">
            <Icon name="layout-template" size={16} />
          </span>
          <span className="home-nav__label">Templates</span>
        </span>
        <a className="home-nav" href="#/gallery">
          <span className="home-nav__icon">
            <Icon name="swatch-book" size={16} />
          </span>
          <span className="home-nav__label">Design systems</span>
          <span className="home-nav__spacer" />
          {/* Count (JzWv5): the web build ships one system, Kimo's own (@kimo/ui gallery). */}
          <span className="home-nav__count">1</span>
        </a>
        <span className="home-nav home-nav--static">
          <span className="home-nav__icon">
            <Icon name="trash-2" size={16} />
          </span>
          <span className="home-nav__label">Trash</span>
        </span>
        {/* Folders Header (CttNG): text-xs 600, ls 0.6, padding [20, 10, 6, 10]. */}
        <div className="home-folders-header">
          <span className="home-folders-header__label">LOCAL FOLDERS</span>
        </div>
        {/*
          Folder rows (G9hU83 …): folder-git-2 16, label text-base secondary, 32 high. Local
          folders need the desktop folder API; until then one static row says so instead of the
          board's sample paths.
        */}
        <span className="home-nav home-nav--static" aria-disabled="true">
          <span className="home-nav__icon">
            <Icon name="folder-git-2" size={16} />
          </span>
          <span className="home-nav__label">Desktop app only</span>
        </span>
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
        <SettingsRow onOpen={() => openSettings("general")} />
      </nav>

      <main className="home-main">
        <header className="home-header">
          <h1 className="home-header__title">Recents</h1>
          <span className="home-header__spacer" />
          <Input
            icon={<Icon name="search" size={16} />}
            type="search"
            placeholder="Search files"
            aria-label="Search files"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            frameProps={{ className: "home-header__search" }}
          />
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
        </header>

        <HomeComposer platform={platform} />

        <div className="home-files-header">
          <h2 className="home-files-header__title">Recent files</h2>
          <span className="home-files-header__spacer" />
          <Segmented label="View" options={VIEWS} value={view} onChange={setView} />
        </div>

        {error && (
          <p className="home-error" role="alert">
            {error}
          </p>
        )}

        {files !== null && shown.length === 0 ? (
          <p className="home-empty">
            {query ? "No files match your search." : "No files yet. Create one to get started."}
          </p>
        ) : view === "grid" ? (
          <div className="home-grid" data-testid="file-grid">
            {rows.map((row) => (
              <div key={row[0]?.id} className="home-grid__row">
                {row.map((f) => (
                  <FileCard
                    key={f.id}
                    className="home-grid__card"
                    name={f.name}
                    info={`${editedLabel(f.updatedAt)} · ${framesLabel(f.frames)}`}
                    onClick={() => navigate(`/file/${f.id}`)}
                  />
                ))}
                {Array.from({ length: 4 - row.length }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static fillers keep the 4-column rhythm
                  <span key={i} className="home-grid__filler" aria-hidden="true" />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <ul className="home-list" data-testid="file-list">
            {shown.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="home-list__item"
                  onClick={() => navigate(`/file/${f.id}`)}
                >
                  <span className="home-list__name">{f.name}</span>
                  <span className="home-list__info">
                    {editedLabel(f.updatedAt)} · {framesLabel(f.frames)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

/** Sidebar "Settings" row (uEJzA): opens the Settings window (desktop) or dialog (web). */
function SettingsRow({ onOpen }: { onOpen(): void }) {
  return (
    <button type="button" className="home-nav home-nav--button" onClick={onOpen}>
      <span className="home-nav__icon">
        <Icon name="settings" size={16} />
      </span>
      <span className="home-nav__label">Settings</span>
    </button>
  )
}

/** Board 16 hnvDX: the desktop Home over `platform.recents` (real files on disk). */
function DesktopHome({ platform }: { platform: KimoPlatform }) {
  const openSettings = useOpenSettings()
  const { files, folders, error: recentsError } = useRecents(platform)
  const now = useNow()
  const [query, setQuery] = useState("")
  const [view, setView] = useState<RecentView>("list")
  const [error, setError] = useState<string | null>(null)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (files ?? []).filter((f) => !q || f.name.toLowerCase().includes(q))
  }, [files, query])

  const openFile = useCallback(async () => {
    try {
      const [ref] = await platform.dialogs.openFile({ title: "Open", filters: [KIMO_FILE_FILTER] })
      if (ref) navigate(diskPath(ref))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [platform])
  const { manager } = useRuntime()
  const newFile = useCallback(async () => {
    // Board 20 V7ey1Q: no dialog up front — an untitled document opens right away and asks
    // where on its first ⌘S.
    try {
      navigate(diskPath((await manager.newUntitled()).ref))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [manager])
  const message = error ?? recentsError

  return (
    <div className="home">
      <nav className="home-sidebar home-sidebar--desktop" aria-label="Library">
        <TrafficLightInset platform={platform} leading={4} />
        <div className="home-sidebar__brand">
          <KimoLockup />
        </div>
        <a className="home-nav home-nav--active" href="#/" aria-current="page">
          <span className="home-nav__icon">
            <Icon name="history" size={16} />
          </span>
          <span className="home-nav__label">Recents</span>
        </a>
        <a className="home-nav" href="#/">
          <span className="home-nav__icon">
            <Icon name="folder" size={16} />
          </span>
          <span className="home-nav__label">All files</span>
          <span className="home-nav__spacer" />
          <span className="home-nav__count">{files?.length ?? ""}</span>
        </a>
        <span className="home-nav home-nav--static">
          <span className="home-nav__icon">
            <Icon name="layout-template" size={16} />
          </span>
          <span className="home-nav__label">Templates</span>
        </span>
        <a className="home-nav" href="#/gallery">
          <span className="home-nav__icon">
            <Icon name="swatch-book" size={16} />
          </span>
          <span className="home-nav__label">Design systems</span>
          <span className="home-nav__spacer" />
          <span className="home-nav__count">1</span>
        </a>
        <span className="home-nav home-nav--static">
          <span className="home-nav__icon">
            <Icon name="trash-2" size={16} />
          </span>
          <span className="home-nav__label">Trash</span>
        </span>
        <LocalFolders
          folders={folders ?? []}
          onAdd={() => void addWatchedFolder(platform).catch(() => null)}
        />
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
        <SettingsRow onOpen={() => openSettings("general")} />
      </nav>

      <main className="home-main home-main--desktop">
        <header className="home-header">
          <h1 className="home-header__title">Recents</h1>
          <span className="home-header__spacer" />
          <Input
            icon={<Icon name="search" size={16} />}
            type="search"
            placeholder="Search files"
            aria-label="Search files"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            frameProps={{ className: "home-header__search" }}
          />
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
        </header>

        <HomeComposer platform={platform} />

        <RecentFilesHeader folderCount={folders?.length ?? 0} view={view} onViewChange={setView} />

        {message && (
          <p className="home-error" role="alert">
            {message}
          </p>
        )}

        {view === "list" ? (
          <RecentFilesList files={shown} now={now} onOpen={(f) => navigate(diskPath(f.ref))} />
        ) : (
          <RecentFilesGrid
            files={shown}
            folders={folders ?? []}
            now={now}
            onOpen={(f) => navigate(diskPath(f.ref))}
          />
        )}
      </main>
    </div>
  )
}
