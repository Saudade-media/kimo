/**
 * The Conflicts tab of the right panel (board 18 `Conflicts Panel` cNrNM), 1:1 with the node
 * tree: Summary (title + count, progress, source, Take all ours / theirs) · one Group per owner
 * with open rows (Group Header + ConflictRows) · Resolved (header + compact rows) · Spacer ·
 * Footer (Mark resolved & save + hint). Rows follow layer order.
 */
import type { NodeData } from "@kimo/editor-state"
import { Button, ConflictRow } from "@kimo/ui"
import { Check, ChevronDown, ChevronRight, CircleCheck, FileText, Variable } from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
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
  const [saving, setSaving] = useState(false)
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
                {first.kind === "variable" ? (
                  <Variable size={12} />
                ) : first.kind === "header" ? (
                  <FileText size={12} />
                ) : (
                  <Icon name={node ? typeIcon(node) : "frame"} size={12} />
                )}
              </span>
              <span className="conflicts-panel__group-node">{first.group}</span>
              <span className="conflicts-panel__spacer" aria-hidden="true" />
              <span className="conflicts-panel__group-count">{list.length} open</span>
            </div>
            {list.map((r) => (
              <Row key={r.id} row={r} session={session} focused={focused === r.id} />
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
            resolved.map((r) =>
              expanded === r.id ? (
                <Row key={r.id} row={r} session={session} focused={focused === r.id} />
              ) : (
                <button
                  key={r.id}
                  type="button"
                  className="conflicts-panel__resolved-row"
                  data-conflict-id={r.id}
                  title="Change the choice"
                  onClick={() => setExpanded(r.id)}
                >
                  <span className="conflicts-panel__resolved-status" aria-hidden="true">
                    <CircleCheck />
                  </span>
                  <span className="conflicts-panel__resolved-node">{r.group}</span>
                  <span className="conflicts-panel__resolved-property">{r.property}</span>
                  <span className="conflicts-panel__spacer" aria-hidden="true" />
                  <span className="conflicts-panel__resolved-choice">{r.resolvedLabel}</span>
                </button>
              ),
            )}
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
              .catch((e) => console.warn("Kimo: Mark resolved & save", e))
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

function Row({
  row,
  session,
  focused,
}: {
  row: ConflictRowView
  session: EditorConflictSession
  focused: boolean
}) {
  return (
    <ConflictRow
      data-conflict-id={row.id}
      data-focused={focused || undefined}
      property={row.property}
      hint={row.resolved ? (row.resolvedLabel ?? row.kindLabel) : row.kindLabel}
      ours={{ value: row.ours.display, caption: row.ours.caption, swatch: row.ours.swatch }}
      theirs={{ value: row.theirs.display, caption: row.theirs.caption, swatch: row.theirs.swatch }}
      resolved={row.resolved}
      applied={row.applied}
      onChoose={(side) => session.choose(row.id, side)}
    />
  )
}
