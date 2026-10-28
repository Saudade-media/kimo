/**
 * A bounded, in-memory Kimo Cloud for tests and harnesses (not the service): `fetch` that answers
 * the public API of kimo-cloud docs/api.md with verified device signatures, nonces and stale-iat
 * checks, plus `script` hooks to move the account between board 43 states (verify a link, pay,
 * lapse, go offline) and workspaces between board 46 states (members, plans, closed files, a
 * deleted workspace). Every answer is one small JSON body; nothing streams or loops.
 *
 * Workspace files get real room keys and real capability tokens (minted with the file's link key,
 * as the service does), so a session can open them on a relay. Pass `relay` (for example
 * {@link relayRegistrar}) to register each new room on a real relay; without it rooms exist only
 * here.
 */
import {
  deriveRoomId,
  exportPublicKey,
  fromBase64Url,
  generateRoomKey,
  generateSigningKeyPair,
  mintToken,
  normalizeRelayUrl,
  parseRoomId,
  RelayHttpClient,
  randomBytes,
  signAdminCommand,
  signLinkCert,
  toBase64Url,
  toHex,
} from "@kimo/sync/mp"
import type { DeviceKeyStore } from "../device-key"
import { createOwnershipClient } from "../ownership"
import { canonicalRequest } from "./sign"
import type {
  BillingInterval,
  CheckoutStatusValue,
  CloudAccount,
  CloudDevice,
  CloudPlan,
  MemberRole,
  PlanStatus,
  Transfer,
  WorkspaceRole,
  WorkspaceSummary,
} from "./types"

/** The relay side of the service: what Kimo Cloud does there with each room's root key. */
export interface FakeCloudRelay {
  /** Admin op 1 with the service's owner proof: the room exists from then on. */
  register(room: FakeRoomKeys): Promise<void>
  /** Admin op 4: the room closes, every token of it ends. */
  close?(room: FakeRoomKeys): Promise<void>
  /** Admin op 2: one token ends. */
  revoke?(room: FakeRoomKeys, jti: string, exp: number): Promise<void>
}

export interface FakeRoomKeys {
  room: string
  relayUrl: string
  rootKeys: CryptoKeyPair
  linkKeys: CryptoKeyPair
  kid: number
}

export interface FakeCloudOptions {
  apiUrl?: string
  now?: () => number
  relayUrl?: string
  /** Where new rooms are registered (default: nowhere, the rooms exist only in this fake). */
  relay?: FakeCloudRelay
  /** Edit token lifetime (default 24 hours, `KIMO_CLOUD_EDIT_TOKEN_TTL_S`). */
  tokenTtlMs?: number
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
  /** A workspace checkout (§13.4); a transfer checkout also names its transfer (§13.7). */
  workspace?: string
  transfer?: string
}

interface FakeWorkspace {
  id: string
  name: string
  owner: string
  createdAt: number
  plan: CloudPlan
  deletedAt: number | null
  /** Account id → membership. Insertion order is join order. */
  members: Map<string, { role: WorkspaceRole; joinedAt: number }>
  bytes: number
}

interface FakeInvite {
  id: string
  workspace: string
  email: string
  role: MemberRole
  invitedBy: string
  createdAt: number
  expiresAt: number
  token: string
  status: "pending" | "accepted" | "cancelled"
}

interface FakeAccessRequest {
  id: string
  workspace: string
  account: string
  room: string
  createdAt: number
  expiresAt: number
  status: "pending" | "approved" | "declined" | "expired"
}

interface FakeTransfer {
  id: string
  workspace: string
  from: string
  to: string
  createdAt: number
  expiresAt: number
  status: "pending" | "completed" | "declined" | "cancelled"
}

interface FakeFile extends FakeRoomKeys {
  workspace: string
  name: string
  roomKey: Uint8Array
  addedBy: string
  createdAt: number
  updatedAt: number
  state: "active" | "closed"
  closedAt: number | null
  replaces: string | null
}

interface FakeToken {
  jti: string
  room: string
  workspace: string
  role: "edit" | "view"
  account: string
  pub: string
  /** Unix s, 0 never. */
  exp: number
  label: string | null
  createdAt: number
  revoked: boolean
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
    seats: null,
  }
}

/** A plan in `status` the way the service would report it at `now`. */
export function planIn(
  status: PlanStatus,
  now: number,
  interval: BillingInterval = "month",
  seats = 1,
) {
  const extra = Math.max(0, seats - 1)
  const paid = {
    interval,
    amountCents: interval === "month" ? 800 + 400 * extra : 8000 + 4000 * extra,
    currency: "usd",
    seats,
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

/** The token role a workspace's plan allows (§17.1); null for `none`. */
const tokenRoleFor = (status: PlanStatus): "edit" | "view" | null =>
  status === "none"
    ? null
    : status === "read_only" || status === "expired"
      ? "view"
      : "edit"

const ROLE_RANK: Record<WorkspaceRole, number> = { editor: 0, admin: 1, owner: 2 }

export function createFakeCloud(options: FakeCloudOptions = {}) {
  const apiUrl = options.apiUrl ?? "https://cloud.test"
  const now = options.now ?? Date.now
  const relayUrl = normalizeRelayUrl(options.relayUrl ?? "https://relay.cloud.test")
  const tokenTtlMs = options.tokenTtlMs ?? DAY
  /** Device pub → account id. */
  const bound = new Map<string, string>()
  const devices = new Map<string, { name: string; linkedAt: number; lastSeenAt: number }>()
  const accounts = new Map<
    string,
    { id: string; email: string; createdAt: number; plan: CloudPlan; bytes: number; rooms: number }
  >()
  const requests = new Map<string, Request>()
  const checkouts = new Map<string, Checkout>()
  const workspaces = new Map<string, FakeWorkspace>()
  const invites = new Map<string, FakeInvite>()
  const accessRequests = new Map<string, FakeAccessRequest>()
  const transfers = new Map<string, FakeTransfer>()
  const files = new Map<string, FakeFile>()
  const tokens = new Map<string, FakeToken>()
  const nonces = new Set<string>()
  let seq = 0
  const log: { method: string; path: string; signed: boolean; body: unknown; status: number }[] =
    []
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
  const emailOf = (accountId: string) => accounts.get(accountId)?.email ?? ""
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

  // --- Workspaces --------------------------------------------------------------------------------

  const transferOf = (w: FakeWorkspace) =>
    [...transfers.values()].find(
      (t) => t.workspace === w.id && t.status === "pending" && t.expiresAt > now(),
    ) ?? null
  const transferBody = (t: FakeTransfer): Transfer => {
    const w = workspaces.get(t.workspace)
    const seats = w?.members.size ?? 1
    const interval = w?.plan.interval ?? "month"
    return {
      id: t.id,
      from: emailOf(t.from),
      to: emailOf(t.to),
      toAccount: t.to,
      interval,
      seats,
      amountCents: planIn("active", now(), interval, seats).amountCents ?? 0,
      currency: "usd",
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
    }
  }
  const summary = (w: FakeWorkspace, accountId: string): WorkspaceSummary => {
    const t = transferOf(w)
    const plan = { ...w.plan, seats: w.plan.status === "none" ? null : w.members.size }
    return {
      id: w.id,
      name: w.name,
      role: w.members.get(accountId)?.role ?? "editor",
      createdAt: w.createdAt,
      plan,
      members: w.members.size,
      transfer: t && (t.from === accountId || t.to === accountId) ? transferBody(t) : null,
      deletedAt: w.deletedAt,
    }
  }
  const workspacesOf = (accountId: string) =>
    [...workspaces.values()]
      .filter((w) => w.members.has(accountId))
      .sort(
        (a, b) =>
          (a.members.get(accountId)?.joinedAt ?? 0) - (b.members.get(accountId)?.joinedAt ?? 0),
      )
  const usageOf = (w: FakeWorkspace) => ({
    bytes: w.bytes,
    rooms: [...files.values()].filter((f) => f.workspace === w.id && f.state === "active").length,
    limitBytes: state.limitBytes + Math.max(0, w.members.size - 1) * 5_000_000_000,
    reportedAt: now(),
  })

  const accountBody = (pub: string): CloudAccount | null => {
    const a = accountOf(pub)
    if (!a) return null
    return {
      account: { id: a.id, email: a.email, createdAt: a.createdAt },
      plan: a.plan,
      usage: { bytes: a.bytes, rooms: a.rooms, limitBytes: state.limitBytes, reportedAt: now() },
      devices: deviceList(a.id, pub),
      workspaces: workspacesOf(a.id).map((w) => summary(w, a.id)),
      accessRequests: [...accessRequests.values()]
        .filter((r) => r.account === a.id)
        .map((r) => accessRequestBody(r)),
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
  const accessRequestBody = (r: FakeAccessRequest) => {
    if (r.status === "pending" && r.expiresAt <= now()) r.status = "expired"
    return {
      id: r.id,
      workspaceName: workspaces.get(r.workspace)?.name ?? "",
      room: r.room,
      status: r.status,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
    }
  }

  const newWorkspace = (ownerId: string, name: string, status: PlanStatus = "none") => {
    const w: FakeWorkspace = {
      id: `ws_${++seq}`,
      name,
      owner: ownerId,
      createdAt: now(),
      plan: planIn(status, now()),
      deletedAt: null,
      members: new Map([[ownerId, { role: "owner", joinedAt: now() }]]),
      bytes: 0,
    }
    workspaces.set(w.id, w)
    return w
  }
  const join = (w: FakeWorkspace, accountId: string, role: WorkspaceRole) => {
    if (!w.members.has(accountId)) w.members.set(accountId, { role, joinedAt: now() })
  }
  /** Ends a member's tokens (their edit tokens and the view links they made, §5.2 step 2). */
  const revokeMember = async (w: FakeWorkspace, accountId: string) => {
    const ended: FakeToken[] = []
    for (const t of tokens.values())
      if (t.workspace === w.id && t.account === accountId && !t.revoked) {
        if (t.exp !== 0 && t.exp * 1000 <= now()) continue
        t.revoked = true
        ended.push(t)
        const f = files.get(t.room)
        if (f && f.state === "active") await options.relay?.revoke?.(f, t.jti, t.exp)
      }
    for (const t of transfers.values())
      if (t.workspace === w.id && t.status === "pending" && t.to === accountId)
        t.status = "cancelled"
    return ended.filter((t) => t.role === "view").map(linkBody)
  }
  const closeFile = async (f: FakeFile) => {
    if (f.state === "closed") return
    f.state = "closed"
    f.closedAt = now()
    for (const t of tokens.values()) if (t.room === f.room) t.revoked = true
    await options.relay?.close?.(f)
  }

  const fileBody = (f: FakeFile) => ({
    room: f.room,
    name: f.name,
    relayUrl: f.relayUrl,
    roomKey: toBase64Url(f.roomKey),
    addedBy: emailOf(f.addedBy),
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    replacedBy: null,
  })
  const linkBody = (t: FakeToken) => ({
    jti: t.jti,
    room: t.room,
    label: t.label,
    createdBy: emailOf(t.account),
    createdAt: t.createdAt,
    expiresAt: t.exp === 0 ? null : t.exp * 1000,
    fileName: files.get(t.room)?.name ?? "",
  })

  /** Signs a token with the file's link key, as the service does (§2.5). */
  const issue = async (
    f: FakeFile,
    input: {
      role: "edit" | "view"
      account: string
      pub: string
      origin?: string
      expiresAt: number | null
      label?: string | null
    },
  ) => {
    const jti = randomBytes(16)
    const iat = Math.floor(now() / 1000)
    const exp = input.expiresAt === null ? 0 : Math.floor(input.expiresAt / 1000)
    const token = await mintToken(f.linkKeys.privateKey, {
      room: parseRoomId(f.room),
      role: input.role,
      kid: f.kid,
      iat,
      exp,
      jti,
      origin: (input.origin ?? "user") as "user",
    })
    tokens.set(toHex(jti), {
      jti: toHex(jti),
      room: f.room,
      workspace: f.workspace,
      role: input.role,
      account: input.account,
      pub: input.pub,
      exp,
      label: input.label ?? null,
      createdAt: now(),
      revoked: false,
    })
    return {
      jti: toHex(jti),
      body: { token, role: input.role, expiresAt: exp === 0 ? null : exp * 1000 },
    }
  }

  const createRoom = async (w: FakeWorkspace, name: string, addedBy: string) => {
    const rootKeys = await generateSigningKeyPair(false)
    const linkKeys = await generateSigningKeyPair(false)
    const room = (await deriveRoomId(await exportPublicKey(rootKeys.publicKey))).id
    const f: FakeFile = {
      room,
      relayUrl,
      rootKeys,
      linkKeys,
      kid: 1,
      workspace: w.id,
      name,
      roomKey: generateRoomKey(),
      addedBy,
      createdAt: now(),
      updatedAt: now(),
      state: "active",
      closedAt: null,
      replaces: null,
    }
    await options.relay?.register(f)
    files.set(room, f)
    return f
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

  const inviteByToken = (token: unknown) =>
    [...invites.values()].find((i) => typeof token === "string" && i.token === token) ?? null
  const inviteError = (i: FakeInvite | null) => {
    if (!i || i.status !== "pending") return error(410, "INVITE_USED")
    if (i.expiresAt <= now()) return error(410, "INVITE_EXPIRED")
    return null
  }

  /** §13 to §17 for a bound device; null when no workspace route matched. */
  const workspaceRoute = async (
    req: globalThis.Request,
    pathname: string,
    body: Record<string, unknown>,
    accountId: string,
    pub: string,
  ): Promise<Response | null> => {
    const post = req.method === "POST"
    if (post && pathname === "/v1/workspaces") {
      const name = String(body.name ?? "").trim()
      if (!name) return error(400, "BAD_REQUEST")
      return json(201, { workspace: summary(newWorkspace(accountId, name), accountId) })
    }
    let m = /^\/v1\/workspaces\/([^/]+)(\/.*)?$/.exec(pathname)
    if (m) {
      const w = workspaces.get(decodeURIComponent(m[1] ?? ""))
      const rest = m[2] ?? ""
      const me = w?.members.get(accountId)
      if (!w || !me) return error(404, "NOT_FOUND")
      if (w.deletedAt !== null) return error(410, "WORKSPACE_DELETED")
      const atLeast = (r: WorkspaceRole) => ROLE_RANK[me.role] >= ROLE_RANK[r]
      const forbidden = () => error(403, "ROLE_REQUIRED")
      if (req.method === "GET" && rest === "") {
        const admin = atLeast("admin")
        return json(200, {
          workspace: summary(w, accountId),
          usage: usageOf(w),
          members: [...w.members.entries()].map(([account, x]) => ({
            account,
            email: emailOf(account),
            role: x.role,
            joinedAt: x.joinedAt,
            self: account === accountId,
          })),
          invites: admin
            ? [...invites.values()]
                .filter(
                  (i) => i.workspace === w.id && i.status === "pending" && i.expiresAt > now(),
                )
                .map(({ token: _t, status: _s, workspace: _w, ...i }) => i)
            : [],
          requests: admin
            ? [...accessRequests.values()]
                .filter((r) => r.workspace === w.id && r.status === "pending")
                .map((r) => ({
                  id: r.id,
                  email: emailOf(r.account),
                  room: r.room,
                  createdAt: r.createdAt,
                  expiresAt: r.expiresAt,
                }))
            : [],
        })
      }
      const members = () =>
        json(200, {
          members: [...w.members.entries()].map(([account, x]) => ({
            account,
            email: emailOf(account),
            role: x.role,
            joinedAt: x.joinedAt,
            self: account === accountId,
          })),
        })
      if (post && rest === "/rename") {
        if (!atLeast("admin")) return forbidden()
        const name = String(body.name ?? "").trim()
        if (!name) return error(400, "BAD_REQUEST")
        w.name = name
        return json(200, { workspace: summary(w, accountId) })
      }
      if (post && rest === "/checkout") {
        if (me.role !== "owner") return forbidden()
        const interval = body.interval
        if (interval !== "month" && interval !== "year") return error(400, "BAD_REQUEST")
        if (w.plan.status === "active") return error(409, "ALREADY_SUBSCRIBED")
        if (w.plan.status === "past_due") return error(409, "PAST_DUE")
        return checkoutAnswer({ account: accountId, interval, workspace: w.id })
      }
      if (post && rest === "/billing/portal") {
        if (me.role !== "owner") return forbidden()
        if (w.plan.status === "none") return error(402, "PLAN_REQUIRED")
        return json(201, { url: `https://sandbox.pay.test/portal/${w.id}`, expiresAt: now() + 3e6 })
      }
      if (post && rest === "/transfers") {
        if (me.role !== "owner") return forbidden()
        const to = String(body.to ?? "")
        if (w.members.get(to)?.role !== "admin") return error(409, "NOT_ADMIN")
        if (w.plan.status === "past_due") return error(409, "PAST_DUE")
        if (w.plan.status !== "active") return error(402, "PLAN_REQUIRED")
        for (const t of transfers.values())
          if (t.workspace === w.id && t.status === "pending") t.status = "cancelled"
        const t: FakeTransfer = {
          id: `trf_${++seq}`,
          workspace: w.id,
          from: accountId,
          to,
          createdAt: now(),
          expiresAt: now() + 7 * DAY,
          status: "pending",
        }
        transfers.set(t.id, t)
        return json(201, { transfer: transferBody(t) })
      }
      m = /^\/transfers\/([^/]+)\/(accept|decline|cancel)$/.exec(rest)
      if (post && m) {
        const t = transfers.get(decodeURIComponent(m[1] ?? ""))
        if (!t || t.workspace !== w.id) return error(404, "NOT_FOUND")
        const action = m[2]
        if (action === "cancel" ? t.from !== accountId : t.to !== accountId)
          return error(404, "NOT_FOUND")
        if (t.status !== "pending" || t.expiresAt <= now()) return error(410, "TRANSFER_CLOSED")
        if (action === "decline") t.status = "declined"
        if (action === "cancel") t.status = "cancelled"
        if (action !== "accept") return json(200, {})
        if (me.role !== "admin") return forbidden()
        if (w.plan.status === "past_due") return error(409, "PAST_DUE")
        if (w.plan.status !== "active") return error(402, "PLAN_REQUIRED")
        return checkoutAnswer({
          account: accountId,
          interval: w.plan.interval ?? "month",
          workspace: w.id,
          transfer: t.id,
        })
      }
      if (post && rest === "/delete") {
        if (me.role !== "owner") return forbidden()
        if (body.name !== w.name) return error(400, "NAME_MISMATCH")
        await deleteWorkspace(w, accountId)
        return json(200, {})
      }
      if (post && rest === "/invites") {
        if (!atLeast("admin")) return forbidden()
        const email = String(body.email ?? "")
          .trim()
          .toLowerCase()
        const role = body.role
        if (!email.includes("@") || (role !== "admin" && role !== "editor"))
          return error(400, "BAD_REQUEST")
        if ([...w.members.keys()].some((a) => emailOf(a) === email))
          return error(409, "ALREADY_MEMBER")
        if (w.plan.status !== "active" && w.plan.status !== "past_due")
          return error(402, "PLAN_REQUIRED")
        for (const i of invites.values())
          if (i.workspace === w.id && i.email === email && i.status === "pending")
            i.status = "cancelled"
        const invite: FakeInvite = {
          id: `inv_${++seq}`,
          workspace: w.id,
          email,
          role,
          invitedBy: emailOf(accountId),
          createdAt: now(),
          expiresAt: now() + 7 * DAY,
          token: toBase64Url(randomBytes(32)),
          status: "pending",
        }
        invites.set(invite.id, invite)
        const { token: _t, status: _s, workspace: _w, ...shown } = invite
        return json(201, { invite: shown })
      }
      m = /^\/invites\/([^/]+)\/cancel$/.exec(rest)
      if (post && m) {
        if (!atLeast("admin")) return forbidden()
        const i = invites.get(decodeURIComponent(m[1] ?? ""))
        if (!i || i.workspace !== w.id || i.status !== "pending") return error(404, "NOT_FOUND")
        i.status = "cancelled"
        return json(200, {})
      }
      m = /^\/members\/([^/]+)\/(role|remove)$/.exec(rest)
      if (post && m) {
        if (!atLeast("admin")) return forbidden()
        const target = decodeURIComponent(m[1] ?? "")
        const member = w.members.get(target)
        if (!member) return error(404, "NOT_FOUND")
        if (member.role === "owner") return forbidden()
        if (m[2] === "role") {
          if (body.role !== "admin" && body.role !== "editor") return error(400, "BAD_REQUEST")
          member.role = body.role
          if (body.role === "editor")
            for (const t of transfers.values())
              if (t.workspace === w.id && t.status === "pending" && t.to === target)
                t.status = "cancelled"
          return members()
        }
        if (target === accountId) return forbidden()
        w.members.delete(target)
        return json(200, { endedLinks: await revokeMember(w, target) })
      }
      if (post && rest === "/leave") {
        if (me.role === "owner") return error(409, "OWNER_CANNOT_LEAVE")
        w.members.delete(accountId)
        return json(200, { endedLinks: await revokeMember(w, accountId) })
      }
      m = /^\/requests\/([^/]+)\/(approve|decline)$/.exec(rest)
      if (post && m) {
        if (!atLeast("admin")) return forbidden()
        const r = accessRequests.get(decodeURIComponent(m[1] ?? ""))
        if (!r || r.workspace !== w.id) return error(404, "NOT_FOUND")
        if (r.status !== "pending" || r.expiresAt <= now()) return error(410, "REQUEST_CLOSED")
        if (m[2] === "decline") {
          r.status = "declined"
          return json(200, {})
        }
        if (w.plan.status === "past_due") return error(409, "PAST_DUE")
        if (w.plan.status !== "active") return error(402, "PLAN_REQUIRED")
        r.status = "approved"
        join(w, r.account, "editor")
        return members()
      }
      if (req.method === "GET" && rest === "/files") {
        if (w.plan.status === "none") return json(200, { files: [], closed: [] })
        const mine = [...files.values()].filter((f) => f.workspace === w.id)
        const recent = (at: number | null) => at !== null && at > now() - 30 * DAY
        return json(200, {
          files: mine.filter((f) => f.state === "active").map(fileBody),
          closed: [
            ...mine
              .filter((f) => f.state === "closed" && recent(f.closedAt))
              .map((f) => ({ room: f.room, replacedBy: null, closedAt: f.closedAt })),
            ...mine
              .filter((f) => f.state === "active" && f.replaces !== null && recent(f.createdAt))
              .map((f) => ({ room: f.replaces, replacedBy: f.room, closedAt: f.createdAt })),
          ],
        })
      }
      if (post && rest === "/files") {
        const name = String(body.name ?? "").trim()
        const replaces = typeof body.replaces === "string" ? body.replaces : null
        if (!name) return error(400, "BAD_REQUEST")
        if (replaces !== null) {
          if (me.role !== "owner") return forbidden()
          if (!/^[a-z2-7]{32}$/.test(replaces) || files.has(replaces))
            return error(400, "BAD_REQUEST")
        }
        if (w.plan.status !== "active" && w.plan.status !== "past_due")
          return error(402, "PLAN_REQUIRED")
        const repeat =
          replaces === null
            ? null
            : ([...files.values()].find(
                (f) => f.workspace === w.id && f.replaces === replaces && f.state === "active",
              ) ?? null)
        const f = repeat ?? (await createRoom(w, name, accountId))
        if (!repeat) f.replaces = replaces
        const token = await issue(f, {
          role: "edit",
          account: accountId,
          pub,
          expiresAt: now() + tokenTtlMs,
          origin: typeof body.origin === "string" ? body.origin : "user",
        })
        return json(repeat ? 200 : 201, { file: fileBody(f), token: token.body })
      }
      if (req.method === "GET" && rest === "/links") {
        const admin = atLeast("admin")
        return json(200, {
          links: [...tokens.values()]
            .filter(
              (t) =>
                t.workspace === w.id &&
                t.role === "view" &&
                !t.revoked &&
                (t.exp === 0 || t.exp * 1000 > now()) &&
                files.get(t.room)?.state === "active" &&
                (admin || t.account === accountId),
            )
            .map(linkBody),
        })
      }
      return error(404, "NOT_FOUND")
    }

    m = /^\/v1\/rooms\/([^/]+)\/(.+)$/.exec(pathname)
    if (m) {
      const f = files.get(decodeURIComponent(m[1] ?? ""))
      const action = m[2]
      if (!f) return error(404, "NOT_FOUND")
      const w = workspaces.get(f.workspace)
      if (!w) return error(404, "NOT_FOUND")
      const me = w.members.get(accountId)
      if (post && action === "access-requests") {
        if (f.state !== "active" || w.deletedAt !== null) return error(404, "NOT_FOUND")
        if (me) return error(409, "ALREADY_MEMBER")
        const open = [...accessRequests.values()].find(
          (r) => r.workspace === w.id && r.account === accountId && r.status === "pending",
        )
        if (open) return json(200, { request: accessRequestBody(open) })
        const r: FakeAccessRequest = {
          id: `req_${++seq}`,
          workspace: w.id,
          account: accountId,
          room: f.room,
          createdAt: now(),
          expiresAt: now() + 7 * DAY,
          status: "pending",
        }
        accessRequests.set(r.id, r)
        return json(201, { request: accessRequestBody(r) })
      }
      if (w.deletedAt !== null) return error(410, "WORKSPACE_DELETED")
      if (!me) return error(403, "NOT_MEMBER")
      if (f.state !== "active") return error(410, "ROOM_CLOSED")
      if (post && action === "token") {
        const role = tokenRoleFor(w.plan.status)
        if (!role) return error(402, "PLAN_REQUIRED")
        const token = await issue(f, {
          role,
          account: accountId,
          pub,
          expiresAt: now() + tokenTtlMs,
          origin: typeof body.origin === "string" ? body.origin : "user",
        })
        return json(200, token.body)
      }
      if (post && action === "links") {
        if (w.plan.status === "none") return error(402, "PLAN_REQUIRED")
        const expiresAt = typeof body.expiresAt === "number" ? body.expiresAt : null
        if (expiresAt !== null && expiresAt <= now()) return error(400, "BAD_REQUEST")
        const label = typeof body.label === "string" ? body.label : null
        const token = await issue(f, { role: "view", account: accountId, pub, expiresAt, label })
        const t = tokens.get(token.jti) as FakeToken
        return json(201, { link: linkBody(t), token: token.body })
      }
      if (post && action === "links/revoke") {
        const t = tokens.get(String(body.jti ?? ""))
        if (!t || t.room !== f.room || t.role !== "view") return error(404, "NOT_FOUND")
        if (t.account !== accountId && ROLE_RANK[me.role] < ROLE_RANK.admin)
          return error(403, "ROLE_REQUIRED")
        t.revoked = true
        await options.relay?.revoke?.(f, t.jti, t.exp)
        return json(200, {})
      }
      if (post && action === "rename") {
        const name = String(body.name ?? "").trim()
        if (!name) return error(400, "BAD_REQUEST")
        f.name = name
        f.updatedAt = now()
        return json(200, { file: fileBody(f) })
      }
      if (post && action === "close") {
        if (ROLE_RANK[me.role] < ROLE_RANK.admin) return error(403, "ROLE_REQUIRED")
        await closeFile(f)
        return json(200, {})
      }
      return error(404, "NOT_FOUND")
    }

    m = /^\/v1\/access-requests\/([^/]+)$/.exec(pathname)
    if (req.method === "GET" && m) {
      const r = accessRequests.get(decodeURIComponent(m[1] ?? ""))
      if (!r || r.account !== accountId) return error(404, "NOT_FOUND")
      return json(200, { request: accessRequestBody(r) })
    }
    return null
  }

  const checkoutAnswer = (input: Omit<Checkout, "id" | "status" | "expiresAt">) => {
    const c: Checkout = {
      id: `chk_${++seq}`,
      status: "open",
      expiresAt: now() + 60 * 60_000,
      ...input,
    }
    checkouts.set(c.id, c)
    return json(201, {
      checkoutId: c.id,
      url: `https://sandbox.pay.test/checkout/${c.id}`,
      expiresAt: c.expiresAt,
    })
  }

  const deleteWorkspace = async (w: FakeWorkspace, by: string) => {
    void by
    w.deletedAt = now()
    for (const f of files.values()) if (f.workspace === w.id) await closeFile(f)
    for (const t of tokens.values()) if (t.workspace === w.id) t.revoked = true
    for (const i of invites.values())
      if (i.workspace === w.id && i.status === "pending") i.status = "cancelled"
    for (const r of accessRequests.values())
      if (r.workspace === w.id && r.status === "pending") r.status = "declined"
    for (const t of transfers.values())
      if (t.workspace === w.id && t.status === "pending") t.status = "cancelled"
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
    const entry = {
      method: req.method,
      path,
      signed,
      body: bytes.length ? (body as unknown) : null,
      status: 0,
    }
    log.push(entry)
    const answer = await route(req, url, path, bytes, body)
    entry.status = answer.status
    return answer
  }

  const route = async (
    req: globalThis.Request,
    url: URL,
    path: string,
    bytes: Uint8Array,
    body: Record<string, unknown>,
  ): Promise<Response> => {
    const failure = state.failNext.get(`${req.method} ${url.pathname}`)
    if (failure) {
      state.failNext.delete(`${req.method} ${url.pathname}`)
      return error(failure.status, failure.code)
    }

    if (req.method === "GET" && path === "/v1/health") return json(200, { ok: true })
    if (req.method === "GET" && path === "/v1/plans")
      return json(200, {
        plans: [
          { interval: "month", amountCents: 800, seatAmountCents: 400, currency: "usd" },
          { interval: "year", amountCents: 8000, seatAmountCents: 4000, currency: "usd" },
        ],
        storageLimitBytes: state.limitBytes,
        seatStorageBytes: 5_000_000_000,
        taxIncluded: false,
      })
    if (req.method === "POST" && path === "/v1/invites/peek") {
      const i = inviteByToken(body.token)
      const refused = inviteError(i)
      if (refused || !i) return refused ?? error(410, "INVITE_USED")
      return json(200, {
        workspaceName: workspaces.get(i.workspace)?.name ?? "",
        invitedBy: i.invitedBy,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt,
      })
    }

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
    if (req.method === "POST" && path === "/v1/invites/accept") {
      if (body.devicePub !== pub) return error(400, "BAD_REQUEST")
      const i = inviteByToken(body.token)
      const refused = inviteError(i)
      if (refused || !i) return refused ?? error(410, "INVITE_USED")
      const w = workspaces.get(i.workspace)
      if (!w || w.deletedAt !== null) return error(410, "INVITE_USED")
      let accountId = bound.get(pub) ?? null
      if (accountId !== null && emailOf(accountId) !== i.email)
        return error(403, "INVITE_EMAIL_MISMATCH")
      if (accountId === null) {
        if ([...accounts.values()].some((a) => a.email === i.email))
          return error(401, "NOT_SIGNED_IN")
        accountId = ensureAccount(i.email).id
        bound.set(pub, accountId)
        devices.set(pub, {
          name: String(body.deviceName ?? "Device"),
          linkedAt: now(),
          lastSeenAt: now(),
        })
      }
      if (!w.members.has(accountId)) {
        if (w.plan.status === "past_due") return error(409, "PAST_DUE")
        if (w.plan.status !== "active") return error(402, "PLAN_REQUIRED")
        join(w, accountId, i.role)
      }
      i.status = "accepted"
      return json(200, { workspace: summary(w, accountId), account: accountBody(pub) })
    }

    // Bound routes.
    const account = accountOf(pub)
    if (!account) return error(401, "NOT_SIGNED_IN")
    const d = devices.get(pub)
    if (d) d.lastSeenAt = now()

    if (req.method === "POST" && path === "/v1/auth/sign-out") {
      bound.delete(pub)
      for (const t of tokens.values()) if (t.pub === pub && t.role === "edit") t.revoked = true
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
      return checkoutAnswer({ account: account.id, interval })
    }
    if (req.method === "GET" && url.pathname.startsWith("/v1/checkout/")) {
      const c = checkouts.get(decodeURIComponent(url.pathname.slice("/v1/checkout/".length)))
      if (!c || c.account !== account.id) return error(404, "NOT_FOUND")
      const w = c.workspace ? workspaces.get(c.workspace) : undefined
      return json(200, { checkoutId: c.id, status: c.status, plan: w ? w.plan : account.plan })
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
    const routed = await workspaceRoute(req, url.pathname, body, account.id, pub)
    return routed ?? error(404, "NOT_FOUND")
  }

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init))) as typeof fetch

  const workspaceNamed = (id: string) => {
    const w = workspaces.get(id)
    if (!w) throw new Error(`fake cloud: no workspace ${id}`)
    return w
  }

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
    /** The account id for `email` (created when new). */
    accountId: (email: string) => ensureAccount(email).id,
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
      if (outcome !== "succeeded") return true
      const w = c.workspace ? workspaces.get(c.workspace) : undefined
      if (!w) {
        const a = accounts.get(c.account)
        if (a) a.plan = planIn("active", now(), c.interval)
        return true
      }
      const t = c.transfer ? transfers.get(c.transfer) : undefined
      if (t) {
        // §5.2 step 3: the roles swap only while the transfer still holds.
        if (t.status !== "pending" || w.members.get(t.to)?.role !== "admin") return true
        const from = w.members.get(t.from)
        const to = w.members.get(t.to)
        if (from) from.role = "admin"
        if (to) to.role = "owner"
        w.owner = t.to
        t.status = "completed"
      }
      w.plan = planIn("active", now(), c.interval, w.members.size)
      return true
    },
    isBound: (pub: string) => bound.has(pub),

    // Workspaces (board 46) ------------------------------------------------------------------
    /** A workspace owned by `email` (created when new) with a plan in `status`. */
    addWorkspace(email: string, name = "Studio", status: PlanStatus = "active") {
      const w = newWorkspace(ensureAccount(email).id, name)
      w.plan = planIn(status, now())
      return w.id
    },
    addMember(ws: string, email: string, role: WorkspaceRole = "editor") {
      join(workspaceNamed(ws), ensureAccount(email).id, role)
    },
    setWorkspacePlan(ws: string, status: PlanStatus) {
      const w = workspaceNamed(ws)
      w.plan = planIn(status, now(), w.plan.interval ?? "month", w.members.size)
    },
    async removeMember(ws: string, email: string) {
      const w = workspaceNamed(ws)
      const id = ensureAccount(email).id
      w.members.delete(id)
      await revokeMember(w, id)
    },
    async deleteWorkspace(ws: string) {
      const w = workspaceNamed(ws)
      await deleteWorkspace(w, w.owner)
    },
    async closeFile(room: string) {
      const f = files.get(room)
      if (f) await closeFile(f)
    },
    /** The raw token of the newest pending invite for `email` (what the email link carries). */
    inviteToken(email: string) {
      return (
        [...invites.values()].filter((i) => i.email === email && i.status === "pending").at(-1)
          ?.token ?? null
      )
    },
    /** The file a room belongs to, with its keys (tests open the room as the service would). */
    file: (room: string) => files.get(room) ?? null,
    files: () => [...files.values()],
    workspace: (ws: string) => workspaces.get(ws) ?? null,
  }
}

export type FakeCloud = ReturnType<typeof createFakeCloud>

/**
 * The relay side of a fake Kimo Cloud on a real relay: rooms are registered by `deviceKeys` as an
 * owner device (the service key's role on the hosted relay), claiming the relay when it is
 * unclaimed, and closed or revoked with each room's root key.
 */
export function relayRegistrar(deps: {
  deviceKeys: DeviceKeyStore
  fetch?: typeof fetch
  now?: () => number
}): FakeCloudRelay {
  const ownership = createOwnershipClient({
    deviceKeys: deps.deviceKeys,
    deviceName: () => "Kimo Cloud",
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  })
  const http = (relayUrl: string) =>
    new RelayHttpClient({ relayUrl, ...(deps.fetch ? { fetch: deps.fetch } : {}) })
  const now = deps.now ?? Date.now
  return {
    async register(r) {
      const info = await ownership.probe(r.relayUrl)
      if (info.owner === "unclaimed") await ownership.claimRelay(r.relayUrl)
      const room = parseRoomId(r.room)
      const rootPub = await exportPublicKey(r.rootKeys.publicKey)
      const cert = await signLinkCert(r.rootKeys.privateKey, {
        kid: r.kid,
        iat: Math.floor(now() / 1000),
        room,
        linkPub: await exportPublicKey(r.linkKeys.publicKey),
      })
      const nonce = randomBytes(16)
      const iat = now()
      const body = await ownership.registerBody(
        r.relayUrl,
        { room, rootPub, cert: toBase64Url(cert.bytes) },
        { nonce, iat },
      )
      const command = await signAdminCommand(r.rootKeys.privateKey, room, body, { nonce, iat })
      await http(r.relayUrl).admin(r.room, command)
    },
    async close(r) {
      const command = await signAdminCommand(r.rootKeys.privateKey, parseRoomId(r.room), {
        op: "close",
      })
      await http(r.relayUrl).admin(r.room, command)
    },
    async revoke(r, jti, exp) {
      const command = await signAdminCommand(r.rootKeys.privateKey, parseRoomId(r.room), {
        op: "revoke",
        jti,
        exp,
      })
      await http(r.relayUrl).admin(r.room, command)
    },
  }
}
