/**
 * "Agent edits paused" (board 21 nYai1, hsIeq): Banner/Warning under the topbar, one per file,
 * when a write returned READ_ONLY or DOCUMENT_LOCKED (rule "Paused"). Agents keep read access;
 * queued ops are dropped, not retried. DOCUMENT_LOCKED offers Resume once the lock clears.
 */
import { Banner, type BannerActionItem } from "@kimo/ui"
import type { AgentsControllerExt } from "./controller"
import { useAgentsState } from "./hooks"
import { AgentIcon } from "./icons"

export interface AgentPausedBannerProps {
  controller: AgentsControllerExt
  /** "Show changes": opens the session popover / Activity tab. */
  onShowOps?: () => void
  /** "Save a copy…" (read-only files). */
  onSaveCopy?: () => void
}

export function AgentPausedBanner({ controller, onShowOps, onSaveCopy }: AgentPausedBannerProps) {
  const state = useAgentsState(controller)
  const chip = state.chips.find((c) => c.paused && c.paused.code !== "USER")
  if (!chip?.paused) return null
  const store = controller.store
  const locked = chip.paused.code === "DOCUMENT_LOCKED"
  const lockCleared = locked && store !== null && store.readOnly === null
  const reason = store?.readOnly?.reason
  const body = locked
    ? `${chip.paused.summary || "The file is locked by another app."} ${chip.label}’s last call returned DOCUMENT_LOCKED; its changes were not applied. Agents can still read.`
    : `This file is read-only${reason ? ` (${reason})` : ""}: ${chip.label}’s last call returned READ_ONLY and was not applied. Agents can still read.`
  const actions: BannerActionItem[] = [
    { id: "show-ops", label: "Show changes", variant: "ghost" },
    lockCleared
      ? { id: "resume", label: "Resume", variant: "primary" }
      : locked
        ? null
        : { id: "save-copy", label: "Save a copy…", variant: "primary" },
  ].filter((a): a is BannerActionItem => a !== null)
  return (
    <Banner
      tone="warning"
      icon={<AgentIcon name="circle-pause" />}
      title="Agent edits paused"
      body={body}
      actions={actions}
      data-testid="agent-paused-banner"
      onAction={(id) => {
        if (id === "show-ops") onShowOps?.()
        else if (id === "save-copy") onSaveCopy?.()
        else if (id === "resume") controller.clearPause(chip.origin)
      }}
    />
  )
}
