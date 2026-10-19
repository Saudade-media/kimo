/**
 * Asset sync for a shared session (docs/spec/multiplayer.md §10, §16.4). Blobs stay out of the
 * CRDT: the manifest (`assets` header member, entries with `sha256`) travels in the document and
 * the bytes travel as encrypted blobs under an HMAC id, through `createBlobSync`
 * (`@kimo/sync/mp`). This module binds that to a session: upload after each catch-up and when
 * the manifest grows, fetch on demand, and `withRemoteAssets` for the missing-asset placeholder.
 */
import { referencedAssets, usedFontFamilies } from "@kimo/core-schema"
import { type DocStore, isLocalOrigin } from "@kimo/editor-state"
import type { NetworkProvider } from "@kimo/sync"
import {
  type BlobManifestEntry,
  type BlobProgress,
  type BlobSkipReason,
  type BlobState,
  createBlobSync,
} from "@kimo/sync/mp"
import { isFontAsset, loadDocumentFontFaces } from "../fonts/document-fonts"
import { type AssetStore, assetKey, contentDigest, manifestEntry } from "../lib/assets"

export type AssetSyncState = BlobState

export interface AssetSyncUploadResult {
  uploaded: number
  skipped: number
}

export interface AssetSync {
  /** Starts uploading after catch-ups and manifest changes (edit role only). */
  start(): void
  stop(): void
  /** Makes `key` local when the relay has it: true when its bytes are now in the store. */
  ensure(key: string): Promise<boolean>
  state(key: string): AssetSyncState
  uploadMissing(): Promise<AssetSyncUploadResult>
  /** Fires on every state change. */
  subscribe(listener: () => void): () => void
  /** Upload and fetch progress, per asset (the Share UI's "Sharing 2 images" and fetch bars). */
  onProgress(listener: (event: BlobProgress) => void): () => void
}

export interface AssetSyncOptions {
  room: string
  relayUrl: string
  /** Current token (called per request). */
  token: () => string
  roomKey: Uint8Array
  provider: NetworkProvider
  store: DocStore
  assets: AssetStore
  fetch?: typeof fetch
  /** Headless hooks for the UI and tests. */
  onProgress?: (event: BlobProgress) => void
  onSkipped?: (key: string, reason: BlobSkipReason) => void
  onError?: (key: string, error: unknown) => void
  /** Retry bounds for transient failures (tests shorten them). */
  backoff?: [min: number, max: number]
  /**
   * Wait before asking again for a blob the relay did not have yet (a peer's upload may still be
   * running); doubles up to a tenth of a minute, bounded by `max`. Default `[1000, 15000]`.
   */
  missingRetry?: [min: number, max: number]
}

/** The manifest of the store's document: key to entry (entries without `sha256` never sync). */
function manifestOf(store: DocStore): Record<string, BlobManifestEntry> {
  const assets = (store.toHeader() as { assets?: Record<string, BlobManifestEntry> }).assets
  return assets ?? {}
}

export function createAssetSync(options: AssetSyncOptions): AssetSync {
  const { provider, store, assets } = options
  const progressListeners = new Set<(event: BlobProgress) => void>()
  const onProgress = (event: BlobProgress) => {
    options.onProgress?.(event)
    for (const listener of [...progressListeners]) listener(event)
  }
  /**
   * Asset keys this replica authored: the ones the document referenced when sync was set up, and
   * the ones a local edit (or the owner's own file delta) referenced since. A key that only a
   * remote change references is never in it, so an edit peer cannot make the owner hash and
   * upload a file of another document in the same `assets/` folder just by naming its key.
   */
  const own = new Set<string>()
  const refsOf = (value: unknown) => referencedAssets({ value } as Record<string, unknown>)
  for (const key of referencedAssets(store.toDocument() as unknown as Record<string, unknown>))
    own.add(key)
  /**
   * Manifest keys held locally that this replica must not hash or upload. The manifest is CRDT
   * data any edit peer can write, and the asset store may be shared with other documents (the
   * `assets/` folder beside the file), so only what this document uses is shared: assets its
   * nodes reference (and this replica authored, see `own`), and font files Kimo itself fetched
   * (Google). A font the user added, or any file the document does not reference, stays local.
   * Refreshed before each upload run.
   */
  let blocked: ReadonlySet<string> = new Set()
  /** Keys of the manifest this replica may hash and upload (see `blocked`). */
  const shareable = async (): Promise<Set<string>> => {
    const doc = store.toDocument() as unknown as Record<string, unknown>
    const referenced = referencedAssets(doc)
    const ok = new Set<string>()
    for (const [key, entry] of Object.entries(manifestOf(store))) {
      if (isFontAsset(key, entry.mime)) {
        const info = await assets.info(`./assets/${key}`).catch(() => null)
        if (info?.fontSource) ok.add(key)
      } else if (referenced.has(key) && own.has(key)) ok.add(key)
    }
    return ok
  }
  const blobs = createBlobSync({
    relayUrl: options.relayUrl,
    room: options.room,
    token: options.token,
    roomKey: options.roomKey,
    assets,
    manifest: () => {
      const manifest = manifestOf(store)
      if (blocked.size === 0) return manifest
      return Object.fromEntries(Object.entries(manifest).filter(([key]) => !blocked.has(key)))
    },
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.backoff ? { backoff: options.backoff } : {}),
    onProgress,
    ...(options.onSkipped ? { onSkipped: options.onSkipped } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
  })
  /** Keys somebody asked for; retried after a catch-up when the relay did not have them yet. */
  const wanted = new Set<string>()
  const offs: (() => void)[] = []
  let started = false
  let uploading: Promise<AssetSyncUploadResult> | null = null
  let again = false

  const uploadMissing = (): Promise<AssetSyncUploadResult> => {
    if (provider.role !== "edit") return Promise.resolve({ uploaded: 0, skipped: 0 })
    if (uploading) {
      again = true
      return uploading
    }
    const run = async () => {
      let total: AssetSyncUploadResult = { uploaded: 0, skipped: 0 }
      do {
        again = false
        const allowed = await shareable()
        const held = new Set(await assets.keys().catch(() => [] as string[]))
        blocked = new Set(
          [...Object.keys(manifestOf(store))].filter((k) => held.has(k) && !allowed.has(k)),
        )
        const result = await blobs.uploadMissing().catch((error: unknown) => {
          options.onError?.("", error)
          return { uploaded: 0, skipped: 0, failed: 0 }
        })
        total = {
          uploaded: total.uploaded + result.uploaded,
          skipped: total.skipped + result.skipped,
        }
      } while (again)
      return total
    }
    uploading = run().finally(() => {
      uploading = null
    })
    return uploading
  }

  /**
   * Faces Kimo fetched from Google after sharing started reach the manifest only at file write
   * (`withFontManifest`), never the CRDT: list the ones the text uses here, with `sha256`, so
   * they upload like any other asset. Only faces with provenance (`fontSource`) qualify.
   */
  const fontEntries = async (
    current: Record<string, BlobManifestEntry>,
  ): Promise<Record<string, BlobManifestEntry>> => {
    const out: Record<string, BlobManifestEntry> = {}
    const keys = ((await assets.keys().catch(() => [])) as string[]).filter(
      (key) => isFontAsset(key, current[key]?.mime) && !current[key]?.sha256,
    )
    if (keys.length === 0) return out
    const known: Record<string, BlobManifestEntry> = { ...current }
    const fetched = new Set<string>()
    for (const key of keys) {
      const info = await assets.info(`./assets/${key}`).catch(() => null)
      if (!info?.fontSource) continue
      fetched.add(key)
      if (!known[key]) known[key] = manifestEntry(info) as BlobManifestEntry
    }
    if (fetched.size === 0) return out
    const used = usedFontFamilies(store.toDocument() as unknown as Record<string, unknown>)
    for (const face of await loadDocumentFontFaces(known, [...fetched], (key) =>
      assets.bytes(key),
    )) {
      if (!fetched.has(face.key) || !used.has(face.family.toLowerCase())) continue
      const bytes = await assets.bytes(face.key).catch(() => null)
      if (!bytes) continue
      const sha256 = await contentDigest(bytes)
      if (sha256.slice(0, 16) === face.key.slice(0, 16))
        out[face.key] = { ...(known[face.key] as BlobManifestEntry), sha256 }
    }
    return out
  }

  /**
   * Spec §16.4: an entry added without `sha256` (a deduplicated paste on desktop, rows written
   * before this feature, assets that were not local at share time) gets it filled in once its
   * bytes are local and their hash matches the key. One `system` header write for all of them.
   */
  let backfilling: Promise<void> | null = null
  let backfillAgain = false
  const backfill = (): Promise<void> => {
    if (provider.role !== "edit") return Promise.resolve()
    if (backfilling) {
      backfillAgain = true
      return backfilling
    }
    const run = async () => {
      do {
        backfillAgain = false
        const fills = new Map<string, string>()
        const allowed = await shareable()
        for (const [key, entry] of Object.entries(manifestOf(store))) {
          if (entry.sha256 || !allowed.has(key)) continue
          const bytes = await assets.bytes(key).catch(() => null)
          if (!bytes) continue
          const sha256 = await contentDigest(bytes)
          if (sha256.slice(0, 16) === key.slice(0, 16)) fills.set(key, sha256)
        }
        const fonts = await fontEntries(manifestOf(store))
        if (fills.size === 0 && Object.keys(fonts).length === 0) continue
        // The manifest may have changed while hashing: merge into what it is now.
        const current = manifestOf(store)
        const next: Record<string, BlobManifestEntry> = { ...current }
        let changed = false
        for (const [key, sha256] of fills) {
          const entry = current[key]
          if (!entry || entry.sha256) continue
          next[key] = { ...entry, sha256 }
          changed = true
        }
        for (const [key, entry] of Object.entries(fonts)) {
          if (current[key]?.sha256) continue
          next[key] = { ...entry, ...current[key], sha256: entry.sha256 as string }
          changed = true
        }
        if (changed)
          store.loadDocument(
            { ...store.toDocument(), assets: next } as ReturnType<DocStore["toDocument"]>,
            { origin: "system", newEpoch: false, validate: false },
          )
      } while (backfillAgain)
    }
    backfilling = run()
      .catch((error: unknown) => options.onError?.("", error))
      .finally(() => {
        backfilling = null
      })
    return backfilling
  }

  const retryWanted = () => {
    for (const key of wanted) {
      const state = blobs.state(key)
      if (state === "missing" || state === "failed") void blobs.ensure(key).then(armRetry)
    }
  }

  /**
   * A blob can be 404 only because its uploader has not finished: the node and manifest entry
   * travel over the WebSocket at once, the encrypted PUT after. So a wanted key that is missing
   * or failed is asked for again after a growing delay, as well as on every catch-up and header
   * change, until it arrives.
   */
  const [retryMin, retryMax] = options.missingRetry ?? [1000, 15_000]
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryDelay = retryMin
  function armRetry() {
    if (retryTimer || !started) return
    const pending = [...wanted].some((key) => {
      const state = blobs.state(key)
      return state === "missing" || state === "failed"
    })
    if (!pending) {
      retryDelay = retryMin
      return
    }
    retryTimer = setTimeout(() => {
      retryTimer = null
      retryDelay = Math.min(retryDelay * 2, retryMax)
      retryWanted()
    }, retryDelay)
  }

  return {
    start() {
      if (started) return
      started = true
      offs.push(
        provider.onEvent((event) => {
          if (event.type !== "caught-up") return
          void backfill().then(uploadMissing)
          retryDelay = retryMin
          retryWanted()
        }),
        store.onChange((change) => {
          // Only edits made here (or the owner's file delta) make a key this replica's to share.
          if (
            isLocalOrigin(change.origin) ||
            change.origin === "file" ||
            change.origin === "remote:file"
          ) {
            for (const id of change.nodes) {
              const node = store.getNode(id)
              if (node) for (const key of refsOf(node)) own.add(key)
            }
            if (change.header)
              for (const key of referencedAssets(store.toHeader() as Record<string, unknown>))
                own.add(key)
          }
          if (change.header) {
            retryWanted()
            if (provider.connected) void backfill().then(uploadMissing)
          }
        }),
      )
      // A face stored while shared (a Google fetch) joins the manifest and uploads.
      let held = -1
      offs.push(
        assets.subscribe(() => {
          void assets.keys().then((keys) => {
            if (keys.length === held) return
            held = keys.length
            if (started && provider.connected) void backfill().then(uploadMissing)
          })
        }),
      )
      if (provider.connected) void backfill().then(uploadMissing)
    },
    stop() {
      started = false
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
      for (const off of offs.splice(0)) off()
      blobs.stop()
    },
    ensure(key) {
      wanted.add(key)
      return blobs.ensure(key).then((ok) => {
        if (!ok) armRetry()
        return ok
      })
    },
    state: (key) => blobs.state(key),
    uploadMissing,
    subscribe: (listener) => blobs.subscribe(listener),
    onProgress(listener) {
      progressListeners.add(listener)
      return () => progressListeners.delete(listener)
    },
  }
}

/**
 * An {@link AssetStore} whose misses ask the relay. A miss in `source`, `bytes`, `url` or `info`
 * triggers `ensure` once (state `unknown`) and returns the miss as before, so the existing
 * missing-asset placeholder shows until `subscribe` fires with the fetched bytes.
 */
export function withRemoteAssets(
  assets: AssetStore,
  sync: AssetSync,
  options: {
    /** Settings › Multiplayer "Fetch images and fonts": false leaves misses as they are. */
    autoFetch?: () => boolean
  } = {},
): AssetStore {
  const request = (key: string | null) => {
    if (options.autoFetch && !options.autoFetch()) return
    if (key && sync.state(key) === "unknown") void sync.ensure(key).catch(() => false)
  }
  const keyOf = (src: string) => assetKey(src)
  return {
    ...assets,
    source: {
      async load(src) {
        const bytes = await assets.source.load(src)
        if (!bytes) request(keyOf(src))
        return bytes
      },
    },
    async bytes(key) {
      const bytes = await assets.bytes(key)
      if (!bytes) request(key)
      return bytes
    },
    async url(src) {
      const url = await assets.url(src)
      if (!url) request(keyOf(src))
      return url
    },
    async info(src) {
      const info = await assets.info(src)
      if (!info) request(keyOf(src))
      return info
    },
    subscribe(cb) {
      const offAssets = assets.subscribe(cb)
      const offSync = sync.subscribe(cb)
      return () => {
        offAssets()
        offSync()
      }
    },
  }
}
