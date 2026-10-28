/**
 * Board 41 sections 1 and 2: the editor topbar while a file is shared.
 *
 * - {@link TopbarSyncStatus}: SaveStatus in the slot of "Saved locally" (rules row "Sync status",
 *   prop `topbar-sync`): Synced, Syncing… (after 600 ms), Reconnecting… (Paused), Offline · edits
 *   kept (ReadOnly), View only (ReadOnly, eye), and while assets move (section 8 E, edits first)
 *   Sharing N images (Saving, arrow-up) or Fetching N images (arrow-down). Not shared: `fallback`.
 * - {@link TopbarShare}: the avatar stack (`presence-stack`: Avatar 24, overlap 4, 2 px bg-app
 *   ring, max 3 then +N, join order, you excluded, 0.5 while the relay is gone; opens the people
 *   list) and the Share button (`topbar-share`: Button/Secondary "Share" with users, live
 *   Button/Soft "Sharing" with radio, hidden for viewers and guests; opens the Share popover,
 *   right edge on the button's). Both sit after Theme, before Preview.
 */
import { Button, SaveStatus, Tooltip } from "@kimo/ui"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Icon } from "../../lib/icons"
import { useOptionalRuntime } from "../../platform/runtime"
import { shareableWorkspaces } from "../cloud/workspaces"
import {
  useAssetTransfers,
  useCapabilities,
  useCollaborators,
  useMultiplayer,
  useShareState,
} from "../hooks"
import type { MultiplayerModel } from "../model"
import { useCloudState, useRelaySetupServices } from "../relay-setup/services"
import { stackDimmed, stackOf, topbarSyncStatus } from "./copy"
import { NewWorkspaceWizard } from "./NewWorkspace"
import { PeoplePopover } from "./PeoplePopover"
import { RelayWizard, type WizardStart } from "./RelayWizard"
import { ResetLinksDialog } from "./ResetLinksDialog"
import { SharePopover } from "./SharePopover"
import { PresenceAvatar } from "./shared"
import { InviteDialog } from "./WorkspaceDialogs"
import { useCloudShareKind, useShareableSession } from "./WorkspaceShare"
import { useWorkspaceStore, useWorkspacesState } from "./workspace-parts"
import "./share-ui.css"

export interface TopbarSyncStatusProps {
  /** The document key (the file's ref). */
  docKey: string
  /** What shows while the file is not shared (the Save Status pill). */
  fallback: ReactNode
  model?: MultiplayerModel | null
  /**
   * Board 44 card header: a shared file that is Synced with no images moving shows `fallback`
   * instead (the header only carries a status that needs attention).
   */
  quietWhenSynced?: boolean
}

export function TopbarSyncStatus({
  docKey,
  fallback,
  model: given,
  quietWhenSynced = false,
}: TopbarSyncStatusProps) {
  const runtime = useMultiplayer()
  const model = given ?? runtime
  if (!model) return <>{fallback}</>
  return (
    <SyncStatusFor
      model={model}
      docKey={docKey}
      fallback={fallback}
      quietWhenSynced={quietWhenSynced}
    />
  )
}

function SyncStatusFor({
  model,
  docKey,
  fallback,
  quietWhenSynced,
}: {
  model: MultiplayerModel
  docKey: string
  fallback: ReactNode
  quietWhenSynced: boolean
}) {
  const share = useShareState(model, docKey)
  const transfers = useAssetTransfers(model, docKey)
  if (share.relay === null) return <>{fallback}</>
  const view = topbarSyncStatus(share.relay, transfers)
  if (
    quietWhenSynced &&
    view.moving === null &&
    (share.relay === "synced" || share.relay === "saving")
  )
    return <>{fallback}</>
  return (
    <Tooltip label={view.tooltip}>
      <SaveStatus
        kind={view.kind}
        label={view.label}
        icon={<Icon name={view.icon} size={14} />}
        className="mp-sync-status"
        data-relay={share.relay}
        data-moving={view.moving ?? undefined}
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
  /**
   * Board 44 Right Card header (People): the idle Share is the accent "Share" without an icon
   * (1NtIQbmrdA); live sharing keeps Button/Soft "Sharing" with radio (board 41).
   */
  card?: boolean
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
  card = false,
}: TopbarShareProps & { model: MultiplayerModel }) {
  const share = useShareState(model, docKey)
  const people = useCollaborators(model, docKey)
  const caps = useCapabilities(model, docKey)
  const [open, setOpen] = useState<
    "share" | "people" | "reset" | "relay" | "invite" | "new-workspace" | null
  >(null)
  const [wizardStart, setWizardStart] = useState<WizardStart>("choose")
  const runtime = useOptionalRuntime()
  const relaySetup = useRelaySetupServices(runtime?.platform ?? null)
  const cloudState = useCloudState(relaySetup?.cloud ?? null)
  const workspaceStore = useWorkspaceStore()
  const workspacesState = useWorkspacesState(workspaceStore)
  /** The workspace Invite people (board 46 2B) is for. */
  const [inviteTo, setInviteTo] = useState<string | null>(null)
  const inviteWorkspace = workspacesState?.workspaces.find((w) => w.id === inviteTo) ?? null
  /** The workspace New workspace (board 46 1F) made: 1B's picker starts on it. */
  const [madeWorkspace, setMadeWorkspace] = useState<string | null>(null)
  const shareButton = useRef<HTMLButtonElement>(null)
  const stackButton = useRef<HTMLButtonElement>(null)
  const others = people.filter((p) => !p.isYou)
  const shared = share.room !== null
  // Board 46: a workspace file's members and a view link's guest on Kimo Cloud get Share too.
  const cloudKind = useCloudShareKind(model, docKey)
  const sessionOf = useShareableSession(docKey)
  const canShare = caps.canShare || cloudKind !== null
  const live = shared && share.status !== "error" && (caps.canShare || cloudKind?.kind === "member")
  const { shown, more } = stackOf(others)
  const close = () => setOpen(null)
  // A view-link guest who signed in from Request edit access (board 46 1D) goes back to the
  // popover, which can now send the request, rather than on to the wizard's plan step.
  const signedIn = cloudState?.session === "signed-in"
  useEffect(() => {
    if (open === "relay" && wizardStart === "sign-in" && cloudKind?.kind === "guest" && signedIn)
      setOpen("share")
  }, [open, wizardStart, cloudKind?.kind, signedIn])
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
      {canShare && (
        <Button
          ref={shareButton}
          variant={live ? "soft" : card ? "primary" : "secondary"}
          className={card ? "mp-share-button mp-share-button--card" : "mp-share-button"}
          {...(live || !card ? { icon: <Icon name={live ? "radio" : "users"} size={16} /> } : {})}
          aria-haspopup="dialog"
          aria-expanded={open === "share"}
          data-shared={live || undefined}
          onClick={() => setOpen((o) => (o === "share" ? null : "share"))}
        >
          {live ? "Sharing" : "Share"}
        </Button>
      )}
      {open === "share" && canShare && (
        <SharePopover
          model={model}
          docKey={docKey}
          anchor={shareButton.current}
          onClose={() => {
            close()
            shareButton.current?.focus({ preventScroll: true })
          }}
          onResetAll={() => setOpen("reset")}
          onInvite={(workspaceId) => {
            setInviteTo(workspaceId)
            setOpen("invite")
          }}
          {...(relaySetup?.cloud && workspaceStore
            ? { onNewWorkspace: () => setOpen("new-workspace") }
            : {})}
          pickedWorkspace={madeWorkspace}
          {...(relaySetup
            ? {
                onSetUpRelay: (start: WizardStart = "choose") => {
                  setWizardStart(start)
                  setOpen("relay")
                },
              }
            : {})}
        />
      )}
      {open === "relay" && relaySetup && (
        <RelayWizard
          services={relaySetup}
          from="share"
          start={wizardStart}
          displayName={model.settings.getState().displayName}
          saveRelayUrl={(u) => model.settings.setRelayUrl(u)}
          onStartSharing={async (relayUrl) => {
            // Board 46: on Kimo Cloud a file goes into a workspace (the popover picks one when
            // there are several); a relay of your own still starts its own room.
            const ws = runtime?.workspaces ?? null
            const session = sessionOf()
            const cloudPath = relaySetup?.store.getState().path === "cloud"
            if (ws && session && cloudPath && shareableWorkspaces(ws.getState()).length > 0)
              await ws.shareFile(session)
            else await model.document(docKey).startSharing({ relayUrl })
            setOpen("share")
          }}
          onClose={() => {
            setOpen((o) => (o === "relay" ? null : o))
            shareButton.current?.focus({ preventScroll: true })
          }}
        />
      )}
      {open === "new-workspace" && (
        <NewWorkspaceWizard
          // Close goes back to the popover; a paid checkout too, with the new workspace picked.
          onClose={() => setOpen("share")}
          onCreated={(id) => {
            setMadeWorkspace(id)
            setOpen("share")
          }}
        />
      )}
      {open === "invite" && workspaceStore && inviteWorkspace && (
        <InviteDialog
          store={workspaceStore}
          workspace={inviteWorkspace}
          plans={cloudState?.plans.plans ?? []}
          // Cancel and Send invite both go back to the popover, like Reset all links.
          onClose={() => setOpen("share")}
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
