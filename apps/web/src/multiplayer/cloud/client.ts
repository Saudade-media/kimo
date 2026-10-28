/**
 * The Kimo Cloud HTTP client (kimo-cloud docs/api.md, workspaces §13 to §17): one signed request
 * per call, stateless
 * apart from the clock offset a `422 STALE_REQUEST` teaches it (the sign-in and checkout deadlines
 * it returns are moved onto this device's clock by that offset). Errors are {@link CloudError}s
 * with the service's code; no answer at all (network down, timeout) is `OFFLINE`, which the app
 * shows as "Can't reach Kimo Cloud" and never as a plan error (board 43 6E).
 */
import { normalizeRelayUrl } from "@kimo/sync/mp"
import { type DeviceKeyStore, devicePubOf } from "../device-key"
import { newNonce, signRequest } from "./sign"
import {
  type AccessRequest,
  type AccessRequestStatus,
  type AuthPoll,
  type AuthStarted,
  type BillingInterval,
  type CheckoutCreated,
  type CheckoutStatus,
  type CheckoutStatusValue,
  type ClosedFile,
  type CloudAccount,
  type CloudDevice,
  CloudError,
  type CloudFile,
  type CloudPlan,
  type CloudPlans,
  type CloudRelay,
  type CloudToken,
  type CloudUsage,
  cloudErrorCode,
  type FileList,
  type Invite,
  type InvitePeek,
  type Member,
  type MemberRole,
  type PlanStatus,
  type PortalLink,
  type Transfer,
  type ViewLink,
  type WorkspaceDetail,
  type WorkspaceRequest,
  type WorkspaceRole,
  type WorkspaceSummary,
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

  // Workspaces (§13) ------------------------------------------------------------------------------
  createWorkspace(name: string): Promise<WorkspaceSummary>
  workspace(ws: string): Promise<WorkspaceDetail>
  renameWorkspace(ws: string, name: string): Promise<WorkspaceSummary>
  workspaceCheckout(ws: string, interval: BillingInterval): Promise<CheckoutCreated>
  workspacePortal(ws: string): Promise<PortalLink>
  /** §13.6: asks an Admin (`to`, an account id) to take over as Owner. */
  requestTransfer(ws: string, to: string): Promise<Transfer>
  /** §13.7: the named Admin's checkout for the same seats; poll it with `checkoutStatus`. */
  acceptTransfer(ws: string, id: string): Promise<CheckoutCreated>
  declineTransfer(ws: string, id: string): Promise<void>
  cancelTransfer(ws: string, id: string): Promise<void>
  /** §13.10: `name` is what the Owner typed, compared exactly (`NAME_MISMATCH`). */
  deleteWorkspace(ws: string, name: string): Promise<void>

  // Members and invites (§14) -------------------------------------------------------------------
  invite(ws: string, email: string, role: MemberRole): Promise<Invite>
  cancelInvite(ws: string, id: string): Promise<void>
  /** §14.3, not signed: who invited whom to what. */
  peekInvite(token: string): Promise<InvitePeek>
  /** §14.4, signed; the device need not be bound (an unbound device may be signed in by it). */
  acceptInvite(input: {
    token: string
    deviceName: string
    client: "web" | "desktop"
  }): Promise<{ workspace: WorkspaceSummary; account: CloudAccount }>
  setMemberRole(ws: string, account: string, role: MemberRole): Promise<Member[]>
  /** §14.6: the view links the member had made, now ended. */
  removeMember(ws: string, account: string): Promise<ViewLink[]>
  /** §14.7: Admins and Editors; the Owner gets `OWNER_CANNOT_LEAVE`. */
  leaveWorkspace(ws: string): Promise<ViewLink[]>

  // Access requests (§15) -----------------------------------------------------------------------
  requestAccess(room: string): Promise<AccessRequest>
  accessRequest(id: string): Promise<AccessRequest>
  approveRequest(ws: string, id: string): Promise<Member[]>
  declineRequest(ws: string, id: string): Promise<void>

  // Files (§16) ------------------------------------------------------------------------------------
  files(ws: string): Promise<FileList>
  /**
   * §16.2. `replaces` (Owner only) re-shares a pre-workspace room; a repeat answers the existing
   * file with a fresh token and `created: false`.
   */
  addFile(
    ws: string,
    input: { name: string; origin?: string; replaces?: string | null },
  ): Promise<{ file: CloudFile; token: CloudToken; created: boolean }>
  renameFile(room: string, name: string): Promise<CloudFile>
  closeFile(room: string): Promise<void>

  // Tokens and view links (§17) ---------------------------------------------------------------
  /** §17.1: this device's token for the room; the role follows the workspace's plan. */
  roomToken(room: string, origin?: string): Promise<CloudToken>
  createLink(
    room: string,
    input: { expiresAt: number | null; label: string | null },
  ): Promise<{ link: ViewLink; token: CloudToken }>
  links(ws: string): Promise<ViewLink[]>
  revokeLink(room: string, jti: string): Promise<void>
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
  const done = () => undefined
  /** A path segment: ids from the service are opaque, so they are always encoded. */
  const seg = encodeURIComponent
  const ws = (id: string) => `/v1/workspaces/${seg(id)}`
  const room = (id: string) => `/v1/rooms/${seg(id)}`
  /** Tokens expire on the service's clock; the store schedules refreshes on this device's. */
  const localToken = (t: CloudToken): CloudToken =>
    t.expiresAt === null ? t : { ...t, expiresAt: local(t.expiresAt) }
  const localCheckout = (c: CheckoutCreated): CheckoutCreated => ({
    ...c,
    expiresAt: local(c.expiresAt),
  })

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

    createWorkspace: (name) =>
      post("/v1/workspaces", { name }, (v) => parseSummary(obj(v, "workspace").workspace)),
    workspace: (id) => get(ws(id), parseWorkspaceDetail),
    renameWorkspace: (id, name) =>
      post(`${ws(id)}/rename`, { name }, (v) => parseSummary(obj(v, "workspace").workspace)),
    workspaceCheckout: (id, interval) =>
      post(`${ws(id)}/checkout`, { interval }, parseCheckout).then(localCheckout),
    workspacePortal: (id) => post(`${ws(id)}/billing/portal`, {}, parsePortal),
    requestTransfer: (id, to) =>
      post(`${ws(id)}/transfers`, { to }, (v) => parseTransfer(obj(v, "transfer").transfer)),
    acceptTransfer: (id, transfer) =>
      post(`${ws(id)}/transfers/${seg(transfer)}/accept`, {}, parseCheckout).then(localCheckout),
    declineTransfer: (id, transfer) =>
      post(`${ws(id)}/transfers/${seg(transfer)}/decline`, {}, done),
    cancelTransfer: (id, transfer) => post(`${ws(id)}/transfers/${seg(transfer)}/cancel`, {}, done),
    deleteWorkspace: (id, name) => post(`${ws(id)}/delete`, { name }, done),

    invite: (id, email, role) =>
      post(`${ws(id)}/invites`, { email, role }, (v) => parseInvite(obj(v, "invite").invite)),
    cancelInvite: (id, invite) => post(`${ws(id)}/invites/${seg(invite)}/cancel`, {}, done),
    peekInvite: (token) => post("/v1/invites/peek", { token }, parseInvitePeek, false),
    async acceptInvite(input) {
      const keys = await deps.deviceKeys.get()
      return post(
        "/v1/invites/accept",
        {
          token: input.token,
          devicePub: await devicePubOf(keys),
          deviceName: input.deviceName,
          client: input.client,
        },
        (v) => {
          const a = obj(v, "invite answer")
          return { workspace: parseSummary(a.workspace), account: parseAccount(a.account) }
        },
      )
    },
    setMemberRole: (id, account, role) =>
      post(`${ws(id)}/members/${seg(account)}/role`, { role }, parseMembersAnswer),
    removeMember: (id, account) =>
      post(`${ws(id)}/members/${seg(account)}/remove`, {}, parseEndedLinks),
    leaveWorkspace: (id) => post(`${ws(id)}/leave`, {}, parseEndedLinks),

    requestAccess: (id) =>
      post(`${room(id)}/access-requests`, {}, (v) =>
        parseAccessRequest(obj(v, "access request").request),
      ),
    accessRequest: (id) =>
      get(`/v1/access-requests/${seg(id)}`, (v) =>
        parseAccessRequest(obj(v, "access request").request),
      ),
    approveRequest: (id, request) =>
      post(`${ws(id)}/requests/${seg(request)}/approve`, {}, parseMembersAnswer),
    declineRequest: (id, request) => post(`${ws(id)}/requests/${seg(request)}/decline`, {}, done),

    files: (id) => get(`${ws(id)}/files`, parseFileList),
    async addFile(id, input) {
      const answer = await send("POST", `${ws(id)}/files`, {
        body: {
          name: input.name,
          origin: input.origin ?? "user",
          ...(input.replaces ? { replaces: input.replaces } : {}),
        },
        signed: true,
      })
      const a = obj(answer.json, "file answer")
      return {
        file: parseFile(a.file),
        token: localToken(parseToken(a.token)),
        created: answer.status === 201,
      }
    },
    renameFile: (id, name) =>
      post(`${room(id)}/rename`, { name }, (v) => parseFile(obj(v, "file").file)),
    closeFile: (id) => post(`${room(id)}/close`, {}, done),

    roomToken: (id, origin = "user") =>
      post(`${room(id)}/token`, { origin }, parseToken).then(localToken),
    createLink: (id, input) =>
      post(
        `${room(id)}/links`,
        { expiresAt: input.expiresAt, label: input.label },
        (v) => {
          const a = obj(v, "link answer")
          return { link: parseLink(a.link), token: parseToken(a.token) }
        },
      ),
    links: (id) =>
      get(`${ws(id)}/links`, (v) => {
        const a = obj(v, "links")
        return Array.isArray(a.links) ? a.links.map(parseLink) : bad("links")
      }),
    revokeLink: (id, jti) => post(`${room(id)}/links/revoke`, { jti }, done),
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
    seats: numOrNull(p.seats),
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
    // Absent before workspaces (an older service): none yet.
    workspaces: Array.isArray(a.workspaces) ? a.workspaces.map(parseSummary) : [],
    accessRequests: Array.isArray(a.accessRequests)
      ? a.accessRequests.map(parseAccessRequest)
      : [],
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
            seatAmountCents: numOrNull(o.seatAmountCents),
            currency: str(o.currency, "plans"),
          },
        ]
      })
    : bad("plans")
  return {
    plans,
    storageLimitBytes: num(p.storageLimitBytes, "plans"),
    seatStorageBytes: numOrNull(p.seatStorageBytes) ?? 0,
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

// --- Workspaces --------------------------------------------------------------------------------

const ROLES: readonly WorkspaceRole[] = ["owner", "admin", "editor"]
const role = (v: unknown, what: string): WorkspaceRole =>
  ROLES.includes(v as WorkspaceRole) ? (v as WorkspaceRole) : bad(what)
const memberRole = (v: unknown, what: string): MemberRole =>
  v === "admin" || v === "editor" ? v : bad(what)
const interval = (v: unknown, what: string): BillingInterval =>
  v === "month" || v === "year" ? v : bad(what)

function parseTransfer(v: unknown): Transfer {
  const t = obj(v, "transfer")
  return {
    id: str(t.id, "transfer"),
    from: str(t.from, "transfer"),
    to: str(t.to, "transfer"),
    toAccount: str(t.toAccount, "transfer"),
    interval: interval(t.interval, "transfer"),
    seats: num(t.seats, "transfer"),
    amountCents: num(t.amountCents, "transfer"),
    currency: str(t.currency, "transfer"),
    createdAt: numOrNull(t.createdAt) ?? 0,
    expiresAt: num(t.expiresAt, "transfer"),
  }
}

export function parseSummary(v: unknown): WorkspaceSummary {
  const w = obj(v, "workspace")
  return {
    id: str(w.id, "workspace"),
    name: str(w.name, "workspace"),
    role: role(w.role, "workspace"),
    createdAt: numOrNull(w.createdAt) ?? 0,
    plan: parsePlan(w.plan),
    members: numOrNull(w.members) ?? 1,
    transfer: w.transfer === null || w.transfer === undefined ? null : parseTransfer(w.transfer),
    deletedAt: numOrNull(w.deletedAt),
  }
}

function parseMember(v: unknown): Member {
  const m = obj(v, "member")
  return {
    account: str(m.account, "member"),
    email: str(m.email, "member"),
    role: role(m.role, "member"),
    joinedAt: numOrNull(m.joinedAt) ?? 0,
    self: m.self === true,
  }
}

const parseMembers = (v: unknown) => (Array.isArray(v) ? v.map(parseMember) : bad("member list"))
const parseMembersAnswer = (v: unknown) => parseMembers(obj(v, "members").members)

function parseInvite(v: unknown): Invite {
  const i = obj(v, "invite")
  return {
    id: str(i.id, "invite"),
    email: str(i.email, "invite"),
    role: memberRole(i.role, "invite"),
    invitedBy: typeof i.invitedBy === "string" ? i.invitedBy : "",
    createdAt: numOrNull(i.createdAt) ?? 0,
    expiresAt: num(i.expiresAt, "invite"),
  }
}

function parseWorkspaceRequest(v: unknown): WorkspaceRequest {
  const r = obj(v, "request")
  return {
    id: str(r.id, "request"),
    email: str(r.email, "request"),
    room: str(r.room, "request"),
    createdAt: numOrNull(r.createdAt) ?? 0,
    expiresAt: num(r.expiresAt, "request"),
  }
}

const REQUEST_STATUSES: readonly AccessRequestStatus[] = [
  "pending",
  "approved",
  "declined",
  "expired",
]

function parseAccessRequest(v: unknown): AccessRequest {
  const r = obj(v, "access request")
  return {
    id: str(r.id, "access request"),
    workspaceName: typeof r.workspaceName === "string" ? r.workspaceName : "",
    room: str(r.room, "access request"),
    status: REQUEST_STATUSES.includes(r.status as AccessRequestStatus)
      ? (r.status as AccessRequestStatus)
      : bad("access request"),
    createdAt: numOrNull(r.createdAt) ?? 0,
    expiresAt: num(r.expiresAt, "access request"),
  }
}

function parseWorkspaceDetail(v: unknown): WorkspaceDetail {
  const d = obj(v, "workspace")
  const list = <T>(x: unknown, parse: (y: unknown) => T) => (Array.isArray(x) ? x.map(parse) : [])
  return {
    workspace: parseSummary(d.workspace),
    usage: parseUsage(d.usage),
    members: parseMembers(d.members),
    invites: list(d.invites, parseInvite),
    requests: list(d.requests, parseWorkspaceRequest),
  }
}

function parseInvitePeek(v: unknown): InvitePeek {
  const p = obj(v, "invite")
  return {
    workspaceName: str(p.workspaceName, "invite"),
    invitedBy: typeof p.invitedBy === "string" ? p.invitedBy : "",
    email: str(p.email, "invite"),
    role: memberRole(p.role, "invite"),
    expiresAt: num(p.expiresAt, "invite"),
  }
}

/** The relay base URL in its normalized form (spec §7), so it compares equal everywhere. */
function relayUrl(raw: string): string {
  try {
    return normalizeRelayUrl(raw)
  } catch {
    return bad("file")
  }
}

/** A base32 room id as the relay names rooms (32 characters). */
const ROOM_RE = /^[a-z2-7]{32}$/

function roomId(v: unknown, what: string): string {
  const id = str(v, what)
  return ROOM_RE.test(id) ? id : bad(what)
}

export function parseFile(v: unknown): CloudFile {
  const f = obj(v, "file")
  const roomKey = str(f.roomKey, "file")
  if (!/^[A-Za-z0-9_-]{43}$/.test(roomKey)) bad("file")
  return {
    room: roomId(f.room, "file"),
    name: str(f.name, "file"),
    relayUrl: relayUrl(str(f.relayUrl, "file")),
    roomKey,
    addedBy: typeof f.addedBy === "string" ? f.addedBy : "",
    createdAt: numOrNull(f.createdAt) ?? 0,
    updatedAt: numOrNull(f.updatedAt) ?? 0,
    replacedBy: typeof f.replacedBy === "string" ? roomId(f.replacedBy, "file") : null,
  }
}

function parseClosed(v: unknown): ClosedFile {
  const c = obj(v, "closed file")
  return {
    room: roomId(c.room, "closed file"),
    replacedBy: typeof c.replacedBy === "string" ? roomId(c.replacedBy, "closed file") : null,
    closedAt: numOrNull(c.closedAt) ?? 0,
  }
}

function parseFileList(v: unknown): FileList {
  const l = obj(v, "file list")
  return {
    files: Array.isArray(l.files) ? l.files.map(parseFile) : bad("file list"),
    closed: Array.isArray(l.closed) ? l.closed.map(parseClosed) : [],
  }
}

function parseToken(v: unknown): CloudToken {
  const t = obj(v, "token")
  return {
    token: str(t.token, "token"),
    role: t.role === "edit" ? "edit" : t.role === "view" ? "view" : bad("token"),
    expiresAt: numOrNull(t.expiresAt),
  }
}

function parseLink(v: unknown): ViewLink {
  const l = obj(v, "link")
  return {
    jti: str(l.jti, "link"),
    room: roomId(l.room, "link"),
    label: strOrNull(l.label),
    createdBy: typeof l.createdBy === "string" ? l.createdBy : "",
    createdAt: numOrNull(l.createdAt) ?? 0,
    expiresAt: numOrNull(l.expiresAt),
    ...(typeof l.fileName === "string" ? { fileName: l.fileName } : {}),
  }
}

const parseEndedLinks = (v: unknown): ViewLink[] => {
  const a = obj(v, "ended links")
  return Array.isArray(a.endedLinks) ? a.endedLinks.map(parseLink) : []
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
