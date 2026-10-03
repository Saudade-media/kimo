import type { ComponentPropsWithRef, CSSProperties, ReactNode } from "react"
import { cx } from "../internal/util"

/** Availability shown by the FontRow status pill (board 19 / 02d). */
export type FontRowStatus = "installed" | "cached" | "not-cached" | "missing"

const STATUS: Record<FontRowStatus, { label: string; tone: "linked" | "changed" | "missing" }> = {
  installed: { label: "Installed", tone: "linked" },
  cached: { label: "Cached", tone: "linked" },
  "not-cached": { label: "Not cached", tone: "changed" },
  missing: { label: "Missing", tone: "missing" },
}

/** Props for {@link FontRow}. Remaining `<div>` props go to the row. */
export interface FontRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** Family name (Info > Family). */
  family: string
  /** Weights line, e.g. `400 · 500 · 600 · 700  ·  used by 212 layers` (see {@link fontRowMeta}). */
  meta: string
  /** Source badge: `Local`, `Google`, `Document`. */
  source: string
  status: FontRowStatus
  /**
   * Family used to draw the "Aa" specimen. Default: `family` when it renders (installed /
   * cached), Inter when it does not (not cached / missing, drawn text-tertiary).
   */
  specimenFamily?: string
  /** Trailing control: the `…` IconButton, the Replace-with Select, or the Fetch button. */
  action?: ReactNode
}

/** `400 · 600  ·  used by 23 layers` (two spaces around the separator before "used by"). */
export function fontRowMeta(weights: readonly number[], layers: number): string {
  return `${weights.join(" · ")}  ·  used by ${layers} layer${layers === 1 ? "" : "s"}`
}

/**
 * One font of a document. Mirrors `FontRow` (WVvHj) and its variants `/Google` (Lbs7z),
 * `/Offline` (G92TP9), `/Missing` (mquPe) on 02d: row, gap 12, padding [10, 12], center,
 * fill_container, bottom stroke 1 border.
 * Specimen (LvAkZ) 32 × 32 bg-muted radius-md centered "Aa" 14 / 600 text-primary (the family's
 * own face; Inter text-tertiary when it doesn't render) · Info (R1Vot) vertical gap 2 fill:
 * Family sans 13 / 500 text-primary, Weights mono 11 text-tertiary · Source Badge (jrIWa) ·
 * Status StatusPill (SVobH Installed/Cached, /Changed n20iVc Not cached, /Missing jwQVJ) ·
 * Action (G0d4W5 IconButton 28 transparent `ellipsis` text-tertiary; /Missing: Select 148;
 * /Offline: Button/Ghost 28 `download` "Fetch").
 */
export function FontRow({
  family,
  meta,
  source,
  status,
  specimenFamily,
  action,
  className,
  ...rest
}: FontRowProps) {
  const renders = status === "installed" || status === "cached"
  const specimen = specimenFamily ?? (renders ? family : "Inter")
  const pill = STATUS[status]
  const specimenStyle: CSSProperties = {
    fontFamily: `"${specimen.replace(/["\\]/g, "")}", var(--kimo-font-sans)`,
  }
  return (
    <div
      {...rest}
      className={cx("kimo-font-row", `kimo-font-row--${status}`, className)}
      data-status={status}
    >
      <span className="kimo-font-row__specimen" aria-hidden="true">
        <span
          className={cx("kimo-font-row__aa", !renders && "kimo-font-row__aa--muted")}
          style={specimenStyle}
        >
          Aa
        </span>
      </span>
      <span className="kimo-font-row__info">
        <span className="kimo-font-row__family">{family}</span>
        <span className="kimo-font-row__meta">{meta}</span>
      </span>
      <span className="kimo-badge kimo-font-row__source">
        <span className="kimo-badge__label">{source}</span>
      </span>
      <span
        className={cx(
          "kimo-status-pill",
          `kimo-status-pill--${pill.tone}`,
          "kimo-font-row__status",
        )}
        data-status={status}
      >
        <span className="kimo-status-pill__dot" aria-hidden="true" />
        <span className="kimo-status-pill__label">{pill.label}</span>
      </span>
      {action}
    </div>
  )
}
