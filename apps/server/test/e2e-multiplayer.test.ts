/**
 * Cross-module test: real NetworkProviders (module B) with real YjsDocStores converge through the
 * real relay. Skipped until `@kimo/sync` exports `createNetworkProvider`.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEmptyDocument, YjsDocStore } from "@kimo/editor-state"
import * as sync from "@kimo/sync"
import {
  type BlobManifestEntry,
  blobIdFor,
  createBlobSync,
  fromHex,
  openBlob,
  RelayHttpClient,
  sealBlob,
  sealSnapshot,
  toBase64Url,
  toHex,
} from "@kimo/sync/mp"
import {
  admin,
  bearer,
  type Harness,
  type Owner,
  registered,
  rotateOwner,
  startRelay,
  token,
  until,
} from "./helpers"

const ready = typeof (sync as Record<string, unknown>).createNetworkProvider === "function"

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
  return sync.createNetworkProvider({
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

describe.skipIf(!ready)("end to end through the relay", () => {
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

    const head = h.relay.db.getRoom(owner.room.id)?.head
    // The provider makes the guest's store hard read-only.
    const refused = guest.apply(
      { op: "insert", id: "Frame00003", node: { type: "frame", name: "guest edit" } },
      { origin: "user" },
    )
    expect(refused.ok).toBe(false)
    await Bun.sleep(300)
    expect(h.relay.db.getRoom(owner.room.id)?.head).toBe(head)
    expect(a.hasNode("Frame00003")).toBe(false)
    expect(pg.role).toBe("view")

    await Promise.all([pa.detach(), pb.detach(), pg.detach()])
    await h.stop()
  })

  test("the owner revokes a guest mid-session", async () => {
    const h = startRelay({}, { realTime: true })
    const { owner, seed } = await seeded(h)
    const pa = provider(h, owner, await token(owner, "edit"))
    const jti = crypto.getRandomValues(new Uint8Array(16))
    const pg = provider(h, owner, await token(owner, "edit", { jti }))
    const closed: string[] = []
    pg.onEvent((e) => {
      if (e.type === "closed" && e.error) closed.push(`${e.error.code}:${e.willRetry}`)
    })
    const guest = new YjsDocStore()
    await pa.attach(seed)
    await pg.attach(guest)
    expect((await admin(h, owner, { op: "revoke", jti: toHex(jti), exp: 0 })).status).toBe(200)
    await until(() => closed.length > 0, 5000)
    expect(closed[0]).toBe("TOKEN_REVOKED:false")
    insert(seed, "Frame00009", "after revoke")
    await Bun.sleep(200)
    expect(guest.hasNode("Frame00009")).toBe(false)
    await Promise.all([pa.detach(), pg.detach()])
    await h.stop()
  })

  test("compaction under load: a client snapshot lets a late joiner catch up", async () => {
    const h = startRelay({ compactEntries: 5, logRetainMs: 0 }, { realTime: true })
    const { owner, seed } = await seeded(h)
    const pa = provider(h, owner, await token(owner, "edit"))
    await pa.attach(seed)
    for (let i = 0; i < 30; i++) insert(seed, `Frame${String(i).padStart(5, "0")}`, `n${i}`)
    await until(() => (h.relay.db.latestSnapshot(owner.room.id)?.gen ?? 0) >= 2, 8000)
    const snap = h.relay.db.latestSnapshot(owner.room.id)
    expect(snap?.up_to).toBeGreaterThan(0)
    h.relay.retain(Date.now() + 1000)

    const late = new YjsDocStore()
    const pl = provider(h, owner, await token(owner, "view"))
    await pl.attach(late)
    await until(() => late.hasNode("Frame00029"), 5000)
    expect(late.hasNode("Frame00000")).toBe(true)
    await Promise.all([pa.detach(), pl.detach()])
    await h.stop()
  })
})

describe("blobs between two clients", () => {
  test("a blob uploaded by one is fetched and verified by the other", async () => {
    const h = startRelay()
    const owner = await registered(h)
    const writer = new RelayHttpClient({ relayUrl: h.base })
    const reader = new RelayHttpClient({ relayUrl: h.base })
    const edit = await token(owner, "edit")
    const view = await token(owner, "view")
    const bytes = new TextEncoder().encode("image bytes")
    const blob = await sealBlob(owner.keys, bytes)
    expect(await reader.missingBlobs(owner.room.id, view, [blob.id])).toEqual([blob.id])
    await writer.putBlob(owner.room.id, edit, blob.id, blob.envelope)
    const fetched = await reader.getBlob(owner.room.id, view, blob.id)
    expect(fetched).not.toBeNull()
    const plain = await openBlob(owner.keys, blob.sha, fetched as Uint8Array)
    expect(Array.from(plain)).toEqual(Array.from(bytes))
    // A wrong hash is caught on the client.
    await expect(openBlob(owner.keys, new Uint8Array(32), fetched as Uint8Array)).rejects.toThrow()
    await h.stop()
  })
})

// ---------------------------------------------------------------------------------------------
// The full scenario list: real relay (ephemeral port, temp DATA_DIR where files matter), real
// providers, real YjsDocStores. Everything waits on conditions, never on fixed sleeps, and every
// wait is bounded.
// ---------------------------------------------------------------------------------------------

const textNode = (content: string) => ({ type: "text" as const, content })

/** Every ancestor chain ends at the root without revisiting a node. */
function assertAcyclic(store: YjsDocStore): void {
  for (const id of store.nodeIds()) {
    const seen = new Set<string>()
    let cursor: string | null | undefined = id
    while (cursor) {
      expect(seen.has(cursor)).toBe(false)
      seen.add(cursor)
      cursor = store.getNode(cursor)?.parent ?? null
    }
  }
}

function plain(store: YjsDocStore): string {
  return JSON.stringify(store.toDocument())
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "kimo-e2e-"))
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

describe.skipIf(!ready)("scenarios", () => {
  test("owner shares, editor joins, concurrent edits and reparenting converge without cycles", async () => {
    const h = startRelay({}, { realTime: true })
    const { owner, seed } = await seeded(h)
    const a = seed
    const b = new YjsDocStore()
    const pa = provider(h, owner, await token(owner, "edit"))
    const pb = provider(h, owner, await token(owner, "edit"))
    await pa.attach(a)
    await pb.attach(b)

    insert(a, "Frame00001", "root")
    insert(a, "Frame00002", "X")
    insert(a, "Frame00003", "Y")
    await until(() => b.hasNode("Frame00003"), 5000)
    insert(b, "Frame00004", "from b")
    await until(() => a.hasNode("Frame00004"), 5000)

    // Both go offline and move each into the other: a cycle after the merge.
    pa.disconnect()
    pb.disconnect()
    expect(
      a.apply({ op: "move", id: "Frame00002", parent: "Frame00003" }, { origin: "user" }).ok,
    ).toBe(true)
    expect(
      b.apply({ op: "move", id: "Frame00003", parent: "Frame00002" }, { origin: "user" }).ok,
    ).toBe(true)
    insert(a, "Frame00005", "offline a")
    insert(b, "Frame00006", "offline b")
    pa.connect()
    pb.connect()
    await until(
      () => a.hasNode("Frame00006") && b.hasNode("Frame00005") && plain(a) === plain(b),
      8000,
    )
    // Repair (done by the one designated repairer) settles on the same acyclic tree everywhere.
    await until(() => {
      try {
        assertAcyclic(a)
        assertAcyclic(b)
      } catch {
        return false
      }
      return plain(a) === plain(b)
    }, 8000)
    expect(pa.repairer).not.toBeNull()
    expect(pa.repairer).toBe(pb.repairer)
    await Promise.all([pa.detach(), pb.detach()])
    await h.stop()
  })

  test("offline edits merge on reconnect, from both sides", async () => {
    const h = startRelay({}, { realTime: true })
    const { owner, seed } = await seeded(h)
    const b = new YjsDocStore()
    const pa = provider(h, owner, await token(owner, "edit"))
    const pb = provider(h, owner, await token(owner, "edit"))
    await pa.attach(seed)
    await pb.attach(b)
    pb.disconnect()
    await until(() => !pb.connected)
    for (let i = 0; i < 5; i++) insert(seed, `Online${String(i).padStart(4, "0")}`, `online ${i}`)
    for (let i = 0; i < 5; i++) insert(b, `Offlin${String(i).padStart(4, "0")}`, `offline ${i}`)
    expect(b.hasNode("Online0000")).toBe(false)
    pb.connect()
    await until(
      () => seed.hasNode("Offlin0004") && b.hasNode("Online0004") && plain(seed) === plain(b),
      8000,
    )
    await Promise.all([pa.detach(), pb.detach()])
    await h.stop()
  })

  test("a late joiner catches up from snapshot plus log tail after client compaction", async () => {
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

  test("a view role's writes are denied and the viewer stays read-only", async () => {
    const h = startRelay({}, { realTime: true })
    const { owner, seed } = await seeded(h)
    const pa = provider(h, owner, await token(owner, "edit"))
    const guest = new YjsDocStore()
    const pg = provider(h, owner, await token(owner, "view"))
    await pa.attach(seed)
    await pg.attach(guest)
    expect(pg.role).toBe("view")
    expect(guest.readOnly).not.toBeNull()
    // Even bypassing the store guard, the relay drops a raw view-role update.
    const { client } = await (await import("./helpers")).Client.join(
      h,
      owner.room.id,
      await token(owner, "view"),
    ).then((r) => ({ client: r.client }))
    const head = h.relay.db.getRoom(owner.room.id)?.head
    client.send({
      type: "append",
      cid: 1,
      env: await (await import("./helpers")).update(owner, "x"),
    })
    const err = await client.next("denied")
    expect(err.code).toBe("VIEW_ONLY")
    expect(h.relay.db.getRoom(owner.room.id)?.head).toBe(head)
    client.close()
    insert(seed, "Frame00010", "still flows to viewer")
    await until(() => guest.hasNode("Frame00010"), 5000)
    expect(
      guest.apply(
        { op: "insert", id: "Frame00011", node: { type: "frame", name: "x" } },
        { origin: "user" },
      ).ok,
    ).toBe(false)
    await Promise.all([pa.detach(), pg.detach()])
    await h.stop()
  })

  test("expired tokens are closed, a provider with a stale token is refused", async () => {
    const h = startRelay({})
    const owner = await registered(h)
    const nowSec = Math.floor(h.clock.now / 1000)
    const seed = new YjsDocStore()
    const pa = provider(h, owner, await token(owner, "edit", { exp: nowSec + 30 }))
    const codes: string[] = []
    pa.onEvent((e) => {
      if (e.type === "closed" && e.error) codes.push(e.error.code)
    })
    await pa.attach(seed)
    expect(pa.connected).toBe(true)
    h.clock.now += 31_000
    h.relay.tick()
    await until(() => codes.includes("TOKEN_EXPIRED"), 5000)
    expect(pa.connected).toBe(false)

    // A token that is already expired never gets in.
    const stale = provider(
      h,
      owner,
      await token(owner, "edit", { iat: nowSec - 100, exp: nowSec - 10 }),
    )
    const refused: string[] = []
    stale.onEvent((e) => {
      if (e.type === "denied") refused.push(e.code)
      if (e.type === "closed" && e.error) refused.push(e.error.code)
    })
    await stale.attach(new YjsDocStore()).catch(() => {})
    await until(() => refused.includes("TOKEN_EXPIRED"), 5000)
    await Promise.all([pa.detach(), stale.detach()])
    await h.stop()
  })

  test("reset links: rotating the signing key closes old tokens and new links work", async () => {
    const h = startRelay({}, { realTime: true })
    const { owner, seed } = await seeded(h)
    const pa = provider(h, owner, await token(owner, "edit"))
    const codes: string[] = []
    pa.onEvent((e) => {
      if (e.type === "closed" && e.error) codes.push(e.error.code)
    })
    await pa.attach(seed)
    const next = await rotateOwner(owner, 2, Math.floor(Date.now() / 1000))
    const res = await admin(h, owner, { op: "rotate", cert: toBase64Url(next.cert.bytes) })
    expect(res.status).toBe(200)
    await until(() => codes.includes("KEY_ROTATED"), 5000)

    // The old token can no longer connect.
    const old = provider(h, owner, await token(owner, "edit"))
    const oldCodes: string[] = []
    old.onEvent((e) => e.type === "closed" && e.error && oldCodes.push(e.error.code))
    await old.attach(new YjsDocStore()).catch(() => {})
    await until(() => oldCodes.includes("KEY_ROTATED"), 5000)

    const fresh = new YjsDocStore()
    const pf = provider(h, next, await token(next, "edit"))
    await pf.attach(fresh)
    await until(() => pf.connected && fresh.size === seed.size, 5000)
    await Promise.all([pa.detach(), old.detach(), pf.detach()])
    await h.stop()
  })

  test("presence round trips and the relay stamps the origin from the token", async () => {
    const h = startRelay({}, { realTime: true })
    const { owner, seed } = await seeded(h)
    const pa = provider(h, owner, await token(owner, "edit"))
    const pb = provider(h, owner, await token(owner, "edit", { origin: "agent:bot" }))
    const b = new YjsDocStore()
    await pa.attach(seed)
    await pb.attach(b)
    pb.awareness.setLocalState({
      user: { id: "bot", name: "Bot", color: "#ff0000" },
      cursor: { x: 3, y: 4 },
      selection: ["Frame00001"],
    })
    // The sender claims nothing about its origin; the receiver sees the token's.
    await until(() => [...pa.awareness.getStates().values()].some((s) => s.user.id === "bot"), 5000)
    const seen = [...pa.awareness.getStates().values()].find((s) => s.user.id === "bot")
    expect(seen?.origin).toBe("agent:bot")
    expect(seen?.cursor).toEqual({ x: 3, y: 4 })
    pb.awareness.setLocalState(null)
    await until(
      () => ![...pa.awareness.getStates().values()].some((s) => s.user.id === "bot"),
      5000,
    )
    await Promise.all([pa.detach(), pb.detach()])
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

async function shaHex(bytes: Uint8Array): Promise<string> {
  return toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)),
  )
}

describe("blobs through the relay", () => {
  test("upload on connect, fetch on demand, and a hash mismatch is rejected", async () => {
    const h = startRelay()
    const owner = await registered(h)
    const bytes = new TextEncoder().encode("PIXELS-e2e-image-bytes")
    const sha = await shaHex(bytes)
    const manifest: Record<string, BlobManifestEntry> = {
      "img.png": { sha256: sha, bytes: bytes.length },
    }
    const ownerAssets = new MemAssets()
    ownerAssets.files.set("img.png", bytes)
    const editToken = await token(owner, "edit")
    const viewToken = await token(owner, "view")
    const common = {
      relayUrl: h.base,
      room: owner.room.id,
      roomKey: owner.roomKey,
      manifest: () => manifest,
    }
    const up = createBlobSync({ ...common, token: () => editToken, assets: ownerAssets })
    expect(await up.uploadMissing()).toMatchObject({ uploaded: 1, failed: 0 })
    // A second upload finds nothing missing.
    expect(await up.uploadMissing()).toMatchObject({ uploaded: 0 })

    const guestAssets = new MemAssets()
    const down = createBlobSync({ ...common, token: () => viewToken, assets: guestAssets })
    expect(down.state("img.png")).not.toBe("local")
    expect(await down.ensure("img.png")).toBe(true)
    expect(Array.from(guestAssets.files.get("img.png") ?? [])).toEqual(Array.from(bytes))

    // A malicious editor stores other bytes under the id of the real hash: the reader refuses.
    const evil = await sealBlob(owner.keys, new TextEncoder().encode("something else"))
    const forgedBytes = new TextEncoder().encode("PIXELS-forged")
    const forgedSha = await shaHex(forgedBytes)
    const forgedId = await blobIdFor(owner.keys, fromHex(forgedSha))
    await new RelayHttpClient({ relayUrl: h.base }).putBlob(
      owner.room.id,
      editToken,
      forgedId,
      evil.envelope,
    )
    const victim = new MemAssets()
    const down2 = createBlobSync({
      ...common,
      manifest: () => ({ "forged.png": { sha256: forgedSha } }),
      token: () => viewToken,
      assets: victim,
      retries: 0,
    })
    expect(await down2.ensure("forged.png")).toBe(false)
    expect(victim.files.size).toBe(0)
    up.stop()
    down.stop()
    down2.stop()
    await h.stop()
  })
})

describe("persistence and blindness on disk", () => {
  test("the relay's files hold no plaintext, and a restart keeps the room", async () => {
    const dir = tempDir()
    try {
      const marker = "SECRET-NODE-NAME-7f3a"
      const textMarker = "SECRET-TEXT-CONTENT-91bc"
      const imageMarker = "SECRET-IMAGE-BYTES-c04d"
      let h = startRelay({ dataDir: dir, compactEntries: 5, logRetainMs: 0 }, { realTime: true })
      const { owner, seed } = await seeded(h)
      const pa = provider(h, owner, await token(owner, "edit"))
      await pa.attach(seed)
      insert(seed, "Frame00001", marker)
      seed.apply({ op: "insert", id: "Text000001", node: textNode(textMarker) }, { origin: "user" })
      for (let i = 0; i < 12; i++)
        insert(seed, `Pad${String(i).padStart(7, "0")}`, `${marker}-${i}`)
      await until(() => (h.relay.db.latestSnapshot(owner.room.id)?.up_to ?? 0) > 0, 8000)

      const image = new TextEncoder().encode(imageMarker.repeat(50))
      const assets = new MemAssets()
      assets.files.set("pic.png", image)
      const blobs = createBlobSync({
        relayUrl: h.base,
        room: owner.room.id,
        roomKey: owner.roomKey,
        token: () => "",
        assets,
        manifest: () => ({ "pic.png": { sha256: "" } }),
      })
      blobs.stop()
      const sha = await shaHex(image)
      const sealed = await sealBlob(owner.keys, image)
      expect(sealed.sha).toBeDefined()
      const edit = await token(owner, "edit")
      await new RelayHttpClient({ relayUrl: h.base }).putBlob(
        owner.room.id,
        edit,
        sealed.id,
        sealed.envelope,
      )
      expect(sha).toHaveLength(64)
      await until(() => (h.relay.db.getRoom(owner.room.id)?.head ?? 0) >= 14, 5000)
      const head = h.relay.db.getRoom(owner.room.id)?.head
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

      h = startRelay({ dataDir: dir }, { realTime: true })
      expect(h.relay.db.getRoom(owner.room.id)?.head).toBe(head)
      const back = new YjsDocStore()
      const pb = provider(h, owner, await token(owner, "view"))
      await pb.attach(back)
      await until(() => back.getNode("Frame00001")?.name === marker, 5000)
      expect(back.getNode("Text000001")).toBeDefined()
      const again = await new RelayHttpClient({ relayUrl: h.base }).getBlob(
        owner.room.id,
        await token(owner, "view"),
        sealed.id,
      )
      expect(again).not.toBeNull()
      await pb.detach()
      await h.stop()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
