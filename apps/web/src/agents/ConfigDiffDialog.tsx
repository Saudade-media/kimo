/**
 * Board 24 › 5 · (c) MCP config diff preview (KdEak › Dialog · Update config K5Dnf). Shown before
 * Kimo writes any host config (install, update or remove): a read-only unified diff of the exact
 * file, scrolled to the change; a timestamped backup is always written first; "Copy diff" for
 * users who manage dotfiles by hand; nothing is written on Cancel.
 *
 *   Dialog: column, gap 14, padding 20, bg-overlay, 1 px border, radius-xl, shadow 0 16 48
 *   ├ Head (EVccw) row gap 12 › Icon Wrap 32 pill bg-muted (file-diff 16 text-secondary) ·
 *   │   Text column gap 4: Title sans 13 / 600 · Desc mono 11 text-secondary
 *   ├ Diff (MFEi0) column, padding [8, 0], bg-subtle, 1 px border, radius-md ›
 *   │   Line row gap 8, padding [1, 12]: Sign · Code mono 11 (− danger-soft, + success-soft)
 *   ├ Footer (hdWkt) row gap 8, center › Copy diff (ghost h 28) · Spacer · Cancel (ghost h 28) ·
 *   │   Write config (primary h 28)
 *   └ Footnote (v3QurW) sans 11 text-tertiary "Backup → <path>.kimo-<date>.bak"
 */
import { Banner, CompactButton, DialogScrim, useDismiss } from "@kimo/ui"
import { useEffect, useRef } from "react"
import { AgentIcon } from "./icons"

export interface DiffRow {
  sign: " " | "-" | "+"
  text: string
}

/** Line diff (LCS) with `context` unchanged lines around each change; "…" marks gaps. */
function diffRows(before: string | null, after: string | null, context = 2): DiffRow[] {
  const a = (before ?? "").split("\n")
  const b = (after ?? "").split("\n")
  if (before === null) return b.map((text) => ({ sign: "+", text }))
  if (after === null) return a.map((text) => ({ sign: "-", text }))
  const n = a.length
  const m = b.length
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      (L[i] as number[])[j] =
        a[i] === b[j]
          ? ((L[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((L[i + 1] as number[])[j] as number, (L[i] as number[])[j + 1] as number)
  const all: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      all.push({ sign: " ", text: a[i] as string })
      i++
      j++
    } else if (((L[i + 1] as number[])[j] as number) >= ((L[i] as number[])[j + 1] as number))
      all.push({ sign: "-", text: a[i++] as string })
    else all.push({ sign: "+", text: b[j++] as string })
  }
  while (i < n) all.push({ sign: "-", text: a[i++] as string })
  while (j < m) all.push({ sign: "+", text: b[j++] as string })
  const keep = all.map((_r, k) =>
    all.slice(Math.max(0, k - context), k + context + 1).some((x) => x.sign !== " "),
  )
  const out: DiffRow[] = []
  all.forEach((r, k) => {
    if (keep[k]) out.push(r)
    else if (keep[k - 1]) out.push({ sign: " ", text: "…" })
  })
  return out
}

function unifiedDiffText(rows: readonly DiffRow[]): string {
  return rows.map((r) => `${r.sign} ${r.text}`).join("\n")
}

/** "~/.claude.json.kimo-2026-10-04.bak". */
function backupPath(path: string, now: Date): string {
  return `${path}.kimo-${now.toISOString().slice(0, 10)}.bak`
}

export interface ConfigDiffDialogProps {
  /** "Claude Code". */
  label: string
  action: "install" | "update" | "remove"
  /** Display path (tilde form). */
  path: string
  /** "kimo 0.4.1 → 0.5.0" (update), else omitted. */
  versions?: string
  before: string | null
  after: string | null
  error?: string
  /** Board 37 F7: the write is running ("Writing…", disabled); the dialog stays open. */
  writing?: boolean
  /** Board 37 F7 DwSsz: the write failed; the primary button reads "Try again". */
  writeError?: { title: string; body: string } | null
  onCopy(text: string): void
  onCancel(): void
  onConfirm(): void
  now?: Date
}

export function ConfigDiffDialog(p: ConfigDiffDialogProps) {
  const root = useRef<HTMLDivElement>(null)
  const rows = diffRows(p.before, p.after)
  useDismiss(root, p.onCancel, undefined, true)
  const firstChange = useRef<HTMLDivElement>(null)
  useEffect(() => {
    firstChange.current?.scrollIntoView({ block: "nearest" })
  }, [])
  const title =
    p.action === "remove"
      ? `Remove Kimo from ${p.label}?`
      : p.action === "update"
        ? `Update ${p.label} config?`
        : `Add Kimo to ${p.label}?`
  let marked = false
  return (
    <DialogScrim>
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="agents-config-diff"
        data-testid="agents-config-diff"
      >
        <div className="agents-config-diff__head">
          <span className="agents-config-diff__icon-wrap" aria-hidden="true">
            <AgentIcon name="file-diff" size={16} />
          </span>
          <div className="agents-config-diff__text">
            <h2 className="agents-config-diff__title">{title}</h2>
            <p className="agents-config-diff__desc">
              {p.versions ? `${p.path} · ${p.versions}` : p.path}
            </p>
          </div>
        </div>
        {p.error ? (
          <p className="agents-config-diff__error">{p.error}</p>
        ) : (
          <div className="agents-config-diff__diff" data-testid="agents-diff">
            {rows.map((r, k) => {
              const change = r.sign !== " "
              const ref = change && !marked ? firstChange : undefined
              if (change) marked = true
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no identity.
                  key={k}
                  ref={ref}
                  className={`agents-config-diff__line agents-config-diff__line--${r.sign === "-" ? "del" : r.sign === "+" ? "add" : "ctx"}`}
                >
                  <span className="agents-config-diff__sign">{r.sign}</span>
                  <span className="agents-config-diff__code">{r.text}</span>
                </div>
              )
            })}
          </div>
        )}
        {p.writeError && (
          <Banner
            tone="danger"
            className="agents-config-diff__banner"
            data-pen="DwSsz"
            data-testid="agents-config-write-error"
            title={p.writeError.title}
            body={p.writeError.body}
          />
        )}
        <div className="agents-config-diff__footer">
          <CompactButton
            variant="ghost"
            height={28}
            padX={10}
            icon={<AgentIcon name="copy" size={14} />}
            onClick={() => p.onCopy(unifiedDiffText(rows))}
          >
            Copy diff
          </CompactButton>
          <span className="agents-spacer" />
          <CompactButton variant="ghost" height={28} padX={10} onClick={p.onCancel}>
            Cancel
          </CompactButton>
          <CompactButton
            variant="primary"
            height={28}
            padX={10}
            disabled={!!p.error || p.writing}
            onClick={p.onConfirm}
          >
            {p.writing
              ? "Writing…"
              : p.writeError
                ? "Try again"
                : p.action === "remove"
                  ? "Remove"
                  : "Write config"}
          </CompactButton>
        </div>
        <p className="agents-config-diff__footnote">
          {`Backup → ${backupPath(p.path, p.now ?? new Date())}`}
        </p>
      </div>
    </DialogScrim>
  )
}
