/**
 * @kimo/server: the blind multiplayer relay (docs/spec/multiplayer.md). It stores an append-only
 * log of encrypted updates, client-made encrypted snapshots and encrypted blobs per room, and
 * checks owner-signed capability tokens. It holds no room key and imports no CRDT code, so it
 * cannot read a document. Hosting is the operator's choice; Kimo ships no default relay.
 */

import { DEFAULT_LIMITS, PROTOCOL, type RelayLimits, toBase64Url } from "@kimo/sync/mp"
import pkg from "../package.json" with { type: "json" }
import { loadConfig, type RelayConfig } from "./config"
import { createFetchHandler, errorResponse } from "./http"
import type { OwnerPolicyModule } from "./policy"
import { Relay, type SocketData } from "./rooms"
import { websocketHandlers } from "./ws"

export { loadConfig, type RelayConfig } from "./config"
export {
  loadOwnerPolicy,
  type OwnerPolicyModule,
  type RegisterDecision,
  type RegisterRequest,
  type WriteDecision,
  type WriteRequest,
} from "./policy"
export { Relay, type SocketData } from "./rooms"

/** Path prefix of the sync WebSocket endpoint: `/sync/<room>`. */
export const SYNC_PATH = "/sync"

/** Options for {@link createServer}. */
export interface ServerOptions {
  /** TCP port to listen on. `0` picks an ephemeral port. */
  port: number
  /** Hostname to bind. Defaults to `127.0.0.1` (local-only). */
  hostname?: string
  /** Overrides on top of `loadConfig({})` defaults. `dataDir: ":memory:"` keeps everything in memory. */
  config?: Partial<RelayConfig>
  /** Clock for tests. Default `Date.now`. */
  now?: () => number
  /** Request log sink (method, path, status, duration). Default: none. */
  log?: (line: string) => void
  /** How often timed rules run, in ms. Default 1000. Tests call `relayOf(server).tick()` instead. */
  tickMs?: number
  /**
   * The external owner policy (§14.12), as `loadOwnerPolicy` returns it. Selects `external` mode;
   * required when `config.ownerPolicyModule` is set. Default: the `devices` owner set.
   */
  ownerPolicy?: OwnerPolicyModule
}

/** Body of `GET /version`. */
export interface VersionInfo {
  name: string
  version: string
  protocol: typeof PROTOCOL
  limits: RelayLimits
  /** Base64url of the relay's 16-byte id (§14.11). */
  relayId: string
  /** `external` under an external owner policy (§14.12). */
  owner: "unclaimed" | "claimed" | "external"
}

/**
 * Version payload with the default limits. `handleRequest` has no database, so it reports an
 * unclaimed relay with an all-zero id.
 */
export const versionInfo: VersionInfo = {
  name: pkg.name,
  version: pkg.version,
  protocol: PROTOCOL,
  limits: DEFAULT_LIMITS,
  relayId: toBase64Url(new Uint8Array(16)),
  owner: "unclaimed",
}

/** Pure handler for `/healthz` and `/version` only, kept so they can be tested without a socket. */
export function handleRequest(req: Request): Response {
  const { pathname } = new URL(req.url)
  const headers = { "content-type": "application/json; charset=utf-8" }
  if (pathname !== "/healthz" && pathname !== "/version")
    return new Response(
      JSON.stringify({ error: "NOT_FOUND", message: `No route for ${pathname}` }),
      {
        status: 404,
        headers,
      },
    )
  if (req.method !== "GET" && req.method !== "HEAD")
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { ...headers, allow: "GET, HEAD" },
    })
  return new Response(JSON.stringify(pathname === "/healthz" ? { ok: true } : versionInfo), {
    headers,
  })
}

const relays = new WeakMap<object, Relay>()

/** The relay core behind a server made by {@link createServer} (for tests and tooling). */
export function relayOf(server: object): Relay {
  const relay = relays.get(server)
  if (!relay) throw new Error("not a Kimo relay server")
  return relay
}

/**
 * Start the relay.
 *
 * @example
 * const server = createServer({ port: 0, config: { dataDir: ":memory:" } })
 * console.log(server.url.href)
 * await server.stop()
 */
export function createServer(options: ServerOptions): Bun.Server<SocketData> {
  const config: RelayConfig = {
    ...loadConfig({}),
    ...options.config,
    port: options.port,
    hostname: options.hostname ?? options.config?.hostname ?? "127.0.0.1",
  }
  const relay = new Relay(config, options.now, options.log, options.ownerPolicy)
  const handle = createFetchHandler(relay)
  const slack = 1 << 20
  const server = Bun.serve<SocketData>({
    port: config.port,
    hostname: config.hostname,
    maxRequestBodySize: Math.max(config.snapshotMaxBytes, config.blobMaxBytes + 30) + slack,
    fetch: (req, srv) => handle(req, srv).catch(errorResponse),
    websocket: websocketHandlers(relay),
  })
  const timer = setInterval(() => relay.tick(), options.tickMs ?? 1000)
  timer.unref()
  const stop = server.stop.bind(server)
  server.stop = async (closeActiveConnections?: boolean) => {
    clearInterval(timer)
    const stopped = stop(closeActiveConnections)
    // Bun 1.3.5 can leave stop(true) pending after the relay itself closed a socket, so a forced
    // stop is bounded; the listener is already closed by then.
    await (closeActiveConnections ? Promise.race([stopped, Bun.sleep(250)]) : stopped)
    relay.dispose()
  }
  relays.set(server, relay)
  return server
}
