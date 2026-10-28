/**
 * Board 46 2A: Settings › Workspace (Xa3nAmnduu). Title Bar: "Workspace" · Select (180 × 28) of the
 * account's workspaces, then "New workspace…" (1F, `NewWorkspaceWizard`; the new one is selected
 * once paid). Then, as `mp-setting` sections (column, gap 8, padding [12, 0]):
 *
 * - Plan: "You pay for Studio's plan." · Owner, Plan ("Monthly · 3 seats · $16", "renews Nov 28"),
 *   Storage (bar, mono value) · Manage billing (Owner) and Rename (Admins).
 * - Members: "Each member is a seat. Viewers are free." · the list (members, then pending
 *   invites) · "Invites are free until accepted." · Invite people (Admins). Admins change roles
 *   (Select 96 × 24) and remove (user-minus, on hover); Editors see the list only.
 * - Edit requests (Admins, when there are any): Decline · Approve · $4/mo.
 * - Ownership: Transfer ownership · Delete workspace (Owner); Leave for Admins and Editors (6F).
 *
 * Undrawn on the board, chosen here: the Plan desc for members, Rename as an inline field in place
 * of the Select, Leave's button, the pending transfer's Cancel, and the empty pane.
 */
import { Badge, Button, IconButton, Input, Select, StatusPill } from "@kimo/ui"
import { useEffect, useMemo, useRef, useState } from "react"
import { failureText } from "../../editor/errors"
import { Icon } from "../../lib/icons"
import { useOptionalRuntime } from "../../platform/runtime"
import type { Member, MemberRole, WorkspaceSummary } from "../cloud/types"
import { planMeta, storageLevel, storageRatio, storageText } from "../cloud/view"
import {
  approveLabel,
  firstName,
  inviteMeta,
  liveWorkspaces,
  memberMeta,
  personName,
  ROLE_LABEL,
  requestMeta,
  seatPrice,
  workspacePlanValue,
} from "../cloud/workspace-view"
import { fileOf } from "../cloud/workspaces"
import { useCloudState, useRelaySetupServices } from "../relay-setup/services"
import { NewWorkspaceWizard } from "./NewWorkspace"
import {
  DeleteWorkspaceDialog,
  InviteDialog,
  LeaveDialog,
  RemoveMemberDialog,
  TransferDialog,
} from "./WorkspaceDialogs"
import {
  MemberAvatar,
  useWorkspaceStore,
  useWorkspacesState,
  useWsToast,
  WsButton,
} from "./workspace-parts"
import "./cloud.css"
import "./share-ui.css"

const ROLE_OPTIONS = [
  { value: "editor" as const, label: "Editor" },
  { value: "admin" as const, label: "Admin" },
]

/** The Select's last entry, which opens New workspace (1F) instead of picking. */
const NEW_WORKSPACE = "new-workspace"

type Open =
  | { kind: "invite" }
  | { kind: "remove"; member: Member }
  | { kind: "transfer" }
  | { kind: "delete" }
  | { kind: "leave" }
  | { kind: "new" }
  | null

export function WorkspacePane({ focus }: { focus?: string | null }) {
  const store = useWorkspaceStore()
  const state = useWorkspacesState(store)
  const runtime = useOptionalRuntime()
  const cloud = useRelaySetupServices(runtime?.platform ?? null)?.cloud ?? null
  const cloudState = useCloudState(cloud)
  const toast = useWsToast()
  const list = state ? liveWorkspaces(state) : []
  const [picked, setPicked] = useState<string | null>(focus ?? null)
  const [open, setOpen] = useState<Open>(null)
  const [renaming, setRenaming] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const w: WorkspaceSummary | null = list.find((x) => x.id === picked) ?? list[0] ?? null
  const wsId = w?.id ?? null

  // The pane is Kimo Cloud's: opening it asks for the account's workspaces and the prices.
  useEffect(() => {
    if (cloud) void cloud.loadPlans()
    if (store) void store.refresh().catch(() => undefined)
  }, [cloud, store])
  useEffect(() => {
    if (store && wsId) void store.refreshWorkspace(wsId).catch(() => undefined)
  }, [store, wsId])

  const now = Date.now()
  const plans = cloudState?.plans.plans ?? []
  const detail = state && wsId ? (state.details[wsId] ?? null) : null
  const members = useMemo(() => {
    const all = detail?.members ?? []
    const rank = { owner: 0, admin: 1, editor: 2 } as const
    return [...all].sort((a, b) => rank[a.role] - rank[b.role] || a.joinedAt - b.joinedAt)
  }, [detail])

  if (!store || !state) return null

  const titleBar = (
    <div className="settings-title-bar ws-title-bar" data-tauri-drag-region="deep">
      <h2 className="settings-title ws-title">Workspace</h2>
      {w && renaming ? (
        <RenameField
          name={w.name}
          onDone={async (name) => {
            setRenaming(false)
            const next = name.trim()
            if (!next || next === w.name) return
            try {
              await store.renameWorkspace(w.id, next)
            } catch (e) {
              toast({ tone: "danger", text: failureText("rename the workspace", e) })
            }
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        list.length > 0 &&
        w && (
          <Select
            className="ws-select ws-select--180"
            label="Workspace"
            options={[
              ...list.map((x) => ({ value: x.id, label: x.name })),
              { value: NEW_WORKSPACE, label: "New workspace…" },
            ]}
            value={w.id}
            onChange={(v) => (v === NEW_WORKSPACE ? setOpen({ kind: "new" }) : setPicked(v))}
          />
        )
      )}
    </div>
  )

  if (!w)
    return (
      <>
        {titleBar}
        <p className="mp-desc ws-empty">You're not in a workspace yet.</p>
      </>
    )

  const owner = w.role === "owner"
  const admin = owner || w.role === "admin"
  const ownerMember = members.find((m) => m.role === "owner") ?? null
  const usage = detail?.usage ?? null
  const price = seatPrice(plans, w.plan.interval)
  const invites = admin ? (detail?.invites ?? []) : []
  const requests = admin ? (detail?.requests ?? []) : []
  const admins = members.filter((m) => m.role === "admin")
  const pending = w.transfer

  const act = async (id: string, what: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    try {
      await fn()
    } catch (e) {
      toast({ tone: "danger", text: failureText(what, e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="ws-pane" data-workspace={w.id} data-role={w.role}>
      {titleBar}
      <div className="mp-setting" data-setting="plan">
        <div className="mp-text mp-text--2">
          <p className="mp-setting__label">Plan</p>
          <p className="mp-desc">
            {owner
              ? `You pay for ${w.name}'s plan.`
              : `${ownerMember ? firstName(ownerMember.email) : "The Owner"} pays for ${w.name}'s plan.`}
          </p>
        </div>
        {ownerMember && (
          <div className="mp-kv" data-row="owner">
            <span className="mp-kv__key">Owner</span>
            <span className="mp-kv__value">{ownerMember.email}</span>
          </div>
        )}
        <div className="mp-kv" data-row="plan">
          <span className="mp-kv__key">Plan</span>
          <span className="mp-kv__value">{workspacePlanValue(w.plan, w.members)}</span>
          {planMeta(w.plan) && <span className="mp-kv__meta">{planMeta(w.plan)}</span>}
        </div>
        {usage && (
          <div className="mp-kv" data-row="storage">
            <span className="mp-kv__key">Storage</span>
            <div className="mp-storage" data-level={storageLevel(usage)} aria-hidden="true">
              <div
                className="mp-storage__used"
                style={{ width: `${storageRatio(usage) * 100}%` }}
              />
            </div>
            <span className="mp-kv__value mp-kv__value--mono">{storageText(usage)}</span>
          </div>
        )}
        {(owner || admin) && (
          <div className="mp-account-actions">
            {owner && w.plan.status !== "none" && (
              <WsButton
                variant="secondary"
                icon="external-link"
                data-action="manage-billing"
                disabled={busy === "billing"}
                onClick={() =>
                  void act("billing", "open billing", async () => {
                    await store.openPortal(w.id)
                    toast({
                      tone: "component",
                      icon: "external-link",
                      text: "Billing opened in your browser",
                    })
                  })
                }
              >
                Manage billing
              </WsButton>
            )}
            {admin && (
              <Button
                variant="ghost"
                className="ws-rename"
                data-action="rename"
                icon={<Icon name="pencil" size={16} />}
                onClick={() => setRenaming(true)}
              >
                Rename
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mp-setting" data-setting="members">
        <div className="mp-text mp-text--2">
          <p className="mp-setting__label">Members</p>
          <p className="mp-desc">Each member is a seat. Viewers are free.</p>
        </div>
        <ul className="ws-list ws-members-list" aria-label="Members">
          {members.map((m) => {
            const canEdit = admin && m.role !== "owner" && !m.self
            return (
              <li key={m.account} className="ws-member" data-member={m.email}>
                <MemberAvatar email={m.email} />
                <span className="ws-member__text">
                  <span className="ws-member__name-row">
                    <span className="ws-member__name">{personName(m.email)}</span>
                    {m.self && <Badge className="ws-member__you">You</Badge>}
                  </span>
                  <span className="ws-member__meta">{memberMeta(m, now)}</span>
                </span>
                {canEdit ? (
                  <>
                    <Select
                      className="ws-select ws-select--96"
                      label={`Role of ${personName(m.email)}`}
                      options={ROLE_OPTIONS}
                      value={m.role as MemberRole}
                      disabled={busy === `role:${m.account}`}
                      onChange={(role) =>
                        void act(`role:${m.account}`, "change the role", () =>
                          store.setRole(w.id, m.account, role),
                        )
                      }
                    />
                    <IconButton
                      className="ws-icon-button ws-icon-button--danger ws-member__remove"
                      label={`Remove ${personName(m.email)}`}
                      icon={<Icon name="user-minus" size={14} />}
                      size="sm"
                      tone="ghost"
                      onClick={() => setOpen({ kind: "remove", member: m })}
                    />
                  </>
                ) : (
                  <span className="ws-member__role">{ROLE_LABEL[m.role]}</span>
                )}
              </li>
            )
          })}
          {invites.map((inv) => (
            <li key={inv.id} className="ws-member ws-member--invite" data-invite={inv.email}>
              <span className="ws-member__icon" aria-hidden="true">
                <Icon name="mail" size={14} />
              </span>
              <span className="ws-member__text">
                <span className="ws-member__name-row">
                  <span className="ws-member__name">{inv.email}</span>
                  <StatusPill status="changed" label="Invited" className="ws-pill" />
                </span>
                <span className="ws-member__meta">{inviteMeta(inv.invitedBy, inv.expiresAt)}</span>
              </span>
              <IconButton
                className="ws-icon-button"
                label={`Cancel the invite to ${inv.email}`}
                icon={<Icon name="x" size={14} />}
                size="sm"
                tone="ghost"
                disabled={busy === `invite:${inv.id}`}
                onClick={() =>
                  void act(`invite:${inv.id}`, "cancel the invite", () =>
                    store.cancelInvite(w.id, inv.id),
                  )
                }
              />
            </li>
          ))}
        </ul>
        {admin && (
          <div className="ws-members-footer">
            <span className="ws-members-footer__icon" aria-hidden="true">
              <Icon name="info" size={14} />
            </span>
            <span className="ws-members-footer__hint">Invites are free until accepted.</span>
            <WsButton
              variant="primary"
              icon="user-plus"
              data-action="invite"
              onClick={() => setOpen({ kind: "invite" })}
            >
              Invite people
            </WsButton>
          </div>
        )}
      </div>

      {requests.length > 0 && (
        <div className="mp-setting ws-setting--requests" data-setting="requests">
          <div className="mp-text mp-text--2">
            <p className="mp-setting__label">Edit requests</p>
            <p className="mp-desc">People who asked to edit from a view link.</p>
          </div>
          {requests.map((r) => (
            <div key={r.id} className="ws-request-row" data-request={r.email}>
              <MemberAvatar email={r.email} />
              <span className="ws-member__text">
                <span className="ws-member__name">{personName(r.email)}</span>
                <span className="ws-member__meta">
                  {requestMeta(r.email, fileOf(state, r.room)?.file.name ?? null)}
                </span>
              </span>
              <WsButton
                variant="ghost"
                disabled={busy === `request:${r.id}`}
                onClick={() =>
                  void act(`request:${r.id}`, "decline the request", () =>
                    store.declineRequest(w.id, r.id),
                  )
                }
              >
                Decline
              </WsButton>
              <WsButton
                variant="primary"
                disabled={busy === `request:${r.id}`}
                onClick={() =>
                  void act(`request:${r.id}`, "approve the request", () =>
                    store.approveRequest(w.id, r.id),
                  )
                }
              >
                {approveLabel(price, w.plan.interval)}
              </WsButton>
            </div>
          ))}
        </div>
      )}

      <div className="mp-setting ws-ownership" data-setting="ownership">
        {owner ? (
          <>
            {pending ? (
              <WsButton
                variant="ghost"
                icon="crown"
                data-action="cancel-transfer"
                disabled={busy === "transfer"}
                onClick={() =>
                  void act("transfer", "cancel the transfer", () => store.cancelTransfer(w.id))
                }
              >
                {`Cancel transfer to ${firstName(pending.to)}`}
              </WsButton>
            ) : (
              <WsButton
                variant="ghost"
                icon="crown"
                data-action="transfer"
                onClick={() => setOpen({ kind: "transfer" })}
              >
                Transfer ownership
              </WsButton>
            )}
            <WsButton
              variant="ghost"
              danger
              icon="trash-2"
              data-action="delete"
              onClick={() => setOpen({ kind: "delete" })}
            >
              Delete workspace
            </WsButton>
          </>
        ) : (
          <WsButton
            variant="ghost"
            icon="log-out"
            data-action="leave"
            onClick={() => setOpen({ kind: "leave" })}
          >
            Leave workspace
          </WsButton>
        )}
      </div>

      {open?.kind === "invite" && (
        <InviteDialog store={store} workspace={w} plans={plans} onClose={() => setOpen(null)} />
      )}
      {open?.kind === "remove" && (
        <RemoveMemberDialog
          store={store}
          workspace={w}
          member={open.member}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "transfer" && (
        <TransferDialog store={store} workspace={w} admins={admins} onClose={() => setOpen(null)} />
      )}
      {open?.kind === "delete" && (
        <DeleteWorkspaceDialog
          store={store}
          workspace={w}
          onClose={() => setOpen(null)}
          onDeleted={() => setPicked(null)}
        />
      )}
      {open?.kind === "leave" && (
        <LeaveDialog
          store={store}
          workspace={w}
          onClose={() => setOpen(null)}
          onLeft={() => setPicked(null)}
        />
      )}
      {open?.kind === "new" && (
        <NewWorkspaceWizard
          onClose={() => setOpen(null)}
          onCreated={(id) => {
            setOpen(null)
            setPicked(id)
          }}
        />
      )}
    </div>
  )
}

function RenameField({
  name,
  onDone,
  onCancel,
}: {
  name: string
  onDone(name: string): void
  onCancel(): void
}) {
  const [value, setValue] = useState(name)
  const done = useRef(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <Input
      ref={ref}
      frameProps={{ className: "ws-rename-field" }}
      aria-label="Workspace name"
      maxLength={64}
      spellCheck={false}
      value={value}
      onChange={(e) => setValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          done.current = true
          onDone(value)
        } else if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          done.current = true
          onCancel()
        }
      }}
      onBlur={() => {
        if (!done.current) onDone(value)
      }}
    />
  )
}
