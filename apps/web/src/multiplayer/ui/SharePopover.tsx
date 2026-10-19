/**
 * Board 41 section 3: the Share popover (360 wide, under Share, right edge on the button's).
 *
 * - A `first-run` (MN5Yp): no relay yet. Intro, Relay URL, the self-hosting guide; Start sharing
 *   stays disabled (0.4) until the URL answers as a Kimo relay.
 * - B `ready` (iCSXL): the relay answered. Relay URL (mono), the check (StatusPill + time), what
 *   starting does; Change in Settings · Start sharing. The check runs on blur and on paste, and
 *   a passing URL is kept in Settings › Multiplayer.
 * - C `live` (c6fdt): Live pill, encryption and connection, a new link (role, expiry, Create link
 *   copies it at once), active links (Copy, Revoke on hover), the E2E note; Reset all links ·
 *   Stop sharing.
 *
 * Revoke is final on the relay, so its toast has no Undo (the board's "Undo" is left out).
 */
import type { Role } from "@kimo/sync/mp"
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
import {
  connectionMeta,
  EXPIRY_LABEL,
  linkCopiedText,
  linkMeta,
  linkRevokedText,
  ROLE_LABEL,
  relayReady,
  relayResultView,
  sharePopoverStage,
} from "./copy"
import { copyText, GuideLink, openRelayGuide, useShareToast } from "./shared"
import "./share-ui.css"

const selectExpiry = (v: DocumentShareView) => v.expiry

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
}

export function SharePopover({ model, docKey, anchor, onClose, onResetAll }: SharePopoverProps) {
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
        <SetupBody model={model} docKey={docKey} firstRun={stage === "first-run"} />
      )}
    </Popover>
  )
}

// --- A / B ---------------------------------------------------------------------------------------

function SetupBody({
  model,
  docKey,
  firstRun,
}: {
  model: MultiplayerModel
  docKey: string
  firstRun: boolean
}) {
  const runtime = useOptionalRuntime()
  const platform = runtime?.platform ?? null
  const openSettings = useOpenSettings()
  const toast = useShareToast()
  const settings = useMultiplayerSettings(model)
  const test = useRelayTest(model)
  const share = useShareState(model, docKey)
  const [url, setUrl] = useState(settings.relayUrl ?? "")
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

  // B: a saved relay is checked when the popover opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per open
  useEffect(() => {
    if (settings.relayUrl && !relayReady(test, settings.relayUrl)) void check(settings.relayUrl)
  }, [])

  // Start sharing needs a Kimo relay for what the field says now (checked on blur and paste).
  const canStart =
    test.kind === "ok" && url.trim() === checked.current && share.status !== "starting"
  const start = async () => {
    if (test.kind !== "ok") return
    try {
      await model.document(docKey).startSharing({ relayUrl: test.url })
    } catch (e) {
      toast({ tone: "danger", text: failureText("start sharing", e) })
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
          <StatusPill status="linked" label={result.pill} />
          <span className="mp-meta-mono">{result.time}</span>
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
        {field}
        {resultRow}
        {firstRun ? (
          <GuideLink
            label="How to host a relay, about 5 minutes"
            leadingIcon
            onOpen={() => void openRelayGuide(platform)}
          />
        ) : (
          <p className="mp-desc">
            Starting gives this file a new encryption key. Nothing leaves this device until you
            create a link.
          </p>
        )}
      </div>
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

  return (
    <>
      <div className="mp-body mp-body--live">
        <div className="mp-connection">
          <span className="mp-icon-wrap mp-icon-wrap--28" aria-hidden="true">
            <Icon name="lock" size={14} />
          </span>
          <div className="mp-text mp-text--2">
            <p className="mp-label-strong">End-to-end encrypted</p>
            <span className="mp-meta-mono">
              {connectionMeta(share.relayHost, share.othersOnline)}
            </span>
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
              <div key={l.jti} className="mp-link" data-role={l.role}>
                <span className="mp-link__role" aria-hidden="true">
                  <Icon name={l.role === "edit" ? "pencil" : "eye"} size={14} />
                </span>
                <div className="mp-text mp-text--2">
                  <span className="mp-label-strong">{ROLE_LABEL[l.role]}</span>
                  <span className="mp-meta">{linkMeta(l, now)}</span>
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
            The key rides after the # in each link and never reaches the relay. Anyone with a link
            can join until it expires or you revoke it.
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
