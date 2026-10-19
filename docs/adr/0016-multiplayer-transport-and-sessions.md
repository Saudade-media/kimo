# 0016. Multiplayer v2: an end-to-end encrypted Bun relay on Yjs, self-hosted, joined with signed capability links

- **Status:** Proposed
- **Date:** 2026-10-19
- **Deciders:** project owner (decisions recorded in [docs/research/multiplayer.md](../research/multiplayer.md) §7)
- **Teardown refs:** 9.1 (`apps/server` relay, `sync` network provider), 9.2 (CRDT row: Loro decision; tree moves), 9.4 (document authority, single writer per file), 11.1 (revisions), 11.4 (origins and undo), 12 (v2 multiplayer), 13.3 (cycles, op logs, local endpoint security)
- **Implementation contract:** [docs/spec/multiplayer.md](../spec/multiplayer.md)

## Context

Multiplayer is the v2 milestone (teardown 12). The seams already exist: every edit is an
`editor-state` op with an origin ([0001](0001-monorepo-and-server-readiness.md)), the CRDT is
exposed as opaque bytes through `DocStore` ([0003](0003-crdt-yjs-behind-docstore.md)), the desktop
window-to-host link already uses the provider shape ([0002](0002-document-authority-in-tauri.md)),
and `packages/sync/src/network.ts` describes a network provider and an `apps/server` relay that
today returns 501.

The owner's constraints: free to self-host (LAN, home box, own VPS or PaaS); no accounts, with a
link granting `view` or `edit`; interest in a game-style "join with a code" flow later; small
groups, not SaaS; nothing may block remote AI agents later (`agent:<id>` presence and tokens).
[0008](0008-mcp-sidecar-in-rust.md) rules out shipping a compiled Bun runtime in the desktop
bundle.

The owner then settled the open questions of the research (§7 there):

- **End-to-end encrypted from the start.** The relay never sees plaintext document updates,
  presence or asset bytes. The room key lives only in the link fragment and on clients.
- **Hosting is the user's choice.** The project runs no default relay. A relay URL is always one
  the user provides: their own process, the Docker image, or their own Fly.io, Railway or VPS
  deploy.
- Blobs travel with the full SHA-256 on the wire, the relay deletes blobs only on an owner
  action, fonts are shared only when known to be freely licensed, and shaders travel as
  hash-named assets.

Facts from the research (sources in the research doc, checked 2026-10-19):

- The stock y-websocket server describes itself as a development server or starting point, with
  no auth and no persistence. y/hub, the production Yjs server it points to, is AGPL-3.0.
- Hocuspocus v4 (MIT, v4.7.1 on 2026-10-12) and Y-Sweet (MIT, Rust) both keep a plaintext
  `Y.Doc` on the server; neither offers a blind mode.
- Yjs updates merge idempotently and commutatively, so an encrypted, ordered, append-only log of
  updates plus periodic full-state snapshots is a complete replication scheme that never needs
  the server to decode anything (the Excalidraw and `loro-websocket` E2EE designs rely on the
  same property).
- WebCrypto in Bun 1.3 and in current Chromium, Safari and Firefox provides Ed25519, AES-GCM,
  HKDF, HMAC and SHA-256 (checked in Bun 1.3.5 while writing the spec's test vectors), so no
  crypto dependency is needed.
- Fly.io shared-cpu-1x 256 MB is $2.19/month plus $0.15/GB volume; Railway Hobby is a flat
  $5/month including $5 of usage. These are now numbers for the user's own deploy guide, not a
  project budget.
- Loro (MIT, 1.16.4) has native tree moves, but its undo is per peer and its tree shape does not
  map 1:1 onto the `.kimo` node table.

## Decision

**Kimo builds its own small, blind relay in `apps/server` on Bun. Clients encrypt every document
update, snapshot, presence message and asset with keys derived from a room key that only they
hold. The relay stores and forwards ciphertext, enforces capability tokens, and never holds a
`DocStore`. Yjs stays behind `DocStore`. There is no project-run relay.**

1. **Relay.** `apps/server` serves `/sync/<room>` (WebSocket) and a few HTTP routes with
   `Bun.serve`. Per room it keeps an append-only log of encrypted updates, the latest encrypted
   snapshot and the log position it covers, encrypted blobs, and access-control state, in
   `bun:sqlite` plus a blob directory. It assigns a sequence number to each accepted update and
   fans it out. It cannot read, validate, merge or export documents. The wire protocol is
   `kimo-mp/1` (the y-protocols `varUint` framing, with Kimo message types for the encrypted log);
   it is not wire compatible with y-websocket, because a blind relay cannot answer a Yjs sync step.
2. **Client-side compaction.** The relay asks one caught-up `edit` client to compact when the log
   since the last snapshot grows past a threshold. That client encrypts its full state as a
   snapshot, uploads it with the log position it covers, and the relay then drops the covered
   entries (after a short retention window for reconnecting clients). Catch-up is: fetch the
   latest snapshot when needed, then stream the log tail.
3. **Repair.** Post-merge cycle and orphan repair is done by one designated client: the `edit`
   peer with the lowest relay-assigned peer id among those connected. Other connected clients do
   not repair; a client repairs locally only while offline. `DocStore` gains a switch for its
   automatic repair so the provider can apply this rule.
4. **Rooms and identity.** The owner's app creates an Ed25519 root key pair per room. The room id
   is the base32 of the first 20 bytes of `SHA-256("kimo/v1/room-id" || rootPublicKey)`, so it is
   self-certifying: the relay registers a room on first contact only when the request is signed by
   the matching root key, with no trust-on-first-use race. The root key certifies a separate link
   signing key; **Reset all links** replaces that link key, so the room id never changes.
5. **Capability tokens.** A token is a fixed binary payload (`room`, `role` `view` | `edit`, with
   `comment` reserved, `kid`, `iat`, `exp`, `jti`, optional `origin`) signed with the link key and
   encoded base64url. The relay verifies signature, room, key id, expiry and the per-room
   revocation list on connect and on every HTTP request, closes connections when their token
   expires or is revoked, drops updates from `view` connections with an auth denial, and stamps
   each peer's `origin` and `role` next to its encrypted presence. `view` clients enter a hard
   read-only mode. Updates accepted from an `edit` connection are never dropped later.
6. **Links.** `https://<web-origin>/join#<relay-url>/<room>/<token>/<room-key>`. Everything is in
   the fragment, so the token and the room key never reach any server log or query string. The
   client sends the token in its first WebSocket message and in an `Authorization` header over
   HTTP.
7. **Encryption.** A 256-bit random room key; HKDF-SHA256 derives the document key, the presence
   key, the blob-id MAC key and one key per blob. AES-256-GCM with a fresh 96-bit IV per message
   and associated data binding the room and the message kind. The relay sees sizes, timing,
   sequence numbers, peer counts and token metadata (role, origin, expiry), nothing else.
8. **Hosting.** No default relay. The relay URL is always user provided. The project ships the
   relay as one Bun process, a Dockerfile, self-host docs and short Fly.io and Railway guides. A
   relay can restrict who may create rooms on it with a shared create secret.
9. **File authority.** The relay never writes `.kimo` files. A room is seeded from the owner's
   file as the first snapshot; the owner's document host merges room updates and saves as before.
   Each client keeps a local CRDT replica per room so a reopened file merges as a replica instead
   of re-inserting every node.
10. **Assets.** Images, fonts and shaders never enter the CRDT. The manifest entry of every
    shared asset carries the full SHA-256 of its bytes. Each blob is encrypted under a per-blob key
    derived from the room key and that digest, and stored under
    `id = HMAC-SHA256(blobMacKey, sha256)`, so the relay dedupes within a room without learning
    content. `PUT` / `HEAD` / `GET /blob/<room>/<id>`: `PUT` needs `edit`, `GET` accepts `view`
    or `edit`. Clients upload missing blobs on connect and fetch referenced ones on demand,
    showing the missing-asset placeholder meanwhile; the local store verifies the plaintext hash.
    Limits: 20 MB per blob, a per-room quota (500 MB default, configurable), `PUT` rate limits.
    **GC**: the relay never deletes a blob because a reference disappeared; only an owner sweep
    signed with the room's root key does, after a grace period (30 days default).
11. **Fonts and shaders.** Font files are uploaded automatically only when known to be freely
    redistributable (the bundled offline pack, Google Fonts faces); other fonts travel by family
    name only and raise a warning hook. At share time, shaders referenced by relative path are
    copied into hash-named assets and paints are repointed, so they travel like any blob.
12. **Revocation.** Per-`jti` revocation on the relay, plus **Reset all links** (new link key).
    Revoked users keep what they already synced and still know the room key; the relay stops
    serving them. A full content re-key is "stop sharing, share again" (a new room).
13. **CRDT.** Yjs stays. A time-boxed Loro spike runs after the first multiplayer build, behind
    the `DocStore` contract tests, measured on the 5k-node M1 document; a switch needs its own ADR.
    This closes the "re-evaluate at multiplayer" item in [0003](0003-crdt-yjs-behind-docstore.md)
    §6 as "deferred with criteria".
14. **No NAT traversal in v2.** Internet sessions go through the user's relay. Desktop LAN hosting
    and short invite codes come later (v2.1); the token format and the relay's storage interface
    are kept compatible with both. Short codes must never let the relay learn the room key.
15. **Remote agents later.** Tokens already carry `origin` (`agent:<id>`, `mcp:<client>`) and the
    relay enforces it on presence and log entries. Because the relay is blind, a remote agent is a
    headless Kimo client holding the room key (the same provider in Bun), not code inside the
    relay.
16. **Agent area claims.** Two agents must not rebuild the same frame at once, but the relay is
    blind and cannot see node ids, so claims are soft and enforced by every client for its own
    agents. Before an agent (`agent:<id>`) applies an op group, it claims the nodes the group
    edits (ids, insert and move parents; claiming a node claims its subtree). MCP clients
    respect claims but hold none: they have no turn that would end a claim, so their
    concurrency stays on `baseRevision`. Agents of one session (a lead and the children it
    spawned, `agent:kimo.<session>.<n>`) never block each other: node scopes already split
    their work. The claim is kept
    in a per-document registry (`claimsFor(store)`, `@kimo/editor-state`) and published in the
    sealed presence as `PresenceState.claims` (records `{holder, ids, since, renewed, turn?,
    label?}`, `working` = their ids). An op group that touches a node inside, above or below
    another live claim, local or remote, by an agent or an MCP client, fails with the new MCP
    code `AREA_BUSY`
    (`{holder, holderLabel, ids, touched, since}`, retryable after a wait; the agent works
    elsewhere or waits). Claims taken at the same time on two clients are resolved the same way
    everywhere: the earlier `since` wins, then the lower holder id; the loser lets go on the next
    presence update. Claims end at turn end (with the placeholders, done, stopped or error), when
    the holder's connection or peer goes, and after 10 minutes without activity (every write
    renews). People are never blocked: an edit by a person inside an agent's claim makes that
    agent's next write fail once with `REVISION_CONFLICT` (detail `human-edit`), so it re-reads
    before it continues. We reuse `REVISION_CONFLICT` because every agent already knows to
    re-read and retry on it. Offline or single-player only the local registry applies, and a
    single agent only pays a parent walk per touched node. Op groups that only set or clear `placeholder`
    are exempt (a placeholder is never a lock).

Rollout: v2.0 relay, provider with presence, client compaction and repair, blob sync, links with
view/edit/expiry/revocation/reset, headless share API, Docker image, self-host and deploy guides.
UI (Share panel, presence, read-only banner) follows its own design pass in `desing.pen`. v2.1
desktop LAN hosting and short codes. v2.2 Loro spike, headless remote agents. Later: `comment`
role, content re-keying without a new room, accounts.

## Consequences

- No editor changes beyond read-only mode, presence and the Share UI; the provider plugs into the
  existing seam. `DocStore` gains one method (`setAutoRepair`).
- The relay is simpler than a plaintext relay (no `DocStore`, no Yjs in the server, memory
  independent of document size), but clients carry more: encryption, compaction, catch-up from
  snapshot plus log, repair election, blob sync.
- The relay cannot validate content, run headless exports or host MCP. A malicious `edit` member
  can write anything, including a damaging snapshot; the relay keeps the previous snapshot
  generation for manual recovery, and edit links should go to trusted people.
- `view` is enforced by the relay, not by cryptography: a viewer holds the room key and could
  produce valid ciphertext, but the relay never accepts writes from a `view` token. A relay
  operator who also has a viewer's link could inject updates; that operator is the user or
  someone the user chose.
- Self-hosting is one process with no external services. The project carries no hosting cost and
  no abuse surface; each operator sets quotas, room expiry and a create secret.
- Stock y-websocket tooling cannot talk to the relay. Conformance is tested against the Kimo
  protocol spec and its test vectors instead.
- The `.kimo` asset manifest gains an optional `sha256` member (full digest); the format spec and
  validator are updated. [0005](0005-kimo-file-format.md) ("never encrypted") is about the file
  and is unaffected.
- The desktop CSP must allow `https:` and `wss:` connections to user-provided relays.
- The `network.ts` module comment is rewritten to describe the blind protocol.
- Agent claims are cooperative: a modified client can ignore them, as it can write anything.
  A remote change cannot be attributed to a person or an agent (presence carries the claims, the
  log entry only the token origin), so a network change inside a local claim counts as a human
  edit unless a remote claim covers it; an agent may re-read once more than strictly needed.
- Losing every copy of the link and the owner's device loses the key: the relay alone cannot
  restore a room's content. The owner's device keeps the keys (non-extractable where possible)
  and the document.

## Alternatives considered

- **Trusted relay with a server-side `DocStore` (the research's first draft).** Enables
  server-side validation, catch-up by state vector, exports and hosted MCP. Rejected by the owner:
  plaintext at the relay is unacceptable when hosting is anyone's own box or PaaS.
- **Hocuspocus v4 as the relay core.** MIT, active, runs on Bun. Not chosen: its server holds a
  plaintext `Y.Doc`, its framing is its own, and blindness would mean rewriting its core.
- **Stock y-websocket server.** No auth, roles or persistence, and its sync step needs plaintext.
- **Y-Sweet.** Good token model, but Rust, plaintext documents, its own client protocol and slowing
  maintenance.
- **Supabase Realtime.** No catch-up sync, no ordering guarantee, a second provider protocol and a
  heavy self-host stack.
- **Liveblocks, Tiptap Cloud.** No free self-host; plaintext; price.
- **Cloudflare Durable Objects (y-partyserver).** Cannot run on a LAN or a user's box. Possible
  later as another deploy of the same blind protocol.
- **A project-run default relay on Fly.io or Railway.** Cheapest onboarding, but the owner chose
  not to run a service: no cost, no abuse handling, no implied uptime promise.
- **Pure P2P (iroh, libp2p, y-webrtc).** No availability when the host is offline, no role
  enforcement, browsers cannot hole punch. iroh may be revisited for direct desktop paths.
- **Room id chosen at random and registered first-come.** Simple, but a squatter who learns an id
  can register it first. A self-certifying id removes the race.
- **One signing key per room, rotated on reset.** Rotating it would change a self-certifying room
  id; the root key plus a certified link key keeps the id stable.
- **Switch to Loro now.** Native tree moves, but per-peer undo, a shape mismatch with the node
  table and different concurrent-move semantics from teardown 9.2. Deferred to a measured spike.

## Revisit when

- Client-side compaction or snapshot sizes become a bottleneck on the 5k-node document.
- The Loro spike meets its switch criteria, or the M1 benchmark shows Yjs over budget.
- Users need server-side features that require plaintext (hosted exports, hosted MCP): that would
  be an opt-in trusted room mode with its own ADR.
- Accounts are introduced (tokens may become account-bound), or content re-keying without a new
  room is needed.
