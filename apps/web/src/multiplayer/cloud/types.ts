/**
 * Kimo Cloud API v1 shapes (kimo-cloud docs/api.md §3 to §8): what the app reads from the hosted
 * relay's account service. Times are unix ms, money integer cents, keys base64url.
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
  plan: CloudPlan
  usage: CloudUsage
  devices: CloudDevice[]
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
  amountCents: number
  currency: string
}

export interface CloudPlans {
  plans: PlanPrice[]
  storageLimitBytes: number
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
