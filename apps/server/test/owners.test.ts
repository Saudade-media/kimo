import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  concatBytes,
  exportPublicKey,
  generateSigningKeyPair,
  mintPairingToken,
  type OwnerDevice,
  randomBytes,
  signWithContext,
  toBase64Url,
  toHex,
  utf8,
} from "@kimo/sync/mp"
import { loadConfig } from "../src/config"
import type { RelayConfig } from "../src/index"
import { Relay } from "../src/index"
import { ENV_DEVICE_NAME } from "../src/owners"
import { type Harness, ownerCommand, startRelay } from "./helpers"

const code = async (res: Response) => ((await res.json()) as { error: string }).error
const devicesOf = async (res: Response) =>
  ((await res.json()) as { devices: OwnerDevice[] }).devices

async function newDevice() {
  const keys = await generateSigningKeyPair()
  return { keys, pub: toBase64Url(await exportPublicKey(keys.publicKey)) }
}

const relays: Harness[] = []
/** A relay that starts unclaimed (no `KIMO_OWNER_KEY`). */
function unclaimed(config: Parameters<typeof startRelay>[0] = {}): Harness {
  const h = startRelay({ ownerKeys: [], ...config })
  relays.push(h)
  return h
}

afterEach(async () => {
  for (const h of relays.splice(0)) await h.stop()
})

/** A relay claimed by `owner`. */
async function claimed(owner: Awaited<ReturnType<typeof newDevice>>) {
  const h = unclaimed()
  const res = await ownerCommand(h, { op: "claim", name: "Mac" }, { keys: owner.keys })
  expect(res.status).toBe(201)
  return h
}

async function pairingToken(
  h: Harness,
  issuer: CryptoKeyPair,
  options: { iat?: number; exp?: number; relayId?: Uint8Array; jti?: Uint8Array } = {},
) {
  const iat = options.iat ?? Math.floor(h.clock.now / 1000)
  return mintPairingToken(issuer, {
    iat,
    exp: options.exp ?? iat + 900,
    jti: options.jti ?? randomBytes(16),
    relayId: options.relayId ?? h.relay.relayId,
  })
}

/** A pairing token signed by hand, so it can break the lifetime rules mint enforces. */
async function rawPairingToken(
  issuer: CryptoKeyPair,
  relayId: Uint8Array,
  iat: number,
  exp: number,
) {
  const payload = new Uint8Array(84)
  const view = new DataView(payload.buffer)
  payload[0] = 1
  payload[1] = 5
  view.setBigUint64(4, BigInt(iat))
  view.setBigUint64(12, BigInt(exp))
  payload.set(randomBytes(16), 20)
  payload.set(relayId, 36)
  payload.set(await exportPublicKey(issuer.publicKey), 52)
  const sig = await signWithContext(issuer.privateKey, utf8("kimo/v1/pairing\0"), payload)
  return toBase64Url(concatBytes(payload, sig))
}

describe("owner: claim", () => {
  test("/version reports unclaimed, then claimed; the same device again is 200 with its new name", async () => {
    const h = unclaimed()
    const before = (await (await fetch(`${h.base}/version`)).json()) as { owner: string }
    expect(before.owner).toBe("unclaimed")
    const a = await newDevice()
    const first = await ownerCommand(h, { op: "claim", name: "Mac" }, { keys: a.keys })
    expect(first.status).toBe(201)
    const listed = await devicesOf(first)
    expect(listed).toEqual([
      { pub: a.pub, name: "Mac", addedAt: h.clock.now, addedBy: null, via: "claim" },
    ])
    const after = (await (await fetch(`${h.base}/version`)).json()) as { owner: string }
    expect(after.owner).toBe("claimed")
    const again = await ownerCommand(h, { op: "claim", name: "Studio Mac" }, { keys: a.keys })
    expect(again.status).toBe(200)
    expect((await devicesOf(again))[0]?.name).toBe("Studio Mac")
  })

  test("another device is RELAY_CLAIMED; the answer never names the owner", async () => {
    const a = await newDevice()
    const h = await claimed(a)
    const b = await newDevice()
    const res = await ownerCommand(h, { op: "claim", name: "Windows" }, { keys: b.keys })
    expect(res.status).toBe(409)
    const text = await res.text()
    expect(JSON.parse(text).error).toBe("RELAY_CLAIMED")
    expect(text).not.toContain(a.pub)
    expect(text).not.toContain("Mac")
  })

  test("two concurrent claims give exactly one 201", async () => {
    const h = unclaimed()
    const [a, b] = [await newDevice(), await newDevice()]
    const results = await Promise.all([
      ownerCommand(h, { op: "claim", name: "A" }, { keys: a.keys }),
      ownerCommand(h, { op: "claim", name: "B" }, { keys: b.keys }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(h.relay.db.countOwners()).toBe(1)
  })
})

describe("owner: devices", () => {
  test("an owner gets the list, a stranger NOT_OWNER, an unclaimed relay RELAY_UNCLAIMED", async () => {
    const empty = unclaimed()
    const a = await newDevice()
    const none = await ownerCommand(empty, { op: "devices" }, { keys: a.keys })
    expect(none.status).toBe(403)
    expect(await code(none)).toBe("RELAY_UNCLAIMED")

    const h = await claimed(a)
    const ok = await ownerCommand(h, { op: "devices" }, { keys: a.keys })
    expect(ok.status).toBe(200)
    expect((await devicesOf(ok)).map((d) => d.pub)).toEqual([a.pub])
    const stranger = await ownerCommand(h, { op: "devices" }, { keys: (await newDevice()).keys })
    expect(stranger.status).toBe(403)
    expect(await code(stranger)).toBe("NOT_OWNER")
  })
})

describe("owner: pair", () => {
  test("a valid token adds the device; reuse is PAIRING_USED", async () => {
    const a = await newDevice()
    const h = await claimed(a)
    const token = await pairingToken(h, a.keys)
    const b = await newDevice()
    h.clock.now += 1000
    const res = await ownerCommand(h, { op: "pair", token, name: "Windows" }, { keys: b.keys })
    expect(res.status).toBe(201)
    const listed = await devicesOf(res)
    expect(listed.map((d) => d.pub)).toEqual([a.pub, b.pub])
    expect(listed[1]).toEqual({
      pub: b.pub,
      name: "Windows",
      addedAt: h.clock.now,
      addedBy: a.pub,
      via: "pair",
    })
    const c = await newDevice()
    const reuse = await ownerCommand(h, { op: "pair", token, name: "Linux" }, { keys: c.keys })
    expect(reuse.status).toBe(409)
    expect(await code(reuse)).toBe("PAIRING_USED")
  })

  test("concurrent redemptions of one token give one 201", async () => {
    const a = await newDevice()
    const h = await claimed(a)
    const token = await pairingToken(h, a.keys)
    const [b, c] = [await newDevice(), await newDevice()]
    const results = await Promise.all([
      ownerCommand(h, { op: "pair", token, name: "B" }, { keys: b.keys }),
      ownerCommand(h, { op: "pair", token, name: "C" }, { keys: c.keys }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(h.relay.db.countOwners()).toBe(2)
  })

  test("an expired token is PAIRING_EXPIRED", async () => {
    const a = await newDevice()
    const h = await claimed(a)
    const token = await pairingToken(h, a.keys)
    h.clock.now += 901_000
    const res = await ownerCommand(
      h,
      { op: "pair", token, name: "B" },
      { keys: (await newDevice()).keys },
    )
    expect(res.status).toBe(401)
    expect(await code(res)).toBe("PAIRING_EXPIRED")
  })

  test("another relay's token, a removed or re-added issuer, a long lifetime and tampering are AUTH_INVALID", async () => {
    const a = await newDevice()
    const h = await claimed(a)
    const now = Math.floor(h.clock.now / 1000)
    const tampered = await pairingToken(h, a.keys)
    const chars = tampered.split("")
    chars[100] = chars[100] === "A" ? "B" : "A"
    const cases = [
      await pairingToken(h, a.keys, { relayId: randomBytes(16) }),
      await pairingToken(h, (await newDevice()).keys),
      // Hand-built: mintPairingToken refuses a lifetime over an hour itself.
      await rawPairingToken(a.keys, h.relay.relayId, now, now + 3601),
      await rawPairingToken(a.keys, h.relay.relayId, now + 600, now + 900),
      chars.join(""),
    ]
    for (const token of cases) {
      const res = await ownerCommand(
        h,
        { op: "pair", token, name: "B" },
        { keys: (await newDevice()).keys },
      )
      expect(res.status).toBe(401)
      expect(await code(res)).toBe("AUTH_INVALID")
    }

    // A token from before its issuer was removed and re-added does not come back to life.
    const b = await newDevice()
    const old = await pairingToken(h, b.keys)
    const viaA = await pairingToken(h, a.keys)
    expect(
      (await ownerCommand(h, { op: "pair", token: viaA, name: "B" }, { keys: b.keys })).status,
    ).toBe(201)
    expect((await ownerCommand(h, { op: "remove", pub: b.pub }, { keys: a.keys })).status).toBe(200)
    h.clock.now += 600_000
    const again = await pairingToken(h, a.keys)
    expect(
      (await ownerCommand(h, { op: "pair", token: again, name: "B" }, { keys: b.keys })).status,
    ).toBe(201)
    const revived = await ownerCommand(
      h,
      { op: "pair", token: old, name: "C" },
      { keys: (await newDevice()).keys },
    )
    expect(revived.status).toBe(401)
    expect(await code(revived)).toBe("AUTH_INVALID")
  })

  test("a cancelled token is PAIRING_USED", async () => {
    const a = await newDevice()
    const h = await claimed(a)
    const jti = randomBytes(16)
    const token = await pairingToken(h, a.keys, { jti })
    const exp = Math.floor(h.clock.now / 1000) + 900
    const cancel = await ownerCommand(
      h,
      { op: "cancel-pairing", jti: toHex(jti), exp },
      { keys: a.keys },
    )
    expect(cancel.status).toBe(200)
    expect(await cancel.json()).toEqual({})
    const res = await ownerCommand(
      h,
      { op: "pair", token, name: "B" },
      { keys: (await newDevice()).keys },
    )
    expect(res.status).toBe(409)
    expect(await code(res)).toBe("PAIRING_USED")
    const stranger = await ownerCommand(
      h,
      { op: "cancel-pairing", jti: toHex(randomBytes(16)), exp },
      { keys: (await newDevice()).keys },
    )
    expect(stranger.status).toBe(403)
    expect(await code(stranger)).toBe("NOT_OWNER")
  })

  test("an existing owner redeeming gets 200 and the token stays usable", async () => {
    const a = await newDevice()
    const h = await claimed(a)
    const token = await pairingToken(h, a.keys)
    const self = await ownerCommand(h, { op: "pair", token, name: "Mac" }, { keys: a.keys })
    expect(self.status).toBe(200)
    const b = await newDevice()
    expect((await ownerCommand(h, { op: "pair", token, name: "B" }, { keys: b.keys })).status).toBe(
      201,
    )
  })
})

describe("owner: remove and rename", () => {
  test("remove works for another device and for itself, LAST_DEVICE on the last, NOT_FOUND for an unknown key", async () => {
    const a = await newDevice()
    const h = await claimed(a)
    const b = await newDevice()
    const c = await newDevice()
    for (const d of [b, c]) {
      h.clock.now += 1000
      const token = await pairingToken(h, a.keys)
      await ownerCommand(h, { op: "pair", token, name: "X" }, { keys: d.keys })
    }
    const other = await ownerCommand(h, { op: "remove", pub: c.pub }, { keys: a.keys })
    expect(other.status).toBe(200)
    expect((await devicesOf(other)).map((d) => d.pub)).toEqual([a.pub, b.pub])
    const itself = await ownerCommand(h, { op: "remove", pub: a.pub }, { keys: a.keys })
    expect(itself.status).toBe(200)
    expect((await devicesOf(itself)).map((d) => d.pub)).toEqual([b.pub])
    const gone = await ownerCommand(h, { op: "devices" }, { keys: a.keys })
    expect(await code(gone)).toBe("NOT_OWNER")
    const last = await ownerCommand(h, { op: "remove", pub: b.pub }, { keys: b.keys })
    expect(last.status).toBe(409)
    expect(await code(last)).toBe("LAST_DEVICE")
    const unknown = await ownerCommand(h, { op: "remove", pub: c.pub }, { keys: b.keys })
    expect(unknown.status).toBe(404)
    expect(await code(unknown)).toBe("NOT_FOUND")
  })

  test("any owner renames any device; bad names, strangers and unknown keys are refused", async () => {
    const a = await newDevice()
    const h = await claimed(a)
    const b = await newDevice()
    h.clock.now += 1000
    await ownerCommand(
      h,
      { op: "pair", token: await pairingToken(h, a.keys), name: "Windows" },
      { keys: b.keys },
    )
    const res = await ownerCommand(
      h,
      { op: "rename", pub: a.pub, name: "Office Mac" },
      { keys: b.keys },
    )
    expect(res.status).toBe(200)
    expect((await devicesOf(res))[0]?.name).toBe("Office Mac")
    // A bad name cannot even be signed: post hand-made bytes.
    const bad = await fetch(`${h.base}/owner`, {
      method: "POST",
      body: new Uint8Array(200) as Uint8Array<ArrayBuffer>,
    })
    expect(bad.status).toBe(400)
    expect(await code(bad)).toBe("BAD_REQUEST")
    const stranger = await ownerCommand(
      h,
      { op: "rename", pub: a.pub, name: "Mine" },
      { keys: (await newDevice()).keys },
    )
    expect(await code(stranger)).toBe("NOT_OWNER")
    const unknown = await ownerCommand(
      h,
      { op: "rename", pub: (await newDevice()).pub, name: "Ghost" },
      { keys: a.keys },
    )
    expect(unknown.status).toBe(404)
    expect(await code(unknown)).toBe("NOT_FOUND")
  })
})

describe("owner: replay, freshness, relay id and rate limit", () => {
  test("the same command twice is NONCE_REPLAY; iat outside 5 minutes STALE_REQUEST", async () => {
    const a = await newDevice()
    const h = await claimed(a)
    const nonce = randomBytes(16)
    expect((await ownerCommand(h, { op: "devices" }, { keys: a.keys, nonce })).status).toBe(200)
    const replay = await ownerCommand(h, { op: "devices" }, { keys: a.keys, nonce })
    expect(replay.status).toBe(409)
    expect(await code(replay)).toBe("NONCE_REPLAY")
    const stale = await ownerCommand(
      h,
      { op: "devices" },
      { keys: a.keys, iat: h.clock.now - 301_000 },
    )
    expect(stale.status).toBe(422)
    expect(await code(stale)).toBe("STALE_REQUEST")
  })

  test("a command for another relay is AUTH_INVALID", async () => {
    const a = await newDevice()
    const h = await claimed(a)
    const res = await ownerCommand(h, { op: "devices" }, { keys: a.keys, relayId: randomBytes(16) })
    expect(res.status).toBe(401)
    expect(await code(res)).toBe("AUTH_INVALID")
  })

  test("shares the admin rate limit; only POST", async () => {
    const h = unclaimed({ adminRatePerMin: 2 })
    const a = await newDevice()
    expect((await ownerCommand(h, { op: "claim", name: "A" }, { keys: a.keys })).status).toBe(201)
    expect((await ownerCommand(h, { op: "devices" }, { keys: a.keys })).status).toBe(200)
    const limited = await ownerCommand(h, { op: "devices" }, { keys: a.keys })
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).not.toBeNull()
    const get = await fetch(`${h.base}/owner`)
    expect(get.status).toBe(405)
  })
})

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kimo-owners-boot-"))
  dirs.push(dir)
  return dir
}

/** Boots a relay on `dir` with `env`, returns what boot left behind, and closes it. */
function boot(dir: string, env: Record<string, string> = {}, at = 1_792_000_000_000) {
  const lines: string[] = []
  const config: RelayConfig = { ...loadConfig(env), dataDir: dir }
  const relay = new Relay(
    config,
    () => at,
    (line) => lines.push(line),
  )
  const result = {
    relayId: toBase64Url(relay.relayId),
    owners: relay.db.owners().map((o) => ({ pub: toBase64Url(o.pub), name: o.name, via: o.via })),
    pairings: relay.db.sqlite
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM pairings_used")
      .get()?.n,
    lines,
    relay,
  }
  relay.dispose()
  return result
}

async function bootKey(): Promise<{ pub: Uint8Array; text: string }> {
  const pair = await generateSigningKeyPair()
  const pub = await exportPublicKey(pair.publicKey)
  return { pub, text: toBase64Url(pub) }
}

describe("ownership at boot", () => {
  test("relay_id is made once and stable across restarts", () => {
    const dir = dataDir()
    const first = boot(dir)
    expect(first.relayId).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(boot(dir).relayId).toBe(first.relayId)
    expect(first.lines).toEqual(["owner: unclaimed, claim it from Kimo"])
  })

  test("KIMO_OWNER_KEY seeds an empty set and is ignored once claimed", async () => {
    const dir = dataDir()
    const [a, b] = [await bootKey(), await bootKey()]
    const seeded = boot(dir, { KIMO_OWNER_KEY: a.text })
    expect(seeded.owners).toEqual([{ pub: a.text, name: ENV_DEVICE_NAME, via: "env" }])
    expect(seeded.lines).toEqual(["owner: claimed (1 device)"])
    const later = boot(dir, { KIMO_OWNER_KEY: `${a.text},${b.text}` })
    expect(later.owners.map((o) => o.pub)).toEqual([a.text])
  })

  test("KIMO_RESET_OWNER clears owners and used pairings once per distinct value; rooms survive", async () => {
    const dir = dataDir()
    const a = await bootKey()
    const first = boot(dir, { KIMO_OWNER_KEY: a.text })
    expect(first.owners.length).toBe(1)
    // A room and a used pairing to see what the reset touches.
    {
      const relay = new Relay({ ...loadConfig({}), dataDir: dir }, () => 1_792_000_000_000)
      relay.db.insertRoom({
        id: "a".repeat(32),
        rootPub: new Uint8Array(32),
        kid: 1,
        linkPub: new Uint8Array(32),
        cert: new Uint8Array(84),
        at: 1,
      })
      relay.db.usePairing(new Uint8Array(16).fill(1), 1_900_000_000)
      relay.dispose()
    }

    const reset = boot(dir, { KIMO_RESET_OWNER: "2026-10-21" })
    expect(reset.owners).toEqual([])
    expect(reset.pairings).toBe(0)
    expect(reset.lines[0]).toBe(
      "warn: KIMO_RESET_OWNER cleared the owner list. Claim the relay from Kimo, then remove the variable.",
    )
    expect(reset.lines[1]).toBe("owner: unclaimed, claim it from Kimo")
    {
      const relay = new Relay({ ...loadConfig({}), dataDir: dir }, () => 1_792_000_000_000)
      expect(relay.db.getRoom("a".repeat(32))).not.toBeNull()
      relay.db.insertOwner({
        pub: a.pub,
        name: "Mac",
        added_at: 2,
        added_by: null,
        via: "claim",
      })
      relay.dispose()
    }

    // The same value on a later boot does nothing.
    const same = boot(dir, { KIMO_RESET_OWNER: "2026-10-21" })
    expect(same.owners.length).toBe(1)
    expect(same.lines).toEqual(["owner: claimed (1 device)"])
    // A new value clears again, and KIMO_OWNER_KEY then seeds the emptied set.
    const b = await bootKey()
    const again = boot(dir, { KIMO_RESET_OWNER: "2026-10-22", KIMO_OWNER_KEY: b.text })
    expect(again.owners.map((o) => o.pub)).toEqual([b.text])
    expect(again.relayId).toBe(first.relayId)
  })

  test("the owners tables join an existing version 1 database", () => {
    const dir = dataDir()
    {
      const relay = new Relay({ ...loadConfig({}), dataDir: dir }, () => 1)
      relay.db.sqlite.run("DROP TABLE owners")
      relay.db.sqlite.run("DROP TABLE pairings_used")
      relay.db.sqlite.run("DROP TABLE relay_meta")
      relay.dispose()
    }
    expect(boot(dir).owners).toEqual([])
  })
})
