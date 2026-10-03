/**
 * Board 17 "Click Locked pill → lease details" (ulWQH): Popover/Wide (296) titled "Lease on
 * marketing.kimo"; Body (PybNF: column, gap 8, padding 12): rows (gap 8, center: Key sans 11
 * text-tertiary width 56 · Value mono 11 text-primary) Holder / PID / Since / Socket / Lock ·
 * Note sans 11 text-secondary line-height 1.45 · Actions (row, gap 6, padding [4, 0, 0, 0],
 * justify end): Reveal lock file (Button/Ghost h 28 [0, 10], 12) · Retry (Button/Secondary
 * h 28 [0, 12], 12).
 */
import type { LeaseHolder } from "@kimo/platform"
import { Button, Popover, type PopoverProps } from "@kimo/ui"
import { displayPath, formatClock } from "../platform/format"

/** "Today 10:31:07" / "Yesterday 18:02:11" / "Sep 28 09:00:00". */
export function sinceLabel(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  const d = new Date(t)
  const today = new Date(now)
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const day =
    t >= start
      ? "Today"
      : t >= start - 86_400_000
        ? "Yesterday"
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `${day} ${formatClock(t)}`
}

export interface LockDetailsPopoverProps extends Omit<PopoverProps, "children" | "title"> {
  fileName: string
  holder: LeaseHolder
  onRevealLock?: () => void
  onRetry?: () => void
}

export function LockDetailsPopover({
  fileName,
  holder,
  onRevealLock,
  onRetry,
  ...rest
}: LockDetailsPopoverProps) {
  const rows: [string, string][] = [
    ["Holder", holder.appLabel],
    ["PID", `${holder.pid} · ${holder.alive ? "alive" : "not running"}`],
    ["Since", sinceLabel(holder.sinceIso)],
  ]
  if (holder.socket) rows.push(["Socket", displayPath(holder.socket)])
  rows.push(["Lock", displayPath(holder.lockPath)])
  return (
    <Popover
      wide
      title={`Lease on ${fileName}`}
      bodyProps={{ className: "kimo-files-lease__body" }}
      data-pen="ulWQH"
      {...rest}
    >
      {rows.map(([key, value]) => (
        <div key={key} className="kimo-files-lease__row">
          <span className="kimo-files-lease__key">{key}</span>
          <span className="kimo-files-lease__value">{value}</span>
        </div>
      ))}
      <p className="kimo-files-lease__note">
        When the desktop app holds the lease, CLI writers attach to it over the socket instead. A
        lease whose pid is dead is reclaimed on Retry.
      </p>
      <div className="kimo-files-lease__actions">
        <Button variant="ghost" className="kimo-files-lease__reveal" onClick={onRevealLock}>
          Reveal lock file
        </Button>
        <Button variant="secondary" className="kimo-files-lease__retry" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Popover>
  )
}
