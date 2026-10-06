import { Globe, GlobeLock, GlobeX } from "lucide-react"
import { cx } from "../internal/util"
import { Tooltip } from "../tooltip/Tooltip"

/** Why the session can't use the web (board 38 C / D). */
export type WebAccessBlock = "privacy" | "model"

/** Props for {@link WebAccessButton}. */
export interface WebAccessButtonProps {
  /** Web access for this session. */
  on: boolean
  /** Disabled with a reason: No third-party fetch is on, or the model has no web tools. */
  blocked?: WebAccessBlock | null
  /** The whole composer is disabled (first run). */
  disabled?: boolean
  onToggle?: (on: boolean) => void
}

const TIP: Record<"on" | "off" | WebAccessBlock, string> = {
  on: "Turn off web access for this session",
  off: "Turn on web access for this session",
  privacy: "Web access is off: No third-party fetch is on",
  model: "This model can't use the web",
}

/**
 * Board 38 composer globe (v41pS / vfhgZ / vcbyI / BzyJO): 24 × 24, radius-sm, right after the
 * auto-approve shield. On: globe 14 text-secondary. Off: globe-x 14 text-tertiary. Blocked:
 * globe-lock (No third-party fetch) or globe-x (model), opacity 0.45, still focusable so the
 * tooltip can say why (`aria-disabled`).
 */
export function WebAccessButton({ on, blocked = null, disabled, onToggle }: WebAccessButtonProps) {
  const state = blocked ?? (on ? "on" : "off")
  const Icon = blocked === "privacy" ? GlobeLock : on && !blocked ? Globe : GlobeX
  const inert = !!blocked
  return (
    <Tooltip label={TIP[state]} side="top">
      <button
        type="button"
        className={cx(
          "kimo-composer-agent__web",
          !on && "kimo-composer-agent__web--off",
          inert && "kimo-composer-agent__web--blocked",
        )}
        aria-label="Web access"
        aria-pressed={on && !blocked}
        aria-disabled={inert || undefined}
        data-testid="agent-web-access"
        data-state={state}
        disabled={disabled}
        onClick={() => {
          if (!inert) onToggle?.(!on)
        }}
      >
        <Icon aria-hidden="true" />
      </button>
    </Tooltip>
  )
}
