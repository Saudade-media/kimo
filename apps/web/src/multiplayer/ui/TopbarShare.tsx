/**
 * Board 41 sections 1 and 2: the editor topbar while a file is shared.
 *
 * - {@link TopbarSyncStatus}: SaveStatus in the slot of "Saved locally" (rules row "Sync status",
 *   prop `topbar-sync`): Synced, Syncing… (after 600 ms), Sharing N images, Reconnecting…
 *   (Paused), Offline · edits kept (ReadOnly), View only (ReadOnly, eye). Not shared: `fallback`.
 * - {@link TopbarShare}: the avatar stack (`presence-stack`: Avatar 24, overlap 4, 2 px bg-app
 *   ring, max 3 then +N, join order, you excluded, 0.5 while the relay is gone; opens the people
 *   list) and the Share button (`topbar-share`: Button/Secondary "Share" with users, live
 *   Button/Soft "Sharing" with radio, hidden for viewers and guests; opens the Share popover,
 *   right edge on the button's). Both sit after Theme, before Preview.
 */
import { Button, SaveStatus, Tooltip } from "@kimo/ui"
import { type ReactNode, useRef, useState } from "react"
import { Icon } from "../../lib/icons"
import { useCapabilities, useCollaborators, useMultiplayer, useShareState } from "../hooks"
import type { MultiplayerModel } from "../model"
import { stackDimmed, stackOf, syncStatusView } from "./copy"
import { PeoplePopover } from "./PeoplePopover"
import { ResetLinksDialog } from "./ResetLinksDialog"
import { SharePopover } from "./SharePopover"
import { PresenceAvatar } from "./shared"
import "./share-ui.css"

export interface TopbarSyncStatusProps {
  /** The document key (the file's ref). */
  docKey: string
  /** What shows while the file is not shared (the Save Status pill). */
  fallback: ReactNode
  model?: MultiplayerModel | null
}

export function TopbarSyncStatus({ docKey, fallback, model: given }: TopbarSyncStatusProps) {
  const runtime = useMultiplayer()
  const model = given ?? runtime
  if (!model) return <>{fallback}</>
  return <SyncStatusFor model={model} docKey={docKey} fallback={fallback} />
}

function SyncStatusFor({
  model,
  docKey,
  fallback,
}: {
  model: MultiplayerModel
  docKey: string
  fallback: ReactNode
}) {
  const share = useShareState(model, docKey)
  if (share.relay === null) return <>{fallback}</>
  const view = syncStatusView(share.relay, share.uploading)
  return (
    <Tooltip label={view.tooltip}>
      <SaveStatus
        kind={view.kind}
        label={view.label}
        icon={<Icon name={view.icon} size={14} />}
        className="mp-sync-status"
        data-relay={share.relay}
      />
    </Tooltip>
  )
}

export interface TopbarShareProps {
  docKey: string
  model?: MultiplayerModel | null
  /** Layer names for "editing Hero Image" in the people list. */
  nodeName?: (id: string) => string | null
  /** An agent row's eye: shows the layers it claims. */
  onRevealNodes?: (ids: readonly string[]) => void
}

export function TopbarShare({ docKey, model: given, ...rest }: TopbarShareProps) {
  const runtime = useMultiplayer()
  const model = given ?? runtime
  if (!model) return null
  return <ShareCluster model={model} docKey={docKey} {...rest} />
}

function ShareCluster({
  model,
  docKey,
  nodeName,
  onRevealNodes,
}: TopbarShareProps & { model: MultiplayerModel }) {
  const share = useShareState(model, docKey)
  const people = useCollaborators(model, docKey)
  const caps = useCapabilities(model, docKey)
  const [open, setOpen] = useState<"share" | "people" | "reset" | null>(null)
  const shareButton = useRef<HTMLButtonElement>(null)
  const stackButton = useRef<HTMLButtonElement>(null)
  const others = people.filter((p) => !p.isYou)
  const shared = share.room !== null
  const live = shared && share.status !== "error"
  const { shown, more } = stackOf(others)
  const close = () => setOpen(null)
  return (
    <>
      {shared && others.length > 0 && (
        <button
          ref={stackButton}
          type="button"
          className={`mp-stack${stackDimmed(share.relay) ? " mp-stack--dim" : ""}`}
          aria-label={`${others.length} ${others.length === 1 ? "person" : "people"} in this file`}
          aria-haspopup="dialog"
          aria-expanded={open === "people"}
          data-pen="Pxomg"
          onClick={() => setOpen((o) => (o === "people" ? null : "people"))}
        >
          {shown.map((p) => (
            <PresenceAvatar key={p.id} label={p.label} color={p.color} />
          ))}
          {more > 0 && (
            <span className="mp-stack__more" aria-hidden="true">
              +{more}
            </span>
          )}
        </button>
      )}
      {caps.canShare && (
        <Button
          ref={shareButton}
          variant={live ? "soft" : "secondary"}
          className="mp-share-button"
          icon={<Icon name={live ? "radio" : "users"} size={16} />}
          aria-haspopup="dialog"
          aria-expanded={open === "share"}
          data-shared={live || undefined}
          onClick={() => setOpen((o) => (o === "share" ? null : "share"))}
        >
          {live ? "Sharing" : "Share"}
        </Button>
      )}
      {open === "share" && caps.canShare && (
        <SharePopover
          model={model}
          docKey={docKey}
          anchor={shareButton.current}
          onClose={() => {
            close()
            shareButton.current?.focus({ preventScroll: true })
          }}
          onResetAll={() => setOpen("reset")}
        />
      )}
      {open === "reset" && (
        <ResetLinksDialog
          model={model}
          docKey={docKey}
          // Escape and Cancel keep everything: back to the popover.
          onCancel={() => setOpen("share")}
          onDone={() => setOpen("share")}
        />
      )}
      {open === "people" && others.length > 0 && (
        <PeoplePopover
          model={model}
          docKey={docKey}
          anchor={stackButton.current}
          {...(nodeName ? { nodeName } : {})}
          {...(onRevealNodes ? { onRevealNodes } : {})}
          onClose={() => {
            close()
            stackButton.current?.focus({ preventScroll: true })
          }}
        />
      )}
    </>
  )
}
