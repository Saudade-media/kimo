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
already do.

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
`checking` → `ready` ("Join <peek.workspaceName> as <peek.email>?", `acceptInvite()`) →
`joined`. `sign-in`: that email has an account; run the Cloud store's sign-in for `peek.email`,
and the invite is accepted when it completes. `failed` with `INVITE_EXPIRED` or `INVITE_USED`:
"This invite no longer works." `ready` with `error` `INVITE_EMAIL_MISMATCH`: "This invite is for
<email>" with Sign out. `dismissInvite()` closes it.

**Transfer ownership.** Owner: `requestTransfer(ws, adminAccountId)` (6A; only Admins, else
`NOT_ADMIN`), `cancelTransfer(ws)`. The named Admin: show 6B while `incomingTransfers(state)` lists
the workspace (its `transfer` has the price and seats); `acceptTransfer(ws)` opens the checkout and
sets `state.transfer` to `waiting`, then `done` (6C "You're now the Owner") or `failed`.
`declineTransfer(ws)`, `dismissTransfer()`. The email's link only opens the app, which refreshes.

**Delete and leave.** `deleteWorkspace(ws, typedName)` (6D; `NAME_MISMATCH` until it matches).
`leave(ws)` (6F; Admins and Editors, `OWNER_CANNOT_LEAVE` for the Owner) resolves the ended links.

**Migration.** Runs by itself after sign-in, in one window of the origin at a time (Web Locks), and
is safe to repeat: `state.migration` says how far it got (`left > 0`: it resumes on the next
sign-in). `migrate()` runs it again. A pre-workspace room that is already closed and was never
uploaded is left as it is (its file stays a local file of this device).

## The board 46 UI

| File | What it shows |
|---|---|
| `../ui/WorkspaceShare.tsx` | Share popover 1A to 1E (`useCloudShareKind` routes a room to 1C or 1D/1E) |
| `../ui/WorkspacePane.tsx` | Settings › Workspace (2A): plan, members, invites, edit requests, ownership |
| `../ui/WorkspaceDialogs.tsx` | 2B invite, 2C remove (toast 2D), 6A transfer, 6B accept, 6D delete, 6F leave |
| `../ui/WorkspaceHost.tsx` | Mounted once per window: 6B, toasts 6C, 3B, 3C, the start refresh |
| `../ui/WorkspaceBanner.tsx` | Editor banners 5A to 5D and 6E, with Save a copy |
| `../ui/workspace-parts.tsx` | Store hooks, member avatar, 28-tall buttons, the toast stack outside an editor |
| `workspace-view.ts` | Copy and picks (names from emails, footnotes, prices, banner kind) |
| `../../home/WorkspaceHome.tsx` | Home 4A: KIMO CLOUD group, `#/workspace/<id>`, and the web `#/cloud/<room>` route |

1F is the relay wizard's Subscribe step (`../ui/CloudWizardSteps.tsx`): it names the first workspace,
and `CloudStore.startCheckout({ workspaceName })` creates it before the workspace checkout.

Names: Kimo Cloud knows people by email only, so names and initials come from the email's local
part (`personName`).

## Not done yet

- The desktop document host (`host/`, `mp.*` RPC) owns shared files on desktop: bound files and the
  re-share run in windows without a host (web, and desktop windows when no host answers). The host
  needs the same `setCloudFiles` hooks and the migration over its `rooms.json` registry.
- After sign-out, a deleted workspace's copy opens editable until its account signs in again
  (bindings are per account).
