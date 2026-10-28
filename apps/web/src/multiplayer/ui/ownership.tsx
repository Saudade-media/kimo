/**
 * Relay ownership pieces shared by the Share popover (board 41 section 3 H, I), Settings ›
 * Multiplayer (section 4) and the relay setup wizard (board 42 section 8 C): the "This relay
 * belongs to another Kimo" fix (Fix, gnLEW / U5YOHw: warning-soft box, title, what to do, Add this
 * device · Reset ownership) and the Add this device steps (CL9TO, on Dialog bDVhS). Reset
 * ownership opens the self-hosting guide, the only place the reset variable is named.
 */
import { Button, Dialog, DialogScrim } from "@kimo/ui"
import { createPortal } from "react-dom"
import { Icon } from "../../lib/icons"
import { RELAY_GUIDE_URL } from "./shared"
import "./relay-wizard.css"

/** The guide's "This relay belongs to another Kimo" section (apps/server/README.md). */
export const RESET_OWNERSHIP_URL = `${RELAY_GUIDE_URL}#this-relay-belongs-to-another-kimo`

export const NOT_YOURS_TITLE = "This relay belongs to another Kimo"
/** The popover's shorter description (U5YOHw). */
export const NOT_YOURS_SHORT =
  "Another Kimo set up this relay first. Add this device from one that manages it, or reset ownership."
/** Settings and the wizard (X00Qb, Yy3BN). */
export const NOT_YOURS_DESC =
  "Another Kimo set up this relay. Add this device from one that manages it, or reset ownership if none remain."

/** Add this device (Button/Secondary, laptop) · Reset ownership (Button/Ghost, external-link). */
export function NotYoursActions({
  iconSize = 16,
  onAddThisDevice,
  onResetOwnership,
}: {
  /** 14 in the popover and Settings, the button's own 16 in the wizard. */
  iconSize?: 14 | 16
  onAddThisDevice(): void
  onResetOwnership(): void
}) {
  return (
    <div className="rw-actions">
      <Button
        variant="secondary"
        className="rw-btn--26"
        icon={<Icon name="laptop" size={iconSize} />}
        data-action="add-this-device"
        onClick={onAddThisDevice}
      >
        Add this device
      </Button>
      <Button
        variant="ghost"
        className="rw-btn--26"
        icon={<Icon name="external-link" size={iconSize} />}
        data-action="reset-ownership"
        onClick={onResetOwnership}
      >
        Reset ownership
      </Button>
    </div>
  )
}

/** Fix (gnLEW, U5YOHw): column, gap 8, padding [10, 12], warning-soft, radius-md. */
export function NotYoursFix({
  desc,
  iconSize,
  onAddThisDevice,
  onResetOwnership,
}: {
  desc: string
  iconSize?: 14 | 16
  onAddThisDevice(): void
  onResetOwnership(): void
}) {
  return (
    <div className="rw-fix" data-fix="not-yours">
      <p className="rw-title">{NOT_YOURS_TITLE}</p>
      <p className="rw-desc">{desc}</p>
      <NotYoursActions
        {...(iconSize ? { iconSize } : {})}
        onAddThisDevice={onAddThisDevice}
        onResetOwnership={onResetOwnership}
      />
    </div>
  )
}

/**
 * Add this device (CL9TO): it explains only, there is nothing to type. The link from a device that
 * manages the relay opens the pairing sheet here.
 */
export function AddThisDeviceDialog({
  host,
  onClose,
  inline,
}: {
  host: string
  onClose(): void
  inline?: boolean
}) {
  const dialog = (
    <Dialog
      className="mp-add-this-device"
      icon={<Icon name="laptop" size={16} />}
      title="Add this device"
      description={`On a device that already shares on ${host}, open Settings › Multiplayer and choose Add device. Then open that link here.`}
      footnote="The link works once, for 15 minutes."
      cancelLabel={null}
      confirmLabel="Got it"
      inline={inline ?? false}
      onCancel={onClose}
      onConfirm={onClose}
    />
  )
  if (inline) return dialog
  return createPortal(<DialogScrim>{dialog}</DialogScrim>, document.body)
}
