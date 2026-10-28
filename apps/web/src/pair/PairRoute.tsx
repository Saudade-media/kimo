/**
 * The pairing link landing (board 41 section 5 H to N, ADR 0017): another device's Add device link
 * opened here. H (VQHDH) Add this device: KimoLogo/Small, title, relay host, what it does, "Works
 * once · N min left", Device name (prefilled with the platform), Not now · Add device. I (k5eOo)
 * Adding. Then J added, K already added, L expired, M already used, N not valid, and the join
 * route's unreachable and not-a-relay cards. Open Kimo goes to the start screen.
 *
 * Adding saves the relay as Settings › Multiplayer › Relay URL when none is set.
 */
import { MultiplayerError, parsePairingLink, parsePairingToken } from "@kimo/sync/mp"
import { Button, Input, KimoLogo } from "@kimo/ui"
import { useEffect, useId, useMemo, useState } from "react"
import { JoinStage } from "../join/JoinCard"
import { Icon } from "../lib/icons"
import { deviceNameFor, ownershipFor } from "../multiplayer/device"
import { useMultiplayer } from "../multiplayer/hooks"
import type { OwnershipClient } from "../multiplayer/ownership"
import { useOptionalRuntime } from "../platform/runtime"
import { navigate } from "../router"
import "../join/join.css"
import "./pair.css"

export type PairOutcome =
  | "added"
  | "already"
  | "expired"
  | "used"
  | "invalid"
  | "unreachable"
  | "not-a-relay"

interface OutcomeCard {
  icon: string
  tone: "success" | "neutral" | "danger"
  title: string
  desc: string
  /** Open Kimo is primary only on success. */
  primary: boolean
}

/** The result cards J to N, and the join route's E and F for the relay itself. */
function outcomeCard(outcome: PairOutcome, host: string): OutcomeCard {
  switch (outcome) {
    case "added":
      return {
        icon: "circle-check",
        tone: "success",
        title: "This device is added",
        desc: `You can now share files on ${host}.`,
        primary: true,
      }
    case "already":
      return {
        icon: "laptop",
        tone: "neutral",
        title: "Already added",
        desc: `This device can already share on ${host}. Nothing to do.`,
        primary: false,
      }
    case "expired":
      return {
        icon: "clock-alert",
        tone: "neutral",
        title: "This link has expired",
        desc: "Make a new one on the other device: Settings › Multiplayer, Add device.",
        primary: false,
      }
    case "used":
      return {
        icon: "link-2-off",
        tone: "neutral",
        title: "This link was already used",
        desc: "Make a new one on the other device: Settings › Multiplayer, Add device.",
        primary: false,
      }
    case "invalid":
      return {
        icon: "circle-alert",
        tone: "danger",
        title: "This link doesn't work",
        desc: "It may have been cancelled, or the relay was reset. Make a new one on the other device.",
        primary: false,
      }
    case "unreachable":
      return {
        icon: "wifi-off",
        tone: "danger",
        title: "Couldn't reach the relay",
        desc: `${host} did not answer. It may be down, or blocked on this network.`,
        primary: false,
      }
    case "not-a-relay":
      return {
        icon: "server-off",
        tone: "danger",
        title: "This is not a Kimo relay",
        desc: "The link points to a server that does not speak Kimo. Check the link is complete, or ask for a new one.",
        primary: false,
      }
  }
}

/** The outcome of a failed Add device. */
function pairErrorOutcome(error: unknown): PairOutcome {
  const code = error instanceof MultiplayerError ? error.code : null
  switch (code) {
    case "PAIRING_EXPIRED":
      return "expired"
    case "PAIRING_USED":
      return "used"
    case "RELAY_UNREACHABLE":
    case "RATE_LIMITED":
      return "unreachable"
    case "NOT_A_RELAY":
      return "not-a-relay"
    default:
      return "invalid"
  }
}

/** "Works once · 12 min left" (whole minutes, rounded up). */
function pairMeta(exp: number, nowMs: number): string {
  const minutes = Math.max(1, Math.ceil((exp * 1000 - nowMs) / 60_000))
  return `Works once · ${minutes} min left`
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function PairRoute({
  link,
  ownership: given,
  deviceName: givenName,
}: {
  link: string
  /** Harnesses: the device to add instead of this window's. */
  ownership?: OwnershipClient
  deviceName?: string
}) {
  const runtime = useOptionalRuntime()
  const model = useMultiplayer()
  const platform = runtime?.platform ?? null
  const client = given ?? (platform ? ownershipFor(platform) : null)
  const fallbackName = givenName ?? (platform ? deviceNameFor(platform) : "")
  const parsed = useMemo(() => {
    try {
      const l = parsePairingLink(link)
      return { relayUrl: l.relayUrl, exp: parsePairingToken(l.token).exp }
    } catch {
      return null
    }
  }, [link])
  const [name, setName] = useState(fallbackName)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<PairOutcome | null>(() =>
    !parsed ? "invalid" : parsed.exp * 1000 <= Date.now() ? "expired" : null,
  )
  const [now, setNow] = useState(() => Date.now())
  const nameId = useId()

  // The minutes left tick while the card waits.
  useEffect(() => {
    if (outcome) return
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [outcome])

  const host = parsed ? hostOf(parsed.relayUrl) : ""
  const add = async () => {
    if (!client || !parsed || busy) return
    setBusy(true)
    try {
      const result = await client.acceptPairingLink(link, {
        name: name.trim() || fallbackName,
      })
      // The relay becomes this device's default when none is set (§16.9).
      const current = model?.settings.getState().relayUrl ?? null
      if (!current)
        await (model
          ? model.settings.setRelayUrl(result.relayUrl)
          : platform?.settings.set("multiplayer.relayUrl", result.relayUrl)
        )?.catch(() => undefined)
      setOutcome(result.added ? "added" : "already")
    } catch (e) {
      setOutcome(pairErrorOutcome(e))
    } finally {
      setBusy(false)
    }
  }

  if (outcome) {
    const card = outcomeCard(outcome, host)
    return (
      <JoinStage>
        <section
          className="join-card join-card--error"
          role={card.tone === "success" ? "status" : "alert"}
          data-testid="pair-card"
          data-outcome={outcome}
        >
          <div
            className={`join-card__wrap${card.tone === "neutral" ? "" : ` join-card__wrap--${card.tone}`}`}
          >
            <Icon name={card.icon} size={18} />
          </div>
          <div className="join-card__copy">
            <span className="join-card__heading">{card.title}</span>
            <span className="join-card__desc">{card.desc}</span>
          </div>
          <div className="join-card__actions">
            <Button
              variant={card.primary ? "primary" : "ghost"}
              icon={<Icon name="house" size={16} />}
              data-action="open-kimo"
              onClick={() => navigate("/")}
            >
              Open Kimo
            </Button>
          </div>
        </section>
      </JoinStage>
    )
  }

  return (
    <JoinStage>
      <section
        className="join-card"
        data-testid="pair-card"
        data-outcome={busy ? "adding" : "ready"}
      >
        <div className="join-card__head">
          <KimoLogo size={16} variant="small" />
          <div className="join-card__text">
            <span className="join-card__title">Add this device</span>
            <span className="join-card__meta">to {host}</span>
          </div>
        </div>
        <p className="pair-card__desc">
          It can then start sharing files on this relay, like the device that sent the link.
        </p>
        {!busy && parsed && <span className="join-card__meta">{pairMeta(parsed.exp, now)}</span>}
        <div className="pair-card__field">
          <label className="pair-card__label" htmlFor={nameId}>
            Device name
          </label>
          <Input
            id={nameId}
            icon={<Icon name="monitor" size={16} />}
            value={name}
            maxLength={64}
            spellCheck={false}
            autoComplete="off"
            readOnly={busy}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add()
            }}
          />
        </div>
        <div className="pair-card__actions">
          <span className="pair-card__spacer" aria-hidden="true" />
          {!busy && (
            <Button
              variant="ghost"
              className="pair-card__not-now"
              data-action="not-now"
              onClick={() => navigate("/")}
            >
              Not now
            </Button>
          )}
          <Button
            variant="primary"
            className="pair-card__add"
            data-action="add-device"
            data-busy={busy}
            aria-disabled={busy || !client}
            {...(busy ? { icon: <Icon name="loader-circle" size={16} /> } : {})}
            onClick={() => void add()}
          >
            {busy ? "Adding" : "Add device"}
          </Button>
        </div>
      </section>
    </JoinStage>
  )
}
