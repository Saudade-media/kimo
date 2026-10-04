/**
 * The one banner under the topbar (02d: full width, never floating, highest severity wins).
 * Renders `SessionState.banner` with `bannerCopy` and the icon each board 17/18 instance uses:
 * newer-format `lock` (hiITj), locked `lock-keyhole` (krATV), git `git-branch` (aionD), save
 * failed `circle-x` (lH8bD), failed load `circle-x` without actions (qhUdf), merge conflicts
 * `git-merge` (wdPFM), ready to commit `git-commit-horizontal` with Dismiss (ke4Rg).
 *
 * Board 25 §6 (e) tzFIU / LsjRG: "Ready to commit" keeps the board 18 look on success-soft
 * with a `git-commit-horizontal` in success; "Commit in terminal…" copies the command and turns
 * into "Copied" (check); "Review changes" selects + reveals the resolved nodes (`onReview`);
 * × hides it until the next git change. (f) aEUZq: no "Abort merge" anywhere in v1.
 */
import type { HostOS } from "@kimo/platform"
import { Banner, type BannerTone } from "@kimo/ui"
import {
  Check,
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
import { ClosePromptHost } from "./ClosePromptHost"
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

const ACTION_ICON = { check: <Check /> } as const

/** A session banner as designed (stateless; used by {@link BannerHost} and the gallery). */
export function SessionBannerView({ banner, os, onAction, onDismiss }: SessionBannerViewProps) {
  const copy = bannerCopy(banner, bannerFormatters(os))
  const Icon = ICON[banner.kind]
  const tone: BannerTone = banner.kind === "merge-ready" ? "success" : banner.severity
  return (
    <Banner
      tone={tone}
      icon={<Icon />}
      title={copy.title}
      body={copy.body}
      // Failed load: the actions live in the error card (qhUdf disables jU2dJ).
      actions={
        banner.kind === "failed-load"
          ? []
          : copy.actions.map(({ icon, ...a }) => (icon ? { ...a, icon: ACTION_ICON[icon] } : a))
      }
      data-banner={banner.kind}
      {...(onAction ? { onAction } : {})}
      {...(banner.kind === "merge-ready" && onDismiss ? { onDismiss } : {})}
    />
  )
}

/**
 * Mount directly under the topbar, full width. Also hosts the board 24 (i) close prompt of a
 * never-saved document (a modal, so its place in the tree does not matter).
 */
export function BannerHost({
  session,
  onReview,
}: {
  session: FileDocumentSession
  /** Board 25 §6 (e) "Review changes": select + reveal the merge's resolved nodes. */
  onReview?: (nodes: readonly string[]) => void
}) {
  const state = useSessionState(session)
  return (
    <>
      {state.banner && (
        <SessionBannerView
          banner={state.banner}
          os={session.manager.platform.os}
          onAction={(id) => {
            const b = state.banner
            if (id === "review-changes" && b?.kind === "merge-ready") onReview?.(b.nodes ?? [])
            else void session.runAction(id as never)
          }}
          onDismiss={() => session.dismissMergeReady()}
        />
      )}
      <ClosePromptHost session={session} />
    </>
  )
}
