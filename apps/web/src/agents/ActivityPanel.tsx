/**
 * Activity tab (board 21 O3WOp, right panel Pbaa8 below the Tabs): Filters (nDEoh), session
 * groups (RnyZP / JVfbh) of ActivityRows, Spacer, Footer (ng9cE) with retention + Export JSON.
 * Rules: newest first, grouped by session; hover highlights targets in $agent, click selects and
 * scrolls; per-entry and per-session undo only for that origin (guarded replay → "stale").
 */
import { ActivityRow, AgentMark, Button, CompactButton, EmptyState, Select } from "@kimo/ui"
import { useMemo, useState } from "react"
import type { AgentsControllerExt } from "./controller"
import { useAgentsState } from "./hooks"
import { AgentIcon } from "./icons"
import {
  activityGroups,
  clientOf,
  exportActivityJson,
  KIND_FILTERS,
  type KindFilter,
  storeNames,
  transportLabel,
} from "./model"

export interface AgentActivityPanelProps {
  controller: AgentsControllerExt
  fileId: string
  /** Hover: highlight these nodes on the canvas in $agent (null clears). */
  onHighlight?: (nodeIds: string[] | null) => void
  /** Export JSON: receives the file text (default: a download). */
  onExport?: (json: string, filename: string) => void
  /** Empty log, no agent connected: "Connect an agent…" opens Settings › Agents & MCP. */
  onConnectAgent?: () => void
}

export function AgentActivityPanel({
  controller,
  fileId,
  onHighlight,
  onExport,
  onConnectAgent,
}: AgentActivityPanelProps) {
  const state = useAgentsState(controller)
  const [client, setClient] = useState<string>("all")
  const [kind, setKind] = useState<KindFilter>("writes-errors")
  const nameOf = useMemo(() => storeNames(controller.store), [controller.store])
  const clients = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of state.activity) m.set(clientOf(e.origin), e.actor)
    for (const r of state.queue) m.set(r.client.client, r.client.label)
    return [...m]
  }, [state.activity, state.queue])
  const byOrigin = new Map(state.connections.map((c) => [c.origin, c]))
  const groups = activityGroups({
    entries: state.activity,
    pending: state.queue,
    nameOf,
    client,
    kind,
    stale: state.stale,
    undone: state.undone,
    undoneAt: state.undoneAt,
    transport: (o) => {
      const c = byOrigin.get(o)
      return c ? transportLabel(c, state.server) : null
    },
  })
  return (
    <div className="agents-activity" data-testid="agent-activity">
      <div className="agents-activity__filters">
        <Select
          dense
          className="agents-activity__select"
          label="Client"
          value={client}
          options={[
            { value: "all", label: "All clients" },
            ...clients.map(([value, label]) => ({ value, label })),
          ]}
          onChange={setClient}
        />
        <Select
          dense
          className="agents-activity__select"
          label="Kind"
          value={kind}
          options={KIND_FILTERS}
          onChange={setKind}
        />
      </div>
      <div className="agents-activity__list">
        {groups.length === 0 && (
          // Board 24 › 5 · (f) KzugB: Body column gap 12, padding 16, center › EmptyState
          // (history) · "Connect an agent…" only while no agent is connected.
          <div className="agents-activity__empty" data-testid="agent-activity-empty">
            <EmptyState
              className="agents-activity__empty-state"
              icon={<AgentIcon name="history" size={18} />}
              title="No agent activity yet"
              description="Agent changes show up here. Undo any of them."
            />
            {state.connections.length === 0 && onConnectAgent && (
              <CompactButton
                variant="secondary"
                height={28}
                padX={10}
                icon={<AgentIcon name="plug" size={14} />}
                onClick={onConnectAgent}
              >
                Connect an agent…
              </CompactButton>
            )}
          </div>
        )}
        {groups.map((g) => (
          <section key={g.origin} className="agents-activity__group" data-origin={g.origin}>
            <div className="agents-activity__group-header">
              <AgentMark size={16} />
              <span className="agents-activity__group-name">{g.name}</span>
              <span className="agents-activity__group-meta">{g.meta}</span>
              <span className="agents-spacer" />
              {g.undoable && (
                <button
                  type="button"
                  className="agents-link agents-link--xs"
                  onClick={() => void controller.undoSession(g.origin)}
                >
                  Undo session
                </button>
              )}
            </div>
            {g.rows.map((r) => (
              <ActivityRow
                key={r.key}
                time={r.time}
                label={r.label}
                tool={r.tool}
                target={r.target}
                tone={r.tone}
                pending={r.pending}
                stale={r.stale}
                undone={r.undone}
                // Redo only on each agent's last undone entry (the top of its redo stack).
                {...(r.undone && r.entry && controller.redoEntry && state.redoable.has(r.entry.seq)
                  ? { onRedo: () => void controller.redoEntry?.(r.entry as never) }
                  : {})}
                data-key={r.key}
                // Stale rows keep a disabled Undo (ActivityRow renders it from `stale`).
                {...(r.entry && r.undoable && !r.stale
                  ? { onUndo: () => void controller.undoEntry(r.entry as never) }
                  : {})}
                onActivate={() => r.entry && controller.focusEntry(r.entry)}
                // Every target of the entry, not only the first.
                onPointerEnter={() => r.nodeIds.length > 0 && onHighlight?.(r.nodeIds)}
                onPointerLeave={() => onHighlight?.(null)}
              />
            ))}
          </section>
        ))}
      </div>
      <div className="agents-activity__footer">
        <Button
          size="sm"
          variant="ghost"
          className="agents-button agents-button--ghost-primary agents-button--pad10"
          icon={<AgentIcon name="download" size={14} />}
          onClick={() => {
            const json = exportActivityJson(fileId, state.activity)
            const name = `kimo-activity-${fileId}.json`
            if (onExport) onExport(json, name)
            else download(json, name)
          }}
        >
          Export JSON
        </Button>
      </div>
    </div>
  )
}

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
