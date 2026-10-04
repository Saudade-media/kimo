import type { LucideIcon } from "lucide-react"
import {
  CircleStop,
  ExternalLink,
  FileText,
  Globe,
  KeyRound,
  Monitor,
  Play,
  RotateCcw,
  Settings2,
  ShieldAlert,
  Timer,
  TriangleAlert,
  Undo2,
  Wallet,
  WifiOff,
  X,
  Zap,
} from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { CompactButton } from "../compact-button/CompactButton"
import { cx } from "../internal/util"

/** Card kinds (board 22 E, `@kimo/ai-agent` ErrorCardKind). */
export type AgentErrorCardKind =
  | "auth"
  | "rate_limit"
  | "offline"
  | "cors"
  | "budget"
  | "stopped"
  | "refusal"
  | "error"

/** One action button. The first is the Primary slot (Button/Secondary), the second Ghost. */
export interface AgentErrorCardAction {
  id: string
  label: string
  icon?: ReactNode
  onClick?: () => void
}

/** Props for {@link AgentErrorCard}. Remaining `<div>` props go to the card. */
export interface AgentErrorCardProps
  extends Omit<ComponentPropsWithRef<"div">, "children" | "title"> {
  kind: AgentErrorCardKind
  title: string
  description: string
  actions?: AgentErrorCardAction[]
}

/** Icon and tone per kind (board 22 E: wxgY1 instances of Ny3kQ). */
export const ERROR_CARD_STYLE: Record<
  AgentErrorCardKind,
  { icon: LucideIcon; tone: "danger" | "warning" | "neutral" | "stopped" }
> = {
  auth: { icon: KeyRound, tone: "danger" },
  rate_limit: { icon: Timer, tone: "warning" },
  offline: { icon: WifiOff, tone: "neutral" },
  cors: { icon: Globe, tone: "danger" },
  budget: { icon: Wallet, tone: "warning" },
  stopped: { icon: CircleStop, tone: "stopped" },
  // Not drawn on the board: refusal reads as a warning, a generic error as danger.
  refusal: { icon: ShieldAlert, tone: "warning" },
  error: { icon: TriangleAlert, tone: "danger" },
}

/** Action icons by the board's names (Y6rYtR/hfife, KvKC7/zAVGx overrides). */
export const ERROR_ACTION_ICONS: Record<string, LucideIcon> = {
  open_settings: Settings2,
  retry: RotateCcw,
  retry_now: RotateCcw,
  stop: X,
  switch_model: Zap,
  undo_turn: Undo2,
  continue: Play,
  raise_limit: Settings2,
  usage: FileText,
  get_desktop: Monitor,
  provider_matrix: ExternalLink,
}

/**
 * Inline error / interrupt card (never a modal). Mirrors `AgentErrorCard` (Ny3kQ): column
 * fill_container, gap 8, padding [10, 12], fill danger-soft, radius-lg › Head (mRIVx) row gap 8
 * center: Icon (Q3ljkL) 14 danger · Title (d8jH5P) sans 12 / 600 text-primary › Desc (k92b6e)
 * sans 11 text-secondary, line height 1.45 › Actions (NJWqF) row gap 6: Primary (Y6rYtR)
 * Button/Secondary h 26 padding [0, 10] icon 14 label 12 · Secondary (KvKC7) Button/Ghost.
 * Tones: warning (warning-soft, icon warning), neutral (bg-muted, icon text-secondary), stopped
 * (bg-subtle + 1 px border, icon text-secondary).
 */
export function AgentErrorCard({
  kind,
  title,
  description,
  actions = [],
  className,
  ...rest
}: AgentErrorCardProps) {
  const { icon: Icon, tone } = ERROR_CARD_STYLE[kind]
  return (
    <div
      role="alert"
      {...rest}
      data-kind={kind}
      data-tone={tone}
      className={cx("kimo-error-card", `kimo-error-card--${tone}`, className)}
    >
      <div className="kimo-error-card__head">
        <Icon className="kimo-error-card__icon" aria-hidden="true" />
        <span className="kimo-error-card__title">{title}</span>
      </div>
      <p className="kimo-error-card__desc">{description}</p>
      {actions.length > 0 && (
        <div className="kimo-error-card__actions">
          {actions.slice(0, 2).map((a, i) => {
            const Glyph = ERROR_ACTION_ICONS[a.id]
            return (
              <CompactButton
                key={a.id}
                variant={i === 0 ? "secondary" : "ghost"}
                height={26}
                padX={10}
                data-action={a.id}
                icon={a.icon ?? (Glyph ? <Glyph /> : undefined)}
                onClick={a.onClick}
              >
                {a.label}
              </CompactButton>
            )
          })}
        </div>
      )}
    </div>
  )
}
