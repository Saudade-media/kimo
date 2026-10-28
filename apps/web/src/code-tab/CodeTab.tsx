/**
 * Right panel › Code tab — board 25 "v1 Polish" (OqLSw) § 1 (nkVxr): live, read-only code for
 * the selection from the same generators as Export (`@kimo/exporters`), in the "Ink" theme.
 *
 * Right Panel · Code (hc6wk), column, in node order:
 *   Tabs (the panel's) · Selection (CChLA) · Framework Bar (WLqjf) · File Tabs (vQgF3) ·
 *   Code View (deO9F) · [Truncation Bar (PhPBM)] · Footer (uyAuG)
 * States: (d) nothing selected (Divider LTeqc + Empty Body kNMph) · (e) unsupported node
 * (Selection + Unsupported Body SQJFF with Notice xHvmD).
 */

import type { NodeData } from "@kimo/editor-state"
import type { IconLoader } from "@kimo/exporters"
import {
  Badge,
  CodeLine,
  CompactButton,
  FileChip,
  IconButton,
  NoticeCard,
  SegmentedText,
} from "@kimo/ui"
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import type { M3Controller } from "../editor/m3/controller"
import { useBusValue } from "../editor/m3/controller"
import { kindLabel, MIXED, nodeName, shared, typeIcon } from "../editor/props"
import type { FileSession } from "../editor/session"
import { EXPORT_OPTIONS_EVENT, readExportTailwind, readExportToggles } from "../export/model"
import { useUi } from "../lib/hooks"
import { Icon } from "../lib/icons"
import "./code-tab.css"
import { type CodeFile, type GeneratedCode, generateCode } from "./generate"
import {
  CODE_TAB_MAX_LINES,
  codeLines,
  copiedToast,
  copyAllLabel,
  FRAMEWORKS,
  type Framework,
  highlightedLines,
  inkLines,
  insideBy,
  LIVE_DEBOUNCE_MS,
  langOf,
  linesMeta,
  liveStatus,
  nodeAtLine,
  readFramework,
  resolveTarget,
  skippedComment,
  skippedKind,
  tokensMeta,
  truncatedTitle,
  UNSUPPORTED_DESC,
  UNSUPPORTED_TYPES,
  unsupportedTitle,
  writeFramework,
} from "./model"

/** "Open export…": the dialog opens with the same selection and framework (rule). */
export interface CodeExportPreset {
  format?: Framework
  /** Node ids to export; empty = every top-level frame ("Export page…"). */
  ids: readonly string[]
}

interface CodeTabProps {
  session: FileSession
  m3: M3Controller
  /** Icon glyphs (the renderer's provider): icons export as inline SVG. */
  icons?: IconLoader | null
  /** Opens the Export dialog (Footer "Open export…", truncation bar, empty "Export page…"). */
  onOpenExport?: (preset: CodeExportPreset) => void
  /** Clipboard writer (default `navigator.clipboard.writeText`). */
  copyText?: (text: string) => Promise<void> | void
  /** Storage for the per-file framework (default `localStorage`). */
  storage?: Pick<Storage, "getItem" | "setItem"> | null
}

const defaultStorage = (): Pick<Storage, "getItem" | "setItem"> | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function CodeTab({
  session,
  m3,
  icons = null,
  onOpenExport,
  copyText = (t) => navigator.clipboard?.writeText(t),
  storage = defaultStorage(),
}: CodeTabProps) {
  const selection = useUi(session.ui, (s) => s.selection)
  const rev = useBusValue(m3.rev)
  const [framework, setFramework] = useState<Framework>(() => readFramework(session.id, storage))
  useEffect(() => setFramework(readFramework(session.id, storage)), [session.id, storage])
  const pickFramework = (f: Framework) => {
    setFramework(f)
    writeFramework(session.id, f, storage)
  }

  // Which nodes the code is generated for: the roots stay while the selection is inside them.
  const rootsRef = useRef<string[]>([])
  const target = useMemo(() => {
    const view = m3.view()
    const inside = insideBy((id) => {
      const p = view.getNode(id)?.parent
      return typeof p === "string" ? p : null
    })
    const t = resolveTarget(selection, rootsRef.current, inside)
    rootsRef.current = t.roots
    return t
  }, [selection, m3])

  // biome-ignore lint/correctness/useExhaustiveDependencies: rev = names / types may change
  const nodes = useMemo(() => {
    const view = m3.view()
    return target.roots
      .map((id) => ({ id, node: view.getNode(id) as NodeData | undefined }))
      .filter((n): n is { id: string; node: NodeData } => !!n.node)
  }, [target.roots, m3, rev])
  const supported = nodes.filter((n) => !UNSUPPORTED_TYPES.has(n.node.type))
  const supportedKey = supported.map((n) => n.id).join("\u0000")
  const skipped = useMemo(
    () =>
      nodes
        .filter((n) => UNSUPPORTED_TYPES.has(n.node.type))
        .map((n) => ({ kind: skippedKind(n.node.type), name: nodeName(n.node) })),
    [nodes],
  )
  const skippedKey = skipped.map((s) => `${s.kind}\u0000${s.name}`).join("\u0001")

  // Generation: immediately on a new target / framework, debounced on edits (rule "Live").
  const [code, setCode] = useState<GeneratedCode | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const seq = useRef(0)
  const generatedFor = useRef("")
  const pausedRef = useRef(false)
  const ids = useMemo(() => (supportedKey ? supportedKey.split("\u0000") : []), [supportedKey])
  // Export's remembered options (toggles, Tailwind theme): re-read when the dialog changes them
  // (board 28 (d): the tab has no Tailwind control of its own).
  const [optionsRev, setOptionsRev] = useState(0)
  useEffect(() => {
    const bump = () => setOptionsRev((n) => n + 1)
    globalThis.addEventListener?.(EXPORT_OPTIONS_EVENT, bump)
    globalThis.addEventListener?.("storage", bump)
    return () => {
      globalThis.removeEventListener?.(EXPORT_OPTIONS_EVENT, bump)
      globalThis.removeEventListener?.("storage", bump)
    }
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: optionsRev = the options changed
  const toggles = useMemo(() => readExportToggles(storage), [storage, optionsRev])
  // biome-ignore lint/correctness/useExhaustiveDependencies: optionsRev = the options changed
  const tailwind = useMemo(() => readExportTailwind(storage), [storage, optionsRev])
  const optionsKey = `${JSON.stringify(toggles)}${JSON.stringify(tailwind)}`
  const key = `${supportedKey}\u0001${framework}\u0001${optionsKey}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: rev = the document changed
  useEffect(() => {
    if (ids.length === 0) {
      setCode(null)
      generatedFor.current = key
      return
    }
    const fresh = generatedFor.current !== key
    // Over 400 lines: only a selection / framework change regenerates (rule "Truncate").
    if (!fresh && pausedRef.current) return
    const run = () => {
      const n = ++seq.current
      void generateCode(
        { document: () => session.store.toDocument(), libraries: () => m3.libraries(), icons },
        ids,
        framework,
        toggles,
        tailwind,
      ).then((g) => {
        if (n !== seq.current) return
        generatedFor.current = key
        setCode(g)
      })
    }
    if (fresh) {
      run()
      return
    }
    const t = setTimeout(run, LIVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [key, rev, ids, framework, toggles, tailwind, icons, session, m3])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new target starts on its root file
  useEffect(() => {
    setActive(null)
  }, [key])

  // Mixed selection: each skipped node leaves a one-line comment in the root file.
  // biome-ignore lint/correctness/useExhaustiveDependencies: skippedKey = skipped's content
  const files: CodeFile[] = useMemo(() => {
    const out = code?.files ?? []
    if (skipped.length === 0 || out.length === 0) return out
    const [first, ...rest] = out as [CodeFile, ...CodeFile[]]
    const notes = skipped
      .map((s) => skippedComment(first.path, s.kind, s.name))
      .filter((l): l is string => l !== null)
    if (notes.length === 0) return out
    const base = first.contents.endsWith("\n") ? first.contents : `${first.contents}\n`
    return [{ ...first, contents: `${base}${notes.join("\n")}\n` }, ...rest]
  }, [code, skippedKey])
  const current = files.find((f) => f.path === active) ?? files[0] ?? null
  const all = useMemo(() => (current ? codeLines(current.contents) : []), [current])
  const total = all.length
  const truncated = total > CODE_TAB_MAX_LINES
  pausedRef.current = truncated
  const tokens = useMemo(
    () => (current ? inkLines(all, langOf(current.path), CODE_TAB_MAX_LINES) : []),
    [all, current],
  )
  const highlight = useMemo(
    () => highlightedLines(current?.map ?? null, target.highlight),
    [current, target.highlight],
  )

  const copyFile = () => {
    if (!current) return
    void copyText(current.contents)
    m3.toast({ tone: "success", text: copiedToast(current.path) })
  }
  const openExport = () => onOpenExport?.({ format: framework, ids: target.roots })
  const selectLine = (n: number) => {
    const id = nodeAtLine(current?.map ?? null, n)
    if (id) session.ui.getState().select([id])
  }

  const onChipKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
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
    e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
  }

  // (d) Nothing selected (kNMph): empty state, not the whole page.
  if (nodes.length === 0)
    return (
      <div className="code-tab code-tab--empty">
        <div className="code-tab__divider" />
        <div className="code-tab__empty">
          <span className="code-tab__empty-icon">
            <Icon name="code-xml" size={18} />
          </span>
          <span className="code-tab__empty-title">Select a layer to see its code</span>
          <span className="code-tab__empty-desc">
            Code follows your selection live. To export a whole page, use Export.
          </span>
          <CompactButton
            variant="secondary"
            height={28}
            padX={12}
            icon={<Icon name="download" size={14} />}
            onClick={() => onOpenExport?.({ ids: [] })}
          >
            Export page…
          </CompactButton>
        </div>
      </div>
    )

  const first = nodes[0] as { id: string; node: NodeData }
  const single = nodes.length === 1
  const prompt = single && first.node.type === "prompt"
  const kind = shared(
    nodes.map((n) => n.node),
    kindLabel,
  )
  const header = (
    <div className="selection-header code-tab__selection">
      <span className={`selection-header__icon${prompt ? " code-tab__selection-icon--agent" : ""}`}>
        <Icon name={prompt ? "sparkles" : single ? typeIcon(first.node) : "layers"} size={14} />
      </span>
      <span className="selection-header__name" data-testid="code-selection-name">
        {single ? nodeName(first.node) : `${nodes.length} layers`}
      </span>
      <span className="selection-header__spacer" />
      <Badge>{kind === MIXED ? "Mixed" : kind}</Badge>
    </div>
  )

  // (e) Only unsupported nodes: the notice, switch and file tabs hidden.
  if (supported.length === 0)
    return (
      <div className="code-tab code-tab--unsupported">
        {header}
        <div className="code-tab__unsupported">
          <NoticeCard
            icon={<Icon name="circle-slash" size={14} />}
            title={unsupportedTitle(skippedKind(first.node.type))}
            description={UNSUPPORTED_DESC}
          />
        </div>
      </div>
    )

  const meta = code?.tokens
    ? tokensMeta(code.tokens.used, code.tokens.total)
    : current
      ? linesMeta(total)
      : ""
  return (
    <div className="code-tab">
      {header}
      <div className="code-tab__bar">
        <SegmentedText
          className="code-tab__switch"
          label="Framework"
          options={FRAMEWORKS}
          value={framework}
          onChange={pickFramework}
        />
        <span className="code-tab__spacer" />
        <IconButton
          className="code-tab__copy"
          label="Copy file"
          icon={<Icon name="copy" size={14} />}
          disabled={!current}
          onClick={copyFile}
        />
      </div>
      <div className="code-tab__files">
        <div className="code-tab__chips" role="tablist" aria-label="Generated files">
          {files.map((f, i) => (
            <FileChip
              key={f.path}
              path={f.path}
              active={f === current}
              onClick={() => setActive(f.path)}
              onKeyDown={(e) => onChipKey(e, i)}
            />
          ))}
        </div>
        <span className="code-tab__spacer" />
        <span className="code-tab__meta">{meta}</span>
      </div>
      <div
        className="code-tab__view"
        role="tabpanel"
        aria-label={current?.path ?? "Code"}
        data-lines={total}
      >
        {code?.errors.length && !current ? (
          <CodeLine number={1} tokens={[{ kind: "comment", text: code.errors.join(" · ") }]} />
        ) : null}
        {tokens.map((line, i) => {
          const n = i + 1
          const on = highlight.has(n)
          return (
            <CodeLine
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
              key={i}
              number={n}
              tokens={line}
              highlighted={on}
              onClick={() => selectLine(n)}
            />
          )
        })}
      </div>
      {truncated && (
        <div className="code-tab__truncation" role="status">
          <div className="code-tab__truncation-row">
            <span className="code-tab__truncation-icon">
              <Icon name="scissors" size={14} />
            </span>
            <span className="code-tab__truncation-title">{truncatedTitle(total)}</span>
          </div>
          <p className="code-tab__truncation-desc">
            The Code tab renders at most {CODE_TAB_MAX_LINES} lines per file. Export writes the full
            output, with nothing dropped.
          </p>
          <div className="code-tab__truncation-actions">
            <CompactButton
              variant="secondary"
              height={24}
              padX={10}
              text="xs"
              className="code-tab__copy-all"
              icon={<Icon name="copy" size={12} />}
              onClick={copyFile}
            >
              {copyAllLabel(total)}
            </CompactButton>
            <CompactButton
              variant="ghost"
              height={24}
              padX={10}
              text="xs"
              className="code-tab__open-export-button"
              onClick={openExport}
            >
              Open export…
            </CompactButton>
          </div>
        </div>
      )}
      <div className="code-tab__footer">
        <span className={`code-tab__dot${truncated ? " code-tab__dot--paused" : ""}`} />
        <span className="code-tab__status">{liveStatus(truncated)}</span>
        <span className="code-tab__spacer" />
        <button type="button" className="code-tab__open-export" onClick={openExport}>
          <span className="code-tab__open-export-label">Open export…</span>
          <Icon name="arrow-up-right" size={12} />
        </button>
      </div>
    </div>
  )
}
