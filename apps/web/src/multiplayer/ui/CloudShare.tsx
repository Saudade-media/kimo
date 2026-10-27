/**
 * Board 43 section 4 and 6 A: the Share popover with Kimo Cloud first, while the file is not live.
 *
 * - 4 A (signed out, no relay yet): Share with Kimo Cloud · Use Kimo Cloud (opens the wizard at
 *   Sign in) · the price line · Host your own, free (collapsed; open: Set up a relay and the Relay
 *   URL field as before, kept open once a relay URL is set). Start sharing waits for a relay.
 * - 4 B (a plan that allows sharing): Kimo Cloud · the account and its Active pill; the footnote
 *   is the plan and storage; Start sharing creates the room on Kimo Cloud.
 * - 4 C (signed in, never subscribed): Subscribe to share · Subscribe (wizard at 3 A).
 * - 6 A (plan ended): Your Kimo Cloud plan has ended · Renew plan (wizard at 3 B, checkout open).
 * - Offline with nothing known yet: the 6 E fragment. A refused Start sharing shows 6 E or 6 F in
 *   place, never a toast; PLAN_REQUIRED and NOT_OWNER refresh the account, which picks the body.
 */
import { MultiplayerError } from "@kimo/sync/mp"
import { Button } from "@kimo/ui"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { failureText } from "../../editor/errors"
import { Icon } from "../../lib/icons"
import type { CloudState, CloudStore } from "../cloud/store"
import { isUnreachable } from "../cloud/types"
import { cloudShareStage, lapsedDesc, priceFor, priceLine, readyFootnote } from "../cloud/view"
import { CloudNotice, type CloudNoticeKind, PlanPill } from "./cloud-parts"
import type { WizardStart } from "./RelayWizard"
import { useShareToast } from "./shared"
import "./cloud.css"

export interface CloudShareBodyProps {
  cloud: CloudStore
  state: CloudState
  /** Kimo Cloud is the saved relay (else this is the first run, no relay yet). */
  cloudRelay: boolean
  /** Host your own, open: Set up a relay, the Relay URL field and its result. */
  hostContent: ReactNode
  /** Opened at first when a self-hosted relay URL is being set. */
  hostOpenInitially: boolean
  /** A self-hosted relay answered for the field: Start sharing may use it. */
  canStartSelf: boolean
  startingSelf: boolean
  onStartSelf(): void
  /** Starts sharing on Kimo Cloud (saves it as the relay first when needed). */
  onStartCloud(): Promise<void>
  starting: boolean
  onWizard(start: WizardStart): void
}

export function CloudShareBody(props: CloudShareBodyProps) {
  const { cloud, state } = props
  const toast = useShareToast()
  const [hostOpen, setHostOpen] = useState(props.hostOpenInitially)
  const [refused, setRefused] = useState<CloudNoticeKind | null>(null)
  const stage = cloudShareStage(state)
  // Kimo Cloud is the saved relay: its bodies only (Settings changes it), apart from 6 A, where a
  // lapsed plan still offers Host your own (Xh490 › czqWI).
  const showHost = stage !== "ready" && (!props.cloudRelay || stage === "lapsed")

  useEffect(() => {
    if (props.canStartSelf) setHostOpen(true)
  }, [props.canStartSelf])

  // One start at a time: the share status turns "starting" only after the relay lookup, so a
  // second click before then would start (and mint links) again.
  const inFlight = useRef(false)
  const startCloud = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRefused(null)
    try {
      await props.onStartCloud()
    } catch (e) {
      if (e instanceof MultiplayerError) {
        // The relay's answers on Kimo Cloud (api.md §8.1).
        if (e.code === "PLAN_REQUIRED" || e.code === "NOT_OWNER")
          return void (await cloud.refresh())
        if (e.code === "ACCOUNT_QUOTA_EXCEEDED") return setRefused("storage-full")
        if (e.code === "INTERNAL" || e.code === "RELAY_UNREACHABLE") return setRefused("offline")
      }
      if (isUnreachable(e)) return setRefused("offline")
      toast({ tone: "danger", text: failureText("start sharing", e) })
    } finally {
      inFlight.current = false
    }
  }

  const month = priceFor(state.plans.plans, "month")
  const year = priceFor(state.plans.plans, "year")
  const account = state.account

  const disclosure = showHost && (
    <>
      <button
        type="button"
        className="mp-disclosure"
        aria-expanded={hostOpen}
        data-action="host-your-own"
        onClick={() => {
          // Stays open once a relay URL is set.
          if (hostOpen && props.canStartSelf) return
          setHostOpen((o) => !o)
        }}
      >
        <span className="mp-disclosure__chevron" aria-hidden="true">
          <Icon name={hostOpen ? "chevron-down" : "chevron-right"} size={16} />
        </span>
        <span className="mp-text">
          <span className="mp-disclosure__title">Host your own, free</span>
          <span className="mp-desc">Set up a relay, or use one you have</span>
        </span>
      </button>
      {hostOpen && props.hostContent}
    </>
  )

  const intro = (icon: string, title: string, desc: string, tone?: "warning") => (
    <div className="mp-intro">
      <span className={`mp-icon-wrap${tone ? ` mp-icon-wrap--${tone}` : ""}`} aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <div className="mp-text">
        <p className="mp-title">{title}</p>
        <p className="mp-desc">{desc}</p>
      </div>
    </div>
  )

  const wide = (label: string, icon: string, onClick: () => void, name: string) => (
    <Button
      variant="primary"
      className="mp-setup-relay"
      data-action={name}
      icon={<Icon name={icon} size={16} />}
      onClick={onClick}
    >
      {label}
    </Button>
  )

  let body: ReactNode
  let footnote: string
  let canStart = hostOpen && props.canStartSelf
  let onStart = props.onStartSelf
  let starting = props.startingSelf
  if (stage === "ready" && account) {
    body = (
      <>
        {intro(
          "cloud",
          "Kimo Cloud",
          "Share this file. Anyone with the link can join, no account needed.",
        )}
        <div className="mp-account">
          <span className="mp-account__icon" aria-hidden="true">
            <Icon name="user" size={14} />
          </span>
          <span className="mp-account__email">{account.account.email}</span>
          <span className="mp-spacer" aria-hidden="true" />
          <PlanPill account={account} />
        </div>
        {refused && (
          <CloudNotice
            kind={refused}
            account={account}
            onAction={() =>
              refused === "offline" ? void startCloud() : void cloud.openPortal().catch(() => {})
            }
          />
        )}
      </>
    )
    footnote = readyFootnote(account)
    canStart = true
    onStart = () => void startCloud()
    starting = props.starting
  } else if (stage === "subscribe" && account) {
    body = (
      <>
        {intro(
          "cloud",
          "Subscribe to share",
          `You are signed in as ${account.account.email}. Kimo Cloud needs a plan to start sharing.`,
        )}
        {wide("Subscribe", "external-link", () => props.onWizard("subscribe"), "subscribe")}
        <p className="mp-price">
          {month && year
            ? `${priceLine(month)} or ${priceLine(year)} · cancel any time`
            : "Cancel any time"}
        </p>
        {disclosure}
      </>
    )
    footnote = "Files already shared keep syncing"
  } else if (stage === "lapsed" && account) {
    body = (
      <>
        {intro(
          "cloud-off",
          "Your Kimo Cloud plan has ended",
          lapsedDesc(account.plan, Date.now()),
          "warning",
        )}
        {wide("Renew plan", "external-link", () => props.onWizard("renew"), "renew")}
        {disclosure}
      </>
    )
    footnote = "Guests are not affected"
  } else if (stage === "offline") {
    body = (
      <>
        <CloudNotice kind="offline" account={null} onAction={() => void cloud.refresh()} />
        {disclosure}
      </>
    )
    footnote = "Set once, kept in Settings"
  } else {
    body = (
      <>
        {intro(
          "cloud",
          "Share with Kimo Cloud",
          "No setup. Edits stay end-to-end encrypted, so we never see the design.",
        )}
        {wide("Use Kimo Cloud", "cloud", () => props.onWizard("sign-in"), "use-cloud")}
        <p className="mp-price">
          {`${month ? `${priceLine(month)} · ` : ""}sign in with email · guests join free`}
        </p>
        {disclosure}
      </>
    )
    footnote = "Set once, kept in Settings"
  }

  return (
    <>
      <div className="mp-body" data-cloud={stage}>
        {body}
      </div>
      <div className="mp-footer">
        <span className="mp-footnote">{footnote}</span>
        <span className="mp-spacer" aria-hidden="true" />
        <Button
          variant="primary"
          className="mp-button mp-start"
          icon={<Icon name="radio" size={16} />}
          disabled={!canStart || starting}
          onClick={onStart}
        >
          {starting ? "Starting…" : "Start sharing"}
        </Button>
      </div>
    </>
  )
}
