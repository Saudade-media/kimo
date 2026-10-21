# @kimo/server

The Kimo multiplayer relay: a small Bun service that lets people edit one document together. Kimo is
local-first, so the editor works fully offline without it, and nothing in `apps/web` or
`apps/desktop` needs it to run.

**The relay is blind.** Documents are end-to-end encrypted: the room key lives only in the invite
link fragment (`#...`) and on the clients, never on the relay. The relay stores and forwards
ciphertext (an append-only log of encrypted updates, encrypted snapshots that clients make, and
encrypted blobs) and checks signed capability links. It cannot read a document, and it holds no
CRDT code. The contract is [docs/spec/multiplayer.md](../../docs/spec/multiplayer.md) (protocol
`kimo-mp/1`, [ADR 0016](../../docs/adr/0016-multiplayer-transport-and-sessions.md)).

**You host it.** Kimo ships no default relay and no project-run service. The relay URL is always
the one you (or your team) provide: paste `https://<your-relay>` into Kimo's Share dialog.

## The quickest way: Set up a relay in Kimo

Share (when no relay is set yet) and Settings › Multiplayer both have **Set up a relay**, a wizard
that does the steps below for you and then tests the relay:

- **This computer** (desktop app): Kimo runs this relay with your installed Bun (it offers to run
  the official bun.sh installer when Bun is missing), on port 8787 or the next free one. People on
  your network use the `ws://<your-lan-address>:<port>` it shows; for the internet it starts your
  installed `cloudflared`, either a quick tunnel (a `trycloudflare.com` address that changes on
  every restart) or a named tunnel on your own domain. The relay stops when Kimo quits.
- **Docker or your own server**: a ready `docker run` command for the published image below.
- **Fly.io**: one click when `flyctl` is installed (log in, app name, Deploy with a live log),
  otherwise the same commands to copy.
- **Railway**: opens the template; you paste the domain Railway gives you.
- **I already have a relay**: its URL.

A relay belongs to devices ([ADR 0017](../../docs/adr/0017-relay-ownership-pairing.md)): only a
device in its owner set may create rooms. For This computer, Docker and Fly.io, Kimo starts the
relay with this device's public key as `KIMO_OWNER_KEY`, so it is yours from the start. A public
key is not a secret: it is safe in a command, a URL or a log. A relay that starts without it
(Railway, one you deployed by hand) is claimed by the first Kimo that tests it. On web Kimo adds
the page's origin to `KIMO_ALLOWED_ORIGINS`. The test checks that the relay answers, speaks
`kimo-mp/1` and is yours (claiming it when nobody has), then saves the URL to Settings.

Add your other devices from Settings › Multiplayer › Devices › Add device: it makes a pairing
link that works once, for 15 minutes. Joining a room by its link never needs ownership.

## The image

CI publishes the relay as `ghcr.io/saudade-media/kimo-relay` (linux/amd64 and linux/arm64): `latest`
follows `main`, and version tags publish `1.2.3` and `1.2`. It is built from `apps/server/Dockerfile`
by `.github/workflows/relay-image.yml`.

## Run it

```sh
bun run --filter @kimo/server start        # same as: bun apps/server/src/main.ts
```

It listens on `127.0.0.1:8787` and keeps its data in `./data`. Everything is configured by
environment variables (below). An invalid value prints the variable name and exits with status 1.

Put it behind TLS (Caddy, nginx, a platform router): browsers only open `wss://` from an `https://`
page. Caddy is two lines and handles WebSockets without extra settings:

```
relay.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

Set `KIMO_TRUST_PROXY=1` behind a proxy so per-IP rate limits use `x-forwarded-for`. Do not set it
when the relay is reachable directly.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Listen port |
| `HOST` | `127.0.0.1` | Bind address (the Docker image sets `0.0.0.0`) |
| `KIMO_DATA_DIR` | `./data` | SQLite file (`relay.sqlite`) and `blobs/` directory |
| `KIMO_ALLOWED_ORIGINS` | `*` | Comma-separated web origins allowed for CORS and WebSocket `Origin`, for example `https://app.example.com`. Clients without an `Origin` header (Bun, scripts) and the Kimo desktop app (`tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`, which no web page can send) are always allowed |
| `KIMO_OWNER_KEY` | unset | Comma-separated device public keys (base64url, 43 characters each). At boot, when the relay has no owner yet, these devices own it. Ignored once it has one. Public values, safe to show |
| `KIMO_RESET_OWNER` | unset | Any value: at boot, clears the owner list and unused pairing links, once per distinct value (see [This relay belongs to another Kimo](#this-relay-belongs-to-another-kimo)). Rooms are untouched |
| `KIMO_OWNER_POLICY` | `devices` | Who may create rooms. `devices`: the relay's owner list. `external`: a module you provide decides (see [Owner policy module](#owner-policy-module)) |
| `KIMO_OWNER_POLICY_MODULE` | unset | With `KIMO_OWNER_POLICY=external`, and only then: path of that module (relative to the working directory) or a `file:` URL. The relay imports it at startup and exits if it is missing or malformed |
| `KIMO_MAX_ROOMS` | `0` (unlimited) | Cap on open rooms |
| `KIMO_MAX_PEERS` | `32` | Sockets per room |
| `KIMO_ROOM_QUOTA_MB` | `500` | Default per-room storage quota (blobs + snapshots + log) |
| `KIMO_BLOB_MAX_MB` | `20` | Largest blob |
| `KIMO_ENTRY_MAX_MB` | `4` | Largest log entry |
| `KIMO_SNAPSHOT_MAX_MB` | `64` | Largest snapshot |
| `KIMO_LOG_MAX_MB` | `32` | Retained log hard cap (appends close with `LOG_FULL` until a client snapshot arrives) |
| `KIMO_COMPACT_ENTRIES` | `1000` | Ask a client for a snapshot after this many new entries |
| `KIMO_COMPACT_BYTES` | `8388608` | ... or this many new bytes |
| `KIMO_LOG_RETAIN_MS` | `600000` | How long covered log entries stay for quick resumes |
| `KIMO_ROOM_TTL_DAYS` | `0` (never) | Delete rooms idle this long |
| `KIMO_SWEEP_GRACE_DAYS` | `30` | Default grace period of an owner blob sweep |
| `KIMO_TRUST_PROXY` | `0` | Use `x-forwarded-for` for per-IP limits |
| `KIMO_TRUST_PROXY_HOPS` | `1` | With `KIMO_TRUST_PROXY=1`, which `x-forwarded-for` entry is the client, counted from the right (1 = the address your one proxy saw; use 2 behind two proxies) |
| `KIMO_RATE_CONNECT_PER_MIN` | `30` | WebSocket connects per IP per minute |
| `KIMO_RATE_ADMIN_PER_MIN` | `30` | Admin requests per IP per minute |
| `KIMO_RATE_BLOB_PER_MIN` | `60` | Blob uploads per link token per minute |

## What it exposes

| Route | Auth | Purpose |
|---|---|---|
| `GET /healthz`, `GET /version` | none | Liveness; protocol (`kimo-mp/1`), version, limits, the relay id and whether it has an owner (`owner`: `unclaimed`, `claimed`, or `external` under an owner policy module) |
| `POST /owner` | device signature | Claim, list devices, pair a device, remove, rename, cancel a pairing link (`OWNER_EXTERNAL` under an owner policy module) |
| `WS /sync/<room>` | token in the first frame | Encrypted log, awareness and snapshot notices (subprotocol `kimo-mp.1`) |
| `POST /room/<room>/admin` | room owner signature (register also an owner device's) | Register, revoke a link, reset all links, close, blob sweep |
| `GET /room/<room>` | view or edit token | Head, snapshot and usage |
| `GET`, `PUT /room/<room>/snapshot` | view / edit token | Latest client-made snapshot |
| `PUT`, `HEAD`, `GET /blob/<room>/<id>` | edit / view token | Encrypted blobs (`PUT` needs edit) |
| `POST /blob/<room>/missing` | view or edit token | Which of these blob ids are absent |

Tokens go in `Authorization: Bearer ...` or in the first WebSocket frame, never in a query string,
and the access log records only method, path, status and duration.

How access works, in short: each room has an Ed25519 key pair made by its owner, and the room id is
derived from the public key, so the relay registers a room on first contact without trusting the
caller. Registering also needs a signature from a device in the relay's owner set: the devices of
the person who runs the relay, so strangers cannot create rooms on it. Invite links carry a token signed by the owner; the relay verifies signature, room, expiry
and revocation on connect, drops writes from `view` links, closes connections when a token expires
or is revoked, and stamps each connection's `origin` (`user`, `agent:<id>`, ...) so a client cannot
claim another. "Reset all links" rotates the signing key and closes every connection.

Blobs are stored under an id derived with a room-secret HMAC, so the relay can deduplicate within a
room without learning content. The relay never deletes a blob when a document stops referencing
it: only an owner-signed sweep marks unreferenced blobs and deletes them after a grace period.

## Owner policy module

By default the relay's owner list decides who may create rooms. A hosted or team relay can hand
that decision to its own code instead: set `KIMO_OWNER_POLICY=external` and
`KIMO_OWNER_POLICY_MODULE` to a module whose default export has two methods (sync or async). The
types are exported from `@kimo/server` (`OwnerPolicyModule`).

```ts
// team-policy.ts: every device in the list may create rooms, under one account of 5 GB.
import type { OwnerPolicyModule } from "@kimo/server"

const TEAM = new Set(["<device public key>", "<another device public key>"])

export default {
  register({ devicePub }) {
    if (!TEAM.has(devicePub)) return { allow: false, code: "NOT_OWNER" }
    return { allow: true, account: "team", storageLimitBytes: 5 * 1024 ** 3 }
  },
  write: () => ({ allow: true, storageLimitBytes: 5 * 1024 ** 3 }),
} satisfies OwnerPolicyModule
```

- `register({ relayId, room, devicePub, state })` runs on every room registration, after the relay
  has checked that the device signed it. Answer `{ allow: true, account, storageLimitBytes }`, or
  `{ allow: false, code: "NOT_OWNER" | "PLAN_REQUIRED", message }`. The relay stores the account on
  the room.
- `write({ relayId, room, account, bytes })` runs before a new blob is stored in a room that has an
  account, with the same answers minus `account`.
- `storageLimitBytes` caps the account's stored bytes over its open rooms (log, snapshots and
  blobs, the same counts as the room quota); leave it out for no limit. Past it, new rooms and
  blob uploads answer `ACCOUNT_QUOTA_EXCEEDED`; editing keeps working within each room's quota.
- A throw, a malformed answer or no answer within 10 seconds fails the request with `INTERNAL`.
- In this mode `/version` reports `owner: "external"`, every `POST /owner` answers
  `OWNER_EXTERNAL`, and `KIMO_OWNER_KEY` and `KIMO_RESET_OWNER` do nothing.

## Data and backups

Everything lives in `KIMO_DATA_DIR`: `relay.sqlite` (WAL mode, schema version 1; the owner list
lives here too) and `blobs/`. Stop
the relay (or use `sqlite3 relay.sqlite ".backup ..."`) and copy the directory to back it up. The
files are ciphertext, so a backup is safe to store anywhere, but it is useless without the invite
links, which the relay never sees. A relay is a single process with local state: run one instance
per data directory.

Upgrade by replacing the code and restarting. A database written by a newer schema is refused rather
than modified.

## Docker

Run the published image (Kimo's wizard fills in your device key and origins for you):

```sh
docker run -d --name kimo-relay --restart unless-stopped \
  -p 8787:8787 -v kimo-relay:/data \
  -e KIMO_OWNER_KEY="<your device key>" \
  -e KIMO_ALLOWED_ORIGINS="https://app.example.com" \
  ghcr.io/saudade-media/kimo-relay
curl http://127.0.0.1:8787/healthz     # {"ok":true}
```

Leave out `KIMO_ALLOWED_ORIGINS` when only the desktop app connects: the relay always admits its
webview origins (`tauri://localhost`, `http://tauri.localhost`), whatever the list says.
Update with `docker pull ghcr.io/saudade-media/kimo-relay` and recreate the container.

To build the image yourself, from the repository root (the build needs the workspace):

```sh
docker build -f apps/server/Dockerfile -t kimo-relay .
```

The image is `oven/bun` (Alpine), binds `0.0.0.0`, stores data in the `/data` volume and runs as
the `bun` user (it starts as root only to fix the ownership of a mounted volume). It has a
`HEALTHCHECK` on `/healthz`.

## Deploy on Fly.io

You need `flyctl` and your own Fly account. With `flyctl` installed, the desktop wizard does all of
this for you (Log in, app name, Deploy). By hand, from the repository root; edit `app` in
`apps/server/deploy/fly.toml` to a unique name first:

```sh
fly launch --copy-config -c apps/server/deploy/fly.toml --no-deploy
fly volumes create kimo_data --size 1
fly secrets set KIMO_OWNER_KEY="<your device key>" \
  KIMO_ALLOWED_ORIGINS="https://app.example.com"
fly deploy -c apps/server/deploy/fly.toml
fly status && curl https://<your-app>.fly.dev/healthz
```

The config deploys the published `ghcr.io/saudade-media/kimo-relay` image (delete its `[build]`
section and pass `--dockerfile apps/server/Dockerfile .` to build from source). It keeps one
`shared-cpu-1x` 256 MB machine with the volume at `/data`, `auto_stop_machines = "off"`
(WebSocket connections are long-lived), `force_https`, and a health check on `/healthz`. Do not
scale to several machines: each one would have its own SQLite file. Cost is whatever Fly charges
for one small machine plus a 1 GB volume (check their pricing page); raise the volume with
`fly volumes extend` when rooms grow.

Then paste `https://<your-app>.fly.dev` into Kimo's Share dialog, or let the wizard test and save it.

## Deploy on Railway

You need your own Railway account. The wizard's **Deploy on Railway** opens the
[Kimo Relay template](https://railway.com/deploy/Q_WYo8) (the relay image, a volume at `/data` and
the healthcheck; no variables to fill in). The relay starts without an owner, and Kimo's test claims
it as soon as you paste the domain. By hand:

1. New project, then "Deploy a Docker image" with `ghcr.io/saudade-media/kimo-relay`, or "Deploy
   from GitHub repo" with your fork of Kimo and the variable
   `RAILWAY_DOCKERFILE_PATH=apps/server/Dockerfile` so Railway builds the relay image.
2. Add a volume to the service and mount it at `/data`.
3. Set variables: `KIMO_TRUST_PROXY=1`, optionally `KIMO_OWNER_KEY` (your device key, from Kimo's
   Docker or Fly.io commands) and `KIMO_ALLOWED_ORIGINS` (your web origin, only if Kimo runs in a
   browser). Railway provides `PORT`; the relay reads it.
4. Under Settings, set the healthcheck path to `/healthz`, keep one replica, and generate a public
   domain (Networking).

Cost follows Railway's usage-based pricing for one small service and a volume. Then paste
`https://<your-service>.up.railway.app` into Kimo's Share dialog.

## Who owns a relay

A relay has an owner set of device public keys, kept in `relay.sqlite`. Each Kimo install has one
device key (in the OS keychain on desktop, in the browser's storage on web); its private half never
leaves the device. Only an owner device can create rooms; anyone with a room's link can still join
it. The boot log says `owner: claimed (n devices)` or `owner: unclaimed, claim it from Kimo`.

- **Pre-claim**: `KIMO_OWNER_KEY` names the first owners. Kimo's own setup paths set it.
- **Claim**: a relay without an owner belongs to the first Kimo that tests it or starts sharing on
  it. Until then, anyone who reaches it first could claim it: they would get room creation on your
  bill, never access to anyone's files. Set `KIMO_OWNER_KEY` on any relay you deploy by hand.
- **More devices**: Settings › Multiplayer › Devices › Add device makes a pairing link that works
  once, for 15 minutes. Open it on the other device. Remove a device there too; its rooms keep
  working.

### This relay belongs to another Kimo

Kimo says this when the relay's owners are other devices: someone claimed it first, or the devices
that own it are lost (cleared browser data, a wiped computer). Add this device from one that still
manages the relay. If none is left, reset ownership:

1. Set `KIMO_RESET_OWNER` to any new value, for example today's date, and restart the relay.
2. Open Kimo to claim it (the wizard's Test or Start sharing).
3. Remove the variable when you like: the relay acts on each value only once, so a forgotten
   variable does not reset it again on the next deploy. To reset again later, use a new value.

The reset clears the owner list and unused pairing links. Rooms and their data stay.

## Programmatic use and tests

```ts
import { createServer } from "@kimo/server"
const server = createServer({ port: 0, config: { dataDir: ":memory:" } }) // ephemeral port, in memory
console.log(server.url.href)
await server.stop()
```

```sh
bun test apps/server       # real sockets on ephemeral ports, fake clock for timers
```

`relayOf(server).tick()` runs every timed rule (token expiry, hello timeout, compaction retry,
retention) against the injected clock, which is how the tests avoid real waiting.
