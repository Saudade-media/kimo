# Multiplayer for Kimo v2: transport, sessions and CRDT

Decision material for the v2 multiplayer milestone (teardown 12, "v2"). Researched 2026-10-19;
every price, limit and version below was checked against the source listed in [Sources](#sources)
on that date, with a fact-check pass applied on top. Items still unverified are marked
**(unverified)**. The decision is drafted as
[ADR 0016](../adr/0016-multiplayer-transport-and-sessions.md); the implementation contract is
[docs/spec/multiplayer.md](../spec/multiplayer.md).

**Revision (2026-10-19, owner decisions).** The first draft recommended a trusted relay holding a
plaintext `DocStore`, with end-to-end encryption as a later opt-in, and an optional project-run
default relay. The owner decided otherwise: **end-to-end encrypted from the start, with a blind
relay and client-side compaction; no project-run relay, hosting is the user's choice; full SHA-256
plus HMAC blob ids; owner-triggered blob GC; OFL-only font sharing; shaders as hash-named
assets.** This document now reflects those decisions; §7 records them against the original open
questions.

Grounding in the repo: [`packages/sync/src/network.ts`](../../packages/sync/src/network.ts) (planned
provider and relay), [`apps/server/README.md`](../../apps/server/README.md) (stub, `/sync` returns
501), [ADR 0001](../adr/0001-monorepo-and-server-readiness.md) (server readiness),
[ADR 0002](../adr/0002-document-authority-in-tauri.md) (document host, Rust is a router),
[ADR 0003](../adr/0003-crdt-yjs-behind-docstore.md) (Yjs behind `DocStore`, re-evaluate Loro at v2),
[ADR 0008](../adr/0008-mcp-sidecar-in-rust.md) (no `bun build --compile` in the desktop bundle).

## TL;DR

- **Build a small, blind, Kimo-owned relay in `apps/server`** (Bun, `varUint` framing in the
  y-protocols style, one room per document, `bun:sqlite` for persistence). The relay stores an
  append-only log of **encrypted** Yjs updates and **encrypted** snapshots that clients produce;
  it never decodes a document. The same relay runs wherever the user chooses: a local process,
  the Docker image, or the user's own Fly.io, Railway or VPS deploy. **The project runs no
  default relay.**
- **End-to-end encrypted from the start.** A 256-bit room key travels only in the link fragment;
  updates, snapshots, presence and asset bytes are AES-GCM encrypted with keys derived from it.
  Compaction is done by a client, and so is post-merge repair (one designated client).
- **Invites are signed capability links.** A link carries a token that grants `view` or `edit` on
  one room, with an expiry and an id for revocation, plus the room key. The room id is derived
  from the room's public key (self-certifying). Short typed codes (game-lobby style) are a v2.1
  convenience that redeem into the same token. "Host from desktop" is a later deployment mode of
  the same relay, not a separate protocol.
- **Images, fonts and other binary assets never enter the CRDT.** They stay content-addressed
  blobs referenced by hash, as today, encrypted per blob and named on the relay by an HMAC of
  their full SHA-256, on `/blob/<room>/<id>` gated by the same capability token. Peers fetch
  missing blobs on demand and show the missing-asset placeholder until they arrive.
- **Stay on Yjs for v2.** Run a time-boxed Loro spike behind the `DocStore` contract tests after
  the first multiplayer build ships; switch only on measured wins.
- **Not chosen as the primary path:** Hocuspocus, Y-Sweet and y-websocket (plaintext servers),
  Supabase Realtime (no catch-up sync), Liveblocks and Tiptap Cloud (no free self-host, price),
  pure P2P (no role enforcement, no availability when the host is offline), y/hub (AGPL).

## 1. Goal and requirements

Small groups (2 to about 10 people) editing one `.kimo` document together in real time, with
presence (cursors, selections), from the web app or the desktop app.

| # | Requirement | Source |
|---|---|---|
| R1 | Open source and self-hosted in spirit: free to run on a LAN, a home box or your own VPS or PaaS | Owner |
| R2 | Hosting is the user's choice: no project-run relay; the relay URL is always user provided, and running one is cheap (one process, a few dollars a month on a PaaS) | Owner (revised) |
| R3 | No accounts in v2. A code or link grants a role (`view` or `edit`). Accounts may come later | Owner |
| R4 | A game-style "host a session, others join with a code" flow is desirable; the shape is open | Owner |
| R5 | Must not block remote AI agents later (`agent:<id>` presence and tokens) | Owner |
| R6 | Local-first: the editor keeps working offline and merges on reconnect; the desktop `.kimo` file stays the authority ([ADR 0002](../adr/0002-document-authority-in-tauri.md)) | Teardown 9.4 |
| R7 | Nothing outside `editor-state` imports Yjs; providers move opaque bytes through `DocStore` | [ADR 0003](../adr/0003-crdt-yjs-behind-docstore.md) |
| R8 | No compiled Bun runtime inside the desktop bundle (LGPL relinking, size) | [ADR 0008](../adr/0008-mcp-sidecar-in-rust.md) |
| R9 | End-to-end encrypted: the relay never sees plaintext updates, presence or asset bytes | Owner (added) |

Non-goals for v2: SaaS scale, horizontal scaling, accounts, comments UI (the `comment` role is
reserved in the token format but not shipped), server-side validation or export (impossible on a
blind relay).

## 2. Options at a glance

"Small group cost" is the monthly cost of running it for a handful of rooms. "Cap auth" is how
well a no-accounts capability token maps onto view/edit. "Blind" is whether the server can run
without seeing plaintext.

| Option | License | Self-host | Small group cost | Yjs fit | Cap auth | Persistence | Blind | Agent future | Maturity |
|---|---|---|---|---|---|---|---|---|---|
| **Kimo Bun relay** (`apps/server`) | MIT (ours; yjs, lib0 are MIT) | One Bun process or Docker image; LAN, VPS, Fly, Railway | $0 self-host; Fly ~$2.50-3, Railway $5 (user's account) | Clients exchange encrypted Yjs updates through `DocStore`; the relay never touches Yjs | Best: token checked on connect and per request, roles enforced by our code | `bun:sqlite` encrypted update log + client-made encrypted snapshots, blobs on disk | Yes, by design | Agents are headless clients holding the room key | Ours to build; primitives mature |
| y-websocket server (reference) | MIT | Node process | $0 + host | Reference protocol; plain `Y.Doc` | None built in | None (in memory) unless you add it | No: sync step needs plaintext | Neutral | README calls it a dev server / starting point |
| Hocuspocus v4 (Tiptap) | MIT | Node, Bun, Deno, Workers (via crossws, since v4) | $0 + host | Yjs, but its own framing (document name prefix since v2.0) | Good: `onAuthenticate`, `readOnly` | SQLite, database, S3, Redis extensions | No: server holds a `Y.Doc` | Good (hooks) | High: v4.7.1 on 2026-10-12, 2.6k stars |
| Y-Sweet (Jamsocket) | MIT | Rust binary, local dir or S3 | $0 + host + S3 pennies | Yjs (yrs), own client and token model | Very good: `full` / `read-only` client tokens | S3 or filesystem | No | Weak (Rust, no TS hooks) | Slowing: last commit 2025-12-04, Jamsocket joined Modal (2025-07-10) |
| Supabase Realtime (Broadcast + Presence) | Apache-2.0 server | Full Supabase stack, 4 GB RAM minimum | Free (pauses after 1 week idle) or Pro $25 | Bytes over Broadcast (binary needs supabase-js 2.91.0+); no server handshake, no catch-up | Possible via self-minted JWT + RLS **(unverified end to end)** | Build your own (Postgres/Storage) | Payloads could be encrypted, but no catch-up | Reasonable | Platform mature; Yjs providers alpha |
| Liveblocks | Proprietary server | Enterprise add-on only | Free capped (10 conn/room); Pro $30 | Own protocol via `@liveblocks/yjs` | Strong but expects identities; 3,000 anonymous conn/month | Vendor | No | Vendor-gated | High (company) |
| Tiptap Cloud | Proprietary (hosted Hocuspocus) | No (use Hocuspocus) | $49-59/month **(unverified)** | Hocuspocus protocol | JWT app tokens | Vendor | No | Neutral | High |
| Cloudflare Durable Objects (y-partyserver) | ISC (OSI) | Cloudflare only; no LAN or desktop story | Free plan has SQLite DOs; Paid $5 floor | Yjs, y-websocket-like provider | Good: `onBeforeConnect` | DO SQLite | Only if rewritten to our blind protocol | Good | Medium: active, post-acquisition churn |
| y-webrtc (P2P) | MIT | Tiny signaling server + TURN | ~$0-5 | Own signaling protocol, second provider | Weak: shared password only, no roles | None when peers leave | Yes (peer to peer) | Poor | Low activity; prototypes only |
| iroh (P2P in Rust) | MIT or Apache-2.0 | Self-hostable `iroh-relay` | $0-6 | No Yjs provider; bytes over QUIC | Dial-by-key, roles in app | None | Yes | Good | 1.0 shipped June 2026, 12.8k stars |
| rust-libp2p | MIT | Relay nodes need public IPs | $0-6 | No provider | App-level | None | Yes | Fair | Mature; DCUtR hole punch ~70% measured |
| y/hub (formerly y-redis) | **AGPL-3.0** or commercial | Needs Redis + S3/Postgres | Higher | Yjs | Custom | Redis + S3 | No | Fine | Ruled out: license conflicts with an MIT, cheap self-host goal |

Not evaluated in depth and ruled out on shape: Jazz, ElectricSQL (different data model, not a
Yjs relay), Ably and Pusher (hosted pub/sub, same catch-up gap as Supabase), PartyKit-hosted
(superseded by y-partyserver on Cloudflare).

### Where a user can run their relay

The project runs no relay. These are the options the self-host and deploy guides cover, with the
user paying their own host.

| Host | What a small relay costs | Notes |
|---|---|---|
| Own machine or VPS | $0 to a few $ | `bun run --filter @kimo/server start` or the Docker image behind a TLS proxy (Caddy) |
| Fly.io | shared-cpu-1x 256 MB $2.19/month, 512 MB $3.69; volume $0.15/GB/month; shared IPv4 free | No free compute tier. About $2.50-3/month all in. Guide ships a `fly.toml` |
| Railway | Hobby $5/month including $5 usage; $20/vCPU, $10/GB RAM, $0.05/GB egress; volume $0.15/GB/month | A ~0.25 GB relay stays inside the credit, so the floor is a flat $5. No WebSocket duration limit documented (confirm in a soak test) |
| Render | Needs a paid instance plus disk; free web services spin down **(prices unverified)** | Spin-down rules out the free tier |
| Cloudflare DO | Free plan includes SQLite DOs; Paid $5 includes 1M requests, 400k GB-s | Only if the blind protocol is ported to a second runtime |

Sizing: a blind relay holds no document in memory, only connection state and the current room
rows, so 256 MB is enough for small groups; disk (blobs and snapshots) is what grows.

## 3. Invite and session flow

### The three shapes

| | 1. Host from desktop | 2. Relay-issued room codes | 3. Signed capability links |
|---|---|---|---|
| Prior art | VS Code Live Share, Steam lobbies, Zed | magic-wormhole, croc, game lobby ids | Excalidraw rooms, Figma-style share links, Y-Sweet tokens |
| How you join | Host clicks "Host", guests connect to the host machine (LAN IP, mDNS, tunnel or hole punching) | Host gets `7F3K-Q9XM`, guests type it, relay maps code to room | Host copies a link, guests open it |
| Server needed | None on LAN; a tunnel or relay over the internet | Yes, always (rendezvous) | Yes (the user's relay) |
| Works when host is offline | No: session ends with the host | Only if the relay also stores the doc | Yes, the relay keeps the encrypted room |
| Web user can host | No | Yes | Yes |
| Browser guests | Hard: no UDP hole punching in browsers; `https` pages cannot open `ws://` to a LAN IP (mixed content) | Yes | Yes |
| Roles | Host is the trust root, can admit and kick | Code issued per role | Role is in the signed token |
| Security | Fine on LAN; tunnel services add dependencies | Short codes are low entropy: need single use, short TTL, rate limits (or PAKE), and must not reveal the room key to the relay | 128+ bit tokens, signature verified by the relay; room key in the fragment |
| Relay state | n/a | Code table (stateful) | Stateless verification (plus a small revocation list) |
| Durable "share this file" link | No | No (codes are ephemeral) | Yes |

### Recommendation

**Shape 3 is the primitive; shape 2 is a convenience layer on top of it; shape 1 is a deployment
mode of the same relay.** All three end in the same place: a WebSocket to `/sync/<room>` that
presents a capability token, with the room key known only to clients. That keeps one protocol,
one auth check and one code path for humans, agents and every deployment.

### UX

1. **Share.** In a document, the owner clicks **Share**. First time only: Kimo asks for a relay
   URL (the user's own server; there is no default), probes it, creates a room on it and seeds it
   with an encrypted snapshot of the open document.
2. **Pick a role and expiry.** `Can view` or `Can edit`; expiry `1 day`, `7 days` (default), or
   `Never`. Since every relay is the user's own, `Never` is the user's call. Kimo shows a link and
   a copy button.
3. **Join.** A guest opens the link. Web: the app opens directly into the room. Desktop: the
   `kimo://` deep link opens it (falls back to the web app). Guests pick a display name and
   colour (stored locally, no account) and appear in the presence bar.
4. **Codes (v2.1).** **Invite with code** shows `7F3K-Q9XM` next to the link. The code is single
   use (or N uses), valid 10 minutes, rate limited per IP, and optionally needs the owner to click
   **Admit** (Live Share style). It redeems into a normal capability token and the room key,
   through a PAKE or a code-stretched key so the relay never learns the room key.
5. **Manage.** The Share panel lists active links (role, created, expires) with **Revoke**, plus
   **Reset all links**, **Clean up shared assets** (the owner sweep) and **Stop sharing**
   (closes the room and deletes its data on the relay).

### How tokens map to roles

A capability token is a fixed binary payload signed with Ed25519, encoded base64url (exact bytes
in the spec):

| Claim | Meaning |
|---|---|
| `room` | Room id: 20 bytes, `SHA-256("kimo/v1/room-id" || rootPublicKey)` truncated; base32 in URLs |
| `role` | `view` \| `edit` (`comment` reserved, not shipped in v2.0) |
| `kid` | Link key id; a token signed by a replaced link key fails after **Reset all links** |
| `iat`, `exp` | Issued at and expiry (unix seconds, `exp = 0` never expires), checked on every connect and request |
| `jti` | 128-bit token id, used for revocation and the Share panel |
| `origin` | Optional: `user` (default), `agent:<id>`, `mcp:<client>`. The relay enforces it, so a client cannot claim to be an agent it is not |

- **Who signs.** Each room has an Ed25519 **root** key pair generated by the owner's app. The
  room id is derived from the root public key, so the relay can register the room on first
  contact by checking a root signature, with no trust-on-first-use race. The root key certifies a
  **link** key pair, and the link key signs tokens. The relay stores the root public key and the
  current link certificate. The owner's app mints links offline; the relay verifies them with no
  shared secret. The same scheme works unchanged when the relay runs on the owner's desktop.
- **Link format.** `https://<web-origin>/join#<relay-url>/<room>/<token>/<room-key>`. Everything
  after `#` stays out of HTTP requests and server logs of the web origin. The client sends the
  token in the first WebSocket message, not in the query string, because browsers cannot set an
  `Authorization` header on a WebSocket and query strings end up in logs; HTTP requests use an
  `Authorization` header. The room key never leaves clients.
- **Role enforcement.** `edit` connections may append updates. `view` connections get the
  catch-up and live updates; any update they send is dropped and answered with an auth denial.
  The client also switches into a hard read-only mode (store read-only, ops disabled), because a
  dropped update would leave that replica permanently diverged from the room
  (see [risks](#8-risks)).
- **Presence.** Viewers may publish presence (cursor, selection), since following along is part
  of viewing. Presence is encrypted; the relay attaches each peer's token `origin` and `role` in
  plaintext next to the ciphertext, and receivers trust those fields, not the encrypted ones. The
  relay rate limits presence per connection.
- **Expiry.** Checked on connect and per HTTP request. A connection that outlives its token's
  `exp` is closed and the client goes offline with its local replica intact.
- **Revocation.** Revoking a `jti` adds it to the room's revocation list on the relay and closes
  any live connection using it. **Reset all links** certifies a new link key, which invalidates
  every outstanding link at once while keeping the room id. Revoked users keep whatever they
  already synced locally and still know the room key, as with any shared file.
- **Owner authority.** Room admin (register, revoke, reset, sweep, stop sharing) is a request
  signed with the root private key held by the owner's app; it is never inside a shareable link.

### Encryption

- **End-to-end from v2.0 (owner decision).** A symmetric 256-bit room key travels in the link
  fragment (Excalidraw model); the relay stores and forwards ciphertext only. HKDF-SHA256 derives
  separate keys for document updates and snapshots, presence, the blob-id MAC, and each blob.
  AES-256-GCM with random 96-bit IVs; associated data binds the room id and the message kind.
- **What this rules out.** Server-side validation, server-side catch-up by state vector,
  headless export and hosted MCP. Catch-up becomes "latest encrypted snapshot plus encrypted log
  tail", compaction moves to a client, and post-merge repair moves to one designated client.
  Remote agents become headless clients that hold the room key.
- **View-only.** Relay enforced. A viewer could forge valid ciphertext (it holds the room key),
  so the relay must never accept writes from a `view` token; a relay operator holding a viewer's
  link could inject updates. Since the operator is the user or someone they chose, this is
  accepted for v2.
- **Revocation.** Relay enforced (revocation list, link key reset). Re-keying the content means
  sharing again into a new room.
- **Metadata.** The relay still sees sizes, timing, sequence numbers, peer counts, token roles,
  origins and expiries, and the number and size of blobs.
- [ADR 0005](../adr/0005-kimo-file-format.md) ("never encrypted") is about the `.kimo` file and is
  unaffected: encryption here is on the wire and at the relay.

### Host from desktop, concretely (v2.1)

- **LAN.** The desktop app can start a relay for nearby guests. Per [ADR 0008](../adr/0008-mcp-sidecar-in-rust.md)
  we do not ship a compiled Bun runtime, and per [ADR 0002](../adr/0002-document-authority-in-tauri.md)
  the document lives in the JS document host. So: a small Rust WebSocket listener frames and
  forwards bytes to the document host over IPC (Rust stays a router), and the room, auth and log
  logic is the same TypeScript relay module the server uses, behind a storage interface that is
  not tied to `bun:sqlite`. Discovery via mDNS/Bonjour (`_kimo._tcp`) for desktop guests;
  browser guests on the LAN need TLS (a later problem) or use the desktop app.
- **Internet.** No NAT traversal in v2. The host's app opens an outbound connection to the user's
  relay and shares a normal link. Tunnels (Tailscale Funnel, cloudflared) are documented as a
  do-it-yourself option. iroh is a later experiment for desktop-to-desktop direct paths.

## 4. CRDT: Yjs vs Loro

**Verdict: stay on Yjs for v2; run a gated Loro spike after the first multiplayer build ships.**

| | Yjs (current) | Loro | Automerge 3 |
|---|---|---|---|
| License, health | MIT; yjs 13.6.33 (2026-09-23), y-websocket 3.1.0; 22.9k stars | MIT; loro-crdt 1.16.4 (2026-09-30); 6.2k stars | MIT; 3.5.0 (2026-09-16); repo layer still on alpha tag |
| Tree moves | Kimo-owned cycle repair (`planTreeRepairs`, teardown 9.2) | Native Movable Tree: cycle-closing remote moves are skipped | No native moves |
| Per-origin undo | `Y.UndoManager` + `trackedOrigins`, already used for `groupUndo` / `discardUndo` | Per-peer, local only; per-origin needs redesign with exclude-origin prefixes | None |
| Data shape | Flat `Y.Map` matches the `.kimo` table 1:1 | `LoroTree` + `LoroMap` per node; the instance-owned `at` groups do not map 1:1 | Maps fit |
| Relay | y-websocket protocol, the most providers and servers | loro-protocol + `loro-websocket` (TS `SimpleServer`, Rust server with SQLite, `read`/`write` auth hook, optional E2EE); both described as minimal servers for local testing or self-hosting | automerge-repo sync server |
| Bundle | ~18 kB gz, pure JS | WASM (~180 kB, **unverified**) | WASM |
| Performance | Unmeasured on Kimo's 5k-node doc | Faster import claimed; Loro dropped its memory metric (WASM misreports); no trustworthy head-to-head | 10x memory cut in 3.0 |

Why not switch now: nothing in Loro is needed to ship small-group multiplayer, every Kimo piece
(per-origin undo, cycle repair, IndexedDB persistence, the provider shape) already exists on
Yjs, Loro's concurrent-move semantics differ from the normative rule in teardown 9.2 (which the
git merge driver also implements), and Loro's relays are young. Why not "never": native tree
moves would delete a class of Kimo-owned code, including the repairer election below.

The spike (1 to 2 weeks): a `LoroDocStore` behind the same contract tests (including concurrent
reparent and per-origin undo), measured on the 5k-node M1 document for load time, process RSS
(not WASM-reported memory), update size for drags and bulk edits, and cold-sync size; plus a
model for `at` groups. Switch only if it wins on at least two of: cycle-repair bugs found by
property tests, load time or memory over budget, history needs Yjs cannot meet. Because the
relay only stores encrypted bytes and clients only use `DocStore`, a switch replaces the codec
inside clients, not the relay, auth, log or blob layers.

## 5. Assets: images, fonts and shaders

Multiplayer is not only the node tree: a design file shows images, uses font files and may
reference shaders. These need their own path.

### Today

- Assets are content-addressed files, `assets/<sha256-16>.<ext>`
  ([0005](../adr/0005-kimo-file-format.md)), referenced from nodes as `./assets/<hash>.<ext>`.
- Desktop writes them beside the `.kimo`; the web app keeps them in IndexedDB
  (`kimo-assets-<fileId>`). Both implement the same `AssetStore` interface
  (`apps/web/src/lib/assets.ts`), which already has `keys()`, `bytes()` and a hash-verifying
  `putKey(key, bytes)`: almost exactly the primitive sync needs.
- The document header can carry an asset manifest (`assets`: key → mime, bytes, size, name);
  image inserts add their entry in the same op group, fonts are listed when the file is saved.
- Limits: 20 MB per asset, 100 Mpx per image, a format sniffer. Fonts are stored on first use.
  Shaders are plain `./shaders/<name>.glsl` files, not content-addressed. Garbage collection is
  the manual **Clean up assets** action.

### Rule: blobs stay out of the CRDT

Yjs keeps deleted content's history, so a binary stored in a `Y.Map` would bloat every snapshot
and every catch-up for every peer, and could never be removed without resetting the room. The
CRDT carries only the reference (the hash) and the manifest entry; the bytes travel separately
and are immutable, so the hash is both the cache key and the dedupe key.

### Integrity: full SHA-256 on the wire (owner decision)

The 16-hex key (64 bits) is fine against accidents but not against a deliberate collision by a
collaborator. Files keep the 16-hex key; every shared asset's manifest entry also carries the
full digest (`sha256`, 64 hex, a new optional member of the format's asset entry). Receivers
verify the full digest after decrypting, then store with `putKey`, which re-checks the key.

### Transport

| Option | Blob path | Notes |
|---|---|---|
| **Kimo Bun relay (chosen)** | `PUT` / `HEAD` / `GET /blob/<room>/<id>` on the relay; ciphertext on disk | The relay cannot hash plaintext; integrity is AES-GCM plus the full SHA-256 checked by clients. Storage is the operator's disk (or a mounted volume). An S3-compatible backend is a later option for operators who want it |
| Supabase | Supabase Storage with signed URLs | Only if Supabase is revisited |
| Managed Yjs (Y-Sweet, Liveblocks, ...) | None built in | Not chosen |
| P2P (later) | iroh-blobs on desktop (BLAKE3 verified streaming, range requests); chunked WebRTC data channels on web | A blob is only available while a peer holding it is online; a relay can act as a blob cache |

Rough cost on a user's PaaS: a 10-person file with 200 MB of images is a fraction of a 1 GB
volume ($0.15/month on Fly or Railway); egress is the cost that grows.

### Encryption and naming

- Each blob is encrypted with AES-256-GCM under a per-blob key
  `HKDF(roomKey, info = "kimo/v1/blob/" + sha256hex)`.
- The relay stores it under `id = HMAC-SHA256(blobMacKey, sha256)` with `blobMacKey` derived from
  the room key. Two members uploading the same image produce the same id, so the relay dedupes
  within a room without learning the content or its hash; there is no cross-room dedupe, and a
  bare id reveals nothing about other rooms.

### Flow

1. **Drop (works offline).** Unchanged: sniff, size-check, hash, `put` locally, reference the
   hash; the manifest entry now also records the full `sha256`.
2. **Upload on connect.** An `edit` client computes the ids of the blobs it holds, asks the relay
   which are missing (`POST /blob/<room>/missing`) and uploads only those. Dedupe is free: the
   same image dropped twice, or by two people, is one blob.
3. **Fetch on demand.** A peer that sees a reference it does not have shows the checkerboard
   placeholder with a fetching state, `GET`s the blob, decrypts it, checks the full SHA-256 and
   stores it with `putKey`.
4. **Fast first paint (v2.x).** A ~256 px WebP preview generated at drop time, stored as its own
   blob, fetched first. It never replaces the original.

### Auth

The capability token gates blobs exactly like sync: `PUT` needs `edit`, `GET` and `HEAD` accept
`view` or `edit`. Paths are scoped by room.

### Garbage collection (owner decision: owner-triggered only)

A blob unreferenced in one replica may still be referenced by a peer or restorable by someone's
undo, and a blind relay cannot see references anyway. So the relay never deletes a blob when a
reference disappears. The owner's app runs a sweep on request: it sends the list of blob ids the
current document references, signed with the root key; the relay marks every other blob of the
room as unreferenced and deletes those that stayed unreferenced for the grace period (30 days by
default) on a later sweep. A re-upload or a later keep list clears the mark. Local **Clean up
assets** stays manual and also scans the undo stacks. A deleted but still referenced blob shows
the placeholder and is uploaded again by any member who still has it.

### Fonts and shaders (owner decisions)

- **Fonts:** sharing font files can breach their licence. Auto-share only fonts known to be freely
  redistributable: the bundled offline pack and Google Fonts faces. Any other font syncs by
  family name only; each collaborator supplies the file, and a warning hook lets the UI tell the
  owner which families were not shared.
- **Shaders:** at share time each shader referenced by a relative path is stored as a hash-named
  asset (`./assets/<hash>.glsl`) and the paints are repointed, so it travels like any blob and no
  relative path needs to resolve on another machine.

### Limits on the relay

20 MB per blob (matching today's `MAX_ASSET_BYTES`; the relay checks ciphertext size), a per-room
quota (500 MB by default, configurable by the operator), and `PUT` rate limits.

## 6. Recommendation

### Default architecture

```
 web app / desktop UI window           desktop document host (ADR 0002)
        |  replica DocStore                     |  authoritative DocStore, .kimo file
        |                                       |  + local room replica (IndexedDB)
        +---- NetworkProvider (packages/sync) --+
              encrypts/decrypts with the room key; compacts on request;
              repairs when elected; uploads/fetches encrypted blobs
                         |  wss://<user relay>/sync/<room>   kimo-mp/1 framing
                         v
              apps/server relay (Bun), blind
              - one room per document; no DocStore, no Yjs
              - capability token check, view/edit enforcement, origin stamping
              - bun:sqlite: encrypted update log + client-made encrypted snapshots
              - encrypted blobs on disk, per-room quota, owner-signed sweep
              - rate limits, payload caps, optional room-create secret
```

- **Relay** (`apps/server`): `Bun.serve` WebSockets and HTTP. Per room: a sequence counter, the
  encrypted log, the latest encrypted snapshot with the log position it covers, the root public
  key and link certificate, the revocation list, blobs. `/healthz` and `/version` stay; `/version`
  advertises the protocol and limits so clients can probe a URL.
- **Provider** (`packages/sync`): implements the network provider with presence. Local updates
  are encrypted and appended; remote entries are decrypted and applied in order. Offline edits
  keep accumulating locally and are sent as one delta on reconnect.
- **Compaction** (client): when asked by the relay, a caught-up `edit` client with no unsent
  changes uploads an encrypted full-state snapshot and the log position it covers; the relay
  drops covered entries after a short retention window.
- **File authority**: the relay never writes the `.kimo` file. A room is seeded from the owner's
  file as the first snapshot. The owner's document host merges room updates into its store and
  saves as usual. Every client keeps a local replica of the room's CRDT state, so reopening a
  shared file merges as a replica (the room cannot "win" over the file, because there is no
  overwrite, only merge).
- **Repair**: one designated repairer, the connected `edit` peer with the lowest relay-assigned
  peer id. Other connected replicas do not write repairs; offline replicas repair locally. This
  avoids N identical repair writes per merge.
- **Validation** means a coarse relay gate (role, origin, payload size, rate) plus post-hoc
  repair by the repairer. The relay must never drop an update from an `edit` connection after
  accepting it, because later updates depend on it causally and replicas would diverge silently.
- **Conformance**: the protocol spec ships byte-exact test vectors (tokens, room ids, key
  derivation, envelopes); client and relay tests run against them.

### Deployment paths (same code)

| Path | Who | Cost |
|---|---|---|
| Self-host process | `bun run --filter @kimo/server start` on a home box or VPS, behind a TLS proxy | $0 to a few $ |
| Docker image | `apps/server/Dockerfile` (oven/bun base), data in a volume | Host's price |
| User's PaaS | The user's own Fly.io (~$2.50-3/month) or Railway ($5/month) deploy, from the guides | User pays |
| Desktop LAN relay (v2.1) | Same-Wi-Fi sessions, no internet | $0 |
| Optional, later | Cloudflare DO port of the same protocol; S3-compatible blob storage | Only on demand |

Every relay ships with operator controls: optional room-create secret, room expiry after N days
without a connection, per-room quota, per-IP connection and message rate limits, max payload
(Bun's default `maxPayloadLength` is 16 MB; set it explicitly and route large state through the
snapshot endpoint).

### Phased rollout

| Phase | Scope |
|---|---|
| **v2.0** | Blind Bun relay with encrypted log, snapshots and blobs in SQLite and on disk; network provider with E2E encryption, presence (cursors, selections, names, colours), client-side compaction and repairer election; signed capability links with `view` / `edit`, expiry, revocation, reset; owner-signed blob sweep; headless share API; self-host docs, Docker image, Fly and Railway guides; protocol test vectors; `DocStore` contract tests that any CRDT implementation must pass; upload-on-connect and fetch-on-demand blobs with full SHA-256, room quota, font licence guard, shaders as assets. Share panel, presence UI and read-only banner after their design pass |
| **v2.1** | Desktop LAN hosting (Rust listener forwarding to the document host, mDNS discovery); short invite codes with single use, TTL, rate limits, optional **Admit**, and a key exchange that keeps the room key from the relay |
| **v2.2** | Loro spike and go/no-go; headless remote agents (a Bun client with the room key, token `origin: agent:<id>` / `mcp:<client>`); agent presence |
| **v2.x** | `comment` role (with comments); content re-keying without a new room; preview thumbnails for fast first paint; optional Cloudflare DO port; S3-compatible blob storage; accounts if wanted; iroh experiment for direct desktop paths |

## 7. Owner decisions (2026-10-19)

The first draft's open questions, as decided:

1. **Trusted relay or E2E?** E2E from the start, blind relay, client-side compaction, one
   designated client repairer.
2. **Fly.io or Railway for the default relay?** Neither: no project-run relay. Hosting is up to
   the user; the project ships the Docker image and guides for self-host, Fly and Railway.
3. **LAN hosting from desktop in v2.1?** Kept as planned for v2.1.
4. **Should viewers publish cursors?** Yes by default; a later UI may let the owner turn it off.
5. **Default link expiry?** 7 days in the UI; `Never` allowed, since every relay is the user's.
6. **Asset hash width?** Keep 16 hex in files; full SHA-256 in the manifest entry and on the
   wire; relay ids are HMACs of the full digest.
7. **Relay blob sweep?** Only on an owner action (root-key signed), with a grace period.
8. **Shaders and fonts?** Shaders become hash-named assets at share time. Fonts: auto-share only
   the bundled pack and Google Fonts; others by family name with a warning hook.
9. **Access model?** No accounts; signed capability links; self-certifying room ids; tokens
   compatible with later short codes.
10. **CRDT?** Stay on Yjs behind `DocStore`; Loro spike later.
11. **Crypto?** WebCrypto only; no new crypto dependencies.

## 8. Risks

- **Silent divergence from dropped updates.** Yjs updates are causally chained; a relay that
  drops one leaves later ones pending forever. Mitigation: role gating at the connection level,
  hard read-only for viewers, post-hoc repair rather than rejection, and a client that stops
  (rather than skips) when an entry fails to decrypt.
- **Repair storms.** Every replica repairing the same cycle writes duplicate ops. Mitigation:
  single designated repairer (above), repair off during catch-up, plus idempotent no-op
  detection.
- **Bad or hostile snapshots.** A buggy or malicious `edit` client could upload a snapshot that
  omits content, and the relay cannot check it. Mitigation: only clean (fully acknowledged)
  clients compact, the relay keeps the previous snapshot generation and a short log retention
  window, and edit links are for trusted people.
- **Large catch-up after long offline periods.** A big update can exceed payload limits.
  Mitigation: explicit `maxPayloadLength`, full state over the HTTP snapshot endpoint rather than
  the socket, and an oversize-update fallback that uploads a snapshot instead of a log entry.
- **Client cost.** Encryption and compaction run in the editor (or the desktop document host).
  WebCrypto AES-GCM is fast, but a full snapshot of the 5k-node document must be measured.
- **Key loss and leakage.** Links get pasted in chats and screenshots, and the link is the key.
  Mitigation: short default expiry, revoke and reset, and "stop sharing, share again" for a full
  re-key. Losing every link and the owner's device loses the room.
- **Browser support.** Ed25519 in WebCrypto needs recent engines (Chromium 137+, Safari 17+,
  Firefox 129+ **(unverified per version)**) and the Linux WebKitGTK webview must be checked.
  Clients feature-detect and report a clear error.
- **Owning the relay.** Compaction scheduling, eviction, backpressure, reconnect storms and rate
  limits are ours, but much smaller than with a plaintext `DocStore` per room.
- **Operator burden.** Without a default relay, first-time sharing needs a URL. The guides must
  make a Fly or Railway deploy a few commands.

**Unverified facts to check before building**

- Railway forced disconnects for long-lived WebSockets (not documented either way; soak test).
- Render instance and disk prices.
- Tiptap Cloud pricing.
- Ed25519 WebCrypto availability in the Tauri webviews (WKWebView, WebView2, WebKitGTK).
- Loro WASM size; Loro relay production readiness.
- Cloudflare quick tunnels carrying WebSockets reliably (only for the DIY tunnel docs).
- Rust `mdns-sd` crate license and a maintained Tauri Bonjour plugin.

## Sources

Relay and servers
- https://github.com/yjs/y-websocket
- https://github.com/yjs/y-websocket-server
- https://registry.npmjs.org/y-websocket
- https://docs.yjs.dev/ecosystem/connection-provider/y-websocket
- https://github.com/yjs/y-redis (y/hub, AGPL-3.0)
- https://github.com/ueberdosis/hocuspocus
- https://api.github.com/repos/ueberdosis/hocuspocus/releases/latest
- https://github.com/ueberdosis/hocuspocus/releases/tag/v2.0.0
- https://tiptap.dev/blog/release-notes/hocuspocus-4-stable-release
- https://tiptap.dev/docs/hocuspocus/server/examples
- https://tiptap.dev/docs/hocuspocus/server/extensions/database
- https://tiptap.dev/docs/hocuspocus/guides/scalability
- https://tiptap.dev/pricing.md
- https://github.com/jamsocket/y-sweet
- https://raw.githubusercontent.com/jamsocket/y-sweet/main/LICENSE
- https://modal.com/blog/jamsocket-is-joining-modal
- https://bun.com/docs/runtime/http/websockets

Hosting
- https://docs.fly.io/about/pricing
- https://docs.railway.com/reference/pricing/plans
- https://render.com/pricing
- https://developers.cloudflare.com/durable-objects/platform/pricing/

Managed and hosted alternatives
- https://supabase.com/docs/guides/realtime/limits
- https://supabase.com/pricing
- https://supabase.com/docs/guides/realtime/authorization
- https://supabase.com/docs/guides/realtime/broadcast
- https://supabase.com/docs/guides/auth/signing-keys
- https://supabase.com/changelog/46834-realtime-broadcast-now-supports-binary-payloads
- https://supabase.com/docs/guides/self-hosting/docker
- https://github.com/supabase/realtime
- https://npmjs.com/package/y-supabase
- https://discuss.yjs.dev/t/y-supabase-too-many-message-events/2447
- https://liveblocks.io/pricing
- https://github.com/cloudflare/partykit
- https://registry.npmjs.org/y-partyserver
- https://blog.cloudflare.com/cloudflare-acquires-partykit/

Peer to peer
- https://github.com/yjs/y-webrtc
- https://github.com/n0-computer/iroh
- https://raw.githubusercontent.com/n0-computer/iroh/main/README.md
- https://docs.iroh.computer/deployment/wasm-browser-support
- https://www.techtimes.com/articles/318490/20260616/peer-peer-library-iroh-10-ships-dial-devices-key-not-ip-address.htm
- https://arxiv.org/html/2510.27500v1
- https://probelab.io/blog/can-libp2p-punch-through-nats/
- https://developers.cloudflare.com/realtime/turn/faq/

Session and invite prior art
- https://learn.microsoft.com/en-us/visualstudio/liveshare/reference/security
- https://raw.githubusercontent.com/excalidraw/excalidraw/master/excalidraw-app/data/index.ts
- https://magic-wormhole.readthedocs.io/en/latest/welcome.html
- https://github.com/schollz/croc
- https://tailscale.com/kb/1223/funnel
- https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/
- https://tldraw.dev/docs/sync
- https://zed.dev/docs/channels

Assets
- https://developers.cloudflare.com/r2/pricing
- https://docs.iroh.computer/protocols/blobs/
- https://docs.jamsocket.com/y-sweet/features/storage

CRDT
- https://github.com/loro-dev/loro
- https://raw.githubusercontent.com/loro-dev/protocol/main/README.md
- https://registry.npmjs.org/loro-crdt
- https://registry.npmjs.org/loro-websocket
- https://loro.dev/docs/performance
- https://registry.npmjs.org/yjs
- https://registry.npmjs.org/@automerge/automerge
- https://automerge.org/blog/automerge-3/
