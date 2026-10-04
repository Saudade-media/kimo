import type { ComponentPropsWithRef, ReactNode } from "react"
import { type AgentPillTone, AgentTonePill } from "../agent-tone-pill/AgentTonePill"
import { cx } from "../internal/util"

/** Props for {@link AgentHostRow}. Remaining `<div>` props go to the row. */
export interface AgentHostRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** Generic lucide icon (never a vendor logo), 16 × 16, colored with currentColor. */
  icon: ReactNode
  name: string
  status: { tone: AgentPillTone; label: string }
  /** "~/.claude.json · mcpServers.kimo". */
  path: string
  /** Buttons in the Actions frame (Copy config, Remove, Install, Update). */
  actions?: ReactNode
  /** Host not found on this machine: icon text-tertiary, name text-secondary. */
  muted?: boolean
}

/**
 * One agent host in Settings › Agents & MCP. Mirrors `AgentHostRow` (fRQJO): row, gap 12,
 * padding [12, 0], center, fill_container, bottom stroke 1 border. Host Tile (TUMTu) 32 × 32
 * bg-muted radius-md, Host Icon (V2yoe) 16 text-primary · Text (tRE0D) column gap 2 fill: Name
 * Row (sbQqL) gap 8 center: Name (svVcp) sans 12 / 500 · Status (ADF2h) StatusPill; Config Path
 * (YxpAP) mono 11 text-tertiary · Actions (CwR2U) row gap 6, justify end, center.
 */
export function AgentHostRow({
  icon,
  name,
  status,
  path,
  actions,
  muted = false,
  className,
  ...rest
}: AgentHostRowProps) {
  return (
    <div
      {...rest}
      className={cx("kimo-agent-host-row", muted && "kimo-agent-host-row--muted", className)}
    >
      <span className="kimo-agent-host-row__tile">
        <span className="kimo-agent-host-row__icon" aria-hidden="true">
          {icon}
        </span>
      </span>
      <span className="kimo-agent-host-row__text">
        <span className="kimo-agent-host-row__name-row">
          <span className="kimo-agent-host-row__name">{name}</span>
          <AgentTonePill tone={status.tone} label={status.label} />
        </span>
        <span className="kimo-agent-host-row__path">{path}</span>
      </span>
      {actions != null && <span className="kimo-agent-host-row__actions">{actions}</span>}
    </div>
  )
}
