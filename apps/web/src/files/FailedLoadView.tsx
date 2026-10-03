/**
 * Board 17 "Failed load · terminal" (TrOIn) body: replaces the canvas. Body (z6LzR: fill,
 * column, center/center) > Error Card (HtVIp: 520, bg-app, radius-xl, stroke 1 border, column,
 * gap 16, padding 24): Head (row gap 12: Icon Wrap 32 danger-soft pill `file-x` 16 danger ·
 * Text column gap 4: Title sans 14 / 600, Desc sans 12 text-secondary line-height 1.45) · Error
 * Detail (bg-subtle, radius-md, column, gap 4, padding [10, 12]: Error mono 11 danger, Lines
 * mono 11, the error line text-primary, context text-tertiary) · Actions (row, gap 8, center:
 * Path mono 11 text-tertiary · Spacer · Reveal Button/Ghost h 30 [0, 12] · Open as text
 * Button/Secondary h 30 [0, 14], labels 12).
 */
import type { HostOS } from "@kimo/platform"
import { Button } from "@kimo/ui"
import { FileX } from "lucide-react"
import { type FailedLoadDetail, revealLabel } from "../platform/contract"
import { displayPath } from "../platform/format"
import type { FileDocumentSession } from "../platform/session"
import { useSessionState } from "./hooks"

export interface FailedLoadCardProps {
  detail: FailedLoadDetail
  /** Display path (`~/Projects/loom/checkout.kimo`). */
  path: string
  os: HostOS
  /** Line the error points at (drawn text-primary). */
  errorLine?: number | null
  onReveal?: () => void
  onOpenAsText?: () => void
  /** Hide Reveal where the host cannot reveal (web). */
  canReveal?: boolean
}

/** The error card (stateless). */
export function FailedLoadCard({
  detail,
  path,
  os,
  errorLine,
  onReveal,
  onOpenAsText,
  canReveal = true,
}: FailedLoadCardProps) {
  const focusLine = errorLine ?? detail.excerpt[Math.floor(detail.excerpt.length / 2)]?.line ?? null
  return (
    <div className="kimo-files-failed__card" data-pen="HtVIp">
      <div className="kimo-files-failed__head">
        <span className="kimo-files-failed__icon-wrap" aria-hidden="true">
          <FileX />
        </span>
        <div className="kimo-files-failed__text">
          <h2 className="kimo-files-failed__title">{detail.headline}</h2>
          <p className="kimo-files-failed__desc">{detail.explanation}</p>
        </div>
      </div>
      {(detail.error || detail.excerpt.length > 0) && (
        <div className="kimo-files-failed__detail">
          {detail.error && <span className="kimo-files-failed__error">{detail.error}</span>}
          {detail.excerpt.map((l) => (
            <span
              key={l.line}
              className={
                l.line === focusLine
                  ? "kimo-files-failed__line kimo-files-failed__line--error"
                  : "kimo-files-failed__line"
              }
            >
              {`${l.line} │ ${l.text}`}
            </span>
          ))}
        </div>
      )}
      <div className="kimo-files-failed__actions">
        <span className="kimo-files-failed__path">{path}</span>
        <span className="kimo-files-failed__spacer" aria-hidden="true" />
        {canReveal && (
          <Button variant="ghost" className="kimo-files-failed__reveal" onClick={onReveal}>
            {revealLabel(os)}
          </Button>
        )}
        <Button variant="secondary" className="kimo-files-failed__open-text" onClick={onOpenAsText}>
          Open as text
        </Button>
      </div>
    </div>
  )
}

/** The failed-load body for a session; renders nothing unless the phase is `failed-load`. */
export function FailedLoadView({ session }: { session: FileDocumentSession }) {
  const state = useSessionState(session)
  const banner = state.banner
  if (state.phase !== "failed-load" || banner?.kind !== "failed-load") return null
  const platform = session.manager.platform
  return (
    <div className="kimo-files-failed" data-pen="z6LzR">
      <FailedLoadCard
        detail={banner.detail}
        path={displayPath(state.ref)}
        os={platform.os}
        canReveal={platform.capabilities.reveal}
        onReveal={() => void session.runAction("reveal")}
        onOpenAsText={() => void session.runAction("open-as-text")}
      />
    </div>
  )
}
