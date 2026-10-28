/**
 * Board 46 1F from New workspace: 1B's New workspace row, Home's KIMO CLOUD plus and Settings ›
 * Workspace's "New workspace…" open the relay wizard's Subscribe step with the workspace's name
 * (`RelayWizard` `newWorkspace`). The workspace store's `createWorkspace` makes it, with one seat
 * (you), and its checkout follows; `onCreated` gets it once the checkout went through, and the
 * caller selects it. Closing before that leaves the workspace without a plan.
 */
import { useRef } from "react"
import { failureText } from "../../editor/errors"
import { useOptionalRuntime } from "../../platform/runtime"
import { useRelaySetupServices } from "../relay-setup/services"
import { type NewWorkspaceFlow, RelayWizard } from "./RelayWizard"
import { useWorkspaceStore, useWsToast } from "./workspace-parts"

export function NewWorkspaceWizard({
  onClose,
  onCreated,
}: {
  onClose(): void
  onCreated(workspaceId: string): void
}) {
  const runtime = useOptionalRuntime()
  const services = useRelaySetupServices(runtime?.platform ?? null)
  const store = useWorkspaceStore()
  const toast = useWsToast()
  /** The workspace this sheet made: a second Continue renames it rather than making another. */
  const made = useRef<{ id: string; name: string } | null>(null)
  /** The call in flight: a second press while it runs waits for it instead of making another. */
  const running = useRef<Promise<string> | null>(null)
  if (!services?.cloud || !store) return null
  const make = async (name: string) => {
    try {
      const m = made.current
      if (!m) {
        const w = await store.createWorkspace(name)
        made.current = { id: w.id, name }
        return w.id
      }
      if (m.name !== name) {
        await store.renameWorkspace(m.id, name)
        m.name = name
      }
      return m.id
    } catch (e) {
      toast({ tone: "danger", text: failureText("create the workspace", e) })
      throw e
    }
  }
  const flow: NewWorkspaceFlow = {
    create(name) {
      running.current ??= make(name).finally(() => {
        running.current = null
      })
      return running.current
    },
    onDone: onCreated,
  }
  return (
    <RelayWizard
      services={services}
      from="settings"
      newWorkspace={flow}
      // This sheet saves no relay: the account's Kimo Cloud relay stays as it is.
      saveRelayUrl={async () => null}
      onClose={onClose}
    />
  )
}
