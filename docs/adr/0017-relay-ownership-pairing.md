# 0017. Relays belong to devices: claim on first use, add devices with pairing links, no create secret in the UI

- **Status:** Proposed
- **Date:** 2026-10-21
- **Deciders:** project owner
- **Teardown refs:** 12 (v2 multiplayer), 13.3 (local endpoint security)
- **Amends:** [0016](0016-multiplayer-transport-and-sessions.md) decision 8 (who may create rooms on a relay)
- **Implementation contract:** [docs/spec/multiplayer.md](../spec/multiplayer.md) §6.1, §6.2, §7.1, §12, §13, §14.2, §14.9, §16.1, §16.9, §17, §18

## Context

[0016](0016-multiplayer-transport-and-sessions.md) lets a relay restrict room creation with a
shared create secret (`KIMO_CREATE_SECRET`, sent as the `kimo-create-secret` header on admin op 1).
The relay setup wizard (board 42) generates an "Automatic" secret and puts it into the relay it
starts or deploys (This computer, the Docker command, the Fly.io one-click), and keeps it in the
OS keychain or browser storage. The owner finds the result too technical:

- The Railway template generates its own secret, so the user copies a variable from Railway's
  dashboard into Kimo and switches Settings to "Custom".
- Settings › Multiplayer has a "Create secret" row with Automatic, Custom, Show, Copy and
  Regenerate, and a regenerate means restarting the relay.
- The Share popover asks for the secret on first run and hides the field once the URL is saved,
  so a second device has nowhere to enter it.
- A secret is a bearer credential: anyone who sees it (a screenshot, a shell history, a shared
  Railway project) can create rooms, and taking that away means rotating it on every device.

Facts that shape the replacement:

- Room content is end-to-end encrypted. Room creation grants storage and bandwidth on the
  operator's bill, never access to anyone's designs (rooms are isolated by their own root keys and
  room keys, §3 to §9 of the spec).
- Every Kimo install already does Ed25519 in WebCrypto (room root and link keys). Web keeps room
  keys as non-extractable `CryptoKey`s in IndexedDB; the desktop host keeps its room registry in
  `${kimoHome}/multiplayer/rooms.json` as JWK, and keeps the relay secret in the OS keychain
  (`keyring`, service `kimo`).
- Admin commands already carry an `iat` (ms) and a random 16-byte nonce; the relay rejects
  `|now - iat| > 5 min` and nonces it has seen.
- Kimo's own setup paths control the relay's environment (local process env, the Docker command
  text, the Fly secrets). The Railway path does not: the template is deployed in Railway's UI.
- Clients reject a `/version` whose `protocol` is not exactly `kimo-mp/1`, and an older client
  reads an unknown error code by its HTTP status.

## Decision

**A relay has an owner set of device public keys. Only an owner device can create rooms. The
first Kimo that reaches an unclaimed relay claims it; further devices join the set with a
single-use pairing link from an owner device. Kimo's own setup paths pre-claim the relay with the
device's public key, so there is no claim window and no secret anywhere in the UI.**

1. **Device key.** One Ed25519 key pair per Kimo install, created on first need. Web: a
   non-extractable `CryptoKeyPair` in IndexedDB `kimo-multiplayer` (database version 2, store
   `device`), like the room keys. Desktop: the 32-byte private seed in the OS keychain (service
   `kimo`, account `relay.device-key`), imported as a non-extractable `CryptoKey` at startup. The
   desktop deliberately does not follow its room registry (plain JWK in `rooms.json`): the device
   key is the one credential that outlives every room, and the keychain is already in use for the
   relay secret it replaces. The public key travels as base64url (43 characters).
2. **Owner set.** Stored in `relay.sqlite` in the data dir (`owners` table, schema version 2),
   with a display name and the time each device was added. Empty means **unclaimed**. An
   unclaimed relay refuses room registration (`RELAY_UNCLAIMED`); joining by capability link,
   sync, snapshots and blobs need no ownership and are unchanged. Each relay also gets a random
   16-byte `relayId` at first boot, so signed requests and pairing tokens cannot be replayed on
   another relay the same device owns.
3. **Owner commands.** `POST /owner` takes one signed command (type 4), the same shape and replay
   rules as admin commands (`iat` within 5 minutes, nonce stored 10 minutes), signed by the
   device key and bound to the `relayId`. Ops: claim, devices, pair, remove, cancel pairing. Each
   is one round trip.
4. **Claim.** Allowed only while the set is empty; the insert is one SQLite transaction, so of two
   racing claims the first wins and the other gets `409 RELAY_CLAIMED`. A claim by a device that
   is already an owner answers `200` (idempotent). When `KIMO_CREATE_SECRET` is set, the claim must
   carry it (`claimSecret`, compared in constant time, `403 CREATE_FORBIDDEN` otherwise). Kimo
   claims in the wizard's Test step and, failing that, on the first Start sharing.
5. **Register.** Admin op 1 gains a required `owner` member: the device public key and its
   signature over the command's room, nonce, `iat` and root public key. Not an owner is
   `403 NOT_OWNER`. The `kimo-create-secret` header no longer authorizes register (except the
   legacy rule in 10). Revoke, rotate, close and sweep stay root-key only: a room keeps working
   when the device that created it is later removed.
6. **Pairing.** An owner device mints a pairing token locally (no round trip): `relayId`, a random
   `jti`, `iat` and `exp` (15 minutes, at most 60), signed by the issuing device. The link is
   `<web-origin>/pair#<relay-url>/<token>` (`kimo://pair#...` on desktop), so like a capability
   link it never reaches a server log. The new device opens it and sends op pair signed with its
   own key. The relay checks the issuer is still an owner, the signature, expiry and that the
   `jti` was not used, then adds the device and burns the `jti` in one transaction
   (`PAIRING_EXPIRED`, `PAIRING_USED`). An owner can burn an unused link early (cancel).
7. **Remove.** An owner removes any device, itself included, except the last one (`409
   LAST_DEVICE`). Removing does not close rooms; it stops that device creating new ones and
   invalidates pairing links it issued.
8. **Pre-claim (`KIMO_OWNER_KEY`).** A comma-separated list of device public keys. At boot, if
   the owner set is empty, the relay seeds it with these keys. Kimo's own paths set it to this
   device's public key: the local relay's environment, the Docker command, the Fly.io deploy, and
   the Railway deploy link if Railway prefills it (see 9). A public key is not a credential, so it
   can show in a command, a URL or a log, and these paths no longer generate or store any
   secret. The wizard's Test then finds the relay already yours.
9. **Railway.** The template drops `KIMO_CREATE_SECRET`. Kimo appends this device's key to the
   deploy link as a prefilled `KIMO_OWNER_KEY` variable when Railway honours it (to verify; a
   staff answer on Railway's forum says template links accept variable query parameters, the docs
   do not). Without prefill, the relay starts unclaimed and the wizard's Test claims it as soon as
   the user pastes the domain. Either way the user copies nothing but the domain.
10. **Recovery and other variables.** `KIMO_RESET_OWNER=<value>` clears the owner set at boot and
    logs a warning, **once per distinct value**: the relay stores a hash of the value it acted on
    and ignores the same value on later boots. So a forgotten variable does not re-open the relay
    on every redeploy, and resetting again means changing the value. `KIMO_CREATE_SECRET` stays as
    an optional operator setting that gates the claim. For migration only, while the relay is
    unclaimed and the secret is set, a legacy register (header, no `owner`) with the right secret
    is still accepted, so a not yet updated Kimo keeps working until a new Kimo claims the relay
    with the stored secret.
11. **Version and compatibility.** The protocol string stays `kimo-mp/1`: sync, tokens and
    envelopes are unchanged, and bumping it would make every current client call an updated relay
    "not a relay". `/version` gains `ownership: 1`, `owner: "unclaimed" | "claimed"`,
    `claimSecretRequired` and `relayId`, and keeps `createSecretRequired` (deprecated, now equal
    to `claimSecretRequired && owner == "unclaimed"`) and `POST /create-secret/check` for one minor
    release. A new client on a relay without `ownership` uses the legacy path with the secret it
    already stores, and otherwise shows "Relay needs an update".
12. **UI.** The words "secret" and "create secret" leave the UI: the Settings row, the wizard's
    secret block and the Share popover field go away. Settings › Multiplayer lists the relay's
    devices (name, this device, when added) with Add device (pairing link) and Remove. The only
    remaining input is "Setup code", shown when an operator set `KIMO_CREATE_SECRET` by hand and
    the relay is still unclaimed.

## Threat note: the claim race

An unclaimed relay belongs to whoever claims it first. Someone who learns a fresh relay's URL
before its owner's Kimo does can claim it.

- **What they gain:** room creation on the owner's relay, so storage and bandwidth on the owner's
  bill up to the relay's quotas (`KIMO_MAX_ROOMS`, room quotas, rate limits). Nothing else: they
  cannot read, join or alter any room, because rooms are keyed by their own root keys and content
  is end-to-end encrypted. They also cannot remove a later owner, because there is none: the real
  owner is locked out, not attacked.
- **How the owner sees it:** the wizard's Test and Start sharing say "This relay belongs to
  another Kimo". The fix is `KIMO_RESET_OWNER=1`, restart, claim, and the relay keeps the owner's
  data. The reset does not touch rooms; rooms the squatter created stay until room expiry
  (`KIMO_ROOM_TTL_DAYS`) or until the owner wipes the data dir, since only their root keys can
  close them.
- **Where the window exists:** only on relays that start unclaimed with no `KIMO_OWNER_KEY` and no
  `KIMO_CREATE_SECRET`: Railway without prefill, and relays an operator deploys by hand. This
  computer, Docker and Fly.io are pre-claimed and have no window. Quick tunnel names
  (trycloudflare.com) are random and also pre-claimed.
- **Railway domains are guessable.** Generated domains follow `<service>-production[-xxxx].up.railway.app`
  with a short suffix, and Railway serves them under a wildcard certificate, so certificate
  transparency does not leak them but a scanner polling `/version` across the name space can find
  unclaimed relays within minutes of boot.
- **A claim deadline does not help.** A deadline (claims accepted only for N minutes after boot)
  stops nobody who scans continuously, since such a scanner claims within seconds. It only helps
  against a relay left unclaimed for days, at the price of a new failure ("restart your relay to
  claim it") for the user who deploys and comes back tomorrow. We take no deadline, as the lead
  proposed. What actually closes the window is pre-claim (8, 9), which is why it is part of this
  decision.

Other notes:

- Pairing links are bearer credentials for 15 minutes and one use. Anyone who intercepts one can
  add a device. The link is shown with its expiry and a Cancel; the owner sees every device in
  Settings and can remove it.
- Device names are stored on the relay in clear text. The operator is the owner, so this is
  informational, but names must not include anything Kimo would not show the owner.
- A lost only device (cleared browser data, a wiped machine) locks room creation until
  `KIMO_RESET_OWNER`. Existing rooms keep working for guests; their owner-side admin (revoke,
  rotate, close) was lost with the room keys anyway. Settings suggests adding a second device.
- `KIMO_CREATE_SECRET` and the legacy register path keep the old bearer model alive only for
  relays whose operator chose it, and only until the relay is claimed.

## Consequences

- No copy-paste in any wizard path except the relay domain. No secret is generated, shown,
  regenerated or stored by Kimo's own paths. Regenerate and its restart dialogs (board 42 E to H)
  go away.
- Adding a second device is explicit (pairing) instead of implicit (copying a secret). One extra
  step for multi-device owners, in exchange for per-device removal.
- New relay surface: `POST /owner`, three tables, a `relayId`, two variables, six error codes.
  Schema version 2 with an additive migration.
- New client surface: a device key store per platform, owner command signing, pairing link parse
  and format, a `/pair` route, the devices list in Settings, and claim in the wizard and Share.
- `startSharing` no longer takes `createSecret`. The relay setup store keeps a stored secret only
  for migration (legacy relays, and claiming a relay deployed with one) and deletes it after a
  successful claim.
- Desktop and web installs are separate devices; a user with both pairs them once.
- Existing setups migrate without user action: a relay deployed with Kimo's secret is claimed
  silently with that secret on the first Test or Start sharing after both sides update.
- Follow-ups: the self-host, Fly.io and Railway guides swap the secret for `KIMO_OWNER_KEY` and
  `KIMO_RESET_OWNER`; boards 41 and 42 are redesigned; the legacy paths (header register,
  `createSecretRequired`, `/create-secret/check`, client fallback) are removed one minor release
  later.

## Alternatives considered

- **Keep the create secret, hide it better.** Copying still needed on Railway, secrets cannot be
  removed per device, and a second device still has to receive the secret somehow. Rejected.
- **Set `KIMO_CREATE_SECRET` silently in Kimo's own paths and send it while claiming** (the lead's
  first proposal). It closes the claim window as well, but keeps a secret in the keychain, in the
  Docker command and in Fly secrets, and leaves the Railway gap. `KIMO_OWNER_KEY` closes the same
  window with a public value. Kept only as the operator option and migration path.
- **Claim deadline.** See the threat note: no protection against a scanner, a real failure mode
  for slow users.
- **Let a correct `KIMO_CREATE_SECRET` add a device to an already claimed relay.** Smoother for
  multi-device users who shared one secret, but it keeps a permanent bearer credential that
  defeats removal. Rejected; such users pair once.
- **Mint pairing tokens on the relay.** Would let the relay list pending links, but costs a round
  trip and relay state for every link. Local minting plus a relay-side used list and an explicit
  cancel gives the same guarantees.
- **Bump the protocol to `kimo-mp/2`.** Current clients would report an updated relay as "not a
  relay" although sync is unchanged. A capability field (`ownership: 1`) is enough.
- **Accounts or a hosted directory.** Out of scope by [0016](0016-multiplayer-transport-and-sessions.md):
  no accounts, no project services.

## Revisit when

- Railway's template link turns out not to prefill variables and scanning for unclaimed relays is
  seen in practice: then consider a Kimo-signed claim code shown in the relay's boot log, or a
  Railway-specific deploy through its CLI (`railway deploy -t <code> -v KIMO_OWNER_KEY=...`).
- Short invite codes (v2.1) land: pairing tokens should use the same redemption scheme.
