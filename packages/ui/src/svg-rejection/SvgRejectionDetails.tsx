import { CircleX, Copy } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { Button } from "../button/Button"
import { cx } from "../internal/util"

/** One removed construct of a rejected SVG (board 24 (j) Reason row). */
export interface SvgRejectionItem {
  /** 1-based source line, or null when it could not be located. */
  line: number | null
  /** The construct as shown: `<script>`, `href="https://cdn…/x.svg"`, `onload="…"`. */
  code: string
  /** "scripts are never imported". */
  why: string
}

/** The vignette lists at most 5 reasons, then "+N more". */
export const SVG_REJECTION_MAX_ROWS = 5

/** Props for {@link SvgRejectionDetails}. Remaining `<div>` props go to the frame. */
export interface SvgRejectionDetailsProps extends Omit<ComponentPropsWithRef<"div">, "title"> {
  fileName: string
  items: readonly SvgRejectionItem[]
  /** "Hide details": collapse back to the one-line toast. */
  onHide: () => void
  onCopyReport: () => void
  onCancel: () => void
  /** "Import without these": imports the sanitized SVG (explicit consent). */
  onImport: () => void
}

/**
 * Board 24 (j) "SVG rejection · details" (nx2kl › Toast · expanded wcrmf): the rejection toast
 * grown in place (no modal). Column, fill bg-overlay, stroke 1 border, radius-lg, shadow 0 8 24
 * shadow-strong, clip.
 *   Head (imrWl) row, gap 8, padding [10, 12], center, fill danger-soft: `circle-x` 14 danger ·
 *     Title sans 12 / 500 text-primary · Spacer · Action "Hide details" sans 11 / 500
 *     text-secondary.
 *   Reasons (eLrfb) column, padding [6, 0]: Reason rows row, gap 8, padding [4, 12], center:
 *     Line mono 11 text-tertiary width 24 · Code mono 11 danger · Why sans 11 text-secondary.
 *   Footer (aO5B5) row, gap 6, padding [8, 12], center, top stroke 1 border: Copy report
 *     (Button/Ghost h 24 [0, 6], `copy` 14, label 11) · Spacer · Cancel (Button/Ghost h 24
 *     [0, 8], label 11) · Import without these (Button/Secondary h 24 [0, 8], label 11).
 */
export function SvgRejectionDetails({
  fileName,
  items,
  onHide,
  onCopyReport,
  onCancel,
  onImport,
  className,
  ...rest
}: SvgRejectionDetailsProps) {
  const shown = items.slice(0, SVG_REJECTION_MAX_ROWS)
  const more = items.length - shown.length
  return (
    <div role="alert" {...rest} className={cx("kimo-svg-rejection", className)}>
      <div className="kimo-svg-rejection__head">
        <CircleX className="kimo-svg-rejection__icon" aria-hidden="true" />
        <span className="kimo-svg-rejection__title">{`Couldn't import ${fileName}`}</span>
        <span className="kimo-svg-rejection__spacer" aria-hidden="true" />
        <button type="button" className="kimo-svg-rejection__action" onClick={onHide}>
          Hide details
        </button>
      </div>
      <ul className="kimo-svg-rejection__reasons" aria-label="Removed items">
        {shown.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: two removals can share line and code; the list is static
          <li key={`${r.line}-${r.code}-${i}`} className="kimo-svg-rejection__reason">
            <span className="kimo-svg-rejection__line">{r.line === null ? "" : `L${r.line}`}</span>
            <span className="kimo-svg-rejection__code">{r.code}</span>
            <span className="kimo-svg-rejection__why">{r.why}</span>
          </li>
        ))}
        {more > 0 && (
          <li className="kimo-svg-rejection__reason kimo-svg-rejection__reason--more">
            <span className="kimo-svg-rejection__line" />
            <span className="kimo-svg-rejection__why">{`+${more} more`}</span>
          </li>
        )}
      </ul>
      <div className="kimo-svg-rejection__footer">
        <Button
          variant="ghost"
          className="kimo-svg-rejection__button kimo-svg-rejection__copy"
          icon={<Copy />}
          onClick={onCopyReport}
        >
          Copy report
        </Button>
        <span className="kimo-svg-rejection__spacer" aria-hidden="true" />
        <Button variant="ghost" className="kimo-svg-rejection__button" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" className="kimo-svg-rejection__button" onClick={onImport}>
          Import without these
        </Button>
      </div>
    </div>
  )
}

/** "Copy report" text: one line per removed construct. */
export function svgRejectionReport(fileName: string, items: readonly SvgRejectionItem[]): string {
  const lines = items.map((r) => `${r.line === null ? "L?" : `L${r.line}`}\t${r.code}\t${r.why}`)
  return [`Kimo could not import ${fileName} as is. Removed:`, ...lines].join("\n")
}
