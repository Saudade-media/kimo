/**
 * Board 43 section 5 (ouAPj): Settings › Multiplayer when Kimo Cloud is the relay. Relay (the
 * Kimo Cloud value with its plan pill, Change opens the wizard) · Account (email, plan and renewal,
 * storage bar, Manage billing, Sign out) · Devices (signed-in devices, Rename and Sign out on
 * hover, how to add one). Sign out confirms (5 B, 5 C); Manage billing opens the provider's portal
 * and says so in a toast (5 D). Payment failed (6 D), storage full (6 F) and offline (6 E) show as
 * their fragment in Account.
 */
import { Button } from "@kimo/ui"
import { useState } from "react"
import { failureText } from "../../editor/errors"
import { Icon } from "../../lib/icons"
import type { CloudState, CloudStore } from "../cloud/store"
import type { CloudDevice } from "../cloud/types"
import { planMeta, planValue, storageLevel } from "../cloud/view"
import {
  CloudDeviceRow,
  CloudNotice,
  type CloudNoticeKind,
  CloudSignOutDialog,
  PlanPill,
  StorageRow,
} from "./cloud-parts"
import { Pill } from "./relay-parts"
import { useShareToast } from "./shared"
import "./cloud.css"

export interface CloudSettingsProps {
  cloud: CloudStore
  state: CloudState
  /** Change: the relay wizard. */
  onChange(): void
  /** This device signed out: Relay reads Not set up again. */
  onSignedOut(): Promise<void>
  now?: number
}

export function CloudSettings({ cloud, state, onChange, onSignedOut, now }: CloudSettingsProps) {
  const toast = useShareToast()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState<CloudDevice | "self" | null>(null)
  const [busy, setBusy] = useState(false)
  const account = state.session === "signed-in" ? state.account : null
  const at = now ?? Date.now()

  const portal = async () => {
    setBusy(true)
    try {
      await cloud.openPortal()
      toast({ tone: "component", icon: "external-link", text: "Billing opened in your browser" })
    } catch (e) {
      toast({ tone: "danger", text: failureText("open billing", e) })
    } finally {
      setBusy(false)
    }
  }
  const signOut = async (target: CloudDevice | "self") => {
    setSigningOut(null)
    try {
      if (target === "self") {
        await cloud.signOut()
        await onSignedOut()
      } else await cloud.signOutDevice(target.pub)
    } catch (e) {
      toast({ tone: "danger", text: failureText("sign out", e) })
    }
  }
  const rename = async (device: CloudDevice, name: string) => {
    setRenaming(null)
    const next = name.trim()
    if (!next || next === device.name) return
    try {
      await cloud.renameDevice(device.pub, next)
    } catch (e) {
      toast({ tone: "danger", text: failureText("rename the device", e) })
    }
  }

  const notice: CloudNoticeKind | null = state.offline
    ? "offline"
    : account?.plan.status === "past_due"
      ? "payment-failed"
      : account && storageLevel(account.usage) === "danger"
        ? "storage-full"
        : null

  return (
    <>
      <div className="mp-setting" data-setting="relay">
        <div className="mp-text mp-text--2">
          <p className="mp-setting__label">Relay</p>
          <p className="mp-desc">
            Used when you start sharing a file. Files already shared keep the relay they started on.
          </p>
        </div>
        <div className="mp-input-row">
          <div className="mp-cloud-relay">
            <span className="mp-cloud-relay__icon" aria-hidden="true">
              <Icon name="cloud" size={16} />
            </span>
            <span className="mp-cloud-relay__value">{account ? "Kimo Cloud" : "Not set up"}</span>
            <span className="mp-spacer" aria-hidden="true" />
            {account ? (
              <PlanPill account={account} />
            ) : state.offline ? (
              <Pill tone="danger" label="Offline" />
            ) : null}
          </div>
          <Button
            variant="secondary"
            className="mp-cloud-change"
            data-action="change-relay"
            icon={<Icon name="repeat" size={14} />}
            onClick={onChange}
          >
            Change
          </Button>
        </div>
      </div>
      {account && (
        <div className="mp-setting" data-setting="account">
          <div className="mp-text mp-text--2">
            <p className="mp-setting__label">Account</p>
            <p className="mp-desc">You pay for Kimo Cloud here. Guests never need an account.</p>
          </div>
          <div className="mp-kv" data-row="email">
            <span className="mp-kv__key">Email</span>
            <span className="mp-kv__value">{account.account.email}</span>
          </div>
          <div className="mp-kv" data-row="plan">
            <span className="mp-kv__key">Plan</span>
            <span className="mp-kv__value">{planValue(account.plan)}</span>
            {planMeta(account.plan) && (
              <span className="mp-kv__meta">{planMeta(account.plan)}</span>
            )}
          </div>
          <StorageRow account={account} />
          <div className="mp-account-actions">
            {account.plan.status !== "none" && (
              <Button
                variant="secondary"
                className="mp-billing"
                data-action="manage-billing"
                icon={<Icon name="external-link" size={14} />}
                disabled={busy}
                onClick={() => void portal()}
              >
                Manage billing
              </Button>
            )}
            <Button
              variant="ghost"
              className="mp-sign-out"
              data-action="sign-out"
              icon={<Icon name="log-out" size={16} />}
              onClick={() => setSigningOut("self")}
            >
              Sign out
            </Button>
          </div>
          {notice && (
            <CloudNotice
              kind={notice}
              account={account}
              framed
              busy={busy}
              onAction={() => (notice === "offline" ? void cloud.refresh() : void portal())}
            />
          )}
        </div>
      )}
      {!account && state.offline && (
        <div className="mp-setting" data-setting="account">
          <CloudNotice kind="offline" account={null} framed onAction={() => void cloud.refresh()} />
        </div>
      )}
      {account && (
        <div className="mp-setting" data-setting="devices">
          <div className="mp-text mp-text--2">
            <p className="mp-setting__label">Devices</p>
            <p className="mp-desc">
              Devices signed in to your account. Each one can start sharing on Kimo Cloud.
            </p>
          </div>
          <ul className="mp-device-list" aria-label="Devices">
            {account.devices.map((d) => (
              <CloudDeviceRow
                key={d.pub}
                device={d}
                now={at}
                renaming={renaming === d.pub}
                onRename={() => setRenaming(d.pub)}
                onSaveName={(name) => void rename(d, name)}
                onCancelRename={() => setRenaming(null)}
                {...(d.self ? {} : { onSignOut: () => setSigningOut(d) })}
              />
            ))}
          </ul>
          <div className="mp-cloud-hint">
            <span className="mp-cloud-hint__icon" aria-hidden="true">
              <Icon name="info" size={14} />
            </span>
            <p className="mp-cloud-hint__text">
              To add a device, sign in on it with the same email.
            </p>
          </div>
        </div>
      )}
      {signingOut && (
        <CloudSignOutDialog
          device={signingOut === "self" ? null : signingOut}
          onCancel={() => setSigningOut(null)}
          onConfirm={() => void signOut(signingOut)}
        />
      )}
    </>
  )
}
