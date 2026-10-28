/**
 * Board 43 section 6 B and C in the editor banner slot, for a file its owner shares on Kimo Cloud:
 *
 * - B grace (OnbnS, Banner/Warning): "Kimo Cloud plan ended · This file keeps syncing until Nov 4,
 *   then turns read-only." Manage billing · Renew plan · Dismiss; once per file per day.
 * - C read-only (ybZM0, Banner): "Read-only · The owner's Kimo Cloud plan ended. Everyone keeps
 *   their own copy." Renew plan; no dismiss.
 * - Past due (rule "Payment failed"): a once-a-day owner banner, Update payment.
 *
 * Renew plan opens the provider's checkout (the store polls it and refreshes on focus); Manage
 * billing and Update payment open the portal. Guests see nothing during grace; the guest side of
 * read-only needs the relay's refusal on the sync socket and is not here.
 */
import { Banner } from "@kimo/ui"
import { useEffect, useState } from "react"
import { failureText } from "../../editor/errors"
import { Icon } from "../../lib/icons"
import { useOptionalRuntime } from "../../platform/runtime"
import type { CloudState, CloudStore } from "../cloud/store"
import { type PlanBannerKind, planBannerKind, shortDate } from "../cloud/view"
import { fileOf } from "../cloud/workspaces"
import { useShareState } from "../hooks"
import type { MultiplayerModel } from "../model"
import {
  useCloudState,
  useRelaySetupServices,
  useRelaySetupStateOrNull,
} from "../relay-setup/services"
import { useShareToast } from "./shared"
import { useWorkspaceStore, useWorkspacesState } from "./workspace-parts"

/** "2026-10-21" in the person's time zone: the banner comes back the next day. */
const today = (now: number) => {
  const d = new Date(now)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

const storageKey = (kind: PlanBannerKind, docKey: string) => `kimo.cloud.banner:${kind}:${docKey}`

function dismissedToday(kind: PlanBannerKind, docKey: string, now: number): boolean {
  try {
    return localStorage.getItem(storageKey(kind, docKey)) === today(now)
  } catch {
    return false
  }
}

function rememberDismiss(kind: PlanBannerKind, docKey: string, now: number) {
  try {
    localStorage.setItem(storageKey(kind, docKey), today(now))
  } catch {
    // Private mode: dismissed for this session only.
  }
}

const hostOf = (url: string | null | undefined) => {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export interface CloudPlanBannerProps {
  cloud: CloudStore
  state: CloudState
  docKey: string
  /** The file's relay host while it is shared, and whether this device shared it. */
  relayHost: string | null
  owner: boolean
  now?: number
}

function CloudPlanBanner({
  cloud,
  state,
  docKey,
  relayHost,
  owner,
  now: given,
}: CloudPlanBannerProps) {
  const toast = useShareToast()
  const now = given ?? Date.now()
  const signedIn = state.session === "signed-in"
  // Which relay is Kimo Cloud's (asked once per window).
  useEffect(() => {
    if (signedIn && !state.relay) void cloud.relay().catch(() => undefined)
  }, [signedIn, state.relay, cloud])
  const kind = planBannerKind(state.account?.plan ?? null, now)
  const onCloud = relayHost !== null && relayHost === hostOf(state.relay?.relayUrl)
  const day = today(now)
  const [dismissed, setDismissed] = useState(() =>
    kind ? dismissedToday(kind, docKey, now) : false,
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: again on another day, file or kind
  useEffect(() => {
    setDismissed(kind ? dismissedToday(kind, docKey, now) : false)
  }, [kind, docKey, day])
  if (!owner || !onCloud || !kind || !state.account) return null
  if (kind !== "read-only" && dismissed) return null

  const plan = state.account.plan
  const renew = async () => {
    try {
      cloud.backToChoose()
      await cloud.startCheckout()
    } catch (e) {
      toast({ tone: "danger", text: failureText("open checkout", e) })
    }
  }
  const portal = async () => {
    try {
      await cloud.openPortal()
      toast({ tone: "component", icon: "external-link", text: "Billing opened in your browser" })
    } catch (e) {
      toast({ tone: "danger", text: failureText("open billing", e) })
    }
  }
  const dismiss = () => {
    rememberDismiss(kind, docKey, now)
    setDismissed(true)
  }

  if (kind === "grace")
    return (
      <Banner
        tone="warning"
        data-testid="mp-cloud-grace"
        data-pen="OnbnS"
        icon={<Icon name="cloud-alert" size={16} />}
        title="Kimo Cloud plan ended"
        body={`This file keeps syncing until ${plan.graceEndsAt ? shortDate(plan.graceEndsAt) : "the grace period ends"}, then turns read-only.`}
        actions={[
          { id: "billing", label: "Manage billing", variant: "ghost" },
          { id: "renew", label: "Renew plan", variant: "primary" },
        ]}
        onAction={(id) => void (id === "renew" ? renew() : portal())}
        onDismiss={dismiss}
      />
    )
  if (kind === "read-only")
    return (
      <Banner
        tone="info"
        data-testid="mp-cloud-read-only"
        data-pen="ybZM0"
        icon={<Icon name="lock" size={16} />}
        title="Read-only"
        body="The owner's Kimo Cloud plan ended. Everyone keeps their own copy."
        actions={[{ id: "renew", label: "Renew plan", variant: "primary" }]}
        onAction={() => void renew()}
      />
    )
  return (
    <Banner
      tone="warning"
      data-testid="mp-cloud-past-due"
      icon={<Icon name="credit-card" size={16} />}
      title="Payment failed"
      body={`Update your card${plan.paymentDueBy ? ` by ${shortDate(plan.paymentDueBy)}` : ""} to keep sharing new files. Nothing has stopped yet.`}
      actions={[{ id: "portal", label: "Update payment", variant: "primary" }]}
      onAction={() => void portal()}
      onDismiss={dismiss}
    />
  )
}

/** The banner for the editor's slot: the window's Kimo Cloud and the file's share state. */
export function EditorCloudBanner({ model, docKey }: { model: MultiplayerModel; docKey: string }) {
  const runtime = useOptionalRuntime()
  const services = useRelaySetupServices(runtime?.platform ?? null)
  const cloud = services?.cloud ?? null
  const state = useCloudState(cloud)
  const share = useShareState(model, docKey)
  const setup = useRelaySetupStateOrNull(services?.store ?? null)
  const workspaces = useWorkspacesState(useWorkspaceStore())
  // Only a device that chose Kimo Cloud asks for its account here.
  const ask = cloud !== null && share.owner && setup?.path === "cloud"
  useEffect(() => {
    if (ask && cloud?.getState().session === "unknown") void cloud.refresh()
  }, [ask, cloud])
  if (!cloud || !state || share.room === null) return null
  // A workspace file has board 46's banner (`WorkspaceBanner`), from its workspace's plan.
  if (workspaces && (workspaces.open[share.room] || fileOf(workspaces, share.room))) return null
  return (
    <CloudPlanBanner
      cloud={cloud}
      state={state}
      docKey={docKey}
      relayHost={share.relayHost}
      owner={share.owner}
    />
  )
}
