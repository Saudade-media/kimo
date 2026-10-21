/**
 * Client-side asset sync (docs/spec/multiplayer.md §10, §16.4): uploads the blobs the relay lacks
 * and fetches referenced ones on demand. Headless: the UI subscribes to {@link BlobSync} for the
 * missing-asset placeholder and progress. Everything the relay sees is ciphertext under an HMAC id.
 */
import { blobIdFor, openBlob, sealBlob } from "./blob-crypto"
import { fromHex, toHex } from "./bytes"
import { isRetryable, MultiplayerError } from "./errors"
import { RelayHttpClient } from "./http"
import { parseRoomId } from "./identity"
import { deriveRoomKeys, type RoomKeys } from "./keys"

/** What this module needs of the web `AssetStore` (apps/web/src/lib/assets.ts), kept structural. */
export interface BlobAssetStore {
  keys(): Promise<string[]>
  bytes(key: string): Promise<Uint8Array | null>
  /** Stores bytes under `<hash16>.<ext>`; null when they do not match the key or the store refuses them. */
  putKey(key: string, bytes: Uint8Array, entry?: BlobManifestEntry): Promise<unknown | null>
}

/** The manifest fields sync reads (`assets` header member, spec §12 + §16.7). */
export interface BlobManifestEntry {
  mime?: string
  bytes?: number
  name?: string
  /** Full lowercase hex SHA-256 of the file; entries without it are never synced. */
  sha256?: string
}

/** `local`: bytes present here. `missing`: the relay answered 404. `failed`: unusable or unreachable. */
export type BlobState = "local" | "fetching" | "missing" | "failed" | "unknown"

export type BlobSkipReason = "too-large" | "quota" | "no-sha" | "not-local" | "hash-mismatch"

export interface BlobProgress {
  kind: "upload" | "fetch"
  key: string
  status: "start" | "done" | "skipped" | "failed"
  /** Finished items in this upload run (always 0 or 1 for a fetch). */
  completed: number
  total: number
  reason?: BlobSkipReason
}

export interface UploadResult {
  uploaded: number
  /** Already on the relay, or skipped (see `onSkipped`). */
  skipped: number
  failed: number
}

export interface BlobSyncOptions {
  relayUrl: string
  /** Room id (32 base32 characters). */
  room: string
  /** Current token (called per request, so a refreshed token is picked up). */
  token: () => string
  roomKey: Uint8Array
  assets: BlobAssetStore
  /** Current manifest, key to entry. */
  manifest: () =>
    | Readonly<Record<string, BlobManifestEntry>>
    | ReadonlyMap<string, BlobManifestEntry>
  fetch?: typeof fetch
  /** Parallel transfers across uploads and fetches. Default 2. */
  concurrency?: number
  /** Largest plaintext moved, in bytes. Default 20 MiB (the relay's limit). */
  maxBytes?: number
  /** Retries after a retryable failure. Default 4. */
  retries?: number
  /** Back-off bounds in ms. Default `[250, 10_000]`. */
  backoff?: [min: number, max: number]
  /** Test hooks. */
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  onProgress?: (event: BlobProgress) => void
  /** A referenced blob the relay does not have (placeholder stays). */
  onMissing?: (key: string) => void
  onSkipped?: (key: string, reason: BlobSkipReason) => void
  onError?: (key: string, error: unknown) => void
}

export interface BlobSync {
  /**
   * Uploads every manifest asset held locally that the relay lacks. Call after each catch-up.
   * Overlapping calls never upload concurrently: a call made during a run waits for it, and all
   * such callers share one follow-up run.
   */
  uploadMissing(): Promise<UploadResult>
  /** Makes `key` local: true when its bytes are (now) in the store. Concurrent calls share one request. */
  ensure(key: string): Promise<boolean>
  /**
   * Fetches again every key whose state is `missing` (the relay answered 404; spec §16.4: retried on
   * the next catch-up). Call after each catch-up; resolves with the keys that became local.
   */
  retryMissing(): Promise<string[]>
  state(key: string): BlobState
  /** Fires on every state change. */
  subscribe(listener: () => void): () => void
  stop(): void
}

/**
 * Longest relay `retry-after` honoured; a larger hint fails the attempt (the relay is untrusted).
 * Must cover the shipped relay's own worst case: a max-size blob against the per-room byte bucket
 * (200 MiB per 10 min) waits just over 60 s, rounded up to whole seconds.
 */
const MAX_RETRY_HINT_MS = 120_000

/** Ciphertext overhead of a blob envelope (spec §10). */
const ENVELOPE_OVERHEAD = 30
const DEFAULT_MAX = 20 * 1024 * 1024

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Codes that end an upload run: retrying other blobs cannot help. */
const FATAL = new Set([
  "AUTH_INVALID",
  "KEY_ROTATED",
  "TOKEN_REVOKED",
  "TOKEN_EXPIRED",
  "VIEW_ONLY",
  "ROOM_CLOSED",
  "ROOM_NOT_FOUND",
  "ORIGIN_FORBIDDEN",
  "ROLE_UNSUPPORTED",
])

function entriesOf(
  manifest: ReturnType<BlobSyncOptions["manifest"]>,
): [string, BlobManifestEntry][] {
  return manifest instanceof Map ? [...manifest] : Object.entries(manifest)
}

const isSha = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value)

export function createBlobSync(options: BlobSyncOptions): BlobSync {
  const concurrency = Math.max(1, options.concurrency ?? 2)
  const maxBytes = options.maxBytes ?? DEFAULT_MAX
  const retries = options.retries ?? 4
  const [minDelay, maxDelay] = options.backoff ?? [250, 10_000]
  const sleep = options.sleep ?? sleepMs
  const random = options.random ?? Math.random
  const client = new RelayHttpClient({
    relayUrl: options.relayUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })
  const room = options.room
  const states = new Map<string, BlobState>()
  const inflight = new Map<string, Promise<boolean>>()
  const listeners = new Set<() => void>()
  let stopped = false
  let uploading: Promise<UploadResult> | null = null
  let followUp: Promise<UploadResult> | null = null
  let onStop: () => void = () => {}
  const stopSignal = new Promise<void>((resolve) => {
    onStop = resolve
  })
  let keysPromise: Promise<RoomKeys> | null = null
  const roomKeys = () => {
    keysPromise ??= deriveRoomKeys(options.roomKey, parseRoomId(room))
    return keysPromise
  }

  const setState = (key: string, state: BlobState) => {
    if (states.get(key) === state) return
    states.set(key, state)
    for (const listener of [...listeners]) listener()
  }

  // One shared pool: at most `concurrency` transfers at a time, FIFO.
  let active = 0
  const waiting: (() => void)[] = []
  async function pooled<T>(run: () => Promise<T>): Promise<T> {
    // A released slot is handed straight to the next waiter (active stays), so a newcomer
    // cannot jump the queue or push `active` over the cap.
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve))
    else active++
    try {
      return await run()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }

  async function withRetry<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run()
      } catch (error) {
        if (stopped || attempt >= retries || !isRetryable(error)) throw error
        const exp = Math.min(maxDelay, minDelay * 2 ** attempt)
        const jittered = exp / 2 + random() * (exp / 2)
        const hinted = error instanceof MultiplayerError ? (error.retryAfterMs ?? 0) : 0
        if (hinted > MAX_RETRY_HINT_MS) throw error
        // Back-off happens outside the pool (callers wrap `pooled` inside `run`) and ends on stop().
        await Promise.race([sleep(Math.max(jittered, hinted)), stopSignal])
        if (stopped) throw error
      }
    }
  }

  function manifestOf(key: string): BlobManifestEntry | undefined {
    const manifest = options.manifest()
    return manifest instanceof Map
      ? manifest.get(key)
      : (manifest as Record<string, BlobManifestEntry>)[key]
  }

  async function fetchOne(key: string): Promise<boolean> {
    let entry: BlobManifestEntry | undefined
    try {
      entry = manifestOf(key)
      if (!entry || !isSha(entry.sha256)) {
        setState(key, "unknown")
        return false
      }
      if ((await options.assets.bytes(key)) !== null) {
        setState(key, "local")
        return true
      }
    } catch (error) {
      options.onError?.(key, error)
      setState(key, "failed")
      return false
    }
    if (stopped) return false
    const sha256 = entry.sha256
    setState(key, "fetching")
    options.onProgress?.({ kind: "fetch", key, status: "start", completed: 0, total: 1 })
    const finish = (status: "done" | "failed", ok: boolean, state: BlobState) => {
      setState(key, state)
      options.onProgress?.({ kind: "fetch", key, status, completed: ok ? 1 : 0, total: 1 })
      return ok
    }
    try {
      const keys = await roomKeys()
      const sha = fromHex(sha256)
      const id = await blobIdFor(keys, sha)
      const envelope = await withRetry(() =>
        pooled(() => client.getBlob(room, options.token(), id, maxBytes + ENVELOPE_OVERHEAD)),
      )
      if (envelope === null) {
        options.onMissing?.(key)
        return finish("failed", false, "missing")
      }
      if (envelope.length > maxBytes + ENVELOPE_OVERHEAD) {
        options.onError?.(
          key,
          new MultiplayerError("TOO_LARGE", `blob ${key} exceeds ${maxBytes} bytes`),
        )
        return finish("failed", false, "failed")
      }
      const plaintext = await openBlob(keys, sha, envelope)
      // The manifest comes from peers: its `mime` and `bytes` are never forwarded, so the store
      // derives the type from the bytes and the key (a declared type could switch off its pixel guard).
      const stored = await options.assets.putKey(key, plaintext, {
        ...(entry.name !== undefined ? { name: entry.name } : {}),
        sha256,
      })
      if (stored === null) {
        options.onError?.(
          key,
          new MultiplayerError(
            "BLOB_INTEGRITY",
            `blob ${key} does not match its key or was refused`,
          ),
        )
        return finish("failed", false, "failed")
      }
      return finish("done", true, "local")
    } catch (error) {
      options.onError?.(key, error)
      return finish("failed", false, "failed")
    }
  }

  return {
    ensure(key) {
      const running = inflight.get(key)
      if (running) return running
      const promise = fetchOne(key).finally(() => inflight.delete(key))
      inflight.set(key, promise)
      return promise
    },

    async retryMissing() {
      const keys = [...states].filter(([, state]) => state === "missing").map(([key]) => key)
      const done = await Promise.all(
        keys.map(async (key) => ((await this.ensure(key)) ? key : null)),
      )
      return done.filter((key): key is string => key !== null)
    },

    state(key) {
      return states.get(key) ?? "unknown"
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    stop() {
      stopped = true
      onStop()
      listeners.clear()
    },

    uploadMissing() {
      // A queued follow-up wins even if the run it waits on just cleared `uploading`.
      if (followUp) return followUp
      if (!uploading) return startUpload()
      // A call during a run waits for it, then all such callers share one more run.
      followUp ??= uploading
        .catch(() => {})
        .then(() => {
          followUp = null
          return startUpload()
        })
      return followUp
    },
  }

  function startUpload(): Promise<UploadResult> {
    const run = runUpload()
    uploading = run
    const clear = () => {
      if (uploading === run) uploading = null
    }
    run.then(clear, clear)
    return run
  }

  async function runUpload(): Promise<UploadResult> {
    const result: UploadResult = { uploaded: 0, skipped: 0, failed: 0 }
    if (stopped) return result
    const keys = await roomKeys()
    const held = new Set(await options.assets.keys())
    const candidates: { key: string; id: string; sha: string; entry: BlobManifestEntry }[] = []
    for (const [key, entry] of entriesOf(options.manifest())) {
      if (!held.has(key)) continue
      if (!isSha(entry.sha256)) {
        options.onSkipped?.(key, "no-sha")
        result.skipped++
        continue
      }
      candidates.push({
        key,
        id: await blobIdFor(keys, fromHex(entry.sha256)),
        sha: entry.sha256,
        entry,
      })
    }
    if (candidates.length === 0) return result
    const token = options.token()
    const absent = new Set(
      await withRetry(() =>
        client.missingBlobs(room, token, [...new Set(candidates.map((c) => c.id))]),
      ),
    )
    result.skipped += candidates.filter((c) => !absent.has(c.id)).length
    // One PUT per id even when two keys share content; the others are fallbacks.
    const groups = new Map<string, typeof candidates>()
    for (const c of candidates) {
      if (!absent.has(c.id)) continue
      const group = groups.get(c.id)
      if (group) group.push(c)
      else groups.set(c.id, [c])
    }
    const todo = [...groups.values()]
    let completed = 0
    let fatal: unknown = null
    type Item = (typeof candidates)[number]
    const report = (c: Item, status: BlobProgress["status"], reason?: BlobSkipReason) => {
      if (status !== "start") completed++
      options.onProgress?.({
        kind: "upload",
        key: c.key,
        status,
        completed,
        total: todo.length,
        ...(reason ? { reason } : {}),
      })
    }
    const skip = (c: Item, reason: BlobSkipReason) => {
      result.skipped++
      options.onSkipped?.(c.key, reason)
      report(c, "skipped", reason)
    }
    // Uploads one id, trying the next key with the same content when the bytes are not local.
    // Returns how many candidates it consumed.
    async function uploadGroup(group: Item[]) {
      for (const [index, c] of group.entries()) {
        if (stopped || fatal) return
        const last = index === group.length - 1
        const dropRest = () => {
          // The other keys carry the same content, which is now on the relay (or was skipped).
          result.skipped += group.length - index - 1
        }
        try {
          const bytes = await options.assets.bytes(c.key)
          if (bytes === null) {
            if (!last) {
              result.skipped++
              options.onSkipped?.(c.key, "not-local")
              continue
            }
            return skip(c, "not-local")
          }
          report(c, "start")
          // Wrong bytes for this key say nothing about the next key of the group: try it.
          if (bytes.length > maxBytes) {
            if (!last) {
              result.skipped++
              options.onSkipped?.(c.key, "too-large")
              continue
            }
            return skip(c, "too-large")
          }
          const sealed = await sealBlob(keys, bytes)
          if (toHex(sealed.sha) !== c.sha) {
            if (!last) {
              result.skipped++
              options.onSkipped?.(c.key, "hash-mismatch")
              continue
            }
            return skip(c, "hash-mismatch")
          }
          await withRetry(() =>
            pooled(() => client.putBlob(room, options.token(), sealed.id, sealed.envelope)),
          )
          result.uploaded++
          dropRest()
          return report(c, "done")
        } catch (error) {
          dropRest()
          if (error instanceof MultiplayerError && error.code === "TOO_LARGE")
            return skip(c, "too-large")
          if (error instanceof MultiplayerError && error.code === "QUOTA_EXCEEDED")
            return skip(c, "quota")
          if (error instanceof MultiplayerError && FATAL.has(error.code)) fatal = error
          result.failed++
          options.onError?.(c.key, error)
          return report(c, "failed")
        }
      }
    }
    // Reading and sealing are bounded by the same width as the transfer pool.
    const queue = [...todo]
    const worker = async () => {
      for (let group = queue.shift(); group; group = queue.shift()) await uploadGroup(group)
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
    if (fatal) throw fatal
    return result
  }
}
