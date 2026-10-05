/**
 * Board 34 "Auto-approve Confirm" (k0K1nN): ConfirmDialog, warning tone, in the modal scrim.
 * Asked once each time auto-approve is turned on (the built-in agent's session switch and an MCP
 * client's Permissions toggle); turning it off never asks.
 */
import { ConfirmDialog } from "@kimo/ui"
import { File, Lock, ShieldCheck, SquareDashed, Undo2 } from "lucide-react"
import "./auto-approve.css"

export interface AutoApproveConfirmProps {
  /** Omitted: the built-in agent's session. Else the MCP client's label ("Codex"). */
  client?: string
  onConfirm(): void
  onCancel(): void
}

/** Title, description and impact lines (exported for tests and docs). */
export function autoApproveCopy(client?: string) {
  return {
    title: client ? `Turn on auto-approve for ${client}?` : "Turn on auto-approve?",
    description: client
      ? `Kimo stops asking before ${client} acts. Every request is approved at once and listed in Activity.`
      : "Kimo stops asking in this session. Every request is approved at once and listed in the thread and in Activity.",
    impact: [
      "Opening, creating, saving and exporting files",
      client
        ? "Edits outside its permissions and document-wide changes"
        : "Edits outside its area and document-wide changes",
      "Canvas edits stay undoable. Kimo can't undo a file it wrote",
      client
        ? "Still enforced: 40 new layers per edit, path checks and read-only files"
        : "Still enforced: 40 new layers per edit, path checks and helper agents' areas",
    ],
  }
}

const ICONS = [File, SquareDashed, Undo2, Lock]

export function AutoApproveConfirm({ client, onConfirm, onCancel }: AutoApproveConfirmProps) {
  const copy = autoApproveCopy(client)
  return (
    <div
      className="kimo-dialog-scrim"
      data-testid="auto-approve-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <ConfirmDialog
        className="auto-approve-confirm"
        data-testid="auto-approve-confirm"
        data-pen="k0K1nN"
        tone="warning"
        icon={<ShieldCheck />}
        title={copy.title}
        description={copy.description}
        impact={copy.impact.map((text, i) => {
          const Icon = ICONS[i] ?? Lock
          return { icon: <Icon />, tone: "tertiary" as const, text }
        })}
        confirmLabel="Turn on"
        onConfirm={() => onConfirm()}
        onCancel={onCancel}
      />
    </div>
  )
}
