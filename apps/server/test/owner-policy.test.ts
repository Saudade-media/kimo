import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { exportPublicKey, generateSigningKeyPair, sealBlob, toBase64Url } from "@kimo/sync/mp"
import { loadConfig } from "../src/config"
import { RelayDb } from "../src/db"
import {
  loadOwnerPolicy,
  type OwnerPolicyModule,
  type RegisterDecision,
  type RegisterRequest,
  Relay,
  type WriteDecision,
  type WriteRequest,
} from "../src/index"
import {
  admin,
  bearer,
  device,
  devicePub,
  type Harness,
  makeOwner,
  type Owner,
  ownerCommand,
  register,
  rotateOwner,
  startRelay,
  token,
} from "./helpers"

const code = async (res: Response) => ((await res.json()) as { error: string }).error

interface Account {
  id: string
  plan: boolean
  limit: number | null
}

/**
 * A small in-test policy (ADR 0018): device keys map to accounts, an account without a plan is
 * refused, and every call is recorded. Each answer is synchronous or one resolved promise.
 */
function testPolicy() {
  const devices = new Map<string, Account>()
  const registers: RegisterRequest[] = []
  const writes: WriteRequest[] = []
  let override: unknown = null
  const accountOf = (id: string) => [...devices.values()].find((a) => a.id === id)
  const policy: OwnerPolicyModule = {
    register(request) {
      registers.push(request)
      if (override !== null) return override as RegisterDecision
      const account = devices.get(request.devicePub)
      if (!account) return { allow: false, code: "NOT_OWNER" }
      if (!account.plan) return { allow: false, code: "PLAN_REQUIRED", message: "subscribe first" }
      return { allow: true, account: account.id, storageLimitBytes: account.limit }
    },
    async write(request) {
      writes.push(request)
      if (override !== null) return override as WriteDecision
      const account = accountOf(request.account)
      if (!account?.plan) return { allow: false, code: "PLAN_REQUIRED" }
      return { allow: true, storageLimitBytes: account.limit }
    },
  }
  return {
    policy,
    devices,
    registers,
    writes,
    answer(value: unknown) {
      override = value
    },
  }
}

const relays: Harness[] = []
afterEach(async () => {
  for (const h of relays.splice(0)) await h.stop()
})

function external(policy: OwnerPolicyModule): Harness {
  const h = startRelay({}, { ownerPolicy: policy })
  relays.push(h)
  return h
}

const DEVICE = toBase64Url(devicePub)

async function room(h: Harness, keys: CryptoKeyPair = device): Promise<Owner> {
  const owner = await makeOwner(1, Math.floor(h.clock.now / 1000))
  const res = await register(h, owner, { device: keys })
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`)
  return owner
}

async function putBlob(h: Harness, owner: Owner, text: string) {
  const blob = await sealBlob(owner.keys, new TextEncoder().encode(text))
  const res = await fetch(`${h.base}/blob/${owner.room.id}/${blob.id}`, {
    method: "PUT",
    headers: bearer(await token(owner, "edit")),
    body: blob.envelope as Uint8Array<ArrayBuffer>,
  })
  return { res, bytes: blob.envelope.length }
}

describe("owner policy: external (ADR 0018, section 14.12)", () => {
  test("/version reports external, and KIMO_OWNER_KEY seeds no owner set", async () => {
    const t = testPolicy()
    const h = external(t.policy)
    const info = (await (await fetch(`${h.base}/version`)).json()) as Record<string, unknown>
    expect(info.owner).toBe("external")
    expect(info.relayId).toBe(toBase64Url(h.relay.relayId))
    expect(h.relay.db.countOwners()).toBe(0)
    expect(h.relay.owner.mode).toBe("external")
  })

  test("register asks the policy and records the room's account; a repeat is 200", async () => {
    const t = testPolicy()
    t.devices.set(DEVICE, { id: "acct-a", plan: true, limit: null })
    const h = external(t.policy)
    const owner = await room(h)
    expect(h.relay.db.getRoom(owner.room.id)?.account).toBe("acct-a")
    expect(t.registers).toEqual([
      {
        relayId: toBase64Url(h.relay.relayId),
        room: owner.room.id,
        devicePub: DEVICE,
        state: "new",
      },
    ])
    expect((await register(h, owner)).status).toBe(200)
    expect(t.registers[1]?.state).toBe("open")
  })

  test("NOT_OWNER and PLAN_REQUIRED come from the policy; the owner proof is still checked first", async () => {
    const t = testPolicy()
    const lapsed = await generateSigningKeyPair()
    t.devices.set(toBase64Url(await exportPublicKey(lapsed.publicKey)), {
      id: "acct-b",
      plan: false,
      limit: null,
    })
    const h = external(t.policy)
    const owner = await makeOwner(1, Math.floor(h.clock.now / 1000))

    const stranger = await register(h, owner, { device: await generateSigningKeyPair() })
    expect(stranger.status).toBe(403)
    expect(await code(stranger)).toBe("NOT_OWNER")

    const unpaid = await register(h, owner, { device: lapsed })
    expect(unpaid.status).toBe(402)
    expect(((await unpaid.json()) as { message: string }).message).toBe("subscribe first")

    const asked = t.registers.length
    const none = await register(h, owner, { device: null })
    expect(await code(none)).toBe("NOT_OWNER")
    t.devices.set(DEVICE, { id: "acct-a", plan: true, limit: null })
    const wrongRelay = await admin(
      h,
      owner,
      { op: "register", rootPub: toBase64Url(owner.rootPub), cert: toBase64Url(owner.cert.bytes) },
      { relayId: new Uint8Array(16) },
    )
    expect(wrongRelay.status).toBe(401)
    expect(await code(wrongRelay)).toBe("AUTH_INVALID")
    // Neither a missing nor a bad proof reaches the policy.
    expect(t.registers.length).toBe(asked)
    expect(h.relay.db.getRoom(owner.room.id)).toBeNull()
  })

  test("claim, devices and pair answer OWNER_EXTERNAL", async () => {
    const h = external(testPolicy().policy)
    for (const body of [
      { op: "claim", name: "Mac" },
      { op: "devices" },
      { op: "pair", token: "x".repeat(198), name: "Mac" },
    ] as const) {
      const res = await ownerCommand(h, body)
      expect(res.status).toBe(403)
      expect(await code(res)).toBe("OWNER_EXTERNAL")
    }
  })

  test("the account limit spans its rooms: blob writes and new rooms past it are refused", async () => {
    const t = testPolicy()
    const account: Account = { id: "acct-a", plan: true, limit: null }
    t.devices.set(DEVICE, account)
    const other = await generateSigningKeyPair()
    t.devices.set(toBase64Url(await exportPublicKey(other.publicKey)), {
      id: "acct-c",
      plan: true,
      limit: 1,
    })
    const h = external(t.policy)
    const first = await room(h)
    const second = await room(h)

    const stored = await putBlob(h, first, "a".repeat(600))
    expect(stored.res.status).toBe(201)
    expect(t.writes.at(-1)).toEqual({
      relayId: toBase64Url(h.relay.relayId),
      room: first.room.id,
      account: "acct-a",
      bytes: stored.bytes,
    })
    expect(h.relay.db.accountBytes("acct-a")).toBe(stored.bytes)

    account.limit = stored.bytes + 100
    const refused = await putBlob(h, second, "b".repeat(600))
    expect(refused.res.status).toBe(507)
    expect(await code(refused.res)).toBe("ACCOUNT_QUOTA_EXCEEDED")
    expect(h.relay.db.getRoom(second.room.id)?.blob_bytes).toBe(0)
    expect((await putBlob(h, second, "small")).res.status).toBe(201)

    // A full account cannot open another room; another account still can.
    account.limit = h.relay.db.accountBytes("acct-a")
    const third = await makeOwner(1, Math.floor(h.clock.now / 1000))
    const full = await register(h, third)
    expect(full.status).toBe(507)
    expect(await code(full)).toBe("ACCOUNT_QUOTA_EXCEEDED")
    expect(h.relay.db.getRoom(third.room.id)).toBeNull()
    expect((await register(h, third, { device: other })).status).toBe(201)
    expect(h.relay.db.getRoom(third.room.id)?.account).toBe("acct-c")
  })

  test("a lapsed account cannot write blobs; existing rooms keep their other routes", async () => {
    const t = testPolicy()
    const account: Account = { id: "acct-a", plan: true, limit: null }
    t.devices.set(DEVICE, account)
    const h = external(t.policy)
    const owner = await room(h)
    account.plan = false
    const lapsed = await putBlob(h, owner, "late")
    expect(lapsed.res.status).toBe(402)
    expect(await code(lapsed.res)).toBe("PLAN_REQUIRED")
    const info = await fetch(`${h.base}/room/${owner.room.id}`, {
      headers: bearer(await token(owner, "view")),
    })
    expect(info.status).toBe(200)
  })

  test("closing frees the account's bytes, and reopening records the new account", async () => {
    const t = testPolicy()
    t.devices.set(DEVICE, { id: "acct-a", plan: true, limit: null })
    const h = external(t.policy)
    const owner = await room(h)
    await putBlob(h, owner, "kept until close")
    expect(h.relay.db.accountBytes("acct-a")).toBeGreaterThan(0)
    expect((await admin(h, owner, { op: "close" })).status).toBe(200)
    expect(h.relay.db.accountBytes("acct-a")).toBe(0)

    t.devices.set(DEVICE, { id: "acct-d", plan: true, limit: null })
    const reopened = await rotateOwner(owner, 2, Math.floor(h.clock.now / 1000))
    expect((await register(h, reopened)).status).toBe(201)
    expect(t.registers.at(-1)?.state).toBe("closed")
    expect(h.relay.db.getRoom(owner.room.id)?.account).toBe("acct-d")
  })

  test("a malformed decision or a throwing module is INTERNAL and stores nothing", async () => {
    const t = testPolicy()
    const h = external(t.policy)
    const owner = await makeOwner(1, Math.floor(h.clock.now / 1000))
    for (const answer of [
      { allow: true },
      { allow: true, account: "" },
      { allow: true, account: "a", storageLimitBytes: -1 },
      { allow: false, code: "RELAY_FULL" },
      "yes",
    ]) {
      t.answer(answer)
      const res = await register(h, owner)
      expect(res.status).toBe(500)
      expect(await code(res)).toBe("INTERNAL")
    }
    t.answer(null)
    t.policy.register = () => {
      throw new Error("account service down")
    }
    const error = console.error
    console.error = () => {}
    try {
      expect(await code(await register(h, owner))).toBe("INTERNAL")
    } finally {
      console.error = error
    }
    expect(h.relay.db.getRoom(owner.room.id)).toBeNull()
  })

  test("the devices policy is the default and keeps rooms without an account", async () => {
    const h = startRelay()
    relays.push(h)
    expect(h.relay.owner.mode).toBe("devices")
    const owner = await room(h)
    expect(h.relay.db.getRoom(owner.room.id)?.account).toBeNull()
    const info = (await (await fetch(`${h.base}/version`)).json()) as { owner: string }
    expect(info.owner).toBe("claimed")
  })
})

describe("owner policy: configuration and loading", () => {
  test("KIMO_OWNER_POLICY and KIMO_OWNER_POLICY_MODULE", () => {
    expect(loadConfig({}).ownerPolicyModule).toBeUndefined()
    expect(loadConfig({ KIMO_OWNER_POLICY: "devices" }).ownerPolicyModule).toBeUndefined()
    expect(
      loadConfig({ KIMO_OWNER_POLICY: "external", KIMO_OWNER_POLICY_MODULE: " ./policy.ts " })
        .ownerPolicyModule,
    ).toBe("./policy.ts")
    expect(() => loadConfig({ KIMO_OWNER_POLICY: "cloud" })).toThrow("KIMO_OWNER_POLICY")
    expect(() => loadConfig({ KIMO_OWNER_POLICY: "external" })).toThrow("KIMO_OWNER_POLICY_MODULE")
    expect(() => loadConfig({ KIMO_OWNER_POLICY_MODULE: "./policy.ts" })).toThrow(
      "KIMO_OWNER_POLICY",
    )
  })

  test("a relay whose config names a module refuses to start without it", () => {
    expect(
      () => new Relay({ ...loadConfig({}), dataDir: ":memory:", ownerPolicyModule: "./p.ts" }),
    ).toThrow("KIMO_OWNER_POLICY_MODULE")
  })

  test("loadOwnerPolicy imports a default export and rejects other shapes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kimo-policy-"))
    try {
      const good = join(dir, "good.js")
      writeFileSync(
        good,
        `export default {
  register: () => ({ allow: true, account: "file" }),
  write: async () => ({ allow: true }),
}
`,
      )
      const policy = await loadOwnerPolicy(good)
      const decision = await policy.register({
        relayId: "",
        room: "",
        devicePub: "",
        state: "new",
      })
      expect(decision).toEqual({ allow: true, account: "file" })

      const bad = join(dir, "bad.js")
      writeFileSync(bad, "export default { register() {} }\n")
      await expect(loadOwnerPolicy(bad)).rejects.toThrow("register and write")
      await expect(loadOwnerPolicy(join(dir, "missing.js"))).rejects.toThrow(
        "KIMO_OWNER_POLICY_MODULE",
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a development database made before rooms.account gains the column", () => {
    const dir = mkdtempSync(join(tmpdir(), "kimo-policy-db-"))
    try {
      const old = new Database(join(dir, "relay.sqlite"), { create: true })
      old.run(`CREATE TABLE rooms (
        id TEXT PRIMARY KEY, root_pub BLOB NOT NULL, link_kid INTEGER NOT NULL,
        link_pub BLOB NOT NULL, link_cert BLOB NOT NULL, created_at INTEGER NOT NULL,
        active_at INTEGER NOT NULL, closed_at INTEGER, head INTEGER NOT NULL DEFAULT 0,
        base INTEGER NOT NULL DEFAULT 0, log_bytes INTEGER NOT NULL DEFAULT 0,
        snapshot_bytes INTEGER NOT NULL DEFAULT 0, blob_bytes INTEGER NOT NULL DEFAULT 0,
        quota_bytes INTEGER) STRICT`)
      old.run("PRAGMA user_version = 1")
      old.close()
      const db = new RelayDb(dir)
      try {
        const columns = db.sqlite
          .query<{ name: string }, []>("SELECT name FROM pragma_table_info('rooms')")
          .all()
          .map((column) => column.name)
        expect(columns).toContain("account")
        expect(db.accountBytes("acct-a")).toBe(0)
      } finally {
        db.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
