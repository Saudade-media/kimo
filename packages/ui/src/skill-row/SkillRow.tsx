import { BookOpen, FileText } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"
import { Toggle } from "../toggle/Toggle"

/** Props for {@link SkillRow}. Remaining `<div>` props go to the row. */
export interface SkillRowProps extends Omit<ComponentPropsWithRef<"div">, "children" | "onToggle"> {
  name: string
  /** "schema, ops, layout rules" (built-in) or "brand-voice/SKILL.md" (yours). */
  source: string
  /** `builtin`: book-open; `user`: file-text (board 22 D). */
  kind?: "builtin" | "user"
  enabled: boolean
  onToggle?: (enabled: boolean) => void
  /** Click / Enter on the row: insert `/name` into the composer. */
  onInsert?: () => void
  highlighted?: boolean
}

/**
 * One skill in the "/" menu. Mirrors `SkillRow` (TEEsL): row fill_container, gap 10, padding
 * [6, 8], center, radius-sm › Tile (EAVaJ) 28 × 28 bg-muted radius-sm, Icon (QUAte) 14
 * text-primary › Text (ZEkrD) column fill, gap 1: Name (z3KtI1) sans 12 / 500 text-primary ·
 * Source (sOw2b) mono 11 text-tertiary › Toggle (E7PJk) Toggle/On | Off.
 */
export function SkillRow({
  name,
  source,
  kind = "builtin",
  enabled,
  onToggle,
  onInsert,
  highlighted = false,
  className,
  ...rest
}: SkillRowProps) {
  const Icon = kind === "user" ? FileText : BookOpen
  return (
    <div
      {...rest}
      role="menuitem"
      tabIndex={-1}
      data-highlighted={highlighted || undefined}
      data-skill={name}
      className={cx("kimo-skill-row", className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".kimo-toggle")) return
        onInsert?.()
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" && e.altKey) {
          e.preventDefault()
          onToggle?.(!enabled)
        } else if (e.key === "Enter") {
          e.preventDefault()
          onInsert?.()
        }
      }}
    >
      <span className="kimo-skill-row__tile" aria-hidden="true">
        <Icon className="kimo-skill-row__icon" />
      </span>
      <span className="kimo-skill-row__text">
        <span className="kimo-skill-row__name">{name}</span>
        <span className="kimo-skill-row__source">{source}</span>
      </span>
      <Toggle checked={enabled} label={`Enable ${name}`} onChange={(v) => onToggle?.(v)} />
    </div>
  )
}
