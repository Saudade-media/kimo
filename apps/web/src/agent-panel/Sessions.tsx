/**
 * Board 22 B "session history" (J7bfOc › Session List zJTW2): Search Wrap (yO7ir) with Input
 * "Search sessions", group "This file · <name>", SessionRows (current = bg-muted), Gap 8,
 * "Other files", Spacer, Footer (LMBEG) "Stored on this device, not in the .kimo file".
 */
import type { CliDetection, SessionMeta } from "@kimo/ai-agent"
import { Input, SessionRow } from "@kimo/ui"
import { HardDrive, Search } from "lucide-react"
import type { AgentPanelControllerExt, AgentPanelViewState } from "./controller"
import { relativeTime, sessionMetaLabel } from "./format"

export interface SessionListProps {
  controller: AgentPanelControllerExt
  state: AgentPanelViewState
  fileName: string
  clis: readonly CliDetection[]
  now: number
}

export function SessionList({ controller, state, fileName, clis, now }: SessionListProps) {
  const { thisFile, otherFiles, query } = state.sessions
  const row = (m: SessionMeta, other: boolean) => (
    <SessionRow
      key={m.id}
      title={m.title}
      time={relativeTime(m.updatedAt, now)}
      meta={sessionMetaLabel(m, { otherFile: other, clis, showCost: state.showCost })}
      current={state.session?.id === m.id}
      data-session={m.id}
      onClick={() => void controller.openSession(m.id)}
    />
  )
  return (
    <div className="agent-sessions" data-testid="agent-sessions">
      <div className="agent-sessions__search">
        <Input
          icon={<Search />}
          placeholder="Search sessions"
          aria-label="Search sessions"
          value={query}
          onChange={(e) => controller.searchSessions(e.currentTarget.value)}
        />
      </div>
      <p className="agent-sessions__group">This file · {fileName.replace(/\.kimo$/, "")}</p>
      {thisFile.map((m) => row(m, false))}
      {thisFile.length === 0 && <p className="agent-sessions__empty">No sessions yet.</p>}
      {otherFiles.length > 0 && (
        <>
          <span className="agent-sessions__gap" aria-hidden="true" />
          <p className="agent-sessions__group">Other files</p>
          {otherFiles.map((m) => row(m, true))}
        </>
      )}
      <span className="agent-sessions__spacer" aria-hidden="true" />
      <div className="agent-sessions__footer">
        <HardDrive className="agent-sessions__footer-icon" aria-hidden="true" />
        <span className="agent-sessions__footer-label">
          Stored on this device, not in the .kimo file
        </span>
      </div>
    </div>
  )
}
