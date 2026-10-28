/**
 * Kimo Cloud API v1 shapes (kimo-cloud docs/api.md §3 to §8, workspaces §13 to §17): what the app
 * reads from the hosted relay's account service. Times are unix ms, money integer cents, keys
 * base64url.
 */

export type PlanStatus = "none" | "active" | "past_due" | "grace" | "read_only" | "expired"
export type BillingInterval = "month" | "year"

export interface CloudPlan {
  status: PlanStatus
  /** `active` and `past_due`: new rooms are allowed (popover 4B vs 4C / 6A). */
  canShare: boolean
  interval: BillingInterval | null
  amountCents: number | null
  currency: string | null
  renewsAt: number | null
  cancelAtPeriodEnd: boolean
  endsAt: number | null
  /** `past_due`: "Update it by" (6D). */
  paymentDueBy: number | null
  /** `grace`, `read_only`, `expired`: shared files keep syncing until then (6A, 6B). */
  graceEndsAt: number | null
  retainUntil: number | null
  /** Seats on the subscription as the provider last reported them (§13 plans only); else null. */
  seats: number | null
}

export interface CloudUsage {
  bytes: number
  rooms: number
  limitBytes: number
  reportedAt: number | null
}

export interface CloudDevice {
  pub: string
  name: string
  linkedAt: number
  lastSeenAt: number | null
  /** The signing device (this one). */
  self: boolean
}

export interface CloudAccount {
  account: { id: string; email: string; createdAt: number }
  /** Compatibility (§5.1): the oldest owned workspace's plan. New code reads `workspaces`. */
  plan: CloudPlan
  usage: CloudUsage
  devices: CloudDevice[]
  /** Every workspace the account is a member of, oldest membership first (deleted: 30 days). */
  workspaces: WorkspaceSummary[]
  /** This account's own edit access requests from the last 30 days (§15). */
  accessRequests: AccessRequest[]
}

// --- Workspaces (§13 to §17) ----------------------------------------------------------------------

export type WorkspaceRole = "owner" | "admin" | "editor"
/** Roles an invite or a role change may give (the Owner changes only by transfer). */
export type MemberRole = "admin" | "editor"

/** A pending owner transfer (§13.6), shown to the Owner and to the Admin it names. */
export interface Transfer {
  id: string
  /** The Owner's email. */
  from: string
  /** The Admin's email. */
  to: string
  toAccount: string
  interval: BillingInterval
  seats: number
  /** What the new Owner pays per interval, before tax. */
  amountCents: number
  currency: string
  createdAt: number
  expiresAt: number
}

export interface WorkspaceSummary {
  id: string
  name: string
  /** The caller's role here. */
  role: WorkspaceRole
  createdAt: number
  plan: CloudPlan
  /** Member count: the seats the next renewal charges for. */
  members: number
  /** The pending transfer when the caller is its Owner or the Admin it names; else null. */
  transfer: Transfer | null
  /** Set for a deleted workspace (§13.10): its copies turn read-only. */
  deletedAt: number | null
}

export interface Member {
  account: string
  email: string
  role: WorkspaceRole
  joinedAt: number
  self: boolean
}

export interface Invite {
  id: string
  email: string
  role: MemberRole
  invitedBy: string
  createdAt: number
  expiresAt: number
}

/** A request someone made to edit a workspace file, as its Admins see it (§13.2). */
export interface WorkspaceRequest {
  id: string
  email: string
  room: string
  createdAt: number
  expiresAt: number
}

export type AccessRequestStatus = "pending" | "approved" | "declined" | "expired"

/** One of this account's own edit access requests (§15). */
export interface AccessRequest {
  id: string
  workspaceName: string
  room: string
  status: AccessRequestStatus
  createdAt: number
  expiresAt: number
}

/** `GET /v1/workspaces/<ws>` (§13.2). `invites` and `requests` are empty for Editors. */
export interface WorkspaceDetail {
  workspace: WorkspaceSummary
  usage: CloudUsage
  members: Member[]
  invites: Invite[]
  requests: WorkspaceRequest[]
}

/** `POST /v1/invites/peek` (§14.3): what the invite is for, before accepting. */
export interface InvitePeek {
  workspaceName: string
  invitedBy: string
  email: string
  role: MemberRole
  expiresAt: number
}

/** A workspace file (§16): its room, where it lives and its content key. */
export interface CloudFile {
  room: string
  name: string
  relayUrl: string
  /** Base64url of the 32-byte room key (spec §7). Kept with the registry, never shown. */
  roomKey: string
  addedBy: string
  createdAt: number
  updatedAt: number
  replacedBy: string | null
}

/** A file closed in the last 30 days, or a pre-workspace room a file replaced (§16.1). */
export interface ClosedFile {
  room: string
  replacedBy: string | null
  closedAt: number
}

export interface FileList {
  files: CloudFile[]
  closed: ClosedFile[]
}

export type TokenRole = "edit" | "view"

/** A capability token Kimo Cloud signed (§17). `expiresAt` null: a view link without expiry. */
export interface CloudToken {
  token: string
  role: TokenRole
  expiresAt: number | null
}

/** A view link (§17); `fileName` in workspace lists and in removal answers. */
export interface ViewLink {
  jti: string
  room: string
  label: string | null
  createdBy: string
  createdAt: number
  expiresAt: number | null
  fileName?: string
}

export interface AuthStarted {
  requestId: string
  /** The normalized address (shown). */
  email: string
  expiresAt: number
  /** When Resend unlocks. */
  resendAfter: number
}

export type AuthPoll =
  | { status: "pending"; expiresAt: number }
  | { status: "verified"; account: CloudAccount }
  | { status: "expired" }
  | { status: "superseded" }

export interface PlanPrice {
  interval: BillingInterval
  /** Includes the Owner's seat. */
  amountCents: number
  /** Each extra member (§5.2), shown before sending an invite; null when the service did not say. */
  seatAmountCents: number | null
  currency: string
}

export interface CloudPlans {
  plans: PlanPrice[]
  storageLimitBytes: number
  /** Storage each seat past the first adds (§5.2); 0 when the service did not say. */
  seatStorageBytes: number
  taxIncluded: boolean
}

export interface CheckoutCreated {
  checkoutId: string
  url: string
  expiresAt: number
}

export type CheckoutStatusValue = "open" | "confirmed" | "succeeded" | "failed" | "expired"

export interface CheckoutStatus {
  checkoutId: string
  status: CheckoutStatusValue
  plan: CloudPlan
}

export interface PortalLink {
  url: string
  expiresAt: number
}

export interface CloudRelay {
  relayUrl: string
  region: string
  protocol: string
}

/** The service's error codes (§11), plus the app's own `OFFLINE` (no HTTP answer) and `BAD_RESPONSE`. */
export type CloudErrorCode =
  | "BAD_REQUEST"
  | "AUTH_INVALID"
  | "NOT_SIGNED_IN"
  | "PLAN_REQUIRED"
  | "ORIGIN_FORBIDDEN"
  | "NOT_FOUND"
  | "ALREADY_SIGNED_IN"
  | "ALREADY_SUBSCRIBED"
  | "PAST_DUE"
  | "NONCE_REPLAY"
  | "LINK_EXPIRED"
  | "LINK_USED"
  | "TOO_LARGE"
  | "STALE_REQUEST"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "EMAIL_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "NAME_MISMATCH"
  | "NOT_MEMBER"
  | "ROLE_REQUIRED"
  | "INVITE_EMAIL_MISMATCH"
  | "ALREADY_MEMBER"
  | "NOT_ADMIN"
  | "OWNER_CANNOT_LEAVE"
  | "INVITE_EXPIRED"
  | "INVITE_USED"
  | "REQUEST_CLOSED"
  | "TRANSFER_CLOSED"
  | "WORKSPACE_DELETED"
  | "ROOM_CLOSED"
  | "RELAY_UNAVAILABLE"
  | "ACCOUNT_QUOTA_EXCEEDED"
  | "OFFLINE"
  | "BAD_RESPONSE"
  | "UNKNOWN"

const KNOWN: ReadonlySet<string> = new Set<CloudErrorCode>([
  "BAD_REQUEST",
  "AUTH_INVALID",
  "NOT_SIGNED_IN",
  "PLAN_REQUIRED",
  "ORIGIN_FORBIDDEN",
  "NOT_FOUND",
  "ALREADY_SIGNED_IN",
  "ALREADY_SUBSCRIBED",
  "PAST_DUE",
  "NONCE_REPLAY",
  "LINK_EXPIRED",
  "LINK_USED",
  "TOO_LARGE",
  "STALE_REQUEST",
  "RATE_LIMITED",
  "INTERNAL",
  "EMAIL_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
  "NAME_MISMATCH",
  "NOT_MEMBER",
  "ROLE_REQUIRED",
  "INVITE_EMAIL_MISMATCH",
  "ALREADY_MEMBER",
  "NOT_ADMIN",
  "OWNER_CANNOT_LEAVE",
  "INVITE_EXPIRED",
  "INVITE_USED",
  "REQUEST_CLOSED",
  "TRANSFER_CLOSED",
  "WORKSPACE_DELETED",
  "ROOM_CLOSED",
  "RELAY_UNAVAILABLE",
  "ACCOUNT_QUOTA_EXCEEDED",
])

/** Unknown codes from a newer service map to `UNKNOWN` (§1.2). */
export function cloudErrorCode(raw: unknown): CloudErrorCode {
  return typeof raw === "string" && KNOWN.has(raw) ? (raw as CloudErrorCode) : "UNKNOWN"
}

export class CloudError extends Error {
  readonly code: CloudErrorCode
  /** HTTP status, 0 when there was no answer. */
  readonly status: number
  /** `retry-after` in seconds (429, 503). */
  readonly retryAfter: number | null
  constructor(code: CloudErrorCode, message: string, status = 0, retryAfter: number | null = null) {
    super(message)
    this.name = "CloudError"
    this.code = code
    this.status = status
    this.retryAfter = retryAfter
  }
}

/** No answer, or the service failed: board 43 6E "Can't reach Kimo Cloud", last plan kept. */
export const isUnreachable = (error: unknown) =>
  error instanceof CloudError &&
  (error.code === "OFFLINE" || error.code === "INTERNAL" || error.code === "BAD_RESPONSE")
