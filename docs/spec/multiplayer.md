# Kimo multiplayer `kimo-mp/1`: implementation contract

Status: Draft for v2.0 ([ADR 0016](../adr/0016-multiplayer-transport-and-sessions.md), research in
[docs/research/multiplayer.md](../research/multiplayer.md)). Licence: MIT. Date: 2026-10-19.
Amended 2026-10-21 by [ADR 0017](../adr/0017-relay-ownership-pairing.md): relays belong to a set
of device keys (§6.1, §6.2, §7.1, §14.11, §16.9). The create secret (`KIMO_CREATE_SECRET`, the
`kimo-create-secret` header, `/create-secret/check`) is removed.

This document is the contract four builders implement in parallel. It fixes every byte format,
message, endpoint, status code, file and exported signature that crosses a module boundary.
Anything not fixed here is the owning module's internal choice. The key words MUST, MUST NOT,
SHOULD and MAY are normative.

Ground rules for every module:

- Bun only (`bun test`, `bunx biome check <files>`). No new dependencies except `lib0` (already in
  `bun.lock` at 0.2.119) as a direct dependency of `@kimo/sync`. No crypto libraries: WebCrypto
  (`crypto.subtle`, `crypto.getRandomValues`) only.
- Nothing outside `packages/editor-state` imports Yjs ([ADR 0003](../adr/0003-crdt-yjs-behind-docstore.md)).
  `packages/sync/src/mp/**` imports neither `yjs` nor `@kimo/editor-state` (not even types), so the
  relay can load it without any CRDT code.
- No UI. No React components, panels, popovers or canvas overlays. Expose headless APIs only.
- No em dashes in code, comments, docs or strings.
- The relay is blind: no code path in `apps/server` may need a room key or decrypt anything.

## Contents

1. [Modules, files and ownership](#1-modules-files-and-ownership)
2. [Encodings](#2-encodings)
3. [Room identity and keys](#3-room-identity-and-keys)
4. [Capability tokens](#4-capability-tokens)
5. [Link certificates](#5-link-certificates)
6. [Admin commands](#6-admin-commands)
7. [Join links](#7-join-links)
8. [Key derivation](#8-key-derivation)
9. [Envelopes](#9-envelopes)
10. [Blobs: ids and encryption](#10-blobs-ids-and-encryption)
11. [WebSocket protocol](#11-websocket-protocol)
12. [HTTP API](#12-http-api)
13. [Error codes](#13-error-codes)
14. [Relay behaviour and persistence](#14-relay-behaviour-and-persistence)
15. [Client provider behaviour](#15-client-provider-behaviour)
16. [Web integration](#16-web-integration)
17. [TypeScript contracts](#17-typescript-contracts)
18. [Test plan](#18-test-plan)
19. [Test vectors](#19-test-vectors)
20. [Out of scope for v2.0](#20-out-of-scope-for-v20)

## 1. Modules, files and ownership

Four modules, one builder each. A builder MUST NOT edit another module's files. A builder that
needs something another module owns codes against the signatures in §17 and does not stub or
copy them.

### Module A: protocol core (`packages/sync/src/mp/`)

Pure, runtime-neutral (browser, Bun, worker). Formats, crypto, codec, links, HTTP client.

| File | Contents |
|---|---|
| `packages/sync/src/mp/bytes.ts` | base64url, base32, hex, UTF-8, big-endian integers, concat, constant-time compare, random bytes |
| `packages/sync/src/mp/errors.ts` | `MpErrorCode`, `MP_ERRORS` table (§13), `MultiplayerError`, close-code mapping |
| `packages/sync/src/mp/identity.ts` | Ed25519 key pairs, room id derivation (§3), link certificates (§5) |
| `packages/sync/src/mp/tokens.ts` | Capability tokens (§4), admin commands (§6) |
| `packages/sync/src/mp/owner.ts` | Owner commands (§6.1), pairing tokens (§6.2), the register owner proof (§6) |
| `packages/sync/src/mp/keys.ts` | Room key generation, HKDF derivations (§8), `RoomKeys` |
| `packages/sync/src/mp/envelope.ts` | Seal and open update, snapshot and awareness envelopes (§9) |
| `packages/sync/src/mp/blob-crypto.ts` | Blob ids, seal and open blobs (§10) |
| `packages/sync/src/mp/links.ts` | Join and pairing link format and parsing (§7, §7.1), relay URL normalization (§7) |
| `packages/sync/src/mp/protocol.ts` | Constants, limits, message types and the binary codec (§11) |
| `packages/sync/src/mp/http.ts` | `RelayHttpClient`: every HTTP endpoint of §12 |
| `packages/sync/src/mp/index.ts` | Barrel of everything above |
| `packages/sync/package.json` | Add export `"./mp": "./src/mp/index.ts"`, dependency `"lib0": "^0.2.119"` |
| `packages/sync/test/mp/*.test.ts` | Tests (§18.A), including `vectors.test.ts` against §19 |
| `packages/sync/test/mp/vectors.json` | The §19 vectors as JSON |

### Module B: network provider (`packages/sync/src/` and `packages/editor-state`)

| File | Contents |
|---|---|
| `packages/sync/src/network.ts` | Rewritten module comment (blind protocol), `NetworkProviderOptions`, `NetworkProvider`, `NetworkEvent`, `PresenceState`, `Awareness`, `createNetworkProvider` |
| `packages/sync/src/network-provider.ts` | The `NetworkProvider` implementation (state machine §15) |
| `packages/sync/src/awareness.ts` | `KimoAwareness`, encrypted presence (§15.9) |
| `packages/sync/src/room-state.ts` | `RoomStateStore`, `RoomCursor`, `MemoryRoomStateStore` |
| `packages/sync/src/index.ts` | Export the above (keep existing exports; `network.ts` types change as in §17.B) |
| `packages/editor-state/src/types.ts`, `yjs-store.ts` | `DocStore.autoRepair` getter and `setAutoRepair(enabled)` (§15.8) |
| `packages/sync/test/network*.test.ts`, `packages/sync/test/mp/fake-relay.ts` | Tests and an in-memory fake relay speaking §11 (§18.B) |
| `packages/editor-state/test/auto-repair.test.ts` | Tests for the switch |

### Module C: relay (`apps/server/`)

| File | Contents |
|---|---|
| `apps/server/src/index.ts` | `createServer`, `handleRequest` kept for `/healthz` and `/version`, re-exports |
| `apps/server/src/config.ts` | `RelayConfig`, `loadConfig(env)` (§14.9) |
| `apps/server/src/db.ts` | `bun:sqlite` schema (§14.2), migrations, queries |
| `apps/server/src/blobs.ts` | Blob files on disk (§14.6) |
| `apps/server/src/auth.ts` | Token, certificate and admin verification against a room |
| `apps/server/src/owners.ts` | Owner set, `relayId`, owner commands, pairing redemption, boot seeding and reset (§14.11) |
| `apps/server/src/rooms.ts` | Live rooms: peers, fan-out, compaction scheduling, expiry and revocation closes |
| `apps/server/src/ws.ts` | WebSocket handlers for `/sync/<room>` |
| `apps/server/src/http.ts` | HTTP routes of §12, CORS |
| `apps/server/src/rate-limit.ts` | Token buckets (§14.8) |
| `apps/server/src/main.ts` | Entry: env to config to server, signal handling |
| `apps/server/package.json` | Dependency `"@kimo/sync": "workspace:*"` (imports `@kimo/sync/mp` only) |
| `apps/server/Dockerfile`, `apps/server/.dockerignore` | Image (§14.10) |
| `apps/server/deploy/fly.toml` | Fly.io example |
| `apps/server/README.md` | Rewritten: what the relay is, config, endpoints |
| `docs/guide/relay/self-host.md`, `docs/guide/relay/fly.md`, `docs/guide/relay/railway.md` | Operator guides |
| `apps/server/test/*.test.ts` | Tests (§18.C) |

### Module D: web integration (`apps/web/`, `packages/core-schema/`, desktop CSP)

| File | Contents |
|---|---|
| `apps/web/src/multiplayer/registry.ts` | Local registry of owned and joined rooms, `RoomStateStore` over IndexedDB (§16.2) |
| `apps/web/src/multiplayer/share.ts` | `createShareService`: the headless API the UI will call (§16.1) |
| `apps/web/src/multiplayer/device-key.ts` | The install's device key: IndexedDB on web, keychain on desktop (§16.9) |
| `apps/web/src/multiplayer/ownership.ts` | Claim, devices, pairing links, remove (§16.9) |
| `apps/web/src/multiplayer/room-session.ts` | Attach order, replica persistence, file reopen (§16.3) |
| `apps/web/src/multiplayer/asset-sync.ts` | Upload on connect, fetch on demand, `withRemoteAssets` (§16.4) |
| `apps/web/src/multiplayer/font-policy.ts` | Which fonts are shared (§16.5) |
| `apps/web/src/multiplayer/shader-embed.ts` | Shaders to hash-named assets at share time (§16.6) |
| `apps/web/src/multiplayer/index.ts` | Barrel |
| `apps/web/src/lib/assets.ts` | `AssetInfo.sha256`, `contentDigest`, manifest entries carry `sha256` (§16.7) |
| `apps/web/src/host/document-host.ts` | `mp.*` host RPC methods (§16.8), no UI |
| `packages/core-schema/src/schema/document.ts` and its validator | `AssetEntry.sha256`, rule `ASSET_HASH_MISMATCH` (§16.7) |
| `docs/spec/kimo-format-1.0.md` | §12 rule 2 and the key list gain `sha256` |
| `apps/desktop/src-tauri/tauri.conf.json` | CSP `connect-src` adds `https: wss: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*` |
| `apps/web/test/multiplayer-*.test.ts`, `packages/core-schema/test/asset-sha256.test.ts` | Tests (§18.D) |

### Build order and the integration test

All four MAY start at once. Modules B, C and D import `@kimo/sync/mp` by the names in §17.A; their
tests run once module A has landed. If the orchestrator can sequence, land A first (it is the
smallest and fully pinned by §19). After all four land, run the cross-module test
`apps/server/test/e2e-multiplayer.test.ts` (owned by module C, written against §17 from the
start, marked `test.skipIf` until `@kimo/sync` exports `createNetworkProvider`).

## 2. Encodings

| Name | Definition |
|---|---|
| `u8`, `u32`, `u64` | Unsigned big-endian integers. `u64` values MUST be at most `2^53 - 1` and are handled as JS numbers |
| base64url | RFC 4648 §5 alphabet, **no padding**. Decoders MUST reject `=`, `+`, `/` and whitespace |
| base32 | RFC 4648 alphabet in **lowercase** (`abcdefghijklmnopqrstuvwxyz234567`), no padding, most significant bit first. Decoders MUST reject uppercase |
| hex | Lowercase |
| UTF-8 strings in JSON | Standard `JSON.stringify` output; signed bodies are signed as the exact bytes sent |
| `varUint`, `varString`, `varUint8Array` | lib0 `encoding` / `decoding` (`writeVarUint`, `writeVarString`, `writeVarUint8Array`) as used by y-protocols |
| Time | Tokens and certificates: unix **seconds**. Admin commands, database rows and logs: unix **milliseconds** |

## 3. Room identity and keys

Each room has three secrets, all created by the owner's app:

| Secret | Type | Held by | Purpose |
|---|---|---|---|
| Root key pair | Ed25519 | Owner's device only | Room identity; signs link certificates and admin commands |
| Link key pair | Ed25519 | Owner's device only | Signs capability tokens; replaced by **Reset all links** |
| Room key | 32 random bytes | Owner and every link holder (link fragment) | Root of all content encryption (§8) |

**Room id.** `roomIdRaw = SHA-256(UTF-8("kimo/v1/room-id") || rootPublicKeyRaw)[0..20]` (first 20
bytes; `rootPublicKeyRaw` is the 32-byte Ed25519 public key). `roomId = base32(roomIdRaw)`, which
is exactly 32 characters matching `^[a-z2-7]{32}$`. The relay MUST recompute this on registration
and reject a mismatch (`ROOM_ID_MISMATCH`). The room id is not secret: it grants nothing without a
token, and it reveals nothing about the content.

Key generation: `crypto.subtle.generateKey({ name: "Ed25519" }, extractable, ["sign", "verify"])`.
The owner's app SHOULD create private keys non-extractable and persist the `CryptoKey` objects by
structured clone (IndexedDB). Public keys are exported with `exportKey("raw", publicKey)` (32
bytes).

## 4. Capability tokens

A token is `base64url(payload || signature)`.

| Offset | Size | Field | Value |
|---|---|---|---|
| 0 | u8 | `version` | `1` |
| 1 | u8 | `type` | `1` (capability) |
| 2 | u8 | `role` | `1` view, `2` edit, `3` comment (reserved: relays MUST reject with `ROLE_UNSUPPORTED` in v2.0) |
| 3 | u8 | `flags` | bit 0: an `origin` follows. Other bits MUST be 0 |
| 4 | u32 | `kid` | Link key id the token is signed with (§5) |
| 8 | u64 | `iat` | Issued at, unix seconds |
| 16 | u64 | `exp` | Expiry, unix seconds; `0` = never |
| 24 | 16 bytes | `jti` | Random token id |
| 40 | 20 bytes | `room` | `roomIdRaw` |
| 60 | u8 + n | `origin` | Only if flag bit 0: length `n` (1 to 64) then `n` UTF-8 bytes |
| end | 64 bytes | `signature` | Ed25519 by the link private key over `UTF-8("kimo/v1/token\0") || payload` |

- `origin` MUST match `^(?:user|agent:[^\s]+|mcp:[^\s]+)$` (the `LocalOrigin` grammar of
  `@kimo/editor-state`). Absent means `user`. The `\0` in the signing context is one zero byte.
- A token without origin is 124 bytes (166 base64url characters). Parsers MUST reject trailing
  bytes, unknown versions, types other than 1 and nonzero reserved flag bits (`AUTH_INVALID`).
- Short codes (v2.1) MUST redeem into exactly this token format.

**Verification** (relay, on WebSocket `hello`, `refresh` and every authenticated HTTP request),
in this order, first failure wins:

1. Parse; any format error is `AUTH_INVALID`.
2. `room` equals the path's room id, else `AUTH_INVALID`.
3. The room exists and is not closed, else `ROOM_NOT_FOUND` / `ROOM_CLOSED`.
4. `kid` equals the room's current link key id, else `KEY_ROTATED`.
5. Signature verifies with the current link public key, else `AUTH_INVALID`.
6. `role` is 1 or 2, else `ROLE_UNSUPPORTED`.
7. `exp == 0` or `exp > now`, else `TOKEN_EXPIRED`.
8. `jti` is not revoked, else `TOKEN_REVOKED`.

## 5. Link certificates

A certificate binds a link public key to a room under the root key. Bytes:
`payload || signature`, transported base64url inside admin bodies.

| Offset | Size | Field | Value |
|---|---|---|---|
| 0 | u8 | `version` | `1` |
| 1 | u8 | `type` | `2` (link certificate) |
| 2 | u32 | `kid` | Link key id, starting at 1, strictly increasing per room |
| 6 | u64 | `iat` | Unix seconds |
| 14 | 20 bytes | `room` | `roomIdRaw` |
| 34 | 32 bytes | `linkPub` | Raw Ed25519 public key |
| 66 | 64 bytes | `signature` | Ed25519 by the root private key over `UTF-8("kimo/v1/cert\0") || payload` |

## 6. Admin commands

Room administration is a request signed by the root key. Bytes: `payload || signature`, sent as
the raw body of `POST /room/<room>/admin` (`content-type: application/octet-stream`).

| Offset | Size | Field | Value |
|---|---|---|---|
| 0 | u8 | `version` | `1` |
| 1 | u8 | `type` | `3` (admin) |
| 2 | u8 | `op` | `1` register, `2` revoke, `3` rotate, `4` close, `5` sweep |
| 3 | u8 | reserved | `0` |
| 4 | u64 | `iat` | Unix **milliseconds** |
| 12 | 16 bytes | `nonce` | Random |
| 28 | 20 bytes | `room` | `roomIdRaw` |
| 48 | u32 | `bodyLength` | Byte length of `body` (at most 1 MiB) |
| 52 | n | `body` | UTF-8 JSON, schema per op below |
| end | 64 bytes | `signature` | Ed25519 by the root private key over `UTF-8("kimo/v1/admin\0") || payload` |

| op | Body | Relay action | Success |
|---|---|---|---|
| 1 register | `{"rootPub": b64url(32 bytes), "cert": b64url(certificate), "owner": {"pub": b64url(32 bytes), "sig": b64url(64 bytes)}}` | Check `roomId(rootPub) == room`, verify the command with `rootPub`, check the owner proof (below), verify the certificate with `rootPub`. Create the room (any `kid >= 1`), or reopen a closed one with the same root key (`kid` greater than the stored one, so earlier tokens stay dead). Idempotent for an open room with the same root key and certificate | `201 {"room","kid"}` (created or reopened), `200 {"room","kid"}` (already registered) |
| 2 revoke | `{"jti": hex(16 bytes), "exp": number}` (`exp` of the revoked token, `0` never) | Insert into revocations; close live connections with that `jti` (`TOKEN_REVOKED`) | `200 {"revoked":true,"closed":n}` |
| 3 rotate | `{"cert": b64url(certificate)}` with `kid` greater than the current one | Replace the link key; close every live connection (`KEY_ROTATED`) | `200 {"kid":n,"closed":n}` |
| 4 close | `{}` | Close every connection (`ROOM_CLOSED`); delete log, snapshots, revocations, nonces and blobs (rows and files); keep the `rooms` row with `closed_at` so only the root key can reopen it | `200 {}` |
| 5 sweep | `{"keep": [blobId...], "graceDays"?: number}` (`graceDays` an integer at least 1; default from config) | §14.7 | `200 {"marked":n,"deleted":n,"kept":n,"bytesFreed":n}` |

Every command except register is verified with the stored root public key. The relay MUST reject
`|now - iat| > 300 000 ms` (`STALE_REQUEST`) and a `(room, nonce)` already seen (`NONCE_REPLAY`);
nonces are stored until `iat + 600 000 ms`.

**Owner proof (register).** Register also proves that an owner device of this relay (§14.11)
asked for the room. `owner.pub` is the device's raw Ed25519 public key and `owner.sig` is its
signature over

```
UTF-8("kimo/v1/register-owner\0") || relayId (16 bytes) || roomIdRaw (20) || nonce (16) || u64 iat || rootPub (32)
```

with `nonce` and `iat` the command's own, so the proof is single use through the command's nonce.
The relay checks, after the root signature and `STALE_REQUEST` and before the certificate, first
failure wins:

1. Owner set empty: `403 RELAY_UNCLAIMED`.
2. `owner` missing: `403 NOT_OWNER`. `owner.pub` not in the owner set: `403 NOT_OWNER`.
3. `owner.sig` does not verify: `401 AUTH_INVALID`.

Every register needs the proof, including the idempotent one and reopening a closed room. Revoke,
rotate, close and sweep stay root-key only, so a room keeps working after the device that created
it is removed.

### 6.1 Owner commands

Relay-wide administration is a request signed by a **device key** (§16.9): one Ed25519 key pair
per Kimo install. Bytes: `payload || signature`, the raw body of `POST /owner`
(`content-type: application/octet-stream`).

| Offset | Size | Field | Value |
|---|---|---|---|
| 0 | u8 | `version` | `1` |
| 1 | u8 | `type` | `4` (owner) |
| 2 | u8 | `op` | `1` claim, `2` devices, `3` pair, `4` remove, `5` cancel pairing, `6` rename |
| 3 | u8 | reserved | `0` |
| 4 | u64 | `iat` | Unix **milliseconds** |
| 12 | 16 bytes | `nonce` | Random |
| 28 | 16 bytes | `relayId` | The relay's id from `/version` (§14.11) |
| 44 | 32 bytes | `devicePub` | Raw Ed25519 public key of the signing device |
| 76 | u32 | `bodyLength` | Byte length of `body` (at most 16 KiB) |
| 80 | n | `body` | UTF-8 JSON object, schema per op below |
| end | 64 bytes | `signature` | Ed25519 by the device private key over `UTF-8("kimo/v1/owner\0") || payload` |

Verification, first failure wins: parse (`400 BAD_REQUEST`); `relayId` equals this relay's
(`401 AUTH_INVALID`); signature with `devicePub` (`401 AUTH_INVALID`); `|now - iat| <= 300 000`
(`422 STALE_REQUEST`); the nonce not seen before (`409 NONCE_REPLAY`, stored in `nonces` with
`room = ""` until `iat + 600 000`); then the op. Owner commands share the per-IP admin rate limit.

A `name` is a device display name: trimmed, 1 to 64 UTF-8 bytes, no control characters
(`400 BAD_REQUEST`). A device record in a response is
`{"pub": b64url, "name": string, "addedAt": ms, "addedBy": b64url | null, "via": "claim" | "pair" | "env"}`;
`devices` lists them oldest first.

| op | Body | Allowed when | Relay action | Success | Errors |
|---|---|---|---|---|---|
| 1 claim | `{"name"}` | Owner set empty, or `devicePub` already in it | In one transaction: if the set is empty, insert `devicePub` (`via: "claim"`); else if `devicePub` is in it, update its name | `201 {"devices"}` claimed; `200 {"devices"}` already an owner | `409 RELAY_CLAIMED` |
| 2 devices | `{}` | `devicePub` is an owner | | `200 {"devices"}` | `403 RELAY_UNCLAIMED`; `403 NOT_OWNER` |
| 3 pair | `{"token": b64url(pairing token), "name"}` | Signed by the **new** device | §6.2 verification; in one transaction insert `devicePub` (`via: "pair"`, `addedBy` the issuer) and the token's `jti` into `pairings_used` | `201 {"devices"}`; `200 {"devices"}` when `devicePub` is already an owner (the token is not used up) | `401 AUTH_INVALID`; `401 PAIRING_EXPIRED`; `409 PAIRING_USED`; `403 RELAY_UNCLAIMED` |
| 4 remove | `{"pub": b64url}` | `devicePub` is an owner (it may remove itself) | Delete the device | `200 {"devices"}` | `403 NOT_OWNER`; `404 NOT_FOUND` (not a device); `409 LAST_DEVICE` |
| 5 cancel pairing | `{"jti": hex(16 bytes), "exp": number}` | `devicePub` is an owner | Insert the `jti` into `pairings_used` until `exp` | `200 {}` | `403 NOT_OWNER` |
| 6 rename | `{"pub": b64url, "name"}` | `devicePub` is an owner (any device, itself included) | Set that device's name | `200 {"devices"}` | `403 NOT_OWNER`; `404 NOT_FOUND` (not a device) |

Two claims racing on an empty set: the transaction makes exactly one win; the other answers
`409 RELAY_CLAIMED`. The response never says who the owner is.

### 6.2 Pairing tokens

An owner device adds another device by minting a pairing token locally (no request) and handing
it over in a pairing link (§7.1). A token is `base64url(payload || signature)`, 148 bytes
(198 characters).

| Offset | Size | Field | Value |
|---|---|---|---|
| 0 | u8 | `version` | `1` |
| 1 | u8 | `type` | `5` (pairing) |
| 2 | u8 | `flags` | `0` |
| 3 | u8 | reserved | `0` |
| 4 | u64 | `iat` | Issued at, unix seconds |
| 12 | u64 | `exp` | Expiry, unix seconds: `iat + 900` by default, at most `iat + 3600` |
| 20 | 16 bytes | `jti` | Random token id |
| 36 | 16 bytes | `relayId` | The relay the token is for |
| 52 | 32 bytes | `issuerPub` | Raw public key of the issuing owner device |
| 84 | 64 bytes | `signature` | Ed25519 by the issuer over `UTF-8("kimo/v1/pairing\0") || payload` |

**Verification** (relay, on op 3), first failure wins:

1. Parse; any format error, trailing bytes, nonzero flags or reserved byte is `AUTH_INVALID`.
2. `relayId` equals this relay's, else `AUTH_INVALID`.
3. `issuerPub` is in the owner set and `iat >= floor(addedAt / 1000) - 300` for that device (a
   removed and re-added device cannot revive its old links), else `AUTH_INVALID`.
4. Signature verifies with `issuerPub`, else `AUTH_INVALID`.
5. `exp > iat`, `exp - iat <= 3600` and `iat <= now + 300`, else `AUTH_INVALID`.
6. `exp > now`, else `PAIRING_EXPIRED`.
7. `jti` not in `pairings_used`, else `PAIRING_USED`.

A reset (`KIMO_RESET_OWNER`) empties the owner set, so every outstanding token fails step 3.

## 7. Join links

```
<web-origin>/join#<relay-url>/<room>/<token>/<room-key>
```

- `web-origin`: where the Kimo web app is served, or `kimo:` on desktop (`kimo://join#...`).
  Parsers accept any origin; only the fragment matters.
- `relay-url`: the normalized relay base URL (below), written as is (no percent-encoding).
- `room`: 32-character base32 room id. `token`: base64url token (§4). `room-key`: base64url of
  the 32-byte room key (43 characters).
- Parsing splits the fragment on `/` **from the right**: the last three segments are room, token
  and key; everything before them is the relay URL. Parsers MUST check the room id grammar, that
  the token parses and names the same room, that the key decodes to 32 bytes, and that the relay
  URL normalizes; any failure is `BAD_LINK`.

**Relay URL normalization** (`normalizeRelayUrl`): accept `https://`, `http://`, `wss://`, `ws://`;
map `wss` to `https` and `ws` to `http`; lowercase scheme and host; drop default ports, query,
fragment, credentials and trailing slashes; keep a path prefix (`https://example.com/kimo`).
`http` is accepted only for `localhost`, `127.0.0.1`, `[::1]`, `*.local` and private IPv4 ranges
(10/8, 172.16/12, 192.168/16); otherwise `BAD_RELAY_URL`. The normalized form is what links and
the registry store.

Derived URLs: WebSocket `syncUrl = base with scheme https→wss, http→ws` + `/sync/<room>`; HTTP
paths are appended to the base (`<base>/room/<room>/snapshot`).

### 7.1 Pairing links

```
<web-origin>/pair#<relay-url>/<pairing-token>
```

- `web-origin` as in §7 (`kimo://pair#...` on desktop). The web app routes `/pair`, the desktop
  app the `kimo://pair` deep link, to the pairing sheet (§16.9).
- Parsing splits the fragment on `/` from the right: the last segment is the token (§6.2), the
  rest the relay URL (normalized as in §7). The token must parse as type 5; any failure is
  `BAD_LINK`. A join link never parses as a pairing link and the reverse (different trailing
  segment count and token type).
- Like a join link, everything after `#` stays on the device: the token never reaches a web
  server's logs. A pairing link is a bearer credential for its lifetime and one use; the UI shows
  its expiry and offers Cancel (op 5).

## 8. Key derivation

All derivations are HKDF-SHA256 with `ikm = roomKey` (32 bytes), `salt = roomIdRaw` (20 bytes),
and the UTF-8 `info` label below, producing 32 bytes.

| Key | `info` | Algorithm | Use |
|---|---|---|---|
| `doc` | `kimo/v1/doc` | AES-256-GCM | Update and snapshot envelopes |
| `awareness` | `kimo/v1/awareness` | AES-256-GCM | Presence envelopes |
| `blobMac` | `kimo/v1/blob-id` | HMAC-SHA256 | Blob ids |
| `blob(sha)` | `kimo/v1/blob/` + lowercase hex of the plaintext SHA-256 | AES-256-GCM | One key per blob |

Derived `CryptoKey`s are non-extractable. `RoomKeys` keeps an HKDF base key (non-extractable) to
derive blob keys on demand.

## 9. Envelopes

Every encrypted payload uses one envelope layout:

| Offset | Size | Field |
|---|---|---|
| 0 | u8 | `version` = `1` |
| 1 | u8 | `kind`: `1` update, `2` snapshot, `3` awareness, `4` blob |
| 2 | 12 bytes | `iv`, random per envelope |
| 14 | n + 16 | AES-GCM ciphertext with the 128-bit tag appended (WebCrypto output) |

Associated data (UTF-8, `|` separated, no trailing separator):

| Kind | Key | AAD | Plaintext |
|---|---|---|---|
| update | `doc` | `kimo/v1|<roomId>|update` | One binary update from `DocStore.onUpdate` or `encodeStateAsUpdate(sv)` |
| snapshot | `doc` | `kimo/v1|<roomId>|snapshot|<upTo>` (decimal) | `DocStore.encodeStateAsUpdate()` |
| awareness | `awareness` | `kimo/v1|<roomId>|awareness|<peerId>` (decimal, the sender's relay-assigned id) | UTF-8 JSON of `PresenceState` without `origin` (§15.9) |
| blob | `blob(sha)` | `kimo/v1|<roomId>|blob|<blobId>` | The asset's bytes |

`open*` MUST check `version` and `kind` before decrypting and MUST throw
`MultiplayerError("DECRYPT_FAILED")` on any mismatch or tag failure. Envelope overhead is 30 bytes.
IVs come from `crypto.getRandomValues`; with random IVs a key stays well inside the AES-GCM bound
(2^32 envelopes) for any realistic room.

## 10. Blobs: ids and encryption

For an asset with plaintext bytes `p`:

1. `sha = SHA-256(p)` (32 bytes). The document's manifest entry stores `hex(sha)` as `sha256`
   (§16.7); its first 16 hex digits are the existing asset key hash.
2. `blobId = hex(HMAC-SHA256(blobMac, sha))` (64 hex characters, `^[0-9a-f]{64}$`).
3. `envelope = seal(kind 4, key blob(sha), AAD "kimo/v1|<roomId>|blob|<blobId>", p)`.
4. `PUT /blob/<room>/<blobId>` with the envelope.

Receiving: `GET`, open with the key derived from the manifest's `sha256`, then MUST check
`SHA-256(plaintext) == sha` (`BLOB_INTEGRITY` otherwise) before `AssetStore.putKey`, which checks
the 16-hex key again. The relay checks only the ciphertext size and the id grammar.

## 11. WebSocket protocol

### 11.1 Connection

- URL: `<syncUrl>` = `wss://<host>[/prefix]/sync/<room>`.
- Subprotocol: the client MUST request `kimo-mp.1`; the relay MUST select it and refuse the
  upgrade otherwise (`426`, `PROTOCOL_MISMATCH`).
- The relay checks the `Origin` header against `KIMO_ALLOWED_ORIGINS` before upgrading (`403`,
  `ORIGIN_FORBIDDEN`). Requests without `Origin` (Bun, scripts) are allowed, and so are the Kimo
  desktop webview's origins (Tauri 2: `tauri://localhost` on macOS and Linux,
  `http://tauri.localhost` on Windows, `https://tauri.localhost` with the https scheme): no web
  page can send them, so the list (which takes only http and https origins) never needs them.
- Upgrade-time checks on the room: unknown room `404 ROOM_NOT_FOUND`, closed `410 ROOM_CLOSED`,
  per-IP connect rate `429 RATE_LIMITED`, peer cap `503 ROOM_FULL`. The token is not sent at
  upgrade time.
- Every frame is binary: `varUint type` then the fields below, in order. Text frames close the
  connection with `BAD_MESSAGE`.
- The first client frame MUST be `hello` within 10 s (`HELLO_TIMEOUT`). Any other first frame is
  `BAD_MESSAGE`.
- Bun settings: `maxPayloadLength = maxEntryBytes + 65 536`, `idleTimeout = 60`,
  `sendPings = true`, `backpressureLimit = 64 MiB`, `closeOnBackpressureLimit = true`.

### 11.2 Client to relay

| type | Name | Fields | Rules |
|---|---|---|---|
| 1 | `hello` | `varUint proto` (= 1), `varString token`, `varUint since`, `varString client` (e.g. `kimo-web/2.0.0`, at most 64 bytes) | Once, first. `proto != 1` closes with `PROTOCOL_MISMATCH` |
| 2 | `append` | `varUint cid`, `varUint8Array env` | `env` is an update envelope. `cid` is chosen by the client, increasing per connection. Requires `edit` |
| 3 | `awareness` | `varUint clock`, `varUint8Array env` | Empty `env` withdraws presence. `clock` strictly increasing per connection. Allowed for `view` and `edit` |
| 4 | `caught-up` | `varUint seq` | Sent once per connection after the initial catch-up (§15.4) |
| 5 | `refresh` | `varString token` | Replaces the connection's token; same room, role and origin required |
| 6 | `ping` | `varUint n` | Answered with `pong` |

### 11.3 Relay to client

| type | Name | Fields |
|---|---|---|
| 16 | `welcome` | `varUint peer`, `varString role`, `varString origin`, `varUint exp`, `varUint kid`, `varUint head`, `varUint base`, `varUint from`, `varUint needSnapshot` (0/1), `varUint hasSnapshot` (0/1), then if 1: `varUint upTo`, `varUint gen`, `varUint bytes`; limits: `varUint maxEntryBytes`, `varUint maxSnapshotBytes`, `varUint maxBlobBytes`, `varUint roomQuotaBytes`, `varUint awarenessHz`; peers: `varUint n`, then n × (`varUint peer`, `varString role`, `varString origin`) excluding the receiver |
| 17 | `entries` | `varUint n`, then n × (`varUint seq`, `varString origin`, `varUint8Array env`) |
| 18 | `ack` | `varUint cid`, `varUint seq` |
| 19 | `awareness` | `varUint peer`, `varUint clock`, `varUint8Array env` (empty = withdrawn) |
| 20 | `peer-joined` | `varUint peer`, `varString role`, `varString origin` |
| 21 | `peer-left` | `varUint peer` |
| 22 | `snapshot` | `varUint upTo`, `varUint gen`, `varUint bytes`, `varUint carriesNew` (0/1) |
| 23 | `compact` | `varUint upTo` |
| 24 | `denied` | `varString code`, `varUint cid` (0 when not about an append), `varString message` |
| 25 | `token` | `varUint exp` (refresh accepted) |
| 26 | `pong` | `varUint n` |

Clients MUST ignore unknown relay types (forward compatibility). Relays MUST close on unknown
client types (`BAD_MESSAGE`).

### 11.4 Sequencing guarantees (relay)

- `seq` starts at 1 per room and increases by 1 per accepted `append`. `head` is the last
  assigned `seq` (0 for an empty log). `base` is the highest `seq` no longer stored (entries
  `> base` are available).
- On `hello`, after verification, the relay in **one synchronous step** (no `await` between):
  assigns `peer`, computes `needSnapshot` and `from`, sends `welcome`, sends every stored entry
  with `seq >= from` as `entries` frames (at most 512 entries or 1 MiB of envelopes per frame),
  sends the cached `awareness` of every other peer, subscribes the socket to the room, and
  publishes `peer-joined`.
  - `needSnapshot = hasSnapshot && (since == 0 || since < base)`.
  - `from = needSnapshot ? snapshot.upTo + 1 : since + 1`.
  - If `since > head` (the relay lost data or the client is confused) the relay treats it as
    `since = 0`.
- On `append` from an `edit` connection: assign `seq`, persist (synchronous SQLite insert),
  send `ack` to the sender, publish `entries` (one entry) to every other socket of the room,
  stamped with the sender's token `origin`. The sender never receives its own entry as `entries`.
  Therefore every socket receives every `seq > from - 1` exactly once and in increasing order,
  either as an `entries` item or as an `ack`.
- On `append` from a `view` connection: send `denied` (`VIEW_ONLY`, with the `cid`); do not
  store or forward.
- On `append` with an envelope over `maxEntryBytes` (but within the frame limit): `denied`
  (`TOO_LARGE`, with the `cid`). Over the frame limit Bun closes with 1009.
- On `awareness`: drop if `clock` is not greater than the last one from this connection or the
  connection exceeds `awarenessHz` (no reply), deny `TOO_LARGE` over 16 KiB, else cache it and
  publish `awareness` with the sender's `peer` to the other sockets.
- On close: publish `peer-left`, drop the cached awareness.
- `peer` ids are assigned per loaded room starting at 1 and never reused while the room stays
  loaded in memory.

### 11.5 Close codes

The relay closes with the code and the error code string as the reason. Clients map close codes
back to `MpErrorCode` (§13). Standard codes: `1000` normal (client detach), `1001` going away,
`1006` abnormal (no frame), `1009` frame too big, `1012` relay restarting.

## 12. HTTP API

All routes are under the relay base URL. Authenticated routes take
`Authorization: Bearer <token>` and run the §4 verification. Error responses are
`application/json; charset=utf-8` bodies `{"error": "<MpErrorCode>", "message": "..."}` with the
status from §13. `429` and `503` carry `retry-after` (seconds).

| Method and path | Auth | Request | Responses |
|---|---|---|---|
| `GET /healthz` | none | | `200 {"ok":true}` |
| `GET /version` | none | | `200 {"name":"@kimo/server","version":"x.y.z","protocol":"kimo-mp/1","limits":RelayLimits,"relayId":b64url(16 bytes),"owner":"unclaimed"\|"claimed"}` |
| `POST /owner` | device signature (§6.1) | Body: owner command bytes | Per op (§6.1); also `413 TOO_LARGE`, `429` |
| `OPTIONS *` | none | CORS preflight | `204` |
| `POST /room/<room>/admin` | admin signature (§6), plus the owner proof for register | Body: admin command bytes | Per op (§6); `400 BAD_REQUEST`, `401 AUTH_INVALID` (signature or owner proof), `403 RELAY_UNCLAIMED`, `403 NOT_OWNER`, `404 ROOM_NOT_FOUND` (non-register on unknown room), `409 NONCE_REPLAY`, `410 ROOM_CLOSED` (non-register on closed room), `413 TOO_LARGE`, `422 ROOM_ID_MISMATCH`, `422 STALE_REQUEST`, `422 KEY_ID_INVALID` (rotate with a non-increasing kid), `429`, `503 RELAY_FULL` (room cap) |
| `GET /room/<room>` | view or edit | | `200 {"room","kid","head","base","snapshot":{"upTo","gen","bytes"}|null,"usedBytes","quotaBytes","peers":n}` |
| `GET /room/<room>/snapshot` | view or edit | | `200` `application/octet-stream` envelope with headers `kimo-up-to`, `kimo-gen`; `404 NOT_FOUND` when there is none |
| `PUT /room/<room>/snapshot?upTo=<n>[&carries=1]` | edit | Body: snapshot envelope | `201 {"gen","upTo"}`; `400 BAD_REQUEST`; `409 SNAPSHOT_STALE`; `413 TOO_LARGE`; `422 SNAPSHOT_AHEAD`; `507 QUOTA_EXCEEDED` |
| `PUT /blob/<room>/<id>` | edit | Body: blob envelope | `201` stored, `200` already present (body ignored, mark cleared); `400 BAD_REQUEST` (id grammar); `413 TOO_LARGE`; `429 RATE_LIMITED`; `507 QUOTA_EXCEEDED` |
| `HEAD /blob/<room>/<id>` | view or edit | | `200` with `content-length`; `404` |
| `GET /blob/<room>/<id>` | view or edit | | `200` `application/octet-stream`, `cache-control: private, max-age=31536000, immutable`; `404 NOT_FOUND` |
| `POST /blob/<room>/missing` | view or edit | `{"ids": [blobId...]}` (at most 1000) | `200 {"missing": [blobId...]}` |
| `GET` or upgrade `/sync/<room>` | in `hello` | WebSocket (§11) | `101`; `400` not an upgrade; `403 ORIGIN_FORBIDDEN`; `404`; `410`; `426 PROTOCOL_MISMATCH`; `429`; `503 ROOM_FULL` |

Snapshot acceptance: with `cur` the latest snapshot (or none) and `head` the room's head,
accept iff `upTo <= head` and (`cur` is none, or `upTo > cur.upTo`, or `upTo == cur.upTo` and
`carries=1`). `upTo > head` is `SNAPSHOT_AHEAD`; otherwise a refusal is `SNAPSHOT_STALE`. The
first snapshot of an empty room has `upTo = 0` (the genesis seed).

CORS on every response: `access-control-allow-origin` (the request origin when allowed, `*` when
the allow list is `*`), `access-control-allow-headers: authorization, content-type`,
`access-control-allow-methods: GET, HEAD, PUT, POST, OPTIONS`,
`access-control-expose-headers: kimo-up-to, kimo-gen, retry-after`, `access-control-max-age: 600`.
Tokens MUST NOT appear in access logs; the relay logs method, path, status and duration only.

The protocol string stays `kimo-mp/1`: ownership changes only who may register a room, and
multiplayer has not shipped, so there is no older relay or client to stay compatible with.
`probe` treats a `/version` without `relayId` and `owner` as `NOT_A_RELAY`.

## 13. Error codes

`MpErrorCode` is the union of the codes below. "Retry" says what a client provider does when the
relay closes with it.

| Code | HTTP | WS close | Retry | Meaning |
|---|---|---|---|---|
| `BAD_REQUEST` | 400 | | no | Malformed HTTP request |
| `BAD_MESSAGE` | | 4400 | no | Malformed or unexpected frame |
| `AUTH_INVALID` | 401 | 4401 | no | Token or signature does not parse or verify, or wrong room |
| `KEY_ROTATED` | 401 | 4402 | no | Token signed by a replaced link key |
| `TOKEN_REVOKED` | 403 | 4403 | no | `jti` revoked |
| `VIEW_ONLY` | 403 | (denied) | n/a | Write attempted with a `view` token |
| `ROLE_UNSUPPORTED` | 403 | 4405 | no | `comment` or unknown role |
| `ORIGIN_FORBIDDEN` | 403 | | no | Browser `Origin` not allowed by the relay |
| `RELAY_UNCLAIMED` | 403 | | no | Register (or an owner op) on a relay with no owner device yet; the client claims first (§6.1) |
| `NOT_OWNER` | 403 | | no | Register or an owner op by a device that is not in the relay's owner set |
| `PAIRING_EXPIRED` | 401 | | no | Pairing token `exp` passed |
| `PAIRING_USED` | 409 | | no | Pairing token already redeemed or cancelled |
| `RELAY_CLAIMED` | 409 | | no | Claim on a relay another device already owns |
| `LAST_DEVICE` | 409 | | no | Removing the only owner device |
| `ROOM_NOT_FOUND` | 404 | 4404 | no | Unknown room |
| `NOT_FOUND` | 404 | | no | No such blob or snapshot |
| `HELLO_TIMEOUT` | | 4408 | yes | No `hello` within 10 s |
| `NONCE_REPLAY` | 409 | | no | Admin nonce reused |
| `SNAPSHOT_STALE` | 409 | | no | Snapshot does not advance the current one |
| `ROOM_CLOSED` | 410 | 4410 | no | Owner stopped sharing |
| `TOO_LARGE` | 413 | 4413 / (denied) | no | Payload over a limit |
| `TOKEN_EXPIRED` | 401 | 4419 | no | `exp` passed |
| `ROOM_ID_MISMATCH` | 422 | | no | Room id does not derive from the root key |
| `STALE_REQUEST` | 422 | | no | Admin `iat` outside ±5 minutes |
| `KEY_ID_INVALID` | 422 | | no | Rotation `kid` not increasing |
| `SNAPSHOT_AHEAD` | 422 | | no | Snapshot `upTo` beyond `head` |
| `PROTOCOL_MISMATCH` | 426 | 4426 | no | Wrong subprotocol or `proto` |
| `RATE_LIMITED` | 429 | 4429 | yes | Rate limit hit |
| `INTERNAL` | 500 | 4500 | yes | Relay error |
| `ROOM_FULL` | 503 | 4503 | yes | Peer cap reached |
| `RELAY_FULL` | 503 | | no | Room cap reached on this relay |
| `LOG_FULL` | | 4507 | yes | Retained log over its hard cap until a snapshot arrives |
| `QUOTA_EXCEEDED` | 507 | | no | Room storage quota exceeded |
| `DECRYPT_FAILED` | | | no (fatal, client side) | An envelope failed to open: wrong key or tampering |
| `BLOB_INTEGRITY` | | | no (client side) | Decrypted blob does not match its SHA-256 |
| `BAD_LINK` | | | no (client side) | Join link does not parse |
| `BAD_RELAY_URL` | | | no (client side) | Relay URL rejected by normalization |
| `NOT_A_RELAY` | | | no (client side) | `/version` missing or not `kimo-mp/1` |
| `RELAY_UNREACHABLE` | | | yes (client side) | Network failure, timeout or a close without a frame (1006) |
| `CRYPTO_UNSUPPORTED` | | | no (client side) | WebCrypto lacks Ed25519, HKDF or AES-GCM |

Close codes `1001`, `1006` and `1012` map to `RELAY_UNREACHABLE` (retry). `1009` maps to
`TOO_LARGE` (no retry; a client bug).

## 14. Relay behaviour and persistence

### 14.1 Room lifecycle

- **Registered** by admin op 1. **Loaded** in memory while at least one socket is connected (peer
  table, awareness cache, rate buckets, compaction state); unloaded 30 s after the last socket
  leaves. **Closed** by op 4 (data deleted, row kept). **Expired** when `KIMO_ROOM_TTL_DAYS > 0`
  and `active_at` is older than that with no socket: an hourly job deletes all data and the row.
- `active_at` updates on every connect and append (at most once a minute per room).

### 14.2 Schema (`bun:sqlite`, `${KIMO_DATA_DIR}/relay.sqlite`)

`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;`
`PRAGMA user_version = 1` marks this schema (multiplayer has not shipped, so the ownership
tables join version 1 instead of a migration).

```sql
CREATE TABLE rooms (
  id             TEXT PRIMARY KEY,          -- base32 room id
  root_pub       BLOB NOT NULL,             -- 32 bytes
  link_kid       INTEGER NOT NULL,
  link_pub       BLOB NOT NULL,             -- 32 bytes
  link_cert      BLOB NOT NULL,             -- certificate bytes (§5)
  created_at     INTEGER NOT NULL,          -- ms
  active_at      INTEGER NOT NULL,          -- ms
  closed_at      INTEGER,                   -- ms; NULL = open
  head           INTEGER NOT NULL DEFAULT 0,
  base           INTEGER NOT NULL DEFAULT 0,
  log_bytes      INTEGER NOT NULL DEFAULT 0, -- envelope bytes of retained entries
  snapshot_bytes INTEGER NOT NULL DEFAULT 0, -- bytes of the stored snapshot generations
  blob_bytes     INTEGER NOT NULL DEFAULT 0,
  quota_bytes    INTEGER                    -- NULL = KIMO_ROOM_QUOTA_MB
) STRICT;

CREATE TABLE log (
  room   TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq    INTEGER NOT NULL,
  origin TEXT NOT NULL,                     -- token origin of the author
  jti    BLOB NOT NULL,                     -- author's token id (attribution, audit)
  at     INTEGER NOT NULL,                  -- ms
  env    BLOB NOT NULL,
  PRIMARY KEY (room, seq)
) STRICT, WITHOUT ROWID;

CREATE TABLE snapshots (
  room    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  gen     INTEGER NOT NULL,                 -- 1, 2, 3... per room
  up_to   INTEGER NOT NULL,
  carries INTEGER NOT NULL,                 -- 0/1
  at      INTEGER NOT NULL,
  env     BLOB NOT NULL,
  PRIMARY KEY (room, gen)
) STRICT, WITHOUT ROWID;                    -- the latest two generations are kept

CREATE TABLE revocations (
  room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  jti  BLOB NOT NULL,
  exp  INTEGER NOT NULL,                    -- token exp in s; 0 = never; pruned after exp
  at   INTEGER NOT NULL,
  PRIMARY KEY (room, jti)
) STRICT, WITHOUT ROWID;

CREATE TABLE blobs (
  room        TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,                -- 64 hex
  bytes       INTEGER NOT NULL,             -- ciphertext size
  at          INTEGER NOT NULL,
  unref_since INTEGER,                      -- ms; set by a sweep, cleared by PUT or keep
  PRIMARY KEY (room, id)
) STRICT, WITHOUT ROWID;

CREATE TABLE nonces (
  room  TEXT NOT NULL,                      -- "" for owner commands (§6.1)
  nonce BLOB NOT NULL,
  exp   INTEGER NOT NULL,                   -- ms
  PRIMARY KEY (room, nonce)
) STRICT, WITHOUT ROWID;

CREATE TABLE relay_meta (
  key   TEXT PRIMARY KEY,                   -- 'relay_id' (16 random bytes, made once),
  value BLOB NOT NULL                       -- 'reset_applied' (SHA-256 of the last KIMO_RESET_OWNER acted on)
) STRICT, WITHOUT ROWID;

CREATE TABLE owners (
  pub      BLOB PRIMARY KEY,                -- 32-byte device public key
  name     TEXT NOT NULL,
  added_at INTEGER NOT NULL,                -- ms
  added_by BLOB,                            -- issuer's pub for "pair"; NULL otherwise
  via      TEXT NOT NULL                    -- 'claim' | 'pair' | 'env'
) STRICT, WITHOUT ROWID;

CREATE TABLE pairings_used (
  jti BLOB PRIMARY KEY,                     -- 16 bytes; redeemed or cancelled
  exp INTEGER NOT NULL                      -- s; pruned after exp
) STRICT, WITHOUT ROWID;
```

The owner set lives in the data dir next to the rooms, so it survives restarts and redeploys
with the volume, and a backup of `/data` carries it.

Append is one transaction: insert into `log`, `head = head + 1`, `log_bytes += len(env)`.

### 14.3 Compaction scheduling

- Trigger, checked after each append: `head - snapshot.upTo >= KIMO_COMPACT_ENTRIES` (default
  1000) or bytes of entries with `seq > snapshot.upTo >= KIMO_COMPACT_BYTES` (default 8 MiB).
- The relay sends `compact {upTo: head}` to one socket: the lowest `peer` among `edit` sockets
  that sent `caught-up`. At most one request is outstanding per room. If no snapshot advancing
  past the previous one arrives within 60 s, the relay asks the next eligible peer (cycling), then
  waits for the next trigger.
- On an accepted snapshot: store it as generation `gen = previous + 1`, delete generations older
  than `gen - 1`, update `snapshot_bytes`, clear the outstanding request, and publish
  `snapshot {upTo, gen, bytes, carriesNew}` to every socket of the room.
- **Retention.** Entries with `seq <= latest.upTo` and `at` older than
  `KIMO_LOG_RETAIN_MS` (default 600 000) are deleted by a job running every minute; `base` and
  `log_bytes` are updated in the same transaction. Retention lets a client that dropped for a
  moment resume from its `since` without a snapshot download.
- **Hard cap.** When `log_bytes > KIMO_LOG_MAX_MB` (default 32 MiB), appends close the socket
  with `LOG_FULL` until a snapshot lets retention shrink the log. Compaction requests continue.

### 14.4 Auth state on live connections

- Each socket stores its token's `jti`, `exp`, `role`, `origin`, `kid`.
- A timer closes the socket with `TOKEN_EXPIRED` at `exp` (if not 0); `refresh` replaces the
  token and timer after full verification (§4) and checks same room, role and origin, else
  `denied BAD_MESSAGE` and the old token stays.
- Revoke closes sockets with that `jti` (`TOKEN_REVOKED`); rotate closes every socket of the room
  (`KEY_ROTATED`); close closes every socket (`ROOM_CLOSED`).

### 14.5 Origin enforcement

The token's `origin` is stamped by the relay on `welcome`, `peer-joined`, the `entries` origin
field and the `log.origin` column. Nothing a client sends can change it.

### 14.6 Blob storage

- Files at `${KIMO_DATA_DIR}/blobs/<room>/<id[0..2]>/<id>`, written to a temporary file in the
  same directory, then renamed. Rows in `blobs`.
- `PUT`: check id grammar, ciphertext size `<= KIMO_BLOB_MAX_MB * 2^20 + 30`, the per-token rate
  (§14.8), and quota: `blob_bytes + snapshot_bytes + log_bytes + size <= quota`. Already present:
  `200`, clear `unref_since`, ignore the body (read and discard it).
- `GET` streams the file (`Bun.file`).

### 14.7 Owner sweep

For a valid op 5: for each blob of the room, if its id is in `keep`, clear `unref_since`;
otherwise set `unref_since = now` if it is null. Then delete blobs (row and file) whose
`unref_since <= now - graceDays * 86 400 000`. The relay never deletes blobs outside a sweep or a
room close or expiry. A first sweep therefore only marks; deletion happens on a later sweep after
the grace period.

### 14.8 Rate limits and limits

| Limit | Default | Enforcement |
|---|---|---|
| WebSocket connects per IP | 30 per minute | `429` at upgrade |
| Appends per connection | 100 per second, burst 200 | close `RATE_LIMITED` |
| Awareness per connection | `awarenessHz` = 20 per second | silently dropped |
| Admin requests per IP | 30 per minute | `429` |
| Blob `PUT` per token `jti` | 60 per minute | `429` with `retry-after` |
| Blob `PUT` bytes per room | 200 MiB per 10 minutes | `429` with `retry-after` |
| Peers per room | 32 | `503 ROOM_FULL` |
| Entry envelope | 4 MiB | `denied TOO_LARGE` |
| Snapshot envelope | 64 MiB | `413` |
| Blob plaintext | 20 MiB (ciphertext + 30) | `413` |
| Room quota | 500 MiB (blobs + snapshots + log) | `507` |
| Awareness envelope | 16 KiB | `denied TOO_LARGE` |

Per-IP uses `server.requestIP(req)`, or the first `x-forwarded-for` address when
`KIMO_TRUST_PROXY=1`.

### 14.9 Configuration (`loadConfig(env)`)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Listen port |
| `HOST` | `127.0.0.1` | Bind address (the Docker image sets `0.0.0.0`) |
| `KIMO_DATA_DIR` | `./data` | SQLite file and blob directory |
| `KIMO_ALLOWED_ORIGINS` | `*` | Comma-separated browser origins allowed for CORS and WebSocket `Origin` (the desktop webview origins are always allowed) |
| `KIMO_OWNER_KEY` | unset | Comma-separated device public keys (base64url, 43 characters each). At boot, when the owner set is empty, the relay adds them (`via: "env"`, name "Added at deploy"; the device renames itself on its first claim). Ignored once the relay has an owner. Public values: safe in commands, URLs and logs (§14.11) |
| `KIMO_RESET_OWNER` | unset | Any non-empty value: at boot, clear the owner set and the used pairings and log a warning, once per distinct value (§14.11). Guides phrase it as "set it to any new value, for example today's date". Rooms are untouched |
| `KIMO_MAX_ROOMS` | `0` (unlimited) | Registered rooms cap (`RELAY_FULL`) |
| `KIMO_MAX_PEERS` | `32` | Sockets per room |
| `KIMO_ROOM_QUOTA_MB` | `500` | Default room quota |
| `KIMO_BLOB_MAX_MB` | `20` | Blob plaintext cap |
| `KIMO_ENTRY_MAX_MB` | `4` | Log entry envelope cap |
| `KIMO_SNAPSHOT_MAX_MB` | `64` | Snapshot envelope cap |
| `KIMO_LOG_MAX_MB` | `32` | Retained log hard cap |
| `KIMO_COMPACT_ENTRIES` | `1000` | Compaction trigger (entries) |
| `KIMO_COMPACT_BYTES` | `8388608` | Compaction trigger (bytes) |
| `KIMO_LOG_RETAIN_MS` | `600000` | Retention of covered entries |
| `KIMO_ROOM_TTL_DAYS` | `0` (never) | Delete rooms idle this long |
| `KIMO_SWEEP_GRACE_DAYS` | `30` | Default sweep grace period |
| `KIMO_TRUST_PROXY` | `0` | Use `x-forwarded-for` for per-IP limits |

Invalid values make `main.ts` print the variable and exit 1.

### 14.10 Packaging

- `apps/server/Dockerfile`: build context is the repo root
  (`docker build -f apps/server/Dockerfile .`); base `oven/bun:1.3-alpine`; copies the workspace
  manifests and `packages/sync`, `apps/server`; `bun install --production --frozen-lockfile`;
  `ENV HOST=0.0.0.0 KIMO_DATA_DIR=/data`; `VOLUME /data`; `EXPOSE 8787`; runs as the `bun` user;
  `HEALTHCHECK` on `/healthz`; `CMD ["bun", "apps/server/src/main.ts"]`. CI
  (`.github/workflows/relay-image.yml`) publishes it as `ghcr.io/saudade-media/kimo-relay`
  (amd64 and arm64; `latest` follows `main`, version tags publish semver tags).
- `apps/server/deploy/fly.toml`: deploys that image (`[build] image`), one shared-cpu-1x 256 MB machine, a volume mounted at `/data`,
  `auto_stop_machines = "off"` (WebSockets), `http_service` with `force_https = true`, health
  check `/healthz`.
- Guides (`docs/guide/relay/`): self-host (process, Docker, Caddy TLS, env table, backups of
  `/data`, upgrading, `KIMO_OWNER_KEY` and `KIMO_RESET_OWNER`), Fly.io (`fly launch
  --copy-config`, volume, `KIMO_OWNER_KEY`, cost note), Railway (the template, volume at `/data`,
  `KIMO_OWNER_KEY` prefilled when the deploy link carries it, cost note),
  and a "This relay belongs to another Kimo" recovery section: "Set `KIMO_RESET_OWNER` to any new
  value, for example today's date, restart the relay, then open Kimo to claim it." Each guide ends with "paste `https://<your-relay>` into Kimo's Share dialog". No
  guide may present any relay as a project service.

### 14.11 Ownership (`owners.ts`)

The relay has an **owner set**: the device public keys allowed to register rooms (§6) and to run
owner commands (§6.1). Empty means **unclaimed**.

**Boot**, in this order, before the server listens:

1. Create `relay_id` in `relay_meta` if missing (16 random bytes). It never changes, except by
   deleting the data dir.
2. `KIMO_RESET_OWNER` set and `SHA-256(value)` differs from `reset_applied`: in one transaction
   delete every `owners` and `pairings_used` row and store the new hash; log
   `warn: KIMO_RESET_OWNER cleared the owner list. Claim the relay from Kimo, then remove the variable.`
   The same value on a later boot does nothing, so a forgotten variable does not reopen the relay
   on every redeploy; resetting again takes a different value.
3. Owner set empty and `KIMO_OWNER_KEY` set: insert each key (`via: "env"`, `added_by` NULL).
   Invalid keys make `loadConfig` fail naming the variable.
4. Log one line: `owner: claimed (n devices)` or `owner: unclaimed, claim it from Kimo`.

**Rules.** Claim, pair, remove and cancel run each in one SQLite transaction, so concurrent
requests serialize: two claims on an empty set give one `201` and one `409 RELAY_CLAIMED`; two
redemptions of one pairing token give one `201` and one `409 PAIRING_USED`; two removals that
would empty the set give one `200` and one `409 LAST_DEVICE`. The hourly maintenance job prunes
`pairings_used` rows whose `exp` passed. Removing a device closes nothing: its rooms stay with
their root keys, and pairing tokens it issued stop verifying (§6.2 step 3). Device names are
stored in clear text (they name a platform by default, never a person, §16.9); the relay logs
neither names nor public keys.

**Claim race (see ADR 0017).** A relay that starts unclaimed (no `KIMO_OWNER_KEY`) can be claimed by whoever reaches it first. That grants room creation
(storage on the operator's bill), never access to a room's content. There is no claim deadline.
Kimo's own setup paths pass `KIMO_OWNER_KEY`, so they start claimed.

## 15. Client provider behaviour

### 15.1 Identity

- Provider `id` = `mp:<room>`; the origin it applies remote updates with is `remote:mp:<room>`.
  It never re-sends updates carrying that origin (no echo).
- `since`: the highest contiguous `seq` applied in this provider instance (starts at 0; not
  persisted, see §15.6).

### 15.2 Status mapping (`SyncStatus`)

| Situation | Status |
|---|---|
| Not attached | `detached` |
| Socket connecting, handshaking, or catching up | `connecting` |
| `edit`, caught up, nothing in flight | `synced` |
| `edit`, caught up, appends or a snapshot upload in flight | `saving` |
| `view`, caught up | `read-only` |
| A close; the event carries the `MultiplayerError` | `error`, then `connecting` when the next attempt starts (retryable codes) |
| Fatal code (§13 retry "no") | `error`, and no further attempts until `connect()` or `setToken()` |

### 15.3 Connect

1. Open `new WebSocket(syncUrl, "kimo-mp.1")`, `binaryType = "arraybuffer"`. Connect timeout 15 s
   (`RELAY_UNREACHABLE`).
2. Send `hello {proto: 1, token, since, client}`.
3. Process every incoming frame through one serial async queue (decryption is async; order MUST be
   preserved).

### 15.4 Catch-up

On `welcome`:

1. Record `peer`, `role`, `origin`, `exp`, `limits`, peers. Elect (§15.8).
2. If `role == "view"`: `store.setReadOnly("multiplayer: view-only link")` (remember to undo it on
   detach if this provider set it).
3. If `needSnapshot`: `GET /room/<room>/snapshot`; open it with AAD `upTo` from `kimo-up-to`;
   `store.applyUpdate(state, remoteOrigin)`; `since = max(since, upTo)`. Entries that arrive
   before the snapshot is applied are buffered, not applied.
4. Apply entries in order: skip `seq <= since`; a gap (`seq > since + 1`) is a protocol error
   (close, reconnect). Open, `applyUpdate`, `since = seq`.
5. When `since >= welcome.head`: caught up. Send `caught-up {since}`. Re-elect. Then push the
   local delta (§15.5) and re-send local presence.
6. If the relay's `head < since` (data loss on the relay), set `since = 0`, set the cursor's
   `ackedSv = null` (forces a full push) and reconnect.

`attach(store)` resolves when the first catch-up completes, or when the first attempt fails with
a retryable error or times out (the editor works offline; the provider keeps retrying). It
rejects only on a fatal error before the first catch-up.

### 15.5 Sending local changes

- Subscribe `store.onUpdate((u, origin) => ...)` at attach. Ignore `origin === remoteOrigin`.
  Ignore everything for `view`.
- While not caught up: set `dirty = true` and drop `u` (the reconnect delta covers it).
- While caught up: in the serial send queue, seal `u` as an update envelope; if it exceeds
  `limits.maxEntryBytes`, use the oversize fallback (§15.7); else send `append {cid, env}` and
  record `cid` as pending.
- On `ack {cid}`: remove it. When nothing is pending, nothing is queued and `dirty` is false:
  `ackedSv = store.encodeStateVector()`, saved through `RoomStateStore` (debounced 1 s).
- **Reconnect delta.** After catch-up: if the store was pristine (`store.size === 0`) when the
  provider attached and this is the first catch-up of this provider instance, set
  `ackedSv = store.encodeStateVector()` and send nothing (a pristine store holds nothing the room
  lacks, whatever an older cursor says). Otherwise
  `u = ackedSv ? store.encodeStateAsUpdate(ackedSv) : store.encodeStateAsUpdate()`; if `u` is
  not empty (`u.length > 2`, the size of an empty Yjs v1 update; the only Yjs-specific constant
  in the provider, revisit for Loro) send it as one append (or the oversize fallback). Clear
  `dirty` and pending.
- On `denied {VIEW_ONLY}`: switch to read-only as in §15.4 step 2 and emit `denied`. On
  `denied {TOO_LARGE}` for an append: use the oversize fallback for that cid.

### 15.6 Persistence of the cursor

`RoomStateStore` persists only `{ ackedSv }` per room. `since` is not persisted: after an app
restart the provider downloads the latest snapshot (when one exists) and the tail. This removes
any ordering hazard between the cursor and the local replica's own persistence. The local
replica is persisted by a separate provider (module D).

### 15.7 Compaction and the oversize fallback

- On `compact {upTo}` (role `edit` only): wait until `since >= upTo` and the provider is clean
  (nothing pending, queued or dirty), at most 30 s; otherwise ignore the request (the relay asks
  someone else). Then, **in one synchronous step**, capture `n = since` and
  `state = store.encodeStateAsUpdate()`; seal it as a snapshot with `upTo = n`; `PUT` it.
  `SNAPSHOT_STALE` is not an error (someone else won).
- **Oversize fallback** (an update or delta over `maxEntryBytes`): wait until no append is
  pending, capture `n = since`, `sv = store.encodeStateVector()` and
  `state = store.encodeStateAsUpdate()` in one step, `PUT ...snapshot?upTo=n&carries=1`. On
  success treat as acked: `ackedSv = sv`. Over `maxSnapshotBytes`: status `error` with
  `TOO_LARGE` (fatal; nothing can carry it).
- On `snapshot {carriesNew: 1}` from the relay with `gen` newer than seen: download it and apply
  it (it carries content that is not in the log). Otherwise just record `gen`.

### 15.8 Repairer election and `autoRepair`

`DocStore` gains:

```ts
/** True when the store repairs cycles and orphans after remote updates and undo/redo. */
readonly autoRepair: boolean
/** Turns automatic repair on or off (the `autoRepair` option, at runtime). */
setAutoRepair(enabled: boolean): void
```

The provider sets it from this table and re-evaluates on `welcome`, `peer-joined`, `peer-left`,
caught-up and close:

| Provider state | `autoRepair` |
|---|---|
| Detached | Restored to the value it had before attach |
| Attached, socket not open (offline, backoff), role `edit` or unknown | `true` |
| Role `view` (any state) | `false` |
| Open, catching up | `false` |
| Open, caught up, `edit`, this peer is the repairer | `true`; on becoming the repairer call `store.repair()` once |
| Open, caught up, `edit`, another peer is the repairer | `false` |

Repairer = the lowest `peer` id among this client (if `edit`) and every known peer with role
`edit`. `NetworkProvider.repairer` exposes it; a `repairer` event fires on change.

### 15.9 Presence (`KimoAwareness`)

- `clientId` is the relay-assigned `peer` (0 before the first `welcome`). States are keyed by
  `peer`.
- `setLocalState(state)`: store it; when connected, send `awareness {clock: ++clock, env}` with
  `env = sealAwareness(keys, roomId, peer, JSON of state without origin)`, throttled to at most
  `limits.awarenessHz` per second (trailing send keeps the latest state). `null` sends an empty
  `env`.
- Incoming `awareness {peer, clock, env}`: open with AAD of that `peer`; failure drops the state
  (presence is not fatal); set `origin` from the peers table (relay stamped), never from the
  payload; emit `added` / `updated` / `removed`.
- `peer-left` and a close remove remote states (emit `removed`). The local state is kept and
  re-sent after the next catch-up.
- `detach()` sends an empty awareness before closing.

### 15.10 Reconnect and liveness

- Backoff with full jitter: `delay = random() * min(max, min * 2^attempt)`, defaults `min = 250`,
  `max = 10 000` ms. `attempt` resets after 10 s of being caught up.
- Retry only for codes marked "yes" in §13. A fatal code stops until `connect()` or
  `setToken(token)`.
- Ping every 20 s while open; if nothing at all has been received for 45 s, close (code 4000,
  client side) and reconnect.
- When an `environment` is given and reports offline, skip attempts until it reports online, then
  connect at once.
- `disconnect()` closes with 1000 and does not reconnect; `connect()` resumes.
- `setToken(token)`: if open, send `refresh`; on `token {exp}` update `exp`. If closed with a
  fatal auth error, reconnect with the new token.

### 15.11 Agent area claims

ADR 0016 item 16. The relay never sees node ids, so claims are cooperative: each client enforces
the claims it knows (its own agents' and the ones peers publish) on its own agents.

**Registry** (`packages/editor-state/src/claims.ts`). `claimsFor(store)` returns the document's
`ClaimRegistry` (created on first use; it follows `store.onChange`). A holder is an agent origin
(`agent:<id>`, `isClaimingOrigin`). MCP clients (`mcp:<client>`) are refused inside claims but
hold none, since no turn would end them (`isClaimRespectingOrigin`); `user` never claims and is
never refused.

- Overlap: a request for ids `T` conflicts with a claim on ids `C` when some `t` in `T` has an
  ancestor-or-self in `C`, or some `c` in `C` has an ancestor-or-self in `T`.
- `check(holder, ids)` returns the oldest overlapping claim of another holder (local or remote),
  or null. Local agents of one session (`claimTeam`: `agent:kimo.<session>.<n>` without `.<n>`,
  a lead and its spawned children) are one holder for this check; their split is enforced by
  node scopes (`OUT_OF_SCOPE`). A remote record is always another holder; `claim(holder, ids, {label, turn})` checks and, when clear, records the ids the holder
  does not cover yet as a new record with `since = now`. Every claim and write renews the
  holder's records (`renewed = now`).
- Expiry: a local record lapses `CLAIM_TTL_MS` (10 min) after `renewed`; a remote record lapses
  10 min after this client last received it with a new `renewed` (local clock, skew-free). The
  last minute reads as `expiring`.
- Release: `releaseClaims(holder, turn?)` on every document at turn end; the MCP connection's
  `setTurn(null)` and `close()` call it; a peer's claims go with `peer-left` or its withdrawn
  presence; `clearRemote()` on disconnect (offline only local claims remain).
- Tie-break (`setRemote`): when a local record overlaps a remote record that wins (smaller
  `since`, then the smaller `holder` string; identical on every client), the local holder drops
  the overlapping ids at once and republishes. Its next write there gets `AREA_BUSY`.
- Human edits: a committed change whose origin is `user` or `remote:user` (a window relayed by
  the document host) inside a local claim is recorded for that holder; so is a network change
  (`remote`, `remote:mp:<room>`) unless a remote claim covers the node. Agent and MCP origins,
  `file` loads and `system` repairs are ignored. A node deleted by a person is matched by its own
  id only.
- UI: `list()` gives `ClaimView`s `{holder, label, ids, since, renewed, turn, local, peer,
  expiresAt, state: "live" | "expiring"}` (a stable array until something changes), `claimAt(id)`
  the claim covering a node, and `subscribe(listener)` change notifications (for
  `useSyncExternalStore`). A timer at the next expiry or `expiring` transition notifies.

**Presence record** (`PresenceState.claims`, sealed like the rest of the state). Published by
`bindClaimsToPresence(registry, awareness, {user?})` (`packages/sync/src/claims-presence.ts`),
which also feeds every peer's `claims` into `registry.setRemote(peer, …)` and puts the claims
back when the app replaces its own presence:

```json
{"user": {"id": "u1", "name": "Ana", "color": "#3366ff"},
 "claims": [{"holder": "agent:kimo.k3x9qa.1", "ids": ["Hero000001"], "since": 1792396800000,
             "renewed": 1792396812000, "turn": "t_8f2", "label": "Kimo"}],
 "working": ["Hero000001"]}
```

| Field | Type | Rule |
|---|---|---|
| `holder` | string | `agent:<id>` or `mcp:<client>`; other values drop the record |
| `ids` | string[] | 1 to 256 node ids; each claims its subtree. A holder publishes at most 256 ids |
| `since` | number | ms since the epoch (holder's clock) when the record was taken |
| `renewed` | number | ms since the epoch of the holder's last activity |
| `turn` | string? | the holder's turn id |
| `label` | string? | display name, up to 80 characters kept |

At most 64 records per peer are read. `working` is the union of the ids while claims exist and
is removed with them.

**Tool layer** (`packages/mcp-server/src/claims.ts`). `dispatch` gates `kimo_apply_ops` (and the
call `kimo_script` compiles to) of agent and MCP origins after authorization, before any approval
prompt, and again (check and, for agents, claim at once) after it; the streamed-edit engine gates each
provisional batch and holds the stream instead of failing. The claimed ids are the op group's
`id`, `instance`, `frame`, `node` and `ids` fields and insert, instantiate, move and copy
`parent`s (never `root`, `@key`s or a copy's source; an IdPath claims its instance). After the
call lands, changed nodes the claim does not cover (layers created at the top level) join it.
Dry runs and groups that only set or clear `placeholder` are exempt.

| Code | When | Envelope |
|---|---|---|
| `AREA_BUSY` | The group touches a node inside, above or below another holder's live claim | `retryable: true`, `nodeId` = first touched id, `suggestion` (work elsewhere or wait), `detail {kind: "area", holder, holderLabel?, ids, touched, since}` (`since` ISO 8601). Not patch-retryable (`retryId` is not set) |
| `REVISION_CONFLICT` | A person edited inside the caller's claim since its last write | `detail {kind: "human-edit", ids, by: "local" \| "remote", current}`. Reported once: the retry goes through |

The built-in agent's `ToolHost.turn("start" | "end", turnId)` (desktop: host RPC `agentTurn`)
stamps claims with the turn and releases them at the end, before the placeholder clear.

### 15.12 Live collaborative text

ADR 0016 item 17. Two people typing in one text layer merge character by character, formatting
included; nobody's typing is lost.

**CRDT shape.** A text node's (`type: "text"`) `content` is a `Y.Text` in the node's map
(`packages/editor-state/src/yjs-store.ts`, the only module that imports Yjs). Each character
carries its span's attributes as Yjs formatting under flat keys: `style.<key>` for every member
of the span's `style`, `href` and `fill` for the span's own fields. Every value is the canonical
JSON of the span value (object keys sorted), so equal values are equal strings and Yjs merges
runs. Concurrent formats of different keys on overlapping ranges both apply.

**Reads are unchanged.** The store's plain mirror (and so `getNode`, `toDocument`, `serialize`,
exporters, MCP reads and validation) sees the content exactly as before: a string when the text
has one run without attributes (or is empty), else spans `{text, style?, href?, fill?}` with
adjacent equal runs merged (`contentOf` in `live-text.ts`). The `.kimo` format does not change.
Only content that is exactly that canonical form of its own runs is held as `Y.Text`
(`liveRepresentable`); any other shape (a single bare span, adjacent equal spans, an empty span,
a binding `{$ref}`) stays a plain value with its exact shape and last-writer-wins, as before.
Node fields other than `content` (`style`, `fill`) stay last-writer-wins map entries.

**Writes.** `DocStore.editText(id, edits, {origin, label?, with?})` applies character edits
(`insert {at, text, attrs?}`, `delete {at, length}`, `format {at, length, attrs}` with `null`
removing a key; UTF-16 offsets, applied in order) as one validated op group; `with` ops (the
node's `style` / `fill`, the `text/runs` feature) join it. An `update` op that sets a live
text's `content` (agents, MCP, the Text section field, a file reload) is applied as the minimal
diff of the current runs: one replaced region (common prefix and suffix kept) plus format
changes of the kept characters (`diffTextRuns`), so concurrent typing elsewhere in the text
survives. Agents still claim the node first (§15.11, `AREA_BUSY`).

**Upgrade.** `loadDocument` and node inserts create `Y.Text` for canonical text content, so
documents upgrade on load. Content written as a plain value by an older client (a room snapshot
made before live text) becomes a `Y.Text` on its first change ("first touch"), starting from the
plain value and then applying the change. Two replicas converting the same plain content at once
each set their own `Y.Text`; the map key keeps one, so no text is doubled, and the replica whose
text lost replays what it changed since the conversion onto the winner as one replaced region
(mapped around the winner's own change), so no typing is lost. `DocStoreOptions.liveText: false`
keeps content plain (tests of mixed rooms).

**Events.** `onTextChange({id, delta, origin, cause})` reports each transaction's character
changes of a text node (`delta`: retain / insert / delete in the text before the change; `null`
when the content was replaced as a whole), before the `StoreChange`. `onBeforeChange(listener)`
runs before the store starts any change (an op group, undo, redo, load, repair, a binary update;
not re-entered), so a live editor writes its batched local edits first and every remote change
it then receives is relative to a text that already holds them.

**Editor** (`apps/web/src/canvas/rich-text/`). Editing a text layer of the document (a real node
the M3 router passes through unchanged) is live (`live.ts`, `RichTextSession.attach`):

- Typing and deleting reach the document at most 50 ms after the keystroke (one op group, so one
  network update, per batch); style changes, line breaks, pastes and panel range edits go at
  once. Each write is the session's runs through the same canonical form as before
  (`toNodePatch`), diffed into character edits with the caret placing an insertion among
  repeated characters, plus the node's own `style` / `fill`.
- A change by anyone else (a person, an agent, the panel's paragraph edits) re-reads the runs and
  re-renders the contenteditable. The DOM selection is read first; the caret sticks to the
  character before it (text someone types at the same place lands after the caret), and a range
  keeps text inserted at its edges outside. A content replaced as a whole keeps the offsets
  (clamped).
- IME: at `compositionstart` pending edits are written and remote changes queue; at
  `compositionend` the queued changes are applied, the composed text's place is moved through
  them, and the composed text is typed there.
- Undo: `DocStore.beginTextEdit(id, origin)` opens the edit. Inside the editor ⌘Z / ⇧⌘Z walk the
  person's own steps (a typing burst, a deletion burst, a paste, a line break, a style change;
  a per-edit undo manager tracking only that origin), never other people's edits. Every change
  of the origin while the edit is open is one undo step on the origin's stack, so after editing
  ends ⌘Z undoes the whole edit ("Edit text"), the deletion of an emptied text included.
- Not live (commit when editing ends, as before): a new text (no node yet), note and prompt
  bodies, text the router rewrites (instance content becomes overrides), bound content. Short
  fields (layer names, component text props, the Text section content field, variable values)
  keep committing on Enter; a whole-content write still merges as a diff.

**Presence.** `PresenceState.text = {node, anchor, focus}` while a person edits a text layer
live: `anchor` and `focus` are opaque positions from `DocStore.encodeTextPosition(id, offset,
assoc?)` (a base64 Yjs relative position, `r…`, or a plain offset `o<n>` for content that is not
live text yet) that follow edits; `resolveTextPosition(id, position)` gives the current offset,
or null. The receiver drops a `text` member whose `node` exceeds 64 characters or whose
positions exceed 256. `PersonView.text` and `AgentView.text` (agents connected with their own
link) carry it; `remoteTextCarets(view, store, nodeId)` and `useRemoteTextCarets(model, key,
store, nodeId)` (`apps/web/src/multiplayer/text-carets.ts`) resolve them to
`{key, kind, peer, label, color, idle, anchor, focus}` offsets for one text node, updated as the
text changes.

**Visuals (board 41 › 11).** `TextCaretLayer` (`apps/web/src/multiplayer-canvas/`) draws them:
a 2 screen px bar 1.2 × the font size tall, centered on the line box, in the presence color (an
agent's persona hue), with a name flag (text-xs 500 on-accent, padding 1 5, radius 3 3 3 0) on
the bar's top, flipped below on the layer's first line; ranges at 0.24 per line box. Flags fade
150 ms after 3 s without a keystroke (a keystroke is a remote change ending at the person's
caret), show on hover, hide below 50 % zoom (a Tooltip on hover) and while you drag. Positions
come from `Renderer.textGeometry(nodeId)` (the canvas layout) for layers you are not editing
and from the contenteditable's range rects for the one you are. Agents have no live caret: a
write inside an agent's claim shows its caret at the end of the changed region for 3 s
(`createAgentTextCarets`), and its pointer hides meanwhile.

## 16. Web integration

### 16.1 Share service (headless)

`createShareService(deps)` returns the API the Share UI will call later. Every method is safe
without UI; errors are `MultiplayerError`s. See §17.D for the exact types.

**`startSharing(target, { relayUrl })`**:

1. `probeRelay(relayUrl)` (`NOT_A_RELAY`, `RELAY_UNREACHABLE`). If the relay is `unclaimed`,
   `claimRelay(relayUrl)` first (§16.9); `RELAY_CLAIMED` ends here.
2. Generate root, link (kid 1) and room keys; derive `roomId`.
3. Prepare the document: compute `sha256` for every manifest asset the local store holds, add
   manifest entries (with `sha256`) for fonts the policy shares (§16.5), embed shaders (§16.6).
   If anything changed, apply it with
   `store.loadDocument(next, { origin: "system", newEpoch: false })` (one non-undoable change).
4. Register (admin op 1) with the owner proof signed by the device key (§6).
5. Mint the owner's own `edit` token (origin `user`, 30 days, flagged `self`, re-minted when
   less than one day remains).
6. Seed: in one synchronous step capture `state = store.encodeStateAsUpdate()` and
   `sv = store.encodeStateVector()`; seal the snapshot with `upTo = 0`; `PUT` it; save the cursor
   `{ ackedSv: sv }`.
7. Persist the `OwnedRoom` (§16.2) keyed by `target.fileKey`.
8. `connect(target, room)` and start asset sync (uploads everything missing).

**`mintLink(room, { role, ttlSeconds, label, origin })`**: `ttlSeconds: null` means `exp = 0`;
`jti` random; stores an `IssuedLink`; returns the full link (§7).

**`revokeLink`**: admin op 2, mark revoked locally. **`resetAllLinks`**: new link key with
`kid + 1`, admin op 3, mark every issued link revoked, re-mint the self token, reconnect.
**`stopSharing`**: admin op 4, detach providers, delete the `OwnedRoom` and the room replica.
**`forgetOwnedRoom`**: the local half of `stopSharing` without the relay (a deleted library file
whose close the relay refused for good). **`moveFile(from, to)`**: Save As moved the shared
document; the `OwnedRoom` is re-keyed to `to` after any save of `from` still being recorded.
**`sweepBlobs`**: `keep` = blob ids of every manifest entry with `sha256` in the current
document; admin op 5.

**`join(link)`** (guests): parse; open or create the room replica store (§16.3); attach the
replica provider, then the network provider; persist a `JoinedRoom`; start asset sync. Returns
the store and session; the UI decides how to show it.

### 16.2 Local registry (`registry.ts`)

IndexedDB database `kimo-multiplayer`, version 1, object stores:

| Store | Key | Value |
|---|---|---|
| `owned` | `room` | `OwnedRoom` (CryptoKey objects stored by structured clone) |
| `joined` | `room` | `JoinedRoom` |
| `cursors` | `room` | `RoomCursor` (implements `RoomStateStore`) |
| `device` | `"self"` | `{ keys: CryptoKeyPair, createdAt }`, the web device key (§16.9); version 2 adds this store |

The registry takes an injectable backend so tests run without IndexedDB (an in-memory map).
Secrets never leave this database except inside links the owner mints.

### 16.3 Room replicas and file reopen (`room-session.ts`)

- Every client keeps the room's CRDT state in IndexedDB database `kimo-room-<room>` through the
  existing `IndexedDbProvider`, attached before the network provider.
- **Owner reopening a shared file** (web or desktop document host): before the file's document is
  loaded into a fresh store, apply the replica (attach the replica provider), then load the file
  with `loadDocument` (diff, only real differences become changes), then attach the network
  provider. If the replica is missing, attach the network provider to the still empty store
  first and wait for the catch-up (a pristine store pushes nothing, §15.5), then
  `loadDocument(file, { origin: "file", newEpoch: false })` so only real file differences become
  updates, which the provider sends like any edit. Module D adds the hook at the
  file session's store creation (`FileSessionManager` / `FileDocumentProvider` load path) without
  changing behaviour for unshared files.
- Guests: the replica is their only copy; their asset store is `kimo-assets-room-<room>`.
- **Save As of a shared file**: the session records the state the new file holds (as for any
  write of a shared file), then the room follows it (`moveFile`: the registry's `fileKey` becomes
  the new path) before the session reads the new file, so the new file reopens shared with no
  delta and the old file is no longer the shared one. The session manager has no rename or move
  of its own; a file moved outside Kimo is a new path and opens unshared.
- **Browser library files** (`#/file/<id>`, `multiplayer/library.ts`): the document key and the
  registry's `fileKey` are `kimo-lib:<fileId>`, stable across reloads; the owner's keys stay in the
  IndexedDB registry. The library's own persistence (`kimo-doc-<id>`) stores the CRDT updates
  themselves, the room's included, so the library copy and the room are two replicas of one
  document: opening the editor attaches the room to the store the library loaded (`connect`, no
  file delta and no saved state to record; there is no file write). Closing the editor ends the
  room connection. Trash keeps the room; deleting the file for good (Delete forever, Empty Trash,
  the 30-day purge) stops sharing, and when the relay refuses the close for good the room is
  forgotten locally (`forgetOwnedRoom`), since nothing could reopen it. On desktop, library keys
  stay with the window's own share backend, not the document host.

### 16.4 Asset sync (`asset-sync.ts`)

- Index: from the document header `assets`, map each key with `sha256` to `{ sha, blobId }`
  (blob ids computed with `blobIdFor`). Recomputed on `store.onChange` with `header: true`.
- **Upload** (role `edit`, after each catch-up and on new manifest entries): `POST
  /blob/<room>/missing` in batches of 1000, then `PUT` each missing blob the local `AssetStore`
  holds, two at a time. `429` and `5xx` retry with the provider's backoff; `413` and `507` emit
  an event and skip.
- **Fetch on demand**: `ensure(key)` for a key with `sha256` that the local store lacks: `GET`,
  `openBlob` (checks the full digest), `assets.putKey(key, bytes, entry)`. Concurrent `ensure`
  calls for one key share one request. `404` is state `missing` (retried on the next catch-up).
- `withRemoteAssets(assets, sync)` wraps an `AssetStore`: a miss in `source`, `bytes`, `url` or
  `info` triggers `ensure` and returns the miss as before, so the existing missing-asset
  placeholder shows until `subscribe` fires.
- Manifest entries without `sha256` (older files) are skipped for upload; when an `edit` client
  has the bytes and the 16-hex prefix matches, it fills in `sha256` with a `system` load as in
  §16.1 step 3.
- **Topbar status** (board 41 › 8 E, `topbarSyncStatus` over `assetSyncStatus`): edits sync
  first, assets after. Where the status would read Synced or View only, uploads show "Sharing N
  images" (SaveStatus/Saving look, still arrow-up), else fetches show "Fetching N images"
  (SaveStatus, arrow-down). Syncing…, Reconnecting… and Offline · edits kept keep the slot.

### 16.5 Font policy (`font-policy.ts`)

A font face is shared (its file uploaded and listed in the manifest with `sha256`) only when its
family is in the bundled offline pack (`FONT_PACK_FAMILIES`) or was fetched from Google Fonts by
the font system. Any other face is `name-only`: nothing is uploaded; text keeps referring to the
family; the share service calls its `onFontNotShared` listeners with the family names, once per
family per room.

### 16.6 Shader embedding (`shader-embed.ts`)

At share time, every paint value `{ kind: "shader", src }` anywhere in node data whose `src` is
not already an asset reference: read the file relative to the document, store it with
`putKey("<hash16>.glsl", bytes)`, add the manifest entry
`{ mime: "text/x-glsl", bytes, name: <original file name>, sha256 }`, and rewrite `src` to
`./assets/<hash16>.glsl`. Unreadable sources are reported in the result and left unchanged.

### 16.7 Format change: `sha256` in the asset manifest

- `AssetEntry` gains `sha256?: string` with pattern `^[0-9a-f]{64}$`.
- New validator error `ASSET_HASH_MISMATCH` when a key's 16-hex hash is not the prefix of its
  entry's `sha256`.
- `docs/spec/kimo-format-1.0.md` §12 rule 2 lists `sha256` ("full lowercase hex SHA-256 of the
  file; written by writers that share or sync assets"), and the key list gains `sha256`.
- `apps/web/src/lib/assets.ts`: `contentDigest(bytes)` returns the full hex digest; `put` and
  `putKey` record it in `AssetInfo.sha256`; `manifestEntry` copies it.

### 16.8 Desktop document host

On desktop the owner's authoritative store is in the document host
([ADR 0002](../adr/0002-document-authority-in-tauri.md)), so sharing runs there. Module D adds
host RPC methods `mp.probe`, `mp.startSharing`, `mp.mintLink`, `mp.listLinks`, `mp.revokeLink`,
`mp.resetAllLinks`, `mp.sweepBlobs`, `mp.stopSharing`, `mp.status` that call the share service
with the hosted session's store and assets. Editor windows keep receiving room changes through
the existing window sync. Guests join in the window context (their documents have no file).

### 16.9 Relay ownership and pairing (`device-key.ts`, `ownership.ts`)

**Device key.** One Ed25519 key pair per Kimo install, created the first time it is needed and
never rotated (a lost key is replaced by pairing a new one).

- Web: a non-extractable `CryptoKeyPair` in IndexedDB `kimo-multiplayer`, store `device`, key
  `"self"`, like the web room keys. Clearing site data loses it.
- Desktop: the 32-byte private seed (PKCS#8, base64url) in the OS keychain, service `kimo`,
  account `relay.device-key`, through `kimo_device_key_get` / `kimo_device_key_set` (Rust,
  `keyring`); every window imports it as a non-extractable `CryptoKey`. The desktop room registry
  stays a JSON file (§16.2); the device key does not, since it outlives every room.
- `devicePublicKey()` returns the base64url public key. It is not a secret: Kimo puts it in the
  local relay's environment, the Docker command, the Fly deploy and the Railway link as
  `KIMO_OWNER_KEY`.
- Default device name: the platform only. Desktop: "Mac", "Windows" or "Linux". Web:
  `<Browser> on <platform>` ("Chrome on Mac", "Safari on iPhone"). Never the OS account name, the
  computer name or any person's name. Sent on claim and pair, at most 64 bytes; the user can
  rename any device (op 6). Two devices with the same default name are told apart by "This
  device" and the added date.

**Ownership state** of a relay, from `/version` plus op 2 when claimed:

| State | Meaning | Start sharing |
|---|---|---|
| `unclaimed` | No owner yet | Claims first, then registers |
| `yours` | This device is in the owner set (op 2 answered) | Registers |
| `other` | Claimed, op 2 answered `NOT_OWNER` | Refused: "This relay belongs to another Kimo" |

**Claim.** `claimRelay(relayUrl)` sends op 1 with the device name. Kimo claims:

- in the wizard's Test (board 42 section 8), as its fourth check "Ownership", for every path;
- on Start sharing when the relay is still unclaimed (a relay saved without a Test);
- in Settings › Multiplayer when it tests the saved relay and finds it unclaimed.

Setup paths and what they put into the relay (no secret in any of them):

| Path | Relay environment | Expected Test result |
|---|---|---|
| This computer | `KIMO_OWNER_KEY=<this device>` in the local process | `yours` (already, `via: "env"`) |
| Docker or your own server | `-e KIMO_OWNER_KEY=<this device>` in the command | `yours` |
| Fly.io (one click or commands) | `KIMO_OWNER_KEY` as a Fly env value | `yours` |
| Railway | The deploy link carries `KIMO_OWNER_KEY=<this device>` as a prefilled variable when Railway supports it (to verify, ADR 0017); otherwise the relay starts unclaimed | `yours`, or claimed by the Test |
| I already have a relay | Nothing (its operator may set `KIMO_OWNER_KEY` themselves) | Claimed by the Test |

**Pairing.** On an owner device, `createPairingLink(relayUrl)` mints a token (§6.2, 15 minutes)
and formats the link (§7.1) with this window's web origin (`kimo:` on desktop). Nothing is sent to
the relay until the link is used; `cancelPairingLink` sends op 5. On the new device,
`acceptPairingLink(link, { name })` parses it (`BAD_LINK`), probes the relay, sends op 3 with its
own device key, and saves the relay URL as `multiplayer.relayUrl` when none is set.

**Devices.** `listDevices(relayUrl)` (op 2), `renameDevice(relayUrl, pub, name)` (op 6) and
`removeDevice(relayUrl, pub)` (op 4). Removing
this device is allowed when another remains; afterwards the state is `other`.

**Removed.** The create secret goes away in full: `relay-setup/secret.ts`, the relay setup
store's secret and mode, `RelaySecretSetting.tsx`, the wizard's secret blocks and Regenerate
flows, `RelayHttpClient.checkCreateSecret`, `startSharing`'s `createSecret`, the
`kimo_relay_secret_*` desktop commands, and on the relay `KIMO_CREATE_SECRET`, the
`kimo-create-secret` header and `/create-secret/check`.

**Copy rules.** The UI never says "secret". The words are: "Yours", "Not claimed yet", "This relay
belongs to another Kimo", "Add device", "Pairing link". Error codes are mapped to sentences, never shown.

**UI states** (boards 41 and 42, redesigned for ADR 0017):

- Wizard Set up: no secret block, no Automatic or Custom choice, no Railway variables step when
  the link prefills the key. Wizard Test: the fourth check is "Ownership" with metas `claiming`,
  `yours`, `already yours`, `belongs to another Kimo`. The outcome "Belongs to another Kimo"
  (actions: Add this device, Reset ownership guide) replaces "Secret rejected".
- Share popover first run: relay URL and Test only; Start sharing claims silently when unclaimed;
  refusal inline with the same two actions.
- Settings › Multiplayer: the Create secret row is removed. The relay row shows the ownership
  state. A Devices group (only when `yours`) lists name, "This device", added date, Rename (the
  name edits in place) and Remove (disabled on the last device), the one-device hint "Add another
  device so you can still manage this relay if this one is lost." (no other prompt), and Add device, which opens the pairing link
  sheet (link, Copy, 15 minute countdown, Cancel; then used, expired or cancelled).
- Remove confirms, with separate copy for this device.
- Pairing sheet on the new device (`/pair`, `kimo://pair`): relay host, device name, Add device;
  then adding, added, already added, expired, used, not valid, unreachable, not a relay.

## 17. TypeScript contracts

### 17.A `@kimo/sync/mp`

```ts
// bytes.ts
export function toBase64Url(bytes: Uint8Array): string
export function fromBase64Url(text: string): Uint8Array // throws MultiplayerError("BAD_REQUEST")
export function toBase32(bytes: Uint8Array): string
export function fromBase32(text: string): Uint8Array
export function toHex(bytes: Uint8Array): string
export function fromHex(text: string): Uint8Array
export function utf8(text: string): Uint8Array
export function fromUtf8(bytes: Uint8Array): string
export function concatBytes(...parts: Uint8Array[]): Uint8Array
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean // constant time for equal lengths
export function randomBytes(length: number): Uint8Array

// errors.ts
export type MpErrorCode =
  | "BAD_REQUEST" | "BAD_MESSAGE" | "AUTH_INVALID" | "KEY_ROTATED" | "TOKEN_REVOKED"
  | "VIEW_ONLY" | "ROLE_UNSUPPORTED" | "ORIGIN_FORBIDDEN"
  | "RELAY_UNCLAIMED" | "NOT_OWNER" | "PAIRING_EXPIRED" | "PAIRING_USED" | "RELAY_CLAIMED" | "LAST_DEVICE"
  | "ROOM_NOT_FOUND" | "NOT_FOUND" | "HELLO_TIMEOUT" | "NONCE_REPLAY" | "SNAPSHOT_STALE"
  | "ROOM_CLOSED" | "TOO_LARGE" | "TOKEN_EXPIRED" | "ROOM_ID_MISMATCH" | "STALE_REQUEST"
  | "KEY_ID_INVALID" | "SNAPSHOT_AHEAD" | "PROTOCOL_MISMATCH" | "RATE_LIMITED" | "INTERNAL"
  | "ROOM_FULL" | "RELAY_FULL" | "LOG_FULL" | "QUOTA_EXCEEDED" | "DECRYPT_FAILED"
  | "BLOB_INTEGRITY" | "BAD_LINK" | "BAD_RELAY_URL" | "NOT_A_RELAY" | "RELAY_UNREACHABLE"
  | "CRYPTO_UNSUPPORTED"
export interface MpErrorInfo {
  /** HTTP status, when the code is used over HTTP. */
  http?: number
  /** WebSocket close code, when the relay closes with it. */
  close?: number
  /** Whether a provider reconnects after a close with this code. */
  retry: boolean
}
export const MP_ERRORS: Readonly<Record<MpErrorCode, MpErrorInfo>>
export class MultiplayerError extends Error {
  override readonly name: "MultiplayerError"
  readonly code: MpErrorCode
  /** Server-suggested wait (from `retry-after`), in ms. */
  readonly retryAfterMs?: number
  constructor(code: MpErrorCode, message?: string, options?: { retryAfterMs?: number; cause?: unknown })
}
/** Close code to error (1001/1006/1012 → RELAY_UNREACHABLE, 1009 → TOO_LARGE, unknown → INTERNAL). */
export function errorFromClose(code: number, reason: string): MultiplayerError
export function isRetryable(error: unknown): boolean
/** Throws CRYPTO_UNSUPPORTED when Ed25519, HKDF or AES-GCM is missing. */
export function assertCryptoSupport(): Promise<void>

// identity.ts
export interface RoomId {
  /** 32-character base32. */
  id: string
  /** 20 bytes. */
  raw: Uint8Array
}
export function generateSigningKeyPair(extractable?: boolean): Promise<CryptoKeyPair> // Ed25519, default false
export function exportPublicKey(key: CryptoKey): Promise<Uint8Array> // 32 bytes
export function importPublicKey(raw: Uint8Array): Promise<CryptoKey>
export function deriveRoomId(rootPublicKey: Uint8Array): Promise<RoomId>
export function parseRoomId(id: string): RoomId // throws BAD_REQUEST
export function isRoomId(id: string): boolean
export interface LinkCert {
  kid: number
  iat: number
  room: RoomId
  linkPub: Uint8Array
  /** The full certificate bytes (payload and signature). */
  bytes: Uint8Array
}
export function signLinkCert(
  rootPrivateKey: CryptoKey,
  input: { kid: number; iat: number; room: RoomId; linkPub: Uint8Array },
): Promise<LinkCert>
export function parseLinkCert(bytes: Uint8Array): LinkCert // throws AUTH_INVALID
export function verifyLinkCert(cert: LinkCert, rootPublicKey: Uint8Array): Promise<boolean>

// tokens.ts
export type Role = "view" | "edit"
export type TokenRole = Role | "comment"
export type MpOrigin = "user" | `agent:${string}` | `mcp:${string}`
export interface TokenClaims {
  room: RoomId
  role: TokenRole
  kid: number
  iat: number
  /** Unix seconds; 0 = never. */
  exp: number
  /** 16 bytes. */
  jti: Uint8Array
  origin: MpOrigin
}
export interface ParsedToken extends TokenClaims {
  payload: Uint8Array
  signature: Uint8Array
}
export function mintToken(linkPrivateKey: CryptoKey, claims: TokenClaims): Promise<string>
export function parseToken(token: string): ParsedToken // throws AUTH_INVALID
export function verifyTokenSignature(token: ParsedToken, linkPublicKey: Uint8Array): Promise<boolean>
export function isMpOrigin(value: unknown): value is MpOrigin
export type AdminOp = "register" | "revoke" | "rotate" | "close" | "sweep"
export type AdminBody =
  | { op: "register"; rootPub: string; cert: string; owner: { pub: string; sig: string } }
  | { op: "revoke"; jti: string; exp: number }
  | { op: "rotate"; cert: string }
  | { op: "close" }
  | { op: "sweep"; keep: string[]; graceDays?: number }
export interface AdminCommand {
  op: AdminOp
  /** Unix ms. */
  iat: number
  nonce: Uint8Array
  room: RoomId
  /** Parsed JSON body (without `op`). */
  body: Record<string, unknown>
  payload: Uint8Array
  signature: Uint8Array
}
/** Signs `body` (serialized with JSON.stringify, `op` removed) as an admin command. */
export function signAdminCommand(
  rootPrivateKey: CryptoKey,
  room: RoomId,
  body: AdminBody,
  options?: { iat?: number; nonce?: Uint8Array },
): Promise<Uint8Array>
export function parseAdminCommand(bytes: Uint8Array): AdminCommand // throws BAD_REQUEST
export function verifyAdminCommand(command: AdminCommand, rootPublicKey: Uint8Array): Promise<boolean>

// owner.ts (§6, §6.1, §6.2)
/** The register owner proof: signs relayId, room, nonce, iat and rootPub (§6). */
export function signRegisterOwner(
  device: CryptoKeyPair,
  input: { relayId: Uint8Array; room: RoomId; nonce: Uint8Array; iat: number; rootPub: Uint8Array },
): Promise<{ pub: string; sig: string }>
export function verifyRegisterOwner(
  owner: { pub: string; sig: string },
  input: { relayId: Uint8Array; room: RoomId; nonce: Uint8Array; iat: number; rootPub: Uint8Array },
): Promise<boolean>
export type OwnerOp = "claim" | "devices" | "pair" | "remove" | "cancel-pairing" | "rename"
export type OwnerBody =
  | { op: "claim"; name: string }
  | { op: "devices" }
  | { op: "pair"; token: string; name: string }
  | { op: "remove"; pub: string }
  | { op: "cancel-pairing"; jti: string; exp: number }
  | { op: "rename"; pub: string; name: string }
export interface OwnerCommand {
  op: OwnerOp
  /** Unix ms. */
  iat: number
  nonce: Uint8Array
  relayId: Uint8Array
  devicePub: Uint8Array
  body: Record<string, unknown>
  payload: Uint8Array
  signature: Uint8Array
}
export function signOwnerCommand(
  device: CryptoKeyPair,
  relayId: Uint8Array,
  body: OwnerBody,
  options?: { iat?: number; nonce?: Uint8Array },
): Promise<Uint8Array>
export function parseOwnerCommand(bytes: Uint8Array): OwnerCommand // throws BAD_REQUEST
export function verifyOwnerCommand(command: OwnerCommand): Promise<boolean> // against command.devicePub
export interface PairingClaims {
  /** Unix seconds. */
  iat: number
  exp: number
  /** 16 bytes. */
  jti: Uint8Array
  relayId: Uint8Array
  issuerPub: Uint8Array
}
export interface ParsedPairingToken extends PairingClaims { payload: Uint8Array; signature: Uint8Array }
export const PAIRING_TTL_SECONDS = 900
export const PAIRING_MAX_TTL_SECONDS = 3600
export function mintPairingToken(issuer: CryptoKeyPair, claims: Omit<PairingClaims, "issuerPub">): Promise<string>
export function parsePairingToken(token: string): ParsedPairingToken // throws AUTH_INVALID
export function verifyPairingToken(token: ParsedPairingToken): Promise<boolean> // signature only
export function isDeviceName(value: unknown): value is string

// keys.ts
export function generateRoomKey(): Uint8Array // 32 random bytes
export interface RoomKeys {
  readonly room: RoomId
  readonly doc: CryptoKey
  readonly awareness: CryptoKey
  readonly blobMac: CryptoKey
  /** AES-GCM key for one blob, from the plaintext SHA-256 (32 bytes). */
  blobKey(sha256: Uint8Array): Promise<CryptoKey>
}
export function deriveRoomKeys(roomKey: Uint8Array, room: RoomId): Promise<RoomKeys>
export const HKDF_INFO: {
  readonly doc: "kimo/v1/doc"
  readonly awareness: "kimo/v1/awareness"
  readonly blobId: "kimo/v1/blob-id"
  readonly blobPrefix: "kimo/v1/blob/"
}

// envelope.ts
export const ENVELOPE_VERSION = 1
export const EnvelopeKind = { update: 1, snapshot: 2, awareness: 3, blob: 4 } as const
export type EnvelopeKind = (typeof EnvelopeKind)[keyof typeof EnvelopeKind]
/** `iv` is for tests and vectors only. */
export interface SealOptions { iv?: Uint8Array }
export function sealUpdate(keys: RoomKeys, update: Uint8Array, options?: SealOptions): Promise<Uint8Array>
export function openUpdate(keys: RoomKeys, envelope: Uint8Array): Promise<Uint8Array>
export function sealSnapshot(keys: RoomKeys, upTo: number, state: Uint8Array, options?: SealOptions): Promise<Uint8Array>
export function openSnapshot(keys: RoomKeys, upTo: number, envelope: Uint8Array): Promise<Uint8Array>
export function sealAwareness(keys: RoomKeys, peer: number, json: Uint8Array, options?: SealOptions): Promise<Uint8Array>
export function openAwareness(keys: RoomKeys, peer: number, envelope: Uint8Array): Promise<Uint8Array>
export function envelopeKind(envelope: Uint8Array): EnvelopeKind | null

// blob-crypto.ts
export function sha256(bytes: Uint8Array): Promise<Uint8Array>
export function blobIdFor(keys: RoomKeys, sha: Uint8Array): Promise<string>
export function sealBlob(
  keys: RoomKeys,
  plaintext: Uint8Array,
  options?: SealOptions & { sha?: Uint8Array },
): Promise<{ id: string; sha: Uint8Array; envelope: Uint8Array }>
/** Opens and checks SHA-256(plaintext) == sha (BLOB_INTEGRITY). */
export function openBlob(keys: RoomKeys, sha: Uint8Array, envelope: Uint8Array): Promise<Uint8Array>
export function isBlobId(id: string): boolean

// links.ts
export interface JoinLink {
  /** e.g. `https://app.kimo.design` or `kimo:`. */
  webOrigin: string
  /** Normalized relay base URL. */
  relayUrl: string
  room: string
  token: string
  roomKey: Uint8Array
}
export function formatJoinLink(link: JoinLink): string
/** Accepts a full URL or a bare fragment (with or without `#`). Throws BAD_LINK. */
export function parseJoinLink(text: string): JoinLink
export function normalizeRelayUrl(url: string): string // throws BAD_RELAY_URL
export interface PairingLink {
  webOrigin: string
  relayUrl: string
  token: string
}
export function formatPairingLink(link: PairingLink): string // `<webOrigin>/pair#<relay>/<token>`
/** Accepts a full URL or a bare fragment. Throws BAD_LINK. */
export function parsePairingLink(text: string): PairingLink
export function syncUrlFor(relayUrl: string, room: string): string
export function httpUrlFor(relayUrl: string, path: string): string

// protocol.ts
export const PROTOCOL = "kimo-mp/1"
export const SUBPROTOCOL = "kimo-mp.1"
export const PROTOCOL_VERSION = 1
export const ClientType = { hello: 1, append: 2, awareness: 3, caughtUp: 4, refresh: 5, ping: 6 } as const
export const RelayType = {
  welcome: 16, entries: 17, ack: 18, awareness: 19, peerJoined: 20, peerLeft: 21,
  snapshot: 22, compact: 23, denied: 24, token: 25, pong: 26,
} as const
export interface RelayLimits {
  maxEntryBytes: number
  maxSnapshotBytes: number
  maxBlobBytes: number
  roomQuotaBytes: number
  awarenessHz: number
}
export const DEFAULT_LIMITS: RelayLimits // 4 MiB, 64 MiB, 20 MiB, 500 MiB, 20
export interface PeerInfo { peer: number; role: Role; origin: MpOrigin }
export interface SnapshotInfo { upTo: number; gen: number; bytes: number }
export interface LogEntry { seq: number; origin: MpOrigin; env: Uint8Array }
export type ClientMessage =
  | { type: "hello"; proto: number; token: string; since: number; client: string }
  | { type: "append"; cid: number; env: Uint8Array }
  | { type: "awareness"; clock: number; env: Uint8Array }
  | { type: "caught-up"; seq: number }
  | { type: "refresh"; token: string }
  | { type: "ping"; n: number }
export type RelayMessage =
  | {
      type: "welcome"; peer: number; role: Role; origin: MpOrigin; exp: number; kid: number
      head: number; base: number; from: number; needSnapshot: boolean
      snapshot: SnapshotInfo | null; limits: RelayLimits; peers: PeerInfo[]
    }
  | { type: "entries"; entries: LogEntry[] }
  | { type: "ack"; cid: number; seq: number }
  | { type: "awareness"; peer: number; clock: number; env: Uint8Array }
  | { type: "peer-joined"; peer: PeerInfo }
  | { type: "peer-left"; peer: number }
  | { type: "snapshot"; info: SnapshotInfo; carriesNew: boolean }
  | { type: "compact"; upTo: number }
  | { type: "denied"; code: MpErrorCode; cid: number; message: string }
  | { type: "token"; exp: number }
  | { type: "pong"; n: number }
export function encodeClientMessage(message: ClientMessage): Uint8Array
/** Throws MultiplayerError("BAD_MESSAGE") on malformed input or an unknown type. */
export function decodeClientMessage(bytes: Uint8Array): ClientMessage
export function encodeRelayMessage(message: RelayMessage): Uint8Array
/** Returns null for an unknown type (clients ignore it); throws BAD_MESSAGE when malformed. */
export function decodeRelayMessage(bytes: Uint8Array): RelayMessage | null

// http.ts
export interface RelayInfo {
  relayUrl: string
  name: string
  version: string
  protocol: typeof PROTOCOL
  limits: RelayLimits
  relayId: Uint8Array
  owner: "unclaimed" | "claimed"
}
export interface OwnerDevice {
  pub: string
  name: string
  addedAt: number
  addedBy: string | null
  via: "claim" | "pair" | "env"
}
export interface RoomInfo {
  room: string; kid: number; head: number; base: number
  snapshot: SnapshotInfo | null; usedBytes: number; quotaBytes: number; peers: number
}
export interface FetchedSnapshot { upTo: number; gen: number; envelope: Uint8Array }
export interface RelayHttpClientOptions {
  relayUrl: string
  fetch?: typeof fetch
  /** Per-request timeout in ms. Default 30 000. */
  timeoutMs?: number
}
/** Every method throws MultiplayerError (mapped from the JSON error body or the network failure). */
export class RelayHttpClient {
  constructor(options: RelayHttpClientOptions)
  readonly relayUrl: string
  probe(): Promise<RelayInfo>
  admin(room: string, command: Uint8Array): Promise<Record<string, unknown>>
  /** `POST /owner`: the parsed JSON success body (`{devices}` or `{}`). */
  owner(command: Uint8Array): Promise<{ status: 200 | 201; devices: OwnerDevice[] | null }>
  roomInfo(room: string, token: string): Promise<RoomInfo>
  getSnapshot(room: string, token: string): Promise<FetchedSnapshot | null>
  putSnapshot(room: string, token: string, upTo: number, envelope: Uint8Array, options?: { carries?: boolean }): Promise<{ gen: number; upTo: number }>
  putBlob(room: string, token: string, id: string, envelope: Uint8Array): Promise<"created" | "exists">
  hasBlob(room: string, token: string, id: string): Promise<boolean>
  getBlob(room: string, token: string, id: string): Promise<Uint8Array | null>
  missingBlobs(room: string, token: string, ids: readonly string[]): Promise<string[]>
}
```

#### 17.A.1 Module A decisions (resolved ambiguities)

Decided while implementing module A; they are normative for the other modules.

- **Origin field.** `mintToken` always writes the origin, `user` included (the §19 token carries
  `0475736572`). A token without the field (124 bytes) still parses as `user`.
- **Role and kid parsing.** Role bytes other than 1, 2 and 3 are format errors (`AUTH_INVALID` at
  §4 step 1); `ROLE_UNSUPPORTED` (step 6) is therefore only ever `comment`. `mintToken` and
  `signLinkCert` require `kid >= 1`; `parseLinkCert` rejects `kid = 0`; `parseToken` accepts any
  `u32` and leaves the mismatch to step 4. Token strings over 4096 characters are `AUTH_INVALID`.
- **`MpOrigin`.** `isMpOrigin` checks the grammar and the 64-byte UTF-8 limit, everywhere an
  origin appears (tokens and relay frames alike).
- **Canonical encodings.** base64url and base32 decoders also reject nonzero trailing bits, so each
  byte string has exactly one text form. `fromHex` accepts lowercase only. `fromBase32` and
  `fromHex` throw `BAD_REQUEST` like `fromBase64Url`.
- **Verification is bound to the room.** `verifyLinkCert` and `verifyAdminCommand` also return
  false when the room is not the room of the given root key, or when the parsed fields differ from
  the signed bytes. All `verify*` functions return false (never throw) on malformed keys.
- **Admin bodies.** `signAdminCommand` and `parseAdminCommand` both validate the body against its
  op (`BAD_REQUEST`): `rootPub` and `cert` are base64url strings, `jti` is 32 lowercase hex
  digits, `exp` an integer `>= 0`, `keep` an array of blob ids, `graceDays` an integer `>= 1`.
  The body must be a JSON object; unknown extra keys are kept and ignored.
- **Codec.** Client frames are strict: trailing bytes, bad UTF-8, `varUint` above `2^53 - 1`,
  a `client` string over 64 bytes or a token over 4096 bytes are `BAD_MESSAGE`. Relay frames are
  forward compatible: unknown types decode to null and bytes after the known fields are ignored
  (a newer relay may append fields). A `denied` code this version does not know decodes as
  `INTERNAL` with message `"<CODE>: <message>"`. Item counts larger than the bytes left are
  `BAD_MESSAGE`. Decoded byte fields are copies, never views into the frame.
- **Close codes.** `errorFromClose` also maps `1000` and the client-side liveness close `4000` to
  `RELAY_UNREACHABLE`; an unknown code whose reason is an `MpErrorCode` yields that code.
- **Links.** `parseJoinLink` ignores whitespace anywhere (wrapped links) and trailing slashes,
  and decodes a percent-encoded fragment once when the raw one fails. `webOrigin` is the URL
  origin for `http(s)`, the bare scheme otherwise (`kimo:`), and `""` for a bare fragment;
  `formatJoinLink` with `webOrigin: ""` returns `#<fragment>`. `formatJoinLink` normalizes the
  relay URL and validates every part (`BAD_LINK`). `normalizeRelayUrl` converts IDN hosts to
  punycode; for `http` only `127.0.0.1` of the loopback range is accepted, as listed.
- **HTTP client.** Errors without a JSON body map from the status (`400 BAD_REQUEST`,
  `401 AUTH_INVALID`, `403 ORIGIN_FORBIDDEN`, `404 NOT_FOUND`, `409 SNAPSHOT_STALE`,
  `410 ROOM_CLOSED`, `413 TOO_LARGE`, `426 PROTOCOL_MISMATCH`, `429 RATE_LIMITED`,
  `502`/`503`/`504 RELAY_UNREACHABLE` (a proxy in front of a relay that is down), `507
  QUOTA_EXCEEDED`, other `5xx INTERNAL`). An unknown `error` string falls back to the status.
  A malformed success response is `INTERNAL`. `probe` keeps `RELAY_UNREACHABLE` and
  `RATE_LIMITED` and turns every other failure into `NOT_A_RELAY`. `hasBlob` returns false on
  any `404` (HEAD has no body to tell `ROOM_NOT_FOUND` apart). `missingBlobs` batches by 1000
  itself. Room and blob ids are validated before any request (`BAD_REQUEST`). Every method
  returns a rejected promise, never a synchronous throw.
- **Extra exports.** Besides §17.A, `@kimo/sync/mp` exports helpers other modules may reuse:
  `isMpErrorCode`, `closeCodeFor`, `isRole`, `roomIdFromRaw`, `roomMatchesRootKey`,
  `signWithContext`, `verifyWithContext`, `adminBodyError`, `deriveKeyBits` (vectors and
  diagnostics only), the generic `seal` / `open` and `blobAad`, `parseRetryAfter`,
  `errorFromResponse`, byte helpers (`Bytes`, `asBytes`, `isUint`, `readU32`, `readU64`,
  `writeU32`, `writeU64`, `viewOf`) and size constants (`TOKEN_MIN_BYTES`, `LINK_CERT_BYTES`,
  `ENVELOPE_OVERHEAD`, `MAX_AWARENESS_BYTES`, `MAX_ENTRIES_PER_FRAME`, `MAX_ENTRIES_FRAME_BYTES`,
  `MISSING_BATCH` and others).
- **Entry point.** The protocol is exported as `@kimo/sync/mp` only; the root `@kimo/sync` index
  (owned by module B) does not re-export it, so the relay never loads the root entry.

### 17.B `@kimo/sync` network provider

```ts
// network.ts
import type { ClaimRecord, DocStore, LocalOrigin } from "@kimo/editor-state"
import type { MpErrorCode, MultiplayerError, PeerInfo, RelayLimits, Role } from "./mp"
import type { SyncProvider } from "./provider"
import type { RoomStateStore } from "./room-state"

export interface PresenceState {
  user: { id: string; name: string; color: string }
  /** Set from the relay-stamped token origin on receipt; ignored when sent. */
  origin: LocalOrigin
  cursor?: { x: number; y: number }
  selection?: readonly string[]
  working?: readonly string[]
  /** Agent area claims (§15.11). */
  claims?: readonly ClaimRecord[]
  /** Page the collaborator is looking at. */
  page?: string
  /** Caret and selection in the text layer being edited live (§15.12). */
  text?: { node: string; anchor: string; focus: string }
}
export interface Awareness {
  /** Relay-assigned peer id of this replica (0 before the first welcome). */
  readonly clientId: number
  getLocalState(): PresenceState | null
  /** Publishes (or with null, withdraws) this replica's presence; `origin` is filled in. */
  setLocalState(state: Omit<PresenceState, "origin"> | null): void
  getStates(): ReadonlyMap<number, PresenceState>
  onChange(listener: (change: { added: number[]; updated: number[]; removed: number[] }) => void): () => void
}
export interface NetworkEnvironment {
  online(): boolean
  onOnline(listener: () => void): () => void
}
export interface NetworkProviderOptions {
  /** Normalized relay base URL (`https://relay.example.com`). */
  relayUrl: string
  room: string
  token: string
  /** 32-byte room key from the link. */
  roomKey: Uint8Array
  /** Persists `ackedSv`. Default: in memory. */
  state?: RoomStateStore
  WebSocket?: new (url: string, protocols?: string | string[]) => WebSocket
  fetch?: typeof fetch
  /** Reconnect back-off bounds in ms. Default `[250, 10_000]`. */
  backoff?: [min: number, max: number]
  /** Sent in `hello`. Default `kimo/<package version>`. */
  clientInfo?: string
  /** Default 15 000. */
  connectTimeoutMs?: number
  environment?: NetworkEnvironment
  random?: () => number
  now?: () => number
}
export type NetworkEvent =
  | { type: "welcome"; peer: number; role: Role; exp: number; limits: RelayLimits }
  | { type: "caught-up"; since: number }
  | { type: "peers"; peers: ReadonlyMap<number, PeerInfo> }
  | { type: "repairer"; peer: number | null; self: boolean }
  | { type: "denied"; code: MpErrorCode; message: string }
  | { type: "closed"; error: MultiplayerError | null; willRetry: boolean; retryInMs?: number }
  | { type: "compacted"; upTo: number; gen: number }
  | { type: "snapshot-applied"; upTo: number; gen: number }
export interface NetworkProvider extends SyncProvider {
  readonly relayUrl: string
  readonly room: string
  /** True while the socket is open and the initial catch-up completed. */
  readonly connected: boolean
  readonly role: Role | null
  readonly peer: number | null
  readonly peers: ReadonlyMap<number, PeerInfo>
  /** Elected repairer's peer id (§15.8), or null. */
  readonly repairer: number | null
  /** Token expiry from the last welcome (unix s; 0 = never), or null. */
  readonly exp: number | null
  readonly awareness: Awareness
  connect(): void
  disconnect(): void
  /** Swaps the token (refresh when open, reconnect after a fatal auth close). */
  setToken(token: string): void
  onEvent(listener: (event: NetworkEvent) => void): () => void
}
export type CreateNetworkProvider = (options: NetworkProviderOptions) => NetworkProvider
export const createNetworkProvider: CreateNetworkProvider

// room-state.ts
export interface RoomCursor {
  /** State vector of the local store when everything local was acknowledged by the relay. */
  ackedSv: Uint8Array | null
}
export interface RoomStateStore {
  load(room: string): Promise<RoomCursor | null>
  save(room: string, cursor: RoomCursor): Promise<void>
  clear(room: string): Promise<void>
}
export class MemoryRoomStateStore implements RoomStateStore { /* ... */ }

// awareness.ts
export class KimoAwareness implements Awareness { /* constructed by the provider */ }
```

### 17.C `@kimo/server`

```ts
// config.ts
export interface RelayConfig {
  port: number
  hostname: string
  dataDir: string
  allowedOrigins: "*" | readonly string[]
  /** KIMO_OWNER_KEY, decoded (32 bytes each). */
  ownerKeys: readonly Uint8Array[]
  /** KIMO_RESET_OWNER, or null. */
  resetOwner: string | null
  maxRooms: number
  maxPeers: number
  roomQuotaBytes: number
  blobMaxBytes: number
  entryMaxBytes: number
  snapshotMaxBytes: number
  logMaxBytes: number
  compactEntries: number
  compactBytes: number
  logRetainMs: number
  roomTtlDays: number
  sweepGraceDays: number
  trustProxy: boolean
}
/** Throws an Error naming the variable on an invalid value. */
export function loadConfig(env: Record<string, string | undefined>): RelayConfig

// index.ts
export interface ServerOptions {
  port: number
  hostname?: string
  /** Overrides on top of loadConfig({}) defaults. `dataDir: ":memory:"` keeps everything in memory. */
  config?: Partial<RelayConfig>
  /** Clock for tests. Default Date.now. */
  now?: () => number
}
export const SYNC_PATH = "/sync"
export function createServer(options: ServerOptions): Bun.Server<unknown> // stop() also closes the database
export function handleRequest(req: Request): Response // /healthz, /version only (kept for tests)
export const versionInfo: VersionInfo // protocol, limits, ownership; handleRequest has no database, so it reports owner "unclaimed"
```

### 17.D `apps/web/src/multiplayer`

```ts
import type { KimoDocument } from "@kimo/core-schema"
import type { DocStore } from "@kimo/editor-state"
import type { NetworkProvider, NetworkProviderOptions, PresenceState } from "@kimo/sync"
import type { MpOrigin, OwnerDevice, RelayInfo, Role } from "@kimo/sync/mp"
import type { AssetStore } from "../lib/assets"
import type { Registry } from "./registry"

export interface ShareTarget {
  /** Stable local key of the document: the file path on desktop, the file id on web. */
  fileKey: string
  store: DocStore
  assets: AssetStore
  /** Reads a file relative to the document (shader sources); null when unavailable. */
  readRelative?(path: string): Promise<Uint8Array | null>
}
export interface IssuedLink {
  jti: string // hex
  role: Role
  /** Unix s; 0 = never. */
  exp: number
  iat: number
  kid: number
  origin: MpOrigin
  label?: string
  revoked: boolean
  /** The owner's own connection token; not shown as a share link. */
  self?: boolean
  link: string
}
export interface OwnedRoom {
  room: string
  relayUrl: string
  fileKey: string
  roomKey: Uint8Array
  rootKeys: CryptoKeyPair
  linkKeys: CryptoKeyPair
  kid: number
  createdAt: number
  links: IssuedLink[]
}
export interface JoinedRoom {
  room: string
  relayUrl: string
  token: string
  roomKey: Uint8Array
  role: Role
  joinedAt: number
}
export interface OwnedRoomSummary { room: string; relayUrl: string; fileKey: string; kid: number; createdAt: number; links: IssuedLink[] }
export interface JoinedRoomSummary { room: string; relayUrl: string; role: Role; joinedAt: number }
export type RelayOwnerState = "unclaimed" | "yours" | "other"
export interface RelayOwnership {
  relayUrl: string
  state: RelayOwnerState
  /** Only when `yours`. */
  devices: RelayDevice[] | null
}
export interface RelayDevice extends OwnerDevice {
  /** This install's key. */
  self: boolean
}
export interface IssuedPairingLink { link: string; jti: string; iat: number; exp: number }
export interface DeviceKeyStore {
  readonly backend: "keychain" | "indexeddb" | "memory"
  /** The install's key pair, created and stored on first call. */
  get(): Promise<CryptoKeyPair>
}
export interface MintLinkOptions { role: Role; ttlSeconds: number | null; label?: string; origin?: MpOrigin }
export interface SweepResult { marked: number; deleted: number; kept: number; bytesFreed: number }
export type AssetSyncState = "local" | "fetching" | "missing" | "failed" | "unknown"
export interface AssetSync {
  start(): void
  stop(): void
  ensure(key: string): Promise<boolean>
  state(key: string): AssetSyncState
  uploadMissing(): Promise<{ uploaded: number; skipped: number }>
  subscribe(listener: () => void): () => void
}
export interface SharedSession {
  readonly room: string
  readonly role: Role
  readonly store: DocStore
  readonly provider: NetworkProvider
  readonly assets: AssetStore // wrapped with withRemoteAssets
  readonly assetSync: AssetSync
  setPresence(state: Omit<PresenceState, "origin"> | null): void
  leave(): Promise<void>
}
export interface ShareServiceDeps {
  registry?: Registry // default: IndexedDB
  fetch?: typeof fetch
  WebSocket?: NetworkProviderOptions["WebSocket"]
  /** Base for join links. Default `location.origin` on web, `kimo:` on desktop. */
  webOrigin: string
  /** Creates the store and asset store a guest room lives in. */
  openGuestDocument(room: string): Promise<{ store: DocStore; assets: AssetStore }>
  /** Default: IndexedDB on web, the keychain on desktop. */
  deviceKeys?: DeviceKeyStore
  /** Default device name (§16.9). */
  deviceName?: () => string
  now?: () => number
}
export interface ShareService {
  probeRelay(relayUrl: string): Promise<RelayInfo>
  /** Claims the relay first when it is unclaimed (§16.9). */
  startSharing(target: ShareTarget, options: { relayUrl: string }): Promise<OwnedRoomSummary>
  devicePublicKey(): Promise<string>
  relayOwnership(relayUrl: string): Promise<RelayOwnership>
  claimRelay(relayUrl: string, options?: { name?: string }): Promise<RelayDevice[]>
  listDevices(relayUrl: string): Promise<RelayDevice[]>
  removeDevice(relayUrl: string, pub: string): Promise<RelayDevice[]>
  renameDevice(relayUrl: string, pub: string, name: string): Promise<RelayDevice[]>
  createPairingLink(relayUrl: string, options?: { ttlSeconds?: number }): Promise<IssuedPairingLink>
  cancelPairingLink(relayUrl: string, link: IssuedPairingLink): Promise<void>
  acceptPairingLink(link: string, options?: { name?: string }): Promise<{ relayUrl: string; devices: RelayDevice[] }>
  roomForFile(fileKey: string): Promise<OwnedRoomSummary | null>
  connect(target: ShareTarget, room: string): Promise<SharedSession>
  mintLink(room: string, options: MintLinkOptions): Promise<IssuedLink>
  listLinks(room: string): Promise<IssuedLink[]>
  revokeLink(room: string, jti: string): Promise<void>
  resetAllLinks(room: string): Promise<{ kid: number }>
  sweepBlobs(room: string, target: ShareTarget, options?: { graceDays?: number }): Promise<SweepResult>
  stopSharing(room: string): Promise<void>
  /** Local only: ends the sessions and deletes the record, cursor, saved state and replica. */
  forgetOwnedRoom(room: string): Promise<void>
  /** Save As: the owned room of `from` is recorded under `to`; false when `from` is not shared. */
  moveFile(from: string, to: string): Promise<boolean>
  join(link: string): Promise<SharedSession>
  listJoinedRooms(): Promise<JoinedRoomSummary[]>
  forgetJoinedRoom(room: string): Promise<void>
  /** Fires with family names that were not shared (§16.5). */
  onFontNotShared(listener: (event: { room: string; families: string[] }) => void): () => void
}
export function createShareService(deps: ShareServiceDeps): ShareService
export function createAssetSync(options: {
  room: string
  relayUrl: string
  token: () => string
  roomKey: Uint8Array
  provider: NetworkProvider
  store: DocStore
  assets: AssetStore
  fetch?: typeof fetch
}): AssetSync
export function withRemoteAssets(assets: AssetStore, sync: AssetSync): AssetStore
export type FontShareDecision = "share" | "name-only"
export function fontShareDecision(face: { family: string; source?: "pack" | "google" | "user" }): FontShareDecision
export function embedShaders(
  doc: KimoDocument,
  read: (path: string) => Promise<Uint8Array | null>,
  assets: AssetStore,
): Promise<{ doc: KimoDocument; embedded: number; missing: string[] }>
```

## 18. Test plan

Every module runs `bunx biome check` on its files and `bun test` in its package. Tests use only
`bun:test`. No test talks to the network beyond `127.0.0.1` on an ephemeral port.

### 18.A Protocol core (`packages/sync/test/mp/`)

- `vectors.test.ts`: every §19 vector reproduces byte for byte (room id, token, certificate,
  admin signature, HKDF outputs, blob id, every envelope with the fixed IV) and opens back.
- `bytes.test.ts`: base64url and base32 round trips for lengths 0 to 64, rejection of padding,
  `+`, `/`, uppercase base32 and invalid characters; hex; `equalBytes`.
- `tokens.test.ts`: mint, parse, verify; wrong link key fails; one flipped payload bit fails;
  trailing bytes, unknown version or type, reserved flag bits, origin over 64 bytes and an
  invalid origin grammar are `AUTH_INVALID`; `exp = 0` round trips; `comment` role parses.
- `identity.test.ts`: room id is 32 base32 characters; `parseRoomId` rejects bad input; cert
  sign, parse, verify, tamper.
- `admin.test.ts`: every op signs and parses back its body; a tampered body fails verification;
  body length mismatch is `BAD_REQUEST`.
- `envelope.test.ts`: round trips per kind; wrong AAD inputs (room, upTo, peer) fail with
  `DECRYPT_FAILED`; a kind byte swap fails; truncated envelopes fail; IVs differ between seals.
- `blob-crypto.test.ts`: same plaintext gives the same id in one room and different ids in two
  rooms; `openBlob` with a wrong `sha` is `BLOB_INTEGRITY` or `DECRYPT_FAILED`.
- `links.test.ts`: format and parse round trip, with a relay path prefix; relay URL normalization
  table (schemes, ports, trailing slash, uppercase host, `http` allowed only for local hosts);
  `BAD_LINK` cases (missing segment, wrong room in token, short key).
- `protocol.test.ts`: every message type round trips through encode and decode; an unknown relay
  type decodes to null; an unknown client type and truncated frames throw `BAD_MESSAGE`; large
  `varUint` values up to `2^53 - 1`.
- `http.test.ts`: against a `Bun.serve` stub: status and JSON error mapping to
  `MultiplayerError`, `retry-after` to `retryAfterMs`, headers sent (`Authorization`), snapshot headers parsed, timeouts.
- `errors.test.ts`: `MP_ERRORS` covers every code; close code mapping both ways.
- `owner.test.ts` (ADR 0017): owner commands sign, parse and verify for every op; a flipped bit,
  another `relayId` or another device key fails; body over 16 KiB, bad names (empty, over 64
  bytes, control characters) are `BAD_REQUEST`. Register owner proof signs and verifies, and fails
  for another room, nonce, `iat`, `rootPub` or `relayId`. Pairing tokens: mint, parse (148 bytes),
  verify; trailing bytes, wrong type, nonzero flags are `AUTH_INVALID`.
- `links.test.ts` (extended): pairing links format and parse with a relay path prefix; a join
  link is not a pairing link and the reverse (`BAD_LINK`).
- `vectors.test.ts` (extended): module A adds §19 vectors for one owner command (claim), one
  register owner proof and one pairing token, from the fixed keys and nonces of §19.
- `http.test.ts` (extended): `probe` reads `relayId` and `owner` (`NOT_A_RELAY` without them); `owner()` maps
  `201`, `200` and the new error codes.

### 18.B Network provider (`packages/sync/test/`)

`test/mp/fake-relay.ts`: an in-memory relay implementing §11.4 sequencing, §12 snapshot rules and
`compact` requests over a fake `WebSocket` class and a fake `fetch`, using module A's codec. It
does not verify signatures (that is module C's job) but enforces roles from a table.

- `network-sync.test.ts`: two stores converge through the fake relay (inserts, updates,
  deletes, concurrent edits on both sides); no echo of applied entries; three peers.
- `network-catchup.test.ts`: a late joiner catches up from snapshot plus tail; buffering of
  entries that arrive before the snapshot; `since` resume after a drop within retention (no
  snapshot fetch); a gap closes and recovers; relay `head < since` forces a full push.
- `network-offline.test.ts`: edits made while disconnected are sent as one delta on reconnect;
  `ackedSv` persisted through `MemoryRoomStateStore` across provider instances; a pristine
  guest sends nothing on first join.
- `network-roles.test.ts`: a `view` provider sets the store read-only, never sends `append`,
  status `read-only`; a `denied VIEW_ONLY` switches to read-only.
- `network-compaction.test.ts`: `compact` produces a snapshot whose `upTo` equals `since`; a
  dirty client declines; the oversize fallback uploads with `carries=1` and the other peer
  applies it; `SNAPSHOT_STALE` is ignored.
- `network-repair.test.ts`: election picks the lowest `edit` peer; `autoRepair` follows the
  §15.8 table through join, leave, view role and offline; a concurrent reparent cycle is
  repaired by exactly one replica (one repair update on the log).
- `network-awareness.test.ts`: presence round trip; relay-stamped origin overrides; throttling to
  `awarenessHz`; removal on `peer-left` and on close; re-send after reconnect; a bad awareness
  envelope is dropped without closing.
- `network-reconnect.test.ts`: backoff bounds with a seeded `random`; fatal codes stop retries;
  `setToken` after `TOKEN_EXPIRED` reconnects; the ping timeout reconnects; `environment`
  offline holds attempts.
- `network-attach.test.ts`: `attach` resolves offline; rejects on a fatal error; `detach`
  restores `autoRepair` and read-only and withdraws presence.
- `packages/editor-state/test/auto-repair.test.ts`: `setAutoRepair(false)` leaves a merged cycle
  in place; `true` repairs on the next remote update; `repair()` works in both modes.
- `claims-presence.test.ts` (§15.11): local claims published with `working`, kept when the app
  replaces its presence, withdrawn on release; remote claims feed the registry and leave with the
  peer; simultaneous claims settle on the earlier one; malformed records are dropped.
- `packages/editor-state/test/claims.test.ts`: overlap (subtree, ancestor, siblings free), the
  tie-break on both sides, TTL and `expiring`, remote expiry on the local clock, release by turn
  and across documents, the published id cap, human-edit detection by origin.
- `packages/mcp-server/test/claims.test.ts`: `AREA_BUSY` envelope between two agents, top-level
  inserts join the claim, dry runs and placeholder clears exempt, release at turn end and on
  close, the `human-edit` conflict reported once, a streamed batch held in another's area.

### 18.C Relay (`apps/server/test/`)

All with `createServer({ port: 0, config: { dataDir: ":memory:" or a temp dir } })` and real
WebSockets from Bun, with tokens and admin commands made by module A.

- `server.test.ts` (updated): `/healthz`, `/version` (protocol, limits, `relayId`, `owner`), 404,
  405; `/sync` without upgrade is 400; `/create-secret/check` is 404.
- `admin.test.ts`: register (201, idempotent 200, `ROOM_ID_MISMATCH`, bad signature); owner
  proof: unclaimed `RELAY_UNCLAIMED`, a non-owner key or no `owner` `NOT_OWNER`, a proof for
  another room, nonce or relay `AUTH_INVALID`, a removed device `NOT_OWNER`; reopening a closed
  room needs the proof; revoke, rotate and close still work after the creating device is removed. Revoke; rotate (`KEY_ID_INVALID`); close then
  re-register; `STALE_REQUEST`; `NONCE_REPLAY`.
- `auth.test.ts`: the §4 verification order (each failure code), on both WebSocket and HTTP.
- `ws.test.ts`: `hello` timeout; first frame not `hello`; subprotocol required; `Origin` check;
  welcome fields; `append` gets `ack` and others get `entries` with the stamped origin; ordering
  under concurrent appends from three sockets; `view` append denied and not stored; oversize
  entry denied; awareness relay, clock ordering, rate drop, cache delivered to late joiners;
  `peer-joined` and `peer-left`; `refresh`.
- `catchup.test.ts`: `needSnapshot` and `from` for since = 0, inside retention, below `base`,
  above `head`; entries paging at 512 per frame.
- `snapshot.test.ts`: genesis `upTo = 0`; acceptance rules (`SNAPSHOT_STALE`, `SNAPSHOT_AHEAD`,
  `carries`); generation retention (latest two); `snapshot` broadcast; retention pruning moves
  `base` after `KIMO_LOG_RETAIN_MS` (fake clock).
- `compaction.test.ts`: trigger by entries and by bytes; request goes to the lowest caught-up
  `edit` peer; moves on after 60 s (fake clock); `LOG_FULL` past the hard cap.
- `revocation.test.ts`: revoke closes only that `jti`; rotate closes all with `KEY_ROTATED`;
  expiry timer closes with `TOKEN_EXPIRED`; close room closes with `ROOM_CLOSED` and deletes data
  and blob files.
- `blobs.test.ts`: PUT 201 then 200; HEAD; GET bytes equal; id grammar; size cap; quota 507;
  per-`jti` rate 429 with `retry-after`; `missing`; view token cannot PUT.
- `sweep.test.ts`: first sweep marks only; a sweep after the grace period deletes rows and files;
  a PUT or a later keep clears the mark.
- `persistence.test.ts`: restart on the same data dir keeps rooms, log, snapshots, revocations,
  blobs; schema `user_version = 1`.
- `config.test.ts`: defaults; every variable parsed; invalid values throw naming the variable
  (including a malformed `KIMO_OWNER_KEY` entry).
- `owners.test.ts` (ADR 0017): `/version` reports `relayId` and `owner` before and
  after a claim. Claim: `201`, the same device again `200` (name
  updated), another device `409 RELAY_CLAIMED`; two concurrent claims give exactly one `201`.
  Devices: owner gets the list, a stranger `NOT_OWNER`, unclaimed
  `RELAY_UNCLAIMED`. Pair: a valid token adds the device (`via: "pair"`, `addedBy`); reuse
  `PAIRING_USED`; concurrent redemptions give one `201`; expired `PAIRING_EXPIRED` (fake clock);
  another relay's token, a removed issuer's token, a token from before the issuer was re-added,
  `exp - iat > 3600` and a tampered token are `AUTH_INVALID`; a cancelled token is
  `PAIRING_USED`; an existing owner redeeming gets `200` and the token stays usable. Remove: works
  for another device and for itself, `LAST_DEVICE` on the last, `NOT_FOUND` for an unknown key. Rename: any owner renames any
  device, a bad name is `BAD_REQUEST`, a stranger `NOT_OWNER`, an unknown key `NOT_FOUND`.
  Replay: the same owner command twice is `NONCE_REPLAY`; `iat` outside 5 minutes
  `STALE_REQUEST`. Rate limit shared with admin.
- `owners-boot.test.ts`: `KIMO_OWNER_KEY` seeds an empty set and is ignored once claimed;
  `KIMO_RESET_OWNER` clears owners and used pairings once, the same value on a second boot does
  nothing, a new value clears again, rooms survive a reset; `relay_id` is stable across restarts.
- `blind.test.ts`: the relay never imports `yjs` or `@kimo/editor-state` (check the module graph
  of `src/index.ts`), and the stored log and blob bytes never contain a plaintext marker string
  that the test's clients encrypted.
- `e2e-multiplayer.test.ts` (runs after B lands): two `NetworkProvider`s with real
  `YjsDocStore`s converge through the real relay; view-only guest; compaction under load; owner
  revokes a guest mid-session; a blob uploaded by one is fetched and verified by the other.
- `e2e-claims.test.ts` (§15.11): two clients, each with an MCP runtime and one agent; the second
  agent gets `AREA_BUSY` inside the first one's frame and edits elsewhere; the claim is released
  at turn end and when the holder's client disconnects.
- Docker (manual, documented in the README): `docker build -f apps/server/Dockerfile .` and a
  `/healthz` probe.

### 18.D Web integration (`apps/web/test/`, `packages/core-schema/test/`)

- `multiplayer-registry.test.ts`: in-memory backend: owned, joined and cursor round trips;
  `RoomStateStore` contract.
- `multiplayer-share.test.ts`: against a real relay (`@kimo/server` on port 0) and in-memory
  registry: `startSharing` registers, seeds a genesis snapshot and connects; `mintLink` output
  parses and joins; `revokeLink` closes that guest; `resetAllLinks` invalidates old links and
  keeps the owner connected; `stopSharing` closes guests and clears the registry; `join` of a
  view link yields a read-only store. (ADR 0017) `startSharing` on an unclaimed relay claims it
  with the device key, then registers; on a relay owned by another device it fails with
  `NOT_OWNER` before creating anything; on a relay started with `KIMO_OWNER_KEY` it registers
  without a claim.
- `multiplayer-ownership.test.ts`: `relayOwnership` gives `unclaimed`, `yours` and `other`; `createPairingLink` then `acceptPairingLink` from a second
  service with its own memory device key adds it, and the second device can start sharing;
  expired, used and cancelled links surface their codes; `removeDevice` of this device turns the
  state to `other`; the last device cannot be removed; `renameDevice` updates the list; the
  default name is platform only ("Mac", "Chrome on Mac") and never contains the OS user or host
  name.
- `multiplayer-device-key.test.ts`: the memory and IndexedDB-shaped stores return the same key
  pair across calls and create it once; the private key is non-extractable; the keychain store
  round trips the seed through a fake `invoke`.
- `relay-setup` tests: the Docker command, Fly steps and local relay environment carry
  `KIMO_OWNER_KEY=<device>` and no secret; the Railway link carries the prefilled
  key when enabled; the Test's fourth check reports `claiming`, `yours`, `already yours` and
  `belongs to another Kimo`.
- `multiplayer-assets.test.ts`: upload on connect only uploads what is missing; fetch on demand
  stores verified bytes through `putKey`; a corrupted blob (served by a stub) is rejected;
  `withRemoteAssets` triggers `ensure` on a miss and notifies subscribers; legacy entries
  without `sha256` are backfilled by an `edit` client.
- `multiplayer-fonts.test.ts`: pack and Google families share; others are name-only and fire
  `onFontNotShared` once per family.
- `multiplayer-shaders.test.ts`: relative shader paths become `./assets/<hash16>.glsl` with
  manifest entries; missing sources are reported; the change is one `system` load (undo stack
  unchanged).
- `multiplayer-reopen.test.ts`: owner closes and reopens a shared document: with a replica, no
  node is re-inserted (the delta is empty); without a replica, only real file differences reach
  the room.
- `assets.test.ts` (extended): `contentDigest`, `AssetInfo.sha256`, `manifestEntry` copies it.
- `packages/core-schema/test/asset-sha256.test.ts`: `sha256` accepted; bad pattern rejected;
  `ASSET_HASH_MISMATCH` on a prefix mismatch.

## 19. Test vectors

Generated with Bun 1.3.5 WebCrypto on 2026-10-19. Inputs are fixed byte sequences:
`seq(n, s)` is the `n` bytes `s, s+1, s+2, ...` (mod 256).

| Input | Value |
|---|---|
| Root private seed (Ed25519, 32 bytes) | `seq(32, 0x00)` |
| Link private seed | `seq(32, 0x20)` |
| Room key | `seq(32, 0x80)` |
| `jti` | `seq(16, 0x40)` |
| Admin nonce | `seq(16, 0x60)` |
| IV for every envelope | `seq(12, 0xa0)` |

Seeds are imported as PKCS#8: the 16-byte prefix `302e020100300506032b657004220420` followed by
the seed.

| Output | Value |
|---|---|
| Root public key | `03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8` |
| Link public key | `29acbae141bccaf0b22e1a94d34d0bc7361e526d0bfe12c89794bc9322966dd7` |
| `roomIdRaw` | `ea430121c5dc8fae55cfb181df66e0eb7aee5371` |
| `roomId` | `5jbqciof3sh24vopwga56zxa5n5o4u3r` |

**Token**: role `edit`, `kid = 1`, `iat = 1792000000`, `exp = 1792604800`, `jti = seq(16, 0x40)`,
origin `user`.

```
payload (hex)
0101020100000001000000006acfc000000000006ad8fa80404142434445464748494a4b4c4d4e4fea430121c5dc8fae55cfb181df66e0eb7aee53710475736572
token
AQECAQAAAAEAAAAAas_AAAAAAABq2PqAQEFCQ0RFRkdISUpLTE1OT-pDASHF3I-uVc-xgd9m4Ot67lNxBHVzZXJ2FlsrmK0JREaV0L_ibWiLecAb-9TXhKdYUb6bDGHh5FainGWKimydh8BwkHwKZ-jQCVMbkSU8yZ4WMdQGTM0A
```

**Link certificate**: `kid = 1`, `iat = 1792000000`, the link public key above, signed by the
root key.

```
AQIAAAABAAAAAGrPwADqQwEhxdyPrlXPsYHfZuDreu5TcSmsuuFBvMrwsi4alNNNC8c2HlJtC_4SyJeUvJMilm3XlfEHTp83eo5H6pDKcTgovP9QtevMqIxxtwL470mx93t3S5jkrMcCyJsEB4wiVqQRGgIeqhGw3ewWyOjukaBiCg
```

**Admin register**: `iat = 1792000000000` (ms), nonce `seq(16, 0x60)`, body exactly:

```
{"rootPub":"A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg","cert":"AQIAAAABAAAAAGrPwADqQwEhxdyPrlXPsYHfZuDreu5TcSmsuuFBvMrwsi4alNNNC8c2HlJtC_4SyJeUvJMilm3XlfEHTp83eo5H6pDKcTgovP9QtevMqIxxtwL470mx93t3S5jkrMcCyJsEB4wiVqQRGgIeqhGw3ewWyOjukaBiCg"}
```

```
signature (hex)
28d79e827f1b52b26317a4570826451cfa390028329dba81619b7acf238d37ae053730c3f6ebab91391d0e07d52d963b66ba8a41907ac58b3e2e06eca396d604
```

**Ownership** (ADR 0017): device private seed `seq(32, 0xc0)` (public key
`dde3bccec7f3a66a1115f45d720f4dc135c3ae7c4e22dca38fdb1efd6a495ff8`), `relayId = seq(16, 0xe0)`.

Owner command op 1 claim, `iat = 1792000000000`, nonce `seq(16, 0x60)`, body exactly
`{"name":"Mac"}`:

```
01040100000001a13b860000606162636465666768696a6b6c6d6e6fe0e1e2e3e4e5e6e7e8e9eaebecedeeefdde3bccec7f3a66a1115f45d720f4dc135c3ae7c4e22dca38fdb1efd6a495ff80000000e7b226e616d65223a224d6163227de96303decb5d245b08bc8a76196b2165a85d1f805d93c4b5ec7a816fdd09e1b400b1a6c3994c4ef2a77533b42180886b36b20b447e596b7055091d134998ed09
```

Register owner proof for the admin register above (its room, nonce and `iat`, the root public
key): `{"pub":"3eO8zsfzpmoRFfRdcg9NwTXDrnxOItyjj9se_WpJX_g","sig":"l6uxZCXm7kr2Po0Rkj9YygKpwND-MjuGob9_o649rUiUj90_wstuYS1TZ24lgRdJUy5P1yuAHGlrTdqxpxy0BA"}`.

Pairing token, `iat = 1792000000`, `exp = 1792000900`, `jti = seq(16, 0x40)`:

```
AQUAAAAAAABqz8AAAAAAAGrPw4RAQUJDREVGR0hJSktMTU5P4OHi4-Tl5ufo6err7O3u793jvM7H86ZqERX0XXIPTcE1w658TiLco4_bHv1qSV_4teO_2ZJmO-2e-ZjZ2dip9B-J4mam7vccU3HsOTYmEkgKxRBCL3Rj73AZeaYUL6MJouAqR6JVJ8TyYOR4bCokBw
```

**Key derivation** (room key `seq(32, 0x80)`, base64url
`gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8`, salt `roomIdRaw`):

| Key | Raw bytes (hex) |
|---|---|
| `doc` | `5ffbbb77eaff8a816cdcf55d44beb0cb99ea35f7392e12d3458b9366bbaca26a` |
| `awareness` | `4a5fc70e71439c18d8b1d7d7c27c19d58588a26b2607055e5fd21d9830a8ac89` |
| `blobMac` | `6ccbfdf4184ba47d6393d950921cf9046e52fc95d1a75a040eb9e96899dbafbe` |

(Derived keys are non-extractable in the implementation; the vector test derives the same bits
with `deriveBits`.)

**Blob**: plaintext UTF-8 `hello kimo`.

| Output | Value |
|---|---|
| SHA-256 | `978572b8044ecdc8403db938049f6808120195f2ece130eb2f310d6741999996` |
| `blob(sha)` key | `56a9597f94a9fcb6d061475f0f3c64d6de94f137a428601dc306a868a00cd89f` |
| `blobId` | `3da84b154c006f21c523a835c68ebcd712dced1081cd032797091d5ebb93544d` |
| Envelope | `0104a0a1a2a3a4a5a6a7a8a9aaabde67c060acff9e588edc2966932d335a1657350c1344585f369c` |

**Envelopes** (IV `seq(12, 0xa0)`):

| Kind | Plaintext | AAD | Envelope (hex) |
|---|---|---|---|
| update | `01020304` | `kimo/v1|5jbqciof3sh24vopwga56zxa5n5o4u3r|update` | `0101a0a1a2a3a4a5a6a7a8a9aaab430e1296ffa0b9011cedb736af59da8da865629f` |
| snapshot | `01020304` | `kimo/v1|5jbqciof3sh24vopwga56zxa5n5o4u3r|snapshot|42` | `0102a0a1a2a3a4a5a6a7a8a9aaab430e129608cec055011c129a4b9efa2201a003ff` |
| awareness (peer 7) | UTF-8 `{"user":{"id":"u1","name":"Ana","color":"#3366ff"}}` | `kimo/v1|5jbqciof3sh24vopwga56zxa5n5o4u3r|awareness|7` | `0103a0a1a2a3a4a5a6a7a8a9aaabcddf0ef194cc8f26c7d07e4c6d3654efe7cce76f9349dc9edfa8697036677c51bdcd459e2537649de0e75209f51a3dd56e8147a459edc90d3d3bcd43734817fad916d3` |

## 20. Out of scope for v2.0

- Any UI: Share panel, presence cursors, read-only banner, join route screens (designed in
  `desing.pen` first, in a later pass). Module D exposes the headless API only and does not wire
  the `/join` route.
- Short invite codes (v2.1; must redeem into the §4 token and must not reveal the room key to the
  relay).
- Desktop LAN hosting (v2.1).
- Headless remote agents (v2.2; a Bun client with a token whose `origin` is `agent:<id>`).
- `comment` role, content re-keying without a new room, accounts, S3 blob storage, a Cloudflare
  port, the Loro spike.
