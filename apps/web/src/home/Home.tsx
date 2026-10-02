/**
 * Home — board "06 Home" (J3yxNC): Sidebar (248, vertical, gap 4, padding [16, 12]) and Main
 * (fill, vertical, gap 28, padding [28, 40]): Header, "Start With AI" card, Files Header, Grid
 * (vertical gap 24 of rows of four FileCards, gap 20). Files come from the IndexedDB index.
 */
import { Button, Composer, FileCard, Input, Segmented, Tooltip } from "@kimo/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
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
import { navigate } from "../router"

const CHIPS = [
  { label: "Landing page", icon: "monitor" },
  { label: "Mobile app", icon: "smartphone" },
  { label: "Dashboard", icon: "layout-dashboard" },
  { label: "Design system", icon: "swatch-book" },
  { label: "Slides", icon: "presentation" },
] as const

const VIEWS = [
  { value: "grid", label: "Grid view", icon: <Icon name="layout-grid" size={14} /> },
  { value: "list", label: "List view", icon: <Icon name="list" size={14} /> },
] as const

const AGENT_SOON = "Agent arrives in M6"

export function Home() {
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
          <span className="home-sidebar__logo">
            <span className="home-sidebar__mark">k</span>
          </span>
          <span className="home-sidebar__wordmark">Kimo</span>
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
        <span className="home-nav home-nav--static">
          <span className="home-nav__icon">
            <Icon name="settings" size={16} />
          </span>
          <span className="home-nav__label">Settings</span>
        </span>
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

        <section className="home-ai" aria-labelledby="home-ai-title">
          <div className="home-ai__heading">
            <h2 id="home-ai-title" className="home-ai__title">
              What are we designing today?
            </h2>
            <p className="home-ai__desc">
              Describe it and the agent drafts it on a new canvas — every change is a reviewable
              diff.
            </p>
          </div>
          <Tooltip label={AGENT_SOON} side="top" delay={150}>
            <Composer
              className="home-ai__composer"
              placeholder="A pricing page for a calm budgeting app, three tiers, soft greens…"
              model="Claude Sonnet 5.5"
              context={null}
              disabled
              title={AGENT_SOON}
            />
          </Tooltip>
          <div className="home-ai__chips">
            {CHIPS.map((c) => (
              <button key={c.label} type="button" className="home-chip" disabled title={AGENT_SOON}>
                <span className="home-chip__icon">
                  <Icon name={c.icon} size={14} />
                </span>
                <span className="home-chip__label">{c.label}</span>
              </button>
            ))}
          </div>
        </section>

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
