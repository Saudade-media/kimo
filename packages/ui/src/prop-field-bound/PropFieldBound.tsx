import { Unlink, Variable } from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"
import { TYPE_GLYPH_ICONS } from "../type-glyph/TypeGlyph"

/** Value types a property field binds to (colour keeps its swatch picker). */
export type BindableType = "number" | "string" | "boolean"

/** Props for {@link BindButton}. Remaining `<button>` props go to the button. */
export interface BindButtonProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** Accessible name. Default "Bind to variable". */
  label?: string
}

/**
 * The 'variable' button of `PropField/Bindable` (LFrgQ › Bind Button fBIJF): 20 × 20, fill
 * bg-hover, radius-xs, center; Icon (x2Sf8m) lucide `variable` 12 text-primary. Hosts put it
 * at the right edge of a bindable field (`kimo-prop-field--bindable`): hover / focus shows it.
 */
export function BindButton({ label = "Bind to variable", className, ...rest }: BindButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx("kimo-bind-button", className)}
    >
      <Variable aria-hidden="true" />
    </button>
  )
}

/** Props for {@link PropFieldBound}. Remaining `<div>` props go to the frame. */
export interface PropFieldBoundProps
  extends Omit<ComponentPropsWithRef<"div">, "children" | "prefix"> {
  /** Prefix label (`Gap`, `R`, `↔`) or icon; omit for rows without one (Visibility, Content). */
  prefix?: ReactNode
  /** Variable type: the chip glyph (`hash` number · `type` string · `toggle-left` boolean). */
  type: BindableType
  /** Variable display name (`space/4`, `brand/radius/md`). */
  name: string
  /** Resolved value in the current theme (`16`, `“Start free”`); hidden under 140 px wide. */
  resolved?: string
  /** Renamed / missing variable: $danger chip stroke and name (last value kept). */
  missing?: boolean
  /** The picker is open for this field: chip stroke $selection (XSUF5). */
  active?: boolean
  /** Field name for accessible labels ("Gap" → "Gap: bound to space/4"). */
  label?: string
  /** Chip click: reopen the picker. */
  onOpen?: () => void
  /** Detach button (hover): write the resolved value as a literal. */
  onDetach?: () => void
}

/**
 * Bound property field. Mirrors `PropField/Bound` (egdNP): fill_container × 28, bg-subtle,
 * radius-sm, row, gap 6, padding [0, 4, 0, 8], center: Prefix (m2mZXW) sans 11 text-tertiary ·
 * Variable Chip (ZtFyB: bg-app, radius-xs, stroke 1 border-strong, gap 4, padding [2, 6, 2, 5],
 * center → Glyph r6ZAyc 10 text-tertiary · Name D4Hy8R mono 11 text-primary) · Spacer (DC0rl) ·
 * Resolved (r1TUXL) mono 11 text-tertiary · Detach Button (c21X7y) 20 × 20 radius-xs, `unlink`
 * 12 text-secondary — shown on hover / focus, when the frame also gets stroke 1 border-strong
 * (TwQNv). The resolved value hides when the field is narrower than 140 px (uu8Qa); it stays
 * in the chip's tooltip.
 */
export function PropFieldBound({
  prefix,
  type,
  name,
  resolved,
  missing = false,
  active = false,
  label,
  onOpen,
  onDetach,
  className,
  ...rest
}: PropFieldBoundProps) {
  const Glyph = TYPE_GLYPH_ICONS[type]
  const what = label ?? (typeof prefix === "string" ? prefix : "Field")
  const tip = `${name}${missing ? " (missing)" : ""}${resolved !== undefined ? ` = ${resolved}` : ""}`
  return (
    <div
      {...rest}
      data-type={type}
      className={cx(
        "kimo-prop-field-bound",
        missing && "kimo-prop-field-bound--missing",
        active && "kimo-prop-field-bound--active",
        className,
      )}
    >
      {prefix !== undefined && prefix !== "" && (
        <span
          className={cx(
            "kimo-prop-field-bound__prefix",
            typeof prefix !== "string" && "kimo-prop-field-bound__prefix--icon",
          )}
          aria-hidden="true"
        >
          {prefix}
        </span>
      )}
      <button
        type="button"
        className="kimo-prop-field-bound__chip"
        aria-label={`${what}: bound to ${name}${missing ? " (missing)" : ""}. Change variable`}
        aria-haspopup="dialog"
        aria-expanded={active}
        title={tip}
        onClick={onOpen}
      >
        <Glyph className="kimo-prop-field-bound__glyph" aria-hidden="true" />
        <span className="kimo-prop-field-bound__name">{name}</span>
      </button>
      <span className="kimo-prop-field-bound__spacer" aria-hidden="true" />
      {resolved !== undefined && (
        <span className="kimo-prop-field-bound__resolved" title={resolved}>
          {resolved}
        </span>
      )}
      {onDetach && (
        <button
          type="button"
          className="kimo-prop-field-bound__detach"
          aria-label={`Detach ${what} from ${name}`}
          title="Detach"
          onClick={onDetach}
        >
          <Unlink aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
