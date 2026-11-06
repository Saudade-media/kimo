/**
 * Board 46 sections 5 and 6 E: the editor banner of a workspace file (Banner R6VHG and its
 * /Warning, /Danger instances), from the workspace's plan and the copy's binding:
 *
 * - 5A plan ended, Owner (Banner/Warning): "Studio's plan ended" · "Files are read-only." · Renew.
 * - 5B plan ended, member: "Files are read-only until Maya renews." (no actions).
 * - 5C payment failed, Owner (Banner/Danger): "Update the card to keep editing." · Update card.
 * - 5D removed or left (user-minus): "You're no longer in Studio" · "This copy is read-only." ·
 *   Save a copy.
 * - 6E deleted (trash-2): "Studio was deleted" · "This copy is read-only." · Save a copy.
 *
 * Each has Dismiss (the board's Secondary Action is off); a dismissed banner comes back the next
 * day for the same file and kind.
 */

import { Banner } from "@kimo/ui"
import { useState } from "react"
import { failureText } from "../../editor/errors"
import { t } from "../../lib/i18n"
import { Icon } from "../../lib/icons"
import { roomOfKey } from "../backend"
import { firstName, type WorkspaceBannerKind, workspaceBannerKind } from "../cloud/workspace-view"
import { bindingForFile, fileOf } from "../cloud/workspaces"
import {
  useWorkspaceStore,
  useWorkspacesState,
  useWsToast,
  workspaceNameOf,
} from "./workspace-parts"

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
const keyOf = (kind: WorkspaceBannerKind, docKey: string) =>
  `kimo.cloud.ws-banner:${kind}:${docKey}`

function dismissedToday(kind: WorkspaceBannerKind, docKey: string): boolean {
  try {
    return localStorage.getItem(keyOf(kind, docKey)) === today()
  } catch {
    return false
  }
}

export interface WorkspaceBannerProps {
  /** The editor's share key: a file on disk, a browser library file, or `kimo-room:<room>`. */
  docKey: string
  /** The room the editor has open, when it is shared or joined. */
  room: string | null
  /** 5D, 6E: keeps an editable copy of the document (Save as on desktop, a library file on web). */
  onSaveCopy(): Promise<void>
}

export function WorkspaceBanner({ docKey, room, onSaveCopy }: WorkspaceBannerProps) {
  const store = useWorkspaceStore()
  const state = useWorkspacesState(store)
  const toast = useWsToast()
  const [dismissed, setDismissed] = useState<WorkspaceBannerKind | null>(null)
  const [busy, setBusy] = useState(false)
  if (!store || !state) return null

  const keyRoom = roomOfKey(docKey)
  const binding =
    bindingForFile(state, docKey) ?? (keyRoom ? (state.bindings[keyRoom] ?? null) : null)
  const at = binding?.room ?? room ?? keyRoom
  const workspaceId =
    binding?.workspaceId ??
    (at ? (state.open[at]?.workspaceId ?? fileOf(state, at)?.workspaceId ?? null) : null)
  if (!workspaceId) return null
  const w = state.workspaces.find((x) => x.id === workspaceId) ?? null
  const ended = binding && binding.ended !== null ? binding.ended : null
  const kind = workspaceBannerKind(w, ended)
  if (!kind || dismissed === kind || dismissedToday(kind, docKey)) return null
  const name = w?.name ?? workspaceNameOf(state, workspaceId) ?? "the workspace"

  const dismiss = () => {
    try {
      localStorage.setItem(keyOf(kind, docKey), today())
    } catch {
      // Private mode: dismissed until the editor closes.
    }
    setDismissed(kind)
  }
  const run = async (what: string, fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast({ tone: "danger", text: failureText(what, e) })
    } finally {
      setBusy(false)
    }
  }

  if (kind === "ended-owner" || kind === "ended-member") {
    const owner = state.details[workspaceId]?.members.find((m) => m.role === "owner") ?? null
    return (
      <Banner
        tone="warning"
        className="ws-banner"
        data-banner={kind}
        title={`${name}'s plan ended`}
        body={
          kind === "ended-owner"
            ? "Files are read-only."
            : t("ui.mp.wsbanner.readOnlyUntil", {
                owner: owner ? firstName(owner.email) : t("ui.mp.wsbanner.theOwner"),
              })
        }
        actions={
          kind === "ended-owner"
            ? [
                {
                  id: "renew",
                  label: t("ui.multiplayer.ui.workspacebanner.renew"),
                  variant: "primary",
                },
              ]
            : []
        }
        onAction={() =>
          void run(t("errors.openCheckout"), () =>
            store.checkout(workspaceId, w?.plan.interval ?? "month"),
          )
        }
        onDismiss={dismiss}
      />
    )
  }
  if (kind === "payment-failed")
    return (
      <Banner
        tone="danger"
        className="ws-banner"
        data-banner={kind}
        title={t("ui.multiplayer.ui.workspacebanner.1")}
        body="Update the card to keep editing."
        actions={[
          {
            id: "card",
            label: t("ui.multiplayer.ui.workspacebanner.update-card"),
            variant: "primary",
          },
        ]}
        onAction={() => void run(t("errors.openBilling"), () => store.openPortal(workspaceId))}
        onDismiss={dismiss}
      />
    )
  return (
    <Banner
      tone="info"
      className="ws-banner"
      data-banner={kind}
      icon={<Icon name={kind === "deleted" ? "trash-2" : "user-minus"} size={16} />}
      title={
        kind === "deleted"
          ? t("ui.mp.wsbanner.deleted", { name })
          : t("ui.mp.wsbanner.left", { name })
      }
      body="This copy is read-only."
      actions={[
        {
          id: "copy",
          label: t("ui.multiplayer.ui.workspacebanner.save-a-copy"),
          variant: "primary",
        },
      ]}
      onAction={() => void run(t("errors.saveCopy"), onSaveCopy)}
      onDismiss={dismiss}
    />
  )
}
