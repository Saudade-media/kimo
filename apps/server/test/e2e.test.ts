/**
 * Real NetworkProviders with real YjsDocStores through the real relay (ephemeral port, temp data
 * dir where files matter). Everything waits on conditions, never on fixed sleeps, and every wait
 * is bounded.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEmptyDocument, YjsDocStore } from "@kimo/editor-state"
import { createNetworkProvider } from "@kimo/sync"
import { createBlobSync, sealSnapshot, sha256, toHex } from "@kimo/sync/mp"
import { bearer, type Harness, type Owner, registered, startRelay, token, until } from "./helpers"

async function seeded(h: Harness): Promise<{ owner: Owner; seed: YjsDocStore }> {
  const owner = await registered(h)
  const seed = new YjsDocStore()
  seed.loadDocument(createEmptyDocument("E2E"))
  const env = await sealSnapshot(owner.keys, 0, seed.encodeStateAsUpdate())
  const res = await fetch(`${h.base}/room/${owner.room.id}/snapshot?upTo=0`, {
    method: "PUT",
    headers: bearer(await token(owner, "edit")),
    body: env as Uint8Array<ArrayBuffer>,
  })
  expect(res.status).toBe(201)
  return { owner, seed }
}

function provider(h: Harness, owner: Owner, tokenText: string) {
  return createNetworkProvider({
    relayUrl: h.base,
    room: owner.room.id,
    token: tokenText,
    roomKey: owner.roomKey,
    backoff: [5, 40],
  })
}

const insert = (store: YjsDocStore, id: string, name: string) => {
  const result = store.apply(
    { op: "insert", id, node: { type: "frame", name } },
    { origin: "user" },
  )
  if (!result.ok) throw new Error(JSON.stringify(result))
}

const plain = (store: YjsDocStore) => JSON.stringify(store.toDocument())

describe("end to end through the relay", () => {
  test("two editors converge and a view-only guest follows but cannot write", async () => {
    const h = startRelay({}, { realTime: true })
    const { owner, seed } = await seeded(h)
    const a = seed
    const b = new YjsDocStore()
    const guest = new YjsDocStore()
    const pa = provider(h, owner, await token(owner, "edit"))
    const pb = provider(h, owner, await token(owner, "edit", { origin: "agent:b" }))
    const pg = provider(h, owner, await token(owner, "view"))
    await pa.attach(a)
    await pb.attach(b)
    await pg.attach(guest)

    insert(a, "Frame00001", "from a")
    await until(() => b.hasNode("Frame00001") && guest.hasNode("Frame00001"), 5000)
    insert(b, "Frame00002", "from b")
    await until(() => a.hasNode("Frame00002") && guest.hasNode("Frame00002"), 5000)
    await until(() => plain(a) === plain(b), 5000)

    // The provider makes the guest's store hard read-only.
    const head = h.relay.db.getRoom(owner.room.id)?.head
    const refused = guest.apply(
      { op: "insert", id: "Frame00003", node: { type: "frame", name: "guest edit" } },
      { origin: "user" },
    )
    expect(refused.ok).toBe(false)
    await Bun.sleep(50)
    expect(h.relay.db.getRoom(owner.room.id)?.head).toBe(head)
    expect(a.hasNode("Frame00003")).toBe(false)
    expect(pg.role).toBe("view")

    await Promise.all([pa.detach(), pb.detach(), pg.detach()])
    await h.stop()
  })

  test("a late joiner catches up from the client's snapshot plus the log tail after compaction", async () => {
    const h = startRelay({ compactEntries: 5, logRetainMs: 0 }, { realTime: true })
    const { owner, seed } = await seeded(h)
    const pa = provider(h, owner, await token(owner, "edit"))
    await pa.attach(seed)
    for (let i = 0; i < 20; i++) insert(seed, `Before${String(i).padStart(4, "0")}`, `before ${i}`)
    await until(() => (h.relay.db.latestSnapshot(owner.room.id)?.up_to ?? 0) > 0, 8000)
    for (let i = 0; i < 3; i++) insert(seed, `Tail${String(i).padStart(6, "0")}`, `tail ${i}`)
    await until(() => (h.relay.db.getRoom(owner.room.id)?.head ?? 0) >= 23, 5000)
    const snap = h.relay.db.latestSnapshot(owner.room.id)
    h.relay.retain(Date.now() + 1000)
    const covered = h.relay.db.sqlite
      .query("SELECT COUNT(*) AS n FROM log WHERE room = ? AND seq <= ?")
      .get(owner.room.id, snap?.up_to ?? 0) as { n: number }
    expect(covered.n).toBe(0)

    const late = new YjsDocStore()
    const pl = provider(h, owner, await token(owner, "edit"))
    await pl.attach(late)
    await until(() => late.hasNode("Tail000002"), 5000)
    expect(late.hasNode("Before0000")).toBe(true)
    await until(() => plain(late) === plain(seed), 5000)
    await Promise.all([pa.detach(), pl.detach()])
    await h.stop()
  })
})

class MemAssets {
  readonly files = new Map<string, Uint8Array>()
  async keys() {
    return [...this.files.keys()]
  }
  async bytes(key: string) {
    return this.files.get(key) ?? null
  }
  async putKey(key: string, bytes: Uint8Array) {
    this.files.set(key, bytes)
    return {}
  }
}

/** All bytes of every file under `dir` (sqlite, wal, blobs), as one list. */
function filesUnder(dir: string): { path: string; bytes: Buffer }[] {
  const out: { path: string; bytes: Buffer }[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path))
    else out.push({ path, bytes: readFileSync(path) })
  }
  return out
}

describe("the relay stays blind", () => {
  test("its files hold no node names, text content or image bytes, live or closed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kimo-e2e-"))
    try {
      const marker = "SECRET-NODE-NAME-7f3a"
      const textMarker = "SECRET-TEXT-CONTENT-91bc"
      const imageMarker = "SECRET-IMAGE-BYTES-c04d"
      const h = startRelay({ dataDir: dir, compactEntries: 5, logRetainMs: 0 }, { realTime: true })
      const { owner, seed } = await seeded(h)
      const edit = await token(owner, "edit")
      const pa = provider(h, owner, edit)
      await pa.attach(seed)
      insert(seed, "Frame00001", marker)
      seed.apply(
        { op: "insert", id: "Text000001", node: { type: "text", content: textMarker } },
        { origin: "user" },
      )
      for (let i = 0; i < 12; i++)
        insert(seed, `Pad${String(i).padStart(7, "0")}`, `${marker}-${i}`)
      await until(() => (h.relay.db.getRoom(owner.room.id)?.head ?? 0) >= 14, 5000)
      await until(() => (h.relay.db.latestSnapshot(owner.room.id)?.up_to ?? 0) > 0, 8000)

      const image = new TextEncoder().encode(imageMarker.repeat(50))
      const sha = toHex(await sha256(image))
      const assets = new MemAssets()
      assets.files.set("pic.png", image)
      const blobs = createBlobSync({
        relayUrl: h.base,
        room: owner.room.id,
        roomKey: owner.roomKey,
        token: () => edit,
        assets,
        manifest: () => ({ "pic.png": { sha256: sha, bytes: image.length } }),
      })
      expect(await blobs.uploadMissing()).toMatchObject({ uploaded: 1, failed: 0 })
      blobs.stop()
      await pa.detach()

      const scan = () => {
        const files = filesUnder(dir)
        expect(files.some((f) => f.path.endsWith("relay.sqlite"))).toBe(true)
        expect(files.some((f) => f.path.includes("/blobs/"))).toBe(true)
        for (const f of files)
          for (const secret of [marker, textMarker, imageMarker, "E2E", "frame"])
            expect(f.bytes.includes(Buffer.from(secret))).toBe(false)
      }
      scan() // live (wal not yet checkpointed)
      await h.stop()
      scan() // closed
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
