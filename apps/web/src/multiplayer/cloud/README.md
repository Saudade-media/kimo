# Kimo Cloud in the app

Headless code for Kimo Cloud (ADR 0018, ADR 0019). The UI reads stores and calls their methods; it
never talks to the service or the relay itself. The contract is kimo-cloud `docs/api.md` (wire) and
`docs/architecture.md` (behaviour); the screens are board 43 "Kimo Cloud" (sign-in, plan) and
board 46 "Cloud workspaces" in `desing.kimo`.

| File | What it is |
|---|---|
| `client.ts` | Typed HTTP client, one signed request per call (api.md §3 to §17) |
| `sign.ts` | Request signing with the device key (§2) |
| `types.ts` | Wire shapes and `CloudError` codes (§11) |
| `store.ts` | `CloudStore`: account, sign-in, board 43 checkout (one per window) |
| `workspaces.ts` | `WorkspaceStore`: workspaces, members, files, tokens, links, invites, transfers |
| `cache.ts` | What the device keeps (registry `cloud` store): lists, tokens, file bindings |
| `migrate.ts` | The 1.3.0 re-share of pre-workspace Cloud rooms |
| `hosted.ts` | Desktop windows: the document host's workspace files shown in the window's store |
| `links.ts` | `kimo://cloud/...` deep links and the web `/invite#<token>` route |
| `managed.ts` | Desktop managed copies of files that are not on disk |
| `fake.ts` | In-memory Kimo Cloud for tests and harnesses (real room tokens) |
| `view.ts` | Board 43 copy helpers |

## Getting the stores

```ts
const runtime = useRuntime()
const workspaces = runtime.workspaces          // WorkspaceStore | null (null: Kimo Cloud hidden)
const cloud = relaySetupFor(runtime.platform).cloud   // CloudStore | null (sign-in, account)
```

Subscribe with `useSyncExternalStore(workspaces.subscribe, workspaces.getState)`. Every method
returns a promise and throws `CloudError` (`error.code`, see api.md §11 for the copy each code
needs). `OFFLINE`, `INTERNAL` and `BAD_RESPONSE` mean no answer: `state.offline` turns true and
everything cached stays.

## State (`WorkspacesState`)

| Field | Meaning |
|---|---|
| `hydrated` | The device cache was read. Render from it before any network answer |
| `accountId` | The signed-in account (null signed out) |
| `workspaces` | `WorkspaceSummary[]`, oldest membership first; `role`, `plan`, `members`, `transfer`, `deletedAt` |
| `details[ws]` | `WorkspaceDetail`: `members`, `invites`, `requests` (empty for Editors), `usage` |
| `files[ws]` | `FileList`: `files` and `closed` (closed files and re-shared rooms, 30 days) |
| `bindings[room]` | Which local copy a room syncs with; `ended` is `closed`, `deleted` or `removed` once it stops |
| `accessRequests` | This account's own edit requests |
| `invite` | The invite flow (see below), null when none |
| `transfer` | The accept-a-transfer flow (6B, 6C), null when none |
| `migration` | The re-share of pre-workspace rooms: `phase`, `moved`, `left` |
| `open[room]` | Workspace rooms open here, with the role their connection holds |
| `offline` | The last call got no answer |

Picks: `shareableWorkspaces(state)` (where a new file can go), `incomingTransfers(state)` (show
6B), `fileOf(state, room)`, `bindingForFile(state, fileKey)`, `tokenRoleFor(plan.status)`.

## Flows

**Lists.** `refresh()` on focus (the Cloud store already refreshes the account on focus, and the
workspace store refreshes each workspace's members and files in the background, at most every
30 s). `refreshWorkspace(ws)` after an action of your own if you need it at once; the actions below
already do. A list shown on open passes `{ background: true }`, which joins a request already under
way. Kimo Cloud allows a device 10 signed requests a second, so the store asks for each list once:
`refresh()` calls share one run, background loads go one workspace at a time, and a `RATE_LIMITED`
answer that asks to wait a few seconds at most is tried once more after the wait.

**Share a file** (Share popover on Kimo Cloud). `shareFile(session)` where `session` is the editor's
`{ ref, store }`; the file's name in the workspace is the document's name, else the file's base name
(pass `{ name }` to choose it). A file this device already shares through a relay of its own is
refused with `BAD_REQUEST`. It answers `{ status: "shared", file, workspaceId, session }`, or
`{ status: "choose", workspaces }` when several workspaces can take it: show the picker and call
again with `{ workspaceId }`. `PLAN_REQUIRED` when none can (4C or 6A). Do not use
`PlatformShare.shareSession` for Kimo Cloud: that is the self-hosted relay path, and the hosted
relay refuses device registers once the legacy flag is off.

**Open a file** from the Kimo Cloud group on Home. `localCopy(room)` first: on desktop it answers a
path (creating the managed copy in `<Kimo home>/workspaces/<ws>/` when the file is not on disk yet);
open that path through the session manager like any file, and it reconnects to its room on its own.
A copy whose binding ended (removed, then invited again) or that another account on this device
bound is bound again to this account while its workspace lists the file, so it syncs instead of
opening read-only or as a plain local file. Bindings are kept per room, so the other account's
binding is replaced; that account binds it back the next time it opens the file from Home.
On web it answers null: call `openFile(room)`, which opens the room's replica (a guest document)
and resolves the `SharedSession`. A file already bound on disk reopens in its room whenever it
opens, with nothing to call.

**Read-only.** A plan that is `read_only` or `expired` gets view tokens: the relay makes the session
read-only (`VIEW_ONLY_REASON`). A deleted workspace's copies open with
`store.readOnly.reason === CLOUD_DELETED_REASON` (6E), a removed or departed member's with
`CLOUD_REMOVED_REASON` (6F). A closed file is a plain local file again.

**View links.** `createViewLink(room, { expiresAt, label })` → `{ link, url }` (show `url`).
`listLinks(ws)`, `revokeLink(room, jti)`. There are no edit links on Kimo Cloud.

**Members.** `invite(ws, email, role)` (show `plans.seatAmountCents` first), `cancelInvite`,
`setRole`, `removeMember` (resolves the ended view links for the removal dialog), `approveRequest`,
`declineRequest`, `renameWorkspace`, `createWorkspace`, `checkout(ws, interval)`, `openPortal(ws)`.

**Request edit access** (a view-link guest). `requestAccess(room)`, then `checkAccessRequests()` on
focus; once one is `approved`, `openFile(room)` upgrades the open view session to edit.

**Invites.** A link sets `state.invite` by itself (desktop `kimo://cloud/invite#<token>`, web
`/invite#<token>`; see `platform/runtime.ts`). Phases:
`checking` → `ready` (board 46 3D "Join <peek.workspaceName>?", `acceptInvite()`) →
`joined`. Only the person's Join calls `acceptInvite()`: the link may be someone else's, so
opening it accepts nothing and starts no sign-in. `sign-in` (after Join): that email has an
account; run the Cloud store's sign-in for `peek.email`, and the invite is accepted when it
completes. `failed` with `INVITE_EXPIRED` or `INVITE_USED`:
"This invite no longer works." `ready` with `error` `INVITE_EMAIL_MISMATCH`: "This invite is for
<email>" with Sign out. The store sets it before any accept when this device is signed in as
another email (and on the service's `403`), and clears it once the device is signed out or signed
in as the invited email, so the same dialog offers Join again. `dismissInvite()` closes it (3D Not now): nothing is sent, so the invite
stays open and the same link works later.

**Transfer ownership.** Owner: `requestTransfer(ws, adminAccountId)` (6A; only Admins, else
`NOT_ADMIN`), `cancelTransfer(ws)`. The named Admin: show 6B while `incomingTransfers(state)` lists
the workspace (its `transfer` has the price and seats); `acceptTransfer(ws)` opens the checkout and
sets `state.transfer` to `waiting`, then `done` (6C "You're now the Owner") or `failed`.
`declineTransfer(ws)`, `dismissTransfer()`. The email's link only opens the app, which refreshes.

**Delete and leave.** `deleteWorkspace(ws, typedName)` (6D; `NAME_MISMATCH` until it matches).
`leave(ws)` (6F; Admins and Editors, `OWNER_CANNOT_LEAVE` for the Owner) resolves the ended links.

**Migration.** Runs by itself after sign-in, in one window of the origin at a time (Web Locks; on
desktop in the document host, over `rooms.json`), and is safe to repeat: `state.migration` says how far it got (`left > 0`: it resumes on the next
sign-in). `migrate()` runs it again. Closing the old room deletes its blobs, so before the
close every blob the old room holds for the document's manifest is copied relay to relay into the
new room (blobs are fetched on demand, so this device may not hold them all); any failure leaves
the old room open for the next run. A pre-workspace room that is already closed and was never
uploaded is left as it is (its file stays a local file of this device).

## The board 46 UI

| File | What it shows |
|---|---|
| `../ui/WorkspaceShare.tsx` | Share popover 1A to 1E (`useCloudShareKind` routes a room to 1C or 1D/1E) |
| `../ui/WorkspacePane.tsx` | Settings › Workspace (2A): plan, members, invites, edit requests, ownership |
| `../ui/WorkspaceDialogs.tsx` | 2B invite, 2C remove (toast 2D), 3D Join, 6A transfer, 6B accept, 6D delete, 6F leave |
| `../ui/WorkspaceHost.tsx` | Mounted once per window: 3D Join, 6B, toasts 6C, 3B, 3C, the start refresh |
| `../ui/NewWorkspace.tsx` | New workspace: 1F as the relay wizard's Subscribe step, for a new workspace |
| `../ui/WorkspaceBanner.tsx` | Editor banners 5A to 5D and 6E, with Save a copy |
| `../ui/workspace-parts.tsx` | Store hooks, member avatar, 28-tall buttons, the toast stack outside an editor |
| `workspace-view.ts` | Copy and picks (names from emails, footnotes, prices, banner kind) |
| `../../home/WorkspaceHome.tsx` | Home 4A: KIMO CLOUD group, `#/workspace/<id>`, and the web `#/cloud/<room>` route |

1F is the relay wizard's Subscribe step (`../ui/CloudWizardSteps.tsx`): it names the first workspace,
and `CloudStore.startCheckout({ workspaceName })` creates it before the workspace checkout. New
workspace (1B's row, Home's KIMO CLOUD plus, Settings › Workspace's "New workspace…") opens the same
step through `../ui/NewWorkspace.tsx`: `createWorkspace(name)` makes it (one seat), then
`CloudStore.startCheckout({ workspaceId })` checks it out, and the caller selects it once paid.

Names: Kimo Cloud knows people by email only, so names and initials come from the email's local
part (`personName`).

## Desktop: the document host

On desktop the hidden document host holds every file on disk and the owner's registry
(`rooms.json`), so it holds workspace files too (`../../host/cloud-host.ts`). It runs a workspace
store of its own over its share layer, cached in `rooms.json`: bound files reopen in their rooms
as the host opens them, whichever window shows them, and their tokens are kept fresh there. The
re-share runs there too, over the host's owned rooms.

A window's store (`hosted.ts`) keeps the account, lists, members, invites, transfers, rooms joined
from a view link and untitled files. It sends `shareFile` for a file the host holds and
`localCopy` to the host (`mp.cloud.*`), and shows the host's `bindings`, `open` and `migration`,
pushed on every change (`kimo://host-cloud`), merged into its state. Kimo Cloud answers each store
separately: when the window's account changes (sign-in, sign-out, a workspace deleted or left, a
plan change) the host asks again. That asks for the account only (the host's lists follow every
30 s), since every window asks as it attaches and the device shares one request budget. A window
with no host (an older shell) does all of it itself.

The host's store keeps a copy's read-only reason (6E, 6F, a view-only plan) on its store; windows
take it from the session state (`readOnlyReason`). Save a copy (Save As) leaves the binding with
the read-only copy, and the new file is a plain local file.

## Not done yet

- Home's New file on desktop shares an untitled document from the window, not the host. After its
  first save the binding stays in the window's store, so the host may not reopen the saved file in
  its room (read from the code, not tried in the app).
- After sign-out, a deleted workspace's copy opens editable until its account signs in again
  (bindings are per account).
- A read-only copy that is still open when its member is invited back stays read-only until it is
  closed and opened again (Home binds it again, but an open session does not reopen; read from the
  code, not tried in the app).
