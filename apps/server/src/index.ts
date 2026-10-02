/**
 * @kimo/server — reserved Bun service (stub in v1).
 *
 * Future role (teardown 9.1): a y-websocket-compatible multiplayer relay, share
 * links and a remotely hosted MCP endpoint. In v1 it only exposes health and
 * version endpoints; `/sync` answers 501 so clients can detect the capability.
 * No app depends on this package.
 */
import pkg from "../package.json" with { type: "json" }

/** Path of the (future) Yjs sync WebSocket endpoint. */
export const SYNC_PATH = "/sync"

/** Architecture decision record describing the multiplayer plan. */
export const MULTIPLAYER_ADR = "docs/adr/0001-monorepo-and-server-readiness.md"

/** Options for {@link createServer}. */
export interface ServerOptions {
  /** TCP port to listen on. `0` picks an ephemeral port. */
  port: number
  /** Hostname to bind. Defaults to `127.0.0.1` (local-only). */
  hostname?: string
}

/** Body of `GET /version`. */
export interface VersionInfo {
  name: string
  version: string
  /** `.kimo` format version the server understands; absent until core-schema is wired in. */
  formatVersion?: string
}

/** Body of the `501` response returned by `/sync`. */
export interface NotImplementedBody {
  error: "NOT_IMPLEMENTED"
  message: string
  adr: string
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } })
}

/** Static version payload, read from this package's own package.json. */
export const versionInfo: VersionInfo = { name: pkg.name, version: pkg.version }

/**
 * Pure request handler, exported so it can be mounted or tested without a socket.
 */
export function handleRequest(req: Request): Response {
  const { pathname } = new URL(req.url)

  if (pathname === "/healthz") {
    if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed()
    return json({ ok: true })
  }

  if (pathname === "/version") {
    if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed()
    return json(versionInfo)
  }

  if (pathname === SYNC_PATH) {
    const body: NotImplementedBody = {
      error: "NOT_IMPLEMENTED",
      message:
        "Multiplayer sync is planned but not implemented in Kimo v1. This endpoint will become a " +
        "y-websocket-compatible relay; see the ADR for the plan.",
      adr: MULTIPLAYER_ADR,
    }
    return json(body, 501)
  }

  return json({ error: "NOT_FOUND", message: `No route for ${pathname}` }, 404)
}

function methodNotAllowed(): Response {
  return json({ error: "METHOD_NOT_ALLOWED" }, 405, { allow: "GET, HEAD" })
}

/**
 * Start the Kimo server stub.
 *
 * @example
 * const server = createServer({ port: 0 })
 * console.log(server.url.href)
 * await server.stop()
 */
export function createServer(options: ServerOptions): Bun.Server<undefined> {
  return Bun.serve({
    port: options.port,
    hostname: options.hostname ?? "127.0.0.1",
    fetch: handleRequest,
  })
}
