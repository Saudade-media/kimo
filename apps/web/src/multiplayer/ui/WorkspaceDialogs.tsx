/**
 * Board 46 dialogs, each a `Dialog` (bDVhS: 480, gap 14, padding 20) over a scrim on `body`:
 *
 * - 2B Invite (user-plus): Input · Email (mail), Row · Role (Select 140 × 28), Price (receipt,
 *   "+$4 a month once they join"); Cancel · Send invite.
 * - 2C Remove a member (user-minus): the view links they made, when there are any; Remove (danger).
 *   Done: Toast "Sam Kim removed" (2D).
 * - 6A Transfer (crown): Row · New owner with a Select (160 × 28) of the Admins; Send request.
 * - 6B Accept ownership (crown): no body; Decline · Subscribe (opens checkout, seats locked).
 * - 6D Delete workspace (trash-2): Input · Confirm name (type), "Type Studio to confirm"; Delete
 *   workspace (danger) once the name matches exactly.
 * - 6F Leave (log-out): no body; Leave (danger).
 *
 * The component's Footnote (POSht) is hidden on the board, so none is shown.
 */
import { Dialog, DialogScrim, Input, Select } from "@kimo/ui"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { failureText } from "../../editor/errors"
import { Icon } from "../../lib/icons"
import type { Member, MemberRole, PlanPrice, WorkspaceSummary } from "../cloud/types"
import {
  firstName,
  inviteCostLine,
  personName,
  removeDesc,
  seatPrice,
  transferPriceLine,
} from "../cloud/workspace-view"
import type { WorkspaceStore } from "../cloud/workspaces"
import { useWsToast } from "./workspace-parts"

const ROLE_OPTIONS = [
  { value: "editor" as const, label: "Editor" },
  { value: "admin" as const, label: "Admin" },
]

const onBody = (node: ReactNode) =>
  createPortal(<DialogScrim className="rw-scrim ws-scrim">{node}</DialogScrim>, document.body)

// --- 2B ------------------------------------------------------------------------------------------

export function InviteDialog({
  store,
  workspace,
  plans,
  onClose,
}: {
  store: WorkspaceStore
  workspace: WorkspaceSummary
  plans: readonly PlanPrice[]
  onClose(): void
}) {
  const toast = useWsToast()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<MemberRole>("editor")
  const [busy, setBusy] = useState(false)
  const price = seatPrice(plans, workspace.plan.interval)
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const send = async () => {
    if (!ok || busy) return
    setBusy(true)
    try {
      await store.invite(workspace.id, email.trim(), role)
      onClose()
    } catch (e) {
      toast({ tone: "danger", text: failureText("send the invite", e) })
    } finally {
      setBusy(false)
    }
  }
  return onBody(
    <Dialog
      className="ws-dialog"
      data-dialog="invite"
      icon={<Icon name="user-plus" size={16} />}
      title={`Invite to ${workspace.name}`}
      description="We'll email them an invite."
      confirmLabel="Send invite"
      confirmDisabled={!ok || busy}
      onCancel={onClose}
      onConfirm={() => void send()}
    >
      <div className="ws-dialog__body">
        <Input
          aria-label="Email"
          type="email"
          icon={<Icon name="mail" size={16} />}
          autoComplete="off"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send()
          }}
        />
        <div className="ws-dialog__row">
          <span className="ws-dialog__row-label">Role</span>
          <Select
            className="ws-select ws-select--140"
            label="Role"
            options={ROLE_OPTIONS}
            value={role}
            onChange={setRole}
          />
        </div>
        {price && (
          <div className="ws-price">
            <span className="ws-price__icon" aria-hidden="true">
              <Icon name="receipt" size={14} />
            </span>
            <span className="ws-price__text">{inviteCostLine(price, workspace.plan.interval)}</span>
          </div>
        )}
      </div>
    </Dialog>,
  )
}

// --- 2C ------------------------------------------------------------------------------------------

export function RemoveMemberDialog({
  store,
  workspace,
  member,
  onClose,
}: {
  store: WorkspaceStore
  workspace: WorkspaceSummary
  member: Member
  onClose(): void
}) {
  const toast = useWsToast()
  const [links, setLinks] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  // The view links they made: shown before removing, filled in when the list answers.
  useEffect(() => {
    let live = true
    store
      .listLinks(workspace.id)
      .then((all) => {
        if (!live) return
        setLinks(
          all
            .filter((l) => l.createdBy === member.email)
            .map((l) => l.fileName ?? l.label ?? "View link"),
        )
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [store, workspace.id, member.email])
  const name = personName(member.email)
  const remove = async () => {
    if (busy) return
    setBusy(true)
    try {
      await store.removeMember(workspace.id, member.account)
      onClose()
      toast({ tone: "success", text: `${name} removed` })
    } catch (e) {
      setBusy(false)
      toast({ tone: "danger", text: failureText(`remove ${name}`, e) })
    }
  }
  return onBody(
    <Dialog
      className="ws-dialog"
      data-dialog="remove-member"
      icon={<Icon name="user-minus" size={16} />}
      title={`Remove ${name}?`}
      description={removeDesc(member.email, workspace.plan)}
      confirmLabel="Remove"
      confirmTone="danger"
      confirmDisabled={busy}
      onCancel={onClose}
      onConfirm={() => void remove()}
    >
      {links.length > 0 ? (
        <div className="ws-dialog__body">
          <span className="ws-label">{`View links ${firstName(member.email)} made will stop working:`}</span>
          <ul className="ws-list ws-ended-links">
            {links.map((label, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: two links may share a file name
              <li key={i} className="ws-ended-link">
                <span className="ws-ended-link__icon" aria-hidden="true">
                  <Icon name="link" size={14} />
                </span>
                <span className="ws-ended-link__label">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>,
  )
}

// --- 6A ------------------------------------------------------------------------------------------

export function TransferDialog({
  store,
  workspace,
  admins,
  onClose,
}: {
  store: WorkspaceStore
  workspace: WorkspaceSummary
  admins: readonly Member[]
  onClose(): void
}) {
  const toast = useWsToast()
  const [to, setTo] = useState<string | null>(admins[0]?.account ?? null)
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!to || busy) return
    setBusy(true)
    try {
      await store.requestTransfer(workspace.id, to)
      onClose()
    } catch (e) {
      setBusy(false)
      toast({ tone: "danger", text: failureText("send the request", e) })
    }
  }
  return onBody(
    <Dialog
      className="ws-dialog"
      data-dialog="transfer"
      icon={<Icon name="crown" size={16} />}
      title={`Transfer ${workspace.name}`}
      description={`The new Owner pays for ${workspace.name}. Your plan ends once they subscribe.`}
      confirmLabel="Send request"
      confirmDisabled={!to || busy}
      onCancel={onClose}
      onConfirm={() => void send()}
    >
      <div className="ws-dialog__body">
        <div className="ws-dialog__row">
          <span className="ws-dialog__row-label">New owner</span>
          <Select
            className="ws-select ws-select--160"
            label="New owner"
            options={admins.map((a) => ({ value: a.account, label: personName(a.email) }))}
            value={to}
            onChange={setTo}
          />
        </div>
      </div>
    </Dialog>,
  )
}

// --- 6B ------------------------------------------------------------------------------------------

/**
 * Shown by the app host while the workspace summary names this account. Escape and a press
 * outside only hide it until the next refresh: Decline is the only way to decline.
 */
export function AcceptTransferDialog({
  store,
  workspace,
  onHide,
}: {
  store: WorkspaceStore
  workspace: WorkspaceSummary
  onHide(): void
}) {
  const toast = useWsToast()
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>(".kimo-dialog__button--confirm")?.focus()
  }, [])
  const t = workspace.transfer
  if (!t) return null
  const run = async (what: "accept" | "decline") => {
    if (busy) return
    setBusy(true)
    try {
      if (what === "accept") await store.acceptTransfer(workspace.id)
      else await store.declineTransfer(workspace.id)
    } catch (e) {
      toast({
        tone: "danger",
        text: failureText(what === "accept" ? "open checkout" : "decline", e),
      })
    } finally {
      setBusy(false)
    }
  }
  return onBody(
    <div
      className="ws-dialog-hold"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onHide()
      }}
    >
      <Dialog
        ref={root}
        inline
        className="ws-dialog"
        data-dialog="accept-transfer"
        aria-modal="true"
        icon={<Icon name="crown" size={16} />}
        title={`${firstName(t.from)} wants you to own ${workspace.name}`}
        description={transferPriceLine(t)}
        cancelLabel="Decline"
        confirmLabel="Subscribe"
        confirmDisabled={busy}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            onHide()
          }
        }}
        onCancel={() => void run("decline")}
        onConfirm={() => void run("accept")}
      />
    </div>,
  )
}

// --- 6D ------------------------------------------------------------------------------------------

export function DeleteWorkspaceDialog({
  store,
  workspace,
  onClose,
  onDeleted,
}: {
  store: WorkspaceStore
  workspace: WorkspaceSummary
  onClose(): void
  onDeleted?(): void
}) {
  const toast = useWsToast()
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const match = typed === workspace.name
  const remove = async () => {
    if (!match || busy) return
    setBusy(true)
    try {
      await store.deleteWorkspace(workspace.id, typed)
      onClose()
      onDeleted?.()
    } catch (e) {
      setBusy(false)
      toast({ tone: "danger", text: failureText(`delete ${workspace.name}`, e) })
    }
  }
  return onBody(
    <Dialog
      className="ws-dialog"
      data-dialog="delete-workspace"
      icon={<Icon name="trash-2" size={16} />}
      title={`Delete ${workspace.name}?`}
      description="Files close for everyone now. Members keep read-only copies."
      confirmLabel="Delete workspace"
      confirmTone="danger"
      confirmDisabled={!match || busy}
      onCancel={onClose}
      onConfirm={() => void remove()}
    >
      <div className="ws-dialog__body">
        <Input
          aria-label="Workspace name"
          icon={<Icon name="type" size={16} />}
          placeholder={`Type ${workspace.name} to confirm`}
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void remove()
          }}
        />
      </div>
    </Dialog>,
  )
}

// --- 6F ------------------------------------------------------------------------------------------

export function LeaveDialog({
  store,
  workspace,
  onClose,
  onLeft,
}: {
  store: WorkspaceStore
  workspace: WorkspaceSummary
  onClose(): void
  onLeft?(): void
}) {
  const toast = useWsToast()
  const [busy, setBusy] = useState(false)
  const leave = async () => {
    if (busy) return
    setBusy(true)
    try {
      await store.leave(workspace.id)
      onClose()
      onLeft?.()
    } catch (e) {
      setBusy(false)
      toast({ tone: "danger", text: failureText(`leave ${workspace.name}`, e) })
    }
  }
  return onBody(
    <Dialog
      className="ws-dialog"
      data-dialog="leave"
      icon={<Icon name="log-out" size={16} />}
      title={`Leave ${workspace.name}?`}
      description="You lose access to its files. Your local copies stay read-only."
      confirmLabel="Leave"
      confirmTone="danger"
      confirmDisabled={busy}
      onCancel={onClose}
      onConfirm={() => void leave()}
    />,
  )
}
