/**
 * Board 17 "Migration consent · older format" (UuonK): the 02d Dialog (rendered 672 wide in
 * its column), icon `file-up`; Body (ciVuJ: column, gap 8) = Impact (EDDii: bg-subtle,
 * radius-md, column, gap 8, padding [10, 12]; items row gap 8: icon 14 + sans 11 text-secondary
 * line-height 1.45) + Format Line (GTLQL: row, gap 8, padding [0, 4], center: mono 11
 * `format` tertiary, `"0.2"` secondary, `arrow-right` 12 tertiary, `"0.4"` primary / 500).
 * Footer: "⌘S also counts as consent" · Open read-only · Upgrade and save. Esc = read-only.
 */
import type { HostOS } from "@kimo/platform"
import { Dialog, DialogScrim } from "@kimo/ui"
import { ArrowRight, FilePen, FileUp, History, ShieldCheck } from "lucide-react"
import type { MigrationConsentRequest } from "../platform/contract"
import type { FileDocumentSession } from "../platform/session"
import { useSessionState } from "./hooks"

/** "0.4" → "0.3" (the teammates who should update first); null for x.0. */
function previousMinor(format: string): string | null {
  const m = /^(\d+)\.(\d+)$/.exec(format)
  if (!m || Number(m[2]) === 0) return null
  return `${m[1]}.${Number(m[2]) - 1}`
}

export interface MigrationDialogViewProps {
  request: MigrationConsentRequest
  os: HostOS
  onUpgrade: () => void
  onReadOnly: () => void
  inline?: boolean
}

/** The consent dialog for a request (stateless). */
export function MigrationDialogView({
  request: r,
  os,
  onUpgrade,
  onReadOnly,
  inline = false,
}: MigrationDialogViewProps) {
  const prev = previousMinor(r.minimumReader)
  return (
    <Dialog
      width={672}
      inline={inline}
      data-pen="UuonK"
      className="kimo-files-migration"
      icon={<FileUp />}
      title={`Upgrade ${r.fileName} to format ${r.toFormat}?`}
      description={`It was saved by an older Kimo (format ${r.fromFormat}) and opened migrated in memory. Nothing has been written to it yet.`}
      footnote={`${os === "macos" ? "⌘S" : "Ctrl+S"} also counts as consent`}
      cancelLabel="Open read-only"
      confirmLabel="Upgrade and save"
      onCancel={onReadOnly}
      onConfirm={onUpgrade}
    >
      <div className="kimo-files-migration__body">
        <div className="kimo-files-migration__impact">
          <div className="kimo-files-migration__item">
            <FilePen className="kimo-files-migration__icon kimo-files-migration__icon--primary" />
            <span className="kimo-files-migration__text">
              Upgrading rewrites the file on disk: the format line plus the fields the migration
              changes (about {r.approxChangedLines} lines in git).
            </span>
          </div>
          <div className="kimo-files-migration__item">
            <History className="kimo-files-migration__icon" />
            <span className="kimo-files-migration__text">
              Kimo older than {r.minimumReader} will no longer open it.
              {prev ? ` Teammates on ${prev} should update first.` : ""}
            </span>
          </div>
          <div className="kimo-files-migration__item">
            <ShieldCheck className="kimo-files-migration__icon" />
            <span className="kimo-files-migration__text">
              Until you choose, autosave goes to a recovery file — never to {r.fileName}.
            </span>
          </div>
        </div>
        <div className="kimo-files-migration__format">
          <span className="kimo-files-migration__format-label">format</span>
          <span className="kimo-files-migration__format-from">"{r.fromFormat}"</span>
          <ArrowRight className="kimo-files-migration__arrow" aria-hidden="true" />
          <span className="kimo-files-migration__format-to">"{r.toFormat}"</span>
        </div>
      </div>
    </Dialog>
  )
}

/** Modal while the session waits for consent (phase `needs-consent`). */
export function MigrationDialog({ session }: { session: FileDocumentSession }) {
  const state = useSessionState(session)
  if (!state.consent) return null
  return (
    <DialogScrim>
      <MigrationDialogView
        request={state.consent}
        os={session.manager.platform.os}
        onUpgrade={() => void session.respondToConsent("upgrade")}
        onReadOnly={() => void session.respondToConsent("read-only")}
      />
    </DialogScrim>
  )
}
