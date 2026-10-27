/**
 * Board 41 section 3: the Share popover (360 wide, under Share, right edge on the button's).
 *
 * - A `first-run` (MN5Yp, board 42 section 1 A): no relay yet. Intro, Set up a relay (Primary,
 *   full width: the relay setup wizard over the editor), "or use one you have", Relay URL; Start
 *   sharing stays disabled (0.4) until the URL answers as a Kimo relay that is yours or not
 *   claimed yet.
 * - B `ready` (iCSXL): the relay answered. Relay URL (mono), the check (ownership StatusPill and
 *   "Kimo relay 1.2 · 84 ms"), what starting does; Change in Settings · Start sharing. The check
 *   runs on blur and on paste, and a passing URL is kept in Settings › Multiplayer.
 * - G (nGLDi): a relay nobody claimed yet ("Not set up yet"): Start sharing claims it for this
 *   device first (ADR 0017). H (vy9jb): another Kimo's relay ("Not yours"): the Fix with Add this
 *   device (I, the steps) and Reset ownership (the guide); Start sharing disabled.
 * - C `live` (c6fdt): Live pill, encryption and connection, a new link (role, expiry, Create link
 *   copies it at once), active links (Copy, Revoke on hover), the E2E note; Reset all links ·
 *   Stop sharing.
 *
 * Board 43 (ADR 0018): with Kimo Cloud on, A puts Kimo Cloud first and the self-host field behind
 * Host your own (`CloudShareBody`: 4 A, 4 B, 4 C, 6 A), and a file to share on Kimo Cloud shows
 * its account instead of the relay URL.
 *
 * Revoke is final on the relay, so its toast has no Undo (the board's "Undo" is left out).
 * On a quick tunnel (board 42 section 3 I) every link row says it stops working when the relay
 * restarts.
 */
import type { Role } from "@kimo/sync/mp"
import { MultiplayerError, normalizeRelayUrl } from "@kimo/sync/mp"
import {
  Button,
  IconButton,
  Input,
  Popover,
  type PopoverAnchor,
  SegmentedText,
  Select,
  StatusPill,
} from "@kimo/ui"
import { type ClipboardEvent, useEffect, useId, useRef, useState } from "react"
import { failureText } from "../../editor/errors"
import { Icon } from "../../lib/icons"
import { useOpenSettings, useOptionalRuntime } from "../../platform/runtime"
import {
  useDocumentShare,
  useMultiplayerSettings,
  useRelayTest,
  useShareLinks,
  useShareState,
} from "../hooks"
import {
  DEFAULT_EXPIRY,
  type DocumentShareView,
  EXPIRY_CHOICES,
  type ExpiryChoice,
  type LinkView,
  type MultiplayerModel,
} from "../model"
import { isQuickTunnelUrl } from "../relay-setup/local"
import {
  useCloudState,
  useRelaySetupServices,
  useRelaySetupStateOrNull,
} from "../relay-setup/services"
import { CloudShareBody } from "./CloudShare"
import {
  EXPIRY_LABEL,
  linkCopiedText,
  linkMeta,
  linkRevokedText,
  ownerPill,
  ROLE_LABEL,
  relayReady,
  relayResultView,
  sharePopoverStage,
} from "./copy"
import { AddThisDeviceDialog, NOT_YOURS_SHORT, NotYoursFix, RESET_OWNERSHIP_URL } from "./ownership"
import type { WizardStart } from "./RelayWizard"
import { Pill } from "./relay-parts"
import { copyText, GuideLink, openRelayGuide, useShareToast } from "./shared"
import "./share-ui.css"

const selectExpiry = (v: DocumentShareView) => v.expiry

/**
 * Whether a Kimo Cloud share must save Kimo Cloud's relay URL over `saved` (the saved URL when
 * Kimo Cloud is the chosen relay, else null). Its answer always wins: the hosted relay can move
 * (a custom domain replacing the provider's), and a stale URL puts the old host in every link.
 */
export function cloudRelayChanged(saved: string | null, answer: string): boolean {
  return saved === null || saved !== normalizeRelayUrl(answer)
}

const ROLE_OPTIONS = [
  { value: "view" as const, label: ROLE_LABEL.view },
  { value: "edit" as const, label: ROLE_LABEL.edit },
]

const EXPIRY_OPTIONS = EXPIRY_CHOICES.map((c) => ({
  value: c,
  label: EXPIRY_LABEL[c],
  ...(c === DEFAULT_EXPIRY ? { meta: "default", metaFont: "mono" as const } : {}),
}))

export interface SharePopoverProps {
  model: MultiplayerModel
  docKey: string
  anchor: PopoverAnchor | null
  onClose(): void
  /** Reset all links: the confirm dialog (it lives outside the popover). */
  onResetAll(): void
  /** Set up a relay: the relay setup wizard (it lives outside the popover), at `start`. */
  onSetUpRelay?(start?: WizardStart): void
}

export function SharePopover({
  model,
  docKey,
  anchor,
  onClose,
  onResetAll,
  onSetUpRelay,
}: SharePopoverProps) {
  const share = useShareState(model, docKey)
  const settings = useMultiplayerSettings(model)
  const stage = sharePopoverStage(share, settings.relayUrl)
  return (
    <Popover
      className="mp-popover"
      label="Share"
      data-stage={stage}
      headerLeading={
        <div className="kimo-popover__leading">
          <span className="kimo-popover__title">Share</span>
          {stage === "live" && <StatusPill status="linked" label="Live" className="mp-live" />}
        </div>
      }
      actions={
        <IconButton
          className="mp-close"
          label="Close"
          icon={<Icon name="x" size={14} />}
          size="sm"
          tone="ghost"
          onClick={onClose}
        />
      }
      {...(anchor ? { anchor, placement: { side: "bottom", align: "end", offset: 4 } } : {})}
      onClose={onClose}
    >
      {stage === "live" ? (
        <LiveBody model={model} docKey={docKey} onResetAll={onResetAll} />
      ) : (
        <SetupBody
          model={model}
          docKey={docKey}
          firstRun={stage === "first-run"}
          {...(onSetUpRelay ? { onSetUpRelay } : {})}
        />
      )}
    </Popover>
  )
}

// --- A / B ---------------------------------------------------------------------------------------

function SetupBody({
  model,
  docKey,
  firstRun,
  onSetUpRelay,
}: {
  model: MultiplayerModel
  docKey: string
  firstRun: boolean
  onSetUpRelay?(start?: WizardStart): void
}) {
  const runtime = useOptionalRuntime()
  const platform = runtime?.platform ?? null
  const relaySetup = useRelaySetupServices(platform)
  const cloud = relaySetup?.cloud ?? null
  const cloudState = useCloudState(cloud)
  const setup = useRelaySetupStateOrNull(relaySetup?.store ?? null)
  const [addThisDevice, setAddThisDevice] = useState(false)
  const openSettings = useOpenSettings()
  const toast = useShareToast()
  const settings = useMultiplayerSettings(model)
  const test = useRelayTest(model)
  const share = useShareState(model, docKey)
  // Kimo Cloud's relay is not a self-hosted one: the Host your own field starts empty (6 A).
  const [url, setUrl] = useState(
    cloud !== null && setup?.path === "cloud" ? "" : (settings.relayUrl ?? ""),
  )
  const fieldId = useId()
  const checked = useRef<string | null>(
    settings.relayUrl && relayReady(test, settings.relayUrl) ? settings.relayUrl : null,
  )

  const check = async (value: string) => {
    const v = value.trim()
    if (v === checked.current && test.kind !== "idle") return
    checked.current = v
    if (v === "") {
      model.relayTest.reset()
      return
    }
    const result = await model.relayTest.test(v)
    // A relay that answers is kept in Settings › Multiplayer ("Set once, kept in Settings").
    if (result.kind === "ok" && result.url !== settings.relayUrl)
      await model.settings.setRelayUrl(result.url).catch(() => undefined)
  }

  // Board 43: Kimo Cloud is the saved relay, or there is none yet: its account picks the body.
  const cloudRelay = cloud !== null && setup?.path === "cloud" && settings.relayUrl !== null
  const cloudView = cloud !== null && cloudState !== null && (firstRun || cloudRelay)

  // B: a saved relay is checked when the popover opens; Kimo Cloud's account is refreshed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per open
  useEffect(() => {
    // Kimo Cloud is asked only when this popover shows it: prices for the first run's Kimo Cloud
    // body, the account once this device chose Kimo Cloud (the wizard asks when it is picked). A
    // self-hosted relay's popover sends nothing to Kimo Cloud.
    if (cloud && cloudView) {
      void cloud.loadPlans()
      if (setup?.path === "cloud") void cloud.refresh()
    }
    if (cloudRelay) return
    if (settings.relayUrl && !relayReady(test, settings.relayUrl)) void check(settings.relayUrl)
  }, [])

  // Start sharing needs a Kimo relay for what the field says now (checked on blur and paste) that
  // is not another Kimo's: an unclaimed one is claimed first, by the share service (§16.9).
  const notYours = test.kind === "ok" && test.owner === "other"
  const canStart =
    test.kind === "ok" && !notYours && url.trim() === checked.current && share.status !== "starting"
  const start = async () => {
    if (test.kind !== "ok") return
    try {
      await model.document(docKey).startSharing({ relayUrl: test.url })
    } catch (e) {
      // Claimed by another Kimo since the check: test again, so the Fix shows in place.
      if (e instanceof MultiplayerError && (e.code === "NOT_OWNER" || e.code === "RELAY_CLAIMED"))
        await model.relayTest.test(test.url)
      else toast({ tone: "danger", text: failureText("start sharing", e) })
    }
  }
  const result = relayResultView(test)

  const field = (
    <div className="mp-field" data-pen="mHqqj">
      <label className="mp-field-label" htmlFor={fieldId}>
        Relay URL
      </label>
      <Input
        id={fieldId}
        frameProps={{ className: "mp-relay-input" }}
        icon={<Icon name="server" size={16} />}
        placeholder="wss://relay.example.com"
        spellCheck={false}
        autoComplete="off"
        value={url}
        onChange={(e) => setUrl(e.currentTarget.value)}
        onBlur={(e) => void check(e.currentTarget.value)}
        onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
          const el = e.currentTarget
          // After the paste lands in the field.
          setTimeout(() => void check(el.value), 0)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void check(e.currentTarget.value)
        }}
      />
    </div>
  )

  const resultRow = result && (
    <div className="mp-result" data-result={result.kind} role="status">
      {result.kind === "ok" ? (
        <>
          <Pill {...ownerPill(result.owner, "popover", result.relay)} />
          <span className="mp-meta-mono">
            {result.relay} · {result.ms} ms
          </span>
        </>
      ) : result.kind === "testing" ? (
        <>
          <span className="mp-result__icon mp-result__icon--testing">
            <Icon name="loader-circle" size={14} />
          </span>
          <span className="mp-result__text mp-result__text--testing">{result.text}</span>
        </>
      ) : (
        <>
          <span className={`mp-result__icon mp-result__icon--${result.kind}`}>
            <Icon name={result.icon} size={14} />
          </span>
          <p className="mp-result__text">{result.text}</p>
        </>
      )}
    </div>
  )

  if (cloudView && cloud && cloudState) {
    const startCloud = async () => {
      const relay = await cloud.relay()
      let relayUrl = settings.relayUrl
      if (relayUrl === null || cloudRelayChanged(cloudRelay ? relayUrl : null, relay.relayUrl))
        relayUrl = (await model.settings.setRelayUrl(relay.relayUrl)) ?? relay.relayUrl
      if (!cloudRelay) await relaySetup?.store.save({ patch: { path: "cloud" } })
      await model.document(docKey).startSharing({ relayUrl })
    }
    const fix =
      test.kind === "ok" && test.owner === "other" ? (
        <NotYoursFix
          desc={NOT_YOURS_SHORT}
          iconSize={14}
          onAddThisDevice={() => setAddThisDevice(true)}
          onResetOwnership={() =>
            void (platform
              ? platform.files.openExternalUrl(RESET_OWNERSHIP_URL)
              : window.open(RESET_OWNERSHIP_URL, "_blank", "noopener"))
          }
        />
      ) : null
    return (
      <>
        <CloudShareBody
          cloud={cloud}
          state={cloudState}
          cloudRelay={cloudRelay}
          hostOpenInitially={url.trim() !== ""}
          hostContent={
            <>
              {onSetUpRelay && (
                <Button
                  variant="secondary"
                  className="mp-setup-relay mp-setup-relay--secondary"
                  data-action="set-up-relay"
                  icon={<Icon name="wand-sparkles" size={16} />}
                  onClick={() => onSetUpRelay("choose")}
                >
                  Set up a relay
                </Button>
              )}
              {field}
              {resultRow}
              {fix}
            </>
          }
          canStartSelf={canStart}
          startingSelf={share.status === "starting"}
          onStartSelf={() => void start()}
          onStartCloud={startCloud}
          starting={share.status === "starting"}
          onWizard={(start) => onSetUpRelay?.(start)}
        />
        {addThisDevice && (
          <AddThisDeviceDialog
            host={hostOfUrl(test.kind === "ok" ? test.url : url)}
            onClose={() => setAddThisDevice(false)}
          />
        )}
      </>
    )
  }

  return (
    <>
      <div className="mp-body">
        {firstRun && (
          <div className="mp-intro">
            <span className="mp-icon-wrap" aria-hidden="true">
              <Icon name="server" size={16} />
            </span>
            <div className="mp-text">
              <p className="mp-title">Share through your own relay</p>
              <p className="mp-desc">
                Kimo runs no server. Edits travel end-to-end encrypted through a relay you host, and
                the relay never sees the design.
              </p>
            </div>
          </div>
        )}
        {firstRun && onSetUpRelay && (
          <>
            <Button
              variant="primary"
              className="mp-setup-relay"
              icon={<Icon name="wand-sparkles" size={16} />}
              onClick={() => onSetUpRelay()}
            >
              Set up a relay
            </Button>
            <div className="mp-or" data-pen="HxQ2J">
              <span className="mp-or__line" aria-hidden="true" />
              <span className="mp-or__label">or use one you have</span>
              <span className="mp-or__line" aria-hidden="true" />
            </div>
          </>
        )}
        {field}
        {resultRow}
        {test.kind === "ok" && test.owner === "other" ? (
          <NotYoursFix
            desc={NOT_YOURS_SHORT}
            iconSize={14}
            onAddThisDevice={() => setAddThisDevice(true)}
            onResetOwnership={() =>
              void (platform
                ? platform.files.openExternalUrl(RESET_OWNERSHIP_URL)
                : window.open(RESET_OWNERSHIP_URL, "_blank", "noopener"))
            }
          />
        ) : test.kind === "ok" && test.owner === "unclaimed" ? (
          <p className="mp-desc">
            Kimo will claim it when you start sharing, so only your devices can share on it. Nothing
            leaves this device until you create a link.
          </p>
        ) : firstRun ? (
          !onSetUpRelay && (
            <GuideLink
              label="How to host a relay, about 5 minutes"
              leadingIcon
              onOpen={() => void openRelayGuide(platform)}
            />
          )
        ) : (
          <p className="mp-desc">
            Starting gives this file a new encryption key. Nothing leaves this device until you
            create a link.
          </p>
        )}
      </div>
      {addThisDevice && (
        <AddThisDeviceDialog
          host={hostOfUrl(test.kind === "ok" ? test.url : url)}
          onClose={() => setAddThisDevice(false)}
        />
      )}
      <div className="mp-footer">
        {firstRun ? (
          <span className="mp-footnote">Set once, kept in Settings</span>
        ) : (
          <Button
            variant="ghost"
            className="mp-button mp-button--small-label"
            onClick={() => void openSettings("multiplayer")}
          >
            Change in Settings
          </Button>
        )}
        <span className="mp-spacer" aria-hidden="true" />
        <Button
          variant="primary"
          className="mp-button mp-start"
          icon={<Icon name="radio" size={16} />}
          disabled={!canStart}
          onClick={() => void start()}
        >
          {share.status === "starting" ? "Starting…" : "Start sharing"}
        </Button>
      </div>
    </>
  )
}

// --- C -------------------------------------------------------------------------------------------

function LiveBody({
  model,
  docKey,
  onResetAll,
}: {
  model: MultiplayerModel
  docKey: string
  onResetAll(): void
}) {
  const runtime = useOptionalRuntime()
  const platform = runtime?.platform ?? null
  const toast = useShareToast()
  const share = useShareState(model, docKey)
  const links = useShareLinks(model, docKey)
  const expiry = useDocumentShare(model, docKey, selectExpiry)
  const doc = model.document(docKey)
  const [role, setRole] = useState<Role>("edit")
  const [busy, setBusy] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: once per open
  useEffect(() => {
    void doc.refreshLinks()
  }, [])

  const create = async () => {
    setBusy(true)
    try {
      const link = await doc.createLink(role, expiry)
      await copyText(platform, link.link).catch(() => undefined)
      toast({ tone: "success", icon: "link", text: linkCopiedText(link, Date.now()) })
    } catch (e) {
      toast({
        tone: "danger",
        text: failureText("create the link", e),
        action: { label: "Retry", run: () => void create() },
      })
    } finally {
      setBusy(false)
    }
  }
  const copy = async (link: LinkView) => {
    try {
      await copyText(platform, link.link)
      toast({ tone: "success", icon: "link", text: linkCopiedText(link, Date.now()) })
    } catch (e) {
      toast({ tone: "danger", text: failureText("copy the link", e) })
    }
  }
  const revoke = async (link: LinkView) => {
    try {
      await doc.revokeLink(link.jti)
      toast({ tone: "component", icon: "link-2-off", text: linkRevokedText(link.role) })
    } catch (e) {
      toast({
        tone: "danger",
        text: failureText("revoke the link", e),
        action: { label: "Retry", run: () => void revoke(link) },
      })
    }
  }
  const stop = async () => {
    try {
      await doc.stopSharing()
    } catch (e) {
      toast({ tone: "danger", text: failureText("stop sharing", e) })
    }
  }
  const now = Date.now()
  // Board 42 section 3 I: a trycloudflare.com address changes when the relay restarts.
  const quickTunnel = isQuickTunnelUrl(share.relayHost ? `https://${share.relayHost}` : null)

  return (
    <>
      <div className="mp-body mp-body--live">
        <div className="mp-connection">
          <span className="mp-icon-wrap mp-icon-wrap--28" aria-hidden="true">
            <Icon name="lock" size={14} />
          </span>
          <div className="mp-text mp-text--2">
            <p className="mp-label-strong">End-to-end encrypted</p>
            {share.relayHost && <span className="mp-meta-mono">{share.relayHost}</span>}
          </div>
        </div>
        <div className="mp-field" data-pen="r8JQX">
          <span className="mp-field-label">New link</span>
          <div className="mp-controls">
            <SegmentedText
              label="Role"
              options={ROLE_OPTIONS}
              value={role}
              onChange={(v) => setRole(v)}
            />
            <Select
              dense
              label="Expiry"
              menuWidth={232}
              options={EXPIRY_OPTIONS}
              value={expiry}
              onChange={(v: ExpiryChoice) => doc.setExpiry(v)}
            />
            <Button
              variant="primary"
              className="mp-button mp-create"
              icon={<Icon name="link" size={16} />}
              disabled={busy}
              onClick={() => void create()}
            >
              Create link
            </Button>
          </div>
        </div>
        {links.items.length > 0 && (
          <div className="mp-links" data-pen="BeO20">
            <div className="mp-links__head">
              <span className="mp-field-label">Active links · {links.items.length}</span>
            </div>
            {links.items.map((l) => (
              <div
                key={l.jti}
                className={`mp-link${quickTunnel ? " mp-link--quick" : ""}`}
                data-role={l.role}
              >
                <span className="mp-link__role" aria-hidden="true">
                  <Icon name={l.role === "edit" ? "pencil" : "eye"} size={14} />
                </span>
                <div className="mp-text mp-text--2">
                  <span className="mp-label-strong">{ROLE_LABEL[l.role]}</span>
                  <span className="mp-meta">{linkMeta(l, now)}</span>
                  {quickTunnel && (
                    <span className="mp-quick-note" data-pen="m1FYw">
                      <Icon name="triangle-alert" size={11} />
                      Stops working when your relay restarts
                    </span>
                  )}
                </div>
                <IconButton
                  className="mp-link__action mp-link__copy"
                  label={`Copy ${ROLE_LABEL[l.role].toLowerCase()} link`}
                  icon={<Icon name="copy" size={14} />}
                  size="sm"
                  tone="ghost"
                  onClick={() => void copy(l)}
                />
                <IconButton
                  className="mp-link__action mp-link__revoke"
                  label={`Revoke ${ROLE_LABEL[l.role].toLowerCase()} link`}
                  icon={<Icon name="link-2-off" size={14} />}
                  size="sm"
                  tone="ghost"
                  onClick={() => void revoke(l)}
                />
              </div>
            ))}
          </div>
        )}
        <div className="mp-note">
          <span className="mp-note__icon" aria-hidden="true">
            <Icon name="key-round" size={14} />
          </span>
          <p className="mp-desc mp-note__text">
            Links open in any browser, or in Kimo when it's installed. The key rides after the # and
            never reaches the relay.
          </p>
        </div>
      </div>
      <div className="mp-footer">
        <Button
          variant="ghost"
          className="mp-button mp-button--danger mp-reset"
          icon={<Icon name="rotate-ccw" size={16} />}
          onClick={onResetAll}
        >
          Reset all links
        </Button>
        <span className="mp-spacer" aria-hidden="true" />
        <Button variant="secondary" className="mp-button mp-stop" onClick={() => void stop()}>
          Stop sharing
        </Button>
      </div>
    </>
  )
}

const hostOfUrl = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
