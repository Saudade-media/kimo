/**
 * Board 46 section 1: the Share popover with Kimo Cloud workspaces (360 wide, the board 41 shell).
 *
 * - A (one workspace that can take the file): Intro (users) "Share to Studio" · Members (avatar
 *   stack, names, Active) · footnote "Monthly · 3 seats · 2.1 GB of 20 GB" · Start sharing.
 * - B (two or more): Intro "Share to a workspace" · the picker (radio rows, name, "Owner · 3
 *   members", then New workspace, which opens F) · footnote "Studio · Monthly · 3 seats" · Start
 *   sharing.
 * - C (a workspace file): Intro "In Studio" · Members (who is here, Live) · View links (Copy,
 *   Revoke) · Copy view link · Invite people · footnote "Editing is for Studio's members" · Stop
 *   sharing (Admins). There are no edit links on Kimo Cloud.
 * - D (opened from a view link, signed in, not a member): Intro (eye) · Request edit access ·
 *   "Studio pays for its editors" · "Signed in as …". Signed out, Request opens the sign-in: the
 *   relay's `/version` (`owner: "external"`, api.md §8.1) stands in for `GET /v1/relay`, which
 *   needs a signed-in device.
 * - E (request sent): Requested pill and when.
 * - F (no workspace yet, or New workspace) is the relay wizard's Subscribe step
 *   (`CloudWizardSteps`, `NewWorkspaceWizard`).
 */
import { RelayHttpClient, type RelayInfo } from "@kimo/sync/mp"
import { IconButton, StatusPill } from "@kimo/ui"
import { useEffect, useMemo, useState } from "react"
import { failureText } from "../../editor/errors"
import { Icon } from "../../lib/icons"
import { useOptionalRuntime } from "../../platform/runtime"
import type { CloudState, CloudStore } from "../cloud/store"
import type { CloudPlan, ViewLink, WorkspaceSummary } from "../cloud/types"
import { shortDate } from "../cloud/view"
import {
  firstName,
  hereLine,
  linkMeta,
  namesLine,
  pickedFootnote,
  pickerMeta,
  shareFootnote,
} from "../cloud/workspace-view"
import { fileOf, type WorkspaceStore, type WorkspacesState } from "../cloud/workspaces"
import { useCollaborators, useShareState } from "../hooks"
import type { MultiplayerModel } from "../model"
import { useCloudState, useRelaySetupServices } from "../relay-setup/services"
import { linkCopiedText, linkRevokedText } from "./copy"
import { copyText } from "./shared"
import {
  MemberAvatar,
  useWorkspaceStore,
  useWorkspacesState,
  useWsToast,
  WsButton,
} from "./workspace-parts"

const hostOf = (url: string | null | undefined) => {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

/** The owner mode of each relay a signed-out view-link guest asked (`/version`), once per window. */
const relayOwners = new Map<string, Promise<RelayInfo["owner"] | null>>()
function relayOwner(relayUrl: string): Promise<RelayInfo["owner"] | null> {
  let known = relayOwners.get(relayUrl)
  if (!known) {
    known = new RelayHttpClient({ relayUrl })
      .probe()
      .then((info) => info.owner)
      .catch(() => {
        relayOwners.delete(relayUrl)
        return null
      })
    relayOwners.set(relayUrl, known)
  }
  return known
}

export type CloudShareKind =
  /** The open room is a file of one of this account's workspaces (1C). */
  | { kind: "member"; room: string; workspaceId: string }
  /** A room on Kimo Cloud's relay opened from a view link (1D, 1E). */
  | { kind: "guest"; room: string }

/**
 * What the Share popover shows for a document's open room on Kimo Cloud, or null for everything
 * else (not shared, a self-hosted relay, board 41 and 43 bodies).
 */
export function useCloudShareKind(model: MultiplayerModel, docKey: string): CloudShareKind | null {
  const share = useShareState(model, docKey)
  const store = useWorkspaceStore()
  const state = useWorkspacesState(store)
  const runtime = useOptionalRuntime()
  const cloud = useRelaySetupServices(runtime?.platform ?? null)?.cloud ?? null
  const cloudState = useCloudState(cloud)
  const signedIn = cloudState?.session === "signed-in"
  const knowsRelay = !!cloudState?.relay
  // Which relay is Kimo Cloud's (asked once per window, signed in), only for a room opened from a
  // view link: a room of your own relay never asks Kimo Cloud.
  const maybeGuest = !!share.room && !share.owner && share.role === "view"
  useEffect(() => {
    if (cloud && signedIn && !knowsRelay && maybeGuest) void cloud.relay().catch(() => undefined)
  }, [cloud, signedIn, knowsRelay, maybeGuest])
  // Until Kimo Cloud says which relay is its own (signed out, it cannot), a relay whose owner
  // policy is external (the hosted relay's mode) counts, so a signed-out guest gets Share and
  // signs in from Request edit access.
  const cloudHost = hostOf(cloudState?.relay?.relayUrl)
  const [external, setExternal] = useState<string | null>(null)
  const guestRelay = cloud && maybeGuest && !cloudHost ? share.relayUrl : null
  useEffect(() => {
    if (!guestRelay) return
    let live = true
    void relayOwner(guestRelay).then((owner) => {
      if (live && owner === "external") setExternal(guestRelay)
    })
    return () => {
      live = false
    }
  }, [guestRelay])
  const room = share.room
  if (!room || !state) return null
  const workspaceId = state.open[room]?.workspaceId ?? fileOf(state, room)?.workspaceId
  if (workspaceId) return { kind: "member", room, workspaceId }
  if (!maybeGuest) return null
  if (cloudHost ? share.relayHost === cloudHost : guestRelay !== null && external === guestRelay)
    return { kind: "guest", room }
  return null
}

/** The open document's session, for `shareFile` (a file on disk, or a browser library file). */
export function useShareableSession(docKey: string) {
  const runtime = useOptionalRuntime()
  return () => {
    const s = runtime?.manager.get(docKey)
    if (s) return { ref: s.ref, store: s.store }
    return runtime?.libraryShare?.get(docKey) ?? null
  }
}

/** The plan pill of a workspace that can take files: Active, or Past due. */
function PlanStatusPill({ plan, label }: { plan: CloudPlan; label?: string }) {
  if (plan.status === "past_due")
    return <StatusPill status="changed" label="Past due" className="ws-pill" />
  return <StatusPill status="linked" label={label ?? "Active"} className="ws-pill" />
}

/** Members (FX2Fa / Lm7SZ): Stack (avatars, gap 4) · Names (fill) · StatusPill. */
function MembersRow({
  emails,
  names,
  pill,
}: {
  emails: readonly string[]
  names: string
  pill: React.ReactNode
}) {
  return (
    <div className="ws-members">
      {emails.length > 0 && (
        <span className="ws-members__stack" aria-hidden="true">
          {emails.slice(0, 3).map((e) => (
            <MemberAvatar key={e} email={e} />
          ))}
        </span>
      )}
      <span className="ws-members__names">{names}</span>
      {pill}
    </div>
  )
}

function Intro({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="mp-intro">
      <span className="mp-icon-wrap" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <div className="mp-text">
        <p className="mp-title">{title}</p>
        <p className="mp-desc">{desc}</p>
      </div>
    </div>
  )
}

// --- A / B ---------------------------------------------------------------------------------------

export function WorkspaceSetupBody({
  store,
  state,
  docKey,
  workspaces,
  picked: initial = null,
  onNewWorkspace,
  onStarted,
}: {
  store: WorkspaceStore
  state: WorkspacesState
  docKey: string
  /** The workspaces that can take a new file (`shareableWorkspaces`), at least one. */
  workspaces: readonly WorkspaceSummary[]
  /** The workspace to start on (one New workspace just made); default the first. */
  picked?: string | null
  /** B's New workspace row (cEPVjf6Qa3): opens F outside the popover. */
  onNewWorkspace?(): void
  onStarted?(): void
}) {
  const toast = useWsToast()
  const sessionOf = useShareableSession(docKey)
  const [picked, setPicked] = useState<string | null>(initial ?? workspaces[0]?.id ?? null)
  const [starting, setStarting] = useState(false)
  const chosen = workspaces.find((w) => w.id === picked) ?? workspaces[0] ?? null
  const one = workspaces.length === 1
  // The members and usage of each workspace the popover can show.
  useEffect(() => {
    for (const w of workspaces)
      if (!state.details[w.id])
        void store.refreshWorkspace(w.id, { background: true }).catch(() => undefined)
  }, [store, workspaces, state.details])

  const start = async () => {
    if (!chosen || starting) return
    const session = sessionOf()
    if (!session) return toast({ tone: "danger", text: failureText("start sharing") })
    setStarting(true)
    try {
      await store.shareFile(session, { workspaceId: chosen.id })
      onStarted?.()
    } catch (e) {
      toast({ tone: "danger", text: failureText("start sharing", e) })
    } finally {
      setStarting(false)
    }
  }

  if (!chosen) return null
  const detail = state.details[chosen.id] ?? null
  const members = detail?.members ?? []

  return (
    <>
      <div className="mp-body" data-workspace={one ? "one" : "pick"}>
        {one ? (
          <>
            <Intro
              icon="users"
              title={`Share to ${chosen.name}`}
              desc={`Everyone in ${chosen.name} can edit it.`}
            />
            <MembersRow
              emails={members.map((m) => m.email)}
              names={namesLine(members.map((m) => firstName(m.email)))}
              pill={<PlanStatusPill plan={chosen.plan} />}
            />
          </>
        ) : (
          <>
            <Intro icon="users" title="Share to a workspace" desc="Pick who can edit it." />
            <div className="ws-picker" role="radiogroup" aria-label="Workspace">
              {workspaces.map((w) => {
                const on = w.id === chosen.id
                return (
                  // biome-ignore lint/a11y/useSemanticElements: a styled radio row
                  <button
                    key={w.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="ws-picker__row"
                    data-workspace={w.id}
                    onClick={() => setPicked(w.id)}
                    onKeyDown={(e) => {
                      const i = workspaces.indexOf(w)
                      const next =
                        e.key === "ArrowDown" || e.key === "ArrowRight"
                          ? workspaces[(i + 1) % workspaces.length]
                          : e.key === "ArrowUp" || e.key === "ArrowLeft"
                            ? workspaces[(i - 1 + workspaces.length) % workspaces.length]
                            : null
                      if (!next) return
                      e.preventDefault()
                      setPicked(next.id)
                      const row = e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
                        `[data-workspace="${next.id}"]`,
                      )
                      row?.focus()
                    }}
                  >
                    <span className="ws-picker__radio" aria-hidden="true">
                      <Icon name={on ? "circle-dot" : "circle"} size={14} />
                    </span>
                    <span className="ws-picker__text">
                      <span className="ws-picker__name">{w.name}</span>
                      <span className="ws-picker__meta">{pickerMeta(w)}</span>
                    </span>
                  </button>
                )
              })}
              {onNewWorkspace && (
                <button
                  type="button"
                  className="ws-picker__row ws-picker__new"
                  data-action="new-workspace"
                  onClick={onNewWorkspace}
                >
                  <span className="ws-picker__new-icon" aria-hidden="true">
                    <Icon name="plus" size={14} />
                  </span>
                  <span className="ws-picker__new-label">New workspace</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <div className="mp-footer">
        <span className="mp-footnote ws-footnote">
          {one ? shareFootnote(chosen, detail?.usage ?? null) : pickedFootnote(chosen)}
        </span>
        <WsButton
          variant="primary"
          className="mp-start"
          icon="radio"
          disabled={starting}
          onClick={() => void start()}
        >
          {starting ? "Starting…" : "Start sharing"}
        </WsButton>
      </div>
    </>
  )
}

// --- C -------------------------------------------------------------------------------------------

/** Links made in this window, by jti: a listed link carries no token, so only these can be copied. */
const madeHere = new Map<string, string>()

export function WorkspaceLiveBody({
  store,
  state,
  model,
  docKey,
  room,
  workspaceId,
  onInvite,
}: {
  store: WorkspaceStore
  state: WorkspacesState
  model: MultiplayerModel
  docKey: string
  room: string
  workspaceId: string
  /**
   * Invite people (2B). The dialog lives outside the popover, like Reset all links: a press in a
   * dialog on `body` is outside the popover, which would close and unmount it.
   */
  onInvite?(): void
}) {
  const runtime = useOptionalRuntime()
  const platform = runtime?.platform ?? null
  const toast = useWsToast()
  const people = useCollaborators(model, docKey)
  const [links, setLinks] = useState<ViewLink[]>([])
  const [busy, setBusy] = useState(false)
  const w = state.workspaces.find((x) => x.id === workspaceId) ?? null
  const detail = state.details[workspaceId] ?? null
  const self = detail?.members.find((m) => m.self) ?? null
  const admin = w?.role === "owner" || w?.role === "admin"

  // biome-ignore lint/correctness/useExhaustiveDependencies: once per open
  useEffect(() => {
    let live = true
    store
      .listLinks(workspaceId)
      .then((all) => live && setLinks(all.filter((l) => l.room === room)))
      .catch(() => undefined)
    if (!detail)
      void store.refreshWorkspace(workspaceId, { background: true }).catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  if (!w) return null
  const others = people.filter((p) => !p.isYou)
  const members = detail?.members ?? []

  const copyNew = async () => {
    setBusy(true)
    try {
      const { link, url } = await store.createViewLink(room, { expiresAt: null, label: null })
      madeHere.set(link.jti, url)
      setLinks((l) => [...l.filter((x) => x.jti !== link.jti), link])
      await copyText(platform, url)
      toast({
        tone: "success",
        icon: "link",
        text: linkCopiedText({ role: "view", expiresAt: null }, Date.now()),
      })
    } catch (e) {
      toast({ tone: "danger", text: failureText("create the link", e) })
    } finally {
      setBusy(false)
    }
  }
  const copy = async (url: string) => {
    try {
      await copyText(platform, url)
      toast({
        tone: "success",
        icon: "link",
        text: linkCopiedText({ role: "view", expiresAt: null }, Date.now()),
      })
    } catch (e) {
      toast({ tone: "danger", text: failureText("copy the link", e) })
    }
  }
  const revoke = async (link: ViewLink) => {
    try {
      await store.revokeLink(room, link.jti)
      madeHere.delete(link.jti)
      setLinks((l) => l.filter((x) => x.jti !== link.jti))
      toast({ tone: "component", icon: "link-2-off", text: linkRevokedText("view") })
    } catch (e) {
      toast({ tone: "danger", text: failureText("revoke the link", e) })
    }
  }
  const stop = async () => {
    try {
      await store.closeFile(room)
    } catch (e) {
      toast({ tone: "danger", text: failureText("stop sharing", e) })
    }
  }

  return (
    <>
      <div className="mp-body" data-workspace="live">
        <Intro icon="users" title={`In ${w.name}`} desc={`Everyone in ${w.name} can edit it.`} />
        <MembersRow
          emails={members.map((m) => m.email)}
          names={
            others.length
              ? hereLine(others.map((p) => p.label))
              : namesLine(members.map((m) => firstName(m.email)))
          }
          pill={<StatusPill status="linked" label="Live" className="ws-pill mp-live" />}
        />
        {links.length > 0 && (
          <div className="ws-links">
            <span className="ws-label">View links</span>
            <div className="ws-list">
              {links.map((l) => {
                const url = madeHere.get(l.jti)
                return (
                  <div key={l.jti} className="ws-link" data-jti={l.jti}>
                    <span className="ws-link__icon" aria-hidden="true">
                      <Icon name="link" size={14} />
                    </span>
                    <span className="ws-link__meta">{linkMeta(l, self?.email ?? null)}</span>
                    {url && (
                      <WsIconButton
                        label="Copy view link"
                        icon="copy"
                        onClick={() => void copy(url)}
                      />
                    )}
                    {(admin || l.createdBy === self?.email) && (
                      <WsIconButton
                        label="Revoke view link"
                        icon="trash-2"
                        danger
                        onClick={() => void revoke(l)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <div className="ws-actions">
          <WsButton variant="secondary" icon="link" disabled={busy} onClick={() => void copyNew()}>
            Copy view link
          </WsButton>
          {admin && onInvite && (
            <WsButton variant="ghost" icon="user-plus" onClick={onInvite}>
              Invite people
            </WsButton>
          )}
        </div>
      </div>
      <div className="mp-footer">
        <span className="mp-footnote ws-footnote">{`Editing is for ${w.name}'s members`}</span>
        {admin && (
          <WsButton variant="ghost" className="mp-stop" icon="square" onClick={() => void stop()}>
            Stop sharing
          </WsButton>
        )}
      </div>
    </>
  )
}

function WsIconButton({
  label,
  icon,
  danger,
  onClick,
}: {
  label: string
  icon: string
  danger?: boolean
  onClick(): void
}) {
  return (
    <IconButton
      className={`ws-icon-button${danger ? " ws-icon-button--danger" : ""}`}
      label={label}
      icon={<Icon name={icon} size={14} />}
      size="sm"
      tone="ghost"
      onClick={onClick}
    />
  )
}

// --- D / E ---------------------------------------------------------------------------------------

export function WorkspaceGuestBody({
  store,
  state,
  cloud,
  cloudState,
  room,
  onSignIn,
}: {
  store: WorkspaceStore
  state: WorkspacesState
  cloud: CloudStore | null
  cloudState: CloudState | null
  room: string
  /** Signed out: the relay wizard at Sign in. */
  onSignIn(): void
}) {
  const toast = useWsToast()
  const [busy, setBusy] = useState(false)
  const signedIn = cloudState?.session === "signed-in" && !!cloudState.account
  const request = useMemo(
    () =>
      state.accessRequests
        .filter((r) => r.room === room)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
    [state.accessRequests, room],
  )
  // A pending request is checked whenever the popover opens (and on focus by the host).
  useEffect(() => {
    if (request?.status === "pending") void store.checkAccessRequests().catch(() => undefined)
  }, [store, request?.status])
  const name = request?.workspaceName ?? null
  const sent = request?.status === "pending"

  const ask = async () => {
    if (!signedIn) return onSignIn()
    if (busy) return
    setBusy(true)
    try {
      await store.requestAccess(room)
    } catch (e) {
      // Already a member: the account's workspaces name this room once refreshed.
      if (e instanceof Error && "code" in e && e.code === "ALREADY_MEMBER") {
        await cloud?.refresh().catch(() => undefined)
        await store.openFile(room).catch(() => undefined)
      } else toast({ tone: "danger", text: failureText("send the request", e) })
    } finally {
      setBusy(false)
    }
  }

  const today = request ? shortDate(request.createdAt) === shortDate(Date.now()) : false
  return (
    <>
      <div className="mp-body" data-workspace={sent ? "requested" : "viewer"}>
        <Intro
          icon="eye"
          title="You can view this file"
          desc={
            sent
              ? "Your edit request was sent."
              : `Ask ${name ? `${name}'s` : "the workspace's"} admins to let you edit.`
          }
        />
        {sent && request ? (
          <div className="ws-request">
            <StatusPill status="changed" label="Requested" className="ws-pill" />
            <span className="ws-request__meta">
              {today ? "Sent today" : `Sent ${shortDate(request.createdAt)}`}
            </span>
          </div>
        ) : (
          <>
            <WsButton
              variant="primary"
              wide
              icon="pencil"
              disabled={busy}
              onClick={() => void ask()}
            >
              Request edit access
            </WsButton>
            <p className="mp-price">{`${name ?? "The workspace"} pays for its editors`}</p>
          </>
        )}
      </div>
      {signedIn && cloudState?.account && (
        <div className="mp-footer">
          <span className="mp-footnote ws-footnote">
            {`Signed in as ${cloudState.account.account.email}`}
          </span>
        </div>
      )}
    </>
  )
}
