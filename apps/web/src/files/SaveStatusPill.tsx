/**
 * The topbar Save Status (XDqrb > Oxn3z): the 02d SaveStatus pill for `state.saveStatus`
 * (already passed through the 400 ms rule), the "Saved 10:42:18 · ~/…/marketing.kimo" tooltip
 * with ⌘S (board 16 spDGb), and, when Locked, the lease details popover on click.
 */
import { SaveStatus, type SaveStatusKind, Tooltip } from "@kimo/ui"
import { useRef, useState } from "react"
import { type SaveStatus as Status, savedTooltip, saveStatusLabel } from "../platform/contract"
import { displayPath, formatClock } from "../platform/format"
import type { FileDocumentSession } from "../platform/session"
import { useSessionState } from "./hooks"
import { LockDetailsPopover } from "./LockDetailsPopover"

/** Tooltip text per status (saved: time + path; failed: the error). */
function statusTooltip(s: Status, ref: string): string {
  if (s.kind === "saved") return savedTooltip(formatClock(s.savedAt), displayPath(s.ref || ref))
  if (s.kind === "failed") return s.failure.message
  if (s.kind === "unsaved" && s.target === "recovery") return "Autosave goes to a recovery file"
  return saveStatusLabel(s)
}

export function SaveStatusPill({ session }: { session: FileDocumentSession }) {
  const state = useSessionState(session)
  const pill = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const s = state.saveStatus
  const kind = s.kind as SaveStatusKind
  const platform = session.manager.platform
  const shortcut = platform.os === "macos" ? "⌘S" : "Ctrl+S"
  return (
    <>
      <Tooltip label={statusTooltip(s, state.ref)} shortcut={shortcut}>
        <SaveStatus
          ref={pill}
          kind={kind}
          label={saveStatusLabel(s)}
          aria-haspopup={s.kind === "locked" ? "dialog" : undefined}
          aria-expanded={s.kind === "locked" ? open : undefined}
          onClick={() => {
            if (s.kind === "locked") setOpen((o) => !o)
          }}
        />
      </Tooltip>
      {open && s.kind === "locked" && (
        <LockDetailsPopover
          anchor={pill.current}
          placement={{ side: "bottom", align: "end" }}
          fileName={state.fileName}
          holder={s.holder}
          onClose={() => setOpen(false)}
          onRevealLock={() => void platform.files.reveal(s.holder.lockPath).catch(() => {})}
          onRetry={() => {
            setOpen(false)
            void session.runAction("retry-lease")
          }}
        />
      )}
    </>
  )
}
