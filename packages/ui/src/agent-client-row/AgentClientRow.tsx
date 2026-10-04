import { ChevronDown, ChevronRight } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { AgentOrb } from "../agent-orb/AgentOrb"
import { cx } from "../internal/util"

/** Props for {@link AgentClientRow}. Remaining `<button>` props go to the row. */
export interface AgentClientRowProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  name: string
  version?: string
  /** "Since 10:42 · 2 files open · stdio". */
  meta: string
  /** "Edit · this folder", "Read only · current file". */
  scope: string
  /** Scope badge teal when the client can write, grey when read only (rule "Clients"). */
  writable: boolean
  /** Expanded to the permissions panel: chevron-down and no bottom stroke (EbQQD). */
  expanded?: boolean
}

/**
 * One connected client. Mirrors `AgentClientRow` (hp5kw): row, gap 12, padding [12, 0], center,
 * fill_container, bottom stroke 1 border. Orb (s6KNcG) 28 · Text (g1h7Xi) column gap 2 fill:
 * Name Row (p0JJGd) gap 6: Name sans 12 / 500 · Version mono 11 text-tertiary; Meta (ZSMNf)
 * sans 11 text-secondary · Scope (H8RP2y) Badge (agent-soft / agent when writable) · Chevron
 * (QknTo) chevron-right 14 text-tertiary.
 */
export function AgentClientRow({
  name,
  version,
  meta,
  scope,
  writable,
  expanded = false,
  className,
  type = "button",
  ...rest
}: AgentClientRowProps) {
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <button
      {...rest}
      type={type}
      aria-expanded={expanded}
      className={cx(
        "kimo-agent-client-row",
        expanded && "kimo-agent-client-row--expanded",
        className,
      )}
    >
      <AgentOrb size={28} />
      <span className="kimo-agent-client-row__text">
        <span className="kimo-agent-client-row__name-row">
          <span className="kimo-agent-client-row__name">{name}</span>
          {version != null && <span className="kimo-agent-client-row__version">{version}</span>}
        </span>
        <span className="kimo-agent-client-row__meta">{meta}</span>
      </span>
      <span
        className={cx(
          "kimo-agent-client-row__scope",
          writable && "kimo-agent-client-row__scope--writable",
        )}
      >
        <span className="kimo-agent-client-row__scope-label">{scope}</span>
      </span>
      <Chevron className="kimo-agent-client-row__chevron" aria-hidden="true" />
    </button>
  )
}
