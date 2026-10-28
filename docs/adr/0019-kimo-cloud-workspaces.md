# 0019. Kimo Cloud workspaces: a subscription belongs to a workspace, editors take paid seats, Kimo Cloud holds the keys

- **Status:** Proposed
- **Date:** 2026-10-28
- **Deciders:** project owner
- **Teardown refs:** 12 (v2 multiplayer)
- **Amends:** [0018](0018-kimo-cloud.md) decisions 2 (who pays), 3 (accounts) and 5 ("Kimo Cloud
  stores ciphertext and never sees designs", now true of the relay but not of Kimo Cloud as a
  whole); builds on [0016](0016-multiplayer-transport-and-sessions.md) (relay, capability links)
  and [0017](0017-relay-ownership-pairing.md) (device keys)

## Context

[0018](0018-kimo-cloud.md) sells Kimo Cloud per owner: one account pays a flat $8 a month, and
everyone else joins a file by capability link with no account. An edit link is a bearer token, so
a team of five shares one subscription and nobody can tell who edits. That is fine for a
freelancer and a client, and wrong for a studio: there is no way to invite a teammate, see who is
in, remove someone who leaves, or charge for the extra people.

Facts that shape the answer:

- **Accounts already exist.** Kimo Cloud binds Ed25519 device keys (0017) to an email account with
  a magic link, and every app request to it is signed (kimo-cloud `docs/architecture.md`).
- **Links carry the key.** A file's room key travels in the link fragment (spec §3, §7), so
  opening a team's files without a link means someone has to hand members their room keys.
- **Keeping that end to end costs friction.** Two drafts of this ADR kept Kimo Cloud blind: one
  wrapped a workspace key to every device (new devices wait for a teammate's approval, owners keep
  a recovery key), the other to every account (a passphrase on each new device). The owner chose
  the simplest product instead: sign in and everything opens.
- **The relay already has what membership needs.** Tokens expire and can be refreshed on a live
  connection (spec §11.2 `refresh`), revoking a `jti` closes its sockets at once (§14.4), and the
  owner policy checks the account on edit joins and writes (§14.12). Whoever holds a room's root
  and link keys can use all of it.
- **Polar supports seats.** Seat-based products with graduated tiers, monthly or yearly, charged
  immediately and prorated when seats are added
  ([Polar seat-based pricing](https://polar.sh/docs/features/seat-based-pricing)). It is marked
  beta.
- **Cloud has no customers to migrate.** It launched, but the only subscription is the owner's own,
  on a 100% discount code.

## Decision

**A Kimo Cloud subscription belongs to a workspace: members with roles and a shared file list.
Kimo Cloud keeps every workspace file's keys and issues every token for workspace rooms:
short-lived edit tokens only to members with a seat, and view links on a member's request.
Editors are invited by email and pay per seat; viewers keep joining by anonymous view link.
Signing in is all a member needs on any device. The relay protocol does not change.**

### 1. Plan and seats

- $8 a month or $80 a year per workspace, including the owner's editor seat. Each extra editor
  adds $4 a month or $40 a year. Prices in USD, tax added at checkout (0018 decision 4).
- Viewers are free and unlimited, and are not members.
- Storage: 10 GB per workspace plus 5 GB per extra editor seat.
- A seat starts when an invitee accepts (pending invites are free) and is charged at once,
  prorated for the rest of the period. A removed seat ends at the period's end, with no refund
  for the rest of it.
- Seats count people, not devices. AI agents, local or remote, edit with tokens issued to a
  member's device and use that member's seat.
- No free tier and no trial, as in 0018.

Billing is one Polar seat-based product per interval with graduated tiers (seat 1 at $8 or $80,
seats 2 and up at $4 or $40). The seat count equals the number of editors including the owner.
Kimo Cloud changes the count through Polar's API and keeps membership in its own database: Polar's
own seat assignment and claim emails are not used. Checked in the Polar sandbox on 2026-10-28:
the tiers price 3 seats at $16 a month ($160 a year), an added seat can be charged at once and
prorated, a removed seat can wait for the period's end, and none of it needs Polar seat
assignments. Polar still calls seat-based pricing beta; if it changes, the fallback is a base
product plus a quantity-priced add-on on one subscription.

### 2. Workspaces, roles, invites

- **Roles:** Owner (one per workspace, holds billing, transferable to an Admin), Admin (invites,
  removes, approves access requests), Editor (edits, shares view links). Every role is a paid
  seat.
- **Many workspaces per account.** An account may own or join any number of workspaces; the app
  has a workspace switcher. A seat is per workspace.
- **Invites by email.** An Admin enters an email and sees the seat price before sending.
  Accepting signs the person in with the existing magic-link flow; the workspace's files open at
  once.
- **Request edit access.** Someone who opens a workspace file by view link gets "Request edit
  access". It signs them in and notifies the workspace's Admins; approving adds the seat.
- **Outside collaborators** (a client who edits one file) take a normal seat and see the whole
  file list, and are removed when done.
- Every subscription is a workspace: a solo owner has a one-person workspace and a file list of
  their own shared files.

### 3. Keys and the file list

- **Kimo Cloud keeps each workspace file's root, link and room keys**, with the file's name, in
  the cloud API's database. Keys are encrypted at rest with a master key that lives only in the
  service's secret store, never in the database or its backups.
- **Sharing a file.** Start sharing on Kimo Cloud picks the workspace without asking when the
  account has one, and asks when it has several. The app asks Kimo Cloud to add the file; Kimo
  Cloud generates the keys, registers the room on the hosted relay itself (its own service key is
  the room's owner device, which the policy module allows), records it under the workspace, and
  returns the room id, room key and an edit token. The app uploads the first snapshot as today. A
  file belongs to one workspace.
- **The file list.** A signed request returns the workspace's files with their room keys to any
  member device. Every member sees every file; there are no per-file permissions.
- **Opening a file that is not on disk** creates a Kimo-managed local replica: a workspace folder
  on desktop, browser storage on web. "Save as" copies it anywhere. The `.kimo` format does not
  change.
- **Devices.** A new device signs in and has everything. A lost device is signed out from another
  one or from support; there is no recovery key.
- **Fast by default.** The app keeps the file list, room keys and current edit tokens on the device
  and refreshes them in the background, so opening a file never waits on Kimo Cloud, and a file
  that is already on disk opens before the network answers. The UX goal for Kimo Cloud is: sign in
  once, everything opens, no extra steps.

### 4. Tokens

- **Edit tokens** are issued only to a seated member's device, for 24 hours, and the app swaps in a
  fresh one before expiry with `refresh` (spec §11.2). `refresh` keeps the role, so when a lapse or
  a renewal changes it the app reconnects with the new token instead. Kimo Cloud records each token's `jti` with
  the account and device. Origins are as today (`user`, `agent:<id>`, `mcp:<client>`).
- **View links** are issued on a member's request with the expiry they pick; Kimo Cloud signs the
  token with the room's link key, records who asked, and the app adds the room key as the
  fragment. Admins can list every live link with who made it, and end any of them.
- **No edit links** on Kimo Cloud. The Share popover of a workspace file offers view links and
  "Invite editor".
- **Room admin** (revoke, rotate, close, sweep) is done by Kimo Cloud with the room's root key over
  the relay's existing admin API (spec §6), on a member's signed request.
- The policy module keeps its job (§14.12): rooms belong to the workspace (the relay's `account`),
  register and write answers follow the workspace's plan, storage limits included.

### 5. Removing a member

Removing someone must not break the links everyone else shared:

1. Kimo Cloud stops issuing them tokens and keys.
2. It revokes every unexpired token issued to them, edit tokens and the view links they created,
   with admin op 2. The relay closes their sockets at once (§14.4). The removal dialog lists those
   view links, with their files, so an Admin can send new ones to the people who had them. Links
   other members created keep working.
3. Existing files keep their room keys. The removed member keeps their local copies and the room
   keys of files they opened, but cannot get a token, so cannot fetch new edits. Someone holding an
   old room key and a copy of the relay's ciphertext could read later edits; for a file where that
   matters, an Admin runs **Re-key file**: a fresh room with new keys gets the current state and
   blobs, the old room is closed, and that file's view links end.

Leaving a workspace voluntarily runs the same steps.

### 6. Lapse

0018 decision 8 applies per workspace: new rooms refused, a grace period with writes, then
read-only, then retention. Through retention Kimo Cloud keeps serving the file list and room keys
to members, so they keep opening their replicas; it stops issuing edit tokens when writes stop.

### 7. Privacy and wording

- On Kimo Cloud, workspace files are encrypted on the relay with keys that Kimo Cloud holds in a
  separate service. A leak of the relay's data alone exposes nothing, but Kimo Cloud as an
  operator could read workspace files, and sees file names, members and who edits when.
- Self-hosted relays keep the 0016 model unchanged: keys live only in links and on devices.
- The site, the pricing page, the docs and the Kimo Cloud option in the relay wizard must say this
  plainly. "End-to-end encrypted" is no longer used for Kimo Cloud; it stays true for self-hosting.

### 8. Migration

The owner's existing account becomes a one-person workspace in a kimo-cloud migration. Its Cloud
rooms' root and link keys cannot be uploaded: they are non-extractable `CryptoKey`s in the local
registry (`OwnedRoom`, `apps/web/src/multiplayer/registry.ts`). So on first open the app re-shares
each Cloud room in its registry through Kimo Cloud (a new room from the current state, created and
registered by Kimo Cloud) and closes the old room itself with its root key, which also ends the old
room's edit links.

### 9. What lives where

- **kimo-cloud (private):** workspaces, members, roles, invites and their emails, access requests,
  seat counts and Polar seats, file keys and names under the master key, token issuing and the
  `jti` records, room admin against the relay, the policy module, storage per workspace.
- **Open repo:** the Kimo Cloud client in `apps/web` (sign-in exists; adds the file list, keys and
  tokens from Kimo Cloud, refresh before expiry, workspace UI as with board 43), behind the
  existing Cloud API base URL config. The relay, its protocol and `packages/sync` do not change.
  No paywall or license check enters the open repo.

## Consequences

- Kimo Cloud can sell to teams, and owners can see, invite and remove the people who edit.
- The simplest member experience: sign in on any device and the workspace opens. No device
  approvals, passphrases or recovery keys.
- No relay protocol change and no new crypto formats in the open repo; the work is kimo-cloud and
  the app's Cloud client and UI.
- **Kimo Cloud gains custody of keys.** A breach of the cloud API together with the relay's data
  would expose workspace designs. The master key needs care: kept out of the database and its
  Litestream backups, with a rotation procedure. A KMS can replace the secret store later.
- Members depend on Kimo Cloud to open the list and to get edit tokens. A 24-hour token keeps an
  editor working through a short Kimo Cloud outage; viewers never depend on it.
- The privacy claim changes for Kimo Cloud. kimo-site's Privacy Policy and Terms say designs are
  end-to-end encrypted and "we cannot read them"; they, the pricing page and the wizard copy must
  change before workspaces ship.
- Removal is immediate through revocation, and ends only the links the removed member created.
  Content keys do not rotate on their own; Re-key file covers a sensitive file, at the cost of that
  file's links.
- Tests in kimo-cloud cover token issuing only to seated members, revocation on removal, key
  encryption at rest and the policy decisions, per CLAUDE.md "What to test" (security and
  protocol).
- kimo-cloud's architecture.md and api.md need workspaces, members, invites, requests, seats, file
  keys, token issuing and room admin, and the entitlement table keyed by workspace instead of
  account.
- Design comes first: a new board in desing.kimo for the workspace switcher, members and roles,
  invite with the seat price, request access (both sides), the file list, and removal with its
  link list.

## Alternatives considered

- **End to end workspaces with device keys** (this ADR's earlier drafts): a workspace key wrapped
  to each device, a person approving every new device, a recovery key per workspace, and either a
  relay allowlist of registered tokens or relay-issued links. Kimo Cloud stays blind, but every
  new device waits for a click and owners keep a recovery key. Rejected by the owner for the
  friction.
- **End to end workspaces with account keys and a passphrase.** Approvals per person instead of
  per device, a passphrase on each new device. Less friction than device keys, still a secret to
  remember. Rejected by the owner. It is the path back if teams ask for end to end workspaces.
- **Workspace as billing and members only, files still shared by link.** Smallest change, no key
  custody. Rejected by the owner: a team expects to open the team's files without collecting
  links.
- **Per-file access inside a workspace.** Rejected for v1; every member sees every file.
- **Keep anonymous edit links on Cloud and count only invited members.** No enforcement, so seats
  would be an honor system. Rejected.
- **Auto-add a seat when someone signs in through an edit link.** Surprise charges for the owner.
  Rejected in favour of request and approve.
- **Rotate every link key and re-key every room on removal.** Ends every view link in the
  workspace each time someone leaves. Rejected as unusable.
- **Workspaces on self-hosted relays too.** Deferred: 0018 lists team admin as a hosted feature.

## Open questions

- Edit token lifetime (24 hours suggested).
- Where the master key lives on Railway and how it rotates.
- Invite and access request expiry (7 days suggested), and how Admins are notified (email plus an
  in-app badge suggested).
- Desktop workspace folder location (for example `~/Kimo/<workspace>`).
- Owner transfer and deleting a workspace.
- The new privacy wording for the site and the wizard.

## Revisit when

- Teams ask for end to end encrypted workspaces: offer the account key and passphrase design as an
  option per workspace.
- Teams ask for per-file or per-project access.
- Polar seats leave beta or change shape.
