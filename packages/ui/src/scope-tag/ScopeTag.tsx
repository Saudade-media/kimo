import { Lock } from "lucide-react"
import type { ComponentPropsWithRef, CSSProperties } from "react"
import type { Persona } from "../agent-mark/persona"
import { personaVar } from "../agent-mark/persona"
import { cx } from "../internal/util"

/** Props for {@link ScopeTag}. Remaining `<span>` props go to the tag. */
export interface ScopeTagProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  /** "Agent 1 · only inside Hero", "Agent can only edit inside Card". */
  label: string
  /** Persona fill (split mode); default the agent teal. */
  persona?: Persona
}

/**
 * A scoped agent's tag over its frame. Mirrors `ScopeTag` (NKE7Z): h 20, gap 4, padding
 * [0, 7, 0, 5], center, fill agent, radius-xs › Icon (l7j6Z) lock 11 on-accent › Label (IAq4s)
 * sans 11 / 500 on-accent.
 */
export function ScopeTag({ label, persona = "teal", className, style, ...rest }: ScopeTagProps) {
  return (
    <span
      {...rest}
      data-persona={persona}
      className={cx("kimo-scope-tag", className)}
      style={{ "--kimo-scope-fill": personaVar(persona) } as CSSProperties & Record<string, string>}
    >
      <Lock className="kimo-scope-tag__icon" aria-hidden="true" />
      <span className="kimo-scope-tag__label">{label}</span>
    </span>
  )
}
