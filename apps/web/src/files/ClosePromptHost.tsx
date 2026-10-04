/**
 * Board 24 (i) "Untitled file · close prompt" (a3Y0Fb): while a never-saved document is being
 * closed (tab ×, ⌘W, window close → `FileDocumentSession.confirmClose`), the modal asks
 * Save… / Don't save / Cancel. State-driven like the migration dialog: renders nothing unless
 * `SessionState.closePrompt` is set. {@link BannerHost} mounts it, so every editor of a file on
 * disk (untitled documents included) has it without another mount point.
 */
import { ClosePrompt, DialogScrim } from "@kimo/ui"
import type { FileDocumentSession } from "../platform/session"
import { useSessionState } from "./hooks"

export function ClosePromptHost({ session }: { session: FileDocumentSession }) {
  const { closePrompt } = useSessionState(session)
  if (!closePrompt) return null
  return (
    <DialogScrim>
      <ClosePrompt
        fileName={closePrompt.fileName}
        frames={closePrompt.frames}
        data-testid="close-prompt"
        onSave={() => session.respondToClose("save")}
        onDiscard={() => session.respondToClose("discard")}
        onCancel={() => session.respondToClose("cancel")}
      />
    </DialogScrim>
  )
}
