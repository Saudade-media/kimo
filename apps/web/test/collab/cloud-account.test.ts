/**
 * Kimo Cloud in the app: request signing (the service's test vector), the HTTP client against a
 * bounded fake service, and the sign-in and checkout flows on a manual clock.
 */
import { describe, expect, test } from "bun:test"
import { fromHex } from "@kimo/sync/mp"
import { createCloudClient } from "../../src/multiplayer/cloud/client"
import { createFakeCloud, planIn } from "../../src/multiplayer/cloud/fake"
import { bodyHash, canonicalRequest, signRequest } from "../../src/multiplayer/cloud/sign"
import {
  CHECKOUT_POLL_MS,
  createCloudStore,
  PLANS_RETRY_MS,
  SIGN_IN_POLL_MS,
} from "../../src/multiplayer/cloud/store"
import { CloudError } from "../../src/multiplayer/cloud/types"
import { cloudShareStage } from "../../src/multiplayer/cloud/view"
import {
  createMemoryDeviceKeyStore,
  type DeviceKeyStore,
  devicePubOf,
  importPkcs8,
} from "../../src/multiplayer/device-key"
import type { Clock } from "../../src/multiplayer/relay-setup/runner"

/** A manual clock: timers fire only on `advance`. */
function fakeClock(start = 1_761_091_200_000) {
  let now = start
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const clock: Clock & { advance(ms: number): void; pending(): number } = {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++seq
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout(h) {
      timers.delete(h as number)
    },
    advance(ms) {
      const until = now + ms
      for (let guard = 0; guard < 10_000; guard++) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = until
    },
    pending: () => timers.size,
  }
  return clock
}

const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}

/** Advances one poll period and lets the poll's request settle. */
async function tick(clock: ReturnType<typeof fakeClock>, ms: number) {
  clock.advance(ms)
  await flush()
}

const SEED = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
const PKCS8_ED25519_PREFIX = "302e020100300506032b657004220420"

describe("request signing", () => {
  test("public key, body hash, canonical string and signature", async () => {
    const keys = await importPkcs8(fromHex(PKCS8_ED25519_PREFIX + SEED))
    const pub = await devicePubOf(keys)
    expect(pub).toBe("ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ")
    const body = new TextEncoder().encode(JSON.stringify({ interval: "month" }))
    expect(await bodyHash(body)).toBe("n_sL5WVRP77_kb2xieKdMVpdMmLFS23xsHL45GMTRgU")
    expect(await bodyHash(new Uint8Array(0))).toBe("47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU")
    const input = {
      aud: "https://cloud.getkimo.design",
      method: "POST",
      path: "/v1/checkout",
      iat: 1761091200000,
      nonce: "oKGio6SlpqeoqaqrrK2urw",
      pub,
      body,
    }
    expect(await canonicalRequest(input)).toBe(
      '{"aud":"https://cloud.getkimo.design","body":"n_sL5WVRP77_kb2xieKdMVpdMmLFS23xsHL45GMTRgU","iat":1761091200000,"method":"POST","nonce":"oKGio6SlpqeoqaqrrK2urw","path":"/v1/checkout","pub":"ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ","v":1}',
    )
    const headers = await signRequest(keys.privateKey, input)
    expect(headers).toEqual({
      "kimo-pub": "ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ",
      "kimo-iat": "1761091200000",
      "kimo-nonce": "oKGio6SlpqeoqaqrrK2urw",
      "kimo-sig":
        "WxEXzq5w9YHJmucGMk6S8ut50XOco1Mcif_g-QO3CxHbfwmgM7gC2l85m5YdLJTdTBGn9X0YrSoH8cw8dpIdCA",
    })
  })
})

function setup(opts: { clock?: ReturnType<typeof fakeClock>; keys?: DeviceKeyStore } = {}) {
  const clock = opts.clock ?? fakeClock()
  const cloud = createFakeCloud({ now: clock.now })
  const keys = opts.keys ?? createMemoryDeviceKeyStore()
  const client = createCloudClient({
    apiUrl: cloud.apiUrl,
    deviceKeys: keys,
    fetch: cloud.fetch,
    now: clock.now,
  })
  return { clock, cloud, keys, client }
}

describe("client", () => {
  test("signed calls verify on the service; health and plans are unsigned", async () => {
    const { cloud, keys, client } = setup()
    expect(await client.health()).toBe(true)
    expect((await client.plans()).plans.map((p) => p.amountCents)).toEqual([800, 8000])
    const started = await client.authStart({
      email: " Maya@Studio.Design ",
      deviceName: "Mac",
      client: "desktop",
    })
    expect(started.email).toBe("maya@studio.design")
    expect(cloud.log.map((l) => [l.path, l.signed])).toEqual([
      ["/v1/health", false],
      ["/v1/plans", false],
      ["/v1/auth/start", true],
    ])
    expect(cloud.log[2]?.body).toEqual({
      email: " Maya@Studio.Design ",
      devicePub: await devicePubOf(await keys.get()),
      deviceName: "Mac",
      client: "desktop",
    })
    await expect(client.account()).rejects.toMatchObject({ code: "NOT_SIGNED_IN", status: 401 })
    cloud.verifyLink()
    const account = await client.account()
    expect(account.account.email).toBe("maya@studio.design")
    expect(account.plan.status).toBe("none")
    expect(account.devices).toEqual([expect.objectContaining({ name: "Mac", self: true }) as never])
    expect((await client.relay()).relayUrl).toBe(cloud.relayUrl)
  })

  test("a stale clock is retried once with the server's time, then remembered", async () => {
    const { cloud, client, keys } = setup()
    cloud.signIn(await devicePubOf(await keys.get()), "maya@studio.design")
    cloud.state.skew = 10 * 60_000
    await client.account()
    expect(cloud.log.length).toBe(2)
    await client.account()
    expect(cloud.log.length).toBe(3)
  })

  test("no answer is OFFLINE; service errors keep their code and retry-after", async () => {
    const { cloud, client } = setup()
    cloud.state.offline = true
    await expect(client.account()).rejects.toMatchObject({ code: "OFFLINE", status: 0 })
    cloud.state.offline = false
    cloud.state.failNext.set("POST /v1/auth/start", { status: 503, code: "EMAIL_UNAVAILABLE" })
    const e = await client
      .authStart({ email: "maya@studio.design", deviceName: "Mac", client: "web" })
      .catch((x: unknown) => x)
    expect(e).toBeInstanceOf(CloudError)
    expect((e as CloudError).code).toBe("EMAIL_UNAVAILABLE")
    cloud.state.failNext.set("GET /v1/account", { status: 502, code: "SOMETHING_NEW" })
    await expect(client.account()).rejects.toMatchObject({ code: "INTERNAL" })
  })

  test("a link that is not http(s) is refused", async () => {
    const keys = createMemoryDeviceKeyStore()
    const client = createCloudClient({
      apiUrl: "https://cloud.test",
      deviceKeys: keys,
      fetch: (async () =>
        new Response(
          JSON.stringify({ checkoutId: "chk_1", url: "javascript:alert(1)", expiresAt: 1 }),
          { status: 201 },
        )) as unknown as typeof fetch,
    })
    await expect(client.checkout("month")).rejects.toMatchObject({ code: "BAD_RESPONSE" })
  })
})

function storeSetup(opts: { focus?: { fire(): void } } = {}) {
  const base = setup()
  const opened: string[] = []
  let onFocus: (() => void) | null = null
  const store = createCloudStore({
    client: base.client,
    deviceName: () => "Mac",
    clientKind: "desktop",
    openUrl: async (url) => {
      opened.push(url)
    },
    clock: base.clock,
    onFocus: (fn) => {
      onFocus = fn
      return () => {
        onFocus = null
      }
    },
  })
  void opts
  return { ...base, store, opened, focus: () => onFocus?.() }
}

describe("store: sign in", () => {
  test("sign in polls every 2 s until the emailed link is opened anywhere", async () => {
    const { store, cloud, clock } = storeSetup()
    expect(store.getState().session).toBe("unknown")
    await store.refresh()
    expect(store.getState().session).toBe("signed-out")
    store.setEmail("maya@studio.design")
    await store.startSignIn()
    const sent = store.getState().signIn
    expect(sent.phase).toBe("sent")
    if (sent.phase !== "sent") return
    expect(sent.resendAfter - clock.now()).toBe(60_000)
    await tick(clock, SIGN_IN_POLL_MS)
    await tick(clock, SIGN_IN_POLL_MS)
    expect(cloud.log.filter((l) => l.path === "/v1/auth/poll").length).toBe(2)
    expect(store.getState().signIn.phase).toBe("sent")
    cloud.verifyLink()
    await tick(clock, SIGN_IN_POLL_MS)
    const s = store.getState()
    expect(s.signIn).toEqual({ phase: "signed-in", email: "maya@studio.design" })
    expect(s.session).toBe("signed-in")
    expect(s.account?.plan.status).toBe("none")
    expect(clock.pending()).toBe(0)
    store.dispose()
  })

  test("polling stops by itself once the 15 minutes are up", async () => {
    const { store, clock, cloud } = storeSetup()
    await store.startSignIn("maya@studio.design")
    cloud.state.offline = true
    // One poll per tick: past the 15 minutes the link is expired.
    for (let i = 0; i < 30 && store.getState().signIn.phase === "sent"; i++)
      await tick(clock, 10 * 60_000)
    expect(store.getState().signIn.phase).toBe("expired")
    expect(store.getState().offline).toBe(true)
    expect(clock.pending()).toBe(0)
    store.dispose()
  })

  test("a device clock that runs fast still gets the link's 15 minutes", async () => {
    const server = fakeClock()
    const device = fakeClock(server.now() + 20 * 60_000)
    const cloud = createFakeCloud({ now: server.now })
    const client = createCloudClient({
      apiUrl: cloud.apiUrl,
      deviceKeys: createMemoryDeviceKeyStore(),
      fetch: cloud.fetch,
      now: device.now,
    })
    const store = createCloudStore({
      client,
      deviceName: () => "Mac",
      clientKind: "desktop",
      openUrl: async () => {},
      clock: device,
      onFocus: () => () => {},
    })
    await store.startSignIn("maya@studio.design")
    const sent = store.getState().signIn
    expect(sent.phase).toBe("sent")
    if (sent.phase !== "sent") return
    expect(sent.expiresAt - device.now()).toBe(15 * 60_000)
    expect(sent.resendAfter - device.now()).toBe(60_000)
    await tick(device, SIGN_IN_POLL_MS)
    expect(store.getState().signIn.phase).toBe("sent")
    store.dispose()
  })
})

describe("store: account, devices, offline", () => {
  test("offline keeps the last plan; an answer clears it", async () => {
    const { store, cloud, keys } = storeSetup()
    cloud.signIn(await devicePubOf(await keys.get()), "maya@studio.design")
    cloud.setPlan("maya@studio.design", "active")
    await store.refresh()
    expect(store.getState().account?.plan.canShare).toBe(true)
    cloud.state.offline = true
    await store.refresh()
    const s = store.getState()
    expect(s.offline).toBe(true)
    expect(s.session).toBe("signed-in")
    expect(s.account?.plan.status).toBe("active")
    cloud.state.offline = false
    await store.refresh()
    expect(store.getState().offline).toBe(false)
    store.dispose()
  })

  test("rename and sign out another device; signing out this one signs the store out", async () => {
    const { store, cloud, keys, clock } = storeSetup()
    const self = await devicePubOf(await keys.get())
    cloud.signIn(self, "maya@studio.design", "Mac", clock.now() - 1000)
    const other = await devicePubOf(await createMemoryDeviceKeyStore().get())
    cloud.signIn(other, "maya@studio.design", "Chrome on Windows")
    await store.refresh()
    expect(store.getState().account?.devices.map((d) => [d.name, d.self])).toEqual([
      ["Mac", true],
      ["Chrome on Windows", false],
    ])
    await store.renameDevice(other, "Studio PC")
    expect(store.getState().account?.devices.map((d) => d.name)).toEqual(["Mac", "Studio PC"])
    await store.signOutDevice(other)
    expect(cloud.isBound(other)).toBe(false)
    expect(store.getState().account?.devices.length).toBe(1)
    await store.signOut()
    expect(cloud.isBound(self)).toBe(false)
    expect(store.getState().session).toBe("signed-out")
    expect(store.getState().account).toBeNull()
    expect(store.getState().signIn).toMatchObject({ phase: "email", email: "maya@studio.design" })
    store.dispose()
  })

  test("the window's focus refreshes the account (after the billing portal)", async () => {
    const { store, cloud, keys, opened, focus } = storeSetup()
    cloud.signIn(await devicePubOf(await keys.get()), "maya@studio.design")
    cloud.setPlan("maya@studio.design", "past_due")
    await store.refresh()
    await store.openPortal()
    expect(opened).toEqual([expect.stringContaining("/portal/") as never])
    cloud.setPlan("maya@studio.design", "active")
    focus()
    await flush()
    expect(store.getState().account?.plan.status).toBe("active")
    store.dispose()
  })
})

describe("store: plans", () => {
  test("asked once; after no answer, not again for a minute; failures never reject", async () => {
    const clock = fakeClock()
    const cloud = createFakeCloud({ now: clock.now })
    let asked = 0
    const client = createCloudClient({
      apiUrl: cloud.apiUrl,
      deviceKeys: createMemoryDeviceKeyStore(),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/v1/plans")) asked++
        return cloud.fetch(input, init)
      }) as typeof fetch,
      now: clock.now,
    })
    const store = createCloudStore({
      client,
      deviceName: () => "Mac",
      clientKind: "web",
      openUrl: async () => {},
      clock,
      onFocus: () => () => {},
    })
    cloud.state.offline = true
    // The fake rejects the way a browser does (TypeError "Failed to fetch"): it becomes offline.
    await Promise.all([store.loadPlans(), store.loadPlans()])
    expect(asked).toBe(1)
    expect(store.getState().offline).toBe(true)
    await store.loadPlans()
    expect(asked).toBe(1)
    cloud.state.offline = false
    clock.advance(PLANS_RETRY_MS)
    await store.loadPlans()
    expect(asked).toBe(2)
    expect(store.getState().offline).toBe(false)
    await store.loadPlans()
    expect(asked).toBe(2)
    await store.loadPlans({ force: true })
    expect(asked).toBe(3)
    store.dispose()
  })
})

describe("store: checkout", () => {
  async function signedIn() {
    const t = storeSetup()
    t.cloud.signIn(await devicePubOf(await t.keys.get()), "maya@studio.design")
    await t.store.refresh()
    return t
  }

  test("checkout opens the provider, polls every 3 s and is ready once the plan allows sharing", async () => {
    const { store, cloud, clock, opened } = await signedIn()
    store.chooseInterval("year")
    await store.startCheckout()
    const w = store.getState().checkout
    expect(w.phase).toBe("waiting")
    if (w.phase !== "waiting") return
    expect(w.interval).toBe("year")
    expect(opened).toEqual([w.url])
    await tick(clock, CHECKOUT_POLL_MS)
    expect(store.getState().checkout.phase).toBe("waiting")
    await store.reopenCheckout()
    expect(opened.length).toBe(2)
    cloud.finishCheckout("succeeded")
    await tick(clock, CHECKOUT_POLL_MS)
    expect(store.getState().checkout).toEqual({ phase: "ready" })
    expect(store.getState().account?.plan).toMatchObject({ status: "active", interval: "year" })
    expect(clock.pending()).toBe(0)
    store.dispose()
  })

  test("a declined checkout can be started again", async () => {
    const { store, cloud, clock } = await signedIn()
    await store.startCheckout()
    cloud.finishCheckout("failed")
    await tick(clock, CHECKOUT_POLL_MS)
    expect(store.getState().checkout).toMatchObject({ phase: "failed", interval: "month" })
    expect(clock.pending()).toBe(0)
    await store.startCheckout()
    expect(store.getState().checkout.phase).toBe("waiting")
    store.backToChoose()
    expect(store.getState().checkout.phase).toBe("choose")
    expect(clock.pending()).toBe(0)
    store.dispose()
  })

  test("a checkout never closed stops polling at its expiry", async () => {
    const { store, clock } = await signedIn()
    await store.startCheckout()
    for (let i = 0; i < 30 && store.getState().checkout.phase === "waiting"; i++)
      await tick(clock, 30 * 60_000)
    expect(store.getState().checkout.phase).toBe("failed")
    expect(clock.pending()).toBe(0)
    store.dispose()
  })
})

describe("what a signed-in account may do", () => {
  const now = Date.UTC(2026, 9, 21, 12)
  const signedIn = (status: Parameters<typeof planIn>[0]) => ({
    session: "signed-in" as const,
    account: {
      account: { id: "a", email: "maya@studio.design", createdAt: 0 },
      plan: planIn(status, now),
      usage: { bytes: 0, rooms: 0, limitBytes: 1e10, reportedAt: null },
      devices: [],
    },
    offline: false,
  })

  test("sharing is offered while the plan is active or past due, not after it lapses", () => {
    expect(cloudShareStage({ session: "signed-out", account: null, offline: false })).toBe(
      "sign-in",
    )
    expect(cloudShareStage(signedIn("active"))).toBe("ready")
    expect(cloudShareStage(signedIn("past_due"))).toBe("ready")
    expect(cloudShareStage(signedIn("none"))).toBe("subscribe")
    expect(cloudShareStage(signedIn("grace"))).toBe("lapsed")
    // Offline keeps the last known plan.
    expect(cloudShareStage({ ...signedIn("active"), offline: true })).toBe("ready")
  })
})
