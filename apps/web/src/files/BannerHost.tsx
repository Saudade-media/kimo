/**
 * The one banner under the topbar (02d: full width, never floating, highest severity wins).
 * Renders `SessionState.banner` with `bannerCopy` and the icon each board 17/18 instance uses:
 * newer-format `lock` (hiITj), locked `lock-keyhole` (krATV), git `git-branch` (aionD), save
 * failed `circle-x` (lH8bD), failed load `circle-x` without actions (qhUdf), merge conflicts
 * `git-merge` (wdPFM), ready to commit `git-commit-horizontal` with Dismiss (ke4Rg).
 */
import type { HostOS } from "@kimo/platform"
import { Banner, type BannerTone } from "@kimo/ui"
import {
  CircleX,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Lock,
  LockKeyhole,
  type LucideIcon,
} from "lucide-react"
import { bannerCopy, type Banner as SessionBanner } from "../platform/contract"
import { bannerFormatters } from "../platform/format"
import type { FileDocumentSession } from "../platform/session"
import { useSessionState } from "./hooks"

const ICON: Record<SessionBanner["kind"], LucideIcon> = {
  "newer-format": Lock,
  locked: LockKeyhole,
  "git-operation": GitBranch,
  "save-failed": CircleX,
  "failed-load": CircleX,
  "merge-conflicts": GitMerge,
  "merge-ready": GitCommitHorizontal,
}

export interface SessionBannerViewProps {
  banner: SessionBanner
  os: HostOS
  onAction?: (id: string) => void
  onDismiss?: () => void
}

/** A session banner as designed (stateless; used by {@link BannerHost} and the gallery). */
export function SessionBannerView({ banner, os, onAction, onDismiss }: SessionBannerViewProps) {
  const copy = bannerCopy(banner, bannerFormatters(os))
  const Icon = ICON[banner.kind]
  const tone: BannerTone = banner.severity
  return (
    <Banner
      tone={tone}
      icon={<Icon />}
      title={copy.title}
      body={copy.body}
      // Failed load: the actions live in the error card (qhUdf disables jU2dJ).
      actions={banner.kind === "failed-load" ? [] : copy.actions}
      data-banner={banner.kind}
      {...(onAction ? { onAction } : {})}
      {...(banner.kind === "merge-ready" && onDismiss ? { onDismiss } : {})}
    />
  )
}

/** Mount directly under the topbar, full width. */
export function BannerHost({ session }: { session: FileDocumentSession }) {
  const state = useSessionState(session)
  if (!state.banner) return null
  return (
    <SessionBannerView
      banner={state.banner}
      os={session.manager.platform.os}
      onAction={(id) => void session.runAction(id as never)}
      onDismiss={() => session.showMergeReady(false)}
    />
  )
}
