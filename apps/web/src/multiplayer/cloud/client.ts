/**
 * The Kimo Cloud HTTP client (kimo-cloud docs/api.md): one signed request per call, stateless
 * apart from the clock offset a `422 STALE_REQUEST` teaches it (the sign-in and checkout deadlines
 * it returns are moved onto this device's clock by that offset). Errors are {@link CloudError}s
 * with the service's code; no answer at all (network down, timeout) is `OFFLINE`, which the app
 * shows as "Can't reach Kimo Cloud" and never as a plan error (board 43 6E).
 */
import { type DeviceKeyStore, devicePubOf } from "../device-key"
import { newNonce, signRequest } from "./sign"
import {
  type AuthPoll,
  type AuthStarted,
  type BillingInterval,
  type CheckoutCreated,
  type CheckoutStatus,
  type CheckoutStatusValue,
  type CloudAccount,
  type CloudDevice,
  CloudError,
  type CloudPlan,
  type CloudPlans,
  type CloudRelay,
  type CloudUsage,
  cloudErrorCode,
  type PlanStatus,
  type PortalLink,
} from "./types"

export interface CloudClientDeps {
  /** The API origin (`https://cloud.getkimo.design`); also the signature's `aud`. */
  apiUrl: string
  deviceKeys: DeviceKeyStore
  fetch?: typeof fetch
  now?: () => number
  /** Per request. Default 15 s. */
  timeoutMs?: number
}

export interface CloudClient {
  readonly apiUrl: string
  health(): Promise<boolean>
  plans(): Promise<CloudPlans>
  authStart(input: {
    email: string
    deviceName: string
    client: "web" | "desktop"
  }): Promise<AuthStarted>
  authPoll(requestId: string): Promise<AuthPoll>
  signOut(): Promise<void>
  account(): Promise<CloudAccount>
  renameDevice(pub: string, name: string): Promise<CloudDevice[]>
  signOutDevice(pub: string): Promise<CloudDevice[]>
  checkout(interval: BillingInterval): Promise<CheckoutCreated>
  checkoutStatus(checkoutId: string): Promise<CheckoutStatus>
  billingPortal(): Promise<PortalLink>
  relay(): Promise<CloudRelay>
}

const DEFAULT_TIMEOUT_MS = 15_000

export function createCloudClient(deps: CloudClientDeps): CloudClient {
  const apiUrl = deps.apiUrl.replace(/\/+$/, "")
  const doFetch = deps.fetch ?? ((input, init) => fetch(input, init))
  const now = deps.now ?? Date.now
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  /** Server time minus ours, learned from a stale-request answer. */
  let skew = 0
  /** A deadline the service gave (its clock) on this device's clock, where the store checks it. */
  const local = (serverTime: number) => serverTime - skew

  const send = async (
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; signed: boolean },
  ): Promise<{ status: number; json: unknown; headers: Headers }> => {
    const bytes =
      options.body === undefined
        ? new Uint8Array(0)
        : new TextEncoder().encode(JSON.stringify(options.body))
    const attempt = async () => {
      const headers: Record<string, string> = {}
      if (options.body !== undefined) headers["content-type"] = "application/json"
      if (options.signed) {
        const keys = await deps.deviceKeys.get()
        Object.assign(
          headers,
          await signRequest(keys.privateKey, {
            aud: apiUrl,
            method,
            path,
            iat: Math.round(now() + skew),
            nonce: newNonce(),
            pub: await devicePubOf(keys),
            body: bytes,
          }),
        )
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let res: Response
      try {
        res = await doFetch(`${apiUrl}${path}`, {
          method,
          headers,
          ...(options.body !== undefined ? { body: bytes.slice() } : {}),
          signal: controller.signal,
        })
      } catch (error) {
        throw new CloudError(
          "OFFLINE",
          controller.signal.aborted
            ? `no answer within ${timeoutMs / 1000} s`
            : error instanceof Error
              ? error.message
              : String(error),
        )
      } finally {
        clearTimeout(timer)
      }
      const text = await res.text().catch(() => "")
      let json: unknown = null
      if (text) {
        try {
          json = JSON.parse(text)
        } catch {
          json = null
        }
      }
      return { status: res.status, json, headers: res.headers }
    }

    let answer = await attempt()
    if (answer.status === 422 && codeOf(answer.json) === "STALE_REQUEST" && options.signed) {
      // Retry once with the server's clock (§2.3 step 4).
      const server = Number(answer.headers.get("kimo-time"))
      if (Number.isSafeInteger(server)) skew = server - now()
      answer = await attempt()
    }
    if (answer.status >= 200 && answer.status < 300) return answer
    const code = cloudErrorCode(codeOf(answer.json))
    const retry = Number(answer.headers.get("retry-after"))
    throw new CloudError(
      code === "UNKNOWN" && answer.status >= 500 ? "INTERNAL" : code,
      messageOf(answer.json) ?? `Kimo Cloud answered ${answer.status}`,
      answer.status,
      Number.isFinite(retry) && retry > 0 ? retry : null,
    )
  }

  const get = async <T>(path: string, parse: (v: unknown) => T, signed = true) =>
    parse((await send("GET", path, { signed })).json)
  const post = async <T>(path: string, body: unknown, parse: (v: unknown) => T, signed = true) =>
    parse((await send("POST", path, { body, signed })).json)

  return {
    apiUrl,
    health: async () => {
      try {
        return await get("/v1/health", (v) => obj(v).ok === true, false)
      } catch {
        return false
      }
    },
    plans: () => get("/v1/plans", parsePlans, false),
    async authStart(input) {
      const keys = await deps.deviceKeys.get()
      return post(
        "/v1/auth/start",
        {
          email: input.email,
          devicePub: await devicePubOf(keys),
          deviceName: input.deviceName,
          client: input.client,
        },
        parseAuthStarted,
      ).then((a) => ({ ...a, expiresAt: local(a.expiresAt), resendAfter: local(a.resendAfter) }))
    },
    authPoll: (requestId) =>
      post("/v1/auth/poll", { requestId }, parseAuthPoll).then((a) =>
        a.status === "pending" && a.expiresAt ? { ...a, expiresAt: local(a.expiresAt) } : a,
      ),
    signOut: async () => {
      await post("/v1/auth/sign-out", {}, () => undefined)
    },
    account: () => get("/v1/account", parseAccount),
    renameDevice: (pub, name) => post("/v1/devices/rename", { pub, name }, parseDevicesAnswer),
    signOutDevice: (pub) => post("/v1/devices/sign-out", { pub }, parseDevicesAnswer),
    checkout: (interval) =>
      post("/v1/checkout", { interval }, parseCheckout).then((c) => ({
        ...c,
        expiresAt: local(c.expiresAt),
      })),
    checkoutStatus: (checkoutId) =>
      get(`/v1/checkout/${encodeURIComponent(checkoutId)}`, parseCheckoutStatus),
    billingPortal: () => post("/v1/billing/portal", {}, parsePortal),
    relay: () => get("/v1/relay", parseRelay),
  }
}

// --- Parsing (lenient on extra fields, strict on what the app reads) --------------------------------

const codeOf = (v: unknown) =>
  typeof v === "object" && v !== null ? (v as { error?: unknown }).error : undefined
const messageOf = (v: unknown) => {
  const m = typeof v === "object" && v !== null ? (v as { message?: unknown }).message : undefined
  return typeof m === "string" ? m : null
}

function bad(what: string): never {
  throw new CloudError("BAD_RESPONSE", `Kimo Cloud sent an unexpected ${what}`)
}

function obj(v: unknown, what = "answer"): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) bad(what)
  return v as Record<string, unknown>
}
const str = (v: unknown, what: string) => (typeof v === "string" ? v : bad(what))
const num = (v: unknown, what: string) =>
  typeof v === "number" && Number.isFinite(v) ? v : bad(what)
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const strOrNull = (v: unknown) => (typeof v === "string" && v !== "" ? v : null)

const STATUSES: readonly PlanStatus[] = [
  "none",
  "active",
  "past_due",
  "grace",
  "read_only",
  "expired",
]

export function parsePlan(v: unknown): CloudPlan {
  const p = obj(v, "plan")
  const status = STATUSES.includes(p.status as PlanStatus) ? (p.status as PlanStatus) : bad("plan")
  const interval = p.interval === "month" || p.interval === "year" ? p.interval : null
  return {
    status,
    canShare: p.canShare === true,
    interval,
    amountCents: numOrNull(p.amountCents),
    currency: strOrNull(p.currency),
    renewsAt: numOrNull(p.renewsAt),
    cancelAtPeriodEnd: p.cancelAtPeriodEnd === true,
    endsAt: numOrNull(p.endsAt),
    paymentDueBy: numOrNull(p.paymentDueBy),
    graceEndsAt: numOrNull(p.graceEndsAt),
    retainUntil: numOrNull(p.retainUntil),
  }
}

function parseUsage(v: unknown): CloudUsage {
  const u = obj(v, "usage")
  return {
    bytes: numOrNull(u.bytes) ?? 0,
    rooms: numOrNull(u.rooms) ?? 0,
    limitBytes: num(u.limitBytes, "usage"),
    reportedAt: numOrNull(u.reportedAt),
  }
}

function parseDevice(v: unknown): CloudDevice {
  const d = obj(v, "device")
  return {
    pub: str(d.pub, "device"),
    name: str(d.name, "device"),
    linkedAt: num(d.linkedAt, "device"),
    lastSeenAt: numOrNull(d.lastSeenAt),
    self: d.self === true,
  }
}

const parseDevices = (v: unknown) => (Array.isArray(v) ? v.map(parseDevice) : bad("device list"))

export function parseAccount(v: unknown): CloudAccount {
  const a = obj(v, "account")
  const account = obj(a.account, "account")
  return {
    account: {
      id: str(account.id, "account"),
      email: str(account.email, "account"),
      createdAt: numOrNull(account.createdAt) ?? 0,
    },
    plan: parsePlan(a.plan),
    usage: parseUsage(a.usage),
    devices: parseDevices(a.devices),
  }
}

function parsePlans(v: unknown): CloudPlans {
  const p = obj(v, "plans")
  const plans = Array.isArray(p.plans)
    ? p.plans.flatMap((x) => {
        const o = obj(x, "plans")
        if (o.interval !== "month" && o.interval !== "year") return []
        return [
          {
            interval: o.interval as BillingInterval,
            amountCents: num(o.amountCents, "plans"),
            currency: str(o.currency, "plans"),
          },
        ]
      })
    : bad("plans")
  return {
    plans,
    storageLimitBytes: num(p.storageLimitBytes, "plans"),
    taxIncluded: p.taxIncluded === true,
  }
}

function parseAuthStarted(v: unknown): AuthStarted {
  const a = obj(v, "sign-in answer")
  return {
    requestId: str(a.requestId, "sign-in answer"),
    email: str(a.email, "sign-in answer"),
    expiresAt: num(a.expiresAt, "sign-in answer"),
    resendAfter: num(a.resendAfter, "sign-in answer"),
  }
}

function parseAuthPoll(v: unknown): AuthPoll {
  const a = obj(v, "sign-in status")
  switch (a.status) {
    case "pending":
      return { status: "pending", expiresAt: numOrNull(a.expiresAt) ?? 0 }
    case "verified":
      return { status: "verified", account: parseAccount(a.account) }
    case "expired":
      return { status: "expired" }
    case "superseded":
      return { status: "superseded" }
    default:
      return bad("sign-in status")
  }
}

function parseDevicesAnswer(v: unknown): CloudDevice[] {
  const a = obj(v, "devices")
  // Signing out this device answers `{}` (§4.2).
  return a.devices === undefined ? [] : parseDevices(a.devices)
}

function parseCheckout(v: unknown): CheckoutCreated {
  const c = obj(v, "checkout")
  return {
    checkoutId: str(c.checkoutId, "checkout"),
    url: httpsUrl(str(c.url, "checkout")),
    expiresAt: num(c.expiresAt, "checkout"),
  }
}

const CHECKOUT: readonly CheckoutStatusValue[] = [
  "open",
  "confirmed",
  "succeeded",
  "failed",
  "expired",
]

function parseCheckoutStatus(v: unknown): CheckoutStatus {
  const c = obj(v, "checkout")
  return {
    checkoutId: str(c.checkoutId, "checkout"),
    status: CHECKOUT.includes(c.status as CheckoutStatusValue)
      ? (c.status as CheckoutStatusValue)
      : bad("checkout"),
    plan: parsePlan(c.plan),
  }
}

function parsePortal(v: unknown): PortalLink {
  const p = obj(v, "portal")
  return { url: httpsUrl(str(p.url, "portal")), expiresAt: numOrNull(p.expiresAt) ?? 0 }
}

function parseRelay(v: unknown): CloudRelay {
  const r = obj(v, "relay")
  return {
    relayUrl: str(r.relayUrl, "relay"),
    region: typeof r.region === "string" ? r.region : "",
    protocol: typeof r.protocol === "string" ? r.protocol : "kimo-mp/1",
  }
}

/** Pages Kimo opens in the browser must be http(s): never `javascript:` or a custom scheme. */
function httpsUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.protocol === "https:" || url.protocol === "http:") return url.href
  } catch {
    // falls through
  }
  return bad("link")
}
