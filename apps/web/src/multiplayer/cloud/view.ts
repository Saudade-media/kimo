/**
 * Board 43 copy and state picks, as pure functions: prices, the plan line, storage, the Share
 * popover stage (4A, 4B, 4C, 6A) and the editor banner (6B, 6C, past due). Prices and the storage
 * cap come from Kimo Cloud (`GET /v1/plans`, the account); the board's numbers are placeholders.
 */
import type { CloudState } from "./store"
import type { BillingInterval, CloudAccount, CloudPlan, CloudUsage, PlanPrice } from "./types"

/** 800 → "$8", 850 → "$8.50". USD only shows a symbol; another currency shows its code. */
export function money(cents: number, currency = "usd"): string {
  const whole = cents % 100 === 0
  const amount = whole ? String(cents / 100) : (cents / 100).toFixed(2)
  return currency.toLowerCase() === "usd" ? `$${amount}` : `${amount} ${currency.toUpperCase()}`
}

/** "$8 a month", "$80 a year". */
export const priceLine = (p: Pick<PlanPrice, "interval" | "amountCents" | "currency">) =>
  `${money(p.amountCents, p.currency)} a ${p.interval === "year" ? "year" : "month"}`

export const priceFor = (plans: readonly PlanPrice[], interval: BillingInterval) =>
  plans.find((p) => p.interval === interval) ?? null

/** "2 months free": what a year saves against twelve months, in whole months. */
export function yearlySaving(plans: readonly PlanPrice[]): string | null {
  const month = priceFor(plans, "month")
  const year = priceFor(plans, "year")
  if (!month || !year || month.amountCents <= 0) return null
  const months = Math.round((month.amountCents * 12 - year.amountCents) / month.amountCents)
  return months >= 1 ? `${months} month${months === 1 ? "" : "s"} free` : null
}

export const INTERVAL_LABEL: Record<BillingInterval, string> = { month: "Monthly", year: "Yearly" }

/** "Nov 21" (the person's time zone). */
export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** Settings › Account › Plan value: "Monthly · $8"; "None" without a subscription. */
export function planValue(plan: CloudPlan): string {
  if (!plan.interval || plan.amountCents === null) return "None"
  return `${INTERVAL_LABEL[plan.interval]} · ${money(plan.amountCents, plan.currency ?? "usd")}`
}

/** The meta after the plan value: "renews Nov 21", "ends Nov 21", "ended Nov 4". */
export function planMeta(plan: CloudPlan): string | null {
  if (plan.status === "active" && plan.cancelAtPeriodEnd && plan.endsAt)
    return `ends ${shortDate(plan.endsAt)}`
  if (plan.status === "active" && plan.renewsAt) return `renews ${shortDate(plan.renewsAt)}`
  if (plan.status === "past_due" && plan.paymentDueBy)
    return `update by ${shortDate(plan.paymentDueBy)}`
  if (
    (plan.status === "grace" || plan.status === "read_only" || plan.status === "expired") &&
    plan.endsAt
  )
    return `ended ${shortDate(plan.endsAt)}`
  return null
}

/** The ready screen's meta (3C): "maya@studio.design · Monthly · renews Nov 21". */
export function readyMeta(email: string, plan: CloudPlan | null): string {
  const parts = [email]
  if (plan?.interval) parts.push(INTERVAL_LABEL[plan.interval])
  const meta = plan ? planMeta(plan) : null
  if (meta) parts.push(meta)
  return parts.join(" · ")
}

/** Decimal units like the cap ("10 GB" is 10^10 bytes): "1.2 GB", "340 MB", "0 MB". */
function bytesText(bytes: number): string {
  const b = Math.max(0, bytes)
  if (b >= 1e9) return `${trim(b / 1e9)} GB`
  if (b >= 1e6) return `${Math.round(b / 1e6)} MB`
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`
  return b === 0 ? "0 MB" : `${b} B`
}

const trim = (n: number) => {
  const v = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10
  return String(v)
}

/** "1.2 GB of 10 GB". */
export const storageText = (usage: Pick<CloudUsage, "bytes" | "limitBytes">) =>
  `${bytesText(usage.bytes)} of ${bytesText(usage.limitBytes)}`

/** The bar turns warning at 90 % and danger at 100 % (rule "Usage"). */
export function storageLevel(usage: Pick<CloudUsage, "bytes" | "limitBytes">) {
  const ratio = usage.limitBytes > 0 ? usage.bytes / usage.limitBytes : 0
  return ratio >= 1 ? "danger" : ratio >= 0.9 ? "warning" : "ok"
}

export const storageRatio = (usage: Pick<CloudUsage, "bytes" | "limitBytes">) =>
  usage.limitBytes > 0 ? Math.max(0, Math.min(1, usage.bytes / usage.limitBytes)) : 0

/** The plan's StatusPill: Active, Past due, Ended, No plan. */
export function planPill(plan: CloudPlan): {
  tone: "success" | "warning" | "danger" | "muted"
  label: string
} {
  switch (plan.status) {
    case "active":
      return { tone: "success", label: "Active" }
    case "past_due":
      return { tone: "warning", label: "Past due" }
    case "grace":
      return { tone: "warning", label: "Ended" }
    case "read_only":
    case "expired":
      return { tone: "danger", label: "Ended" }
    default:
      return { tone: "muted", label: "No plan" }
  }
}

/**
 * Which Kimo Cloud body the Share popover shows when the file is not live: 4A sign in (signed out),
 * 4B ready (a plan that allows sharing), 4C subscribe (never subscribed), 6A lapsed (renew), or 6E
 * offline when nothing is known yet. Offline with a known plan keeps that plan's body.
 */
export function cloudShareStage(state: Pick<CloudState, "session" | "account" | "offline">) {
  if (state.session === "signed-in" && state.account) {
    const plan = state.account.plan
    if (plan.canShare) return "ready"
    return plan.status === "none" ? "subscribe" : "lapsed"
  }
  if (state.session === "unknown" && state.offline) return "offline"
  return "sign-in"
}

/** 6A: "Renew to share new files. Files you already share keep syncing until Nov 4." */
export function lapsedDesc(plan: CloudPlan, now: number): string {
  if (plan.graceEndsAt && plan.graceEndsAt > now)
    return `Renew to share new files. Files you already share keep syncing until ${shortDate(plan.graceEndsAt)}.`
  return "Renew to share new files. Files you already share are read-only until you renew."
}

/** 4B footnote: "Monthly · 1.2 GB of 10 GB". */
export function readyFootnote(account: Pick<CloudAccount, "plan" | "usage">) {
  const parts: string[] = []
  if (account.plan.interval) parts.push(INTERVAL_LABEL[account.plan.interval])
  parts.push(storageText(account.usage))
  return parts.join(" · ")
}

export type PlanBannerKind = "grace" | "read-only" | "past-due"

/** The editor banner for a file shared on Kimo Cloud, for its owner (6B, 6C, past due). */
export function planBannerKind(plan: CloudPlan | null, now: number): PlanBannerKind | null {
  if (!plan) return null
  if (plan.status === "past_due") return "past-due"
  if (plan.status === "grace")
    return plan.graceEndsAt && plan.graceEndsAt <= now ? "read-only" : "grace"
  if (plan.status === "read_only" || plan.status === "expired") return "read-only"
  return null
}

/** 6D: "We could not charge your card. Update it by Nov 28 to keep sharing new files. ..." */
export function paymentFailedDesc(plan: CloudPlan): string {
  const by = plan.paymentDueBy ? ` by ${shortDate(plan.paymentDueBy)}` : ""
  return `We could not charge your card. Update it${by} to keep sharing new files. Nothing has stopped yet.`
}

/** Resend countdown (2B): "Resend in 0:42", or "Resend" once unlocked. */
export function resendLabel(resendAfter: number, now: number): string {
  const s = Math.ceil(Math.max(0, resendAfter - now) / 1000)
  if (s <= 0) return "Resend"
  return `Resend in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** Device meta (5A): "Signed in Oct 2"; just linked (2C): "Linked just now". */
export function deviceMeta(linkedAt: number, now: number): string {
  return now - linkedAt < 60_000 ? "Linked just now" : `Signed in ${shortDate(linkedAt)}`
}

/** Short lines for the service's errors where a step stays on screen (2A, 3A, 3D). */
export function cloudErrorText(code: string | null): string | null {
  switch (code) {
    case null:
      return null
    case "EMAIL_UNAVAILABLE":
      return "Can't send the email right now. Try again."
    case "RATE_LIMITED":
      return "Too many tries. Wait a minute, then try again."
    case "PROVIDER_UNAVAILABLE":
      return "Checkout is not available right now. Try again."
    case "OFFLINE":
    case "INTERNAL":
    case "BAD_RESPONSE":
      return "Can't reach Kimo Cloud. Check your connection."
    case "BAD_REQUEST":
      return "Check the email address."
    default:
      return "Something went wrong. Try again."
  }
}
