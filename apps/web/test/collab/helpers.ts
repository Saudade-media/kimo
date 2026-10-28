/** Shared fixtures for the multiplayer tests: a real in-process relay and share services. */
import { createEmptyDocument, type DocStore, YjsDocStore } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { BaseProvider } from "@kimo/sync"
import { createServer, relayOf } from "../../../server/src/index"
import { type AssetStore, contentDigest, createMemoryAssetStore } from "../../src/lib/assets"
import { createMemoryRegistry, type Registry } from "../../src/multiplayer"
import { createMemoryDeviceKeyStore } from "../../src/multiplayer/device-key"
import {
  createShareService,
  type ShareService,
  type ShareTarget,
} from "../../src/multiplayer/share"
import { createPlatformShare } from "../../src/platform/share"

export interface Relay {
  url: string
  stop(): Promise<void>
  tick(): void
}

/** A relay on a free port with in-memory storage and the rate limits lifted. */
export function startRelay(
  config: Record<string, unknown> = {},
  options: { now?: () => number } = {},
): Relay {
  const server = createServer({
    ...(options.now ? { now: options.now } : {}),
    port: 0,
    config: {
      dataDir: ":memory:",
      connectRatePerMin: 1_000_000,
      adminRatePerMin: 1_000_000,
      blobRatePerMin: 1_000_000,
      ...config,
    } as never,
    tickMs: 200,
  })
  return {
    url: server.url.href.replace(/\/$/, ""),
    stop: async () => {
      await server.stop(true)
    },
    tick: () => relayOf(server).tick(),
  }
}

export interface Peer {
  service: ShareService
  registry: Registry
  guests: { store: DocStore; assets: AssetStore }[]
}

/**
 * The device key every peer shares unless a test gives its own: one person's devices, so any of
 * them may share on a relay the first one claimed (ADR 0017).
 */
export const sharedDeviceKeys = createMemoryDeviceKeyStore()

/** A share service with its own registry (one per simulated device). */
export function makePeer(overrides: Partial<Parameters<typeof createShareService>[0]> = {}): Peer {
  const registry = createMemoryRegistry()
  const guests: Peer["guests"] = []
  const service = createShareService({
    registry,
    webOrigin: "https://kimo.test",
    deviceKeys: sharedDeviceKeys,
    deviceName: () => "Mac",
    backoff: [5, 40],
    openGuestDocument: async () => {
      const guest = { store: new YjsDocStore(), assets: createMemoryAssetStore() }
      guests.push(guest)
      return guest
    },
    ...overrides,
  })
  return { service, registry, guests }
}

/** One person's device through the headless sharing API, with its own registry. */
export function makeDevice(platform = createMemoryPlatform()) {
  const registry = createMemoryRegistry()
  const share = createPlatformShare({
    platform,
    assetsFor: () => createMemoryAssetStore(),
    serviceDeps: {
      registry,
      webOrigin: "https://kimo.test",
      backoff: [5, 40],
      replica: () => null,
      openGuestDocument: async () => ({
        store: new YjsDocStore(),
        assets: createMemoryAssetStore(),
      }),
    },
  })
  return { platform, share, registry }
}

export function makeTarget(
  fileKey = "/tmp/design.kimo",
  nodes: string[] = ["Rect000001"],
): ShareTarget & { store: YjsDocStore } {
  const store = new YjsDocStore()
  const doc = createEmptyDocument("Shared") as unknown as { nodes: Record<string, unknown> }
  nodes.forEach((id, i) => {
    doc.nodes[id] = { type: "rect", parent: null, order: `a${i}`, name: id, w: 10, h: 10 }
  })
  store.loadDocument(doc as never)
  return { fileKey, store, assets: createMemoryAssetStore() }
}

/** Stores `bytes` as a PNG-keyed asset and returns its key, `src` and full digest. */
export async function addAsset(assets: AssetStore, bytes: Uint8Array, name = "a.png") {
  const sha256 = await contentDigest(bytes)
  const key = `${sha256.slice(0, 16)}.png`
  const info = await assets.putKey(key, bytes, { mime: "image/png", name })
  if (!info) throw new Error("putKey refused")
  return { key, src: `./assets/${key}`, sha256 }
}

/** Polls until `check` holds. */
export async function until(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error("until: condition not met")
}

export const insertRect = (store: DocStore, id: string, name = id) => {
  const r = store.apply(
    { op: "insert", id, node: { type: "rect", name, w: 5, h: 5 } },
    { origin: "user" },
  )
  if (!r.ok) throw new Error(JSON.stringify(r))
}

/** A replica that keeps the room's CRDT state in memory, like `kimo-room-<room>` in IndexedDB. */
export class MemoryReplica extends BaseProvider {
  private off: (() => void) | null = null
  constructor(private readonly disk: { state: Uint8Array | null }) {
    super("memory-replica")
  }

  async attach(store: DocStore): Promise<void> {
    this._store = store
    if (this.disk.state) store.applyUpdate(this.disk.state, "remote:memory-replica")
    this.disk.state = store.encodeStateAsUpdate()
    this.off = store.onUpdate(() => {
      this.disk.state = store.encodeStateAsUpdate()
    })
    this.setStatus("synced")
  }

  async detach(): Promise<void> {
    this.off?.()
    this._store = null
    this.setStatus("detached")
  }
}
