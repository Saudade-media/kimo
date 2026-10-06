/**
 * The Conflicts tab of the right panel (board 18 `Conflicts Panel` cNrNM), 1:1 with the node
 * tree: Summary (title + count, progress, source, Take all ours / theirs) · one Group per owner
 * with open rows (Group Header + ConflictRows) · Resolved (header + ResolvedRows) · Spacer ·
 * Footer (Mark resolved & save + hint).
 *
 * Board 20 "Conflicts polish" (rTpad): each row's "base ›" toggle shows the mono base line
 * (per row, not persisted); groups are ordered Document (file-cog), Variables (variable), then
 * nodes in layer order (their layer icon); a resolved row expands in place (one at a time) to
 * `ResolvedRow/Expanded` with both sides, the base line and Reopen.
 */
import type { NodeData } from "@kimo/editor-state"
import { Button, type ConflictBase, ConflictRow, ResolvedRow } from "@kimo/ui"
import { Check, ChevronDown, ChevronRight } from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useFailureToast } from "../editor/failure-toast"
import { typeIcon } from "../editor/props"
import { Icon } from "../lib/icons"
import type { ConflictRowView } from "../platform/contract"
import { groupRows, sourceLine } from "./rows"
import type { EditorConflictSession } from "./session"
import "./conflicts.css"

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Tab label: "Conflicts 2" (open count), board 18 `LD9CB`. */
export const conflictsTabLabel = (open: number) => `Conflicts ${open}`

/** Subscribes to a conflict session; returns its (identity-stable) rows. */
export function useConflictRows(session: EditorConflictSession): ConflictRowView[] {
  return useSyncExternalStore(session.subscribe, session.rows, session.rows)
}

export interface ConflictsPanelProps {
  session: EditorConflictSession
  /** Node lookup for group header icons (`store.getNode`). */
  getNode?: (id: string) => NodeData | undefined
}

export function ConflictsPanel({ session, getNode }: ConflictsPanelProps) {
  const rows = useConflictRows(session)
  const focused = useSyncExternalStore(session.subscribe, session.focused, session.focused)
  const counts = session.counts()
  const source = sourceLine(session.info)
  const open = rows.filter((r) => !r.resolved)
  const resolved = rows.filter((r) => r.resolved)
  const groups = groupRows(open)
  const [resolvedOpen, setResolvedOpen] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [baseOpen, setBaseOpen] = useState<ReadonlySet<string>>(() => new Set())
  const toggleBase = (id: string) =>
    setBaseOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const commit = session.info?.base ?? null
  const [saving, setSaving] = useState(false)
  const fail = useFailureToast()
  const root = useRef<HTMLDivElement>(null)

  // Next conflict (⌘') focuses the row: scroll it into view and focus its first choice.
  useEffect(() => {
    if (!focused) return
    const el = root.current?.querySelector<HTMLElement>(`[data-conflict-id="${focused}"]`)
    if (!el) return
    el.scrollIntoView?.({ block: "nearest" })
    el.querySelector<HTMLElement>("[role=radio]")?.focus({ preventScroll: true })
  }, [focused])

  const pct = counts.total > 0 ? (counts.resolved / counts.total) * 100 : 0
  const ready = counts.open === 0
  return (
    <div ref={root} className="conflicts-panel" data-testid="conflicts-panel">
      <div className="conflicts-panel__summary">
        <div className="conflicts-panel__title-row">
          <span className="conflicts-panel__title">Merge conflicts</span>
          <span className="conflicts-panel__count">
            {counts.resolved} of {counts.total} resolved
          </span>
        </div>
        <div
          className="conflicts-panel__progress"
          role="progressbar"
          aria-label="Resolved conflicts"
          aria-valuemin={0}
          aria-valuemax={counts.total}
          aria-valuenow={counts.resolved}
        >
          <div className="conflicts-panel__progress-fill" style={{ width: `${pct}%` }} />
        </div>
        {source && <span className="conflicts-panel__source">{source}</span>}
        <div className="conflicts-panel__pick-all">
          <Button
            variant="secondary"
            size="sm"
            className="conflicts-panel__pick"
            disabled={counts.open === 0}
            onClick={() => session.chooseAll("ours")}
          >
            Take all ours
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="conflicts-panel__pick"
            disabled={counts.open === 0}
            onClick={() => session.chooseAll("theirs")}
          >
            Take all theirs
          </Button>
        </div>
      </div>

      {groups.map(({ key, rows: list }) => {
        const first = list[0] as ConflictRowView
        const node = first.nodeId && getNode ? getNode(first.nodeId) : undefined
        return (
          <section key={key} className="conflicts-panel__group" aria-label={first.group}>
            <div className="conflicts-panel__group-header">
              <span className="conflicts-panel__group-icon" aria-hidden="true">
                <Icon
                  name={
                    first.kind === "variable"
                      ? "variable"
                      : first.kind === "header"
                        ? "file-cog"
                        : node
                          ? typeIcon(node)
                          : "frame"
                  }
                  size={12}
                />
              </span>
              <span className="conflicts-panel__group-node">{first.group}</span>
              <span className="conflicts-panel__spacer" aria-hidden="true" />
              <span className="conflicts-panel__group-count">{list.length} open</span>
            </div>
            {list.map((r) => (
              <Row
                key={r.id}
                row={r}
                session={session}
                focused={focused === r.id}
                base={baseOf(r, commit)}
                baseOpen={baseOpen.has(r.id)}
                onToggleBase={() => toggleBase(r.id)}
              />
            ))}
          </section>
        )
      })}

      {resolved.length > 0 && (
        <section className="conflicts-panel__resolved" aria-label="Resolved">
          <button
            type="button"
            className="conflicts-panel__resolved-header"
            aria-expanded={resolvedOpen}
            onClick={() => setResolvedOpen((v) => !v)}
          >
            <span className="conflicts-panel__chevron" aria-hidden="true">
              {resolvedOpen ? <ChevronDown /> : <ChevronRight />}
            </span>
            <span className="conflicts-panel__resolved-label">Resolved · {resolved.length}</span>
          </button>
          {resolvedOpen &&
            resolved.map((r) => (
              <ResolvedRow
                key={r.id}
                data-conflict-id={r.id}
                node={r.group}
                property={r.property}
                choice={r.resolvedLabel ?? ""}
                expanded={expanded === r.id}
                onToggleExpanded={() => setExpanded((e) => (e === r.id ? null : r.id))}
                ours={sideOf(r.ours)}
                theirs={sideOf(r.theirs)}
                applied={r.applied}
                base={baseOf(r, commit)}
                onChoose={(side) => session.choose(r.id, side)}
                onReopen={() => {
                  setExpanded(null)
                  session.reopen(r.id)
                }}
              />
            ))}
        </section>
      )}

      <div className="conflicts-panel__fill" aria-hidden="true" />

      <div className="conflicts-panel__footer">
        <Button
          variant="primary"
          className="conflicts-panel__mark"
          icon={<Check />}
          disabled={!ready || saving}
          onClick={() => {
            setSaving(true)
            session
              .markResolvedAndSave()
              // A5: a failed write keeps the conflicts and says why (Toast/Danger).
              .catch((e: unknown) => fail(`save ${session.fileName()}`, e))
              .finally(() => setSaving(false))
          }}
        >
          Mark resolved &amp; save
        </Button>
        <span
          className={
            ready ? "conflicts-panel__hint conflicts-panel__hint--ready" : "conflicts-panel__hint"
          }
        >
          {ready
            ? `${counts.resolved} of ${counts.total} resolved · writes ${session.fileName()} without conflict nodes`
            : `Pick a side for ${plural(counts.open, "more conflict")}`}
        </span>
      </div>
    </div>
  )
}

const sideOf = (v: ConflictRowView["ours"]) => ({
  value: v.display,
  caption: v.caption,
  swatch: v.swatch,
})

/** The base line of a row: the base value (or "absent") and the merge base's short commit. */
export function baseOf(row: ConflictRowView, commit: string | null): ConflictBase {
  return { value: row.base.display, swatch: row.base.swatch, commit }
}

function Row({
  row,
  session,
  focused,
  base,
  baseOpen,
  onToggleBase,
}: {
  row: ConflictRowView
  session: EditorConflictSession
  focused: boolean
  base: ConflictBase
  baseOpen: boolean
  onToggleBase: () => void
}) {
  return (
    <ConflictRow
      data-conflict-id={row.id}
      data-focused={focused || undefined}
      property={row.property}
      hint={row.resolved ? (row.resolvedLabel ?? row.kindLabel) : row.kindLabel}
      ours={sideOf(row.ours)}
      theirs={sideOf(row.theirs)}
      resolved={row.resolved}
      applied={row.applied}
      onChoose={(side) => session.choose(row.id, side)}
      base={base}
      baseOpen={baseOpen}
      onToggleBase={onToggleBase}
    />
  )
}
