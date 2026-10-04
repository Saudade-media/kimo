/**
 * Export dialog — board 07 "Export Dialog" (`AsO2h`): Scrim (`WWuf4`) › Dialog (`m2Oi5`, 880,
 * bg-app, radius-2xl, clip, shadows 0 2 6 $shadow + 0 24 64 $shadow-strong):
 *   Header (`r6NKt7`) Titles + Close · Body (`xu5Kq`) Options (Format / Settings / Path) +
 *   Preview (File Tabs + Code) · Footer (`zeI7q`) info note, Copy code, Export N files.
 *
 * Files come from `@kimo/exporters` (ADR 0015). Desktop writes them into the output folder
 * through the platform, diffing against what is there: identical files are skipped and changed
 * files are never overwritten silently (they are left untouched and reported). The browser
 * downloads a zip.
 */

import { dirnameOf, type FileRef, type KimoPlatform } from "@kimo/platform"
import { Button, IconButton, Tab, Toggle, useFocusTrap } from "@kimo/ui"
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { downloadBlob } from "../lib/files"
import { Icon } from "../lib/icons"
import "./export.css"
import { type ExportSource, type GeneratedExport, generateExport } from "./generate"
import {
  codeLines,
  DEFAULT_TOGGLES,
  describeExport,
  EXPORT_FORMATS,
  type ExportFormat,
  type ExportToggles,
  exportLabel,
  folderDisplay,
  footerNote,
  langOf,
  lineNumber,
  planWrite,
  tokenizeLine,
  type WriteResult,
  writePlan,
  zipFiles,
  zipNameOf,
} from "./model"

/** What an export did (for the host's toast). */
export type ExportOutcome =
  | ({ kind: "folder" } & WriteResult)
  | { kind: "zip"; name: string; files: number }

export interface ExportDialogProps {
  platform: Pick<KimoPlatform, "kind" | "files" | "dialogs">
  source: ExportSource
  /** Desktop: the open `.kimo` (default output folder = its directory; remembered per file). */
  fileRef?: FileRef | null
  onClose(): void
  /** After a successful export (the dialog closes itself). */
  onExported?(outcome: ExportOutcome): void
  /** Clipboard writer (default `navigator.clipboard.writeText`). */
  copyText?(text: string): Promise<void> | void
  /** Browser download (default `downloadBlob`). */
  download?(blob: Blob, name: string): void
}

const STORE = "kimo.export"
function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${STORE}.${key}`)
    return raw === null ? fallback : { ...fallback, ...(JSON.parse(raw) as object) }
  } catch {
    return fallback
  }
}
function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(`${STORE}.${key}`, JSON.stringify(value))
  } catch {}
}

const KIND_CLASS = {
  plain: "export-token",
  keyword: "export-token export-token--keyword",
  attr: "export-token export-token--attr",
  string: "export-token export-token--string",
} as const

export function ExportDialog({
  platform,
  source,
  fileRef = null,
  onClose,
  onExported,
  copyText = (t) => navigator.clipboard?.writeText(t),
  download = downloadBlob,
}: ExportDialogProps) {
  const desktop = platform.kind === "desktop"
  const [format, setFormat] = useState<ExportFormat>(
    () => readStore<{ format: ExportFormat }>("prefs", { format: "react" }).format,
  )
  const [toggles, setToggles] = useState<ExportToggles>(() =>
    readStore<ExportToggles>("toggles", DEFAULT_TOGGLES),
  )
  const [folder, setFolder] = useState<FileRef | null>(() => {
    if (!fileRef) return null
    return readStore<{ folder: FileRef | null }>(`folder.${fileRef}`, {
      folder: dirnameOf(fileRef),
    }).folder
  })
  const [generated, setGenerated] = useState<GeneratedExport | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => writeStore("prefs", { format }), [format])
  useEffect(() => writeStore("toggles", toggles), [toggles])

  // Regenerate the preview when the format or an option changes (the latest run wins).
  useEffect(() => {
    let live = true
    void generateExport(source, format, toggles).then((g) => {
      if (live) setGenerated(g)
    })
    return () => {
      live = false
    }
  }, [source, format, toggles])

  const files = generated?.files ?? []
  const current = files.find((f) => f.path === active) ?? files[0] ?? null
  const text =
    current && typeof current.contents === "string"
      ? current.contents
      : (generated?.errors.join("\n") ?? "")
  const lines = useMemo(() => {
    const all = codeLines(text)
    const lang = current ? langOf(current.path) : "text"
    return all.map((l, i) => ({
      n: lineNumber(i + 1, all.length),
      tokens: tokenizeLine(l, lang),
    }))
  }, [text, current])

  const count = generated?.count ?? 0
  const zipName = zipNameOf(source.fileName)
  const summary = generated?.summary
  const shown = folderDisplay(folder)

  const root = useRef<HTMLDivElement>(null)
  const trap = useFocusTrap(root, "root")

  const copy = () => {
    if (text) void copyText(text)
  }

  const pickFolder = async (): Promise<FileRef | null> => {
    const picked = await platform.dialogs
      .pickFolder({ title: "Output folder", ...(folder ? { defaultDir: folder } : {}) })
      .catch(() => null)
    if (picked) {
      setFolder(picked)
      if (fileRef) writeStore(`folder.${fileRef}`, { folder: picked })
    }
    return picked
  }

  const runExport = async () => {
    if (busy) return
    setBusy(true)
    try {
      const target = desktop ? (folder ?? (await pickFolder())) : null
      if (desktop && !target) return
      const full = await generateExport(source, format, toggles, { binary: true })
      const all = [...full.files, ...full.binary]
      if (desktop && target) {
        const plan = await planWrite(all, target, platform)
        const result = await writePlan(plan, target, platform)
        onExported?.({ kind: "folder", ...result })
      } else {
        const bytes = zipFiles(all)
        download(new Blob([bytes.buffer as ArrayBuffer], { type: "application/zip" }), zipName)
        onExported?.({ kind: "zip", name: zipName, files: all.length })
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = files.length
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % n
        : e.key === "ArrowLeft"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1
    const f = files[next]
    if (!f) return
    e.preventDefault()
    setActive(f.path)
    const tabs = e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')
    tabs?.[next]?.focus()
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim dismisses on outside press / Escape
    <div
      className="export-scrim"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div
        ref={root}
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        tabIndex={-1}
        onKeyDown={trap}
      >
        <div className="export-header">
          <div className="export-titles">
            <h2 id="export-title" className="export-title">
              Export to code
            </h2>
            <p className="export-desc">
              {summary
                ? describeExport(summary.name, summary)
                : describeExport(source.fileName, { frames: 0, layers: 0, variables: 0 })}
            </p>
          </div>
          <IconButton
            className="export-close"
            label="Close"
            icon={<Icon name="x" size={16} />}
            onClick={onClose}
          />
        </div>
        <div className="export-body">
          <div className="export-options">
            <div
              className="export-group export-group--format"
              role="radiogroup"
              aria-label="Format"
            >
              <span className="export-label">Format</span>
              {EXPORT_FORMATS.map((f) => {
                const on = f.id === format
                return (
                  // biome-ignore lint/a11y/useSemanticElements: a designed row (icon, title, sub, check), not a native radio
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-format={f.id}
                    className={on ? "export-format export-format--on" : "export-format"}
                    onClick={() => setFormat(f.id)}
                  >
                    <span className="export-format__icon-wrap">
                      <Icon name={f.icon} size={16} />
                    </span>
                    <span className="export-format__text">
                      <span className="export-format__title">{f.title}</span>
                      <span className="export-format__sub">{f.sub}</span>
                    </span>
                    {on && (
                      <span className="export-format__check">
                        <Icon name="check" size={16} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <div className="export-group export-group--settings">
              <span className="export-label">Options</span>
              {(
                [
                  ["variables", "Variables as CSS custom properties"],
                  ["components", "Split instances into components"],
                  ["layerNames", "Keep layer names as data attributes"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="export-toggle-row" data-option={key}>
                  <span className="export-toggle-row__label" id={`export-opt-${key}`}>
                    {label}
                  </span>
                  <Toggle
                    checked={toggles[key]}
                    aria-labelledby={`export-opt-${key}`}
                    onChange={(v) => setToggles((t) => ({ ...t, [key]: v }))}
                  />
                </div>
              ))}
            </div>
            {desktop && (
              <div className="export-group export-group--path">
                <span className="export-label">Output folder</span>
                <button
                  type="button"
                  className="export-folder"
                  title={folder ?? undefined}
                  onClick={() => void pickFolder()}
                >
                  <span className="export-folder__prefix">{shown.prefix}</span>
                  <span className="export-folder__value">{shown.value}</span>
                </button>
              </div>
            )}
          </div>
          <div className="export-preview">
            <div className="export-tabs" role="tablist" aria-label="Files">
              {files.map((f, i) => (
                <Tab
                  key={f.path}
                  className="export-tab"
                  active={f === current}
                  data-path={f.path}
                  onClick={() => setActive(f.path)}
                  onKeyDown={(e) => onTabKey(e, i)}
                >
                  {f.path}
                </Tab>
              ))}
              <span className="export-tabs__spacer" />
              <IconButton
                className="export-copy"
                label="Copy file"
                icon={<Icon name="copy" size={16} />}
                onClick={copy}
              />
            </div>
            <div className="export-code" role="tabpanel" aria-label={current?.path ?? "Code"}>
              {lines.map((l, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
                <div key={i} className="export-line">
                  <span className="export-token export-token--line">{l.n}</span>
                  {l.tokens.map((t, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
                    <span key={j} className={KIND_CLASS[t.kind]}>
                      {t.text}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="export-footer">
          <span className="export-footer__icon">
            <Icon name="info" size={14} />
          </span>
          <span className="export-footer__note">{footerNote(count, desktop, zipName)}</span>
          <span className="export-footer__spacer" />
          <Button variant="secondary" icon={<Icon name="clipboard" size={16} />} onClick={copy}>
            Copy code
          </Button>
          <Button
            variant="primary"
            className="export-submit"
            icon={<Icon name="download" size={16} />}
            disabled={busy || count === 0}
            onClick={() => void runExport()}
          >
            {exportLabel(count)}
          </Button>
        </div>
      </div>
    </div>
  )
}
