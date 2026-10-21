/**
 * Relay configuration (docs/spec/multiplayer.md §14.9). `loadConfig` turns environment variables
 * into a validated {@link RelayConfig}; defaults match the spec, and an invalid value throws an
 * error that names the variable so `main.ts` can print it and exit.
 */

import { equalBytes, fromBase64Url, isDevicePub } from "@kimo/sync/mp"

const MiB = 1 << 20

export interface RelayConfig {
  port: number
  hostname: string
  /** Directory of `relay.sqlite` and `blobs/`; `":memory:"` keeps everything in memory. */
  dataDir: string
  allowedOrigins: "*" | readonly string[]
  /** KIMO_OWNER_KEY, decoded (32 bytes each): seeds an empty owner set at boot (§14.11). */
  ownerKeys: readonly Uint8Array[]
  /** KIMO_RESET_OWNER, or null: clears the owner set once per distinct value. */
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
  /** Proxies in front of the relay; the client address is that many entries from the right of `x-forwarded-for`. */
  trustProxyHops: number
  /** WebSocket connects per IP per minute (§14.8). */
  connectRatePerMin: number
  /** Admin requests per IP per minute. */
  adminRatePerMin: number
  /** Blob `PUT` requests per token id per minute. */
  blobRatePerMin: number
}

type Env = Record<string, string | undefined>

function fail(name: string, value: string, expected: string): never {
  throw new Error(`Invalid ${name}: ${JSON.stringify(value)} (expected ${expected})`)
}

function integer(env: Env, name: string, fallback: number, min: number, max = 2 ** 31): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === "") return fallback
  const text = raw.trim()
  const value = Number(text)
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < min || value > max)
    fail(name, raw, `an integer from ${min} to ${max}`)
  return value
}

function flag(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]
  if (raw === undefined || raw.trim() === "") return fallback
  const text = raw.trim().toLowerCase()
  if (text === "1" || text === "true") return true
  if (text === "0" || text === "false") return false
  return fail(name, raw, "0 or 1")
}

function origins(env: Env): "*" | readonly string[] {
  const name = "KIMO_ALLOWED_ORIGINS"
  const raw = env[name]
  if (raw === undefined || raw.trim() === "" || raw.trim() === "*") return "*"
  const list: string[] = []
  for (const part of raw.split(",")) {
    const text = part.trim()
    if (!text) continue
    let url: URL
    try {
      url = new URL(text)
    } catch {
      return fail(name, raw, "* or a comma-separated list of origins such as https://app.example")
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
      return fail(name, raw, "http or https origins")
    list.push(url.origin)
  }
  if (list.length === 0) return fail(name, raw, "* or at least one origin")
  return list
}

/** KIMO_OWNER_KEY: comma-separated base64url Ed25519 public keys (43 characters each). */
function ownerKeys(env: Env): Uint8Array[] {
  const name = "KIMO_OWNER_KEY"
  const raw = env[name]
  if (raw === undefined || raw.trim() === "") return []
  const keys: Uint8Array[] = []
  for (const part of raw.split(",")) {
    const text = part.trim()
    if (!text) continue
    if (!isDevicePub(text))
      return fail(name, raw, "comma-separated device public keys of 43 base64url characters")
    const bytes = fromBase64Url(text)
    if (!keys.some((key) => equalBytes(key, bytes))) keys.push(bytes)
  }
  return keys
}

/** Throws an Error naming the variable on an invalid value. */
export function loadConfig(env: Env): RelayConfig {
  const host = env.HOST?.trim()
  const dataDir = env.KIMO_DATA_DIR?.trim()
  const reset = env.KIMO_RESET_OWNER?.trim()
  return {
    port: integer(env, "PORT", 8787, 0, 65535),
    hostname: host || "127.0.0.1",
    dataDir: dataDir || "./data",
    allowedOrigins: origins(env),
    ownerKeys: ownerKeys(env),
    resetOwner: reset ? reset : null,
    maxRooms: integer(env, "KIMO_MAX_ROOMS", 0, 0),
    maxPeers: integer(env, "KIMO_MAX_PEERS", 32, 1),
    roomQuotaBytes: integer(env, "KIMO_ROOM_QUOTA_MB", 500, 1, 1 << 20) * MiB,
    blobMaxBytes: integer(env, "KIMO_BLOB_MAX_MB", 20, 1, 1024) * MiB,
    entryMaxBytes: integer(env, "KIMO_ENTRY_MAX_MB", 4, 1, 256) * MiB,
    snapshotMaxBytes: integer(env, "KIMO_SNAPSHOT_MAX_MB", 64, 1, 1024) * MiB,
    logMaxBytes: integer(env, "KIMO_LOG_MAX_MB", 32, 1, 1 << 20) * MiB,
    compactEntries: integer(env, "KIMO_COMPACT_ENTRIES", 1000, 1),
    compactBytes: integer(env, "KIMO_COMPACT_BYTES", 8 * MiB, 1, Number.MAX_SAFE_INTEGER),
    logRetainMs: integer(env, "KIMO_LOG_RETAIN_MS", 600_000, 0, Number.MAX_SAFE_INTEGER),
    roomTtlDays: integer(env, "KIMO_ROOM_TTL_DAYS", 0, 0, 36500),
    sweepGraceDays: integer(env, "KIMO_SWEEP_GRACE_DAYS", 30, 1, 36500),
    trustProxy: flag(env, "KIMO_TRUST_PROXY", false),
    trustProxyHops: integer(env, "KIMO_TRUST_PROXY_HOPS", 1, 1, 16),
    connectRatePerMin: integer(env, "KIMO_RATE_CONNECT_PER_MIN", 30, 1),
    adminRatePerMin: integer(env, "KIMO_RATE_ADMIN_PER_MIN", 30, 1),
    blobRatePerMin: integer(env, "KIMO_RATE_BLOB_PER_MIN", 60, 1),
  }
}
