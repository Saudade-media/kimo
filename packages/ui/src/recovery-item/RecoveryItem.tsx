import { FileClock, FilePlus } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { Badge } from "../badge/Badge"
import { Button } from "../button/Button"
import { cx } from "../internal/util"

/** Props for {@link RecoveryItem}. Remaining `<div>` props go to the row. */
export interface RecoveryItemProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  name: string
  /** Badge: "14 edits" / "never saved". */
  badge: string
  /** "~/Projects/loom/marketing.kimo" or "not on disk yet". */
  path: string
  /** "Last autosave 10:42 · quit unexpectedly 10:43". */
  meta: string
  /** Never saved (Untitled): `file-plus` icon, no "Save as…" ghost, the Restore slot reads "Save as…". */
  untitled?: boolean
  onSaveAs?: () => void
  onDiscard?: () => void
  /** Restore (or Save as… for Untitled). */
  onRestore?: () => void
}

/**
 * One recovery file. Mirrors `RecoveryItem` (arWPH): row, gap 12, padding [12, 0], center,
 * stroke bottom 1 border. Icon Tile 32 (bg-muted, radius-md, `file-clock` 16 text-primary) ·
 * Info (fill, clip, column, gap 2): Title Row (gap 8, center: Name sans 13 / 600 + Badge) ·
 * Path mono 11 text-tertiary · Meta sans 11 text-secondary · Actions (gap 4, center): Save As
 * and Discard (Button/Ghost h 28, padding [0, 10], label 12) · Restore (Button/Secondary h 28,
 * padding [0, 12], label 12).
 */
export function RecoveryItem({
  name,
  badge,
  path,
  meta,
  untitled = false,
  onSaveAs,
  onDiscard,
  onRestore,
  className,
  ...rest
}: RecoveryItemProps) {
  const Icon = untitled ? FilePlus : FileClock
  return (
    <div {...rest} className={cx("kimo-recovery-item", className)}>
      <span className="kimo-recovery-item__icon-tile" aria-hidden="true">
        <Icon />
      </span>
      <div className="kimo-recovery-item__info">
        <div className="kimo-recovery-item__title-row">
          <span className="kimo-recovery-item__name">{name}</span>
          <Badge className="kimo-recovery-item__badge">{badge}</Badge>
        </div>
        <span className="kimo-recovery-item__path">{path}</span>
        <span className="kimo-recovery-item__meta">{meta}</span>
      </div>
      <div className="kimo-recovery-item__actions">
        {!untitled && (
          <Button variant="ghost" className="kimo-recovery-item__ghost" onClick={onSaveAs}>
            Save as…
          </Button>
        )}
        <Button variant="ghost" className="kimo-recovery-item__ghost" onClick={onDiscard}>
          Discard
        </Button>
        <Button variant="secondary" className="kimo-recovery-item__restore" onClick={onRestore}>
          {untitled ? "Save as…" : "Restore"}
        </Button>
      </div>
    </div>
  )
}
