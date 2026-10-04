/**
 * Export dialog — board 07 "Export Dialog" (`AsO2h`) with board 25 "v1 Polish" § 2 additions
 * (`O3Abm`, rules `JHqZL`):
 *
 *   Scrim (`WWuf4`) › Dialog (`m2Oi5`, 880, bg-app, radius-2xl, clip):
 *   - options step: Header (`r6NKt7`) · Body (`xu5Kq`: Options = Format 5 rows incl. PDF
 *     `D7dje` / Options / Path, + Preview: code, or the PNG preview `KeMal`, or the PDF page)
 *     · Footer (`zeI7q`; web `p1I8RQ`)
 *   - writing (`WnLfR`): per-file list (`MfSnB`), 4 px bar (`ZxZlz`), Cancel · Exporting…
 *   - failed (`ixYdn`): danger card (`u5xjVk`), list (`fb8Bv`), Close · Retry N files
 *   - review (`P8d2o`): Back · titles · Close / files (Keep | Overwrite) + diff / Keep all ·
 *     Overwrite all · Write N files — desktop only, when a target exists and differs.
 *
 * Files come from `@kimo/exporters` (ADR 0015). Desktop writes into the output folder (never
 * silently over a changed file); the browser downloads a zip, or the file itself when there is
 * only one.
 */

import { dirnameOf, type FileRef, type KimoPlatform } from "@kimo/platform"
import {
  Button,
  CompactButton,
  DiffLine,
  type FileStatus,
  FileStatusRow,
  IconButton,
  IconErrorCard,
  ProgressTrack,
  ReviewFileRow,
  SegmentedText,
  Select,
  Tab,
  Toggle,
  useFocusTrap,
} from "@kimo/ui"
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { downloadBlob } from "../lib/files"
import { Icon } from "../lib/icons"
import "./export.css"
import { type ExportSource, type GeneratedExport, generateExport, previewRaster } from "./generate"
import { hasIssueError, issuesLabel, issuesReport, issueTotal } from "./issues"
import {
  bytesOf,
  codeLines,
  DEFAULT_PDF_TOGGLES,
  DEFAULT_PNG_SCALE,
  DEFAULT_TAILWIND,
  DEFAULT_TOGGLES,
  defaultChoice,
  defaultZipName,
  describeExport,
  describeUntitled,
  describeWriteError,
  EXPORT_FORMATS,
  type ExportFormat,
  type ExportToggles,
  exportLabel,
  folderDisplay,
  footerNote,
  hunksLabel,
  type ImageKind,
  langOf,
  lineNumber,
  type PdfToggles,
  type PlanEntry,
  PNG_SCALES,
  type PngScale,
  pagesLabel,
  planWrite,
  pngSizeLine,
  progressLabel,
  type ReviewChoice,
  readWritten,
  recordWritten,
  retryLabel,
  reviewDesc,
  reviewSummary,
  safeFileName,
  shortFolder,
  TAILWIND_THEMES,
  type TailwindChoices,
  tokenizeLine,
  unifiedDiff,
  type WriteResult,
  writeLabel,
  zipFiles,
} from "./model"

/** What an export did (for the host's toast — see `exportToastOf`). */
export type ExportOutcome =
  | ({ kind: "folder"; cancelled?: { total: number } } & WriteResult)
  | { kind: "zip"; name: string; files: number }
  | { kind: "file"; name: string }

/** "Open export…" from the Code tab: same selection and framework (board 25 rule). */
export interface ExportPreset {
  format?: ExportFormat
  /** Node ids to export instead of the canvas selection (empty: every top-level frame). */
  ids?: readonly string[]
}

export interface ExportDialogProps {
  platform: Pick<KimoPlatform, "kind" | "files" | "dialogs">
  source: ExportSource
  /** Desktop: the open `.kimo` (default output folder = its directory; remembered per file). */
  fileRef?: FileRef | null
  /** Preselected format / nodes (Code tab "Open export…"). */
  preset?: ExportPreset | null
  onClose(): void
  /** After a successful (or cancelled) export; the dialog closes itself. */
  onExported?(outcome: ExportOutcome): void
  /** Clipboard writer (default `navigator.clipboard.writeText`). */
  copyText?(text: string): Promise<void> | void
  /** Browser download (default `downloadBlob`). */
  download?(blob: Blob, name: string): void
  /** Issues tab node chip (board 27 §10 rule AiMJh): the dialog closes, then this selects it. */
  onSelectNode?(id: string): void
}

const STORE = "kimo.export"
const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}
function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = storage()?.getItem(`${STORE}.${key}`)
    return raw == null ? fallback : { ...fallback, ...(JSON.parse(raw) as object) }
  } catch {
    return fallback
  }
}
function writeStore(key: string, value: unknown) {
  try {
    storage()?.setItem(`${STORE}.${key}`, JSON.stringify(value))
  } catch {}
}

const KIND_CLASS = {
  plain: "export-token",
  keyword: "export-token export-token--keyword",
  attr: "export-token export-token--attr",
  string: "export-token export-token--string",
} as const

interface Prefs {
  format: ExportFormat
  image: ImageKind
  scale: PngScale
}
const DEFAULT_PREFS: Prefs = { format: "react", image: "svg", scale: DEFAULT_PNG_SCALE }

type Step = "options" | "review" | "writing" | "failed"

interface Run {
  folder: FileRef
  /** Files to write, in order. */
  queue: PlanEntry[]
  status: Record<string, FileStatus>
  written: string[]
  unchanged: string[]
  kept: string[]
  error: { title: string; description: string } | null
}

interface Review {
  folder: FileRef
  plan: PlanEntry[]
  choices: Record<string, ReviewChoice>
  selected: string | null
}

const decoder = new TextDecoder()
const textOf = (c: string | Uint8Array) => (typeof c === "string" ? c : decoder.decode(c))
const IMAGE_KINDS = [
  { value: "svg", label: "SVG" },
  { value: "png", label: "PNG" },
] as const
const SCALES = PNG_SCALES.map((s) => ({ value: String(s), label: `${s}×` }))

export function ExportDialog({
  platform,
  source: hostSource,
  fileRef = null,
  preset = null,
  onClose,
  onExported,
  copyText = (t) => navigator.clipboard?.writeText(t),
  download = downloadBlob,
  onSelectNode,
}: ExportDialogProps) {
  const desktop = platform.kind === "desktop"
  const untitled = desktop && !fileRef
  const presetIds = preset?.ids
  // Code tab "Open export…": the same selection.
  const source = useMemo<ExportSource>(
    () => (presetIds ? { ...hostSource, selection: () => presetIds } : hostSource),
    [hostSource, presetIds],
  )
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = readStore<Prefs>("prefs", DEFAULT_PREFS)
    return preset?.format ? { ...p, format: preset.format } : p
  })
  const { format, image, scale } = prefs
  const setFormat = (f: ExportFormat) => setPrefs((p) => ({ ...p, format: f }))
  const [toggles, setToggles] = useState<ExportToggles>(() =>
    readStore<ExportToggles>("toggles", DEFAULT_TOGGLES),
  )
  const [pdf, setPdf] = useState<PdfToggles>(() =>
    readStore<PdfToggles>("pdf", DEFAULT_PDF_TOGGLES),
  )
  const [tailwind, setTailwind] = useState<TailwindChoices>(() =>
    readStore<TailwindChoices>("tailwind", DEFAULT_TAILWIND),
  )
  /** Board 27 §10 (c): the preview pane's Preview | Issues tabs. */
  const [pane, setPane] = useState<"preview" | "issues">("preview")
  const [folder, setFolder] = useState<FileRef | null>(() => {
    if (!fileRef) return null
    return readStore<{ folder: FileRef | null }>(`folder.${fileRef}`, {
      folder: dirnameOf(fileRef),
    }).folder
  })
  const [zipName, setZipName] = useState<string | null>(null)
  const [generated, setGenerated] = useState<GeneratedExport | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<Step>("options")
  const [run, setRun] = useState<Run | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const cancel = useRef(false)

  useEffect(() => writeStore("prefs", prefs), [prefs])
  useEffect(() => writeStore("toggles", toggles), [toggles])
  useEffect(() => writeStore("pdf", pdf), [pdf])
  useEffect(() => writeStore("tailwind", tailwind), [tailwind])

  // Regenerate the preview when the format or an option changes (the latest run wins).
  useEffect(() => {
    let live = true
    void generateExport(source, format, toggles, { image, scale, pdf, tailwind }).then((g) => {
      if (live) setGenerated(g)
    })
    return () => {
      live = false
    }
  }, [source, format, toggles, image, scale, pdf, tailwind])

  // Rule AiMJh: the Issues tab opens by itself when a dry run finds an error (once per new set).
  const issueGroups = generated?.issues ?? []
  const issueCount = issueTotal(issueGroups)
  const issueError = hasIssueError(issueGroups)
  const errorKey = issueError
    ? issueGroups
        .flatMap((g) => g.issues.filter((i) => i.level === "error").map((i) => g.file + i.message))
        .join("\n")
    : ""
  const lastErrorKey = useRef("")
  useEffect(() => {
    if (errorKey && errorKey !== lastErrorKey.current) setPane("issues")
    lastErrorKey.current = errorKey
  }, [errorKey])

  // PNG preview (rule "PNG preview") and the PDF page-1 thumbnail.
  const raster = format === "pdf" || (format === "assets" && image === "png")
  const [preview, setPreview] = useState<
    { url: string; name: string; w: number; h: number; bytes: number } | { error: string } | null
  >(null)
  const [fit, setFit] = useState(true)
  useEffect(() => {
    if (!raster) {
      setPreview(null)
      return
    }
    let live = true
    let url: string | null = null
    void previewRaster(source, format === "pdf" ? 2 : scale).then((r) => {
      if (!live) return
      if (!r) return setPreview(null)
      if ("error" in r) return setPreview(r)
      const bytes = r.file.contents as Uint8Array
      url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" }))
      setPreview({ url, name: r.file.path, w: r.w, h: r.h, bytes: bytes.byteLength })
    })
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [raster, source, format, scale])

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
  const summary = generated?.summary
  const zip = safeFileName(zipName ?? defaultZipName(summary?.name ?? source.fileName), "zip")
  const shown = folderDisplay(folder)
  const blocked = desktop && !folder
  const copyable = !!current && typeof current.contents === "string"

  const root = useRef<HTMLDivElement>(null)
  const trap = useFocusTrap(root, "root")

  const copy = () => {
    if (copyable && text) void copyText(text)
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

  // --- Desktop writing (progress, error, retry) ----------------------------------------------

  const writeQueue = async (start: Run) => {
    setStep("writing")
    cancel.current = false
    let state: Run = { ...start, status: { ...start.status }, written: [...start.written] }
    setRun(state)
    const todo = start.queue.filter((e) => state.status[e.path] !== "written")
    for (let i = 0; i < todo.length; i++) {
      const e = todo[i] as PlanEntry
      state = { ...state, status: { ...state.status, [e.path]: "writing" } }
      setRun(state)
      try {
        if (typeof e.contents === "string")
          await platform.files.writeTextAtomic(e.ref, e.contents, { mkdirs: true })
        else await platform.files.writeBytesAtomic(e.ref, e.contents, { mkdirs: true })
      } catch (err) {
        const rest = todo.slice(i + 1).map((x) => x.path)
        const status = { ...state.status, [e.path]: "failed" as const }
        for (const p of rest) status[p] = "skipped"
        recordWritten(
          state.folder,
          state.queue.filter((q) => state.written.includes(q.path)),
          storage(),
        )
        state = {
          ...state,
          status,
          error: describeWriteError(err, e.path, state.folder, state.written, rest),
        }
        setRun(state)
        setStep("failed")
        return
      }
      state = {
        ...state,
        status: { ...state.status, [e.path]: "written" },
        written: [...state.written, e.path],
      }
      setRun(state)
      if (cancel.current && i < todo.length - 1) {
        recordWritten(
          state.folder,
          state.queue.filter((q) => state.written.includes(q.path)),
          storage(),
        )
        onExported?.({
          kind: "folder",
          folder: state.folder,
          written: state.written,
          unchanged: state.unchanged,
          kept: state.kept,
          cancelled: { total: state.queue.length },
        })
        onClose()
        return
      }
    }
    recordWritten(
      state.folder,
      state.queue.filter((q) => state.written.includes(q.path)),
      storage(),
    )
    onExported?.({
      kind: "folder",
      folder: state.folder,
      written: state.written,
      unchanged: state.unchanged,
      kept: state.kept,
    })
    onClose()
  }

  const startWriting = (target: FileRef, plan: readonly PlanEntry[], overwrite: Set<string>) => {
    const queue = plan.filter(
      (e) => e.status === "new" || (e.status === "changed" && overwrite.has(e.path)),
    )
    const status: Record<string, FileStatus> = {}
    for (const e of queue) status[e.path] = "queued"
    void writeQueue({
      folder: target,
      queue,
      status,
      written: [],
      unchanged: plan.filter((e) => e.status === "same").map((e) => e.path),
      kept: plan.filter((e) => e.status === "changed" && !overwrite.has(e.path)).map((e) => e.path),
      error: null,
    })
  }

  const runExport = async () => {
    if (busy || blocked) return
    setBusy(true)
    try {
      const full = await generateExport(source, format, toggles, {
        binary: true,
        image,
        scale,
        pdf,
        tailwind,
      })
      const all = [...full.files, ...full.binary]
      if (all.length < full.count && full.errors.length > 0) {
        // Rule "Error": errors stay in the dialog — here a target could not be generated.
        setRun({
          folder: folder ?? "",
          queue: [],
          status: {},
          written: [],
          unchanged: [],
          kept: [],
          error: { title: "Couldn't generate the export", description: full.errors.join(" · ") },
        })
        setStep("failed")
        return
      }
      if (desktop && folder) {
        const plan = await planWrite(all, folder, platform)
        const changed = plan.filter((e) => e.status === "changed")
        if (changed.length > 0) {
          // Rule "Review": hand-edited files default to Keep.
          const last = readWritten(folder, storage())
          const choices: Record<string, ReviewChoice> = {}
          for (const e of changed) choices[e.path] = defaultChoice(e.existing, last[e.path])
          setReview({ folder, plan, choices, selected: changed[0]?.path ?? null })
          setStep("review")
          return
        }
        startWriting(folder, plan, new Set())
        return
      }
      if (all.length === 1 && all[0]) {
        // Rule "Web footer": a single-file export downloads the file directly.
        const f = all[0]
        const type = f.path.endsWith(".pdf")
          ? "application/pdf"
          : f.path.endsWith(".png")
            ? "image/png"
            : "text/plain"
        const bytes = bytesOf(f.contents)
        download(new Blob([bytes.buffer as ArrayBuffer], { type }), f.path)
        onExported?.({ kind: "file", name: f.path })
      } else {
        const bytes = zipFiles(all)
        download(new Blob([bytes.buffer as ArrayBuffer], { type: "application/zip" }), zip)
        onExported?.({ kind: "zip", name: zip, files: all.length })
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

  const close = () => {
    if (step === "writing") return
    onClose()
  }

  const header =
    step === "review" ? null : (
      <div className="export-header">
        <div className="export-titles">
          <h2 id="export-title" className="export-title">
            Export to code
          </h2>
          <p className="export-desc">
            {untitled
              ? describeUntitled(source.fileName, summary?.frames ?? 0)
              : summary
                ? describeExport(summary.name, summary)
                : describeExport(source.fileName, { frames: 0, layers: 0, variables: 0 })}
          </p>
        </div>
        <IconButton
          className="export-close"
          label="Close"
          icon={<Icon name="x" size={16} />}
          disabled={step === "writing"}
          onClick={close}
        />
      </div>
    )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim dismisses on outside press / Escape
    <div
      className="export-scrim"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation()
          close()
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
        data-step={step}
        onKeyDown={trap}
      >
        {header}
        {step === "options" && (
          <>
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
                {format === "react" && (
                  <div className="export-group export-group--tailwind" data-option="tailwind">
                    <span className="export-label" id="export-tailwind-label">
                      Tailwind theme
                    </span>
                    <Select
                      className="export-tailwind-select"
                      label="Tailwind theme"
                      options={TAILWIND_THEMES}
                      value={tailwind.theme}
                      disabled={!toggles.variables}
                      onChange={(v) => setTailwind((t) => ({ ...t, theme: v }))}
                    />
                    <div className="export-tailwind-map" data-option="mapTokens">
                      <span className="export-tailwind-map__label" id="export-opt-mapTokens">
                        Map variables to theme tokens
                      </span>
                      <Toggle
                        checked={tailwind.mapTokens && tailwind.theme !== "none"}
                        disabled={!toggles.variables || tailwind.theme === "none"}
                        aria-labelledby="export-opt-mapTokens"
                        onChange={(v) => setTailwind((t) => ({ ...t, mapTokens: v }))}
                      />
                    </div>
                    <span className="export-tailwind-hint">
                      Colour, spacing, radius and font variables become --color-*, --spacing-*,
                      --radius-*, --font-* tokens; classes use them (bg-surface-base) instead of
                      arbitrary values.
                    </span>
                  </div>
                )}
                <div className="export-group export-group--settings">
                  <span className="export-label">Options</span>
                  {format === "pdf"
                    ? (
                        [
                          ["embedFonts", "Embed fonts"],
                          ["bleed", "Include bleed"],
                        ] as const
                      ).map(([key, label]) => (
                        <div key={key} className="export-toggle-row" data-option={key}>
                          <span className="export-toggle-row__label" id={`export-opt-${key}`}>
                            {label}
                          </span>
                          <Toggle
                            checked={pdf[key]}
                            aria-labelledby={`export-opt-${key}`}
                            onChange={(v) => setPdf((t) => ({ ...t, [key]: v }))}
                          />
                        </div>
                      ))
                    : (
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
                {desktop && !untitled && (
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
                {untitled && (
                  <div className="export-group export-group--path export-group--untitled">
                    <span className="export-label">Output folder</span>
                    <div className="export-folder-row">
                      <div
                        className={`export-folder-field${folder ? "" : " export-folder-field--empty"}`}
                        title={folder ?? undefined}
                      >
                        <span className="export-folder-field__icon">
                          <Icon name="folder" size={14} />
                        </span>
                        <span className="export-folder-field__text">
                          {folder ? shortFolder(folder) : "No folder chosen"}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        className="export-choose"
                        icon={<Icon name="folder-open" size={14} />}
                        onClick={() => void pickFolder()}
                      >
                        Choose…
                      </Button>
                    </div>
                    <div className="export-hint">
                      <span className="export-hint__icon">
                        <Icon name="info" size={12} />
                      </span>
                      <span className="export-hint__text">
                        Untitled files have no project folder yet. Pick one here, or save the file
                        first and Kimo will suggest ./src/components next to it.
                      </span>
                    </div>
                  </div>
                )}
                {!desktop && count !== 1 && (
                  <div className="export-group export-group--path export-group--download">
                    <span className="export-label">Download as</span>
                    <label className="export-zip">
                      <span className="export-zip__prefix">zip</span>
                      <input
                        className="export-zip__value"
                        aria-label="Zip file name"
                        value={zipName ?? defaultZipName(summary?.name ?? source.fileName)}
                        spellCheck={false}
                        onChange={(e) => setZipName(e.target.value)}
                      />
                    </label>
                    <div className="export-hint">
                      <span className="export-hint__icon">
                        <Icon name="info" size={12} />
                      </span>
                      <span className="export-hint__text">
                        Browsers can't write into a folder, so the files arrive as one .zip in your
                        Downloads. Use the desktop app to export into a project.
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div
                className={`export-preview${raster ? " export-preview--raster" : ""}`}
                data-preview={format === "pdf" ? "pdf" : raster ? "png" : "code"}
                data-pane={pane}
              >
                <div className="export-pane-tabs" role="tablist" aria-label="Preview or issues">
                  <Tab
                    className="export-pane-tab"
                    active={pane === "preview"}
                    data-pane-tab="preview"
                    onClick={() => setPane("preview")}
                  >
                    Preview
                  </Tab>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={pane === "issues"}
                    tabIndex={pane === "issues" ? 0 : -1}
                    data-pane-tab="issues"
                    className={`export-issues-tab${pane === "issues" ? " export-issues-tab--active" : ""}`}
                    onClick={() => setPane("issues")}
                  >
                    <span className="export-issues-tab__label">Issues</span>
                    {issueCount > 0 && (
                      <span
                        className={`export-issues-count${issueError ? " export-issues-count--error" : ""}`}
                      >
                        {issueCount}
                      </span>
                    )}
                  </button>
                  <span className="export-tabs__spacer" />
                  {pane === "issues" && issueCount > 0 && (
                    <button
                      type="button"
                      className="export-copy-report"
                      onClick={() => void copyText(issuesReport(issueGroups))}
                    >
                      Copy report
                    </button>
                  )}
                </div>
                {pane === "issues" && (
                  <div className="export-issues" role="tabpanel" aria-label="Issues">
                    {issueGroups.map((g) => (
                      <div key={g.file} className="export-issue-file" data-file={g.file}>
                        <div className="export-issue-file__head">
                          <span className="export-issue-file__icon">
                            <Icon name="file-code" size={14} />
                          </span>
                          <span className="export-issue-file__name">{g.file}</span>
                          <span className="export-tabs__spacer" />
                          <span className="export-issue-file__count">
                            {issuesLabel(g.issues.length)}
                          </span>
                        </div>
                        {g.issues.map((i, k) => (
                          <div
                            // biome-ignore lint/suspicious/noArrayIndexKey: issues are positional
                            key={k}
                            className="export-issue"
                            data-level={i.level}
                          >
                            <span className={`export-issue__icon export-issue__icon--${i.level}`}>
                              <Icon
                                name={i.level === "error" ? "circle-x" : "triangle-alert"}
                                size={14}
                              />
                            </span>
                            <span className="export-issue__message">{i.message}</span>
                            <button
                              type="button"
                              className="export-issue__node"
                              disabled={!i.nodeId || !onSelectNode}
                              title={i.nodeId ? "Select this layer" : undefined}
                              onClick={() => {
                                if (!i.nodeId || !onSelectNode) return
                                onClose()
                                onSelectNode(i.nodeId)
                              }}
                            >
                              <span className="export-issue__node-icon">
                                <Icon name="crosshair" size={10} />
                              </span>
                              <span className="export-issue__node-path">{i.path}</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                    {issueCount === 0 && (
                      <div className="export-issues-empty">
                        No issues — nothing was approximated.
                      </div>
                    )}
                    <div className="export-issues-note">Warnings never block export.</div>
                  </div>
                )}
                {pane === "preview" && format === "assets" && (
                  <div className="export-preview-bar">
                    <SegmentedText
                      className="export-seg"
                      label="Image format"
                      options={IMAGE_KINDS}
                      value={image}
                      onChange={(v) => setPrefs((p) => ({ ...p, image: v }))}
                    />
                    {image === "png" && (
                      <SegmentedText
                        className="export-seg export-seg--scale"
                        label="Scale"
                        options={SCALES}
                        value={String(scale)}
                        onChange={(v) => setPrefs((p) => ({ ...p, scale: Number(v) as PngScale }))}
                      />
                    )}
                    <span className="export-tabs__spacer" />
                    {image === "png" && (
                      <IconButton
                        className="export-fit"
                        label={fit ? "Actual size" : "Zoom to fit"}
                        aria-pressed={fit}
                        icon={<Icon name="scan" size={14} />}
                        onClick={() => setFit((f) => !f)}
                      />
                    )}
                  </div>
                )}
                {pane === "issues" ? null : raster ? (
                  <>
                    <div className={`export-image-area${fit ? "" : " export-image-area--actual"}`}>
                      {preview && "url" in preview ? (
                        <img
                          className="export-image"
                          src={preview.url}
                          alt={`Preview of ${preview.name}`}
                          style={
                            fit ? undefined : { width: `${preview.w}px`, height: `${preview.h}px` }
                          }
                        />
                      ) : (
                        <span className="export-image-area__note">
                          {preview && "error" in preview ? preview.error : "Rendering…"}
                        </span>
                      )}
                    </div>
                    <div className="export-preview-meta">
                      <span className="export-preview-meta__file">
                        {format === "pdf"
                          ? "export.pdf"
                          : preview && "url" in preview
                            ? preview.name
                            : ""}
                      </span>
                      <span className="export-tabs__spacer" />
                      <span className="export-preview-meta__size">
                        {format === "pdf"
                          ? pagesLabel(generated?.roots.length ?? 0)
                          : preview && "url" in preview
                            ? pngSizeLine(preview.w, preview.h, scale, preview.bytes)
                            : ""}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
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
                    <div
                      className="export-code"
                      role="tabpanel"
                      aria-label={current?.path ?? "Code"}
                    >
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
                  </>
                )}
              </div>
            </div>
            {desktop ? (
              <div className="export-footer">
                <span className="export-footer__icon">
                  <Icon name="info" size={14} />
                </span>
                <span className="export-footer__note">{footerNote(count, true)}</span>
                <span className="export-footer__spacer" />
                <Button
                  variant="secondary"
                  icon={<Icon name="clipboard" size={16} />}
                  disabled={!copyable}
                  onClick={copy}
                >
                  Copy code
                </Button>
                <Button
                  variant="primary"
                  className={`export-submit${blocked ? " export-submit--blocked" : ""}`}
                  icon={<Icon name="download" size={16} />}
                  disabled={busy || count === 0 || blocked}
                  onClick={() => void runExport()}
                >
                  {exportLabel(count)}
                </Button>
              </div>
            ) : (
              <div className="export-footer export-footer--web">
                <span className="export-footer__note">{footerNote(count, false)}</span>
                <span className="export-footer__spacer" />
                <CompactButton
                  variant="secondary"
                  height={28}
                  padX={12}
                  icon={<Icon name="clipboard" size={14} />}
                  disabled={!copyable}
                  onClick={copy}
                >
                  Copy code
                </CompactButton>
                <CompactButton
                  variant="primary"
                  height={28}
                  padX={12}
                  className="export-submit"
                  icon={<Icon name="download" size={14} />}
                  disabled={busy || count === 0}
                  onClick={() => void runExport()}
                >
                  {count === 1
                    ? `Download .${(files[0]?.path ?? (format === "pdf" ? "x.pdf" : "x.png")).split(".").pop()}`
                    : "Download .zip"}
                </CompactButton>
              </div>
            )}
          </>
        )}
        {(step === "writing" || step === "failed") && run && (
          <>
            <div className="export-run">
              {step === "failed" && run.error && (
                <IconErrorCard
                  className="export-error"
                  icon={<Icon name="folder-x" size={14} />}
                  title={run.error.title}
                  description={run.error.description}
                  actions={[
                    {
                      id: "choose_folder",
                      label: "Choose folder…",
                      icon: <Icon name="folder-open" size={14} />,
                      onClick: () =>
                        void pickFolder().then((f) => {
                          if (f) {
                            setRun(null)
                            setStep("options")
                          }
                        }),
                    },
                    {
                      id: "copy_error",
                      label: "Copy error",
                      icon: <Icon name="copy" size={14} />,
                      onClick: () => {
                        if (run.error) void copyText(`${run.error.title}\n${run.error.description}`)
                      },
                    },
                  ]}
                />
              )}
              <div className="export-run__list">
                {run.queue.map((e) => (
                  <FileStatusRow
                    key={e.path}
                    name={e.path}
                    status={run.status[e.path] ?? "queued"}
                  />
                ))}
              </div>
              {step === "writing" && (
                <ProgressTrack
                  value={run.queue.length ? run.written.length / run.queue.length : 1}
                  label={progressLabel(
                    Math.min(run.written.length + 1, run.queue.length),
                    run.queue.length,
                    run.folder,
                  )}
                />
              )}
            </div>
            <div className="export-footer export-footer--run">
              <span className="export-footer__spacer" />
              {step === "writing" ? (
                <>
                  <Button
                    variant="ghost"
                    className="export-cancel"
                    onClick={() => {
                      cancel.current = true
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="export-submit export-submit--running"
                    icon={<Icon name="loader-circle" size={16} />}
                    disabled
                  >
                    Exporting…
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" onClick={onClose}>
                    Close
                  </Button>
                  <Button
                    variant="primary"
                    className="export-submit export-retry"
                    icon={<Icon name="rotate-ccw" size={16} />}
                    onClick={() => {
                      if (run.queue.length === 0) {
                        setRun(null)
                        setStep("options")
                        void runExport()
                        return
                      }
                      void writeQueue({
                        ...run,
                        error: null,
                        status: Object.fromEntries(
                          Object.entries(run.status).map(([p, s]) => [
                            p,
                            s === "written" ? s : "queued",
                          ]),
                        ),
                      })
                    }}
                  >
                    {run.queue.length === 0
                      ? "Retry"
                      : retryLabel(
                          run.queue.filter((e) => run.status[e.path] !== "written").length,
                        )}
                  </Button>
                </>
              )}
            </div>
          </>
        )}
        {step === "review" && review && (
          <ReviewStep
            review={review}
            setReview={setReview}
            onBack={() => {
              setReview(null)
              setStep("options")
            }}
            onClose={onClose}
            onWrite={(overwrite) => startWriting(review.folder, review.plan, overwrite)}
          />
        )}
      </div>
    </div>
  )
}

function ReviewStep({
  review,
  setReview,
  onBack,
  onClose,
  onWrite,
}: {
  review: Review
  setReview(r: Review): void
  onBack(): void
  onClose(): void
  onWrite(overwrite: Set<string>): void
}) {
  const { plan, choices } = review
  const { changed, fresh, same, diffs } = useMemo(() => {
    const changed = plan.filter((e) => e.status === "changed")
    const diffs = new Map<string, ReturnType<typeof unifiedDiff>>()
    for (const e of changed)
      diffs.set(e.path, unifiedDiff(e.existing ? textOf(e.existing) : "", textOf(e.contents)))
    return {
      changed,
      fresh: plan.filter((e) => e.status === "new"),
      same: plan.filter((e) => e.status === "same"),
      diffs,
    }
  }, [plan])
  const overwrite = changed.filter((e) => choices[e.path] === "overwrite")
  const kept = changed.length - overwrite.length
  const selected = changed.find((e) => e.path === review.selected) ?? changed[0]
  const diff = selected ? diffs.get(selected.path) : undefined
  const setAll = (c: ReviewChoice) =>
    setReview({
      ...review,
      choices: Object.fromEntries(changed.map((e) => [e.path, c])),
    })
  return (
    <>
      <div className="export-header export-header--review">
        <IconButton
          className="export-close export-back"
          label="Back"
          icon={<Icon name="chevron-left" size={16} />}
          onClick={onBack}
        />
        <div className="export-titles">
          <h2 id="export-title" className="export-title">
            Review changes
          </h2>
          <p className="export-desc">
            {reviewDesc(changed.length, plan.length, shortFolder(review.folder))}
          </p>
        </div>
        <IconButton
          className="export-close"
          label="Close"
          icon={<Icon name="x" size={16} />}
          onClick={onClose}
        />
      </div>
      <div className="export-review">
        <div className="export-review__files">
          {changed.map((e) => {
            const d = diffs.get(e.path)
            return (
              <ReviewFileRow
                key={e.path}
                name={e.path}
                kind="changed"
                added={d?.added ?? 0}
                removed={d?.removed ?? 0}
                choice={choices[e.path] ?? "keep"}
                selected={e === selected}
                onSelect={() => setReview({ ...review, selected: e.path })}
                onChoice={(c) => setReview({ ...review, choices: { ...choices, [e.path]: c } })}
              />
            )
          })}
          {fresh.map((e) => (
            <ReviewFileRow key={e.path} name={e.path} kind="new" />
          ))}
          {same.length > 0 && (
            <div className="export-review__identical">
              <span className="export-review__identical-icon">
                <Icon name="equal" size={12} />
              </span>
              <span className="export-review__identical-text">
                Identical files are skipped silently
              </span>
            </div>
          )}
        </div>
        {selected && diff && (
          <div className="export-diff" data-file={selected.path}>
            <div className="export-diff__header">
              <span className="export-diff__file">{selected.path}</span>
              <span className="export-diff__dir">on disk {" → "} export</span>
              <span className="export-tabs__spacer" />
              <span className="export-diff__meta">{hunksLabel(diff.hunks.length)}</span>
            </div>
            <div className="export-diff__lines">
              {diff.hunks.flatMap((h, hi) =>
                h.rows.map((r, ri) => (
                  <DiffLine
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                    key={`${hi}-${ri}`}
                    kind={r.kind}
                    number={r.number}
                    code={r.text}
                  />
                )),
              )}
            </div>
          </div>
        )}
      </div>
      <div className="export-footer export-footer--review">
        <span className="export-footer__icon">
          <Icon name="info" size={14} />
        </span>
        <span className="export-footer__note">
          {reviewSummary(overwrite.length, kept, fresh.length)}
        </span>
        <span className="export-footer__spacer" />
        <Button variant="ghost" className="export-keep-all" onClick={() => setAll("keep")}>
          Keep all
        </Button>
        <Button
          variant="secondary"
          className="export-overwrite-all"
          icon={<Icon name="replace-all" size={16} />}
          onClick={() => setAll("overwrite")}
        >
          Overwrite all
        </Button>
        <Button
          variant="primary"
          className="export-submit export-write"
          icon={<Icon name="download" size={16} />}
          onClick={() => onWrite(new Set(overwrite.map((e) => e.path)))}
        >
          {writeLabel(overwrite.length + fresh.length)}
        </Button>
      </div>
    </>
  )
}
