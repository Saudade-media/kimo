import { describe, expect, test } from "bun:test"
import { PlatformError } from "@kimo/platform"
import {
  deriveRoomId,
  exportPublicKey,
  generateRoomKey,
  generateSigningKeyPair,
  signWithContext,
  verifyWithContext,
} from "@kimo/sync/mp"
import {
  createRegistry,
  fileRegistryBackend,
  memoryRegistryBackend,
  type OwnedRoom,
} from "../src/multiplayer"

async function owned(fileKey = "/a.kimo"): Promise<OwnedRoom> {
  const rootKeys = await generateSigningKeyPair(true)
  const linkKeys = await generateSigningKeyPair(true)
  const room = await deriveRoomId(await exportPublicKey(rootKeys.publicKey))
  return {
    room: room.id,
    relayUrl: "https://relay.example.com",
    fileKey,
    roomKey: generateRoomKey(),
    rootKeys,
    linkKeys,
    kid: 1,
    createdAt: 1000,
    links: [
      {
        jti: "ab".repeat(16),
        role: "edit",
        exp: 0,
        iat: 1,
        kid: 1,
        origin: "user",
        revoked: false,
        link: "x",
      },
    ],
  }
}

describe("registry", () => {
  test("owned rooms round trip with working keys", async () => {
    const registry = createRegistry(memoryRegistryBackend())
    const room = await owned()
    await registry.putOwned(room)
    const back = await registry.getOwned(room.room)
    expect(back?.room).toBe(room.room)
    expect(back?.roomKey).toEqual(room.roomKey)
    expect(back?.links).toEqual(room.links)
    // The restored root key signs what the original public key verifies.
    const context = new TextEncoder().encode("ctx")
    const payload = new Uint8Array([1, 2, 3])
    const signature = await signWithContext(
      (back as OwnedRoom).rootKeys.privateKey,
      context,
      payload,
    )
    const pub = await exportPublicKey(room.rootKeys.publicKey)
    expect(await verifyWithContext(pub, context, payload, signature)).toBe(true)
    expect((await registry.ownedForFile("/a.kimo"))?.room).toBe(room.room)
    expect(await registry.ownedForFile("/other.kimo")).toBeNull()
    await registry.deleteOwned(room.room)
    expect(await registry.listOwned()).toEqual([])
  })

  test("joined rooms and cursors (the RoomStateStore contract)", async () => {
    const registry = createRegistry(memoryRegistryBackend())
    const roomKey = generateRoomKey()
    await registry.putJoined({
      room: "r",
      relayUrl: "https://x",
      token: "t",
      roomKey,
      role: "view",
      joinedAt: 5,
    })
    expect((await registry.getJoined("r"))?.roomKey).toEqual(roomKey)
    expect(await registry.cursors.load("r")).toBeNull()
    await registry.cursors.save("r", { ackedSv: new Uint8Array([1, 2, 3]) })
    expect((await registry.cursors.load("r"))?.ackedSv).toEqual(new Uint8Array([1, 2, 3]))
    await registry.cursors.save("r", { ackedSv: null })
    expect((await registry.cursors.load("r"))?.ackedSv).toBeNull()
    await registry.cursors.clear("r")
    expect(await registry.cursors.load("r")).toBeNull()
  })

  test("the file backend persists through the platform files API", async () => {
    const disk = new Map<string, string>()
    const files = {
      async readText(ref: string) {
        const text = disk.get(ref)
        if (text === undefined) throw new PlatformError("NOT_FOUND", "missing")
        return { text, hash: "" }
      },
      async writeTextAtomic(ref: string, text: string) {
        disk.set(ref, text)
        return { hash: "" } as never
      },
    }
    const first = createRegistry(fileRegistryBackend(files, "/home/.kimo/rooms.json"))
    const room = await owned()
    await first.putOwned(room)
    // A second registry on the same file (a restart) sees the room.
    const second = createRegistry(fileRegistryBackend(files, "/home/.kimo/rooms.json"))
    expect((await second.getOwned(room.room))?.fileKey).toBe("/a.kimo")
    expect(disk.get("/home/.kimo/rooms.json")).not.toContain("BEGIN")
  })
})
