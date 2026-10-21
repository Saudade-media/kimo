/**
 * Board 43 sections 1 to 3 inside the relay wizard (RelayWizard renders the shell): the Kimo Cloud
 * card and the Host your own disclosure on Choose, then Sign in (2 A enter email, 2 B check your
 * inbox, 2 C signed in, 2 E link expired or used) and Subscribe (3 A choose billing, 3 B waiting for
 * checkout, 3 D checkout not finished). Each step is a Body and a Footer for the wizard's shell.
 */
import { Badge, Button, Input } from "@kimo/ui"
import { type ReactNode, useEffect, useId, useState } from "react"
import { Icon } from "../../lib/icons"
import { type CloudState, type CloudStore, looksLikeEmail } from "../cloud/store"
import type { BillingInterval } from "../cloud/types"
import {
  cloudErrorText,
  INTERVAL_LABEL,
  priceFor,
  priceLine,
  resendLabel,
  yearlySaving,
} from "../cloud/view"
import type { Clock } from "../relay-setup/runner"
import { CloudDeviceRow, CloudNotice } from "./cloud-parts"
import { Note, RadioRow, radioKeys, Spacer } from "./relay-parts"
import "./cloud.css"

export type CloudStep = "sign-in" | "subscribe"

interface StepArgs {
  step: CloudStep
  cloud: CloudStore
  state: CloudState
  clock: Clock
  /** Back to Choose. */
  onChoose(): void
  /** Saves Kimo Cloud as the relay and shows the ready screen (3 C). */
  onUseCloud(): void
  /** 2 C without a plan: on to Subscribe (3 A). */
  onSubscribe(): void
  saving: boolean
}

export interface CloudStepView {
  body: ReactNode
  footer: ReactNode
  bodyGap: 8 | 14 | 16
}

const ghost = (label: string, icon: string | null, onClick: () => void, name?: string) => (
  <Button
    variant="ghost"
    className="rw-btn rw-back"
    data-action={name}
    {...(icon ? { icon: <Icon name={icon} size={16} /> } : {})}
    onClick={onClick}
  >
    {label}
  </Button>
)

const primary = (
  label: string,
  icon: string | null,
  onClick: () => void,
  opts: { disabled?: boolean; name?: string } = {},
) => (
  <Button
    variant="primary"
    className="rw-btn rw-primary"
    data-action={opts.name}
    {...(icon ? { icon: <Icon name={icon} size={16} /> } : {})}
    disabled={opts.disabled}
    onClick={onClick}
  >
    {label}
  </Button>
)

/** Intro (YKm4P): Icon Wrap 32 › icon 16 · Text (gap 4): Title · Desc. */
function Intro({
  icon,
  tone,
  title,
  desc,
}: {
  icon: string
  tone?: "success" | "warning"
  title: string
  desc: string
}) {
  return (
    <div className="rw-intro">
      <span className={`rw-icon-wrap${tone ? ` rw-icon-wrap--${tone}` : ""}`} aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <div className="rw-text rw-text--4">
        <p className="rw-title">{title}</p>
        <p className="rw-desc">{desc}</p>
      </div>
    </div>
  )
}

/** Center (m9egRl): Icon Wrap 40 › icon 18 · Text (title, desc) · Waiting. */
function Center({
  icon,
  title,
  desc,
  waiting,
}: {
  icon: string
  title: string
  desc: string
  waiting: string
}) {
  return (
    <div className="rw-center">
      <span className="rw-center__icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <div className="rw-center__text">
        <h3 className="rw-center__title">{title}</h3>
        <p className="rw-center__desc">{desc}</p>
      </div>
      <div className="rw-waiting" role="status">
        <span className="rw-waiting__icon rw-spin" aria-hidden="true">
          <Icon name="loader-circle" size={14} />
        </span>
        <span className="rw-waiting__label">{waiting}</span>
      </div>
    </div>
  )
}

/** The service's reason under a step that stays (rate limited, email or provider down). */
function ErrorLine({
  code,
  state,
  onRetry,
}: {
  code: string | null
  state: CloudState
  onRetry(): void
}) {
  if (!code) return null
  // No answer: the 6 E fragment, the same copy as the popover and Settings.
  if (code === "OFFLINE" || code === "INTERNAL" || code === "BAD_RESPONSE")
    return <CloudNotice kind="offline" account={state.account} onAction={onRetry} />
  return (
    <div className="rw-cloud-error">
      <Note icon="triangle-alert" tone="warning">
        {cloudErrorText(code)}
      </Note>
    </div>
  )
}

/** Field · Email (jxPa7): Label · Input (mail). Enter submits. */
function EmailField({
  value,
  disabled,
  onChange,
  onSubmit,
}: {
  value: string
  disabled: boolean
  onChange(v: string): void
  onSubmit(): void
}) {
  const id = useId()
  return (
    <div className="rw-email">
      <label className="rw-label" htmlFor={id}>
        Email
      </label>
      <Input
        id={id}
        type="email"
        icon={<Icon name="mail" size={16} />}
        placeholder="you@example.com"
        autoComplete="email"
        spellCheck={false}
        autoFocus
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            onSubmit()
          }
        }}
      />
    </div>
  )
}

/** Resend (pTAOk): Button/Secondary, refresh-cw, a countdown until it unlocks (0.4 while locked). */
function ResendButton({
  resendAfter,
  clock,
  busy,
  onResend,
}: {
  resendAfter: number
  clock: Clock
  busy: boolean
  onResend(): void
}) {
  const [now, setNow] = useState(clock.now())
  useEffect(() => {
    if (now >= resendAfter) return
    const h = clock.setTimeout(() => setNow(clock.now()), Math.min(1000, resendAfter - now))
    return () => clock.clearTimeout(h)
  }, [now, resendAfter, clock])
  const locked = now < resendAfter
  return (
    <Button
      variant="secondary"
      className="rw-btn rw-secondary"
      data-action="resend"
      icon={<Icon name="refresh-cw" size={16} />}
      disabled={locked || busy}
      onClick={onResend}
    >
      {resendLabel(resendAfter, now)}
    </Button>
  )
}

/** Billing (ev4k1): Monthly · Yearly radio cards (Yearly with its saving badge). */
function Billing({
  state,
  interval,
  onChange,
}: {
  state: CloudState
  interval: BillingInterval
  onChange(v: BillingInterval): void
}) {
  const options = (["month", "year"] as const).map((v) => ({ value: v }))
  const saving = yearlySaving(state.plans.plans)
  return (
    <div
      className="rw-billing"
      role="radiogroup"
      aria-label="Billing"
      onKeyDown={(e) => radioKeys(e, options, interval, (v) => onChange(v as BillingInterval))}
    >
      {options.map(({ value }) => {
        const price = priceFor(state.plans.plans, value)
        return (
          <RadioRow
            key={value}
            className="rw-option"
            value={value}
            checked={interval === value}
            onSelect={() => onChange(value)}
          >
            <span className="rw-text">
              <span className="rw-option__title">{INTERVAL_LABEL[value]}</span>
              <span className="rw-option__desc rw-price">{price ? priceLine(price) : ""}</span>
            </span>
            {value === "year" && saving && <Badge className="rw-badge">{saving}</Badge>}
          </RadioRow>
        )
      })}
    </div>
  )
}

export function cloudStepView(args: StepArgs): CloudStepView {
  const { cloud, state } = args
  if (args.step === "sign-in") {
    const s = state.signIn
    if (s.phase === "email") {
      const ok = looksLikeEmail(s.email)
      const submit = () => {
        if (ok && !s.busy) void cloud.startSignIn()
      }
      return {
        bodyGap: 16,
        body: (
          <>
            <Intro
              icon="mail"
              title="Sign in to Kimo Cloud"
              desc="We email you a link. No password to remember."
            />
            <EmailField
              value={s.email}
              disabled={s.busy}
              onChange={(v) => cloud.setEmail(v)}
              onSubmit={submit}
            />
            <ErrorLine code={s.error} state={state} onRetry={submit} />
          </>
        ),
        footer: (
          <>
            {ghost("Back", "arrow-left", args.onChoose, "back")}
            <Spacer />
            {primary(s.busy ? "Sending…" : "Email me a link", "send", submit, {
              disabled: !ok || s.busy,
              name: "send-link",
            })}
          </>
        ),
      }
    }
    if (s.phase === "sent")
      return {
        bodyGap: 16,
        body: (
          <>
            <Center
              icon="mail-check"
              title="Check your inbox"
              desc={`We sent a link to ${s.email}. Open it on any device and this one signs in.`}
              waiting="Waiting for the link"
            />
            <ErrorLine
              code={s.error}
              state={state}
              onRetry={() => void cloud.startSignIn(s.email)}
            />
          </>
        ),
        footer: (
          <>
            {ghost("Use a different email", "arrow-left", () => cloud.changeEmail(), "other-email")}
            <Spacer />
            <ResendButton
              resendAfter={s.resendAfter}
              clock={args.clock}
              busy={s.busy}
              onResend={() => void cloud.resend()}
            />
          </>
        ),
      }
    if (s.phase === "expired")
      return {
        bodyGap: 16,
        body: (
          <>
            <Intro
              icon="mail-x"
              tone="warning"
              title="That link no longer works"
              desc={`Links work once, for 15 minutes. Send a new one to ${s.email}.`}
            />
            <ErrorLine code={s.error} state={state} onRetry={() => void cloud.resend()} />
          </>
        ),
        footer: (
          <>
            {ghost("Use a different email", "arrow-left", () => cloud.changeEmail(), "other-email")}
            <Spacer />
            {primary(s.busy ? "Sending…" : "Send a new link", "send", () => void cloud.resend(), {
              disabled: s.busy,
              name: "send-new-link",
            })}
          </>
        ),
      }
    // 2 C: signed in.
    const self = state.account?.devices.find((d) => d.self) ?? null
    const canShare = state.account?.plan.canShare === true
    return {
      bodyGap: 16,
      body: (
        <>
          <Intro
            icon="circle-check"
            tone="success"
            title={`Signed in as ${s.email}`}
            desc="This device is now linked to your account. Any device you sign in on can start sharing."
          />
          {self && (
            <ul className="mp-device-list" aria-label="This device">
              <CloudDeviceRow device={self} now={args.clock.now()} />
            </ul>
          )}
        </>
      ),
      footer: (
        <>
          {ghost("Back", "arrow-left", args.onChoose, "back")}
          <Spacer />
          {primary(
            "Continue",
            "arrow-right",
            () => (canShare ? args.onUseCloud() : args.onSubscribe()),
            { disabled: args.saving, name: "continue" },
          )}
        </>
      ),
    }
  }

  // Subscribe.
  const c = state.checkout
  if (c.phase === "waiting")
    return {
      bodyGap: 16,
      body: (
        <Center
          icon="credit-card"
          title="Finish in your browser"
          desc="Checkout is open in your browser. Kimo moves on as soon as the payment goes through."
          waiting="Waiting for checkout"
        />
      ),
      footer: (
        <>
          {ghost("Back", "arrow-left", () => cloud.backToChoose(), "back")}
          <Spacer />
          <Button
            variant="secondary"
            className="rw-btn rw-secondary"
            data-action="open-checkout"
            icon={<Icon name="external-link" size={16} />}
            onClick={() => void cloud.reopenCheckout()}
          >
            Open checkout again
          </Button>
        </>
      ),
    }
  if (c.phase === "failed")
    return {
      bodyGap: 16,
      body: (
        <>
          <Intro
            icon="circle-alert"
            tone="warning"
            title="Payment did not go through"
            desc="Nothing was charged. Try again, or pick another way to pay in checkout."
          />
          <ErrorLine code={c.error} state={state} onRetry={() => void cloud.startCheckout()} />
        </>
      ),
      footer: (
        <>
          {ghost("Back", "arrow-left", () => cloud.backToChoose(), "back")}
          <Spacer />
          {primary("Try checkout again", "external-link", () => void cloud.startCheckout(), {
            disabled: c.busy,
            name: "checkout",
          })}
        </>
      ),
    }
  // 3 A (and `ready`, which the wizard turns into 3 C).
  const interval = c.phase === "choose" ? c.interval : "month"
  const busy = c.phase === "choose" && c.busy
  const cap = state.plans.storageLimitBytes
  const includes = [
    "Unlimited shared files and guests",
    `${capText(cap)} of storage for shared files and images`,
    "End-to-end encrypted. We never see your designs",
    "Cancel any time. Your files stay on your devices",
  ]
  return {
    bodyGap: 16,
    body: (
      <>
        <Intro
          icon="cloud"
          title="Kimo Cloud"
          desc="One plan for everything you share. Guests never pay and never need an account."
        />
        <Billing state={state} interval={interval} onChange={(v) => cloud.chooseInterval(v)} />
        <ul className="rw-includes" aria-label="Included">
          {includes.map((text) => (
            <li key={text} className="rw-include">
              <span className="rw-include__icon" aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
              <span className="rw-include__label">{text}</span>
            </li>
          ))}
        </ul>
        {c.phase === "choose" && (
          <ErrorLine code={c.error} state={state} onRetry={() => void cloud.startCheckout()} />
        )}
      </>
    ),
    footer: (
      <>
        <span className="rw-footnote">
          {state.plans.taxIncluded
            ? "Prices in USD, tax included."
            : "Prices in USD. Tax is added at checkout."}
        </span>
        <Spacer />
        {primary(
          busy ? "Opening…" : "Continue to checkout",
          "external-link",
          () => void cloud.startCheckout(),
          { disabled: busy, name: "checkout" },
        )}
      </>
    ),
  }
}

/** "10 GB" from the cap in bytes (decimal). */
function capText(bytes: number): string {
  const gb = bytes / 1e9
  return gb >= 1 ? `${Math.round(gb * 10) / 10} GB` : `${Math.round(bytes / 1e6)} MB`
}
