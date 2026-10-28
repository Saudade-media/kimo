/**
 * Board 46 copy and picks, as pure functions: names from emails, the Share popover lines, the
 * Settings › Workspace plan rows, the Home file list and the editor banners.
 *
 * Names: Kimo Cloud knows people by email only (api.md §13.2 `Member`), so a name is read from the
 * email's local part: "maya.rossi@studio.design" is "Maya Rossi", "sam@acme.co" is "Sam".
 */

import type {
  BillingInterval,
  CloudPlan,
  CloudUsage,
  Member,
  PlanPrice,
  Transfer,
  ViewLink,
  WorkspaceRole,
  WorkspaceSummary,
} from "./types"
import { INTERVAL_LABEL, money, shortDate, storageText } from "./view"
import type { WorkspacesState } from "./workspaces"

const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)

/** "maya.rossi@studio.design" → "Maya Rossi"; "sam@acme.co" → "Sam". */
export function personName(email: string): string {
  const local = email.split("@")[0] ?? email
  const words = local
    .split(/[._+-]+/)
    .filter((w) => w && !/^\d+$/.test(w))
    .map(cap)
  return words.length ? words.join(" ") : email
}

/** The first word of {@link personName}: "Maya". */
export const firstName = (email: string) => personName(email).split(" ")[0] ?? email

/** Avatar initials: "MR", "SK", "S". */
export function initialsOf(email: string): string {
  return personName(email)
    .split(" ")
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase()
}

/** "Maya", "Maya and Sam", "Maya, Sam and Lee", "Maya, Sam, Lee and 3 more". */
export function namesLine(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  if (names.length <= 3)
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] as string}`
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`
}

/** 1C: "Sam is here", "Sam and Lee are here". */
export function hereLine(labels: readonly string[]): string {
  return `${namesLine(labels)} ${labels.length === 1 ? "is" : "are"} here`
}

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
}

/** 1B picker meta: "Owner · 3 members". */
export const pickerMeta = (w: Pick<WorkspaceSummary, "role" | "members">) =>
  `${ROLE_LABEL[w.role]} · ${w.members} member${w.members === 1 ? "" : "s"}`

const seats = (n: number) => `${n} seat${n === 1 ? "" : "s"}`

/** 1A footnote: "Monthly · 3 seats · 2.1 GB of 20 GB". */
export function shareFootnote(w: WorkspaceSummary, usage: CloudUsage | null): string {
  const parts: string[] = []
  if (w.plan.interval) parts.push(INTERVAL_LABEL[w.plan.interval])
  parts.push(seats(w.plan.seats ?? w.members))
  if (usage) parts.push(storageText(usage))
  return parts.join(" · ")
}

/** 1B footnote: "Studio · Monthly · 3 seats". */
export function pickedFootnote(w: WorkspaceSummary): string {
  const parts = [w.name]
  if (w.plan.interval) parts.push(INTERVAL_LABEL[w.plan.interval])
  parts.push(seats(w.plan.seats ?? w.members))
  return parts.join(" · ")
}

/** 1C link row: "Made by you · Nov 2", "Made by Sam · Nov 2". */
export function linkMeta(
  link: Pick<ViewLink, "createdBy" | "createdAt">,
  selfEmail: string | null,
) {
  const who = selfEmail && link.createdBy === selfEmail ? "you" : firstName(link.createdBy)
  return `Made by ${who} · ${shortDate(link.createdAt)}`
}

/** 2A Plan row: "Monthly · 3 seats · $16"; "None" without a subscription. */
export function workspacePlanValue(plan: CloudPlan, members: number): string {
  if (!plan.interval || plan.amountCents === null) return "None"
  return `${INTERVAL_LABEL[plan.interval]} · ${seats(plan.seats ?? members)} · ${money(plan.amountCents, plan.currency ?? "usd")}`
}

/** The price of one more seat per interval ("$4"), from the plans; null when unknown. */
export function seatPrice(
  plans: readonly PlanPrice[],
  interval: BillingInterval | null,
): string | null {
  const p = plans.find((x) => x.interval === (interval ?? "month"))
  if (!p || p.seatAmountCents === null) return null
  return money(p.seatAmountCents, p.currency)
}

/** 2B: "+$4 a month once they join". */
export const inviteCostLine = (price: string, interval: BillingInterval | null) =>
  `+${price} a ${interval === "year" ? "year" : "month"} once they join`

/** 2A request row: "Approve · $4/mo". */
export const approveLabel = (price: string | null, interval: BillingInterval | null) =>
  price ? `Approve · ${price}/${interval === "year" ? "yr" : "mo"}` : "Approve"

/** 1F billing option: "$8/mo + $4/member". */
export function memberPriceLine(p: PlanPrice): string {
  const unit = p.interval === "year" ? "yr" : "mo"
  const base = `${money(p.amountCents, p.currency)}/${unit}`
  return p.seatAmountCents === null
    ? base
    : `${base} + ${money(p.seatAmountCents, p.currency)}/member`
}

/** 1F includes: "10 GB, plus 5 GB per member". */
export function storageIncludes(limitBytes: number, seatBytes: number): string {
  const gb = (b: number) => `${Math.round((b / 1e9) * 10) / 10} GB`
  return seatBytes > 0 ? `${gb(limitBytes)}, plus ${gb(seatBytes)} per member` : `${gb(limitBytes)}`
}

/** api.md §13.1: the default name of a first workspace, "<email local part>'s workspace". */
export function defaultWorkspaceName(email: string): string {
  const local = email.split("@")[0] ?? ""
  return `${local || "My"}'s workspace`.slice(0, 64)
}

const JOINED_SHOWN_MS = 30 * 86_400_000

/** 2A member meta: "sam@acme.co · joined Oct 30" for a recent join, else the email alone. */
export function memberMeta(m: Member, now: number): string {
  if (m.role === "owner" || m.self || now - m.joinedAt > JOINED_SHOWN_MS) return m.email
  return `${m.email} · joined ${shortDate(m.joinedAt)}`
}

/** 2A invite meta: "Invited by Maya · expires Nov 4". */
export const inviteMeta = (invitedBy: string, expiresAt: number) =>
  `Invited by ${firstName(invitedBy)} · expires ${shortDate(expiresAt)}`

/** 2A request meta: "jo@acme.co · from Landing". */
export const requestMeta = (email: string, fileName: string | null) =>
  fileName ? `${email} · from ${fileName}` : email

/** 2C: "Sam loses access now. Their seat is billed until Nov 28." */
export function removeDesc(email: string, plan: CloudPlan): string {
  const until = plan.renewsAt ?? plan.endsAt
  return until
    ? `${firstName(email)} loses access now. Their seat is billed until ${shortDate(until)}.`
    : `${firstName(email)} loses access now.`
}

/** 6B: "You'll pay $16 a month for 3 seats." */
export function transferPriceLine(
  t: Pick<Transfer, "amountCents" | "currency" | "interval" | "seats">,
) {
  return `You'll pay ${money(t.amountCents, t.currency)} a ${t.interval === "year" ? "year" : "month"} for ${seats(t.seats)}.`
}

/** 6D footnote: "Plan ends Nov 28" (when the plan has a period). */
export function planEndsLine(plan: CloudPlan): string | null {
  const at = plan.renewsAt ?? plan.endsAt
  return at ? `Plan ends ${shortDate(at)}` : null
}

/** The editor banner of a workspace file (board 46 5A to 5D, 6E); null shows none. */
export type WorkspaceBannerKind =
  | "ended-owner"
  | "ended-member"
  | "payment-failed"
  | "removed"
  | "deleted"

export function workspaceBannerKind(
  w: Pick<WorkspaceSummary, "role" | "plan" | "deletedAt"> | null,
  ended: "closed" | "deleted" | "removed" | null,
): WorkspaceBannerKind | null {
  if (ended === "deleted" || w?.deletedAt) return "deleted"
  if (ended === "removed") return "removed"
  if (!w || ended === "closed") return null
  const owner = w.role === "owner"
  if (w.plan.status === "read_only" || w.plan.status === "expired")
    return owner ? "ended-owner" : "ended-member"
  if (w.plan.status === "past_due" && owner) return "payment-failed"
  return null
}

/** Home 4A status cell: "Sam is here", "Synced", "Not on this Mac". */
export type FileStatus = { label: string; tone: "untracked" | "clean" | "none" }

export function fileStatus(here: readonly string[], local: boolean, os: string): FileStatus {
  if (here.length) return { label: hereLine(here), tone: "untracked" }
  if (local) return { label: "Synced", tone: "clean" }
  return { label: os === "macos" ? "Not on this Mac" : "Not on this device", tone: "none" }
}

/** Live workspaces (not deleted), oldest membership first. */
export const liveWorkspaces = (s: Pick<WorkspacesState, "workspaces">) =>
  s.workspaces.filter((w) => w.deletedAt === null)
