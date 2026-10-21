/**
 * Board 43 leaf pieces shared by the wizard, the Share popover and Settings › Multiplayer: the
 * error and plan fragments (6 D payment failed, 6 E offline, 6 F storage full), the storage bar,
 * the plan pill, the device rows and the sign out dialogs (5 B, 5 C).
 */
import { Badge, Button, Dialog, DialogScrim, IconButton } from "@kimo/ui"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Icon } from "../../lib/icons"
import type { CloudAccount, CloudDevice } from "../cloud/types"
import {
  deviceMeta,
  paymentFailedDesc,
  planPill,
  storageLevel,
  storageRatio,
  storageText,
} from "../cloud/view"
import { deviceIcon } from "./DevicesSetting"
import { Pill, Spacer } from "./relay-parts"
import "./cloud.css"

export type CloudNoticeKind = "payment-failed" | "offline" | "storage-full"

/**
 * Body Fragment (6 D k4gPbV, 6 E N1BykX, 6 F y7hC7F): Target (icon, mono label, StatusPill) ·
 * Message (title, desc) · Actions (one Button/Secondary 26). `framed` draws the fragment's card.
 */
export function CloudNotice({
  kind,
  account,
  framed,
  busy,
  onAction,
}: {
  kind: CloudNoticeKind
  account: CloudAccount | null
  framed?: boolean
  busy?: boolean
  onAction(): void
}) {
  const v =
    kind === "payment-failed"
      ? {
          icon: "credit-card",
          label: account?.account.email ?? "",
          pill: { tone: "warning" as const, label: "Past due" },
          title: "Payment failed",
          desc: account
            ? paymentFailedDesc(account.plan)
            : "We could not charge your card. Nothing has stopped yet.",
          action: { icon: "external-link", label: "Update payment" },
        }
      : kind === "offline"
        ? {
            icon: "cloud",
            label: "Kimo Cloud",
            pill: { tone: "danger" as const, label: "Offline" },
            title: "Can't reach Kimo Cloud",
            desc: "Check your connection. Files already shared sync again as soon as you are back online.",
            action: { icon: "refresh-cw", label: "Try again" },
          }
        : {
            icon: "hard-drive",
            label: account ? storageText(account.usage) : "Storage",
            pill: { tone: "danger" as const, label: "Full" },
            title: "Kimo Cloud storage is full",
            desc: "New images and fonts in shared files will not sync. Edits still do. Stop sharing files you no longer need to free space.",
            action: { icon: "external-link", label: "Manage billing" },
          }
  return (
    <div
      className={`cloud-notice${framed ? " cloud-notice--framed" : ""}`}
      data-notice={kind}
      role={kind === "offline" ? "status" : undefined}
    >
      <div className="cloud-notice__target">
        <span className="cloud-notice__icon" aria-hidden="true">
          <Icon name={v.icon} size={14} />
        </span>
        <span className="cloud-notice__label">{v.label}</span>
        <Spacer />
        <Pill tone={v.pill.tone} label={v.pill.label} />
      </div>
      <div className="cloud-notice__message">
        <p className="cloud-notice__title">{v.title}</p>
        <p className="cloud-notice__desc">{v.desc}</p>
      </div>
      <div className="cloud-notice__actions">
        <Button
          variant="secondary"
          className="cloud-notice__action"
          icon={<Icon name={v.action.icon} size={16} />}
          data-action={kind}
          disabled={busy}
          onClick={onAction}
        >
          {v.action.label}
        </Button>
      </div>
    </div>
  )
}

/** The plan's StatusPill (Active, Past due, Ended, No plan). */
export function PlanPill({ account }: { account: CloudAccount }) {
  return <Pill {...planPill(account.plan)} />
}

/** Row · Storage (r2rda): Key · Bar (Used) · Value mono. */
export function StorageRow({ account }: { account: CloudAccount }) {
  const ratio = storageRatio(account.usage)
  return (
    <div className="mp-kv" data-row="storage">
      <span className="mp-kv__key">Storage</span>
      <div className="mp-storage" data-level={storageLevel(account.usage)} aria-hidden="true">
        <div className="mp-storage__used" style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="mp-kv__value mp-kv__value--mono">{storageText(account.usage)}</span>
    </div>
  )
}

/**
 * Device (c2MBrH, I5VPa, PziNJ): the board 41 row (Icon Wrap 28, name, This device, meta) with
 * Rename (pencil) and Sign out (log-out, danger) on hover for another device.
 */
export function CloudDeviceRow({
  device,
  now,
  renaming,
  onRename,
  onSaveName,
  onCancelRename,
  onSignOut,
}: {
  device: CloudDevice
  now: number
  renaming?: boolean
  onRename?(): void
  onSaveName?(name: string): void
  onCancelRename?(): void
  onSignOut?(): void
}) {
  return (
    <li
      className="mp-device"
      data-self={device.self || undefined}
      data-renaming={renaming || undefined}
    >
      <span className="mp-device__icon" aria-hidden="true">
        <Icon name={deviceIcon(device.name)} size={14} />
      </span>
      <span className="mp-device__text">
        <span className="mp-device__name-row">
          {renaming && onSaveName ? (
            <NameField name={device.name} onSave={onSaveName} onCancel={() => onCancelRename?.()} />
          ) : (
            <span className="mp-device__name">{device.name}</span>
          )}
          {device.self && <Badge className="mp-device__self">This device</Badge>}
        </span>
        <span className="mp-device__meta">{deviceMeta(device.linkedAt, now)}</span>
      </span>
      {!renaming && (onRename || onSignOut) && (
        <span className="mp-device__actions">
          {onRename && (
            <IconButton
              className="mp-device__rename"
              label={`Rename ${device.name}`}
              icon={<Icon name="pencil" size={14} />}
              size="sm"
              tone="ghost"
              onClick={onRename}
            />
          )}
          {onSignOut && (
            <IconButton
              className="mp-device__sign-out"
              label={`Sign out ${device.name}`}
              icon={<Icon name="log-out" size={14} />}
              size="sm"
              tone="ghost"
              onClick={onSignOut}
            />
          )}
        </span>
      )}
    </li>
  )
}

function NameField({
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

/**
 * Sign out (5 B CddxB, 5 C tr7xZ): Dialog (bDVhS) with log-out, no body or footnote, Cancel and
 * Sign out. `device` null signs this device out.
 */
export function CloudSignOutDialog({
  device,
  inline,
  onCancel,
  onConfirm,
}: {
  device: CloudDevice | null
  inline?: boolean
  onCancel(): void
  onConfirm(): void
}) {
  const dialog = (
    <Dialog
      className="mp-cloud-sign-out"
      data-device={device ? "other" : "self"}
      icon={<Icon name="log-out" size={16} />}
      title={device ? `Sign out ${device.name}?` : "Sign out of Kimo Cloud?"}
      description={
        device
          ? "It can no longer start sharing on Kimo Cloud. Files it already shared keep syncing."
          : "This device stops starting new shares. Files already shared keep syncing for everyone, and your plan keeps running."
      }
      confirmLabel="Sign out"
      {...(inline ? { inline: true } : {})}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
  if (inline) return dialog
  return createPortal(<DialogScrim className="rw-scrim">{dialog}</DialogScrim>, document.body)
}
