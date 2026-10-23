/**
 * A bounded, in-memory Kimo Cloud for tests and harnesses (not the service): `fetch` that answers
 * the public API of kimo-cloud docs/api.md with verified device signatures, nonces and stale-iat
 * checks, plus `script` hooks to move the account between board 43 states (verify a link, pay,
 * lapse, go offline). Every answer is one small JSON body; nothing streams or loops.
 */
import { fromBase64Url } from "@kimo/sync/mp"
import { canonicalRequest } from "./sign"
import type {
  BillingInterval,
  CheckoutStatusValue,
  CloudAccount,
  CloudDevice,
  CloudPlan,
  PlanStatus,
} from "./types"

export interface FakeCloudOptions {
  apiUrl?: string
  now?: () => number
  relayUrl?: string
}

interface Request {
  id: string
  pub: string
  email: string
  name: string
  expiresAt: number
  status: "pending" | "verified" | "expired" | "superseded"
}

interface Checkout {
  id: string
  account: string
  interval: BillingInterval
  status: CheckoutStatusValue
  expiresAt: number
}

const DAY = 86_400_000

export function emptyPlan(): CloudPlan {
  return {
    status: "none",
    canShare: false,
    interval: null,
    amountCents: null,
    currency: null,
    renewsAt: null,
    cancelAtPeriodEnd: false,
    endsAt: null,
    paymentDueBy: null,
    graceEndsAt: null,
    retainUntil: null,
  }
}

/** A plan in `status` the way the service would report it at `now`. */
export function planIn(status: PlanStatus, now: number, interval: BillingInterval = "month") {
  const paid = {
    interval,
    amountCents: interval === "month" ? 800 : 8000,
    currency: "usd",
  }
  const plan: CloudPlan = { ...emptyPlan(), status }
  if (status === "none") return plan
  Object.assign(plan, paid)
  if (status === "active") Object.assign(plan, { canShare: true, renewsAt: now + 30 * DAY })
  if (status === "past_due") Object.assign(plan, { canShare: true, paymentDueBy: now + 7 * DAY })
  if (status === "grace" || status === "read_only" || status === "expired")
    Object.assign(plan, {
      endsAt: now - DAY,
      graceEndsAt: status === "grace" ? now + 14 * DAY : now - DAY,
      retainUntil: now + 90 * DAY,
    })
  return plan
}

export function createFakeCloud(options: FakeCloudOptions = {}) {
  const apiUrl = options.apiUrl ?? "https://cloud.test"
  const now = options.now ?? Date.now
  const relayUrl = options.relayUrl ?? "https://relay.cloud.test"
  /** Device pub → account id. */
  const bound = new Map<string, string>()
  const devices = new Map<string, { name: string; linkedAt: number; lastSeenAt: number }>()
  const accounts = new Map<
    string,
    { id: string; email: string; createdAt: number; plan: CloudPlan; bytes: number; rooms: number }
  >()
  const requests = new Map<string, Request>()
  const checkouts = new Map<string, Checkout>()
  const nonces = new Set<string>()
  let seq = 0
  const log: { method: string; path: string; signed: boolean; body: unknown }[] = []
  const state = {
    offline: false,
    /** Answers to fail with, by `METHOD path` (once each). */
    failNext: new Map<string, { status: number; code: string }>(),
    /** Added to the server clock (stale-request tests). */
    skew: 0,
    limitBytes: 10_000_000_000,
  }

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "kimo-time": String(now() + state.skew),
        ...headers,
      },
    })
  const error = (status: number, code: string, headers: Record<string, string> = {}) =>
    json(status, { error: code, message: code.toLowerCase() }, headers)

  const accountOf = (pub: string) => {
    const id = bound.get(pub)
    return id ? (accounts.get(id) ?? null) : null
  }
  const deviceList = (accountId: string, self: string): CloudDevice[] =>
    [...bound.entries()]
      .filter(([, a]) => a === accountId)
      .map(([pub]) => {
        const d = devices.get(pub)
        return {
          pub,
          name: d?.name ?? "Device",
          linkedAt: d?.linkedAt ?? 0,
          lastSeenAt: d?.lastSeenAt ?? null,
          self: pub === self,
        }
      })
      .sort((a, b) => a.linkedAt - b.linkedAt)
  const accountBody = (pub: string): CloudAccount | null => {
    const a = accountOf(pub)
    if (!a) return null
    return {
      account: { id: a.id, email: a.email, createdAt: a.createdAt },
      plan: a.plan,
      usage: { bytes: a.bytes, rooms: a.rooms, limitBytes: state.limitBytes, reportedAt: now() },
      devices: deviceList(a.id, pub),
    }
  }
  const ensureAccount = (email: string) => {
    for (const a of accounts.values()) if (a.email === email) return a
    const a = {
      id: `acc_${++seq}`,
      email,
      createdAt: now(),
      plan: emptyPlan(),
      bytes: 0,
      rooms: 0,
    }
    accounts.set(a.id, a)
    return a
  }

  /** Verifies the four headers like §2.3; returns the pub or an error response. */
  const verify = async (req: globalThis.Request, path: string, body: Uint8Array) => {
    const pub = req.headers.get("kimo-pub")
    const iatText = req.headers.get("kimo-iat")
    const nonce = req.headers.get("kimo-nonce")
    const sig = req.headers.get("kimo-sig")
    if (!pub || !iatText || !nonce || !sig) return error(401, "AUTH_INVALID")
    const iat = Number(iatText)
    let ok = false
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        fromBase64Url(pub).slice(),
        { name: "Ed25519" },
        false,
        ["verify"],
      )
      const canonical = await canonicalRequest({
        aud: apiUrl,
        method: req.method,
        path,
        iat,
        nonce,
        pub,
        body,
      })
      ok = await crypto.subtle.verify(
        { name: "Ed25519" },
        key,
        fromBase64Url(sig).slice(),
        new TextEncoder().encode(`kimo/v1/cloud\0${canonical}`),
      )
    } catch {
      ok = false
    }
    if (!ok) return error(401, "AUTH_INVALID")
    if (Math.abs(now() + state.skew - iat) > 300_000) return error(422, "STALE_REQUEST")
    if (nonces.has(`${pub}:${nonce}`)) return error(409, "NONCE_REPLAY")
    nonces.add(`${pub}:${nonce}`)
    return pub
  }

  const handle = async (req: globalThis.Request): Promise<Response> => {
    if (state.offline) throw new TypeError("Failed to fetch")
    const url = new URL(req.url)
    const path = url.pathname + url.search
    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.length > 16 * 1024) return error(413, "TOO_LARGE")
    const body: Record<string, unknown> = bytes.length
      ? (JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>)
      : {}
    const signed = req.headers.has("kimo-sig")
    log.push({ method: req.method, path, signed, body: bytes.length ? body : null })
    const failure = state.failNext.get(`${req.method} ${url.pathname}`)
    if (failure) {
      state.failNext.delete(`${req.method} ${url.pathname}`)
      return error(failure.status, failure.code)
    }

    if (req.method === "GET" && path === "/v1/health") return json(200, { ok: true })
    if (req.method === "GET" && path === "/v1/plans")
      return json(200, {
        plans: [
          { interval: "month", amountCents: 800, currency: "usd" },
          { interval: "year", amountCents: 8000, currency: "usd" },
        ],
        storageLimitBytes: state.limitBytes,
        taxIncluded: false,
      })

    const who = await verify(req, path, bytes)
    if (who instanceof Response) return who
    const pub = who

    if (req.method === "POST" && path === "/v1/auth/start") {
      if (body.devicePub !== pub) return error(400, "BAD_REQUEST")
      if (bound.has(pub)) return error(409, "ALREADY_SIGNED_IN")
      const email = String(body.email ?? "")
        .trim()
        .toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return error(400, "BAD_REQUEST")
      for (const r of requests.values())
        if (r.pub === pub && r.status === "pending") r.status = "superseded"
      const r: Request = {
        id: `sir_${++seq}`,
        pub,
        email,
        name: String(body.deviceName ?? "Device"),
        expiresAt: now() + 15 * 60_000,
        status: "pending",
      }
      requests.set(r.id, r)
      return json(202, {
        requestId: r.id,
        email,
        expiresAt: r.expiresAt,
        resendAfter: now() + 60_000,
      })
    }
    if (req.method === "POST" && path === "/v1/auth/poll") {
      const r = requests.get(String(body.requestId))
      if (!r || r.pub !== pub) return error(404, "NOT_FOUND")
      if (r.status === "pending" && now() > r.expiresAt) r.status = "expired"
      if (r.status === "verified") {
        const account = accountBody(pub)
        return account ? json(200, { status: "verified", account }) : error(404, "NOT_FOUND")
      }
      return json(
        200,
        r.status === "pending"
          ? { status: "pending", expiresAt: r.expiresAt }
          : { status: r.status },
      )
    }

    // Bound routes.
    const account = accountOf(pub)
    if (!account) return error(401, "NOT_SIGNED_IN")
    const d = devices.get(pub)
    if (d) d.lastSeenAt = now()

    if (req.method === "POST" && path === "/v1/auth/sign-out") {
      bound.delete(pub)
      return json(200, {})
    }
    if (req.method === "GET" && path === "/v1/account") return json(200, accountBody(pub))
    if (req.method === "POST" && path === "/v1/devices/rename") {
      const target = String(body.pub)
      if (bound.get(target) !== account.id) return error(404, "NOT_FOUND")
      const name = String(body.name ?? "").trim()
      if (!name) return error(400, "BAD_REQUEST")
      const dev = devices.get(target)
      if (dev) dev.name = name
      return json(200, { devices: deviceList(account.id, pub) })
    }
    if (req.method === "POST" && path === "/v1/devices/sign-out") {
      const target = String(body.pub)
      if (bound.get(target) !== account.id) return error(404, "NOT_FOUND")
      bound.delete(target)
      return target === pub ? json(200, {}) : json(200, { devices: deviceList(account.id, pub) })
    }
    if (req.method === "POST" && path === "/v1/checkout") {
      const interval = body.interval
      if (interval !== "month" && interval !== "year") return error(400, "BAD_REQUEST")
      if (account.plan.status === "active") return error(409, "ALREADY_SUBSCRIBED")
      if (account.plan.status === "past_due") return error(409, "PAST_DUE")
      const c: Checkout = {
        id: `chk_${++seq}`,
        account: account.id,
        interval,
        status: "open",
        expiresAt: now() + 60 * 60_000,
      }
      checkouts.set(c.id, c)
      return json(201, {
        checkoutId: c.id,
        url: `https://sandbox.pay.test/checkout/${c.id}`,
        expiresAt: c.expiresAt,
      })
    }
    if (req.method === "GET" && url.pathname.startsWith("/v1/checkout/")) {
      const c = checkouts.get(decodeURIComponent(url.pathname.slice("/v1/checkout/".length)))
      if (!c || c.account !== account.id) return error(404, "NOT_FOUND")
      return json(200, { checkoutId: c.id, status: c.status, plan: account.plan })
    }
    if (req.method === "POST" && path === "/v1/billing/portal") {
      if (account.plan.status === "none") return error(402, "PLAN_REQUIRED")
      return json(201, {
        url: `https://sandbox.pay.test/portal/${account.id}`,
        expiresAt: now() + 3_600_000,
      })
    }
    if (req.method === "GET" && path === "/v1/relay")
      return json(200, { relayUrl, region: "eu", protocol: "kimo-mp/1" })
    return error(404, "NOT_FOUND")
  }

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init))) as typeof fetch

  return {
    apiUrl,
    relayUrl,
    fetch: fetchImpl,
    log,
    state,
    /** The person opens the newest link of `pub` (2D): binds the device. */
    verifyLink(pub?: string) {
      const pending = [...requests.values()].filter(
        (r) => r.status === "pending" && (pub === undefined || r.pub === pub),
      )
      const r = pending.at(-1)
      if (!r) return false
      const a = ensureAccount(r.email)
      bound.set(r.pub, a.id)
      devices.set(r.pub, { name: r.name, linkedAt: now(), lastSeenAt: now() })
      r.status = "verified"
      return true
    },
    expireLinks() {
      for (const r of requests.values()) if (r.status === "pending") r.status = "expired"
    },
    /** Binds `pub` to `email` at once (an already signed-in device). */
    signIn(pub: string, email: string, name = "Mac", linkedAt = now()) {
      const a = ensureAccount(email)
      bound.set(pub, a.id)
      devices.set(pub, { name, linkedAt, lastSeenAt: now() })
      return a.id
    },
    setPlan(email: string, status: PlanStatus, interval: BillingInterval = "month") {
      const a = ensureAccount(email)
      a.plan = planIn(status, now(), interval)
    },
    setUsage(email: string, bytes: number, rooms = 1) {
      const a = ensureAccount(email)
      a.bytes = bytes
      a.rooms = rooms
    },
    /** The provider reports the newest open checkout as paid (the plan turns active) or failed. */
    finishCheckout(outcome: "succeeded" | "failed" | "expired") {
      const c = [...checkouts.values()].filter((x) => x.status === "open").at(-1)
      if (!c) return false
      c.status = outcome
      const a = accounts.get(c.account)
      if (a && outcome === "succeeded") a.plan = planIn("active", now(), c.interval)
      return true
    },
    isBound: (pub: string) => bound.has(pub),
  }
}

export type FakeCloud = ReturnType<typeof createFakeCloud>
