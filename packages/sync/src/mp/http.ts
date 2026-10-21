/**
 * `RelayHttpClient`: every HTTP endpoint of docs/spec/multiplayer.md §12. Tokens travel only in
 * the `Authorization` header (never in a URL); bodies are opaque envelopes and admin commands.
 * Every failure is a {@link MultiplayerError}: the relay's JSON error body when it sent one, else a
 * code from the status, and `RELAY_UNREACHABLE` for network failures and timeouts.
 */

import { isBlobId } from "./blob-crypto"
import { asBytes, fromBase64Url } from "./bytes"
import { ENVELOPE_OVERHEAD } from "./envelope"
import { isMpErrorCode, type MpErrorCode, MultiplayerError } from "./errors"
import { isRoomId } from "./identity"
import { httpUrlFor, normalizeRelayUrl } from "./links"
import { isDeviceName, isDevicePub, RELAY_ID_BYTES } from "./owner"
import { DEFAULT_LIMITS, PROTOCOL, type RelayLimits, type SnapshotInfo } from "./protocol"

export interface RelayInfo {
  relayUrl: string
  name: string
  version: string
  protocol: typeof PROTOCOL
  limits: RelayLimits
  /** 16 bytes (§14.11). */
  relayId: Uint8Array
  /** `external`: an owner policy module decides who may register (§14.12); owner ops answer `OWNER_EXTERNAL`. */
  owner: "unclaimed" | "claimed" | "external"
}

/** A device of the relay's owner set, as `POST /owner` lists it (§6.1). */
export interface OwnerDevice {
  /** Base64url public key. */
  pub: string
  name: string
  /** Unix ms. */
  addedAt: number
  /** The issuing device of a pairing; null otherwise. */
  addedBy: string | null
  via: "claim" | "pair" | "env"
}

export interface RoomInfo {
  room: string
  kid: number
  head: number
  base: number
  snapshot: SnapshotInfo | null
  usedBytes: number
  quotaBytes: number
  peers: number
}

export interface FetchedSnapshot {
  upTo: number
  gen: number
  envelope: Uint8Array
}

export interface RelayHttpClientOptions {
  relayUrl: string
  fetch?: typeof fetch
  /**
   * Connection and stall timeout in ms. Default 30 000. It bounds the wait for response headers and
   * the gap between body chunks, never a whole transfer: an upload gets {@link UPLOAD_BYTES_PER_S}
   * of extra budget per byte, and a download may take as long as it keeps making progress.
   */
  timeoutMs?: number
  /** The relay's advertised limits (from `probe`); they cap response bodies. Default {@link DEFAULT_LIMITS}. */
  limits?: Pick<RelayLimits, "maxSnapshotBytes" | "maxBlobBytes">
}

/** Slowest upload rate the request budget assumes, in bytes per second (64 KiB/s). */
export const UPLOAD_BYTES_PER_S = 64 * 1024

/** Largest snapshot or blob body a client accepts whatever the relay advertises (the relay's own ceiling, 1 GiB). */
export const MAX_BODY_LIMIT_BYTES = 1024 * 1024 * 1024

/** Largest JSON body read from the relay (`/version`, room info, errors, admin, missing). */
export const MAX_JSON_BYTES = 1024 * 1024

/** Most ids per `POST /blob/<room>/missing` request (§12). */
export const MISSING_BATCH = 1000

const OCTETS = "application/octet-stream"

/** Code for an error response without a usable JSON body. */
function codeForStatus(status: number): MpErrorCode {
  switch (status) {
    case 400:
      return "BAD_REQUEST"
    case 401:
      return "AUTH_INVALID"
    case 402:
      return "PLAN_REQUIRED"
    case 403:
      return "ORIGIN_FORBIDDEN"
    case 404:
      return "NOT_FOUND"
    case 409:
      return "SNAPSHOT_STALE"
    case 410:
      return "ROOM_CLOSED"
    case 413:
      return "TOO_LARGE"
    case 426:
      return "PROTOCOL_MISMATCH"
    case 429:
      return "RATE_LIMITED"
    case 502:
    case 503:
    case 504:
      // A proxy in front of a relay that is down or restarting.
      return "RELAY_UNREACHABLE"
    case 507:
      return "QUOTA_EXCEEDED"
    default:
      return status >= 500 ? "INTERNAL" : "BAD_REQUEST"
  }
}

/** `retry-after` (seconds or an HTTP date) in ms, or undefined. */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (value === null || value.trim() === "") return undefined
  const text = value.trim()
  if (/^\d+$/.test(text)) return Number(text) * 1000
  const at = Date.parse(text)
  return Number.isNaN(at) ? undefined : Math.max(0, at - now)
}

/** Maps an error response to a {@link MultiplayerError} (reads a capped JSON body when there is one). */
export async function errorFromResponse(
  response: Response,
  kick?: () => void,
): Promise<MultiplayerError> {
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"))
  let code = codeForStatus(response.status)
  let message = `relay answered ${response.status}`
  try {
    const bytes = await readCapped(response, MAX_JSON_BYTES, "error body", kick)
    const body = JSON.parse(new TextDecoder().decode(bytes)) as {
      error?: unknown
      message?: unknown
    }
    if (isMpErrorCode(body?.error)) code = body.error
    if (typeof body?.message === "string" && body.message) message = body.message
  } catch {
    // Not JSON (a proxy page or an empty HEAD response): keep the status mapping.
  }
  return new MultiplayerError(
    code,
    message,
    retryAfterMs === undefined ? undefined : { retryAfterMs },
  )
}

function malformed(what: string): MultiplayerError {
  return new MultiplayerError("INTERNAL", `relay sent a malformed ${what}`)
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function parseLimits(value: unknown): RelayLimits | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const limits = { ...DEFAULT_LIMITS }
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof RelayLimits)[]) {
    const v = record[key]
    if (!isCount(v)) return null
    limits[key] = v
  }
  return limits
}

function parseRelayId(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null
  try {
    const bytes = fromBase64Url(value)
    return bytes.length === RELAY_ID_BYTES ? bytes : null
  } catch {
    return null
  }
}

function parseOwnerDevice(value: unknown): OwnerDevice | null {
  if (typeof value !== "object" || value === null) return null
  const { pub, name, addedAt, addedBy, via } = value as Record<string, unknown>
  if (!isDevicePub(pub) || !isDeviceName(name) || !isCount(addedAt)) return null
  if (addedBy !== null && !isDevicePub(addedBy)) return null
  if (via !== "claim" && via !== "pair" && via !== "env") return null
  return { pub, name, addedAt, addedBy, via }
}

function parseSnapshotInfo(value: unknown): SnapshotInfo | null | undefined {
  if (value === null) return null
  if (typeof value !== "object") return undefined
  const { upTo, gen, bytes } = value as Record<string, unknown>
  return isCount(upTo) && isCount(gen) && isCount(bytes) ? { upTo, gen, bytes } : undefined
}

/** Every method throws MultiplayerError (mapped from the JSON error body or the network failure). */
export class RelayHttpClient {
  readonly relayUrl: string
  private readonly fetchImpl: (url: string, init: RequestInit) => Promise<Response>
  private readonly timeoutMs: number
  private limits: Pick<RelayLimits, "maxSnapshotBytes" | "maxBlobBytes">

  constructor(options: RelayHttpClientOptions) {
    this.relayUrl = normalizeRelayUrl(options.relayUrl)
    this.fetchImpl = options.fetch ?? ((url, init) => globalThis.fetch(url, init))
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.limits = options.limits ?? DEFAULT_LIMITS
  }

  /**
   * Caps response bodies at the relay's advertised limits (from its `welcome`), so a snapshot the
   * relay accepts is one this client can download. Each cap is held to {@link MAX_BODY_LIMIT_BYTES}.
   */
  setLimits(limits: Pick<RelayLimits, "maxSnapshotBytes" | "maxBlobBytes">): void {
    this.limits = {
      maxSnapshotBytes: Math.min(limits.maxSnapshotBytes, MAX_BODY_LIMIT_BYTES),
      maxBlobBytes: Math.min(limits.maxBlobBytes, MAX_BODY_LIMIT_BYTES),
    }
  }

  /** `GET /version`: `NOT_A_RELAY` unless it answers as a `kimo-mp/1` relay. */
  async probe(): Promise<RelayInfo> {
    const notRelay = (why: string) =>
      new MultiplayerError("NOT_A_RELAY", `${this.relayUrl} is not a Kimo relay (${why})`)
    let info: Record<string, unknown>
    try {
      info = await this.request("GET", "/version", {}, async (response, kick) => {
        try {
          return (await readJson(response, kick)) as Record<string, unknown>
        } catch {
          throw notRelay("not JSON")
        }
      })
    } catch (error) {
      // Only network failures and rate limits keep their code; any other answer is not a relay.
      if (
        error instanceof MultiplayerError &&
        (error.code === "NOT_A_RELAY" ||
          error.code === "RELAY_UNREACHABLE" ||
          error.code === "RATE_LIMITED")
      )
        throw error
      throw notRelay(error instanceof Error ? error.message : "unexpected answer")
    }
    if (typeof info !== "object" || info === null) throw notRelay("not a JSON object")
    if (info.protocol !== PROTOCOL) throw notRelay(`protocol ${String(info.protocol)}`)
    const limits = parseLimits(info.limits)
    if (!limits) throw notRelay("missing limits")
    const relayId = parseRelayId(info.relayId)
    if (!relayId) throw notRelay("missing relayId")
    if (info.owner !== "unclaimed" && info.owner !== "claimed" && info.owner !== "external")
      throw notRelay("missing owner")
    return {
      relayUrl: this.relayUrl,
      name: typeof info.name === "string" ? info.name : "",
      version: typeof info.version === "string" ? info.version : "",
      protocol: PROTOCOL,
      limits,
      relayId,
      owner: info.owner,
    }
  }

  /** `POST /room/<room>/admin` with signed command bytes; the parsed JSON success body. */
  async admin(room: string, command: Uint8Array): Promise<Record<string, unknown>> {
    return this.request(
      "POST",
      `/room/${roomPath(room)}/admin`,
      { headers: { "content-type": OCTETS }, body: command },
      jsonObject("admin response"),
    )
  }

  /**
   * `POST /owner` with signed owner command bytes (§6.1): the status and the device list of the
   * success body (null for `{}`, the answer to cancel pairing).
   */
  async owner(command: Uint8Array): Promise<{ status: 200 | 201; devices: OwnerDevice[] | null }> {
    return this.request(
      "POST",
      "/owner",
      { headers: { "content-type": OCTETS }, body: command },
      async (response, kick) => {
        const body = await jsonObject("owner response")(response, kick)
        const status = response.status === 201 ? 201 : 200
        if (body.devices === undefined) return { status, devices: null }
        if (!Array.isArray(body.devices)) throw malformed("owner response")
        const devices = body.devices.map(parseOwnerDevice)
        if (devices.some((d) => d === null)) throw malformed("owner response")
        return { status, devices: devices as OwnerDevice[] }
      },
    )
  }

  /** `GET /room/<room>`. */
  async roomInfo(room: string, token: string): Promise<RoomInfo> {
    const body = await this.request(
      "GET",
      `/room/${roomPath(room)}`,
      { token },
      jsonObject("room info"),
    )
    const snapshot = parseSnapshotInfo(body.snapshot)
    const { kid, head, base, usedBytes, quotaBytes, peers } = body
    if (
      typeof body.room !== "string" ||
      snapshot === undefined ||
      !isCount(kid) ||
      !isCount(head) ||
      !isCount(base) ||
      !isCount(usedBytes) ||
      !isCount(quotaBytes) ||
      !isCount(peers)
    )
      throw malformed("room info")
    return { room: body.room, kid, head, base, snapshot, usedBytes, quotaBytes, peers }
  }

  /**
   * `GET /room/<room>/snapshot`; null when the room has none (`404 NOT_FOUND`). A body past the
   * relay's `maxSnapshotBytes` fails with `TOO_LARGE` without buffering the rest.
   */
  async getSnapshot(room: string, token: string): Promise<FetchedSnapshot | null> {
    return this.request<FetchedSnapshot | null>(
      "GET",
      `/room/${roomPath(room)}/snapshot`,
      { token },
      async (response, kick) => {
        const upTo = headerCount(response, "kimo-up-to")
        const gen = headerCount(response, "kimo-gen")
        if (upTo === null || gen === null) {
          await response.body?.cancel().catch(() => {})
          throw malformed("snapshot response")
        }
        const limit = this.limits.maxSnapshotBytes + ENVELOPE_OVERHEAD
        return { upTo, gen, envelope: await readCapped(response, limit, "snapshot", kick) }
      },
      () => null,
    )
  }

  /**
   * `PUT /room/<room>/snapshot?upTo=<n>[&carries=1][&merged=<gen>]`. `merged` is the newest
   * generation whose `carries` content the uploaded state includes: the relay refuses
   * (`SNAPSHOT_STALE`) a snapshot while a retained `carries` generation is newer than it.
   */
  async putSnapshot(
    room: string,
    token: string,
    upTo: number,
    envelope: Uint8Array,
    options?: { carries?: boolean; merged?: number },
  ): Promise<{ gen: number; upTo: number }> {
    if (!isCount(upTo)) throw new MultiplayerError("BAD_REQUEST", "upTo must be an integer >= 0")
    if (options?.merged !== undefined && !isCount(options.merged))
      throw new MultiplayerError("BAD_REQUEST", "merged must be an integer >= 0")
    const query = `?upTo=${upTo}${options?.carries ? "&carries=1" : ""}${
      options?.merged === undefined ? "" : `&merged=${options.merged}`
    }`
    const body = await this.request(
      "PUT",
      `/room/${roomPath(room)}/snapshot${query}`,
      { token, headers: { "content-type": OCTETS }, body: envelope },
      jsonObject("snapshot response"),
    )
    if (!isCount(body.gen) || !isCount(body.upTo)) throw malformed("snapshot response")
    return { gen: body.gen, upTo: body.upTo }
  }

  /** `PUT /blob/<room>/<id>`: `created` (201) or `exists` (200). */
  async putBlob(
    room: string,
    token: string,
    id: string,
    envelope: Uint8Array,
  ): Promise<"created" | "exists"> {
    return this.request(
      "PUT",
      `/blob/${roomPath(room)}/${blobPath(id)}`,
      { token, headers: { "content-type": OCTETS }, body: envelope },
      async (response) => {
        await response.body?.cancel().catch(() => {})
        return response.status === 201 ? "created" : "exists"
      },
    )
  }

  /** `HEAD /blob/<room>/<id>`: false on 404. */
  async hasBlob(room: string, token: string, id: string): Promise<boolean> {
    return this.request(
      "HEAD",
      `/blob/${roomPath(room)}/${blobPath(id)}`,
      { token },
      async () => true,
      () => false,
    )
  }

  /**
   * `GET /blob/<room>/<id>`; null on `404 NOT_FOUND`. A larger `content-length` or body than
   * `maxBytes` (default: the relay's `maxBlobBytes` plus the envelope overhead) fails with
   * `TOO_LARGE` without buffering the rest (the relay is untrusted).
   */
  async getBlob(
    room: string,
    token: string,
    id: string,
    maxBytes?: number,
  ): Promise<Uint8Array | null> {
    return this.request(
      "GET",
      `/blob/${roomPath(room)}/${blobPath(id)}`,
      { token },
      (response, kick) =>
        readCapped(
          response,
          maxBytes ?? this.limits.maxBlobBytes + ENVELOPE_OVERHEAD,
          "blob",
          kick,
        ),
      () => null,
    )
  }

  /** `POST /blob/<room>/missing`, batched by {@link MISSING_BATCH}; the ids the relay lacks. */
  async missingBlobs(room: string, token: string, ids: readonly string[]): Promise<string[]> {
    for (const id of ids) blobPath(id)
    const missing: string[] = []
    for (let i = 0; i < ids.length; i += MISSING_BATCH) {
      const batch = ids.slice(i, i + MISSING_BATCH)
      const body = await this.request(
        "POST",
        `/blob/${roomPath(room)}/missing`,
        {
          token,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: batch }),
        },
        jsonObject("missing response"),
      )
      if (!Array.isArray(body.missing) || !body.missing.every((id) => isBlobId(id)))
        throw malformed("missing response")
      missing.push(...(body.missing as string[]))
    }
    return missing
  }

  /**
   * One request. The timeout covers connecting, the upload (budgeted by size) and the wait for
   * headers, then restarts as a stall timer that every body chunk resets, so a slow but steady
   * transfer of a large body completes. Non-2xx responses become errors, except a `404` whose
   * code is `NOT_FOUND` (or any body-less HEAD 404) when `onNotFound` is given.
   */
  private async request<T>(
    method: string,
    path: string,
    init: { token?: string; headers?: Record<string, string>; body?: Uint8Array | string },
    read: (response: Response, kick: () => void) => Promise<T>,
    onNotFound?: () => T,
  ): Promise<T> {
    const controller = new AbortController()
    const headers: Record<string, string> = { ...init.headers }
    if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`
    const body = init.body instanceof Uint8Array ? asBytes(init.body) : init.body
    const uploadMs = body === undefined ? 0 : (bodyLength(body) / UPLOAD_BYTES_PER_S) * 1000
    let timer = setTimeout(() => controller.abort(), this.timeoutMs + uploadMs)
    const kick = () => {
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(), this.timeoutMs)
    }
    try {
      const response = await this.fetchImpl(httpUrlFor(this.relayUrl, path), {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      })
      kick()
      if (response.status === 404 && onNotFound) {
        if (method === "HEAD") return onNotFound()
        const error = await errorFromResponse(response, kick)
        if (error.code === "NOT_FOUND") return onNotFound()
        throw error
      }
      if (!response.ok) throw await errorFromResponse(response, kick)
      return await read(response, kick)
    } catch (error) {
      if (controller.signal.aborted) throw unreachable(this.relayUrl, true, error)
      if (error instanceof MultiplayerError) throw error
      throw unreachable(this.relayUrl, false, error)
    } finally {
      clearTimeout(timer)
    }
  }
}

function unreachable(relayUrl: string, timedOut: boolean, cause: unknown): MultiplayerError {
  return new MultiplayerError(
    "RELAY_UNREACHABLE",
    timedOut ? `${relayUrl} did not answer in time` : `${relayUrl} is unreachable`,
    { cause },
  )
}

function jsonObject(
  what: string,
): (response: Response, kick: () => void) => Promise<Record<string, unknown>> {
  return async (response, kick) => {
    let body: unknown
    try {
      body = await readJson(response, kick)
    } catch (error) {
      if (error instanceof MultiplayerError && error.code === "TOO_LARGE") throw error
      throw malformed(what)
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw malformed(what)
    return body as Record<string, unknown>
  }
}

function bodyLength(body: Uint8Array | string): number {
  return typeof body === "string" ? new TextEncoder().encode(body).length : body.length
}

async function readJson(response: Response, kick?: () => void): Promise<unknown> {
  const bytes = await readCapped(response, MAX_JSON_BYTES, "JSON body", kick)
  return JSON.parse(new TextDecoder().decode(bytes))
}

/**
 * The whole body, failing with `TOO_LARGE` as soon as the declared `content-length` or the bytes
 * received pass `maxBytes` (the relay is untrusted). `kick` runs per chunk (the stall timer).
 */
async function readCapped(
  response: Response,
  maxBytes: number,
  what: string,
  kick?: () => void,
): Promise<Uint8Array> {
  const tooLarge = () => new MultiplayerError("TOO_LARGE", `${what} exceeds ${maxBytes} bytes`)
  const declared = headerCount(response, "content-length")
  if (declared !== null && declared > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw tooLarge()
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    kick?.()
    total += value.length
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw tooLarge()
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function headerCount(response: Response, name: string): number | null {
  const value = response.headers.get(name)
  if (value === null || !/^\d+$/.test(value)) return null
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : null
}

function roomPath(room: string): string {
  if (!isRoomId(room)) throw new MultiplayerError("BAD_REQUEST", "invalid room id")
  return room
}

function blobPath(id: string): string {
  if (!isBlobId(id)) throw new MultiplayerError("BAD_REQUEST", "invalid blob id")
  return id
}
