/**
 * Board 17 "Launch recovery · after a crash" (Fyy0m): the 02d Dialog at width 600, icon
 * `life-buoy`, Body (CrBSg: column, stroke top 1 border) of RecoveryItems; footer "Kept for 30
 * days" · Discard all · Decide later · Restore all. Esc / outside press = Decide later.
 */

import { Dialog, DialogScrim, RecoveryItem, Toast } from "@kimo/ui"
import { LifeBuoy } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import type { RecoveryCandidate, RecoveryChoice } from "../platform/contract"
import { displayPath } from "../platform/format"
import type { FileDocumentSession, FileSessionManager } from "../platform/session"

export interface RecoveryDialogViewProps {
  candidates: RecoveryCandidate[]
  /** The recovery directory, shortened ("~/.kimo/recovery"). */
  dir: string
  onChoose: (id: string, choice: RecoveryChoice) => void
  onDiscardAll: () => void
  onDecideLater: () => void
  onRestoreAll: () => void
  inline?: boolean
}

/** The dialog for a list of candidates (stateless). */
function RecoveryDialogView({
  candidates,
  dir,
  onChoose,
  onDiscardAll,
  onDecideLater,
  onRestoreAll,
  inline = false,
}: RecoveryDialogViewProps) {
  const n = candidates.length
  return (
    <Dialog
      width={600}
      inline={inline}
      data-pen="Fyy0m"
      className="kimo-files-recovery"
      icon={<LifeBuoy />}
      title="Recover unsaved changes?"
      description={`Kimo quit unexpectedly while ${n} file${n === 1 ? "" : "s"} had unsaved edits. The recovery files stay in ${dir} until you choose.`}
      footnote="Kept for 30 days"
      tertiary={{ label: "Discard all", onClick: onDiscardAll }}
      cancelLabel="Decide later"
      confirmLabel="Restore all"
      onCancel={onDecideLater}
      onConfirm={onRestoreAll}
    >
      <div className="kimo-files-recovery__body">
        {candidates.map((c) => (
          <RecoveryItem
            key={c.entry.id}
            data-recovery={c.entry.id}
            name={c.entry.name}
            badge={c.badge}
            path={c.location}
            meta={c.detail}
            untitled={c.entry.sourceRef === null}
            onSaveAs={() => onChoose(c.entry.id, "save-as")}
            onDiscard={() => onChoose(c.entry.id, "discard")}
            onRestore={() =>
              onChoose(c.entry.id, c.entry.sourceRef === null ? "save-as" : "restore")
            }
          />
        ))}
      </div>
    </Dialog>
  )
}

export interface RecoveryDialogProps {
  manager: FileSessionManager
  /** A session was opened by Restore / Save as… (navigate to it). */
  onOpened?: (session: FileDocumentSession) => void
  /**
   * Restore all opened these sessions (C3). Default: {@link onOpened} with the first. The app
   * shows the first and lists the others with {@link RestoredToasts}.
   */
  onRestoredAll?: (sessions: FileDocumentSession[]) => void
  /** The dialog closed (all resolved, or Decide later). */
  onClose?: () => void
}

/**
 * Launch recovery, modal. Mount once at app start (Home or the first editor window); renders
 * nothing when there are no candidates.
 */
export function RecoveryDialog({ manager, onOpened, onRestoredAll, onClose }: RecoveryDialogProps) {
  const [candidates, setCandidates] = useState<RecoveryCandidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    const list = await manager.recoveryCandidates()
    setCandidates(list)
    if (list.length === 0) onClose?.()
  }, [manager, onClose])
  useEffect(() => {
    void refresh()
  }, [refresh])
  if (!candidates || candidates.length === 0) return null
  const dir = displayPath(manager.platform.recovery.dir ?? "~/.kimo/recovery")
  // A failing choice keeps the dialog (the entry is still there) and says why.
  const run = (p: Promise<unknown>) =>
    void p.then(
      () => {
        setError(null)
        return refresh()
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
        return refresh()
      },
    )
  return (
    <DialogScrim>
      {error && (
        <div className="kimo-files-toasts kimo-files-toasts--dialog" aria-live="polite">
          <Toast tone="danger" data-toast="recovery-error">
            {error}
          </Toast>
        </div>
      )}
      <RecoveryDialogView
        candidates={candidates}
        dir={dir}
        onChoose={(id, choice) =>
          run(
            manager.resolveRecovery(id, choice).then((s) => {
              if (s) onOpened?.(s)
            }),
          )
        }
        onDiscardAll={() => run(manager.resolveRecoveryDialog("discard-all"))}
        onDecideLater={() => {
          setCandidates([])
          onClose?.()
        }}
        onRestoreAll={() =>
          run(
            manager.resolveRecoveryDialog("restore-all").then((opened) => {
              if (opened.length === 0) return
              if (onRestoredAll) onRestoredAll(opened)
              else onOpened?.(opened[0] as FileDocumentSession)
            }),
          )
        }
      />
    </DialogScrim>
  )
}

export interface RestoredToastsProps {
  manager: FileSessionManager
  /** Restored sessions the window is not showing yet. */
  sessions: FileDocumentSession[]
  onOpen: (session: FileDocumentSession) => void
}

/**
 * C3: after Restore all, one toast per restored document the window does not show, each with
 * Open. A toast leaves once its document is opened or closed.
 */
export function RestoredToasts({ manager, sessions, onOpen }: RestoredToastsProps) {
  const [, setTick] = useState(0)
  useEffect(() => manager.subscribe(() => setTick((n) => n + 1)), [manager])
  const live = new Set(manager.sessions())
  const shown = sessions.filter((s) => live.has(s))
  if (shown.length === 0) return null
  return (
    <div className="kimo-files-toasts kimo-files-toasts--restored" aria-live="polite">
      {shown.map((s) => (
        <Toast
          key={s.ref}
          data-toast="restored"
          data-ref={s.ref}
          actionLabel="Open"
          onAction={() => onOpen(s)}
        >
          {`Restored ${s.fileName}`}
        </Toast>
      ))}
    </div>
  )
}
