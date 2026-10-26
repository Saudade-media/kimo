/**
 * The browser hand-off gate (board 45 section 2): a page opened at `https://<relay>/join#...` or
 * `/pair#...` first offers the link to the Kimo app, then renders its route (`children`) once the
 * person continues in the browser. Inside the desktop app, or for links opened from within the
 * app, it renders the route straight away.
 *
 * Cards reuse the join error card (board 41 section 5): Icon Wrap 40, Title, Desc, mono Meta,
 * Actions (row, gap 8), plus a Foot line (text-xs tertiary) with the download link.
 */
import { Button } from "@kimo/ui"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { Icon } from "../lib/icons"
import { inTauri } from "../platform/runtime"
import {
  appLinkOf,
  DOWNLOAD_URL,
  downloadLabel,
  HANDOFF_WAIT_MS,
  type HandoffPhase,
  handoffMeta,
  initialPhase,
  relayHostOf,
  type StartupLink,
  startupLinkOf,
} from "./handoff-link"
import { JoinStage } from "./JoinCard"

/**
 * Captured at load, before the join and pairing routes rewrite the URL to their in-app form.
 * Cleared on Continue in browser: links opened later from within the app skip the gate.
 */
let startup: StartupLink | null =
  typeof location === "object" ? startupLinkOf(location, inTauri()) : null

export function HandoffGate({ children }: { children: ReactNode }) {
  const [link, setLink] = useState(startup)
  if (!link) return <>{children}</>
  return (
    <Handoff
      link={link}
      onContinue={() => {
        startup = null
        setLink(null)
      }}
    />
  )
}

function Handoff({ link, onContinue }: { link: StartupLink; onContinue(): void }) {
  const [phase, setPhase] = useState<HandoffPhase>(() =>
    initialPhase(typeof isSecureContext === "boolean" ? isSecureContext : true),
  )
  const [copied, setCopied] = useState(false)
  const tried = useRef(false)

  // Watches for the app taking the link: the tab hides or loses focus before the wait ends.
  // The timer is never cleared, so a StrictMode remount can't strand the card on A.
  const tryApp = useCallback(() => {
    setPhase("trying")
    let left = false
    const leave = () => {
      if (document.visibilityState === "hidden" || !document.hasFocus()) left = true
    }
    document.addEventListener("visibilitychange", leave)
    window.addEventListener("blur", leave)
    location.href = appLinkOf(link)
    setTimeout(() => {
      document.removeEventListener("visibilitychange", leave)
      window.removeEventListener("blur", leave)
      setPhase(left ? "opened" : "no-app")
    }, HANDOFF_WAIT_MS)
  }, [link])

  // One attempt per page load; Open in Kimo on B tries again.
  useEffect(() => {
    if (phase !== "trying" || tried.current) return
    tried.current = true
    tryApp()
  }, [phase, tryApp])

  const host = relayHostOf(link.fragment)
  const download = downloadLabel(typeof navigator === "object" ? navigator.userAgent : "")
  const foot = download && (
    <span className="join-card__foot">
      No Kimo yet?{" "}
      <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
        {download}
      </a>
    </span>
  )
  const browserButton = (label: string) => (
    <Button
      variant="ghost"
      icon={<Icon name="globe" size={16} />}
      data-action="continue"
      onClick={onContinue}
    >
      {label}
    </Button>
  )
  // On B the hand-off runs again (A, then B or C); on D there is nothing to watch for.
  const appButton = (
    <Button
      variant="primary"
      icon={<Icon name="app-window" size={16} />}
      data-action="open-app"
      onClick={() => {
        if (phase === "no-app") tryApp()
        else location.href = appLinkOf(link)
      }}
    >
      Open in Kimo
    </Button>
  )

  let card: ReactNode
  if (phase === "trying")
    card = (
      <Card phase={phase} icon="loader-circle" title="Opening in Kimo…" meta={host}>
        If your browser asks, allow it to open Kimo.
        <Actions>{browserButton("Continue in browser")}</Actions>
      </Card>
    )
  else if (phase === "opened")
    card = (
      <Card phase={phase} icon="circle-check" tone="success" title="Opened in Kimo">
        You can close this tab.
        <Actions>{browserButton("Continue in browser instead")}</Actions>
      </Card>
    )
  else if (phase === "insecure")
    card = (
      <Card
        phase={phase}
        icon="lock-open"
        tone="warning"
        title="Open this link in Kimo"
        meta={new URL(link.href).origin}
        foot={foot}
      >
        {`${host ?? "This relay"} uses http, so this browser can't open the encrypted file. Kimo can.`}
        <Actions>
          <Button
            variant="ghost"
            icon={<Icon name={copied ? "check" : "copy"} size={16} />}
            data-action="copy-link"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(link.href)
                .then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1600)
                })
                .catch(() => undefined)
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
          {appButton}
        </Actions>
      </Card>
    )
  else
    card = (
      <Card
        phase={phase}
        icon="link"
        title={link.kind === "pair" ? "Add this device" : "Open this shared file"}
        meta={handoffMeta(link, Date.now())}
        foot={foot}
      >
        Open it in Kimo, or right here in your browser.
        <Actions>
          {browserButton("Continue in browser")}
          {appButton}
        </Actions>
      </Card>
    )
  return <JoinStage>{card}</JoinStage>
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="join-card__actions">{children}</div>
}

/** One hand-off card; `children` is the description followed by the actions. */
function Card({
  phase,
  icon,
  tone,
  title,
  meta,
  foot,
  children,
}: {
  phase: HandoffPhase
  icon: string
  tone?: "success" | "warning"
  title: string
  meta?: string | null
  foot?: ReactNode
  children: [ReactNode, ReactNode]
}) {
  const [desc, actions] = children
  return (
    <section
      className="join-card join-card--error"
      aria-live="polite"
      data-testid="join-handoff"
      data-phase={phase}
    >
      <div className={`join-card__wrap${tone ? ` join-card__wrap--${tone}` : ""}`}>
        {phase === "trying" ? (
          <span className="join-card__spinner">
            <Icon name={icon} size={18} />
          </span>
        ) : (
          <Icon name={icon} size={18} />
        )}
      </div>
      <div className="join-card__copy">
        <span className="join-card__heading">{title}</span>
        <span className="join-card__desc">{desc}</span>
      </div>
      {meta && <span className="join-card__meta join-card__meta--code">{meta}</span>}
      {actions}
      {foot}
    </section>
  )
}
