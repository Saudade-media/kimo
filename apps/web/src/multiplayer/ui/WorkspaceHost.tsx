/**
 * The window's Kimo Cloud host (board 46), mounted once by the App root over Home and the editor:
 *
 * - 6B: "Maya wants you to own Studio" while a workspace summary names this account for a
 *   transfer (`incomingTransfers`). Escape or a press outside hides it until the next refresh.
 * - 6C: Toast "You're now the Owner of Studio" once the transfer's checkout went through.
 * - 3D: "Join Studio?" when an invite link opens in the app. Join is the person's yes
 *   (architecture §5.2 step 4): the link alone accepts nothing and starts no sign-in, since it may
 *   be someone else's. Not now closes it and leaves the invite open. An invite for an account that
 *   exists signs in first (api.md §14.4), and is accepted once that sign-in is done.
 * - 3B: Toast "You joined Studio" once joined.
 * - 3C: Toast "You can now edit Landing" when an edit request turns approved; an open view
 *   session of that room reopens with an edit token.
 * - The toast stack for workspace actions outside an editor.
 *
 * Pending edit requests are checked on window focus.
 */
import { useEffect, useRef, useState } from "react"
import { failureText } from "../../editor/errors"
import { takeReadyShares } from "../../home/WorkspaceHome"
import { useOptionalRuntime } from "../../platform/runtime"
import { roomKeyOf } from "../backend"
import { fileOf, incomingTransfers } from "../cloud/workspaces"
import { useRelaySetupServices } from "../relay-setup/services"
import { AcceptTransferDialog, JoinWorkspaceDialog } from "./WorkspaceDialogs"
import {
  rememberWorkspaceNames,
  useWorkspaceStore,
  useWorkspacesState,
  useWsToast,
  WsToastStack,
} from "./workspace-parts"

/** How long an approved request's toast waits for the file's name. */
const APPROVED_WAIT_MS = 5000

export function WorkspaceHost() {
  const store = useWorkspaceStore()
  const state = useWorkspacesState(store)
  const runtime = useOptionalRuntime()
  const cloud = useRelaySetupServices(runtime?.platform ?? null)?.cloud ?? null
  const toast = useWsToast()
  /** Transfers hidden with Escape, by transfer id (shown again on the next app start). */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())

  // On start, a device that uses Kimo Cloud (an account in the cache, or Kimo Cloud as its relay)
  // refreshes its workspaces; any other device sends nothing to Kimo Cloud.
  const setupStore = useRelaySetupServices(runtime?.platform ?? null)?.store ?? null
  useEffect(() => {
    if (!store) return
    let live = true
    void store.ready().then(() => {
      if (!live) return
      const uses = store.getState().accountId !== null || setupStore?.getState().path === "cloud"
      if (uses) void store.refresh().catch(() => undefined)
    })
    return () => {
      live = false
    }
  }, [store, setupStore])

  const workspaces = state?.workspaces ?? null
  useEffect(() => {
    if (workspaces) rememberWorkspaceNames(workspaces)
  }, [workspaces])

  // --- Invites (3A, 3B) ---------------------------------------------------------------------
  // "ready" without an error is the Join dialog below; nothing here accepts on its own.
  const invite = state?.invite ?? null
  const accepting = useRef<string | null>(null)
  useEffect(() => {
    if (!store || !invite) return
    if (invite.phase === "ready" && invite.error !== null) {
      toast({
        tone: "danger",
        text:
          invite.error === "INVITE_EMAIL_MISMATCH"
            ? `This invite is for ${invite.peek.email}.`
            : failureText(`join ${invite.peek.workspaceName}`),
      })
      store.dismissInvite()
    } else if (invite.phase === "sign-in") {
      if (accepting.current === `sign-in:${invite.token}`) return
      accepting.current = `sign-in:${invite.token}`
      // Only after Join: the account exists, so a sign-in link for the invite's email, accepted
      // once it is verified.
      void cloud?.startSignIn(invite.peek.email).catch(() => undefined)
      toast({ tone: "component", icon: "mail", text: "Check your inbox" })
    } else if (invite.phase === "joined") {
      toast({ tone: "success", text: `You joined ${invite.workspace.name}` })
      store.dismissInvite()
    } else if (invite.phase === "failed") {
      toast({
        tone: "danger",
        text:
          invite.error === "INVITE_EXPIRED" || invite.error === "INVITE_USED"
            ? "This invite no longer works."
            : failureText("open the invite"),
      })
      store.dismissInvite()
    }
  }, [store, invite, cloud, toast])

  // --- Transfers (6B, 6C) -------------------------------------------------------------------
  const transfer = state?.transfer ?? null
  useEffect(() => {
    if (!store || !state || !transfer) return
    if (transfer.phase === "done") {
      const name = state.workspaces.find((w) => w.id === transfer.workspaceId)?.name
      if (name) toast({ tone: "success", text: `You're now the Owner of ${name}` })
      store.dismissTransfer()
    } else if (transfer.phase === "failed") {
      toast({
        tone: "danger",
        text: transfer.error === null ? "Payment did not go through" : failureText("open checkout"),
      })
      store.dismissTransfer()
    }
  }, [store, state, transfer, toast])

  // --- Edit requests (3C) -------------------------------------------------------------------
  // An approved request waits (a few seconds at most) for the workspace's file list, so the toast
  // names the file and the open view session can reopen with an edit token.
  const requests = state?.accessRequests ?? null
  const seen = useRef<Map<string, string> | null>(null)
  const approved = useRef(new Map<string, { workspaceName: string; at: number }>())
  const [tick, setTick] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-checks a request still waiting
  useEffect(() => {
    if (!store || !state || !requests) return
    const before = seen.current
    seen.current = new Map(requests.map((r) => [r.id, r.status]))
    if (before)
      for (const r of requests)
        if (r.status === "approved" && before.get(r.id) === "pending") {
          approved.current.set(r.room, { workspaceName: r.workspaceName, at: Date.now() })
          setTimeout(() => setTick((t) => t + 1), APPROVED_WAIT_MS)
        }
    for (const [room, a] of [...approved.current]) {
      const file = fileOf(state, room)?.file ?? null
      if (!file && Date.now() - a.at < APPROVED_WAIT_MS) continue
      approved.current.delete(room)
      toast({ tone: "success", text: `You can now edit ${file?.name ?? a.workspaceName}` })
      // An open view session of the room reopens with an edit token.
      const doc = runtime?.multiplayer?.document(roomKeyOf(room))
      if (file && doc?.getState().share.room) void store.openFile(room).catch(() => undefined)
    }
  }, [store, state, requests, runtime, toast, tick])

  // Home's New file on web: the new library file joins its workspace once its editor opens it.
  useEffect(() => {
    const lib = runtime?.libraryShare
    if (!store || !lib) return
    const check = () => {
      for (const { target, workspaceId } of takeReadyShares((key) => lib.get(key)))
        void store
          .shareFile(target, { workspaceId })
          .catch((e: unknown) => toast({ tone: "danger", text: failureText("start sharing", e) }))
    }
    check()
    return lib.subscribe(check)
  }, [store, runtime, toast])

  useEffect(() => {
    if (!store) return
    const onFocus = () => {
      if (store.getState().accessRequests.some((r) => r.status === "pending"))
        void store.checkAccessRequests().catch(() => undefined)
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [store])

  const incoming =
    store && state
      ? incomingTransfers(state).filter(
          (w) =>
            w.transfer &&
            !hidden.has(w.transfer.id) &&
            !(state.transfer?.phase === "waiting" && state.transfer.workspaceId === w.id),
        )
      : []
  const first = incoming[0] ?? null

  return (
    <>
      {store && invite?.phase === "ready" && invite.error === null && (
        <JoinWorkspaceDialog
          peek={invite.peek}
          busy={invite.busy}
          onJoin={() => void store.acceptInvite().catch(() => undefined)}
          // Only this window's dialog closes: nothing is sent, so the invite stays open.
          onNotNow={() => store.dismissInvite()}
        />
      )}
      {store && first?.transfer && (
        <AcceptTransferDialog
          key={first.transfer.id}
          store={store}
          workspace={first}
          onHide={() => {
            const id = first.transfer?.id
            if (id) setHidden((h) => new Set([...h, id]))
          }}
        />
      )}
      <WsToastStack />
    </>
  )
}
