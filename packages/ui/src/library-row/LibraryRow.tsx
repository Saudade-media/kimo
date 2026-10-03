import { Ellipsis, Library } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { Button } from "../button/Button"
import { IconButton } from "../icon-button/IconButton"
import { cx } from "../internal/util"
import { type LibraryStatus, StatusPill } from "../status-pill/StatusPill"

/** Props for {@link LibraryRow}. Remaining `<div>` props go to the row. */
export interface LibraryRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** Library `meta.name` ("Kimo UI"). */
  name: string
  /** Import alias without the colon ("ui"); shown as "ui:". */
  alias: string
  /** Import path relative to this file. */
  path: string
  /** "24 components · 86 variables" / "12 components · 3 changed" / "file not found · …". */
  count: string
  status: LibraryStatus
  /** Secondary action: "Review" (changed), "Locate…" (missing). Omit for none. */
  actionLabel?: string
  onAction?: () => void
  /** Row menu (Relink…, Unlink…). */
  onMenu?: (anchor: HTMLElement) => void
}

/**
 * Linked library (Library Manager). Mirrors `LibraryRow` (hxry7) / `/Changed` (F8YIg) /
 * `/Missing` (heWrG): fill_container, row, gap 12, padding [10, 12], center, stroke bottom 1
 * border. Icon Tile (mEJR9) 32 × 32 bg-muted radius-md → `library` 16 text-primary · Info
 * (vPF9q) column, gap 2, fill, clip: Title Row (gap 8, center: Name sans 13 / 600, Alias tag
 * padding [1, 5] bg-muted radius-xs, mono 11 text-secondary) and Meta Row (gap 6, center: Path
 * mono 11 text-tertiary — danger when missing · "·" · Count sans 11 text-tertiary) · Status
 * (StatusPill) · Actions (gap 4, center: Button/Ghost h 28, padding [0, 10], label 12; Menu
 * IconButton 28, transparent, `ellipsis` 16 text-tertiary).
 */
export function LibraryRow({
  name,
  alias,
  path,
  count,
  status,
  actionLabel,
  onAction,
  onMenu,
  className,
  ...rest
}: LibraryRowProps) {
  return (
    <div
      {...rest}
      data-status={status}
      className={cx("kimo-library-row", `kimo-library-row--${status}`, className)}
    >
      <span className="kimo-library-row__icon-tile" aria-hidden="true">
        <Library className="kimo-library-row__icon" />
      </span>
      <div className="kimo-library-row__info">
        <div className="kimo-library-row__title-row">
          <span className="kimo-library-row__name">{name}</span>
          <span className="kimo-library-row__alias">
            <span className="kimo-library-row__alias-label">{`${alias}:`}</span>
          </span>
        </div>
        <div className="kimo-library-row__meta-row">
          <span className="kimo-library-row__path">{path}</span>
          <span className="kimo-library-row__sep" aria-hidden="true">
            ·
          </span>
          <span className="kimo-library-row__count">{count}</span>
        </div>
      </div>
      <StatusPill status={status} />
      <div className="kimo-library-row__actions">
        {actionLabel !== undefined && (
          <Button variant="ghost" className="kimo-library-row__action" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
        <IconButton
          className="kimo-library-row__menu"
          tone="quiet"
          label={`${name} options`}
          icon={<Ellipsis />}
          onClick={(e) => onMenu?.(e.currentTarget)}
        />
      </div>
    </div>
  )
}
