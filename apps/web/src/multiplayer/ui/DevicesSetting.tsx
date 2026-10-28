/**
 * Board 41 section 4, Settings › Multiplayer › Devices (gon1u, ADR 0017): shown when the relay is
 * yours. Text (Devices, what it means) · List (one row per device: Icon Wrap 28 with laptop or
 * globe, name, This device badge, "Added Oct 2"; Rename and Remove on hover, Remove disabled with
 * a tooltip on the last device) · the one-device hint (PdZQM) · Footer (Add device, "Makes a link
 * that works once, for 15 minutes").
 *
 * Rename (cnn3R) turns the name into a field in place: Enter or blur saves, Escape cancels.
 * Remove confirms on Dialog (BwiGq, CbSGE). Add device opens the sheet (sgnIX): the link, copied
 * at once (Copied for 2 s), a live countdown, Cancel link · Done; then Added (a4X5zv) when the
 * other device used it, or Expired (ttfhE) with New link.
 */
import { Badge, Button, Dialog, DialogScrim, IconButton, Tooltip } from "@kimo/ui"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { failureText } from "../../editor/errors"
import { Icon } from "../../lib/icons"
import type { IssuedPairingLink, OwnershipClient, RelayDevice } from "../ownership"
import { useShareToast } from "./shared"
import "./share-ui.css"

/** How often the open sheet asks the relay whether the link was used. */
const PAIRED_POLL_MS = 3000
/** Copy shows Copied this long. */
const COPIED_MS = 2000

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "Added Oct 2" (the year only when it is not this one). */
function addedText(addedAt: number, now: number = Date.now()): string {
  const d = new Date(addedAt)
  const year = d.getFullYear() === new Date(now).getFullYear() ? "" : ` ${d.getFullYear()}`
  return `Added ${MONTHS[d.getMonth()]} ${d.getDate()}${year}`
}

/** A browser ("Chrome on Windows") shows the globe; the desktop app ("Mac") the laptop. */
export const deviceIcon = (name: string) => (/ on /.test(name) ? "globe" : "laptop")

/** "Waiting for the other device · 14:58 left". */
function countdownText(exp: number, now: number): string {
  const left = Math.max(0, Math.ceil(exp - now / 1000))
  const m = Math.floor(left / 60)
  const s = String(left % 60).padStart(2, "0")
  return `Waiting for the other device · ${m}:${s} left`
}

/** "Expired at 10:47" (24-hour local time). */
export function expiredText(exp: number): string {
  const d = new Date(exp * 1000)
  return `Expired at ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`
}

/** The link as the sheet shows it: no scheme, the token cut short (`getkimo.design/pair#Q7mK2vX9…`). */
function shownPairingLink(link: string): string {
  const hash = link.indexOf("#")
  if (hash < 0) return link
  const head = link.slice(0, hash).replace(/^https?:\/\//, "")
  const token = link.slice(link.lastIndexOf("/") + 1)
  return `${head}#${token.slice(0, 8)}…`
}

export interface DevicesSettingProps {
  ownership: OwnershipClient
  relayUrl: string
  devices: RelayDevice[]
  /** The list after a change (rename, remove, a paired device). */
  onDevices(devices: RelayDevice[]): void
  /** This device removed itself: the relay is no longer yours. */
  onRemovedSelf(): void
  copy(text: string): Promise<void>
}

export function DevicesSetting(props: DevicesSettingProps) {
  const { ownership, relayUrl, devices, onDevices } = props
  const toast = useShareToast()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [removing, setRemoving] = useState<RelayDevice | null>(null)
  const [sheet, setSheet] = useState(false)
  const last = devices.length <= 1

  const rename = async (device: RelayDevice, name: string) => {
    setRenaming(null)
    const next = name.trim()
    if (!next || next === device.name) return
    try {
      onDevices(await ownership.renameDevice(relayUrl, device.pub, next))
    } catch (e) {
      toast({ tone: "danger", text: failureText("rename the device", e) })
    }
  }
  const remove = async (device: RelayDevice) => {
    setRemoving(null)
    try {
      const next = await ownership.removeDevice(relayUrl, device.pub)
      if (device.self) props.onRemovedSelf()
      else onDevices(next)
    } catch (e) {
      toast({ tone: "danger", text: failureText("remove the device", e) })
    }
  }

  return (
    <div className="mp-setting mp-devices" data-pen="gon1u">
      <div className="mp-text mp-text--2">
        <p className="mp-setting__label">Devices</p>
        <p className="mp-desc">
          Only these can start sharing on this relay. Anyone with a link can still join.
        </p>
      </div>
      <ul className="mp-device-list" aria-label="Devices">
        {devices.map((d) => (
          <li
            key={d.pub}
            className="mp-device"
            data-self={d.self || undefined}
            data-renaming={renaming === d.pub || undefined}
          >
            <span className="mp-device__icon" aria-hidden="true">
              <Icon name={deviceIcon(d.name)} size={14} />
            </span>
            <span className="mp-device__text">
              <span className="mp-device__name-row">
                {renaming === d.pub ? (
                  <RenameField
                    name={d.name}
                    onSave={(v) => void rename(d, v)}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <span className="mp-device__name">{d.name}</span>
                )}
                {d.self && <Badge className="mp-device__self">This device</Badge>}
              </span>
              <span className="mp-device__meta">{addedText(d.addedAt)}</span>
            </span>
            {renaming !== d.pub && (
              <span className="mp-device__actions">
                <IconButton
                  className="mp-device__rename"
                  label={`Rename ${d.name}`}
                  icon={<Icon name="pencil" size={14} />}
                  size="sm"
                  tone="ghost"
                  onClick={() => setRenaming(d.pub)}
                />
                {last ? (
                  <Tooltip label="A relay needs at least one device">
                    <span className="mp-device__remove-wrap">
                      <IconButton
                        className="mp-device__remove"
                        label={`Remove ${d.name}`}
                        icon={<Icon name="trash-2" size={14} />}
                        size="sm"
                        tone="ghost"
                        disabled
                      />
                    </span>
                  </Tooltip>
                ) : (
                  <IconButton
                    className="mp-device__remove"
                    label={`Remove ${d.name}`}
                    icon={<Icon name="trash-2" size={14} />}
                    size="sm"
                    tone="ghost"
                    onClick={() => setRemoving(d)}
                  />
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {last && (
        <div className="mp-device-hint" data-pen="PdZQM">
          <span className="mp-device-hint__icon" aria-hidden="true">
            <Icon name="info" size={12} />
          </span>
          <p className="mp-device-hint__text">
            Add another device so you can still manage this relay if this one is lost.
          </p>
        </div>
      )}
      <div className="mp-devices__footer">
        <Button
          variant="secondary"
          className="mp-add-device"
          icon={<Icon name="plus" size={14} />}
          data-action="add-device"
          onClick={() => setSheet(true)}
        >
          Add device
        </Button>
        <span className="mp-meta">Makes a link that works once, for 15 minutes</span>
      </div>
      {removing && (
        <RemoveDeviceDialog
          device={removing}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove(removing)}
        />
      )}
      {sheet && (
        <AddDeviceSheet
          ownership={ownership}
          relayUrl={relayUrl}
          known={devices}
          copy={props.copy}
          onDevices={onDevices}
          onClose={() => setSheet(false)}
        />
      )}
    </div>
  )
}

function RenameField({
  name,
  onSave,
  onCancel,
}: {
  name: string
  onSave(name: string): void
  onCancel(): void
}) {
  const [value, setValue] = useState(name)
  const done = useRef(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      className="mp-device__name-field"
      aria-label="Device name"
      value={value}
      maxLength={64}
      spellCheck={false}
      onChange={(e) => setValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          done.current = true
          onSave(value)
        } else if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          done.current = true
          onCancel()
        }
      }}
      onBlur={() => {
        if (!done.current) onSave(value)
      }}
    />
  )
}

/** Remove (BwiGq, CbSGE): Dialog with the danger icon wrap and a danger confirm. */
function RemoveDeviceDialog({
  device,
  onCancel,
  onConfirm,
  inline,
}: {
  device: Pick<RelayDevice, "name" | "self">
  onCancel(): void
  onConfirm(): void
  inline?: boolean
}) {
  const dialog = (
    <Dialog
      className="mp-remove-device"
      tone="danger"
      width={464}
      icon={<Icon name="trash-2" size={16} />}
      title={device.self ? "Remove this device?" : `Remove ${device.name}?`}
      description={
        device.self
          ? "You will need a link from another device to add it back."
          : "It can no longer start sharing on this relay. Files it already shares keep working."
      }
      confirmLabel="Remove"
      confirmTone="danger"
      inline={inline ?? false}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
  if (inline) return dialog
  return createPortal(<DialogScrim>{dialog}</DialogScrim>, document.body)
}

type SheetState =
  | { kind: "making" }
  | { kind: "link"; link: IssuedPairingLink }
  | { kind: "added"; name: string }
  | { kind: "expired"; link: IssuedPairingLink }

/**
 * The Add device sheet (sgnIX, a4X5zv, ttfhE): 464 wide, column, gap 14, padding 20, bg-overlay,
 * 1px border, radius-xl › Head (Icon Wrap 32 · Title text-md 600 · Desc text-sm secondary) ·
 * Link (Field 32 bg-muted with link icon and the link in mono 11 · Copy) · Status (timer 12 ·
 * mono 11 tertiary) · Footer (spacer · Cancel link · Done).
 */
function AddDeviceSheet({
  ownership,
  relayUrl,
  known,
  copy,
  onDevices,
  onClose,
  inline,
  initial,
  now: clock = Date.now,
}: {
  ownership: OwnershipClient
  relayUrl: string
  known: RelayDevice[]
  copy(text: string): Promise<void>
  onDevices(devices: RelayDevice[]): void
  onClose(): void
  inline?: boolean
  /** Harness specimens: start in this state instead of making a link. */
  initial?: SheetState
  now?: () => number
}) {
  const toast = useShareToast()
  const [state, setState] = useState<SheetState>(initial ?? { kind: "making" })
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(clock)
  const knownPubs = useRef(new Set(known.map((d) => d.pub)))

  const make = useCallback(async () => {
    setState({ kind: "making" })
    try {
      const link = await ownership.createPairingLink(relayUrl)
      setState({ kind: "link", link })
      setNow(clock())
      await copy(link.link).then(
        () => {
          setCopied(true)
          setTimeout(() => setCopied(false), COPIED_MS)
        },
        () => undefined,
      )
    } catch (e) {
      toast({ tone: "danger", text: failureText("make the link", e) })
      onClose()
    }
  }, [ownership, relayUrl, copy, toast, onClose, clock])

  // biome-ignore lint/correctness/useExhaustiveDependencies: once per open
  useEffect(() => {
    if (!initial) void make()
  }, [])

  // The countdown, and the link's end.
  useEffect(() => {
    if (state.kind !== "link" || initial) return
    const t = setInterval(() => {
      const at = clock()
      setNow(at)
      if (state.link.exp * 1000 <= at) setState({ kind: "expired", link: state.link })
    }, 1000)
    return () => clearInterval(t)
  }, [state, clock, initial])

  // Whether the other device used the link: a device this one issued for, added since.
  useEffect(() => {
    if (state.kind !== "link" || initial) return
    let live = true
    const t = setInterval(() => {
      void ownership.listDevices(relayUrl).then(
        (devices) => {
          if (!live) return
          const fresh = devices.find((d) => !knownPubs.current.has(d.pub) && d.via === "pair")
          if (!fresh) return
          onDevices(devices)
          setState({ kind: "added", name: fresh.name })
        },
        () => undefined,
      )
    }, PAIRED_POLL_MS)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [state, ownership, relayUrl, onDevices, initial])

  const cancel = async () => {
    if (state.kind === "link")
      await ownership.cancelPairingLink(relayUrl, state.link).catch((e: unknown) => {
        toast({ tone: "danger", text: failureText("cancel the link", e) })
      })
    onClose()
  }

  const head = (icon: string, tone: "neutral" | "success", title: string, desc: string) => (
    <div className="mp-sheet__head">
      <span className={`mp-sheet__icon${tone === "success" ? " mp-sheet__icon--success" : ""}`}>
        <Icon name={icon} size={16} />
      </span>
      <div className="mp-sheet__text">
        <h2 className="mp-sheet__title">{title}</h2>
        <p className="mp-sheet__desc">{desc}</p>
      </div>
    </div>
  )

  let content: ReactNode
  if (state.kind === "added")
    content = (
      <>
        {head(
          "circle-check",
          "success",
          `Added ${state.name}`,
          "It can now start sharing on this relay.",
        )}
        <div className="mp-sheet__footer">
          <span className="mp-spacer" aria-hidden="true" />
          <Button variant="primary" className="mp-sheet__done" data-action="done" onClick={onClose}>
            Done
          </Button>
        </div>
      </>
    )
  else if (state.kind === "expired")
    content = (
      <>
        {head(
          "timer-off",
          "neutral",
          "This link expired",
          "Nobody used it within 15 minutes. Make a new one to add a device.",
        )}
        <div className="mp-sheet__link">
          <div className="mp-sheet__link-row">
            <span className="mp-sheet__field" data-expired="true">
              <Icon name="link" size={14} />
              <span className="mp-sheet__url">{shownPairingLink(state.link.link)}</span>
            </span>
          </div>
          <span className="mp-sheet__status">
            <Icon name="timer-off" size={12} />
            <span>{expiredText(state.link.exp)}</span>
          </span>
        </div>
        <div className="mp-sheet__footer">
          <span className="mp-spacer" aria-hidden="true" />
          <Button variant="ghost" className="mp-sheet__cancel" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            className="mp-sheet__done"
            icon={<Icon name="refresh-cw" size={16} />}
            data-action="new-link"
            onClick={() => void make()}
          >
            New link
          </Button>
        </div>
      </>
    )
  else {
    const link = state.kind === "link" ? state.link : null
    content = (
      <>
        {head(
          "link",
          "neutral",
          "Add a device",
          "Open this link on the other device. It works once, for 15 minutes.",
        )}
        <div className="mp-sheet__link">
          <div className="mp-sheet__link-row">
            <span className="mp-sheet__field">
              <Icon name="link" size={14} />
              <span className="mp-sheet__url" data-testid="pairing-link">
                {link ? shownPairingLink(link.link) : "Making the link…"}
              </span>
            </span>
            <Button
              variant="secondary"
              className="mp-sheet__copy"
              icon={<Icon name={copied ? "check" : "copy"} size={14} />}
              disabled={!link}
              data-action="copy-link"
              onClick={() => {
                if (!link) return
                void copy(link.link).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), COPIED_MS)
                })
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {link && (
            <span className="mp-sheet__status" role="timer">
              <Icon name="timer" size={12} />
              <span>{countdownText(link.exp, now)}</span>
            </span>
          )}
        </div>
        <div className="mp-sheet__footer">
          <span className="mp-spacer" aria-hidden="true" />
          <Button
            variant="ghost"
            className="mp-sheet__cancel"
            data-action="cancel-link"
            onClick={() => void cancel()}
          >
            Cancel link
          </Button>
          <Button variant="primary" className="mp-sheet__done" data-action="done" onClick={onClose}>
            Done
          </Button>
        </div>
      </>
    )
  }

  const sheet = (
    <div
      className="mp-sheet"
      role="dialog"
      aria-modal={inline ? undefined : "true"}
      aria-label="Add device"
      data-sheet={state.kind}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          onClose()
        }
      }}
    >
      {content}
    </div>
  )
  if (inline) return sheet
  return createPortal(<DialogScrim>{sheet}</DialogScrim>, document.body)
}
